'use strict';
// ---------------------------------------------------------------------------
// character.js — articulated low-poly characters (humans, molerats).
// Every body part is the unit cube, posed with matrices and tinted.
// ---------------------------------------------------------------------------

function tintCol(base, flash) {
  if (!flash || flash <= 0) return base;
  const f = clamp(flash, 0, 1);
  return [lerp(base[0], 1.0, f), lerp(base[1], 0.15, f), lerp(base[2], 0.15, f)];
}

function drawPart(model, col) {
  gl.uniformMatrix4fv(PROG.lit.u.uModel, false, model);
  gl.uniform3f(PROG.lit.u.uTint, col[0], col[1], col[2]);
  MESH.cube.draw();
}

// Attack arm angle: windup then strike. t in [0,1].
function attackAngle(t) {
  return 0.7 - 2.6 * Math.sin(Math.min(t, 1) * Math.PI);
}

function drawHumanoid(c) {
  const a = c.anim;
  const bob = Math.abs(Math.sin(a.walkPhase)) * 0.06 * a.moveAmt;
  let base = M4.mul(M4.translate(c.pos.x, c.pos.y + bob - a.deadT * 0.25, c.pos.z), M4.rotY(c.yaw));
  if (a.deadT > 0) {
    base = M4.mul(base, M4.rotX(-a.deadT * Math.PI / 2)); // falls onto its back
  }
  const cols = c.colors;
  const flash = a.flash;
  const swing = Math.sin(a.walkPhase) * 0.7 * a.moveAmt;

  // legs (pivot at hip, y = 0.9)
  for (const s of [-1, 1]) {
    const m = M4.chain(base, M4.translate(s * 0.13, 0.9, 0), M4.rotX(swing * s),
                       M4.translate(0, -0.45, 0), M4.scale(0.17, 0.9, 0.17));
    drawPart(m, tintCol(cols.legs, flash));
  }
  // torso
  drawPart(M4.chain(base, M4.translate(0, 1.225, 0), M4.scale(0.48, 0.65, 0.27)),
           tintCol(cols.torso, flash));
  // belt
  drawPart(M4.chain(base, M4.translate(0, 0.93, 0), M4.scale(0.50, 0.09, 0.29)),
           tintCol([0.2, 0.15, 0.1], flash));
  // head + hair
  drawPart(M4.chain(base, M4.translate(0, 1.70, 0), M4.scale(0.26, 0.27, 0.26)),
           tintCol(cols.skin, flash));
  drawPart(M4.chain(base, M4.translate(0, 1.80, -0.03), M4.scale(0.28, 0.12, 0.24)),
           tintCol(cols.hair, flash));
  if (c.helmet) {
    drawPart(M4.chain(base, M4.translate(0, 1.82, 0), M4.scale(0.30, 0.14, 0.30)),
             tintCol([0.45, 0.42, 0.40], flash));
  }
  // arms (pivot at shoulder, y = 1.45)
  for (const s of [-1, 1]) {
    let ang = -swing * s;
    if (s === 1 && a.attackT > 0) ang = attackAngle(a.attackT);
    const shoulder = M4.chain(base, M4.translate(s * 0.31, 1.45, 0), M4.rotX(ang));
    drawPart(M4.chain(shoulder, M4.translate(0, -0.33, 0), M4.scale(0.14, 0.66, 0.14)),
             tintCol(cols.sleeves || cols.torso, flash));
    drawPart(M4.chain(shoulder, M4.translate(0, -0.70, 0), M4.scale(0.13, 0.16, 0.14)),
             tintCol(cols.skin, flash));
    // sword in the right hand
    if (s === 1 && c.hasSword && a.deadT <= 0) {
      drawPart(M4.chain(shoulder, M4.translate(0, -0.80, 0), M4.scale(0.16, 0.05, 0.05)),
               tintCol([0.35, 0.28, 0.18], flash)); // crossguard
      drawPart(M4.chain(shoulder, M4.translate(0, -1.26, 0), M4.scale(0.055, 0.88, 0.025)),
               tintCol([0.65, 0.66, 0.70], flash)); // blade
    }
    // lit torch in the left (off) hand
    if (s === -1 && c.torchLit && a.deadT <= 0) {
      drawPart(M4.chain(shoulder, M4.translate(0, -0.86, 0.10), M4.rotX(-0.5),
                        M4.scale(0.06, 0.62, 0.06)),
               tintCol([0.30, 0.22, 0.13], flash)); // shaft
      drawPart(M4.chain(shoulder, M4.translate(0, -0.62, 0.34), M4.rotX(-0.5),
                        M4.scale(0.11, 0.14, 0.11)),
               tintCol([1.0, 0.55, 0.12], flash)); // ember head
    }
  }
}

