// 3D settings (sets) built from simple shapes: bedroom, night sky, farm, river,
// town with a bridge, classroom, beach, forest, space and a party stage.
import * as THREE from "three";
import { mat, rng } from "./characters.js";

function mesh(geometry, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
const box = (w, h, d, c, x, y, z, opts) => mesh(new THREE.BoxGeometry(w, h, d), mat(c, opts), x, y, z);
const sph = (r, c, x, y, z, opts) => mesh(new THREE.SphereGeometry(r, 24, 16), mat(c, opts), x, y, z);
const cyl = (rt, rb, h, c, x, y, z, segs = 24, opts) => mesh(new THREE.CylinderGeometry(rt, rb, h, segs), mat(c, opts), x, y, z);

/** Sky dome with a vertical gradient. */
function sky(top, bottom) {
  const c = document.createElement("canvas");
  c.width = 4; c.height = 256;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, top); grad.addColorStop(0.65, bottom); grad.addColorStop(1, bottom);
  g.fillStyle = grad; g.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(80, 32, 16), new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false }));
  return dome;
}

function ground(color, radius = 40) {
  const g = mesh(new THREE.CircleGeometry(radius, 64), mat(color, { roughness: 0.95 }));
  g.rotation.x = -Math.PI / 2;
  g.castShadow = false;
  return g;
}

function tree(x, z, s = 1, leaf = "#57cc99") {
  const t = new THREE.Group();
  t.add(cyl(0.12 * s, 0.18 * s, 1.2 * s, "#8d5a3b", 0, 0.6 * s, 0, 12));
  for (const [dx, dy, r] of [[0, 1.55, 0.7], [-0.4, 1.25, 0.5], [0.42, 1.3, 0.5], [0, 2.0, 0.45]]) t.add(sph(r * s, leaf, dx * s, dy * s, 0));
  t.position.set(x, 0, z);
  return t;
}

function cloud(x, y, z, s = 1, color = "#ffffff") {
  const c = new THREE.Group();
  for (const [dx, dy, r] of [[0, 0, 0.8], [-0.8, -0.15, 0.6], [0.8, -0.1, 0.6], [0.35, 0.35, 0.55], [-0.4, 0.3, 0.5]]) c.add(sph(r * s, color, dx * s, dy * s, 0, { roughness: 1 }));
  c.position.set(x, y, z);
  c.traverse((o) => (o.castShadow = false));
  return c;
}

function flowers(group, rand, n, area = 9, zMin = -6, zMax = 2.5) {
  const colors = ["#ff5d8f", "#ffd23f", "#c3a6ff", "#ff8c42", "#ffffff"];
  for (let i = 0; i < n; i++) {
    const x = (rand() - 0.5) * area * 2, z = zMin + rand() * (zMax - zMin);
    if (Math.abs(x) < 2.2 && z > -1.5) continue; // keep the stage clear
    const f = new THREE.Group();
    f.add(cyl(0.015, 0.015, 0.3, "#2d6a4f", 0, 0.15, 0, 6));
    f.add(sph(0.08, colors[i % colors.length], 0, 0.32, 0));
    f.add(sph(0.035, "#ffd23f", 0, 0.33, 0.06));
    f.position.set(x, 0, z);
    group.add(f);
  }
}

function stars(group, n, rand, spread = 50, minY = 6) {
  const g = new THREE.SphereGeometry(0.06, 6, 4);
  const m = new THREE.MeshBasicMaterial({ color: "#fff7c2" });
  const inst = new THREE.InstancedMesh(g, m, n);
  const d = new THREE.Object3D();
  for (let i = 0; i < n; i++) {
    const a = rand() * Math.PI * 2, r = 25 + rand() * spread;
    d.position.set(Math.cos(a) * r, minY + rand() * 35, -Math.abs(Math.sin(a) * r) - 10);
    d.scale.setScalar(0.6 + rand() * 1.8);
    d.updateMatrix();
    inst.setMatrixAt(i, d.matrix);
  }
  group.add(inst);
}

function house(x, z, color, roof, s = 1) {
  const h = new THREE.Group();
  h.add(box(1.4 * s, 1.2 * s, 1.2 * s, color, 0, 0.6 * s, 0));
  const r = mesh(new THREE.ConeGeometry(1.15 * s, 0.8 * s, 4), mat(roof), 0, 1.6 * s, 0);
  r.rotation.y = Math.PI / 4;
  h.add(r);
  h.add(box(0.35 * s, 0.55 * s, 0.05, "#7a4a2a", 0, 0.28 * s, 0.61 * s));
  for (const sx of [-0.4, 0.4]) h.add(box(0.28 * s, 0.28 * s, 0.05, "#fff3b0", sx * s, 0.8 * s, 0.61 * s, { emissive: "#fff3b0", emissiveIntensity: 0.3 }));
  h.position.set(x, 0, z);
  return h;
}

