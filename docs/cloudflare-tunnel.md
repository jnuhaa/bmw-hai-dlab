# Named Cloudflare Tunnel Setup

This is the stable public demo path for the local Curate / Diverge prototype.

For a **shareable URL after `npm run build`** (tunnel → `vite preview` on port **4173**, not static hosting alone), see [deploy-public-tunnel.md](./deploy-public-tunnel.md).

## What You Need

- A domain managed in Cloudflare DNS
- A subdomain you can dedicate to the demo, for example `curate.yourdomain.com`
- `cloudflared` installed on the Mac that runs this app

Official docs:

- Cloudflare Tunnel overview: https://developers.cloudflare.com/tunnel/
- Create a tunnel: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/
- Public hostnames / routing: https://developers.cloudflare.com/tunnel/routing/
- Install `cloudflared`: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

## Recommended Setup

Use a remotely managed named tunnel in the Cloudflare dashboard.

Why this path:

- stable hostname
- no expiring Quick Tunnel URLs
- clean token-based local startup
- easy to reuse for demos

## One-Time Cloudflare Setup

1. Add your domain to Cloudflare if it is not already there.
2. In the Cloudflare dashboard, go to `Zero Trust` -> `Networks` -> `Tunnels`.
3. Create a new `Cloudflared` tunnel.
4. Name it something like `bmw-curate-demo`.
5. In the tunnel setup, add a public hostname:
   - Subdomain: `curate`
   - Domain: `yourdomain.com`
   - Service type: `HTTP`
   - URL: `http://localhost:5173`
6. Copy the generated tunnel token.

## Local Project Setup

1. Copy the env file if you have not already:

```bash
cp .env.example .env
```

2. Add the tunnel token to `.env`:

```bash
CLOUDFLARE_TUNNEL_TOKEN=your-token-here
CLOUDFLARE_PUBLIC_HOSTNAME=curate.yourdomain.com
```

3. Start the local app:

```bash
npm run dev
```

4. In a second terminal, start the named tunnel:

```bash
npm run tunnel:cloudflare
```

5. Open your stable public URL:

```text
https://curate.yourdomain.com
```

## Testing Flow

1. Open the public URL on your Mac.
2. Confirm the Curate screen loads.
3. Open the same public URL on your phone.
4. Enable camera access.
5. Capture images and confirm they appear in the desktop experience.

## Environment variables

When you use the tunnel, browse your **HTTPS tunnel URL** (for example `https://curate.yourdomain.com`), not `http://localhost:5173`. The SPA localhost→public redirect in `App.tsx` only runs on `localhost` / `127.0.0.1`, so it does not affect tunnel URLs. You may set optional `VITE_PUBLIC_APP_ORIGIN` to that same origin for consistency; leave **`VITE_REDIRECT_LOCAL_TO_PUBLIC` unset** for normal tunnel demos so nothing unexpected happens if you also open a localhost tab later.

## Notes

- This project already allows non-local hosts in Vite, so the Cloudflare hostname can reach the dev server.
- Keep `npm run dev` and `npm run tunnel:cloudflare` running during the demo.
- If you change the hostname, update it in the Cloudflare dashboard. The local script only needs the token.
- If the tunnel connects but the page does not load, make sure your tunnel’s public hostname still points to `http://localhost:5173` for **dev**, or `http://localhost:4173` when using **`npm run preview:public`** (see [deploy-public-tunnel.md](./deploy-public-tunnel.md)).

### Why 4173 fails but 5173 works

- **`npm run dev`** starts Vite on **port 5173 only**. Nothing listens on **4173** unless you run preview.
- If Cloudflare is set to **`http://localhost:4173`** but you only have **`npm run dev`** running, there is no process on 4173 → connection errors or **502**.
- **Choose one:**
  - **Development:** tunnel → **`http://localhost:5173`** and use **`npm run dev`**.
  - **Production-style preview:** run **`npm run build`**, then **`npm run preview:public`**, then tunnel → **`http://localhost:4173`**.
