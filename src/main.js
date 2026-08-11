// Boot, capability gate, and the loop.
//
// The loop is fixed-step at 60 Hz with rendering decoupled from it, and it is
// written that way now rather than converted later because every gameplay
// system built against a variable timestep has to be re-tuned when it changes —
// combat frame counts most of all, and those are what this game is about.

import { detect, initialTier, refusalReason } from './core/caps.js';
import { createDevice } from './render/device.js';
import { createInput, idleIntent } from './core/input.js';
import { createWorld } from './world/world.js';
import { createOverlay, FrameTimer, log } from './core/log.js';

const TICK_MS = 1000 / 60;          // the simulation is 60 Hz, always
const MAX_CATCHUP_MS = 250;         // a backgrounded tab must not simulate four minutes on return

const params = new URLSearchParams(location.search);
const off = new Set((params.get('off') || '').split(',').filter(Boolean));

// Frames to render before the build gate reads the buffer, and the scale it
// renders them at. Both are small on purpose: see the note at the probe below.
const PROBE_FRAME = Number(params.get('probe')) || 3;
const renderScale = Number(params.get('renderScale')) || 0;

async function boot() {
  const canvas = document.getElementById('view');
  const gate = document.getElementById('gate');
  const caps = await detect();
  const tier = params.get('tier') || initialTier(caps);

  const why = refusalReason(caps);
  if (why) {
    document.getElementById('gate-why').textContent = why;
    gate.hidden = false;
    window.GRIMWARD = { state: 'refused', caps, why };
    return;
  }

  // Quality tiers, and the first thing they buy or spend is the shadow pass:
  // it doubles the geometry submitted per frame, which is nothing on a GPU and
  // the difference between 30 fps and 14 on a software rasteriser. `?off=shadows`
  // switches it off anywhere, which is also how you bisect a lighting bug.
  const device = await createDevice(canvas, caps, {
    shadows: !off.has('shadows') && tier !== 'low',
    shadowSize: tier === 'high' ? 2048 : 1024,
  });
  const world = createWorld({
    seed: Number(params.get('seed')) || 1,
    hour: params.has('time') ? Number(params.get('time')) : 9,
    props: params.has('props') ? Number(params.get('props')) : undefined,
  });
  device.setTerrain(world.chunks());

  const input = createInput(canvas);
  const overlay = createOverlay(document.getElementById('overlay'));
  const timer = new FrameTimer();

  log(`backend ${device.backend}, tier ${tier}, gpu ${caps.gpu || 'unknown'}`);

  const api = {
    state: 'playing', caps, tier, world, device, input,
    frames: 0,
    // What the browser-side tests read. Everything here is simulation state,
    // never input state: the loop drains input every tick, so reading it back
    // proves nothing about whether the character actually moved.
    probeState: () => ({
      pos: [...world.player.pos], vel: [...world.player.vel],
      yaw: world.player.yaw, speed: world.player.speed,
      onGround: world.player.onGround, sneaking: world.player.sneaking,
      camera: [...world.camera.pos], camDist: world.camera.dist,
      clock: world.clock.hhmm, ticks: world.ticks, frames: api.frames,
      frame: timer.percentiles(),
      ...device.stats,
    }),
  };
  window.GRIMWARD = api;

  addEventListener('keydown', (e) => { if (e.code === 'F3') overlay.toggle(); });

  const sizeFor = () => {
    const scale = renderScale || (tier === 'low' ? 0.8 : Math.min(devicePixelRatio || 1, 2));
    return [Math.round(innerWidth * scale), Math.round(innerHeight * scale)];
  };

  // The render gate (tools/shot.mjs) reads this, and it runs *before* the
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
      world.tick(TICK_MS / 1000, idleIntent());
      device.draw(world.scene());
    }
    document.title = `PROBE ${JSON.stringify({
      ...device.stats, frames: PROBE_FRAME, backend: device.backend,
      tier, clock: world.clock.hhmm, ...device.readPixelStats(),
    })}`;
  }

  let last = performance.now();
  let acc = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(now - last, MAX_CATCHUP_MS);
    last = now;
    timer.push(dt);

    // Input is sampled once per rendered frame and applied to every simulation
    // tick inside it. Sampling per tick would read the same mouse delta twice
    // whenever a frame ran long, and turn twice as far for it.
    const intent = off.has('input') ? idleIntent() : input.sample(dt / 1000);

    acc += dt;
    let ticks = 0;
    while (acc >= TICK_MS && ticks < 8) {   // a hard cap: never spiral
      world.tick(TICK_MS / 1000, intent);
      acc -= TICK_MS;
      ticks++;
    }

    const [w, h] = sizeFor();
    device.resize(w, h);
    device.draw(world.scene());

    api.frames++;
    if (api.frames % 10 === 0) {
      const p = timer.percentiles();
      const s = device.stats;
      const pl = world.player;
      overlay.render({
        frame: `${p.p50.toFixed(1)} ms  p95 ${p.p95.toFixed(1)}  p99 ${p.p99.toFixed(1)}`,
        backend: `${device.backend} · ${tier}${input.locked ? ' · locked' : ''}`,
        draws: `${s.drawCalls}  tris ${s.triangles}`,
        res: `${s.width}×${s.height}`,
        pos: `${pl.pos[0].toFixed(1)} ${pl.pos[1].toFixed(1)} ${pl.pos[2].toFixed(1)}  ${pl.speed.toFixed(1)} m/s`,
        state: `${pl.onGround ? 'ground' : 'air'}${pl.sneaking ? ' · sneaking' : ''}  cam ${world.camera.dist.toFixed(1)} m`,
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
  document.getElementById('gate-why').textContent = String((err && err.message) || err);
  document.getElementById('gate').hidden = false;
  window.GRIMWARD = { state: 'error', error: String((err && err.stack) || err) };
  console.error(err);
});
