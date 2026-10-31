// Run with: node --test src/components/collectionNewList.test.mjs
// The New list tab: its columns, the row built for it, reading the tab back and saving to it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  newListLayout, newListFields, commonValues, buildNewListRow, parseNewList, inNewList, fileInList, saveNewListRowViaScript,
  buildHeaderIndex, bggFindCandidates, bggSearchAll, rankMatches, NEWLIST_TAB, NEWLIST_LINK,
} from './collectionUtils.js';

const MAIN = ['Game', 'Year', 'Min Players', 'Max Players', 'Time', 'Type', 'BGG Rating', 'Image', 'BGGID', 'House', 'Played', 'Complete'];
const idx = buildHeaderIndex(MAIN);
const AZUL = { id: '230802', name: 'Azul', year: '2017', minPlayers: '2', maxPlayers: '4', playTime: '45', rating: '7.8', image: 'https://img/azul.jpg', type: 'individual' };

test('the tab is called New List and the link column BGG Link', () => {
  assert.equal(NEWLIST_TAB, 'New List');
  assert.equal(NEWLIST_LINK, 'BGG Link');
});

test('the New List columns are the main sheet\'s, in order, with the BGG link on the end', () => {
  const { header, link } = newListLayout(MAIN);
  assert.deepEqual(header, [...MAIN, 'BGG Link']);
  assert.equal(link, MAIN.length);
  assert.deepEqual(MAIN, ['Game', 'Year', 'Min Players', 'Max Players', 'Time', 'Type', 'BGG Rating', 'Image', 'BGGID', 'House', 'Played', 'Complete'], 'the main headers are not changed');
});

test('a main sheet that already has a BGG Link column keeps it, and that one gets the link', () => {
  const headers = ['Game', 'House', 'bgg link'];
  const { header, link } = newListLayout(headers);
  assert.deepEqual(header, headers);
  assert.equal(link, 2);
  const row = buildNewListRow(headers, buildHeaderIndex(headers), AZUL, 'Azul', { 1: 'Sam' });
  assert.deepEqual(row, ['Azul', 'Sam', 'https://boardgamegeek.com/boardgame/230802']);
});

test('the form asks for the columns BGG cannot fill: House, Played and Complete', () => {
  assert.deepEqual(newListFields(MAIN, idx).map((f) => f.name), ['House', 'Played', 'Complete']);
  // an unnamed column has nothing to type into, and the link is never asked for
  const odd = ['Game', '', 'House', 'BGG Link'];
  assert.deepEqual(newListFields(odd, buildHeaderIndex(odd)).map((f) => f.name), ['House']);
});

test('a new row has BGG\'s info, your own columns and the link, in the header\'s order', () => {
  const row = buildNewListRow(MAIN, idx, AZUL, 'Azul', { 9: 'Nalie', 10: 'No', 11: 'No' });
  assert.deepEqual(row, ['Azul', '2017', '2', '4', '45', 'individual', '7.8', 'https://img/azul.jpg', '230802', 'Nalie', 'No', 'No', 'https://boardgamegeek.com/boardgame/230802']);
  assert.equal(row.length, newListLayout(MAIN).header.length);
  // values you leave blank stay blank; the name you typed wins over BGG's
  const bare = buildNewListRow(MAIN, idx, AZUL, 'My Azul');
  assert.equal(bare[0], 'My Azul');
  assert.deepEqual(bare.slice(9, 12), ['', '', '']);
});

test('a game BGG has no id for gets no link', () => {
  const row = buildNewListRow(MAIN, idx, { ...AZUL, id: '' }, 'Azul');
  assert.equal(row[row.length - 1], '');
});

test('commonValues offers what a column already holds, most used first, but not free text', () => {
  const rows = [['a', 'Sam'], ['b', 'Nalie'], ['c', 'sam'], ['d', ''], ['e', 'Sam']];
  assert.deepEqual(commonValues(rows, 1), ['Sam', 'Nalie']);
  assert.deepEqual(commonValues(rows, -1), []);
  const notes = Array.from({ length: 12 }, (_, i) => ['x', `note number ${i}`]);
  assert.deepEqual(commonValues(notes, 1), [], 'a column with lots of different values is free text');
  assert.deepEqual(commonValues([['x', 'a very very very long value that is not a choice']], 1), []);
});

