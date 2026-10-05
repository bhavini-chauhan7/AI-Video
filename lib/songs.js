// Built-in songbook of public-domain nursery rhymes (traditional lyrics and
// melodies), and helpers to turn a song into a storyboard.
import { buildNotes, totalBeats, comfortableTranspose } from "../public/js/song.js";

const L = (lyrics, melody, look = {}) => ({ lyrics, melody, ...look });

export const SONGBOOK = {
  twinkle: {
    title: "Twinkle, Twinkle, Little Star", bpm: 96, beatsPerBar: 4, key: 0, mood: "calm",
    palette: [["#0b1026", "#312e81", "#fde047"], ["#111a3b", "#4c1d95", "#fef08a"]],
    names: { narrator: "Mr. Moon", singer: "Lily" },
    looks: { narrator: "a friendly smiling crescent moon with rosy cheeks and sleepy eyes", singer: "a sweet little girl with curly brown hair, big brown eyes and yellow pajamas covered in little stars", introVisual: "Lily waves hello from her cozy bedroom window, the smiling moon peeking in from the night sky", outroVisual: "Lily and the moon wave goodbye as Lily snuggles into bed under a starry blanket" },
    intro: "Let's sing Twinkle, Twinkle, Little Star! Sing along with me!",
    outro: "Yay! Wonderful singing! Good night, little stars!",
    lines: [
      L("Twin-kle, twin-kle, lit-tle star,", "C4 C4 G4 G4 A4 A4 G4:2", { visual: "Lily looks up from her window at a big twinkling star in the night sky, pointing and smiling", emoji: "⭐", background: "particles" }),
      L("How I won-der what you are!", "F4 F4 E4 E4 D4 D4 C4:2", { visual: "Lily rests her chin on her hands, wondering, as the little star twinkles and winks at her", emoji: "🤔", background: "bokeh" }),
      L("Up a-bove the world so high,", "G4 G4 F4 F4 E4 E4 D4:2", { visual: "Lily floats above her little town at night, holding the star’s hand, houses glowing below", emoji: "🌍", background: "particles" }),
      L("Like a dia-mond in the sky.", "G4 G4 F4 F4 E4 E4 D4:2", { visual: "Lily and the star sparkle like a diamond high in the dark blue sky full of stars", emoji: "💎", background: "bokeh" }),
      L("Twin-kle, twin-kle, lit-tle star,", "C4 C4 G4 G4 A4 A4 G4:2", { visual: "Lily twirls in her pajamas on a cloud while tiny stars twinkle all around her", emoji: "✨", background: "particles" }),
      L("How I won-der what you are!", "F4 F4 E4 E4 D4 D4 C4:2", { visual: "Lily yawns and smiles at the star from her bed as it glows softly through the window", emoji: "🌙", background: "bokeh" }),
    ],
  },
  mary: {
    title: "Mary Had a Little Lamb", bpm: 112, beatsPerBar: 4, key: 0, mood: "playful",
    palette: [["#14532d", "#16a34a", "#fef9c3"], ["#1e3a8a", "#38bdf8", "#fde68a"]],
    names: { narrator: "Grandma Rose", singer: "Mary" },
    looks: { narrator: "a cheerful farmer grandma with round glasses, a straw sunhat and a flowery apron", singer: "a little girl with red pigtails, freckles and a blue dress, with her fluffy white lamb", introVisual: "Grandma waves hello in front of a red barn on a sunny farm", outroVisual: "Mary and her lamb wave goodbye at the farm gate as the sun sets" },
    intro: "Let's sing Mary Had a Little Lamb! Ready? Here we go!",
    outro: "Baa! Great job, everyone! See you next time!",
    lines: [
      L("Ma-ry had a lit-tle lamb,", "E4 D4 C4 D4 E4 E4 E4:2", { visual: "Mary hugs her fluffy white lamb in a sunny green meadow full of flowers", emoji: "👧", background: "waves" }),
      L("Lit-tle lamb, lit-tle lamb,", "D4 D4 D4:2 E4 G4 G4:2", { visual: "The little lamb hops happily around Mary in the grass", emoji: "🐑", background: "bokeh" }),
      L("Ma-ry had a lit-tle lamb, its fleece was white as snow.", "E4 D4 C4 D4 E4 E4 E4 E4 D4 D4 E4 D4 C4:4", { visual: "Mary and her snow-white lamb walk side by side, the lamb’s fleece sparkling white", emoji: "❄️", background: "particles" }),
      L("Ev-ery-where that Ma-ry went,", "E4 D4 C4 D4 E4 E4 E4:2", { visual: "Mary skips down a country path and the lamb follows right behind her", emoji: "🚶‍♀️", background: "waves" }),
      L("Ma-ry went, Ma-ry went,", "D4 D4 D4:2 E4 G4 G4:2", { visual: "Mary and the lamb walk past the pond, the lamb trotting after her", emoji: "🌼", background: "bokeh" }),
      L("Ev-ery-where that Ma-ry went, the lamb was sure to go.", "E4 D4 C4 D4 E4 E4 E4 E4 D4 D4 E4 D4 C4:4", { visual: "The lamb follows Mary into her little schoolhouse while the children laugh", emoji: "🐑", background: "particles" }),
    ],
  },
  london: {
    title: "London Bridge Is Falling Down", bpm: 108, beatsPerBar: 4, key: 0, mood: "upbeat",
    palette: [["#1e293b", "#b91c1c", "#fde047"], ["#0f172a", "#1d4ed8", "#fca5a5"]],
    names: { narrator: "Teddy Guard", singer: "Leo" },
    looks: { narrator: "a jolly teddy bear guard in a red uniform and tall black hat", singer: "a little boy with a red raincoat, yellow rain boots and a big smile", introVisual: "The teddy bear guard salutes in front of a toy-like London with a big clock tower", outroVisual: "Leo and the teddy bear guard wave goodbye on the bridge at sunset" },
    intro: "Let's sing London Bridge! Clap along with me!",
    outro: "Hooray! You sang it all! Bye-bye!",
    lines: [
      L("Lon-don Bridge is fal-ling down,", "G4:1.5 A4:0.5 G4 F4 E4 F4 G4:2", { visual: "Leo stands on a colorful toy-like London bridge over a sparkling river", emoji: "🌉", background: "grid" }),
      L("Fal-ling down, fal-ling down.", "D4 E4 F4:2 E4 F4 G4:2", { visual: "The toy bridge wobbles and Leo pretends to fall, laughing", emoji: "⬇️", background: "waves" }),
      L("Lon-don Bridge is fal-ling down,", "G4:1.5 A4:0.5 G4 F4 E4 F4 G4:2", { visual: "Leo and his friends hold hands and dance in a circle on the bridge", emoji: "🏰", background: "grid" }),
      L("My fair la-dy.", "D4:2 G4:2 E4 C4:3", { visual: "A little princess in a pink dress curtsies on the bridge and Leo bows", emoji: "👸", background: "bokeh" }),
    ],
  },
  rowboat: {
    title: "Row, Row, Row Your Boat", bpm: 100, beatsPerBar: 3, key: 0, mood: "calm",
    palette: [["#0c4a6e", "#0ea5e9", "#fef08a"], ["#064e3b", "#14b8a6", "#fde68a"]],
    names: { narrator: "Freddy Frog", singer: "Maya" },
    looks: { narrator: "a smiling green frog sitting on a lily pad", singer: "a little girl in a yellow life jacket with a blue sun hat", introVisual: "The frog waves hello from a lily pad on a calm sunny river", outroVisual: "Maya waves goodbye from her boat as the frog jumps into the water" },
    intro: "Let's sing Row, Row, Row Your Boat! Row with me!",
    outro: "What a lovely boat ride! See you soon!",
    lines: [
      L("Row, row, row your boat,", "C4:1.5 C4:1.5 C4 D4:0.5 E4:1.5", { visual: "Maya rows a little red rowboat down a calm sparkling river", emoji: "🚣", background: "waves" }),
      L("Gent-ly down the stream.", "E4 D4:0.5 E4 F4:0.5 G4:3", { visual: "Maya’s boat drifts gently downstream past flowers and ducks", emoji: "🏞️", background: "waves" }),
      L("Mer-ri-ly, mer-ri-ly, mer-ri-ly, mer-ri-ly,", "C5:0.5 C5:0.5 C5:0.5 G4:0.5 G4:0.5 G4:0.5 E4:0.5 E4:0.5 E4:0.5 C4:0.5 C4:0.5 C4:0.5", { visual: "Maya laughs and splashes as the boat bobs merrily along with dancing fish", emoji: "😄", background: "particles" }),
      L("Life is but a dream.", "G4 F4:0.5 E4 D4:0.5 C4:3", { visual: "Maya lies back in the boat, dreaming, with fluffy clouds above", emoji: "💭", background: "bokeh" }),
    ],
  },
  oldmacdonald: {
    title: "Old MacDonald Had a Farm", bpm: 120, beatsPerBar: 4, key: 7, mood: "playful",
    palette: [["#713f12", "#ca8a04", "#fef9c3"], ["#14532d", "#65a30d", "#fde047"]],
    names: { narrator: "Daisy the Cow", singer: "Old MacDonald" },
    looks: { narrator: "a happy brown and white cow with a golden bell", singer: "a friendly farmer with a fluffy white beard, a straw hat and blue overalls", introVisual: "The cow moos hello in front of a bright red barn", outroVisual: "Old MacDonald and all the animals wave goodbye in front of the barn" },
    intro: "Let's sing Old MacDonald Had a Farm! Moo!",
    outro: "Moo! Great singing, farmers! See you next time!",
    lines: [
      L("Old Mac-Don-ald had a farm,", "G4 G4 G4 D4 E4 E4 D4:2", { visual: "Old MacDonald waves from his tractor on a sunny farm with a red barn", emoji: "👨‍🌾", background: "bokeh" }),
      L("E-I-E-I-O!", "B4 B4 A4 A4 G4:3", { visual: "Old MacDonald sings E-I-E-I-O and dances with a chicken", emoji: "🎶", background: "particles" }),
      L("And on his farm he had a cow,", "D4 G4 G4 G4 D4 E4 E4 D4:2", { visual: "Old MacDonald pats a happy cow in the green field", emoji: "🐄", background: "waves" }),
      L("E-I-E-I-O!", "B4 B4 A4 A4 G4:4", { visual: "The cow and Old MacDonald sing E-I-E-I-O together and dance", emoji: "🎶", background: "particles" }),
      L("Old Mac-Don-ald had a farm,", "G4 G4 G4 D4 E4 E4 D4:2", { visual: "Old MacDonald walks through the farm while pigs and sheep follow him", emoji: "🚜", background: "bokeh" }),
      L("E-I-E-I-O!", "B4 B4 A4 A4 G4:4", { visual: "All the farm animals and Old MacDonald sing E-I-E-I-O in a big finale", emoji: "🎉", background: "particles" }),
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
    { layout: "title", heading: song.title, subtext: "Sing along!", narration: song.intro, speaker: song.names.narrator, emoji: "🎵", background: "bokeh", textAnimation: "pop", duration: 4, visual: song.looks.introVisual },
    ...song.lines.map((l, i) => ({
      layout: "lyrics", heading: l.lyrics.replace(/-/g, ""), lyrics: l.lyrics, melody: l.melody, narration: l.lyrics.replace(/-/g, ""),
      speaker: song.names.singer, emoji: l.emoji, visual: l.visual, background: l.background, textAnimation: "fade", transition: TRANSITIONS[i % 4],
      colors: song.palette[i % song.palette.length].slice(0, 2), accent: song.palette[i % song.palette.length][2],
    })),
    { layout: "closing", heading: "Great singing!", subtext: song.title, narration: song.outro, speaker: song.names.narrator, emoji: "👏", background: "gradient", textAnimation: "pop", duration: 4, visual: song.looks.outroVisual },
  ];
  scenes[0].colors = song.palette[0].slice(0, 2); scenes[0].accent = song.palette[0][2];
  scenes.at(-1).colors = song.palette[0].slice(0, 2); scenes.at(-1).accent = song.palette[0][2];
  return {
    title: song.title, mood: song.mood, aspectRatio, audience, font: "rounded",
    song: { id, bpm: song.bpm, beatsPerBar: song.beatsPerBar, key: song.key, transpose: comfortableTranspose(notes), engine: "builtin" },
    cast: [
      { name: song.names.narrator, description: "Friendly host who introduces the song", voiceStyle: "narrator-female", appearance: song.looks.narrator },
      { name: song.names.singer, description: "Sweet, clear sing-along voice", voiceStyle: "narrator-female", appearance: song.looks.singer },
    ],
    scenes,
  };
}

/** Sung scene length in seconds (notes at the song tempo). */
export const sungDuration = (notes, bpm) => Math.round(totalBeats(notes) * (60 / bpm) * 1000) / 1000;
