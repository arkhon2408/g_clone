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
  }
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

function drawCharacter(c) {
  if (c.kind === 'molerat') drawMolerat(c);
  else drawHumanoid(c);
}
