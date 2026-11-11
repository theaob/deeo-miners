const test = require('node:test');
const assert = require('node:assert');
const L = require('../src/level.js');

test('generation is deterministic for a seed', () => {
  const a = L.generate(1234, 3), b = L.generate(1234, 3);
  assert.deepStrictEqual(Array.from(a.tiles), Array.from(b.tiles));
  assert.deepStrictEqual(a.entities, b.entities);
  assert.deepStrictEqual(a.spawn, b.spawn);
});

test('every mine is reachable without tools, at every depth', () => {
  let retries = 0;
  for (let depth = 1; depth <= 12; depth++) {
    for (let seed = 1; seed <= 150; seed++) {
      const lvl = L.generate(seed * 104729, depth);
      assert.ok(L.isSolvable(lvl), `seed ${seed} depth ${depth}`);
      if (lvl.seed !== (seed * 104729) >>> 0) retries++;
    }
  }
  // the generator may re-roll, but it should rarely need to
  assert.ok(retries < 1800 * 0.25, `too many re-rolls: ${retries}`);
});

test('mines are sealed in bedrock and have sane spawn/exit', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const { tiles, spawn, exit, entities } = L.generate(seed, 5);
    for (let x = 0; x < L.W; x++) {
      assert.strictEqual(tiles[x], L.T.BEDROCK);
      assert.strictEqual(tiles[(L.H - 1) * L.W + x], L.T.BEDROCK);
    }
    for (let y = 0; y < L.H; y++) {
      assert.strictEqual(tiles[y * L.W], L.T.BEDROCK);
      assert.strictEqual(tiles[y * L.W + L.W - 1], L.T.BEDROCK);
    }
    assert.ok(exit.y > spawn.y + L.ROOM_H * 2, 'lift is well below the entrance');
    for (const e of entities) {
      assert.strictEqual(tiles[e.y * L.W + e.x], L.T.AIR, `${e.type} spawns in open air`);
    }
  }
});
