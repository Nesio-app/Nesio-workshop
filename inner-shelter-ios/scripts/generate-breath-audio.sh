#!/usr/bin/env bash
# Generate yoga-style breath guide MP3s (zh-CN male, slow & low).
# Requires: inner-shelter-ios/.venv-tts (run once: python3 -m venv .venv-tts && .venv-tts/bin/pip install edge-tts)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/../public/inner-shelter/audio/breath"
EDGE="$ROOT/.venv-tts/bin/edge-tts"
VOICE="zh-CN-YunjianNeural"
RATE="-32%"
PITCH="-18Hz"

mkdir -p "$OUT"

gen() {
  local file="$1"
  local text="$2"
  echo "→ $file.mp3  $text"
  "$EDGE" --voice "$VOICE" --rate "$RATE" --pitch "$PITCH" \
    --text "$text" --write-media "$OUT/$file.mp3"
}

gen prep_0 "沉静下来"
gen prep_1 "将注意力放在呼吸上"
gen sos_0 "双手叠放胸口"
gen sos_1 "感受心跳的节律"
gen sos_2 "你在，你安全"
gen in_0 "吸气"
gen in_1 "深深吸气"
gen hold_0 "屏息"
gen hold_1 "保持这一口气"
gen out_0 "呼气"
gen out_1 "缓缓呼出"
gen done_0 "好样的"
gen done_1 "你已经做得很好"

echo "Done: $OUT"
