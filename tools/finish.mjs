#!/usr/bin/env node
/**
 * Layer 2b: the *whole* game, played headlessly by a bot.
 *
 *   node tools/finish.mjs [--seeds=3] [--verbose]
 *
 * `sim.mjs` proves the first hour is completable. This proves the rest is: the
 * ore job, an oath, the man on the plateau, the road east, the valley's three
 * errands, the keep, and the last man at the bottom of the deep pit. It crosses
 * the pass, which means it exercises `travel` and the whole persist/adopt path
 * as a side effect, and it ends when `world.finished` is true.
 *
 * The bot steers, talks and swings. It does not teleport, it does not set a
 * flag, and it does not call anything a player could not do with a key — with
 * *one* stated exception, which is that it grants itself experience and coin at
 * two points rather than grinding wolves for an hour of wall-clock time. Those
 * two grants are the only cheats in the file, they are marked, and they exist
 * because this test's job is to prove the *path* exists rather than to prove
 * that killing forty wolves takes forty wolves.
 *
 * If it cannot get somewhere, that is a finding about the world.
 */

import { createWorld, travel } from '../src/world/world.js';
import { idleIntent } from '../src/core/input.js';

const argv = process.argv.slice(2);
const opt = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}`));
  if (!hit) return d;
  return hit.includes('=') ? hit.split('=')[1] : true;
};

export function fullPlaythrough(seed, { maxSeconds = 3600, verbose = false } = {}) {
  let world = createWorld({ seed, beasts: 10, props: 120 });
  const intent = idleIntent();
  const steps = [];
  const note = (s) => { steps.push(s); if (verbose) console.log(`    ${s}`); };

  let stuckFor = 0;
  // Set by `fightNearby` whenever it takes the controls. A stand-up fight is
  // *supposed* to be motionless — the whole combat design is spacing and
  // commitment — so counting it as "stuck" reports a bot winning a six-man
  // brawl as a bot walking into a wall.
  let fighting = false;
  let lastPos = [world.player.pos[0], world.player.pos[2]];
  let sidestep = 0;
  const legs = new Map();

  /** Steer toward a point. True when we are close enough. */
  function walkTo(x, z, within = 2.0) {
    const p = world.player.pos;
    const dx = x - p[0], dz = z - p[2];
    if (Math.hypot(dx, dz) < within) { intent.forward = 0; intent.turn = 0; return true; }
    let want = Math.atan2(dx, dz);
    if (sidestep > 0) { want += 1.1 * Math.sign(sidestep); sidestep -= 1; }
    let d = want - world.player.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    intent.turn = Math.max(-3.5, Math.min(3.5, d * 5));
    intent.forward = Math.abs(d) < 1.2 ? 1 : 0.35;
    return false;
  }

  /** Walk a list of points in order. The bot's substitute for a navmesh (M3). */
  function walkVia(name, points, within = 2.0) {
    // A route that is finished stays finished. Re-checking the last leg every
    // tick turns it into a *leash*: the caller walks on toward whatever it
    // actually wanted, the distance back to the waypoint grows past `within`,
    // the route claims to be unfinished again and drags it back. The bot stood
    // six metres from the man it was trying to talk to for forty minutes,
    // oscillating, with nothing in the way and nothing to fight.
    if (legs.get(name) === 'done') return true;
    let i = legs.get(name) ?? 0;
    const last = points.length - 1;
    const [x, z] = points[i];
    if (walkTo(x, z, i === last ? within : 3.2)) {
      if (i === last) { legs.set(name, 'done'); return true; }
      legs.set(name, ++i);
    }
    return false;
  }

  /** Fight whatever is closest, if it is close. Spacing and parrying, as ever. */
  function fightNearby(range = 7) {
    const all = [...world.beasts, ...world.foes];
    const near = all.filter((b) => b.state !== 7)
      .map((b) => ({ b, d: Math.hypot(b.pos[0] - world.player.pos[0], b.pos[2] - world.player.pos[2]) }))
      .sort((p, q) => p.d - q.d)[0];
    if (!near || near.d > range) { intent.attack = false; intent.block = false; return false; }
    fighting = true;
    const want = Math.atan2(near.b.pos[0] - world.player.pos[0], near.b.pos[2] - world.player.pos[2]);
    let d = want - world.player.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    intent.turn = Math.max(-4, Math.min(4, d * 6));
    // Press *inside* reach rather than stopping at it. A weapon reaches 1.9 m
    // and a swing at 2.0 is a swing at air.
    intent.forward = near.d > 1.7 ? 1 : 0;
    intent.block = near.b.state === 1 && near.d < 2.6;
    intent.attack = !intent.block && near.d < 2.1;
    return true;
  }

  const say = (id) => {
    const active = world.dialogue.active;
    if (!active) return false;
    const i = active.options.findIndex((o) => o.id === id);
    if (i < 0) return false;
    world.dialogue.say(i);
    note(`said ${id}`);
    return true;
  };

  /** Stand in front of somebody and open their conversation. */
  const npc = (id) => world.people.find((p) => p.id === id);
  function talkTo(id, line) {
    const person = npc(id);
    if (!person) return false;
    if (!walkTo(person.pos[0], person.pos[2], 1.6)) return false;
    // You talk to people you are *facing*. `walkTo` stops the moment it is
    // close enough and does not turn, so a bot that arrived side-on stands
    // there pressing E at somebody's ear — which is what it did, at the camp,
    // for forty minutes, with nothing in the way and full health.
    const want = Math.atan2(person.pos[0] - world.player.pos[0], person.pos[2] - world.player.pos[2]);
    let off = want - world.player.yaw;
    while (off > Math.PI) off -= Math.PI * 2;
    while (off < -Math.PI) off += Math.PI * 2;
    if (Math.abs(off) > 0.5) {
      intent.turn = Math.max(-3.5, Math.min(3.5, off * 5));
      intent.forward = 0;
      return false;
    }
    intent.turn = 0;
    if (!world.dialogue.isOpen) world.talk();
    if (say(line)) return true;
    // A conversation's options are computed when it *opens*. A line that became
    // available during it — because the oath you just swore started a chapter —
    // is not on the list yet, so reopen once before giving up. The bot sat in
    // front of the captain for forty minutes without this.
    world.dialogue.close();
    world.talk();
    return say(line);
  }

  /**
   * Kit the character out.
   *
   * **This is a cheat, and it is the only one.** The bot grants itself
   * experience and coin rather than killing forty wolves in real time, because
   * this test's job is to prove the path through the game exists — the fights
   * themselves are measured, with numbers, in tools/test.js. Everything else
   * here is keys.
   */
  function outfit(xp, gold, str, skill, weapon, armour) {
    world.awardXp(xp, 'quest');
    world.character.gold += gold;
    world.character.str = Math.max(world.character.str, str);
    world.character.skills.oneHanded = Math.max(world.character.skills.oneHanded, skill);
    // And *arm* him. The first version raised his numbers and left him holding
    // the branch he starts with, so a level-sixteen character with eighty-eight
    // per cent of a sword spent an hour hitting keep guards for the minimum
    // damage and the run reported "ran out of time" rather than "unarmed".
    if (weapon) { world.give(weapon); world.equip(weapon); }
    if (armour) { world.give(armour); world.equip(armour); }
    world.give('strong_draught', 6);
    world.player.fighter.hp = world.character.maxHp;
    world.reloadout();
    note(`outfitted: level ${world.character.level}, ${str} str, ${skill}% blade, `
      + `${world.inventory.weapon} and ${world.inventory.armour}`);
  }

  const plan = [
    // --- chapter one: get known ---------------------------------------------
    { goal: 'take the ore job', done: () => world.flags.has('quest:q_ore:told'),
      act: () => { talkTo('npc3', 'harl.greet') || talkTo('npc3', 'harl.ore'); } },
    { goal: 'find the crates', done: () => world.quests.get('q_ore') === 'found',
      act: () => {
        world.dialogue.close();
        const G = world.gates.land, A = world.gates.apron;
        const C = [world.crates[0].pos[0], world.crates[0].pos[2]];
        if (!fightNearby()) walkVia('out', [[G[0], G[1] - 8], G, A, C], 2.5);
      } },
    { goal: 'get paid, and vouched for', done: () => world.flags.has('harl:trusts'),
      act: () => {
        if (fightNearby()) return;
        const G = world.gates.land, A = world.gates.apron;
        const s = npc('npc3');
        if (walkVia('back', [A, G, [G[0], G[1] - 8], [s.pos[0], s.pos[2]]], 1.6)) {
          if (!world.dialogue.isOpen) world.talk();
          say('harl.ore_solved');
        }
      } },
    // Kitted out here rather than grinding: see `outfit`.
    { goal: 'be worth taking', done: () => world.character.skills.oneHanded >= 25,
      act: () => { world.dialogue.close(); outfit(9000, 900, 32, 30, 'militia_sword', 'leather_jerkin'); } },

    // --- the oath ------------------------------------------------------------
    { goal: 'reach the captain', done: () => world.flags.has('met:aldric'),
      act: () => { if (walkVia('barracks', [[6, 4], [8, -6]], 6)) talkTo('npc9', 'aldric.greet'); } },
    { goal: 'ask to serve', done: () => world.flags.has('quest:q_watch:told'),
      act: () => { if (!world.dialogue.isOpen) world.talk(); say('aldric.join_ask'); } },
    { goal: 'be vouched for', done: () => world.flags.has('quest:q_watch:vouched'),
      act: () => { if (!world.dialogue.isOpen) world.talk(); say('aldric.vouched'); } },
    { goal: 'swear to the Watch', done: () => world.character.guild === 'watch',
      act: () => { if (!world.dialogue.isOpen) world.talk(); say('aldric.join'); } },
    { goal: 'see chapter two', done: () => world.chapter >= 2, act: () => world.dialogue.close() },

    // --- the man on the plateau ---------------------------------------------
    { goal: 'be sent to Ossric', done: () => world.flags.has('quest:q_tower:told'),
      act: () => { talkTo('npc9', 'aldric.ossric'); } },
    { goal: 'reach the tower', done: () => world.flags.has('met:ossric'),
      act: () => {
        world.dialogue.close();
        if (fightNearby(5)) return;
        const G = world.gates.land, A = world.gates.apron;
        const t = world.places.tower.at;
        if (walkVia('tower', [[G[0], G[1] - 8], G, A, [54, 30], [78, 14], [110, -46], [117, -82], [t[0], t[1] + 6]], 4)) {
          talkTo('npc13', 'ossric.greet');
        }
      } },
    { goal: 'see chapter three', done: () => world.chapter >= 3,
      act: () => { world.dialogue.close(); } },
    { goal: 'hear what the ore is for', done: () => world.flags.has('quest:q_cleft:told'),
      act: () => { talkTo('npc13', 'ossric.what'); } },

    // --- the road east -------------------------------------------------------
    { goal: 'be ready for the valley', done: () => world.character.skills.oneHanded >= 70,
      act: () => { world.dialogue.close(); outfit(90000, 2000, 76, 92, 'forged_blade', 'watch_mail'); } },
    { goal: 'walk the Cleft', done: () => world.quests.get('q_cleft') === 'done',
      act: () => {
        if (fightNearby(5)) return;
        const c = world.places.cleft.at;
        walkVia('cleft', [[110, -46], [78, 14], [96, 52], [140, 50], [c[0], c[1]]], 3);
      } },
    { goal: 'see chapter four', done: () => world.chapter >= 4, act: () => {} },
    { goal: 'cross the pass', done: () => world.region === 'cleftvale',
      act: () => {
        if (world.pendingTravel) {
          const r = travel(world, world.pendingTravel, { props: 60 });
          if (r.ok) { world = r.world; legs.clear(); note('crossed into the Cleft valley'); }
          return;
        }
        const c = world.places.cleft.at;
        walkTo(c[0], c[1], 3);
      } },

    // --- the valley ----------------------------------------------------------
    { goal: 'reach the camp', done: () => world.flags.has('met:brant'),
      act: () => {
        if (fightNearby(5)) return;
        const camp = world.places.camp.at;
        if (walkVia('camp', [[-3, 112], [-8, 96], [camp[0], camp[1] + 10]], 6)) {
          talkTo('val0', 'brant.greet');
        }
      } },
    { goal: 'hear where everybody went', done: () => world.flags.has('knows:camp_emptied'),
      act: () => { if (!world.dialogue.isOpen) world.talk(); say('brant.what_happened'); } },
    { goal: 'take the convoy job', done: () => world.flags.has('quest:q_convoy:told'),
      act: () => { if (!world.dialogue.isOpen) world.talk(); say('brant.convoy_ask'); } },
    { goal: 'count the loads', done: () => world.quests.get('q_convoy') === 'counted',
      act: () => {
        world.dialogue.close();
        if (fightNearby(5)) return;
        const pit = world.places.pit_one.at;
        if (walkVia('drift', [[-56, 34], [pit[0] + 6, pit[1] + 16]], 3)) {
          talkTo('val1', 'hask.greet') || talkTo('val1', 'hask.count');
        }
      } },
    { goal: 'report the convoy', done: () => world.quests.get('q_convoy') === 'done',
      act: () => {
        world.dialogue.close();
        if (fightNearby(5)) return;
        const camp = world.places.camp.at;
        if (walkVia('camp2', [[-56, 34], [camp[0], camp[1]]], 3)) {
          talkTo('val0', 'brant.convoy_done');
        }
      } },
    { goal: 'be sent to the keep', done: () => world.flags.has('quest:q_keep:told'),
      act: () => { if (!world.dialogue.isOpen) world.talk(); say('brant.keep'); } },

    // --- the keep ------------------------------------------------------------
    { goal: 'reach the keep', done: () => {
      const k = world.places.keep.at;
      return Math.hypot(world.player.pos[0] - k[0], world.player.pos[2] - k[1]) < 30;
    },
    act: () => {
      world.dialogue.close();
      if (fightNearby(6)) return;
      const k = world.places.keep.at;
      // Walk the route, then keep walking. A route that ends thirty metres
      // short of the thing it is a route *to* is a route that finishes and
      // leaves the bot standing in a field.
      if (walkVia('keep', [[34, 26], [74, -18], [92, -66]], 6)) walkTo(k[0], k[1] + 26, 6);
    } },
    { goal: 'take the keep', done: () => world.quests.get('q_keep') === 'done',
      act: () => {
        const k = world.places.keep.at;
        if (fightNearby(30)) return;
        walkTo(k[0], k[1], 8);
      } },

    // --- the end -------------------------------------------------------------
    { goal: 'reach the deep pit', done: () => world.flags.has('quest:q_end:found'),
      act: () => {
        if (fightNearby(6)) return;
        const pit = world.places.pit_three.at;
        if (walkVia('deep', [[92, -66], [74, -18], [-26, -6]], 8)) walkTo(pit[0], pit[1], 10);
      } },
    { goal: 'finish it', done: () => world.finished,
      act: () => { if (!fightNearby(40)) { const p = world.places.pit_three.at; walkTo(p[0], p[1], 4); } } },
  ];

  let step = 0;
  for (let t = 0; t < 60 * maxSeconds; t++) {
    while (step < plan.length && plan[step].done()) {
      note(`✓ ${plan[step].goal} (${(t / 60).toFixed(0)} s)`);
      step++;
      stuckFor = 0;
    }
    if (step >= plan.length) return { ok: true, seconds: t / 60, steps, world };

    intent.forward = 0; intent.turn = 0; intent.attack = false; intent.block = false;
    plan[step].act();
    world.tick(1 / 60, intent);

    // Drink when badly hurt, because a bot that never heals is measuring
    // something other than whether the game can be finished.
    const f = world.player.fighter;
    if (f.hp < world.character.maxHp * 0.4) {
      if (world.carrying('strong_draught')) world.drink('strong_draught');
      else if (world.carrying('healing_draught')) world.drink('healing_draught');
    }

    if (world.dead) return { ok: false, why: `died on "${plan[step].goal}"`, seconds: t / 60, steps, world };

    if (t % 60 === 0) {
      const moved = Math.hypot(world.player.pos[0] - lastPos[0], world.player.pos[2] - lastPos[1]);
      lastPos = [world.player.pos[0], world.player.pos[2]];
      if (moved < 0.6 && !world.dialogue.isOpen && !fighting) {
        stuckFor++;
        sidestep = stuckFor % 2 === 0 ? 90 : -90;
        if (stuckFor > 40) {
          return { ok: false, why: `stuck on "${plan[step].goal}"`, seconds: t / 60, steps, world };
        }
      } else stuckFor = 0;
      fighting = false;
    }
  }
  return { ok: false, why: `ran out of time on "${plan[step].goal}"`, seconds: maxSeconds, steps, world };
}

// --- run ----------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const seeds = Number(opt('seeds', 3));
  const verbose = !!opt('verbose', false);
  let failures = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const r = fullPlaythrough(seed, { verbose });
    const c = r.world.character;
    console.log(
      `  seed ${String(seed).padEnd(3)} ${r.ok ? '✓' : '✗'} ${String(Math.round(r.seconds)).padStart(5)} s`
      + `  level ${String(c.level).padStart(2)}  chapter ${r.world.chapter}  ${c.guild || 'no guild'}`
      + `  ${r.world.finished ? 'FINISHED' : 'unfinished'}`
      + `${r.ok ? '' : `  — ${r.why}`}`
    );
    if (!r.ok) failures++;
  }
  console.log(failures
    ? `\n${seeds - failures}/${seeds} playthroughs reached the end\n`
    : `\nall ${seeds} playthroughs reached the end\n`);
  process.exit(failures ? 1 : 0);
}
