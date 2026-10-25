/* Mancala (Kalah, six pits, four seeds each) rules engine: pure state + actions, no DOM. Works in the browser
   (window.Mancala) and in Node.

   Each player has six pits and a store. A turn: pick one of your pits that has seeds, pick them all up and drop them one
   at a time into the pits that follow, going round the board (your pits, your store, then the other player's pits; the
   other player's store is skipped).
     - If your last seed lands in YOUR STORE you go again.
     - If your last seed lands in an EMPTY pit of yours and the pit across from it has seeds, you capture both
       (that seed and the ones across) into your store.
   The game ends as soon as one player has no seeds left in their pits: the other player keeps the seeds still on their
   side, and the bigger store wins.

   pits[0..5] are seat 0's pits left to right, pits[6] their store; pits[7..12] are seat 1's and pits[13] their store. */
(function (root) {
  'use strict';

  const PITS = 6;
  const SEEDS = 4;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const store = (seat) => seat * 7 + 6;
  const first = (seat) => seat * 7;
  const across = (i) => 12 - i;

  function setup(names, starter) {
    const pits = Array(14).fill(SEEDS);
    pits[6] = 0;
    pits[13] = 0;
    return { phase: 'play', starter, active: starter, turn: 1, pits, players: names.map((name) => ({ name })), last: null, end: null };
  }

  function newGame(names, starter = 0) {
    const s = setup(names, starter);
    s.wins = [0, 0];
    s.draws = 0;
    return s;
  }

  const side = (pits, seat) => pits.slice(first(seat), first(seat) + PITS).reduce((a, b) => a + b, 0);

  // Plays one pit on a plain pits array (mutates it) and says what happened.
  function sow(pits, seat, pit) {
    const from = first(seat) + pit;
    let seeds = pits[from];
    pits[from] = 0;
    let at = from;
    const skip = store(1 - seat);
    while (seeds > 0) {
      at = (at + 1) % 14;
      if (at === skip) continue;
      pits[at] += 1;
      seeds -= 1;
    }
    const result = { extra: false, captured: 0, last: at };
    if (at === store(seat)) {
      result.extra = true;
    } else if (at >= first(seat) && at < first(seat) + PITS && pits[at] === 1 && pits[across(at)] > 0) {
      result.captured = pits[across(at)] + 1;
      pits[store(seat)] += result.captured;
      pits[at] = 0;
      pits[across(at)] = 0;
    }
    return result;
  }

  const legalPits = (s, seat) => {
    if (s.phase !== 'play' || s.active !== seat) return [];
    const out = [];
    for (let i = 0; i < PITS; i++) if (s.pits[first(seat) + i] > 0) out.push(i);
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
    if (s.phase !== 'play') fail('The game is over');
    if (player !== s.active) fail("It's not your turn");
    if (action.type !== 'sow') fail('Unknown action');
    if (!Number.isInteger(action.pit) || action.pit < 0 || action.pit >= PITS) fail('There is no such pit');
    if (s.pits[first(player) + action.pit] === 0) fail('That pit is empty');

    const seeds = s.pits[first(player) + action.pit];
    const r = sow(s.pits, player, action.pit);
    s.last = { who: player, turn: s.turn, pit: action.pit, seeds, extra: r.extra, captured: r.captured };
    s.turn += 1;

    // the game ends the moment either side runs out
    if (side(s.pits, 0) === 0 || side(s.pits, 1) === 0) {
      for (const seat of [0, 1]) {
        s.pits[store(seat)] += side(s.pits, seat);
        for (let i = 0; i < PITS; i++) s.pits[first(seat) + i] = 0;
      }
      const a = s.pits[6];
      const b = s.pits[13];
      s.phase = 'over';
      s.end = { scores: [a, b], winner: a === b ? null : a > b ? 0 : 1 };
      if (s.end.winner == null) s.draws += 1; else s.wins[s.end.winner] += 1;
      return s;
    }
    if (!r.extra) s.active = 1 - player;
    return s;
  }

  const viewFor = (s) => clone(s); // nothing is hidden

  const api = { PITS, SEEDS, newGame, apply, viewFor, legalPits, sow, store, first, across, side };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Mancala = api;
})(typeof window !== 'undefined' ? window : globalThis);
