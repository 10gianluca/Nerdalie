/* Agent Avenue rules engine: pure state + actions, no DOM. Works in the browser (window.AgentAvenue) and Node.

   The two meeples chase each other around a circular track. Positions are kept as plain running totals
   (player 0 starts at 0, player 1 at startGap), and gap = pos[1] - pos[0]:
     gap <= 0        player 0 has reached or passed player 1 and catches them
     gap >= board    player 1 has gone all the way round and catches player 0 */
(function (root) {
  'use strict';

  const Cards = typeof module !== 'undefined' && module.exports ? require('./cards.js') : root.AgentCards;
  const { TYPES, RULES } = Cards;

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const typeOf = (id) => id.split('-')[0];

  function moveFor(key, count) {
    const icons = TYPES[key].icons;
    const icon = icons[Math.min(count, icons.length) - 1];
    return typeof icon === 'number' ? icon : 0;
  }

  function buildDeck() {
    const ids = [];
    for (const key of Object.keys(TYPES)) for (let n = 1; n <= TYPES[key].count; n++) ids.push(`${key}-${n}`);
    return ids;
  }

  function shuffle(a, rng) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function drawTo(s, i) {
    const p = s.players[i];
    while (p.hand.length < RULES.hand && s.deck.length) p.hand.push(s.deck.pop());
  }

  const countOf = (s, i, key) => s.players[i].play.filter((id) => typeOf(id) === key).length;
  const gapOf = (s) => s.pos[1] - s.pos[0];
  const distanceToCatch = (s, i) => (i === 0 ? gapOf(s) : RULES.board - gapOf(s));

  // Two different cards, unless every card in hand has the same name.
  function legalPair(hand, a, b) {
    if (a === b || !hand.includes(a) || !hand.includes(b)) return false;
    const allSame = hand.every((id) => typeOf(id) === typeOf(hand[0]));
    return typeOf(a) !== typeOf(b) || allSame;
  }

  function newGame(names, starter = 0, rng = Math.random) {
    const s = {
      players: names.map((name) => ({ name, hand: [], play: [], swaps: 0 })),
      deck: shuffle(buildDeck(), rng),
      discard: [],
      pos: [0, RULES.startGap],
      starter,
      active: starter,
      turn: 1,
      phase: 'offer', // offer (active player splits two cards) -> choose (other player picks) -> next turn
      offer: null, // { up, down } card ids
      last: null, // summary of the previous turn
      end: null, // { winner, reason: 'catch' | 'win-set' | 'lose-set' | 'deck', key? }
    };
    s.players.forEach((_, i) => drawTo(s, i));
    return s;
  }

  // Who has won after a turn, if anyone. If both players qualify the active player wins.
  function outcome(s) {
    const found = [];
    const gap = gapOf(s);
    if (gap <= 0) found.push({ winner: 0, reason: 'catch' });
    if (gap >= RULES.board) found.push({ winner: 1, reason: 'catch' });
    for (const i of [0, 1]) {
      for (const key of Object.keys(TYPES)) {
        const last = TYPES[key].icons[TYPES[key].icons.length - 1];
        if (typeof last !== 'string' || countOf(s, i, key) < RULES.setSize) continue;
        if (last === 'win') found.push({ winner: i, reason: 'win-set', key });
        else found.push({ winner: 1 - i, reason: 'lose-set', key });
      }
    }
    if (!found.length) return null;
    return found.find((f) => f.winner === s.active) || found[0];
  }

  // The deck has run out and the next player can no longer split two cards: the player closer to catching wins.
  function checkDeckOut(s) {
    if (s.players[s.active].hand.length >= 2) return;
    const d0 = distanceToCatch(s, 0);
    const d1 = distanceToCatch(s, 1);
    s.phase = 'over';
    s.end = { winner: d0 < d1 ? 0 : d1 < d0 ? 1 : s.active, reason: 'deck' };
  }

  function resolve(s, chooser, pick) {
    const active = s.active;
    const got = [];
    got[chooser] = s.offer[pick];
    got[active] = s.offer[pick === 'up' ? 'down' : 'up'];

    const info = [0, 1].map((i) => {
      const key = typeOf(got[i]);
      s.players[i].play.push(got[i]);
      return { card: got[i], type: key, count: countOf(s, i, key) };
    });
    const delta = info.map((x) => (x.move = moveFor(x.type, x.count)));
    s.pos = [s.pos[0] + delta[0], s.pos[1] + delta[1]];

    s.last = { turn: s.turn, active, up: s.offer.up, down: s.offer.down, pick, chooser, info, delta, pos: s.pos.slice() };
    s.offer = null;

    const result = outcome(s);
    if (result) {
      s.phase = 'over';
      s.end = result;
      return;
    }
    s.active = 1 - active;
    s.turn++;
    s.phase = 'offer';
    checkDeckOut(s);
  }

  // Returns a new state; throws Error(message) for illegal actions.
  function apply(state, player, action, rng = Math.random) {
    const s = clone(state);
    const fail = (msg) => {
      throw new Error(msg);
    };
    if (!s.players[player]) fail('Unknown player');
    const isActive = player === s.active;
    const me = s.players[player];

    switch (action.type) {
      case 'swap': {
        if (s.phase !== 'offer' || !isActive) fail("It's not your turn to play cards");
        if (me.swaps >= RULES.swaps) fail('You have no swaps left');
        if (!me.hand.includes(action.card)) fail('That card is not in your hand');
        if (!s.deck.length) fail('The deck is empty');
        me.hand.splice(me.hand.indexOf(action.card), 1);
        s.discard.push(action.card);
        me.hand.push(s.deck.pop());
        me.swaps++;
        break;
      }
      case 'offer': {
        if (s.phase !== 'offer' || !isActive) fail("It's not your turn to play cards");
        if (!legalPair(me.hand, action.up, action.down)) fail('Play two cards with different names');
        me.hand = me.hand.filter((id) => id !== action.up && id !== action.down);
        s.offer = { up: action.up, down: action.down };
        drawTo(s, player);
        s.phase = 'choose';
        break;
      }
      case 'choose': {
        if (s.phase !== 'choose' || isActive) fail("It's not your turn to choose");
        if (action.pick !== 'up' && action.pick !== 'down') fail('Choose the face-up or face-down card');
        resolve(s, player, action.pick);
        break;
      }
      case 'rematch': {
        if (s.phase !== 'over') fail('The game is still running');
        return newGame(s.players.map((p) => p.name), 1 - s.starter, rng);
      }
      default:
        fail('Unknown action');
    }
    return s;
  }

  // What a given player may see: the other hand, the deck and (while choosing) the face-down card are hidden.
  function viewFor(state, player) {
    const v = clone(state);
    v.deckCount = v.deck.length;
    v.deck = null;
    v.discardCount = v.discard.length;
    v.discard = null;
    v.players.forEach((p, i) => {
      if (i !== player) p.hand = p.hand.map(() => null);
    });
    if (v.phase === 'choose' && player !== v.active) v.offer = { up: v.offer.up, down: null };
    return v;
  }

  const api = {
    TYPES, RULES, typeOf, moveFor, legalPair, newGame, apply, viewFor, countOf, gapOf, distanceToCatch,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AgentAvenue = api;
})(typeof window !== 'undefined' ? window : globalThis);
