import { VideoRenderer } from "./renderer.js";
import { Soundtrack } from "./audio.js";

const OPTIONS = {
  layout: ["title", "bullets", "quote", "statistic", "closing"],
  background: ["gradient", "particles", "waves", "grid", "bokeh", "image"],
  transition: ["fade", "slide", "zoom", "wipe"],
  textAnimation: ["fade", "slide-up", "typewriter", "pop"],
};
const EXAMPLES = [
  "A 30-second promo for a neighborhood coffee shop that roasts its own beans",
  "Explain how photosynthesis works for 10-year-olds",
  "Product launch teaser for a smart water bottle that tracks hydration",
  "5 tips to stay productive while working from home",
  "Happy birthday video for my best friend Priya who loves travel",
];
const STORAGE_KEY = "ai-video-project-v1";

const $ = (id) => document.getElementById(id);
const canvas = $("canvas");
const renderer = new VideoRenderer(canvas);
const soundtrack = new Soundtrack();
let storyboard = null;
let serverStatus = { ai: false, mp4: false };

const player = { t: 0, playing: false, startT: 0, startCtx: 0, raf: 0, lastScene: -1, exporting: false };

// ---------- helpers ----------
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const totalDuration = () => storyboard?.scenes.reduce((t, s) => t + s.duration, 0) ?? 0;

function showNotice(text, kind = "warn") {
  const el = $("notice");
  el.hidden = !text; el.textContent = text || "";
  el.classList.toggle("error", kind === "error");
}

function blankScene(i = 0) {
  return {
    heading: i === 0 ? "Your title here" : "New scene", subtext: "", bullets: [], narration: "",
    duration: 5, layout: i === 0 ? "title" : "bullets", background: "gradient",
    colors: ["#0f172a", "#1e3a8a"], accent: "#38bdf8", transition: "fade", textAnimation: "fade", emoji: "",
  };
}

function sanitize(sb) {
  if (!sb || !Array.isArray(sb.scenes) || !sb.scenes.length) throw new Error("This file has no scenes.");
  const base = blankScene(1);
  return {
    title: String(sb.title || "Untitled video"),
    mood: sb.mood || "calm",
    aspectRatio: ["16:9", "9:16", "1:1"].includes(sb.aspectRatio) ? sb.aspectRatio : "16:9",
    scenes: sb.scenes.map((s) => {
      const scene = { ...base, ...s };
      for (const [k, list] of Object.entries(OPTIONS)) if (!list.includes(scene[k])) scene[k] = base[k];
      scene.bullets = Array.isArray(scene.bullets) ? scene.bullets.map(String) : [];
      scene.colors = Array.isArray(scene.colors) && scene.colors.length >= 2 ? scene.colors.slice(0, 2) : base.colors;
      scene.duration = Math.min(30, Math.max(1, Number(scene.duration) || 5));
      for (const k of ["heading", "subtext", "narration", "emoji", "accent"]) scene[k] = String(scene[k] ?? "");
      return scene;
    }),
  };
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(storyboard)); }
  catch { /* storage full or unavailable: autosave is best-effort */ }
}

// ---------- storyboard lifecycle ----------
function setStoryboard(sb, { keepTime = false } = {}) {
  storyboard = sb;
  renderer.setStoryboard(sb);
  $("empty").hidden = true;
  $("exportBtn").disabled = false;
  $("videoTitle").textContent = sb.title;
  $("aspect").value = sb.aspectRatio;
  const moodSel = $("mood");
  if (sb.mood && moodSel.value !== "custom") moodSel.value = sb.mood;
  if (!keepTime) player.t = 0;
  player.t = Math.min(player.t, totalDuration());
  renderScenes();
  refresh();
  save();
}

/** Re-sync renderer after an edit without rebuilding the editor. */
function changed() {
  renderer.setStoryboard(storyboard);
  player.t = Math.min(player.t, totalDuration());
  updateSceneHeaders();
  refresh();
  save();
}

function refresh() {
  const d = totalDuration();
  const seek = $("seek");
  seek.max = d; seek.value = player.t;
  $("time").textContent = `${fmt(player.t)} / ${fmt(d)}`;
  if (storyboard) renderer.drawFrame(player.t);
  highlightActive();
}
renderer.onImageLoad = refresh;

