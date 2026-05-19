// Offscreen ML inference host. Loaded by the background service worker on
// demand. Runs in the extension's origin so we can spawn Workers freely;
// content scripts can't do this because the host page's CSP and
// same-origin-Worker rules apply to them.
//
// Message protocol (chrome.runtime):
//   { type: "nr-offscreen-ping" }
//     → { ok, ready, rows }
//   { type: "nr-offscreen-identify",
//     imageData: { width, height, buffer: ArrayBuffer (RGBA Uint8) } }
//     → { ok, top: [{ cardId, title, type, orient, score, imageUrl, printingId }] }

import * as ort from "../vendor/ort/ort.min.mjs";

const TAG = "[netrunner-offscreen]";

const MODEL_URL = chrome.runtime.getURL("src/model/embedder.onnx");
const CATALOG_BIN_URL = chrome.runtime.getURL("src/model/catalog.bin");
const CATALOG_JSON_URL = chrome.runtime.getURL("src/model/catalog.json");
const ORT_WASM_DIR = chrome.runtime.getURL("src/vendor/ort/");

// Point ORT at our local WASM files so it doesn't try to fetch from a CDN.
ort.env.wasm.wasmPaths = ORT_WASM_DIR;
// We don't have cross-origin isolation (SharedArrayBuffer); use 1 thread.
ort.env.wasm.numThreads = 1;
// Don't try WebGPU (jsep) — keep things CPU-only for predictability.
ort.env.wasm.simd = true;

const INPUT_SIZE = 448;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

const state = {
  ready: false,
  initError: null,
  session: null,
  inputName: null,
  outputName: null,
  catalog: null, // Float32Array (rows * dim)
  rows: null, // [{ cardId, title, type, orient, imageUrl, printingId }]
  dim: 0,
};
/** @type {Promise<void>|null} */
let initPromise = null;

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

// Convert an ImageData-like message payload to a normalised CHW float32
// tensor sized INPUT_SIZE × INPUT_SIZE. The wire format is base64 because
// Chrome's MV3 sendMessage serializer can demote typed arrays through the
// service-worker relay.
function preprocess(image) {
  if (!image?.dataB64) {
    throw new Error(`bad imageData: keys=${Object.keys(image ?? {}).join(",")}`);
  }
  const binary = atob(image.dataB64);
  const bytes = new Uint8ClampedArray(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  if (bytes.length !== image.width * image.height * 4) {
    throw new Error(
      `imageData size mismatch: bytes=${bytes.length} expected=${image.width * image.height * 4}`,
    );
  }
  const src = new ImageData(bytes, image.width, image.height);
  // Step 1: draw source into a 448x448 canvas (browser handles resampling).
  const canvas = new OffscreenCanvas(INPUT_SIZE, INPUT_SIZE);
  const ctx = canvas.getContext("2d");
  // Source canvas to hold the input ImageData so we can use drawImage to resize.
  const srcCanvas = new OffscreenCanvas(image.width, image.height);
  srcCanvas.getContext("2d").putImageData(src, 0, 0);
  ctx.drawImage(srcCanvas, 0, 0, INPUT_SIZE, INPUT_SIZE);
  const data = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data;

  // Step 2: normalize + transpose HWC RGBA → CHW RGB.
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

// Cosine similarity (since catalog rows + query are L2-normalised, this is
// just a dot product) against every catalog row. Deduped by cardId: when
// the same card appears under multiple printings or orientations, we keep
// the highest-scoring row so the top-k contains k *distinct* cards. Without
// this, margin checks misfire when two alt-art printings of the same card
// both land at the top with near-identical scores.
function topMatches(query, k = 3) {
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

async function identify(image) {
  if (!state.ready) throw new Error("offscreen not ready");
  const tensorData = preprocess(image);
  const tensor = new ort.Tensor("float32", tensorData, [1, 3, INPUT_SIZE, INPUT_SIZE]);
  const t0 = performance.now();
  const out = await state.session.run({ [state.inputName]: tensor });
  const inferenceMs = (performance.now() - t0) | 0;
  const raw = out[state.outputName].data;
  const query = l2Normalize(new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4));
  const top = topMatches(query, 3);
  return { top, inferenceMs };
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
        const { top, inferenceMs } = await identify(msg.imageData);
        sendResponse({ ok: true, top, inferenceMs });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message ?? err) });
      }
    })();
    return true;
  }
  return false;
});

ensureInit();
