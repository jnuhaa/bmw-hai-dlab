import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import type { BoardAsset } from "../../types/assets";
import {
  fetchCanvasAiStatus,
  requestCanvasBrainstormConclude,
  requestCanvasBrainstormTurn,
  requestCanvasCollab,
  requestCanvasGenerateImage,
  requestCanvasStylize,
} from "../../services/canvasAiClient";
import type { CollabReflectionPhase, StylizeIntent } from "../../services/canvasAiClient";
import { STYLIZE_WORKFLOW_PRESETS } from "./stylizeWorkflowPresets";
import type {
  CanvasConnection,
  CanvasFrameItem,
  CanvasImageItem,
  CanvasItem,
  CanvasPathItem,
  CanvasPoint,
  CanvasStickyItem,
  CanvasToolMode,
  StickyRole,
} from "./convergeTypes";
import {
  collectPathsForStylize,
  compositeSketchAndReferencePngBase64,
  rasterizePathsToPngBase64,
} from "./convergeRasterize";
import {
  applyFrameDropNesting,
  detachChildrenOutsideFrameBodies,
  FRAME_MIN_OUTER_HEIGHT,
  FRAME_MIN_OUTER_WIDTH,
  FRAME_TITLE_HEIGHT,
  getFrameById,
  getWorldBottomAnchor,
  getWorldRect,
  getWorldTopAnchor,
  getWorldXY,
} from "./convergeWorld";
import {
  IconCursor,
  IconFrame,
  IconHand,
  IconImage,
  IconPen,
  IconPlus,
  IconSelect,
  IconSparkle,
  IconSticky,
  IconWand,
} from "./ConvergeIcons";
import { animateAiCursorForStylize, runCollabReflectionSketchPlayback } from "./collabAiPlayback";
import { filterConnectableSourceIds, mergeEdgesFromSourcesToTarget } from "./convergeConnections";
import { computeVisibleWorldBounds, translateReflectionPhasesToFitViewport } from "./convergeCollabGeometry";
import {
  findClusterVerticalShift,
  findNonOverlappingPosition,
  type AxisAlignedRect,
} from "./convergePlacement";
import { estimateStickyHeightPx, stickyHeightFromTextareaScrollPx } from "./convergeStickyMeasure";

export const CONVERGE_ZOOM_MIN = 0.25;
export const CONVERGE_ZOOM_MAX = 2;
const IMAGE_SIZE_MIN = 48;
const BRAINSTORM_MAX_TURNS = 10;
const BRAINSTORM_MAX_IMAGES_PER_RUN = 2;

function randomId() {
  return Math.random().toString(36).slice(2, 11);
}

/** Equal ⅓ chance each; call once per Collab request and inject into the prompt so note tone matches the chip. */
function pickUniformCollabMainRole(): "insight" | "challenge" | "build" {
  const roles = ["insight", "challenge", "build"] as const;
  return roles[Math.floor(Math.random() * roles.length)];
}

function collabMainRoleInstruction(role: "insight" | "challenge" | "build"): string {
  switch (role) {
    case "insight":
      return "Synthesize what you see: name patterns and offer a clear, helpful observation.";
    case "challenge":
      return "Push back constructively: question assumptions, surface risks or gaps—direct but collegial.";
    case "build":
      return "Extend the work: additive ideas, bridges, or concrete next steps.";
    default:
      return "";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function typewriterStickyContent(
  stickyId: string,
  fullText: string,
  gen: number,
  genRef: MutableRefObject<number>,
  setItems: Dispatch<SetStateAction<CanvasItem[]>>,
  charMs = 22,
): Promise<void> {
  for (let i = 0; i <= fullText.length; i++) {
    if (gen !== genRef.current) {
      return;
    }
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== stickyId || it.type !== "sticky") {
          return it;
        }
        const slice = fullText.slice(0, i);
        const w = it.width || 220;
        return { ...it, content: slice, height: estimateStickyHeightPx(slice, w) };
      }),
    );
    await sleep(charMs);
  }
}

function runCollabPlaybackCancel(ref: MutableRefObject<(() => void) | null>) {
  const fn = ref.current;
  ref.current = null;
  if (typeof fn === "function") {
    fn();
  }
}

function findLastItem<T>(arr: T[], pred: (x: T) => boolean): T | undefined {
  for (let i = arr.length - 1; i >= 0; i--) {
    const el = arr[i];
    if (el !== undefined && pred(el)) {
      return el;
    }
  }
  return undefined;
}

function ConvergeStickyTextarea({
  item,
  onContentChange,
  onHeightSync,
}: {
  item: CanvasStickyItem;
  onContentChange: (id: string, content: string) => void;
  onHeightSync: (id: string, height: number) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const h = stickyHeightFromTextareaScrollPx(el.scrollHeight);
    if (Math.abs(h - (item.height ?? 0)) > 2) {
      onHeightSync(item.id, h);
    }
  }, [item.content, item.width, item.id, item.height, onHeightSync]);
  return (
    <textarea
      ref={ref}
      className="converge-canvas__sticky-input"
      value={item.content}
      onChange={(e) => onContentChange(item.id, e.target.value)}
      placeholder="Type something..."
      style={{ color: "inherit" }}
    />
  );
}

function normalizePath(
  strokesInput: CanvasPoint[][] | CanvasPoint[],
  color: string,
  strokeWidth = 4,
): CanvasPathItem | null {
  const strokes: CanvasPoint[][] = Array.isArray(strokesInput[0])
    ? (strokesInput as CanvasPoint[][])
    : [strokesInput as CanvasPoint[]];
  if (strokes.length === 0 || strokes.flat().length === 0) {
    return null;
  }
  const allPoints = strokes.flat();
  const minX = Math.min(...allPoints.map((p) => p.x));
  const minY = Math.min(...allPoints.map((p) => p.y));
  const maxX = Math.max(...allPoints.map((p) => p.x));
  const maxY = Math.max(...allPoints.map((p) => p.y));
  const padding = 10;
  return {
    id: randomId(),
    type: "path",
    x: minX - padding,
    y: minY - padding,
    width: Math.max(maxX - minX, 20) + padding * 2,
    height: Math.max(maxY - minY, 20) + padding * 2,
    strokes: strokes.map((s) => s.map((p) => ({ x: p.x - minX + padding, y: p.y - minY + padding }))),
    color,
    strokeWidth,
  };
}

function clampStrokePointsToFrame(strokes: CanvasPoint[][], fw: number, fh: number): CanvasPoint[][] {
  return strokes.map((stroke) =>
    stroke.map((p) => ({
      x: Math.max(0, Math.min(fw, p.x)),
      y: Math.max(0, Math.min(fh, p.y)),
    })),
  );
}

function normalizePathInFrameLocal(
  strokesInput: CanvasPoint[][],
  color: string,
  parentFrameId: string,
  strokeWidth = 4,
): CanvasPathItem | null {
  if (strokesInput.length === 0 || strokesInput.flat().length === 0) {
    return null;
  }
  const allPoints = strokesInput.flat();
  const minX = Math.min(...allPoints.map((p) => p.x));
  const minY = Math.min(...allPoints.map((p) => p.y));
  const maxX = Math.max(...allPoints.map((p) => p.x));
  const maxY = Math.max(...allPoints.map((p) => p.y));
  const padding = 10;
  return {
    id: randomId(),
    type: "path",
    parentId: parentFrameId,
    x: minX - padding,
    y: minY - padding,
    width: Math.max(maxX - minX, 20) + padding * 2,
    height: Math.max(maxY - minY, 20) + padding * 2,
    strokes: strokesInput.map((s) => s.map((p) => ({ x: p.x - minX + padding, y: p.y - minY + padding }))),
    color,
    strokeWidth,
  };
}

/** Brainstorm sketches use frame-local model coords; playback + cursor use world space. */
function frameLocalReflectionPhasesToWorld(
  phases: CollabReflectionPhase[],
  frame: CanvasFrameItem,
): CollabReflectionPhase[] {
  const ox = frame.x;
  const oy = frame.y + FRAME_TITLE_HEIGHT;
  return phases.map((ph) => ({
    thought: ph.thought,
    strokes: (ph.strokes ?? []).map((stroke) =>
      stroke.map((p) => ({ x: ox + p.x, y: oy + p.y })),
    ),
  }));
}

function buildBrainstormTurnPrompt(params: {
  instructions: string;
  transcript: { persona: "A" | "B"; role: "insight" | "challenge" | "build"; text: string }[];
  turnIndex: number;
  maxTurns: number;
  persona: "A" | "B";
  assignedRole: "insight" | "challenge" | "build";
  frameContentW: number;
  frameContentH: number;
}): string {
  const label = params.persona === "A" ? "Alpha" : "Beta";
  const personaBlock =
    params.persona === "A"
      ? "You are Agent Alpha: divergent, provocative, asks what-if, surfaces alternatives."
      : "You are Agent Beta: integrative, builds on the prior turn, connects ideas, grounds directions.";
  const roleLine = collabMainRoleInstruction(params.assignedRole);

  const history =
    params.transcript.length === 0
      ? "(no prior turns yet)"
      : params.transcript
          .map(
            (t) =>
              `[${t.persona === "A" ? "Alpha" : "Beta"} · ${t.role}] ${t.text}`,
          )
          .join("\n");

  return `
${personaBlock}
Turn ${params.turnIndex + 1} of ${params.maxTurns}. Do not write a final synthesis yet—only this turn's contribution.
Assigned stance for this turn (you MUST set JSON "role" to exactly "${params.assignedRole}" and write the main note in this voice):
- ${params.assignedRole}: ${roleLine}

Frame drawable area for strokes (local coordinates): width=${params.frameContentW}, height=${params.frameContentH}. Origin is top-left of the content area below the frame title. Keep stroke coordinates within 0..width and 0..height.

Briefing / instructions from the board:
${params.instructions.trim() || "(none)"}

Transcript so far:
${history}

Respond with JSON only. Set agent_label to "${label}". Set JSON "role" to "${params.assignedRole}" exactly.
`.trim();
}

function buildBrainstormConcludePrompt(
  transcript: { persona: "A" | "B"; role: "insight" | "challenge" | "build"; text: string }[],
): string {
  const history = transcript
    .map((t) => `[${t.persona === "A" ? "Alpha" : "Beta"} · ${t.role}] ${t.text}`)
    .join("\n");
  return `
Summarize the brainstorm and agree on ONE direction, final concept, or next step based only on the discussion below.
Transcript:
${history}
`.trim();
}

function maxFrameChildBottomY(itemsList: CanvasItem[], frameId: string): number {
  let m = 0;
  for (const i of itemsList) {
    if ("parentId" in i && i.parentId === frameId) {
      m = Math.max(m, i.y + (i.height ?? 0));
    }
  }
  return m;
}

function getBottomAnchor(item: CanvasItem) {
  const w = item.width || 220;
  const h = item.height || 160;
  return { x: item.x + w / 2, y: item.y + h };
}

function getTopAnchor(item: CanvasItem) {
  const w = item.width || 220;
  return { x: item.x + w / 2, y: item.y };
}

export type ConvergeCanvasProps = {
  moodboardAssets: BoardAsset[];
  cameraZoom: number;
  onCameraZoomChange: (zoom: number) => void;
  stylizePresetIndex: number;
  onStylizePresetIndexChange: (index: number) => void;
  /** Board state is owned by the parent (e.g. CurateScreen) to persist across stage changes. */
  items: CanvasItem[];
  onItemsChange: Dispatch<SetStateAction<CanvasItem[]>>;
  connections: CanvasConnection[];
  onConnectionsChange: Dispatch<SetStateAction<CanvasConnection[]>>;
  boardCamera: { x: number; y: number };
  onBoardCameraChange: Dispatch<SetStateAction<{ x: number; y: number }>>;
  selectedIds: string[];
  onSelectedIdsChange: Dispatch<SetStateAction<string[]>>;
  toolMode: CanvasToolMode;
  onToolModeChange: Dispatch<SetStateAction<CanvasToolMode>>;
  drawColor: string;
  onDrawColorChange: Dispatch<SetStateAction<string>>;
};

