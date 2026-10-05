// Which characters appear in a scene (shared by the editor and the 3D renderer).
const STOP = new Set(["the", "mr", "mrs", "ms", "miss", "little", "big", "old", "and", "character", "narrator", "singer"]);

export const castFor = (storyboard, scene) => storyboard.cast.find((c) => c.name === scene.speaker) || storyboard.cast[0];

/** Does the text mention this character (any distinctive word of its name, e.g. "moon" for "Mr. Moon")? */
export function mentions(text, c) {
  const words = c.name.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
  return words.length ? words.some((w) => new RegExp(`\\b${w}`, "iu").test(text)) : text.toLowerCase().includes(c.name.toLowerCase());
}

/**
 * Characters in a scene, main one first: the speaker if the scene mentions them
 * (or nobody), otherwise the characters the description is about, then the speaker.
 */
export function sceneCast(storyboard, scene) {
  const speaker = castFor(storyboard, scene);
  const text = `${scene.visual || ""} ${scene.heading || ""}`;
  const named = storyboard.cast.filter((c) => mentions(text, c));
  const at = (c) => { const w = c.name.toLowerCase().split(" ").pop(); const i = text.toLowerCase().search(w); return i < 0 ? 1e9 : i; };
  named.sort((a, b) => at(a) - at(b));
  if (!named.length) return [speaker];
  return named.includes(speaker) ? [speaker, ...named.filter((c) => c !== speaker)] : [...named, speaker];
}
