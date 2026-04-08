import type { Dispatch, SetStateAction } from "react";
import type { CollabReflectionPhase } from "../../services/canvasAiClient";
import type { CanvasItem, CanvasPathItem, CanvasPoint } from "./convergeTypes";

/** Floating AI pointer + optional “think out loud” caption (Collab + Stylize). */
export type AiBubbleCursor = {
  x: number;
  y: number;
  visible: boolean;
  message: string;
};

const DEFAULT_POINT_INTERVAL_MS = 42;
const DEFAULT_THOUGHT_CHAR_MS = 22;

function thoughtDwellAfterTypeMs(thought: string): number {
  return Math.min(3200, 720 + thought.length * 22);
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Stylize: move the synthetic AI cursor from viewport center to the target asset, then run `onComplete`.
 * Mirrors the MVP `animateAiAction` (Thinking… → message at target).
 */
/** Camera pan + zoom; viewport size in CSS px for centering the cursor in canvas space. */
export function animateAiCursorForStylize(
  viewport: { width: number; height: number },
  camera: { x: number; y: number; zoom: number },
  targetX: number,
  targetY: number,
  message: string,
  setAiCursor: Dispatch<SetStateAction<AiBubbleCursor>>,
  onComplete: () => void,
): () => void {
  const z = camera.zoom || 1;
  const startX = (viewport.width / 2 - camera.x) / z;
  const startY = (viewport.height / 2 - camera.y) / z;
  setAiCursor({
    x: startX,
    y: startY,
    visible: true,
    message: "Thinking...",
  });
  let t2: ReturnType<typeof setTimeout> | null = null;
  const t1 = window.setTimeout(() => {
    setAiCursor({ x: targetX + 50, y: targetY + 50, visible: true, message });
    t2 = window.setTimeout(onComplete, 1000);
  }, 500);
  return () => {
    window.clearTimeout(t1);
    if (t2 != null) {
      window.clearTimeout(t2);
    }
  };
}

export type ReflectionSketchDeps = {
  /** Strokes normalized into a path item (same helper as user freehand). */
  normalizePath: (strokes: CanvasPoint[][], color: string) => CanvasPathItem | null;
  setAiCursor: Dispatch<SetStateAction<AiBubbleCursor>>;
  setAiDrawingPath: Dispatch<SetStateAction<CanvasPoint[] | null>>;
  setCompletedAiStrokes: Dispatch<SetStateAction<CanvasPoint[][]>>;
  setItems: Dispatch<SetStateAction<CanvasItem[]>>;
  /** Called after the final path is committed and the cursor hides (Collab idle). */
  onPlaybackComplete: () => void;
  /** Stroke color CSS token for the committed sketch layer. */
  sketchColor?: string;
};

export type ReflectionPlaybackOptions = {
  /** Ms between polyline points while “drawing”. */
  pointIntervalMs?: number;
  /** Ms between characters when typing `thought` in the bubble. */
  thoughtCharMs?: number;
  /** Initial delay before the first phase starts (ms). */
  initialDelayMs?: number;
  /** Delay between phases after a phase completes (ms), lower bound. */
  interPhaseDelayMs?: number;
};

export type ReflectionPlaybackHandle = {
  cancel: () => void;
};

/**
 * Collab: plays back `reflection_phases`: types `thought` in the bubble, dwells, then animates strokes.
 * When multiple phases are passed, merges all their strokes into one path at the end (same as MVP).
 */
export function runCollabReflectionSketchPlayback(
  phases: CollabReflectionPhase[],
  deps: ReflectionSketchDeps,
  options?: ReflectionPlaybackOptions,
): ReflectionPlaybackHandle {
  const {
    normalizePath,
    setAiCursor,
    setAiDrawingPath,
    setCompletedAiStrokes,
    setItems,
    onPlaybackComplete,
    sketchColor = "var(--accent)",
  } = deps;

  const pointIntervalMs = options?.pointIntervalMs ?? DEFAULT_POINT_INTERVAL_MS;
  const thoughtCharMs = options?.thoughtCharMs ?? DEFAULT_THOUGHT_CHAR_MS;
  const initialDelayMs = options?.initialDelayMs ?? 600;
  const interPhaseDelayMs = options?.interPhaseDelayMs ?? 900;

  if (phases.length === 0) {
    return { cancel: () => {} };
  }

  let cancelled = false;
  const timeouts: number[] = [];
  let drawInterval: ReturnType<typeof setInterval> | null = null;

  const clearDrawInterval = () => {
    if (drawInterval != null) {
      window.clearInterval(drawInterval);
      drawInterval = null;
    }
  };

  const pushTimeout = (id: number) => {
    timeouts.push(id);
  };

  const cancel = () => {
    cancelled = true;
    clearDrawInterval();
    for (const id of timeouts) {
      window.clearTimeout(id);
    }
    timeouts.length = 0;
  };

  let phaseIdx = 0;
  let strokeIdx = 0;
  let pointIdx = 1;

  const scheduleInterPhaseDelay = (fn: () => void) => {
    const ms = Math.min(2400, interPhaseDelayMs + phaseIdx * 120);
    pushTimeout(
      window.setTimeout(() => {
        if (!cancelled) {
          fn();
        }
      }, ms),
    );
  };

  const finishAllPhases = () => {
    if (cancelled) {
      return;
    }
    const allStrokes = phases.flatMap((p) => p.strokes ?? []);
    if (allStrokes.length > 0) {
      const normalized = normalizePath(allStrokes, sketchColor);
      if (normalized) {
        setItems((prev) => [...prev, normalized]);
      }
    }
    setAiDrawingPath(null);
    setCompletedAiStrokes([]);
    pushTimeout(
      window.setTimeout(() => {
        if (!cancelled) {
          setAiCursor((c) => ({ ...c, visible: false }));
        }
      }, 2600),
    );
    if (!cancelled) {
      onPlaybackComplete();
    }
  };

  const startStrokeDrawing = (currentPhase: CollabReflectionPhase, strokes: { x: number; y: number }[][]) => {
    if (cancelled || strokes.length === 0 || !strokes[0]?.length) {
      phaseIdx += 1;
      scheduleInterPhaseDelay(processPhase);
      return;
    }
    setAiDrawingPath([strokes[0]![0]!]);
    strokeIdx = 0;
    pointIdx = 1;

    drawInterval = window.setInterval(() => {
      if (cancelled) {
        clearDrawInterval();
        return;
      }
      const currentStroke = strokes[strokeIdx];
      if (!currentStroke) {
        clearDrawInterval();
        phaseIdx += 1;
        scheduleInterPhaseDelay(processPhase);
        return;
      }
      if (pointIdx >= currentStroke.length) {
        setCompletedAiStrokes((prev) => [...prev, currentStroke]);
        strokeIdx += 1;
        pointIdx = 1;
        if (strokeIdx >= strokes.length) {
          clearDrawInterval();
          setAiDrawingPath(null);
          phaseIdx += 1;
          scheduleInterPhaseDelay(processPhase);
          return;
        }
        const nextStroke = strokes[strokeIdx];
        if (nextStroke?.[0]) {
          setAiDrawingPath([nextStroke[0]]);
        }
        return;
      }
      const cp = currentStroke[pointIdx];
      if (cp) {
        setAiCursor((c) => ({ ...c, x: cp.x, y: cp.y }));
        setAiDrawingPath((prev) => [...(prev ?? []), cp]);
      }
      pointIdx += 1;
    }, pointIntervalMs);
  };

  const runThoughtThenDraw = (currentPhase: CollabReflectionPhase, strokes: { x: number; y: number }[][]) => {
    const thought = (currentPhase.thought ?? "").trim();
    const x0 = strokes[0]![0]!.x;
    const y0 = strokes[0]![0]!.y;

    setAiCursor((c) => ({
      ...c,
      x: x0,
      y: y0,
      visible: true,
      message: "",
    }));

    const reduced = prefersReducedMotion();
    if (reduced || thought.length === 0) {
      setAiCursor((c) => ({
        ...c,
        message: thought.length > 0 ? thought : "…",
        visible: true,
      }));
      const dwell = reduced ? 380 : thought.length === 0 ? 200 : thoughtDwellAfterTypeMs(thought);
      pushTimeout(
        window.setTimeout(() => {
          if (!cancelled) {
            startStrokeDrawing(currentPhase, strokes);
          }
        }, dwell),
      );
      return;
    }

    let charIndex = 0;
    const stepThought = () => {
      if (cancelled) {
        return;
      }
      if (charIndex > thought.length) {
        pushTimeout(
          window.setTimeout(() => {
            if (!cancelled) {
              startStrokeDrawing(currentPhase, strokes);
            }
          }, thoughtDwellAfterTypeMs(thought)),
        );
        return;
      }
      const slice = thought.slice(0, charIndex);
      setAiCursor((c) => ({ ...c, message: slice, visible: true }));
      charIndex += 1;
      pushTimeout(window.setTimeout(stepThought, thoughtCharMs));
    };
    pushTimeout(window.setTimeout(stepThought, 40));
  };

  const processPhase = () => {
    if (cancelled) {
      return;
    }
    if (phaseIdx >= phases.length) {
      finishAllPhases();
      return;
    }

    const currentPhase = phases[phaseIdx];
    if (!currentPhase) {
      return;
    }
    const strokes = currentPhase.strokes ?? [];

    if (strokes.length === 0 || !strokes[0] || strokes[0].length === 0) {
      phaseIdx += 1;
      processPhase();
      return;
    }

    runThoughtThenDraw(currentPhase, strokes);
  };

  pushTimeout(
    window.setTimeout(() => {
      if (!cancelled) {
        processPhase();
      }
    }, initialDelayMs),
  );

  return { cancel };
}
