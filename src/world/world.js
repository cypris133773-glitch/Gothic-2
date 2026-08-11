// The world: terrain, props, the player, the camera and the clock, advanced by
// a fixed tick and readable as a scene.
//
// Nothing in this file touches the DOM, a canvas, an audio context or a browser
// API of any kind. That is the constraint the whole test strategy rests on
// (§8.1.2): `World.headless()` runs in Node, a bot drives it with the same
// intent object a keyboard produces, and it is the only way anyone will ever
// prove that a world this size can be walked across and finished.

import { createTerrain, buildChunk, scatter } from './terrain.js';
import { createPlayer, stepPlayer, HEIGHT } from '../game/player.js';
import { createCamera, stepCamera } from '../game/camera.js';
import { Clock, keyLightDirection, skyPalette } from '../core/time.js';
import { idleIntent } from '../core/input.js';

export const CHUNK = 64;         // metres per terrain chunk
export const CHUNK_RES = 48;     // vertices per side; ~1.3 m between samples

export function createWorld(opts = {}) {
  const seed = opts.seed || 1;
  const terrain = createTerrain(seed);
  const clock = new Clock((opts.hour ?? 9) * 60);

  // The player starts on the settlement pad, which the terrain generator
  // flattens, so a fresh game never begins halfway up a cliff.
  const player = createPlayer(0, 0, terrain);
  const camera = createCamera();
  const props = scatter(terrain, opts.props ?? 220, [-110, -110, 110, 110]);

  // Scene buffers, reused every frame. The scene is rebuilt each tick rather
  // than mutated in place because it is a *view* of the simulation, and a view
  // that can be edited is a bug waiting to be written.
  const boxes = props.slice();
  const bodyBox = { pos: [0, 0, 0], yaw: 0, pitch: 0, scale: [0.62, 1.15, 0.42], albedo: [0.35, 0.28, 0.22], spin: 0 };
  const headBox = { pos: [0, 0, 0], yaw: 0, pitch: 0, scale: [0.30, 0.32, 0.30], albedo: [0.62, 0.50, 0.40], spin: 0 };
  boxes.push(bodyBox, headBox);

  const sunDir = new Float32Array(3);
  const scene = {
    camera, boxes,
    skyColor: [0, 0, 0], sunColor: [0, 0, 0], sunDir,
    skyLight: [0, 0, 0], groundLight: [0, 0, 0],
  };

  const world = {
    seed, terrain, clock, player, camera, props, ticks: 0,

    /** One simulation step. `intent` is what the player (or a bot) asked for. */
    tick(dt, intent = idleIntent()) {
      this.ticks++;
      clock.tick(dt);
      stepPlayer(player, intent, terrain, props, dt);
      stepCamera(camera, player, terrain, props, dt);
      return this;
    },

    /** Terrain meshes for the renderer. Nine chunks; LOD and streaming at M4. */
    chunks() {
      const built = [];
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          built.push(buildChunk(terrain, i * CHUNK - CHUNK / 2, j * CHUNK - CHUNK / 2, CHUNK, CHUNK_RES));
        }
      }
      return built;
    },

    /** What the renderer may read. Derived state, never authoritative. */
    scene() {
      const pal = skyPalette(clock.minutesOfDay);
      keyLightDirection(sunDir, clock.minutesOfDay);
      scene.skyColor = pal.sky;
      scene.sunColor = pal.sun;
      scene.skyLight = pal.skyLight;
      scene.groundLight = pal.groundLight;

      // The character is two boxes until M5 brings a skinned mesh. It leans
      // into its own motion, which costs one line and is the difference between
      // a body walking and a crate sliding.
      const lean = Math.min(player.speed / 8, 0.14);
      bodyBox.pos[0] = player.pos[0];
      bodyBox.pos[1] = player.pos[1] + HEIGHT * 0.42;
      bodyBox.pos[2] = player.pos[2];
      bodyBox.yaw = player.yaw;
      bodyBox.pitch = -lean;
      headBox.pos[0] = player.pos[0];
      headBox.pos[1] = player.pos[1] + HEIGHT * 0.86;
      headBox.pos[2] = player.pos[2];
      headBox.yaw = player.yaw;
      return scene;
    },
  };
  return world;
}

/** The same world with no renderer attached, for bots and tests. */
createWorld.headless = (opts) => createWorld(opts);
