#!/usr/bin/env python3
"""Build the Netrunner card embedding catalog for the extension.

Downloads the HanClinto/milo ONNX embedder, fetches a card pool from
NetrunnerDB v3 (default: ``eternal`` — every card ever printed), and emits
three artifacts under ``src/model``:

* ``embedder.onnx`` — local copy of the model
* ``catalog.bin`` — float32 row-major embeddings, shape ``(rows, dim)``
* ``catalog.json`` — per-row metadata (card id, title, orientation, image URL)

Usage:
    python tools/build-catalog.py                            # eternal pool (~9700 rows)
    python tools/build-catalog.py --pool standard_2026_vantage_point  # current Standard only
    python tools/build-catalog.py --limit 5                  # smoke test on 5 cards
"""

from __future__ import annotations

import argparse
import io
import json
import sys
from pathlib import Path
from urllib.request import Request, urlopen

import numpy as np
import onnxruntime as ort
from PIL import Image

MODEL_URL = "https://huggingface.co/HanClinto/milo/resolve/main/model.onnx"
NRDB_BASE = "https://api-preview.netrunnerdb.com/api/v3/public"
IMAGE_URL = "https://card-images.netrunnerdb.com/v2/large/{code}.jpg"

INPUT_SIZE = 448
IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
IMAGENET_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)
EMBED_DIM = 128


def http_get(url: str) -> bytes:
    req = Request(url, headers={"User-Agent": "netrunner-ext/build-catalog"})
    with urlopen(req) as r:
        return r.read()


