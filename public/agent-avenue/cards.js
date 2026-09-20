/* Card data and table rules for Agent Avenue. The rules engine (game.js) reads everything from here,
   so this is the one file to edit to change the deck.

   icons: how far you move for the 1st, 2nd and 3rd-or-more copy of that agent in your play area.
          A negative number moves you backwards. A 3rd icon of 'win' or 'lose' means having 3 in play
          ends the game that way. Agents with a single icon only ever exist once. */
(function (root) {
  'use strict';

  const RULES = {
    board: 20, // spaces around the circular track (my assumption: the real board size isn't in the card list)
    startGap: 10, // clockwise distance from player 1's home space to player 2's (homes assumed opposite)
    hand: 4,
    swaps: 4, // times each player may discard a card face-down to redraw, per game
    setSize: 3, // copies needed for a 'win' / 'lose' agent to trigger
  };

  const TYPES = {
    doubleagent: { name: 'Double Agent', count: 6, icons: [-1, 6, -1] },
    enforcer: { name: 'Enforcer', count: 6, icons: [1, 2, 3] },
    codebreaker: { name: 'Codebreaker', count: 6, icons: [0, 0, 'win'] },
    saboteur: { name: 'Saboteur', count: 6, icons: [-1, -1, -2] },
    daredevil: { name: 'Daredevil', count: 6, icons: [2, 3, 'lose'] },
    sentinel: { name: 'Sentinel', count: 6, icons: [0, 2, 6] },
    sidekick: { name: 'Sidekick', count: 1, icons: [4] },
    mole: { name: 'Mole', count: 1, icons: [-3] },
  };

  const api = { RULES, TYPES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AgentCards = api;
})(typeof window !== 'undefined' ? window : globalThis);
