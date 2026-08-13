// Bows and crossbows.
//
// A bow is a *different verb* from a sword, and the whole reason to have one is
// that it changes where you want to be standing. So it is built on the same
// three rules the runes are, and shares their projectile:
//
// **A draw is a commitment.** Nocking, drawing and loosing take frames, exactly
// like a swing. You cannot draw while running at full tilt and you cannot
// cancel a loose you have started, which is what makes the archer's problem
// "how much room do I have" rather than "how fast can I click".
//
// **Dexterity is a wall, not a modifier.** Under a bow's dexterity requirement
// you cannot draw it at all (P3), the same way strength gates a blade.
//
// **The skill is the spread, not the damage.** A bow at 10% and a bow at 90%
// hit for the same number when they hit. What changes is how wide the cone is,
// which means practice makes you *accurate* rather than making the arrow
// heavier — and it means a novice's miss is a miss he can see and learn from.

import { MAT } from '../assets/texgen.js';
import { sweepHits } from './magic.js';

export const BOWS = {
  bow: {
    // Frames at 60 Hz. Half a second to draw, a quarter to recover.
    draw: 30, recover: 16,
    speed: 62, life: 110, damage: 34,
    // Radians of half-angle at 0% skill and at 100%. Five degrees to half a
    // degree: the difference between "somewhere over there" and "in the eye".
    spreadRaw: 0.090, spreadTrained: 0.009,
    arrow: { len: 0.9, r: 0.035, albedo: [0.20, 0.15, 0.09] },
  },
  crossbow: {
    // Slower to load, flatter, harder, and it does not care as much about the
    // shooter — which is the whole historical argument for one.
    draw: 54, recover: 22,
    speed: 78, life: 120, damage: 62,
    spreadRaw: 0.048, spreadTrained: 0.006,
    arrow: { len: 0.62, r: 0.045, albedo: [0.16, 0.14, 0.12] },
  },
};

/** Which weapon class shoots, and out of which table. */
export const RANGED_CLASS = { bow: 'bow', crossbow: 'crossbow' };

export function isRanged(weaponClass) {
  return !!RANGED_CLASS[weaponClass];
}

/** The archer's own little state machine, beside the fighter and the caster. */
export function createArcher() {
  return { t: 0, drawing: null, released: null };
}

/**
 * Can this character shoot right now, and if not, why not.
 *
 * Same shape as `canCast`, and for the same reason: "no bow", "not dexterous
 * enough" and "already drawing" are three different problems and the player
 * needs told which one.
 */
export function canShoot(weaponClass, character, archer, ammo) {
  if (!isRanged(weaponClass)) return { ok: false, why: 'you are not holding a bow' };
  if (archer.drawing) return { ok: false, why: 'already drawing' };
  if (ammo != null && ammo <= 0) return { ok: false, why: 'no arrows' };
  return { ok: true, bow: BOWS[RANGED_CLASS[weaponClass]] };
}

/** Begin a draw. */
export function beginDraw(weaponClass, archer) {
  const bow = BOWS[RANGED_CLASS[weaponClass]];
  archer.drawing = weaponClass;
  archer.t = bow.draw + bow.recover;
  return archer;
}

/** One tick. Returns the weapon class loosed this tick, or null. */
export function stepArcher(archer) {
  archer.released = null;
  if (!archer.drawing) return null;
  const bow = BOWS[RANGED_CLASS[archer.drawing]];
  archer.t--;
  if (archer.t === bow.recover) archer.released = archer.drawing;
  if (archer.t <= 0) { archer.drawing = null; archer.t = 0; }
  return archer.released;
}

/** A draw is a commitment, and being hit ends it — the arrow is simply lost. */
export function breakDraw(archer) {
  if (!archer.drawing) return false;
  archer.drawing = null;
  archer.t = 0;
  archer.released = null;
  return true;
}

/**
 * How far off the line this shot goes.
 *
 * The skill buys the cone, not the damage. `rng` is the world's seeded stream,
 * so two runs of the same seed put the arrow in the same place — which is the
 * only reason a bot can be used to measure whether a bow is worth carrying.
 */
