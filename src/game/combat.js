// Combat: wind-up, active, recovery, and no way out of a swing you started.
//
// This is the file the whole game is about. The design is §6.2 of the brief and
// the numbers are ticks at 60 Hz, not seconds, because everything here is
// frame-exact and a variable timestep would make it unrepeatable.
//
// The rule that produces the feel is negative: **there is no transition out of
// ACTIVE except time and being staggered.** Not blocking, not rolling, not
// sheathing. A player who commits to a two-hander's eighteen-tick wind-up has
// committed for the next forty-seven ticks, and every interesting decision in a
// fight comes from that. Adding a cancel would be a one-line change and it
// would delete the game.

export const S = {
  IDLE: 0, WINDUP: 1, ACTIVE: 2, RECOVER: 3, PARRY: 4, BLOCK: 5, STAGGER: 6, DEAD: 7,
};
export const STATE_NAME = Object.fromEntries(Object.entries(S).map(([k, v]) => [v, k]));

/**
 * Weapons, in ticks. The combo window is expressed as an offset into RECOVER:
 * pressing attack inside it chains, pressing it outside is swallowed, which is
 * what makes a combo a rhythm rather than a button-mash.
 */
export const WEAPONS = {
  oneHanded: { windup: 10, active: 5, recover: 14, comboFrom: 5, comboTo: 12, reach: 1.9, arc: 1.6, damage: 40, poise: 22 },
  twoHanded: { windup: 18, active: 7, recover: 22, comboFrom: 8, comboTo: 18, reach: 2.4, arc: 1.9, damage: 75, poise: 40 },
  dagger: { windup: 6, active: 4, recover: 9, comboFrom: 3, comboTo: 8, reach: 1.5, arc: 1.3, damage: 22, poise: 12 },
  claws: { windup: 14, active: 5, recover: 20, comboFrom: 0, comboTo: 0, reach: 1.7, arc: 1.5, damage: 26, poise: 18 },
};

export const PARRY_TICKS = 9;         // the window that opens when block is pressed
export const PARRY_STAGGER = 20;      // what a successful parry costs the attacker
export const STAGGER_TICKS = 14;
// After a stagger, poise damage barely registers for a while. Without this the
// system stagger-locks: two landed hits break poise, the stagger is shorter
// than a swing cycle, and the aggressor's next blade arrives before the victim
// can act — for ever. The duel harness found it as "hold the attack button and
// never lose", which is the exact failure §17 of the brief warns about.
export const STAGGER_IMMUNE = 70;
export const KNOCKBACK = 0.34;        // metres a landed hit pushes the target back
export const POISE_RESET = 90;        // ticks of not being hit before poise recovers
export const BLOCK_ABSORB = 0.6;      // fraction of damage a passive block eats
export const WHIFF_RECOVERY = 1.7;    // how much longer a missed swing takes to recover from

export function createFighter(opts = {}) {
  return {
    state: S.IDLE, t: 0, combo: 0,
    weapon: WEAPONS[opts.weapon || 'oneHanded'],
    weaponName: opts.weapon || 'oneHanded',
    hp: opts.hp ?? 120, maxHp: opts.hp ?? 120,
    str: opts.str ?? 20, dex: opts.dex ?? 20,
    skill: opts.skill ?? 10,           // weapon percentage: this is the crit chance
    armor: opts.armor ?? 0,
    poise: opts.poise ?? 40, poiseLeft: opts.poise ?? 40, poiseTimer: 0, staggerImmune: 0,
    facing: 0, pos: new Float32Array(opts.pos || [0, 0, 0]),
    hitThisSwing: new Set(), landed: false,
    // Counters the tests and the HUD read.
    swings: 0, hits: 0, crits: 0, parries: 0, staggers: 0,
  };
}

const enter = (a, state, ticks) => { a.state = state; a.t = ticks; };

/**
 * Advance one fighter by one tick.
 *
 * `intent` is { attack, block } — the same shape whether it came from a mouse,
 * a gamepad or an AI controller, for the same reason movement intent is
 * (§ src/game/player.js).
 */
