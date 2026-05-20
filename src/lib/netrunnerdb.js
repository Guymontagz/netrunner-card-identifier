// NetrunnerDB v3 API client.
//
// We sync the "eternal" card pool, which contains every Netrunner card ever
// printed (FFG era through Null Signal era). The match catalog the
// extension ships with is also built from eternal, so hover-on-<img> and
// click-on-video share a card universe.

const BASE = "https://api-preview.netrunnerdb.com/api/v3/public";
const IMAGE_BASE = "https://card-images.netrunnerdb.com/v2/large";
const POOL_ID = "eternal";

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`NetrunnerDB ${res.status} ${res.statusText} for ${url}`);
  }
  return res.json();
}

export async function fetchActiveStandardPoolId() {
  // Name kept for compatibility with existing callers, but we now resolve
  // to the eternal pool so the synced cards cover everything the catalog
  // can identify, not just current Standard.
  return POOL_ID;
}

export async function fetchCardsInPool(poolId) {
  const url = `${BASE}/cards?filter[card_pool_id]=${encodeURIComponent(poolId)}&page[size]=3000`;
  const body = await fetchJson(url);
  const expected = body?.meta?.stats?.total?.count;
  const cards = (body?.data ?? []).map(normalizeCard);
  if (typeof expected === "number" && cards.length !== expected) {
    // Eternal currently fits in one page (~2000 cards). If it ever paginates
    // we want to fail loud rather than silently store a partial catalog.
    throw new Error(`paginated result: got ${cards.length} of ${expected} cards`);
  }
  return cards;
}

function normalizeCard(node) {
  const a = node.attributes ?? {};
  const printingId = a.printing_ids?.[0] ?? null;
  return {
    id: node.id,
    title: a.title,
    side: a.side_id,
    faction: a.faction_id,
    type: a.card_type_id,
    text: a.text,
    printingIds: a.printing_ids ?? [],
    imageUrl: printingId ? `${IMAGE_BASE}/${printingId}.jpg` : null,
  };
}
