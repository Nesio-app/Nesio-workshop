#!/bin/bash
# 从 nesio-ml 的 GitHub Release 取 web fp16 双塔,放进 public/lab/models/。
# nesio-ml 是私库,浏览器不能直连 Release 资产(要 token),所以靠 gh 下到同源 public/
# 目录——Lab 页开机自动从 /lab/models/ 拉进 IndexedDB,一次拉取后离线可用。
# 对照 iOS 侧 nesio-ios/scripts/fetch_models.sh(同一出菜通道)。
set -euo pipefail
cd "$(dirname "$0")/.."
DEST=public/lab/models
mkdir -p "$DEST"
# 照片:CLIP 双塔 fp16
gh release download web-models-mobileclip2-s0-v1 \
  --repo Nesio-app/nesio-ml \
  --pattern '*.fp16.onnx' \
  --dir "$DEST" --clobber
# 文字:e5 句向量 fp16 + 瘦分词器
gh release download web-models-e5-small-v1 \
  --repo Nesio-app/nesio-ml \
  --pattern 'TextEmbedder.fp16.onnx' --pattern 'e5-tokenizer.json' \
  --dir "$DEST" --clobber
echo "✓ $DEST/ 就绪:"
ls -lh "$DEST"/*.fp16.onnx "$DEST"/e5-tokenizer.json | awk '{print "   "$5, $9}'
