// Cute 3D cartoon characters built from smooth primitives (no downloads,
// no AI): kids and grown-ups, animals, and friendly objects with faces.
// Every character has the same rig (body, head, arms, legs, eyes, mouth), so
// the same animations and lip-sync work for all of them.
import * as THREE from "three";

const geo = {
  sphere: new THREE.SphereGeometry(1, 40, 28),
  lowSphere: new THREE.SphereGeometry(1, 20, 14),
};

export function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0, ...opts });
}

function ball(r, material, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, low = false) {
  const m = new THREE.Mesh(low ? geo.lowSphere : geo.sphere, material);
  m.scale.set(r * sx, r * sy, r * sz);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

function capsule(r, len, material) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 8, 20), material);
  m.castShadow = true;
  return m;
}

function cone(r, h, material, segs = 24) {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, segs), material);
  m.castShadow = true;
  return m;
}

function cyl(rt, rb, h, material, segs = 32) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, segs), material);
  m.castShadow = true;
  return m;
}

/** Small deterministic random generator so a character always looks the same. */
export function rng(seed) {
  let s = 0;
  for (const ch of String(seed)) s = (s * 31 + ch.charCodeAt(0)) | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Patterned fabric (stars, dots, stripes, flowers, spots) as a canvas texture. */
function fabric(base, pattern, accent = "#ffffff") {
  if (!pattern) return null;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = base; g.fillRect(0, 0, 256, 256);
  g.fillStyle = accent;
  const r = rng(pattern + base);
  if (pattern === "stripes") {
    for (let y = 0; y < 256; y += 40) g.fillRect(0, y, 256, 16);
  } else if (pattern === "spots") {
    g.fillStyle = "#222222";
    for (let i = 0; i < 7; i++) { g.beginPath(); g.ellipse(r() * 256, r() * 256, 18 + r() * 26, 14 + r() * 20, r() * 3, 0, 7); g.fill(); }
  } else {
    for (let i = 0; i < 26; i++) {
      const x = (i % 6) * 46 + (Math.floor(i / 6) % 2) * 23 + 10, y = Math.floor(i / 6) * 52 + 20;
      g.save(); g.translate(x, y);
      if (pattern === "stars") {
        g.beginPath();
        for (let k = 0; k < 10; k++) { const a = (k * Math.PI) / 5 - Math.PI / 2, rr = k % 2 ? 6 : 14; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
        g.fill();
      } else if (pattern === "flowers") {
        for (let k = 0; k < 5; k++) { g.beginPath(); g.arc(Math.cos(k * 1.256) * 7, Math.sin(k * 1.256) * 7, 6, 0, 7); g.fill(); }
        g.fillStyle = "#ffd166"; g.beginPath(); g.arc(0, 0, 5, 0, 7); g.fill(); g.fillStyle = accent;
      } else {
        g.beginPath(); g.arc(0, 0, 9, 0, 7); g.fill();
      }
      g.restore();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  return tex;
}

function clothMat(color, pattern, accent) {
  const map = fabric(color, pattern, accent);
  return map ? mat(0xffffff, { map }) : mat(color);
}

// ---------------------------------------------------------------- face
/** Big shiny cartoon eyes, blush, nose and a mouth that opens for lip-sync. */
function addFace(head, rig, { r = 0.5, eyeY = 0.08, eyeX = 0.17, eyeSize = 1, skin = "#ffd7b5", nose = true, mouthY = -0.17, eyeColor = "#3b2416", blush = true, lashes = false }) {
  const face = new THREE.Group();
  const white = mat("#ffffff", { roughness: 0.25 });
  const iris = mat(eyeColor, { roughness: 0.3 });
  const black = mat("#111111", { roughness: 0.2 });
  rig.eyes = [];
  for (const side of [-1, 1]) {
    const eye = new THREE.Group();
    eye.position.set(side * eyeX * (r / 0.5), eyeY * (r / 0.5), r * 0.86);
    eye.add(ball(0.115 * eyeSize * (r / 0.5), white, 0, 0, 0, 0.9, 1.1, 0.55));
    eye.add(ball(0.078 * eyeSize * (r / 0.5), iris, 0, -0.005, 0.045 * (r / 0.5), 1, 1, 0.5));
    eye.add(ball(0.045 * eyeSize * (r / 0.5), black, 0, -0.005, 0.07 * (r / 0.5), 1, 1, 0.5));
    eye.add(ball(0.022 * eyeSize * (r / 0.5), white, 0.03 * (r / 0.5), 0.035 * (r / 0.5), 0.09 * (r / 0.5), 1, 1, 0.5));
    if (lashes) {
      const lash = mat("#222222");
      for (let k = 0; k < 3; k++) {
        const l = cyl(0.006, 0.006, 0.07 * (r / 0.5), lash, 6);
        l.position.set(side * (0.05 + k * 0.03) * (r / 0.5), 0.12 * (r / 0.5), 0.03);
        l.rotation.z = -side * (0.5 + k * 0.3);
        eye.add(l);
      }
    }
    face.add(eye);
    rig.eyes.push(eye);
  }
  if (blush) {
    const pink = mat("#ff8fa3", { transparent: true, opacity: 0.55 });
    for (const side of [-1, 1]) face.add(ball(0.075 * (r / 0.5), pink, side * 0.3 * (r / 0.5), -0.08 * (r / 0.5), r * 0.8, 1.2, 0.7, 0.3));
  }
  if (nose) face.add(ball(0.045 * (r / 0.5), mat(new THREE.Color(skin).multiplyScalar(0.92)), 0, -0.04 * (r / 0.5), r * 0.98));
  // mouth: a dark oval that opens, a tongue, and a smile line shown when closed
  const mouth = new THREE.Group();
  mouth.position.set(0, mouthY * (r / 0.5), r * 0.9);
  const inside = ball(0.085 * (r / 0.5), mat("#5a1a24", { roughness: 0.6 }), 0, 0, 0, 1.25, 1, 0.45);
  const tongue = ball(0.05 * (r / 0.5), mat("#ff6b81"), 0, -0.035 * (r / 0.5), 0.01, 1.2, 0.6, 0.4);
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.075 * (r / 0.5), 0.014 * (r / 0.5), 8, 24, Math.PI), mat("#5a1a24"));
  smile.rotation.z = Math.PI;
  smile.position.z = 0.02;
  mouth.add(inside, tongue, smile);
  face.add(mouth);
  rig.mouth = { group: mouth, inside, tongue, smile };
  head.add(face);
  return face;
}

// ---------------------------------------------------------------- hair & hats
function addHair(head, spec, r) {
  const hair = mat(spec.hairColor, { roughness: 0.7 });
  const style = spec.hair;
  const k = r / 0.5;
  if (style === "bald") return;
  if (style === "grandpa") {
    for (const side of [-1, 1]) head.add(ball(0.17 * k, hair, side * 0.42 * k, 0.02, -0.08 * k, 0.8, 1, 1));
    return;
  }
  // cap of hair over the top and back
  const cap = new THREE.Mesh(new THREE.SphereGeometry(r * 1.04, 40, 24, 0, Math.PI * 2, 0, Math.PI * 0.52), hair);
  cap.rotation.x = -0.32;
  cap.position.set(0, 0.02 * k, -0.03 * k);
  cap.castShadow = true;
  head.add(cap);
  const rand = rng(style + spec.hairColor);
  if (style === "curly") {
    for (let i = 0; i < 26; i++) {
      const a = rand() * Math.PI * 2, e = rand() * 1.1 + 0.1;
      const x = Math.cos(a) * Math.sin(e) * r * 1.02, y = Math.cos(e) * r * 1.0, z = Math.sin(a) * Math.sin(e) * r * 1.02 - 0.05 * k;
      if (z > 0.25 * k && y < 0.3 * k) continue; // keep the face clear
      head.add(ball((0.11 + rand() * 0.05) * k, hair, x, y, z, 1, 1, 1, true));
    }
  } else if (style === "pigtails" || style === "braids") {
    for (const side of [-1, 1]) {
      head.add(ball(0.17 * k, hair, side * 0.52 * k, -0.02 * k, -0.08 * k, 0.9, 1.2, 0.9));
      head.add(ball(0.07 * k, mat(spec.accent || "#ff6b9a"), side * 0.45 * k, 0.12 * k, -0.06 * k));
    }
  } else if (style === "ponytail") {
    const tail = capsule(0.12 * k, 0.35 * k, hair);
    tail.position.set(0, -0.05 * k, -0.52 * k); tail.rotation.x = 0.5;
    head.add(tail);
    head.add(ball(0.06 * k, mat(spec.accent || "#ff6b9a"), 0, 0.12 * k, -0.5 * k));
  } else if (style === "bun") {
    head.add(ball(0.17 * k, hair, 0, 0.5 * k, -0.15 * k));
  } else if (style === "long") {
    const back = ball(0.5 * k, hair, 0, -0.18 * k, -0.18 * k, 1.05, 1.15, 0.7);
    head.add(back);
  } else if (style === "spiky") {
    for (let i = 0; i < 7; i++) {
      const c = cone(0.09 * k, 0.28 * k, hair, 10);
      const a = -1.2 + (i / 6) * 2.4;
      c.position.set(Math.sin(a) * 0.32 * k, 0.45 * k, Math.cos(a) * 0.05 * k - 0.1 * k);
      c.rotation.z = -a * 0.6;
      head.add(c);
    }
  } else if (style === "messy") {
    for (let i = 0; i < 9; i++) head.add(ball(0.1 * k, hair, (rand() - 0.5) * 0.6 * k, 0.4 * k + rand() * 0.08 * k, (rand() - 0.6) * 0.4 * k, 1, 0.8, 1, true));
  } else {
    // short: a little fringe
    head.add(ball(0.2 * k, hair, -0.12 * k, 0.33 * k, 0.3 * k, 1.3, 0.55, 0.7));
  }
}

function addHat(head, spec, r) {
  const k = r / 0.5;
  const c = spec.hatColor;
  const top = new THREE.Group();
  top.position.y = 0.42 * k;
  switch (spec.hat) {
    case "cap": {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.52 * k, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat(c));
      dome.position.y = -0.05 * k; dome.castShadow = true;
      const brim = cyl(0.3 * k, 0.3 * k, 0.03 * k, mat(c));
      brim.scale.set(1, 1, 0.8); brim.position.set(0, -0.06 * k, 0.4 * k);
      top.add(dome, brim);
      break;
    }
    case "straw": case "sunhat": {
      const brim = cyl(0.85 * k, 0.85 * k, 0.04 * k, mat(c, { roughness: 0.9 }));
      const crown = cyl(0.4 * k, 0.45 * k, 0.3 * k, mat(c, { roughness: 0.9 }));
      crown.position.y = 0.13 * k;
      const band = cyl(0.455 * k, 0.455 * k, 0.07 * k, mat(spec.accent || "#e63946"));
      band.position.y = 0.03 * k;
      top.add(brim, crown, band);
      top.rotation.x = -0.12;
      break;
    }
    case "crown": {
      const ring = cyl(0.3 * k, 0.32 * k, 0.16 * k, mat("#ffcf33", { metalness: 0.6, roughness: 0.3 }), 24);
      top.add(ring);
      for (let i = 0; i < 5; i++) {
        const sp = cone(0.06 * k, 0.16 * k, mat("#ffcf33", { metalness: 0.6, roughness: 0.3 }), 8);
        const a = (i / 5) * Math.PI * 2;
        sp.position.set(Math.sin(a) * 0.3 * k, 0.14 * k, Math.cos(a) * 0.3 * k);
        top.add(sp);
      }
      top.position.y = 0.48 * k;
      break;
    }
    case "tall": {
      const h = cyl(0.36 * k, 0.4 * k, 0.75 * k, mat(c, { roughness: 0.9 }));
      h.position.y = 0.3 * k;
      top.add(h);
      break;
    }
    case "santa": {
      const h = cone(0.45 * k, 0.75 * k, mat("#d62828"));
      h.position.y = 0.3 * k; h.rotation.z = 0.25;
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.44 * k, 0.08 * k, 12, 32), mat("#ffffff", { roughness: 0.9 }));
      rim.rotation.x = Math.PI / 2;
      top.add(h, rim, ball(0.1 * k, mat("#ffffff"), -0.2 * k, 0.62 * k, 0));
      break;
    }
    case "headphones": {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.53 * k, 0.04 * k, 10, 32, Math.PI), mat(c));
      band.position.y = -0.4 * k;
      top.add(band);
      for (const s of [-1, 1]) top.add(ball(0.13 * k, mat(c), s * 0.53 * k, -0.42 * k, 0, 0.6, 1, 1));
      break;
    }
    default: return;
  }
  head.add(top);
}

