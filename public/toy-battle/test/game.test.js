const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../game.js');
const B = require('../boards.js');
const T = require('../troops.js');

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const fixed = (v) => () => v;

// A game with empty racks, so each test can lay out exactly what it needs.
let uid = 1000;
function mk(terrain = 'castle', starter = 0) {
  const s = G.newGame(['Ana', 'Ben'], starter, terrain, mulberry32(7));
  s.players[0].rack = [];
  s.players[1].rack = [];
  return s;
}
function troop(s, owner, type) {
  const id = 'x' + uid++;
  s.troops[id] = { type, owner };
  return id;
}
const rack = (s, p, types) => (s.players[p].rack = types.map((t) => troop(s, p, t)));
const put = (s, base, owner, type) => {
  const id = troop(s, owner, type);
  s.stacks[base].push(id);
  return id;
};
const slotsFor = (s, p, id) => G.legalSlots(s, p, id).sort();

test('setup: 24 troops each, 4 removed unseen, then 3 and 4 drawn', () => {
  const s = G.newGame(['Ana', 'Ben'], 1, 'castle', mulberry32(1));
  assert.equal(Object.keys(s.troops).length, 48);
  for (const p of [0, 1]) {
    const mine = Object.entries(s.troops).filter(([, t]) => t.owner === p).map(([, t]) => t.type);
    assert.equal(mine.length, 24);
    for (const type of T.TROOP_ORDER) assert.equal(mine.filter((x) => x === type).length, 3, `${type} should have 3 copies`);
    assert.equal(s.removed[p].length, 4);
  }
  assert.equal(s.players[1].rack.length, 3, 'the starting player draws 3');
  assert.equal(s.players[0].rack.length, 4, 'the other player draws 4');
  assert.equal(s.players[1].reserve.length, 24 - 4 - 3);
  assert.equal(s.players[0].reserve.length, 24 - 4 - 4);
  assert.equal(s.active, 1);
  assert.equal(s.phase, 'turn');
});

test('you can only place on bases joined to your H.Q. through bases you occupy', () => {
  const s = mk();
  const [skully] = rack(s, 0, ['skully']);
  assert.deepEqual(slotsFor(s, 0, skully), ['e1', 'e2'], 'on an empty board only the bases beside the H.Q.');
  put(s, 'e1', 0, 'roxy');
  assert.deepEqual(slotsFor(s, 0, skully), ['d1', 'd2', 'e1', 'e2']);
  put(s, 'd2', 1, 'roxy'); // an enemy troop cuts the chain
  put(s, 'c1', 0, 'roxy'); // not connected any more only through d2? c1 touches d1 and d2: d1 empty so it is cut off
  assert.ok(!slotsFor(s, 0, skully).includes('c2'), 'c2 is only reachable through the enemy base');
});

test('you can never place on your own H.Q.; the enemy H.Q. needs a connection', () => {
  const s = mk();
  const [roxy] = rack(s, 0, ['roxy']);
  assert.ok(!slotsFor(s, 0, roxy).includes('hq0'));
  assert.ok(!slotsFor(s, 0, roxy).includes('hq1'), 'not connected yet');
  assert.throws(() => G.apply(s, 0, { type: 'place', troop: roxy, slot: 'hq0' }), /own H\.Q\./);
});

test('an enemy troop can only be covered by a strictly stronger one; your own can be covered by anything', () => {
  const s = mk();
  put(s, 'e1', 0, 'skully');
  put(s, 'e2', 1, 'jumbo'); // strength 3, sits on a base beside blue's H.Q.
  const [a, b, c] = rack(s, 0, ['jumbo', 'hook', 'skully']);
  assert.ok(!slotsFor(s, 0, a).includes('e2'), 'equal strength cannot cover');
  assert.ok(slotsFor(s, 0, b).includes('e2'), 'stronger covers');
  assert.ok(!slotsFor(s, 0, c).includes('e2'), 'weaker cannot');
  assert.ok(slotsFor(s, 0, c).includes('e1'), 'a troop can sit on your own, even a stronger one');
});

