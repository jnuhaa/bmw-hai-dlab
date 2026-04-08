import path from "node:path";
import { callGeminiCollabJson, geminiApiKey, defaultCollabModel } from "./geminiCollab.mjs";
import { callGeminiBrainstormJson } from "./geminiBrainstorm.mjs";
import { generateImagenImageBase64 } from "./geminiImagen.mjs";
import {
  isComfyStylizeConfigured,
  resolveWorkflowFilePath,
  stylizeWithComfy,
  STYLIZE_WORKFLOWS_DIR,
} from "./stylizeComfy.mjs";

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const rawBody = Buffer.concat(chunks).toString("utf8");
  return rawBody ? JSON.parse(rawBody) : {};
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

/** Minimal 1x1 PNG base64 for mock stylize when Comfy is not configured. */
const MOCK_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function mockCollabResponse() {
  return {
    reading_reactions: ["Oh—nice tension between the clusters.", "The center frame reads calm. Interesting."],
    note: "Strong spatial rhythm. Try pushing contrast on the secondary cluster.",
    role: "insight",
    expansion_mode: "spread",
    opposing_target_hint: "",
    expansions: ["Tighten focal hierarchy", "Add tactile reference"],
    reflection_phases: [
      {
        thought: "Blocking a quick volume here—loose loop to feel out the mass, then a second pass for the screen plane.",
        strokes: [
          [
            { x: 280, y: 260 },
            { x: 320, y: 240 },
            { x: 360, y: 250 },
            { x: 380, y: 290 },
            { x: 350, y: 320 },
            { x: 300, y: 310 },
            { x: 275, y: 285 },
          ],
          [
            { x: 400, y: 270 },
            { x: 440, y: 255 },
            { x: 480, y: 265 },
            { x: 500, y: 300 },
            { x: 470, y: 330 },
          ],
        ],
      },
      {
        thought: "Adding a light perspective box and a scribbled arrow for the interaction flow—not wiring nodes, just ideation.",
        strokes: [
          [
            { x: 200, y: 380 },
            { x: 260, y: 360 },
            { x: 320, y: 370 },
            { x: 340, y: 420 },
            { x: 280, y: 440 },
            { x: 210, y: 420 },
            { x: 200, y: 390 },
          ],
          [
            { x: 360, y: 400 },
            { x: 400, y: 395 },
            { x: 440, y: 410 },
            { x: 460, y: 450 },
          ],
        ],
      },
    ],
    annotation_phases: [
      {
        thought: "Quick callout—emphasize the hinge here.",
        strokes: [
          [
            { x: 300, y: 340 },
            { x: 330, y: 335 },
            { x: 355, y: 345 },
          ],
          [
            { x: 320, y: 355 },
            { x: 340, y: 365 },
          ],
        ],
      },
    ],
  };
}

