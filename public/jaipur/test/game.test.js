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

const count = (list, what) => list.filter((c) => c === what).length;
const sum = (list) => list.reduce((t, v) => t + v, 0);

// A game with a table we control: no randomness in what is on it.
function table({ market, hands = [[], []], herds = [0, 0], deck = ['leather', 'leather', 'leather', 'leather', 'leather', 'leather'], active = 0 }) {
  const s = G.newGame(['A', 'B'], active, mulberry32(1));
  s.market = market.slice();
  s.players[0].hand = hands[0].slice();
  s.players[1].hand = hands[1].slice();
  s.players[0].herd = herds[0];
  s.players[1].herd = herds[1];
  s.deck = deck.slice();
  s.active = active;
  return s;
}

function totalCards(s) {
  const goneTotal = Object.values(s.gone).reduce((t, n) => t + n, 0);
  const inHands = s.players.reduce((t, p) => t + p.hand.length + p.herd, 0);
  return s.deck.length + s.market.length + inHands + goneTotal;
}

test('the deck, tokens and bonus tokens are the real counts', () => {
  assert.equal(G.GOODS.reduce((t, g) => t + G.COPIES[g], 0) + G.CAMELS, 55);
  assert.equal(G.GOODS.reduce((t, g) => t + G.TOKENS[g].length, 0), 38);
  assert.equal(sum(Object.values(G.BONUS).map((l) => l.length)), 18);
  assert.deepEqual(G.TOKENS.diamond, [7, 7, 5, 5, 5]);
  assert.deepEqual(G.TOKENS.leather, [4, 3, 2, 1, 1, 1, 1, 1, 1]);
  assert.deepEqual(G.BONUS[5], [8, 8, 9, 10, 10]);
});

test('a new round: market of five with three camels, five cards dealt each (camels go to the herd), nothing lost', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const s = G.newGame(['A', 'B'], seed % 2, mulberry32(seed));
    assert.equal(s.market.length, 5);
    assert.ok(count(s.market, 'camel') >= 3);
    for (const p of s.players) assert.equal(p.hand.length + p.herd, 5);
    assert.equal(totalCards(s), 55);
    assert.equal(s.active, seed % 2);
    assert.equal(s.round, 1);
    assert.deepEqual(s.seals, [0, 0]);
    assert.deepEqual(s.piles.silver, [5, 5, 5, 5, 5]);
  }
});

test('take: one goods card goes to your hand and the market is refilled from the deck', () => {
  const s = table({ market: ['camel', 'camel', 'cloth', 'spice', 'gold'], deck: ['silver', 'leather'] });
  const t = G.apply(s, 0, { type: 'take', card: 'cloth' });
  assert.deepEqual(t.players[0].hand, ['cloth']);
  assert.equal(t.market.length, 5);
  assert.ok(t.market.includes('leather'), 'refilled from the top of the deck');
  assert.equal(t.deck.length, 1);
  assert.equal(t.active, 1);
  assert.throws(() => G.apply(s, 0, { type: 'take', card: 'diamond' }), /not in the market/);
  assert.throws(() => G.apply(s, 0, { type: 'take', card: 'camel' }), /camels/);
  assert.throws(() => G.apply(s, 1, { type: 'take', card: 'cloth' }), /not your turn/);
});

test('take: a full hand of seven cannot take another, but camels are never in the hand', () => {
  const full = ['cloth', 'cloth', 'spice', 'spice', 'leather', 'leather', 'silver'];
  const s = table({ market: ['camel', 'camel', 'camel', 'gold', 'gold'], hands: [full, []], herds: [9, 0] });
  assert.throws(() => G.apply(s, 0, { type: 'take', card: 'gold' }), /hand is full/);
  const t = G.apply(s, 0, { type: 'camels' });
  assert.equal(t.players[0].herd, 12);
  assert.equal(t.players[0].hand.length, 7);
  assert.equal(count(t.market, 'camel'), 0);
});

test('camels: takes every camel in the market and refills that many', () => {
  const s = table({ market: ['camel', 'camel', 'camel', 'gold', 'cloth'], deck: ['silver', 'leather', 'spice', 'spice'] });
  const t = G.apply(s, 0, { type: 'camels' });
  assert.equal(t.players[0].herd, 3);
  assert.equal(t.market.length, 5);
  assert.equal(t.deck.length, 1);
  assert.throws(() => G.apply(t, 1, { type: 'camels' }), /no camels/);
});

