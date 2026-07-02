#!/usr/bin/env bash
# Packages the extension for Chrome Web Store upload.
#
# Output: dist/netrunner-card-identifier-{version}.zip
# Pre-requisites: src/model/ built (build-catalog.py), src/vendor/ort/
# populated (fetch-vendor.sh).

set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f manifest.json ]]; then
  echo "ERROR: manifest.json not found — run from repo root." >&2
  exit 1
fi

VERSION=$(python3 -c "import json; print(json.load(open('manifest.json'))['version'])")
OUT="dist/netrunner-card-identifier-${VERSION}.zip"

if [[ ! -d src/vendor/ort ]] || [[ -z "$(ls -A src/vendor/ort 2>/dev/null)" ]]; then
  echo "ERROR: src/vendor/ort/ is empty. Run: bash tools/fetch-vendor.sh" >&2
  exit 1
fi

if [[ ! -d src/vendor/tesseract ]] || [[ -z "$(ls -A src/vendor/tesseract 2>/dev/null)" ]]; then
  echo "ERROR: src/vendor/tesseract/ is empty. Run: bash tools/fetch-vendor.sh" >&2
  exit 1
fi

if [[ ! -f src/model/embedder.onnx ]] || [[ ! -f src/model/catalog.bin ]] || [[ ! -f src/model/catalog.json ]]; then
  echo "ERROR: src/model/ artifacts missing. Run: python tools/build-catalog.py" >&2
  exit 1
fi

mkdir -p dist
rm -f "$OUT"

# Explicit inclusion list so we never accidentally ship .venv/.cache/store/etc.
zip -r "$OUT" \
  manifest.json \
  LICENSE \
  src/background \
  src/content \
  src/offscreen \
  src/model \
  src/icons \
  src/popup \
  src/vendor/ort \
  src/vendor/tesseract \
  -x "**/.DS_Store" "**/__pycache__/*" "**/*.swp"

SIZE=$(du -sh "$OUT" | cut -f1)
COUNT=$(unzip -l "$OUT" | tail -1 | awk '{print $2}')
echo
echo "Packaged: $OUT"
echo "  size:  $SIZE"
echo "  files: $COUNT"
echo
echo "Verify the ZIP works as a fresh install:"
echo "  1. unzip $OUT -d /tmp/nr-test"
echo "  2. chrome://extensions → Load unpacked → /tmp/nr-test"
echo "  3. Alt+drag a card on YouTube → confirm overlay appears"
