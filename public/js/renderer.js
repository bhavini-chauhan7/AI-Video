import { buildNotes } from "./song.js";
import { Stage } from "./three3d/stage.js";
import { lookToSpec, sceneToPlan } from "./three3d/parse.js";
import { sceneCast } from "./cast.js";

// Canvas renderer: turns a storyboard into frames. Pure function of time,
// so preview, seeking and export all draw the exact same thing.

export const SIZES = { "16:9": [1280, 720], "9:16": [720, 1280], "1:1": [1080, 1080] };
const SCALE = { "720p": 1, "1080p": 1.5 };
const TRANSITION = 0.7; // seconds
const BASE_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans Devanagari", "Noto Color Emoji", sans-serif';
export const FONT_FAMILIES = {
  modern: BASE_FONT,
  rounded: `"Baloo 2", ${BASE_FONT}`,
  bold: `"Poppins", ${BASE_FONT}`,
};

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const easeOut = (p) => 1 - Math.pow(1 - p, 3);
const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const easeOutBack = (p) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); };

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexToRgb(hex) {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (hex, a) => `rgba(${hexToRgb(hex).join(",")},${a})`;

function wrapLines(ctx, text, maxWidth) {
  const lines = [];
  for (const para of String(text).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = word; }
      else line = test;
    }
    lines.push(line);
  }
  return lines;
}

