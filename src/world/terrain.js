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
import { REGIONS, DEFAULT_REGION, region as regionOf, VERATH_GATE_APRON, VERATH_HARBOUR_APRON } from './regions.js';

export const SEA_LEVEL = 0;           // y = 0 is the waterline, everywhere

// The island's numbers, re-exported so the code that only ever knew about one
// region keeps working. `createTerrain(seed, 'cleftvale')` is how you get the
// other one; everything below is written against whichever region it was given.
export const TERRAIN_SIZE = REGIONS[DEFAULT_REGION].size;
export const PLACES = REGIONS[DEFAULT_REGION].places;
export const ROADS = REGIONS[DEFAULT_REGION].roads;
export const GATE_APRON = VERATH_GATE_APRON;
export const HARBOUR_APRON = VERATH_HARBOUR_APRON;

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

/**
 * How wide the shoulder has to be to make up a cut of `drop` metres.
 *
 * One in three is roughly the angle loose earth stands at. The cap is a
 * backstop against a pathological design: past it the ground simply meets the
 * noise at whatever slope it can manage, which is a cliff, and a cliff is a
 * fine thing to have as long as no road is drawn across it.
 *
 * Two roads were drawn across one. The monastery shelf and the tower plateau
 * were authored at twenty-two and twenty-six metres over ground the noise puts
 * at eight to fourteen, so their flanks needed sixty metres of batter, hit the
 * cap, and the last stretch of both approaches came out at twenty-five degrees.
 * Widening the cap alone was not the answer — the answer was that the two
 * landmarks were simply too high for the island they stand on. They are twelve
 * and fifteen now, which is still a shelf and still a plateau, and the height
 * that was lost is in the bell tower and the spines instead, where it shows.
 */
function batter(drop) {
  return Math.min(Math.abs(drop) * 3.0, 45);
}

/** Distance from a point to a segment, and the fraction along it. */
function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz || 1;
  let t = ((px - ax) * dx + (pz - az) * dz) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { d: Math.hypot(px - (ax + dx * t), pz - (az + dz * t)), t };
}

