import express from "express";
import multer from "multer";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { generateStoryboard, generateSong, hasApiKey, MODEL } from "./lib/claude.js";
import { fallbackStoryboard, normalizeStoryboard, ASPECT_RATIOS, AUDIENCES } from "./lib/storyboard.js";
import { songList, songStoryboard } from "./lib/songs.js";
import { synthesize, sing, composeSong, listVoices, providers, availableEffects, hasFfmpeg, FFMPEG, kokoro } from "./lib/tts.js";
import { PRESETS, presetVoice } from "./lib/voices.js";
import { acestepAvailable, acestepCover } from "./lib/acestep.js";
import { falAvailable, designCharacter, makeSceneClip, estimate, MEDIA_DIR, PRICES } from "./lib/fal3d.js";
import { randomUUID } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

export const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/media", express.static(MEDIA_DIR, { maxAge: "7d", immutable: true }));
app.use("/vendor/three", express.static(path.join(__dirname, "node_modules", "three", "build")));
app.use("/vendor/mp4-muxer", express.static(path.join(__dirname, "node_modules", "mp4-muxer", "build")));
app.use("/vendor/webm-muxer", express.static(path.join(__dirname, "node_modules", "webm-muxer", "build")));

app.get("/api/status", async (_req, res) => {
  const p = providers();
  res.json({
    ai: hasApiKey(), model: hasApiKey() ? MODEL : null, mp4: hasFfmpeg, tts: p.kokoro || p.openai || p.elevenlabs,
    singing: p.singing, music: p.music, acestep: await acestepAvailable(), fal: falAvailable(),
  });
});

/** Give every cast member a concrete voice based on its voiceStyle and the voices this server has. */
async function assignVoices(storyboard) {
  const p = providers();
  if (p.elevenlabs && !p.kokoro && !p.openai) p.elevenlabsDefault = (await listVoices())[0]?.id;
  for (const member of storyboard.cast) {
    if (!member.voice) Object.assign(member, presetVoice(member.voiceStyle, { providers: p, language: storyboard.language }));
  }
  return storyboard;
}

app.get("/api/voices", async (_req, res) => {
  const p = providers();
  res.json({
    providers: p,
    voices: await listVoices(),
    effects: availableEffects(),
    presets: PRESETS.map((x) => ({ id: x.id, label: x.label, ...presetVoice(x.id, { providers: p }) })),
  });
});

app.get("/api/songs", (_req, res) => res.json({ songs: songList() }));

const audioRoute = (fn) => async (req, res) => {
  try {
    const { audio, type } = await fn(req.body ?? {});
    res.type(type).send(audio);
  } catch (err) {
    console.error(`${req.path} failed:`, err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : `Generation failed: ${err.message.slice(0, 300)}` });
  }
};
app.post("/api/sing", audioRoute(({ notes, bpm, voice, effect, transpose }) => sing({ notes, bpm, voice, effect, transpose })));
app.post("/api/song-track", audioRoute(({ plan }) => composeSong(plan)));

// ---------- 3D characters (fal.ai) ----------
// Generation takes minutes, so it runs as background jobs the browser polls.
const jobs = new Map();
function startJob(work) {
  const id = randomUUID();
  const job = { id, status: "running", step: "starting", result: null, error: null, at: Date.now() };
  jobs.set(id, job);
  work((step) => { job.step = step; })
    .then((result) => Object.assign(job, { status: "done", step: "done", result }))
    .catch((err) => { console.error("3D job failed:", err?.body ? JSON.stringify(err.body).slice(0, 500) : err.message); Object.assign(job, { status: "error", error: friendlyFalError(err) }); });
  // forget finished jobs after an hour
  for (const [k, j] of jobs) if (Date.now() - j.at > 3600_000) jobs.delete(k);
  return id;
}
function friendlyFalError(err) {
  const status = err?.status;
  if (status === 401 || status === 403) return "fal.ai rejected the key (check FAL_KEY).";
  if (status === 402) return "Your fal.ai balance is too low. Add credit at fal.ai/dashboard/billing.";
  if (status === 422) return `fal.ai could not use this input: ${JSON.stringify(err.body?.detail ?? err.body ?? "").slice(0, 200)}`;
  return `3D generation failed: ${String(err?.message || err).slice(0, 300)}`;
}
const need3d = (res) => (falAvailable() ? false : (res.status(400).json({ error: "Set FAL_KEY on the server to make 3D characters (see README: 3D characters)." }), true));