function addGlasses(head, r) {
  const k = r / 0.5;
  const frame = mat("#333333", { roughness: 0.3 });
  for (const s of [-1, 1]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.11 * k, 0.015 * k, 8, 24), frame);
    ring.position.set(s * 0.17 * k, 0.08 * k, 0.5 * k);
    head.add(ring);
  }
  const bridge = cyl(0.012 * k, 0.012 * k, 0.12 * k, frame, 6);
  bridge.rotation.z = Math.PI / 2; bridge.position.set(0, 0.1 * k, 0.52 * k);
  head.add(bridge);
}

function addBeard(head, color, r) {
  const k = r / 0.5;
  const m = mat(color, { roughness: 0.9 });
  const rand = rng("beard" + color);
  for (let i = 0; i < 14; i++) {
    const a = -1.2 + (i / 13) * 2.4;
    head.add(ball((0.13 + rand() * 0.04) * k, m, Math.sin(a) * 0.36 * k, -0.28 * k - Math.cos(a) * 0.12 * k, Math.cos(a) * 0.3 * k, 1, 1, 0.8, true));
  }
  head.add(ball(0.11 * k, m, -0.09 * k, -0.1 * k, 0.47 * k, 1.3, 0.55, 0.6)); // moustache
  head.add(ball(0.11 * k, m, 0.09 * k, -0.1 * k, 0.47 * k, 1.3, 0.55, 0.6));
}

