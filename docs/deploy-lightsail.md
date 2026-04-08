# AWS Lightsail + Ubuntu (Cloudflare Tunnel + `preview:public`)

This is the same architecture as [deploy-vps.md](./deploy-vps.md): a **small Linux VM** runs **Node** (`vite preview` on **4173**) and **cloudflared** forwards **HTTPS** from Cloudflare to `http://localhost:4173` on that VM. Lightsail is just **where** you rent the VM.

**After the instance exists**, follow [deploy-vps.md](./deploy-vps.md) from “Server baseline” onward (Node, clone repo, `.env`, build, systemd, tunnel).

**Domain + DNS:** [netailab.com.md](./netailab.com.md).

**Ordered go-live checklist (checkboxes):** [lightsail-go-live-checklist.md](./lightsail-go-live-checklist.md).

---

## 1. Create a Lightsail instance

1. AWS Console → **Lightsail** → **Create instance**.
2. **Region:** pick one close to your users (latency).
3. **Platform:** Linux/Unix.
4. **Blueprint:** **OS only** → **Ubuntu 22.04 LTS** or **24.04 LTS** (recommended).
5. **Instance plan:** **1 GB RAM / 1 vCPU** is enough for this demo stack; 2 GB is comfortable if budget allows.
6. **Identify your instance:** name it e.g. `playground-netailab`.
7. **SSH key:** create or select a key pair; download the private key if new (`.pem`). You need it to SSH as `ubuntu` (default user on Ubuntu blueprints).

Create the instance and wait until it is **Running**.

---

## 2. Static IP (recommended)

Lightsail instances get a new public IP if you destroy/recreate them. For a stable demo:

1. Lightsail → **Networking** tab → **Create static IP**.
2. Attach it to this instance.

Point your **Cloudflare DNS** (or mental notes) at this IP only if you use **direct** HTTPS to the VM. With **Cloudflare Tunnel**, users hit Cloudflare’s edge; the tunnel connects **out** from the VM, but a **stable** instance IP still helps SSH and avoids surprises if you snapshot/move.

---

## 3. Firewall (Lightsail networking)

Default: **SSH (22)** only from **your IP** is ideal for security.

- You **do not** need to open **4173** to the public internet when using **Cloudflare Tunnel** (traffic goes tunnel → localhost:4173).
- If you ever expose 4173 directly (not recommended for this setup), you would add a custom rule; for tunnel-only, skip it.

---

## 4. SSH in

From your Mac (replace path and host):

```bash
chmod 400 ~/path/to/your-key.pem
ssh -i ~/path/to/your-key.pem ubuntu@YOUR_STATIC_IP
```

If you use the browser-based SSH in Lightsail, that works too; for `scp` of `.env`, the CLI + key is easier.

---

## 5. Optional: `deploy` user

[deploy-vps.md](./deploy-vps.md) assumes a **`deploy`** user. On Lightsail you start as **`ubuntu`**. Either:

- Run the bootstrap as `ubuntu` and use `/opt/playground` owned by `ubuntu`, **or**
- Create `deploy` as in deploy-vps and copy your workflow there.

The systemd units in [deploy/systemd/](../deploy/systemd/) use `User=deploy` — change `User=` to `ubuntu` if you skip creating `deploy`.

---

## 6. App + tunnel (same as generic VPS)

1. Copy [deploy-vps.md](./deploy-vps.md) from **Server baseline** through **systemd** for `playground-preview` and `cloudflared`.
2. Put `CLOUDFLARE_TUNNEL_TOKEN` in `/etc/cloudflared.env` on the instance (see deploy-vps).
3. In Cloudflare Zero Trust, tunnel **Public hostname** → **`http://localhost:4173`** (on **this** Lightsail VM).
4. **Stop** any tunnel using the same token on your laptop so only one connector runs.

Verify:

```bash
curl -sS http://127.0.0.1:4173/api/canvas/status
```

From your laptop:

```bash
PUBLIC_URL=https://netailab.com npm run verify:deploy
```

---

## 7. Updates and rollback

- **Deploy updates:** `npm run deploy:vps` on the server (see [deploy-vps.md](./deploy-vps.md)) or your CI ([deploy-cicd.md](./deploy-cicd.md)).
- **Lightsail snapshot:** before risky changes, create an instance **snapshot** in Lightsail for quick rollback.

---

## Related docs

- [deploy-vps.md](./deploy-vps.md) — full install path (Node, build, systemd, tunnel).
- [netailab.com.md](./netailab.com.md) — DNS, env, phone capture, verification.
- [deploy-cicd.md](./deploy-cicd.md) — optional GitHub Actions deploy.
