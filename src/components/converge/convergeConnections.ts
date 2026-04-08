import type { CanvasConnection, CanvasItem } from "./convergeTypes";

function randomConnId() {
  return Math.random().toString(36).slice(2, 11);
}

/** Items that can be link sources/targets (aligned with Stylize selection rules). */
export function filterConnectableSourceIds(items: CanvasItem[], sourceIds: string[]): string[] {
  return sourceIds.filter((id) => {
    const it = items.find((i) => i.id === id);
    if (!it) {
      return false;
    }
    return it.type === "sticky" || it.type === "image" || it.type === "path" || it.type === "frame";
  });
}

/**
 * Adds edges from each source to `targetId`, deduping existing `fromId`/`toId` pairs (Stylize-style).
 */
export function mergeEdgesFromSourcesToTarget(
  prev: CanvasConnection[],
  sourceIds: string[],
  targetId: string,
  color = "var(--border-visible)",
): CanvasConnection[] {
  const keys = new Set(prev.map((c) => `${c.fromId}\0${c.toId}`));
  const next = [...prev];
  for (const fromId of sourceIds) {
    if (fromId === targetId) {
      continue;
    }
    const pair = `${fromId}\0${targetId}`;
    if (keys.has(pair)) {
      continue;
    }
    keys.add(pair);
    next.push({
      id: randomConnId(),
      fromId,
      toId: targetId,
      color,
    });
  }
  return next;
}
