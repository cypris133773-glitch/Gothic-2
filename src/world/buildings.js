// Half-timbered buildings, from a small grammar.
//
// A house is: a stone base, a plaster ground floor, an upper floor that
// overhangs it, a lattice of dark timber across the plaster, a steep gabled
// roof, a door and some windows. That description is the generator — thirty to
// fifty boxes, laid out in the building's local frame and then rotated into the
// world as a unit, which is why a street of them can be placed by writing down
// a position and an angle.
//
// The overhang ("jetty") and the steep roof are what make the silhouette read
// as Northern-European medieval rather than as a shed. They are worth the eight
// lines they cost.

import { makeRng, hash } from '../core/rng.js';
import { MAT } from '../assets/texgen.js';

// Albedos, not screen colours: these are multiplied by a sun of about 2.6 and
// then exposed and tonemapped, so a "white" plaster wall is authored at 0.55
// and arrives on screen as a warm off-white. Authoring them at the value they
// should *look* is what produced a town in a snowstorm.
const PALETTES = [
  { plaster: [0.55, 0.51, 0.43], timber: [0.11, 0.08, 0.055], roof: [0.15, 0.14, 0.16], stone: [0.30, 0.29, 0.27] },
  { plaster: [0.48, 0.45, 0.38], timber: [0.09, 0.065, 0.05], roof: [0.19, 0.13, 0.11], stone: [0.28, 0.27, 0.26] },
  { plaster: [0.58, 0.53, 0.44], timber: [0.13, 0.09, 0.065], roof: [0.13, 0.14, 0.17], stone: [0.31, 0.30, 0.28] },
];

/**
 * @param {object} spec { x, z, ground, yaw, w, d, storeys, seed }
 * @returns {Array} boxes, ready for the scene
 */
