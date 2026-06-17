#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== LifeFlow · Vercel 部署 ==="
echo ""
echo "Git 已连通：通常只需 git push origin main，Vercel 会自动部署。"
echo "本脚本用于手动触发或首次链接本地 .vercel。"
echo ""

PRODUCTION_URL="${LIFEFLOW_PRODUCTION_URL:-https://adhd-flow-ios.vercel.app}"

if ! command -v npx &>/dev/null; then
  echo "需要 Node.js / npx"
  exit 1
fi

if [ -z "${GEMINI_API_KEY:-}" ]; then
  echo "提示：在 Vercel 项目 adhd-flow-ios 设置 GEMINI_API_KEY（可与 inner-shelter-ios 相同）"
fi

echo "1. 登录 Vercel（若未登录）"
npx vercel login || true

echo ""
echo "2. 部署到生产环境"
DEPLOY_URL=$(npx vercel --prod --yes 2>&1 | tee /dev/stderr | grep -oE 'https://[a-zA-Z0-9.-]+\.vercel\.app' | tail -1)
if [ -z "$DEPLOY_URL" ]; then
  DEPLOY_URL="$PRODUCTION_URL"
  echo "   使用默认 Production URL: $DEPLOY_URL"
fi

if [ -z "$DEPLOY_URL" ]; then
  echo ""
  echo "部署完成。请在 Vercel 控制台复制 Production URL。"
  echo "然后运行: echo \"window.ADHD_FLOW_API = 'https://YOUR_URL.vercel.app';\" > config.local.js && npm run cap:sync"
  exit 0
fi

echo ""
echo "3. 写入 config.local.js"
cat > config.local.js <<EOF
window.ADHD_FLOW_API = '${DEPLOY_URL}';
EOF

echo "   API URL: ${DEPLOY_URL}"
echo ""
echo "4. 同步到 iOS"
npm run cap:sync

echo ""
echo "=== 完成 ==="
echo "验证 API:"
echo "  curl ${DEPLOY_URL}/api/adhd-flow/health"
echo ""
echo "打开 Xcode: npm run ios"
