# BMW AI Design Workflow MVP

Designer-led Curate / Diverge prototype with:
- desktop sphere workspace
- browser camera + phone relay capture
- crop-to-ingredient flow
- image-to-workflow extraction with ComfyUI (plus mock fallback)
- **Converge** stage: infinite canvas (CANVAS.OS-style) with moodboard seeding and AI Collab / Stylize

## Run Locally

1. Install dependencies:

```bash
npm install
```

2. Create env file:

```bash
cp .env.example .env
```

3. Start dev server:

```bash
npm run dev
```

4. Open **http://localhost:5173** in your browser (use the port Vite prints if 5173 is already in use).

**Gemini / Collab on your Mac (simplest):** Add `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) to `.env`, save, and restart `npm run dev`. No tunnel or VPS required. Optional: `curl -sS http://127.0.0.1:5173/api/canvas/status` — you should see `"collabConfigured": true`. Leave `VITE_REDIRECT_LOCAL_TO_PUBLIC` unset so you stay on localhost. If port 5173 is busy, run `npm run dev -- --port 5174` and use that URL.

### Local dev vs public URL / phone capture

Phone relay uploads go to the same in-memory live-capture session as the Curate tab (`/api/live-capture`). The phone and desktop must use the **same origin** (same dev server process). On **Curate**, the **Phone capture** card shows a **QR code** and link to `https://<host>/phone/<sessionId>` so the phone pairs to your tab; opening bare `/phone` uses the server “latest” session only (weaker for multiple users). If you browse the app as **`http://localhost`**, the QR encodes localhost and **your phone cannot connect** — set **`VITE_PHONE_CAPTURE_ORIGIN=http://<your-LAN-IP>:5173`** in `.env` (see `.env.example`) or open the app using your computer’s LAN IP. For a stable HTTPS URL on your LAN or for demos, use a Cloudflare Tunnel (or similar) and open that URL on both devices; see [docs/cloudflare-tunnel.md](docs/cloudflare-tunnel.md). Production checklist: [docs/netailab.com.md](docs/netailab.com.md). Optional `VITE_PUBLIC_APP_ORIGIN` in `.env` does **not** redirect `localhost` unless you also set `VITE_REDIRECT_LOCAL_TO_PUBLIC=true`. If you enable that redirect, append `?local=1` to stay on localhost when needed.

## Converge canvas (Collab / Stylize)

The **Converge** design stage opens a full-viewport infinite canvas. Images from the Curate moodboard appear as nodes when you first enter Converge.

- **Collab** and **Stylize** call the dev server at `POST /api/canvas/collab` and `POST /api/canvas/stylize` (see `server/canvas/canvasRoute.mjs`). The browser never sends API keys.
- **Collab (Gemini):** Set `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) in `.env`. Optionally set `GEMINI_COLLAB_MODEL`. Restart `npm run dev` so the Vite dev server loads env into `process.env`. Collab uses the [Generative Language API](https://ai.google.dev/api) (`generateContent`) with vision on your canvas images.
- **Stylize (ComfyUI):** When `EXTRACTION_PROVIDER=comfyui` and `COMFYUI_BASE_URL` point at a reachable Comfy instance (same as extraction), Stylize runs an img2img workflow (`comfy/workflows/extract-image-api.json` by default). Tune with `COMFYUI_CANVAS_STYLIZE_*` variables (see `.env.example`). If Comfy is not configured, the server returns a tiny placeholder PNG with `mock: true` so the UI still runs.
- **Without a Gemini key:** Collab returns fixed **demo** JSON. **Without Comfy for Stylize:** a 1×1 placeholder image and `mock: true`. If Gemini is configured but the API errors, you get an HTTP error and a HUD message instead of silent mock data.

## Extraction Providers

### Mock mode

```bash
EXTRACTION_PROVIDER=mock npm run dev
```

### Real ComfyUI mode

Required in `.env`:
- `EXTRACTION_PROVIDER=comfyui`
- `COMFYUI_BASE_URL=http://127.0.0.1:8188`
- `COMFYUI_CHECKPOINT_NAME=<installed checkpoint filename>` (defaults in repo target `dreamshaper_8.safetensors`; set to match your file exactly)

