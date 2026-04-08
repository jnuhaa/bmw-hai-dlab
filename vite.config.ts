import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { createExtractRoutePlugin } from "./server/viteExtractRoute.mjs";

declare const process: {
  env: Record<string, string | undefined>;
};

const EXTRACTION_ENV_KEYS = [
  "EXTRACTION_PROVIDER",
  "COMFYUI_BASE_URL",
  "COMFYUI_API_KEY",
  "COMFY_CLOUD_API_KEY",
  "COMFYUI_CLOUD_MODE",
  "COMFYUI_ALLOW_MOCK_FALLBACK",
  "COMFYUI_WORKFLOW_PATH",
  "COMFYUI_WORKFLOW_JSON",
  "COMFYUI_IMAGE_NODE_ID",
  "COMFYUI_IMAGE_NODE_INPUT_KEY",
  "COMFYUI_PROMPT_NODE_ID",
  "COMFYUI_PROMPT_NODE_IDS",
  "COMFYUI_PROMPT_NODE_INPUT_KEY",
  "COMFYUI_NEGATIVE_PROMPT_NODE_ID",
  "COMFYUI_NEGATIVE_PROMPT_NODE_IDS",
  "COMFYUI_NEGATIVE_PROMPT_NODE_INPUT_KEY",
  "COMFYUI_CHECKPOINT_NODE_ID",
  "COMFYUI_CHECKPOINT_NODE_INPUT_KEY",
  "COMFYUI_CHECKPOINT_NAME",
  "COMFYUI_SAMPLER_NODE_ID",
  "COMFYUI_SAMPLER_NODE_IDS",
  "COMFYUI_SAMPLER_SEED_INPUT_KEY",
  "COMFYUI_SAVE_IMAGE_NODE_ID",
  "COMFYUI_SAVE_IMAGE_NODE_IDS",
  "COMFYUI_SAVE_IMAGE_PREFIX_INPUT_KEY",
  "COMFYUI_OUTPUT_NODE_ID",
  "COMFYUI_OUTPUT_NODE_IDS",
  "COMFYUI_OUTPUT_BASE_URL",
  "COMFYUI_DEBUG",
  "COMFYUI_POLL_TIMEOUT_MS",
  "COMFYUI_POLL_INTERVAL_MS",
  "COMFYUI_TIMEOUT_MS",
  "COMFYUI_IMAGE_SCALE_BY",
  "COMFYUI_EMBEDDED_PROMPTS_ONLY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "gemini_api_key",
  "GEMINI_COLLAB_MODEL",
  "COMFYUI_CANVAS_STYLIZE_WORKFLOW_PATH",
  "COMFYUI_CANVAS_STYLIZE_WORKFLOW",
  "COMFYUI_CANVAS_STYLIZE_TIMEOUT_MS",
  "COMFYUI_CANVAS_STYLIZE_OUTPUT_NODE_ID",
];

function applyExtractionEnvFromFiles(mode: string): Record<string, string> {
  const inheritedValues: Record<string, string | undefined> = {};

  for (const key of EXTRACTION_ENV_KEYS) {
    inheritedValues[key] = process.env[key];
    delete process.env[key];
  }

  const env = loadEnv(mode, ".", "");

  for (const key of EXTRACTION_ENV_KEYS) {
    if (Object.prototype.hasOwnProperty.call(env, key)) {
      process.env[key] = env[key];
    } else if (inheritedValues[key] !== undefined) {
      process.env[key] = inheritedValues[key];
    }
  }

  return env;
}

export default defineConfig(({ mode }) => {
  const env = applyExtractionEnvFromFiles(mode);

  for (const key in env) {
    process.env[key] = env[key];
  }

  return {
    plugins: [react(), createExtractRoutePlugin()],
    server: {
      host: "0.0.0.0",
      allowedHosts: true,
    },
  };
});
