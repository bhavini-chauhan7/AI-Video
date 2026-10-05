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
    if (this.options.captions && cur.scene.narration) this.drawCaption(cur.scene, local, W, H);
    ctx.restore();
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
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.45)");
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    this.drawContent(scene, t, W, H);
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
