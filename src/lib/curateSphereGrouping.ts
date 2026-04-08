import type { BoardAsset, GeneratedDirectionId, OrbPlacement, WorkflowType } from "../types/assets";

/** Six direction dimensions + bucket for unclassified assets. */
export type CurateGroupKey =
  | "spatial"
  | "tactile"
  | "experiential"
  | "interface"
  | "installation"
  | "wearable"
  | "unsorted";

export type CurateHubVariant = "category" | "origin";

export type CurateGroupHub = {
  id: string;
  label: string;
  position: { x: number; y: number; z: number };
  variant: CurateHubVariant;
  /** Origin mode: root capture preview. */
  imageUrl?: string;
};

const DIRECTION_GROUPS: GeneratedDirectionId[] = [
  "spatial",
  "tactile",
  "experiential",
  "interface",
  "installation",
  "wearable",
];

export const CURATE_GROUP_DISPLAY: Record<CurateGroupKey, string> = {
  spatial: "Spatial",
  tactile: "Tactile",
  experiential: "Experiential",
  interface: "Interface",
  installation: "Installation",
  wearable: "Wearable",
  unsorted: "Unsorted",
};

const CHAT_PATTERNS: Array<{ key: CurateGroupKey; pattern: RegExp }> = [
  { key: "spatial", pattern: /\bspatial\b/i },
  { key: "tactile", pattern: /\btactile\b/i },
  { key: "experiential", pattern: /\bexperiential\b/i },
  { key: "interface", pattern: /\binterface\b/i },
  { key: "installation", pattern: /\binstallation\b/i },
  { key: "wearable", pattern: /\bwearable\b/i },
];

/** Keyword hints when metadata is missing (captures / crops). */
const LABEL_HINTS: Array<{ key: CurateGroupKey; words: string[] }> = [
  { key: "spatial", words: ["spatial", "form", "mass", "silhouette", "structure"] },
  { key: "tactile", words: ["tactile", "texture", "material", "surface", "cmf"] },
  { key: "experiential", words: ["experiential", "atmospheric", "light", "mood", "pattern"] },
  { key: "interface", words: ["interface", "ui", "display", "hud"] },
  { key: "installation", words: ["installation", "room", "immersive", "environment"] },
  { key: "wearable", words: ["wearable", "body", "gesture", "fashion"] },
];

/**
 * If the user names groups in chat, only those sectors (+ Unsorted) are used; assets whose
 * natural group is not listed are remapped to `unsorted`.
 * Returns null when the message is empty → caller uses all groups that appear in asset assignments.
 */
export function parseRequestedGroups(chat: string): CurateGroupKey[] | null {
  const trimmed = chat.trim();
  if (!trimmed) {
    return null;
  }

  const found = new Set<CurateGroupKey>();
  for (const { key, pattern } of CHAT_PATTERNS) {
    if (pattern.test(trimmed)) {
      found.add(key);
    }
  }

  return found.size > 0 ? Array.from(found) : null;
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

function workflowTypeToDefaultGroup(workflowType: WorkflowType): CurateGroupKey {
  if (workflowType === "shape") {
    return "spatial";
  }
  if (workflowType === "texture") {
    return "tactile";
  }
  return "experiential";
}

/**
 * Deterministic group from asset metadata; captures/crops with no signals → unsorted.
 */
export function assignAssetToGroup(asset: BoardAsset): CurateGroupKey {
  if (asset.directionId && DIRECTION_GROUPS.includes(asset.directionId)) {
    return asset.directionId as CurateGroupKey;
  }

  const label = `${asset.directionLabel ?? ""} ${asset.labels.join(" ")}`.toLowerCase();

  if (/\binterface\b/.test(label)) {
    return "interface";
  }
  if (/\binstallation\b/.test(label)) {
    return "installation";
  }
  if (/\bwearable\b/.test(label)) {
    return "wearable";
  }
  if (/\bspatial\b/.test(label)) {
    return "spatial";
  }
  if (/\btactile\b/.test(label)) {
    return "tactile";
  }
  if (/\bexperiential\b/.test(label)) {
    return "experiential";
  }

  if (asset.workflowType) {
    return workflowTypeToDefaultGroup(asset.workflowType);
  }

  const haystack = `${asset.title} ${asset.labels.join(" ")}`.toLowerCase();
  let best: CurateGroupKey | null = null;
  let bestScore = 0;
  for (const { key, words } of LABEL_HINTS) {
    const score = words.reduce((acc, w) => (haystack.includes(w) ? acc + 1 : acc), 0);
    if (score > bestScore) {
      bestScore = score;
      best = key;
    }
  }
  if (best && bestScore > 0) {
    return best;
  }

  return "unsorted";
}

/**
 * If direct metadata yields `unsorted`, walk parents and reuse the first ancestor with a
 * concrete category (direction / labels / workflowType).
 */
function assignAssetToGroupWithFallback(
  asset: BoardAsset,
  assetsById: Map<string, BoardAsset>,
): CurateGroupKey {
  let g = assignAssetToGroup(asset);
  if (g !== "unsorted") {
    return g;
  }

  let parentId = asset.parentAssetId;
  while (parentId) {
    const parent = assetsById.get(parentId);
    if (!parent) {
      break;
    }
    g = assignAssetToGroup(parent);
    if (g !== "unsorted") {
      return g;
    }
    parentId = parent.parentAssetId;
  }

  return "unsorted";
}

function resolveRootCapture(
  asset: BoardAsset,
  assetsById: Map<string, BoardAsset>,
): BoardAsset {
  let current: BoardAsset | undefined = asset;
  const seen = new Set<string>();

  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.kind === "captured") {
      return current;
    }
    if (!current.parentAssetId) {
      return current;
    }
    const parent = assetsById.get(current.parentAssetId);
    if (!parent) {
      return current;
    }
    current = parent;
  }

  return asset;
}

