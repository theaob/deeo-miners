/* Deeo Miners — tiny synthesised sound effects (WebAudio, no assets). */
(function () {
  'use strict';
  const DM = (window.DM = window.DM || {});
  let ac = null;
  let muted = false;

  function ensure() {
    if (!ac) {
      try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }

  function tone(f, d, type, v, slide, delay) {
    const a = ensure();
    if (!a || muted) return;
    const t = a.currentTime + (delay || 0);
    const o = a.createOscillator(), g = a.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), t + d);
    g.gain.setValueAtTime(v || 0.06, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(a.destination);
    o.start(t); o.stop(t + d + 0.02);
  }

  function noise(d, v, cutoff) {
    const a = ensure();
    if (!a || muted) return;
    const buf = a.createBuffer(1, Math.ceil(a.sampleRate * d), a.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = a.createBufferSource(), g = a.createGain(), lp = a.createBiquadFilter();
    src.buffer = buf;
    lp.type = 'lowpass'; lp.frequency.value = cutoff || 1200;
    g.gain.setValueAtTime(v || 0.15, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + d);
    src.connect(lp); lp.connect(g); g.connect(a.destination);
    src.start();
  }

  const SFX = {
    jump: () => tone(300, 0.12, 'square', 0.04, 260),
    dig: () => noise(0.08, 0.12, 900),
    crumble: () => { noise(0.16, 0.16, 600); tone(110, 0.1, 'triangle', 0.08, -50); },
    clink: () => tone(1500, 0.06, 'square', 0.04, -500),
    hit: () => { noise(0.07, 0.12, 2400); tone(220, 0.08, 'square', 0.05, -120); },
    stomp: () => tone(180, 0.12, 'square', 0.06, 240),
    hurt: () => tone(240, 0.3, 'sawtooth', 0.08, -180),
    gold: () => { tone(990, 0.07, 'square', 0.04); tone(1480, 0.1, 'square', 0.04, 0, 0.06); },
    gem: () => { tone(1320, 0.08, 'triangle', 0.07); tone(1760, 0.08, 'triangle', 0.07, 0, 0.07); tone(2640, 0.16, 'triangle', 0.07, 0, 0.14); },
    pickup: () => tone(520, 0.14, 'triangle', 0.08, 400),
    fuse: () => noise(0.2, 0.05, 5000),
    boom: () => { noise(0.6, 0.4, 500); tone(90, 0.5, 'sine', 0.3, -60); },
    rope: () => tone(200, 0.18, 'triangle', 0.08, 700),
    buy: () => { tone(660, 0.08, 'square', 0.05); tone(880, 0.12, 'square', 0.05, 0, 0.08); },
    deny: () => tone(140, 0.16, 'square', 0.05, -40),
    move: () => tone(440, 0.04, 'square', 0.03),
    exit: () => [392, 523, 659, 784].forEach((f, i) => tone(f, 0.16, 'triangle', 0.08, 0, i * 0.09)),
    die: () => [330, 262, 196, 131].forEach((f, i) => tone(f, 0.28, 'sawtooth', 0.07, -20, i * 0.18)),
  };

  DM.Audio = {
    sfx(name) { if (SFX[name]) SFX[name](); },
    unlock: ensure,
    toggleMute() { muted = !muted; return muted; },
    get muted() { return muted; },
  };
})();
