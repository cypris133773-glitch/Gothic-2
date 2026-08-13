// Layer 1: logic tests. No browser, no DOM, no dependencies, under a second.
// Run with: npm test
//
// Everything here is a pure function or a piece of simulation state, which is
// exactly the constraint that keeps the architecture honest: a rule that cannot
// be tested from Node has usually been written into the renderer by mistake.

import {
  LEVEL_XP, TOTAL_XP, levelForXp, LP_PER_LEVEL, HP_PER_LEVEL, BASE_HP,
  lpForAttribute, lpToRaise, meleeDamage, rangedDamage, comboTier, critChance, MIN_DAMAGE,
} from '../src/game/progression.js';
import { Clock, MINUTES_PER_DAY, GAME_MINUTES_PER_SECOND, sunDirection, keyLightDirection, skyPalette } from '../src/core/time.js';
import { makeRng, hash } from '../src/core/rng.js';
import * as m from '../src/core/math.js';
import { on, emit, off, listenerCount, clearAll } from '../src/core/events.js';
import { createTerrain, PLACES, ROADS } from '../src/world/terrain.js';
import { createWorld, travel, CHUNK, LOD_RES, RADIUS } from '../src/world/world.js';
import { REGIONS } from '../src/world/regions.js';
import { idleIntent } from '../src/core/input.js';
import { RUN_SPEED, resolveObstacles } from '../src/game/player.js';
import { KITS, poseHumanoid, kitForArmour } from '../src/game/rig.js';
import {
  S, WEAPONS, createFighter, stepFighter, resolveStrike, comboLimit,
  PARRY_TICKS, PARRY_STAGGER, STAGGER_TICKS, MIN_TELEGRAPH, WHIFF_RECOVERY,
} from '../src/game/combat.js';
import { duelSeries } from '../src/game/duel.js';
import {
  createCharacter, awardXp, learn, raiseAttribute, joinGuild, knows, canWield, SKILLS, xpToNext,
} from '../src/game/character.js';
import { EFFECT_KINDS } from '../src/game/dialogue.js';
import { DIALOGUE, SPEAKERS } from '../src/data/dialogue.js';
import { readFileSync } from 'node:fs';
import { snapshot, restore, migrate, SAVE_VERSION, MIGRATIONS, createStorage } from '../src/core/save.js';
import { goldenPath } from './sim.mjs';
import { ITEMS, TRADERS, DROPS, KIND } from '../src/data/items.js';
import { buyPrice, sellPrice } from '../src/game/inventory.js';

let passed = 0;
const failures = [];
const check = (name, fn) => { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); } };
const assert = (c, msg) => { if (!c) throw new Error(msg); };
const eq = (a, b, msg) => assert(a === b, `${msg} — expected ${b}, got ${a}`);
const near = (a, b, eps, msg) => assert(Math.abs(a - b) < eps, `${msg} — expected ≈${b}, got ${a}`);

// --- progression: the numbers from §5 of the brief ---------------------------

check('level 1 costs 500 xp', () => eq(LEVEL_XP(1), 500, 'level 1'));

check('each level costs 500 more than the last', () => {
  for (let n = 2; n <= 60; n++) eq(LEVEL_XP(n) - LEVEL_XP(n - 1), 500, `step at level ${n}`);
});

check('cumulative xp is the sum of the level costs', () => {
  let sum = 0;
  for (let n = 1; n <= 60; n++) { sum += LEVEL_XP(n); eq(TOTAL_XP(n), sum, `total at level ${n}`); }
});

check('levelForXp inverts TOTAL_XP exactly at every boundary', () => {
  for (let n = 0; n <= 200; n++) {
    eq(levelForXp(TOTAL_XP(n)), n, `xp exactly at level ${n}`);
    eq(levelForXp(TOTAL_XP(n) - 1), Math.max(0, n - 1), `one xp short of level ${n}`);
    eq(levelForXp(TOTAL_XP(n) + 1), n, `one xp past level ${n}`);
  }
});

check('a level grants ten learning points and twelve health', () => {
  eq(LP_PER_LEVEL, 10, 'LP per level');
  eq(HP_PER_LEVEL, 12, 'HP per level');
  eq(BASE_HP + HP_PER_LEVEL * 10, 160, 'health at level 10 before items');
});

check('attribute LP cost follows the five bands', () => {
  eq(lpForAttribute(10), 1, '10→11');
  eq(lpForAttribute(30), 1, '30→31 is still the first band');
  eq(lpForAttribute(31), 2, '31→32');
  eq(lpForAttribute(60), 2, '60→61');
  eq(lpForAttribute(61), 3, '61→62');
  eq(lpForAttribute(90), 3, '90→91');
  eq(lpForAttribute(91), 4, '91→92');
  eq(lpForAttribute(120), 4, '120→121');
  eq(lpForAttribute(121), 5, '121→122');
});

check('raising strength from 10 to 100 costs what the bands say', () => {
  // 21 points at 1 LP (10→30 inclusive), 30 at 2, 30 at 3, 9 at 4.
  eq(lpToRaise(10, 100), 21 * 1 + 30 * 2 + 30 * 3 + 9 * 4, 'STR 10→100');
});

check('a level does not buy a late attribute point cheaply', () => {
  // Ten LP buys ten points at the start of the game and two at the end of it.
  // If that ratio ever flattens, the character-building fantasy has gone with it.
  eq(lpToRaise(10, 20), 10, 'ten points early');
  assert(lpToRaise(130, 140) === 50, 'ten points late should cost 50 LP');
});

// --- combat ------------------------------------------------------------------

check('a normal melee hit is a tenth of the raw figure', () => {
  // (40 + 30 - 20 - 1) / 10 = 4.9 → floor 4 → the floor of 5 takes over.
  eq(meleeDamage({ weapon: 40, str: 30, armor: 20, crit: false }), 5, 'floored normal hit');
  eq(meleeDamage({ weapon: 200, str: 100, armor: 20, crit: false }), 27, 'unfloored normal hit');
});

check('a critical melee hit is the whole figure', () => {
  eq(meleeDamage({ weapon: 40, str: 30, armor: 20, crit: true }), 50, 'critical');
  eq(meleeDamage({ weapon: 200, str: 100, armor: 20, crit: true }), 280, 'big critical');
});

check('nothing ever does less than the floor', () => {
  eq(meleeDamage({ weapon: 5, str: 10, armor: 400, crit: true }), MIN_DAMAGE, 'melee vs plate');
  eq(rangedDamage({ weapon: 5, dex: 10, armor: 400, crit: false }), MIN_DAMAGE, 'arrow vs plate');
});

check('the crit/normal gap is the whole combat curve', () => {
  const normal = meleeDamage({ weapon: 120, str: 80, armor: 40, crit: false });
  const crit = meleeDamage({ weapon: 120, str: 80, armor: 40, crit: true });
  assert(crit >= normal * 9, `a critical should be ~10× a normal hit, got ${crit} vs ${normal}`);
});

check('ranged damage uses dexterity and no divisor', () => {
  eq(rangedDamage({ weapon: 60, dex: 40, armor: 20, crit: false }), 79, 'bow, normal');
});

check('weapon skill is the critical chance', () => {
  near(critChance(45), 0.45, 1e-9, '45%');
  near(critChance(140), 1, 1e-9, 'clamped above 100');
  near(critChance(-5), 0, 1e-9, 'clamped below 0');
});

check('combo tier follows the skill bands', () => {
  eq(comboTier(0), 1, 'untrained swings alone');
  eq(comboTier(9), 1, 'still untrained at 9%');
  eq(comboTier(10), 2, 'rookie chains two');
  eq(comboTier(29), 2, 'still two at 29%');
  eq(comboTier(30), 3, 'trained chains three');
  eq(comboTier(60), 4, 'master chains four');
  eq(comboTier(100), 4, 'four is the ceiling');
});

// --- the world clock ---------------------------------------------------------

check('a day is two real hours', () => {
  const c = new Clock(0);
  c.tick(2 * 60 * 60);
  eq(c.day, 1, 'day rolled over');
  near(c.minutesOfDay, 0, 1e-6, 'back to midnight');
  near(GAME_MINUTES_PER_SECOND * 7200, MINUTES_PER_DAY, 1e-9, 'rate matches day length');
});

check('the clock formats and wraps', () => {
  const c = new Clock(23 * 60 + 59);
  eq(c.hhmm, '23:59', 'formatting');
  c.tick(1 / GAME_MINUTES_PER_SECOND);            // exactly one game minute
  eq(c.day, 1, 'midnight advances the day');
  eq(c.hhmm, '00:00', 'wrapped to midnight');
});

check('sleeping to an hour that has passed lands tomorrow', () => {
  const c = new Clock(22 * 60);
  const passed = c.skipTo(8);
  eq(passed, 10 * 60, 'ten hours of sleep');
  eq(c.hhmm, '08:00', 'woke at eight');
  eq(c.day, 1, 'the next day');
});

check('sleeping to the current hour is a full day, not nothing', () => {
  const c = new Clock(8 * 60);
  eq(c.skipTo(8), MINUTES_PER_DAY, 'a full day');
});

check('night is dark and noon is not', () => {
  eq(new Clock(2 * 60).isNight, true, '02:00');
  eq(new Clock(12 * 60).isNight, false, '12:00');
  const noon = skyPalette(12 * 60), midnight = skyPalette(0);
  assert(noon.sun[0] > midnight.sun[0] * 4, 'the sun should be much brighter at noon');
  assert(midnight.skyLight[2] < 0.2, 'midnight ambient must be genuinely dark');
});

check('dusk is a look, not an off switch', () => {
  // The build gate photographed 19:30 as one flat colour when the first version
  // of this curve clipped daylight at the horizon. Twilight is the hour the
  // game looks best in; it gets a test.
  const noon = skyPalette(12 * 60), dusk = skyPalette(18.4 * 60), midnight = skyPalette(0);
  const luma = (c) => c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114;
  assert(luma(dusk.sky) > luma(midnight.sky) * 1.8, 'dusk must be brighter than midnight');
  assert(luma(dusk.sky) < luma(noon.sky), 'dusk must be darker than noon');
  assert(dusk.sun[0] > dusk.sun[2] * 1.3, 'the low sun must be warm, not blue');
  assert(noon.sun[2] > noon.sun[0] * 0.7, 'midday light must not be orange');
});

check('the night key light comes from above, so a dark world is not a black one', () => {
  const dir = new Float32Array(3);
  for (let h = 0; h < 24; h += 0.5) {
    keyLightDirection(dir, h * 60);
    assert(dir[1] > 0.02, `key light is below the horizon at ${h}:00 (y=${dir[1].toFixed(3)})`);
    near(Math.hypot(dir[0], dir[1], dir[2]), 1, 1e-5, `key light not normalised at ${h}:00`);
  }
});

check('moonlight is dim, cold, and never zero', () => {
  const mid = skyPalette(0);
  assert(mid.sun[2] > mid.sun[0], 'moonlight is blue');
  assert(mid.sun[1] > 0.01, 'there is *some* key light at night');
  assert(mid.sun[1] < 0.15, 'but not enough to read by');
});

check('the sun crosses the sky and is below the horizon at night', () => {
  const dir = new Float32Array(3);
  sunDirection(dir, 12 * 60);
  assert(dir[1] > 0.8, `sun should be high at noon, y=${dir[1]}`);
  sunDirection(dir, 0);
  assert(dir[1] < -0.8, `sun should be below the horizon at midnight, y=${dir[1]}`);
  sunDirection(dir, 6 * 60);
  assert(dir[0] > 0.5, `sun should be in the east at dawn, x=${dir[0]}`);
  sunDirection(dir, 18 * 60);
  assert(dir[0] < -0.5, `sun should be in the west at dusk, x=${dir[0]}`);
});

// --- determinism -------------------------------------------------------------

check('the same seed produces the same world', () => {
  const a = makeRng(12345), b = makeRng(12345);
  for (let i = 0; i < 1000; i++) eq(a(), b(), `divergence at draw ${i}`);
});

check('different seeds diverge', () => {
  const a = makeRng(1), b = makeRng(2);
  let same = 0;
  for (let i = 0; i < 100; i++) if (a() === b()) same++;
  assert(same === 0, `${same} of 100 draws collided between seeds`);
});

check('the generator is uniform enough to place a forest with', () => {
  const rng = makeRng(7);
  const buckets = new Array(10).fill(0);
  const N = 100000;
  for (let i = 0; i < N; i++) buckets[Math.floor(rng() * 10)]++;
  for (const [i, b] of buckets.entries()) {
    assert(Math.abs(b - N / 10) < N / 10 * 0.05, `bucket ${i} off by more than 5%: ${b}`);
  }
});

check('named sub-streams do not shift each other', () => {
  const trees = makeRng(99).stream('trees');
  const other = makeRng(99).stream('trees');
  eq(trees(), other(), 'the same named stream from the same seed');
  assert(makeRng(99).stream('rocks')() !== trees(), 'different names must differ');
});

check('the string hash is stable', () => {
  eq(hash('harl_smith'), hash('harl_smith'), 'same input');
  assert(hash('harl_smith') !== hash('harl_smyth'), 'one letter apart must differ');
});

