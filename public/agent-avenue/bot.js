/* Computer opponent for Agent Avenue. It reasons only from what its own player may see (game.viewFor):
   its hand, both play areas, the track and the face-up card.

   Offering: the other player picks which card they take, so a split is worth the worse of the two outcomes.
   Choosing: the face-down card is unknown, so it is averaged over the cards that could still be out there. */
(function (root) {
  'use strict';

  const G = typeof module !== 'undefined' && module.exports ? require('./game.js') : root.AgentAvenue;
  const { TYPES, RULES, typeOf } = G;

  const WIN = 1000;
  const allIds = Object.keys(TYPES).flatMap((key) => Array.from({ length: TYPES[key].count }, (_, i) => `${key}-${i + 1}`));

  function countsOf(ids) {
    const counts = {};
    for (const id of ids) counts[typeOf(id)] = (counts[typeOf(id)] || 0) + 1;
    return counts;
  }

  const lastIcon = (key) => TYPES[key].icons[TYPES[key].icons.length - 1];

  // How good the position is for `seat` once cards `got[0]` / `got[1]` have been added to the two play areas.
  function evaluate(view, seat, got) {
    const pos = view.pos.slice();
    const counts = [0, 1].map((i) => countsOf(view.players[i].play));
    [0, 1].forEach((i) => {
      const key = typeOf(got[i]);
      counts[i][key] = (counts[i][key] || 0) + 1;
      pos[i] += G.moveFor(key, counts[i][key]);
    });

    const gap = pos[1] - pos[0];
    const found = [];
    if (gap <= 0) found.push(0);
    if (gap >= RULES.board) found.push(1);
    for (const i of [0, 1]) {
      for (const [key, n] of Object.entries(counts[i])) {
        const last = lastIcon(key);
        if (typeof last === 'string' && n >= RULES.setSize) found.push(last === 'win' ? i : 1 - i);
      }
    }
    if (found.length) {
      const winner = found.includes(view.active) ? view.active : found[0];
      return winner === seat ? WIN : -WIN;
    }

    const mine = seat === 0 ? gap : RULES.board - gap; // spaces I still need to close
    let value = RULES.board - 2 * mine; // positive when I am the closer one
    for (const i of [0, 1]) {
      const sign = i === seat ? 1 : -1;
      for (const [key, n] of Object.entries(counts[i])) {
        const last = lastIcon(key);
        if (last === 'win') value += sign * n * n * 1.2;
        else if (last === 'lose') value -= sign * n * n * 1.2;
      }
    }
    return value;
  }

  // The cards that could still be hidden from this player: everything not visible to them.
  function unseenIds(view, seat, extraSeen) {
    const seen = new Set([...view.players[seat].hand, ...view.players[0].play, ...view.players[1].play, ...extraSeen]);
    return allIds.filter((id) => !seen.has(id));
  }

  const average = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

  function chooseSide(view, seat) {
    const up = view.offer.up;
    const unseen = unseenIds(view, seat, [up]);
    const other = 1 - seat;
    const takeUp = average(unseen.map((d) => evaluate(view, seat, seat === 0 ? [up, d] : [d, up])));
    const takeDown = average(unseen.map((d) => evaluate(view, seat, seat === 0 ? [d, up] : [up, d])));
    return { type: 'choose', pick: takeUp >= takeDown ? 'up' : 'down', other };
  }

  function bestOffer(view, seat, rng) {
    const hand = view.players[seat].hand;
    const other = 1 - seat;
    let best = null;
    for (const up of hand) {
      for (const down of hand) {
        if (!G.legalPair(hand, up, down)) continue;
        // the other player takes `pick`; I end up with the remaining card
        const outcome = (pick) => {
          const theirs = pick === 'up' ? up : down;
          const mine = pick === 'up' ? down : up;
          const got = [];
          got[seat] = mine;
          got[other] = theirs;
          return evaluate(view, seat, got);
        };
        const value = Math.min(outcome('up'), outcome('down')) + rng() * 0.01;
        if (!best || value > best.value) best = { up, down, value };
      }
    }
    return best;
  }

  // A card that would hand me a lost game if I ever end up taking a third copy is worth trading away.
  function riskyCard(view, seat) {
    const counts = countsOf(view.players[seat].play);
    return view.players[seat].hand.find((id) => {
      const last = lastIcon(typeOf(id));
      return last === 'lose' && (counts[typeOf(id)] || 0) >= RULES.setSize - 1;
    });
  }

  // Easy and normal players sometimes make a random (but legal) move instead of the best one they can see.
  const MISTAKES = { easy: 0.5, normal: 0.2, hard: 0 };

  function randomAction(view, seat, rng) {
    if (view.phase === 'offer' && view.active === seat) {
      const hand = view.players[seat].hand;
      const pairs = [];
      for (const a of hand) for (const b of hand) if (G.legalPair(hand, a, b)) pairs.push([a, b]);
      if (!pairs.length) return null;
      const [up, down] = pairs[Math.floor(rng() * pairs.length)];
      return { type: 'offer', up, down };
    }
    if (view.phase === 'choose' && view.active !== seat) return { type: 'choose', pick: rng() < 0.5 ? 'up' : 'down' };
    return null;
  }

  function best(view, seat, rng) {
    if (view.phase === 'offer' && view.active === seat) {
      const me = view.players[seat];
      const risky = riskyCard(view, seat);
      if (risky && me.swaps < RULES.swaps && (view.deckCount == null ? view.deck.length : view.deckCount) > 0) {
        return { type: 'swap', card: risky };
      }
      const best = bestOffer(view, seat, rng);
      return best ? { type: 'offer', up: best.up, down: best.down } : null;
    }
    if (view.phase === 'choose' && view.active !== seat) {
      const { type, pick } = chooseSide(view, seat);
      return { type, pick };
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

  const api = { choose, evaluate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AgentBot = api;
})(typeof window !== 'undefined' ? window : globalThis);
