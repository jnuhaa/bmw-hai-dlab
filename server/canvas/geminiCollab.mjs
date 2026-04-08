/** Google Gemini (Generative Language API) for Converge Collab — JSON + vision. */

import { getBrandAppendFor } from "./convergeBrandContext.mjs";

const GEMINI_GENERATE_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export function geminiApiKey() {
  return (
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GOOGLE_API_KEY?.trim() ||
    process.env.gemini_api_key?.trim() ||
    ""
  );
}

export function defaultCollabModel() {
  return process.env.GEMINI_COLLAB_MODEL?.trim() || "gemini-2.5-flash";
}

/**
 * POST to Generative Language API with retries on transient errors (429, 503, overloaded / high-demand messages).
 * Team brainstorm issues many sequential calls; this reduces flakiness when capacity is tight.
 */
export async function postGeminiJsonWithRetry(url, bodyObject) {
  const maxAttempts = Math.min(8, Math.max(1, Number(process.env.GEMINI_MAX_RETRIES?.trim() || 5) || 5));
  const baseMs = Number(process.env.GEMINI_RETRY_BASE_MS?.trim() || 1200) || 1200;
  let last = { r: null, data: {} };
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(bodyObject),
    });
    const data = await r.json().catch(() => ({}));
    last = { r, data };
    if (r.ok) {
      return { r, data };
    }
    const msg = typeof data?.error?.message === "string" ? data.error.message : "";
    const retryable =
      r.status === 429 ||
      r.status === 503 ||
      (r.status === 500 && /UNAVAILABLE|Internal|internal/i.test(msg)) ||
      /high demand|Resource exhausted|overloaded|try again later|UNAVAILABLE|503|rate|temporar/i.test(msg);
    if (!retryable || attempt === maxAttempts - 1) {
      return { r, data };
    }
    const delay = baseMs * Math.pow(2, attempt) + Math.floor(Math.random() * 400);
    await new Promise((res) => setTimeout(res, delay));
  }
  return last;
}

const SYSTEM_JSON = `You are a colleague at the board: warm, concise, human-like. Respond with ONLY valid JSON (no markdown fences unless necessary). The JSON must match this shape:
{
  "reading_reactions": ["string", ...],
  "note": "string",
  "role": "insight" | "challenge" | "build",
  "expansions": ["string", ...],
  "expansion_mode": "spread" | "opposing",
  "opposing_target_hint": "string or empty",
  "reflection_phases": [
    { "thought": "string", "strokes": [[{"x": number, "y": number}, ...], ...] }
  ],
  "annotation_phases": [
    { "thought": "string", "strokes": [[{"x": number, "y": number}, ...], ...] }
  ]
}
- role: must be one of insight | challenge | build. The user message states the assigned stance for this turn (picked uniformly at random by the client); set "role" to that exact value and write the main note in that voice.
- reading_reactions: 0–4 short spontaneous reactions while taking in the board (e.g. appreciation, curiosity). Omit or use [] if none.
- expansions: 0 to 3 items only; you may output 0, 1, 2, or 3. Do not always output three.
- expansion_mode: "spread" places ideas in a row below the main note; "opposing" emphasizes a counterpoint (first expansion may be treated as the counter-sticky).
- reflection_phases: 1 to 3 phases. Each thought can be a full sentence; coordinates are canvas space for sketch strokes.
- annotation_phases: optional 0 to 2 phases, played after reflection_phases in the client. Use for lighter callout ink (arrows, circles, emphasis) that clarifies the main sketch—not a second full concept sketch. Omit or use [] if none.
When the user message includes visible_world_rect and image_overlay_hints, keep strokes mostly inside the visible rect and you may overlap the listed image bounds to sketch on reference images.
Sketch style (critical): Draw like a designer exploring an idea—gestural concept sketches, not just annotations. Use loose organic curves, simple volumes or UI blocks, light perspective, storyboard-style frames, or flow diagrams that illustrate a new concept. Prefer multiple strokes per phase with varied point spacing; include closed or overlapping shapes where it helps. Do NOT only draw straight connectors between existing board nodes or thin underlines unless the thought explicitly calls for annotation. Place sketch clusters in open canvas space (e.g. near your new stickies or below the anchor), not only edge-to-edge between assets.`;

/**
 * @param {{ prompt: string, images?: { mimeType: string, base64: string }[] }} input
 * @returns {Promise<string>} model text (JSON or prose to parse)
 */
export async function callGeminiCollabJson(input) {
  const key = geminiApiKey();
  if (!key) {
    throw new Error("GEMINI_API_KEY is not set");
  }

  const modelId = defaultCollabModel();
  const url = `${GEMINI_GENERATE_BASE}/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(key)}`;

  const parts = [{ text: input.prompt }];
  const cappedImages = (input.images ?? []).slice(0, 8);
  for (const img of cappedImages) {
    const mt = img.mimeType?.includes("jpeg")
      ? "image/jpeg"
      : img.mimeType?.includes("webp")
        ? "image/webp"
        : "image/png";
    parts.push({
      inlineData: {
        mimeType: mt,
        data: img.base64,
      },
    });
  }

  const brand = getBrandAppendFor("geminiCollab");
  const systemWithBrand = brand
    ? `${SYSTEM_JSON}\n\nDesign studio framing (always respect): ${brand}`
    : SYSTEM_JSON;

  const body = {
    systemInstruction: {
      parts: [{ text: systemWithBrand }],
    },
    contents: [
      {
        role: "user",
        parts,
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.78,
      maxOutputTokens: 8192,
    },
  };

  const { r, data } = await postGeminiJsonWithRetry(url, body);

  if (r.status === 429) {
    const msg = data?.error?.message || "Quota exceeded";
    throw new Error(`Gemini rate limited: ${msg}`);
  }

  if (!r.ok) {
    const apiErr = data?.error;
    const msg =
      (typeof apiErr === "object" && apiErr?.message) ||
      (typeof apiErr === "string" ? apiErr : null) ||
      `Gemini HTTP ${r.status}`;
    const status = typeof apiErr === "object" && apiErr?.status ? ` [${apiErr.status}]` : "";
    throw new Error(`${String(msg)}${status}`);
  }

  const blockReason = data?.promptFeedback?.blockReason;
  if (blockReason) {
    throw new Error(`Gemini blocked prompt: ${blockReason}`);
  }

  const text = extractTextFromGeminiResponse(data);
  if (!text) {
    const finish = data?.candidates?.[0]?.finishReason ?? "";
    throw new Error(`No text in Gemini response (finishReason: ${finish || "unknown"})`);
  }

  return text;
}

function extractTextFromGeminiResponse(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) {
    return "";
  }
  return parts
    .map((p) => (typeof p?.text === "string" ? p.text : ""))
    .filter(Boolean)
    .join("\n");
}
