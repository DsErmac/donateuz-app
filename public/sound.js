/* =========================================================
   DonateUZ sound engine — synthesized in-browser, zero assets.
   Every tone is drawn from a warm D-major pentatonic set, so
   any sequence of UI sounds stays consonant (like plucked
   dombra strings rather than generic UI bleeps).
   The AudioContext is created on the first user gesture, so
   browser autoplay policies are respected by design and
   nothing plays before the visitor has interacted.
   ========================================================= */
(function () {
  'use strict';

  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let unlocked = false;
  let enabled = true;

  function ensureContext() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.22;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp);
    comp.connect(ctx.destination);
    // Shared white-noise buffer for whooshes / clicks / sparkles.
    noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return ctx;
  }

  // Autoplay unlock: any real interaction arms the engine.
  function unlock() {
    if (unlocked) return;
    if (!ensureContext()) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    unlocked = true;
    document.removeEventListener('pointerdown', unlock, true);
    document.removeEventListener('keydown', unlock, true);
    document.removeEventListener('touchstart', unlock, true);
  }
  document.addEventListener('pointerdown', unlock, true);
  document.addEventListener('keydown', unlock, true);
  document.addEventListener('touchstart', unlock, true);

  /* ---------- Voices ---------- */
  function tone(o) {
    const t0 = ctx.currentTime + (o.delay || 0);
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.glide) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.glide), t0 + o.dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(o.gain, t0 + (o.attack || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    let tail = osc;
    if (o.filter) {
      const f = ctx.createBiquadFilter();
      f.type = o.filter.type || 'lowpass';
      f.frequency.value = o.filter.freq || 1200;
      f.Q.value = o.filter.q || 0.8;
      osc.connect(f);
      tail = f;
    }
    tail.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.05);
  }

  function noise(o) {
    const t0 = ctx.currentTime + (o.delay || 0);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = o.type || 'bandpass';
    f.Q.value = o.q || 1;
    f.frequency.setValueAtTime(o.from, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(10, o.to), t0 + o.dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(o.gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t0);
    src.stop(t0 + o.dur + 0.05);
  }

  // D major pentatonic (D E F# A B) — the palette every sound draws from.
  const N = { D5: 587.33, E5: 659.25, Fs5: 739.99, A5: 880, B5: 987.77, D6: 1174.66, Fs6: 1479.98 };

  const recipes = {
    // Soft ceramic tap — a thumb on fired tile.
    tap() {
      tone({ freq: 1900, dur: 0.045, gain: 0.16, glide: 1500 });
      noise({ dur: 0.03, gain: 0.07, from: 3200, to: 1400, q: 2 });
    },
    // Navigation pluck — single dombra string.
    nav() {
      tone({ freq: N.B5, type: 'triangle', dur: 0.16, gain: 0.26 });
      tone({ freq: N.B5 * 2, dur: 0.09, gain: 0.06 });
    },
    toggleOn() {
      tone({ freq: N.E5, type: 'triangle', dur: 0.1, gain: 0.22 });
      tone({ freq: N.A5, type: 'triangle', dur: 0.16, gain: 0.22, delay: 0.07 });
    },
    toggleOff() {
      tone({ freq: N.A5, type: 'triangle', dur: 0.1, gain: 0.18 });
      tone({ freq: N.E5, type: 'triangle', dur: 0.14, gain: 0.18, delay: 0.06 });
    },
    // Bookmark pop — wooden block drop.
    pop() {
      tone({ freq: 520, dur: 0.14, gain: 0.3, glide: 210 });
    },
    // Coins touched together — for the "give" press.
    coin() {
      tone({ freq: 1568, type: 'square', dur: 0.07, gain: 0.09, filter: { type: 'bandpass', freq: 3000, q: 4 } });
      tone({ freq: 2093, type: 'square', dur: 0.18, gain: 0.08, delay: 0.05, filter: { type: 'bandpass', freq: 4200, q: 4 } });
    },
    // The celebration fanfare — rising pentatonic arpeggio with sparkle.
    success() {
      [N.D5, N.Fs5, N.A5, N.D6].forEach((f, i) => {
        tone({ freq: f, dur: 0.5, gain: 0.24, delay: i * 0.09 });
        tone({ freq: f * 2, dur: 0.3, gain: 0.05, delay: i * 0.09 });
      });
      tone({ freq: N.D6, type: 'triangle', dur: 0.7, gain: 0.16, delay: 0.36 });
      noise({ dur: 0.5, gain: 0.045, from: 5000, to: 9000, delay: 0.36, q: 0.7 });
    },
    // Request submitted — short upward phrase.
    send() {
      [N.D5, N.Fs5, N.A5].forEach((f, i) =>
        tone({ freq: f, type: 'triangle', dur: 0.14, gain: 0.22, delay: i * 0.07 }));
    },
    // Muted double-buzz, never harsh.
    error() {
      tone({ freq: 170, type: 'sawtooth', dur: 0.09, gain: 0.2, filter: { type: 'lowpass', freq: 420 } });
      tone({ freq: 140, type: 'sawtooth', dur: 0.14, gain: 0.2, delay: 0.11, filter: { type: 'lowpass', freq: 380 } });
    },
    whooshUp() {
      noise({ dur: 0.22, gain: 0.09, from: 300, to: 2600, q: 1.2 });
    },
    whooshDown() {
      noise({ dur: 0.18, gain: 0.07, from: 2600, to: 300, q: 1.2 });
    },
    // Bell for saved-campaign updates.
    notify() {
      tone({ freq: 880, dur: 0.5, gain: 0.18 });
      tone({ freq: 1760, dur: 0.4, gain: 0.06, delay: 0.01 });
    }
  };

  const Sound = {
    setEnabled(v) { enabled = !!v; },
    isEnabled() { return enabled; },
    isReady() { return unlocked && !!ctx && ctx.state === 'running'; },
    play(name) {
      if (!enabled || !unlocked || document.hidden) return;
      const fn = recipes[name];
      if (!fn) return;
      try {
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        fn();
      } catch (e) { /* audio is best-effort */ }
    }
  };

  window.Sound = Sound;
})();