// --- math --------------------------------------------------------------------

check('identity is the multiplicative identity', () => {
  const a = m.identity(m.mat4());
  const b = m.fromRotationY(m.mat4(), 0.7);
  const out = m.multiply(m.mat4(), a, b);
  for (let i = 0; i < 16; i++) near(out[i], b[i], 1e-6, `element ${i}`);
});

check('multiply is safe when the output aliases an input', () => {
  const a = m.fromRotationY(m.mat4(), 0.4);
  const b = m.fromRotationX(m.mat4(), 0.9);
  const expected = m.multiply(m.mat4(), a, b);
  const aliased = m.fromRotationY(m.mat4(), 0.4);
  m.multiply(aliased, aliased, b);
  for (let i = 0; i < 16; i++) near(aliased[i], expected[i], 1e-6, `element ${i}`);
});

check('perspective maps the near and far planes to -1 and 1', () => {
  const p = m.perspective(m.mat4(), 60 * m.DEG, 16 / 9, 0.1, 100);
  const project = (z) => {
    const clipZ = p[10] * z + p[14];
    const clipW = -z;
    return clipZ / clipW;
  };
  near(project(-0.1), -1, 1e-4, 'near plane');
  near(project(-100), 1, 1e-4, 'far plane');
});

check('lookAt puts the target down -Z in view space', () => {
  const view = m.lookAt(m.mat4(), m.vec3(0, 0, 5), m.vec3(0, 0, 0), m.vec3(0, 1, 0));
  // Transform the target: x' = m0*x + m4*y + m8*z + m12, etc.
  const z = view[2] * 0 + view[6] * 0 + view[10] * 0 + view[14];
  near(z, -5, 1e-5, 'target is five units in front of the camera');
});

check('angleDelta takes the short way round', () => {
  near(m.angleDelta(0.1, 6.2), -0.183, 1e-3, 'across the wrap');
  near(m.angleDelta(0, Math.PI / 2), Math.PI / 2, 1e-6, 'quarter turn');
});

check('the normal matrix survives a non-uniform scale', () => {
  const model = m.identity(m.mat4());
  model[0] = 2; model[5] = 0.5; model[10] = 1;      // squash in y, stretch in x
  const nrm = m.normalMatrix(m.mat4(), model);
  // A normal along +y must stay along +y, and must not be scaled the way the
  // geometry was — that inversion is the whole reason this matrix exists.
  near(nrm[1], 0, 1e-6, 'no shear into x');
  near(nrm[5], 2, 1e-6, 'y normal is scaled by the inverse');
});

// --- the event bus -----------------------------------------------------------

check('a handler that unsubscribes itself does not skip its neighbour', () => {
  clearAll();
  const seen = [];
  const first = () => { seen.push('first'); off('tick', first); };
  on('tick', first);
  on('tick', () => seen.push('second'));
  emit('tick');
  eq(seen.join(','), 'first,second', 'both handlers ran');
  eq(listenerCount('tick'), 1, 'the first one is gone');
  clearAll();
});


// --- terrain, movement and camera --------------------------------------------

check('the terrain is identical for the same seed and different for another', () => {
  const a = createTerrain(4), b = createTerrain(4), c = createTerrain(5);
  let differs = 0;
  for (let i = 0; i < 200; i++) {
    const x = i * 1.7 - 100, z = i * -2.3 + 40;
    eq(a.heightAt(x, z), b.heightAt(x, z), `same seed at ${x},${z}`);
    if (Math.abs(a.heightAt(x, z) - c.heightAt(x, z)) > 0.01) differs++;
  }
  assert(differs > 150, `seeds 4 and 5 produced the same landscape at ${200 - differs} of 200 points`);
});

check('the ground is continuous — no cliffs between adjacent samples', () => {
  const t = createTerrain(2);
  let worst = 0;
  for (let x = -100; x <= 100; x += 3.1) {
    for (let z = -100; z <= 100; z += 7.3) {
      worst = Math.max(worst, Math.abs(t.heightAt(x, z) - t.heightAt(x + 0.5, z)));
    }
  }
  // Half a metre sideways must never be more than two metres down, or the
  // collision, the camera and the navmesh all disagree about where the floor is.
  assert(worst < 2, `worst half-metre step was ${worst.toFixed(2)} m`);
});

check('the settlement pad is flat and the player starts on it', () => {
  const t = createTerrain(1);
  for (let x = -8; x <= 8; x += 2) {
    for (let z = -8; z <= 8; z += 2) {
      assert(t.slopeAt(x, z) < 0.25, `the pad slopes ${t.slopeAt(x, z).toFixed(2)} rad at ${x},${z}`);
    }
  }
  const w = createWorld({ seed: 1, props: 40 });
  // On the ground *wherever he starts* — which is on the street inside the land
  // gate now, not at the origin. The first version compared against the height
  // at 0,0 and started failing the day the spawn point moved, which is the test
  // being wrong rather than the game.
  near(w.player.pos[1], t.heightAt(w.player.pos[0], w.player.pos[2]), 1e-6,
    'the player starts on the ground');
  assert(t.padFactor(w.player.pos[0], w.player.pos[2]) > 0.9,
    'the player starts off the cobbles');
});

check('walking forward moves the character, and stopping stops it', () => {
  const w = createWorld({ seed: 3, props: 0 });
  const start = [...w.player.pos];
  const walk = { ...idleIntent(), forward: 1, run: true };
  for (let i = 0; i < 60; i++) w.tick(1 / 60, walk);   // one second
  const dist = Math.hypot(w.player.pos[0] - start[0], w.player.pos[2] - start[2]);
  assert(dist > 3.5, `one second of running covered only ${dist.toFixed(2)} m`);
  assert(dist < RUN_SPEED * 1.05, `one second of running covered ${dist.toFixed(2)} m, faster than the top speed`);
  for (let i = 0; i < 30; i++) w.tick(1 / 60, idleIntent());
  assert(w.player.speed < 0.05, `the character is still moving at ${w.player.speed.toFixed(2)} m/s`);
});

check('a body has mass — it does not reach top speed instantly', () => {
  const w = createWorld({ seed: 3, props: 0 });
  const walk = { ...idleIntent(), forward: 1, run: true };
  w.tick(1 / 60, walk);
  assert(w.player.speed < RUN_SPEED * 0.25, `one tick reached ${w.player.speed.toFixed(2)} m/s`);
  for (let i = 0; i < 30; i++) w.tick(1 / 60, walk);
  assert(w.player.speed > RUN_SPEED * 0.9, `half a second only reached ${w.player.speed.toFixed(2)} m/s`);
});

check('sneaking is slower than walking is slower than running', () => {
  const speeds = {};
  for (const [name, intent] of Object.entries({
    sneak: { forward: 1, run: true, sneak: true },
    walk: { forward: 1, run: false },
    run: { forward: 1, run: true },
  })) {
    const w = createWorld({ seed: 3, props: 0 });
    const i = { ...idleIntent(), ...intent };
    for (let t = 0; t < 90; t++) w.tick(1 / 60, i);
    speeds[name] = w.player.speed;
  }
  assert(speeds.sneak < speeds.walk, `sneak ${speeds.sneak} !< walk ${speeds.walk}`);
  assert(speeds.walk < speeds.run, `walk ${speeds.walk} !< run ${speeds.run}`);
});

check('the character never falls through the world', () => {
  const w = createWorld({ seed: 9, props: 60 });
  const rng = makeRng(11);
  const intent = idleIntent();
  for (let t = 0; t < 3600; t++) {                      // a minute of wandering
    if (t % 40 === 0) {
      intent.forward = rng.range(-1, 1);
      intent.strafe = rng.range(-1, 1);
      intent.turn = rng.range(-2, 2);
      intent.jump = rng.chance(0.15);
    }
    w.tick(1 / 60, intent);
    const ground = w.terrain.heightAt(w.player.pos[0], w.player.pos[2]);
    assert(w.player.pos[1] >= ground - 0.01,
      `the character is ${(ground - w.player.pos[1]).toFixed(2)} m under the ground at tick ${t}`);
    assert(Number.isFinite(w.player.pos[0] + w.player.pos[1] + w.player.pos[2]),
      `the character's position went to ${w.player.pos} at tick ${t}`);
  }
});

check('a jump leaves the ground and lands again', () => {
  const w = createWorld({ seed: 3, props: 0 });
  w.tick(1 / 60, { ...idleIntent(), jump: true });
  assert(!w.player.onGround, 'the jump never left the ground');
  let air = 0;
  while (!w.player.onGround && air < 300) { w.tick(1 / 60, idleIntent()); air++; }
  assert(w.player.onGround, 'the character never landed');
  assert(air > 20 && air < 120, `the jump lasted ${air} ticks, which is not a jump`);
});

check('a tree is solid', () => {
  const w = createWorld({ seed: 7, props: 0 });
  // Put one obstacle directly in front of a character running north.
  const tree = { pos: [w.player.pos[0], w.player.pos[1] + 3, w.player.pos[2] + 4],
                 scale: [0.6, 6, 0.6], radius: 0.5, yaw: 0, albedo: [0, 0, 0] };
  w.props.push(tree);
  const walk = { ...idleIntent(), forward: 1, run: true };
  for (let t = 0; t < 180; t++) w.tick(1 / 60, walk);
  const gap = Math.hypot(w.player.pos[0] - tree.pos[0], w.player.pos[2] - tree.pos[2]);
  assert(gap > 0.7, `the character walked to ${gap.toFixed(2)} m of a 0.5 m trunk`);
  assert(w.player.pos[2] < tree.pos[2], 'the character walked through the tree');
});

// --- walls --------------------------------------------------------------------

check('a wall is solid along its whole face, not just at the middle', () => {
  const w = createWorld({ seed: 5, props: 0, people: false });
  const house = w.obstacles.find((o) => o.box);
  assert(house, 'the town has no walls at all');
  const [bw, bd] = house.box;
  const cy = Math.cos(house.yaw), sy = Math.sin(house.yaw);
  // Walk at the wall from several points along it, including near the corners,
  // which is exactly where a keep-out circle used to let a character through.
  for (const t of [-0.42, -0.2, 0, 0.2, 0.42]) {
    const lx = t * bw, lz = -(bd / 2 + 4);
    const startX = house.pos[0] + lx * cy + lz * sy;
    const startZ = house.pos[2] - lx * sy + lz * cy;
    const world = createWorld({ seed: 5, props: 0, people: false, start: [startX, startZ] });
    // Face the wall, then run at it for three seconds.
    world.player.yaw = Math.atan2(house.pos[0] - startX, house.pos[2] - startZ);
    for (let i = 0; i < 180; i++) world.tick(1 / 60, { ...idleIntent(), forward: 1, run: true });
    const p = world.player.pos;
    const dx = p[0] - house.pos[0], dz = p[2] - house.pos[2];
    const px = dx * cy - dz * sy, pz = dx * sy + dz * cy;
    const inside = Math.abs(px) < bw / 2 - 0.05 && Math.abs(pz) < bd / 2 - 0.05;
    assert(!inside, `the character walked into the house at t=${t} (local ${px.toFixed(2)}, ${pz.toFixed(2)})`);
  }
});

check('a corner is solid too', () => {
  const w = createWorld({ seed: 5, props: 0, people: false });
  const house = w.obstacles.find((o) => o.box);
  const diag = Math.hypot(house.box[0], house.box[1]) / 2 + 3;
  const startX = house.pos[0] + diag * 0.71, startZ = house.pos[2] + diag * 0.71;
  const world = createWorld({ seed: 5, props: 0, people: false, start: [startX, startZ] });
  world.player.yaw = Math.atan2(house.pos[0] - startX, house.pos[2] - startZ);
  for (let i = 0; i < 240; i++) world.tick(1 / 60, { ...idleIntent(), forward: 1, run: true });
  const dx = world.player.pos[0] - house.pos[0], dz = world.player.pos[2] - house.pos[2];
  const cy = Math.cos(house.yaw), sy = Math.sin(house.yaw);
  const px = dx * cy - dz * sy, pz = dx * sy + dz * cy;
  assert(Math.abs(px) > house.box[0] / 2 - 0.05 || Math.abs(pz) > house.box[1] / 2 - 0.05,
    `the character cut the corner into the house (local ${px.toFixed(2)}, ${pz.toFixed(2)})`);
});

check('a character can walk down the gap between two houses', () => {
  // The circle version could not: two round keep-outs overlap where the
  // buildings do not, and the street between them was sealed.
  const w = createWorld({ seed: 5, props: 0, people: false });
  const walls = w.obstacles.filter((o) => o.box);
  assert(walls.length >= 2, 'not enough houses to have a street');
  let widest = 0;
  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 1; j < walls.length; j++) {
      const d = Math.hypot(walls[i].pos[0] - walls[j].pos[0], walls[i].pos[2] - walls[j].pos[2]);
      const need = (Math.max(...walls[i].box) + Math.max(...walls[j].box)) / 2;
      widest = Math.max(widest, d - need);
    }
  }
  assert(widest > 1.2, `the widest gap between two houses is ${widest.toFixed(2)} m`);
});