export class VideoRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.storyboard = null;
    this.images = new Map();
    this.options = { captions: true, resolution: "720p" };
    this.videos = new Map(); // clip url -> <video>
    this.stage = null;        // 3D cartoon renderer, created on first use
    this.mouth = () => 0;     // (sceneIndex, t) -> 0..1, set by the app from the voices
    this.playing = false;     // true while previewing/exporting, so clips play instead of seeking
    this.font = BASE_FONT;
    this.onImageLoad = null;
  }

  setStoryboard(storyboard) {
    this.storyboard = storyboard;
    const k = storyboard.aspectRatio === "1:1" ? 1 : SCALE[this.options.resolution] || 1;
    const [w, h] = (SIZES[storyboard.aspectRatio] || SIZES["16:9"]).map((v) => Math.round(v * k));
    this.font = FONT_FAMILIES[storyboard.font] || BASE_FONT;
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    let start = 0;
    for (const sc of storyboard.scenes) if (sc.clip?.clip) this.video(sc.clip.clip);
    this.plan3d(storyboard);
    this.timeline = storyboard.scenes.map((scene, index) => {
      const entry = { scene, index, start, end: start + scene.duration };
      start += scene.duration;
      if (scene.image && !this.images.has(scene.image)) {
        const img = new Image();
        img.onload = () => this.onImageLoad?.();
        img.src = scene.image;
        this.images.set(scene.image, img);
      }
      return entry;
    });
    this.duration = start;
  }

  /** Is this scene drawn as a 3D cartoon? (AI clips and uploaded photos win.) */
  is3d(scene) {
    return this.storyboard?.look === "3d" && !scene.clip?.clip && !(scene.background === "image" && scene.image);
  }

  /** Work out each scene's 3D setting, characters and action once per edit. */
  plan3d(sb) {
    this.desc3d = [];
    if (sb.look !== "3d") return;
    const specOf = (c) => {
      const spec = lookToSpec(c.appearance || "", { name: c.name, voiceStyle: c.voiceStyle });
      if (c.kind3d) spec.kind = c.kind3d;
      return spec;
    };
    const keys = new Set();
    sb.scenes.forEach((scene, i) => {
      const cast = sceneCast(sb, scene).slice(0, 3);
      const speaker = cast.find((c) => c.name === scene.speaker) || cast[0];
      const specs = cast.map((c) => ({ spec: specOf(c), speaking: c === speaker, name: c.name }));
      const text = scene.visual || scene.heading || "";
      const plan = sceneToPlan(text, { layout: scene.layout, castKinds: specs.map((x) => x.spec.kind) });
      if (scene.set3d) plan.set = scene.set3d;
      if (scene.action3d) plan.action = scene.action3d;
      const props = plan.props.slice(0, Math.max(0, 4 - specs.length)).map((kind) => ({
        spec: lookToSpec(kind === "sheep" ? "a fluffy white lamb" : `a cute ${kind}`, { name: `${kind}-${i}` }), speaking: false, name: kind, small: !["moon", "star", "sun", "cloud"].includes(kind),
      }));
      const desc = {
        set: plan.set, night: plan.night, boat: plan.boat, action: plan.action, characters: [...specs, ...props],
        sung: !!(scene.lyrics && scene.melody && sb.song), bpm: sb.song?.bpm || 100, duration: scene.duration,
        groupActs: ["dance", "jump", "clap", "wave"].includes(plan.action),
      };
      const key = JSON.stringify(desc);
      keys.add(key);
      this.desc3d[i] = { desc, key };
    });
    this.stage?.keepOnly(keys);
  }

  video(url) {
    if (!this.videos.has(url)) {
      const v = document.createElement("video");
      v.src = url; v.muted = true; v.playsInline = true; v.preload = "auto";
      v.addEventListener("loadeddata", () => this.onImageLoad?.());
      v.addEventListener("seeked", () => { if (!this.playing) this.onImageLoad?.(); });
      this.videos.set(url, v);
    }
    return this.videos.get(url);
  }

  /** Before drawing time t frame-exactly: seek the clips it shows and wait for them. */
  async prepareFrame(t) {
    if (!this.timeline?.length) return;
    t = clamp(t, 0, Math.max(0, this.duration - 1e-3));
    const cur = this.sceneAt(t), prev = this.timeline[cur.index - 1];
    const waits = [];
    for (const [entry, local] of [[cur, t - cur.start], [prev, prev ? prev.scene.duration + (t - cur.start) : 0]]) {
      const url = entry?.scene.clip?.clip;
      if (!url || (entry === prev && t - cur.start >= 0.7)) continue;
      const v = this.video(url);
      if (!v.paused) v.pause();
      const target = Math.max(0, Math.min(local, (v.duration || 0) - 0.04));
      if (Math.abs(v.currentTime - target) > 0.001) {
        waits.push(new Promise((r) => { const done = () => r(); v.addEventListener("seeked", done, { once: true }); setTimeout(done, 1500); }));
        v.currentTime = target;
      }
    }
    await Promise.all(waits);
  }

  /** Keep a clip's playhead at scene time t (play along while previewing, seek while scrubbing). */
  syncVideo(v, t) {
    if (this.exactFrames) { this.usedVideos.add(v); return; }
    const target = Math.max(0, Math.min(t, (v.duration || 0) - 0.04));
    if (this.playing && t < (v.duration || 0)) {
      if (Math.abs(v.currentTime - target) > 0.3) v.currentTime = target;
      if (v.paused) v.play().catch(() => {});
    } else {
      if (!v.paused) v.pause();
      if (Math.abs(v.currentTime - target) > 0.05) v.currentTime = target;
    }
    this.usedVideos.add(v);
  }

  sceneAt(t) {
    const tl = this.timeline;
    for (let i = tl.length - 1; i >= 0; i--) if (t >= tl[i].start) return tl[i];
    return tl[0];
  }

  drawFrame(t) {
    const { ctx, canvas } = this;
    const W = canvas.width, H = canvas.height;
    if (!this.timeline?.length) return;
    t = clamp(t, 0, Math.max(0, this.duration - 1e-3));
    const cur = this.sceneAt(t);
    const local = t - cur.start;
    this.usedVideos = new Set();
    ctx.save();
    ctx.clearRect(0, 0, W, H);

    const prev = this.timeline[cur.index - 1];
    if (prev && local < TRANSITION) {
      const p = easeInOut(local / TRANSITION);
      this.drawTransition(cur.scene.transition, p, W, H,
        () => this.drawScene(prev.scene, prev.scene.duration + local, W, H, prev.index),
        () => this.drawScene(cur.scene, local, W, H, cur.index));
    } else {
      this.drawScene(cur.scene, local, W, H, cur.index);
    }
    if (this.options.captions && cur.scene.narration && cur.scene.layout !== "lyrics") this.drawCaption(cur.scene, local, W, H);
    ctx.restore();
    for (const v of this.videos.values()) if (!this.usedVideos.has(v) && !v.paused) v.pause();
  }

  drawTransition(kind, p, W, H, drawA, drawB) {
    const { ctx } = this;
    switch (kind) {
      case "slide":
        ctx.save(); ctx.translate(-p * W, 0); drawA(); ctx.restore();
        ctx.save(); ctx.translate((1 - p) * W, 0); drawB(); ctx.restore();
        break;
      case "zoom":
        drawA();
        ctx.save(); ctx.globalAlpha = p;
        ctx.translate(W / 2, H / 2); ctx.scale(1.25 - 0.25 * p, 1.25 - 0.25 * p); ctx.translate(-W / 2, -H / 2);
        drawB(); ctx.restore();
        break;
      case "wipe": {
        drawA();
        ctx.save(); ctx.beginPath();
        const x = p * (W + H * 0.4);
        ctx.moveTo(0, 0); ctx.lineTo(x, 0); ctx.lineTo(x - H * 0.4, H); ctx.lineTo(0, H); ctx.closePath();
        ctx.clip(); drawB(); ctx.restore();
        break;
      }
      default:
        drawA();
        ctx.save(); ctx.globalAlpha = p; drawB(); ctx.restore();
    }
  }

  drawScene(scene, t, W, H, index) {
    const { ctx } = this;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    this.drawBackground(scene, t, W, H, index);
    if (scene.clip?.clip || this.is3d(scene)) {
      this.drawClipOverlay(scene, t, W, H);
    } else {
      const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
      vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.45)");
      ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
      this.drawContent(scene, t, W, H);
    }
    ctx.restore();
  }

  // ---------- backgrounds ----------
  drawBackground(scene, t, W, H, index) {
    const { ctx } = this;
    const [c0, c1] = scene.colors;
    const accent = scene.accent;
    const angle = t * 0.15 + index;
    const r = Math.hypot(W, H) / 2;
    const g = ctx.createLinearGradient(W / 2 - Math.cos(angle) * r, H / 2 - Math.sin(angle) * r,
      W / 2 + Math.cos(angle) * r, H / 2 + Math.sin(angle) * r);
    g.addColorStop(0, c0); g.addColorStop(1, c1);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const rand = mulberry32(index * 977 + 13);
    const m = Math.min(W, H);

    if (this.is3d(scene) && this.desc3d[index]) {
      try {
        this.stage ??= new Stage();
        this.stage.setSize(W, H);
        const { desc, key } = this.desc3d[index];
        const canvas = this.stage.render(key, desc, t, (c) => (c.speaking ? this.mouth(index, t) : 0));
        ctx.drawImage(canvas, 0, 0, W, H);
        return;
      } catch (err) {
        console.error("3D rendering failed, showing the flat version:", err);
        this.storyboard.look = "flat";
      }
    }
    if (scene.clip?.clip) {
      const v = this.video(scene.clip.clip);
      this.syncVideo(v, t);
      let frame = v.readyState >= 2 && v.videoWidth ? v : null;
      if (!frame && scene.clip.still) {
        // clip still loading, or this browser can't play it: show the scene's 3D still
        if (!this.images.has(scene.clip.still)) {
          const img = new Image(); img.onload = () => this.onImageLoad?.(); img.src = scene.clip.still;
          this.images.set(scene.clip.still, img);
        }
        const img = this.images.get(scene.clip.still);
        if (img.complete && img.naturalWidth) frame = img;
      }
      if (frame) {
        const fw = frame.videoWidth || frame.naturalWidth, fh = frame.videoHeight || frame.naturalHeight;
        const scale = Math.max(W / fw, H / fh);
        ctx.drawImage(frame, (W - fw * scale) / 2, (H - fh * scale) / 2, fw * scale, fh * scale);
        return;
      }
    }

    switch (scene.background) {
      case "image": {
        const img = scene.image && this.images.get(scene.image);
        if (img?.complete && img.naturalWidth) {
          const k = 1 + 0.12 * (t / Math.max(scene.duration, 1));
          const scale = Math.max(W / img.naturalWidth, H / img.naturalHeight) * k;
          const iw = img.naturalWidth * scale, ih = img.naturalHeight * scale;
          const dir = index % 2 ? 1 : -1;
          const panX = (iw - W) * (0.5 + dir * 0.4 * (t / Math.max(scene.duration, 1) - 0.5));
          ctx.drawImage(img, -panX, -(ih - H) / 2, iw, ih);
          const ov = ctx.createLinearGradient(0, 0, 0, H);
          ov.addColorStop(0, rgba(c0, 0.35)); ov.addColorStop(1, rgba(c1, 0.75));
          ctx.fillStyle = ov; ctx.fillRect(0, 0, W, H);
        }
        break;
      }
      case "particles": {
        for (let i = 0; i < 90; i++) {
          const x = rand() * W, speed = 0.02 + rand() * 0.06, size = (0.002 + rand() * 0.006) * m;
          const y = ((rand() - t * speed) % 1 + 1) % 1 * (H + 40) - 20;
          ctx.fillStyle = rgba(i % 3 ? "#ffffff" : accent, 0.25 + rand() * 0.5);
          ctx.beginPath(); ctx.arc(x + Math.sin(t + i) * 10, y, size, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
      case "waves": {
        for (let k = 0; k < 4; k++) {
          ctx.beginPath(); ctx.moveTo(0, H);
          const base = H * (0.55 + k * 0.1), amp = H * (0.05 - k * 0.008), freq = 1.5 + k * 0.7;
          for (let x = 0; x <= W; x += 8) ctx.lineTo(x, base + Math.sin((x / W) * Math.PI * freq + t * (0.8 + k * 0.3) + k) * amp);
          ctx.lineTo(W, H); ctx.closePath();
          ctx.fillStyle = rgba(k % 2 ? accent : "#ffffff", 0.07 + k * 0.03); ctx.fill();
        }
        break;
      }
      case "grid": {
        const horizon = H * 0.55;
        const glow = ctx.createLinearGradient(0, horizon - H * 0.2, 0, horizon + 4);
        glow.addColorStop(0, rgba(accent, 0)); glow.addColorStop(1, rgba(accent, 0.35));
        ctx.fillStyle = glow; ctx.fillRect(0, horizon - H * 0.2, W, H * 0.2);
        ctx.strokeStyle = rgba(accent, 0.45); ctx.lineWidth = Math.max(1, m * 0.002);
        for (let i = -12; i <= 12; i++) {
          ctx.beginPath(); ctx.moveTo(W / 2 + i * W * 0.02, horizon); ctx.lineTo(W / 2 + i * W * 0.22, H); ctx.stroke();
        }
        for (let i = 0; i < 12; i++) {
          const z = ((i + (t * 0.6) % 1) / 12);
          const y = horizon + (H - horizon) * z * z;
          ctx.globalAlpha = z; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        break;
      }
      case "bokeh": {
        for (let i = 0; i < 22; i++) {
          const rad = (0.04 + rand() * 0.12) * m;
          const x = (rand() * W + Math.sin(t * 0.3 + i) * W * 0.05);
          const y = (rand() * H + Math.cos(t * 0.25 + i * 2) * H * 0.05);
          const bg = ctx.createRadialGradient(x, y, 0, x, y, rad);
          const col = i % 2 ? accent : "#ffffff";
          bg.addColorStop(0, rgba(col, 0.22)); bg.addColorStop(1, rgba(col, 0));
          ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
      default: {
        const x = W * (0.5 + 0.35 * Math.cos(t * 0.4 + index)), y = H * (0.5 + 0.35 * Math.sin(t * 0.3 + index));
        const glow = ctx.createRadialGradient(x, y, 0, x, y, m * 0.7);
        glow.addColorStop(0, rgba(accent, 0.35)); glow.addColorStop(1, rgba(accent, 0));
        ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
      }
    }
  }

  // ---------- text ----------
  /** Draw (possibly multi-line) animated text centered on/aligned to x; returns block height. */
  text(str, x, y, { size, weight = 700, color = "#fff", align = "center", maxWidth, anim = "fade", p = 1, italic = false, lineHeight = 1.18, chars }) {
    const { ctx } = this;
    if (!str) return 0;
    ctx.save();
    ctx.font = `${italic ? "italic " : ""}${weight} ${size}px ${this.font}`;
    ctx.textAlign = align; ctx.textBaseline = "top";
    let content = str;
    if (anim === "typewriter") content = str.slice(0, Math.floor((chars ?? 1) * str.length));
    const lines = wrapLines(ctx, anim === "typewriter" ? str : content, maxWidth);
    const lh = size * lineHeight, height = lines.length * lh;
    const pe = easeOut(clamp(p));
    if (anim === "typewriter") ctx.globalAlpha = clamp(p * 3);
    else ctx.globalAlpha = pe;
    if (anim === "slide-up") ctx.translate(0, (1 - pe) * size * 1.2);
    if (anim === "pop") {
      const s = 0.6 + 0.4 * easeOutBack(clamp(p));
      ctx.translate(x, y + height / 2); ctx.scale(s, s); ctx.translate(-x, -(y + height / 2));
    }
    ctx.fillStyle = color;
    ctx.shadowColor = "rgba(0,0,0,0.35)"; ctx.shadowBlur = size * 0.25; ctx.shadowOffsetY = size * 0.05;
    let remaining = anim === "typewriter" ? content.length : Infinity;
    lines.forEach((line, i) => {
      const shown = line.slice(0, Math.max(0, remaining));
      remaining -= line.length + 1;
      ctx.fillText(shown, x, y + i * lh);
    });
    ctx.restore();
    return height;
  }

  drawContent(scene, t, W, H) {
    const m = Math.min(W, H);
    const portrait = H > W;
    const anim = scene.textAnimation;
    const prog = (delay, len = 0.8) => clamp((t - delay) / len);
    const typeChars = (delay, text) => clamp((t - delay) / Math.max(0.6, text.length * 0.045));
    const maxW = W * (portrait ? 0.84 : 0.78);
    const cx = W / 2;
    const { ctx } = this;
    const accent = scene.accent;

    const centeredStack = (blocks) => {
      // measure, then draw vertically centered
      ctx.save();
      const heights = blocks.map((b) => {
        ctx.font = `${b.italic ? "italic " : ""}${b.weight ?? 700} ${b.size}px ${this.font}`;
        return b.text ? wrapLines(ctx, b.text, maxW).length * b.size * (b.lineHeight ?? 1.18) + (b.gap ?? m * 0.03) : (b.h ?? 0);
      });
      ctx.restore();
      let y = H / 2 - heights.reduce((a, b) => a + b, 0) / 2 - (this.options.captions && scene.narration ? H * 0.04 : 0);
      blocks.forEach((b, i) => {
        if (b.draw) b.draw(y); else this.text(b.text, cx, y, { maxWidth: maxW, anim, ...b });
        y += heights[i];
      });
    };

    switch (scene.layout) {
      case "lyrics":
        if (scene.lyrics && scene.melody) this.drawLyrics(scene, t, W, H);
        else this.text(scene.heading, cx, H * 0.45, { size: m * 0.08, maxWidth: maxW, anim, p: prog(0) });
        break;
      case "title":
      case "closing": {
        const closing = scene.layout === "closing";
        const barP = easeOut(prog(0.6, 0.9));
        centeredStack([
          scene.emoji && { text: scene.emoji, size: m * 0.12, anim: "pop", p: prog(0.0), gap: m * 0.02 },
          { text: scene.heading, size: m * (closing ? 0.085 : 0.1), weight: 800, p: prog(0.15), chars: typeChars(0.15, scene.heading) },
          { h: m * 0.05, draw: (y) => {
            ctx.save(); ctx.fillStyle = accent;
            const w = m * 0.18 * barP; ctx.fillRect(cx - w / 2, y + m * 0.012, w, m * 0.008); ctx.restore();
          } },
          scene.subtext && { text: scene.subtext, size: m * 0.045, weight: 500, color: "rgba(255,255,255,0.88)", p: prog(0.5), chars: typeChars(0.5, scene.subtext) },
        ].filter(Boolean));
        if (closing) {
          const pulse = (t % 2) / 2;
          ctx.save(); ctx.strokeStyle = rgba(accent, 0.5 * (1 - pulse)); ctx.lineWidth = m * 0.004;
          ctx.beginPath(); ctx.arc(cx, H / 2, m * (0.3 + pulse * 0.25), 0, Math.PI * 2); ctx.stroke(); ctx.restore();
        }
        break;
      }
      case "bullets": {
        const left = portrait ? W * 0.08 : W * 0.12;
        const bw = W - left * 2;
        let y = H * (portrait ? 0.22 : 0.18);
        const head = (scene.emoji ? scene.emoji + "  " : "") + scene.heading;
        y += this.text(head, left, y, { size: m * 0.075, weight: 800, align: "left", maxWidth: bw, anim, p: prog(0), chars: typeChars(0, head) });
        const barP = easeOut(prog(0.3));
        ctx.save(); ctx.fillStyle = accent; ctx.fillRect(left, y + m * 0.02, m * 0.14 * barP, m * 0.008); ctx.restore();
        y += m * 0.08;
        const items = scene.bullets.length ? scene.bullets : scene.subtext ? [scene.subtext] : [];
        items.forEach((b, i) => {
          const d = 0.5 + i * 0.45;
          const p = prog(d);
          ctx.save(); ctx.globalAlpha = easeOut(p); ctx.fillStyle = accent;
          ctx.beginPath(); ctx.arc(left + m * 0.015, y + m * 0.03, m * 0.012 * (0.5 + 0.5 * easeOutBack(p)), 0, Math.PI * 2); ctx.fill(); ctx.restore();
          y += this.text(b, left + m * 0.05, y, { size: m * 0.048, weight: 600, align: "left", maxWidth: bw - m * 0.05, anim, p, chars: typeChars(d, b) }) + m * 0.035;
        });
        break;
      }
      case "quote": {
        centeredStack([
          { h: m * 0.12, draw: (y) => this.text("“", cx, y - m * 0.04, { size: m * 0.25, weight: 900, color: accent, anim: "pop", p: prog(0), maxWidth: maxW }) },
          { text: scene.heading, size: m * 0.062, weight: 600, italic: true, p: prog(0.25), chars: typeChars(0.25, scene.heading), lineHeight: 1.3 },
          scene.subtext && { text: `— ${scene.subtext}`, size: m * 0.04, weight: 500, color: "rgba(255,255,255,0.8)", anim: "fade", p: prog(1.2) },
        ].filter(Boolean));
        break;
      }
      case "statistic": {
        const match = scene.heading.match(/^([^\d]*)(\d[\d,]*(?:\.\d+)?)(.*)$/);
        let heading = scene.heading;
        if (match) {
          const [, pre, num, post] = match;
          const value = parseFloat(num.replace(/,/g, ""));
          const decimals = (num.split(".")[1] || "").length;
          const v = value * easeOut(clamp(t / 1.6));
          const formatted = v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: num.includes(",") });
          heading = pre + formatted + post;
        }
        centeredStack([
          scene.emoji && { text: scene.emoji, size: m * 0.09, anim: "pop", p: prog(0), gap: m * 0.01 },
          { text: heading, size: m * 0.17, weight: 900, color: accent, anim: anim === "typewriter" ? "pop" : anim, p: prog(0.1) },
          scene.subtext && { text: scene.subtext, size: m * 0.05, weight: 600, p: prog(0.6), chars: typeChars(0.6, scene.subtext) },
        ].filter(Boolean));
        break;
      }
    }
  }

  /** Text over a 3D clip: keep the characters visible, so text sits in the lower third. */
  drawClipOverlay(scene, t, W, H) {
    const { ctx } = this;
    const m = Math.min(W, H);
    if (scene.layout === "lyrics" && scene.lyrics && scene.melody) {
      const g = ctx.createLinearGradient(0, H * 0.62, 0, H);
      g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0.55)");
      ctx.fillStyle = g; ctx.fillRect(0, H * 0.62, W, H * 0.38);
      this.drawLyrics({ ...scene, emoji: "" }, t, W, H, { y: H * (H > W ? 0.8 : 0.84), scale: 0.78 });
      return;
    }
    // a title card that fades out after a few seconds
    const a = clamp(t / 0.4) * clamp((3.2 - t) / 0.5);
    if (a <= 0 || !scene.heading) return;
    ctx.save();
    ctx.globalAlpha = a;
    const size = m * (scene.layout === "title" || scene.layout === "closing" ? 0.08 : 0.06);
    ctx.font = `800 ${size}px ${this.font}`;
    const lines = wrapLines(ctx, scene.heading, W * 0.8);
    const lh = size * 1.2, boxH = lines.length * lh + size * 0.6;
    const y = H * (scene.layout === "title" ? 0.08 : 0.06);
    const boxW = Math.max(...lines.map((l) => ctx.measureText(l).width)) + size * 1.2;
    ctx.fillStyle = rgba(scene.accent, 0.85);
    ctx.beginPath(); ctx.roundRect((W - boxW) / 2, y, boxW, boxH, size * 0.4); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.shadowColor = "rgba(0,0,0,0.3)"; ctx.shadowBlur = size * 0.15;
    lines.forEach((l, i) => ctx.fillText(l, W / 2, y + size * 0.3 + i * lh));
    ctx.restore();
  }

  /** Sung syllables with start times (seconds into the scene), cached per lyrics+melody+tempo. */
  syllableTimes(scene) {
    const bpm = this.storyboard.song?.bpm || 100;
    const key = `${scene.lyrics}|${scene.melody}|${bpm}`;
    this.sylCache ??= new Map();
    if (!this.sylCache.has(key)) {
      const spb = 60 / bpm;
      let t = 0;
      const syl = [];
      for (const n of buildNotes(scene.lyrics, scene.melody).notes) {
        if (n.pitch && n.text) {
          if (n.hold && syl.length) syl.at(-1).end = t + n.beats * spb;
          else syl.push({ text: n.text, word: n.word, start: t, end: t + n.beats * spb });
        }
        t += n.beats * spb;
      }
      this.sylCache.set(key, syl);
    }
    return this.sylCache.get(key);
  }

  /** Karaoke lyrics: syllables light up as they are sung, with a bouncing ball. */
  drawLyrics(scene, t, W, H, { y: centerY = H * 0.56, scale = 1 } = {}) {
    const { ctx } = this;
    const m = Math.min(W, H);
    const syl = this.syllableTimes(scene);
    const size = m * (H > W ? 0.07 : 0.082) * scale;
    const maxW = W * 0.84;
    ctx.save();
    ctx.font = `800 ${size}px ${this.font}`;
    ctx.textBaseline = "alphabetic";
    // group syllables into words, then wrap words into lines
    const words = [];
    syl.forEach((s) => {
      if (!words.length || words.at(-1).word !== s.word) words.push({ word: s.word, parts: [] });
      words.at(-1).parts.push(s);
    });
    const space = ctx.measureText(" ").width;
    const lines = [[]];
    let lineW = 0;
    for (const w of words) {
      w.width = w.parts.reduce((a, p) => a + (p.w = ctx.measureText(p.text).width), 0);
      if (lineW && lineW + space + w.width > maxW) { lines.push([]); lineW = 0; }
      lineW += (lineW ? space : 0) + w.width;
      lines.at(-1).push(w);
    }
    const lh = size * 1.35;
    const blockH = lines.length * lh;
    const top = centerY - blockH / 2;

    // emoji bounces on the beat
    const beat = 60 / (this.storyboard.song?.bpm || 100);
    if (scene.emoji) {
      const hop = Math.abs(Math.sin((Math.PI * t) / beat));
      ctx.font = `${m * 0.12}px ${this.font}`; ctx.textAlign = "center";
      ctx.globalAlpha = clamp(t / 0.3);
      ctx.fillText(scene.emoji, W / 2, top - m * 0.1 - hop * m * 0.025);
      ctx.globalAlpha = 1;
    }

    ctx.font = `800 ${size}px ${this.font}`;
    ctx.textAlign = "left";
    let ball = null;
    lines.forEach((line, li) => {
      const width = line.reduce((a, w, i) => a + w.width + (i ? space : 0), 0);
      let x = (W - width) / 2;
      const y = top + (li + 1) * lh - size * 0.3;
      line.forEach((w) => {
        for (const p of w.parts) {
          const sung = t >= p.start;
          const active = t >= p.start && t < p.end;
          ctx.save();
          ctx.shadowColor = "rgba(0,0,0,0.45)"; ctx.shadowBlur = size * 0.2; ctx.shadowOffsetY = size * 0.05;
          ctx.fillStyle = sung ? scene.accent : "rgba(255,255,255,0.92)";
          if (active) {
            const k = 1 + 0.08 * Math.sin(clamp((t - p.start) / Math.min(0.25, p.end - p.start)) * Math.PI);
            ctx.translate(x + p.w / 2, y - size * 0.35); ctx.scale(k, k); ctx.translate(-(x + p.w / 2), -(y - size * 0.35));
            ball = { x: x + p.w / 2, y: y - size * 1.05, phase: clamp((t - p.start) / Math.max(0.1, p.end - p.start)) };
          }
          ctx.globalAlpha = clamp(t / 0.25);
          ctx.fillText(p.text, x, y);
          ctx.restore();
          x += p.w;
        }
        x += space;
      });
    });
    if (ball) {
      const r = size * 0.16;
      const yb = ball.y - Math.sin(ball.phase * Math.PI) * size * 0.35;
      ctx.fillStyle = "#ffffff"; ctx.shadowColor = scene.accent; ctx.shadowBlur = r * 2;
      ctx.beginPath(); ctx.arc(ball.x, yb, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  drawCaption(scene, t, W, H) {
    const { ctx } = this;
    const m = Math.min(W, H);
    const words = scene.narration.split(/\s+/).filter(Boolean);
    const per = 12;
    const chunks = [];
    for (let i = 0; i < words.length; i += per) chunks.push(words.slice(i, i + per).join(" "));
    const idx = Math.min(chunks.length - 1, Math.floor((t / scene.duration) * chunks.length));
    const text = chunks[idx];
    const size = m * 0.034;
    ctx.save();
    ctx.font = `600 ${size}px ${this.font}`;
    const lines = wrapLines(ctx, text, W * 0.8);
    const lh = size * 1.35, padX = size * 0.8, padY = size * 0.5;
    const boxW = Math.max(...lines.map((l) => ctx.measureText(l).width)) + padX * 2;
    const boxH = lines.length * lh + padY * 2;
    const y = H - boxH - H * (H > W ? 0.12 : 0.06);
    ctx.globalAlpha = clamp(t / 0.3);
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.beginPath(); ctx.roundRect((W - boxW) / 2, y, boxW, boxH, size * 0.4); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "top";
    lines.forEach((l, i) => ctx.fillText(l, W / 2, y + padY + i * lh + (lh - size) / 2));
    ctx.restore();
  }
}
