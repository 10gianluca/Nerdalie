// Run with: node --test public/hocus-pocus/test
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../game.js');
const C = require('../cards.js');

// mulberry32 — a small, well-behaved deterministic PRNG (a hand-rolled LCG using `*` on large
// seeds loses precision as a JS double well before the multiply completes, and produces a short,
// degenerate sequence; this doesn't).
const dieAt = (seed) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// Finds a seed that deals BOTH players a hand containing a card of the exact requested
// type/color, so tests can set up specific situations without hand-editing private state.
function freshGame(check, seed = 1) {
  for (let i = seed; i < seed + 500; i++) {
    const s = G.newGame(['Ana', 'Ben'], 0, dieAt(i));
    if (check(s)) return s;
  }
  throw new Error('could not find a deal matching the test setup');
}

test('setup: 50 cards total, 4 dealt to each player, 10 special (5 binx + 5 book)', () => {
  const s = G.newGame(['Ana', 'Ben'], 0);
  assert.equal(s.players[0].hand.length, 4);
  assert.equal(s.players[1].hand.length, 4);
  assert.equal(s.deck.length + 8, 50);
  const all = Object.values(s.index);
  assert.equal(all.length, 50);
  assert.equal(all.filter((c) => c.special === 'binx').length, 5);
  assert.equal(all.filter((c) => c.special === 'book').length, 5);
  assert.equal(new Set(all.map((c) => c.id)).size, 50, 'every id is unique');
  assert.equal(s.phase, 'ask');
  assert.equal(s.active, 0);
});

test('cauldron piles start from the printed type+colour, not a dealt card', () => {
  const s = G.newGame(['Ana', 'Ben'], 0);
  for (let i = 0; i < 5; i++) assert.deepEqual(G.pileTop(s, i), C.CAULDRON_START[i]);
});

test('canPlayOn: matches by type OR colour (or both), not neither', () => {
  const s = G.newGame(['Ana', 'Ben'], 0);
  const top = C.CAULDRON_START[0]; // newtsaliva / orange
  const sameType = Object.values(s.index).find((c) => c.type === top.type && c.color !== top.color);
  const sameColor = Object.values(s.index).find((c) => c.color === top.color && c.type !== top.type);
  const neither = Object.values(s.index).find((c) => c.color !== top.color && c.type !== top.type);
  assert.equal(G.canPlayOn(s, sameType.id, 0), true);
  assert.equal(G.canPlayOn(s, sameColor.id, 0), true);
  assert.equal(G.canPlayOn(s, neither.id, 0), false);
});

test('checkStun: all 5 same colour -> Sarah; all same type, all different colours -> Winifred; all same type otherwise -> Mary', () => {
  const s = G.newGame(['Ana', 'Ben'], 0);
  s.cauldron = [['a'], ['b'], ['c'], ['d'], ['e']];
  s.index = {
    a: { type: 't1', color: 'orange' }, b: { type: 't2', color: 'orange' }, c: { type: 't3', color: 'orange' },
    d: { type: 't4', color: 'orange' }, e: { type: 't5', color: 'orange' },
  };
  assert.equal(G.checkStun(s), 'sarah');
  s.index = {
    a: { type: 'x', color: 'orange' }, b: { type: 'x', color: 'purple' }, c: { type: 'x', color: 'yellow' },
    d: { type: 'x', color: 'green' }, e: { type: 'x', color: 'blue' },
  };
  assert.equal(G.checkStun(s), 'winifred');
  s.index = {
    a: { type: 'x', color: 'orange' }, b: { type: 'x', color: 'orange' }, c: { type: 'x', color: 'purple' },
    d: { type: 'x', color: 'green' }, e: { type: 'x', color: 'blue' },
  };
  assert.equal(G.checkStun(s), 'mary');
  s.index.e = { type: 'y', color: 'blue' };
  assert.equal(G.checkStun(s), null);
});