test('parseNewList reads the tab, and a missing tab (Google answers with the first sheet) is null', () => {
  const tab = `Game,Year,BGG Link\nAzul,2017,https://boardgamegeek.com/boardgame/230802\n`;
  assert.deepEqual(parseNewList(tab, MAIN, []), { header: ['Game', 'Year', 'BGG Link'], rows: [['Azul', '2017', 'https://boardgamegeek.com/boardgame/230802']] });
  assert.equal(parseNewList('Game,Year\nCatan,1995\n', ['Game', 'Year'], [['Catan', '1995']]), null, 'no BGG Link column');
  assert.equal(parseNewList('', MAIN, []), null);
  assert.equal(parseNewList(undefined), null);
  // a main sheet that has a BGG Link column too: the first sheet coming back is told apart by being the same table
  const mainHeaders = ['Game', 'BGG Link'];
  const mainRows = [['Catan', 'u1'], ['Azul', 'u2']];
  assert.equal(parseNewList('Game,BGG Link\nCatan,u1\nAzul,u2\n', mainHeaders, mainRows), null);
  assert.equal(parseNewList('Game,BGG Link\nWingspan,u3\n', mainHeaders, mainRows).rows.length, 1);
});

test('inNewList spots a game already there by BGG id, by the id in its link, or by name', () => {
  const header = [...MAIN, 'BGG Link'];
  const row = (over) => { const r = new Array(header.length).fill(''); Object.entries(over).forEach(([k, v]) => { r[header.indexOf(k)] = v; }); return r; };
  const list = { header, rows: [row({ Game: 'Brass: Birmingham', BGGID: '224517' }), row({ Game: 'Wingspan', 'BGG Link': 'https://boardgamegeek.com/boardgame/266192/wingspan' })] };
  assert.equal(inNewList(list, { id: '224517', name: 'Brass' }, 'Brass'), true, 'by id');
  assert.equal(inNewList(list, { id: '266192', name: 'Something else' }, 'x'), true, 'by the id in the link');
  assert.equal(inNewList(list, { id: '1', name: 'brass birmingham' }, 'brass birmingham'), true, 'by name, loosely');
  assert.equal(inNewList(list, { id: '230802', name: 'Azul' }, 'Azul'), false);
  assert.equal(inNewList(null, AZUL, 'Azul'), false, 'no tab yet');
  assert.equal(inNewList({ header, rows: [row({ 'BGG Link': 'x' })] }, { id: '', name: '!!!' }, ''), false, 'a blank name never matches a blank row');
});

test('fileInList does what the script does, so the page can show the game at once', () => {
  const layout = newListLayout(MAIN).header;
  const row = buildNewListRow(MAIN, idx, AZUL, 'Azul', { 9: 'Nalie' });
  const fresh = fileInList([], layout, row);
  assert.deepEqual(fresh, { header: layout, row });
  // a tab with its columns in another order and one missing
  const filed = fileInList(['BGG Link', 'game', 'Year'], layout, row);
  assert.deepEqual(filed.header.slice(0, 3), ['BGG Link', 'game', 'Year']);
  assert.equal(filed.header.length, layout.length, 'every column the tab lacked was added');
  assert.deepEqual(filed.row.slice(0, 3), ['https://boardgamegeek.com/boardgame/230802', 'Azul', '2017']);
  assert.equal(filed.row[filed.header.indexOf('House')], 'Nalie');
});

const sentTo = [];
const stubScript = (version) => {
  sentTo.length = 0;
  global.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    sentTo.push(body);
    if (body.ping) return { ok: true, status: 200, json: async () => ({ ok: true, kind: 'ping', version }) };
    return { ok: true, status: 200, json: async () => ({ ok: true, kind: 'newlist' }) };
  };
};

test('saving sends the columns and the row once the script proves it is version 4 or newer', async () => {
  stubScript(4);
  const header = newListLayout(MAIN).header;
  const row = buildNewListRow(MAIN, idx, AZUL, 'Azul');
  assert.equal(await saveNewListRowViaScript('https://v4/exec', header, row), true);
  assert.deepEqual(sentTo.map((b) => Object.keys(b)[0]), ['ping', 'newList']);
  assert.deepEqual(sentTo[1], { newList: { header, row } });
  await saveNewListRowViaScript('https://v4/exec', header, row);
  assert.equal(sentTo.length, 3, 'the version check is made once per script');
});

test('an older script is told to be updated and is never sent the game', async () => {
  stubScript(3);
  await assert.rejects(() => saveNewListRowViaScript('https://v3/exec', ['Game'], ['Azul']), /did not confirm saving/);
  assert.deepEqual(sentTo.map((b) => Object.keys(b)[0]), ['ping'], 'nothing was written');
  // one that answers the game without saying it is a New List save is no better
  global.fetch = async (url, init) => ({ ok: true, status: 200, json: async () => (JSON.parse(init.body).ping ? { ok: true, kind: 'ping', version: 4 } : { ok: true }) });
  await assert.rejects(() => saveNewListRowViaScript('https://odd/exec', ['Game'], ['Azul']), /did not confirm saving/);
});