test('Kwak is a joker: it covers anything, and anything covers it', () => {
  const s = mk();
  put(s, 'e1', 1, 'roxy');
  put(s, 'e2', 1, 'kwak');
  const [kwak, skully] = rack(s, 0, ['kwak', 'skully']);
  assert.ok(slotsFor(s, 0, kwak).includes('e1'), 'Kwak covers the strongest troop');
  assert.ok(slotsFor(s, 0, kwak).includes('e2'), 'Kwak covers Kwak');
  assert.ok(slotsFor(s, 0, skully).includes('e2'), 'even the weakest covers Kwak');
  assert.ok(!slotsFor(s, 0, skully).includes('e1'));
});

test('Hook ignores the connection rule for bases, but not for the enemy H.Q.', () => {
  const s = mk();
  const [hook, roxy] = rack(s, 0, ['hook', 'roxy']);
  assert.ok(slotsFor(s, 0, hook).includes('c1'), 'Hook lands anywhere');
  assert.ok(!slotsFor(s, 0, roxy).includes('c1'));
  assert.ok(!slotsFor(s, 0, hook).includes('hq1'), 'but not on an unconnected H.Q.');
});

test('only the top troop occupies a base, and uncovering one reveals the troop below', () => {
  const s = mk();
  put(s, 'e1', 0, 'skully');
  const top = put(s, 'e1', 1, 'capn');
  assert.equal(G.occupant(s, 'e1'), 1);
  assert.equal(G.topOf(s, 'e1'), top);
  s.stacks.e1.pop();
  assert.equal(G.occupant(s, 'e1'), 0, 'the covered blue troop is back on top');
});

test('drawing: 2 troops, 1 if only 1 is left or fits, never with a full rack', () => {
  let s = mk();
  s.players[0].rack = rack(s, 0, ['skully']);
  const before = s.players[0].reserve.length;
  s = G.apply(s, 0, { type: 'draw' });
  assert.equal(s.players[0].rack.length, 3);
  assert.equal(s.players[0].reserve.length, before - 2);
  assert.equal(s.active, 1, 'drawing uses the turn');

  s = mk();
  rack(s, 0, ['skully', 'capn', 'jumbo', 'hook', 'xb42', 'star', 'roxy']);
  s = G.apply(s, 0, { type: 'draw' });
  assert.equal(s.players[0].rack.length, 8, 'only one free space, so only one drawn');

  s = mk();
  rack(s, 0, ['skully', 'capn', 'jumbo', 'hook', 'xb42', 'star', 'roxy', 'kwak']);
  assert.throws(() => G.apply(s, 0, { type: 'draw' }), /full/);

  s = mk();
  s.players[0].reserve = s.players[0].reserve.slice(0, 1);
  s = G.apply(s, 0, { type: 'draw' });
  assert.equal(s.players[0].rack.length, 1);
});

test('Skully draws 2 (only 1 with 7 already on the rack); Star draws 1; both are optional', () => {
  let s = mk();
  let [skully] = rack(s, 0, ['skully']);
  s = G.apply(s, 0, { type: 'place', troop: skully, slot: 'e1' });
  assert.equal(s.phase, 'effect');
  assert.equal(s.pending.kind, 'draw2');
  const reserve = s.players[0].reserve.length;
  s = G.apply(s, 0, { type: 'effect', use: true });
  assert.equal(s.players[0].rack.length, 2);
  assert.equal(s.players[0].reserve.length, reserve - 2);
  assert.equal(s.active, 1);

  s = mk();
  const ids = rack(s, 0, ['skully', 'capn', 'jumbo', 'hook', 'xb42', 'star', 'roxy', 'kwak']);
  s = G.apply(s, 0, { type: 'place', troop: ids[0], slot: 'e1' });
  s = G.apply(s, 0, { type: 'effect', use: true });
  assert.equal(s.players[0].rack.length, 8, 'drew only one to reach the limit');

  s = mk();
  [skully] = rack(s, 0, ['skully']);
  s = G.apply(s, 0, { type: 'place', troop: skully, slot: 'e1' });
  s = G.apply(s, 0, { type: 'effect', use: false });
  assert.equal(s.players[0].rack.length, 0, 'declined');
  assert.equal(s.active, 1);

  s = mk();
  const [star] = rack(s, 0, ['star']);
  s = G.apply(s, 0, { type: 'place', troop: star, slot: 'e1' });
  s = G.apply(s, 0, { type: 'effect', use: true });
  assert.equal(s.players[0].rack.length, 1);
});

