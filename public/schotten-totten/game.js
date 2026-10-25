/* Schotten Totten rules engine: pure state + actions, no DOM. Works in the browser (window.Schotten) and in Node.

   Nine border stones lie between two players. There are 54 clan cards, six colours numbered 1 to 9. On your turn you
   play one card from your hand to your side of any stone that isn't won yet (three cards per side at most), then draw.

   Each side of a stone ends up as a formation of three cards. From best to worst:
     colour run (same colour, consecutive numbers), three of a kind, colour (same colour), run (consecutive numbers),
     sum (anything else). The same kind of formation is settled by the higher total, and if that is level too, by whoever
     finished their three cards first.

   A stone is won by the player whose formation can no longer be beaten, even by the cards that haven't been played yet.
   That is checked for you at the end of your turn and at the start of the next one. You win the game with five stones,
   or three stones side by side. Card ids are a colour letter and a number: 'R7', 'B1'. */
(function (root) {
  'use strict';

  const COLORS = ['R', 'O', 'Y', 'G', 'B', 'P'];
  const COLOR_NAMES = { R: 'Red', O: 'Orange', Y: 'Yellow', G: 'Green', B: 'Blue', P: 'Purple' };
  const STONES = 9;
  const HAND = 6;
  const RULES = { stones: STONES, hand: HAND, perSide: 3, winStones: 5, winAdjacent: 3 };
  const FORMATIONS = { 5: 'Colour run', 4: 'Three of a kind', 3: 'Colour', 2: 'Run', 1: 'Sum' };

  const ALL = [];
  for (const c of COLORS) for (let v = 1; v <= 9; v++) ALL.push(c + v);

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const parse = (id) => ({ color: id[0], value: Number(id.slice(1)) });

  function shuffle(a, rng) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---------- formations ----------
  // Three cards -> { type: 1..5, sum }
  function rankOf(ids) {
    const cards = ids.map(parse).sort((a, b) => a.value - b.value);
    const sameColor = cards.every((c) => c.color === cards[0].color);
    const run = cards[1].value === cards[0].value + 1 && cards[2].value === cards[1].value + 1;
    const three = cards[0].value === cards[1].value && cards[1].value === cards[2].value;
    const sum = cards[0].value + cards[1].value + cards[2].value;
    const type = sameColor && run ? 5 : three ? 4 : sameColor ? 3 : run ? 2 : 1;
    return { type, sum };
  }

  const compareRank = (a, b) => (a.type !== b.type ? a.type - b.type : a.sum - b.sum);

  // ---------- setup ----------
  function setup(names, starter, rng) {
    const deck = shuffle(ALL.slice(), rng);
    const hands = [deck.splice(0, HAND), deck.splice(0, HAND)];
    return {
      phase: 'play',
      starter,
      active: starter,
      turn: 1,
      deck,
      hands,
      stones: Array.from({ length: STONES }, () => ({ sides: [[], []], done: [0, 0], owner: null })),
      stamp: 1, // counts three-card sides as they are finished, so ties can go to whoever finished first
      players: names.map((name) => ({ name })),
      last: null,
      end: null,
    };
  }

  function newGame(names, starter = 0, rng = Math.random) {
    const s = setup(names, starter, rng);
    s.wins = [0, 0];
    settleTurn(s);
    return s;
  }

  // ---------- claiming ----------
  const onTable = (s) => s.stones.flatMap((st) => st.sides[0].concat(st.sides[1]));

  function best(sideCards, pool, need) {
    // the best formation `sideCards` could still become using `need` cards from `pool`
    let top = null;
    const pick = (from, chosen) => {
      if (chosen.length === need) {
        const r = rankOf(sideCards.concat(chosen));
        if (!top || compareRank(r, top) > 0) top = r;
        return;
      }
      for (let i = from; i < pool.length; i++) {
        chosen.push(pool[i]);
        pick(i + 1, chosen);
        chosen.pop();
      }
    };
    pick(0, []);
    return top;
  }

  // Can `seat` claim stone `k` right now: is their finished side impossible to beat?
  function provable(s, seat, k) {
    const st = s.stones[k];
    if (st.owner != null || st.sides[seat].length < 3) return false;
    const opp = 1 - seat;
    const mine = rankOf(st.sides[seat]);
    if (st.sides[opp].length === 3) {
      const c = compareRank(mine, rankOf(st.sides[opp]));
      return c > 0 || (c === 0 && st.done[seat] < st.done[opp]);
    }
    // The other side is unfinished. Cards you hold yourself can't turn up there; everything else not on the table could.
    const known = new Set(onTable(s).concat(s.hands[seat]));
    const pool = ALL.filter((id) => !known.has(id));
    const need = 3 - st.sides[opp].length;
    const top = best(st.sides[opp], pool, need);
    // a tie goes to whoever finished first, and that is you
    return !top || compareRank(mine, top) >= 0;
  }

  function winner(s) {
    const owners = s.stones.map((st) => st.owner);
    for (const seat of [0, 1]) {
      if (owners.filter((o) => o === seat).length >= RULES.winStones) return { winner: seat, reason: 'five' };
      for (let i = 0; i + 2 < STONES; i++) if (owners[i] === seat && owners[i + 1] === seat && owners[i + 2] === seat) return { winner: seat, reason: 'adjacent' };
    }
    return null;
  }

  // Claims every stone `seat` is entitled to, and notes which in s.last.claimed.
  function claims(s, seat) {
    const got = [];
    for (let k = 0; k < STONES; k++) if (provable(s, seat, k)) { s.stones[k].owner = seat; got.push(k); }
    return got;
  }

  const playsOf = (s, seat) => {
    const out = [];
    for (const card of s.hands[seat]) {
      for (let k = 0; k < STONES; k++) if (s.stones[k].owner == null && s.stones[k].sides[seat].length < 3) out.push({ card, stone: k });
    }
    return out;
  };

  function finish(s, result) {
    s.phase = 'over';
    s.end = result;
    s.wins[result.winner] += 1;
  }

  // The start of the active player's turn: they claim what they can, and are skipped if they have nothing to play.
  function settleTurn(s) {
    for (let guard = 0; guard < 4 && s.phase === 'play'; guard++) {
      const got = claims(s, s.active);
      if (got.length) {
        s.last = { ...(s.last || {}), startClaims: { who: s.active, stones: got } };
        const w = winner(s);
        if (w) return finish(s, w);
      }
      if (playsOf(s, s.active).length) return undefined;
      s.active = 1 - s.active; // nothing to play: pass
      s.turn += 1;
    }
    return undefined;
  }

  // ---------- actions ----------
  const legalPlays = (s, seat) => (s.phase === 'play' && s.active === seat ? playsOf(s, seat) : []);

  function apply(state, player, action, rng = Math.random) {
    const s = clone(state);
    const fail = (msg) => {
      throw new Error(msg);
    };
    if (action.type === 'rematch') {
      if (s.phase !== 'over') fail('The game is not over yet');
      const next = setup(s.players.map((p) => p.name), 1 - s.starter, rng);
      next.wins = s.wins.slice();
      settleTurn(next);
      return next;
    }
    if (s.phase !== 'play') fail('The game is over');
    if (player !== s.active) fail("It's not your turn");
    if (action.type !== 'play') fail('Unknown action');
    if (!s.hands[player].includes(action.card)) fail('That card is not in your hand');
    const stone = s.stones[action.stone];
    if (!stone) fail('There is no such stone');
    if (stone.owner != null) fail('That stone has already been won');
    if (stone.sides[player].length >= 3) fail('Your side of that stone is full');

    s.hands[player].splice(s.hands[player].indexOf(action.card), 1);
    stone.sides[player].push(action.card);
    if (stone.sides[player].length === 3) stone.done[player] = s.stamp++;

    s.last = { who: player, turn: s.turn, card: action.card, stone: action.stone, claimed: [] };
    const got = claims(s, player);
    s.last.claimed = got;
    const w = winner(s);
    if (w) {
      finish(s, w);
      return s;
    }
    if (s.deck.length) s.hands[player].push(s.deck.shift());
    s.active = 1 - player;
    s.turn += 1;
    settleTurn(s);
    return s;
  }

  // ---------- what a player is allowed to see ----------
  function viewFor(s, seat) {
    const v = clone(s);
    v.deckCount = s.deck.length;
    delete v.deck;
    v.handCounts = s.hands.map((h) => h.length);
    v.hands = s.hands.map((h, i) => (i === seat ? h : []));
    return v;
  }

  const api = { COLORS, COLOR_NAMES, ALL, RULES, FORMATIONS, STONES, parse, rankOf, compareRank, newGame, apply, viewFor, legalPlays, provable, best, onTable };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Schotten = api;
})(typeof window !== 'undefined' ? window : globalThis);
