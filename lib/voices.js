// Voice catalog: base voices per TTS provider, character effects, and
// ready-made character presets (a base voice + effect + speed).

// Kokoro voice id prefix -> language. First letter = language, second = gender.
export const KOKORO_LANGS = {
  a: { code: "en-us", label: "English (US)" },
  b: { code: "en-gb", label: "English (UK)" },
  e: { code: "es", label: "Spanish" },
  f: { code: "fr-fr", label: "French" },
  h: { code: "hi", label: "Hindi" },
  i: { code: "it", label: "Italian" },
  j: { code: "ja", label: "Japanese" },
  p: { code: "pt-br", label: "Portuguese (BR)" },
  z: { code: "cmn", label: "Chinese (Mandarin)" },
};

const KOKORO_NOTES = {
  af_heart: "warm", af_bella: "bright", af_nicole: "soft, whispery", af_sky: "young", af_nova: "upbeat",
  af_sarah: "calm", af_jessica: "casual", af_river: "relaxed", af_alloy: "neutral", af_aoede: "smooth", af_kore: "clear",
  am_adam: "steady", am_michael: "friendly", am_puck: "playful", am_santa: "jolly", am_onyx: "deep", am_fenrir: "bold",
  am_echo: "neutral", am_eric: "confident", am_liam: "young",
  bf_emma: "warm", bf_alice: "crisp", bf_isabella: "elegant", bf_lily: "gentle",
  bm_george: "classic", bm_fable: "storyteller", bm_lewis: "mature", bm_daniel: "calm",
};

export const KOKORO_VOICE_IDS = [
  "af_heart", "af_bella", "af_nicole", "af_sky", "af_nova", "af_sarah", "af_jessica", "af_river", "af_alloy", "af_aoede", "af_kore",
  "am_adam", "am_michael", "am_puck", "am_santa", "am_onyx", "am_fenrir", "am_echo", "am_eric", "am_liam",
  "bf_emma", "bf_alice", "bf_isabella", "bf_lily", "bm_george", "bm_fable", "bm_lewis", "bm_daniel",
  "hf_alpha", "hf_beta", "hm_omega", "hm_psi", "ef_dora", "em_alex", "ff_siwis", "if_sara", "im_nicola",
  "pf_dora", "pm_alex", "jf_alpha", "jf_nezumi", "jm_kumo", "zf_xiaobei", "zf_xiaoxiao", "zm_yunxi", "zm_yunjian",
];

export function kokoroVoices() {
  return KOKORO_VOICE_IDS.map((v) => {
    const lang = KOKORO_LANGS[v[0]];
    const name = v.slice(3).replace(/^./, (c) => c.toUpperCase());
    const gender = v[1] === "f" ? "female" : "male";
    const note = KOKORO_NOTES[v] ? `, ${KOKORO_NOTES[v]}` : "";
    return { id: `kokoro:${v}`, provider: "kokoro", name: `${name} (${gender}${note})`, lang: lang.code, langLabel: lang.label, gender };
  });
}

export const OPENAI_VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse"]
  .map((v) => ({ id: `openai:${v}`, provider: "openai", name: v[0].toUpperCase() + v.slice(1), lang: "multi", langLabel: "OpenAI (multilingual)" }));

const semis = (n) => Math.pow(2, n / 12);
const pitch = (n, tempo = 1) => {
  const r = semis(n);
  return `aresample=24000,asetrate=${(24000 * r).toFixed(0)},aresample=24000,atempo=${((1 / r) * tempo).toFixed(4)}`;
};

// ffmpeg audio filters applied after synthesis.
export const EFFECTS = {
  none: { label: "None", filter: "" },
  kid: { label: "Kid voice (higher pitch)", filter: pitch(4, 1.03) },
  cartoon: { label: "Cartoon", filter: pitch(6, 1.06) },
  chipmunk: { label: "Chipmunk", filter: pitch(9, 1.1) },
  deep: { label: "Deep / giant", filter: pitch(-4, 0.97) },
  monster: { label: "Monster", filter: `${pitch(-7, 0.95)},aecho=0.8:0.5:40:0.35` },
  robot: { label: "Robot", filter: "aresample=24000,afftfilt=real='hypot(re\\,im)*sin(0)':imag='hypot(re\\,im)*cos(0)':win_size=512:overlap=0.75,aecho=0.8:0.6:20:0.3" },
  echo: { label: "Echo (hero / announcer)", filter: "aecho=0.8:0.7:60|120:0.35|0.2" },
  radio: { label: "Radio / phone", filter: "highpass=f=300,lowpass=f=3400,acompressor" },
};

