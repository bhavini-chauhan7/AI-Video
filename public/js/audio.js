// Soundtrack: either a procedurally generated score that matches the
// storyboard mood, or a user-supplied audio file. Both are scheduled on a
// Web Audio graph so they can play through speakers and be recorded.

const MOODS = {
  calm:    { bpm: 72,  root: 57, prog: [[0, 4, 7, 11], [-3, 0, 4, 7], [5, 9, 12, 16], [7, 11, 14, 17]], drums: false, arp: "triangle" },
  upbeat:  { bpm: 112, root: 60, prog: [[0, 4, 7], [7, 11, 14], [-3, 0, 4], [5, 9, 12]], drums: true, arp: "square" },
  epic:    { bpm: 90,  root: 50, prog: [[0, 3, 7], [-4, 0, 3], [-7, -3, 0], [-2, 2, 5]], drums: true, arp: "sawtooth" },
  playful: { bpm: 124, root: 64, prog: [[0, 4, 7], [5, 9, 12], [7, 11, 14], [0, 4, 7]], drums: true, arp: "square" },
};
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

export class Soundtrack {
  constructor() {
    this.ctx = null;
    this.nodes = [];
    this.customBuffer = null;
    this.customName = "";
  }

  ensureContext() {
    this.ctx ??= new AudioContext();
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  }

  async loadFile(file) {
    const ctx = this.ensureContext();
    this.customBuffer = await ctx.decodeAudioData(await file.arrayBuffer());
    this.customName = file.name;
  }

  clearFile() { this.customBuffer = null; this.customName = ""; }

  /**
   * Start playback at `offset` seconds into a video of `duration` seconds.
   * `destinations` are AudioNodes (speakers, MediaStreamDestination, ...).
   * Returns the AudioContext time that corresponds to video time `offset`.
   */
  start({ mood, duration, offset = 0, volume = 0.6, destinations }) {
    const ctx = this.ensureContext();
    this.stop();
    const when = ctx.currentTime + 0.05;
    const master = ctx.createGain();
    master.gain.value = volume;
    // fade out over the last 1.5 seconds
    const endAt = when + (duration - offset);
    master.gain.setValueAtTime(volume, Math.max(when, endAt - 1.5));
    master.gain.linearRampToValueAtTime(0, endAt);
    destinations.forEach((d) => master.connect(d));
    this.master = master;

    if (mood === "custom" && this.customBuffer) {
      const src = ctx.createBufferSource();
      src.buffer = this.customBuffer; src.loop = true;
      src.connect(master);
      src.start(when, offset % this.customBuffer.duration);
      src.stop(endAt + 0.05);
      this.nodes.push(src);
    } else if (MOODS[mood]) {
      this.schedule(MOODS[mood], duration, offset, when, master);
    }
    return when;
  }

  stop() {
    this.nodes.forEach((n) => { try { n.stop(); } catch { /* already stopped */ } });
    this.nodes = [];
    this.master?.disconnect();
    this.master = null;
  }

  schedule(m, duration, offset, when, out) {
    const ctx = this.ctx;
    const beat = 60 / m.bpm, bar = beat * 4;
    const rev = this.reverb(out);
    const at = (t) => when + t - offset;

    for (let barStart = 0, i = 0; barStart < duration; barStart += bar, i++) {
      if (barStart + bar < offset) continue;
      const chord = m.prog[i % m.prog.length];
      // pad
      chord.forEach((iv) => this.voice({ type: "sawtooth", freq: midi(m.root + iv), start: at(barStart), len: bar, gain: 0.05, attack: bar * 0.3, release: bar * 0.4, cutoff: 900, out: rev, minStart: when }));
      // bass
      this.voice({ type: "sine", freq: midi(m.root - 12 + chord[0]), start: at(barStart), len: bar * 0.95, gain: 0.22, attack: 0.02, release: 0.3, out, minStart: when });
      // arpeggio
      const steps = m.bpm > 100 ? 8 : 4;
      for (let s = 0; s < steps; s++) {
        const tt = barStart + (s * bar) / steps;
        if (tt < offset || tt >= duration) continue;
        const note = m.root + 12 + chord[s % chord.length] + (s >= steps / 2 && m.bpm > 100 ? 12 : 0);
        this.voice({ type: m.arp, freq: midi(note), start: at(tt), len: bar / steps, gain: m.arp === "triangle" ? 0.08 : 0.035, attack: 0.005, release: 0.15, cutoff: 2400, out: rev, minStart: when });
      }
      if (!m.drums) continue;
      for (let b = 0; b < 4; b++) {
        const tt = barStart + b * beat;
        if (tt < offset || tt >= duration) continue;
        if (b % 2 === 0 || m.bpm > 110) this.kick(at(tt), out);
        this.hat(at(tt + beat / 2), out);
        if (b % 2 === 1) this.snare(at(tt), out);
      }
    }
  }

  voice({ type, freq, start, len, gain, attack, release, cutoff, out, minStart }) {
    const ctx = this.ctx;
    if (start + len < minStart) return;
    start = Math.max(start, minStart);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type; osc.frequency.value = freq;
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(gain, start + attack);
    g.gain.setValueAtTime(gain, start + Math.max(attack, len - release));
    g.gain.linearRampToValueAtTime(0, start + len + release);
    let node = osc;
    if (cutoff) { const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = cutoff; osc.connect(f); node = f; }
    node.connect(g); g.connect(out);
    osc.start(start); osc.stop(start + len + release + 0.05);
    this.nodes.push(osc);
  }

  kick(t, out) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.frequency.setValueAtTime(140, t); osc.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc.connect(g); g.connect(out); osc.start(t); osc.stop(t + 0.32);
    this.nodes.push(osc);
  }

  noise(t, len, gain, freq, type, out) {
    const ctx = this.ctx;
    this.noiseBuf ??= (() => {
      const b = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      return b;
    })();
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = this.noiseBuf; f.type = type; f.frequency.value = freq;
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + len);
    src.connect(f); f.connect(g); g.connect(out); src.start(t); src.stop(t + len + 0.02);
    this.nodes.push(src);
  }
  hat(t, out) { this.noise(t, 0.05, 0.06, 7000, "highpass", out); }
  snare(t, out) { this.noise(t, 0.18, 0.15, 1800, "bandpass", out); }

  reverb(out) {
    const ctx = this.ctx;
    const len = ctx.sampleRate * 2.2;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    const conv = ctx.createConvolver(); conv.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.35;
    const input = ctx.createGain();
    input.connect(out); input.connect(conv); conv.connect(wet); wet.connect(out);
    return input;
  }
}