// ---------- playback ----------
function play() {
  if (!storyboard || player.exporting) return;
  const d = totalDuration();
  if (player.t >= d - 0.05) player.t = 0;
  const ac = soundtrack.ensureContext();
  const mood = $("mood").value;
  player.startCtx = mood === "none" ? ac.currentTime
    : soundtrack.start({ mood, duration: d, offset: player.t, volume: +$("volume").value, destinations: [ac.destination] });
  player.startT = player.t;
  player.playing = true;
  player.lastScene = -1;
  $("playBtn").textContent = "❚❚";
  const tick = () => {
    if (!player.playing) return;
    player.t = Math.min(d, player.startT + Math.max(0, ac.currentTime - player.startCtx));
    speakIfNewScene();
    refresh();
    if (player.t >= d) return pause();
    player.raf = requestAnimationFrame(tick);
  };
  tick();
}

function pause() {
  player.playing = false;
  cancelAnimationFrame(player.raf);
  soundtrack.stop();
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  $("playBtn").textContent = "▶";
}

function speakIfNewScene() {
  if (!$("voice").checked || !("speechSynthesis" in window)) return;
  const entry = renderer.sceneAt(player.t);
  if (entry.index === player.lastScene) return;
  player.lastScene = entry.index;
  speechSynthesis.cancel();
  if (entry.scene.narration && player.t - entry.start < 0.5) {
    const u = new SpeechSynthesisUtterance(entry.scene.narration);
    u.rate = 1.05;
    speechSynthesis.speak(u);
  }
}

function seekTo(t) {
  const wasPlaying = player.playing;
  if (wasPlaying) pause();
  player.t = Math.max(0, Math.min(totalDuration(), t));
  refresh();
  if (wasPlaying) play();
}

// ---------- scene editor ----------
function sceneLabel(s) { return s.heading || s.layout; }

function renderScenes() {
  const list = $("sceneList");
  list.innerHTML = "";
  const tpl = $("sceneTpl");
  storyboard.scenes.forEach((scene, i) => {
    const el = tpl.content.firstElementChild.cloneNode(true);
    el.dataset.index = i;
    for (const [k, opts] of Object.entries(OPTIONS)) {
      const sel = el.querySelector(`[data-f=${k}]`);
      sel.innerHTML = opts.map((o) => `<option value="${o}">${o}</option>`).join("");
    }
    el.querySelectorAll("[data-f]").forEach((input) => {
      const f = input.dataset.f;
      if (f === "image") return;
      if (f === "bullets") input.value = scene.bullets.join("\n");
      else if (f === "color0") input.value = scene.colors[0];
      else if (f === "color1") input.value = scene.colors[1];
      else input.value = scene[f];
      input.addEventListener("input", () => onField(i, f, input));
    });
    el.querySelector("[data-f=image]").addEventListener("change", (e) => onImage(i, e.target));
    const clearImg = el.querySelector("[data-act=clearImg]");
    clearImg.hidden = !scene.image;
    clearImg.addEventListener("click", () => {
      delete storyboard.scenes[i].image;
      if (storyboard.scenes[i].background === "image") storyboard.scenes[i].background = "gradient";
      renderScenes(); changed();
    });
    el.querySelector("[data-show=bullets]").hidden = scene.layout !== "bullets";
    el.querySelector(".jump").addEventListener("click", () => seekTo(sceneStart(i) + 0.75));
    el.querySelectorAll(".scene-actions button").forEach((b) => b.addEventListener("click", () => sceneAction(i, b.dataset.act)));
    list.appendChild(el);
  });
  updateSceneHeaders();
}

function updateSceneHeaders() {
  document.querySelectorAll("#sceneList .scene").forEach((el) => {
    const s = storyboard.scenes[el.dataset.index];
    el.querySelector(".num").textContent = +el.dataset.index + 1;
    el.querySelector(".label").textContent = sceneLabel(s);
    el.querySelector(".dur").textContent = `${s.duration}s`;
  });
  $("sceneCount").textContent = `${storyboard.scenes.length} · ${fmt(totalDuration())}`;
}

function highlightActive() {
  if (!storyboard) return;
  const idx = renderer.sceneAt(player.t)?.index;
  document.querySelectorAll("#sceneList .scene").forEach((el) => el.classList.toggle("active", +el.dataset.index === idx));
}

const sceneStart = (i) => storyboard.scenes.slice(0, i).reduce((t, s) => t + s.duration, 0);

