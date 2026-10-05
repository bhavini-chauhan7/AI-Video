import { VideoRenderer } from "./renderer.js";
import { Soundtrack } from "./audio.js";

const OPTIONS = {
  layout: ["title", "bullets", "quote", "statistic", "closing"],
  background: ["gradient", "particles", "waves", "grid", "bokeh", "image"],
  transition: ["fade", "slide", "zoom", "wipe"],
  textAnimation: ["fade", "slide-up", "typewriter", "pop"],
};
const EXAMPLES = [
  ["Counting from 1 to 10 with friendly farm animals", "little-kids"],
  ["A bedtime story about a little dragon who was scared of the dark", "little-kids"],
  ["Why do we have day and night? Fun science with a robot sidekick", "kids"],
  ["Amazing facts about the ocean that will blow your mind", "kids"],
  ["Study hacks that actually work before exams", "teens"],
  ["5 money habits every Gen Z should start now", "young-adults"],
  ["A 30-second promo for a neighborhood coffee shop", "general"],
];
const STORAGE_KEY = "ai-video-project-v1";
const VOICE_LEAD = 0.35; // seconds between scene start and its voice-over
const FONT_LOADS = { rounded: '800 40px "Baloo 2"', bold: '800 40px "Poppins"' };

const $ = (id) => document.getElementById(id);
const canvas = $("canvas");
const renderer = new VideoRenderer(canvas);
const soundtrack = new Soundtrack();
let storyboard = null;
let serverStatus = { ai: false, mp4: false, tts: false };
let catalog = { providers: {}, voices: [], effects: [{ id: "none", label: "None" }], presets: [] };
let audience = "general";
const buffers = new Map(); // voiceover id -> AudioBuffer
const busy = new Set(); // scene indexes currently generating

const player = { t: 0, playing: false, startT: 0, startCtx: 0, raf: 0, exporting: false };

// ---------- helpers ----------
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const totalDuration = () => storyboard?.scenes.reduce((t, s) => t + s.duration, 0) ?? 0;
const sceneStart = (i) => storyboard.scenes.slice(0, i).reduce((t, s) => t + s.duration, 0);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

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
    speaker: storyboard?.cast?.[0]?.name || "Narrator",
  };
}

function defaultCast() {
  const p = catalog.presets[0];
  return [{ name: "Narrator", description: "Main voice", voiceStyle: "narrator-female", voice: p?.voice || "", effect: "none", speed: 1 }];
}

function blankStoryboard() {
  return { title: "Untitled video", mood: "calm", aspectRatio: $("aspect").value, audience, font: "modern", language: "en-us", cast: defaultCast(), scenes: [] };
}

function sanitize(sb) {
  if (!sb || !Array.isArray(sb.scenes) || !sb.scenes.length) throw new Error("This file has no scenes.");
  const base = blankScene(1);
  const cast = (Array.isArray(sb.cast) && sb.cast.length ? sb.cast : defaultCast()).map((c) => ({
    name: String(c.name || "Narrator"), description: String(c.description || ""), voiceStyle: String(c.voiceStyle || ""),
    voice: String(c.voice || ""), effect: String(c.effect || "none"), speed: Math.min(1.6, Math.max(0.6, Number(c.speed) || 1)),
  }));
  return {
    title: String(sb.title || "Untitled video"),
    mood: sb.mood || "calm",
    aspectRatio: ["16:9", "9:16", "1:1"].includes(sb.aspectRatio) ? sb.aspectRatio : "16:9",
    audience: String(sb.audience || "general"),
    language: String(sb.language || "en-us"),
    font: ["modern", "rounded", "bold"].includes(sb.font) ? sb.font : "modern",
    cast,
    scenes: sb.scenes.map((s) => {
      const scene = { ...base, ...s };
      for (const [k, list] of Object.entries(OPTIONS)) if (!list.includes(scene[k])) scene[k] = base[k];
      scene.bullets = Array.isArray(scene.bullets) ? scene.bullets.map(String) : [];
      scene.colors = Array.isArray(scene.colors) && scene.colors.length >= 2 ? scene.colors.slice(0, 2) : base.colors;
      scene.duration = Math.min(30, Math.max(1, Number(scene.duration) || 5));
      for (const k of ["heading", "subtext", "narration", "emoji", "accent", "speaker"]) scene[k] = String(scene[k] ?? "");
      if (!cast.some((c) => c.name === scene.speaker)) scene.speaker = cast[0].name;
      const vo = scene.voiceover;
      if (vo && typeof vo.audio === "string" && vo.audio.startsWith("data:audio/")) {
        scene.voiceover = { id: uid(), audio: vo.audio, duration: Number(vo.duration) || 0, key: String(vo.key || ""), source: vo.source || "tts" };
      } else delete scene.voiceover;
      return scene;
    }),
  };
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(storyboard)); }
  catch {
    // too big for localStorage (images / audio): keep the text, drop the media
    try {
      const lite = { ...storyboard, scenes: storyboard.scenes.map(({ image, voiceover, ...s }) => s) };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lite));
    } catch { /* storage unavailable: autosave is best-effort */ }
  }
}