// Where a character's torch flame sits in world space (matches the pose above).
function torchWorldPos(c) {
  const s = Math.sin(c.yaw), co = Math.cos(c.yaw);
  const lx = -0.31, ly = 1.45 - 0.55, lz = 0.42; // left shoulder, lowered hand, forward
  return [c.pos.x + lx * co + lz * s, c.pos.y + ly + 0.25, c.pos.z - lx * s + lz * co];
}

function drawWolf(c) {
  const a = c.anim;
  let base = M4.mul(M4.translate(c.pos.x, c.pos.y - a.deadT * 0.3, c.pos.z), M4.rotY(c.yaw));
  if (a.deadT > 0) base = M4.mul(base, M4.rotZ(a.deadT * Math.PI / 2));
  if (a.attackT > 0) base = M4.mul(base, M4.rotX(-Math.sin(Math.min(a.attackT, 1) * Math.PI) * 0.6));
  const flash = a.flash;
  const fur = [0.42, 0.42, 0.45];
  const furD = [0.30, 0.30, 0.34];
  const swing = Math.sin(a.walkPhase) * 0.7 * a.moveAmt;
  // body + chest
  drawPart(M4.chain(base, M4.translate(0, 0.72, -0.12), M4.scale(0.50, 0.48, 1.15)),
           tintCol(fur, flash));
  drawPart(M4.chain(base, M4.translate(0, 0.74, 0.34), M4.scale(0.56, 0.56, 0.50)),
           tintCol(furD, flash));
  // head, snout, ears
  drawPart(M4.chain(base, M4.translate(0, 1.00, 0.72), M4.scale(0.34, 0.32, 0.36)),
           tintCol(fur, flash));
  drawPart(M4.chain(base, M4.translate(0, 0.92, 1.00), M4.scale(0.18, 0.16, 0.30)),
           tintCol(furD, flash));
  for (const s of [-1, 1]) {
    drawPart(M4.chain(base, M4.translate(s * 0.12, 1.22, 0.64), M4.scale(0.08, 0.16, 0.06)),
             tintCol(furD, flash));
  }
  // legs
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const m = M4.chain(base, M4.translate(sx * 0.20, 0.52, sz * 0.44 - 0.10),
                         M4.rotX(swing * sx * sz),
                         M4.translate(0, -0.26, 0), M4.scale(0.13, 0.52, 0.15));
      drawPart(m, tintCol(furD, flash));
    }
  }
  // tail
  drawPart(M4.chain(base, M4.translate(0, 0.86, -0.80), M4.rotX(-0.5), M4.scale(0.10, 0.10, 0.55)),
           tintCol(furD, flash));
}

