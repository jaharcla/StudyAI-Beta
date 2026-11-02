#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
app_root="$repo_root/template-react-ts-main/template-react-ts-main"
mcp_root="$repo_root/waterloo_learn_mcp-main/waterloo_learn_mcp-main"

sudo apt-get update
sudo apt-get install -y --no-install-recommends xvfb x11vnc novnc python3-websockify
npm ci --prefix "$app_root"
npm ci --prefix "$mcp_root"
npm run build --prefix "$mcp_root"
sudo "$mcp_root/node_modules/.bin/playwright" install-deps chromium
"$mcp_root/node_modules/.bin/playwright" install chromium
mkdir -p "$repo_root/.studyai-private"
chmod 700 "$repo_root/.studyai-private"
