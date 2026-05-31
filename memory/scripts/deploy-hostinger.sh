#!/usr/bin/env bash
# Hostinger VPS deploy — run on server or via GitHub Actions SSH
set -euo pipefail

APP_DIR="${DEPLOY_PATH:-/var/www/nianguichu}"
REPO_URL="${REPO_URL:-https://github.com/hanbing6228/memory.git}"
BRANCH="${BRANCH:-main}"

sudo mkdir -p "$APP_DIR/data"
cd "$APP_DIR"

if [ ! -d .git ]; then
  git clone "$REPO_URL" .
fi

git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"

npm ci
npx prisma generate
npx prisma db push
npm run build

# systemd example — create /etc/systemd/system/nianguichu.service
if command -v systemctl >/dev/null 2>&1; then
  sudo systemctl restart nianguichu 2>/dev/null || true
fi

echo "Deployed to $APP_DIR"
