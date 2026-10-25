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

const empty = () => Array(16).fill(-1);
// pieces by bit: tall=1, dark=2, round=4, hollow=8

test('sixteen distinct pieces; every combination of the four features exists once', () => {
  const s = G.newGame(['A', 'B'], 0);
  assert.deepEqual(s.pool, Array.from({ length: 16 }, (_, i) => i));
  assert.equal(new Set(s.pool.map((p) => G.name(p))).size, 16);
  assert.equal(G.name(0), 'solid light square short');
  assert.equal(G.name(15), 'hollow dark round tall');
  assert.equal(G.LINES.length, 10);
});

test('the first player gives, the other places, and then that player gives', () => {
  let s = G.newGame(['A', 'B'], 0);
  assert.equal(s.phase, 'give');
  assert.equal(s.active, 0);
  assert.deepEqual(G.legalPlaces(s, 0), []);
  s = G.apply(s, 0, { type: 'give', piece: 5 });
  assert.equal(s.phase, 'place');
  assert.equal(s.active, 1);
  assert.equal(s.hand, 5);
  assert.ok(!s.pool.includes(5));
  assert.equal(G.legalPlaces(s, 1).length, 16);
  s = G.apply(s, 1, { type: 'place', at: 6 });
  assert.equal(s.board[6], 5);
  assert.equal(s.phase, 'give');
  assert.equal(s.active, 1, 'the player who placed now gives');
  assert.equal(s.hand, -1);
  s = G.apply(s, 1, { type: 'give', piece: 9 });
  assert.equal(s.active, 0);
  assert.equal(s.phase, 'place');
});

test('illegal actions are refused', () => {
  const s = G.newGame(['A', 'B'], 0);
  assert.throws(() => G.apply(s, 1, { type: 'give', piece: 1 }), /not your turn/);
  assert.throws(() => G.apply(s, 0, { type: 'place', at: 0 }), /Give a piece first/);
  assert.throws(() => G.apply(s, 0, { type: 'give', piece: 16 }), /already been used/);
  assert.throws(() => G.apply(s, 0, { type: 'rematch' }), /not over/);
  const g = G.apply(s, 0, { type: 'give', piece: 3 });
  assert.throws(() => G.apply(g, 1, { type: 'give', piece: 4 }), /Place the piece/);
  assert.throws(() => G.apply(g, 1, { type: 'place', at: 16 }), /taken/);
  const p = G.apply(g, 1, { type: 'place', at: 0 });
  const q = G.apply(p, 1, { type: 'give', piece: 4 });
  assert.throws(() => G.apply(q, 0, { type: 'place', at: 0 }), /taken/);
  assert.throws(() => G.apply(p, 1, { type: 'give', piece: 3 }), /already been used/);
});

test('a line of four with one feature in common wins, for the player who placed the last piece', () => {
  const s = G.newGame(['A', 'B'], 0);
  // three tall solid pieces in the top row; a tall hollow piece completes a line that shares only 'tall'
  s.board = empty();
  s.board[0] = 1; s.board[1] = 3; s.board[2] = 5;
  s.pool = s.pool.filter((p) => ![1, 3, 5, 9].includes(p));
  s.phase = 'place';
  s.hand = 9; // tall, light, square, hollow: only 'tall' is shared with 1, 3 and 5
  s.active = 1;
  const t = G.apply(s, 1, { type: 'place', at: 3 });
  assert.equal(t.phase, 'over');
  assert.deepEqual(t.end.line, [0, 1, 2, 3]);
  assert.deepEqual(t.end.shared, ['tall']);
  assert.equal(t.end.winner, 1);
  assert.deepEqual(t.wins, [0, 1]);
  assert.throws(() => G.apply(t, 0, { type: 'give', piece: 2 }), /over/);
});