test('XB-42 discards a random troop from the opponent\'s rack, face up', () => {
  let s = mk();
  rack(s, 1, ['skully', 'capn', 'roxy']);
  const [xb] = rack(s, 0, ['xb42']);
  const victim = s.players[1].rack[1];
  s = G.apply(s, 0, { type: 'place', troop: xb, slot: 'e1' });
  s = G.apply(s, 0, { type: 'effect', use: true }, fixed(0.4)); // index 1 of 3
  assert.equal(s.players[1].rack.length, 2);
  assert.ok(s.discard.includes(victim));
  assert.ok(!s.players[1].rack.includes(victim));
});

test('Jumbo discards an adjacent visible enemy troop; with none adjacent the effect is skipped', () => {
  let s = mk();
  put(s, 'e1', 0, 'roxy');
  put(s, 'd1', 1, 'skully'); // d1 touches e1 and c1
  const enemy = G.topOf(s, 'd1');
  put(s, 'c2', 1, 'skully'); // not next to d2? d2 is where Jumbo lands; c2 is adjacent to d2
  const [jumbo] = rack(s, 0, ['jumbo']);
  s = G.apply(s, 0, { type: 'place', troop: jumbo, slot: 'd2' });
  assert.equal(s.phase, 'effect');
  assert.equal(s.pending.kind, 'discardAdjacent');
  assert.throws(() => G.apply(s, 0, { type: 'effect', use: true, base: 'd1' }), /next to Jumbo/);
  const c2top = G.topOf(s, 'c2');
  s = G.apply(s, 0, { type: 'effect', use: true, base: 'c2' });
  assert.ok(s.discard.includes(c2top));
  assert.equal(G.topOf(s, 'd1'), enemy, 'only the chosen troop was discarded');

  s = mk();
  const [j2] = rack(s, 0, ['jumbo']);
  s = G.apply(s, 0, { type: 'place', troop: j2, slot: 'e1' });
  assert.equal(s.phase, 'turn', 'nothing adjacent, so no decision is needed');
  assert.equal(s.active, 1);
});

test("Cap'n lets you place an extra troop, whose own effect also applies", () => {
  let s = mk();
  const [capn, star, roxy] = rack(s, 0, ['capn', 'star', 'roxy']);
  s = G.apply(s, 0, { type: 'place', troop: capn, slot: 'e1' });
  assert.equal(s.pending.kind, 'extra');
  s = G.apply(s, 0, { type: 'effect', use: true });
  assert.equal(s.phase, 'extra');
  assert.equal(s.active, 0);
  s = G.apply(s, 0, { type: 'place', troop: star, slot: 'e2' });
  assert.equal(s.phase, 'effect');
  assert.equal(s.pending.kind, 'draw1');
  s = G.apply(s, 0, { type: 'effect', use: true });
  assert.equal(s.players[0].rack.length, 2, 'roxy plus the troop just drawn');
  assert.ok(s.players[0].rack.includes(roxy));
  assert.equal(s.active, 1);
});

test("Cap'n can chain into another Cap'n, and the extra can be skipped", () => {
  let s = mk();
  const [c1, c2, roxy] = rack(s, 0, ['capn', 'capn', 'roxy']);
  s = G.apply(s, 0, { type: 'place', troop: c1, slot: 'e1' });
  s = G.apply(s, 0, { type: 'effect', use: true });
  s = G.apply(s, 0, { type: 'place', troop: c2, slot: 'e2' });
  assert.equal(s.pending.kind, 'extra', 'the second Cap\'n offers another extra');
  s = G.apply(s, 0, { type: 'effect', use: true });
  s = G.apply(s, 0, { type: 'effect', use: false });
  assert.equal(s.active, 1);
  assert.ok(s.players[0].rack.includes(roxy));
});

