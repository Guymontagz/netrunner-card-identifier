# Privacy Policy — Netrunner Card Identifier

_Last updated: 2026-07-02_

This Chrome extension ("the Extension") does not collect, store, transmit,
or share any personal data. There is no account, no telemetry, no analytics.

## What the Extension does on your device

- **Card recognition runs locally.** When you Alt+drag a region in a video,
  the cropped pixels are passed to a bundled ONNX model running on your own
  CPU via WebAssembly. The image data never leaves your browser.
- **The card catalog is bundled** in the extension package (titles, types,
  and image URLs), not fetched or cached from any remote server at runtime.

## Network requests the Extension makes

The Extension makes outbound HTTP requests only to:

1. **NetrunnerDB image CDN** (`https://card-images.netrunnerdb.com/`) — to
   display the matched card image in the overlay. Triggered by your own
   identification action.

This is the only external service contacted at runtime. The bundled
embedder model and card catalog are included in the extension package and
not fetched from any remote server.

## Permissions

| Permission | Why it's needed |
|---|---|
| `alarms` | Schedule a periodic idle check that closes the offscreen document to free memory after inference. |
| `offscreen` | Run the ML model in an extension-origin document so the WebAssembly runtime can spawn Workers. |
| `host_permissions` for `card-images.netrunnerdb.com` | Load the matched card's art for the overlay. |
| Content scripts on `<all_urls>` | Required to offer Alt+drag identification on any page where a Netrunner stream might be playing. The content scripts do not transmit page data anywhere. |

## Third-party data

No third-party SDKs, no third-party analytics, no third-party ad networks.
The bundled ML model is the open-source [Milo](https://huggingface.co/HanClinto/milo)
embedder. Card data is provided by [NetrunnerDB](https://netrunnerdb.com/),
which has its own privacy practices.

## Changes

This policy may be updated alongside extension releases. Material changes
will be called out in the changelog. The latest version is always at
[github.com/Guymontagz/netrunner-card-identifier](https://github.com/Guymontagz/netrunner-card-identifier).

## Contact

File issues at the GitHub repo above. There is no other contact channel.