// Character presets, used for Claude's voiceStyle and shown first in the UI.
// `voices` lists candidates in order of preference per provider.
export const PRESETS = [
  { id: "narrator-female", label: "Friendly narrator (female)", kokoro: "af_heart", openai: "coral", effect: "none", speed: 1 },
  { id: "narrator-male", label: "Friendly narrator (male)", kokoro: "am_michael", openai: "ash", effect: "none", speed: 1 },
  { id: "storyteller", label: "Bedtime storyteller", kokoro: "bm_fable", openai: "fable", effect: "none", speed: 0.92 },
  { id: "teacher", label: "Calm teacher", kokoro: "af_sarah", openai: "sage", effect: "none", speed: 0.95 },
  { id: "hype-host", label: "Hype host (Gen Z energy)", kokoro: "af_nova", openai: "nova", effect: "none", speed: 1.12 },
  { id: "energetic-host", label: "Energetic host (male)", kokoro: "am_puck", openai: "verse", effect: "none", speed: 1.08 },
  { id: "little-kid", label: "Little kid", kokoro: "af_sky", openai: "shimmer", effect: "kid", speed: 1 },
  { id: "little-boy", label: "Little boy", kokoro: "am_liam", openai: "alloy", effect: "kid", speed: 1 },
  { id: "cartoon", label: "Cartoon sidekick", kokoro: "af_jessica", openai: "ballad", effect: "cartoon", speed: 1 },
  { id: "chipmunk", label: "Chipmunk", kokoro: "af_bella", openai: "nova", effect: "chipmunk", speed: 1 },
  { id: "robot", label: "Robot", kokoro: "am_echo", openai: "echo", effect: "robot", speed: 0.95 },
  { id: "monster", label: "Friendly monster", kokoro: "am_onyx", openai: "onyx", effect: "monster", speed: 0.92 },
  { id: "giant", label: "Giant", kokoro: "am_fenrir", openai: "onyx", effect: "deep", speed: 0.9 },
  { id: "grandparent", label: "Grandpa", kokoro: "bm_lewis", openai: "ballad", effect: "none", speed: 0.88 },
  { id: "santa", label: "Jolly Santa", kokoro: "am_santa", openai: "onyx", effect: "none", speed: 0.95 },
  { id: "announcer", label: "Movie-trailer announcer", kokoro: "am_onyx", openai: "onyx", effect: "echo", speed: 0.92 },
];
export const VOICE_STYLES = PRESETS.map((p) => p.id);

// Narrator voices per Kokoro language, for non-English videos.
const KOKORO_BY_LANG = {
  hi: { female: "hf_alpha", male: "hm_omega" }, es: { female: "ef_dora", male: "em_alex" }, "fr-fr": { female: "ff_siwis", male: "ff_siwis" },
  it: { female: "if_sara", male: "im_nicola" }, "pt-br": { female: "pf_dora", male: "pm_alex" }, ja: { female: "jf_alpha", male: "jm_kumo" },
  cmn: { female: "zf_xiaobei", male: "zm_yunxi" }, "en-gb": { female: "bf_emma", male: "bm_george" },
};
export const LANGUAGES = ["en-us", "en-gb", "hi", "es", "fr-fr", "it", "pt-br", "ja", "cmn"];

/** Resolve a voice style to a concrete {voice, effect, speed} for the best available provider. */
export function presetVoice(styleId, { providers, language = "en-us" } = {}) {
  const p = PRESETS.find((x) => x.id === styleId) || PRESETS[0];
  if (providers?.kokoro) {
    let v = p.kokoro;
    const local = KOKORO_BY_LANG[language];
    if (local && language !== "en-us") v = (v[1] === "m" ? local.male : local.female);
    return { voice: `kokoro:${v}`, effect: p.effect, speed: p.speed };
  }
  if (providers?.openai) return { voice: `openai:${p.openai}`, effect: p.effect, speed: p.speed };
  if (providers?.elevenlabs) return { voice: providers.elevenlabsDefault || "", effect: p.effect, speed: p.speed };
  return { voice: "", effect: p.effect, speed: p.speed };
}