test('troop effects resolve before special base effects', () => {
  let s = mk('cloud'.replace('cloud', 'clouds'));
  // R3 is a special base (City of Clouds: draw 1). Put blue's network up to it, then place Star on it.
  put(s, 'L4', 0, 'roxy');
  put(s, 'R4', 0, 'roxy');
  const [star] = rack(s, 0, ['star']);
  s = G.apply(s, 0, { type: 'place', troop: star, slot: 'R3' });
  assert.equal(s.pending.kind, 'draw1');
  assert.equal(s.pending.fromTroops, true, "Star's own effect comes first");
  s = G.apply(s, 0, { type: 'effect', use: true });
  assert.equal(s.pending.kind, 'cloud', 'then the special base');
  const before = s.players[0].rack.length;
  s = G.apply(s, 0, { type: 'effect', use: true });
  assert.equal(s.players[0].rack.length, before + 1);
  assert.equal(s.active, 1);
});

test('taking control of a region wins its medals, which you keep even if you lose a base', () => {
  const s = mk();
  // castle region [d2, c1, c2]: a triangle worth 1 medal
  put(s, 'e1', 0, 'roxy');
  put(s, 'd2', 0, 'roxy');
  put(s, 'c1', 0, 'roxy');
  const [skully] = rack(s, 0, ['roxy']);
  let g = G.apply(s, 0, { type: 'place', troop: skully, slot: 'c2' });
  assert.equal(g.medals[0], 1);
  assert.equal(g.regionTaken[B.get('castle').regions.find((r) => r.bases.length === 3 && r.bases.includes('d2') && r.bases.includes('c2') && r.bases.includes('c1')).id], 0);
  // the enemy covers one of those bases afterwards: the medal stays
  g.stacks.c1.push(troop(g, 1, 'kwak'));
  assert.equal(g.medals[0], 1);
});

test('reaching the medals objective wins at once', () => {
  const s = mk();
  s.medals = [6, 0]; // castle needs 7; the triangle is worth 1
  put(s, 'e1', 0, 'roxy');
  put(s, 'd2', 0, 'roxy');
  put(s, 'c1', 0, 'roxy');
  const [r] = rack(s, 0, ['roxy']);
  const g = G.apply(s, 0, { type: 'place', troop: r, slot: 'c2' });
  assert.equal(g.phase, 'over');
  assert.deepEqual([g.end.winner, g.end.reason], [0, 'medals']);
});

test('placing on the enemy H.Q. wins immediately; with two enemy H.Q. either one will do', () => {
  const s = mk();
  const b = B.get('castle');
  // build a chain for blue to the top: e1 -> d1 -> t_d3 ... just give blue every base next to hq1
  for (const n of b.adj.hq1) put(s, n, 0, 'skully');
  // connect them: occupy every base so the network reaches
  for (const base of b.bases) if (!s.stacks[base].length) put(s, base, 0, 'skully');
  const [roxy] = rack(s, 0, ['roxy']);
  assert.ok(slotsFor(s, 0, roxy).includes('hq1'));
  const g = G.apply(s, 0, { type: 'place', troop: roxy, slot: 'hq1' });
  assert.deepEqual([g.phase, g.end.winner, g.end.reason], ['over', 0, 'hq']);

  const t = mk('battlefield');
  const bf = B.get('battlefield');
  assert.equal(bf.hqs[1].length, 2);
  for (const base of bf.bases) put(t, base, 0, 'skully');
  const [k] = rack(t, 0, ['kwak']);
  const hqSlots = slotsFor(t, 0, k).filter((x) => bf.nodes[x].kind === 'hq');
  assert.deepEqual(hqSlots, bf.hqs[1].slice().sort(), 'both enemy H.Q. can be taken');
});

test('Castle Field special base: call another of your troops back to the rack', () => {
  let s = mk();
  put(s, 'e1', 0, 'roxy');
  const back = put(s, 'e2', 0, 'star');
  const [skully] = rack(s, 0, ['skully']);
  s = G.apply(s, 0, { type: 'place', troop: skully, slot: 'd2' }); // d2 is special
  assert.equal(s.pending.kind, 'draw2');
  s = G.apply(s, 0, { type: 'effect', use: false });
  assert.equal(s.pending.kind, 'castle');
  assert.throws(() => G.apply(s, 0, { type: 'effect', use: true, base: 'd2' }), /other troops/);
  s = G.apply(s, 0, { type: 'effect', use: true, base: 'e2' });
  assert.ok(s.players[0].rack.includes(back));
  assert.equal(G.topOf(s, 'e2'), null);
});

