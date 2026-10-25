/* Reversi (Othello) rules engine: pure state + actions, no DOM. Works in the browser (window.Reversi) and in Node.

   An 8x8 board. Seat 0 plays black and moves first, seat 1 plays white. On your turn you place a disc on an empty square
   so that it traps a straight line (any of the eight directions) of the other colour between the new disc and one of
   yours; every disc trapped that way flips to your colour. If you have no such square you pass. When neither player can
   move the game ends and the colour with more discs wins.

   Squares are numbered y * 8 + x. board[i] is -1 (empty), 0 (black) or 1 (white). */
(function (root) {
  'use strict';

  const SIZE = 8;
  const N = SIZE * SIZE;
  const DIRS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
  const clone = (o) => JSON.parse(JSON.stringify(o));

  function setup(names, starter) {
    const board = Array(N).fill(-1);
    // the standard opening: white on d4 and e5, black on e4 and d5
    board[3 * SIZE + 3] = 1;
    board[4 * SIZE + 4] = 1;
    board[3 * SIZE + 4] = 0;
    board[4 * SIZE + 3] = 0;
    return { phase: 'play', starter, active: starter, turn: 1, board, players: names.map((name) => ({ name })), last: null, end: null };
  }

  function newGame(names, starter = 0) {
    const s = setup(names, starter);
    s.wins = [0, 0]; // games won by each seat in this sitting
    s.draws = 0;
    return s;
  }

  // The discs a move at `at` would flip for `seat`, as a list of squares (empty if the move isn't allowed).
  function flips(board, seat, at) {
    if (board[at] !== -1) return [];
    const x0 = at % SIZE;
    const y0 = Math.floor(at / SIZE);
    const out = [];
    for (const [dx, dy] of DIRS) {
      const line = [];
      let x = x0 + dx;
      let y = y0 + dy;
      while (x >= 0 && x < SIZE && y >= 0 && y < SIZE && board[y * SIZE + x] === 1 - seat) {
        line.push(y * SIZE + x);
        x += dx;
        y += dy;
      }
      if (line.length && x >= 0 && x < SIZE && y >= 0 && y < SIZE && board[y * SIZE + x] === seat) out.push(...line);
    }
    return out;
  }

  const legalMoves = (s, seat) => {
    if (s.phase !== 'play' || s.active !== seat) return [];
    const out = [];
    for (let i = 0; i < N; i++) if (flips(s.board, seat, i).length) out.push(i);
    return out;
  };

  const hasMove = (board, seat) => {
    for (let i = 0; i < N; i++) if (flips(board, seat, i).length) return true;
    return false;
  };

  const count = (board) => {
    const c = [0, 0];
    for (const v of board) if (v >= 0) c[v] += 1;
    return c;
  };

  function apply(state, player, action) {
    const s = clone(state);
    const fail = (msg) => {
      throw new Error(msg);
    };
    if (action.type === 'rematch') {
      if (s.phase !== 'over') fail('The game is not over yet');
      const next = setup(s.players.map((p) => p.name), 1 - s.starter);
      next.wins = s.wins.slice();
      next.draws = s.draws;
      return next;
    }
    if (s.phase !== 'play') fail('The game is over');
    if (player !== s.active) fail("It's not your turn");
    if (action.type !== 'move') fail('Unknown action');
    const f = flips(s.board, player, action.at);
    if (!f.length) fail("You can't play there");
    s.board[action.at] = player;
    f.forEach((i) => { s.board[i] = player; });
    s.last = { who: player, turn: s.turn, at: action.at, flipped: f.length, passed: false };
    s.turn += 1;
    const opp = 1 - player;
    if (hasMove(s.board, opp)) {
      s.active = opp;
    } else if (hasMove(s.board, player)) {
      s.last.passed = true; // the other player has to pass, so it is still your turn
      s.last.passer = opp;
    } else {
      const c = count(s.board);
      s.phase = 'over';
      s.end = { counts: c, winner: c[0] === c[1] ? null : c[0] > c[1] ? 0 : 1 };
      if (s.end.winner == null) s.draws += 1; else s.wins[s.end.winner] += 1;
    }
    return s;
  }

  const viewFor = (s) => clone(s); // nothing is hidden

  const api = { SIZE, N, DIRS, newGame, apply, viewFor, legalMoves, flips, hasMove, count };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Reversi = api;
})(typeof window !== 'undefined' ? window : globalThis);
