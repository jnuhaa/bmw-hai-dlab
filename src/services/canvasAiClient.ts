export type CollabReflectionPhase = {
  thought: string;
  strokes: { x: number; y: number }[][];
};

export type CollabExpansionMode = "spread" | "opposing";

export type CollabResponse = {
  note: string;
  role: "insight" | "challenge" | "build";
  expansions: string[];
  reflection_phases: CollabReflectionPhase[];
  /**
   * Optional follow-up ink played after reflection_phases: callouts, arrows, light emphasis—
   * same canvas coordinates; client uses a thinner stroke than the main sketch.
   */
  annotation_phases?: CollabReflectionPhase[];
  /** Short spontaneous lines while “reading” the board (0–4). */
  reading_reactions?: string[];
  /** How to place expansion stickies relative to the main note. */
  expansion_mode?: CollabExpansionMode;
  /** Optional hint for opposing / contrast framing (for the model; may be shown in prompt only). */
  opposing_target_hint?: string;
  /** Present when the server has no Gemini key and returns canned demo JSON. */
  mock?: boolean;
};

export type StylizeResponse = {
  base64Png: string;
  mimeType: string;
  /** Second image when Render dual-output preset is used (Comfy sequential passes). */
  secondBase64Png?: string;
  /** Parallel labels for dual output, e.g. ["Cinematic", "Angles"]. */
  labels?: string[];
  mock?: boolean;
};

export type CanvasAiStatus = {
  provider: string;
  collabConfigured: boolean;
  /** Same key as Collab; used for team brainstorm + Imagen. */
  brainstormConfigured?: boolean;
  imagenConfigured?: boolean;
  collabModel: string;
  stylizeBackend: "comfyui" | "none";
  stylizeConfigured: boolean;
};

/** Same shape as Collab for one brainstorm turn, plus optional Imagen prompt and speaker label. */
export type BrainstormTurnResponse = {
  note: string;
  role?: "insight" | "challenge" | "build";
  expansions?: string[];
  reflection_phases?: CollabReflectionPhase[];
  annotation_phases?: CollabReflectionPhase[];
  reading_reactions?: string[];
  expansion_mode?: CollabExpansionMode;
  opposing_target_hint?: string;
  /** Optional English prompt for Imagen (server may ignore if empty). */
  image_prompt?: string;
  /** Alpha or Beta — should match the speaking agent for this turn. */
  agent_label?: string;
  mock?: boolean;
};

export type BrainstormConcludeResponse = {
  conclusion: string;
  mock?: boolean;
};

export async function fetchCanvasAiStatus(): Promise<CanvasAiStatus> {
  try {
    const res = await fetch("/api/canvas/status");
    if (!res.ok) {
      throw new Error("status unavailable");
    }
    return res.json() as Promise<CanvasAiStatus>;
  } catch {
    return {
      provider: "gemini",
      collabConfigured: false,
      brainstormConfigured: false,
      imagenConfigured: false,
      collabModel: "gemini-2.5-flash",
      stylizeBackend: "none",
      stylizeConfigured: false,
    };
  }
}

function parseJsonErrorBody(raw: string): { error?: string; detail?: string } {
  if (!raw.trim()) {
    return {};
  }
  try {
    return JSON.parse(raw) as { error?: string; detail?: string };
  } catch {
    return {};
  }
}

function looksLikeHtmlErrorPage(raw: string): boolean {
  const t = raw.trimStart().toLowerCase();
  return t.startsWith("<!doctype") || t.startsWith("<html") || t.startsWith("<!--");
}

function canvasHttpErrorMessage(res: Response, raw: string): string {
  const err = parseJsonErrorBody(raw);
  if (typeof err.error === "string") {
    return [err.error, typeof err.detail === "string" ? err.detail : ""].filter(Boolean).join(" — ");
  }
  if (looksLikeHtmlErrorPage(raw)) {
    return [
      `HTTP ${res.status} (HTML error page, not JSON)`,
      "This hostname is not reaching the Node app that serves /api/canvas. Run npm run dev (5174) or npm run build && npm run preview:public (4173), set your Cloudflare Tunnel public hostname to http://localhost:4173 or :5174 on that same machine, and keep cloudflared running. Static-only hosting cannot serve these APIs.",
    ].join(" — ");
  }
  const snippet = raw.replace(/\s+/g, " ").trim().slice(0, 280);
  if (snippet) {
    return `HTTP ${res.status}: ${snippet}`;
  }
  return `HTTP ${res.status} ${res.statusText || "Bad Gateway"}`;
}

export async function requestCanvasCollab(body: {
  prompt: string;
  images?: { mimeType: string; base64: string }[];
  signal?: AbortSignal;
}): Promise<CollabResponse> {
  const res = await fetch("/api/canvas/collab", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: body.signal,
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(canvasHttpErrorMessage(res, raw));
  }
  return JSON.parse(raw) as CollabResponse;
}

export type StylizeIntent = "text" | "image" | "hybrid";

export async function requestCanvasStylize(body: {
  mode: "image" | "text";
  textPrompt: string;
  mimeType?: string;
  base64Data?: string;
  /** Client-derived; server uses for logging / future tuning (Comfy path unchanged for hybrid vs image). */
  intent?: StylizeIntent;
  /** Basename only, e.g. `stylize-automotive-exterior-api.json`. */
  workflowFile?: string;
  /** Merged into the positive prompt (automotive preset). */
  automotiveContext?: string;
  /** Run two sequential Comfy passes (cinematic + multi-angle) when true. */
  dualRender?: boolean;
}): Promise<StylizeResponse> {
  const res = await fetch("/api/canvas/stylize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(canvasHttpErrorMessage(res, raw));
  }
  return JSON.parse(raw) as StylizeResponse;
}

export async function requestCanvasBrainstormTurn(body: {
  prompt: string;
  /** Echoed for server mocks / logging; optional. */
  turnIndex?: number;
  persona?: "A" | "B";
  signal?: AbortSignal;
}): Promise<BrainstormTurnResponse> {
  const res = await fetch("/api/canvas/brainstorm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      phase: "turn",
      prompt: body.prompt,
      turnIndex: body.turnIndex,
      persona: body.persona,
    }),
    signal: body.signal,
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(canvasHttpErrorMessage(res, raw));
  }
  return JSON.parse(raw) as BrainstormTurnResponse;
}

export async function requestCanvasBrainstormConclude(body: {
  prompt: string;
  signal?: AbortSignal;
}): Promise<BrainstormConcludeResponse> {
  const res = await fetch("/api/canvas/brainstorm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phase: "conclude", prompt: body.prompt }),
    signal: body.signal,
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(canvasHttpErrorMessage(res, raw));
  }
  return JSON.parse(raw) as BrainstormConcludeResponse;
}

/** Imagen text-to-image; same response shape as stylize mock (base64Png + mimeType). */
export async function requestCanvasGenerateImage(body: {
  prompt: string;
  signal?: AbortSignal;
}): Promise<StylizeResponse> {
  const res = await fetch("/api/canvas/generate-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: body.prompt }),
    signal: body.signal,
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(canvasHttpErrorMessage(res, raw));
  }
  return JSON.parse(raw) as StylizeResponse;
}