test('City of Clouds special base: draw 1', () => {
  let s = mk('clouds');
  put(s, 'L4', 0, 'roxy');
  put(s, 'R4', 0, 'roxy');
  const [roxy] = rack(s, 0, ['roxy']);
  s = G.apply(s, 0, { type: 'place', troop: roxy, slot: 'R3' });
  assert.equal(s.pending.kind, 'cloud');
  s = G.apply(s, 0, { type: 'effect', use: true });
  assert.equal(s.players[0].rack.length, 1);
});

test('Volcanic Jungle special base: move an adjacent enemy troop to a base beside it', () => {
  let s = mk('volcano');
  put(s, 'D1', 0, 'roxy');
  put(s, 'S3', 1, 'skully');
  const enemy = G.topOf(s, 'S3');
  const [roxy] = rack(s, 0, ['roxy']);
  s = G.apply(s, 0, { type: 'place', troop: roxy, slot: 'V' });
  assert.equal(s.pending.kind, 'volcano');
  assert.throws(() => G.apply(s, 0, { type: 'effect', use: true, from: 'S3', to: 'D2' }), /next to it/);
  s = G.apply(s, 0, { type: 'effect', use: true, from: 'S3', to: 'D1' });
  assert.equal(G.topOf(s, 'S3'), null);
  assert.equal(G.topOf(s, 'D1'), enemy, 'moved on top of the base next door, ignoring the placement rules');
});

test('Cursed Cemetery special base: take one of your discarded troops back', () => {
  let s = mk('cemetery');
  put(s, 'j2', 0, 'roxy');
  const dead = troop(s, 0, 'star');
  s.discard.push(dead, troop(s, 1, 'roxy'));
  const [roxy] = rack(s, 0, ['roxy']);
  s = G.apply(s, 0, { type: 'place', troop: roxy, slot: 'i2' });
  assert.equal(s.pending.kind, 'cemetery');
  assert.throws(() => G.apply(s, 0, { type: 'effect', use: true, troop: s.discard[1] }), /your troops/);
  s = G.apply(s, 0, { type: 'effect', use: true, troop: dead });
  assert.ok(s.players[0].rack.includes(dead));
  assert.ok(!s.discard.includes(dead));
});

test('Battlefield special base freezes a random enemy troop until the end of their next turn', () => {
  let s = mk('battlefield');
  put(s, 'Q', 0, 'roxy');
  put(s, 'P', 0, 'roxy');
  const [roxy] = rack(s, 0, ['roxy']);
  const [a, b] = rack(s, 1, ['roxy', 'roxy']);
  s = G.apply(s, 0, { type: 'place', troop: roxy, slot: 'S' });
  assert.equal(s.pending.kind, 'battlefield');
  s = G.apply(s, 0, { type: 'effect', use: true }, fixed(0.9));
  assert.equal(s.players[1].frozen, b);
  assert.equal(s.active, 1);
  assert.throws(() => G.apply(s, 1, { type: 'place', troop: b, slot: 'Q' }), /frozen/);
  assert.ok(!G.placeableTroops(s, 1).includes(b));
  assert.ok(a);
  s = G.apply(s, 1, { type: 'draw' });
  assert.equal(s.players[1].frozen, null, 'back in play once their turn is over');
});

test('Station Metal-X: troop effects are not applied on special bases', () => {
  let s = mk('metal');
  put(s, 'B', 0, 'roxy');
  const [star] = rack(s, 0, ['star']);
  s = G.apply(s, 0, { type: 'place', troop: star, slot: 'C' }); // C is a shielded special base
  assert.equal(s.phase, 'turn');
  assert.equal(s.active, 1);
  assert.equal(s.players[0].rack.length, 0, 'Star drew nothing');
});

test('Tropical Pool: special bases and the H.Q. only take the indicated strengths (jokers always fit)', () => {
  const s = mk('pool');
  put(s, 'L5', 0, 'roxy');
  put(s, 'R5', 0, 'roxy');
  const [roxy, skully, kwak] = rack(s, 0, ['roxy', 'skully', 'kwak']);
  // M4 accepts strengths 1-3 only
  assert.ok(!slotsFor(s, 0, roxy).includes('M4'));
  assert.ok(slotsFor(s, 0, skully).includes('M4'));
  assert.ok(slotsFor(s, 0, kwak).includes('M4'));
  assert.throws(() => G.apply(s, 0, { type: 'place', troop: roxy, slot: 'M4' }), /Only strengths/);
});

