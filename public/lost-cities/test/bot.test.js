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
    if (view.active !== seat) return null;
    if (view.phase === 'play') {
      const hand = view.players[seat].hand;
      const plays = hand.filter((id) => G.canPlay(view.players[seat].exp[G.parse(id).color], id).ok);
      if (plays.length && rng() < 0.6) return { type: 'play', card: plays[Math.floor(rng() * plays.length)] };
      return { type: 'discard', card: hand[Math.floor(rng() * hand.length)] };
    }
    if (view.phase === 'draw') {
      const draws = G.legalDraws(view);
      return { type: 'draw', from: draws[Math.floor(rng() * draws.length)] };
    }
    return null;
  };
}

const botAgent = (rng) => (view, seat) => Bot.choose(view, seat, rng);

function play(agents, seed) {
  const rng = mulberry32(seed);
  let s = G.newGame(['A', 'B'], seed % 2, rng);
  for (let step = 0; step < 400; step++) {
    if (s.phase === 'over') return s;
    let moved = false;
    for (const seat of [0, 1]) {
      const action = agents[seat](G.viewFor(s, seat), seat);
      if (!action) continue;
      s = G.apply(s, seat, action, rng);
      moved = true;
      break;
    }
    assert.ok(moved, `stuck in phase ${s.phase} (turn ${s.turn})`);
  }
  assert.fail('round did not finish');
}

test('bot vs bot: 100 rounds always finish with only legal actions', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const s = play([botAgent(mulberry32(seed)), botAgent(mulberry32(seed + 1))], seed);
    assert.equal(s.phase, 'over');
    assert.ok(s.end);
  }
});

test('bot beats a random legal player almost every round, from either seat', () => {
  let wins = 0;
  const games = 200;
  for (let seed = 1; seed <= games; seed++) {
    const botSeat = seed % 2;
    const bot = botAgent(mulberry32(seed));
    const rnd = randomAgent(mulberry32(seed + 9000));
    const s = play(botSeat === 0 ? [bot, rnd] : [rnd, bot], seed);
    if (s.end.winner === botSeat) wins++;
  }
  assert.ok(wins >= 180, `bot only won ${wins}/${games}`);
});

test('a bot round scores positively on average (it does not just avoid disaster)', () => {
  let total = 0;
  const games = 100;
  for (let seed = 1; seed <= games; seed++) {
    const s = play([botAgent(mulberry32(seed)), randomAgent(mulberry32(seed + 5))], seed);
    total += s.end.scores[0];
  }
  assert.ok(total / games > 10, `average bot score was ${(total / games).toFixed(1)}`);
});

test('difficulty levels: hard beats easy clearly, from either seat', () => {
  let wins = 0;
  const games = 100;
  for (let seed = 1; seed <= games; seed++) {
    const hardSeat = seed % 2;
    const rngH = mulberry32(seed);
    const rngE = mulberry32(seed + 77);
    const hard = (v, s) => Bot.choose(v, s, rngH, 'hard');
    const easy = (v, s) => Bot.choose(v, s, rngE, 'easy');
    const s = play(hardSeat === 0 ? [hard, easy] : [easy, hard], seed);
    if (s.end.winner === hardSeat) wins++;
  }
  assert.ok(wins >= 85, `hard only won ${wins}/${games} against easy`);
});
