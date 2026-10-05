// Built-in songbook of public-domain nursery rhymes (traditional lyrics and
// melodies), and helpers to turn a song into a storyboard.
import { buildNotes, totalBeats, comfortableTranspose } from "../public/js/song.js";

const L = (lyrics, melody, look = {}) => ({ lyrics, melody, ...look });

export const SONGBOOK = {
  twinkle: {
    title: "Twinkle, Twinkle, Little Star", bpm: 96, beatsPerBar: 4, key: 0, mood: "calm",
    palette: [["#0b1026", "#312e81", "#fde047"], ["#111a3b", "#4c1d95", "#fef08a"]],
    intro: "Let's sing Twinkle, Twinkle, Little Star! Sing along with me!",
    outro: "Yay! Wonderful singing! Good night, little stars!",
    lines: [
      L("Twin-kle, twin-kle, lit-tle star,", "C4 C4 G4 G4 A4 A4 G4:2", { emoji: "⭐", background: "particles" }),
      L("How I won-der what you are!", "F4 F4 E4 E4 D4 D4 C4:2", { emoji: "🤔", background: "bokeh" }),
      L("Up a-bove the world so high,", "G4 G4 F4 F4 E4 E4 D4:2", { emoji: "🌍", background: "particles" }),
      L("Like a dia-mond in the sky.", "G4 G4 F4 F4 E4 E4 D4:2", { emoji: "💎", background: "bokeh" }),
      L("Twin-kle, twin-kle, lit-tle star,", "C4 C4 G4 G4 A4 A4 G4:2", { emoji: "✨", background: "particles" }),
      L("How I won-der what you are!", "F4 F4 E4 E4 D4 D4 C4:2", { emoji: "🌙", background: "bokeh" }),
    ],
  },
  mary: {
    title: "Mary Had a Little Lamb", bpm: 112, beatsPerBar: 4, key: 0, mood: "playful",
    palette: [["#14532d", "#16a34a", "#fef9c3"], ["#1e3a8a", "#38bdf8", "#fde68a"]],
    intro: "Let's sing Mary Had a Little Lamb! Ready? Here we go!",
    outro: "Baa! Great job, everyone! See you next time!",
    lines: [
      L("Ma-ry had a lit-tle lamb,", "E4 D4 C4 D4 E4 E4 E4:2", { emoji: "👧", background: "waves" }),
      L("Lit-tle lamb, lit-tle lamb,", "D4 D4 D4:2 E4 G4 G4:2", { emoji: "🐑", background: "bokeh" }),
      L("Ma-ry had a lit-tle lamb, its fleece was white as snow.", "E4 D4 C4 D4 E4 E4 E4 E4 D4 D4 E4 D4 C4:4", { emoji: "❄️", background: "particles" }),
      L("Ev-ery-where that Ma-ry went,", "E4 D4 C4 D4 E4 E4 E4:2", { emoji: "🚶‍♀️", background: "waves" }),
      L("Ma-ry went, Ma-ry went,", "D4 D4 D4:2 E4 G4 G4:2", { emoji: "🌼", background: "bokeh" }),
      L("Ev-ery-where that Ma-ry went, the lamb was sure to go.", "E4 D4 C4 D4 E4 E4 E4 E4 D4 D4 E4 D4 C4:4", { emoji: "🐑", background: "particles" }),
    ],
  },
  london: {
    title: "London Bridge Is Falling Down", bpm: 108, beatsPerBar: 4, key: 0, mood: "upbeat",
    palette: [["#1e293b", "#b91c1c", "#fde047"], ["#0f172a", "#1d4ed8", "#fca5a5"]],
    intro: "Let's sing London Bridge! Clap along with me!",
    outro: "Hooray! You sang it all! Bye-bye!",
    lines: [
      L("Lon-don Bridge is fal-ling down,", "G4:1.5 A4:0.5 G4 F4 E4 F4 G4:2", { emoji: "🌉", background: "grid" }),
      L("Fal-ling down, fal-ling down.", "D4 E4 F4:2 E4 F4 G4:2", { emoji: "⬇️", background: "waves" }),
      L("Lon-don Bridge is fal-ling down,", "G4:1.5 A4:0.5 G4 F4 E4 F4 G4:2", { emoji: "🏰", background: "grid" }),
      L("My fair la-dy.", "D4:2 G4:2 E4 C4:3", { emoji: "👸", background: "bokeh" }),
    ],
  },
  rowboat: {
    title: "Row, Row, Row Your Boat", bpm: 100, beatsPerBar: 3, key: 0, mood: "calm",
    palette: [["#0c4a6e", "#0ea5e9", "#fef08a"], ["#064e3b", "#14b8a6", "#fde68a"]],
    intro: "Let's sing Row, Row, Row Your Boat! Row with me!",
    outro: "What a lovely boat ride! See you soon!",
    lines: [
      L("Row, row, row your boat,", "C4:1.5 C4:1.5 C4 D4:0.5 E4:1.5", { emoji: "🚣", background: "waves" }),
      L("Gent-ly down the stream.", "E4 D4:0.5 E4 F4:0.5 G4:3", { emoji: "🏞️", background: "waves" }),
      L("Mer-ri-ly, mer-ri-ly, mer-ri-ly, mer-ri-ly,", "C5:0.5 C5:0.5 C5:0.5 G4:0.5 G4:0.5 G4:0.5 E4:0.5 E4:0.5 E4:0.5 C4:0.5 C4:0.5 C4:0.5", { emoji: "😄", background: "particles" }),
      L("Life is but a dream.", "G4 F4:0.5 E4 D4:0.5 C4:3", { emoji: "💭", background: "bokeh" }),
    ],
  },
  oldmacdonald: {
    title: "Old MacDonald Had a Farm", bpm: 120, beatsPerBar: 4, key: 7, mood: "playful",
    palette: [["#713f12", "#ca8a04", "#fef9c3"], ["#14532d", "#65a30d", "#fde047"]],
    intro: "Let's sing Old MacDonald Had a Farm! Moo!",
    outro: "Moo! Great singing, farmers! See you next time!",
    lines: [
      L("Old Mac-Don-ald had a farm,", "G4 G4 G4 D4 E4 E4 D4:2", { emoji: "👨‍🌾", background: "bokeh" }),
      L("E-I-E-I-O!", "B4 B4 A4 A4 G4:3", { emoji: "🎶", background: "particles" }),
      L("And on his farm he had a cow,", "D4 G4 G4 G4 D4 E4 E4 D4:2", { emoji: "🐄", background: "waves" }),
      L("E-I-E-I-O!", "B4 B4 A4 A4 G4:4", { emoji: "🎶", background: "particles" }),
      L("Old Mac-Don-ald had a farm,", "G4 G4 G4 D4 E4 E4 D4:2", { emoji: "🚜", background: "bokeh" }),
      L("E-I-E-I-O!", "B4 B4 A4 A4 G4:4", { emoji: "🎉", background: "particles" }),
    ],
  },
};

