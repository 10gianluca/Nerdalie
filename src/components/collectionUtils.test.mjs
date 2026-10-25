// Run with: node --test src/components/collectionUtils.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDecisions, undecidedGames, shuffled, saveDecisionViaScript, matchKey, CHOICES, DECISIONS_TAB,
  parseCsv, buildHeaderIndex, addPlan, typeTokens, typeChoices, sheetGames, pickableGames, themeCounts, categoriesFromLinks, TIME_STEPS,
} from './collectionUtils.js';

const mulberry32 = (a) => () => {
  a |= 0; a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

test('the three choices and the tab name are what the sheet script expects', () => {
  assert.deepEqual(CHOICES, ['Keep', 'Discard', 'Play and see']);
  assert.equal(DECISIONS_TAB, 'Decisions');
});

test('parseDecisions reads Game / Choice rows, ignoring blanks and tidying spacing', () => {
  const csv = '"Game","Choice"\n"Catan","Keep"\n"  Azul ","Play and see"\n"","Keep"\n"Risk",""\n"Uno, Deluxe","Discard"\n';
  const map = parseDecisions(csv);
  assert.equal(map.size, 3);
  assert.deepEqual(map.get(matchKey('Catan')), { game: 'Catan', choice: 'Keep' });
  assert.deepEqual(map.get(matchKey('Azul')), { game: 'Azul', choice: 'Play and see' });
  assert.equal(map.get(matchKey('Uno, Deluxe')).choice, 'Discard');
});

test('a missing Decisions tab (Google answers with the first sheet) counts as no decisions', () => {
  const firstSheet = 'GAME,YEAR,MIN,MAX\nCatan,1995,3,4\nAzul,2017,2,4\n';
  assert.equal(parseDecisions(firstSheet).size, 0);
  assert.equal(parseDecisions('').size, 0);
  assert.equal(parseDecisions(undefined).size, 0);
});

test('header matching is case-insensitive', () => {
  assert.equal(parseDecisions('game,choice\nCatan,Keep\n').size, 1);
});

test('undecidedGames leaves out answered games (matching names loosely) and keeps everything else', () => {
  const owned = ['Catan', 'Azul', 'Ticket to Ride', "Dead Man's Draw"].map((name, i) => ({ id: String(i), name }));
  const decisions = parseDecisions("Game,Choice\ncatan,Keep\nDead Man's Draw,Discard\n");
  const left = undecidedGames(owned, decisions, mulberry32(3)).map((g) => g.name).sort();
  assert.deepEqual(left, ['Azul', 'Ticket to Ride']);
});

test('shuffled returns every item once and does not change the original', () => {
  const list = Array.from({ length: 30 }, (_, i) => i);
  const copy = list.slice();
  const out = shuffled(list, mulberry32(9));
  assert.deepEqual(list, copy);
  assert.deepEqual(out.slice().sort((a, b) => a - b), list);
  assert.notDeepEqual(out, list);
});

test('saveDecisionViaScript sends the game and choice, and accepts only a confirming script', async () => {
  const sent = [];
  global.fetch = async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body), type: init.headers['Content-Type'] });
    return { ok: true, status: 200, json: async () => ({ ok: true, kind: 'decision' }) };
  };
  assert.equal(await saveDecisionViaScript('https://example.test/exec', 'Catan', 'Keep'), true);
  assert.deepEqual(sent[0].body, { decision: { game: 'Catan', choice: 'Keep', tab: 'Decisions' } });
  assert.match(sent[0].type, /text\/plain/);

  // an old script has no decision branch: it replies with an HTML error page, so json() throws
  global.fetch = async () => ({ ok: true, status: 200, json: async () => { throw new Error('not json'); } });
  await assert.rejects(() => saveDecisionViaScript('x', 'Catan', 'Keep'), /did not confirm saving/);

  // an old script that happens to reply { ok: true } (the append/update branch) is still not good enough
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
  await assert.rejects(() => saveDecisionViaScript('x', 'Catan', 'Keep'), /did not confirm saving/);

  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: false, error: 'boom' }) });
  await assert.rejects(() => saveDecisionViaScript('x', 'Catan', 'Keep'), /boom/);

  global.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  await assert.rejects(() => saveDecisionViaScript('x', 'Catan', 'Keep'), /500/);
});

