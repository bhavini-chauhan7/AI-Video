import express from "express";
import multer from "multer";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { generateStoryboard, hasApiKey, MODEL } from "./lib/claude.js";
import { fallbackStoryboard, ASPECT_RATIOS, AUDIENCES } from "./lib/storyboard.js";
import { synthesize, listVoices, providers, availableEffects, hasFfmpeg, FFMPEG, kokoro } from "./lib/tts.js";
import { PRESETS, presetVoice } from "./lib/voices.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

export const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/status", (_req, res) => {
  const p = providers();
  res.json({ ai: hasApiKey(), model: hasApiKey() ? MODEL : null, mp4: hasFfmpeg, tts: p.kokoro || p.openai || p.elevenlabs });
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
  if (!prompt) return res.status(400).json({ error: "Describe the video you want to create." });
  const duration = Math.min(180, Math.max(5, Number(req.body?.duration) || 30));
  const aspectRatio = ASPECT_RATIOS.includes(req.body?.aspectRatio) ? req.body.aspectRatio : "16:9";
  const style = String(req.body?.style ?? "").slice(0, 300);
  const scenes = Number(req.body?.scenes) > 0 ? Math.min(20, Math.round(Number(req.body.scenes))) : undefined;
  const audience = AUDIENCES[req.body?.audience] ? req.body.audience : "general";

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
