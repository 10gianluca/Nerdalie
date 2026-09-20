/* Qwinto rules engine: pure state + actions, no DOM. Works in the browser (window.Qwinto) and Node. */
(function (root) {
  'use strict';

  const COLORS = ['orange', 'yellow', 'purple'];
  const NUM_COLS = 12;
  // Column positions of each row's 9 fields. The rows are staggered exactly like the paper sheet.
  const LAYOUT = {
    orange: { cells: [2, 3, 4, 6, 7, 8, 9, 10, 11], pentagons: [3, 7] },
    yellow: { cells: [1, 2, 3, 4, 5, 7, 8, 9, 10], pentagons: [8] },
    purple: { cells: [0, 1, 2, 3, 5, 6, 7, 8, 9], pentagons: [2, 9] },
  };
  const BONUS_COLS = [2, 3, 7, 8, 9]; // the five columns with a field in all three rows
  const MAX_FAILS = 4;
  const FAIL_PENALTY = 5;

  const hasCell = (color, col) => LAYOUT[color].cells.includes(col);
  const isPentagon = (color, col) => LAYOUT[color].pentagons.includes(col);
  const clone = (o) => JSON.parse(JSON.stringify(o));

  function newSheet() {
    const sheet = {};
    for (const color of COLORS) sheet[color] = Array(NUM_COLS).fill(null);
    return sheet;
  }

  // Rows must strictly increase left to right; a column may not repeat a number.
  function canPlace(sheet, color, col, n) {
    if (!COLORS.includes(color) || !hasCell(color, col) || sheet[color][col] != null) return false;
    const row = sheet[color];
    for (let c = 0; c < NUM_COLS; c++) {
      const v = row[c];
      if (v == null) continue;
      if (c < col && v >= n) return false;
      if (c > col && v <= n) return false;
    }
    return COLORS.every((other) => other === color || sheet[other][col] !== n);
  }

  function legalMoves(sheet, colors, n) {
    const moves = [];
    for (const color of colors) {
      for (const col of LAYOUT[color].cells) {
        if (canPlace(sheet, color, col, n)) moves.push({ color, col });
      }
    }
    return moves;
  }

  const isRowComplete = (sheet, color) => LAYOUT[color].cells.every((c) => sheet[color][c] != null);
  const completeRows = (sheet) => COLORS.filter((c) => isRowComplete(sheet, c)).length;

  function score(sheet, fails) {
    const rows = {};
    for (const color of COLORS) {
      const cells = LAYOUT[color].cells;
      const filled = cells.filter((c) => sheet[color][c] != null).length;
      rows[color] = filled === cells.length ? sheet[color][cells[cells.length - 1]] : filled;
    }
    const bonuses = BONUS_COLS.map((col) => {
      if (!COLORS.every((color) => sheet[color][col] != null)) return null;
      return sheet[COLORS.find((color) => isPentagon(color, col))][col];
    });
    const penalty = fails * FAIL_PENALTY;
    const total =
      COLORS.reduce((t, c) => t + rows[c], 0) + bonuses.reduce((t, b) => t + (b || 0), 0) - penalty;
    return { rows, bonuses, penalty, total };
  }

  function newGame(names, starter = 0) {
    return {
      players: names.map((name) => ({ name, sheet: newSheet(), fails: 0 })),
      starter,
      active: starter,
      turn: 1,
      phase: 'choose', // choose -> rolled -> enter -> (next turn) ... -> over
      chosen: COLORS.slice(),
      dice: null, // e.g. { yellow: 4, purple: 5 } once rolled
      rollId: 0, // bumps on every roll so views can animate
      rerolled: false,
      pending: names.map(() => null), // per player: { color, col } | { pass: true }
      last: null, // summary of the previous turn
      end: null, // { reason: 'rows' | 'fails', player }
    };
  }

  const sumDice = (dice) => Object.values(dice).reduce((a, b) => a + b, 0);

  function rollChosen(s, rng) {
    s.dice = {};
    for (const color of s.chosen) s.dice[color] = 1 + Math.floor(rng() * 6);
    s.rollId++;
  }

  // Non-rolling players with nowhere to write the sum skip automatically.
  function openEntry(s) {
    s.phase = 'enter';
    const sum = sumDice(s.dice);
    const colors = Object.keys(s.dice);
    s.players.forEach((p, i) => {
      if (i !== s.active && legalMoves(p.sheet, colors, sum).length === 0) {
        s.pending[i] = { pass: true, auto: true };
      }
    });
  }

  function resolveTurn(s) {
    const sum = sumDice(s.dice);
    const entries = s.pending.map((p, i) => {
      if (p.pass) {
        const failed = i === s.active;
        if (failed) s.players[i].fails++;
        return { pass: true, auto: !!p.auto, failed };
      }
      s.players[i].sheet[p.color][p.col] = sum;
      return { color: p.color, col: p.col };
    });
    s.last = { turn: s.turn, active: s.active, dice: s.dice, sum, entries };

    const rowsDone = s.players.findIndex((p) => completeRows(p.sheet) >= 2);
    const failsDone = s.players.findIndex((p) => p.fails >= MAX_FAILS);
    if (rowsDone >= 0 || failsDone >= 0) {
      s.phase = 'over';
      s.end = rowsDone >= 0 ? { reason: 'rows', player: rowsDone } : { reason: 'fails', player: failsDone };
      return;
    }
    s.active = (s.active + 1) % s.players.length;
    s.turn++;
    s.phase = 'choose';
    s.chosen = COLORS.slice();
    s.dice = null;
    s.rerolled = false;
    s.pending = s.players.map(() => null);
  }

  // Returns a new state; throws Error(message) for illegal actions.
  function apply(state, player, action, rng = Math.random) {
    const s = clone(state);
    const isActive = player === s.active;
    const fail = (msg) => {
      throw new Error(msg);
    };
    if (!s.players[player]) fail('Unknown player');

    switch (action.type) {
      case 'choose': {
        if (!isActive || s.phase !== 'choose') fail('Not your turn to pick dice');
        const colors = COLORS.filter((c) => (action.colors || []).includes(c));
        if (colors.length === 0) fail('Pick at least one die');
        s.chosen = colors;
        break;
      }
      case 'roll':
        if (!isActive || s.phase !== 'choose') fail('Not your turn to roll');
        rollChosen(s, rng);
        s.phase = 'rolled';
        break;
      case 'reroll':
        if (!isActive || s.phase !== 'rolled' || s.rerolled) fail('You can only reroll once');
        rollChosen(s, rng);
        s.rerolled = true;
        openEntry(s);
        break;
      case 'keep':
        if (!isActive || s.phase !== 'rolled') fail('Nothing to keep');
        openEntry(s);
        break;
      case 'enter': {
        if (s.phase !== 'enter' || s.pending[player]) fail('You cannot enter a number now');
        if (!Object.keys(s.dice).includes(action.color)) fail('That row does not match the rolled dice');
        if (!canPlace(s.players[player].sheet, action.color, action.col, sumDice(s.dice))) {
          fail('That number does not fit there');
        }
        s.pending[player] = { color: action.color, col: action.col };
        break;
      }
      case 'pass':
        if (s.phase !== 'enter' || s.pending[player]) fail('You cannot pass now');
        s.pending[player] = { pass: true };
        break;
      case 'rematch': {
        if (s.phase !== 'over') fail('The game is still running');
        const names = s.players.map((p) => p.name);
        return newGame(names, (s.starter + 1) % names.length);
      }
      default:
        fail('Unknown action');
    }

    if (s.phase === 'enter' && s.pending.every(Boolean)) resolveTurn(s);
    return s;
  }

  // What a given player may see: other players' unrevealed choices are hidden.
  function viewFor(state, player) {
    const v = clone(state);
    v.pending = v.pending.map((p, i) => (p && i !== player ? { hidden: true } : p));
    return v;
  }

  const api = {
    COLORS, NUM_COLS, LAYOUT, BONUS_COLS, MAX_FAILS, FAIL_PENALTY,
    hasCell, isPentagon, newSheet, canPlace, legalMoves, isRowComplete, completeRows,
    score, newGame, sumDice, apply, viewFor,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Qwinto = api;
})(typeof window !== 'undefined' ? window : globalThis);
