/* Card and table data for Hocus Pocus. The rules engine (game.js) reads everything from here.

   Sourced from Ravensburger's official rulebook (Disney Hocus Pocus: The Game, 2020): the 5
   Ingredient colours, the 5 Ingredient types, the deck size (50), the Binx/Spell Book special
   symbols, the 4 Trick tokens (names and exact effects), the stun conditions, and the win/lose
   conditions are all taken directly from it.

   Two things the rulebook doesn't spell out, so these are my own reasonable choices, flagged here
   rather than presented as official: the exact starting type+colour pairing on each of the 5
   cauldron spaces, and the full text of all 13 Spell cards (the rulebook names only two or three
   by example). The MECHANICAL shape of a spell — themed to one witch, one hindering effect, with
   exactly one "all three witches" spell that a stunned witch can never block — is faithful; the
   specific 13 effects here are invented to fill out a complete, playable set. */
(function (root) {
  'use strict';

  const COLORS = ['orange', 'purple', 'yellow', 'green', 'blue'];
  const TYPES = ['newtsaliva', 'oilofboil', 'deadmanstoe', 'thineowntongue', 'dashofpox'];
  const TYPE_NAMES = {
    newtsaliva: 'Newt Saliva', oilofboil: 'Oil of Boil', deadmanstoe: "Dead Man's Toe",
    thineowntongue: 'Thine Own Tongue', dashofpox: 'Dash of Pox',
  };
  const COLOR_NAMES = { orange: 'Orange', purple: 'Purple', yellow: 'Yellow', green: 'Green', blue: 'Blue' };

  const WITCHES = ['sarah', 'mary', 'winifred'];
  const WITCH_NAMES = { sarah: 'Sarah', mary: 'Mary', winifred: 'Winifred' };

  const RULES = {
    hand: 4, // this player count (2) always deals 4
    stunsToWin: 3,
  };

  // The 5 cauldron spaces: a starting type+colour pairing for when a pile is still empty.
  const CAULDRON_START = [
    { type: 'newtsaliva', color: 'orange' },
    { type: 'oilofboil', color: 'purple' },
    { type: 'deadmanstoe', color: 'yellow' },
    { type: 'thineowntongue', color: 'green' },
    { type: 'dashofpox', color: 'blue' },
  ];

  // 50 cards: every type x colour pair, twice over. 10 are marked special (5 Binx, 5 Spell Book) —
  // the rulebook gives a total of 50 cards but not an exact special-card count, so this split is
  // my own choice, picked to keep both symbols showing up at a reasonable, not overwhelming, rate.
  function buildDeck() {
    const cards = [];
    let n = 0;
    for (const type of TYPES) {
      for (const color of COLORS) {
        for (let copy = 0; copy < 2; copy++) cards.push({ id: `c${n++}`, type, color, special: null });
      }
    }
    // Deterministic placement (not random) so the special count is exact regardless of shuffle seed.
    const binxAt = [2, 11, 20, 33, 44];
    const bookAt = [5, 16, 27, 38, 47];
    binxAt.forEach((i) => (cards[i].special = 'binx'));
    bookAt.forEach((i) => (cards[i].special = 'book'));
    return cards;
  }

  // Each Trick token's exact effect and timing, per the rulebook.
  const TRICKS = {
    salt: { name: 'Circle of Salt', text: 'When a Spell is drawn, ignore it — discard it and do not draw another.' },
    daylight: { name: 'Daylight Savings Time', text: "Before playing a card: swap one card with the other player's hand." },
    billy: { name: 'Billy Butcherson', text: "Before playing a card: skip playing a card this turn. You don't draw at the end either." },
    burning: { name: 'Burning Rain of Death', text: 'Before playing a card: discard 3 cards and draw 3 replacements, then play and draw as normal.' },
  };

  // My own 13-spell set (see the file header): 4 per witch, plus one "all three" spell that's
  // never ignored even when a witch is stunned. Every effect is a short, clearly-defined hindrance.
  const SPELLS = [
    { id: 's1', witch: 'sarah', name: "Sarah's Whisper", effect: 'blockTricks', text: 'No Tricks may be used until another Spell is cast.' },
    { id: 's2', witch: 'sarah', name: 'Bewitched', effect: 'discard', amount: 1, text: 'Discard 1 card, then draw 1 to replace it.' },
    { id: 's3', witch: 'sarah', name: 'Black Flame', effect: 'revealHand', text: "The active player's hand is revealed until the round ends." },
    { id: 's4', witch: 'sarah', name: 'Moonlit Flight', effect: 'loseBinx', text: 'Binx is removed from play immediately.' },
    { id: 's5', witch: 'mary', name: "Mary's Giggle", effect: 'discard', amount: 2, text: 'Discard 2 cards, then draw 2 to replace them.' },
    { id: 's6', witch: 'mary', name: 'Nonsense Verse', effect: 'skipPlay', text: 'The active player skips playing this turn (they still draw at the end).' },
    { id: 's7', witch: 'mary', name: 'Candy Craving', effect: 'drawExtra', amount: 1, text: 'The active player draws 1 extra card right now.' },
    { id: 's8', witch: 'mary', name: 'Sisterly Spat', effect: 'swapRandom', text: "Swap a random card between the active player's hand and the other player's." },
    { id: 's9', witch: 'winifred', name: "Winifred's Wrath", effect: 'discard', amount: 3, text: 'Discard 3 cards, then draw 3 to replace them.' },
    { id: 's10', witch: 'winifred', name: 'Book of Spells', effect: 'extraSpell', text: 'Immediately draw and resolve one more Spell.' },
    { id: 's11', witch: 'winifred', name: 'Cease thy Prattle', effect: 'blockTricks', text: 'No Tricks may be used until another Spell is cast.' },
    { id: 's12', witch: 'winifred', name: 'One Last Death', effect: 'skipPlay', text: 'The active player skips playing this turn (they still draw at the end).' },
    { id: 's13', witch: null, name: 'Take Flight', effect: 'discard', amount: 2, text: 'All three witches cast this together — it is never blocked by a stun. Discard 2, draw 2.' },
  ];

  const api = { COLORS, TYPES, TYPE_NAMES, COLOR_NAMES, WITCHES, WITCH_NAMES, RULES, CAULDRON_START, buildDeck, TRICKS, SPELLS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HocusCards = api;
})(typeof window !== 'undefined' ? window : globalThis);
