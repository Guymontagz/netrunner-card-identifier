# Chrome Web Store assets

This directory holds everything submitted to the Web Store listing. None of
it is required for the extension to function — it's only for publishing.

## Files

| File | Purpose |
|---|---|
| `listing.md` | Short + detailed descriptions, category, source URL, permissions justifications, single-purpose statement. Copy/paste into the Web Store developer dashboard at submission time. |
| `privacy-policy.md` | Privacy policy text. Host this somewhere public (GitHub Pages on this repo, or just link directly to the raw file on GitHub) and put that URL in the Web Store listing's "Privacy policy" field. |
| `screenshots/` | 1280 × 800 PNGs shown in the listing. **Not committed yet — capture during submission.** See `listing.md` for the recommended three screenshots. |
| `promo-tile-440x280.png` | Optional promotional tile shown in store rankings. Not committed yet. |

## Submission checklist

- [ ] Run `bash tools/package.sh` to produce `dist/netrunner-card-identifier-{version}.zip`
- [ ] Capture three 1280 × 800 screenshots → `store/screenshots/`
      **Use a physical-cardboard stream (Neon Static / tournament VOD) for the video screenshot, NOT jinteki.net. Jinteki video is the weak case and shouldn't appear in store assets.**
- [ ] (Optional) Design a 440 × 280 promo tile → `store/promo-tile-440x280.png`
- [ ] Enable GitHub Pages on the repo so `privacy-policy.md` is publicly served
- [ ] Register a Chrome Web Store developer account ($5 one-time fee)
- [ ] Upload the ZIP, fill the listing copy from `listing.md`, attach
      screenshots, paste the privacy policy URL, submit for review
- [ ] Wait 1–3 business days for first review
