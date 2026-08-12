// The heightfield.
//
// Two rules shape this file. The first is that terrain is *authored*, not
// generated: the noise is there to add texture to a shape that control curves
// decide (§7.2). At M2 the only control is a settlement pad and a road, but the
// mechanism is the one the finished island uses, and adding a ridgeline later
// is data rather than a rewrite.
//
// The second is that the height function is pure and cheap. Collision, NPC
// pathing, object placement and the mesh builder all call it, several thousand
// times a frame between them, from Node as well as from the browser. It
// allocates nothing and it depends on nothing but the seed.

import { makeRng, hash } from '../core/rng.js';
import { MAT } from '../assets/texgen.js';

export const TERRAIN_SIZE = 512;      // metres across, centred on the origin
export const SEA_LEVEL = 0;           // y = 0 is the waterline, everywhere
const HALF = TERRAIN_SIZE / 2;

/** Value noise with a hashed lattice — deterministic, seedless at call time. */
function noise2(seed, x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  // Smoothstep the interpolant so the surface has no visible lattice creases.
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const h = (a, b) => {
    let n = (a * 374761393 + b * 668265263 + seed * 2147483647) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const a = h(xi, zi), b = h(xi + 1, zi), c = h(xi, zi + 1), d = h(xi + 1, zi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function fbm(seed, x, z, octaves = 5) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += noise2(seed + o * 91, x * freq, z * freq) * amp;
    norm += amp;
    amp *= 0.5; freq *= 2.03;   // not exactly 2, so octaves do not align
  }
  return sum / norm;
}

export function createTerrain(seed = 1) {
  const s = hash(`terrain:${seed}`) & 0xffff;

  /**
   * The authored part. A flat pad where the settlement stands and a road
   * running north out of it, both of which flatten the noise rather than
   * replace it — a road that ignores the landscape reads as a texture decal,
   * and a road that bends the landscape around itself reads as a road.
   */
  function flatten(x, z) {
    const padDist = Math.max(Math.abs(x) / 26, Math.abs(z) / 20);
    const pad = 1 - smooth01((padDist - 0.7) / 0.6);
    // The road is a corridor along +Z, wandering slightly so it is not a ruler.
    const wander = (noise2(s + 7, z * 0.02, 0) - 0.5) * 18;
    const road = 1 - smooth01((Math.abs(x - wander) - 4) / 7);
    return Math.max(pad, road * 0.85);
  }

  function heightAt(x, z) {
    // Large-scale relief, then a medium band for hillocks, then fine detail.
    const relief = fbm(s, x * 0.0045, z * 0.0045, 4) * 34;
    const hills = fbm(s + 31, x * 0.021, z * 0.021, 3) * 5.5;
    const detail = fbm(s + 57, x * 0.13, z * 0.13, 2) * 0.55;
    let h = relief + hills + detail - 14;

    // The island falls away to the sea at the edge of the playable area, so a
    // player who walks to the boundary meets a coast rather than a wall.
    const edge = Math.max(Math.abs(x), Math.abs(z)) / HALF;
    h -= smooth01((edge - 0.72) / 0.28) * 26;

    const f = flatten(x, z);
    return h * (1 - f) + 1.2 * f;
  }

  /** Central difference, one metre apart — accurate enough for slopes and IK. */
  function normalAt(out, x, z) {
    const e = 0.6;
    const hx = heightAt(x + e, z) - heightAt(x - e, z);
    const hz = heightAt(x, z + e) - heightAt(x, z - e);
    const nx = -hx, ny = 2 * e, nz = -hz;
    const len = Math.hypot(nx, ny, nz) || 1;
    out[0] = nx / len; out[1] = ny / len; out[2] = nz / len;
    return out;
  }

  /** Slope in radians, for scatter rules and for "you cannot climb that". */
  function slopeAt(x, z) {
    const n = normalAt(_n, x, z);
    return Math.acos(Math.min(1, Math.max(-1, n[1])));
  }
  const _n = new Float32Array(3);

  return { seed, heightAt, normalAt, slopeAt, padFactor: flatten, size: TERRAIN_SIZE };
}

/**
 * Build a renderable mesh for one square patch. Called per chunk; at M2 there
 * are nine chunks around the player and no LOD yet, which is honest about what
 * has been built rather than pretending at a clipmap that has not.
 */
export function buildChunk(terrain, cx, cz, chunkSize, res) {
  // (res + 1)² grid, plus a skirt of one quad around the rim.
  //
  // The skirt is what makes level of detail possible at all. Two neighbouring
  // chunks at different resolutions sample the same height function at
  // different spacings, so their shared edge does not line up and daylight
  // shows through the crack. A vertical curtain hanging a couple of metres
  // below each chunk's rim covers it, costs one ring of quads, and is invisible
  // because it is only ever seen edge-on through a gap that is a pixel wide.
  const n = res + 1;
  const skirtVerts = n * 4;
  const verts = new Float32Array((n * n + skirtVerts) * 11);   // pos3, normal3, colour3, weights2
  const index = new Uint32Array((res * res * 6) + (res * 4 * 6));
  const step = chunkSize / res;
  const nrm = new Float32Array(3);
  let v = 0;

  const writeVertex = (x, z, y, forceDown) => {
    terrain.normalAt(nrm, x, z);
    verts[v++] = x; verts[v++] = y; verts[v++] = z;
    // A skirt vertex keeps its rim's normal so the curtain shades like the
    // ground it hangs from rather than like a wall.
    verts[v++] = nrm[0]; verts[v++] = forceDown ? nrm[1] : nrm[1]; verts[v++] = nrm[2];
    const slope = Math.acos(Math.min(1, nrm[1]));
    const rock = smooth01((slope - 0.55) / 0.35);
    const shore = 1 - smooth01((y - SEA_LEVEL) / 1.1);
    const gr = [0.13, 0.18, 0.08], rk = [0.22, 0.21, 0.19], sh = [0.30, 0.28, 0.22];
    const paved = smooth01((terrain.padFactor(x, z) - 0.45) / 0.35);
    const grain = 0.86 + fbm(1, x * 2.7, z * 2.7, 2) * 0.34;
    const cob = [0.17 * grain, 0.163 * grain, 0.152 * grain];
    for (let c = 0; c < 3; c++) {
      const base = gr[c] * (1 - rock) + rk[c] * rock;
      const land = base * (1 - shore) + sh[c] * shore;
      verts[v++] = land * (1 - paved) + cob[c] * paved;
    }
    verts[v++] = rock;
    verts[v++] = paved;
  };

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = cx + i * step, z = cz + j * step;
      writeVertex(x, z, terrain.heightAt(x, z), false);
    }
  }

  let k = 0;
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      index[k++] = a; index[k++] = c; index[k++] = b;
      index[k++] = b; index[k++] = c; index[k++] = d;
    }
  }

  // The four skirt strips, in the order the loop below expects them.
  const DROP = 3.5;
  const edges = [
    { fixed: 'j', at: 0, flip: true },
    { fixed: 'j', at: res, flip: false },
    { fixed: 'i', at: 0, flip: false },
    { fixed: 'i', at: res, flip: true },
  ];
  for (const edge of edges) {
    const first = v / 11;
    for (let t = 0; t < n; t++) {
      const i = edge.fixed === 'i' ? edge.at : t;
      const j = edge.fixed === 'j' ? edge.at : t;
      const x = cx + i * step, z = cz + j * step;
      writeVertex(x, z, terrain.heightAt(x, z) - DROP, true);
    }
    for (let t = 0; t < res; t++) {
      const i = edge.fixed === 'i' ? edge.at : t;
      const j = edge.fixed === 'j' ? edge.at : t;
      const top = j * n + i;
      const topNext = edge.fixed === 'i' ? top + n : top + 1;
      const bot = first + t, botNext = bot + 1;
      if (edge.flip) {
        index[k++] = top; index[k++] = bot; index[k++] = topNext;
        index[k++] = topNext; index[k++] = bot; index[k++] = botNext;
      } else {
        index[k++] = top; index[k++] = topNext; index[k++] = bot;
        index[k++] = topNext; index[k++] = botNext; index[k++] = bot;
      }
    }
  }

  return { verts, index: index.subarray(0, k) };
}

