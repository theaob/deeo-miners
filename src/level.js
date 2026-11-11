/*
 * Deeo Miners — procedural mine generation.
 *
 * Pure logic, no DOM: loaded with a <script> tag in the browser (window.DM.Level)
 * and with require() from the Node tests.
 *
 * A mine is a 4x4 grid of rooms. A guaranteed route is walked from a room in the
 * top row down to a room in the bottom row; corridors and drop shafts are carved
 * along it so the lift can always be reached without spending any tools. Every
 * other room is filled with random side caves, where most of the loot hides.
 */
(function (root) {
  'use strict';

  const T = { AIR: 0, DIRT: 1, STONE: 2, ROCK: 3, BEDROCK: 4, ORE: 5, GEM: 6, SPIKE: 7, LAVA: 8 };
  const ROOM_W = 10, ROOM_H = 8, COLS = 4, ROWS = 4;
  const W = COLS * ROOM_W + 2, H = ROWS * ROOM_H + 2;

  const isSolid = (t) => t >= T.DIRT && t <= T.GEM;
  const isHazard = (t) => t === T.SPIKE || t === T.LAVA;

  // mulberry32
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function build(seed, depth) {
    const r = rng(seed);
    const ri = (a, b) => a + Math.floor(r() * (b - a + 1));
    const chance = (p) => r() < p;
    const tiles = new Uint8Array(W * H);
    const at = (x, y) => tiles[y * W + x];
    const set = (x, y, t) => { tiles[y * W + x] = t; };
    const interior = (x, y) => x >= 1 && y >= 1 && x < W - 1 && y < H - 1;
    const roomX = (c) => 1 + c * ROOM_W;
    const roomY = (rw) => 1 + rw * ROOM_H;

    // --- base material: blotchy dirt/stone mix, stonier with depth
    const stoneRatio = Math.min(0.75, 0.1 + depth * 0.09);
    const blocks = [];
    for (let i = 0; i < Math.ceil(W / 3) * Math.ceil(H / 3); i++) blocks.push(r());
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const n = blocks[Math.floor(y / 3) * Math.ceil(W / 3) + Math.floor(x / 3)] * 0.7 + r() * 0.3;
        set(x, y, n < stoneRatio ? T.STONE : T.DIRT);
      }
    }
    // hard rock blobs: only dynamite gets through these
    for (let i = 0, n = 2 + Math.min(6, depth); i < n; i++) {
      const cx = ri(3, W - 4), cy = ri(3, H - 4), rad = 1 + r() * 1.6;
      for (let y = cy - 3; y <= cy + 3; y++) {
        for (let x = cx - 3; x <= cx + 3; x++) {
          if (interior(x, y) && Math.hypot(x - cx, y - cy) <= rad + r() * 0.6) set(x, y, T.ROCK);
        }
      }
    }

    // --- side caves (drunkard walks)
    for (let i = 0, n = 10 + ri(0, 4); i < n; i++) {
      let x = ri(3, W - 4), y = ri(3, H - 4);
      for (let s = 0, len = ri(30, 60); s < len; s++) {
        set(x, y, T.AIR);
        if (chance(0.5)) set(x, Math.max(2, y - 1), T.AIR);
        const d = r();
        if (d < 0.35) x++; else if (d < 0.7) x--; else if (d < 0.85) y++; else y--;
        x = Math.max(2, Math.min(W - 3, x));
        y = Math.max(2, Math.min(H - 3, y));
      }
    }

    // --- guaranteed route through the room grid
    const path = [];
    const shafts = []; // {c, r, x}
    let c = ri(0, COLS - 1), row = 0, dir = chance(0.5) ? 1 : -1;
    path.push({ c, r: row });
    for (;;) {
      let drop = chance(0.3);
      if (!drop) {
        const nc = c + dir;
        if (nc < 0 || nc >= COLS) drop = true;
        else { c = nc; path.push({ c, r: row }); }
      }
      if (drop) {
        if (row === ROWS - 1) break;
        shafts.push({ c, r: row, x: roomX(c) + ri(2, 6) });
        row++;
        path.push({ c, r: row });
        dir = chance(0.5) ? 1 : -1;
      }
    }

    const floorY = [];
    const range = [];
    for (let rw = 0; rw < ROWS; rw++) {
      floorY.push(roomY(rw) + 5 + ri(0, 1));
      const cols = path.filter((p) => p.r === rw).map((p) => p.c);
      range.push([roomX(Math.min(...cols)) + 1, roomX(Math.max(...cols)) + ROOM_W - 2]);
    }

    // corridors
    for (let rw = 0; rw < ROWS; rw++) {
      const fy = floorY[rw];
      for (let x = range[rw][0]; x <= range[rw][1]; x++) {
        set(x, fy, T.AIR);
        set(x, fy - 1, T.AIR);
        if (chance(0.75)) {
          set(x, fy - 2, T.AIR);
          if (chance(0.25)) set(x, fy - 3, T.AIR);
        }
      }
    }
    // drop shafts
    for (const s of shafts) {
      for (let y = floorY[s.r] - 1; y <= floorY[s.r + 1]; y++) {
        set(s.x, y, T.AIR);
        set(s.x + 1, y, T.AIR);
      }
    }
    // solid floors under the corridors
    const reserved = []; // per row: Set of x that must stay plain floor
    for (let rw = 0; rw < ROWS; rw++) {
      const res = new Set();
      const holes = new Set();
      for (const s of shafts) {
        if (s.r === rw) { holes.add(s.x); holes.add(s.x + 1); }
        if (s.r === rw || s.r === rw - 1) for (let d = -2; d <= 3; d++) res.add(s.x + d);
      }
      for (let x = range[rw][0]; x <= range[rw][1]; x++) {
        if (!holes.has(x) && !isSolid(at(x, floorY[rw] + 1))) set(x, floorY[rw] + 1, T.DIRT);
      }
      reserved.push(res);
    }

    // spawn + exit lift
    const pick = (rw, col) => {
      for (let tries = 0; tries < 50; tries++) {
        const x = roomX(col) + ri(1, ROOM_W - 2);
        if (x >= range[rw][0] && x <= range[rw][1] && !reserved[rw].has(x)) return x;
      }
      return -1;
    };
    const first = path[0], last = path[path.length - 1];
    const sx = pick(0, first.c), ex = pick(ROWS - 1, last.c);
    if (sx < 0 || ex < 0) return null;
    const spawn = { x: sx, y: floorY[0] };
    const exit = { x: ex, y: floorY[ROWS - 1] };
    for (let d = -1; d <= 1; d++) { reserved[0].add(sx + d); reserved[ROWS - 1].add(ex + d); }

    // corridor obstacles: bumps, spike pits, lava pools
    for (let rw = 0; rw < ROWS; rw++) {
      const fy = floorY[rw];
      let lastPit = -99;
      for (let x = range[rw][0] + 1; x < range[rw][1] - 1; x++) {
        if (reserved[rw].has(x)) continue;
        if (chance(0.08)) {
          set(x, fy, T.DIRT);
          set(x, fy - 2, T.AIR);
        } else if (chance(0.05 + depth * 0.006) && !reserved[rw].has(x + 1) && x - lastPit >= 5 &&
                   isSolid(at(x - 1, fy + 1)) && !isSolid(at(x - 1, fy))) {
          const haz = depth >= 4 && chance(0.5) ? T.LAVA : T.SPIKE;
          for (let d = 0; d < 2; d++) {
            set(x + d, fy + 1, haz);
            set(x + d, fy, T.AIR);
            set(x + d, fy - 1, T.AIR);
            set(x + d, fy - 2, T.AIR);
            if (fy + 2 < H - 1 && !isSolid(at(x + d, fy + 2))) set(x + d, fy + 2, T.DIRT);
          }
          lastPit = x;
          x += 2;
        }
      }
    }

    // --- ore veins
    const gemRate = 0.025 + depth * 0.005;
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const t = at(x, y);
        if (t === T.DIRT && chance(0.06)) set(x, y, T.ORE);
        else if (t === T.STONE && chance(gemRate)) set(x, y, T.GEM);
      }
    }

    // --- bedrock shell
    for (let x = 0; x < W; x++) { set(x, 0, T.BEDROCK); set(x, H - 1, T.BEDROCK); }
    for (let y = 0; y < H; y++) { set(0, y, T.BEDROCK); set(W - 1, y, T.BEDROCK); }

    // --- inhabitants and loot
    const entities = [];
    const enemyRate = 0.035 + depth * 0.008;
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        if (at(x, y) !== T.AIR) continue;
        const far = Math.abs(x - spawn.x) + Math.abs(y - spawn.y) > 6;
        const isExit = x === exit.x && y === exit.y;
        if (isSolid(at(x, y + 1)) && !isExit) {
          const u = r();
          if (u < enemyRate) {
            if (far) entities.push({ type: depth >= 2 && chance(0.35) ? 'slime' : 'beetle', x, y });
          } else if (u < enemyRate + 0.11) entities.push({ type: 'gold', x, y });
          else if (u < enemyRate + 0.14) entities.push({ type: 'crate', x, y });
          else if (u < enemyRate + 0.155) entities.push({ type: 'oil', x, y });
        } else if (isSolid(at(x, y - 1)) && at(x, y + 1) === T.AIR && at(x, y + 2) === T.AIR && far) {
          const u = r();
          if (u < 0.03 + depth * 0.006) entities.push({ type: 'bat', x, y });
          else if (u < 0.08 + depth * 0.008 && at(x, y + 3) === T.AIR) entities.push({ type: 'stalactite', x, y });
        }
      }
    }

    return { W, H, tiles, spawn, exit, entities, seed, depth };
  }

  /*
   * Conservative reachability check: can a miner with no tools walk, hop and
   * drop from the spawn to the lift? Uses a simplified move set that is a
   * subset of what the real physics allow.
   */
  function isSolvable(level) {
    const { tiles, spawn, exit } = level;
    const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? T.BEDROCK : tiles[y * W + x]);
    const open = (x, y) => at(x, y) === T.AIR;
    const stand = (x, y) => open(x, y) && isSolid(at(x, y + 1));
    const seen = new Uint8Array(W * H);
    const queue = [];
    const push = (x, y) => {
      if (!seen[y * W + x]) { seen[y * W + x] = 1; queue.push(x, y); }
    };
    if (!stand(spawn.x, spawn.y) || !stand(exit.x, exit.y)) return false;
    push(spawn.x, spawn.y);
    while (queue.length) {
      const y = queue.pop(), x = queue.pop();
      if (x === exit.x && y === exit.y) return true;
      for (const dx of [-1, 1]) {
        const nx = x + dx;
        if (open(nx, y)) {
          let yy = y;
          while (open(nx, yy + 1)) yy++;
          if (!isHazard(at(nx, yy + 1)) && yy - y <= 10) push(nx, yy);
        } else {
          for (let h = 1; h <= 2; h++) {
            if (!open(x, y - h)) break;
            if (stand(nx, y - h)) { push(nx, y - h); break; }
          }
        }
        for (let d = 2; d <= 3; d++) {
          const tx = x + dx * d;
          let clear = open(x, y - 1);
          for (let i = 1; i <= d && clear; i++) clear = open(x + dx * i, y) && open(x + dx * i, y - 1);
          if (!clear) break;
          if (stand(tx, y)) push(tx, y);
        }
      }
    }
    return false;
  }

  function generate(seed, depth) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const lvl = build((seed + attempt * 7919) >>> 0, depth);
      if (lvl && isSolvable(lvl)) return lvl;
    }
    throw new Error('could not generate a solvable mine for seed ' + seed);
  }

  const api = { T, W, H, ROOM_W, ROOM_H, COLS, ROWS, isSolid, isHazard, rng, generate, isSolvable, build };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.DM = root.DM || {}).Level = api;
})(typeof window !== 'undefined' ? window : globalThis);
