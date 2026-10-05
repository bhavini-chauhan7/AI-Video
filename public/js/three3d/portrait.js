// Small portrait images of 3D characters for the editor (rendered once, cached).
import * as THREE from "three";
import { buildCharacter } from "./characters.js";
import { animate } from "./animate.js";
import { lightsFor } from "./sets.js";

let renderer;
const cache = new Map();

export function portrait(spec, size = 160) {
  const key = JSON.stringify(spec) + size;
  if (cache.has(key)) return cache.get(key);
  renderer ??= new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(size, size, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#dbeafe");
  scene.add(lightsFor({ night: false }));
  const rig = buildCharacter(spec);
  scene.add(rig.root);
  animate(rig, 1.1, { action: "wave", talk: 0.3 });
  const floating = ["moon", "star", "sun", "cloud"].includes(spec.kind);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  cam.position.set(0, 1.5, 5.6);
  cam.lookAt(0, floating ? 1.5 : 1.15, 0);
  renderer.render(scene, cam);
  const url = renderer.domElement.toDataURL("image/png");
  scene.traverse((o) => { o.geometry?.dispose?.(); o.material?.map?.dispose?.(); o.material?.dispose?.(); });
  cache.set(key, url);
  return url;
}
