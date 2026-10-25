/* Jaipur rules engine: pure state + actions, no DOM. Works in the browser (window.Jaipur) and in Node.

   Two traders share a market of five cards. On your turn you do ONE of: take a goods card, take all the camels,
   swap cards with the market, or sell goods for tokens. A match is rounds until someone has two Seals of Excellence.

   A round ends when three kinds of goods token have run out, or when the market can't be refilled from the deck.
   Cards are just their type: 'diamond', 'gold', 'silver', 'cloth', 'spice', 'leather' and 'camel'. */
(function (root) {
  'use strict';

  const GOODS = ['diamond', 'gold', 'silver', 'cloth', 'spice', 'leather'];
  const PREMIUM = ['diamond', 'gold', 'silver']; // sold two or more at a time
  const COPIES = { diamond: 6, gold: 6, silver: 6, cloth: 8, spice: 8, leather: 10 };
  const CAMELS = 11;
  // Goods tokens, highest on top: selling takes from the top of the pile.
  const TOKENS = {
    diamond: [7, 7, 5, 5, 5],
    gold: [6, 6, 5, 5, 5],
    silver: [5, 5, 5, 5, 5],
    cloth: [5, 3, 3, 2, 2, 1, 1],
    spice: [5, 3, 3, 2, 2, 1, 1],
    leather: [4, 3, 2, 1, 1, 1, 1, 1, 1],
  };
  // Bonus tokens for selling 3, 4 or 5+ cards at once. They are shuffled and kept face down.
  const BONUS = { 3: [1, 1, 2, 2, 2, 3, 3], 4: [4, 4, 5, 5, 6, 6], 5: [8, 8, 9, 10, 10] };
  const RULES = { handLimit: 7, marketSize: 5, camelBonus: 5, sealsToWin: 2, premiumMin: 2, emptyPilesToEnd: 3, startCamels: 3, startHand: 5 };

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const perGood = (make) => Object.fromEntries(GOODS.map((g) => [g, make(g)]));
  const count = (list, what) => list.reduce((n, c) => n + (c === what ? 1 : 0), 0);
  const isGood = (c) => GOODS.includes(c);

  function shuffle(a, rng) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // The round's draw deck: every goods card, and the camels that did not start in the market.
  function buildDeck(rng) {
    const cards = [];
    for (const g of GOODS) for (let i = 0; i < COPIES[g]; i++) cards.push(g);
    for (let i = 0; i < CAMELS - RULES.startCamels; i++) cards.push('camel');
    return shuffle(cards, rng);
  }

  const deckLeft = (s) => (s.deck ? s.deck.length : s.deckCount);

  function newPlayer(name) {
    return { name, hand: [], herd: 0, tokens: perGood(() => []), bonus: [] };
  }

  // Deals a fresh round. `starter` goes first.
  function startRound(s, starter, rng) {
    const deck = buildDeck(rng);
    s.deck = deck;
    s.market = Array(RULES.startCamels).fill('camel');
    s.players.forEach((p) => {
      p.hand = [];
      p.herd = 0;
      p.tokens = perGood(() => []);
      p.bonus = [];
      for (let i = 0; i < RULES.startHand; i++) {
        const c = deck.pop();
        if (c === 'camel') p.herd += 1; else p.hand.push(c);
      }
    });
    while (s.market.length < RULES.marketSize) s.market.push(deck.pop());
    s.piles = perGood((g) => TOKENS[g].slice());
    s.bonusPiles = { 3: shuffle(BONUS[3].slice(), rng), 4: shuffle(BONUS[4].slice(), rng), 5: shuffle(BONUS[5].slice(), rng) };
    s.gone = perGood(() => 0); // goods cards sold so far (public), so a player can work out what is still unseen
    s.phase = 'play';
    s.starter = starter;
    s.active = starter;
    s.turn = 1;
    s.last = null;
    s.end = null;
  }

  function newGame(names, starter = 0, rng = Math.random) {
    const s = { round: 1, seals: [0, 0], players: names.map(newPlayer), matches: 0 };
    startRound(s, starter, rng);
    return s;
  }

  // ---------- scoring ----------
  const sum = (list) => list.reduce((t, v) => t + v, 0);
  const goodsTokens = (p) => GOODS.reduce((n, g) => n + p.tokens[g].length, 0);
  const goodsPoints = (p) => GOODS.reduce((t, g) => t + sum(p.tokens[g]), 0);

  // Points a player has banked this round. The camel bonus only exists once the round is over.
  function score(s, seat) {
    const p = s.players[seat];
    const goods = goodsPoints(p);
    const bonus = p.bonus ? sum(p.bonus) : 0;
    const camel = s.end && s.end.camelWinner === seat ? RULES.camelBonus : 0;
    return { goods, bonus, camel, total: goods + bonus + camel };
  }

  // What selling `n` of `good` would earn right now: { tokens: [...], bonus: expected size or 0, points }.
  function sellPreview(s, good, n) {
    const tokens = s.piles[good].slice(0, n);
    const size = n >= 5 ? 5 : n >= 3 ? n : 0;
    return { tokens, bonusSize: size, points: sum(tokens) };
  }

  const emptyPiles = (s) => GOODS.filter((g) => s.piles[g].length === 0).length;

  // ---------- legal actions ----------
  // Every distinct way `seat` could act right now. Works on a full state or on a player's view.
  function legalActions(s, seat) {
    if (s.phase !== 'play' || s.active !== seat) return [];
    const me = s.players[seat];
    const out = [];
    const marketGoods = GOODS.filter((g) => s.market.includes(g));

    if (me.hand.length < RULES.handLimit) for (const g of marketGoods) out.push({ type: 'take', card: g });
    if (s.market.includes('camel')) out.push({ type: 'camels' });

    for (const g of GOODS) {
      const have = count(me.hand, g);
      for (let n = PREMIUM.includes(g) ? RULES.premiumMin : 1; n <= have; n++) out.push({ type: 'sell', good: g, count: n });
    }

    // Exchanges: pick how many of each market good to take, and how many of each type to give (camels count as a type).
    const marketCount = Object.fromEntries(marketGoods.map((g) => [g, count(s.market, g)]));
    const giveCount = { camel: me.herd };
    for (const g of GOODS) giveCount[g] = count(me.hand, g);
    const takeCombos = [];
    (function walkTake(i, picked, k) {
      if (i === marketGoods.length) {
        if (k >= 2) takeCombos.push(picked.slice());
        return;
      }
      for (let n = 0; n <= marketCount[marketGoods[i]]; n++) {
        picked.push(...Array(n).fill(marketGoods[i]));
        walkTake(i + 1, picked, k + n);
        picked.length -= n;
      }
    })(0, [], 0);
    const giveTypes = ['camel', ...GOODS];
    for (const take of takeCombos) {
      const takenTypes = new Set(take);
      const allowed = giveTypes.filter((t) => giveCount[t] > 0 && !takenTypes.has(t));
      (function walkGive(i, given, k) {
        if (k === take.length) {
          const fromHand = given.filter(isGood).length;
          if (me.hand.length - fromHand + take.length <= RULES.handLimit) out.push({ type: 'exchange', take: take.slice(), give: given.slice() });
          return;
        }
        if (i === allowed.length) return;
        const t = allowed[i];
        for (let n = 0; n <= Math.min(giveCount[t], take.length - k); n++) {
          given.push(...Array(n).fill(t));
          walkGive(i + 1, given, k + n);
          given.length -= n;
        }
      })(0, [], 0);
    }
    return out;
  }

  // ---------- applying an action ----------
  const sortedKey = (list) => list.slice().sort().join(',');

  function removeFrom(list, what, n = 1) {
    for (let i = 0; i < n; i++) {
      const at = list.indexOf(what);
      if (at < 0) throw new Error('That card is not there');
      list.splice(at, 1);
    }
  }

  function refill(s, n) {
    for (let i = 0; i < n && s.deck.length; i++) s.market.push(s.deck.pop());
  }

  function apply(state, player, action, rng = Math.random) {
    const s = clone(state);
    const fail = (msg) => {
      throw new Error(msg);
    };
    if (!s.players[player]) fail('Unknown player');
    const me = s.players[player];

    if (action.type === 'rematch') {
      if (s.phase !== 'over') fail('The round is not over yet');
      if (s.end.matchWinner != null) {
        s.round = 1;
        s.seals = [0, 0];
        s.matches = (s.matches || 0) + 1;
      } else {
        s.round += 1;
      }
      startRound(s, 1 - s.starter, rng);
      return s;
    }

    if (s.phase !== 'play') fail('The round is over');
    if (player !== s.active) fail("It's not your turn");
    let roundEnds = null;
    let last;

    switch (action.type) {
      case 'take': {
        if (!isGood(action.card)) fail('Pick a goods card (camels are taken all together)');
        if (!s.market.includes(action.card)) fail('That card is not in the market');
        if (me.hand.length >= RULES.handLimit) fail(`Your hand is full (${RULES.handLimit} cards). Sell something first`);
        removeFrom(s.market, action.card);
        me.hand.push(action.card);
        refill(s, 1);
        last = { kind: 'take', card: action.card };
        if (s.market.length < RULES.marketSize) roundEnds = 'deck';
        break;
      }
      case 'camels': {
        const n = count(s.market, 'camel');
        if (!n) fail('There are no camels in the market');
        s.market = s.market.filter((c) => c !== 'camel');
        me.herd += n;
        refill(s, n);
        last = { kind: 'camels', n };
        if (s.market.length < RULES.marketSize) roundEnds = 'deck';
        break;
      }
      case 'exchange': {
        const take = action.take || [];
        const give = action.give || [];
        if (take.length < 2) fail('Swap at least two cards');
        if (take.length !== give.length) fail('Give as many cards as you take');
        if (take.some((c) => !isGood(c))) fail('You can’t take camels in a swap');
        const takenTypes = new Set(take);
        if (give.some((c) => takenTypes.has(c))) fail('You can’t give a kind of card you are taking');
        const giveGoods = give.filter(isGood);
        const giveCamels = give.length - giveGoods.length;
        if (give.some((c) => c !== 'camel' && !isGood(c))) fail('Unknown card');
        for (const t of takenTypes) if (count(take, t) > count(s.market, t)) fail('Those cards are not in the market');
        for (const g of new Set(giveGoods)) if (count(giveGoods, g) > count(me.hand, g)) fail('You do not have those cards');
        if (giveCamels > me.herd) fail('You do not have that many camels');
        if (me.hand.length - giveGoods.length + take.length > RULES.handLimit) fail(`That would leave you with more than ${RULES.handLimit} cards`);
        take.forEach((c) => removeFrom(s.market, c));
        giveGoods.forEach((c) => removeFrom(me.hand, c));
        me.herd -= giveCamels;
        take.forEach((c) => me.hand.push(c));
        give.forEach((c) => s.market.push(c));
        last = { kind: 'exchange', take: take.slice().sort(), give: give.slice().sort() };
        break;
      }
      case 'sell': {
        const good = action.good;
        const n = action.count;
        if (!isGood(good)) fail('Pick something to sell');
        if (!Number.isInteger(n) || n < 1) fail('Pick how many to sell');
        if (n > count(me.hand, good)) fail('You do not have that many');
        if (PREMIUM.includes(good) && n < RULES.premiumMin) fail(`Sell at least ${RULES.premiumMin} ${good}s at a time`);
        const got = s.piles[good].splice(0, n);
        me.tokens[good].push(...got);
        let bonus = null;
        if (n >= 3) {
          const pile = s.bonusPiles[Math.min(n, 5)];
          if (pile.length) {
            bonus = pile.pop();
            me.bonus.push(bonus);
          }
        }
        removeFrom(me.hand, good, n);
        s.gone[good] += n;
        last = { kind: 'sell', good, n, tokens: got.slice(), bonus: n >= 3, bonusValue: bonus };
        if (emptyPiles(s) >= RULES.emptyPilesToEnd) roundEnds = 'piles';
        break;
      }
      default:
        fail('Unknown action');
    }

    last.who = player;
    last.turn = s.turn;
    s.last = last;
    if (roundEnds) finishRound(s, roundEnds);
    else {
      s.active = 1 - s.active;
      s.turn += 1;
    }
    return s;
  }

  // Camel bonus, scores, who takes the round and the seal.
  function finishRound(s, reason) {
    const camels = s.players.map((p) => p.herd);
    const camelWinner = camels[0] === camels[1] ? null : camels[0] > camels[1] ? 0 : 1;
    s.phase = 'over';
    s.end = { reason, camels, camelWinner, winner: null, scores: [0, 0], matchWinner: null };
    const scores = [0, 1].map((i) => score(s, i));
    s.end.scores = scores.map((x) => x.total);
    s.end.breakdown = scores;
    const bonusCount = s.players.map((p) => p.bonus.length);
    const tokenCount = s.players.map(goodsTokens);
    // most points, then most bonus tokens, then most goods tokens; still level means nobody takes the seal
    for (const [a, b] of [s.end.scores, bonusCount, tokenCount]) {
      if (a !== b) {
        s.end.winner = a > b ? 0 : 1;
        break;
      }
    }
    if (s.end.winner != null) {
      s.seals[s.end.winner] += 1;
      if (s.seals[s.end.winner] >= RULES.sealsToWin) s.end.matchWinner = s.end.winner;
    }
    s.end.seals = s.seals.slice();
  }

  // ---------- what a player is allowed to see ----------
  // Hidden: the draw deck's order, the other player's hand, and the value of their bonus tokens. Their herd,
  // goods tokens and the number of cards and bonus tokens they hold are public. Once the round is over everything is shown.
  function viewFor(s, seat) {
    const v = clone(s);
    const over = s.phase === 'over';
    v.deckCount = s.deck.length;
    delete v.deck;
    v.bonusLeft = { 3: s.bonusPiles[3].length, 4: s.bonusPiles[4].length, 5: s.bonusPiles[5].length };
    delete v.bonusPiles;
    v.players = v.players.map((p, i) => {
      const q = { ...p, handCount: p.hand.length, bonusCount: p.bonus.length };
      if (i !== seat && !over) {
        q.hand = [];
        q.bonus = [];
      }
      return q;
    });
    return v;
  }

  const api = {
    GOODS, PREMIUM, COPIES, CAMELS, TOKENS, BONUS, RULES, newGame, startRound, apply, viewFor, legalActions, score, sellPreview,
    emptyPiles, deckLeft, goodsTokens, goodsPoints,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Jaipur = api;
})(typeof window !== 'undefined' ? window : globalThis);
