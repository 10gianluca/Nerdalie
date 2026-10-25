/* Onitama rules engine: pure state + actions, no DOM. Works in the browser (window.Onitama) and in Node.

   A 5x5 board. Each player has a master and four students. Sixteen move cards exist; five are used each game: two in each
   player's hand and one beside the board. On your turn you pick one of your two cards, move one pawn the way that card
   shows, then swap the card you used with the one beside the board. Landing on an enemy pawn captures it.

   You win by capturing the other master (the Way of the Stone) or by moving your master onto the other player's temple
   arch, the middle square of their back row (the Way of the Stream).

   Coordinates are (x, y) with x = 0..4 left to right and y = 0..4. Seat 0 starts on y = 0 and moves "forward" up the
   board; seat 1 starts on y = 4 and moves down. A card lists its moves as (right, forward) from the holder's side, so
   for seat 1 each move is turned around. */
(function (root) {
  'use strict';

  const SIZE = 5;
  // [right, forward]
  const CARDS = {
    tiger: { name: 'Tiger', moves: [[0, 2], [0, -1]] },
    dragon: { name: 'Dragon', moves: [[-2, 1], [2, 1], [-1, -1], [1, -1]] },
    frog: { name: 'Frog', moves: [[-1, 1], [-2, 0], [1, -1]] },
    rabbit: { name: 'Rabbit', moves: [[1, 1], [2, 0], [-1, -1]] },
    crab: { name: 'Crab', moves: [[0, 1], [-2, 0], [2, 0]] },
    elephant: { name: 'Elephant', moves: [[-1, 1], [1, 1], [-1, 0], [1, 0]] },
    goose: { name: 'Goose', moves: [[-1, 1], [-1, 0], [1, 0], [1, -1]] },
    rooster: { name: 'Rooster', moves: [[1, 1], [-1, 0], [1, 0], [-1, -1]] },
    monkey: { name: 'Monkey', moves: [[-1, 1], [1, 1], [-1, -1], [1, -1]] },
    mantis: { name: 'Mantis', moves: [[-1, 1], [1, 1], [0, -1]] },
    horse: { name: 'Horse', moves: [[0, 1], [-1, 0], [0, -1]] },
    ox: { name: 'Ox', moves: [[0, 1], [1, 0], [0, -1]] },
    crane: { name: 'Crane', moves: [[0, 1], [-1, -1], [1, -1]] },
    boar: { name: 'Boar', moves: [[0, 1], [-1, 0], [1, 0]] },
    eel: { name: 'Eel', moves: [[-1, 1], [1, 0], [-1, -1]] },
    cobra: { name: 'Cobra', moves: [[-1, 0], [1, 1], [1, -1]] },
  };
  const CARD_IDS = Object.keys(CARDS);
  const TEMPLE = [[2, 0], [2, SIZE - 1]]; // each seat's own arch: (x, y)

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const at = (x, y) => y * SIZE + x;
  const inside = (x, y) => x >= 0 && x < SIZE && y >= 0 && y < SIZE;

  function shuffle(a, rng) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // The squares a card moves a pawn by, as board steps [dx, dy], from the point of view of the board.
  function steps(card, seat) {
    const sign = seat === 0 ? 1 : -1;
    return CARDS[card].moves.map(([right, fwd]) => [right * sign || 0, fwd * sign || 0]); // `|| 0` keeps -0 out
  }

  function setup(names, starter, rng) {
    const board = Array(SIZE * SIZE).fill(null);
    for (const seat of [0, 1]) {
      const y = TEMPLE[seat][1];
      for (let x = 0; x < SIZE; x++) board[at(x, y)] = { p: seat, m: x === 2 };
    }
    const picks = shuffle(CARD_IDS.slice(), rng).slice(0, 5);
    return {
      phase: 'play',
      starter,
      active: starter,
      turn: 1,
      board,
      hands: [[picks[0], picks[1]], [picks[2], picks[3]]],
      side: picks[4],
      players: names.map((name) => ({ name })),
      last: null,
      end: null,
    };
  }

  function newGame(names, starter = 0, rng = Math.random) {
    const s = setup(names, starter, rng);
    s.wins = [0, 0]; // games won in this sitting
    return s;
  }

  // ---------- moves ----------
  // Every move `seat` can make: { card, from: [x, y], to: [x, y], capture }
  function legalMoves(s, seat) {
    const out = [];
    for (const card of s.hands[seat]) {
      const ds = steps(card, seat);
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          const piece = s.board[at(x, y)];
          if (!piece || piece.p !== seat) continue;
          for (const [dx, dy] of ds) {
            const tx = x + dx;
            const ty = y + dy;
            if (!inside(tx, ty)) continue;
            const target = s.board[at(tx, ty)];
            if (target && target.p === seat) continue;
            out.push({ card, from: [x, y], to: [tx, ty], capture: !!target });
          }
        }
      }
    }
    return out;
  }

  // Where one pawn can go with one card.
  function movesFor(s, seat, card, from) {
    return legalMoves(s, seat).filter((m) => m.card === card && m.from[0] === from[0] && m.from[1] === from[1]);
  }

  function swapCards(s, seat, used) {
    const hand = s.hands[seat];
    hand[hand.indexOf(used)] = s.side;
    s.side = used;
  }

  function apply(state, player, action, rng = Math.random) {
    const s = clone(state);
    const fail = (msg) => {
      throw new Error(msg);
    };
    if (action.type === 'rematch') {
      if (s.phase !== 'over') fail('The game is not over yet');
      const next = setup(s.players.map((p) => p.name), 1 - s.starter, rng);
      next.wins = s.wins.slice();
      return next;
    }
    if (s.phase !== 'play') fail('The game is over');
    if (player !== s.active) fail("It's not your turn");

    if (action.type === 'pass') {
      if (legalMoves(s, player).length) fail('You have a move to make');
      if (!s.hands[player].includes(action.card)) fail('That card is not in your hand');
      swapCards(s, player, action.card);
      s.last = { who: player, turn: s.turn, kind: 'pass', card: action.card };
    } else if (action.type === 'move') {
      const move = legalMoves(s, player).find((m) => m.card === action.card && m.from[0] === action.from[0] && m.from[1] === action.from[1] && m.to[0] === action.to[0] && m.to[1] === action.to[1]);
      if (!move) fail('That move is not allowed');
      const piece = s.board[at(move.from[0], move.from[1])];
      const target = s.board[at(move.to[0], move.to[1])];
      s.board[at(move.from[0], move.from[1])] = null;
      s.board[at(move.to[0], move.to[1])] = piece;
      s.last = { who: player, turn: s.turn, kind: 'move', card: move.card, from: move.from, to: move.to, capture: target ? (target.m ? 'master' : 'student') : null, master: piece.m };
      swapCards(s, player, move.card);
      const enemyArch = TEMPLE[1 - player];
      if (target && target.m) s.end = { winner: player, reason: 'stone' };
      else if (piece.m && move.to[0] === enemyArch[0] && move.to[1] === enemyArch[1]) s.end = { winner: player, reason: 'stream' };
    } else {
      fail('Unknown action');
    }

    if (s.end) {
      s.phase = 'over';
      s.wins[s.end.winner] += 1;
    } else {
      s.active = 1 - s.active;
      s.turn += 1;
    }
    return s;
  }

  // Nothing is hidden in Onitama.
  const viewFor = (s) => clone(s);

  const api = { SIZE, CARDS, CARD_IDS, TEMPLE, newGame, apply, viewFor, legalMoves, movesFor, steps, at, inside };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Onitama = api;
})(typeof window !== 'undefined' ? window : globalThis);
