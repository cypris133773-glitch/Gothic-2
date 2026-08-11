// Boot, capability gate, and the loop.
//
// The loop is fixed-step with interpolated rendering, and it is written this
// way at M0 rather than converted later because every gameplay system built
// against a variable timestep has to be re-tuned when it changes — combat frame
// counts most of all, and those are the thing this game is actually about.

import { detect, initialTier, refusalReason } from './core/caps.js';
import { createDevice } from './render/device.js';
import { Clock, keyLightDirection, skyPalette } from './core/time.js';
import { makeRng } from './core/rng.js';
import { createOverlay, FrameTimer, log } from './core/log.js';
import { vec3 } from './core/math.js';

const TICK_MS = 1000 / 60;          // the simulation is 60 Hz, always
const MAX_CATCHUP_MS = 250;         // a backgrounded tab must not simulate four minutes on return
const params = new URLSearchParams(location.search);
const off = new Set((params.get('off') || '').split(',').filter(Boolean));

// Frames to render before the build gate reads the buffer. It is deliberately
// small: headless Chromium under --virtual-time-budget dumps the DOM after only
// a handful of animation frames, so a probe that waits for frame forty never
// fires and the gate reports "the page never reported a probe" — which is a
// true statement about a game that is rendering perfectly well.
const PROBE_FRAME = Number(params.get('probe')) || 3;
const renderScale = Number(params.get('renderScale')) || 0;

/**
 * The world. At M0 it is a handful of boxes and a clock, but it is already the
 * shape the real one has: pure state, advanced by tick(), with no reference to
 * the renderer, the DOM or the audio context — which is what will let the whole
 * simulation run headlessly in Node for the bot tests (§8.1.2, §13.2).
 */
function createWorld(seed) {
  const rng = makeRng(seed);
  const clock = new Clock(params.has('time') ? Number(params.get('time')) * 60 : 9 * 60);
  const boxes = [
    // A ground slab. Its top face sits at exactly y = 0, so "on the ground"
    // means y = half the object's height and nothing floats — the first version
    // of this scene made the ground a 14-unit cube, which put the camera inside
    // it and photographed three boxes hanging in a black void.
    { pos: [0, -0.5, 0], yaw: 0, pitch: 0, scale: [24, 1, 24], albedo: [0.21, 0.20, 0.16], spin: 0 },
    { pos: [0, 0.55, 0], yaw: 0.6, pitch: 0, scale: 1.1, albedo: [0.52, 0.34, 0.18], spin: 0.5 },
  ];
  // Standing stones, placed from the seeded stream — the same mechanism the
  // real scatter pass will use. Three boxes today, ninety thousand instances at
  // M4, identical determinism.
  for (let i = 0; i < 3; i++) {
    const h = rng.range(1.4, 2.6);
    boxes.push({
      pos: [rng.range(-5, 5), h / 2, rng.range(-4.5, -1.5)],
      yaw: rng.range(-0.6, 0.6), pitch: 0,
      scale: [rng.range(0.35, 0.7), h, rng.range(0.35, 0.7)],
      albedo: [0.33, 0.32, 0.30], spin: 0,
    });
  }

  const sunDir = vec3();
  return {
    seed, clock, boxes, ticks: 0,
    tick(dt) {
      this.ticks++;
      if (!off.has('time')) this.clock.tick(dt);
      for (const b of this.boxes) if (b.spin) b.yaw += b.spin * dt;
    },
    /** What the renderer is allowed to read. Derived, never authoritative. */
    scene() {
      const pal = skyPalette(this.clock.minutesOfDay);
      keyLightDirection(sunDir, this.clock.minutesOfDay);
      return {
        boxes: this.boxes,
        skyColor: pal.sky,
        sunColor: pal.sun,
        sunDir,
        skyLight: pal.skyLight,
        groundLight: pal.groundLight,
      };
    },
  };
}

