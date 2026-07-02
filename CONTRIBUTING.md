# Contributing

Thanks for your interest. The extension is small and the maintainer surface
is one person, so a few notes upfront.

## Scope

This project identifies **physical Netrunner cards in stream/video footage**
(webcam-on-mat coverage like Neon Static's streams). **jinteki.net video
recognition is out of scope for v1** and will likely live in a separate
recognizer — please open an issue if you want to collaborate on that.

## Issues

- **Bug reports:** include the host (YouTube/Twitch/etc.), a screenshot of
  the frame you were trying to identify, the top-3 cosine log line from the
  page devtools console (`[netrunner-video]` lines), and which orientation
  you dragged.
- **Card-recognition failures:** before filing, confirm the catalog was
  rebuilt against the current Standard pool — Standard rotates and the
  catalog needs a rerun on rotation.

## Pull requests

- Keep changes focused; one feature/fix per PR.
- The codebase is plain JS / Python — no build step beyond
  `tools/build-catalog.py` and `tools/fetch-vendor.sh`. Don't introduce a
  bundler or framework without discussion first.
- Match existing style: explicit, comments only where the *why* is
  non-obvious, no unused code.
- AGPL-3.0 license — by submitting you agree your contribution is
  AGPL-3.0-licensed.

## License

This project is AGPL-3.0 because it bundles the
[Milo card embedder](https://huggingface.co/HanClinto/milo) which is itself
AGPL-3.0. If you want a permissively-licensed fork, swap the embedder first.
