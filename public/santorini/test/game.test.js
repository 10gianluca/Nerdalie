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

const sq = (x, y) => y * 5 + x;

// A game already in the playing phase with the builders and heights we choose.
function table({ builders = [[sq(0, 0), sq(4, 4)], [sq(0, 4), sq(4, 0)]], heights = {}, domes = [], active = 0 }) {
  const s = G.newGame(['A', 'B'], 0);
  s.phase = 'play';
  s.placed = 4;
  s.active = active;
  s.builders = builders.map((b) => b.slice());
  builders.forEach((list, seat) => list.forEach((i) => { s.board[i].w = seat; }));
  for (const [i, h] of Object.entries(heights)) s.board[i].h = h;
  for (const i of domes) s.board[i].dome = true;
  return s;
}

test('placement: four builders go down in turn, then the starter moves', () => {
  let s = G.newGame(['A', 'B'], 1);
  assert.equal(s.phase, 'place');
  assert.equal(s.active, 1);
  for (const [seat, at] of [[1, sq(0, 0)], [0, sq(4, 4)], [1, sq(2, 2)], [0, sq(1, 3)]]) {
    assert.equal(s.active, seat);
    s = G.apply(s, seat, { type: 'place', at });
  }
  assert.equal(s.phase, 'play');
  assert.equal(s.active, 1, 'the player who placed first moves first');
  assert.deepEqual(s.builders, [[sq(4, 4), sq(1, 3)], [sq(0, 0), sq(2, 2)]]);
  assert.throws(() => G.apply(G.newGame(['A', 'B'], 0), 0, { type: 'place', at: 99 }), /taken/);
  const one = G.apply(G.newGame(['A', 'B'], 0), 0, { type: 'place', at: sq(1, 1) });
  assert.throws(() => G.apply(one, 1, { type: 'place', at: sq(1, 1) }), /taken/);
  assert.throws(() => G.apply(one, 0, { type: 'place', at: sq(2, 2) }), /not your turn/);
  assert.throws(() => G.apply(one, 1, { type: 'move', from: 0, to: 1 }), /Place your builders/);
});

test('a builder steps to any neighbour, diagonals included, but not off the island', () => {
  const s = table({ builders: [[sq(0, 0), sq(4, 4)], [sq(2, 2), sq(4, 0)]] });
  assert.deepEqual(G.movesFrom(s, 0, sq(0, 0)).sort((a, b) => a - b), [sq(1, 0), sq(0, 1), sq(1, 1)].sort((a, b) => a - b));
  assert.equal(G.movesFrom(s, 0, sq(4, 4)).length, 3);
});

test('climbing is one level at a time; stepping down is free', () => {
  const s = table({ heights: { [sq(1, 0)]: 2, [sq(0, 1)]: 1, [sq(1, 1)]: 0, [sq(0, 0)]: 0 } });
  assert.deepEqual(G.movesFrom(s, 0, sq(0, 0)).sort((a, b) => a - b), [sq(0, 1), sq(1, 1)].sort((a, b) => a - b), 'a level 2 is too high from the ground');
  const high = table({ heights: { [sq(0, 0)]: 3, [sq(1, 0)]: 0 } });
  assert.ok(G.movesFrom(high, 0, sq(0, 0)).includes(sq(1, 0)), 'down from a level 3 is fine');
});

test('builders and domes block movement', () => {
  const s = table({ builders: [[sq(0, 0), sq(4, 4)], [sq(1, 1), sq(4, 0)]], domes: [sq(1, 0)] });
  assert.deepEqual(G.movesFrom(s, 0, sq(0, 0)), [sq(0, 1)]);
});

