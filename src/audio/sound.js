// Sound, synthesised.
//
// There are no audio files in this project and there are not going to be: the
// same rule that makes every texture a function makes every sound one. A
// footstep is a filtered noise burst with an envelope; a sword on mail is two
// of them a few milliseconds apart; a parry is a ringing partial. All of it is
// a hundred lines of WebAudio and none of it is a download.
//
// Three constraints shape the file.
//
// **The simulation cannot hear itself.** Nothing in `src/game` or `src/world`
// imports this. The world emits named events (§8.1.5's bus) and this listens.
// That is what keeps the headless bots and the Node test suite working: there
// is no AudioContext in Node and there does not need to be.
//
// **Audio needs a gesture.** Every browser suspends an AudioContext created
// before the user has touched the page. So the context is created lazily on the
// first key or click, and until then the game is silent and says so once —
// which is the same rule the capability gate applies to everything else.
//
// **A game that cannot make sound still runs.** Every entry point here is
// guarded. If WebAudio is missing, denied, or throws, the whole module turns
// itself into a set of no-ops and the game is exactly as playable.

import { on } from '../core/events.js';

/** A tiny deterministic noise source, so a footstep is not a coin toss. */
function noiseBuffer(ctx, seconds = 0.4) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let s = 0x2f6e2b1;
  for (let i = 0; i < n; i++) {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s |= 0;
    d[i] = ((s >>> 0) / 2147483648) - 1;
  }
  return buf;
}

