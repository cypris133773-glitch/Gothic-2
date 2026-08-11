// The WebGL2 backend.
//
// It draws two things: a terrain mesh with per-vertex colour, and a list of
// oriented boxes. That is a deliberately small vocabulary — every prop, tree,
// rock and character in the game right now is a box — because the point of M2
// is that the world is walkable, and a renderer with one shader and two draw
// paths is one that cannot hide a bug behind its own complexity.
//
// WebGL2 is the backend that has to work everywhere, so it ships first. The
// WebGPU backend arrives at M9 behind the same interface (§9.1), which is why
// nothing outside this directory has ever heard of `gl`.

import { link } from './shader.js';
import * as m from '../../core/math.js';

const VERT = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec3 aColor;

uniform mat4 uProj;
uniform mat4 uView;
uniform mat4 uModel;
uniform mat4 uNormal;

out vec3 vNormal;
out vec3 vWorld;
out vec3 vColor;

void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  vWorld = world.xyz;
  vNormal = mat3(uNormal) * aNormal;
  vColor = aColor;
  gl_Position = uProj * uView * world;
}`;

const FRAG = `#version 300 es
precision highp float;

in vec3 vNormal;
in vec3 vWorld;
in vec3 vColor;

uniform vec3 uSunDir;      // toward the key light, normalised
uniform vec3 uSunColor;
uniform vec3 uSkyColor;    // hemisphere ambient, up
uniform vec3 uGroundColor; // hemisphere ambient, down
uniform vec3 uAlbedo;      // per-draw tint, multiplied by the vertex colour
uniform vec3 uEye;
uniform vec3 uFogColor;

out vec4 outColor;

