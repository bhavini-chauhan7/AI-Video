// Song helpers shared by the server and the browser.
//
// A sung scene has `lyrics` with syllables split by hyphens ("Twin-kle twin-kle
// lit-tle star") and a `melody` of note tokens ("C4 C4 G4 G4 A4 A4 G4:2").
// A token is NOTE[:beats] (beats default 1) or R[:beats] for a rest. Each
// non-rest note takes the next syllable.

const NOTE = /^([A-Ga-g])([#b]?)(-?\d)(?::(\d+(?:\.\d+)?))?$/;
const REST = /^[Rr](?::(\d+(?:\.\d+)?))?$/;
const PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

export const midiName = (m) => `${NAMES[m % 12]}${Math.floor(m / 12) - 1}`;

/**
 * Lyrics as shown on screen: syllable hyphens removed ("twin-kle" -> "twinkle"),
 * but kept between single letters ("E-I-E-I-O" stays "E-I-E-I-O").
 */
export function displayLyrics(lyrics) {
  return String(lyrics || "").split(/(\s+)/).map((w) => {
    const parts = w.split(/-(?=.)/);
    return parts.length > 1 && parts.every((p) => p.replace(/[^\p{L}\p{N}]/gu, "").length <= 1) ? parts.join("-") : parts.join("");
  }).join("");
}

/** Split lyrics into syllables: [{ text, word }]. Punctuation stays on the syllable for display. */
export function syllables(lyrics) {
  const out = [];
  String(lyrics || "").trim().split(/\s+/).filter(Boolean).forEach((word, w) => {
    word.split(/-(?=.)/).forEach((text) => out.push({ text, word: w }));
  });
  return out;
}

/** Parse a melody string into [{ pitch (MIDI, 0 = rest), beats }]; throws on bad tokens. */
export function parseMelody(melody) {
  return String(melody || "").trim().split(/\s+/).filter(Boolean).map((tok) => {
    let m = tok.match(REST);
    if (m) return { pitch: 0, beats: Number(m[1] || 1) };
    m = tok.match(NOTE);
    if (!m) throw new Error(`Unknown note "${tok}" (use e.g. C4, F#4:2, R:1)`);
    const pc = PC[m[1].toLowerCase()] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
    return { pitch: (Number(m[3]) + 1) * 12 + pc, beats: Number(m[4] || 1) };
  });
}

/**
 * Combine lyrics + melody into notes: [{ text, word, pitch, beats }].
 * Returns { notes, error } where error explains a syllable/note mismatch.
 * Extra notes hold the previous syllable (melisma); extra syllables are dropped.
 */
export function buildNotes(lyrics, melody) {
  let parsed;
  try { parsed = parseMelody(melody); } catch (err) { return { notes: [], error: err.message }; }
  const syl = syllables(lyrics);
  const sung = parsed.filter((n) => n.pitch).length;
  let si = 0, last = null;
  const notes = parsed.map((n) => {
    if (!n.pitch) return { text: "", word: -1, pitch: 0, beats: n.beats };
    const s = syl[si++] || (last && { ...last, hold: true });
    last = s;
    return s ? { text: s.text, word: s.word, pitch: n.pitch, beats: n.beats, ...(s.hold ? { hold: true } : {}) } : { text: "", word: -1, pitch: 0, beats: n.beats };
  });
  const error = sung === syl.length ? "" : `The lyrics have ${syl.length} syllables but the melody has ${sung} notes.`;
  return { notes, error };
}

export const totalBeats = (notes) => notes.reduce((t, n) => t + n.beats, 0);

/** Semitones to move a melody so it sits comfortably for a singer (center near G4). */
export function comfortableTranspose(allNotes, center = 66) {
  const ps = allNotes.filter((n) => n.pitch).map((n) => n.pitch);
  if (!ps.length) return 0;
  const mid = (Math.min(...ps) + Math.max(...ps)) / 2;
  return Math.max(-6, Math.min(6, Math.round(center - mid)));
}

// Diatonic chords relative to the key's tonic, with a small preference prior.
const CHORDS = [
  { name: "I", tones: [0, 4, 7], prior: 0.35 },
  { name: "IV", tones: [5, 9, 0], prior: 0.2 },
  { name: "V", tones: [7, 11, 2], prior: 0.25 },
  { name: "vi", tones: [9, 0, 4], prior: 0.05 },
  { name: "ii", tones: [2, 5, 9], prior: 0 },
];

/**
 * Pick a chord for each harmony slot (half bar in 4/4, whole bar in 3/4)
 * from the melody notes that sound in it. `events` are [{ at (beats), pitch, beats }].
 * Returns [{ at, beats, root (pitch class), tones: [pcs] }].
 */
export function harmonize(events, { key = 0, beatsPerBar = 4, totalBeats: total }) {
  const slot = beatsPerBar % 2 === 0 ? beatsPerBar / 2 : beatsPerBar;
  const out = [];
  let prev = CHORDS[0];
  for (let at = 0; at < total - 1e-6; at += slot) {
    const inSlot = events.filter((e) => e.pitch && e.at < at + slot && e.at + e.beats > at);
    let best = CHORDS[0], bestScore = -Infinity;
    for (const c of CHORDS) {
      let score = c.prior + (c === prev ? 0.1 : 0);
      for (const e of inSlot) {
        const pc = ((e.pitch - key) % 12 + 12) % 12;
        const overlap = Math.min(at + slot, e.at + e.beats) - Math.max(at, e.at);
        const onBeat = Math.abs(e.at - at) < 1e-6 ? 0.6 : 0;
        if (c.tones.includes(pc)) score += overlap + onBeat;
        else score -= overlap * 0.6;
      }
      // a song's final chord is the tonic
      if (at + slot >= total - 1e-6 && c.name === "I") score += 2;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    prev = best;
    out.push({ at, beats: Math.min(slot, total - at), root: (best.tones[0] + key) % 12, tones: best.tones.map((t) => (t + key) % 12) });
  }
  return out;
}
