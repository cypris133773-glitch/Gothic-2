// Chests, locks, pockets, and being seen.
//
// Three skills — lockpicking, pickpocketing and sneaking — have been buyable
// and inert since the character sheet was written. This is what they buy, and
// the rule they all share is the one that makes stealing interesting at all:
//
// **The risk is being seen, not failing.** A locked chest is not a dice roll
// you pass or fail; it is a *time cost* spent in the open where somebody may
// walk past. A pocket is not a percentage; it is a range you have to be inside
// and a direction he must not be facing. The skill buys speed and margin, and
// the punishment for getting it wrong is a person turning round — which is a
// thing that happens in the world rather than a message that appears on screen.
//
// So nothing here rolls dice against the player. Everything here is geometry
// and a clock.

/**
 * How long a lock takes, in ticks, for somebody who knows how.
 *
 * Two, four and eight seconds. They are the *skilled* numbers because there is
 * no unskilled number: without the skill you cannot start at all, which is a
 * door rather than a penalty (P3).
 */
export const LOCK_TICKS = { simple: 110, good: 260, master: 460 };

/** How close you must be to a pocket, and how far round he must not be looking. */
export const POCKET_REACH = 1.5;
export const POCKET_ARC = 1.15;         // radians either side of his back

/** How far somebody notices you, standing and sneaking. */
export const SEEN_RANGE = 9.0;
export const SNEAK_RANGE = 3.6;
export const SEEN_ARC = 1.25;           // radians either side of where he is looking

/**
 * A chest.
 *
 * It is a thing in the world with a position, a lock and a list of what is in
 * it — and, crucially, an `open` flag that is saved. A chest you emptied stays
 * empty, which is the whole reason a player bothers to remember where one was.
 */
export function createChest(id, x, z, terrain, lock, loot) {
  return {
    id,
    pos: new Float32Array([x, terrain.heightAt(x, z), z]),
    lock: lock || null,               // null | 'simple' | 'good' | 'master'
    loot: loot || [],                 // [[itemId, n], ...]
    gold: 0,
    open: false,
    emptied: false,
    // Progress on the lock, in ticks. Kept on the chest rather than on the
    // player so that walking away from a half-picked lock loses the progress —
    // which is what makes being interrupted cost something.
    picked: 0,
  };
}

/**
 * One tick of picking.
 *
 * Returns `{ done, progress, why }`. It refuses without a lockpick and without
 * the skill, and it is deliberately *slow*: the longest lock is about six
 * seconds of standing still in somebody's front room.
 */
export function pick(chest, skilled, hasPick) {
  if (!chest.lock) return { done: true, progress: 1 };
  if (chest.open) return { done: true, progress: 1 };
  // The more fundamental problem first: a man who cannot pick locks does not
  // need to be told he is short a lockpick.
  if (!skilled) return { done: false, progress: chest.picked, why: 'you do not know how' };
  if (!hasPick) return { done: false, progress: chest.picked, why: 'you have no lockpick' };
  const need = LOCK_TICKS[chest.lock] ?? LOCK_TICKS.simple;
  chest.picked++;
  if (chest.picked >= need) {
    chest.picked = need;
    chest.open = true;
    return { done: true, progress: 1 };
  }
  return { done: false, progress: chest.picked / need };
}

/** Walking away from a half-picked lock loses it. */
export function abandonPick(chest) {
  if (chest && !chest.open) chest.picked = 0;
  return chest;
}

/**
 * Is this person able to see that point?
 *
 * The only question the whole of stealth reduces to, and it is answered with a
 * distance and an angle rather than with a roll. Sneaking shrinks the distance;
 * it does not narrow the cone, because a man crouching in front of you is still
 * a man in front of you.
 */
export function canSee(person, x, z, sneaking) {
  const dx = x - person.pos[0], dz = z - person.pos[2];
  const d = Math.hypot(dx, dz);
  const range = sneaking ? SNEAK_RANGE : SEEN_RANGE;
  if (d > range) return false;
  if (d < 0.7) return true;                       // stood on his feet
  let off = Math.atan2(dx, dz) - person.yaw;
  while (off > Math.PI) off -= Math.PI * 2;
  while (off < -Math.PI) off += Math.PI * 2;
  return Math.abs(off) <= SEEN_ARC;
}

/**
 * Can this pocket be picked right now, and if not, why not.
 *
 * Behind him, close, and nobody else watching. The third condition is the one
 * that makes a market square different from an empty lane, and it is why the
 * game bothers to have a market square.
 */
export function canPickPocket(person, player, witnesses, skilled, sneaking) {
  if (!skilled) return { ok: false, why: 'you do not know how' };
  if (person.robbed) return { ok: false, why: 'his purse is already yours' };
  const dx = player.pos[0] - person.pos[0], dz = player.pos[2] - person.pos[2];
  const d = Math.hypot(dx, dz);
  if (d > POCKET_REACH) return { ok: false, why: 'too far away' };

  // Behind him: the angle from *his* facing to you must be near a half turn.
  let off = Math.atan2(dx, dz) - person.yaw;
  while (off > Math.PI) off -= Math.PI * 2;
  while (off < -Math.PI) off += Math.PI * 2;
  if (Math.abs(Math.abs(off) - Math.PI) > POCKET_ARC) {
    return { ok: false, why: 'he is facing you' };
  }

  for (const w of witnesses) {
    if (w === person) continue;
    if (canSee(w, player.pos[0], player.pos[2], sneaking)) {
      return { ok: false, why: 'somebody is watching' };
    }
  }
  return { ok: true };
}
