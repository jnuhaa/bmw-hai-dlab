# Lightsail go-live checklist (manual steps)

Use this as an ordered runbook after code is on `main`. Prereq: AWS account, domain on Cloudflare (e.g. netailab.com), tunnel token.

**Shorter Lightsail intro:** [deploy-lightsail.md](./deploy-lightsail.md)  
**Linux + systemd + tunnel details:** [deploy-vps.md](./deploy-vps.md)  
**Domain, env, phone capture:** [netailab.com.md](./netailab.com.md)

---

## 1. Provision (AWS Lightsail)

- [ ] Create instance: **Ubuntu 22.04 or 24.04**, OS only, **~1 GB RAM** (2 GB optional).
- [ ] Attach a **static IP** to the instance.
- [ ] **Networking / firewall:** allow **SSH (22)** from your IP only. Do **not** open **4173** publicly if using Cloudflare Tunnel.
- [ ] Note the **public IP** and SSH key (`.pem`).

---

## 2. SSH

```bash
chmod 400 ~/path/to/your-key.pem
ssh -i ~/path/to/your-key.pem ubuntu@YOUR_STATIC_IP
```

- [ ] Decide **`ubuntu` only** vs **create `deploy` user** — systemd units use `User=deploy` by default ([deploy/systemd/bmw-hai-dlab-preview.service](../deploy/systemd/bmw-hai-dlab-preview.service)); either create `deploy` + `/opt/bmw-hai-dlab` per [deploy-vps.md](./deploy-vps.md) or change `User=` to `ubuntu` in copied unit files.

---

## 3. App on the server

- [ ] `sudo mkdir -p /opt/bmw-hai-dlab && sudo chown ubuntu:ubuntu /opt/bmw-hai-dlab` (or `deploy:deploy` if using deploy user).
- [ ] Clone repo: `git clone git@github.com:YOUR_ORG/YOUR_REPO.git .` (HTTPS + PAT also works).
- [ ] Copy **`.env`** from your laptop: `scp -i key.pem .env ubuntu@IP:/opt/bmw-hai-dlab/.env` then `chmod 600 .env`.
- [ ] Install Node 20 and deps — e.g. `bash scripts/bootstrap-vps.sh` or follow [deploy-vps.md](./deploy-vps.md) §2–3.
- [ ] `npm ci` and `npm run build`.
- [ ] Smoke test (temporary): `npx vite preview --host 0.0.0.0 --port 4173` then `curl -sS http://127.0.0.1:4173/api/canvas/status` — Ctrl+C when done.

---

## 4. systemd (always-on)

- [ ] Copy [deploy/systemd/bmw-hai-dlab-preview.service](../deploy/systemd/bmw-hai-dlab-preview.service) and [deploy/systemd/cloudflared.service](../deploy/systemd/cloudflared.service) to `/etc/systemd/system/`, adjusting `User` and `WorkingDirectory` if needed.
- [ ] Create `/etc/cloudflared.env` with `CLOUDFLARE_TUNNEL_TOKEN=...` (see [deploy-vps.md](./deploy-vps.md)); `chmod 600`.
- [ ] `sudo systemctl daemon-reload`
- [ ] `sudo systemctl enable --now bmw-hai-dlab-preview cloudflared`
- [ ] `sudo systemctl status bmw-hai-dlab-preview cloudflared`

---

## 5. Cloudflare Tunnel + DNS

- [ ] In Zero Trust → Tunnels → your tunnel → **Public hostname(s):** `netailab.com` and optionally `www.netailab.com` → service **HTTP** → **`http://localhost:4173`** (on **this** VM).
- [ ] **Stop** `cloudflared` / `npm run tunnel:cloudflare` on your **laptop** so only one connector uses the token.
- [ ] DNS: apex/`www` per tunnel UI or [netailab.com.md](./netailab.com.md).

---

## 6. Production env (rebuild if you change `VITE_*`)

- [ ] `GEMINI_API_KEY` (and Comfy vars if used) in `/opt/bmw-hai-dlab/.env`.
- [ ] `VITE_PUBLIC_APP_ORIGIN=https://netailab.com` and `VITE_PHONE_CAPTURE_ORIGIN=https://netailab.com` if using that domain.
- [ ] `npm run build` and `sudo systemctl restart bmw-hai-dlab-preview` after `VITE_*` changes.

---

## 7. Verify

- [ ] On VM: `curl -sS http://127.0.0.1:4173/api/canvas/status` — JSON with `collabConfigured` when key is set.
- [ ] From laptop: `PUBLIC_URL=https://netailab.com npm run verify:deploy` or `curl -sS https://netailab.com/api/canvas/status`.
- [ ] Browser: open `https://netailab.com` — no 502 on `/api/*`.
- [ ] Phone + desktop: **same HTTPS origin**; use QR/link from Curate for phone capture ([netailab.com.md](./netailab.com.md)).

---

## 8. Ongoing operations

- [ ] Updates: [scripts/deploy-vps-update.sh](../scripts/deploy-vps-update.sh) or [deploy-vps.md](./deploy-vps.md) §9.
- [ ] Optional CI: [deploy-cicd.md](./deploy-cicd.md).
- [ ] Before risky changes: **Lightsail snapshot**.
- [ ] Optional hardening: `API_SHARED_KEY`, rate limits in [.env.example](../.env.example).

---

## Acceptance

- [ ] Site loads on phone and desktop with your laptop off.
- [ ] `bmw-hai-dlab-preview` and `cloudflared` survive `sudo reboot`.
- [ ] `/api/canvas/status` returns JSON over HTTPS, not an HTML error page.
