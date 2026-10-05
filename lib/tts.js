// Text-to-speech: a local Kokoro engine (free, offline) plus optional
// OpenAI and ElevenLabs voices. Output is post-processed with ffmpeg for
// character effects (kid, robot, monster...) and loudness normalization.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { EFFECTS, KOKORO_LANGS, kokoroVoices, OPENAI_VOICES } from "./voices.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PYTHON = process.env.TTS_PYTHON || "python3";
const MODEL_DIR = process.env.KOKORO_DIR || path.join(ROOT, "models");
export const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
export const hasFfmpeg = spawnSync(FFMPEG, ["-version"], { stdio: "ignore" }).status === 0;
const MAX_TEXT = 1500;
const KOKORO_MODELS = ["kokoro-v1.0.fp16.onnx", "kokoro-v1.0.onnx", "kokoro-v1.0.int8.onnx"];

// ---------------- Kokoro (local) ----------------
class KokoroEngine {
  constructor() {
    this.proc = null;
    this.pending = new Map();
    this.nextId = 1;
    this._available = undefined;
  }

  get available() {
    if (this._available === undefined) {
      const models = KOKORO_MODELS.some((m) => existsSync(path.join(MODEL_DIR, m))) && existsSync(path.join(MODEL_DIR, "voices-v1.0.bin"));
      this._available = models && spawnSync(PYTHON, ["-c", "import kokoro_onnx, soundfile"], { stdio: "ignore" }).status === 0;
    }
    return this._available;
  }

  start() {
    if (this.proc) return this.ready;
    const proc = spawn(PYTHON, [path.join(ROOT, "tts", "kokoro_worker.py")], {
      env: { ...process.env, KOKORO_DIR: MODEL_DIR }, stdio: ["pipe", "pipe", "pipe"],
    });
    this.proc = proc;
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr = (stderr + d).slice(-2000)));
    this.ready = new Promise((resolve, reject) => {
      createInterface({ input: proc.stdout }).on("line", (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.ready) return resolve();
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        msg.ok ? p.resolve(msg) : p.reject(new Error(msg.error || "Kokoro failed"));
      });
      proc.on("exit", (code) => {
        const err = new Error(`Kokoro worker exited (${code}): ${stderr.trim().split("\n").pop() || ""}`);
        reject(err);
        this.pending.forEach((p) => p.reject(err));
        this.pending.clear();
        this.proc = null;
      });
    });
    return this.ready;
  }

  get canSing() {
    if (this._canSing === undefined) {
      this._canSing = this.available && spawnSync(PYTHON, ["-c", "import pyworld"], { stdio: "ignore" }).status === 0;
    }
    return this._canSing;
  }

  async request(payload) {
    await this.start();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(JSON.stringify({ id, ...payload }) + "\n");
    });
  }

  synth({ text, voice, speed, out }) {
    return this.request({ text, voice, speed, out, lang: KOKORO_LANGS[voice[0]]?.code || "en-us" });
  }

  sing({ notes, bpm, voice, opts, out }) {
    return this.request({ cmd: "sing", notes, bpm, voice, opts, out, lang: KOKORO_LANGS[voice[0]]?.code || "en-us" });
  }

  stop() { this.proc?.kill(); }
}

export const kokoro = new KokoroEngine();