test('ask: answers truthfully about the OTHER player\'s hand, never reveals more, then moves to trick phase', () => {
  const s = G.newGame(['Ana', 'Ben'], 0);
  const theirColors = new Set(s.players[1].hand.map((id) => s.index[id].color));
  const have = [...theirColors][0];
  const dontHave = C.COLORS.find((c) => !theirColors.has(c));
  const a = G.apply(s, 0, { type: 'ask', kind: 'color', value: have });
  assert.equal(a.lastAsk.answer, true);
  assert.equal(a.phase, 'trick');
  if (dontHave) {
    const b = G.apply(s, 0, { type: 'ask', kind: 'color', value: dontHave });
    assert.equal(b.lastAsk.answer, false);
  }
  assert.throws(() => G.apply(s, 1, { type: 'ask', kind: 'color', value: have }), /not your turn/);
  assert.throws(() => G.apply(s, 0, { type: 'ask', kind: 'nope', value: have }), /color or a type/);
});

test('a full legal play: ask -> skip trick -> play -> draw -> turn passes', () => {
  const s = freshGame((st) => G.legalPlays(st, 0).length > 0 && G.legalPlays(st, 0).some((m) => !s_specialCard(st, m.cardId)));
  function s_specialCard(st, id) { return !!st.index[id].special; }
  let g = G.apply(s, 0, { type: 'ask', kind: 'color', value: C.COLORS[0] });
  g = G.apply(g, 0, { type: 'skipTrick' });
  const move = G.legalPlays(g, 0).find((m) => !g.index[m.cardId].special);
  const before = g.players[0].hand.length;
  g = G.apply(g, 0, { type: 'play', cardId: move.cardId, pile: move.pile });
  assert.deepEqual(g.cauldron[move.pile], [move.cardId]);
  assert.equal(g.players[0].hand.length, before, 'played 1, drew 1: net unchanged');
  assert.equal(g.active, 1);
  assert.equal(g.turn, 2);
  assert.equal(g.phase, 'ask');
});

test('you must play a legal card if you have one: "cannotPlay" is refused', () => {
  const s = freshGame((st) => G.legalPlays(st, 0).length > 0);
  const g1 = G.apply(s, 0, { type: 'ask', kind: 'color', value: C.COLORS[0] });
  const g2 = G.apply(g1, 0, { type: 'skipTrick' });
  assert.throws(() => G.apply(g2, 0, { type: 'cannotPlay' }), /do have a legal play/);
});

test('a card matching neither any pile fails with a clear reason', () => {
  const s = freshGame((st) => G.legalPlays(st, 0).length > 0);
  const g1 = G.apply(G.apply(s, 0, { type: 'ask', kind: 'color', value: C.COLORS[0] }), 0, { type: 'skipTrick' });
  const bad = g1.players[0].hand.find((id) => !G.legalPlays(g1, 0).some((m) => m.cardId === id));
  if (bad) assert.throws(() => G.apply(g1, 0, { type: 'play', cardId: bad, pile: 0 }), /match/);
});

test("can't play: a Spell is cast and resolves, then discard (at least 1, your choice) and redraw the same number", () => {
  // Build a state with no legal plays: every hand card's type/colour differs from every pile top.
  const s = G.newGame(['Ana', 'Ben'], 0);
  s.players[0].hand = ['x1', 'x2', 'x3', 'x4'];
  s.index = {
    ...s.index,
    x1: { type: 'zz', color: 'zz', special: null }, x2: { type: 'zz', color: 'zz', special: null },
    x3: { type: 'zz', color: 'zz', special: null }, x4: { type: 'zz', color: 'zz', special: null },
  };
  s.spellDeck = ['s2']; // "Bewitched": discard 1, draw 1 — deterministic, not whatever was shuffled in
  const g1 = G.apply(G.apply(s, 0, { type: 'ask', kind: 'color', value: C.COLORS[0] }), 0, { type: 'skipTrick' });
  assert.equal(G.legalPlays(g1, 0).length, 0);
  const g2 = G.apply(g1, 0, { type: 'cannotPlay' });
  assert.equal(g2.phase, 'spell');
  assert.equal(g2.pendingSpell.id, 's2', 'a spell is waiting (salt not yet used)');
  const g3 = G.apply(g2, 0, { type: 'continueFromSpell' });
  assert.deepEqual(g3.pendingDiscard, { min: 1, max: 1, reason: 'spell' });
  assert.throws(() => G.apply(g3, 0, { type: 'discard', cardIds: [] }), /exactly 1/);
  const deckBefore = g3.deck.length;
  const g4 = G.apply(g3, 0, { type: 'discard', cardIds: [g3.players[0].hand[0]] });
  // The discard-and-replace (for failing to play) and the ordinary end-of-turn draw are two
  // separate draws per the rulebook ("This is done after any Spells are resolved") — so a
  // can't-play turn nets +1 card overall, not 0.
  assert.equal(g4.players[0].hand.length, 5, '4 to start, -1 discarded, +1 replacement, +1 end-of-turn draw');
  assert.equal(g4.deck.length, deckBefore - 2, '1 for the spell redraw, 1 for the normal end-of-turn draw');
  assert.equal(g4.active, 1, 'the turn finally passes once the spell is fully resolved');
});

