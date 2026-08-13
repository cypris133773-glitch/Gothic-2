// The world: terrain, a town, its people, the player, the camera and the clock,
// advanced by a fixed tick and readable as a scene.
//
// Nothing in this file touches the DOM, a canvas, an audio context or a browser
// API of any kind. That is the constraint the whole test strategy rests on
// (§8.1.2): the same code runs in Node, a bot drives it with the same intent
// object a keyboard produces, and it is the only way anyone will ever prove
// that a world this size can be walked across and finished.

import {
  createTerrain, buildChunk, scatter, clutter, PLACES, GATE_APRON, HARBOUR_APRON,
} from './terrain.js';
import {
  buildHouse, buildWell, buildStall, buildWall, buildFarm, buildTower,
  buildLighthouse, buildMonastery, buildCleftGate, buildDoor, buildCrateStack,
  buildPit, buildCamp, buildKeep, buildShrine,
} from './buildings.js';
import { REGIONS, DEFAULT_REGION, region as regionOf } from './regions.js';
import { createPlayer, stepPlayer, resolveObstacles, HEIGHT } from '../game/player.js';
import { createCamera, stepCamera } from '../game/camera.js';
import { poseHumanoid, advanceGait, KITS, kitForArmour } from '../game/rig.js';
import { Clock, keyLightDirection, skyPalette } from '../core/time.js';
import { idleIntent } from '../core/input.js';
import { makeRng } from '../core/rng.js';
import { emit } from '../core/events.js';
import { createFighter, stepFighter, resolveStrike, isStriking, S } from '../game/combat.js';
import { createBeast, stepBeast, poseBeast, BEASTS } from '../game/beast.js';
import { createFoe, stepFoe, foeSpoils, FOES } from '../game/foe.js';
import {
  SPELLS, RUNE_SPELL, createCaster, syncCaster, canCast, beginCast, stepCaster,
  breakCast, createBolt, stepBolt, poseBolt,
} from '../game/magic.js';
import {
  createArcher, canShoot, beginDraw, stepArcher, breakDraw, createArrow,
  stepArrow, poseArrow, isRanged, BOWS, RANGED_CLASS,
} from '../game/ranged.js';
import {
  createChest, pick, abandonPick, canSee, canPickPocket, LOCK_TICKS,
} from '../game/theft.js';
import { stepRoutine, postAt, DAYS } from '../game/routine.js';
import { meleeDamage, levelForXp } from '../game/progression.js';
import { createCharacter, awardXp, learn, raiseAttribute, joinGuild } from '../game/character.js';
import { createDialogue } from '../game/dialogue.js';
import { DIALOGUE, SPEAKERS } from '../data/dialogue.js';
import { snapshot, restore } from '../core/save.js';
import {
  createInventory, add, remove, has, count, equip, unequip, drink, applyLoadout,
  createTrader, buy, sell, listing, buyPrice, sellPrice,
} from '../game/inventory.js';
import { DROPS, ITEMS, item } from '../data/items.js';
import { QUESTS, entry as questEntry } from '../data/quests.js';
import { CHAPTERS, LAST_CHAPTER, readyFor } from '../game/chapters.js';

const ticksToSeconds = (t) => t / 60;

export const CHUNK = 64;         // metres per terrain chunk
// Vertices per side by ring: dense underfoot, coarse at the horizon. The last
// entry covers every ring beyond it.
export const LOD_RES = [40, 24, 14, 8];
export const RADIUS = 4;         // 9×9 chunks — 576 m of ground around the player

/** True when a patch is entirely deep water and not worth building. */
function deepWater(terrain, x, z) {
  for (const [dx, dz] of [[0, 0], [CHUNK, 0], [0, CHUNK], [CHUNK, CHUNK], [CHUNK / 2, CHUNK / 2]]) {
    if (terrain.heightAt(x + dx, z + dz) > -6) return false;
  }
  return true;
}

/**
 * Halden, quarter by quarter (docs/WORLD.md).
 *
 * The city is one ellipse of curtain wall with two ways in — the land gate to
 * the south, where every inland road forks, and the harbour gate to the west —
 * and a second, smaller wall inside it around the upper quarter. That inner
 * ring is the point of the whole layout: it is a door in the world with two
 * guards in front of it, and the early game is about finding one of the four
 * ways through. Nothing about it is scripted; it is geometry and a
 * conversation.
 */
export const CITY = {
  at: [0, 0],
  wall: { rx: 26, rz: 34, height: 9.0, segments: 56 },
  // Angles on the wall ellipse: +Z is south (π/2), −X is west (π).
  gates: { land: Math.PI / 2, harbour: Math.PI },
  upper: { at: [0, -22], rx: 17, rz: 11, gate: Math.PI / 2, height: 5.0, segments: 30 },
  square: [0, 14],              // the market, and the middle of the lower quarter
};

/** Where a gate stands in world space, for signposting and for the bot. */
function gatePoint(cx, cz, rx, rz, angle) {
  return [cx + Math.cos(angle) * rx, cz + Math.sin(angle) * rz];
}

/**
 * A house, facing something.
 *
 * A street of buildings all facing outward reads as a level. Buildings that
 * turn to face the space in front of them read as a town, and it costs one
 * `atan2` per house to get it.
 */
function facing(x, z, look) {
  return Math.atan2(x - look[0], z - look[1]) + Math.PI;
}

/** Every building inside the walls, by quarter. */
const CITY_PLAN = [
  // --- the lower quarter: the market square, the smithy, most homes ----------
  { q: 'lower', at: [-14, 8], look: [0, 14], w: 8, d: 6, storeys: 2 },
  { q: 'lower', at: [-13, 21], look: [0, 14], w: 7.5, d: 6, storeys: 2 },
  // These two flank the street to the land gate rather than standing in it. The
  // first draft put a house on the centre line and the bot walked into its
  // gable for fifteen minutes.
  { q: 'lower', at: [-10, 28], look: [0, 22], w: 8, d: 6, storeys: 2 },
  { q: 'lower', at: [10, 28], look: [0, 22], w: 8, d: 6, storeys: 2 },
  { q: 'lower', at: [14, 21], look: [0, 14], w: 7.5, d: 6, storeys: 1 },
  { q: 'lower', at: [15, 8], look: [0, 14], w: 8, d: 6, storeys: 2 },
  { q: 'lower', at: [8, 1], look: [0, 8], w: 7, d: 5.5, storeys: 1 },
  // The smithy, which is where the first quest is: low, wide, and open-fronted.
  { q: 'lower', at: [-8, 1], look: [0, 8], w: 9, d: 6, storeys: 1 },
  // --- the harbour: warehouses and the tavern -------------------------------
  { q: 'harbour', at: [-19, -7], look: [-26, 0], w: 11, d: 7, storeys: 1 },
  { q: 'harbour', at: [-19, 4], look: [-26, 0], w: 10, d: 7, storeys: 1 },
  { q: 'harbour', at: [-12, -16], look: [-4, -12], w: 10, d: 8, storeys: 2 },
  // --- the barracks: the Watch's hall, the yard, the armoury ----------------
  { q: 'barracks', at: [18, -7], look: [6, -7], w: 13, d: 8, storeys: 2 },
  { q: 'barracks', at: [16, -18], look: [6, -14], w: 8, d: 6, storeys: 1 },
  // --- the upper quarter: behind the inner wall -----------------------------
  { q: 'upper', at: [0, -28], look: [0, -18], w: 15, d: 9, storeys: 2 },
  { q: 'upper', at: [-11, -24], look: [0, -20], w: 8, d: 6, storeys: 2 },
  { q: 'upper', at: [11, -25], look: [0, -20], w: 8, d: 6, storeys: 2 },
];

function buildCity(terrain, seed) {
  const g = (x, z) => terrain.heightAt(x, z);
  const [cx, cz] = CITY.at;
  const boxes = [];

  boxes.push(...buildWall({
    x: cx, z: cz, ground: g(cx, cz), groundAt: g,
    rx: CITY.wall.rx, rz: CITY.wall.rz, height: CITY.wall.height,
    segments: CITY.wall.segments,
    gates: [CITY.gates.land, CITY.gates.harbour],
  }));

  const u = CITY.upper;
  boxes.push(...buildWall({
    x: u.at[0], z: u.at[1], ground: g(u.at[0], u.at[1]), groundAt: g,
    rx: u.rx, rz: u.rz, height: u.height, segments: u.segments,
    gates: [u.gate],
  }));

  for (let i = 0; i < CITY_PLAN.length; i++) {
    const b = CITY_PLAN[i];
    const [x, z] = b.at;
    boxes.push(...buildHouse({
      x, z, ground: g(x, z), yaw: facing(x, z, b.look),
      w: b.w, d: b.d, storeys: b.storeys, seed: i * 17 + seed,
    }));
  }

  // The crates against the west face of the inner wall: the fourth way up.
  // They are three metres of stacked timber against a five-metre wall, put
  // where a guard on the gate cannot see them, and nothing marks them out.
  {
    const a = Math.PI * 0.86;
    const cx2 = u.at[0] + Math.cos(a) * (u.rx + 2.4);
    const cz2 = u.at[1] + Math.sin(a) * (u.rz + 2.4);
    boxes.push(...buildCrateStack(cx2, cz2, g(cx2, cz2), a + Math.PI / 2));
  }

  // The market square: the well people stand around, and two stalls.
  const [sx, sz] = CITY.square;
  boxes.push(...buildWell(sx, sz, g(sx, sz)));
  boxes.push(...buildStall(sx - 6.5, sz + 3.5, g(sx - 6.5, sz + 3.5), 0.9, seed));
  boxes.push(...buildStall(sx + 6.0, sz + 4.5, g(sx + 6.0, sz + 4.5), -1.1, seed + 1));

  return boxes;
}

/**
 * The Cleft valley: a camp, three ore pits, a keep and a shrine.
 *
 * Built from the region's own places, exactly as the island is. A region is
 * data plus one entry in the builder table below; that is the whole cost of
 * the second world.
 */
function buildValley(terrain, seed) {
  const g = (x, z) => terrain.heightAt(x, z);
  const P = terrain.places;
  const boxes = [];
  const at = (k) => P[k].at;

  boxes.push(...buildCleftGate(at('gate')[0], at('gate')[1], g(...at('gate'))));
  boxes.push(...buildCamp(at('camp')[0], at('camp')[1], g(...at('camp')), g));
  for (const [i, k] of ['pit_one', 'pit_two', 'pit_three'].entries()) {
    boxes.push(...buildPit(at(k)[0], at(k)[1], g(...at(k)), seed + i * 13));
  }
  boxes.push(...buildKeep(at('keep')[0], at('keep')[1], g(...at('keep')), g));
  boxes.push(...buildShrine(at('shrine')[0], at('shrine')[1], g(...at('shrine'))));
  return boxes;
}

/** Which builders make which region. Adding a third region is one line here. */
const BUILDERS = {
  verath: (terrain, seed) => [...buildCity(terrain, seed), ...buildOutlands(terrain, seed)],
  cleftvale: (terrain, seed) => buildValley(terrain, seed),
};

