import { VideoRenderer } from "./renderer.js";
import { Soundtrack, encodeWav } from "./audio.js";
import { buildNotes, totalBeats, displayLyrics } from "./song.js";
import { sceneCast as sharedSceneCast } from "./cast.js";
import { lookToSpec } from "./three3d/parse.js";
import { portrait } from "./three3d/portrait.js";
import { exportFrames, frameExportSupported, SAMPLE_RATE } from "./exporter.js";

const OPTIONS = {
  layout: ["title", "bullets", "quote", "statistic", "closing", "lyrics"],
  background: ["gradient", "particles", "waves", "grid", "bokeh", "image"],
  transition: ["fade", "slide", "zoom", "wipe"],
  textAnimation: ["fade", "slide-up", "typewriter", "pop"],
};
const EXAMPLES = [
  ["A happy song about brushing your teeth", "little-kids", "song"],
  ["A dance song about the colors of the rainbow", "kids", "song"],
  ["Counting from 1 to 10 with friendly farm animals", "little-kids"],
  ["A bedtime story about a little dragon who was scared of the dark", "little-kids"],
  ["Why do we have day and night? Fun science with a robot sidekick", "kids"],
  ["Amazing facts about the ocean that will blow your mind", "kids"],
  ["Study hacks that actually work before exams", "teens"],
  ["5 money habits every Gen Z should start now", "young-adults"],
  ["A 30-second promo for a neighborhood coffee shop", "general"],
];
const STORAGE_KEY = "ai-video-project-v1";
const KINDS3D = ["girl", "boy", "baby", "woman", "man", "grandma", "grandpa", "cat", "dog", "bunny", "bear", "cow", "sheep", "pig", "frog", "duck",
  "lion", "elephant", "monkey", "fox", "mouse", "penguin", "owl", "moon", "star", "sun", "cloud", "robot", "monster", "tooth"];
const SETS3D = ["bedroom", "night", "space", "farm", "river", "town", "classroom", "beach", "forest", "stage"];
const ACTIONS3D = ["idle", "wave", "dance", "jump", "clap", "point", "walk", "row", "hug", "sleep", "float"];
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
let videoType = "talk";
const KEYS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
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
  return { title: "Untitled video", mood: "calm", aspectRatio: $("aspect").value, audience, font: "modern", language: "en-us", look: "3d", cast: defaultCast(), scenes: [] };
}

function sanitize(sb) {
  if (!sb || !Array.isArray(sb.scenes) || !sb.scenes.length) throw new Error("This file has no scenes.");
  const base = blankScene(1);
  const cast = (Array.isArray(sb.cast) && sb.cast.length ? sb.cast : defaultCast()).map((c) => ({
    name: String(c.name || "Narrator"), description: String(c.description || ""), voiceStyle: String(c.voiceStyle || ""),
    voice: String(c.voice || ""), effect: String(c.effect || "none"), speed: Math.min(1.6, Math.max(0.6, Number(c.speed) || 1)),
    appearance: String(c.appearance || ""), ...(KINDS3D.includes(c.kind3d) ? { kind3d: c.kind3d } : {}), ...(/^\/media\/[\w-]+\.(png|jpe?g|webp)$/i.test(c.image || "") ? { image: c.image } : {}),
  }));
  return {
    title: String(sb.title || "Untitled video"),
    mood: sb.mood || "calm",
    aspectRatio: ["16:9", "9:16", "1:1"].includes(sb.aspectRatio) ? sb.aspectRatio : "16:9",
    audience: String(sb.audience || "general"),
    language: String(sb.language || "en-us"),
    font: ["modern", "rounded", "bold"].includes(sb.font) ? sb.font : "modern",
    look: sb.look === "3d" ? "3d" : "flat",
    ...(sb.song ? { song: sanitizeSong(sb.song) } : {}),
    cast,
    scenes: sb.scenes.map((s) => {
      const scene = { ...base, ...s };
      for (const [k, list] of Object.entries(OPTIONS)) if (!list.includes(scene[k])) scene[k] = base[k];
      scene.bullets = Array.isArray(scene.bullets) ? scene.bullets.map(String) : [];
      scene.colors = Array.isArray(scene.colors) && scene.colors.length >= 2 ? scene.colors.slice(0, 2) : base.colors;
      scene.duration = Math.min(30, Math.max(1, Number(scene.duration) || 5));
      for (const k of ["heading", "subtext", "narration", "emoji", "accent", "speaker", "lyrics", "melody", "visual"]) scene[k] = String(scene[k] ?? "");
      if (!SETS3D.includes(scene.set3d)) scene.set3d = "";
      if (!ACTIONS3D.includes(scene.action3d)) scene.action3d = "";
      if (!(scene.clip && /^\/media\/[\w-]+\.mp4$/.test(scene.clip.clip || ""))) delete scene.clip;
      if (!cast.some((c) => c.name === scene.speaker)) scene.speaker = cast[0].name;
      const vo = scene.voiceover;
      if (vo && typeof vo.audio === "string" && vo.audio.startsWith("data:audio/")) {
        scene.voiceover = { id: uid(), audio: vo.audio, duration: Number(vo.duration) || 0, key: String(vo.key || ""), source: vo.source || "tts" };
      } else delete scene.voiceover;
      return scene;
    }),
  };
}

