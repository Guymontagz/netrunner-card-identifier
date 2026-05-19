import { fetchActiveStandardPoolId, fetchCardsInPool } from "../lib/netrunnerdb.js";
import { getState, saveSync } from "../lib/cardDB.js";

const TAG = "[netrunner-sync]";

export async function syncStandardPool() {
  const poolId = await fetchActiveStandardPoolId();
  const cards = await fetchCardsInPool(poolId);
  await saveSync({ cardPoolId: poolId, cards });
  console.log(TAG, `synced ${cards.length} cards from pool ${poolId}`);
  return { cardPoolId: poolId, cardCount: cards.length };
}

export async function syncIfStale({ maxAgeMs = 7 * 24 * 60 * 60 * 1000, force = false } = {}) {
  const state = await getState();
  const age = state.lastSyncTime ? Date.now() - state.lastSyncTime : Infinity;
  if (!force && state.cards.length > 0 && age < maxAgeMs) {
    return { ...state, skipped: true };
  }
  const result = await syncStandardPool();
  return { ...(await getState()), ...result, skipped: false };
}