export function stepFighter(a, intent, rng) {
  if (a.state === S.DEAD) return a;
  if (a.t > 0) a.t--;

  // Poise recovers only after a stretch of not being hit, so a fight has a
  // rhythm: pressure someone and they break, back off and they recover.
  if (a.poiseTimer > 0 && --a.poiseTimer === 0) a.poiseLeft = a.poise;
  if (a.staggerImmune > 0) a.staggerImmune--;

  switch (a.state) {
    case S.IDLE:
      if (intent.attack) startSwing(a);
      else if (intent.block) enter(a, S.PARRY, PARRY_TICKS);
      break;

    case S.WINDUP:
      if (a.t <= 0) {
        enter(a, S.ACTIVE, a.weapon.active);
        a.hitThisSwing.clear();
        a.landed = false;
      }
      break;

    case S.ACTIVE:
      // Nothing here. That absence is the combat system; see the file header.
      if (a.t <= 0) {
        // A swing that hit nothing takes longer to recover from than one that
        // landed. A blade that connects is stopped by what it hit; a blade that
        // does not carries its own weight through the full arc, and the fighter
        // has to pull it back. It is also the mechanism that makes baiting a
        // swing worth doing: without it, a whiff costs a flailing attacker
        // nothing but time he intended to spend swinging anyway, and the duel
        // harness showed exactly that — hold-the-button beating space-and-parry
        // at every skill level.
        enter(a, S.RECOVER, Math.round(a.weapon.recover * (a.landed ? 1 : WHIFF_RECOVERY)));
      }
      break;

    case S.RECOVER: {
      const into = a.weapon.recover - a.t;
      const inWindow = into >= a.weapon.comboFrom && into <= a.weapon.comboTo;
      // A combo is earned by connecting. Chaining off a whiff is what turns
      // this system into a damage race: the duel harness had a fighter who
      // simply held the attack button beating one who spaced and parried, at
      // every skill level, because a missed swing cost him nothing but time he
      // was going to spend swinging anyway. Landing the hit is the price of the
      // next one.
      if (intent.attack && inWindow && a.landed && a.combo < comboLimit(a)) {
        a.combo++;
        startSwing(a, 0.8);            // a chained swing winds up faster
      } else if (a.t <= 0) {
        a.combo = 0;
        enter(a, S.IDLE, 0);
      }
      break;
    }

    case S.PARRY:
      if (!intent.block) enter(a, S.IDLE, 0);
      else if (a.t <= 0) enter(a, S.BLOCK, 0);   // the window decays into a guard
      break;

    case S.BLOCK:
      if (!intent.block) enter(a, S.IDLE, 0);
      else if (intent.attack) startSwing(a);
      break;

    case S.STAGGER:
      if (a.t <= 0) enter(a, S.IDLE, 0);
      break;
  }
  return a;
}

function startSwing(a, windupScale = 1) {
  enter(a, S.WINDUP, Math.max(2, Math.round(a.weapon.windup * windupScale)));
  a.swings++;
}

/** How many swings can be chained, from the weapon skill (§5.2). */
export function comboLimit(a) {
  if (a.skill >= 60) return 3;
  if (a.skill >= 30) return 2;
  if (a.skill >= 10) return 1;
  return 0;
}

/** Is this fighter's blade live this tick? */
export const isStriking = (a) => a.state === S.ACTIVE;

/**
 * Resolve one attacker's live blade against one target.
 *
 * The sweep is a wedge — reach and arc — tested every tick the blade is live
 * rather than at a single frame, so a fast swing cannot step over a target
 * between ticks. Each swing may only hit a given target once.
 */
export function resolveStrike(att, def, rng, damageFn) {
  if (!isStriking(att) || def.state === S.DEAD) return null;
  if (att.hitThisSwing.has(def)) return null;

  const dx = def.pos[0] - att.pos[0], dz = def.pos[2] - att.pos[2];
  const dist = Math.hypot(dx, dz);
  if (dist > att.weapon.reach) return null;
  const toTarget = Math.atan2(dx, dz);
  let off = toTarget - att.facing;
  while (off > Math.PI) off -= Math.PI * 2;
  while (off < -Math.PI) off += Math.PI * 2;
  if (Math.abs(off) > att.weapon.arc / 2) return null;

  att.hitThisSwing.add(def);

  // A parry is the only free lunch in the system, and it is nine ticks wide.
  if (def.state === S.PARRY && facingEachOther(att, def)) {
    enter(att, S.STAGGER, PARRY_STAGGER);
    att.combo = 0;
    att.landed = false;
    def.parries++;
    return { parried: true, damage: 0 };
  }

  const crit = rng() < Math.max(0, Math.min(100, att.skill)) / 100;
  let damage = damageFn({ weapon: att.weapon.damage, str: att.str, armor: def.armor, crit });
  let blocked = false;
  if (def.state === S.BLOCK && facingEachOther(att, def)) {
    damage = Math.max(1, Math.round(damage * (1 - BLOCK_ABSORB)));
    blocked = true;
  }

  def.hp -= damage;
  att.hits++;
  att.landed = true;
  if (crit) att.crits++;

  // Stagger is a budget, not a roll: enough damage inside a window breaks a
  // guard, and a boar is not staggerable by a dagger however many times it
  // lands.
  def.poiseLeft -= att.weapon.poise * (def.staggerImmune > 0 ? 0.2 : 1);
  def.poiseTimer = POISE_RESET;
  if (def.poiseLeft <= 0 && def.state !== S.STAGGER && def.staggerImmune === 0) {
    def.poiseLeft = def.poise;
    def.staggerImmune = STAGGER_IMMUNE;
    enter(def, S.STAGGER, STAGGER_TICKS);
    def.combo = 0;
    att.staggers++;
  }

  // A landed hit moves the target. It is a small distance and it does most of
  // the work of making spacing a real option: without it two fighters glue
  // themselves together at contact range and the fight is decided by who
  // swings faster rather than by who chooses better.
  if (dist > 1e-4) {
    def.pos[0] += (dx / dist) * KNOCKBACK;
    def.pos[2] += (dz / dist) * KNOCKBACK;
  }

  if (def.hp <= 0) { def.hp = 0; enter(def, S.DEAD, 0); }
  return { damage, crit, blocked, parried: false };
}

function facingEachOther(att, def) {
  const dx = att.pos[0] - def.pos[0], dz = att.pos[2] - def.pos[2];
  let off = Math.atan2(dx, dz) - def.facing;
  while (off > Math.PI) off -= Math.PI * 2;
  while (off < -Math.PI) off += Math.PI * 2;
  return Math.abs(off) < 1.2;          // a guard covers the front, not the back
}

/** Every attack must telegraph. The test suite asserts this over all weapons. */
export const MIN_TELEGRAPH = 12;
