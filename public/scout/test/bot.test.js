const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../game.js');
const Bot = require('../bot.js');

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomAgent(rng) {
  return (view, seat) => {
    const me = view.players[seat];
    if (view.phase === 'orient') return me.ready ? null : { type: 'ready', flip: rng() < 0.5 };
    if (view.phase !== 'play' || view.active !== seat) return null;
    const shows = G.legalShows(me.hand, view.table);
    const scouts = [];
    if (view.table && me.chips > 0) {
      for (const end of ['left', 'right']) scouts.push({ type: 'scout', end, insertAt: Math.floor(rng() * (me.hand.length + 1)), flip: rng() < 0.5 });
    }
    const all = [...shows.map((s) => ({ type: 'show', from: s.from, to: s.to })), ...scouts];
    return all[Math.floor(rng() * all.length)] || null;
  };
}

const botAgent = (rng) => (view, seat) => Bot.choose(view, seat, rng);

function play(agents, seed) {
  const rng = mulberry32(seed);
  let s = G.newGame(['A', 'B'], seed % 2, rng);
  for (let step = 0; step < 1500; step++) {
    if (s.phase === 'over') return s;
    if (s.phase === 'roundover') {
      s = G.apply(s, 0, { type: 'next' }, rng);
      continue;
    }
    let moved = false;
    for (const seat of [0, 1]) {
      const action = agents[seat](G.viewFor(s, seat), seat);
      if (!action) continue;
      s = G.apply(s, seat, action, rng);
      moved = true;
      break;
    }
    assert.ok(moved, `stuck in phase ${s.phase} (turn ${s.turn})`);
  }
  assert.fail('game did not finish');
}

test('bot vs bot: 80 games always finish with only legal actions', () => {
  for (let seed = 1; seed <= 80; seed++) {
    const s = play([botAgent(mulberry32(seed)), botAgent(mulberry32(seed + 1))], seed);
    assert.equal(s.phase, 'over');
    assert.equal(s.history.length, 2);
  }
});

test('bot beats a random legal player most of the time, from either seat', () => {
  let wins = 0;
  const games = 120;
  for (let seed = 1; seed <= games; seed++) {
    const botSeat = seed % 2;
    const bot = botAgent(mulberry32(seed));
    const rnd = randomAgent(mulberry32(seed + 9000));
    const s = play(botSeat === 0 ? [bot, rnd] : [rnd, bot], seed);
    if (s.end.winner === botSeat) wins++;
  }
  assert.ok(wins >= 100, `bot only won ${wins}/${games}`);
});

test('difficulty levels: hard beats easy clearly, from either seat', () => {
  let wins = 0;
  const games = 100;
  for (let seed = 1; seed <= games; seed++) {
    const hardSeat = seed % 2;
    const rngH = mulberry32(seed);
    const rngE = mulberry32(seed + 77);
    const hard = (v, s) => Bot.choose(v, s, rngH, 'hard');
    const easy = (v, s) => Bot.choose(v, s, rngE, 'easy');
    const s = play(hardSeat === 0 ? [hard, easy] : [easy, hard], seed);
    if (s.end.winner === hardSeat) wins++;
  }
  assert.ok(wins >= 75, `hard only won ${wins}/${games} against easy`);
});
