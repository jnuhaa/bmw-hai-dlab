import QRCode from "react-qr-code";
import { useCallback, useState } from "react";

type PhoneCaptureInviteProps = {
  phoneUrl: string;
  sessionId: string;
};

function isLocalhostPhoneUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

export function PhoneCaptureInvite({ phoneUrl, sessionId }: PhoneCaptureInviteProps) {
  const [copied, setCopied] = useState(false);
  const localhostQr = isLocalhostPhoneUrl(phoneUrl);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(phoneUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [phoneUrl]);

  return (
    <div className="memory-sphere-phone-invite" aria-labelledby="phone-invite-label">
      <div className="memory-sphere-phone-invite__head">
        <span className="section-label" id="phone-invite-label">
          Phone capture
        </span>
        <p className="memory-sphere-phone-invite__lede">
          Use this session-specific URL for reliable pairing. Scan or open it on your phone, then drag on the frame to crop and send.
        </p>
        {localhostQr ? (
          <p className="memory-sphere-phone-invite__warn" role="alert">
            This link points at <strong>localhost</strong>, so your phone cannot reach it. For local phone testing, set{" "}
            <code className="memory-sphere-phone-invite__code">VITE_PHONE_CAPTURE_ORIGIN=http://YOUR_LAN_IP:5174</code>{" "}
            in <code className="memory-sphere-phone-invite__code">.env</code> and restart the dev server. For production,
            set it to your public HTTPS app URL.
          </p>
        ) : null}
      </div>
      <div className="memory-sphere-phone-invite__row">
        <div className="memory-sphere-phone-invite__qr" aria-hidden>
          <QRCode value={phoneUrl} size={112} level="M" />
        </div>
        <div className="memory-sphere-phone-invite__actions">
          <code className="memory-sphere-phone-invite__url" title={phoneUrl}>
            {phoneUrl}
          </code>
          <div className="memory-sphere-phone-invite__buttons">
            <button type="button" className="memory-sphere-phone-invite__copy" onClick={() => void handleCopy()}>
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
          <span className="memory-sphere-phone-invite__session">Session {sessionId.toUpperCase()}</span>
        </div>
      </div>
    </div>
  );
}
