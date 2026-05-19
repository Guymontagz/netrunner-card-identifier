#!/usr/bin/env bash
# Downloads onnxruntime-web v1.20.0 vendor files into src/vendor/ort/.
# These aren't committed because they total ~35 MB; the ZIP shipped to the
# Chrome Web Store includes them, so this script only matters for developers
# building from source.

set -euo pipefail

VERSION=1.20.0
DEST="$(cd "$(dirname "$0")/.." && pwd)/src/vendor/ort"
BASE="https://cdn.jsdelivr.net/npm/onnxruntime-web@${VERSION}/dist"

FILES=(
  ort.min.mjs
  ort-wasm-simd-threaded.wasm
  ort-wasm-simd-threaded.mjs
  ort-wasm-simd-threaded.jsep.wasm
  ort-wasm-simd-threaded.jsep.mjs
)

mkdir -p "$DEST"
echo "Fetching onnxruntime-web@${VERSION} into ${DEST}…"

for f in "${FILES[@]}"; do
  if [[ -s "$DEST/$f" ]]; then
    printf '  %-40s already present\n' "$f"
    continue
  fi
  printf '  %-40s ' "$f"
  curl -fsSL --max-time 120 -o "$DEST/$f" "$BASE/$f"
  printf 'done (%s bytes)\n' "$(stat -f%z "$DEST/$f" 2>/dev/null || stat -c%s "$DEST/$f")"
done

echo
echo "Vendor fetch complete."
echo "Total size: $(du -sh "$DEST" | cut -f1)"
