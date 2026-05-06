# Deploy to Vercel

This repo can be deployed to Vercel as a Node-backed Vite app (not static-only).

## 1. Prerequisites

- A Vercel account connected to this GitHub repository.
- Required secrets configured in Vercel project environment variables (for example `GEMINI_API_KEY`, and `COMFYUI_*` when using real extraction).

## 2. Build settings

Use Vercel defaults for a Vite + TypeScript project:

- Install command: `npm install`
- Build command: `npm run build`
- Output directory: `dist`

This project builds with:

```bash
tsc -b && vite build
```

## 3. Required dependency for Three.js typings

Vercel runs TypeScript checks during build. If `three` types are missing, build fails with `TS7016`.

Make sure `@types/three` is present in `devDependencies`:

```json
"devDependencies": {
  "@types/three": "^0.184.0"
}
```

## 4. Deploy

1. Push to `main`.
2. In Vercel, import/select the repository.
3. Set environment variables for Production.
4. Trigger deploy (or wait for auto-deploy from `main`).

## 5. Verify

- Open the deployed URL and confirm app load.
- Check health endpoint:

```bash
curl -sS https://<your-vercel-domain>/api/canvas/status
```

- Confirm Collab/Extract flows with your configured provider.

## 6. Custom domain

Attach your domain (for example `netailab.com`) in Vercel Project Settings -> Domains.

When Cloudflare is your DNS provider, point DNS records to Vercel according to Vercel's domain instructions.
