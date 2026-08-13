// Daily routines.
//
// Everybody in this city has been standing on the same square metre since the
// world was built, including at three in the morning. A routine is the cheapest
// thing that fixes it and one of the most valuable: a town whose people are
// somewhere *different* at dusk is a town you look at twice.
//
// The design is deliberately small, because the expensive version of this is a
// scheduler with needs and utilities and it is not needed to get the effect.
//
// **A routine is a list of hours and places.** "At the anvil from six to
// nineteen, in the tavern until twenty-three, at home after that." The person
// walks to wherever the current slot says, at walking pace, on foot, through
// the same collision everything else uses. Nothing teleports.
//
// **It is a clock, not a script.** There is no state machine and no interrupt
// handling: at any moment the answer to "where should this person be" is a
// function of the hour alone. That means a save has nothing to store, a
// conversation cannot desynchronise anybody, and a person you followed for two
// days behaves the same on the second one.
//
// **Being somewhere is not the same as arriving.** A person who is already
// standing on his post does nothing at all — which is what keeps two hundred
// people from all walking on every tick.

/** How close counts as "there". Wider than it looks, because people mill. */
export const AT_POST = 1.6;

/** Walking pace for a routine. Nobody runs to the tavern. */
export const ROUTINE_SPEED = 1.35;

/**
 * Where this person should be at this hour.
 *
 * Slots are `{ from, at, look }` with `from` an hour of the day, and the one in
 * force is the last one whose `from` has passed. It does **not** wrap: a shift
 * that runs through midnight is written twice, once at 22:30 and once at 00:00.
 * That is deliberate — a day you have to spell out completely is a day with no
 * holes in it, and the alternative silently walked a night guard back to his
 * post at one minute past twelve.
 */
export function postAt(routine, hour) {
  if (!routine || !routine.length) return null;
  let best = routine[routine.length - 1];      // the one that runs through midnight
  for (const slot of routine) {
    if (hour >= slot.from) best = slot;
  }
  return best;
}

/**
 * Steer a person toward their post for one tick.
 *
 * Returns true if they moved. The caller owns the terrain and the gait; this
 * owns only the decision, which keeps it testable without a world.
 */
export function stepRoutine(person, hour, dt) {
  const slot = postAt(person.routine, hour);
  if (!slot) return false;

  const [tx, tz] = slot.at;
  const dx = tx - person.pos[0], dz = tz - person.pos[2];
  const dist = Math.hypot(dx, dz);

  if (dist < AT_POST) {
    // Arrived. Turn to face whatever this slot is about — the anvil, the fire,
    // the road — and then stand still, which is most of what people do.
    person.speed = 0;
    if (slot.look) {
      const want = Math.atan2(slot.look[0] - person.pos[0], slot.look[1] - person.pos[2]);
      person.yaw += clampTurn(want - person.yaw, 1.6 * dt);
    }
    return false;
  }

  const want = Math.atan2(dx, dz);
  person.yaw += clampTurn(want - person.yaw, 2.4 * dt);
  // Speed falls away as the heading is wrong, so a person turns a corner rather
  // than sliding round it.
  const off = Math.abs(shortest(want - person.yaw));
  person.speed = ROUTINE_SPEED * Math.max(0, 1 - off);
  person.pos[0] += Math.sin(person.yaw) * person.speed * dt;
  person.pos[2] += Math.cos(person.yaw) * person.speed * dt;
  return true;
}

function shortest(a) {
  let d = a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function clampTurn(a, limit) {
  const d = shortest(a);
  return Math.max(-limit, Math.min(limit, d));
}

/**
 * The shapes of a day, as templates.
 *
 * Four of them, because four is enough for a town to read as populated: people
 * who work somewhere fixed, people who walk a beat, people who keep a house,
 * and people who are only ever in one place. Each takes the positions it needs
 * and returns a routine, so the world file says *who* and this file says *how*
 * a day is shaped.
 */
export const DAYS = {
  /**
   * A tradesman: at his work all day, in the tavern in the evening, home at
   * night. `tavern` is a *seat*, not the building — four people given the same
   * point stand in each other and read as one very wide man.
   */
  tradesman: (work, look, tavern, home) => [
    { from: 0, at: home, look: work },
    { from: 6.5, at: work, look },
    { from: 19.5, at: tavern, look: tavern },
    { from: 23, at: home, look: work },
  ],
  /**
   * A guard: the same post, relieved at night.
   *
   * The midnight slot is quarters, not the post. `postAt` picks the last slot
   * whose hour has passed, so a night shift that starts at 22:30 has to be
   * written *twice* — once at 22:30 and once at 00:00 — or the guard walks back
   * to his post at one minute past midnight. There is no wrapping in `postAt`
   * on purpose: a day you have to spell out completely is a day with no holes
   * in it.
   */
  watch: (post, look, quarters) => [
    { from: 0, at: quarters, look: post },
    { from: 6, at: post, look },
    { from: 22.5, at: quarters, look: post },
  ],
  /** A townsperson: the market by day, the tavern by evening, home by night. */
  townsfolk: (market, tavern, home) => [
    { from: 0, at: home, look: market },
    { from: 7.5, at: market, look: market },
    { from: 18.5, at: tavern, look: tavern },
    { from: 22.5, at: home, look: market },
  ],
  /** Somebody who never leaves: a hermit, a priest, a man on a plateau. */
  fixed: (at, look) => [{ from: 0, at, look }],
};