### Comfy Cloud mode

Required in `.env`:
- `EXTRACTION_PROVIDER=comfyui`
- `COMFYUI_BASE_URL=https://cloud.comfy.org`
- `COMFYUI_API_KEY=<your-comfy-cloud-api-key>` (or the same value in `COMFY_CLOUD_API_KEY`)

Optional:
- `COMFYUI_CLOUD_MODE=true` if `COMFYUI_BASE_URL` is not `cloud.comfy.org` but still uses Comfy Cloud-style `/api/...` routes and `X-API-Key` auth
- `COMFYUI_ALLOW_MOCK_FALLBACK=true` if you want fallback mock output on cloud/API failure
- `COMFYUI_OUTPUT_BASE_URL` (if browser cannot reach `COMFYUI_BASE_URL` directly)
- `COMFYUI_WORKFLOW_PATH` or `COMFYUI_WORKFLOW_JSON` (to override default template)
- node-id overrides for injection (`COMFYUI_IMAGE_NODE_ID`, `COMFYUI_PROMPT_NODE_ID`, etc.)
- poll tuning (`COMFYUI_POLL_INTERVAL_MS`, `COMFYUI_POLL_TIMEOUT_MS`)
- `COMFYUI_DEBUG=true` for verbose Comfy integration logs
- `COMFYUI_IMAGE_SCALE_BY` — overrides post-decode upscale factor on `ImageScaleBy` nodes (bundled workflows default to 2×; set `1` to disable)
- `COMFYUI_EMBEDDED_PROMPTS_ONLY=true` — skip server prompt injection and use only the workflow JSON’s CLIP text (automatic for `interior_uxui_3way_api.json` when selected in the app)

## Output sharpness and “literal” scenes

Bundled workflows apply a **2× Lanczos** `ImageScaleBy` step after `VAEDecode` to reduce soft, low-resolution output. For **neural** upscaling (e.g. Real-ESRGAN), install the matching model in ComfyUI and replace or extend that step in your workflow JSON.

**Literal bathrooms / interiors** usually come from **(1)** the base model (SD 1.5 is photo-biased), **(2)** **img2img / ControlNet** in any workflow that still uses edge-locked control (older or custom JSON), and **(3)** **denoise** that still follows the source. The default `sculptural_essence_3way_api.json` in this repo now matches the **3-way img2img** graph (no bundled ControlNet); for more abstraction, lower denoise in the graph or switch checkpoint. Stronger negatives and prompts help.

## One Prepared Workflow Template

Default template path:
- [comfy/workflows/extract-image-api.json](/Users/jnuha/Documents/Playground/comfy/workflows/extract-image-api.json)

This is an API-format ComfyUI graph with one img2img path:
- `LoadImage`
- `CheckpointLoaderSimple`
- `CLIPTextEncode` (positive + negative)
- `VAEEncode`
- `KSampler`
- `VAEDecode`
- `ImageScaleBy` (2× post upscale)
- `SaveImage`

## Extraction Request / Response Path

Frontend calls:
- `POST /api/extract` (create generation job)
- `GET /api/extract/:generationJobId` (poll job status)

Backend flow:
1. route validation in [server/extraction/extractRoute.mjs](/Users/jnuha/Documents/Playground/server/extraction/extractRoute.mjs)
2. job lifecycle state in [server/extraction/extractionJobService.mjs](/Users/jnuha/Documents/Playground/server/extraction/extractionJobService.mjs)
3. provider selection + fallback in [server/extraction/extractionService.mjs](/Users/jnuha/Documents/Playground/server/extraction/extractionService.mjs)
4. Comfy execution in [server/extraction/comfyUiExtractionService.mjs](/Users/jnuha/Documents/Playground/server/extraction/comfyUiExtractionService.mjs)

