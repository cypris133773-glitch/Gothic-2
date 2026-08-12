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

// --- report ------------------------------------------------------------------

if (failures.length) {
  console.log(`\n${passed} passed, ${failures.length} FAILED\n`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  console.log('');
  process.exit(1);
}
console.log(`\n${passed} checks passed\n`);
