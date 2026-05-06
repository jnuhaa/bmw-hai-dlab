/**
 * Base URL for the phone QR / copy link.
 * If you open the app as `http://localhost:5174`, the QR would encode localhost — the phone
 * tries to connect to itself, not your computer. Set `VITE_PHONE_CAPTURE_ORIGIN` to your
 * machine's LAN URL (same port), e.g. `http://192.168.1.10:5174`, then restart Vite.
 */
export function getPhoneCaptureInviteBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_PHONE_CAPTURE_ORIGIN?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/$/, "");
  }
  if (typeof window === "undefined") {
    return "";
  }
  return window.location.origin;
}
