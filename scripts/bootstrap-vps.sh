#!/usr/bin/env bash
# Bootstrap a fresh Ubuntu VPS for this project.
# Run as a sudo-capable user on the VPS.

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/playground}"
APP_USER="${APP_USER:-deploy}"

echo "[1/6] Installing base packages..."
sudo apt update
sudo apt install -y git curl ca-certificates build-essential

if ! id -u "${APP_USER}" >/dev/null 2>&1; then
  echo "[2/6] Creating user ${APP_USER}..."
  sudo adduser --disabled-password --gecos "" "${APP_USER}"
  sudo usermod -aG sudo "${APP_USER}"
else
  echo "[2/6] User ${APP_USER} already exists."
fi

echo "[3/6] Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v

echo "[4/6] Preparing app directory ${APP_DIR}..."
sudo mkdir -p "${APP_DIR}"
sudo chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"

echo "[5/6] Firewall baseline..."
if command -v ufw >/dev/null 2>&1; then
  sudo ufw allow OpenSSH >/dev/null 2>&1 || true
fi

echo "[6/6] Bootstrap complete."
echo "Next:"
echo "  1) Clone repo into ${APP_DIR}"
echo "  2) Create .env (chmod 600 .env)"
echo "  3) npm ci && npm run build"
echo "  4) Install systemd units from deploy/systemd/"
