import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CropStudio } from "../components/CropStudio";
import { ImageLightbox } from "../components/ImageLightbox";
import { PhoneCaptureInvite } from "../components/PhoneCaptureInvite";
import { ThemeToggle } from "../components/ThemeToggle";
import { MemorySphere } from "../components/three/MemorySphere";
import {
  ConvergeCanvas,
  CONVERGE_ZOOM_MAX,
  CONVERGE_ZOOM_MIN,
} from "../components/converge/ConvergeCanvas";
import {
  getMockLabelsForCapture,
  getMockLabelsForIngredient,
} from "../lib/mockAssetLabels";
import {
  createLiveCaptureSession,
  pollLiveCaptureSession,
} from "../services/liveCaptureClient";
import {
  getExtractionJob,
  requestExtraction,
} from "../services/extractionClient";
import {
  applyCurateGrouping,
  applyOriginGrouping,
  type CurateGroupHub,
} from "../lib/curateSphereGrouping";
import { getPhoneCaptureInviteBaseUrl } from "../lib/phoneCaptureOrigin";
import type {
  BoardAsset,
  ConstraintSettings,
  GeneratedDirectionId,
  OrbPlacement,
  WorkflowType,
} from "../types/assets";
import type { ExtractionJobResponse } from "../types/extraction";
import type {
  CanvasConnection,
  CanvasItem,
  CanvasToolMode,
} from "../components/converge/convergeTypes";

type CropSelection = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type DesignStage = "curate" | "create" | "converge";

type WorkflowPreset = {
  id: string;
  name: string;
  designer: string;
  paletteA: string;
  paletteB: string;
  /** Public URL for workflow card background image */
  thumbnailUrl: string;
  workflowFile: string;
};

/** Comfy workflow basenames (aligned with `server/.../comfy/workflows/`). */
const WORKFLOW_FILE_SCULPTURAL = "sculptural_essence_3way_api.json";
const WORKFLOW_FILE_INTERIOR_UXUI = "interior_uxui_3way_api.json";
const WORKFLOW_FILE_ABSTRACT_INGREDIENT = "abstract_ingredient_extractor_3way_api.json";

/**
 * Single source for which graph runs per carousel index (0–2).
 * Only index 2 (Soft Volume Extract) uses `WORKFLOW_FILE_ABSTRACT_INGREDIENT`; do not add it elsewhere.
 */
const PRESET_WORKFLOW_FILES = [
  WORKFLOW_FILE_SCULPTURAL,
  WORKFLOW_FILE_INTERIOR_UXUI,
  WORKFLOW_FILE_ABSTRACT_INGREDIENT,
] as const;

function getWorkflowFileForPresetIndex(index: number): string {
  const clamped = Math.max(0, Math.min(PRESET_WORKFLOW_FILES.length - 1, index));
  return PRESET_WORKFLOW_FILES[clamped];
}

const WORKFLOW_PRESETS: WorkflowPreset[] = [
  {
    id: "wf-sculptural-essence",
    name: "Design Language",
    designer: "K. Yuan",
    paletteA: "#ebe8e4",
    paletteB: "#f4f2ef",
    thumbnailUrl: "/workflow-thumbnails/thumbnail_1.png",
    workflowFile: PRESET_WORKFLOW_FILES[0],
  },
  {
    id: "wf-contour-ribbon",
    name: "Experience",
    designer: "S. Hoffmann",
    paletteA: "#f7ece6",
    paletteB: "#fff7f2",
    thumbnailUrl: "/workflow-thumbnails/thumbnail_2.png",
    workflowFile: PRESET_WORKFLOW_FILES[1],
  },
  {
    id: "wf-soft-volume",
    name: "Soft Volume Extract",
    designer: "A. Brenner",
    paletteA: "#e7f6f2",
    paletteB: "#f6fffc",
    thumbnailUrl: "/workflow-thumbnails/thumbnail_3.png",
    workflowFile: PRESET_WORKFLOW_FILES[2],
  },
];

const JOB_POLL_INTERVAL_MS = 1000;
const DIRECTION_ORDER: GeneratedDirectionId[] = [
  "spatial",
  "tactile",
  "experiential",
  "interface",
  "installation",
  "wearable",
];
const DIRECTION_LABEL_BY_WORKFLOW: Record<WorkflowType, string> = {
  shape: "Spatial",
  texture: "Tactile",
  pattern: "Experiential",
};

function isInteriorUxUiWorkflowFile(workflowFile?: string | null) {
  return workflowFile?.trim().endsWith(WORKFLOW_FILE_INTERIOR_UXUI) === true;
}

function getDirectionRank(directionId?: GeneratedDirectionId | null) {
  if (!directionId) {
    return 999;
  }

  const rank = DIRECTION_ORDER.indexOf(directionId);
  return rank >= 0 ? rank : 999;
}

function fallbackDirectionId(
  workflowType?: WorkflowType | null,
  workflowFile?: string | null,
): GeneratedDirectionId | null {
  if (isInteriorUxUiWorkflowFile(workflowFile)) {
    if (workflowType === "texture") {
      return "installation";
    }
    if (workflowType === "pattern") {
      return "wearable";
    }
    if (workflowType === "shape") {
      return "interface";
    }
  }

  if (workflowType === "texture") {
    return "tactile";
  }

  if (workflowType === "pattern") {
    return "experiential";
  }

  if (workflowType === "shape") {
    return "spatial";
  }

  return null;
}

function fallbackDirectionLabel(workflowType?: WorkflowType | null, workflowFile?: string | null) {
  if (workflowType && isInteriorUxUiWorkflowFile(workflowFile)) {
    if (workflowType === "shape") {
      return "Interface";
    }
    if (workflowType === "texture") {
      return "Installation";
    }
    if (workflowType === "pattern") {
      return "Wearable";
    }
  }

  if (workflowType) {
    return DIRECTION_LABEL_BY_WORKFLOW[workflowType];
  }

  return "Direction";
}

function directionLabelFromAsset(asset: BoardAsset) {
  if (asset.directionLabel?.trim()) {
    return asset.directionLabel.trim();
  }

  const fallbackWorkflowType = asset.workflowType;
  if (!fallbackWorkflowType) {
    return "Direction";
  }

  return DIRECTION_LABEL_BY_WORKFLOW[fallbackWorkflowType];
}

function moodboardKeywordFromAsset(asset: BoardAsset) {
  const dir = directionLabelFromAsset(asset);
  if (dir !== "Direction" && dir.trim()) {
    return dir.trim();
  }

  const fromLabels = asset.labels.find((label) => label.trim().length > 0);
  if (fromLabels) {
    return fromLabels.trim();
  }

  return dir;
}

function getLinkedDirectionAssets(
  assetList: BoardAsset[],
  parentAnchor: BoardAsset | null,
): BoardAsset[] {
  if (!parentAnchor) {
    return [];
  }

  return assetList
    .filter(
      (asset) => asset.kind === "generated" && asset.parentAssetId === parentAnchor.id,
    )
    .sort((left, right) => {
      const leftRank = getDirectionRank(left.directionId ?? null);
      const rightRank = getDirectionRank(right.directionId ?? null);
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }

      return left.createdAt.localeCompare(right.createdAt);
    });
}

function wait(durationMs: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, durationMs);
  });
}

const QUEUE_SEGMENTS = 8;
const QUEUE_FILL_PERIOD_MS = 12000;

function queueSegmentFill(phase: number, index: number, total: number): number {
  const span = 1 / total;
  const start = index * span;
  const end = start + span;
  if (phase <= start) {
    return 0;
  }
  if (phase >= end) {
    return 1;
  }
  return (phase - start) / span;
}

