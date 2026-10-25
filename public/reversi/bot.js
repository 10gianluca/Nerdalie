/* The computer player for Reversi: a look-ahead search (negamax with alpha-beta pruning) that likes corners, avoids the
   squares next to them, and keeps more moves available than the other player. Pure, no DOM. Levels differ in how far it
   looks ahead; Easy also plays a random move now and then. */
(function (root) {
  'use strict';

  const G = typeof module !== 'undefined' && module.exports ? require('./game.js') : root.Reversi;
  const { SIZE, N, DIRS } = G;

  // Square values: corners are gold, the squares touching them are poison until the corner is taken.
  const WEIGHT = [
    100, -25, 10, 5, 5, 10, -25, 100,
    -25, -45, 1, 1, 1, 1, -45, -25,
    10, 1, 3, 2, 2, 3, 1, 10,
    5, 1, 2, 1, 1, 2, 1, 5,
    5, 1, 2, 1, 1, 2, 1, 5,
    10, 1, 3, 2, 2, 3, 1, 10,
    -25, -45, 1, 1, 1, 1, -45, -25,
    100, -25, 10, 5, 5, 10, -25, 100,
  ];
  const CORNERS = [0, 7, 56, 63];
  const NEXT_TO = { 0: [1, 8, 9], 7: [6, 14, 15], 56: [48, 49, 57], 63: [54, 55, 62] };

  // Moves for `seat` on a plain board array, as { at, flips }
  function movesOn(board, seat) {
    const out = [];
    for (let i = 0; i < N; i++) {
      const f = G.flips(board, seat, i);
      if (f.length) out.push({ at: i, flips: f });
    }
    return out;
  }

  function evaluate(board, me) {
    let own = 0;
    let other = 0;
    let discs = 0;
    for (let i = 0; i < N; i++) {
      const v = board[i];
      if (v < 0) continue;
      discs += 1;
      let w = WEIGHT[i];
      // a poison square next to a corner somebody already owns is no longer poison
      for (const c of CORNERS) if (NEXT_TO[c].includes(i) && board[c] >= 0) w = 4;
      if (v === me) own += w; else other += w;
    }
    const mob = movesOn(board, me).length - movesOn(board, 1 - me).length;
    const late = discs > 50; // near the end, discs are what count
    let score = own - other + mob * 6;
    if (late) {
      let d = 0;
      for (let i = 0; i < N; i++) if (board[i] === me) d += 1; else if (board[i] >= 0) d -= 1;
      score += d * 4;
    }
    return score;
  }

  const WIN = 100000;

  function search(board, me, depth, alpha, beta) {
    const list = movesOn(board, me);
    if (!list.length) {
      const opp = movesOn(board, 1 - me);
      if (!opp.length) { // game over
        let d = 0;
        for (const v of board) if (v === me) d += 1; else if (v >= 0) d -= 1;
        return d > 0 ? WIN + d : d < 0 ? -WIN + d : 0;
      }
      return -search(board, 1 - me, depth, -beta, -alpha); // pass
    }
    if (depth <= 0) return evaluate(board, me);
    list.sort((a, b) => WEIGHT[b.at] - WEIGHT[a.at]);
    let best = -Infinity;
    for (const m of list) {
      const next = board.slice();
      next[m.at] = me;
      for (const i of m.flips) next[i] = me;
      const v = -search(next, 1 - me, depth - 1, -beta, -alpha);
      if (v > best) best = v;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  const LEVELS = {
    easy: { depth: 1, noise: 18, random: 0.35 },
    normal: { depth: 3, noise: 3, random: 0 },
    hard: { depth: 5, noise: 0, random: 0 },
  };

  function choose(state, seat, rng = Math.random, level = 'normal') {
    if (state.phase !== 'play' || state.active !== seat) return null;
    const opts = LEVELS[level] || LEVELS.normal;
    const list = movesOn(state.board, seat);
    if (!list.length) return null;
    if (opts.random && rng() < opts.random) return { type: 'move', at: list[Math.floor(rng() * list.length)].at };
    list.sort((a, b) => WEIGHT[b.at] - WEIGHT[a.at]);
    let best = list[0];
    let bestV = -Infinity;
    for (const m of list) {
      const next = state.board.slice();
      next[m.at] = seat;
      for (const i of m.flips) next[i] = seat;
      const v = -search(next, 1 - seat, opts.depth - 1, -Infinity, Infinity) + (rng() - 0.5) * 2 * opts.noise;
      if (v > bestV) { bestV = v; best = m; }
    }
    return { type: 'move', at: best.at };
  }

  const api = { choose, LEVELS: Object.keys(LEVELS), evaluate, movesOn, DIRS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ReversiBot = api;
})(typeof window !== 'undefined' ? window : globalThis);
