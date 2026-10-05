// ACE-Step 1.5 (open source, MIT): re-sings a song with a human-like voice.
//
// We use its "cover" task: the app sends a guide recording (the built-in
// singer plus the backing track, already on the beat) and ACE-Step performs
// the same melody, rhythm and chords with natural vocals and instruments.
// Talks to an ACE-Step REST API server (`uv run acestep-api`), local or remote:
//   POST /release_task -> task_id, POST /query_result -> status/result,
//   GET /v1/audio?path=... -> audio file.
import { createHash } from "node:crypto";

const base = () => (process.env.ACESTEP_URL || "http://127.0.0.1:8001").replace(/\/+$/, "");
const authHeaders = () => (process.env.ACESTEP_API_KEY ? { Authorization: `Bearer ${process.env.ACESTEP_API_KEY}` } : {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let health = { at: 0, ok: false };
/** Is an ACE-Step API server reachable? Cached for 20 s so status checks stay fast. */
export async function acestepAvailable() {
  if (Date.now() - health.at < 20000) return health.ok;
  let ok = false;
  try {
    const res = await fetch(`${base()}/health`, { headers: authHeaders(), signal: AbortSignal.timeout(1500) });
    ok = res.ok && (await res.json().catch(() => ({})))?.data?.status === "ok";
  } catch { /* not running */ }
  health = { at: Date.now(), ok };
  return ok;
}

async function call(path, init) {
  const res = await fetch(`${base()}${path}`, { ...init, headers: { ...authHeaders(), ...(init?.headers || {}) } });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || (body.code && body.code !== 200)) {
    throw new Error(`ACE-Step ${path} failed (${res.status}): ${body?.error || body?.detail || "unexpected response"}`);
  }
  return body.data;
}

const cache = new Map();

/**
 * Re-sing a guide track. Returns { audio: Buffer, type }.
 * params: { caption, lyrics, bpm, keyScale, timeSignature, duration, language, strength }
 */
export async function acestepCover(guide, guideType, params) {
  const duration = Math.min(600, Math.max(10, Number(params.duration) || 30));
  const fields = {
    task_type: "cover",
    prompt: String(params.caption || "").slice(0, 1000),
    lyrics: String(params.lyrics || "").slice(0, 5000),
    vocal_language: String(params.language || "en").slice(0, 8),
    bpm: String(Math.round(Math.min(300, Math.max(30, Number(params.bpm) || 100)))),
    key_scale: String(params.keyScale || "").slice(0, 20),
    time_signature: String(params.timeSignature || "4"),
    audio_duration: String(duration),
    audio_cover_strength: String(Math.min(1, Math.max(0, Number(params.strength ?? 0.6)))),
    audio_format: "mp3",
    batch_size: "1",
    inference_steps: String(Number(process.env.ACESTEP_STEPS) || 8),
    thinking: "false",
  };
  const key = createHash("sha1").update(guide).update(JSON.stringify(fields)).digest("hex");
  if (cache.has(key)) return cache.get(key);

  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append("src_audio", new Blob([guide], { type: guideType || "audio/wav" }), "guide.wav");
  const task = await call("/release_task", { method: "POST", body: form });
  const taskId = task?.task_id;
  if (!taskId) throw new Error("ACE-Step did not return a task id.");

  const deadline = Date.now() + (Number(process.env.ACESTEP_TIMEOUT_S) || 1200) * 1000;
  let file = null;
  while (Date.now() < deadline) {
    await sleep(2000);
    const [item] = await call("/query_result", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task_id_list: [taskId] }),
    }) || [];
    if (!item || item.status === 0) continue;
    if (item.status === 2) throw new Error(`ACE-Step could not generate the song: ${String(item.result || "failed").slice(0, 300)}`);
    let results = item.result;
    try { if (typeof results === "string") results = JSON.parse(results); } catch { results = []; }
    file = (Array.isArray(results) ? results : [results]).find((r) => r?.file)?.file;
    break;
  }
  if (!file) throw new Error("ACE-Step took too long. Try a shorter song, or check the ACE-Step window for errors.");

  const url = /^https?:\/\//.test(file) ? file : `${base()}${file.startsWith("/") ? "" : "/"}${file}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Could not download the ACE-Step song (${res.status}).`);
  const result = { audio: Buffer.from(await res.arrayBuffer()), type: res.headers.get("content-type")?.startsWith("audio/") ? res.headers.get("content-type") : "audio/mpeg" };
  cache.set(key, result);
  if (cache.size > 30) cache.delete(cache.keys().next().value);
  return result;
}