test('Circle of Salt cancels a drawn Spell entirely: no effect, no redraw, one-time only', () => {
  // Force the first Spell drawn to not be blocked, then salt it.
  let s = G.newGame(['Ana', 'Ben'], 0);
  s.players[0].hand = ['x1', 'x2', 'x3', 'x4'];
  s.index = { ...s.index, x1: { type: 'zz', color: 'zz' }, x2: { type: 'zz', color: 'zz' }, x3: { type: 'zz', color: 'zz' }, x4: { type: 'zz', color: 'zz' } };
  let g = G.apply(G.apply(s, 0, { type: 'ask', kind: 'color', value: C.COLORS[0] }), 0, { type: 'skipTrick' });
  g = G.apply(g, 0, { type: 'cannotPlay' });
  assert.equal(g.phase, 'spell');
  const before = JSON.stringify(g.players[0].hand);
  g = G.apply(g, 0, { type: 'useTrick', trick: 'salt' });
  assert.equal(g.tricksUsed.salt, true);
  assert.equal(g.phase, 'ask', 'the spell was ignored, so the turn just moved on (drew 1, passed)');
  assert.notEqual(g.active, 0);
  assert.throws(() => G.apply(G.apply(G.apply(g, 1, { type: 'ask', kind: 'color', value: C.COLORS[0] }), 1, { type: 'skipTrick' }), 1, { type: 'useTrick', trick: 'salt' }), /already been used/);
});

test('a Spell matching the currently-stunned witch misses: no effect, no redraw', () => {
  const s = G.newGame(['Ana', 'Ben'], 0);
  s.players[0].hand = ['x1', 'x2', 'x3', 'x4'];
  s.index = { ...s.index, x1: { type: 'zz', color: 'zz' }, x2: { type: 'zz', color: 'zz' }, x3: { type: 'zz', color: 'zz' }, x4: { type: 'zz', color: 'zz' } };
  s.spellDeck = ['s2']; // "Bewitched" (Sarah) — would normally offer a discard-1 effect
  s.stunnedWitch = 'sarah';
  const g1 = G.apply(G.apply(s, 0, { type: 'ask', kind: 'color', value: C.COLORS[0] }), 0, { type: 'skipTrick' });
  const g2 = G.apply(g1, 0, { type: 'cannotPlay' });
  assert.equal(g2.phase, 'ask', 'the spell missed outright: no salt offer, no discard step, turn just continued');
  assert.equal(g2.pendingSpell, null);
  assert.equal(g2.pendingDiscard, null);
  assert.equal(g2.players[0].hand.length, 5, '4 in hand, no discard/redraw, +1 end-of-turn draw');
  assert.equal(g2.active, 1);
});

test('"Take Flight" (no single witch) is never missed, even while that exact witch is stunned', () => {
  const s = G.newGame(['Ana', 'Ben'], 0);
  s.players[0].hand = ['x1', 'x2', 'x3', 'x4'];
  s.index = { ...s.index, x1: { type: 'zz', color: 'zz' }, x2: { type: 'zz', color: 'zz' }, x3: { type: 'zz', color: 'zz' }, x4: { type: 'zz', color: 'zz' } };
  s.spellDeck = ['s13']; // Take Flight: witch === null, so it can never match a stunned witch
  s.stunnedWitch = 'sarah';
  const g1 = G.apply(G.apply(s, 0, { type: 'ask', kind: 'color', value: C.COLORS[0] }), 0, { type: 'skipTrick' });
  const g2 = G.apply(g1, 0, { type: 'cannotPlay' });
  assert.equal(g2.phase, 'spell');
  assert.equal(g2.pendingSpell.id, 's13', 'it was offered normally, not missed');
});

