// A short-lived cache for the dashboard, which is the hottest read on the site.
//
// Two layers, and they do different jobs:
//   1. This in-process store spares Cosmos DB when one Function instance is
//      handling a burst of identical requests.
//   2. The Cache-Control header lets the Static Web Apps edge and the browser
//      answer repeat requests without reaching the API at all.
//
// The list is dropped whenever a video is created, so a new upload shows up
// immediately rather than after the window expires.
const TTL_SECONDS = Number(process.env.LIST_CACHE_SECONDS || 20);
const MAX_KEYS = 32;

const store = new Map();

function get(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expires <= Date.now()) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

function set(key, value, ttlSeconds = TTL_SECONDS) {
  const now = Date.now();
  for (const [k, v] of store) {
    if (v.expires <= now) store.delete(k);
  }
  if (store.size >= MAX_KEYS) {
    const oldest = [...store.entries()].sort((a, b) => a[1].expires - b[1].expires)[0];
    if (oldest) store.delete(oldest[0]);
  }
  store.set(key, { value, expires: now + ttlSeconds * 1000 });
}

function drop(prefix) {
  for (const key of [...store.keys()]) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

// Applied to responses that are safe to hold at the edge for a moment.
function publicFor(seconds = TTL_SECONDS) {
  return `public, max-age=${seconds}`;
}

module.exports = { get, set, drop, publicFor, TTL_SECONDS, _store: store };
