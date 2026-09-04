#!/usr/bin/env bash
# Build and (re)start Zenith Ticketing on a plain Linux server (no Cloudflare Workers).
# Run this ON THE SERVER, from /opt/zenith-ticketing (a checkout of this repo).
set -euo pipefail

APP_DIR="/opt/zenith-ticketing"
cd "$APP_DIR"

echo "==> Pulling latest code"
git fetch origin
git checkout claude/zenith-ticketing-deploy-bz2o23
git pull origin claude/zenith-ticketing-deploy-bz2o23

echo "==> Installing dependencies"
if command -v bun >/dev/null 2>&1; then
  bun install --frozen-lockfile
else
  npm ci
fi

echo "==> Building (Node server target)"
if command -v bun >/dev/null 2>&1; then
  NITRO_PRESET=node-server bun run build
else
  NITRO_PRESET=node-server npm run build
fi

echo "==> Restarting service"
sudo systemctl restart zenith-ticketing
sudo systemctl status zenith-ticketing --no-pager -l | head -15

echo "==> Done. Serving on port \${PORT:-3000}"