export function createSound(opts = {}) {
  const silent = {
    get enabled() { return false; },
    get started() { return false; },
    reason: opts.reason || 'audio is not available here',
    start() { return false; },
    setVolume() {},
    toggle() { return false; },
    play() {},
    setAmbience() {},
    dispose() {},
  };

  const AC = typeof window !== 'undefined'
    ? (window.AudioContext || window.webkitAudioContext)
    : null;
  if (!AC || opts.off) return { ...silent, reason: opts.off ? 'audio switched off' : 'this browser has no WebAudio' };

  let ctx = null;
  let master = null;
  let noise = null;
  let wind = null, windGain = null, windFilter = null;
  let muted = false;
  let volume = opts.volume ?? 0.55;
  const unsubscribe = [];

  /** Build the graph. Called on the first gesture, never before. */
  function start() {
    if (ctx) return true;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : volume;
      master.connect(ctx.destination);
      noise = noiseBuffer(ctx);

      // Wind: one looping noise source through a slowly wandering low-pass.
      // It is the bed everything else sits on, and it is the difference between
      // a world and a diorama.
      wind = ctx.createBufferSource();
      wind.buffer = noise;
      wind.loop = true;
      windFilter = ctx.createBiquadFilter();
      windFilter.type = 'lowpass';
      windFilter.frequency.value = 420;
      windFilter.Q.value = 0.7;
      windGain = ctx.createGain();
      windGain.gain.value = 0.05;
      wind.connect(windFilter).connect(windGain).connect(master);
      wind.start();
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    } catch {
      ctx = null;
      return false;
    }
  }

  const now = () => (ctx ? ctx.currentTime : 0);

  /**
   * One shaped noise burst. The workhorse: a footstep, a blade, a lock, a
   * whoosh and a thud are all this function with different numbers.
   */
  function burst({ freq = 900, q = 1.2, type = 'bandpass', gain = 0.3, attack = 0.002, decay = 0.12, sweep = 0, when = 0 }) {
    if (!ctx) return;
    const t = now() + when;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t + decay);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    src.connect(f).connect(g).connect(master);
    src.start(t);
    src.stop(t + attack + decay + 0.02);
  }

  /** One pitched partial — a ring, a coin, a bell, a note of an arpeggio. */
  function tone({ freq = 440, gain = 0.2, attack = 0.004, decay = 0.25, type = 'triangle', when = 0, bend = 0 }) {
    if (!ctx) return;
    const t = now() + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (bend) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * bend), t + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + attack + decay + 0.02);
  }

  /**
   * The whole sound design, as data.
   *
   * Every one of these was arrived at by listening, and the numbers are the
   * design: a boot on cobbles is brighter and shorter than one on grass, a
   * blade on mail has a metallic partial over the noise and one on leather does
   * not, and a parry rings because a parry has to be *audibly* different from
   * a block or the player cannot learn the timing by ear.
   */
  const VOICES = {
    step: (p) => {
      const grass = p && p.ground === 'grass';
      burst({
        freq: grass ? 520 : 1500, q: grass ? 0.9 : 1.6,
        gain: Math.min(0.16, 0.05 + (p && p.speed ? p.speed * 0.02 : 0.05)),
        decay: grass ? 0.08 : 0.05, sweep: 0.4,
      });
    },
    swing: () => burst({ freq: 1800, q: 0.8, gain: 0.10, decay: 0.16, sweep: 0.25 }),
    hit: (p) => {
      const armoured = p && p.armour > 20;
      burst({ freq: armoured ? 2400 : 700, q: armoured ? 2.4 : 1.0, gain: 0.24, decay: 0.10, sweep: 0.35 });
      if (armoured) tone({ freq: 1750 + Math.random() * 400, gain: 0.10, decay: 0.22, type: 'square', bend: 0.8 });
      else burst({ freq: 220, q: 1.4, gain: 0.16, decay: 0.14, when: 0.012 });
    },
    // A parry rings and a block thuds. If those two sound alike the player
    // cannot learn the timing by ear, and learning it by ear is most of what a
    // second playthrough is.
    parry: () => {
      tone({ freq: 2600, gain: 0.20, decay: 0.42, type: 'triangle', bend: 0.92 });
      tone({ freq: 3900, gain: 0.08, decay: 0.30, type: 'sine', bend: 0.95, when: 0.01 });
    },
    block: () => burst({ freq: 260, q: 1.6, gain: 0.22, decay: 0.16, sweep: 0.5 }),
    hurt: () => {
      burst({ freq: 380, q: 0.9, gain: 0.26, decay: 0.22, sweep: 0.3 });
      tone({ freq: 150, gain: 0.14, decay: 0.30, type: 'sawtooth', bend: 0.6 });
    },
    die: () => {
      tone({ freq: 220, gain: 0.22, decay: 0.9, type: 'sawtooth', bend: 0.35 });
      burst({ freq: 300, q: 0.6, gain: 0.18, decay: 0.7, sweep: 0.2, when: 0.05 });
    },
    // A drawn bow is a creak; a loosed one is a snap and a departing hiss.
    draw: () => burst({ freq: 320, q: 3.0, gain: 0.07, decay: 0.30, sweep: 1.6 }),
    shoot: () => {
      tone({ freq: 180, gain: 0.16, decay: 0.10, type: 'triangle', bend: 0.5 });
      burst({ freq: 3200, q: 0.7, gain: 0.10, decay: 0.22, sweep: 0.15, when: 0.02 });
    },
    cast: () => {
      // A rising partial under a widening filter: the sound of something being
      // gathered rather than thrown.
      tone({ freq: 160, gain: 0.10, decay: 0.42, type: 'sine', bend: 3.2 });
      burst({ freq: 400, q: 1.1, gain: 0.09, decay: 0.40, sweep: 3.0 });
    },
    bolt: () => {
      burst({ freq: 900, q: 0.6, gain: 0.20, decay: 0.34, sweep: 0.25 });
      tone({ freq: 90, gain: 0.14, decay: 0.30, type: 'sawtooth', bend: 0.5 });
    },
    lock: () => {
      burst({ freq: 3000, q: 5.0, gain: 0.06, decay: 0.03 });
    },
    unlock: () => {
      burst({ freq: 2200, q: 4.0, gain: 0.14, decay: 0.06 });
      tone({ freq: 900, gain: 0.12, decay: 0.18, type: 'square', bend: 0.7, when: 0.04 });
    },
    coin: () => {
      for (let i = 0; i < 3; i++) {
        tone({ freq: 2100 + i * 380 + Math.random() * 200, gain: 0.09, decay: 0.16, type: 'triangle', when: i * 0.035 });
      }
    },
    // A rising fourth. Short, and it is the only musical thing in the game.
    level: () => {
      const root = 392;
      [1, 1.25, 1.5, 2].forEach((r, i) => tone({
        freq: root * r, gain: 0.13, decay: 0.36, type: 'triangle', when: i * 0.085,
      }));
    },
    quest: () => {
      tone({ freq: 660, gain: 0.10, decay: 0.24, type: 'triangle' });
      tone({ freq: 990, gain: 0.08, decay: 0.30, type: 'triangle', when: 0.09 });
    },
    door: () => {
      burst({ freq: 180, q: 2.2, gain: 0.20, decay: 0.55, sweep: 0.6 });
      burst({ freq: 900, q: 1.2, gain: 0.08, decay: 0.30, when: 0.18, sweep: 0.4 });
    },
    chapter: () => {
      [1, 0.75, 1.5].forEach((r, i) => tone({
        freq: 262 * r, gain: 0.14, decay: 0.9, type: 'sine', when: i * 0.22,
      }));
    },
  };

  const api = {
    get enabled() { return !!ctx; },
    get started() { return !!ctx; },
    get muted() { return muted; },
    reason: null,

    start,

    setVolume(v) {
      volume = Math.max(0, Math.min(1, v));
      if (master && !muted) master.gain.setTargetAtTime(volume, now(), 0.02);
      return volume;
    },

    toggle() {
      muted = !muted;
      if (master) master.gain.setTargetAtTime(muted ? 0 : volume, now(), 0.02);
      return muted;
    },

    play(name, payload) {
      if (!ctx || muted) return;
      const voice = VOICES[name];
      if (voice) voice(payload);
    },

    /**
     * The bed. `night` darkens the wind and `gust` opens the filter — both are
     * driven from the world's own clock and wind field, so the ambience is the
     * same quantity the grass is bending to rather than a separate loop.
     */
    setAmbience({ night = 0, gust = 0 } = {}) {
      if (!ctx || !windGain) return;
      const t = now();
      windGain.gain.setTargetAtTime(0.030 + gust * 0.045 + night * 0.012, t, 0.4);
      windFilter.frequency.setTargetAtTime(300 + gust * 520 - night * 120, t, 0.6);
    },

    dispose() {
      for (const un of unsubscribe) un();
      unsubscribe.length = 0;
      if (ctx) { try { ctx.close(); } catch { /* already gone */ } }
      ctx = null;
    },
  };

  // --- the bus ---------------------------------------------------------------
  // Named events in, sound out. This is the only place the two halves meet, and
  // it is one-way: nothing here can change the world.
  for (const name of Object.keys(VOICES)) {
    unsubscribe.push(on(`sfx:${name}`, (payload) => api.play(name, payload)));
  }

  return api;
}
