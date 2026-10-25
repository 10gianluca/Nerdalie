const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../game.js');

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const at = G.at;
// A bare board with the cards we choose: pieces = [[x, y, seat, master], ...]
function table(pieces, hands, side, active = 0) {
  const s = G.newGame(['A', 'B'], active, mulberry32(1));
  s.board = Array(25).fill(null);
  for (const [x, y, p, m] of pieces) s.board[at(x, y)] = { p, m: !!m };
  s.hands = hands.map((h) => h.slice());
  s.side = side;
  s.active = active;
  return s;
}
const count = (s, seat) => s.board.filter((c) => c && c.p === seat).length;

test('there are sixteen cards and every move fits the 5x5 board in some position', () => {
  assert.equal(G.CARD_IDS.length, 16);
  for (const id of G.CARD_IDS) {
    const { moves } = G.CARDS[id];
    assert.ok(moves.length >= 2 && moves.length <= 4, id);
    assert.equal(new Set(moves.map((m) => m.join(','))).size, moves.length, `${id} has no duplicate moves`);
    assert.ok(moves.every(([r, f]) => Math.abs(r) <= 2 && Math.abs(f) <= 2 && (r || f)), id);
  }
  // spot checks against the printed cards
  assert.deepEqual(G.CARDS.tiger.moves, [[0, 2], [0, -1]]);
  assert.equal(G.CARDS.dragon.moves.length, 4);
  assert.deepEqual(G.CARDS.horse.moves.slice().sort(), [[-1, 0], [0, -1], [0, 1]].sort());
  // mirror pairs: Frog/Rabbit, Horse/Ox, Goose/Rooster, Eel/Cobra
  const mirror = (id) => G.CARDS[id].moves.map(([r, f]) => [-r, f].join(',')).sort().join('|');
  const same = (id) => G.CARDS[id].moves.map((m) => m.join(',')).sort().join('|');
  assert.equal(mirror('frog'), same('rabbit'));
  assert.equal(mirror('horse'), same('ox'));
  assert.equal(mirror('goose'), same('rooster'));
  assert.equal(mirror('eel'), same('cobra'));
  for (const id of ['tiger', 'crab', 'monkey', 'elephant', 'dragon', 'boar', 'crane', 'mantis']) assert.equal(mirror(id), same(id), `${id} is symmetrical`);
});

test('setup: masters on the arches, four students beside each, two cards each and one beside the board', () => {
  const s = G.newGame(['A', 'B'], 1, mulberry32(7));
  assert.equal(count(s, 0), 5);
  assert.equal(count(s, 1), 5);
  assert.deepEqual(s.board[at(2, 0)], { p: 0, m: true });
  assert.deepEqual(s.board[at(2, 4)], { p: 1, m: true });
  assert.deepEqual(s.board[at(0, 0)], { p: 0, m: false });
  assert.deepEqual(s.board[at(4, 4)], { p: 1, m: false });
  const all = [...s.hands[0], ...s.hands[1], s.side];
  assert.equal(all.length, 5);
  assert.equal(new Set(all).size, 5);
  assert.equal(s.active, 1);
  assert.deepEqual(s.wins, [0, 0]);
});

test('seat 1 sees every card turned around', () => {
  assert.deepEqual(G.steps('tiger', 0), [[0, 2], [0, -1]]);
  assert.deepEqual(G.steps('tiger', 1), [[0, -2], [0, 1]]);
  assert.deepEqual(G.steps('frog', 0), [[-1, 1], [-2, 0], [1, -1]]);
  assert.deepEqual(G.steps('frog', 1), [[1, -1], [2, 0], [-1, 1]]);
});

test('a move captures, never lands on your own pawn, and stays on the board', () => {
  const s = table([[2, 0, 0, true], [2, 1, 0, false], [3, 2, 1, false], [0, 4, 1, true]], [['elephant', 'tiger'], ['boar', 'ox']], 'crab');
  const moves = G.legalMoves(s, 0);
  const key = (m) => `${m.card}:${m.from}>${m.to}`;
  const keys = moves.map(key);
  assert.ok(keys.includes('elephant:2,1>3,2'), 'capture diagonally');
  assert.ok(moves.find((m) => key(m) === 'elephant:2,1>3,2').capture);
  assert.ok(!keys.includes('tiger:2,0>2,1'), 'cannot land on your own student');
  assert.ok(keys.includes('tiger:2,1>2,3'), 'tiger goes two forward');
  assert.ok(!moves.some((m) => m.to[0] < 0 || m.to[0] > 4 || m.to[1] < 0 || m.to[1] > 4));
  assert.ok(!keys.includes('tiger:2,0>2,-1'));
});

test('pawns jump over others', () => {
  const s = table([[2, 0, 0, true], [2, 1, 0, false], [2, 2, 1, false], [0, 4, 1, true]], [['tiger', 'boar'], ['ox', 'horse']], 'crab');
  assert.ok(G.legalMoves(s, 0).some((m) => m.card === 'tiger' && m.from.join() === '2,0' && m.to.join() === '2,2'), 'two forward lands on the enemy, over the friend');
});

test('using a card swaps it with the one beside the board', () => {
  const s = table([[2, 0, 0, true], [0, 4, 1, true]], [['boar', 'ox'], ['horse', 'goose']], 'crab');
  const t = G.apply(s, 0, { type: 'move', card: 'boar', from: [2, 0], to: [2, 1] });
  assert.deepEqual(t.hands[0], ['crab', 'ox']);
  assert.equal(t.side, 'boar');
  assert.equal(t.active, 1);
  assert.equal(t.turn, 2);
  assert.deepEqual(t.board[at(2, 1)], { p: 0, m: true });
  assert.equal(t.board[at(2, 0)], null);
  assert.equal(t.last.card, 'boar');
});

