// Offscreen ML inference host. Loaded by the background service worker on
// demand. Runs in the extension's origin so we can spawn Workers freely;
// content scripts can't do this because the host page's CSP and
// same-origin-Worker rules apply to them.
//
// Pipeline per identify request:
//   1. Preprocess the dragged region + run the Milo embedder (ONNX/WASM).
//   2. Cosine similarity against the catalog → top-5 by best-per-card.
//   3. If top-1 is visually confident (cosine ≥ 0.7 AND margin ≥ 0.1),
//      ship the top-3 as-is.
//   4. Otherwise run Tesseract OCR on the source image, fuzzy-match the
//      extracted text against each top-5 candidate's title, re-rank by
//      combined visual+title score.
//
// Tesseract loads lazily on first ambiguous match — most cardboard webcam
// identifications hit the confident path and skip OCR entirely.
//
// Message protocol (chrome.runtime):
//   { type: "nr-offscreen-ping" }
//     → { ok, ready, rows }
//   { type: "nr-offscreen-identify",
//     imageData: { width, height, dataB64: <base64 RGBA> } }
//     → { ok, top: [{ cardId, title, type, orient, score, ... }], ocrText? }

import * as ort from "../vendor/ort/ort.min.mjs";

const TAG = "[netrunner-offscreen]";

const MODEL_URL = chrome.runtime.getURL("src/model/embedder.onnx");
const CATALOG_BIN_URL = chrome.runtime.getURL("src/model/catalog.bin");
const CATALOG_JSON_URL = chrome.runtime.getURL("src/model/catalog.json");
const ORT_WASM_DIR = chrome.runtime.getURL("src/vendor/ort/");
const TESS_DIR = chrome.runtime.getURL("src/vendor/tesseract/");

ort.env.wasm.wasmPaths = ORT_WASM_DIR;
ort.env.wasm.numThreads = 1;
ort.env.wasm.simd = true;

const INPUT_SIZE = 448;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

// OCR trigger gates: skip OCR when visual is already confident.
const OCR_TRIGGER_COS_MAX = 0.7;
const OCR_TRIGGER_MARGIN = 0.1;
// Weight applied to the [0,1] title similarity when combining with cosine.
// 0.4 means a perfect title match can overcome a 0.4-cosine visual deficit.
const OCR_WEIGHT = 0.4;
// Upscale small dragged regions before OCR. Title text in a 100-px crop is
// only ~5 px tall at native; we need at least ~25 px for Tesseract to read
// reliably, so the upscale target has to be roughly card-height × 5.
const OCR_MIN_WIDTH = 500;

const state = {
  ready: false,
  initError: null,
  session: null,
  inputName: null,
  outputName: null,
  catalog: null,
  rows: null,
  dim: 0,
};
/** @type {Promise<void>|null} */
let initPromise = null;
/** @type {Promise<any>|null} */
let tesseractPromise = null;

async function fetchBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} failed: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function init() {
  try {
    console.log(TAG, "init: fetching model + catalog");
    const t0 = performance.now();
    const [modelBytes, catalogBytes, catalogMetaRaw] = await Promise.all([
      fetchBytes(MODEL_URL),
      fetchBytes(CATALOG_BIN_URL),
      fetch(CATALOG_JSON_URL).then((r) => r.text()),
    ]);
    const catalogMeta = JSON.parse(catalogMetaRaw);
    state.rows = catalogMeta.rows;
    state.dim = catalogMeta.dim;
    state.catalog = new Float32Array(
      catalogBytes.buffer,
      catalogBytes.byteOffset,
      catalogBytes.byteLength / 4,
    );
    if (state.catalog.length !== state.rows.length * state.dim) {
      throw new Error(
        `catalog size mismatch: ${state.catalog.length} floats vs ${state.rows.length}*${state.dim}`,
      );
    }
    state.session = await ort.InferenceSession.create(modelBytes, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });
    state.inputName = state.session.inputNames[0];
    state.outputName = state.session.outputNames[0];
    state.ready = true;
    console.log(
      TAG,
      `ready: ${state.rows.length} catalog rows, dim ${state.dim}, init ${(performance.now() - t0) | 0}ms`,
    );
  } catch (err) {
    state.initError = err;
    state.ready = false;
    console.error(TAG, "init failed:", err && (err.stack || err.message || err));
    throw err;
  }
}

function ensureInit() {
  if (!initPromise) initPromise = init();
  return initPromise;
}

