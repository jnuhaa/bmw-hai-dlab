# netailab.com with Vercel and Cloudflare

Use this when the app is deployed on Vercel and you want `https://netailab.com` as the public origin.

## How Cloudflare relates to Vercel

- Vercel hosts and serves your app.
- Cloudflare can still be your DNS provider for `netailab.com`.
- Cloudflare no longer needs a Tunnel for this deployment path.
- DNS in Cloudflare points the domain to Vercel.

In short: **Cloudflare = DNS/proxy edge**, **Vercel = app hosting/runtime**.

## 1. Attach domain in Vercel

1. Open your Vercel project.
2. Go to **Settings -> Domains**.
3. Add `netailab.com` (and `www.netailab.com` if needed).
4. Copy the DNS records Vercel asks for.

## 2. Configure DNS in Cloudflare

1. In Cloudflare DNS, create/update the records exactly as Vercel instructs.
2. Typical setup:
   - apex `netailab.com` as `A`/`ALIAS` depending on guidance
   - `www` as `CNAME` to Vercel target
3. Wait for DNS propagation and verify domain status in Vercel.

If Cloudflare proxying causes validation or routing issues, temporarily switch the record to DNS-only until Vercel marks the domain as valid, then re-enable proxy if desired.

## 3. Production environment variables (Vercel)

Set these in Vercel Project Settings -> Environment Variables:

- `GEMINI_API_KEY` (or `GOOGLE_API_KEY`)
- `EXTRACTION_PROVIDER=comfyui` (if using real extraction)
- `COMFYUI_BASE_URL` and related `COMFYUI_*` values as needed
- `VITE_PUBLIC_APP_ORIGIN=https://netailab.com`
- `VITE_PHONE_CAPTURE_ORIGIN=https://netailab.com`

Redeploy after env changes.

## 4. Verify

```bash
curl -sS https://netailab.com/api/canvas/status
```

Then test in browser:

- Open `https://netailab.com` on desktop and phone.
- Confirm phone capture uses the same origin and session link (`/phone/<sessionId>`).
- Confirm Collab/Extract calls succeed.

## 5. Notes

- No Cloudflare Tunnel process should run for the Vercel deployment path.
- Keep only one public production origin for phone pairing reliability.
