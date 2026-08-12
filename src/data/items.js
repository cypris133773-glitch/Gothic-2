// Everything you can carry.
//
// The rule that shapes this file is pillar P3: **a requirement is permission,
// not a percentage.** Under thirty strength you cannot draw the militia sword
// at all — not "you swing it 8% slower". Crossing a threshold is a door opening,
// and the whole early game is arranging to cross the next one.
//
// So every weapon's `str` is a wall, the walls are spaced deliberately, and the
// gap between them is what a trainer sells you.

export const KIND = { WEAPON: 'weapon', ARMOUR: 'armour', POTION: 'potion', TROPHY: 'trophy', MISC: 'misc' };

export const ITEMS = {
  // --- weapons ---------------------------------------------------------------
  // damage is the weapon's contribution to (damage + strength - armour); the
  // `class` picks which frame timings and which skill percentage apply.
  branch: {
    kind: KIND.WEAPON, name: 'Heavy branch', class: 'oneHanded',
    damage: 14, str: 0, value: 4,
    note: 'What you fight your first wolf with, and it is not enough.',
  },
  rusty_blade: {
    kind: KIND.WEAPON, name: 'Rusted short sword', class: 'oneHanded',
    damage: 26, str: 10, value: 35,
  },
  militia_sword: {
    kind: KIND.WEAPON, name: 'Militia sword', class: 'oneHanded',
    damage: 44, str: 30, value: 180,
    note: 'The first real door. Thirty strength is about ten learning points.',
  },
  hunters_bow: {
    kind: KIND.WEAPON, name: 'Hunting bow', class: 'bow',
    damage: 30, dex: 25, value: 160,
  },
  forged_blade: {
    kind: KIND.WEAPON, name: 'Forged longsword', class: 'oneHanded',
    damage: 62, str: 45, value: 420,
    note: 'Made, not found — the smith will forge it once he trusts you.',
  },
  war_axe: {
    kind: KIND.WEAPON, name: 'War axe', class: 'twoHanded',
    damage: 78, str: 60, value: 600,
  },

  // --- armour ----------------------------------------------------------------
  rags: { kind: KIND.ARMOUR, name: 'Traveller\'s rags', prot: 4, str: 0, value: 10 },
  leather_jerkin: { kind: KIND.ARMOUR, name: 'Leather jerkin', prot: 22, str: 0, value: 220 },
  watch_mail: {
    kind: KIND.ARMOUR, name: 'Watch mail', prot: 48, str: 25, value: 900,
    guild: 'watch', note: 'Guild armour. You cannot buy your way into a uniform.',
  },
  freeblade_harness: {
    kind: KIND.ARMOUR, name: 'Freeblade harness', prot: 44, str: 30, value: 850, guild: 'freeblade',
  },
  ember_robe: {
    kind: KIND.ARMOUR, name: 'Ember novice robe', prot: 20, mana: 10, value: 700, guild: 'ember',
  },

  // --- potions ---------------------------------------------------------------
  healing_draught: { kind: KIND.POTION, name: 'Healing draught', heals: 60, value: 45 },
  strong_draught: { kind: KIND.POTION, name: 'Strong healing draught', heals: 150, value: 130 },
  // The permanent ones are why players comb the map. There are a fixed number
  // in the world and none of them can be bought (§6.7).
  elixir_str: { kind: KIND.POTION, name: 'Elixir of strength', permanent: { str: 1 }, value: 0, unsellable: true },
  elixir_dex: { kind: KIND.POTION, name: 'Elixir of dexterity', permanent: { dex: 1 }, value: 0, unsellable: true },
  elixir_life: { kind: KIND.POTION, name: 'Elixir of life', permanent: { maxHp: 5 }, value: 0, unsellable: true },

  // --- trophies: the early-game income ---------------------------------------
  wolf_pelt: { kind: KIND.TROPHY, name: 'Wolf pelt', value: 28, from: 'wolf', needs: 'skinning' },
  wolf_fang: { kind: KIND.TROPHY, name: 'Wolf fang', value: 12, from: 'wolf' },
  boar_hide: { kind: KIND.TROPHY, name: 'Boar hide', value: 40, from: 'boar', needs: 'skinning' },
  boar_tusk: { kind: KIND.TROPHY, name: 'Boar tusk', value: 18, from: 'boar' },

  // --- misc ------------------------------------------------------------------
  lockpick: { kind: KIND.MISC, name: 'Lockpick', value: 12 },
  ore_crate: { kind: KIND.MISC, name: 'Crate of blackore', value: 0, quest: true, unsellable: true },
  bandit_letter: { kind: KIND.MISC, name: 'Water-stained letter', value: 0, quest: true, unsellable: true },
  // The letter you carry past the gate guards. It is a quest item and it is
  // sealed: the design of the errand is that you never learn what it says,
  // which is what makes carrying it an act of trust rather than of curiosity.
  sealed_letter: { kind: KIND.MISC, name: 'Sealed letter', value: 0, quest: true, unsellable: true },
};

/** What a creature leaves behind. `needs` entries only drop if you know how. */
export const DROPS = {
  wolf: [
    { item: 'wolf_fang', chance: 0.7 },
    { item: 'wolf_pelt', chance: 0.85 },
  ],
  boar: [
    { item: 'boar_tusk', chance: 0.6 },
    { item: 'boar_hide', chance: 0.8 },
  ],
};

/** What a trader has, and how much coin they can pay out (§6.7). */
export const TRADERS = {
  harl_smith: {
    gold: 900,
    stock: [
      ['rusty_blade', 2], ['militia_sword', 1], ['leather_jerkin', 1], ['lockpick', 5],
    ],
    // A smith buys metal and leather and nothing else. A trader who buys
    // everything is a wallet with a face.
    buys: [KIND.WEAPON, KIND.ARMOUR, KIND.MISC],
  },
  bosk_hunter: {
    gold: 420,
    stock: [['hunters_bow', 1], ['healing_draught', 4]],
    buys: [KIND.TROPHY, KIND.POTION],
  },
  yorne_tavern: {
    gold: 260,
    stock: [['healing_draught', 6], ['lockpick', 3]],
    // A publican buys what he can sell over the bar, and hides.
    buys: [KIND.POTION, KIND.TROPHY],
  },
  vessa_alchemist: {
    gold: 1400,
    stock: [['healing_draught', 8], ['strong_draught', 3]],
    buys: [KIND.POTION, KIND.TROPHY, KIND.MISC],
  },
};

export const item = (id) => {
  const it = ITEMS[id];
  if (!it) throw new Error(`no item "${id}"`);
  return it;
};
