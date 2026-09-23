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

const fetchSheetCsv = (sheetLink) => callFn('sheet', { link: sheetLink });

function parseCsv(text) {
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
const CANONICAL = ['GAME', 'YEAR', 'MIN', 'MAX', 'TIME', 'TYPE', 'BGG RATING', 'IMAGE', 'BGGID'];

// Maps a canonical column name (GAME, YEAR, MIN, MAX, TIME, TYPE, BGG RATING, IMAGE, BGGID) to its
// index in `headers`, however the sheet actually spelled it, or -1 if the sheet doesn't have it.
function buildHeaderIndex(headers) {
  const found = {};
  headers.forEach((h, i) => {
    const canon = HEADER_ALIASES[normalizeHeader(h)] || h.trim().toUpperCase();
    if (!(canon in found)) found[canon] = i;
  });
  const get = (name) => (name in found ? found[name] : -1);
  return { GAME: get('GAME'), YEAR: get('YEAR'), MIN: get('MIN'), MAX: get('MAX'), TIME: get('TIME'), TYPE: get('TYPE'), RATING: get('BGG RATING'), IMAGE: get('IMAGE'), BGGID: get('BGGID') };
}

// Header names the sheet has beyond the ones BGG can fill in — these need a person to fill them in.
function extraHeaders(headers, idx) {
  const known = new Set([idx.GAME, idx.YEAR, idx.MIN, idx.MAX, idx.TIME, idx.TYPE, idx.RATING, idx.IMAGE, idx.BGGID].filter((i) => i >= 0));
  return headers.map((h, i) => ({ name: h, i })).filter(({ i }) => !known.has(i));
}

const cellAt = (row, i) => (i >= 0 && i < row.length ? (row[i] || '').trim() : '');
const numAt = (row, i) => {
  const v = cellAt(row, i);
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

// Every distinct, non-empty value in a column, in first-seen order (case-insensitively deduped).
function distinctValues(rows, colIndex) {
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
function filterRows(rows, idx, { text = '', players = '', type = '' } = {}) {
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
function sortEntries(entries, idx, key, dir = 'asc') {
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
// stripped, so "Brass: Birmingham" and "brass birmingham" line up.
const matchKey = (name) => (name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

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

function cleanQuery(q) {
  return (q || '').replace(/[()[\]{}:!.,]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function bggSearch(query, exact = false) {
  const xml = await callFn('bgg', { mode: 'search', q: exact ? `${query}&exact=1` : query });
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  return [...doc.querySelectorAll('items > item')].map((it) => ({
    id: it.getAttribute('id') || '',
    name: nameOf(it.querySelector('name[type="primary"]') || it.querySelector('name')),
    year: it.querySelector('yearpublished')?.getAttribute('value') || '',
  }));
}

const nameOf = (el) => (el ? el.getAttribute('value') || el.textContent || '' : '');

function modesFromLinks(links = []) {
  const vals = links.map((l) => (l.value || '').toLowerCase());
  const modes = new Set();
  if (vals.some((v) => v.includes('solo / solitaire'))) modes.add('solo');
  if (vals.some((v) => v.includes('cooperative'))) modes.add('co-op');
  if (vals.some((v) => v.includes('team-based') || v.includes('partnership'))) modes.add('team');
  if (!modes.size) modes.add('individual');
  return [...modes].join(', ');
}

async function bggThing(ids) {
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
    };
  });
}

// The best few search results, ranked by how closely the name matches (simple word-overlap score).
async function bggFindCandidates(query, limit = 6) {
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
async function bggOwnedCollection(username) {
  const xml = await callFn('bgg', { mode: 'collection', username });
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const errorText = doc.querySelector('errors message, error message')?.textContent;
  if (errorText) throw new Error(errorText);
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
function missingFromSheet(owned, rows, idx) {
  const { names, ids } = existingKeys(rows, idx);
  return owned.filter((g) => !(g.id && ids.has(g.id)) && !names.has(matchKey(g.name)));
}

// A new sheet row, in the sheet's own column order, filling whichever of the canonical columns
// exist and any extra values a person typed in for the columns BGG can't supply.
function buildRowFromThing(headers, idx, thing, titleOverride, extraValues = {}) {
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
async function appendRowViaScript(scriptUrl, row) {
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

const bggGameUrl = (id) => `https://boardgamegeek.com/boardgame/${id}`;
const bggCollectionUrl = (username) => `https://boardgamegeek.com/collection/user/${encodeURIComponent(username.trim())}`;

module.exports = {
  CANONICAL, fetchSheetCsv, parseCsv, buildHeaderIndex, extraHeaders, distinctValues, filterRows, sortEntries,
  bggSearch, bggThing, bggFindCandidates, bggOwnedCollection, missingFromSheet, buildRowFromThing,
  appendRowViaScript, bggGameUrl, bggCollectionUrl, cellAt, cleanQuery, modesFromLinks, matchKey,
};
