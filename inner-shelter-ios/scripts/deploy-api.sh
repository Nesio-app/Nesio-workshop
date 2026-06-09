#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== Inner Shelter API · Vercel 部署 ==="
echo ""

if ! command -v npx &>/dev/null; then
  echo "需要 Node.js / npx"
  exit 1
fi

if [ -z "${GEMINI_API_KEY:-}" ] && [ -z "${OPENAI_API_KEY:-}" ]; then
  echo "提示：部署后在 Vercel 控制台设置 GEMINI_API_KEY 或 OPENAI_API_KEY"
fi

echo "1. 登录 Vercel（若未登录）"
npx vercel login || true

echo ""
echo "2. 部署到生产环境"
DEPLOY_URL=$(npx vercel --prod --yes 2>&1 | tee /dev/stderr | grep -oE 'https://[a-zA-Z0-9.-]+\.vercel\.app' | tail -1)

if [ -z "$DEPLOY_URL" ]; then
  echo ""
  echo "部署完成。请在 Vercel 控制台复制 Production URL。"
  echo "然后运行: echo \"window.INNER_SHELTER_API = 'https://YOUR_URL.vercel.app';\" > config.local.js && npm run cap:sync"
  exit 0
fi

echo ""
echo "3. 写入 config.local.js"
cat > config.local.js <<EOF
window.INNER_SHELTER_API = '${DEPLOY_URL}';
EOF

echo "   API URL: ${DEPLOY_URL}"
echo ""
echo "4. 同步到 iOS"
npm run cap:sync

echo ""
echo "=== 完成 ==="
echo "验证 API:"
echo "  curl -X POST ${DEPLOY_URL}/api/inner-shelter/chat \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"system\":\"test\",\"user\":\"hi\"}'"
echo ""
echo "打开 Xcode: npm run ios"