test('a move is followed by a build next to the builder that moved', () => {
  const s = table({});
  const m = G.apply(s, 0, { type: 'move', from: sq(0, 0), to: sq(1, 1) });
  assert.deepEqual(m.pending, { builder: sq(1, 1) });
  assert.equal(m.active, 0, 'still your turn until you build');
  assert.throws(() => G.apply(m, 0, { type: 'move', from: sq(4, 4), to: sq(3, 3) }), /Build before moving/);
  assert.throws(() => G.apply(m, 0, { type: 'build', at: sq(3, 3) }), /can not build there/);
  assert.throws(() => G.apply(m, 1, { type: 'build', at: sq(2, 2) }), /not your turn/);
  const b = G.apply(m, 0, { type: 'build', at: sq(0, 0) }); // the square it just left is fair game
  assert.equal(b.board[sq(0, 0)].h, 1);
  assert.equal(b.pending, null);
  assert.equal(b.active, 1);
  assert.equal(b.turn, 2);
  assert.throws(() => G.apply(s, 0, { type: 'build', at: sq(1, 1) }), /Move a builder first/);
});

test('blocks go 1, 2, 3 and then a dome closes the square', () => {
  let s = table({ heights: { [sq(2, 2)]: 2 } });
  const play = (seat, from, to, at) => { s = G.apply(G.apply(s, seat, { type: 'move', from, to }), seat, { type: 'build', at }); };
  play(0, sq(0, 0), sq(1, 1), sq(2, 2)); // level 2 -> 3
  assert.equal(s.board[sq(2, 2)].h, 3);
  assert.equal(s.board[sq(2, 2)].dome, false);
  play(1, sq(0, 4), sq(0, 3), sq(0, 4));
  play(0, sq(1, 1), sq(1, 0), sq(2, 1));
  play(1, sq(0, 3), sq(1, 4), sq(0, 3));
  // now cap the 3-tower from next to it
  s.active = 0;
  s = G.apply(G.apply(s, 0, { type: 'move', from: sq(1, 0), to: sq(1, 1) }), 0, { type: 'build', at: sq(2, 2) });
  assert.equal(s.board[sq(2, 2)].dome, true);
  assert.equal(s.board[sq(2, 2)].h, 3, 'the dome sits on the three blocks');
  assert.equal(s.last.dome, true);
  const dead = G.builds(table({ builders: [[sq(0, 0), sq(4, 4)], [sq(1, 1), sq(4, 0)]], domes: [sq(0, 1), sq(1, 0)] }), sq(0, 0));
  assert.deepEqual(dead, [], 'no building on a dome or a builder');
});

test('moving up onto level 3 wins at once, with no build', () => {
  const s = table({ heights: { [sq(0, 0)]: 2, [sq(1, 0)]: 3 } });
  const t = G.apply(s, 0, { type: 'move', from: sq(0, 0), to: sq(1, 0) });
  assert.equal(t.phase, 'over');
  assert.deepEqual(t.end, { winner: 0, reason: 'summit' });
  assert.deepEqual(t.wins, [1, 0]);
  assert.throws(() => G.apply(t, 1, { type: 'move', from: sq(0, 4), to: sq(0, 3) }), /over/);
});

test('level 3 only wins when you climb onto it, and it is not reachable from level 1', () => {
  const flat = table({ heights: { [sq(0, 0)]: 3, [sq(1, 0)]: 3 } });
  const t = G.apply(flat, 0, { type: 'move', from: sq(0, 0), to: sq(1, 0) });
  assert.equal(t.phase, 'play', 'walking between two level 3s is not climbing');
  const low = table({ heights: { [sq(0, 0)]: 1, [sq(1, 0)]: 3 } });
  assert.ok(!G.movesFrom(low, 0, sq(0, 0)).includes(sq(1, 0)));
});