// ---------- storyboard lifecycle ----------
function setStoryboard(sb, { keepTime = false } = {}) {
  storyboard = sb;
  renderer.setStoryboard(sb);
  $("empty").hidden = true;
  $("exportBtn").disabled = false;
  $("thumbBtn").disabled = false;
  $("videoTitle").textContent = sb.title;
  $("aspect").value = sb.aspectRatio;
  $("font").value = sb.font;
  setAudience(sb.audience, false);
  const moodSel = $("mood");
  if (sb.mood && moodSel.value !== "custom") moodSel.value = sb.mood;
  if (!keepTime) player.t = 0;
  player.t = Math.min(player.t, totalDuration());
  loadFont(sb.font);
  renderCast();
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

function loadFont(font) {
  if (FONT_LOADS[font] && document.fonts) document.fonts.load(FONT_LOADS[font]).then(refresh).catch(() => {});
}

// ---------- voice-over ----------
const castFor = (scene) => storyboard.cast.find((c) => c.name === scene.speaker) || storyboard.cast[0];
const voKey = (scene) => { const c = castFor(scene); return JSON.stringify([scene.narration.trim(), c.voice, c.effect, c.speed]); };

function voState(i) {
  const s = storyboard.scenes[i];
  if (busy.has(i)) return ["busy", "generating…"];
  if (!s.voiceover) return ["", s.narration.trim() ? "no voice yet" : "no narration"];
  const label = `${s.voiceover.source === "tts" ? "✓" : "🎙"} ${s.voiceover.duration.toFixed(1)}s`;
  if (s.voiceover.source === "tts" && s.voiceover.key !== voKey(s)) return ["stale", `${label} · needs update`];
  return ["ok", label];
}

async function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result); r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

async function setVoiceover(i, blob, source) {
  const scene = storyboard.scenes[i];
  const buffer = await soundtrack.decode(await blob.arrayBuffer());
  const vo = { id: uid(), audio: await blobToDataURL(blob), duration: Math.round(buffer.duration * 100) / 100, key: source === "tts" ? voKey(scene) : "", source };
  buffers.set(vo.id, buffer);
  scene.voiceover = vo;
  if ($("fitVoice").checked) scene.duration = Math.min(30, Math.max(2.5, Math.round((vo.duration + VOICE_LEAD + 0.6) * 10) / 10));
  syncSceneInputs(i);
}

