// A duel between two policies, run headlessly.
//
// This exists to answer one question the brief asks directly (§13.2): does a
// fighter who spaces and parries beat a fighter who holds the attack button? If
// the answer is ever no, the combat system has become a damage race and the
// recovery frames, the parry window and the poise budget are decoration. It is
// the only balance assertion that matters at M6, and it is worth more than any
// amount of playing it by hand.

import { createFighter, stepFighter, resolveStrike, isStriking, S, PARRY_TICKS } from './combat.js';
import { meleeDamage } from './progression.js';
import { makeRng } from '../core/rng.js';

const CLOSE_SPEED = 0.055;             // metres per tick — about 3.3 m/s

/** Hold the attack button. The strategy everyone tries first. */
export function spamPolicy(self, foe, dist) {
  return {
    attack: true,
    block: false,
    move: dist > self.weapon.reach * 0.85 ? 1 : 0,
  };
}

/**
 * Space, punish, parry. Stay just outside the opponent's reach; step in when
 * they are recovering or staggered; put the parry window up when they commit.
 */
export function spacingPolicy(self, foe, dist) {
  const myReach = self.weapon.reach;
  const theirReach = foe.weapon.reach;
  const committed = foe.state === S.WINDUP;
  const open = foe.state === S.RECOVER || foe.state === S.STAGGER;

  // The guard goes up *late* in their wind-up, not at the start of it. The
  // parry window is nine ticks; a ten-tick wind-up met with an immediate block
  // has decayed into a passive guard by the time the blade arrives, which is
  // why the first version of this policy almost never parried anything.
  if (committed && foe.t <= PARRY_TICKS - 2 && dist < theirReach + 0.6) {
    return { attack: false, block: true, move: 0 };
  }
  if (committed && dist < theirReach + 0.3) return { attack: false, block: false, move: -1 };
  if (open && dist > myReach * 0.8) return { attack: false, block: false, move: 1 };
  if (open) return { attack: true, block: false, move: 0 };
  if (dist > theirReach + 0.9) return { attack: false, block: false, move: 1 };
  if (dist < theirReach + 0.2) return { attack: false, block: false, move: -1 };
  return { attack: false, block: false, move: 0 };
}

/**
 * Run one duel. Returns the winner's name and how long it took.
 * Both fighters are identical apart from their policy, so the result is about
 * the policies and nothing else.
 */
export function duel({ seed = 1, maxTicks = 60 * 90, fighter = {} } = {}) {
  const rng = makeRng(seed);
  const a = createFighter({ ...fighter, pos: [0, 0, 0] });
  const b = createFighter({ ...fighter, pos: [0, 0, 3.2] });
  a.facing = 0; b.facing = Math.PI;
  const policies = [spacingPolicy, spamPolicy];
  const names = ['spacer', 'spammer'];
  const fighters = [a, b];

  for (let t = 0; t < maxTicks; t++) {
    const dist = Math.abs(b.pos[2] - a.pos[2]);
    const intents = fighters.map((f, i) => policies[i](f, fighters[1 - i], dist));

    for (let i = 0; i < 2; i++) {
      const f = fighters[i];
      // Movement is locked during a swing: committing means committing your
      // feet as well as your blade.
      const rooted = f.state === S.WINDUP || f.state === S.ACTIVE || f.state === S.STAGGER;
      if (!rooted && intents[i].move) {
        const toward = i === 0 ? 1 : -1;
        f.pos[2] += toward * intents[i].move * CLOSE_SPEED;
      }
      stepFighter(f, intents[i], rng);
    }

    for (let i = 0; i < 2; i++) {
      if (isStriking(fighters[i])) resolveStrike(fighters[i], fighters[1 - i], rng, meleeDamage);
    }

    if (a.state === S.DEAD) return { winner: names[1], ticks: t, a, b };
    if (b.state === S.DEAD) return { winner: names[0], ticks: t, a, b };
  }
  return { winner: 'nobody', ticks: maxTicks, a, b };
}

/** Run a batch and report the spacer's win rate. */
export function duelSeries(trials = 200, fighter = {}) {
  const tally = { spacer: 0, spammer: 0, nobody: 0 };
  let ticks = 0;
  for (let seed = 1; seed <= trials; seed++) {
    const r = duel({ seed, fighter });
    tally[r.winner]++;
    ticks += r.ticks;
  }
  return { ...tally, trials, avgSeconds: +(ticks / trials / 60).toFixed(1) };
}
