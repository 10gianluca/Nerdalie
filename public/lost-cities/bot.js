/* Computer opponent for Lost Cities. It only reads what its own player may see (game.viewFor).

   The core idea is a projected score for each expedition: what is already down, plus the rising run of cards
   still in hand, plus a share of the unseen cards it is likely to draw. Expeditions are only started when that
   projection looks clearly positive, cards that cannot be played any more are the first to be discarded
   (preferring ones the other player cannot use), and a discard is picked up when it extends a started expedition. */
(function (root) {
  'use strict';

  const G = typeof module !== 'undefined' && module.exports ? require('./game.js') : root.LostCities;
  const { RULES, COLOR_IDS, parse } = G;

  const ALL_IDS = COLOR_IDS.flatMap((c) => [
    ...Array.from({ length: RULES.wagers }, (_, i) => `${c}-w${i + 1}`),
    ...RULES.values.map((v) => `${c}-${v}`),
  ]);

  const numbersOf = (ids) => ids.map(parse).filter((c) => !c.wager);
  const sum = (xs) => xs.reduce((a, b) => a + b, 0);

  function situation(view, seat) {
    const me = view.players[seat];
    const opp = view.players[1 - seat];
    const deckLeft = view.deckCount != null ? view.deckCount : view.deck.length;
    const myTurns = Math.ceil(deckLeft / 2);
    const known = new Set([
      ...me.hand,
      ...COLOR_IDS.flatMap((c) => [...me.exp[c], ...opp.exp[c], ...view.discards[c]]),
    ]);
    const unseen = ALL_IDS.filter((id) => !known.has(id)).map(parse);
    return { me, opp, deckLeft, myTurns, unseen, drawChance: Math.min(1, myTurns / Math.max(1, unseen.length)) };
  }

  function colorInfo(sit, color, hand) {
    const exp = sit.me.exp[color];
    const nums = numbersOf(exp);
    const top = nums.length ? nums[nums.length - 1].value : 0;
    const inHand = hand.map(parse).filter((c) => c.color === color);
    return {
      exp,
      started: exp.length > 0,
      top,
      hasNumbers: nums.length > 0,
      expSum: sum(nums.map((c) => c.value)),
      wagersPlayed: exp.length - nums.length,
      handWagers: inHand.filter((c) => c.wager).length,
      chain: inHand.filter((c) => !c.wager && c.value > top).map((c) => c.value).sort((a, b) => a - b),
    };
  }

  // Projected final score of one expedition (0 if it would never be started).
  function projected(sit, color, info) {
    const wagers = info.wagersPlayed + (info.hasNumbers ? 0 : info.handWagers);
    const chain = info.chain.slice(0, Math.max(0, sit.myTurns));
    const chainTop = chain.length ? chain[chain.length - 1] : info.top;
    const future = sit.unseen.filter((c) => c.color === color && !c.wager && c.value > chainTop);
    const extraSum = sit.drawChance * sum(future.map((c) => c.value));
    const extraCount = sit.drawChance * future.length;
    const count = info.exp.length + chain.length + (info.hasNumbers ? 0 : info.handWagers) + extraCount;
    if (!info.started && !chain.length && !wagers) return 0;
    return (info.expSum + sum(chain) + extraSum - RULES.cost) * (1 + wagers) + (count >= RULES.bonusCards ? RULES.bonus : 0);
  }

  const opponentCanUse = (sit, id) => {
    const card = parse(id);
    const exp = sit.opp.exp[card.color];
    if (card.wager) return !numbersOf(exp).length;
    const nums = numbersOf(exp);
    return card.value > (nums.length ? nums[nums.length - 1].value : 0);
  };

  function playScore(sit, id) {
    const card = parse(id);
    const info = colorInfo(sit, card.color, sit.me.hand);
    if (!G.canPlay(info.exp, id).ok) return -Infinity;
    const est = projected(sit, card.color, info);

    if (card.wager) {
      return info.started || est < 14 ? -Infinity : est * 0.2;
    }
    if (info.started) {
      const skipped = info.chain.filter((v) => v < card.value).length;
      return 4 + card.value * 0.4 - skipped * 3.5 - Math.max(0, card.value - info.top - 1) * 0.6;
    }
    // Starting a new expedition: only the lowest card of a promising run, and only with time to finish it.
    const lowest = info.chain[0] === card.value;
    if (!lowest || est < 5 || info.chain.length > sit.myTurns + 1) return -Infinity;
    return 1.5 + est * 0.12;
  }

  function discardScore(sit, id) {
    const card = parse(id);
    const info = colorInfo(sit, card.color, sit.me.hand);
    const playable = G.canPlay(info.exp, id).ok;
    let keep;
    if (!playable) keep = -2;
    else if (info.started) keep = card.wager ? 0 : 6 + card.value * 0.5;
    else {
      const est = projected(sit, card.color, info);
      keep = est >= 5 ? 3 + est * 0.15 : card.wager ? -1 : card.value * 0.1;
    }
    const help = opponentCanUse(sit, id) ? (card.wager ? 3 : card.value * 0.5 + 1) : 0;
    return -keep - help;
  }

  function bestPlayOrDiscard(sit, rng) {
    let bestPlay = null;
    let bestDiscard = null;
    for (const id of sit.me.hand) {
      const ps = playScore(sit, id) + rng() * 0.01;
      if (!bestPlay || ps > bestPlay.score) bestPlay = { id, score: ps };
      const ds = discardScore(sit, id) + rng() * 0.01;
      if (!bestDiscard || ds > bestDiscard.score) bestDiscard = { id, score: ds };
    }
    if (bestPlay && bestPlay.score > 1.5) return { type: 'play', card: bestPlay.id };
    return { type: 'discard', card: bestDiscard.id };
  }

  function bestDraw(view, seat, sit) {
    const options = G.legalDraws(view);
    let best = { from: 'deck', score: 4 }; // what an unknown card is worth, roughly
    for (const color of COLOR_IDS) {
      if (!options.includes(color)) continue;
      const pile = view.discards[color];
      const id = pile[pile.length - 1];
      const card = parse(id);
      const info = colorInfo(sit, color, sit.me.hand);
      let score = -Infinity;
      if (!card.wager && info.started && card.value > info.top) {
        const gap = card.value - info.top;
        score = gap <= 3 ? 6 + card.value * 0.4 - (gap - 1) : 2;
      } else if (!info.started) {
        const withCard = projected(sit, color, colorInfo(sit, color, [...sit.me.hand, id]));
        if (withCard >= 12 && !card.wager) score = 3 + withCard * 0.15;
      }
      if (score > best.score) best = { from: color, score };
    }
    return { type: 'draw', from: best.from };
  }

  // Easy and normal players sometimes make a random (but legal) move instead of the best one they can see.
  const MISTAKES = { easy: 0.5, normal: 0.2, hard: 0 };

  function randomAction(view, seat, rng) {
    if (view.active !== seat) return null;
    if (view.phase === 'play') {
      const me = view.players[seat];
      const plays = me.hand.filter((id) => G.canPlay(me.exp[parse(id).color], id).ok);
      if (plays.length && rng() < 0.6) return { type: 'play', card: plays[Math.floor(rng() * plays.length)] };
      return { type: 'discard', card: me.hand[Math.floor(rng() * me.hand.length)] };
    }
    if (view.phase === 'draw') {
      const draws = G.legalDraws(view);
      return { type: 'draw', from: draws[Math.floor(rng() * draws.length)] };
    }
    return null;
  }

  function best(view, seat, rng) {
    if (view.active !== seat) return null;
    const sit = situation(view, seat);
    if (view.phase === 'play') return bestPlayOrDiscard(sit, rng);
    if (view.phase === 'draw') return bestDraw(view, seat, sit);
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
  else root.LostBot = api;
})(typeof window !== 'undefined' ? window : globalThis);
