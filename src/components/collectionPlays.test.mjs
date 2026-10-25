// Run with: node --test src/components/collectionPlays.test.mjs
// The play log, the wishlist deck and the picker's "history" filters.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePlays, playStats, daysSince, pickableGames, sheetGames, parseCsv, buildHeaderIndex, matchKey, parseDecisions,
  wishlistQueue, saveDecisionViaScript, savePlayViaScript, WISHLIST_CHOICES, WISHLIST_TAB, PLAYS_TAB, DECISIONS_TAB,
} from './collectionUtils.js';

const DAY = 86400000;
const NOW = Date.parse('2026-10-25T12:00:00Z');
const mulberry32 = (a) => () => {
  a |= 0; a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

test('tab names and wishlist choices are what the sheet script expects', () => {
  assert.equal(PLAYS_TAB, 'Plays');
  assert.equal(WISHLIST_TAB, 'Wishlist');
  assert.equal(DECISIONS_TAB, 'Decisions');
  assert.deepEqual(WISHLIST_CHOICES, ['Buy', 'Drop', 'Later']);
});

test('parsePlays reads the Plays tab and ignores rows with no game', () => {
  const csv = 'Date,Game,Players,Winner,Notes\n2026-10-20,Catan,"Sam, Nalie",Nalie,"close, very close"\n2026-10-21,,Sam,Sam,\n2026-10-22,Azul,Sam,,\n';
  const plays = parsePlays(csv);
  assert.equal(plays.length, 2);
  assert.deepEqual(plays[0], { date: '2026-10-20', game: 'Catan', players: 'Sam, Nalie', winner: 'Nalie', notes: 'close, very close' });
  assert.equal(plays[1].winner, '');
});

test('a missing Plays tab (Google answers with the first sheet) counts as no plays', () => {
  assert.deepEqual(parsePlays('GAME,YEAR,MIN\nCatan,1995,3\n'), []);
  assert.deepEqual(parsePlays(''), []);
  assert.deepEqual(parsePlays(undefined), []);
  assert.equal(parsePlays('date,game\n2026-01-01,Catan\n').length, 1, 'header matching ignores case');
});

test('playStats counts plays per game (matching names loosely) and keeps the latest readable date', () => {
  const stats = playStats(parsePlays('Date,Game,Players,Winner,Notes\n2026-10-01,Dead Man\'s Draw,,,\n2026-10-20,dead mans draw,,,\n2026-09-01,Catan,,,\n,Azul,,,\nnot a date,Azul,,,\n'));
  assert.equal(stats.get(matchKey("Dead Man's Draw")).count, 2);
  assert.equal(stats.get(matchKey("Dead Man's Draw")).last, '2026-10-20');
  assert.equal(stats.get(matchKey('Catan')).count, 1);
  assert.equal(stats.get(matchKey('Azul')).count, 2);
  assert.equal(stats.get(matchKey('Azul')).lastTs, null, 'played, but when is unknown');
  assert.equal(stats.get(matchKey('Never Played')), undefined);
});

test('daysSince counts whole days and tolerates unreadable dates', () => {
  assert.equal(daysSince(NOW - 3 * DAY - 1000, NOW), 3);
  assert.equal(daysSince(NOW + DAY, NOW), 0);
  assert.equal(daysSince(null, NOW), null);
});

const table = parseCsv('GAME,YEAR,MIN,MAX,TIME,TYPE,BGG RATING,IMAGE,BGGID\nCatan,1995,3,4,90,Team,7.1,,13\nAzul,2017,2,4,45,Solo,7.8,,230802\nWingspan,2019,1,5,70,Solo,8.1,,266192\nPandemic,2008,2,4,45,Co-op,7.6,,30549\nLost Cities,1999,2,2,30,,7.2,,50\n');
const games = sheetGames(table.slice(1), buildHeaderIndex(table[0]));
const names = (list) => list.map((g) => g.name);
const stats = playStats(parsePlays([
  'Date,Game,Players,Winner,Notes',
  '2026-10-20,Catan,,,',            // 5 days ago
  '2026-08-01,Azul,,,',             // 85 days ago
  '2026-09-01,Pandemic,,,',         // 54 days ago
  'who knows,Wingspan,,,',          // played, date unreadable
].join('\n')));

test('picker history: never played / not in a while', () => {
  assert.deepEqual(names(pickableGames(games, {}, { history: 'never', stats, now: NOW })), ['Lost Cities']);
  assert.deepEqual(names(pickableGames(games, {}, { history: 'stale', stats, now: NOW })), ['Azul', 'Pandemic', 'Lost Cities']);
  assert.deepEqual(names(pickableGames(games, {}, { history: 'stale', staleDays: 60, stats, now: NOW })), ['Azul', 'Lost Cities']);
  assert.equal(pickableGames(games, {}, { history: 'never', stats: null, now: NOW }).length, 5, 'no play log at all: every game is unplayed');
  assert.equal(pickableGames(games, {}, { history: '', stats, now: NOW }).length, 5);
});

test('picker can leave out games marked Discard, and combines with the other filters', () => {
  const exclude = new Set([matchKey('Azul'), matchKey('Lost Cities')]);
  assert.deepEqual(names(pickableGames(games, {}, { exclude })), ['Catan', 'Wingspan', 'Pandemic']);
  assert.deepEqual(names(pickableGames(games, {}, { exclude, players: 2, history: 'stale', stats, now: NOW })), ['Pandemic']);
});

test('wishlistQueue leaves out answered games and puts BGG must-haves first', () => {
  const list = [
    { name: 'Low', priority: '5' }, { name: 'Must A', priority: '1' }, { name: 'None', priority: '' },
    { name: 'Like', priority: '3' }, { name: 'Must B', priority: '1' }, { name: 'Done', priority: '1' },
  ];
  const answered = parseDecisions('Game,Choice\ndone,Buy\n');
  const out = wishlistQueue(list, answered, mulberry32(4)).map((g) => g.name);
  assert.equal(out.length, 5);
  assert.deepEqual(out.slice(0, 2).sort(), ['Must A', 'Must B']);
  assert.deepEqual(out.slice(2), ['Like', 'Low', 'None']);
});

const reply = (body) => async () => ({ ok: true, status: 200, json: async () => body });

test('saveDecisionViaScript names the tab; other tabs need a script that has proved it is current', async () => {
  const sent = [];
  global.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    sent.push(body);
    return { ok: true, status: 200, json: async () => (body.ping ? { ok: true, kind: 'ping', version: 3 } : { ok: true, kind: 'decision', tab: body.decision.tab }) };
  };
  assert.equal(await saveDecisionViaScript('https://current/exec', 'Catan', 'Buy', 'Wishlist'), true);
  assert.deepEqual(sent.map((b) => Object.keys(b)[0]), ['ping', 'decision']);
  assert.deepEqual(sent[1], { decision: { game: 'Catan', choice: 'Buy', tab: 'Wishlist' } });
  await saveDecisionViaScript('https://current/exec', 'Azul', 'Later', 'Wishlist');
  assert.equal(sent.length, 3, 'the version check is only made once per script');
  await saveDecisionViaScript('https://current/exec', 'Catan', 'Keep');
  assert.equal(sent[3].decision.tab, 'Decisions');
  assert.equal(sent.length, 4, 'the original Decisions tab needs no check');
});

