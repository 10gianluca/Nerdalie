/* Plain-JS helpers for the Games/Collection page: fetching, CSV parsing, filtering and BGG lookups.
   No React here, so the pure logic (parseCsv, filterRows, ...) can be unit-tested with plain Node.

   Network calls go through this site's own Netlify functions (netlify/functions/bgg.js and
   sheet.js) rather than a public CORS-proxy: BGG's API now requires an Authorization header, which
   only a server-side hop can attach, and the Sheet CSV export sends no CORS header of its own. */

const FN_BASE = '/.netlify/functions';

async function callFn(path, params) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${FN_BASE}/${path}?${qs}`);
  const text = await res.text();
  if (!res.ok) throw new Error(text || `Request failed (${res.status})`);
  return text;
}

// ---------- Google Sheet ----------

// With `tab`, reads that named tab of the sheet instead of the first one.
export const fetchSheetCsv = (sheetLink, tab) => callFn('sheet', tab ? { link: sheetLink, tab } : { link: sheetLink });

export function parseCsv(text) {
  const rows = [];
  let i = 0;
  const n = text.length;
  let row = [];
  let field = '';
  let inQuotes = false;
  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (i + 1 < n && text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (c === '\n' || c === '\r') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      if (c === '\r' && text[i + 1] === '\n') i++;
      i++;
      continue;
    }
    field += c;
    i++;
  }
  row.push(field);
  rows.push(row);
  if (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') rows.pop();
  return rows;
}

const normalizeHeader = (h) => (h || '').trim().toLowerCase();

const HEADER_ALIASES = {
  game: 'GAME', title: 'GAME', name: 'GAME',
  year: 'YEAR', 'year published': 'YEAR',
  min: 'MIN', 'min players': 'MIN',
  max: 'MAX', 'max players': 'MAX',
  time: 'TIME', 'play time': 'TIME', playtime: 'TIME',
  type: 'TYPE',
  rating: 'BGG RATING', 'bgg rating': 'BGG RATING',
  image: 'IMAGE',
  bggid: 'BGGID', 'bgg id': 'BGGID',
};
export const CANONICAL = ['GAME', 'YEAR', 'MIN', 'MAX', 'TIME', 'TYPE', 'BGG RATING', 'IMAGE', 'BGGID'];

// Maps a canonical column name (GAME, YEAR, MIN, MAX, TIME, TYPE, BGG RATING, IMAGE, BGGID) to its
// index in `headers`, however the sheet actually spelled it, or -1 if the sheet doesn't have it.
export function buildHeaderIndex(headers) {
  const found = {};
  headers.forEach((h, i) => {
    const canon = HEADER_ALIASES[normalizeHeader(h)] || h.trim().toUpperCase();
    if (!(canon in found)) found[canon] = i;
  });
  const get = (name) => (name in found ? found[name] : -1);
  return { GAME: get('GAME'), YEAR: get('YEAR'), MIN: get('MIN'), MAX: get('MAX'), TIME: get('TIME'), TYPE: get('TYPE'), RATING: get('BGG RATING'), IMAGE: get('IMAGE'), BGGID: get('BGGID') };
}

// Header names the sheet has beyond the ones BGG can fill in — these need a person to fill them in.
export function extraHeaders(headers, idx) {
  const known = new Set([idx.GAME, idx.YEAR, idx.MIN, idx.MAX, idx.TIME, idx.TYPE, idx.RATING, idx.IMAGE, idx.BGGID].filter((i) => i >= 0));
  return headers.map((h, i) => ({ name: h, i })).filter(({ i }) => !known.has(i));
}

export const cellAt = (row, i) => (i >= 0 && i < row.length ? (row[i] || '').trim() : '');
const numAt = (row, i) => {
  const v = cellAt(row, i);
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

// Every distinct, non-empty value in a column, in first-seen order (case-insensitively deduped).
export function distinctValues(rows, colIndex) {
  if (colIndex < 0) return [];
  const seen = new Map();
  for (const r of rows) {
    const v = cellAt(r, colIndex);
    if (v && !seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v);
  }
  return [...seen.values()];
}

// A row matches the player-count filter if MIN..MAX spans it; missing MIN/MAX defaults are forgiving
// (1..Infinity) so incomplete rows aren't hidden just because that data was never filled in.
export function filterRows(rows, idx, { text = '', players = '', type = '' } = {}) {
  const q = text.trim().toLowerCase();
  const n = players === '' ? null : Number(players);
  return rows
    .map((row, i) => ({ row, i }))
    .filter(({ row }) => {
      if (q && !row.some((cell) => (cell || '').toLowerCase().includes(q))) return false;
      if (n != null && Number.isFinite(n)) {
        const min = numAt(row, idx.MIN) ?? 1;
        const max = numAt(row, idx.MAX) ?? Infinity;
        if (n < min || n > max) return false;
      }
      if (type && cellAt(row, idx.TYPE).toLowerCase() !== type.toLowerCase()) return false;
      return true;
    });
}

// Sorts {row,i} entries (from filterRows) by a canonical column name; numeric where the column is
// numeric-looking, alphabetic otherwise. Stable: ties keep their original relative order.
export function sortEntries(entries, idx, key, dir = 'asc') {
  const col = idx[key];
  if (col == null || col < 0) return entries;
  const sign = dir === 'desc' ? -1 : 1;
  return entries
    .map((e, pos) => ({ e, pos }))
    .sort((a, b) => {
      const av = cellAt(a.e.row, col);
      const bv = cellAt(b.e.row, col);
      const an = parseFloat(av);
      const bn = parseFloat(bv);
      let cmp;
      if (Number.isFinite(an) && Number.isFinite(bn)) cmp = an - bn;
      else cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
      return cmp !== 0 ? sign * cmp : a.pos - b.pos;
    })
    .map((x) => x.e);
}

// A loose key for matching a sheet row to a BGG item: lowercase name with punctuation/spacing
// stripped, so "Brass: Birmingham" and "brass birmingham" line up. Apostrophes are dropped rather than
// turned into a space, so "Dead Man's Draw" and a sheet row typed "Dead Mans Draw" still match.
export const matchKey = (name) => (name || '').toLowerCase().replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// The canonical columns a BGG match can fill in on an existing row.
const ENRICHABLE = ['YEAR', 'MIN', 'MAX', 'TIME', 'TYPE', 'RATING', 'IMAGE', 'BGGID'];

// Sheet rows that have a name but are missing at least one BGG-fillable value the sheet actually
// has a column for. A column the sheet doesn't track at all doesn't count as "missing".
export function incompleteRows(rows, idx) {
  const cols = ENRICHABLE.map((k) => idx[k]).filter((i) => i >= 0);
  return rows
    .map((row, i) => ({ row, i }))
    .filter(({ row }) => cellAt(row, idx.GAME) && cols.some((c) => !cellAt(row, c)));
}

// Which blank cells on an existing row a BGG match can fill — never overwrites a value that's
// already there, so a correction someone already typed in stays put.
export function buildPatchFromThing(idx, existingRow, thing) {
  const patch = {};
  const maybe = (key, value) => {
    const col = idx[key];
    if (col >= 0 && value && !cellAt(existingRow, col)) patch[col] = value;
  };
  maybe('YEAR', thing.year);
  maybe('MIN', thing.minPlayers);
  maybe('MAX', thing.maxPlayers);
  maybe('TIME', thing.playTime);
  maybe('TYPE', thing.type);
  maybe('RATING', thing.rating);
  maybe('IMAGE', thing.image);
  maybe('BGGID', thing.id);
  return patch;
}

// Every sheet GAME name and every BGGID already present, for checking what's already tracked.
function existingKeys(rows, idx) {
  const names = new Set();
  const ids = new Set();
  for (const row of rows) {
    const name = cellAt(row, idx.GAME);
    if (name) names.add(matchKey(name));
    const id = cellAt(row, idx.BGGID);
    if (id) ids.add(id);
  }
  return { names, ids };
}

// ---------- BoardGameGeek ----------

export function cleanQuery(q) {
  return (q || '').replace(/[()[\]{}:!.,]/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function bggSearch(query, exact = false) {
  const xml = await callFn('bgg', { mode: 'search', q: exact ? `${query}&exact=1` : query });
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  return [...doc.querySelectorAll('items > item')].map((it) => ({
    id: it.getAttribute('id') || '',
    name: nameOf(it.querySelector('name[type="primary"]') || it.querySelector('name')),
    year: it.querySelector('yearpublished')?.getAttribute('value') || '',
  }));
}

const nameOf = (el) => (el ? el.getAttribute('value') || el.textContent || '' : '');

// BGG's own categories for a game ("Fantasy", "Science Fiction", "Card Game", ...), used as its themes.
export const categoriesFromLinks = (links = []) => links.filter((l) => l.type === 'boardgamecategory' && l.value).map((l) => l.value);

export function modesFromLinks(links = []) {
  const vals = links.map((l) => (l.value || '').toLowerCase());
  const modes = new Set();
  if (vals.some((v) => v.includes('solo / solitaire'))) modes.add('solo');
  if (vals.some((v) => v.includes('cooperative'))) modes.add('co-op');
  if (vals.some((v) => v.includes('team-based') || v.includes('partnership'))) modes.add('team');
  if (!modes.size) modes.add('individual');
  return [...modes].join(', ');
}

export async function bggThing(ids) {
  if (!ids.length) return [];
  const xml = await callFn('bgg', { mode: 'thing', ids: ids.join(',') });
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  return [...doc.querySelectorAll('items > item')].map((it) => {
    const avgRaw = it.querySelector('statistics > ratings > average')?.getAttribute('value') || '';
    const links = [...it.querySelectorAll('link')].map((l) => ({ type: l.getAttribute('type'), value: l.getAttribute('value') || '' }));
    return {
      id: it.getAttribute('id') || '',
      kind: it.getAttribute('type') || 'boardgame', // 'boardgame' or 'boardgameexpansion'
      name: nameOf(it.querySelector('name[type="primary"]') || it.querySelector('name')),
      year: it.querySelector('yearpublished')?.getAttribute('value') || '',
      minPlayers: it.querySelector('minplayers')?.getAttribute('value') || '',
      maxPlayers: it.querySelector('maxplayers')?.getAttribute('value') || '',
      playTime: it.querySelector('playingtime')?.getAttribute('value') || '',
      image: it.querySelector('image')?.textContent || '',
      rating: avgRaw && avgRaw !== 'N/A' ? Number.parseFloat(avgRaw).toFixed(1) : '',
      type: modesFromLinks(links),
      categories: categoriesFromLinks(links),
    };
  });
}

// Themes (BGG categories) for a list of BGG ids, fetched 20 at a time (the most BGG's thing endpoint
// allows). `onChunk(found)` gets { id: [categories] } after each batch, so a caller can show progress and
// keep what it already has if a later batch fails. Within a batch BGG did answer, an id it has no entry for
// is reported as [] (so it isn't asked for again). A whole batch coming back empty is treated as a failure
// instead, so a hiccup on BGG's side is never remembered as "this game has no themes".
// BGG rate-limits quick-fire requests, so batches go a little apart, and one that fails is tried once more
// after a longer pause before it counts as a failure. `pauseMs` is that gap (0 in tests).
export async function bggThemes(ids, onChunk, pauseMs = 900) {
  const wait = (ms) => (ms ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());
  const fetchBatch = async (batch) => {
    const things = await bggThing(batch);
    if (!things.length && batch.length > 1) throw new Error('BoardGameGeek sent back nothing for some games; try again in a moment');
    return things;
  };
  for (let i = 0; i < ids.length; i += 20) {
    if (i) await wait(pauseMs);
    const batch = ids.slice(i, i + 20);
    let things;
    try {
      things = await fetchBatch(batch);
    } catch (_) {
      await wait(pauseMs * 2);
      things = await fetchBatch(batch);
    }
    const found = Object.fromEntries(batch.map((id) => [id, []]));
    things.forEach((t) => { found[t.id] = t.categories; });
    onChunk(found);
  }
}

// The best few search results, ranked by how closely the name matches (simple word-overlap score).
export async function bggFindCandidates(query, limit = 6) {
  const cleaned = cleanQuery(query);
  if (!cleaned) return [];
  let results = await bggSearch(cleaned, true);
  if (!results.length) results = await bggSearch(cleaned, false);
  if (!results.length) return [];
  const overlap = (a, b) => {
    const at = new Set(a.toLowerCase().split(/\s+/));
    const bt = new Set(b.toLowerCase().split(/\s+/));
    let hit = 0;
    at.forEach((t) => bt.has(t) && hit++);
    return hit / Math.max(1, Math.max(at.size, bt.size));
  };
  const ranked = results.map((r) => ({ ...r, score: overlap(r.name, cleaned) })).sort((a, b) => b.score - a.score);
  const topIds = ranked.slice(0, Math.max(limit, 10)).map((r) => r.id);
  const things = await bggThing(topIds);
  const order = new Map(topIds.map((id, i) => [id, i]));
  return things.sort((a, b) => order.get(a.id) - order.get(b.id)).slice(0, limit);
}

// Everything in a BGG collection marked "own", with the same stats shape as bggThing()'s results,
// read straight from the collection endpoint's own <stats> block (one call, not one per game).
export const bggOwnedCollection = (username) => bggCollectionList('collection', username);

// The games on a BGG wishlist, each with BGG's own 1 to 5 priority (1 = must have) in `priority`.
export const bggWishlist = (username) => bggCollectionList('wishlist', username);

export const PRIORITY_LABELS = { 1: 'Must have', 2: 'Love to have', 3: 'Like to have', 4: 'Thinking about it', 5: "Don't buy this" };

async function bggCollectionList(mode, username) {
  const xml = await callFn('bgg', { mode, username });
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const errorText = doc.querySelector('errors message, error message')?.textContent;
  if (errorText) throw new Error(errorText);
  // BGG answers "accepted, try again later" with a bare <message> instead of <items> while it prepares the
  // export; without this it would read as a collection with no games in it.
  if (doc.documentElement && doc.documentElement.nodeName === 'message') {
    throw new Error('BoardGameGeek is still preparing your collection. Give it a few seconds and try again.');
  }
  return [...doc.querySelectorAll('items > item')].map((it) => {
    const stats = it.querySelector('stats');
    const avgRaw = stats?.querySelector('rating > average')?.getAttribute('value') || '';
    return {
      id: it.getAttribute('objectid') || '',
      name: nameOf(it.querySelector('name')),
      year: it.querySelector('yearpublished')?.textContent || '',
      minPlayers: stats?.getAttribute('minplayers') || '',
      maxPlayers: stats?.getAttribute('maxplayers') || '',
      playTime: stats?.getAttribute('playingtime') || stats?.getAttribute('maxplaytime') || '',
      image: it.querySelector('image')?.textContent || it.querySelector('thumbnail')?.textContent || '',
      rating: avgRaw && avgRaw !== 'N/A' ? Number.parseFloat(avgRaw).toFixed(1) : '',
      type: '', // the collection endpoint doesn't carry the solo/co-op/team links; left for a person to fill in
      priority: it.querySelector('status')?.getAttribute('wishlistpriority') || '',
    };
  });
}

// Owned BGG items whose name (or BGGID) isn't already in the sheet.
export function missingFromSheet(owned, rows, idx) {
  const { names, ids } = existingKeys(rows, idx);
  return owned.filter((g) => !(g.id && ids.has(g.id)) && !names.has(matchKey(g.name)));
}

// What adding a game would do, given the sheet's rows and the games you own on BGG (null when that list
// isn't known). Either one already having the game (by BGG id, or by name) means there's nothing to add there:
//   sheet: 'add' | 'have'      bgg: 'have' | 'missing' | 'unknown'
export function addPlan(item, title, rows, idx, owned) {
  const { names, ids } = existingKeys(rows, idx);
  const inSheet = (item.id && ids.has(item.id)) || [item.name, title].some((n) => n && names.has(matchKey(n)));
  let bgg = 'unknown';
  if (owned && item.id) {
    const key = matchKey(item.name);
    bgg = owned.some((g) => g.id === item.id || (key && matchKey(g.name) === key)) ? 'have' : 'missing';
  }
  return { sheet: inSheet ? 'have' : 'add', bgg };
}

// A new sheet row, in the sheet's own column order, filling whichever of the canonical columns
// exist and any extra values a person typed in for the columns BGG can't supply.
export function buildRowFromThing(headers, idx, thing, titleOverride, extraValues = {}) {
  const row = new Array(headers.length).fill('');
  const set = (i, v) => {
    if (i >= 0) row[i] = v;
  };
  set(idx.GAME, (titleOverride || thing.name || '').trim());
  set(idx.YEAR, thing.year || '');
  set(idx.MIN, thing.minPlayers || '');
  set(idx.MAX, thing.maxPlayers || '');
  set(idx.TIME, thing.playTime || '');
  set(idx.TYPE, thing.type || '');
  set(idx.RATING, thing.rating || '');
  set(idx.IMAGE, thing.image || '');
  set(idx.BGGID, thing.id || '');
  for (const [i, v] of Object.entries(extraValues)) row[Number(i)] = v;
  return row;
}

// Appends one row to the sheet via a user-deployed Google Apps Script Web App (see the in-page
// setup help for the script). `text/plain` avoids a CORS preflight that a plain Apps Script
// deployment doesn't answer; Apps Script still reads the JSON body fine either way.
export async function appendRowViaScript(scriptUrl, row) {
  const res = await fetch(scriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ row }),
  });
  if (!res.ok) throw new Error(`The script replied with ${res.status}`);
  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    // some deployments reply with plain text; treat a 2xx as success either way
  }
  if (data && data.ok === false) throw new Error(data.error || 'The script reported an error');
  return true;
}

// Updates specific cells on an existing sheet row (by its 0-based data-row position, i.e. how far
// down from the header) via the same Apps Script Web App, which needs its `doPost` extended with
// an `update` branch alongside the original `append` one (see the in-page setup help).
export async function updateRowViaScript(scriptUrl, rowIndex, patch) {
  const res = await fetch(scriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ update: { rowIndex, patch } }),
  });
  if (!res.ok) throw new Error(`The script replied with ${res.status}`);
  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    // some deployments reply with plain text; treat a 2xx as success either way
  }
  if (data && data.ok === false) throw new Error(data.error || 'The script reported an error');
  return true;
}

// ---------- Keep / Discard / Play-and-see decisions ----------
// Each answer is one row in a second tab of the sheet called "Decisions": the game in column A and the
// choice in column B. The page reads that tab back so it never shows a game twice.

export const DECISIONS_TAB = 'Decisions';
export const CHOICES = ['Keep', 'Discard', 'Play and see'];

// The Decisions tab as a Map of matchKey(game) -> { game, choice }. If the tab doesn't exist yet Google
// answers with the first sheet instead, so anything whose header isn't exactly Game, Choice counts as empty.
export function parseDecisions(text) {
  const table = parseCsv(text || '');
  const out = new Map();
  if (!table.length) return out;
  const head = table[0].map(normalizeHeader);
  if (head[0] !== 'game' || head[1] !== 'choice') return out;
  for (const row of table.slice(1)) {
    const game = (row[0] || '').trim();
    const choice = (row[1] || '').trim();
    if (game && choice) out.set(matchKey(game), { game, choice });
  }
  return out;
}

export function shuffled(list, rng = Math.random) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// The owned games that don't have an answer yet, in random order.
export const undecidedGames = (owned, decisions, rng = Math.random) =>
  shuffled(owned.filter((g) => !decisions.has(matchKey(g.name))), rng);

const OUTDATED_SCRIPT = 'Your sheet script did not confirm saving. Open Settings, copy the latest script from the setup help into Apps Script, and redeploy it as a new version.';

// POSTs one request to the sheet's Apps Script and returns its JSON reply (null if it wasn't JSON, which is what
// an older copy of the script gives for a request it doesn't know about).
async function postToScript(scriptUrl, body) {
  const res = await fetch(scriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`The script replied with ${res.status}`);
  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    // an old script answers with an HTML error page, which isn't JSON
  }
  if (data && data.ok === false) throw new Error(data.error || 'The script reported an error');
  return data;
}

// A script from before the Wishlist tab existed would take a wishlist answer and quietly file it in Decisions. So
// before the first save to any other tab, this asks the script to say which version it is (a harmless request that an
// older script rejects without writing anything), and remembers the answer for each script address. A save that needs a
// newer feature says which version it needs.
const verifiedScripts = new Map(); // script address -> the version it said it was
async function requireCurrentScript(scriptUrl, minVersion = 1) {
  if ((verifiedScripts.get(scriptUrl) || 0) >= minVersion) return;
  let data = null;
  try {
    data = await postToScript(scriptUrl, { ping: true });
  } catch (_) {
    // an older script fails on a request it doesn't know, which is the same answer as not being current
  }
  if (!data || data.kind !== 'ping' || (Number(data.version) || 0) < minVersion) throw new Error(OUTDATED_SCRIPT);
  verifiedScripts.set(scriptUrl, Number(data.version) || 1);
}

// Saves one answer in the named tab through the same Apps Script Web App. The script must reply
// { ok: true, kind: 'decision' }; an older copy of the script (without the decision branch) doesn't, and that is
// reported instead of silently looking like it worked. Tabs other than the first one, Decisions, are only written
// by a script that has been checked to be current, and have to be echoed back as well.
export async function saveDecisionViaScript(scriptUrl, game, choice, tab = DECISIONS_TAB) {
  if (tab !== DECISIONS_TAB) await requireCurrentScript(scriptUrl);
  const data = await postToScript(scriptUrl, { decision: { game, choice, tab } });
  if (!data || data.kind !== 'decision' || (tab !== DECISIONS_TAB && data.tab !== tab)) throw new Error(OUTDATED_SCRIPT);
  return true;
}

// ---------- BGG wishlist ----------
// Each wishlist game gets answered once (Buy / Drop / Later) in a second tab of the sheet called Wishlist.

export const WISHLIST_TAB = 'Wishlist';
export const WISHLIST_CHOICES = ['Buy', 'Drop', 'Later'];

// Wishlist games that have no answer yet: BGG's must-haves first, random within each priority.
export function wishlistQueue(wishlist, answered, rng = Math.random) {
  const rank = (g) => (Number(g.priority) >= 1 && Number(g.priority) <= 5 ? Number(g.priority) : 6);
  return shuffled(wishlist.filter((g) => !answered.has(matchKey(g.name))), rng)
    .map((g, i) => ({ g, i }))
    .sort((a, b) => rank(a.g) - rank(b.g) || a.i - b.i)
    .map((x) => x.g);
}

// ---------- plays ----------
// A third tab, Plays, is the log of games you've actually played: Date, Game, Players, Winner, Notes.

export const PLAYS_TAB = 'Plays';
const DAY_MS = 86400000;

// The Plays tab as a list, in sheet order. If the tab doesn't exist yet Google answers with the first sheet instead,
// so anything whose header doesn't start Date, Game counts as empty.
export function parsePlays(text) {
  const table = parseCsv(text || '');
  if (!table.length) return [];
  const head = table[0].map(normalizeHeader);
  if (head[0] !== 'date' || head[1] !== 'game') return [];
  return table.slice(1)
    .map((r) => ({ date: (r[0] || '').trim(), game: (r[1] || '').trim(), players: (r[2] || '').trim(), winner: (r[3] || '').trim(), notes: (r[4] || '').trim() }))
    .filter((p) => p.game);
}

const dateToTime = (d) => {
  const t = Date.parse(d);
  return Number.isFinite(t) ? t : null;
};

// Per game (keyed by matchKey): how many plays it has, and when the latest one was (lastTs is null when no play had
// a date that could be read).
export function playStats(plays) {
  const stats = new Map();
  for (const p of plays) {
    const key = matchKey(p.game);
    if (!key) continue;
    const s = stats.get(key) || { count: 0, last: '', lastTs: null };
    s.count += 1;
    const ts = dateToTime(p.date);
    if (ts != null && (s.lastTs == null || ts > s.lastTs)) {
      s.lastTs = ts;
      s.last = p.date;
    }
    stats.set(key, s);
  }
  return stats;
}

// Whole days between a play and now (never negative), or null when the date isn't readable.
export const daysSince = (ts, now = Date.now()) => (ts == null ? null : Math.max(0, Math.floor((now - ts) / DAY_MS)));

export async function savePlayViaScript(scriptUrl, play) {
  const data = await postToScript(scriptUrl, { play });
  if (!data || data.kind !== 'play') throw new Error(OUTDATED_SCRIPT);
  return true;
}

// ---------- the New list tab ----------
// A fourth tab of the sheet, "New List", holds games you're thinking about. It has every column of your main sheet (the ones
// BGG fills in, and your own, like House, Played and Complete) plus a BGG Link, so each game is one row you can click through from.

export const NEWLIST_TAB = 'New List';
export const NEWLIST_LINK = 'BGG Link';
const isLinkHeader = (h) => normalizeHeader(h) === 'bgg link';

// The New List columns for a main sheet with these headers: the same ones in the same order, ending with the BGG link
// (unless the main sheet already has a column of that name, which then gets the link).
export function newListLayout(headers) {
  const header = headers.map((h) => (h || '').trim());
  let link = header.findIndex(isLinkHeader);
  if (link < 0) {
    header.push(NEWLIST_LINK);
    link = header.length - 1;
  }
  return { header, link };
}

// The main sheet's own columns, the ones BGG can't fill in, as { name, i } for the form. A column with no name has nothing
// to type into, and the link is filled in for you.
export function newListFields(headers, idx) {
  const { link } = newListLayout(headers);
  return extraHeaders(headers, idx).filter(({ name, i }) => name.trim() && i !== link);
}

// The values already used in a column of the main sheet (say House: Sam, Nalie), most used first, to tap instead of type.
// A column with lots of different values is free text, and gives none.
export function commonValues(rows, col, { limit = 6, maxDistinct = 8, maxLength = 30 } = {}) {
  if (col < 0) return [];
  const counts = new Map();
  for (const r of rows) {
    const v = cellAt(r, col);
    if (!v) continue;
    const seen = counts.get(v.toLowerCase()) || { value: v, n: 0 };
    seen.n += 1;
    counts.set(v.toLowerCase(), seen);
  }
  if (counts.size > maxDistinct) return [];
  return [...counts.values()].filter((c) => c.value.length <= maxLength).sort((a, b) => b.n - a.n).slice(0, limit).map((c) => c.value);
}

// One New List row, in the columns newListLayout gives: what BGG knows, your own values, and the link to the game's BGG page.
export function buildNewListRow(headers, idx, thing, name, extraValues = {}) {
  const { link } = newListLayout(headers);
  const row = buildRowFromThing(headers, idx, thing, name, extraValues);
  row[link] = thing.id ? bggGameUrl(thing.id) : '';
  return row;
}

const rowKey = (row) => {
  const cells = row.map((c) => (c || '').trim());
  while (cells.length && !cells[cells.length - 1]) cells.pop();
  return cells.join('\u0001');
};

// The New List tab (read as CSV) as { header, rows }, or null when there isn't one yet. Google answers a missing tab with the
// first sheet instead, so a table with no BGG Link column, or one that is just the main sheet again, counts as missing.
export function parseNewList(text, mainHeaders = [], mainRows = []) {
  const table = parseCsv(text || '');
  if (!table.length) return null;
  const header = table[0].map((h) => (h || '').trim());
  if (!header.some(isLinkHeader)) return null;
  if (mainHeaders.length) {
    const main = [mainHeaders, ...mainRows].map(rowKey);
    if (main.length === table.length && table.every((r, i) => rowKey(r) === main[i])) return null;
  }
  return { header, rows: table.slice(1) };
}

// Is this game already in the New List tab, by BGG id (its column, or the id in the link) or by name?
export function inNewList(list, item, name) {
  if (!list) return false;
  const idx = buildHeaderIndex(list.header);
  const link = list.header.findIndex(isLinkHeader);
  const keys = [item.name, name].filter(Boolean).map(matchKey).filter(Boolean);
  return list.rows.some((row) => {
    const id = cellAt(row, idx.BGGID) || (cellAt(row, link).match(/\/(\d+)(?:\/|$)/) || [])[1] || '';
    const key = matchKey(cellAt(row, idx.GAME));
    return !!((item.id && id === item.id) || (key && keys.includes(key)));
  });
}

// How the script files a row in the tab: the value under each column goes in the tab's column of the same name, and a name
// the tab hasn't got yet becomes a new column at the end. Returns the tab's header and the row as they now stand, so the page
// can show the new game straight away. An empty `listHeader` is a tab that doesn't exist yet.
export function fileInList(listHeader, header, row) {
  const outHeader = listHeader.slice();
  const outRow = listHeader.map(() => '');
  header.forEach((h, k) => {
    const key = normalizeHeader(h);
    if (!key) return;
    let at = outHeader.findIndex((x) => normalizeHeader(x) === key);
    if (at < 0) {
      outHeader.push(h);
      outRow.push('');
      at = outHeader.length - 1;
    }
    outRow[at] = row[k];
  });
  return { header: outHeader, row: outRow };
}

// Adds one game to the New List tab through the sheet's Apps Script. Needs script version 4 or newer, and says so when
// it isn't, instead of looking as if it worked.
export async function saveNewListRowViaScript(scriptUrl, header, row) {
  await requireCurrentScript(scriptUrl, 4);
  const data = await postToScript(scriptUrl, { newList: { header, row } });
  if (!data || data.kind !== 'newlist') throw new Error(OUTDATED_SCRIPT);
  return true;
}

// ---------- "What should we play?" picker ----------
// Players, time and type come from the sheet; themes are BGG categories looked up by the sheet's BGGID.

// How long the time chips go up to (minutes).
export const TIME_STEPS = [15, 30, 45, 60, 90, 120];

// A TYPE cell can hold several modes ("solo, co-op"); this splits it into the individual ones.
export const typeTokens = (cell) => (cell || '').split(/[,/;]+/).map((t) => t.trim()).filter(Boolean);

// Every distinct mode used in the sheet's TYPE column, in first-seen order.
export function typeChoices(rows, idx) {
  const seen = new Map();
  for (const row of rows) {
    for (const t of typeTokens(cellAt(row, idx.TYPE))) if (!seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
  }
  return [...seen.values()];
}

// The sheet's rows that have a game name, as game objects shaped like the BGG ones (plus `row`, the
// position in the sheet) so the same card can show either.
export function sheetGames(rows, idx) {
  return rows
    .map((row, i) => ({
      row: i,
      name: cellAt(row, idx.GAME),
      year: cellAt(row, idx.YEAR),
      minPlayers: cellAt(row, idx.MIN),
      maxPlayers: cellAt(row, idx.MAX),
      playTime: cellAt(row, idx.TIME),
      type: cellAt(row, idx.TYPE),
      rating: cellAt(row, idx.RATING),
      image: cellAt(row, idx.IMAGE),
      id: /^\d+$/.test(cellAt(row, idx.BGGID)) ? cellAt(row, idx.BGGID) : '',
    }))
    .filter((g) => g.name);
}

const toNumber = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

// The games that fit what's wanted. Everything is optional:
//   players  - a count the game must support (a blank min/max is forgiven, as in the Collection filter)
//   maxTime  - at most this many minutes (a game with no time listed still counts)
//   type     - one mode, e.g. "co-op"; a game with no type listed doesn't count
//   themes   - any of these BGG categories; a game with no BGG info doesn't count
//   history  - 'never': no play logged yet; 'stale': never played, or not for `staleDays` (a play with no readable
//              date counts as recent). `stats` is playStats() of the Plays tab.
//   exclude  - a Set of matchKey()s to leave out (the games you marked Discard)
// `themeMap` is { bggId: [categories] }.
export function pickableGames(games, themeMap = {}, { players = null, maxTime = null, type = '', themes = [], history = '', stats = null, staleDays = 30, exclude = null, now = Date.now() } = {}) {
  const wantedType = type.trim().toLowerCase();
  const wantedThemes = new Set(themes);
  return games.filter((g) => {
    if (exclude && exclude.has(matchKey(g.name))) return false;
    if (history) {
      const s = stats && stats.get(matchKey(g.name));
      if (history === 'never' && s) return false;
      if (history === 'stale' && s && (s.lastTs == null || daysSince(s.lastTs, now) < staleDays)) return false;
    }
    if (players != null) {
      const min = toNumber(g.minPlayers) ?? 1;
      const max = toNumber(g.maxPlayers) ?? Infinity;
      if (players < min || players > max) return false;
    }
    if (maxTime != null) {
      const t = toNumber(g.playTime);
      if (t != null && t > maxTime) return false;
    }
    if (wantedType && !typeTokens(g.type).some((t) => t.toLowerCase() === wantedType)) return false;
    if (wantedThemes.size && !(themeMap[g.id] || []).some((c) => wantedThemes.has(c))) return false;
    return true;
  });
}

// Each theme the given games have, with how many of them, most common first.
export function themeCounts(games, themeMap = {}) {
  const counts = new Map();
  for (const g of games) for (const c of themeMap[g.id] || []) counts.set(c, (counts.get(c) || 0) + 1);
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export const bggGameUrl = (id) => `https://boardgamegeek.com/boardgame/${id}`;
export const bggCollectionUrl = (username) => `https://boardgamegeek.com/collection/user/${encodeURIComponent(username.trim())}`;
