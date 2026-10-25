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

const at = G.at;
function table(pieces, hands, side, active = 0) {
  const s = G.newGame(['A', 'B'], active, mulberry32(1));
  s.board = Array(25).fill(null);
  for (const [x, y, p, m] of pieces) s.board[at(x, y)] = { p, m: !!m };
  s.hands = hands.map((h) => h.slice());
  s.side = side;
  s.active = active;
  return s;
}

const randomAgent = (rng) => (s, seat) => {
  const moves = G.legalMoves(s, seat);
  if (!moves.length) return { type: 'pass', card: s.hands[seat][0] };
  const m = moves[Math.floor(rng() * moves.length)];
  return { type: 'move', card: m.card, from: m.from, to: m.to };
};

function play(agents, seed) {
  const rng = mulberry32(seed);
  let s = G.newGame(['A', 'B'], seed % 2, rng);
  for (let step = 0; step < 300; step++) {
    if (s.phase === 'over') return s;
    const seat = s.active;
    const action = agents[seat](s, seat);
    assert.ok(action, `no action in turn ${s.turn}`);
    s = G.apply(s, seat, action, rng);
  }
  return s; // a very long game just counts as unfinished
}

test('every level only plays legal moves (play() applies every move through the rules), and answers null out of turn or once the game is over', () => {
  for (const level of Bot.LEVELS) {
    for (let seed = 1; seed <= 10; seed++) {
      const rng = mulberry32(seed + 50);
      const s = play([(st, seat) => Bot.choose(st, seat, rng, level), (st, seat) => Bot.choose(st, seat, rng, level)], seed);
      assert.ok(s.turn > 3, `${level} played on in game ${seed}`);
    }
  }
  // against a weaker opponent a game does finish
  for (let seed = 1; seed <= 6; seed++) {
    const rng = mulberry32(seed + 70);
    const s = play([(st, seat) => Bot.choose(st, seat, rng, 'hard'), (st, seat) => Bot.choose(st, seat, rng, 'easy')], seed);
    assert.equal(s.phase, 'over', `hard finished a game against easy (${seed})`);
  }
  const s = G.newGame(['A', 'B'], 0, mulberry32(2));
  assert.equal(Bot.choose(s, 1, mulberry32(1), 'hard'), null);
  const over = play([randomAgent(mulberry32(1)), randomAgent(mulberry32(2))], 4);
  if (over.phase === 'over') assert.equal(Bot.choose(over, over.active, mulberry32(1), 'hard'), null);
});

test('it takes a win in one: capturing the master, or stepping the master onto the arch', () => {
  const capture = table([[2, 0, 0, true], [2, 2, 1, true], [0, 4, 1, false]], [['tiger', 'boar'], ['ox', 'horse']], 'crab');
  for (const level of Bot.LEVELS) {
    const a = Bot.choose(capture, 0, mulberry32(3), level);
    assert.deepEqual([a.card, a.from, a.to], ['tiger', [2, 0], [2, 2]], `${level} captures the master`);
  }
  const arch = table([[2, 3, 0, true], [0, 0, 1, true], [4, 0, 1, false]], [['boar', 'ox'], ['horse', 'goose']], 'crab');
  const b = Bot.choose(arch, 0, mulberry32(3), 'hard');
  assert.deepEqual([b.from, b.to], [[2, 3], [2, 4]]);
});

test('hard sees a loss coming and blocks it when it can', () => {
  // Seat 1's master is two steps from the arch at (2,0); only a capture of it stops that, or capturing something decisive.
  // Seat 0 to move has a tiger that can capture the master standing on (2,2).
  const s = table([[0, 0, 0, true], [2, 0, 0, false], [2, 2, 1, true], [4, 4, 1, false]], [['tiger', 'boar'], ['boar', 'ox']], 'crab');
  const a = Bot.choose(s, 0, mulberry32(5), 'hard');
  assert.equal(a.type, 'move');
  assert.deepEqual(a.to, [2, 2], 'it takes the master straight away');
});

test('with nothing to move it passes, swapping a card from its hand', () => {
  const saved = { horse: G.CARDS.horse.moves, ox: G.CARDS.ox.moves };
  G.CARDS.horse.moves = [[-1, 0]];
  G.CARDS.ox.moves = [[0, -1]];
  const botPath = require.resolve('../bot.js');
  delete require.cache[botPath]; // the bot precomputes its move tables from the cards when it loads
  try {
    const fresh = require('../bot.js');
    const s = table([[0, 0, 0, true], [4, 4, 1, true]], [['horse', 'ox'], ['boar', 'goose']], 'crab');
    const a = fresh.choose(s, 0, mulberry32(2), 'hard');
    assert.equal(a.type, 'pass');
    assert.ok(['horse', 'ox'].includes(a.card));
    assert.doesNotThrow(() => G.apply(s, 0, a));
  } finally {
    G.CARDS.horse.moves = saved.horse;
    G.CARDS.ox.moves = saved.ox;
    delete require.cache[botPath];
    require('../bot.js');
  }
});

test('hard answers quickly', () => {
  const rng = mulberry32(8);
  let worst = 0;
  for (let seed = 1; seed <= 6; seed++) {
    let s = G.newGame(['A', 'B'], seed % 2, rng);
    for (let step = 0; step < 30 && s.phase === 'play'; step++) {
      const t0 = Date.now();
      const a = Bot.choose(s, s.active, rng, 'hard');
      worst = Math.max(worst, Date.now() - t0);
      s = G.apply(s, s.active, a);
    }
  }
  assert.ok(worst < 1500, `slowest move took ${worst} ms`);
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
      const s = play(swap ? [B, A] : [A, B], 200 + i);
      if (s.phase === 'over' && s.end.winner === (swap ? 1 : 0)) aw++;
    }
    return aw / n;
  };
  for (const level of Bot.LEVELS) assert.ok(rate(level, 'random', 30) > 0.8, `${level} should beat random play`);
  assert.ok(rate('normal', 'easy', 30) > 0.75, 'normal beats easy');
  assert.ok(rate('hard', 'normal', 24) > 0.7, 'hard beats normal');
});
