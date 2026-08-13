// The same game, played with two thumbs.
//
// A phone port of a keyboard game usually goes one of two ways: a second input
// path grows beside the first and the two drift until half the game is
// unreachable on the smaller one, or the controls are a photograph of a
// gamepad and nothing fits. Neither happens here, because of one decision:
//
//   **Every touch control except the movement stick presses a key.**
//
// A button dispatches a real `keydown`/`keyup` with the same `code` the desk
// binding uses, and every handler in the game — movement, the book, the shop, a
// conversation, the save slots — is already listening for it. There is no
// second dispatch table to keep in step, no `if (touch)` inside the gameplay
// code, and a key that gets rebound tomorrow is rebound for the phone too. The
// stick is the single exception, and only because a thumb is analogue and a key
// is not: pushing it half way should walk, and no keyboard can say that.
//
// The overlay does not appear because the browser reports a touchscreen. It
// appears the first time somebody actually touches the glass (or when `?touch=1`
// asks for it), because a laptop with a touchscreen is a laptop.

/** How far from the stick's origin counts as full deflection, in CSS pixels. */
const RADIUS = 64;
/** The middle of the stick, where a resting thumb must not steer. */
const DEAD = 0.16;
/** Past this much deflection he runs; below it he walks. The keyboard needs a
 *  modifier for that distinction and a thumb does not, which is the one place
 *  where the touch controls are better than the desk ones. */
export const RUN_AT = 0.62;
/** Radians of turn per CSS pixel dragged. */
const LOOK = 0.0045;

/** The keyboard `key` that goes with a `code`, for the handlers that read it. */
function keyFor(code) {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1].toLowerCase();
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) return digit[1];
  if (code === 'Space') return ' ';
  if (code === 'ControlLeft') return 'Control';
  if (code === 'ShiftLeft') return 'Shift';
  return code;
}

function key(code, down) {
  dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', {
    code, key: keyFor(code), bubbles: true, cancelable: true,
  }));
}

// The four things a hand needs during a fight, at the bottom right where a
// thumb already is. Everything else is behind the ☰, because a control that is
// used once an hour costs more as clutter than it saves as a shortcut.
const HANDS = [
  { code: 'KeyF', label: 'Hit', hold: true },
  { code: 'KeyG', label: 'Guard', hold: true },
  { code: 'Space', label: 'Jump', hold: true },
  { code: 'KeyE', label: 'Talk' },
];

const DRAWER = [
  { code: 'ControlLeft', label: 'Sneak', toggle: true },
  { code: 'KeyR', label: 'Cast a rune' },
  { code: 'KeyL', label: 'Pick a lock', hold: true },
  { code: 'KeyP', label: 'Lift a purse', hold: true },
  { code: 'KeyC', label: 'Character' },
  { code: 'KeyI', label: 'Pack' },
  { code: 'KeyJ', label: 'Quest log' },
  { code: 'KeyK', label: 'Runes' },
  { code: 'KeyN', label: 'Map' },
  { code: 'KeyT', label: 'Train' },
  { code: 'KeyM', label: 'Mute' },
  { code: 'F5', label: 'Save' },
  { code: 'F9', label: 'Load' },
];

