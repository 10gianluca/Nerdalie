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

const randomAgent = (rng) => (s, seat) => {
  const m = G.legalPits(s, seat);
  return { type: 'sow', pit: m[Math.floor(rng() * m.length)] };
};

function play(agents, seed) {
  let s = G.newGame(['A', 'B'], seed % 2);
  for (let step = 0; step < 400 && s.phase === 'play'; step++) {
    const seat = s.active;
    const action = agents[seat](s, seat);
    assert.ok(action, `no action for seat ${seat}`);
    s = G.apply(s, seat, action);
  }
  return s;
}

test('every level only plays pits that have seeds, through to the end', () => {
  for (const level of Bot.LEVELS) {
    for (let seed = 1; seed <= 6; seed++) {
      const rng = mulberry32(seed + 30);
      const bot = (s, seat) => Bot.choose(s, seat, rng, level);
      assert.equal(play([bot, bot], seed).phase, 'over');
    }
  }
});

test('the bot answers null when it is not its turn or the game is over', () => {
  const s = G.newGame(['A', 'B'], 0);
  assert.equal(Bot.choose(s, 1, mulberry32(1), 'hard'), null);
  const over = play([randomAgent(mulberry32(1)), randomAgent(mulberry32(2))], 4);
  assert.equal(Bot.choose(over, 0, mulberry32(1), 'hard'), null);
});

test('it takes a free turn when one is on offer', () => {
  // pit 2 holds 4 seeds and lands exactly in the store
  const s = G.newGame(['A', 'B'], 0);
  s.pits = [1, 5, 4, 7, 6, 8, 0, 4, 4, 4, 4, 4, 4, 0];
  for (const level of ['normal', 'hard']) {
    assert.deepEqual(Bot.choose(s, 0, mulberry32(2), level), { type: 'sow', pit: 2 }, level);
  }
});

test('it takes a capture when one is on offer', () => {
  // pit 0's seed lands in empty pit 1 (across from 12 seeds); pit 2's lands in empty pit 3 (across from nothing)
  const s = G.newGame(['A', 'B'], 0);
  s.pits = [1, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1, 12, 1, 0];
  assert.equal(Bot.choose(s, 0, mulberry32(2), 'hard').pit, 0);
  assert.equal(Bot.choose(s, 0, mulberry32(2), 'normal').pit, 0);
});

test('hard answers quickly', () => {
  const rng = mulberry32(8);
  let worst = 0;
  for (let seed = 1; seed <= 4; seed++) {
    let s = G.newGame(['A', 'B'], seed % 2);
    while (s.phase === 'play') {
      const t0 = Date.now();
      const a = Bot.choose(s, s.active, rng, 'hard');
      worst = Math.max(worst, Date.now() - t0);
      s = G.apply(s, s.active, a);
    }
  }
  assert.ok(worst < 2500, `slowest move took ${worst} ms`);
});

test('every level beats random play, and the levels are ordered', () => {
  const rate = (a, b, n) => {
    let aw = 0;
    for (let i = 0; i < n; i++) {
      const swap = i % 2;
      const rngA = mulberry32(i * 5 + 1);
      const rngB = mulberry32(i * 5 + 2);
      const A = a === 'random' ? randomAgent(rngA) : (s, seat) => Bot.choose(s, seat, rngA, a);
      const B = b === 'random' ? randomAgent(rngB) : (s, seat) => Bot.choose(s, seat, rngB, b);
      const s = play(swap ? [B, A] : [A, B], 2000 + i);
      if (s.end.winner === (swap ? 1 : 0)) aw++;
    }
    return aw / n;
  };
  for (const level of Bot.LEVELS) assert.ok(rate(level, 'random', 30) > 0.7, `${level} should beat random play`);
  assert.ok(rate('normal', 'easy', 30) > 0.65, 'normal beats easy');
  assert.ok(rate('hard', 'normal', 20) > 0.6, 'hard beats normal');
});
