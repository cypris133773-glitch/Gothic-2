// Materials, synthesised in code.
//
// There are no image files in this project and there never will be (§9.6), so
// every surface in the world comes out of this file: plaster, timber, slate,
// cobbles, grass, rock, cloth, steel, leather, skin, planks, thatch. Each is a
// 128×128 tile in one texture array, generated once at startup in about thirty
// milliseconds and cached nowhere because regenerating is cheaper than storing.
//
// The tiles are *detail*, not colour. Every one of them is authored around 1.0
// so it multiplies the instance's albedo rather than replacing it: the same
// plaster tile is a cream wall on one house and a grey one on the next, and a
// tabard and a banner share the cloth weave. That is what keeps a whole town
// inside one texture unit and one draw call.

export const MAT = {
  FLAT: 0,        // no detail — used by anything that should stay clean
  PLASTER: 1,
  TIMBER: 2,
  SLATE: 3,
  COBBLE: 4,
  GRASS: 5,
  ROCK: 6,
  CLOTH: 7,
  STEEL: 8,
  LEATHER: 9,
  PLANK: 10,
  THATCH: 11,
  SKIN: 12,
  BARK: 13,
  FOLIAGE: 14,
  DIRT: 15,
};
export const MAT_COUNT = 16;
export const TEX_SIZE = 128;

/** Deterministic value noise on a wrapping lattice, so every tile tiles. */
function noise(seed, x, y, period) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const h = (a, b) => {
    // Wrapping the lattice coordinates is what makes the tile seamless; without
    // it every surface in the game shows a grid at texture-repeat distance.
    a = ((a % period) + period) % period;
    b = ((b % period) + period) % period;
    let n = (a * 374761393 + b * 668265263 + seed * 1442695040) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function fbm(seed, x, y, period, octaves) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += noise(seed + o * 37, x * freq, y * freq, period * freq) * amp;
    norm += amp;
    amp *= 0.5; freq *= 2;
  }
  return sum / norm;
}

/**
 * Build the whole array as one Uint8Array of RGB(A) layers.
 * Values centre on 128 (= ×1.0 at shading time); a tile that averages far from
 * that will visibly darken or brighten every object wearing it.
 */
