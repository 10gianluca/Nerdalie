/* The computer player for Jaipur. Pure: it is handed the view a player would see and returns one action (or null when
   it is not its turn). No DOM, so it runs in Node for the tests.

   It rates every legal action by how many points it expects the action to be worth and plays the best one:
     - what a hand of each kind of goods is worth if sold now (tokens that are left + the bonus for a big set),
       discounted because it isn't sold yet,
     - what a camel in the herd is worth, and how close the camel bonus is,
     - on Hard, whether the action would end the round while ahead (good) or behind (bad).
   Levels differ in how much noise is added to the ratings and how often it just plays something at random. */
(function (root) {
  'use strict';

  const G = typeof module !== 'undefined' && module.exports ? require('./game.js') : root.Jaipur;
  const { GOODS, PREMIUM, TOKENS } = G;

  const sum = (list) => list.reduce((t, v) => t + v, 0);
  const count = (list, what) => list.reduce((n, c) => n + (c === what ? 1 : 0), 0);
  // Average value of the bonus token for a sale of 3, 4 or 5+ cards
  const BONUS_AVG = { 3: 1.86, 4: 5, 5: 9 };
  const CAMEL_VALUE = 0.9;
  const LEVELS = {
    easy: { noise: 7, random: 0.45 },
    normal: { noise: 1.2, random: 0 },
    hard: { noise: 0.25, random: 0 },
  };

  // How good is it to be holding `c` cards of `good`, given the tokens still in its pile? The sale value if sold now,
  // times how likely it is to actually get sold at that value.
  function holdValue(view, good, c) {
    if (c <= 0) return 0;
    const pile = view.piles[good];
    const n = Math.min(c, pile.length);
    let points = sum(pile.slice(0, n));
    const size = c >= 5 ? 5 : c >= 3 ? c : 0;
    if (size && view.bonusLeft[size] > 0) points += BONUS_AVG[size];
    const premium = PREMIUM.includes(good);
    let realise;
    if (premium) realise = c >= 3 ? 0.85 : c === 2 ? 0.7 : 0.3;
    else realise = c >= 5 ? 0.9 : c >= 3 ? 0.8 : c === 2 ? 0.55 : 0.4;
    return points * realise;
  }

  // Fewer tokens in a pile make everything of that kind worth less (and bring the end of the round closer).
  const handValue = (view, hand) => GOODS.reduce((t, g) => t + holdValue(view, g, count(hand, g)), 0);

  function camelEdge(herd, oppHerd) {
    // The 5 point camel bonus, smoothed: a tie gives nobody anything, a lead of 3+ is nearly safe.
    const d = herd - oppHerd;
    const p = d >= 4 ? 0.95 : d >= 2 ? 0.8 : d === 1 ? 0.6 : d === 0 ? 0.3 : d === -1 ? 0.15 : 0.05;
    return 5 * p;
  }

  // Estimated score of a player right now (bonus tokens of the opponent are hidden, so they count as 3 each).
  function estimate(view, seat, bonusPoints) {
    const p = view.players[seat];
    return G.goodsPoints(p) + (bonusPoints != null ? bonusPoints : sum(p.bonus));
  }

  function rate(view, seat, action, level) {
    const me = view.players[seat];
    const opp = view.players[1 - seat];
    const hand = me.hand;
    const base = handValue(view, hand);
    let v = 0;
    let ends = false;

    switch (action.type) {
      case 'take': {
        const next = hand.concat(action.card);
        v = handValue(view, next) - base;
        // keep the other player from getting it, mostly the valuable ones
        v += PREMIUM.includes(action.card) ? 0.6 : 0.15;
        if (G.deckLeft(view) === 0) ends = true;
        break;
      }
      case 'camels': {
        const n = count(view.market, 'camel');
        v = n * CAMEL_VALUE + camelEdge(me.herd + n, opp.herd) - camelEdge(me.herd, opp.herd);
        // taking them refills the market with unknown cards, which also hands the opponent a fresh choice
        v -= 0.4;
        if (G.deckLeft(view) < n) ends = true;
        break;
      }
      case 'exchange': {
        const giveGoods = action.give.filter((c) => c !== 'camel');
        const giveCamels = action.give.length - giveGoods.length;
        const next = hand.slice();
        giveGoods.forEach((c) => next.splice(next.indexOf(c), 1));
        next.push(...action.take);
        v = handValue(view, next) - base;
        v -= giveCamels * CAMEL_VALUE;
        v += camelEdge(me.herd - giveCamels, opp.herd) - camelEdge(me.herd, opp.herd);
        // what we hand over lands in the market for the other player to pick up
        for (const c of giveGoods) v -= PREMIUM.includes(c) ? 0.8 : 0.25;
        v -= 0.5; // an exchange spends a whole turn on shuffling cards around
        break;
      }
      case 'sell': {
        const have = count(hand, action.good);
        const pile = view.piles[action.good];
        const got = sum(pile.slice(0, action.count));
        const size = action.count >= 5 ? 5 : action.count >= 3 ? action.count : 0;
        const bonus = size && view.bonusLeft[size] > 0 ? BONUS_AVG[size] : 0;
        const after = holdValue(view, action.good, have - action.count);
        v = got + bonus + after - holdValue(view, action.good, have);
        // The 6s and 7s at the top of the pile are gone for the other player once they are taken
        v += pile.slice(0, action.count).reduce((t, x) => t + Math.max(0, x - 5), 0) * 0.35;
        // Cashing in a lone cheap card early throws away the bonus a set would earn, but the top tokens go first
        if (!PREMIUM.includes(action.good) && action.count < 3 && have >= action.count && pile.length > 3) v -= 0.6;
        if (G.emptyPiles(view) + (action.count >= pile.length ? 1 : 0) >= G.RULES.emptyPilesToEnd) ends = true;
        break;
      }
      default:
        return -Infinity;
    }

    if (level === 'hard' && ends) {
      // Ending the round: only worth it when ahead.
      const gain = action.type === 'sell' ? sum(view.piles[action.good].slice(0, action.count)) + (action.count >= 3 ? BONUS_AVG[Math.min(action.count, 5)] : 0) : 0;
      const mine = estimate(view, seat) + gain + (me.herd > opp.herd ? 5 : 0);
      const theirs = estimate(view, 1 - seat, opp.bonusCount * 3) + (opp.herd > me.herd ? 5 : 0);
      v += mine > theirs + 2 ? 14 : mine < theirs - 2 ? -14 : 0;
    }
    return v;
  }

  function choose(view, seat, rng = Math.random, level = 'normal') {
    const legal = G.legalActions(view, seat);
    if (!legal.length) return null;
    const opts = LEVELS[level] || LEVELS.normal;
    if (opts.random && rng() < opts.random) return legal[Math.floor(rng() * legal.length)];
    let best = null;
    let bestValue = -Infinity;
    for (const action of legal) {
      const noise = (rng() + rng() + rng() - 1.5) * opts.noise; // roughly bell shaped
      const value = rate(view, seat, action, level) + noise;
      if (value > bestValue) {
        bestValue = value;
        best = action;
      }
    }
    return best;
  }

  const api = { choose, rate, holdValue, LEVELS: Object.keys(LEVELS), TOKENS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JaipurBot = api;
})(typeof window !== 'undefined' ? window : globalThis);
