/* Computer opponent for Qwinto. It only looks at what its own player may see (game.viewFor), picks the
   action the rules engine would accept next, and returns null when it is waiting on the human.

   Method: score a sheet (points now + how much room is left in every row), then for each decision average
   that score over every possible dice sum. Dice choice, reroll-or-keep and where to write all use it. */
(function (root) {
  'use strict';

  const G = typeof module !== 'undefined' && module.exports ? require('./game.js') : root.Qwinto;
  const { COLORS, LAYOUT, MAX_FAILS, FAIL_PENALTY } = G;

  const MAX_SUM = 18;

  // A row needs strictly rising numbers, so every run of empty cells between two written numbers
  // (or a number and the row's end) needs enough distinct values to fit. Missing room is a lost cell.
  function roomScore(sheet) {
    let room = 0;
    for (const color of COLORS) {
      let low = 0;
      let run = 0;
      const close = (high) => {
        const slack = high - low - 1 - run;
        room += slack < 0 ? slack * 2.5 : Math.min(slack, 4) * 0.35;
        run = 0;
      };
      for (const col of LAYOUT[color].cells) {
        const v = sheet[color][col];
        if (v == null) run++;
        else {
          close(v);
          low = v;
        }
      }
      close(MAX_SUM + 1);
    }
    return room;
  }

  const sheetValue = (sheet, fails) => G.score(sheet, fails).total + roomScore(sheet);

  function withEntry(sheet, color, col, n) {
    const next = { orange: sheet.orange.slice(), yellow: sheet.yellow.slice(), purple: sheet.purple.slice() };
    next[color][col] = n;
    return next;
  }

  // How the sum of k dice is distributed: sums[n] = number of the 6^k outcomes that add up to n.
  function sumCounts(k) {
    let counts = { 0: 1 };
    for (let i = 0; i < k; i++) {
      const next = {};
      for (const [sum, c] of Object.entries(counts)) {
        for (let d = 1; d <= 6; d++) next[+sum + d] = (next[+sum + d] || 0) + c;
      }
      counts = next;
    }
    return counts;
  }

  // Best thing to do with a given sum: a move, or (when allowed) passing. `active` players pay for failing.
  function bestEntry(player, colors, sum, active) {
    const base = sheetValue(player.sheet, player.fails);
    const moves = G.legalMoves(player.sheet, colors, sum);
    let best = active ? { pass: true, value: sheetValue(player.sheet, player.fails + 1) } : { pass: true, value: base };
    if (active && moves.length === 0 && player.fails + 1 >= MAX_FAILS) best.value -= FAIL_PENALTY;
    for (const m of moves) {
      const value = sheetValue(withEntry(player.sheet, m.color, m.col, sum), player.fails);
      if (value > best.value) best = { ...m, value };
    }
    return best;
  }

  function expectedValue(player, colors, active) {
    const counts = sumCounts(colors.length);
    let total = 0;
    let weight = 0;
    for (const [sum, c] of Object.entries(counts)) {
      total += bestEntry(player, colors, +sum, active).value * c;
      weight += c;
    }
    return total / weight;
  }

  function subsets(items) {
    const out = [];
    for (let mask = 1; mask < 1 << items.length; mask++) out.push(items.filter((_, i) => mask & (1 << i)));
    return out;
  }

  // Easy and normal players sometimes make a random (but legal) move instead of the best one they can see.
  const MISTAKES = { easy: 0.5, normal: 0.2, hard: 0 };

  function randomAction(view, seat, rng) {
    const active = view.active === seat;
    if (view.phase === 'choose' && active) return { type: 'roll' }; // roll the dice already picked
    if (view.phase === 'rolled' && active) return !view.rerolled && rng() < 0.5 ? { type: 'reroll' } : { type: 'keep' };
    if (view.phase === 'enter' && !view.pending[seat]) {
      const moves = G.legalMoves(view.players[seat].sheet, Object.keys(view.dice), G.sumDice(view.dice));
      if (!moves.length || rng() < 0.15) return { type: 'pass' };
      const m = moves[Math.floor(rng() * moves.length)];
      return { type: 'enter', color: m.color, col: m.col };
    }
    return null;
  }

  function best(view, seat) {
    const me = view.players[seat];
    const active = view.active === seat;

    if (view.phase === 'choose' && active) {
      let best = null;
      for (const colors of subsets(COLORS)) {
        const value = expectedValue(me, colors, true);
        if (!best || value > best.value) best = { colors, value };
      }
      const same = view.chosen.length === best.colors.length && best.colors.every((c) => view.chosen.includes(c));
      return same ? { type: 'roll' } : { type: 'choose', colors: best.colors };
    }

    if (view.phase === 'rolled' && active) {
      const colors = Object.keys(view.dice);
      const sum = G.sumDice(view.dice);
      const keep = bestEntry(me, colors, sum, true).value;
      if (!view.rerolled && expectedValue(me, colors, true) > keep + 0.25) return { type: 'reroll' };
      return { type: 'keep' };
    }

    if (view.phase === 'enter' && !view.pending[seat]) {
      const colors = Object.keys(view.dice);
      const best = bestEntry(me, colors, G.sumDice(view.dice), active);
      return best.pass ? { type: 'pass' } : { type: 'enter', color: best.color, col: best.col };
    }

    return null;
  }

  function choose(view, seat, rng = Math.random, level = 'hard') {
    if (rng() < (MISTAKES[level] || 0)) {
      const mistake = randomAction(view, seat, rng);
      if (mistake) return mistake;
    }
    return best(view, seat);
  }

  const api = { choose, sheetValue, roomScore };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QwintoBot = api;
})(typeof window !== 'undefined' ? window : globalThis);
