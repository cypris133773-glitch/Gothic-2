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
import { STATE_NAME } from './game/combat.js';
import { createStorage } from './core/save.js';

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
    textures: !off.has('textures') && tier !== 'low',
  });
  const world = createWorld({
    seed: Number(params.get('seed')) || 1,
    hour: params.has('time') ? Number(params.get('time')) : 9,
    props: params.has('props') ? Number(params.get('props')) : undefined,
    lineup: params.has('lineup'),
    clutter: params.has('clutter')
      ? Number(params.get('clutter'))
      : ({ low: 0, medium: 1100, high: 2600, ultra: 4000 })[tier] ?? 1100,
    start: params.has('start') ? params.get('start').split(',').map(Number) : undefined,
    yaw: params.has('yaw') ? Number(params.get('yaw')) : undefined,
  });
  // Terrain streaming: rebuild the meshes when the player crosses into a new
  // chunk, and never otherwise. It is a single synchronous rebuild for now,
  // which is a real hitch of a few milliseconds on a boundary — the budgeted,
  // worker-decoded version is §9.7's job and is written down in
  // docs/OPEN-QUESTIONS.md rather than pretended away.
  let terrainCell = world.terrainCell();
  let terrainMs = 0;
  const rebuildTerrain = () => {
    const built = world.chunks();
    terrainMs = built.ms;
    device.setTerrain(built);
  };
  rebuildTerrain();

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
      combat: {
        state: world.player.fighter.state, t: world.player.fighter.t,
        hp: world.player.fighter.hp, swings: world.player.fighter.swings,
        hits: world.player.fighter.hits, combo: world.player.fighter.combo,
      },
      xp: world.player.xp, level: world.player.level,
      talking: world.dialogue.isOpen,
      options: world.dialogue.active ? world.dialogue.active.options.map((o) => o.id) : [],
      reply: world.dialogue.active ? world.dialogue.active.reply : null,
      gold: world.character.gold, lp: world.character.lp,
      skills: { ...world.character.skills }, guild: world.character.guild,
      flags: [...world.flags],
      trainer: world.openTrainer ? world.openTrainer.skill : null,
      beasts: world.beasts.map((b) => ({ kind: b.kind, hp: b.hp, state: b.state,
        dist: +Math.hypot(b.pos[0] - world.player.pos[0], b.pos[2] - world.player.pos[2]).toFixed(2) })),
      clock: world.clock.hhmm, ticks: world.ticks, frames: api.frames,
      frame: timer.percentiles(),
      ...device.stats,
    }),
  };
  window.GRIMWARD = api;

  // --- saving ---------------------------------------------------------------
  // F5 saves, F9 loads, and the world autosaves whenever a quest moves. A save
  // is a few kilobytes because it stores what changed rather than the world.
  const storage = createStorage(caps);
  if (storage.inMemory) log('storage unavailable — saves last only for this session');
  let lastQuestCount = 0;

  async function save(slot = 'auto') {
    try {
      const data = world.snapshot();
      await storage.put(slot, data);
      log(`saved (${slot}, ${JSON.stringify(data).length} bytes)`);
      return true;
    } catch (e) { log(`save failed: ${e.message}`); return false; }
  }

  async function load(slot = 'auto') {
    try {
      const data = await storage.get(slot);
      if (!data) { log(`no save in ${slot}`); return false; }
      world.restore(data);
      rebuildTerrain();
      log(`loaded ${slot}`);
      return true;
    } catch (e) {
      // A corrupt or foreign save is a message, never a broken game (§12.1).
      log(`could not load ${slot}: ${e.message}`);
      return false;
    }
  }
  api.save = save; api.load = load;

  // --- conversations ---------------------------------------------------------
  const talkEl = document.getElementById('talk');
  const whoEl = document.getElementById('talk-who');
  const replyEl = document.getElementById('talk-reply');
  const optionsEl = document.getElementById('talk-options');

  function renderTalk() {
    const active = world.dialogue.active;
    if (!active) { talkEl.hidden = true; return; }
    talkEl.hidden = false;
    const trainer = world.openTrainer;
    whoEl.textContent = (active.npc.kitName || active.npc.kit?.name || active.npc.id)
      + (trainer ? `  ·  teaching ${trainer.skill}` : '');
    replyEl.textContent = active.reply || '';
    optionsEl.replaceChildren(...active.options.map((o, i) => {
      const li = document.createElement('li');
      const b = document.createElement('b');
      b.textContent = `${i + 1}.`;
      li.append(b, document.createTextNode(o.text));
      return li;
    }));
  }

  addEventListener('keydown', (e) => {
    if (e.code === 'F3') { overlay.toggle(); return; }

    if (world.dialogue.isOpen) {
      if (e.code === 'Escape') { world.dialogue.close(); renderTalk(); return; }
      if (e.code === 'KeyT') { const r = world.train(); log(r.ok ? `learned: ${r.value ?? 'yes'}` : r.why); renderTalk(); return; }
      const n = Number(e.key);
      if (n >= 1 && n <= 9) { world.dialogue.say(n - 1); renderTalk(); }
      return;
    }
    // E opens a conversation with whoever is in front of you. Nothing happens
    // if there is nobody there, which is the correct amount of feedback for a
    // key pressed at an empty street.
    if (e.code === 'KeyE') { if (world.talk()) renderTalk(); }
    if (e.code === 'F5') { e.preventDefault(); save('manual'); }
    if (e.code === 'F9') { e.preventDefault(); load('manual'); }
  });

  const sizeFor = () => {
    const scale = renderScale || (tier === 'low' ? 0.8 : Math.min(devicePixelRatio || 1, 2));
    return [Math.round(innerWidth * scale), Math.round(innerHeight * scale)];
  };

  // The character sheet parks the camera in front of the row instead of behind
  // the player. It is a preview, so it is allowed to be a fixed framing; every
  // other camera in the game is the spring arm.
  const lineupCam = params.has('lineup');
  const frameLineup = () => {
    const c = world.camera;
    const ground = world.people[0].pos[1];
    c.pos[0] = 0.2; c.pos[1] = ground + 1.25; c.pos[2] = -5.0;
    c.target[0] = 0; c.target[1] = ground + 0.95; c.target[2] = 0;
    c.fov = 46;
  };

  /**
   * The sheet gets its own key light. The world's sun is where the clock says
   * it is, and at every hour that matters it is behind a row of characters
   * facing the camera — which is correct for the world and useless for looking
   * at armour. A three-quarter key from over the camera's shoulder is what a
   * character sheet is for.
   */
  const lightLineup = (sc) => {
    const d = [-0.42, 0.66, -0.62];
    const len = Math.hypot(d[0], d[1], d[2]);
    sc.sunDir[0] = d[0] / len; sc.sunDir[1] = d[1] / len; sc.sunDir[2] = d[2] / len;
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
      if (lineupCam) frameLineup();
      const sc = world.scene();
      if (lineupCam) lightLineup(sc);
      device.draw(sc);
    }
    api.probe = {
      ...device.stats, frames: PROBE_FRAME, backend: device.backend,
      tier, clock: world.clock.hhmm, ...device.readPixelStats(),
    };
    // Both channels on purpose: the title survives --dump-dom for a one-shot
    // launch, and the object is what the CDP-driven gate reads when it is
    // stepping one browser through every framing.
    document.title = `PROBE ${JSON.stringify(api.probe)}`;
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

    // Autosave when the quest log moves — a region change and a chapter change
    // will join it once those exist (§5.3).
    if (world.quests.size !== lastQuestCount) { lastQuestCount = world.quests.size; save('auto'); }

    const cell = world.terrainCell();
    if (cell !== terrainCell) { terrainCell = cell; rebuildTerrain(); }

    if (lineupCam) frameLineup();
    const [w, h] = sizeFor();
    device.resize(w, h);
    const sc = world.scene();
    if (lineupCam) lightLineup(sc);
    device.draw(sc);

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
        fight: `${STATE_NAME[pl.fighter.state]}${pl.fighter.t ? ` ${pl.fighter.t}` : ''}`
          + `  hp ${pl.fighter.hp}/${pl.fighter.maxHp}  combo ${pl.fighter.combo}`,
        hunt: `${world.beasts.filter((b) => b.state !== 7).length} alive  xp ${pl.xp}  level ${pl.level}`,
        sheet: `${world.character.gold} gold  ${world.character.lp} LP  1H ${world.character.skills.oneHanded}%`
          + `${world.character.guild ? `  ${world.character.guild}` : ''}`,
        near: world.dialogue.isOpen ? 'talking' : (world.speaker() ? 'E to talk' : ''),
        clock: `day ${world.clock.day} ${world.clock.hhmm}${world.clock.isNight ? ' (night)' : ''}`,
        terrain: `cell ${terrainCell}  rebuilt in ${terrainMs} ms`,
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