async function requestTTS(text, member) {
  const preset = catalog.presets.find((p) => p.id === member.voiceStyle);
  const res = await fetch("/api/tts", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice: member.voice, effect: member.effect, speed: member.speed, style: [preset?.label, member.description].filter(Boolean).join(", ") }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Voice generation failed (${res.status})`);
  return res.blob();
}

async function generateVoice(i) {
  const scene = storyboard.scenes[i];
  if (!scene.narration.trim()) throw new Error(`Scene ${i + 1} has no narration to speak.`);
  const member = castFor(scene);
  if (!member.voice) throw new Error(`Pick a voice for ${member.name} first.`);
  busy.add(i); updateSceneHeaders();
  try { await setVoiceover(i, await requestTTS(scene.narration, member), "tts"); }
  finally { busy.delete(i); changed(); }
}

async function generateAllVoices() {
  const btn = $("voiceAllBtn");
  const todo = storyboard.scenes.map((s, i) => i).filter((i) => {
    const s = storyboard.scenes[i];
    return s.narration.trim() && (!s.voiceover || (s.voiceover.source === "tts" && s.voiceover.key !== voKey(s)));
  });
  if (!todo.length) { $("voiceProgress").textContent = "All scenes already have up-to-date voice-overs."; return; }
  pause();
  btn.disabled = true;
  let failed = 0;
  for (const [n, i] of todo.entries()) {
    $("voiceProgress").textContent = `Voicing scene ${i + 1} (${n + 1} of ${todo.length})…`;
    try { await generateVoice(i); } catch (err) { failed++; showNotice(err.message, "error"); }
  }
  $("voiceProgress").textContent = failed ? `Done with ${failed} error(s).` : `✓ ${todo.length} voice-over(s) ready. Press play!`;
  btn.disabled = false;
}

async function ensureBuffers() {
  for (const s of storyboard.scenes) {
    const vo = s.voiceover;
    if (vo && !buffers.has(vo.id)) {
      try { buffers.set(vo.id, await soundtrack.decode(await (await fetch(vo.audio)).arrayBuffer())); }
      catch { delete s.voiceover; }
    }
  }
}

function voiceClips() {
  let start = 0;
  const clips = [];
  for (const s of storyboard.scenes) {
    const b = s.voiceover && buffers.get(s.voiceover.id);
    if (b) clips.push({ buffer: b, at: start + VOICE_LEAD });
    start += s.duration;
  }
  return clips;
}

let preview = null;
async function playClip(blobOrBuffer) {
  preview?.stop?.();
  const ac = soundtrack.ensureContext();
  const buffer = blobOrBuffer instanceof AudioBuffer ? blobOrBuffer : await soundtrack.decode(await blobOrBuffer.arrayBuffer());
  const src = ac.createBufferSource();
  src.buffer = buffer; src.connect(ac.destination); src.start();
  preview = src;
}

// microphone recording
let recording = null;
async function toggleRecord(i, btn) {
  if (recording) {
    const wasThis = recording.index === i;
    recording.recorder.stop();
    if (wasThis) return;
  }
  pause();
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch { return showNotice("Microphone access was blocked. Allow it in the browser to record a voice-over.", "error"); }
  const recorder = new MediaRecorder(stream);
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    btn.classList.remove("rec"); btn.textContent = "🎙";
    recording = null;
    try { await setVoiceover(i, new Blob(chunks, { type: recorder.mimeType }), "mic"); changed(); }
    catch { showNotice("Couldn't use that recording.", "error"); }
  };
  recorder.start();
  recording = { recorder, index: i };
  btn.classList.add("rec"); btn.textContent = "■";
  const status = btn.closest(".scene").querySelector(".vo-status");
  status.className = "vo-status busy"; status.textContent = "● recording… press ■ to stop";
  setTimeout(() => recording?.recorder === recorder && recorder.stop(), 60000);
}

// ---------- cast editor ----------
function voiceOptions(selected) {
  const groups = new Map();
  for (const v of catalog.voices) {
    if (!groups.has(v.langLabel)) groups.set(v.langLabel, []);
    groups.get(v.langLabel).push(v);
  }
  let html = "";
  if (selected && !catalog.voices.some((v) => v.id === selected)) html += `<option value="${esc(selected)}">${esc(selected)} (unavailable)</option>`;
  if (!catalog.voices.length) html += `<option value="">No voice engine: record or upload instead</option>`;
  for (const [label, list] of groups) {
    html += `<optgroup label="${esc(label)}">${list.map((v) => `<option value="${esc(v.id)}">${esc(v.name)}</option>`).join("")}</optgroup>`;
  }
  return html;
}

function renderCast() {
  const list = $("castList");
  list.innerHTML = "";
  if (!storyboard) return;
  const tpl = $("castTpl");
  storyboard.cast.forEach((member, ci) => {
    const el = tpl.content.firstElementChild.cloneNode(true);
    const q = (k) => el.querySelector(`[data-c=${k}]`);
    q("name").value = member.name;
    q("preset").innerHTML = `<option value="">Custom</option>` + catalog.presets.map((p) => `<option value="${p.id}">${esc(p.label)}</option>`).join("");
    q("preset").value = catalog.presets.some((p) => p.id === member.voiceStyle) ? member.voiceStyle : "";
    q("voice").innerHTML = voiceOptions(member.voice);
    q("voice").value = member.voice;
    q("effect").innerHTML = catalog.effects.map((e) => `<option value="${e.id}">${esc(e.label)}</option>`).join("");
    q("effect").value = member.effect;
    q("speed").value = member.speed;
    q("speed").title = `${member.speed}×`;

    q("name").addEventListener("change", () => {
      const name = q("name").value.trim();
      if (!name || storyboard.cast.some((c, j) => j !== ci && c.name === name)) { q("name").value = member.name; return; }
      storyboard.scenes.forEach((s) => s.speaker === member.name && (s.speaker = name));
      member.name = name;
      renderScenes(); save();
    });
    q("preset").addEventListener("change", () => {
      const p = catalog.presets.find((x) => x.id === q("preset").value);
      member.voiceStyle = q("preset").value;
      if (p) {
        // keep a non-English voice when the video isn't in English; presets are English voices
        if (p.voice && (storyboard.language || "en-us").startsWith("en")) member.voice = p.voice;
        member.effect = catalog.effects.some((e) => e.id === p.effect) ? p.effect : "none";
        member.speed = p.speed;
      }
      renderCast(); castChanged();
    });
    q("voice").addEventListener("change", () => { member.voice = q("voice").value; q("preset").value = ""; member.voiceStyle = ""; castChanged(); });
    q("effect").addEventListener("change", () => { member.effect = q("effect").value; castChanged(); });
    q("speed").addEventListener("change", () => { member.speed = +q("speed").value; q("speed").title = `${member.speed}×`; castChanged(); });
    el.querySelector("[data-act=test]").addEventListener("click", async (e) => {
      const b = e.currentTarget;
      const line = storyboard.scenes.find((s) => s.speaker === member.name && s.narration.trim())?.narration || `Hi! I'm ${member.name}.`;
      b.disabled = true; b.textContent = "…";
      try { await playClip(await requestTTS(line.split(/(?<=[.!?])\s/)[0], member)); }
      catch (err) { showNotice(err.message, "error"); }
      finally { b.disabled = false; b.textContent = "▶"; }
    });
    el.querySelector("[data-act=del]").addEventListener("click", () => {
      if (storyboard.cast.length === 1) return showNotice("The video needs at least one voice.");
      storyboard.cast.splice(ci, 1);
      storyboard.scenes.forEach((s) => s.speaker === member.name && (s.speaker = storyboard.cast[0].name));
      renderCast(); renderScenes(); save();
    });
    list.appendChild(el);
  });
  $("voiceAllBtn").disabled = !serverStatus.tts;
}