app.get("/api/jobs/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Unknown job (the server may have restarted)." });
  res.json(job);
});

app.post("/api/3d/estimate", (req, res) => {
  const scenes = (req.body?.scenes || []).slice(0, 60).map((s) => ({ seconds: Number(s.seconds) || 5, voice: !!s.voice }));
  res.json({ usd: estimate({ scenes, characters: Number(req.body?.characters) || 0 }), prices: PRICES });
});

app.post("/api/3d/character", (req, res) => {
  if (need3d(res)) return;
  const name = String(req.body?.name || "").slice(0, 60), appearance = String(req.body?.appearance || "").slice(0, 600);
  res.json({ job: startJob((onUpdate) => designCharacter({ name, appearance, onUpdate })) });
});

const sceneUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });
app.post("/api/3d/scene", sceneUpload.single("audio"), (req, res) => {
  if (need3d(res)) return;
  let p;
  try { p = JSON.parse(req.body?.params || "{}"); } catch { return res.status(400).json({ error: "Bad parameters." }); }
  const characters = (p.characters || []).slice(0, 6).map((c) => ({
    name: String(c.name || "").slice(0, 60), appearance: String(c.appearance || "").slice(0, 600),
    image: /^\/media\/[\w-]+\.(png|jpe?g|webp)$/i.test(c.image || "") ? c.image : null,
  }));
  const args = {
    scene: { visual: String(p.scene?.visual || "").slice(0, 800), heading: String(p.scene?.heading || "").slice(0, 200) },
    characters, speaker: String(p.speaker || ""), seconds: Number(p.seconds) || 5, aspectRatio: p.aspectRatio, sung: !!p.sung,
    audio: req.file?.buffer, audioType: req.file?.mimetype,
  };
  res.json({ job: startJob((onUpdate) => makeSceneClip({ ...args, onUpdate })) });
});

const guideUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 80 * 1024 * 1024 } });
app.post("/api/song-ace", guideUpload.single("guide"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No guide track uploaded." });
    if (!(await acestepAvailable())) {
      return res.status(503).json({ error: "ACE-Step isn't running. Start it (see README: ACE-Step) or set ACESTEP_URL." });
    }
    let params = {};
    try { params = JSON.parse(req.body?.params || "{}"); } catch { return res.status(400).json({ error: "Bad parameters." }); }
    const { audio, type } = await acestepCover(req.file.buffer, req.file.mimetype, params);
    res.type(type).send(audio);
  } catch (err) {
    console.error("/api/song-ace failed:", err.message);
    res.status(502).json({ error: err.message.slice(0, 400) });
  }
});

app.post("/api/tts", async (req, res) => {
  try {
    const { text, voice, effect, speed, style } = req.body ?? {};
    const { audio, type } = await synthesize({ text, voice, effect, speed, style });
    res.type(type).send(audio);
  } catch (err) {
    console.error("tts failed:", err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : `Voice generation failed: ${err.message.slice(0, 300)}` });
  }
});