/** Parse JSON from model output (pure JSON, fenced ```json```, or first `{...}` slice). */
function parseModelJson(text) {
  if (!text || typeof text !== "string") {
    return null;
  }
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {
    /* continue */
  }
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      /* continue */
    }
  }
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(t.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

function mockBrainstormTurn(body) {
  const ti = Number(body.turnIndex) || 0;
  const persona = body.persona === "B" ? "Beta" : "Alpha";
  const roles = ["insight", "challenge", "build"];
  const role = roles[ti % 3];
  return {
    reading_reactions: [`${persona} reading the thread…`, "One thread to build on."],
    note: `[Demo turn ${ti + 1}] Push the light graphic as a family cue; softer shoulder line; stay ${role}.`,
    role,
    expansions: ti % 2 === 0 ? ["Side-view clay next", "Parking-lot read"] : ["Tighten proportion first"],
    expansion_mode: ti % 3 === 0 ? "opposing" : "spread",
    opposing_target_hint: "",
    reflection_phases: [
      {
        thought: "Loose volume + light bar gesture.",
        strokes: [
          [
            { x: 48, y: 52 },
            { x: 120, y: 44 },
            { x: 200, y: 60 },
            { x: 240, y: 90 },
          ],
        ],
      },
    ],
    annotation_phases: [
      {
        thought: "Callout.",
        strokes: [
          [
            { x: 56, y: 100 },
            { x: 96, y: 96 },
          ],
        ],
      },
    ],
    image_prompt: ti === 0 ? "concept car front light bar reference" : "",
    agent_label: persona === "Alpha" ? "Alpha" : "Beta",
    mock: true,
  };
}

function mockBrainstormConclude() {
  return {
    conclusion:
      "Demo wrap-up: converge on a wide calm front with one iconic light signature; next step is a side-view clay to test proportion.",
    mock: true,
  };
}

export async function handleCanvasRoute(req, res) {
  const url = String(req.url ?? "").split("?")[0];
  const pathname = url.replace(/^\/api\/canvas/, "") || "/";

  if (req.method === "GET" && (pathname === "/status" || pathname === "/status/")) {
    const collabKey = geminiApiKey();
    const comfyReady = isComfyStylizeConfigured();
    sendJson(res, 200, {
      provider: "gemini",
      collabConfigured: Boolean(collabKey),
      brainstormConfigured: Boolean(collabKey),
      imagenConfigured: Boolean(collabKey),
      collabModel: defaultCollabModel(),
      stylizeBackend: comfyReady ? "comfyui" : "none",
      stylizeConfigured: comfyReady,
    });
    return;
  }

  if (req.method === "POST" && (pathname === "/brainstorm" || pathname === "/brainstorm/")) {
    const key = geminiApiKey();
    const body = await readJsonBody(req);

    if (typeof body.prompt !== "string" || body.prompt.trim().length === 0) {
      sendJson(res, 400, { error: "Invalid body: prompt (string) required" });
      return;
    }

    const phase = body.phase === "conclude" ? "conclude" : "turn";

    if (!key) {
      sendJson(res, 200, phase === "conclude" ? mockBrainstormConclude() : mockBrainstormTurn(body));
      return;
    }

    try {
      const text = await callGeminiBrainstormJson({
        prompt: body.prompt,
        phase,
      });
      const parsed = parseModelJson(text);
      if (!parsed || typeof parsed !== "object") {
        const snippet = text.slice(0, 200);
        console.error("[canvas/brainstorm] JSON parse failed, snippet:", text.slice(0, 400));
        sendJson(res, 502, {
          error: "Model did not return valid JSON",
          detail: snippet,
          snippet,
        });
        return;
      }
      sendJson(res, 200, parsed);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      console.error("[canvas/brainstorm]", detail);
      sendJson(res, 502, { error: "Brainstorm failed", detail });
    }
    return;
  }

  if (req.method === "POST" && (pathname === "/generate-image" || pathname === "/generate-image/")) {
    const key = geminiApiKey();
    const body = await readJsonBody(req);

    if (typeof body.prompt !== "string" || body.prompt.trim().length === 0) {
      sendJson(res, 400, { error: "Invalid body: prompt (string) required" });
      return;
    }

    if (!key) {
      sendJson(res, 200, {
        base64Png: MOCK_PNG_BASE64,
        mimeType: "image/png",
        mock: true,
      });
      return;
    }

    try {
      const { base64, mimeType } = await generateImagenImageBase64(body.prompt);
      sendJson(res, 200, { base64Png: base64, mimeType });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      console.error("[canvas/generate-image]", detail);
      sendJson(res, 502, { error: "Image generation failed", detail });
    }
    return;
  }

  if (req.method === "POST" && (pathname === "/collab" || pathname === "/collab/")) {
    const key = geminiApiKey();
    const body = await readJsonBody(req);

    if (!key) {
      sendJson(res, 200, { ...mockCollabResponse(), mock: true });
      return;
    }

    if (typeof body.prompt !== "string" || body.prompt.trim().length === 0) {
      sendJson(res, 400, { error: "Invalid body: prompt (string) required" });
      return;
    }

    const images = Array.isArray(body.images) ? body.images : [];
    for (const img of images) {
      if (!img || typeof img.base64 !== "string" || typeof img.mimeType !== "string") {
        sendJson(res, 400, { error: "Invalid images[]: each item needs mimeType and base64" });
        return;
      }
    }

    try {
      const text = await callGeminiCollabJson({
        prompt: body.prompt,
        images,
      });
      const parsed = parseModelJson(text);
      if (!parsed || typeof parsed !== "object") {
        const snippet = text.slice(0, 200);
        console.error("[canvas/collab] JSON parse failed, snippet:", text.slice(0, 400));
        sendJson(res, 502, {
          error: "Model did not return valid JSON",
          detail: snippet,
          snippet,
        });
        return;
      }
      sendJson(res, 200, parsed);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      console.error("[canvas/collab]", detail);
      sendJson(res, 502, { error: "Collab failed", detail });
    }
    return;
  }

  if (req.method === "POST" && (pathname === "/stylize" || pathname === "/stylize/")) {
    const body = await readJsonBody(req);

    if (isComfyStylizeConfigured()) {
      try {
        if (body.mode !== "image" && body.mode !== "text") {
          sendJson(res, 400, { error: "Invalid body: mode must be image or text" });
          return;
        }
        if (body.mode === "image" && (!body.base64Data || !body.mimeType)) {
          sendJson(res, 400, { error: "image mode requires base64Data and mimeType" });
          return;
        }
        const intentRaw = body.intent;
        if (
          intentRaw != null &&
          intentRaw !== "" &&
          intentRaw !== "text" &&
          intentRaw !== "image" &&
          intentRaw !== "hybrid"
        ) {
          sendJson(res, 400, { error: "Invalid body: intent must be text, image, or hybrid" });
          return;
        }
        const wf = body.workflowFile;
        if (wf != null && String(wf).trim() !== "") {
          const resolved = resolveWorkflowFilePath(STYLIZE_WORKFLOWS_DIR, wf);
          if (!resolved) {
            sendJson(res, 400, { error: "Invalid workflowFile (use a .json basename under comfy/workflows)" });
            return;
          }
        }
        const automotiveContext =
          typeof body.automotiveContext === "string" ? body.automotiveContext : undefined;
        const dualRender = body.dualRender === true;
        const result = await stylizeWithComfy({
          mode: body.mode,
          textPrompt: body.textPrompt ?? "",
          mimeType: body.mimeType,
          base64Data: body.base64Data,
          intent:
            intentRaw === "text" || intentRaw === "image" || intentRaw === "hybrid" ? intentRaw : undefined,
          workflowFile: typeof wf === "string" && wf.trim() ? path.basename(wf.trim()) : undefined,
          automotiveContext,
          dualRender,
        });
        sendJson(res, 200, result);
      } catch (e) {
        console.error("[canvas/stylize]", e);
        sendJson(res, 502, {
          error: "Canvas stylize failed",
          detail: e instanceof Error ? e.message : String(e),
        });
      }
      return;
    }

    const dualRender = body.dualRender === true;
    sendJson(res, 200, {
      base64Png: MOCK_PNG_BASE64,
      ...(dualRender ? { secondBase64Png: MOCK_PNG_BASE64, labels: ["Cinematic", "Angles"] } : {}),
      mimeType: "image/png",
      mock: true,
    });
    return;
  }

  res.statusCode = 404;
  res.end();
}
