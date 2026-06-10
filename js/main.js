'use strict';
// ---------------------------------------------------------------------------
// main.js — input, camera, day/night lighting, render loop.
// ---------------------------------------------------------------------------

const INPUT = {};
let lastFrameT = 0;
let worldClock = 0; // seconds since start, drives shader animation
const DEMO_MODE = window.location.search.indexOf('demo') >= 0;

function lockPointer() {
  if (IS_TOUCH) return; // touch devices have no pointer lock; drag-to-look instead
  if (GAME.started && !GAME.uiOpen && !DEMO_MODE && document.pointerLockElement !== canvas) {
    canvas.requestPointerLock();
  }
}

function startGame(multiplayer) {
  if (GAME.started) return;
  GAME.started = true;
  UI.title.style.display = 'none';
  uiMsg('You wake on cold ground. The Barrier shimmers above the mountains.');
  uiMsg('The Old Camp lies north — follow the path.');
  if (multiplayer) netStart();
  lockPointer();
}

function initInput() {
  window.addEventListener('keydown', function(e) {
    if (GAME.uiOpen === 'chat') { // typing — game hotkeys stay out of it
      if (e.code === 'Enter' || e.code === 'NumpadEnter') closeChat(true);
      else if (e.code === 'Escape') closeChat(false);
      return;
    }
    INPUT[e.code] = true;
    if (e.code === 'Space') e.preventDefault();
    if (!GAME.started) {
      if (e.code === 'Enter') startGame(false);
      return;
    }
    if (e.code === 'KeyE' && !GAME.uiOpen) {
      const t = nearestTalkable();
      if (t) openDialog(t);
    } else if (e.code === 'KeyI') {
      toggleInventory();
    } else if (e.code === 'KeyJ') {
      toggleJournal();
    } else if (e.code === 'KeyC') {
      toggleCharacter();
    } else if (e.code === 'Enter' && !GAME.uiOpen && NET.active) {
      openChat();
    } else if (e.code === 'KeyG' && !GAME.uiOpen && NET.active && !NET.duel && !NET.duelReq) {
      netChallenge();
    } else if (e.code === 'KeyY' && !GAME.uiOpen && NET.duelReq) {
      netAcceptDuel();
    } else if (e.code === 'KeyN' && !GAME.uiOpen && NET.duelReq) {
      netDeclineDuel();
    } else if (e.code === 'Escape') {
      if (GAME.uiOpen === 'dialog') closeDialog();
      else if (GAME.uiOpen === 'inventory') toggleInventory();
      else if (GAME.uiOpen === 'journal') toggleJournal();
      else if (GAME.uiOpen === 'character') toggleCharacter();
    } else if (GAME.uiOpen === 'dialog' && e.code.indexOf('Digit') === 0) {
      const idx = parseInt(e.code.substring(5), 10) - 1;
      if (UI.currentOpts && UI.currentOpts[idx]) pickDialogOption(UI.currentOpts[idx]);
    }
  });
  window.addEventListener('keyup', function(e) { INPUT[e.code] = false; });

  document.addEventListener('mousemove', function(e) {
    if (document.pointerLockElement === canvas && GAME.started && !GAME.uiOpen) {
      const p = GAME.player;
      p.yaw += e.movementX * 0.0026;
      p.pitch = clamp(p.pitch - e.movementY * 0.0026, -1.15, 0.85);
    }
  });
  document.addEventListener('mousedown', function(e) {
    if (!GAME.started) return; // the title buttons handle starting
    if (GAME.uiOpen) return;
    if (document.pointerLockElement !== canvas && !DEMO_MODE) {
      lockPointer();
      return;
    }
    if (e.button === 0 && GAME.player.hp > 0) playerSwing();
  });
  document.addEventListener('pointerlockchange', function() {
    const locked = document.pointerLockElement === canvas;
    UI.crosshair.style.display = locked ? 'block' : 'none';
    UI.pauseHint.style.display =
      (GAME.started && !locked && !GAME.uiOpen && !DEMO_MODE) ? 'block' : 'none';
  });
}

// ---- sun / sky state for the current time of day ----------------------------