function sanitizeSong(song) {
  const n = (v, lo, hi, d) => Math.min(hi, Math.max(lo, Number.isFinite(Number(v)) ? Number(v) : d));
  const out = {
    id: String(song.id || "custom"), bpm: n(song.bpm, 40, 220, 100), beatsPerBar: n(song.beatsPerBar, 2, 6, 4),
    key: n(song.key, 0, 11, 0), transpose: n(song.transpose, -12, 12, 0), engine: ["elevenlabs", "acestep"].includes(song.engine) ? song.engine : "builtin",
    coverStrength: n(song.coverStrength, 0, 1, 0.6),
  };
  const tr = song.track;
  if (tr && typeof tr.audio === "string" && tr.audio.startsWith("data:audio/")) out.track = { id: uid(), audio: tr.audio, duration: Number(tr.duration) || 0, key: String(tr.key || "") };
  return out;
}

// ---------- songs ----------
const notesOf = (scene) => (storyboard?.song && scene.lyrics && scene.melody ? buildNotes(scene.lyrics, scene.melody).notes : []);
const isSung = (scene) => notesOf(scene).some((n) => n.pitch);
const barSeconds = () => (60 / storyboard.song.bpm) * storyboard.song.beatsPerBar;

/** Keep every scene on the song's beat grid (mirrors fitSongDurations on the server). */
function fitSongDurations() {
  if (!storyboard?.song) return;
  const beat = 60 / storyboard.song.bpm, bar = barSeconds();
  storyboard.scenes.forEach((sc, i) => {
    const notes = notesOf(sc);
    if (notes.length) {
      sc.layout = "lyrics";
      sc.duration = Math.round(totalBeats(notes) * beat * 1000) / 1000;
      sc.narration = displayLyrics(sc.lyrics);
    } else {
      if (sc.layout === "lyrics") sc.layout = "title";
      sc.duration = Math.round(Math.max(1, Math.ceil(sc.duration / bar - 0.05)) * bar * 1000) / 1000;
    }
    syncSceneInputs(i);
  });
}

/** Song timeline for the backing track: sung lines with their start times. */
function songTimeline() {
  let start = 0;
  const lines = [];
  for (const sc of storyboard.scenes) {
    const notes = notesOf(sc);
    if (notes.length) lines.push({ start, notes });
    start += sc.duration;
  }
  return { ...storyboard.song, lines };
}

/** ElevenLabs composition plan: one section per scene, sung lines as lyrics. */
function compositionPlan() {
  const song = storyboard.song;
  const audienceStyle = { "little-kids": "for toddlers and preschoolers", kids: "for kids", teens: "for teens", "young-adults": "for young adults" }[storyboard.audience] || "family friendly";
  const singer = castFor(storyboard.scenes.find(isSung) || storyboard.scenes[0]);
  const known = song.id !== "custom" ? [`the traditional melody of the nursery rhyme "${storyboard.title}"`] : [];
  return {
    positive_global_styles: ["children's sing-along song", audienceStyle, "cheerful", "clear lead vocal",
      singer?.description || "warm friendly singer", "ukulele, glockenspiel, light percussion", `${Math.round(song.bpm)} bpm`, ...known],
    negative_global_styles: ["explicit lyrics", "heavy distortion", "screaming", "dark mood"],
    sections: storyboard.scenes.map((sc, i) => isSung(sc)
      ? { section_name: `Line ${i}`, positive_local_styles: ["sung"], negative_local_styles: [], duration_ms: Math.round(sc.duration * 1000), lines: [displayLyrics(sc.lyrics)] }
      : { section_name: i === 0 ? "Intro" : i === storyboard.scenes.length - 1 ? "Outro" : `Break ${i}`, positive_local_styles: ["instrumental"], negative_local_styles: ["vocals"], duration_ms: Math.round(sc.duration * 1000), lines: [] }),
  };
}
const ENGINE_NAMES = { elevenlabs: "ElevenLabs", acestep: "ACE-Step" };
const singerOf = () => castFor(storyboard.scenes.find(isSung) || storyboard.scenes[0]);
/** Everything that changes the produced song; a track made from different inputs is stale. */
function trackKey() {
  const song = storyboard.song;
  if (song.engine === "elevenlabs") return JSON.stringify(compositionPlan());
  const s = singerOf();
  return JSON.stringify(["acestep", song.bpm, song.transpose, song.coverStrength ?? 0.6, storyboard.audience, s?.voice, s?.effect, s?.description,
    storyboard.scenes.map((sc) => [sc.lyrics, sc.melody, sc.duration])]);
}
const useTrack = () => !!storyboard?.song && storyboard.song.engine !== "builtin";
const trackFresh = () => useTrack() && storyboard.song.track && storyboard.song.track.key === trackKey();

