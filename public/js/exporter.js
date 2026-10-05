// Frame-by-frame export with WebCodecs: every frame is drawn at its exact time
// and encoded, so the video is smooth even on slow computers (and faster than
// real time on fast ones). MP4 (H.264 + AAC) when the browser can encode it,
// otherwise WebM (VP9 + Opus).
import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from "/vendor/mp4-muxer/mp4-muxer.mjs";
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from "/vendor/webm-muxer/webm-muxer.mjs";

const SAMPLE_RATE = 48000;

export const frameExportSupported = () => typeof VideoEncoder !== "undefined" && typeof AudioEncoder !== "undefined" && typeof VideoFrame !== "undefined";

async function supported(enc, config) {
  try { return (await enc.isConfigSupported(config)).supported; } catch { return false; }
}

/** Pick the best container/codecs this browser can encode. */
async function pickFormat(width, height, fps, bitrate) {
  const v = (codec, extra = {}) => ({ codec, width, height, bitrate, framerate: fps, ...extra });
  const a = (codec) => ({ codec, sampleRate: SAMPLE_RATE, numberOfChannels: 1, bitrate: 160000 });
  for (const avc of ["avc1.640028", "avc1.4d0028", "avc1.42e01f"]) {
    if (!(await supported(VideoEncoder, v(avc, { avc: { format: "avc" } })))) continue;
    if (await supported(AudioEncoder, a("mp4a.40.2"))) return { ext: "mp4", type: "video/mp4", video: v(avc, { avc: { format: "avc" } }), audio: a("mp4a.40.2"), muxV: "avc", muxA: "aac" };
    if (await supported(AudioEncoder, a("opus"))) return { ext: "mp4", type: "video/mp4", video: v(avc, { avc: { format: "avc" } }), audio: a("opus"), muxV: "avc", muxA: "opus" };
  }
  for (const vp of ["vp09.00.40.08", "vp09.00.10.08", "vp8"]) {
    if ((await supported(VideoEncoder, v(vp))) && (await supported(AudioEncoder, a("opus")))) {
      return { ext: "webm", type: "video/webm", video: v(vp), audio: a("opus"), muxV: vp === "vp8" ? "V_VP8" : "V_VP9", muxA: "A_OPUS" };
    }
  }
  return null;
}

/**
 * Export a video.
 *  canvas: the canvas frames are drawn on; drawAt(t): draws the frame at time t (may be async)
 *  audio: AudioBuffer (mono, 48 kHz) of the full mix, or null
 * Returns { blob, ext } or null when the browser can't encode (use the real-time fallback).
 */
export async function exportFrames({ canvas, duration, fps = 30, bitrate = 8_000_000, drawAt, audio, onProgress }) {
  if (!frameExportSupported()) return null;
  const width = canvas.width - (canvas.width % 2), height = canvas.height - (canvas.height % 2);
  const fmt = await pickFormat(width, height, fps, bitrate);
  if (!fmt) return null;

  const target = fmt.ext === "mp4" ? new Mp4Target() : new WebmTarget();
  const muxer = fmt.ext === "mp4"
    ? new Mp4Muxer({ target, video: { codec: fmt.muxV, width, height, frameRate: fps }, audio: audio ? { codec: fmt.muxA, sampleRate: SAMPLE_RATE, numberOfChannels: 1 } : undefined, fastStart: "in-memory", firstTimestampBehavior: "offset" })
    : new WebmMuxer({ target, video: { codec: fmt.muxV, width, height, frameRate: fps }, audio: audio ? { codec: fmt.muxA, sampleRate: SAMPLE_RATE, numberOfChannels: 1 } : undefined, firstTimestampBehavior: "offset" });

  let failure = null;
  const venc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => (failure = e) });
  venc.configure(fmt.video);

  // audio first (fast): encode the whole mix in 20 ms blocks
  if (audio) {
    const aenc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => (failure = e) });
    aenc.configure(fmt.audio);
    const data = audio.getChannelData(0);
    const block = 960;
    for (let i = 0; i < data.length; i += block) {
      const n = Math.min(block, data.length - i);
      aenc.encode(new AudioData({ format: "f32-planar", sampleRate: SAMPLE_RATE, numberOfFrames: n, numberOfChannels: 1, timestamp: Math.round((i / SAMPLE_RATE) * 1e6), data: data.slice(i, i + n) }));
    }
    await aenc.flush();
    aenc.close();
  }

  // video: draw and encode each frame
  const frames = Math.ceil(duration * fps);
  const off = new OffscreenCanvas(width, height);
  const octx = off.getContext("2d");
  for (let i = 0; i < frames; i++) {
    if (failure) throw failure;
    await drawAt(i / fps);
    octx.drawImage(canvas, 0, 0, width, height);
    const frame = new VideoFrame(off, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
    venc.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();
    while (venc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 5));
    if (i % 5 === 0) { onProgress?.(i / frames); await new Promise((r) => setTimeout(r, 0)); }
  }
  await venc.flush();
  venc.close();
  if (failure) throw failure;
  muxer.finalize();
  onProgress?.(1);
  return { blob: new Blob([target.buffer], { type: fmt.type }), ext: fmt.ext };
}

export { SAMPLE_RATE };