function cropImageFromSelection(imageUrl: string, selection: CropSelection) {
  return new Promise<string>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const sourceX = Math.round(selection.x * image.naturalWidth);
      const sourceY = Math.round(selection.y * image.naturalHeight);
      const sourceWidth = Math.max(1, Math.round(selection.width * image.naturalWidth));
      const sourceHeight = Math.max(1, Math.round(selection.height * image.naturalHeight));

      const canvas = document.createElement("canvas");
      canvas.width = sourceWidth;
      canvas.height = sourceHeight;

      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("Canvas context unavailable."));
        return;
      }

      context.drawImage(
        image,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        sourceWidth,
        sourceHeight,
      );

      resolve(canvas.toDataURL("image/jpeg", 0.92));
    };
    image.onerror = () => reject(new Error("Crop generation failed."));
    image.src = imageUrl;
  });
}

function normalizeAngle(angle: number) {
  if (angle > 180) {
    return angle - 360;
  }

  if (angle < -180) {
    return angle + 360;
  }

  return angle;
}

function halton(index: number, base: number) {
  let result = 0;
  let fraction = 1 / base;
  let value = index;

  while (value > 0) {
    result += fraction * (value % base);
    value = Math.floor(value / base);
    fraction /= base;
  }

  return result;
}

function getCapturePlacement(captureIndex: number): OrbPlacement {
  const index = captureIndex + 1;
  const laneCycle: OrbPlacement["lane"][] = [
    "surface",
    "surface",
    "inner",
    "surface",
    "halo",
    "surface",
  ];
  const lane = laneCycle[captureIndex % laneCycle.length];
  const azimuth = normalizeAngle(-96 + halton(index, 2) * 192);
  const elevation = -30 + halton(index, 3) * 62;
  const depth = 0.78 + halton(index, 5) * 0.18;
  const laneScale = lane === "halo" ? 0.92 : lane === "inner" ? 0.95 : 1;
  const densityScale = Math.max(0.84, 1 - Math.min(0.16, captureIndex * 0.006));

  return {
    azimuth,
    elevation,
    depth,
    scale: laneScale * densityScale,
    lane,
    phase: halton(index, 7),
  };
}

function getIngredientPlacement(
  ingredientIndex: number,
  parentPlacement: OrbPlacement,
): OrbPlacement {
  const ringIndex = Math.floor(ingredientIndex / 9);
  const slotIndex = ingredientIndex % 9;
  const laneCycle: OrbPlacement["lane"][] = ["surface", "inner", "halo"];
  const lane = laneCycle[(ingredientIndex + 1) % laneCycle.length];
  const angle =
    (slotIndex / 9) * Math.PI * 2 + parentPlacement.phase * Math.PI * 2 + ringIndex * 0.36;
  const azimuthRadius = 16 + ringIndex * 6;
  const elevationRadius = 11 + ringIndex * 4;
  const depthOffset = 0.06 + ringIndex * 0.03 + (lane === "halo" ? 0.04 : 0);

  return {
    azimuth: normalizeAngle(parentPlacement.azimuth + Math.cos(angle) * azimuthRadius),
    elevation: Math.max(
      -36,
      Math.min(38, parentPlacement.elevation + 7 + Math.sin(angle) * elevationRadius),
    ),
    depth: Math.min(1, parentPlacement.depth + depthOffset),
    scale: Math.max(0.72, 0.88 - ringIndex * 0.05),
    lane,
    phase: 0.2 + (slotIndex / 9) * 0.5 + ringIndex * 0.08,
  };
}

function getGeneratedPlacement(generatedIndex: number, parentPlacement: OrbPlacement): OrbPlacement {
  const ringBlueprint: Array<{
    count: number;
    azimuthRadius: number;
    elevationRadius: number;
    depthOffset: number;
    lane: OrbPlacement["lane"];
    scale: number;
    verticalBias: number;
  }> = [
    {
      count: 6,
      azimuthRadius: 26,
      elevationRadius: 15,
      depthOffset: 0.05,
    lane: "surface",
      scale: 0.84,
      verticalBias: 8,
    },
    {
      count: 8,
      azimuthRadius: 38,
      elevationRadius: 22,
      depthOffset: 0.1,
      lane: "inner",
      scale: 0.8,
      verticalBias: 12,
    },
    {
      count: 10,
      azimuthRadius: 52,
      elevationRadius: 30,
      depthOffset: 0.16,
      lane: "halo",
      scale: 0.76,
      verticalBias: 16,
    },
  ];
  const cycleSize = ringBlueprint.reduce((sum, ring) => sum + ring.count, 0);
  const cycleIndex = generatedIndex % cycleSize;
  const cycle = Math.floor(generatedIndex / cycleSize);

  let ringIndex = 0;
  let slotIndex = cycleIndex;
  let cursor = 0;
  for (let index = 0; index < ringBlueprint.length; index += 1) {
    const next = cursor + ringBlueprint[index].count;
    if (cycleIndex < next) {
      ringIndex = index;
      slotIndex = cycleIndex - cursor;
      break;
    }
    cursor = next;
  }

  const ring = ringBlueprint[ringIndex];
  const ringAngle =
    (slotIndex / ring.count) * Math.PI * 2 + parentPlacement.phase * Math.PI * 2 + cycle * 0.42;
  const cycleSpread = cycle * 2.2;

  return {
    azimuth: normalizeAngle(parentPlacement.azimuth + Math.cos(ringAngle) * ring.azimuthRadius + cycleSpread),
    elevation: Math.max(
      -40,
      Math.min(
        44,
        parentPlacement.elevation + ring.verticalBias + Math.sin(ringAngle) * ring.elevationRadius,
      ),
    ),
    depth: Math.min(1, parentPlacement.depth + ring.depthOffset + cycle * 0.03),
    scale: Math.max(0.62, ring.scale - cycle * 0.03),
    lane: ring.lane,
    phase: 0.24 + (slotIndex / ring.count) * 0.6 + cycle * 0.05,
  };
}