/** ACE-Step lyrics: sung lines grouped into sections, with structure tags. */
function aceLyrics() {
  const out = [];
  let section = null, verse = 0;
  storyboard.scenes.forEach((sc, i) => {
    if (isSung(sc)) {
      if (!section) { section = `[Verse ${++verse}]`; out.push(section); }
      out.push(displayLyrics(sc.lyrics));
    } else {
      section = null;
      out.push(i === 0 ? "[Intro]" : i === storyboard.scenes.length - 1 ? "[Outro]" : "[Instrumental]", "");
    }
  });
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function aceCaption() {
  const s = singerOf();
  const who = { "little-kids": "for toddlers and preschoolers", kids: "for kids", teens: "for teens", "young-adults": "for young adults" }[storyboard.audience] || "family friendly";
  // Kokoro ids encode gender in the second letter (af_ = female, am_ = male)
  const id = (s?.voice || "").split(":")[1] || "";
  const male = id ? id[1] === "m" : /\b(male|man|boy|grandpa|santa|giant)\b/i.test(`${s?.description} ${s?.voiceStyle}`);
  const kid = s?.effect === "kid" || /little-kid|little-boy/.test(s?.voiceStyle || "");
  const voice = kid ? `cute young child ${male ? "boy" : "girl"} lead vocal` : male ? "warm gentle male lead vocal" : "sweet clear gentle female lead vocal";
  return [`children's nursery rhyme ${who}`, voice, "soft, warm, natural human singing", "ukulele, glockenspiel, light acoustic percussion", "cheerful, cozy, sing-along",
    s?.description].filter(Boolean).join(", ");
}

/** The built-in performance (singer + backing, on the beat) that ACE-Step re-sings. */
async function renderGuide() {
  if (serverStatus.singing) {
    const missing = storyboard.scenes.map((sc, i) => i).filter((i) => isSung(storyboard.scenes[i]) && voState(i)[0] !== "ok");
    for (const [n, i] of missing.entries()) {
      $("songHint").textContent = `Preparing the guide melody: singing line ${n + 1} of ${missing.length}…`;
      const sc = storyboard.scenes[i];
      await setVoiceover(i, await requestSing(sc, castFor(sc)), "sing");
    }
  }
  await ensureBuffers();
  let start = 0;
  const voices = [];
  for (const sc of storyboard.scenes) {
    const b = isSung(sc) && sc.voiceover && buffers.get(sc.voiceover.id);
    if (b) voices.push({ buffer: b, at: start, duck: false });
    start += sc.duration;
  }
  const buf = await soundtrack.renderOffline({ mood: "playful", duration: totalDuration(), offset: 0, volume: 0.45, voices, voiceVolume: 1.1, song: songTimeline() });
  return encodeWav(buf);
}

async function composeTrack() {
  const song = storyboard.song;
  const btn = $("songTrackBtn");
  if (song.engine === "elevenlabs" && storyboard.scenes.some((sc) => sc.duration < 3)) {
    return showNotice("ElevenLabs needs every scene to be at least 3 seconds. Slow the tempo or lengthen short scenes.", "error");
  }
  if (song.engine === "acestep" && totalDuration() < 10) return showNotice("ACE-Step needs a song of at least 10 seconds.", "error");
  pause();
  btn.disabled = true;
  btn.textContent = song.engine === "acestep" ? "🎤 Singing… (first time can take several minutes)" : "🎵 Composing… (this can take a minute)";
  try {
    const key = trackKey();
    let res;
    if (song.engine === "acestep") {
      const guide = await renderGuide();
      $("songHint").textContent = "ACE-Step is singing your song…";
      const tsig = song.beatsPerBar === 3 && storyboard.scenes.some((sc) => /:1\.5\b/.test(sc.melody || "")) ? "6" : String(song.beatsPerBar);
      const form = new FormData();
      form.append("guide", guide, "guide.wav");
      form.append("params", JSON.stringify({
        caption: aceCaption(), lyrics: aceLyrics(), bpm: song.bpm, keyScale: `${KEYS[((song.key + song.transpose) % 12 + 12) % 12]} Major`,
        timeSignature: tsig, duration: Math.round(totalDuration() * 100) / 100, language: (storyboard.language || "en").slice(0, 2), strength: song.coverStrength ?? 0.6,
      }));
      res = await fetch("/api/song-ace", { method: "POST", body: form });
    } else {
      res = await fetch("/api/song-track", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan: JSON.parse(key) }) });
    }
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Composing failed (${res.status})`);
    const blob = await res.blob();
    const buffer = await soundtrack.decode(await blob.arrayBuffer());
    const track = { id: uid(), audio: await blobToDataURL(blob), duration: buffer.duration, key };
    buffers.set(track.id, buffer);
    storyboard.song.track = track;
    save(); updateSceneHeaders(); updateSongPanel(); updateMouths();
    play();
  } catch (err) {
    showNotice(err.message, "error");
  } finally {
    btn.disabled = false;
    updateSongPanel();
  }
}

function updateSongPanel() {
  const song = storyboard?.song;
  $("songPanel").hidden = !song;
  $("voiceAllBtn").textContent = song ? "🎵 Generate singing & voices" : "🔊 Generate all voice-overs";
  if (!song) return;
  $("bpm").value = song.bpm; $("bpmLabel").textContent = `${Math.round(song.bpm)} bpm`;
  $("transpose").value = song.transpose;
  $("keyLabel").textContent = `${KEYS[((song.key + song.transpose) % 12 + 12) % 12]} (${song.transpose > 0 ? "+" : ""}${song.transpose})`;
  $("songEngine").value = song.engine;
  $("songEngine").querySelector("[value=elevenlabs]").disabled = !serverStatus.music;
  $("songEngine").querySelector("[value=acestep]").disabled = !serverStatus.acestep;
  $("songTrackBtn").hidden = song.engine === "builtin";
  if (!$("songTrackBtn").disabled) $("songTrackBtn").textContent = song.engine === "acestep" ? "🎤 Sing it with ACE-Step" : "🎵 Compose the song with ElevenLabs";
  $("strengthRow").hidden = song.engine !== "acestep";
  $("strength").value = song.coverStrength ?? 0.6;
  $("songHint").textContent = song.engine === "acestep"
    ? (trackFresh() ? "✓ Sung by ACE-Step. Spoken scenes still use the cast voices." : "ACE-Step re-sings the built-in version with a natural, human-like voice, keeping the melody and timing. Press the button after you finish editing.")
    : song.engine === "elevenlabs"
      ? (trackFresh() ? "✓ Song composed. Spoken scenes still use the cast voices." : "Compose the song after you finish editing lyrics and timing. ElevenLabs writes its own arrangement, so the tune may differ from the traditional one.")
      : serverStatus.singing ? "Free synthetic singer that follows the melody exactly. For a human-like voice, choose ACE-Step."
        : "Singing needs the free voice engine (npm run setup:voices). You can still record 🎙 yourself singing each line.";
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(storyboard)); }
  catch {
    // too big for localStorage (images / audio): keep the text, drop the media
    try {
      const lite = { ...storyboard, song: storyboard.song && { ...storyboard.song, track: undefined }, scenes: storyboard.scenes.map(({ image, voiceover, ...s }) => s) };
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
  $("look3d").checked = sb.look === "3d";
  renderCast();
  renderScenes();
  updateSongPanel();
  refresh();
  save();
  updateMouths();
}

/** Re-sync renderer after an edit without rebuilding the editor. */
function changed() {
  if (storyboard.song) updateSongPanel();
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
const voKey = (scene) => {
  const c = castFor(scene);
  if (isSung(scene)) return JSON.stringify(["sing", scene.lyrics, scene.melody, storyboard.song.bpm, storyboard.song.transpose, c.voice, c.effect]);
  return JSON.stringify([scene.narration.trim(), c.voice, c.effect, c.speed]);
};

function voState(i) {
  const s = storyboard.scenes[i];
  if (busy.has(i)) return ["busy", isSung(s) ? "singing…" : "generating…"];
  if (isSung(s) && useTrack()) return trackFresh() ? ["ok", `🎵 in ${ENGINE_NAMES[storyboard.song.engine]} song`] : ["stale", storyboard.song.engine === "acestep" ? "press “Sing it with ACE-Step”" : "compose the song"];
  if (!s.voiceover) return ["", s.narration.trim() ? "no voice yet" : "no narration"];
  const generated = s.voiceover.source === "tts" || s.voiceover.source === "sing";
  const label = `${s.voiceover.source === "sing" ? "🎵" : generated ? "✓" : "🎙"} ${s.voiceover.duration.toFixed(1)}s`;
  if (generated && s.voiceover.key !== voKey(s)) return ["stale", `${label} · needs update`];
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
  const vo = { id: uid(), audio: await blobToDataURL(blob), duration: Math.round(buffer.duration * 100) / 100, key: source === "tts" || source === "sing" ? voKey(scene) : "", source };
  buffers.set(vo.id, buffer);
  scene.voiceover = vo;
  queueMicrotask(updateMouths);
  if ($("fitVoice").checked && !isSung(scene)) {
    scene.duration = Math.min(30, Math.max(2.5, Math.round((vo.duration + VOICE_LEAD + 0.6) * 10) / 10));
    if (storyboard.song) fitSongDurations(); // snap to whole bars
  }
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

async function requestSing(scene, member) {
  const res = await fetch("/api/sing", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes: notesOf(scene), bpm: storyboard.song.bpm, voice: member.voice, effect: member.effect, transpose: storyboard.song.transpose }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Singing failed (${res.status})`);
  return res.blob();
}