test('win by capturing the master (the Way of the Stone)', () => {
  const s = table([[2, 0, 0, true], [1, 1, 0, false], [2, 2, 1, true], [4, 4, 1, false]], [['boar', 'tiger'], ['ox', 'horse']], 'crab');
  const t = G.apply(s, 0, { type: 'move', card: 'tiger', from: [2, 0], to: [2, 2] });
  assert.equal(t.phase, 'over');
  assert.deepEqual(t.end, { winner: 0, reason: 'stone' });
  assert.deepEqual(t.wins, [1, 0]);
  assert.throws(() => G.apply(t, 1, { type: 'move', card: 'ox', from: [4, 4], to: [4, 3] }), /over/);
});

test('win by reaching the other temple arch with the master (the Way of the Stream), but not with a student', () => {
  const s = table([[2, 3, 0, true], [1, 3, 0, false], [0, 0, 1, true], [4, 0, 1, false]], [['boar', 'ox'], ['horse', 'goose']], 'crab');
  const student = G.apply(s, 0, { type: 'move', card: 'boar', from: [1, 3], to: [1, 4] });
  assert.equal(student.phase, 'play');
  const m = G.apply(s, 0, { type: 'move', card: 'boar', from: [2, 3], to: [2, 4] });
  assert.deepEqual(m.end, { winner: 0, reason: 'stream' });
  // seat 1's arch is the mirror image
  const s1 = table([[2, 1, 1, true], [0, 4, 0, true]], [['horse', 'goose'], ['boar', 'ox']], 'crab', 1);
  const w = G.apply(s1, 1, { type: 'move', card: 'boar', from: [2, 1], to: [2, 0] });
  assert.deepEqual(w.end, { winner: 1, reason: 'stream' });
});

test('illegal moves are refused', () => {
  const s = table([[2, 0, 0, true], [2, 4, 1, true]], [['boar', 'ox'], ['horse', 'goose']], 'crab');
  assert.throws(() => G.apply(s, 1, { type: 'move', card: 'horse', from: [2, 4], to: [2, 3] }), /not your turn/);
  assert.throws(() => G.apply(s, 0, { type: 'move', card: 'tiger', from: [2, 0], to: [2, 2] }), /not allowed/);
  assert.throws(() => G.apply(s, 0, { type: 'move', card: 'boar', from: [2, 0], to: [2, 2] }), /not allowed/);
  assert.throws(() => G.apply(s, 0, { type: 'move', card: 'boar', from: [3, 3], to: [3, 4] }), /not allowed/);
  assert.throws(() => G.apply(s, 0, { type: 'pass', card: 'boar' }), /have a move/);
  assert.throws(() => G.apply(s, 0, { type: 'rematch' }), /not over/);
});

test('with no legal move you must pass: either card can be swapped with the one beside the board', () => {
  // No real pair of cards can leave a lone master with nothing to do, so give two cards moves that all point off the board.
  const saved = { horse: G.CARDS.horse.moves, ox: G.CARDS.ox.moves };
  G.CARDS.horse.moves = [[-1, 0]];
  G.CARDS.ox.moves = [[0, -1]];
  try {
    const s = table([[0, 0, 0, true], [4, 4, 1, true]], [['horse', 'ox'], ['boar', 'goose']], 'crab');
    assert.deepEqual(G.legalMoves(s, 0), []);
    assert.throws(() => G.apply(s, 0, { type: 'pass', card: 'tiger' }), /not in your hand/);
    const t = G.apply(s, 0, { type: 'pass', card: 'ox' });
    assert.deepEqual(t.hands[0], ['horse', 'crab']);
    assert.equal(t.side, 'ox');
    assert.equal(t.active, 1);
    assert.equal(t.last.kind, 'pass');
    assert.deepEqual(t.board, s.board, 'nothing moved');
    assert.equal(t.phase, 'play');
  } finally {
    G.CARDS.horse.moves = saved.horse;
    G.CARDS.ox.moves = saved.ox;
  }
});

test('a rematch starts a new game with the other player first and keeps the tally', () => {
  const s = table([[2, 0, 0, true], [1, 1, 0, false], [2, 2, 1, true]], [['boar', 'tiger'], ['ox', 'horse']], 'crab');
  const over = G.apply(s, 0, { type: 'move', card: 'tiger', from: [2, 0], to: [2, 2] });
  const next = G.apply(over, 1, { type: 'rematch' }, mulberry32(4));
  assert.equal(next.phase, 'play');
  assert.equal(next.active, 1 - over.starter);
  assert.deepEqual(next.wins, [1, 0]);
  assert.equal(count(next, 0), 5);
});

test('random play always ends, every legal move is accepted, and the board stays consistent', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const rng = mulberry32(seed);
    let s = G.newGame(['A', 'B'], seed % 2, rng);
    for (let step = 0; step < 600 && s.phase === 'play'; step++) {
      const moves = G.legalMoves(s, s.active);
      if (!moves.length) {
        s = G.apply(s, s.active, { type: 'pass', card: s.hands[s.active][Math.floor(rng() * 2)] });
      } else {
        for (const m of moves.slice(0, 3)) assert.doesNotThrow(() => G.apply(s, s.active, { type: 'move', card: m.card, from: m.from, to: m.to }));
        const m = moves[Math.floor(rng() * moves.length)];
        s = G.apply(s, s.active, { type: 'move', card: m.card, from: m.from, to: m.to });
      }
      assert.equal(new Set([...s.hands[0], ...s.hands[1], s.side]).size, 5, 'five distinct cards in play');
      assert.ok(count(s, 0) <= 5 && count(s, 1) <= 5);
    }
    if (s.phase === 'over') assert.ok(['stone', 'stream'].includes(s.end.reason));
  }
});
