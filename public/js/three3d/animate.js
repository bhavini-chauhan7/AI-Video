// Character animation as a pure function of time, so preview, scrubbing and
// export always show the same pose. `talk` (0..1) drives the mouth (lip-sync).

const TAU = Math.PI * 2;
const ease = (x) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, x)));

/**
 * Pose a rig at time t (seconds into the scene).
 * state: { action, talk, singing, bpm, facing, mood }
 */
export function animate(rig, t, state) {
  const { action = "idle", talk = 0, singing = false, bpm = 100 } = state;
  const seed = rig.seed || 0;
  const beat = 60 / bpm;
  const [armL, armR] = rig.arms.length ? rig.arms : [null, null];
  const [legL, legR] = rig.legs.length ? rig.legs : [null, null];
  const body = rig.body, head = rig.head, neck = rig.neck;

  // rest pose
  body.position.set(0, 0, 0);
  body.rotation.set(0, 0, 0);
  body.scale.set(1, 1, 1);
  if (armL) { armL.rotation.set(0, 0, -0.18); armR.rotation.set(0, 0, 0.18); }
  if (legL) { legL.rotation.set(0, 0, 0); legR.rotation.set(0, 0, 0); }
  head.rotation.set(0, 0, 0);

  // breathing + a gentle idle sway so nobody looks frozen
  const breathe = Math.sin(t * 2.1 + seed) * 0.012;
  body.scale.y = 1 + breathe;
  head.rotation.z = Math.sin(t * 0.9 + seed) * 0.04;
  head.rotation.y = Math.sin(t * 0.6 + seed * 2) * 0.08;

  if (rig.floating) {
    body.position.y = Math.sin(t * 1.6 + seed) * 0.12;
    body.rotation.z = Math.sin(t * 1.1 + seed) * 0.08;
  }

  const swing = (arm, z, x = 0) => { if (arm) { arm.rotation.z = z; arm.rotation.x = x; } };
  const b = (t / beat) * Math.PI; // half-beat phase

  switch (action) {
    case "wave": {
      swing(armR, 2.5 + Math.sin(t * 9) * 0.35);
      head.rotation.z += 0.08;
      break;
    }
    case "jump": {
      const hop = Math.abs(Math.sin(t * 3.2));
      body.position.y += hop * 0.42;
      body.scale.y *= 1 - (1 - hop) * 0.08;
      swing(armL, -1.2 - hop * 1.2); swing(armR, 1.2 + hop * 1.2);
      if (legL) { legL.rotation.x = -hop * 0.4; legR.rotation.x = -hop * 0.4; }
      break;
    }
    case "dance": {
      body.position.y += Math.abs(Math.sin(b)) * 0.12;
      body.rotation.y = Math.sin(b) * 0.35;
      body.rotation.z = Math.sin(b) * 0.08;
      swing(armL, -1.6 - Math.sin(b) * 0.9); swing(armR, 1.6 - Math.sin(b) * 0.9);
      if (legL) { legL.rotation.z = Math.max(0, Math.sin(b)) * 0.3; legR.rotation.z = -Math.max(0, -Math.sin(b)) * 0.3; }
      break;
    }
    case "clap": {
      const c = Math.abs(Math.sin(t * 6));
      swing(armL, -0.4, -1.3 + c * 0.1); swing(armR, 0.4, -1.3 + c * 0.1);
      armL && (armL.rotation.y = 0.6 - c * 0.5); armR && (armR.rotation.y = -0.6 + c * 0.5);
      body.position.y += Math.abs(Math.sin(t * 3)) * 0.05;
      break;
    }
    case "point": {
      swing(armR, 2.2, -0.5);
      head.rotation.x = -0.25;
      head.rotation.y += 0.25;
      break;
    }
    case "sleep": {
      head.rotation.z = 0.3; head.rotation.x = 0.15;
      body.scale.y = 1 + Math.sin(t * 1.4) * 0.025;
      swing(armL, -0.25); swing(armR, 0.25);
      rig.sleepy = true;
      break;
    }
    case "walk": {
      const w = Math.sin(t * 6);
      if (legL) { legL.rotation.x = w * 0.45; legR.rotation.x = -w * 0.45; }
      swing(armL, -0.25, -w * 0.5); swing(armR, 0.25, w * 0.5);
      body.position.y += Math.abs(Math.cos(t * 6)) * 0.06;
      break;
    }
    case "row": {
      const r = t * 3;
      swing(armL, -0.5, -1.2 + Math.sin(r) * 0.5); swing(armR, 0.5, -1.2 + Math.sin(r) * 0.5);
      body.rotation.x = Math.sin(r) * 0.12;
      break;
    }
    case "hug": {
      swing(armL, -0.6, -1.2); swing(armR, 0.6, -1.2);
      armL && (armL.rotation.y = 0.7); armR && (armR.rotation.y = -0.7);
      body.rotation.z = Math.sin(t * 2) * 0.05;
      break;
    }
    case "float": {
      body.position.y += Math.sin(t * 1.6 + seed) * 0.15 + 0.2;
      swing(armL, -1.0 + Math.sin(t * 2) * 0.2); swing(armR, 1.0 - Math.sin(t * 2) * 0.2);
      break;
    }
    default: break;
  }

  // singing: sway to the beat, tilt the head, open arms on long notes
  if (singing && action !== "dance" && action !== "jump") {
    body.rotation.z += Math.sin(b) * 0.06;
    head.rotation.z += Math.sin(b) * 0.08;
    if (action === "idle") { swing(armL, -0.5 - talk * 0.6); swing(armR, 0.5 + talk * 0.6); }
  } else if (talk > 0.05 && action === "idle") {
    // talking: small hand gestures and nods
    swing(armR, 0.45 + Math.sin(t * 3.1 + seed) * 0.25, -0.4);
    head.rotation.x = Math.sin(t * 7) * 0.04 * talk;
  }

  // mouth: open with the voice, smile when quiet
  const m = rig.mouth;
  if (m) {
    const open = Math.min(1, talk * 1.3);
    m.inside.scale.y = m.inside.scale.x * (0.12 + open * 0.75) / 1.25;
    m.inside.visible = open > 0.06;
    if (m.tongue) m.tongue.visible = open > 0.35;
    m.smile.visible = open <= 0.06;
  }
  // blink every few seconds (eyes stay shut while sleeping)
  const period = 3.3 + (seed % 1.5);
  const phase = (t + seed) % period;
  const closed = rig.sleepy || action === "sleep" ? 1 : phase < 0.12 ? Math.sin((phase / 0.12) * Math.PI) : 0;
  for (const e of rig.eyes || []) e.scale.y = 1 - closed * 0.9;
}

export { ease };
