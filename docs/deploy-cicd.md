# CI/CD deploy to VPS (GitHub Actions)

This repo includes [.github/workflows/deploy-vps.yml](../.github/workflows/deploy-vps.yml), which runs on push to `main` (and manually), SSHs into your VPS, and executes `scripts/deploy-vps-update.sh`.

## Required repository secrets

- `VPS_HOST` — VPS public IP or hostname
- `VPS_USER` — SSH user (for example `deploy`)
- `VPS_SSH_KEY` — private key content used by GitHub Actions
- `VPS_PORT` — optional; defaults to `22`
- `VPS_APP_DIR` — optional; defaults to `/opt/playground`
- `PUBLIC_URL` — optional; defaults to `https://netailab.com`

## First-time setup checklist

1. Make sure the VPS already has this repo checked out and can run:
   - `npm ci`
   - `npm run build`
   - `sudo systemctl restart playground-preview`
2. Ensure your SSH user can restart the service (typically passwordless sudo for that user).
3. Add the secrets listed above in GitHub repository settings.
4. Trigger the workflow manually once from **Actions**.

## Rollback (manual)

On the VPS:

```bash
cd /opt/playground
git log --oneline -n 5
git checkout <last-known-good-commit>
npm ci
npm run build
sudo systemctl restart playground-preview
PUBLIC_URL=https://netailab.com bash scripts/verify-public-deploy.sh
```
