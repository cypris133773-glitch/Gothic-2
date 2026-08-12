// The character controller.
//
// Everything here runs from a fixed 60 Hz tick and touches no browser API, so
// the same code that moves the player in the tab moves a bot in Node. That is
// not tidiness for its own sake: the bot tests in §13.2 of the brief are the
// only thing that will ever prove a 1.6 km² world is completable, and they can
// only exist if walking is a pure function of state and intent.
//
// The feel is deliberate and it is not "responsive". A body has mass: it takes
// about a fifth of a second to reach speed and a little less to stop, it cannot
// turn on the spot at full tilt, and it cannot climb a cliff because the slope
// rule says so rather than because a wall was placed there.

export const WALK_SPEED = 2.6;        // m/s — a purposeful walk
export const RUN_SPEED = 5.4;         // m/s — the default; Gothic runs everywhere
// Sneaking is measured against the walk, not the run. Basing it on the run
// made a crouched character faster than a walking one, which the speed-ordering
// test caught on its first run — the kind of mistake that survives a playtest
// because nobody thinks to try walking slower than they are sneaking.
export const SNEAK_SPEED = WALK_SPEED * 0.55;
export const ACCEL = 26;              // m/s² toward the target velocity
export const FRICTION = 34;           // m/s² against it when there is no input
export const GRAVITY = -22;           // heavier than earth, which reads better
export const JUMP_SPEED = 6.4;
export const MAX_SLOPE = 0.72;        // radians — about 41°, above which you slide
export const RADIUS = 0.36;           // capsule radius, for collision
export const HEIGHT = 1.8;

export function createPlayer(x = 0, z = 0, terrain = null) {
  return {
    pos: new Float32Array([x, terrain ? terrain.heightAt(x, z) : 0, z]),
    vel: new Float32Array(3),
    yaw: 0,               // facing, radians, 0 = +Z
    pitch: 0,             // look angle, camera only
    // A character placed on the terrain is standing on it. Starting airborne
    // meant the first jump of a session was silently swallowed while gravity
    // resolved the first tick.
    onGround: !!terrain,
    sneaking: false,
    speed: 0,             // horizontal speed, metres per second, for animation
    airTime: 0,
  };
}

/**
 * Advance one tick.
 *
 * `intent` is what the player asked for, not what happens: { forward, strafe,
 * turn, jump, sneak, run }, each already normalised by the input layer. Keeping
 * intent separate from input is what lets a bot, a replay and a keyboard all
 * drive the same character.
 */
export function stepPlayer(p, intent, terrain, obstacles, dt) {
  p.yaw += intent.turn * dt;
  p.yaw = wrapAngle(p.yaw);
  p.pitch = clamp(p.pitch + intent.look * dt, -1.2, 1.0);
  p.sneaking = !!intent.sneak;

  // Movement is relative to facing, so strafing is strafing and not a second
  // forward. The vector is clamped rather than normalised: holding forward and
  // right must not be faster than forward, but a half-pressed stick must stay
  // half.
  const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
  let dx = fx * intent.forward + fz * intent.strafe;
  let dz = fz * intent.forward - fx * intent.strafe;
  const mag = Math.hypot(dx, dz);
  if (mag > 1) { dx /= mag; dz /= mag; }

  const top = p.sneaking ? SNEAK_SPEED : intent.run ? RUN_SPEED : WALK_SPEED;
  const targetX = dx * top, targetZ = dz * top;

  const rate = (mag > 0.01 ? ACCEL : FRICTION) * dt;
  p.vel[0] = approach(p.vel[0], targetX, rate);
  p.vel[2] = approach(p.vel[2], targetZ, rate);

  if (intent.jump && p.onGround) {
    p.vel[1] = JUMP_SPEED;
    p.onGround = false;
  }
  p.vel[1] += GRAVITY * dt;

  p.pos[0] += p.vel[0] * dt;
  p.pos[1] += p.vel[1] * dt;
  p.pos[2] += p.vel[2] * dt;

  if (obstacles) resolveObstacles(p, obstacles);

  if (terrain) {
    const ground = terrain.heightAt(p.pos[0], p.pos[2]);
    if (p.pos[1] <= ground) {
      // A slope too steep to stand on does not stop you — it slides you. The
      // player is never blocked by an invisible wall; they are moved by the
      // hill, which is legible and which they can fight against by finding a
      // gentler line up.
      if (terrain.slopeAt(p.pos[0], p.pos[2]) > MAX_SLOPE) {
        const n = terrain.normalAt(_n, p.pos[0], p.pos[2]);
        p.vel[0] += n[0] * 16 * dt;
        p.vel[2] += n[2] * 16 * dt;
      }
      p.pos[1] = ground;
      if (p.vel[1] < 0) p.vel[1] = 0;
      p.onGround = true;
      p.airTime = 0;
    } else {
      p.onGround = false;
      p.airTime += dt;
    }
  }

  p.speed = Math.hypot(p.vel[0], p.vel[2]);
  return p;
}