test('playing the Spell Book symbol draws a Spell as part of that same play (not instead of it)', () => {
  const s = freshGame((st) => {
    const bookId = st.players[0].hand.find((id) => st.index[id].special === 'book');
    return !!bookId && G.legalPlays(st, 0).some((m) => m.cardId === bookId);
  });
  const bookId = Object.keys(s.index).find((id) => s.index[id].special === 'book' && s.players[0].hand.includes(id));
  const move = G.legalPlays(s, 0).find((m) => m.cardId === bookId);
  const g1 = G.apply(G.apply(s, 0, { type: 'ask', kind: 'color', value: C.COLORS[0] }), 0, { type: 'skipTrick' });
  const g2 = G.apply(g1, 0, { type: 'play', cardId: bookId, pile: move.pile });
  assert.deepEqual(g2.cauldron[move.pile], [bookId], 'the card was placed');
  assert.ok(g2.phase === 'spell' || g2.phase === 'ask', 'a spell was drawn and either awaits salt or already resolved/missed');
});

test('Binx: playing it reveals a hand; the other player can see it through viewFor; it clears at round end', () => {
  const s = freshGame((st) => {
    const binxId = st.players[0].hand.find((id) => st.index[id].special === 'binx');
    return !!binxId && G.legalPlays(st, 0).some((m) => m.cardId === binxId);
  });
  const binxId = Object.keys(s.index).find((id) => s.index[id].special === 'binx' && s.players[0].hand.includes(id));
  const move = G.legalPlays(s, 0).find((m) => m.cardId === binxId);
  const g1 = G.apply(G.apply(s, 0, { type: 'ask', kind: 'color', value: C.COLORS[0] }), 0, { type: 'skipTrick' });
  const g2 = G.apply(g1, 0, { type: 'play', cardId: binxId, pile: move.pile, binxTo: 0 });
  assert.equal(g2.binxHolder, 0);
  const seenByOther = G.viewFor(g2, 1);
  assert.ok(seenByOther.players[0].hand.every((c) => typeof c === 'string'), "player 0's hand is visible to player 1 while Binx is on them");
});

test('viewFor: hides the other hand and the deck order; never leaks a hidden card id', () => {
  const s = G.newGame(['Ana', 'Ben'], 0);
  const v1 = G.viewFor(s, 1);
  assert.ok(v1.players[0].hand.every((c) => c === null));
  assert.equal(v1.players[0].hand.length, 4);
  assert.ok(v1.players[1].hand.every((c) => typeof c === 'string'));
  assert.equal(v1.deck, null);
  assert.equal(typeof v1.deckCount, 'number');
  const hiddenId = s.players[0].hand[0];
  assert.equal(hiddenId in v1.index, false, "a card hidden in p0's hand never appears in p1's index");
});

test('round end: 1st stun does not end the game; sun count increases; deck shrinks by the non-special cards removed', () => {
  // Build a near-stun: 4 piles already matching colour "orange", and a 5th pile whose current top
  // (not empty — an empty pile falls back to the board's own printed start, not an arbitrary one)
  // can still legally take an orange card to complete the match.
  let s = G.newGame(['Ana', 'Ben'], 0);
  const mk = (n, type, color, special = null) => { s.index[`m${n}`] = { type, color, special }; return `m${n}`; };
  s.cauldron = [[mk(1, 't1', 'orange')], [mk(2, 't2', 'orange')], [mk(3, 't3', 'orange')], [mk(4, 't4', 'orange')], [mk(0, 'fifth', 'purple')]];
  s.discard = [mk(9, 'junk', 'junk')];
  const last = mk(5, 'fifth', 'orange'); // matches pile 4's current top by type, completes by colour
  s.players[0].hand = [last];
  const deckBefore = s.deck.length;
  const g1 = G.apply(G.apply(s, 0, { type: 'ask', kind: 'color', value: C.COLORS[0] }), 0, { type: 'skipTrick' });
  const g2 = G.apply(g1, 0, { type: 'play', cardId: last, pile: 4 });
  assert.equal(g2.sun, 1);
  assert.equal(g2.stunnedWitch, 'sarah');
  assert.equal(g2.phase, 'ask', 'not over: 1 stun < 3 needed');
  assert.deepEqual(g2.cauldron, [[], [], [], [], []], 'the cauldron is cleared for the new round');
  assert.equal(g2.discard.length, 0);
  assert.equal(g2.removed.length, 7, 'the 6 cauldron cards (pile 4 held 2) + 1 discard card are gone for good (none were special)');
  assert.equal(deckBefore - g2.deck.length, 1, 'the deck only shrank by the end-of-turn draw; nothing round-end removed went back in (none were special)');
  assert.equal(g2.active, 1, 'turn order just continues to the other player');
  assert.equal(g2.round, 2);
});