// ---------------- OpenAI ----------------
async function openaiSpeech({ text, voice, style }) {
  const base = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const res = await fetch(`${base}/audio/speech`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts", voice, input: text, response_format: "wav",
      instructions: style ? `Voice character: ${style}. Speak expressively and clearly for a YouTube video.` : undefined,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI TTS error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

// ---------------- ElevenLabs ----------------
const elevenBase = () => process.env.ELEVENLABS_BASE_URL || "https://api.elevenlabs.io";
let elevenCache = null;
async function elevenVoices() {
  if (elevenCache && Date.now() - elevenCache.at < 10 * 60 * 1000) return elevenCache.voices;
  const res = await fetch(`${elevenBase()}/v1/voices`, { headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY } });
  if (!res.ok) throw new Error(`ElevenLabs voices error ${res.status}`);
  const data = await res.json();
  const voices = (data.voices || []).map((v) => {
    const labels = Object.values(v.labels || {}).filter(Boolean).join(", ");
    return { id: `elevenlabs:${v.voice_id}`, provider: "elevenlabs", name: labels ? `${v.name} (${labels})` : v.name, lang: "multi", langLabel: "ElevenLabs" };
  });
  elevenCache = { at: Date.now(), voices };
  return voices;
}

async function elevenSpeech({ text, voice }) {
  const res = await fetch(`${elevenBase()}/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2" }),
  });
  if (!res.ok) throw new Error(`ElevenLabs TTS error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

// ---------------- public API ----------------
export function providers() {
  return {
    kokoro: kokoro.available, openai: Boolean(process.env.OPENAI_API_KEY), elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY),
    singing: kokoro.canSing, music: Boolean(process.env.ELEVENLABS_API_KEY),
  };
}

export async function listVoices() {
  const p = providers();
  const voices = [];
  if (p.kokoro) voices.push(...kokoroVoices());
  if (p.openai) voices.push(...OPENAI_VOICES);
  if (p.elevenlabs) {
    try { voices.push(...(await elevenVoices())); } catch (err) { console.error(err.message); }
  }
  return voices;
}

export function availableEffects() {
  return Object.entries(EFFECTS).filter(([id]) => hasFfmpeg || id === "none").map(([id, e]) => ({ id, label: e.label }));
}

const cache = new Map();
const CACHE_MAX = 300;
function cacheGet(key) {
  if (!cache.has(key)) return null;
  const hit = cache.get(key);
  cache.delete(key); cache.set(key, hit); // LRU bump
  return hit;
}
function cachePut(key, value) {
  cache.set(key, value);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

/**
 * Synthesize `text` with `voice` ("provider:id"), then apply effect/speed.
 * Returns { audio: Buffer, type: mime }.
 */
export async function synthesize({ text, voice, effect = "none", speed = 1, style = "" }) {
  text = String(text || "").trim().slice(0, MAX_TEXT);
  if (!text) throw Object.assign(new Error("Nothing to say: the narration is empty."), { status: 400 });
  const [provider, id] = String(voice || "").split(/:(.*)/s);
  const p = providers();
  if (!p[provider] || !id) throw Object.assign(new Error(`Voice "${voice}" is not available on this server.`), { status: 400 });
  if (provider === "kokoro" && !kokoroVoices().some((v) => v.id === voice)) throw Object.assign(new Error(`Unknown Kokoro voice ${id}.`), { status: 400 });
  speed = Math.min(1.6, Math.max(0.6, Number(speed) || 1));
  if (!EFFECTS[effect] || (!hasFfmpeg && effect !== "none")) effect = "none";

  const key = createHash("sha1").update(JSON.stringify([text, voice, effect, speed, style])).digest("hex");
  const hit = cacheGet(key);
  if (hit) return hit;

  const dir = await mkdtemp(path.join(tmpdir(), "aivideo-tts-"));
  try {
    let raw, ext, tempo = speed;
    if (provider === "kokoro") {
      raw = path.join(dir, "raw.wav"); ext = "wav";
      await kokoro.synth({ text, voice: id, speed, out: raw });
      tempo = 1; // Kokoro handles speed natively
    } else {
      const buf = provider === "openai" ? await openaiSpeech({ text, voice: id, style }) : await elevenSpeech({ text, voice: id });
      ext = provider === "openai" ? "wav" : "mp3";
      raw = path.join(dir, `raw.${ext}`);
      await writeFile(raw, buf);
    }

    let result;
    if (hasFfmpeg) {
      const filters = [EFFECTS[effect].filter, tempo !== 1 && `atempo=${tempo}`, "loudnorm=I=-16:TP=-1.5:LRA=11"].filter(Boolean);
      const out = path.join(dir, "out.mp3");
      await run(FFMPEG, ["-y", "-i", raw, "-af", filters.join(","), "-ac", "1", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "96k", out]);
      result = { audio: await readFile(out), type: "audio/mpeg" };
    } else {
      result = { audio: await readFile(raw), type: ext === "mp3" ? "audio/mpeg" : "audio/wav" };
    }
    cachePut(key, result);
    return result;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    p.stderr.on("data", (d) => (stderr = (stderr + d).slice(-3000)));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} exited ${code}: ${stderr}`))));
  });
}

// ---------------- singing ----------------
// Singing can't use pitch-shifting effects after the fact (the song would go
// out of tune with the music), so character voices are made inside the vocoder:
// octave jumps keep the key, formant shifts change the voice's size.
const SING_EFFECTS = {
  none: {}, kid: { formant: 1.18 }, cartoon: { formant: 1.28, vibrato: 1.4 }, chipmunk: { transpose: 12, formant: 1.35 },
  deep: { transpose: -12, formant: 0.9 }, monster: { transpose: -12, formant: 0.78, post: "aecho=0.8:0.5:40:0.35" },
  robot: { vibrato: 0, post: "aecho=0.8:0.6:20:0.3,flanger=delay=2:depth=2" },
  echo: { post: EFFECTS.echo.filter }, radio: { post: EFFECTS.radio.filter },
};

/** Sing a line: notes [{text, word, pitch, beats, hold?}] at `bpm` with a Kokoro voice. Returns {audio, type}. */
export async function sing({ notes, bpm, voice, effect = "none", transpose = 0 }) {
  if (!kokoro.canSing) throw Object.assign(new Error("Singing needs the free voice engine: run npm run setup:voices"), { status: 400 });
  const [provider, id] = String(voice || "").split(/:(.*)/s);
  if (provider !== "kokoro" || !kokoroVoices().some((v) => v.id === voice)) {
    throw Object.assign(new Error("Singing works with the free Kokoro voices. Pick a Kokoro voice for the singer."), { status: 400 });
  }
  if (!Array.isArray(notes) || !notes.length || notes.length > 400) throw Object.assign(new Error("No notes to sing."), { status: 400 });
  bpm = Math.min(220, Math.max(40, Number(bpm) || 100));
  const clean = notes.map((n) => ({
    text: String(n.text || "").slice(0, 40), word: Number(n.word) || 0, beats: Math.min(16, Math.max(0.125, Number(n.beats) || 1)),
    pitch: Number(n.pitch) > 0 ? Math.min(96, Math.max(36, Math.round(Number(n.pitch)))) : 0, ...(n.hold ? { hold: true } : {}),
  }));
  const fx = SING_EFFECTS[effect] || {};
  // men sing an octave lower than the written melody
  const opts = { transpose: (Number(transpose) || 0) + (id[1] === "m" ? -12 : 0) + (fx.transpose || 0), formant: fx.formant || 1, vibrato: fx.vibrato ?? 1 };

  const key = createHash("sha1").update(JSON.stringify(["sing", clean, bpm, voice, effect, opts])).digest("hex");
  const hit = cacheGet(key);
  if (hit) return hit;
  const dir = await mkdtemp(path.join(tmpdir(), "aivideo-sing-"));
  try {
    const raw = path.join(dir, "raw.wav");
    await kokoro.sing({ notes: clean, bpm, voice: id, opts, out: raw });
    let result;
    if (hasFfmpeg) {
      const out = path.join(dir, "out.mp3");
      // the singer already adds warmth and a soft room; here just gentle leveling
      const filters = [fx.post, "acompressor=threshold=-20dB:ratio=2:attack=15:release=250:makeup=2", "loudnorm=I=-16:TP=-1.5:LRA=9"].filter(Boolean);
      await run(FFMPEG, ["-y", "-i", raw, "-af", filters.join(","), "-ac", "1", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "128k", out]);
      result = { audio: await readFile(out), type: "audio/mpeg" };
    } else {
      result = { audio: await readFile(raw), type: "audio/wav" };
    }
    cachePut(key, result);
    return result;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ---------------- ElevenLabs Music ----------------
/**
 * Compose a full song (vocals + backing) with ElevenLabs Music from a
 * composition plan: { positive_global_styles, negative_global_styles, sections: [...] }.
 */
export async function composeSong(plan) {
  if (!process.env.ELEVENLABS_API_KEY) throw Object.assign(new Error("Set ELEVENLABS_API_KEY to use ElevenLabs Music."), { status: 400 });
  const sections = (plan?.sections || []).slice(0, 30).map((s, i) => ({
    section_name: String(s.section_name || `Section ${i + 1}`).slice(0, 100),
    positive_local_styles: (s.positive_local_styles || []).map(String).slice(0, 10),
    negative_local_styles: (s.negative_local_styles || []).map(String).slice(0, 10),
    duration_ms: Math.min(120000, Math.max(3000, Math.round(Number(s.duration_ms) || 3000))),
    lines: (s.lines || []).map((l) => String(l).slice(0, 200)),
  }));
  if (!sections.length) throw Object.assign(new Error("The song has no sections."), { status: 400 });
  const body = {
    composition_plan: {
      positive_global_styles: (plan.positive_global_styles || []).map(String).slice(0, 20),
      negative_global_styles: (plan.negative_global_styles || []).map(String).slice(0, 20),
      sections,
    },
    model_id: process.env.ELEVENLABS_MUSIC_MODEL || "music_v1",
    respect_sections_durations: true,
  };
  const key = createHash("sha1").update(JSON.stringify(body)).digest("hex");
  const hit = cacheGet(key);
  if (hit) return hit;
  const res = await fetch(`${elevenBase()}/v1/music?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`ElevenLabs Music error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const result = { audio: Buffer.from(await res.arrayBuffer()), type: "audio/mpeg" };
  cachePut(key, result);
  return result;
}
