import type {
  ConstraintSettings,
  GeneratedDirectionId,
  GenerationStatus,
  WorkflowType,
} from "./assets";

export type ExtractionProvider = "mock" | "comfyui";

export type ExtractRequest = {
  sourceAssetId: string;
  sourceImageUrl: string;
  contextText?: string;
  workflowType?: WorkflowType;
  labels?: string[];
  constraintSettings?: ConstraintSettings;
};

export type GeneratedOutput = {
  id: string;
  title: string;
  imageUrl: string;
  caption: string;
  tags: string[];
  parentAssetId: string;
  directionId: GeneratedDirectionId;
  directionLabel: string;
  generation: {
    provider: ExtractionProvider;
    providerJobId?: string;
    generatedAt: string;
    workflowType: WorkflowType;
  };
};

export type ParentChildRelationship = {
  parentAssetId: string;
  childAssetIds: string[];
};

export type GenerationJobStatus = Exclude<GenerationStatus, "idle">;

export type GenerationLifecycleEvent = {
  status: GenerationJobStatus;
  timestamp: string;
};

export type ExtractionJobResponse = {
  sourceAssetId: string;
  generationJobId: string;
  status: GenerationJobStatus;
  workflowType: WorkflowType;
  provider?: ExtractionProvider;
  providerJobId?: string;
  fallbackReason?: string;
  errorMessage?: string;
  generatedOutputs: GeneratedOutput[];
  parentChild: ParentChildRelationship;
  createdAt: string;
  updatedAt: string;
  lifecycle: GenerationLifecycleEvent[];
};
