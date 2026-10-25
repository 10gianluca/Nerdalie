/* Santorini rules engine (the plain game, no god powers): pure state + actions, no DOM. Works in the browser
   (window.Santorini) and in Node.

   A 5x5 island. Each player has two builders. Players take turns placing their builders, then each turn is:
     1. MOVE one builder to a neighbouring square (diagonals count). It may climb at most one level up, and can step
        down any amount. Squares with a builder or a dome are off limits.
     2. BUILD on a square next to the builder that just moved: one more block (level 0 to 1 to 2 to 3), or, on a
        level 3 tower, a dome that closes the square for good.
   Moving UP onto level 3 wins at once. You also lose if you can't make a full turn (no move, or no build after it).

   Squares are numbered y * 5 + x. A square is { h: height 0-3, dome: bool, w: -1 | 0 | 1 } where w is the builder on it. */
(function (root) {
  'use strict';

  const SIZE = 5;
  const N = SIZE * SIZE;
  const clone = (o) => JSON.parse(JSON.stringify(o));

  const neighbours = (i) => {
    const x = i % SIZE;
    const y = Math.floor(i / SIZE);
    const out = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < SIZE && ny >= 0 && ny < SIZE) out.push(ny * SIZE + nx);
      }
    }
    return out;
  };
  const NEIGHBOURS = Array.from({ length: N }, (_, i) => neighbours(i));

  function setup(names, starter) {
    return {
      phase: 'place', // place (four builders go down), play, over
      starter,
      active: starter,
      turn: 1,
      board: Array.from({ length: N }, () => ({ h: 0, dome: false, w: -1 })),
      builders: [[], []], // squares of each player's builders
      placed: 0,
      pending: null, // after a move: { builder: square } until the build is made
      players: names.map((name) => ({ name })),
      last: null,
      end: null,
    };
  }

  function newGame(names, starter = 0) {
    const s = setup(names, starter);
    s.wins = [0, 0];
    return s;
  }

  const free = (sq) => sq.w < 0 && !sq.dome;

  // ---------- moves and builds ----------
  function builds(s, from) {
    return NEIGHBOURS[from].filter((i) => free(s.board[i]) && s.board[i].h <= 3);
  }

  // Where a builder may go: one level up at most, never onto a builder or a dome. A move that doesn't win has to
  // leave a square to build on, otherwise the turn couldn't be finished.
  function movesFrom(s, seat, from) {
    const here = s.board[from].h;
    const out = [];
    for (const to of NEIGHBOURS[from]) {
      const sq = s.board[to];
      if (!free(sq) || sq.h > here + 1) continue;
      if (sq.h === 3) { out.push(to); continue; } // climbing to level 3 wins, so no build is needed
      // would a build be possible from there? the square we leave is free again, the one we enter is taken
      const can = NEIGHBOURS[to].some((n) => n === from || free(s.board[n]));
      if (can) out.push(to);
    }
    return out;
  }

  function legalMoves(s, seat) {
    if (s.phase !== 'play' || s.active !== seat || s.pending) return [];
    const out = [];
    for (const from of s.builders[seat]) for (const to of movesFrom(s, seat, from)) out.push({ from, to });
    return out;
  }

  function legalBuilds(s, seat) {
    if (s.phase !== 'play' || s.active !== seat || !s.pending) return [];
    return builds(s, s.pending.builder);
  }

  function legalPlacements(s, seat) {
    if (s.phase !== 'place' || s.active !== seat) return [];
    const out = [];
    for (let i = 0; i < N; i++) if (free(s.board[i])) out.push(i);
    return out;
  }

  // If the player about to move has no turn available, they lose.
  function checkStuck(s) {
    if (s.phase !== 'play') return;
    if (!legalMoves(s, s.active).length) {
      s.phase = 'over';
      s.end = { winner: 1 - s.active, reason: 'stuck' };
      s.wins[1 - s.active] += 1;
    }
  }

  function apply(state, player, action) {
    const s = clone(state);
    const fail = (msg) => {
      throw new Error(msg);
    };
    if (action.type === 'rematch') {
      if (s.phase !== 'over') fail('The game is not over yet');
      const next = setup(s.players.map((p) => p.name), 1 - s.starter);
      next.wins = s.wins.slice();
      return next;
    }
    if (s.phase === 'over') fail('The game is over');
    if (player !== s.active) fail("It's not your turn");

    if (action.type === 'place') {
      if (s.phase !== 'place') fail('The builders are already placed');
      const sq = s.board[action.at];
      if (!sq || !free(sq)) fail('That square is taken');
      sq.w = player;
      s.builders[player].push(action.at);
      s.placed += 1;
      s.last = { who: player, turn: s.turn, kind: 'place', at: action.at };
      s.active = 1 - player;
      s.turn += 1;
      if (s.placed === 4) {
        s.phase = 'play';
        s.active = s.starter;
        checkStuck(s);
      }
      return s;
    }

    if (s.phase !== 'play') fail('Place your builders first');
    if (action.type === 'move') {
      if (s.pending) fail('Build before moving again');
      if (!s.builders[player].includes(action.from)) fail('That is not your builder');
      if (!movesFrom(s, player, action.from).includes(action.to)) fail('That builder can not go there');
      const dest = s.board[action.to];
      const climbed = dest.h > s.board[action.from].h;
      s.board[action.from].w = -1;
      dest.w = player;
      s.builders[player][s.builders[player].indexOf(action.from)] = action.to;
      s.last = { who: player, turn: s.turn, kind: 'move', from: action.from, to: action.to, up: climbed };
      if (dest.h === 3 && climbed) {
        s.phase = 'over';
        s.end = { winner: player, reason: 'summit' };
        s.wins[player] += 1;
        return s;
      }
      s.pending = { builder: action.to };
      return s;
    }

    if (action.type === 'build') {
      if (!s.pending) fail('Move a builder first');
      if (!builds(s, s.pending.builder).includes(action.at)) fail('You can not build there');
      const sq = s.board[action.at];
      const dome = sq.h === 3;
      if (dome) sq.dome = true; else sq.h += 1;
      s.last = { ...s.last, build: action.at, dome };
      s.pending = null;
      s.active = 1 - player;
      s.turn += 1;
      checkStuck(s);
      return s;
    }
    return fail('Unknown action');
  }

  const viewFor = (s) => clone(s); // nothing is hidden

  const api = { SIZE, N, NEIGHBOURS, newGame, apply, viewFor, legalMoves, legalBuilds, legalPlacements, movesFrom, builds };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Santorini = api;
})(typeof window !== 'undefined' ? window : globalThis);
