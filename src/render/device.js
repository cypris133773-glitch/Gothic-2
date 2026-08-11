// One interface, two backends. Nothing outside src/render/ ever learns which
// one it got.
//
// WebGL2 ships first because it is the one that has to work everywhere; the
// WebGPU backend lands at M9 behind this same function and buys compute-driven
// culling and larger instance counts (§9.1). Writing the abstraction now, while
// there is one box to draw, costs an afternoon. Writing it at M9, over a
// renderer that has grown WebGL assumptions in forty files, costs the project.

import { createWebGL2Device } from './webgl2/device.js';

export async function createDevice(canvas, caps, opts = {}) {
  if (caps.webgpu) {
    // Deliberately not implemented yet, and deliberately not silently ignored:
    // when the WebGPU backend exists this branch constructs it, and until then
    // the log line is how a reader knows the fallback is intentional.
    console.info('[render] WebGPU adapter present; the WebGPU backend lands at M9. Using WebGL2.');
  }
  if (!caps.webgl2) throw new Error('No usable rendering backend (WebGL2 unavailable)');
  return createWebGL2Device(canvas, opts);
}
