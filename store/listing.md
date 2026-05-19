# Chrome Web Store listing copy

## Short description (≤132 chars)

> Identify Netrunner cards in stream and tournament video with Alt+drag, plus hover-to-zoom on any NetrunnerDB card image.

(127 chars)

## Detailed description

```
Identify Netrunner cards directly in your browser — no copying card names,
no flipping to NetrunnerDB in another tab.

WHAT IT DOES
• Hold Alt and drag a rectangle around any card visible in a YouTube or
  Twitch video. The full card art and text pops up beside your cursor.
• Hover any embedded NetrunnerDB card image on any page (forums, blogs,
  the NetrunnerDB site itself) to see the full card.
• Works across all four card orientations, so it handles webcam-on-mat
  tournament footage where players sit on opposite sides of the board
  and ICE is laid sideways.

HOW IT WORKS
• A trained card-embedder model (Milo, MobileViT-XXS) runs locally in
  your browser via WebAssembly. No images are uploaded anywhere.
• Card data and reference images come from NetrunnerDB; the extension
  refreshes its card list weekly.
• Standard format only — covers the ~613 cards in the current Standard
  card pool.

SCOPE
✓ Physical cardboard play in webcam streams (the Neon Static use case)
✓ Tournament broadcasts and VODs
✓ Hover-to-zoom on any embedded NetrunnerDB image
✗ jinteki.net play captured in YouTube/Twitch video — out of scope for v1;
  the digital renders re-encoded by streaming don't match the embedder's
  training distribution as cleanly. A dedicated jinteki recognizer is on
  the roadmap.

PRIVACY
• No telemetry. No analytics. No account.
• All card recognition happens on your machine.
• Card metadata is fetched from NetrunnerDB once a week.

OPEN SOURCE
AGPL-3.0. Source: https://github.com/Guymontagz/netrunner-card-identifier
Built on NetReady Eyes (github.com/eheiden/netreadyeyes), Milo
(huggingface.co/HanClinto/milo), and NetrunnerDB. Netrunner is by Null
Signal Games (nullsignal.games).
```

## Category

Productivity

## Language

English (United States)

## Visibility

Public

## Source code URL (required for AGPL listings)

https://github.com/Guymontagz/netrunner-card-identifier

## Permissions justification (Web Store reviewer notes)

- **storage** — caches the Standard card catalog and last-sync timestamp in
  chrome.storage.local. No personal data, no remote storage.
- **alarms** — schedules the weekly card-metadata refresh from NetrunnerDB.
- **offscreen** — required to host the ONNX runtime in the extension's
  origin so it can spawn Web Workers (content scripts can't host
  cross-origin Workers on host pages like youtube.com).
- **host_permissions: api-preview.netrunnerdb.com** — fetches card metadata.
- **host_permissions: card-images.netrunnerdb.com** — fetches card images
  shown in the overlay.

## Single-purpose description

Identifies Netrunner cards from images shown in browser tabs (uploaded
videos and embedded images) by running a locally-bundled image-embedding
model and matching against a NetrunnerDB card catalog.

## Screenshots checklist

Need 1280 × 800 PNGs under `store/screenshots/`:

1. `01-video-identify.png` — Alt+drag selection rectangle around a card in
   a **physical-cardboard webcam stream** (Neon Static / tournament VOD),
   with the matched card overlay visible. **Do NOT use jinteki.net footage**
   — that's the weak case and shouldn't appear in promotional material.
2. `02-hover-image.png` — Hover on a NetrunnerDB card thumbnail showing
   the floating overlay.
3. `03-popup.png` — The toolbar popup showing card pool / sync status.

## Promo tile (optional but recommended)

`store/promo-tile-440x280.png` — extension icon + tagline.