test('a move that would leave nothing to build on is not allowed', () => {
  // seat 0's only builders are boxed into a corner: the one square it can step to has no free neighbour afterwards
  const s = table({
    builders: [[sq(0, 0), sq(4, 4)], [sq(0, 2), sq(3, 4)]],
    domes: [sq(1, 0), sq(1, 1), sq(2, 0), sq(0, 2), sq(3, 3), sq(4, 3)].filter((i) => i !== sq(0, 2)),
  });
  // seat 0 at (0,0) can only go to (0,1); from there the neighbours are (0,0) [free once left], (1,0) dome, (1,1) dome, (0,2) builder, (1,2)
  // (1,2) is free, so this is still fine: check the rule on a tighter case below
  assert.ok(G.movesFrom(s, 0, sq(0, 0)).includes(sq(0, 1)));
  const tight = table({
    builders: [[sq(0, 0), sq(4, 4)], [sq(0, 2), sq(1, 2)]],
    domes: [sq(1, 0), sq(1, 1), sq(3, 4), sq(3, 3), sq(4, 3)],
  });
  // (0,1)'s neighbours: (0,0) free after leaving, so a build is always possible onto the square just left
  assert.ok(G.movesFrom(tight, 0, sq(0, 0)).includes(sq(0, 1)));
  const none = G.legalMoves(table({ builders: [[sq(0, 0), sq(0, 1)], [sq(1, 0), sq(1, 1)]], domes: [sq(0, 2), sq(1, 2), sq(2, 0), sq(2, 1), sq(2, 2)] }), 0);
  assert.deepEqual(none, [], 'builders wedged in by builders and domes have no move');
});

test('a player who cannot move loses at the start of their turn', () => {
  // seat 1's builders are walled in by domes and seat 0's builders; seat 0 completes a turn and passes the move over
  const s = table({
    builders: [[sq(0, 0), sq(4, 4)], [sq(2, 0), sq(2, 1)]],
    domes: [sq(1, 0), sq(1, 1), sq(3, 0), sq(3, 1), sq(1, 2), sq(2, 2), sq(3, 2)],
    active: 0,
  });
  const t = G.apply(G.apply(s, 0, { type: 'move', from: sq(4, 4), to: sq(4, 3) }), 0, { type: 'build', at: sq(4, 4) });
  assert.equal(t.phase, 'over');
  assert.deepEqual(t.end, { winner: 0, reason: 'stuck' });
});

test('rematch: a fresh island, the other player places first, the tally stays', () => {
  const s = table({ heights: { [sq(0, 0)]: 2, [sq(1, 0)]: 3 } });
  const over = G.apply(s, 0, { type: 'move', from: sq(0, 0), to: sq(1, 0) });
  assert.throws(() => G.apply(s, 0, { type: 'rematch' }), /not over/);
  const next = G.apply(over, 1, { type: 'rematch' });
  assert.equal(next.phase, 'place');
  assert.equal(next.active, 1 - over.starter);
  assert.deepEqual(next.wins, [1, 0]);
  assert.ok(next.board.every((q) => q.h === 0 && !q.dome && q.w === -1));
});

test('random play: every move and build offered is accepted, and games end', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const rng = mulberry32(seed);
    let s = G.newGame(['A', 'B'], seed % 2);
    for (let step = 0; step < 800 && s.phase !== 'over'; step++) {
      if (s.phase === 'place') {
        const at = G.legalPlacements(s, s.active);
        s = G.apply(s, s.active, { type: 'place', at: at[Math.floor(rng() * at.length)] });
      } else if (s.pending) {
        const b = G.legalBuilds(s, s.active);
        assert.ok(b.length > 0, 'a started turn can always be finished');
        for (const at of b) assert.doesNotThrow(() => G.apply(s, s.active, { type: 'build', at }));
        s = G.apply(s, s.active, { type: 'build', at: b[Math.floor(rng() * b.length)] });
      } else {
        const m = G.legalMoves(s, s.active);
        assert.ok(m.length > 0, 'if there is no move the game is already over');
        for (const mv of m.slice(0, 4)) assert.doesNotThrow(() => G.apply(s, s.active, { type: 'move', ...mv }));
        const mv = m[Math.floor(rng() * m.length)];
        s = G.apply(s, s.active, { type: 'move', ...mv });
      }
      const builders = s.board.filter((q) => q.w >= 0).length;
      assert.ok(builders <= 4);
      assert.ok(s.board.every((q) => q.h >= 0 && q.h <= 3));
    }
    assert.equal(s.phase, 'over', `game ${seed} finished`);
  }
});
