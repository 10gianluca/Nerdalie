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

const clone = (o) => JSON.parse(JSON.stringify(o));

// A game with a table we set up ourselves. stones: { index: [sideOfSeat0, sideOfSeat1] }
function table({ stones = {}, hands = [[], []], deck = [], active = 0, owners = {} }) {
  const s = G.newGame(['A', 'B'], active, mulberry32(1));
  s.stones.forEach((st) => { st.sides = [[], []]; st.done = [0, 0]; st.owner = null; });
  for (const [k, [a, b]] of Object.entries(stones)) {
    s.stones[k].sides = [a.slice(), b.slice()];
    s.stones[k].done = [a.length === 3 ? s.stamp++ : 0, b.length === 3 ? s.stamp++ : 0];
  }
  for (const [k, seat] of Object.entries(owners)) s.stones[k].owner = seat;
  s.hands = hands.map((h) => h.slice());
  s.deck = deck.slice();
  s.active = active;
  return s;
}

test('54 distinct cards: six colours, one to nine', () => {
  assert.equal(G.ALL.length, 54);
  assert.equal(new Set(G.ALL).size, 54);
  assert.deepEqual(G.parse('B7'), { color: 'B', value: 7 });
});

test('formations: colour run > three of a kind > colour > run > sum', () => {
  const r = (...ids) => G.rankOf(ids);
  assert.deepEqual(r('R3', 'R4', 'R5'), { type: 5, sum: 12 });
  assert.deepEqual(r('R5', 'R3', 'R4'), { type: 5, sum: 12 }, 'order of the cards does not matter');
  assert.deepEqual(r('R5', 'B5', 'G5'), { type: 4, sum: 15 });
  assert.deepEqual(r('R1', 'R5', 'R9'), { type: 3, sum: 15 });
  assert.deepEqual(r('R3', 'B4', 'G5'), { type: 2, sum: 12 });
  assert.deepEqual(r('R1', 'B5', 'G9'), { type: 1, sum: 15 });
  assert.deepEqual(r('R7', 'B8', 'G9'), { type: 2, sum: 24 }, 'a run needs no matching colour');
  assert.deepEqual(r('R8', 'B9', 'G9'), { type: 1, sum: 26 }, 'two the same is not a run');
  const rank = [r('R1', 'R2', 'R3'), r('R1', 'B1', 'G1'), r('R1', 'R5', 'R9'), r('R1', 'B2', 'G3'), r('R9', 'B8', 'G5')];
  for (let i = 0; i + 1 < rank.length; i++) assert.ok(G.compareRank(rank[i], rank[i + 1]) > 0, `formation ${i} beats ${i + 1}`);
  assert.ok(G.compareRank(r('B9', 'B8', 'B7'), r('R3', 'R4', 'R5')) > 0, 'the same formation goes by the total');
  assert.equal(G.compareRank(r('R3', 'R4', 'R5'), r('B3', 'B4', 'B5')), 0);
});

test('setup: six cards each, the rest in the deck, nine empty stones', () => {
  const s = G.newGame(['A', 'B'], 1, mulberry32(4));
  assert.equal(s.hands[0].length, 6);
  assert.equal(s.hands[1].length, 6);
  assert.equal(s.deck.length, 42);
  assert.equal(new Set([...s.deck, ...s.hands[0], ...s.hands[1]]).size, 54);
  assert.equal(s.stones.length, 9);
  assert.ok(s.stones.every((st) => st.owner == null && !st.sides[0].length && !st.sides[1].length));
  assert.equal(s.active, 1);
});

test('playing a card puts it on your side of the stone, draws a new one and passes the turn', () => {
  const s = G.newGame(['A', 'B'], 0, mulberry32(3));
  const card = s.hands[0][2];
  const next = s.deck[0];
  const t = G.apply(s, 0, { type: 'play', card, stone: 4 });
  assert.deepEqual(t.stones[4].sides[0], [card]);
  assert.equal(t.hands[0].length, 6);
  assert.ok(t.hands[0].includes(next));
  assert.equal(t.deck.length, 41);
  assert.equal(t.active, 1);
  assert.equal(t.turn, 2);
  assert.equal(t.last.card, card);
});