// ---------- the "what should we play?" picker ----------

const CSV = [
  'GAME,YEAR,MIN,MAX,TIME,TYPE,BGG RATING,IMAGE,BGGID',
  'Catan,1995,3,4,90,Team,7.1,,13',
  'Azul,2017,2,4,45,"solo, co-op",7.8,,230802',
  'Wingspan,2019,1,5,70,Solo,8.1,,266192',
  'Pandemic,2008,2,4,45,Co-op,7.6,,30549',
  'Lost Cities,1999,2,2,30,,7.2,,50',
  'Mystery Box,,,,,,,,',
  ',,,,,,,,',
  'Odd Id,2020,1,2,20,Solo,,,n/a',
].join('\n');
const table = parseCsv(CSV);
const idx = buildHeaderIndex(table[0]);
const rows = table.slice(1);
const games = sheetGames(rows, idx);
const themeMap = {
  13: ['Negotiation', 'Economic'],
  230802: ['Abstract Strategy', 'Puzzle'],
  266192: ['Animals', 'Card Game'],
  30549: ['Medical'],
  50: ['Card Game'],
};
const names = (list) => list.map((g) => g.name);

test('typeTokens splits a cell holding several modes; typeChoices lists each mode once', () => {
  assert.deepEqual(typeTokens('solo, co-op'), ['solo', 'co-op']);
  assert.deepEqual(typeTokens(' Team '), ['Team']);
  assert.deepEqual(typeTokens(''), []);
  assert.deepEqual(typeChoices(rows, idx), ['Team', 'solo', 'co-op']); // "Solo" and "Co-op" further down are the same modes
});

test('sheetGames skips blank names and ignores a BGGID that is not a number', () => {
  assert.deepEqual(names(games), ['Catan', 'Azul', 'Wingspan', 'Pandemic', 'Lost Cities', 'Mystery Box', 'Odd Id']);
  assert.equal(games.find((g) => g.name === 'Odd Id').id, '');
  assert.equal(games.find((g) => g.name === 'Azul').id, '230802');
});

test('no filters keeps every game', () => {
  assert.equal(pickableGames(games, themeMap).length, games.length);
});

test('players: the game must support that count; a game with no min/max is not hidden', () => {
  assert.deepEqual(names(pickableGames(games, themeMap, { players: 1 })), ['Wingspan', 'Mystery Box', 'Odd Id']);
  assert.deepEqual(names(pickableGames(games, themeMap, { players: 2 })), ['Azul', 'Wingspan', 'Pandemic', 'Lost Cities', 'Mystery Box', 'Odd Id']);
  assert.deepEqual(names(pickableGames(games, themeMap, { players: 5 })), ['Wingspan', 'Mystery Box']);
});

test('time: at most that many minutes; a game with no time listed still counts', () => {
  assert.deepEqual(names(pickableGames(games, themeMap, { maxTime: 30 })), ['Lost Cities', 'Mystery Box', 'Odd Id']);
  assert.deepEqual(names(pickableGames(games, themeMap, { maxTime: 60 })), ['Azul', 'Pandemic', 'Lost Cities', 'Mystery Box', 'Odd Id']);
  assert.deepEqual(TIME_STEPS, [15, 30, 45, 60, 90, 120]);
});

test('type: matches any one of a cell\'s modes, ignoring case, and leaves out games with no type', () => {
  assert.deepEqual(names(pickableGames(games, themeMap, { type: 'co-op' })), ['Azul', 'Pandemic']);
  assert.deepEqual(names(pickableGames(games, themeMap, { type: 'SOLO' })), ['Azul', 'Wingspan', 'Odd Id']);
  assert.deepEqual(names(pickableGames(games, themeMap, { type: 'team' })), ['Catan']);
});

test('themes: any selected category; games BGG has not described are left out', () => {
  assert.deepEqual(names(pickableGames(games, themeMap, { themes: ['Card Game'] })), ['Wingspan', 'Lost Cities']);
  assert.deepEqual(names(pickableGames(games, themeMap, { themes: ['Card Game', 'Medical'] })), ['Wingspan', 'Pandemic', 'Lost Cities']);
  assert.deepEqual(pickableGames(games, themeMap, { themes: ['Fantasy'] }), []);
});