function water(color = "#4cc9f0") {
  const w = mesh(new THREE.PlaneGeometry(80, 9, 1, 1), mat(color, { roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.92 }));
  w.rotation.x = -Math.PI / 2;
  w.position.set(0, 0.02, -0.5);
  w.castShadow = false;
  return w;
}

function boat(color = "#e63946") {
  const b = new THREE.Group();
  // rounded rowboat: the bottom half of a stretched sphere, with a wooden rim and seat
  const hull = mesh(new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), mat(color, { side: THREE.DoubleSide, roughness: 0.45 }));
  hull.scale.set(1.9, 0.75, 1.0);
  hull.position.y = 0.55;
  b.add(hull);
  const rim = mesh(new THREE.TorusGeometry(1, 0.07, 10, 48), mat("#c08552"));
  rim.rotation.x = Math.PI / 2; rim.scale.set(1.9, 1.0, 1); rim.position.y = 0.55;
  b.add(rim);
  const inside = mesh(new THREE.CircleGeometry(1, 40), mat("#8d5a3b"));
  inside.rotation.x = -Math.PI / 2; inside.scale.set(1.75, 0.88, 1); inside.position.y = 0.3;
  b.add(inside);
  for (const s of [-1, 1]) {
    const oar = cyl(0.035, 0.035, 2.2, "#c08552", s * 1.55, 0.55, 0.1, 8);
    oar.rotation.z = s * 1.2;
    oar.add(box(0.12, 0.5, 0.04, "#c08552", 0, -1.05, 0));
    b.add(oar);
  }
  return b;
}

/**
 * Build a set. Returns { group, background, fog, night, floor } where floor is
 * the height characters stand on and `inBoat` says they sit in a boat.
 */