export function buildHouse(spec) {
  const rng = makeRng(hash(`house:${spec.x}:${spec.z}:${spec.seed || 0}`));
  const pal = rng.pick(PALETTES);
  const w = spec.w ?? rng.range(5.5, 8.0);        // along local X (the ridge)
  const d = spec.d ?? rng.range(4.5, 6.5);        // along local Z
  const storeys = spec.storeys ?? (rng.chance(0.55) ? 2 : 1);
  const storeyH = 2.5;
  const yaw = spec.yaw ?? 0;
  const y0 = spec.ground;
  const out = [];

  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  /** Place a box given in the building's local frame. */
  const put = (lx, ly, lz, sx, sh, sz, albedo, pitch = 0, tex = MAT.PLASTER) => {
    out.push({
      pos: [spec.x + lx * cy + lz * sy, y0 + ly, spec.z - lx * sy + lz * cy],
      yaw, pitch, scale: [sx, sh, sz], albedo, tex,
      radius: 0,          // buildings collide as walls, added at the end
    });
  };

  // --- stone base ------------------------------------------------------------
  put(0, 0.28, 0, w + 0.35, 0.56, d + 0.35, pal.stone, 0, MAT.ROCK);

  for (let s = 0; s < storeys; s++) {
    // Each storey above the first juts out a little over the one below it.
    const jetty = s === 0 ? 0 : 0.32;
    const sw = w + jetty * 2, sd = d + jetty * 2;
    const base = 0.56 + s * storeyH;

    put(0, base + storeyH / 2, 0, sw, storeyH, sd, pal.plaster);

    // Timber: corner posts, a sill and a head rail on each face, and a pair of
    // diagonal braces. Laid on the outside of the plaster so they read as
    // structure rather than as paint.
    const t = 0.17;
    for (const ex of [-1, 1]) {
      put(ex * sw / 2, base + storeyH / 2, 0, t, storeyH, sd + 0.02, pal.timber, 0, MAT.TIMBER);
    }
    for (const ez of [-1, 1]) {
      put(0, base + storeyH / 2, ez * sd / 2, sw + 0.02, storeyH, t, pal.timber, 0, MAT.TIMBER);
      // rails
      put(0, base + 0.10, ez * sd / 2, sw + 0.04, t, t * 1.1, pal.timber, 0, MAT.TIMBER);
      put(0, base + storeyH - 0.10, ez * sd / 2, sw + 0.04, t, t * 1.1, pal.timber, 0, MAT.TIMBER);
      // uprights across the face
      const bays = Math.max(2, Math.round(sw / 1.8));
      for (let b = 1; b < bays; b++) {
        const lx = -sw / 2 + (sw * b) / bays;
        put(lx, base + storeyH / 2, ez * sd / 2, t, storeyH, t * 1.1, pal.timber, 0, MAT.TIMBER);
      }
      // one diagonal brace per face, tilted in the plane of the wall
      const brace = Math.hypot(sw / bays, storeyH) * 0.9;
      out.push({
        pos: [
          spec.x + (-sw / 4) * cy + (ez * sd / 2) * sy,
          y0 + base + storeyH / 2,
          spec.z - (-sw / 4) * sy + (ez * sd / 2) * cy,
        ],
        yaw, pitch: 0, roll: 0.55 * ez,
        scale: [t, brace, t * 1.1], albedo: pal.timber, tex: MAT.TIMBER, radius: 0,
      });
    }
    for (const ex of [-1, 1]) {
      put(ex * sw / 2, base + 0.10, 0, t * 1.1, t, sd + 0.04, pal.timber, 0, MAT.TIMBER);
      put(ex * sw / 2, base + storeyH - 0.10, 0, t * 1.1, t, sd + 0.04, pal.timber, 0, MAT.TIMBER);
    }

    // --- openings ------------------------------------------------------------
    const winH = 0.85, winW = 0.75;
    const windows = Math.max(2, Math.round(sw / 2.4));
    for (let i = 0; i < windows; i++) {
      const lx = -sw / 2 + (sw * (i + 0.5)) / windows;
      for (const ez of [-1, 1]) {
        // A dark opening with a lighter frame; the frame is what stops a window
        // reading as a hole punched in a wall.
        put(lx, base + storeyH * 0.58, ez * (sd / 2 + 0.03), winW + 0.14, winH + 0.14, 0.06, pal.timber, 0, MAT.TIMBER);
        put(lx, base + storeyH * 0.58, ez * (sd / 2 + 0.06), winW, winH, 0.05, [0.10, 0.11, 0.13], 0, MAT.FLAT);
      }
    }
    if (s === 0) {
      // The door, on the +Z face, with a plank texture implied by two boards.
      put(0, 1.05, d / 2 + 0.08, 1.05, 2.0, 0.10, [0.16, 0.11, 0.07], 0, MAT.PLANK);
      put(-0.22, 1.05, d / 2 + 0.13, 0.16, 1.9, 0.04, pal.timber, 0, MAT.TIMBER);
      put(0.22, 1.05, d / 2 + 0.13, 0.16, 1.9, 0.04, pal.timber, 0, MAT.TIMBER);
      put(0, 2.12, d / 2 + 0.10, 1.35, 0.16, 0.30, pal.timber, 0, MAT.TIMBER);   // lintel
    }
  }

  // --- roof ------------------------------------------------------------------
  // Two slabs meeting at a ridge running along local X, at 49° — steep is the
  // whole look, and the first attempt got the trigonometry inside out, which
  // laid the slabs nearly flat and left the plaster gable ends standing up as
  // two big white rectangles where the roof should have been.
  //
  //   ridge height above the eaves = (depth / 2) · tan θ
  //   slab length along the slope  = (depth / 2) / cos θ
  //   a slab tilts about local X, and a positive pitch drops its +Z end
  const eaves = 0.56 + storeys * storeyH;
  const rw = w + (storeys > 1 ? 0.64 : 0) + 0.9;
  const rd = d + (storeys > 1 ? 0.64 : 0) + 0.7;
  const theta = 0.86;
  const rise = (rd / 2) * Math.tan(theta);
  const slabLen = (rd / 2) / Math.cos(theta);
  const ridgeH = eaves + rise;
  for (const ez of [-1, 1]) {
    out.push({
      pos: [
        spec.x + (ez * rd / 4) * sy,
        y0 + eaves + rise / 2,
        spec.z + (ez * rd / 4) * cy,
      ],
      yaw, pitch: ez * theta,
      scale: [rw, 0.18, slabLen], albedo: pal.roof, tex: MAT.SLATE, radius: 0,
    });
  }
  put(0, ridgeH + 0.06, 0, rw + 0.14, 0.20, 0.30, pal.roof, 0, MAT.SLATE);   // ridge cap

  // The gable triangles, approximated by four stacked courses. A single box
  // would be a rectangle, which is exactly what was wrong before.
  for (const ex of [-1, 1]) {
    const courses = 4;
    for (let c = 0; c < courses; c++) {
      const t0 = c / courses, t1 = (c + 1) / courses;
      const yMid = eaves + rise * (t0 + t1) / 2;
      const depth = rd * (1 - (t0 + t1) / 2) * 0.94;
      put(ex * (rw / 2 - 0.16), yMid, 0, 0.20, rise / courses + 0.02, depth, pal.plaster);
    }
  }

  // --- collision -------------------------------------------------------------
  // The footprint, as an oriented rectangle rather than the circle this used to
  // be. A circle around a house makes its corners solid air, its walls passable
  // at the middle of each face, and the gap between two neighbours impassable.
  const jetty = storeys > 1 ? 0.64 : 0;
  out.push({
    pos: [spec.x, y0 + (eaves / 2), spec.z], yaw, pitch: 0,
    scale: [0.01, eaves, 0.01], albedo: [0, 0, 0],
    box: [w + jetty, d + jetty], invisible: true,
  });

  return out;
}