test('exchange: swap at least two, equal numbers, never taking camels or the kind you give', () => {
  const s = table({ market: ['camel', 'cloth', 'cloth', 'spice', 'gold'], hands: [['leather', 'leather', 'silver'], []], herds: [2, 0] });
  const t = G.apply(s, 0, { type: 'exchange', take: ['cloth', 'cloth'], give: ['leather', 'camel'] });
  assert.deepEqual(t.players[0].hand.slice().sort(), ['cloth', 'cloth', 'leather', 'silver']);
  assert.equal(t.players[0].herd, 1);
  assert.deepEqual(t.market.slice().sort(), ['camel', 'camel', 'gold', 'leather', 'spice']);
  assert.equal(t.deck.length, s.deck.length, 'the market is not refilled from the deck');
  const bad = (a, re) => assert.throws(() => G.apply(s, 0, { type: 'exchange', ...a }), re);
  bad({ take: ['cloth'], give: ['leather'] }, /at least two/);
  bad({ take: ['cloth', 'spice'], give: ['leather'] }, /as many/);
  bad({ take: ['camel', 'cloth'], give: ['leather', 'leather'] }, /camels/);
  bad({ take: ['cloth', 'spice'], give: ['cloth', 'leather'] }, /kind of card you are taking/);
  bad({ take: ['gold', 'gold'], give: ['leather', 'leather'] }, /not in the market/);
  bad({ take: ['cloth', 'spice'], give: ['silver', 'silver'] }, /do not have those/);
  bad({ take: ['cloth', 'spice'], give: ['camel', 'camel', 'camel'] }, /as many/);
  const camels = { ...s, players: s.players.map((p, i) => (i === 0 ? { ...p, herd: 1 } : p)) };
  assert.throws(() => G.apply(camels, 0, { type: 'exchange', take: ['cloth', 'spice'], give: ['camel', 'camel'] }), /that many camels/);
});

test('exchange: giving camels cannot push the hand past seven', () => {
  const hand = ['cloth', 'cloth', 'spice', 'spice', 'leather', 'leather'];
  const s = table({ market: ['gold', 'gold', 'silver', 'silver', 'diamond'], hands: [hand, []], herds: [5, 0] });
  // 6 cards + 2 taken for 2 camels = 8
  assert.throws(() => G.apply(s, 0, { type: 'exchange', take: ['gold', 'silver'], give: ['camel', 'camel'] }), /more than 7/);
  const ok = G.apply(s, 0, { type: 'exchange', take: ['gold', 'silver'], give: ['camel', 'cloth'] });
  assert.equal(ok.players[0].hand.length, 7);
  assert.equal(ok.players[0].herd, 4);
});

test('sell: tokens come off the top of the pile, premium goods need two, bonus tokens from three cards', () => {
  const s = table({ market: ['camel', 'camel', 'camel', 'gold', 'gold'], hands: [['cloth', 'cloth', 'cloth', 'cloth', 'diamond', 'silver'], []] });
  assert.throws(() => G.apply(s, 0, { type: 'sell', good: 'diamond', count: 1 }), /at least 2/);
  assert.throws(() => G.apply(s, 0, { type: 'sell', good: 'cloth', count: 5 }), /do not have that many/);
  const one = G.apply(s, 0, { type: 'sell', good: 'cloth', count: 2 });
  assert.deepEqual(one.players[0].tokens.cloth, [5, 3]);
  assert.deepEqual(one.piles.cloth, [3, 2, 2, 1, 1]);
  assert.equal(one.players[0].bonus.length, 0);
  assert.equal(one.gone.cloth, 2);
  const four = G.apply(s, 0, { type: 'sell', good: 'cloth', count: 4 });
  assert.deepEqual(four.players[0].tokens.cloth, [5, 3, 3, 2]);
  assert.equal(four.players[0].bonus.length, 1);
  assert.ok([4, 5, 6].includes(four.players[0].bonus[0]), 'a four-card bonus is 4, 5 or 6');
  assert.equal(four.bonusPiles[4].length, 5);
  assert.equal(four.last.bonus, true);
});

