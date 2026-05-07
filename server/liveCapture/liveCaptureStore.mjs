import { readJsonState, writeJsonState } from "../shared/jsonStateStore.mjs";

const persisted = readJsonState("liveCaptureSessions", {
  latestSessionId: null,
  sessions: [],
});

const sessions = new Map(Array.isArray(persisted.sessions) ? persisted.sessions : []);
let latestSessionId =
  typeof persisted.latestSessionId === "string" ? persisted.latestSessionId : null;

const kvBaseUrl =
  process.env.KV_REST_API_URL?.trim() || process.env.UPSTASH_REDIS_REST_URL?.trim() || "";
const kvToken =
  process.env.KV_REST_API_TOKEN?.trim() || process.env.UPSTASH_REDIS_REST_TOKEN?.trim() || "";
const hasKv = Boolean(kvBaseUrl && kvToken);

const LATEST_KEY = "live-capture:latest";
const sessionKey = (sessionId) => `live-capture:session:${sessionId}`;

function persistStore() {
  writeJsonState("liveCaptureSessions", {
    latestSessionId,
    sessions: Array.from(sessions.entries()),
  });
}

async function kvCommand(...parts) {
  const encoded = parts.map((part) => encodeURIComponent(String(part))).join("/");
  const response = await fetch(`${kvBaseUrl}/${encoded}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${kvToken}`,
    },
  });
  if (!response.ok) {
    throw new Error(`KV command failed (${response.status})`);
  }
  const body = await response.json();
  return body?.result ?? null;
}

async function kvGetJson(key) {
  const raw = await kvCommand("get", key);
  if (typeof raw !== "string" || raw.length === 0) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function kvSetJson(key, value) {
  await kvCommand("set", key, JSON.stringify(value));
}

export async function createSession() {
  const sessionId = Math.random().toString(36).slice(2, 10);
  if (hasKv) {
    await kvSetJson(sessionKey(sessionId), {
      captures: [],
    });
    await kvCommand("set", LATEST_KEY, sessionId);
    return sessionId;
  }

  sessions.set(sessionId, {
    captures: [],
  });
  latestSessionId = sessionId;
  persistStore();
  return sessionId;
}

export async function ensureSession(sessionId) {
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return null;
  }

  if (hasKv) {
    const key = sessionKey(sessionId);
    const existing = await kvGetJson(key);
    if (!existing) {
      await kvSetJson(key, { captures: [] });
      await kvCommand("set", LATEST_KEY, sessionId);
    }
    return sessionId;
  }

  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, { captures: [] });
    latestSessionId = sessionId;
    persistStore();
  }
  return sessionId;
}

export async function getSession(sessionId) {
  if (hasKv) {
    return await kvGetJson(sessionKey(sessionId));
  }
  return sessions.get(sessionId) ?? null;
}

export async function getLatestSessionId() {
  if (hasKv) {
    const latest = await kvCommand("get", LATEST_KEY);
    return typeof latest === "string" && latest.length > 0 ? latest : null;
  }
  return latestSessionId;
}

export async function resolveSessionId(sessionId) {
  if (hasKv) {
    if (sessionId) {
      const existing = await kvGetJson(sessionKey(sessionId));
      if (existing) {
        return sessionId;
      }
    }
    return await getLatestSessionId();
  }

  if (sessionId && sessions.has(sessionId)) {
    return sessionId;
  }

  return latestSessionId;
}

export async function addCapture(sessionId, imageUrl) {
  const session = await getSession(sessionId);
  if (!session) {
    return null;
  }

  const capture = {
    id: `live-${Date.now()}-${session.captures.length + 1}`,
    imageUrl,
    createdAt: new Date().toISOString(),
  };

  session.captures.push(capture);
  if (hasKv) {
    await kvSetJson(sessionKey(sessionId), session);
  } else {
    persistStore();
  }
  return capture;
}

export async function getCapturesSince(sessionId, cursor = 0) {
  const session = await getSession(sessionId);
  if (!session) {
    return null;
  }

  const safeCursor = Number.isFinite(cursor) ? cursor : 0;

  return {
    captures: session.captures.slice(safeCursor),
    nextCursor: session.captures.length,
    totalCaptures: session.captures.length,
  };
}
