import test from "node:test";
import assert from "node:assert/strict";
import { presetVoice, PRESETS, EFFECTS, kokoroVoices, KOKORO_VOICE_IDS } from "../lib/voices.js";
import { normalizeStoryboard, fallbackStoryboard } from "../lib/storyboard.js";

test("presetVoice prefers Kokoro, then OpenAI", () => {
  assert.deepEqual(presetVoice("little-kid", { providers: { kokoro: true } }), { voice: "kokoro:af_sky", effect: "kid", speed: 1 });
  assert.equal(presetVoice("little-kid", { providers: { openai: true } }).voice, "openai:shimmer");
  assert.equal(presetVoice("little-kid", { providers: {} }).voice, "");
});

test("presetVoice picks a native voice for non-English videos", () => {
  assert.equal(presetVoice("narrator-female", { providers: { kokoro: true }, language: "hi" }).voice, "kokoro:hf_alpha");
  assert.equal(presetVoice("narrator-male", { providers: { kokoro: true }, language: "es" }).voice, "kokoro:em_alex");
});

test("every preset references a known Kokoro voice and effect", () => {
  for (const p of PRESETS) {
    assert.ok(KOKORO_VOICE_IDS.includes(p.kokoro), p.id);
    assert.ok(EFFECTS[p.effect], p.id);
  }
  assert.equal(kokoroVoices().length, KOKORO_VOICE_IDS.length);
});

test("normalizeStoryboard keeps a valid cast and fixes unknown speakers", () => {
  const sb = normalizeStoryboard({
    cast: [{ name: "Robo", voiceStyle: "robot" }, { name: "robo", voiceStyle: "robot" }, { name: "Mia", voiceStyle: "nope" }],
    scenes: [{ speaker: "ROBO" }, { speaker: "Ghost" }, { speaker: "Mia" }],
    audience: "kids",
  });
  assert.deepEqual(sb.cast.map((c) => c.name), ["Robo", "Mia"]);
  assert.equal(sb.cast[1].voiceStyle, "energetic-host"); // audience default
  assert.deepEqual(sb.scenes.map((s) => s.speaker), ["Robo", "Robo", "Mia"]);
  assert.equal(sb.font, "rounded");
});

test("a storyboard without a cast gets a narrator", () => {
  const sb = normalizeStoryboard({ scenes: [{ heading: "x" }] });
  assert.equal(sb.cast.length, 1);
  assert.equal(sb.scenes[0].speaker, "Narrator");
});

test("kids template includes a sidekick character", () => {
  const sb = fallbackStoryboard({ prompt: "colors of the rainbow", audience: "little-kids" });
  assert.ok(sb.cast.some((c) => c.voiceStyle === "cartoon"));
  assert.ok(sb.scenes.some((s) => s.speaker === "Buddy"));
  assert.equal(sb.mood, "playful");
});
