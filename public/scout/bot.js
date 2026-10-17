/* Computer opponent for Scout. It only reads what its own player may see (game.viewFor).

   A hand is judged by how many neighbouring runs/sets it can be split into: fewer groups means fewer turns to go
   out. Every option (turning the hand over at the start, each possible Show, each possible Scout and where the card
   goes) is scored by the position it leaves: cards won, spare chips, and how many cards and groups remain. */
(function (root) {
  'use strict';

  const G = typeof module !== 'undefined' && module.exports ? require('./game.js') : root.Scout;

  const swapCard = (c) => ({ id: c.id, up: c.down, down: c.up });

  // The fewest neighbouring groups (each a valid set or run) the hand can be cut into.
  function groupCount(hand) {
    const n = hand.length;
    const best = Array(n + 1).fill(Infinity);
    best[0] = 0;
    for (let i = 1; i <= n; i++) {
      for (let j = 0; j < i; j++) {
        if (best[j] + 1 < best[i] && G.classify(hand.slice(j, i))) best[i] = best[j] + 1;
      }
    }
    return best[n];
  }

  // Value of holding this hand with this many chips and won cards.
  function position(hand, chips, won) {
    return won + chips * 0.9 - hand.length * 0.45 - groupCount(hand) * 0.9;
  }

  function orientChoice(me) {
    const flipped = G.flipHand(me.hand);
    return position(flipped, me.chips, 0) > position(me.hand, me.chips, 0);
  }

  function options(view, seat) {
    const me = view.players[seat];
    const table = view.table;
    const out = [];

    for (const show of G.legalShows(me.hand, table)) {
      const rest = [...me.hand.slice(0, show.from), ...me.hand.slice(show.to + 1)];
      const captured = table ? table.cards.length : 0;
      let score = position(rest, me.chips, me.won.length + captured) + 0.08 * show.value + 0.1 * show.count;
      if (!rest.length) score += 4;
      out.push({ score, action: { type: 'show', from: show.from, to: show.to } });
    }

    if (table && me.chips > 0) {
      const ends = table.cards.length === 1 ? ['left'] : ['left', 'right'];
      for (const end of ends) {
        const taken = end === 'left' ? table.cards[0] : table.cards[table.cards.length - 1];
        for (const flip of [false, true]) {
          const card = flip ? swapCard(taken) : taken;
          for (let at = 0; at <= me.hand.length; at++) {
            const next = [...me.hand.slice(0, at), card, ...me.hand.slice(at)];
            out.push({ score: position(next, me.chips - 1, me.won.length), action: { type: 'scout', end, insertAt: at, flip } });
          }
        }
      }
    }
    return out;
  }

  // Easy and normal players sometimes make a random (but legal) move instead of the best one they can see.
  const MISTAKES = { easy: 0.5, normal: 0.2, hard: 0 };

  function randomAction(view, seat, rng) {
    const me = view.players[seat];
    if (view.phase === 'orient') return me.ready ? null : { type: 'ready', flip: rng() < 0.5 };
    if (view.phase !== 'play' || view.active !== seat) return null;
    const all = G.legalShows(me.hand, view.table).map((s) => ({ type: 'show', from: s.from, to: s.to }));
    if (view.table && me.chips > 0) {
      for (const end of ['left', 'right']) all.push({ type: 'scout', end, insertAt: Math.floor(rng() * (me.hand.length + 1)), flip: rng() < 0.5 });
    }
    return all[Math.floor(rng() * all.length)] || null;
  }

  function best(view, seat, rng) {
    const me = view.players[seat];
    if (view.phase === 'orient') return me.ready ? null : { type: 'ready', flip: orientChoice(me) };
    if (view.phase !== 'play' || view.active !== seat) return null;

    let top = null;
    for (const o of options(view, seat)) {
      const score = o.score + rng() * 0.001;
      if (!top || score > top.score) top = { score, action: o.action };
    }
    return top ? top.action : null;
  }

  function choose(view, seat, rng = Math.random, level = 'hard') {
    if (rng() < (MISTAKES[level] || 0)) {
      const mistake = randomAction(view, seat, rng);
      if (mistake) return mistake;
    }
    return best(view, seat, rng);
  }

  const api = { choose, groupCount };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ScoutBot = api;
})(typeof window !== 'undefined' ? window : globalThis);