def download_model(dest: Path) -> None:
    if dest.exists() and dest.stat().st_size > 1_000_000:
        print(f"  using cached model at {dest} ({dest.stat().st_size // 1024} KB)")
        return
    print(f"  downloading {MODEL_URL}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(http_get(MODEL_URL))
    print(f"  wrote {dest} ({dest.stat().st_size // 1024} KB)")


def resolve_pool_id(spec: str) -> str:
    """Accept either a literal pool id or a format name. The format name
    'standard' resolves to whatever the active Standard pool is today."""
    if spec == "standard":
        fmt = json.loads(http_get(f"{NRDB_BASE}/formats/standard"))
        return fmt["data"]["attributes"]["active_card_pool_id"]
    return spec


def fetch_pool_cards(pool_id: str) -> list[dict]:
    print(f"  card pool: {pool_id}")
    url = f"{NRDB_BASE}/cards?filter[card_pool_id]={pool_id}&page[size]=3000"
    body = json.loads(http_get(url))
    cards = body["data"]
    expected = body.get("meta", {}).get("stats", {}).get("total", {}).get("count")
    if expected is not None and len(cards) != expected:
        raise SystemExit(f"pagination required: got {len(cards)} of {expected}")
    print(f"  fetched {len(cards)} cards")
    return cards


def get_image(printing_id: str, cache_dir: Path) -> Image.Image:
    cache_path = cache_dir / f"{printing_id}.jpg"
    if cache_path.exists():
        return Image.open(cache_path).convert("RGB")
    raw = http_get(IMAGE_URL.format(code=printing_id))
    cache_path.write_bytes(raw)
    return Image.open(io.BytesIO(raw)).convert("RGB")


def preprocess(img: Image.Image) -> np.ndarray:
    img = img.resize((INPUT_SIZE, INPUT_SIZE), Image.BILINEAR)
    arr = np.asarray(img, dtype=np.float32) / 255.0
    arr = (arr - IMAGENET_MEAN) / IMAGENET_STD
    arr = arr.transpose(2, 0, 1)[None, :, :, :]  # HWC -> CHW, add batch
    return arr.astype(np.float32)


def jinteki_variant(img: Image.Image) -> Image.Image:
    """Simulate how a card looks in a YouTube video of jinteki.net play:

    1. Top 55% crop  — installed cards on jinteki have the bottom hidden under
       the next card in their stack, so only the title + upper art is visible.
    2. Bilinear downscale to 80 px on the long side — installed cards are
       small on screen (~30-80 px wide on 1080p video).

    The final upscale-to-448x448 happens inside preprocess() exactly as it
    does for runtime queries, so the J-variant catalog row sees the same
    bilinear-up-from-low-res pixels a real jinteki video query produces.
    """
    w, h = img.size
    cropped = img.crop((0, 0, w, max(1, int(h * 0.55))))
    cw, ch = cropped.size
    scale = 80.0 / max(cw, ch)
    return cropped.resize((max(1, int(cw * scale)), max(1, int(ch * scale))), Image.BILINEAR)


def embed(session: ort.InferenceSession, input_name: str, img: Image.Image) -> np.ndarray:
    (out,) = session.run(None, {input_name: preprocess(img)})
    vec = out[0].astype(np.float32)
    # Defensive renormalize even though the model says it's already L2-normalized.
    n = float(np.linalg.norm(vec))
    return vec / n if n > 0 else vec


def main() -> None:
    repo_root = Path(__file__).resolve().parent.parent
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=repo_root / "src" / "model")
    ap.add_argument("--cache", type=Path, default=repo_root / ".cache" / "build-catalog")
    ap.add_argument("--limit", type=int, default=0, help="Only process N cards (smoke test)")
    ap.add_argument(
        "--pool",
        default="eternal",
        help="Card pool id (default: eternal = every card ever printed). "
        "Use 'standard' for the live Standard pool, or any specific pool id like "
        "'standard_2026_vantage_point'.",
    )
    args = ap.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    args.cache.mkdir(parents=True, exist_ok=True)

    print("== Model ==")
    model_path = args.out / "embedder.onnx"
    download_model(model_path)

    print("== ONNX session ==")
    session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
    input_meta = session.get_inputs()[0]
    output_meta = session.get_outputs()[0]
    print(f"  input  : {input_meta.name} shape={input_meta.shape} dtype={input_meta.type}")
    print(f"  output : {output_meta.name} shape={output_meta.shape} dtype={output_meta.type}")

    print("== Card pool ==")
    pool_id = resolve_pool_id(args.pool)
    cards = fetch_pool_cards(pool_id)
    if args.limit:
        cards = cards[: args.limit]
        print(f"  truncated to first {len(cards)} for smoke test")

    print("== Embedding ==")
    rows: list[dict] = []
    embeddings: list[np.ndarray] = []
    skipped: list[str] = []
    for i, c in enumerate(cards):
        attrs = c["attributes"]
        printing_ids = attrs.get("printing_ids") or []
        if not printing_ids:
            skipped.append(c.get("id", "?"))
            continue
        title = attrs.get("title", "?")
        card_type = attrs.get("card_type_id", "?")
        print(f"  [{i + 1:>3}/{len(cards)}] {title} ({len(printing_ids)} printing{'s' if len(printing_ids) != 1 else ''}, {card_type})")

        # One catalog entry per (printing × orientation). Alt arts are
        # genuinely different images — the embedder treats them as distinct
        # cards, so to recognise the alt the user sees on stream we need its
        # own embedding. The matched row carries that printing's imageUrl,
        # so the overlay shows the same art that was on screen.
        for pid in printing_ids:
            try:
                img = get_image(pid, args.cache)
            except Exception as e:  # noqa: BLE001
                print(f"      printing {pid} image fetch failed: {e}")
                continue
            is_ice = card_type == "ice"
            # Base orientations: keep all four for every card. Cardboard
            # webcam streams catch opposing players' cards rotated 180°,
            # and ICE laid sideways needs both L and R for either server
            # direction.
            base_orients = (("P", 0), ("L", -90), ("U", 180), ("R", 90))
            # Jinteki orientations: only the ones jinteki.net actually
            # displays. Non-ICE cards are shown portrait (in their native
            # NRDB orientation, which for identities is already landscape).
            # ICE is shown portrait in hand AND landscape once
            # installed/rezzed, so it needs JP plus both landscape rotations
            # (jinteki may lay ICE either direction depending on server).
            j_orients = (("P", 0), ("L", -90), ("R", 90)) if is_ice else (("P", 0),)
            for orient_key, angle in base_orients:
                rot = img if angle == 0 else img.rotate(angle, expand=True)
                embeddings.append(embed(session, input_meta.name, rot))
                rows.append({
                    "cardId": c["id"],
                    "title": title,
                    "type": card_type,
                    "printingId": pid,
                    "imageUrl": IMAGE_URL.format(code=pid),
                    "orient": orient_key,
                })
            for orient_key, angle in j_orients:
                rot = img if angle == 0 else img.rotate(angle, expand=True)
                # Jinteki-in-stream variant: top-cropped + downscaled.
                # Simulates an installed card on a YouTube video of
                # jinteki.net play.
                embeddings.append(embed(session, input_meta.name, jinteki_variant(rot)))
                rows.append({
                    "cardId": c["id"],
                    "title": title,
                    "type": card_type,
                    "printingId": pid,
                    "imageUrl": IMAGE_URL.format(code=pid),
                    "orient": f"J{orient_key}",
                })

    if not embeddings:
        raise SystemExit("no embeddings produced; aborting")

    arr = np.stack(embeddings).astype(np.float32)
    print(f"\n== Output ==")
    by_orient: dict[str, int] = {}
    for r in rows:
        by_orient[r["orient"]] = by_orient.get(r["orient"], 0) + 1
    # Sorted for stable output
    by_orient_str = ", ".join(f"{k}={v}" for k, v in sorted(by_orient.items()))
    print(f"  catalog rows: {len(rows)} ({by_orient_str})")
    print(f"  embedding dim: {arr.shape[1]} (expected {EMBED_DIM})")

    (args.out / "catalog.bin").write_bytes(arr.tobytes())
    print(f"  wrote {args.out / 'catalog.bin'} ({arr.nbytes // 1024} KB)")

    (args.out / "catalog.json").write_text(json.dumps({
        "version": 1,
        "poolId": pool_id,
        "dim": int(arr.shape[1]),
        "inputSize": INPUT_SIZE,
        "rows": rows,
    }, indent=2))
    print(f"  wrote {args.out / 'catalog.json'}")

    # Same-card portrait↔landscape sanity (only for ICE rows that have both)
    cross = []
    by_card: dict[str, dict[str, int]] = {}
    for idx, row in enumerate(rows):
        by_card.setdefault(row["cardId"], {})[row["orient"]] = idx
    for orients in by_card.values():
        if "P" in orients and "L" in orients:
            cross.append(float(np.dot(arr[orients["P"]], arr[orients["L"]])))
    if cross:
        arr_cross = np.array(cross)
        print(f"  ICE P↔L cosine: mean={arr_cross.mean():.3f} min={arr_cross.min():.3f} max={arr_cross.max():.3f}")
        print(f"    fraction > 0.5: {(arr_cross > 0.5).mean():.1%}")

    if skipped:
        print(f"\n  skipped {len(skipped)} cards: {skipped[:10]}{'…' if len(skipped) > 10 else ''}")


if __name__ == "__main__":
    main()
