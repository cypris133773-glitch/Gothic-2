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

// --- report ------------------------------------------------------------------

if (failures.length) {
  console.log(`\n${passed} passed, ${failures.length} FAILED\n`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  console.log('');
  process.exit(1);
}
console.log(`\n${passed} checks passed\n`);
