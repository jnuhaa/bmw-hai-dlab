import type { BoardAsset } from "../types/assets";

type CropSelection = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const captureLabelSets = [
  ["soft enclosure", "protective arc", "calm surface"],
  ["supportive contour", "layered shelter", "quiet confidence"],
  ["guided transition", "reassuring edge", "stable rhythm"],
  ["ambient protection", "cocooning form", "gentle gradient"],
  ["contained opening", "secure framing", "soft reflection"],
];

const ingredientPrimaryLabels = {
  wide: "protective band",
  tall: "vertical shield",
  balanced: "contained aperture",
} as const;

const ingredientScaleLabels = {
  small: "micro detail",
  medium: "transition detail",
  large: "broad support",
} as const;

export function getMockLabelsForCapture(captureIndex: number) {
  return captureLabelSets[captureIndex % captureLabelSets.length];
}

export function getMockLabelsForIngredient(
  selection: CropSelection,
  sourceAsset: BoardAsset,
  ingredientIndex: number,
) {
  const aspectRatio = selection.width / Math.max(selection.height, 0.001);
  const area = selection.width * selection.height;

  const orientationLabel =
    aspectRatio > 1.35
      ? ingredientPrimaryLabels.wide
      : aspectRatio < 0.8
        ? ingredientPrimaryLabels.tall
        : ingredientPrimaryLabels.balanced;

  const scaleLabel =
    area < 0.09
      ? ingredientScaleLabels.small
      : area > 0.2
        ? ingredientScaleLabels.large
        : ingredientScaleLabels.medium;

  const inheritedLabel =
    sourceAsset.labels[ingredientIndex % Math.max(sourceAsset.labels.length, 1)] ??
    "material cue";

  return [orientationLabel, scaleLabel, inheritedLabel];
}
