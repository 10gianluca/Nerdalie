/* The computer player for Checkers: a look-ahead search (negamax with alpha-beta pruning) over the real move rules, so it
   always takes the compulsory jumps and sees multi-jumps. It likes kings, advanced men, a solid back row and the middle of
   the board. Pure, no DOM. Easy looks two moves ahead and sometimes plays something random; Normal looks four; Hard six. */
(function (root) {
  'use strict';

  const G = typeof module !== 'undefined' && module.exports ? require('./game.js') : root.Checkers;
  const { SIZE, N, owner, isKing } = G;

  const WIN = 100000;

  // Value of the board for `seat` (bigger is better for them).
  function evaluate(board, seat) {
    let v = 0;
    for (let i = 0; i < N; i++) {
      const p = board[i];
      if (p < 0) continue;
      const side = owner(p);
      const x = i % SIZE;
      const y = Math.floor(i / SIZE);
      const progress = side === 0 ? SIZE - 1 - y : y; // rows advanced
      let w;
      if (isKing(p)) {
        w = 175 + (3 - Math.max(Math.abs(x - 3.5), Math.abs(y - 3.5)) * 0.8); // kings like the middle
      } else {
        w = 100 + progress * 4;
        if (progress === 0) w += 6; // a man still on the back row guards the crowning squares
        if (x === 0 || x === SIZE - 1) w -= 2; // the edge is a little less useful
      }
      v += side === seat ? w : -w;
    }
    return v;
  }

  function search(board, seat, depth, alpha, beta, ply) {
    const moves = G.movesOn(board, seat);
    if (!moves.length) return -(WIN - ply); // no move: lost
    if (depth <= 0) return evaluate(board, seat);
    // jumps with more captures first
    moves.sort((a, b) => b.captures.length - a.captures.length);
    let best = -Infinity;
    for (const m of moves) {
      const v = -search(G.boardAfter(board, seat, m), 1 - seat, depth - 1, -beta, -alpha, ply + 1);
      if (v > best) best = v;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  const LEVELS = {
    easy: { depth: 2, noise: 25, random: 0.3 },
    normal: { depth: 4, noise: 4, random: 0 },
    hard: { depth: 6, noise: 0, random: 0 },
  };

  function choose(state, seat, rng = Math.random, level = 'normal') {
    if (state.phase !== 'play' || state.active !== seat) return null;
    const opts = LEVELS[level] || LEVELS.normal;
    const moves = G.movesOn(state.board, seat);
    if (!moves.length) return null;
    if (opts.random && rng() < opts.random) return { type: 'move', path: moves[Math.floor(rng() * moves.length)].path };
    moves.sort((a, b) => b.captures.length - a.captures.length);
    let best = moves[0];
    let bestV = -Infinity;
    for (const m of moves) {
      const v = -search(G.boardAfter(state.board, seat, m), 1 - seat, opts.depth - 1, -Infinity, Infinity, 1) + (rng() - 0.5) * 2 * opts.noise;
      if (v > bestV) { bestV = v; best = m; }
    }
    return { type: 'move', path: best.path };
  }

  const api = { choose, LEVELS: Object.keys(LEVELS), evaluate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CheckersBot = api;
})(typeof window !== 'undefined' ? window : globalThis);
