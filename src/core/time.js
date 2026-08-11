// The world clock. One real minute is twelve in-game minutes, so a full day is
// two hours of play (§6.9).
//
// This module is the reason the game has weather, shopkeepers who close, and a
// forest that is genuinely dangerous after dark. It is deliberately the only
// place that knows how fast time passes: everything else asks it what o'clock
// it is. Sun direction lives here too, because the shadow direction *is* the
// clock — a player should be able to tell the hour by looking at the ground.

export const MINUTES_PER_DAY = 24 * 60;

// A two-hour day: 1440 game minutes over 7200 real seconds, which is the same
// thing as the brief's "one real minute is twelve in-game minutes". One
// constant, derived from the day length, so changing the day length cannot
// leave a second constant behind disagreeing with it.
export const GAME_MINUTES_PER_SECOND = MINUTES_PER_DAY / (2 * 60 * 60);

export class Clock {
  /** @param {number} startMinutes minutes since midnight of day 0 */
  constructor(startMinutes = 8 * 60) {
    this.day = Math.floor(startMinutes / MINUTES_PER_DAY);
    this.minutes = startMinutes % MINUTES_PER_DAY;
  }

  /** Advance by real seconds. */
  tick(dtSeconds) {
    this.minutes += dtSeconds * GAME_MINUTES_PER_SECOND;
    while (this.minutes >= MINUTES_PER_DAY) { this.minutes -= MINUTES_PER_DAY; this.day++; }
  }

  /**
   * Skip forward to the next occurrence of `hour`, for sleeping. Returns the
   * game minutes that passed, which is what the caller needs in order to charge
   * hunger, advance NPC routines and roll a night's worth of world events.
   * Skipping to the hour it already is means a full day, not nothing — that is
   * what a player asking to sleep until eight when it is eight means.
   */
  skipTo(hour) {
    const target = ((hour % 24) + 24) % 24 * 60;
    let passed = target - this.minutes;
    if (passed <= 0) passed += MINUTES_PER_DAY;
    this.minutes += passed;
    while (this.minutes >= MINUTES_PER_DAY) { this.minutes -= MINUTES_PER_DAY; this.day++; }
    return passed;
  }

  get hour() { return Math.floor(this.minutes / 60); }
  get minuteOfHour() { return Math.floor(this.minutes % 60); }
  get minutesOfDay() { return this.minutes; }
  get hhmm() {
    return `${String(this.hour).padStart(2, '0')}:${String(this.minuteOfHour).padStart(2, '0')}`;
  }

  /** 0 at midnight, 1 at noon — the shape most lighting terms want. */
  get dayness() {
    return Math.max(0, Math.sin((this.minutes / MINUTES_PER_DAY) * Math.PI * 2 - Math.PI / 2));
  }

  get isNight() { return this.minutes < 5 * 60 || this.minutes >= 21 * 60; }
}

/**
 * Direction *toward* the sun, in world space, for a given time of day.
 * The sun rises in the east (+X), sets in the west (-X), and is tilted so
 * shadows are never perfectly axis-aligned — a small thing that stops midday
 * from looking like a technical demo.
 */
export function sunDirection(out, minutesOfDay) {
  const t = (minutesOfDay / MINUTES_PER_DAY) * Math.PI * 2 - Math.PI / 2;
  const y = Math.sin(t);
  const x = Math.cos(t);
  const z = 0.35;
  const len = Math.hypot(x, y, z) || 1;
  out[0] = x / len; out[1] = y / len; out[2] = z / len;
  return out;
}

/**
 * Direction toward the *key light*, which is the sun by day and the moon by
 * night. The renderer wants this one, not `sunDirection`: a key light pointing
 * up from under the ground lights nothing at all, and a night lit by nothing at
 * all is a black screen rather than a dark world.
 */
export function keyLightDirection(out, minutesOfDay) {
  sunDirection(out, minutesOfDay);
  if (out[1] < 0) {
    // The moon is treated as the sun's antipode, offset enough that it never
    // sits exactly where the sun was and the two never cross in one frame.
    out[0] = -out[0] * 0.9 + 0.2;
    out[1] = -out[1];
    out[2] = -out[2] * 0.9;
  }
  // A key light exactly on the horizon grazes every surface, lights none of
  // them, and gives shadow mapping its worst possible case. Sunrise and sunset
  // therefore keep a small floor on elevation: the light stays warm and low,
  // but it comes from slightly above the world rather than exactly along it.
  if (out[1] < 0.08) out[1] = 0.08;
  const len = Math.hypot(out[0], out[1], out[2]) || 1;
  out[0] /= len; out[1] /= len; out[2] /= len;
  return out;
}

/** Sky, sun and bounce colours for the hour. Linear space, pre-tonemap. */
export function skyPalette(minutesOfDay) {
  // Sun elevation, -1 at midnight to +1 at noon. Everything else is a curve
  // over this one number, which is what keeps the sky, the key light and the
  // ambient from ever disagreeing about what time it is.
  const elev = Math.sin((minutesOfDay / MINUTES_PER_DAY) * Math.PI * 2 - Math.PI / 2);

  // Daylight fades out over an elevation band rather than switching off at the
  // horizon. The first version of this clipped at zero, and the build gate
  // photographed 19:30 as a single flat colour — which is what "the sun has
  // set, therefore there is no light" looks like, and it is wrong. Real dusk
  // has a lit sky for an hour after the sun is gone, and that hour is the best
  // the game will ever look.
  const day = smoothstep(-0.28, 0.16, elev);

  // A warm band centred just below the horizon: sunrise and sunset, approached
  // from either side.
  const twilight = Math.exp(-Math.pow((elev + 0.04) / 0.22, 2)) * (1 - day * 0.35);

  // The moon is not decoration. Without it, night is unnavigable rather than
  // dangerous, and the player stops going outside instead of buying a torch.
  const moon = 0.07 * (1 - day);

  return {
    // The clear colour: deep blue at night, cold blue-grey by day, and orange
    // through the band in between.
    sky: [
      0.020 + day * 0.24 + twilight * 0.30 + moon * 0.16,
      0.028 + day * 0.33 + twilight * 0.15 + moon * 0.21,
      0.055 + day * 0.52 + twilight * 0.06 + moon * 0.38,
    ],
    // The zenith is deeper and bluer than the horizon at every hour — that
    // vertical gradient is most of what makes a sky read as a sky.
    zenith: [
      0.012 + day * 0.10 + twilight * 0.10 + moon * 0.08,
      0.020 + day * 0.19 + twilight * 0.07 + moon * 0.13,
      0.050 + day * 0.52 + twilight * 0.10 + moon * 0.36,
    ],
    // The key light. It never quite reaches zero because moonlight is a
    // directional light too — a dim, blue one.
    sun: [
      day * 2.60 + twilight * 1.30 + moon * 0.30,
      day * 2.34 + twilight * 0.66 + moon * 0.36,
      day * 2.05 + twilight * 0.22 + moon * 0.62,
    ],
    skyLight: [
      0.020 + day * 0.30 + twilight * 0.12 + moon * 0.22,
      0.028 + day * 0.36 + twilight * 0.07 + moon * 0.28,
      0.050 + day * 0.46 + twilight * 0.04 + moon * 0.44,
    ],
    // Bounce off the ground: warm, weak, and always dimmer than the sky term.
    groundLight: [
      0.012 + day * 0.11 + twilight * 0.06,
      0.011 + day * 0.09 + twilight * 0.04,
      0.009 + day * 0.07 + twilight * 0.02,
    ],
  };
}

/** Hermite fade between two edges — the one easing curve this file needs. */
function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
