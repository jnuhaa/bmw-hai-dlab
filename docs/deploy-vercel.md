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

## 5. Verify deployment health

- Open the deployed URL and confirm app load.
- Check health endpoint:

```bash
curl -sS https://<your-vercel-domain>/api/canvas/status
```

- Confirm `/api/canvas/status` returns JSON (not HTML error page).

## 6. Step-by-step feature verification

Use this after each production deploy to ensure picture import, ComfyUI workflow, and Gemini are still healthy.

1. **Picture import path**
   - Open Curate.
   - Capture/upload one image.
   - Crop a region and confirm both parent and cropped assets appear on board.
   - Run:

   ```bash
   curl -sS https://<your-vercel-domain>/api/canvas/status
   ```

   - Confirm endpoint responds and no API/network errors appear in browser console.

2. **Gemini (Converge Collab)**
   - Ensure `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) is set in Vercel env.
   - Open Converge and trigger a Collab action.
   - Expected: structured response (not fallback error), no 401/403 from API.
   - Optional smoke check:

   ```bash
   curl -sS https://<your-vercel-domain>/api/canvas/status
   ```

   Verify `collabConfigured` is `true`.

3. **ComfyUI extraction/stylize flow**
   - Ensure these env vars are set in Vercel:
     - `EXTRACTION_PROVIDER=comfyui`
     - `COMFYUI_BASE_URL=...`
     - any required `COMFYUI_API_KEY` / workflow vars
   - Trigger Extract (Curate) or Stylize (Converge).
   - Expected: generated images returned; no provider connectivity errors.
   - If failures appear, first verify Vercel can reach `COMFYUI_BASE_URL` from server-side runtime.

4. **Phone import/session pairing**
   - Open app on desktop and phone using the same origin.
   - Use QR or copied `/phone/<sessionId>` link from Curate.
   - Confirm phone capture appears on desktop session.

## 7. Custom domain (optional)

Attach your domain (for example `example.com`) in Vercel Project Settings -> Domains.

When Cloudflare is your DNS provider, point DNS records to Vercel according to Vercel's domain instructions.
