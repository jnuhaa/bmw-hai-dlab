const sessions = new Map();
let latestSessionId = null;

export function createSession() {
  const sessionId = Math.random().toString(36).slice(2, 10);
  sessions.set(sessionId, {
    captures: [],
  });
  latestSessionId = sessionId;
  return sessionId;
}

export function getSession(sessionId) {
  return sessions.get(sessionId) ?? null;
}

export function getLatestSessionId() {
  return latestSessionId;
}

export function resolveSessionId(sessionId) {
  if (sessionId && sessions.has(sessionId)) {
    return sessionId;
  }

  return latestSessionId;
}

export function addCapture(sessionId, imageUrl) {
  const session = getSession(sessionId);
  if (!session) {
    return null;
  }

  const capture = {
    id: `live-${Date.now()}-${session.captures.length + 1}`,
    imageUrl,
    createdAt: new Date().toISOString(),
  };

  session.captures.push(capture);
  return capture;
}

export function getCapturesSince(sessionId, cursor = 0) {
  const session = getSession(sessionId);
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
