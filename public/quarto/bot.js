/* The computer player for Quarto. Pure, no DOM. A turn here is two actions (place the piece you were given, then give one),
   so `choose` returns whichever one is due.

   What matters in Quarto is never handing over a piece the other player can win with. The bot checks that, and looks
   further ahead the fewer empty squares there are: Hard plays the last stretch out to the end, so once the board is
   getting full it doesn't make mistakes. Easy only avoids the obvious and sometimes ignores that too. */
(function (root) {
  'use strict';

  const G = typeof module !== 'undefined' && module.exports ? require('./game.js') : root.Quarto;
  const { N, LINES, lineWin } = G;

  const empties = (board) => {
    const out = [];
    for (let i = 0; i < N; i++) if (board[i] < 0) out.push(i);
    return out;
  };

  // A line with three pieces and one gap is a threat: any piece that shares a feature with all three wins there.
  // For each threat, `yes` has the feature bits all three pieces have set, and `no` the bits all three have clear.
  function threats(board) {
    const out = [];
    for (const line of LINES) {
      let gap = -1;
      let filled = 0;
      let yes = 15;
      let no = 15;
      for (const i of line) {
        const p = board[i];
        if (p < 0) { gap = i; continue; }
        filled += 1;
        yes &= p;
        no &= ~p;
      }
      if (filled === 3) out.push({ gap, yes, no: no & 15 });
    }
    return out;
  }

  const wins = (list, piece) => list.some((th) => (piece & th.yes) !== 0 || (~piece & th.no & 15) !== 0);
  const completes = (board, piece, at) => threats(board).some((th) => th.gap === at && ((piece & th.yes) !== 0 || (~piece & th.no & 15) !== 0));
  const winningCells = (board, piece) => threats(board).filter((th) => (piece & th.yes) !== 0 || (~piece & th.no & 15) !== 0).map((th) => th.gap).filter((g, i, a) => a.indexOf(g) === i);

  // Value for the player who has to place `piece`: 1 they can force a win, -1 they lose, 0 a draw or too far to see.
  function solve(board, pool, piece, depth) {
    if (wins(threats(board), piece)) return 1;
    if (!pool.length || depth <= 0) return 0;
    const cells = empties(board);
    let best = -1;
    for (const c of cells) {
      board[c] = piece;
      const danger = threats(board);
      let bestGive = -1; // if every piece they could give lets the other player win, that is -1
      for (const g of pool) {
        if (wins(danger, g)) continue;
        const rest = pool.filter((x) => x !== g);
        const v = -solve(board, rest, g, depth - 1);
        if (v > bestGive) bestGive = v;
        if (bestGive === 1) break;
      }
      board[c] = -1;
      if (bestGive > best) best = bestGive;
      if (best === 1) return 1;
    }
    return best;
  }

  const LEVELS = {
    easy: { depth: () => 1, random: 0.35, careless: 0.25 },
    normal: { depth: (e) => (e > 10 ? 1 : 2), random: 0, careless: 0 },
    hard: { depth: (e) => (e > 12 ? 1 : e > 10 ? 2 : e > 8 ? 3 : e > 6 ? 4 : 30), random: 0, careless: 0 },
  };

  const pick = (list, rng) => list[Math.floor(rng() * list.length)];

  function choose(state, seat, rng = Math.random, level = 'normal') {
    if (state.phase === 'over' || state.active !== seat) return null;
    const opts = LEVELS[level] || LEVELS.normal;
    const board = state.board.slice();
    const depth = opts.depth(empties(board).length);

    if (state.phase === 'give') {
      const pool = state.pool;
      const safe = pool.filter((g) => !winningCells(board, g).length);
      if (!safe.length) { // every piece loses: hand over the one with the fewest winning squares
        const fewest = Math.min(...pool.map((g) => winningCells(board, g).length));
        return { type: 'give', piece: pick(pool.filter((g) => winningCells(board, g).length === fewest), rng) };
      }
      if (opts.random && rng() < opts.random) return { type: 'give', piece: opts.careless && rng() < opts.careless ? pick(pool, rng) : pick(safe, rng) };
      let best = [];
      let bestV = -Infinity;
      for (const g of safe) {
        const v = -solve(board, pool.filter((x) => x !== g), g, depth);
        if (v > bestV) { bestV = v; best = [g]; } else if (v === bestV) best.push(g);
      }
      return { type: 'give', piece: pick(best, rng) };
    }

    // place the piece we were given
    const piece = state.hand;
    const cells = empties(board);
    const winning = cells.filter((c) => completes(board, piece, c));
    if (winning.length && !(opts.random && rng() < 0.12)) return { type: 'place', at: pick(winning, rng) };
    if (opts.random && rng() < opts.random) return { type: 'place', at: pick(cells, rng) };
    let best = [];
    let bestV = -Infinity;
    for (const c of cells) {
      board[c] = piece;
      let v = -1;
      for (const g of state.pool) {
        if (winningCells(board, g).length) continue;
        const w = -solve(board, state.pool.filter((x) => x !== g), g, depth);
        if (w > v) v = w;
        if (v === 1) break;
      }
      board[c] = -1;
      if (v > bestV) { bestV = v; best = [c]; } else if (v === bestV) best.push(c);
    }
    return { type: 'place', at: pick(best, rng) };
  }

  const api = { choose, solve, winningCells, LEVELS: Object.keys(LEVELS) };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QuartoBot = api;
})(typeof window !== 'undefined' ? window : globalThis);
