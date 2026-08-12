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
import { createPlayer, stepPlayer, resolveObstacles, HEIGHT } from '../game/player.js';
import { createCamera, stepCamera } from '../game/camera.js';
import { poseHumanoid, advanceGait, KITS } from '../game/rig.js';
import { Clock, keyLightDirection, skyPalette } from '../core/time.js';
import { idleIntent } from '../core/input.js';
import { makeRng } from '../core/rng.js';
import { createFighter, stepFighter, resolveStrike, isStriking, S } from '../game/combat.js';
import { createBeast, stepBeast, poseBeast, BEASTS } from '../game/beast.js';
import { meleeDamage, levelForXp } from '../game/progression.js';
import { createCharacter, awardXp, learn, raiseAttribute, joinGuild } from '../game/character.js';
import { createDialogue } from '../game/dialogue.js';
import { DIALOGUE, SPEAKERS } from '../data/dialogue.js';

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
  // One seeded stream for everything that happens in a fight. Combat used
  // Math.random, which meant two runs of the same seed diverged the moment a
  // blade swung — and the bot tests, which are the only proof the world is
  // completable, were quietly measuring different worlds each time.
  const rng = makeRng(seed * 7717 + 3).stream('combat');

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


  // The character sheet, the flags every conversation reads, and the quest log.
  // A fresh character has held a sword before, but only just: ten per cent is
  // the bottom of the rookie band, which is one chained swing and a crit one
  // time in ten. Everything above it is bought from a trainer (P4).
  const character = createCharacter({ gold: 260, lp: 10 });
  character.skills.oneHanded = 10;
  const flags = new Set();
  const quests = new Map();

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


  const props = scatter(terrain, opts.lineup ? 0 : (opts.props ?? 260), [-110, -110, 110, 110]);
  const town = (opts.town === false || opts.lineup) ? [] : buildTown(terrain, seed);
  const people = opts.lineup ? makeLineup(terrain)
    : opts.people === false ? [] : makePeople(terrain, seed);

  // Wolves, out past the fields. Nothing is placed inside the town: the whole
  // point of the design is that the road is safe and the woods are not, and a
  // wolf on the market square would say the opposite (§4, P2).
  const beasts = [];
  if (!opts.lineup && opts.beasts !== false) {
    const brng = makeRng(seed * 31337 + 5);
    const wanted = opts.beasts ?? 7;
    for (let i = 0; i < wanted * 12 && beasts.length < wanted; i++) {
      const a = brng.range(0, Math.PI * 2), r = brng.range(34, 92);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (terrain.heightAt(x, z) < 1.2 || terrain.slopeAt(x, z) > 0.5) continue;
      beasts.push(createBeast(brng.chance(0.75) ? 'wolf' : 'boar', x, z, terrain, brng));
    }
  }
  const beastParts = beasts.map(() => []);

  // The stolen ore, out on the north road. It is a thing in the world rather
  // than a dialogue flag: the quest is told in town and *found* by walking.
  const crates = [];
  if (!opts.lineup) {
    const cx = 6, cz = -46;
    const cy = terrain.heightAt(cx, cz);
    for (let i = 0; i < 3; i++) {
      crates.push({
        pos: [cx + i * 0.9 - 0.9, cy + 0.35, cz + (i % 2) * 0.6],
        yaw: 0.3 * i, pitch: 0, scale: [0.8, 0.7, 0.8],
        albedo: [0.30, 0.21, 0.12], tex: 10 /* MAT.PLANK */, radius: 0.5,
      });
    }
  }

  // Everything the character controller can bump into.
  const obstacles = [...props, ...town, ...crates].filter((b) => b.radius || b.box);

  // Scene buffers, reused every frame: the scene is a *view* of the simulation
  // and rebuilding it must not allocate (§8.1.4). The static half never changes;
  // the character half is refilled in place by the rig.
  const staticBoxes = [...props, ...town, ...crates].filter((b) => !b.invisible);
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

  const world = {
    seed, terrain, clock, player, camera, props, town, people, beasts, obstacles, ticks: 0,
    character, flags, quests, chapter: 1, openTrainer: null, log: [],

    /** Experience goes to the sheet, which hands out levels and learning points. */
    awardXp(amount, reason = 'quest') {
      const gained = awardXp(character, amount, reason);
      player.xp = character.xp; player.level = character.level;
      if (gained) world.log.push(`You are level ${character.level}. ${gained * 10} learning points.`);
      return gained;
    },

    setQuest(quest, stage) {
      quests.set(quest, stage);
      flags.add(`quest:${quest}:${stage}`);
      world.log.push(`Quest ${quest}: ${stage}`);
    },

    joinGuild(guild) {
      const r = joinGuild(character, guild);
      if (r.ok) world.log.push(`You are sworn to the ${guild}.`);
      return r;
    },

    makeHostile(npc) { if (npc) npc.hostile = true; },

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
        if (d < 3) world.setQuest('q_ore', 'found');
      }
      if (quests.get('q_wolves') === 'told') {
        const dead = beasts.filter((b) => b.kind === 'wolf' && b.state === S.DEAD).length;
        if (dead >= 4) world.setQuest('q_wolves', 'cleared');
      }
    },

    /**
     * Buy what a trainer is offering. This is the only path in the game that
     * can raise a skill, and it is deliberately separate from the conversation
     * that opened the offer: talking is free, learning costs learning points.
     */
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
        if (skill === 'oneHanded') player.fighter.skill = character.skills.oneHanded;
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
            player.xp += b.def.xp;
            player.level = levelForXp(player.xp);
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

      boxes.length = 0;
      for (const b of staticBoxes) boxes.push(b);
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
