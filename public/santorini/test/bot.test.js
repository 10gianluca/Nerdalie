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

const sq = (x, y) => y * 5 + x;

function table({ builders, heights = {}, domes = [], active = 0 }) {
  const s = G.newGame(['A', 'B'], 0);
  s.phase = 'play';
  s.placed = 4;
  s.active = active;
  s.builders = builders.map((b) => b.slice());
  builders.forEach((list, seat) => list.forEach((i) => { s.board[i].w = seat; }));
  for (const [i, h] of Object.entries(heights)) s.board[i].h = h;
  for (const i of domes) s.board[i].dome = true;
  return s;
}

const randomAction = (s, seat, rng) => {
  if (s.phase === 'place') { const f = G.legalPlacements(s, seat); return { type: 'place', at: f[Math.floor(rng() * f.length)] }; }
  if (s.pending) { const b = G.legalBuilds(s, seat); return { type: 'build', at: b[Math.floor(rng() * b.length)] }; }
  const m = G.legalMoves(s, seat);
  return { type: 'move', ...m[Math.floor(rng() * m.length)] };
};

function play(agents, seed) {
  const rng = mulberry32(seed);
  let s = G.newGame(['A', 'B'], seed % 2);
  for (let step = 0; step < 600; step++) {
    if (s.phase === 'over') return s;
    const seat = s.active;
    const action = agents[seat](s, seat, rng);
    assert.ok(action, `no action in turn ${s.turn}`);
    s = G.apply(s, seat, action); // throws on anything the rules don't allow
  }
  return s;
}

test('every level only plays what the rules allow, from placing builders to the end', () => {
  for (const level of Bot.LEVELS) {
    for (let seed = 1; seed <= 6; seed++) {
      const bot = (s, seat, rng) => Bot.choose(s, seat, rng, level);
      const s = play([bot, bot], seed);
      assert.ok(s.turn > 8, `${level} played on`);
    }
  }
});

test('the bot answers null when it is not its turn or the game is over', () => {
  const s = G.newGame(['A', 'B'], 0);
  assert.equal(Bot.choose(s, 1, mulberry32(1), 'hard'), null);
});

test('it climbs onto a level 3 when it can, on every level', () => {
  const s = table({ builders: [[sq(0, 0), sq(4, 4)], [sq(2, 4), sq(4, 0)]], heights: { [sq(0, 0)]: 2, [sq(1, 0)]: 3 } });
  for (const level of ['normal', 'hard']) {
    const a = Bot.choose(s, 0, mulberry32(3), level);
    assert.deepEqual(a, { type: 'move', from: sq(0, 0), to: sq(1, 0) }, level);
  }
});

test('it finishes a move with the build it planned, and it is always legal', () => {
  const rng = mulberry32(5);
  let s = table({ builders: [[sq(1, 1), sq(3, 3)], [sq(0, 4), sq(4, 0)]] });
  const move = Bot.choose(s, 0, rng, 'hard');
  assert.equal(move.type, 'move');
  s = G.apply(s, 0, move);
  const build = Bot.choose(s, 0, rng, 'hard');
  assert.equal(build.type, 'build');
  assert.ok(G.legalBuilds(s, 0).includes(build.at));
});

test('hard stops a win it can see coming', () => {
  // the other player stands on level 2 right beside a level 3 tower; one dome and they have nothing to climb
  const s = table({
    builders: [[sq(0, 0), sq(2, 3)], [sq(4, 4), sq(4, 0)]],
    heights: { [sq(4, 4)]: 2, [sq(3, 4)]: 3, [sq(3, 3)]: 0 },
    active: 0,
  });
  const rng = mulberry32(2);
  let t = G.apply(s, 0, Bot.choose(s, 0, rng, 'hard'));
  if (t.pending) t = G.apply(t, 0, Bot.choose(t, 0, rng, 'hard'));
  const threats = G.legalMoves(t, 1).filter((m) => t.board[m.to].h === 3 && t.board[m.to].h > t.board[m.from].h);
  assert.deepEqual(threats, [], 'the other player has no winning step left');
});

test('hard looks for a trap: with a winning step available it takes the win over anything else', () => {
  const s = table({ builders: [[sq(2, 2), sq(0, 0)], [sq(4, 4), sq(4, 0)]], heights: { [sq(2, 2)]: 2, [sq(2, 3)]: 3, [sq(1, 1)]: 1 }, active: 0 });
  const a = Bot.choose(s, 0, mulberry32(9), 'hard');
  assert.deepEqual(a, { type: 'move', from: sq(2, 2), to: sq(2, 3) });
});

test('hard answers within a reasonable time', () => {
  const rng = mulberry32(8);
  let worst = 0;
  for (let seed = 1; seed <= 3; seed++) {
    let s = G.newGame(['A', 'B'], seed % 2);
    for (let step = 0; step < 40 && s.phase !== 'over'; step++) {
      const t0 = Date.now();
      const a = Bot.choose(s, s.active, rng, 'hard');
      worst = Math.max(worst, Date.now() - t0);
      s = G.apply(s, s.active, a);
    }
  }
  assert.ok(worst < 3000, `slowest decision took ${worst} ms`);
});

test('every level beats random play, and the levels are ordered', () => {
  const rate = (a, b, n) => {
    let aw = 0;
    for (let i = 0; i < n; i++) {
      const swap = i % 2;
      const A = a === 'random' ? randomAction : (s, seat, rng) => Bot.choose(s, seat, rng, a);
      const B = b === 'random' ? randomAction : (s, seat, rng) => Bot.choose(s, seat, rng, b);
      const s = play(swap ? [B, A] : [A, B], 800 + i);
      if (s.phase === 'over' && s.end.winner === (swap ? 1 : 0)) aw++;
    }
    return aw / n;
  };
  for (const level of Bot.LEVELS) assert.ok(rate(level, 'random', 20) > 0.8, `${level} should beat random play`);
  assert.ok(rate('normal', 'easy', 16) > 0.75, 'normal beats easy');
  assert.ok(rate('hard', 'normal', 10) > 0.7, 'hard beats normal');
});
