// Floating card-art overlay for the video recognizer.
//
// Exposes window.__nrOverlay = { show(card, anchorRect), hide() }.
// Loaded as the first content script so video-click.js can rely on it.

(() => {
  if (window.__nrOverlay) return;

  const OVERLAY_WIDTH_PX = 300;
  let root = null;
  let imgEl = null;

  function ensure() {
    if (root) return root;
    root = document.createElement("div");
    root.setAttribute("data-netrunner-overlay", "");
    Object.assign(root.style, {
      position: "fixed",
      zIndex: "2147483647",
      // Clickable so the user can dismiss by clicking the overlay itself.
      pointerEvents: "auto",
      cursor: "pointer",
      display: "none",
      background: "#1a1a1a",
      border: "1px solid #444",
      borderRadius: "8px",
      padding: "4px",
      boxShadow: "0 4px 16px rgba(0,0,0,0.6)",
      filter: "none",
    });
    root.title = "Click or press Escape to dismiss";
    root.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.__nrOverlay.hide();
    });
    imgEl = document.createElement("img");
    Object.assign(imgEl.style, {
      display: "block",
      width: `${OVERLAY_WIDTH_PX}px`,
      height: "auto",
      borderRadius: "4px",
    });
    root.appendChild(imgEl);
    document.documentElement.appendChild(root);
    return root;
  }

  function position(anchor) {
    const ow = root.offsetWidth || OVERLAY_WIDTH_PX + 8;
    const oh = root.offsetHeight || Math.round(OVERLAY_WIDTH_PX / 0.715) + 8;
    const margin = 8;
    // Accept either a DOMRect-ish ({left,right,top,bottom}) or a point ({x,y}).
    const right = anchor.right ?? anchor.x ?? 0;
    const left = anchor.left ?? anchor.x ?? 0;
    const top = anchor.top ?? anchor.y ?? 0;
    let x = right + margin;
    if (x + ow > window.innerWidth - margin) x = left - ow - margin;
    if (x < margin) x = margin;
    let y = top;
    if (y + oh > window.innerHeight - margin) y = Math.max(margin, window.innerHeight - oh - margin);
    root.style.left = `${x}px`;
    root.style.top = `${y}px`;
  }

  window.__nrOverlay = {
    width: OVERLAY_WIDTH_PX,
    show(card, anchor) {
      const o = ensure();
      if (imgEl.src !== card.imageUrl) {
        imgEl.src = card.imageUrl;
        imgEl.alt = card.title;
      }
      o.style.display = "block";
      position(anchor);
    },
    hide() {
      if (root) root.style.display = "none";
    },
  };

  window.addEventListener("scroll", () => window.__nrOverlay.hide(), true);
  window.addEventListener("resize", () => window.__nrOverlay.hide());
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && root && root.style.display !== "none") {
        e.preventDefault();
        e.stopPropagation();
        window.__nrOverlay.hide();
      }
    },
    true,
  );
})();