/**
 * Push the capsule out of anything it is standing in.
 *
 * Circle-versus-circle in the horizontal plane, which is the right shape for
 * trees, rocks, barrels and people, and which cannot wedge a player into a
 * corner the way a naive box test can. Two passes, because pushing out of one
 * obstacle can push into its neighbour.
 */
export function resolveObstacles(p, obstacles) {
  for (let pass = 0; pass < 2; pass++) {
    let moved = false;
    for (const o of obstacles) {
      // Ignore anything whose top is under the player's feet or whose base is
      // over their head: a boulder is not a wall to someone standing on it.
      const half = (Array.isArray(o.scale) ? o.scale[1] : o.scale) / 2;
      if (o.pos[1] + half < p.pos[1] + 0.25 || o.pos[1] - half > p.pos[1] + HEIGHT) continue;
      if (o.box ? pushOutOfBox(p, o) : (o.radius ? pushOutOfCircle(p, o) : false)) moved = true;
    }
    if (!moved) break;
  }
  return p;
}

/** A trunk, a boulder, a barrel, a person: round in plan, and cannot wedge. */
function pushOutOfCircle(p, o) {
  const dx = p.pos[0] - o.pos[0], dz = p.pos[2] - o.pos[2];
  const dist = Math.hypot(dx, dz);
  const min = o.radius + RADIUS;
  if (dist >= min || dist < 1e-6) return false;
  const push = (min - dist) / dist;
  p.pos[0] += dx * push;
  p.pos[2] += dz * push;
  slide(p, dx / dist, dz / dist);
  return true;
}

/**
 * A wall. The player is moved into the box's own frame, clamped to its
 * rectangle, and pushed back out along whichever face is nearest.
 *
 * A house used to be a single keep-out circle, which is the most obvious lie a
 * world can tell: the corners of the building were solid air, the walls were
 * passable at the mid-point of each face, and two houses side by side could not
 * be walked between. The circle was right for the fifty lines it cost at M2 and
 * wrong for everything after.
 */
function pushOutOfBox(p, o) {
  const cy = Math.cos(-o.yaw), sy = Math.sin(-o.yaw);
  const rx = p.pos[0] - o.pos[0], rz = p.pos[2] - o.pos[2];
  // Into the box's frame.
  const lx = rx * cy + rz * sy;
  const lz = -rx * sy + rz * cy;
  const hx = o.box[0] / 2 + RADIUS, hz = o.box[1] / 2 + RADIUS;
  if (lx < -hx || lx > hx || lz < -hz || lz > hz) return false;

  // Out through the nearest face, which is what stops a character stepping into
  // a wall and being ejected through the far side of the building.
  const dxPos = hx - lx, dxNeg = lx + hx;
  const dzPos = hz - lz, dzNeg = lz + hz;
  const minX = Math.min(dxPos, dxNeg), minZ = Math.min(dzPos, dzNeg);
  let nlx = 0, nlz = 0;
  if (minX < minZ) nlx = dxPos < dxNeg ? 1 : -1;
  else nlz = dzPos < dzNeg ? 1 : -1;
  const depth = Math.min(minX, minZ);

  // Back into world space.
  const wx = nlx * cy - nlz * sy;
  const wz = nlx * sy + nlz * cy;
  p.pos[0] += wx * depth;
  p.pos[2] += wz * depth;
  slide(p, wx, wz);
  return true;
}

/**
 * Remove the component of velocity going into a surface, so a character walking
 * at a wall stops against it and a character walking along one keeps going.
 */
function slide(p, nx, nz) {
  const into = p.vel[0] * nx + p.vel[2] * nz;
  if (into < 0) { p.vel[0] -= nx * into; p.vel[2] -= nz * into; }
}

const _n = new Float32Array(3);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const approach = (v, target, rate) => {
  const d = target - v;
  if (Math.abs(d) <= rate) return target;
  return v + Math.sign(d) * rate;
};
export function wrapAngle(a) {
  const twoPi = Math.PI * 2;
  a %= twoPi;
  if (a > Math.PI) a -= twoPi;
  if (a < -Math.PI) a += twoPi;
  return a;
}
