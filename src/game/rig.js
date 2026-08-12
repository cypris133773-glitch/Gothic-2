// Humanoid characters, built out of boxes and posed by a walk cycle.
//
// Twenty-two parts: head, neck, chest, belly, hips, two shoulders, two upper
// and lower arms, two hands, two thighs, two shins, two boots, a belt, and
// whatever the character is carrying. Every part is one instance of the shared
// unit cube (§ the renderer), so a crowd of twenty people is still one draw
// call and the whole model costs nothing but arithmetic.
//
// Why boxes and not a skinned mesh: a skinned mesh needs a mesh, and the whole
// project has no binary assets. A jointed figure with correct proportions,
// weight and silhouette reads as a person from the third-person camera at ten
// metres, and it reads as a *specific* person once the armour, the tabard and
// the sword are on it. The skinned path lands at M5 and inherits this skeleton.
//
// The proportions are the standard seven-and-a-half heads, which is the single
// thing most likely to make a figure look wrong if it is guessed instead of
// measured.

import * as m from '../core/math.js';
import { MAT } from '../assets/texgen.js';

export const H = 1.8;                       // total height, metres
const HEAD = H / 7.5;                       // one head unit

/**
 * A wardrobe. Each entry is a palette and a few switches — the same skeleton
 * wearing different clothes is how a town gets forty people out of one model.
 */
export const KITS = {
  knight: {
    skin: [0.50, 0.37, 0.29], hair: [0.15, 0.11, 0.08],
    torso: [0.42, 0.44, 0.48], limb: [0.33, 0.34, 0.38], boot: [0.13, 0.10, 0.08],
    trim: [0.52, 0.44, 0.20], tabard: [0.40, 0.08, 0.08],
    plate: true, tabardOn: true, helm: false, sword: true, shoulders: 1.25,
    texTorso: MAT.STEEL, texLimb: MAT.STEEL, texCloth: MAT.CLOTH,
  },
  guard: {
    skin: [0.48, 0.35, 0.27], hair: [0.11, 0.08, 0.06],
    torso: [0.22, 0.24, 0.28], limb: [0.19, 0.20, 0.23], boot: [0.11, 0.09, 0.07],
    trim: [0.34, 0.31, 0.19], tabard: [0.13, 0.17, 0.28],
    plate: true, tabardOn: true, helm: true, sword: true, shoulders: 1.15,
    texTorso: MAT.STEEL, texLimb: MAT.LEATHER, texCloth: MAT.CLOTH,
  },
  villager: {
    skin: [0.52, 0.39, 0.30], hair: [0.19, 0.13, 0.07],
    torso: [0.36, 0.23, 0.16], limb: [0.27, 0.22, 0.18], boot: [0.12, 0.10, 0.08],
    trim: [0.26, 0.21, 0.15], tabard: [0.33, 0.27, 0.19],
    plate: false, tabardOn: false, helm: false, sword: false, shoulders: 1.0,
    texTorso: MAT.CLOTH, texLimb: MAT.CLOTH, texCloth: MAT.CLOTH,
  },
  smith: {
    skin: [0.46, 0.33, 0.25], hair: [0.10, 0.075, 0.055], 
    torso: [0.19, 0.15, 0.13], limb: [0.44, 0.32, 0.24], boot: [0.11, 0.09, 0.07],
    trim: [0.23, 0.18, 0.14], tabard: [0.16, 0.12, 0.10],
    plate: false, tabardOn: true, helm: false, sword: false, shoulders: 1.1,
    texTorso: MAT.LEATHER, texLimb: MAT.SKIN, texCloth: MAT.LEATHER,
  },
};

// Scratch matrices. A character is posed sixty times a second and none of this
// may allocate (§8.1.4).
const _tmp = m.mat4(), _rot = m.mat4(), _rot2 = m.mat4();