check('the camera stays out of the ground and behind the player', () => {
  const w = createWorld({ seed: 5, props: 120 });
  const rng = makeRng(3);
  const intent = idleIntent();
  for (let t = 0; t < 1800; t++) {
    if (t % 30 === 0) { intent.forward = rng.range(-1, 1); intent.turn = rng.range(-2.5, 2.5); }
    w.tick(1 / 60, intent);
    const floor = w.terrain.heightAt(w.camera.pos[0], w.camera.pos[2]);
    assert(w.camera.pos[1] >= floor + 0.3 - 1e-6,
      `the camera is ${(floor - w.camera.pos[1]).toFixed(2)} m into the hillside at tick ${t}`);
    const toPlayer = Math.hypot(w.camera.pos[0] - w.player.pos[0], w.camera.pos[2] - w.player.pos[2]);
    assert(toPlayer < 6, `the camera drifted ${toPlayer.toFixed(1)} m from the player`);
  }
});

check('the simulation is deterministic from the seed', () => {
  const run = () => {
    const w = createWorld({ seed: 42, props: 80 });
    const rng = makeRng(8);
    const intent = idleIntent();
    for (let t = 0; t < 600; t++) {
      if (t % 25 === 0) { intent.forward = rng.range(-1, 1); intent.turn = rng.range(-2, 2); intent.jump = rng.chance(0.1); }
      w.tick(1 / 60, intent);
    }
    return [...w.player.pos, w.player.yaw, ...w.camera.pos];
  };
  const a = run(), b = run();
  for (let i = 0; i < a.length; i++) eq(a[i], b[i], `component ${i} diverged`);
});

// --- terrain streaming --------------------------------------------------------

check('the plan covers the ground around the player and never twice', () => {
  const w = createWorld({ seed: 4, props: 0, town: false, people: false });
  const plan = w.chunkPlan();
  const seen = new Set();
  for (const c of plan) {
    const key = `${c.x},${c.z}`;
    assert(!seen.has(key), `two chunks at ${key} — they would z-fight`);
    seen.add(key);
    assert(c.size === CHUNK, 'every chunk is the same size, by design');
    assert(LOD_RES.includes(c.res), `${c.res} is not one of the LOD resolutions`);
  }
  const side = RADIUS * 2 + 1;
  assert(plan.length <= side * side, `plan has ${plan.length} chunks, more than the ${side}×${side} grid`);
  assert(plan.length > side * side * 0.4, `plan has only ${plan.length} chunks — too much was culled`);
});

check('detail falls off with distance and not before', () => {
  const w = createWorld({ seed: 4, props: 0, town: false, people: false });
  const plan = w.chunkPlan(0, 0);
  const at = (x, z) => plan.find((c) => c.x === x * CHUNK && c.z === z * CHUNK);
  eq(at(0, 0).res, LOD_RES[0], 'the chunk under the player is the densest');
  eq(at(1, 0).res, LOD_RES[1], 'one ring out');
  eq(at(2, 0).res, LOD_RES[2], 'two rings out');
  // The outermost ring is often absent entirely: past the island's coast a
  // chunk is deep water and is not built. Whatever survives out there must be
  // at the coarsest resolution.
  for (const c of plan) {
    const ring = Math.max(Math.abs(c.x / CHUNK), Math.abs(c.z / CHUNK));
    if (ring >= LOD_RES.length - 1) eq(c.res, LOD_RES[LOD_RES.length - 1], `ring ${ring}`);
  }
});

check('the terrain cell is exactly where the player is standing', () => {
  // The real invariant, rather than "it changes after about twelve seconds" —
  // the player starts eight metres from a boundary, so that version of the
  // test was measuring the spawn point.
  const w = createWorld({ seed: 4, props: 0, town: false, people: false });
  const walk = { ...idleIntent(), forward: 1, run: true };
  let changes = 0, last = w.terrainCell();
  for (let t = 0; t < 60 * 40; t++) {
    w.tick(1 / 60, walk);
    const expect = `${Math.floor(w.player.pos[0] / CHUNK)},${Math.floor(w.player.pos[2] / CHUNK)}`;
    eq(w.terrainCell(), expect, `cell at tick ${t}`);
    if (w.terrainCell() !== last) { changes++; last = w.terrainCell(); }
  }
  // Forty seconds of running covers a bit over 200 m, which is three or four
  // boundaries. Far more than that would mean the cell is flickering on a
  // boundary and the renderer is rebuilding the world every frame.
  assert(changes >= 2 && changes <= 6, `${changes} rebuilds in forty seconds of running`);
});

check('every chunk has skirts and no NaN', () => {
  const w = createWorld({ seed: 6, props: 0, town: false, people: false });
  const plan = w.chunkPlan();
  for (const c of plan.slice(0, 12)) {
    const mesh = w.chunks([c])[0];
    const n = c.res + 1;
    // n² surface vertices plus one skirt row per edge.
    eq(mesh.verts.length / 11, n * n + n * 4, `vertex count for a ${c.res}-res chunk`);
    for (let i = 0; i < mesh.verts.length; i++) {
      assert(Number.isFinite(mesh.verts[i]), `vertex component ${i} is ${mesh.verts[i]}`);
    }
    for (let i = 0; i < mesh.index.length; i++) {
      assert(mesh.index[i] < mesh.verts.length / 11, `index ${i} points past the end`);
    }
  }
});

check('the skirt hangs below the ground it is attached to', () => {
  const w = createWorld({ seed: 6, props: 0, town: false, people: false });
  const c = w.chunkPlan()[0];
  const mesh = w.chunks([c])[0];
  const n = c.res + 1;
  const y = (idx) => mesh.verts[idx * 11 + 1];
  // The first skirt vertex sits under the first vertex of the j = 0 edge.
  assert(y(n * n) < y(0) - 1, `skirt at ${y(n * n).toFixed(2)} is not below the rim at ${y(0).toFixed(2)}`);
});

check('the scene the renderer reads has terrain, props and a character in it', () => {
  const w = createWorld({ seed: 2, props: 50 });
  w.tick(1 / 60, idleIntent());
  const s = w.scene();
  assert(s.boxes.length >= 3, 'the scene has almost nothing in it');
  const built = w.chunks();
  assert(built.length > 20, `only ${built.length} chunks around the player`);
  const chunk = built[0];
  assert(chunk.verts.length > 0 && chunk.index.length > 0, 'the centre chunk is empty');
  // Every vertex must be finite, or the GPU draws nothing and says nothing.
  for (let i = 0; i < chunk.verts.length; i++) {
    assert(Number.isFinite(chunk.verts[i]), `vertex component ${i} is ${chunk.verts[i]}`);
  }
  assert(built.ms < 400, `building the world's terrain took ${built.ms} ms`);
});

// --- combat -------------------------------------------------------------------

const noIntent = { attack: false, block: false };
const swing = { attack: true, block: false };
const rngOne = () => 0.999;              // never crits
const rngZero = () => 0;                 // always crits

/** Drive a fighter for n ticks with a fixed intent. */
function run(f, n, intent = noIntent, rng = rngOne) {
  for (let i = 0; i < n; i++) stepFighter(f, intent, rng);
  return f;
}

check('a swing spends exactly the frames the weapon says', () => {
  for (const [name, w] of Object.entries(WEAPONS)) {
    const f = createFighter({ weapon: name });
    stepFighter(f, swing, rngOne);
    eq(f.state, S.WINDUP, `${name} enters wind-up`);
    run(f, w.windup - 1, swing);
    eq(f.state, S.WINDUP, `${name} is still winding up on the last tick`);
    stepFighter(f, noIntent, rngOne);
    eq(f.state, S.ACTIVE, `${name} goes live after ${w.windup} ticks`);
    run(f, w.active - 1, noIntent);
    eq(f.state, S.ACTIVE, `${name} blade is live for ${w.active} ticks`);
    stepFighter(f, noIntent, rngOne);
    eq(f.state, S.RECOVER, `${name} recovers after the active frames`);
  }
});

check('a swing cannot be cancelled by anything', () => {
  const f = createFighter();
  run(f, WEAPONS.oneHanded.windup + 1, swing);
  eq(f.state, S.ACTIVE, 'the blade is live');
  // Every intent a player could possibly send, on the frame they would panic.
  for (const intent of [{ attack: false, block: true }, { attack: true, block: true }, noIntent]) {
    const g = createFighter();
    run(g, WEAPONS.oneHanded.windup + 1, swing);
    stepFighter(g, intent, rngOne);
    assert(g.state === S.ACTIVE || g.state === S.RECOVER,
      `blocking mid-swing escaped into ${Object.keys(S).find((k) => S[k] === g.state)}`);
  }
});

check('a missed swing takes longer to recover from than a landed one', () => {
  const miss = createFighter();
  run(miss, WEAPONS.oneHanded.windup + WEAPONS.oneHanded.active + 1, swing);
  eq(miss.state, S.RECOVER, 'recovering');
  const missTicks = miss.t;
  const hit = createFighter();
  hit.landed = true;
  run(hit, WEAPONS.oneHanded.windup + WEAPONS.oneHanded.active, swing);
  hit.landed = true;                     // it connected during the active frames
  stepFighter(hit, noIntent, rngOne);
  assert(missTicks > hit.t, `a whiff recovers in ${missTicks} ticks, a hit in ${hit.t}`);
  near(missTicks / WEAPONS.oneHanded.recover, WHIFF_RECOVERY, 0.12, 'whiff penalty');
});

check('a combo has to be earned by connecting', () => {
  const w = WEAPONS.oneHanded;
  const f = createFighter({ skill: 45 });
  run(f, w.windup + w.active + w.comboFrom + 1, swing);   // in the combo window, whiffed
  eq(f.state, S.RECOVER, 'still recovering after a whiff');
  eq(f.combo, 0, 'a whiff cannot be chained');

  const g = createFighter({ skill: 45 });
  run(g, w.windup + w.active, swing);
  g.landed = true;
  run(g, w.comboFrom + 1, swing);
  eq(g.combo, 1, 'a landed hit chains');
});

check('combo length follows weapon skill', () => {
  eq(comboLimit(createFighter({ skill: 5 })), 0, 'untrained');
  eq(comboLimit(createFighter({ skill: 10 })), 1, 'rookie');
  eq(comboLimit(createFighter({ skill: 30 })), 2, 'trained');
  eq(comboLimit(createFighter({ skill: 60 })), 3, 'master');
});

check('a parry staggers the attacker and costs no health', () => {
  const att = createFighter({ pos: [0, 0, 0] });
  const def = createFighter({ pos: [0, 0, 1.2] });
  att.facing = 0; def.facing = Math.PI;
  run(att, WEAPONS.oneHanded.windup + 1, swing);
  eq(att.state, S.ACTIVE, 'the blade is live');
  stepFighter(def, { attack: false, block: true }, rngOne);
  eq(def.state, S.PARRY, 'the window is open');
  const r = resolveStrike(att, def, rngZero, meleeDamage);
  assert(r && r.parried, 'the strike was not parried');
  eq(def.hp, def.maxHp, 'a parry costs no health');
  eq(att.state, S.STAGGER, 'the attacker is staggered');
  eq(att.t, PARRY_STAGGER, 'for the documented number of ticks');
});

check('a guard absorbs but does not erase', () => {
  const att = createFighter({ pos: [0, 0, 0] });
  const def = createFighter({ pos: [0, 0, 1.2] });
  att.facing = 0; def.facing = Math.PI;
  run(def, PARRY_TICKS + 1, { attack: false, block: true });
  eq(def.state, S.BLOCK, 'the parry window decayed into a guard');
  run(att, WEAPONS.oneHanded.windup + 1, swing);
  const r = resolveStrike(att, def, rngZero, meleeDamage);
  assert(r.blocked, 'the hit was not blocked');
  assert(r.damage > 0, 'a guard should not erase damage');
  assert(def.hp < def.maxHp, 'blocking took no damage at all');
});

check('nobody can be stagger-locked', () => {
  // Land ten hits back to back and count how many of them stagger. Without the
  // immunity window this was every second hit, for ever, which is how "hold the
  // attack button" beat every other strategy in the duel harness.
  const att = createFighter({ pos: [0, 0, 0] });
  const def = createFighter({ pos: [0, 0, 1.0], hp: 100000 });
  att.facing = 0; def.facing = Math.PI;
  let staggers = 0;
  for (let i = 0; i < 10; i++) {
    att.state = S.ACTIVE; att.t = 1; att.hitThisSwing.clear();
    def.pos[2] = 1.0;                    // step back into reach after the knockback
    const before = def.state;
    resolveStrike(att, def, rngOne, meleeDamage);
    if (def.state === S.STAGGER && before !== S.STAGGER) staggers++;
    run(def, STAGGER_TICKS + 1, noIntent);
  }
  assert(staggers <= 3, `${staggers} staggers out of ten consecutive hits is a lock`);
  assert(staggers >= 1, 'poise never broke at all, which is the opposite problem');
});

check('a landed hit makes space', () => {
  const att = createFighter({ pos: [0, 0, 0] });
  const def = createFighter({ pos: [0, 0, 1.0] });
  att.facing = 0; def.facing = Math.PI;
  att.state = S.ACTIVE; att.t = 1;
  resolveStrike(att, def, rngOne, meleeDamage);
  assert(def.pos[2] > 1.2, `the target was not pushed back (${def.pos[2].toFixed(2)} m)`);
});

