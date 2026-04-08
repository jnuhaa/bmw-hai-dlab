import type {
  CanvasFrameItem,
  CanvasImageItem,
  CanvasItem,
  CanvasPathItem,
  CanvasStickyItem,
} from "./convergeTypes";

type CanvasChildItem = CanvasStickyItem | CanvasImageItem | CanvasPathItem;

/** Height of the frame title bar; child y is relative to the top of the content area below this bar. */
export const FRAME_TITLE_HEIGHT = 32;

export function isFrameItem(item: CanvasItem): item is CanvasFrameItem {
  return item.type === "frame";
}

export function getFrameById(items: CanvasItem[], id: string): CanvasFrameItem | undefined {
  const f = items.find((i) => i.id === id);
  return f?.type === "frame" ? f : undefined;
}

/** Top-left of the item in canvas (world) space. */
export function getWorldXY(item: CanvasItem, items: CanvasItem[]): { x: number; y: number } {
  if (item.type === "frame") {
    return { x: item.x, y: item.y };
  }
  const child = item as CanvasChildItem;
  const pid = child.parentId;
  if (!pid) {
    return { x: child.x, y: child.y };
  }
  const parent = getFrameById(items, pid);
  if (!parent) {
    return { x: child.x, y: child.y };
  }
  return {
    x: parent.x + child.x,
    y: parent.y + FRAME_TITLE_HEIGHT + child.y,
  };
}

export function getWorldRect(
  item: CanvasItem,
  items: CanvasItem[],
): { x: number; y: number; width: number; height: number } {
  const w = item.width || 220;
  const h = item.height || 160;
  const { x, y } = getWorldXY(item, items);
  return { x, y, width: w, height: h };
}

export function getWorldBottomAnchor(item: CanvasItem, items: CanvasItem[]): { x: number; y: number } {
  const r = getWorldRect(item, items);
  return { x: r.x + r.width / 2, y: r.y + r.height };
}

export function getWorldTopAnchor(item: CanvasItem, items: CanvasItem[]): { x: number; y: number } {
  const r = getWorldRect(item, items);
  return { x: r.x + r.width / 2, y: r.y };
}

/** Inner drawable area of a frame (below the title bar), in world space. */
export function getFrameContentRectWorld(frame: CanvasFrameItem) {
  return {
    x: frame.x,
    y: frame.y + FRAME_TITLE_HEIGHT,
    width: frame.width,
    height: Math.max(0, frame.height - FRAME_TITLE_HEIGHT),
  };
}

function rectFullyInside(
  inner: { x: number; y: number; width: number; height: number },
  outer: { x: number; y: number; width: number; height: number },
) {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/**
 * For items with a frame parent: if their world bounds are not fully inside the frame body, detach to world coords.
 */
export function detachChildrenOutsideFrameBodies(items: CanvasItem[]): CanvasItem[] {
  return items.map((item) => {
    if (item.type === "frame" || !("parentId" in item) || !item.parentId) {
      return item;
    }
    const parent = getFrameById(items, item.parentId);
    if (!parent) {
      return item;
    }
    const content = getFrameContentRectWorld(parent);
    const wr = getWorldRect(item, items);
    if (rectFullyInside(wr, content)) {
      return item;
    }
    const { parentId: _pid, ...rest } = item as CanvasChildItem;
    return { ...rest, x: wr.x, y: wr.y } as CanvasItem;
  });
}

/** Minimum outer frame size (width × height including title bar). */
export const FRAME_MIN_OUTER_WIDTH = 180;
/** Keeps at least ~64px of content height below the title bar. */
export const FRAME_MIN_OUTER_HEIGHT = FRAME_TITLE_HEIGHT + 64;

/**
 * After a drag, re-evaluate frame nesting: an item nests in the topmost frame (later in `items` = higher z)
 * whose content rect contains the item's world bounding-box center; otherwise it is un-nested to world coords.
 */
export function applyFrameDropNesting(items: CanvasItem[]): CanvasItem[] {
  const frameOrder: CanvasFrameItem[] = [];
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it?.type === "frame") {
      frameOrder.push(it);
    }
  }
  if (frameOrder.length === 0) {
    return items;
  }

  return items.map((item) => {
    if (item.type === "frame") {
      return item;
    }

    const wr = getWorldRect(item, items);
    const cx = wr.x + wr.width / 2;
    const cy = wr.y + wr.height / 2;

    let target: CanvasFrameItem | null = null;
    for (const f of frameOrder) {
      const cr = getFrameContentRectWorld(f);
      if (
        cx >= cr.x &&
        cx <= cr.x + cr.width &&
        cy >= cr.y &&
        cy <= cr.y + cr.height
      ) {
        target = f;
        break;
      }
    }

    const relX = target ? wr.x - target.x : wr.x;
    const relY = target ? wr.y - target.y - FRAME_TITLE_HEIGHT : wr.y;

    if (!target) {
      if ("parentId" in item && item.parentId) {
        const { parentId: _pid, ...rest } = item as CanvasChildItem;
        return { ...rest, x: wr.x, y: wr.y } as CanvasItem;
      }
      return item;
    }

    if ("parentId" in item && item.parentId === target.id) {
      return { ...item, x: relX, y: relY };
    }

    return { ...item, parentId: target.id, x: relX, y: relY } as CanvasItem;
  });
}
