// Saving.
//
// Two rules, both from §12.1 of the brief and both load-bearing.
//
// **Deltas, not snapshots.** A save records the seed and everything that has
// *changed* since the world was built from it — where the player is, what he
// knows, which beasts are dead, which chests are open. It does not record the
// terrain, the town, the trees or the eighty NPCs, because all of those come
// back identically from the seed. That is what keeps a save under a few
// kilobytes instead of a few megabytes, and it is only possible because the
// world generation is deterministic (§ src/core/rng.js).
//
// **Versioned, with a migration chain.** Save format 1 will be wrong. The
// migrations run in order from whatever version a file claims up to the current
// one, and a file from a version we have never heard of is refused politely
// rather than loaded into an undefined state.

export const SAVE_VERSION = 4;
export const DB_NAME = 'grimward';
export const STORE = 'saves';

/**
 * Migrations, keyed by the version they upgrade *from*. Each returns the data
 * one version newer. They are kept for ever: a player's save from the first
 * week has to survive every format change after it.
 */
export const MIGRATIONS = {
  // v1 kept the character's skills as a flat list of percentages and had no
  // quest log at all. Both existed in the world already; the save simply did
  // not carry them.
  1: (d) => ({
    ...d,
    version: 2,
    quests: d.quests || [],
    character: { ...d.character, skills: d.character.skills || { oneHanded: 10 } },
  }),
  // v2 had no inventory at all: the game had none. A v2 character comes back
  // holding what a new one starts with rather than empty-handed and naked.
  2: (d) => ({
    ...d,
    version: 3,
    inventory: d.inventory || { items: [['branch', 1], ['rags', 1]], weapon: 'branch', armour: 'rags' },
    traders: d.traders || [],
  }),
  // v3 had one world. A v3 save is on the island, because there was nowhere
  // else to be.
  3: (d) => ({ ...d, version: 4, region: d.region || 'verath' }),
};

/** Everything a save needs to know, as plain JSON. */
export function snapshot(world) {
  const c = world.character;
  return {
    version: SAVE_VERSION,
    saved: new Date().toISOString(),
    seed: world.seed,
    // Which world this save is *in*. A save carries deltas against the seed,
    // and the seed builds a different place in each region, so a save that does
    // not say which one is a save that cannot be loaded.
    region: world.region || 'verath',
    // The clock is world state, not player state, and forgetting it is how a
    // reload used to teleport the player from dusk back to nine in the morning.
    clock: { day: world.clock.day, minutes: world.clock.minutes },
    chapter: world.chapter,
    player: {
      pos: [...world.player.pos], yaw: world.player.yaw,
      hp: world.player.fighter.hp,
    },
    character: {
      level: c.level, xp: c.xp, lp: c.lp, gold: c.gold,
      str: c.str, dex: c.dex, mana: c.mana, maxHp: c.maxHp,
      guild: c.guild, skills: { ...c.skills }, ledger: c.ledger.slice(-64),
    },
    flags: [...world.flags],
    quests: [...world.quests.entries()],
    inventory: {
      items: [...world.inventory.items.entries()],
      weapon: world.inventory.weapon,
      armour: world.inventory.armour,
    },
    // A trader's purse and stock are world state: what you sold him is his.
    traders: world.traderState(),
    // Only the beasts that differ from how the seed made them. The filter runs
    // on the beast, not on the mapped record: the first version mapped first
    // and then compared `b.hp < b.maxHp` on an object that had no maxHp, so
    // every wounded beast was silently dropped and came back at full health.
    beasts: world.beasts
      .filter((b) => b.state === 7 || b.hp < b.maxHp)
      .map((b) => ({
        i: world.beasts.indexOf(b), hp: b.hp, dead: b.state === 7, pos: [...b.pos],
      })),
    // Chests you emptied stay empty, which is the only reason a player bothers
    // to remember where one was. Stored by id rather than by index, because a
    // chest is authored by hand and a list of them will be reordered.
    chests: (world.chests || [])
      .filter((c) => c.open || c.emptied)
      .map((c) => ({ id: c.id, open: c.open, emptied: c.emptied })),
    // What he has found. The map is drawn from it, so losing it on a reload
    // would un-discover the island.
    seen: [...(world.seen || [])],
    // Whether the last man has been called down, and whether it is over. The
    // first is needed so a reload does not summon him twice; the second so a
    // finished game stays finished.
    warden: !!world.wardenSpawned,
    finished: !!world.finished,
    // Purses already lifted, likewise by id.
    robbed: (world.people || []).filter((p) => p.robbed).map((p) => p.id),
    // Men are saved by the same rule as beasts and for the same reason: a
    // lighthouse you cleared has to stay cleared, or the quest that depends on
    // it un-finishes itself the moment you reload.
    foes: (world.foes || [])
      .filter((m) => m.state === 7 || m.hp < m.maxHp)
      .map((m) => ({
        i: world.foes.indexOf(m), hp: m.hp, dead: m.state === 7, pos: [...m.pos],
      })),
  };
}

