# Catalog builder

`tools/build-catalog.py` produces the artifacts the extension uses for
ONNX-based card identification:

| Output | What it is |
|---|---|
| `src/model/embedder.onnx` | The MobileViT-XXS embedder ([HanClinto/milo](https://huggingface.co/HanClinto/milo)) — 5.2 MB |
| `src/model/catalog.bin` | Float32 row-major card embeddings, `(rows × 128)` |
| `src/model/catalog.json` | Per-row metadata (card id, title, type, orientation, image URL) |

ICE cards get **two** rows (portrait + 90°-rotated landscape) because they're
laid sideways on jinteki.net; everything else is portrait only. Standard
pool ~613 cards × (1 row + extra for ICE) ≈ 800 rows × 128 floats ≈ 400 KB.

## License caveat

The Milo embedder is **AGPL-3.0**. For personal/internal use of this
extension, fine. For publishing to the Chrome Web Store or otherwise
redistributing, you'd either need to license the extension under AGPL-3.0
too, or replace the embedder with a permissively-licensed equivalent. This
is flagged here so it doesn't surprise anyone later.

## Setup

```bash
# From repo root
python3 -m venv .venv
source .venv/bin/activate
pip install -r tools/requirements.txt
```

## Run

```bash
# Quick smoke test on 5 cards (verifies the model + API + pipeline work)
python tools/build-catalog.py --limit 5

# Full Standard pool
python tools/build-catalog.py
```

First run downloads the model (~5 MB) and ~613 card images (~30 MB, cached
under `.cache/build-catalog/` for reruns). On a modern CPU the full
embedding pass takes ~3–5 minutes.

Rerun whenever Standard rotates (the extension's popup card pool id is the
canonical signal).