test('illegal plays are refused', () => {
  const s = G.newGame(['A', 'B'], 0, mulberry32(3));
  const card = s.hands[0][0];
  assert.throws(() => G.apply(s, 1, { type: 'play', card: s.hands[1][0], stone: 0 }), /not your turn/);
  assert.throws(() => G.apply(s, 0, { type: 'play', card: s.hands[1][0], stone: 0 }), /not in your hand/);
  assert.throws(() => G.apply(s, 0, { type: 'play', card, stone: 9 }), /no such stone/);
  assert.throws(() => G.apply(s, 0, { type: 'play', card, stone: -1 }), /no such stone/);
  assert.throws(() => G.apply(s, 0, { type: 'rematch' }), /not over/);
  const full = table({ stones: { 3: [['R1', 'B2', 'G4'], []] }, hands: [['O9'], ['Y1']] });
  assert.throws(() => G.apply(full, 0, { type: 'play', card: 'O9', stone: 3 }), /side of that stone is full/);
  const won = table({ owners: { 3: 1 }, hands: [['O9'], ['Y1']] });
  assert.throws(() => G.apply(won, 0, { type: 'play', card: 'O9', stone: 3 }), /already been won/);
});

test('claiming: a finished side that nothing left can beat wins the stone', () => {
  // the highest possible run: nothing but a tie can match it, and a tie goes to whoever finished first
  const s = table({ stones: { 0: [['R9', 'R8'], []] }, hands: [['R7', 'B1'], ['Y1', 'Y2']], deck: ['O5'] });
  const t = G.apply(s, 0, { type: 'play', card: 'R7', stone: 0 });
  assert.equal(t.stones[0].owner, 0);
  assert.deepEqual(t.last.claimed, [0]);
});

test('claiming: a weak finished side is not claimed while the other side could still beat it', () => {
  const s = table({ stones: { 0: [['R1', 'B2'], []] }, hands: [['G4', 'B1'], ['Y1', 'Y2']], deck: ['O5'] });
  const t = G.apply(s, 0, { type: 'play', card: 'G4', stone: 0 });
  assert.equal(t.stones[0].owner, null);
});

test('claiming: cards in your own hand cannot turn up on the other side', () => {
  // you have three of a kind; the opponent has R1 R2 and only the R3 would give them a better colour run
  const base = { stones: { 0: [['O6', 'Y6'], ['R1', 'R2']] }, deck: ['B1'] };
  const withoutR3 = table({ ...base, hands: [['G6', 'B9'], ['P1', 'P2']] });
  const free = G.apply(withoutR3, 0, { type: 'play', card: 'G6', stone: 0 });
  assert.equal(free.stones[0].owner, null, 'the R3 is still out there somewhere');
  const withR3 = table({ ...base, hands: [['G6', 'R3'], ['P1', 'P2']] });
  const sure = G.apply(withR3, 0, { type: 'play', card: 'G6', stone: 0 });
  assert.equal(sure.stones[0].owner, 0, 'you are holding the R3 yourself');
});

test('cards already played anywhere on the table are not available to the other side', () => {
  // opponent has R1 R2 and the R3 is already sitting on another stone
  const s = table({ stones: { 0: [['O6', 'Y6'], ['R1', 'R2']], 5: [['R3'], []] }, hands: [['G6', 'B9'], ['P1', 'P2']], deck: ['B1'] });
  const t = G.apply(s, 0, { type: 'play', card: 'G6', stone: 0 });
  assert.equal(t.stones[0].owner, 0);
});

test('when both sides are finished the better formation wins, and a tie goes to whoever finished first', () => {
  const better = table({ stones: { 0: [['R9', 'R8', 'R7'], ['B3', 'G3', 'O3']] }, hands: [['P1'], ['P2']], active: 0 });
  assert.equal(G.provable(better, 0, 0), true);
  assert.equal(G.provable(better, 1, 0), false);
  const equal = table({ stones: { 0: [['R3', 'R4', 'R5'], ['B3', 'B4', 'B5']] } });
  equal.stones[0].done = [5, 9];
  assert.equal(G.provable(equal, 0, 0), true, 'seat 0 finished first');
  assert.equal(G.provable(equal, 1, 0), false);
  equal.stones[0].done = [9, 5];
  assert.equal(G.provable(equal, 1, 0), true, 'now seat 1 finished first');
  assert.equal(G.provable(equal, 0, 0), false);
});

