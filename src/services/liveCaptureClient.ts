import type {
  LiveCapturePollResponse,
  LiveCaptureSessionResponse,
  LiveCaptureUploadResponse,
} from "../types/liveCapture";

/** Session id from `/phone/:sessionId` or `?session=` on `/phone` (same origin as desktop). */
export function getPhoneCaptureSessionIdFromLocation(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  const path = window.location.pathname.replace(/\/$/, "") || "/";
  const pathMatch = path.match(/^\/phone\/([^/]+)$/);
  if (pathMatch?.[1]) {
    return pathMatch[1];
  }
  if (path === "/phone") {
    const q = new URLSearchParams(window.location.search).get("session");
    return q?.trim() || null;
  }
  return null;
}

export async function createLiveCaptureSession() {
  const response = await fetch("/api/live-capture/session", {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error("Unable to create live capture session.");
  }

  return (await response.json()) as LiveCaptureSessionResponse;
}

export async function pollLiveCaptureSession(sessionId: string, cursor: number) {
  const response = await fetch(
    `/api/live-capture/session/${sessionId}?cursor=${cursor}`,
  );

  if (!response.ok) {
    throw new Error("Unable to poll live capture session.");
  }

  return (await response.json()) as LiveCapturePollResponse;
}

export async function uploadLiveCapture(sessionId: string, imageUrl: string) {
  const response = await fetch(`/api/live-capture/session/${sessionId}/upload`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ imageUrl }),
  });

  if (!response.ok) {
    throw new Error("Unable to upload phone capture.");
  }

  return (await response.json()) as LiveCaptureUploadResponse;
}

export async function uploadLiveCaptureToLatest(imageUrl: string) {
  return uploadLiveCapture("latest", imageUrl);
}
