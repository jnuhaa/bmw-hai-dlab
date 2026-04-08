import { extractDesignIngredients } from "./extractionService.mjs";

const JOB_TTL_MS = 1000 * 60 * 30;
const MAX_JOBS = 120;

const extractionJobs = new Map();
const queuedJobIds = [];
const jobPayloadById = new Map();
let activeWorkerCount = 0;

function toIsoNow() {
  return new Date().toISOString();
}

function cloneJob(job) {
  return JSON.parse(JSON.stringify(job));
}

function normalizeWorkflowType(workflowType) {
  return workflowType === "texture" || workflowType === "pattern" ? workflowType : "shape";
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
}

export function createExtractionJob(payload) {
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
  pumpQueue();

  return cloneJob(job);
}

export function getExtractionJob(generationJobId) {
  trimJobs();
  refreshQueueMetadata();
  const job = extractionJobs.get(generationJobId);
  if (!job) {
    return null;
  }

  return cloneJob(job);
}
