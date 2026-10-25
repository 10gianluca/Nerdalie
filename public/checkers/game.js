/* Checkers (English draughts) rules engine: pure state + actions, no DOM. Works in the browser (window.Checkers) and in Node.

   8x8 board, pieces only on the dark squares ((x + y) odd). Each side starts with twelve men.
     - A man moves one square diagonally forward. A king (a man that reached the far row) moves one square diagonally in
       any direction.
     - A piece captures by jumping diagonally over an enemy piece next to it onto the empty square just beyond. It must
       keep jumping if it can. A man can only jump forward; a king can jump any way.
     - Capturing is compulsory: if you can jump, you must (and you pick which jump if there is a choice).
     - A man that reaches the last row becomes a king and its move ends there.
     You win when the other player has no pieces, or no legal move. 40 moves each without a capture or a man moving is a draw.

   Squares are numbered y * 8 + x. board[i] is -1 (empty) or 0 / 1 for a seat 0 man / king, 2 / 3 for seat 1. Seat 0 starts
   at the bottom (y = 5..7) and moves up the board, seat 1 starts at the top and moves down. A move is a path of squares:
   [from, to] for a step, [from, landing1, landing2, ...] for jumps. */
(function (root) {
  'use strict';

  const SIZE = 8;
  const N = 64;
  const NO_PROGRESS_LIMIT = 80; // plies
  const clone = (o) => JSON.parse(JSON.stringify(o));

  const owner = (p) => (p < 0 ? -1 : p >> 1);
  const isKing = (p) => p >= 0 && (p & 1) === 1;
  const dir = (seat) => (seat === 0 ? -1 : 1); // the way a man of this seat moves in y
  const lastRow = (seat) => (seat === 0 ? 0 : SIZE - 1);

  function setup(names, starter) {
    const board = Array(N).fill(-1);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if ((x + y) % 2 === 0) continue;
        if (y < 3) board[y * SIZE + x] = 2;
        else if (y > 4) board[y * SIZE + x] = 0;
      }
    }
    return { phase: 'play', starter, active: starter, turn: 1, board, quiet: 0, players: names.map((name) => ({ name })), last: null, end: null };
  }

  function newGame(names, starter = 0) {
    const s = setup(names, starter);
    s.wins = [0, 0];
    s.draws = 0;
    return s;
  }

  // ---------- moves on a plain board ----------
  function directions(piece) {
    const seat = owner(piece);
    return isKing(piece) ? [[-1, -1], [1, -1], [-1, 1], [1, 1]] : [[-1, dir(seat)], [1, dir(seat)]];
  }

  // Every way `piece` standing on `from` can keep jumping. `taken` holds the squares already jumped (they stay on the board until the
  // move ends, so they block and can't be jumped twice).
  function jumpsFrom(board, from, piece, taken, path, out) {
    const seat = owner(piece);
    const x = from % SIZE;
    const y = Math.floor(from / SIZE);
    let more = false;
    for (const [dx, dy] of directions(piece)) {
      const ox = x + dx;
      const oy = y + dy;
      const lx = x + 2 * dx;
      const ly = y + 2 * dy;
      if (lx < 0 || lx >= SIZE || ly < 0 || ly >= SIZE) continue;
      const over = oy * SIZE + ox;
      const land = ly * SIZE + lx;
      if (taken.includes(over) || board[over] < 0 || owner(board[over]) === seat) continue;
      if (board[land] >= 0 && land !== path[0]) continue; // the square we started from counts as empty
      if (taken.includes(land)) continue;
      more = true;
      const nextPath = path.concat(land);
      const nextTaken = taken.concat(over);
      const crowned = !isKing(piece) && ly === lastRow(seat);
      if (crowned) out.push({ path: nextPath, captures: nextTaken }); // a man that reaches the far row stops there
      else {
        const before = out.length;
        jumpsFrom(board, land, piece, nextTaken, nextPath, out);
        if (out.length === before) out.push({ path: nextPath, captures: nextTaken });
      }
    }
    return more;
  }

  function movesOn(board, seat) {
    const jumps = [];
    const steps = [];
    for (let from = 0; from < N; from++) {
      const piece = board[from];
      if (piece < 0 || owner(piece) !== seat) continue;
      jumpsFrom(board, from, piece, [], [from], jumps);
      const x = from % SIZE;
      const y = Math.floor(from / SIZE);
      for (const [dx, dy] of directions(piece)) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= SIZE || ny < 0 || ny >= SIZE) continue;
        if (board[ny * SIZE + nx] < 0) steps.push({ path: [from, ny * SIZE + nx], captures: [] });
      }
    }
    return jumps.length ? jumps : steps; // capturing is compulsory
  }

  // The board after a move (a copy).
  function boardAfter(board, seat, move) {
    const next = board.slice();
    const from = move.path[0];
    const to = move.path[move.path.length - 1];
    let piece = next[from];
    next[from] = -1;
    for (const c of move.captures) next[c] = -1;
    if (!isKing(piece) && Math.floor(to / SIZE) === lastRow(seat)) piece |= 1;
    next[to] = piece;
    return next;
  }

  const legalMoves = (s, seat) => (s.phase === 'play' && s.active === seat ? movesOn(s.board, seat) : []);

  const count = (board) => {
    const c = [0, 0];
    for (const p of board) if (p >= 0) c[owner(p)] += 1;
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
    if (action.type !== 'move' || !Array.isArray(action.path)) fail('Unknown action');

    const moves = movesOn(s.board, player);
    const move = moves.find((m) => m.path.length === action.path.length && m.path.every((sq, i) => sq === action.path[i]));
    if (!move) {
      const mustJump = moves.length && moves[0].captures.length;
      fail(mustJump ? 'You have to jump when you can' : 'That move is not allowed');
    }
    const movedMan = !isKing(s.board[move.path[0]]);
    s.board = boardAfter(s.board, player, move);
    const to = move.path[move.path.length - 1];
    s.last = { who: player, turn: s.turn, path: move.path, captured: move.captures.length, crowned: !isKing(state.board[move.path[0]]) && isKing(s.board[to]) };
    s.turn += 1;
    s.quiet = move.captures.length || movedMan ? 0 : s.quiet + 1;

    const opp = 1 - player;
    if (!movesOn(s.board, opp).length) {
      s.phase = 'over';
      s.end = { winner: player, reason: count(s.board)[opp] === 0 ? 'captured' : 'blocked' };
      s.wins[player] += 1;
    } else if (s.quiet >= NO_PROGRESS_LIMIT) {
      s.phase = 'over';
      s.end = { winner: null, reason: 'quiet' };
      s.draws += 1;
    } else {
      s.active = opp;
    }
    return s;
  }

  const viewFor = (s) => clone(s); // nothing is hidden

  const api = { SIZE, N, owner, isKing, newGame, apply, viewFor, legalMoves, movesOn, boardAfter, count, NO_PROGRESS_LIMIT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Checkers = api;
})(typeof window !== 'undefined' ? window : globalThis);
