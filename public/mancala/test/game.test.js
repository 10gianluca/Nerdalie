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

const total = (s) => s.pits.reduce((a, b) => a + b, 0);

function table(pits, active = 0) {
  const s = G.newGame(['A', 'B'], 0);
  s.pits = pits.slice();
  s.active = active;
  return s;
}

test('setup: four seeds in each of the twelve pits, empty stores, 48 seeds in all', () => {
  const s = G.newGame(['A', 'B'], 1);
  assert.deepEqual(s.pits, [4, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0]);
  assert.equal(total(s), 48);
  assert.equal(s.active, 1);
  assert.deepEqual(G.legalPits(s, 1), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(G.legalPits(s, 0), []);
});

test('sowing drops one seed in each following pit, through your store, round to the other side', () => {
  const s = G.newGame(['A', 'B'], 0);
  const t = G.apply(s, 0, { type: 'sow', pit: 2 }); // 4 seeds from pit 2: pits 3, 4, 5 and the store
  assert.deepEqual(t.pits, [4, 4, 0, 5, 5, 5, 1, 4, 4, 4, 4, 4, 4, 0]);
  assert.equal(t.last.extra, true, 'the last seed landed in the store');
  assert.equal(t.active, 0, 'so it is still your turn');
  const u = G.apply(s, 0, { type: 'sow', pit: 5 }); // 4 seeds: store, then pits 7, 8, 9
  assert.deepEqual(u.pits, [4, 4, 4, 4, 4, 0, 1, 5, 5, 5, 4, 4, 4, 0]);
  assert.equal(u.active, 1);
});

test("the other player's store is skipped", () => {
  const s = table([0, 1, 0, 0, 0, 9, 0, 0, 0, 0, 0, 0, 1, 5]);
  // 9 seeds from pit 5: store, then 7..12 (6 seeds), skip store 13, then pits 0 and 1 (which already had a seed: no capture)
  const r = G.sow(s.pits, 0, 5);
  assert.deepEqual(s.pits, [1, 2, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 2, 5]);
  assert.equal(r.last, 1);
  assert.equal(r.captured, 0);
});

test('seat 1 sows the same way round: its own pits, its store, then seat 0\'s pits', () => {
  const s = G.newGame(['A', 'B'], 1);
  const t = G.apply(s, 1, { type: 'sow', pit: 5 }); // pit index 12 -> store 13, then 0, 1, 2
  assert.deepEqual(t.pits, [5, 5, 5, 4, 4, 4, 0, 4, 4, 4, 4, 4, 0, 1]);
  assert.equal(t.active, 0);
});

test('a last seed in an empty pit of yours captures what is across from it', () => {
  // seat 0: one seed in pit 0, pit 1 empty; across from pit 1 (index 11) are 5 seeds
  const s = table([1, 0, 4, 4, 4, 4, 0, 4, 4, 4, 4, 5, 4, 0]);
  const t = G.apply(s, 0, { type: 'sow', pit: 0 });
  assert.equal(t.pits[6], 6, 'the seed that landed plus the five across');
  assert.equal(t.pits[1], 0);
  assert.equal(t.pits[11], 0);
  assert.equal(t.last.captured, 6);
  assert.equal(t.active, 1);
});

test('no capture when the pit across is empty, or when the last pit was not empty, or on the other side', () => {
  const none = G.apply(table([1, 0, 4, 4, 4, 4, 0, 4, 4, 4, 4, 0, 4, 0]), 0, { type: 'sow', pit: 0 });
  assert.equal(none.pits[6], 0);
  assert.equal(none.pits[1], 1);
  const notEmpty = G.apply(table([1, 2, 4, 4, 4, 4, 0, 4, 4, 4, 4, 5, 4, 0]), 0, { type: 'sow', pit: 0 });
  assert.equal(notEmpty.pits[6], 0);
  const theirSide = G.apply(table([0, 0, 0, 0, 0, 2, 0, 0, 4, 4, 4, 4, 4, 0]), 0, { type: 'sow', pit: 5 });
  assert.equal(theirSide.pits[6], 1);
  assert.equal(theirSide.last.captured, 0, 'landing in an empty pit on their side captures nothing');
});

test('the game ends when a side is empty; the other player keeps their remaining seeds', () => {
  const s = table([0, 0, 0, 0, 0, 1, 20, 3, 0, 2, 0, 0, 0, 20]);
  const t = G.apply(s, 0, { type: 'sow', pit: 5 }); // the last seed goes into the store and empties seat 0's side
  assert.equal(t.phase, 'over');
  assert.deepEqual(t.pits, [0, 0, 0, 0, 0, 0, 21, 0, 0, 0, 0, 0, 0, 25]);
  assert.deepEqual(t.end, { scores: [21, 25], winner: 1 });
  assert.deepEqual(t.wins, [0, 1]);
  assert.throws(() => G.apply(t, 1, { type: 'sow', pit: 0 }), /over/);
});

test('an even finish is a draw', () => {
  const s = table([0, 0, 0, 0, 0, 1, 23, 0, 0, 0, 0, 0, 0, 24]);
  const t = G.apply(s, 0, { type: 'sow', pit: 5 });
  assert.deepEqual(t.end, { scores: [24, 24], winner: null });
  assert.equal(t.draws, 1);
});

test('illegal moves are refused', () => {
  const s = G.newGame(['A', 'B'], 0);
  assert.throws(() => G.apply(s, 1, { type: 'sow', pit: 0 }), /not your turn/);
  assert.throws(() => G.apply(s, 0, { type: 'sow', pit: 6 }), /no such pit/);
  assert.throws(() => G.apply(s, 0, { type: 'sow', pit: -1 }), /no such pit/);
  assert.throws(() => G.apply(table([0, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0]), 0, { type: 'sow', pit: 0 }), /empty/);
  assert.throws(() => G.apply(s, 0, { type: 'rematch' }), /not over/);
});

test('rematch: the other player starts, the tally stays', () => {
  const s = table([0, 0, 0, 0, 0, 1, 20, 3, 0, 2, 0, 0, 0, 20]);
  const over = G.apply(s, 0, { type: 'sow', pit: 5 });
  const next = G.apply(over, 1, { type: 'rematch' });
  assert.equal(next.phase, 'play');
  assert.equal(next.active, 1 - over.starter);
  assert.deepEqual(next.wins, [0, 1]);
  assert.deepEqual(next.pits, [4, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0]);
});

test('random play: seeds are never created or lost, legal moves are accepted, and games end', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const rng = mulberry32(seed);
    let s = G.newGame(['A', 'B'], seed % 2);
    for (let step = 0; step < 400 && s.phase === 'play'; step++) {
      const moves = G.legalPits(s, s.active);
      assert.ok(moves.length > 0, 'the player to move always has a pit to play');
      for (const pit of moves.slice(0, 2)) assert.doesNotThrow(() => G.apply(s, s.active, { type: 'sow', pit }));
      s = G.apply(s, s.active, { type: 'sow', pit: moves[Math.floor(rng() * moves.length)] });
      assert.equal(total(s), 48);
    }
    assert.equal(s.phase, 'over', `game ${seed} finished`);
    assert.equal(s.end.scores[0] + s.end.scores[1], 48);
  }
});
