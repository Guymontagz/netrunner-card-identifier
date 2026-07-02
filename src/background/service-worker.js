const OFFSCREEN_IDLE_ALARM = "offscreen-idle-check";
const OFFSCREEN_URL = "src/offscreen/index.html";
const OFFSCREEN_IDLE_MS = 5 * 60 * 1000;
const TAG = "[netrunner-bg]";

// --- offscreen lifecycle ------------------------------------------------
let offscreenLastUsedAt = 0;

async function hasOffscreen() {
  if (typeof chrome.offscreen?.hasDocument === "function") {
    return chrome.offscreen.hasDocument();
  }
  // Fallback for very early MV3 stubs that lacked hasDocument().
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  return contexts.length > 0;
}

async function ensureOffscreen() {
  offscreenLastUsedAt = Date.now();
  if (await hasOffscreen()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ["BLOBS"],
    justification: "Run ONNX (WASM) inference for in-video card identification.",
  });
  console.log(TAG, "offscreen document created");
}

async function closeOffscreenIfIdle() {
  if (!(await hasOffscreen())) return;
  if (Date.now() - offscreenLastUsedAt < OFFSCREEN_IDLE_MS) return;
  await chrome.offscreen.closeDocument();
  console.log(TAG, "offscreen closed (idle)");
}

chrome.runtime.onInstalled.addListener(() => {
  console.log(TAG, "onInstalled — scheduling offscreen idle check");
  chrome.alarms.create(OFFSCREEN_IDLE_ALARM, { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === OFFSCREEN_IDLE_ALARM) {
    closeOffscreenIfIdle().catch((err) => console.warn(TAG, "idle close failed:", err));
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "nr-identify") {
    // Relay identify requests from content scripts to the offscreen ML host.
    (async () => {
      try {
        await ensureOffscreen();
        offscreenLastUsedAt = Date.now();
        const r = await chrome.runtime.sendMessage({
          type: "nr-offscreen-identify",
          imageData: msg.imageData,
        });
        sendResponse(r ?? { ok: false, error: "offscreen no response" });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message ?? err) });
      }
    })();
    return true;
  }
  if (msg?.type === "nr-ping-offscreen") {
    (async () => {
      try {
        await ensureOffscreen();
        const r = await chrome.runtime.sendMessage({ type: "nr-offscreen-ping" });
        sendResponse(r ?? { ok: false, error: "offscreen no response" });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message ?? err) });
      }
    })();
    return true;
  }
  return false;
});