/** A well: a stone ring, two posts, a roof and a bucket. */
export function buildWell(x, z, ground) {
  const stone = [0.32, 0.31, 0.29], wood = [0.19, 0.14, 0.09], roof = [0.15, 0.14, 0.15];
  return [
    { pos: [x, ground + 0.45, z], yaw: 0.4, pitch: 0, scale: [2.2, 0.9, 2.2], albedo: stone, tex: MAT.COBBLE, radius: 1.2 },
    { pos: [x, ground + 0.95, z], yaw: 0.4, pitch: 0, scale: [1.7, 0.2, 1.7], albedo: [0.12, 0.13, 0.15] },
    { pos: [x - 0.85, ground + 1.9, z], yaw: 0, pitch: 0, scale: [0.18, 2.0, 0.18], albedo: wood, tex: MAT.TIMBER },
    { pos: [x + 0.85, ground + 1.9, z], yaw: 0, pitch: 0, scale: [0.18, 2.0, 0.18], albedo: wood, tex: MAT.TIMBER },
    { pos: [x, ground + 2.9, z - 0.55], yaw: 0, pitch: 0.7, scale: [2.4, 0.12, 1.5], albedo: roof, tex: MAT.SLATE },
    { pos: [x, ground + 2.9, z + 0.55], yaw: 0, pitch: -0.7, scale: [2.4, 0.12, 1.5], albedo: roof, tex: MAT.SLATE },
    { pos: [x, ground + 2.55, z], yaw: 0, pitch: 0, scale: [1.9, 0.14, 0.16], albedo: wood },
    { pos: [x, ground + 1.65, z], yaw: 0.3, pitch: 0, scale: [0.4, 0.42, 0.4], albedo: [0.32, 0.22, 0.14] },
  ];
}

/** A market stall: a counter, four posts and a striped awning. */
export function buildStall(x, z, ground, yaw, seed = 0) {
  const rng = makeRng(hash(`stall:${x}:${z}:${seed}`));
  const wood = [0.23, 0.16, 0.10];
  const cloth = rng.pick([[0.38, 0.12, 0.11], [0.14, 0.19, 0.31], [0.40, 0.33, 0.15]]);
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const put = (lx, ly, lz, sx, sh, sz, albedo, pitch = 0, radius = 0, tex = MAT.PLANK) => ({
    pos: [x + lx * cy + lz * sy, ground + ly, z - lx * sy + lz * cy],
    yaw, pitch, scale: [sx, sh, sz], albedo, radius, tex,
  });
  const out = [
    put(0, 0.55, 0, 2.6, 0.16, 1.1, wood),
    put(0, 0.28, 0, 2.4, 0.55, 0.9, [0.18, 0.13, 0.08], 0, 1.2),
  ];
  for (const ex of [-1, 1]) for (const ez of [-1, 1]) {
    out.push(put(ex * 1.2, 1.1, ez * 0.5, 0.10, 2.2, 0.10, wood));
  }
  out.push(put(0, 2.28, 0, 2.9, 0.10, 1.5, cloth, 0.18, 0, MAT.CLOTH));
  // Goods on the counter, because an empty stall reads as scenery.
  for (let i = 0; i < 4; i++) {
    out.push(put(-0.9 + i * 0.6, 0.75, rng.range(-0.2, 0.2), 0.3, 0.24, 0.3,
      rng.pick([[0.33, 0.22, 0.08], [0.20, 0.25, 0.11], [0.36, 0.29, 0.14]])));
  }
  return out;
}

