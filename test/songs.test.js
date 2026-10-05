import test from "node:test";
import assert from "node:assert/strict";
import { parseMelody, buildNotes, syllables, harmonize, comfortableTranspose, totalBeats } from "../public/js/song.js";
import { SONGBOOK, songStoryboard } from "../lib/songs.js";
import { normalizeStoryboard } from "../lib/storyboard.js";

test("parseMelody reads notes, accidentals, durations and rests", () => {
  assert.deepEqual(parseMelody("C4 F#4:2 Bb3:0.5 R:1"), [
    { pitch: 60, beats: 1 }, { pitch: 66, beats: 2 }, { pitch: 58, beats: 0.5 }, { pitch: 0, beats: 1 },
  ]);
  assert.throws(() => parseMelody("H4"), /Unknown note/);
});

test("syllables split on hyphens and keep word grouping", () => {
  assert.deepEqual(syllables("Twin-kle, lit-tle star").map((s) => [s.text, s.word]), [["Twin", 0], ["kle,", 0], ["lit", 1], ["tle", 1], ["star", 2]]);
});

test("buildNotes pairs syllables with notes and reports mismatches", () => {
  const ok = buildNotes("Twin-kle star", "C4 C4 G4:2");
  assert.equal(ok.error, "");
  assert.deepEqual(ok.notes.map((n) => n.text), ["Twin", "kle", "star"]);
  const extra = buildNotes("Twin-kle star", "C4 C4 G4 G4");
  assert.match(extra.error, /3 syllables but the melody has 4 notes/);
  assert.equal(extra.notes[3].hold, true); // extra note holds the last syllable
});

test("every songbook line has one note per syllable and whole-bar songs", () => {
  for (const [id, song] of Object.entries(SONGBOOK)) {
    let beats = 0;
    for (const line of song.lines) {
      const { notes, error } = buildNotes(line.lyrics, line.melody);
      assert.equal(error, "", `${id}: ${line.lyrics}`);
      beats += totalBeats(notes);
    }
    assert.equal(beats % song.beatsPerBar, 0, `${id} has ${beats} beats`);
  }
});

test("harmonize gives Twinkle Twinkle its classic chords", () => {
  const events = [];
  let at = 0;
  for (const n of buildNotes("Twin-kle twin-kle lit-tle star how I won-der what you are", "C4 C4 G4 G4 A4 A4 G4:2 F4 F4 E4 E4 D4 D4 C4:2").notes) {
    events.push({ at, pitch: n.pitch, beats: n.beats }); at += n.beats;
  }
  const roots = harmonize(events, { key: 0, beatsPerBar: 4, totalBeats: 16 }).map((c) => c.root);
  assert.deepEqual(roots, [0, 0, 5, 0, 5, 0, 7, 0]); // C C F C F C G C
});

test("comfortableTranspose centers the melody for a singer", () => {
  assert.equal(comfortableTranspose([{ pitch: 60 }, { pitch: 69 }]), 2);
  assert.equal(comfortableTranspose([]), 0);
});

test("songStoryboard builds a spoken intro, sung lines on the beat, and an outro", () => {
  const sb = normalizeStoryboard(songStoryboard("twinkle"));
  assert.equal(sb.song.bpm, 96);
  assert.equal(sb.scenes[0].layout, "title");
  assert.equal(sb.scenes.at(-1).layout, "closing");
  const sung = sb.scenes.filter((s) => s.layout === "lyrics");
  assert.equal(sung.length, 6);
  assert.equal(sung[0].duration, 5); // 8 beats at 96 bpm
  const bar = (60 / 96) * 4;
  assert.ok(Math.abs(sb.scenes[0].duration / bar - Math.round(sb.scenes[0].duration / bar)) < 1e-6, "intro is whole bars");
  assert.deepEqual(sb.cast.map((c) => c.name), ["Mr. Moon", "Lily"]);
  assert.ok(sb.scenes.every((s) => s.visual), "every scene has a 3D description");
});

test("Old MacDonald has three animal verses, each sung by its own character", async () => {
  const { displayLyrics } = await import("../public/js/song.js");
  const sb = normalizeStoryboard(songStoryboard("oldmacdonald"));
  const singers = new Set(sb.scenes.filter((s) => s.layout === "lyrics").map((s) => s.speaker));
  assert.deepEqual([...singers].sort(), ["Benny", "Daisy the Cow", "Old MacDonald", "Penny the Pig", "Quacky the Duck"]);
  for (const sound of ["moo", "oink", "quack"]) assert.ok(sb.scenes.some((s) => s.narration.includes(`${sound} ${sound} here`)), sound);
  assert.ok(sb.scenes.some((s) => s.heading === "E-I-E-I-O!"));
  assert.equal(displayLyrics("Twin-kle, ev-ery-where E-I-E-I-O!"), "Twinkle, everywhere E-I-E-I-O!");
});
