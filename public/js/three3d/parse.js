// Plain-language descriptions -> 3D specs.
//   lookToSpec("a little girl with curly brown hair and yellow star pajamas")
//   sceneToPlan("Lily waves at a twinkling star from her bedroom window")
import { rng, SKIN_TONES, ANIMALS } from "./characters.js";

export const COLORS = {
  red: "#e63946", crimson: "#c1121f", pink: "#ff7eb6", rose: "#ff5d8f", magenta: "#d0368a", purple: "#8e5bd8", violet: "#8e5bd8",
  lavender: "#c3a6ff", lilac: "#c8a2c8", blue: "#3a86ff", navy: "#1d3557", "sky blue": "#7cc6fe", "light blue": "#9ad1ff", teal: "#2a9d8f",
  turquoise: "#40c9c0", cyan: "#4cc9f0", green: "#52b788", "dark green": "#2d6a4f", lime: "#a7c957", mint: "#98e2c6", olive: "#7a8450",
  yellow: "#ffd23f", gold: "#ffcf33", golden: "#ffcf33", orange: "#ff8c42", peach: "#ffb38a", brown: "#8b5a2b", "light brown": "#b5835a",
  "dark brown": "#5a3a1e", chestnut: "#7b3f1d", tan: "#d2b48c", beige: "#e9dcc3", cream: "#fff3d6", white: "#f8f9fa", "snow-white": "#ffffff",
  black: "#2b2b2b", gray: "#9aa5b1", grey: "#9aa5b1", silver: "#c0c7d1", blonde: "#f1d27a", blond: "#f1d27a", ginger: "#d9692a",
  straw: "#e9c46a", rainbow: "#ff7eb6", fluffy: null,
};

const COLOR_WORDS = Object.keys(COLORS).sort((a, b) => b.length - a.length);
const has = (text, ...words) => words.some((w) => new RegExp(`\\b${w}`, "i").test(text));

/** The colour named closest before `item` (within a few words), e.g. "curly brown hair" -> brown. */
function colorOf(text, items) {
  for (const item of [].concat(items)) {
    const re = new RegExp(`((?:[\\w-]+\\s+){0,4})${item}`, "i");
    const m = text.match(re);
    if (!m) continue;
    const before = m[1].toLowerCase();
    let best = null, pos = -1;
    for (const c of COLOR_WORDS) {
      const i = before.lastIndexOf(c);
      if (i > pos && COLORS[c]) { pos = i; best = COLORS[c]; }
    }
    if (best) return best;
  }
  return null;
}

const KIND_WORDS = [
  ["moon", ["moon"]], ["star", ["star\\b(?!s? on| pattern| print| pajama)", "starfish"]], ["sun", ["sun\\b(?! ?hat)", "sunshine"]], ["cloud", ["cloud"]],
  ["robot", ["robot", "android"]], ["tooth", ["tooth", "teeth"]], ["monster", ["monster", "alien", "dragon", "dino", "dinosaur"]],
  ["cow", ["cow", "calf"]], ["sheep", ["sheep", "lamb"]], ["pig", ["pig", "piglet"]], ["frog", ["frog", "toad"]], ["duck", ["duck", "chick", "chicken", "hen", "bird"]],
  ["penguin", ["penguin"]], ["owl", ["owl"]], ["cat", ["cat", "kitten", "kitty"]], ["dog", ["dog", "puppy", "pup"]], ["bunny", ["bunny", "rabbit"]],
  ["bear", ["bear", "teddy", "panda"]], ["lion", ["lion"]], ["elephant", ["elephant"]], ["monkey", ["monkey"]], ["fox", ["fox"]], ["mouse", ["mouse", "mice"]],
  ["grandma", ["grandma", "granny", "grandmother", "old lady"]], ["grandpa", ["grandpa", "grandfather", "old man", "santa", "farmer with a (?:\\w+ )*beard", "old macdonald"]],
  ["baby", ["baby", "toddler"]], ["girl", ["girl", "princess", "daughter", "sister"]], ["boy", ["boy", "prince", "son\\b", "brother"]],
  ["woman", ["woman", "mom", "mother", "mommy", "lady", "queen", "aunt"]], ["man", ["man\\b", "dad", "father", "daddy", "king", "uncle"]],
];
// jobs only decide the character when nothing more specific is said ("a farmer grandma" is a grandma)
const WEAK_KINDS = [["woman", ["teacher", "nurse"]], ["man", ["farmer", "guard", "host", "pilot", "chef", "doctor"]]];

