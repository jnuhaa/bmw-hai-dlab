# Run on a small VPS (Cloudflare Tunnel + `preview:public`)

Use this when you want **netailab.com** (or another hostname) to stay up **without your laptop**, using the same architecture you already validated: **Node** serves the built app + `/api/*` on **port 4173**, and **cloudflared** on the **same** VPS forwards the tunnel to `http://localhost:4173`.

**Domain-specific checklist (netailab.com):** [netailab.com.md](./netailab.com.md). Copy-paste systemd units: [deploy/systemd/playground-preview.service](../deploy/systemd/playground-preview.service), [deploy/systemd/cloudflared.service](../deploy/systemd/cloudflared.service).

## What you need

- A VPS (e.g. **1 vCPU / 1 GB RAM** is enough for this demo stack) with **Ubuntu 22.04 or 24.04** (or similar).
- SSH access as a sudo user.
- Your **Cloudflare Tunnel** token (same as `CLOUDFLARE_TUNNEL_TOKEN` in `.env`).
- A copy of this repo and your **`.env`** (secrets never committed).

## 1. Server baseline

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl ca-certificates build-essential
```

Or run the repo bootstrap helper:

```bash
bash scripts/bootstrap-vps.sh
```

Create a deploy user (optional but recommended):

```bash
sudo adduser deploy
sudo usermod -aG sudo deploy
# log in as deploy from here on
```

## 2. Install Node.js 20 LTS

Using NodeSource (adjust if you prefer `nvm`):

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # should be v20.x
```

## 3. Clone the app and install dependencies

```bash
sudo mkdir -p /opt/playground
sudo chown deploy:deploy /opt/playground
cd /opt/playground
git clone <YOUR_REPO_URL> .
npm ci
```

Copy **`.env`** from your machine (scp or paste). Restrict permissions:

```bash
chmod 600 .env
```

Ensure it includes at least `GEMINI_API_KEY`, and any `COMFYUI_*` / `EXTRACTION_PROVIDER` values the VPS can reach (Comfy must be **reachable from the VPS**, e.g. Comfy Cloud or a public Comfy URL).

## 4. Build and smoke-test

```bash
npm run build
npm run preview:public
```

In another SSH session:

```bash
curl -sS http://127.0.0.1:4173/api/canvas/status
```

You should see JSON with `"collabConfigured": true` when the key is loaded. Stop the preview process with **Ctrl+C** when done.

## 5. Install cloudflared on the VPS

```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
chmod +x cloudflared
sudo mv cloudflared /usr/local/bin/cloudflared
cloudflared --version
```

On **ARM** (e.g. some Ampere VPS), download `cloudflared-linux-arm64` instead.

## 6. Move the tunnel from your Mac to the VPS

Only **one** connector should run the same named tunnel (avoid two machines with the same token fighting each other):

1. **Stop** `npm run tunnel:cloudflare` on your Mac.
2. In **Cloudflare Zero Trust → Tunnels → your tunnel → Public hostname**, keep **Service** = **`http://localhost:4173`** (ingress is pushed to `cloudflared`; this is correct for whatever host runs preview on **that** machine).

On the VPS, `localhost:4173` means “the Vite preview bound on this VPS,” not your Mac.

## 7. systemd: keep preview and tunnel running

### `/etc/systemd/system/playground-preview.service`

Adjust `User` and `WorkingDirectory` if you did not use `/opt/playground`.

The same unit file is kept in the repo as [deploy/systemd/playground-preview.service](../deploy/systemd/playground-preview.service) for easy `scp` or copy-paste.

```ini
[Unit]
Description=Playground Vite preview (API + static)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=deploy
WorkingDirectory=/opt/playground
Environment=NODE_ENV=production
# Vite loads .env from WorkingDirectory via vite.config.ts
ExecStart=/opt/playground/node_modules/.bin/vite preview --host 0.0.0.0 --port 4173
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Reload and enable:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now playground-preview
sudo systemctl status playground-preview
```

### `/etc/systemd/system/cloudflared.service`

Put the token in a root-only file (not world-readable):

```bash
sudo sh -c 'echo "CLOUDFLARE_TUNNEL_TOKEN=YOUR_TOKEN_HERE" > /etc/cloudflared.env'
sudo chmod 600 /etc/cloudflared.env
```

The same unit file is kept in the repo as [deploy/systemd/cloudflared.service](../deploy/systemd/cloudflared.service).

```ini
[Unit]
Description=Cloudflare Tunnel
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=/etc/cloudflared.env
# Token is expanded from the environment (JWT may contain "="; keep the file as KEY=value on one line).
ExecStart=/bin/bash -c 'exec /usr/local/bin/cloudflared tunnel --no-autoupdate run --token "$CLOUDFLARE_TUNNEL_TOKEN"'
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared
```

Ensure **playground-preview** starts **before** you rely on the tunnel (tunnel will get 502 if nothing listens on 4173). You can add `After=playground-preview.service` to `cloudflared.service` if you want ordering.

## 8. Firewall

If **ufw** is enabled, you typically only need **SSH**; HTTPS is handled by Cloudflare to the tunnel. You do **not** need to open 4173 publicly:

```bash
sudo ufw allow OpenSSH
sudo ufw enable
```

## 9. Deploy updates

```bash
cd /opt/playground
git pull
npm ci
npm run build
sudo systemctl restart playground-preview
```

Or use the repo deploy helper:

```bash
APP_DIR=/opt/playground PUBLIC_URL=https://netailab.com bash scripts/deploy-vps-update.sh
```

## 10. Verification

- On the VPS: `curl -sS http://127.0.0.1:4173/api/canvas/status`
- From your laptop: `curl -sS https://netailab.com/api/canvas/status`
- Browser: Converge **Collab** should work with no HTML 502.

## Related docs

- [deploy-lightsail.md](./deploy-lightsail.md) — AWS Lightsail VM, then same steps as this doc.
- [deploy-public-tunnel.md](./deploy-public-tunnel.md) — overview (why not static-only).
- [cloudflare-tunnel.md](./cloudflare-tunnel.md) — local dev + tunnel to port 5173.
- [deploy-cicd.md](./deploy-cicd.md) — optional GitHub Actions auto-deploy to VPS.