test('sell: five or more cards use the five-card bonus pile, and an empty token pile just gives less', () => {
  const s = table({ market: ['camel', 'camel', 'camel', 'gold', 'gold'], hands: [['cloth', 'cloth', 'cloth', 'cloth', 'cloth', 'cloth'], []] });
  s.piles.cloth = [2, 1];
  const t = G.apply(s, 0, { type: 'sell', good: 'cloth', count: 6 });
  assert.deepEqual(t.players[0].tokens.cloth, [2, 1]);
  assert.equal(t.players[0].bonus.length, 1);
  assert.ok([8, 9, 10].includes(t.players[0].bonus[0]));
  assert.equal(t.bonusPiles[5].length, 4);
  assert.equal(t.players[0].hand.length, 0);
});

test('the round ends when three kinds of goods tokens run out', () => {
  const s = table({ market: ['camel', 'camel', 'camel', 'gold', 'gold'], hands: [['leather', 'leather', 'leather'], ['cloth']], herds: [0, 0] });
  s.piles.diamond = [];
  s.piles.gold = [];
  s.piles.leather = [1, 1, 1];
  const t = G.apply(s, 0, { type: 'sell', good: 'leather', count: 3 });
  assert.equal(t.phase, 'over');
  assert.equal(t.end.reason, 'piles');
  assert.equal(G.emptyPiles(t), 3);
});

test('the round ends when the market cannot be refilled', () => {
  const s = table({ market: ['camel', 'camel', 'camel', 'gold', 'cloth'], deck: [] });
  const t = G.apply(s, 0, { type: 'take', card: 'cloth' });
  assert.equal(t.phase, 'over');
  assert.equal(t.end.reason, 'deck');
  // taking the very last card of the deck still lets the round carry on until the next refill
  const s2 = table({ market: ['camel', 'camel', 'camel', 'gold', 'cloth'], deck: ['spice'] });
  const t2 = G.apply(s2, 0, { type: 'take', card: 'cloth' });
  assert.equal(t2.phase, 'play');
  assert.equal(t2.deck.length, 0);
  const t3 = G.apply(t2, 1, { type: 'take', card: 'gold' });
  assert.equal(t3.phase, 'over');
});

test('scoring: camel bonus to the bigger herd (none on a tie), then the most bonus tokens, then goods tokens', () => {
  const finish = (setup) => {
    const s = table({ market: ['camel', 'camel', 'camel', 'gold', 'cloth'], deck: [], hands: [['spice'], ['spice']], herds: setup.herds });
    s.players[0].tokens.cloth = setup.tokens0 || [];
    s.players[1].tokens.cloth = setup.tokens1 || [];
    s.players[0].bonus = setup.bonus0 || [];
    s.players[1].bonus = setup.bonus1 || [];
    return G.apply(s, 0, { type: 'take', card: 'cloth' });
  };
  let t = finish({ herds: [4, 2], tokens0: [1], tokens1: [5] });
  assert.equal(t.end.camelWinner, 0);
  assert.deepEqual(t.end.scores, [6, 5]);
  assert.equal(t.end.winner, 0);
  assert.deepEqual(t.seals, [1, 0]);
  t = finish({ herds: [3, 3], tokens0: [1], tokens1: [5] });
  assert.equal(t.end.camelWinner, null);
  assert.equal(t.end.winner, 1);
  // level on points: the player with more bonus tokens wins
  t = finish({ herds: [3, 3], tokens0: [3, 3], tokens1: [5], bonus0: [], bonus1: [1] });
  assert.deepEqual(t.end.scores, [6, 6]);
  assert.equal(t.end.winner, 1);
  // still level: the player with more goods tokens
  t = finish({ herds: [3, 3], tokens0: [3, 3], tokens1: [6], bonus0: [], bonus1: [] });
  assert.equal(t.end.winner, 0);
  // level on everything: nobody takes the seal
  t = finish({ herds: [3, 3], tokens0: [3], tokens1: [3] });
  assert.equal(t.end.winner, null);
  assert.deepEqual(t.seals, [0, 0]);
});

