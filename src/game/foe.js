// Men who will fight you.
//
// A beast is five boxes and one decision every quarter second. A man is the
// *same skeleton the player has*, wearing the same armour pieces, holding the
// same weapons, running the same combat state machine — and that is the whole
// design. Everything the player learns about timing on a bandit transfers to a
// keep guard and to a duel, because there is one fight system and no creature
// has a private version of it.
//
// The one thing a man does that a wolf does not is **block**. A wolf is a
// timing puzzle you solve by spacing; a man is a timing puzzle you solve by
// making him commit. That difference is four lines in `stepFoe` and it is why
// the lighthouse feels different from the wood.

import { createFighter, stepFighter, S } from './combat.js';
import { KITS } from './rig.js';

export const FOES = {
  // The lighthouse, chapter three. Reachable at level three, survivable at
  // ten — a statement about *these numbers*, not a locked door, and measured
  // rather than asserted: against a bot that spaces and parries, eight of them
  // kill a level-six character in nine seconds, beat a level-eight one on two
  // seeds out of three (one of those losses with a single bandit left), and
  // lose to a level-ten one with sixty per cent of his health intact.
  //
  // Eight is therefore the *knife edge* and ten is the answer, which is a
  // better shape than a clean threshold: the player who tries it early is not
  // wrong, he is early.
  bandit: {
    name: 'Bandit',
    hp: 84, armor: 13, str: 23, skill: 40, poise: 40, weapon: 'oneHanded',
    speed: 4.0, aggro: 20, keepOut: 1.9, xp: 140, gold: [12, 40],
    kit: 'leather', rest: 46, blockChance: 0.42,
    drops: [{ item: 'rusty_blade', chance: 0.25 }, { item: 'healing_draught', chance: 0.3 }],
  },
  brigand: {
    name: 'Brigand',
    hp: 128, armor: 24, str: 32, skill: 55, poise: 62, weapon: 'oneHanded',
    speed: 4.2, aggro: 22, keepOut: 1.9, xp: 260, gold: [30, 90],
    kit: 'freeblade', rest: 40, blockChance: 0.55,
    drops: [{ item: 'militia_sword', chance: 0.3 }, { item: 'strong_draught', chance: 0.35 }],
  },
  // Behind the keep's wall. They were miners a year ago, which is why they are
  // in mail that does not fit and fight like men who learned it recently.
  keeper: {
    name: 'Keep guard',
    hp: 190, armor: 38, str: 42, skill: 62, poise: 80, weapon: 'oneHanded',
    // keepOut is *inside* a one-handed weapon's 1.9 m reach on purpose. At 2.0
    // the keep guards stood exactly one centimetre further away than the player
    // could swing, and a bot that closes only to contact never landed a blow —
    // six of them and a level-nineteen character deadlocked for an hour. A foe
    // who will not come inside your reach is a foe you cannot fight.
    speed: 4.0, aggro: 24, keepOut: 1.8, xp: 420, gold: [60, 160],
    kit: 'watch', rest: 36, blockChance: 0.62,
    drops: [{ item: 'forged_blade', chance: 0.2 }, { item: 'strong_draught', chance: 0.5 }],
  },
  /**
   * The last man, at the bottom of the deep pit.
   *
   * He is not a different *kind* of thing — same skeleton, same state machine,
   * same four frames of parry window — because the whole promise of this combat
   * system is that what you learned on a wolf still applies at the end. He is
   * simply the best of them: he blocks more than he swings, he takes a very long
   * time to break, and he hits hard enough that the fight is decided by whether
   * you can make him commit.
   *
   * A boss with private rules is a boss that throws away everything the player
   * spent forty hours learning.
   */
  warden: {
    name: 'The Warden',
    hp: 950, armor: 56, str: 62, skill: 84, poise: 170, weapon: 'twoHanded',
    speed: 4.1, aggro: 30, keepOut: 2.3, xp: 4000, gold: [400, 900],
    kit: 'knight', rest: 30, blockChance: 0.7,
    drops: [{ item: 'war_axe', chance: 1 }, { item: 'elixir_str', chance: 1 }],
    boss: true,
  },
};

