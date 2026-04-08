#!/usr/bin/env bash
# Deploy latest code on VPS and verify health.
# Usage:
#   APP_DIR=/opt/playground bash scripts/deploy-vps-update.sh

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/playground}"
APP_SERVICE="${APP_SERVICE:-playground-preview}"
PUBLIC_URL="${PUBLIC_URL:-https://netailab.com}"

echo "[1/6] Pulling latest code..."
cd "${APP_DIR}"
git pull --ff-only

echo "[2/6] Installing dependencies..."
npm ci

echo "[3/6] Building..."
npm run build

echo "[4/6] Restarting ${APP_SERVICE}..."
sudo systemctl restart "${APP_SERVICE}"

echo "[5/6] Verifying local API..."
curl -sS -f http://127.0.0.1:4173/api/canvas/status >/dev/null

echo "[6/6] Verifying public URL..."
PUBLIC_URL="${PUBLIC_URL}" bash scripts/verify-public-deploy.sh

echo "Deploy successful."
