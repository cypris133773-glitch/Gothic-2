// Magic: runes, mana, and things that travel.
//
// Three rules, and they are the same three that shape every other system here.
//
// **A rune is an item.** You do not "know" fireball; you carry the rune for it,
// it takes a slot, it can be sold, and losing it loses the spell. That is what
// makes the Chapter's path feel like equipment rather than like a menu that
// filled itself in.
//
// **Mana is a wall, not a modifier** (pillar P3). Under the rune's mana
// requirement you cannot cast it at all — not "you cast it weaker". Crossing a
// threshold is a door opening, exactly as it is for a sword's strength.
//
// **A bolt is a thing in the world.** It leaves your hand, it takes time to
// arrive, it can miss, and it can hit the wrong creature because that creature
// walked into it. A spell that resolves instantly on a target is a dice roll
// with a particle effect on it.

import { MAT } from '../assets/texgen.js';

/**
 * The spells, and what they cost.
 *
 * `mana` is the attribute you must *have*; `cost` is what casting spends from
 * the pool. The two are deliberately different numbers: a novice with exactly
 * enough mana to hold a rune can cast it perhaps twice before he is empty, and
 * that gap is the whole of what raising mana buys you.
 */
export const SPELLS = {
  fire_bolt: {
    name: 'Rune of the fire bolt', short: 'Fire bolt',
    mana: 10, cost: 8, damage: 46, speed: 26, life: 90,
    radius: 0.34, colour: [0.62, 0.22, 0.05], tex: MAT.FLAT,
    // Frames, at 60 Hz, exactly like a weapon's. A caster is committed the same
    // way a swordsman is, which is why a mage can be punished for casting into
    // a closing wolf.
    windup: 22, recover: 30,
  },
  ice_lance: {
    name: 'Rune of the ice lance', short: 'Ice lance',
    mana: 25, cost: 16, damage: 78, speed: 34, life: 100,
    radius: 0.28, colour: [0.20, 0.40, 0.62], tex: MAT.FLAT,
    windup: 30, recover: 34,
  },
  fire_storm: {
    name: 'Rune of the firestorm', short: 'Firestorm',
    mana: 45, cost: 34, damage: 120, speed: 18, life: 120,
    radius: 0.62, colour: [0.70, 0.30, 0.06], tex: MAT.FLAT,
    windup: 42, recover: 48,
    // A storm hits everything it passes rather than stopping at the first
    // thing, which is what forty-five mana is actually for.
    pierces: true,
  },
  heal_wound: {
    name: 'Rune of the closed wound', short: 'Heal',
    mana: 15, cost: 20, heals: 70,
    windup: 34, recover: 40,
    self: true, colour: [0.55, 0.50, 0.20],
  },
};

/** Which rune item grants which spell. */
export const RUNE_SPELL = {
  rune_fire_bolt: 'fire_bolt',
  rune_ice_lance: 'ice_lance',
  rune_fire_storm: 'fire_storm',
  rune_heal: 'heal_wound',
};

export const MANA_REGEN = 0.9;        // points per second, standing or walking

/** A caster's pool. Kept beside the fighter rather than inside it: a sword has no mana. */
export function createCaster(character) {
  return {
    mana: character.mana,
    max: character.mana,
    // Frames left in the current cast, and which spell it is.
    t: 0,
    casting: null,
    // Set on the tick the bolt actually leaves the hand, so the world can spawn
    // it without the caster knowing what a projectile is.
    released: null,
  };
}

/**
 * Bring the pool in line with the sheet — after training, or after a load.
 *
 * Raising the attribute *gives* you the points rather than merely raising the
 * ceiling. Buying ten mana and finding the pool still empty is technically
 * defensible and reads, at the moment of purchase, as the trainer having taken
 * your learning points and given you nothing.
 */
export function syncCaster(caster, character) {
  const grew = Math.max(0, character.mana - caster.max);
  caster.max = character.mana;
  caster.mana = Math.min(caster.max, caster.mana + grew);
  return caster;
}

/**
 * Can this character cast this spell right now, and if not, why not.
 *
 * Returns a reason rather than a boolean because every one of these is
 * something the player needs told: an empty pool and a missing rune are
 * different problems with different answers.
 */
export function canCast(spellId, character, caster, carrying) {
  const spell = SPELLS[spellId];
  if (!spell) return { ok: false, why: `there is no spell "${spellId}"` };
  const rune = Object.keys(RUNE_SPELL).find((r) => RUNE_SPELL[r] === spellId);
  if (carrying && !carrying(rune)) return { ok: false, why: `you are not carrying the ${spell.name}` };
  if (character.mana < spell.mana) {
    return { ok: false, why: `${spell.short} needs ${spell.mana} mana and you have ${character.mana}` };
  }
  if (caster.mana < spell.cost) {
    return { ok: false, why: `not enough mana — ${spell.cost} needed, ${Math.floor(caster.mana)} left` };
  }
  if (caster.casting) return { ok: false, why: 'already casting' };
  return { ok: true, spell };
}

/**
 * Begin a cast. The mana goes now, at the start, not on release — a cast you
 * are interrupted out of has still cost you, which is the only thing that makes
 * being interrupted matter.
 */
export function beginCast(spellId, caster) {
  const spell = SPELLS[spellId];
  caster.casting = spellId;
  caster.t = spell.windup + spell.recover;
  caster.mana -= spell.cost;
  return caster;
}

/** One tick of the pool. Returns the spell released this tick, or null. */
export function stepCaster(caster, dt) {
  caster.released = null;
  if (caster.casting) {
    const spell = SPELLS[caster.casting];
    caster.t--;
    // It leaves the hand at the end of the wind-up, not at the end of the cast.
    if (caster.t === spell.recover) caster.released = caster.casting;
    if (caster.t <= 0) { caster.casting = null; caster.t = 0; }
  } else if (caster.mana < caster.max) {
    caster.mana = Math.min(caster.max, caster.mana + MANA_REGEN * dt);
  }
  return caster.released;
}

