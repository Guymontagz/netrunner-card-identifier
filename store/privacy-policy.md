# Privacy Policy — Netrunner Card Identifier

_Last updated: 2026-05-19_

This Chrome extension ("the Extension") does not collect, store, transmit,
or share any personal data. There is no account, no telemetry, no analytics.

## What the Extension does on your device

- **Card recognition runs locally.** When you Alt+drag a region in a video,
  the cropped pixels are passed to a bundled ONNX model running on your own
  CPU via WebAssembly. The image data never leaves your browser.
- **Card metadata is cached locally** in `chrome.storage.local`. This
  includes the current Standard card pool's card titles, types, image URLs,
  and a timestamp of when the cache was last refreshed.
- **The toolbar popup** shows your cached card pool ID, card count, and
  last-sync time. None of this is sent anywhere.

## Network requests the Extension makes

The Extension makes outbound HTTP requests only to:

1. **NetrunnerDB API** (`https://api-preview.netrunnerdb.com/`) — once a
   week, to refresh the cached card metadata against the current Standard
   pool. The request includes only standard HTTP headers; no identifying
   information about you.
2. **NetrunnerDB image CDN** (`https://card-images.netrunnerdb.com/`) — to
   display the matched card image in the overlay. Triggered by your own
   identification action.

These are the only external services contacted at runtime. The bundled
embedder model is included in the extension package and not fetched from
any remote server.

## Permissions

| Permission | Why it's needed |
|---|---|
| `storage` | Cache the card catalog locally. |
| `alarms` | Schedule the weekly card-metadata refresh. |
| `offscreen` | Run the ML model in an extension-origin document so the WebAssembly runtime can spawn Workers. |
| `host_permissions` for NetrunnerDB domains | Fetch card data and images. |
| Content scripts on `<all_urls>` | Required to detect card images and offer Alt+drag identification on any page where a Netrunner stream might be playing. The content scripts do not transmit page data anywhere. |

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
