#!/usr/bin/env bash
set -euo pipefail

if [ -f .deploy-version ]; then
  echo "Starting nianguichu build ${RENDER_GIT_COMMIT:-$(cat .deploy-version)}"
fi

# Free Postgres may need a moment to accept connections on cold start.
attempt=1
max=15
until npx prisma migrate deploy; do
  if [ "$attempt" -ge "$max" ]; then
    echo "prisma migrate deploy failed after ${max} attempts"
    exit 1
  fi
  echo "Database not ready (attempt ${attempt}/${max}), retrying in 5s..."
  sleep 5
  attempt=$((attempt + 1))
done

npx tsx scripts/ensure-seed.ts
exec npm start
