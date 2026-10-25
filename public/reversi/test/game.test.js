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
const empty = () => Array(64).fill(-1);

test('the opening position: two of each colour in the middle, black to move with four choices', () => {
  const s = G.newGame(['A', 'B'], 0);
  assert.deepEqual(G.count(s.board), [2, 2]);
  assert.equal(s.board[at(3, 3)], 1);
  assert.equal(s.board[at(4, 4)], 1);
  assert.equal(s.board[at(4, 3)], 0);
  assert.equal(s.board[at(3, 4)], 0);
  assert.deepEqual(G.legalMoves(s, 0).sort((a, b) => a - b), [at(3, 2), at(2, 3), at(5, 4), at(4, 5)].sort((a, b) => a - b));
  assert.deepEqual(G.legalMoves(s, 1), [], 'not white turn');
});

test('a move places a disc and flips the trapped line', () => {
  const s = G.newGame(['A', 'B'], 0);
  const t = G.apply(s, 0, { type: 'move', at: at(3, 2) }); // d3 traps d4
  assert.equal(t.board[at(3, 2)], 0);
  assert.equal(t.board[at(3, 3)], 0, 'd4 flipped');
  assert.deepEqual(G.count(t.board), [4, 1]);
  assert.equal(t.active, 1);
  assert.equal(t.last.flipped, 1);
  assert.equal(t.turn, 2);
});

test('a move can flip in several directions and several discs at once', () => {
  const b = empty();
  // black at (0,0), (4,0), (0,4); white between them on the row, column and diagonal of (0,0)... place at (4,4)
  b[at(0, 0)] = 0; b[at(1, 1)] = 1; b[at(2, 2)] = 1; b[at(3, 3)] = 1; // diagonal ending at (4,4)
  b[at(4, 0)] = 0; b[at(4, 1)] = 1; b[at(4, 2)] = 1; b[at(4, 3)] = 1; // column above (4,4)
  b[at(0, 4)] = 0; b[at(1, 4)] = 1; b[at(2, 4)] = 1; b[at(3, 4)] = 1; // row left of (4,4)
  assert.deepEqual(G.flips(b, 0, at(4, 4)).sort((a, c) => a - c), [at(1, 1), at(2, 2), at(3, 3), at(4, 1), at(4, 2), at(4, 3), at(1, 4), at(2, 4), at(3, 4)].sort((a, c) => a - c));
});

test('a line only flips if it is closed by one of your own discs', () => {
  const b = empty();
  b[at(1, 0)] = 1; b[at(2, 0)] = 1; // white, white, then an empty square: no trap
  assert.deepEqual(G.flips(b, 0, at(0, 0)), []);
  b[at(3, 0)] = 0;
  assert.deepEqual(G.flips(b, 0, at(0, 0)).sort(), [at(1, 0), at(2, 0)].sort());
  assert.deepEqual(G.flips(b, 0, at(1, 0)), [], 'an occupied square can not be played');
  // running off the edge does not count
  const c = empty();
  c[at(6, 0)] = 1; c[at(7, 0)] = 1;
  assert.deepEqual(G.flips(c, 0, at(5, 0)), []);
});

test('illegal moves are refused', () => {
  const s = G.newGame(['A', 'B'], 0);
  assert.throws(() => G.apply(s, 0, { type: 'move', at: at(0, 0) }), /can't play there/);
  assert.throws(() => G.apply(s, 0, { type: 'move', at: at(3, 3) }), /can't play there/);
  assert.throws(() => G.apply(s, 1, { type: 'move', at: at(2, 3) }), /not your turn/);
  assert.throws(() => G.apply(s, 0, { type: 'rematch' }), /not over/);
});

test('a player with no move is passed over, and the one who can move goes again', () => {
  const s = G.newGame(['A', 'B'], 0);
  s.board = empty();
  s.board[at(0, 0)] = 0; s.board[at(1, 0)] = 1; // black can play at c1
  s.board[at(0, 2)] = 0; s.board[at(1, 2)] = 1; // and later at c3
  const t = G.apply(s, 0, { type: 'move', at: at(2, 0) });
  assert.equal(t.phase, 'play');
  assert.equal(t.active, 0, 'white had nothing to play, so it is black again');
  assert.equal(t.last.passed, true);
  assert.equal(t.last.passer, 1);
  const u = G.apply(t, 0, { type: 'move', at: at(2, 2) });
  assert.equal(u.phase, 'over');
  assert.deepEqual(u.end, { counts: [6, 0], winner: 0 });
});

test('the game ends when neither can move: the bigger colour wins, level is a draw', () => {
  const s = G.newGame(['A', 'B'], 0);
  s.board = empty();
  s.board[at(0, 0)] = 0; s.board[at(1, 0)] = 1;
  const t = G.apply(s, 0, { type: 'move', at: at(2, 0) });
  assert.equal(t.phase, 'over');
  assert.deepEqual(t.end, { counts: [3, 0], winner: 0 });
  assert.deepEqual(t.wins, [1, 0]);
  assert.throws(() => G.apply(t, 1, { type: 'move', at: at(3, 3) }), /over/);
  const d = G.newGame(['A', 'B'], 0);
  d.board = empty();
  d.board[at(0, 0)] = 0; d.board[at(1, 0)] = 1; d.board[at(4, 4)] = 1; d.board[at(7, 7)] = 1; d.board[at(7, 6)] = 1;
  const e = G.apply(d, 0, { type: 'move', at: at(2, 0) });
  assert.equal(e.phase, 'over');
  assert.deepEqual(e.end, { counts: [3, 3], winner: null });
  assert.equal(e.draws, 1);
  assert.deepEqual(e.wins, [0, 0]);
});

test('a rematch starts again with the other colour first and keeps the tally', () => {
  const s = G.newGame(['A', 'B'], 0);
  s.board = empty();
  s.board[at(0, 0)] = 0; s.board[at(1, 0)] = 1;
  const over = G.apply(s, 0, { type: 'move', at: at(2, 0) });
  const next = G.apply(over, 1, { type: 'rematch' });
  assert.equal(next.phase, 'play');
  assert.equal(next.active, 1 - over.starter);
  assert.deepEqual(next.wins, [1, 0]);
  assert.deepEqual(G.count(next.board), [2, 2]);
});

test('random play: every offered move is accepted, discs only ever grow by one, and games end', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const rng = mulberry32(seed);
    let s = G.newGame(['A', 'B'], seed % 2);
    let discs = 4;
    for (let step = 0; step < 200 && s.phase === 'play'; step++) {
      const moves = G.legalMoves(s, s.active);
      assert.ok(moves.length > 0, 'the player to move always has a move (passes are skipped)');
      for (const m of moves.slice(0, 3)) assert.doesNotThrow(() => G.apply(s, s.active, { type: 'move', at: m }));
      s = G.apply(s, s.active, { type: 'move', at: moves[Math.floor(rng() * moves.length)] });
      discs += 1;
      const c = G.count(s.board);
      assert.equal(c[0] + c[1], discs);
    }
    assert.equal(s.phase, 'over', `game ${seed} finished`);
    assert.equal(s.end.counts[0] + s.end.counts[1], discs);
  }
});
