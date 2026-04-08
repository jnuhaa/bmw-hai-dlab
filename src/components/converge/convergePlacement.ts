/** Axis-aligned rect in world/canvas space. */
export type AxisAlignedRect = { x: number; y: number; width: number; height: number };

const DEFAULT_MARGIN = 20;

function padRect(r: AxisAlignedRect, margin: number): AxisAlignedRect {
  return {
    x: r.x - margin,
    y: r.y - margin,
    width: r.width + margin * 2,
    height: r.height + margin * 2,
  };
}

/** True if expanded-by-margin rects overlap. */
export function rectsIntersect(a: AxisAlignedRect, b: AxisAlignedRect, margin: number): boolean {
  const ap = padRect(a, margin);
  const bp = padRect(b, margin);
  return !(ap.x + ap.width <= bp.x || bp.x + bp.width <= ap.x || ap.y + ap.height <= bp.y || bp.y + bp.height <= ap.y);
}

/**
 * Finds a position for `width`×`height` near `preferred` that does not intersect any obstacle (with margin).
 */
export function findNonOverlappingPosition(
  preferred: { x: number; y: number },
  width: number,
  height: number,
  obstacles: AxisAlignedRect[],
  margin: number = DEFAULT_MARGIN,
): { x: number; y: number } {
  const test = (x: number, y: number) => {
    const r: AxisAlignedRect = { x, y, width, height };
    return !obstacles.some((o) => rectsIntersect(r, o, margin));
  };
  if (test(preferred.x, preferred.y)) {
    return { x: preferred.x, y: preferred.y };
  }
  const step = 48;
  for (let ring = 1; ring <= 60; ring++) {
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.abs(dx) !== ring && Math.abs(dy) !== ring) {
          continue;
        }
        const x = preferred.x + dx * step;
        const y = preferred.y + dy * step;
        if (test(x, y)) {
          return { x, y };
        }
      }
    }
  }
  return { x: preferred.x, y: preferred.y + step * 40 };
}

/**
 * Shifts all rects down by multiples of `step` until none intersect obstacles (or max steps).
 * Returns the delta Y to apply to the cluster.
 */
export function findClusterVerticalShift(
  rects: AxisAlignedRect[],
  obstacles: AxisAlignedRect[],
  margin: number = DEFAULT_MARGIN,
  maxSteps = 100,
  step = 48,
): number {
  if (rects.length === 0) {
    return 0;
  }
  for (let s = 0; s < maxSteps; s++) {
    const dy = s * step;
    const shifted = rects.map((r) => ({ ...r, y: r.y + dy }));
    const hit = shifted.some((r) => obstacles.some((o) => rectsIntersect(r, o, margin)));
    if (!hit) {
      return dy;
    }
  }
  return 0;
}