/**
 * A curtain wall with towers and gates.
 *
 * The wall is the most important piece of level design on the island: it is
 * what makes the city a place you are let into rather than a cluster of houses
 * you wander through. It is built as a ring of segments so a gate can be put on
 * whichever side a road arrives from, and the merlons are a separate row of
 * small boxes because a flat-topped wall reads as a fence.
 *
 * `groundAt(x, z)` is optional and is how a wall follows a hillside rather than
 * hovering at one end and burying itself at the other. Ring geometry over
 * non-flat ground without it is the single most obvious tell of a generated
 * town, so the cloister wall on the temple shelf passes one too.
 */
export function buildWall(spec) {
  const { x, z, ground, rx, rz, gateAngle, height = 6.5, segments = 40 } = spec;
  const groundAt = spec.groundAt || (() => ground);
  // A city has more than one way in — a harbour gate and a land gate at the
  // least — so the ring takes a list. `gateAngle` is the one-gate spelling and
  // is kept because the monastery cloister only ever wants one.
  const gates = spec.gates || [gateAngle ?? 0];
  const stone = [0.30, 0.29, 0.27], dark = [0.22, 0.21, 0.20];
  const out = [];
  const gateWidth = 0.16;                       // as a fraction of the ring

  /** Angular distance from this point on the ring to the nearest gate. */
  const toGate = (a) => {
    let best = Math.PI;
    for (const g of gates) {
      let d = a - g;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      best = Math.min(best, Math.abs(d));
    }
    return best;
  };

  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    // Leave a hole where a gate goes.
    const da = toGate(a0);
    const inGate = da < gateWidth;

    const px = x + Math.cos(a0) * rx, pz = z + Math.sin(a0) * rz;
    const qx = x + Math.cos(a1) * rx, qz = z + Math.sin(a1) * rz;
    const mx = (px + qx) / 2, mz = (pz + qz) / 2;
    const len = Math.hypot(qx - px, qz - pz) * 1.06;
    const yaw = Math.atan2(qx - px, qz - pz);
    // Sunk half a metre, so a segment on a slope has no daylight under its
    // low corner.
    const gy = groundAt(mx, mz) - 0.5;

    if (!inGate) {
      out.push({
        pos: [mx, gy + height / 2, mz], yaw, pitch: 0,
        scale: [1.5, height, len], albedo: stone, tex: MAT.ROCK,
        box: [1.5, len],
      });
      // Merlons: alternate blocks along the top.
      if (i % 2 === 0) {
        out.push({
          pos: [mx, gy + height + 0.45, mz], yaw, pitch: 0,
          scale: [1.7, 0.9, len * 0.55], albedo: dark, tex: MAT.ROCK,
        });
      }
    } else {
      // The gate: a lintel and a raised portcullis over the hole, so the
      // opening reads as a gate rather than as a gap where the wall failed.
      // Neither carries a collider: this is the way through.
      out.push({
        pos: [mx, gy + height + 1.0, mz], yaw, pitch: 0,
        scale: [2.2, 2.0, len * 1.1], albedo: stone, tex: MAT.ROCK,
      });
      out.push({
        pos: [mx, gy + height * 0.9, mz], yaw, pitch: 0,
        scale: [1.0, 1.6, len * 0.9], albedo: [0.16, 0.12, 0.08], tex: MAT.PLANK,
      });
    }

    // A tower every eighth segment, and always beside a gate — but never *in*
    // one, which the single-gate version used to do: the flanking test included
    // the hole, so every gate had a drum standing in the middle of it.
    if (!inGate && (i % 8 === 0 || da < gateWidth * 2.4)) {
      const ty = groundAt(px, pz) - 0.5;
      out.push({
        pos: [px, ty + height * 0.75, pz], yaw: a0, pitch: 0,
        scale: [3.4, height * 1.5, 3.4], albedo: stone, tex: MAT.ROCK,
        radius: 1.9,
      });
      out.push({
        pos: [px, ty + height * 1.5 + 0.5, pz], yaw: a0, pitch: 0,
        scale: [4.0, 0.5, 4.0], albedo: dark, tex: MAT.ROCK,
      });
    }
  }
  return out;
}