const SEARCH = `<?xml version="1.0"?><items total="3" termsofuse="x">
  <item type="boardgameexpansion" id="926"><name type="primary" value="Catan: Seafarers"/><yearpublished value="1997"/></item>
  <item type="boardgame" id="13"><name type="primary" value="Catan"/><yearpublished value="1995"/></item>
  <item type="boardgame" id="27710"><name type="primary" value="Catan: Cities &amp; Knights"/><yearpublished value="1998"/></item></items>`;
const thingFor = (id, type, name) => `<item type="${type}" id="${id}"><image>https://x/${id}.jpg</image><name type="primary" value="${name}"/><yearpublished value="2000"/><minplayers value="3"/><maxplayers value="4"/><playingtime value="90"/><statistics page="1"><ratings><average value="7.1"/></ratings></statistics></item>`;
const THINGS = `<?xml version="1.0"?><items termsofuse="x">${thingFor(13, 'boardgame', 'Catan')}${thingFor(926, 'boardgameexpansion', 'Catan: Seafarers')}${thingFor(27710, 'boardgame', 'Catan: Cities &amp; Knights')}</items>`;

test('rankMatches puts the exact title first, then names that start with it, games before expansions, and drops repeats', () => {
  const r = (id, name, kind = 'boardgame') => ({ id, name, kind, year: '2000' });
  const ranked = rankMatches([
    r('1', 'Seafarers of Catan'), r('2', 'Catan: Seafarers', 'boardgameexpansion'), r('3', 'Catan: Starfarers'), r('4', 'Catan'),
    r('5', 'Catanian Wars'), r('4', 'Catan'), r('6', 'Catan Junior'),
  ], 'Catan');
  assert.deepEqual(ranked.map((x) => x.id), ['4', '6', '3', '2', '5', '1']);
  assert.deepEqual(rankMatches([], 'x'), []);
  // punctuation and capitals don't matter
  assert.equal(rankMatches([r('1', 'Other'), r('2', "Dead Man's Draw")], 'dead MANS draw')[0].id, '2');
});

test('bggSearchAll asks BGG once and returns every match, not just a few', async () => {
  global.DOMParser = new JSDOM('').window.DOMParser;
  const calls = [];
  const items = Array.from({ length: 60 }, (_, i) => `<item type="${i % 4 ? 'boardgameexpansion' : 'boardgame'}" id="${1000 + i}"><name type="primary" value="Catan ${i}"/><yearpublished value="${1990 + (i % 30)}"/></item>`);
  global.fetch = async (url) => { calls.push(String(url)); return { ok: true, status: 200, text: async () => `<?xml version="1.0"?><items total="60">${items.join('')}</items>` }; };
  const found = await bggSearchAll('Catan');
  assert.equal(found.length, 60);
  assert.equal(calls.length, 1, 'one search request, no per-game lookups');
  assert.ok(!calls[0].includes('exact'), 'a whole-word search, not an exact-title one');
  assert.equal(found[0].kind, 'boardgame');
  assert.equal(found.filter((g) => g.kind === 'boardgameexpansion').length, 45);
  assert.equal(new Set(found.map((g) => g.id)).size, 60);
  assert.deepEqual(await bggSearchAll('   '), []);
});

test('a search with several results gives each one with its details, and says which are expansions', async () => {
  global.DOMParser = new JSDOM('').window.DOMParser;
  global.fetch = async (url) => ({ ok: true, status: 200, text: async () => (String(url).includes('mode=thing') ? THINGS : SEARCH) });
  const found = await bggFindCandidates('Catan');
  assert.equal(found.length, 3);
  assert.deepEqual(found.map((g) => g.name).sort(), ['Catan', 'Catan: Cities & Knights', 'Catan: Seafarers']);
  const byId = Object.fromEntries(found.map((g) => [g.id, g]));
  assert.equal(byId['13'].kind, 'boardgame');
  assert.equal(byId['926'].kind, 'boardgameexpansion');
  assert.deepEqual([byId['13'].minPlayers, byId['13'].maxPlayers, byId['13'].playTime, byId['13'].rating, byId['13'].image], ['3', '4', '90', '7.1', 'https://x/13.jpg']);
  // and the row for the one picked carries its BGG link
  const row = buildNewListRow(MAIN, idx, byId['13'], byId['13'].name);
  assert.equal(row[row.length - 1], 'https://boardgamegeek.com/boardgame/13');
});
