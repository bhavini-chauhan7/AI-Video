// Renders storyboard scenes as 3D cartoons into an offscreen WebGL canvas,
// which the 2D video renderer draws as the scene's background.
import * as THREE from "three";
import { buildCharacter } from "./characters.js";
import { buildSet, lightsFor } from "./sets.js";
import { animate } from "./animate.js";

const FLOATERS = new Set(["moon", "star", "sun", "cloud"]);

export class Stage {
  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: "high-performance" });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.canvas = this.renderer.domElement;
    this.cache = new Map(); // key -> built scene
  }

  setSize(w, h) {
    if (this.w === w && this.h === h) return;
    this.w = w; this.h = h;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
  }

  /** Drop scenes that are no longer used (keeps GPU memory small). */
  keepOnly(keys) {
    for (const [k, v] of this.cache) {
      if (keys.has(k)) continue;
      v.scene.traverse((o) => { o.geometry?.dispose?.(); const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach((x) => { x.map?.dispose?.(); x.dispose?.(); }); });
      this.cache.delete(k);
    }
  }

  build(key, desc) {
    if (this.cache.has(key)) return this.cache.get(key);
    const scene = new THREE.Scene();
    const info = buildSet(desc.set, { night: desc.night, boat: desc.boat, seed: key });
    scene.add(info.group);
    scene.add(lightsFor(info));
    scene.fog = new THREE.Fog(info.night ? "#1b1650" : "#e8f4ff", 22, 70);

    // cast: walkers on the floor (lead in the middle), floaters up in the sky
    const people = desc.characters.filter((c) => !FLOATERS.has(c.spec.kind));
    const floaters = desc.characters.filter((c) => FLOATERS.has(c.spec.kind));
    const rigs = [];
    const spacing = info.inBoat ? 1.1 : people.length > 2 ? 1.75 : 2.0;
    const order = people.length === 3 ? [0, -1, 1] : people.length === 2 ? [-0.5, 0.5] : [0];
    people.forEach((c, i) => {
      const rig = buildCharacter(c.spec);
      const x = order[i] * spacing;
      rig.root.position.set(x, info.floor, i === 0 ? 0.3 : -0.2);
      rig.root.rotation.y = -x * 0.12;
      if (c.small) rig.root.scale.setScalar(0.7);
      scene.add(rig.root);
      rigs.push({ rig, c });
    });
    floaters.forEach((c, i) => {
      const rig = buildCharacter(c.spec);
      const alone = !people.length;
      const side = i % 2 ? -1 : 1;
      rig.root.position.set(alone ? 0 : side * (people.length > 1 ? 3.1 : 2.4), alone ? info.floor : 1.6 + (i % 2) * 0.4, alone ? 0.2 : -1.2);
      rig.root.scale.setScalar(alone ? 1 : 0.85);
      rig.root.rotation.y = alone ? 0 : -side * 0.25;
      scene.add(rig.root);
      rigs.push({ rig, c });
    });

    const camera = new THREE.PerspectiveCamera(35, this.w / this.h, 0.1, 200);
    const built = { scene, camera, rigs, info, desc };
    this.cache.set(key, built);
    return built;
  }

  /**
   * Draw the scene at time t. talk(c) returns the mouth openness for a cast
   * entry (from its voice), 0 when silent.
   */
  render(key, desc, t, talk) {
    const b = this.build(key, desc);
    const portrait = this.h > this.w;
    const cam = b.camera;
    cam.aspect = this.w / this.h;
    cam.fov = portrait ? 52 : 34;
    const width = Math.max(1, b.rigs.filter((r) => !FLOATERS.has(r.c.spec.kind)).length);
    const dist = (portrait ? 9.5 : 6.4) + (width - 1) * 1.0;
    const p = Math.min(1, t / Math.max(1, desc.duration || 5));
    // slow push-in with a gentle drift, like a kids' show camera
    cam.position.set(Math.sin(t * 0.25) * 0.5, 2.0 + (portrait ? 0.6 : 0) - p * 0.15, dist - p * 0.9);
    cam.lookAt(0, (b.info.floor || 0) + (portrait ? 1.6 : 1.3), 0);
    cam.updateProjectionMatrix();

    b.rigs.forEach(({ rig, c }, i) => {
      const lead = i === 0;
      const level = talk(c) || 0;
      let action = c.action || (lead ? desc.action : desc.groupActs ? desc.action : "idle");
      if (b.info.inBoat && !FLOATERS.has(rig.spec.kind)) action = lead ? "row" : action === "row" ? "row" : "idle";
      animate(rig, t + i * 0.37, { action, talk: level, singing: desc.sung && c.speaking, bpm: desc.bpm || 100 });
    });
    this.renderer.render(b.scene, cam);
    return this.canvas;
  }
}
