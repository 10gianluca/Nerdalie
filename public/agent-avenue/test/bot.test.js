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
    if (view.phase === 'offer' && view.active === seat) {
      const hand = view.players[seat].hand;
      const pairs = [];
      for (const a of hand) for (const b of hand) if (G.legalPair(hand, a, b)) pairs.push([a, b]);
      const [up, down] = pairs[Math.floor(rng() * pairs.length)];
      return { type: 'offer', up, down };
    }
    if (view.phase === 'choose' && view.active !== seat) return { type: 'choose', pick: rng() < 0.5 ? 'up' : 'down' };
    return null;
  };
}

function botAgent(rng) {
  return (view, seat) => Bot.choose(view, seat, rng);
}

function play(agents, seed) {
  const rng = mulberry32(seed);
  let s = G.newGame(['A', 'B'], seed % 2, rng);
  for (let step = 0; step < 500; step++) {
    if (s.phase === 'over') return s;
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

test('bot vs bot: 150 games always finish with only legal actions', () => {
  for (let seed = 1; seed <= 150; seed++) {
    const s = play([botAgent(mulberry32(seed)), botAgent(mulberry32(seed + 1))], seed);
    assert.equal(s.phase, 'over');
    assert.ok(s.end);
  }
});

test('bot beats a random legal player most of the time, from either seat', () => {
  let wins = 0;
  const games = 200;
  for (let seed = 1; seed <= games; seed++) {
    const botSeat = seed % 2;
    const bot = botAgent(mulberry32(seed));
    const rnd = randomAgent(mulberry32(seed + 9000));
    const s = play(botSeat === 0 ? [bot, rnd] : [rnd, bot], seed);
    if (s.end.winner === botSeat) wins++;
  }
  assert.ok(wins >= 150, `bot only won ${wins}/${games}`);
});

test('difficulty levels: hard beats easy clearly, from either seat', () => {
  let wins = 0;
  const games = 150;
  for (let seed = 1; seed <= games; seed++) {
    const hardSeat = seed % 2;
    const rngH = mulberry32(seed);
    const rngE = mulberry32(seed + 77);
    const hard = (v, s) => Bot.choose(v, s, rngH, 'hard');
    const easy = (v, s) => Bot.choose(v, s, rngE, 'easy');
    const s = play(hardSeat === 0 ? [hard, easy] : [easy, hard], seed);
    if (s.end.winner === hardSeat) wins++;
  }
  assert.ok(wins >= 85, `hard only won ${wins}/${games} against easy`);
});
