// Vectors and matrices, written to be called sixty times a second without
// allocating. Every function that returns a matrix or a vector takes the
// destination as its first argument and returns it, so a caller can keep one
// scratch object for the life of the process. A GC spike is a stutter, and a
// stutter in a game about timing your swing is a defect.

export const DEG = Math.PI / 180;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;

/** Shortest signed difference between two angles, in radians. */
export function angleDelta(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// --- vec3 (plain Float32Array(3) or any indexable) --------------------------

export const vec3 = (x = 0, y = 0, z = 0) => new Float32Array([x, y, z]);

export function v3set(out, x, y, z) { out[0] = x; out[1] = y; out[2] = z; return out; }
export function v3sub(out, a, b) { out[0] = a[0] - b[0]; out[1] = a[1] - b[1]; out[2] = a[2] - b[2]; return out; }
export function v3cross(out, a, b) {
  const x = a[1] * b[2] - a[2] * b[1];
  const y = a[2] * b[0] - a[0] * b[2];
  const z = a[0] * b[1] - a[1] * b[0];
  return v3set(out, x, y, z);
}
export const v3dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const v3len = (a) => Math.hypot(a[0], a[1], a[2]);
export function v3norm(out, a) {
  const l = v3len(a) || 1;
  return v3set(out, a[0] / l, a[1] / l, a[2] / l);
}

// --- mat4, column-major to match what the GL and WebGPU APIs expect ---------

export const mat4 = () => new Float32Array(16);

export function identity(out) {
  out.fill(0);
  out[0] = out[5] = out[10] = out[15] = 1;
  return out;
}

/** Right-handed perspective with a [-1, 1] depth range (GL convention). */
export function perspective(out, fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

const _z = vec3(), _x = vec3(), _y = vec3();

export function lookAt(out, eye, target, up) {
  v3norm(_z, v3sub(_z, eye, target));         // camera looks down -Z
  v3norm(_x, v3cross(_x, up, _z));
  v3cross(_y, _z, _x);
  out[0] = _x[0]; out[1] = _y[0]; out[2] = _z[0]; out[3] = 0;
  out[4] = _x[1]; out[5] = _y[1]; out[6] = _z[1]; out[7] = 0;
  out[8] = _x[2]; out[9] = _y[2]; out[10] = _z[2]; out[11] = 0;
  out[12] = -v3dot(_x, eye); out[13] = -v3dot(_y, eye); out[14] = -v3dot(_z, eye); out[15] = 1;
  return out;
}

export function multiply(out, a, b) {
  // Written out rather than looped: this is the single hottest function in the
  // renderer and the loop version is measurably slower in every engine we care
  // about. `out` may alias `a` or `b`, so every column is read before it writes.
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  for (let i = 0; i < 4; i++) {
    const b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
    out[i * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  }
  return out;
}

export function fromRotationY(out, rad) {
  const s = Math.sin(rad), c = Math.cos(rad);
  identity(out);
  out[0] = c; out[2] = -s; out[8] = s; out[10] = c;
  return out;
}

export function fromRotationX(out, rad) {
  const s = Math.sin(rad), c = Math.cos(rad);
  identity(out);
  out[5] = c; out[6] = s; out[9] = -s; out[10] = c;
  return out;
}

export function setTranslation(out, x, y, z) {
  out[12] = x; out[13] = y; out[14] = z;
  return out;
}

/** Inverse-transpose of the upper 3×3, as a mat4, for transforming normals. */
export function normalMatrix(out, m) {
  const a = m[0], b = m[1], c = m[2];
  const d = m[4], e = m[5], f = m[6];
  const g = m[8], h = m[9], i = m[10];
  const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g;
  const det = a * A + b * B + c * C || 1;
  identity(out);
  out[0] = A / det; out[4] = B / det; out[8] = C / det;
  out[1] = (c * h - b * i) / det; out[5] = (a * i - c * g) / det; out[9] = (b * g - a * h) / det;
  out[2] = (b * f - c * e) / det; out[6] = (c * d - a * f) / det; out[10] = (a * e - b * d) / det;
  return out;
}
