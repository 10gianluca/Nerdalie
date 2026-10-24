/* The 8 terrains. Each is a graph: nodes are bases, special bases and H.Q.s; edges are the paths between them;
   regions are closed rings of bases that hold medals. Coordinates are in a 100 x 150 box, player 0 (blue) at the bottom.

   These layouts are ORIGINAL designs in the style of the real game, not copies of the physical boards: the official
   rules and the troop and special-base effects are the real ones, but where the bases, paths and regions sit, how many
   medals each region holds and the medal targets are my own choices. */
(function (root) {
  'use strict';

  const rotate = (x, y) => [100 - x, 150 - y]; // a half turn: the way the two sides face each other

  function finish(spec) {
    const nodes = {};
    for (const n of spec.nodes) nodes[n.id] = n;
    const adj = {};
    for (const id of Object.keys(nodes)) adj[id] = [];
    const seen = new Set();
    const edges = [];
    for (const [a, b] of spec.edges) {
      const key = [a, b].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push([a, b]);
      adj[a].push(b);
      adj[b].push(a);
    }
    const regions = spec.regions.map((r, i) => {
      const pts = r.bases.map((b) => nodes[b]);
      return {
        id: 'r' + i, bases: r.bases, medals: r.medals,
        x: pts.reduce((t, p) => t + p.x, 0) / pts.length, y: pts.reduce((t, p) => t + p.y, 0) / pts.length,
      };
    });
    const hqs = [[], []];
    for (const n of spec.nodes) if (n.kind === 'hq') hqs[n.side].push(n.id);
    return {
      id: spec.id, name: spec.name, rule: spec.rule, nodes, edges, adj, regions, hqs,
      bases: spec.nodes.filter((n) => n.kind === 'base').map((n) => n.id),
      targets: spec.targets, medalTotal: regions.reduce((t, r) => t + r.medals, 0), blurb: spec.blurb,
    };
  }

  // Builds a board that looks the same from both sides: only the bottom half and the middle are written out,
  // and the top half is the same shape turned round. Ids in the top half are the bottom ids with "t_" in front.
  function symmetric(spec) {
    const mid = new Map();
    for (const c of spec.center) if (c[3] && c[3].mirror) mid.set(c[0], c[3].mirror);
    const centerIds = new Set(spec.center.map((c) => c[0]));
    const bottomIds = new Set(spec.bottom.map((b) => b[0]));
    const m = (id) => {
      if (id.startsWith('hq0')) return 'hq1' + id.slice(3);
      if (id.startsWith('hq1')) return 'hq0' + id.slice(3);
      if (centerIds.has(id)) return mid.get(id) || id;
      if (bottomIds.has(id)) return 't_' + id;
      return id.slice(2);
    };
    const nodes = [];
    const add = (id, x, y, o = {}) => nodes.push({ id, x, y, kind: 'base', special: !!o.special, only: o.only || null });
    for (const [id, x, y, o] of spec.bottom) {
      add(id, x, y, o);
      const [rx, ry] = rotate(x, y);
      add(m(id), rx, ry, o);
    }
    for (const [id, x, y, o] of spec.center) add(id, x, y, o);
    for (const [id, x, y] of spec.hq) {
      const [rx, ry] = rotate(x, y);
      nodes.push({ id, x, y, kind: 'hq', side: 0, only: spec.hqOnly || null });
      nodes.push({ id: m(id), x: rx, y: ry, kind: 'hq', side: 1, only: spec.hqOnly || null });
    }
    const edges = [];
    for (const [a, b] of spec.edges) edges.push([a, b], [m(a), m(b)]);
    const regions = [];
    const have = new Set();
    for (const r of spec.regions) {
      for (const bases of [r.bases, r.bases.map(m)]) {
        const key = bases.slice().sort().join('|');
        if (have.has(key)) continue;
        have.add(key);
        regions.push({ bases, medals: r.medals });
      }
    }
    return finish({ id: spec.id, name: spec.name, rule: spec.rule, blurb: spec.blurb, targets: spec.targets, nodes, edges, regions });
  }

  // A board written out in full (for the lopsided one).
  function explicit(spec) {
    const nodes = [];
    for (const [id, x, y, o = {}] of spec.bases) nodes.push({ id, x, y, kind: 'base', special: !!o.special, only: o.only || null });
    for (const [id, x, y, side] of spec.hq) nodes.push({ id, x, y, kind: 'hq', side, only: null });
    return finish({ id: spec.id, name: spec.name, rule: spec.rule, blurb: spec.blurb, targets: spec.targets, nodes, edges: spec.edges, regions: spec.regions });
  }

  const BOARDS = {};
  const define = (board) => { BOARDS[board.id] = board; };

  define(symmetric({
    id: 'castle', name: 'Castle Field', rule: 'castle', targets: [7, 7],
    blurb: 'Two castles face off across a field. A good first board.',
    bottom: [['d1', 12, 98], ['d2', 50, 98, { special: true }], ['d3', 88, 98], ['e1', 28, 122], ['e2', 72, 122]],
    center: [['c1', 30, 75, { mirror: 'c2' }], ['c2', 70, 75, { mirror: 'c1' }]],
    hq: [['hq0', 50, 142]],
    edges: [
      ['hq0', 'e1'], ['hq0', 'e2'], ['d1', 'e1'], ['d2', 'e1'], ['d2', 'e2'], ['d3', 'e2'],
      ['c1', 'd1'], ['c1', 'd2'], ['c2', 'd2'], ['c2', 'd3'], ['c1', 'c2'], ['d1', 't_d3'],
    ],
    regions: [
      { bases: ['d1', 'c1', 'd2', 'e1'], medals: 2 },
      { bases: ['d3', 'c2', 'd2', 'e2'], medals: 2 },
      { bases: ['d1', 'c1', 't_d3'], medals: 2 },
      { bases: ['d2', 'c1', 'c2'], medals: 1 },
    ],
  }));

  define(symmetric({
    id: 'pool', name: 'Tropical Pool', rule: 'pool', targets: [6, 6], hqOnly: [4, 5, 6, 7],
    blurb: 'Buoys and the H.Q. only take certain strengths: the jokers can sneak in anywhere.',
    bottom: [['L4', 20, 95], ['M4', 50, 95, { special: true, only: [1, 2, 3] }], ['R4', 80, 95], ['L5', 25, 120], ['R5', 75, 120]],
    center: [['C', 50, 75, { special: true, only: [3, 4, 5] }]],
    hq: [['hq0', 50, 142]],
    edges: [
      ['hq0', 'L5'], ['hq0', 'R5'], ['L5', 'L4'], ['L5', 'M4'], ['R5', 'M4'], ['R5', 'R4'],
      ['L4', 'M4'], ['M4', 'R4'], ['L4', 'C'], ['M4', 'C'], ['R4', 'C'],
    ],
    regions: [
      { bases: ['L5', 'L4', 'M4'], medals: 1 }, { bases: ['R5', 'M4', 'R4'], medals: 1 },
      { bases: ['L4', 'M4', 'C'], medals: 2 }, { bases: ['M4', 'R4', 'C'], medals: 2 },
    ],
  }));

  define(symmetric({
    id: 'clouds', name: 'City of Clouds', rule: 'clouds', targets: [6, 6],
    blurb: 'Two long rails with rungs between them. The cloud bases let you draw.',
    bottom: [['L3', 22, 93], ['R3', 78, 93, { special: true }], ['L4', 22, 120], ['R4', 78, 120]],
    center: [['C', 50, 75]],
    hq: [['hq0', 50, 142]],
    edges: [
      ['hq0', 'L4'], ['hq0', 'R4'], ['L4', 'R4'], ['L3', 'L4'], ['R3', 'R4'], ['L3', 'R3'], ['C', 'L3'], ['C', 'R3'], ['L3', 't_R3'],
    ],
    regions: [
      { bases: ['L3', 'R3', 'R4', 'L4'], medals: 3 },
      { bases: ['C', 'L3', 'R3'], medals: 1 },
      { bases: ['t_R3', 'C', 'L3'], medals: 2 },
    ],
  }));

  define(symmetric({
    id: 'volcano', name: 'Volcanic Jungle', rule: 'volcano', targets: [6, 6],
    blurb: 'Everything runs through the volcano in the middle.',
    bottom: [['S3', 18, 88, { special: true }], ['S4', 82, 88], ['D1', 35, 118], ['D2', 65, 118]],
    center: [['V', 50, 75, { special: true }]],
    hq: [['hq0', 50, 142]],
    edges: [
      ['hq0', 'D1'], ['hq0', 'D2'], ['D1', 'D2'], ['D1', 'V'], ['D2', 'V'], ['S3', 'V'], ['S4', 'V'], ['S3', 'D1'], ['S4', 'D2'], ['S3', 't_S4'],
    ],
    regions: [
      { bases: ['D1', 'D2', 'V'], medals: 2 },
      { bases: ['S3', 'D1', 'V'], medals: 1 },
      { bases: ['S4', 'D2', 'V'], medals: 1 },
      { bases: ['t_S4', 'S3', 'V'], medals: 2 },
    ],
  }));

  define(symmetric({
    id: 'cemetery', name: 'Cursed Cemetery', rule: 'cemetery', targets: [7, 7],
    blurb: 'A grid of graves. The cursed bases bring your fallen troops back.',
    bottom: [['i1', 20, 95], ['i2', 50, 95, { special: true }], ['i3', 80, 95], ['j1', 20, 120], ['j2', 50, 120], ['j3', 80, 120]],
    center: [],
    hq: [['hq0', 50, 142]],
    edges: [
      ['hq0', 'j1'], ['hq0', 'j2'], ['hq0', 'j3'], ['i1', 'i2'], ['i2', 'i3'], ['j1', 'j2'], ['j2', 'j3'],
      ['i1', 'j1'], ['i2', 'j2'], ['i3', 'j3'], ['i1', 't_i3'], ['i2', 't_i2'], ['i3', 't_i1'],
    ],
    regions: [
      { bases: ['i1', 'i2', 'j2', 'j1'], medals: 2 },
      { bases: ['i2', 'i3', 'j3', 'j2'], medals: 2 },
      { bases: ['t_i3', 't_i2', 'i2', 'i1'], medals: 3 },
    ],
  }));

  define(explicit({
    id: 'caribbean', name: 'Caribbean Sea', rule: 'caribbean', targets: [5, 6],
    blurb: 'Unequal sides: blue defends two H.Q. but needs fewer medals; red has just one.',
    bases: [
      ['A1', 30, 32], ['A2', 70, 32], ['B1', 14, 58], ['B2', 50, 58], ['B3', 86, 58], ['C1', 30, 85], ['C2', 70, 85],
      ['D1', 18, 112], ['D2', 50, 112], ['D3', 82, 112],
    ],
    hq: [['hq1', 50, 8, 1], ['hq0a', 22, 142, 0], ['hq0b', 78, 142, 0]],
    edges: [
      ['hq1', 'A1'], ['hq1', 'A2'], ['A1', 'B1'], ['A1', 'B2'], ['A2', 'B2'], ['A2', 'B3'], ['B1', 'C1'], ['B2', 'C1'], ['B2', 'C2'],
      ['B3', 'C2'], ['C1', 'C2'], ['C1', 'D1'], ['C1', 'D2'], ['C2', 'D2'], ['C2', 'D3'], ['D1', 'D2'], ['D2', 'D3'],
      ['hq0a', 'D1'], ['hq0a', 'D2'], ['hq0b', 'D2'], ['hq0b', 'D3'],
    ],
    regions: [
      { bases: ['A1', 'B1', 'C1', 'B2'], medals: 2 }, { bases: ['A2', 'B3', 'C2', 'B2'], medals: 2 }, { bases: ['B2', 'C1', 'C2'], medals: 1 },
      { bases: ['C1', 'C2', 'D2'], medals: 2 }, { bases: ['C1', 'D1', 'D2'], medals: 2 }, { bases: ['C2', 'D2', 'D3'], medals: 2 },
    ],
  }));

  define(symmetric({
    id: 'metal', name: 'Station Metal-X', rule: 'metal', targets: [8, 8],
    blurb: 'Troop effects are switched off on the shielded bases.',
    bottom: [['A', 66, 120], ['B', 34, 120], ['C', 50, 98, { special: true }], ['W', 78, 90], ['E', 22, 90]],
    center: [['K', 50, 75]],
    hq: [['hq0', 50, 142]],
    edges: [
      ['hq0', 'A'], ['hq0', 'B'], ['A', 'B'], ['A', 'C'], ['B', 'C'], ['A', 'W'], ['B', 'E'], ['W', 'C'], ['E', 'C'], ['W', 'K'], ['E', 'K'], ['C', 'K'],
      ['E', 't_W'],
    ],
    regions: [
      { bases: ['A', 'B', 'C'], medals: 1 }, { bases: ['A', 'C', 'W'], medals: 1 }, { bases: ['B', 'C', 'E'], medals: 1 },
      { bases: ['W', 'C', 'K'], medals: 2 }, { bases: ['E', 'C', 'K'], medals: 2 },
      { bases: ['t_W', 'K', 'E'], medals: 1 },
    ],
  }));

  define(symmetric({
    id: 'battlefield', name: 'Battlefield', rule: 'battlefield', targets: [7, 7],
    blurb: 'Two H.Q. each: take either one to win. Snipers freeze your troops.',
    bottom: [['P', 20, 115], ['Q', 50, 118], ['R', 80, 115], ['S', 35, 95, { special: true }], ['T', 65, 95, { special: true }]],
    center: [['U', 15, 75, { mirror: 'W' }], ['V', 50, 75], ['W', 85, 75, { mirror: 'U' }]],
    hq: [['hq0a', 28, 142], ['hq0b', 72, 142]],
    edges: [
      ['hq0a', 'P'], ['hq0a', 'Q'], ['hq0b', 'Q'], ['hq0b', 'R'], ['P', 'Q'], ['Q', 'R'], ['P', 'S'], ['Q', 'S'], ['Q', 'T'], ['R', 'T'],
      ['S', 'T'], ['S', 'U'], ['S', 'V'], ['T', 'V'], ['T', 'W'], ['U', 'V'], ['W', 'V'], ['P', 'U'], ['R', 'W'],
    ],
    regions: [
      { bases: ['S', 'T', 'V'], medals: 1 }, { bases: ['S', 'U', 'V'], medals: 1 }, { bases: ['T', 'V', 'W'], medals: 1 },
      { bases: ['P', 'S', 'U'], medals: 2 }, { bases: ['R', 'T', 'W'], medals: 2 },
    ],
  }));

  const ORDER = ['castle', 'pool', 'clouds', 'volcano', 'cemetery', 'caribbean', 'metal', 'battlefield'];
  const api = { BOARDS, ORDER, get: (id) => BOARDS[id], rotate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ToyBoards = api;
})(typeof window !== 'undefined' ? window : globalThis);
