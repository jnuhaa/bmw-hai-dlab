/** Padding included in card `width`/`height` (box-sizing: border-box): 20px each side for stickies. */
export const STICKY_CARD_PAD = 40;
const STICKY_MIN_H = 88;
/** Hard ceiling so a single note cannot cover the entire viewport. */
const STICKY_ABSOLUTE_MAX_H = 1600;

/** Soft cap for auto-grow; conclusions and long agent notes may use full scroll height up to this. */
export function getStickyHeightCapPx(): number {
  if (typeof window === "undefined") {
    return 960;
  }
  return Math.min(STICKY_ABSOLUTE_MAX_H, Math.max(720, Math.round(window.innerHeight * 0.82)));
}

function measureInnerTextHeightPx(text: string, innerWidthPx: number): number {
  if (typeof document === "undefined") {
    return 22;
  }
  const el = document.createElement("div");
  el.setAttribute("aria-hidden", "true");
  el.style.cssText = [
    "position:fixed",
    "left:-99999px",
    "top:0",
    `width:${innerWidthPx}px`,
    "box-sizing:border-box",
    "white-space:pre-wrap",
    "word-break:break-word",
    'font-family:"Space Grotesk",system-ui,sans-serif',
    "font-size:16px",
    "line-height:1.4",
    "visibility:hidden",
    "pointer-events:none",
  ].join(";");
  el.textContent = text.length === 0 ? "\u00a0" : text;
  document.body.appendChild(el);
  const innerTextH = Math.max(el.scrollHeight, 22);
  document.body.removeChild(el);
  return innerTextH;
}

/**
 * Estimated total card height (px) for a sticky with given outer width and text content.
 * Matches `.converge-canvas__sticky-input` typography.
 */
export function estimateStickyHeightPx(text: string, cardWidthPx: number): number {
  const w = Math.max(120, cardWidthPx);
  const innerW = Math.max(48, w - STICKY_CARD_PAD);
  const innerTextH = measureInnerTextHeightPx(text, innerW);
  return stickyTotalHeightFromInnerPx(innerTextH);
}

/** Total outer height from a measured textarea `scrollHeight` (inner) + card padding. */
export function stickyHeightFromTextareaScrollPx(scrollHeightPx: number): number {
  return stickyTotalHeightFromInnerPx(Math.max(22, scrollHeightPx));
}

export function stickyTotalHeightFromInnerPx(innerTextH: number): number {
  const cap = getStickyHeightCapPx();
  const total = STICKY_CARD_PAD + innerTextH;
  return Math.min(cap, Math.max(STICKY_MIN_H, Math.round(total)));
}

/** True when content exceeds the auto-grow cap (enable in-sticky scrolling). */
export function isStickyTextClamped(text: string, cardWidthPx: number): boolean {
  const w = Math.max(120, cardWidthPx);
  const innerW = Math.max(48, w - STICKY_CARD_PAD);
  const innerTextH = measureInnerTextHeightPx(text, innerW);
  return STICKY_CARD_PAD + innerTextH > getStickyHeightCapPx() + 2;
}
