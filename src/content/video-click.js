// Drag-on-video card identification (ML embedder path).
//
// Trigger: Alt + mousedown on a <video>, drag a card-aspect rectangle,
// release. The dragged region is captured at the video's native resolution
// and sent to the background, which routes it to an offscreen document
// that runs the Milo ONNX embedder. The offscreen reply contains the top-3
// nearest catalog rows by cosine similarity.
//
// Hover-on-<img> (URL-based, in hover.js) is unchanged and unrelated.

(() => {
  const TAG = "[netrunner-video]";
  if (window.__nrVideoLoaded) return;
  window.__nrVideoLoaded = true;

  // Short/long ratio. Drag direction decides whether the long side is
  // vertical (portrait — most cards) or horizontal (ICE on jinteki).
  const CARD_ASPECT = 0.715;
  const MIN_DRAG_PX = 30;

  // Cosine thresholds for the embedder. With Milo's 128-d L2-normalised
  // output, self-match = 1.0 and nearest-non-self is ~0.5–0.6 in our
  // offline sanity check. Compressed video crops will pull the score down,
  // but the right card should still clearly beat noise.
  const COS_ABS = 0.6;
  const COS_MARGIN = 0.05;
  // Identity cards (landscape, with shared layout — name banner + portrait
  // art panel + abilities strip) cluster tighter in the embedder's feature
  // space than regular cards do. A correct identity match in video lands
  // around 0.55–0.65 with margins of 0.025–0.04, both under the regular
  // gates. Use a looser pair when the top-1 is an identity.
  const COS_ABS_IDENTITY = 0.5;
  const COS_MARGIN_IDENTITY = 0.025;
  const IDENTITY_TYPES = new Set(["corp_identity", "runner_identity"]);

  // --- drag state + selection rectangle UI -------------------------------
  let dragging = false;
  let anchorX = 0;
  let anchorY = 0;
  let anchorVideo = null;
  /** @type {DOMRect|null} */ let anchorVideoRect = null;
  /** @type {HTMLDivElement|null} */ let selEl = null;
  /** @type {HTMLDivElement|null} */ let statusEl = null;

  function videoAt(clientX, clientY) {
    const videos = document.querySelectorAll("video");
    for (const v of videos) {
      if (!v.videoWidth || !v.videoHeight) continue;
      const r = v.getBoundingClientRect();
      if (r.width < 50 || r.height < 50) continue;
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
        return { video: v, rect: r };
      }
    }
    return null;
  }

  function aspectRect(curX, curY) {
    const dx = curX - anchorX;
    const dy = curY - anchorY;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    let w, h;
    if (adx >= ady) {
      // Landscape (e.g. ICE on jinteki).
      w = adx;
      h = adx * CARD_ASPECT;
    } else {
      // Portrait (default).
      h = ady;
      w = ady * CARD_ASPECT;
    }
    const left = dx >= 0 ? anchorX : anchorX - w;
    const top = dy >= 0 ? anchorY : anchorY - h;
    return { left, top, w, h };
  }

  function ensureSelectionEl() {
    if (selEl) return selEl;
    selEl = document.createElement("div");
    selEl.setAttribute("data-netrunner-selection", "");
    Object.assign(selEl.style, {
      position: "fixed",
      zIndex: "2147483647",
      pointerEvents: "none",
      border: "2px solid rgba(145, 71, 255, 0.95)",
      background: "rgba(145, 71, 255, 0.08)",
      boxShadow: "0 0 0 1px rgba(0,0,0,0.4)",
      display: "none",
    });
    document.documentElement.appendChild(selEl);
    return selEl;
  }

  function ensureStatusEl() {
    if (statusEl) return statusEl;
    statusEl = document.createElement("div");
    statusEl.setAttribute("data-netrunner-status", "");
    Object.assign(statusEl.style, {
      position: "fixed",
      zIndex: "2147483647",
      pointerEvents: "none",
      background: "#1a1a1a",
      color: "#eaeaea",
      border: "1px solid #444",
      borderRadius: "6px",
      padding: "6px 10px",
      font: "12px/1 system-ui, sans-serif",
      display: "none",
      boxShadow: "0 2px 8px rgba(0,0,0,0.6)",
    });
    document.documentElement.appendChild(statusEl);
    return statusEl;
  }

  function showStatus(text, x, y) {
    const el = ensureStatusEl();
    el.textContent = text;
    el.style.left = `${x + 12}px`;
    el.style.top = `${y + 12}px`;
    el.style.display = "block";
  }
  function hideStatus() {
    if (statusEl) statusEl.style.display = "none";
  }

  function updateSelectionUI(curX, curY) {
    const r = aspectRect(curX, curY);
    const el = ensureSelectionEl();
    el.style.display = "block";
    el.style.left = `${r.left}px`;
    el.style.top = `${r.top}px`;
    el.style.width = `${r.w}px`;
    el.style.height = `${r.h}px`;
  }
  function clearSelectionUI() {
    if (selEl) selEl.style.display = "none";
  }
  function cancelDrag() {
    dragging = false;
    anchorVideo = null;
    anchorVideoRect = null;
    clearSelectionUI();
  }

  // Browser-safe base64 encoder for Uint8ClampedArray. Chunked because
  // String.fromCharCode.apply blows the call stack past ~100k args.
  function bytesToBase64(bytes) {
    const chunk = 0x8000;
    let s = "";
    for (let i = 0; i < bytes.length; i += chunk) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(s);
  }

  // Capture the selected region into an ImageData at video-native resolution.
  function captureRegion(video, sx, sy, sw, sh) {
    const w = Math.max(1, Math.round(sw));
    const h = Math.max(1, Math.round(sh));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  }

  function logTop3(top, region, vw, vh, inferenceMs) {
    const lines = [
      `region (${region.sx | 0}, ${region.sy | 0}) ${region.sw | 0}x${region.sh | 0} of ${vw}x${vh} video (inf ${inferenceMs}ms)`,
    ];
    for (let i = 0; i < top.length; i++) {
      const t = top[i];
      lines.push(
        `  ${i + 1}. ${t.title.padEnd(28).slice(0, 28)} cos=${t.score.toFixed(3)} ${t.orient} ${t.type ?? ""}`,
      );
    }
    console.log(TAG, lines.join("\n"));
  }

  async function finishDrag(curX, curY) {
    const r = aspectRect(curX, curY);
    clearSelectionUI();
    dragging = false;

    if (r.w < MIN_DRAG_PX || r.h < MIN_DRAG_PX) {
      anchorVideo = null;
      anchorVideoRect = null;
      return;
    }
    const video = anchorVideo;
    const vrect = anchorVideoRect;
    anchorVideo = null;
    anchorVideoRect = null;
    if (!video || !vrect) return;

    // Map screen rectangle to video pixel coordinates and clamp to frame.
    const scaleX = video.videoWidth / vrect.width;
    const scaleY = video.videoHeight / vrect.height;
    let sx = (r.left - vrect.left) * scaleX;
    let sy = (r.top - vrect.top) * scaleY;
    let sw = r.w * scaleX;
    let sh = r.h * scaleY;
    if (sx < 0) { sw += sx; sx = 0; }
    if (sy < 0) { sh += sy; sy = 0; }
    if (sx + sw > video.videoWidth) sw = video.videoWidth - sx;
    if (sy + sh > video.videoHeight) sh = video.videoHeight - sy;
    if (sw < 4 || sh < 4) {
      console.warn(TAG, "selection ended up outside video bounds");
      return;
    }

    let image;
    try {
      image = captureRegion(video, sx, sy, sw, sh);
    } catch (err) {
      console.error(TAG, "frame capture failed:", err);
      return;
    }

    showStatus("Identifying…", curX, curY);
    try {
      // Chrome's MV3 message serializer through the service-worker relay
      // demoted typed arrays to plain objects, so encode as base64. A 200×150
      // RGBA crop is ~160 KB of base64 — small enough to send unchunked.
      const response = await chrome.runtime.sendMessage({
        type: "nr-identify",
        imageData: {
          width: image.width,
          height: image.height,
          dataB64: bytesToBase64(image.data),
        },
      });
      hideStatus();
      if (!response?.ok) {
        console.warn(TAG, "identify failed:", response?.error ?? "no response");
        return;
      }
      const top = response.top ?? [];
      logTop3(top, { sx, sy, sw, sh }, video.videoWidth, video.videoHeight, response.inferenceMs ?? 0);
      if (top.length === 0) return;
      const best = top[0];
      const second = top[1];
      const margin = second ? best.score - second.score : Infinity;
      const isIdentity = IDENTITY_TYPES.has(best.type);
      const absGate = isIdentity ? COS_ABS_IDENTITY : COS_ABS;
      const marginGate = isIdentity ? COS_MARGIN_IDENTITY : COS_MARGIN;
      if (best.score < absGate) {
        console.warn(
          TAG,
          `no confident match — best cos ${best.score.toFixed(3)} < ${absGate}${isIdentity ? " (identity)" : ""}`,
        );
        return;
      }
      if (margin < marginGate) {
        console.warn(
          TAG,
          `ambiguous — best ${best.score.toFixed(3)} vs runner-up ${second.score.toFixed(3)} (margin ${margin.toFixed(3)} < ${marginGate}${isIdentity ? " identity" : ""})`,
        );
        return;
      }
      // Reshape into the card object that __nrOverlay expects.
      window.__nrOverlay.show(
        { title: best.title, imageUrl: best.imageUrl },
        { x: curX, y: curY },
      );
    } catch (err) {
      hideStatus();
      console.error(TAG, "identify error:", err && (err.stack || err.message || err));
    }
  }

  // --- event wiring -------------------------------------------------------
  document.addEventListener(
    "mousedown",
    (e) => {
      if (!e.altKey || e.button !== 0) return;
      const hit = videoAt(e.clientX, e.clientY);
      if (!hit) return;
      e.preventDefault();
      e.stopPropagation();
      dragging = true;
      anchorX = e.clientX;
      anchorY = e.clientY;
      anchorVideo = hit.video;
      anchorVideoRect = hit.rect;
    },
    true,
  );

  document.addEventListener(
    "mousemove",
    (e) => {
      if (!dragging) return;
      e.preventDefault();
      updateSelectionUI(e.clientX, e.clientY);
    },
    true,
  );

  document.addEventListener(
    "mouseup",
    (e) => {
      if (!dragging) return;
      e.preventDefault();
      e.stopPropagation();
      finishDrag(e.clientX, e.clientY);
    },
    true,
  );

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && dragging) cancelDrag();
  });

  console.log(TAG, `loaded on ${location.host} — hold Alt and drag a rectangle around a card on a video`);
})();
