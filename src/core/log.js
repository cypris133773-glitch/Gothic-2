// The developer overlay and a bounded log.
//
// Half the debugging in a project like this happens by looking at numbers on
// screen rather than by adding a print statement and reloading, so the overlay
// exists at M0 and grows a line every time a system does. The log is a ring
// buffer because a game loop that logs once a frame will otherwise eat the tab.

const RING = 64;
const lines = [];

export function log(msg) {
  lines.push(msg);
  if (lines.length > RING) lines.shift();
}

export function recent(n = 8) {
  return lines.slice(-n);
}

/** A frame-time window that reports percentiles rather than an average. */
export class FrameTimer {
  constructor(size = 120) {
    this.samples = new Float32Array(size);
    this.n = 0;
    this.sorted = new Float32Array(size);
  }

  push(ms) {
    this.samples[this.n % this.samples.length] = ms;
    this.n++;
  }

  /** p50/p95/p99 over the window. An average hides exactly the spikes we care about. */
  percentiles() {
    const count = Math.min(this.n, this.samples.length);
    if (!count) return { p50: 0, p95: 0, p99: 0 };
    this.sorted.set(this.samples.subarray(0, count));
    const view = this.sorted.subarray(0, count);
    view.sort();
    const at = (p) => view[Math.min(count - 1, Math.floor(count * p))];
    return { p50: at(0.5), p95: at(0.95), p99: at(0.99) };
  }
}

export function createOverlay(el) {
  let visible = true;
  return {
    get visible() { return visible; },
    toggle() { visible = !visible; el.style.display = visible ? '' : 'none'; },
    render(fields) {
      if (!visible) return;
      el.textContent = Object.entries(fields)
        .map(([k, v]) => `${k.padEnd(11)} ${v}`)
        .join('\n');
    },
  };
}