async function loadTesseract() {
  if (tesseractPromise) return tesseractPromise;
  tesseractPromise = (async () => {
    console.log(TAG, "loading Tesseract worker…");
    const t0 = performance.now();
    const ts = await import(`${TESS_DIR}tesseract.esm.min.js`);
    const createWorker = (ts.default && ts.default.createWorker) || ts.createWorker;
    if (typeof createWorker !== "function") {
      throw new Error(`Tesseract did not expose createWorker (got: ${Object.keys(ts).join(",")})`);
    }
    const worker = await createWorker("eng", 1, {
      workerPath: `${TESS_DIR}worker.min.js`,
      corePath: TESS_DIR,
      langPath: TESS_DIR,
      cacheMethod: "none",
      // Don't wrap workerPath in a blob URL. The blob's origin would be the
      // offscreen page's origin, but importScripts of chrome-extension URLs
      // from inside that blob worker fails as cross-origin. Loading the
      // worker directly from chrome-extension:// keeps everything in the
      // same origin.
      workerBlobURL: false,
    });
    // PSM 6 = treat the region as a single uniform block of text. Better
    // than the default for short card titles that span 1–2 lines.
    await worker.setParameters({ tessedit_pageseg_mode: "6" });
    console.log(TAG, `Tesseract ready in ${(performance.now() - t0) | 0} ms`);
    return worker;
  })().catch((err) => {
    tesseractPromise = null; // retry on next call
    throw err;
  });
  return tesseractPromise;
}

