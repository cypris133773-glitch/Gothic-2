// Seeded randomness, because a world that is different every run cannot be
// tested, cannot be reported as a bug, and cannot be hand-placed.
//
// Every random decision in GRIMWARD comes from a stream created here with a
// named seed, so the same save produces the same world, the same scatter and
// the same loot on every machine — and a bug report only has to carry a seed.

/**
 * sfc32 — four words of state, four operations, and a distribution flat enough
 * to scatter a forest with.
 *
 * The first attempt here was a 32-bit adaptation of xorshift128+, and the
 * uniformity test in tools/test.js caught it putting 5.5% too many draws in the
 * bottom tenth of the range. That is invisible in a dice roll and very visible
 * in ninety thousand tree positions, which is exactly why that test exists.
 */
export function makeRng(seed) {
  // splitmix32 to turn one small integer into four decorrelated words: seeding
  // a generator with (1, 2, 3, 4) is how neighbouring seeds end up producing
  // suspiciously similar worlds.
  let z = (seed >>> 0) || 0x9e3779b9;
  const mix = () => {
    z = (z + 0x9e3779b9) >>> 0;
    let t = z;
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
  let a = mix(), b = mix(), c = mix(), d = mix();

  function next() {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  }
  // Discard the first rounds so a low seed does not produce a correlated opening.
  for (let i = 0; i < 12; i++) next();

  const rng = () => next() / 4294967296;
  rng.int = (n) => Math.floor((next() / 4294967296) * n);
  rng.range = (lo, hi) => lo + (next() / 4294967296) * (hi - lo);
  rng.pick = (arr) => arr[Math.floor((next() / 4294967296) * arr.length)];
  rng.chance = (p) => next() / 4294967296 < p;
  /** A named sub-stream, so adding a system cannot shift another system's rolls. */
  rng.stream = (name) => makeRng(hash(name) ^ seed);
  return rng;
}

/** FNV-1a over a string. Used for stable ids and for per-instance variation. */
export function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