function castChanged() { updateSceneHeaders(); save(); }

// ---------- playback ----------
async function play() {
  if (!storyboard || player.exporting || player.playing) return;
  player.playing = true;
  $("playBtn").textContent = "❚❚";
  await ensureBuffers();
  if (!player.playing) return;
  const d = totalDuration();
  if (player.t >= d - 0.05) player.t = 0;
  const ac = soundtrack.ensureContext();
  player.startCtx = soundtrack.start({
    mood: $("mood").value, duration: d, offset: player.t, volume: +$("volume").value,
    voices: voiceClips(), voiceVolume: +$("voiceVolume").value, destinations: [ac.destination],
  });
  player.startT = player.t;
  const tick = () => {
    if (!player.playing) return;
    player.t = Math.min(d, player.startT + Math.max(0, ac.currentTime - player.startCtx));
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
  $("playBtn").textContent = "▶";
}

function restartIfPlaying() { if (player.playing) { pause(); play(); } }

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
    el.querySelector("[data-f=speaker]").innerHTML = storyboard.cast.map((c) => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join("");
    el.querySelectorAll("[data-f]").forEach((input) => {
      const f = input.dataset.f;
      if (f === "image" || f === "voFile") return;
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

    // voice-over controls
    const genBtn = el.querySelector("[data-act=voGen]");
    genBtn.disabled = !serverStatus.tts;
    genBtn.addEventListener("click", async () => {
      pause();
      try { await generateVoice(i); await playClip(buffers.get(storyboard.scenes[i].voiceover.id)); }
      catch (err) { showNotice(err.message, "error"); }
    });
    el.querySelector("[data-act=voPlay]").addEventListener("click", async () => {
      await ensureBuffers();
      const vo = storyboard.scenes[i].voiceover;
      if (vo) playClip(buffers.get(vo.id));
    });
    el.querySelector("[data-act=voRec]").addEventListener("click", (e) => toggleRecord(i, e.currentTarget));
    const file = el.querySelector("[data-f=voFile]");
    el.querySelector("[data-act=voUpload]").addEventListener("click", () => file.click());
    file.addEventListener("change", async () => {
      if (!file.files?.[0]) return;
      try { await setVoiceover(i, file.files[0], "upload"); changed(); }
      catch { showNotice("Couldn't read that audio file.", "error"); }
    });
    el.querySelector("[data-act=voClear]").addEventListener("click", () => { delete storyboard.scenes[i].voiceover; changed(); });
    list.appendChild(el);
  });
  updateSceneHeaders();
}

/** Push model values that code changed (e.g. duration after fitting) into the scene card. */
function syncSceneInputs(i) {
  const el = document.querySelector(`#sceneList .scene[data-index="${i}"]`);
  const input = el?.querySelector("[data-f=duration]");
  if (input && document.activeElement !== input) input.value = storyboard.scenes[i].duration;
}

function updateSceneHeaders() {
  document.querySelectorAll("#sceneList .scene").forEach((el) => {
    const i = +el.dataset.index;
    const s = storyboard.scenes[i];
    el.querySelector(".num").textContent = i + 1;
    el.querySelector(".label").textContent = sceneLabel(s);
    el.querySelector(".dur").textContent = `${s.duration}s`;
    const status = el.querySelector(".vo-status");
    if (recording?.index === i) return;
    const [cls, text] = voState(i);
    status.className = `vo-status ${cls}`; status.textContent = text;
    el.querySelector("[data-act=voPlay]").disabled = !s.voiceover;
    el.querySelector("[data-act=voClear]").disabled = !s.voiceover;
  });
  $("sceneCount").textContent = `${storyboard.scenes.length} · ${fmt(totalDuration())}`;
}

function highlightActive() {
  if (!storyboard) return;
  const idx = renderer.sceneAt(player.t)?.index;
  document.querySelectorAll("#sceneList .scene").forEach((el) => el.classList.toggle("active", +el.dataset.index === idx));
}

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
  else if (act === "dup") {
    const copy = structuredClone(scenes[i]);
    if (copy.voiceover) { copy.voiceover.id = uid(); buffers.set(copy.voiceover.id, buffers.get(scenes[i].voiceover.id)); }
    scenes.splice(i + 1, 0, copy);
  } else if (act === "del") {
    if (scenes.length === 1) return showNotice("A video needs at least one scene.");
    scenes.splice(i, 1);
  } else return;
  renderScenes(); changed();
}