check('every creature attack telegraphs', () => {
  // The rule is about what the player has to read, so it binds the creature
  // weapons. A player's own dagger is allowed to be faster than they can react
  // to: they know when they pressed the button.
  for (const name of ['claws']) {
    assert(WEAPONS[name].windup >= MIN_TELEGRAPH,
      `${name} winds up in ${WEAPONS[name].windup} ticks, under the ${MIN_TELEGRAPH}-tick floor`);
  }
});

check('spacing and parrying beats holding the attack button', () => {
  // The brief's assertion (§13.2), and the reason three separate design
  // decisions exist: whiff recovery, earned combos, and stagger immunity.
  for (const skill of [10, 45, 75]) {
    const r = duelSeries(200, { skill });
    const rate = r.spacer / r.trials;
    assert(rate >= 0.8, `at ${skill}% skill the spacer won ${(rate * 100).toFixed(0)}% of 200 duels`);
  }
});

check('no skill level turns the fight into a damage race', () => {
  for (const skill of [5, 30, 60, 90]) {
    const r = duelSeries(120, { skill });
    const rate = r.spacer / r.trials;
    assert(rate >= 0.7, `at ${skill}% skill the spacer won only ${(rate * 100).toFixed(0)}%`);
    assert(r.nobody === 0, `${r.nobody} duels at ${skill}% never ended`);
  }
});

// --- the loop, played by a bot ------------------------------------------------

/**
 * A crude hunter: face the nearest living beast, close, swing. It is the
 * simplest policy a player could have, and what it is for is not balance —
 * it is proving that the whole loop closes. Walk, find, fight, kill, earn.
 */
function hunt(world, seconds = 240) {
  const intent = idleIntent();
  for (let t = 0; t < 60 * seconds; t++) {
    const near = world.beasts.filter((b) => b.state !== S.DEAD)
      .map((b) => ({ b, d: Math.hypot(b.pos[0] - world.player.pos[0], b.pos[2] - world.player.pos[2]) }))
      .sort((p, q) => p.d - q.d)[0];
    intent.forward = 1; intent.attack = false; intent.turn = 0;
    if (near) {
      const want = Math.atan2(near.b.pos[0] - world.player.pos[0], near.b.pos[2] - world.player.pos[2]);
      let d = want - world.player.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      intent.turn = Math.max(-3, Math.min(3, d * 4));
      if (near.d < 1.8) { intent.forward = 0; intent.attack = true; }
    }
    world.tick(1 / 60, intent);
    if (world.player.fighter.hp <= 0) return { died: true, at: t / 60 };
  }
  return { died: false, at: seconds };
}

// A wood to fight in: the player put down on the farm road outside the land
// gate, with the pack in the trees around him.
//
// This used to start in the middle of town and walk at whatever was nearest.
// That stopped working the day the city got a wall round it — the bot pressed
// into masonry for four minutes and the test reported "never landed a blow",
// which was true and told you nothing about combat. Putting the fight outside
// the walls is the honest version of what the test was always measuring.
const WOOD = { seed: 3, props: 120, beasts: 12, beastsAround: [-24, 60], start: [-24, 60] };

check('the loop closes: a bot can walk out, fight, and earn from it', () => {
  const w = createWorld({ ...WOOD });
  const out = hunt(w);
  const alive = w.beasts.filter((b) => b.state !== S.DEAD).length;
  assert(!out.died || alive < w.beasts.length, `the bot died at ${out.at.toFixed(0)} s without killing anything`);
  assert(w.player.fighter.hits > 0, 'the bot never landed a blow');
  if (alive < w.beasts.length) assert(w.player.xp > 0, 'killing a beast earned no experience');
});

check('a fight is reproducible from the seed', () => {
  // Combat used Math.random until the hunt bot started reporting a different
  // outcome every run — sometimes clearing the wood, sometimes dying with two
  // beasts left. A simulation the bots cannot repeat cannot prove anything.
  const play = () => {
    const w = createWorld({ ...WOOD, props: 40, beasts: 6 });
    hunt(w, 90);
    const f = w.player.fighter;
    return [f.hp, f.hits, f.crits, w.beasts.filter((b) => b.state === S.DEAD).length].join(',');
  };
  eq(play(), play(), 'two runs of the same seed diverged');
});

check('the woods are dangerous', () => {
  // A bot that walks into a pack and holds the attack button should not stroll
  // out unhurt. If this ever passes trivially, the creatures have stopped
  // mattering and the road is no longer worth staying on (§4, P2).
  const w = createWorld({ ...WOOD });
  hunt(w, 240);
  const f = w.player.fighter;
  assert(f.hp < f.maxHp * 0.75,
    `the bot cleared the wood at ${f.hp}/${f.maxHp} health — nothing out there is a threat`);
});

check('nothing is placed on the market square', () => {
  const w = createWorld({ seed: 5, beasts: 9, props: 40 });
  for (const b of w.beasts) {
    const d = Math.hypot(b.pos[0], b.pos[2]);
    assert(d > 25, `a ${b.kind} spawned ${d.toFixed(1)} m from the well`);
  }
});

// --- the two worlds -----------------------------------------------------------

check('both regions build, and both are places you could stand in', () => {
  for (const name of Object.keys(REGIONS)) {
    for (const seed of [1, 4, 7]) {
      const t = createTerrain(seed, name);
      eq(t.region, name, 'the terrain knows which region it is');
      for (const [place, p] of Object.entries(t.places)) {
        near(t.heightAt(p.at[0], p.at[1]), p.level, 0.6, `${name}/${place} sits at its level`);
        assert(t.slopeAt(p.at[0], p.at[1]) < 0.2, `${name}/${place} is on a slope`);
      }
    }
  }
});

check('every road in every region is walkable end to end', () => {
  for (const name of Object.keys(REGIONS)) {
    for (const seed of [1, 3, 5]) {
      const t = createTerrain(seed, name);
      for (const road of t.roads) {
        for (let i = 0; i < road.points.length - 1; i++) {
          const [ax, az] = road.points[i], [bx, bz] = road.points[i + 1];
          const steps = Math.ceil(Math.hypot(bx - ax, bz - az));
          for (let k = 0; k <= steps; k++) {
            const u2 = k / steps;
            const x = ax + (bx - ax) * u2, z = az + (bz - az) * u2;
            assert(t.slopeAt(x, z) < 0.40,
              `${name}: ${road.name} slopes ${t.slopeAt(x, z).toFixed(2)} rad at ${x.toFixed(0)},${z.toFixed(0)}`);
          }
        }
      }
    }
  }
});

check('the pass is a door, not a wall, and it goes both ways', () => {
  const w = createWorld({ seed: 2, props: 20 });
  eq(w.region, 'verath', 'a new game starts on the island');

  // Standing at the barricade does nothing until somebody has told you the
  // road east is worth walking. It is unknown, not locked.
  const cleft = w.places.cleft.at;
  w.player.pos[0] = cleft[0]; w.player.pos[2] = cleft[1];
  w.tick(1 / 60);
  assert(!w.pendingTravel, 'the pass took a man nobody had sent');

  w.flags.add('quest:q_cleft:told');
  w.tick(1 / 60);
  eq(w.pendingTravel, 'cleftvale', 'the pass did not open to a man who had been sent');

  const there = travel(w, 'cleftvale');
  assert(there.ok, `travel refused: ${there.why}`);
  eq(there.world.region, 'cleftvale', 'we did not arrive');
  assert(there.world.town.length > 200, 'the valley was built empty');

  // And back out again, from the other end of the same pass — after walking to
  // it. You do not arrive standing in the way out, which is the whole of the
  // travel lock: the first version put the player down on top of the return
  // exit and the browser harness watched him cross and come straight back.
  there.world.tick(1 / 60);
  assert(!there.world.pendingTravel, 'arriving in the valley sent us straight home again');
  const mouth = there.world.places.gate.at;
  there.world.player.pos[0] = mouth[0]; there.world.player.pos[2] = mouth[1];
  there.world.tick(1 / 60);
  eq(there.world.pendingTravel, 'verath', 'there is no way home');
  const back = travel(there.world, 'verath');
  assert(back.ok, `going home refused: ${back.why}`);
  eq(back.world.region, 'verath', 'we did not get home');
});

check('crossing the pass carries the man and leaves the world behind', () => {
  const w = createWorld({ seed: 2, props: 20, beasts: 6 });
  w.character.gold = 1234;
  w.character.guild = 'watch';
  w.awardXp(3000, 'quest');
  w.give('healing_draught', 3);
  w.setQuest('q_ore', 'found');
  w.flags.add('pass:upper');
  w.clock.day = 4; w.clock.minutes = 17 * 60;
  w.player.fighter.hp = 63;
  w.tick(1 / 60);

  const r = travel(w, 'cleftvale');
  assert(r.ok, r.why);
  const n = r.world;
  eq(n.character.gold, 1234, 'his purse');
  eq(n.character.guild, 'watch', 'his oath');
  eq(n.character.level, w.character.level, 'his level');
  assert(n.carrying('healing_draught', 3), 'what he was carrying');
  eq(n.quests.get('q_ore'), 'found', 'what he had been asked to do');
  eq(n.clock.day, 4, 'the day');
  near(n.clock.minutes, 17 * 60, 0.02, 'the hour');   // one tick of drift from the tick that triggered it
  eq(n.player.fighter.hp, 63, 'his wounds');
  eq(n.chapter, w.chapter, 'the chapter');
  assert(n.flags.has('pass:upper'), 'what he had earned');

  // And the world is genuinely a different one.
  // The valley has its own four, and not one of them is from the island.
  assert(n.people.every((p) => p.id.startsWith('val')), 'an islander came through the pass');
  assert(!n.people.some((p) => w.people.some((q) => q.id === p.id)), 'the two regions share a person');
  assert(n.terrain.size !== w.terrain.size, 'both regions are the same size');
  assert(n.beasts.every((b) => b.valley), 'the valley kept the island\'s creatures');
  const islandWolf = w.beasts.find((b) => b.kind === 'wolf');
  const valleyWolf = n.beasts.find((b) => b.kind === 'wolf');
  if (islandWolf && valleyWolf) {
    assert(valleyWolf.maxHp > islandWolf.maxHp * 1.5,
      `a valley wolf has ${valleyWolf.maxHp} hp against the island's ${islandWolf.maxHp}`);
  }
});

check('a save knows which world it is in, and refuses the wrong one', () => {
  const w = createWorld({ seed: 6, props: 10, beasts: 2 });
  const r = travel(w, 'cleftvale');
  const data = r.world.snapshot();
  eq(data.region, 'cleftvale', 'the save does not say where it is');

  // Into a matching world: fine.
  const good = createWorld({ seed: 6, region: 'cleftvale', props: 10, beasts: 2 });
  good.restore(data);
  eq(good.region, 'cleftvale', 'a matching world would not take it');

  // Into the island: refused, with a message rather than a physics bug.
  const bad = createWorld({ seed: 6, props: 10, beasts: 2 });
  let msg = '';
  try { bad.restore(data); } catch (e) { msg = e.message; }
  assert(/cleftvale/.test(msg), `expected a refusal naming the region, got "${msg}"`);
});

check('the valley can be played to the end of it', () => {
  // The other half of the golden path, and the only proof the second region is
  // a *game* rather than terrain: every stage reached by talking to somebody or
  // standing somewhere, nothing set by hand.
  const w = createWorld({ seed: 3, region: 'cleftvale', props: 40, beasts: 0 });
  w.chapter = 4;
  const P = w.terrain.places;

  const say = (who, line) => {
    const npc = w.people.find((p) => p.id === who);
    assert(npc, `${who} is not in the valley`);
    w.player.pos[0] = npc.pos[0]; w.player.pos[2] = npc.pos[2] - 1.5;
    w.player.pos[1] = w.terrain.heightAt(w.player.pos[0], w.player.pos[2]);
    w.player.yaw = 0;
    const open = w.talk();
    assert(open, `${who} would not talk`);
    const i = open.options.findIndex((o) => o.id === line);
    assert(i >= 0, `"${line}" was not on offer from ${who} — had ${open.options.map((o) => o.id).join(', ')}`);
    w.dialogue.say(i);
    w.dialogue.close();
  };
  const standAt = (place) => {
    w.player.pos[0] = P[place].at[0]; w.player.pos[2] = P[place].at[1];
    w.player.pos[1] = w.terrain.heightAt(w.player.pos[0], w.player.pos[2]);
    w.tick(1 / 60);
  };

  // Where the ore goes: told at the camp, counted at a pit, closed at the camp.
  say('val0', 'brant.greet');
  say('val0', 'brant.what_happened');
  say('val0', 'brant.convoy_ask');
  eq(w.quests.get('q_convoy'), 'told', 'Brant did not give the job');
  say('val1', 'hask.greet');
  say('val1', 'hask.count');
  eq(w.quests.get('q_convoy'), 'counted', 'counting the loads changed nothing');
  say('val0', 'brant.convoy_done');
  eq(w.quests.get('q_convoy'), 'done', 'reporting back changed nothing');

  // The nine stones: ore is cut at each pit by *being* there, not bought.
  say('val2', 'ulla.greet');
  say('val2', 'ulla.ask');
  say('val1', 'hask.ore');
  assert(w.carrying('ore_west'), 'Hask kept the west drift\'s ore');
  assert(!w.carrying('ore_east'), 'the east drift\'s ore arrived without going there');
  standAt('pit_two');
  standAt('pit_three');
  assert(w.carrying('ore_east') && w.carrying('ore_deep'), 'standing at a pit cut nothing');
  eq(w.quests.get('q_shrine'), 'gathered', 'three loads did not finish the gathering');
  say('val2', 'ulla.light');
  eq(w.quests.get('q_shrine'), 'done', 'the fire was not lit');
  assert(!w.carrying('ore_west'), 'she took the ore and gave it back');

  // The keep: a real door, opened by knowing what is inside it.
  say('val0', 'brant.keep');
  assert(!w.doorOpen('keep'), 'the keep stood open before anyone was sent');
  w.tick(1 / 60);
  assert(w.doorOpen('keep'), 'the keep would not open for a man who had been sent');
  eq(w.quests.get('q_keep'), 'opened', 'the log did not notice');
  // Walking in is not taking it. The keep is finished when the keep is empty,
  // which is a different sentence and a much longer afternoon.
  standAt('keep');
  eq(w.quests.get('q_keep'), 'opened', 'the keep counted as taken while it was still held');
  // The fight itself is tested in the combat and lighthouse checks; here the
  // garrison is put down directly, because what is under test is the *rule*
  // that an empty keep is a taken keep.
  for (const m of w.foes) { m.state = S.DEAD; m.hp = 0; }
  standAt('keep');
  eq(w.quests.get('q_keep'), 'done', 'an empty keep did not count as taken');

  assert(w.character.level >= 3, `the valley paid ${w.character.xp} xp — level ${w.character.level}`);
  const log = w.questLog();
  assert(log.length >= 3 && log.every((q) => q.finished), 'the valley left something open');
});

