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
// Upscale small dragged regions before OCR so Tesseract has at least a few
// hundred pixels of width to work with — small text is its weak spot.
const OCR_MIN_WIDTH = 300;

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

// Cosine similarity against every catalog row, deduped by cardId — the
// returned top-k contains k *distinct* cards (highest-scoring orientation /
// printing per card). Without this, margin checks misfire when two
// near-identical entries of the same card both land at the top.
function topMatches(query, k = 5) {
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
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(({ score, row }) => ({ score, ...rows[row] }));
}

// --- OCR helpers --------------------------------------------------------

async function runOcr(image) {
  const worker = await loadTesseract();
  const src = decodeImage(image);
  // Upscale small drags so Tesseract has enough pixels per character.
  const scale = Math.max(1, OCR_MIN_WIDTH / image.width);
  const tw = Math.round(image.width * scale);
  const th = Math.round(image.height * scale);
  const canvas = new OffscreenCanvas(tw, th);
  const ctx = canvas.getContext("2d");
  const srcCanvas = new OffscreenCanvas(image.width, image.height);
  srcCanvas.getContext("2d").putImageData(src, 0, 0);
  ctx.drawImage(srcCanvas, 0, 0, tw, th);
  try {
    const { data } = await worker.recognize(canvas);
    return (data?.text || "").replace(/\s+/g, " ").trim();
  } catch (err) {
    console.warn(TAG, "OCR recognize failed:", err);
    return "";
  }
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

// Best similarity between any window of the OCR text and the given title.
// Returns 0..1 where 1.0 = title appears cleanly in the OCR text.
function titleSimilarity(ocr, title) {
  const o = normTitle(ocr);
  const t = normTitle(title);
  if (!o || !t) return 0;
  if (o.includes(t)) return 1.0;
  // Slide a window of size t.length over o and find the best Levenshtein.
  if (t.length > o.length) {
    const d = levenshtein(o, t);
    return Math.max(0, 1 - d / Math.max(o.length, t.length));
  }
  let best = 0;
  for (let i = 0; i <= o.length - t.length; i++) {
    const window = o.slice(i, i + t.length);
    const d = levenshtein(window, t);
    const sim = 1 - d / t.length;
    if (sim > best) best = sim;
    if (best === 1) break;
  }
  return best;
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

  const top5 = topMatches(query, 5);
  const best = top5[0];
  const margin = top5[1] ? best.score - top5[1].score : Infinity;
  const visuallyConfident = best.score >= OCR_TRIGGER_COS_MAX && margin >= OCR_TRIGGER_MARGIN;

  if (visuallyConfident) {
    return { top: top5.slice(0, 3), inferenceMs, ocrText: null };
  }

  // Visual alone is ambiguous — ask OCR for a tiebreaker.
  let ocrText = "";
  let ocrMs = 0;
  try {
    const ocrStart = performance.now();
    ocrText = await runOcr(image);
    ocrMs = (performance.now() - ocrStart) | 0;
  } catch (err) {
    console.warn(TAG, "OCR fallback skipped:", err && (err.message || err));
  }

  if (!ocrText) {
    return { top: top5.slice(0, 3), inferenceMs, ocrText: null, ocrMs };
  }

  const rescored = top5.map((c) => {
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