function kindOf(text, list = KIND_WORDS) {
  // earliest mentioned kind wins ("a teddy bear guard" -> bear, "a girl with a lamb" -> girl)
  let best = null, at = Infinity;
  for (const [kind, words] of list) {
    for (const w of words) {
      const m = new RegExp(`\\b${w}`, "i").exec(text);
      if (m && m.index < at) { at = m.index; best = kind; }
    }
  }
  return best || (list === KIND_WORDS ? kindOf(text, WEAK_KINDS) : null);
}

/**
 * Turn an appearance description into a character spec. `hint` (voice style)
 * picks a sensible character when the description doesn't say.
 */
export function lookToSpec(appearance = "", { name = "", voiceStyle = "" } = {}) {
  const text = `${appearance}`.toLowerCase();
  const r = rng(name + appearance);
  const styleKind = { robot: "robot", monster: "monster", chipmunk: "mouse", santa: "grandpa", grandparent: "grandpa", "little-kid": "girl", "little-boy": "boy",
    cartoon: "monster", giant: "man", "narrator-male": "man", "narrator-female": "woman", storyteller: "grandpa", teacher: "woman" }[voiceStyle];
  const kind = kindOf(text) || kindOf(name.toLowerCase()) || styleKind || "girl";
  const spec = { kind, name };

  // hair
  spec.hair = has(text, "tuft", "single curl", "little curl") ? "tuft" : has(text, "curly", "curls", "afro") ? "curly" : has(text, "pigtail") ? "pigtails" : has(text, "braid") ? "braids" : has(text, "ponytail") ? "ponytail"
    : has(text, "bun\\b") ? "bun" : has(text, "spiky") ? "spiky" : has(text, "messy") ? "messy" : has(text, "long (?:[\\w-]+ )?hair") ? "long" : has(text, "bald") ? "bald"
      : kind === "grandpa" ? "grandpa" : kind === "girl" ? ["pigtails", "ponytail", "curly", "long"][Math.floor(r() * 4)] : kind === "woman" || kind === "grandma" ? ["bun", "long", "curly"][Math.floor(r() * 3)] : "short";
  spec.hairColor = colorOf(text, ["hair", "curls", "pigtails", "ponytail", "braids", "bun"]) || (kind === "grandpa" || kind === "grandma" ? "#e9ecef" : ["#5a3a1e", "#2b2b2b", "#8b5a2b", "#f1d27a", "#d9692a"][Math.floor(r() * 5)]);
  // skin: varied by default, or as described
  spec.skin = has(text, "dark skin", "brown skin", "black skin") ? SKIN_TONES[5 - Math.floor(r() * 2)] : has(text, "light skin", "pale", "fair skin") ? SKIN_TONES[0]
    : has(text, "tan skin", "olive skin") ? SKIN_TONES[3] : SKIN_TONES[Math.floor(r() * SKIN_TONES.length)];
  spec.eyeColor = colorOf(text, ["eyes"]) || "#3b2416";

  // clothes
  const outfits = [["pajamas", ["pajama", "pyjama", "nightgown", "onesie"]], ["dress", ["dress", "gown", "skirt"]], ["overalls", ["overall", "dungaree"]],
    ["lifejacket", ["life jacket", "lifejacket", "life vest"]], ["raincoat", ["raincoat", "rain coat"]], ["uniform", ["uniform"]],
    ["hoodie", ["hoodie", "sweater", "jumper", "cardigan"]], ["jacket", ["jacket", "coat"]], ["shirt", ["t-shirt", "shirt", "top\\b", "vest"]]];
  for (const [type, words] of outfits) {
    if (words.some((w) => has(text, w))) { spec.outfitType = type; spec.outfitColor = colorOf(text, words); break; }
  }
  const palette = ["#ff7eb6", "#3a86ff", "#ffd23f", "#52b788", "#ff8c42", "#8e5bd8", "#4cc9f0", "#e63946"];
  spec.outfitColor ||= colorOf(text, ["clothes", "outfit", "suit"]) || palette[Math.floor(r() * palette.length)];
  spec.pattern = has(text, "stars", "starry", "star-print", "star print", "covered in (?:little )?stars") ? "stars" : has(text, "polka", "dots", "spotted") ? "dots"
    : has(text, "stripe") ? "stripes" : has(text, "flower", "floral") ? "flowers" : null;
  spec.accent = colorOf(text, ["bow", "ribbon", "band", "scarf", "bell"]) || "#ffffff";
  spec.shirtColor = colorOf(text, ["shirt", "t-shirt"]) || "#f8f9fa";
  spec.pantsColor = colorOf(text, ["pants", "trousers", "jeans", "shorts"]) || "#3d5a80";
  spec.shoeColor = colorOf(text, ["boots", "shoes", "sneakers", "rain boots"]) || "#7a4a2a";
  if (spec.outfitType === "pajamas") spec.shoeColor = colorOf(text, ["slippers"]) || spec.outfitColor;
  if (kind === "boy" && !spec.outfitType) spec.outfitType = "shirt";

  // hats and accessories
  spec.hat = has(text, "straw hat") ? "straw" : has(text, "sun ?hat") ? "sunhat" : has(text, "\\bcap\\b", "baseball") ? "cap" : has(text, "crown", "princess", "king", "queen") ? "crown"
    : has(text, "tall (?:\\w+ )?hat", "top hat", "bearskin", "guard") ? "tall" : has(text, "santa", "christmas hat") ? "santa" : has(text, "headphone") ? "headphones"
      : has(text, "\\bhat\\b") ? "cap" : null;
  spec.hatColor = colorOf(text, ["hat", "cap"]) || (spec.hat === "straw" || spec.hat === "sunhat" ? "#e9c46a" : spec.hat === "tall" ? "#1f1f1f" : spec.outfitColor);
  spec.glasses = has(text, "glasses", "spectacles");
  spec.beard = has(text, "beard") || /santa/i.test(text);
  spec.beardColor = colorOf(text, ["beard"]) || (spec.beard ? "#f1f3f5" : null);
  spec.bow = has(text, "\\bbow\\b", "ribbon");
  spec.apron = has(text, "apron");
  spec.apronColor = colorOf(text, ["apron"]);
  spec.bell = has(text, "bell") || kind === "cow";

  // animals / objects / robots: the main colour of the creature
  if (ANIMALS[kind] || ["moon", "star", "sun", "cloud", "robot", "monster"].includes(kind)) {
    spec.mainColor = colorOf(text, ["fur", "bear", "cat", "dog", "bunny", "rabbit", "frog", "duck", "pig", "robot", "monster", "cloud", "moon", "star", "sun", "dragon", "alien", "body"]);
    if (kind === "cow") spec.mainColor = "#ffffff";
    if (!spec.outfitType || !has(text, "wearing", "in a", "in an", "uniform", "jacket", "scarf", "dress")) delete spec.outfitType;
  }
  return spec;
}

