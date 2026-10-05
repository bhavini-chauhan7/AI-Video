// Generates a storyboard from a free-form prompt using Claude structured outputs.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { StoryboardSchema, normalizeStoryboard, fitDuration } from "./storyboard.js";

export const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

const SYSTEM = `You are a creative director who turns a short brief into a storyboard for an animated motion-graphics video.
The video is rendered from text, shapes, animated backgrounds and colors (no stock footage), so write on-screen text that is short, punchy and readable at a glance.
Guidelines:
- The first scene uses the "title" layout and the last scene uses the "closing" layout.
- Use "bullets" for lists (2-4 bullets of at most 6 words each), "statistic" when a number or single bold claim is the point (put the number in heading), and "quote" for a memorable line (put the attribution in subtext).
- Narration is what a voice-over would say; it is also shown as captions, so keep each scene's narration speakable within its duration (about 2.5 words per second).
- Pick a coherent color palette across scenes with enough contrast for white text; vary backgrounds and transitions for rhythm.
- Match the tone the user asks for. Respond in the language of the brief.`;

let client;
export function hasApiKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export async function generateStoryboard({ prompt, duration = 30, aspectRatio = "16:9", style = "", scenes }) {
  client ??= new Anthropic();
  const sceneHint = scenes ? `${scenes} scenes` : `about ${Math.max(3, Math.round(duration / 6))} scenes`;
  const brief = [
    `Brief: ${prompt}`,
    `Target length: ${duration} seconds total (${sceneHint}).`,
    `Aspect ratio: ${aspectRatio}${aspectRatio === "9:16" ? " (vertical, for social media: keep headings very short)" : ""}.`,
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
  return fitDuration(normalizeStoryboard(response.parsed_output, { aspectRatio }), duration);
}
