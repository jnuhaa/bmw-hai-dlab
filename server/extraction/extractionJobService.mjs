import { extractDesignIngredients } from "./extractionService.mjs";
import { readJsonState, writeJsonState } from "../shared/jsonStateStore.mjs";
import { kv } from "@vercel/kv";
import { createClient } from "redis";

const JOB_TTL_MS = 1000 * 60 * 30;
const MAX_JOBS = 120;
const SHARED_JOB_TTL_SECONDS = Math.ceil(JOB_TTL_MS / 1000);

const persistedState = readJsonState("extractionJobs", {
  jobs: [],
  queuedJobIds: [],
  payloads: [],
});

const extractionJobs = new Map(Array.isArray(persistedState.jobs) ? persistedState.jobs : []);
const queuedJobIds = Array.isArray(persistedState.queuedJobIds) ? persistedState.queuedJobIds : [];
const jobPayloadById = new Map(Array.isArray(persistedState.payloads) ? persistedState.payloads : []);
let activeWorkerCount = 0;

const hasKv = Boolean(
  process.env.KV_REST_API_URL?.trim() ||
    process.env.UPSTASH_REDIS_REST_URL?.trim(),
);
const storageRedisUrl = process.env.STORAGE_REDIS_URL?.trim() || "";
const hasStorageRedis = storageRedisUrl.length > 0;
const sharedEnabled = hasKv || hasStorageRedis;
const sharedJobKey = (generationJobId) => `extract:job:${generationJobId}`;
let redisClientPromise = null;

function persistState() {
  writeJsonState("extractionJobs", {
    jobs: Array.from(extractionJobs.entries()),
    queuedJobIds,
    payloads: Array.from(jobPayloadById.entries()),
  });
}

function toIsoNow() {
  return new Date().toISOString();
}

function cloneJob(job) {
  return JSON.parse(JSON.stringify(job));
}

function normalizeWorkflowType(workflowType) {
  return workflowType === "texture" || workflowType === "pattern" ? workflowType : "shape";
}

async function getStorageRedisClient() {
  if (!hasStorageRedis) {
    return null;
  }
  if (!redisClientPromise) {
    const client = createClient({ url: storageRedisUrl });
    redisClientPromise = client.connect().then(() => client);
  }
  return redisClientPromise;
}

async function saveSharedJob(job) {
  const key = sharedJobKey(job.generationJobId);
  if (hasKv) {
    await kv.set(key, JSON.stringify(job), { ex: SHARED_JOB_TTL_SECONDS });
    return;
  }
  if (hasStorageRedis) {
    const client = await getStorageRedisClient();
    await client?.set(key, JSON.stringify(job), { EX: SHARED_JOB_TTL_SECONDS });
  }
}