// ACES filmic, Narkowicz's fit. The tonemapper is here rather than added later
// because everything authored under a different response curve has to be
// re-authored when it lands, and that is an art pass thrown away.
vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  vec3 n = normalize(vNormal);
  vec3 toEye = uEye - vWorld;
  float dist = length(toEye);
  vec3 v = toEye / max(dist, 0.001);

  float ndl = max(dot(n, uSunDir), 0.0);
  vec3 direct = uSunColor * ndl;

  // A hemisphere ambient rather than a flat constant: the sky lights the tops
  // of things and the ground bounces into their undersides. The difference
  // between those two terms is most of what makes an object look outdoors.
  vec3 ambient = mix(uGroundColor, uSkyColor, n.y * 0.5 + 0.5);

  vec3 h = normalize(uSunDir + v);
  float spec = pow(max(dot(n, h), 0.0), 48.0) * 0.18 * step(0.001, ndl);
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0) * 0.14;

  vec3 albedo = uAlbedo * vColor;
  vec3 lit = albedo * (direct + ambient) + uSunColor * spec + uSkyColor * rim;

  // Aerial perspective, cheaply: distance fades toward the sky colour, which is
  // what gives a landscape its depth and what stops distant terrain reading as
  // a painted backdrop.
  float fog = 1.0 - exp(-dist * 0.0055);
  lit = mix(lit, uFogColor, fog * 0.85);

  outColor = vec4(pow(aces(lit), vec3(1.0 / 2.2)), 1.0);
}`;

// Unit cube, 24 vertices so each face keeps its own normal. Interleaved as
// position(3) + normal(3) + colour(3): one buffer, one stride, one thing to get
// wrong instead of three.
function cubeMesh() {
  const faces = [
    { n: [0, 0, 1], v: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
    { n: [0, 0, -1], v: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
    { n: [1, 0, 0], v: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
    { n: [-1, 0, 0], v: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
    { n: [0, 1, 0], v: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
    { n: [0, -1, 0], v: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
  ];
  const data = [];
  const index = [];
  faces.forEach((f, fi) => {
    for (const v of f.v) {
      data.push(v[0] * 0.5, v[1] * 0.5, v[2] * 0.5, f.n[0], f.n[1], f.n[2], 1, 1, 1);
    }
    const b = fi * 4;
    index.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  return { data: new Float32Array(data), index: new Uint16Array(index) };
}

export function createWebGL2Device(canvas) {
  const gl = canvas.getContext('webgl2', {
    antialias: true,
    alpha: false,
    depth: true,
    stencil: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true, // the render gate reads the buffer back
  });
  if (!gl) throw new Error('WebGL2 context creation returned null');

  const { program, uniforms } = link(gl, VERT, FRAG, 'basic-lit');
  const STRIDE = 9 * 4;

  function makeVao(verts, index, indexType) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, index, gl.STATIC_DRAW);
    for (let loc = 0; loc < 3; loc++) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, STRIDE, loc * 3 * 4);
    }
    gl.bindVertexArray(null);
    return { vao, count: index.length, type: indexType };
  }

  const cube = cubeMesh();
  const cubeVao = makeVao(cube.data, cube.index, gl.UNSIGNED_SHORT);
  let chunks = [];

  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);

  // Scratch, allocated once: nothing in draw() allocates (§8.1.4).
  const proj = m.mat4(), view = m.mat4(), model = m.mat4(), nrm = m.mat4();
  const rotX = m.mat4(), ident = m.identity(m.mat4());
  const up = m.vec3(0, 1, 0);
  const white = new Float32Array([1, 1, 1]);

  let width = 0, height = 0;
  let drawCalls = 0, triangles = 0;

  function resize(w, h) {
    if (w === width && h === height) return;
    width = canvas.width = w;
    height = canvas.height = h;
    gl.viewport(0, 0, w, h);
  }

  /** Hand the renderer the terrain chunks. Called when the world is built. */
  function setTerrain(built) {
    for (const c of chunks) gl.deleteVertexArray(c.vao);
    chunks = built.map((c) => makeVao(c.verts, c.index, gl.UNSIGNED_INT));
  }

  function draw(scene) {
    drawCalls = 0; triangles = 0;
    const [r, g, b] = scene.skyColor;
    gl.clearColor(r, g, b, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const cam = scene.camera;
    m.perspective(proj, cam.fov * m.DEG, width / Math.max(1, height), 0.1, 600);
    m.lookAt(view, cam.pos, cam.target, up);

    gl.useProgram(program);
    gl.uniformMatrix4fv(uniforms.uProj, false, proj);
    gl.uniformMatrix4fv(uniforms.uView, false, view);
    gl.uniform3fv(uniforms.uSunDir, scene.sunDir);
    gl.uniform3fv(uniforms.uSunColor, scene.sunColor);
    gl.uniform3fv(uniforms.uSkyColor, scene.skyLight);
    gl.uniform3fv(uniforms.uGroundColor, scene.groundLight);
    gl.uniform3fv(uniforms.uFogColor, scene.skyColor);
    gl.uniform3fv(uniforms.uEye, cam.pos);

    // Terrain first: it is opaque, it covers most of the screen, and drawing it
    // before the props means the depth buffer rejects most of their pixels.
    gl.uniformMatrix4fv(uniforms.uModel, false, ident);
    gl.uniformMatrix4fv(uniforms.uNormal, false, ident);
    gl.uniform3fv(uniforms.uAlbedo, white);
    for (const c of chunks) {
      gl.bindVertexArray(c.vao);
      gl.drawElements(gl.TRIANGLES, c.count, c.type, 0);
      drawCalls++; triangles += c.count / 3;
    }

    gl.bindVertexArray(cubeVao.vao);
    for (const box of scene.boxes) {
      m.fromRotationY(model, box.yaw);
      if (box.pitch) m.multiply(model, model, m.fromRotationX(rotX, box.pitch));
      // Scale folds into the rotation columns rather than costing a fourth
      // matrix multiply. A number scales uniformly, a triple per axis — which
      // is what turns one unit cube into a trunk, a boulder and a torso.
      const s = box.scale;
      const sx = typeof s === 'number' ? s : s[0];
      const sy = typeof s === 'number' ? s : s[1];
      const sz = typeof s === 'number' ? s : s[2];
      for (let i = 0; i < 4; i++) model[i] *= sx;
      for (let i = 4; i < 8; i++) model[i] *= sy;
      for (let i = 8; i < 12; i++) model[i] *= sz;
      m.setTranslation(model, box.pos[0], box.pos[1], box.pos[2]);
      m.normalMatrix(nrm, model);
      gl.uniformMatrix4fv(uniforms.uModel, false, model);
      gl.uniformMatrix4fv(uniforms.uNormal, false, nrm);
      gl.uniform3fv(uniforms.uAlbedo, box.albedo);
      gl.drawElements(gl.TRIANGLES, cubeVao.count, cubeVao.type, 0);
      drawCalls++; triangles += cubeVao.count / 3;
    }
    gl.bindVertexArray(null);
  }

  /**
   * Read the frame back and describe it in numbers.
   *
   * This exists because "the screenshot tool wrote a PNG" is not evidence that
   * anything was drawn — a black rectangle is a perfectly valid PNG. The build
   * gate asks the frame how many distinct colours it contains and how much of
   * it differs from the clear colour, which a black screen cannot fake.
   */
  function readPixelStats() {
    const w = Math.min(width, 320), h = Math.min(height, 180);
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let sum = 0, min = 255, max = 0;
    const seen = new Set();
    for (let i = 0; i < px.length; i += 4) {
      const l = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114);
      sum += l; if (l < min) min = l; if (l > max) max = l;
      // Quantised to 5 bits per channel: shading gradients still produce
      // hundreds of buckets, sampling noise does not inflate the count.
      seen.add(((px[i] >> 3) << 10) | ((px[i + 1] >> 3) << 5) | (px[i + 2] >> 3));
    }
    const n = px.length / 4;
    return { meanLuma: +(sum / n).toFixed(2), minLuma: min, maxLuma: max, colors: seen.size, sampled: n };
  }

  return {
    backend: 'webgl2',
    gl,
    resize,
    setTerrain,
    draw,
    readPixelStats,
    get stats() { return { drawCalls, triangles, width, height }; },
  };
}