export function createTerrain(seed = 1, regionName = DEFAULT_REGION) {
  const R = regionOf(regionName);
  const s = hash(`terrain:${seed}:${R.name}`) & 0xffff;
  const HALF = R.size / 2;
  const PLACE_LIST = Object.values(R.places).map((p) => ({
    ...p, rx: p.w || p.r, rz: p.r, rmin: Math.min(p.w || p.r, p.r),
  }));

  /**
   * Road segments, flattened and with their endpoint heights resolved once.
   *
   * `heightAt` is called something like seven hundred thousand times to build
   * the chunks around the player, and the first version worked out which place
   * each segment's endpoints belonged to *inside* that loop — ten distance
   * checks per endpoint, two endpoints per segment, fourteen segments, every
   * sample. Building the world took three seconds. The endpoints are constants;
   * resolving them here costs a hundred microseconds once.
   */
  const SEGMENTS = [];
  for (const road of R.roads) {
    for (let i = 0; i < road.points.length - 1; i++) {
      const [ax, az] = road.points[i], [bx, bz] = road.points[i + 1];
      SEGMENTS.push({
        ax, az, bx, bz,
        crown: road.width * 0.55,
        base: road.width * 1.9,
        ha: road.levels ? road.levels[i] : nearestPlaceLevel(ax, az),
        hb: road.levels ? road.levels[i + 1] : nearestPlaceLevel(bx, bz),
      });
    }
  }

  /**
   * How much this point is flattened, and to what height.
   *
   * Two things make this work, and both were learned from a failing test.
   *
   * **Influences are blended, not competed.** The first version took whichever
   * control had the greatest weight and used its level outright. That is
   * discontinuous wherever two controls of different heights cross over: the
   * winner changes in the space of one sample and the ground steps. A weighted
   * average with a cubed weight keeps the strongest influence dominant while
   * making the handover smooth.
   *
   * **The batter widens with the cut.** A road that has to make up twenty-five
   * metres of hillside cannot do it inside its own eight-metre shoulder — that
   * is not an embankment, it is a wall. So the falloff distance grows with the
   * height difference at a slope of about one in three, exactly as a real cut
   * and fill does, and the cliff goes away without the road getting wider.
   *
   * @param base the *uncontrolled* height here, which is what the cut is measured against
   */
  function control(x, z, base) {
    let sum = 0, acc = 0, weight = 0;
    const add = (w, level) => {
      if (w <= 0) return;
      const k = w * w * w;
      sum += k; acc += k * level;
      if (w > weight) weight = w;
    };
    // Pass one: the places. Their blended level and their strongest claim on
    // this point are both needed before any road is considered.
    let psum = 0, pacc = 0, claim = 0;
    for (const p of PLACE_LIST) {
      // City pads are oblong (a harbour town is longer than it is wide); the
      // rest are round, and distance is measured in units of the radius.
      const d = Math.hypot((x - p.at[0]) / p.rx, (z - p.at[1]) / p.rz);
      const band = 0.72 + batter(p.level - base) / p.rmin;
      if (d > 0.72 + band) continue;
      const w = 1 - smooth01((d - 0.72) / band);
      if (w <= 0) continue;
      const k = w * w * w;
      psum += k; pacc += k * p.level;
      if (w > claim) claim = w;
      add(w, p.level);
    }
    const plevel = psum > 0 ? pacc / psum : 0;

    // Pass two: the roads.
    //
    // They are *not* dragged toward whatever place claims the ground under
    // them. That was tried, on the reasoning that a lane entering a place
    // should be at the height of the place — and it made the worst gradient on
    // the island half again as bad, because the pad's weight falls off on a
    // smoothstep and a road whose level tracks that weight inherits the whole
    // flank as its own slope. What actually fixes the disagreement is the road
    // and the pad agreeing in the data: a road that ends at a place carries a
    // vertex on that place's rim, already at the place's height.
    for (const g of SEGMENTS) {
      const { d, t } = distToSegment(x, z, g.ax, g.az, g.bx, g.bz);
      // The road's own height is interpolated between the two places it joins,
      // so a lane climbing to the monastery actually climbs.
      const level = g.ha + (g.hb - g.ha) * t;
      const band = g.base + batter(level - base);
      if (d > g.crown + band) continue;
      add((1 - smooth01((d - g.crown) / band)) * 0.9, level);
    }
    return { weight, level: sum > 0 ? acc / sum : 0 };
  }

  /** The height of whatever place is nearest a road's endpoint. */
  function nearestPlaceLevel(x, z) {
    let best = null, bestD = Infinity;
    for (const p of PLACE_LIST) {
      const d = Math.hypot(x - p.at[0], z - p.at[1]);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best ? best.level : 2;
  }

  /** The ground as the noise made it, before anybody built a road on it. */
  function baseHeight(x, z) {
    // Large-scale relief, then a medium band for hillocks, then fine detail.
    const relief = fbm(s, x * 0.0045, z * 0.0045, 4) * R.relief;
    const hills = fbm(s + 31, x * 0.021, z * 0.021, 3) * R.hills;
    const detail = fbm(s + 57, x * 0.13, z * 0.13, 2) * R.detail;
    const h = relief + hills + detail + R.floor;

    // At the edge of the playable area the ground leaves rather than stopping:
    // on the island it falls away to a coast, in the valley it *rises* into the
    // ridges that make it a valley. A negative `edge` is the second case, and
    // it is why the boundary is never a wall you can see the end of.
    const edge = Math.max(Math.abs(x), Math.abs(z)) / HALF;
    return h - smooth01((edge - R.edgeStart) / (1 - R.edgeStart)) * R.edge;
  }

  function heightAt(x, z) {
    const h = baseHeight(x, z);
    const c = control(x, z, h);
    return h * (1 - c.weight) + c.level * c.weight;
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

  /** How built-up this point is: 1 in a square, 0 in a wood. */
  const padFactor = (x, z) => control(x, z, baseHeight(x, z)).weight;

  return {
    seed, heightAt, normalAt, slopeAt, padFactor,
    region: R.name, title: R.title, water: R.water,
    ground: R.ground, flora: R.flora,
    places: R.places, roads: R.roads, size: R.size, arrive: R.arrive, exits: R.exits || [],
  };
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
    // A shoreline is only a shoreline where there is a sea. In the valley the
    // low ground is a valley floor, and bleaching it into sand was the clearest
    // sign that both regions were being painted by one hardcoded palette.
    const shore = terrain.water ? 1 - smooth01((y - SEA_LEVEL) / 1.1) : 0;
    const G = terrain.ground;
    const gr = G.grass, rk = G.rock, sh = G.shore;
    const paved = smooth01((terrain.padFactor(x, z) - 0.45) / 0.35);
    const grain = 0.86 + fbm(1, x * 2.7, z * 2.7, 2) * 0.34;
    const cob = [G.paved[0] * grain, G.paved[1] * grain, G.paved[2] * grain];
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
    const F = terrain.flora;
    const tree = rng.chance(F.treeChance) && slope < 0.35;
    const h = tree ? rng.range(F.height[0], F.height[1]) : rng.range(0.5, 1.9);
    const w = tree ? rng.range(0.35, 0.6) : h * rng.range(0.7, 1.3);
    const yaw = rng.range(0, Math.PI * 2);
    out.push({
      pos: [x, y + h / 2, z],
      yaw, pitch: 0,
      scale: [w, h, w],
      albedo: tree ? F.trunk : terrain.ground.rock,
      tex: tree ? MAT.BARK : MAT.ROCK,
      radius: w * 0.7,
      spin: 0,
    });
    if (tree) {
      // A canopy, because a trunk on its own reads as a telegraph pole. It
      // carries no collision radius: you walk under a tree, not into it.
      //
      // A dead tree gets a small, thin, grey one instead of none at all: a bare
      // pole reads as scaffolding, and a stripped crown reads as a dead tree.
      const cw = F.dead ? rng.range(1.1, 2.0) : rng.range(2.6, 4.4);
      out.push({
        pos: [x, y + h * (F.dead ? 0.92 : 0.86), z],
        yaw: yaw * 0.6, pitch: 0,
        scale: [cw, F.dead ? rng.range(0.9, 1.6) : rng.range(2.4, 3.6), cw],
        albedo: [
          F.canopy[0] + rng.range(0, F.canopySpread[0]),
          F.canopy[1] + rng.range(0, F.canopySpread[1]),
          F.canopy[2] + rng.range(0, F.canopySpread[2]),
        ],
        tex: F.dead ? MAT.BARK : MAT.FOLIAGE,
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
        ? terrain.ground.rock
        : [
          terrain.flora.tuft[0] + rng.range(0, 0.05),
          terrain.flora.tuft[1] + rng.range(0, 0.09),
          terrain.flora.tuft[2] + rng.range(0, 0.04),
        ],
      tex: stone ? MAT.ROCK : (terrain.flora.dead ? MAT.DIRT : MAT.FOLIAGE),
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
