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

const empty = () => Array(16).fill(-1);

const randomAgent = (rng) => (s, seat) => {
  if (s.phase === 'give') return { type: 'give', piece: s.pool[Math.floor(rng() * s.pool.length)] };
  const c = G.legalPlaces(s, seat);
  return { type: 'place', at: c[Math.floor(rng() * c.length)] };
};

function play(agents, seed) {
  let s = G.newGame(['A', 'B'], seed % 2);
  for (let step = 0; step < 60 && s.phase !== 'over'; step++) {
    const seat = s.active;
    const action = agents[seat](s, seat);
    assert.ok(action, `no action for seat ${seat}`);
    s = G.apply(s, seat, action); // throws if the rules refuse it
  }
  return s;
}

test('every level only plays what the rules allow, from the first piece to the end', () => {
  for (const level of Bot.LEVELS) {
    for (let seed = 1; seed <= 4; seed++) {
      const rng = mulberry32(seed + 10);
      const bot = (s, seat) => Bot.choose(s, seat, rng, level);
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

test('given a piece that finishes a line, it places it there', () => {
  const s = G.newGame(['A', 'B'], 0);
  s.board = empty();
  s.board[0] = 1; s.board[1] = 3; s.board[2] = 5; // three tall solid pieces
  s.pool = s.pool.filter((p) => ![1, 3, 5, 9].includes(p));
  s.phase = 'place';
  s.hand = 9; // tall, so it completes the row
  s.active = 1;
  for (const level of ['normal', 'hard']) assert.deepEqual(Bot.choose(s, 1, mulberry32(2), level), { type: 'place', at: 3 }, level);
});

test('it never gives away a piece the other player can win with, when it has a safe one', () => {
  const s = G.newGame(['A', 'B'], 0);
  s.board = empty();
  s.board[0] = 1; s.board[1] = 3; s.board[2] = 5; // anything tall (or solid) wins at square 3
  s.pool = s.pool.filter((p) => ![1, 3, 5].includes(p));
  s.phase = 'give';
  s.active = 0;
  const winners = new Set(s.pool.filter((p) => G.winningSquares(s.board, p).length));
  assert.ok(winners.size > 0 && winners.size < s.pool.length);
  for (const level of Bot.LEVELS) {
    for (let seed = 1; seed <= 8; seed++) {
      const a = Bot.choose(s, 0, mulberry32(seed), level);
      if (level === 'easy' && seed > 3) continue; // easy is allowed an occasional slip
      assert.equal(a.type, 'give');
      if (level !== 'easy') assert.ok(!winners.has(a.piece), `${level} gave away a winning piece (${a.piece})`);
    }
  }
});

test('hard finds a legal square in a tight endgame', () => {
  // two squares left. Placing 8 at square 14 leaves only piece 2, which wins at square 15 for whoever places it.
  const s = G.newGame(['A', 'B'], 0);
  const b = [0, 15, 3, 12, 9, 6, 10, 5, 14, 1, 13, -1, 7, 11, -1, -1];
  // fill with a position that has no line yet and three empty squares, then let hard find a non-losing way through
  s.board = b;
  const used = new Set(b.filter((p) => p >= 0));
  s.pool = Array.from({ length: 16 }, (_, i) => i).filter((p) => !used.has(p) && p !== 2);
  s.hand = 2;
  s.phase = 'place';
  s.active = 0;
  const a = Bot.choose(s, 0, mulberry32(4), 'hard');
  assert.equal(a.type, 'place');
  assert.ok(G.legalPlaces(s, 0).includes(a.at));
});

test('hard answers quickly', () => {
  const rng = mulberry32(8);
  let worst = 0;
  for (let seed = 1; seed <= 3; seed++) {
    let s = G.newGame(['A', 'B'], seed % 2);
    while (s.phase !== 'over') {
      const t0 = Date.now();
      const a = Bot.choose(s, s.active, rng, 'hard');
      worst = Math.max(worst, Date.now() - t0);
      s = G.apply(s, s.active, a);
    }
  }
  assert.ok(worst < 5000, `slowest decision took ${worst} ms`);
});

test('every level beats random play, and the levels are ordered', () => {
  const rate = (a, b, n) => {
    let aw = 0;
    let decisive = 0;
    for (let i = 0; i < n; i++) {
      const swap = i % 2;
      const rngA = mulberry32(i * 5 + 1);
      const rngB = mulberry32(i * 5 + 2);
      const A = a === 'random' ? randomAgent(rngA) : (s, seat) => Bot.choose(s, seat, rngA, a);
      const B = b === 'random' ? randomAgent(rngB) : (s, seat) => Bot.choose(s, seat, rngB, b);
      const s = play(swap ? [B, A] : [A, B], 3000 + i);
      if (s.end.winner != null) {
        decisive += 1;
        if (s.end.winner === (swap ? 1 : 0)) aw++;
      }
    }
    return { win: aw / n, lose: (decisive - aw) / n };
  };
  for (const level of Bot.LEVELS) assert.ok(rate(level, 'random', 24).win > 0.7, `${level} should beat random play`);
  const nm = rate('normal', 'easy', 24);
  assert.ok(nm.win > nm.lose + 0.3, 'normal beats easy');
  const hn = rate('hard', 'normal', 16);
  assert.ok(hn.win >= hn.lose, 'hard is not worse than normal');
});
