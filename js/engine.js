'use strict';
// ---------------------------------------------------------------------------
// engine.js — hand-rolled WebGL2 renderer: shaders, mesh builders, programs.
// ---------------------------------------------------------------------------

let gl = null;
let canvas = null;
const PROG = {};
const MESH = {};

// Touch device when the primary pointer is coarse (phones/tablets).
// Touchscreen laptops keep mouse controls. ?touch forces it for testing.
const IS_TOUCH = window.matchMedia('(pointer: coarse)').matches
  || window.location.search.indexOf('touch') >= 0;

// Automated test / screenshot modes: no networking, no saved progress.
const IS_TEST_MODE = /[?&](autotest|dlgshot|invshot|chrshot|oreshot|fbshot)/.test(window.location.search);

const VS_WORLD = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNorm;
layout(location=2) in vec3 aCol;
uniform mat4 uProj, uView, uModel;
out vec3 vNorm;
out vec3 vCol;
out vec3 vWorld;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vWorld = w.xyz;
  vNorm = mat3(uModel) * aNorm;
  vCol = aCol;
  gl_Position = uProj * uView * w;
}`;

const FS_LIT = `#version 300 es
precision highp float;
in vec3 vNorm;
in vec3 vCol;
in vec3 vWorld;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uAmb;
uniform vec3 uCamPos;
uniform vec3 uFogCol;
uniform float uFogDen;
uniform vec3 uTint;
uniform vec3 uLightPos[8];
uniform vec3 uLightCol[8];
out vec4 frag;
void main() {
  vec3 n = normalize(vNorm);
  float dif = max(dot(n, uSunDir), 0.0);
  vec3 light = uAmb + uSunCol * dif;
  for (int i = 0; i < 8; i++) {
    vec3 d = uLightPos[i] - vWorld;
    float dist2 = dot(d, d);
    float att = 1.0 / (1.0 + dist2 * 0.035);
    light += uLightCol[i] * max(dot(n, normalize(d)), 0.0) * att;
  }
  vec3 col = vCol * uTint * light;
  float fd = length(vWorld - uCamPos);
  float fog = 1.0 - exp(-fd * fd * uFogDen * uFogDen);
  col = mix(col, uFogCol, fog);
  frag = vec4(col, 1.0);
}`;

const FS_FLAT = `#version 300 es
precision highp float;
in vec3 vCol;
in vec3 vWorld;
uniform vec3 uTint;
uniform float uAlpha;
out vec4 frag;
void main() {
  frag = vec4(vCol * uTint, uAlpha);
}`;

const FS_BARRIER = `#version 300 es
precision highp float;
in vec3 vNorm;
in vec3 vWorld;
uniform vec3 uCamPos;
uniform float uTime;
out vec4 frag;
void main() {
  vec3 n = normalize(vNorm);
  vec3 v = normalize(uCamPos - vWorld);
  float fr = pow(1.0 - abs(dot(n, v)), 2.2);
  float bands = 0.5 + 0.5 * sin(vWorld.y * 0.22 - uTime * 1.4
                 + sin(vWorld.x * 0.07) + cos(vWorld.z * 0.07));
  float a = fr * (0.30 + 0.45 * bands) + 0.015;
  frag = vec4(vec3(0.35, 0.55, 1.0) * a, 1.0);
}`;

const FS_WATER = `#version 300 es
precision highp float;
in vec3 vWorld;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uAmb;
uniform vec3 uFogCol;
uniform float uFogDen;
uniform float uTime;
out vec4 frag;
void main() {
  vec3 n = normalize(vec3(
    sin(vWorld.x * 0.8 + uTime * 1.6) * 0.05 + sin(vWorld.z * 0.45 + uTime * 1.1) * 0.04,
    1.0,
    cos(vWorld.z * 0.7 + uTime * 1.3) * 0.05 + cos(vWorld.x * 0.5 - uTime * 0.9) * 0.04));
  vec3 v = normalize(uCamPos - vWorld);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  vec3 base = mix(vec3(0.04, 0.13, 0.18), vec3(0.10, 0.30, 0.38), fres);
  vec3 r = reflect(-uSunDir, n);
  float spec = pow(max(dot(r, v), 0.0), 64.0);
  vec3 col = base * (uAmb * 2.0 + uSunCol) + uSunCol * spec * 0.8;
  float fd = length(vWorld - uCamPos);
  float fog = 1.0 - exp(-fd * fd * uFogDen * uFogDen);
  col = mix(col, uFogCol, fog);
  frag = vec4(col, 0.78);
}`;

const VS_SKY = `#version 300 es
layout(location=0) in vec2 aPos;
uniform vec3 uCamFwd, uCamRight, uCamUp;
uniform float uTanFov, uAspect;
out vec3 vDir;
void main() {
  vDir = uCamFwd + uCamRight * aPos.x * uTanFov * uAspect + uCamUp * aPos.y * uTanFov;
  gl_Position = vec4(aPos, 0.99999, 1.0);
}`;

const FS_SKY = `#version 300 es
precision highp float;
in vec3 vDir;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform float uNight;
out vec4 frag;
void main() {
  vec3 d = normalize(vDir);
  float t = clamp(d.y, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(t, 0.55));
  if (d.y < 0.0) col = mix(uHorizon, uHorizon * 0.35, clamp(-d.y * 3.0, 0.0, 1.0));
  float s = max(dot(d, uSunDir), 0.0);
  col += uSunCol * (pow(s, 800.0) * 8.0 + pow(s, 10.0) * 0.25);
  float m = max(dot(d, -uSunDir), 0.0);
  col += vec3(0.75, 0.80, 0.88) * pow(m, 1500.0) * 2.5 * uNight;
  vec3 cell = floor(d * 180.0);
  float hsh = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  col += vec3(smoothstep(0.9974, 1.0, hsh)) * uNight * step(0.05, d.y) * 0.8;
  frag = vec4(col, 1.0);
}`;

function makeProgram(vsSrc, fsSrc) {
  function sh(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error('Shader compile failed: ' + gl.getShaderInfoLog(s));
    }
    return s;
  }
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('Program link failed: ' + gl.getProgramInfoLog(p));
  }
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    u[info.name.replace('[0]', '')] = gl.getUniformLocation(p, info.name);
  }
  return { prog: p, u: u };
}

// Interleaved mesh: 9 floats per vertex (pos3, normal3, color3).
class Mesh {
  constructor(floats) {
    const data = floats instanceof Float32Array ? floats : new Float32Array(floats);
    this.count = data.length / 9;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 36, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 36, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 36, 24);
    gl.bindVertexArray(null);
  }
  draw() {
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, this.count);
  }
}

// ---- geometry builders (push into g.v) ------------------------------------

function pushTri(g, a, b, c, col) {
  const ux = b[0]-a[0], uy = b[1]-a[1], uz = b[2]-a[2];
  const vx = c[0]-a[0], vy = c[1]-a[1], vz = c[2]-a[2];
  let nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l; ny /= l; nz /= l;
  g.v.push(a[0],a[1],a[2], nx,ny,nz, col[0],col[1],col[2]);
  g.v.push(b[0],b[1],b[2], nx,ny,nz, col[0],col[1],col[2]);
  g.v.push(c[0],c[1],c[2], nx,ny,nz, col[0],col[1],col[2]);
}
function pushQuad(g, a, b, c, d, col) {
  pushTri(g, a, b, c, col);
  pushTri(g, a, c, d, col);
}

// Axis box, optionally yawed around its own center.
function addBox(g, cx, cy, cz, sx, sy, sz, col, yaw) {
  yaw = yaw || 0;
  const cyw = Math.cos(yaw), syw = Math.sin(yaw);
  const cs = [];
  for (let i = 0; i < 8; i++) {
    const lx = ((i & 1) ? 0.5 : -0.5) * sx;
    const ly = ((i & 2) ? 0.5 : -0.5) * sy;
    const lz = ((i & 4) ? 0.5 : -0.5) * sz;
    cs.push([cx + lx*cyw + lz*syw, cy + ly, cz - lx*syw + lz*cyw]);
  }
  pushQuad(g, cs[0], cs[2], cs[3], cs[1], col); // -Z
  pushQuad(g, cs[4], cs[5], cs[7], cs[6], col); // +Z
  pushQuad(g, cs[0], cs[4], cs[6], cs[2], col); // -X
  pushQuad(g, cs[1], cs[3], cs[7], cs[5], col); // +X
  pushQuad(g, cs[0], cs[1], cs[5], cs[4], col); // -Y
  pushQuad(g, cs[2], cs[6], cs[7], cs[3], col); // +Y
}

// Cylinder/cone. rTop=0 makes a cone. Base at (x,y,z), grows up by h.
function addCylinder(g, x, y, z, r, h, segs, col, rTop) {
  if (rTop === undefined) rTop = r;
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs * Math.PI * 2;
    const t1 = (i + 1) / segs * Math.PI * 2;
    const b0 = [x + r * Math.cos(t0), y, z + r * Math.sin(t0)];
    const b1 = [x + r * Math.cos(t1), y, z + r * Math.sin(t1)];
    const u0 = [x + rTop * Math.cos(t0), y + h, z + rTop * Math.sin(t0)];
    const u1 = [x + rTop * Math.cos(t1), y + h, z + rTop * Math.sin(t1)];
    pushQuad(g, b1, b0, u0, u1, col);
    if (rTop > 0.01) pushTri(g, [x, y + h, z], u1, u0, col);
  }
}

// 4-sided pyramid roof on a yawed rectangular base.
function addPyramid(g, cx, cy, cz, sx, sz, h, col, yaw) {
  yaw = yaw || 0;
  const cyw = Math.cos(yaw), syw = Math.sin(yaw);
  function pt(lx, lz) {
    return [cx + lx*cyw + lz*syw, cy, cz - lx*syw + lz*cyw];
  }
  const A = pt(-sx/2, -sz/2), B = pt(sx/2, -sz/2), C = pt(sx/2, sz/2), D = pt(-sx/2, sz/2);
  const apex = [cx, cy + h, cz];
  pushTri(g, B, A, apex, col);
  pushTri(g, C, B, apex, col);
  pushTri(g, D, C, apex, col);
  pushTri(g, A, D, apex, col);
  pushQuad(g, A, B, C, D, col); // underside
}

function addDome(g, radius, latSegs, lonSegs, col) {
  for (let la = 0; la < latSegs; la++) {
    const p0 = la / latSegs * Math.PI / 2;
    const p1 = (la + 1) / latSegs * Math.PI / 2;
    for (let lo = 0; lo < lonSegs; lo++) {
      const t0 = lo / lonSegs * Math.PI * 2;
      const t1 = (lo + 1) / lonSegs * Math.PI * 2;
      function sp(ph, th) {
        return [radius * Math.cos(ph) * Math.cos(th), radius * Math.sin(ph),
                radius * Math.cos(ph) * Math.sin(th)];
      }
      pushQuad(g, sp(p0, t1), sp(p0, t0), sp(p1, t0), sp(p1, t1), col);
    }
  }
}

// ---- engine init -----------------------------------------------------------

function initEngine() {
  canvas = document.getElementById('c');
  gl = canvas.getContext('webgl2', { antialias: true });
  if (!gl) {
    document.getElementById('errbox').style.display = 'block';
    document.getElementById('errbox').textContent = 'WebGL2 is not available in this browser.';
    throw new Error('WebGL2 unavailable');
  }
  PROG.lit = makeProgram(VS_WORLD, FS_LIT);
  PROG.flat = makeProgram(VS_WORLD, FS_FLAT);
  PROG.barrier = makeProgram(VS_WORLD, FS_BARRIER);
  PROG.water = makeProgram(VS_WORLD, FS_WATER);
  PROG.sky = makeProgram(VS_SKY, FS_SKY);

  // unit cube (white) — every character body part is a tinted instance of this
  const gc = { v: [] };
  addBox(gc, 0, 0, 0, 1, 1, 1, [1, 1, 1]);
  MESH.cube = new Mesh(gc.v);

  // unit flame cone (white, tinted at draw time)
  const gf = { v: [] };
  addCylinder(gf, 0, 0, 0, 0.5, 1, 7, [1, 1, 1], 0);
  MESH.flame = new Mesh(gf.v);

  // barrier dome (unit radius, scaled by model matrix)
  const gd = { v: [] };
  addDome(gd, 1, 10, 28, [1, 1, 1]);
  MESH.dome = new Mesh(gd.v);

  // fullscreen triangle for the sky
  MESH.skyTri = { vao: gl.createVertexArray() };
  gl.bindVertexArray(MESH.skyTri.vao);
  const vb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.disable(gl.CULL_FACE);

  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
}

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, IS_TOUCH ? 1.25 : 1.5);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = window.innerWidth + 'px';
  canvas.style.height = window.innerHeight + 'px';
  gl.viewport(0, 0, canvas.width, canvas.height);
}