// ---------------------------------------------------------------- bodies
/** Shared chibi body: torso, arms with hands, legs with shoes. Returns the rig. */
function humanoidBody(root, rig, { outfit, outfitPattern, accent, skin, legColor, shoe, dress, height = 1, arms = "skin", torsoW = 1, tail }) {
  const s = height;
  const body = new THREE.Group();
  root.add(body);
  rig.body = body;
  const top = clothMat(outfit, outfitPattern, accent);
  if (dress) {
    const skirt = cyl(0.27 * s, 0.52 * s * torsoW, 0.6 * s, top);
    skirt.position.y = 0.62 * s;
    body.add(skirt);
    body.add(ball(0.3 * s * torsoW, top, 0, 0.98 * s, 0, 1, 0.9, 0.85));
  } else {
    const torso = capsule(0.33 * s * torsoW, 0.32 * s, top);
    torso.position.y = 0.82 * s; torso.scale.z = 0.85;
    body.add(torso);
  }
  // legs + shoes
  rig.legs = [];
  for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(side * 0.15 * s, 0.48 * s, 0);
    const l = capsule(0.1 * s, 0.24 * s, mat(legColor));
    l.position.y = -0.2 * s;
    leg.add(l);
    leg.add(ball(0.12 * s, mat(shoe, { roughness: 0.4 }), 0, -0.4 * s, 0.05 * s, 1, 0.7, 1.4));
    body.add(leg);
    rig.legs.push(leg);
  }
  // arms (pivot at the shoulder)
  rig.arms = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(side * 0.36 * s * torsoW, 1.08 * s, 0);
    const a = capsule(0.085 * s, 0.32 * s, arms === "skin" ? mat(outfit) : mat(arms));
    a.position.y = -0.22 * s;
    arm.add(a);
    arm.add(ball(0.1 * s, mat(skin), 0, -0.45 * s, 0));
    arm.rotation.z = side * 0.18;
    body.add(arm);
    rig.arms.push(arm);
  }
  if (tail) body.add(tail);
  // head pivot at the neck
  const neck = new THREE.Group();
  neck.position.y = 1.18 * s;
  body.add(neck);
  rig.neck = neck;
  return body;
}

