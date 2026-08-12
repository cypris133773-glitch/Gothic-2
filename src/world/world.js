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
} from './buildings.js';
import { createPlayer, stepPlayer, resolveObstacles, HEIGHT } from '../game/player.js';
import { createCamera, stepCamera } from '../game/camera.js';
import { poseHumanoid, advanceGait, KITS, kitForArmour } from '../game/rig.js';
import { Clock, keyLightDirection, skyPalette } from '../core/time.js';
import { idleIntent } from '../core/input.js';
import { makeRng } from '../core/rng.js';
import { createFighter, stepFighter, resolveStrike, isStriking, S } from '../game/combat.js';
import { createBeast, stepBeast, poseBeast, BEASTS } from '../game/beast.js';
import { meleeDamage, levelForXp } from '../game/progression.js';
import { createCharacter, awardXp, learn, raiseAttribute, joinGuild } from '../game/character.js';
import { createDialogue } from '../game/dialogue.js';
import { DIALOGUE, SPEAKERS } from '../data/dialogue.js';
import { snapshot, restore } from '../core/save.js';
import {
  createInventory, add, remove, has, count, equip, unequip, drink, applyLoadout,
  createTrader, buy, sell, listing,
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
    const [x, z] = PLACES[key].at;
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

  const spec = [
    // npc0 — the guard on the upper gate. He paces across the opening and
    // turns strangers away; getting past him is the first act of the game.
    { kit: 'guard', at: [upperGate[0] - 3.5, upperGate[1] + 1.5], look: [0, 6],
      route: [[upperGate[0] - 3.5, upperGate[1] + 1.5], [upperGate[0] + 3.5, upperGate[1] + 1.5]], speed: 1.1 },
    // npc1 — Bosk, who does not live in the city. He waits at the fork outside
    // the land gate, where the wood begins.
    { kit: 'villager', at: [GATE_APRON[0] + 4.5, GATE_APRON[1] + 2.0], look: landGate, route: null },
    { kit: 'villager', at: [CITY.square[0] - 3.2, CITY.square[1] - 2.4], look: CITY.square, route: null },
    // npc3 — Harl, at his anvil in front of the smithy.
    { kit: 'smith', at: [-6.0, 6.5], look: [-8, 1], route: null },
    { kit: 'villager', at: [CITY.square[0] + 2.6, CITY.square[1] + 3.0], look: CITY.square,
      route: [[3, 17], [-9, -4]], speed: 1.3 },
    // The land gate, walked by two.
    { kit: 'guard', at: [landGate[0] - 4.0, landGate[1] - 3.0], look: [0, 40],
      route: [[landGate[0] - 4.0, landGate[1] - 3.0], [landGate[0] + 4.0, landGate[1] - 3.0]], speed: 1.5 },
    // The harbour: a porter between the two warehouses.
    { kit: 'villager', at: [-17.5, -2.0], look: [-26, 0], route: [[-17.5, -6.0], [-17.5, 3.0]], speed: 1.2 },
    // The barracks yard.
    { kit: 'guard', at: [10.0, -8.0], look: [18, -7], route: null },
    // npc8 — Yorne, outside his tavern in the harbour quarter. He is the first
    // of the four ways past the upper gate and he is deliberately the one you
    // find by wandering rather than by being sent.
    { kit: 'villager', at: [-7.0, -14.5], look: [-12, -16], route: null },
    // npc9 — Captain Aldric, in the barracks. The Watch's door.
    { kit: 'knight', at: [11.5, -4.0], look: [18, -7], route: null },
    // npc10 — Vessa, the alchemist, inside the upper quarter. You cannot reach
    // her without solving the gate, which is the point of putting her there.
    { kit: 'villager', at: [-8.0, -21.0], look: [0, -22], route: null },
    // npc11 — Brother Kelm, on the monastery shelf. The Chapter's door.
    { kit: 'villager', at: [-18, -104], look: [-18, -118], route: null },
    // npc12 — Sarn, at Hulder's farm. The Freeblades' door, out past the road.
    { kit: 'guard', at: [58, -78], look: [64, -84], route: null },
    // npc13 — Ossric, at the foot of his tower. The plot.
    { kit: 'villager', at: [122, -98], look: [122, -104], route: null },
  ];

  return spec.map((s, i) => {
    const [x, z] = s.at;
    return {
      id: `npc${i}`,
      pos: new Float32Array([x, terrain.heightAt(x, z), z]),
      // Idle people face whatever they have business with, plus a little jitter
      // so a street of them does not look like a firing squad.
      yaw: facing(x, z, s.look) + rng.range(-0.3, 0.3),
      speed: 0, phase: rng.range(0, Math.PI * 2),
      kit: KITS[s.kit], route: s.route, leg: 0, routeSpeed: s.speed || 1.4,
      pause: 0,
    };
  });
}

