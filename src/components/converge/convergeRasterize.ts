import type { CanvasItem, CanvasPathItem } from "./convergeTypes";
import { getWorldXY } from "./convergeWorld";

const PADDING = 10;
const MAX_DIMENSION = 1024;
const COMPOSITE_MAX_WIDTH = 2048;

/** Paths explicitly selected plus all paths inside any selected frame. */
export function collectPathsForStylize(selectedItems: CanvasItem[], allItems: CanvasItem[]): CanvasPathItem[] {
  const seen = new Set<string>();
  const out: CanvasPathItem[] = [];

  for (const it of selectedItems) {
    if (it.type === "path") {
      if (!seen.has(it.id)) {
        seen.add(it.id);
        out.push(it);
      }
    } else if (it.type === "frame") {
      for (const c of allItems) {
        if (c.type === "path" && "parentId" in c && c.parentId === it.id && !seen.has(c.id)) {
          seen.add(c.id);
          out.push(c);
        }
      }
    }
  }
  return out;
}

/**
 * Rasterize path strokes to PNG base64 (no data URL prefix).
 * Returns null if nothing drawable.
 */
export function rasterizePathsToPngBase64(paths: CanvasPathItem[], items: CanvasItem[]): string | null {
  if (paths.length === 0) {
    return null;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let hasPoint = false;

  for (const path of paths) {
    const origin = getWorldXY(path, items);
    for (const stroke of path.strokes) {
      for (const p of stroke) {
        const wx = origin.x + p.x;
        const wy = origin.y + p.y;
        minX = Math.min(minX, wx);
        minY = Math.min(minY, wy);
        maxX = Math.max(maxX, wx);
        maxY = Math.max(maxY, wy);
        hasPoint = true;
      }
    }
  }

  if (!hasPoint || !Number.isFinite(minX)) {
    return null;
  }

  minX -= PADDING;
  minY -= PADDING;
  maxX += PADDING;
  maxY += PADDING;

  const worldW = Math.max(1, maxX - minX);
  const worldH = Math.max(1, maxY - minY);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(worldW, worldH));
  const cw = Math.ceil(worldW * scale);
  const ch = Math.ceil(worldH * scale);

  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, cw, ch);
  ctx.lineWidth = Math.max(2, (8 / 3) * scale);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const path of paths) {
    const origin = getWorldXY(path, items);
    const resolveColor = (c: string) => {
      if (c.startsWith("var(")) {
        return getComputedStyle(document.documentElement).getPropertyValue(c.slice(4, -1)).trim() || "#1a1a1a";
      }
      return c;
    };
    ctx.strokeStyle = resolveColor(path.color || "#1a1a1a");

    for (const stroke of path.strokes) {
      if (stroke.length < 2) {
        continue;
      }
      ctx.beginPath();
      const first = stroke[0]!;
      ctx.moveTo((origin.x + first.x - minX) * scale, (origin.y + first.y - minY) * scale);
      for (let i = 1; i < stroke.length; i++) {
        const p = stroke[i]!;
        ctx.lineTo((origin.x + p.x - minX) * scale, (origin.y + p.y - minY) * scale);
      }
      ctx.stroke();
    }
  }

  const dataUrl = canvas.toDataURL("image/png");
  const b64 = dataUrl.split(",")[1];
  return b64 ?? null;
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image for composite"));
    img.src = src;
  });
}

/**
 * Side-by-side composite: sketch (left) + reference image (right). PNG base64, no prefix.
 */
export async function compositeSketchAndReferencePngBase64(
  sketchPngBase64: string,
  referenceDataUrl: string,
): Promise<string> {
  const sketchImg = await loadImageElement(`data:image/png;base64,${sketchPngBase64}`);
  const refImg = await loadImageElement(referenceDataUrl);

  const gap = 12;
  const naturalW = sketchImg.width + gap + refImg.width;
  const naturalH = Math.max(sketchImg.height, refImg.height);
  const scale = naturalW > COMPOSITE_MAX_WIDTH ? COMPOSITE_MAX_WIDTH / naturalW : 1;
  const w = Math.ceil(naturalW * scale);
  const h = Math.ceil(naturalH * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D unavailable");
  }

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);

  const sw = sketchImg.width * scale;
  const rw = refImg.width * scale;
  const sh = sketchImg.height * scale;
  const rh = refImg.height * scale;
  const ySketch = (h - sh) / 2;
  const yRef = (h - rh) / 2;
  const g = gap * scale;

  ctx.drawImage(sketchImg, 0, ySketch, sw, sh);
  ctx.drawImage(refImg, sw + g, yRef, rw, rh);

  const dataUrl = canvas.toDataURL("image/png");
  const b64 = dataUrl.split(",")[1];
  if (!b64) {
    throw new Error("Composite produced empty PNG");
  }
  return b64;
}
