#!/usr/bin/env bash

set -euo pipefail

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared is not installed."
  echo "Install it first, then run this script again."
  echo "Docs: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
  exit 1
fi

if [ -f ".env" ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

if [ -z "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]; then
  echo "CLOUDFLARE_TUNNEL_TOKEN is not set."
  echo "Create a named Cloudflare Tunnel in the dashboard and copy its token into .env."
  echo "Setup guide: ./docs/cloudflare-tunnel.md"
  exit 1
fi

# Public hostname → service URL is configured in Cloudflare (e.g. http://localhost:5174 for dev, http://localhost:4173 for preview:public).
echo "Starting named Cloudflare Tunnel (token from .env). Ensure the dashboard hostname points to the port you serve (5174 dev, 4173 preview:public)."
cloudflared tunnel --no-autoupdate run --token "${CLOUDFLARE_TUNNEL_TOKEN}"
