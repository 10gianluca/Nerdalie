/* The computer player for Mancala (Kalah): a look-ahead search (negamax with alpha-beta pruning) that understands extra
   turns and captures, because it plays the real sowing rules on a copy of the pits. Pure, no DOM. Easy looks one move
   ahead and sometimes plays something random; Normal looks four; Hard eight. */
(function (root) {
  'use strict';

  const G = typeof module !== 'undefined' && module.exports ? require('./game.js') : root.Mancala;
  const { PITS, store, first, side } = G;

  const WIN = 10000;

  // The value of a position for `seat`, who is to move: stores first, then seeds still on the board, plus the pits that
  // would land in the store (a free extra turn).
  function evaluate(pits, seat) {
    const opp = 1 - seat;
    let v = (pits[store(seat)] - pits[store(opp)]) * 10 + (side(pits, seat) - side(pits, opp)) * 2;
    for (let i = 0; i < PITS; i++) {
      if (pits[first(seat) + i] === PITS - i) v += 4;
      if (pits[first(opp) + i] === PITS - i) v -= 4;
    }
    return v;
  }

  // Returns the value for `seat` to move, searching `depth` more moves.
  function search(pits, seat, depth, alpha, beta) {
    let best = -Infinity;
    let any = false;
    for (let i = PITS - 1; i >= 0; i--) { // later pits first: they are the ones that reach the store
      if (!pits[first(seat) + i]) continue;
      any = true;
      const next = pits.slice();
      const r = G.sow(next, seat, i);
      let v;
      if (side(next, 0) === 0 || side(next, 1) === 0) {
        const a = next[6] + side(next, 0);
        const b = next[13] + side(next, 1);
        const diff = seat === 0 ? a - b : b - a;
        v = diff > 0 ? WIN + diff : diff < 0 ? -WIN + diff : 0;
      } else if (depth <= 1) {
        v = r.extra ? evaluate(next, seat) : -evaluate(next, 1 - seat);
      } else if (r.extra) {
        v = search(next, seat, depth - 1, alpha, beta); // the same player moves again
      } else {
        v = -search(next, 1 - seat, depth - 1, -beta, -alpha);
      }
      if (v > best) best = v;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return any ? best : evaluate(pits, seat);
  }

  const LEVELS = {
    easy: { depth: 1, noise: 6, random: 0.2 },
    normal: { depth: 4, noise: 2, random: 0 },
    hard: { depth: 9, noise: 0, random: 0 },
  };

  function choose(state, seat, rng = Math.random, level = 'normal') {
    if (state.phase !== 'play' || state.active !== seat) return null;
    const opts = LEVELS[level] || LEVELS.normal;
    const options = G.legalPits(state, seat);
    if (!options.length) return null;
    if (opts.random && rng() < opts.random) return { type: 'sow', pit: options[Math.floor(rng() * options.length)] };
    let best = options[0];
    let bestV = -Infinity;
    for (const i of options.slice().reverse()) {
      const next = state.pits.slice();
      const r = G.sow(next, seat, i);
      let v;
      if (side(next, 0) === 0 || side(next, 1) === 0) {
        const a = next[6] + side(next, 0);
        const b = next[13] + side(next, 1);
        const diff = seat === 0 ? a - b : b - a;
        v = diff > 0 ? WIN + diff : diff < 0 ? -WIN + diff : 0;
      } else if (opts.depth <= 1) {
        v = r.extra ? evaluate(next, seat) : -evaluate(next, 1 - seat);
      } else if (r.extra) {
        v = search(next, seat, opts.depth - 1, -Infinity, Infinity);
      } else {
        v = -search(next, 1 - seat, opts.depth - 1, -Infinity, Infinity);
      }
      v += (rng() - 0.5) * 2 * opts.noise;
      if (v > bestV) { bestV = v; best = i; }
    }
    return { type: 'sow', pit: best };
  }

  const api = { choose, LEVELS: Object.keys(LEVELS), evaluate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MancalaBot = api;
})(typeof window !== 'undefined' ? window : globalThis);
