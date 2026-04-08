import type { CollabReflectionPhase } from "../../services/canvasAiClient";

export type WorldBounds = { minX: number; minY: number; maxX: number; maxY: number };

function cornersToBounds(
  tl: { x: number; y: number },
  tr: { x: number; y: number },
  bl: { x: number; y: number },
  br: { x: number; y: number },
): WorldBounds {
  const xs = [tl.x, tr.x, bl.x, br.x];
  const ys = [tl.y, tr.y, bl.y, br.y];
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

/**
 * Visible canvas area in world coordinates from viewport corners (local CSS px).
 */
export function computeVisibleWorldBounds(
  canvasWidth: number,
  canvasHeight: number,
  screenToCanvas: (localX: number, localY: number) => { x: number; y: number },
): WorldBounds {
  const tl = screenToCanvas(0, 0);
  const tr = screenToCanvas(canvasWidth, 0);
  const bl = screenToCanvas(0, canvasHeight);
  const br = screenToCanvas(canvasWidth, canvasHeight);
  return cornersToBounds(tl, tr, bl, br);
}

function clampPoint(
  p: { x: number; y: number },
  bounds: WorldBounds,
  margin: number,
): { x: number; y: number } {
  return {
    x: Math.min(bounds.maxX - margin, Math.max(bounds.minX + margin, p.x)),
    y: Math.min(bounds.maxY - margin, Math.max(bounds.minY + margin, p.y)),
  };
}

/**
 * Translates (and optionally clamps) sketch strokes so they sit primarily inside the visible world rect.
 */
export function translateReflectionPhasesToFitViewport(
  phases: CollabReflectionPhase[],
  bounds: WorldBounds,
  margin: number,
): CollabReflectionPhase[] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ph of phases) {
    for (const stroke of ph.strokes) {
      for (const p of stroke) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
    }
  }
  if (!Number.isFinite(minX)) {
    return phases;
  }

  const innerMinX = bounds.minX + margin;
  const innerMaxX = bounds.maxX - margin;
  const innerMinY = bounds.minY + margin;
  const innerMaxY = bounds.maxY - margin;
  const bw = innerMaxX - innerMinX;
  const bh = innerMaxY - innerMinY;
  const bboxW = maxX - minX;
  const bboxH = maxY - minY;

  let dx = 0;
  let dy = 0;
  if (bboxW <= bw && bboxH <= bh) {
    if (minX < innerMinX) {
      dx = innerMinX - minX;
    }
    if (maxX + dx > innerMaxX) {
      dx = innerMaxX - maxX;
    }
    if (minY < innerMinY) {
      dy = innerMinY - minY;
    }
    if (maxY + dy > innerMaxY) {
      dy = innerMaxY - maxY;
    }
  } else {
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const vx = (innerMinX + innerMaxX) / 2;
    const vy = (innerMinY + innerMaxY) / 2;
    dx = vx - cx;
    dy = vy - cy;
  }

  const mapStroke = (stroke: { x: number; y: number }[]) =>
    stroke.map((p) => clampPoint({ x: p.x + dx, y: p.y + dy }, bounds, margin));

  return phases.map((ph) => ({
    ...ph,
    strokes: ph.strokes.map(mapStroke),
  }));
}
