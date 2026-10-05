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
      const models = existsSync(path.join(MODEL_DIR, "kokoro-v1.0.int8.onnx")) && existsSync(path.join(MODEL_DIR, "voices-v1.0.bin"));
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

  async synth({ text, voice, speed, out }) {
    await this.start();
    const lang = KOKORO_LANGS[voice[0]]?.code || "en-us";
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(JSON.stringify({ id, text, voice, lang, speed, out }) + "\n");
    });
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
  return { kokoro: kokoro.available, openai: Boolean(process.env.OPENAI_API_KEY), elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY) };
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
  if (cache.has(key)) {
    const hit = cache.get(key);
    cache.delete(key); cache.set(key, hit); // LRU bump
    return hit;
  }

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
    cache.set(key, result);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
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