function drawMolerat(c) {
  const a = c.anim;
  let base = M4.mul(M4.translate(c.pos.x, c.pos.y - a.deadT * 0.18, c.pos.z), M4.rotY(c.yaw));
  if (a.deadT > 0) base = M4.mul(base, M4.rotZ(a.deadT * Math.PI / 2));
  if (a.attackT > 0) base = M4.mul(base, M4.rotX(-Math.sin(Math.min(a.attackT, 1) * Math.PI) * 0.5));
  const flash = a.flash;
  const fur = [0.32, 0.24, 0.17];
  const furD = [0.26, 0.19, 0.13];
  const swing = Math.sin(a.walkPhase) * 0.6 * a.moveAmt;
  // body
  drawPart(M4.chain(base, M4.translate(0, 0.48, -0.05), M4.scale(0.55, 0.45, 0.95)),
           tintCol(fur, flash));
  // head with snout
  drawPart(M4.chain(base, M4.translate(0, 0.55, 0.55), M4.scale(0.40, 0.36, 0.40)),
           tintCol(furD, flash));
  drawPart(M4.chain(base, M4.translate(0, 0.46, 0.82), M4.scale(0.20, 0.18, 0.25)),
           tintCol([0.55, 0.42, 0.35], flash));
  // teeth
  drawPart(M4.chain(base, M4.translate(0, 0.36, 0.90), M4.scale(0.12, 0.08, 0.06)),
           tintCol([0.9, 0.88, 0.8], flash));
  // legs
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const m = M4.chain(base, M4.translate(sx * 0.24, 0.30, sz * 0.35 - 0.05),
                         M4.rotX(swing * sx * sz),
                         M4.translate(0, -0.15, 0), M4.scale(0.14, 0.30, 0.16));
      drawPart(m, tintCol(furD, flash));
    }
  }
  // tail
  drawPart(M4.chain(base, M4.translate(0, 0.45, -0.65), M4.rotX(0.4), M4.scale(0.08, 0.08, 0.45)),
           tintCol([0.5, 0.38, 0.32], flash));
}

function drawShadowbeast(c) {
  const a = c.anim;
  let base = M4.mul(M4.translate(c.pos.x, c.pos.y - a.deadT * 0.5, c.pos.z), M4.rotY(c.yaw));
  if (a.deadT > 0) base = M4.mul(base, M4.rotZ(a.deadT * Math.PI / 2));
  if (a.attackT > 0) base = M4.mul(base, M4.rotX(-Math.sin(Math.min(a.attackT, 1) * Math.PI) * 0.7));
  base = M4.mul(base, M4.scale(1.8, 1.8, 1.8)); // a wolf's silhouette, half again as tall
  const flash = a.flash;
  const fur = [0.13, 0.11, 0.14];
  const furD = [0.09, 0.08, 0.10];
  const swing = Math.sin(a.walkPhase) * 0.7 * a.moveAmt;
  // body + chest
  drawPart(M4.chain(base, M4.translate(0, 0.72, -0.12), M4.scale(0.54, 0.52, 1.20)),
           tintCol(fur, flash));
  drawPart(M4.chain(base, M4.translate(0, 0.76, 0.34), M4.scale(0.60, 0.60, 0.52)),
           tintCol(furD, flash));
  // spines along the back
  for (let i = 0; i < 4; i++) {
    drawPart(M4.chain(base, M4.translate(0, 1.04, 0.25 - i * 0.28), M4.scale(0.07, 0.22, 0.10)),
             tintCol(furD, flash));
  }
  // head, jaw, horn, glowing eyes
  drawPart(M4.chain(base, M4.translate(0, 1.02, 0.74), M4.scale(0.38, 0.34, 0.38)),
           tintCol(fur, flash));
  drawPart(M4.chain(base, M4.translate(0, 0.90, 1.04), M4.scale(0.22, 0.18, 0.34)),
           tintCol(furD, flash));
  drawPart(M4.chain(base, M4.translate(0, 1.26, 0.86), M4.rotX(0.5), M4.scale(0.07, 0.30, 0.07)),
           tintCol([0.75, 0.72, 0.65], flash));
  for (const s of [-1, 1]) {
    drawPart(M4.chain(base, M4.translate(s * 0.12, 1.06, 0.93), M4.scale(0.06, 0.05, 0.03)),
             tintCol([1.0, 0.25, 0.1], flash));
  }
  // legs
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const m = M4.chain(base, M4.translate(sx * 0.22, 0.52, sz * 0.46 - 0.10),
                         M4.rotX(swing * sx * sz),
                         M4.translate(0, -0.26, 0), M4.scale(0.15, 0.52, 0.17));
      drawPart(m, tintCol(furD, flash));
    }
  }
  // tail
  drawPart(M4.chain(base, M4.translate(0, 0.88, -0.84), M4.rotX(-0.4), M4.scale(0.11, 0.11, 0.60)),
           tintCol(furD, flash));
}

function drawCharacter(c) {
  if (c.kind === 'molerat') drawMolerat(c);
  else if (c.kind === 'wolf') drawWolf(c);
  else if (c.kind === 'shadowbeast') drawShadowbeast(c);
  else drawHumanoid(c);
}
