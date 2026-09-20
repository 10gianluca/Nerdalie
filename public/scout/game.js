/* Scout rules engine (the official 2-player variant): pure state + actions, no DOM.
   Works in the browser (window.Scout) and Node.

   Every card has two numbers, one at each end. A hand card is { id, up, down }: `up` is the number in play,
   `down` the one at the other end. The order of a hand never changes except by inserting a scouted card. */
(function (root) {
  'use strict';

  const RULES = {
    hand: 11, // cards dealt to each player per round
    chips: 3, // scout chips per player per round; every Scout costs one, unspent chips score
    rounds: 2, // the 2-player game lasts two rounds, each using half of the deck
    low: 1,
    high: 10,
  };

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const swap = (c) => ({ id: c.id, up: c.down, down: c.up });

  // Turning a whole hand upside down also reverses its order left to right.
  const flipHand = (hand) => hand.map(swap).reverse();

  // 45 cards, one for every pair of different numbers 1-10, minus the 9/10 card in a 2-player game.
  function buildDeck() {
    const deck = [];
    for (let a = RULES.low; a <= RULES.high; a++) {
      for (let b = a + 1; b <= RULES.high; b++) {
        if (!(a === 9 && b === 10)) deck.push({ id: `${a}-${b}`, a, b });
      }
    }
    return deck;
  }

  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // Dealt cards land in a random orientation.
  const deal = (cards, rng) => cards.map((c) => (rng() < 0.5 ? { id: c.id, up: c.a, down: c.b } : { id: c.id, up: c.b, down: c.a }));

  // A group of cards is a set (all the same number) or a run (consecutive numbers, rising or falling).
  function classify(cards) {
    const v = cards.map((c) => c.up);
    if (!v.length) return null;
    if (v.every((x) => x === v[0])) return { kind: 'set', count: v.length, value: v[0] };
    const rising = v.every((x, i) => i === 0 || x === v[i - 1] + 1);
    const falling = v.every((x, i) => i === 0 || x === v[i - 1] - 1);
    if (rising || falling) return { kind: 'run', count: v.length, value: Math.min(...v) };
    return null;
  }

  // Does `next` beat the set on the table? More cards; then a set over a run; then a higher number.
  function beats(next, table) {
    if (!table) return true;
    if (next.count !== table.count) return next.count > table.count;
    if (next.kind !== table.kind) return next.kind === 'set';
    return next.value > table.value;
  }

  // Every range of neighbouring cards in `hand` that could be shown right now.
  function legalShows(hand, table) {
    const out = [];
    for (let i = 0; i < hand.length; i++) {
      for (let j = i; j < hand.length; j++) {
        const cls = classify(hand.slice(i, j + 1));
        if (cls && beats(cls, table)) out.push({ from: i, to: j, ...cls });
      }
    }
    return out;
  }
  const canShow = (hand, table) => legalShows(hand, table).length > 0;

  // Why these cards cannot be shown, or null if they can.
  function showProblem(cards, table) {
    if (!cards.length) return 'Pick the cards you want to show';
    const cls = classify(cards);
    if (!cls) return 'Those cards need to be a set (all the same number) or a run (numbers in a row)';
    if (!beats(cls, table)) {
      return `It has to beat the set on the table: more cards, or a set instead of a run, or a higher number`;
    }
    return null;
  }

  function startRound(s, cardsA, cardsB, rng) {
    s.players[0].hand = deal(cardsA, rng);
    s.players[1].hand = deal(cardsB, rng);
    for (const p of s.players) {
      p.won = [];
      p.chips = RULES.chips;
      p.ready = false;
    }
    s.table = null;
    s.phase = 'orient'; // each player looks at their hand and may turn it upside down before play starts
    s.last = null;
    s.roundResult = null;
  }

  function newGame(names, starter = 0, rng = Math.random) {
    const deck = shuffle(buildDeck(), rng);
    const per = RULES.hand;
    const s = {
      players: names.map((name) => ({ name, hand: [], won: [], chips: RULES.chips, ready: false })),
      reserve: deck.slice(per * 2), // the other half of the deck, dealt for round 2
      table: null, // { owner, cards, kind, count, value }: the active set
      firstStarter: starter,
      roundStarter: starter,
      active: starter,
      round: 1,
      phase: 'orient', // orient -> play -> roundover -> orient (round 2) -> play -> over
      turn: 1,
      last: null,
      roundResult: null,
      history: [],
      totals: [0, 0],
      end: null,
    };
    startRound(s, deck.slice(0, per), deck.slice(per, per * 2), rng);
    return s;
  }

  // A player who is stuck (cannot show, no chips to scout with) ends the round.
  function checkStuck(s) {
    if (s.phase !== 'play' || !s.table) return;
    const me = s.players[s.active];
    if (me.chips === 0 && !canShow(me.hand, s.table)) endRound(s, 'stuck', s.active);
  }

  // Scoring: cards you won + unspent chips - cards left in hand. The owner of the active set at the end
  // (the player nobody could beat, or the one who just went out) does not lose points for their hand.
  function endRound(s, reason, stuckSeat) {
    const owner = s.table ? s.table.owner : null;
    const players = s.players.map((p, i) => {
      const penalty = i === owner ? 0 : p.hand.length;
      return { won: p.won.length, chips: p.chips, penalty, total: p.won.length + p.chips - penalty };
    });
    s.totals = s.totals.map((t, i) => t + players[i].total);
    s.roundResult = { round: s.round, reason, owner, stuck: stuckSeat == null ? null : stuckSeat, players };
    s.history.push(s.roundResult);
    if (s.round >= RULES.rounds) {
      s.phase = 'over';
      s.end = { winner: s.totals[0] === s.totals[1] ? null : s.totals[0] > s.totals[1] ? 0 : 1 };
    } else {
      s.phase = 'roundover';
    }
  }

  // Returns a new state; throws Error(message) for illegal actions.
  function apply(state, player, action, rng = Math.random) {
    const s = clone(state);
    const fail = (msg) => {
      throw new Error(msg);
    };
    if (!s.players[player]) fail('Unknown player');
    const me = s.players[player];
    const needTurn = () => {
      if (s.phase !== 'play' || s.active !== player) fail("It's not your turn");
    };

    switch (action.type) {
      case 'ready': {
        if (s.phase !== 'orient') fail('The round has already started');
        if (me.ready) fail('You are already ready');
        if (action.flip) me.hand = flipHand(me.hand);
        me.ready = true;
        if (s.players.every((p) => p.ready)) {
          s.phase = 'play';
          s.active = s.roundStarter;
          s.turn = 1;
        }
        break;
      }
      case 'show': {
        needTurn();
        const { from, to } = action;
        if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to >= me.hand.length) {
          fail('Pick cards that are next to each other in your hand');
        }
        const cards = me.hand.slice(from, to + 1);
        const problem = showProblem(cards, s.table);
        if (problem) fail(problem);
        const cls = classify(cards);
        const captured = s.table ? s.table.cards.length : 0;
        if (s.table) me.won.push(...s.table.cards);
        me.hand.splice(from, to - from + 1);
        s.table = { owner: player, cards, ...cls };
        s.last = { turn: s.turn, kind: 'show', who: player, cards, captured };
        s.turn++;
        if (!me.hand.length) {
          endRound(s, 'empty', null);
          break;
        }
        s.active = 1 - player;
        checkStuck(s);
        break;
      }
      case 'scout': {
        needTurn();
        if (!s.table) fail('There is no set to scout from');
        if (me.chips < 1) fail('You have no scout chips left');
        if (action.end !== 'left' && action.end !== 'right') fail('Scout the left or the right card');
        if (!Number.isInteger(action.insertAt) || action.insertAt < 0 || action.insertAt > me.hand.length) {
          fail('Pick where to put the card in your hand');
        }
        const cards = s.table.cards;
        const taken = action.end === 'left' ? cards.shift() : cards.pop();
        me.hand.splice(action.insertAt, 0, action.flip ? swap(taken) : taken);
        me.chips--;
        s.last = { turn: s.turn, kind: 'scout', who: player, card: taken, end: action.end };
        s.turn++;
        if (cards.length) Object.assign(s.table, classify(cards));
        else s.table = null; // the whole set was scouted away; the same player must now show anything
        checkStuck(s); // the same player keeps going until they show or run out of chips
        break;
      }
      case 'next': {
        if (s.phase !== 'roundover') fail('The round is still running');
        s.round++;
        s.roundStarter = 1 - s.roundStarter;
        s.active = s.roundStarter;
        const per = RULES.hand;
        startRound(s, s.reserve.slice(0, per), s.reserve.slice(per, per * 2), rng);
        s.reserve = [];
        break;
      }
      case 'rematch': {
        if (s.phase !== 'over') fail('The game is still running');
        return newGame(s.players.map((p) => p.name), 1 - s.firstStarter, rng);
      }
      default:
        fail('Unknown action');
    }
    return s;
  }

  // What a given player may see: the other hand, and the cards won, are hidden. Cards on the table are public.
  function viewFor(state, player) {
    const v = clone(state);
    v.reserveCount = v.reserve.length;
    v.reserve = null;
    v.players.forEach((p, i) => {
      if (i === player) return;
      p.hand = p.hand.map(() => null);
      p.won = p.won.map(() => null);
    });
    return v;
  }

  const api = {
    RULES, classify, beats, legalShows, canShow, showProblem, flipHand, newGame, apply, viewFor,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Scout = api;
})(typeof window !== 'undefined' ? window : globalThis);