test('a match: the other player starts each new round, and two seals win it', () => {
  const rng = mulberry32(5);
  let s = G.newGame(['A', 'B'], 0, rng);
  const finishWith = (winner) => {
    const f = clone(s);
    f.phase = 'over';
    f.end = { reason: 'deck', camels: [0, 0], camelWinner: null, winner, scores: [0, 0], matchWinner: null };
    f.seals[winner] += 1;
    if (f.seals[winner] >= 2) f.end.matchWinner = winner;
    return f;
  };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  s = finishWith(1);
  assert.throws(() => G.apply(clone(s), 0, { type: 'take', card: 'cloth' }), /over/);
  s = G.apply(s, 0, { type: 'rematch' }, rng);
  assert.equal(s.round, 2);
  assert.equal(s.phase, 'play');
  assert.equal(s.starter, 1, 'the other player starts round two');
  assert.equal(s.active, 1);
  assert.deepEqual(s.seals, [0, 1]);
  assert.equal(totalCards(s), 55);
  s = finishWith(1);
  assert.equal(s.end.matchWinner, 1);
  s = G.apply(s, 1, { type: 'rematch' }, rng);
  assert.equal(s.round, 1);
  assert.deepEqual(s.seals, [0, 0], 'a new match starts from nothing');
  assert.equal(s.starter, 0);
  assert.throws(() => G.apply(s, 0, { type: 'rematch' }), /not over/);
});

test('viewFor hides the deck, the other hand and their bonus values, and keeps herds and tokens public', () => {
  const s = table({ market: ['camel', 'camel', 'camel', 'gold', 'cloth'], hands: [['spice', 'cloth'], ['silver', 'silver', 'leather']], herds: [2, 4] });
  s.players[1].bonus = [3, 2];
  s.players[1].tokens.cloth = [5];
  const v = G.viewFor(s, 0);
  assert.equal(v.deck, undefined);
  assert.equal(v.deckCount, 6);
  assert.equal(v.bonusPiles, undefined);
  assert.deepEqual(v.players[0].hand, ['spice', 'cloth']);
  assert.deepEqual(v.players[1].hand, []);
  assert.equal(v.players[1].handCount, 3);
  assert.deepEqual(v.players[1].bonus, []);
  assert.equal(v.players[1].bonusCount, 2);
  assert.equal(v.players[1].herd, 4);
  assert.deepEqual(v.players[1].tokens.cloth, [5]);
  assert.equal(JSON.stringify(v).includes('"silver","silver"'), false);
  // once the round is over, nothing is hidden
  const o = clone(s);
  o.phase = 'over';
  const ov = G.viewFor(o, 0);
  assert.deepEqual(ov.players[1].hand, ['silver', 'silver', 'leather']);
  assert.deepEqual(ov.players[1].bonus, [3, 2]);
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
});

test('legalActions are exactly what apply accepts', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const rng = mulberry32(seed);
    let s = G.newGame(['A', 'B'], seed % 2, rng);
    for (let step = 0; step < 300 && s.phase === 'play'; step++) {
      const legal = G.legalActions(s, s.active);
      assert.ok(legal.length > 0, `a player always has something to do (seed ${seed}, step ${step})`);
      for (const a of legal) assert.doesNotThrow(() => G.apply(s, s.active, a, rng), JSON.stringify(a));
      assert.deepEqual(G.legalActions(G.viewFor(s, s.active), s.active), legal, 'a player sees the same options in their view');
      // and a few things that must not be allowed
      assert.deepEqual(G.legalActions(s, 1 - s.active), []);
      s = G.apply(s, s.active, legal[Math.floor(rng() * legal.length)], rng);
      assert.equal(totalCards(s), 55, 'no card is created or lost');
    }
  }
});

test('random play always finishes a round, with a sensible result', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const rng = mulberry32(seed * 3);
    let s = G.newGame(['A', 'B'], seed % 2, rng);
    let steps = 0;
    while (s.phase === 'play') {
      const legal = G.legalActions(s, s.active);
      s = G.apply(s, s.active, legal[Math.floor(rng() * legal.length)], rng);
      assert.ok(++steps < 3000, 'the round must end');
    }
    assert.ok(['piles', 'deck'].includes(s.end.reason));
    assert.equal(s.end.scores.length, 2);
    assert.equal(s.end.scores[0], G.score(s, 0).total);
    assert.ok(s.seals[0] + s.seals[1] <= 1);
  }
});
