# Hetzner VPS quickstart (cheap + Cloudflare Tunnel)

This is the **cheapest straightforward** path for this repo: a small **Hetzner Cloud** server running Ubuntu, **Node + `vite preview`** on port **4173**, and **Cloudflare Tunnel** so HTTPS and DNS work without opening HTTP ports on the VPS.

Full generic runbook (systemd, tunnel, firewall): [deploy-vps.md](./deploy-vps.md). Domain checklist: [netailab.com.md](./netailab.com.md).

## 1. Create the server (Hetzner Cloud Console)

1. Sign up at [Hetzner Cloud](https://www.hetzner.com/cloud/) and add a payment method.
2. **Projects → Add Server**.
3. **Location:** choose an EU datacenter close to you (e.g. Nuremberg, Falkenstein).
4. **Image:** **Ubuntu 24.04** (or 22.04).
5. **Type:** **Shared vCPU** — **CX22** (2 vCPU / 4 GB) is comfortable for Node + tunnel; **CX11** (1 vCPU / 2 GB) can work for a light demo but may feel tight under load. Pick what fits your budget.
6. **Networking:** default IPv4 is enough.
7. **SSH key:** add your public key (`~/.ssh/id_ed25519.pub`) so you can log in as `root` without a password.
8. Create the server and note its **public IPv4**.

**Firewall (optional but good):** In Hetzner, allow **SSH (22)** from your IP only, or from anywhere if your IP changes often. You do **not** need to open 80/443 on the VPS when using Cloudflare Tunnel.

## 2. First login

```bash
ssh root@YOUR_SERVER_IP
```

Update packages (as in [deploy-vps.md](./deploy-vps.md)):

```bash
apt update && apt upgrade -y
apt install -y git curl ca-certificates build-essential
```

## 3. Bootstrap deploy user, Node 20, and app directory

From the repo (or paste the script from the repo), you can run:

```bash
# If you cloned the repo already:
bash scripts/bootstrap-vps.sh
```

Or follow sections **1–3** of [deploy-vps.md](./deploy-vps.md) manually.

Recommended layout:

- App lives at **`/opt/bmw-hai-dlab`**
- Non-root user **`deploy`** owns the directory and can `sudo` for systemd installs

Clone with the **HTTPS or SSH URL** of your GitHub repo:

```bash
sudo mkdir -p /opt/bmw-hai-dlab
sudo chown deploy:deploy /opt/bmw-hai-dlab
sudo -u deploy -H bash -lc 'cd /opt/bmw-hai-dlab && git clone https://github.com/jnuhaa/bmw-hai-dlab.git .'
```

## 4. Environment, build, smoke test

```bash
sudo -u deploy -H bash -lc 'cd /opt/bmw-hai-dlab && npm ci && npm run build'
```

Copy **`.env`** from your laptop (never commit it):

```bash
# From your Mac:
scp .env deploy@YOUR_SERVER_IP:/opt/bmw-hai-dlab/.env
ssh deploy@YOUR_SERVER_IP 'chmod 600 /opt/bmw-hai-dlab/.env'
```

Set production-oriented values as needed (see [.env.example](../.env.example) and [netailab.com.md](./netailab.com.md)), then:

```bash
sudo -u deploy -H bash -lc 'cd /opt/bmw-hai-dlab && npm run build'
```

## 5. cloudflared + systemd

Follow **sections 5–7** of [deploy-vps.md](./deploy-vps.md):

- Install `cloudflared` binary (use **`cloudflared-linux-amd64`** for standard Hetzner x86 servers).
- Put the tunnel token in **`/etc/cloudflared.env`** (root-only, `chmod 600`).
- Install **`bmw-hai-dlab-preview.service`** and **`cloudflared.service`** from [deploy/systemd/](../deploy/systemd/).
- **Stop** any tunnel on your Mac that uses the **same** token before enabling the VPS tunnel.

## 6. Cloudflare DNS and hostname

In **Zero Trust → Tunnels → Public hostname**:

- Point **netailab.com** (and **www** if you want) to **`http://localhost:4173`** on the connector that runs on this VPS.

## 7. Verify

On the VPS:

```bash
curl -sS http://127.0.0.1:4173/api/canvas/status
```

From the internet:

```bash
curl -sS https://netailab.com/api/canvas/status
```

Or from the repo: `npm run verify:deploy` with `PUBLIC_URL=https://netailab.com`.

## 8. Later updates

Use [deploy-vps.md](./deploy-vps.md) “Deploy updates” or:

```bash
APP_DIR=/opt/bmw-hai-dlab PUBLIC_URL=https://netailab.com bash scripts/deploy-vps-update.sh
```

(Optional CI: [deploy-cicd.md](./deploy-cicd.md).)

## Cost note

Hetzner prices change; check the **Cloud** pricing page for current **CX11/CX22** monthly rates in your currency. This is typically in the **roughly \$4–10/month** range for small shared instances, plus domain costs elsewhere.
