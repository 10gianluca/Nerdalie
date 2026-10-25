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

function randomAgent(rng) {
  return (view, seat) => {
    const legal = G.legalActions(view, seat);
    return legal[Math.floor(rng() * legal.length)];
  };
}

function play(agents, seed) {
  const rng = mulberry32(seed);
  let s = G.newGame(['A', 'B'], seed % 2, rng);
  for (let step = 0; step < 2000; step++) {
    if (s.phase === 'over') return s;
    const seat = s.active;
    const action = agents[seat](G.viewFor(s, seat), seat);
    assert.ok(action, `no action for seat ${seat} in turn ${s.turn}`);
    s = G.apply(s, seat, action, rng);
  }
  assert.fail('round did not finish');
}

test('the bot only ever plays legal moves, on every level, and sees only its own view', () => {
  for (const level of Bot.LEVELS) {
    for (let seed = 1; seed <= 12; seed++) {
      const rng = mulberry32(seed + 100);
      const bot = (view, seat) => {
        const action = Bot.choose(view, seat, rng, level);
        assert.ok(G.legalActions(view, seat).some((a) => JSON.stringify(a) === JSON.stringify(action)), `${level}: ${JSON.stringify(action)} is not legal`);
        return action;
      };
      const s = play([bot, bot], seed);
      assert.equal(s.phase, 'over');
    }
  }
});

test('the bot answers null when it is not its turn, and when the round is over', () => {
  const s = G.newGame(['A', 'B'], 0, mulberry32(3));
  assert.equal(Bot.choose(G.viewFor(s, 1), 1, mulberry32(1), 'hard'), null);
  const over = play([randomAgent(mulberry32(2)), randomAgent(mulberry32(3))], 5);
  assert.equal(Bot.choose(G.viewFor(over, 0), 0, mulberry32(1), 'hard'), null);
});

test('it sells a full hand of expensive goods instead of dithering', () => {
  const s = G.newGame(['A', 'B'], 0, mulberry32(8));
  s.players[0].hand = ['diamond', 'diamond', 'diamond', 'cloth'];
  s.players[0].herd = 0;
  s.players[1].herd = 0;
  s.market = ['leather', 'leather', 'spice', 'camel', 'camel'];
  const action = Bot.choose(G.viewFor(s, 0), 0, mulberry32(1), 'hard');
  assert.equal(action.type, 'sell');
  assert.equal(action.good, 'diamond');
  assert.ok(action.count >= 2);
});

test('with a full hand it has to sell or swap, and does', () => {
  const s = G.newGame(['A', 'B'], 0, mulberry32(9));
  s.players[0].hand = ['cloth', 'cloth', 'cloth', 'spice', 'spice', 'leather', 'leather'];
  s.market = ['gold', 'silver', 'diamond', 'leather', 'camel'];
  for (const level of Bot.LEVELS) {
    const action = Bot.choose(G.viewFor(s, 0), 0, mulberry32(4), level);
    assert.notEqual(action.type, 'take');
  }
});

test('every level beats random play, and the levels are ordered', () => {
  const rounds = (a, b, n) => {
    let aw = 0;
    for (let i = 0; i < n; i++) {
      const swap = i % 2;
      const rngA = mulberry32(i * 7 + 1);
      const rngB = mulberry32(i * 7 + 2);
      const agentA = a === 'random' ? randomAgent(rngA) : (v, seat) => Bot.choose(v, seat, rngA, a);
      const agentB = b === 'random' ? randomAgent(rngB) : (v, seat) => Bot.choose(v, seat, rngB, b);
      const s = play(swap ? [agentB, agentA] : [agentA, agentB], 500 + i);
      if (s.end.winner === (swap ? 1 : 0)) aw++;
    }
    return aw / n;
  };
  for (const level of Bot.LEVELS) assert.ok(rounds(level, 'random', 40) > 0.9, `${level} should beat random play`);
  assert.ok(rounds('normal', 'easy', 60) > 0.7, 'normal beats easy');
  assert.ok(rounds('hard', 'easy', 60) > 0.75, 'hard beats easy');
  assert.ok(rounds('hard', 'normal', 120) > 0.52, 'hard beats normal');
});
