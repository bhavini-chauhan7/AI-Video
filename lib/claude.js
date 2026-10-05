// Generates a storyboard from a free-form prompt using Claude structured outputs.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { StoryboardSchema, normalizeStoryboard, fitDuration, AUDIENCES } from "./storyboard.js";

export const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

const SYSTEM = `You are a creative director who turns a short brief into a storyboard for an animated motion-graphics video.
The video is rendered from text, shapes, animated backgrounds and colors (no stock footage), so write on-screen text that is short, punchy and readable at a glance.
Guidelines:
- The first scene uses the "title" layout and the last scene uses the "closing" layout.
- Use "bullets" for lists (2-4 bullets of at most 6 words each), "statistic" when a number or single bold claim is the point (put the number in heading), and "quote" for a memorable line (put the attribution in subtext).
- Narration is what a voice-over would say; it is also shown as captions, so keep each scene's narration speakable within its duration at the audience's pace below.
- Pick a coherent color palette across scenes with enough contrast for white text; vary backgrounds and transitions for rhythm.
- Narration is spoken by the cast through text-to-speech. Every scene's speaker must be one of the cast names. Use one narrator for explainers; for stories, add 1-3 characters with distinct voice styles and let them speak their own lines.
- These videos are published on YouTube: open with a hook in the first scene, keep a clear structure, and end with a short wrap-up.
- Match the tone the user asks for. Write narration and on-screen text in the language of the brief, and set "language" accordingly.`;

const AUDIENCE_GUIDE = {
  "little-kids": `Audience: little kids aged 3-6 (YouTube "made for kids").
- Very simple words, short sentences, gentle repetition, sing-song rhythm. One idea per scene.
- Friendly characters (animals, little kid, cartoon sidekick, robot) talking to the viewer; invite them to count, point, repeat or guess out loud.
- Bright cheerful palettes, big emoji on most scenes, "pop" text animations, playful music. Narration about 2 words per second.
- Never ask viewers to like, subscribe, comment or visit links; end with a warm goodbye instead. Nothing scary, unsafe to imitate, or commercial.`,
  kids: `Audience: kids aged 7-12 (YouTube "made for kids").
- Curious, fun and energetic: "Did you know?" facts, quick quizzes, silly jokes, a host plus an optional funny sidekick character.
- Clear explanations with concrete examples; colorful palettes and emoji. Narration about 2.3 words per second.
- Never ask viewers to like, subscribe, comment or visit links; end with an encouraging wrap-up.`,
  teens: `Audience: teens aged 13-17.
- Hook within the first 3 seconds, fast pacing, relatable everyday examples, light humor. Sound current without forcing slang.
- Bold high-contrast palettes, punchy short headings, energetic transitions. Narration about 2.7 words per second.
- A brief, low-pressure call to action at the end is fine.`,
  "young-adults": `Audience: young adults aged 18-25 (Gen Z).
- Scroll-stopping hook, value-dense, authentic and direct; meme-aware but not cringe. Practical takeaways.
- Bold modern palettes, big punchy text, fast cuts. Narration about 2.8 words per second.
- End with a short call to action (follow / comment your take).`,
  general: `Audience: general YouTube viewers. Clear, engaging and friendly. Narration about 2.5 words per second.`,
};

let client;
export function hasApiKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export async function generateStoryboard({ prompt, duration = 30, aspectRatio = "16:9", style = "", scenes, audience = "general" }) {
  client ??= new Anthropic();
  const sceneHint = scenes ? `${scenes} scenes` : `about ${Math.max(3, Math.round(duration / 6))} scenes`;
  const brief = [
    `Brief: ${prompt}`,
    `Target length: ${duration} seconds total (${sceneHint}).`,
    `Aspect ratio: ${aspectRatio}${aspectRatio === "9:16" ? " (vertical, for social media: keep headings very short)" : ""}.`,
    AUDIENCE_GUIDE[audience] || AUDIENCE_GUIDE.general,
    style ? `Visual style / tone: ${style}` : "",
  ].filter(Boolean).join("\n");

  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(StoryboardSchema) },
    system: SYSTEM,
    messages: [{ role: "user", content: brief }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Claude declined to create a storyboard for this prompt. Try rephrasing it.");
  }
  if (!response.parsed_output) {
    throw new Error(`Could not parse storyboard (stop_reason: ${response.stop_reason})`);
  }
  const font = AUDIENCES[audience]?.font;
  return fitDuration(normalizeStoryboard({ ...response.parsed_output, audience, font }, { aspectRatio }), duration);
}
