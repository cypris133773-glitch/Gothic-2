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
import { createTerrain } from '../src/world/terrain.js';
import { createWorld, CHUNK, LOD_RES, RADIUS } from '../src/world/world.js';
import { idleIntent } from '../src/core/input.js';
import { RUN_SPEED } from '../src/game/player.js';
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
  near(w.player.pos[1], t.heightAt(0, 0), 1e-6, 'the player starts on the ground');
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

check('the loop closes: a bot can walk out, fight, and earn from it', () => {
  const w = createWorld({ seed: 3, props: 120, beasts: 7 });
  const out = hunt(w);
  const alive = w.beasts.filter((b) => b.state !== S.DEAD).length;
  assert(!out.died || alive < 7, `the bot died at ${out.at.toFixed(0)} s without killing anything`);
  assert(w.player.fighter.hits > 0, 'the bot never landed a blow');
  if (alive < 7) assert(w.player.xp > 0, 'killing a beast earned no experience');
});

check('a fight is reproducible from the seed', () => {
  // Combat used Math.random until the hunt bot started reporting a different
  // outcome every run — sometimes clearing the wood, sometimes dying with two
  // beasts left. A simulation the bots cannot repeat cannot prove anything.
  const play = () => {
    const w = createWorld({ seed: 3, props: 40, beasts: 5 });
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
  const w = createWorld({ seed: 3, props: 120, beasts: 7 });
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
  for (const file of ['../src/world/world.js', '../src/game/quests.js']) {
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

check('every speaker exists in the world and has something to say', () => {
  const w = createWorld({ seed: 1, beasts: 0, props: 10 });
  for (const [npcId, conversation] of Object.entries(SPEAKERS)) {
    assert(DIALOGUE[conversation], `${npcId} points at a conversation that does not exist`);
    assert(w.people.some((p) => p.id === npcId), `${npcId} speaks but is not in the world`);
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

check('the guild door needs the whole chain, not just the asking', () => {
  const w = createWorld({ seed: 1, beasts: 0, props: 10 });
  const guard = w.people.find((p) => p.id === 'npc0');
  w.player.pos[0] = guard.pos[0]; w.player.pos[2] = guard.pos[2] - 1.6; w.player.yaw = 0;
  w.talk();
  const ids = () => w.dialogue.active.options.map((o) => o.id);
  w.dialogue.say(ids().indexOf('watch.greet'));
  w.dialogue.say(ids().indexOf('watch.join_ask'));
  assert(!ids().includes('watch.join'), 'the Watch took him without the smith vouching');
  w.flags.add('harl:trusts');
  w.talk();                                   // reopen with the new flag
  assert(w.dialogue.active.options.some((o) => o.id === 'watch.join'), 'the door never opened');
  w.dialogue.say(w.dialogue.active.options.findIndex((o) => o.id === 'watch.join'));
  eq(w.character.guild, 'watch', 'the oath was not taken');
});

// --- report ------------------------------------------------------------------

if (failures.length) {
  console.log(`\n${passed} passed, ${failures.length} FAILED\n`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  console.log('');
  process.exit(1);
}
console.log(`\n${passed} checks passed\n`);
