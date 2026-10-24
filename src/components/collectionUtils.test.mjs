// Run with: node --test src/components/collectionUtils.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDecisions, undecidedGames, shuffled, saveDecisionViaScript, matchKey, CHOICES, DECISIONS_TAB } from './collectionUtils.js';

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
  assert.deepEqual(sent[0].body, { decision: { game: 'Catan', choice: 'Keep' } });
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
