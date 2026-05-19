// Hover-on-<img> card identification via NetrunnerDB CDN URL match.
// Relies on window.__nrOverlay from overlay.js (loaded earlier).

(() => {
  const TAG = "[netrunner-hover]";
  if (window.__nrHoverLoaded) return;
  window.__nrHoverLoaded = true;

  const SMALL_IMAGE_WIDTH_PX = window.__nrOverlay?.width ?? 300;
  const CDN_RE = /card-images\.netrunnerdb\.com\/v2\/[^/]+\/([^/.?#]+)\./;

  const printingIndex = new Map();
  let currentTarget = null;

  function indexCards(cards) {
    printingIndex.clear();
    for (const c of cards) {
      for (const pid of c.printingIds ?? []) {
        printingIndex.set(String(pid), c);
      }
    }
  }

  async function loadCards() {
    const { cards = [] } = await chrome.storage.local.get("cards");
    indexCards(cards);
    console.log(TAG, `indexed ${cards.length} cards by printing id`);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.cards) indexCards(changes.cards.newValue ?? []);
  });

  function identifyFromImg(img) {
    const src = img.currentSrc || img.src;
    if (!src) return null;
    const m = CDN_RE.exec(src);
    return m ? (printingIndex.get(m[1]) ?? null) : null;
  }

  document.addEventListener(
    "mouseover",
    (e) => {
      const t = e.target;
      if (!(t instanceof HTMLImageElement)) return;
      if (t === currentTarget) return;
      const card = identifyFromImg(t);
      if (!card) return;
      const rect = t.getBoundingClientRect();
      if (rect.width >= SMALL_IMAGE_WIDTH_PX) return;
      currentTarget = t;
      window.__nrOverlay.show(card, rect);
    },
    true,
  );

  document.addEventListener(
    "mouseout",
    (e) => {
      if (e.target === currentTarget) {
        window.__nrOverlay.hide();
        currentTarget = null;
      }
    },
    true,
  );

  loadCards();
  console.log(TAG, `loaded on ${location.host}`);
})();