// ---------------------------------------------------------------- builders
const SKIN_TONES = ["#ffe0c4", "#f5c9a3", "#e8b48a", "#c68b5c", "#a4693f", "#7a4a2a"];

function buildPerson(spec, rig) {
  const root = rig.root;
  const grown = ["woman", "man", "grandma", "grandpa"].includes(spec.kind);
  const s = grown ? 1.18 : spec.kind === "baby" ? 0.8 : 1;
  const headR = grown ? 0.46 : 0.52;
  const outfitIsDress = spec.outfitType === "dress" || (spec.kind === "girl" && !spec.outfitType && spec.dress !== false);
  humanoidBody(root, rig, {
    outfit: spec.outfitColor, outfitPattern: spec.pattern, accent: spec.accent, skin: spec.skin,
    legColor: spec.outfitType === "overalls" || spec.outfitType === "pajamas" ? spec.outfitColor : outfitIsDress ? spec.skin : spec.pantsColor,
    shoe: spec.shoeColor, dress: outfitIsDress, height: s,
    arms: spec.outfitType === "overalls" ? spec.shirtColor : "skin",
  });
  if (spec.outfitType === "overalls") {
    // shirt under the bib and two straps
    const bib = new THREE.Mesh(new THREE.BoxGeometry(0.34 * s, 0.26 * s, 0.05 * s), mat(spec.outfitColor));
    bib.position.set(0, 0.98 * s, 0.27 * s);
    rig.body.add(bib);
    rig.body.add(ball(0.33 * s, mat(spec.shirtColor), 0, 1.06 * s, 0, 1, 0.45, 0.85));
  }
  if (spec.outfitType === "lifejacket") {
    for (const side of [-1, 1]) {
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.2 * s, 0.42 * s, 0.12 * s), mat(spec.outfitColor));
      pad.position.set(side * 0.14 * s, 0.88 * s, 0.24 * s);
      rig.body.add(pad);
    }
  }
  if (spec.apron) {
    const ap = new THREE.Mesh(new THREE.BoxGeometry(0.42 * s, 0.5 * s, 0.03 * s), clothMat(spec.apronColor || "#ffffff", "flowers", "#ff8fab"));
    ap.position.set(0, 0.75 * s, 0.3 * s); ap.rotation.x = -0.08;
    rig.body.add(ap);
  }
  const head = new THREE.Group();
  head.add(ball(headR, mat(spec.skin, { roughness: 0.55 })));
  for (const side of [-1, 1]) head.add(ball(0.09 * (headR / 0.5), mat(spec.skin), side * headR * 0.98, -0.02, 0, 0.6, 1, 0.8)); // ears
  head.position.y = headR * 0.85;
  rig.neck.add(head);
  rig.head = head;
  addFace(head, rig, { r: headR, skin: spec.skin, eyeColor: spec.eyeColor, lashes: ["girl", "woman", "grandma"].includes(spec.kind) });
  addHair(head, spec, headR);
  if (spec.beard) addBeard(head, spec.beardColor || spec.hairColor, headR);
  if (spec.glasses) addGlasses(head, headR);
  addHat(head, spec, headR);
  if (spec.bow) head.add(ball(0.09, mat(spec.accent || "#ff5d8f"), 0.3, 0.38, 0.12, 1.6, 0.9, 0.7));
}