export function createFoe(kind, x, z, terrain, rng = Math.random) {
  const def = FOES[kind];
  if (!def) throw new Error(`no foe "${kind}"`);
  const f = createFighter({
    hp: def.hp, armor: def.armor, str: def.str, skill: def.skill,
    poise: def.poise, weapon: def.weapon, pos: [x, terrain.heightAt(x, z), z],
  });
  f.kind = kind;
  f.def = def;
  f.foe = true;
  f.rest = 0;
  f.think = 0;
  f.circle = rng() < 0.5 ? 1 : -1;
  // What the model looks like. A man in mail reads as a harder fight than a man
  // in leather from thirty metres away, which is the only warning the game
  // gives before you are in range of him.
  f.kit = KITS[def.kit] || KITS.leather;
  f.speed = 0;
  f.phase = rng() * Math.PI * 2;
  f.yaw = 0;
  // `home` is what stops the lighthouse emptying itself into the countryside:
  // a man who chases you forever is a man you can pull away one at a time from
  // two hundred metres, which turns every camp in the game into a queue.
  f.home = [x, z];
  return f;
}

/**
 * One man, one tick.
 *
 * Three states of mind, and the whole difficulty of a human enemy is in which
 * one he is in: closing, waiting (blocking), or committed. The decision is
 * re-made every `think` ticks so that whatever he chose, he is stuck with it
 * for a fraction of a second — which is exactly what makes him baitable.
 */
export function stepFoe(f, player, terrain, dt, rng = Math.random) {
  if (f.state === S.DEAD) { f.speed = 0; return f; }
  const def = f.def;
  const dx = player.pos[0] - f.pos[0], dz = player.pos[2] - f.pos[2];
  const dist = Math.hypot(dx, dz);
  const want = Math.atan2(dx, dz);

  if (f.rest > 0) f.rest--;
  if (f.think > 0) f.think--;
  else {
    f.think = 20;
    if (rng() < 0.3) f.circle = -f.circle;
    // Whether he will stand and take the next swing on his guard. Decided here
    // rather than per tick, so a player who reads him has time to act on it.
    f.guarding = rng() < def.blockChance;
  }

  const rooted = f.state === S.WINDUP || f.state === S.ACTIVE || f.state === S.STAGGER;
  let turn = want - f.facing;
  while (turn > Math.PI) turn -= Math.PI * 2;
  while (turn < -Math.PI) turn += Math.PI * 2;
  if (!rooted) f.facing += Math.max(-3.6 * dt, Math.min(3.6 * dt, turn));
  f.yaw = f.facing;

  // How far he has strayed from where he was posted.
  const leash = Math.hypot(f.pos[0] - f.home[0], f.pos[2] - f.home[1]);
  const engaged = dist < def.aggro && leash < 46;

  const intent = { attack: false, block: false };
  f.speed = 0;

  if (!engaged && leash > 2) {
    // Walk back to his post. Not a teleport and not a heal: he goes home at
    // walking pace and he keeps the wounds you gave him.
    const hx = f.home[0] - f.pos[0], hz = f.home[1] - f.pos[2];
    const heading = Math.atan2(hx, hz);
    if (!rooted) {
      f.facing += Math.max(-2.4 * dt, Math.min(2.4 * dt, ((heading - f.facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI));
      f.pos[0] += Math.sin(f.facing) * def.speed * 0.5 * dt;
      f.pos[2] += Math.cos(f.facing) * def.speed * 0.5 * dt;
      f.speed = def.speed * 0.5;
      f.yaw = f.facing;
    }
  } else if (engaged && !rooted) {
    if (dist > def.keepOut) {
      const heading = f.facing + f.circle * 0.3;
      f.pos[0] += Math.sin(heading) * def.speed * dt;
      f.pos[2] += Math.cos(heading) * def.speed * dt;
      f.speed = def.speed;
    } else if (f.rest === 0 && Math.abs(turn) < 0.55) {
      intent.attack = true;
      f.rest = def.rest;
    } else if (f.guarding) {
      // In range, not ready to swing, and he has decided to wait behind his
      // guard. This is the state that makes a man different from a wolf.
      intent.block = true;
    }
  }

  stepFighter(f, intent, rng);
  f.pos[1] = terrain.heightAt(f.pos[0], f.pos[2]);
  advanceFoeGait(f, dt);
  return f;
}

/** The same distance-driven phase the townspeople use, so gaits match. */
function advanceFoeGait(f, dt) {
  f.phase = (f.phase || 0) + (f.speed || 0) * dt * (Math.PI * 2 / 1.6);
  if (f.phase > Math.PI * 4) f.phase -= Math.PI * 4;
}

/**
 * What a dead or living man is worth.
 *
 * Kept here rather than in the world so that the loot table and the creature
 * live in the same file: adding a foe should never mean editing two places and
 * discovering the second one a week later.
 */
export function foeSpoils(f, rng = Math.random) {
  const def = f.def;
  const gold = Math.round(def.gold[0] + rng() * (def.gold[1] - def.gold[0]));
  const items = [];
  for (const drop of def.drops || []) {
    if (rng() < drop.chance) items.push(drop.item);
  }
  return { xp: def.xp, gold, items };
}
