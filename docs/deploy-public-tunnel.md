# Public shareable URL (Cloudflare Tunnel + production preview)

Use this when you want a **stable HTTPS link** others can open (Converge Collab, extraction APIs, live capture) **without** uploading only static `dist/` files.

## Why static hosting is not enough

The app’s `/api/*` routes (canvas Collab, extract, live capture) are implemented as **Vite middleware** in [`server/viteExtractRoute.mjs`](../server/viteExtractRoute.mjs). They run in the **same Node process** as the dev server or **`vite preview`**. Serving **only** `dist/` from Cloudflare Pages (or similar) **does not** expose those APIs—visitors get HTML error pages or 502 on `POST /api/canvas/collab`.

**`vite preview`** after `npm run build` still mounts the same middleware (`configurePreviewServer`), so one process serves the built SPA **and** all APIs.

## Architecture

1. **Always-on machine** (small VPS, home server, or your laptop only while it runs) executes Node.
2. **`npm run build`** then **`npm run preview:public`** — listens on `0.0.0.0:4173`.
3. **Cloudflare Tunnel** on that host forwards your public hostname to **`http://localhost:4173`** (not `5173`).

For 24/7 sharing, the tunnel should terminate on a host that stays up; tunneling to a sleeping laptop will not work for others.

**Step-by-step on a Linux VPS** (systemd, Node, cloudflared): [deploy-vps.md](./deploy-vps.md).

**netailab.com hostname checklist:** [netailab.com.md](./netailab.com.md). After deploy: `npm run verify:deploy`.

## Server setup

1. Install **Node 20+**, clone this repo, `npm ci`.
2. Copy **`.env`** on the server (never commit secrets). At minimum for Collab:

   - `GEMINI_API_KEY` (or `GOOGLE_API_KEY`)

   Add `COMFYUI_*` and `EXTRACTION_PROVIDER` as needed; the server must be able to **reach** `COMFYUI_BASE_URL` if you use real Comfy.

3. Build and run preview:

```bash
npm run build
npm run preview:public
```

4. Verify locally on the server:

```bash
curl -sS http://127.0.0.1:4173/api/canvas/status
```

You should see JSON with `collabConfigured: true` when the Gemini key is loaded.

## Cloudflare Tunnel

1. In **Zero Trust → Networks → Tunnels**, edit your tunnel’s **Public Hostname**.
2. Set **Service** to **`http://localhost:4173`** on the machine where `preview:public` runs (use `127.0.0.1:4173` if the dashboard requires it—same effect on that host).
3. Run **`cloudflared`** on that same machine (token or `cloudflared tunnel run`), e.g. `npm run tunnel:cloudflare` with `CLOUDFLARE_TUNNEL_TOKEN` in `.env`.

Do **not** point the tunnel at `5173` unless you intentionally run **`npm run dev`** there for development.

See also the local demo flow (dev + tunnel to 5173): [cloudflare-tunnel.md](./cloudflare-tunnel.md).

## Caveats

- **Live capture** sessions are **in-memory**; server restarts clear them and are not safe across multiple Node instances.
- **API keys** live only in server env; rotate if the host is compromised.
- For heavy traffic, consider rate limits or auth (out of scope for this MVP).

## Verification checklist

- [ ] `curl https://your-domain/api/canvas/status` returns JSON (not HTML).
- [ ] Converge **Collab** works in the browser with no 502.
- [ ] Phone capture works only if phone and desktop use the **same origin** (same tunnel URL).
