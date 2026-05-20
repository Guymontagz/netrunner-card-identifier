#!/usr/bin/env bash
# Downloads onnxruntime-web and Tesseract.js vendor files. Not committed —
# the ZIP shipped to the Chrome Web Store includes them, so this script
# only matters for developers building from source.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

ORT_VERSION=1.20.0
ORT_DEST="${ROOT}/src/vendor/ort"
ORT_BASE="https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist"

TESS_VERSION=5
TESS_DEST="${ROOT}/src/vendor/tesseract"
TESS_BASE="https://unpkg.com/tesseract.js@${TESS_VERSION}/dist"
TESS_CORE_BASE="https://unpkg.com/tesseract.js-core@${TESS_VERSION}"
TESSDATA_BASE="https://tessdata.projectnaptha.com/4.0.0"

fetch_files() {
  local dest=$1
  local base=$2
  shift 2
  mkdir -p "$dest"
  for f in "$@"; do
    if [[ -s "$dest/$f" ]]; then
      printf '  %-40s already present\n' "$f"
      continue
    fi
    printf '  %-40s ' "$f"
    curl -fsSL --max-time 180 -o "$dest/$f" "$base/$f"
    printf 'done (%s bytes)\n' "$(stat -f%z "$dest/$f" 2>/dev/null || stat -c%s "$dest/$f")"
  done
}

echo "Fetching onnxruntime-web@${ORT_VERSION} into ${ORT_DEST}…"
fetch_files "$ORT_DEST" "$ORT_BASE" \
  ort.min.mjs \
  ort-wasm-simd-threaded.wasm \
  ort-wasm-simd-threaded.mjs \
  ort-wasm-simd-threaded.jsep.wasm \
  ort-wasm-simd-threaded.jsep.mjs

echo
echo "Fetching tesseract.js@${TESS_VERSION} into ${TESS_DEST}…"
fetch_files "$TESS_DEST" "$TESS_BASE" \
  tesseract.esm.min.js \
  worker.min.js
fetch_files "$TESS_DEST" "$TESS_CORE_BASE" \
  tesseract-core-simd.wasm.js \
  tesseract-core-simd.wasm
fetch_files "$TESS_DEST" "$TESSDATA_BASE" \
  eng.traineddata.gz

echo
echo "Vendor fetch complete."
echo "  ort:       $(du -sh "$ORT_DEST" | cut -f1)"
echo "  tesseract: $(du -sh "$TESS_DEST" | cut -f1)"
