// Beasts: the things in the woods that make the road worth staying on.
//
// A wolf is five boxes and one decision every quarter of a second. That is
// enough for a fight that reads, because everything that matters about a
// creature in this game is in the timing rather than in the geometry: the tell
// before it lunges, the recovery after it misses, and whether it will take you
// on alone or wait for the pack.

import { createFighter, stepFighter, S, WEAPONS } from './combat.js';
import { MAT } from '../assets/texgen.js';

export const BEASTS = {
  wolf: {
    hp: 70, armor: 5, str: 12, skill: 35, poise: 26, weapon: 'claws',
    speed: 4.2, aggro: 18, keepOut: 1.5, xp: 60,
    body: [0.55, 0.55, 1.25], legs: 0.55, head: 0.42,
    albedo: [0.24, 0.22, 0.20], tex: MAT.LEATHER,
    // How long it hesitates between attacks. A creature that attacks the
    // instant it is able is unreadable; one that pauses is a fight.
    rest: 40,
  },
  boar: {
    hp: 120, armor: 20, str: 22, skill: 25, poise: 60, weapon: 'claws',
    speed: 4.8, aggro: 12, keepOut: 1.7, xp: 100,
    body: [0.75, 0.7, 1.35], legs: 0.42, head: 0.5,
    albedo: [0.22, 0.17, 0.14], tex: MAT.LEATHER, rest: 55,
  },
};

export function createBeast(kind, x, z, terrain, rng = Math.random) {
  const def = BEASTS[kind];
  const f = createFighter({
    hp: def.hp, armor: def.armor, str: def.str, skill: def.skill,
    poise: def.poise, weapon: def.weapon, pos: [x, terrain.heightAt(x, z), z],
  });
  f.kind = kind; f.def = def; f.rest = 0; f.think = 0; f.circle = rng() < 0.5 ? 1 : -1;
  return f;
}

/**
 * One creature, one tick.
 *
 * The decision is re-made every `think` ticks rather than every tick, which is
 * what stops a beast twitching between approach and retreat on the boundary —
 * and is also why it can be baited: whatever it decided, it is committed to for
 * a fraction of a second.
 */
export function stepBeast(b, player, terrain, dt, rng = Math.random) {
  if (b.state === S.DEAD) return b;
  const def = b.def;
  const dx = player.pos[0] - b.pos[0], dz = player.pos[2] - b.pos[2];
  const dist = Math.hypot(dx, dz);
  const want = Math.atan2(dx, dz);

  if (b.rest > 0) b.rest--;
  if (b.think > 0) b.think--;
  else {
    b.think = 24;
    b.circle = rng() < 0.25 ? -b.circle : b.circle;
  }

  // Turn toward the player at a finite rate. A creature that snaps to face you
  // cannot be flanked, and flanking is most of what a player learns to do.
  let turn = want - b.facing;
  while (turn > Math.PI) turn -= Math.PI * 2;
  while (turn < -Math.PI) turn += Math.PI * 2;
  const rooted = b.state === S.WINDUP || b.state === S.ACTIVE || b.state === S.STAGGER;
  if (!rooted) b.facing += Math.max(-3.2 * dt, Math.min(3.2 * dt, turn));

  const intent = { attack: false, block: false };
  if (dist < def.aggro && !rooted) {
    if (dist > def.keepOut) {
      // Close, but at an angle rather than straight down the line, so a pack
      // spreads out instead of queueing.
      const lateral = b.circle * 0.35;
      const heading = b.facing + lateral;
      b.pos[0] += Math.sin(heading) * def.speed * dt;
      b.pos[2] += Math.cos(heading) * def.speed * dt;
    } else if (b.rest === 0 && Math.abs(turn) < 0.5) {
      intent.attack = true;
      b.rest = def.rest;
    }
  }

  stepFighter(b, intent, rng);
  b.pos[1] = terrain.heightAt(b.pos[0], b.pos[2]);
  return b;
}

/** Five boxes: body, head, two visible legs, tail. Posed from the fight state. */
export function poseBeast(out, b) {
  const def = b.def;
  let i = 0;
  const next = (tex = def.tex) => {
    if (!out[i]) out[i] = { pos: [0, 0, 0], yaw: 0, pitch: 0, scale: [1, 1, 1], albedo: new Float32Array(3), tex };
    else out[i].tex = tex;
    return out[i++];
  };
  const fx = Math.sin(b.facing), fz = Math.cos(b.facing);
  const at = (fwd, up) => [b.pos[0] + fx * fwd, b.pos[1] + up, b.pos[2] + fz * fwd];

  // The lunge is visible in the body: it drops and reaches during the wind-up
  // and is thrown forward on the active frames. That is the tell.
  const winding = b.state === S.WINDUP ? 1 - b.t / Math.max(1, b.weapon.windup) : 0;
  const striking = b.state === S.ACTIVE ? 1 : 0;
  const crouch = winding * 0.16;
  const lunge = striking * 0.5;
  const dead = b.state === S.DEAD;

  const legH = def.legs;
  const bodyY = legH + def.body[1] / 2 - crouch;

  let p = next();
  p.pos = at(lunge, dead ? def.body[1] / 2 : bodyY);
  p.scale = [def.body[0], def.body[1], def.body[2]];
  p.yaw = b.facing; p.pitch = dead ? 1.4 : -winding * 0.25;
  p.albedo.set(def.albedo);

  p = next();
  p.pos = at(def.body[2] * 0.55 + lunge, (dead ? 0.3 : bodyY + 0.12) - crouch * 0.5);
  p.scale = [def.head, def.head, def.head * 1.25];
  p.yaw = b.facing; p.pitch = winding * 0.4;
  p.albedo.set(def.albedo);

  for (const side of [-1, 1]) {
    p = next();
    const swing = Math.sin(b.pos[0] * 2 + b.pos[2] * 2 + side) * 0.15;
    p.pos = [
      b.pos[0] + fz * side * def.body[0] * 0.42 + fx * (def.body[2] * 0.3),
      b.pos[1] + legH / 2,
      b.pos[2] - fx * side * def.body[0] * 0.42 + fz * (def.body[2] * 0.3),
    ];
    p.scale = [0.16, legH, 0.16];
    p.yaw = b.facing; p.pitch = dead ? 1.2 : swing;
    p.albedo.set(def.albedo);
  }

  p = next();
  p.pos = at(-def.body[2] * 0.6, bodyY + 0.1);
  p.scale = [0.12, 0.12, 0.5];
  p.yaw = b.facing; p.pitch = dead ? 0 : 0.3;
  p.albedo.set(def.albedo);

  out.length = i;
  return out;
}
