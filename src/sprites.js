/* Deeo Miners — all art is generated at load time from pixel maps and noise. */
(function () {
  'use strict';
  const DM = (window.DM = window.DM || {});

  const PAL = {
    k: '#1a1420', w: '#ffffff', y: '#f2c230', Y: '#c8922a', l: '#fff6c8', s: '#f0b48a',
    b: '#3f6fd8', B: '#2c4c9c', d: '#5a4634', r: '#d24a34', R: '#8f2a22',
    g: '#6fd456', G: '#3a8f35', p: '#9a6fe0', P: '#5a3a96', o: '#e8902a', O: '#a85e18',
    n: '#9a6a36', N: '#5e3a1c', a: '#aab2c4', A: '#6c7488', c: '#6ee8f0', C: '#2a9fb8',
    e: '#ffd84a', E: '#c8922a',
  };

  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  function make(rows) {
    const w = Math.max(...rows.map((r) => r.length));
    const c = canvas(w, rows.length);
    const g = c.getContext('2d');
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const col = PAL[row[x]];
        if (col) { g.fillStyle = col; g.fillRect(x, y, 1, 1); }
      }
    });
    return c;
  }

  function flip(src) {
    const c = canvas(src.width, src.height);
    const g = c.getContext('2d');
    g.translate(src.width, 0); g.scale(-1, 1);
    g.drawImage(src, 0, 0);
    return c;
  }

  function tint(src, color) {
    const c = canvas(src.width, src.height);
    const g = c.getContext('2d');
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
    return c;
  }

  // sprites facing right; [right, left] pairs are built below
  const body = [
    '....yyyyy...',
    '...yyyyyyl..',
    '...YyyyyyY..',
    '...sssssss..',
    '...ssksskk..',
    '...sssssss..',
    '..bbbbbbbb..',
    '.sbbbbbbbbs.',
    '.sBbbbbbbBs.',
    '..BbbbbbbB..',
    '..dddddddd..',
  ];
  const legs = {
    idle: ['..ddd..ddd..', '..ddd..ddd..', '..kkk..kkk..'],
    runA: ['..ddd...ddd.', '.ddd.....dd.', '.kkk.....kkk'],
    runB: ['...dddddd...', '...ddddd....', '...kkkkk....'],
    jump: ['..ddd..ddd..', '.ddd....ddd.', '.kk......kk.'],
  };

  const defs = {
    beetleA: ['............', '...RrrrrR...', '..rrrrrrrr..', '.krrRrrRrrk.', '.rrrrrrrrrr.', '.RrrrrrrrrR.', '..k.k..k.k..'],
    beetleB: ['............', '...RrrrrR...', '..rrrrrrrr..', '.krrRrrRrrk.', '.rrrrrrrrrr.', '.RrrrrrrrrR.', '.k..k..k..k.'],
    slime: ['...gggggg...', '..gggggggg..', '.ggwkggwkgg.', '.gggggggggg.', 'gggggggggggg', 'gggggggggggg', 'GGGGGGGGGGGG', '.GGGGGGGGGG.'],
    batA: ['P..........P', 'PP...pp...PP', 'PPP.pppp.PPP', 'PPPPprprPPPP', '.PP.pppp.PP.', '....p..p....'],
    batB: ['............', '.....pp.....', '....pppp....', '.PPPprprPPP.', 'PPPPppppPPPP', 'PP..p..p..PP'],
    batHang: ['....pppp....', '...PppppP...', '...PprprP...', '...PppppP...', '....PppP....', '.....pp.....'],
    stalactite: ['aaaaaaaa', 'aaaaaaaa', '.aAaaaa.', '.aAaaaa.', '.aAaaa..', '..aAaa..', '..aAaa..', '..aAa...', '...Aa...', '...Aa...', '...a....', '...a....'],
    dynamite: ['...n..', '..n...', '.rrrr.', '.rwwr.', '.rrrr.', '.rrrr.', '.rwwr.', '.RRRR.'],
    gold: ['.eee..', 'eewee.', 'eeeeE.', '.eEEE.', '..EE..'],
    gem: ['..ccc..', '.cwccC.', 'cwcccCC', '.cccCC.', '..cCC..', '...C...'],
    oil: ['..aa....', '..AA.aa.', '.oooooa.', '.owoooo.', '.oeeooO.', '.oeeooO.', '.oooooO.', '.OOOOOO.'],
    heart: ['.rr.rr.', 'rwrrrrr', 'rrrrrrr', '.rrrrR.', '..rrR..', '...R...'],
    heartEmpty: ['.kk.kk.', 'k..k..k', 'k.....k', '.k...k.', '..k.k..', '...k...'],
    rope: ['.nnnnn.', 'nn...nn', 'n.nnn.n', 'n.n.n.n', 'n.nnn.n', 'nn...nN', '.nnnnNN'],
    crate: [
      'NNNNNNNNNNNN', 'NnnnnnnnnnnN', 'NnNnnnnnnNnN', 'NnnNnnnnNnnN', 'NnnnNnnNnnnN', 'NnnnnNNnnnnN',
      'NnnnnNNnnnnN', 'NnnnNnnNnnnN', 'NnnNnnnnNnnN', 'NnNnnnnnnNnN', 'NnnnnnnnnnnN', 'NNNNNNNNNNNN',
    ],
  };

  const spr = {};
  for (const k in defs) spr[k] = make(defs[k]);
  spr.player = {};
  for (const k in legs) {
    const right = make(body.concat(legs[k]));
    spr.player[k] = [right, flip(right)];
  }
  spr.white = {};
  for (const k of ['beetleA', 'beetleB', 'slime', 'batA', 'batB', 'batHang']) spr.white[k] = tint(spr[k], '#ffffff');

  // spikes (bottom half of a tile)
  spr.spike = (function () {
    const c = canvas(16, 16), g = c.getContext('2d');
    for (let i = 0; i < 4; i++) {
      for (let row = 0; row < 8; row++) {
        const half = row / 4;
        g.fillStyle = row < 3 ? '#e8ecf4' : '#aab2c4';
        g.fillRect(i * 4 + 2 - Math.ceil(half), 8 + row, Math.max(1, Math.ceil(half) * 2), 1);
      }
    }
    return c;
  })();

  // the lift cage that leads deeper
  spr.exit = (function () {
    const c = canvas(16, 16), g = c.getContext('2d');
    g.fillStyle = PAL.N; g.fillRect(0, 0, 16, 16);
    g.fillStyle = PAL.n; g.fillRect(1, 1, 14, 1); g.fillRect(1, 1, 1, 15); g.fillRect(14, 1, 1, 15);
    g.fillStyle = '#07060a'; g.fillRect(3, 3, 10, 13);
    g.fillStyle = PAL.e;
    g.fillRect(7, 5, 2, 5); g.fillRect(5, 9, 6, 1); g.fillRect(6, 10, 4, 1); g.fillRect(7, 11, 2, 1);
    return c;
  })();

  // --- tiles -----------------------------------------------------------
  const ZONES = [
    { name: 'Topsoil Diggings', dirt: ['#8a5a34', '#6e4526', '#a06c40'], stone: ['#7b7f8c', '#646876', '#9296a4'], back: '#2b1d15', edge: '#b88a4e' },
    { name: 'Deep Galleries', dirt: ['#6e5a4a', '#57463a', '#84705e'], stone: ['#5d6f86', '#4a5a70', '#7488a0'], back: '#171b26', edge: '#9a8a78' },
    { name: 'Crystal Hollows', dirt: ['#5a4a70', '#463a5a', '#705e8a'], stone: ['#4a7a86', '#3a6470', '#62969f'], back: '#151222', edge: '#8a78b0' },
  ];

  function speckled(cols, seed, n) {
    const rnd = DM.Level.rng(seed);
    const c = canvas(16, 16), g = c.getContext('2d');
    g.fillStyle = cols[0]; g.fillRect(0, 0, 16, 16);
    for (let i = 0; i < (n || 22); i++) {
      g.fillStyle = cols[1 + Math.floor(rnd() * (cols.length - 1))];
      const s = rnd() < 0.3 ? 2 : 1;
      g.fillRect(Math.floor(rnd() * 16), Math.floor(rnd() * 16), s + (rnd() < 0.3 ? 1 : 0), s);
    }
    return { c, g, rnd };
  }

  function buildZone(z, zi) {
    const T = DM.Level.T;
    const set = { back: [], lava: [] };
    for (let v = 0; v < 4; v++) {
      const seed = zi * 1000 + v * 17;
      set[T.DIRT] = set[T.DIRT] || []; set[T.STONE] = set[T.STONE] || []; set[T.ROCK] = set[T.ROCK] || [];
      set[T.BEDROCK] = set[T.BEDROCK] || []; set[T.ORE] = set[T.ORE] || []; set[T.GEM] = set[T.GEM] || [];
      set[T.DIRT].push(speckled(z.dirt, seed + 1).c);
      const st = speckled(z.stone, seed + 2, 14);
      st.g.fillStyle = z.stone[1];
      st.g.fillRect(0, 7 + (v % 2), 16, 1); st.g.fillRect(4 + v * 2, 0, 1, 8); st.g.fillRect(11 - v, 8, 1, 8);
      set[T.STONE].push(st.c);
      const rk = speckled(['#3d3844', '#2c2832', '#57505e'], seed + 3, 18);
      rk.g.fillStyle = '#6a6272';
      rk.g.fillRect(2 + v, 3, 5, 1); rk.g.fillRect(6 + v, 4, 1, 4); rk.g.fillRect(9, 10 + (v % 3), 5, 1);
      set[T.ROCK].push(rk.c);
      set[T.BEDROCK].push(speckled(['#15121a', '#0d0b11', '#221e2a'], seed + 4, 16).c);
      const ore = speckled(z.dirt, seed + 5);
      for (let i = 0; i < 4; i++) {
        const x = 1 + Math.floor(ore.rnd() * 12), y = 1 + Math.floor(ore.rnd() * 12);
        ore.g.fillStyle = PAL.E; ore.g.fillRect(x, y, 3, 3);
        ore.g.fillStyle = PAL.e; ore.g.fillRect(x, y, 2, 2);
        ore.g.fillStyle = '#fff8d0'; ore.g.fillRect(x, y, 1, 1);
      }
      set[T.ORE].push(ore.c);
      const gem = speckled(z.stone, seed + 6, 14);
      for (let i = 0; i < 2; i++) {
        const x = 2 + Math.floor(gem.rnd() * 9), y = 2 + Math.floor(gem.rnd() * 9);
        gem.g.fillStyle = PAL.C; gem.g.fillRect(x + 1, y, 2, 4); gem.g.fillRect(x, y + 1, 4, 2);
        gem.g.fillStyle = PAL.c; gem.g.fillRect(x + 1, y + 1, 2, 2);
        gem.g.fillStyle = '#ffffff'; gem.g.fillRect(x + 1, y + 1, 1, 1);
      }
      set[T.GEM].push(gem.c);
      const bk = speckled([z.back, shade(z.back, 0.8), shade(z.back, 1.25)], seed + 7, 12);
      set.back.push(bk.c);
    }
    for (let f = 0; f < 2; f++) {
      const lv = speckled(['#e8642a', '#ff9a3a', '#c8401c'], 90 + f, 20);
      lv.g.fillStyle = '#ffd24a';
      lv.g.fillRect(0, 0, 16, 1);
      lv.g.fillRect(f ? 2 : 9, 1, 5, 1);
      set.lava.push(lv.c);
    }
    set.info = z;
    return set;
  }

  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const ch = (s) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * k)));
    return 'rgb(' + ch(16) + ',' + ch(8) + ',' + ch(0) + ')';
  }

  const zoneCache = [];
  function zone(depth) {
    const zi = Math.min(ZONES.length - 1, Math.floor((depth - 1) / 3));
    if (!zoneCache[zi]) zoneCache[zi] = buildZone(ZONES[zi], zi);
    return zoneCache[zi];
  }

  DM.Sprites = { spr, zone, PAL, canvas };
})();