/**
 * If the user requested specific groups in chat, remap assets not in that set to `unsorted`.
 */
function resolveFinalGroup(
  natural: CurateGroupKey,
  requested: CurateGroupKey[] | null,
): CurateGroupKey {
  if (!requested || requested.length === 0) {
    return natural;
  }
  if (natural === "unsorted") {
    return "unsorted";
  }
  if (requested.includes(natural)) {
    return natural;
  }
  return "unsorted";
}

/**
 * Keyword at sector center; assets spawn outward in a ring (tangent to sphere) so they read as
 * orbiting the hub label.
 */
function placementForCategoryAroundKeyword(
  groupSlot: number,
  totalGroups: number,
  indexInGroup: number,
  countInGroup: number,
): OrbPlacement {
  const sectorWidth = 360 / Math.max(totalGroups, 1);
  const baseAzimuth = -180 + groupSlot * sectorWidth + sectorWidth * 0.5;
  const hubElevation = -6;
  const t = indexInGroup + 1;
  const golden = halton(t, 2) * Math.PI * 2;
  const ringAngle = (indexInGroup / Math.max(countInGroup, 1)) * Math.PI * 2 + golden;

  const ringRadiusDeg =
    countInGroup <= 1 ? 0 : 8 + (indexInGroup / Math.max(countInGroup - 1, 1)) * 26;

  const spreadAz = Math.cos(ringAngle) * ringRadiusDeg;
  const spreadEl = Math.sin(ringAngle) * ringRadiusDeg * 0.58;

  return {
    azimuth: normalizeAngle(baseAzimuth + spreadAz),
    elevation: Math.max(-48, Math.min(42, hubElevation + spreadEl)),
    depth: 0.7 + halton(t, 3) * 0.2 + indexInGroup * 0.02,
    scale: Math.max(0.62, 0.9 - indexInGroup * 0.022),
    lane: (["surface", "inner", "halo"] as const)[indexInGroup % 3],
    phase: halton(t, 5),
  };
}

/** Origin capture hub: same radial spawn pattern for consistency. */
function placementForOriginAroundHub(
  groupSlot: number,
  totalGroups: number,
  indexInGroup: number,
  countInGroup: number,
): OrbPlacement {
  return placementForCategoryAroundKeyword(
    groupSlot,
    totalGroups,
    indexInGroup,
    countInGroup,
  );
}

/** Hub sits slightly inward toward the origin vs card ring (visual cluster anchor). */
export function hubPositionForGroupSlot(
  groupSlot: number,
  totalGroups: number,
  sphereRadius: number,
): { x: number; y: number; z: number } {
  const sectorWidth = 360 / Math.max(totalGroups, 1);
  const baseAzimuth = -180 + groupSlot * sectorWidth + sectorWidth * 0.5;
  const azimuth = THREE_DEG_TO_RAD(baseAzimuth);
  const elevation = THREE_DEG_TO_RAD(-6);
  const radialDistance = sphereRadius * 0.82;

  const x = radialDistance * Math.sin(azimuth) * Math.cos(elevation);
  const y = radialDistance * Math.sin(elevation);
  const z = radialDistance * Math.cos(azimuth) * Math.cos(elevation);

  return { x, y, z };
}

function THREE_DEG_TO_RAD(deg: number) {
  return (deg * Math.PI) / 180;
}

