// Browser smoke test: boots the game headlessly, plays a few scripted moves and
// simulates many frames at several depths, failing on any page error.
// Usage: node test/smoke.js [screenshot-dir]
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const shots = process.argv[2];
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1152, height: 648 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.stack || e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await page.waitForFunction(() => window.DM && window.DM.debug);
  const shot = async (name) => { if (shots) await page.screenshot({ path: path.join(shots, name + '.png') }); };
  await page.waitForTimeout(300);
  await shot('1-title');

  await page.keyboard.press('Enter');
  await page.waitForFunction(() => DM.debug.state === 'play');
  await page.waitForTimeout(400);
  await shot('2-play');

  const result = await page.evaluate(() => {
    const d = DM.debug, dt = 1 / 60;
    const tap = (a, frames) => { d.press(a); for (let i = 0; i < (frames || 1); i++) d.step(dt); d.release(a); d.step(dt); };
    const log = {};
    const T = DM.Level.T, W = DM.Level.W;
    d.G.hp = 99;

    // dig straight down through one tile
    const tyBefore = Math.floor((d.P.y + d.P.h + 2) / d.TILE), tx = Math.floor((d.P.x + 5) / d.TILE);
    d.Lv.tiles[tyBefore * W + tx] = T.DIRT;
    d.press('down');
    for (let i = 0; i < 6; i++) { tap('pick'); for (let k = 0; k < 20; k++) d.step(dt); }
    d.release('down');
    log.dugDown = d.Lv.tiles[tyBefore * W + tx] === T.AIR;

    // rope up and climb
    const ropes0 = d.G.rope;
    tap('rope');
    log.ropeUsed = d.G.rope === ropes0 - 1 && d.Lv.ropes.size > 0;
    const y0 = d.P.y;
    tap('up', 40);
    log.climbed = d.P.y < y0 - 10;
    tap('jump'); for (let k = 0; k < 60; k++) d.step(dt);

    // dynamite removes terrain
    const solid0 = d.Lv.tiles.reduce((n, t) => n + (DM.Level.isSolid(t) ? 1 : 0), 0);
    tap('bomb');
    for (let k = 0; k < 200; k++) d.step(dt);
    log.blasted = d.Lv.tiles.reduce((n, t) => n + (DM.Level.isSolid(t) ? 1 : 0), 0) < solid0;

    // ride the lift, shop, descend
    d.P.x = d.Lv.exit.x * d.TILE + 3; d.P.y = d.Lv.exit.y * d.TILE + 2; d.P.vy = 0; d.P.invuln = 5;
    for (let k = 0; k < 10; k++) d.step(dt);
    tap('up');
    log.shop = d.state === 'shop';
    d.G.gold = 5000;
    tap('up'); tap('up'); tap('up'); tap('up'); // wraps to "Dynamite"
    const dyn0 = d.G.dyn;
    tap('jump');
    log.bought = d.G.dyn === dyn0 + 3 && d.G.gold < 5000;
    tap('up');
    tap('jump');
    log.descended = d.state === 'play' && d.G.depth === 2;

    // soak: random inputs for a long time at many depths
    const acts = ['left', 'right', 'up', 'down', 'jump', 'pick', 'bomb', 'rope'];
    for (let depth = 2; depth <= 9; depth++) {
      d.G.hp = 99; d.G.dyn = 20; d.G.rope = 20; d.G.oil = depth % 3 ? 100 : 1;
      for (let f = 0; f < 3600; f++) {
        if (f % 7 === 0) {
          const a = acts[Math.floor(Math.random() * acts.length)];
          if (Math.random() < 0.5) d.press(a); else d.release(a);
        }
        d.step(dt);
        if (!isFinite(d.P.x) || !isFinite(d.P.y)) throw new Error('player position went non-finite');
        if (d.state === 'shop') { acts.forEach(d.release); d.press('jump'); d.step(dt); d.release('jump'); }
        if (d.state === 'dead') throw new Error('died with 99 hp?');
      }
      acts.forEach(d.release);
      // jump to the lift and move on
      d.P.x = d.Lv.exit.x * d.TILE + 3; d.P.y = d.Lv.exit.y * d.TILE + 2; d.P.vx = d.P.vy = 0; d.P.climb = false; d.P.stun = 0; d.P.invuln = 5;
      for (let k = 0; k < 20 && d.state === 'play'; k++) { d.step(dt); tap('up'); }
      if (d.state === 'shop') tap('jump');
    }
    log.soakedAllDepths = d.G.depth >= 10;

    // death -> game over -> restart
    d.G.hp = 1; d.G.oil = 0; d.Lv.darkT = 8.9;
    for (let k = 0; k < 200; k++) d.step(dt);
    log.died = d.state === 'dead';
    return log;
  });
  await page.waitForTimeout(300);
  await shot('3-dead');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => DM.debug.state === 'play');
  await browser.close();

  console.log(result);
  const failed = Object.entries(result).filter(([k, v]) => v === false).map(([k]) => k);
  if (errors.length || failed.length) {
    console.error('FAILED', failed, errors);
    process.exit(1);
  }
  console.log('smoke test passed');
})();
