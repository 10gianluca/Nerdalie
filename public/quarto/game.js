/* Quarto rules engine: pure state + actions, no DOM. Works in the browser (window.Quarto) and in Node.

   Sixteen pieces, each with four yes/no features: tall or short, dark or light, round or square, hollow or solid. They
   all start in a pool beside a 4x4 board. A turn has two halves and they belong to different players:
     - you are GIVEN a piece by your opponent, and put it on any empty square;
     - then you choose one of the pieces left in the pool and GIVE it to your opponent.
   Whoever places a piece that completes a row, column or diagonal of four pieces sharing at least one feature wins.
   If the board fills up with no such line, it is a draw.

   A piece is a number 0 to 15: bit 0 = tall, bit 1 = dark, bit 2 = round, bit 3 = hollow. */
(function (root) {
  'use strict';

  const SIZE = 4;
  const N = 16;
  const FEATURES = [
    ['short', 'tall'],
    ['light', 'dark'],
    ['square', 'round'],
    ['solid', 'hollow'],
  ];
  const LINES = [];
  for (let i = 0; i < SIZE; i++) {
    LINES.push([0, 1, 2, 3].map((j) => i * SIZE + j)); // a row
    LINES.push([0, 1, 2, 3].map((j) => j * SIZE + i)); // a column
  }
  LINES.push([0, 5, 10, 15], [3, 6, 9, 12]);

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const name = (piece) => [3, 1, 2, 0].map((b) => FEATURES[b][(piece >> b) & 1]).join(' '); // "hollow dark round tall"

  // Does this line (four squares) hold four pieces with something in common? Returns the shared feature names, or null.
  function lineWin(board, line) {
    const pieces = line.map((i) => board[i]);
    if (pieces.some((p) => p < 0)) return null;
    const shared = [];
    for (let b = 0; b < 4; b++) {
      const v = pieces.map((p) => (p >> b) & 1);
      if (v.every((x) => x === v[0])) shared.push(FEATURES[b][v[0]]);
    }
    return shared.length ? shared : null;
  }

  // The squares where `piece` would complete a winning line on this board.
  function winningSquares(board, piece) {
    const out = [];
    for (let i = 0; i < N; i++) {
      if (board[i] >= 0) continue;
      const next = board.slice();
      next[i] = piece;
      if (LINES.some((line) => line.includes(i) && lineWin(next, line))) out.push(i);
    }
    return out;
  }

  function setup(names, starter) {
    return {
      phase: 'give', // give: the active player picks a piece for the other; place: the active player puts the piece they were given
      starter,
      active: starter,
      turn: 1,
      board: Array(N).fill(-1),
      pool: Array.from({ length: N }, (_, i) => i),
      hand: -1, // the piece just given, waiting to be placed
      players: names.map((n) => ({ name: n })),
      last: null,
      end: null,
    };
  }

  function newGame(names, starter = 0) {
    const s = setup(names, starter);
    s.wins = [0, 0];
    s.draws = 0;
    return s;
  }

  const legalGives = (s, seat) => (s.phase === 'give' && s.active === seat ? s.pool.slice() : []);
  const legalPlaces = (s, seat) => {
    if (s.phase !== 'place' || s.active !== seat) return [];
    const out = [];
    for (let i = 0; i < N; i++) if (s.board[i] < 0) out.push(i);
    return out;
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
    if (s.phase === 'over') fail('The game is over');
    if (player !== s.active) fail("It's not your turn");

    if (action.type === 'give') {
      if (s.phase !== 'give') fail('Place the piece you were given first');
      if (!s.pool.includes(action.piece)) fail('That piece has already been used');
      s.pool.splice(s.pool.indexOf(action.piece), 1);
      s.hand = action.piece;
      s.last = { who: player, turn: s.turn, kind: 'give', piece: action.piece };
      s.phase = 'place';
      s.active = 1 - player;
      return s;
    }

    if (action.type === 'place') {
      if (s.phase !== 'place') fail('Give a piece first');
      if (!(action.at >= 0 && action.at < N) || s.board[action.at] >= 0) fail('That square is taken');
      s.board[action.at] = s.hand;
      const placed = s.hand;
      s.hand = -1;
      const line = LINES.find((l) => l.includes(action.at) && lineWin(s.board, l));
      s.last = { who: player, turn: s.turn, kind: 'place', piece: placed, at: action.at };
      s.turn += 1;
      if (line) {
        s.phase = 'over';
        s.end = { winner: player, line, shared: lineWin(s.board, line) };
        s.wins[player] += 1;
      } else if (!s.pool.length) {
        s.phase = 'over';
        s.end = { winner: null, line: null, shared: null };
        s.draws += 1;
      } else {
        s.phase = 'give'; // the same player now chooses a piece for the other
      }
      return s;
    }
    return fail('Unknown action');
  }

  const viewFor = (s) => clone(s); // nothing is hidden

  const api = { SIZE, N, FEATURES, LINES, name, lineWin, winningSquares, newGame, apply, viewFor, legalGives, legalPlaces };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Quarto = api;
})(typeof window !== 'undefined' ? window : globalThis);