/**
 * Compose a part's matrix: rotate around Z (limb swing sideways), then X (the
 * main swing axis), then Y (facing), then translate — and fold the box's size
 * into the columns so the renderer needs no second matrix.
 */
function part(out, pos, size, yaw, pitchX, rollZ) {
  m.fromRotationY(out, yaw);
  if (pitchX) { m.fromRotationX(_rot, pitchX); m.multiply(out, out, _rot); }
  if (rollZ) { rotationZ(_rot2, rollZ); m.multiply(out, out, _rot2); }
  for (let i = 0; i < 4; i++) out[i] *= size[0];
  for (let i = 4; i < 8; i++) out[i] *= size[1];
  for (let i = 8; i < 12; i++) out[i] *= size[2];
  out[12] = pos[0]; out[13] = pos[1]; out[14] = pos[2]; out[15] = 1;
  return out;
}

function rotationZ(out, rad) {
  const s = Math.sin(rad), c = Math.cos(rad);
  m.identity(out);
  out[0] = c; out[1] = s; out[4] = -s; out[5] = c;
  return out;
}

/**
 * A limb: a box hung from a joint and swung about it, rather than a box whose
 * centre is rotated. Getting this wrong is what makes procedural characters
 * look like they are being shaken rather than walking — the arm has to pivot at
 * the shoulder, so the position is computed from the joint plus half the limb
 * along the swung direction.
 */
function limb(out, joint, len, thick, yaw, swing, splay, colorOut, color) {
  const sx = Math.sin(swing), cx = Math.cos(swing);
  const sz = Math.sin(splay), cz = Math.cos(splay);
  // Direction from joint to the limb's far end, in the character's local frame.
  const lx = -sz * cx, ly = -cz * cx, lz = sx;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const wx = lx * cy + lz * sy;
  const wz = -lx * sy + lz * cy;
  const px = joint[0] + wx * len * 0.5;
  const py = joint[1] + ly * len * 0.5;
  const pz = joint[2] + wz * len * 0.5;
  part(out, [px, py, pz], [thick, len, thick], yaw, swing, splay);
  colorOut.set(color);
  return out;
}

/**
 * Pose a character.
 *
 * `out` is a reusable array of { mat, albedo } — the same objects every frame,
 * refilled in place. `phase` advances with distance walked rather than with
 * time, so a character that stops mid-stride keeps its feet where they were.
 */
