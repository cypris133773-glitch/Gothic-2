// Carrying, wearing, drinking and selling.
//
// No weight limit — that is the tradition's choice and it is the right one: the
// friction in this game is what you can *use*, not what you can lift. A player
// with forty wolf pelts has a problem of value, not of encumbrance, and the
// problem is that the trader only has nine hundred coin.
//
// Equipping is where pillar P3 lives. `equip` refuses under-requirement gear
// outright and says which attribute is short, because "you need thirty strength"
// is a goal and "-12% damage" is a shrug.

import { ITEMS, KIND, item, TRADERS } from '../data/items.js';
import { canWield } from './character.js';
import { WEAPONS } from './combat.js';

export function createInventory(start = {}) {
  return {
    items: new Map(Object.entries(start)),      // id → count
    weapon: null,                               // equipped item id
    armour: null,
  };
}

export const count = (inv, id) => inv.items.get(id) || 0;
export const has = (inv, id, n = 1) => count(inv, id) >= n;

export function add(inv, id, n = 1) {
  item(id);                                     // throws on a typo, loudly
  inv.items.set(id, count(inv, id) + n);
  return inv;
}

export function remove(inv, id, n = 1) {
  const have = count(inv, id);
  if (have < n) return false;
  if (have === n) inv.items.delete(id); else inv.items.set(id, have - n);
  // Losing the thing you are holding unequips it rather than leaving a ghost.
  if (inv.weapon === id && !has(inv, id)) inv.weapon = null;
  if (inv.armour === id && !has(inv, id)) inv.armour = null;
  return true;
}

/**
 * Put something on. Refuses, with a reason, if the character is not strong
 * enough, not dexterous enough, or not of the right guild.
 */
export function equip(inv, character, id) {
  const it = item(id);
  if (!has(inv, id)) return { ok: false, why: 'you are not carrying that' };
  if (it.kind !== KIND.WEAPON && it.kind !== KIND.ARMOUR) {
    return { ok: false, why: `${it.name} is not something you wear or wield` };
  }
  const allowed = canWield(character, it);
  if (!allowed.ok) return { ok: false, why: `${it.name} ${allowed.why}` };
  if (it.guild && character.guild !== it.guild) {
    return { ok: false, why: `${it.name} belongs to the ${it.guild}, and you do not` };
  }
  if (it.mana && character.mana < it.mana) {
    return { ok: false, why: `${it.name} needs ${it.mana} mana` };
  }
  if (it.kind === KIND.WEAPON) inv.weapon = id; else inv.armour = id;
  return { ok: true, item: it };
}

export function unequip(inv, slot) {
  if (slot === 'weapon') inv.weapon = null; else inv.armour = null;
  return { ok: true };
}

/**
 * Push what is equipped into the fighter that does the swinging.
 *
 * The fighter is the only thing that knows about frames and reach; the
 * inventory is the only thing that knows what is in your hand. This is the one
 * place they meet, so there is exactly one answer to "what am I hitting with".
 */
export function applyLoadout(inv, character, fighter) {
  const w = inv.weapon ? item(inv.weapon) : null;
  const a = inv.armour ? item(inv.armour) : null;
  const cls = w ? w.class : 'oneHanded';
  fighter.weapon = { ...WEAPONS[cls === 'bow' ? 'dagger' : cls], damage: w ? w.damage : 8 };
  fighter.weaponName = cls;
  // Skill follows the weapon in hand: a swordsman picking up an axe is a
  // beginner again, which is the whole reason weapon skills are separate.
  fighter.skill = character.skills[cls] ?? 0;
  fighter.armor = a ? a.prot : 0;
  fighter.str = character.str + 15;
  return fighter;
}

/** Drink it. Healing is immediate; a permanent draught is a permanent change. */
export function drink(inv, character, fighter, id) {
  const it = item(id);
  if (it.kind !== KIND.POTION) return { ok: false, why: `${it.name} is not a potion` };
  if (!has(inv, id)) return { ok: false, why: 'you are not carrying that' };
  remove(inv, id);
  if (it.heals) {
    const before = fighter.hp;
    fighter.hp = Math.min(character.maxHp, fighter.hp + it.heals);
    return { ok: true, healed: fighter.hp - before };
  }
  if (it.permanent) {
    for (const [attr, amount] of Object.entries(it.permanent)) {
      character[attr] += amount;
      character.ledger.push({ what: attr, points: amount, cost: 0, source: 'permanent-potion' });
    }
    if (it.permanent.maxHp) fighter.maxHp = character.maxHp;
    applyLoadout(inv, character, fighter);
    return { ok: true, permanent: it.permanent };
  }
  return { ok: true };
}

// --- trading ------------------------------------------------------------------

/**
 * A trader's stock and purse, built fresh from the data and then *kept*: what
 * you sold him is his, what he sold you is gone, and his coin runs out. He
 * restocks on a chapter boundary and not on a timer (§6.7, pillar P11).
 */
export function createTrader(id) {
  const def = TRADERS[id];
  if (!def) throw new Error(`no trader "${id}"`);
  return {
    id, gold: def.gold,
    stock: new Map(def.stock),
    buys: def.buys,
    restock() { this.gold = def.gold; this.stock = new Map(def.stock); },
  };
}

/** What the player pays. Traders do not haggle and the price is not random. */
export const buyPrice = (it) => Math.max(1, Math.round(it.value * 1.0));
/** What the player is offered. A third, which is why forty pelts is a chore. */
export const sellPrice = (it) => Math.max(1, Math.round(it.value * 0.35));

export function buy(trader, inv, character, id, n = 1) {
  const it = item(id);
  const available = trader.stock.get(id) || 0;
  if (available < n) return { ok: false, why: `${trader.id} has no more of those` };
  const cost = buyPrice(it) * n;
  if (character.gold < cost) return { ok: false, why: `that costs ${cost} and you have ${character.gold}` };
  character.gold -= cost;
  trader.gold += cost;
  if (available === n) trader.stock.delete(id); else trader.stock.set(id, available - n);
  add(inv, id, n);
  return { ok: true, paid: cost };
}

export function sell(trader, inv, character, id, n = 1) {
  const it = item(id);
  if (it.unsellable) return { ok: false, why: `${it.name} is not for sale` };
  if (!has(inv, id, n)) return { ok: false, why: 'you are not carrying that many' };
  if (!trader.buys.includes(it.kind)) return { ok: false, why: `${trader.id} does not deal in that` };
  const offer = sellPrice(it) * n;
  if (trader.gold < offer) {
    // Finite coin is the whole point: it is what stops a player turning an
    // afternoon of wolves into a full set of plate.
    return { ok: false, why: `${trader.id} has only ${trader.gold} coin left` };
  }
  remove(inv, id, n);
  trader.gold -= offer;
  character.gold += offer;
  trader.stock.set(id, (trader.stock.get(id) || 0) + n);
  return { ok: true, got: offer };
}

/** A readable list for the UI and for tests. */
export function listing(inv) {
  return [...inv.items.entries()].map(([id, n]) => {
    const it = ITEMS[id];
    return {
      id, n, name: it.name, kind: it.kind, value: it.value,
      equipped: inv.weapon === id || inv.armour === id,
      str: it.str || 0, dex: it.dex || 0, guild: it.guild || null,
    };
  }).sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
}
