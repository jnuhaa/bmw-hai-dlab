/** Padding included in card `width`/`height` (box-sizing: border-box): 20px each side for stickies. */
const STICKY_CARD_PAD = 40;
const STICKY_MIN_H = 88;
/** Upper bound for sticky card height (px); also scales softly with viewport when available. */
const STICKY_MAX_H = 920;

/** Dynamic cap: keeps long notes readable without dominating the whole screen. */
export function getStickyHeightCapPx(): number {
  if (typeof window === "undefined") {
    return STICKY_MAX_H;
  }
  return Math.min(STICKY_MAX_H, Math.max(520, Math.round(window.innerHeight * 0.45)));
}

/**
 * Estimated total card height (px) for a sticky with given outer width and text content.
 * Matches `.converge-canvas__sticky-input` typography.
 */
export function estimateStickyHeightPx(text: string, cardWidthPx: number): number {
  const cap = getStickyHeightCapPx();
  const w = Math.max(120, cardWidthPx);
  if (typeof document === "undefined") {
    return Math.min(cap, Math.max(STICKY_MIN_H, 140));
  }
  const innerW = Math.max(48, w - STICKY_CARD_PAD);
  const el = document.createElement("div");
  el.setAttribute("aria-hidden", "true");
  el.style.cssText = [
    "position:fixed",
    "left:-99999px",
    "top:0",
    `width:${innerW}px`,
    "box-sizing:border-box",
    "white-space:pre-wrap",
    "word-break:break-word",
    'font-family:"Space Grotesk",system-ui,sans-serif',
    "font-size:16px",
    "line-height:1.4",
    "visibility:hidden",
    "pointer-events:none",
  ].join(";");
  const t = text.length === 0 ? "\u00a0" : text;
  el.textContent = t;
  document.body.appendChild(el);
  const innerTextH = Math.max(el.scrollHeight, 22);
  document.body.removeChild(el);
  const total = STICKY_CARD_PAD + innerTextH;
  return Math.min(cap, Math.max(STICKY_MIN_H, Math.round(total)));
}

/** Total outer height from a measured textarea `scrollHeight` (inner) + card padding. */
export function stickyHeightFromTextareaScrollPx(scrollHeightPx: number): number {
  const cap = getStickyHeightCapPx();
  const inner = Math.max(22, scrollHeightPx);
  const total = STICKY_CARD_PAD + inner;
  return Math.min(cap, Math.max(STICKY_MIN_H, Math.round(total)));
}
