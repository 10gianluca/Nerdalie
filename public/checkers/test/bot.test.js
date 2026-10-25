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
const M0 = 0, K0 = 1, M1 = 2;

const randomAgent = (rng) => (s, seat) => {
  const m = G.legalMoves(s, seat);
  return { type: 'move', path: m[Math.floor(rng() * m.length)].path };
};

function play(agents, seed) {
  let s = G.newGame(['A', 'B'], seed % 2);
  for (let step = 0; step < 400 && s.phase === 'play'; step++) {
    const seat = s.active;
    const action = agents[seat](s, seat);
    assert.ok(action, `no action for seat ${seat}`);
    s = G.apply(s, seat, action); // throws if the rules refuse it
  }
  return s;
}

test('every level only plays legal moves, jumps included, from the opening to the end', () => {
  for (const level of Bot.LEVELS) {
    for (let seed = 1; seed <= 3; seed++) {
      const rng = mulberry32(seed + 40);
      const bot = (s, seat) => Bot.choose(s, seat, rng, level);
      assert.ok(play([bot, bot], seed).turn > 3);
    }
  }
});

test('the bot answers null when it is not its turn or the game is over', () => {
  const s = G.newGame(['A', 'B'], 0);
  assert.equal(Bot.choose(s, 1, mulberry32(1), 'hard'), null);
  const over = play([randomAgent(mulberry32(1)), randomAgent(mulberry32(2))], 5);
  if (over.phase === 'over') assert.equal(Bot.choose(over, 0, mulberry32(1), 'hard'), null);
});

test('it takes the compulsory jump, and the longest chain when that is the best', () => {
  const s = G.newGame(['A', 'B'], 0);
  s.board = Array(64).fill(-1);
  s.board[at(1, 6)] = M0; s.board[at(2, 5)] = M1; s.board[at(4, 3)] = M1; s.board[at(6, 1)] = M1; s.board[at(6, 7)] = M0;
  const a = Bot.choose(s, 0, mulberry32(3), 'hard');
  assert.deepEqual(a.path, [at(1, 6), at(3, 4), at(5, 2), at(7, 0)]);
  for (const level of ['easy', 'normal']) {
    const m = Bot.choose(s, 0, mulberry32(3), level);
    assert.ok(G.legalMoves(s, 0).some((x) => x.path.join() === m.path.join()), `${level} plays a legal move`);
  }
});

test('hard does not leave a piece to be captured for free when it can avoid it', () => {
  // seat 0's man on (3,5) can step to (2,4), where the enemy man on (1,3) would take it, or to (4,4), which is safe
  const s = G.newGame(['A', 'B'], 0);
  s.board = Array(64).fill(-1);
  s.board[at(3, 5)] = M0; s.board[at(1, 3)] = M1; s.board[at(7, 7)] = K0;
  const a = Bot.choose(s, 0, mulberry32(2), 'hard');
  assert.ok(G.legalMoves(s, 0).some((x) => x.path.join() === a.path.join()));
  const after = G.apply(s, 0, a);
  const replies = G.legalMoves(after, 1);
  assert.ok(!replies.some((m) => m.captures.length > 0 && m.captures.includes(after.last.path[after.last.path.length - 1])), 'the man it moved cannot be captured');
});

test('hard answers within a reasonable time', () => {
  const rng = mulberry32(8);
  let worst = 0;
  let s = G.newGame(['A', 'B'], 0);
  for (let step = 0; step < 40 && s.phase === 'play'; step++) {
    const t0 = Date.now();
    const a = Bot.choose(s, s.active, rng, 'hard');
    worst = Math.max(worst, Date.now() - t0);
    s = G.apply(s, s.active, a);
  }
  assert.ok(worst < 4000, `slowest move took ${worst} ms`);
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
      const s = play(swap ? [B, A] : [A, B], 4000 + i);
      if (s.phase === 'over' && s.end.winner === (swap ? 1 : 0)) aw++;
    }
    return aw / n;
  };
  for (const level of Bot.LEVELS) assert.ok(rate(level, 'random', 16) > 0.7, `${level} should beat random play`);
  assert.ok(rate('normal', 'easy', 12) > 0.7, 'normal beats easy');
  assert.ok(rate('hard', 'normal', 8) > 0.5, 'hard beats normal');
});
