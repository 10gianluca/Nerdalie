/* The computer player for Onitama: a look-ahead search (negamax with alpha-beta pruning) over a compact copy of the
   position. Pure, no DOM. `choose` is handed the state and returns one action ({ type: 'move', ... } or { type: 'pass',
   card }), or null when it is not its turn.

   Levels: Easy looks one move ahead and sometimes just plays something; Normal looks two moves ahead; Hard five. */
(function (root) {
  'use strict';

  const G = typeof module !== 'undefined' && module.exports ? require('./game.js') : root.Onitama;
  const { SIZE, CARD_IDS, TEMPLE } = G;
  const N = SIZE * SIZE;

  // ---------- compact position ----------
  // cells: 0 empty, 1 / 2 = seat 0 student / master, 3 / 4 = seat 1 student / master
  const owner = (c) => (c === 0 ? -1 : c <= 2 ? 0 : 1);
  const isMaster = (c) => c === 2 || c === 4;
  const ARCH = TEMPLE.map(([x, y]) => y * SIZE + x);

  // TARGETS[seat][card][cell] = the cells that card reaches from that cell
  const TARGETS = [0, 1].map((seat) => CARD_IDS.map((id) => {
    const ds = G.steps(id, seat);
    return Array.from({ length: N }, (_, cell) => {
      const x = cell % SIZE;
      const y = Math.floor(cell / SIZE);
      const out = [];
      for (const [dx, dy] of ds) if (G.inside(x + dx, y + dy)) out.push((y + dy) * SIZE + (x + dx));
      return out;
    });
  }));
  const CARD_INDEX = Object.fromEntries(CARD_IDS.map((id, i) => [id, i]));

  function fromState(s) {
    const cells = new Int8Array(N);
    s.board.forEach((piece, i) => {
      if (piece) cells[i] = piece.p === 0 ? (piece.m ? 2 : 1) : piece.m ? 4 : 3;
    });
    return { cells, hands: s.hands.map((h) => h.map((c) => CARD_INDEX[c])), side: CARD_INDEX[s.side], active: s.active };
  }

  const WIN = 100000;

  function moves(pos) {
    const out = [];
    const seat = pos.active;
    const hand = pos.hands[seat];
    for (let k = 0; k < 2; k++) {
      const table = TARGETS[seat][hand[k]];
      for (let cell = 0; cell < N; cell++) {
        const c = pos.cells[cell];
        if (!c || owner(c) !== seat) continue;
        for (const to of table[cell]) {
          const t = pos.cells[to];
          if (t && owner(t) === seat) continue;
          out.push({ k, from: cell, to, take: t });
        }
      }
    }
    if (!out.length) for (let k = 0; k < 2; k++) out.push({ k, pass: true, take: 0 });
    return out;
  }

  // Plays a move on the position and returns what is needed to undo it, plus the winner (or -1).
  function make(pos, m) {
    const seat = pos.active;
    const hand = pos.hands[seat];
    const used = hand[m.k];
    let piece = 0;
    let win = false;
    if (!m.pass) {
      piece = pos.cells[m.from];
      pos.cells[m.from] = 0;
      pos.cells[m.to] = piece;
      win = isMaster(m.take) || (isMaster(piece) && m.to === ARCH[1 - seat]);
    }
    hand[m.k] = pos.side;
    pos.side = used;
    pos.active = 1 - seat;
    return { piece, used, win };
  }

  function unmake(pos, m, u) {
    const seat = 1 - pos.active;
    pos.active = seat;
    pos.side = pos.hands[seat][m.k];
    pos.hands[seat][m.k] = u.used;
    if (!m.pass) {
      pos.cells[m.from] = u.piece;
      pos.cells[m.to] = m.take;
    }
  }

  // ---------- evaluation (from the point of view of the player to move) ----------
  const VALUE = { student: 100, master: 400 };
  function evaluate(pos) {
    let score = 0;
    for (let cell = 0; cell < N; cell++) {
      const c = pos.cells[cell];
      if (!c) continue;
      const seat = owner(c);
      const x = cell % SIZE;
      const y = Math.floor(cell / SIZE);
      const progress = seat === 0 ? y : SIZE - 1 - y; // how far up the board for that player
      let v = isMaster(c) ? VALUE.master : VALUE.student;
      v += progress * (isMaster(c) ? 3 : 7); // students are worth more nearer the enemy
      v -= Math.abs(x - 2) * 4; // the middle files reach more squares
      score += seat === pos.active ? v : -v;
    }
    return score;
  }

  function order(list) {
    // captures first (biggest prize first), then everything else
    return list.sort((a, b) => (b.take ? (isMaster(b.take) ? 3 : 2) : 0) - (a.take ? (isMaster(a.take) ? 3 : 2) : 0));
  }

  function negamax(pos, depth, alpha, beta, ply) {
    const list = order(moves(pos));
    let best = -Infinity;
    for (const m of list) {
      const u = make(pos, m);
      let v;
      if (u.win) v = WIN - ply;
      else if (depth <= 1) v = -evaluate(pos);
      else v = -negamax(pos, depth - 1, -beta, -alpha, ply + 1);
      unmake(pos, m, u);
      if (v > best) best = v;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  const LEVELS = {
    easy: { depth: 1, random: 0.35, noise: 60 },
    normal: { depth: 2, random: 0, noise: 8 },
    hard: { depth: 5, random: 0, noise: 0 },
  };

  function choose(state, seat, rng = Math.random, level = 'normal') {
    if (state.phase !== 'play' || state.active !== seat) return null;
    const opts = LEVELS[level] || LEVELS.normal;
    const pos = fromState(state);
    const list = moves(pos);
    const toAction = (m) => (m.pass
      ? { type: 'pass', card: CARD_IDS[pos.hands[seat][m.k]] }
      : { type: 'move', card: CARD_IDS[pos.hands[seat][m.k]], from: [m.from % SIZE, Math.floor(m.from / SIZE)], to: [m.to % SIZE, Math.floor(m.to / SIZE)] });
    if (opts.random && rng() < opts.random) return toAction(list[Math.floor(rng() * list.length)]);

    let best = null;
    let bestValue = -Infinity;
    let alpha = -Infinity;
    for (const m of order(list.slice())) {
      const u = make(pos, m);
      let v;
      if (u.win) v = WIN;
      else if (opts.depth <= 1) v = -evaluate(pos);
      else v = -negamax(pos, opts.depth - 1, -Infinity, Infinity, 1);
      unmake(pos, m, u);
      // a little noise breaks ties (and makes the weaker levels fallible), but never hides a forced win
      v += v >= WIN - 50 ? 0 : (rng() - 0.5) * 2 * (opts.noise || 0.001);
      if (v > bestValue) {
        bestValue = v;
        best = m;
        alpha = Math.max(alpha, v);
      }
    }
    return toAction(best);
  }

  const api = { choose, LEVELS: Object.keys(LEVELS), evaluate, fromState, moves };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OnitamaBot = api;
})(typeof window !== 'undefined' ? window : globalThis);