/** A farm: a longhouse, a barn, a fence and a field of furrows. */
export function buildFarm(x, z, ground, yaw, seed = 0) {
  const rng = makeRng(hash(`farm:${x}:${z}:${seed}`));
  const out = buildHouse({ x, z, ground, yaw, w: 9, d: 6, storeys: 1, seed });
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const put = (lx, lz, sx, sh, sz, albedo, tex, radius = 0, pitch = 0) => out.push({
    pos: [x + lx * cy + lz * sy, ground + sh / 2, z - lx * sy + lz * cy],
    yaw, pitch, scale: [sx, sh, sz], albedo, tex, radius,
  });

  // The barn: bigger, cruder, thatched.
  put(13, 2, 8, 4.2, 7, [0.26, 0.19, 0.13], MAT.PLANK, 4.4);
  out.push({
    pos: [x + 13 * cy + 2 * sy, ground + 5.2, z - 13 * sy + 2 * cy],
    yaw, pitch: 0, scale: [9, 1.4, 8], albedo: [0.38, 0.31, 0.16], tex: MAT.THATCH,
  });

  // A fence around the yard, and a field of furrows behind it.
  for (let i = -5; i <= 5; i++) {
    put(i * 2.4, -9, 0.16, 1.1, 0.16, [0.22, 0.16, 0.10], MAT.TIMBER);
    put(i * 2.4, -8.9, 2.3, 0.12, 0.1, [0.22, 0.16, 0.10], MAT.TIMBER);
  }
  for (let f = 0; f < 11; f++) {
    put(-13 + f * 1.4, 12, 0.75, 0.14, 15, [0.17, 0.13, 0.09], MAT.DIRT);
  }
  // Something to steal, because a farm with nothing on it is scenery.
  put(-6, 3, 0.8, 0.9, 0.8, [0.30, 0.22, 0.12], MAT.PLANK, 0.5);
  return out;
}

/** The necromancer's tower: a black drum on a plateau, and nothing friendly. */
export function buildTower(x, z, ground) {
  const dark = [0.13, 0.12, 0.14], iron = [0.17, 0.16, 0.17];
  const out = [];
  const H = 22;
  for (let i = 0; i < 6; i++) {
    const w = 7.5 - i * 0.55;
    out.push({
      pos: [x, ground + 1.5 + i * (H / 6), z], yaw: i * 0.16, pitch: 0,
      scale: [w, H / 6 + 0.1, w], albedo: dark, tex: MAT.ROCK,
      radius: i === 0 ? 4.2 : 0,
    });
  }
  out.push({ pos: [x, ground + H + 2.2, z], yaw: 0.4, pitch: 0, scale: [8.6, 1.0, 8.6], albedo: iron, tex: MAT.ROCK });
  // Four spines, because the silhouette is the whole point of a landmark.
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    out.push({
      pos: [x + dx * 3.6, ground + H + 4.4, z + dz * 3.6], yaw: 0, pitch: dz * 0.3, roll: dx * 0.3,
      scale: [0.5, 4.5, 0.5], albedo: iron, tex: MAT.ROCK,
    });
  }
  out.push({ pos: [x, ground + 2.2, z + 4.3], yaw: 0, pitch: 0, scale: [1.6, 3.0, 0.4], albedo: [0.08, 0.07, 0.09], tex: MAT.FLAT });
  return out;
}

/** A lighthouse on a headland. Tall, pale, and visible from most of the map. */
export function buildLighthouse(x, z, ground) {
  const pale = [0.42, 0.41, 0.38], band = [0.34, 0.14, 0.12];
  const out = [];
  const H = 26;
  for (let i = 0; i < 8; i++) {
    const w = 6.2 - i * 0.5;
    out.push({
      pos: [x, ground + 1.2 + i * (H / 8), z], yaw: 0, pitch: 0,
      scale: [w, H / 8 + 0.1, w], albedo: i % 2 ? band : pale, tex: MAT.ROCK,
      radius: i === 0 ? 3.4 : 0,
    });
  }
  out.push({ pos: [x, ground + H + 1.6, z], yaw: 0, pitch: 0, scale: [4.4, 2.4, 4.4], albedo: [0.10, 0.11, 0.13], tex: MAT.FLAT });
  out.push({ pos: [x, ground + H + 3.2, z], yaw: 0, pitch: 0, scale: [5.2, 0.6, 5.2], albedo: [0.20, 0.19, 0.18], tex: MAT.ROCK });
  return out;
}

