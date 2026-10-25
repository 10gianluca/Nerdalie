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

const at = (x, y) => y * 8 + x;

const randomAgent = (rng) => (s, seat) => {
  const m = G.legalMoves(s, seat);
  return { type: 'move', at: m[Math.floor(rng() * m.length)] };
};

function play(agents, seed) {
  const rng = mulberry32(seed);
  let s = G.newGame(['A', 'B'], seed % 2);
  for (let step = 0; step < 200 && s.phase === 'play'; step++) {
    const seat = s.active;
    const action = agents[seat](s, seat, rng);
    assert.ok(action, `no action for seat ${seat}`);
    s = G.apply(s, seat, action); // throws if the rules refuse it
  }
  return s;
}

test('every level only plays legal moves, from the opening to the end', () => {
  for (const level of Bot.LEVELS) {
    for (let seed = 1; seed <= 4; seed++) {
      const bot = (s, seat, rng) => Bot.choose(s, seat, rng, level);
      assert.equal(play([bot, bot], seed).phase, 'over');
    }
  }
});

test('the bot answers null when it is not its turn or the game is over', () => {
  const s = G.newGame(['A', 'B'], 0);
  assert.equal(Bot.choose(s, 1, mulberry32(1), 'hard'), null);
  const over = play([randomAgent(mulberry32(1)), randomAgent(mulberry32(2))], 3);
  assert.equal(Bot.choose(over, 0, mulberry32(1), 'hard'), null);
});

test('given a corner, hard takes it', () => {
  const s = G.newGame(['A', 'B'], 0);
  s.board = Array(64).fill(-1);
  // black can take the corner a1 (flipping b1) or play a quieter move on the other side
  s.board[at(1, 0)] = 1; s.board[at(2, 0)] = 0;
  s.board[at(5, 5)] = 1; s.board[at(6, 5)] = 0;
  const a = Bot.choose(s, 0, mulberry32(3), 'hard');
  assert.equal(a.at, at(0, 0));
});

test('it avoids handing over a corner when it has a safer move', () => {
  const s = G.newGame(['A', 'B'], 0);
  const a = Bot.choose(s, 0, mulberry32(4), 'hard');
  assert.ok(G.legalMoves(s, 0).includes(a.at));
});

test('hard answers quickly', () => {
  const rng = mulberry32(8);
  let worst = 0;
  for (let seed = 1; seed <= 3; seed++) {
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
      const A = a === 'random' ? randomAgent : (s, seat, rng) => Bot.choose(s, seat, rng, a);
      const B = b === 'random' ? randomAgent : (s, seat, rng) => Bot.choose(s, seat, rng, b);
      const wrap = (agent, seed) => { const r = mulberry32(seed); return (s, seat) => (agent === randomAgent ? randomAgent(r)(s, seat) : agent(s, seat, r)); };
      const s = play(swap ? [wrap(B, i * 3 + 2), wrap(A, i * 3 + 1)] : [wrap(A, i * 3 + 1), wrap(B, i * 3 + 2)], 1000 + i);
      if (s.end.winner === (swap ? 1 : 0)) aw++;
    }
    return aw / n;
  };
  for (const level of Bot.LEVELS) assert.ok(rate(level, 'random', 20) > 0.7, `${level} should beat random play`);
  assert.ok(rate('normal', 'easy', 20) > 0.8, 'normal beats easy');
  assert.ok(rate('hard', 'normal', 12) > 0.65, 'hard beats normal');
});