function onField(i, f, input) {
  const s = storyboard.scenes[i];
  if (f === "bullets") s.bullets = input.value.split("\n").map((l) => l.trim()).filter(Boolean);
  else if (f === "color0") s.colors[0] = input.value;
  else if (f === "color1") s.colors[1] = input.value;
  else if (f === "duration") { const v = parseFloat(input.value); if (!(v > 0)) return; s.duration = Math.min(30, Math.max(1, v)); }
  else s[f] = input.value;
  if (f === "layout") input.closest(".scene").querySelector("[data-show=bullets]").hidden = s.layout !== "bullets";
  // jump preview to the edited scene (past its entrance animation) so edits are visible
  if (!player.playing) player.t = Math.min(sceneStart(i) + Math.min(s.duration - 0.05, 2), totalDuration());
  changed();
}

async function onImage(i, input) {
  const file = input.files?.[0];
  if (!file) return;
  const url = await downscale(file, 1920);
  Object.assign(storyboard.scenes[i], { image: url, background: "image" });
  renderScenes(); changed();
}

function downscale(file, max) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function sceneAction(i, act) {
  const scenes = storyboard.scenes;
  if (act === "up" && i > 0) [scenes[i - 1], scenes[i]] = [scenes[i], scenes[i - 1]];
  else if (act === "down" && i < scenes.length - 1) [scenes[i + 1], scenes[i]] = [scenes[i], scenes[i + 1]];
  else if (act === "dup") scenes.splice(i + 1, 0, structuredClone(scenes[i]));
  else if (act === "del") {
    if (scenes.length === 1) return showNotice("A video needs at least one scene.");
    scenes.splice(i, 1);
  } else return;
  renderScenes(); changed();
}

// ---------- generation ----------
async function generate(e) {
  e.preventDefault();
  pause();
  const btn = $("generateBtn");
  btn.disabled = true; btn.textContent = "✨ Writing your storyboard…";
  showNotice("");
  try {
    const res = await fetch("/api/storyboard", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: $("prompt").value, duration: +$("duration").value, aspectRatio: $("aspect").value, style: $("style").value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    if (data.notice) showNotice(data.notice);
    setStoryboard(data.storyboard);
    play();
  } catch (err) {
    showNotice(err.message, "error");
  } finally {
    btn.disabled = false; btn.textContent = "✨ Generate storyboard";
  }
}

// ---------- export ----------
function pickMime() {
  // Only use MP4 when it really is H.264 (VP9-in-MP4 does not play in QuickTime/iOS); otherwise WebM.
  const candidates = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  return candidates.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || "";
}

async function exportVideo() {
  if (!storyboard || player.exporting) return;
  if (!window.MediaRecorder || !canvas.captureStream) return showNotice("This browser can't record video. Try Chrome, Edge or Firefox.", "error");
  pause();
  player.exporting = true;
  const btn = $("exportBtn"), bar = $("progressBar");
  btn.disabled = true; $("generateBtn").disabled = true;
  $("progress").hidden = false; bar.style.width = "0";
  $("exportMsg").textContent = "Rendering… keep this tab visible until it finishes.";

  const fps = +$("fps").value;
  const d = totalDuration();
  const ac = soundtrack.ensureContext();
  const dest = ac.createMediaStreamDestination();
  const mood = $("mood").value;
  renderer.drawFrame(0);
  const stream = canvas.captureStream(fps);
  dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
  const mimeType = pickMime();
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: +$("bitrate").value, audioBitsPerSecond: 192000 });
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise((r) => (recorder.onstop = r));

  recorder.start(250);
  const start = mood === "none" ? ac.currentTime + 0.05
    : soundtrack.start({ mood, duration: d, offset: 0, volume: +$("volume").value, destinations: [dest] });

  await new Promise((resolve) => {
    const tick = () => {
      const t = Math.max(0, ac.currentTime - start);
      player.t = Math.min(t, d);
      refresh();
      bar.style.width = `${Math.min(100, (t / d) * 100)}%`;
      if (t >= d + 0.2) return resolve();
      requestAnimationFrame(tick);
    };
    tick();
  });
  recorder.stop();
  await done;
  soundtrack.stop();
  stream.getTracks().forEach((t) => t.stop());

  const type = (mimeType || "video/webm").split(";")[0];
  const blob = new Blob(chunks, { type });
  const ext = type === "video/mp4" ? "mp4" : "webm";
  const name = `${(storyboard.title || "video").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "video"}.${ext}`;
  addDownload(blob, name);
  if (ext === "webm" && serverStatus.mp4) addConvertButton(blob, name.replace(/\.webm$/, ".mp4"));
  $("exportMsg").textContent = `Done: ${(blob.size / 1e6).toFixed(1)} MB ${ext.toUpperCase()}.`;
  player.exporting = false;
  btn.disabled = false; $("generateBtn").disabled = false;
  setTimeout(() => ($("progress").hidden = true), 800);
}

