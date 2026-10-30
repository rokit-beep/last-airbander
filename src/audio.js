/** Tiny procedural sound engine (no audio files needed). */
export class Sfx {
  constructor() { this.ctx = null; }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.ambient();
  }

  ambient() {
    const ctx = this.ctx;
    // wind
    const src = ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
    const g = ctx.createGain(); g.gain.value = 0.08;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.09;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.05;
    lfo.connect(lfoGain).connect(g.gain);
    src.connect(lp).connect(g).connect(this.master);
    src.start(); lfo.start();
    // distant surf
    const src2 = ctx.createBufferSource();
    src2.buffer = this.noise; src2.loop = true; src2.playbackRate.value = 0.7;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.4;
    const g2 = ctx.createGain(); g2.gain.value = 0.02;
    const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.13;
    const lg2 = ctx.createGain(); lg2.gain.value = 0.018;
    lfo2.connect(lg2).connect(g2.gain);
    src2.connect(bp).connect(g2).connect(this.master);
    src2.start(); lfo2.start();
  }

  noiseBurst({ type = 'bandpass', f0 = 800, f1 = 300, q = 1, dur = 0.5, gain = 0.5, attack = 0.02, rate = 1 }) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise; src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }

  tone({ f0 = 120, f1 = 40, dur = 0.4, gain = 0.4, type = 'sine' }) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  fire() { this.noiseBurst({ type: 'lowpass', f0: 2500, f1: 300, dur: 0.6, gain: 0.5, q: 0.7 }); this.tone({ f0: 90, f1: 50, dur: 0.3, gain: 0.25 }); }
  water() { this.noiseBurst({ type: 'bandpass', f0: 1800, f1: 600, dur: 0.45, gain: 0.45, q: 2.5, rate: 1.4 }); }
  earth() { this.tone({ f0: 70, f1: 28, dur: 0.7, gain: 0.6 }); this.noiseBurst({ type: 'lowpass', f0: 500, f1: 80, dur: 0.6, gain: 0.5 }); }
  air() { this.noiseBurst({ type: 'bandpass', f0: 600, f1: 2600, dur: 0.5, gain: 0.5, q: 1.2, attack: 0.08 }); }
  boom() { this.tone({ f0: 110, f1: 25, dur: 0.9, gain: 0.7 }); this.noiseBurst({ type: 'lowpass', f0: 1800, f1: 60, dur: 0.9, gain: 0.6 }); }
  splash() { this.noiseBurst({ type: 'highpass', f0: 1200, f1: 3000, dur: 0.35, gain: 0.35, rate: 1.6 }); }
  hit() { this.tone({ f0: 300, f1: 90, dur: 0.18, gain: 0.25, type: 'triangle' }); }
  hurt() { this.tone({ f0: 160, f1: 60, dur: 0.3, gain: 0.35, type: 'sawtooth' }); }
  spirit() { this.tone({ f0: 520, f1: 180, dur: 0.6, gain: 0.12, type: 'sine' }); this.noiseBurst({ type: 'bandpass', f0: 400, f1: 1200, dur: 0.6, gain: 0.15, q: 6 }); }
  heal() { this.tone({ f0: 440, f1: 880, dur: 0.8, gain: 0.15 }); this.water(); }
}