/**
 * Scatter props over a patch by rule: slope, altitude and a seeded jitter, with
 * nothing on the road or the settlement pad. Ninety thousand instances at M4
 * come out of this same function; today it is a few hundred rocks and trunks.
 */
export function scatter(terrain, count, bounds) {
  const rng = makeRng(hash(`scatter:${terrain.seed}`));
  const out = [];
  for (let i = 0; i < count * 4 && out.length < count; i++) {
    const x = rng.range(bounds[0], bounds[2]);
    const z = rng.range(bounds[1], bounds[3]);
    const y = terrain.heightAt(x, z);
    const slope = terrain.slopeAt(x, z);
    if (y < 0.8 || slope > 0.6) continue;              // no props in the sea or on cliffs
    if (terrain.padFactor(x, z) > 0.3) continue;       // and none in the town
    const tree = rng.chance(0.62) && slope < 0.35;
    const h = tree ? rng.range(4.5, 9.5) : rng.range(0.5, 1.9);
    const w = tree ? rng.range(0.35, 0.6) : h * rng.range(0.7, 1.3);
    const yaw = rng.range(0, Math.PI * 2);
    out.push({
      pos: [x, y + h / 2, z],
      yaw, pitch: 0,
      scale: [w, h, w],
      albedo: tree ? [0.10, 0.07, 0.05] : [0.21, 0.20, 0.19],
      tex: tree ? MAT.BARK : MAT.ROCK,
      radius: w * 0.7,
      spin: 0,
    });
    if (tree) {
      // A canopy, because a trunk on its own reads as a telegraph pole. It
      // carries no collision radius: you walk under a tree, not into it.
      const cw = rng.range(2.6, 4.4);
      out.push({
        pos: [x, y + h * 0.86, z],
        yaw: yaw * 0.6, pitch: 0,
        scale: [cw, rng.range(2.4, 3.6), cw],
        albedo: [0.09 + rng.range(0, 0.03), 0.145 + rng.range(0, 0.045), 0.06],
        tex: MAT.FOLIAGE,
        spin: 0,
      });
    }
  }
  return out;
}