const ANIMALS = {
  cat: { fur: "#f4a259", belly: "#ffe8cc" }, dog: { fur: "#c9a27e", belly: "#f5e6d3" }, bunny: { fur: "#f2f2f2", belly: "#ffffff" },
  bear: { fur: "#a0703f", belly: "#e7c9a0" }, cow: { fur: "#ffffff", belly: "#ffffff" }, sheep: { fur: "#fbfbf7", belly: "#fbfbf7" },
  pig: { fur: "#ffb3c6", belly: "#ffc8d7" }, frog: { fur: "#7bc950", belly: "#d9f2b4" }, duck: { fur: "#ffd93d", belly: "#fff1a8" },
  lion: { fur: "#f1b24a", belly: "#ffe3a3" }, elephant: { fur: "#a9b4c2", belly: "#c7d0db" }, monkey: { fur: "#8d5a3b", belly: "#f1c9a5" },
  fox: { fur: "#f27a1a", belly: "#ffffff" }, penguin: { fur: "#2b2d42", belly: "#ffffff" }, owl: { fur: "#a47148", belly: "#f3d9b1" },
  mouse: { fur: "#b8b8c8", belly: "#f1f1f5" },
};

function buildAnimal(spec, rig) {
  const kind = spec.kind;
  const base = ANIMALS[kind];
  const fur = spec.mainColor || base.fur;
  const belly = base.belly;
  const furMat = kind === "cow" ? clothMat(fur, "spots") : mat(fur, { roughness: kind === "sheep" ? 0.95 : 0.6 });
  const birdlike = kind === "duck" || kind === "penguin" || kind === "owl";
  let tail = null;
  if (["cat", "dog", "fox", "monkey", "lion", "cow", "mouse"].includes(kind)) {
    tail = capsule(0.06, 0.45, kind === "fox" ? mat(fur) : furMat);
    tail.position.set(0, 0.55, -0.32); tail.rotation.x = -0.9;
    if (kind === "fox") tail.add(ball(0.09, mat("#ffffff"), 0, 0.3, 0));
  } else if (kind === "pig") {
    tail = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.025, 8, 16, Math.PI * 1.6), mat(fur));
    tail.position.set(0, 0.55, -0.34);
  } else if (kind === "bunny" || kind === "bear" || kind === "sheep") {
    tail = ball(0.1, mat(kind === "bear" ? fur : "#ffffff"), 0, 0.5, -0.33);
  }
  humanoidBody(rig.root, rig, {
    outfit: fur, skin: kind === "duck" ? "#ffd93d" : fur, legColor: fur, shoe: birdlike || kind === "duck" ? "#ff9f1c" : new THREE.Color(fur).multiplyScalar(0.75).getStyle(),
    height: 0.95, tail, torsoW: kind === "penguin" || kind === "owl" ? 1.15 : 1, arms: fur,
  });
  // belly patch / clothing
  rig.body.children[0].material = furMat;
  if (spec.outfitType && spec.outfitColor) {
    const coat = capsule(0.335, 0.2, clothMat(spec.outfitColor, spec.pattern, spec.accent));
    coat.position.y = 0.86; coat.scale.z = 0.88;
    rig.body.add(coat);
  } else {
    rig.body.add(ball(0.25, mat(belly), 0, 0.78, 0.15, 1, 1.15, 0.6));
  }
  if (kind === "sheep") {
    const wool = mat("#ffffff", { roughness: 1 });
    const r = rng("wool");
    for (let i = 0; i < 18; i++) {
      const a = r() * Math.PI * 2, y = 0.55 + r() * 0.6;
      rig.body.add(ball(0.13 + r() * 0.05, wool, Math.cos(a) * 0.3, y, Math.sin(a) * 0.26, 1, 1, 1, true));
    }
  }
  if (kind === "cow" && spec.bell !== false) {
    rig.body.add(ball(0.08, mat("#ffcf33", { metalness: 0.7, roughness: 0.25 }), 0, 1.08, 0.3));
  }
  // head
  const headR = kind === "frog" ? 0.5 : 0.48;
  const headColor = kind === "sheep" ? "#f3e2cf" : fur;
  const head = new THREE.Group();
  head.add(ball(headR, kind === "cow" ? furMat : mat(headColor), 0, 0, 0, kind === "frog" ? 1.25 : 1, kind === "frog" ? 0.8 : 1, 1));
  head.position.y = headR * 0.85;
  rig.neck.add(head);
  rig.head = head;
  const snout = (color, y = -0.12, w = 1.2, z = 0.4) => head.add(ball(0.2, mat(color), 0, y, z, w, 0.8, 0.7));
  const ears = (fn) => { for (const s of [-1, 1]) fn(s); };
  let mouthY = -0.2, eyeY = 0.1, nose = false;
  switch (kind) {
    case "cat": case "fox": case "mouse":
      ears((s) => {
        if (kind === "mouse") { head.add(ball(0.2, mat(fur), s * 0.36, 0.38, -0.05, 1, 1, 0.35)); head.add(ball(0.13, mat("#ffb3c6"), s * 0.36, 0.38, -0.02, 1, 1, 0.3)); return; }
        const e = cone(0.15, 0.3, mat(fur), 4); e.position.set(s * 0.3, 0.45, 0); e.rotation.z = -s * 0.35; head.add(e);
        const inner = cone(0.08, 0.18, mat("#ffb3c6"), 4); inner.position.set(s * 0.3, 0.43, 0.06); inner.rotation.z = -s * 0.35; head.add(inner);
      });
      snout(kind === "fox" ? "#ffffff" : belly, -0.14, 1.1, 0.38);
      head.add(ball(0.05, mat("#ff6b81"), 0, -0.06, 0.52));
      ears((s) => { for (let k = 0; k < 2; k++) { const w = cyl(0.006, 0.006, 0.32, mat("#555555"), 4); w.rotation.z = Math.PI / 2 + s * (0.1 - k * 0.2); w.position.set(s * 0.3, -0.12 - k * 0.04, 0.42); head.add(w); } });
      mouthY = -0.24;
      break;
    case "dog":
      ears((s) => head.add(ball(0.18, mat(new THREE.Color(fur).multiplyScalar(0.7)), s * 0.45, -0.02, -0.02, 0.5, 1.4, 0.8)));
      snout(belly, -0.15, 1.2, 0.36);
      head.add(ball(0.07, mat("#222222", { roughness: 0.2 }), 0, -0.05, 0.53, 1.2, 0.9, 1));
      mouthY = -0.27;
      break;
    case "bunny":
      ears((s) => { const e = capsule(0.08, 0.45, mat(fur)); e.position.set(s * 0.17, 0.68, -0.04); e.rotation.z = -s * 0.15; head.add(e); const i = capsule(0.045, 0.38, mat("#ffb3c6")); i.position.set(s * 0.17, 0.68, 0.02); i.rotation.z = -s * 0.15; head.add(i); });
      snout("#ffffff", -0.15, 1.1, 0.36);
      head.add(ball(0.045, mat("#ff8fa3"), 0, -0.06, 0.52));
      mouthY = -0.25;
      break;
    case "bear": case "monkey": case "lion":
      if (kind === "lion") {
        const mane = mat("#c8691c", { roughness: 0.9 });
        for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; head.add(ball(0.17, mane, Math.cos(a) * 0.5, Math.sin(a) * 0.5, -0.12, 1, 1, 0.8, true)); }
      }
      ears((s) => { head.add(ball(0.15, mat(fur), s * 0.38, kind === "monkey" ? 0.02 : 0.36, -0.02, 1, 1, 0.6)); head.add(ball(0.08, mat(belly), s * 0.38, kind === "monkey" ? 0.02 : 0.36, 0.04, 1, 1, 0.4)); });
      if (kind === "monkey") head.add(ball(0.36, mat(belly), 0, -0.05, 0.2, 1.05, 0.95, 0.75));
      snout(belly, -0.15, 1.15, 0.36);
      head.add(ball(0.06, mat("#2b2b2b", { roughness: 0.2 }), 0, -0.06, 0.53, 1.3, 0.9, 1));
      mouthY = -0.26;
      break;
    case "cow":
      ears((s) => { head.add(ball(0.12, mat(fur), s * 0.5, 0.12, 0, 1.4, 0.6, 0.6)); const h = cone(0.05, 0.2, mat("#f5e6c8"), 12); h.position.set(s * 0.25, 0.48, -0.05); h.rotation.z = -s * 0.4; head.add(h); });
      head.add(ball(0.22, mat("#ffb3c6"), 0, -0.2, 0.36, 1.35, 0.85, 0.75));
      ears((s) => head.add(ball(0.03, mat("#8a4b5a"), s * 0.09, -0.16, 0.54)));
      mouthY = -0.3; eyeY = 0.14;
      break;
    case "sheep":
      for (let i = 0; i < 7; i++) { const a = -1 + (i / 6) * 2; head.add(ball(0.13, mat("#ffffff", { roughness: 1 }), Math.sin(a) * 0.3, 0.42, Math.cos(a) * 0.1, 1, 1, 1, true)); }
      ears((s) => head.add(ball(0.12, mat("#f3e2cf"), s * 0.5, 0.05, -0.02, 1.4, 0.55, 0.6)));
      nose = true;
      break;
    case "pig":
      ears((s) => { const e = cone(0.13, 0.22, mat(fur), 4); e.position.set(s * 0.3, 0.44, 0); e.rotation.z = -s * 0.5; head.add(e); });
      { const sn = cyl(0.13, 0.14, 0.12, mat("#ff8fab"), 24); sn.rotation.x = Math.PI / 2; sn.position.set(0, -0.08, 0.5); head.add(sn); }
      ears((s) => head.add(ball(0.03, mat("#a64d69"), s * 0.05, -0.08, 0.57)));
      mouthY = -0.27;
      break;
    case "frog":
      ears((s) => { head.add(ball(0.18, mat(fur), s * 0.26, 0.35, 0.1)); });
      eyeY = 0.42; mouthY = -0.12;
      break;
    case "duck": case "penguin": case "owl": {
      const beak = cone(0.09, 0.22, mat("#ff9f1c"), 16);
      beak.rotation.x = Math.PI / 2; beak.position.set(0, -0.06, 0.55);
      head.add(beak);
      if (kind === "penguin") head.add(ball(0.42, mat("#ffffff"), 0, -0.04, 0.12, 0.9, 0.85, 0.85));
      if (kind === "owl") ears((s) => { const e = cone(0.1, 0.22, mat(fur), 4); e.position.set(s * 0.3, 0.45, 0); head.add(e); });
      if (kind === "duck") head.add(ball(0.12, mat("#ffd93d"), 0.05, 0.52, -0.05, 0.6, 1.2, 0.6)); // tuft
      mouthY = -0.2;
      break;
    }
    case "elephant":
      ears((s) => head.add(ball(0.36, mat(fur), s * 0.55, 0.02, -0.08, 0.35, 1, 1)));
      { const trunk = capsule(0.09, 0.35, mat(fur)); trunk.position.set(0, -0.3, 0.48); trunk.rotation.x = 0.35; head.add(trunk); }
      mouthY = -0.3;
      break;
  }
  addFace(head, rig, { r: headR, eyeY: eyeY * (0.5 / headR) * 0.8, skin: headColor, nose, mouthY: mouthY * 0.9, eyeColor: "#1d1d1d", eyeSize: kind === "owl" ? 1.5 : 1.05 });
  if (birdlike && kind !== "owl") rig.mouth.group.position.z += 0.06;
  addHat(head, spec, headR);
  if (spec.glasses) addGlasses(head, headR);
}

