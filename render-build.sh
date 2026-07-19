#!/usr/bin/env bash
# render-build.sh — Render.com build script
set -e

echo "==> Creating local bin directory..."
mkdir -p bin

echo "==> Setting up python virtual environment..."
python3 -m venv .venv
.venv/bin/pip install -U pip
.venv/bin/pip install -U --pre "yt-dlp[default,curl-cffi]"
.venv/bin/pip install bgutil-ytdlp-pot-provider

echo "==> Purging old challenge caches..."
rm -rf temp/.cache bin/.cache
.venv/bin/yt-dlp --rm-cache-dir

echo "==> Downloading ffmpeg static binaries..."
curl -L https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz -o ffmpeg.tar.xz
tar -xf ffmpeg.tar.xz
mv ffmpeg-*-amd64-static/ffmpeg bin/
mv ffmpeg-*-amd64-static/ffprobe bin/
chmod +x bin/ffmpeg bin/ffprobe
rm -rf ffmpeg.tar.xz ffmpeg-*-amd64-static

echo "==> Downloading Deno runtime..."
curl -L https://github.com/denoland/deno/releases/latest/download/deno-x86_64-unknown-linux-gnu.zip -o deno.zip
python3 -c "import zipfile; zipfile.ZipFile('deno.zip').extractall('bin/')"
chmod +x bin/deno
rm -f deno.zip

if [ "$IS_POSTINSTALL" = "true" ]; then
  echo "==> Triggered via postinstall. Skipping nested npm install to avoid recursion."
else
  echo "==> Triggered directly. Installing npm dependencies..."
  npm install --production
fi

echo "==> Build complete!"
