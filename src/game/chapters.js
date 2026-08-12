// Chapters.
//
// Four of them, and each one *rewrites the island* rather than adding a line to
// a list. That is the single structural idea worth taking from the game this
// one is in the tradition of: you do not get a new area, you get the same area
// with different things in it, and walking a road you already know and finding
// it changed is worth more than any amount of new geography.
//
// A chapter change is therefore a world edit, not a number. It moves beasts,
// opens doors, puts things on roads and changes what people will talk about.
// The number exists only so that dialogue conditions can read it.
//
// Advancing is one-way and explicit: `world.setChapter(n)`. Nothing advances a
// chapter as a side effect, because a chapter that arrives by accident is a
// chapter the player cannot understand.

export const CHAPTERS = {
  1: {
    title: 'The gate is shut',
    // What the world looks like. Read by world.applyChapter.
    beasts: 34,
    hardRing: 0,          // how many extra, nastier things past the far roads
    doors: [],            // which doors stand open regardless of flags
    blurb: 'Nobody knows you. The upper quarter will not have you, the Cleft '
      + 'kills you, and the whole game is the Vale and the lower city.',
  },
  2: {
    title: 'The orders arrive',
    beasts: 40,
    hardRing: 4,
    doors: ['upper'],     // being sworn to anything is a key to your own city
    blurb: 'The Watch is reinforced, the Chapter opens its doors, the '
      + 'Freeblades start hiring. You take an oath and two doors close for ever.',
  },
  3: {
    title: 'The road east',
    beasts: 44,
    hardRing: 9,
    doors: ['upper', 'cleft'],
    blurb: 'The Cleft becomes survivable, the ore convoys start, and the '
      + 'bandits at the lighthouse become an organised problem.',
  },
  4: {
    title: 'What the ore is for',
    beasts: 48,
    hardRing: 15,
    doors: ['upper', 'cleft'],
    blurb: 'The tower\'s answer, and the last road.',
  },
};

export const LAST_CHAPTER = 4;

/**
 * What has to be true before a chapter may begin.
 *
 * These are checked, not enforced: the world calls `readyFor` and refuses a
 * chapter whose conditions are not met, which turns "the chapter advanced and
 * nobody knows why" into an error at the call site.
 */
export const REQUIREMENTS = {
  2: {
    why: 'you have to be sworn to something',
    met: (w) => !!w.character.guild,
  },
  // Written against flags rather than against the quest map on purpose. Every
  // stage a quest has ever reached leaves a flag, so a condition phrased this
  // way is (a) monotonic — reaching `done` does not un-meet a condition that
  // wanted `met` — and (b) visible to the orphan-flag validator, which reads
  // source rather than running the game.
  3: {
    why: 'Ossric has to have been found',
    met: (w) => w.flags.has('quest:q_tower:met'),
  },
  4: {
    why: 'the Cleft has to have been walked',
    met: (w) => w.flags.has('quest:q_cleft:done'),
  },
};

export function readyFor(world, n) {
  const req = REQUIREMENTS[n];
  if (!req) return { ok: true };
  return req.met(world) ? { ok: true } : { ok: false, why: req.why };
}
