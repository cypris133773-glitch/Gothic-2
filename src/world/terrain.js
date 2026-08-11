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

export const TERRAIN_SIZE = 256;      // metres across, centred on the origin
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

  return { seed, heightAt, normalAt, slopeAt, size: TERRAIN_SIZE };
}

/**
 * Build a renderable mesh for one square patch. Called per chunk; at M2 there
 * are nine chunks around the player and no LOD yet, which is honest about what
 * has been built rather than pretending at a clipmap that has not.
 */
export function buildChunk(terrain, cx, cz, chunkSize, res) {
  const verts = new Float32Array((res + 1) * (res + 1) * 9);   // pos, normal, colour
  const index = new Uint32Array(res * res * 6);
  const step = chunkSize / res;
  const n = new Float32Array(3);
  let v = 0;
  for (let j = 0; j <= res; j++) {
    for (let i = 0; i <= res; i++) {
      const x = cx + i * step, z = cz + j * step;
      const y = terrain.heightAt(x, z);
      terrain.normalAt(n, x, z);
      verts[v++] = x; verts[v++] = y; verts[v++] = z;
      verts[v++] = n[0]; verts[v++] = n[1]; verts[v++] = n[2];
      // Colour by slope and altitude: grass on the flat, rock where it is
      // steep, and a paler band down at the shore. This is the whole material
      // system until M4, and it is enough for the land to read as land.
      const slope = Math.acos(Math.min(1, n[1]));
      const rock = smooth01((slope - 0.55) / 0.35);
      // The sand band is keyed to sea level and is narrow. The first version
      // faded it out over the first 2.6 m of altitude, which put the whole
      // settlement pad — which sits at 1.2 m — under beach sand, and the render
      // gate photographed a village built on a salt flat.
      const shore = 1 - smooth01((y - SEA_LEVEL) / 1.1);
      const gr = [0.19, 0.25, 0.12], rk = [0.31, 0.29, 0.27], sh = [0.42, 0.39, 0.31];
      for (let c = 0; c < 3; c++) {
        const base = gr[c] * (1 - rock) + rk[c] * rock;
        verts[v++] = base * (1 - shore) + sh[c] * shore;
      }
    }
  }
  let k = 0;
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const a = j * (res + 1) + i, b = a + 1, c = a + res + 1, d = c + 1;
      index[k++] = a; index[k++] = c; index[k++] = b;
      index[k++] = b; index[k++] = c; index[k++] = d;
    }
  }
  return { verts, index };
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
    const tree = rng.chance(0.62) && slope < 0.35;
    const h = tree ? rng.range(4.5, 9.5) : rng.range(0.5, 1.9);
    const w = tree ? rng.range(0.35, 0.6) : h * rng.range(0.7, 1.3);
    const yaw = rng.range(0, Math.PI * 2);
    out.push({
      pos: [x, y + h / 2, z],
      yaw, pitch: 0,
      scale: [w, h, w],
      albedo: tree ? [0.15, 0.10, 0.07] : [0.30, 0.29, 0.27],
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
        albedo: [0.13 + rng.range(0, 0.04), 0.20 + rng.range(0, 0.06), 0.09],
        spin: 0,
      });
    }
  }
  return out;
}

const smooth01 = (t) => {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
};
