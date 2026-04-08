import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WORKFLOWS_DIR_URL = new URL("../../comfy/workflows/", import.meta.url);
const DEFAULT_WORKFLOW_BASENAME = "sculptural_essence_3way_api.json";
/** When this workflow runs from the app, keep baked-in CLIP text (DeepMind-style art direction). */
const INTERIOR_UXUI_WORKFLOW_BASENAME = "interior_uxui_3way_api.json";
/** Abstract preset: `buildPromptScaffold` already embeds context — do not append `contextCue` again. */
const ABSTRACT_INGREDIENT_WORKFLOW_BASENAME = "abstract_ingredient_extractor_3way_api.json";

/**
 * FIELD-inspired language for dynamic (abstract-ingredient) extraction prompts.
 * Principles: form / texture / light / depth; controlled abstraction; modular systems — not brand imitation.
 */
const FIELD_BASE =
  "Translate the source into a high-end generative design language: immersive systems, responsive environments, experimental visual identity. Do not recreate the source literally. Extract and reinterpret form, texture, light, and depth. Controlled abstraction, clear hierarchy, minimal staging, continuous surface logic, refined materials, cinematic light, soft gradients, volumetric depth. Intentional, modular, system-driven; not expressive chaos. No generic AI-art noise. No recognizable branded object.";

/** Appended to each direction when Soft Volume / abstract-ingredient workflow runs. */
const FIELD_ABSTRACT_EXTERIOR_LENS =
  "Large-scale visual clarity: modular display field, architectural integration of surface and light, bold minimal contrast, dynamic composition within restraint — still abstract and non-literal, not a documentary exterior photograph.";

/** Injection map for 3× CLIP + 3× KSampler + 3× SaveImage graphs. */
const THREE_WAY_CLIP_HINTS = {
  promptNodeIds: ["4", "5", "6"],
  negativePromptNodeIds: ["7"],
  samplerNodeIds: ["8", "9", "10"],
  saveNodeIds: ["14", "15", "16"],
  outputNodeIds: ["14", "15", "16"],
};

/** Legacy ControlNet dual-pass graph (older sculptural JSON with SaveImage nodes 31–33). */
const LEGACY_SCULPTURAL_CONTROLNET_HINTS = {
  promptNodeIds: ["6", "7", "8"],
  negativePromptNodeIds: ["9", "10", "11", "12"],
  samplerNodeIds: ["16", "17", "18", "25", "26", "27"],
  saveNodeIds: ["31", "32", "33"],
  outputNodeIds: ["31", "32", "33"],
};

/** interior_uxui_3way_api.json & sculptural_essence_3way_api.json — 3× CLIP + 3× KSampler + 3× SaveImage + scale. */
const INTERIOR_UXUI_3WAY_HINTS = {
  promptNodeIds: ["4", "5", "6"],
  negativePromptNodeIds: ["7", "8", "9"],
  samplerNodeIds: ["10", "11", "12"],
  saveNodeIds: ["16", "17", "18"],
  outputNodeIds: ["16", "17", "18"],
};

const WORKFLOW_HINTS_BY_BASENAME = {
  [DEFAULT_WORKFLOW_BASENAME]: INTERIOR_UXUI_3WAY_HINTS,
  [ABSTRACT_INGREDIENT_WORKFLOW_BASENAME]: THREE_WAY_CLIP_HINTS,
  "interior_uxui_3way_api.json": INTERIOR_UXUI_3WAY_HINTS,
};

/** Default 3-way labels for sculptural / abstract workflows (maps to shape / texture / pattern). */
const DIRECTION_SEQUENCE = [
  {
    id: "spatial",
    label: "Spatial",
    workflowType: "shape",
    title: "Spatial",
    caption: "spatial exploration",
  },
  {
    id: "tactile",
    label: "Tactile",
    workflowType: "texture",
    title: "Tactile",
    caption: "tactile exploration",
  },
  {
    id: "experiential",
    label: "Experiential",
    workflowType: "pattern",
    title: "Experiential",
    caption: "ethereal cinematic mood study",
  },
];

/** interior_uxui_3way_api — shot modes distinct from sculptural essence (interface / installation / body-scale). */
const INTERIOR_UXUI_DIRECTION_SEQUENCE = [
  {
    id: "interface",
    label: "Interface",
    workflowType: "shape",
    title: "Interface",
    caption: "surfaces as responsive UI and projection",
  },
  {
    id: "installation",
    label: "Installation",
    workflowType: "texture",
    title: "Installation",
    caption: "room-scale immersive environment",
  },
  {
    id: "wearable",
    label: "Wearable",
    workflowType: "pattern",
    title: "Wearable",
    caption: "body-proximate light and gesture",
  },
];

function getDirectionSequence(workflowBasename) {
  const base = path.basename(String(workflowBasename ?? "").trim());
  if (base === INTERIOR_UXUI_WORKFLOW_BASENAME) {
    return INTERIOR_UXUI_DIRECTION_SEQUENCE;
  }
  return DIRECTION_SEQUENCE;
}

