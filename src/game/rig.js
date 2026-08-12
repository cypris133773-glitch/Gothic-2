// Humanoid characters, built out of boxes and posed by a walk cycle.
//
// A body is twenty-two parts: head, neck, chest, belly, hips, two shoulders,
// two upper and lower arms, two hands, two thighs, two shins, two boots, a
// belt, and whatever the character is carrying. Armour is *layered on top* of
// that body rather than replacing it — a gorget over the neck, a breastplate
// over the chest, a fauld over the hips, vambraces over the forearms, poleyns
// on the knees, greaves on the shins — which takes a fully harnessed figure to
// about fifty parts and, more importantly, means a suit of armour is a list of
// pieces rather than a differently-coloured torso.
//
// That matters because the pieces are what you read at distance. A knight and
// a militiaman in this game differ by a gorget, a pair of pauldrons and the
// colour of a tabard, and those three things are legible at thirty metres where
// a face is four pixels.
//
// Every part is one instance of the shared unit cube (§ the renderer), so a
// crowd of twenty people is still one draw call and the whole model costs
// nothing but arithmetic.
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
/**
 * A wardrobe.
 *
 * Each entry is a palette plus a list of switches, and the switches are pieces
 * of armour rather than adjectives: `gorget`, `fauld`, `vambrace`, `greave`,
 * `poleyn`, `pauldron`, `mail`, `hood`, `cloak`. The same skeleton wearing
 * different pieces is how a town gets forty people out of one model, and how
 * putting a mail shirt on the player changes what the player looks like.
 */
