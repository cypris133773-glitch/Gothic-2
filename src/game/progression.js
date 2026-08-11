// Character growth: experience, levels, learning points, and the damage a swing
// actually does.
//
// Every number in this file comes from §5 of docs/BRIEF.md and carries the
// brief's confidence label in its comment. [V] means more than one community
// source agrees; [C] means one plausible source; [D] means we decided it. The
// labels travel with the numbers on purpose — a guess that loses its label is
// indistinguishable from a measurement, and six months from now nobody will
// remember which of these was which.

// --- experience and levels --------------------------------------------------

/**
 * XP cost of the single level `n` (that is, going from n-1 to n).
 * Level 1 costs 500 and every level after costs 500 more than the last. [V]
 */
export const LEVEL_XP = (n) => 500 * n;

/** Total XP a character has spent to *be* level `n`. 250·n·(n+1) is the sum. */
export const TOTAL_XP = (n) => 250 * n * (n + 1);

/** The level a given lifetime XP total buys. Level 0 is the start of the game. */
export function levelForXp(xp) {
  // Inverting 250n(n+1) ≤ xp. The closed form is cheap and exact enough, but a
  // fencepost here would silently hand out a free level, so it is corrected and
  // then asserted by the test suite across the first two hundred levels.
  let n = Math.floor((Math.sqrt(1 + (16 * xp) / 250) - 1) / 2);
  if (n < 0) n = 0;
  while (TOTAL_XP(n + 1) <= xp) n++;
  while (n > 0 && TOTAL_XP(n) > xp) n--;
  return n;
}

/** Learning points granted per level. [V] */
export const LP_PER_LEVEL = 10;

/** Health granted per level, on top of what permanent items have given. [C] */
export const HP_PER_LEVEL = 12;

/** Health at character creation, before anything is earned. [D] */
export const BASE_HP = 40;

// --- learning points --------------------------------------------------------

/**
 * LP cost to raise an attribute that currently sits at `value` by one point.
 *
 * Five bands, and the guild you belong to does not change them. [V] The bands
 * are what make late attribute points expensive enough that a player must
 * choose a character rather than eventually becoming all of them.
 */
export function lpForAttribute(value) {
  if (value <= 30) return 1;
  if (value <= 60) return 2;
  if (value <= 90) return 3;
  if (value <= 120) return 4;
  return 5;
}

/** Total LP to move an attribute from `from` to `to`. */
export function lpToRaise(from, to) {
  let sum = 0;
  for (let v = from; v < to; v++) sum += lpForAttribute(v);
  return sum;
}

/** Weapon-skill percentage points are bought on the same five-band curve. [C] */
export const lpForSkillPercent = lpForAttribute;

// --- combat -----------------------------------------------------------------

/**
 * Melee damage.
 *
 * A non-critical hit does a *tenth* of the raw figure; a critical does all of
 * it. [C] That single discontinuity is the whole shape of the combat curve: a
 * player at 10% one-handed is chipping at things, and the same player with the
 * same sword at 60% is a different character. Do not smooth this into a linear
 * scale to make the early game feel better — the early game is supposed to feel
 * like that, and §10.5 of the brief fixes the *legibility* of a floored hit in
 * presentation instead.
 */
export function meleeDamage({ weapon, str, armor, crit }) {
  const raw = weapon + str - armor;
  const dealt = crit ? raw : Math.floor((raw - 1) / 10);
  return Math.max(MIN_DAMAGE, dealt);
}

/**
 * Ranged damage. Dexterity replaces strength and there is no divisor on a
 * normal hit [C], which is why a bow is the honest answer to the early game.
 * The critical multiplier is ours: the community sources do not document one,
 * so rather than guess at the original's we double, and say so. [D]
 */
export function rangedDamage({ weapon, dex, armor, crit }) {
  const raw = weapon + dex - armor - 1;
  return Math.max(MIN_DAMAGE, crit ? raw * 2 : raw);
}

/** Nothing ever does less than this, however good the armour is. [C] */
export const MIN_DAMAGE = 5;

/** Weapon skill *is* the critical chance, as a percentage. [V] */
export const critChance = (skillPercent) => Math.max(0, Math.min(100, skillPercent)) / 100;

/**
 * How many swings can be chained, by weapon skill. [C]
 * Below the first band a swing stands alone, which is why an untrained
 * character feels like they are fighting in mud — correctly.
 */
export function comboTier(skillPercent) {
  if (skillPercent >= 60) return 4;
  if (skillPercent >= 30) return 3;
  if (skillPercent >= 10) return 2;
  return 1;
}