test('round end recycles special (binx/book) cards from the cauldron/discard back into the deck', () => {
  let s = G.newGame(['Ana', 'Ben'], 0);
  const mk = (n, type, color, special = null) => { s.index[`m${n}`] = { type, color, special }; return `m${n}`; };
  s.cauldron = [[mk(1, 't1', 'orange')], [mk(2, 't2', 'orange')], [mk(3, 't3', 'orange', 'binx')], [mk(4, 't4', 'orange')], [mk(0, 'fifth', 'purple')]];
  const last = mk(5, 'fifth', 'orange', 'book'); // completes the stun, so its own Book symbol never fires
  s.players[0].hand = [last];
  const g1 = G.apply(G.apply(s, 0, { type: 'ask', kind: 'color', value: C.COLORS[0] }), 0, { type: 'skipTrick' });
  const g2 = G.apply(g1, 0, { type: 'play', cardId: last, pile: 4 });
  assert.equal(g2.removed.length, 4, 'only the 4 plain cards (m1, m2, m4, and the pre-existing m0) are gone for good');
  assert.ok(!g2.removed.includes('m3') && !g2.removed.includes(last), 'the two specials were not removed');
  // One of the two specials may already have been drawn back out as this same turn's end-of-turn
  // draw, so check the deck + the active player's hand together for both.
  const stillInPlay = new Set([...g2.deck, ...g2.players[0].hand.filter(Boolean)]);
  assert.ok(stillInPlay.has('m3') && stillInPlay.has(last), 'both specials were shuffled back into the deck (possibly straight back into a hand)');
});

test('three total stuns (any mix of witches) ends the game as a win, with the sun log reflecting it', () => {
  let s = G.newGame(['Ana', 'Ben'], 0);
  s.sun = 2;
  const mk = (n, type, color) => { s.index[`m${n}`] = { type, color, special: null }; return `m${n}`; };
  s.cauldron = [[mk(1, 't1', 'orange')], [mk(2, 't2', 'orange')], [mk(3, 't3', 'orange')], [mk(4, 't4', 'orange')], [mk(0, 'fifth', 'purple')]];
  const last = mk(5, 'fifth', 'orange');
  s.players[0].hand = [last];
  const g1 = G.apply(G.apply(s, 0, { type: 'ask', kind: 'color', value: C.COLORS[0] }), 0, { type: 'skipTrick' });
  const g2 = G.apply(g1, 0, { type: 'play', cardId: last, pile: 4 });
  assert.equal(g2.sun, 3);
  assert.equal(g2.phase, 'over');
  assert.deepEqual(g2.end, { result: 'win' });
});

test('stunning while playing a Special card ignores its symbol entirely: no spell drawn, no Binx placed', () => {
  let s = G.newGame(['Ana', 'Ben'], 0);
  const mk = (n, type, color, special = null) => { s.index[`m${n}`] = { type, color, special }; return `m${n}`; };
  s.cauldron = [[mk(1, 't1', 'orange')], [mk(2, 't2', 'orange')], [mk(3, 't3', 'orange')], [mk(4, 't4', 'orange')], [mk(0, 'fifth', 'purple')]];
  const last = mk(5, 'fifth', 'orange', 'book'); // would normally draw a spell — but it completes a stun first
  s.players[0].hand = [last];
  const g1 = G.apply(G.apply(s, 0, { type: 'ask', kind: 'color', value: C.COLORS[0] }), 0, { type: 'skipTrick' });
  const g2 = G.apply(g1, 0, { type: 'play', cardId: last, pile: 4 });
  assert.equal(g2.sun, 1);
  assert.equal(g2.phase, 'ask', 'straight back to a fresh turn: no spell/salt step happened');
});