function isTrue(value) {
  if (typeof value !== "string") {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function normalizeBaseUrl(url) {
  return String(url ?? "").replace(/\/$/, "");
}

/** Explains 502/503/504 — wording differs for Comfy Cloud vs self-hosted ComfyUI. */
function formatComfyUnavailableHint(status, baseUrl) {
  if (status === 502 || status === 503 || status === 504) {
    if (isCloudBaseUrl(baseUrl)) {
      return " Bad gateway: Comfy Cloud could not complete the request. Confirm COMFYUI_API_KEY (or COMFY_CLOUD_API_KEY), set COMFYUI_CLOUD_MODE=true if you use a custom cloud endpoint, and check https://cloud.comfy.org availability.";
    }

    return " Bad gateway: nothing reachable at COMFYUI_BASE_URL. For local ComfyUI, start the server (often port 8188), set COMFYUI_BASE_URL=http://127.0.0.1:8188 in .env, or fix your tunnel/reverse-proxy upstream.";
  }

  return "";
}

function throwComfyHttpError(label, response, baseUrl) {
  const status = response.status;
  const origin = (() => {
    try {
      return new URL(baseUrl).origin;
    } catch {
      return baseUrl;
    }
  })();
  throw new Error(`${label} failed with HTTP ${status} (${origin}).${formatComfyUnavailableHint(status, baseUrl)}`);
}

function isCloudBaseUrl(baseUrl) {
  if (isTrue(process.env.COMFYUI_CLOUD_MODE)) {
    return true;
  }

  try {
    const parsed = new URL(baseUrl);
    return parsed.hostname === "cloud.comfy.org";
  } catch {
    return false;
  }
}

function getCloudApiKey() {
  return process.env.COMFYUI_API_KEY ?? process.env.COMFY_CLOUD_API_KEY ?? "";
}

function getAuthHeaders(baseUrl, options = {}) {
  const headers = {};
  const cloudMode = isCloudBaseUrl(baseUrl);

  if (cloudMode) {
    const apiKey = getCloudApiKey();
    if (!apiKey) {
      throw new Error(
        "COMFYUI_API_KEY (or COMFY_CLOUD_API_KEY) is required when using Comfy Cloud.",
      );
    }
    headers["X-API-Key"] = apiKey;
  }

  if (options.json) {
    headers["content-type"] = "application/json";
  }

  return headers;
}

function getApiPath(baseUrl, localPath, cloudPath = null) {
  if (!isCloudBaseUrl(baseUrl)) {
    return localPath;
  }

  return cloudPath ?? `/api${localPath}`;
}

function isDebugEnabled() {
  const flag = process.env.COMFYUI_DEBUG;
  if (typeof flag !== "string") {
    return false;
  }

  const normalized = flag.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function debugLog(message, details) {
  if (!isDebugEnabled()) {
    return;
  }

  if (details == null) {
    console.info(`[comfyui] ${message}`);
    return;
  }

  console.info(`[comfyui] ${message}`, details);
}

function ensure(value, message) {
  if (!value) {
    throw new Error(message);
  }

  return value;
}

function parseJsonTemplate(rawJson, sourceLabel) {
  try {
    return JSON.parse(rawJson);
  } catch (error) {
    throw new Error(
      `Unable to parse ComfyUI workflow template from ${sourceLabel}: ${
        error instanceof Error ? error.message : "invalid JSON"
      }`,
    );
  }
}

function detectThreeWayHintsFromTemplate(template) {
  if (!template || typeof template !== "object") {
    return null;
  }

  const saveCount = Object.values(template).filter(
    (node) => node?.class_type === "SaveImage",
  ).length;
  const samplerCount = Object.values(template).filter(
    (node) => node?.class_type === "KSampler",
  ).length;

  if (saveCount >= 3 && samplerCount >= 3) {
    if (template["31"]?.class_type === "SaveImage") {
      return LEGACY_SCULPTURAL_CONTROLNET_HINTS;
    }
    if (template["18"]?.class_type === "SaveImage" && template["10"]?.class_type === "KSampler") {
      return INTERIOR_UXUI_3WAY_HINTS;
    }
    if (template["14"]?.class_type === "SaveImage") {
      return THREE_WAY_CLIP_HINTS;
    }
  }

  return null;
}

function resolveWorkflowsDir() {
  return fileURLToPath(WORKFLOWS_DIR_URL);
}

function resolveWorkflowFilePath(workflowsDir, basename) {
  const resolved = path.resolve(path.join(workflowsDir, basename));
  const relative = path.relative(workflowsDir, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return resolved;
}

/**
 * Loads ComfyUI API JSON: client preset (`constraintSettings.workflowFile`) wins first so
 * each Curate preset maps to the matching file under `comfy/workflows/`.
 * `COMFYUI_WORKFLOW_JSON` / `COMFYUI_WORKFLOW_PATH` are fallbacks when the preset file is missing,
 * or when `COMFYUI_FORCE_ENV_WORKFLOW=true` (env overrides take precedence).
 */
async function loadWorkflowTemplateForPayload(payload) {
  const workflowsDir = resolveWorkflowsDir();
  const rawName = payload?.constraintSettings?.workflowFile;
  const requestedBasename =
    typeof rawName === "string" && rawName.trim().length > 0
      ? path.basename(rawName.trim())
      : DEFAULT_WORKFLOW_BASENAME;

  const tryLoad = async (basename) => {
    const filePath = resolveWorkflowFilePath(workflowsDir, basename);
    if (!filePath) {
      return null;
    }

    try {
      const fileContents = await readFile(filePath, "utf8");
      const template = parseJsonTemplate(fileContents, filePath);
      return {
        template,
        injectionHints:
          WORKFLOW_HINTS_BY_BASENAME[basename] ?? detectThreeWayHintsFromTemplate(template),
      };
    } catch {
      return null;
    }
  };

  const forceEnvFirst = isTrue(process.env.COMFYUI_FORCE_ENV_WORKFLOW);

  if (!forceEnvFirst) {
    const primary = await tryLoad(requestedBasename);
    if (primary) {
      return {
        ...primary,
        resolvedWorkflowBasename: requestedBasename,
        workflowLoadSource: "preset",
      };
    }
  }

  const workflowJson = process.env.COMFYUI_WORKFLOW_JSON;
  if (workflowJson) {
    const template = parseJsonTemplate(workflowJson, "COMFYUI_WORKFLOW_JSON");
    debugLog("Using COMFYUI_WORKFLOW_JSON (preset file missing or COMFYUI_FORCE_ENV_WORKFLOW=true)", {
      requestedBasename,
    });
    return {
      template,
      injectionHints: detectThreeWayHintsFromTemplate(template),
      resolvedWorkflowBasename: requestedBasename,
      workflowLoadSource: "env-json",
    };
  }

  const envWorkflowPath = process.env.COMFYUI_WORKFLOW_PATH;
  if (envWorkflowPath) {
    const fileContents = await readFile(envWorkflowPath, "utf8");
    const template = parseJsonTemplate(fileContents, envWorkflowPath);
    const base = path.basename(envWorkflowPath);
    debugLog("Using COMFYUI_WORKFLOW_PATH (preset file missing or COMFYUI_FORCE_ENV_WORKFLOW=true)", {
      path: envWorkflowPath,
      requestedBasename,
    });
    return {
      template,
      injectionHints:
        WORKFLOW_HINTS_BY_BASENAME[base] ?? detectThreeWayHintsFromTemplate(template),
      resolvedWorkflowBasename: base,
      workflowLoadSource: "env-path",
    };
  }

  if (forceEnvFirst) {
    const primary = await tryLoad(requestedBasename);
    if (primary) {
      return {
        ...primary,
        resolvedWorkflowBasename: requestedBasename,
        workflowLoadSource: "preset",
      };
    }
  }

  const fallback = await tryLoad(DEFAULT_WORKFLOW_BASENAME);
  if (fallback) {
    return {
      ...fallback,
      resolvedWorkflowBasename: DEFAULT_WORKFLOW_BASENAME,
      workflowLoadSource: "fallback-default",
    };
  }

  throw new Error(
    `Default ComfyUI workflow missing: ${path.join(workflowsDir, DEFAULT_WORKFLOW_BASENAME)}`,
  );
}

function dataUrlToBlob(dataUrl) {
  const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);

  if (!match) {
    throw new Error("Only base64 data URLs are supported for ComfyUI uploads.");
  }

  const mimeType = match[1];
  const base64Payload = match[2];
  const buffer = Buffer.from(base64Payload, "base64");
  return {
    mimeType,
    blob: new Blob([buffer], { type: mimeType }),
  };
}

function mimeToExtension(mimeType) {
  if (!mimeType || typeof mimeType !== "string") {
    return "png";
  }

  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) {
    return "jpg";
  }

  if (mimeType.includes("webp")) {
    return "webp";
  }

  if (mimeType.includes("png")) {
    return "png";
  }

  return "png";
}

function createUploadFilename(sourceAssetId, extension) {
  const safeAssetId = String(sourceAssetId ?? "capture")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 28);
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).slice(2, 8);
  return `${safeAssetId || "capture"}-${timestamp}-${randomSuffix}.${extension}`;
}

