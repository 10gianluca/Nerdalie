/* The computer player for Santorini. Pure, no DOM. A turn is two actions in this game (move, then build), so `choose`
   returns whichever one is due: a placement at the start, a move, or the build that finishes a move.

   Moves are picked by looking ahead over whole turns (a move together with its build) with alpha-beta pruning. Easy looks
   one turn ahead and sometimes plays something random; Normal looks two; Hard looks four. */
(function (root) {
  'use strict';

  const G = typeof module !== 'undefined' && module.exports ? require('./game.js') : root.Santorini;
  const { SIZE, N, NEIGHBOURS } = G;

  const WIN = 100000;
  const CENTRE = Array.from({ length: N }, (_, i) => 2 - Math.max(Math.abs((i % SIZE) - 2), Math.abs(Math.floor(i / SIZE) - 2))); // 2 in the middle, 0 on the edge

  // ---------- compact position ----------
  function fromState(s) {
    const h = new Int8Array(N);
    const dome = new Int8Array(N);
    const occ = new Int8Array(N).fill(-1);
    s.board.forEach((q, i) => { h[i] = q.h; dome[i] = q.dome ? 1 : 0; occ[i] = q.w; });
    return { h, dome, occ, builders: s.builders.map((b) => b.slice()) };
  }

  // Every full turn the player could take: { b: index of the builder, from, to, build, win }
  function turns(pos, seat) {
    const out = [];
    const mine = pos.builders[seat];
    for (let b = 0; b < mine.length; b++) {
      const from = mine[b];
      for (const to of NEIGHBOURS[from]) {
        if (pos.occ[to] >= 0 || pos.dome[to] || pos.h[to] > pos.h[from] + 1) continue;
        if (pos.h[to] === 3 && pos.h[to] > pos.h[from]) { out.push({ b, from, to, build: -1, win: true }); continue; }
        for (const build of NEIGHBOURS[to]) {
          if (build === to || pos.dome[build]) continue;
          if (pos.occ[build] >= 0 && build !== from) continue;
          out.push({ b, from, to, build, win: false });
        }
      }
    }
    return out;
  }

  function make(pos, seat, t) {
    pos.occ[t.from] = -1;
    pos.occ[t.to] = seat;
    pos.builders[seat][t.b] = t.to;
    let capped = false;
    if (!t.win) {
      if (pos.h[t.build] === 3) { pos.dome[t.build] = 1; capped = true; } else pos.h[t.build] += 1;
    }
    return capped;
  }

  function unmake(pos, seat, t, capped) {
    if (!t.win) {
      if (capped) pos.dome[t.build] = 0; else pos.h[t.build] -= 1;
    }
    pos.occ[t.to] = -1;
    pos.occ[t.from] = seat;
    pos.builders[seat][t.b] = t.from;
  }

  // ---------- evaluation, from the point of view of `me` (the player who is about to move) ----------
  function side(pos, seat) {
    let v = 0;
    for (const at of pos.builders[seat]) {
      const hh = pos.h[at];
      v += hh * 26 + CENTRE[at] * 5;
      let reach = 0;
      let climb = 0;
      let top = false;
      for (const n of NEIGHBOURS[at]) {
        if (pos.occ[n] >= 0 || pos.dome[n]) continue;
        if (pos.h[n] <= hh + 1) reach += 1;
        if (pos.h[n] === hh + 1) climb += 1;
        if (hh === 2 && pos.h[n] === 3) top = true;
      }
      v += reach * 3 + climb * 4;
      if (top) v += 400; // a level 3 to step onto next turn
    }
    return v;
  }

  const evaluate = (pos, me) => side(pos, me) - side(pos, 1 - me);

  function order(list, pos) {
    return list.sort((a, b) => (b.win ? 1000 : pos.h[b.to] * 10 + (b.build >= 0 && pos.h[b.build] === 3 ? 6 : 0)) - (a.win ? 1000 : pos.h[a.to] * 10 + (a.build >= 0 && pos.h[a.build] === 3 ? 6 : 0)));
  }

  // value for the player to move, looking `depth` more turns ahead
  function search(pos, me, depth, alpha, beta, ply) {
    const list = order(turns(pos, me), pos);
    if (!list.length) return -(WIN - ply); // can't make a turn: lost
    let best = -Infinity;
    for (const t of list) {
      let v;
      if (t.win) v = WIN - ply;
      else {
        const capped = make(pos, me, t);
        v = depth <= 1 ? -evaluate(pos, 1 - me) : -search(pos, 1 - me, depth - 1, -beta, -alpha, ply + 1);
        unmake(pos, me, t, capped);
      }
      if (v > best) best = v;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  const LEVELS = {
    easy: { depth: 1, noise: 45, random: 0.45 },
    normal: { depth: 2, noise: 6, random: 0 },
    hard: { depth: 4, noise: 0, random: 0 },
  };

  let plan = null; // the build that goes with the move just chosen, { builder, build }

  function choosePlacement(state, rng, opts) {
    const free = G.legalPlacements(state, state.active);
    let best = free[0];
    let bestScore = -Infinity;
    for (const i of free) {
      let v = CENTRE[i] * 4;
      // not right beside an enemy builder where it can be crowded out, but close enough to matter
      const enemy = state.builders[1 - state.active].some((e) => NEIGHBOURS[e].includes(i));
      if (enemy) v -= 1;
      v += (rng() - 0.5) * (opts.noise ? 10 : 2);
      if (v > bestScore) { bestScore = v; best = i; }
    }
    return { type: 'place', at: best };
  }

  function choose(state, seat, rng = Math.random, level = 'normal') {
    if (state.phase === 'over' || state.active !== seat) return null;
    const opts = LEVELS[level] || LEVELS.normal;

    if (state.phase === 'place') return choosePlacement(state, rng, opts);

    if (state.pending) { // finish the turn: the build that was planned with the move, or the best one now
      const options = G.legalBuilds(state, seat);
      if (plan && plan.builder === state.pending.builder && options.includes(plan.build)) return { type: 'build', at: plan.build };
      const pos = fromState(state);
      let best = options[0];
      let bestV = -Infinity;
      for (const at of options) {
        const dome = pos.h[at] === 3;
        if (dome) pos.dome[at] = 1; else pos.h[at] += 1;
        const v = -evaluate(pos, 1 - seat) + (rng() - 0.5) * opts.noise;
        if (dome) pos.dome[at] = 0; else pos.h[at] -= 1;
        if (v > bestV) { bestV = v; best = at; }
      }
      return { type: 'build', at: best };
    }

    const pos = fromState(state);
    const list = turns(pos, seat);
    if (!list.length) return null;
    const pick = (t) => {
      plan = t.win ? null : { builder: t.to, build: t.build };
      return { type: 'move', from: t.from, to: t.to };
    };
    if (opts.random && rng() < opts.random) return pick(list[Math.floor(rng() * list.length)]);

    let best = null;
    let bestV = -Infinity;
    for (const t of order(list.slice(), pos)) {
      let v;
      if (t.win) v = WIN;
      else {
        const capped = make(pos, seat, t);
        v = opts.depth <= 1 ? -evaluate(pos, 1 - seat) : -search(pos, 1 - seat, opts.depth - 1, -Infinity, Infinity, 1);
        unmake(pos, seat, t, capped);
        v += (rng() - 0.5) * 2 * opts.noise;
      }
      if (v > bestV) { bestV = v; best = t; }
    }
    return pick(best);
  }

  const api = { choose, LEVELS: Object.keys(LEVELS), evaluate, fromState, turns };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SantoriniBot = api;
})(typeof window !== 'undefined' ? window : globalThis);