async function boot() {
  const canvas = document.getElementById('view');
  const gate = document.getElementById('gate');
  const caps = await detect();
  const tier = initialTier(caps);

  const why = refusalReason(caps);
  if (why) {
    document.getElementById('gate-why').textContent = why;
    gate.hidden = false;
    window.GRIMWARD = { state: 'refused', caps, why };
    return;
  }

  const device = await createDevice(canvas, caps);
  const world = createWorld(Number(params.get('seed')) || 1);
  const overlay = createOverlay(document.getElementById('overlay'));
  const timer = new FrameTimer();

  log(`backend ${device.backend}, tier ${tier}, gpu ${caps.gpu || 'unknown'}`);

  const api = {
    state: 'playing', caps, tier, world, device,
    frames: 0,
    stats: () => ({ ...device.stats, ticks: world.ticks, clock: world.clock.hhmm }),
  };
  window.GRIMWARD = api;

  addEventListener('keydown', (e) => { if (e.code === 'F3') overlay.toggle(); });

  // The build gate (tools/shot.mjs) reads this, and it runs *before* the
  // animation loop rather than inside it, on purpose. Headless Chromium dumps
  // the page when its virtual-time budget expires, and requestAnimationFrame is
  // throttled until the compositor has produced a surface — so a probe that
  // waits for an animation frame reports "nothing rendered" on a slow machine
  // while the game is perfectly healthy. Drawing and reading back synchronously
  // needs no compositor at all, so the gate stops being a coin flip.
  if (params.has('probe')) {
    const scale = renderScale || 0.5;
    device.resize(Math.round(innerWidth * scale), Math.round(innerHeight * scale));
    for (let i = 0; i < PROBE_FRAME; i++) {
      world.tick(TICK_MS / 1000);
      device.draw(world.scene());
    }
    api.probe = {
      ...device.stats, frames: PROBE_FRAME, backend: device.backend,
      tier, clock: world.clock.hhmm, ...device.readPixelStats(),
    };
    document.title = `PROBE ${JSON.stringify(api.probe)}`;
  }

  let last = performance.now();
  let acc = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(now - last, MAX_CATCHUP_MS);
    last = now;
    timer.push(dt);

    acc += dt;
    while (acc >= TICK_MS) {
      world.tick(TICK_MS / 1000);
      acc -= TICK_MS;
    }

    // Devicepixel-aware sizing every frame: cheap, and it is the difference
    // between a crisp game and a blurry one on a high-DPI display.
    // `?renderScale=` overrides it, which is how the build gate keeps the
    // software rasteriser in CI down to a workload it can finish inside one
    // animation frame while still photographing a full-size window.
    const scale = renderScale || (tier === 'low' ? 0.8 : Math.min(devicePixelRatio || 1, 2));
    device.resize(Math.round(innerWidth * scale), Math.round(innerHeight * scale));
    device.draw(world.scene());

    api.frames++;

    if (api.frames % 10 === 0) {
      const p = timer.percentiles();
      const s = device.stats;
      overlay.render({
        frame: `${p.p50.toFixed(1)} ms  p95 ${p.p95.toFixed(1)}  p99 ${p.p99.toFixed(1)}`,
        backend: `${device.backend} · ${tier}`,
        draws: `${s.drawCalls}  tris ${s.triangles}`,
        res: `${s.width}×${s.height}`,
        clock: `day ${world.clock.day} ${world.clock.hhmm}${world.clock.isNight ? ' (night)' : ''}`,
        seed: String(world.seed),
      });
    }
  }
  requestAnimationFrame(frame);
}

boot().catch((err) => {
  // A boot failure must be legible on screen, not only in a console nobody has
  // open. This is the path that catches a shader that failed to compile.
  const gate = document.getElementById('gate');
  document.getElementById('gate-why').textContent = String(err && err.message || err);
  gate.hidden = false;
  window.GRIMWARD = { state: 'error', error: String(err && err.stack || err) };
  console.error(err);
});