async function generateVoice(i) {
  const scene = storyboard.scenes[i];
  const sung = isSung(scene);
  if (sung && useTrack()) throw new Error(`With ${ENGINE_NAMES[storyboard.song.engine]}, the sung lines come from the produced song. Use the button in the Song panel.`);
  if (!sung && !scene.narration.trim()) throw new Error(`Scene ${i + 1} has no narration to speak.`);
  const member = castFor(scene);
  if (!member.voice) throw new Error(`Pick a voice for ${member.name} first.`);
  busy.add(i); updateSceneHeaders();
  try { await setVoiceover(i, sung ? await requestSing(scene, member) : await requestTTS(scene.narration, member), sung ? "sing" : "tts"); }
  finally { busy.delete(i); changed(); }
}

async function generateAllVoices() {
  const btn = $("voiceAllBtn");
  const todo = storyboard.scenes.map((s, i) => i).filter((i) => {
    const s = storyboard.scenes[i];
    if (isSung(s) && useTrack()) return false;
    const generated = s.voiceover && (s.voiceover.source === "tts" || s.voiceover.source === "sing");
    return (isSung(s) || s.narration.trim()) && (!s.voiceover || (generated && s.voiceover.key !== voKey(s)));
  });
  if (!todo.length) { $("voiceProgress").textContent = useTrack() && !trackFresh() ? `Voices are ready. Now press the ${ENGINE_NAMES[storyboard.song.engine]} button in the Song panel.` : "All scenes already have up-to-date voice-overs."; return; }
  pause();
  btn.disabled = true;
  let failed = 0;
  for (const [n, i] of todo.entries()) {
    $("voiceProgress").textContent = `${isSung(storyboard.scenes[i]) ? "Singing" : "Voicing"} scene ${i + 1} (${n + 1} of ${todo.length})…`;
    try { await generateVoice(i); } catch (err) { failed++; showNotice(err.message, "error"); }
  }
  $("voiceProgress").textContent = failed ? `Done with ${failed} error(s).` : `✓ ${todo.length} voice-over(s) ready. Press play!`;
  btn.disabled = false;
}

async function ensureBuffers() {
  const tr = storyboard.song?.track;
  if (tr && !buffers.has(tr.id)) {
    try { buffers.set(tr.id, await soundtrack.decode(await (await fetch(tr.audio)).arrayBuffer())); } catch { delete storyboard.song.track; }
  }
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
    const sung = isSung(s);
    // sung lines start on the beat and don't duck the music; the ElevenLabs song already contains them
    if (b && !(sung && trackFresh())) clips.push({ buffer: b, at: start + (sung ? 0 : VOICE_LEAD), duck: !sung });
    start += s.duration;
  }
  return clips;
}

