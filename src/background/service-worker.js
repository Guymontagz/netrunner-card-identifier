import { syncIfStale, syncStandardPool } from "./cardSync.js";

const ALARM_NAME = "weekly-card-sync";
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

chrome.runtime.onInstalled.addListener(async () => {
  console.log(TAG, "onInstalled — scheduling weekly sync and triggering initial sync");
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 7 * 24 * 60 });
  chrome.alarms.create(OFFSCREEN_IDLE_ALARM, { periodInMinutes: 1 });
  try {
    const r = await syncIfStale();
    console.log(TAG, "initial sync:", r);
  } catch (err) {
    console.error(TAG, "initial sync failed:", err);
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    console.log(TAG, "weekly alarm fired");
    try {
      const r = await syncStandardPool();
      console.log(TAG, "weekly sync result:", r);
    } catch (err) {
      console.error(TAG, "weekly sync failed:", err);
    }
    return;
  }
  if (alarm.name === OFFSCREEN_IDLE_ALARM) {
    closeOffscreenIfIdle().catch((err) => console.warn(TAG, "idle close failed:", err));
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "sync-now") {
    (async () => {
      try {
        const r = await syncStandardPool();
        sendResponse({ ok: true, ...r });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message ?? err) });
      }
    })();
    return true;
  }
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

