/** Google Gemini JSON for Converge frame “team brainstorm” (alternating personas). */

import { geminiApiKey, defaultCollabModel, postGeminiJsonWithRetry } from "./geminiCollab.mjs";
import { getBrandAppendFor } from "./convergeBrandContext.mjs";

export { geminiApiKey };

const GEMINI_GENERATE_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

const SYSTEM_TURN = `You are one of two AI design colleagues taking turns inside a frame on a canvas (same interaction model as a single "Collab" response). Build on the transcript: reference prior turns, extend or challenge them constructively.

Respond with ONLY valid JSON (no markdown fences unless necessary). Shape:
{
  "reading_reactions": ["string", ...],
  "note": "string",
  "role": "insight" | "challenge" | "build",
  "expansions": ["string", ...],
  "expansion_mode": "spread" | "opposing",
  "opposing_target_hint": "",
  "reflection_phases": [ { "thought": "string", "strokes": [[{"x": number, "y": number}, ...], ...] } ],
  "annotation_phases": [ { "thought": "string", "strokes": [[...]] } ],
  "image_prompt": "string or empty",
  "agent_label": "Alpha" | "Beta"
}
- reading_reactions: 0–4 short spontaneous lines while taking in the thread (like reading the board).
- note: one main contribution for THIS turn only; under ~28 words; MUST match the assigned stance "role" (insight / challenge / build) injected in the user message.
- role: MUST be exactly the assigned stance string from the user message.
- expansions: 0–3 short ideas that build on the main note or the transcript; may be 0.
- expansion_mode: "spread" (row below main) or "opposing" (first expansion contrasts beside main; optional opposing_target_hint).
- reflection_phases: 1–3 phases; each has thought + strokes in LOCAL coordinates (origin top-left of the frame content area below the frame title). Gestural sketch, not only connectors. Keep inside 0..width and 0..height.
- annotation_phases: optional 0–2 lighter callout strokes after reflection; same coordinate system; thinner ink on the client.
- image_prompt: optional English prompt for a reference image; "" if none. One short image only when it helps.
- agent_label: must match your assigned speaker (Alpha or Beta) for this turn.

Stance meanings:
- insight: synthesize patterns; name what matters.
- challenge: push back constructively; probe assumptions.
- build: extend ideas; bridges and next steps.

`;

const SYSTEM_CONCLUDE = `You are summarizing a team brainstorm. Respond with ONLY valid JSON:
{
  "conclusion": "string",
  "reflection_phases": []
}
- conclusion: 2–4 sentences agreeing on a single direction, concept, or next step based on the transcript. No new wild ideas—synthesize only.
- reflection_phases: always []`;

/**
 * @param {{ prompt: string, phase: "turn" | "conclude" }} input
 */
export async function callGeminiBrainstormJson(input) {
  const key = geminiApiKey();
  if (!key) {
    throw new Error("GEMINI_API_KEY is not set");
  }

  const modelId = defaultCollabModel();
  const url = `${GEMINI_GENERATE_BASE}/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(key)}`;

  const brand = getBrandAppendFor("geminiBrainstorm");
  const brandBlock = brand ? `\n\nDesign studio framing (always respect): ${brand}\n` : "";
  const system =
    input.phase === "conclude"
      ? `${SYSTEM_CONCLUDE}${brandBlock}`
      : `${SYSTEM_TURN}${brandBlock}`;

  const body = {
    systemInstruction: {
      parts: [{ text: system }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: input.prompt }],
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
    throw new Error(String(msg));
  }

  const blockReason = data?.promptFeedback?.blockReason;
  if (blockReason) {
    throw new Error(`Gemini blocked prompt: ${blockReason}`);
  }

  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) {
    const finish = data?.candidates?.[0]?.finishReason ?? "";
    throw new Error(`No text in Gemini response (finishReason: ${finish || "unknown"})`);
  }

  return parts
    .map((p) => (typeof p?.text === "string" ? p.text : ""))
    .filter(Boolean)
    .join("\n");
}
