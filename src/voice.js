// ---- モルモットの鳴き声（Web Audio で合成。外部音源なし）
const GPVoice = (() => {
  const H = [0, 1, 0.62, 0.40, 0.24, 0.14, 0.08, 0.05, 0.03, 0.02];   // 倍音の強さ
  const cache = new WeakMap();
  const res = (c) => {
    if (!cache.has(c)) {
      const re = new Float32Array(H.length), im = Float32Array.from(H);
      const nb = c.createBuffer(1, c.sampleRate, c.sampleRate), d = nb.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      cache.set(c, { wave: c.createPeriodicWave(re, im), noise: nb });
    }
    return cache.get(c);
  };
  const env = (c, t, peak, a, hold, r) => {
    const gn = c.createGain(), p = gn.gain;
    p.setValueAtTime(0.0001, t); p.exponentialRampToValueAtTime(peak, t + a);
    p.setValueAtTime(peak, t + a + hold); p.exponentialRampToValueAtTime(0.0001, t + a + hold + r);
    return gn;
  };
  const noise = (c, t, dur, type, freq, q, gainNode, dest) => {
    const s = c.createBufferSource(); s.buffer = res(c).noise; s.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    s.connect(f).connect(gainNode).connect(dest); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
    return f;
  };

  // 1音分のウィーク：低めから一気に上がり、最後に少し下がる
  function wheekNote(c, dest, t, e) {
    const o = c.createOscillator(); o.setPeriodicWave(res(c).wave);
    const f = o.frequency;
    f.setValueAtTime(e.f0, t);
    f.exponentialRampToValueAtTime(e.fpk, t + e.dur * 0.38);
    f.exponentialRampToValueAtTime(e.fend, t + e.dur);
    const lfo = c.createOscillator(), lg = c.createGain();
    lfo.frequency.value = e.vib; lg.gain.value = e.fpk * 0.022;
    lfo.connect(lg).connect(f);
    const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 650;
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 8500;
    const g = env(c, t, e.gain, 0.02, e.dur * 0.62, e.dur * 0.38 - 0.02);
    o.connect(hp).connect(lp).connect(g).connect(dest);
    // 息のかすれ
    const ng = env(c, t, e.gain * 0.12, 0.02, e.dur * 0.5, e.dur * 0.5 - 0.02);
    const bp = noise(c, t, e.dur, "bandpass", e.f0 * 2, 2.5, ng, dest);
    bp.frequency.exponentialRampToValueAtTime(e.fpk * 2, t + e.dur * 0.38);
    for (const n of [o, lfo]) { n.start(t); n.stop(t + e.dur + 0.05); }
  }

  // グルグル：低い声を 20 Hz 前後のパルスで震わせる
  function purr(c, dest, t, e) {
    const o = c.createOscillator(); o.type = "sawtooth";
    o.frequency.setValueAtTime(e.f, t); o.frequency.linearRampToValueAtTime(e.f * 0.85, t + e.dur);
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1100; lp.Q.value = 2;
    const pulse = c.createGain(), p = pulse.gain; p.setValueAtTime(0, t);
    let tt = t;
    while (tt < t + e.dur) {
      const x = (tt - t) / e.dur, rate = e.rate * (1 + 0.25 * Math.sin(x * Math.PI));
      const amp = e.gain * Math.sin(Math.min(1, x * 4) * Math.PI / 2) * (1 - Math.max(0, x - 0.75) * 4);
      p.setValueAtTime(0.0001, tt); p.linearRampToValueAtTime(amp, tt + 0.006); p.exponentialRampToValueAtTime(0.0001, tt + 0.7 / rate);
      tt += 1 / rate;
    }
    o.connect(lp).connect(pulse).connect(dest);
    const ng = c.createGain(); ng.gain.value = 0.25;
    noise(c, t, e.dur, "lowpass", 900, 1, ng, pulse);
    o.start(t); o.stop(t + e.dur + 0.05);
  }

  // クックッ：短く低めのつぶやき
  function chut(c, dest, t, e) {
    const o = c.createOscillator(); o.setPeriodicWave(res(c).wave);
    o.frequency.setValueAtTime(e.f, t); o.frequency.exponentialRampToValueAtTime(e.f * 0.72, t + e.dur);
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2400;
    const g = env(c, t, e.gain, 0.006, e.dur * 0.3, e.dur * 0.7);
    o.connect(lp).connect(g).connect(dest); o.start(t); o.stop(t + e.dur + 0.05);
  }

  const R = (a, b) => a + Math.random() * (b - a);
  // 鳴き方のパターン（イベント列）。アニメーションも同じ列を見て動く
  function pattern(kind) {
    const ev = [];
    if (kind === "wheek") {
      const n = 2 + Math.floor(Math.random() * 4);
      let t = 0; const base = R(1750, 2050);
      for (let i = 0; i < n; i++) {
        const last = i === n - 1, dur = last ? R(0.32, 0.42) : R(0.16, 0.22);
        const fpk = base * (1 + 0.03 * i) * R(0.97, 1.03);
        ev.push({ k: "wheek", at: t, dur, f0: R(850, 1050), fpk, fend: fpk * (last ? 0.74 : 0.9), vib: R(24, 34), gain: last ? 0.5 : 0.42 });
        t += dur + R(0.07, 0.12);
      }
    } else if (kind === "purr") {
      ev.push({ k: "purr", at: 0, dur: R(0.7, 1.2), f: R(120, 150), rate: R(17, 22), gain: 0.55 });
    } else if (kind === "chut") {
      const n = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) ev.push({ k: "chut", at: i * R(0.1, 0.14), dur: R(0.045, 0.065), f: R(480, 600), gain: 0.32 });
    }
    return ev;
  }
  function schedule(c, dest, t0, ev) {
    for (const e of ev) ({ wheek: wheekNote, purr, chut })[e.k](c, dest, t0 + e.at, e);
  }

  // 再生系
  let ctx = null, master = null, panNode = null, distGain = null, muted = false, volume = 0.7;
  function unlock() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!ctx) {
      ctx = new AC();
      const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
      distGain = ctx.createGain(); master = ctx.createGain(); master.gain.value = muted ? 0 : volume;
      panNode = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
      comp.connect(distGain).connect(master).connect(panNode).connect(ctx.destination);
      master._in = comp;
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }
  function play(kind) {
    const ev = pattern(kind);
    if (ctx && ctx.state === "running" && !muted) schedule(ctx, master._in, ctx.currentTime + 0.02, ev);
    return ev;
  }
  // 位置（-1..1 の左右、カメラからの距離）を反映
  function setSpatial(pan, dist) {
    if (!ctx) return;
    const t = ctx.currentTime;
    if (panNode.pan) panNode.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, 0.05);
    distGain.gain.setTargetAtTime(Math.max(0.35, Math.min(1.2, 0.45 / Math.max(dist, 0.05))), t, 0.05);
  }
  function setMuted(m) { muted = m; if (master) master.gain.setTargetAtTime(m ? 0 : volume, ctx.currentTime, 0.02); }
  function setVolume(v) { volume = v; if (master && !muted) master.gain.setTargetAtTime(v, ctx.currentTime, 0.02); }
  // テスト・書き出し用：オフラインで波形を作る
  async function render(kind, sampleRate = 44100) {
    const ev = pattern(kind), len = Math.max(...ev.map((e) => e.at + e.dur)) + 0.15;
    const oc = new OfflineAudioContext(1, Math.ceil(len * sampleRate), sampleRate);
    schedule(oc, oc.destination, 0.02, ev);
    return { buffer: await oc.startRendering(), events: ev };
  }
  return { unlock, play, setSpatial, setMuted, setVolume, render, get muted() { return muted; } };
})();

export { GPVoice };
