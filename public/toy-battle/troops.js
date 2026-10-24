/* Troop and terrain-effect data for Toy Battle. The rules engine (game.js) reads everything from here.

   Taken from the official rulebook and player aid (Repos Production, 2025): the 8 troops with their strengths
   and effects, 3 copies of each per player, and what each terrain's special bases do. The wording below is my own.
   The board layouts themselves (boards.js) are NOT the physical boards: they are original designs. */
(function (root) {
  'use strict';

  const RULES = {
    rack: 8, // most troops a rack can hold
    copies: 3, // copies of each troop per player
    removed: 4, // troops removed unseen from each reserve at the start
    firstDraw: 3, // the starting player draws 3, the other player 4
    secondDraw: 4,
  };

  // strength: 1-7, or null for the joker. effect: the key game.js uses to resolve it ('hook' has no after-effect).
  const TROOPS = {
    kwak: {
      name: 'Kwak', strength: null, joker: true, effect: null,
      text: 'A joker with no effect. It can cover any enemy troop, but any enemy troop can cover it too.',
    },
    skully: { name: 'Skully', strength: 1, effect: 'draw2', text: 'You may draw 2 troops from your reserve (only 1 if you already hold 7).' },
    capn: { name: "Cap'n", strength: 2, effect: 'extra', text: 'You may place 1 extra troop and use its effect.' },
    jumbo: { name: 'Jumbo', strength: 3, effect: 'discardAdjacent', text: 'You may discard one visible enemy troop next to Jumbo, face up.' },
    hook: { name: 'Hook', strength: 4, effect: null, ignoresConnection: true, text: 'You may place Hook on any base, even one that is not connected to your H.Q.' },
    xb42: { name: 'XB-42', strength: 5, effect: 'steal', text: "You may take a random troop from your opponent's rack and discard it face up." },
    star: { name: 'Star', strength: 6, effect: 'draw1', text: 'You may draw 1 troop from your reserve.' },
    roxy: { name: 'Roxy', strength: 7, effect: null, text: 'The strongest troop, with no effect.' },
  };
  const TROOP_ORDER = ['kwak', 'skully', 'capn', 'jumbo', 'hook', 'xb42', 'star', 'roxy'];

  // What happens when a troop is placed on a special base (or what the terrain restricts).
  const TERRAIN_RULES = {
    castle: { name: 'Castle Field', baseEffect: 'castle', text: 'Special bases: you may take another of your troops off the board and put it back on your rack.' },
    pool: { name: 'Tropical Pool', baseEffect: null, text: 'Only troops with the indicated strengths can be placed on the special bases and on the H.Q.' },
    clouds: { name: 'City of Clouds', baseEffect: 'cloud', text: 'Special bases: you may draw 1 troop from your reserve.' },
    volcano: { name: 'Volcanic Jungle', baseEffect: 'volcano', text: 'Special bases: you may move an enemy troop next to this base to a base next to where it stands, ignoring the placement rules.' },
    cemetery: { name: 'Cursed Cemetery', baseEffect: 'cemetery', text: 'Special bases: you may take one of your troops from the discard back onto your rack.' },
    caribbean: { name: 'Caribbean Sea', baseEffect: null, text: 'No special bases, but unequal sides: two blue H.Q. against one red H.Q.' },
    metal: { name: 'Station Metal-X', baseEffect: null, text: 'Troop effects are not applied on the special bases.' },
    battlefield: { name: 'Battlefield', baseEffect: 'battlefield', text: "Special bases: a random troop on your opponent's rack is frozen: they cannot place it on their next turn." },
  };

  const api = { RULES, TROOPS, TROOP_ORDER, TERRAIN_RULES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ToyTroops = api;
})(typeof window !== 'undefined' ? window : globalThis);