/** A cast in progress is a commitment: being hit ends it and keeps the mana. */
export function breakCast(caster) {
  if (!caster.casting) return false;
  caster.casting = null;
  caster.t = 0;
  caster.released = null;
  return true;
}

// --- things that travel -------------------------------------------------------

/**
 * How big a target is, as a cylinder: half-width, and how high its middle is.
 *
 * Shared by bolts and arrows so the two can never disagree about the size of a
 * wolf. A creature declares its body; anything else is a man.
 */
export function hitVolume(t) {
  const body = t.def && t.def.body ? Math.max(t.def.body[0], t.def.body[2]) * 0.5 : 0.42;
  const chest = t.def && t.def.body ? t.def.body[1] * 0.5 + (t.def.legs || 0) : 1.0;
  return { r: body, chest };
}

/**
 * Did a projectile pass through this target *between* two ticks?
 *
 * This is the difference between a bow that works and a bow that does not. An
 * arrow travels 1.03 m per tick; a wolf is about 1.2 m across. A test that asks
 * "is the arrow inside the wolf right now" therefore misses more often than it
 * hits — the arrow is 1.17 m in front on one tick and 0.14 m behind on the
 * next, and was never inside on either. The measured hit rate for a master
 * archer at twelve metres was sixty-eight per cent, which reads as a broken
 * weapon and was a broken test.
 *
 * So: closest approach of the segment `from → to` to the target's centre,
 * clamped to the segment. Cheap, exact enough, and it makes the arrow's speed
 * a property of the arrow rather than of the tick rate.
 */
export function sweepHits(from, to, target, radius) {
  const { r, chest } = hitVolume(target);
  const cx = target.pos[0], cy = target.pos[1] + chest, cz = target.pos[2];
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
  const len2 = dx * dx + dy * dy + dz * dz;
  let t = len2 > 1e-9
    ? ((cx - from[0]) * dx + (cy - from[1]) * dy + (cz - from[2]) * dz) / len2
    : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const px = from[0] + dx * t, py = from[1] + dy * t, pz = from[2] + dz * t;
  // A body is taller than it is wide, so the vertical miss is measured against
  // the half-height and the horizontal against the half-width.
  const flat = Math.hypot(px - cx, pz - cz);
  const rise = Math.abs(py - cy);
  // A graze counts. Twenty centimetres of slack on the flank, because the
  // bodies here are boxes standing in for animals and the last thing a player
  // should be doing is arguing with a hitbox corner.
  return flat <= r + radius + 0.2 && rise <= chest + radius + 0.2;
}

/**
 * A bolt.
 *
 * It is a position, a velocity and a countdown, and it is stepped by the world
 * exactly like everything else. It carries `from` so that a caster cannot be
 * hit by his own storm, and `hit` so that a non-piercing bolt stops at the
 * first thing it touches rather than raking a line through a pack.
 */
export function createBolt(spellId, pos, yaw, pitch = 0) {
  const spell = SPELLS[spellId];
  const cy = Math.cos(pitch);
  return {
    spell: spellId,
    pos: new Float32Array([pos[0], pos[1], pos[2]]),
    vel: new Float32Array([
      Math.sin(yaw) * cy * spell.speed,
      Math.sin(pitch) * spell.speed,
      Math.cos(yaw) * cy * spell.speed,
    ]),
    life: spell.life,
    hit: new Set(),
    spin: 0,
  };
}

/**
 * Move a bolt and report what it touched.
 *
 * `targets` are anything with `pos` and a `state`; the caller decides what to do
 * about a hit, because the world owns damage and this file owns flight.
 */
export function stepBolt(bolt, targets, terrain, dt) {
  const spell = SPELLS[bolt.spell];
  const was = [bolt.pos[0], bolt.pos[1], bolt.pos[2]];
  bolt.pos[0] += bolt.vel[0] * dt;
  bolt.pos[1] += bolt.vel[1] * dt;
  bolt.pos[2] += bolt.vel[2] * dt;
  bolt.spin += dt * 9;
  bolt.life--;

  // Into the ground is the end of it. A bolt that skims a hillside for ever is
  // a bolt the player stops respecting.
  if (terrain && bolt.pos[1] < terrain.heightAt(bolt.pos[0], bolt.pos[2])) {
    bolt.life = 0;
    return [];
  }

  const struck = [];
  for (const t of targets) {
    if (t.state === 7 || bolt.hit.has(t)) continue;
    // Swept against the path taken this tick, not against the point it ended
    // at — see `sweepHits`. A bolt is slower than an arrow and tunnels less,
    // but "less" is not "not".
    if (!sweepHits(was, bolt.pos, t, spell.radius)) continue;
    bolt.hit.add(t);
    struck.push(t);
    if (!spell.pierces) { bolt.life = 0; break; }
  }
  return struck;
}

/** What the renderer draws for a bolt in flight. */
export function poseBolt(out, bolt) {
  const spell = SPELLS[bolt.spell];
  const r = spell.radius;
  out.pos = [bolt.pos[0], bolt.pos[1], bolt.pos[2]];
  out.yaw = Math.atan2(bolt.vel[0], bolt.vel[2]);
  out.pitch = bolt.spin;
  out.scale = [r * 2, r * 2, r * 3.2];
  out.albedo = spell.colour;
  out.tex = spell.tex || MAT.FLAT;
  // It makes its own light. Without this a fire bolt at dusk is a brown box
  // travelling at twenty-six metres a second.
  out.glow = 1;
  return out;
}