async function readSharedJob(generationJobId) {
  const key = sharedJobKey(generationJobId);
  let raw = null;
  if (hasKv) {
    raw = await kv.get(key);
  } else if (hasStorageRedis) {
    const client = await getStorageRedisClient();
    raw = await client?.get(key);
  }
  if (typeof raw !== "string" || raw.length === 0) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getQueueConcurrency() {
  const raw = Number.parseInt(process.env.EXTRACTION_QUEUE_CONCURRENCY ?? "1", 10);
  if (!Number.isFinite(raw) || raw < 1) {
    return 1;
  }

  return Math.min(raw, 6);
}

function appendLifecycle(job, status) {
  const previousEvent = job.lifecycle[job.lifecycle.length - 1];
  if (previousEvent?.status === status) {
    return;
  }

  job.lifecycle.push({
    status,
    timestamp: toIsoNow(),
  });
}

function transitionJob(job, status) {
  job.status = status;
  appendLifecycle(job, status);
  job.updatedAt = toIsoNow();
  persistState();
}

async function transitionSharedJob(job, status) {
  job.status = status;
  appendLifecycle(job, status);
  job.updatedAt = toIsoNow();
  await saveSharedJob(job);
}

function refreshQueueMetadata() {
  const queueSize = queuedJobIds.length;

  queuedJobIds.forEach((jobId, index) => {
    const queuedJob = extractionJobs.get(jobId);
    if (!queuedJob) {
      return;
    }

    queuedJob.queuePosition = index + 1;
    queuedJob.queueSize = queueSize;
  });

  extractionJobs.forEach((job) => {
    if (job.status !== "queued") {
      delete job.queuePosition;
      job.queueSize = queueSize;
    }
  });
}

function trimJobs() {
  const now = Date.now();

  Array.from(extractionJobs.entries()).forEach(([jobId, job]) => {
    if (job.status === "queued" || job.status === "running") {
      return;
    }

    const updatedAtMs = Date.parse(job.updatedAt);
    if (Number.isNaN(updatedAtMs)) {
      return;
    }

    if (now - updatedAtMs > JOB_TTL_MS) {
      extractionJobs.delete(jobId);
      jobPayloadById.delete(jobId);
      persistState();
    }
  });

  if (extractionJobs.size <= MAX_JOBS) {
    return;
  }

  const entries = Array.from(extractionJobs.entries())
    .filter(([, job]) => job.status !== "queued" && job.status !== "running")
    .sort((left, right) => Date.parse(left[1].updatedAt) - Date.parse(right[1].updatedAt));
  const overflow = extractionJobs.size - MAX_JOBS;

  entries.slice(0, overflow).forEach(([jobId]) => {
    extractionJobs.delete(jobId);
    jobPayloadById.delete(jobId);
  });
  persistState();
}

async function runJob(generationJobId, payload) {
  const job = extractionJobs.get(generationJobId);
  if (!job) {
    return;
  }

  transitionJob(job, "running");

  try {
    const result = await extractDesignIngredients(payload);
    const generatedOutputs = result.generatedOutputs.map((output) => ({
      ...output,
      parentAssetId: payload.sourceAssetId,
    }));

    job.provider = result.provider;
    job.providerJobId = result.providerJobId;
    job.fallbackReason = result.fallbackReason;
    job.generatedOutputs = generatedOutputs;
    job.parentChild = {
      parentAssetId: payload.sourceAssetId,
      childAssetIds: generatedOutputs.map((output) => output.id),
    };
    transitionJob(job, "completed");
  } catch (error) {
    job.errorMessage =
      error instanceof Error ? error.message : "Generation failed unexpectedly.";
    transitionJob(job, "failed");
  }
}

function pumpQueue() {
  const concurrency = getQueueConcurrency();

  while (activeWorkerCount < concurrency && queuedJobIds.length > 0) {
    const generationJobId = queuedJobIds.shift();
    if (!generationJobId) {
      continue;
    }

    const payload = jobPayloadById.get(generationJobId);
    const job = extractionJobs.get(generationJobId);
    if (!payload || !job || job.status !== "queued") {
      continue;
    }

    activeWorkerCount += 1;
    refreshQueueMetadata();

    void runJob(generationJobId, payload).finally(() => {
      activeWorkerCount = Math.max(0, activeWorkerCount - 1);
      jobPayloadById.delete(generationJobId);
      refreshQueueMetadata();
      pumpQueue();
    });
  }
  persistState();
}

export function createExtractionJob(payload) {
  if (sharedEnabled) {
    return createExtractionJobShared(payload);
  }

  trimJobs();

  const generationJobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = toIsoNow();
  const workflowType = normalizeWorkflowType(payload.workflowType);
  const job = {
    sourceAssetId: payload.sourceAssetId,
    generationJobId,
    status: "queued",
    workflowType,
    provider: undefined,
    providerJobId: undefined,
    fallbackReason: undefined,
    errorMessage: undefined,
    generatedOutputs: [],
    parentChild: {
      parentAssetId: payload.sourceAssetId,
      childAssetIds: [],
    },
    createdAt,
    updatedAt: createdAt,
    lifecycle: [
      {
        status: "queued",
        timestamp: createdAt,
      },
    ],
    queuePosition: 0,
    queueSize: 0,
  };

  extractionJobs.set(generationJobId, job);
  jobPayloadById.set(generationJobId, {
    ...payload,
    workflowType,
  });
  queuedJobIds.push(generationJobId);
  refreshQueueMetadata();
  persistState();
  pumpQueue();

  return cloneJob(job);
}

export function getExtractionJob(generationJobId) {
  if (sharedEnabled) {
    return getExtractionJobShared(generationJobId);
  }

  trimJobs();
  refreshQueueMetadata();
  const job = extractionJobs.get(generationJobId);
  if (!job) {
    return null;
  }

  return cloneJob(job);
}

if (queuedJobIds.length > 0) {
  pumpQueue();
}

async function createExtractionJobShared(payload) {
  const generationJobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = toIsoNow();
  const workflowType = normalizeWorkflowType(payload.workflowType);
  const job = {
    sourceAssetId: payload.sourceAssetId,
    generationJobId,
    status: "queued",
    workflowType,
    provider: undefined,
    providerJobId: undefined,
    fallbackReason: undefined,
    errorMessage: undefined,
    generatedOutputs: [],
    parentChild: {
      parentAssetId: payload.sourceAssetId,
      childAssetIds: [],
    },
    createdAt,
    updatedAt: createdAt,
    lifecycle: [
      {
        status: "queued",
        timestamp: createdAt,
      },
    ],
    queuePosition: 0,
    queueSize: 0,
  };

  await saveSharedJob(job);
  await transitionSharedJob(job, "running");

  try {
    const result = await extractDesignIngredients({
      ...payload,
      workflowType,
    });
    const generatedOutputs = result.generatedOutputs.map((output) => ({
      ...output,
      parentAssetId: payload.sourceAssetId,
    }));
    job.provider = result.provider;
    job.providerJobId = result.providerJobId;
    job.fallbackReason = result.fallbackReason;
    job.generatedOutputs = generatedOutputs;
    job.parentChild = {
      parentAssetId: payload.sourceAssetId,
      childAssetIds: generatedOutputs.map((output) => output.id),
    };
    await transitionSharedJob(job, "completed");
  } catch (error) {
    job.errorMessage =
      error instanceof Error ? error.message : "Generation failed unexpectedly.";
    await transitionSharedJob(job, "failed");
  }

  return cloneJob(job);
}

async function getExtractionJobShared(generationJobId) {
  const job = await readSharedJob(generationJobId);
  if (!job) {
    return null;
  }
  return cloneJob(job);
}