/**
 * Ground clutter: grass tufts, ferns and stones, thick near the player and
 * gone by forty metres.
 *
 * This is the cheapest large visual gain available to a world made of boxes.
 * Bare shaded ground reads as a technical demo however good the shading is;
 * the same ground with something growing out of it reads as a place. The tufts
 * are instances of the same unit cube as everything else, so twelve hundred of
 * them cost nothing but a bigger buffer upload.
 */
export function clutter(terrain, around, radius = 30, count = 2600) {
  const rng = makeRng(hash(`clutter:${terrain.seed}:${Math.round(around[0] / 32)}:${Math.round(around[1] / 32)}`));
  const out = [];
  for (let i = 0; i < count * 2 && out.length < count; i++) {
    // Sampled in a disc around the player rather than a square, so the density
    // does not visibly change when you turn on the spot.
    const a = rng.range(0, Math.PI * 2);
    const r = Math.sqrt(rng()) * radius;
    const x = around[0] + Math.cos(a) * r, z = around[1] + Math.sin(a) * r;
    const y = terrain.heightAt(x, z);
    if (y < 0.6) continue;                             // nothing grows in the sea
    if (terrain.slopeAt(x, z) > 0.55) continue;        // nor on a cliff face
    if (terrain.padFactor(x, z) > 0.35) continue;      // nor through the cobbles
    // A tuft is short, wide and *lighter* than the ground it grows out of. The
    // first version was tall, narrow and darker, and the render gate
    // photographed a meadow of tombstones: at this scale a blade of grass has
    // to read as a highlight on the ground, not as a silhouette against it.
    const stone = rng.chance(0.05);
    const h = stone ? rng.range(0.10, 0.22) : rng.range(0.11, 0.24);
    const w = stone ? h * rng.range(1.4, 2.2) : rng.range(0.22, 0.42);
    out.push({
      pos: [x, y + h / 2, z],
      yaw: rng.range(0, Math.PI * 2), pitch: stone ? 0 : rng.range(-0.16, 0.16),
      scale: [w, h, w * rng.range(0.18, 0.42)],
      albedo: stone
        ? [0.20, 0.19, 0.18]
        : [0.15 + rng.range(0, 0.05), 0.24 + rng.range(0, 0.09), 0.08 + rng.range(0, 0.04)],
      tex: stone ? MAT.ROCK : MAT.FOLIAGE,
      // Marked so the renderer sways it. Stones do not sway.
      sway: stone ? 0 : 1,
    });
  }
  return out;
}

const smooth01 = (t) => {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
};
