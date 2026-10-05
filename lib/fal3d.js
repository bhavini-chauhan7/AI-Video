// 3D animated characters through fal.ai (one key for several models):
//   1. FLUX.1 Kontext [pro] text-to-image designs each character once (a 3D
//      "character sheet" image),
//   2. FLUX.1 Kontext [pro] image editing puts that same character into each
//      scene, so characters stay consistent from scene to scene,
//   3. Kling image-to-video animates the scene,
//   4. Kling LipSync moves the character's mouth to the scene's voice or song.
// Every result is downloaded into ./media and served from this app, so the
// browser can draw it on the canvas and projects keep working after fal's
// links expire.
import { fal } from "@fal-ai/client";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { FFMPEG, hasFfmpeg } from "./tts.js";

export const MEDIA_DIR = process.env.MEDIA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "media");

export const MODELS = {
  design: process.env.FAL_DESIGN_MODEL || "fal-ai/flux-pro/kontext/text-to-image",
  still: process.env.FAL_STILL_MODEL || "fal-ai/flux-pro/kontext",
  video: process.env.FAL_VIDEO_MODEL || "fal-ai/kling-video/v2.1/standard/image-to-video",
  lipsync: process.env.FAL_LIPSYNC_MODEL || "fal-ai/kling-video/lipsync/audio-to-video",
};

// Approximate fal.ai prices (USD), used for the estimate shown before rendering.
export const PRICES = { image: 0.04, video5: 0.28, videoPerExtraSecond: 0.056, lipsyncPerSecond: 0.014 };

export const STYLE = "high-quality 3D animated kids cartoon, cute rounded characters with big expressive eyes, " +
  "soft colorful lighting, vibrant pastel colors, smooth stylized textures, family-friendly, like a modern animated movie";

let configured = false;
export function falAvailable() {
  if (!process.env.FAL_KEY) return false;
  if (!configured) {
    fal.config({
      credentials: process.env.FAL_KEY,
      // tests (and corporate proxies) can route every fal request through one URL
      ...(process.env.FAL_PROXY_URL ? { proxyUrl: { url: process.env.FAL_PROXY_URL, when: "always" } } : {}),
    });
    configured = true;
  }
  return true;
}

async function run(model, input, onUpdate) {
  const { data } = await fal.subscribe(model, {
    input,
    pollInterval: 2000,
    onQueueUpdate: (u) => onUpdate?.(u.status === "IN_QUEUE" ? "waiting in the fal.ai queue" : "rendering"),
  });
  return data;
}

