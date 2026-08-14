// The third-person camera.
//
// A spring arm that collides. The two things that make a camera feel expensive
// rather than cheap are both here and both cost about ten lines: it never
// snaps, and it never ends up inside the world. Everything else — the framing,
// the field of view, the lag on a turn — is tuning.

const MIN_DIST = 1.1;
const MAX_DIST = 5.4;
const HEAD = 1.55;              // eye height above the character's feet
const SHOULDER = 0.55;          // over-the-shoulder offset, right of centre

/**
 * The camera's own right, in world space.
 *
 * This is the same vector `lookAt` builds (`up × (eye − target)`, normalised),
 * so "right" here means right *on the screen* rather than right in some other
 * frame of reference. It is exported because the input layer needs it: the
 * world's yaw runs the other way round from the view's, and the one honest
 * place to say so is the vector the renderer actually uses.
 */
export function cameraRight(cam, out = [0, 0, 0]) {
  const zx = cam.pos[0] - cam.target[0];
  const zz = cam.pos[2] - cam.target[2];
  const zy = cam.pos[1] - cam.target[1];
  const len = Math.hypot(zx, zy, zz) || 1;
  // up × z, with up = (0, 1, 0). The y term falls out, which is what makes this
  // usable as a flat steering basis as well as a view basis.
  const rx = zz / len, rz = -zx / len;
  const rl = Math.hypot(rx, rz) || 1;
  out[0] = rx / rl; out[1] = 0; out[2] = rz / rl;
  return out;
}

export function createCamera() {
  return {
    pos: new Float32Array([0, 2, 6]),
    target: new Float32Array([0, 1.5, 0]),
    dist: MAX_DIST,
    fov: 68,                    // degrees; combat narrows it (§10.3)
  };
}

/**
 * Place the camera behind the player, then pull it in until it is not inside
 * anything. The pull-in is instant and the push-out is gradual, which is the
 * asymmetry that stops the camera popping through a tree trunk and then
 * lurching back out.
 */
export function stepCamera(cam, p, terrain, obstacles, dt, opts = {}) {
  const fov = opts.combat ? 60 : 68;
  cam.fov += (fov - cam.fov) * Math.min(1, dt * 6);

  const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
  // The point the camera looks at sits at head height, offset to the shoulder,
  // and leads the character slightly when they are moving — so the frame shows
  // where they are going rather than where they have been.
  const lead = Math.min(p.speed / 6, 1) * 1.1;
  cam.target[0] = p.pos[0] - fz * SHOULDER + fx * lead;
  cam.target[1] = p.pos[1] + HEAD;
  cam.target[2] = p.pos[2] + fx * SHOULDER + fz * lead;

  const pitch = p.pitch;
  const back = Math.cos(pitch), up = Math.sin(pitch);
  const wantX = cam.target[0] - fx * MAX_DIST * back;
  const wantY = cam.target[1] - up * MAX_DIST + 0.55;
  const wantZ = cam.target[2] - fz * MAX_DIST * back;

  let dist = MAX_DIST;
  // March along the arm and stop at the first thing in the way. Eight samples
  // is coarse, and coarse is correct here: a camera that is exactly right at
  // the cost of a spike is worse than one that is close and cheap.
  for (let i = 1; i <= 8; i++) {
    const t = i / 8;
    const x = cam.target[0] + (wantX - cam.target[0]) * t;
    const y = cam.target[1] + (wantY - cam.target[1]) * t;
    const z = cam.target[2] + (wantZ - cam.target[2]) * t;
    if (blocked(x, y, z, terrain, obstacles)) { dist = MAX_DIST * (i - 1) / 8; break; }
  }
  dist = Math.max(MIN_DIST, dist);

  // Pull in at once, ease out over about a third of a second.
  cam.dist = dist < cam.dist ? dist : cam.dist + (dist - cam.dist) * Math.min(1, dt * 3);

  const t = cam.dist / MAX_DIST;
  cam.pos[0] = cam.target[0] + (wantX - cam.target[0]) * t;
  cam.pos[1] = cam.target[1] + (wantY - cam.target[1]) * t;
  cam.pos[2] = cam.target[2] + (wantZ - cam.target[2]) * t;

  // A last guard: whatever the arm decided, the camera does not go underground.
  if (terrain) {
    const floor = terrain.heightAt(cam.pos[0], cam.pos[2]) + 0.35;
    if (cam.pos[1] < floor) cam.pos[1] = floor;
  }
  return cam;
}

function blocked(x, y, z, terrain, obstacles) {
  if (terrain && y < terrain.heightAt(x, z) + 0.3) return true;
  if (obstacles) {
    for (const o of obstacles) {
      const half = (Array.isArray(o.scale) ? o.scale[1] : o.scale) / 2;
      if (y < o.pos[1] - half || y > o.pos[1] + half) continue;
      const dx = x - o.pos[0], dz = z - o.pos[2];
      if (o.box) {
        // Same rectangle the character collides against, so the camera cannot
        // sit inside a wall the player is standing beside.
        const cy = Math.cos(-o.yaw), sy = Math.sin(-o.yaw);
        const lx = dx * cy + dz * sy, lz = -dx * sy + dz * cy;
        if (Math.abs(lx) < o.box[0] / 2 + 0.3 && Math.abs(lz) < o.box[1] / 2 + 0.3) return true;
      } else if (o.radius && dx * dx + dz * dz < (o.radius + 0.3) ** 2) return true;
    }
  }
  return false;
}
