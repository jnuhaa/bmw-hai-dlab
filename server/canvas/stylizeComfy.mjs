/**
 * Converge canvas Stylize via ComfyUI (img2img / txt2img via blank latent image).
 * Loads workflow JSON from `comfy/workflows/` and patches nodes by class_type / titles.
 *
 * Multi-image inputs: the client may send a single composite PNG (e.g. sketch + reference side-by-side).
 * A workflow with multiple LoadImage nodes (separate sketch vs photo latents) is optional future work;
 * it would require extending the POST body and `applyStylizePatches` to patch each node id.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getBrandAppendFor } from "./convergeBrandContext.mjs";

export const STYLIZE_WORKFLOWS_DIR = fileURLToPath(new URL("../../comfy/workflows/", import.meta.url));
export const DEFAULT_STYLIZE_WORKFLOW_BASENAME = "extract-image-api.json";

function isTrue(value) {
  if (typeof value !== "string") {
    return false;
  }
  const n = value.trim().toLowerCase();
  return n === "1" || n === "true" || n === "yes";
}

function normalizeBaseUrl(url) {
  return String(url ?? "").replace(/\/$/, "");
}

function isCloudBaseUrl(baseUrl) {
  if (isTrue(process.env.COMFYUI_CLOUD_MODE)) {
    return true;
  }
  try {
    return new URL(baseUrl).hostname === "cloud.comfy.org";
  } catch {
    return false;
  }
}

function getCloudApiKey() {
  return process.env.COMFYUI_API_KEY ?? process.env.COMFY_CLOUD_API_KEY ?? "";
}

function getAuthHeaders(baseUrl, options = {}) {
  const headers = {};
  if (isCloudBaseUrl(baseUrl)) {
    const apiKey = getCloudApiKey();
    if (!apiKey) {
      throw new Error("COMFYUI_API_KEY (or COMFY_CLOUD_API_KEY) is required for Comfy Cloud.");
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

function throwComfyHttpError(label, response, baseUrl) {
  const status = response.status;
  throw new Error(`${label} failed with HTTP ${status} (${baseUrl})`);
}

/** Minimal 64×64 white PNG (base64) for text-only stylize → img2img. */
const WHITE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export function isComfyStylizeConfigured() {
  const provider = process.env.EXTRACTION_PROVIDER?.trim().toLowerCase();
  const base = process.env.COMFYUI_BASE_URL?.trim();
  return provider === "comfyui" && Boolean(base);
}

function createSeed() {
  return Math.floor(100000000000 + Math.random() * 899999999999999);
}