// ---------------------------------------------------------------- scenes
const SETS = [
  ["bedroom", ["bedroom", "\\bbed\\b", "bedtime", "pillow", "blanket", "nursery", "snuggle"]],
  ["space", ["space", "planet", "rocket", "astronaut", "galaxy"]],
  ["night", ["night sky", "sky\\b", "\\bstars\\b", "twinkl", "above the world", "cloud", "floats", "flying", "\\bmoon\\b"]],
  ["river", ["river", "boat", "\\brow", "stream", "lake", "pond", "lily pad", "fish", "swim"]],
  ["beach", ["beach", "\\bsea\\b", "ocean", "sand", "seashell", "ocean waves"]],
  ["town", ["bridge", "london", "town", "city", "street", "clock tower", "castle"]],
  ["classroom", ["school", "classroom", "teacher", "lesson", "desk", "blackboard"]],
  ["forest", ["forest", "woods", "jungle", "trees", "camp"]],
  ["farm", ["farm", "barn", "tractor", "meadow", "field", "garden", "flower", "grass", "park", "pig", "cow", "sheep", "lamb", "chicken"]],
];

const ACTIONS = [
  ["sleep", ["sleep", "snuggle", "yawn", "dream", "bedtime", "lies back", "nap"]],
  ["row", ["\\brow", "paddl"]],
  ["dance", ["danc", "twirl", "spin", "sway", "boogie", "wiggle"]],
  ["jump", ["jump", "hop", "bounce", "splash", "puddle", "leap"]],
  ["clap", ["clap", "cheer"]],
  ["wave", ["wave", "waving", "hello", "goodbye", "bye", "greet", "salute"]],
  ["point", ["point", "look(?:s|ing)? up", "wonder", "look(?:s|ing)? at"]],
  ["hug", ["hug", "cuddle"]],
  ["walk", ["walk", "skip", "follow", "march", "run"]],
  ["float", ["float", "fly", "flies", "flying", "drift"]],
];