/** What plays on the music bus: the composed song, a song backing track, or mood music. */
function musicSource() {
  if (!storyboard.song) return {};
  if (trackFresh()) return { track: buffers.get(storyboard.song.track.id) || null };
  return { song: songTimeline() };
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

// ---------- lip-sync for the 3D cartoon ----------
// Mouth openness follows the loudness of each scene's voice (or the sung track).
const envCache = new WeakMap();
function envelope(buffer, from = 0, length = buffer.duration) {
  const key = `${from}|${length}`;
  let per = envCache.get(buffer);
  if (!per) envCache.set(buffer, (per = new Map()));
  if (per.has(key)) return per.get(key);
  const sr = buffer.sampleRate, hop = Math.round(sr / 100), a = Math.floor(from * sr), n = Math.floor(length * 100);
  const ch = buffer.getChannelData(0);
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    const s0 = a + i * hop;
    for (let k = 0; k < hop && s0 + k < ch.length; k++) sum += ch[s0 + k] * ch[s0 + k];
    raw[i] = Math.sqrt(sum / hop);
  }
  const sorted = Float32Array.from(raw).sort();
  const ref = sorted[Math.floor(sorted.length * 0.9)] || 1;
  const env = new Float32Array(n);
  let v = 0;
  for (let i = 0; i < n; i++) {
    const target = Math.min(1, Math.pow(raw[i] / ref, 0.8));
    v += (target - v) * (target > v ? 0.6 : 0.25); // fast open, softer close
    env[i] = v < 0.08 ? 0 : v;
  }
  per.set(key, env);
  return env;
}

let mouths = [];
async function updateMouths() {
  if (!storyboard) return;
  await ensureBuffers();
  const track = trackFresh() && buffers.get(storyboard.song.track.id);
  mouths = storyboard.scenes.map((sc, i) => {
    const b = sc.voiceover && buffers.get(sc.voiceover.id);
    if (isSung(sc) && track) return { env: envelope(track, sceneStart(i), sc.duration), at: 0 };
    if (b) return { env: envelope(b), at: isSung(sc) ? 0 : VOICE_LEAD };
    return null;
  });
  if (!player.playing) refresh();
}
renderer.mouth = (i, t) => {
  const m = mouths[i];
  if (!m) return 0;
  const k = Math.floor((t - m.at) * 100);
  return k >= 0 && k < m.env.length ? m.env[k] : 0;
};

// ---------- 3D characters (fal.ai) ----------
const busy3d = new Map(); // scene index -> step text

async function pollJob(id, onStep) {
  for (;;) {
    await new Promise((r) => setTimeout(r, 2500));
    const res = await fetch(`/api/jobs/${id}`);
    const job = await res.json();
    if (!res.ok) throw new Error(job.error || "Lost track of the job.");
    if (job.status === "done") return job.result;
    if (job.status === "error") throw new Error(job.error);
    onStep?.(job.step);
  }
}

async function startJob(url, init) {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data.job;
}

async function designCharacter(member, onStep) {
  const job = await startJob("/api/3d/character", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: member.name, appearance: member.appearance }),
  });
  const result = await pollJob(job, onStep);
  member.image = result.image;
  member.imageKey = member.appearance;
  save(); renderCast();
}

const sceneCast = (scene) => sharedSceneCast(storyboard, scene);

const clipKey = (scene) => JSON.stringify([scene.visual, scene.heading, storyboard.aspectRatio, $("lipsync").checked && sceneHasVoice(scene) ? voiceKeyFor(scene) : "",
  sceneCast(scene).map((c) => [c.name, c.image, c.appearance])]);
const sceneHasVoice = (scene) => !!(scene.voiceover || (isSung(scene) && trackFresh()));
const voiceKeyFor = (scene) => (isSung(scene) && trackFresh() ? storyboard.song.track.key : scene.voiceover?.key || scene.voiceover?.id || "");

function clipState(i) {
  const s = storyboard.scenes[i];
  if (busy3d.has(i)) return ["busy", `🎬 ${busy3d.get(i)}`];
  if (!s.clip) return ["", serverStatus.fal ? "no 3D clip yet" : ""];
  if (s.clip.key !== clipKey(s)) return ["stale", "🎬 3D clip · needs update"];
  return ["ok", `🎬 3D clip ✓${s.clip.lipsync ? " · lip-synced" : ""}`];
}

/** The scene's voice as a WAV, starting at the scene start (what the lips should follow). */
async function sceneAudio(i) {
  await ensureBuffers();
  const scene = storyboard.scenes[i];
  const start = sceneStart(i);
  if (isSung(scene) && trackFresh()) {
    const track = buffers.get(storyboard.song.track.id);
    const sr = track.sampleRate, a = Math.floor(start * sr), n = Math.max(1, Math.floor(scene.duration * sr));
    const ctx = new OfflineAudioContext(1, n, sr);
    const out = ctx.createBuffer(1, n, sr);
    for (let c = 0; c < track.numberOfChannels; c++) {
      const src = track.getChannelData(c).subarray(a, a + n), dst = out.getChannelData(0);
      for (let k = 0; k < src.length; k++) dst[k] += src[k] / track.numberOfChannels;
    }
    return encodeWav(out);
  }
  const b = scene.voiceover && buffers.get(scene.voiceover.id);
  if (!b) return null;
  const lead = isSung(scene) ? 0 : VOICE_LEAD;
  const buf = await soundtrack.renderOffline({ mood: "none", duration: scene.duration, offset: 0, voices: [{ buffer: b, at: lead, duck: false }], voiceVolume: 1 }, 24000);
  return encodeWav(buf);
}