export function resolveWorkflowFilePath(workflowsDir, basename) {
  const safe = path.basename(String(basename ?? "").trim());
  if (!safe || !/\.json$/i.test(safe)) {
    return null;
  }
  const resolved = path.resolve(path.join(workflowsDir, safe));
  const relative = path.relative(workflowsDir, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  return resolved;
}

/**
 * @param {string} textPrompt
 * @param {string} [automotiveContext]
 */
export function buildStylizePrompt(textPrompt, automotiveContext, extraBrandSuffix = "") {
  const user =
    String(textPrompt ?? "").trim() || "Abstract design exploration, polished conceptual illustration.";
  const auto = String(automotiveContext ?? "").trim();
  const tailDefault = "Highly polished, modern conceptual design visualization.";
  /** Shared art direction when an automotive preset is active (avoid repeating in each preset string). */
  const tailAutomotive =
    "Premium automotive design visualization: sculptural surfacing, cinematic and ethereal lighting, design-oriented presentation.";
  const brand = getBrandAppendFor("stylize");
  const extra = String(extraBrandSuffix ?? "").trim();
  const brandPart = [brand, extra].filter(Boolean).join(" ");
  const suffix = brandPart ? ` ${brandPart}` : "";
  if (auto) {
    return `${user} Automotive design context: ${auto} ${tailAutomotive}${suffix}`;
  }
  return `${user} ${tailDefault}${suffix}`;
}

function findNodeIdByClassType(workflow, classType) {
  const match = Object.entries(workflow).find(([, node]) => node?.class_type === classType);
  return match?.[0];
}

function findNegativeLikeClipNodeId(workflow) {
  const encodes = Object.entries(workflow).filter(([, n]) => n?.class_type === "CLIPTextEncode");
  const byTitle = encodes.find(([, n]) =>
    String(n?._meta?.title ?? "")
      .toLowerCase()
      .includes("negative"),
  );
  return byTitle?.[0];
}

function findPositiveClipNodeId(workflow) {
  const encodes = Object.entries(workflow).filter(([, n]) => n?.class_type === "CLIPTextEncode");
  const byTitle = encodes.find(([, n]) => {
    const t = String(n?._meta?.title ?? "").toLowerCase();
    return t.includes("positive") || t.includes("+ve");
  });
  if (byTitle) {
    return byTitle[0];
  }
  const negId = findNegativeLikeClipNodeId(workflow);
  const nonNeg = encodes.find(([id]) => id !== negId);
  return nonNeg?.[0] ?? encodes[0]?.[0];
}

function findSaveImageNodeId(workflow) {
  return findNodeIdByClassType(workflow, "SaveImage");
}

/**
 * @param {string} [requestedBasename]
 * @returns {Promise<{ workflow: object, resolvedBasename: string }>}
 */
async function loadStylizeWorkflowTemplate(requestedBasename) {
  const envPath = process.env.COMFYUI_CANVAS_STYLIZE_WORKFLOW_PATH?.trim();
  if (envPath) {
    const raw = await readFile(envPath, "utf8");
    return {
      workflow: JSON.parse(raw),
      resolvedBasename: path.basename(envPath),
    };
  }

  const basename =
    (typeof requestedBasename === "string" && requestedBasename.trim().length > 0
      ? path.basename(requestedBasename.trim())
      : null) ||
    (process.env.COMFYUI_CANVAS_STYLIZE_WORKFLOW?.trim()
      ? path.basename(process.env.COMFYUI_CANVAS_STYLIZE_WORKFLOW.trim())
      : null) ||
    DEFAULT_STYLIZE_WORKFLOW_BASENAME;

  const filePath = resolveWorkflowFilePath(STYLIZE_WORKFLOWS_DIR, basename);
  if (!filePath) {
    throw new Error(`Invalid stylize workflow basename: ${basename}`);
  }
  const raw = await readFile(filePath, "utf8");
  return { workflow: JSON.parse(raw), resolvedBasename: basename };
}

/**
 * @param {object} workflow
 * @param {{
 *   checkpoint: string,
 *   uploadName: string,
 *   promptText: string,
 *   denoise: number,
 *   cfgScale?: number,
 *   negativeAppend?: string,
 * }} patch
 */
function applyStylizePatches(workflow, patch) {
  const ckptId =
    process.env.COMFYUI_CANVAS_STYLIZE_CHECKPOINT_NODE_ID?.trim() ||
    findNodeIdByClassType(workflow, "CheckpointLoaderSimple");
  const loadImageId =
    process.env.COMFYUI_CANVAS_STYLIZE_LOAD_IMAGE_NODE_ID?.trim() ||
    findNodeIdByClassType(workflow, "LoadImage");
  const positiveId =
    process.env.COMFYUI_CANVAS_STYLIZE_POSITIVE_CLIP_NODE_ID?.trim() ||
    findPositiveClipNodeId(workflow);
  const samplerId =
    process.env.COMFYUI_CANVAS_STYLIZE_KSAMPLER_NODE_ID?.trim() ||
    findNodeIdByClassType(workflow, "KSampler");

  if (!ckptId || !workflow[ckptId]?.inputs) {
    throw new Error("Stylize workflow: CheckpointLoaderSimple node not found.");
  }
  if (!loadImageId || !workflow[loadImageId]?.inputs) {
    throw new Error("Stylize workflow: LoadImage node not found.");
  }
  if (!positiveId || !workflow[positiveId]?.inputs) {
    throw new Error("Stylize workflow: positive CLIPTextEncode node not found.");
  }
  if (!samplerId || !workflow[samplerId]?.inputs) {
    throw new Error("Stylize workflow: KSampler node not found.");
  }

  workflow[ckptId].inputs.ckpt_name = patch.checkpoint;
  workflow[loadImageId].inputs.image = patch.uploadName;
  workflow[positiveId].inputs.text = patch.promptText;
  workflow[samplerId].inputs.seed = createSeed();
  workflow[samplerId].inputs.denoise = patch.denoise;
  if (typeof patch.cfgScale === "number" && Number.isFinite(patch.cfgScale)) {
    workflow[samplerId].inputs.cfg = patch.cfgScale;
  }

  const negId =
    process.env.COMFYUI_CANVAS_STYLIZE_NEGATIVE_CLIP_NODE_ID?.trim() || findNegativeLikeClipNodeId(workflow);
  if (negId && workflow[negId]?.inputs && typeof patch.negativeAppend === "string" && patch.negativeAppend.trim()) {
    const base = String(workflow[negId].inputs.text ?? "");
    workflow[negId].inputs.text = `${base}, ${patch.negativeAppend.trim()}`;
  }
}

async function uploadBlob(baseUrl, blob, filename) {
  const formData = new FormData();
  formData.append("image", blob, filename);
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

async function queueWorkflow(baseUrl, promptWorkflow) {
  const promptPath = getApiPath(baseUrl, "/prompt", "/api/prompt");
  const cloudMode = isCloudBaseUrl(baseUrl);
  const apiKey = cloudMode ? getCloudApiKey() : "";
  const requestBody = { prompt: promptWorkflow };
  if (cloudMode && apiKey) {
    requestBody.extra_data = { api_key_comfy_org: apiKey };
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

function extractImagesFromHistory(promptHistory, outputNodeId) {
  const outputs = promptHistory?.outputs;
  if (!outputs || typeof outputs !== "object") {
    return [];
  }
  const preferred = outputs[outputNodeId];
  if (Array.isArray(preferred?.images) && preferred.images.length > 0) {
    return preferred.images;
  }
  return Object.values(outputs).flatMap((nodeOutput) =>
    Array.isArray(nodeOutput?.images) ? nodeOutput.images : [],
  );
}

async function waitForOutputImage(baseUrl, promptId, outputNodeId) {
  const timeoutMs = Number(process.env.COMFYUI_CANVAS_STYLIZE_TIMEOUT_MS ?? process.env.COMFYUI_POLL_TIMEOUT_MS ?? 120000);
  const intervalMs = Number(process.env.COMFYUI_POLL_INTERVAL_MS ?? 1500);
  const historyPath = getApiPath(baseUrl, `/history/${promptId}`, `/api/history_v2/${promptId}`);
  const statusPath = getApiPath(baseUrl, "", `/api/job/${promptId}/status`);
  const cloudMode = isCloudBaseUrl(baseUrl);
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const response = await fetch(`${baseUrl}${historyPath}`, {
      headers: getAuthHeaders(baseUrl),
    });

    if (response.ok) {
      const payload = await response.json();
      const promptHistory = payload[promptId] ?? payload;
      const images = extractImagesFromHistory(promptHistory, outputNodeId);
      if (images.length > 0) {
        return images[0];
      }
    } else if (!cloudMode || response.status !== 404) {
      throwComfyHttpError("ComfyUI /history", response, baseUrl);
    }

    if (cloudMode) {
      const statusResponse = await fetch(`${baseUrl}${statusPath}`, {
        headers: getAuthHeaders(baseUrl),
      });
      if (statusResponse.ok) {
        const statusPayload = await statusResponse.json();
        const status = String(statusPayload.status ?? "");
        if (status === "failed" || status === "cancelled") {
          const reason = statusPayload.message ?? status;
          throw new Error(`ComfyUI cloud job ${status}: ${reason}`);
        }
      }
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error("ComfyUI canvas stylize timed out waiting for output.");
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

async function fetchImageAsBase64Png(baseUrl, image) {
  let viewUrl = toViewUrl(baseUrl, image);
  if (isCloudBaseUrl(baseUrl)) {
    const response = await fetch(viewUrl, {
      headers: getAuthHeaders(baseUrl),
      redirect: "manual",
    });
    if (response.status === 302) {
      const signed = response.headers.get("location");
      if (signed) {
        viewUrl = signed;
      }
    }
  }
  const imgRes = await fetch(viewUrl, { headers: getAuthHeaders(baseUrl) });
  if (!imgRes.ok) {
    throw new Error(`Failed to fetch Comfy output image (${imgRes.status}).`);
  }
  const buf = Buffer.from(await imgRes.arrayBuffer());
  return buf.toString("base64");
}

/** Extra prompt suffixes for Render dual-output preset (sequential Comfy passes). */
const DUAL_RENDER_PASS_SUFFIXES = [
  "Cinematic pass: single hero render—dramatic controlled studio lighting, subtle depth of field, tangible premium materials, high-end 3D product visualization, believable scale.",
  "Angles pass: same subject and design intent—alternate camera views (three-quarter and side or orthographic read); keep proportions, materials, and dimensions consistent with a multi-angle product presentation.",
];

/**
 * Img2img: lower denoise + CFG reduces warped/squashed geometry; extra negatives curb abstract drift.
 * Override denoise with COMFYUI_CANVAS_STYLIZE_DENOISE_IMAGE (e.g. 0.52–0.65).
 */
function getStylizeStrengthParams(resolvedBasename, mode) {
  const base = String(resolvedBasename ?? "").toLowerCase();
  const isImageMode = mode === "image";
  if (!isImageMode) {
    return {
      denoise: 0.92,
      cfgScale: undefined,
      negativeAppend: "",
      compositionSuffix: "",
    };
  }
  const envD = process.env.COMFYUI_CANVAS_STYLIZE_DENOISE_IMAGE?.trim();
  const denoise =
    envD !== "" && !Number.isNaN(Number(envD)) ? Math.min(0.95, Math.max(0.35, Number(envD))) : 0.58;
  const cfgScale = 5.75;
  let negativeAppend = "";
  if (base.includes("exterior")) {
    negativeAppend =
      "squashed flat car, compressed width, stretched height, wrong wheel ellipse, barrel distortion, melting body, asymmetric panels, duplicated wheels, toy proportions, pancake vehicle";
  } else if (base.includes("interior")) {
    negativeAppend =
      "floating abstract blobs, random geometric sculpture, disconnected objects, non-automotive props, impossible cabin, chaos, pure abstract art, meaningless shapes, blob furniture";
  }
  const compositionSuffix =
    " Preserve the reference image layout, camera angle, horizon, and aspect ratio; do not crop, stretch horizontally, or vertically squash the subject; keep proportions consistent with the input; refine materials and lighting only.";
  return { denoise, cfgScale, negativeAppend, compositionSuffix };
}

/**
 * @param {{
 *   mode: "image" | "text",
 *   textPrompt: string,
 *   mimeType?: string,
 *   base64Data?: string,
 *   intent?: "text" | "image" | "hybrid",
 *   workflowFile?: string,
 *   automotiveContext?: string,
 *   dualRender?: boolean,
 * }} opts
 * @returns {Promise<{ base64Png: string, mimeType: string, secondBase64Png?: string, labels?: string[] }>}
 */
export async function stylizeWithComfy(opts) {
  const baseUrl = normalizeBaseUrl(process.env.COMFYUI_BASE_URL);
  if (!baseUrl) {
    throw new Error("COMFYUI_BASE_URL is not set.");
  }

  const checkpoint = process.env.COMFYUI_CHECKPOINT_NAME?.trim() || "dreamshaper_8.safetensors";

  let dataUrl;
  if (opts.mode === "image" && opts.base64Data && opts.mimeType) {
    const mt = opts.mimeType.includes("jpeg") ? "image/jpeg" : "image/png";
    dataUrl = `data:${mt};base64,${opts.base64Data}`;
  } else {
    dataUrl = `data:image/png;base64,${WHITE_PNG_BASE64}`;
  }

  const { mimeType, blob } = (() => {
    const m = dataUrl.match(/^data:(.+?);base64,(.+)$/);
    if (!m) {
      throw new Error("Invalid data URL for stylize upload.");
    }
    const mt = m[1];
    const b64 = m[2];
    const buffer = Buffer.from(b64, "base64");
    return { mimeType: mt, blob: new Blob([buffer], { type: mt }) };
  })();

  const ext = mimeType.includes("jpeg") ? "jpg" : mimeType.includes("webp") ? "webp" : "png";
  const uploadName = await uploadBlob(
    baseUrl,
    blob,
    `canvas-stylize-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`,
  );

  const runOnePass = async (extraPromptSuffix) => {
    const { workflow: template, resolvedBasename } = await loadStylizeWorkflowTemplate(opts.workflowFile);
    const workflow = JSON.parse(JSON.stringify(template));
    const strength = getStylizeStrengthParams(resolvedBasename, opts.mode);
    let promptText = buildStylizePrompt(opts.textPrompt, opts.automotiveContext, extraPromptSuffix);
    if (strength.compositionSuffix) {
      promptText += strength.compositionSuffix;
    }
    applyStylizePatches(workflow, {
      checkpoint,
      uploadName,
      promptText,
      denoise: strength.denoise,
      cfgScale: strength.cfgScale,
      negativeAppend: strength.negativeAppend,
    });
    const saveId =
      process.env.COMFYUI_CANVAS_STYLIZE_OUTPUT_NODE_ID?.trim() || findSaveImageNodeId(workflow);
    if (!saveId) {
      throw new Error("Stylize workflow: SaveImage output node not found.");
    }
    const promptId = await queueWorkflow(baseUrl, workflow);
    const image = await waitForOutputImage(baseUrl, promptId, saveId);
    return fetchImageAsBase64Png(baseUrl, image);
  };

  if (opts.dualRender) {
    const first = await runOnePass(DUAL_RENDER_PASS_SUFFIXES[0]);
    const second = await runOnePass(DUAL_RENDER_PASS_SUFFIXES[1]);
    return {
      base64Png: first,
      secondBase64Png: second,
      mimeType: "image/png",
      labels: ["Cinematic", "Angles"],
    };
  }

  const base64Png = await runOnePass("");
  return { base64Png, mimeType: "image/png" };
}