const PROPS = [["star", "star"], ["moon", "moon"], ["sun", "sun\\b"], ["sheep", "lamb|sheep"], ["cow", "\\bcows?\\b"], ["duck", "duck|chick|chicken|hen\\b"],
  ["pig", "\\bpigs?\\b"], ["frog", "frog"], ["cat", "\\bcat\\b|kitten"], ["dog", "\\bdog\\b|puppy"], ["bunny", "bunny|rabbit"], ["bear", "teddy|bear\\b"], ["cloud", "\\bclouds?\\b"]];

/**
 * What a scene looks like: which set, day or night, what the characters do,
 * and extra friends/props mentioned in the text that aren't in the cast.
 */
export function sceneToPlan(text = "", { layout = "", sung = false, castKinds = [] } = {}) {
  const t = text.toLowerCase();
  let set = "stage", at = Infinity;
  for (const [name, words] of SETS) {
    for (const w of words) {
      // whole words only: "sparkle" must not count as "park"
      const m = new RegExp(w.startsWith("\\b") ? w : `\\b${w}`, "i").exec(t);
      if (m && m.index < at) { at = m.index; set = name; }
    }
  }
  if (set === "stage" && !t.trim()) set = layout === "closing" ? "stage" : "farm";
  const night = /night|bed|sleep|dream|moon|twinkl|star|dark|evening|bedtime|space/.test(t) && !/sunny|daytime|morning/.test(t);
  let action = "idle";
  for (const [a, words] of ACTIONS) if (words.some((w) => new RegExp(w, "i").test(t))) { action = a; break; }
  if (set === "river" && /boat/.test(t) && action === "idle") action = "row";
  const props = [];
  for (const [kind, re] of PROPS) {
    if (props.length >= 2) break;
    if (new RegExp(re, "i").test(t) && !castKinds.includes(kind)) {
      // a star mentioned as a pattern ("star pajamas") isn't a friend in the scene
      if (kind === "star" && /star[- ](?:print|pattern|pajama)/.test(t)) continue;
      props.push(kind);
    }
  }
  return { set, night, action, props, boat: /boat|rowboat/.test(t), sung };
}
