// The world: terrain, a town, its people, the player, the camera and the clock,
// advanced by a fixed tick and readable as a scene.
//
// Nothing in this file touches the DOM, a canvas, an audio context or a browser
// API of any kind. That is the constraint the whole test strategy rests on
// (§8.1.2): the same code runs in Node, a bot drives it with the same intent
// object a keyboard produces, and it is the only way anyone will ever prove
// that a world this size can be walked across and finished.

import { createTerrain, buildChunk, scatter } from './terrain.js';
import { buildHouse, buildWell, buildStall } from './buildings.js';
import { createPlayer, stepPlayer, HEIGHT } from '../game/player.js';
import { createCamera, stepCamera } from '../game/camera.js';
import { poseHumanoid, advanceGait, KITS } from '../game/rig.js';
import { Clock, keyLightDirection, skyPalette } from '../core/time.js';
import { idleIntent } from '../core/input.js';
import { makeRng } from '../core/rng.js';

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

/** The town: houses around a square, a well in the middle, two market stalls. */
function buildTown(terrain, seed) {
  const rng = makeRng(seed * 7919 + 13);
  const boxes = [];
  const HOUSES = 9;
  for (let i = 0; i < HOUSES; i++) {
    // A ring, but not a regular one — a village that was laid out with a
    // protractor reads as a level, not as a place people built one at a time.
    const a = (i / HOUSES) * Math.PI * 2 + rng.range(-0.16, 0.16);
    const r = rng.range(15.5, 19.5);
    const x = Math.cos(a) * r, z = Math.sin(a) * r * 0.82;
    boxes.push(...buildHouse({
      x, z, ground: terrain.heightAt(x, z),
      // Every house faces the square, which is what makes a square a square.
      yaw: Math.atan2(x, z) + Math.PI,
      seed: i + seed,
    }));
  }
  boxes.push(...buildWell(1.5, -1.0, terrain.heightAt(1.5, -1.0)));
  boxes.push(...buildStall(-7.5, 4.5, terrain.heightAt(-7.5, 4.5), 0.9, seed));
  boxes.push(...buildStall(7.0, 5.5, terrain.heightAt(7.0, 5.5), -1.1, seed + 1));
  return boxes;
}

/**
 * A character sheet: every kit, side by side, on flat ground, facing the camera.
 *
 * It is a mode of the real world rather than a separate viewer — the same rig,
 * the same materials, the same lighting — so it cannot drift out of step with
 * what the game actually draws, which is the entire point of having one.
 */
function makeLineup(terrain) {
  const kits = ['knight', 'guard', 'smith', 'villager'];
  return kits.map((name, i) => {
    const x = (i - (kits.length - 1) / 2) * 1.9;
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

/** The townspeople. Routes are placeholders until the M8 routine system. */
function makePeople(terrain, seed) {
  const rng = makeRng(seed * 104729 + 7);
  const spec = [
    { kit: 'guard', at: [4.5, 6.0], route: [[4.5, 6.0], [4.5, -8.0]], speed: 1.6 },
    { kit: 'villager', at: [-3.0, 3.5], route: null },
    { kit: 'villager', at: [-2.2, 4.4], route: null },
    { kit: 'smith', at: [8.5, -2.0], route: null },
    { kit: 'villager', at: [-8.0, -4.0], route: [[-8.0, -4.0], [6.0, -5.5]], speed: 1.3 },
    { kit: 'guard', at: [-6.5, 8.5], route: [[-6.5, 8.5], [8.5, 8.0]], speed: 1.5 },
  ];
  return spec.map((s, i) => {
    const [x, z] = s.at;
    return {
      id: `npc${i}`,
      pos: new Float32Array([x, terrain.heightAt(x, z), z]),
      // Idle people face the square; the well is what they are standing around.
      yaw: Math.atan2(1.5 - x, -1.0 - z) + rng.range(-0.4, 0.4),
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

  // The player starts on the square, which the terrain generator flattens, so a
  // fresh game never begins halfway up a cliff.
  // `start` puts the player anywhere, which is how the gate photographs a
  // vista from a ridge and how a bug report says "stand here".
  const start = opts.start || (opts.lineup ? [0, -30] : [0, 8]);
  const player = createPlayer(start[0], start[1], terrain);
  player.yaw = opts.yaw ?? Math.PI;           // by default, looking at the town
  player.kit = KITS.knight;
  player.phase = 0;
  const camera = createCamera();

  const props = scatter(terrain, opts.lineup ? 0 : (opts.props ?? 260), [-110, -110, 110, 110]);
  const town = (opts.town === false || opts.lineup) ? [] : buildTown(terrain, seed);
  const people = opts.lineup ? makeLineup(terrain)
    : opts.people === false ? [] : makePeople(terrain, seed);

  // Everything the character controller can bump into.
  const obstacles = [...props, ...town].filter((b) => b.radius);

  // Scene buffers, reused every frame: the scene is a *view* of the simulation
  // and rebuilding it must not allocate (§8.1.4). The static half never changes;
  // the character half is refilled in place by the rig.
  const staticBoxes = [...props, ...town].filter((b) => !b.invisible);
  const boxes = [];
  const playerParts = [];
  const peopleParts = people.map(() => []);

  const sunDir = new Float32Array(3);
  const shadowFocus = new Float32Array(3);
  const scene = {
    camera, boxes, sunDir, shadowFocus,
    skyColor: [0, 0, 0], zenith: [0, 0, 0], sunColor: [0, 0, 0],
    skyLight: [0, 0, 0], groundLight: [0, 0, 0],
  };

  return {
    seed, terrain, clock, player, camera, props, town, people, obstacles, ticks: 0,

    /** One simulation step. `intent` is what the player (or a bot) asked for. */
    tick(dt, intent = idleIntent()) {
      this.ticks++;
      clock.tick(dt);
      stepPlayer(player, intent, terrain, obstacles, dt);
      advanceGait(player, dt);
      for (const p of people) stepPerson(p, terrain, dt);
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

      boxes.length = 0;
      for (const b of staticBoxes) boxes.push(b);
      poseHumanoid(playerParts, player);
      for (const part of playerParts) boxes.push(part);
      for (let i = 0; i < people.length; i++) {
        poseHumanoid(peopleParts[i], people[i]);
        for (const part of peopleParts[i]) boxes.push(part);
      }
      return scene;
    },
  };
}

/** The same world with no renderer attached, for bots and tests. */
createWorld.headless = (opts) => createWorld(opts);

export { HEIGHT };