/** Put a snapshot back into a world built from the same seed. */
export function restore(world, data) {
  const d = migrate(data);
  if (d.seed !== world.seed) {
    throw new Error(`this save is of world ${d.seed}, and this is world ${world.seed}`);
  }
  const region = d.region || 'verath';
  if (region !== (world.region || 'verath')) {
    // The caller has to build the right region first. Refusing is the only
    // honest answer: restoring valley positions into island terrain would put
    // the player inside a hill and look like a physics bug.
    throw new Error(`this save is in ${region}, and this world is ${world.region}`);
  }
  world.clock.day = d.clock.day;
  world.clock.minutes = d.clock.minutes;
  world.chapter = d.chapter ?? 1;
  // A chapter is a world edit, so a save from chapter three restored into a
  // freshly built chapter-one island has to *replay* that edit before anything
  // else is put back. It comes first because the extra creatures a chapter adds
  // are appended to the beast list, and the beast records below are stored by
  // index into that list.
  if (world.applyChapter) world.applyChapter(world.chapter);

  world.player.pos.set(d.player.pos);
  world.player.yaw = d.player.yaw;
  world.player.fighter.hp = d.player.hp;

  const c = world.character;
  Object.assign(c, {
    level: d.character.level, xp: d.character.xp, lp: d.character.lp,
    gold: d.character.gold, str: d.character.str, dex: d.character.dex,
    mana: d.character.mana, maxHp: d.character.maxHp, guild: d.character.guild,
  });
  c.skills = { ...d.character.skills };
  c.ledger = d.character.ledger || [];
  world.player.fighter.skill = c.skills.oneHanded ?? 10;
  world.player.fighter.str = c.str + 15;

  world.flags.clear();
  for (const f of d.flags) world.flags.add(f);
  // Doors are not saved: which ones stand open is entirely decided by the flags
  // and the chapter, both of which are. Storing the door state as well would be
  // a second source of truth for the same fact, and the two would drift.
  if (world.openDoor && world.flags.has('pass:upper')) world.openDoor('upper');
  // Skill flags live on the character as well as in the world's flag set.
  c.flags = new Set(d.flags.filter((f) => f.startsWith('skill:')));

  world.quests.clear();
  for (const [k, v] of d.quests) world.quests.set(k, v);

  world.inventory.items = new Map(d.inventory.items);
  world.inventory.weapon = d.inventory.weapon;
  world.inventory.armour = d.inventory.armour;
  world.restoreTraders(d.traders || []);
  world.reloadout();

  for (const b of d.beasts) {
    const beast = world.beasts[b.i];
    if (!beast) continue;               // a save from before this beast existed
    beast.hp = b.hp;
    beast.pos.set(b.pos);
    if (b.dead) { beast.state = 7; beast.hp = 0; }
  }
  for (const c of d.chests || []) {
    const chest = (world.chests || []).find((x) => x.id === c.id);
    if (!chest) continue;             // a save from before this chest existed
    chest.open = c.open;
    chest.emptied = c.emptied;
    if (chest.open) chest.picked = 1e9;
  }
  if (world.seen) {
    world.seen.clear();
    for (const name of d.seen || []) world.seen.add(name);
  }
  world.wardenSpawned = !!d.warden;
  world.finished = !!d.finished;
  const robbed = new Set(d.robbed || []);
  for (const p of world.people || []) p.robbed = robbed.has(p.id);
  for (const m of d.foes || []) {
    const foe = world.foes && world.foes[m.i];
    if (!foe) continue;
    foe.hp = m.hp;
    foe.pos.set(m.pos);
    if (m.dead) { foe.state = 7; foe.hp = 0; foe.counted = true; }
  }
  world.player.xp = c.xp;
  world.player.level = c.level;
  return world;
}

/** Bring an old save up to the current format, or refuse it. */
export function migrate(data) {
  if (!data || typeof data !== 'object') throw new Error('this is not a save file');
  let d = data;
  let v = d.version;
  if (typeof v !== 'number') throw new Error('this save has no version');
  if (v > SAVE_VERSION) {
    throw new Error(`this save is from a newer version of the game (${v} > ${SAVE_VERSION})`);
  }
  while (v < SAVE_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) throw new Error(`no migration from save version ${v}`);
    d = step(d);
    if (d.version !== v + 1) throw new Error(`migration ${v} did not set version ${v + 1}`);
    v = d.version;
  }
  return d;
}

// --- storage ------------------------------------------------------------------

/**
 * IndexedDB, wrapped in promises, with an in-memory fallback.
 *
 * Storage can be denied — private browsing, a sandboxed iframe, a browser
 * policy — and a game that throws on start because it cannot save is worse than
 * one that runs and warns. The fallback keeps the session playable and says so
 * once (§18.2's rule for every capability).
 */
export function createStorage(caps = {}) {
  const memory = new Map();
  const usable = caps.storage !== false && typeof indexedDB !== 'undefined';

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  return {
    get inMemory() { return !usable; },

    async put(slot, data) {
      if (!usable) { memory.set(slot, JSON.parse(JSON.stringify(data))); return { ok: true, where: 'memory' }; }
      const db = await open();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(data, slot);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      return { ok: true, where: 'indexeddb' };
    },

    async get(slot) {
      if (!usable) return memory.get(slot) ?? null;
      const db = await open();
      const value = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(slot);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error);
      });
      db.close();
      return value;
    },

    async list() {
      if (!usable) return [...memory.keys()];
      const db = await open();
      const keys = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).getAllKeys();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
      db.close();
      return keys;
    },
  };
}
