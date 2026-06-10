'use strict';
// ---------------------------------------------------------------------------
// ui.js — HUD, message log, dialogue box, inventory, journal, death screen.
// ---------------------------------------------------------------------------

const UI = {};

function initUI() {
  UI.hpFill = document.getElementById('hpFill');
  UI.xpFill = document.getElementById('xpFill');
  UI.levelTxt = document.getElementById('levelTxt');
  UI.oreTxt = document.getElementById('oreTxt');
  UI.clockTxt = document.getElementById('clockTxt');
  UI.prompt = document.getElementById('prompt');
  UI.msglog = document.getElementById('msglog');
  UI.enemybar = document.getElementById('enemybar');
  UI.enemyname = document.getElementById('enemyname');
  UI.enemyfill = document.getElementById('enemyfill');
  UI.dialog = document.getElementById('dialog');
  UI.dlgName = document.getElementById('dlgName');
  UI.dlgText = document.getElementById('dlgText');
  UI.dlgOpts = document.getElementById('dlgOpts');
  UI.inventory = document.getElementById('inventory');
  UI.invList = document.getElementById('invList');
  UI.journal = document.getElementById('journal');
  UI.jrnList = document.getElementById('jrnList');
  UI.death = document.getElementById('death');
  UI.title = document.getElementById('title');
  UI.vignette = document.getElementById('vignette');
  UI.crosshair = document.getElementById('crosshair');
  UI.pauseHint = document.getElementById('pauseHint');
  document.getElementById('respawnBtn').addEventListener('click', respawn);
  document.getElementById('invClose').addEventListener('click', function() {
    if (GAME.uiOpen === 'inventory') toggleInventory();
  });
  document.getElementById('jrnClose').addEventListener('click', function() {
    if (GAME.uiOpen === 'journal') toggleJournal();
  });
  UI.character = document.getElementById('character');
  UI.chrList = document.getElementById('chrList');
  document.getElementById('chrClose').addEventListener('click', function() {
    if (GAME.uiOpen === 'character') toggleCharacter();
  });
}

function uiMsg(text) {
  const div = document.createElement('div');
  div.className = 'msg';
  div.textContent = text;
  UI.msglog.appendChild(div);
  while (UI.msglog.children.length > 7) UI.msglog.removeChild(UI.msglog.firstChild);
  div.addEventListener('animationend', function() {
    if (div.parentNode) div.parentNode.removeChild(div);
  });
}

