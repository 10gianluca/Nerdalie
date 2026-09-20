/* Lost Cities rules engine: pure state + actions, no DOM. Works in the browser (window.LostCities) and Node.

   Card ids are '<colour>-w<n>' for a wager (handshake) and '<colour>-<value>' for a number, e.g. 'red-w2', 'blue-7'.
   Each player builds one expedition per colour in front of them, cards laid in the order they were played. */
(function (root) {
  'use strict';

  const Cards = typeof module !== 'undefined' && module.exports ? require('./cards.js') : root.LostCards;
  const { RULES, COLORS } = Cards;
  const COLOR_IDS = COLORS.map((c) => c.id);

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const perColor = (make) => Object.fromEntries(COLOR_IDS.map((c) => [c, make()]));

  function parse(id) {
    const [color, v] = id.split('-');
    const wager = v[0] === 'w';
    return { color, wager, value: wager ? 0 : Number(v) };
  }

  function buildDeck() {
    const ids = [];
    for (const color of COLOR_IDS) {
      for (let n = 1; n <= RULES.wagers; n++) ids.push(`${color}-w${n}`);
      for (const v of RULES.values) ids.push(`${color}-${v}`);
    }
    return ids;
  }

  function shuffle(a, rng) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Can this card go onto this expedition? Numbers must rise, and wagers must come before any number.
  function canPlay(expedition, id) {
    const card = parse(id);
    const numbers = expedition.map(parse).filter((c) => !c.wager);
    if (card.wager) {
      return numbers.length ? { ok: false, reason: 'Wagers have to be played before any number in that expedition' } : { ok: true };
    }
    const top = numbers.length ? numbers[numbers.length - 1].value : 0;
    return card.value > top ? { ok: true } : { ok: false, reason: `It needs to be higher than the ${top} already there` };
  }

  // (sum of numbers - 20) x (1 + wagers), plus a bonus for long expeditions. An expedition never started scores 0.
  function expeditionScore(ids) {
    if (!ids.length) return 0;
    const cards = ids.map(parse);
    const sum = cards.reduce((t, c) => t + c.value, 0);
    const wagers = cards.filter((c) => c.wager).length;
    return (sum - RULES.cost) * (1 + wagers) + (ids.length >= RULES.bonusCards ? RULES.bonus : 0);
  }

  function score(s, seat) {
    const byColor = {};
    let total = 0;
    for (const color of COLOR_IDS) {
      byColor[color] = expeditionScore(s.players[seat].exp[color]);
      total += byColor[color];
    }
    return { byColor, total };
  }

  function newGame(names, starter = 0, rng = Math.random, match = { round: 1, totals: [0, 0] }) {
    const s = {
      players: names.map((name) => ({ name, hand: [], exp: perColor(() => []) })),
      deck: shuffle(buildDeck(), rng),
      discards: perColor(() => []), // top card is the last one
      starter,
      active: starter,
      turn: 1,
      phase: 'play', // play (play or discard a card) -> draw -> next player's turn ... -> over
      pending: null, // { kind: 'play' | 'discard', card } between the two halves of a turn
      justDiscarded: null, // colour discarded this turn: you may not take that card straight back
      last: null, // summary of the previous turn
      end: null, // { scores, winner } once the deck runs out
      round: match.round,
      totals: match.totals.slice(), // match totals, updated when a round ends
    };
    s.players.forEach((p) => {
      while (p.hand.length < RULES.hand) p.hand.push(s.deck.pop());
    });
    return s;
  }

  function finish(s) {
    const scores = [0, 1].map((i) => score(s, i).total);
    s.totals = s.totals.map((t, i) => t + scores[i]);
    s.phase = 'over';
    s.end = { scores, winner: scores[0] === scores[1] ? null : scores[0] > scores[1] ? 0 : 1 };
  }

  // Which draws are allowed right now: the draw pile, and any discard pile except the one just discarded to.
  function legalDraws(s) {
    const draws = [];
    const deckLeft = s.deck ? s.deck.length : s.deckCount; // a player's view hides the deck but keeps its size
    if (deckLeft) draws.push('deck');
    for (const color of COLOR_IDS) if (s.discards[color].length && color !== s.justDiscarded) draws.push(color);
    return draws;
  }

  // Returns a new state; throws Error(message) for illegal actions.
  function apply(state, player, action, rng = Math.random) {
    const s = clone(state);
    const fail = (msg) => {
      throw new Error(msg);
    };
    if (!s.players[player]) fail('Unknown player');
    const me = s.players[player];
    const isActive = player === s.active;

    switch (action.type) {
      case 'play':
      case 'discard': {
        if (s.phase !== 'play' || !isActive) fail("It's not your turn to play a card");
        if (!me.hand.includes(action.card)) fail('That card is not in your hand');
        const { color } = parse(action.card);
        if (action.type === 'play') {
          const check = canPlay(me.exp[color], action.card);
          if (!check.ok) fail(check.reason);
          me.exp[color].push(action.card);
          s.justDiscarded = null;
        } else {
          s.discards[color].push(action.card);
          s.justDiscarded = color;
        }
        me.hand.splice(me.hand.indexOf(action.card), 1);
        s.pending = { kind: action.type, card: action.card };
        s.phase = 'draw';
        break;
      }
      case 'draw': {
        if (s.phase !== 'draw' || !isActive) fail("It's not your turn to draw");
        if (!legalDraws(s).includes(action.from)) {
          fail(action.from === s.justDiscarded ? "You can't take back the card you just discarded" : 'You cannot draw from there');
        }
        const card = action.from === 'deck' ? s.deck.pop() : s.discards[action.from].pop();
        me.hand.push(card);
        s.last = { turn: s.turn, who: player, kind: s.pending.kind, card: s.pending.card, drew: { from: action.from, card } };
        s.pending = null;
        if (s.deck.length === 0) {
          finish(s); // the round ends the moment the last card is drawn
        } else {
          s.active = 1 - s.active;
          s.turn++;
          s.phase = 'play';
          s.justDiscarded = null;
        }
        break;
      }
      case 'rematch': {
        if (s.phase !== 'over') fail('The round is still running');
        const names = s.players.map((p) => p.name);
        const match = s.round >= RULES.rounds ? { round: 1, totals: [0, 0] } : { round: s.round + 1, totals: s.totals };
        return newGame(names, 1 - s.starter, rng, match);
      }
      default:
        fail('Unknown action');
    }
    return s;
  }

  // What a given player may see: the other hand and the draw pile order are hidden, and so is a card the
  // other player drew from the draw pile.
  function viewFor(state, player) {
    const v = clone(state);
    v.deckCount = v.deck.length;
    v.deck = null;
    v.players.forEach((p, i) => {
      if (i !== player) p.hand = p.hand.map(() => null);
    });
    if (v.last && v.last.drew.from === 'deck' && v.last.who !== player) v.last.drew.card = null;
    return v;
  }

  const api = {
    RULES, COLORS, COLOR_IDS, parse, canPlay, expeditionScore, score, newGame, apply, viewFor, legalDraws,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LostCities = api;
})(typeof window !== 'undefined' ? window : globalThis);
