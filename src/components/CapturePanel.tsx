import type { RefObject } from "react";
import type { CameraStatus } from "../hooks/useCamera";

type CapturePanelProps = {
  videoRef: RefObject<HTMLVideoElement>;
  cameraStatus: CameraStatus;
  errorMessage: string | null;
  captureCount: number;
  phoneCaptureCount: number;
  phoneSessionId: string | null;
  phoneSessionUrl: string | null;
  onEnableCamera: () => void;
  onCapture: () => void;
  onStopCamera: () => void;
};

const statusCopy: Record<CameraStatus, { title: string; detail: string }> = {
  idle: {
    title: "Enable live camera",
    detail: "Start a browser camera stream and absorb captured references into the sphere.",
  },
  requesting: {
    title: "Requesting camera permission",
    detail: "Your browser is asking for access to the capture feed.",
  },
  ready: {
    title: "Live preview active",
    detail: "Frame a reference and send it into the field when it feels right.",
  },
  denied: {
    title: "Camera access denied",
    detail: "Update browser permissions and try again.",
  },
  unsupported: {
    title: "Camera unavailable here",
    detail: "Use localhost or HTTPS to access the browser camera.",
  },
  error: {
    title: "Camera could not start",
    detail: "Check device availability and retry.",
  },
};

export function CapturePanel({
  videoRef,
  cameraStatus,
  errorMessage,
  captureCount,
  phoneCaptureCount,
  phoneSessionId,
  phoneSessionUrl,
  onEnableCamera,
  onCapture,
  onStopCamera,
}: CapturePanelProps) {
  const currentStatus = statusCopy[cameraStatus];

  return (
    <section className="capture-dock">
      <div className="capture-dock__header">
        <div>
          <p className="section-label">Capture</p>
          <h2>Feed the sphere</h2>
        </div>
        <span className="studio-pill studio-pill--muted">
          {captureCount.toString().padStart(2, "0")}
        </span>
      </div>

      <div className="capture-dock__body">
        <div className="capture-dock__preview">
          <div className="capture-dock__preview-orb" />
          <video
            ref={videoRef}
            className={`capture-dock__video ${
              cameraStatus === "ready" ? "capture-dock__video--visible" : ""
            }`}
            autoPlay
            muted
            playsInline
          />

          {cameraStatus !== "ready" ? (
            <div className="capture-dock__empty-state">
              <div className="capture-dock__lens" />
              <p>{currentStatus.title}</p>
              <span>{errorMessage ?? currentStatus.detail}</span>
            </div>
          ) : null}
        </div>

        <div className="capture-dock__controls">
          <button
            className="dock-button dock-button--ghost"
            type="button"
            onClick={onEnableCamera}
            disabled={cameraStatus === "requesting"}
          >
            <span className="dock-button__state">Preview</span>
            <strong>{cameraStatus === "ready" ? "Restart camera" : "Enable camera"}</strong>
          </button>
          <button
            className="dock-button dock-button--primary"
            type="button"
            onClick={onCapture}
            disabled={cameraStatus !== "ready"}
          >
            <span className="dock-button__state">Ingest</span>
            <strong>Capture to sphere</strong>
          </button>
        </div>

        <div className="capture-dock__meta">
          <div>
            <span className="section-label">Status</span>
            <strong>{cameraStatus === "ready" ? "Live" : "Idle"}</strong>
          </div>
          <div>
            <span className="section-label">Phone shots</span>
            <strong>{phoneCaptureCount.toString().padStart(2, "0")}</strong>
          </div>
        </div>

        <div className="capture-dock__relay">
          <div>
            <p className="section-label">Phone relay</p>
            <strong>Companion capture route</strong>
          </div>
          <p>
            Open the mobile route and each photo will settle into this same sphere session.
          </p>
          {phoneSessionUrl ? (
            <a href={phoneSessionUrl} target="_blank" rel="noreferrer">
              {phoneSessionUrl}
            </a>
          ) : (
            <span className="capture-dock__relay-pending">
              Generating phone session...
            </span>
          )}
          {phoneSessionId ? (
            <small>Session {phoneSessionId.toUpperCase()}</small>
          ) : null}
        </div>

        {cameraStatus === "ready" ? (
          <button className="capture-dock__stop" type="button" onClick={onStopCamera}>
            Stop live preview
          </button>
        ) : null}
      </div>
    </section>
  );
}
