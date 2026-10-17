/* Computer partner for Hocus Pocus. Hocus Pocus is cooperative, so this is a teammate rather than a rival: it
   plays toward the next stun, keeps flexible cards when it has to discard, and spends its
   one-time Tricks only when they clearly help. It reads only what its own player may see (game.viewFor). */
(function (root) {
  'use strict';

  const G = typeof module !== 'undefined' && module.exports ? require('./game.js') : root.HocusPocus;
  const C = typeof module !== 'undefined' && module.exports ? require('./cards.js') : root.HocusCards;

  const deckLeft = (view) => (view.deckCount != null ? view.deckCount : view.deck.length);

  // How many of the five piles this card could be played on (a flexible card is a safer one to keep).
  const pileCount = (view, id) => [0, 1, 2, 3, 4].filter((p) => G.canPlayOn(view, id, p)).length;

  // How near a play leaves the table to a stun: for each colour and each ingredient, the piles already showing
  // it, plus the piles the rest of the hand could still convert (each card used once). Stunning scores highest.
  function closeness(view, seat, cardId, pile) {
    const cauldron = view.cauldron.map((p, i) => (i === pile ? [...p, cardId] : p));
    const sim = { cauldron, index: view.index };
    if (G.checkStun(sim)) return 100;
    const tops = cauldron.map((_, i) => G.pileTop(sim, i));
    const rest = view.players[seat].hand.filter((id) => id !== cardId);
    let best = 0;
    for (const key of ['color', 'type']) {
      for (const value of key === 'color' ? C.COLORS : C.TYPES) {
        const matched = tops.filter((t) => t[key] === value).length;
        const used = new Set();
        let reach = 0;
        tops.forEach((top, i) => {
          if (top[key] === value) return;
          const id = rest.find((r) => !used.has(r) && view.index[r][key] === value && G.canPlayOn(sim, r, i));
          if (id) {
            used.add(id);
            reach++;
          }
        });
        best = Math.max(best, matched * 3 + reach * 1.8 + (matched + reach >= 5 ? 6 : 0));
      }
    }
    return best;
  }

  function bestPlay(view, seat, rng) {
    let best = null;
    for (const { cardId, pile } of G.legalPlays(view, seat)) {
      const score = closeness(view, seat, cardId, pile) + rng() * 0.01;
      if (!best || score > best.score) best = { cardId, pile, score, card: view.index[cardId] };
    }
    return best;
  }

  function worstCards(view, seat, count) {
    const hand = view.players[seat].hand;
    const keep = (id) => pileCount(view, id);
    return hand.slice().sort((a, b) => keep(a) - keep(b)).slice(0, count);
  }

  // Easy and normal players sometimes make a random (but legal) move instead of the best one they can see.
  const MISTAKES = { easy: 0.5, normal: 0.2, hard: 0 };

  function randomAction(view, seat, rng) {
    if (view.phase === 'over' || view.active !== seat) return null;
    if (view.phase === 'play') {
      const moves = G.legalPlays(view, seat);
      if (!moves.length) return { type: 'cannotPlay' };
      const m = moves[Math.floor(rng() * moves.length)];
      return { type: 'play', cardId: m.cardId, pile: m.pile, binxTo: seat };
    }
    return null; // tricks, spells and discards are already simple decisions
  }

  function best(view, seat, rng) {
    if (view.phase === 'over' || view.active !== seat) return null;
    const me = view.players[seat];

    if (view.phase === 'trick') {
      const stuck = G.legalPlays(view, seat).length === 0;
      if (stuck && !view.tricksUsed.burning && deckLeft(view) >= 6 && me.hand.length >= 3) {
        return { type: 'useTrick', trick: 'burning', discard: worstCards(view, seat, 3) };
      }
      return { type: 'skipTrick' };
    }

    if (view.phase === 'play') {
      const move = bestPlay(view, seat, rng);
      if (!move) return { type: 'cannotPlay' };
      const action = { type: 'play', cardId: move.cardId, pile: move.pile };
      if (move.card.special === 'binx') action.binxTo = seat; // reveal the computer's own hand to its human partner
      return action;
    }

    if (view.phase === 'spell') {
      if (view.pendingSpell) {
        const sp = view.pendingSpell;
        const costly = sp.effect === 'discard' && (sp.amount >= 2 || deckLeft(view) < 8);
        if (!view.tricksUsed.salt && (costly || (deckLeft(view) < 5 && sp.effect === 'drawExtra'))) {
          return { type: 'useTrick', trick: 'salt' };
        }
        return { type: 'continueFromSpell' };
      }
      if (view.pendingDiscard) return { type: 'discard', cardIds: worstCards(view, seat, view.pendingDiscard.min) };
    }
    return null;
  }

  function choose(view, seat, rng = Math.random, level = 'hard') {
    if (rng() < (MISTAKES[level] || 0)) {
      const mistake = randomAction(view, seat, rng);
      if (mistake) return mistake;
    }
    return best(view, seat, rng);
  }

  const api = { choose };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HocusBot = api;
})(typeof window !== 'undefined' ? window : globalThis);