/** Moon, star, sun, cloud: floating friends with faces. */
function buildObject(spec, rig) {
  const root = rig.root;
  const body = new THREE.Group();
  root.add(body);
  rig.body = body;
  rig.floating = true;
  const head = new THREE.Group();
  body.add(head);
  rig.head = head;
  rig.neck = body;
  const glow = (c) => mat(c, { emissive: c, emissiveIntensity: 0.35, roughness: 0.6 });
  let r = 0.75;
  switch (spec.kind) {
    case "moon":
      head.add(ball(r, glow(spec.mainColor || "#ffe9a8")));
      for (const [x, y, s] of [[-0.35, 0.35, 0.12], [0.4, 0.25, 0.09], [0.3, -0.45, 0.1]]) head.add(ball(s, mat("#e8cf86"), x, y, 0.62, 1, 1, 0.4));
      break;
    case "star": {
      const shape = new THREE.Shape();
      for (let k = 0; k < 10; k++) { const a = (k * Math.PI) / 5 + Math.PI / 2, rr = k % 2 ? 0.42 : 0.95; k ? shape.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : shape.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      const g = new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: true, bevelThickness: 0.15, bevelSize: 0.12, bevelSegments: 6 });
      g.translate(0, 0, -0.15);
      const m = new THREE.Mesh(g, glow(spec.mainColor || "#ffd23f"));
      m.castShadow = true;
      head.add(m);
      r = 0.5;
      break;
    }
    case "sun":
      head.add(ball(r, glow(spec.mainColor || "#ffbe0b")));
      for (let k = 0; k < 12; k++) { const c = cone(0.12, 0.35, glow("#ffd166"), 12); const a = (k / 12) * Math.PI * 2; c.position.set(Math.cos(a) * 0.95, Math.sin(a) * 0.95, -0.1); c.rotation.z = a - Math.PI / 2; head.add(c); }
      break;
    case "cloud":
      for (const [x, y, s] of [[0, 0, 0.6], [-0.55, -0.12, 0.45], [0.55, -0.1, 0.45], [-0.25, 0.3, 0.42], [0.3, 0.28, 0.4]]) head.add(ball(s, mat(spec.mainColor || "#ffffff", { roughness: 0.9 }), x, y, 0, 1, 1, 0.75, true));
      r = 0.6;
      break;
  }
  addFace(head, rig, { r: spec.kind === "star" ? 0.5 : r, eyeY: 0.1, skin: "#ffe08a", nose: false, mouthY: -0.22, eyeColor: "#2b2b2b" });
  if (spec.kind === "star") rig.mouth.group.position.z = 0.32, rig.eyes.forEach((e) => (e.position.z = 0.3));
  if (spec.hat && spec.hat !== "none") addHat(head, spec, r * 0.7);
  head.position.y = 1.5;
  rig.arms = []; rig.legs = [];
}