export function buildSet(kind, { night = false, boat: withBoat = false, seed = "set" } = {}) {
  const group = new THREE.Group();
  const rand = rng(kind + seed);
  const info = { group, night, floor: 0, kind };

  const daySky = () => group.add(sky("#7cc6fe", "#d9f0ff"));
  const nightSky = () => { group.add(sky("#0b1440", "#3b2f7a")); stars(group, 260, rand); };
  const sunOrMoon = () => {
    if (night) group.add(sph(1.6, "#fff4c2", 14, 14, -40, { emissive: "#fff4c2", emissiveIntensity: 1 }));
    else group.add(sph(2.2, "#ffd166", -16, 16, -45, { emissive: "#ffd166", emissiveIntensity: 1 }));
  };

  switch (kind) {
    case "bedroom": {
      group.add(sky("#ffe5ec", "#ffe5ec"));
      const floor = box(18, 0.2, 14, "#e9c9a3", 0, -0.1, -2, { roughness: 0.8 });
      group.add(floor);
      group.add(box(18, 9, 0.2, "#c8b6ff", 0, 4.4, -6));
      group.add(box(0.2, 9, 12, "#bde0fe", -8, 4.4, -1));
      // window with the night sky
      group.add(box(3.2, 2.4, 0.1, night ? "#1d2b64" : "#a2d2ff", 2.5, 4.2, -5.85, { emissive: night ? "#1d2b64" : "#a2d2ff", emissiveIntensity: 0.6 }));
      for (const [w, h, x, y] of [[3.5, 0.18, 2.5, 5.45], [3.5, 0.18, 2.5, 2.95], [0.18, 2.6, 0.8, 4.2], [0.18, 2.6, 4.2, 4.2], [0.12, 2.4, 2.5, 4.2]]) group.add(box(w, h, 0.25, "#ffffff", x, y, -5.8));
      if (night) for (let i = 0; i < 9; i++) group.add(sph(0.05, "#fff7c2", 1.2 + rand() * 2.6, 3.2 + rand() * 1.9, -5.75, { emissive: "#fff7c2", emissiveIntensity: 1 }));
      // bed
      group.add(box(3.4, 0.6, 2.2, "#ffffff", -4.2, 0.4, -3.6));
      group.add(box(3.3, 0.35, 2.1, "#ff9ebb", -4.2, 0.85, -3.5));
      group.add(box(0.9, 0.35, 1.6, "#ffffff", -5.4, 1.15, -3.6));
      group.add(box(0.25, 1.6, 2.3, "#ffb703", -5.95, 0.8, -3.6));
      // rug, lamp, toys
      const rug = cyl(2.2, 2.2, 0.04, "#ffd6a5", 0, 0.02, -0.5, 48); rug.castShadow = false; group.add(rug);
      group.add(cyl(0.08, 0.12, 1.4, "#ffffff", 5.5, 0.7, -4.5, 12));
      group.add(cyl(0.3, 0.55, 0.6, "#fff3b0", 5.5, 1.6, -4.5, 24, { emissive: "#ffe8a3", emissiveIntensity: night ? 0.9 : 0.2 }));
      for (let i = 0; i < 3; i++) group.add(box(0.4, 0.4, 0.4, ["#ff595e", "#1982c4", "#8ac926"][i], 3.6 + i * 0.45, 0.2 + (i === 1 ? 0.4 : 0), -3.2));
      info.warmLamp = new THREE.Vector3(5.5, 2, -4);
      break;
    }
    case "night": case "space": {
      nightSky();
      if (kind === "space") {
        group.add(sph(3, "#ff8c42", -14, 10, -30, { roughness: 0.8 }));
        const ring = mesh(new THREE.TorusGeometry(4.2, 0.25, 8, 64), mat("#ffd6a5"), -14, 10, -30); ring.rotation.x = 1.2; group.add(ring);
        group.add(sph(1.6, "#4cc9f0", 15, 13, -28));
      }
      // fluffy cloud island under the characters
      const isle = new THREE.Group();
      // puffs sit low around the rim (and behind), so they never hide the characters' legs
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2, front = Math.sin(a) > 0.3;
        isle.add(sph(front ? 0.7 : 1.1 + rand() * 0.5, "#e9e3ff", Math.cos(a) * 3.6, front ? -0.75 : -0.55, Math.sin(a) * 2.4 - 0.8, { roughness: 1 }));
      }
      isle.add(mesh(new THREE.CylinderGeometry(3.8, 3.2, 0.9, 48), mat("#f1edff", { roughness: 1 }), 0, -0.45, -0.6));
      group.add(isle);
      for (let i = 0; i < 6; i++) group.add(cloud((rand() - 0.5) * 40, 2 + rand() * 6, -18 - rand() * 10, 1.5, "#6d5fb3"));
      // little glowing town far below
      for (let i = 0; i < 10; i++) group.add(house((rand() - 0.5) * 50, -40 - rand() * 10, ["#ffcad4", "#bde0fe", "#ffd6a5"][i % 3], "#9d4edd", 2.5).translateY(-9));
      info.night = true;
      break;
    }
    case "river": {
      night ? nightSky() : daySky();
      sunOrMoon();
      group.add(ground(night ? "#2d6a4f" : "#80ed99"));
      // characters stand on the grassy bank; in a boat scene the boat floats right under them
      const river = water(night ? "#2a4d8f" : "#4cc9f0");
      river.position.z = withBoat ? -1.2 : -5.2;
      group.add(river);
      for (let i = 0; i < 7; i++) { const lp = cyl(0.35, 0.35, 0.03, "#52b788", -7 + rand() * 14, 0.05, (withBoat ? -2 : -5.5) - rand() * 3, 20); lp.castShadow = false; group.add(lp); }
      for (let i = 0; i < 10; i++) group.add(tree(-18 + i * 4 + rand() * 2, -9 - rand() * 3, 1 + rand() * 0.4));
      for (let i = 0; i < 6; i++) group.add(cloud(-20 + i * 8, 10 + rand() * 3, -30, 1.6));
      flowers(group, rand, 40, 14, 4, 7);
      if (withBoat) { const b = boat(); b.position.set(0, -0.15, 0.3); group.add(b); info.floor = 0.12; info.inBoat = true; }
      info.waterY = 0.02;
      break;
    }
    case "beach": {
      daySky(); sunOrMoon();
      group.add(ground("#ffe8b0"));
      const sea = water("#3a86ff"); sea.position.z = -12; sea.scale.y = 3; group.add(sea);
      const palm = new THREE.Group();
      const trunk = cyl(0.15, 0.25, 4, "#a47148", 0, 2, 0, 12); trunk.rotation.z = 0.15; palm.add(trunk);
      for (let i = 0; i < 6; i++) { const leaf = sph(0.9, "#2d6a4f", Math.cos(i) * 0.9, 4, Math.sin(i) * 0.9); leaf.scale.set(1.6, 0.2, 0.6); leaf.rotation.y = i; palm.add(leaf); }
      palm.position.set(-6, 0, -3); group.add(palm);
      const umb = new THREE.Group(); umb.add(cyl(0.05, 0.05, 2.6, "#ffffff", 0, 1.3, 0, 8)); umb.add(mesh(new THREE.ConeGeometry(1.6, 0.6, 12), mat("#ff5d8f"), 0, 2.6, 0)); umb.position.set(5.5, 0, -2.5); group.add(umb);
      for (let i = 0; i < 6; i++) group.add(sph(0.12, "#ffcad4", (rand() - 0.5) * 12, 0.05, rand() * 3));
      break;
    }
    case "town": {
      night ? nightSky() : daySky(); sunOrMoon();
      group.add(ground(night ? "#344e41" : "#a7c957"));
      const river = water(night ? "#2a4d8f" : "#4cc9f0"); river.position.z = -5.5; river.scale.y = 0.7; group.add(river);
      // a toy bridge right behind the characters
      group.add(box(14, 0.3, 2.2, "#e9c46a", 0, 1.2, -5.5));
      for (const x of [-5, 0, 5]) group.add(box(0.6, 1.2, 1.6, "#bc6c25", x, 0.6, -5.5));
      for (const x of [-6.5, 6.5]) { group.add(box(1.2, 4, 1.2, "#bc6c25", x, 2, -5.5)); group.add(mesh(new THREE.ConeGeometry(0.9, 1.2, 4), mat("#2a9d8f"), x, 4.6, -5.5)); }
      // clock tower
      group.add(box(1.6, 7, 1.6, "#e9c46a", -10, 3.5, -12));
      group.add(mesh(new THREE.ConeGeometry(1.3, 2, 4), mat("#2a9d8f"), -10, 8, -12));
      group.add(cyl(0.6, 0.6, 0.1, "#ffffff", -10, 5.8, -11.15, 32).rotateX(Math.PI / 2));
      const colors = ["#ff595e", "#ffca3a", "#8ac926", "#1982c4", "#6a4c93", "#ff924c"];
      for (let i = 0; i < 9; i++) group.add(house(-16 + i * 4, -14 - rand() * 3, colors[i % 6], "#7a4a2a", 1.4 + rand() * 0.6));
      for (let i = 0; i < 5; i++) group.add(cloud(-20 + i * 10, 11 + rand() * 3, -30, 1.4));
      break;
    }
    case "classroom": {
      group.add(sky("#fff1e6", "#fff1e6"));
      group.add(box(18, 0.2, 14, "#deb887", 0, -0.1, -2));
      group.add(box(18, 9, 0.2, "#ffd6a5", 0, 4.4, -6));
      group.add(box(6, 2.6, 0.12, "#2d6a4f", 0, 3.6, -5.85));
      group.add(box(6.3, 0.15, 0.2, "#bc6c25", 0, 2.2, -5.8));
      for (const [x, z] of [[-4.5, -2.5], [4.5, -2.5], [-5.5, 0.5], [5.5, 0.5]]) { group.add(box(1.6, 0.12, 1, "#e9c46a", x, 1.0, z)); for (const dx of [-0.65, 0.65]) group.add(box(0.1, 1, 0.1, "#bc6c25", x + dx, 0.5, z)); }
      group.add(sph(0.5, "#3a86ff", 6.5, 2.4, -4.5));
      for (let i = 0; i < 4; i++) group.add(box(0.8, 1, 0.05, ["#ff595e", "#ffca3a", "#8ac926", "#1982c4"][i], -6.5 + i * 1.1, 5.8, -5.85));
      break;
    }
    case "forest": {
      night ? nightSky() : daySky(); sunOrMoon();
      group.add(ground(night ? "#2d6a4f" : "#6fbf73"));
      for (let i = 0; i < 26; i++) { const x = (rand() - 0.5) * 36, z = -4 - rand() * 18; if (Math.abs(x) < 3 && z > -6) continue; group.add(tree(x, z, 1 + rand() * 0.8, ["#57cc99", "#38a3a5", "#80ed99"][i % 3])); }
      for (let i = 0; i < 8; i++) { const m = new THREE.Group(); m.add(cyl(0.08, 0.1, 0.3, "#fff3e0", 0, 0.15, 0, 10)); m.add(mesh(new THREE.SphereGeometry(0.25, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat("#e63946"), 0, 0.28, 0)); m.position.set((rand() - 0.5) * 12, 0, rand() * 3 - 2); if (Math.abs(m.position.x) > 2.2) group.add(m); }
      flowers(group, rand, 30);
      break;
    }
    case "farm": {
      night ? nightSky() : daySky(); sunOrMoon();
      group.add(ground(night ? "#3a7d44" : "#8bd17c"));
      // rolling hills
      for (let i = 0; i < 6; i++) { const h = sph(8 + rand() * 6, night ? "#2f6f3a" : "#74c365", -30 + i * 12, -6, -30 - rand() * 8, { roughness: 1 }); h.castShadow = false; group.add(h); }
      // red barn
      const barn = new THREE.Group();
      barn.add(box(4, 3, 3.2, "#d62828", 0, 1.5, 0));
      const roof = mesh(new THREE.CylinderGeometry(2.4, 2.4, 3.4, 3), mat("#6d4c41"), 0, 3.6, 0); roof.rotation.z = Math.PI / 2; roof.rotation.y = Math.PI / 2; roof.scale.set(1, 1, 0.75); barn.add(roof);
      barn.add(box(1.6, 2, 0.1, "#ffffff", 0, 1, 1.62));
      barn.add(box(1.4, 1.8, 0.12, "#a4161a", 0, 1, 1.63));
      barn.position.set(-6.5, 0, -7); barn.rotation.y = 0.35;
      group.add(barn);
      // fence
      for (let i = 0; i < 14; i++) { const x = 1 + i * 0.9; group.add(box(0.12, 0.8, 0.12, "#f5ebe0", x, 0.4, -5)); }
      for (const y of [0.35, 0.65]) group.add(box(12.6, 0.08, 0.06, "#f5ebe0", 6.85, y, -5));
      for (let i = 0; i < 6; i++) group.add(tree(8 + rand() * 10, -9 - rand() * 6, 0.9 + rand() * 0.6));
      for (let i = 0; i < 5; i++) group.add(cloud(-20 + i * 10, 10 + rand() * 3, -32, 1.5));
      flowers(group, rand, 45);
      break;
    }
    default: {
      // party stage: pastel backdrop, round stage, balloons and confetti
      group.add(sky(night ? "#3c096c" : "#ffc8dd", night ? "#5a189a" : "#bde0fe"));
      const st = cyl(5, 5.2, 0.4, night ? "#7b2cbf" : "#ffafcc", 0, 0.2, -0.5, 64); st.receiveShadow = true; group.add(st);
      info.floor = 0.4;
      group.add(ground(night ? "#240046" : "#cdb4db"));
      for (let i = 0; i < 9; i++) {
        const c = ["#ff595e", "#ffca3a", "#8ac926", "#1982c4", "#6a4c93"][i % 5];
        const x = (i < 5 ? -1 : 1) * (5.5 + (i % 5) * 0.9), y = 3 + rand() * 3, z = -3 - rand() * 3;
        group.add(sph(0.45, c, x, y, z, { roughness: 0.25 }));
        group.add(cyl(0.01, 0.01, 2, "#ffffff", x, y - 1.3, z, 4));
      }
      for (let i = 0; i < 60; i++) group.add(box(0.08, 0.08, 0.01, ["#ff595e", "#ffca3a", "#8ac926", "#1982c4"][i % 4], (rand() - 0.5) * 16, 0.5 + rand() * 7, -2 - rand() * 4));
    }
  }
  group.traverse((o) => { if (o.isMesh && o.material?.map?.isCanvasTexture) o.receiveShadow = false; });
  return info;
}

/** Lights for a set: soft sky light, a key light with shadows, a warm fill on the faces. */
export function lightsFor(info) {
  const g = new THREE.Group();
  const night = info.night;
  g.add(new THREE.HemisphereLight(night ? "#9fb4ff" : "#ffffff", night ? "#2b2d6e" : "#b7d7a8", night ? 1.4 : 1.9));
  const key = new THREE.DirectionalLight(night ? "#c7d2ff" : "#fff2d6", night ? 1.4 : 2.6);
  key.position.set(5, 10, 8);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -10; key.shadow.camera.right = 10; key.shadow.camera.top = 10; key.shadow.camera.bottom = -10;
  key.shadow.bias = -0.0005;
  key.shadow.radius = 4;
  g.add(key);
  // warm light on the faces so characters read clearly, even at night
  const fill = new THREE.PointLight(night ? "#ffd6a5" : "#ffffff", night ? 26 : 14, 18, 1.6);
  fill.position.set(-2, 3.5, 6);
  g.add(fill);
  const rim = new THREE.DirectionalLight(night ? "#b8c0ff" : "#ffe5ec", 1.1);
  rim.position.set(-6, 5, -6);
  g.add(rim);
  return g;
}
