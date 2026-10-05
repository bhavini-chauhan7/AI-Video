import { harmonize } from "./song.js";

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
    const offline = typeof OfflineAudioContext !== "undefined" && this.ctx instanceof OfflineAudioContext;
    if (!offline && this.ctx.state === "suspended") this.ctx.resume();
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
   * `voices` are voice-over clips [{ buffer: AudioBuffer, at: seconds }]; music
   * is ducked under them so speech stays clear.
   * Returns the AudioContext time that corresponds to video time `offset`.
   */
  start({ mood, duration, offset = 0, volume = 0.6, voices = [], voiceVolume = 1, duck = 0.3, song = null, track = null, destinations }) {
    const ctx = this.ensureContext();
    this.stop();
    const when = ctx.currentTime + (typeof OfflineAudioContext !== "undefined" && ctx instanceof OfflineAudioContext ? 0 : 0.05);
    const at = (t) => when + t - offset;
    const endAt = at(duration);

    const master = ctx.createGain();
    destinations.forEach((d) => master.connect(d));
    this.master = master;

    // music bus: ducking under voice-over + fade out over the last 1.5 s
    const music = ctx.createGain();
    music.connect(master);
    const g = music.gain;
    const ducked = voices.filter((v) => v.duck !== false);
    g.setValueAtTime(this.musicLevel(offset, ducked, volume, duck), when);
    for (const v of ducked) {
      const s = v.at, e = v.at + v.buffer.duration;
      if (e < offset) continue;
      if (s - 0.25 > offset) { g.setValueAtTime(volume, at(s - 0.25)); g.linearRampToValueAtTime(volume * duck, at(s)); }
      g.setValueAtTime(volume * duck, at(e)); g.linearRampToValueAtTime(volume, at(e + 0.4));
    }
    const fadeFrom = Math.max(when, endAt - 1.5);
    g.cancelScheduledValues(fadeFrom); g.setValueAtTime(this.musicLevel(Math.max(offset, duration - 1.5), ducked, volume, duck), fadeFrom);
    g.linearRampToValueAtTime(0, endAt);

    if (mood === "none") {
      // no music
    } else if (track) {
      // a fully produced song (e.g. ElevenLabs Music) replaces the generated music
      const src = ctx.createBufferSource();
      src.buffer = track;
      src.connect(music);
      if (offset < track.duration) { src.start(when, offset); this.nodes.push(src); }
    } else if (song) {
      this.scheduleSong(song, duration, offset, when, music);
    } else if (mood === "custom" && this.customBuffer) {
      const src = ctx.createBufferSource();
      src.buffer = this.customBuffer; src.loop = true;
      src.connect(music);
      src.start(when, offset % this.customBuffer.duration);
      src.stop(endAt + 0.05);
      this.nodes.push(src);
    } else if (MOODS[mood]) {
      this.schedule(MOODS[mood], duration, offset, when, music);
    }

    // voice-over bus
    const voice = ctx.createGain();
    voice.gain.value = voiceVolume;
    voice.connect(master);
    for (const v of voices) {
      const skip = offset - v.at;
      if (skip >= v.buffer.duration) continue;
      const src = ctx.createBufferSource();
      src.buffer = v.buffer;
      src.connect(voice);
      if (skip > 0) src.start(when, skip); else src.start(at(v.at));
      this.nodes.push(src);
    }
    return when;
  }

  /**
   * Backing track for a song: chords picked from the melody, bass, a soft bell
   * doubling the tune (so kids hear it), and light percussion.
   * song = { bpm, beatsPerBar, key, transpose, lines: [{ start (s), notes }] }.
   */
  scheduleSong(song, duration, offset, when, out) {
    const ctx = this.ctx;
    const beat = 60 / song.bpm;
    const at = (t) => when + t - offset;
    const tr = song.transpose || 0;
    const events = [];
    for (const line of song.lines) {
      let b = line.start / beat;
      for (const n of line.notes) {
        if (n.pitch) events.push({ at: b, pitch: n.pitch + tr, beats: n.beats });
        b += n.beats;
      }
    }
    const total = duration / beat;
    const chords = harmonize(events, { key: ((song.key + tr) % 12 + 12) % 12, beatsPerBar: song.beatsPerBar, totalBeats: total });
    const rev = this.reverb(out);
    const near = (pc, center) => center + ((pc - center) % 12 + 18) % 12 - 6; // nearest MIDI note with this pitch class

    for (const c of chords) {
      const t0 = c.at * beat, len = c.beats * beat;
      if (t0 + len < offset) continue;
      // soft pad
      c.tones.forEach((pc) => this.voice({ type: "triangle", freq: midi(near(pc, 60)), start: at(t0), len, gain: 0.045, attack: 0.08, release: 0.25, cutoff: 1500, out: rev, minStart: when }));
      // bass on the chord change and halfway through
      const bass = near(c.root, 43);
      this.voice({ type: "sine", freq: midi(bass), start: at(t0), len: Math.min(len, beat * 1.5), gain: 0.22, attack: 0.01, release: 0.15, out, minStart: when });
      if (c.beats >= 2) this.voice({ type: "sine", freq: midi(bass + 7), start: at(t0 + len / 2), len: Math.min(len / 2, beat * 1.5), gain: 0.15, attack: 0.01, release: 0.15, out, minStart: when });
      // strummed "ukulele" chord on each beat
      for (let b = 0; b < c.beats; b++) {
        const tb = t0 + b * beat;
        if (tb < offset || tb >= duration) continue;
        c.tones.forEach((pc, k) => this.voice({ type: "sawtooth", freq: midi(near(pc, 64)), start: at(tb + k * 0.012), len: beat * 0.45, gain: 0.018, attack: 0.004, release: 0.12, cutoff: 2200, out: rev, minStart: when }));
      }
    }
    // bell doubling the melody an octave up, quietly
    for (const e of events) {
      const t0 = e.at * beat;
      if (t0 < offset - 0.05 || t0 >= duration) continue;
      this.voice({ type: "sine", freq: midi(e.pitch + 12), start: at(t0), len: Math.min(e.beats * beat, 0.6), gain: 0.05, attack: 0.003, release: 0.35, out: rev, minStart: when });
    }
    // light percussion
    for (let b = 0; b * beat < duration; b++) {
      const tb = b * beat;
      if (tb < offset) continue;
      const inBar = b % song.beatsPerBar;
      if (inBar === 0) this.kick(at(tb), out);
      if (song.beatsPerBar === 4 && inBar === 2) this.kick(at(tb), out);
      this.noise(at(tb + beat / 2), 0.04, 0.035, 7000, "highpass", out);
      if (song.beatsPerBar === 4 && inBar % 2 === 1) this.noise(at(tb), 0.1, 0.06, 2500, "bandpass", out);
    }
  }

  /** Music gain at video time t (ducked if a voice clip is playing). */
  musicLevel(t, voices, volume, duck) {
    return voices.some((v) => t >= v.at - 0.25 && t <= v.at + v.buffer.duration + 0.4) ? volume * duck : volume;
  }

  /**
   * Render the same mix offline (faster than real time) and return an AudioBuffer.
   * Takes the same options as start(), minus destinations.
   */
  renderOffline(options, sampleRate = 32000) {
    // renders temporarily swap this.ctx, so they must never overlap (3D scenes are made in parallel)
    const run = () => this.renderOfflineNow(options, sampleRate);
    this.renderQueue = (this.renderQueue || Promise.resolve()).then(run, run);
    return this.renderQueue;
  }

  async renderOfflineNow(options, sampleRate) {
    const live = this.ctx, liveNodes = this.nodes, liveMaster = this.master, liveNoise = this.noiseBuf;
    const ctx = new OfflineAudioContext(1, Math.ceil((options.duration - (options.offset || 0) + 0.3) * sampleRate), sampleRate);
    this.ctx = ctx; this.nodes = []; this.master = null; this.noiseBuf = null;
    try {
      this.start({ ...options, destinations: [ctx.destination] });
      return await ctx.startRendering();
    } finally {
      this.ctx = live; this.nodes = liveNodes; this.master = liveMaster; this.noiseBuf = liveNoise;
    }
  }

  stop() {
    this.nodes.forEach((n) => { try { n.stop(); } catch { /* already stopped */ } });
    this.nodes = [];
    this.master?.disconnect();
    this.master = null;
  }

  async decode(arrayBuffer) {
    return this.ensureContext().decodeAudioData(arrayBuffer);
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

/** Encode an AudioBuffer as 16-bit PCM mono WAV. */
export function encodeWav(buffer) {
  const n = buffer.length, sr = buffer.sampleRate;
  const mono = new Float32Array(n);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < n; i++) mono[i] += d[i] / buffer.numberOfChannels;
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(mono[i]));
  const k = peak > 0.99 ? 0.99 / peak : 1;
  const out = new DataView(new ArrayBuffer(44 + n * 2));
  const str = (o, s) => [...s].forEach((ch, i) => out.setUint8(o + i, ch.charCodeAt(0)));
  str(0, "RIFF"); out.setUint32(4, 36 + n * 2, true); str(8, "WAVE"); str(12, "fmt ");
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, sr, true); out.setUint32(28, sr * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true);
  str(36, "data"); out.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) out.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(mono[i] * k * 32767))), true);
  return new Blob([out.buffer], { type: "audio/wav" });
}