app.post("/api/storyboard", async (req, res) => {
  const prompt = String(req.body?.prompt ?? "").trim().slice(0, 2000);
  const isClassicSong = req.body?.type === "song" && req.body?.songId && req.body.songId !== "custom";
  if (!prompt && !isClassicSong) return res.status(400).json({ error: "Describe the video you want to create." });
  const duration = Math.min(180, Math.max(5, Number(req.body?.duration) || 30));
  const aspectRatio = ASPECT_RATIOS.includes(req.body?.aspectRatio) ? req.body.aspectRatio : "16:9";
  const style = String(req.body?.style ?? "").slice(0, 300);
  const scenes = Number(req.body?.scenes) > 0 ? Math.min(20, Math.round(Number(req.body.scenes))) : undefined;
  const audience = AUDIENCES[req.body?.audience] ? req.body.audience : "general";

  const songId = String(req.body?.songId ?? "");
  if (req.body?.type === "song" && songId !== "custom") {
    try {
      const sb = normalizeStoryboard(songStoryboard(songId, { aspectRatio, audience }), { aspectRatio });
      return res.json({ storyboard: await assignVoices(sb), source: "songbook" });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }
  if (req.body?.type === "song") {
    if (!hasApiKey()) return res.status(400).json({ error: "Writing an original song needs ANTHROPIC_API_KEY. You can pick one of the classic nursery rhymes instead." });
    try {
      return res.json({ storyboard: await assignVoices(await generateSong({ prompt, duration, aspectRatio, style, audience })), source: "ai" });
    } catch (err) {
      console.error("song generation failed:", err);
      return res.status(502).json({ error: err instanceof Anthropic.APIError ? `Claude API error (${err.status ?? "network"}).` : err.message });
    }
  }
  if (!hasApiKey()) {
    return res.json({ storyboard: await assignVoices(fallbackStoryboard({ prompt, duration, aspectRatio, audience })), source: "template",
      notice: "No ANTHROPIC_API_KEY set: generated a template storyboard. Add a key for AI-written scripts." });
  }
  try {
    const storyboard = await assignVoices(await generateStoryboard({ prompt, duration, aspectRatio, style, scenes, audience }));
    res.json({ storyboard, source: "ai" });
  } catch (err) {
    const message = err instanceof Anthropic.AuthenticationError ? "Invalid ANTHROPIC_API_KEY."
      : err instanceof Anthropic.RateLimitError ? "Rate limited by the Claude API. Try again in a moment."
      : err instanceof Anthropic.APIError ? `Claude API error (${err.status ?? "network"}).`
      : err.message;
    console.error("storyboard generation failed:", err);
    res.json({ storyboard: await assignVoices(fallbackStoryboard({ prompt, duration, aspectRatio, audience })), source: "template",
      notice: `${message} Showing a template storyboard instead.` });
  }
});

// Optional WebM -> MP4 conversion when ffmpeg is installed on the server.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });
app.post("/api/convert", upload.single("video"), async (req, res) => {
  if (!hasFfmpeg) return res.status(501).json({ error: "ffmpeg is not installed on the server." });
  if (!req.file) return res.status(400).json({ error: "No video uploaded." });
  const dir = await mkdtemp(path.join(tmpdir(), "aivideo-"));
  const input = path.join(dir, "in.webm");
  const output = path.join(dir, "out.mp4");
  try {
    await writeFile(input, req.file.buffer);
    await new Promise((resolve, reject) => {
      const ff = spawn(FFMPEG, ["-y", "-i", input, "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
        "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", output],
        { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      ff.stderr.on("data", (d) => (stderr = (stderr + d).slice(-4000)));
      ff.on("error", reject);
      ff.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr}`))));
    });
    res.download(output, "video.mp4", () => rm(dir, { recursive: true, force: true }));
  } catch (err) {
    console.error("conversion failed:", err);
    await rm(dir, { recursive: true, force: true });
    res.status(500).json({ error: "Video conversion failed." });
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(PORT, () => {
    const p = providers();
    const tts = Object.keys(p).filter((k) => p[k]);
    console.log(`AI Video Generator running at http://localhost:${PORT}`);
    console.log(`  Claude: ${hasApiKey() ? `enabled (${MODEL})` : "disabled (set ANTHROPIC_API_KEY)"}  |  MP4 export: ${hasFfmpeg ? "enabled" : "disabled (install ffmpeg)"}`);
    console.log(`  Voices: ${tts.length ? tts.join(", ") : "none (run npm run setup:voices, or set OPENAI_API_KEY / ELEVENLABS_API_KEY)"}`);
    if (p.kokoro) kokoro.start().catch((err) => console.error(err.message)); // warm up the model
  });
  process.on("SIGINT", () => { kokoro.stop(); process.exit(0); });
  process.on("SIGTERM", () => { kokoro.stop(); process.exit(0); });
}
