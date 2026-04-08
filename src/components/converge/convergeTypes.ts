export type CanvasToolMode = "select" | "hand" | "draw" | "connect";

export type StickyRole = "default" | "insight" | "challenge" | "build" | "idea";

export type CanvasPoint = { x: number; y: number };

/** Figma-like frame: children use x,y relative to content area below the title bar (see FRAME_TITLE_HEIGHT). */
export type FrameVariant = "concept" | "sketch" | "ai_zone";

export type CanvasFrameItem = {
  id: string;
  type: "frame";
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  variant?: FrameVariant;
  /** When true, clip child nodes to the frame body (default true). */
  clipContent?: boolean;
};

export type CanvasStickyItem = {
  id: string;
  type: "sticky";
  x: number;
  y: number;
  width: number;
  height: number;
  content: string;
  role: StickyRole;
  parentId?: string;
};

export type CanvasImageItem = {
  id: string;
  type: "image";
  x: number;
  y: number;
  width: number;
  height: number;
  src: string;
  parentId?: string;
};

export type CanvasPathItem = {
  id: string;
  type: "path";
  x: number;
  y: number;
  width: number;
  height: number;
  strokes: CanvasPoint[][];
  color: string;
  /** SVG stroke width for visible ink (default 3 in UI). */
  strokeWidth?: number;
  parentId?: string;
};

export type CanvasItem = CanvasStickyItem | CanvasImageItem | CanvasPathItem | CanvasFrameItem;

export type CanvasConnection = {
  id: string;
  fromId: string;
  toId: string;
  color: string;
};

export type CanvasCamera = { x: number; y: number };
