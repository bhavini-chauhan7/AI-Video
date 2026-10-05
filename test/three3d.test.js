import test from "node:test";
import assert from "node:assert/strict";
import { lookToSpec, sceneToPlan } from "../public/js/three3d/parse.js";
import { SONGBOOK, songStoryboard } from "../lib/songs.js";
import { normalizeStoryboard } from "../lib/storyboard.js";

test("descriptions become the right 3D characters", () => {
  const lily = lookToSpec("a sweet little girl with curly brown hair, big brown eyes and yellow pajamas covered in little stars", { name: "Lily" });
  assert.deepEqual([lily.kind, lily.hair, lily.outfitType, lily.pattern], ["girl", "curly", "pajamas", "stars"]);
  assert.equal(lily.outfitColor, "#ffd23f"); // yellow
  const mac = lookToSpec("a friendly farmer with a fluffy white beard, a straw hat and blue overalls");
  assert.deepEqual([mac.kind, mac.hat, mac.outfitType, mac.beard], ["grandpa", "straw", "overalls", true]);
  assert.equal(lookToSpec("a cheerful farmer grandma with round glasses").kind, "grandma");
  assert.equal(lookToSpec("a jolly teddy bear guard in a red uniform and tall black hat").kind, "bear");
  assert.equal(lookToSpec("a jolly teddy bear guard in a red uniform and tall black hat").hat, "tall");
  assert.equal(lookToSpec("a happy brown and white cow with a golden bell").kind, "cow");
  assert.equal(lookToSpec("a friendly smiling crescent moon").kind, "moon");
  assert.equal(lookToSpec("a teen girl with long black hair").hair, "long");
  assert.equal(lookToSpec("", { voiceStyle: "robot" }).kind, "robot");
});

test("scene descriptions pick the setting, time of day and action", () => {
  const plan = (t) => sceneToPlan(t);
  assert.equal(plan("Lily waves hello from her cozy bedroom window").set, "bedroom");
  assert.equal(plan("Old MacDonald waves from his tractor on a sunny farm").set, "farm"); // "waves" is not the beach
  assert.equal(plan("Lily and the star sparkle like a diamond high in the dark blue sky").set, "night"); // "sparkle" is not "park"
  assert.equal(plan("Lily twirls in her pajamas on a cloud").set, "night"); // clothing is not a setting
  const row = plan("Maya rows a little red rowboat down a calm sparkling river");
  assert.deepEqual([row.set, row.boat, row.action], ["river", true, "row"]);
  assert.equal(plan("Lily yawns and smiles at the star from her bed").action, "sleep");
  assert.ok(plan("Mary hugs her fluffy white lamb in a meadow").props.includes("sheep"));
  assert.equal(plan("Lily looks up at a big twinkling star in the night sky").night, true);
});

test("every nursery rhyme plays as a 3D cartoon with known characters", () => {
  for (const id of Object.keys(SONGBOOK)) {
    const sb = normalizeStoryboard(songStoryboard(id));
    assert.equal(sb.look, "3d", id);
    for (const c of sb.cast) assert.ok(lookToSpec(c.appearance, { name: c.name }).kind, `${id}: ${c.name}`);
  }
});
