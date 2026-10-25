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

const randomAgent = (rng) => (view, seat) => {
  const plays = G.legalPlays(view, seat);
  const p = plays[Math.floor(rng() * plays.length)];
  return { type: 'play', card: p.card, stone: p.stone };
};

function play(agents, seed) {
  const rng = mulberry32(seed);
  let s = G.newGame(['A', 'B'], seed % 2, rng);
  for (let step = 0; step < 200; step++) {
    if (s.phase === 'over') return s;
    const seat = s.active;
    const action = agents[seat](G.viewFor(s, seat), seat);
    assert.ok(action, `no action in turn ${s.turn}`);
    s = G.apply(s, seat, action, rng);
  }
  assert.fail('game did not finish');
}

test('the bot only plays legal cards, on every level, using only what it can see', () => {
  for (const level of Bot.LEVELS) {
    for (let seed = 1; seed <= 6; seed++) {
      const rng = mulberry32(seed + 20);
      const bot = (view, seat) => {
        const action = Bot.choose(view, seat, rng, level);
        assert.ok(G.legalPlays(view, seat).some((p) => p.card === action.card && p.stone === action.stone), `${level}: ${JSON.stringify(action)} is not a legal play`);
        return action;
      };
      assert.equal(play([bot, bot], seed).phase, 'over');
    }
  }
});

test('the bot answers null when it is not its turn', () => {
  const s = G.newGame(['A', 'B'], 0, mulberry32(2));
  assert.equal(Bot.choose(G.viewFor(s, 1), 1, mulberry32(1), 'hard'), null);
});

test('given the chance, it finishes a formation nothing can beat', () => {
  const s = G.newGame(['A', 'B'], 0, mulberry32(5));
  s.stones.forEach((st) => { st.sides = [[], []]; st.done = [0, 0]; st.owner = null; });
  s.stones[2].sides[0] = ['R9', 'R8'];
  s.hands[0] = ['R7', 'B1', 'O2', 'G3', 'P4', 'Y5'];
  const a = Bot.choose(G.viewFor(s, 0), 0, mulberry32(3), 'hard');
  assert.deepEqual([a.card, a.stone], ['R7', 2]);
});

test('it does not waste a strong card on a stone the other side has already beaten', () => {
  const s = G.newGame(['A', 'B'], 0, mulberry32(6));
  s.stones.forEach((st) => { st.sides = [[], []]; st.done = [0, 0]; st.owner = null; });
  // stone 0: the other side is a finished colour run of 7 8 9, which only a longer colour run could match
  s.stones[0].sides[1] = ['B7', 'B8', 'B9'];
  s.stones[0].done[1] = 1;
  s.stones[0].owner = 1; // and already theirs
  s.hands[0] = ['R9', 'O9', 'Y9', 'G1', 'P1', 'B1'];
  const plays = G.legalPlays(G.viewFor(s, 0), 0);
  assert.ok(!plays.some((p) => p.stone === 0), 'a won stone can not be played on at all');
  const a = Bot.choose(G.viewFor(s, 0), 0, mulberry32(3), 'hard');
  assert.notEqual(a.stone, 0);
});

test('every level beats random play, and the levels are ordered', () => {
  const rate = (a, b, n) => {
    let aw = 0;
    for (let i = 0; i < n; i++) {
      const swap = i % 2;
      const rngA = mulberry32(i * 11 + 1);
      const rngB = mulberry32(i * 11 + 2);
      const A = a === 'random' ? randomAgent(rngA) : (v, seat) => Bot.choose(v, seat, rngA, a);
      const B = b === 'random' ? randomAgent(rngB) : (v, seat) => Bot.choose(v, seat, rngB, b);
      const s = play(swap ? [B, A] : [A, B], 400 + i);
      if (s.end.winner === (swap ? 1 : 0)) aw++;
    }
    return aw / n;
  };
  for (const level of Bot.LEVELS) assert.ok(rate(level, 'random', 30) > 0.7, `${level} should beat random play`);
  assert.ok(rate('normal', 'easy', 30) > 0.65, 'normal beats easy');
  assert.ok(rate('hard', 'easy', 24) > 0.7, 'hard beats easy');
});
