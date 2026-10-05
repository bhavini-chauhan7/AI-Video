import test from "node:test";
import assert from "node:assert/strict";
import { estimate, PRICES } from "../lib/fal3d.js";

test("3D cost estimate adds character designs, scene stills, clips and lip-sync", () => {
  // one character + one 5 s scene with a voice: image + image + 5 s clip + 5 s of lip-sync
  const one = estimate({ characters: 1, scenes: [{ seconds: 5, voice: true }] });
  assert.equal(one, Math.round((PRICES.image * 2 + PRICES.video5 + 5 * PRICES.lipsyncPerSecond) * 100) / 100);
  // a 7 s scene renders a 10 s clip
  const long = estimate({ scenes: [{ seconds: 7, voice: false }] });
  assert.equal(long, Math.round((PRICES.image + PRICES.video5 + 5 * PRICES.videoPerExtraSecond) * 100) / 100);
  assert.equal(estimate({}), 0);
});