test('filters combine', () => {
  assert.deepEqual(names(pickableGames(games, themeMap, { players: 2, maxTime: 45, type: 'co-op', themes: ['Medical'] })), ['Pandemic']);
  assert.deepEqual(pickableGames(games, themeMap, { players: 4, type: 'solo', themes: ['Puzzle'] }).map((g) => g.name), ['Azul']);
});

test('themeCounts counts each category and sorts the most common first', () => {
  const counts = themeCounts(games, themeMap);
  assert.deepEqual(counts[0], { name: 'Card Game', count: 2 });
  assert.equal(counts.length, 7);
  assert.deepEqual(themeCounts(pickableGames(games, themeMap, { type: 'co-op' }), themeMap).map((c) => c.name), ['Abstract Strategy', 'Medical', 'Puzzle']);
  assert.deepEqual(themeCounts([], themeMap), []);
});

test('categoriesFromLinks keeps only BGG categories', () => {
  const links = [
    { type: 'boardgamecategory', value: 'Fantasy' },
    { type: 'boardgamemechanic', value: 'Cooperative Game' },
    { type: 'boardgamecategory', value: 'Card Game' },
    { type: 'boardgamecategory', value: '' },
  ];
  assert.deepEqual(categoriesFromLinks(links), ['Fantasy', 'Card Game']);
  assert.deepEqual(categoriesFromLinks(), []);
});

// ---------- adding a game to the sheet and BGG ----------

test('addPlan: a game in neither place is added to the sheet and still missing on BGG', () => {
  const item = { id: '999', name: 'Brand New Game' };
  assert.deepEqual(addPlan(item, 'Brand New Game', rows, idx, [{ id: '13', name: 'Catan' }]), { sheet: 'add', bgg: 'missing' });
});

test('addPlan: finds the game in the sheet by BGG id or by name, ignoring case and punctuation', () => {
  assert.equal(addPlan({ id: '13', name: 'Something Else' }, 'x', rows, idx, null).sheet, 'have');
  assert.equal(addPlan({ id: '999', name: 'LOST cities!' }, 'x', rows, idx, null).sheet, 'have');
  assert.equal(addPlan({ id: '999', name: 'Different' }, 'azul', rows, idx, null).sheet, 'have', 'the title you typed counts too');
  assert.equal(addPlan({ id: '999', name: 'Different' }, 'nope', rows, idx, null).sheet, 'add');
});

test('addPlan: finds the game among your BGG games by id or name; unknown when that list is missing', () => {
  const owned = [{ id: '13', name: 'CATAN' }, { id: '5', name: "Uncle Ben's Game" }];
  assert.equal(addPlan({ id: '13', name: 'x' }, 'x', rows, idx, owned).bgg, 'have');
  assert.equal(addPlan({ id: '77', name: "uncle bens game" }, 'x', rows, idx, owned).bgg, 'have');
  assert.equal(addPlan({ id: '77', name: 'Other' }, 'x', rows, idx, owned).bgg, 'missing');
  assert.equal(addPlan({ id: '77', name: 'Other' }, 'x', rows, idx, null).bgg, 'unknown');
  assert.equal(addPlan({ id: '', name: 'Other' }, 'x', rows, idx, owned).bgg, 'unknown', 'no BGG id, so no page to send you to');
});

test('addPlan: a game in both places has nothing left to do', () => {
  assert.deepEqual(addPlan({ id: '13', name: 'Catan' }, 'Catan', rows, idx, [{ id: '13', name: 'Catan' }]), { sheet: 'have', bgg: 'have' });
});

test('matchKey ignores apostrophes, case and punctuation', () => {
  assert.equal(matchKey("Dead Man's Draw"), matchKey('dead mans draw'));
  assert.equal(matchKey('Dead Man’s Draw'), matchKey("Dead Man's Draw"));
  assert.equal(matchKey('Brass: Birmingham'), matchKey('brass birmingham'));
  assert.notEqual(matchKey('Catan'), matchKey('Catan Junior'));
});