// ---------- generation ----------
function setAudience(a, user = true) {
  audience = a || "general";
  document.querySelectorAll("#audience button").forEach((b) => b.classList.toggle("on", b.dataset.a === audience));
  if (user && storyboard) { storyboard.audience = audience; save(); }
}

async function generate(e) {
  e.preventDefault();
  pause();
  const btn = $("generateBtn");
  btn.disabled = true; btn.textContent = "✨ Writing your storyboard…";
  showNotice("");
  try {
    const res = await fetch("/api/storyboard", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: $("prompt").value, duration: +$("duration").value, aspectRatio: $("aspect").value, style: $("style").value, audience }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    if (data.notice) showNotice(data.notice);
    setStoryboard(sanitize(data.storyboard));
    $("voiceProgress").textContent = serverStatus.tts ? "Next: press “Generate all voice-overs” to give every scene a voice." : "";
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

const fileBase = () => (storyboard.title || "video").replace(/[^\p{L}\p{N}\- ]+/gu, "").trim().replace(/\s+/g, "-").toLowerCase() || "video";

async function exportVideo() {
  if (!storyboard || player.exporting) return;
  if (!window.MediaRecorder || !canvas.captureStream) return showNotice("This browser can't record video. Try Chrome, Edge or Firefox.", "error");
  pause();
  const stale = storyboard.scenes.filter((s, i) => voState(i)[0] === "stale").length;
  if (stale && !confirm(`${stale} scene(s) have voice-overs that don't match the current text or voice. Export anyway?`)) return;
  player.exporting = true;
  const btn = $("exportBtn"), bar = $("progressBar");
  btn.disabled = true; $("generateBtn").disabled = true;
  $("progress").hidden = false; bar.style.width = "0";
  $("exportMsg").textContent = "Rendering… keep this tab visible until it finishes.";
  try {
    await ensureBuffers();
    await document.fonts?.ready;
    const fps = +$("fps").value;
    const d = totalDuration();
    const ac = soundtrack.ensureContext();
    const dest = ac.createMediaStreamDestination();
    renderer.drawFrame(0);
    const stream = canvas.captureStream(fps);
    dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    const mimeType = pickMime();
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: +$("bitrate").value * (canvas.width > 1280 ? 1.8 : 1), audioBitsPerSecond: 192000 });
    const chunks = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise((r) => (recorder.onstop = r));

    recorder.start(250);
    const start = soundtrack.start({
      mood: $("mood").value, duration: d, offset: 0, volume: +$("volume").value,
      voices: voiceClips(), voiceVolume: +$("voiceVolume").value, destinations: [dest],
    });

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
    const name = `${fileBase()}.${ext}`;
    addDownload(blob, name);
    if (ext === "webm" && serverStatus.mp4) addConvertButton(blob, name.replace(/\.webm$/, ".mp4"));
    $("exportMsg").textContent = `Done: ${(blob.size / 1e6).toFixed(1)} MB ${ext.toUpperCase()}${ext === "webm" ? " (YouTube accepts WebM; convert to MP4 for other apps)" : ""}.`;
  } catch (err) {
    $("exportMsg").textContent = `Export failed: ${err.message}`;
  } finally {
    player.exporting = false;
    btn.disabled = false; $("generateBtn").disabled = false;
    setTimeout(() => ($("progress").hidden = true), 800);
  }
}

