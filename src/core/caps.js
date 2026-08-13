// The first code that runs. Everything else in the project is allowed to assume
// the answers in here and nothing else about the machine.
//
// Feature detection rather than user-agent sniffing, and every capability has a
// real failure path: no WebGL2 is a readable refusal page, no audio is a silent
// game, no storage is an in-memory save with one warning, no pointer lock is a
// click-to-steer fallback. A browser API that "should be there" is the single
// most common way a project like this ships a black rectangle.

export async function detect() {
  const caps = {
    webgpu: false,
    adapter: null,
    webgl2: false,
    audio: false,
    storage: false,
    workers: typeof Worker === 'function',
    pointerLock: typeof Element !== 'undefined' && 'requestPointerLock' in Element.prototype,
    touch: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
    cores: (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2,
    memoryGB: (typeof navigator !== 'undefined' && navigator.deviceMemory) || null,
    dpr: (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1,
  };

  if (typeof navigator !== 'undefined' && navigator.gpu) {
    try {
      // requestAdapter resolves to null rather than rejecting when there is no
      // usable adapter — a real case on Linux Firefox and in software-rendered
      // CI — so both the null and the throw have to be handled.
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      caps.adapter = adapter;
      caps.webgpu = !!adapter;
    } catch {
      caps.webgpu = false;
    }
  }

  if (typeof document !== 'undefined') {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2', { antialias: false, failIfMajorPerformanceCaveat: false });
    caps.webgl2 = !!gl;
    if (gl) {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      caps.gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      caps.maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      // Releasing the probe context matters: browsers cap the number of live
      // WebGL contexts per page, and the real one has not been created yet.
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  }

  caps.audio = typeof window !== 'undefined'
    && typeof (window.AudioContext || window.webkitAudioContext) === 'function';

  try {
    // Throws in some private-browsing modes rather than returning zero.
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) await navigator.storage.estimate();
    caps.storage = typeof indexedDB !== 'undefined';
  } catch {
    caps.storage = false;
  }

  return caps;
}

/**
 * The quality tier a machine gets before any benchmark has run. The startup
 * benchmark may move it afterwards; the player may override it at any time.
 */
export function initialTier(caps) {
  if (!caps.webgl2) return 'low';
  // A phone is not a weak desktop. The GPU in a current one draws this world
  // without complaining; what it cannot afford is the *pixels* — a 3× device
  // ratio on a 900-point screen is four times the fragments a laptop shades.
  // So a touch device with real cores keeps its textures, and the saving is
  // taken in the render scale and the shadow pass instead (see main.js).
  if (caps.touch) return caps.cores >= 6 ? 'medium' : 'low';
  if (caps.webgpu && caps.cores >= 8) return 'high';
  if (caps.cores >= 8) return 'medium';
  return 'low';
}

/** Why we refuse, in words a player can act on, or null when we can run. */
export function refusalReason(caps) {
  if (!caps.webgl2 && !caps.webgpu) {
    return 'This game needs WebGL 2, and this browser did not provide it. '
      + 'Hardware acceleration is usually the cause — check it is enabled, or try '
      + 'a current Chrome, Edge, Firefox or Safari.';
  }
  return null;
}