export function poseHumanoid(out, state) {
  const { pos, yaw, speed = 0, phase = 0, kit = KITS.villager, crouch = 0, action = null } = state;
  let i = 0;
  const next = (tex = MAT.CLOTH) => {
    if (!out[i]) out[i] = { mat: m.mat4(), albedo: new Float32Array(3), tex };
    else out[i].tex = tex;
    return out[i++];
  };

  // Gait. The bob and the arm swing both scale with speed, so a standing figure
  // is still and a running one is not merely a faster version of a walk.
  const gait = Math.min(speed / 5.4, 1);
  const swing = Math.sin(phase) * (0.15 + gait * 0.75);
  const swingB = Math.sin(phase + Math.PI) * (0.15 + gait * 0.75);
  const bob = Math.abs(Math.sin(phase)) * 0.045 * gait;
  const sink = crouch * 0.28;
  const lean = gait * 0.10;

  const x = pos[0], z = pos[2];
  const base = pos[1] - sink + bob;

  const hipY = base + H * 0.50;
  const chestY = base + H * 0.70;
  const shoulderY = base + H * 0.79;
  const headY = base + H * 0.90;

  const fx = Math.sin(yaw), fz = Math.cos(yaw);       // forward
  const rx = fz, rz = -fx;                            // right
  const at = (side, up, fwd) => [x + rx * side + fx * fwd, up, z + rz * side + fz * fwd];

  const k = kit;
  const shoulderW = HEAD * 0.62 * k.shoulders;

  // --- torso -----------------------------------------------------------------
  let p = next(k.texTorso);
  part(p.mat, at(0, chestY, 0.02), [HEAD * 1.55 * k.shoulders, H * 0.20, HEAD * 0.92], yaw, -lean, 0);
  p.albedo.set(k.torso);

  p = next(k.texCloth);
  part(p.mat, at(0, base + H * 0.575, 0), [HEAD * 1.25, H * 0.10, HEAD * 0.80], yaw, -lean * 0.5, 0);
  p.albedo.set(k.tabardOn ? k.tabard : k.torso);

  p = next(k.texLimb);   // hips
  part(p.mat, at(0, hipY - H * 0.03, 0), [HEAD * 1.20, H * 0.075, HEAD * 0.82], yaw, 0, 0);
  p.albedo.set(k.limb);

  p = next(MAT.LEATHER);   // belt
  part(p.mat, at(0, base + H * 0.525, 0), [HEAD * 1.28, H * 0.022, HEAD * 0.86], yaw, 0, 0);
  p.albedo.set(k.boot);

  // A tabard hanging over the thighs: the single strongest read of "this person
  // belongs to an order" at any distance where the face is a smudge.
  if (k.tabardOn) {
    p = next(k.texCloth);
    part(p.mat, at(0, base + H * 0.46, 0.06), [HEAD * 0.86, H * 0.17, HEAD * 0.12], yaw, 0, 0);
    p.albedo.set(k.tabard);
  }

  // --- head ------------------------------------------------------------------
  p = next(k.helm ? k.texLimb : MAT.SKIN);   // neck
  part(p.mat, at(0, base + H * 0.835, 0), [HEAD * 0.42, H * 0.035, HEAD * 0.42], yaw, 0, 0);
  p.albedo.set(k.helm ? k.limb : k.skin);

  p = next(k.helm ? MAT.STEEL : MAT.SKIN);   // skull
  part(p.mat, at(0, headY, 0), [HEAD * 0.78, HEAD * 0.92, HEAD * 0.82], yaw, 0, 0);
  p.albedo.set(k.helm ? k.torso : k.skin);

  p = next(k.helm ? MAT.STEEL : MAT.FLAT);   // hair or helm crown
  part(p.mat, at(0, headY + HEAD * 0.40, -0.02), [HEAD * 0.82, HEAD * 0.30, HEAD * 0.86], yaw, 0, 0);
  p.albedo.set(k.helm ? k.trim : k.hair);

  // --- arms ------------------------------------------------------------------
  const upperArm = H * 0.165, foreArm = H * 0.155, armThick = HEAD * 0.34;
  for (const side of [-1, 1]) {
    const shoulder = at(side * shoulderW, shoulderY, 0);
    if (k.plate) {
      p = next(MAT.STEEL);   // pauldron
      part(p.mat, at(side * shoulderW * 1.05, shoulderY + 0.02, 0),
        [HEAD * 0.62, HEAD * 0.42, HEAD * 0.62], yaw, 0, 0);
      p.albedo.set(k.trim);
    }
    // The right arm carries the sword, so when the character is armed it hangs
    // forward and slightly out rather than swinging freely.
    const armed = k.sword && side > 0;
    const armSwing = armed ? -0.55 : (side < 0 ? swing : swingB) * 0.8;
    const splay = side * (armed ? 0.22 : 0.10);

    p = next(k.texLimb);
    limb(p.mat, shoulder, upperArm, armThick, yaw, armSwing, splay, p.albedo, k.limb);

    const elbow = [
      shoulder[0] - Math.sin(splay) * Math.cos(armSwing) * upperArm * (side ? 1 : 1),
      shoulder[1] - Math.cos(splay) * Math.cos(armSwing) * upperArm,
      shoulder[2] + Math.sin(armSwing) * upperArm,
    ];
    // Rotate the elbow offset into world space around the character's facing.
    const ex = elbow[0] - shoulder[0], ez = elbow[2] - shoulder[2];
    elbow[0] = shoulder[0] + ex * Math.cos(yaw) + ez * Math.sin(yaw);
    elbow[2] = shoulder[2] - ex * Math.sin(yaw) + ez * Math.cos(yaw);

    const bend = armed ? -0.85 : -0.35 - Math.max(0, -armSwing) * 0.4;
    p = next(k.plate ? k.texLimb : MAT.SKIN);
    limb(p.mat, elbow, foreArm, armThick * 0.92, yaw, armSwing + bend, splay * 0.5, p.albedo, k.plate ? k.limb : k.skin);

    const handY = elbow[1] - Math.cos(armSwing + bend) * foreArm;
    const handZf = Math.sin(armSwing + bend) * foreArm;
    const hand = [elbow[0] + fx * handZf, handY, elbow[2] + fz * handZf];
    p = next(MAT.SKIN);
    part(p.mat, hand, [HEAD * 0.30, HEAD * 0.28, HEAD * 0.30], yaw, 0, 0);
    p.albedo.set(k.skin);

    if (armed) {
      // A blade held point-down and slightly out, and a crossguard. Two boxes,
      // and it changes the silhouette more than anything else on the model.
      p = next(MAT.STEEL);
      part(p.mat, [hand[0] + fx * 0.12, hand[1] + 0.30, hand[2] + fz * 0.12],
        [0.055, 0.86, 0.012], yaw, 0.20, 0);
      p.albedo.set([0.55, 0.58, 0.62]);
      p = next(MAT.LEATHER);
      part(p.mat, [hand[0] + fx * 0.09, hand[1] - 0.02, hand[2] + fz * 0.09],
        [0.24, 0.035, 0.035], yaw, 0, 0);
      p.albedo.set(k.trim);
    }
  }

  // --- legs ------------------------------------------------------------------
  const thigh = H * 0.235, shin = H * 0.225, legThick = HEAD * 0.40;
  for (const side of [-1, 1]) {
    const hip = at(side * HEAD * 0.42, hipY - H * 0.05, 0);
    const legSwing = (side < 0 ? swingB : swing) * 0.9;

    p = next(k.texLimb);
    limb(p.mat, hip, thigh, legThick, yaw, legSwing, side * 0.05, p.albedo, k.limb);

    const kneeZ = Math.sin(legSwing) * thigh;
    const knee = [hip[0] + fx * kneeZ, hip[1] - Math.cos(legSwing) * thigh, hip[2] + fz * kneeZ];
    // A knee only bends backwards, and only on the leg that is trailing.
    const kneeBend = Math.max(0, -legSwing) * 1.15 + crouch * 0.6;
    p = next(k.texLimb);
    limb(p.mat, knee, shin, legThick * 0.88, yaw, legSwing - kneeBend, side * 0.03, p.albedo, k.limb);

    const ankleZ = kneeZ + Math.sin(legSwing - kneeBend) * shin;
    const ankleY = knee[1] - Math.cos(legSwing - kneeBend) * shin;
    p = next(MAT.LEATHER);
    part(p.mat, [hip[0] + fx * (ankleZ + 0.03), ankleY - HEAD * 0.10, hip[2] + fz * (ankleZ + 0.03)],
      [legThick * 1.05, HEAD * 0.24, HEAD * 0.62], yaw, 0, 0);
    p.albedo.set(k.boot);
  }

  out.length = i;
  return out;
}

/** Advance a character's gait phase by the distance it moved. */
export function advanceGait(state, dt) {
  // Phase follows distance, not time: two steps per 1.6 m is a natural stride,
  // and tying it to distance is what stops feet skating when speed changes.
  state.phase = (state.phase || 0) + (state.speed || 0) * dt * (Math.PI * 2 / 1.6);
  if (state.phase > Math.PI * 4) state.phase -= Math.PI * 4;
  return state.phase;
}
