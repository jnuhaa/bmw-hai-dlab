const ipWindowState = new Map();

function nowMs() {
  return Date.now();
}

function asPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket?.remoteAddress ?? "unknown";
}

function getBearerToken(req) {
  const auth = req.headers.authorization;
  if (typeof auth !== "string") {
    return "";
  }
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

function isPublicStatusPath(url = "") {
  return (
    url.startsWith("/api/canvas/status") ||
    url.startsWith("/api/extract/config") ||
    url === "/api/canvas" ||
    url === "/api/extract"
  );
}

export function logApiRequest(req, statusCode, startedAtMs) {
  const durationMs = Math.max(0, nowMs() - startedAtMs);
  const ip = getClientIp(req);
  const method = req.method ?? "UNKNOWN";
  const path = String(req.url ?? "").split("?")[0] || "/";
  console.info(`[api] ${method} ${path} ${statusCode} ${durationMs}ms ip=${ip}`);
}

export function checkApiKey(req) {
  const configuredKey = (process.env.API_SHARED_KEY ?? "").trim();
  const path = String(req.url ?? "");
  if (!configuredKey || isPublicStatusPath(path)) {
    return { ok: true };
  }

  const headerToken =
    (typeof req.headers["x-api-key"] === "string" && req.headers["x-api-key"].trim()) || getBearerToken(req);

  if (headerToken !== configuredKey) {
    return {
      ok: false,
      statusCode: 401,
      payload: { error: "Unauthorized API request." },
    };
  }
  return { ok: true };
}

export function checkRateLimit(req) {
  const maxRequests = asPositiveInt(process.env.API_RATE_LIMIT_PER_MINUTE, 120);
  const windowMs = asPositiveInt(process.env.API_RATE_LIMIT_WINDOW_MS, 60_000);
  const key = `${getClientIp(req)}:${String(req.url ?? "").split("?")[0]}`;
  const current = nowMs();
  const state = ipWindowState.get(key);

  if (!state || current - state.windowStartMs >= windowMs) {
    ipWindowState.set(key, { windowStartMs: current, count: 1 });
    return { ok: true };
  }

  state.count += 1;
  if (state.count > maxRequests) {
    const retryAfterSec = Math.ceil((windowMs - (current - state.windowStartMs)) / 1000);
    return {
      ok: false,
      statusCode: 429,
      headers: { "Retry-After": String(Math.max(1, retryAfterSec)) },
      payload: { error: "Rate limit exceeded. Try again shortly." },
    };
  }

  return { ok: true };
}