function buildRobot(spec, rig) {
  const root = rig.root;
  const shell = mat(spec.mainColor || "#e9eef5", { metalness: 0.3, roughness: 0.35 });
  const accent = mat(spec.accent || "#4cc9f0", { emissive: spec.accent || "#4cc9f0", emissiveIntensity: 0.6 });
  humanoidBody(root, rig, { outfit: spec.mainColor || "#e9eef5", skin: "#cfd8e3", legColor: "#b8c2cf", shoe: "#8d99ae", height: 1, arms: "#cfd8e3" });
  rig.body.children[0].material = shell;
  rig.body.add(ball(0.12, accent, 0, 0.88, 0.3, 1, 1, 0.4));
  const head = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.75, 0.75, 4, 4, 4), shell);
  box.castShadow = true;
  head.add(box);
  const screen = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.5, 0.05), mat("#1b263b", { roughness: 0.2 }));
  screen.position.z = 0.38;
  head.add(screen);
  const ant = cyl(0.02, 0.02, 0.3, shell, 8); ant.position.y = 0.5; head.add(ant);
  head.add(ball(0.07, accent, 0, 0.68, 0));
  for (const s of [-1, 1]) head.add(cyl(0.1, 0.1, 0.1, accent, 16).rotateZ(Math.PI / 2).translateY(s * 0.48));
  head.position.y = 0.45;
  rig.neck.add(head);
  rig.head = head;
  // glowing screen eyes and mouth
  rig.eyes = [];
  for (const s of [-1, 1]) { const e = new THREE.Group(); e.position.set(s * 0.17, 0.06, 0.42); e.add(ball(0.08, accent, 0, 0, 0, 1, 1, 0.3)); head.add(e); rig.eyes.push(e); }
  const mouth = new THREE.Group(); mouth.position.set(0, -0.12, 0.42);
  const inside = ball(0.08, accent, 0, 0, 0, 1.6, 1, 0.3);
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.015, 8, 20, Math.PI), accent); smile.rotation.z = Math.PI;
  mouth.add(inside, smile);
  head.add(mouth);
  rig.mouth = { group: mouth, inside, tongue: null, smile };
}

