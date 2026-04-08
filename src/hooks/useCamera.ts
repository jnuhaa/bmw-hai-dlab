import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

export type CameraStatus =
  | "idle"
  | "requesting"
  | "ready"
  | "denied"
  | "unsupported"
  | "error";

type UseCameraResult = {
  videoRef: RefObject<HTMLVideoElement>;
  status: CameraStatus;
  errorMessage: string | null;
  requestCameraAccess: () => Promise<void>;
  stopCamera: () => void;
  captureFrame: () => string | null;
};

function getCameraErrorMessage(error: unknown) {
  if (!(error instanceof DOMException)) {
    return "The camera could not be started. Please try again.";
  }

  if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
    return "Camera access was denied. Allow camera permission in your browser and try again.";
  }

  if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
    return "No camera was found on this device.";
  }

  if (error.name === "NotReadableError" || error.name === "TrackStartError") {
    return "The camera is already in use by another app.";
  }

  return "The camera could not be started. Please try again.";
}

function waitForVideoFrame(videoElement: HTMLVideoElement) {
  if (videoElement.videoWidth > 0 && videoElement.videoHeight > 0) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    let resolved = false;

    const finish = () => {
      if (resolved) {
        return;
      }

      resolved = true;
      videoElement.removeEventListener("loadedmetadata", handleLoadedMetadata);
      videoElement.removeEventListener("resize", handleLoadedMetadata);
      resolve();
    };

    const handleLoadedMetadata = () => {
      if (videoElement.videoWidth > 0 && videoElement.videoHeight > 0) {
        finish();
      }
    };

    videoElement.addEventListener("loadedmetadata", handleLoadedMetadata);
    videoElement.addEventListener("resize", handleLoadedMetadata);

    window.setTimeout(finish, 1200);
  });
}

export function useCamera(): UseCameraResult {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
  }, []);

  async function requestCameraAccess() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("unsupported");
      setErrorMessage(
        "This browser does not support live camera capture in the current environment.",
      );
      return;
    }

    if (!window.isSecureContext) {
      setStatus("unsupported");
      setErrorMessage(
        "Camera access requires a secure context. Use localhost or HTTPS when testing.",
      );
      return;
    }

    setStatus("requesting");
    setErrorMessage(null);

    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;

      const videoElement = videoRef.current;
      if (videoElement) {
        videoElement.srcObject = stream;
        await videoElement.play();
        await waitForVideoFrame(videoElement);
      }

      setStatus("ready");
    } catch (error) {
      const denied =
        error instanceof DOMException &&
        (error.name === "NotAllowedError" || error.name === "PermissionDeniedError");

      setStatus(denied ? "denied" : "error");
      setErrorMessage(getCameraErrorMessage(error));
    }
  }

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    const videoElement = videoRef.current;
    if (videoElement) {
      videoElement.pause();
      videoElement.srcObject = null;
    }

    setStatus("idle");
    setErrorMessage(null);
  }

  function captureFrame() {
    const videoElement = videoRef.current;
    if (!videoElement || status !== "ready") {
      setErrorMessage("The camera preview is not ready to capture yet.");
      return null;
    }

    if (videoElement.videoWidth === 0 || videoElement.videoHeight === 0) {
      setErrorMessage("The live preview is still initializing. Try again in a moment.");
      return null;
    }

    const canvas = document.createElement("canvas");
    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;

    const context = canvas.getContext("2d");
    if (!context) {
      setErrorMessage("The image could not be captured. Please try again.");
      return null;
    }

    context.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.92);
  }

  return {
    videoRef,
    status,
    errorMessage,
    requestCameraAccess,
    stopCamera,
    captureFrame,
  };
}
