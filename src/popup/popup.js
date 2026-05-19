import { getState } from "../lib/cardDB.js";

const REPO_URL = "https://github.com/Guymontagz/netrunner-card-identifier";

const el = {
  pool: document.getElementById("pool"),
  count: document.getElementById("count"),
  last: document.getElementById("last"),
  sync: document.getElementById("sync"),
  status: document.getElementById("status"),
  about: document.getElementById("about-link"),
};

function formatTime(ms) {
  if (!ms) return "never";
  const d = new Date(ms);
  return d.toLocaleString();
}

async function render() {
  const s = await getState();
  el.pool.textContent = s.cardPoolId ?? "—";
  el.count.textContent = String(s.cards.length);
  el.last.textContent = formatTime(s.lastSyncTime);
}

function setStatus(text, isError = false) {
  el.status.textContent = text;
  el.status.classList.toggle("err", isError);
}

el.sync.addEventListener("click", async () => {
  el.sync.disabled = true;
  setStatus("Syncing…");
  try {
    const r = await chrome.runtime.sendMessage({ type: "sync-now" });
    if (!r?.ok) throw new Error(r?.error ?? "unknown error");
    setStatus(`Synced ${r.cardCount} cards.`);
    await render();
  } catch (err) {
    setStatus(`Sync failed: ${err.message ?? err}`, true);
  } finally {
    el.sync.disabled = false;
  }
});

el.about.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: REPO_URL });
});

render();
