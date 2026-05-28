#!/usr/bin/env bash
# render-build.sh — Render.com build script
# No external binaries needed — @distube/ytdl-core handles streaming natively.

set -e

echo "==> Installing npm dependencies..."
npm install --production

echo "==> Build complete!"
