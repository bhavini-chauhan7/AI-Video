// Storyboard schema, normalization, and an offline fallback generator.
// A storyboard is the single source of truth for a video: the browser
// renderer turns it into frames, and the editor lets the user tweak it.
import { z } from "zod";
import { VOICE_STYLES, LANGUAGES } from "./voices.js";
import { buildNotes, totalBeats } from "../public/js/song.js";

export const LAYOUTS = ["title", "bullets", "quote", "statistic", "closing", "lyrics"];
export const BACKGROUNDS = ["gradient", "particles", "waves", "grid", "bokeh", "image"];
export const TRANSITIONS = ["fade", "slide", "zoom", "wipe"];
export const TEXT_ANIMATIONS = ["fade", "slide-up", "typewriter", "pop"];
export const MOODS = ["calm", "upbeat", "epic", "playful", "none"];
export const ASPECT_RATIOS = ["16:9", "9:16", "1:1"];
export const FONTS = ["modern", "rounded", "bold"];
export const AUDIENCES = {
  "little-kids": { label: "Little kids (3-6)", font: "rounded", mood: "playful", narrator: "narrator-female" },
  kids: { label: "Kids (7-12)", font: "rounded", mood: "upbeat", narrator: "energetic-host" },
  teens: { label: "Teens (13-17)", font: "bold", mood: "upbeat", narrator: "hype-host" },
  "young-adults": { label: "Young adults (18-25)", font: "bold", mood: "epic", narrator: "hype-host" },
  general: { label: "Everyone", font: "modern", mood: "calm", narrator: "narrator-female" },
};

export const SceneSchema = z.object({
  heading: z.string().describe("Main on-screen text, at most ~8 words"),
  subtext: z.string().describe("Secondary on-screen line; empty string if none"),
  bullets: z.array(z.string()).describe("2-4 short points for the bullets layout, otherwise empty"),
  narration: z.string().describe("Voice-over / caption for this scene, 1-2 sentences"),
  duration: z.number().describe("Scene length in seconds, 3-10"),
  layout: z.enum(LAYOUTS.filter((l) => l !== "lyrics")),
  background: z.enum(BACKGROUNDS.filter((b) => b !== "image")),
  colors: z.array(z.string()).describe("Two background hex colors like #1e3a8a"),
  accent: z.string().describe("Accent hex color for highlights"),
  transition: z.enum(TRANSITIONS).describe("Transition into this scene"),
  textAnimation: z.enum(TEXT_ANIMATIONS),
  emoji: z.string().describe("One emoji that represents the scene, or empty string"),
  speaker: z.string().describe("Name of the cast member who speaks the narration (must match a cast name)"),
});

export const CastMemberSchema = z.object({
  name: z.string().describe("Character name shown in the editor, e.g. Narrator, Robo, Grandma Lily"),
  description: z.string().describe("One line about the character"),
  voiceStyle: z.enum(VOICE_STYLES),
});

export const StoryboardSchema = z.object({
  title: z.string(),
  mood: z.enum(MOODS).describe("Mood of the generated background music"),
  language: z.enum(LANGUAGES).describe("Language of the narration (en-us unless the brief is in another language)"),
  cast: z.array(CastMemberSchema).describe("Voices in the video: one narrator, plus 1-3 characters if the video is a story or dialogue"),
  scenes: z.array(SceneSchema),
});

export const SongSceneSchema = SceneSchema.extend({
  layout: z.enum(LAYOUTS).describe('"lyrics" for every sung scene; title/closing for the spoken intro and outro'),
  lyrics: z.string().describe('Sung line with syllables split by hyphens, e.g. "Brush, brush, brush your teeth, ev-ery mor-ning!"; empty for spoken scenes'),
  melody: z.string().describe('One note per syllable, e.g. "C4 C4 G4 G4 A4 A4 G4:2"; NOTE[:beats], beats default 1, R:beats for a rest; empty for spoken scenes'),
});

export const SongStoryboardSchema = z.object({
  title: z.string(),
  language: z.enum(LANGUAGES),
  bpm: z.number().describe("Tempo, 80-130 for kids songs"),
  cast: z.array(CastMemberSchema).describe("A narrator for the spoken intro/outro and a singer (use a different cast member for a duet or call-and-response)"),
  scenes: z.array(SongSceneSchema),
});

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
const str = (v, max = 400) => (typeof v === "string" ? v.trim().slice(0, max) : "");

const DEFAULT_PALETTES = [
  ["#0f172a", "#1e3a8a", "#38bdf8"],
  ["#1a1033", "#6d28d9", "#f472b6"],
  ["#052e16", "#047857", "#facc15"],
  ["#3b0764", "#be185d", "#fb923c"],
  ["#082f49", "#0e7490", "#a7f3d0"],
  ["#1c1917", "#9a3412", "#fde68a"],
];