function buildMonster(spec, rig) {
  const fur = spec.mainColor || "#9b5de5";
  humanoidBody(rig.root, rig, { outfit: fur, skin: fur, legColor: fur, shoe: new THREE.Color(fur).multiplyScalar(0.6).getStyle(), height: 1.05, torsoW: 1.2, arms: fur });
  const head = new THREE.Group();
  head.add(ball(0.55, mat(fur, { roughness: 0.95 })));
  const r = rng("monster" + fur);
  for (let i = 0; i < 20; i++) { const a = r() * Math.PI * 2, e = r() * 1.3; head.add(ball(0.08, mat(fur, { roughness: 1 }), Math.cos(a) * Math.sin(e) * 0.55, Math.cos(e) * 0.55, Math.sin(a) * Math.sin(e) * 0.5 - 0.1, 1, 1, 1, true)); }
  const horn = cone(0.08, 0.3, mat("#ffe8a3"), 12); horn.position.set(0, 0.62, 0); head.add(horn);
  head.position.y = 0.48;
  rig.neck.add(head);
  rig.head = head;
  addFace(head, rig, { r: 0.55, eyeY: 0.12, eyeX: 0.15, eyeSize: 1.35, skin: fur, nose: false, mouthY: -0.22, eyeColor: "#2d6a4f" });
}

function buildTooth(spec, rig) {
  humanoidBody(rig.root, rig, { outfit: "#ffffff", skin: "#ffffff", legColor: "#f1f1f1", shoe: "#4cc9f0", height: 0.9 });
  const head = new THREE.Group();
  head.add(ball(0.55, mat("#ffffff", { roughness: 0.25 }), 0, 0, 0, 1, 1.05, 0.95));
  head.position.y = 0.45;
  rig.neck.add(head);
  rig.head = head;
  addFace(head, rig, { r: 0.55, skin: "#ffffff", nose: false, eyeColor: "#4361ee" });
}

/**
 * Build a character from a spec (see parse.js). Returns the rig:
 * { root, body, neck, head, arms[], legs[], eyes[], mouth, floating, spec, height }.
 */
export function buildCharacter(spec) {
  const root = new THREE.Group();
  const rig = { root, spec, seed: rng(spec.name || spec.kind)() * 10 };
  if (["girl", "boy", "baby", "woman", "man", "grandma", "grandpa"].includes(spec.kind)) buildPerson(spec, rig);
  else if (ANIMALS[spec.kind]) buildAnimal(spec, rig);
  else if (["moon", "star", "sun", "cloud"].includes(spec.kind)) buildObject(spec, rig);
  else if (spec.kind === "robot") buildRobot(spec, rig);
  else if (spec.kind === "tooth") buildTooth(spec, rig);
  else buildMonster(spec, rig);
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
  return rig;
}

export { SKIN_TONES, ANIMALS };