export const songList = () => Object.entries(SONGBOOK).map(([id, s]) => ({ id, title: s.title }));

const TRANSITIONS = ["fade", "slide", "zoom", "wipe"];

/** Turn a songbook entry into a raw storyboard (normalized later). */
export function songStoryboard(id, { aspectRatio = "16:9", audience = "little-kids" } = {}) {
  const song = SONGBOOK[id];
  if (!song) throw new Error(`Unknown song "${id}"`);
  const notes = song.lines.flatMap((l) => buildNotes(l.lyrics, l.melody).notes);
  const scenes = [
    { layout: "title", heading: song.title, subtext: "Sing along!", narration: song.intro, speaker: "Narrator", emoji: "🎵", background: "bokeh", textAnimation: "pop", duration: 4 },
    ...song.lines.map((l, i) => ({
      layout: "lyrics", heading: l.lyrics.replace(/-/g, ""), lyrics: l.lyrics, melody: l.melody, narration: l.lyrics.replace(/-/g, ""),
      speaker: "Singer", emoji: l.emoji, background: l.background, textAnimation: "fade", transition: TRANSITIONS[i % 4],
      colors: song.palette[i % song.palette.length].slice(0, 2), accent: song.palette[i % song.palette.length][2],
    })),
    { layout: "closing", heading: "Great singing!", subtext: song.title, narration: song.outro, speaker: "Narrator", emoji: "👏", background: "gradient", textAnimation: "pop", duration: 4 },
  ];
  scenes[0].colors = song.palette[0].slice(0, 2); scenes[0].accent = song.palette[0][2];
  scenes.at(-1).colors = song.palette[0].slice(0, 2); scenes.at(-1).accent = song.palette[0][2];
  return {
    title: song.title, mood: song.mood, aspectRatio, audience, font: "rounded",
    song: { id, bpm: song.bpm, beatsPerBar: song.beatsPerBar, key: song.key, transpose: comfortableTranspose(notes), engine: "builtin" },
    cast: [
      { name: "Narrator", description: "Friendly host who introduces the song", voiceStyle: "narrator-female" },
      { name: "Singer", description: "Sweet, clear sing-along voice", voiceStyle: "narrator-female" },
    ],
    scenes,
  };
}

/** Sung scene length in seconds (notes at the song tempo). */
export const sungDuration = (notes, bpm) => Math.round(totalBeats(notes) * (60 / bpm) * 1000) / 1000;