async function save(url, ext) {
  await mkdir(MEDIA_DIR, { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download the result (${res.status}).`);
  const name = `${randomUUID()}.${ext}`;
  await writeFile(path.join(MEDIA_DIR, name), Buffer.from(await res.arrayBuffer()));
  return `/media/${name}`;
}

/** Read a /media/... file back as a Blob (the fal client uploads Blob inputs for us). */
async function mediaBlob(mediaPath, type) {
  const name = path.basename(String(mediaPath || ""));
  if (!/^[\w-]+\.(png|jpe?g|webp|mp4)$/i.test(name)) throw new Error("Unknown media file.");
  return new Blob([await readFile(path.join(MEDIA_DIR, name))], { type });
}

const imageType = (p) => (/\.png$/i.test(p) ? "image/png" : /\.webp$/i.test(p) ? "image/webp" : "image/jpeg");
const ratio = (ar) => (["16:9", "9:16", "1:1"].includes(ar) ? ar : "16:9");

/** Design a character: returns { image: "/media/..." }. */
export async function designCharacter({ name, appearance, onUpdate }) {
  const prompt = `${STYLE}. Character design of ${name || "a friendly character"}: ${appearance || "a cheerful cartoon character"}. ` +
    "Full body, standing, facing the viewer, happy friendly expression, centered, simple soft gradient background, no text.";
  const data = await run(MODELS.design, { prompt, aspect_ratio: "1:1", num_images: 1, output_format: "png" }, onUpdate);
  const url = data?.images?.[0]?.url;
  if (!url) throw new Error("fal.ai returned no image.");
  return { image: await save(url, "png") };
}

/**
 * Make one 3D scene clip.
 * scene: { visual, heading }, characters: [{ name, appearance, image }] (image = /media path),
 * speaker: name of the character who talks/sings, audio: Buffer of the scene's voice (optional),
 * seconds: scene length. Returns { still, clip, seconds, lipsync }.
 */
export async function makeSceneClip({ scene, characters, speaker, audio, audioType, seconds, aspectRatio, sung, onUpdate }) {
  const ar = ratio(aspectRatio);
  const lead = characters.find((c) => c.name === speaker && c.image) || characters.find((c) => c.image);
  const others = characters.filter((c) => c !== lead);
  const action = scene.visual || scene.heading || "the characters smile and wave";
  const cast = others.length ? ` Also in the scene: ${others.map((c) => `${c.name} (${c.appearance})`).join("; ")}.` : "";

  // 1) still image of the scene with the main character kept identical
  onUpdate?.("drawing the scene");
  let stillUrl;
  if (lead) {
    const data = await run(MODELS.still, {
      prompt: `Put this exact character, ${lead.name}, into a new scene: ${action}.${cast} Keep the character's face, colors, outfit and proportions identical. ${STYLE}. Wide shot that fits ${ar}, no text.`,
      image_url: await mediaBlob(lead.image, imageType(lead.image)),
      aspect_ratio: ar, num_images: 1, output_format: "jpeg",
    }, onUpdate);
    stillUrl = data?.images?.[0]?.url;
  } else {
    const data = await run(MODELS.design, { prompt: `${STYLE}. ${action}.${cast} No text.`, aspect_ratio: ar, num_images: 1, output_format: "jpeg" }, onUpdate);
    stillUrl = data?.images?.[0]?.url;
  }
  if (!stillUrl) throw new Error("fal.ai returned no scene image.");
  const still = await save(stillUrl, "jpg");

  // 2) animate it
  onUpdate?.("animating");
  const length = seconds > 5.5 ? "10" : "5";
  const talking = audio ? (sung ? `${lead?.name || "the character"} sings happily, mouth moving, gentle swaying to the music` : `${lead?.name || "the character"} talks to the viewer with lively gestures`) : "gentle lively movement";
  const video = await run(MODELS.video, {
    prompt: `${action}. ${talking}. Smooth, cheerful 3D cartoon animation, the camera stays steady.`,
    image_url: stillUrl, duration: length, aspect_ratio: ar,
    negative_prompt: "blur, distort, low quality, scary, extra limbs, deformed face, text, watermark",
  }, onUpdate);
  let videoUrl = video?.video?.url;
  if (!videoUrl) throw new Error("fal.ai returned no video.");

  // 3) lip-sync to the voice (Kling needs the audio no longer than the clip)
  let lipsync = false;
  if (audio && audio.length > 1000) {
    onUpdate?.("lip-syncing");
    const fitted = await fitAudio(audio, audioType, Number(length));
    try {
      const synced = await run(MODELS.lipsync, { video_url: videoUrl, audio_url: new Blob([fitted.buffer], { type: fitted.type }) }, onUpdate);
      if (synced?.video?.url) { videoUrl = synced.video.url; lipsync = true; }
    } catch (err) {
      // lip-sync needs a face it can find (it may not, for a star or a teapot): keep the animated clip
      console.warn("lip-sync skipped:", err?.body ? JSON.stringify(err.body).slice(0, 200) : err.message);
    }
  }
  const clip = await save(videoUrl, "mp4");
  return { still, clip, seconds: Number(length), lipsync };
}

/** Trim or pad the voice to exactly the clip length (mp3), using ffmpeg when available. */
async function fitAudio(buffer, type, seconds) {
  if (!hasFfmpeg) return { buffer, type: type || "audio/wav" };
  const dir = await mkdtemp(path.join(tmpdir(), "aivideo-lip-"));
  try {
    const src = path.join(dir, "in"), out = path.join(dir, "out.mp3");
    await writeFile(src, buffer);
    await new Promise((resolve, reject) => {
      const p = spawn(FFMPEG, ["-y", "-i", src, "-af", `apad,atrim=0:${seconds}`, "-ac", "1", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "128k", out], { stdio: "ignore" });
      p.on("error", reject);
      p.on("close", (c) => (c === 0 ? resolve() : reject(new Error("ffmpeg could not prepare the audio"))));
    });
    return { buffer: await readFile(out), type: "audio/mpeg" };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Cost estimate for making `scenes` scene clips and designing `characters` characters. */
export function estimate({ scenes = [], characters = 0 }) {
  let total = characters * PRICES.image;
  for (const s of scenes) {
    const len = s.seconds > 5.5 ? 10 : 5;
    total += PRICES.image + PRICES.video5 + (len - 5) * PRICES.videoPerExtraSecond;
    if (s.voice) total += Math.ceil(len / 5) * 5 * PRICES.lipsyncPerSecond;
  }
  return Math.round(total * 100) / 100;
}
