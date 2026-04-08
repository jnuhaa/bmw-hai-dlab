import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useCamera } from "../hooks/useCamera";
import {
  getPhoneCaptureSessionIdFromLocation,
  uploadLiveCapture,
  uploadLiveCaptureToLatest,
} from "../services/liveCaptureClient";
import { THEME_STORAGE_KEY } from "../theme";

type CropSelection = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function normalizeSelection(startX: number, startY: number, endX: number, endY: number) {
  return {
    x: Math.min(startX, endX),
    y: Math.min(startY, endY),
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY),
  };
}

async function captureSelectionFromVideo(
  videoElement: HTMLVideoElement,
  canvasElement: HTMLCanvasElement,
  selection: CropSelection,
) {
  if (videoElement.videoWidth === 0 || videoElement.videoHeight === 0) {
    return null;
  }

  const displayWidth = videoElement.clientWidth;
  const displayHeight = videoElement.clientHeight;

  if (displayWidth === 0 || displayHeight === 0) {
    return null;
  }

  const scale = Math.max(
    displayWidth / videoElement.videoWidth,
    displayHeight / videoElement.videoHeight,
  );
  const renderedWidth = videoElement.videoWidth * scale;
  const renderedHeight = videoElement.videoHeight * scale;
  const offsetX = (displayWidth - renderedWidth) / 2;
  const offsetY = (displayHeight - renderedHeight) / 2;

  const sourceX = clamp((selection.x - offsetX) / scale, 0, videoElement.videoWidth);
  const sourceY = clamp((selection.y - offsetY) / scale, 0, videoElement.videoHeight);
  const sourceWidth = clamp(selection.width / scale, 1, videoElement.videoWidth - sourceX);
  const sourceHeight = clamp(selection.height / scale, 1, videoElement.videoHeight - sourceY);

  canvasElement.width = Math.round(sourceWidth);
  canvasElement.height = Math.round(sourceHeight);

  const context = canvasElement.getContext("2d");
  if (!context) {
    return null;
  }

  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvasElement.width, canvasElement.height);
  context.drawImage(
    videoElement,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    canvasElement.width,
    canvasElement.height,
  );

  return canvasElement.toDataURL("image/jpeg", 0.9);
}

export function PhoneCaptureScreen() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const bufferCanvasRef = useRef<HTMLCanvasElement>(null);
  const {
    videoRef,
    status: cameraStatus,
    errorMessage,
    requestCameraAccess,
  } = useCamera();
  const [isUploading, setIsUploading] = useState(false);
  const [selection, setSelection] = useState<CropSelection | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const pairedSessionId = useMemo(() => getPhoneCaptureSessionIdFromLocation(), []);

  useEffect(() => {
    void requestCameraAccess();
    // The phone route should attempt camera access immediately on first mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = "dark";
    return () => {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      if (stored === "light" || stored === "dark") {
        document.documentElement.dataset.theme = stored;
      } else {
        const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        document.documentElement.dataset.theme = prefersDark ? "dark" : "light";
      }
    };
  }, []);

  function getRelativePoint(event: ReactPointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: clamp(event.clientX - bounds.left, 0, bounds.width),
      y: clamp(event.clientY - bounds.top, 0, bounds.height),
    };
  }

  async function handleSendSelection(nextSelection: CropSelection) {
    const videoElement = videoRef.current;
    const canvasElement = bufferCanvasRef.current;

    if (!videoElement || !canvasElement) {
      return;
    }

    if (nextSelection.width < 32 || nextSelection.height < 32) {
      setSelection(null);
      return;
    }

    try {
      setIsUploading(true);
      const imageUrl = await captureSelectionFromVideo(videoElement, canvasElement, nextSelection);
      if (!imageUrl) {
        return;
      }

      if (pairedSessionId) {
        await uploadLiveCapture(pairedSessionId, imageUrl);
      } else {
        await uploadLiveCaptureToLatest(imageUrl);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsUploading(false);
      setSelection(null);
    }
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (cameraStatus !== "ready" || isUploading) {
      return;
    }

    const point = getRelativePoint(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragStart(point);
    setSelection({ x: point.x, y: point.y, width: 0, height: 0 });
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragStart) {
      return;
    }

    const point = getRelativePoint(event);
    setSelection(normalizeSelection(dragStart.x, dragStart.y, point.x, point.y));
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragStart) {
      return;
    }

    event.currentTarget.releasePointerCapture(event.pointerId);
    const point = getRelativePoint(event);
    const nextSelection = normalizeSelection(dragStart.x, dragStart.y, point.x, point.y);
    setDragStart(null);
    void handleSendSelection(nextSelection);
  }

  return (
    <main className="phone-capture phone-capture--live">
      {!pairedSessionId ? (
        <p className="phone-capture__pairing-hint" role="status">
          Open the QR or link from Curate on desktop for session pairing. Bare /phone uses the latest session only.
        </p>
      ) : null}
      <section className="phone-capture__panel phone-capture__panel--live">
        <div
          ref={viewportRef}
          className={`phone-capture__viewport phone-capture__viewport--interactive ${
            cameraStatus === "ready" ? "phone-capture__viewport--ready" : ""
          }`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          <video
            ref={videoRef}
            className={`phone-capture__video ${
              cameraStatus === "ready" ? "phone-capture__video--visible" : ""
            }`}
            autoPlay
            muted
            playsInline
          />

          {selection ? (
            <div
              className="phone-capture__selection"
              style={{
                left: `${selection.x}px`,
                top: `${selection.y}px`,
                width: `${selection.width}px`,
                height: `${selection.height}px`,
              }}
            />
          ) : null}

          {cameraStatus !== "ready" ? (
            <div className="phone-capture__overlay">
              {cameraStatus !== "requesting" ? (
                <button
                  className="dock-button dock-button--primary"
                  type="button"
                  onClick={() => void requestCameraAccess()}
                >
                  Enable camera
                </button>
              ) : (
                <span>{errorMessage ?? "Starting camera..."}</span>
              )}
              {cameraStatus !== "requesting" && errorMessage ? (
                <span>{errorMessage}</span>
              ) : null}
            </div>
          ) : null}

          {isUploading ? <div className="phone-capture__upload-indicator" aria-hidden="true" /> : null}
        </div>
      </section>

      <canvas ref={bufferCanvasRef} className="phone-capture__buffer" />
    </main>
  );
}