function addDownload(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.textContent = `⬇ ${name}`;
  $("downloads").prepend(a);
  a.click();
}

function addConvertButton(blob, name) {
  const b = document.createElement("button");
  b.className = "ghost"; b.textContent = "Convert to MP4";
  b.addEventListener("click", async () => {
    b.disabled = true; b.textContent = "Converting…";
    try {
      const form = new FormData(); form.append("video", blob, "video.webm");
      const res = await fetch("/api/convert", { method: "POST", body: form });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Conversion failed");
      addDownload(await res.blob(), name);
      b.remove();
    } catch (err) { b.textContent = err.message; }
  });
  $("downloads").prepend(b);
}

// ---------- project files ----------
function downloadProject() {
  if (!storyboard) return;
  const blob = new Blob([JSON.stringify(storyboard, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "video-project.json"; a.click();
}

async function loadProject(file) {
  try { pause(); setStoryboard(sanitize(JSON.parse(await file.text()))); showNotice(""); }
  catch (err) { showNotice(`Could not open project: ${err.message}`, "error"); }
}

// ---------- wiring ----------
$("promptForm").addEventListener("submit", generate);
$("examples").append(...EXAMPLES.map((ex) => {
  const b = document.createElement("button"); b.type = "button"; b.textContent = ex.length > 38 ? ex.slice(0, 36) + "…" : ex; b.title = ex;
  b.addEventListener("click", () => ($("prompt").value = ex));
  return b;
}));
$("playBtn").addEventListener("click", () => (player.playing ? pause() : play()));
$("seek").addEventListener("input", (e) => seekTo(+e.target.value));
$("exportBtn").addEventListener("click", exportVideo);
$("captions").addEventListener("change", (e) => { renderer.options.captions = e.target.checked; refresh(); });
$("aspect").addEventListener("change", (e) => { if (storyboard) { storyboard.aspectRatio = e.target.value; changed(); } });
$("mood").addEventListener("change", (e) => {
  if (e.target.value === "custom" && !soundtrack.customBuffer) $("musicInput").click();
  else if (storyboard && e.target.value !== "custom") { storyboard.mood = e.target.value; save(); }
  if (player.playing) { pause(); play(); }
});
$("musicInput").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) { $("mood").value = storyboard?.mood || "calm"; return; }
  try {
    await soundtrack.loadFile(file);
    $("musicName").hidden = false; $("musicName").textContent = `🎵 ${file.name}`;
  } catch { showNotice("Couldn't read that audio file.", "error"); $("mood").value = "calm"; }
});
$("volume").addEventListener("change", () => { if (player.playing) { pause(); play(); } });
$("addScene").addEventListener("click", () => {
  if (!storyboard) return setStoryboard({ title: "Untitled video", mood: "calm", aspectRatio: $("aspect").value, scenes: [blankScene(0)] });
  const last = storyboard.scenes.at(-1);
  storyboard.scenes.push({ ...blankScene(1), colors: [...last.colors], accent: last.accent });
  renderScenes(); changed();
  $("sceneList").lastElementChild?.scrollIntoView({ behavior: "smooth", block: "nearest" });
});
$("blankBtn").addEventListener("click", () => setStoryboard({ title: "Untitled video", mood: "calm", aspectRatio: $("aspect").value, scenes: [blankScene(0), blankScene(1)] }));
$("newBtn").addEventListener("click", () => {
  if (storyboard && !confirm("Start a new video? The current storyboard will be cleared (save it first if you want to keep it).")) return;
  pause(); storyboard = null;
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  location.reload();
});
$("saveBtn").addEventListener("click", downloadProject);
$("loadBtn").addEventListener("click", () => $("loadInput").click());
$("loadInput").addEventListener("change", (e) => e.target.files?.[0] && loadProject(e.target.files[0]));
document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && !/INPUT|TEXTAREA|SELECT|BUTTON/.test(document.activeElement?.tagName)) {
    e.preventDefault(); player.playing ? pause() : play();
  }
});

fetch("/api/status").then((r) => r.json()).then((s) => {
  serverStatus = s;
  $("status").innerHTML = s.ai
    ? `<span class="ok">●</span> AI scripts by Claude (${s.model})`
    : `<span class="off">●</span> Template mode: set ANTHROPIC_API_KEY on the server for AI-written storyboards`;
}).catch(() => ($("status").textContent = "Server unreachable"));

try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) setStoryboard(sanitize(JSON.parse(saved)));
} catch { /* no saved project */ }
