/* Deeo Miners — game loop, physics, entities, rendering. */
(function () {
  'use strict';
  const DM = window.DM;
  const L = DM.Level, T = L.T, W = L.W, H = L.H;
  const { spr, zone, PAL } = DM.Sprites;
  const sfx = DM.Audio.sfx;

  const TILE = 16, VW = 384, VH = 216;
  const GRAV = 900, MAXFALL = 420, RUN = 95, JUMP = 300, CLIMB = 70;
  const MAX_HP = 6;
  const TILE_HP = { [T.DIRT]: 2, [T.ORE]: 2, [T.STONE]: 4, [T.GEM]: 4 };

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const dark = DM.Sprites.canvas(VW, VH);
  const dctx = dark.getContext('2d');
  let SCALE = 1;
  const touchMode = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  if (touchMode) document.body.classList.add('touch');

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const pad = document.getElementById('touch');
    const availH = document.body.clientHeight - (touchMode && pad ? pad.offsetHeight : 0);
    const cs = getComputedStyle(document.body);
    const availW = document.documentElement.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    SCALE = Math.max(1, Math.floor(Math.min(availW / VW, availH / VH) * dpr));
    canvas.width = VW * SCALE;
    canvas.height = VH * SCALE;
    canvas.style.width = (VW * SCALE) / dpr + 'px';
    canvas.style.height = (VH * SCALE) / dpr + 'px';
  }
  window.addEventListener('resize', resize);

  // ------------------------------------------------------------ input
  const KEYS = {
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
    KeyZ: 'jump', Space: 'jump', KeyK: 'jump',
    KeyX: 'pick', KeyJ: 'pick', KeyC: 'bomb', KeyL: 'bomb', KeyV: 'rope', KeyI: 'rope',
    Enter: 'enter', KeyP: 'pause', Escape: 'pause', KeyM: 'mute',
  };
  const held = {}, pressed = {};
  function press(a) { if (!held[a]) pressed[a] = true; held[a] = true; DM.Audio.unlock(); }
  function release(a) { held[a] = false; }
  window.addEventListener('keydown', (e) => {
    const a = KEYS[e.code];
    if (!a) return;
    e.preventDefault();
    if (!e.repeat) press(a);
  });
  window.addEventListener('keyup', (e) => { const a = KEYS[e.code]; if (a) release(a); });
  window.addEventListener('blur', () => { for (const k in held) held[k] = false; });
  canvas.addEventListener('pointerdown', () => { window.focus(); press('enter'); setTimeout(() => release('enter'), 50); });
  document.querySelectorAll('[data-act]').forEach((b) => {
    const a = b.dataset.act;
    const down = (e) => { e.preventDefault(); b.classList.add('on'); press(a); };
    const up = (e) => { e.preventDefault(); b.classList.remove('on'); release(a); };
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('pointerleave', up);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  });

  // ------------------------------------------------------------ state
  let state = 'title'; // title | play | shop | dead
  let paused = false;
  let G = null;   // the run: depth, hp, supplies, gold
  let Lv = null;  // the current mine
  let P = null;   // the player
  let cam = { x: 0, y: 0 };
  let shake = 0, flash = 0, clock = 0, shopSel = 0, deadT = 0;
  let best = 0;
  try { best = parseInt(localStorage.getItem('deeo-miners-best'), 10) || 0; } catch (e) { /* storage unavailable */ }

  const rand = (a, b) => a + Math.random() * (b - a);
  const tileAt = (tx, ty) => (tx < 0 || ty < 0 || tx >= W || ty >= H ? T.BEDROCK : Lv.tiles[ty * W + tx]);
  const solidAt = (tx, ty) => L.isSolid(tileAt(tx, ty));
  const solidPx = (x, y) => solidAt(Math.floor(x / TILE), Math.floor(y / TILE));
  const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const cxOf = (e) => e.x + e.w / 2, cyOf = (e) => e.y + e.h / 2;

  function newRun() {
    G = { depth: 1, hp: 4, dyn: 4, rope: 4, oil: 100, gold: 0, score: 0, seed: (Math.random() * 0x7fffffff) | 0, kills: 0 };
    startLevel();
    state = 'play';
  }

  function startLevel() {
    const lvl = L.generate(G.seed + G.depth * 101, G.depth);
    Lv = {
      tiles: lvl.tiles, exit: lvl.exit, hp: new Map(), ropes: new Set(), ents: [], parts: [], texts: [],
      zone: zone(G.depth), banner: 3, darkT: 0,
    };
    P = {
      x: lvl.spawn.x * TILE + 3, y: lvl.spawn.y * TILE + 2, w: 10, h: 14, vx: 0, vy: 0, face: 1,
      ground: false, climb: false, jumping: false, coyote: 0, jbuf: 0, invuln: 0, stun: 0,
      swing: 0, swingDir: [1, 0], pickCd: 0, climbCd: 0, peakY: 0, anim: 0, dead: false,
    };
    P.peakY = P.y;
    for (const e of lvl.entities) spawn(e.type, e.x, e.y);
    cam.x = cxOf(P) - VW / 2; cam.y = cyOf(P) - VH / 2;
    clampCam();
  }

  function spawn(type, tx, ty) {
    const px = tx * TILE, py = ty * TILE;
    const base = { type, vx: 0, vy: 0, anim: Math.random() * 10, flash: 0, ground: false };
    let e;
    switch (type) {
      case 'beetle': e = { x: px + 2, y: py + 9, w: 12, h: 7, hp: 1, dir: Math.random() < 0.5 ? -1 : 1 }; break;
      case 'slime': e = { x: px + 2, y: py + 8, w: 12, h: 8, hp: 2, timer: rand(0.5, 1.5) }; break;
      case 'bat': e = { x: px + 2, y: py, w: 12, h: 6, hp: 1, mode: 'hang' }; break;
      case 'stalactite': e = { x: px + 4, y: py, w: 8, h: 12, mode: 'hang', timer: 0 }; break;
      case 'crate': e = { x: px + 2, y: py + 4, w: 12, h: 12 }; break;
      case 'gold': return drop('gold', px + 8, py + 12, 0, 0, 100);
      case 'oil': return drop('oil', px + 8, py + 10, 0, 0);
      default: return null;
    }
    Object.assign(e, base);
    Lv.ents.push(e);
    return e;
  }

  function drop(kind, x, y, vx, vy, value) {
    const s = { gold: [6, 5], gem: [7, 6], oil: [8, 8], heart: [7, 6], dyn: [6, 8], rope: [7, 7] }[kind];
    const e = { type: 'pickup', kind, x: x - s[0] / 2, y: y - s[1], w: s[0], h: s[1], vx: vx || 0, vy: vy || 0, age: 0, value: value || 0, ground: false };
    Lv.ents.push(e);
    return e;
  }

  // ------------------------------------------------------------ physics
  function moveX(e, dx) {
    e.x += dx;
    const y0 = Math.floor(e.y / TILE), y1 = Math.floor((e.y + e.h - 0.01) / TILE);
    if (dx > 0) {
      const tx = Math.floor((e.x + e.w - 0.01) / TILE);
      for (let ty = y0; ty <= y1; ty++) if (solidAt(tx, ty)) { e.x = tx * TILE - e.w; return true; }
    } else if (dx < 0) {
      const tx = Math.floor(e.x / TILE);
      for (let ty = y0; ty <= y1; ty++) if (solidAt(tx, ty)) { e.x = (tx + 1) * TILE; return true; }
    }
    return false;
  }
  function moveY(e, dy) {
    e.y += dy;
    const x0 = Math.floor(e.x / TILE), x1 = Math.floor((e.x + e.w - 0.01) / TILE);
    if (dy > 0) {
      const ty = Math.floor((e.y + e.h - 0.01) / TILE);
      for (let tx = x0; tx <= x1; tx++) if (solidAt(tx, ty)) { e.y = ty * TILE - e.h; return true; }
    } else if (dy < 0) {
      const ty = Math.floor(e.y / TILE);
      for (let tx = x0; tx <= x1; tx++) if (solidAt(tx, ty)) { e.y = (ty + 1) * TILE; return true; }
    }
    return false;
  }
  function phys(e, dt, grav) {
    e.vy = Math.min(MAXFALL, e.vy + (grav === undefined ? GRAV : grav) * dt);
    const falling = e.vy > 0;
    const hx = moveX(e, e.vx * dt);
    const hy = moveY(e, e.vy * dt);
    e.ground = hy && falling;
    if (hy) e.vy = 0;
    return { hx, hy };
  }

  // ------------------------------------------------------------ effects
  function burst(x, y, color, n, speed) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = rand(0.2, 1) * (speed || 90);
      Lv.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 30, life: rand(0.25, 0.6), color, size: Math.random() < 0.4 ? 2 : 1 });
    }
  }
  function floatText(x, y, str, color) { Lv.texts.push({ x, y, str, color: color || '#fff', life: 0.9 }); }

  const TILE_COLOR = () => ({
    [T.DIRT]: Lv.zone.info.dirt[0], [T.ORE]: Lv.zone.info.dirt[0], [T.STONE]: Lv.zone.info.stone[0],
    [T.GEM]: Lv.zone.info.stone[0], [T.ROCK]: '#57505e', [T.SPIKE]: '#aab2c4',
  });

  function destroyTile(tx, ty) {
    const t = tileAt(tx, ty);
    if (t === T.AIR || t === T.BEDROCK || t === T.LAVA) return;
    const i = ty * W + tx;
    Lv.tiles[i] = T.AIR;
    Lv.hp.delete(i);
    const x = tx * TILE + 8, y = ty * TILE + 8;
    burst(x, y, TILE_COLOR()[t] || '#888', 8, 70);
    if (t === T.ORE) for (let n = 0; n < 2 + (Math.random() < 0.4 ? 1 : 0); n++) drop('gold', x, y + 3, rand(-50, 50), rand(-140, -60), 100);
    if (t === T.GEM) drop('gem', x, y + 3, rand(-30, 30), -120, 500);
  }

  function explode(x, y) {
    sfx('boom');
    shake = 9; flash = 0.12;
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    for (let yy = ty - 3; yy <= ty + 3; yy++) {
      for (let xx = tx - 3; xx <= tx + 3; xx++) {
        if (Math.hypot(xx - tx, yy - ty) <= 2.4) { destroyTile(xx, yy); Lv.ropes.delete(yy * W + xx); }
      }
    }
    burst(x, y, '#ffd24a', 26, 220);
    burst(x, y, '#e8642a', 20, 160);
    burst(x, y, '#555', 14, 100);
    const near = (e) => Math.hypot(cxOf(e) - x, cyOf(e) - y) < 46;
    for (const e of Lv.ents) {
      if (e.dead || !near(e)) continue;
      const kx = Math.sign(cxOf(e) - x) || 1;
      if (e.type === 'pickup') { e.vx = kx * rand(60, 160); e.vy = rand(-220, -120); }
      else if (e.type === 'dynamite') e.fuse = Math.min(e.fuse, 0.12);
      else if (e.type === 'crate') breakCrate(e);
      else if (e.type === 'stalactite') { e.dead = true; burst(cxOf(e), cyOf(e), PAL.a, 8, 80); }
      else damageEnemy(e, 9, kx);
    }
    if (!P.dead && near(P)) hurtPlayer(2, Math.sign(cxOf(P) - x) || 1, 'Blown up by your own dynamite');
  }

  // ------------------------------------------------------------ player
  function hurtPlayer(n, kx, cause, force) {
    if (P.dead || (P.invuln > 0 && !force)) return;
    G.hp -= n;
    P.invuln = 1.3; P.stun = 0.25; P.climb = false; P.jumping = false;
    P.vx = (kx || 0) * 130; P.vy = -170;
    shake = Math.max(shake, 5);
    burst(cxOf(P), cyOf(P), PAL.r, 8, 90);
    if (G.hp <= 0) {
      G.hp = 0; P.dead = true; deadT = 0; G.cause = cause || 'Lost to the mine';
      sfx('die');
      if (G.score > best) { best = G.score; try { localStorage.setItem('deeo-miners-best', String(best)); } catch (e) { /* ignore */ } }
    } else sfx('hurt');
  }

  function swingPick() {
    P.pickCd = 0.26; P.swing = 0.2;
    let dx = P.face, dy = 0;
    if (held.up) { dx = 0; dy = -1; } else if (held.down) { dx = 0; dy = 1; }
    P.swingDir = [dx, dy];
    const cx = cxOf(P), cy = cyOf(P);
    const hit = { x: cx + dx * 11 - 9, y: cy + dy * 11 - 9, w: 18, h: 18 };
    let struck = false;
    for (const e of Lv.ents) {
      if (e.dead || !overlap(hit, e)) continue;
      if (e.type === 'beetle' || e.type === 'slime' || e.type === 'bat') { damageEnemy(e, 1, dx || P.face); struck = true; }
      else if (e.type === 'crate') { breakCrate(e); struck = true; }
      else if (e.type === 'stalactite' && e.mode !== 'fall') { e.mode = 'fall'; struck = true; }
      else if (e.type === 'dynamite') { e.vx = (dx || P.face) * 160; e.vy = -140 + dy * 120; struck = true; }
    }
    if (struck) { sfx('hit'); return; }
    const tx = Math.floor((cx + dx * 13) / TILE), ty = Math.floor((cy + dy * 13) / TILE);
    const t = tileAt(tx, ty), i = ty * W + tx;
    const px = tx * TILE + 8 - dx * 8, py = ty * TILE + 8 - dy * 8;
    if (TILE_HP[t]) {
      const hp = (Lv.hp.has(i) ? Lv.hp.get(i) : TILE_HP[t]) - 1;
      if (hp <= 0) { destroyTile(tx, ty); sfx('crumble'); }
      else { Lv.hp.set(i, hp); burst(px, py, TILE_COLOR()[t], 4, 60); sfx('dig'); }
    } else if (t === T.ROCK || t === T.BEDROCK) {
      burst(px, py, '#fff6c8', 4, 80); sfx('clink');
      if (t === T.ROCK && !Lv.toldRock) { Lv.toldRock = true; floatText(cx, P.y - 6, 'Too hard — use dynamite', '#fff6c8'); }
    } else if (t === T.SPIKE) { destroyTile(tx, ty); sfx('clink'); }
  }

  function throwDynamite() {
    G.dyn--;
    const e = { type: 'dynamite', x: cxOf(P) - 3, y: P.y + 2, w: 6, h: 8, vx: P.face * 150 + P.vx * 0.5, vy: -190, fuse: 2.1, ground: false, anim: 0 };
    if (held.down) { e.vx = 0; e.vy = 0; e.y = P.y + P.h - 8; }
    else if (held.up) { e.vx = P.face * 50; e.vy = -330; }
    Lv.ents.push(e);
    sfx('fuse');
  }

  function useRope() {
    const tx = Math.floor(cxOf(P) / TILE), ty = Math.floor(cyOf(P) / TILE);
    const cells = [];
    if (held.down) {
      // hang a rope over the ledge in front
      const x = tx + P.face;
      for (let y = ty; y < ty + 10 && !solidAt(x, y); y++) cells.push(y * W + x);
      if (cells.length < 3) return fail('No drop here');
    } else {
      // throw a hook upward: it needs rock to bite into
      let top = -1;
      for (let y = ty - 1; y >= ty - 10 && !solidAt(tx, y); y--) {
        if (solidAt(tx, y - 1) || solidAt(tx - 1, y) || solidAt(tx + 1, y)) top = y;
      }
      if (top < 0) return fail('Nothing to hook');
      for (let y = top; y <= ty; y++) cells.push(y * W + tx);
    }
    for (const c of cells) Lv.ropes.add(c);
    G.rope--;
    sfx('rope');
    function fail(msg) { floatText(cxOf(P), P.y - 6, msg, '#fff6c8'); sfx('deny'); }
  }

  function updatePlayer(dt) {
    const p = P;
    if (p.dead) {
      p.vx *= 0.9;
      phys(p, dt);
      return;
    }
    p.invuln = Math.max(0, p.invuln - dt);
    p.stun = Math.max(0, p.stun - dt);
    p.swing = Math.max(0, p.swing - dt);
    p.pickCd -= dt; p.climbCd -= dt;
    const ax = (held.right ? 1 : 0) - (held.left ? 1 : 0);
    const tx = Math.floor(cxOf(p) / TILE), ty = Math.floor(cyOf(p) / TILE);
    const wasGround = p.ground;

    if (!p.climb && p.climbCd <= 0 && p.stun <= 0 && Lv.ropes.has(ty * W + tx) && (held.up || (held.down && !p.ground))) {
      p.climb = true; p.jumping = false;
    }

    if (p.climb) {
      p.x = tx * TILE + 8 - p.w / 2;
      p.vx = 0; p.vy = 0; p.ground = false;
      const dir = (held.down ? 1 : 0) - (held.up ? 1 : 0);
      if (dir) {
        const nty = Math.floor((cyOf(p) + dir * CLIMB * dt) / TILE);
        if (Lv.ropes.has(nty * W + tx)) {
          if (moveY(p, dir * CLIMB * dt) && dir > 0) p.climb = false;
          p.anim += dt * 8;
        } else if (dir > 0) p.climb = false;
      }
      if (!Lv.ropes.has(Math.floor(cyOf(p) / TILE) * W + tx)) p.climb = false;
      if (ax) p.face = ax;
      p.peakY = p.y;
      if (pressed.jump) {
        p.climb = false; p.climbCd = 0.25;
        if (!held.down) { p.vy = -JUMP * 0.85; p.vx = ax * RUN; p.jumping = true; sfx('jump'); }
      }
    } else {
      if (p.stun <= 0) {
        const target = ax * RUN, acc = (p.ground ? 1100 : 700) * dt;
        p.vx = p.vx < target ? Math.min(target, p.vx + acc) : Math.max(target, p.vx - acc);
        if (ax) p.face = ax;
      }
      p.coyote = p.ground ? 0.1 : p.coyote - dt;
      p.jbuf = pressed.jump ? 0.12 : p.jbuf - dt;
      if (p.jbuf > 0 && p.coyote > 0 && p.stun <= 0) {
        p.vy = -JUMP; p.jbuf = 0; p.coyote = 0; p.jumping = true;
        sfx('jump');
      }
      if (p.jumping && !held.jump && p.vy < -110) p.vy = -110;
      if (p.vy >= 0) p.jumping = false;
      const vyBefore = p.vy + GRAV * dt;
      if (phys(p, dt).hx) p.vx = 0;
      if (p.ground) {
        if (!wasGround) {
          const fell = (p.y - p.peakY) / TILE;
          if (fell > 16) hurtPlayer(2, 0, 'Fell too far', true);
          else if (fell > 10) hurtPlayer(1, 0, 'Fell too far', true);
          if (fell > 2) burst(cxOf(p), p.y + p.h, '#b8a890', 5, 40);
        }
        p.peakY = p.y;
        if (ax) p.anim += dt * 10; else p.anim = 0;
      } else {
        p.peakY = Math.min(p.peakY, p.y);
      }
      // hazards underfoot
      const fx = Math.floor(cxOf(p) / TILE), fy = Math.floor((p.y + p.h - 2) / TILE);
      const ft = tileAt(fx, fy);
      if (ft === T.SPIKE && vyBefore > 90 && (p.y + p.h) % TILE > 6) hurtPlayer(2, 0, 'Impaled on spikes');
      if (ft === T.LAVA || tileAt(fx, Math.floor(cyOf(p) / TILE)) === T.LAVA) {
        hurtPlayer(2, 0, 'Cooked in lava', true);
        p.vy = -330; p.peakY = p.y;
        burst(cxOf(p), p.y + p.h, '#ff9a3a', 10, 120);
      }
    }
    if (p.dead) return;

    if (pressed.pick && p.pickCd <= 0) swingPick();
    if (pressed.bomb) { if (G.dyn > 0) throwDynamite(); else sfx('deny'); }
    if (pressed.rope) { if (G.rope > 0) useRope(); else sfx('deny'); }

    // the lift
    const ex = Lv.exit.x * TILE, ey = Lv.exit.y * TILE;
    p.atExit = overlap(p, { x: ex + 2, y: ey, w: 12, h: 16 });
    if (p.atExit && (pressed.up || pressed.enter)) {
      sfx('exit');
      state = 'shop'; shopSel = shopItems().length - 1;
    }

    // lamp oil
    G.oil = Math.max(0, G.oil - dt * 0.62);
    if (G.oil <= 0) {
      Lv.darkT += dt;
      if (Lv.darkT > 9) {
        Lv.darkT = 0;
        floatText(cxOf(p), p.y - 6, 'The dark bites!', '#c9a0ff');
        hurtPlayer(1, 0, 'Swallowed by the dark', true);
      }
    } else Lv.darkT = 0;
  }

  // ------------------------------------------------------------ entities
  function damageEnemy(e, n, kx) {
    e.hp -= n;
    e.flash = 0.15;
    e.vx = kx * 90;
    if (e.type !== 'bat') e.vy = -130;
    if (e.type === 'bat') e.mode = 'fly';
    if (e.hp <= 0) {
      e.dead = true;
      G.kills++;
      burst(cxOf(e), cyOf(e), { beetle: PAL.r, slime: PAL.g, bat: PAL.p }[e.type], 12, 110);
      if (Math.random() < 0.35) drop('gold', cxOf(e), cyOf(e), rand(-40, 40), -120, 100);
    }
  }

  function breakCrate(e) {
    e.dead = true;
    burst(cxOf(e), cyOf(e), PAL.n, 12, 100);
    const u = Math.random();
    const kind = u < 0.4 ? 'dyn' : u < 0.75 ? 'rope' : u < 0.9 ? 'oil' : 'heart';
    drop(kind, cxOf(e), cyOf(e) + 4, 0, -150);
    sfx('crumble');
  }

  function touchPlayer(e) {
    if (P.dead || !overlap(e, P)) return;
    if (P.vy > 30 && P.y + P.h - e.y < 9 && !P.climb) {
      damageEnemy(e, 1, 0);
      P.vy = held.jump ? -JUMP : -220;
      P.jumping = !!held.jump;
      P.peakY = P.y;
      sfx('stomp');
    } else {
      hurtPlayer(1, Math.sign(cxOf(P) - cxOf(e)) || 1, { beetle: 'Bitten by a cave beetle', slime: 'Dissolved by a slime', bat: 'Drained by a bat' }[e.type]);
    }
  }

  function inLava(e) { return tileAt(Math.floor(cxOf(e) / TILE), Math.floor((e.y + e.h - 1) / TILE)) === T.LAVA; }

  const UPDATE = {
    beetle(e, dt) {
      e.anim += dt * 8; e.flash -= dt;
      if (e.ground && e.flash <= 0) {
        const ahead = e.dir > 0 ? e.x + e.w + 1 : e.x - 1;
        if (!solidPx(ahead, e.y + e.h + 2)) e.dir = -e.dir;
        e.vx = e.dir * 28;
      }
      if (phys(e, dt).hx) e.dir = -e.dir;
      if (inLava(e)) return damageEnemy(e, 9, 0);
      touchPlayer(e);
    },
    slime(e, dt) {
      e.anim += dt * 6; e.flash -= dt;
      if (e.ground) {
        e.vx = 0;
        e.timer -= dt;
        if (e.timer <= 0) {
          const dx = cxOf(P) - cxOf(e);
          const seen = Math.abs(dx) < 130 && Math.abs(cyOf(P) - cyOf(e)) < 70;
          e.vx = (seen ? Math.sign(dx) || 1 : Math.random() < 0.5 ? -1 : 1) * 62;
          e.vy = -240;
          e.timer = seen ? rand(0.6, 1.1) : rand(1.2, 2.4);
        }
      }
      if (phys(e, dt).hx) e.vx = -e.vx * 0.5;
      if (inLava(e)) return damageEnemy(e, 9, 0);
      touchPlayer(e);
    },
    bat(e, dt) {
      e.anim += dt * 12; e.flash -= dt;
      if (e.mode === 'hang') {
        const d = Math.hypot(cxOf(P) - cxOf(e), cyOf(P) - cyOf(e));
        if (d < 92 || !solidPx(cxOf(e), e.y - 2)) e.mode = 'fly';
      } else {
        const dx = cxOf(P) - cxOf(e), dy = cyOf(P) - 2 - cyOf(e), d = Math.hypot(dx, dy) || 1;
        if (e.flash <= 0 && !P.dead) {
          e.vx += ((dx / d) * 56 - e.vx) * Math.min(1, dt * 4);
          e.vy += ((dy / d) * 56 + Math.sin(e.anim) * 20 - e.vy) * Math.min(1, dt * 4);
        }
        if (moveX(e, e.vx * dt)) e.vx = -e.vx;
        if (moveY(e, e.vy * dt)) e.vy = -e.vy;
      }
      touchPlayer(e);
    },
    stalactite(e, dt) {
      if (e.mode === 'hang') {
        const below = cyOf(P) - e.y;
        if (!solidPx(cxOf(e), e.y - 2)) e.mode = 'fall';
        else if (Math.abs(cxOf(P) - cxOf(e)) < 13 && below > 0 && below < 130 && !P.dead) { e.mode = 'shake'; e.timer = 0.4; }
      } else if (e.mode === 'shake') {
        e.timer -= dt;
        if (e.timer <= 0) e.mode = 'fall';
      } else {
        const r = phys(e, dt);
        let smash = r.hy;
        if (!P.dead && overlap(e, P)) { hurtPlayer(1, 0, 'Skewered by a stalactite'); smash = true; }
        for (const o of Lv.ents) {
          if (!o.dead && o.hp && overlap(e, o)) { damageEnemy(o, 9, 0); smash = true; }
        }
        if (smash) { e.dead = true; burst(cxOf(e), e.y + e.h, PAL.a, 10, 90); sfx('crumble'); }
      }
    },
    crate(e, dt) { phys(e, dt); },
    dynamite(e, dt) {
      e.anim += dt;
      e.fuse -= dt;
      const vy = e.vy;
      const r = phys(e, dt);
      if (r.hx) e.vx = -e.vx * 0.4;
      if (r.hy) { e.vy = vy > 80 ? -vy * 0.3 : 0; e.vx *= 0.7; }
      if (Math.random() < 0.5) Lv.parts.push({ x: e.x + 3, y: e.y, vx: rand(-20, 20), vy: rand(-50, -10), life: 0.2, color: '#ffd24a', size: 1 });
      if (e.fuse <= 0 || inLava(e)) { e.dead = true; explode(cxOf(e), cyOf(e)); }
    },
    pickup(e, dt) {
      e.age += dt;
      if (!e.ground || e.vx || e.vy < 0) {
        const r = phys(e, dt);
        if (r.hx) e.vx = -e.vx * 0.5;
        if (e.ground) { e.vx *= 0.75; if (Math.abs(e.vx) < 4) e.vx = 0; }
      } else if (!solidPx(cxOf(e), e.y + e.h + 1)) e.ground = false;
      if (inLava(e)) { e.dead = true; return; }
      if (e.age > 0.3 && !P.dead && overlap(e, P)) collect(e);
    },
  };

  function collect(e) {
    const x = cxOf(e), y = e.y - 4;
    switch (e.kind) {
      case 'gold': case 'gem':
        G.gold += e.value; G.score += e.value;
        floatText(x, y, '+' + e.value, e.kind === 'gem' ? PAL.c : PAL.e);
        sfx(e.kind);
        break;
      case 'oil': G.oil = Math.min(100, G.oil + 35); floatText(x, y, '+oil', PAL.o); sfx('pickup'); break;
      case 'heart':
        if (G.hp >= MAX_HP) return;
        G.hp++; floatText(x, y, '+1 health', PAL.r); sfx('pickup');
        break;
      case 'dyn': G.dyn += 2; floatText(x, y, '+2 dynamite', PAL.r); sfx('pickup'); break;
      case 'rope': G.rope += 2; floatText(x, y, '+2 rope', PAL.n); sfx('pickup'); break;
    }
    e.dead = true;
  }

  // ------------------------------------------------------------ shop
  function shopItems() {
    const k = 1 + (G.depth - 1) * 0.1;
    const price = (n) => Math.round((n * k) / 50) * 50;
    return [
      { name: 'Dynamite x3', cost: price(400), buy() { G.dyn += 3; } },
      { name: 'Rope x3', cost: price(300), buy() { G.rope += 3; } },
      { name: 'Lamp oil (refill)', cost: price(350), can: () => G.oil < 99, buy() { G.oil = 100; } },
      { name: 'Bandage (+1 health)', cost: price(700), can: () => G.hp < MAX_HP, buy() { G.hp++; } },
      { name: 'Ride the lift down', cost: 0, leave: true },
    ];
  }

  function updateShop() {
    const items = shopItems();
    if (pressed.up) { shopSel = (shopSel + items.length - 1) % items.length; sfx('move'); }
    if (pressed.down) { shopSel = (shopSel + 1) % items.length; sfx('move'); }
    if (pressed.jump || pressed.enter || pressed.pick) {
      const it = items[shopSel];
      if (it.leave) {
        G.depth++;
        G.oil = Math.min(100, G.oil + 30);
        startLevel();
        state = 'play';
      } else if (G.gold >= it.cost && (!it.can || it.can())) {
        G.gold -= it.cost; it.buy(); sfx('buy');
      } else sfx('deny');
    }
  }

  // ------------------------------------------------------------ update
  function clampCam() {
    cam.x = Math.max(0, Math.min(W * TILE - VW, cam.x));
    cam.y = Math.max(0, Math.min(H * TILE - VH, cam.y));
  }

  function updateWorld(dt) {
    updatePlayer(dt);
    for (let i = 0; i < Lv.ents.length; i++) {
      const e = Lv.ents[i];
      if (!e.dead) UPDATE[e.type](e, dt);
    }
    Lv.ents = Lv.ents.filter((e) => !e.dead);
    for (const p of Lv.parts) { p.life -= dt; p.vy += 400 * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
    Lv.parts = Lv.parts.filter((p) => p.life > 0);
    for (const t of Lv.texts) { t.life -= dt; t.y -= 22 * dt; }
    Lv.texts = Lv.texts.filter((t) => t.life > 0);
    Lv.banner -= dt;
    cam.x += (cxOf(P) - VW / 2 - cam.x) * 0.14;
    cam.y += (cyOf(P) - VH / 2 - cam.y) * 0.14;
    clampCam();
  }

  function step(dt) {
    clock += dt;
    shake = Math.max(0, shake - dt * 30);
    flash = Math.max(0, flash - dt);
    if (pressed.mute) DM.Audio.toggleMute();
    if (state === 'title') {
      if (pressed.enter || pressed.jump) newRun();
    } else if (state === 'play') {
      if (pressed.pause && !P.dead) paused = !paused;
      if (!paused) {
        updateWorld(dt);
        if (P.dead) {
          deadT += dt;
          if (deadT > 1.2) state = 'dead';
        }
      }
    } else if (state === 'shop') {
      updateShop();
    } else if (state === 'dead') {
      updateWorld(dt);
      if (pressed.enter || pressed.jump) newRun();
    }
    for (const k in pressed) pressed[k] = false;
  }

  // ------------------------------------------------------------ render
  function text(str, x, y, color, align, size) {
    ctx.font = 'bold ' + (size || 8) + 'px "Courier New", monospace';
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillText(str, x + 1, y + 1);
    ctx.fillStyle = color || '#fff';
    ctx.fillText(str, x, y);
  }

  function drawWorld(showPlayer) {
    const ox = Math.round(cam.x + (shake ? rand(-shake, shake) * 0.5 : 0));
    const oy = Math.round(cam.y + (shake ? rand(-shake, shake) * 0.5 : 0));
    const Z = Lv.zone;
    const x0 = Math.max(0, Math.floor(ox / TILE)), x1 = Math.min(W - 1, Math.floor((ox + VW) / TILE));
    const y0 = Math.max(0, Math.floor(oy / TILE)), y1 = Math.min(H - 1, Math.floor((oy + VH) / TILE));
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, VW, VH);
    const lights = [];
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const t = Lv.tiles[ty * W + tx];
        const v = (tx * 7 + ty * 13 + ((tx * ty) % 5)) & 3;
        const x = tx * TILE - ox, y = ty * TILE - oy;
        if (L.isSolid(t)) {
          ctx.drawImage(Z[t][v], x, y);
          if (t !== T.BEDROCK) {
            if (!L.isSolid(tileAt(tx, ty - 1))) { ctx.fillStyle = t === T.ROCK ? '#6a6272' : Z.info.edge; ctx.fillRect(x, y, TILE, 2); }
            if (!L.isSolid(tileAt(tx, ty + 1))) { ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x, y + 14, TILE, 2); }
          }
          const hp = Lv.hp.get(ty * W + tx);
          if (hp !== undefined) {
            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            ctx.fillRect(x + 3, y + 4, 6, 1); ctx.fillRect(x + 8, y + 5, 1, 5); ctx.fillRect(x + 8, y + 9, 5, 1);
            if (hp < TILE_HP[t] / 2 + 0.5) { ctx.fillRect(x + 4, y + 11, 1, 3); ctx.fillRect(x + 11, y + 2, 1, 4); ctx.fillRect(x + 2, y + 7, 4, 1); }
          }
        } else {
          ctx.drawImage(Z.back[v], x, y);
          if (t === T.SPIKE) ctx.drawImage(spr.spike, x, y);
          else if (t === T.LAVA) {
            ctx.drawImage(Z.lava[(Math.floor(clock * 3) + tx) & 1], x, y);
            lights.push([x + 8, y + 4, 30]);
          }
          if (Lv.ropes.has(ty * W + tx)) {
            ctx.fillStyle = PAL.N; ctx.fillRect(x + 7, y, 2, TILE);
            ctx.fillStyle = PAL.n; ctx.fillRect(x + 7, y + 2, 2, 3); ctx.fillRect(x + 7, y + 10, 2, 3);
            if (!Lv.ropes.has((ty - 1) * W + tx)) { ctx.fillStyle = PAL.a; ctx.fillRect(x + 5, y, 6, 2); ctx.fillRect(x + 5, y, 1, 4); ctx.fillRect(x + 10, y, 1, 4); }
          }
        }
      }
    }
    // lift
    const ex = Lv.exit.x * TILE - ox, ey = Lv.exit.y * TILE - oy;
    ctx.drawImage(spr.exit, ex, ey);
    lights.push([ex + 8, ey + 8, 26]);

    for (const e of Lv.ents) {
      const x = Math.round(e.x - ox), y = Math.round(e.y - oy);
      if (x < -20 || y < -20 || x > VW + 20 || y > VH + 20) continue;
      const white = e.flash > 0;
      switch (e.type) {
        case 'beetle': { const k = Math.floor(e.anim) & 1 ? 'beetleA' : 'beetleB'; ctx.drawImage(white ? spr.white[k] : spr[k], x, y); break; }
        case 'slime': {
          const sq = e.ground ? Math.round(Math.sin(e.anim) * 1) : -2;
          ctx.drawImage(white ? spr.white.slime : spr.slime, x - (sq > 0 ? 1 : 0), y + sq, 12 + (sq > 0 ? 2 : 0), 8 - sq);
          break;
        }
        case 'bat': { const k = e.mode === 'hang' ? 'batHang' : Math.floor(e.anim) & 1 ? 'batA' : 'batB'; ctx.drawImage(white ? spr.white[k] : spr[k], x, y); break; }
        case 'stalactite': ctx.drawImage(spr.stalactite, x + (e.mode === 'shake' ? Math.round(Math.sin(clock * 60)) : 0), y); break;
        case 'crate': ctx.drawImage(spr.crate, x, y); break;
        case 'dynamite':
          ctx.drawImage(spr.dynamite, x, y);
          if (e.fuse < 0.6 && Math.floor(e.fuse * 20) & 1) { ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect(x + 1, y + 2, 4, 6); }
          lights.push([x + 3, y + 2, 34]);
          break;
        case 'pickup': {
          const k = { gold: 'gold', gem: 'gem', oil: 'oil', heart: 'heart', dyn: 'dynamite', rope: 'rope' }[e.kind];
          ctx.drawImage(spr[k], x, y);
          if (e.kind === 'gem') lights.push([x + 3, y + 3, 14]);
          break;
        }
      }
    }

    if (showPlayer) drawPlayer(ox, oy);

    for (const p of Lv.parts) { ctx.fillStyle = p.color; ctx.fillRect(Math.round(p.x - ox), Math.round(p.y - oy), p.size, p.size); }

    // darkness, with holes punched by the lamp and other glows
    const lampR = (state === 'title' ? 110 : 34 + 100 * Math.sqrt(G.oil / 100)) * (1 + Math.sin(clock * 13) * 0.015);
    lights.push([cxOf(P) - ox + (showPlayer ? P.face * 3 : 0), cyOf(P) - oy - 3, lampR]);
    dctx.globalCompositeOperation = 'source-over';
    dctx.clearRect(0, 0, VW, VH);
    dctx.fillStyle = 'rgba(5,4,10,0.97)';
    dctx.fillRect(0, 0, VW, VH);
    dctx.globalCompositeOperation = 'destination-out';
    for (const [lx, ly, r] of lights) {
      const g = dctx.createRadialGradient(lx, ly, r * 0.2, lx, ly, r);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      dctx.fillStyle = g;
      dctx.fillRect(lx - r, ly - r, r * 2, r * 2);
    }
    ctx.drawImage(dark, 0, 0);

    for (const t of Lv.texts) {
      ctx.globalAlpha = Math.min(1, t.life * 2.5);
      text(t.str, Math.round(t.x - ox), Math.round(t.y - oy), t.color, 'center', 7);
    }
    ctx.globalAlpha = 1;
    if (flash > 0) { ctx.fillStyle = 'rgba(255,240,200,' + flash * 4 + ')'; ctx.fillRect(0, 0, VW, VH); }
  }

  function drawPlayer(ox, oy) {
    const p = P;
    if (p.invuln > 0 && !p.dead && Math.floor(clock * 20) & 1) return;
    const x = Math.round(p.x - ox) - 1, y = Math.round(p.y - oy);
    let frame = 'idle';
    if (p.climb) frame = Math.floor(p.anim) & 1 ? 'runA' : 'idle';
    else if (!p.ground) frame = 'jump';
    else if (Math.abs(p.vx) > 10) frame = Math.floor(p.anim) & 1 ? 'runA' : 'runB';
    const img = spr.player[frame][p.face > 0 ? 0 : 1];
    if (p.dead) {
      ctx.save();
      ctx.translate(x + 6, y + 11);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(img, -6, -7);
      ctx.restore();
      return;
    }
    ctx.drawImage(img, x, y);
    if (p.swing > 0) {
      const [dx, dy] = p.swingDir;
      const k = 1 - p.swing / 0.2;
      const side = dx || p.face;
      const base = dy < 0 ? -Math.PI / 2 : dy > 0 ? Math.PI / 2 : 0;
      ctx.save();
      ctx.translate(x + 6 + side * 2, y + 8);
      ctx.scale(side, 1);
      ctx.rotate(base * side + (-1.1 + k * 1.7));
      ctx.fillStyle = PAL.n; ctx.fillRect(0, -1, 11, 2);
      ctx.fillStyle = PAL.a; ctx.fillRect(9, -5, 2, 10);
      ctx.fillStyle = '#e8ecf4'; ctx.fillRect(8, -6, 2, 2); ctx.fillRect(8, 4, 2, 2);
      ctx.restore();
    }
  }

  function drawHud() {
    for (let i = 0; i < Math.max(4, G.hp); i++) ctx.drawImage(i < G.hp ? spr.heart : spr.heartEmpty, 6 + i * 9, 6);
    ctx.drawImage(spr.dynamite, 7, 16); text(String(G.dyn), 16, 17, '#fff');
    ctx.drawImage(spr.rope, 34, 17); text(String(G.rope), 44, 17, '#fff');
    ctx.drawImage(spr.gold, 7, 29); text('$' + G.gold, 16, 28, PAL.e);
    text('DEPTH ' + G.depth, VW - 6, 6, '#fff', 'right');
    // oil gauge
    ctx.drawImage(spr.oil, VW - 78, 17);
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(VW - 67, 19, 61, 5);
    const low = G.oil < 25;
    ctx.fillStyle = low && Math.floor(clock * 4) & 1 ? '#ff5a3a' : PAL.o;
    ctx.fillRect(VW - 66, 20, Math.round(59 * G.oil / 100), 3);
    if (G.oil <= 0) text('LAMP OUT — find oil or the lift!', VW / 2, 30, '#c9a0ff', 'center');

    if (Lv.banner > 0) {
      ctx.globalAlpha = Math.min(1, Lv.banner);
      text('DEPTH ' + G.depth, VW / 2, 60, '#fff', 'center', 16);
      text(Lv.zone.info.name, VW / 2, 80, PAL.e, 'center', 9);
      ctx.globalAlpha = 1;
    }
    if (P.atExit && !P.dead) text(touchMode ? '▲ ride the lift' : 'Press UP to ride the lift', VW / 2, VH - 30, PAL.e, 'center');
    if (paused) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, VW, VH);
      text('PAUSED', VW / 2, 90, '#fff', 'center', 16);
      text('P to resume · M to mute', VW / 2, 112, '#aab2c4', 'center');
    }
  }

  function panel(x, y, w, h) {
    ctx.fillStyle = 'rgba(10,8,16,0.88)'; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = PAL.N; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    ctx.strokeStyle = PAL.n; ctx.lineWidth = 1; ctx.strokeRect(x + 3.5, y + 3.5, w - 7, h - 7);
  }

  function drawTitle() {
    cam.x = (W * TILE - VW) / 2 + Math.sin(clock * 0.13) * 120;
    cam.y = (H * TILE - VH) / 2 + Math.cos(clock * 0.1) * 130;
    P.x = cam.x + VW / 2; P.y = cam.y + VH / 2;
    drawWorld(false);
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, 0, VW, VH);
    text('DEEO MINERS', VW / 2, 34, PAL.e, 'center', 30);
    text('dig deep · get rich · get out', VW / 2, 68, '#fff6c8', 'center', 9);
    const rows = touchMode
      ? ['Pick digs dirt and stone, and whacks critters', 'Hold ▲ or ▼ while digging to dig up or down', 'TNT blasts hard rock · Rope: hook up, ▼ + rope hangs it down a ledge', 'Your lamp burns oil. Find the lift before it runs dry.']
      : ['ARROWS / WASD  move & climb       Z / SPACE  jump', 'X  pickaxe (hold UP / DOWN to aim)    C  dynamite', 'V  rope (hold DOWN to hang it off a ledge)   P  pause', 'Your lamp burns oil. Find the lift before it runs dry.'];
    rows.forEach((r, i) => text(r, VW / 2, 98 + i * 13, i === 3 ? PAL.o : '#d8dce8', 'center', 8));
    if (Math.floor(clock * 2) & 1) text(touchMode ? 'TAP TO START' : 'PRESS ENTER TO START', VW / 2, 166, '#fff', 'center', 11);
    if (best) text('BEST HAUL  $' + best, VW / 2, 190, PAL.e, 'center');
  }

  function drawShop() {
    drawWorld(true);
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, VW, VH);
    panel(72, 26, 240, 164);
    text('SUPPLY CART', VW / 2, 36, PAL.e, 'center', 14);
    text('Depth ' + G.depth + ' cleared — you have $' + G.gold, VW / 2, 56, '#fff6c8', 'center');
    shopItems().forEach((it, i) => {
      const y = 76 + i * 17 + (it.leave ? 8 : 0);
      const ok = it.leave || (G.gold >= it.cost && (!it.can || it.can()));
      if (i === shopSel) { ctx.fillStyle = 'rgba(255,216,74,0.16)'; ctx.fillRect(84, y - 3, 216, 14); text('▶', 88, y, PAL.e); }
      text(it.name, 102, y, ok ? '#fff' : '#6c7488');
      if (!it.leave) text('$' + it.cost, 292, y, ok ? PAL.e : '#6c7488', 'right');
    });
    text('♥ ' + G.hp + '   dynamite ' + G.dyn + '   rope ' + G.rope + '   oil ' + Math.round(G.oil) + '%', VW / 2, 164, '#aab2c4', 'center', 7);
    text(touchMode ? '▲ ▼ choose · JUMP to buy' : 'UP / DOWN choose · Z or ENTER to buy', VW / 2, 176, '#6c7488', 'center', 7);
  }

  function drawDead() {
    ctx.fillStyle = 'rgba(20,0,0,0.6)'; ctx.fillRect(0, 0, VW, VH);
    panel(82, 46, 220, 124);
    text('THE MINE WINS', VW / 2, 58, PAL.r, 'center', 16);
    text(G.cause + '.', VW / 2, 82, '#fff6c8', 'center');
    text('Reached depth ' + G.depth, VW / 2, 100, '#fff', 'center');
    text('Total haul  $' + G.score, VW / 2, 113, PAL.e, 'center');
    text('Critters squashed  ' + G.kills, VW / 2, 126, '#fff', 'center');
    if (G.score && G.score >= best) text('NEW BEST!', VW / 2, 139, PAL.c, 'center');
    if (Math.floor(clock * 2) & 1) text(touchMode ? 'TAP TO DIG AGAIN' : 'PRESS ENTER TO DIG AGAIN', VW / 2, 153, '#fff', 'center');
  }

  function render() {
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    ctx.imageSmoothingEnabled = false;
    if (state === 'title') drawTitle();
    else if (state === 'shop') drawShop();
    else {
      drawWorld(true);
      drawHud();
      if (state === 'dead') drawDead();
    }
  }

  // ------------------------------------------------------------ main loop
  let last = 0, acc = 0;
  const STEP = 1 / 60;
  function frame(now) {
    acc += Math.min(0.1, (now - last) / 1000 || 0);
    last = now;
    while (acc >= STEP) { step(STEP); acc -= STEP; }
    render();
    requestAnimationFrame(frame);
  }

  // backdrop mine for the title screen
  G = { depth: 1, hp: 4, dyn: 0, rope: 0, oil: 100, gold: 0, score: 0, seed: (Math.random() * 1e6) | 0, kills: 0 };
  startLevel();
  Lv.ents = Lv.ents.filter((e) => e.type === 'pickup' || e.type === 'crate' || e.type === 'stalactite');
  resize();
  requestAnimationFrame(frame);

  // hooks for automated tests
  DM.debug = {
    get state() { return state; }, get G() { return G; }, get P() { return P; }, get Lv() { return Lv; },
    step, press, release, TILE,
  };
})();