// Albedos, not screen colours — the same rule the buildings follow, but a
// stop and a half lower, and for a reason worth writing down.
//
// A wall is nearly always lit at a graze; a person is a collection of small
// boxes with at least one face square to the sun at all times. Under a 2.6 sun
// that face gets the full amount, so armour authored at the value plaster uses
// photographs as a man in a bedsheet — which is exactly what the character
// sheet showed. Plate is authored around 0.17 here, and reads as steel.
export const KITS = {
  // The player's default: whatever he was wearing when he arrived.
  knight: {
    skin: [0.34, 0.25, 0.195], hair: [0.15, 0.11, 0.08],
    torso: [0.17, 0.18, 0.20], limb: [0.13, 0.135, 0.15], boot: [0.09, 0.07, 0.055],
    trim: [0.22, 0.18, 0.08], tabard: [0.20, 0.045, 0.045],
    plate: true, tabardOn: true, helm: false, sword: true, shoulders: 1.25,
    gorget: true, breast: true, fauld: 3, vambrace: true, greave: true,
    poleyn: true, pauldron: true, rerebrace: true, mail: true, belt: 'plate',
    texTorso: MAT.STEEL, texLimb: MAT.STEEL, texCloth: MAT.CLOTH, beard: true,
  },
  // The Watch: mail, a blue tabard and an open-faced helm. Cheaper than plate
  // and it has to read as cheaper — that is the whole point of a militia.
  guard: {
    skin: [0.325, 0.238, 0.183], hair: [0.11, 0.08, 0.06],
    torso: [0.135, 0.145, 0.165], limb: [0.11, 0.115, 0.13], boot: [0.08, 0.065, 0.05],
    trim: [0.18, 0.165, 0.10], tabard: [0.075, 0.10, 0.18],
    plate: true, tabardOn: true, helm: 'nasal', sword: true, shoulders: 1.15,
    gorget: false, breast: true, fauld: 2, vambrace: true, greave: false,
    poleyn: false, pauldron: true, rerebrace: false, mail: true, belt: 'leather',
    texTorso: MAT.STEEL, texLimb: MAT.LEATHER, texCloth: MAT.CLOTH,
  },
  villager: {
    skin: [0.352, 0.264, 0.203], hair: [0.19, 0.13, 0.07],
    torso: [0.24, 0.155, 0.107], limb: [0.18, 0.148, 0.12], boot: [0.082, 0.068, 0.055],
    trim: [0.175, 0.14, 0.10], tabard: [0.22, 0.18, 0.128],
    plate: false, tabardOn: false, helm: false, sword: false, shoulders: 1.0,
    belt: 'leather',
    texTorso: MAT.CLOTH, texLimb: MAT.CLOTH, texCloth: MAT.CLOTH,
  },
  smith: {
    skin: [0.312, 0.224, 0.17], hair: [0.10, 0.075, 0.055],
    torso: [0.128, 0.10, 0.087], limb: [0.30, 0.22, 0.163], boot: [0.075, 0.06, 0.048],
    trim: [0.155, 0.12, 0.094], tabard: [0.107, 0.08, 0.067],
    plate: false, tabardOn: true, helm: false, sword: false, shoulders: 1.1,
    apron: true, belt: 'leather',
    texTorso: MAT.LEATHER, texLimb: MAT.SKIN, texCloth: MAT.LEATHER, beard: true,
  },

  // --- what the player is actually wearing -----------------------------------
  //
  // One kit per armour in src/data/items.js, so the model on screen is the row
  // in the pack. Armour you cannot see is a number, and a number is not a
  // reward.
  rags: {
    skin: [0.34, 0.25, 0.195], hair: [0.16, 0.11, 0.07],
    torso: [0.20, 0.175, 0.135], limb: [0.19, 0.16, 0.128], boot: [0.09, 0.07, 0.055],
    trim: [0.16, 0.135, 0.10], tabard: [0.175, 0.148, 0.115],
    plate: false, tabardOn: false, helm: false, sword: true, shoulders: 0.98,
    belt: 'rope', ragged: true,
    texTorso: MAT.CLOTH, texLimb: MAT.CLOTH, texCloth: MAT.CLOTH,
  },
  leather: {
    skin: [0.34, 0.25, 0.195], hair: [0.16, 0.11, 0.07],
    torso: [0.20, 0.135, 0.08], limb: [0.16, 0.115, 0.073], boot: [0.085, 0.065, 0.05],
    trim: [0.25, 0.185, 0.09], tabard: [0.17, 0.12, 0.073],
    plate: false, tabardOn: false, helm: false, sword: true, shoulders: 1.08,
    breast: true, vambrace: true, pauldron: true, belt: 'leather',
    texTorso: MAT.LEATHER, texLimb: MAT.LEATHER, texCloth: MAT.LEATHER,
  },
  watch: {
    skin: [0.34, 0.25, 0.195], hair: [0.14, 0.10, 0.07],
    torso: [0.14, 0.15, 0.17], limb: [0.115, 0.12, 0.14], boot: [0.08, 0.065, 0.05],
    trim: [0.19, 0.16, 0.085], tabard: [0.065, 0.10, 0.19],
    plate: true, tabardOn: true, helm: 'nasal', sword: true, shoulders: 1.2,
    gorget: true, breast: true, fauld: 3, vambrace: true, greave: true,
    poleyn: true, pauldron: true, rerebrace: true, mail: true, belt: 'plate',
    texTorso: MAT.STEEL, texLimb: MAT.STEEL, texCloth: MAT.CLOTH,
  },
  ember: {
    skin: [0.34, 0.25, 0.195], hair: [0.13, 0.09, 0.06],
    torso: [0.155, 0.068, 0.032], limb: [0.125, 0.055, 0.026], boot: [0.085, 0.065, 0.05],
    trim: [0.26, 0.16, 0.045], tabard: [0.17, 0.075, 0.034],
    plate: false, tabardOn: true, helm: false, sword: false, shoulders: 1.0,
    hood: true, cloak: true, robe: true, belt: 'rope',
    texTorso: MAT.CLOTH, texLimb: MAT.CLOTH, texCloth: MAT.CLOTH,
  },
  freeblade: {
    skin: [0.325, 0.238, 0.183], hair: [0.12, 0.09, 0.06],
    torso: [0.16, 0.115, 0.072], limb: [0.135, 0.10, 0.066], boot: [0.075, 0.06, 0.045],
    trim: [0.20, 0.165, 0.08], tabard: [0.13, 0.09, 0.06],
    plate: true, tabardOn: false, helm: false, sword: true, shoulders: 1.3,
    breast: true, vambrace: true, greave: true, pauldron: true, rerebrace: true,
    fauld: 2, cloak: true, belt: 'plate', beard: true, fur: true,
    texTorso: MAT.LEATHER, texLimb: MAT.LEATHER, texCloth: MAT.LEATHER,
  },
};