async function exportThumbnail() {
  if (!storyboard) return;
  pause();
  await document.fonts?.ready;
  const captions = renderer.options.captions;
  renderer.options.captions = false;
  renderer.drawFrame(Math.min(2.5, storyboard.scenes[0].duration - 0.1));
  const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
  renderer.options.captions = captions;
  refresh();
  addDownload(blob, `${fileBase()}-thumbnail.png`);
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
  const data = { ...storyboard, scenes: storyboard.scenes.map(({ voiceover, ...s }) => (voiceover ? { ...s, voiceover: { ...voiceover, id: undefined } } : s)) };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `${fileBase()}.json`; a.click();
}

async function loadProject(file) {
  try { pause(); setStoryboard(sanitize(JSON.parse(await file.text()))); showNotice(""); }
  catch (err) { showNotice(`Could not open project: ${err.message}`, "error"); }
}

// ---------- wiring ----------
$("promptForm").addEventListener("submit", generate);
$("examples").append(...EXAMPLES.map(([ex, a]) => {
  const b = document.createElement("button"); b.type = "button"; b.textContent = ex.length > 38 ? ex.slice(0, 36) + "…" : ex; b.title = ex;
  b.addEventListener("click", () => { $("prompt").value = ex; setAudience(a, false); });
  return b;
}));
document.querySelectorAll("#audience button").forEach((b) => b.addEventListener("click", () => setAudience(b.dataset.a)));
$("playBtn").addEventListener("click", () => (player.playing ? pause() : play()));
$("seek").addEventListener("input", (e) => seekTo(+e.target.value));
$("exportBtn").addEventListener("click", exportVideo);
$("thumbBtn").addEventListener("click", exportThumbnail);
$("captions").addEventListener("change", (e) => { renderer.options.captions = e.target.checked; refresh(); });
$("aspect").addEventListener("change", (e) => { if (storyboard) { storyboard.aspectRatio = e.target.value; changed(); } });
$("resolution").addEventListener("change", (e) => { renderer.options.resolution = e.target.value; if (storyboard) changed(); });
renderer.options.resolution = $("resolution").value;
$("font").addEventListener("change", (e) => { if (storyboard) { storyboard.font = e.target.value; loadFont(storyboard.font); changed(); } });
$("mood").addEventListener("change", (e) => {
  if (e.target.value === "custom" && !soundtrack.customBuffer) $("musicInput").click();
  else if (storyboard && e.target.value !== "custom") { storyboard.mood = e.target.value; save(); }
  restartIfPlaying();
});
$("musicInput").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) { $("mood").value = storyboard?.mood || "calm"; return; }
  try {
    await soundtrack.loadFile(file);
    $("musicName").hidden = false; $("musicName").textContent = `🎵 ${file.name}`;
  } catch { showNotice("Couldn't read that audio file.", "error"); $("mood").value = "calm"; }
});
$("volume").addEventListener("change", restartIfPlaying);
$("voiceVolume").addEventListener("change", restartIfPlaying);
$("voiceAllBtn").addEventListener("click", generateAllVoices);
$("addCast").addEventListener("click", () => {
  if (!storyboard) setStoryboard({ ...blankStoryboard(), scenes: [blankScene(0)] });
  // pick a character preset whose voice nobody in the cast uses yet
  const order = ["cartoon", "little-kid", "robot", "little-boy", "monster", "chipmunk", "grandparent", "storyteller", "giant", "santa"];
  const used = new Set(storyboard.cast.map((c) => `${c.voice}|${c.effect}`));
  const p = order.map((id) => catalog.presets.find((x) => x.id === id)).find((x) => x && !used.has(`${x.voice}|${x.effect}`)) || catalog.presets[0];
  let n = storyboard.cast.length + 1;
  while (storyboard.cast.some((c) => c.name === `Character ${n}`)) n++;
  storyboard.cast.push({ name: `Character ${n}`, description: "", voiceStyle: p?.id || "", voice: p?.voice || "", effect: p?.effect || "none", speed: p?.speed || 1 });
  renderCast(); renderScenes(); save();
});
$("addScene").addEventListener("click", () => {
  if (!storyboard) return setStoryboard({ ...blankStoryboard(), scenes: [blankScene(0)] });
  const last = storyboard.scenes.at(-1);
  storyboard.scenes.push({ ...blankScene(1), colors: [...last.colors], accent: last.accent });
  renderScenes(); changed();
  $("sceneList").lastElementChild?.scrollIntoView({ behavior: "smooth", block: "nearest" });
});
$("blankBtn").addEventListener("click", () => {
  const sb = blankStoryboard();
  storyboard = sb; // so blankScene() picks up the cast
  setStoryboard({ ...sb, scenes: [blankScene(0), blankScene(1)] });
});
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

async function init() {
  try {
    const [status, voices] = await Promise.all([fetch("/api/status").then((r) => r.json()), fetch("/api/voices").then((r) => r.json())]);
    serverStatus = status;
    catalog = voices;
    $("status").innerHTML = status.ai
      ? `<span class="ok">●</span> AI scripts by Claude (${esc(status.model)})`
      : `<span class="off">●</span> Template mode: set ANTHROPIC_API_KEY on the server for AI-written storyboards`;
    const engines = Object.entries(voices.providers).filter(([, on]) => on).map(([k]) => ({ kokoro: "Kokoro (free, offline)", openai: "OpenAI", elevenlabs: "ElevenLabs" })[k]);
    $("ttsHint").textContent = engines.length
      ? `${voices.voices.length} voices from ${engines.join(", ")}. Give each character its own voice and effect.`
      : "No text-to-speech engine on the server (run npm run setup:voices). You can still record 🎙 or upload a voice-over for each scene.";
  } catch {
    $("status").textContent = "Server unreachable";
  }
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setStoryboard(sanitize(JSON.parse(saved)));
  } catch { /* no saved project */ }
}
init();