export function buildMaterialArray() {
  const S = TEX_SIZE;
  const data = new Uint8Array(S * S * 4 * MAT_COUNT);

  const put = (layer, x, y, r, g, b) => {
    const i = (layer * S * S + y * S + x) * 4;
    data[i] = clamp255(r * 255);
    data[i + 1] = clamp255(g * 255);
    data[i + 2] = clamp255(b * 255);
    data[i + 3] = 255;
  };

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const P = 8;                          // lattice period in tile space

      // FLAT — exactly neutral, so a surface can opt out of detail entirely.
      put(MAT.FLAT, x, y, 1, 1, 1);

      // PLASTER — fine grain, a few long cracks, slightly dirtier at the bottom.
      {
        const grain = 0.94 + fbm(11, u * P * 4, v * P * 4, P * 4, 3) * 0.16;
        const crack = Math.pow(Math.abs(noise(12, u * P * 1.5, v * P * 1.5, P * 1.5) - 0.5) * 2, 8);
        const streak = 1 - Math.max(0, v - 0.72) * 0.35 * fbm(13, u * P * 2, v * P, P * 2, 2);
        const c = grain * streak - crack * 0.22;
        put(MAT.PLASTER, x, y, c, c * 0.995, c * 0.98);
      }

      // TIMBER — strong grain along one axis, with knots.
      {
        const along = v * P * 1.1;
        const grain = 0.80 + Math.sin((u * 26 + fbm(21, u * P * 3, v * P, P * 3, 2) * 7) * Math.PI) * 0.09
          + fbm(22, u * P * 6, v * P * 2, P * 6, 3) * 0.22 + along * 0;
        const knot = Math.pow(Math.max(0, 1 - Math.hypot((u - 0.62) * 3.4, (v - 0.31) * 3.4)), 2) * 0.5;
        const c = grain - knot;
        put(MAT.TIMBER, x, y, c * 1.02, c * 0.94, c * 0.88);
      }

      // SLATE — overlapping courses of tiles, each course offset.
      {
        const rows = 9, cols = 6;
        const ry = v * rows;
        const row = Math.floor(ry);
        const off = (row % 2) * 0.5;
        const cx = (u * cols + off) % 1;
        const cy = ry % 1;
        const edge = Math.min(cx, 1 - cx, cy * 1.6, 1) ;
        const line = 1 - Math.exp(-edge * 14) * 0.55;               // dark seams
        const vary = 0.88 + fbm(31, row * 3.1 + Math.floor(u * cols) * 7.7, 0, P, 2) * 0.28;
        const c = line * vary + fbm(32, u * P * 5, v * P * 5, P * 5, 2) * 0.10;
        put(MAT.SLATE, x, y, c * 0.98, c, c * 1.04);
      }

      // COBBLE — rounded stones with mortar between them, and a lit crown.
      {
        const n = 7;
        const gx = u * n, gy = v * n;
        const cx = Math.floor(gx), cy2 = Math.floor(gy);
        // Jitter each cell's centre so the stones are not a chessboard.
        const jx = noise(41, cx * 3.3, cy2 * 5.1, P) - 0.5;
        const jy = noise(42, cx * 7.7, cy2 * 2.9, P) - 0.5;
        const dx = (gx - cx - 0.5 - jx * 0.5), dy = (gy - cy2 - 0.5 - jy * 0.5);
        const d = Math.hypot(dx, dy) * 2;
        const stone = 1 - smooth01((d - 0.72) / 0.30);
        const crown = (1 - d) * 0.20;                                // rounded top
        const tint = 0.84 + noise(43, cx * 11.1, cy2 * 13.7, P) * 0.32;
        const mortar = 0.62 + fbm(44, u * P * 6, v * P * 6, P * 6, 2) * 0.2;
        const c = (mortar * (1 - stone) + (tint + crown) * stone)
          + fbm(45, u * P * 8, v * P * 8, P * 8, 2) * 0.08;
        put(MAT.COBBLE, x, y, c * 1.01, c, c * 0.97);
      }

      // GRASS — clumpy, with a slight blue-green shift in the darker patches.
      {
        const clump = fbm(51, u * P * 3, v * P * 3, P * 3, 3);
        const blade = fbm(52, u * P * 14, v * P * 22, P * 14, 2);
        const c = 0.78 + clump * 0.34 + blade * 0.16;
        put(MAT.GRASS, x, y, c * 0.94, c * 1.06, c * 0.86);
      }

      // ROCK — sharp ridged noise, the classic cliff face.
      {
        const r1 = 1 - Math.abs(fbm(61, u * P * 2.5, v * P * 2.5, P * 2.5, 4) - 0.5) * 2;
        const c = 0.72 + r1 * 0.42 + fbm(62, u * P * 9, v * P * 9, P * 9, 2) * 0.14;
        put(MAT.ROCK, x, y, c, c * 0.99, c * 0.96);
      }

      // CLOTH — a visible weave plus slack folds.
      {
        const weave = (Math.sin(u * S * 0.7 * Math.PI) * Math.sin(v * S * 0.7 * Math.PI)) * 0.06;
        const fold = fbm(71, u * P * 2, v * P * 3, P * 2, 3) * 0.28;
        const c = 0.88 + weave + fold;
        put(MAT.CLOTH, x, y, c, c * 0.99, c * 0.98);
      }

      // STEEL — brushed, with faint dents. Chainmail reads at a distance as a
      // fine regular dither, which is exactly what the high-frequency term is.
      {
        const brush = fbm(81, u * P * 24, v * P * 2, P * 24, 2) * 0.18;
        const ring = (Math.sin(u * S * 1.6) * Math.sin(v * S * 1.6)) * 0.05;
        const dent = fbm(82, u * P * 3, v * P * 3, P * 3, 2) * 0.14;
        const c = 0.90 + brush + ring + dent;
        put(MAT.STEEL, x, y, c * 0.99, c, c * 1.03);
      }

      // LEATHER — pebbled, with a couple of creases.
      {
        const pebble = fbm(91, u * P * 12, v * P * 12, P * 12, 2) * 0.26;
        const crease = Math.pow(Math.abs(noise(92, u * P * 2, v * P * 2, P * 2) - 0.5) * 2, 6) * 0.3;
        const c = 0.86 + pebble - crease;
        put(MAT.LEATHER, x, y, c * 1.02, c * 0.97, c * 0.92);
      }

      // PLANK — boards with dark gaps between them, running along one axis.
      {
        const boards = 5;
        const b = v * boards;
        const gap = 1 - Math.exp(-Math.min(b % 1, 1 - (b % 1)) * 26) * 0.7;
        const grain = 0.86 + fbm(101, u * P * 8, v * P * 1.2, P * 8, 3) * 0.26;
        const shade = 0.92 + noise(102, 0, Math.floor(b) * 9.3, P) * 0.20;
        const c = gap * grain * shade;
        put(MAT.PLANK, x, y, c * 1.03, c * 0.95, c * 0.86);
      }

      // THATCH — dense diagonal straw.
      {
        const straw = fbm(111, (u + v) * P * 18, (u - v) * P * 3, P * 18, 2);
        const c = 0.80 + straw * 0.40;
        put(MAT.THATCH, x, y, c * 1.05, c * 0.98, c * 0.82);
      }

      // SKIN — almost flat, a little unevenness. Faces are read as shapes at
      // this camera distance; anything stronger becomes a rash.
      {
        const c = 0.97 + fbm(121, u * P * 5, v * P * 5, P * 5, 2) * 0.08;
        put(MAT.SKIN, x, y, c * 1.01, c * 0.99, c * 0.98);
      }

      // BARK — vertical fissures.
      {
        const fis = Math.pow(Math.abs(noise(131, u * P * 5, v * P * 0.8, P * 5) - 0.5) * 2, 3);
        const c = 0.74 + fis * 0.5 + fbm(132, u * P * 10, v * P * 10, P * 10, 2) * 0.16;
        put(MAT.BARK, x, y, c * 1.02, c * 0.96, c * 0.9);
      }

      // FOLIAGE — broken up enough that a canopy box does not read as a box.
      {
        const leaf = fbm(141, u * P * 7, v * P * 7, P * 7, 3);
        const c = 0.70 + leaf * 0.62;
        put(MAT.FOLIAGE, x, y, c * 0.92, c * 1.06, c * 0.84);
      }

      // DIRT — a beaten path: fine, slightly clumped, low contrast.
      {
        const c = 0.86 + fbm(151, u * P * 6, v * P * 6, P * 6, 3) * 0.26;
        put(MAT.DIRT, x, y, c * 1.04, c * 0.98, c * 0.90);
      }
    }
  }
  return { size: S, layers: MAT_COUNT, data };
}

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
const smooth01 = (t) => {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
};
