/** Imagen text-to-image via Gemini API predict (same API key as Collab). */

import { geminiApiKey, postGeminiJsonWithRetry } from "./geminiCollab.mjs";
import { getBrandAppendFor } from "./convergeBrandContext.mjs";

const IMAGEN_MODEL = process.env.GEMINI_IMAGEN_MODEL?.trim() || "imagen-4.0-fast-generate-001";

/**
 * @returns {Promise<{ base64: string, mimeType: string }>}
 */
export async function generateImagenImageBase64(prompt) {
  const key = geminiApiKey();
  if (!key) {
    throw new Error("GEMINI_API_KEY is not set");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(IMAGEN_MODEL)}:predict?key=${encodeURIComponent(key)}`;

  const brand = getBrandAppendFor("imagen");
  const merged = brand ? `${String(prompt).trim()}. ${brand}` : String(prompt);
  const body = {
    instances: [{ prompt: merged.slice(0, 2000) }],
    parameters: {
      sampleCount: 1,
      aspectRatio: "4:3",
    },
  };

  const { r, data } = await postGeminiJsonWithRetry(url, body);

  if (!r.ok) {
    const msg = data?.error?.message || `Imagen HTTP ${r.status}`;
    throw new Error(String(msg));
  }

  const preds = data.predictions;
  if (!Array.isArray(preds) || preds.length === 0) {
    throw new Error("Imagen returned no predictions");
  }

  const p0 = preds[0];
  const b64 =
    p0?.bytesBase64Encoded ||
    p0?.bytes_base64_encoded ||
    p0?.image?.bytesBase64Encoded ||
    p0?.imageBytes ||
    "";

  if (typeof b64 !== "string" || b64.length < 32) {
    throw new Error("Imagen returned no image bytes");
  }

  return {
    base64: b64,
    mimeType: typeof p0?.mimeType === "string" ? p0.mimeType : "image/png",
  };
}
