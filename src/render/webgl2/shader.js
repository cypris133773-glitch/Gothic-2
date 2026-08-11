// Shader compilation that cannot fail silently.
//
// A shader that fails to compile and is never checked produces a black screen
// and no error, which is the most expensive bug in graphics programming because
// it looks exactly like twelve other bugs. Every compile and every link is
// checked here, and the throw carries the driver's log next to a numbered
// listing of the source, so the line number in the log means something.

export function compile(gl, type, src, name) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`${name} failed to compile:\n${log}\n\n${numbered(src)}`);
  }
  return shader;
}

export function link(gl, vertSrc, fragSrc, name) {
  const vs = compile(gl, gl.VERTEX_SHADER, vertSrc, `${name} (vertex)`);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragSrc, `${name} (fragment)`);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`${name} failed to link:\n${log}`);
  }
  // The shader objects are reference-counted by the program once attached, so
  // dropping them here is correct and keeps the driver's object table small.
  gl.detachShader(program, vs); gl.deleteShader(vs);
  gl.detachShader(program, fs); gl.deleteShader(fs);

  const uniforms = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(program, i);
    uniforms[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(program, info.name);
  }
  return { program, uniforms };
}

const numbered = (src) => src.split('\n')
  .map((line, i) => `${String(i + 1).padStart(4)} | ${line}`)
  .join('\n');
