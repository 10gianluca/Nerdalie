const test = require('node:test');
const assert = require('node:assert/strict');
const { createHub, summarize, formatRecord } = require('../hub.js');

const fakeStorage = () => {
  const data = new Map();
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k), data };
};

test('summarize tallies online and computer games apart, per game, by level and by opponent', () => {
  const results = [
    { game: 'lost-cities', title: 'Lost Cities', mode: 'online', opponent: 'Sam', outcome: 'win', at: 1 },
    { game: 'lost-cities', title: 'Lost Cities', mode: 'online', opponent: 'sam ', outcome: 'loss', at: 2 },
    { game: 'lost-cities', title: 'Lost Cities', mode: 'solo', level: 'hard', outcome: 'loss', at: 3 },
    { game: 'scout', title: 'Scout', mode: 'online', opponent: 'Sam', outcome: 'draw', at: 4 },
    { game: 'scout', title: 'Scout', mode: 'solo', level: 'easy', outcome: 'win', at: 5 },
    { game: 'hocus-pocus', title: 'Hocus Pocus', mode: 'online', opponent: 'Sam', outcome: 'win', coop: true, at: 6 },
  ];
  const s = summarize(results);
  assert.deepEqual(s.online, { w: 2, l: 1, d: 1 });
  assert.deepEqual(s.solo, { w: 1, l: 1, d: 0 });
  assert.deepEqual(s.byGame['lost-cities'].online, { w: 1, l: 1, d: 0 });
  assert.deepEqual(s.byGame['lost-cities'].levels.hard, { w: 0, l: 1, d: 0 });
  assert.deepEqual(s.byGame.scout.levels.easy, { w: 1, l: 0, d: 0 });
  assert.equal(s.byGame['hocus-pocus'].coop, true);
  assert.equal(s.byGame.scout.last, 5);
  // names match ignoring case and spacing; a co-op game is not a head-to-head
  assert.deepEqual(Object.keys(s.byOpponent), ['sam']);
  assert.deepEqual({ ...s.byOpponent.sam }, { name: 'Sam', w: 1, l: 1, d: 1, last: 4 });
  assert.equal(s.total, 6);
});

test('summarize of nothing is all zeros', () => {
  const s = summarize([]);
  assert.deepEqual(s.online, { w: 0, l: 0, d: 0 });
  assert.deepEqual(s.byGame, {});
});

test('formatRecord shows draws only when there are some', () => {
  assert.equal(formatRecord({ w: 5, l: 3, d: 0 }), '5–3');
  assert.equal(formatRecord({ w: 5, l: 3, d: 1 }), '5–3–1');
});

test('report keeps one entry per game and only moves its timestamp when something changed', () => {
  let t = 100;
  const hub = createHub(fakeStorage(), { now: () => t });
  hub.report('scout', { title: 'Scout', status: 'waiting', mode: 'online', opponent: 'Sam', level: '', code: 'AB12' });
  t = 200;
  hub.report('scout', { title: 'Scout', status: 'waiting', mode: 'online', opponent: 'Sam', level: '', code: 'AB12' });
  assert.equal(hub.games().scout.at, 100);
  t = 300;
  hub.report('scout', { title: 'Scout', status: 'your-turn', mode: 'online', opponent: 'Sam', level: '', code: 'AB12' });
  assert.equal(hub.games().scout.at, 300);
  assert.equal(hub.games().scout.status, 'your-turn');
  hub.clear('scout');
  assert.deepEqual(hub.games(), {});
  assert.deepEqual(hub.inProgress(), []);
});

test('inProgress lists the most recently active game first', () => {
  let t = 1;
  const hub = createHub(fakeStorage(), { now: () => t++ });
  hub.report('a', { title: 'A', status: 'waiting' });
  hub.report('b', { title: 'B', status: 'your-turn' });
  hub.report('a', { title: 'A', status: 'your-turn' });
  assert.deepEqual(hub.inProgress().map((g) => g.id), ['a', 'b']);
});

test('a game handle: sync reports status, finish records, leave clears', () => {
  const hub = createHub(fakeStorage(), { now: () => 7 });
  const game = hub.game('toy-battle', 'Toy Battle');
  game.sync({ needsMe: true, over: false, solo: false, opponent: 'Sam', code: 'ZZ99' });
  assert.deepEqual({ ...hub.games()['toy-battle'] }, { id: 'toy-battle', title: 'Toy Battle', status: 'your-turn', mode: 'online', opponent: 'Sam', level: '', code: 'ZZ99', at: 7 });
  game.sync({ needsMe: false, over: true, solo: true, opponent: 'Computer', level: 'hard' });
  assert.equal(hub.games()['toy-battle'].status, 'over');
  assert.equal(hub.games()['toy-battle'].level, 'hard');
  game.finish({ mode: 'solo', level: 'hard', opponent: 'Computer', outcome: 'loss', detail: '3–5' });
  assert.deepEqual({ ...hub.results()[0] }, { game: 'toy-battle', title: 'Toy Battle', mode: 'solo', level: 'hard', opponent: 'Computer', outcome: 'loss', detail: '3–5', at: 7 });
  game.leave();
  assert.deepEqual(hub.games(), {});
  assert.equal(hub.results().length, 1, 'results stay after leaving');
});

test('alerts fire when the move passes to you in an online game, not on the first draw or against the computer', () => {
  const pings = [];
  const hub = createHub(fakeStorage(), { alertTurn: (title) => pings.push(title) });
  const game = hub.game('scout', 'Scout');
  game.sync({ needsMe: true, over: false, solo: false }); // page opened mid-turn: no ping
  game.sync({ needsMe: false, over: false, solo: false });
  game.sync({ needsMe: false, over: false, solo: false });
  assert.deepEqual(pings, []);
  game.sync({ needsMe: true, over: false, solo: false }); // the opponent moved
  assert.deepEqual(pings, ['Scout']);
  game.sync({ needsMe: true, over: false, solo: false }); // redrawn, still your move: no second ping
  assert.deepEqual(pings, ['Scout']);
  game.sync({ needsMe: false, over: false, solo: false });
  game.sync({ needsMe: true, over: true, solo: false }); // the game ended: no ping
  assert.deepEqual(pings, ['Scout']);

  const solo = hub.game('lost-cities', 'Lost Cities');
  solo.sync({ needsMe: false, over: false, solo: true });
  solo.sync({ needsMe: true, over: false, solo: true });
  assert.deepEqual(pings, ['Scout'], 'the computer replying is not worth a ping');
});

test('results are capped and prefs merge over the defaults', () => {
  const hub = createHub(fakeStorage(), { now: () => 1 });
  for (let i = 0; i < 505; i++) hub.record({ game: 'g', outcome: 'win', mode: 'online', n: i });
  assert.equal(hub.results().length, 500);
  assert.equal(hub.results()[0].n, 5, 'the oldest are dropped');
  assert.deepEqual(hub.prefs(), { sound: true, title: true, notify: false });
  hub.setPrefs({ sound: false });
  assert.deepEqual(hub.prefs(), { sound: false, title: true, notify: false });
  hub.clearResults();
  assert.deepEqual(hub.results(), []);
});

test('storage that throws never breaks a game', () => {
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); }, removeItem() {} };
  const hub = createHub(broken);
  assert.doesNotThrow(() => { hub.report('a', { title: 'A', status: 'waiting' }); hub.record({ game: 'a', outcome: 'win' }); hub.clear('a'); });
  assert.deepEqual(hub.results(), []);
});
