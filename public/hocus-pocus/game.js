/* Hocus Pocus rules engine (2 players, cooperative): pure state + actions, no DOM.
   Works in the browser (window.HocusPocus) and Node.

   Only the active player ever acts; the other player watches live (and sees the active player's
   hand too, while Binx is on them). Card ids are opaque strings; look them up via s.index. */
(function (root) {
  'use strict';

  const C = typeof module !== 'undefined' && module.exports ? require('./cards.js') : root.HocusCards;
  const { COLORS, TYPES, RULES, CAULDRON_START, TRICKS, SPELLS } = C;

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const shuffle = (a, rng) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const other = (seat) => 1 - seat;

  function buildIndex(deck) {
    const idx = {};
    deck.forEach((c) => (idx[c.id] = c));
    return idx;
  }

  const pileTop = (s, pile) => (s.cauldron[pile].length ? s.index[s.cauldron[pile][s.cauldron[pile].length - 1]] : CAULDRON_START[pile]);

  function canPlayOn(s, cardId, pile) {
    const card = s.index[cardId];
    const top = pileTop(s, pile);
    return card.type === top.type || card.color === top.color;
  }

  function legalPlays(s, seat) {
    const hand = s.players[seat].hand;
    const moves = [];
    for (const cardId of hand) for (let pile = 0; pile < 5; pile++) if (canPlayOn(s, cardId, pile)) moves.push({ cardId, pile });
    return moves;
  }

  // The 3 stun conditions, checked against the 5 piles' current top cards.
  function checkStun(s) {
    const tops = s.cauldron.map((_, i) => pileTop(s, i));
    const colorsMatch = tops.every((t) => t.color === tops[0].color);
    const typesMatch = tops.every((t) => t.type === tops[0].type);
    const distinctColors = new Set(tops.map((t) => t.color)).size;
    if (colorsMatch) return 'sarah';
    if (typesMatch && distinctColors === 5) return 'winifred';
    if (typesMatch) return 'mary';
    return null;
  }

  const log = (s, text) => s.log.push({ turn: s.turn, text });

  function newGame(names, starter = 0, rng = Math.random) {
    const deck = shuffle(C.buildDeck(), rng);
    const index = buildIndex(deck);
    const s = {
      players: names.map((name) => ({ name, hand: [] })),
      index,
      deck: deck.map((c) => c.id),
      discard: [],
      removed: [], // permanently out of the game (round-end cleanup)
      cauldron: [[], [], [], [], []],
      spellDeck: shuffle(SPELLS.map((sp) => sp.id), rng),
      spellDiscard: [],
      binxHolder: null,
      stunnedWitch: null,
      sun: 0,
      tricksUsed: { salt: false, daylight: false, billy: false, burning: false },
      blockAsk: false,
      skipPlayThisTurn: false,
      starter,
      active: starter,
      round: 1,
      turn: 1,
      phase: 'ask',
      lastAsk: null,
      pendingDiscard: null, // { min, max, reason: 'cantPlay' | 'spell' }
      pendingSpell: null, // a drawn spell awaiting a Circle-of-Salt decision
      justStunned: false,
      pendingStunWitch: null,
      log: [],
      end: null,
    };
    for (const p of s.players) for (let i = 0; i < RULES.hand; i++) p.hand.push(s.deck.pop());
    log(s, `${s.players[starter].name} goes first.`);
    beginTurn(s);
    return s;
  }

  function beginTurn(s) {
    s.phase = s.blockAsk ? 'trick' : 'ask';
    if (s.blockAsk) log(s, 'Asking is still blocked by a spell — no question this turn.');
  }

  // A mandatory draw of `n` cards (for a discard-and-replace step). If the deck can't supply them
  // all, the game ends as a loss — exactly the rulebook's "forced to draw and cannot" condition. A
  // plain end-of-turn draw (drawOne) is never forced this way; it just silently no-ops instead.
  function forcedDraw(s, seat, n) {
    if (s.deck.length < n) {
      s.phase = 'over';
      s.end = { result: 'lose', reason: 'deck-empty' };
      log(s, 'The Ingredient deck is empty and a Spell demands more cards — the potion is complete. You lose.');
      return false;
    }
    for (let i = 0; i < n; i++) s.players[seat].hand.push(s.deck.pop());
    return true;
  }

  function drawOne(s, seat) {
    if (!s.deck.length) {
      log(s, `${s.players[seat].name} would draw, but the deck is empty.`);
      return;
    }
    s.players[seat].hand.push(s.deck.pop());
  }

  function resolveSpellEffect(s, seat, spell) {
    log(s, `Spell: ${spell.name} — ${spell.text}`);
    if (s.blockAsk) s.blockAsk = false; // "another Spell is cast" ends the standing block
    switch (spell.effect) {
      case 'blockAsk':
        s.blockAsk = true;
        break;
      case 'revealHand':
        s.binxHolder = seat;
        break;
      case 'loseBinx':
        s.binxHolder = null;
        break;
      case 'skipPlay':
        s.skipPlayThisTurn = true;
        break;
      case 'drawExtra':
        forcedDraw(s, seat, spell.amount);
        break;
      case 'swapRandom': {
        const me = s.players[seat].hand;
        const them = s.players[other(seat)].hand;
        if (me.length && them.length) {
          const i = Math.floor(Math.random() * me.length);
          const j = Math.floor(Math.random() * them.length);
          [me[i], them[j]] = [them[j], me[i]];
        }
        break;
      }
      case 'extraSpell':
        drawSpell(s, seat);
        break;
      case 'discard':
        s.pendingDiscard = { min: spell.amount, max: spell.amount, reason: 'spell' };
        break;
      default:
        break;
    }
  }

  // Draws the top Spell card. If it belongs to the currently-stunned witch it misses entirely (no
  // effect, no replacement draw). Otherwise, unless Circle of Salt has already been spent, it waits
  // in `pendingSpell` for the active player to choose: salt it away, or let it resolve.
  function drawSpell(s, seat) {
    if (!s.spellDeck.length) s.spellDeck = shuffle(s.spellDiscard.splice(0), Math.random);
    const id = s.spellDeck.pop();
    const spell = SPELLS.find((sp) => sp.id === id);
    s.spellDiscard.push(id);
    if (spell.witch && spell.witch === s.stunnedWitch) {
      log(s, `Spell drawn: ${spell.name} — but ${C.WITCH_NAMES[spell.witch]} is stunned, so it misses!`);
      return;
    }
    if (s.tricksUsed.salt) {
      resolveSpellEffect(s, seat, spell);
      return;
    }
    s.pendingSpell = spell; // offer Circle of Salt before it resolves
  }

  // Shared tail for "a Spell was drawn (from a Book card or a failed play) and has now either
  // resolved, missed, or finished its discard-and-replace step": continues the turn from here.
  function finishSpellResolution(s) {
    if (s.phase === 'over' || s.pendingDiscard || s.pendingSpell) return;
    afterPlayOrSkip(s);
  }

  function afterPlayOrSkip(s) {
    if (s.phase === 'over') return;
    if (s.skipPlayThisTurn) {
      // a Spell told this player to skip playing; they still draw normally at the end.
      s.skipPlayThisTurn = false;
    }
    drawOne(s, s.active);
    endTurnOrRound(s);
  }

  function endTurnOrRound(s) {
    const stunned = s.justStunned;
    s.justStunned = false;
    if (stunned) {
      roundEnd(s);
      if (s.phase === 'over') return;
    }
    s.active = other(s.active);
    s.turn++;
    beginTurn(s);
  }

  function roundEnd(s) {
    const witch = s.pendingStunWitch;
    s.pendingStunWitch = null;
    s.sun++;
    log(s, `${C.WITCH_NAMES[witch]} is stunned! The sun climbs (${s.sun}/${RULES.stunsToWin}).`);
    s.stunnedWitch = witch;
    s.blockAsk = false; // ongoing Spell effects end immediately
    if (s.sun >= RULES.stunsToWin) {
      s.phase = 'over';
      s.end = { result: 'win' };
      log(s, 'The sun rises! The Sanderson sisters are defeated. You win!');
      return;
    }
    const pool = [...s.cauldron.flat(), ...s.discard];
    const specials = pool.filter((id) => s.index[id].special);
    const plain = pool.filter((id) => !s.index[id].special);
    s.removed.push(...plain);
    s.deck = shuffle([...s.deck, ...specials], Math.random);
    s.cauldron = [[], [], [], [], []];
    s.discard = [];
    s.binxHolder = null;
    s.round++;
    log(s, `Round ${s.round} begins. ${plain.length} ingredient${plain.length === 1 ? '' : 's'} removed from the game for good; ${specials.length} special card${specials.length === 1 ? '' : 's'} shuffled back in.`);
  }

  // Returns a new state; throws Error(message) for illegal actions.
  function apply(state, player, action, rng = Math.random) {
    const s = clone(state);
    const fail = (msg) => {
      throw new Error(msg);
    };
    if (!s.players[player]) fail('Unknown player');
    if (s.phase === 'over' && action.type !== 'rematch') fail('The game is over');
    if (action.type !== 'rematch' && player !== s.active) fail("It's not your turn");
    const me = s.players[player];

    switch (action.type) {
      case 'ask': {
        if (s.phase !== 'ask') fail('You cannot ask right now');
        if (!['color', 'type'].includes(action.kind)) fail('Ask about a color or a type');
        const list = action.kind === 'color' ? COLORS : TYPES;
        if (!list.includes(action.value)) fail('Not a real ' + action.kind);
        const theirHand = s.players[other(player)].hand.map((id) => s.index[id]);
        const answer = theirHand.some((c) => c[action.kind] === action.value);
        s.lastAsk = { kind: action.kind, value: action.value, answer };
        log(s, `${me.name} asks: who has ${action.kind === 'color' ? C.COLOR_NAMES[action.value] : C.TYPE_NAMES[action.value]}? ${s.players[other(player)].name} says ${answer ? 'yes' : 'no'}.`);
        s.phase = 'trick';
        break;
      }
      case 'skipTrick':
        if (s.phase !== 'trick') fail('Nothing to skip here');
        s.phase = 'play';
        break;
      case 'useTrick': {
        if (!(action.trick in TRICKS)) fail('Unknown trick');
        if (s.tricksUsed[action.trick]) fail('That trick has already been used this game');
        if (action.trick === 'salt') {
          if (s.phase !== 'spell' || !s.pendingSpell) fail('Circle of Salt only works right when a Spell is drawn');
          s.tricksUsed.salt = true;
          log(s, `${me.name} uses Circle of Salt — the Spell is ignored.`);
          s.pendingSpell = null;
          finishSpellResolution(s);
          break;
        }
        if (s.phase !== 'trick') fail('That trick can only be used before you play a card');
        s.tricksUsed[action.trick] = true;
        if (action.trick === 'billy') {
          log(s, `${me.name} uses Billy Butcherson — skips playing, and skips drawing, this turn.`);
          endTurnOrRound(s); // no play, no draw
          break;
        }
        if (action.trick === 'daylight') {
          const give = action.give;
          if (!me.hand.includes(give)) fail('Offer a card from your own hand');
          const them = s.players[other(player)];
          if (!them.hand.length) fail('The other player has no cards to swap');
          const j = Math.floor(rng() * them.hand.length);
          const theirCard = them.hand[j];
          me.hand = me.hand.filter((c) => c !== give);
          them.hand[j] = give;
          me.hand.push(theirCard);
          log(s, `${me.name} uses Daylight Savings Time — a blind swap with ${them.name}.`);
          s.phase = 'play';
          break;
        }
        if (action.trick === 'burning') {
          const cards = action.discard || [];
          if (cards.length !== 3) fail('Burning Rain of Death discards exactly 3 cards');
          if (!cards.every((c) => me.hand.includes(c))) fail('Those cards are not all in your hand');
          me.hand = me.hand.filter((c) => !cards.includes(c));
          s.discard.push(...cards);
          log(s, `${me.name} uses Burning Rain of Death — discards 3 and draws 3.`);
          if (!forcedDraw(s, player, 3)) break;
          s.phase = 'play';
          break;
        }
        break;
      }
      case 'continueFromSpell': {
        if (s.phase !== 'spell' || !s.pendingSpell) fail('No spell is waiting');
        const spell = s.pendingSpell;
        s.pendingSpell = null;
        resolveSpellEffect(s, player, spell);
        finishSpellResolution(s);
        break;
      }
      case 'play': {
        if (s.phase !== 'play') fail('You cannot play a card right now');
        if (!me.hand.includes(action.cardId)) fail('That card is not in your hand');
        if (action.pile == null || action.pile < 0 || action.pile > 4) fail('Pick a cauldron pile (0-4)');
        if (!canPlayOn(s, action.cardId, action.pile)) fail("That card doesn't match that pile");
        const card = s.index[action.cardId];
        me.hand = me.hand.filter((c) => c !== action.cardId);
        s.cauldron[action.pile].push(action.cardId);
        log(s, `${me.name} plays ${C.TYPE_NAMES[card.type]} (${C.COLOR_NAMES[card.color]}) onto pile ${action.pile + 1}.`);
        const stunWitch = checkStun(s);
        if (stunWitch) {
          s.justStunned = true;
          s.pendingStunWitch = stunWitch;
          afterPlayOrSkip(s); // the special symbol is ignored: the round ends before it can fire
          break;
        }
        if (card.special === 'binx') {
          s.binxHolder = action.binxTo === other(player) ? other(player) : player;
          log(s, `Binx is placed with ${s.players[s.binxHolder].name} — their hand is revealed.`);
          afterPlayOrSkip(s);
        } else if (card.special === 'book') {
          s.phase = 'spell';
          drawSpell(s, player);
          finishSpellResolution(s);
        } else {
          afterPlayOrSkip(s);
        }
        break;
      }
      case 'cannotPlay': {
        if (s.phase !== 'play') fail('You cannot do that right now');
        if (legalPlays(s, player).length) fail('You do have a legal play — you must make it');
        s.phase = 'spell';
        drawSpell(s, player);
        finishSpellResolution(s);
        break;
      }
      case 'discard': {
        if (!s.pendingDiscard) fail('Nothing to discard right now');
        const { min, max } = s.pendingDiscard;
        const cards = action.cardIds || [];
        if (cards.length < min || cards.length > max) fail(min === max ? `Discard exactly ${min}` : `Discard at least ${min}`);
        if (!cards.every((c) => me.hand.includes(c))) fail('Those cards are not all in your hand');
        me.hand = me.hand.filter((c) => !cards.includes(c));
        s.discard.push(...cards);
        s.pendingDiscard = null;
        if (!forcedDraw(s, player, cards.length)) break;
        log(s, `${me.name} discards ${cards.length} and draws ${cards.length}.`);
        finishSpellResolution(s);
        break;
      }
      case 'rematch': {
        if (s.phase !== 'over') fail('The game is still running');
        return newGame(s.players.map((p) => p.name), other(s.starter), rng);
      }
      default:
        fail('Unknown action');
    }
    return s;
  }

  // What a given player may see: the other hand is hidden unless Binx (or its spell equivalent)
  // currently reveals it; any card id not visible anywhere this player can look is stripped out.
  function viewFor(state, player) {
    const v = clone(state);
    v.deckCount = v.deck.length;
    v.deck = null;
    v.players.forEach((p, i) => {
      if (i !== player && v.binxHolder !== i) p.hand = p.hand.map(() => null);
    });
    const visibleIds = new Set([...v.cauldron.flat(), ...v.discard, ...v.removed, ...v.players.flatMap((p) => p.hand.filter(Boolean))]);
    v.index = Object.fromEntries(Object.entries(state.index).filter(([id]) => visibleIds.has(id)));
    return v;
  }

  const api = { RULES, newGame, apply, viewFor, legalPlays, checkStun, pileTop, canPlayOn };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HocusPocus = api;
})(typeof window !== 'undefined' ? window : globalThis);
