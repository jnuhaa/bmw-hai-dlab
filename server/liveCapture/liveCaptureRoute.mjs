import {
  addCapture,
  createSession,
  ensureSession,
  getCapturesSince,
  getLatestSessionId,
  getSession,
  resolveSessionId,
} from "./liveCaptureStore.mjs";

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

function parseSessionPath(pathname) {
  const match = pathname.match(/^\/session\/([^/]+)(?:\/(upload))?\/?$/);
  if (!match) {
    return null;
  }

  return {
    sessionId: match[1],
    action: match[2] ?? null,
  };
}

/** Vite passes full paths like /api/live-capture/session/...; middleware mount is not always stripped. */
function normalizeLiveCapturePathname(pathname) {
  const prefix = "/api/live-capture";
  if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
    const rest = pathname.slice(prefix.length);
    return rest === "" ? "/" : rest;
  }
  return pathname;
}

export async function handleLiveCaptureRoute(req, res) {
  const requestUrl = new URL(req.url ?? "/", "http://localhost");
  const pathname = normalizeLiveCapturePathname(requestUrl.pathname);

  if (pathname === "/session" && req.method === "POST") {
    const sessionId = createSession();
    sendJson(res, 200, {
      sessionId,
      phonePath: "/phone",
    });
    return;
  }

  const parsedPath = parseSessionPath(pathname);
  if (!parsedPath) {
    sendJson(res, 404, { error: "Live capture route not found." });
    return;
  }

  const resolvedSessionId = ensureSession(parsedPath.sessionId) ?? resolveSessionId(parsedPath.sessionId);

  if (!resolvedSessionId || !getSession(resolvedSessionId)) {
    sendJson(res, 404, { error: "Live capture session not found." });
    return;
  }

  if (!parsedPath.action && req.method === "GET") {
    const cursor = Number.parseInt(requestUrl.searchParams.get("cursor") ?? "0", 10);
    const payload = getCapturesSince(resolvedSessionId, cursor);
    sendJson(res, 200, {
      sessionId: resolvedSessionId,
      ...payload,
    });
    return;
  }

  if (parsedPath.action === "upload" && req.method === "POST") {
    const payload = await readJsonBody(req);
    if (typeof payload?.imageUrl !== "string" || !payload.imageUrl.startsWith("data:image/")) {
      sendJson(res, 400, { error: "A valid image data URL is required." });
      return;
    }

    const capture = addCapture(resolvedSessionId, payload.imageUrl);
    sendJson(res, 200, {
      sessionId: resolvedSessionId,
      capture,
      usedFallbackSession: resolvedSessionId !== parsedPath.sessionId,
      latestSessionId: getLatestSessionId(),
    });
    return;
  }

  sendJson(res, 405, { error: "Method not allowed." });
}