test('the game ends when a player cannot draw or place: more medals wins, a tie loses for the player who is stuck', () => {
  let s = mk();
  s.players[1].reserve = [];
  s.players[1].rack = [];
  const [r] = rack(s, 0, ['roxy']);
  s.medals = [1, 0];
  s = G.apply(s, 0, { type: 'place', troop: r, slot: 'e1' });
  assert.deepEqual([s.phase, s.end.reason, s.end.winner, s.end.stuck], ['over', 'stuck', 0, 1]);

  s = mk();
  s.players[1].reserve = [];
  s.players[1].rack = [];
  const [r2] = rack(s, 0, ['roxy']);
  s = G.apply(s, 0, { type: 'place', troop: r2, slot: 'e1' });
  assert.equal(s.end.winner, 0, 'tied on medals: the stuck player (Ben) loses');

  s = mk();
  s.active = 1;
  s.players[0].reserve = [];
  s.players[0].rack = [];
  rack(s, 1, ['skully']);
  s.medals = [0, 2];
  s = G.apply(s, 1, { type: 'draw' });
  assert.deepEqual([s.phase, s.end.winner, s.end.stuck], ['over', 1, 0], 'more medals wins when the other player is stuck');
});

test('viewFor hides the other rack, both reserves and the identity of unseen troops', () => {
  const s = G.newGame(['Ana', 'Ben'], 0, 'castle', mulberry32(3));
  const v = G.viewFor(s, 0);
  assert.equal(v.players[0].reserve, null);
  assert.equal(v.players[0].reserveCount, s.players[0].reserve.length);
  assert.ok(v.players[0].rack.every((id) => id !== null && v.troops[id]));
  assert.ok(v.players[1].rack.every((id) => id === null));
  assert.equal(v.players[1].rack.length, s.players[1].rack.length);
  for (const id of [...s.players[1].rack, ...s.players[1].reserve, ...s.players[0].reserve, ...s.removed.flat()]) assert.ok(!(id in v.troops), 'a hidden troop leaked');
  assert.equal(v.removed, null);
});

test('legalActions on your own view matches the real state', () => {
  const s = G.newGame(['Ana', 'Ben'], 0, 'castle', mulberry32(5));
  const real = G.legalActions(s, 0).map((a) => JSON.stringify(a)).sort();
  const seen = G.legalActions(G.viewFor(s, 0), 0).map((a) => JSON.stringify(a)).sort();
  assert.deepEqual(seen, real);
  assert.deepEqual(G.legalActions(s, 1), [], 'nothing for the player who is waiting');
});

test('rematch keeps the terrain and swaps who starts', () => {
  let s = mk('metal', 0);
  s.phase = 'over';
  s.end = { winner: 0, reason: 'hq' };
  s = G.apply(s, 1, { type: 'rematch' });
  assert.equal(s.terrain, 'metal');
  assert.equal(s.starter, 1);
  assert.equal(s.phase, 'turn');
});

test('only the player whose turn it is may act', () => {
  const s = G.newGame(['Ana', 'Ben'], 0, 'castle', mulberry32(9));
  assert.throws(() => G.apply(s, 1, { type: 'draw' }), /not your turn/);
});

for (const id of B.ORDER) {
  test(`${id}: 150 random games always finish, using only legal actions`, () => {
    for (let seed = 1; seed <= 150; seed++) {
      const rng = mulberry32(seed * 31 + id.length);
      let s = G.newGame(['A', 'B'], seed % 2, id, rng);
      let steps = 0;
      while (s.phase !== 'over') {
        assert.ok(++steps < 3000, 'game did not finish');
        const options = G.legalActions(s, s.active);
        assert.ok(options.length > 0, `no legal actions in phase ${s.phase}`);
        s = G.apply(s, s.active, options[Math.floor(rng() * options.length)], rng);
      }
      assert.ok(s.end && s.end.winner !== undefined);
    }
  });
}
