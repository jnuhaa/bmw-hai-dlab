import { readJsonState, writeJsonState } from "../shared/jsonStateStore.mjs";
import { kv } from "@vercel/kv";
import { createClient } from "redis";

const persisted = readJsonState("liveCaptureSessions", {
  latestSessionId: null,
  sessions: [],
});

const sessions = new Map(Array.isArray(persisted.sessions) ? persisted.sessions : []);
let latestSessionId =
  typeof persisted.latestSessionId === "string" ? persisted.latestSessionId : null;

const hasKv = Boolean(
  process.env.KV_REST_API_URL?.trim() ||
    process.env.UPSTASH_REDIS_REST_URL?.trim(),
);
const storageRedisUrl = process.env.STORAGE_REDIS_URL?.trim() || "";
const hasStorageRedis = storageRedisUrl.length > 0;

const LATEST_KEY = "live-capture:latest";
const sessionKey = (sessionId) => `live-capture:session:${sessionId}`;

let redisClientPromise = null;

function persistStore() {
  writeJsonState("liveCaptureSessions", {
    latestSessionId,
    sessions: Array.from(sessions.entries()),
  });
}

async function getStorageRedisClient() {
  if (!hasStorageRedis) {
    return null;
  }
  if (!redisClientPromise) {
    const client = createClient({
      url: storageRedisUrl,
    });
    redisClientPromise = client.connect().then(() => client);
  }
  return redisClientPromise;
}

async function storageRedisGetJson(key) {
  const client = await getStorageRedisClient();
  if (!client) {
    return null;
  }
  const raw = await client.get(key);
  if (typeof raw !== "string" || raw.length === 0) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function storageRedisSetJson(key, value) {
  const client = await getStorageRedisClient();
  if (!client) {
    return;
  }
  await client.set(key, JSON.stringify(value));
}

async function kvGetJson(key) {
  const raw = await kv.get(key);
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
  await kv.set(key, JSON.stringify(value));
}

export async function createSession() {
  const sessionId = Math.random().toString(36).slice(2, 10);
  if (hasKv) {
    await kvSetJson(sessionKey(sessionId), {
      captures: [],
    });
    await kv.set(LATEST_KEY, sessionId);
    return sessionId;
  }
  if (hasStorageRedis) {
    await storageRedisSetJson(sessionKey(sessionId), {
      captures: [],
    });
    const client = await getStorageRedisClient();
    await client?.set(LATEST_KEY, sessionId);
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
      await kv.set(LATEST_KEY, sessionId);
    }
    return sessionId;
  }
  if (hasStorageRedis) {
    const key = sessionKey(sessionId);
    const existing = await storageRedisGetJson(key);
    if (!existing) {
      await storageRedisSetJson(key, { captures: [] });
      const client = await getStorageRedisClient();
      await client?.set(LATEST_KEY, sessionId);
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
  if (hasStorageRedis) {
    return await storageRedisGetJson(sessionKey(sessionId));
  }
  return sessions.get(sessionId) ?? null;
}

export async function getLatestSessionId() {
  if (hasKv) {
    const latest = await kv.get(LATEST_KEY);
    return typeof latest === "string" && latest.length > 0 ? latest : null;
  }
  if (hasStorageRedis) {
    const client = await getStorageRedisClient();
    const latest = await client?.get(LATEST_KEY);
    return typeof latest === "string" && latest.length > 0 ? latest : null;
  }
  return latestSessionId;
}

export function isSharedLiveCaptureStoreEnabled() {
  return hasKv || hasStorageRedis;
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
  if (hasStorageRedis) {
    if (sessionId) {
      const existing = await storageRedisGetJson(sessionKey(sessionId));
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
  } else if (hasStorageRedis) {
    await storageRedisSetJson(sessionKey(sessionId), session);
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