/** Everything outside the walls: five farms, three landmarks and the pass. */
function buildOutlands(terrain, seed) {
  const g = (x, z) => terrain.heightAt(x, z);
  const boxes = [];

  // The farms, each turned to face the lane that reaches it.
  const farms = [
    ['farm_aldwin', GATE_APRON], ['farm_bren', [-20, 58]], ['farm_sekk', GATE_APRON],
    ['farm_marrow', HARBOUR_APRON], ['farm_hulder', [78, 14]],
  ];
  for (let i = 0; i < farms.length; i++) {
    const [key, look] = farms[i];
    const [cx, cz] = PLACES[key].at;
    // The buildings sit *beside* the yard, not on it. A farm placed on the
    // centre of its own pad puts the longhouse in the middle of the road that
    // serves it — which is exactly where the full-playthrough bot walked into
    // one and stayed for forty minutes. The offset is directly away from
    // whatever the farm faces, so the lane still runs through the yard in
    // front of the house, which is where a lane belongs.
    const away = Math.hypot(cx - look[0], cz - look[1]) || 1;
    const x = cx + ((cx - look[0]) / away) * 9;
    const z = cz + ((cz - look[1]) / away) * 9;
    boxes.push(...buildFarm(x, z, g(x, z), facing(x, z, look), seed + i * 31));
  }

  const chapter = PLACES.chapter.at;
  boxes.push(...buildMonastery(chapter[0], chapter[1], g(chapter[0], chapter[1]), seed, g));

  const tower = PLACES.tower.at;
  boxes.push(...buildTower(tower[0], tower[1], g(tower[0], tower[1])));

  const light = PLACES.lighthouse.at;
  boxes.push(...buildLighthouse(light[0], light[1], g(light[0], light[1])));

  const cleft = PLACES.cleft.at;
  boxes.push(...buildCleftGate(cleft[0], cleft[1], g(cleft[0], cleft[1])));

  return boxes;
}

/**
 * Every suit of armour in the game, side by side, in the order you would
 * acquire them — the whole wardrobe, because the wardrobe is what a change to
 * the rig has to be checked against. `?lineup=watch,ember` picks a subset, which
 * is how a close-up of three suits is taken without a second viewer.
 */
export const DEFAULT_LINEUP = [
  'rags', 'leather', 'watch', 'ember', 'freeblade', 'knight', 'guard', 'smith', 'villager',
];

/**
 * A character sheet: every kit, side by side, on flat ground, facing the camera.
 *
 * It is a mode of the real world rather than a separate viewer — the same rig,
 * the same materials, the same lighting — so it cannot drift out of step with
 * what the game actually draws, which is the entire point of having one.
 */
function makeLineup(terrain, which) {
  // Filter first, then fall back. Doing it the other way round meant a query
  // string naming no kit anyone recognises produced an empty row, and an empty
  // row crashed the framing code with `people[0] is undefined` — a broken URL
  // should give you the default sheet, not a blank page.
  const asked = Array.isArray(which) ? which.filter((n) => KITS[n]) : [];
  const kits = asked.length ? asked : DEFAULT_LINEUP;
  return kits.map((name, i) => {
    const x = (i - (kits.length - 1) / 2) * 1.75;
    const z = 0;
    return {
      id: `kit_${name}`, kitName: name,
      pos: new Float32Array([x, terrain.heightAt(x, z), z]),
      yaw: Math.PI,                             // facing -Z, which is where the camera is
      // Alternating stride phases so the sheet shows the gait as well as the
      // gear: two mid-step, two standing.
      speed: i % 2 === 0 ? 0 : 3.4,
      phase: i * 1.9,
      kit: KITS[name], route: null, leg: 0, routeSpeed: 0, pause: 0,
    };
  });
}

/**
 * The people of Halden, placed by quarter.
 *
 * Indices are load-bearing: `src/data/dialogue.js` maps npc0 to the gate of the
 * upper quarter, npc1 to the hunter and npc3 to the smith, and the bot in
 * tools/sim.mjs finds them by the same ids. Adding somebody goes on the end.
 */
function makePeople(terrain, seed) {
  const rng = makeRng(seed * 104729 + 7);
  const upperGate = gatePoint(CITY.upper.at[0], CITY.upper.at[1], CITY.upper.rx, CITY.upper.rz, CITY.upper.gate);
  const landGate = gatePoint(CITY.at[0], CITY.at[1], CITY.wall.rx, CITY.wall.rz, CITY.gates.land);

  // Where a day happens. Named so that a routine reads as a sentence rather
  // than as coordinates: "at the anvil until seven, then the tavern".
  // Seats, not a building. Four people given the same point stand inside each
  // other and read as one very wide man.
  const TAVERN = [
    [-9.0, -13.0], [-11.2, -11.6], [-7.2, -11.2], [-10.4, -15.0], [-6.6, -14.6],
  ];
  const MARKET = [CITY.square[0], CITY.square[1]];
  const BARRACKS = [12.0, -9.0];
  const homes = [[-13.0, 9.5], [-11.5, 22.5], [11.0, 22.0], [16.0, 9.5], [8.5, 2.5]];

  const spec = [
    // npc0 — the guard on the upper gate. He paces across the opening and
    // turns strangers away; getting past him is the first act of the game.
    // At night he is relieved and sleeps in the barracks, which is the one
    // window in the game where the upper quarter is unwatched.
    { kit: 'guard', at: [upperGate[0] - 3.5, upperGate[1] + 1.5], look: [0, 6],
      route: [[upperGate[0] - 3.5, upperGate[1] + 1.5], [upperGate[0] + 3.5, upperGate[1] + 1.5]], speed: 1.1,
      day: DAYS.watch([upperGate[0] - 3.0, upperGate[1] + 1.5], [0, 6], BARRACKS) },
    // npc1 — Bosk, who does not live in the city. He waits at the fork outside
    // the land gate, where the wood begins, and he does not come in at night.
    { kit: 'villager', at: [GATE_APRON[0] + 4.5, GATE_APRON[1] + 2.0], look: landGate, route: null,
      day: DAYS.fixed([GATE_APRON[0] + 4.5, GATE_APRON[1] + 2.0], landGate) },
    { kit: 'villager', at: [CITY.square[0] - 3.2, CITY.square[1] - 2.4], look: CITY.square, route: null,
      day: DAYS.townsfolk([MARKET[0] - 3.2, MARKET[1] - 2.4], TAVERN[0], homes[0]) },
    // npc3 — Harl, at his anvil in front of the smithy. He drinks like a man
    // who has been standing over a fire since six.
    { kit: 'smith', at: [-6.0, 6.5], look: [-8, 1], route: null,
      day: DAYS.tradesman([-6.0, 6.5], [-8, 1], TAVERN[1], homes[1]) },
    { kit: 'villager', at: [CITY.square[0] + 2.6, CITY.square[1] + 3.0], look: CITY.square,
      route: [[3, 17], [-9, -4]], speed: 1.3,
      day: DAYS.townsfolk([MARKET[0] + 2.6, MARKET[1] + 3.0], TAVERN[2], homes[2]) },
    // The land gate, walked by two, and *never* left unattended: the city has
    // one way in and somebody is on it at four in the morning.
    { kit: 'guard', at: [landGate[0] - 4.0, landGate[1] - 3.0], look: [0, 40],
      route: [[landGate[0] - 4.0, landGate[1] - 3.0], [landGate[0] + 4.0, landGate[1] - 3.0]], speed: 1.5,
      day: DAYS.fixed([landGate[0] - 3.0, landGate[1] - 3.0], [0, 40]) },
    // The harbour: a porter between the two warehouses.
    { kit: 'villager', at: [-17.5, -2.0], look: [-26, 0], route: [[-17.5, -6.0], [-17.5, 3.0]], speed: 1.2,
      day: DAYS.tradesman([-17.5, -2.0], [-26, 0], TAVERN[3], homes[3]) },
    // The barracks yard.
    { kit: 'guard', at: [10.0, -8.0], look: [18, -7], route: null,
      day: DAYS.watch([10.0, -8.0], [18, -7], BARRACKS) },
    // npc8 — Yorne, outside his tavern in the harbour quarter. He is the first
    // of the four ways past the upper gate and he is deliberately the one you
    // find by wandering rather than by being sent. He keeps the house, so he is
    // the one person whose day is the opposite of everybody else's.
    { kit: 'villager', at: [-7.0, -14.5], look: [-12, -16], route: null,
      day: DAYS.fixed([-7.0, -14.5], [-12, -16]) },
    // npc9 — Captain Aldric, in the barracks. The Watch's door.
    { kit: 'knight', at: [11.5, -4.0], look: [18, -7], route: null,
      day: DAYS.watch([11.5, -4.0], [18, -7], BARRACKS) },
    // npc10 — Vessa, the alchemist, inside the upper quarter. You cannot reach
    // her without solving the gate, which is the point of putting her there.
    { kit: 'villager', at: [-8.0, -21.0], look: [0, -22], route: null,
      day: DAYS.fixed([-8.0, -21.0], [0, -22]) },
    // npc11 — Brother Kelm, on the monastery shelf. The Chapter's door.
    { kit: 'villager', at: [-18, -104], look: [-18, -118], route: null,
      day: DAYS.fixed([-18, -104], [-18, -118]) },
    // npc12 — Sarn, at Hulder's farm. The Freeblades' door, out past the road.
    { kit: 'guard', at: [58, -78], look: [64, -84], route: null,
      day: DAYS.fixed([58, -78], [64, -84]) },
    // npc13 — Ossric, at the foot of his tower. The plot.
    { kit: 'villager', at: [122, -98], look: [122, -104], route: null,
      day: DAYS.fixed([122, -98], [122, -104]) },
  ];

  return dress(spec, terrain, rng, 'npc');
}

/**
 * The people of the Cleft valley.
 *
 * Four of them, and there are four for a reason: the valley is meant to feel
 * emptied rather than populated. A camp that once held eighty men has a foreman,
 * a miner, a guard on the gate and one woman who will not leave the shrine, and
 * every one of them will tell you where everybody else went.
 */
function makeValleyPeople(terrain, seed) {
  const rng = makeRng(seed * 15485863 + 11);
  const P = terrain.places;
  const spec = [
    // val0 — Brant, who runs what is left of the camp.
    { kit: 'freeblade', at: [P.camp.at[0] - 2, P.camp.at[1] - 2], look: [P.camp.at[0], P.camp.at[1] + 20], route: null },
    // val1 — Hask, still working a pit nobody is paying him for.
    { kit: 'villager', at: [P.pit_one.at[0] + 6, P.pit_one.at[1] + 16], look: P.pit_one.at, route: null },
    // val2 — Ulla, at the shrine, who has been here longer than the mine.
    { kit: 'ember', at: [P.shrine.at[0], P.shrine.at[1] + 5], look: P.shrine.at, route: null },
    // val3 — the watch on the camp's gate, walking the gap in the palisade.
    { kit: 'guard', at: [P.camp.at[0], P.camp.at[1] + 17], look: [P.camp.at[0], P.camp.at[1] + 40],
      route: [[P.camp.at[0] - 4, P.camp.at[1] + 17], [P.camp.at[0] + 4, P.camp.at[1] + 17]], speed: 1.1 },
  ];
  return dress(spec, terrain, rng, 'val');
}

/**
 * Turn a list of positions into people.
 *
 * Shared by both regions, because a person is a person: what differs between
 * the island and the valley is who is standing where, not what standing
 * somewhere means.
 */
function dress(spec, terrain, rng, prefix) {
  return spec.map((s, i) => {
    const [x, z] = s.at;
    return {
      id: `${prefix}${i}`,
      pos: new Float32Array([x, terrain.heightAt(x, z), z]),
      // Idle people face whatever they have business with, plus a little jitter
      // so a street of them does not look like a firing squad.
      yaw: facing(x, z, s.look) + rng.range(-0.3, 0.3),
      speed: 0, phase: rng.range(0, Math.PI * 2),
      kit: KITS[s.kit], route: s.route, leg: 0, routeSpeed: s.speed || 1.4,
      pause: 0,
      // A day, as a list of hours and places. Where somebody *should* be is a
      // function of the clock alone — no state machine, nothing to save, and a
      // person you followed for two days behaves the same on the second one.
      routine: s.day || null,
    };
  });
}

