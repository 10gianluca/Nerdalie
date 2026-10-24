/* Toy Battle rules engine (2 players): pure state + actions, no DOM. Works in the browser (window.ToyBattle) and Node.

   Players are 0 (blue, bottom of the board) and 1 (red). Troops are opaque ids; look them up in s.troops, which a
   player's view only fills in for troops they can see (the board, the discard and their own rack).

   A turn is one action: draw, or place a troop. Placing may trigger effects that ask for a decision; they wait in
   s.pending while s.phase is 'effect' (or 'extra' while Cap'n's extra troop is chosen). Every troop effect resolves
   first, then the effects of the special bases the troops landed on. */
(function (root) {
  'use strict';

  const cjs = typeof module !== 'undefined' && module.exports;
  const T = cjs ? require('./troops.js') : root.ToyTroops;
  const B = cjs ? require('./boards.js') : root.ToyBoards;
  const { RULES, TROOPS, TROOP_ORDER } = T;

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const other = (p) => 1 - p;
  function shuffle(a, rng) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  const boardOf = (s) => B.get(s.terrain);
  const typeOf = (s, id) => s.troops[id].type;
  const ownerOf = (s, id) => s.troops[id].owner;
  const topOf = (s, base) => {
    const st = s.stacks[base];
    return st && st.length ? st[st.length - 1] : null;
  };
  const occupant = (s, base) => {
    const t = topOf(s, base);
    return t === null ? null : ownerOf(s, t);
  };
  const log = (s, text) => s.log.push({ turn: s.turn, text });
  const nameOf = (s, p) => s.players[p].name;

  function newGame(names, starter = 0, terrain = 'castle', rng = Math.random) {
    const board = B.get(terrain);
    if (!board) throw new Error('Unknown terrain');
    const troops = {};
    const reserves = [[], []];
    let n = 0;
    for (const owner of [0, 1]) {
      for (const type of TROOP_ORDER) {
        for (let c = 0; c < RULES.copies; c++) {
          const id = 't' + n++;
          troops[id] = { type, owner };
          reserves[owner].push(id);
        }
      }
      shuffle(reserves[owner], rng);
    }
    const removed = [0, 1].map((o) => reserves[o].splice(0, RULES.removed));
    const s = {
      terrain,
      troops,
      players: names.map((name, i) => ({ name, rack: [], reserve: reserves[i], frozen: null })),
      removed,
      stacks: Object.fromEntries(board.bases.map((b) => [b, []])),
      discard: [],
      medals: [0, 0],
      regionTaken: {},
      starter,
      active: starter,
      turn: 1,
      phase: 'turn',
      effects: [],
      baseEffects: [],
      pending: null,
      last: null,
      log: [],
      end: null,
    };
    for (const p of [0, 1]) {
      const count = p === starter ? RULES.firstDraw : RULES.secondDraw;
      for (let i = 0; i < count; i++) s.players[p].rack.push(s.players[p].reserve.pop());
    }
    log(s, `${nameOf(s, starter)} goes first.`);
    return s;
  }

  // ---------- the board ----------

  const isJoker = (s, id) => !!TROOPS[typeOf(s, id)].joker;
  const strengthOf = (s, id) => TROOPS[typeOf(s, id)].strength;

  // A joker covers anything; anything covers a joker; otherwise strictly higher wins.
  function canCover(s, moverId, topId) {
    if (isJoker(s, moverId) || isJoker(s, topId)) return true;
    return strengthOf(s, moverId) > strengthOf(s, topId);
  }

  const allowedOn = (s, id, only) => isJoker(s, id) || only.includes(strengthOf(s, id));

  // Every base and enemy H.Q. joined to the player's H.Q. by a chain of paths through bases they occupy.
  function connectedSlots(s, player) {
    const board = boardOf(s);
    const slots = new Set();
    const expanded = new Set(board.hqs[player]);
    const queue = [...board.hqs[player]];
    while (queue.length) {
      const n = queue.shift();
      for (const m of board.adj[n]) {
        const node = board.nodes[m];
        if (node.kind === 'hq') {
          if (node.side !== player) slots.add(m);
          continue;
        }
        slots.add(m);
        if (occupant(s, m) === player && !expanded.has(m)) {
          expanded.add(m);
          queue.push(m);
        }
      }
    }
    return slots;
  }

  // Why this troop cannot go there, or null if it can.
  function slotProblem(s, player, troopId, slot, connected = connectedSlots(s, player)) {
    const board = boardOf(s);
    const node = board.nodes[slot];
    if (!node) return 'There is nowhere like that on the board';
    if (node.kind === 'hq') {
      if (node.side === player) return 'You can never place a troop on your own H.Q.';
      if (node.only && !allowedOn(s, troopId, node.only)) return `Only strengths ${node.only.join(', ')} can be placed on that H.Q.`;
      return connected.has(slot) ? null : 'That H.Q. is not connected to yours';
    }
    if (node.only && !allowedOn(s, troopId, node.only)) return `Only strengths ${node.only.join(', ')} can be placed on that base`;
    const top = topOf(s, slot);
    if (top !== null && ownerOf(s, top) !== player && !canCover(s, troopId, top)) return 'That enemy troop is too strong to cover';
    if (!TROOPS[typeOf(s, troopId)].ignoresConnection && !connected.has(slot)) return 'That base is not connected to your H.Q.';
    return null;
  }

  function legalSlots(s, player, troopId) {
    const board = boardOf(s);
    const connected = connectedSlots(s, player);
    const out = [];
    for (const id of Object.keys(board.nodes)) {
      if (board.nodes[id].kind === 'hq' && board.nodes[id].side === player) continue;
      if (slotProblem(s, player, troopId, id, connected) === null) out.push(id);
    }
    return out;
  }

  function placeableTroops(s, player) {
    const p = s.players[player];
    return p.rack.filter((id) => id !== null && id !== p.frozen && legalSlots(s, player, id).length > 0);
  }

  // A player's view hides the reserve and keeps only how many troops are in it.
  const reserveSize = (s, player) => (s.players[player].reserve ? s.players[player].reserve.length : s.players[player].reserveCount);
  const drawable = (s, player) => Math.min(RULES.rack - s.players[player].rack.length, reserveSize(s, player));
  const canDraw = (s, player) => drawable(s, player) > 0;
  const canAct = (s, player) => canDraw(s, player) || placeableTroops(s, player).length > 0;

  // ---------- medals, regions and the end of the game ----------

  function finish(s, winner, reason, extra = {}) {
    s.phase = 'over';
    s.end = { winner, reason, ...extra };
    s.effects = [];
    s.baseEffects = [];
    s.pending = null;
  }

  // As soon as one player occupies every base around a region, they take its medals (once, and they keep them).
  function checkRegions(s) {
    const board = boardOf(s);
    for (const region of board.regions) {
      if (s.regionTaken[region.id] !== undefined) continue;
      for (const p of [s.active, other(s.active)]) {
        if (!region.bases.every((b) => occupant(s, b) === p)) continue;
        s.regionTaken[region.id] = p;
        s.medals[p] += region.medals;
        log(s, `${nameOf(s, p)} takes control of a region and wins ${region.medals} medal${region.medals === 1 ? '' : 's'}.`);
        if (s.medals[p] >= board.targets[p]) {
          log(s, `${nameOf(s, p)} reaches ${board.targets[p]} medals and wins!`);
          finish(s, p, 'medals');
          return;
        }
        break;
      }
    }
  }

  // ---------- effects ----------

  const adjacentBases = (s, base) => boardOf(s).adj[base].filter((n) => boardOf(s).nodes[n].kind === 'base');

  // What an effect could do right now, or { usable: false } if there is nothing for it to do.
  function effectInfo(s, player, e) {
    const me = s.players[player];
    const opp = s.players[other(player)];
    const still = topOf(s, e.base) === e.troop; // an effect never applies once its troop is covered
    if (!still) return { usable: false };
    switch (e.kind) {
      case 'draw2':
      case 'draw1':
      case 'cloud':
        return { usable: canDraw(s, player) };
      case 'steal':
        return { usable: opp.rack.length > 0 };
      case 'battlefield':
        return { usable: opp.rack.length > 0 && !opp.frozen };
      case 'extra':
        return { usable: placeableTroops(s, player).length > 0 };
      case 'discardAdjacent': {
        const targets = adjacentBases(s, e.base).filter((b) => occupant(s, b) === other(player));
        return { usable: targets.length > 0, targets };
      }
      case 'castle': {
        const targets = s.stacks && Object.keys(s.stacks).filter((b) => b !== e.base && occupant(s, b) === player);
        return { usable: me.rack.length < RULES.rack && targets.length > 0, targets };
      }
      case 'volcano': {
        const moves = [];
        for (const from of adjacentBases(s, e.base)) {
          if (occupant(s, from) !== other(player)) continue;
          for (const to of adjacentBases(s, from)) moves.push({ from, to });
        }
        return { usable: moves.length > 0, moves };
      }
      case 'cemetery': {
        const targets = s.discard.filter((id) => ownerOf(s, id) === player);
        return { usable: me.rack.length < RULES.rack && targets.length > 0, targets };
      }
      default:
        return { usable: false };
    }
  }

  // Moves on through the queued effects until one needs the player's decision, then ends the turn.
  function advance(s) {
    for (;;) {
      if (s.phase === 'over') return;
      const fromTroops = s.effects.length > 0;
      const queue = fromTroops ? s.effects : s.baseEffects;
      if (!queue.length) {
        endTurn(s);
        return;
      }
      const e = queue[0];
      if (!effectInfo(s, s.active, e).usable) {
        queue.shift();
        continue;
      }
      s.pending = { ...e, fromTroops };
      s.phase = 'effect';
      return;
    }
  }

  function endTurn(s) {
    const finished = s.players[s.active];
    finished.frozen = null; // a frozen troop is back in play once its owner's turn is over
    s.active = other(s.active);
    s.turn++;
    s.effects = [];
    s.baseEffects = [];
    s.pending = null;
    s.phase = 'turn';
    if (!canAct(s, s.active)) {
      const stuck = s.active;
      const [a, b] = s.medals;
      const winner = a === b ? other(stuck) : a > b ? 0 : 1;
      log(s, `${nameOf(s, stuck)} cannot draw or place a troop, so the game ends.`);
      finish(s, winner, 'stuck', { stuck });
    }
  }

  function drawInto(s, player, n) {
    const me = s.players[player];
    const count = Math.min(n, drawable(s, player));
    for (let i = 0; i < count; i++) me.rack.push(me.reserve.pop());
    return count;
  }

  function place(s, player, troopId, slot) {
    const me = s.players[player];
    if (!me.rack.includes(troopId)) throw new Error('That troop is not on your rack');
    if (me.frozen === troopId) throw new Error('That troop is frozen until the end of your turn');
    const problem = slotProblem(s, player, troopId, slot);
    if (problem) throw new Error(problem);
    const board = boardOf(s);
    const node = board.nodes[slot];
    me.rack = me.rack.filter((id) => id !== troopId);
    const type = typeOf(s, troopId);
    const info = TROOPS[type];
    s.last = { who: player, troop: troopId, slot, type };
    if (node.kind === 'hq') {
      log(s, `${nameOf(s, player)} places ${info.name} on the enemy H.Q. and wins!`);
      s.stacks[slot] = (s.stacks[slot] || []).concat(troopId);
      finish(s, player, 'hq');
      return;
    }
    s.stacks[slot].push(troopId);
    log(s, `${nameOf(s, player)} places ${info.name} on a base.`);
    const shielded = board.rule === 'metal' && node.special;
    if (info.effect && !shielded) s.effects.unshift({ kind: info.effect, troop: troopId, base: slot });
    if (node.special && T.TERRAIN_RULES[board.rule].baseEffect) {
      s.baseEffects.push({ kind: T.TERRAIN_RULES[board.rule].baseEffect, troop: troopId, base: slot });
    }
    checkRegions(s);
  }

  function useEffect(s, player, action, rng) {
    const e = s.pending;
    const queue = e.fromTroops ? s.effects : s.baseEffects;
    const me = s.players[player];
    const opp = s.players[other(player)];
    const info = effectInfo(s, player, e);
    const fail = (m) => {
      throw new Error(m);
    };
    if (!info.usable) fail('That effect cannot be used now');

    switch (e.kind) {
      case 'draw2': {
        const n = drawInto(s, player, 2);
        log(s, `${nameOf(s, player)} draws ${n} troop${n === 1 ? '' : 's'}.`);
        break;
      }
      case 'draw1':
      case 'cloud':
        drawInto(s, player, 1);
        log(s, `${nameOf(s, player)} draws a troop.`);
        break;
      case 'steal': {
        const i = Math.floor(rng() * opp.rack.length);
        const [id] = opp.rack.splice(i, 1);
        if (opp.frozen === id) opp.frozen = null;
        s.discard.push(id);
        log(s, `${nameOf(s, player)} shoots a random troop from ${nameOf(s, other(player))}'s rack: ${TROOPS[typeOf(s, id)].name} is discarded.`);
        break;
      }
      case 'battlefield': {
        const i = Math.floor(rng() * opp.rack.length);
        opp.frozen = opp.rack[i];
        log(s, `A sniper freezes one of ${nameOf(s, other(player))}'s troops until the end of their next turn.`);
        break;
      }
      case 'extra':
        queue.shift();
        s.phase = 'extra';
        s.pending = { kind: 'extra', fromTroops: true };
        log(s, `${nameOf(s, player)} calls for an extra troop.`);
        return;
      case 'discardAdjacent': {
        if (!info.targets.includes(action.base)) fail('Pick an enemy troop next to Jumbo');
        const id = s.stacks[action.base].pop();
        s.discard.push(id);
        log(s, `Jumbo sends ${TROOPS[typeOf(s, id)].name} to the discard.`);
        break;
      }
      case 'castle': {
        if (!info.targets.includes(action.base)) fail('Pick one of your other troops on the board');
        const id = s.stacks[action.base].pop();
        me.rack.push(id);
        log(s, `${nameOf(s, player)} calls a troop back to the rack.`);
        break;
      }
      case 'volcano': {
        const move = info.moves.find((m) => m.from === action.from && m.to === action.to);
        if (!move) fail('Pick an enemy troop next to the volcano and a base next to it to move it to');
        s.stacks[move.to].push(s.stacks[move.from].pop());
        log(s, `The volcano erupts and shoves an enemy troop to a neighbouring base.`);
        break;
      }
      case 'cemetery': {
        if (!info.targets.includes(action.troop)) fail('Pick one of your troops from the discard');
        s.discard = s.discard.filter((id) => id !== action.troop);
        me.rack.push(action.troop);
        log(s, `${nameOf(s, player)} raises a troop from the discard.`);
        break;
      }
      default:
        fail('Unknown effect');
    }
    queue.shift();
    s.pending = null;
    checkRegions(s);
    advance(s);
  }

  // ---------- actions ----------

  // Returns a new state; throws Error(message) for illegal actions.
  function apply(state, player, action, rng = Math.random) {
    const fail = (m) => {
      throw new Error(m);
    };
    if (action.type === 'rematch') {
      if (state.phase !== 'over') fail('The game is still running');
      return newGame(state.players.map((p) => p.name), other(state.starter), state.terrain, rng);
    }
    const s = clone(state);
    if (!s.players[player]) fail('Unknown player');
    if (s.phase === 'over') fail('The game is over');
    if (player !== s.active) fail("It's not your turn");

    if (s.phase === 'turn') {
      if (action.type === 'draw') {
        if (!canDraw(s, player)) fail(s.players[player].rack.length >= RULES.rack ? 'Your rack is full' : 'Your reserve is empty');
        const n = drawInto(s, player, 2);
        log(s, `${nameOf(s, player)} draws ${n} troop${n === 1 ? '' : 's'}.`);
        s.last = { who: player, draw: n };
        endTurn(s);
      } else if (action.type === 'place') {
        place(s, player, action.troop, action.slot);
        if (s.phase !== 'over') advance(s);
      } else fail('Draw 2 troops or place 1 troop');
    } else if (s.phase === 'effect') {
      if (action.type !== 'effect') fail('Decide about the effect first');
      if (action.use === false) {
        (s.pending.fromTroops ? s.effects : s.baseEffects).shift();
        s.pending = null;
        advance(s);
      } else useEffect(s, player, action, rng);
    } else if (s.phase === 'extra') {
      if (action.type === 'effect' && action.use === false) {
        s.pending = null;
        advance(s);
      } else if (action.type === 'place') {
        place(s, player, action.troop, action.slot);
        if (s.phase !== 'over') advance(s);
      } else fail("Place the extra troop, or skip it");
    }
    return s;
  }

  // Every action the player could take right now (used by the computer player and the tests).
  function legalActions(s, player) {
    if (s.phase === 'over' || s.active !== player) return [];
    const out = [];
    const placements = () => {
      for (const troop of placeableTroops(s, player)) for (const slot of legalSlots(s, player, troop)) out.push({ type: 'place', troop, slot });
    };
    if (s.phase === 'turn') {
      if (canDraw(s, player)) out.push({ type: 'draw' });
      placements();
    } else if (s.phase === 'extra') {
      placements();
      out.push({ type: 'effect', use: false });
    } else if (s.phase === 'effect') {
      out.push({ type: 'effect', use: false });
      const e = s.pending;
      const info = effectInfo(s, player, e);
      if (info.usable) {
        if (e.kind === 'discardAdjacent' || e.kind === 'castle') for (const base of info.targets) out.push({ type: 'effect', use: true, base });
        else if (e.kind === 'cemetery') for (const troop of info.targets) out.push({ type: 'effect', use: true, troop });
        else if (e.kind === 'volcano') for (const m of info.moves) out.push({ type: 'effect', use: true, from: m.from, to: m.to });
        else out.push({ type: 'effect', use: true });
      }
    }
    return out;
  }

  // What a given player may see: the other rack, both reserves and the removed troops are hidden, and so is the
  // identity of any troop that is not on the board, in the discard or on their own rack.
  function viewFor(state, player) {
    const v = clone(state);
    v.players.forEach((p, i) => {
      p.reserveCount = p.reserve.length;
      p.reserve = null;
      if (i !== player) {
        p.frozenCount = p.frozen ? 1 : 0;
        p.frozen = null;
        p.rack = p.rack.map(() => null);
      }
    });
    v.removed = null;
    const visible = new Set([...Object.values(v.stacks).flat(), ...v.discard, ...v.players[player].rack]);
    v.troops = Object.fromEntries(Object.entries(state.troops).filter(([id]) => visible.has(id)));
    return v;
  }

  const api = {
    RULES, TROOPS, newGame, apply, viewFor, legalActions, legalSlots, slotProblem, connectedSlots, placeableTroops,
    effectInfo, canDraw, canAct, topOf, occupant, typeOf, ownerOf, strengthOf, canCover, boardOf, adjacentBases,
  };
  if (cjs) module.exports = api;
  else root.ToyBattle = api;
})(typeof window !== 'undefined' ? window : globalThis);
