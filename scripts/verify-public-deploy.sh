#!/usr/bin/env bash
# Verify public deployment: API returns JSON over HTTPS (not HTML error page).
# Usage: PUBLIC_URL=https://netailab.com bash scripts/verify-public-deploy.sh

set -euo pipefail

PUBLIC_URL="${PUBLIC_URL:-https://netailab.com}"
STATUS_PATH="/api/canvas/status"

echo "Checking ${PUBLIC_URL}${STATUS_PATH} ..."
body="$(curl -sS -f "${PUBLIC_URL}${STATUS_PATH}")" || {
  echo "FAIL: curl failed or non-2xx for ${PUBLIC_URL}${STATUS_PATH}"
  exit 1
}

if echo "${body}" | grep -q '"collabConfigured"'; then
  echo "OK: JSON response (collabConfigured present)."
  echo "${body}" | head -c 400
  echo
  exit 0
fi

if echo "${body}" | grep -qi '<!doctype html\|<html'; then
  echo "FAIL: Got HTML instead of JSON. Is the tunnel pointing to vite preview :4173?"
  exit 1
fi

echo "WARN: Unexpected body (first 200 chars):"
echo "${body}" | head -c 200
echo
exit 1
