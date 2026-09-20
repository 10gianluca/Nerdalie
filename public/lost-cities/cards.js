/* Card data and table rules for Lost Cities. The rules engine (game.js) reads everything from here,
   so this is the one file to edit to change the deck or the scoring numbers. */
(function (root) {
  'use strict';

  const RULES = {
    hand: 8,
    wagers: 3, // handshake cards per expedition
    values: [2, 3, 4, 5, 6, 7, 8, 9, 10], // number cards per expedition
    cost: 20, // every started expedition begins at -20
    bonusCards: 8, // an expedition with this many cards or more earns the bonus
    bonus: 20,
    rounds: 3, // a match is played over this many rounds
  };

  // The five expeditions. `id` doubles as the card colour.
  const COLORS = [
    { id: 'yellow', name: 'Desert' },
    { id: 'blue', name: 'Ocean' },
    { id: 'white', name: 'Mountains' },
    { id: 'green', name: 'Jungle' },
    { id: 'red', name: 'Volcano' },
  ];

  const api = { RULES, COLORS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LostCards = api;
})(typeof window !== 'undefined' ? window : globalThis);