async function make3dScene(i, onStep) {
  const scene = storyboard.scenes[i];
  const cast = sceneCast(scene);
  for (const c of cast) {
    if (!c.image || c.imageKey !== c.appearance) { onStep?.(`designing ${c.name}…`); await designCharacter(c); }
  }
  const audio = $("lipsync").checked ? await sceneAudio(i) : null;
  const form = new FormData();
  form.append("params", JSON.stringify({
    scene: { visual: scene.visual, heading: scene.heading }, speaker: cast[0].name, sung: isSung(scene),
    characters: cast.map((c) => ({ name: c.name, appearance: c.appearance, image: c.image })), seconds: scene.duration, aspectRatio: storyboard.aspectRatio,
  }));
  if (audio) form.append("audio", audio, "voice.wav");
  const key = clipKey(scene);
  const job = await startJob("/api/3d/scene", { method: "POST", body: form });
  const result = await pollJob(job, onStep);
  scene.clip = { ...result, key };
  save(); changed();
}

async function runScene3d(i) {
  busy3d.set(i, "making 3D…"); updateSceneHeaders();
  const status = () => document.querySelector(`#sceneList .scene[data-index="${i}"] .clip-status`);
  try {
    await make3dScene(i, (step) => {
      busy3d.set(i, `${step}…`);
      const el = status(); if (el) { el.className = "clip-status busy"; el.textContent = `🎬 ${step}…`; }
    });
  } finally {
    busy3d.delete(i); updateSceneHeaders();
  }
}