/** The monastery: a hall, a cloister wall and a bell tower above the lake. */
export function buildMonastery(x, z, ground, seed = 0, groundAt = null) {
  const stone = [0.34, 0.32, 0.29], roof = [0.17, 0.15, 0.17];
  const out = [];
  // The hall.
  out.push({ pos: [x, ground + 4, z], yaw: 0, pitch: 0, scale: [22, 8, 13], albedo: stone, tex: MAT.ROCK, box: [22, 13] });
  for (const ez of [-1, 1]) {
    out.push({
      pos: [x, ground + 9.4, z + ez * 3.4], yaw: 0, pitch: ez * 0.8,
      scale: [23, 0.5, 9], albedo: roof, tex: MAT.SLATE,
    });
  }
  // A row of arched openings, implied by dark inserts between piers.
  for (let i = -4; i <= 4; i++) {
    out.push({ pos: [x + i * 2.3, ground + 3.2, z + 6.6], yaw: 0, pitch: 0, scale: [1.1, 3.4, 0.4], albedo: [0.09, 0.09, 0.10], tex: MAT.FLAT });
  }
  // The bell tower.
  out.push({ pos: [x + 14, ground + 9, z - 2], yaw: 0.2, pitch: 0, scale: [6.4, 18, 6.4], albedo: stone, tex: MAT.ROCK, radius: 3.6 });
  out.push({ pos: [x + 14, ground + 19.4, z - 2], yaw: 0.2, pitch: 0, scale: [7.6, 1.2, 7.6], albedo: roof, tex: MAT.SLATE });
  // The cloister wall, low, with a gate facing the road.
  out.push(...buildWall({
    x, z, ground, groundAt, rx: 26, rz: 20,
    gateAngle: Math.PI / 2, height: 3.4, segments: 26,
  }));
  return out;
}

/**
 * The mouth of the Cleft: a barricade across the pass, and the two rock spurs
 * it is wedged between.
 *
 * This is a *door with no lock* — it can be walked round from the first hour,
 * and what stops you is what lives on the other side. That distinction is the
 * whole of pillar P2 and it is worth building the barricade to make the point
 * visible: the game says "not yet" with geometry and monsters, never with an
 * invisible wall.
 */
export function buildCleftGate(x, z, ground) {
  const rock = [0.19, 0.18, 0.17], timber = [0.20, 0.14, 0.09];
  const out = [];
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      out.push({
        pos: [x + s * (11 + i * 1.6), ground + 3 + i * 3.4, z + s * i * 1.2],
        yaw: s * 0.4 + i * 0.3, pitch: 0,
        scale: [9 - i * 1.8, 8 - i * 0.8, 9 - i * 1.8],
        albedo: rock, tex: MAT.ROCK, radius: i === 0 ? 4.5 : 0,
      });
    }
  }
  // The barricade itself: posts, two rails and a gap you can squeeze past.
  for (let i = -3; i <= 3; i++) {
    if (i === 0) continue;
    out.push({
      pos: [x + i * 2.6, ground + 1.3, z], yaw: 0.05 * i, pitch: 0,
      scale: [0.3, 2.6, 0.3], albedo: timber, tex: MAT.TIMBER, radius: 0.25,
    });
  }
  for (const h of [1.0, 1.9]) {
    out.push({
      pos: [x - 5.5, ground + h, z], yaw: 0, pitch: 0,
      scale: [7, 0.22, 0.22], albedo: timber, tex: MAT.TIMBER,
    });
    out.push({
      pos: [x + 5.5, ground + h, z], yaw: 0, pitch: 0,
      scale: [7, 0.22, 0.22], albedo: timber, tex: MAT.TIMBER,
    });
  }
  // A dead watch fire. Somebody stood here once.
  out.push({ pos: [x + 3.4, ground + 0.2, z + 4], yaw: 0.6, pitch: 0, scale: [1.8, 0.35, 1.8], albedo: [0.09, 0.08, 0.07], tex: MAT.ROCK });
  return out;
}
