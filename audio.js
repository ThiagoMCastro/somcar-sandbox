'use strict';
/* Som real (WebAudio): toca o que os alto-falantes simulados estariam tocando. */
class AudioEngine {
  constructor() { this.ctx = null; this.on = false; this.signal = null; }

  start() {
    if (!this.ctx) {
      const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = ctx.createGain(); this.master.gain.value = 0;
      this.low = ctx.createBiquadFilter(); this.low.type = 'lowshelf'; this.low.frequency.value = 160;
      this.high = ctx.createBiquadFilter(); this.high.type = 'highshelf'; this.high.frequency.value = 600;
      this.shaper = ctx.createWaveShaper(); this.shaper.oversample = '2x';
      this.bus = ctx.createGain(); this.bus.gain.value = 1;
      this.bus.connect(this.shaper); this.shaper.connect(this.low); this.low.connect(this.high); this.high.connect(this.master);
      this.master.connect(ctx.destination);
      this.fx = ctx.createGain(); this.fx.gain.value = 0.5; this.fx.connect(ctx.destination);
      this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.setClip(0);
    }
    this.ctx.resume(); this.on = true;
  }
  stop() { this.on = false; if (this.ctx) { this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05); this.stopSource(); } this.signal = null; }

  setClip(amount) {
    const k = 1 + amount * 60, n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; curve[i] = Math.tanh(k * x) / Math.tanh(k); }
    this.shaper.curve = curve; this.clipAmt = amount;
  }

  stopSource() {
    if (this.osc) { try { this.osc.stop(); } catch (e) {} this.osc = null; }
    if (this.seq) { clearInterval(this.seq); this.seq = null; }
  }

  setSignal(sig) {
    if (sig === this.signal) return;
    this.stopSource(); this.signal = sig;
    const ctx = this.ctx;
    if (sig === 'sine1k' || sig === 'sine40') {
      const o = this.osc = ctx.createOscillator(); o.frequency.value = sig === 'sine1k' ? 1000 : 40;
      const g = ctx.createGain(); g.gain.value = sig === 'sine1k' ? 0.25 : 0.9;
      o.connect(g); g.connect(this.bus); o.start();
    } else {
      // loop de música sintetizada simples (120 BPM)
      let step = 0, next = ctx.currentTime + 0.05;
      const bass = [41.2, 41.2, 55, 49], tick = 0.125;
      const sched = () => {
        while (next < ctx.currentTime + 0.2) {
          const s = step % 16, bar = Math.floor(step / 16) % 4;
          if (s % 4 === 0) this.kick(next);
          if (s === 4 || s === 12) this.noiseHit(next, 1800, 0.18, 0.35);
          if (s % 2 === 1) this.noiseHit(next, 8000, 0.04, 0.12);
          if (s % 4 === 2 || s % 8 === 3) this.bassNote(next, bass[bar], tick * 1.6);
          if (s % 8 === 0) this.lead(next, [330, 392, 440, 392][bar] * (s === 8 ? 1.5 : 1), tick * 3);
          next += tick; step++;
        }
      };
      sched(); this.seq = setInterval(sched, 50);
    }
  }

  kick(t) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(1, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(g); g.connect(this.bus); o.start(t); o.stop(t + 0.4);
  }
  bassNote(t, f, d) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain(), lp = this.ctx.createBiquadFilter();
    o.type = 'sawtooth'; o.frequency.value = f; lp.type = 'lowpass'; lp.frequency.value = 220;
    g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + d);
    o.connect(lp); lp.connect(g); g.connect(this.bus); o.start(t); o.stop(t + d);
  }
  lead(t, f, d) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'triangle'; o.frequency.value = f;
    g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + d);
    o.connect(g); g.connect(this.bus); o.start(t); o.stop(t + d);
  }
  noiseHit(t, f, d, vol, dest) {
    const s = this.ctx.createBufferSource(), g = this.ctx.createGain(), bp = this.ctx.createBiquadFilter();
    s.buffer = this.noiseBuf; bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 0.8;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + d);
    s.connect(bp); bp.connect(g); g.connect(dest || this.bus); s.start(t, Math.random() * 0.5); s.stop(t + d);
  }

  pop() { if (this.on) this.noiseHit(this.ctx.currentTime, 900, 0.25, 1.2, this.fx); }
  crackle() {
    if (!this.on) return;
    for (let i = 0; i < 6; i++) this.noiseHit(this.ctx.currentTime + Math.random() * 0.3, 3000 + Math.random() * 3000, 0.03, 0.6, this.fx);
  }

  /** au = { sub, full, tw (W médios), clip 0..1, cancel } */
  update(au, signal) {
    if (!this.on || !this.ctx) return;
    this.setSignal(signal);
    const total = au.sub + au.full + au.tw;
    const level = total <= 0.01 ? 0 : Math.min(0.9, 0.12 + 0.18 * Math.log10(1 + total));
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(level, t, 0.08);
    const lowDb = au.sub > 0.5 ? 6 : au.full > 0.5 ? -4 : -40;
    const highDb = au.full > 0.5 || au.tw > 0.5 ? (au.tw > 0.5 ? 3 : 0) : -40;
    this.low.gain.setTargetAtTime(lowDb, t, 0.1);
    this.high.gain.setTargetAtTime(highDb, t, 0.1);
    if (Math.abs(au.clip - (this.clipAmt || 0)) > 0.03) this.setClip(au.clip);
  }
}