function createSeed() {
  return Math.floor(100000000000 + Math.random() * 899999999999999);
}

function isHttpUrl(value) {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

function isLikelyComfyFilename(value) {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }

  if (value.includes("/") || value.includes("\\") || value.includes("?")) {
    return false;
  }

  return /\.(png|jpe?g|webp)$/i.test(value);
}

async function toUploadPayload(imageUrl) {
  if (imageUrl.startsWith("data:")) {
    const { mimeType, blob } = dataUrlToBlob(imageUrl);
    return { mimeType, blob };
  }

  if (!isHttpUrl(imageUrl)) {
    return null;
  }

  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Unable to fetch source image for upload (${response.status}).`);
  }

  const blob = await response.blob();
  const mimeType = response.headers.get("content-type") ?? blob.type ?? "image/png";
  return { mimeType, blob };
}

async function uploadImage(baseUrl, imageUrl, sourceAssetId) {
  if (isLikelyComfyFilename(imageUrl)) {
    return imageUrl;
  }

  const uploadPayload = await toUploadPayload(imageUrl);
  if (!uploadPayload) {
    return imageUrl;
  }

  const { mimeType, blob } = uploadPayload;
  const uploadFilename = createUploadFilename(sourceAssetId, mimeToExtension(mimeType));

  const formData = new FormData();
  formData.append("image", blob, uploadFilename);
  formData.append("overwrite", "false");
  formData.append("type", "input");

  const uploadPath = getApiPath(baseUrl, "/upload/image", "/api/upload/image");
  const response = await fetch(`${baseUrl}${uploadPath}`, {
    method: "POST",
    body: formData,
    headers: getAuthHeaders(baseUrl),
  });

  if (!response.ok) {
    throwComfyHttpError("ComfyUI image upload", response, baseUrl);
  }

  const payload = await response.json();
  return payload.name;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function findNodeIdByClassType(workflow, classType) {
  const match = Object.entries(workflow).find(
    ([, node]) => node?.class_type === classType,
  );
  return match?.[0];
}

function findClipTextNodeBySemantic(workflow, semantic) {
  const match = Object.entries(workflow).find(([, node]) => {
    if (node?.class_type !== "CLIPTextEncode") {
      return false;
    }

    const title = String(node?._meta?.title ?? "").toLowerCase();
    return title.includes(semantic);
  });

  return match?.[0];
}

function findNthClipTextNode(workflow, index) {
  const nodes = Object.entries(workflow).filter(
    ([, node]) => node?.class_type === "CLIPTextEncode",
  );
  return nodes[index]?.[0];
}

function findLikelyNegativeClipNode(workflow) {
  const keywords = [
    "watermark",
    "logo",
    "text",
    "photorealistic",
    "recognizable",
    "human",
    "face",
    "car",
    "object",
    "scene",
    "low quality",
  ];

  const scoredNodes = Object.entries(workflow)
    .filter(([, node]) => node?.class_type === "CLIPTextEncode")
    .map(([nodeId, node]) => {
      const text = String(node?.inputs?.text ?? "").toLowerCase();
      const score = keywords.reduce((count, keyword) => {
        return count + (text.includes(keyword) ? 1 : 0);
      }, 0);
      return { nodeId, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  return scoredNodes[0]?.nodeId;
}

function parseNodeIdList(rawValue) {
  if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
    return [];
  }

  return rawValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

/** User/designer context for Comfy prompts; empty when unset. */
function sanitizeContextCue(contextText) {
  const trimmed = String(contextText ?? "").trim();
  if (!trimmed) {
    return "";
  }

  return trimmed.replace(/\s+/g, " ").slice(0, 4000);
}

function appendDesignContextToClipNode(workflow, nodeId, cue) {
  if (!cue) {
    return;
  }

  const node = workflow[nodeId];
  if (!node || node.class_type !== "CLIPTextEncode") {
    return;
  }

  const inputs = node.inputs;
  if (!inputs || typeof inputs.text !== "string") {
    return;
  }

  const marker = `Design context: ${cue}`;
  if (inputs.text.includes(marker)) {
    return;
  }

  const base = inputs.text.trimEnd();
  const sep = /[.!?]\s*$/.test(base) ? " " : ". ";
  inputs.text = `${base}${sep}${marker}`;
}

/**
 * Embedded-prompt workflows ignore injected direction prompts; merge designer context here.
 * Interior: node 22 only (global identity — avoids tripling across 22+4/5/6 combine).
 * Sculptural: nodes 4, 5, 6 (branch CLIPs).
 * Abstract: not called — scaffold from `buildDirectionalPrompts` already includes context.
 */
function appendContextCueToEmbeddedPreservedWorkflows(workflow, replacements, preserveEmbedded) {
  if (!preserveEmbedded) {
    return;
  }

  const cue = replacements.contextCue;
  if (typeof cue !== "string" || !cue.trim()) {
    return;
  }

  const basename = path.basename(String(replacements.workflowFileBasename ?? "").trim());
  if (basename === INTERIOR_UXUI_WORKFLOW_BASENAME) {
    appendDesignContextToClipNode(workflow, "22", cue);
    return;
  }

  if (basename === DEFAULT_WORKFLOW_BASENAME) {
    for (const id of ["4", "5", "6"]) {
      appendDesignContextToClipNode(workflow, id, cue);
    }
  }
}

function debugLogMergedClipPromptPreviews(
  workflow,
  workflowBasename,
  injectionHints,
  contextCueForDebug = "",
) {
  if (!isDebugEnabled() || !workflow || typeof workflow !== "object") {
    return;
  }

  const base = path.basename(String(workflowBasename ?? "").trim());
  let nodeIds;
  if (base === INTERIOR_UXUI_WORKFLOW_BASENAME) {
    nodeIds = ["22", "4", "5", "6"];
  } else if (base === ABSTRACT_INGREDIENT_WORKFLOW_BASENAME) {
    nodeIds =
      injectionHints?.promptNodeIds?.length > 0 ? injectionHints.promptNodeIds : ["4", "5", "6"];
  } else {
    nodeIds = ["4", "5", "6"];
  }

  const cue = typeof contextCueForDebug === "string" ? contextCueForDebug.trim() : "";

  const previews = nodeIds.map((nodeId) => {
    const text = String(workflow[nodeId]?.inputs?.text ?? "");
    const entry = {
      nodeId,
      /** Baked-in art direction dominates the start; user context is often appended at the end. */
      previewStart: text.slice(0, 200),
    };
    if (cue) {
      entry.previewEnd = text.slice(-200);
      entry.includesUserPhrase = text.includes(cue);
    }
    return entry;
  });
  debugLog("Merged prompt preview (start/end per CLIP node; includesUserPhrase when context is set)", previews);
  if (cue) {
    const hasAppendedMarker =
      base === INTERIOR_UXUI_WORKFLOW_BASENAME
        ? String(workflow["22"]?.inputs?.text ?? "").includes(`Design context: ${cue}`)
        : base === DEFAULT_WORKFLOW_BASENAME
          ? ["4", "5", "6"].some((id) =>
              String(workflow[id]?.inputs?.text ?? "").includes(`Design context: ${cue}`),
            )
          : false;
    const abstractHasScaffoldCue =
      base === ABSTRACT_INGREDIENT_WORKFLOW_BASENAME &&
      nodeIds.some((id) => String(workflow[id]?.inputs?.text ?? "").includes(cue));
    debugLog("Context cue merge check", {
      contextCueSnippet: cue.slice(0, 120),
      appendedDesignContextMarkerFound: hasAppendedMarker,
      abstractScaffoldContainsUserPhrase: abstractHasScaffoldCue,
    });
  }
}

function fillWorkflowTokens(workflow, replacements) {
  const spatialPrompt = replacements.directionPrompts?.[0] ?? replacements.prompt;
  const tactilePrompt = replacements.directionPrompts?.[1] ?? replacements.prompt;
  const experientialPrompt = replacements.directionPrompts?.[2] ?? replacements.prompt;

  return JSON.parse(
    JSON.stringify(workflow, (_, value) => {
      if (typeof value !== "string") {
        return value;
      }

      return value
        .replaceAll("{{IMAGE}}", replacements.image)
        .replaceAll("{{INPUT_IMAGE}}", replacements.image)
        .replaceAll("{{PROMPT}}", replacements.prompt)
        .replaceAll("{{POSITIVE_PROMPT}}", replacements.prompt)
        .replaceAll("{{PROMPT_SPATIAL}}", spatialPrompt)
        .replaceAll("{{PROMPT_TACTILE}}", tactilePrompt)
        .replaceAll("{{PROMPT_EXPERIENTIAL}}", experientialPrompt)
        .replaceAll("{{PROMPT_STRUCTURAL}}", spatialPrompt)
        .replaceAll("{{PROMPT_TEXTURES}}", tactilePrompt)
        .replaceAll("{{PROMPT_IMPRESSION}}", experientialPrompt)
        .replaceAll("{{CONTEXT_CUE}}", replacements.contextCue ?? "")
        .replaceAll("{{NEGATIVE_PROMPT}}", replacements.negativePrompt)
        .replaceAll("{{CHECKPOINT}}", replacements.checkpoint)
        .replaceAll("{{CHECKPOINT_NAME}}", replacements.checkpoint)
        .replaceAll("{{MODE}}", replacements.mode)
        .replaceAll("{{EXTRACTION_MODE}}", replacements.mode);
    }),
  );
}

function setNodeInput(workflow, nodeId, inputKey, value) {
  if (value == null) {
    return false;
  }

  const node = workflow[nodeId];
  if (!node || typeof node !== "object") {
    return false;
  }

  const inputs = node.inputs;
  if (!inputs || typeof inputs !== "object") {
    return false;
  }

  inputs[inputKey] = value;
  return true;
}

function shouldPreserveEmbeddedWorkflowPrompts(replacements) {
  const payloadBasename = path.basename(String(replacements.workflowFileBasename ?? "").trim());
  const loadedBasename = path.basename(String(replacements.loadedWorkflowBasename ?? "").trim());
  if (loadedBasename && payloadBasename && loadedBasename !== payloadBasename) {
    return false;
  }

  if (isTrue(process.env.COMFYUI_EMBEDDED_PROMPTS_ONLY)) {
    return true;
  }

  return (
    payloadBasename === INTERIOR_UXUI_WORKFLOW_BASENAME || payloadBasename === DEFAULT_WORKFLOW_BASENAME
  );
}

function injectWorkflowInputs(workflowTemplate, replacements, injectionHints = null) {
  const injected = deepClone(workflowTemplate);
  const preserveEmbeddedPrompts = shouldPreserveEmbeddedWorkflowPrompts(replacements);
  const envPromptIds = parseNodeIdList(process.env.COMFYUI_PROMPT_NODE_IDS);
  const promptNodeIds =
    envPromptIds.length > 0 ? envPromptIds : injectionHints?.promptNodeIds ?? [];
  const envNegIds = parseNodeIdList(process.env.COMFYUI_NEGATIVE_PROMPT_NODE_IDS);
  const negativePromptNodeIds =
    envNegIds.length > 0 ? envNegIds : injectionHints?.negativePromptNodeIds ?? [];
  const envSamplerIds = parseNodeIdList(process.env.COMFYUI_SAMPLER_NODE_IDS);
  const samplerNodeIds =
    envSamplerIds.length > 0 ? envSamplerIds : injectionHints?.samplerNodeIds ?? [];
  const envSaveIds = parseNodeIdList(process.env.COMFYUI_SAVE_IMAGE_NODE_IDS);
  const saveNodeIds = envSaveIds.length > 0 ? envSaveIds : injectionHints?.saveNodeIds ?? [];
  const imageNodeId =
    process.env.COMFYUI_IMAGE_NODE_ID ??
    findNodeIdByClassType(injected, "LoadImage") ??
    "2";
  const imageInputKey = process.env.COMFYUI_IMAGE_NODE_INPUT_KEY ?? "image";
  const promptNodeId =
    process.env.COMFYUI_PROMPT_NODE_ID ??
    findClipTextNodeBySemantic(injected, "positive") ??
    findNthClipTextNode(injected, 0) ??
    "4";
  const promptInputKey = process.env.COMFYUI_PROMPT_NODE_INPUT_KEY ?? "text";
  const negativePromptNodeId =
    process.env.COMFYUI_NEGATIVE_PROMPT_NODE_ID ??
    findClipTextNodeBySemantic(injected, "negative") ??
    findLikelyNegativeClipNode(injected) ??
    findNthClipTextNode(injected, 1) ??
    "5";
  const negativePromptInputKey =
    process.env.COMFYUI_NEGATIVE_PROMPT_NODE_INPUT_KEY ?? "text";
  const checkpointNodeId =
    process.env.COMFYUI_CHECKPOINT_NODE_ID ??
    findNodeIdByClassType(injected, "CheckpointLoaderSimple") ??
    "1";
  const checkpointInputKey = process.env.COMFYUI_CHECKPOINT_NODE_INPUT_KEY ?? "ckpt_name";
  const samplerNodeId =
    process.env.COMFYUI_SAMPLER_NODE_ID ?? findNodeIdByClassType(injected, "KSampler") ?? "6";
  const samplerSeedInputKey = process.env.COMFYUI_SAMPLER_SEED_INPUT_KEY ?? "seed";
  const saveNodeId =
    process.env.COMFYUI_SAVE_IMAGE_NODE_ID ?? findNodeIdByClassType(injected, "SaveImage") ?? "8";
  const savePrefixInputKey = process.env.COMFYUI_SAVE_IMAGE_PREFIX_INPUT_KEY ?? "filename_prefix";
  const modeNodeId = process.env.COMFYUI_MODE_NODE_ID;
  const modeInputKey = process.env.COMFYUI_MODE_NODE_INPUT_KEY ?? "text";

  const imageWasInjected = setNodeInput(injected, imageNodeId, imageInputKey, replacements.image);
  if (!imageWasInjected) {
    throw new Error(
      `Failed to inject source image into workflow node "${imageNodeId}" input "${imageInputKey}".`,
    );
  }
  if (!preserveEmbeddedPrompts) {
    if (promptNodeIds.length > 0) {
      const prompts = Array.isArray(replacements.directionPrompts)
        ? replacements.directionPrompts
        : [replacements.prompt];
      promptNodeIds.forEach((nodeId, index) => {
        const promptValue =
          prompts[index] ?? prompts[prompts.length - 1] ?? replacements.prompt;
        setNodeInput(injected, nodeId, promptInputKey, promptValue);
      });
    } else {
      setNodeInput(injected, promptNodeId, promptInputKey, replacements.prompt);
    }
    if (negativePromptNodeIds.length > 0) {
      negativePromptNodeIds.forEach((nodeId) => {
        setNodeInput(injected, nodeId, negativePromptInputKey, replacements.negativePrompt);
      });
    } else {
      setNodeInput(
        injected,
        negativePromptNodeId,
        negativePromptInputKey,
        replacements.negativePrompt,
      );
    }
  }
  setNodeInput(injected, checkpointNodeId, checkpointInputKey, replacements.checkpoint);
  if (samplerNodeIds.length > 0) {
    samplerNodeIds.forEach((nodeId, index) => {
      setNodeInput(injected, nodeId, samplerSeedInputKey, replacements.seed + index * 9973);
    });
  } else {
    setNodeInput(injected, samplerNodeId, samplerSeedInputKey, replacements.seed);
  }
  if (!preserveEmbeddedPrompts) {
    if (saveNodeIds.length > 0) {
      saveNodeIds.forEach((nodeId, index) => {
        setNodeInput(
          injected,
          nodeId,
          savePrefixInputKey,
          `${replacements.filenamePrefix}_${index + 1}`,
        );
      });
    } else {
      setNodeInput(injected, saveNodeId, savePrefixInputKey, replacements.filenamePrefix);
    }
  }

  if (modeNodeId) {
    setNodeInput(injected, modeNodeId, modeInputKey, replacements.mode);
  }

  const filled = fillWorkflowTokens(injected, replacements);
  appendContextCueToEmbeddedPreservedWorkflows(filled, replacements, preserveEmbeddedPrompts);
  applyImageScaleByFromEnv(filled);
  return filled;
}

/** Optional post-VAEDecode upscale: set COMFYUI_IMAGE_SCALE_BY (e.g. 1.5 or 2). Use 1 to disable sharpening. */
function applyImageScaleByFromEnv(workflow) {
  const raw = process.env.COMFYUI_IMAGE_SCALE_BY?.trim();
  if (!raw) {
    return;
  }

  const factor = Number.parseFloat(raw);
  if (!Number.isFinite(factor) || factor <= 0) {
    return;
  }

  for (const nodeId of Object.keys(workflow)) {
    const node = workflow[nodeId];
    if (node?.class_type === "ImageScaleBy" && node.inputs && typeof node.inputs === "object") {
      node.inputs.scale_by = factor;
    }
  }
}

function normalizeDirectionId(workflowType) {
  if (workflowType === "texture") {
    return "tactile";
  }

  if (workflowType === "pattern" || workflowType === "impressions") {
    return "experiential";
  }

  return "spatial";
}

function getDirectionById(directionId, sequence = DIRECTION_SEQUENCE) {
  return sequence.find((direction) => direction.id === directionId) ?? sequence[0];
}

function getDirectionByIndex(index, sequence = DIRECTION_SEQUENCE) {
  if (index >= 0 && index < sequence.length) {
    return sequence[index];
  }

  return sequence[sequence.length - 1];
}

function directionRank(directionId, sequence = DIRECTION_SEQUENCE) {
  const rank = sequence.findIndex((direction) => direction.id === directionId);
  return rank >= 0 ? rank : 999;
}

function describeConstraintSettings(constraintSettings) {
  if (!constraintSettings || typeof constraintSettings !== "object") {
    return "";
  }

  const cues = [];

  if (constraintSettings.edgeHold === true) {
    cues.push("preserve edge continuity");
  }
  if (constraintSettings.textureBias === true) {
    cues.push("amplify tactile articulation");
  }
  if (constraintSettings.seedLock === true) {
    cues.push("maintain compositional repeatability");
  }
  if (
    typeof constraintSettings.guidance === "number" &&
    Number.isFinite(constraintSettings.guidance)
  ) {
    cues.push(`guidance ${constraintSettings.guidance.toFixed(1)}`);
  }

  if (cues.length === 0) {
    return "";
  }

  return `Constraint cues: ${cues.join(", ")}.`;
}

function buildPromptScaffold({ contextText, labels, constraintSettings }) {
  const baseContext = contextText?.trim() || "future-forward sculptural design language";
  const uniqueLabels = Array.from(new Set(labels ?? [])).slice(0, 6);
  const labelSegment =
    uniqueLabels.length > 0 ? `Source cues: ${uniqueLabels.join(", ")}.` : "";
  const constraintSegment = describeConstraintSettings(constraintSettings);

  return [
    FIELD_BASE,
    "Retain visual DNA only: proportion, rhythm, tonal balance, directional flow.",
    "Avoid domestic rooms, bathrooms, kitchens, or documentary interior photography — no readable real-world place.",
    `Context cue: ${baseContext}.`,
    labelSegment,
    constraintSegment,
  ]
    .filter(Boolean)
    .join(" ");
}

function buildDirectionInstruction(directionId) {
  if (directionId === "tactile") {
    return [
      "Tactile branch:",
      "One coherent premium material family: translucent membranes, soft polymers, iridescent film, satin reflectivity, subsurface glow, layered depth, micro-surface modulation, refined synthetic-organic tactility.",
      "Elegant surface continuity; controlled detail; not random pattern stacking or grunge.",
    ].join(" ");
  }

  if (directionId === "experiential") {
    return [
      "Atmospheric branch:",
      "Luminous spatial field, soft volumetric light, ambient gradients, exhibition-like emptiness, cinematic stillness, subtle depth layering, immersive calm.",
      "Not fantasy landscape, not narrative illustration, not foggy mush.",
    ].join(" ");
  }

  return [
    "Structural branch:",
    "Computational morphology, continuous silhouette logic, spatial rhythm, balance of mass and void, disciplined curvature, modular variation, one dominant sculptural event, gallery-like staging, non-representational precision.",
  ].join(" ");
}

function buildDirectionalPrompts({
  contextText,
  labels,
  workflowType,
  constraintSettings,
  workflowBasename,
}) {
  const scaffold = buildPromptScaffold({ contextText, labels, constraintSettings });
  const focusDirectionId = normalizeDirectionId(workflowType);
  const base = path.basename(String(workflowBasename ?? "").trim());
  const abstractExteriorLens =
    base === ABSTRACT_INGREDIENT_WORKFLOW_BASENAME ? FIELD_ABSTRACT_EXTERIOR_LENS : "";

  return DIRECTION_SEQUENCE.map((direction) => {
    const focusSegment =
      direction.id === focusDirectionId
        ? "Primary emphasis for this run."
        : "Secondary companion direction in this 3-way exploration set.";

    return [
      scaffold,
      buildDirectionInstruction(direction.id),
      focusSegment,
      abstractExteriorLens,
      "No recognizable products, no literal objects, no text overlays, no logos.",
    ]
      .filter(Boolean)
      .join(" ");
  });
}

function buildNegativePrompt(workflowType, workflowBasename) {
  const focusDirectionId = normalizeDirectionId(workflowType);
  const fieldAntiChaos =
    "visual clutter, chaotic fragmentation, messy geometry, generic diffusion noise, sloppy composition, creature-like form, collage chaos, decorative overload";
  const commonNegative =
    "literal object identity, recognizable subject, readable text, logo, watermark, photoreal product shot, human face, human body, brand marks, scene photography, bathroom, toilet, kitchen, bedroom, realistic interior, architectural photography, stock interior photo, room documentation, tiles, fixtures, mirror reflection, sink, shower";
  const modeSpecificNegative =
    focusDirectionId === "tactile"
      ? "full silhouette render, object-centered composition, isolated product hero shot, dirty grunge, coarse realism, cheap glossy CGI, messy specular"
      : focusDirectionId === "experiential"
        ? "hard-edged literal geometry, documentary realism, flat even lighting, deep focus snapshot, harsh flash, cluttered frame, fantasy scenery, blurry mush, narrative scene photography, foggy chaos, smartphone vacation photo"
        : "realistic product rendering, complete object profile, literal transport form, random folds, noisy diffusion, broken fragments";
  const customNegative = process.env.COMFYUI_NEGATIVE_PROMPT?.trim();
  const base = path.basename(String(workflowBasename ?? "").trim());
  const abstractIngredientExtra =
    base === ABSTRACT_INGREDIENT_WORKFLOW_BASENAME
      ? "literal car exterior photograph, outdoor road hero, stock landscape establishing shot"
      : "";

  return [fieldAntiChaos, commonNegative, modeSpecificNegative, abstractIngredientExtra, customNegative]
    .filter(Boolean)
    .join(", ");
}

function prepareWorkflow({
  workflowTemplate,
  imagePath,
  contextText,
  labels,
  workflowType,
  constraintSettings,
  negativePrompt,
  checkpoint,
  injectionHints,
  loadedWorkflowBasename,
}) {
  const contextCue = sanitizeContextCue(contextText);
  const resolvedBasenameForPrompts =
    typeof loadedWorkflowBasename === "string" && loadedWorkflowBasename.trim()
      ? path.basename(loadedWorkflowBasename.trim())
      : typeof constraintSettings?.workflowFile === "string" && constraintSettings.workflowFile.trim()
        ? path.basename(constraintSettings.workflowFile.trim())
        : DEFAULT_WORKFLOW_BASENAME;
  const directionPrompts = buildDirectionalPrompts({
    contextText,
    labels,
    workflowType,
    constraintSettings,
    workflowBasename: resolvedBasenameForPrompts,
  });
  const focusDirectionId = normalizeDirectionId(workflowType);
  const focusDirection = getDirectionById(focusDirectionId);
  const focusPromptIndex = directionRank(focusDirection.id);
  const prompt = directionPrompts[focusPromptIndex] ?? directionPrompts[0];
  const sourceKey = String(imagePath).split("/").pop()?.replace(/\.[^/.]+$/, "") ?? "source";
  const seed = createSeed();
  const filenamePrefix = `abstract_ingredients_${sourceKey}_${seed.toString().slice(-6)}`;
  const workflowFileBasename =
    typeof constraintSettings?.workflowFile === "string" && constraintSettings.workflowFile.trim()
      ? path.basename(constraintSettings.workflowFile.trim())
      : DEFAULT_WORKFLOW_BASENAME;

  return injectWorkflowInputs(
    workflowTemplate,
    {
      image: imagePath,
      prompt,
      directionPrompts,
      contextCue,
      negativePrompt,
      checkpoint,
      mode: workflowType ?? "shape",
      seed,
      filenamePrefix,
      workflowFileBasename,
      loadedWorkflowBasename:
        typeof loadedWorkflowBasename === "string" && loadedWorkflowBasename.trim()
          ? path.basename(loadedWorkflowBasename.trim())
          : workflowFileBasename,
    },
    injectionHints,
  );
}

async function queueWorkflow(baseUrl, prompt) {
  const promptPath = getApiPath(baseUrl, "/prompt", "/api/prompt");
  const cloudMode = isCloudBaseUrl(baseUrl);
  const apiKey = cloudMode ? getCloudApiKey() : "";
  const requestBody = {
    prompt,
  };

  if (cloudMode && apiKey) {
    requestBody.extra_data = {
      api_key_comfy_org: apiKey,
    };
  }

  const response = await fetch(`${baseUrl}${promptPath}`, {
    method: "POST",
    headers: getAuthHeaders(baseUrl, { json: true }),
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    throwComfyHttpError("ComfyUI /prompt", response, baseUrl);
  }

  const payload = await response.json();
  const promptId = payload.prompt_id;
  if (typeof promptId !== "string") {
    throw new Error("ComfyUI did not return a prompt_id.");
  }

  return promptId;
}

function extractImagesFromHistory(promptHistory, preferredNodeId) {
  const outputs = promptHistory?.outputs;
  if (!outputs || typeof outputs !== "object") {
    return [];
  }

  const preferredOutput = outputs[preferredNodeId];
  if (Array.isArray(preferredOutput?.images) && preferredOutput.images.length > 0) {
    return preferredOutput.images;
  }

  return Object.values(outputs).flatMap((nodeOutput) =>
    Array.isArray(nodeOutput?.images) ? nodeOutput.images : [],
  );
}

function extractImagesFromHistoryByNodeIds(promptHistory, preferredNodeIds) {
  const outputs = promptHistory?.outputs;
  if (!outputs || typeof outputs !== "object") {
    return [];
  }

  const images = preferredNodeIds.flatMap((nodeId) => {
    const nodeOutput = outputs[nodeId];
    return Array.isArray(nodeOutput?.images) ? nodeOutput.images : [];
  });

  return images;
}

/** True when every listed SaveImage (or output) node has at least one image in history. */
function promptHistoryHasOutputsForAllNodes(promptHistory, nodeIds) {
  if (!Array.isArray(nodeIds) || nodeIds.length === 0) {
    return false;
  }

  const outputs = promptHistory?.outputs;
  if (!outputs || typeof outputs !== "object") {
    return false;
  }

  return nodeIds.every((nodeId) => {
    const imgs = outputs[nodeId]?.images;
    return Array.isArray(imgs) && imgs.length > 0;
  });
}

function parseCloudFailureReason(statusPayload, fallbackStatus) {
  const direct = statusPayload?.message ?? statusPayload?.error ?? statusPayload?.error_message;
  if (typeof direct === "string" && direct.trim().length > 0) {
    const trimmed = direct.trim();
    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed?.exception_message === "string" && parsed.exception_message.length > 0) {
          return parsed.exception_message;
        }
        if (typeof parsed?.message === "string" && parsed.message.length > 0) {
          return parsed.message;
        }
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }

  return fallbackStatus;
}

async function waitForOutputs(baseUrl, promptId, preferredOutputNodeIds = null) {
  const timeoutMs = Number(process.env.COMFYUI_POLL_TIMEOUT_MS ?? 60000);
  const intervalMs = Number(process.env.COMFYUI_POLL_INTERVAL_MS ?? 1500);
  const outputNodeId = process.env.COMFYUI_OUTPUT_NODE_ID ?? "8";
  const envOutputIds = parseNodeIdList(process.env.COMFYUI_OUTPUT_NODE_IDS);
  const outputNodeIds =
    envOutputIds.length > 0
      ? envOutputIds
      : Array.isArray(preferredOutputNodeIds) && preferredOutputNodeIds.length > 0
        ? preferredOutputNodeIds
        : [];
  const historyPath = getApiPath(baseUrl, `/history/${promptId}`, `/api/history_v2/${promptId}`);
  const statusPath = getApiPath(baseUrl, "", `/api/job/${promptId}/status`);
  const cloudMode = isCloudBaseUrl(baseUrl);
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    let images = [];
    const response = await fetch(`${baseUrl}${historyPath}`, {
      headers: getAuthHeaders(baseUrl),
    });

    if (response.ok) {
      const payload = await response.json();
      const promptHistory = payload[promptId] ?? payload;
      images =
        outputNodeIds.length > 0
          ? extractImagesFromHistoryByNodeIds(promptHistory, outputNodeIds)
          : extractImagesFromHistory(promptHistory, outputNodeId);

      if (outputNodeIds.length > 0) {
        if (promptHistoryHasOutputsForAllNodes(promptHistory, outputNodeIds)) {
          return images;
        }
      } else if (images.length > 0) {
        return images;
      }
    } else if (!cloudMode || response.status !== 404) {
      throwComfyHttpError("ComfyUI /history", response, baseUrl);
    }

    if (cloudMode) {
      const statusResponse = await fetch(`${baseUrl}${statusPath}`, {
        headers: getAuthHeaders(baseUrl),
      });

      if (!statusResponse.ok) {
        throwComfyHttpError("ComfyUI cloud status", statusResponse, baseUrl);
      }

      const statusPayload = await statusResponse.json();
      const status = String(statusPayload.status ?? "");
      if (status === "failed" || status === "cancelled") {
        const reason = parseCloudFailureReason(statusPayload, status);
        throw new Error(`ComfyUI cloud job ${status}: ${reason}`);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error("ComfyUI generation timed out before outputs were available.");
}

function toViewUrl(baseUrl, image) {
  const viewPath = getApiPath(baseUrl, "/view", "/api/view");
  const searchParams = new URLSearchParams({
    filename: image.filename,
    type: image.type ?? "output",
  });

  if (image.subfolder) {
    searchParams.set("subfolder", image.subfolder);
  }

  return `${baseUrl}${viewPath}?${searchParams.toString()}`;
}

async function resolvePublicOutputUrl(baseUrl, image) {
  const viewUrl = toViewUrl(baseUrl, image);
  if (!isCloudBaseUrl(baseUrl)) {
    return viewUrl;
  }

  const response = await fetch(viewUrl, {
    headers: getAuthHeaders(baseUrl),
    redirect: "manual",
  });

  if (response.status === 302) {
    const signedUrl = response.headers.get("location");
    if (signedUrl) {
      return signedUrl;
    }
  }

  if (response.ok) {
    return viewUrl;
  }

  throw new Error(`ComfyUI cloud output URL resolution failed with ${response.status}.`);
}

function inferDirectionFromFilename(filename) {
  const normalized = String(filename ?? "").toLowerCase();
  if (normalized.includes("interface")) {
    return "interface";
  }
  if (normalized.includes("installation")) {
    return "installation";
  }
  if (normalized.includes("wearable")) {
    return "wearable";
  }
  if (normalized.includes("spatial")) {
    return "spatial";
  }
  if (normalized.includes("experiential")) {
    return "experiential";
  }
  if (normalized.includes("struct")) {
    return "spatial";
  }
  if (normalized.includes("tactile")) {
    return "tactile";
  }
  if (normalized.includes("texture")) {
    return "tactile";
  }
  if (normalized.includes("atmospheric")) {
    return "experiential";
  }
  if (normalized.includes("impress")) {
    return "experiential";
  }
  return null;
}

function resolveOutputDirection(image, index, workflowBasename) {
  const sequence = getDirectionSequence(workflowBasename);
  const inferredDirectionId = inferDirectionFromFilename(image?.filename);
  if (inferredDirectionId && sequence.some((direction) => direction.id === inferredDirectionId)) {
    return getDirectionById(inferredDirectionId, sequence);
  }

  return getDirectionByIndex(index, sequence);
}

function buildOutputTags(sourceLabels, directionLabel) {
  const tags = Array.from(new Set([directionLabel, ...(sourceLabels ?? [])]));
  return tags.slice(0, 4);
}

export async function extractWithComfyUiProvider(payload) {
  const baseUrl = ensure(
    process.env.COMFYUI_BASE_URL,
    "COMFYUI_BASE_URL is required for ComfyUI extraction.",
  ).replace(/\/$/, "");
  if (isCloudBaseUrl(baseUrl) && !getCloudApiKey()) {
    throw new Error(
      "Comfy Cloud requires COMFYUI_API_KEY or COMFY_CLOUD_API_KEY when using cloud.comfy.org or COMFYUI_CLOUD_MODE=true.",
    );
  }
  const outputBaseUrl = (process.env.COMFYUI_OUTPUT_BASE_URL ?? baseUrl).replace(/\/$/, "");
  const sourceImageUrl = ensure(
    payload.sourceImageUrl,
    "sourceImageUrl is required for ComfyUI extraction.",
  );
  const workflowType = payload.workflowType ?? "shape";
  const {
    template: workflowTemplate,
    injectionHints,
    resolvedWorkflowBasename,
    workflowLoadSource,
  } = await loadWorkflowTemplateForPayload(payload);
  const requestedBasename =
    typeof payload.constraintSettings?.workflowFile === "string" && payload.constraintSettings.workflowFile.trim()
      ? path.basename(payload.constraintSettings.workflowFile.trim())
      : DEFAULT_WORKFLOW_BASENAME;
  debugLog("Loaded workflow template", {
    nodeCount: Object.keys(workflowTemplate).length,
    workflowType,
    requestedWorkflowFile: payload.constraintSettings?.workflowFile ?? DEFAULT_WORKFLOW_BASENAME,
    resolvedWorkflowBasename,
    workflowLoadSource,
    threeWayHints: Boolean(injectionHints?.outputNodeIds?.length),
  });
  if (
    (workflowLoadSource === "env-path" || workflowLoadSource === "env-json") &&
    resolvedWorkflowBasename !== requestedBasename
  ) {
    debugLog(
      "WARNING: env workflow basename differs from client preset; prompts may be injected or mismatched. Prefer unsetting COMFYUI_WORKFLOW_PATH / COMFYUI_WORKFLOW_JSON for preset-driven runs.",
      { resolvedWorkflowBasename, requestedBasename },
    );
  }
  const uploadedImage = await uploadImage(baseUrl, sourceImageUrl, payload.sourceAssetId);
  debugLog("Prepared input image", {
    sourceAssetId: payload.sourceAssetId,
    uploadedImage,
    isDataUrl: sourceImageUrl.startsWith("data:"),
  });
  const negativePrompt = buildNegativePrompt(workflowType, resolvedWorkflowBasename);
  const checkpoint = process.env.COMFYUI_CHECKPOINT_NAME ?? "dreamshaper_8.safetensors";
  const filledWorkflow = prepareWorkflow({
    workflowTemplate,
    imagePath: uploadedImage,
    contextText: payload.contextText,
    labels: payload.labels,
    workflowType,
    constraintSettings: payload.constraintSettings,
    negativePrompt,
    checkpoint,
    injectionHints,
    loadedWorkflowBasename: resolvedWorkflowBasename,
  });
  debugLogMergedClipPromptPreviews(
    filledWorkflow,
    resolvedWorkflowBasename,
    injectionHints,
    sanitizeContextCue(payload.contextText),
  );
  debugLog("Workflow injected", {
    checkpoint,
    workflowType,
    contextTextPresent: Boolean(payload.contextText?.trim()),
    labelsCount: (payload.labels ?? []).length,
  });
  const promptNodeIds = parseNodeIdList(process.env.COMFYUI_PROMPT_NODE_IDS);
  if (promptNodeIds.length > 0) {
    debugLog(
      "Direction prompt snippets",
      promptNodeIds.map((nodeId) => ({
        nodeId,
        snippet: String(filledWorkflow?.[nodeId]?.inputs?.text ?? "").slice(0, 220),
      })),
    );
  }
  const promptId = await queueWorkflow(baseUrl, filledWorkflow);
  debugLog("ComfyUI prompt queued", { promptId });
  const images = await waitForOutputs(baseUrl, promptId, injectionHints?.outputNodeIds);
  debugLog("ComfyUI outputs resolved", {
    promptId,
    outputCount: images.length,
    filenames: images.map((image) => image.filename),
  });
  const generatedAt = new Date().toISOString();
  const outputResolverBaseUrl = isCloudBaseUrl(baseUrl) ? baseUrl : outputBaseUrl;
  const workflowBasename =
    typeof payload.constraintSettings?.workflowFile === "string" && payload.constraintSettings.workflowFile.trim()
      ? path.basename(payload.constraintSettings.workflowFile.trim())
      : DEFAULT_WORKFLOW_BASENAME;
  const directionSequence = getDirectionSequence(workflowBasename);
  const resolvedImages = await Promise.all(
    images.slice(0, 3).map(async (image) => ({
      image,
      publicUrl: await resolvePublicOutputUrl(outputResolverBaseUrl, image),
    })),
  );
  const orderedOutputs = resolvedImages
    .map((entry, index) => {
      const direction = resolveOutputDirection(entry.image, index, workflowBasename);
      return {
        entry,
        direction,
      };
    })
    .sort(
      (left, right) =>
        directionRank(left.direction.id, directionSequence) -
        directionRank(right.direction.id, directionSequence),
    );

  return {
    provider: "comfyui",
    providerJobId: promptId,
    generatedOutputs: orderedOutputs.map(({ entry, direction }, index) => ({
      id: `${payload.sourceAssetId}-comfyui-${promptId}-${index + 1}`,
      title: direction.title,
      caption: direction.caption,
      tags: buildOutputTags(payload.labels, direction.label),
      parentAssetId: payload.sourceAssetId,
      directionId: direction.id,
      directionLabel: direction.label,
      generation: {
        provider: "comfyui",
        providerJobId: promptId,
        generatedAt,
        workflowType: direction.workflowType,
      },
      imageUrl: entry.publicUrl,
    })),
  };
}
