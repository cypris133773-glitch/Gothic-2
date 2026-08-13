// Keyboard, mouse and touch, reduced to one intent object.
//
// The game never reads a key. It reads `intent`, which is the same shape
// whether it came from a keyboard, a gamepad, a touch stick or a bot — and that
// is what makes the headless tests possible and what will make rebinding a
// settings screen rather than a refactor.
//
// Two things here look like paranoia and are not. Pointer lock can be refused
// (a sandboxed iframe, a browser policy, a user gesture that did not count), so
// there is a keyboard turn axis that works without it. And keys are tracked by
// `code`, not `key`, so a French or German keyboard moves forward with the key
// in the same place rather than the one with the same letter.
//
// The touch layer (src/core/touch.js) presses those same keys, so almost none
// of it is visible here. The one exception is the movement stick, which is
// analogue and therefore cannot be a key: it is added to the axes below.

import { createTouch, RUN_AT } from './touch.js';

const DEFAULT_BINDINGS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA'],
  right: ['KeyD'],
  turnLeft: ['ArrowLeft', 'KeyQ'],
  turnRight: ['ArrowRight', 'KeyE'],
  jump: ['Space'],
  sneak: ['ControlLeft', 'KeyC'],
  walk: ['ShiftLeft'],
  attack: ['KeyF'],
  block: ['KeyG'],
  talk: ['KeyE'],
  train: ['KeyT'],
  // Held, not tapped: a lock is a time cost in the open, so the key is held
  // down the whole time somebody could walk past.
  pick: ['KeyL'],
  steal: ['KeyP'],
};

export function createInput(canvas, opts = {}) {
  const down = new Set();
  const bindings = { ...DEFAULT_BINDINGS, ...(opts.bindings || {}) };
  const sensitivity = opts.sensitivity || 0.0022;
  const touch = opts.touch === false ? null : createTouch({ force: !!opts.forceTouch });
  let mouseDX = 0, mouseDY = 0;
  let mouseAttack = false, mouseBlock = false;
  let locked = false;

  const held = (action) => bindings[action].some((code) => down.has(code));

  addEventListener('keydown', (e) => {
    down.add(e.code);
    // Space scrolls the page and F-keys do worse; only swallow what we bind.
    if (Object.values(bindings).some((codes) => codes.includes(e.code))) e.preventDefault();
  });
  addEventListener('keyup', (e) => down.delete(e.code));
  // A tab that loses focus must not keep walking north for ever.
  addEventListener('blur', () => down.clear());

  if (canvas) {
    canvas.addEventListener('click', () => {
      if (!locked && canvas.requestPointerLock) {
        // Older Safari returns undefined rather than a promise; both are fine,
        // and a rejection is not an error — it is a browser saying no.
        try { Promise.resolve(canvas.requestPointerLock()).catch(() => {}); } catch { /* refused */ }
      }
    });
    document.addEventListener('pointerlockchange', () => {
      locked = document.pointerLockElement === canvas;
    });
    // The mouse buttons are the real bindings for a fight; the keys exist so
    // the game is playable without pointer lock and so the headless harness can
    // drive a swing through a key event.
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) mouseAttack = true;
      if (e.button === 2) mouseBlock = true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) mouseAttack = false;
      if (e.button === 2) mouseBlock = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      if (!locked) return;
      mouseDX += e.movementX * sensitivity;
      mouseDY += e.movementY * sensitivity;
    });
  }

  const intent = {
    forward: 0, strafe: 0, turn: 0, look: 0,
    jump: false, sneak: false, run: true, attack: false, block: false,
    pick: false, steal: false,
  };

  const clamp1 = (v) => Math.max(-1, Math.min(1, v));

  return {
    get locked() { return locked; },
    /** The touch overlay, for the loop that has to stand it down under a panel. */
    touch,
    /** Drain the accumulated input into an intent for this tick. */
    sample(dt) {
      intent.forward = (held('forward') ? 1 : 0) - (held('back') ? 1 : 0);
      intent.strafe = (held('right') ? 1 : 0) - (held('left') ? 1 : 0);
      const keyTurn = (held('turnRight') ? 1 : 0) - (held('turnLeft') ? 1 : 0);
      // Mouse deltas are per-frame quantities, so they are converted to a rate
      // before the simulation sees them — otherwise the same flick turns you
      // further on a slow machine.
      let turnRad = mouseDX, lookRad = mouseDY;
      intent.jump = held('jump');
      intent.sneak = held('sneak');
      intent.run = !held('walk');

      // The stick. Added rather than assigned, so a phone with a keyboard
      // attached — or a harness driving both — behaves like one device.
      if (touch && touch.active) {
        intent.forward = clamp1(intent.forward + touch.z);
        intent.strafe = clamp1(intent.strafe + touch.x);
        const look = touch.drainLook();
        turnRad += look.dx;
        lookRad += look.dy;
        // Half a stick walks. This is the one thing a thumb says that a key
        // cannot, and it is the difference between sneaking up on a man and
        // sprinting into him.
        if (touch.mag > 0.01) intent.run = touch.mag > RUN_AT;
      }

      intent.turn = keyTurn * 2.4 + (dt > 0 ? turnRad / dt : 0);
      intent.look = dt > 0 ? -lookRad / dt : 0;
      intent.attack = held('attack') || mouseAttack;
      intent.block = held('block') || mouseBlock;
      intent.pick = held('pick');
      intent.steal = held('steal');
      mouseDX = 0; mouseDY = 0;
      return intent;
    },
    /** For the dev overlay and for tests that want to see what was pressed. */
    get pressed() { return [...down]; },
  };
}

/** An intent that does nothing — the starting point for bots and cutscenes. */
export function idleIntent() {
  return {
    forward: 0, strafe: 0, turn: 0, look: 0,
    jump: false, sneak: false, run: true, attack: false, block: false,
    pick: false, steal: false,
  };
}