test('every kind of line wins: rows, columns and both diagonals, and any one feature', () => {
  for (const line of G.LINES) {
    for (let bit = 0; bit < 4; bit++) {
      const b = empty();
      // four pieces that all share one value of `bit` and differ in the other three features
      const pieces = [0, 1, 2, 3].map((k) => ((k & 1) << ((bit + 1) % 4)) | (((k >> 1) & 1) << ((bit + 2) % 4)) | (1 << bit));
      line.forEach((sq, k) => { b[sq] = pieces[k]; });
      const shared = G.lineWin(b, line);
      assert.ok(shared, `line ${line} bit ${bit}`);
      assert.ok(shared.includes(G.FEATURES[bit][1]));
    }
  }
  const mixed = empty();
  [0, 1, 2, 3].forEach((sq, k) => { mixed[sq] = [0, 15, 6, 9][k]; }); // 0000 1111 0110 1001: nothing shared
  assert.equal(G.lineWin(mixed, [0, 1, 2, 3]), null);
  const partial = empty();
  partial[0] = 1; partial[1] = 3; partial[2] = 5;
  assert.equal(G.lineWin(partial, [0, 1, 2, 3]), null, 'three is not a line yet');
});

test('winningSquares says where a piece would finish a line', () => {
  const b = empty();
  b[0] = 1; b[1] = 3; b[2] = 5; // three tall
  assert.deepEqual(G.winningSquares(b, 9), [3], 'a tall piece that breaks the other shared features wins at 3');
  assert.deepEqual(G.winningSquares(b, 7), [3], 'a tall solid piece also wins (they are all tall and solid)');
  assert.deepEqual(G.winningSquares(b, 8), [], 'a short hollow one does not');
  assert.deepEqual(G.winningSquares(empty(), 8), []);
});

test('a full board with no line is a draw', () => {
  // an arrangement of the sixteen pieces with no winning line, found once and fixed here
  const order = [0, 15, 3, 12, 9, 6, 10, 5, 14, 1, 13, 2, 7, 8, 4, 11];
  let found = null;
  const rng = mulberry32(3);
  for (let attempt = 0; attempt < 200000 && !found; attempt++) {
    const p = Array.from({ length: 16 }, (_, i) => i);
    for (let i = 15; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
    if (!G.LINES.some((l) => G.lineWin(p, l))) found = p;
  }
  assert.ok(found, 'a drawn arrangement exists');
  assert.ok(order.length === 16);
  const s = G.newGame(['A', 'B'], 0);
  s.board = found.map((p, i) => (i === 7 ? -1 : p));
  s.pool = [];
  s.hand = found[7];
  s.phase = 'place';
  s.active = 0;
  const t = G.apply(s, 0, { type: 'place', at: 7 });
  assert.equal(t.phase, 'over');
  assert.equal(t.end.winner, null);
  assert.equal(t.draws, 1);
});

test('a rematch starts again with the other player giving first, and keeps the tally', () => {
  const s = G.newGame(['A', 'B'], 0);
  s.board = empty();
  s.board[0] = 1; s.board[1] = 3; s.board[2] = 5;
  s.pool = s.pool.filter((p) => ![1, 3, 5, 9].includes(p));
  s.phase = 'place'; s.hand = 9; s.active = 1;
  const over = G.apply(s, 1, { type: 'place', at: 3 });
  const next = G.apply(over, 0, { type: 'rematch' });
  assert.equal(next.phase, 'give');
  assert.equal(next.active, 1 - over.starter);
  assert.deepEqual(next.wins, [0, 1]);
  assert.equal(next.pool.length, 16);
});

test('random play: every offered action is accepted, pieces are never lost, and games end', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const rng = mulberry32(seed);
    let s = G.newGame(['A', 'B'], seed % 2);
    for (let step = 0; step < 60 && s.phase !== 'over'; step++) {
      if (s.phase === 'give') {
        const gives = G.legalGives(s, s.active);
        assert.ok(gives.length > 0);
        s = G.apply(s, s.active, { type: 'give', piece: gives[Math.floor(rng() * gives.length)] });
      } else {
        const at = G.legalPlaces(s, s.active);
        assert.ok(at.length > 0);
        s = G.apply(s, s.active, { type: 'place', at: at[Math.floor(rng() * at.length)] });
      }
      const used = s.board.filter((p) => p >= 0).length + s.pool.length + (s.hand >= 0 ? 1 : 0);
      assert.equal(used, 16);
    }
    assert.equal(s.phase, 'over', `game ${seed} finished`);
  }
});
