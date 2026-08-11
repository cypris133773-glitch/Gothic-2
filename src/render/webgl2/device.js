// The WebGL2 backend. At M0 it draws one lit box, which is a smaller claim than
// it sounds: it proves context creation, shader compilation, attribute layout,
// depth testing, resize handling, an sRGB-correct output and the matrix stack —
// every one of which is a thing that silently produces a black rectangle when
// it is wrong, and none of which gets easier to debug once there is a forest in
// front of it.
//
// WebGL2 is the backend that must work everywhere, so it is the one that ships
// first. The WebGPU backend arrives later behind the same interface (§9.1).

import { link } from './shader.js';
import * as m from '../../core/math.js';

const VERT = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;

uniform mat4 uProj;
uniform mat4 uView;
uniform mat4 uModel;
uniform mat4 uNormal;

out vec3 vNormal;
out vec3 vWorld;

void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  vWorld = world.xyz;
  vNormal = mat3(uNormal) * aNormal;
  gl_Position = uProj * uView * world;
}`;

const FRAG = `#version 300 es
precision highp float;

in vec3 vNormal;
in vec3 vWorld;

uniform vec3 uSunDir;      // toward the sun, normalised
uniform vec3 uSunColor;
uniform vec3 uSkyColor;    // hemisphere ambient, up
uniform vec3 uGroundColor; // hemisphere ambient, down
uniform vec3 uAlbedo;
uniform vec3 uEye;

out vec4 outColor;

// ACES filmic, Narkowicz's fit. The tonemapper is here at M0 rather than added
// later because everything authored under a different response curve has to be
// re-authored when it lands, and that is a whole art pass wasted.
vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(uEye - vWorld);

  float ndl = max(dot(n, uSunDir), 0.0);
  vec3 direct = uSunColor * ndl;

  // A hemisphere ambient rather than a flat constant: the sky lights the tops
  // of things and the ground bounces into their undersides, and the difference
  // between those two terms is most of what makes an object look outdoors.
  vec3 ambient = mix(uGroundColor, uSkyColor, n.y * 0.5 + 0.5);

  // One cheap specular lobe so a surface has a direction, plus a rim term that
  // stands an object off its background the way a real sky does.
  vec3 h = normalize(uSunDir + v);
  float spec = pow(max(dot(n, h), 0.0), 48.0) * 0.25 * step(0.001, ndl);
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0) * 0.18;

  vec3 lit = uAlbedo * (direct + ambient) + uSunColor * spec + uSkyColor * rim;
  outColor = vec4(pow(aces(lit), vec3(1.0 / 2.2)), 1.0);
}`;

// Unit cube, 24 vertices so each face gets its own normal. Interleaved as
// position(3) + normal(3) because one buffer and one stride is one fewer thing
// to get wrong than two buffers.
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
    for (const v of f.v) data.push(v[0] * 0.5, v[1] * 0.5, v[2] * 0.5, f.n[0], f.n[1], f.n[2]);
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
    preserveDrawingBuffer: true, // the screenshot tool reads the buffer after a frame
  });
  if (!gl) throw new Error('WebGL2 context creation returned null');

  const { program, uniforms } = link(gl, VERT, FRAG, 'basic-lit');
  const mesh = cubeMesh();

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, mesh.data, gl.STATIC_DRAW);
  const ibo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.index, gl.STATIC_DRAW);
  const stride = 6 * 4;
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 3 * 4);
  gl.bindVertexArray(null);

  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);

  // Scratch matrices, allocated once. Nothing in draw() allocates (§8.1.4).
  const proj = m.mat4(), view = m.mat4(), model = m.mat4(), nrm = m.mat4(), rotX = m.mat4();
  const eye = m.vec3(2.2, 1.7, 5.0), target = m.vec3(0, 0.7, -0.6), up = m.vec3(0, 1, 0);

  let width = 0, height = 0;
  let drawCalls = 0, triangles = 0;

  function resize(w, h) {
    if (w === width && h === height) return;
    width = canvas.width = w;
    height = canvas.height = h;
    gl.viewport(0, 0, w, h);
  }

  function draw(scene) {
    drawCalls = 0; triangles = 0;
    // Sky colour is time-of-day driven even at M0, because the clock is the one
    // system everything else eventually reads from and it is cheap to wire now.
    const [r, g, b] = scene.skyColor;
    gl.clearColor(r, g, b, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    m.perspective(proj, 60 * m.DEG, width / Math.max(1, height), 0.1, 500);
    m.lookAt(view, eye, target, up);

    gl.useProgram(program);
    gl.uniformMatrix4fv(uniforms.uProj, false, proj);
    gl.uniformMatrix4fv(uniforms.uView, false, view);
    gl.uniform3fv(uniforms.uSunDir, scene.sunDir);
    gl.uniform3fv(uniforms.uSunColor, scene.sunColor);
    gl.uniform3fv(uniforms.uSkyColor, scene.skyLight);
    gl.uniform3fv(uniforms.uGroundColor, scene.groundLight);
    gl.uniform3fv(uniforms.uEye, eye);

    gl.bindVertexArray(vao);
    for (const box of scene.boxes) {
      m.fromRotationY(model, box.yaw);
      if (box.pitch) m.multiply(model, model, m.fromRotationX(rotX, box.pitch));
      // Scale is folded into the rotation columns rather than a fourth matrix
      // multiply; at one box it is noise, at ninety thousand instances it is not.
      // A number scales uniformly, a triple scales per axis — which is what
      // turns the same unit cube into a ground slab, a wall and a fencepost.
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
      gl.drawElements(gl.TRIANGLES, mesh.index.length, gl.UNSIGNED_SHORT, 0);
      drawCalls++; triangles += mesh.index.length / 3;
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
      // Quantised to 5 bits per channel: shading gradients should still produce
      // hundreds of buckets, while sampling noise should not inflate the count.
      seen.add(((px[i] >> 3) << 10) | ((px[i + 1] >> 3) << 5) | (px[i + 2] >> 3));
    }
    const n = px.length / 4;
    return { meanLuma: +(sum / n).toFixed(2), minLuma: min, maxLuma: max, colors: seen.size, sampled: n };
  }

  return {
    backend: 'webgl2',
    gl,
    resize,
    draw,
    readPixelStats,
    get stats() { return { drawCalls, triangles, width, height }; },
  };
}