function stepPerson(p, terrain, dt, hour = 12) {
  // A routine outranks a beat. If somebody is not where the hour says they
  // should be, getting there is the only thing they are doing; once they are
  // there, the beat they walk on their post takes over again. That ordering is
  // what lets a gate guard pace all day and still go to bed.
  if (p.routine && stepRoutine(p, hour, dt)) {
    p.pos[1] = terrain.heightAt(p.pos[0], p.pos[2]);
    advanceGait(p, dt);
    return;
  }
  if (p.route) {
    const target = p.route[p.leg];
    const dx = target[0] - p.pos[0], dz = target[1] - p.pos[2];
    const dist = Math.hypot(dx, dz);
    if (p.pause > 0) {
      p.pause -= dt;
      p.speed = 0;
    } else if (dist < 0.4) {
      // Turn round at the end of the leg, and stand for a moment first. People
      // who pivot instantly at a waypoint are the clearest tell of a patrol
      // route in any game.
      p.leg = (p.leg + 1) % p.route.length;
      p.pause = 1.4;
      p.speed = 0;
    } else {
      const want = Math.atan2(dx, dz);
      // Turn toward the heading rather than snapping to it.
      let d = want - p.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      p.yaw += Math.max(-2.6 * dt, Math.min(2.6 * dt, d));
      p.speed = p.routeSpeed * Math.max(0, 1 - Math.abs(d));
      p.pos[0] += Math.sin(p.yaw) * p.speed * dt;
      p.pos[2] += Math.cos(p.yaw) * p.speed * dt;
    }
  }
  p.pos[1] = terrain.heightAt(p.pos[0], p.pos[2]);
  advanceGait(p, dt);
}

/**
 * Tell anything that is listening that something happened.
 *
 * The world never makes a sound and never draws a thing; it says what occurred
 * and the browser decides what that is worth (§8.1.5). That is why the Node
 * test suite and the headless bots need no audio context and no stub for one —
 * nobody is subscribed, and `emit` on an empty list is a no-op.
 */
const sfx = (name, payload) => emit(`sfx:${name}`, payload);

