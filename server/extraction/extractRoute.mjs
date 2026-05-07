import { createExtractionJob, getExtractionJob } from "./extractionJobService.mjs";
import { basename } from "node:path";

async function readJsonBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  return rawBody ? JSON.parse(rawBody) : {};
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

/** Path only, no query string (Vite may pass full `/api/extract/...` or stripped `/job-...`). */
function requestPathname(req) {
  const raw = String(req.url ?? "/").split("?")[0];
  return raw || "/";
}

function isExtractConfigGet(pathname) {
  return pathname === "/config" || pathname === "/config/" || pathname.endsWith("/extract/config");
}

/** POST create job: `/`, `/api/extract`, or stripped mount. */
function isExtractJobCreatePost(pathname) {
  return (
    pathname === "/" ||
    pathname === "" ||
    pathname === "/api/extract" ||
    pathname === "/api/extract/"
  );
}

/** GET job status: last path segment is `job-*` (matches createExtractionJob ids). */
function extractJobIdFromPathname(pathname) {
  const match = pathname.match(/\/(job-[^/]+)\/?$/);
  return match ? match[1] : null;
}

function normalizeExtractPayload(payload) {
  if (
    typeof payload?.sourceAssetId !== "string" ||
    typeof payload?.sourceImageUrl !== "string"
  ) {
    return null;
  }

  if (payload.workflowType != null) {
    const isSupportedWorkflowType =
      payload.workflowType === "shape" ||
      payload.workflowType === "texture" ||
      payload.workflowType === "pattern";

    if (!isSupportedWorkflowType) {
      return null;
    }
  }

  if (payload.contextText != null && typeof payload.contextText !== "string") {
    return null;
  }

  if (
    payload.labels != null &&
    (!Array.isArray(payload.labels) || payload.labels.some((label) => typeof label !== "string"))
  ) {
    return null;
  }

  if (payload.constraintSettings != null) {
    if (typeof payload.constraintSettings !== "object" || Array.isArray(payload.constraintSettings)) {
      return null;
    }
  }

  return {
    sourceAssetId: payload.sourceAssetId,
    sourceImageUrl: payload.sourceImageUrl,
    contextText: payload.contextText,
    workflowType: payload.workflowType,
    labels: payload.labels,
    constraintSettings: payload.constraintSettings,
  };
}

function boolFromEnv(value) {
  if (typeof value !== "string") {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function buildRuntimeConfig() {
  const provider = (process.env.EXTRACTION_PROVIDER ?? "mock").trim().toLowerCase();
  const baseUrl = process.env.COMFYUI_BASE_URL ?? null;
  let comfyHost = null;
  try {
    comfyHost = baseUrl ? new URL(baseUrl).host : null;
  } catch {
    comfyHost = baseUrl;
  }

  const workflowPath = process.env.COMFYUI_WORKFLOW_PATH ?? null;

  const apiKey =
    (typeof process.env.COMFYUI_API_KEY === "string" && process.env.COMFYUI_API_KEY.trim()) ||
    (typeof process.env.COMFY_CLOUD_API_KEY === "string" && process.env.COMFY_CLOUD_API_KEY.trim()) ||
    "";

  return {
    provider,
    cloudMode: boolFromEnv(process.env.COMFYUI_CLOUD_MODE),
    allowMockFallback: boolFromEnv(process.env.COMFYUI_ALLOW_MOCK_FALLBACK),
    comfyHost,
    workflowPath: workflowPath ? basename(workflowPath) : null,
    hasApiKey: apiKey.length > 0,
  };
}

export async function handleExtractRoute(req, res) {
  const pathname = requestPathname(req);

  try {
    if (req.method === "GET" && isExtractConfigGet(pathname)) {
      sendJson(res, 200, buildRuntimeConfig());
      return;
    }

    if (req.method === "POST" && isExtractJobCreatePost(pathname)) {
      const payload = await readJsonBody(req);
      const normalizedPayload = normalizeExtractPayload(payload);

      if (!normalizedPayload) {
        sendJson(res, 400, { error: "Invalid extraction request payload." });
        return;
      }

      const job = await createExtractionJob(normalizedPayload);
      sendJson(res, 202, job);
      return;
    }

    const jobId = req.method === "GET" ? extractJobIdFromPathname(pathname) : null;
    if (req.method === "GET" && jobId) {
      const job = await getExtractionJob(jobId);
      if (!job) {
        sendJson(res, 404, { error: "Extraction job not found." });
        return;
      }

      sendJson(res, 200, job);
      return;
    }

    sendJson(res, 405, { error: "Method not allowed." });
  } catch (error) {
    console.error("[extract] Route failure", error);
    sendJson(res, 500, { error: "Extraction failed." });
  }
}
