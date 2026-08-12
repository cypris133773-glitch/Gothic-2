// The WebGL2 backend.
//
// Two draw paths: a terrain mesh with per-vertex colour, and a single instanced
// draw for every box in the world. Everything visible that is not ground — a
// character's forearm, a roof beam, a barrel, a sword — is one instance of the
// same unit cube with its own matrix and colour, which is why a town with
// forty buildings and a dozen people in it still costs one draw call.
//
// That instancing is not premature. A humanoid is about twenty parts, a house
// about thirty, and the previous per-box uniform path would have spent nine
// hundred driver crossings on a market square before a single pixel shaded.
//
// WebGL2 is the backend that has to work everywhere, so it ships first. The
// WebGPU backend arrives at M9 behind the same interface (§9.1), which is why
// nothing outside this directory has ever heard of `gl`.

import { link } from './shader.js';
import * as m from '../../core/math.js';
import { buildMaterialArray, MAT, MAT_COUNT } from '../../assets/texgen.js';

const MAX_INSTANCES = 8192;

const VERT = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec3 aColor;
layout(location = 8) in vec2 aWeights;   // terrain only: rock, paved
// Per instance: a mat4 occupies four consecutive attribute slots, because an
// attribute slot is a vec4 and a matrix is simply four of them.
layout(location = 3) in vec4 iM0;
layout(location = 4) in vec4 iM1;
layout(location = 5) in vec4 iM2;
layout(location = 6) in vec4 iM3;
layout(location = 7) in vec4 iTint;   // rgb albedo, a = material index
layout(location = 9) in float iSway;  // 1 for anything the wind moves

uniform mat4 uProj;
uniform mat4 uView;
uniform mat4 uModel;
uniform mat4 uNormal;
uniform mat4 uLightVP;
uniform int uInstanced;
uniform float uTime;

out vec3 vNormal;
out vec3 vWorld;
out vec3 vColor;
out vec4 vLightPos;
out float vMat;
out vec2 vWeights;

void main() {
  vec4 world;
  vec3 normal;
  vec3 tint;
  if (uInstanced == 1) {
    mat4 model = mat4(iM0, iM1, iM2, iM3);
    world = model * vec4(aPos, 1.0);
    // Wind. One global field, sampled by world position, applied only to the
    // top of a swaying instance so the tuft bends rather than slides. Two
    // frequencies summed, because a single sine reads as a machine.
    if (iSway > 0.5 && aPos.y > 0.0) {
      float phase = world.x * 0.7 + world.z * 0.55;
      float gust = sin(uTime * 1.1 + phase) * 0.6 + sin(uTime * 2.7 + phase * 1.9) * 0.25;
      world.xz += vec2(gust, gust * 0.4) * 0.09 * (aPos.y + 0.5);
    }
    // The instance matrices carry uniform-per-axis scale only, so the inverse
    // transpose is not needed: normalising the rotated normal is enough and it
    // saves shipping a second matrix per instance.
    normal = normalize(mat3(model) * aNormal);
    tint = iTint.rgb;
    vMat = iTint.a;          // the material index rides in the tint's alpha
  } else {
    vMat = -1.0;             // terrain picks its material per pixel
    world = uModel * vec4(aPos, 1.0);
    normal = mat3(uNormal) * aNormal;
    tint = aColor;
  }
  vWorld = world.xyz;
  vNormal = normal;
  vColor = tint;
  vWeights = aWeights;
  vLightPos = uLightVP * world;
  gl_Position = uProj * uView * world;
}`;

const FRAG = `#version 300 es
precision highp float;
precision highp sampler2DShadow;
// GLSL ES has no default precision for sampler array types, so leaving this out
// is a compile error rather than a warning. The shader compiler says so, with a
// line number, because every compile in this renderer is checked (§3.2).
precision highp sampler2DArray;

in vec3 vNormal;
in vec3 vWorld;
in vec3 vColor;
in vec4 vLightPos;
in float vMat;
in vec2 vWeights;

uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uGroundColor;
uniform vec3 uEye;
uniform vec3 uFogColor;
uniform sampler2DShadow uShadow;
uniform float uShadowTexel;
uniform int uShadowOn;
uniform float uExposure;
uniform sampler2DArray uMaterials;
uniform float uMatScale[16];
uniform int uTextured;

