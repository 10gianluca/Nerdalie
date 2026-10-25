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

const at = (x, y) => y * 8 + x;
const M0 = 0, K0 = 1, M1 = 2, K1 = 3; // seat 0 man / king, seat 1 man / king

// A game with pieces we place: pieces = [[x, y, code], ...]
function table(pieces, active = 0) {
  const s = G.newGame(['A', 'B'], 0);
  s.board = Array(64).fill(-1);
  for (const [x, y, p] of pieces) s.board[at(x, y)] = p;
  s.active = active;
  return s;
}
const paths = (s, seat) => G.legalMoves(s, seat).map((m) => m.path.join('>')).sort();

test('setup: twelve men a side on the dark squares, seat 0 at the bottom', () => {
  const s = G.newGame(['A', 'B'], 0);
  assert.deepEqual(G.count(s.board), [12, 12]);
  for (let i = 0; i < 64; i++) {
    const x = i % 8, y = Math.floor(i / 8);
    if (s.board[i] >= 0) assert.equal((x + y) % 2, 1, 'only dark squares are used');
  }
  assert.equal(s.board[at(1, 0)], M1);
  assert.equal(s.board[at(0, 7)], M0);
  assert.equal(s.board[at(0, 3)], -1, 'rows 3 and 4 start empty');
  assert.equal(G.legalMoves(s, 0).length, 7, 'seven opening moves');
  assert.deepEqual(G.legalMoves(s, 1), []);
});

test('a man steps one square diagonally forward, never backward or onto a piece', () => {
  const s = table([[2, 4, M0], [3, 3, M0], [7, 0, M1]]);
  // (2,4): forward-left (1,3) is free, forward-right (3,3) holds its own man. (3,3): forward squares (2,2) and (4,2) are free.
  assert.deepEqual(paths(s, 0), [`${at(2, 4)}>${at(1, 3)}`, `${at(3, 3)}>${at(2, 2)}`, `${at(3, 3)}>${at(4, 2)}`].sort());
  const down = table([[2, 3, M1], [7, 7, M0]], 1);
  assert.deepEqual(paths(down, 1), [`${at(2, 3)}>${at(1, 4)}`, `${at(2, 3)}>${at(3, 4)}`].sort(), 'seat 1 moves down the board');
});

test('capturing is compulsory', () => {
  const s = table([[2, 4, M0], [3, 3, M1], [6, 7, M0]]);
  assert.deepEqual(paths(s, 0), [`${at(2, 4)}>${at(4, 2)}`]);
  assert.throws(() => G.apply(s, 0, { type: 'move', path: [at(6, 7), at(5, 6)] }), /have to jump/);
  const t = G.apply(s, 0, { type: 'move', path: [at(2, 4), at(4, 2)] });
  assert.equal(t.board[at(3, 3)], -1, 'the jumped piece is gone');
  assert.equal(t.board[at(4, 2)], M0);
  assert.equal(t.last.captured, 1);
});

test('a jump must be continued, and the whole chain is one move', () => {
  const s = table([[1, 6, M0], [2, 5, M1], [4, 3, M1], [6, 1, M1], [7, 7, M1]]);
  const m = G.legalMoves(s, 0);
  assert.deepEqual(m.map((x) => x.path.join('>')), [`${at(1, 6)}>${at(3, 4)}>${at(5, 2)}>${at(7, 0)}`]);
  assert.equal(m[0].captures.length, 3);
  assert.throws(() => G.apply(s, 0, { type: 'move', path: [at(1, 6), at(3, 4)] }), /not allowed|have to jump/);
  const t = G.apply(s, 0, { type: 'move', path: [at(1, 6), at(3, 4), at(5, 2), at(7, 0)] });
  assert.deepEqual(G.count(t.board), [1, 1]);
  assert.equal(t.board[at(7, 0)], K0, 'it reached the last row and was crowned');
});

test('a man cannot jump backward, a king can', () => {
  const man = table([[3, 3, M0], [2, 4, M1]]);
  assert.deepEqual(paths(man, 0), [`${at(3, 3)}>${at(2, 2)}`, `${at(3, 3)}>${at(4, 2)}`].sort(), 'no backward jump, only the two steps forward');
  const king = table([[3, 3, K0], [2, 4, M1]]);
  assert.deepEqual(paths(king, 0), [`${at(3, 3)}>${at(1, 5)}`]);
});

test('a man that reaches the far row is crowned and its move ends there', () => {
  // the man jumps onto the last row; as a king it could jump on, but the move stops
  const s = table([[2, 2, M0], [3, 1, M1], [3, 3, M1], [4, 4, M1]]);
  const m = G.legalMoves(s, 0);
  assert.deepEqual(m.map((x) => x.path.join('>')), [`${at(2, 2)}>${at(4, 0)}`]);
  const t = G.apply(s, 0, { type: 'move', path: [at(2, 2), at(4, 0)] });
  assert.equal(t.board[at(4, 0)], K0);
  assert.equal(t.last.crowned, true);
  assert.equal(t.board[at(3, 3)], M1, 'the move stopped, so the other pieces are still there');
});

test('a plain step onto the last row crowns too', () => {
  const s = table([[2, 1, M0], [7, 6, M1]]);
  const t = G.apply(s, 0, { type: 'move', path: [at(2, 1), at(1, 0)] });
  assert.equal(t.board[at(1, 0)], K0);
});

