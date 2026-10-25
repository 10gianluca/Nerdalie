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
export async function bggOwnedCollection(username) {
  const xml = await callFn('bgg', { mode: 'collection', username });
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

// Saves one answer through the same Apps Script Web App. The script must reply { ok: true, kind: 'decision' }:
// an older copy of the script (without the decision branch) doesn't, and that is reported instead of
// silently looking like it worked.
export async function saveDecisionViaScript(scriptUrl, game, choice) {
  const res = await fetch(scriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ decision: { game, choice } }),
  });
  if (!res.ok) throw new Error(`The script replied with ${res.status}`);
  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    // an old script answers with an HTML error page, which isn't JSON
  }
  if (data && data.ok === false) throw new Error(data.error || 'The script reported an error');
  if (!data || data.kind !== 'decision') {
    throw new Error('Your sheet script did not confirm saving. Open Settings, copy the latest script from the setup help into Apps Script, and redeploy it as a new version.');
  }
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
// `themeMap` is { bggId: [categories] }.
export function pickableGames(games, themeMap = {}, { players = null, maxTime = null, type = '', themes = [] } = {}) {
  const wantedType = type.trim().toLowerCase();
  const wantedThemes = new Set(themes);
  return games.filter((g) => {
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