/** Coerce any (possibly partial or hand-edited) storyboard into a valid one. */
export function normalizeStoryboard(input, opts = {}) {
  const raw = input && typeof input === "object" ? input : {};
  const scenesIn = Array.isArray(raw.scenes) ? raw.scenes : [];
  const scenes = scenesIn.slice(0, 30).map((s, i) => {
    const scene = s && typeof s === "object" ? s : {};
    const palette = DEFAULT_PALETTES[i % DEFAULT_PALETTES.length];
    const colors = (Array.isArray(scene.colors) ? scene.colors : []).filter((c) => HEX.test(c)).slice(0, 2);
    while (colors.length < 2) colors.push(palette[colors.length]);
    const duration = Number(scene.duration);
    return {
      heading: str(scene.heading, 120) || `Scene ${i + 1}`,
      subtext: str(scene.subtext, 200),
      bullets: (Array.isArray(scene.bullets) ? scene.bullets : []).map((b) => str(b, 120)).filter(Boolean).slice(0, 5),
      narration: str(scene.narration, 600),
      duration: Number.isFinite(duration) ? clamp(Math.round(duration * 10) / 10, 1, 30) : 5,
      layout: pick(scene.layout, LAYOUTS, i === 0 ? "title" : "bullets"),
      background: pick(scene.background, BACKGROUNDS, "gradient"),
      colors,
      accent: HEX.test(scene.accent) ? scene.accent : palette[2],
      transition: pick(scene.transition, TRANSITIONS, "fade"),
      textAnimation: pick(scene.textAnimation, TEXT_ANIMATIONS, "fade"),
      emoji: str(scene.emoji, 16),
      speaker: str(scene.speaker, 60),
      lyrics: str(scene.lyrics, 300),
      melody: str(scene.melody, 1200),
      image: typeof scene.image === "string" && scene.image.startsWith("data:image/") ? scene.image : undefined,
    };
  });
  if (scenes.length === 0) scenes.push(normalizeStoryboard(fallbackStoryboard({ prompt: "My video" })).scenes[0]);
  const audience = AUDIENCES[raw.audience ?? opts.audience] ? (raw.audience ?? opts.audience) : "general";
  const preset = AUDIENCES[audience];

  const seen = new Set();
  const cast = (Array.isArray(raw.cast) ? raw.cast : []).slice(0, 8).map((c) => {
    const m = c && typeof c === "object" ? c : {};
    const member = { name: str(m.name, 60), description: str(m.description, 200), voiceStyle: pick(m.voiceStyle, VOICE_STYLES, preset.narrator) };
    if (typeof m.voice === "string") member.voice = m.voice.slice(0, 120);
    if (typeof m.effect === "string") member.effect = m.effect.slice(0, 30);
    if (Number.isFinite(Number(m.speed)) && m.speed !== undefined) member.speed = clamp(Number(m.speed), 0.6, 1.6);
    return member;
  }).filter((m) => m.name && !seen.has(m.name.toLowerCase()) && seen.add(m.name.toLowerCase()));
  if (!cast.length) cast.push({ name: "Narrator", description: "Main voice", voiceStyle: preset.narrator });
  const names = new Map(cast.map((c) => [c.name.toLowerCase(), c.name]));
  scenes.forEach((s) => (s.speaker = names.get(s.speaker.toLowerCase()) || cast[0].name));

  const song = normalizeSong(raw.song);
  if (song) fitSongDurations({ song, scenes });
  else scenes.forEach((sc) => { if (sc.layout === "lyrics") sc.layout = "title"; delete sc.lyrics; delete sc.melody; });

  return {
    title: str(raw.title, 120) || "Untitled video",
    ...(song ? { song } : {}),
    mood: pick(raw.mood, MOODS, preset.mood),
    aspectRatio: pick(raw.aspectRatio ?? opts.aspectRatio, ASPECT_RATIOS, "16:9"),
    audience,
    language: pick(raw.language, LANGUAGES, "en-us"),
    font: pick(raw.font, FONTS, preset.font),
    cast,
    scenes,
  };
}

function normalizeSong(raw) {
  if (!raw || typeof raw !== "object") return null;
  const num = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? clamp(Math.round(Number(v)), lo, hi) || 0 : d);
  return {
    id: str(raw.id, 40) || "custom",
    bpm: num(raw.bpm, 40, 220, 100),
    beatsPerBar: num(raw.beatsPerBar, 2, 6, 4),
    key: num(raw.key, 0, 11, 0),
    transpose: num(raw.transpose, -12, 12, 0),
    engine: raw.engine === "elevenlabs" ? "elevenlabs" : "builtin",
  };
}

/**
 * In a song every scene sits on the beat grid: sung scenes last exactly as long
 * as their notes, and spoken scenes are rounded up to whole bars.
 */