function skyState() {
  const ang = (GAME.timeOfDay - 0.25) * Math.PI * 2; // sunrise 06:00, noon 12:00
  const se = Math.sin(ang);
  const sunDir = vnorm([Math.cos(ang) * 0.9, se, 0.35]);
  const dayF = smoothstep(-0.12, 0.25, se);
  const duskF = smoothstep(0.0, 0.35, se) * (1 - smoothstep(0.35, 0.7, se));
  const sunCol = [
    lerp(0.0, lerp(1.0, 0.95, 0), dayF) + duskF * 0.15,
    lerp(0.0, 0.92, dayF) - duskF * 0.25,
    lerp(0.0, 0.85, dayF) - duskF * 0.40,
  ];
  return {
    sunDir: sunDir,
    sunCol: [Math.max(sunCol[0], 0), Math.max(sunCol[1], 0), Math.max(sunCol[2], 0)],
    amb: [lerp(0.10, 0.34, dayF), lerp(0.11, 0.37, dayF), lerp(0.20, 0.42, dayF)],
    fogCol: [lerp(0.02, 0.60, dayF) + duskF * 0.18, lerp(0.03, 0.68, dayF), lerp(0.07, 0.78, dayF) - duskF * 0.1],
    fogDen: lerp(0.0042, 0.0023, dayF),
    horizon: [lerp(0.03, 0.62, dayF) + duskF * 0.3, lerp(0.04, 0.70, dayF) + duskF * 0.05, lerp(0.09, 0.82, dayF)],
    zenith: [lerp(0.01, 0.20, dayF), lerp(0.02, 0.38, dayF), lerp(0.06, 0.68, dayF)],
    night: 1 - dayF,
  };
}

// ---- camera -------------------------------------------------------------------

function computeCamera() {
  if (!GAME.started) {
    // title screen: slow orbit around the Old Camp
    const t = worldClock * 0.06;
    const eye = [Math.sin(t) * 58, 26, Math.cos(t) * 58];
    const yaw = Math.atan2(0 - eye[0], -8 - eye[2]);
    const horiz = Math.hypot(eye[0], eye[2] + 8);
    const pitch = Math.atan2(10 - eye[1], horiz);
    return { eye: eye, yaw: yaw, pitch: pitch };
  }
  const p = GAME.player;
  const target = [p.pos.x, p.pos.y + 1.65, p.pos.z];
  const f = fwdVec(p.yaw, p.pitch);
  const dist = 4.4;
  const eye = [target[0] - f[0] * dist, target[1] - f[1] * dist, target[2] - f[2] * dist];
  const minY = terrainH(eye[0], eye[2]) + 0.45;
  if (eye[1] < minY) eye[1] = minY;
  return { eye: eye, yaw: p.yaw, pitch: p.pitch };
}

// ---- rendering ------------------------------------------------------------------