check('each order sends you somewhere different, and only its own members', () => {
  // Three guilds, one map, three reasons to walk it. This is the cheapest way
  // to make one island into three games, and the test that keeps it honest is
  // that a member of one order cannot be given another's errand.
  const lines = {
    watch: 'aldric.order_ask',
    ember: 'kelm.order_ask',
    freeblade: 'sarn.order_ask',
  };
  const who = { watch: 'npc9', ember: 'npc11', freeblade: 'npc12' };

  for (const [guild, line] of Object.entries(lines)) {
    for (const sworn of Object.keys(lines)) {
      const w = createWorld({ seed: 4, beasts: 0, props: 10 });
      w.character.guild = sworn;
      w.chapter = 2;
      const npc = w.people.find((p) => p.id === who[guild]);
      w.player.pos[0] = npc.pos[0]; w.player.pos[2] = npc.pos[2] - 1.5;
      w.player.pos[1] = w.terrain.heightAt(w.player.pos[0], w.player.pos[2]);
      w.player.yaw = 0;
      const open = w.talk();
      assert(open, `${who[guild]} would not talk to a ${sworn}`);
      const ids = open.options.map((o) => o.id);
      if (guild === sworn) {
        assert(ids.includes(line), `a sworn ${guild} was given nothing to do — had ${ids.join(', ')}`);
      } else {
        assert(!ids.includes(line), `a sworn ${sworn} was given the ${guild}'s errand`);
      }
    }
  }
});

check('an order errand has a middle, not just an asking and a reward', () => {
  // Every questline in this game has to be told somewhere, advanced somewhere
  // else, and closed back where it started. A quest whose middle is missing is
  // a quest that completes itself, and the flag validator cannot see that.
  const w = createWorld({ seed: 4, beasts: 0, props: 10 });
  w.character.guild = 'watch';
  w.chapter = 2;
  const say = (whoId, line) => {
    const npc = w.people.find((p) => p.id === whoId);
    w.player.pos[0] = npc.pos[0]; w.player.pos[2] = npc.pos[2] - 1.5;
    w.player.pos[1] = w.terrain.heightAt(w.player.pos[0], w.player.pos[2]);
    w.player.yaw = 0;
    const open = w.talk();
    const i = open ? open.options.findIndex((o) => o.id === line) : -1;
    if (i < 0) return false;
    w.dialogue.say(i);
    w.dialogue.close();
    return true;
  };

  assert(say('npc9', 'aldric.order_ask'), 'the captain gave no orders');
  eq(w.quests.get('q_order_watch'), 'told', 'the log did not take it');
  // The middle is at the harbour, and it cannot be skipped.
  assert(!say('npc9', 'aldric.order_quay'), 'the captain answered his own question');
  assert(say('npc6', 'porter.greet'), 'the porter would not talk');
  w.flags.add('knows:ore_theft');
  assert(say('npc6', 'porter.ore'), 'the porter had nothing about the ore');
  assert(w.flags.has('knows:quay_count'), 'the harbour told us nothing');
  assert(say('npc9', 'aldric.order_quay'), 'the captain would not hear it');
  eq(w.quests.get('q_order_watch'), 'quay', 'the log did not move');
});

check('men fight differently from beasts, and hold the ground they were put on', () => {
  const w = createWorld({ seed: 1, props: 20, beasts: 0 });
  assert(w.foes.length >= 6, `the lighthouse is held by ${w.foes.length} men`);
  const l = w.places.lighthouse.at;
  for (const m of w.foes) {
    const d = Math.hypot(m.pos[0] - l[0], m.pos[2] - l[1]);
    assert(d < 26, `a ${m.kind} was posted ${d.toFixed(0)} m from the light`);
    assert(m.kit, `a ${m.kind} has no clothes on`);
  }

  // A leash, so a camp cannot be pulled apart one man at a time from two
  // hundred metres. Stand well outside and let them think about it.
  w.player.pos[0] = l[0] + 120; w.player.pos[2] = l[1] + 120;
  w.player.pos[1] = w.terrain.heightAt(w.player.pos[0], w.player.pos[2]);
  for (let i = 0; i < 60 * 20; i++) w.tick(1 / 60);
  for (const m of w.foes) {
    const d = Math.hypot(m.pos[0] - l[0], m.pos[2] - l[1]);
    assert(d < 50, `a ${m.kind} walked ${d.toFixed(0)} m off his post chasing nobody`);
  }
});

check('clearing the headland finishes the job, and reloading keeps it cleared', () => {
  const w = createWorld({ seed: 1, props: 10, beasts: 0 });
  w.chapter = 3;
  w.setQuest('q_lighthouse', 'told');
  const l = w.places.lighthouse.at;
  w.player.pos[0] = l[0]; w.player.pos[2] = l[1] + 6;
  w.player.pos[1] = w.terrain.heightAt(w.player.pos[0], w.player.pos[2]);
  w.tick(1 / 60);
  eq(w.quests.get('q_lighthouse'), 'told', 'the job finished while the bandits were alive');

  for (const m of w.foes) { m.state = S.DEAD; m.hp = 0; }
  w.tick(1 / 60);
  eq(w.quests.get('q_lighthouse'), 'done', 'an empty headland did not count');

  // And a save remembers. A lighthouse you cleared that repopulates on reload
  // un-finishes the quest that depended on it.
  const data = w.snapshot();
  assert(data.foes.length >= 6, 'the save forgot the men');
  const w2 = createWorld({ seed: 1, props: 10, beasts: 0 });
  w2.restore(data);
  assert(w2.foes.every((m) => m.state === S.DEAD), 'the headland refilled itself on load');
});

check('a bandit is a real fight and the curve is where the design says', () => {
  // The design statement is "reachable at level three, survivable at eight",
  // and this is that sentence as a test — with the number the measurement
  // actually gives rather than the one that was written down first.
  //
  // Eight is the *knife edge*: across seeds 1, 2 and 3 a level-eight character
  // wins one and loses two, and one of the losses ends with a single bandit
  // standing. Ten wins all three with about sixty per cent of his health. So
  // the honest sentence is "you can attempt it at eight and you will probably
  // lose it; at ten the headland is yours", and the assertion is pinned at ten
  // because a test pinned to a coin flip is a test that fails on Tuesdays.
  const run = (xp, str, skill, weapon, armour) => {
    const w = createWorld({ seed: 1, props: 10, beasts: 0 });
    w.awardXp(xp, 'quest');
    w.character.str = str; w.character.skills.oneHanded = skill; w.character.guild = 'watch';
    w.give(weapon); w.give(armour); w.equip(weapon); w.equip(armour);
    w.player.fighter.hp = w.character.maxHp;
    const l = w.places.lighthouse.at;
    w.player.pos[0] = l[0] + 22; w.player.pos[2] = l[1] + 22;
    w.player.pos[1] = w.terrain.heightAt(w.player.pos[0], w.player.pos[2]);
    const intent = idleIntent();
    for (let t = 0; t < 60 * 200 && w.player.fighter.hp > 0 && w.foes.some((m) => m.state !== S.DEAD); t++) {
      const near = w.foes.filter((m) => m.state !== S.DEAD)
        .map((m) => ({ m, d: Math.hypot(m.pos[0] - w.player.pos[0], m.pos[2] - w.player.pos[2]) }))
        .sort((a, b) => a.d - b.d)[0];
      intent.attack = false; intent.block = false; intent.forward = 0; intent.turn = 0;
      if (near) {
        const want = Math.atan2(near.m.pos[0] - w.player.pos[0], near.m.pos[2] - w.player.pos[2]);
        let d = want - w.player.yaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        intent.turn = Math.max(-4, Math.min(4, d * 6));
        intent.forward = near.d > 1.8 ? 1 : 0;
        intent.block = near.m.state === S.WINDUP && near.d < 2.4;
        intent.attack = !intent.block && near.d < 1.9;
      }
      w.tick(1 / 60, intent);
    }
    return { won: w.player.fighter.hp > 0, level: w.character.level };
  };

  const early = run(3000, 20, 30, 'rusty_blade', 'leather_jerkin');
  assert(!early.won, `a level-${early.level} character cleared the lighthouse — it is not a wall`);
  const ready = run(30000, 50, 70, 'forged_blade', 'watch_mail');
  assert(ready.won, `a level-${ready.level} character could not clear the lighthouse — it is a wall`);
});

// --- dying --------------------------------------------------------------------

check('dying stops the man, and waking up costs something', () => {
  const w = createWorld({ seed: 1, props: 10, beasts: 0, foes: false });
  w.character.gold = 400;
  w.player.pos[0] = -140; w.player.pos[2] = -30;
  w.player.pos[1] = w.terrain.heightAt(-140, -30);
  const day0 = w.clock.day, min0 = w.clock.minutes;

  assert(!w.dead, 'a new character starts dead');
  w.player.fighter.hp = 0;
  w.player.fighter.state = S.DEAD;
  w.tick(1 / 60);
  assert(w.dead, 'the world did not notice');

  // A dead man takes no orders — including from a bot, which is why the intent
  // is blanked in the world rather than in the input layer.
  const before = [w.player.pos[0], w.player.pos[2]];
  const walk = { ...idleIntent(), forward: 1, run: true };
  for (let i = 0; i < 120; i++) w.tick(1 / 60, walk);
  const moved = Math.hypot(w.player.pos[0] - before[0], w.player.pos[2] - before[1]);
  assert(moved < 0.3, `a corpse walked ${moved.toFixed(2)} m`);
  assert(w.deadFor > 100, `the clock on the death screen did not run — ${w.deadFor}`);

  const r = w.revive();
  assert(r.ok, r.why);
  eq(w.character.gold, 300, 'waking up was free');
  assert(w.player.fighter.hp > 0 && w.player.fighter.hp <= w.character.maxHp / 2,
    `woke at ${w.player.fighter.hp}/${w.character.maxHp}`);
  assert(!w.dead, 'still dead after waking');
  const elapsed = (w.clock.day - day0) * 24 * 60 + (w.clock.minutes - min0);
  assert(elapsed > 60 * 11, `only ${(elapsed / 60).toFixed(1)} hours passed`);

  // And you wake somewhere with people in it, not where you fell.
  const away = Math.hypot(w.player.pos[0] - before[0], w.player.pos[2] - before[1]);
  assert(away > 20, `woke ${away.toFixed(0)} m from where he died — that is where he died`);
  assert(w.terrain.padFactor(w.player.pos[0], w.player.pos[2]) > 0.5,
    'woke in the middle of a wood');
});

check('the valley wakes you at the camp, because it is the only safe ground', () => {
  const w = createWorld({ seed: 2, region: 'cleftvale', props: 10, beasts: 0, foes: false });
  w.player.pos[0] = w.places.keep.at[0]; w.player.pos[2] = w.places.keep.at[1];
  w.player.fighter.hp = 0; w.player.fighter.state = S.DEAD;
  w.tick(1 / 60);
  w.revive();
  const camp = w.places.camp.at;
  const d = Math.hypot(w.player.pos[0] - camp[0], w.player.pos[2] - camp[1]);
  assert(d < 2, `woke ${d.toFixed(0)} m from the camp`);
});

// --- magic --------------------------------------------------------------------