export function applyCurateGrouping(
  assets: BoardAsset[],
  chat: string,
  sphereRadius: number,
): { nextAssets: BoardAsset[]; hubs: CurateGroupHub[] } {
  if (assets.length === 0) {
    return { nextAssets: [], hubs: [] };
  }

  const requested = parseRequestedGroups(chat);
  const assetsById = new Map(assets.map((a) => [a.id, a]));

  const naturalById = new Map<string, CurateGroupKey>();
  for (const asset of assets) {
    naturalById.set(asset.id, assignAssetToGroupWithFallback(asset, assetsById));
  }

  const finalById = new Map<string, CurateGroupKey>();
  for (const asset of assets) {
    const natural = naturalById.get(asset.id) ?? "unsorted";
    finalById.set(asset.id, resolveFinalGroup(natural, requested));
  }

  let activeKeys = Array.from(new Set(finalById.values()));
  if (!requested) {
    activeKeys = activeKeys.filter((k) => {
      const hasAsset = assets.some((a) => finalById.get(a.id) === k);
      return hasAsset;
    });
  } else {
    const allowed = new Set<CurateGroupKey>([...requested, "unsorted"]);
    activeKeys = activeKeys.filter((k) => allowed.has(k));
  }

  const ORDER: CurateGroupKey[] = [
    "spatial",
    "tactile",
    "experiential",
    "interface",
    "installation",
    "wearable",
    "unsorted",
  ];
  activeKeys.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));

  const groupSlot = new Map<CurateGroupKey, number>();
  activeKeys.forEach((key, index) => {
    groupSlot.set(key, index);
  });

  const idsByGroup = new Map<CurateGroupKey, string[]>();
  for (const key of activeKeys) {
    idsByGroup.set(key, []);
  }
  for (const asset of assets) {
    const g = finalById.get(asset.id) ?? "unsorted";
    const list = idsByGroup.get(g);
    if (list) {
      list.push(asset.id);
    }
  }
  for (const list of idsByGroup.values()) {
    list.sort((a, b) => a.localeCompare(b));
  }

  const placements = new Map<string, OrbPlacement>();
  const totalGroups = activeKeys.length;

  for (const [, ids] of idsByGroup) {
    const count = ids.length;
    ids.forEach((assetId, idxInGroup) => {
      const g = finalById.get(assetId) ?? "unsorted";
      const slot = groupSlot.get(g) ?? 0;
      placements.set(
        assetId,
        placementForCategoryAroundKeyword(slot, totalGroups, idxInGroup, count),
      );
    });
  }

  const hubs: CurateGroupHub[] = activeKeys.map((key) => {
    const slot = groupSlot.get(key) ?? 0;
    return {
      id: key,
      label: CURATE_GROUP_DISPLAY[key],
      position: hubPositionForGroupSlot(slot, totalGroups, sphereRadius),
      variant: "category" as const,
    };
  });

  const nextAssets = assets.map((asset) => ({
    ...asset,
    orbPlacement: placements.get(asset.id) ?? asset.orbPlacement,
  }));

  return { nextAssets, hubs };
}

/**
 * Group board assets by root source capture (walk `parentAssetId` to `kind === "captured"`).
 * Hub shows the capture thumbnail + title.
 */
export function applyOriginGrouping(
  assets: BoardAsset[],
  sphereRadius: number,
): { nextAssets: BoardAsset[]; hubs: CurateGroupHub[] } {
  if (assets.length === 0) {
    return { nextAssets: [], hubs: [] };
  }

  const assetsById = new Map(assets.map((a) => [a.id, a]));

  const rootByAssetId = new Map<string, BoardAsset>();
  for (const asset of assets) {
    rootByAssetId.set(asset.id, resolveRootCapture(asset, assetsById));
  }

  const rootIdForAsset = (assetId: string) => rootByAssetId.get(assetId)!.id;

  const activeKeys = Array.from(new Set([...rootByAssetId.values()].map((r) => r.id))).sort((a, b) =>
    a.localeCompare(b),
  );

  const groupSlot = new Map<string, number>();
  activeKeys.forEach((key, index) => {
    groupSlot.set(key, index);
  });

  const idsByGroup = new Map<string, string[]>();
  for (const key of activeKeys) {
    idsByGroup.set(key, []);
  }
  for (const asset of assets) {
    const g = rootIdForAsset(asset.id);
    idsByGroup.get(g)?.push(asset.id);
  }
  for (const list of idsByGroup.values()) {
    list.sort((a, b) => a.localeCompare(b));
  }

  const totalGroups = activeKeys.length;
  const placements = new Map<string, OrbPlacement>();

  for (const [, ids] of idsByGroup) {
    const count = ids.length;
    ids.forEach((assetId, idxInGroup) => {
      const g = rootIdForAsset(assetId);
      const slot = groupSlot.get(g) ?? 0;
      placements.set(
        assetId,
        placementForOriginAroundHub(slot, totalGroups, idxInGroup, count),
      );
    });
  }

  const hubs: CurateGroupHub[] = activeKeys.map((rootId) => {
    const root =
      assetsById.get(rootId) ?? [...rootByAssetId.values()].find((r) => r.id === rootId) ?? null;
    const slot = groupSlot.get(rootId) ?? 0;
    const label = root?.title?.trim() || "Capture";
    return {
      id: `origin-${rootId}`,
      label,
      position: hubPositionForGroupSlot(slot, totalGroups, sphereRadius),
      variant: "origin" as const,
      imageUrl: root?.imageUrl,
    };
  });

  const nextAssets = assets.map((asset) => ({
    ...asset,
    orbPlacement: placements.get(asset.id) ?? asset.orbPlacement,
  }));

  return { nextAssets, hubs };
}
