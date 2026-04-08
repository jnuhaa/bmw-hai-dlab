# netailab.com — public access (Gemini, ComfyUI, phone capture)

This repo serves the SPA **and** `/api/*` from one Node process (`vite preview` on port **4173**). Use this checklist so **https://netailab.com** (or **https://www.netailab.com**) reaches that process via **Cloudflare Tunnel**.

## Architecture (summary)

- **DNS** → Cloudflare → **cloudflared** on your VPS → **http://127.0.0.1:4173** (same host as `npm run preview:public`).
- **Gemini** and **ComfyUI** are called **from the server**; set `GEMINI_API_KEY` and `COMFYUI_*` in `.env` on the VPS.
- **Phone capture** requires the phone and desktop to open the **same HTTPS origin** (e.g. both `https://netailab.com`).

See also: [deploy-public-tunnel.md](./deploy-public-tunnel.md), [deploy-vps.md](./deploy-vps.md).
Systemd unit templates: [deploy/systemd/](../deploy/systemd/).

## 1. DNS and tunnel (Cloudflare)

1. Add **netailab.com** to Cloudflare (nameservers at Cloudflare).
2. **Zero Trust → Networks → Tunnels** → create or select a **Cloudflared** tunnel.
3. **Public hostname**:
   - **Subdomain:** `@` (apex) or `www` (add a second hostname if you want both).
   - **Domain:** `netailab.com`.
   - **Service type:** HTTP.
   - **URL:** `http://localhost:4173` (on the machine where preview runs—this is the VPS after you deploy).
4. Copy the tunnel **token** (one connector per tunnel—do not run the same token on two machines).

### Apex + www (optional)

- Add two public hostnames: `netailab.com` and `www.netailab.com`, both → `http://localhost:4173`.
- In **DNS**, add CNAME records as instructed by the tunnel UI, or use the automatic records Cloudflare creates.

## 2. VPS: Node + preview + cloudflared

Follow [deploy-vps.md](./deploy-vps.md) with working directory e.g. `/opt/bmw-hai-dlab`.

- Copy [deploy/systemd/bmw-hai-dlab-preview.service](../deploy/systemd/bmw-hai-dlab-preview.service) to `/etc/systemd/system/bmw-hai-dlab-preview.service` (adjust `User` / `WorkingDirectory`).
- Copy [deploy/systemd/cloudflared.service](../deploy/systemd/cloudflared.service) and put the token in `/etc/cloudflared.env` as documented in deploy-vps.
- **Only one** `cloudflared` process should use the tunnel token (stop any local tunnel on your laptop before moving the VPS online).

## 3. Environment on the VPS (`chmod 600 .env`)

| Variable | Purpose |
|----------|---------|
| `GEMINI_API_KEY` or `GOOGLE_API_KEY` | Converge Collab (server-side) |
| `EXTRACTION_PROVIDER=comfyui` | Real extraction / stylize |
| `COMFYUI_BASE_URL` | Must be reachable **from the VPS** (not your laptop). Use `https://cloud.comfy.org` + API key, or Comfy on the same VPS (`http://127.0.0.1:8188`): see [.env.example](../.env.example) |
| `VITE_PUBLIC_APP_ORIGIN=https://netailab.com` | Set this in production for explicit origin consistency. |
| `VITE_PHONE_CAPTURE_ORIGIN=https://netailab.com` | Recommended in production to keep QR/copy-link origin deterministic. |

Rebuild after changing `VITE_*` vars: `npm run build` then restart `bmw-hai-dlab-preview`.

Recommended `.env` core for production:

```bash
EXTRACTION_PROVIDER=comfyui
VITE_PUBLIC_APP_ORIGIN=https://netailab.com
VITE_PHONE_CAPTURE_ORIGIN=https://netailab.com
```

## 4. Verification

On the **VPS**:

```bash
curl -sS http://127.0.0.1:4173/api/canvas/status
```

Expect JSON with `"collabConfigured": true` when Gemini is configured.

From **your laptop** (internet):

```bash
curl -sS https://netailab.com/api/canvas/status
```

Or run the repo helper (optional `PUBLIC_URL` default `https://netailab.com`):

```bash
npm run verify:deploy
```

- **Browser:** open `https://netailab.com`, Converge **Collab** should work (no 502 HTML from `/api/*`).

## 5. Phone capture (same origin + HTTPS + session link)

1. **HTTPS** is required for camera on mobile; the tunnel provides it.
2. **Same origin:** open **https://netailab.com** on both phone and desktop (not `http://localhost` on one device and the tunnel on the other).
3. On **Curate**, after the live-capture session starts, the **Phone capture** card shows a **QR code** and **Copy link** URL of the form `https://netailab.com/phone/<sessionId>`. Scan or open that URL on your phone so uploads bind to **this** desktop session (not a global “latest” session).
4. On the phone, drag to select a region; the image posts to `/api/live-capture` and the desktop poll ingests it into the sphere.
5. Opening **`/phone` without a session id** still works for demos but uses the **latest** session only—prefer the QR/link from Curate for reliable pairing.

**Local dev on your Mac:** If you use **`http://localhost:5173`** in the desktop browser, the QR encodes **localhost** and the phone cannot reach your machine. Set **`VITE_PHONE_CAPTURE_ORIGIN=http://<your-LAN-IP>:5173`** in `.env` and restart Vite, or open the app using your computer’s LAN IP in the address bar so the QR matches a host the phone can reach.

Sessions are **in-memory**; restarting the Node process clears them.

## 6. Troubleshooting

| Symptom | Check |
|--------|--------|
| 502 on public URL | `bmw-hai-dlab-preview` running? `curl` localhost:4173 on VPS. |
| Collab not configured | `GEMINI_API_KEY` in `.env` on VPS; rebuild/restart if needed. |
| Comfy errors | From VPS: `COMFYUI_BASE_URL` reachable; Comfy Cloud key set if using cloud. |
| Phone not syncing | Same origin on both devices; use the **QR or copied URL** from Curate (`/phone/<sessionId>`), not a mismatched tab. |
| 401 on API calls | If `API_SHARED_KEY` is set, include `x-api-key` (or bearer token) for non-status endpoints. |
| 429 rate limit | Increase `API_RATE_LIMIT_PER_MINUTE` or reduce burst traffic from one IP/path. |