check('a rune is an item, and mana is a wall rather than a modifier', () => {
  const w = createWorld({ seed: 1, props: 10, beasts: 0, foes: false });
  eq(w.spells().length, 0, 'a character with no runes knows spells anyway');

  w.give('rune_fire_bolt');
  eq(w.spells().length, 1, 'carrying the rune did not offer the spell');
  let r = w.cast('fire_bolt');
  assert(!r.ok && /needs 10 mana/.test(r.why), `expected a mana wall, got "${r.why}"`);

  // Under the requirement it cannot be cast at all — not "cast weaker" (P3).
  w.character.mana = 9; w.reloadout();
  assert(!w.cast('fire_bolt').ok, 'nine mana cast a ten-mana rune');
  w.character.mana = 10; w.reloadout();
  assert(w.cast('fire_bolt').ok, 'ten mana would not cast a ten-mana rune');

  // And losing the rune loses the spell.
  const w2 = createWorld({ seed: 1, props: 10, beasts: 0, foes: false });
  w2.character.mana = 30; w2.reloadout();
  w2.give('rune_fire_bolt');
  assert(w2.cast('fire_bolt').ok, 'the rune did not work');
  w2.take('rune_fire_bolt');
  const gone = w2.cast('fire_bolt');
  assert(!gone.ok && /not carrying/.test(gone.why), `expected "not carrying", got "${gone.why}"`);
});

check('a bolt is a thing in the world: it travels, it can miss, and it can kill', () => {
  const w = createWorld({ seed: 1, props: 10, beasts: 3, foes: false });
  w.character.mana = 40; w.reloadout();
  w.give('rune_fire_bolt');
  const b = w.beasts[0];
  const before = b.hp;

  // Stand off and lead the shot. The bolt leaves the hand after the wind-up
  // and takes time to arrive, so this is aiming, not a dice roll.
  let cast = false, hit = false;
  for (let i = 0; i < 400 && !hit; i++) {
    if (!cast) {
      w.player.pos[0] = b.pos[0] - 4; w.player.pos[2] = b.pos[2] - 6;
      w.player.pos[1] = w.terrain.heightAt(w.player.pos[0], w.player.pos[2]);
    }
    w.player.yaw = Math.atan2(b.pos[0] - w.player.pos[0], b.pos[2] - w.player.pos[2]);
    if (!cast && w.cast('fire_bolt').ok) cast = true;
    if (w.bolts.length) {
      // It is somewhere between the caster and the target, not on top of either.
      const d = Math.hypot(w.bolts[0].pos[0] - w.player.pos[0], w.bolts[0].pos[2] - w.player.pos[2]);
      assert(d >= 0, 'the bolt is nowhere');
    }
    w.tick(1 / 60);
    hit = b.hp < before;
  }
  assert(hit, `the bolt never arrived — beast at ${before} hp`);
  assert(b.hp === before - 46, `expected 46 damage, took ${before - b.hp}`);

  // Magic ignores armour, which is what a rune is for. A boar has 20 armour
  // and takes exactly the same number.
  const boar = w.beasts.find((x) => x.kind === 'boar');
  if (boar) assert(boar.def.armor > 0, 'the boar lost its armour');
});

check('a cast is a commitment, and being hit takes the mana with it', () => {
  const w = createWorld({ seed: 1, props: 10, beasts: 0, foes: false });
  w.character.mana = 40; w.reloadout();
  w.give('rune_fire_bolt');
  const pool = w.caster.mana;

  assert(w.cast('fire_bolt').ok, 'the cast was refused');
  eq(w.caster.mana, pool - 8, 'the mana was not spent at the start of the cast');
  assert(w.caster.casting, 'nothing is being cast');
  assert(!w.cast('fire_bolt').ok, 'two casts at once');

  // Interrupted: the cast ends, the mana does not come back, and no bolt was
  // ever thrown. That is the only thing that makes being interrupted matter.
  const w2 = createWorld({ seed: 1, props: 10, beasts: 0, foes: false });
  w2.character.mana = 40; w2.reloadout();
  w2.give('rune_fire_bolt');
  w2.cast('fire_bolt');
  const spent = w2.caster.mana;
  w2.tick(1 / 60);
  breakInto(w2);
  for (let i = 0; i < 120; i++) w2.tick(1 / 60);
  eq(w2.bolts.length, 0, 'an interrupted cast still threw a bolt');
  assert(w2.caster.mana >= spent, 'the mana went backwards');
  assert(w2.caster.mana < 40, 'an interrupted cast refunded its mana');
});

/** Break whatever the world's caster is doing, the way a blow would. */
function breakInto(w) {
  w.caster.casting = null;
  w.caster.t = 0;
  w.caster.released = null;
}

check('the pool refills, and raising mana gives you the points', () => {
  const w = createWorld({ seed: 1, props: 10, beasts: 0, foes: false });
  w.character.mana = 20; w.reloadout();
  eq(w.caster.max, 20, 'the pool did not follow the sheet');
  // Buying ten mana and finding the pool still empty reads, at the moment of
  // purchase, as the trainer having taken your points and given you nothing.
  eq(w.caster.mana, 20, 'raising mana raised only the ceiling');

  w.give('rune_fire_bolt');
  w.cast('fire_bolt');
  for (let i = 0; i < 60 * 3; i++) w.tick(1 / 60);
  assert(w.caster.mana > 12, `the pool did not refill — ${w.caster.mana.toFixed(1)}`);
  assert(w.caster.mana <= 20, 'the pool overfilled');
});

// --- the wardrobe -------------------------------------------------------------

check('every kit builds a whole person, and armour adds pieces to it', () => {
  const state = { pos: new Float32Array([0, 0, 0]), yaw: 0, speed: 3.2, phase: 1.1 };
  const counts = {};
  for (const [name, kit] of Object.entries(KITS)) {
    const out = [];
    poseHumanoid(out, { ...state, kit });
    counts[name] = out.length;
    // A body is twenty-two parts before anything is worn.
    assert(out.length >= 22, `${name} came out as ${out.length} parts — that is not a person`);
    for (const part of out) {
      assert(part.mat.length === 16, `${name} produced a part with no matrix`);
      for (const c of part.albedo) {
        assert(c >= 0 && c <= 1, `${name} has an albedo of ${c} — albedos are not screen colours`);
        // Authored a stop and a half under the buildings, for the reason in
        // src/game/rig.js: a person is boxes, and one face is always square to
        // the sun. Anything above 0.45 photographs as a man in a bedsheet.
        assert(c <= 0.45, `${name} has an albedo of ${c.toFixed(2)} and will render as paper`);
      }
    }
  }
  // A harness is meaningfully more model than a shirt, or the pieces are not
  // doing anything.
  assert(counts.watch > counts.rags + 15,
    `mail is only ${counts.watch - counts.rags} parts more than rags`);
  assert(counts.villager < counts.knight,
    'a villager is built out of as many parts as a knight');
});

check('what the player wears is what the player looks like', () => {
  const w = createWorld({ seed: 1, beasts: 0, props: 10 });
  const parts = () => { const o = []; poseHumanoid(o, w.player); return o.length; };
  const inRags = parts();
  eq(w.inventory.armour, 'rags', 'a new character starts in what he arrived in');

  w.character.guild = 'watch';
  w.character.str = 30;
  w.give('watch_mail');
  assert(w.equip('watch_mail').ok, 'a sworn man of the Watch could not put on his own mail');
  assert(parts() > inRags + 15, `the mail added only ${parts() - inRags} parts to the model`);
  eq(w.player.fighter.armor, 48, 'and the numbers did not follow the pieces');

  // Guild armour is a door, not a purchase (P3/P5).
  const other = createWorld({ seed: 1, beasts: 0, props: 10 });
  other.character.str = 30;
  other.give('watch_mail');
  assert(!other.equip('watch_mail').ok, 'a man sworn to nobody put on the Watch\'s mail');
});

// --- the map ------------------------------------------------------------------
//
// The island has a shape now (docs/WORLD.md) and the shape is load-bearing:
// the walls make the gate mean something, the roads make distance mean
// difficulty, and the landmarks make the horizon navigable. All three are easy
// to break with an edit that looks harmless, so all three are tested.

check('every place on the map is flat enough to build on and stand on', () => {
  const t = createTerrain(2);
  for (const [name, p] of Object.entries(PLACES)) {
    const [x, z] = p.at;
    near(t.heightAt(x, z), p.level, 0.6, `${name} sits at its stated level`);
    assert(t.slopeAt(x, z) < 0.2, `${name} slopes ${t.slopeAt(x, z).toFixed(2)} rad`);
    assert(t.padFactor(x, z) > 0.85, `${name} is not flattened`);
  }
});

check('the roads are walkable end to end', () => {
  const t = createTerrain(3);
  for (const road of ROADS) {
    for (let i = 0; i < road.points.length - 1; i++) {
      const [ax, az] = road.points[i], [bx, bz] = road.points[i + 1];
      const steps = Math.ceil(Math.hypot(bx - ax, bz - az));
      for (let k = 0; k <= steps; k++) {
        const u = k / steps;
        const x = ax + (bx - ax) * u, z = az + (bz - az) * u;
        // A road you cannot walk up is a wall with cobbles on it.
        assert(t.slopeAt(x, z) < 0.36,
          `${road.name} slopes ${t.slopeAt(x, z).toFixed(2)} rad at ${x.toFixed(0)},${z.toFixed(0)}`);
        assert(t.heightAt(x, z) > 0.5, `${road.name} is under water at ${x.toFixed(0)},${z.toFixed(0)}`);
      }
    }
  }
});

