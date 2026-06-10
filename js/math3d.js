'use strict';
// ---------------------------------------------------------------------------
// math3d.js — minimal column-major 4x4 matrix + vector math, from scratch.
// ---------------------------------------------------------------------------

function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
function lerp(a, b, t) { return a + (b - a) * t; }
function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

const M4 = {
  ident() {
    return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
  },
  // out = a * b   (column-major)
  mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        o[c*4+r] = a[r]*b[c*4] + a[4+r]*b[c*4+1] + a[8+r]*b[c*4+2] + a[12+r]*b[c*4+3];
      }
    }
    return o;
  },
  chain() {
    let r = arguments[0];
    for (let i = 1; i < arguments.length; i++) r = M4.mul(r, arguments[i]);
    return r;
  },
  translate(x, y, z) {
    const m = M4.ident();
    m[12] = x; m[13] = y; m[14] = z;
    return m;
  },
  scale(x, y, z) {
    const m = M4.ident();
    m[0] = x; m[5] = y; m[10] = z;
    return m;
  },
  rotX(a) {
    const c = Math.cos(a), s = Math.sin(a);
    return new Float32Array([1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1]);
  },
  rotY(a) {
    const c = Math.cos(a), s = Math.sin(a);
    return new Float32Array([c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]);
  },
  rotZ(a) {
    const c = Math.cos(a), s = Math.sin(a);
    return new Float32Array([c,s,0,0, -s,c,0,0, 0,0,1,0, 0,0,0,1]);
  },
  perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    const m = new Float32Array(16);
    m[0] = f / aspect;
    m[5] = f;
    m[10] = (far + near) / (near - far);
    m[11] = -1;
    m[14] = 2 * far * near / (near - far);
    return m;
  },
};

function vcross(a, b) {
  return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
}
function vnorm(a) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0]/l, a[1]/l, a[2]/l];
}
// Camera/character forward: yaw 0 looks down +Z. fwd = (sin yaw, sin pitch, cos yaw)
function fwdVec(yaw, pitch) {
  const cp = Math.cos(pitch);
  return [Math.sin(yaw)*cp, Math.sin(pitch), Math.cos(yaw)*cp];
}
function makeView(eye, yaw, pitch) {
  const f = fwdVec(yaw, pitch);
  const r = vnorm(vcross([0,1,0], f));
  const u = vcross(f, r);
  const m = new Float32Array(16);
  m[0] = r[0]; m[4] = r[1]; m[8]  = r[2]; m[12] = -(r[0]*eye[0] + r[1]*eye[1] + r[2]*eye[2]);
  m[1] = u[0]; m[5] = u[1]; m[9]  = u[2]; m[13] = -(u[0]*eye[0] + u[1]*eye[1] + u[2]*eye[2]);
  m[2] = -f[0]; m[6] = -f[1]; m[10] = -f[2]; m[14] = (f[0]*eye[0] + f[1]*eye[1] + f[2]*eye[2]);
  m[15] = 1;
  return m;
}
// Deterministic seeded PRNG so the world layout is stable between runs.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function hash2(x, z) {
  return (Math.sin(x * 127.1 + z * 311.7) * 43758.5453) % 1 < 0
    ? ((Math.sin(x * 127.1 + z * 311.7) * 43758.5453) % 1) + 1
    : (Math.sin(x * 127.1 + z * 311.7) * 43758.5453) % 1;
}