function DesignDiamond({
  activeStage,
  onStageChange,
}: {
  activeStage: DesignStage;
  onStageChange: (stage: DesignStage) => void;
}) {
  const steps: DesignStage[] = ["curate", "create", "converge"];

  function StageIcon({ stage }: { stage: DesignStage }) {
    switch (stage) {
      case "curate":
  return (
      <svg
            className="design-diamond-card__stage-icon"
            viewBox="0 0 476 476"
        aria-hidden="true"
            focusable="false"
          >
            <circle cx="375.652" cy="238" r="10.3481" fill="currentColor" stroke="currentColor" strokeWidth="4" />
            <circle cx="100.348" cy="238" r="10.3481" fill="currentColor" stroke="currentColor" strokeWidth="4" />
            <circle
              cx="238"
              cy="100.348"
              r="10.3481"
              transform="rotate(-90 238 100.348)"
              fill="currentColor"
              stroke="currentColor"
              strokeWidth="4"
            />
            <circle
              cx="238"
              cy="375.652"
              r="10.3481"
              transform="rotate(-90 238 375.652)"
              fill="currentColor"
              stroke="currentColor"
              strokeWidth="4"
            />
            <circle cx="335.335" cy="140.665" r="10.3481" fill="currentColor" stroke="currentColor" strokeWidth="4" />
            <circle cx="140.666" cy="335.334" r="10.3481" fill="currentColor" stroke="currentColor" strokeWidth="4" />
            <circle
              cx="12.3481"
              cy="12.3481"
              r="10.3481"
              transform="matrix(1 -2.18557e-08 -2.18557e-08 -1 322.987 347.683)"
              fill="currentColor"
              stroke="currentColor"
              strokeWidth="4"
            />
            <circle
              cx="12.3481"
              cy="12.3481"
              r="10.3481"
              transform="matrix(1 -2.18557e-08 -2.18557e-08 -1 128.318 153.013)"
              fill="currentColor"
              stroke="currentColor"
              strokeWidth="4"
            />
          </svg>
        );
      case "create":
        return (
          <svg
            className="design-diamond-card__stage-icon"
            viewBox="0 0 476 476"
            aria-hidden="true"
            focusable="false"
          >
            <g clipPath="url(#clip0_create_stage)">
        <path
                d="M238.745 164.448V55.8521M238.745 420.282V311.686M312.031 238.4H420.627M56.1973 238.4H164.793M290.045 290.366L365.996 368.316M110.828 108.485L186.779 185.768M290.712 186.434L368.661 110.483M108.83 365.651L186.113 289.7"
          stroke="currentColor"
                strokeWidth="4"
                strokeMiterlimit="10"
        />
        <path
                d="M266.841 170.158L308.322 69.7962M169.118 406.592L210.599 306.231M306.322 266.496L406.683 307.977M69.8871 168.773L170.249 210.254M266.153 306.123L306.57 407.173M170.001 69.5762L210.672 170.011M306.469 210.326L407.519 169.91M69.9217 306.479L170.356 265.808"
          stroke="currentColor"
                strokeWidth="4"
                strokeMiterlimit="10"
              />
            </g>
            <defs>
              <clipPath id="clip0_create_stage">
                <rect width="476" height="476" fill="white" />
              </clipPath>
            </defs>
      </svg>
        );
      case "converge":
        return (
          <svg
            className="design-diamond-card__stage-icon"
            viewBox="0 0 476 476"
            aria-hidden="true"
            focusable="false"
          >
            <line x1="240.488" y1="55.8521" x2="240.488" y2="420.282" stroke="currentColor" strokeWidth="4" />
            <line x1="420.702" y1="239.133" x2="56.2724" y2="239.133" stroke="currentColor" strokeWidth="4" />
            <line x1="111.057" y1="107.807" x2="368.748" y2="365.498" stroke="currentColor" strokeWidth="4" />
            <line x1="368.747" y1="110.636" x2="111.057" y2="368.327" stroke="currentColor" strokeWidth="4" />
          </svg>
        );
      default:
        return null;
    }
  }

  return (
    <div className="design-diamond-card" aria-label="Design process">
      <div className="design-diamond-card__labels">
        {steps.map((step) => (
          <button
            key={step}
            type="button"
            className={`design-diamond-card__step ${
              activeStage === step ? "design-diamond-card__step--active" : ""
            }`}
            onClick={() => onStageChange(step)}
          >
            {activeStage === step ? (
              <span className="design-diamond-card__step-label">
                <StageIcon stage={step} />
                <strong>{step}</strong>
              </span>
            ) : (
              <strong>{step}</strong>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function mergeChildIds(currentIds: string[], nextIds: string[]) {
  return Array.from(new Set([...currentIds, ...nextIds]));
}

function createGeneratedAsset(
  output: ExtractionJobResponse["generatedOutputs"][number],
  placement: OrbPlacement,
  createdAt: string,
  workflowFile?: string | null,
): BoardAsset {
  const directionId =
    output.directionId ?? fallbackDirectionId(output.generation.workflowType, workflowFile);
  const directionLabel =
    output.directionLabel?.trim() ||
    fallbackDirectionLabel(output.generation.workflowType, workflowFile);
  const labels = Array.from(new Set([directionLabel, ...output.tags]));

  return {
    id: output.id,
    title: output.title,
    kind: "generated",
    parentAssetId: output.parentAssetId,
    childAssetIds: [],
    labels,
    tone: "ingredient",
    size: "small",
    imageUrl: output.imageUrl,
    generationStatus: "completed",
    generationMetadata: {
      provider: output.generation.provider,
      providerJobId: output.generation.providerJobId,
      generatedAt: output.generation.generatedAt,
    },
    workflowType: output.generation.workflowType,
    directionId,
    directionLabel,
    createdAt,
    orbPlacement: placement,
    entryMotion: "desktop",
  };
}

function describeFallback(job: ExtractionJobResponse) {
  if (job.provider !== "mock") {
    return null;
  }

  if (job.fallbackReason) {
    return `Mock fallback active: ${job.fallbackReason}`;
  }

  return "Mock fallback active: ComfyUI provider unavailable.";
}

export function CurateScreen() {
  const [assets, setAssets] = useState<BoardAsset[]>([]);
  const [activeStage, setActiveStage] = useState<DesignStage>("curate");
  const [sphereRadius, setSphereRadius] = useState(700);
  const [convergeCameraZoom, setConvergeCameraZoom] = useState(1);
  const [convergeStylizePresetIndex, setConvergeStylizePresetIndex] = useState(0);
  /** Lifted from ConvergeCanvas so board state survives Curate / Create / Converge tab switches. */
  const [convergeItems, setConvergeItems] = useState<CanvasItem[]>([]);
  const [convergeConnections, setConvergeConnections] = useState<CanvasConnection[]>([]);
  const [convergeBoardCamera, setConvergeBoardCamera] = useState({ x: 0, y: 0 });
  const [convergeSelectedIds, setConvergeSelectedIds] = useState<string[]>([]);
  const [convergeToolMode, setConvergeToolMode] = useState<CanvasToolMode>("select");
  const [convergeDrawColor, setConvergeDrawColor] = useState("#009ADA");
  const [cropTargetAssetId, setCropTargetAssetId] = useState<string | null>(null);
  const [lightboxAssetId, setLightboxAssetId] = useState<string | null>(null);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [extractionAlert, setExtractionAlert] = useState<string | null>(null);
  const [contextPrompt, setContextPrompt] = useState("");
  /** After user selects a board asset while context text is set, label reads "Context applied". */
  const [contextAppliedViaAssetClick, setContextAppliedViaAssetClick] = useState(false);
  const [showConstraints, setShowConstraints] = useState(false);
  /** Last card hovered for linked-directions strip (persists after pointer leaves until another hover or leaving Curate). */
  const [lastHoveredLinkedAssetId, setLastHoveredLinkedAssetId] = useState<string | null>(null);
  const [activeWorkflowIndex, setActiveWorkflowIndex] = useState(0);
  const [workflowCarouselIndex, setWorkflowCarouselIndex] = useState(0);
  const [workflowSlideStride, setWorkflowSlideStride] = useState(0);
  const [queueFillPhase, setQueueFillPhase] = useState(0);
  const [curateGroupChat, setCurateGroupChat] = useState("");
  const [curateGroupHubs, setCurateGroupHubs] = useState<CurateGroupHub[]>([]);
  /** Send cycles: 0 → category, 1 → origin, 2 → reset scatter; then repeats (`phase % 3`). */
  const [curateGroupSendPhase, setCurateGroupSendPhase] = useState(0);
  const [showMoodboard, setShowMoodboard] = useState(false);
  const [collectMode, setCollectMode] = useState(false);
  const [moodboardEntryIds, setMoodboardEntryIds] = useState<string[]>([]);
  const [moodboardLastAddedId, setMoodboardLastAddedId] = useState<string | null>(null);
  const [moodboardLiveMessage, setMoodboardLiveMessage] = useState("");
  const [sphereViewportResetNonce, setSphereViewportResetNonce] = useState(0);
  const workflowViewportRef = useRef<HTMLDivElement>(null);
  const constraintsPanelInnerRef = useRef<HTMLDivElement>(null);
  const moodboardPanelInnerRef = useRef<HTMLDivElement>(null);
  const [constraintSettings, setConstraintSettings] = useState<ConstraintSettings>({
    workflowFile: getWorkflowFileForPresetIndex(0),
    edgeHold: true,
    textureBias: false,
    seedLock: false,
    guidance: 6.5,
  });
  const cursorRef = useRef(0);
  const activeLiveSessionIdRef = useRef<string | null>(null);
  const [liveCaptureSessionId, setLiveCaptureSessionId] = useState<string | null>(null);
  const ingestedCaptureIdsRef = useRef(new Set<string>());
  const isMountedRef = useRef(true);
  /** Placements before any Curate Send-driven layout; restored when leaving Curate after a layout was applied. */
  const curatePlacementSnapshotRef = useRef<Map<string, OrbPlacement> | null>(null);
  const curateLayoutAppliedRef = useRef(false);
  const prevStageForCurateRef = useRef<DesignStage | null>(null);
  const assetsRef = useRef(assets);
  assetsRef.current = assets;

  const cropTargetAsset =
    assets.find((asset) => asset.id === cropTargetAssetId && asset.kind === "captured") ?? null;
  const selectedWorkflowType: WorkflowType =
    activeWorkflowIndex === 1 ? "texture" : activeWorkflowIndex === 2 ? "pattern" : "shape";
  const memorySphereAssets = assets;

  const phoneCaptureInviteUrl = useMemo(() => {
    if (!liveCaptureSessionId) {
      return null;
    }
    const base = getPhoneCaptureInviteBaseUrl();
    return `${base}/phone/${liveCaptureSessionId}`;
  }, [liveCaptureSessionId]);

  const handleCurateGroupSend = useCallback(() => {
    if (assets.length === 0) {
      return;
    }

    const step = curateGroupSendPhase % 3;

    if (step === 2) {
      const snap = curatePlacementSnapshotRef.current;
      if (snap && snap.size > 0) {
        setAssets((prevAssets) =>
          prevAssets.map((a) => {
            const placement = snap.get(a.id);
            return placement ? { ...a, orbPlacement: { ...placement } } : a;
          }),
        );
        setCurateGroupHubs([]);
        curateLayoutAppliedRef.current = false;
        setSphereViewportResetNonce((n) => n + 1);
      }
      setCurateGroupSendPhase((phase) => phase + 1);
      return;
    }

    const snap = curatePlacementSnapshotRef.current;
    if (!snap || snap.size === 0) {
      curatePlacementSnapshotRef.current = new Map(
        assets.map((a) => [a.id, { ...a.orbPlacement }]),
      );
    }

    if (step === 0) {
      const { nextAssets, hubs } = applyCurateGrouping(assets, curateGroupChat, sphereRadius);
      setAssets(nextAssets);
      setCurateGroupHubs(hubs);
    } else {
      const { nextAssets, hubs } = applyOriginGrouping(assets, sphereRadius);
      setAssets(nextAssets);
      setCurateGroupHubs(hubs);
    }
    curateLayoutAppliedRef.current = true;
    setCurateGroupSendPhase((phase) => phase + 1);
  }, [assets, curateGroupChat, sphereRadius, curateGroupSendPhase]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    const inner = constraintsPanelInnerRef.current;
    if (inner) {
      inner.inert = !showConstraints;
    }
  }, [showConstraints]);

  useLayoutEffect(() => {
    const inner = moodboardPanelInnerRef.current;
    if (inner) {
      inner.inert = !showMoodboard;
    }
  }, [showMoodboard]);

  useEffect(() => {
    if (activeStage !== "curate" && showMoodboard) {
      setShowMoodboard(false);
    }
  }, [activeStage, showMoodboard]);

  useEffect(() => {
    if (activeStage !== "curate" && collectMode) {
      setCollectMode(false);
    }
  }, [activeStage, collectMode]);

  useEffect(() => {
    if (!moodboardLastAddedId) {
      return;
    }
    const t = window.setTimeout(() => setMoodboardLastAddedId(null), 450);
    return () => window.clearTimeout(t);
  }, [moodboardLastAddedId]);

  useEffect(() => {
    if (!moodboardLiveMessage) {
      return;
    }
    const t = window.setTimeout(() => setMoodboardLiveMessage(""), 2500);
    return () => window.clearTimeout(t);
  }, [moodboardLiveMessage]);

  useEffect(() => {
    if (!showMoodboard || activeStage !== "curate") {
      return;
    }

    const panel = window.document.getElementById("moodboard-panel");
    const firstFocusable = panel?.querySelector<HTMLElement>(
      'button:not([disabled]), [href], input, textarea, select, [tabindex]:not([tabindex="-1"])',
    );

    firstFocusable?.focus();
  }, [activeStage, showMoodboard]);

  useEffect(() => {
    if (!showConstraints || activeStage !== "create") {
      return;
    }

    const panel = window.document.getElementById("constraints-panel");
    const firstFocusable = panel?.querySelector<HTMLElement>(
      '[tabindex="0"], button, input, textarea, select, a[href]',
    );

    firstFocusable?.focus();
  }, [activeStage, showConstraints]);

  useEffect(() => {
    if (activeStage !== "create" && showConstraints) {
      setShowConstraints(false);
    }
  }, [activeStage, showConstraints]);

  useEffect(() => {
    if (activeStage === "converge" && lightboxAssetId) {
      setLightboxAssetId(null);
    }
  }, [activeStage, lightboxAssetId]);

  useEffect(() => {
    const prev = prevStageForCurateRef.current;

    if (activeStage === "curate" && prev !== "curate") {
      curatePlacementSnapshotRef.current = new Map(
        assetsRef.current.map((a) => [a.id, { ...a.orbPlacement }]),
      );
    }

    if (prev === "curate" && activeStage !== "curate") {
      if (curateLayoutAppliedRef.current) {
        const snap = curatePlacementSnapshotRef.current;
        if (snap && snap.size > 0) {
          setAssets((prevAssets) =>
            prevAssets.map((a) => {
              const placement = snap.get(a.id);
              return placement ? { ...a, orbPlacement: { ...placement } } : a;
            }),
          );
        }
        setSphereViewportResetNonce((n) => n + 1);
      }
      setLastHoveredLinkedAssetId(null);
      setCurateGroupHubs([]);
      setCurateGroupSendPhase(0);
      curateLayoutAppliedRef.current = false;
    }

    prevStageForCurateRef.current = activeStage;
  }, [activeStage]);

  useEffect(() => {
    setConstraintSettings((current) => ({
      ...current,
      workflowFile: getWorkflowFileForPresetIndex(activeWorkflowIndex),
    }));
  }, [activeWorkflowIndex]);

  useEffect(() => {
    let cancelled = false;

    async function ensureSession() {
      if (activeLiveSessionIdRef.current) {
        return true;
      }

      try {
        const session = await createLiveCaptureSession();
        if (cancelled) {
          return false;
        }

        activeLiveSessionIdRef.current = session.sessionId;
        setLiveCaptureSessionId(session.sessionId);
        cursorRef.current = 0;
        ingestedCaptureIdsRef.current = new Set();
        return true;
      } catch (error) {
        console.error(error);
        return false;
      }
    }

    async function pollSession() {
      const ready = await ensureSession();
      if (!ready || cancelled) {
        return;
      }

      try {
        const sessionId = activeLiveSessionIdRef.current;
        if (!sessionId) {
          return;
        }
        const response = await pollLiveCaptureSession(sessionId, cursorRef.current);

        if (cancelled) {
          return;
        }

        if (response.sessionId !== activeLiveSessionIdRef.current) {
          activeLiveSessionIdRef.current = response.sessionId;
          setLiveCaptureSessionId(response.sessionId);
          cursorRef.current = 0;
          ingestedCaptureIdsRef.current = new Set();
        }

        cursorRef.current = response.nextCursor;

        if (response.captures.length === 0) {
          return;
        }

        setAssets((currentAssets) => {
          const nextAssets = [...currentAssets];
          let captureIndex = currentAssets.filter((asset) => asset.kind === "captured").length;

          response.captures.forEach((capture) => {
            if (ingestedCaptureIdsRef.current.has(capture.id)) {
              return;
            }

            ingestedCaptureIdsRef.current.add(capture.id);
            nextAssets.push({
              id: capture.id,
              title: `Capture ${captureIndex + 1}`,
              kind: "captured",
              parentAssetId: null,
              childAssetIds: [],
              labels: getMockLabelsForCapture(captureIndex),
              tone: "captured",
              size: "medium",
              imageUrl: capture.imageUrl,
              generationStatus: "idle",
              workflowType: null,
              createdAt: capture.createdAt,
              orbPlacement: getCapturePlacement(captureIndex),
              entryMotion: "phone",
            });
            captureIndex += 1;
          });

          return nextAssets;
        });
      } catch (error) {
        console.error(error);
        const is404 =
          typeof error === "object" &&
          error !== null &&
          "status" in error &&
          (error as { status?: number }).status === 404;

        // Recover from stale/expired session ids by forcing one re-create.
        // Keep current session for transient non-404 failures.
        if (is404) {
          activeLiveSessionIdRef.current = null;
          setLiveCaptureSessionId(null);
        }
      }
    }

    void pollSession();
    const intervalId = window.setInterval(() => {
      void pollSession();
    }, 900);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  async function handleCreateCrop(selection: CropSelection) {
    const sourceAsset = assets.find(
      (asset) => asset.id === cropTargetAssetId && asset.kind === "captured",
    );
    if (!sourceAsset?.imageUrl) {
      return;
    }

    try {
      const imageUrl = await cropImageFromSelection(sourceAsset.imageUrl, selection);
      const cropId = `crop-${Date.now()}`;

      setAssets((currentAssets) => {
        const cropIndex = currentAssets.filter((asset) => asset.kind === "crop").length;
        const nextAssets = currentAssets.map((asset) => {
          if (asset.id !== sourceAsset.id) {
            return asset;
          }

          return {
            ...asset,
            childAssetIds: mergeChildIds(asset.childAssetIds, [cropId]),
          };
        });

        const cropAsset: BoardAsset = {
          id: cropId,
          title: `Crop ${cropIndex + 1}`,
          kind: "crop",
          parentAssetId: sourceAsset.id,
          childAssetIds: [],
          labels: getMockLabelsForIngredient(selection, sourceAsset, cropIndex),
          tone: "ingredient",
          size: "small",
          imageUrl,
          generationStatus: "idle",
          workflowType: null,
          createdAt: new Date().toISOString(),
          orbPlacement: getIngredientPlacement(cropIndex, sourceAsset.orbPlacement),
          entryMotion: "crop",
        };

        return [...nextAssets, cropAsset];
      });
      setCropTargetAssetId(null);
    } catch (error) {
      console.error(error);
    }
  }

  function selectWorkflowPreset(index: number) {
    const clamped = Math.max(0, Math.min(WORKFLOW_PRESETS.length - 1, index));
    setActiveWorkflowIndex(clamped);
    setWorkflowCarouselIndex(clamped);
  }

  function handleWorkflowCardKeyDown(
    event: React.KeyboardEvent<HTMLElement>,
    workflowIndex: number,
  ) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    selectWorkflowPreset(workflowIndex);
  }

  function integrateCompletedJob(job: ExtractionJobResponse) {
    const fallbackMessage = describeFallback(job);

    setAssets((currentAssets) => {
      const sourceAsset = currentAssets.find((asset) => asset.id === job.sourceAssetId);

      if (!sourceAsset) {
        return currentAssets;
      }

      const orderedOutputs = [...job.generatedOutputs].sort((left, right) => {
        const leftRank = getDirectionRank(left.directionId ?? null);
        const rightRank = getDirectionRank(right.directionId ?? null);
        if (leftRank !== rightRank) {
          return leftRank - rightRank;
        }

        return left.id.localeCompare(right.id);
      });
      const outputById = new Map(orderedOutputs.map((output) => [output.id, output]));
      const existingGeneratedCount = currentAssets.filter(
        (asset) => asset.parentAssetId === sourceAsset.id && asset.kind === "generated",
      ).length;

      const updatedAssets: BoardAsset[] = currentAssets.map((asset): BoardAsset => {
        if (asset.id === sourceAsset.id) {
          return {
            ...asset,
            generationStatus: "completed",
            generationMetadata:
              job.generatedOutputs[0] != null
                ? {
                    provider: job.generatedOutputs[0].generation.provider,
                    providerJobId: job.generatedOutputs[0].generation.providerJobId,
                    generatedAt: job.generatedOutputs[0].generation.generatedAt,
                  }
                : asset.generationMetadata,
            workflowType: job.workflowType,
            childAssetIds: mergeChildIds(asset.childAssetIds, job.parentChild.childAssetIds),
          };
        }

        const linkedOutput = outputById.get(asset.id);
        if (!linkedOutput) {
          return asset;
        }

        return {
          ...asset,
          title: linkedOutput.title,
          imageUrl: linkedOutput.imageUrl,
          labels: Array.from(new Set([linkedOutput.directionLabel, ...linkedOutput.tags])),
          parentAssetId: sourceAsset.id,
          generationStatus: "completed",
          generationMetadata: {
            provider: linkedOutput.generation.provider,
            providerJobId: linkedOutput.generation.providerJobId,
            generatedAt: linkedOutput.generation.generatedAt,
          },
          workflowType: linkedOutput.generation.workflowType,
          directionId: linkedOutput.directionId,
          directionLabel: linkedOutput.directionLabel,
        };
      });

      const newGeneratedAssets = orderedOutputs
        .filter((output) => !currentAssets.some((asset) => asset.id === output.id))
        .map((output, index) =>
          createGeneratedAsset(
            output,
            getGeneratedPlacement(existingGeneratedCount + index, sourceAsset.orbPlacement),
            job.updatedAt,
            constraintSettings.workflowFile,
          ),
        );

      setExtractionAlert(fallbackMessage);
      return [...updatedAssets, ...newGeneratedAssets];
    });
  }

  async function pollGenerationJob(generationJobId: string, sourceAssetId: string) {
    let consecutiveErrors = 0;

    while (isMountedRef.current) {
      try {
        const job = await getExtractionJob(generationJobId);
        if (!isMountedRef.current) {
          return;
        }

        consecutiveErrors = 0;

        setAssets((currentAssets) =>
          currentAssets.map((asset): BoardAsset =>
            asset.id === sourceAssetId
              ? {
                  ...asset,
                  generationStatus: job.status,
                  workflowType: job.workflowType,
                }
              : asset,
          ),
        );

        if (job.status === "completed") {
          integrateCompletedJob(job);
          return;
        }

        if (job.status === "failed") {
          const message = job.errorMessage ?? "Generation failed.";
          setExtractionAlert(message);
          console.error(message);
          return;
        }

        await wait(JOB_POLL_INTERVAL_MS);
      } catch (error) {
        consecutiveErrors += 1;
        if (consecutiveErrors >= 5) {
          const message = error instanceof Error ? error.message : "Unable to read extraction job status.";
          setExtractionAlert(message);
          console.error(message);
          return;
        }

        await wait(Math.min(4000, JOB_POLL_INTERVAL_MS * (consecutiveErrors + 1)));
      }
    }
  }

  async function handleExtractWithAi(sourceAsset: BoardAsset) {
    if (!sourceAsset.imageUrl) {
      return;
    }

    if (sourceAsset.generationStatus === "queued" || sourceAsset.generationStatus === "running") {
      return;
    }

    const sourceAssetId = sourceAsset.id;
    setExtractionAlert(null);
    setAssets((currentAssets) =>
      currentAssets.map((asset): BoardAsset =>
        asset.id === sourceAssetId
          ? {
              ...asset,
              generationStatus: "queued",
              workflowType: selectedWorkflowType,
            }
          : asset,
      ),
    );

    try {
      const presetWorkflowFile = getWorkflowFileForPresetIndex(activeWorkflowIndex);
      const createdJob = await requestExtraction({
        sourceAssetId,
        sourceImageUrl: sourceAsset.imageUrl,
        contextText: contextPrompt.trim() || undefined,
        workflowType: selectedWorkflowType,
        labels: sourceAsset.labels,
        constraintSettings: {
          ...constraintSettings,
          workflowFile: presetWorkflowFile,
        },
      });

      if (!isMountedRef.current) {
        return;
      }

      await pollGenerationJob(createdJob.generationJobId, sourceAssetId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Extraction request failed.";
      console.error(message);
      setExtractionAlert(message);
      setAssets((currentAssets) =>
        currentAssets.map((asset): BoardAsset =>
          asset.id === sourceAssetId
            ? {
                ...asset,
                generationStatus: "failed",
              }
            : asset,
        ),
      );
    }
  }

  useEffect(() => {
    if (!contextPrompt.trim()) {
      setContextAppliedViaAssetClick(false);
    }
  }, [contextPrompt]);

  const addToMoodboard = useCallback((assetId: string) => {
    setMoodboardEntryIds((prev) => {
      if (prev.includes(assetId)) {
        queueMicrotask(() => setMoodboardLiveMessage("Already in moodboard"));
        return prev;
      }
      queueMicrotask(() => {
        setMoodboardLastAddedId(assetId);
        setMoodboardLiveMessage("Added to moodboard");
      });
      return [...prev, assetId];
    });
  }, []);

  const removeFromMoodboard = useCallback((assetId: string) => {
    setMoodboardEntryIds((prev) => prev.filter((id) => id !== assetId));
  }, []);

  function handleSelectAsset(asset: BoardAsset) {
    setSelectedAssetId(asset.id);

    if (activeStage === "create" && contextPrompt.trim().length > 0) {
      setContextAppliedViaAssetClick(true);
    }

    if (activeStage === "curate" && collectMode && asset.imageUrl) {
      addToMoodboard(asset.id);
      return;
    }

    if (activeStage === "curate" && asset.imageUrl) {
      setLightboxAssetId(asset.id);
      return;
    }

    if (activeStage === "create") {
      void handleExtractWithAi(asset);
    }
  }

  const selectedAsset = assets.find((asset) => asset.id === selectedAssetId) ?? null;
  const moodboardAssets = moodboardEntryIds
    .map((id) => assets.find((asset) => asset.id === id))
    .filter((asset): asset is BoardAsset => asset != null);
  const hoveredAsset = lastHoveredLinkedAssetId
    ? assets.find((asset) => asset.id === lastHoveredLinkedAssetId) ?? null
    : null;
  const hoveredParentAsset =
    hoveredAsset?.kind === "generated" && hoveredAsset.parentAssetId
      ? assets.find((asset) => asset.id === hoveredAsset.parentAssetId) ?? hoveredAsset
      : hoveredAsset;
  const linkedDirectionsForHover = getLinkedDirectionAssets(assets, hoveredParentAsset);

  const captureCount = memorySphereAssets.filter((asset) => asset.kind === "captured").length;
  const queuedCount = memorySphereAssets.filter((asset) => asset.generationStatus === "queued").length;
  const runningCount = memorySphereAssets.filter((asset) => asset.generationStatus === "running").length;
  const queueBusy = activeStage === "create" && (runningCount > 0 || queuedCount > 0);

  useEffect(() => {
    if (!queueBusy) {
      setQueueFillPhase(0);
      return;
    }

    const t0 = performance.now();
    let raf = 0;
    let lastEmit = 0;

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - lastEmit < 48) {
        return;
      }
      lastEmit = now;
      setQueueFillPhase(((now - t0) % QUEUE_FILL_PERIOD_MS) / QUEUE_FILL_PERIOD_MS);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [queueBusy]);

  useLayoutEffect(() => {
    if (activeStage !== "create" || !showConstraints) {
      return;
    }

    const viewport = workflowViewportRef.current;
    if (!viewport) {
      return;
    }

    const measure = () => {
      const card = viewport.querySelector<HTMLElement>(".memory-sphere-workflow-card");
      if (!card) {
        return;
      }
      const width = card.getBoundingClientRect().width;
      setWorkflowSlideStride(width + 8);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [activeStage, showConstraints]);

  const queueStatusLine =
    runningCount > 0
      ? `${runningCount} running${queuedCount > 0 ? ` · ${queuedCount} queued` : ""}`
      : queuedCount > 0
        ? `${queuedCount} queued`
        : "";

  /** Matches server job status: running while ComfyUI work is in progress, queued only before the worker picks up the job. */
  const queueProgressLabel = runningCount > 0 ? "Running" : "Queued";

  const footerHintMessage = extractionAlert
    ? extractionAlert
    : activeStage === "create" && queueStatusLine
      ? queueStatusLine
      : null;

  return (
    <div className={`memory-sphere-app${activeStage === "converge" ? " memory-sphere-app--converge" : ""}`}>
      {activeStage === "curate" || activeStage === "create" ? (
      <MemorySphere
        assets={memorySphereAssets}
          selectedAssetId={selectedAssetId}
        settings={{
          radius: sphereRadius,
          friction: 0.96,
          minVelocity: 0.001,
          sensitivity: 0.005,
        }}
          onSelectAsset={handleSelectAsset}
          onHoverAssetChange={setLastHoveredLinkedAssetId}
          groupHubs={activeStage === "curate" ? curateGroupHubs : undefined}
          viewportResetNonce={sphereViewportResetNonce}
        />
      ) : null}

      {activeStage === "converge" ? (
        <>
          {/* Portal target for toolbar/HUD (must mount before ConvergeCanvas reads it by id) */}
          <div id="converge-floating-root" className="converge-floating-root" />
          <div className="converge-canvas-shell">
            <ConvergeCanvas
              moodboardAssets={moodboardAssets}
              cameraZoom={convergeCameraZoom}
              onCameraZoomChange={setConvergeCameraZoom}
              stylizePresetIndex={convergeStylizePresetIndex}
              onStylizePresetIndexChange={setConvergeStylizePresetIndex}
              items={convergeItems}
              onItemsChange={setConvergeItems}
              connections={convergeConnections}
              onConnectionsChange={setConvergeConnections}
              boardCamera={convergeBoardCamera}
              onBoardCameraChange={setConvergeBoardCamera}
              selectedIds={convergeSelectedIds}
              onSelectedIdsChange={setConvergeSelectedIds}
              toolMode={convergeToolMode}
              onToolModeChange={setConvergeToolMode}
              drawColor={convergeDrawColor}
              onDrawColorChange={setConvergeDrawColor}
            />
          </div>
        </>
      ) : null}

      <div className="memory-sphere-ui">
        <header className="memory-sphere-header">
          <div className="memory-sphere-header__stack">
            <DesignDiamond activeStage={activeStage} onStageChange={setActiveStage} />

            {activeStage === "curate" ? (
            <div className="memory-sphere-controls-cluster">
                <div className="memory-sphere-context-stack">
                  <div className="memory-sphere-context-head">
                    <span className="section-label" id="collect-label">
                      AI erweitert Wahrnehmung.
                    </span>
                    <div className="memory-sphere-constraints-toolbar">
                      <button
                        type="button"
                        className={`memory-sphere-constraints-trigger ${
                          showMoodboard ? "memory-sphere-constraints-trigger--active" : ""
                        }`}
                        aria-expanded={showMoodboard}
                        aria-pressed={showMoodboard}
                        aria-label="Toggle moodboard panel"
                        aria-controls="moodboard-panel"
                        onClick={() => setShowMoodboard((current) => !current)}
                      >
                        <svg
                          className="memory-sphere-constraints-trigger__icon"
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          aria-hidden="true"
                        >
                          <path d="M12 5v14M5 12h14" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  <div className="memory-sphere-context-card memory-sphere-context-card--embed-curate-send">
                <textarea
                      id="curate-group-chat"
                      className="memory-sphere-context-card__input memory-sphere-context-card__input--embed-curate-send"
                      value={curateGroupChat}
                      onChange={(event) => setCurateGroupChat(event.target.value)}
                      placeholder="Sort by keywords"
                  rows={4}
                      aria-labelledby="collect-label"
                    />
                    <button
                      type="button"
                      className="memory-sphere-curate-send-icon"
                      disabled={memorySphereAssets.length === 0}
                      aria-label={
                        curateGroupSendPhase % 3 === 0
                          ? "Apply grouping by category direction"
                          : curateGroupSendPhase % 3 === 1
                            ? "Apply grouping by origin capture"
                            : "Restore scatter from when you opened Curate"
                      }
                      onClick={handleCurateGroupSend}
                    >
                      <svg
                        className="memory-sphere-curate-send-icon__svg"
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
                      </svg>
                    </button>
                  </div>
                </div>

                {phoneCaptureInviteUrl && liveCaptureSessionId ? (
                  <PhoneCaptureInvite phoneUrl={phoneCaptureInviteUrl} sessionId={liveCaptureSessionId} />
                ) : null}

                <div
                  className={`memory-sphere-constraints-expand ${
                    showMoodboard ? "memory-sphere-constraints-expand--open" : ""
                  }`}
                >
                  <div
                    ref={moodboardPanelInnerRef}
                    className="memory-sphere-constraints-expand__inner"
                  >
                    <aside id="moodboard-panel" className="memory-sphere-constraints-card">
                      <div className="memory-sphere-constraints-card__header">
                        <span className="section-label">Moodboard</span>
              <button
                          type="button"
                          className={`memory-sphere-constraints-card__status memory-sphere-constraints-card__status--action ${
                            collectMode ? "memory-sphere-constraints-card__status--collecting" : ""
                          }`}
                          aria-pressed={collectMode}
                          onClick={() => setCollectMode((current) => !current)}
                        >
                          {collectMode ? "Collecting" : "Start collecting"}
                        </button>
                      </div>

                      <div className="memory-sphere-constraints-card__content">
                        <div className="memory-sphere-moodboard-stack">
                          <p className="memory-sphere-moodboard-live" aria-live="polite" aria-atomic="true">
                            {moodboardLiveMessage}
                          </p>

                          <div
                            className="memory-sphere-moodboard-rail"
                            aria-label="Collected moodboard thumbnails"
                          >
                            {moodboardEntryIds.length === 0 ? (
                              <p className="memory-sphere-moodboard-empty">
                                No images yet.
                              </p>
                            ) : (
                              moodboardEntryIds.map((entryId) => {
                                const entryAsset = assets.find((a) => a.id === entryId);
                                if (!entryAsset?.imageUrl) {
                                  return null;
                                }
                                return (
                                  <div
                                    key={entryId}
                                    className={`memory-sphere-moodboard-thumb ${
                                      moodboardLastAddedId === entryId
                                        ? "memory-sphere-moodboard-thumb--enter"
                                        : ""
                                    }`}
                                  >
                                    <img src={entryAsset.imageUrl} alt="" />
                                    <span className="memory-sphere-moodboard-thumb__keyword">
                                      {moodboardKeywordFromAsset(entryAsset)}
                                    </span>
                                    <button
                type="button"
                                      className="memory-sphere-moodboard-thumb__remove"
                                      aria-label={`Remove from moodboard: ${entryAsset.title}`}
                                      onClick={() => removeFromMoodboard(entryId)}
                                    >
                                      ×
                                    </button>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      </div>
                    </aside>
                  </div>
                </div>
              </div>
            ) : null}

            {activeStage === "create" ? (
              <div className="memory-sphere-controls-cluster">
                <div className="memory-sphere-context-stack">
                  <div className="memory-sphere-context-head">
                    <span className="section-label" id="context-label">
                        AI erweitert Möglichkeiten.
                    </span>
                    <div className="memory-sphere-constraints-toolbar">
                      <button
                        type="button"
                        className={`memory-sphere-constraints-trigger ${
                          showConstraints ? "memory-sphere-constraints-trigger--active" : ""
                        }`}
                aria-expanded={showConstraints}
                        aria-pressed={showConstraints}
                        aria-label="Toggle constraints panel"
                aria-controls="constraints-panel"
                onClick={() => setShowConstraints((current) => !current)}
              >
                        <svg
                          className="memory-sphere-constraints-trigger__icon"
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          aria-hidden="true"
                        >
                          <path d="M12 5v14M5 12h14" />
                        </svg>
              </button>
                    </div>
                  </div>
                  <label className="memory-sphere-context-card">
                    <textarea
                      id="context-prompt-input"
                      className="memory-sphere-context-card__input"
                      value={contextPrompt}
                      onChange={(event) => setContextPrompt(event.target.value)}
                      placeholder="Provide additional context"
                      rows={4}
                      aria-labelledby="context-label"
                    />
                  </label>
                </div>

                <div
                  className={`memory-sphere-constraints-expand ${
                    showConstraints ? "memory-sphere-constraints-expand--open" : ""
                  }`}
                >
                  <div
                    ref={constraintsPanelInnerRef}
                    className="memory-sphere-constraints-expand__inner"
                  >
              <aside
                id="constraints-panel"
                      className="memory-sphere-constraints-card"
              >
                <div className="memory-sphere-constraints-card__header">
                    <span className="section-label">Workflows</span>
                    <span className="memory-sphere-constraints-card__status">View library</span>
                </div>

                <div className="memory-sphere-constraints-card__content">
                  <section className="memory-sphere-workflow-carousel" aria-label="Workflow gallery">
                      <div ref={workflowViewportRef} className="memory-sphere-workflow-carousel__viewport">
                        <div
                          className="memory-sphere-workflow-carousel__rail"
                          style={{
                            transform: `translateX(-${workflowCarouselIndex * workflowSlideStride}px)`,
                          }}
                        >
                      {WORKFLOW_PRESETS.map((workflow, index) => (
                        <article
                          key={workflow.id}
                          className={`memory-sphere-workflow-card ${
                            index === activeWorkflowIndex
                              ? "memory-sphere-workflow-card--active"
                              : ""
                          }`}
                          tabIndex={0}
                              onClick={() => selectWorkflowPreset(index)}
                          onKeyDown={(event) => handleWorkflowCardKeyDown(event, index)}
                        >
                          <div
                                className="memory-sphere-workflow-card__media memory-sphere-workflow-card__media--photo"
                            style={{
                                  ["--wf-a" as unknown as string]: workflow.paletteA,
                                  ["--wf-b" as unknown as string]: workflow.paletteB,
                                  ["--wf-thumb" as unknown as string]: `url("${workflow.thumbnailUrl}")`,
                            }}
                          >
                                <div className="memory-sphere-workflow-card__hover-actions">
                            <button
                              type="button"
                                    className="memory-sphere-workflow-card__icon-btn"
                                    title="Open"
                                    aria-label="Open"
                                    onClick={(event) => event.stopPropagation()}
                                  >
                                    <svg
                                      width="14"
                                      height="14"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                      aria-hidden="true"
                                    >
                                      <path d="M7 17L17 7M7 7h10v10" />
                                    </svg>
                            </button>
                                  <button
                                    type="button"
                                    className="memory-sphere-workflow-card__icon-btn"
                                    title="Customize"
                                    aria-label="Customize"
                                    onClick={(event) => event.stopPropagation()}
                                  >
                                    <svg
                                      width="14"
                                      height="14"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      aria-hidden="true"
                                    >
                                      <path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
                                    </svg>
                                  </button>
                                </div>
                            <div className="memory-sphere-workflow-card__overlay">
                              <strong>{workflow.name}</strong>
                              <span>Shared by {workflow.designer}</span>
                                  <div className="memory-sphere-workflow-card__file">
                                    <span className="memory-sphere-workflow-card__file-name" title={workflow.workflowFile}>
                                      {workflow.workflowFile}
                                    </span>
                                  </div>
                            </div>
                          </div>
                        </article>
                      ))}
                        </div>
                    </div>

                      <div className="memory-sphere-workflow-carousel__controls memory-sphere-workflow-carousel__controls--dots-only">
                      <div className="memory-sphere-workflow-carousel__dots">
                        {WORKFLOW_PRESETS.map((workflow, index) => (
                          <button
                            key={workflow.id}
                            type="button"
                            className={`memory-sphere-workflow-carousel__dot ${
                              index === activeWorkflowIndex
                                ? "memory-sphere-workflow-carousel__dot--active"
                                : ""
                            }`}
                            aria-label={`Select ${workflow.name}`}
                              aria-current={index === activeWorkflowIndex ? "true" : undefined}
                              onClick={() => selectWorkflowPreset(index)}
                          />
                        ))}
                      </div>
                    </div>
                  </section>
                </div>
              </aside>
            </div>
                </div>
              </div>
            ) : null}

            {activeStage === "converge" ? (
              <div className="memory-sphere-controls-cluster">
                <div className="memory-sphere-context-stack">
                  <div className="memory-sphere-context-head memory-sphere-context-head--converge">
                    <div className="memory-sphere-context-headline">
                      <span className="section-label" id="context-label">
                        AI beschleunigt Qualität.
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

          </div>
        </header>

        <div className="memory-sphere-center" />

        <footer className="memory-sphere-footer">
          <div className="memory-sphere-footer__left">
          {activeStage !== "converge" ? (
          <div className="memory-sphere-footer__meta">
              <span className="lab-hero-metric" aria-hidden="true">
                {String(captureCount).padStart(2, "0")}
              </span>
              <span className="memory-sphere-footer__meta-copy">
                captures
              </span>
          </div>
          ) : null}
            {queueBusy ? (
              <div className="lab-queue-progress" role="status" aria-label={`Extraction: ${queueStatusLine}`}>
                <span className="section-label lab-queue-progress__label">{queueProgressLabel}</span>
                <div className="lab-segmented-progress">
                  {Array.from({ length: QUEUE_SEGMENTS }, (_, i) => (
                    <span key={i} className="lab-segmented-progress__seg">
                      <span
                        className="lab-segmented-progress__fill"
                        style={{
                          transform: `scaleX(${queueSegmentFill(queueFillPhase, i, QUEUE_SEGMENTS)})`,
                        }}
                      />
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            {footerHintMessage ? (
              <div
                className={`memory-sphere-footer__hint ${
                  extractionAlert ? "memory-sphere-footer__hint--error" : ""
                }`}
              >
                {footerHintMessage}
              </div>
            ) : null}

            {activeStage === "curate" && linkedDirectionsForHover.length > 0 ? (
              <section className="memory-sphere-footer__directions memory-sphere-footer__directions--hover-reveal">
                <span className="section-label">Linked directions</span>
                <div className="memory-sphere-footer__direction-list">
                  {linkedDirectionsForHover.map((asset) => (
                    <button
                      key={asset.id}
                      type="button"
                      className={`memory-sphere-footer__direction-item ${
                        selectedAssetId === asset.id
                          ? "memory-sphere-footer__direction-item--active"
                          : ""
                      }`}
                      onClick={() => {
                        setSelectedAssetId(asset.id);
                        if (activeStage === "curate" && collectMode && asset.imageUrl) {
                          addToMoodboard(asset.id);
                          return;
                        }
                        if (asset.imageUrl) {
                          setLightboxAssetId(asset.id);
                        }
                      }}
                    >
                      <img src={asset.imageUrl} alt={asset.title} />
                      <span className="memory-sphere-footer__direction-chip">
                        {directionLabelFromAsset(asset)}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}
          </div>

          <div className="memory-sphere-footer__panel memory-sphere-view-settings" role="group" aria-label="View">
            {activeStage === "converge" ? (
              <label className="memory-sphere-view-settings__field" htmlFor="converge-zoom">
                <span className="memory-sphere-view-settings__globe" aria-hidden>
                  <svg
                    className="memory-sphere-view-settings__globe-svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <circle
                      cx="11"
                      cy="11"
                      r="6.5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      fill="none"
                    />
                    <path
                      d="M16 16l4.5 4.5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
                <input
                  id="converge-zoom"
                  className="memory-sphere-view-settings__range"
                  type="range"
                  min={CONVERGE_ZOOM_MIN}
                  max={CONVERGE_ZOOM_MAX}
                  step="0.01"
                  value={convergeCameraZoom}
                  onChange={(event) =>
                    setConvergeCameraZoom(Number.parseFloat(event.target.value))
                  }
                  aria-label="Canvas zoom"
                  style={
                    {
                      "--view-settings-range-fill": `${
                        ((convergeCameraZoom - CONVERGE_ZOOM_MIN) /
                          (CONVERGE_ZOOM_MAX - CONVERGE_ZOOM_MIN)) *
                        100
                      }%`,
                    } as React.CSSProperties
                  }
                />
              </label>
            ) : (
              <label className="memory-sphere-view-settings__field" htmlFor="prop-size">
                <span className="memory-sphere-view-settings__globe" aria-hidden>
                  <svg
                    className="memory-sphere-view-settings__globe-svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" fill="none" />
                    <path
                      d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"
                      stroke="currentColor"
                      strokeWidth="1.25"
                      fill="none"
                    />
                    <path
                      d="M2 12h20"
                      stroke="currentColor"
                      strokeWidth="1.25"
                      strokeLinecap="round"
                      fill="none"
                    />
                  </svg>
                </span>
              <input
                id="prop-size"
                  className="memory-sphere-view-settings__range"
                type="range"
                min="400"
                max="1200"
                value={sphereRadius}
                onChange={(event) => setSphereRadius(Number.parseInt(event.target.value, 10))}
                  aria-label="Sphere size"
                  style={
                    {
                      "--view-settings-range-fill": `${((sphereRadius - 400) / (1200 - 400)) * 100}%`,
                    } as React.CSSProperties
                  }
              />
            </label>
            )}
            <ThemeToggle variant="embedded" />
          </div>
        </footer>
      </div>

      <CropStudio
        asset={cropTargetAsset}
        onClose={() => setCropTargetAssetId(null)}
        onCreateCrop={handleCreateCrop}
      />
      <ImageLightbox
        assets={memorySphereAssets}
        activeAssetId={lightboxAssetId}
        onClose={() => setLightboxAssetId(null)}
        onChangeAsset={setLightboxAssetId}
      />
    </div>
  );
}