## Where Injection Happens

Workflow input injection happens in:
- `prepareWorkflow(...)` inside [server/extraction/comfyUiExtractionService.mjs](/Users/jnuha/Documents/Playground/server/extraction/comfyUiExtractionService.mjs)
- which calls `injectWorkflowInputs(...)` in the same module

Injected runtime values:
- source image filename (after upload)
- prompt/context text
- negative prompt
- checkpoint name
- extraction mode (via prompt text and optional mode node)

## How Outputs Are Resolved

After ComfyUI returns outputs, image URLs are resolved to `/view` endpoints in:
- `toViewUrl(...)` inside [server/extraction/comfyUiExtractionService.mjs](/Users/jnuha/Documents/Playground/server/extraction/comfyUiExtractionService.mjs)

Base used for output URLs:
- `COMFYUI_OUTPUT_BASE_URL` if set
- otherwise `COMFYUI_BASE_URL`

## Parent-Child Linking

Each generated output includes:
- unique generated asset id
- `parentAssetId` (clicked source image id)
- `workflowType`
- image URL
- generation metadata (provider, providerJobId, generatedAt)

Frontend linking is stored in asset state:
- `parentAssetId` on child assets
- `childAssetIds` on source assets

Key files:
- [src/types/assets.ts](/Users/jnuha/Documents/Playground/src/types/assets.ts)
- [src/types/extraction.ts](/Users/jnuha/Documents/Playground/src/types/extraction.ts)
- [src/screens/CurateScreen.tsx](/Users/jnuha/Documents/Playground/src/screens/CurateScreen.tsx)
- [src/components/SourceAssetPanel.tsx](/Users/jnuha/Documents/Playground/src/components/SourceAssetPanel.tsx)
- [src/components/three/MemorySphere.tsx](/Users/jnuha/Documents/Playground/src/components/three/MemorySphere.tsx)

## Reliability Behavior

- If `EXTRACTION_PROVIDER=comfyui` and ComfyUI succeeds, provider = `comfyui`.
- If `EXTRACTION_PROVIDER=comfyui` and ComfyUI fails:
  - with `COMFYUI_ALLOW_MOCK_FALLBACK=false` (default), job fails loudly with an error message.
  - with `COMFYUI_ALLOW_MOCK_FALLBACK=true`, backend falls back to mock output and includes `fallbackReason`.
- If `EXTRACTION_PROVIDER=mock`, only mock path runs.

## Stable Public Demo URL (Optional)

**Local dev + tunnel:** Use a named Cloudflare Tunnel and point it to `http://localhost:5173` while `npm run dev` runs. See [docs/cloudflare-tunnel.md](docs/cloudflare-tunnel.md).

**Shareable link with APIs (Collab, extract, live capture):** Static uploads of `dist/` are not enough—you need a Node process running **`vite preview`** and the tunnel aimed at that port. See [docs/deploy-public-tunnel.md](docs/deploy-public-tunnel.md) (`npm run preview:public` on port **4173**). For a **small VPS** with systemd + cloudflared, see [docs/deploy-vps.md](docs/deploy-vps.md).

**netailab.com (Gemini + ComfyUI + phone capture):** Follow [docs/netailab.com.md](docs/netailab.com.md) for DNS, Cloudflare Tunnel → `localhost:4173`, `.env` on the VPS, and verification. Systemd templates: [deploy/systemd/](deploy/systemd/). After deploy: `npm run verify:deploy` (or `PUBLIC_URL=https://your-domain.com npm run verify:deploy`).

**Operational helpers:**
- VPS bootstrap: `npm run bootstrap:vps`
- Repeatable VPS deploy + restart + health check: `npm run deploy:vps`
- Optional API protection: set `API_SHARED_KEY` and pass it as `x-api-key` (or bearer token) to non-status `/api/*` routes.
- Optional state persistence across restarts: set `SERVER_STATE_DIR=.runtime` (stores JSON snapshots for live-capture sessions and extraction jobs).
