export type OrbPlacement = {
  azimuth: number;
  elevation: number;
  depth: number;
  scale: number;
  lane: "surface" | "inner" | "halo";
  phase: number;
};

export type AssetKind = "captured" | "crop" | "generated";

export type WorkflowType = "shape" | "texture" | "pattern";
export type GeneratedDirectionId =
  | "spatial"
  | "tactile"
  | "experiential"
  | "interface"
  | "installation"
  | "wearable";

export type GenerationStatus = "idle" | "queued" | "running" | "completed" | "failed";

export type GenerationMetadata = {
  provider: "mock" | "comfyui";
  providerJobId?: string;
  generatedAt: string;
};

export type ConstraintSettings = {
  workflowFile: string;
  edgeHold: boolean;
  textureBias: boolean;
  seedLock: boolean;
  guidance: number;
};

export type BoardAsset = {
  id: string;
  title: string;
  kind: AssetKind;
  parentAssetId: string | null;
  childAssetIds: string[];
  labels: string[];
  tone: "sand" | "mist" | "olive" | "slate" | "captured" | "ingredient";
  size: "small" | "medium" | "large";
  imageUrl?: string;
  generationStatus: GenerationStatus;
  generationMetadata?: GenerationMetadata;
  workflowType: WorkflowType | null;
  directionId?: GeneratedDirectionId | null;
  directionLabel?: string | null;
  createdAt: string;
  orbPlacement: OrbPlacement;
  entryMotion?: "desktop" | "phone" | "crop";
};
