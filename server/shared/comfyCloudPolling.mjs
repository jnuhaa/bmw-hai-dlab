/** Shared Comfy Cloud job polling: status-first, 429 backoff, correct status enums. */

export const CLOUD_RATE_LIMIT_BACKOFF_MAX_MS = 30_000;
export const CLOUD_RATE_LIMIT_INITIAL_MS = 2_000;

export function parseRetryAfterMs(response) {
  const raw = response.headers?.get?.("retry-after");
  if (!raw) {
    return null;
  }

  const seconds = Number.parseInt(raw, 10);
  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds * 1000;
  }

  return null;
}

export function computeRateLimitBackoffMs(attempt, response) {
  const retryAfter = parseRetryAfterMs(response);
  if (retryAfter != null) {
    return retryAfter;
  }

  const exponent = Math.min(Math.max(attempt, 1) - 1, 4);
  return Math.min(CLOUD_RATE_LIMIT_BACKOFF_MAX_MS, CLOUD_RATE_LIMIT_INITIAL_MS * 2 ** exponent);
}

export function isCloudJobCompleted(status) {
  return status === "completed";
}

/** Comfy Cloud OpenAPI uses `error`; legacy integrations may still emit `failed`. */
export function isCloudJobTerminalFailure(status) {
  return status === "error" || status === "cancelled" || status === "failed";
}

export function parseCloudFailureReason(statusPayload, fallbackStatus) {
  const direct = statusPayload?.message ?? statusPayload?.error ?? statusPayload?.error_message;
  if (typeof direct === "string" && direct.trim().length > 0) {
    const trimmed = direct.trim();
    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed?.exception_message === "string" && parsed.exception_message.length > 0) {
          return parsed.exception_message;
        }
        if (typeof parsed?.message === "string" && parsed.message.length > 0) {
          return parsed.message;
        }
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }

  return fallbackStatus;
}

export function formatComfy429Hint() {
  return " Rate limited by Comfy Cloud: increase COMFYUI_POLL_INTERVAL_MS (e.g. 4000), avoid parallel extracts, and retry shortly.";
}

export function defaultPollIntervalMs(cloudMode) {
  const envValue = process.env.COMFYUI_POLL_INTERVAL_MS?.trim();
  if (envValue) {
    const parsed = Number(envValue);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return cloudMode ? 4000 : 1500;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Returns `rate_limited` | `pending` | `done` with optional images.
 * `throwHttpError(label, response)` is called for non-retryable HTTP failures.
 */
export async function pollHistoryForOutputs({
  baseUrl,
  promptId,
  cloudMode,
  historyPath,
  headers,
  outputNodeId,
  outputNodeIds,
  extractImagesFromHistory,
  extractImagesFromHistoryByNodeIds,
  promptHistoryHasOutputsForAllNodes,
  throwHttpError,
  rateLimitState,
}) {
  const response = await fetch(`${baseUrl}${historyPath}`, { headers });

  if (response.status === 429) {
    rateLimitState.attempt += 1;
    const backoffMs = computeRateLimitBackoffMs(rateLimitState.attempt, response);
    return { type: "rate_limited", backoffMs };
  }

  if (response.ok) {
    rateLimitState.attempt = 0;
    const payload = await response.json();
    const promptHistory = payload[promptId] ?? payload;
    const images =
      outputNodeIds.length > 0
        ? extractImagesFromHistoryByNodeIds(promptHistory, outputNodeIds)
        : extractImagesFromHistory(promptHistory, outputNodeId);

    if (outputNodeIds.length > 0) {
      if (promptHistoryHasOutputsForAllNodes(promptHistory, outputNodeIds)) {
        return { type: "done", images };
      }
    } else if (images.length > 0) {
      return { type: "done", images };
    }

    return { type: "pending" };
  }

  if (cloudMode && response.status === 404) {
    return { type: "pending" };
  }

  throwHttpError("ComfyUI /history", response, baseUrl);
  return { type: "pending" };
}

/**
 * Poll cloud job status. Returns `rate_limited` | `in_progress` | `completed` | throws on terminal failure.
 */
export async function pollCloudJobStatus({
  baseUrl,
  statusPath,
  headers,
  throwHttpError,
  rateLimitState,
}) {
  const response = await fetch(`${baseUrl}${statusPath}`, { headers });

  if (response.status === 429) {
    rateLimitState.attempt += 1;
    const backoffMs = computeRateLimitBackoffMs(rateLimitState.attempt, response);
    return { type: "rate_limited", backoffMs };
  }

  if (!response.ok) {
    throwHttpError("ComfyUI cloud status", response, baseUrl);
  }

  rateLimitState.attempt = 0;
  const statusPayload = await response.json();
  const status = String(statusPayload.status ?? "");

  if (isCloudJobTerminalFailure(status)) {
    const reason = parseCloudFailureReason(statusPayload, status);
    throw new Error(`ComfyUI cloud job ${status}: ${reason}`);
  }

  if (isCloudJobCompleted(status)) {
    return { type: "completed", statusPayload };
  }

  return { type: "in_progress", status };
}
