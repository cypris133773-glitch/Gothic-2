// The character sheet: attributes, learning points, and skills bought with them.
//
// Pillar P4 of the brief: growth is *bought, not sprinkled*. Nothing in this
// file can be called by a chest, a level-up or a quest reward directly — every
// increase goes through `spend`, which requires a reason, and the reasons are
// enumerated. That is what stops the game quietly turning into one where
// numbers go up on their own.

import {
  LEVEL_XP, TOTAL_XP, levelForXp, LP_PER_LEVEL, HP_PER_LEVEL, BASE_HP,
  lpForAttribute, lpToRaise,
} from './progression.js';

/** Where an increase is allowed to come from. Anything else throws. */
export const SOURCES = ['trainer', 'quest', 'permanent-potion', 'debug'];

export const SKILLS = {
  oneHanded: { kind: 'percent', max: 100, label: 'One-handed' },
  twoHanded: { kind: 'percent', max: 100, label: 'Two-handed' },
  bow: { kind: 'percent', max: 100, label: 'Bow' },
  crossbow: { kind: 'percent', max: 100, label: 'Crossbow' },
  sneak: { kind: 'flag', lp: 5, label: 'Sneak' },
  lockpick: { kind: 'flag', lp: 5, label: 'Lockpicking' },
  pickpocket: { kind: 'flag', lp: 5, label: 'Pickpocketing' },
  acrobatics: { kind: 'flag', lp: 5, label: 'Acrobatics' },
  skinning: { kind: 'flag', lp: 5, label: 'Skinning' },
  smithing: { kind: 'flag', lp: 5, label: 'Smithing' },
  alchemy: { kind: 'flag', lp: 5, label: 'Alchemy' },
};

export function createCharacter(opts = {}) {
  return {
    name: opts.name || 'the Warden\'s Man',
    guild: null,                         // one of watch | ember | freeblade, once
    level: 0, xp: 0, lp: opts.lp ?? 0,
    str: opts.str ?? 10, dex: opts.dex ?? 10, mana: opts.mana ?? 0,
    maxHp: BASE_HP, gold: opts.gold ?? 40,
    skills: { oneHanded: 0, twoHanded: 0, bow: 0, crossbow: 0 },
    flags: new Set(),
    // Every increase ever made, with its reason. A log rather than a counter,
    // because the interesting question during balancing is always "where did
    // this come from", never "how much".
    ledger: [],
  };
}

/** Award experience, and hand out levels and learning points as they fall. */
export function awardXp(c, amount, reason = 'quest') {
  c.xp += amount;
  const was = c.level;
  c.level = levelForXp(c.xp);
  const gained = c.level - was;
  if (gained > 0) {
    c.lp += gained * LP_PER_LEVEL;
    c.maxHp += gained * HP_PER_LEVEL;
    c.ledger.push({ what: 'level', from: was, to: c.level, reason });
  }
  return gained;
}

/** Experience still needed for the next level — what the HUD shows. */
export const xpToNext = (c) => TOTAL_XP(c.level + 1) - c.xp;

/**
 * Raise an attribute. Costs learning points on the five-band curve, and the
 * caller must say who is teaching: nobody gets stronger from a menu in a wood.
 */
export function raiseAttribute(c, attr, points, source) {
  requireSource(source);
  if (!['str', 'dex', 'mana'].includes(attr)) throw new Error(`no attribute ${attr}`);
  const cost = lpToRaise(c[attr], c[attr] + points);
  if (cost > c.lp) return { ok: false, why: 'not enough learning points', cost, have: c.lp };
  c.lp -= cost;
  c[attr] += points;
  c.ledger.push({ what: attr, points, cost, source });
  return { ok: true, cost, value: c[attr] };
}

/**
 * Learn a skill, or raise a weapon percentage.
 *
 * Weapon percentages are bought on the same five-band curve as attributes,
 * which is what makes the last twenty per cent of a weapon skill a serious
 * investment rather than a formality.
 */
export function learn(c, skill, amount, source) {
  requireSource(source);
  const def = SKILLS[skill];
  if (!def) throw new Error(`no skill ${skill}`);

  if (def.kind === 'flag') {
    if (c.flags.has(`skill:${skill}`)) return { ok: false, why: 'already known' };
    if (def.lp > c.lp) return { ok: false, why: 'not enough learning points', cost: def.lp, have: c.lp };
    c.lp -= def.lp;
    c.flags.add(`skill:${skill}`);
    c.ledger.push({ what: skill, cost: def.lp, source });
    return { ok: true, cost: def.lp };
  }

  const from = c.skills[skill] || 0;
  const to = Math.min(def.max, from + amount);
  if (to === from) return { ok: false, why: 'already at the ceiling' };
  const cost = lpToRaise(from, to);
  if (cost > c.lp) return { ok: false, why: 'not enough learning points', cost, have: c.lp };
  c.lp -= cost;
  c.skills[skill] = to;
  c.ledger.push({ what: skill, points: to - from, cost, source });
  return { ok: true, cost, value: to };
}

export const knows = (c, skill) => c.flags.has(`skill:${skill}`);

/** A weapon's strength requirement is permission, not a modifier (P3). */
export function canWield(c, item) {
  if (item.str && c.str < item.str) return { ok: false, why: `needs ${item.str} strength` };
  if (item.dex && c.dex < item.dex) return { ok: false, why: `needs ${item.dex} dexterity` };
  return { ok: true };
}

/**
 * Joining a guild is a door closing (P5). It can only happen once, and the
 * function refuses rather than overwriting, because a bug that silently
 * reassigns a guild would invalidate every dialogue condition in the game.
 */
export function joinGuild(c, guild) {
  if (c.guild) return { ok: false, why: `already sworn to the ${c.guild}` };
  if (!['watch', 'ember', 'freeblade'].includes(guild)) throw new Error(`no guild ${guild}`);
  c.guild = guild;
  c.flags.add(`guild:${guild}`);
  c.ledger.push({ what: 'guild', to: guild, source: 'quest' });
  return { ok: true };
}

function requireSource(source) {
  if (!SOURCES.includes(source)) {
    // The error names the pillar, because the next person to hit it will be
    // adding a chest that grants strength and should be told why they cannot.
    throw new Error(
      `growth needs a source (one of ${SOURCES.join(', ')}) — see pillar P4: `
      + 'growth is bought, not sprinkled'
    );
  }
}

export { LEVEL_XP, TOTAL_XP, lpForAttribute, LP_PER_LEVEL };
