// Storyboard schema, normalization, and an offline fallback generator.
// A storyboard is the single source of truth for a video: the browser
// renderer turns it into frames, and the editor lets the user tweak it.
import { z } from "zod";

export const LAYOUTS = ["title", "bullets", "quote", "statistic", "closing"];
export const BACKGROUNDS = ["gradient", "particles", "waves", "grid", "bokeh", "image"];
export const TRANSITIONS = ["fade", "slide", "zoom", "wipe"];
export const TEXT_ANIMATIONS = ["fade", "slide-up", "typewriter", "pop"];
export const MOODS = ["calm", "upbeat", "epic", "playful", "none"];
export const ASPECT_RATIOS = ["16:9", "9:16", "1:1"];

export const SceneSchema = z.object({
  heading: z.string().describe("Main on-screen text, at most ~8 words"),
  subtext: z.string().describe("Secondary on-screen line; empty string if none"),
  bullets: z.array(z.string()).describe("2-4 short points for the bullets layout, otherwise empty"),
  narration: z.string().describe("Voice-over / caption for this scene, 1-2 sentences"),
  duration: z.number().describe("Scene length in seconds, 3-10"),
  layout: z.enum(LAYOUTS),
  background: z.enum(BACKGROUNDS.filter((b) => b !== "image")),
  colors: z.array(z.string()).describe("Two background hex colors like #1e3a8a"),
  accent: z.string().describe("Accent hex color for highlights"),
  transition: z.enum(TRANSITIONS).describe("Transition into this scene"),
  textAnimation: z.enum(TEXT_ANIMATIONS),
  emoji: z.string().describe("One emoji that represents the scene, or empty string"),
});

export const StoryboardSchema = z.object({
  title: z.string(),
  mood: z.enum(MOODS).describe("Mood of the generated background music"),
  scenes: z.array(SceneSchema),
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
export function normalizeStoryboard(input, { aspectRatio = "16:9" } = {}) {
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
      image: typeof scene.image === "string" && scene.image.startsWith("data:image/") ? scene.image : undefined,
    };
  });
  if (scenes.length === 0) scenes.push(normalizeStoryboard(fallbackStoryboard({ prompt: "My video" })).scenes[0]);
  return {
    title: str(raw.title, 120) || "Untitled video",
    mood: pick(raw.mood, MOODS, "calm"),
    aspectRatio: pick(raw.aspectRatio ?? aspectRatio, ASPECT_RATIOS, "16:9"),
    scenes,
  };
}

/** Distribute a target total length across scenes, keeping each in 2-12s. */
export function fitDuration(storyboard, targetSeconds) {
  const target = Number(targetSeconds);
  if (!Number.isFinite(target) || target <= 0) return storyboard;
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
export function fallbackStoryboard({ prompt = "", duration = 30, aspectRatio = "16:9" } = {}) {
  const topic = str(prompt, 200).replace(/[.!?]+$/, "") || "Your idea";
  const short = shortTitle(topic);
  const sentences = topic.split(/(?<=[.!?])\s+|,\s+/).filter((s) => s.length > 3);
  const points = sentences.length >= 2 ? sentences.slice(0, 3) : ["What it is", "Why it matters", "How to get started"];
  const scenes = [
    { layout: "title", heading: short, subtext: "A short video", narration: `Let's talk about ${topic}.`, background: "bokeh", textAnimation: "pop", emoji: "🎬" },
    { layout: "bullets", heading: "The big picture", bullets: points, narration: `Here are the key ideas behind ${short}.`, background: "particles", textAnimation: "slide-up", emoji: "💡" },
    { layout: "statistic", heading: "1 idea", subtext: "can change everything", narration: "Small ideas, done well, add up to something big.", background: "waves", textAnimation: "pop", emoji: "📈" },
    { layout: "quote", heading: "Start where you are. Use what you have.", subtext: "Arthur Ashe", narration: "Start where you are, and use what you have.", background: "grid", textAnimation: "typewriter", emoji: "" },
    { layout: "closing", heading: "Thanks for watching", subtext: short, narration: "Thanks for watching. Now go make it happen.", background: "gradient", textAnimation: "fade", emoji: "🚀" },
  ].map((s, i) => ({ duration: 6, transition: TRANSITIONS[i % TRANSITIONS.length], ...s }));
  const sb = normalizeStoryboard({ title: short, mood: "upbeat", aspectRatio, scenes });
  return fitDuration(sb, duration);
}