// Terrain has no per-instance material, so it names the three it blends
// between. Keep these in step with MAT in src/assets/texgen.js.
const float MAT_COBBLE = 4.0;
const float MAT_GRASS = 5.0;
const float MAT_ROCK = 6.0;

out vec4 outColor;

// ACES filmic, Narkowicz's fit. The tonemapper is here rather than added later
// because everything authored under a different response curve has to be
// re-authored when it lands, and that is an art pass thrown away.
vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

float shadowFactor(float ndl) {
  if (uShadowOn == 0) return 1.0;
  vec3 p = vLightPos.xyz / vLightPos.w;
  p = p * 0.5 + 0.5;
  if (p.x < 0.001 || p.x > 0.999 || p.y < 0.001 || p.y > 0.999 || p.z > 1.0) return 1.0;
  // Slope-scaled bias: a surface nearly edge-on to the sun needs far more
  // tolerance than one facing it, and a single constant bias either acnes the
  // first or peters the second off its own shadow.
  float bias = mix(0.0035, 0.0006, ndl);
  float sum = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y)) * uShadowTexel;
      sum += texture(uShadow, vec3(p.xy + o, p.z - bias));
    }
  }
  return sum / 9.0;
}

/**
 * One texture fetch, projected down whichever axis the surface faces most.
 *
 * Full triplanar blending costs three fetches and buys a smooth transition on
 * the 45-degree faces; on a software rasteriser that is most of the frame
 * budget, and on a world made of axis-aligned boxes there are almost no such
 * faces. Dominant-axis it is, and the seam it can produce lives on the corner
 * of a box where a wooden beam already is.
 */
vec3 material(float layer, vec3 p, vec3 n) {
  if (uTextured == 0 || layer < 0.5) return vec3(1.0);   // off, or MAT.FLAT
  float scale = uMatScale[int(layer)];
  vec3 an = abs(n);
  vec2 uv = (an.y > an.x && an.y > an.z) ? p.xz
          : (an.x > an.z) ? p.zy
          : p.xy;
  return texture(uMaterials, vec3(uv * scale, layer)).rgb;
}

void main() {
  vec3 n = normalize(vNormal);
  vec3 toEye = uEye - vWorld;
  float dist = length(toEye);
  vec3 v = toEye / max(dist, 0.001);

  float ndl = max(dot(n, uSunDir), 0.0);
  float shade = shadowFactor(ndl);
  vec3 direct = uSunColor * ndl * shade;

  // A hemisphere ambient rather than a flat constant: the sky lights the tops
  // of things and the ground bounces into their undersides, and the difference
  // between those two terms is most of what makes an object look outdoors.
  vec3 ambient = mix(uGroundColor, uSkyColor, n.y * 0.5 + 0.5);

  vec3 h = normalize(uSunDir + v);
  float spec = pow(max(dot(n, h), 0.0), 42.0) * 0.16 * step(0.001, ndl) * shade;
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0) * 0.12;

  // The terrain chooses its material per pixel from the weights the mesh
  // carries; everything else was told which one it is wearing.
  float layer = vMat;
  if (layer < 0.0) {
    layer = vWeights.y > 0.5 ? MAT_COBBLE : (vWeights.x > 0.5 ? MAT_ROCK : MAT_GRASS);
  }
  vec3 detail = material(layer, vWorld, n);
  vec3 albedo = vColor * detail;

  vec3 lit = albedo * (direct + ambient) + uSunColor * spec + uSkyColor * rim;

  // Exposure, applied before the tonemapper because that is where it belongs.
  // Without it the whole world sat at the top of the ACES curve and the render
  // gate photographed a town in a snowstorm: plaster, cobbles and sky all
  // within a few levels of white.
  lit *= uExposure;

  // A grade, before the tonemapper. Physically-plausible lighting over
  // physically-plausible albedos lands on a frame that is *correct* and dead
  // grey; a little saturation and a warm-shadow, cool-highlight split is what
  // every film and every game does about that, and it costs three lines.
  float luma = dot(lit, vec3(0.2126, 0.7152, 0.0722));
  lit = mix(vec3(luma), lit, 1.35);
  lit *= mix(vec3(1.06, 0.98, 0.92), vec3(0.96, 0.99, 1.05), smoothstep(0.0, 0.6, luma));

  // Aerial perspective, cheaply: distance fades toward the sky, which is what
  // gives a landscape depth and stops far terrain reading as a painted flat.
  // Aerial perspective. Half the previous strength: at 0.0052 per metre a tree
  // a hundred and fifty metres away was already half sky, which reads as haze
  // on a clear morning and flattens exactly the distance the LOD rings were
  // added to show.
  float fog = 1.0 - exp(-dist * 0.0026);
  lit = mix(lit, uFogColor, min(fog, 0.72));

  outColor = vec4(pow(aces(lit), vec3(1.0 / 2.2)), 1.0);
}`;

// The shadow pass writes depth only, so its shaders are the same geometry with
// everything else stripped out.
const SHADOW_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 3) in vec4 iM0;
layout(location = 4) in vec4 iM1;
layout(location = 5) in vec4 iM2;
layout(location = 6) in vec4 iM3;
layout(location = 9) in float iSway;
uniform mat4 uLightVP;
uniform mat4 uModel;
uniform int uInstanced;
uniform float uTime;
void main() {
  vec4 world = uInstanced == 1
    ? mat4(iM0, iM1, iM2, iM3) * vec4(aPos, 1.0)
    : uModel * vec4(aPos, 1.0);
  // The shadow pass sways with the same field, or the grass and its shadow
  // walk away from each other in the wind.
  if (uInstanced == 1 && iSway > 0.5 && aPos.y > 0.0) {
    float phase = world.x * 0.7 + world.z * 0.55;
    float gust = sin(uTime * 1.1 + phase) * 0.6 + sin(uTime * 2.7 + phase * 1.9) * 0.25;
    world.xz += vec2(gust, gust * 0.4) * 0.09 * (aPos.y + 0.5);
  }
  gl_Position = uLightVP * world;
}`;