export function spreadFor(weaponClass, skill, rng = Math.random) {
  const bow = BOWS[RANGED_CLASS[weaponClass]];
  const t = Math.max(0, Math.min(1, skill / 100));
  // Eased, not linear. A cone that closes linearly makes the first half of the
  // skill worthless — spread is an *area*, so a straight line in the angle is a
  // quadratic in the chance of hitting anything, and sixty per cent of a bow
  // measured as one shot in four at twenty-four metres. The square root puts
  // most of the improvement where the player is actually practising.
  const half = bow.spreadRaw + (bow.spreadTrained - bow.spreadRaw) * Math.sqrt(t);
  // Uniform in the disc rather than in the square, so the cone is a cone.
  const a = rng() * Math.PI * 2;
  const r = Math.sqrt(rng()) * half;
  return { yaw: Math.cos(a) * r, pitch: Math.sin(a) * r };
}

/**
 * An arrow in flight.
 *
 * Deliberately the same shape as a bolt (src/game/magic.js), so the world steps
 * both through the same loop and neither system has a private idea of what
 * "something travelling" means. The differences are all in the numbers: an
 * arrow is faster, thinner, does not glow, and *is* stopped by armour.
 */
export function createArrow(weaponClass, pos, yaw, pitch, damage, rng = Math.random, skill = 0) {
  const bow = BOWS[RANGED_CLASS[weaponClass]];
  const off = spreadFor(weaponClass, skill, rng);
  const y = yaw + off.yaw, p = pitch + off.pitch;
  const cy = Math.cos(p);
  return {
    kind: weaponClass,
    arrow: true,
    pos: new Float32Array([pos[0], pos[1], pos[2]]),
    vel: new Float32Array([
      Math.sin(y) * cy * bow.speed,
      Math.sin(p) * bow.speed,
      Math.cos(y) * cy * bow.speed,
    ]),
    damage,
    life: bow.life,
    hit: new Set(),
    // Arrows drop. Half a metre over twenty-five, about two over fifty, and
    // enough past that to make a long shot something you aim high for — which
    // is the only thing that makes distance interesting rather than merely
    // safe. The first numbers (42 m/s, g = 9) dropped an arrow a metre and a
    // half over twenty-four metres, so a master archer hit a standing wolf
    // thirty-eight times in a hundred and the bow read as broken.
    gravity: -6.5,
    spin: 0,
  };
}

/** Move an arrow and report what it touched. Mirrors `stepBolt`. */
export function stepArrow(a, targets, terrain, dt) {
  const was = [a.pos[0], a.pos[1], a.pos[2]];
  a.vel[1] += a.gravity * dt;
  a.pos[0] += a.vel[0] * dt;
  a.pos[1] += a.vel[1] * dt;
  a.pos[2] += a.vel[2] * dt;
  a.life--;

  if (terrain && a.pos[1] < terrain.heightAt(a.pos[0], a.pos[2])) {
    a.life = 0;
    return [];
  }

  const struck = [];
  for (const t of targets) {
    if (t.state === 7 || a.hit.has(t)) continue;
    // An arrow travels 1.03 m per tick and a wolf is 1.2 m across, so a point
    // test misses more often than it hits. Swept, always. See `sweepHits`.
    if (!sweepHits(was, a.pos, t, 0.06)) continue;
    a.hit.add(t);
    struck.push(t);
    a.life = 0;                       // an arrow stops in the first thing it hits
    break;
  }
  return struck;
}

/** What the renderer draws for an arrow: a thin shaft along its own velocity. */
export function poseArrow(out, a) {
  const bow = BOWS[RANGED_CLASS[a.kind]];
  const flat = Math.hypot(a.vel[0], a.vel[2]) || 1e-6;
  out.pos = [a.pos[0], a.pos[1], a.pos[2]];
  out.yaw = Math.atan2(a.vel[0], a.vel[2]);
  // A falling arrow points down, which is the cheapest possible sign that
  // gravity is a thing here.
  out.pitch = -Math.atan2(a.vel[1], flat);
  out.scale = [bow.arrow.r, bow.arrow.r, bow.arrow.len];
  out.albedo = bow.arrow.albedo;
  out.tex = MAT.TIMBER;
  out.glow = 0;
  return out;
}