export function createTouch(opts = {}) {
  const doc = typeof document !== 'undefined' ? document : null;
  const state = { x: 0, z: 0, mag: 0, dx: 0, dy: 0 };
  let active = false;           // the overlay is up
  let panel = false;            // a panel owns the screen; the sticks stand down
  let root = null, stick = null, knob = null, moveZone = null, lookZone = null;
  let drawerEl = null, drawerOpen = false;
  const latched = new Set();    // toggles currently pressed down
  let moveId = null, lookId = null;
  let origin = [0, 0], lookAt = [0, 0];

  if (!doc) {
    // Node. The bots do not have thumbs.
    return {
      get active() { return false; }, get mag() { return 0; },
      x: 0, z: 0, drainLook: () => ({ dx: 0, dy: 0 }),
      setPanel() {}, activate() {}, el: null,
    };
  }

  const make = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  /**
   * Wire one button. A tap is a keydown and a keyup a moment later; a hold is a
   * keydown that lasts as long as the finger; a toggle latches until it is
   * pressed again. Both touch and mouse are listened for, so the same overlay
   * can be driven by a finger, by a desk mouse, and by a test harness.
   */
  function wire(btn, def) {
    let down = false;
    const start = (e) => {
      e.preventDefault();
      if (def.toggle) {
        const on = !latched.has(def.code);
        if (on) latched.add(def.code); else latched.delete(def.code);
        btn.classList.toggle('on', on);
        key(def.code, on);
        return;
      }
      if (down) return;
      down = true;
      btn.classList.add('on');
      key(def.code, true);
      // A tap is over before the finger is: holding "Talk" down would open a
      // conversation on every keydown repeat the browser felt like sending.
      if (!def.hold) setTimeout(() => key(def.code, false), 16);
    };
    const end = () => {
      if (!down) return;
      down = false;
      btn.classList.remove('on');
      if (def.hold) key(def.code, false);
    };
    btn.addEventListener('touchstart', start, { passive: false });
    btn.addEventListener('touchend', end);
    btn.addEventListener('touchcancel', end);
    btn.addEventListener('mousedown', start);
    addEventListener('mouseup', end);
    // A finger that slides off the button still lets go of the key.
    addEventListener('touchend', end);
  }

  function build() {
    root = make('div', null); root.id = 'touch'; root.hidden = true;

    lookZone = make('div', 'tz tz-look');
    moveZone = make('div', 'tz tz-move');
    stick = make('div', 'tstick');
    knob = make('i');
    stick.append(knob);
    moveZone.append(stick);

    const hands = make('div', 'thands');
    for (const def of HANDS) {
      const b = make('button', 'tbtn', def.label);
      b.dataset.code = def.code;
      wire(b, def);
      hands.append(b);
    }

    const menu = make('button', 'tmenu', '☰');
    menu.dataset.code = 'menu';
    drawerEl = make('div', 'tdrawer');
    drawerEl.hidden = true;
    for (const def of DRAWER) {
      const b = make('button', 'tbtn', def.label);
      b.dataset.code = def.code;
      wire(b, def);
      drawerEl.append(b);
    }
    const shut = (e) => {
      e.preventDefault();
      drawerOpen = !drawerOpen;
      drawerEl.hidden = !drawerOpen;
      menu.classList.toggle('on', drawerOpen);
    };
    menu.addEventListener('touchstart', shut, { passive: false });
    menu.addEventListener('click', (e) => { if (e.detail) shut(e); });

    root.append(lookZone, moveZone, hands, menu, drawerEl);
    doc.body.append(root);
    listen();
  }

  function setStick(px, py) {
    let dx = px - origin[0], dy = py - origin[1];
    const len = Math.hypot(dx, dy);
    const clamped = Math.min(len, RADIUS);
    if (len > 0) { dx = (dx / len) * clamped; dy = (dy / len) * clamped; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const mag = clamped / RADIUS;
    if (mag < DEAD) { state.x = 0; state.z = 0; state.mag = 0; return; }
    // Rescaled past the dead zone, so the first millimetre of real movement is
    // a crawl rather than a step.
    const m = (mag - DEAD) / (1 - DEAD);
    state.mag = m;
    state.x = (dx / clamped) * m;
    state.z = (-dy / clamped) * m;
  }

  function releaseStick() {
    moveId = null;
    state.x = 0; state.z = 0; state.mag = 0;
    stick.classList.remove('on');
  }

  function listen() {
    moveZone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (moveId !== null) return;
      const t = e.changedTouches[0];
      moveId = t.identifier;
      origin = [t.clientX, t.clientY];
      // The stick is drawn where the thumb landed, not where a designer put it.
      // A fixed pad is a pad you have to look at.
      stick.style.left = `${t.clientX}px`;
      stick.style.top = `${t.clientY}px`;
      stick.classList.add('on');
      setStick(t.clientX, t.clientY);
    }, { passive: false });

    lookZone.addEventListener('touchstart', (e) => {
      if (lookId !== null) return;
      const t = e.changedTouches[0];
      lookId = t.identifier;
      lookAt = [t.clientX, t.clientY];
    }, { passive: false });

    addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === moveId) { setStick(t.clientX, t.clientY); e.preventDefault(); }
        else if (t.identifier === lookId) {
          state.dx += (t.clientX - lookAt[0]) * LOOK;
          state.dy += (t.clientY - lookAt[1]) * LOOK;
          lookAt = [t.clientX, t.clientY];
          e.preventDefault();
        }
      }
    }, { passive: false });

    const lift = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === moveId) releaseStick();
        if (t.identifier === lookId) lookId = null;
      }
    };
    addEventListener('touchend', lift);
    addEventListener('touchcancel', lift);
    // A tab that loses focus must not keep walking north for ever — the same
    // rule the keyboard obeys, for the same reason.
    addEventListener('blur', () => {
      releaseStick(); lookId = null;
      for (const code of latched) key(code, false);
      latched.clear();
      for (const b of root.querySelectorAll('.on')) b.classList.remove('on');
    });
  }

  function activate() {
    if (active) return;
    active = true;
    if (!root) build();
    doc.body.classList.add('touch');
    root.hidden = panel;
  }

  // The overlay waits for a real touch. `?touch=1` is for the harness and for
  // anybody who wants to see it on a desk machine.
  if (opts.force) activate();
  else addEventListener('touchstart', activate, { once: true, capture: true });

  return {
    get active() { return active; },
    get x() { return state.x; },
    get z() { return state.z; },
    get mag() { return state.mag; },
    /** Look accumulated since the last tick, drained the way mouse deltas are. */
    drainLook() {
      const out = { dx: state.dx, dy: state.dy };
      state.dx = 0; state.dy = 0;
      return out;
    },
    /** A panel owns the screen: the sticks and buttons stand down under it. */
    setPanel(open) {
      if (panel === !!open) return;
      panel = !!open;
      if (panel) releaseStick();
      if (root) root.hidden = panel || !active;
    },
    activate,
    get el() { return root; },
  };
}
