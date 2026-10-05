import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

// A stand-in for the ACE-Step REST API (POST /release_task, POST /query_result, GET /v1/audio, GET /health)
let server, seen = {};
before(async () => {
  let polls = 0;
  server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (d) => chunks.push(d));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("latin1");
      const json = (data) => res.end(JSON.stringify({ data, code: 200, error: null }));
      if (req.url === "/health") return json({ status: "ok" });
      if (req.url === "/release_task") {
        seen = { auth: req.headers.authorization, taskType: /name="task_type"\r\n\r\n(\w+)/.exec(body)?.[1], hasGuide: body.includes("RIFF") };
        polls = 0;
        return json({ task_id: "abc", status: "queued" });
      }
      if (req.url === "/query_result") {
        polls++;
        return json([{ task_id: "abc", status: polls < 2 ? 0 : 1, result: polls < 2 ? "" : JSON.stringify([{ file: "/v1/audio?path=x.mp3" }]) }]);
      }
      if (req.url.startsWith("/v1/audio")) { res.setHeader("content-type", "audio/mpeg"); return res.end(Buffer.from("ID3fake-mp3")); }
      res.statusCode = 404; res.end();
    });
  }).listen(0);
  await new Promise((r) => server.once("listening", r));
  process.env.ACESTEP_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ACESTEP_API_KEY = "secret";
});
after(() => server.close());

test("acestepAvailable detects a running ACE-Step server", async () => {
  const { acestepAvailable } = await import("../lib/acestep.js");
  assert.equal(await acestepAvailable(), true);
});

test("acestepCover sends a cover task with the guide and returns the song", { timeout: 20000 }, async () => {
  const { acestepCover } = await import("../lib/acestep.js");
  const wav = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(100)]);
  const out = await acestepCover(wav, "audio/wav", { caption: "kids song", lyrics: "[Verse 1]\nTwinkle", bpm: 96, duration: 40 });
  assert.equal(seen.taskType, "cover");
  assert.equal(seen.hasGuide, true);
  assert.equal(seen.auth, "Bearer secret");
  assert.equal(out.type, "audio/mpeg");
  assert.equal(out.audio.toString(), "ID3fake-mp3");
});
