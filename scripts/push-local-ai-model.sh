#!/usr/bin/env bash
# 把 MNN 本地模型推到 TickFlow 安卓端（与雅思 App 同一套目录约定）。
# 用法：bash scripts/push-local-ai-model.sh <本机模型目录> [模型名] [adb 序列号]
#   bash scripts/push-local-ai-model.sh F:/cache/models/qwen35-2b-mnn qwen35-2b
# 目标目录：/sdcard/Android/data/com.tickflow.mobile/files/models/mnn/<模型名>/
# 应用首次使用时会拷贝到内部 filesDir（/sdcard 为 FUSE，mmap 权重不可靠）。
set -euo pipefail

SRC="${1:?用法: push-local-ai-model.sh <本机模型目录> [模型名] [adb 序列号]}"
NAME="${2:-$(basename "$SRC")}"
SERIAL="${3:-}"
PKG="com.tickflow.mobile"
DEST="/sdcard/Android/data/$PKG/files/models/mnn/$NAME"

ADB=(adb)
if [ -n "$SERIAL" ]; then
  ADB=(adb -s "$SERIAL")
fi

for f in config.json llm_config.json llm.mnn llm.mnn.json llm.mnn.weight; do
  [ -f "$SRC/$f" ] || { echo "缺少模型文件：$SRC/$f"; exit 2; }
done

"${ADB[@]}" shell mkdir -p "$DEST"
for f in config.json configuration.json llm_config.json llm.mnn llm.mnn.json llm.mnn.weight tokenizer.txt; do
  [ -f "$SRC/$f" ] || continue
  echo "[push] $f"
  "${ADB[@]}" push "$SRC/$f" "$DEST/$f" >/dev/null
done

echo "[done] $DEST"
"${ADB[@]}" shell du -sh "$DEST"