const SHADOW_FRAG = `#version 300 es
precision highp float;
void main() {}`;


// The sky. A full-screen triangle with a view ray reconstructed per pixel:
// a gradient from horizon to zenith, a warm band low down, a sun disc and its
// glow. It replaces the flat clear colour, which was the single largest area of
// flat colour in the frame and the thing that most made the game look like a
// technical demo rather than a place.
const SKY_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
uniform vec3 uRight, uUp, uFwd;
uniform float uTanHalf, uAspect;
out vec3 vRay;
void main() {
  // One oversized triangle, generated from the vertex index, so the sky needs
  // no geometry of its own.
  vec2 ndc = vec2((gl_VertexID == 1) ? 3.0 : -1.0, (gl_VertexID == 2) ? 3.0 : -1.0);
  vRay = uFwd + uRight * (ndc.x * uTanHalf * uAspect) + uUp * (ndc.y * uTanHalf);
  gl_Position = vec4(ndc, 1.0, 1.0);
}`;

const SKY_FRAG = `#version 300 es
precision highp float;
in vec3 vRay;
uniform vec3 uZenith, uHorizon, uSunColor, uSunDir;
uniform float uExposure;
out vec4 outColor;

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  vec3 r = normalize(vRay);
  float h = clamp(r.y, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(h, 0.42));
  // Below the horizon the sky keeps going, darkening — the ground covers it,
  // but a camera tilted down over a cliff edge should not see a seam.
  col = mix(col * 0.65, col, smoothstep(-0.25, 0.02, r.y));

  float d = max(dot(r, uSunDir), 0.0);
  col += uSunColor * pow(d, 220.0) * 6.0;          // the disc
  col += uSunColor * pow(d, 8.0) * 0.11;           // the glow around it
  col += uHorizon * pow(1.0 - h, 6.0) * 0.35;      // haze piling up at the horizon

  outColor = vec4(pow(aces(col * uExposure), vec3(1.0 / 2.2)), 1.0);
}`;

// Unit cube, 24 vertices so each face keeps its own normal.
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
      data.push(v[0] * 0.5, v[1] * 0.5, v[2] * 0.5, f.n[0], f.n[1], f.n[2], 1, 1, 1, 0, 0);
    }
    const b = fi * 4;
    index.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  return { data: new Float32Array(data), index: new Uint16Array(index) };
}

export function createWebGL2Device(canvas, opts = {}) {
  const gl = canvas.getContext('webgl2', {
    antialias: true, alpha: false, depth: true, stencil: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true, // the render gate reads the buffer back
  });
  if (!gl) throw new Error('WebGL2 context creation returned null');

  const main = link(gl, VERT, FRAG, 'world');
  const shadowProg = link(gl, SHADOW_VERT, SHADOW_FRAG, 'shadow');
  const skyProg = link(gl, SKY_VERT, SKY_FRAG, 'sky');
  const emptyVao = gl.createVertexArray();
  const STRIDE = 11 * 4;    // pos3, normal3, colour3, weights2

  // --- geometry --------------------------------------------------------------

  const instanceData = new Float32Array(MAX_INSTANCES * 24);   // mat4 + tint + sway + pad
  const instanceBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuf);
  gl.bufferData(gl.ARRAY_BUFFER, instanceData.byteLength, gl.DYNAMIC_DRAW);

  function makeVao(verts, index, indexType, instanced) {
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
    gl.enableVertexAttribArray(8);
    gl.vertexAttribPointer(8, 2, gl.FLOAT, false, STRIDE, 9 * 4);
    if (instanced) {
      gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuf);
      for (let i = 0; i < 5; i++) {
        const loc = 3 + i;
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 24 * 4, i * 16);
        gl.vertexAttribDivisor(loc, 1);
      }
      // The sway flag rides in a sixth slot rather than in an unused component
      // of the tint, because the tint's alpha already carries the material.
      gl.enableVertexAttribArray(9);
      gl.vertexAttribPointer(9, 1, gl.FLOAT, false, 24 * 4, 20 * 4);
      gl.vertexAttribDivisor(9, 1);
    }
    gl.bindVertexArray(null);
    return { vao, count: index.length, type: indexType };
  }

  const cube = cubeMesh();
  const cubeVao = makeVao(cube.data, cube.index, gl.UNSIGNED_SHORT, true);
  let chunks = [];

  // --- materials -------------------------------------------------------------
  // Every surface in the game comes out of src/assets/texgen.js, generated here
  // at startup. One array texture, one texture unit, no files.
  const mats = buildMaterialArray();
  const matTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, matTex);
  gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, mats.size, mats.size, mats.layers,
    0, gl.RGBA, gl.UNSIGNED_BYTE, mats.data);
  gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
  const anis = gl.getExtension('EXT_texture_filter_anisotropic');
  if (anis) {
    // Ground planes seen at a grazing angle are exactly where anisotropy pays,
    // and the ground is most of this game's screen.
    gl.texParameterf(gl.TEXTURE_2D_ARRAY, anis.TEXTURE_MAX_ANISOTROPY_EXT,
      Math.min(8, gl.getParameter(anis.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
  }

  // Tiles per metre, per material. Cobbles want to be about the size of a
  // cobble; a chainmail weave wants to be much finer than a plaster wall.
  const MAT_SCALE = new Float32Array(MAT_COUNT);
  MAT_SCALE.fill(0.5);
  MAT_SCALE[MAT.PLASTER] = 0.35;
  MAT_SCALE[MAT.TIMBER] = 0.8;
  MAT_SCALE[MAT.SLATE] = 0.55;
  MAT_SCALE[MAT.COBBLE] = 0.62;
  MAT_SCALE[MAT.GRASS] = 0.42;
  MAT_SCALE[MAT.ROCK] = 0.22;
  MAT_SCALE[MAT.CLOTH] = 2.2;
  MAT_SCALE[MAT.STEEL] = 4.5;
  MAT_SCALE[MAT.LEATHER] = 3.0;
  MAT_SCALE[MAT.PLANK] = 0.9;
  MAT_SCALE[MAT.THATCH] = 0.9;
  MAT_SCALE[MAT.SKIN] = 3.0;
  MAT_SCALE[MAT.BARK] = 1.4;
  MAT_SCALE[MAT.FOLIAGE] = 0.7;
  MAT_SCALE[MAT.DIRT] = 0.4;

  // --- shadow map ------------------------------------------------------------

  const shadowSize = opts.shadowSize || 1024;
  let shadowOn = opts.shadows !== false;
  // Material detail is a quality lever like the shadow pass. It is nearly free
  // on a GPU and it is the most expensive thing in the frame on a software
  // rasteriser — one dependent texture fetch per pixel of a screen that is
  // mostly ground — so the lowest tier goes without it.
  let textured = opts.textures !== false;
  const shadowTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, shadowTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, shadowSize, shadowSize, 0,
    gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  // Comparison sampling: the hardware does the depth test and the bilinear
  // filter in one fetch, which is what makes a 3×3 PCF kernel affordable.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
  const shadowFbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, shadowTex, 0);
  gl.drawBuffers([gl.NONE]);
  gl.readBuffer(gl.NONE);
  const fboStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (fboStatus !== gl.FRAMEBUFFER_COMPLETE) {
    // Depth-only framebuffers are not universally supported; say so rather than
    // rendering a world where every shadow test reads garbage.
    console.warn(`[render] shadow framebuffer incomplete (0x${fboStatus.toString(16)}); shadows off`);
    shadowOn = false;
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);

  // Scratch, allocated once: nothing in draw() allocates (§8.1.4).
  const proj = m.mat4(), view = m.mat4(), lightVP = m.mat4();
  const lightProj = m.mat4(), lightView = m.mat4();
  const ident = m.identity(m.mat4());
  const up = m.vec3(0, 1, 0);
  const lightEye = m.vec3(), lightTarget = m.vec3();
  const genericA = m.mat4(), genericB = m.mat4();

  let width = 0, height = 0;
  let drawCalls = 0, triangles = 0, instances = 0;

  function resize(w, h) {
    if (w === width && h === height) return;
    width = canvas.width = w;
    height = canvas.height = h;
  }

  function setTerrain(built) {
    for (const c of chunks) gl.deleteVertexArray(c.vao);
    chunks = built.map((c) => makeVao(c.verts, c.index, gl.UNSIGNED_INT, false));
  }

  /** Pack the scene's boxes into the instance buffer. Returns the count. */
  function packInstances(boxes) {
    let n = 0;
    for (const box of boxes) {
      if (n >= MAX_INSTANCES) break;
      if (box.invisible) continue;      // collision proxies are not geometry
      const o = n * 24;
      if (box.mat) {
        instanceData.set(box.mat, o);
      } else if (box.roll) {
        // The general path: yaw, then pitch, then roll. Only a handful of parts
        // need three axes (a diagonal timber brace, a tilted awning), so the
        // fast two-axis path below stays the one that runs for every tree.
        m.fromRotationY(genericA, box.yaw || 0);
        m.multiply(genericA, genericA, m.fromRotationX(genericB, box.pitch || 0));
        m.multiply(genericA, genericA, rotationZ(genericB, box.roll));
        const s3 = box.scale;
        const gx = typeof s3 === 'number' ? s3 : s3[0];
        const gy = typeof s3 === 'number' ? s3 : s3[1];
        const gz = typeof s3 === 'number' ? s3 : s3[2];
        for (let i = 0; i < 4; i++) genericA[i] *= gx;
        for (let i = 4; i < 8; i++) genericA[i] *= gy;
        for (let i = 8; i < 12; i++) genericA[i] *= gz;
        genericA[12] = box.pos[0]; genericA[13] = box.pos[1]; genericA[14] = box.pos[2]; genericA[15] = 1;
        instanceData.set(genericA, o);
      } else {
        const s = box.scale;
        const sx = typeof s === 'number' ? s : s[0];
        const sy = typeof s === 'number' ? s : s[1];
        const sz = typeof s === 'number' ? s : s[2];
        const cy = Math.cos(box.yaw || 0), sy2 = Math.sin(box.yaw || 0);
        const cp = Math.cos(box.pitch || 0), sp = Math.sin(box.pitch || 0);
        // Yaw then pitch, written out: this is the hot loop for every prop in
        // the world and a generic compose would cost two matrix multiplies.
        instanceData[o] = cy * sx; instanceData[o + 1] = 0; instanceData[o + 2] = -sy2 * sx; instanceData[o + 3] = 0;
        instanceData[o + 4] = sy2 * sp * sy; instanceData[o + 5] = cp * sy; instanceData[o + 6] = cy * sp * sy; instanceData[o + 7] = 0;
        instanceData[o + 8] = sy2 * cp * sz; instanceData[o + 9] = -sp * sz; instanceData[o + 10] = cy * cp * sz; instanceData[o + 11] = 0;
        instanceData[o + 12] = box.pos[0]; instanceData[o + 13] = box.pos[1];
        instanceData[o + 14] = box.pos[2]; instanceData[o + 15] = 1;
      }
      const a = box.albedo;
      instanceData[o + 16] = a[0]; instanceData[o + 17] = a[1]; instanceData[o + 18] = a[2];
      instanceData[o + 19] = box.tex || 0;
      instanceData[o + 20] = box.sway || 0;
      n++;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, instanceData.subarray(0, n * 24));
    return n;
  }

  /**
   * Fit the light's orthographic frustum around the player.
   *
   * One cascade covering a fixed radius, snapped to whole texels — without the
   * snap the whole shadow map crawls as the camera moves, which is far more
   * noticeable than the shadows being slightly coarse.
   */
  function fitLight(scene) {
    const R = 42, focus = scene.shadowFocus || scene.camera.target;
    const d = scene.sunDir;
    const texel = (R * 2) / shadowSize;
    const fx = Math.round(focus[0] / texel) * texel;
    const fz = Math.round(focus[2] / texel) * texel;
    m.v3set(lightTarget, fx, focus[1], fz);
    m.v3set(lightEye, fx + d[0] * 80, focus[1] + d[1] * 80, fz + d[2] * 80);
    orthographic(lightProj, -R, R, -R, R, 1, 200);
    m.lookAt(lightView, lightEye, lightTarget, up);
    m.multiply(lightVP, lightProj, lightView);
  }

  function draw(scene) {
    drawCalls = 0; triangles = 0;
    instances = packInstances(scene.boxes);
    fitLight(scene);

    // --- shadow pass ---------------------------------------------------------
    if (shadowOn) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFbo);
      gl.viewport(0, 0, shadowSize, shadowSize);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      // Front-face culling in the shadow pass pushes acne to the back of
      // objects, where nothing can see it.
      gl.cullFace(gl.FRONT);
      gl.useProgram(shadowProg.program);
      gl.uniformMatrix4fv(shadowProg.uniforms.uLightVP, false, lightVP);
      gl.uniform1f(shadowProg.uniforms.uTime, scene.time ?? 0);

      gl.uniform1i(shadowProg.uniforms.uInstanced, 0);
      gl.uniformMatrix4fv(shadowProg.uniforms.uModel, false, ident);
      for (const c of chunks) {
        gl.bindVertexArray(c.vao);
        gl.drawElements(gl.TRIANGLES, c.count, c.type, 0);
        drawCalls++;
      }
      gl.uniform1i(shadowProg.uniforms.uInstanced, 1);
      gl.bindVertexArray(cubeVao.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, cubeVao.count, cubeVao.type, 0, instances);
      drawCalls++;
      gl.cullFace(gl.BACK);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    // --- main pass -----------------------------------------------------------
    gl.viewport(0, 0, width, height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const cam = scene.camera;
    const aspect = width / Math.max(1, height);
    m.perspective(proj, cam.fov * m.DEG, aspect, 0.1, 600);
    m.lookAt(view, cam.pos, cam.target, up);

    // Sky first, with depth writes off: it is infinitely far away and every
    // other pixel in the frame is allowed to draw over it.
    gl.depthMask(false);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(skyProg.program);
    gl.uniform3f(skyProg.uniforms.uRight, view[0], view[4], view[8]);
    gl.uniform3f(skyProg.uniforms.uUp, view[1], view[5], view[9]);
    gl.uniform3f(skyProg.uniforms.uFwd, -view[2], -view[6], -view[10]);
    gl.uniform1f(skyProg.uniforms.uTanHalf, Math.tan((cam.fov * m.DEG) / 2));
    gl.uniform1f(skyProg.uniforms.uAspect, aspect);
    gl.uniform3fv(skyProg.uniforms.uZenith, scene.zenith || scene.skyColor);
    gl.uniform3fv(skyProg.uniforms.uHorizon, scene.skyColor);
    gl.uniform3fv(skyProg.uniforms.uSunColor, scene.sunColor);
    gl.uniform3fv(skyProg.uniforms.uSunDir, scene.sunDir);
    gl.uniform1f(skyProg.uniforms.uExposure, scene.exposure ?? 0.27);
    gl.bindVertexArray(emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    drawCalls++;

    gl.useProgram(main.program);
    gl.uniformMatrix4fv(main.uniforms.uProj, false, proj);
    gl.uniformMatrix4fv(main.uniforms.uView, false, view);
    gl.uniformMatrix4fv(main.uniforms.uLightVP, false, lightVP);
    gl.uniform3fv(main.uniforms.uSunDir, scene.sunDir);
    gl.uniform3fv(main.uniforms.uSunColor, scene.sunColor);
    gl.uniform3fv(main.uniforms.uSkyColor, scene.skyLight);
    gl.uniform3fv(main.uniforms.uGroundColor, scene.groundLight);
    gl.uniform3fv(main.uniforms.uFogColor, scene.skyColor);
    gl.uniform3fv(main.uniforms.uEye, cam.pos);
    gl.uniform1i(main.uniforms.uShadowOn, shadowOn ? 1 : 0);
    gl.uniform1f(main.uniforms.uShadowTexel, 1 / shadowSize);
    gl.uniform1f(main.uniforms.uExposure, scene.exposure ?? 0.27);
    gl.uniform1f(main.uniforms.uTime, scene.time ?? 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, shadowTex);
    gl.uniform1i(main.uniforms.uShadow, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, matTex);
    gl.uniform1i(main.uniforms.uMaterials, 1);
    gl.uniform1fv(main.uniforms.uMatScale, MAT_SCALE);
    gl.uniform1i(main.uniforms.uTextured, textured ? 1 : 0);

    // Terrain first: opaque, covers most of the screen, and drawing it before
    // the props means the depth buffer rejects most of their pixels.
    gl.uniform1i(main.uniforms.uInstanced, 0);
    gl.uniformMatrix4fv(main.uniforms.uModel, false, ident);
    gl.uniformMatrix4fv(main.uniforms.uNormal, false, ident);
    for (const c of chunks) {
      gl.bindVertexArray(c.vao);
      gl.drawElements(gl.TRIANGLES, c.count, c.type, 0);
      drawCalls++; triangles += c.count / 3;
    }

    gl.uniform1i(main.uniforms.uInstanced, 1);
    gl.bindVertexArray(cubeVao.vao);
    gl.drawElementsInstanced(gl.TRIANGLES, cubeVao.count, cubeVao.type, 0, instances);
    drawCalls++; triangles += (cubeVao.count / 3) * instances;
    gl.bindVertexArray(null);
  }

  /**
   * Read the frame back and describe it in numbers, for the render gate.
   *
   * It samples the *whole* framebuffer on a stride rather than a corner of it.
   * The first version read the bottom-left 320×180, which is sky in some
   * framings and ground in others — so its mean luminance disagreed with the
   * decoded screenshot by forty levels the moment the world stopped being a
   * uniform field of boxes, and the gate's own cross-check caught it.
   */
  function readPixelStats() {
    const px = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const stride = Math.max(1, Math.floor((width * height) / 60000)) * 4;
    let sum = 0, min = 255, max = 0, n = 0;
    const seen = new Set();
    for (let i = 0; i < px.length; i += stride) {
      const l = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114);
      sum += l; if (l < min) min = l; if (l > max) max = l; n++;
      seen.add(((px[i] >> 3) << 10) | ((px[i + 1] >> 3) << 5) | (px[i + 2] >> 3));
    }
    return { meanLuma: +(sum / n).toFixed(2), minLuma: min, maxLuma: max, colors: seen.size, sampled: n };
  }

  return {
    backend: 'webgl2',
    gl,
    resize, setTerrain, draw, readPixelStats,
    get shadows() { return shadowOn; },
    set shadows(v) { shadowOn = !!v; },
    get textured() { return textured; },
    set textured(v) { textured = !!v; },
    get stats() { return { drawCalls, triangles, instances, width, height }; },
  };
}

function rotationZ(out, rad) {
  const s = Math.sin(rad), c = Math.cos(rad);
  m.identity(out);
  out[0] = c; out[1] = s; out[4] = -s; out[5] = c;
  return out;
}

/** Orthographic projection with a [-1, 1] depth range, for the light. */
function orthographic(out, left, right, bottom, top, near, far) {
  out.fill(0);
  out[0] = 2 / (right - left);
  out[5] = 2 / (top - bottom);
  out[10] = -2 / (far - near);
  out[12] = -(right + left) / (right - left);
  out[13] = -(top + bottom) / (top - bottom);
  out[14] = -(far + near) / (far - near);
  out[15] = 1;
  return out;
}