function decodeImage(image) {
  const binary = atob(image.dataB64);
  const bytes = new Uint8ClampedArray(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  if (bytes.length !== image.width * image.height * 4) {
    throw new Error(
      `imageData size mismatch: bytes=${bytes.length} expected=${image.width * image.height * 4}`,
    );
  }
  return new ImageData(bytes, image.width, image.height);
}

function preprocess(image) {
  const src = decodeImage(image);
  const canvas = new OffscreenCanvas(INPUT_SIZE, INPUT_SIZE);
  const ctx = canvas.getContext("2d");
  const srcCanvas = new OffscreenCanvas(image.width, image.height);
  srcCanvas.getContext("2d").putImageData(src, 0, 0);
  ctx.drawImage(srcCanvas, 0, 0, INPUT_SIZE, INPUT_SIZE);
  const data = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data;
  const size = INPUT_SIZE * INPUT_SIZE;
  const out = new Float32Array(3 * size);
  for (let i = 0; i < size; i++) {
    const r = data[i * 4] / 255;
    const g = data[i * 4 + 1] / 255;
    const b = data[i * 4 + 2] / 255;
    out[i] = (r - MEAN[0]) / STD[0];
    out[i + size] = (g - MEAN[1]) / STD[1];
    out[i + 2 * size] = (b - MEAN[2]) / STD[2];
  }
  return out;
}

function l2Normalize(vec) {
  let n = 0;
  for (let i = 0; i < vec.length; i++) n += vec[i] * vec[i];
  n = Math.sqrt(n);
  if (n === 0) return vec;
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / n;
  return out;
}

// Cosine similarity against every catalog row, deduped by cardId — returns
// a per-card best score (one row per distinct card). Caller sorts and
// slices as needed.
function scoreAllCards(query) {
  const { catalog, rows, dim } = state;
  const bestByCard = new Map();
  for (let r = 0; r < rows.length; r++) {
    const base = r * dim;
    let s = 0;
    for (let i = 0; i < dim; i++) s += query[i] * catalog[base + i];
    const cardId = rows[r].cardId;
    const prev = bestByCard.get(cardId);
    if (!prev || s > prev.score) {
      bestByCard.set(cardId, { score: s, row: r });
    }
  }
  return [...bestByCard.values()]
    .map(({ score, row }) => ({ score, ...rows[row] }))
    .sort((a, b) => b.score - a.score);
}

// --- OCR helpers --------------------------------------------------------

function rotateCanvas(srcCanvas, srcW, srcH, angleDeg) {
  if (angleDeg === 0) return srcCanvas;
  const rad = (angleDeg * Math.PI) / 180;
  const sin = Math.abs(Math.sin(rad));
  const cos = Math.abs(Math.cos(rad));
  const newW = Math.ceil(srcW * cos + srcH * sin);
  const newH = Math.ceil(srcW * sin + srcH * cos);
  const dst = new OffscreenCanvas(newW, newH);
  const ctx = dst.getContext("2d");
  ctx.translate(newW / 2, newH / 2);
  ctx.rotate(rad);
  ctx.drawImage(srcCanvas, -srcW / 2, -srcH / 2);
  return dst;
}

function upscaleCanvas(src, minWidth) {
  const scale = Math.max(1, minWidth / src.width);
  if (scale === 1) return src;
  const tw = Math.round(src.width * scale);
  const th = Math.round(src.height * scale);
  const dst = new OffscreenCanvas(tw, th);
  dst.getContext("2d").drawImage(src, 0, 0, tw, th);
  return dst;
}

// Crop the top (or bottom) strip of a canvas — title bars on Netrunner
// cards sit in the top ~25-30% of the displayed area, and OCR is much
// more reliable on just the title text than the whole card (no card
// art, no text panel, no counter overlays competing for Tesseract's
// segmenter). We pull 40% to give the title some cushion when the drag
// rectangle includes a few pixels above the card or the title bar is
// taller than typical (rare but it happens).
function stripCanvas(src, fromBottom = false, fraction = 0.4) {
  const sw = src.width;
  const sh = Math.max(1, Math.round(src.height * fraction));
  const sy = fromBottom ? src.height - sh : 0;
  const dst = new OffscreenCanvas(sw, sh);
  dst.getContext("2d").drawImage(src, 0, sy, sw, sh, 0, 0, sw, sh);
  return dst;
}

// Threshold-binarize a canvas: anything brighter than `threshold` becomes
// pure white, everything else pure black. Netrunner card titles are
// bright white on dark backgrounds, so this isolates the title text
// cleanly and removes the bilinear-upscale blur that confuses Tesseract's
// character segmenter at small sizes.
function binarizeCanvas(src, threshold = 170) {
  const ctx = src.getContext("2d");
  const img = ctx.getImageData(0, 0, src.width, src.height);
  const px = img.data;
  for (let i = 0; i < px.length; i += 4) {
    const luma = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0;
    const v = luma > threshold ? 255 : 0;
    px[i] = v;
    px[i + 1] = v;
    px[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return src;
}

async function runOcr(image) {
  const worker = await loadTesseract();
  const src = decodeImage(image);
  const srcCanvas = new OffscreenCanvas(image.width, image.height);
  srcCanvas.getContext("2d").putImageData(src, 0, 0);

  // Compute OCR inputs:
  //   - Portrait crop: title is at the top → one pass on the top strip.
  //   - Landscape crop: could be (a) installed ICE on player side, title
  //     was on the left edge → -90° rotation puts it at the top, take top
  //     strip; (b) opponent side, title was on right → +90° rotation puts
  //     it at the BOTTOM, take bottom strip; (c) horizontal slice of a
  //     portrait card → title already at the top of the 0° image. Three
  //     passes cover all three.
  // Cropping to just the title strip (≈ top 30% of the displayed card)
  // before upscaling means the title text ends up much larger relative
  // to the OCR input, which is what Tesseract needs.
  const isLandscape = image.width > image.height * 1.1;
  const passes = isLandscape
    ? [
        { angle: 0, fromBottom: false },
        { angle: -90, fromBottom: false },
        { angle: 90, fromBottom: true },
      ]
    : [{ angle: 0, fromBottom: false }];

  const texts = [];
  for (const { angle, fromBottom } of passes) {
    const rotated = rotateCanvas(srcCanvas, image.width, image.height, angle);
    const strip = stripCanvas(rotated, fromBottom);
    const scaled = upscaleCanvas(strip, OCR_MIN_WIDTH);
    binarizeCanvas(scaled);
    try {
      const { data } = await worker.recognize(scaled);
      const text = (data?.text || "").replace(/\s+/g, " ").trim();
      if (text) texts.push(text);
    } catch (err) {
      console.warn(TAG, `OCR recognize (angle=${angle}) failed:`, err && (err.message || err));
    }
  }
  return texts.join(" ");
}

function normTitle(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const n = a.length;
  const m = b.length;
  let prev = new Array(m + 1);
  let curr = new Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= m; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      const del = prev[j] + 1;
      const ins = curr[j - 1] + 1;
      const sub = prev[j - 1] + cost;
      curr[j] = del < ins ? (del < sub ? del : sub) : ins < sub ? ins : sub;
    }
    const t = prev; prev = curr; curr = t;
  }
  return prev[m];
}

// Word-based similarity. Tokenize both strings, score each title word by
// its best-matching OCR word (Levenshtein ratio), weight by title-word
// length. Length weighting means "Knowledge" matters more than "of", so
// false positives from short common words like "of" or "the" don't
// inflate scores. Per-word threshold (0.6) also rules out random
// 3-char coincidences while letting partial reads like "knowled" match
// "knowledge" (sim ~0.78).
function wordSimilarity(a, b) {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const d = levenshtein(a, b);
  return Math.max(0, 1 - d / Math.max(a.length, b.length));
}

function tokenize(s) {
  return normTitle(s)
    .split(/\s+/)
    .filter((w) => w.length >= 3);
}

function titleSimilarity(ocrText, title) {
  const titleNorm = normTitle(title);
  const ocrNorm = normTitle(ocrText);
  if (!titleNorm || !ocrNorm) return 0;

  // Strips: all letters/digits concatenated, no spaces. These don't honor
  // the >= 3 word filter, because short fragments like "DZ" + "MZ" are
  // sometimes Tesseract's split of a single title fragment ("DZMZ") and
  // are real signal.
  const titleStripped = titleNorm.replace(/\s+/g, "");
  const ocrStripped = ocrNorm.replace(/\s+/g, "");
  if (!titleStripped || !ocrStripped) return 0;

  // Direction A: OCR captured the whole title (with or without spaces).
  // Guard against short titles like "Owl" (3 chars) accidentally
  // matching inside a longer OCR string.
  if (titleStripped.length >= 6 && ocrStripped.includes(titleStripped)) {
    return 1.0;
  }
  // Direction B: OCR captured a clean *prefix or substring* of the title
  // — common when Tesseract truncates the last word ("DZ MZ Optim" of
  // "DZMZ Optimizer"). Score proportional to coverage, with a 5-char
  // minimum on the OCR side to avoid spurious tiny matches.
  if (ocrStripped.length >= 5 && titleStripped.includes(ocrStripped)) {
    return ocrStripped.length / titleStripped.length;
  }

  // Word-based fallback. Filter both sides to words >= 3 chars here so
  // common short words ('of', 'in') don't inflate the weighted score.
  const titleWords = titleNorm.split(/\s+/).filter((w) => w.length >= 3);
  if (titleWords.length === 0) return 0;
  const ocrWords = ocrNorm.split(/\s+/).filter((w) => w.length >= 3);
  if (ocrWords.length === 0) return 0;

  let weighted = 0;
  let total = 0;
  for (const tw of titleWords) {
    total += tw.length;
    let best = 0;
    for (const ow of ocrWords) {
      const sim = wordSimilarity(ow, tw);
      if (sim >= 0.6 && sim > best) best = sim;
    }
    weighted += tw.length * best;
  }
  return weighted / total;
}

async function identify(image) {
  if (!state.ready) throw new Error("offscreen not ready");
  const tensorData = preprocess(image);
  const tensor = new ort.Tensor("float32", tensorData, [1, 3, INPUT_SIZE, INPUT_SIZE]);
  const t0 = performance.now();
  const out = await state.session.run({ [state.inputName]: tensor });
  const inferenceMs = (performance.now() - t0) | 0;
  const raw = out[state.outputName].data;
  const query = l2Normalize(new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4));

  // Score every distinct card. We need the full ranking so OCR can rescue
  // candidates the visual ranker buried — jinteki's custom installed-ICE
  // layout (title + side art panel + counter overlays) doesn't match our
  // catalog's rotated-portrait J variants, so the correct ICE can land
  // well outside visual top-20 even when OCR clearly reads its name.
  const allCards = scoreAllCards(query);
  const best = allCards[0];
  const margin = allCards[1] ? best.score - allCards[1].score : Infinity;
  const visuallyConfident = best.score >= OCR_TRIGGER_COS_MAX && margin >= OCR_TRIGGER_MARGIN;

  if (visuallyConfident) {
    return { top: allCards.slice(0, 3), inferenceMs, ocrText: null };
  }

  // Visual alone is ambiguous — ask OCR for a tiebreaker.
  let ocrText = "";
  let ocrMs = 0;
  let ocrError = null;
  try {
    const ocrStart = performance.now();
    ocrText = await runOcr(image);
    ocrMs = (performance.now() - ocrStart) | 0;
  } catch (err) {
    ocrError = String(err && (err.stack || err.message || err)).slice(0, 300);
    console.warn(TAG, "OCR fallback skipped:", err && (err.message || err));
  }

  if (!ocrText) {
    return { top: allCards.slice(0, 3), inferenceMs, ocrText: null, ocrMs, ocrError };
  }

  // Re-rank EVERY card by combined visual + title similarity. A clean
  // title read (Tesseract returned "Knowledge Seeker" verbatim) drives
  // titleScore to 1.0 and overrides the visual ranker; that's the right
  // call when OCR has high confidence. titleSimilarity's word-based
  // matching keeps the false-positive rate low for noisy OCR.
  const rescored = allCards.map((c) => {
    const ts = titleSimilarity(ocrText, c.title);
    return {
      ...c,
      visualScore: c.score,
      titleScore: ts,
      score: c.score + OCR_WEIGHT * ts,
    };
  });
  rescored.sort((a, b) => b.score - a.score);
  return { top: rescored.slice(0, 3), inferenceMs, ocrText, ocrMs };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "nr-offscreen-ping") {
    sendResponse({ ok: true, ready: state.ready, rows: state.rows?.length ?? 0 });
    return false;
  }
  if (msg?.type === "nr-offscreen-identify") {
    (async () => {
      try {
        await ensureInit();
        const result = await identify(msg.imageData);
        sendResponse({ ok: true, ...result });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message ?? err) });
      }
    })();
    return true;
  }
  return false;
});

ensureInit();
