import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
const { app } = await import("../server.js");

let server, base;
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test("GET /api/status reports capabilities", async () => {
  const res = await fetch(`${base}/api/status`);
  const body = await res.json();
  assert.equal(body.ai, false);
  assert.equal(typeof body.mp4, "boolean");
});

test("POST /api/storyboard requires a prompt", async () => {
  const res = await fetch(`${base}/api/storyboard`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(res.status, 400);
});

test("POST /api/storyboard falls back to a template without an API key", async () => {
  const res = await fetch(`${base}/api/storyboard`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "Tips for better sleep", duration: 20, aspectRatio: "1:1" }),
  });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.source, "template");
  assert.equal(body.storyboard.aspectRatio, "1:1");
  assert.ok(body.storyboard.scenes.length >= 3);
});

test("GET / serves the app", async () => {
  const res = await fetch(base);
  assert.match(await res.text(), /AI Video Generator/);
});

const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
test("POST /api/convert turns WebM into MP4", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "aivideo-test-"));
  const webm = path.join(dir, "in.webm");
  spawnSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=10", "-f", "lavfi", "-i", "sine=frequency=440",
    "-t", "1", "-c:v", "libvpx", "-c:a", "libopus", webm], { stdio: "ignore" });
  const form = new FormData();
  form.append("video", new Blob([readFileSync(webm)], { type: "video/webm" }), "in.webm");
  const res = await fetch(`${base}/api/convert`, { method: "POST", body: form });
  assert.equal(res.status, 200);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.subarray(4, 8).toString(), "ftyp");
  rmSync(dir, { recursive: true, force: true });
});