/**
 * Which kit an armour puts you in. The world calls this whenever the loadout
 * changes, which is what makes a suit of armour a thing you can see rather than
 * a number in a panel.
 */
export const ARMOUR_KITS = {
  rags: 'rags',
  leather_jerkin: 'leather',
  watch_mail: 'watch',
  ember_robe: 'ember',
  freeblade_harness: 'freeblade',
};

export const kitForArmour = (id) => KITS[ARMOUR_KITS[id] || 'rags'] || KITS.rags;

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
  limbEnd(_end, joint, len * 0.5, yaw, swing, splay);
  part(out, _end, [thick, len, thick], yaw, swing, splay);
  colorOut.set(color);
  return out;
}

/**
 * Where a limb's far end lands, given its joint and its swing.
 *
 * This exists because the knee and the ankle used to be computed by hand, with
 * a simplification — forward component only, splay ignored — while `limb` placed
 * the actual box with the full rotation. The two agreed while the swing was
 * small and came apart at a running stride, which the character sheet caught:
 * a shin and a boot walking along a little way from the leg they belong to.
 * One function, used by both, cannot drift.
 */
function limbEnd(out, joint, len, yaw, swing, splay) {
  const cx = Math.cos(swing), sx = Math.sin(swing);
  const cz = Math.cos(splay), sz = Math.sin(splay);
  // Direction from joint to far end, in the character's local frame…
  const lx = -sz * cx, ly = -cz * cx, lz = sx;
  // …then rotated into the world by the character's facing.
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  out[0] = joint[0] + (lx * cy + lz * sy) * len;
  out[1] = joint[1] + ly * len;
  out[2] = joint[2] + (-lx * sy + lz * cy) * len;
  return out;
}
const _end = [0, 0, 0], _joint = [0, 0, 0], _joint2 = [0, 0, 0];

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

  // Mail under the plate: a hem of it showing below the breastplate and at the
  // shoulders is the difference between a man in armour and a man painted grey.
  if (k.mail) {
    p = next(MAT.STEEL);
    part(p.mat, at(0, base + H * 0.615, 0), [HEAD * 1.34, H * 0.055, HEAD * 0.86], yaw, -lean * 0.5, 0);
    p.albedo.set([k.limb[0] * 0.82, k.limb[1] * 0.84, k.limb[2] * 0.90]);
  }

  // The breastplate, proud of the chest and a shade lighter, with a raised
  // centre ridge. A cuirass without a ridge reads as a barrel.
  if (k.breast) {
    const lift = k.plate ? 1.14 : 1.06;   // leather does not catch the light like steel
    p = next(k.texTorso);
    part(p.mat, at(0, chestY + H * 0.005, 0.055), [HEAD * 1.44 * k.shoulders, H * 0.175, HEAD * 0.86], yaw, -lean, 0);
    p.albedo.set([k.torso[0] * lift, k.torso[1] * lift, k.torso[2] * lift]);
    // The centre ridge is a *steel* detail. On a leather jack it was a bright
    // stripe down a brown chest and read as a sandwich board.
    if (k.plate) {
      p = next(MAT.STEEL);
      part(p.mat, at(0, chestY, 0.112), [HEAD * 0.13, H * 0.17, HEAD * 0.40], yaw, -lean, 0);
      p.albedo.set(k.trim);
    }
  }

  p = next(k.texCloth);
  part(p.mat, at(0, base + H * 0.575, 0), [HEAD * 1.25, H * 0.10, HEAD * 0.80], yaw, -lean * 0.5, 0);
  p.albedo.set(k.tabardOn ? k.tabard : k.torso);

  p = next(k.texLimb);   // hips
  part(p.mat, at(0, hipY - H * 0.03, 0), [HEAD * 1.20, H * 0.075, HEAD * 0.82], yaw, 0, 0);
  p.albedo.set(k.limb);

  // The fauld: two or three overlapping lames hanging off the belt, each a
  // little wider and a little further out than the one above. This is the piece
  // that makes a harnessed figure read as *articulated* rather than solid.
  for (let l = 0; l < (k.fauld || 0); l++) {
    p = next(k.texTorso);
    part(p.mat, at(0, base + H * (0.505 - l * 0.028), 0.01),
      [HEAD * (1.22 + l * 0.06), H * 0.030, HEAD * (0.84 + l * 0.04)], yaw, 0, 0);
    p.albedo.set(l % 2 ? k.trim : k.torso);
  }

  // The belt, and its buckle. A rope belt for a robe, a plate girdle for a
  // harness, leather for everyone else.
  p = next(k.belt === 'plate' ? MAT.STEEL : k.belt === 'rope' ? MAT.CLOTH : MAT.LEATHER);
  part(p.mat, at(0, base + H * 0.525, 0),
    [HEAD * 1.28, H * (k.belt === 'plate' ? 0.034 : 0.022), HEAD * 0.86], yaw, 0, 0);
  p.albedo.set(k.belt === 'plate' ? k.trim : k.belt === 'rope' ? k.trim : k.boot);
  p = next(MAT.STEEL);
  part(p.mat, at(0, base + H * 0.525, 0.055), [HEAD * 0.24, H * 0.030, HEAD * 0.10], yaw, 0, 0);
  p.albedo.set(k.trim);

  // A tabard hanging over the thighs: the single strongest read of "this person
  // belongs to an order" at any distance where the face is a smudge.
  if (k.tabardOn) {
    p = next(k.texCloth);
    part(p.mat, at(0, base + H * 0.46, 0.06), [HEAD * 0.86, H * 0.17, HEAD * 0.12], yaw, 0, 0);
    p.albedo.set(k.tabard);
  }

  // A robe: the tabard's long cousin, reaching the shins and swaying a little
  // with the stride so a walking priest is not a walking cupboard.
  if (k.robe) {
    p = next(k.texCloth);
    part(p.mat, at(0, base + H * 0.33, 0), [HEAD * 1.20, H * 0.40, HEAD * 0.96], yaw, swing * 0.06, 0);
    p.albedo.set(k.torso);
    p = next(k.texCloth);   // the hem, in the order's colour
    part(p.mat, at(0, base + H * 0.145, 0), [HEAD * 1.26, H * 0.035, HEAD * 1.00], yaw, swing * 0.06, 0);
    p.albedo.set(k.trim);
  }

  // A cloak hanging off the shoulders, behind. It is one box, and it doubles
  // the silhouette from behind — which is the view the player has all day.
  if (k.cloak) {
    p = next(k.texCloth);
    part(p.mat, at(0, base + H * 0.52, -HEAD * 0.52),
      [HEAD * 1.42, H * 0.50, HEAD * 0.10], yaw, -swing * 0.05, 0);
    p.albedo.set(k.tabardOn ? k.tabard : [k.torso[0] * 0.8, k.torso[1] * 0.8, k.torso[2] * 0.8]);
  }

  // A smith's apron, and a mercenary's fur mantle. One box each, and each says
  // what its owner does for a living before he has said anything.
  if (k.apron) {
    p = next(MAT.LEATHER);
    part(p.mat, at(0, base + H * 0.44, 0.10), [HEAD * 1.05, H * 0.34, HEAD * 0.10], yaw, 0, 0);
    p.albedo.set([0.20, 0.14, 0.10]);
  }
  if (k.fur) {
    // Round the shoulders and *behind* them, not across the chest: a mantle
    // that reaches the sternum is a bib.
    p = next(MAT.CLOTH);
    part(p.mat, at(0, shoulderY + 0.02, -0.055),
      [HEAD * 1.62 * k.shoulders, HEAD * 0.40, HEAD * 0.74], yaw, 0, 0);
    p.albedo.set([0.15, 0.12, 0.09]);
  }

  // --- head ------------------------------------------------------------------
  // The gorget: a steel collar covering the join of neck and chest, and the
  // piece that most says "this man is expensively equipped". It goes on before
  // the neck so the neck sits inside it.
  if (k.gorget) {
    p = next(MAT.STEEL);
    part(p.mat, at(0, base + H * 0.815, 0), [HEAD * 0.86, H * 0.055, HEAD * 0.74], yaw, 0, 0);
    p.albedo.set(k.trim);
  }

  p = next(k.helm ? k.texLimb : MAT.SKIN);   // neck
  part(p.mat, at(0, base + H * 0.835, 0), [HEAD * 0.42, H * 0.035, HEAD * 0.42], yaw, 0, 0);
  p.albedo.set(k.helm ? k.limb : k.skin);

  p = next(k.helm ? MAT.STEEL : MAT.SKIN);   // skull
  part(p.mat, at(0, headY, 0), [HEAD * 0.78, HEAD * 0.92, HEAD * 0.82], yaw, 0, 0);
  p.albedo.set(k.helm ? k.torso : k.skin);

  // A brow band and, on some kits, a beard. Two boxes, and they are the
  // difference between a head and a block: the eye line is the first thing a
  // person reads on another person, at any distance where anything is legible.
  p = next(MAT.FLAT);
  part(p.mat, at(0, headY + HEAD * 0.10, HEAD * 0.40),
    [HEAD * 0.66, HEAD * 0.13, HEAD * 0.06], yaw, 0, 0);
  p.albedo.set(k.helm ? [0.05, 0.05, 0.06] : [0.14, 0.11, 0.09]);

  if (k.beard) {
    p = next(MAT.FLAT);
    part(p.mat, at(0, headY - HEAD * 0.28, HEAD * 0.30),
      [HEAD * 0.52, HEAD * 0.34, HEAD * 0.24], yaw, 0, 0);
    p.albedo.set(k.hair);
  }

  p = next(k.helm ? MAT.STEEL : MAT.FLAT);   // hair, or the crown of a helm
  // Sat lower and wider than the skull rather than perched above it: at 0.40 of
  // a head unit up, a helm reads as a slab hovering over its owner.
  part(p.mat, at(0, headY + HEAD * (k.helm ? 0.30 : 0.34), -0.02),
    [HEAD * (k.helm ? 0.90 : 0.84), HEAD * (k.helm ? 0.40 : 0.28), HEAD * (k.helm ? 0.92 : 0.88)], yaw, 0, 0);
  p.albedo.set(k.helm ? k.trim : k.hair);

  // A helm is a shape, not a colour. The nasal bar down the front and the two
  // cheek plates either side are what turn a grey box into headgear, and they
  // are three boxes.
  if (k.helm) {
    p = next(MAT.STEEL);   // nasal
    part(p.mat, at(0, headY + HEAD * 0.02, HEAD * 0.44), [HEAD * 0.12, HEAD * 0.60, HEAD * 0.08], yaw, 0, 0);
    p.albedo.set(k.trim);
    for (const side of [-1, 1]) {
      p = next(MAT.STEEL);
      part(p.mat, at(side * HEAD * 0.40, headY - HEAD * 0.06, HEAD * 0.06),
        [HEAD * 0.10, HEAD * 0.52, HEAD * 0.62], yaw, 0, 0);
      p.albedo.set(k.torso);
    }
    if (k.helm === 'crested') {
      p = next(MAT.CLOTH);
      part(p.mat, at(0, headY + HEAD * 0.56, -HEAD * 0.06), [HEAD * 0.10, HEAD * 0.30, HEAD * 0.72], yaw, 0, 0);
      p.albedo.set(k.tabard);
    }
  }

  // A hood, for the ones who wear a robe: it sits over the crown and comes
  // forward far enough to put the eyes in shadow, which is the whole effect.
  if (k.hood) {
    p = next(k.texCloth);
    part(p.mat, at(0, headY + HEAD * 0.24, -HEAD * 0.06),
      [HEAD * 0.98, HEAD * 0.62, HEAD * 1.02], yaw, 0, 0);
    p.albedo.set(k.torso);
    p = next(k.texCloth);   // the peak, over the brow
    part(p.mat, at(0, headY + HEAD * 0.34, HEAD * 0.34), [HEAD * 0.86, HEAD * 0.22, HEAD * 0.34], yaw, 0.35, 0);
    p.albedo.set(k.torso);
    p = next(k.texCloth);   // and the cowl round the shoulders
    part(p.mat, at(0, base + H * 0.795, -0.02), [HEAD * 1.24, H * 0.075, HEAD * 1.00], yaw, 0, 0);
    p.albedo.set(k.torso);
  }

  // --- arms ------------------------------------------------------------------
  const upperArm = H * 0.165, foreArm = H * 0.155, armThick = HEAD * 0.34;
  for (const side of [-1, 1]) {
    const shoulder = at(side * shoulderW, shoulderY, 0);
    if (k.pauldron) {
      // Two lames rather than one blob: the cap, and a smaller plate under it.
      // The step between them is what catches the light and says "shoulder".
      p = next(MAT.STEEL);
      part(p.mat, at(side * shoulderW * 1.05, shoulderY + 0.025, 0),
        [HEAD * 0.66, HEAD * 0.34, HEAD * 0.66], yaw, 0, 0);
      p.albedo.set(k.trim);
      p = next(MAT.STEEL);
      part(p.mat, at(side * shoulderW * 1.10, shoulderY - HEAD * 0.16, 0),
        [HEAD * 0.58, HEAD * 0.24, HEAD * 0.58], yaw, 0, 0);
      p.albedo.set(k.torso);
    }
    // The right arm carries the sword, so when the character is armed it hangs
    // forward and slightly out rather than swinging freely.
    const armed = k.sword && side > 0;
    const armSwing = armed ? -0.55 : (side < 0 ? swing : swingB) * 0.8;
    const splay = side * (armed ? 0.22 : 0.10);

    p = next(k.texLimb);
    limb(p.mat, shoulder, upperArm, armThick, yaw, armSwing, splay, p.albedo, k.limb);

    // A rerebrace: the sleeve of plate over the upper arm, a fraction thicker
    // than the arm inside it and swung with it.
    if (k.rerebrace) {
      p = next(MAT.STEEL);
      limb(p.mat, shoulder, upperArm * 0.82, armThick * 1.14, yaw, armSwing, splay, p.albedo, k.trim);
    }

    const elbow = limbEnd(_joint, shoulder, upperArm, yaw, armSwing, splay);
    const bend = armed ? -0.85 : -0.35 - Math.max(0, -armSwing) * 0.4;
    const foreSwing = armSwing + bend, foreSplay = splay * 0.5;

    p = next(k.plate ? k.texLimb : MAT.SKIN);
    limb(p.mat, elbow, foreArm, armThick * 0.92, yaw, foreSwing, foreSplay, p.albedo, k.plate ? k.limb : k.skin);

    // A vambrace over the forearm, and a couter over the elbow itself.
    if (k.vambrace) {
      p = next(k.plate ? MAT.STEEL : MAT.LEATHER);
      limb(p.mat, elbow, foreArm * 0.86, armThick * 1.12, yaw, foreSwing, foreSplay, p.albedo, k.trim);
      p = next(k.plate ? MAT.STEEL : MAT.LEATHER);
      part(p.mat, elbow, [armThick * 1.3, armThick * 1.0, armThick * 1.3], yaw, 0, 0);
      p.albedo.set(k.torso);
    }

    const hand = limbEnd(_joint2, elbow, foreArm, yaw, foreSwing, foreSplay);
    // A gauntlet, if there is plate to hang it off; otherwise a bare hand.
    p = next(k.plate ? MAT.STEEL : MAT.SKIN);
    part(p.mat, hand, [HEAD * (k.plate ? 0.34 : 0.30), HEAD * (k.plate ? 0.32 : 0.28), HEAD * (k.plate ? 0.34 : 0.30)], yaw, 0, 0);
    p.albedo.set(k.plate ? k.trim : k.skin);

    if (armed) {
      // A blade held point-down and slightly out, and a crossguard. Two boxes,
      // and it changes the silhouette more than anything else on the model.
      p = next(MAT.STEEL);
      part(p.mat, [hand[0] + fx * 0.12, hand[1] + 0.30, hand[2] + fz * 0.12],
        [0.055, 0.86, 0.012], yaw, 0.20, 0);
      p.albedo.set([0.22, 0.235, 0.26]);   // a polished blade, at the same stop as the plate
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
    const legSplay = side * 0.05;

    p = next(k.texLimb);
    limb(p.mat, hip, thigh, legThick, yaw, legSwing, legSplay, p.albedo, k.limb);

    const knee = limbEnd(_joint, hip, thigh, yaw, legSwing, legSplay);
    // A knee bends backwards only, and only on the trailing leg.
    const shinSwing = legSwing - (Math.max(0, -legSwing) * 1.15 + crouch * 0.6);
    p = next(k.texLimb);
    limb(p.mat, knee, shin, legThick * 0.88, yaw, shinSwing, legSplay * 0.6, p.albedo, k.limb);

    // The poleyn: a cop over the knee joint. It is one small box and it is the
    // single clearest sign of a leg harness at any distance.
    if (k.poleyn) {
      p = next(MAT.STEEL);
      part(p.mat, knee, [legThick * 1.24, legThick * 0.86, legThick * 1.24], yaw, 0, 0);
      p.albedo.set(k.trim);
    }
    // And the greave down the front of the shin, swung with it.
    if (k.greave) {
      p = next(k.plate ? MAT.STEEL : MAT.LEATHER);
      limb(p.mat, knee, shin * 0.88, legThick * 1.08, yaw, shinSwing, legSplay * 0.6, p.albedo, k.torso);
    }

    const ankle = limbEnd(_joint2, knee, shin, yaw, shinSwing, legSplay * 0.6);
    p = next(k.greave ? MAT.STEEL : MAT.LEATHER);
    part(p.mat, [ankle[0] + fx * 0.03, ankle[1] - HEAD * 0.10, ankle[2] + fz * 0.03],
      [legThick * 1.05, HEAD * 0.24, HEAD * 0.62], yaw, 0, 0);
    p.albedo.set(k.greave ? k.trim : k.boot);
    // A sabaton's toe cap, or a boot's turned-up sole. Feet that end in a flat
    // rectangle are the last thing anyone fixes and the first thing that reads
    // as unfinished.
    p = next(k.greave ? MAT.STEEL : MAT.LEATHER);
    part(p.mat, [ankle[0] + fx * 0.20, ankle[1] - HEAD * 0.15, ankle[2] + fz * 0.20],
      [legThick * 0.92, HEAD * 0.13, HEAD * 0.26], yaw, 0, 0);
    p.albedo.set(k.greave ? k.torso : k.boot);
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
