import type { BoardAsset } from "../../types/assets";

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

type SphereProjectionOptions = {
  pointerDrift: { x: number; y: number };
  isActive?: boolean;
};

export type SphereProjection = {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  tiltX: number;
  tiltY: number;
  driftX: number;
  driftY: number;
  frontness: number;
  opacity: number;
  blur: number;
  shadowDepth: number;
  hemisphere: "front" | "rear";
};

export function getShardDimensions(asset: BoardAsset) {
  if (asset.size === "large") {
    return { width: 144, height: 188 };
  }

  if (asset.size === "medium") {
    return { width: 116, height: 150 };
  }

  return { width: 88, height: 118 };
}

export function getSphereProjection(
  asset: BoardAsset,
  { pointerDrift, isActive = false }: SphereProjectionOptions,
): SphereProjection {
  const placement = asset.orbPlacement;
  const azimuthRadians = (placement.azimuth * Math.PI) / 180;
  const elevationRadians = (placement.elevation * Math.PI) / 180;
  const laneRadius =
    placement.lane === "halo" ? 39.5 : placement.lane === "inner" ? 27 : 33.5;
  const verticalRadius =
    placement.lane === "halo" ? 31.5 : placement.lane === "inner" ? 23 : 27.5;
  const frontness = clamp(
    Math.cos(azimuthRadians) * 0.42 +
      (1 - Math.abs(placement.elevation) / 90) * 0.34 +
      placement.depth * 0.48,
    0.08,
    1.15,
  );
  const x = 50 + Math.sin(azimuthRadians) * Math.cos(elevationRadians) * laneRadius;
  const y = 50 + Math.sin(elevationRadians) * verticalRadius;
  const scale = placement.scale * (0.7 + frontness * 0.44) * (isActive ? 1.16 : 1);
  const rotation = placement.azimuth * 0.22;
  const tiltX = -placement.elevation * 0.24 + pointerDrift.y * -9;
  const tiltY = placement.azimuth * 0.22 + pointerDrift.x * 13;
  const driftX = pointerDrift.x * (8 + frontness * 14);
  const driftY = pointerDrift.y * (6 + frontness * 12);
  const hemisphere = frontness > 0.62 ? "front" : "rear";
  const opacity = hemisphere === "front"
    ? 0.44 + frontness * 0.5
    : 0.14 + frontness * 0.34;
  const blur = hemisphere === "front"
    ? Math.max(0, (0.52 - frontness) * 4)
    : Math.max(1.2, (0.72 - frontness) * 8);
  const shadowDepth = clamp(frontness * 0.8, 0.12, 1);

  return {
    x,
    y,
    scale,
    rotation,
    tiltX,
    tiltY,
    driftX,
    driftY,
    frontness,
    opacity,
    blur,
    shadowDepth,
    hemisphere,
  };
}