function render() {
  const cam = computeCamera();
  const aspect = canvas.width / canvas.height;
  const fovy = 62 * Math.PI / 180;
  const proj = M4.perspective(fovy, aspect, 0.1, 700);
  const view = makeView(cam.eye, cam.yaw, cam.pitch);
  const sky = skyState();

  gl.clearColor(sky.fogCol[0], sky.fogCol[1], sky.fogCol[2], 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  // --- sky ---
  gl.depthMask(false);
  gl.useProgram(PROG.sky.prog);
  const cf = fwdVec(cam.yaw, cam.pitch);
  const cr = vnorm(vcross([0, 1, 0], cf));
  const cu = vcross(cf, cr);
  gl.uniform3fv(PROG.sky.u.uCamFwd, cf);
  gl.uniform3fv(PROG.sky.u.uCamRight, cr);
  gl.uniform3fv(PROG.sky.u.uCamUp, cu);
  gl.uniform1f(PROG.sky.u.uTanFov, Math.tan(fovy / 2));
  gl.uniform1f(PROG.sky.u.uAspect, aspect);
  gl.uniform3fv(PROG.sky.u.uSunDir, sky.sunDir);
  gl.uniform3fv(PROG.sky.u.uSunCol, sky.sunCol);
  gl.uniform3fv(PROG.sky.u.uHorizon, sky.horizon);
  gl.uniform3fv(PROG.sky.u.uZenith, sky.zenith);
  gl.uniform1f(PROG.sky.u.uNight, sky.night);
  gl.bindVertexArray(MESH.skyTri.vao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.depthMask(true);

  // --- lit world + characters ---
  gl.useProgram(PROG.lit.prog);
  gl.uniformMatrix4fv(PROG.lit.u.uProj, false, proj);
  gl.uniformMatrix4fv(PROG.lit.u.uView, false, view);
  gl.uniform3fv(PROG.lit.u.uSunDir, sky.sunDir);
  gl.uniform3fv(PROG.lit.u.uSunCol, sky.sunCol);
  gl.uniform3fv(PROG.lit.u.uAmb, sky.amb);
  gl.uniform3fv(PROG.lit.u.uCamPos, cam.eye);
  gl.uniform3fv(PROG.lit.u.uFogCol, sky.fogCol);
  gl.uniform1f(PROG.lit.u.uFogDen, sky.fogDen);

  // point lights: campfires, then any lit torches (ours first), 8 slots total
  const torches = [];
  if (GAME.started && GAME.player.torchLit && GAME.player.hp > 0) torches.push(GAME.player);
  for (const r of NET.remotes.values()) {
    if (r.torchLit && r.hp > 0) torches.push(r);
  }
  const lp = new Float32Array(24);
  const lc = new Float32Array(24);
  let li = 0;
  for (let i = 0; i < WORLD.fires.length && li < 8; i++, li++) {
    const f = WORLD.fires[i];
    const flicker = 1.9 + Math.sin(worldClock * 11 + i * 2.7) * 0.45 + Math.sin(worldClock * 23 + i) * 0.2;
    lp[li * 3] = f.x; lp[li * 3 + 1] = f.y + 0.4; lp[li * 3 + 2] = f.z;
    lc[li * 3] = 1.0 * flicker; lc[li * 3 + 1] = 0.52 * flicker; lc[li * 3 + 2] = 0.18 * flicker;
  }
  for (let i = 0; i < torches.length && li < 8; i++, li++) {
    const tp = torchWorldPos(torches[i]);
    const flicker = 1.3 + Math.sin(worldClock * 13 + i * 4.1) * 0.25;
    lp[li * 3] = tp[0]; lp[li * 3 + 1] = tp[1] + 0.25; lp[li * 3 + 2] = tp[2];
    lc[li * 3] = 1.0 * flicker; lc[li * 3 + 1] = 0.55 * flicker; lc[li * 3 + 2] = 0.20 * flicker;
  }
  gl.uniform3fv(PROG.lit.u.uLightPos, lp);
  gl.uniform3fv(PROG.lit.u.uLightCol, lc);

  gl.uniformMatrix4fv(PROG.lit.u.uModel, false, M4.ident());
  gl.uniform3f(PROG.lit.u.uTint, 1, 1, 1);
  WORLD.mesh.draw();

  // gather nodes (they shake when struck and vanish when depleted)
  for (const nd of WORLD.nodes) {
    if (!nd.alive) continue;
    const sh = nd.shakeT > 0 ? 1 + Math.sin(worldClock * 55) * 0.05 * nd.shakeT : 1;
    gl.uniformMatrix4fv(PROG.lit.u.uModel, false,
      M4.chain(M4.translate(nd.x, nd.y, nd.z), M4.rotY(nd.yaw), M4.scale(sh, sh, sh)));
    gl.uniform3f(PROG.lit.u.uTint, 1, 1, 1);
    WORLD.nodeMeshes[nd.kind].draw();
  }

  for (const n of GAME.npcs) drawCharacter(n);
  for (const r of NET.remotes.values()) drawCharacter(r);
  if (GAME.started && GAME.player.hp > 0) drawCharacter(GAME.player);
  netDrawNameTags(proj, view);

  // --- water ---
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
  gl.useProgram(PROG.water.prog);
  gl.uniformMatrix4fv(PROG.water.u.uProj, false, proj);
  gl.uniformMatrix4fv(PROG.water.u.uView, false, view);
  gl.uniformMatrix4fv(PROG.water.u.uModel, false, M4.ident());
  gl.uniform3fv(PROG.water.u.uCamPos, cam.eye);
  gl.uniform3fv(PROG.water.u.uSunDir, sky.sunDir);
  gl.uniform3fv(PROG.water.u.uSunCol, sky.sunCol);
  gl.uniform3fv(PROG.water.u.uAmb, sky.amb);
  gl.uniform3fv(PROG.water.u.uFogCol, sky.fogCol);
  gl.uniform1f(PROG.water.u.uFogDen, sky.fogDen);
  gl.uniform1f(PROG.water.u.uTime, worldClock);
  WORLD.waterMesh.draw();

  // --- campfire flames (additive) ---
  gl.blendFunc(gl.ONE, gl.ONE);
  gl.useProgram(PROG.flat.prog);
  gl.uniformMatrix4fv(PROG.flat.u.uProj, false, proj);
  gl.uniformMatrix4fv(PROG.flat.u.uView, false, view);
  gl.uniform1f(PROG.flat.u.uAlpha, 1);
  for (let i = 0; i < WORLD.fires.length; i++) {
    const f = WORLD.fires[i];
    const s1 = 0.9 + Math.sin(worldClock * 9 + i * 1.7) * 0.13;
    const s2 = 0.55 + Math.sin(worldClock * 13 + i * 3.1) * 0.10;
    gl.uniformMatrix4fv(PROG.flat.u.uModel, false,
      M4.chain(M4.translate(f.x, f.y - 0.35, f.z), M4.scale(0.85 * s1, 1.15 * s1, 0.85 * s1)));
    gl.uniform3f(PROG.flat.u.uTint, 0.9, 0.32, 0.05);
    MESH.flame.draw();
    gl.uniformMatrix4fv(PROG.flat.u.uModel, false,
      M4.chain(M4.translate(f.x, f.y - 0.35, f.z), M4.scale(0.45 * s2, 0.8 * s2, 0.45 * s2)));
    gl.uniform3f(PROG.flat.u.uTint, 1.0, 0.75, 0.25);
    MESH.flame.draw();
  }
  // hand-torch flames
  for (let i = 0; i < torches.length; i++) {
    const tp = torchWorldPos(torches[i]);
    const s1 = 0.9 + Math.sin(worldClock * 12 + i * 2.3) * 0.15;
    gl.uniformMatrix4fv(PROG.flat.u.uModel, false,
      M4.chain(M4.translate(tp[0], tp[1] - 0.06, tp[2]), M4.scale(0.20 * s1, 0.42 * s1, 0.20 * s1)));
    gl.uniform3f(PROG.flat.u.uTint, 1.0, 0.55, 0.12);
    MESH.flame.draw();
  }

  // --- the Barrier ---
  gl.useProgram(PROG.barrier.prog);
  gl.uniformMatrix4fv(PROG.barrier.u.uProj, false, proj);
  gl.uniformMatrix4fv(PROG.barrier.u.uView, false, view);
  gl.uniformMatrix4fv(PROG.barrier.u.uModel, false,
    M4.chain(M4.translate(0, 0, 0), M4.scale(WORLD.barrierR, WORLD.barrierR, WORLD.barrierR)));
  gl.uniform3fv(PROG.barrier.u.uCamPos, cam.eye);
  gl.uniform1f(PROG.barrier.u.uTime, worldClock);
  MESH.dome.draw();

  gl.depthMask(true);
  gl.disable(gl.BLEND);
}

// ---- main loop --------------------------------------------------------------------

function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min((t - lastFrameT) / 1000, 0.05);
  lastFrameT = t;
  worldClock += dt;
  if (GAME.started && !GAME.uiOpen) {
    updateGame(dt, INPUT);
  }
  if (GAME.started) netUpdate(dt); // the shared world moves even in menus
  render();
  updateHUD();
}

window.addEventListener('DOMContentLoaded', function() {
  initEngine();
  buildWorld();
  initGame();
  initUI();
  initInput();
  initTouch();
  netInit();
  document.getElementById('btnSingle').addEventListener('click', function(e) {
    e.stopPropagation();
    startGame(false);
  });
  document.getElementById('btnMulti').addEventListener('click', function(e) {
    e.stopPropagation();
    startGame(true);
  });
  setInterval(function() { if (GAME.started) saveProgress(); }, 10000);
  window.addEventListener('beforeunload', function() { if (GAME.started) saveProgress(); });
  if (DEMO_MODE) {
    GAME.timeOfDay = 0.42; // pleasant afternoon light for screenshots
    const tm = /[?&]time=([0-9.]+)/.exec(window.location.search);
    if (tm) GAME.timeOfDay = parseFloat(tm[1]);
    startGame(false);
  }
  render(); // paint the first frame immediately
  requestAnimationFrame(frame);
});