test('a piece cannot be jumped twice in one move, and every jump needs an empty landing square', () => {
  // a king can circle four men and come back to where it started, taking each once; the same man is never taken twice
  const s = table([[3, 2, K0], [4, 1, M1], [6, 1, M1], [6, 3, M1], [4, 3, M1]]);
  const loop = G.legalMoves(s, 0).reduce((a, b) => (b.captures.length > a.captures.length ? b : a));
  assert.equal(loop.captures.length, 4);
  assert.equal(new Set(loop.captures).size, 4, 'four different pieces');
  assert.equal(loop.path[loop.path.length - 1], at(3, 2), 'it ends where it started, which counts as empty');
  assert.deepEqual(G.count(G.boardAfter(s.board, 0, loop)), [1, 0]);
  const blocked = table([[2, 4, M0], [3, 3, M1], [4, 2, M1]]);
  assert.ok(G.legalMoves(blocked, 0).every((m) => m.captures.length === 0), 'no jump when the square beyond is occupied');
  const edge = table([[1, 4, M0], [0, 3, M1]]);
  assert.ok(G.legalMoves(edge, 0).every((m) => m.captures.length === 0), 'no jump off the edge');
});

test('when several jumps are possible you may choose which', () => {
  const s = table([[3, 5, M0], [2, 4, M1], [4, 4, M1]]);
  assert.deepEqual(paths(s, 0), [`${at(3, 5)}>${at(1, 3)}`, `${at(3, 5)}>${at(5, 3)}`].sort());
});

test('you win when the other player has no pieces, or no legal move', () => {
  const s = table([[2, 4, M0], [3, 3, M1]]);
  const t = G.apply(s, 0, { type: 'move', path: [at(2, 4), at(4, 2)] });
  assert.equal(t.phase, 'over');
  assert.deepEqual(t.end, { winner: 0, reason: 'captured' });
  assert.deepEqual(t.wins, [1, 0]);
  assert.throws(() => G.apply(t, 1, { type: 'move', path: [at(1, 0), at(0, 1)] }), /over/);
  // blocked: seat 1's only man is in the edge behind two of seat 0's men, with no square to step to and no jump
  const b = table([[0, 1, M1], [1, 2, M0], [2, 3, M0], [7, 7, M0]]);
  const u = G.apply(b, 0, { type: 'move', path: [at(7, 7), at(6, 6)] });
  assert.equal(u.phase, 'over');
  assert.deepEqual(u.end, { winner: 0, reason: 'blocked' });
});

test('forty moves each without a capture or a man moving is a draw', () => {
  let s = table([[1, 2, K0], [6, 5, K1]]);
  s.quiet = G.NO_PROGRESS_LIMIT - 1;
  const t = G.apply(s, 0, { type: 'move', path: [at(1, 2), at(2, 3)] });
  assert.equal(t.phase, 'over');
  assert.deepEqual(t.end, { winner: null, reason: 'quiet' });
  assert.equal(t.draws, 1);
  // a man moving, or a capture, resets the count
  let u = table([[1, 2, M0], [6, 5, K1]]);
  u.quiet = 30;
  assert.equal(G.apply(u, 0, { type: 'move', path: [at(1, 2), at(2, 1)] }).quiet, 0);
});

test('illegal moves are refused', () => {
  const s = G.newGame(['A', 'B'], 0);
  assert.throws(() => G.apply(s, 1, { type: 'move', path: [at(1, 2), at(0, 3)] }), /not your turn/);
  assert.throws(() => G.apply(s, 0, { type: 'move', path: [at(0, 5), at(1, 3)] }), /not allowed/);
  assert.throws(() => G.apply(s, 0, { type: 'move', path: [at(1, 2), at(0, 3)] }), /not allowed/);
  assert.throws(() => G.apply(s, 0, { type: 'move', path: [at(0, 5)] }), /not allowed/);
  assert.throws(() => G.apply(s, 0, { type: 'rematch' }), /not over/);
});

test('a rematch swaps who moves first and keeps the tally', () => {
  const s = table([[2, 4, M0], [3, 3, M1]]);
  const over = G.apply(s, 0, { type: 'move', path: [at(2, 4), at(4, 2)] });
  const next = G.apply(over, 1, { type: 'rematch' });
  assert.equal(next.phase, 'play');
  assert.equal(next.active, 1 - over.starter);
  assert.deepEqual(next.wins, [1, 0]);
  assert.deepEqual(G.count(next.board), [12, 12]);
});

test('random play: every offered move is accepted, nothing is ever added to the board, and games end', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const rng = mulberry32(seed);
    let s = G.newGame(['A', 'B'], seed % 2);
    let total = 24;
    for (let step = 0; step < 600 && s.phase === 'play'; step++) {
      const moves = G.legalMoves(s, s.active);
      assert.ok(moves.length > 0, 'the player to move always has a move');
      for (const m of moves.slice(0, 3)) assert.doesNotThrow(() => G.apply(s, s.active, { type: 'move', path: m.path }));
      const m = moves[Math.floor(rng() * moves.length)];
      s = G.apply(s, s.active, { type: 'move', path: m.path });
      const c = G.count(s.board);
      assert.ok(c[0] + c[1] <= total);
      total = c[0] + c[1];
    }
    assert.equal(s.phase, 'over', `game ${seed} finished`);
  }
});
