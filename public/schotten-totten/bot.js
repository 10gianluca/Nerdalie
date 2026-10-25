/* The computer player for Schotten Totten. Pure, no DOM. Handed the view a player would see, it returns one play
   ({ type: 'play', card, stone }) or null when it is not its turn.

   For every card and stone it could use, it estimates by random sampling how likely each stone is to end up its own,
   and plays what makes the whole row most likely to be won (with a bonus for stones side by side, which win the game on
   their own). Levels differ in how many samples it takes and how often it plays something it didn't think through. */
(function (root) {
  'use strict';

  const G = typeof module !== 'undefined' && module.exports ? require('./game.js') : root.Schotten;
  const { ALL, STONES, rankOf, compareRank } = G;

  // samples: random deals tried per stone. extra: how many spare cards the other player is assumed to be choosing between
  // (they hold a hand, so they don't have to take whatever comes). claim: how much a stone that is won for good is worth
  // over one that merely looks likely.
  const LEVELS = {
    easy: { samples: 5, noise: 0.9, random: 0.3, extra: 0, claim: 0 },
    normal: { samples: 30, noise: 0.15, random: 0, extra: 1, claim: 0.3 },
    hard: { samples: 120, noise: 0, random: 0, extra: 2, claim: 0.45 },
  };

  // The best formation a side can make by picking `k` of the cards offered.
  function bestCompletion(side, offered, k) {
    let top = null;
    const walk = (from, chosen) => {
      if (chosen.length === k) {
        const r = rankOf(side.concat(chosen));
        if (!top || compareRank(r, top) > 0) top = r;
        return;
      }
      for (let i = from; i < offered.length; i++) { chosen.push(offered[i]); walk(i + 1, chosen); chosen.pop(); }
    };
    walk(0, []);
    return top;
  }

  // Chance that `seat` takes a stone, given the cards on each side, the cards that might still turn up (`pool`) and
  // who finished first when both sides end up with three. completedFirst: 0 = mine, 1 = theirs, null = not decided yet.
  function stoneChance(mine, theirs, mineFirst, pool, samples, rng, extra = 0) {
    const needMe = 3 - mine.length;
    const needThem = 3 - theirs.length;
    if (!needMe && !needThem) {
      const c = compareRank(rankOf(mine), rankOf(theirs));
      return c > 0 || (c === 0 && mineFirst) ? 1 : 0;
    }
    if (pool.length < needMe + needThem) return 0.5;
    const spare = needThem ? Math.min(extra, pool.length - needMe - needThem) : 0;
    const need = needMe + needThem + spare;
    let won = 0;
    const deck = pool.slice();
    for (let n = 0; n < samples; n++) {
      for (let i = 0; i < need; i++) { // a partial shuffle: the first `need` cards are the draw
        const j = i + Math.floor(rng() * (deck.length - i));
        [deck[i], deck[j]] = [deck[j], deck[i]];
      }
      const a = rankOf(mine.concat(deck.slice(0, needMe)));
      const b = needThem ? bestCompletion(theirs, deck.slice(needMe, need), needThem) : rankOf(theirs);
      const c = compareRank(a, b);
      if (c > 0) won += 1;
      else if (c === 0) won += !needMe ? 1 : !needThem ? 0 : 0.5; // a tie goes to whoever finished first
    }
    return won / samples;
  }

  function choose(view, seat, rng = Math.random, level = 'normal') {
    const plays = G.legalPlays(view, seat);
    if (!plays.length) return null;
    const opts = LEVELS[level] || LEVELS.normal;
    const toAction = (p) => ({ type: 'play', card: p.card, stone: p.stone });
    if (opts.random && rng() < opts.random) return toAction(plays[Math.floor(rng() * plays.length)]);

    const opp = 1 - seat;
    const known = new Set(G.onTable(view).concat(view.hands[seat]));
    const pool = ALL.filter((id) => !known.has(id));

    // what each stone is worth to us as it stands
    const base = view.stones.map((st) => {
      if (st.owner != null) return st.owner === seat ? 1 : 0;
      return stoneChance(st.sides[seat], st.sides[opp], st.done[seat] > 0 && (!st.done[opp] || st.done[seat] < st.done[opp]), pool, opts.samples, rng, opts.extra);
    });

    const value = (chances) => {
      let v = 0;
      for (let i = 0; i < STONES; i++) {
        v += chances[i];
        if (i + 1 < STONES) v += 0.5 * chances[i] * chances[i + 1]; // neighbours are what win the game
      }
      return v;
    };

    let best = null;
    let bestValue = -Infinity;
    for (const p of plays) {
      const st = view.stones[p.stone];
      const mine = st.sides[seat].concat(p.card);
      const rest = pool.filter((id) => id !== p.card);
      const chances = base.slice();
      // finishing my side now beats a tie only if the other side isn't finished yet
      chances[p.stone] = stoneChance(mine, st.sides[opp], mine.length === 3 && !st.done[opp], rest, opts.samples, rng, opts.extra);
      // a finished side nothing left can beat is won now, which is worth more than a good chance of winning it later
      let bonus = 0;
      if (mine.length === 3) {
        const sim = {
          stones: view.stones.map((x, i) => (i === p.stone ? { ...x, sides: x.sides.map((side, j) => (j === seat ? mine : side)), done: x.done.map((d, j) => (j === seat ? 1e9 : d)) } : x)),
          hands: view.hands.map((h, j) => (j === seat ? h.filter((c) => c !== p.card) : h)),
        };
        if (G.provable(sim, seat, p.stone)) { chances[p.stone] = 1; bonus = opts.claim; }
      }
      const noise = (rng() + rng() + rng() - 1.5) * opts.noise;
      // tiny tie-break: prefer to keep strong cards back when a play changes nothing
      const v = value(chances) + bonus + noise - rankHint(p.card) * 0.0005;
      if (v > bestValue) {
        bestValue = v;
        best = p;
      }
    }
    return toAction(best);
  }

  const rankHint = (card) => Number(card.slice(1));

  const api = { choose, stoneChance, LEVELS: Object.keys(LEVELS) };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SchottenBot = api;
})(typeof window !== 'undefined' ? window : globalThis);
