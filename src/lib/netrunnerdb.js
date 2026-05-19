// NetrunnerDB v3 API client.
//
// Recipe for fetching the current Standard card pool:
//   1. GET /formats/standard → read attributes.active_card_pool_id
//   2. GET /cards?filter[card_pool_id]={poolId} → all cards in that pool
//
// We use v3 (api-preview) rather than v2 because v3 models card pools and
// format rotation directly. The "preview" subdomain is the current public
// home for v3; if it migrates we change one constant.

const BASE = "https://api-preview.netrunnerdb.com/api/v3/public";
const IMAGE_BASE = "https://card-images.netrunnerdb.com/v2/large";

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`NetrunnerDB ${res.status} ${res.statusText} for ${url}`);
  }
  return res.json();
}

export async function fetchActiveStandardPoolId() {
  const body = await fetchJson(`${BASE}/formats/standard`);
  const poolId = body?.data?.attributes?.active_card_pool_id;
  if (!poolId) throw new Error("standard format response missing active_card_pool_id");
  return poolId;
}

export async function fetchCardsInPool(poolId) {
  const url = `${BASE}/cards?filter[card_pool_id]=${encodeURIComponent(poolId)}&page[size]=1000`;
  const body = await fetchJson(url);
  const expected = body?.meta?.stats?.total?.count;
  const cards = (body?.data ?? []).map(normalizeCard);
  if (typeof expected === "number" && cards.length !== expected) {
    // The pool is small enough that one page should hold everything. If this
    // ever trips we will need to add pagination — for now, fail loud rather
    // than silently store a partial DB.
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