export function ConvergeCanvas({
  moodboardAssets,
  cameraZoom,
  onCameraZoomChange,
  stylizePresetIndex,
  onStylizePresetIndexChange,
  items,
  onItemsChange: setItems,
  connections,
  onConnectionsChange: setConnections,
  boardCamera,
  onBoardCameraChange: setCamera,
  selectedIds,
  onSelectedIdsChange: setSelectedIds,
  toolMode: mode,
  onToolModeChange: setMode,
  drawColor,
  onDrawColorChange: setDrawColor,
}: ConvergeCanvasProps) {
  const camera = boardCamera;
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [lastPointerPos, setLastPointerPos] = useState({ x: 0, y: 0 });
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionBox, setSelectionBox] = useState({ startX: 0, startY: 0, endX: 0, endY: 0 });
  const selectionStartRef = useRef({ startX: 0, startY: 0 });
  const [isProcessing, setIsProcessing] = useState(false);
  const [aiStatus, setAiStatus] = useState("");
  const [aiCursor, setAiCursor] = useState({ x: -100, y: -100, visible: false, message: "" });
  /** Multi-stroke draw session (committed when leaving draw mode). */
  const drawSessionRef = useRef<{ draft: CanvasPoint[][]; active: CanvasPoint[] | null }>({
    draft: [],
    active: null,
  });
  const [drawUiNonce, setDrawUiNonce] = useState(0);
  const bumpDrawUi = () => setDrawUiNonce((n) => n + 1);
  const [hoveredPathId, setHoveredPathId] = useState<string | null>(null);
  const [aiDrawingPath, setAiDrawingPath] = useState<CanvasPoint[] | null>(null);
  const [completedAiStrokes, setCompletedAiStrokes] = useState<CanvasPoint[][]>([]);
  const [connectingState, setConnectingState] = useState<{
    fromId: string;
    currentX: number;
    currentY: number;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const seededRef = useRef(false);
  const itemsRef = useRef<CanvasItem[]>([]);
  itemsRef.current = items;
  /** From GET /api/canvas/status — false means no Gemini key (Collab demo JSON). */
  const [serverCollabConfigured, setServerCollabConfigured] = useState<boolean | null>(null);
  const [serverStylizeConfigured, setServerStylizeConfigured] = useState<boolean | null>(null);
  const collabGenRef = useRef(0);
  const collabFetchAbortRef = useRef<AbortController | null>(null);
  const [collabBusy, setCollabBusy] = useState(false);
  const brainstormGenRef = useRef(0);
  const brainstormAbortRef = useRef<AbortController | null>(null);
  const [brainstormBusy, setBrainstormBusy] = useState(false);
  const brainstormPlaybackCancelRef = useRef<(() => void) | null>(null);
  const collabPlaybackCancelRef = useRef<(() => void) | null>(null);
  const collabLayoutTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stylizeAnimCancelRef = useRef<(() => void) | null>(null);
  const [stylizeWorkflowMenuOpen, setStylizeWorkflowMenuOpen] = useState(false);
  const stylizeClusterRef = useRef<HTMLDivElement>(null);
  const resizeSessionRef = useRef<{
    id: string;
    kind: "image" | "frame";
    worldLeft: number;
    worldTop: number;
    startW: number;
    startH: number;
    aspect: number;
    lockAspect: boolean;
  } | null>(null);
  /** Selection when entering draw mode — used to connect arrows to a committed sketch (selection clears on first stroke). */
  const drawConnectionSourcesRef = useRef<string[]>([]);
  const prevToolModeForDrawRef = useRef<CanvasToolMode>(mode);

  const effectiveMode: CanvasToolMode = isSpacePressed ? "hand" : mode;

  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const cameraZoomRef = useRef(cameraZoom);
  cameraZoomRef.current = cameraZoom;

  useEffect(() => {
    const was = prevToolModeForDrawRef.current;
    prevToolModeForDrawRef.current = mode;
    if (mode === "draw" && was !== "draw") {
      drawConnectionSourcesRef.current = filterConnectableSourceIds(itemsRef.current, selectedIds);
    }
  }, [mode, selectedIds]);

  const prevModeRef = useRef<CanvasToolMode>(mode);
  useEffect(() => {
    const prev = prevModeRef.current;
    prevModeRef.current = mode;
    if (prev !== "draw" || mode === "draw") {
      return;
    }
    const { draft, active } = drawSessionRef.current;
    const strokes: CanvasPoint[][] = [...draft];
    if (active && active.length > 1) {
      strokes.push(active);
    }
    const filtered = strokes.filter((s) => s.length > 1);
    drawSessionRef.current = { draft: [], active: null };
    setDrawUiNonce((n) => n + 1);
    if (filtered.length === 0) {
      return;
    }
    const normalized = normalizePath(filtered, drawColor);
    if (normalized) {
      const sources = drawConnectionSourcesRef.current;
      drawConnectionSourcesRef.current = [];
      setItems((prev) => [...prev, normalized]);
      if (sources.length > 0) {
        setConnections((prev) => mergeEdgesFromSourcesToTarget(prev, sources, normalized.id));
      }
    }
  }, [mode, drawColor, setConnections]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) {
      return;
    }
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) {
        return;
      }
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;
      const z0 = cameraZoomRef.current;
      const cam = cameraRef.current;
      const worldX = (localX - cam.x) / z0;
      const worldY = (localY - cam.y) / z0;
      const delta = -e.deltaY * 0.002;
      const z1 = Math.min(CONVERGE_ZOOM_MAX, Math.max(CONVERGE_ZOOM_MIN, z0 + delta));
      if (z1 === z0) {
        return;
      }
      onCameraZoomChange(z1);
      setCamera({
        x: cam.x + worldX * (z0 - z1),
        y: cam.y + worldY * (z0 - z1),
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [onCameraZoomChange]);

  useEffect(() => {
    void fetchCanvasAiStatus().then((s) => {
      setServerCollabConfigured(s.collabConfigured);
      setServerStylizeConfigured(s.stylizeConfigured);
    });
  }, []);

  useEffect(() => {
    if (!stylizeWorkflowMenuOpen) {
      return;
    }
    const onDocMouseDown = (e: MouseEvent) => {
      if (stylizeClusterRef.current?.contains(e.target as Node)) {
        return;
      }
      setStylizeWorkflowMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [stylizeWorkflowMenuOpen]);

  useEffect(() => {
    return () => {
      runCollabPlaybackCancel(collabPlaybackCancelRef);
      if (collabLayoutTimeoutRef.current != null) {
        window.clearTimeout(collabLayoutTimeoutRef.current);
        collabLayoutTimeoutRef.current = null;
      }
      {
        const sf = stylizeAnimCancelRef.current;
        if (typeof sf === "function") {
          sf();
        }
        stylizeAnimCancelRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (moodboardAssets.length === 0) {
      return;
    }
    // Lifted state: on remount after a tab switch, parent still holds items — do not replace with moodboard seed.
    if (items.length > 0) {
      seededRef.current = true;
      return;
    }
    if (seededRef.current) {
      return;
    }
    seededRef.current = true;
    const gap = 24;
    const w = 200;
    const h = 150;
    const startX = 280;
    const startY = 260;
    const next: CanvasItem[] = moodboardAssets
      .filter((a) => a.imageUrl)
      .map((a, i) => ({
        id: `mb-${a.id}`,
        type: "image" as const,
        x: startX + i * (w + gap),
        y: startY,
        width: w,
        height: h,
        src: a.imageUrl!,
      }));
    if (next.length > 0) {
      setItems(next);
    }
  }, [moodboardAssets, items.length, setItems]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !["textarea", "input"].includes(document.activeElement?.tagName.toLowerCase() ?? "")) {
        e.preventDefault();
        setIsSpacePressed(true);
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        if (["textarea", "input"].includes(document.activeElement?.tagName.toLowerCase() ?? "")) {
          return;
        }
        if (selectedIds.length > 0) {
          const removed = new Set(selectedIds);
          setItems((prev) => {
            const removedFrameIds = new Set(
              prev.filter((i) => i.type === "frame" && removed.has(i.id)).map((i) => i.id),
            );
            return prev.flatMap((item): CanvasItem[] => {
              if (removed.has(item.id)) {
                return [];
              }
              if ("parentId" in item && item.parentId && removedFrameIds.has(item.parentId)) {
                const r = getWorldRect(item, prev);
                const { parentId: _pid, ...rest } = item;
                return [{ ...rest, x: r.x, y: r.y } as CanvasItem];
              }
              return [item];
            });
          });
          setConnections((prev) =>
            prev.filter((c) => !selectedIds.includes(c.fromId) && !selectedIds.includes(c.toId)),
          );
          setSelectedIds([]);
        }
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        setIsSpacePressed(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [selectedIds]);

  const screenToCanvas = useCallback(
    (localX: number, localY: number) => ({
      x: (localX - camera.x) / cameraZoom,
      y: (localY - camera.y) / cameraZoom,
    }),
    [camera, cameraZoom],
  );

  const updateItemContent = useCallback((id: string, newContent: string) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id || item.type !== "sticky") {
          return item;
        }
        const w = item.width || 220;
        return { ...item, content: newContent, height: estimateStickyHeightPx(newContent, w) };
      }),
    );
  }, []);

  const syncStickyHeightFromDom = useCallback((id: string, height: number) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id && item.type === "sticky" ? { ...item, height } : item)),
    );
  }, []);

  const updateFrameTitle = useCallback((id: string, title: string) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id && item.type === "frame" ? { ...item, title } : item)),
    );
  }, []);

  const addSticky = useCallback(() => {
    const el = canvasRef.current;
    const rect = el?.getBoundingClientRect();
    const localX = rect ? rect.width / 2 : window.innerWidth / 2;
    const localY = rect ? rect.height / 2 : window.innerHeight / 2;
    const pos = screenToCanvas(localX, localY);
    const newId = randomId();
    const sources = filterConnectableSourceIds(itemsRef.current, selectedIds);
    setItems((prev) => [
      ...prev,
      {
        id: newId,
        type: "sticky",
        x: pos.x - 110,
        y: pos.y - 80,
        width: 220,
        height: estimateStickyHeightPx("", 220),
        content: "",
        role: "default",
      },
    ]);
    if (sources.length > 0) {
      setConnections((prev) => mergeEdgesFromSourcesToTarget(prev, sources, newId));
    }
    setSelectedIds([newId]);
    setMode("select");
  }, [screenToCanvas, selectedIds, setConnections]);

  const groupSelection = useCallback(() => {
    const frameId = randomId();
    const selectionSnapshot = [...selectedIds];
    setItems((prev) => {
      const selected = prev.filter((i) => selectionSnapshot.includes(i.id) && i.type !== "frame");
      if (selected.length === 0) {
        return prev;
      }
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const el of selected) {
        const r = getWorldRect(el, prev);
        minX = Math.min(minX, r.x);
        minY = Math.min(minY, r.y);
        maxX = Math.max(maxX, r.x + r.width);
        maxY = Math.max(maxY, r.y + r.height);
      }
      const PAD = 16;
      const TH = FRAME_TITLE_HEIGHT;
      const frameX = minX - PAD;
      const frameY = minY - PAD - TH;
      const frameW = maxX - minX + 2 * PAD;
      const frameH = maxY - minY + 2 * PAD + TH;
      const newFrame: CanvasFrameItem = {
        id: frameId,
        type: "frame",
        x: frameX,
        y: frameY,
        width: frameW,
        height: frameH,
        title: "Frame",
        variant: "concept",
        clipContent: true,
      };
      const next = prev.map((item) => {
        if (!selectionSnapshot.includes(item.id) || item.type === "frame") {
          return item;
        }
        const r = getWorldRect(item, prev);
        const relX = r.x - frameX;
        const relY = r.y - frameY - TH;
        return { ...item, parentId: frameId, x: relX, y: relY };
      });
      return [...next, newFrame];
    });
    setSelectedIds([frameId]);
  }, [selectedIds]);

  const addEmptyFrame = useCallback(() => {
    const el = canvasRef.current;
    const rect = el?.getBoundingClientRect();
    const localX = rect ? rect.width / 2 - 200 : window.innerWidth / 2 - 200;
    const localY = rect ? rect.height / 2 - 140 : window.innerHeight / 2 - 140;
    const pos = screenToCanvas(localX, localY);
    const id = randomId();
    setItems((prev) => [
      ...prev,
      {
        id,
        type: "frame",
        x: pos.x,
        y: pos.y,
        width: 400,
        height: 280,
        title: "New frame",
        variant: "ai_zone",
        clipContent: true,
      },
    ]);
    setSelectedIds([id]);
  }, [screenToCanvas]);

  const applyFrame = useCallback(() => {
    const nestable = items.some((i) => selectedIds.includes(i.id) && i.type !== "frame");
    if (nestable) {
      groupSelection();
    } else {
      addEmptyFrame();
    }
  }, [items, selectedIds, groupSelection, addEmptyFrame]);

  const handleImageUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) {
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        const newId = randomId();
        const sources = filterConnectableSourceIds(itemsRef.current, selectedIds);
        const el = canvasRef.current;
        const rect = el?.getBoundingClientRect();
        const localX = rect ? rect.width / 2 : window.innerWidth / 2;
        const localY = rect ? rect.height / 2 : window.innerHeight / 2;
        const pos = screenToCanvas(localX, localY);
        const src = String(ev.target?.result ?? "");
        setItems((prev) => [
          ...prev,
          { id: newId, type: "image", x: pos.x - 100, y: pos.y - 75, src, width: 200, height: 150 },
        ]);
        if (sources.length > 0) {
          setConnections((prev) => mergeEdgesFromSourcesToTarget(prev, sources, newId));
        }
        setMode("select");
        setSelectedIds([newId]);
      };
      reader.readAsDataURL(file);
      e.target.value = "";
    },
    [screenToCanvas, selectedIds, setConnections],
  );

  const handlePointerDownCanvas = (e: React.PointerEvent) => {
    const el = canvasRef.current;
    if (!el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    const pos = screenToCanvas(e.clientX - rect.left, e.clientY - rect.top);

    if (effectiveMode === "hand") {
      setIsDragging(true);
      setLastPointerPos({ x: e.clientX, y: e.clientY });
    } else if (effectiveMode === "draw") {
      drawSessionRef.current.active = [{ x: pos.x, y: pos.y }];
      bumpDrawUi();
      setSelectedIds([]);
    } else if (effectiveMode === "select") {
      setIsSelecting(true);
      selectionStartRef.current = { startX: pos.x, startY: pos.y };
      setSelectionBox({ startX: pos.x, startY: pos.y, endX: pos.x, endY: pos.y });
      setSelectedIds([]);
    }
  };

  const handleResizePointerDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    e.preventDefault();
    const item = itemsRef.current.find((i) => i.id === id);
    if (!item || (item.type !== "image" && item.type !== "frame")) {
      return;
    }
    const el = canvasRef.current;
    if (!el) {
      return;
    }
    const w = item.width || 200;
    const h = item.height || 150;
    const world = getWorldXY(item, itemsRef.current);
    resizeSessionRef.current = {
      id,
      kind: item.type === "frame" ? "frame" : "image",
      worldLeft: world.x,
      worldTop: world.y,
      startW: w,
      startH: h,
      aspect: w / h,
      lockAspect: e.shiftKey,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerDownItem = (e: React.PointerEvent, id: string) => {
    if (effectiveMode === "select") {
      e.stopPropagation();
      if (!selectedIds.includes(id)) {
        setSelectedIds([id]);
      }
      setIsDragging(true);
      setLastPointerPos({ x: e.clientX, y: e.clientY });
      setItems((prev) => {
        const idx = prev.findIndex((i) => i.id === id);
        if (idx > -1 && prev[idx]?.type !== "path") {
          const newItems = [...prev];
          const [item] = newItems.splice(idx, 1);
          if (item) {
            newItems.push(item);
          }
          return newItems;
        }
        return prev;
      });
    } else if (effectiveMode === "connect") {
      e.stopPropagation();
      const el = canvasRef.current;
      if (!el) {
        return;
      }
      const rect = el.getBoundingClientRect();
      const pos = screenToCanvas(e.clientX - rect.left, e.clientY - rect.top);
      setConnectingState({ fromId: id, currentX: pos.x, currentY: pos.y });
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const el = canvasRef.current;
    if (!el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    const pos = screenToCanvas(e.clientX - rect.left, e.clientY - rect.top);

    const rs = resizeSessionRef.current;
    if (rs) {
      if (rs.kind === "image") {
        let newW = Math.max(IMAGE_SIZE_MIN, pos.x - rs.worldLeft);
        let newH = Math.max(IMAGE_SIZE_MIN, pos.y - rs.worldTop);
        if (rs.lockAspect) {
          const sw = pos.x - rs.worldLeft;
          const sh = pos.y - rs.worldTop;
          if (sw / rs.aspect > sh) {
            newW = Math.max(IMAGE_SIZE_MIN, sw);
            newH = Math.max(IMAGE_SIZE_MIN, newW / rs.aspect);
          } else {
            newH = Math.max(IMAGE_SIZE_MIN, sh);
            newW = Math.max(IMAGE_SIZE_MIN, newH * rs.aspect);
          }
        }
        setItems((prev) =>
          prev.map((item) => (item.id === rs.id && item.type === "image" ? { ...item, width: newW, height: newH } : item)),
        );
      } else {
        let newW = Math.max(FRAME_MIN_OUTER_WIDTH, pos.x - rs.worldLeft);
        let newH = Math.max(FRAME_MIN_OUTER_HEIGHT, pos.y - rs.worldTop);
        if (rs.lockAspect) {
          const sw = pos.x - rs.worldLeft;
          const sh = pos.y - rs.worldTop;
          if (sw / rs.aspect > sh) {
            newW = Math.max(FRAME_MIN_OUTER_WIDTH, sw);
            newH = Math.max(FRAME_MIN_OUTER_HEIGHT, newW / rs.aspect);
          } else {
            newH = Math.max(FRAME_MIN_OUTER_HEIGHT, sh);
            newW = Math.max(FRAME_MIN_OUTER_WIDTH, newH * rs.aspect);
          }
        }
        setItems((prev) =>
          prev.map((item) => (item.id === rs.id && item.type === "frame" ? { ...item, width: newW, height: newH } : item)),
        );
      }
      return;
    }

    if (effectiveMode === "hand" && isDragging) {
      const dx = e.clientX - lastPointerPos.x;
      const dy = e.clientY - lastPointerPos.y;
      setCamera((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
      setLastPointerPos({ x: e.clientX, y: e.clientY });
      return;
    }

    if (effectiveMode === "draw" && drawSessionRef.current.active) {
      const a = drawSessionRef.current.active;
      drawSessionRef.current.active = [...a, { x: pos.x, y: pos.y }];
      bumpDrawUi();
    } else if (connectingState) {
      setConnectingState((prev) => (prev ? { ...prev, currentX: pos.x, currentY: pos.y } : null));
    } else if (isDragging && selectedIds.length > 0) {
      const dx = e.clientX - lastPointerPos.x;
      const dy = e.clientY - lastPointerPos.y;
      setLastPointerPos({ x: e.clientX, y: e.clientY });
      const z = cameraZoom;
      const ddx = dx / z;
      const ddy = dy / z;
      const frameInSelection = selectedIds.some((id) => itemsRef.current.find((i) => i.id === id)?.type === "frame");
      setItems((prev) =>
        prev.map((item) => {
          if (!selectedIds.includes(item.id)) {
            return item;
          }
          if (frameInSelection) {
            if (item.type === "frame") {
              return { ...item, x: item.x + ddx, y: item.y + ddy };
            }
            return item;
          }
          return { ...item, x: item.x + ddx, y: item.y + ddy };
        }),
      );
    } else if (isSelecting) {
      const { startX, startY } = selectionStartRef.current;
      setSelectionBox({ startX, startY, endX: pos.x, endY: pos.y });
      const left = Math.min(startX, pos.x);
      const right = Math.max(startX, pos.x);
      const top = Math.min(startY, pos.y);
      const bottom = Math.max(startY, pos.y);
      const newSelectedIds = items
        .filter((item) => {
          const r = getWorldRect(item, items);
          return r.x < right && r.x + r.width > left && r.y < bottom && r.y + r.height > top;
        })
        .map((i) => i.id);
      setSelectedIds(newSelectedIds);
    }
  };

  const handlePointerUp = () => {
    resizeSessionRef.current = null;
    if (mode === "draw" && drawSessionRef.current.active) {
      const act = drawSessionRef.current.active;
      if (act.length > 1) {
        drawSessionRef.current.draft.push([...act]);
      }
      drawSessionRef.current.active = null;
      bumpDrawUi();
    }
    if (connectingState) {
      const target = findLastItem(itemsRef.current, (i) => {
        const r = getWorldRect(i, itemsRef.current);
        return (
          connectingState.currentX >= r.x &&
          connectingState.currentX <= r.x + r.width &&
          connectingState.currentY >= r.y &&
          connectingState.currentY <= r.y + r.height
        );
      });
      if (target && target.id !== connectingState.fromId) {
        setConnections((prev) => [
          ...prev,
          {
            id: randomId(),
            fromId: connectingState.fromId,
            toId: target.id,
            color: "var(--border-visible)",
          },
        ]);
      } else if (!target) {
        const newId = randomId();
        const w = 220;
        setItems((prev) => [
          ...prev,
          {
            id: newId,
            type: "sticky",
            x: connectingState.currentX - w / 2,
            y: connectingState.currentY,
            width: w,
            height: estimateStickyHeightPx("", w),
            content: "",
            role: "default",
          },
        ]);
        setConnections((prev) => [
          ...prev,
          {
            id: randomId(),
            fromId: connectingState.fromId,
            toId: newId,
            color: "var(--border-visible)",
          },
        ]);
        setSelectedIds([newId]);
        setMode("select");
      }
      setConnectingState(null);
    }
    if (isDragging && effectiveMode === "select") {
      setItems((prev) => applyFrameDropNesting(detachChildrenOutsideFrameBodies(prev)));
    }
    setIsDragging(false);
    setIsSelecting(false);
  };

  const handleStylize = async () => {
    const selectedItems = selectedIds
      .map((id) => items.find((i) => i.id === id))
      .filter((x): x is CanvasItem => Boolean(x));
    const stickies = selectedItems.filter((i): i is CanvasStickyItem => i.type === "sticky");
    const images = selectedItems.filter((i): i is CanvasImageItem => i.type === "image");
    const sketchPaths = collectPathsForStylize(selectedItems, items);
    const sketchBase64 =
      sketchPaths.length > 0 ? rasterizePathsToPngBase64(sketchPaths, items) : null;

    if (stickies.length === 0 && images.length === 0 && sketchPaths.length === 0) {
      return;
    }
    if (stickies.length > 1 || images.length > 1) {
      setAiStatus("Select one image and at most one sticky for Stylize.");
      window.setTimeout(() => setAiStatus(""), 5000);
      return;
    }
    if (sketchPaths.length > 0 && !sketchBase64) {
      setAiStatus("Could not rasterize sketch (empty or invalid paths).");
      window.setTimeout(() => setAiStatus(""), 5000);
      return;
    }

    const stylizeSourceIds = selectedIds.filter((id) => {
      const it = items.find((i) => i.id === id);
      return (
        it &&
        (it.type === "sticky" || it.type === "image" || it.type === "path" || it.type === "frame")
      );
    });

    const targetSticky = stickies[0];
    const targetImage = images[0];
    const hasSketch = Boolean(sketchBase64);

    const preset =
      STYLIZE_WORKFLOW_PRESETS[
        Math.min(stylizePresetIndex, STYLIZE_WORKFLOW_PRESETS.length - 1)
      ] ?? STYLIZE_WORKFLOW_PRESETS[0]!;

    {
      const sf = stylizeAnimCancelRef.current;
      if (typeof sf === "function") {
        sf();
      }
      stylizeAnimCancelRef.current = null;
    }

    setIsProcessing(true);
    setAiStatus(
      preset.dualOutput === "cinematic_angles" ? "STYLIZING (2 passes: cinematic + angles)…" : "STYLIZING ASSET...",
    );
    let deferProcessingEnd = false;
    try {
      const singleFrameOnly =
        selectedItems.length === 1 &&
        selectedItems[0]?.type === "frame" &&
        sketchPaths.length > 0;
      const referenceItem: CanvasItem =
        targetImage ?? targetSticky ?? (singleFrameOnly ? selectedItems[0]! : sketchPaths[0]!);
      let base64Png: string | null = null;
      let secondBase64Png: string | undefined;
      let responseWasMock = false;
      const refWorld = getWorldRect(referenceItem, items);

      let stylizeIntent: StylizeIntent;
      if (hasSketch && targetImage && targetSticky) {
        stylizeIntent = "hybrid";
      } else if (hasSketch && targetSticky && !targetImage) {
        stylizeIntent = "hybrid";
      } else if (hasSketch && targetImage && !targetSticky) {
        stylizeIntent = "image";
      } else if (hasSketch) {
        stylizeIntent = "image";
      } else if (targetImage && targetSticky) {
        stylizeIntent = "hybrid";
      } else if (targetImage) {
        stylizeIntent = "image";
      } else {
        stylizeIntent = "text";
      }

      const stylizeRequestBase = {
        workflowFile: preset.workflowFile,
        automotiveContext: preset.automotiveContext,
        intent: stylizeIntent,
        dualRender: preset.dualOutput === "cinematic_angles",
      };

      if (hasSketch && targetImage) {
        const combined = await compositeSketchAndReferencePngBase64(sketchBase64!, targetImage.src);
        const stickyPart = targetSticky
          ? `Concept: "${targetSticky.content}". `
          : "";
        const textPrompt = `${stickyPart}The composite pairs a hand sketch (left) with a reference image (right). Honor the sketch structure and reference content. Highly polished, modern conceptual illustration.`;
        const res = await requestCanvasStylize({
          mode: "image",
          textPrompt,
          mimeType: "image/png",
          base64Data: combined,
          ...stylizeRequestBase,
        });
        base64Png = res.base64Png;
        secondBase64Png = res.secondBase64Png;
        responseWasMock = Boolean(res.mock);
      } else if (hasSketch && targetSticky && !targetImage) {
        const textPrompt = `Transform this sketch based on this concept: "${targetSticky.content}". Make it a highly polished, modern conceptual illustration.`;
        const res = await requestCanvasStylize({
          mode: "image",
          textPrompt,
          mimeType: "image/png",
          base64Data: sketchBase64!,
          ...stylizeRequestBase,
        });
        base64Png = res.base64Png;
        secondBase64Png = res.secondBase64Png;
        responseWasMock = Boolean(res.mock);
      } else if (hasSketch && !targetSticky && !targetImage) {
        const textPrompt = `Stylize this hand sketch into a highly polished, modern 3D UI UX conceptual illustration. Preserve the sketch structure. Clean presentation.`;
        const res = await requestCanvasStylize({
          mode: "image",
          textPrompt,
          mimeType: "image/png",
          base64Data: sketchBase64!,
          ...stylizeRequestBase,
        });
        base64Png = res.base64Png;
        secondBase64Png = res.secondBase64Png;
        responseWasMock = Boolean(res.mock);
      } else if (targetImage) {
        const textPrompt = targetSticky
          ? `Transform this image based on this concept: "${targetSticky.content}". Make it a highly polished, modern conceptual illustration.`
          : `Stylize this image into a highly polished, modern 3D UI UX conceptual illustration.`;
        const mimeType = targetImage.src.split(";")[0]?.split(":")[1] ?? "image/png";
        const base64Data = targetImage.src.split(",")[1] ?? "";
        const res = await requestCanvasStylize({
          mode: "image",
          textPrompt,
          mimeType,
          base64Data,
          ...stylizeRequestBase,
        });
        base64Png = res.base64Png;
        secondBase64Png = res.secondBase64Png;
        responseWasMock = Boolean(res.mock);
      } else if (targetSticky) {
        const prompt = `A highly polished, modern 3D UI UX conceptual illustration representing: ${targetSticky.content}. Clean white background, dribbble style.`;
        const res = await requestCanvasStylize({
          mode: "text",
          textPrompt: prompt,
          ...stylizeRequestBase,
        });
        base64Png = res.base64Png;
        secondBase64Png = res.secondBase64Png;
        responseWasMock = Boolean(res.mock);
      }

      if (base64Png) {
        deferProcessingEnd = true;
        const targetX = refWorld.x + refWorld.width + 50;
        const targetY = refWorld.y;
        const hudMsg = responseWasMock
          ? secondBase64Png
            ? "DEMO PLACEHOLDER IMAGES (2)"
            : "DEMO PLACEHOLDER IMAGE"
          : secondBase64Png
            ? "GENERATING RENDERS (2)…"
            : "GENERATING ASSET...";
        const viewEl = canvasRef.current;
        const vr = viewEl?.getBoundingClientRect();
        stylizeAnimCancelRef.current = animateAiCursorForStylize(
          { width: vr?.width ?? window.innerWidth, height: vr?.height ?? window.innerHeight },
          { ...camera, zoom: cameraZoom },
          targetX,
          targetY,
          hudMsg,
          setAiCursor,
          () => {
            const imgH = 150;
            const imgGap = 16;
            const newImageId = randomId();
            const secondId = secondBase64Png ? randomId() : null;
            setItems((prev) => [
              ...prev,
              {
                id: newImageId,
                type: "image",
                x: targetX,
                y: targetY,
                src: `data:image/png;base64,${base64Png}`,
                width: 200,
                height: imgH,
              },
              ...(secondBase64Png && secondId
                ? [
                    {
                      id: secondId,
                      type: "image" as const,
                      x: targetX,
                      y: targetY + imgH + imgGap,
                      src: `data:image/png;base64,${secondBase64Png}`,
                      width: 200,
                      height: imgH,
                    },
                  ]
                : []),
            ]);
            const newIds = secondId ? [newImageId, secondId] : [newImageId];
            setConnections((prev) => {
              const keys = new Set(prev.map((c) => `${c.fromId}\0${c.toId}`));
              const next = [...prev];
              for (const toId of newIds) {
                for (const fromId of stylizeSourceIds) {
                  if (fromId === toId) continue;
                  const pair = `${fromId}\0${toId}`;
                  if (keys.has(pair)) continue;
                  keys.add(pair);
                  next.push({
                    id: randomId(),
                    fromId,
                    toId,
                    color: "var(--border-visible)",
                  });
                }
              }
              return next;
            });
            window.setTimeout(() => setAiCursor((c) => ({ ...c, visible: false })), 2000);
            if (responseWasMock) {
              setAiStatus("Demo: set EXTRACTION_PROVIDER=comfyui + Comfy in .env for real Stylize");
              window.setTimeout(() => setAiStatus(""), 6000);
            }
            setIsProcessing(false);
            stylizeAnimCancelRef.current = null;
          },
        );
      }
    } catch (err) {
      console.error(err);
      setAiStatus(err instanceof Error ? err.message.slice(0, 120) : "STYLIZE FAILED");
      window.setTimeout(() => setAiStatus(""), 6000);
    } finally {
      if (!deferProcessingEnd) {
        setIsProcessing(false);
      }
    }
  };

  const handleCollabStop = () => {
    collabFetchAbortRef.current?.abort();
    collabGenRef.current += 1;
    if (collabLayoutTimeoutRef.current != null) {
      window.clearTimeout(collabLayoutTimeoutRef.current);
      collabLayoutTimeoutRef.current = null;
    }
    runCollabPlaybackCancel(collabPlaybackCancelRef);
    setCollabBusy(false);
    setIsProcessing(false);
    setAiStatus("");
  };

  const handleBrainstormStop = () => {
    brainstormAbortRef.current?.abort();
    brainstormGenRef.current += 1;
    brainstormAbortRef.current = null;
    runCollabPlaybackCancel(brainstormPlaybackCancelRef);
    setBrainstormBusy(false);
    setIsProcessing(false);
    setAiStatus("");
  };

  const handleCollab = async () => {
    runCollabPlaybackCancel(collabPlaybackCancelRef);
    if (collabLayoutTimeoutRef.current != null) {
      window.clearTimeout(collabLayoutTimeoutRef.current);
      collabLayoutTimeoutRef.current = null;
    }
    collabFetchAbortRef.current?.abort();
    const abortController = new AbortController();
    collabFetchAbortRef.current = abortController;

    const myGen = ++collabGenRef.current;

    setCollabBusy(true);
    setIsProcessing(true);
    setAiStatus("Contacting collaborator…");

    try {
      const sourceIds = [...selectedIds];
      const textualBoardState = items.map((item) => {
        const r = getWorldRect(item, items);
        return {
          type: item.type,
          id: item.id,
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          content: item.type === "sticky" ? item.content : undefined,
          title: item.type === "frame" ? item.title : undefined,
          variant: item.type === "frame" ? item.variant : undefined,
        };
      });

      const canvasEl = canvasRef.current;
      const cRect = canvasEl?.getBoundingClientRect();
      const centerLocalX = cRect ? cRect.width / 2 : window.innerWidth / 2;
      const centerLocalY = cRect ? cRect.height / 2 : window.innerHeight / 2;
      const centerCanvas = screenToCanvas(centerLocalX, centerLocalY);
      let anchorX = centerCanvas.x;
      let anchorY = centerCanvas.y;
      if (sourceIds.length > 0) {
        const srcItem = items.find((i) => i.id === sourceIds[0]);
        if (srcItem) {
          const r = getWorldRect(srcItem, items);
          anchorX = r.x + r.width / 2;
          anchorY = r.y + r.height;
        }
      }

      const canvasW = cRect?.width ?? window.innerWidth;
      const canvasH = cRect?.height ?? window.innerHeight;
      const visibleWorldBounds = computeVisibleWorldBounds(canvasW, canvasH, screenToCanvas);

      const visionImageItems = items.filter(
        (i): i is CanvasImageItem => i.type === "image" && Boolean(i.src?.startsWith("data:image")),
      );
      const imageOverlayHints = visionImageItems.map((img) => {
        const r = getWorldRect(img, items);
        return { id: img.id, world_rect: { x: r.x, y: r.y, width: r.width, height: r.height } };
      });
      const spatialContext = {
        visible_world_rect: visibleWorldBounds,
        image_overlay_hints: imageOverlayHints,
      };

      const collabMainRole = pickUniformCollabMainRole();
      const collabRoleLine = collabMainRoleInstruction(collabMainRole);

      const prompt = `
        You are a colleague at the board: warm, concise, human-like.
        Current board state: ${JSON.stringify(textualBoardState)}

        Spatial context (canvas world coordinates; same system as reflection_phases strokes):
        ${JSON.stringify(spatialContext)}
        - Place strokes primarily inside visible_world_rect. When image_overlay_hints are present, you may draw strokes that overlap those rectangles to annotate or sketch on the reference images.

        Assigned stance for this response (chosen uniformly at random; you MUST set JSON "role" to exactly "${collabMainRole}" and write the main note in this voice):
        - ${collabMainRole}: ${collabRoleLine}

        Task: React naturally to what you see.
        - Include reading_reactions: 0–4 short spontaneous lines (curiosity, appreciation, etc.) while taking in the board.
        - One main note (note); keep it under ~25 words. It must read as the assigned stance above. Set "role" to "${collabMainRole}" exactly.
        - expansions: 0 to 3 short idea strings; you may output 0, 1, 2, or 3—not always three.
        - expansion_mode: "spread" (row of ideas below main) or "opposing" (first expansion is a counterpoint placed beside the main note; optional opposing_target_hint).
        - reflection_phases: 1–3 phases; each has thought and strokes in canvas coordinates.
        - annotation_phases (optional): 0–2 phases played after the main reflection sketch; lighter callout strokes (arrows, circles, emphasis) that annotate or clarify the idea—same coordinate system; keep strokes sparse and smaller in gesture than the main sketch. Omit or use [] if none.
        - Sketches must feel like designer concept exploration: gestural lines, simple volumes, frames, or flow—not only straight connectors between existing assets. Place strokes in open canvas space near your response (conceptual cluster), using curves and multiple strokes per phase.
        Output valid JSON only:
        {
          "reading_reactions": ["..."],
          "note": "...",
          "role": "${collabMainRole}",
          "expansions": [],
          "expansion_mode": "spread|opposing",
          "opposing_target_hint": "",
          "reflection_phases": [{ "thought": "...", "strokes": [[{"x":0,"y":0}]] }],
          "annotation_phases": []
        }
      `;

      const visionImages = visionImageItems.map((img) => ({
        mimeType: img.src.split(";")[0]?.split(":")[1] ?? "image/png",
        base64: img.src.split(",")[1] ?? "",
      }));

      const data = await requestCanvasCollab({
        prompt,
        images: visionImages,
        signal: abortController.signal,
      });

      if (myGen !== collabGenRef.current) {
        return;
      }

      const reactionLines =
        data.reading_reactions && data.reading_reactions.length > 0
          ? data.reading_reactions.slice(0, 4)
          : ["Taking in the board…"];
      for (const line of reactionLines) {
        if (myGen !== collabGenRef.current) {
          return;
        }
        for (let c = 0; c <= line.length; c++) {
          if (myGen !== collabGenRef.current) {
            return;
          }
          setAiStatus(line.slice(0, c));
          await sleep(18);
        }
        await sleep(1200);
      }

      if (myGen !== collabGenRef.current) {
        return;
      }
      setAiStatus("Placing response…");

      const note = data.note;
      const role: StickyRole = collabMainRole;
      const validatedExpansions = (data.expansions ?? [])
        .slice(0, 3)
        .map((s) => String(s).trim())
        .filter((s) => s.length > 0);
      const expansionMode = data.expansion_mode === "opposing" ? "opposing" : "spread";

      const cElViewport = canvasRef.current;
      const cRectViewport = cElViewport?.getBoundingClientRect();
      const viewW = cRectViewport?.width ?? window.innerWidth;
      const viewH = cRectViewport?.height ?? window.innerHeight;
      const visibleNow = computeVisibleWorldBounds(viewW, viewH, screenToCanvas);
      const reflectionPhases = translateReflectionPhasesToFitViewport(data.reflection_phases ?? [], visibleNow, 32);
      const annotationPhases = translateReflectionPhasesToFitViewport(data.annotation_phases ?? [], visibleNow, 32);
      const phase0 = reflectionPhases[0] ? [reflectionPhases[0]] : [];
      const restPhases = reflectionPhases.slice(1);

      const normalizeAnnotationPath = (strokes: CanvasPoint[][], color: string) =>
        normalizePath(strokes, color, 2.25);

      const mainId = randomId();
      const roleColors: Record<string, string> = {
        challenge: "var(--interrupt)",
        build: "var(--success)",
        insight: "var(--accent)",
      };

      const noteW = 240;
      const noteH = 140;
      const expW = 220;
      const verticalGap = 80;
      const horizontalGap = 40;

      const obstacleRects: AxisAlignedRect[] = items.map((i) => getWorldRect(i, items));
      const noteStr = String(note ?? "");
      const mainHEstimated = estimateStickyHeightPx(noteStr, noteW);
      let mainNoteX = anchorX - noteW / 2;
      let mainNoteY = anchorY + verticalGap;
      const placedMain = findNonOverlappingPosition({ x: mainNoteX, y: mainNoteY }, noteW, mainHEstimated, obstacleRects, 22);
      mainNoteX = placedMain.x;
      mainNoteY = placedMain.y;

      const buildClusterRectsForShift = (mx: number, my: number, mH: number): AxisAlignedRect[] => {
        const mainR: AxisAlignedRect = { x: mx, y: my, width: noteW, height: mH };
        if (validatedExpansions.length === 0) {
          return [mainR];
        }
        if (expansionMode === "opposing" && validatedExpansions.length >= 1) {
          const firstH = estimateStickyHeightPx(String(validatedExpansions[0] ?? ""), expW);
          const restTexts = validatedExpansions.slice(1);
          const mainBottom = my + mH;
          const rowY = mainBottom + verticalGap;
          const totalRestW = restTexts.length * expW + Math.max(0, restTexts.length - 1) * horizontalGap;
          const startRestX = anchorX - totalRestW / 2;
          const rects: AxisAlignedRect[] = [
            mainR,
            { x: mx + noteW + horizontalGap, y: my, width: expW, height: firstH },
          ];
          restTexts.forEach((t, i) => {
            rects.push({
              x: startRestX + i * (expW + horizontalGap),
              y: rowY,
              width: expW,
              height: estimateStickyHeightPx(String(t), expW),
            });
          });
          return rects;
        }
        const mainBottom = my + mH;
        const spreadY = mainBottom + verticalGap;
        const totalExpWidth =
          validatedExpansions.length * expW + Math.max(0, validatedExpansions.length - 1) * horizontalGap;
        const startExpX = anchorX - totalExpWidth / 2;
        return [
          mainR,
          ...validatedExpansions.map((t, i) => ({
            x: startExpX + i * (expW + horizontalGap),
            y: spreadY,
            width: expW,
            height: estimateStickyHeightPx(String(t), expW),
          })),
        ];
      };

      const clusterDy = findClusterVerticalShift(
        buildClusterRectsForShift(mainNoteX, mainNoteY, mainHEstimated),
        obstacleRects,
        22,
      );
      mainNoteY += clusterDy;

      const mainNote: CanvasStickyItem = {
        id: mainId,
        type: "sticky",
        x: mainNoteX,
        y: mainNoteY,
        width: noteW,
        height: estimateStickyHeightPx("", noteW),
        content: "",
        role: role === "challenge" || role === "build" || role === "insight" ? role : "insight",
      };

      const sourceConns: CanvasConnection[] = sourceIds.map((sid) => ({
        id: randomId(),
        fromId: sid,
        toId: mainId,
        color: roleColors[role] ?? "var(--accent)",
      }));

      const fitCollabCameraToIds = (ids: string[]) => {
        const el = canvasRef.current;
        const r = el?.getBoundingClientRect();
        if (!r) {
          return;
        }
        const list = itemsRef.current;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const id of ids) {
          const it = list.find((i) => i.id === id);
          if (!it) {
            continue;
          }
          const b = getWorldRect(it, list);
          minX = Math.min(minX, b.x);
          minY = Math.min(minY, b.y);
          maxX = Math.max(maxX, b.x + b.width);
          maxY = Math.max(maxY, b.y + b.height);
        }
        if (!Number.isFinite(minX)) {
          return;
        }
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        setCamera({
          x: r.width / 2 - cx * cameraZoom,
          y: r.height / 2 - cy * cameraZoom,
        });
      };

      setItems((prev) => [...prev, mainNote]);
      setConnections((prev) => [...prev, ...sourceConns]);

      await typewriterStickyContent(mainId, String(note), myGen, collabGenRef, setItems, 20);
      if (myGen !== collabGenRef.current) {
        return;
      }
      if (validatedExpansions.length === 0) {
        fitCollabCameraToIds([mainId]);
      }

      const buildExpansionStickies = (): { items: CanvasStickyItem[]; texts: string[] } => {
        if (validatedExpansions.length === 0) {
          return { items: [], texts: [] };
        }
        const mainSnap = itemsRef.current.find((i) => i.id === mainId && i.type === "sticky");
        const mainH = mainSnap?.height ?? noteH;
        const mainBottom = mainNoteY + mainH;
        if (expansionMode === "opposing" && validatedExpansions.length >= 1) {
          const firstId = randomId();
          const restTexts = validatedExpansions.slice(1);
          const rowY = mainBottom + verticalGap;
          const totalRestW = restTexts.length * expW + Math.max(0, restTexts.length - 1) * horizontalGap;
          const startRestX = anchorX - totalRestW / 2;
          const first: CanvasStickyItem = {
            id: firstId,
            type: "sticky",
            x: mainNoteX + noteW + horizontalGap,
            y: mainNoteY,
            width: expW,
            height: estimateStickyHeightPx("", expW),
            content: "",
            role: "idea",
          };
          const restItems: CanvasStickyItem[] = restTexts.map((_, i) => ({
            id: randomId(),
            type: "sticky" as const,
            x: startRestX + i * (expW + horizontalGap),
            y: rowY,
            width: expW,
            height: estimateStickyHeightPx("", expW),
            content: "",
            role: "idea",
          }));
          return {
            items: [first, ...restItems],
            texts: validatedExpansions,
          };
        }
        const totalExpWidth =
          validatedExpansions.length * expW + Math.max(0, validatedExpansions.length - 1) * horizontalGap;
        const startExpX = anchorX - totalExpWidth / 2;
        const spreadItems: CanvasStickyItem[] = validatedExpansions.map((_, i) => ({
          id: randomId(),
          type: "sticky" as const,
          x: startExpX + i * (expW + horizontalGap),
          y: mainBottom + verticalGap,
          width: expW,
          height: estimateStickyHeightPx("", expW),
          content: "",
          role: "idea",
        }));
        return { items: spreadItems, texts: validatedExpansions };
      };

      const runExpansionTypingAndConnections = async () => {
        const built = buildExpansionStickies();
        if (built.items.length === 0) {
          return;
        }
        const expConns: CanvasConnection[] = built.items.map((exp) => ({
          id: randomId(),
          fromId: mainId,
          toId: exp.id,
          color: "var(--border-visible)",
        }));
        if (expansionMode === "opposing" && built.items.length >= 1) {
          expConns.push({
            id: randomId(),
            fromId: built.items[0]!.id,
            toId: mainId,
            color: "var(--interrupt)",
          });
        }
        setItems((prev) => [...prev, ...built.items]);
        setConnections((prev) => [...prev, ...expConns]);
        for (let i = 0; i < built.items.length; i++) {
          if (myGen !== collabGenRef.current) {
            return;
          }
          const text = built.texts[i] ?? "";
          await typewriterStickyContent(built.items[i]!.id, text, myGen, collabGenRef, setItems, 18);
        }
        if (myGen === collabGenRef.current) {
          fitCollabCameraToIds([mainId, ...built.items.map((b) => b.id)]);
        }
      };

      const finishCollabIdle = () => {
        setIsProcessing(false);
        setCollabBusy(false);
        setAiStatus("");
        collabPlaybackCancelRef.current = null;
      };

      const maybeRunAnnotationThenIdle = () => {
        if (annotationPhases.length === 0) {
          finishCollabIdle();
          return;
        }
        runCollabPlaybackCancel(collabPlaybackCancelRef);
        const { cancel } = runCollabReflectionSketchPlayback(annotationPhases, {
          normalizePath: normalizeAnnotationPath,
          setAiCursor,
          setAiDrawingPath,
          setCompletedAiStrokes,
          setItems,
          sketchColor: "var(--text-secondary)",
          onPlaybackComplete: finishCollabIdle,
        });
        collabPlaybackCancelRef.current = cancel;
      };

      const startRestSketchPlayback = () => {
        if (restPhases.length === 0) {
          maybeRunAnnotationThenIdle();
          return;
        }
        runCollabPlaybackCancel(collabPlaybackCancelRef);
        const { cancel } = runCollabReflectionSketchPlayback(restPhases, {
          normalizePath,
          setAiCursor,
          setAiDrawingPath,
          setCompletedAiStrokes,
          setItems,
          sketchColor: "var(--accent)",
          onPlaybackComplete: maybeRunAnnotationThenIdle,
        });
        collabPlaybackCancelRef.current = cancel;
      };

      const afterPhase0OrSkip = async () => {
        await runExpansionTypingAndConnections();
        if (myGen !== collabGenRef.current) {
          return;
        }
        startRestSketchPlayback();
      };

      if (phase0.length > 0) {
        runCollabPlaybackCancel(collabPlaybackCancelRef);
        const { cancel } = runCollabReflectionSketchPlayback(phase0, {
          normalizePath,
          setAiCursor,
          setAiDrawingPath,
          setCompletedAiStrokes,
          setItems,
          sketchColor: "var(--accent)",
          onPlaybackComplete: () => {
            void afterPhase0OrSkip();
          },
        });
        collabPlaybackCancelRef.current = cancel;
      } else {
        await afterPhase0OrSkip();
      }
    } catch (e) {
      console.error(e);
      if (e instanceof Error && e.name === "AbortError") {
        setIsProcessing(false);
        setCollabBusy(false);
        setAiStatus("");
        return;
      }
      if (collabLayoutTimeoutRef.current != null) {
        window.clearTimeout(collabLayoutTimeoutRef.current);
        collabLayoutTimeoutRef.current = null;
      }
      runCollabPlaybackCancel(collabPlaybackCancelRef);
      setIsProcessing(false);
      setCollabBusy(false);
      setAiStatus(e instanceof Error ? e.message.slice(0, 400) : "COLLAB ERROR");
      window.setTimeout(() => setAiStatus(""), 8000);
    }
  };

  const handleBrainstormTeam = async () => {
    if (brainstormBusy) {
      return;
    }
    const frameIds = selectedIds.filter((id) => items.find((i) => i.id === id)?.type === "frame");
    if (frameIds.length !== 1) {
      setAiStatus("Select exactly one frame for team brainstorm.");
      window.setTimeout(() => setAiStatus(""), 5000);
      return;
    }
    const frameId = frameIds[0]!;
    const frame = getFrameById(items, frameId);
    if (!frame) {
      return;
    }

    const abortController = new AbortController();
    brainstormAbortRef.current = abortController;
    const myGen = ++brainstormGenRef.current;

    setBrainstormBusy(true);
    setIsProcessing(true);
    setAiStatus("Team brainstorm…");

    const instructions = items
      .filter((i): i is CanvasStickyItem => i.type === "sticky" && i.parentId === frameId)
      .map((s) => s.content)
      .join("\n\n");

    const transcript: { persona: "A" | "B"; role: "insight" | "challenge" | "build"; text: string }[] = [];
    const contentW = Math.max(120, frame.width - 16);
    const contentH = Math.max(120, frame.height - FRAME_TITLE_HEIGHT - 16);

    const seedStickyIds = items
      .filter((i): i is CanvasStickyItem => i.type === "sticky" && i.parentId === frameId)
      .map((s) => s.id);

    let priorConnectIds = [...seedStickyIds];
    let nextY = Math.max(8, maxFrameChildBottomY(items, frameId) + 16);

    const noteW = 240;
    const expW = 220;
    const verticalGap = 80;
    const horizontalGap = 40;

    let imagesGenerated = 0;

    const frameObstacleRectsLocal = (): AxisAlignedRect[] =>
      itemsRef.current
        .filter((i) => "parentId" in i && i.parentId === frameId)
        .map((i) => ({
          x: i.x,
          y: i.y,
          width: i.width ?? 220,
          height: i.height ?? 160,
        }));

    const normalizeBrainstormWorldPath = (strokes: CanvasPoint[][], color: string, strokeWidth = 4) => {
      const f = getFrameById(itemsRef.current, frameId);
      if (!f) {
        return null;
      }
      const local = strokes.map((s) =>
        s.map((p) => ({
          x: p.x - f.x,
          y: p.y - f.y - FRAME_TITLE_HEIGHT,
        })),
      );
      return normalizePathInFrameLocal(local, color, frameId, strokeWidth);
    };

    const playBrainstormPhases = (
      phases: CollabReflectionPhase[],
      normalizeP: (strokes: CanvasPoint[][], color: string) => CanvasPathItem | null,
      sketchColor: string,
    ) =>
      new Promise<void>((resolve) => {
        if (phases.length === 0 || myGen !== brainstormGenRef.current) {
          resolve();
          return;
        }
        runCollabPlaybackCancel(brainstormPlaybackCancelRef);
        const { cancel } = runCollabReflectionSketchPlayback(phases, {
          normalizePath: normalizeP,
          setAiCursor,
          setAiDrawingPath,
          setCompletedAiStrokes,
          setItems,
          sketchColor,
          onPlaybackComplete: () => {
            brainstormPlaybackCancelRef.current = null;
            resolve();
          },
        });
        brainstormPlaybackCancelRef.current = cancel;
      });

    try {
      for (let turn = 0; turn < BRAINSTORM_MAX_TURNS; turn++) {
        if (myGen !== brainstormGenRef.current) {
          return;
        }
        if (abortController.signal.aborted) {
          return;
        }

        const persona = turn % 2 === 0 ? "A" : "B";
        const personaName = persona === "A" ? "Alpha" : "Beta";
        const assignedRole = pickUniformCollabMainRole();
        const prompt = buildBrainstormTurnPrompt({
          instructions,
          transcript,
          turnIndex: turn,
          maxTurns: BRAINSTORM_MAX_TURNS,
          persona,
          assignedRole,
          frameContentW: contentW,
          frameContentH: contentH,
        });

        setAiStatus(`Brainstorm turn ${turn + 1}/${BRAINSTORM_MAX_TURNS}…`);

        const data = await requestCanvasBrainstormTurn({
          prompt,
          turnIndex: turn,
          persona,
          signal: abortController.signal,
        });

        if (myGen !== brainstormGenRef.current) {
          return;
        }

        const reactionLines =
          data.reading_reactions && data.reading_reactions.length > 0
            ? data.reading_reactions.slice(0, 4)
            : [`${personaName} taking in the thread…`];
        for (const line of reactionLines) {
          if (myGen !== brainstormGenRef.current) {
            return;
          }
          for (let c = 0; c <= line.length; c++) {
            if (myGen !== brainstormGenRef.current) {
              return;
            }
            setAiStatus(line.slice(0, c));
            await sleep(18);
          }
          await sleep(800);
        }

        if (myGen !== brainstormGenRef.current) {
          return;
        }
        setAiStatus(`Turn ${turn + 1}/${BRAINSTORM_MAX_TURNS}…`);

        const note = String(data.note ?? "").trim() || "(no response)";
        const turnRole = assignedRole;

        transcript.push({
          persona,
          role: turnRole,
          text: note,
        });

        const validatedExpansions = (data.expansions ?? [])
          .slice(0, 3)
          .map((s) => String(s).trim())
          .filter((s) => s.length > 0);
        const expansionMode = data.expansion_mode === "opposing" ? "opposing" : "spread";

        const frameSnap = getFrameById(itemsRef.current, frameId);
        if (!frameSnap) {
          return;
        }

        const rawReflection = (data.reflection_phases ?? []).map((ph) => ({
          thought: ph.thought ?? "",
          strokes: clampStrokePointsToFrame(ph.strokes ?? [], contentW, contentH),
        }));
        const rawAnnotation = (data.annotation_phases ?? []).map((ph) => ({
          thought: ph.thought ?? "",
          strokes: clampStrokePointsToFrame(ph.strokes ?? [], contentW, contentH),
        }));

        const reflectionPhasesWorld = frameLocalReflectionPhasesToWorld(rawReflection, frameSnap);
        const annotationPhasesWorld = frameLocalReflectionPhasesToWorld(rawAnnotation, frameSnap);
        const phase0 = reflectionPhasesWorld[0] ? [reflectionPhasesWorld[0]] : [];
        const restPhases = reflectionPhasesWorld.slice(1);

        const anchorX = contentW / 2;
        const noteStr = String(note ?? "");
        const mainHEstimated = estimateStickyHeightPx(noteStr, noteW);
        let mainNoteX = anchorX - noteW / 2;
        let mainNoteY = nextY + 8;

        const buildClusterRectsForShift = (mx: number, my: number, mH: number): AxisAlignedRect[] => {
          const mainR: AxisAlignedRect = { x: mx, y: my, width: noteW, height: mH };
          if (validatedExpansions.length === 0) {
            return [mainR];
          }
          if (expansionMode === "opposing" && validatedExpansions.length >= 1) {
            const firstH = estimateStickyHeightPx(String(validatedExpansions[0] ?? ""), expW);
            const restTexts = validatedExpansions.slice(1);
            const mainBottom = my + mH;
            const rowY = mainBottom + verticalGap;
            const totalRestW = restTexts.length * expW + Math.max(0, restTexts.length - 1) * horizontalGap;
            const startRestX = anchorX - totalRestW / 2;
            const rects: AxisAlignedRect[] = [
              mainR,
              { x: mx + noteW + horizontalGap, y: my, width: expW, height: firstH },
            ];
            restTexts.forEach((t, i) => {
              rects.push({
                x: startRestX + i * (expW + horizontalGap),
                y: rowY,
                width: expW,
                height: estimateStickyHeightPx(String(t), expW),
              });
            });
            return rects;
          }
          const mainBottom = my + mH;
          const spreadY = mainBottom + verticalGap;
          const totalExpWidth =
            validatedExpansions.length * expW + Math.max(0, validatedExpansions.length - 1) * horizontalGap;
          const startExpX = anchorX - totalExpWidth / 2;
          return [
            mainR,
            ...validatedExpansions.map((t, i) => ({
              x: startExpX + i * (expW + horizontalGap),
              y: spreadY,
              width: expW,
              height: estimateStickyHeightPx(String(t), expW),
            })),
          ];
        };

        const placedMain = findNonOverlappingPosition(
          { x: mainNoteX, y: mainNoteY },
          noteW,
          mainHEstimated,
          frameObstacleRectsLocal(),
          22,
        );
        mainNoteX = placedMain.x;
        mainNoteY = placedMain.y;

        const clusterDy = findClusterVerticalShift(
          buildClusterRectsForShift(mainNoteX, mainNoteY, mainHEstimated),
          frameObstacleRectsLocal(),
          22,
        );
        mainNoteY += clusterDy;

        const roleColors: Record<string, string> = {
          challenge: "var(--interrupt)",
          build: "var(--success)",
          insight: "var(--accent)",
        };

        const mainId = randomId();
        const stickyText = `${personaName}: ${note}`;
        const mainNote: CanvasStickyItem = {
          id: mainId,
          type: "sticky",
          parentId: frameId,
          x: mainNoteX,
          y: mainNoteY,
          width: noteW,
          height: estimateStickyHeightPx("", noteW),
          content: "",
          role: turnRole,
        };

        const sourceConns: CanvasConnection[] = priorConnectIds.map((sid) => ({
          id: randomId(),
          fromId: sid,
          toId: mainId,
          color: roleColors[turnRole] ?? "var(--accent)",
        }));

        setItems((prev) => [...prev, mainNote]);
        if (priorConnectIds.length > 0) {
          setConnections((prev) => [...prev, ...sourceConns]);
        }

        await typewriterStickyContent(mainId, stickyText, myGen, brainstormGenRef, setItems, 16);
        if (myGen !== brainstormGenRef.current) {
          return;
        }

        const mainSnap = itemsRef.current.find((i) => i.id === mainId && i.type === "sticky");
        const mainH = mainSnap?.height ?? mainHEstimated;

        let expansionIdsThisTurn: string[] = [];

        const buildExpansionStickies = (): { items: CanvasStickyItem[]; texts: string[] } => {
          if (validatedExpansions.length === 0) {
            return { items: [], texts: [] };
          }
          const mainBottom = mainNoteY + mainH;
          if (expansionMode === "opposing" && validatedExpansions.length >= 1) {
            const firstId = randomId();
            const restTexts = validatedExpansions.slice(1);
            const rowY = mainBottom + verticalGap;
            const totalRestW = restTexts.length * expW + Math.max(0, restTexts.length - 1) * horizontalGap;
            const startRestX = anchorX - totalRestW / 2;
            const first: CanvasStickyItem = {
              id: firstId,
              type: "sticky",
              parentId: frameId,
              x: mainNoteX + noteW + horizontalGap,
              y: mainNoteY,
              width: expW,
              height: estimateStickyHeightPx("", expW),
              content: "",
              role: "idea",
            };
            const restItems: CanvasStickyItem[] = restTexts.map((_, i) => ({
              id: randomId(),
              type: "sticky" as const,
              parentId: frameId,
              x: startRestX + i * (expW + horizontalGap),
              y: rowY,
              width: expW,
              height: estimateStickyHeightPx("", expW),
              content: "",
              role: "idea",
            }));
            return {
              items: [first, ...restItems],
              texts: validatedExpansions,
            };
          }
          const totalExpWidth =
            validatedExpansions.length * expW + Math.max(0, validatedExpansions.length - 1) * horizontalGap;
          const startExpX = anchorX - totalExpWidth / 2;
          const spreadItems: CanvasStickyItem[] = validatedExpansions.map((_, i) => ({
            id: randomId(),
            type: "sticky" as const,
            parentId: frameId,
            x: startExpX + i * (expW + horizontalGap),
            y: mainBottom + verticalGap,
            width: expW,
            height: estimateStickyHeightPx("", expW),
            content: "",
            role: "idea",
          }));
          return { items: spreadItems, texts: validatedExpansions };
        };

        const runExpansionTypingAndConnections = async () => {
          const built = buildExpansionStickies();
          expansionIdsThisTurn = built.items.map((b) => b.id);
          if (built.items.length === 0) {
            return;
          }
          const expConns: CanvasConnection[] = built.items.map((exp) => ({
            id: randomId(),
            fromId: mainId,
            toId: exp.id,
            color: "var(--border-visible)",
          }));
          if (expansionMode === "opposing" && built.items.length >= 1) {
            expConns.push({
              id: randomId(),
              fromId: built.items[0]!.id,
              toId: mainId,
              color: "var(--interrupt)",
            });
          }
          setItems((prev) => [...prev, ...built.items]);
          setConnections((prev) => [...prev, ...expConns]);
          for (let i = 0; i < built.items.length; i++) {
            if (myGen !== brainstormGenRef.current) {
              return;
            }
            const text = built.texts[i] ?? "";
            await typewriterStickyContent(built.items[i]!.id, text, myGen, brainstormGenRef, setItems, 16);
          }
        };

        const normalizeMainWp = (strokes: CanvasPoint[][], color: string) =>
          normalizeBrainstormWorldPath(strokes, color, 3);
        const normalizeAnnotWp = (strokes: CanvasPoint[][], color: string) =>
          normalizeBrainstormWorldPath(strokes, color, 1.75);

        const afterPhase0OrSkip = async () => {
          await runExpansionTypingAndConnections();
          if (myGen !== brainstormGenRef.current) {
            return;
          }
          await playBrainstormPhases(restPhases, normalizeMainWp, "var(--accent)");
          if (myGen !== brainstormGenRef.current) {
            return;
          }
          await playBrainstormPhases(annotationPhasesWorld, normalizeAnnotWp, "var(--text-secondary)");
        };

        if (phase0.length > 0) {
          await playBrainstormPhases(phase0, normalizeMainWp, "var(--accent)");
          if (myGen !== brainstormGenRef.current) {
            return;
          }
          await afterPhase0OrSkip();
        } else {
          await afterPhase0OrSkip();
        }
        if (myGen !== brainstormGenRef.current) {
          return;
        }

        priorConnectIds = [mainId, ...expansionIdsThisTurn];

        const imgPrompt = String(data.image_prompt ?? "").trim();
        if (imgPrompt && imagesGenerated < BRAINSTORM_MAX_IMAGES_PER_RUN) {
          try {
            setAiStatus("Generating reference image…");
            const imgRes = await requestCanvasGenerateImage({
              prompt: imgPrompt,
              signal: abortController.signal,
            });
            if (myGen !== brainstormGenRef.current) {
              return;
            }
            const imgId = randomId();
            const iw = Math.min(200, noteW);
            const ih = 150;
            const imgY = maxFrameChildBottomY(itemsRef.current, frameId) + 8;
            setItems((prev) => [
              ...prev,
              {
                id: imgId,
                type: "image",
                parentId: frameId,
                x: 8,
                y: imgY,
                width: iw,
                height: ih,
                src: `data:${imgRes.mimeType};base64,${imgRes.base64Png}`,
              },
            ]);
            imagesGenerated += 1;
          } catch {
            /* image optional */
          }
        }

        nextY = maxFrameChildBottomY(itemsRef.current, frameId) + 16;
      }

      if (myGen !== brainstormGenRef.current) {
        return;
      }
      setAiStatus("Synthesis…");

      const concludePrompt = buildBrainstormConcludePrompt(transcript);
      const conclude = await requestCanvasBrainstormConclude({
        prompt: concludePrompt,
        signal: abortController.signal,
      });

      if (myGen !== brainstormGenRef.current) {
        return;
      }

      const conclusion =
        String(conclude.conclusion ?? "").trim() ||
        "Agreed direction: consolidate around the strongest shared themes from the thread.";
      const conclusionText = `Conclusion: ${conclusion}`;
      const stickyW = Math.min(220, contentW - 16);
      const conclusionH = estimateStickyHeightPx(conclusionText, stickyW);
      const conclusionId = randomId();
      const conclusionY = maxFrameChildBottomY(itemsRef.current, frameId) + 16;

      setItems((prev) => [
        ...prev,
        {
          id: conclusionId,
          type: "sticky",
          parentId: frameId,
          x: 8,
          y: conclusionY,
          width: stickyW,
          height: conclusionH,
          content: "",
          role: "insight",
        },
      ]);

      await typewriterStickyContent(conclusionId, conclusionText, myGen, brainstormGenRef, setItems, 14);

      setAiStatus("");
    } catch (e) {
      console.error(e);
      if (e instanceof Error && e.name === "AbortError") {
        setAiStatus("");
        return;
      }
      setAiStatus(e instanceof Error ? e.message.slice(0, 200) : "BRAINSTORM ERROR");
      window.setTimeout(() => setAiStatus(""), 8000);
    } finally {
      brainstormAbortRef.current = null;
      runCollabPlaybackCancel(brainstormPlaybackCancelRef);
      if (brainstormGenRef.current === myGen) {
        setBrainstormBusy(false);
        setIsProcessing(false);
      }
    }
  };

  const canTeamBrainstorm = useMemo(() => {
    const frames = selectedIds.filter((id) => items.find((i) => i.id === id)?.type === "frame");
    return frames.length === 1;
  }, [selectedIds, items]);

  const canStylize = useMemo(() => {
    const selectedItems = selectedIds
      .map((id) => items.find((i) => i.id === id))
      .filter((x): x is CanvasItem => Boolean(x));
    const stickies = selectedItems.filter((i) => i.type === "sticky");
    const images = selectedItems.filter((i) => i.type === "image");
    const sketchPaths = collectPathsForStylize(selectedItems, items);
    if (stickies.length + images.length === 0 && sketchPaths.length === 0) {
      return false;
    }
    if (stickies.length > 1 || images.length > 1) {
      return false;
    }
    return true;
  }, [selectedIds, items]);

  /** Pencil palette: Blue Bell, Pumpkin Spice, Black, Cherry Rose */
  const drawColors = ["#009ADA", "#FF7000", "#000000", "#9E1946"];

  const renderLeafItem = (item: CanvasStickyItem | CanvasImageItem | CanvasPathItem) => {
    const isS = selectedIds.includes(item.id);
    let borderColor = "var(--border-visible)";
    let textColor = "var(--text-primary)";
    if (item.type === "sticky") {
      if (item.role === "challenge") {
        borderColor = "var(--interrupt)";
        textColor = "var(--interrupt)";
      } else if (item.role === "build") {
        borderColor = "var(--success)";
        textColor = "var(--success)";
      } else if (item.role === "insight") {
        borderColor = "var(--accent)";
      } else if (item.role === "idea") {
        borderColor = "var(--border)";
        textColor = "var(--text-secondary)";
      }
      if (isS) {
        borderColor = "var(--text-primary)";
      }
    } else if (item.type === "image" && isS) {
      borderColor = "var(--text-primary)";
    }

    let zClass = "converge-canvas__node-z-base";
    if (isS) {
      zClass = "converge-canvas__node-z-selected";
    }
    if (item.type === "path") {
      zClass = "converge-canvas__node-z-sketch";
    }

    const isWrapperInteractive = effectiveMode === "select";

    return (
      <div
        key={item.id}
        onPointerDown={(e) => handlePointerDownItem(e, item.id)}
        onPointerEnter={
          item.type === "path" && effectiveMode === "select"
            ? () => setHoveredPathId(item.id)
            : undefined
        }
        onPointerLeave={
          item.type === "path" && effectiveMode === "select"
            ? () => setHoveredPathId((h) => (h === item.id ? null : h))
            : undefined
        }
        className={`converge-canvas__node ${zClass} ${item.type !== "path" ? "converge-canvas__node--card" : ""}`}
        style={{
          left: item.x,
          top: item.y,
          width: item.width || 220,
          height: item.height || 160,
          ...(item.type !== "path"
            ? {
                borderColor,
                color: textColor,
                padding: item.type === "sticky" ? "20px" : "8px",
                backgroundColor: "var(--surface)",
                borderRadius: item.type === "sticky" ? "0" : "8px",
              }
            : {}),
          pointerEvents: isWrapperInteractive ? "auto" : "none",
          cursor: isWrapperInteractive ? "grab" : undefined,
        }}
      >
        {item.type === "sticky" && (
          <ConvergeStickyTextarea
            item={item}
            onContentChange={updateItemContent}
            onHeightSync={syncStickyHeightFromDom}
          />
        )}
        {item.type === "image" && <img src={item.src} className="converge-canvas__image" alt="" />}
        {item.type === "image" &&
          isS &&
          effectiveMode === "select" &&
          selectedIds.length === 1 &&
          selectedIds[0] === item.id && (
            <button
              type="button"
              className="converge-canvas__resize-handle"
              aria-label="Resize image. Hold Shift to lock aspect ratio."
              onPointerDown={(e) => handleResizePointerDown(e, item.id)}
            />
          )}
        {item.type === "path" && (
          <svg width="100%" height="100%" className="converge-canvas__path-svg">
            {item.strokes.map((s, i) => (
              <g key={i}>
                <polyline
                  points={s.map((p) => `${p.x},${p.y}`).join(" ")}
                  stroke="transparent"
                  strokeWidth="20"
                  fill="none"
                  strokeLinecap="round"
                  style={{ pointerEvents: "none" }}
                />
                <polyline
                  points={s.map((p) => `${p.x},${p.y}`).join(" ")}
                  stroke={item.color}
                  strokeWidth={item.strokeWidth ?? 4}
                  fill="none"
                  className="converge-canvas__sketch-line"
                />
              </g>
            ))}
          </svg>
        )}
        {item.type === "sticky" && item.role !== "default" && (
          <div className="converge-canvas__role-chip">
            {item.role === "idea"
              ? "IDEA"
              : item.role === "build"
                ? "BUILD"
                : item.role === "challenge"
                  ? "CHALLENGE"
                  : "INSIGHT"}
          </div>
        )}
        {effectiveMode === "select" &&
          ((item.type !== "path" && isS) || (item.type === "path" && (hoveredPathId === item.id || isS))) && (
            <div
              className="converge-canvas__spawn"
              onPointerDown={(e) => {
                e.stopPropagation();
                const el = canvasRef.current;
                if (!el) {
                  return;
                }
                const rect = el.getBoundingClientRect();
                const pos = screenToCanvas(e.clientX - rect.left, e.clientY - rect.top);
                setConnectingState({ fromId: item.id, currentX: pos.x, currentY: pos.y });
              }}
            >
              <IconPlus />
            </div>
          )}
      </div>
    );
  };

  const floatingMount =
    typeof document !== "undefined"
      ? document.getElementById("converge-floating-root") ?? document.getElementById("root")
      : null;

  const floatingChrome = floatingMount
    ? createPortal(
          <div className="converge-canvas__floating-ui" data-converge-chrome>
            {serverCollabConfigured === false ? (
              <div className="converge-canvas__api-hint converge-canvas__api-hint--floating" role="status">
                <strong>Demo Collab</strong>
                <span>
                  Collab uses fixed placeholder JSON until you set{" "}
                  <code className="converge-canvas__api-hint-code">GEMINI_API_KEY</code> (or{" "}
                  <code className="converge-canvas__api-hint-code">GOOGLE_API_KEY</code>) in{" "}
                  <code className="converge-canvas__api-hint-code">.env</code> from{" "}
                  <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
                    Google AI Studio
                  </a>{" "}
                  and restart <code className="converge-canvas__api-hint-code">npm run dev</code>.
                  {serverStylizeConfigured === false ? (
                    <>
                      {" "}
                      Stylize needs <code className="converge-canvas__api-hint-code">EXTRACTION_PROVIDER=comfyui</code>{" "}
                      and a running ComfyUI (<code className="converge-canvas__api-hint-code">COMFYUI_BASE_URL</code>).
                    </>
                  ) : null}
                </span>
              </div>
            ) : null}
            {isProcessing || aiStatus ? (
              <div className="converge-canvas__hud converge-canvas__hud--floating" role="status" aria-live="polite">
                [ {aiStatus} ]
              </div>
            ) : null}
            <div className="converge-canvas__toolbar converge-canvas__toolbar--floating" role="toolbar" aria-label="Canvas tools">
              <button
                type="button"
                className={`converge-canvas__tool ${effectiveMode === "select" ? "converge-canvas__tool--active" : ""}`}
                aria-pressed={effectiveMode === "select"}
                aria-label="Select"
                onClick={() => setMode("select")}
              >
                <IconSelect />
              </button>
              <button
                type="button"
                className={`converge-canvas__tool ${effectiveMode === "hand" ? "converge-canvas__tool--active" : ""}`}
                aria-pressed={effectiveMode === "hand"}
                aria-label="Hand"
                onClick={() => setMode("hand")}
              >
                <IconHand />
              </button>
              <button
                type="button"
                className={`converge-canvas__tool ${effectiveMode === "draw" ? "converge-canvas__tool--active" : ""}`}
                aria-pressed={effectiveMode === "draw"}
                aria-label="Draw"
                onClick={() => setMode("draw")}
              >
                <IconPen />
              </button>
              {mode === "draw" ? (
                <div className="converge-canvas__palette" role="group" aria-label="Draw color">
                  {drawColors.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`converge-canvas__swatch ${drawColor === c ? "converge-canvas__swatch--active" : ""}`}
                      style={{ backgroundColor: c }}
                      onClick={() => setDrawColor(c)}
                      aria-label="Color"
                    />
                  ))}
                </div>
              ) : null}
              <div className="converge-canvas__toolbar-divider" aria-hidden />
              <button
                type="button"
                className="converge-canvas__tool"
                aria-label="Add image"
                onClick={() => fileInputRef.current?.click()}
              >
                <IconImage />
              </button>
              <button type="button" className="converge-canvas__tool" aria-label="Add sticky" onClick={addSticky}>
                <IconSticky />
              </button>
              <button
                type="button"
                className="converge-canvas__tool"
                disabled={isProcessing}
                aria-label="Frame: nest selection or add empty frame"
                title="Frame — nest selection, or empty frame if nothing to nest"
                onClick={applyFrame}
              >
                <IconFrame />
              </button>
              <div
                ref={stylizeClusterRef}
                className={`converge-canvas__stylize-cluster${
                  stylizeWorkflowMenuOpen ? " converge-canvas__stylize-cluster--open" : ""
                }`}
              >
                <div className="converge-canvas__stylize-cluster-row">
                  <button
                    type="button"
                    className="converge-canvas__tool"
                    disabled={!canStylize || isProcessing}
                    aria-label="Stylize"
                    onClick={() => void handleStylize()}
                  >
                    <IconWand />
                  </button>
                  <button
                    type="button"
                    className="converge-canvas__stylize-workflow-add"
                    aria-label="Choose Stylize workflow"
                    aria-expanded={stylizeWorkflowMenuOpen}
                    aria-haspopup="dialog"
                    disabled={isProcessing}
                    onClick={(e) => {
                      e.stopPropagation();
                      setStylizeWorkflowMenuOpen((o) => !o);
                    }}
                  >
                    <IconPlus />
                  </button>
                </div>
                {stylizeWorkflowMenuOpen ? (
                  <div
                    className="converge-canvas__stylize-workflow-popover"
                    role="dialog"
                    aria-label="Choose Stylize workflow"
                  >
                    <div className="converge-canvas__stylize-workflow-popover__header">
                      <span className="section-label">Workflow</span>
                    </div>
                    <div className="converge-canvas__stylize-workflow-cards">
                      {STYLIZE_WORKFLOW_PRESETS.map((preset, index) => {
                        const a = preset.paletteA ?? "#ebe8e4";
                        const b = preset.paletteB ?? "#f4f2ef";
                        const thumb = preset.thumbnailUrl ? `url("${preset.thumbnailUrl}")` : "none";
                        return (
                          <button
                            key={preset.id}
                            type="button"
                            className={`memory-sphere-workflow-card converge-canvas__stylize-workflow-card ${
                              index === stylizePresetIndex ? "memory-sphere-workflow-card--active" : ""
                            }`}
                            onClick={() => {
                              onStylizePresetIndexChange(index);
                              setStylizeWorkflowMenuOpen(false);
                            }}
                            aria-pressed={index === stylizePresetIndex}
                          >
                            <div
                              className="memory-sphere-workflow-card__media memory-sphere-workflow-card__media--photo"
                              style={
                                {
                                  ["--wf-a" as unknown as string]: a,
                                  ["--wf-b" as unknown as string]: b,
                                  ["--wf-thumb" as unknown as string]: thumb,
                                } as React.CSSProperties
                              }
                            >
                              <div className="memory-sphere-workflow-card__overlay">
                                <strong>{preset.name}</strong>
                                <span>Stylize context</span>
                                <div className="memory-sphere-workflow-card__file">
                                  <span
                                    className="memory-sphere-workflow-card__file-name"
                                    title={preset.workflowFile}
                                  >
                                    {preset.workflowFile}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className={`converge-canvas__collab converge-canvas__collab--brainstorm${
                  brainstormBusy ? " converge-canvas__collab--stop" : ""
                }`}
                disabled={
                  brainstormBusy ? false : collabBusy || isProcessing || !canTeamBrainstorm
                }
                onClick={() =>
                  brainstormBusy ? handleBrainstormStop() : void handleBrainstormTeam()
                }
                aria-label={
                  brainstormBusy ? "Stop team brainstorm" : "Team brainstorm in frame"
                }
              >
                {brainstormBusy ? (
                  "STOP"
                ) : (
                  <>
                    <IconSparkle /> TEAM
                  </>
                )}
              </button>
              <button
                type="button"
                className={`converge-canvas__collab${collabBusy ? " converge-canvas__collab--stop" : ""}`}
                disabled={collabBusy ? false : isProcessing || brainstormBusy}
                onClick={() => (collabBusy ? handleCollabStop() : void handleCollab())}
                aria-label={collabBusy ? "Stop collaborator" : "Collaborate with AI"}
              >
                {collabBusy ? (
                  "STOP"
                ) : (
                  <>
                    <IconSparkle /> COLLAB
                  </>
                )}
              </button>
            </div>
          </div>,
        floatingMount,
      )
    : null;

  return (
    <>
    <div
      ref={canvasRef}
      className="converge-canvas"
      onPointerDown={handlePointerDownCanvas}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      role="application"
      aria-label="Infinity canvas"
      style={{
        cursor:
          effectiveMode === "hand" ? "grab" : effectiveMode === "draw" ? "crosshair" : "default",
      }}
    >
      <svg className="converge-canvas__filters" aria-hidden>
        <defs>
          {[0, 1, 2, 3].map((i) => (
            <filter id={`converge-squiggly-${i}`} key={i}>
              <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="3" seed={i * 10} result="noise" />
              <feDisplacementMap in="SourceGraphic" in2="noise" scale="3" xChannelSelector="R" yChannelSelector="G" />
            </filter>
          ))}
        </defs>
      </svg>

      <div
        className="converge-canvas__world"
        style={{
          transform: `translate(${camera.x}px, ${camera.y}px) scale(${cameraZoom})`,
          transformOrigin: "0 0",
        }}
      >
        <svg className="converge-canvas__svg converge-canvas__svg--connections" aria-hidden>
          <defs>
            <marker id="converge-arrow-primary" markerWidth="6" markerHeight="6" refX="4" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" fill="var(--text-primary)" />
            </marker>
            <marker id="converge-arrow-accent" markerWidth="6" markerHeight="6" refX="4" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" fill="var(--accent)" />
            </marker>
            <marker id="converge-arrow-interrupt" markerWidth="6" markerHeight="6" refX="4" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" fill="var(--interrupt)" />
            </marker>
            <marker id="converge-arrow-success" markerWidth="6" markerHeight="6" refX="4" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" fill="var(--success)" />
            </marker>
            <marker id="converge-arrow-visible" markerWidth="6" markerHeight="6" refX="4" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" fill="var(--border-visible)" />
            </marker>
          </defs>
          {connections.map((c) => {
            const f = items.find((i) => i.id === c.fromId);
            const t = items.find((i) => i.id === c.toId);
            if (!f || !t) {
              return null;
            }
            const fc = getWorldBottomAnchor(f, items);
            const tc = getWorldTopAnchor(t, items);
            const pathD = `M ${fc.x} ${fc.y} C ${fc.x} ${fc.y + Math.max(50, Math.abs(tc.y - fc.y) / 2)}, ${tc.x} ${tc.y - Math.max(50, Math.abs(tc.y - fc.y) / 2)}, ${tc.x} ${tc.y}`;
            let markerId = "converge-arrow-primary";
            if (c.color === "var(--accent)") {
              markerId = "converge-arrow-accent";
            } else if (c.color === "var(--interrupt)") {
              markerId = "converge-arrow-interrupt";
            } else if (c.color === "var(--success)") {
              markerId = "converge-arrow-success";
            } else if (c.color === "var(--border-visible)") {
              markerId = "converge-arrow-visible";
            }
            return (
              <path
                key={c.id}
                d={pathD}
                fill="none"
                stroke={c.color}
                strokeWidth="1.5"
                markerEnd={`url(#${markerId})`}
              />
            );
          })}
          {connectingState &&
            (() => {
              const f = items.find((i) => i.id === connectingState.fromId);
              if (!f) {
                return null;
              }
              const fc = getWorldBottomAnchor(f, items);
              const tc = { x: connectingState.currentX, y: connectingState.currentY };
              const pathD = `M ${fc.x} ${fc.y} C ${fc.x} ${fc.y + Math.max(50, Math.abs(tc.y - fc.y) / 2)}, ${tc.x} ${tc.y - Math.max(50, Math.abs(tc.y - fc.y) / 2)}, ${tc.x} ${tc.y}`;
              return (
                <path
                  d={pathD}
                  fill="none"
                  stroke="var(--border-visible)"
                  strokeWidth="1.5"
                  strokeDasharray="4 4"
                  markerEnd="url(#converge-arrow-visible)"
                />
              );
            })()}
        </svg>

        <svg className="converge-canvas__svg converge-canvas__svg--draw" aria-hidden>
          {mode === "draw"
            ? (() => {
                void drawUiNonce;
                const ds = drawSessionRef.current;
                return (
                  <>
                    {ds.draft.map((stroke, i) => (
                      <polyline
                        key={`draw-draft-${i}`}
                        points={stroke.map((p) => `${p.x},${p.y}`).join(" ")}
                        stroke={drawColor}
                        strokeWidth="4"
                        fill="none"
                        className="converge-canvas__sketch-line"
                      />
                    ))}
                    {ds.active && ds.active.length > 0 ? (
                      <polyline
                        points={ds.active.map((p) => `${p.x},${p.y}`).join(" ")}
                        stroke={drawColor}
                        strokeWidth="4"
                        fill="none"
                        className="converge-canvas__sketch-line"
                      />
                    ) : null}
                  </>
                );
              })()
            : null}
          {completedAiStrokes.map((s, i) => (
            <polyline
              key={i}
              points={s.map((p) => `${p.x},${p.y}`).join(" ")}
              stroke="var(--accent)"
              strokeWidth="4"
              fill="none"
              className="converge-canvas__sketch-line"
            />
          ))}
          {aiDrawingPath && (
            <polyline
              points={aiDrawingPath.map((p) => `${p.x},${p.y}`).join(" ")}
              stroke="var(--accent)"
              strokeWidth="4"
              fill="none"
              className="converge-canvas__sketch-line"
            />
          )}
        </svg>

        {items.map((item) => {
          if (item.type === "frame") {
            const children = items.filter(
              (c): c is CanvasStickyItem | CanvasImageItem | CanvasPathItem =>
                c.type !== "frame" && "parentId" in c && c.parentId === item.id,
            );
            const isFS = selectedIds.includes(item.id);
            const variantClass =
              item.variant === "sketch"
                ? " converge-canvas__frame--sketch"
                : item.variant === "ai_zone"
                  ? " converge-canvas__frame--ai-zone"
                  : " converge-canvas__frame--concept";
            return (
              <div
                key={item.id}
                className={`converge-canvas__frame${variantClass}${isFS ? " converge-canvas__frame--selected" : ""}`}
                style={{ left: item.x, top: item.y, width: item.width, height: item.height }}
                onPointerDown={(e) => handlePointerDownItem(e, item.id)}
              >
                <div className="converge-canvas__frame-title-row">
                  <input
                    type="text"
                    className="converge-canvas__frame-title-input"
                    value={item.title}
                    onChange={(e) => updateFrameTitle(item.id, e.target.value)}
                    onPointerDown={(e) => e.stopPropagation()}
                    aria-label="Frame title"
                  />
                </div>
                <div
                  className="converge-canvas__frame-body"
                  style={{ overflow: item.clipContent === false ? "visible" : "hidden" }}
                >
                  {children.map((ch) => renderLeafItem(ch))}
                </div>
                {isFS && effectiveMode === "select" ? (
                  <div
                    className="converge-canvas__spawn"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      const el = canvasRef.current;
                      if (!el) {
                        return;
                      }
                      const rect = el.getBoundingClientRect();
                      const pos = screenToCanvas(e.clientX - rect.left, e.clientY - rect.top);
                      setConnectingState({ fromId: item.id, currentX: pos.x, currentY: pos.y });
                    }}
                  >
                    <IconPlus />
                  </div>
                ) : null}
                {isFS &&
                  effectiveMode === "select" &&
                  selectedIds.length === 1 &&
                  selectedIds[0] === item.id && (
                    <button
                      type="button"
                      className="converge-canvas__resize-handle"
                      aria-label="Resize frame. Hold Shift to lock aspect ratio."
                      onPointerDown={(e) => handleResizePointerDown(e, item.id)}
                    />
                  )}
              </div>
            );
          }
          if ("parentId" in item && item.parentId) {
            return null;
          }
          return renderLeafItem(item);
        })}

        <div
          className="converge-canvas__ai-cursor"
          style={{
            left: aiCursor.x,
            top: aiCursor.y,
            opacity: aiCursor.visible ? 1 : 0,
          }}
        >
          <div className="converge-canvas__ai-cursor-icon">
            <IconCursor />
          </div>
          {aiCursor.message ? <div className="converge-canvas__ai-bubble">{aiCursor.message}</div> : null}
        </div>
      </div>

      {isSelecting ? (
        <div
          className="converge-canvas__marquee"
          style={{
            left: camera.x + Math.min(selectionBox.startX, selectionBox.endX) * cameraZoom,
            top: camera.y + Math.min(selectionBox.startY, selectionBox.endY) * cameraZoom,
            width: Math.abs(selectionBox.endX - selectionBox.startX) * cameraZoom,
            height: Math.abs(selectionBox.endY - selectionBox.startY) * cameraZoom,
          }}
        />
      ) : null}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="converge-canvas__file-input"
        onChange={handleImageUpload}
      />

      {items.length === 0 && moodboardAssets.length === 0 ? (
        <div className="converge-canvas__empty">
          <p>No images on the board yet.</p>
        </div>
      ) : null}
    </div>
    {floatingChrome}
    </>
  );
}
