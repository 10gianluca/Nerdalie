const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../game.js');
const Bot = require('../bot.js');

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Skips tricks, plays any legal card, lets spells happen, discards the first cards in hand.
function randomAgent(rng) {
  return (view, seat) => {
    if (view.phase === 'over' || view.active !== seat) return null;
    if (view.phase === 'trick') return { type: 'skipTrick' };
    if (view.phase === 'play') {
      const moves = G.legalPlays(view, seat);
      if (!moves.length) return { type: 'cannotPlay' };
      const m = moves[Math.floor(rng() * moves.length)];
      return { type: 'play', cardId: m.cardId, pile: m.pile, binxTo: rng() < 0.5 ? seat : 1 - seat };
    }
    if (view.phase === 'spell') {
      if (view.pendingSpell) return { type: 'continueFromSpell' };
      if (view.pendingDiscard) return { type: 'discard', cardIds: view.players[seat].hand.slice(0, view.pendingDiscard.min) };
    }
    return null;
  };
}

const botAgent = (rng) => (view, seat) => Bot.choose(view, seat, rng);

function play(agent, seed) {
  const rng = mulberry32(seed);
  let s = G.newGame(['A', 'B'], seed % 2, rng);
  for (let step = 0; step < 3000; step++) {
    if (s.phase === 'over') return s;
    let moved = false;
    for (const seat of [0, 1]) {
      const action = agent(seat)(G.viewFor(s, seat), seat);
      if (!action) continue;
      s = G.apply(s, seat, action, rng);
      moved = true;
      break;
    }
    assert.ok(moved, `stuck in phase ${s.phase} (turn ${s.turn})`);
  }
  assert.fail('game did not finish');
}

test('two bots: 150 games always finish with only legal actions', () => {
  for (let seed = 1; seed <= 150; seed++) {
    const bots = [botAgent(mulberry32(seed)), botAgent(mulberry32(seed + 1))];
    const s = play((seat) => bots[seat], seed);
    assert.ok(s.end && (s.end.result === 'win' || s.end.result === 'lose'));
  }
});

test('a bot partner wins clearly more often than a random partner would', () => {
  let botWins = 0;
  let randomWins = 0;
  const games = 200;
  for (let seed = 1; seed <= games; seed++) {
    const bots = [botAgent(mulberry32(seed)), botAgent(mulberry32(seed + 1))];
    if (play((seat) => bots[seat], seed).end.result === 'win') botWins++;
    const rnd = [randomAgent(mulberry32(seed + 7)), randomAgent(mulberry32(seed + 8))];
    if (play((seat) => rnd[seat], seed).end.result === 'win') randomWins++;
  }
  assert.ok(botWins > randomWins + 20, `bots won ${botWins}/${games}, random pair won ${randomWins}/${games}`);
});

test('difficulty levels: a hard partner pair wins more often than an easy pair', () => {
  let hardWins = 0;
  let easyWins = 0;
  const games = 200;
  for (let seed = 1; seed <= games; seed++) {
    for (const level of ['hard', 'easy']) {
      const rngs = [mulberry32(seed), mulberry32(seed + 1)];
      const s = play((seat) => (view, st) => Bot.choose(view, st, rngs[seat], level), seed);
      if (s.end.result === 'win') (level === 'hard' ? hardWins++ : easyWins++);
    }
  }
  assert.ok(hardWins > easyWins + 15, `hard pair won ${hardWins}/${games}, easy pair won ${easyWins}/${games}`);
});
