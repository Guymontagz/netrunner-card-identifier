// chrome.storage.local wrapper for the Standard card pool.
//
// Storage layout:
//   cardPoolId   string         active card-pool ID at last successful sync
//   lastSyncTime number         ms epoch of last successful sync
//   cards        Card[]         normalized cards from netrunnerdb.js
//
// chrome.storage.local quota is 10MB and 613 cards run ~1MB, so we keep the
// full array in one key. If the pool ever grows past a few MB we'll need to
// shard, but that's far off.

const KEYS = {
  poolId: "cardPoolId",
  lastSync: "lastSyncTime",
  cards: "cards",
};

export async function getState() {
  const v = await chrome.storage.local.get([KEYS.poolId, KEYS.lastSync, KEYS.cards]);
  return {
    cardPoolId: v[KEYS.poolId] ?? null,
    lastSyncTime: v[KEYS.lastSync] ?? null,
    cards: v[KEYS.cards] ?? [],
  };
}

export async function saveSync({ cardPoolId, cards }) {
  await chrome.storage.local.set({
    [KEYS.poolId]: cardPoolId,
    [KEYS.cards]: cards,
    [KEYS.lastSync]: Date.now(),
  });
}

export async function findByPrintingId(printingId) {
  const { cards } = await getState();
  return cards.find((c) => c.printingIds.includes(String(printingId))) ?? null;
}
