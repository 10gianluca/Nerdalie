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

// Picks any legal action at random (never an action the engine would refuse).
function randomAgent(rng) {
  return (view, seat) => {
    const active = view.active === seat;
    if (view.phase === 'choose' && active) {
      if (rng() < 0.5) return { type: 'choose', colors: G.COLORS.filter(() => rng() < 0.6).concat(G.COLORS[0]) };
      return { type: 'roll' };
    }
    if (view.phase === 'rolled' && active) return !view.rerolled && rng() < 0.3 ? { type: 'reroll' } : { type: 'keep' };
    if (view.phase === 'enter' && !view.pending[seat]) {
      const moves = G.legalMoves(view.players[seat].sheet, Object.keys(view.dice), G.sumDice(view.dice));
      if (!moves.length || (!active && rng() < 0.3)) return { type: 'pass' };
      const m = moves[Math.floor(rng() * moves.length)];
      return { type: 'enter', color: m.color, col: m.col };
    }
    return null;
  };
}

const botAgent = (view, seat) => Bot.choose(view, seat);

function play(agents, seed) {
  const rng = mulberry32(seed);
  let s = G.newGame(['A', 'B'], seed % 2);
  for (let step = 0; step < 4000; step++) {
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
  assert.fail('game did not finish');
}

const totals = (s) => s.players.map((p) => G.score(p.sheet, p.fails).total);

test('bot vs bot: 60 games always finish with only legal actions', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const s = play([botAgent, botAgent], seed);
    assert.equal(s.phase, 'over');
    assert.ok(s.end);
  }
});

test('bot beats a random legal player most of the time, from either seat', () => {
  let wins = 0;
  const games = 100;
  for (let seed = 1; seed <= games; seed++) {
    const botSeat = seed % 2;
    const rnd = randomAgent(mulberry32(seed + 9000));
    const agents = botSeat === 0 ? [botAgent, rnd] : [rnd, botAgent];
    const t = totals(play(agents, seed));
    if (t[botSeat] > t[1 - botSeat]) wins++;
  }
  assert.ok(wins >= 85, `bot only won ${wins}/${games}`);
});

test('difficulty levels: hard beats easy clearly, from either seat', () => {
  let wins = 0;
  const games = 100;
  for (let seed = 1; seed <= games; seed++) {
    const hardSeat = seed % 2;
    const hard = (v, s) => Bot.choose(v, s, mulberry32(seed * 7), 'hard');
    const rngE = mulberry32(seed + 77);
    const easy = (v, s) => Bot.choose(v, s, rngE, 'easy');
    const t = totals(play(hardSeat === 0 ? [hard, easy] : [easy, hard], seed));
    if (t[hardSeat] > t[1 - hardSeat]) wins++;
  }
  assert.ok(wins >= 70, `hard only won ${wins}/${games} against easy`);
});
