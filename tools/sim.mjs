#!/usr/bin/env node
/**
 * Layer 2: the game, played headlessly by a bot.
 *
 *   node tools/sim.mjs [--seeds=8] [--verbose]
 *
 * The golden path: talk to the smith, take the ore job, walk the north road,
 * find the crates, walk back, get paid, and use the smith's word to get into
 * the Watch. It is the whole of the game that currently exists, played end to
 * end, and it is the only thing that can prove the world is completable —
 * §13.2 of the brief, and the reason the entire simulation was built to run
 * without a renderer.
 *
 * The bot steers; it does not teleport and it does not call world internals to
 * make anything happen beyond the two acts a player performs with a key (talk,
 * and choose a line). If it cannot get somewhere, that is a finding about the
 * world, not about the bot.
 */

import { createWorld } from '../src/world/world.js';
import { idleIntent } from '../src/core/input.js';

const argv = process.argv.slice(2);
const opt = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}`));
  if (!hit) return d;
  return hit.includes('=') ? hit.split('=')[1] : true;
};
const VERBOSE = !!opt('verbose', false);

export function goldenPath(seed, { maxSeconds = 900, verbose = false } = {}) {
  const world = createWorld({ seed, beasts: 6, props: 160 });
  const intent = idleIntent();
  const steps = [];
  const note = (s) => { steps.push(s); if (verbose) console.log(`    ${s}`); };

  let stuckFor = 0, lastPos = [world.player.pos[0], world.player.pos[2]];
  let sidestep = 0;

  /** Steer toward a point. Returns true when we are close enough. */
  function walkTo(x, z, within = 2.0) {
    const p = world.player.pos;
    const dx = x - p[0], dz = z - p[2];
    const dist = Math.hypot(dx, dz);
    if (dist < within) { intent.forward = 0; intent.turn = 0; return true; }

    let want = Math.atan2(dx, dz);
    // If the last second of walking has gone nowhere, we are against something.
    // Turn sideways for a while rather than pressing into it — the crudest
    // possible obstacle avoidance, and enough to prove a route exists without
    // pretending the navmesh (M3) is already here.
    if (sidestep > 0) { want += 1.1 * Math.sign(sidestep); sidestep -= 1; }
    let d = want - world.player.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    intent.turn = Math.max(-3.5, Math.min(3.5, d * 5));
    intent.forward = Math.abs(d) < 1.2 ? 1 : 0.35;
    return false;
  }

  function fightNearby() {
    const near = world.beasts
      .filter((b) => b.state !== 7)
      .map((b) => ({ b, d: Math.hypot(b.pos[0] - world.player.pos[0], b.pos[2] - world.player.pos[2]) }))
      .sort((p, q) => p.d - q.d)[0];
    if (!near || near.d > 6) { intent.attack = false; intent.block = false; return false; }
    const want = Math.atan2(near.b.pos[0] - world.player.pos[0], near.b.pos[2] - world.player.pos[2]);
    let d = want - world.player.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    intent.turn = Math.max(-4, Math.min(4, d * 6));
    intent.forward = near.d > 1.7 ? 1 : 0;
    // Guard while it winds up, swing while it recovers. The same lesson the
    // duel harness taught, applied by something with hands.
    intent.block = near.b.state === 1 && near.d < 2.4;
    intent.attack = !intent.block && near.d < 1.9;
    return true;
  }

  /** Say the line with this id, if it is on offer. */
  function say(id) {
    const active = world.dialogue.active;
    if (!active) return false;
    const i = active.options.findIndex((o) => o.id === id);
    if (i < 0) return false;
    world.dialogue.say(i);
    note(`said ${id}`);
    return true;
  }

  const npc = (id) => world.people.find((p) => p.id === id);
  const smith = npc('npc3'), guard = npc('npc0');
  const CRATES = [6, -46];

  // The plan, as a list of things to be true, each with what to do until it is.
  const plan = [
    { goal: 'reach the smith', done: () => world.flags.has('met:harl'),
      act: () => { if (walkTo(smith.pos[0], smith.pos[2], 1.6)) { world.talk(); say('harl.greet'); } } },
    { goal: 'take the ore job', done: () => world.quests.get('q_ore') === 'told',
      act: () => { if (!world.dialogue.isOpen) world.talk(); say('harl.ore'); } },
    { goal: 'be offered training', done: () => world.flags.has('harl:offered'),
      act: () => { if (!world.dialogue.isOpen) world.talk(); say('harl.train_ask'); } },
    { goal: 'buy the lesson', done: () => world.character.skills.oneHanded > 10,
      act: () => {
        if (!world.dialogue.isOpen) world.talk();
        if (say('harl.train') || world.openTrainer) { world.train(); world.dialogue.close(); }
      } },
    { goal: 'find the crates', done: () => world.quests.get('q_ore') === 'found',
      act: () => { world.dialogue.close(); if (!fightNearby()) walkTo(CRATES[0], CRATES[1], 2.5); } },
    { goal: 'report back', done: () => world.quests.get('q_ore') === 'done',
      act: () => {
        if (fightNearby()) return;
        if (walkTo(smith.pos[0], smith.pos[2], 1.6)) { if (!world.dialogue.isOpen) world.talk(); say('harl.ore_solved'); }
      } },
    { goal: 'meet the Watch', done: () => world.flags.has('watch:asked'),
      act: () => {
        world.dialogue.close();
        if (walkTo(guard.pos[0], guard.pos[2], 1.6)) { if (!world.dialogue.isOpen) world.talk(); say('watch.greet') || say('watch.join_ask'); }
      } },
    { goal: 'join the Watch', done: () => world.character.guild === 'watch',
      act: () => { if (!world.dialogue.isOpen) world.talk(); say('watch.join'); } },
  ];

  let step = 0;
  for (let t = 0; t < 60 * maxSeconds; t++) {
    while (step < plan.length && plan[step].done()) {
      note(`✓ ${plan[step].goal} (${(t / 60).toFixed(0)} s)`);
      step++;
    }
    if (step >= plan.length) {
      return { ok: true, seconds: t / 60, steps, world };
    }

    intent.forward = 0; intent.turn = 0; intent.attack = false; intent.block = false;
    plan[step].act();
    world.tick(1 / 60, intent);

    if (world.player.fighter.hp <= 0) {
      return { ok: false, why: `died on "${plan[step].goal}"`, seconds: t / 60, steps, world };
    }

    // Stuck detection, so a bot that cannot reach a door says so instead of
    // walking into a wall for fifteen minutes.
    if (t % 60 === 0) {
      const moved = Math.hypot(world.player.pos[0] - lastPos[0], world.player.pos[2] - lastPos[1]);
      lastPos = [world.player.pos[0], world.player.pos[2]];
      if (moved < 0.6 && !world.dialogue.isOpen) {
        stuckFor++;
        sidestep = stuckFor % 2 === 0 ? 90 : -90;
        if (stuckFor > 25) {
          return { ok: false, why: `stuck on "${plan[step].goal}"`, seconds: t / 60, steps, world };
        }
      } else stuckFor = 0;
    }
  }
  return { ok: false, why: `ran out of time on "${plan[step].goal}"`, seconds: maxSeconds, steps, world };
}

// --- run ----------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const seeds = Number(opt('seeds', 6));
  let failures = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const r = goldenPath(seed, { verbose: VERBOSE });
    const c = r.world.character;
    console.log(
      `  seed ${String(seed).padEnd(3)} ${r.ok ? '✓' : '✗'} ${String(Math.round(r.seconds)).padStart(4)} s`
      + `  level ${c.level}  ${c.gold} gold  1H ${c.skills.oneHanded}%  ${c.guild || 'no guild'}`
      + `${r.ok ? '' : `  — ${r.why}`}`
    );
    if (!r.ok) failures++;
  }
  console.log(failures
    ? `\n${seeds - failures}/${seeds} playthroughs completed the golden path\n`
    : `\nall ${seeds} playthroughs completed the golden path\n`);
  process.exit(failures ? 1 : 0);
}