export function fitSongDurations(storyboard) {
  const { song, scenes } = storyboard;
  const beat = 60 / song.bpm, bar = beat * song.beatsPerBar;
  for (const sc of scenes) {
    const notes = sc.lyrics && sc.melody ? buildNotes(sc.lyrics, sc.melody).notes : [];
    if (notes.length) {
      sc.layout = "lyrics";
      sc.duration = Math.round(totalBeats(notes) * beat * 1000) / 1000;
      sc.narration = sc.lyrics.replace(/-/g, "");
    } else {
      if (sc.layout === "lyrics") sc.layout = "title";
      sc.duration = Math.round(Math.max(1, Math.ceil(sc.duration / bar - 0.05)) * bar * 1000) / 1000;
    }
  }
  return storyboard;
}

/** Distribute a target total length across scenes, keeping each in 2-12s. */
export function fitDuration(storyboard, targetSeconds) {
  const target = Number(targetSeconds);
  if (!Number.isFinite(target) || target <= 0 || storyboard.song) return storyboard;
  const total = storyboard.scenes.reduce((t, s) => t + s.duration, 0) || 1;
  const k = target / total;
  storyboard.scenes.forEach((s) => (s.duration = clamp(Math.round(s.duration * k * 10) / 10, 2, 12)));
  return storyboard;
}

/** Short title from a prompt: first clause, at most 9 words, sentence case. */
function shortTitle(text) {
  const clause = text.split(/,|;|:|\s+(?:with|that|which|using)\s+/i)[0].trim();
  const words = clause.split(/\s+/);
  const t = words.slice(0, 9).join(" ") + (words.length > 9 ? "…" : "");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Template-based storyboard used when no ANTHROPIC_API_KEY is configured or
 * the API call fails, so the app always produces something editable.
 */
export function fallbackStoryboard({ prompt = "", duration = 30, aspectRatio = "16:9", audience = "general" } = {}) {
  const topic = str(prompt, 200).replace(/[.!?]+$/, "") || "Your idea";
  const short = shortTitle(topic);
  // "Counting animals" -> "counting animals" mid-sentence (keep acronyms like "AI tools")
  const inline = /^[A-Z][a-z]/.test(topic) ? topic[0].toLowerCase() + topic.slice(1) : topic;
  const sentences = topic.split(/(?<=[.!?])\s+|,\s+/).filter((s) => s.length > 3);
  const points = sentences.length >= 2 ? sentences.slice(0, 3) : ["What it is", "Why it matters", "How to get started"];
  const scenes = [
    { layout: "title", heading: short, subtext: "A short video", narration: `Let's talk about ${inline}.`, background: "bokeh", textAnimation: "pop", emoji: "🎬" },
    { layout: "bullets", heading: "The big picture", bullets: points, narration: `Here are the key ideas behind ${short}.`, background: "particles", textAnimation: "slide-up", emoji: "💡" },
    { layout: "statistic", heading: "1 idea", subtext: "can change everything", narration: "Small ideas, done well, add up to something big.", background: "waves", textAnimation: "pop", emoji: "📈" },
    { layout: "quote", heading: "Start where you are. Use what you have.", subtext: "Arthur Ashe", narration: "Start where you are, and use what you have.", background: "grid", textAnimation: "typewriter", emoji: "" },
    { layout: "closing", heading: "Thanks for watching", subtext: short, narration: "Thanks for watching. Now go make it happen.", background: "gradient", textAnimation: "fade", emoji: "🚀" },
  ].map((s, i) => ({ duration: 6, transition: TRANSITIONS[i % TRANSITIONS.length], ...s }));
  const kid = audience === "little-kids" || audience === "kids";
  const cast = [{ name: "Narrator", description: "Main voice", voiceStyle: AUDIENCES[audience]?.narrator }];
  if (kid) {
    cast.push({ name: "Buddy", description: "Cheerful cartoon sidekick", voiceStyle: "cartoon" });
    scenes[0] = { ...scenes[0], subtext: "Let's learn together!", narration: `Hello, friends! Today we are learning about ${inline}!`, emoji: "🌟" };
    scenes[1] = { ...scenes[1], heading: "Let's find out!", narration: "Let's find out together. Are you ready?" };
    scenes[2] = { ...scenes[2], heading: "Ready?", subtext: "Let's go!", narration: "I'm Buddy! I'm ready! Let's go!", emoji: "🎉", speaker: "Buddy" };
    scenes[3] = { ...scenes[3], layout: "statistic", heading: "Wow!", subtext: "Learning is fun", narration: "Wow! Learning new things is super fun!", emoji: "🌈", textAnimation: "pop", speaker: "Buddy" };
    scenes[4] = { ...scenes[4], heading: "Bye-bye, friends!", narration: "Thanks for watching, friends! See you next time.", emoji: "👋" };
  }
  const sb = normalizeStoryboard({ title: short, mood: AUDIENCES[audience]?.mood, aspectRatio, audience, cast, scenes });
  return fitDuration(sb, duration);
}