function updateHUD() {
  // hide world controls and release held inputs while a panel is open
  const open = !!GAME.uiOpen;
  if (open !== UI.lastOpen) {
    UI.lastOpen = open;
    document.body.classList.toggle('uiopen', open);
    if (open) {
      INPUT.tMoveX = 0;
      INPUT.tMoveY = 0;
      INPUT.Space = false;
      if (TOUCH_RESET) TOUCH_RESET();
    }
  }
  const p = GAME.player;
  UI.hpFill.style.width = Math.max(0, p.hp / p.maxhp * 100) + '%';
  UI.xpFill.style.width = clamp(p.xp / (p.level * 150) * 100, 0, 100) + '%';
  UI.levelTxt.textContent = 'Level ' + p.level + ' · ' + p.weaponName;
  UI.oreTxt.textContent = p.ore + ' ore';
  const hrs = GAME.timeOfDay * 24;
  const hh = Math.floor(hrs);
  const mm = Math.floor((hrs - hh) * 60);
  UI.clockTxt.textContent = (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
  UI.vignette.style.opacity = clamp(p.hurtFlash, 0, 1) * 0.55 + (p.hp / p.maxhp < 0.25 ? 0.25 : 0);

  // enemy focus bar
  const e = GAME.focusEnemy;
  if (e && GAME.focusT > 0 && e.state !== 'dead') {
    UI.enemybar.style.display = 'block';
    UI.enemyname.textContent = e.name;
    UI.enemyfill.style.width = Math.max(0, e.hp / e.maxhp * 100) + '%';
  } else {
    UI.enemybar.style.display = 'none';
  }

  // interaction prompt
  if (GAME.started && !GAME.uiOpen) {
    const t = nearestTalkable();
    UI.prompt.textContent = t ? (IS_TOUCH ? 'Talk to ' + t.name : '[E]  Talk to ' + t.name) : '';
  } else {
    UI.prompt.textContent = '';
  }
}

// ---- dialogue ---------------------------------------------------------------

function openDialog(npc) {
  GAME.uiOpen = 'dialog';
  GAME.dialogNpc = npc;
  document.exitPointerLock();
  UI.dialog.style.display = 'block';
  showDialogNode('main');
}

function showDialogNode(nodeId) {
  const npc = GAME.dialogNpc;
  const node = DIALOGS[npc.dialog][nodeId](npc);
  UI.dlgName.textContent = npc.name;
  UI.dlgText.textContent = node.text;
  UI.dlgOpts.innerHTML = '';
  node.opts.forEach(function(opt, i) {
    const div = document.createElement('div');
    div.className = 'dlgOpt';
    div.textContent = (i + 1) + '.  ' + opt.t;
    div.addEventListener('click', function() { pickDialogOption(opt); });
    UI.dlgOpts.appendChild(div);
  });
  UI.currentOpts = node.opts;
}

function pickDialogOption(opt) {
  let next = null;
  if (opt.fn) next = opt.fn();
  else next = opt.next;
  if (next) showDialogNode(next);
  else closeDialog();
}

function closeDialog() {
  UI.dialog.style.display = 'none';
  GAME.uiOpen = null;
  GAME.dialogNpc = null;
  lockPointer();
}

// ---- inventory ----------------------------------------------------------------

function toggleInventory() {
  if (GAME.uiOpen === 'inventory') {
    UI.inventory.style.display = 'none';
    GAME.uiOpen = null;
    lockPointer();
  } else if (!GAME.uiOpen) {
    GAME.uiOpen = 'inventory';
    renderInventory();
    UI.inventory.style.display = 'block';
    document.exitPointerLock();
  }
}

function renderInventory() {
  const p = GAME.player;
  UI.invList.innerHTML = '';
  function row(label, sub, onUse) {
    const div = document.createElement('div');
    div.className = 'invRow';
    const main = document.createElement('div');
    main.textContent = label;
    const d = document.createElement('div');
    d.className = 'invDesc';
    d.textContent = sub;
    div.appendChild(main);
    div.appendChild(d);
    if (onUse) {
      const btn = document.createElement('div');
      btn.className = 'invUse';
      btn.textContent = 'Eat';
      btn.addEventListener('click', onUse);
      div.appendChild(btn);
    }
    UI.invList.appendChild(div);
  }
  row(p.weaponName, p.hasSword ? 'Weapon — damage ' + p.weaponDmg : 'Bare hands — damage ' + p.weaponDmg, null);
  row(p.ore + ' × Ore nugget', 'The only currency that matters in the Colony.', null);
  for (const name in p.items) {
    if (p.items[name] > 0) {
      row(p.items[name] + ' × ' + name, ITEM_DEFS[name].desc + ' (+' + ITEM_DEFS[name].heal + ' HP)',
          function(n) { return function() { eatItem(n); }; }(name));
    }
  }
}

// ---- character screen -----------------------------------------------------------

function toggleCharacter() {
  if (GAME.uiOpen === 'character') {
    UI.character.style.display = 'none';
    GAME.uiOpen = null;
    lockPointer();
  } else if (!GAME.uiOpen) {
    GAME.uiOpen = 'character';
    renderCharacter();
    UI.character.style.display = 'block';
    document.exitPointerLock();
  }
}

function renderCharacter() {
  const p = GAME.player;
  UI.chrList.innerHTML = '';
  function row(label, value) {
    const div = document.createElement('div');
    div.className = 'charRow';
    const l = document.createElement('div');
    l.textContent = label;
    const v = document.createElement('div');
    v.className = 'charVal';
    v.textContent = value;
    div.appendChild(l);
    div.appendChild(v);
    UI.chrList.appendChild(div);
  }
  function sep() {
    const div = document.createElement('div');
    div.className = 'charSep';
    UI.chrList.appendChild(div);
  }
  const dmgBase = p.weaponDmg + (p.level - 1) * 3;
  row('Name', 'The Nameless One');
  row('Level', p.level);
  row('Experience', p.xp + ' / ' + p.level * 150);
  sep();
  row('Health', Math.ceil(p.hp) + ' / ' + p.maxhp);
  row('Weapon', p.weaponName);
  row('Melee damage', dmgBase + ' – ' + (dmgBase + 3));
  sep();
  row('Ore nuggets', p.ore);
  row('Beasts & men slain', GAME.kills);
  row('Days in the Colony', GAME.day);
}

// ---- journal --------------------------------------------------------------------

function toggleJournal() {
  if (GAME.uiOpen === 'journal') {
    UI.journal.style.display = 'none';
    GAME.uiOpen = null;
    lockPointer();
  } else if (!GAME.uiOpen) {
    GAME.uiOpen = 'journal';
    renderJournal();
    UI.journal.style.display = 'block';
    document.exitPointerLock();
  }
}

function renderJournal() {
  const q = GAME.quest;
  UI.jrnList.innerHTML = '';
  function entry(title, body, done) {
    const div = document.createElement('div');
    div.className = 'jrnEntry' + (done ? ' jrnDone' : '');
    const h = document.createElement('div');
    h.className = 'jrnTitle';
    h.textContent = title + (done ? '  ✓' : '');
    const b = document.createElement('div');
    b.textContent = body;
    div.appendChild(h);
    div.appendChild(b);
    UI.jrnList.appendChild(div);
  }
  entry('A new arrival', 'You were thrown over the Barrier into the penal Colony. '
      + 'The Old Camp lies north of where you woke. Diego at the gate decides who gets in.', false);
  if (q.molerats === 'none') {
    entry('Rumors', 'The guards mention molerats on the old mine path. Diego might pay for blade work.', false);
  } else if (q.molerats === 'active') {
    entry('Clear the mine path', 'Diego pays 50 ore for five dead molerats on the path east of the gate. '
        + 'Killed so far: ' + Math.min(q.kills, 5) + ' of 5.'
        + (q.kills >= 5 ? ' The path is clear — report to Diego.' : ''), false);
  } else {
    entry('Clear the mine path', 'You cleared the molerats and Diego paid up. Maybe you are worth something after all.', true);
  }
}

// ---- death ------------------------------------------------------------------------

function showDeath() {
  GAME.uiOpen = 'death';
  UI.death.style.display = 'flex';
  document.exitPointerLock();
}

function respawn() {
  const p = GAME.player;
  p.hp = Math.floor(p.maxhp * 0.5);
  p.pos.x = 0;
  p.pos.z = 60;
  p.pos.y = terrainH(0, 60);
  p.vel.y = 0;
  p.hurtFlash = 0;
  for (const n of GAME.npcs) {
    if (n.state === 'chase') {
      n.state = 'wander';
      n.target = { x: n.home.x, z: n.home.z };
    }
  }
  UI.death.style.display = 'none';
  GAME.uiOpen = null;
  uiMsg('You wake at the gate. Someone dragged you out of harm\'s way.');
  lockPointer();
}
