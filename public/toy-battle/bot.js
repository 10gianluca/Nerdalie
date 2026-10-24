/* Computer opponent for Toy Battle. It only reads what its own player may see (game.viewFor): the board, the
   discard, its own rack and the sizes of the hidden piles.

   Every move is scored by the position it leaves: how few placements each side needs to reach the other H.Q., how
   close each region is to being taken, and the medals already won, plus a small price for spending a strong troop
   and a bonus for troop effects that help. A win on the spot scores highest and so does stopping the opponent from
   winning on their next turn. */
(function (root) {
  'use strict';

  const cjs = typeof module !== 'undefined' && module.exports;
  const G = cjs ? require('./game.js') : root.ToyBattle;
  const T = cjs ? require('./troops.js') : root.ToyTroops;
  const { TROOPS } = T;

  const TROOP_PRICE = { skully: 0.3, capn: 0.5, jumbo: 0.8, hook: 0.9, xb42: 1.0, star: 1.1, roxy: 1.2, kwak: 1.0 };
  const EFFECT_BONUS = { skully: 1.2, capn: 1.5, jumbo: 0.8, xb42: 1.2, star: 0.8, hook: 0.2, roxy: 0, kwak: 0 };

  const withStacks = (view, changes) => ({ ...view, stacks: { ...view.stacks, ...changes } });
  const other = (p) => 1 - p;

  // Fewest placements the player needs to land a troop on an enemy H.Q. (empty bases cost 1, enemy bases a little more).
  function routeCost(view, player) {
    const board = G.boardOf(view);
    const dist = {};
    const queue = [];
    for (const hq of board.hqs[player]) {
      dist[hq] = 0;
      queue.push(hq);
    }
    let best = Infinity;
    while (queue.length) {
      queue.sort((a, b) => dist[a] - dist[b]);
      const n = queue.shift();
      if (board.nodes[n].kind === 'hq' && board.nodes[n].side !== player) {
        best = Math.min(best, dist[n]);
        continue;
      }
      for (const m of board.adj[n]) {
        const node = board.nodes[m];
        if (node.kind === 'hq' && node.side === player) continue;
        let step = 1;
        if (node.kind === 'base') {
          const occ = G.occupant(view, m);
          if (occ === player) step = 0;
          else if (occ !== null) {
            const top = G.topOf(view, m);
            const s = G.strengthOf(view, top);
            step = 1.2 + (s === null ? 0.3 : s * 0.12);
          }
        }
        if (dist[m] === undefined || dist[n] + step < dist[m]) {
          dist[m] = dist[n] + step;
          queue.push(m);
        }
      }
    }
    return best;
  }

  // How good the position is for `seat`; regions completed by `seat` count as already won.
  function position(view, seat) {
    const board = G.boardOf(view);
    const opp = other(seat);
    const medals = view.medals.slice();
    let won = false;
    let score = 0;
    for (const region of board.regions) {
      const owner = view.regionTaken[region.id];
      const occ = region.bases.map((b) => G.occupant(view, b));
      const mine = occ.filter((o) => o === seat).length;
      const theirs = occ.filter((o) => o === opp).length;
      if (owner === undefined && mine === region.bases.length) {
        medals[seat] += region.medals;
        if (medals[seat] >= board.targets[seat]) won = true;
      } else if (owner === undefined) {
        const n = region.bases.length;
        if (!theirs) score += region.medals * (mine / n) ** 2 * 3;
        if (!mine) score -= region.medals * (theirs / n) ** 2 * 3;
      }
    }
    if (won) return 1e5;
    const dMe = routeCost(view, seat);
    const dOpp = routeCost(view, opp);
    score += (Math.min(dOpp, 6) - Math.min(dMe, 6)) * 2.5;
    if (dOpp <= 1) score -= 40; // they would capture the H.Q. next turn
    if (dMe <= 1) score += 15;
    for (const b of board.bases) {
      const o = G.occupant(view, b);
      if (o === seat) score += 0.3;
      else if (o === opp) score -= 0.3;
    }
    score += (medals[seat] - medals[opp]) * 8;
    return score;
  }

  function scorePlacement(view, seat, troop, slot, base) {
    const board = G.boardOf(view);
    if (board.nodes[slot].kind === 'hq') return 1e6;
    const type = G.typeOf(view, troop);
    const after = withStacks(view, { [slot]: [...view.stacks[slot], troop] });
    let score = position(after, seat) - base;
    score -= TROOP_PRICE[type] * 0.8;
    score += EFFECT_BONUS[type];
    const node = board.nodes[slot];
    if (type === 'jumbo' && G.adjacentBases(view, slot).some((b) => G.occupant(view, b) === other(seat))) score += 1.2;
    if (node.special && T.TERRAIN_RULES[board.rule].baseEffect && !(board.rule === 'metal')) score += 0.7;
    return score;
  }

  function bestPlacement(view, seat, actions) {
    const base = position(view, seat);
    let best = null;
    for (const a of actions) {
      if (a.type !== 'place') continue;
      const score = scorePlacement(view, seat, a.troop, a.slot, base);
      if (!best || score > best.score) best = { score, action: a };
    }
    return best;
  }

  function chooseEffect(view, seat, actions) {
    const e = view.pending;
    const skip = { type: 'effect', use: false };
    const uses = actions.filter((a) => a.type === 'effect' && a.use);
    if (!uses.length) return skip;
    const base = position(view, seat);
    const pick = (score) => {
      let best = null;
      for (const { value, action } of score) if (!best || value > best.value) best = { value, action };
      return best;
    };
    switch (e.kind) {
      case 'draw2':
      case 'draw1':
      case 'cloud':
      case 'steal':
      case 'battlefield':
        return uses[0];
      case 'extra': {
        const placement = bestPlacement(view, seat, G.legalActions({ ...view, phase: 'extra' }, seat));
        return placement && placement.score > 0.3 ? uses[0] : skip;
      }
      case 'discardAdjacent': {
        const best = pick(uses.map((a) => {
          const stack = view.stacks[a.base];
          const after = withStacks(view, { [a.base]: stack.slice(0, -1) });
          return { value: position(after, seat) - base, action: a };
        }));
        return best && best.value > 0.2 ? best.action : skip;
      }
      case 'castle': {
        const best = pick(uses.map((a) => {
          const stack = view.stacks[a.base];
          const after = withStacks(view, { [a.base]: stack.slice(0, -1) });
          return { value: position(after, seat) - base + 1.2, action: a };
        }));
        return best && best.value > 0.4 ? best.action : skip;
      }
      case 'volcano': {
        const best = pick(uses.map((a) => {
          const moved = view.stacks[a.from][view.stacks[a.from].length - 1];
          const after = withStacks(view, { [a.from]: view.stacks[a.from].slice(0, -1), [a.to]: [...view.stacks[a.to], moved] });
          return { value: position(after, seat) - base, action: a };
        }));
        return best && best.value > 0.3 ? best.action : skip;
      }
      case 'cemetery': {
        const best = pick(uses.map((a) => ({ value: TROOPS[G.typeOf(view, a.troop)].strength || 5, action: a })));
        return best.action;
      }
      default:
        return skip;
    }
  }

  // Easy and normal players sometimes make a random (but legal) move instead of the best one they can see.
  const MISTAKES = { easy: 0.5, normal: 0.2, hard: 0 };

  function randomAction(view, seat, rng) {
    const actions = G.legalActions(view, seat);
    return actions.length ? actions[Math.floor(rng() * actions.length)] : null;
  }

  function best(view, seat, rng) {
    if (view.phase === 'over' || view.active !== seat) return null;
    const actions = G.legalActions(view, seat);
    if (!actions.length) return null;
    if (view.phase === 'effect') return chooseEffect(view, seat, actions);
    const placement = bestPlacement(view, seat, actions);
    if (view.phase === 'extra') return placement && placement.score > 0.3 ? placement.action : { type: 'effect', use: false };
    const draw = actions.find((a) => a.type === 'draw');
    if (!placement) return draw;
    if (!draw) return placement.action;
    const rackSize = view.players[seat].rack.length;
    const drawValue = 0.9 + (rackSize <= 2 ? 3 : rackSize <= 4 ? 1.2 : 0) + rng() * 0.05;
    return placement.score >= drawValue ? placement.action : draw;
  }

  function choose(view, seat, rng = Math.random, level = 'hard') {
    if (rng() < (MISTAKES[level] || 0)) {
      const mistake = randomAction(view, seat, rng);
      if (mistake) return mistake;
    }
    return best(view, seat, rng);
  }

  const api = { choose, position, routeCost };
  if (cjs) module.exports = api;
  else root.ToyBot = api;
})(typeof window !== 'undefined' ? window : globalThis);