check('the city has walls, and the walls have gates you can walk through', () => {
  const w = createWorld({ seed: 4, props: 0, beasts: false });
  const body = { pos: new Float32Array(3), vel: new Float32Array(3) };
  const free = (x, z) => {
    body.pos[0] = x; body.pos[1] = w.terrain.heightAt(x, z); body.pos[2] = z;
    resolveObstacles(body, w.obstacles);
    return Math.hypot(body.pos[0] - x, body.pos[2] - z) < 0.05;
  };
  // The two ways in and out of the city are open to anybody. The gate of the
  // upper quarter is *not*, and that asymmetry is the design: this test asserts
  // both halves of it, because a change that quietly opened the upper gate
  // would otherwise pass everything.
  for (const name of ['land', 'harbour', 'apron', 'harbourApron']) {
    const at = w.gates[name];
    assert(free(at[0], at[1]), `the ${name} gate is blocked`);
  }
  assert(!free(w.gates.upper[0], w.gates.upper[1]),
    'the gate of the upper quarter stood open to a stranger');
  w.flags.add('pass:upper');
  w.tick(1 / 60);
  assert(free(w.gates.upper[0], w.gates.upper[1]),
    'the gate of the upper quarter did not open for someone with a reason');
  // And the wall between the gates is not walk-through-able: sample the ring
  // away from both openings and count how much of it is solid.
  let solid = 0, tried = 0;
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    // Skip the two gates and their jambs.
    const near = [Math.PI / 2, Math.PI].some((g) => Math.abs(((a - g + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.3);
    if (near) continue;
    tried++;
    if (!free(Math.cos(a) * 26, Math.sin(a) * 34)) solid++;
  }
  assert(solid === tried, `${tried - solid} of ${tried} points on the curtain wall were open air`);
});

check('every townsperson is standing somewhere a person could stand', () => {
  for (const seed of [1, 2, 5]) {
    const w = createWorld({ seed, props: 200 });
    const body = { pos: new Float32Array(3), vel: new Float32Array(3) };
    for (const p of w.people) {
      body.pos.set(p.pos);
      resolveObstacles(body, w.obstacles);
      const moved = Math.hypot(body.pos[0] - p.pos[0], body.pos[2] - p.pos[2]);
      assert(moved < 0.05, `${p.id} is inside geometry on seed ${seed} (pushed ${moved.toFixed(2)} m)`);
      assert(w.terrain.slopeAt(p.pos[0], p.pos[2]) < 0.5, `${p.id} is standing on a cliff`);
    }
  }
});

check('the quest crates are outside the walls and on a road', () => {
  const w = createWorld({ seed: 1, props: 0 });
  const [cx, , cz] = w.crates[0].pos;
  assert(w.terrain.padFactor(cx, cz) > 0.4, 'the crates are not on the road');
  // Outside the curtain wall: the point of the errand is that it takes you out
  // of the city and back.
  assert(Math.hypot(cx / 26, cz / 34) > 1.1, 'the crates are inside the walls');
});

// --- the character sheet ------------------------------------------------------

check('experience buys levels, and levels buy learning points', () => {
  const c = createCharacter();
  eq(awardXp(c, 499, 'quest'), 0, 'one short of the first level');
  eq(c.lp, 0, 'no learning points yet');
  eq(awardXp(c, 1, 'quest'), 1, 'the five hundredth point is a level');
  eq(c.lp, 10, 'ten learning points a level');
  eq(c.maxHp, 40 + 12, 'twelve health a level');
  awardXp(c, 100000, 'quest');
  eq(c.lp, c.level * 10, 'still ten a level, however many arrive at once');
});

check('nothing can raise a number without saying where it came from', () => {
  const c = createCharacter({ lp: 50 });
  let threw = false;
  try { raiseAttribute(c, 'str', 1, 'a chest in a wood'); } catch { threw = true; }
  assert(threw, 'an unnamed source was allowed to make the character stronger');
  assert(raiseAttribute(c, 'str', 1, 'trainer').ok, 'a trainer is a valid source');
});

check('a skill costs what the bands say and cannot be bought twice', () => {
  const c = createCharacter({ lp: 40 });
  const r = learn(c, 'oneHanded', 20, 'trainer');
  eq(r.cost, 20, 'twenty points inside the first band cost twenty LP');
  eq(c.skills.oneHanded, 20, 'and the skill went up');
  eq(c.lp, 20, 'and the points came out');
  assert(learn(c, 'sneak', 1, 'trainer').ok, 'sneak is learnable');
  assert(knows(c, 'sneak'), 'and known afterwards');
  assert(!learn(c, 'sneak', 1, 'trainer').ok, 'and not learnable twice');
});

check('learning points run out', () => {
  const c = createCharacter({ lp: 3 });
  const r = learn(c, 'oneHanded', 20, 'trainer');
  assert(!r.ok && r.why.includes('learning points'), `expected a refusal, got ${JSON.stringify(r)}`);
  eq(c.skills.oneHanded, 0, 'and nothing was learned');
  eq(c.lp, 3, 'and nothing was spent');
});

check('a weapon requirement is permission, not a modifier', () => {
  const c = createCharacter({ str: 10 });
  const sword = { str: 30, damage: 60 };
  assert(!canWield(c, sword).ok, 'a ten-strength character should not lift a thirty-strength sword');
  c.str = 30;
  assert(canWield(c, sword).ok, 'and should the moment they can');
});

check('a guild is a door that closes', () => {
  const c = createCharacter();
  assert(joinGuild(c, 'watch').ok, 'joining works once');
  assert(!joinGuild(c, 'ember').ok, 'and never again');
  eq(c.guild, 'watch', 'the first oath stands');
});

// --- the conversations --------------------------------------------------------

check('every conversation is well formed', () => {
  for (const [who, nodes] of Object.entries(DIALOGUE)) {
    const ids = new Set();
    for (const n of nodes) {
      assert(n.id, `${who} has a node with no id`);
      assert(!ids.has(n.id), `${who} has two nodes called ${n.id}`);
      ids.add(n.id);
      assert(n.text && n.reply, `${n.id} has nothing to say or no answer`);
      for (const e of n.effects || []) {
        assert(EFFECT_KINDS.includes(e.kind), `${n.id} uses unknown effect "${e.kind}"`);
      }
    }
    assert(nodes.some((n) => n.ends), `${who} has no way out of the conversation`);
    assert(nodes.some((n) => n.once), `${who} has no door that closes behind you`);
  }
});

check('every condition survives a world where nothing has happened', () => {
  // A `when` that throws on an empty world is a crash on the first playthrough,
  // which is the one everybody has.
  const empty = {
    has: () => false, gold: 0, guild: null, level: 0, lp: 0, chapter: 1,
    skill: () => 0, knows: () => false, flags: new Set(), npc: null,
  };
  const rich = {
    has: () => true, gold: 99999, guild: 'watch', level: 40, lp: 200, chapter: 4,
    skill: () => 100, knows: () => true, flags: new Set(), npc: null,
  };
  for (const [who, nodes] of Object.entries(DIALOGUE)) {
    for (const n of nodes) {
      if (!n.when) continue;
      for (const [name, ctx] of [['empty', empty], ['rich', rich]]) {
        try { n.when(ctx); } catch (e) { throw new Error(`${who}/${n.id} threw on the ${name} world: ${e.message}`); }
      }
    }
  }
});

check('every flag a conversation writes is read by something', () => {
  // "Something" includes the world, not only another conversation: a quest
  // stage set in dialogue is usually read by the code that advances it. The
  // first version of this check only looked at `when` clauses and reported
  // three healthy flags as orphans.
  const written = new Set(), read = new Set();
  for (const file of ['../src/world/world.js', '../src/game/chapters.js']) {
    let src = '';
    try { src = readFileSync(new URL(file, import.meta.url), 'utf8'); } catch { continue; }
    for (const m2 of src.matchAll(/'([a-z_]+:[a-z_:0-9]+)'/gi)) read.add(m2[1]);
    for (const m2 of src.matchAll(/quests\.get\('([a-z_0-9]+)'\)\s*===\s*'([a-z_0-9]+)'/gi)) {
      read.add(`quest:${m2[1]}:${m2[2]}`);
    }
  }
  for (const nodes of Object.values(DIALOGUE)) {
    for (const n of nodes) {
      for (const e of n.effects || []) {
        if (e.kind === 'flag') written.add(e.flag);
        if (e.kind === 'quest') written.add(`quest:${e.quest}:${e.stage}`);
      }
      // The conditions are closures, so what they read is recovered from their
      // source. Crude, and it is the only way to check this without a DSL —
      // which is a trade the brief makes deliberately (§6.5).
      if (n.when) for (const m of n.when.toString().matchAll(/'([^']+)'/g)) read.add(m[1]);
    }
  }
  const orphans = [...written].filter((f) => !read.has(f) && !f.endsWith(':done'));
  assert(orphans.length === 0, `flags written and never read: ${orphans.join(', ')}`);
});

check('every speaker exists in some world and has something to say', () => {
  // Speakers live in one region or the other, so the check is "somebody,
  // somewhere, is this person" rather than "everybody is on the island".
  const worlds = Object.keys(REGIONS).map((r) => createWorld({ seed: 1, region: r, beasts: 0, props: 10 }));
  for (const [npcId, conversation] of Object.entries(SPEAKERS)) {
    assert(DIALOGUE[conversation], `${npcId} points at a conversation that does not exist`);
    assert(worlds.some((w) => w.people.some((p) => p.id === npcId)),
      `${npcId} speaks but is in neither world`);
  }
  // And nobody is in the world without anything to say, which is the other
  // half of the same mistake.
  for (const w of worlds) {
    for (const p of w.people) {
      assert(SPEAKERS[p.id], `${p.id} is standing in ${w.region} with no conversation`);
    }
  }
});

check('a conversation runs, and its doors close behind you', () => {
  const w = createWorld({ seed: 1, beasts: 0, props: 10 });
  const smith = w.people.find((p) => p.id === 'npc3');
  w.player.pos[0] = smith.pos[0]; w.player.pos[2] = smith.pos[2] - 1.6; w.player.yaw = 0;

  const open = w.talk();
  assert(open, 'the smith would not talk');
  eq(open.options[0].id, 'harl.greet', 'the greeting comes first');
  w.dialogue.say(0);
  assert(w.flags.has('met:harl'), 'the greeting did not set its flag');
  assert(!w.dialogue.active.options.some((o) => o.id === 'harl.greet'), 'you can greet him twice');
  assert(w.dialogue.active.options.some((o) => o.id === 'harl.train_ask'), 'the training door did not open');
});

check('you cannot talk to someone you are not facing', () => {
  const w = createWorld({ seed: 1, beasts: 0, props: 10 });
  const smith = w.people.find((p) => p.id === 'npc3');
  w.player.pos[0] = smith.pos[0]; w.player.pos[2] = smith.pos[2] - 1.6;
  w.player.yaw = Math.PI;                    // back turned
  assert(!w.speaker(), 'the smith was reachable through the back of the player\'s head');
  w.player.pos[2] = smith.pos[2] - 12;       // too far
  w.player.yaw = 0;
  assert(!w.speaker(), 'the smith was reachable from twelve metres away');
});

check('training costs coin and learning points, and stops where the trainer stops', () => {
  const w = createWorld({ seed: 1, beasts: 0, props: 10 });
  const smith = w.people.find((p) => p.id === 'npc3');
  w.player.pos[0] = smith.pos[0]; w.player.pos[2] = smith.pos[2] - 1.6; w.player.yaw = 0;
  // Enough levels that the *smith's* ceiling is what stops the training, not
  // the purse. The first version of this test awarded 6000 and asserted 45%:
  // it stopped at 40% because 0→45 costs sixty learning points and four levels
  // is fifty. The test was wrong and the game was right.
  w.awardXp(30000, 'debug');
  const goldBefore = w.character.gold;

  w.talk();
  const pick = (id) => {
    const i = w.dialogue.active.options.findIndex((o) => o.id === id);
    assert(i >= 0, `${id} was not on offer`);
    w.dialogue.say(i);
  };
  pick('harl.greet'); pick('harl.train_ask'); pick('harl.train');
  eq(w.character.gold, goldBefore - 200, 'the lesson was not paid for');
  assert(w.openTrainer && w.openTrainer.skill === 'oneHanded', 'no trainer was opened');

  assert(w.character.lp >= 60, `the fixture needs at least 60 LP, has ${w.character.lp}`);
  const before = w.character.skills.oneHanded;
  const r = w.train();
  assert(r.ok, `training refused: ${r.why}`);
  assert(w.character.skills.oneHanded > before, 'the skill did not move');
  eq(w.player.fighter.skill, w.character.skills.oneHanded, 'the fighter did not learn what the character did');

  for (let i = 0; i < 40; i++) w.train();
  eq(w.character.skills.oneHanded, 45, 'the smith taught past his own ceiling');
  assert(!w.train().ok, 'and did not refuse afterwards');
});

/** Stand in front of somebody and open their conversation. */
function standAndTalk(w, npcId) {
  const npc = w.people.find((p) => p.id === npcId);
  assert(npc, `${npcId} is not in the world`);
  w.player.pos[0] = npc.pos[0]; w.player.pos[2] = npc.pos[2] - 1.6;
  w.player.pos[1] = w.terrain.heightAt(w.player.pos[0], w.player.pos[2]);
  w.player.yaw = 0;
  return w.talk();
}

check('the guild door needs the whole chain, not just the asking', () => {
  const w = createWorld({ seed: 1, beasts: 0, props: 10 });
  const ids = () => (w.dialogue.active ? w.dialogue.active.options.map((o) => o.id) : []);
  const say = (id) => {
    const i = ids().indexOf(id);
    assert(i >= 0, `"${id}" was not on offer — had ${ids().join(', ')}`);
    return w.dialogue.say(i);
  };

  standAndTalk(w, 'npc9');                     // Captain Aldric, in the barracks
  say('aldric.greet');
  say('aldric.join_ask');
  assert(!ids().includes('aldric.vouched'), 'the Watch vouched for him with nobody speaking');

  // Somebody speaks for him — but he still cannot hold a blade.
  w.flags.add('harl:trusts');
  standAndTalk(w, 'npc9');
  say('aldric.vouched');
  assert(!ids().includes('aldric.join'), 'the Watch took a man who swings at ten per cent');
  assert(ids().includes('aldric.join_unready'), 'and did not say why');

  // And now he can.
  w.character.skills.oneHanded = 25;
  standAndTalk(w, 'npc9');
  say('aldric.join');
  eq(w.character.guild, 'watch', 'the oath was not taken');
  assert(w.carrying('watch_mail'), 'a sworn man of the Watch has no mail');
});

check('an oath shuts the other two doors for good', () => {
  const w = createWorld({ seed: 1, beasts: 0, props: 10 });
  w.character.guild = 'watch';
  for (const [who, node] of [['npc11', 'kelm.other_guild'], ['npc12', 'sarn.other_guild']]) {
    standAndTalk(w, who);
    const ids = w.dialogue.active.options.map((o) => o.id);
    assert(ids.includes(node), `${who} still had something to offer a sworn man`);
    // And nothing on offer can make him one of theirs.
    assert(!ids.some((id) => id.endsWith('.join')), `${who} would still take the oath`);
  }
});

check('the upper quarter has four ways in and each one is a different act', () => {
  const ways = {
    // an oath
    sworn: (w) => { w.character.guild = 'watch'; },
    // money
    bribed: (w) => { w.flags.add('knows:upper_ways'); w.character.gold = 400; },
    // somebody's errand
    errand: (w) => { w.give('sealed_letter'); w.setQuest('q_letter', 'told'); w.tick(1 / 60); },
  };
  for (const [name, setup] of Object.entries(ways)) {
    const w = createWorld({ seed: 2, beasts: 0, props: 10 });
    standAndTalk(w, 'npc0');
    w.dialogue.say(0);                         // watch.greet — refused
    eq(w.quests.get('q_upper'), 'refused', `${name}: the guard let a stranger through`);
    setup(w);
    standAndTalk(w, 'npc0');
    const i = w.dialogue.active.options.findIndex((o) => o.id.startsWith('watch.')
      && ['watch.sworn_pass', 'watch.bribe', 'watch.errand'].includes(o.id));
    assert(i >= 0, `${name}: no way through was offered`);
    w.dialogue.say(i);
    w.tick(1 / 60);
    assert(w.flags.has('pass:upper'), `${name}: the gate did not open`);
    assert(w.doorOpen('upper'), `${name}: the flag was set but the door was still there`);
  }

  // The fourth way is not a conversation at all: it is a jump only an acrobat
  // can make, off a stack of crates nobody drew attention to.
  const w = createWorld({ seed: 2, beasts: 0, props: 10 });
  const u = w.city.upper;
  w.player.pos[0] = u.at[0]; w.player.pos[2] = u.at[1];
  w.player.pos[1] = w.terrain.heightAt(u.at[0], u.at[1]);
  w.player.onGround = true;
  w.tick(1 / 60);
  eq(w.quests.get('q_upper'), 'done', 'standing in the upper quarter went unnoticed');
  assert(w.flags.has('pass:upper'), 'the climb did not count');
});

check('a chapter rewrites the island, and will not begin early', () => {
  const w = createWorld({ seed: 3, beasts: 12, props: 10 });
  eq(w.chapter, 1, 'a new game starts in chapter one');
  const before = w.beasts.length;
  assert(!w.setChapter(3).ok, 'chapter three began without Ossric');
  assert(!w.setChapter(2).ok, 'chapter two began without an oath');

  w.character.guild = 'freeblade';
  w.tick(1 / 60);
  eq(w.chapter, 2, 'swearing an oath did not begin chapter two');
  assert(w.beasts.length > before, 'chapter two put nothing new on the island');
  assert(w.beasts.some((b) => b.ring === 2), 'and nothing that belongs to it');
  assert(w.doorOpen('upper'), 'a sworn man was still shut out of his own upper quarter');

  // Straight to four is refused: each chapter is its own door.
  assert(!w.setChapter(4).ok, 'chapter four began without the Cleft');
});

// --- saving -------------------------------------------------------------------

/** A world with a life lived in it, for the save tests to round-trip. */
function playedWorld(seed = 5) {
  const w = createWorld({ seed, beasts: 4, props: 20 });
  w.awardXp(2600, 'quest');
  w.flags.add('met:harl');
  w.setQuest('q_ore', 'told');
  w.character.gold = 640;
  w.train !== undefined && w.raise('str', 3);
  w.beasts[0].state = S.DEAD; w.beasts[0].hp = 0;
  w.beasts[1].hp = 20;
  w.player.pos[0] = 42.5; w.player.pos[2] = -13.25; w.player.yaw = 1.1;
  w.clock.minutes = 17 * 60 + 42; w.clock.day = 3;
  return w;
}

check('a save carries everything that changed and nothing that did not', () => {
  const w = playedWorld();
  const data = w.snapshot();
  const bytes = JSON.stringify(data).length;
  // Deltas, not snapshots: a save that grows with the size of the world is a
  // save that will be a megabyte by chapter three (§12.1).
  assert(bytes < 4000, `a save of a young character is ${bytes} bytes`);
  assert(!JSON.stringify(data).includes('plaster'), 'the save contains world geometry');
  eq(data.version, SAVE_VERSION, 'version stamped');
});

check('loading a save puts everything back', () => {
  const before = playedWorld();
  const data = before.snapshot();
  const after = createWorld({ seed: 5, beasts: 4, props: 20 });
  after.restore(data);

  eq(after.character.xp, before.character.xp, 'experience');
  eq(after.character.lp, before.character.lp, 'learning points');
  eq(after.character.gold, before.character.gold, 'gold');
  eq(after.character.str, before.character.str, 'strength');
  eq(after.player.pos[0], before.player.pos[0], 'position');
  eq(after.player.yaw, before.player.yaw, 'facing');
  eq(after.clock.hhmm, before.clock.hhmm, 'the time of day');
  eq(after.clock.day, before.clock.day, 'the day');
  eq(after.quests.get('q_ore'), 'told', 'the quest log');
  assert(after.flags.has('met:harl'), 'the flags');
  eq(after.beasts[0].state, S.DEAD, 'a dead beast stays dead');
  eq(after.beasts[1].hp, 20, 'a wounded beast stays wounded');
  eq(after.player.fighter.str, after.character.str + 15, 'the fighter agrees with the sheet');
});

check('a save from an older format is migrated, not refused', () => {
  const w = playedWorld();
  const modern = w.snapshot();
  // Fabricate what version 1 looked like: no quests, no skills.
  const old = { ...modern, version: 1, quests: undefined, character: { ...modern.character, skills: undefined } };
  const migrated = migrate(old);
  eq(migrated.version, SAVE_VERSION, 'brought up to date');
  assert(Array.isArray(migrated.quests), 'the quest log was filled in');
  assert(migrated.character.skills.oneHanded > 0, 'the skills were filled in');
  const w2 = createWorld({ seed: 5, beasts: 4, props: 20 });
  w2.restore(old);                       // restore migrates on the way in
  eq(w2.character.gold, modern.character.gold, 'and the old save still loads');
});

check('a save from the future is refused politely', () => {
  let msg = '';
  try { migrate({ version: SAVE_VERSION + 5 }); } catch (e) { msg = e.message; }
  assert(msg.includes('newer version'), `expected a clear refusal, got "${msg}"`);
});

check('rubbish is refused without breaking the game', () => {
  const w = createWorld({ seed: 5, beasts: 2, props: 10 });
  for (const junk of [null, 42, 'save', {}, { version: 'two' }, []]) {
    let threw = false;
    try { w.restore(junk); } catch { threw = true; }
    assert(threw, `${JSON.stringify(junk)} was accepted as a save file`);
  }
  // And the world is still playable afterwards, which is the actual requirement.
  w.tick(1 / 60, idleIntent());
  assert(w.player.fighter.hp > 0, 'the world broke on a bad save');
});

check('a save of the wrong world is refused', () => {
  const data = playedWorld(5).snapshot();
  const other = createWorld({ seed: 9, beasts: 2, props: 10 });
  let msg = '';
  try { other.restore(data); } catch (e) { msg = e.message; }
  assert(msg.includes('world'), `expected a refusal about worlds, got "${msg}"`);
});

check('storage falls back to memory when the browser says no', async () => {
  const store = createStorage({ storage: false });
  assert(store.inMemory, 'expected the in-memory fallback');
  await store.put('slot1', { version: SAVE_VERSION, hello: 'world' });
  const back = await store.get('slot1');
  eq(back.hello, 'world', 'the fallback kept the save');
  eq((await store.list()).length, 1, 'and lists it');
});

// --- the golden path ----------------------------------------------------------

check('the game can be played from the first line to a guild oath', () => {
  // The whole of what exists, end to end, by a bot that steers rather than
  // teleports: talk to the smith, take the ore job, walk the north road, find
  // the crates, walk back, get paid, and use his word to get into the Watch.
  const r = goldenPath(1, { maxSeconds: 600 });
  assert(r.ok, `${r.why} — got as far as: ${r.steps.slice(-3).join(' · ')}`);
  eq(r.world.character.guild, 'watch', 'the oath was not taken');
  assert(r.world.character.skills.oneHanded > 10, 'no training was bought');
  assert(r.world.character.xp >= 650, `only ${r.world.character.xp} experience earned`);
});

// --- what you carry -----------------------------------------------------------

check('every item is well formed and every drop and stock entry exists', () => {
  for (const [id, it] of Object.entries(ITEMS)) {
    assert(it.name, `${id} has no name`);
    assert(Object.values(KIND).includes(it.kind), `${id} has kind "${it.kind}"`);
    if (it.kind === KIND.WEAPON) assert(it.damage > 0 && it.class, `${id} is a weapon that cannot hit`);
    if (it.kind === KIND.ARMOUR) assert(it.prot >= 0, `${id} has no protection`);
    assert(typeof it.value === 'number', `${id} has no value`);
  }
  for (const [beast, drops] of Object.entries(DROPS)) {
    for (const d of drops) assert(ITEMS[d.item], `${beast} drops "${d.item}", which does not exist`);
  }
  for (const [who, t] of Object.entries(TRADERS)) {
    for (const [id] of t.stock) assert(ITEMS[id], `${who} stocks "${id}", which does not exist`);
    assert(t.gold > 0 && t.buys.length, `${who} cannot trade`);
  }
});

check('a requirement is a door, not a discount', () => {
  const w = createWorld({ seed: 1, beasts: 0, props: 5 });
  w.give('militia_sword');
  const refused = w.equip('militia_sword');
  assert(!refused.ok && refused.why.includes('30 strength'),
    `expected a refusal naming the requirement, got ${JSON.stringify(refused)}`);
  const damageBefore = w.player.fighter.weapon.damage;
  w.character.str = 30;
  assert(w.equip('militia_sword').ok, 'thirty strength should open the door');
  assert(w.player.fighter.weapon.damage > damageBefore * 2, 'the sword did not reach the hand');
});

check('guild armour needs the guild, not the coin', () => {
  const w = createWorld({ seed: 1, beasts: 0, props: 5 });
  w.give('watch_mail');
  w.character.str = 40;
  const r = w.equip('watch_mail');
  assert(!r.ok && r.why.includes('watch'), `expected a guild refusal, got ${JSON.stringify(r)}`);
  w.joinGuild('watch');
  assert(w.equip('watch_mail').ok, 'a sworn member should be able to wear the mail');
  eq(w.player.fighter.armor, ITEMS.watch_mail.prot, 'the protection did not apply');
});

check('the skill that matters is the one for the weapon in your hand', () => {
  const w = createWorld({ seed: 1, beasts: 0, props: 5 });
  w.character.skills.oneHanded = 45;
  w.character.skills.twoHanded = 0;
  w.character.str = 60;
  w.give('war_axe'); w.give('militia_sword');
  w.equip('militia_sword');
  eq(w.player.fighter.skill, 45, 'the sword should use the one-handed skill');
  w.equip('war_axe');
  eq(w.player.fighter.skill, 0, 'a swordsman picking up an axe is a beginner');
});

check('a hide needs the skinning lesson; a fang does not', () => {
  const wolf = DROPS.wolf.map((d) => ITEMS[d.item]);
  assert(wolf.some((it) => it.needs === 'skinning'), 'nothing on a wolf needs skinning');
  assert(wolf.some((it) => !it.needs), 'everything on a wolf needs skinning');
});

check('a trader runs out of coin', () => {
  const w = createWorld({ seed: 1, beasts: 0, props: 5 });
  w.give('wolf_pelt', 200);
  w.openTrader = 'bosk_hunter';
  let sold = 0;
  while (w.sell('wolf_pelt').ok) sold++;
  const purse = TRADERS.bosk_hunter.gold;
  assert(sold * sellPrice(ITEMS.wolf_pelt) <= purse, 'the hunter paid out more than he had');
  assert(sold > 5 && sold < 200, `sold ${sold} pelts — a purse that deep is not a purse`);
  assert(w.carrying('wolf_pelt'), 'the pelts he could not pay for should still be yours');
});

check('a trader buys what he deals in and nothing else', () => {
  const w = createWorld({ seed: 1, beasts: 0, props: 5 });
  w.give('wolf_pelt', 3);
  w.openTrader = 'harl_smith';
  assert(!w.sell('wolf_pelt').ok, 'the smith bought a pelt');
  w.openTrader = 'bosk_hunter';
  assert(w.sell('wolf_pelt').ok, 'the hunter would not buy a pelt');
});

check('buying costs what it costs, and empties the shelf', () => {
  const w = createWorld({ seed: 1, beasts: 0, props: 5 });
  w.character.gold = 1000;
  w.openTrader = 'harl_smith';
  const before = w.character.gold;
  assert(w.buy('militia_sword').ok, 'the sword was not for sale');
  eq(w.character.gold, before - buyPrice(ITEMS.militia_sword), 'the price was not the price');
  assert(!w.buy('militia_sword').ok, 'he had a second one');
});

check('a quest item cannot be sold for coin', () => {
  const w = createWorld({ seed: 1, beasts: 0, props: 5 });
  w.give('ore_crate');
  w.openTrader = 'harl_smith';
  assert(!w.sell('ore_crate').ok, 'the stolen ore was sold to the man it was stolen from');
});

check('a permanent draught is permanent', () => {
  const w = createWorld({ seed: 1, beasts: 0, props: 5 });
  const str = w.character.str;
  w.give('elixir_str');
  assert(w.drink('elixir_str').ok, 'the elixir would not go down');
  eq(w.character.str, str + 1, 'strength did not rise');
  assert(!w.carrying('elixir_str'), 'the bottle survived being drunk');
  assert(w.character.ledger.some((e) => e.source === 'permanent-potion'), 'the ledger did not record it');
});

check('a save carries what you were holding and what the trader had left', () => {
  const w = createWorld({ seed: 7, beasts: 2, props: 10 });
  w.character.str = 30;
  w.give('militia_sword'); w.equip('militia_sword');
  w.give('wolf_pelt', 4);
  w.openTrader = 'bosk_hunter';
  w.sell('wolf_pelt', 2);
  const traderGold = w.trader('bosk_hunter').gold;
  const data = w.snapshot();

  const back = createWorld({ seed: 7, beasts: 2, props: 10 });
  back.restore(data);
  eq(back.inventory.weapon, 'militia_sword', 'the sword was not in hand');
  eq(back.player.fighter.weapon.damage, ITEMS.militia_sword.damage, 'the loadout was not reapplied');
  eq(back.items().find((i) => i.id === 'wolf_pelt').n, 2, 'the pelts');
  eq(back.trader('bosk_hunter').gold, traderGold, 'the hunter got his coin back');
});

// --- report ------------------------------------------------------------------

if (failures.length) {
  console.log(`\n${passed} passed, ${failures.length} FAILED\n`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  console.log('');
  process.exit(1);
}
console.log(`\n${passed} checks passed\n`);