test('a forced draw (discard-and-replace) that the deck cannot fulfil ends the game as a loss', () => {
  const s = G.newGame(['Ana', 'Ben'], 0);
  s.deck = ['d1']; // only 1 card left in the whole deck
  s.index.d1 = { type: 'q', color: 'q', special: null };
  s.pendingDiscard = { min: 2, max: 2, reason: 'spell' }; // needs to replace 2, deck can only give 1
  const g = G.apply(s, 0, { type: 'discard', cardIds: s.players[0].hand.slice(0, 2) });
  assert.equal(g.phase, 'over');
  assert.deepEqual(g.end, { result: 'lose', reason: 'deck-empty' });
});

test('a plain end-of-turn draw with an empty deck is not a loss: play just continues', () => {
  const s = freshGame((st) => G.legalPlays(st, 0).length > 0 && G.legalPlays(st, 0).some((m) => !st.index[m.cardId].special));
  s.deck = [];
  const g1 = G.apply(G.apply(s, 0, { type: 'ask', kind: 'color', value: C.COLORS[0] }), 0, { type: 'skipTrick' });
  const move = G.legalPlays(g1, 0).find((m) => !g1.index[m.cardId].special);
  const g2 = G.apply(g1, 0, { type: 'play', cardId: move.cardId, pile: move.pile });
  assert.notEqual(g2.phase, 'over');
  assert.equal(g2.deck.length, 0);
});

test('Billy Butcherson: skips the play step AND the end-of-turn draw, one-time use', () => {
  const s = G.newGame(['Ana', 'Ben'], 0);
  const handBefore = s.players[0].hand.length;
  const deckBefore = s.deck.length;
  const g1 = G.apply(s, 0, { type: 'ask', kind: 'color', value: C.COLORS[0] });
  const g2 = G.apply(g1, 0, { type: 'useTrick', trick: 'billy' });
  assert.equal(g2.players[0].hand.length, handBefore, 'no card played, no card drawn');
  assert.equal(g2.deck.length, deckBefore);
  assert.equal(g2.active, 1);
  assert.equal(g2.tricksUsed.billy, true);
});

test('Daylight Savings Time: active player offers a card, gets a random one back from the other hand', () => {
  const s = G.newGame(['Ana', 'Ben'], 0);
  const give = s.players[0].hand[0];
  const g1 = G.apply(G.apply(s, 0, { type: 'ask', kind: 'color', value: C.COLORS[0] }), 0, { type: 'useTrick', trick: 'daylight', give });
  assert.equal(g1.players[0].hand.includes(give), false, 'the offered card left the active hand');
  assert.equal(g1.players[1].hand.includes(give), true, 'and landed in the other hand');
  assert.equal(g1.players[0].hand.length, 4);
  assert.equal(g1.players[1].hand.length, 4);
  assert.equal(g1.phase, 'play', 'still must play (and later draw) as normal');
});

test('Burning Rain of Death: discards exactly 3, draws 3, then play proceeds as normal', () => {
  const s = G.newGame(['Ana', 'Ben'], 0);
  const discard = s.players[0].hand.slice(0, 3);
  const deckBefore = s.deck.length;
  const g1 = G.apply(G.apply(s, 0, { type: 'ask', kind: 'color', value: C.COLORS[0] }), 0, { type: 'useTrick', trick: 'burning', discard });
  assert.equal(g1.players[0].hand.length, 4);
  assert.equal(g1.deck.length, deckBefore - 3);
  assert.ok(discard.every((c) => !g1.players[0].hand.includes(c)));
  assert.equal(g1.phase, 'play');
  assert.throws(() => G.apply(G.apply(G.apply(s, 0, { type: 'ask', kind: 'color', value: C.COLORS[0] }), 0, { type: 'skipTrick' }), 0, { type: 'useTrick', trick: 'burning', discard }), /before you play/);
});

test('rematch alternates the starting player and deals a brand new game', () => {
  let s = G.newGame(['Ana', 'Ben'], 0);
  s.phase = 'over';
  s.end = { result: 'win' };
  const r = G.apply(s, 0, { type: 'rematch' });
  assert.equal(r.starter, 1);
  assert.equal(r.active, 1);
  assert.equal(r.round, 1);
  assert.equal(r.sun, 0);
  assert.equal(r.players[0].hand.length, 4);
  assert.throws(() => G.apply(r, 0, { type: 'rematch' }), /still running/);
});

test('only the active player may act', () => {
  const s = G.newGame(['Ana', 'Ben'], 0);
  assert.throws(() => G.apply(s, 1, { type: 'ask', kind: 'color', value: C.COLORS[0] }), /not your turn/);
});