async function makeAll3d() {
  const todo = storyboard.scenes.map((_, i) => i).filter((i) => clipState(i)[0] !== "ok");
  if (!todo.length) { $("threeProgress").textContent = "Every scene already has an up-to-date 3D clip."; return; }
  const newChars = new Set(todo.flatMap((i) => sceneCast(storyboard.scenes[i])).filter((c) => !c.image || c.imageKey !== c.appearance));
  const est = await (await fetch("/api/3d/estimate", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ characters: newChars.size, scenes: todo.map((i) => ({ seconds: storyboard.scenes[i].duration, voice: $("lipsync").checked && sceneHasVoice(storyboard.scenes[i]) })) }),
  })).json();
  const noVoice = $("lipsync").checked && todo.some((i) => !sceneHasVoice(storyboard.scenes[i]) && (storyboard.scenes[i].narration || isSung(storyboard.scenes[i])));
  if (!confirm(`Make ${todo.length} 3D scene(s)${newChars.size ? ` and design ${newChars.size} character(s)` : ""}?\n\n` +
    `This costs about $${est.usd.toFixed(2)} on your fal.ai account and takes a few minutes per scene.` +
    (noVoice ? "\n\nTip: generate the voices/singing first so the characters' lips can follow them." : ""))) return;
  pause();
  $("make3dBtn").disabled = true;
  let done = 0, failed = 0;
  const progress = () => ($("threeProgress").textContent = `Making 3D scenes: ${done} of ${todo.length} done${failed ? `, ${failed} failed` : ""}…`);
  progress();
  try {
    // design the characters first (one at a time), then render up to 3 scenes at once
    for (const c of newChars) {
      $("threeProgress").textContent = `Designing ${c.name}…`;
      await designCharacter(c);
    }
    progress();
    const queue = [...todo];
    const worker = async () => {
      while (queue.length) {
        const i = queue.shift();
        try { await runScene3d(i); } catch (err) { failed++; showNotice(`Scene ${i + 1}: ${err.message}`, "error"); }
        done++; progress();
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    $("threeProgress").textContent = failed ? `Finished with ${failed} failed scene(s). Press the button again to retry them.` : "✓ Your 3D video is ready. Press play!";
  } catch (err) {
    showNotice(err.message, "error");
    $("threeProgress").textContent = "";
  } finally {
    $("make3dBtn").disabled = !serverStatus.fal;
  }
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
    q("appearance").value = member.appearance || "";
    q("kind3d").innerHTML = `<option value="">Auto (from “Looks like”)</option>` + KINDS3D.map((k) => `<option value="${k}">${k}</option>`).join("");
    q("kind3d").value = member.kind3d || "";
    const showPortrait = () => {
      if (member.image) { q("image").src = member.image; q("image").hidden = false; q("image").classList.remove("portrait"); return; }
      try {
        const spec = lookToSpec(member.appearance || "", { name: member.name, voiceStyle: member.voiceStyle });
        if (member.kind3d) spec.kind = member.kind3d;
        q("image").src = portrait(spec); q("image").hidden = false; q("image").classList.add("portrait");
        q("image").title = `3D ${spec.kind}`;
      } catch { q("image").hidden = true; }
    };
    showPortrait();
    q("appearance").addEventListener("change", () => { member.appearance = q("appearance").value.trim(); showPortrait(); save(); changed(); });
    q("kind3d").addEventListener("change", () => { member.kind3d = q("kind3d").value || undefined; showPortrait(); save(); changed(); });
    const designBtn = el.querySelector("[data-act=design]");
    designBtn.hidden = !serverStatus.fal;
    designBtn.textContent = member.image ? "🎨 Redesign 3D character" : "🎨 Design 3D character";
    designBtn.addEventListener("click", async () => {
      if (!member.appearance) return showNotice(`Describe how ${member.name} looks first.`);
      designBtn.disabled = true; designBtn.textContent = "🎨 Designing… (about a minute)";
      try { member.imageKey = null; await designCharacter(member); updateSceneHeaders(); }
      catch (err) { showNotice(err.message, "error"); designBtn.disabled = false; designBtn.textContent = "🎨 Design 3D character"; }
    });
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
  renderer.playing = true;
  $("playBtn").textContent = "❚❚";
  await ensureBuffers();
  if (!player.playing) return;
  const d = totalDuration();
  if (player.t >= d - 0.05) player.t = 0;
  const ac = soundtrack.ensureContext();
  player.startCtx = soundtrack.start({
    mood: $("mood").value, duration: d, offset: player.t, volume: +$("volume").value,
    voices: voiceClips(), voiceVolume: +$("voiceVolume").value, ...musicSource(), destinations: [ac.destination],
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
  renderer.playing = player.exporting;
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
    const sung = isSung(scene);
    el.querySelector("[data-show=song]").hidden = !storyboard.song || (scene.layout !== "lyrics" && !scene.lyrics);
    el.querySelector("[data-show=talk]").hidden = sung;
    el.querySelector(".speaker-label").textContent = sung ? "Singer" : "Speaker";
    el.querySelector("[data-f=duration]").disabled = sung;
    if (sung) el.querySelector("[data-f=duration]").title = "Set by the melody and tempo";
    el.querySelector("[data-f=set3d]").innerHTML = `<option value="">Auto</option>` + SETS3D.map((k) => `<option value="${k}">${k}</option>`).join("");
    el.querySelector("[data-f=action3d]").innerHTML = `<option value="">Auto</option>` + ACTIONS3D.map((k) => `<option value="${k}">${k}</option>`).join("");
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
    const make3d = el.querySelector("[data-act=make3d]");
    make3d.hidden = !serverStatus.fal;
    make3d.addEventListener("click", async () => {
      const est = await (await fetch("/api/3d/estimate", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characters: sceneCast(storyboard.scenes[i]).filter((c) => !c.image || c.imageKey !== c.appearance).length,
          scenes: [{ seconds: storyboard.scenes[i].duration, voice: $("lipsync").checked && sceneHasVoice(storyboard.scenes[i]) }] }) })).json();
      if (!confirm(`Make scene ${i + 1} in 3D? About $${est.usd.toFixed(2)} on fal.ai.`)) return;
      pause();
      try { await runScene3d(i); } catch (err) { showNotice(err.message, "error"); }
    });
    el.querySelector("[data-act=clear3d]").addEventListener("click", () => { delete storyboard.scenes[i].clip; changed(); });
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
    el.querySelector(".dur").textContent = `${+s.duration.toFixed(1)}s`;
    const [ccls, ctext] = clipState(i);
    const cs = el.querySelector(".clip-status");
    cs.className = `clip-status ${ccls}`; cs.textContent = ctext;
    el.querySelector("[data-act=clear3d]").hidden = !s.clip;
    const thumb = el.querySelector(".clip-thumb");
    if (s.clip?.still) { if (thumb.getAttribute("src") !== s.clip.still) thumb.src = s.clip.still; thumb.hidden = false; } else thumb.hidden = true;
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
  if (storyboard.song && (f === "lyrics" || f === "melody" || f === "layout")) {
    if (f === "layout" && s.layout === "lyrics" && !s.melody) s.lyrics ||= s.heading;
    const { error } = s.lyrics && s.melody ? buildNotes(s.lyrics, s.melody) : { error: "" };
    const card = input.closest(".scene");
    card.querySelector(".melody-warn").textContent = error;
    if (s.lyrics) s.heading = displayLyrics(s.lyrics);
    fitSongDurations();
    const sung = isSung(s);
    card.querySelector("[data-show=talk]").hidden = sung;
    card.querySelector("[data-show=song]").hidden = false;
    card.querySelector("[data-f=duration]").disabled = sung;
    card.querySelector(".speaker-label").textContent = sung ? "Singer" : "Speaker";
  }
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
      body: JSON.stringify({ prompt: $("prompt").value, duration: +$("duration").value, aspectRatio: $("aspect").value, style: $("style").value, audience, type: videoType, songId: $("songPick").value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    if (data.notice) showNotice(data.notice);
    const sb = sanitize(data.storyboard);
    if (sb.song && serverStatus.acestep && sb.song.engine === "builtin") sb.song.engine = "acestep"; // human-like singer when available
    setStoryboard(sb);
    $("voiceProgress").textContent = serverStatus.tts ? `Next: press “${storyboard.song ? "Generate singing & voices" : "Generate all voice-overs"}”.` : "";
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
  renderer.playing = true;
  const btn = $("exportBtn"), bar = $("progressBar");
  btn.disabled = true; $("generateBtn").disabled = true;
  $("progress").hidden = false; bar.style.width = "0";
  $("exportMsg").textContent = "Preparing…";
  try {
    await ensureBuffers();
    await document.fonts?.ready;
    if (frameExportSupported()) {
      const result = await exportFrameByFrame(bar);
      if (result) return finishExport(result.blob, result.ext);
    }
    $("exportMsg").textContent = "Recording in real time… keep this tab visible until it finishes.";
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
      voices: voiceClips(), voiceVolume: +$("voiceVolume").value, ...musicSource(), destinations: [dest],
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
    finishExport(new Blob(chunks, { type }), type === "video/mp4" ? "mp4" : "webm");
  } catch (err) {
    $("exportMsg").textContent = `Export failed: ${err.message}`;
  } finally {
    player.exporting = false;
    renderer.playing = false;
    refresh();
    btn.disabled = false; $("generateBtn").disabled = false;
    setTimeout(() => ($("progress").hidden = true), 800);
  }
}

function finishExport(blob, ext) {
  const name = `${fileBase()}.${ext}`;
  addDownload(blob, name);
  if (ext === "webm" && serverStatus.mp4) addConvertButton(blob, name.replace(/\.webm$/, ".mp4"));
  $("exportMsg").textContent = `Done: ${(blob.size / 1e6).toFixed(1)} MB ${ext.toUpperCase()}${ext === "webm" ? " (YouTube accepts WebM; convert to MP4 for other apps)" : ""}.`;
}

/** Smooth export: mix the audio offline, then draw and encode every frame at its exact time. */
async function exportFrameByFrame(bar) {
  const d = totalDuration();
  $("exportMsg").textContent = "Mixing the sound…";
  const audio = await soundtrack.renderOffline({
    mood: $("mood").value, duration: d, offset: 0, volume: +$("volume").value,
    voices: voiceClips(), voiceVolume: +$("voiceVolume").value, ...musicSource(),
  }, SAMPLE_RATE);
  const started = Date.now();
  renderer.exactFrames = true;
  renderer.playing = false;
  try {
    return await exportFrames({
      canvas, duration: d, fps: +$("fps").value, bitrate: +$("bitrate").value * (canvas.width > 1280 ? 1.8 : 1), audio,
      drawAt: async (t) => { await renderer.prepareFrame(t); player.t = t; renderer.drawFrame(t); },
      onProgress: (p) => {
        bar.style.width = `${(p * 100).toFixed(1)}%`;
        const elapsed = (Date.now() - started) / 1000, left = p > 0.02 ? elapsed / p - elapsed : 0;
        $("exportMsg").textContent = `Rendering frame by frame… ${Math.round(p * 100)}%${left > 2 ? ` · about ${Math.ceil(left)} s left` : ""}`;
        $("time").textContent = `${fmt(p * d)} / ${fmt(d)}`;
      },
    });
  } finally {
    renderer.exactFrames = false;
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
  const song = storyboard.song && { ...storyboard.song, track: storyboard.song.track && { ...storyboard.song.track, id: undefined } };
  const data = { ...storyboard, ...(song ? { song } : {}), scenes: storyboard.scenes.map(({ voiceover, ...s }) => (voiceover ? { ...s, voiceover: { ...voiceover, id: undefined } } : s)) };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `${fileBase()}.json`; a.click();
}

async function loadProject(file) {
  try { pause(); setStoryboard(sanitize(JSON.parse(await file.text()))); showNotice(""); }
  catch (err) { showNotice(`Could not open project: ${err.message}`, "error"); }
}

function setVideoType(t) {
  videoType = t;
  document.querySelectorAll("#videoType button").forEach((b) => b.classList.toggle("on", b.dataset.t === t));
  $("songPickLabel").hidden = t !== "song";
  const custom = $("songPick").value === "custom";
  $("prompt").placeholder = t !== "song"
    ? "e.g. A 30-second promo for a neighborhood coffee shop that roasts its own beans and opens at 6am"
    : custom ? "What should the song be about? e.g. A happy song about brushing your teeth every morning and night"
      : "Optional: how should it look? e.g. cute farm animals, pastel colors";
  if (t === "song" && audience === "general") setAudience("little-kids", false);
}

// ---------- wiring ----------
$("promptForm").addEventListener("submit", generate);
document.querySelectorAll("#videoType button").forEach((b) => b.addEventListener("click", () => setVideoType(b.dataset.t)));
$("songPick").addEventListener("change", () => setVideoType("song"));
$("bpm").addEventListener("input", (e) => { storyboard.song.bpm = +e.target.value; fitSongDurations(); updateSongPanel(); changed(); });
$("bpm").addEventListener("change", restartIfPlaying);
$("transpose").addEventListener("input", (e) => { storyboard.song.transpose = +e.target.value; updateSongPanel(); changed(); });
$("transpose").addEventListener("change", restartIfPlaying);
$("songEngine").addEventListener("change", (e) => { storyboard.song.engine = e.target.value; updateSongPanel(); changed(); restartIfPlaying(); });
$("songTrackBtn").addEventListener("click", composeTrack);
$("make3dBtn").addEventListener("click", makeAll3d);
$("look3d").addEventListener("change", (e) => { if (storyboard) { storyboard.look = e.target.checked ? "3d" : "flat"; changed(); } });
$("lipsync").addEventListener("change", () => storyboard && updateSceneHeaders());
$("strength").addEventListener("change", (e) => { storyboard.song.coverStrength = +e.target.value; updateSongPanel(); updateSceneHeaders(); save(); });
$("examples").append(...EXAMPLES.map(([ex, a, type = "talk"]) => {
  const b = document.createElement("button"); b.type = "button"; b.textContent = (type === "song" ? "🎵 " : "") + (ex.length > 36 ? ex.slice(0, 34) + "…" : ex); b.title = ex;
  b.addEventListener("click", () => {
    if (type === "song") $("songPick").value = "custom";
    setVideoType(type); $("prompt").value = ex; setAudience(a, false);
  });
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
    const [status, voices, songs] = await Promise.all(["/api/status", "/api/voices", "/api/songs"].map((u) => fetch(u).then((r) => r.json())));
    $("songPick").insertAdjacentHTML("afterbegin", songs.songs.map((x) => `<option value="${esc(x.id)}">🎵 ${esc(x.title)}</option>`).join(""));
    $("songPick").value = songs.songs[0]?.id || "custom";
    serverStatus = status;
    catalog = voices;
    $("status").innerHTML = status.ai
      ? `<span class="ok">●</span> AI scripts by Claude (${esc(status.model)})`
      : `<span class="off">●</span> Template mode: set ANTHROPIC_API_KEY on the server for AI-written storyboards`;
    $("make3dBtn").disabled = !status.fal;
    $("threeHint").textContent = status.fal
      ? "Turns every scene into a 3D animated clip with your characters, and moves their mouths to the voices. Uses your fal.ai account (you'll see the price first)."
      : "Add a fal.ai key (FAL_KEY) on the server to turn scenes into 3D animated clips with talking, singing characters. See README: 3D characters.";
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
