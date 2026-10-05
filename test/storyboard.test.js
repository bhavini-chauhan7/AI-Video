import test from "node:test";
import assert from "node:assert/strict";
import { normalizeStoryboard, fallbackStoryboard, fitDuration, LAYOUTS } from "../lib/storyboard.js";

test("normalizeStoryboard fills defaults and clamps bad values", () => {
  const sb = normalizeStoryboard({
    title: "  Demo  ",
    mood: "weird",
    scenes: [{ heading: "Hi", duration: 999, layout: "nope", colors: ["red", "#123456"], accent: "blue", bullets: ["a", "", 3] }],
  });
  assert.equal(sb.title, "Demo");
  assert.equal(sb.mood, "calm");
  assert.equal(sb.aspectRatio, "16:9");
  const [s] = sb.scenes;
  assert.equal(s.duration, 30);
  assert.ok(LAYOUTS.includes(s.layout));
  assert.equal(s.colors.length, 2);
  assert.equal(s.colors[0], "#123456");
  assert.match(s.accent, /^#/);
  assert.deepEqual(s.bullets, ["a"]);
});

test("normalizeStoryboard never returns an empty scene list", () => {
  assert.equal(normalizeStoryboard({ scenes: [] }).scenes.length, 1);
  assert.equal(normalizeStoryboard(null).scenes.length, 1);
});

test("normalizeStoryboard drops non-image data URLs", () => {
  const sb = normalizeStoryboard({ scenes: [{ image: "javascript:alert(1)" }, { image: "data:image/png;base64,AAA" }] });
  assert.equal(sb.scenes[0].image, undefined);
  assert.equal(sb.scenes[1].image, "data:image/png;base64,AAA");
});

test("fitDuration scales scenes toward target length", () => {
  const sb = normalizeStoryboard({ scenes: [{ duration: 5 }, { duration: 5 }, { duration: 5 }] });
  fitDuration(sb, 30);
  const total = sb.scenes.reduce((t, s) => t + s.duration, 0);
  assert.ok(Math.abs(total - 30) < 0.5, `total ${total}`);
});

test("fallbackStoryboard produces a title-to-closing video of the requested length", () => {
  const sb = fallbackStoryboard({ prompt: "launch video for a coffee shop", duration: 45, aspectRatio: "9:16" });
  assert.equal(sb.aspectRatio, "9:16");
  assert.equal(sb.scenes[0].layout, "title");
  assert.equal(sb.scenes.at(-1).layout, "closing");
  const total = sb.scenes.reduce((t, s) => t + s.duration, 0);
  assert.ok(Math.abs(total - 45) < 1, `total ${total}`);
});
