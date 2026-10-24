const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../game.js');
const B = require('../boards.js');
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
  const actions = G.legalActions(view, seat);
  return actions.length ? actions[Math.floor(rng() * actions.length)] : null;
};
const botAgent = (rng, level = 'hard') => (view, seat) => Bot.choose(view, seat, rng, level);

function play(agents, seed, terrain) {
  const rng = mulberry32(seed);
  let s = G.newGame(['A', 'B'], seed % 2, terrain, rng);
  for (let step = 0; step < 2000; step++) {
    if (s.phase === 'over') return s;
    const seat = s.active;
    const action = agents[seat](G.viewFor(s, seat), seat);
    assert.ok(action, `no action in phase ${s.phase} (turn ${s.turn})`);
    s = G.apply(s, seat, action, rng);
  }
  assert.fail('game did not finish');
}

for (const id of B.ORDER) {
  test(`${id}: bot vs bot, 25 games always finish with only legal actions`, () => {
    for (let seed = 1; seed <= 25; seed++) {
      const s = play([botAgent(mulberry32(seed)), botAgent(mulberry32(seed + 1))], seed, id);
      assert.equal(s.phase, 'over');
    }
  });
}

test('bot beats a random legal player most of the time, on every board, from either seat', () => {
  for (const id of B.ORDER) {
    let wins = 0;
    const games = 40;
    for (let seed = 1; seed <= games; seed++) {
      const botSeat = seed % 2;
      const bot = botAgent(mulberry32(seed));
      const rnd = randomAgent(mulberry32(seed + 9000));
      const s = play(botSeat === 0 ? [bot, rnd] : [rnd, bot], seed, id);
      if (s.end.winner === botSeat) wins++;
    }
    assert.ok(wins >= 30, `${id}: bot only won ${wins}/${games}`);
  }
});

test('difficulty levels: hard beats easy clearly, from either seat', () => {
  let wins = 0;
  let games = 0;
  for (const id of ['castle', 'cemetery', 'volcano', 'metal']) {
    for (let seed = 1; seed <= 25; seed++) {
      const hardSeat = seed % 2;
      const hard = botAgent(mulberry32(seed), 'hard');
      const easy = botAgent(mulberry32(seed + 77), 'easy');
      const s = play(hardSeat === 0 ? [hard, easy] : [easy, hard], seed, id);
      games++;
      if (s.end.winner === hardSeat) wins++;
    }
  }
  assert.ok(wins >= 0.7 * games, `hard only won ${wins}/${games} against easy`);
});
