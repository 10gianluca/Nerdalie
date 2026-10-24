const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../boards.js');

const segIntersect = (p, q, r, s) => {
  const o = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = o(p, q, r), d2 = o(p, q, s), d3 = o(r, s, p), d4 = o(r, s, q);
  return d1 * d2 < 0 && d3 * d4 < 0;
};

for (const id of B.ORDER) {
  const b = B.get(id);

  test(`${id}: paths never cross each other`, () => {
    for (let i = 0; i < b.edges.length; i++) {
      for (let j = i + 1; j < b.edges.length; j++) {
        const [a1, a2] = b.edges[i];
        const [c1, c2] = b.edges[j];
        if ([a1, a2].some((n) => n === c1 || n === c2)) continue;
        assert.equal(segIntersect(b.nodes[a1], b.nodes[a2], b.nodes[c1], b.nodes[c2]), false, `${a1}-${a2} crosses ${c1}-${c2}`);
      }
    }
  });

  test(`${id}: every region is a closed ring of bases`, () => {
    for (const r of b.regions) {
      assert.ok(r.bases.length >= 3, `${r.id} is too small`);
      r.bases.forEach((base, i) => {
        assert.equal(b.nodes[base].kind, 'base', `${base} is not a base`);
        const next = r.bases[(i + 1) % r.bases.length];
        assert.ok(b.adj[base].includes(next), `${r.id}: ${base} is not joined to ${next}`);
      });
      assert.ok(r.medals >= 1);
    }
  });

  test(`${id}: both sides can reach every base and the other H.Q., and the medals add up`, () => {
    for (const side of [0, 1]) {
      const seen = new Set(b.hqs[side]);
      const queue = [...b.hqs[side]];
      while (queue.length) for (const n of b.adj[queue.pop()]) if (!seen.has(n)) { seen.add(n); queue.push(n); }
      for (const base of b.bases) assert.ok(seen.has(base), `${base} unreachable from side ${side}`);
      for (const hq of b.hqs[1 - side]) assert.ok(seen.has(hq));
    }
    assert.ok(b.medalTotal <= 16, 'the game only has 16 medal markers');
    assert.ok(b.targets[0] <= b.medalTotal && b.targets[1] <= b.medalTotal);
    assert.ok(b.hqs[0].length >= 1 && b.hqs[1].length >= 1);
    for (const hq of [...b.hqs[0], ...b.hqs[1]]) assert.ok(b.adj[hq].length >= 2, `${hq} should have two ways in`);
  });
}

test('every board except the Caribbean one looks the same from both sides', () => {
  for (const id of B.ORDER.filter((i) => i !== 'caribbean')) {
    const b = B.get(id);
    for (const n of Object.values(b.nodes)) {
      const [rx, ry] = B.rotate(n.x, n.y);
      const twin = Object.values(b.nodes).find((o) => Math.abs(o.x - rx) < 0.01 && Math.abs(o.y - ry) < 0.01);
      assert.ok(twin, `${id}: ${n.id} has no twin`);
      assert.equal(twin.special, n.special);
      assert.equal(twin.kind, n.kind);
    }
    assert.equal(b.hqs[0].length, b.hqs[1].length);
    assert.equal(b.targets[0], b.targets[1]);
  }
});

test('the Caribbean board has two blue H.Q. and one red H.Q.', () => {
  const b = B.get('caribbean');
  assert.equal(b.hqs[0].length, 2);
  assert.equal(b.hqs[1].length, 1);
});
