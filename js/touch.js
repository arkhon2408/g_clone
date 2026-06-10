'use strict';
// ---------------------------------------------------------------------------
// touch.js — mobile controls: virtual joystick, drag-to-look, action buttons.
// Activated automatically when IS_TOUCH (primary pointer is coarse).
// ---------------------------------------------------------------------------

let TOUCH_RESET = null; // set by initTouch; called when a UI panel opens

function initTouch() {
  if (!IS_TOUCH) return;
  document.body.classList.add('touch');
  document.getElementById('titleStart').textContent = 'Tap to enter the Colony';
  document.getElementById('titleControls').innerHTML =
    'Left stick: move &nbsp;·&nbsp; drag anywhere: look around<br>'
    + '⚔ attack &nbsp;·&nbsp; ▲ jump &nbsp;·&nbsp; tap the prompt to talk';
  document.addEventListener('contextmenu', function(e) { e.preventDefault(); });

  const joy = document.getElementById('joystick');
  const knob = document.getElementById('joyKnob');
  const JOY_R = 48;
  let joyId = null;
  let joyCX = 0, joyCY = 0;

  function setKnob(dx, dy) {
    knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    INPUT.tMoveX = dx / JOY_R;
    INPUT.tMoveY = -dy / JOY_R;
  }
  joy.addEventListener('touchstart', function(e) {
    e.preventDefault();
    if (joyId !== null) return;
    const t = e.changedTouches[0];
    joyId = t.identifier;
    const r = joy.getBoundingClientRect();
    joyCX = r.left + r.width / 2;
    joyCY = r.top + r.height / 2;
    setKnob(0, 0);
  });
  joy.addEventListener('touchmove', function(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier !== joyId) continue;
      let dx = t.clientX - joyCX, dy = t.clientY - joyCY;
      const d = Math.hypot(dx, dy);
      if (d > JOY_R) { dx *= JOY_R / d; dy *= JOY_R / d; }
      setKnob(dx, dy);
    }
  });
  function joyEnd(e) {
    for (const t of e.changedTouches) {
      if (t.identifier !== joyId) continue;
      joyId = null;
      setKnob(0, 0);
    }
  }
  joy.addEventListener('touchend', joyEnd);
  joy.addEventListener('touchcancel', joyEnd);

  // drag anywhere on the world to look around
  let lookId = null;
  let lookX = 0, lookY = 0;
  canvas.addEventListener('touchstart', function(e) {
    e.preventDefault();
    if (!GAME.started) { startGame(); return; }
    if (lookId === null && e.changedTouches.length > 0) {
      const t = e.changedTouches[0];
      lookId = t.identifier;
      lookX = t.clientX;
      lookY = t.clientY;
    }
  });
  canvas.addEventListener('touchmove', function(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier !== lookId) continue;
      if (GAME.started && !GAME.uiOpen) {
        const p = GAME.player;
        p.yaw += (t.clientX - lookX) * 0.0052;
        p.pitch = clamp(p.pitch - (t.clientY - lookY) * 0.0052, -1.15, 0.85);
      }
      lookX = t.clientX;
      lookY = t.clientY;
    }
  });
  function lookEnd(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === lookId) lookId = null;
    }
  }
  canvas.addEventListener('touchend', lookEnd);
  canvas.addEventListener('touchcancel', lookEnd);

  // action buttons
  function btn(id, onDown, onUp) {
    const el = document.getElementById(id);
    el.addEventListener('touchstart', function(e) {
      e.preventDefault();
      e.stopPropagation();
      onDown();
    });
    if (onUp) {
      el.addEventListener('touchend', function(e) { e.preventDefault(); onUp(); });
      el.addEventListener('touchcancel', function(e) { e.preventDefault(); onUp(); });
    }
  }
  btn('btnAttack', function() {
    if (GAME.started && !GAME.uiOpen && GAME.player.hp > 0) playerSwing();
  });
  btn('btnJump', function() { INPUT.Space = true; }, function() { INPUT.Space = false; });
  btn('btnInv', function() { if (GAME.started) toggleInventory(); });
  btn('btnJrn', function() { if (GAME.started) toggleJournal(); });
  btn('btnChr', function() { if (GAME.started) toggleCharacter(); });

  // the talk prompt itself is the talk button on touch
  UI.prompt.addEventListener('click', function() {
    if (GAME.started && !GAME.uiOpen) {
      const t = nearestTalkable();
      if (t) openDialog(t);
    }
  });

  // release everything when a panel opens (touchend never fires on hidden elements)
  TOUCH_RESET = function() {
    joyId = null;
    lookId = null;
    setKnob(0, 0);
  };
}