export function createWorld(opts = {}) {
  const seed = opts.seed || 1;
  const regionName = opts.region || DEFAULT_REGION;
  const R = regionOf(regionName);
  const terrain = createTerrain(seed, regionName);
  const clock = new Clock((opts.hour ?? 9) * 60);
  // One seeded stream for everything that happens in a fight. Combat used
  // Math.random, which meant two runs of the same seed diverged the moment a
  // blade swung — and the bot tests, which are the only proof the world is
  // completable, were quietly measuring different worlds each time.
  const rng = makeRng(seed * 7717 + 3).stream('combat');

  // The player starts on the square, which the terrain generator flattens, so a
  // fresh game never begins halfway up a cliff.
  // `start` puts the player anywhere, which is how the gate photographs a
  // vista from a ridge and how a bug report says "stand here".
  // Just inside the land gate, on the street up to the market square: the well
  // ahead, the smithy past it, and the towers of the upper quarter over the
  // roofs. It is the first thing anybody sees and it is chosen to be the shot
  // that says what the city is — the well used to be *behind* the camera, so
  // the opening frame was three quarters of a wooden post.
  const start = opts.start || (opts.lineup ? [0, -30] : R.arrive);
  const player = createPlayer(start[0], start[1], terrain);
  player.yaw = opts.yaw ?? Math.PI;           // by default, looking up the street
  // He starts in what he arrived in, which is rags. The knight kit is the
  // character sheet's, not the player's — dressing the player in plate he has
  // not earned is exactly the lie the whole gear system exists to avoid.
  player.kit = KITS.rags;
  player.phase = 0;
  const camera = createCamera();


  // The character sheet, the flags every conversation reads, and the quest log.
  // A fresh character has held a sword before, but only just: ten per cent is
  // the bottom of the rookie band, which is one chained swing and a crit one
  // time in ten. Everything above it is bought from a trainer (P4).
  const character = createCharacter({ gold: 260, lp: 10 });
  character.skills.oneHanded = 10;
  const flags = new Set();
  const quests = new Map();
  // What you start with: rags, a branch, and one draught. Everything else is
  // earned, bought or taken.
  const inventory = createInventory({ branch: 1, rags: 1, healing_draught: 1 });
  inventory.weapon = 'branch';
  inventory.armour = 'rags';
  const traders = new Map();

  // The player is a fighter as well as a body. Both are needed: one owns where
  // he is standing, the other owns what his blade is doing.
  player.fighter = createFighter({
    hp: 120, str: character.str + 15,
    // One number, owned by the sheet. They used to be set independently, so a
    // character with 0% on paper swung at 30% in the world.
    skill: opts.skill ?? character.skills.oneHanded,
    weapon: 'oneHanded',
  });
  player.fighter.pos = player.pos;              // one position, shared
  player.xp = 0; player.level = 0;


  applyLoadout(inventory, character, player.fighter);

  // The caster sits beside the fighter rather than inside it, because a sword
  // has no mana and a rune has no reach. Both belong to the same man; neither
  // belongs to the other.
  const caster = createCaster(character);
  // The archer, on the same footing: beside the fighter, not inside it.
  const archer = createArcher();
  // Bolts and arrows in flight, and the boxes that draw them. One list, because
  // the two systems agree about what "something travelling" means and there is
  // no reason for the world to hold two opinions.
  const bolts = [];

  // Props reach as far as the furthest landmark now: the island is 340 m across
  // the built area, not the 110 m ring the first town sat in.
  const bound = terrain.size * 0.38;
  const props = scatter(terrain, opts.lineup ? 0 : (opts.props ?? 520), [-bound, -bound, bound, bound]);
  const town = (opts.town === false || opts.lineup) ? [] : BUILDERS[regionName](terrain, seed);
  const people = opts.lineup ? makeLineup(terrain, opts.lineup)
    : opts.people === false ? []
      // Only the island is populated. The valley's inhabitants are the reason
      // it is the valley, and they are not people.
      : regionName === DEFAULT_REGION ? makePeople(terrain, seed) : makeValleyPeople(terrain, seed);

  // Wolves, out past the fields. Nothing is placed on a road, on a pad or
  // inside the walls: the whole point of the design is that the road is safe
  // and the wood is not, and a wolf on the market square would say the opposite
  // (§4, P2). Distance from the gate is the difficulty curve, so the further
  // out a spawn lands the likelier it is to be the thing with tusks.
  const beasts = [];
  if (!opts.lineup && opts.beasts !== false) {
    const brng = makeRng(seed * 31337 + 5);
    // Thirty-four, not seven. The old town sat in a ninety-metre clearing and
    // seven wolves filled it; the island is three hundred and forty metres
    // across and the same seven made it empty countryside. Population is a
    // property of area, and an island you can cross without meeting anything
    // is not dangerous however hard one wolf hits.
    // The valley is smaller and much worse. Density is per region, not global.
    const wanted = opts.beasts ?? (regionName === DEFAULT_REGION ? 34 : 26);
    // `beastsAround` puts the pack somewhere specific, which is how the hunt
    // harness gets a wood to fight in without teleporting anything.
    const [hx, hz] = opts.beastsAround || [0, 0];
    const near = !!opts.beastsAround;
    for (let i = 0; i < wanted * 40 && beasts.length < wanted; i++) {
      const a = brng.range(0, Math.PI * 2);
      const r = near ? brng.range(8, 46)
        : regionName === DEFAULT_REGION ? brng.range(52, 172) : brng.range(30, 150);
      const x = hx + Math.cos(a) * r, z = hz + Math.sin(a) * r;
      if (terrain.heightAt(x, z) < 1.2 || terrain.slopeAt(x, z) > 0.5) continue;
      if (terrain.padFactor(x, z) > 0.22) continue;     // not on the road or in a yard
      // Distance from the gate is the difficulty curve, so the further out a
      // spawn lands the likelier it is to be the thing with tusks.
      const far = Math.min(1, (Math.hypot(x, z) - 52) / 100);
      const b = createBeast(brng.chance(0.78 - far * 0.4) ? 'wolf' : 'boar', x, z, terrain, brng);
      if (regionName !== DEFAULT_REGION) {
        // Everything past the pass has been living on ore and each other. This
        // is the chapter-three wall stated as arithmetic rather than as a
        // locked door — you can walk in at level two and you will not walk out.
        b.maxHp = Math.round(b.maxHp * 1.9);
        b.hp = b.maxHp;
        b.str = Math.round((b.str || 10) * 1.7);
        b.valley = true;
      }
      beasts.push(b);
    }
  }
  const beastParts = beasts.map(() => []);

  /**
   * Men, posted where somebody put them.
   *
   * Unlike beasts these are placed by hand rather than scattered, because a
   * camp is a camp: eight bandits round a lighthouse read as an occupation and
   * eight bandits sprinkled over a headland read as wildlife. They also hold
   * their ground — see `home` in src/game/foe.js — so a camp cannot be pulled
   * apart one man at a time from two hundred metres.
   */
  const foes = [];
  if (!opts.lineup && opts.foes !== false) {
    const frng = makeRng(seed * 2654435761 + 17);
    const post = (kind, cx, cz, n, spread) => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + frng.range(-0.3, 0.3);
        const r = spread * (0.45 + frng() * 0.55);
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        if (terrain.heightAt(x, z) < 0.8) continue;
        foes.push(createFoe(kind, x, z, terrain, frng));
      }
    };
    if (regionName === DEFAULT_REGION) {
      // The lighthouse. Chapter three's errand, and the reason the coast road
      // is worth walking twice.
      const l = terrain.places.lighthouse.at;
      post('bandit', l[0], l[1], 6, 15);
      post('brigand', l[0], l[1], 2, 9);
    } else {
      // The keep, and a picket on the road to it.
      const k = terrain.places.keep.at;
      post('keeper', k[0], k[1], 6, 17);
      post('brigand', k[0], k[1] + 34, 3, 9);
    }
  }
  const foeParts = foes.map(() => []);
  const boltParts = [];

  // The stolen ore, off the farm road past the first bend. It is a thing in the
  // world rather than a dialogue flag: the quest is told in the city and
  // *found* by walking out of the land gate and down the road.
  const crates = [];
  const CRATES_AT = [-30, 62];
  if (!opts.lineup && regionName === DEFAULT_REGION) {
    const [cx, cz] = CRATES_AT;
    const cy = terrain.heightAt(cx, cz);
    for (let i = 0; i < 3; i++) {
      crates.push({
        pos: [cx + i * 0.9 - 0.9, cy + 0.35, cz + (i % 2) * 0.6],
        yaw: 0.3 * i, pitch: 0, scale: [0.8, 0.7, 0.8],
        albedo: [0.30, 0.21, 0.12], tex: 10 /* MAT.PLANK */, radius: 0.5,
      });
    }
  }

  // --- doors ------------------------------------------------------------------
  //
  // A door is geometry that can be removed from the world, and that is the
  // whole of the mechanism: the gate of the upper quarter is shut because there
  // is a box in the opening, and it opens because the box comes out of the
  // scene and out of the obstacle list. Nothing anywhere reads "the player may
  // not go north".
  const doors = [];
  if (!opts.lineup && opts.town !== false && regionName === DEFAULT_REGION) {
    const u = CITY.upper;
    const ug = gatePoint(u.at[0], u.at[1], u.rx, u.rz, u.gate);
    doors.push({
      name: 'upper',
      // The leaves face along the wall's tangent at the gate, which for a gate
      // on the +Z side means across X.
      boxes: buildDoor(ug[0], ug[1], terrain.heightAt(ug[0], ug[1]), Math.PI / 2, 5.4, 4.8),
      opensOn: 'pass:upper',
    });
    const cl = PLACES.cleft.at;
    doors.push({
      name: 'cleft',
      boxes: [],                 // the Cleft's barricade is scenery; see below
      opensOn: 'pass:cleft',
      at: cl,
    });
  }
  // The keep's gate, in the valley. Same mechanism as the upper quarter's: a
  // box in the opening, taken out of the world when there is a reason.
  if (!opts.lineup && opts.town !== false && regionName === 'cleftvale') {
    const k = terrain.places.keep.at;
    const kg = [k[0], k[1] + 30];
    doors.push({
      name: 'keep',
      boxes: buildDoor(kg[0], kg[1], terrain.heightAt(kg[0], kg[1]), Math.PI / 2, 6.0, 5.6),
      opensOn: 'pass:keep',
    });
  }
  const doorBoxes = () => doors.filter((d) => !d.open).flatMap((d) => d.boxes);

  /**
   * Chests.
   *
   * Placed by hand, in the places a person would actually put one: behind the
   * smithy, in a warehouse, in the barracks armoury, in the upper quarter, and
   * out at the lighthouse and the keep where the people who own them are
   * standing over them. The lock is the *time* it takes in the open, not a
   * roll — see src/game/theft.js.
   *
   * Every one of these positions is checked by a test that puts a player beside
   * it and ticks: the first draft had four chests inside a building's footprint,
   * where the collision resolver shoved the player away from the thing he was
   * trying to open, once per tick, for ever. A chest you cannot stand next to
   * is not a chest.
   */
  const chests = [];
  if (!opts.lineup && opts.town !== false) {
    const put = (id, x, z, lock, loot, gold) => {
      const c = createChest(id, x, z, terrain, lock, loot);
      c.gold = gold || 0;
      chests.push(c);
    };
    if (regionName === DEFAULT_REGION) {
      put('chest_smithy', -12.4, 4.4, 'simple', [['lockpick', 2], ['rusty_blade', 1]], 45);
      put('chest_warehouse', -22.8, -6.9, 'good', [['leather_jerkin', 1], ['healing_draught', 2]], 120);
      put('chest_armoury', 13.4, -19.2, 'good', [['militia_sword', 1]], 90);
      // The upper quarter's, which is most of the reason to want in.
      put('chest_upper', 3.9, -24.0, 'master', [['elixir_str', 1], ['strong_draught', 2]], 380);
      put('chest_light', -140.0, -40.0, 'good', [['war_bow', 1], ['arrow', 30]], 260);
      put('chest_tower', 126.0, -100.0, 'master', [['rune_ice_lance', 1]], 200);
    } else {
      put('chest_camp', -12.0, 56.0, 'simple', [['strong_draught', 2], ['bolt', 20]], 70);
      put('chest_keep', 97.7, -118.9, 'master', [['forged_blade', 1], ['elixir_life', 1]], 700);
      put('chest_shrine', -118.0, -78.0, 'good', [['elixir_dex', 1]], 150);
    }
  }
  // A chest is a box in the world as well as a container.
  for (const c of chests) {
    town.push({
      pos: [c.pos[0], c.pos[1] + 0.36, c.pos[2]],
      yaw: (c.pos[0] + c.pos[2]) * 0.31, pitch: 0,
      scale: [0.95, 0.72, 0.66],
      albedo: [0.20, 0.14, 0.08], tex: 10 /* MAT.PLANK */, radius: 0.55,
    });
    town.push({
      pos: [c.pos[0], c.pos[1] + 0.74, c.pos[2]],
      yaw: (c.pos[0] + c.pos[2]) * 0.31, pitch: 0,
      scale: [1.0, 0.10, 0.70],
      albedo: [0.14, 0.12, 0.11], tex: 8 /* MAT.STEEL */,
    });
  }

  // Everything the character controller can bump into.
  const obstacles = [...props, ...town, ...crates, ...doorBoxes()].filter((b) => b.radius || b.box);

  // Nobody starts inside a wall. The city is placed by hand and the props are
  // placed by a generator, so sooner or later one lands on the other; shoving
  // everybody out once, at build time, costs nothing and turns a class of
  // "the smith is unreachable" bug into a non-event.
  // The shim is because `resolveObstacles` slides a *moving* body along the
  // face it hit, so it wants a velocity. A person being placed has none, and
  // giving every townsperson a velocity vector they never use would be worse
  // than lending them a zeroed one for the length of this loop.
  const seen = new Set();
  const placing = { pos: null, vel: new Float32Array(3) };
  for (const p of people) {
    placing.pos = p.pos;
    resolveObstacles(placing, obstacles);
    p.pos[1] = terrain.heightAt(p.pos[0], p.pos[2]);
  }

  // Scene buffers, reused every frame: the scene is a *view* of the simulation
  // and rebuilding it must not allocate (§8.1.4). The static half never changes;
  // the character half is refilled in place by the rig.
  const staticBoxes = [...props, ...town, ...crates, ...doorBoxes()].filter((b) => !b.invisible);
  const boxes = [];
  const playerParts = [];
  const peopleParts = people.map(() => []);

  // Ground clutter follows the player and is rebuilt when he leaves the patch
  // it was scattered for — the same "only when you cross a boundary" rule the
  // terrain streaming uses, for the same reason.
  let clutterAt = [1e9, 1e9];
  let ground = [];
  // How much grass, by quality tier. It is the third thing that scales with the
  // machine, after shadows and material detail, and for the same reason: nearly
  // free on a GPU, the most expensive thing in the frame on a software one.
  const clutterCount = opts.clutter === false ? 0 : (opts.clutter ?? 2600);

  const sunDir = new Float32Array(3);
  const shadowFocus = new Float32Array(3);
  const scene = {
    camera, boxes, sunDir, shadowFocus,
    skyColor: [0, 0, 0], zenith: [0, 0, 0], sunColor: [0, 0, 0],
    skyLight: [0, 0, 0], groundLight: [0, 0, 0],
  };

  // Where the doors are, in world space. The bot in tools/sim.mjs steers
  // through them and the render gate frames them; both used to carry their own
  // copies of these numbers, which is how a map change silently broke a test
  // that then "passed" by walking into a wall.
  const gates = {
    land: gatePoint(CITY.at[0], CITY.at[1], CITY.wall.rx, CITY.wall.rz, CITY.gates.land),
    harbour: gatePoint(CITY.at[0], CITY.at[1], CITY.wall.rx, CITY.wall.rz, CITY.gates.harbour),
    upper: gatePoint(CITY.upper.at[0], CITY.upper.at[1], CITY.upper.rx, CITY.upper.rz, CITY.upper.gate),
    apron: GATE_APRON, harbourApron: HARBOUR_APRON,
  };

  const world = {
    seed, terrain, clock, player, camera, props, town, people, beasts, foes, obstacles, ticks: 0,
    character, flags, quests, inventory, chapter: 1, openTrainer: null, openTrader: null, log: [],
    crates, gates, places: terrain.places, city: CITY,
    // Which places he has actually stood near. The map draws only these, which
    // is the one rule that makes a map worth opening twice — and it is world
    // state rather than a drawing option, because it has to be saved.
    seen,
    caster, archer, bolts, chests,
    // Death. `dead` is set the tick the player's fighter enters DEAD, and
    // `deadFor` counts up from there so the caller can hold the screen for a
    // moment before offering anything — being killed and being handed a menu in
    // the same frame reads as a bug rather than as a death.
    dead: false, deadFor: 0,
    // The end. Set once, and never unset: a finished game stays finished, and
    // the player is free to keep walking around the island afterwards.
    finished: false, wardenSpawned: false,
    region: regionName, regionTitle: R.title,
    // Set when the player is standing in an exit and may use it. The world
    // cannot replace itself, so travelling is the caller's job: main.js reads
    // this each frame, puts up the loading screen and calls `travel`.
    pendingTravel: null,
    // Set by `travel` on arrival and cleared the first time the player is clear
    // of every exit.
    travelLock: false,

    /** Experience goes to the sheet, which hands out levels and learning points. */
    awardXp(amount, reason = 'quest') {
      const gained = awardXp(character, amount, reason);
      player.xp = character.xp; player.level = character.level;
      if (gained) { world.log.push(`You are level ${character.level}. ${gained * 10} learning points.`); sfx('level'); }
      return gained;
    },

    setQuest(quest, stage) {
      quests.set(quest, stage);
      // Both the *current* stage and every stage ever reached are recorded: the
      // map gives the log something to display, the flags give conditions
      // something to read, and a conversation that wants to know whether you
      // once carried the letter can ask even after you have handed it over.
      flags.add(`quest:${quest}:${stage}`);
      const q = QUESTS[quest];
      world.log.push(q ? `${q.title} — ${q.stages[stage] || stage}` : `Quest ${quest}: ${stage}`);
      sfx('quest');
      return stage;
    },

    /**
     * The quest log, as the UI shows it: open ones first, in the order they
     * were taken, with the finished ones after.
     */
    questLog() {
      const rows = [];
      for (const [id, stage] of quests) {
        const e = questEntry(id, stage);
        if (e) rows.push(e);
      }
      return rows.sort((a, b) => (a.finished ? 1 : 0) - (b.finished ? 1 : 0));
    },

    // --- chapters --------------------------------------------------------------

    /**
     * Begin a chapter. One-way, explicit, and refused if its conditions are not
     * met — a chapter that arrives as a side effect is a chapter the player
     * cannot understand, and one that arrives early breaks every difficulty
     * assumption behind it.
     */
    setChapter(n, opts2 = {}) {
      if (n <= world.chapter && !opts2.force) return { ok: false, why: `already in chapter ${world.chapter}` };
      if (n > LAST_CHAPTER) return { ok: false, why: `there is no chapter ${n}` };
      if (!opts2.force) {
        const ready = readyFor(world, n);
        if (!ready.ok) return ready;
      }
      world.chapter = n;
      world.applyChapter(n);
      const c = CHAPTERS[n];
      if (!opts2.silent) { world.log.push(`Chapter ${n}: ${c.title}. ${c.blurb}`); sfx('chapter'); }
      return { ok: true, chapter: n };
    },

    /**
     * Make the world look like the chapter says it should.
     *
     * This is the part that matters: a chapter is a world edit, not a number.
     * It is idempotent and it is called on load as well as on advance, because
     * a save restored into a fresh chapter-one island would otherwise put the
     * player in chapter three on an island that had never heard of it.
     */
    applyChapter(n) {
      const c = CHAPTERS[n] || CHAPTERS[1];

      // Doors the chapter opens regardless of what the player did.
      for (const d of doors) if (c.doors.includes(d.name)) world.openDoor(d.name);

      // The far ring: what has moved in past the roads while you were busy.
      // Seeded off the chapter as well as the world, so the same chapter of the
      // same seed always brings the same things.
      const want = c.hardRing;
      const have = beasts.filter((b) => b.ring).length;
      if (want > have) {
        const crng = makeRng(seed * 7919 + n * 104729);
        for (let i = 0; i < want * 60 && beasts.filter((b) => b.ring).length < want; i++) {
          const a = crng.range(0, Math.PI * 2), r = crng.range(96, 190);
          const x = Math.cos(a) * r, z = Math.sin(a) * r;
          if (terrain.heightAt(x, z) < 1.2 || terrain.slopeAt(x, z) > 0.5) continue;
          if (terrain.padFactor(x, z) > 0.3) continue;
          const b = createBeast(crng.chance(0.45) ? 'wolf' : 'boar', x, z, terrain, crng);
          b.ring = n;
          // A chapter's arrivals in the valley are valley creatures too. They
          // used to be island-strength wolves standing next to things twice
          // their size, which read as a bug and was one.
          if (regionName !== DEFAULT_REGION) {
            b.valley = true;
            b.maxHp = Math.round(b.maxHp * 1.9);
            b.str = Math.round((b.str || 10) * 1.7);
          }
          // The far ring is not the same wolf further away. It hits harder and
          // it takes more, because chapter three's job is to make the road you
          // already know worth being careful on again.
          b.maxHp = Math.round(b.maxHp * (1 + n * 0.22));
          b.hp = b.maxHp;
          b.str = Math.round((b.str || 10) * (1 + n * 0.18));
          beasts.push(b);
          beastParts.push([]);
        }
      }

      // A trader's stock is a chapter-boundary thing, never a timer (§6.7).
      traders.clear();
      return n;
    },

    /**
     * Everything that survives crossing the pass.
     *
     * The regions are separate worlds — separate terrain, separate buildings,
     * separate creatures — and this is the list of what is *not* separate: the
     * man, what he is carrying, what he knows, what he has been asked to do,
     * what time it is, and which chapter he is in. Beasts are deliberately not
     * on it: the valley repopulates, and the island you come back to has moved
     * on, which is the same thing a chapter change says.
     */
    persist() {
      return {
        character, inventory,
        flags: [...flags], quests: [...quests.entries()],
        chapter: world.chapter,
        clock: { day: clock.day, minutes: clock.minutes },
        hp: player.fighter.hp, yaw: player.yaw,
        traders: world.traderState(),
      };
    },

    /** Put that state into a freshly built world. */
    adopt(state) {
      Object.assign(character, state.character);
      inventory.items = new Map(state.inventory.items);
      inventory.weapon = state.inventory.weapon;
      inventory.armour = state.inventory.armour;
      flags.clear();
      for (const f of state.flags) flags.add(f);
      quests.clear();
      for (const [k, v] of state.quests) quests.set(k, v);
      world.chapter = state.chapter;
      clock.day = state.clock.day;
      clock.minutes = state.clock.minutes;
      player.fighter.hp = state.hp;
      player.yaw = state.yaw;
      world.restoreTraders(state.traders || []);
      world.reloadout();
      world.applyChapter(world.chapter);
      if (flags.has('pass:upper')) world.openDoor('upper');
      return world;
    },

    // --- magic ------------------------------------------------------------------

    /** Which spells this character could cast if he wanted to, right now. */
    spells() {
      return Object.entries(RUNE_SPELL)
        .filter(([rune]) => has(inventory, rune))
        .map(([rune, id]) => {
          const check = canCast(id, character, caster, (r) => has(inventory, r));
          return {
            id, rune, name: SPELLS[id].short, cost: SPELLS[id].cost,
            needs: SPELLS[id].mana, ok: check.ok, why: check.why || null,
          };
        });
    },

    /**
     * Begin a cast. Refuses with a reason rather than a boolean, because "you
     * have no rune", "your mana is too low to hold it" and "your pool is empty"
     * are three different problems with three different answers.
     */
    cast(spellId) {
      const check = canCast(spellId, character, caster, (r) => has(inventory, r));
      if (!check.ok) { world.log.push(check.why); return check; }
      // A swing and a cast are the same commitment, so they cannot overlap.
      if (isStriking(player.fighter)) return { ok: false, why: 'both hands are busy' };
      beginCast(spellId, caster);
      sfx('cast');
      return { ok: true, spell: spellId };
    },

    /**
     * Where you wake up if you decline to reload.
     *
     * The nearest place with people in it, which on the island is the city and
     * in the valley is the camp. It is deliberately *not* where you fell: the
     * point of dying is that you lost the ground.
     */
    safeHaven() {
      const P = terrain.places;
      const homes = regionName === DEFAULT_REGION
        ? [CITY.square, P.farm_aldwin.at, P.farm_sekk.at, P.farm_marrow.at, P.farm_hulder.at, P.farm_bren.at]
        : [P.camp.at];
      let best = homes[0], bestD = Infinity;
      for (const h of homes) {
        const d = Math.hypot(player.pos[0] - h[0], player.pos[2] - h[1]);
        if (d < bestD) { bestD = d; best = h; }
      }
      return best;
    },

    /**
     * Wake up.
     *
     * The alternative to reloading, and it costs: a quarter of the purse,
     * half a day, and the walk back. Nothing is undone — the wolf that killed
     * you is still standing where it killed you, still carrying the wounds you
     * gave it, and it will kill you again if you go back in the same state.
     * A death you can shrug off is a difficulty curve you can ignore.
     */
    revive() {
      if (!world.dead) return { ok: false, why: 'you are not dead' };
      const [hx, hz] = world.safeHaven();
      player.pos[0] = hx; player.pos[2] = hz;
      player.pos[1] = terrain.heightAt(hx, hz);
      player.vel.set([0, 0, 0]);
      player.onGround = true;
      const lost = Math.floor(character.gold * 0.25);
      character.gold -= lost;
      const f2 = player.fighter;
      f2.state = S.IDLE; f2.t = 0; f2.combo = 0;
      f2.hp = Math.max(1, Math.floor(character.maxHp * 0.5));
      caster.mana = caster.max;
      clock.minutes += 60 * 12;
      while (clock.minutes >= 24 * 60) { clock.minutes -= 24 * 60; clock.day++; }
      world.dead = false; world.deadFor = 0;
      world.log.push(`You wake half a day later, ${lost} coin lighter.`);
      return { ok: true, at: [hx, hz], lost };
    },

    // --- thieving -----------------------------------------------------------

    /** The chest in front of the player, if there is one within reach. */
    nearestChest(reach = 2.2) {
      let best = null, bestD = reach;
      for (const c of chests) {
        const d = Math.hypot(c.pos[0] - player.pos[0], c.pos[2] - player.pos[2]);
        if (d < bestD) { bestD = d; best = c; }
      }
      return best;
    },

    /**
     * Work at the lock in front of you for one tick.
     *
     * Called from the tick while the key is held, which is what makes a lock a
     * *time cost in the open* rather than a dice roll: six seconds standing
     * still in somebody's front room, and walking away loses the progress.
     */
    pickLock() {
      const c = world.nearestChest();
      if (!c) return { ok: false, why: 'there is nothing to open here' };
      if (c.open) return { ok: true, done: true };
      const r = pick(c, flags.has('skill:lockpick'), has(inventory, 'lockpick'));
      // One tick of the pick every fifth frame, so the lock *tickers* rather
      // than emitting a hundred and eighty clicks a second.
      if (!r.why && !r.done && Math.round(c.picked) % 5 === 0) sfx('lock');
      if (r.why) return { ok: false, why: r.why };
      if (r.done) {
        sfx('unlock');
        world.log.push('the lock gives');
        world.awardXp(c.lock === 'master' ? 200 : c.lock === 'good' ? 90 : 40, 'quest');
      }
      return { ok: true, done: r.done, progress: r.progress };
    },

    /** Take what is in it. Once. */
    loot(chest) {
      const c = chest || world.nearestChest();
      if (!c) return { ok: false, why: 'there is nothing to open here' };
      if (!c.open && c.lock) return { ok: false, why: 'it is locked' };
      c.open = true;
      if (c.emptied) return { ok: false, why: 'you have already had this one' };
      c.emptied = true;
      const took = [];
      for (const [id, n] of c.loot) { world.give(id, n); took.push(`${n}× ${ITEMS[id].name}`); }
      if (c.gold) { character.gold += c.gold; took.push(`${c.gold} coin`); sfx('coin'); }
      world.log.push(took.length ? `took ${took.join(', ')}` : 'it is empty');
      return { ok: true, took };
    },

    /**
     * Lift a purse.
     *
     * Behind him, close, and nobody watching — three conditions of geometry
     * rather than one roll of a die. Sneaking shrinks how far people can see
     * you, which is the only thing sneaking has ever done here and is enough.
     */
    pickPocket(person) {
      // *Not* `speaker()`: that one requires you to be facing them, and the
      // whole point of a pocket is that you are behind it.
      const p = person || nearestPerson(1.5);
      if (!p) return { ok: false, why: 'there is nobody there' };
      const check = canPickPocket(p, player, people, flags.has('skill:pickpocket'), player.sneaking);
      if (!check.ok) { world.log.push(check.why); return check; }
      p.robbed = true;
      const purse = 12 + Math.floor(rng() * 60);
      character.gold += purse;
      sfx('coin');
      world.awardXp(60, 'quest');
      world.log.push(`lifted ${purse} coin`);
      return { ok: true, gold: purse };
    },

    /** The nearest person, facing or not. */
    nearPerson(reach = 1.5) { return nearestPerson(reach); },

    /** Who can see the player right now — the whole of stealth, as a list. */
    watchers() {
      return people.filter((p) => canSee(p, player.pos[0], player.pos[2], player.sneaking));
    },

    // --- thieving -----------------------------------------------------------

    /** The chest in front of the player, if there is one within reach. */
    nearestChest(reach = 2.2) {
      let best = null, bestD = reach;
      for (const c of chests) {
        const d = Math.hypot(c.pos[0] - player.pos[0], c.pos[2] - player.pos[2]);
        if (d < bestD) { bestD = d; best = c; }
      }
      return best;
    },

    /**
     * Work at the lock in front of you for one tick.
     *
     * Called from the tick while the key is held, which is what makes a lock a
     * *time cost in the open* rather than a dice roll: six seconds standing
     * still in somebody's front room, and walking away loses the progress.
     */
    pickLock() {
      const c = world.nearestChest();
      if (!c) return { ok: false, why: 'there is nothing to open here' };
      if (c.open) return { ok: true, done: true };
      const r = pick(c, flags.has('skill:lockpick'), has(inventory, 'lockpick'));
      // One tick of the pick every fifth frame, so the lock *tickers* rather
      // than emitting a hundred and eighty clicks a second.
      if (!r.why && !r.done && Math.round(c.picked) % 5 === 0) sfx('lock');
      if (r.why) return { ok: false, why: r.why };
      if (r.done) {
        sfx('unlock');
        world.log.push('the lock gives');
        world.awardXp(c.lock === 'master' ? 200 : c.lock === 'good' ? 90 : 40, 'quest');
      }
      return { ok: true, done: r.done, progress: r.progress };
    },

    /** Take what is in it. Once. */
    loot(chest) {
      const c = chest || world.nearestChest();
      if (!c) return { ok: false, why: 'there is nothing to open here' };
      if (!c.open && c.lock) return { ok: false, why: 'it is locked' };
      c.open = true;
      if (c.emptied) return { ok: false, why: 'you have already had this one' };
      c.emptied = true;
      const took = [];
      for (const [id, n] of c.loot) { world.give(id, n); took.push(`${n}× ${ITEMS[id].name}`); }
      if (c.gold) { character.gold += c.gold; took.push(`${c.gold} coin`); sfx('coin'); }
      world.log.push(took.length ? `took ${took.join(', ')}` : 'it is empty');
      return { ok: true, took };
    },

    /**
     * Lift a purse.
     *
     * Behind him, close, and nobody watching — three conditions of geometry
     * rather than one roll of a die. Sneaking shrinks how far people can see
     * you, which is the only thing sneaking has ever done here and is enough.
     */
    pickPocket(person) {
      // *Not* `speaker()`: that one requires you to be facing them, and the
      // whole point of a pocket is that you are behind it.
      const p = person || nearestPerson(1.5);
      if (!p) return { ok: false, why: 'there is nobody there' };
      const check = canPickPocket(p, player, people, flags.has('skill:pickpocket'), player.sneaking);
      if (!check.ok) { world.log.push(check.why); return check; }
      p.robbed = true;
      const purse = 12 + Math.floor(rng() * 60);
      character.gold += purse;
      sfx('coin');
      world.awardXp(60, 'quest');
      world.log.push(`lifted ${purse} coin`);
      return { ok: true, gold: purse };
    },

    /** The nearest person, facing or not. */
    nearPerson(reach = 1.5) { return nearestPerson(reach); },

    /** Who can see the player right now — the whole of stealth, as a list. */
    watchers() {
      return people.filter((p) => canSee(p, player.pos[0], player.pos[2], player.sneaking));
    },

    // --- shooting -----------------------------------------------------------

    /** What the bow in hand is, if there is one. */
    bow() {
      const w = inventory.weapon ? ITEMS[inventory.weapon] : null;
      if (!w || !isRanged(w.class)) return null;
      const ammoId = w.class === 'crossbow' ? 'bolt' : 'arrow';
      return {
        id: inventory.weapon, name: w.name, cls: w.class,
        damage: w.damage, ammo: ammoId, have: count(inventory, ammoId),
        skill: character.skills[w.class] || 0,
        drawing: archer.drawing ? archer.t : 0,
      };
    },

    /**
     * Draw and loose. Refuses with a reason, like every other door in this game.
     *
     * The arrow is spent at the *loose*, not at the draw — a draw you are
     * knocked out of costs you the time and not the arrow, which is the right
     * way round: the arrow is still nocked when you are hit.
     */
    shoot() {
      const b = world.bow();
      if (!b) return { ok: false, why: 'you are not holding a bow' };
      const check = canShoot(b.cls, character, archer, b.have);
      if (!check.ok) { world.log.push(check.why); return check; }
      if (isStriking(player.fighter)) return { ok: false, why: 'both hands are busy' };
      if (caster.casting) return { ok: false, why: 'both hands are busy' };
      beginDraw(b.cls, archer);
      return { ok: true, weapon: b.cls };
    },

    /** Take a door out of the world. Idempotent; the geometry only goes once. */
    openDoor(name) {
      const d = doors.find((x) => x.name === name);
      if (!d || d.open) return false;
      d.open = true;
      for (const box of d.boxes) {
        const i = obstacles.indexOf(box);
        if (i >= 0) obstacles.splice(i, 1);
        const j = staticBoxes.indexOf(box);
        if (j >= 0) staticBoxes.splice(j, 1);
      }
      world.log.push(`The ${name} gate is open.`);
      sfx('door');
      return true;
    },

    doorOpen(name) {
      const d = doors.find((x) => x.name === name);
      return !d || !!d.open;
    },

    joinGuild(guild) {
      const r = joinGuild(character, guild);
      if (r.ok) world.log.push(`You are sworn to the ${guild}.`);
      return r;
    },

    makeHostile(npc) { if (npc) npc.hostile = true; },

    // --- carrying ------------------------------------------------------------
    give(id, n = 1) { add(inventory, id, n); world.log.push(`+${n} ${item(id).name}`); },
    take(id, n = 1) { return remove(inventory, id, n); },
    carrying: (id, n = 1) => has(inventory, id, n),
    items: () => listing(inventory),

    equip(id) {
      const r = equip(inventory, character, id);
      if (r.ok) { world.reloadout(); world.log.push(`equipped ${r.item.name}`); }
      else world.log.push(r.why);
      return r;
    },
    unequip(slot) {
      unequip(inventory, slot);
      world.reloadout();
      return { ok: true };
    },
    drink(id) {
      const r = drink(inventory, character, player.fighter, id);
      world.log.push(r.ok ? (r.healed ? `healed ${r.healed}` : 'you feel it settle in') : r.why);
      return r;
    },

    // --- trading -------------------------------------------------------------
    trader(id) {
      if (!traders.has(id)) traders.set(id, createTrader(id));
      return traders.get(id);
    },
    buy(id, n = 1) {
      if (!world.openTrader) return { ok: false, why: 'nobody is selling' };
      const r = buy(world.trader(world.openTrader), inventory, character, id, n);
      world.log.push(r.ok ? `bought ${item(id).name} for ${r.paid}` : r.why);
      return r;
    },
    sell(id, n = 1) {
      if (!world.openTrader) return { ok: false, why: 'nobody is buying' };
      const r = sell(world.trader(world.openTrader), inventory, character, id, n);
      world.log.push(r.ok ? `sold ${item(id).name} for ${r.got}` : r.why);
      return r;
    },

    /** Trader purses and stock, for the save file. */
    /**
     * What the man in front of you is selling, and what he will take.
     *
     * One call rather than three, because a shop screen needs all of it at once
     * and the alternative is the UI reaching into the trader's internals.
     */
    shop() {
      if (!world.openTrader) return null;
      const t = world.trader(world.openTrader);
      const stock = [...t.stock.entries()]
        .filter(([, n]) => n > 0)
        .map(([id, n]) => ({
          id, n, name: ITEMS[id].name, price: buyPrice(ITEMS[id]),
          afford: character.gold >= buyPrice(ITEMS[id]),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      const mine = listing(inventory)
        .filter((it) => !ITEMS[it.id].unsellable && (t.buys || []).includes(it.kind))
        .map((it) => ({ ...it, price: sellPrice(ITEMS[it.id]), wanted: t.gold >= sellPrice(ITEMS[it.id]) }));
      return { id: world.openTrader, gold: t.gold, purse: character.gold, stock, mine };
    },

    traderState() {
      return [...traders.entries()].map(([id, t]) => [id, t.gold, [...t.stock.entries()]]);
    },
    restoreTraders(state) {
      traders.clear();
      for (const [id, gold, stock] of state) {
        const t = createTrader(id);
        t.gold = gold;
        t.stock = new Map(stock);
        traders.set(id, t);
      }
    },
    /**
     * Put the loadout on: the numbers on the fighter, and the *pieces on the
     * model*. Armour you cannot see is a number, and a number is not a reward —
     * so equipping the Watch's mail has to change the man on screen, and it does
     * it here, in the one place a change of gear passes through.
     */
    reloadout() {
      applyLoadout(inventory, character, player.fighter);
      syncCaster(caster, character);
      player.kit = kitForArmour(inventory.armour);
      return player.kit;
    },

    /** A save is the seed plus everything that has changed since (§12.1). */
    snapshot() { return snapshot(world); },
    restore(data) { return restore(world, data); },

    /**
     * The world half of the quest log: things that become true by being done
     * rather than by being said. Cheap to check every tick and the only place
     * a quest can advance without a conversation.
     */
    checkQuests() {
      // You have to know the ore was taken before a pile of crates in a wood
      // means anything — which is what `knows:ore_theft` is for, and why the
      // flag is read here rather than being a note in a conversation.
      if (quests.get('q_ore') === 'told' && flags.has('knows:ore_theft') && crates.length) {
        const d = Math.hypot(player.pos[0] - crates[0].pos[0], player.pos[2] - crates[0].pos[2]);
        if (d < 3) {
          world.setQuest('q_ore', 'found');
          world.give('ore_crate');
          world.give('bandit_letter');
        }
      }
      if (quests.get('q_wolves') === 'told') {
        const dead = beasts.filter((b) => b.kind === 'wolf' && b.state === S.DEAD).length;
        if (dead >= 4) world.setQuest('q_wolves', 'cleared');
      }

      // Carrying the letter is a state of the world, not a thing you are told.
      if (quests.get('q_letter') === 'told' && has(inventory, 'sealed_letter')) {
        world.setQuest('q_letter', 'carried');
      }

      // The gate opens the moment you have a reason to be let through, however
      // you got one. `pass:upper` is set by four different conversations and by
      // the crates; the door does not care which.
      if (flags.has('pass:upper')) world.openDoor('upper');

      // The fourth way: you are standing inside the upper quarter and nobody
      // opened the gate for you. There is exactly one place the wall can be
      // cleared from, and only with the jump acrobatics buys — so getting here
      // is proof, and the flag is the world noticing rather than granting.
      if (!flags.has('pass:upper') && !world.doorOpen('upper')) {
        const u = CITY.upper;
        const dx = (player.pos[0] - u.at[0]) / u.rx, dz = (player.pos[2] - u.at[1]) / u.rz;
        if (Math.hypot(dx, dz) < 0.94 && player.onGround) {
          flags.add('pass:upper');
          world.setQuest('q_upper', 'climbed');
          world.awardXp(250, 'quest');
        }
      }
      if (flags.has('pass:upper') && quests.get('q_upper') !== 'done') {
        const how = quests.get('q_upper');
        if (how && how !== 'refused') world.setQuest('q_upper', 'done');
      }

      // The Cleft is walked, not talked about. Standing in the mouth of the pass
      // is what finishes it, which is the same rule the crates follow: a place
      // in the world, reached on foot.
      if (flags.has('quest:q_cleft:told') && quests.get('q_cleft') !== 'done') {
        const c2 = PLACES.cleft.at;
        if (Math.hypot(player.pos[0] - c2[0], player.pos[2] - c2[1]) < PLACES.cleft.r) {
          world.setQuest('q_cleft', 'done');
          world.awardXp(800, 'quest');
        }
      }

      // --- the valley -----------------------------------------------------
      //
      // Ore is *cut*, not picked up: standing at a pit with the quest open is
      // what gets it, which is the same rule the crates and the Cleft follow —
      // a place in the world, reached on foot.
      if (regionName === 'cleftvale' && flags.has('quest:q_shrine:told')) {
        const pits = [['pit_one', 'ore_west'], ['pit_two', 'ore_east'], ['pit_three', 'ore_deep']];
        for (const [place, id] of pits) {
          const at = terrain.places[place].at;
          if (has(inventory, id)) continue;
          if (Math.hypot(player.pos[0] - at[0], player.pos[2] - at[1]) < 18) {
            world.give(id);
            world.awardXp(120, 'quest');
          }
        }
        if (quests.get('q_shrine') === 'told'
          && has(inventory, 'ore_west') && has(inventory, 'ore_east') && has(inventory, 'ore_deep')) {
          world.setQuest('q_shrine', 'gathered');
        }
      }

      // The keep opens for a man who knows what is inside it and has been sent.
      // Two conditions, both earned, and the gate is geometry either way.
      if (regionName === 'cleftvale' && flags.has('quest:q_keep:told') && !flags.has('pass:keep')) {
        flags.add('pass:keep');
        world.setQuest('q_keep', 'opened');
      }
      if (flags.has('pass:keep')) world.openDoor('keep');
      // The keep is not finished by walking into it. It is finished by there
      // being nobody left in it, which is a different sentence and a much
      // longer afternoon.
      if (regionName === 'cleftvale' && quests.get('q_keep') === 'opened') {
        const k = terrain.places.keep.at;
        const held = foes.some((m) => m.state !== S.DEAD
          && Math.hypot(m.pos[0] - k[0], m.pos[2] - k[1]) < 40);
        if (!held && Math.hypot(player.pos[0] - k[0], player.pos[2] - k[1]) < 20) {
          world.setQuest('q_keep', 'done');
          world.awardXp(1500, 'quest');
        }
      }

      // The lighthouse, the same way: the headland is quiet when it is quiet.
      if (regionName === DEFAULT_REGION && quests.get('q_lighthouse') === 'told') {
        const l = terrain.places.lighthouse.at;
        const held = foes.some((m) => m.state !== S.DEAD
          && Math.hypot(m.pos[0] - l[0], m.pos[2] - l[1]) < 40);
        if (!held) {
          world.setQuest('q_lighthouse', 'done');
          world.awardXp(1200, 'quest');
        }
      }

      // --- the end ---------------------------------------------------------
      //
      // Taking the keep is what tells you where the ore went; walking into the
      // deep pit is what finds who it went to. Both follow the rule the whole
      // game follows — a place in the world, reached on foot — and the last man
      // is spawned rather than pre-placed so that the valley is not haunted by
      // a boss standing in a hole for forty hours before anybody is sent.
      if (regionName === 'cleftvale') {
        if (quests.get('q_keep') === 'done' && !flags.has('quest:q_end:told')) {
          world.setQuest('q_end', 'told');
        }
        if (flags.has('quest:q_end:told') && !world.wardenSpawned) {
          const pit = terrain.places.pit_three.at;
          if (Math.hypot(player.pos[0] - pit[0], player.pos[2] - pit[1]) < 26) {
            world.wardenSpawned = true;
            const wrng = makeRng(seed * 40961 + 7);
            const boss = createFoe('warden', pit[0], pit[1] - 6, terrain, wrng);
            foes.push(boss); foeParts.push([]);
            for (let i = 0; i < 3; i++) {
              const a = (i / 3) * Math.PI * 2;
              const g = createFoe('keeper', pit[0] + Math.cos(a) * 9, pit[1] + Math.sin(a) * 9, terrain, wrng);
              foes.push(g); foeParts.push([]);
            }
            world.setQuest('q_end', 'found');
            world.log.push('Somebody is down here, and he has been paid in ore.');
          }
        }
        if (quests.get('q_end') === 'found'
          && !foes.some((m) => m.def.boss && m.state !== S.DEAD)
          && world.wardenSpawned) {
          world.setQuest('q_end', 'done');
          world.awardXp(6000, 'quest');
          world.finished = true;
          world.log.push('It is finished.');
        }
      }

      // Standing in an exit. Both ends of the pass are exits, so walking back
      // out of the valley works the same way walking in did.
      //
      // The lock is why arriving somewhere does not immediately send you back.
      // A player put down near the mouth of the pass is standing in the thing
      // that would take them through it, so an exit does nothing until they
      // have stepped out of every exit at least once. `returnAt` already keeps
      // them clear of it; this makes the rule true rather than merely likely.
      world.pendingTravel = null;
      let inAnyExit = false;
      for (const exit of terrain.exits) {
        const d = Math.hypot(player.pos[0] - exit.at[0], player.pos[2] - exit.at[1]);
        if (d > exit.radius) continue;
        inAnyExit = true;
        if (world.travelLock) continue;
        if (exit.needs && !flags.has(exit.needs)) {
          // The pass is not locked — it is *unknown*. Until somebody has told
          // you the road east is worth walking, standing at the barricade does
          // nothing, and the barricade itself can be climbed round at any time.
          continue;
        }
        world.pendingTravel = exit.to;
        break;
      }
      if (!inAnyExit) world.travelLock = false;

      // Chapters advance when their conditions come true and never otherwise.
      // Checked here rather than fired from a conversation so that every route
      // into a chapter goes through the same door — including the three
      // different guilds, which is the whole point of having three.
      for (let n = world.chapter + 1; n <= LAST_CHAPTER; n++) {
        if (!readyFor(world, n).ok) break;
        world.setChapter(n);
      }
    },

    /**
     * Buy what a trainer is offering. This is the only path in the game that
     * can raise a skill, and it is deliberately separate from the conversation
     * that opened the offer: talking is free, learning costs learning points.
     */
    /** Learning a skill teaches the character; the world writes the flag too. */
    train(step) {
      const offer = world.openTrainer;
      if (!offer) return { ok: false, why: 'nobody is teaching' };
      // An attribute lesson and a skill lesson are the same act from the
      // player's side — stand in front of the man and press T — so they arrive
      // at the same door and part here rather than in the key handler.
      if (offer.attr) return world.raise(offer.attr, step ?? offer.step ?? 1);
      const skill = offer.skill;
      const amount = step ?? offer.step ?? 1;
      const current = character.skills[skill] ?? 0;
      if (offer.max != null && current >= offer.max) {
        return { ok: false, why: `they can teach you no further than ${offer.max}%` };
      }
      const room = offer.max != null ? Math.min(amount, offer.max - current) : amount;
      const r = learn(character, skill, room, 'trainer');
      if (r.ok) {
        world.log.push(`${skill} ${r.value != null ? `is now ${r.value}%` : 'learned'} (${r.cost} LP)`);
        // The world's flag set is what dialogue and loot read, so a skill
        // learned on the sheet has to appear there too.
        for (const f of character.flags) flags.add(f);
        world.reloadout();
      }
      return r;
    },

    raise(attr, points = 1) {
      const r = raiseAttribute(character, attr, points, 'trainer');
      if (r.ok) {
        world.log.push(`${attr} is now ${r.value} (${r.cost} LP)`);
        if (attr === 'str') player.fighter.str = character.str;
        if (attr === 'mana') syncCaster(caster, character);
      }
      return r;
    },

    /** The nearest person close enough and in front of you to talk to. */
    speaker(reach = 3.2) {
      let best = null, bestD = reach;
      for (const p of people) {
        const dx = p.pos[0] - player.pos[0], dz = p.pos[2] - player.pos[2];
        const d = Math.hypot(dx, dz);
        if (d > bestD) continue;
        let off = Math.atan2(dx, dz) - player.yaw;
        while (off > Math.PI) off -= Math.PI * 2;
        while (off < -Math.PI) off += Math.PI * 2;
        if (Math.abs(off) > 1.1) continue;        // you talk to people you face
        best = p; bestD = d;
      }
      return best;
    },

    /** Open a conversation with whoever is in front of the player. */
    talk() {
      const npc = world.speaker();
      if (!npc) return null;
      const nodes = DIALOGUE[SPEAKERS[npc.id]];
      if (!nodes) return null;
      world.openTrainer = null;
      return dialogue.start(npc, nodes);
    },

    /** One simulation step. `intent` is what the player (or a bot) asked for. */
    tick(dt, intent = idleIntent()) {
      this.ticks++;
      clock.tick(dt);
      // The world keeps running during a conversation — time passes, people
      // walk past, and a wolf that wanders up is still a wolf (§6.5) — but the
      // player neither moves nor swings while he is talking.
      if (dialogue.isOpen) intent = idleIntent();
      // A dead man takes no orders, and neither does one mid-conversation. Both
      // are blanked *here*, before the legs move, rather than in the input
      // layer: a bot, a replay and a keyboard all arrive at this function and
      // only one of them goes through the input layer. The first version
      // blanked the intent after `stepPlayer` had already used it, and the
      // corpse walked six metres.
      if (player.fighter.state === S.DEAD) intent = idleIntent();
      const wasPhase = player.phase || 0;
      stepPlayer(player, intent, terrain, obstacles, dt);
      advanceGait(player, dt);
      // A footstep falls when the gait phase crosses a half turn, which is what
      // makes the sound land on the foot rather than on a timer.
      if (player.onGround && player.speed > 0.4
        && Math.floor(wasPhase / Math.PI) !== Math.floor((player.phase || 0) / Math.PI)) {
        sfx('step', {
          speed: player.speed,
          ground: terrain.padFactor(player.pos[0], player.pos[2]) > 0.5 ? 'stone' : 'grass',
        });
      }

      // The blade is a separate machine from the legs, and it is the one with
      // the frame counts. Movement is locked while a swing is out, which is the
      // whole meaning of commitment.
      const f = player.fighter;
      f.facing = player.yaw;
      const swinging = f.state === S.WINDUP || f.state === S.ACTIVE || f.state === S.STAGGER;
      if (swinging) { player.vel[0] *= 0.25; player.vel[2] *= 0.25; }
      // The attack button uses the weapon in hand. A separate "shoot" key would
      // mean the player holding a bow has an attack button that does nothing,
      // which is the sort of thing that reads as broken rather than as design.
      const holdingBow = !!world.bow();
      if (holdingBow) {
        if (intent.attack && !archer.drawing && world.shoot().ok) sfx('draw');
        // A drawn bow is a committed body, exactly like a swing.
        if (archer.drawing) { player.vel[0] *= 0.35; player.vel[2] *= 0.35; }
        stepFighter(f, { ...intent, attack: false }, rng);
      } else {
        stepFighter(f, intent, rng);
      }

      // A swing announces itself on the tick it starts, not on the tick it
      // lands: the wind-up is the tell, and the tell is half the fight.
      if (f.state === S.WINDUP && f.t === f.weapon.windup) sfx('swing');

      const hpWas = f.hp;
      for (const b of beasts) {
        stepBeast(b, player, terrain, dt, rng);
        if (isStriking(b)) resolveStrike(b, f, rng, meleeDamage);
      }
      for (const m of foes) {
        stepFoe(m, player, terrain, dt, rng);
        if (isStriking(m)) {
          const landed = resolveStrike(m, f, rng, meleeDamage);
          // Being hit ends a cast and keeps the mana. That is the only thing
          // that makes being interrupted matter, and it is why a mage learns to
          // cast from behind something.
          if (landed) { breakCast(caster); breakDraw(archer); }
        }
      }

      // The blade's own report: a parry rings, a block thuds, and a hit that
      // got through neither is a grunt. If those three sound alike the player
      // cannot learn the timing by ear, and learning it by ear is most of what
      // a second playthrough is.
      if (f.hp < hpWas) sfx(f.state === S.PARRY ? 'parry' : f.state === S.BLOCK ? 'block' : 'hurt');

      // --- shooting ------------------------------------------------------------
      const loosed = stepArcher(archer);
      if (loosed) {
        const w = ITEMS[inventory.weapon];
        const ammoId = loosed === 'crossbow' ? 'bolt' : 'arrow';
        if (has(inventory, ammoId)) {
          remove(inventory, ammoId);
          sfx('shoot');
          bolts.push(createArrow(loosed, [
            player.pos[0] + Math.sin(player.yaw) * 0.5,
            player.pos[1] + 1.3,
            player.pos[2] + Math.cos(player.yaw) * 0.5,
          ], player.yaw, player.pitch * 0.7 + 0.012, w ? w.damage : 20, rng,
          character.skills[loosed] || 0));
        } else {
          world.log.push('no arrows');
        }
      }

      // --- magic ---------------------------------------------------------------
      const released = stepCaster(caster, dt);
      if (released) {
        const spell = SPELLS[released];
        if (spell.self) {
          const before = f.hp;
          f.hp = Math.min(character.maxHp, f.hp + spell.heals);
          world.log.push(`healed ${f.hp - before}`);
        } else {
          sfx('bolt');
          // Out of the hand, at chest height, along the way he is looking.
          bolts.push(createBolt(released, [
            player.pos[0] + Math.sin(player.yaw) * 0.6,
            player.pos[1] + 1.25,
            player.pos[2] + Math.cos(player.yaw) * 0.6,
          ], player.yaw, player.pitch * 0.6));
        }
      }
      const inTheWay = [...beasts, ...foes];
      for (let i = bolts.length - 1; i >= 0; i--) {
        const bolt = bolts[i];
        const struck = bolt.arrow
          ? stepArrow(bolt, inTheWay, terrain, dt)
          : stepBolt(bolt, inTheWay, terrain, dt);
        for (const target of struck) {
          // Magic ignores armour and cannot be parried — that is what a rune is
          // *for*, and it is why the mana wall has to be a real one. An arrow
          // does not get that: armour is exactly what armour is against.
          const damage = bolt.arrow
            ? Math.max(2, bolt.damage + Math.round(character.dex * 0.4) - (target.armor || 0))
            : SPELLS[bolt.spell].damage;
          target.hp -= damage;
          if (target.hp <= 0 && target.state !== S.DEAD) {
            target.hp = 0;
            target.state = S.DEAD;
            if (!target.counted) {
              target.counted = true;
              if (target.foe) {
                const spoils = foeSpoils(target, rng);
                world.awardXp(spoils.xp, 'quest');
                character.gold += spoils.gold;
                for (const id of spoils.items) world.give(id);
              } else {
                world.awardXp(target.def.xp, 'quest');
                for (const drop of DROPS[target.kind] || []) {
                  const def = ITEMS[drop.item];
                  if (def.needs && !flags.has(`skill:${def.needs}`)) continue;
                  if (rng() < drop.chance) world.give(drop.item);
                }
              }
            }
          }
        }
        if (bolt.life <= 0) bolts.splice(i, 1);
      }
      if (isStriking(f)) {
        for (const m of foes) {
          const hit = resolveStrike(f, m, rng, meleeDamage);
          if (hit) sfx('hit', { armour: m.armor });
          if (hit && m.state === S.DEAD && !m.counted) {
            m.counted = true;
            const spoils = foeSpoils(m, rng);
            world.awardXp(spoils.xp, 'quest');
            character.gold += spoils.gold;
            for (const id of spoils.items) world.give(id);
            world.log.push(`${m.def.name} down — ${spoils.gold} coin`);
          }
        }
        for (const b of beasts) {
          const hit = resolveStrike(f, b, rng, meleeDamage);
          if (hit) sfx('hit', { armour: b.armor });
          if (hit && b.state === S.DEAD && !b.counted) {
            b.counted = true;
            world.awardXp(b.def.xp, 'quest');
            // Trophies. A hide needs skinning; a fang does not, which is why
            // the free lesson from the hunter is worth walking back for.
            for (const drop of DROPS[b.kind] || []) {
              const def = ITEMS[drop.item];
              if (def.needs && !flags.has(`skill:${def.needs}`)) continue;
              if (rng() < drop.chance) world.give(drop.item);
            }
          }
        }
      }

      // Thieving. Both verbs are driven from the tick rather than from a key
      // handler, because a lock is *held* and a bot has to be able to do it.
      if (intent.pick) {
        const c = world.nearestChest();
        if (c && !c.open) world.pickLock();
        else if (c && !c.emptied) world.loot(c);
      }
      if (intent.steal && !world.stealHeld) world.pickPocket();
      world.stealHeld = !!intent.steal;

      // Discovery. Standing inside a place's own pad is what puts it on the
      // map; walking past at two hundred metres is not. Cheap enough to do
      // every tick because a region has fewer than a dozen places in it.
      for (const [name, p] of Object.entries(terrain.places)) {
        if (seen.has(name)) continue;
        const rx = p.w || p.r, rz = p.r;
        if (Math.hypot((player.pos[0] - p.at[0]) / rx, (player.pos[2] - p.at[1]) / rz) < 1.05) {
          seen.add(name);
          world.log.push(`Found: ${name.replace(/_/g, ' ')}`);
        }
      }

      // A lock you walked away from is a lock you have to start again. Kept
      // here rather than in the key handler so that it is true of a bot and of
      // a player who simply got bored and wandered off.
      for (const c of chests) {
        if (c.open || c.picked <= 0) continue;
        if (Math.hypot(c.pos[0] - player.pos[0], c.pos[2] - player.pos[2]) > 2.6) abandonPick(c);
      }

      // Death. Noticed here rather than raised from the combat code, because
      // the fighter does not know it belongs to the player and should not.
      if (f.state === S.DEAD) {
        if (!world.dead) { world.dead = true; world.deadFor = 0; world.log.push('You are dead.'); }
        else world.deadFor++;
      }

      // Knockback moved bodies after the ground was resolved, so everything
      // that got shoved has to be put back on the world: the character-never-
      // falls-through test caught the player standing four centimetres inside a
      // hillside for a tick after a wolf hit him.
      resolveObstacles(player, obstacles);
      const ground = terrain.heightAt(player.pos[0], player.pos[2]);
      if (player.pos[1] < ground) { player.pos[1] = ground; player.onGround = true; }
      for (const b of beasts) b.pos[1] = terrain.heightAt(b.pos[0], b.pos[2]);
      for (const m of foes) m.pos[1] = terrain.heightAt(m.pos[0], m.pos[2]);

      for (const p of people) stepPerson(p, terrain, dt, clock.minutes / 60);
      world.checkQuests();
      stepCamera(camera, player, terrain, obstacles, dt);
      return this;
    },

    /**
     * The terrain cell the player stands in. The renderer rebuilds its meshes
     * when this changes and not otherwise, which is the whole of streaming.
     */
    terrainCell() {
      return `${Math.floor(player.pos[0] / CHUNK)},${Math.floor(player.pos[2] / CHUNK)}`;
    },

    /**
     * Which patches of ground to build, around the player.
     *
     * Every chunk is the same 64 m square and only the vertex count changes
     * with distance. That is a deliberate simplification of the usual clipmap:
     * rings of *different-sized* chunks have to be aligned to each other's
     * grids or they overlap and z-fight, and the alignment arithmetic is where
     * that technique goes wrong. One grid cannot misalign with itself, the
     * skirts cover the resolution seams, and the far ring is cheap enough that
     * the extra chunks cost less than the bug would have.
     */
    chunkPlan(px = player.pos[0], pz = player.pos[2]) {
      const cx = Math.floor(px / CHUNK), cz = Math.floor(pz / CHUNK);
      const plan = [];
      for (let j = -RADIUS; j <= RADIUS; j++) {
        for (let i = -RADIUS; i <= RADIUS; i++) {
          const ring = Math.max(Math.abs(i), Math.abs(j));
          const x = (cx + i) * CHUNK, z = (cz + j) * CHUNK;
          // Nothing is built for a patch that is entirely deep water: the
          // island falls away to the sea, and past that there is nothing to
          // look at and no reason to pay for it.
          if (deepWater(terrain, x, z)) continue;
          plan.push({ x, z, size: CHUNK, res: LOD_RES[Math.min(ring, LOD_RES.length - 1)] });
        }
      }
      return plan;
    },

    /** Build the meshes for a plan. Returns them with the time it took. */
    chunks(plan = this.chunkPlan()) {
      const t0 = Date.now();
      const built = plan.map((c) => buildChunk(terrain, c.x, c.z, c.size, c.res));
      built.ms = Date.now() - t0;
      return built;
    },

    /** What the renderer may read. Derived state, never authoritative. */
    scene() {
      const pal = skyPalette(clock.minutesOfDay);
      keyLightDirection(sunDir, clock.minutesOfDay);
      scene.skyColor = pal.sky;
      scene.zenith = pal.zenith;
      scene.sunColor = pal.sun;
      scene.skyLight = pal.skyLight;
      scene.groundLight = pal.groundLight;

      // The shadow cascade follows the player rather than the camera target, so
      // turning the camera never slides the shadowed region out from under the
      // character standing in the middle of it.
      shadowFocus[0] = player.pos[0];
      shadowFocus[1] = player.pos[1];
      shadowFocus[2] = player.pos[2];

      if (Math.hypot(player.pos[0] - clutterAt[0], player.pos[2] - clutterAt[1]) > 14) {
        clutterAt = [player.pos[0], player.pos[2]];
        ground = clutterCount ? clutter(terrain, clutterAt, 30, clutterCount) : [];
      }

      // The wind field's clock. Seconds, not ticks, because the shader wants a
      // continuous quantity and the simulation's tick count is not one.
      scene.time = ticksToSeconds(this.ticks);

      boxes.length = 0;
      for (const b of staticBoxes) boxes.push(b);
      for (const g of ground) boxes.push(g);
      poseHumanoid(playerParts, player);
      for (const part of playerParts) boxes.push(part);
      for (let i = 0; i < beasts.length; i++) {
        poseBeast(beastParts[i], beasts[i]);
        for (const part of beastParts[i]) boxes.push(part);
      }
      for (let i = 0; i < people.length; i++) {
        poseHumanoid(peopleParts[i], people[i]);
        for (const part of peopleParts[i]) boxes.push(part);
      }
      // Men who fight use the same rig as everybody else, which is the whole
      // point: a bandit is a person, not a creature that happens to be upright.
      for (let i = 0; i < foes.length; i++) {
        if (foes[i].state === S.DEAD) continue;
        poseHumanoid(foeParts[i], foes[i]);
        for (const part of foeParts[i]) boxes.push(part);
      }
      for (let i = 0; i < bolts.length; i++) {
        if (!boltParts[i]) boltParts[i] = {};
        boxes.push(bolts[i].arrow
          ? poseArrow(boltParts[i], bolts[i])
          : poseBolt(boltParts[i], bolts[i]));
      }
      return scene;
    },
  };

  /** Nearest person within reach, regardless of which way anyone is looking. */
  function nearestPerson(reach) {
    let best = null, bestD = reach;
    for (const p of people) {
      const d = Math.hypot(p.pos[0] - player.pos[0], p.pos[2] - player.pos[2]);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  // The conversation runner needs the world it edits, so it is built last.
  const dialogue = createDialogue(world);
  world.dialogue = dialogue;
  return world;
}

/** The same world with no renderer attached, for bots and tests. */
createWorld.headless = (opts) => createWorld(opts);

export { HEIGHT };


/**
 * Cross the pass.
 *
 * Building the other side is not a variation on this world, it is a different
 * one — different heightfield, different buildings, different things living in
 * it — so travelling builds a new world and moves the man into it. That is also
 * why this is the one place in the game with a loading screen: there is
 * genuinely a world to load, and pretending otherwise would mean streaming two
 * regions that never share a horizon.
 *
 * `travel` is pure with respect to the old world: it reads its persistent state
 * and does not modify it, so a caller that fails to swap its reference has an
 * unchanged game rather than a broken one.
 */
export function travel(world, to, opts = {}) {
  const R = regionOf(to);
  if (!REGIONS[to]) return { ok: false, why: `there is no region called ${to}` };
  if (to === world.region) return { ok: false, why: `already in ${to}` };
  const state = world.persist();
  const next = createWorld({
    ...opts,
    seed: world.seed,
    region: to,
    // The clock is carried, so `hour` must not re-set it.
    hour: undefined,
  });
  next.adopt(state);
  // Arrive where the region says arrivals land, which is deliberately not the
  // exit itself.
  const [ax, az] = R.returnAt || R.arrive;
  next.player.pos[0] = ax;
  next.player.pos[2] = az;
  next.player.pos[1] = next.terrain.heightAt(ax, az);
  next.travelLock = true;
  next.player.vel.set([0, 0, 0]);
  next.player.onGround = true;
  next.log.push(`${R.title}.`);
  return { ok: true, world: next, title: R.title };
}
