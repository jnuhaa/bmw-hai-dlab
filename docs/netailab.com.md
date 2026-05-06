# Canonical Vercel URL

Production is decoupled from custom domains and Cloudflare for this project.

Use this single public origin:

- `https://jnuhaa-bmw-hai-dlab.vercel.app`

## Required Vercel environment variables

- `GEMINI_API_KEY` (or `GOOGLE_API_KEY`)
- `EXTRACTION_PROVIDER=comfyui` (when using real ComfyUI)
- `COMFYUI_BASE_URL` and required `COMFYUI_*` values
- `VITE_PUBLIC_APP_ORIGIN=https://jnuhaa-bmw-hai-dlab.vercel.app`
- `VITE_PHONE_CAPTURE_ORIGIN=https://jnuhaa-bmw-hai-dlab.vercel.app`

Redeploy after any env changes.

## Verification

```bash
curl -sS https://jnuhaa-bmw-hai-dlab.vercel.app/api/canvas/status
```

Then test in browser:

- Open the same origin on desktop and phone.
- Confirm phone capture link uses `/phone/<sessionId>`.
- Confirm Gemini Collab and ComfyUI Extract/Stylize complete.
