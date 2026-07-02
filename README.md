# Netrunner Card Identifier

A Chrome extension that identifies Netrunner cards in tournament and stream
footage and shows the full card art and text inline. Inspired by
[Ocular Automaton](https://twitter.com/OcularAutomaton) (MTG) and
[NetReady Eyes](https://github.com/eheiden/netreadyeyes) (Netrunner desktop
scanner).

## What it does

- **Alt+drag on a video** to identify a card by its image. Works well on
  webcam-on-mat physical stream footage (Neon Static, tournament VODs, etc.)
  across all four card orientations.

Reference card art comes from [NetrunnerDB](https://netrunnerdb.com/);
identification uses the [Milo](https://huggingface.co/HanClinto/milo)
ONNX card-embedder running locally via WebAssembly.

## Install

### From the Chrome Web Store

*(Pending review — link will be added once published.)*

### Unpacked (build from source)

Requires Python 3.10+ and `bash` (macOS/Linux; Windows works via Git Bash).

```bash
# 1. Set up the Python environment for the catalog builder
python3 -m venv .venv
source .venv/bin/activate
pip install -r tools/requirements.txt

# 2. Build the card embedding catalog (one-time, ~5 minutes)
python tools/build-catalog.py

# 3. Fetch the onnxruntime-web vendor files (~32 MB, one-time)
bash tools/fetch-vendor.sh
```

Then in Chrome:

1. `chrome://extensions` → enable Developer mode
2. **Load unpacked** → select this repo's root directory
3. Pin the extension to your toolbar if you want quick access to the popup.

## Use

**Identify a card in a video** (works on physical-cardboard footage — see
Scope below):
1. Pause a YouTube/Twitch video showing a physical Netrunner game on a
   clear frame.
2. Hold **⌥ (Option)** / **Alt** and **drag** a rectangle around the card.
   The selection rectangle locks to card aspect, in the orientation matching
   your drag direction.
3. The matched card image floats next to your cursor. Click it or press
   **Escape** to dismiss.

> **Note:** Don't test on jinteki.net video — that's a known weak case and
> a separate recognizer is planned for a future release. Use webcam-on-mat
> tournament footage instead.

The page console (Cmd+Opt+I → Console) prints `[netrunner-video]` lines
with the top-3 cosine matches per drag, useful when accuracy is off.

## Scope and known limitations

| Use case | Works? |
|---|---|
| Physical cardboard play on webcam (Neon Static-style streams) | ✓ Primary use case |
| Tournament webcam VODs | ✓ |
| jinteki.net play captured in YouTube/Twitch video | ~ Experimental — see "jinteki augmentation" below |
| Cards smaller than ~50 px on a 1080p frame | ✗ Not enough pixels after the embedder's 448 × 448 downscale |

The catalog ships with every Netrunner card NetrunnerDB tracks (the
"Eternal" pool — FFG era through Null Signal era, ~2000 cards). Each
card×printing is embedded at 4 rotations plus a "J" variant per rotation
that simulates how the card looks in jinteki.net stream footage
(top-cropped + downscaled). Total ≈19,384 catalog rows. To rebuild after a
new set drops: `python tools/build-catalog.py`. To scope to just the
current Standard format: `python tools/build-catalog.py --pool standard`.

### jinteki augmentation (experimental)

The `JP/JL/JU/JR` catalog variants are the extension's attempt to identify
cards shown on YouTube/Twitch videos of jinteki.net play. They simulate
jinteki's installed-card appearance (top-cropped, downscaled). When the
diagnostic top-3 log shows a winning `orient=J*`, that's the augmented
path firing.

Caveat: **ICE cards** share heavy visual layout (subroutines + strength
box + faction symbol) and their J-variants score very close to each other.
On a real jinteki video, ICE identification may often land in the
"ambiguous" gate and refuse to commit. That's the conservative default —
better silent than confidently wrong. Cardboard webcam ICE remains the
strong case.

## Privacy

The extension makes no telemetry calls and stores nothing about you. It:

- Loads reference card art from NetrunnerDB's image CDN only to display a
  matched card.
- Downloads the Milo model from Hugging Face once, when you first build the
  catalog locally. All identification runs on your machine.

Full privacy policy: [`store/privacy-policy.md`](store/privacy-policy.md).

## Project layout

```
manifest.json
src/
  background/           service worker (offscreen lifecycle)
  content/              overlay.js, video-click.js
  offscreen/            ML inference host (loads ONNX, runs nearest-neighbor)
  model/                embedder.onnx + catalog.bin + catalog.json (committed)
  vendor/ort/           onnxruntime-web (not committed; fetched by setup)
  icons/                extension icons (16/32/48/128)
  popup/                toolbar popup (usage blurb, "About" link)
tools/
  build-catalog.py      offline catalog builder (Python + onnxruntime)
  fetch-vendor.sh       downloads onnxruntime-web into src/vendor/ort/
  make-icons.py         regenerates src/icons/*.png from scratch
store/                  Chrome Web Store assets, listing copy, privacy policy
```

## Credits

- **[NetReady Eyes](https://github.com/eheiden/netreadyeyes)** by
  [@eheiden](https://github.com/eheiden) — the Python desktop card scanner
  that pioneered the approach this extension borrows (Milo embedder + NRDB
  catalog + nearest-neighbor). Different form factor, same technical lineage.
- **[Milo](https://huggingface.co/HanClinto/milo)** by
  [@HanClinto](https://huggingface.co/HanClinto) — the MobileViT-XXS card
  embedder that does the heavy lifting.
- **[NetrunnerDB](https://netrunnerdb.com/)** — card data and images.
- **[Null Signal Games](https://nullsignal.games/)** — Netrunner.

## License

[AGPL-3.0](LICENSE). Required because the bundled Milo model is AGPL-3.0.
A permissively-licensed fork is possible if you swap the embedder.