test('the other player claims what they have earned at the start of their turn', () => {
  // seat 1 already has a finished winning side; seat 0 just plays elsewhere
  const s = table({ stones: { 0: [['R1', 'B2', 'G4'], ['P9', 'P8', 'P7']] }, hands: [['O1'], ['Y1']], deck: ['G9', 'B9'] });
  const t = G.apply(s, 0, { type: 'play', card: 'O1', stone: 6 });
  assert.equal(t.stones[0].owner, 1);
  assert.equal(t.active, 1);
});

test('win with five stones', () => {
  const s = table({ owners: { 0: 0, 2: 0, 4: 0, 6: 0 }, stones: { 8: [['R9', 'R8'], []] }, hands: [['R7', 'B1'], ['Y1']], deck: ['O5'] });
  const t = G.apply(s, 0, { type: 'play', card: 'R7', stone: 8 });
  assert.equal(t.phase, 'over');
  assert.deepEqual(t.end, { winner: 0, reason: 'five' });
  assert.deepEqual(t.wins, [1, 0]);
  assert.throws(() => G.apply(t, 1, { type: 'play', card: 'Y1', stone: 1 }), /over/);
});

test('win with three stones side by side', () => {
  const s = table({ owners: { 3: 0, 4: 0 }, stones: { 5: [['R9', 'R8'], []] }, hands: [['R7', 'B1'], ['Y1']], deck: ['O5'] });
  const t = G.apply(s, 0, { type: 'play', card: 'R7', stone: 5 });
  assert.deepEqual(t.end, { winner: 0, reason: 'adjacent' });
  // three that are not side by side are not enough
  const u = table({ owners: { 1: 0, 4: 0 }, stones: { 7: [['R9', 'R8'], []] }, hands: [['R7', 'B1'], ['Y1']], deck: ['O5'] });
  assert.equal(G.apply(u, 0, { type: 'play', card: 'R7', stone: 7 }).phase, 'play');
});

test('a player with nothing to play is skipped', () => {
  // seat 1 has no cards and the deck is empty, so after seat 0 plays it is seat 0 again
  const s = table({ stones: { 1: [['R1'], []] }, hands: [['B2', 'G3'], []], deck: [] });
  const t = G.apply(s, 0, { type: 'play', card: 'B2', stone: 2 });
  assert.equal(t.active, 0);
  assert.equal(t.turn, 3);
});

test('viewFor hides the deck and the other hand', () => {
  const s = G.newGame(['A', 'B'], 0, mulberry32(6));
  const v = G.viewFor(s, 0);
  assert.equal(v.deck, undefined);
  assert.equal(v.deckCount, 42);
  assert.deepEqual(v.hands[0], s.hands[0]);
  assert.deepEqual(v.hands[1], []);
  assert.deepEqual(v.handCounts, [6, 6]);
  assert.equal(JSON.stringify(v).includes(s.hands[1][0]), false);
});

test('random play: legal plays are accepted, no card is lost, and the game always ends with a winner', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const rng = mulberry32(seed);
    let s = G.newGame(['A', 'B'], seed % 2, rng);
    for (let step = 0; step < 200 && s.phase === 'play'; step++) {
      const plays = G.legalPlays(s, s.active);
      assert.ok(plays.length > 0, `there is always something to play (seed ${seed})`);
      const p = plays[Math.floor(rng() * plays.length)];
      s = G.apply(s, s.active, { type: 'play', card: p.card, stone: p.stone });
      const cards = [...s.deck, ...s.hands[0], ...s.hands[1], ...G.onTable(s)];
      assert.equal(new Set(cards).size, 54);
      assert.equal(cards.length, 54);
    }
    assert.equal(s.phase, 'over', `game ${seed} finished`);
    assert.ok(['five', 'adjacent'].includes(s.end.reason));
    const owned = s.stones.filter((st) => st.owner === s.end.winner).length;
    assert.ok(owned >= 3);
  }
});
