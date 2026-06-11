#!/usr/bin/env bash
# Sync this directory to github.com/hanbing6228/memory (Render production).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${TMPDIR:-/tmp}/memory-sync-$$"

echo "Cloning hanbing6228/memory → $DEST"
git clone --depth 1 https://github.com/hanbing6228/memory.git "$DEST"

rsync -a --delete \
  --exclude .git \
  --exclude node_modules \
  --exclude .next \
  --exclude .env \
  --exclude '.env.*' \
  --exclude '*.db' \
  --exclude data \
  "$ROOT/" "$DEST/"

cd "$DEST"
if git diff --quiet && git diff --cached --quiet; then
  echo "No changes to push."
  exit 0
fi

git add -A
git status --short
git commit -m "${1:-Sync from DS_Profolio/memory}"
git push origin main

echo ""
echo "Pushed to hanbing6228/memory. Render will deploy if Auto-Deploy is on;"
echo "otherwise: Dashboard → nianguichu → Manual Deploy → Deploy latest commit."
echo "Verify: curl -s https://nianguichu.onrender.com/api/version"
