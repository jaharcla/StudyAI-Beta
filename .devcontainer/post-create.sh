#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
app_root="$repo_root/template-react-ts-main/template-react-ts-main"
mcp_root="$repo_root/waterloo_learn_mcp-main/waterloo_learn_mcp-main"

sudo apt-get update
sudo apt-get install -y --no-install-recommends xvfb x11vnc novnc python3-websockify python3-venv libreoffice-writer libreoffice-calc libreoffice-impress tesseract-ocr ffmpeg
npm ci --prefix "$app_root"
npm ci --prefix "$mcp_root"
python3 -m venv "$mcp_root/.venv"
"$mcp_root/.venv/bin/pip" install --no-cache-dir -r "$mcp_root/requirements-transcription.txt"
npm run build --prefix "$mcp_root"
sudo "$mcp_root/node_modules/.bin/playwright" install-deps chromium
"$mcp_root/node_modules/.bin/playwright" install chromium
mkdir -p "$repo_root/.studyai-private"
chmod 700 "$repo_root/.studyai-private"

