#!/usr/bin/env bash
# render-build.sh — Render.com build script
set -e

echo "==> Creating local bin directory..."
mkdir -p bin

echo "==> Downloading standalone Linux yt-dlp binary..."
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o bin/yt-dlp
chmod +x bin/yt-dlp

echo "==> Downloading ffmpeg static binaries..."
curl -L https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz -o ffmpeg.tar.xz
tar -xf ffmpeg.tar.xz
mv ffmpeg-*-amd64-static/ffmpeg bin/
mv ffmpeg-*-amd64-static/ffprobe bin/
chmod +x bin/ffmpeg bin/ffprobe
rm -rf ffmpeg.tar.xz ffmpeg-*-amd64-static

echo "==> Installing npm dependencies..."
npm install --production

echo "==> Build complete!"