function stepPerson(p, terrain, dt) {
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

export function createWorld(opts = {}) {
  const seed = opts.seed || 1;
  const terrain = createTerrain(seed);
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
  const start = opts.start || (opts.lineup ? [0, -30] : [0, 26]);
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

  // Props reach as far as the furthest landmark now: the island is 340 m across
  // the built area, not the 110 m ring the first town sat in.
  const props = scatter(terrain, opts.lineup ? 0 : (opts.props ?? 520), [-190, -160, 200, 150]);
  const town = (opts.town === false || opts.lineup)
    ? []
    : [...buildCity(terrain, seed), ...buildOutlands(terrain, seed)];
  const people = opts.lineup ? makeLineup(terrain, opts.lineup)
    : opts.people === false ? [] : makePeople(terrain, seed);

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
    const wanted = opts.beasts ?? 34;
    // `beastsAround` puts the pack somewhere specific, which is how the hunt
    // harness gets a wood to fight in without teleporting anything.
    const [hx, hz] = opts.beastsAround || [0, 0];
    const near = !!opts.beastsAround;
    for (let i = 0; i < wanted * 40 && beasts.length < wanted; i++) {
      const a = brng.range(0, Math.PI * 2);
      const r = near ? brng.range(8, 46) : brng.range(52, 172);
      const x = hx + Math.cos(a) * r, z = hz + Math.sin(a) * r;
      if (terrain.heightAt(x, z) < 1.2 || terrain.slopeAt(x, z) > 0.5) continue;
      if (terrain.padFactor(x, z) > 0.22) continue;     // not on the road or in a yard
      // Distance from the gate is the difficulty curve, so the further out a
      // spawn lands the likelier it is to be the thing with tusks.
      const far = Math.min(1, (Math.hypot(x, z) - 52) / 100);
      beasts.push(createBeast(brng.chance(0.78 - far * 0.4) ? 'wolf' : 'boar', x, z, terrain, brng));
    }
  }
  const beastParts = beasts.map(() => []);

  // The stolen ore, off the farm road past the first bend. It is a thing in the
  // world rather than a dialogue flag: the quest is told in the city and
  // *found* by walking out of the land gate and down the road.
  const crates = [];
  const CRATES_AT = [-30, 62];
  if (!opts.lineup) {
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
  if (!opts.lineup && opts.town !== false) {
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
  const doorBoxes = () => doors.filter((d) => !d.open).flatMap((d) => d.boxes);

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
    seed, terrain, clock, player, camera, props, town, people, beasts, obstacles, ticks: 0,
    character, flags, quests, inventory, chapter: 1, openTrainer: null, openTrader: null, log: [],
    crates, gates, places: PLACES, city: CITY,

    /** Experience goes to the sheet, which hands out levels and learning points. */
    awardXp(amount, reason = 'quest') {
      const gained = awardXp(character, amount, reason);
      player.xp = character.xp; player.level = character.level;
      if (gained) world.log.push(`You are level ${character.level}. ${gained * 10} learning points.`);
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
      if (!opts2.silent) world.log.push(`Chapter ${n}: ${c.title}. ${c.blurb}`);
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
      }
      return r;
    },

    /** The nearest person close enough and in front of you to talk to. */
    speaker() {
      let best = null, bestD = 3.2;
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
      stepPlayer(player, intent, terrain, obstacles, dt);
      advanceGait(player, dt);

      // The blade is a separate machine from the legs, and it is the one with
      // the frame counts. Movement is locked while a swing is out, which is the
      // whole meaning of commitment.
      const f = player.fighter;
      f.facing = player.yaw;
      const swinging = f.state === S.WINDUP || f.state === S.ACTIVE || f.state === S.STAGGER;
      if (swinging) { player.vel[0] *= 0.25; player.vel[2] *= 0.25; }
      stepFighter(f, intent, rng);

      for (const b of beasts) {
        stepBeast(b, player, terrain, dt, rng);
        if (isStriking(b)) resolveStrike(b, f, rng, meleeDamage);
      }
      if (isStriking(f)) {
        for (const b of beasts) {
          const hit = resolveStrike(f, b, rng, meleeDamage);
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

      // Knockback moved bodies after the ground was resolved, so everything
      // that got shoved has to be put back on the world: the character-never-
      // falls-through test caught the player standing four centimetres inside a
      // hillside for a tick after a wolf hit him.
      resolveObstacles(player, obstacles);
      const ground = terrain.heightAt(player.pos[0], player.pos[2]);
      if (player.pos[1] < ground) { player.pos[1] = ground; player.onGround = true; }
      for (const b of beasts) b.pos[1] = terrain.heightAt(b.pos[0], b.pos[2]);

      for (const p of people) stepPerson(p, terrain, dt);
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
      return scene;
    },
  };

  // The conversation runner needs the world it edits, so it is built last.
  const dialogue = createDialogue(world);
  world.dialogue = dialogue;
  return world;
}

/** The same world with no renderer attached, for bots and tests. */
createWorld.headless = (opts) => createWorld(opts);

export { HEIGHT };
