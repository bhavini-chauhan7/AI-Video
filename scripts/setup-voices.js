// Installs the free, offline Kokoro text-to-speech engine:
//   1. pip install kokoro-onnx + soundfile + pyworld (pyworld powers singing)
//   2. download the model (~180 MB) and voices (~28 MB) into ./models
// Usage: npm run setup:voices
import { spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, renameSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODELS = process.env.KOKORO_DIR || path.join(ROOT, "models");
const PYTHON = process.env.TTS_PYTHON || "python3";
const BASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0";
// fp16 is ~5x faster than int8 on most CPUs (int8 needs VNNI instructions to be fast)
const FILES = ["kokoro-v1.0.fp16.onnx", "voices-v1.0.bin"];

function step(msg) { console.log(`\n▶ ${msg}`); }

step(`Installing Python packages with ${PYTHON} -m pip`);
const pip = spawnSync(PYTHON, ["-m", "pip", "install", "--upgrade", "kokoro-onnx", "soundfile", "pyworld"], { stdio: "inherit" });
if (pip.status !== 0) {
  console.error(`\npip failed. Make sure Python 3.10+ is installed (set TTS_PYTHON to its path if it isn't "python3").`);
  process.exit(1);
}

mkdirSync(MODELS, { recursive: true });
for (const name of FILES) {
  const dest = path.join(MODELS, name);
  if (existsSync(dest)) { step(`${name} already downloaded`); continue; }
  step(`Downloading ${name}`);
  const res = await fetch(`${BASE}/${name}`);
  if (!res.ok) { console.error(`Download failed: HTTP ${res.status}`); process.exit(1); }
  const total = Number(res.headers.get("content-length")) || 0;
  let done = 0, last = 0;
  const body = Readable.fromWeb(res.body);
  body.on("data", (chunk) => {
    done += chunk.length;
    const pct = total ? Math.floor((done / total) * 100) : 0;
    if (pct >= last + 10) { last = pct; process.stdout.write(` ${pct}%`); }
  });
  await pipeline(body, createWriteStream(dest + ".part"));
  renameSync(dest + ".part", dest);
  console.log(" done");
}

step("Checking the engine");
const check = spawnSync(PYTHON, ["-c", "import kokoro_onnx, soundfile, pyworld; print('ok')"], { encoding: "utf8" });
if (check.status !== 0) { console.error(check.stderr); process.exit(1); }
console.log("\n✅ Voices ready. Restart the server (npm start) and the voice pickers will fill in.");