test('an older script never gets a wishlist answer, because it would file it in Decisions', async () => {
  const sent = [];
  // what an older script does: it doesn't know about ping, so it errors, and it answers a decision without a tab
  global.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    sent.push(body);
    if (body.ping) return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ ok: true, kind: 'decision' }) };
  };
  await assert.rejects(() => saveDecisionViaScript('https://old/exec', 'Catan', 'Buy', 'Wishlist'), /did not confirm saving/);
  assert.deepEqual(sent.map((b) => Object.keys(b)[0]), ['ping'], 'no decision request was sent');
  // a script that answers ping with something else is no better
  global.fetch = reply({ ok: true, kind: 'decision' });
  await assert.rejects(() => saveDecisionViaScript('https://odd/exec', 'Catan', 'Buy', 'Wishlist'), /did not confirm saving/);
  assert.equal(await saveDecisionViaScript('https://old/exec', 'Catan', 'Keep'), true, 'but the original Decisions tab still works with it');
});

test('savePlayViaScript sends the play and needs the script to confirm it', async () => {
  const sent = [];
  global.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ ok: true, kind: 'play' }) }; };
  const play = { date: '2026-10-25', game: 'Catan', players: 'Sam, Nalie', winner: 'Nalie', notes: '' };
  assert.equal(await savePlayViaScript('x', play), true);
  assert.deepEqual(sent[0], { play });
  global.fetch = reply({ ok: true });
  await assert.rejects(() => savePlayViaScript('x', play), /did not confirm saving/);
  global.fetch = reply({ ok: false, error: 'boom' });
  await assert.rejects(() => savePlayViaScript('x', play), /boom/);
  global.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  await assert.rejects(() => savePlayViaScript('x', play), /500/);
});
