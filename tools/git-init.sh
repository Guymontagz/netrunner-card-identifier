#!/usr/bin/env bash
# Initialises this directory as a git repo, stages everything respecting
# .gitignore, and creates the initial commit. Idempotent-ish: refuses to
# run if a .git directory already exists, so you don't accidentally clobber
# existing history.

set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f manifest.json ]]; then
  echo "ERROR: must run from the netrunner-ext project root." >&2
  exit 1
fi

if [[ -d .git ]]; then
  echo "ERROR: .git already exists — this script is for first-time setup only." >&2
  echo "If you want to redo the initial commit, delete .git/ manually first." >&2
  exit 1
fi

echo "Initialising git repo (default branch: main)…"
git init -b main >/dev/null

echo "Staging files (respecting .gitignore)…"
git add .

echo "Files staged:"
git status --short | head -20
echo "  …$(git status --short | wc -l | tr -d ' ') files total"
echo

echo "Creating initial commit…"
git commit -m "$(cat <<'EOF'
Initial commit: Netrunner card identifier for Chrome (v0.1.0)

A Manifest V3 Chrome extension that identifies Netrunner cards visible in
tournament and stream video, plus hover-to-zoom on any embedded
NetrunnerDB card image.

Architecture
- Alt+drag on any <video> captures the selected region and routes it
  through the background service worker to a chrome.offscreen document.
- The offscreen page hosts onnxruntime-web (CSP-permitted in extension
  origin) and runs the Milo MobileViT-XXS embedder against the captured
  region, finding nearest neighbours by cosine similarity in a 128-dim
  L2-normalised feature space.
- The catalog covers the active Standard pool (613 cards × 4 orientations
  × all NRDB-tracked printings = 2556 rows). Built offline via
  tools/build-catalog.py against NetrunnerDB v3.
- Hover-on-<img> (URL-based, no inference) handles embedded card images
  on NetrunnerDB, forums, blogs.

Scope
- Primary: physical-cardboard webcam stream footage (Neon Static-style).
- Secondary: hover-to-zoom on any embedded NetrunnerDB image.
- Out of scope for v1: jinteki.net play captured in YouTube/Twitch video.
  Separate recognizer planned (likely DOM-based on jinteki.net itself, or
  a template-matched second model for stream-of-jinteki video).

Credits
- NetReady Eyes (github.com/eheiden/netreadyeyes) — Python desktop scanner
  that pioneered this approach for Netrunner.
- Milo embedder (huggingface.co/HanClinto/milo) — does the heavy lifting.
- NetrunnerDB — card data and images.
- Null Signal Games — Netrunner.

License: AGPL-3.0 (required by the bundled Milo model).
EOF
)"

echo
echo "✓ Initial commit created."
echo
echo "Next steps:"
echo "  1. Create the GitHub repo (any name; suggested: netrunner-card-identifier):"
echo "       gh repo create <name> --public --source . --remote origin --push"
echo "     or, manually:"
echo "       git remote add origin git@github.com:<you>/<name>.git"
echo "       git push -u origin main"
echo "  2. Settings → Pages → Source = main / (root) so privacy-policy.md is publicly served"
echo "  3. Update the placeholder repo URL in README.md, popup.js, CONTRIBUTING.md, store/*.md"
echo "  4. bash tools/package.sh to build the Web Store ZIP"
