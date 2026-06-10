'use strict';
// ---------------------------------------------------------------------------
// net.js — multiplayer client. One server, n players, one persistent world.
//
// Server address resolution order:
//   1. ?server=wss://host  URL parameter (remembered in localStorage)
//   2. DEFAULT_SERVER below (set this after deploying server.js)
//   3. ws://localhost:8080 when running from file:// or localhost (dev)
// If no server answers, the game silently stays single-player.
// ---------------------------------------------------------------------------

const DEFAULT_SERVER = 'wss://g-clone-yoja.onrender.com';

const NET = {
  ws: null,
  active: false,
  id: null,
  remotes: new Map(),   // id -> remote player puppet
  lastSend: 0,
  playerCount: 1,
  name: '',
  duel: null,           // {opp, name} while a duel is on
  duelReq: null,        // {from, name, t} incoming challenge
};

function netResolveUrl() {
  const m = /[?&]server=([^&]+)/.exec(window.location.search);
  if (m) {
    const url = decodeURIComponent(m[1]);
    localStorage.setItem('gothic_server', url);
    return url;
  }
  if (window.location.search.indexOf('offline') >= 0) return '';
  const saved = localStorage.getItem('gothic_server');
  if (saved) return saved;
  if (DEFAULT_SERVER) return DEFAULT_SERVER;
  if (window.location.protocol === 'file:' || window.location.hostname === 'localhost'
      || window.location.hostname === '127.0.0.1') {
    return 'ws://localhost:8080';
  }
  return '';
}

// Resolves the server address but does NOT connect — the player chooses
// single player or multiplayer on the title screen; netStart() connects.
function netInit() {
  if (IS_TEST_MODE) return; // autotest & screenshot modes are single-player
  NET.name = localStorage.getItem('gothic_name');
  if (!NET.name) {
    NET.name = 'Stranger-' + (100 + Math.floor(Math.random() * 900));
    localStorage.setItem('gothic_name', NET.name);
  }
  NET.url = netResolveUrl();
}

function netStart() {
  if (!NET.url) {
    uiMsg('No world server configured — playing single player.');
    return;
  }
  uiMsg('Connecting to the world... (a sleeping server can take a minute to wake)');
  netConnect(NET.url);
}

function netConnect(url) {
  const ws = new WebSocket(url);
  NET.ws = ws;
  ws.onopen = function() {
    ws.send(JSON.stringify({ t: 'hello', name: NET.name }));
  };
  ws.onmessage = function(ev) {
    netHandle(JSON.parse(ev.data));
  };
  ws.onclose = function() {
    if (NET.active) uiMsg('Connection to the world lost — single player.');
    NET.active = false;
    NET.remotes.clear();
    netStatus();
    setTimeout(function() { netConnect(url); }, 8000); // keep trying
  };
  ws.onerror = function() { ws.close(); };
}

function netStatus() {
  const el = document.getElementById('netStatus');
  if (NET.active) {
    el.textContent = '● online · ' + NET.playerCount + (NET.playerCount === 1 ? ' player' : ' players');
    el.className = 'on';
  } else {
    el.textContent = '○ single player';
    el.className = '';
  }
}

// ---- remote player puppets ---------------------------------------------------

const REMOTE_PALETTE = [
  [0.30, 0.38, 0.50], [0.50, 0.42, 0.20], [0.28, 0.45, 0.30],
  [0.48, 0.28, 0.40], [0.55, 0.45, 0.35], [0.25, 0.40, 0.45],
];

function makeRemote(id, name) {
  const pal = REMOTE_PALETTE[id % REMOTE_PALETTE.length];
  return {
    kind: 'human',
    id: id,
    name: name || ('Stranger #' + id),
    pos: { x: 0, y: 4, z: 60 },
    tx: 0, tz: 60,
    yaw: 0, tyaw: 0,
    hp: 100, maxhp: 100,
    hasSword: false,
    torchLit: false,
    chatMsg: '', chatT: 0,
    helmet: false,
    anim: { walkPhase: 0, moveAmt: 0, attackT: 0, deadT: 0, flash: 0 },
    colors: { skin: SKIN, torso: pal, legs: [pal[0] * 0.6, pal[1] * 0.6, pal[2] * 0.6],
              hair: [0.25, 0.18, 0.10] },
  };
}

function hostileByNetId(id) {
  return GAME.hostiles[id];
}

// ---- incoming messages ----------------------------------------------------------

function netHandle(m) {
  if (m.t === 'welcome') {
    NET.id = m.id;
    NET.active = true;
    GAME.timeOfDay = m.tod;
    GAME.day = m.day;
    for (const p of m.players) {
      const r = makeRemote(p.id, p.name);
      netApplyState(r, p.s);
      r.pos.x = r.tx; r.pos.z = r.tz; r.yaw = r.tyaw;
      NET.remotes.set(p.id, r);
    }
    for (const ns of m.npcs) {
      const n = hostileByNetId(ns.id);
      if (!n) continue;
      n.pos.x = ns.x; n.pos.z = ns.z;
      n.netX = ns.x; n.netZ = ns.z;
      n.hp = ns.hp;
      if (ns.dead) { n.state = 'dead'; n.anim.deadT = 1; }
    }
    NET.playerCount = m.players.length + 1;
    uiMsg('Connected to the world — ' + NET.playerCount + ' in the Colony.');
    netStatus();
  } else if (m.t === 'join') {
    NET.remotes.set(m.id, makeRemote(m.id, m.name));
    NET.playerCount = NET.remotes.size + 1;
    uiMsg(m.name + ' entered the Colony.');
    netStatus();
  } else if (m.t === 'leave') {
    NET.remotes.delete(m.id);
    NET.playerCount = NET.remotes.size + 1;
    uiMsg(m.name + ' left the Colony.');
    netStatus();
  } else if (m.t === 'p') {
    for (const s of m.l) {
      if (s[0] === NET.id) continue;
      let r = NET.remotes.get(s[0]);
      if (!r) { r = makeRemote(s[0]); NET.remotes.set(s[0], r); }
      netApplyState(r, s.slice(1));
    }
    NET.playerCount = NET.remotes.size + 1;
    netStatus();
  } else if (m.t === 'n') {
    for (const s of m.l) {
      const n = hostileByNetId(s[0]);
      if (!n || n.state === 'dead') continue;
      n.netX = s[1]; n.netZ = s[2];
      n.yaw = s[3];
      n.netMoving = !!s[4];
    }
  } else if (m.t === 'nhit') {
    const n = hostileByNetId(m.id);
    if (!n) return;
    n.hp = m.hp;
    n.anim.flash = 1;
    if (m.by === NET.id) { GAME.focusEnemy = n; GAME.focusT = 6; }
  } else if (m.t === 'ndead') {
    const n = hostileByNetId(m.id);
    if (!n || n.state === 'dead') return;
    n.hp = 0;
    n.state = 'dead';
    n.anim.flash = 1;
    if (m.by === NET.id) creditKill(n);
  } else if (m.t === 'nspawn') {
    const n = hostileByNetId(m.id);
    if (!n) return;
    n.state = 'idle';
    n.hp = m.hp;
    n.hostileNow = false;
    n.anim.deadT = 0;
    n.anim.flash = 0;
    n.pos.x = m.x; n.pos.z = m.z;
    n.netX = m.x; n.netZ = m.z;
  } else if (m.t === 'natk') {
    const n = hostileByNetId(m.id);
    if (n && n.state !== 'dead') n.anim.attackT = 0.0001;
  } else if (m.t === 'naggro') {
    const n = hostileByNetId(m.id);
    if (n && m.target === NET.id && n.kind === 'human') {
      uiMsg(n.name + ': "You picked the wrong path, stranger!"');
    }
  } else if (m.t === 'phit') {
    damagePlayer(m.dmg, m.by);
  } else if (m.t === 'chat') {
    if (m.id === NET.id) {
      uiMsg('You: ' + m.msg);
    } else {
      const r = NET.remotes.get(m.id);
      if (r) { r.chatMsg = m.msg; r.chatT = 6; }
      uiMsg((m.name || 'Stranger') + ': ' + m.msg);
    }
  } else if (m.t === 'duelreq') {
    NET.duelReq = { from: m.from, name: m.name, t: 15 };
    uiMsg(m.name + ' challenges you to a duel! [Y] accept · [N] decline');
  } else if (m.t === 'duelstart') {
    NET.duel = { opp: m.opp, name: m.name };
    NET.duelReq = null;
    uiMsg('Duel with ' + m.name + '! The loser forfeits half their ore. No one dies here.');
  } else if (m.t === 'dhit') {
    const p = GAME.player;
    p.hp = Math.max(1, p.hp - m.dmg); // duels never kill
    p.hurtFlash = 1;
    GAME.focusT = 6;
  } else if (m.t === 'duelend') {
    if (m.loser === NET.id) {
      const p = GAME.player;
      const lost = Math.floor(p.ore / 2);
      p.ore -= lost;
      p.hp = Math.max(p.hp, Math.ceil(p.maxhp * 0.35));
      NET.ws.send(JSON.stringify({ t: 'duelore', to: m.winner, ore: lost }));
      uiMsg('You yield the duel to ' + m.wname + ' — and ' + lost + ' ore with it.');
      uiMsg('The vein and the pines pay too. Whistler buys what you gather.');
      NET.duel = null;
    } else if (m.winner === NET.id) {
      uiMsg('You won the duel against ' + m.lname + '!');
      NET.duel = null;
    } else {
      uiMsg(m.wname + ' defeated ' + m.lname + ' in a duel.');
    }
  } else if (m.t === 'duelwin') {
    GAME.player.ore += m.ore;
    uiMsg('Spoils of the duel: ' + m.ore + ' ore nuggets.');
  } else if (m.t === 'duelcancel') {
    if (NET.duel) uiMsg('The duel is off — ' + (m.why || 'your opponent is gone') + '.');
    NET.duel = null;
    NET.duelReq = null;
  } else if (m.t === 'time') {
    GAME.timeOfDay = m.tod;
    GAME.day = m.day;
  }
}

function netApplyState(r, s) {
  r.tx = s[0]; r.tz = s[1]; r.tyaw = s[2];
  r.anim.moveAmt = s[3];
  if (s[4] && r.anim.attackT <= 0) r.anim.attackT = 0.0001;
  r.hp = s[5];
  r.anim.deadT = r.hp <= 0 ? Math.max(r.anim.deadT, 0.01) : 0;
  r.hasSword = !!s[6];
  r.maxhp = 100 + (Math.max(1, s[7] | 0) - 1) * 20;
  r.torchLit = !!s[8];
}

// ---- per-frame work (runs even while menus are open — the world goes on) --------

function netUpdate(dt) {
  if (!NET.active) return;

  // interpolate remote players
  for (const r of NET.remotes.values()) {
    const k = Math.min(dt * 8, 1);
    r.pos.x += (r.tx - r.pos.x) * k;
    r.pos.z += (r.tz - r.pos.z) * k;
    let dy = r.tyaw - r.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    r.yaw += dy * k;
    r.pos.y = terrainH(r.pos.x, r.pos.z);
    r.anim.walkPhase += r.anim.moveAmt * 9 * dt;
    if (r.anim.attackT > 0) { r.anim.attackT += dt / 0.45; if (r.anim.attackT >= 1) r.anim.attackT = 0; }
    if (r.anim.deadT > 0 && r.hp <= 0) r.anim.deadT = Math.min(r.anim.deadT + dt * 2.2, 1);
    if (r.anim.flash > 0) r.anim.flash -= dt * 3;
    if (r.chatT > 0) r.chatT -= dt;
  }

  // a pending challenge expires; an active duel keeps the opponent in focus
  if (NET.duelReq) {
    NET.duelReq.t -= dt;
    if (NET.duelReq.t <= 0) NET.duelReq = null;
  }
  if (NET.duel) {
    const o = NET.remotes.get(NET.duel.opp);
    if (o) {
      GAME.focusEnemy = o;
      GAME.focusT = Math.max(GAME.focusT, 1);
    }
  }

  // interpolate server-driven hostiles
  for (const n of GAME.hostiles) {
    if (n.state === 'dead') {
      n.anim.deadT = Math.min(n.anim.deadT + dt * 2.2, 1);
      n.anim.moveAmt = 0;
      continue;
    }
    if (n.netX !== undefined) {
      const k = Math.min(dt * 8, 1);
      n.pos.x += (n.netX - n.pos.x) * k;
      n.pos.z += (n.netZ - n.pos.z) * k;
    }
    n.pos.y = terrainH(n.pos.x, n.pos.z);
    n.anim.moveAmt = lerp(n.anim.moveAmt, n.netMoving ? 1 : 0, dt * 8);
    n.anim.walkPhase += n.anim.moveAmt * n.speed * 1.6 * dt;
    if (n.anim.attackT > 0) { n.anim.attackT += dt / 0.5; if (n.anim.attackT >= 1) n.anim.attackT = 0; }
    if (n.anim.flash > 0) n.anim.flash -= dt * 3;
  }

  // send our state at 10 Hz
  NET.lastSend += dt;
  if (NET.lastSend >= 0.1 && GAME.started) {
    NET.lastSend = 0;
    const p = GAME.player;
    NET.ws.send(JSON.stringify({
      t: 's', x: p.pos.x, z: p.pos.z, yaw: p.yaw, m: p.anim.moveAmt,
      a: p.attackT > 0 ? 1 : 0, hp: p.hp, sw: p.hasSword ? 1 : 0, lv: p.level,
      tc: p.torchLit ? 1 : 0,
    }));
  }
}

function netSendSwing() {
  const p = GAME.player;
  NET.ws.send(JSON.stringify({
    t: 'swing', x: p.pos.x, z: p.pos.z, yaw: p.yaw,
    sw: p.hasSword ? 1 : 0, lv: p.level, wd: p.weaponDmg,
  }));
}

// ---- duels --------------------------------------------------------------------

function nearestRemote(maxD) {
  const p = GAME.player;
  let best = null, bestD = maxD;
  for (const r of NET.remotes.values()) {
    if (r.hp <= 0) continue;
    const d = Math.hypot(r.pos.x - p.pos.x, r.pos.z - p.pos.z);
    if (d < bestD) { bestD = d; best = r; }
  }
  return best;
}

function netChallenge() {
  const r = nearestRemote(4);
  if (!r) {
    uiMsg('No one close enough to challenge — stand next to another player.');
    return;
  }
  NET.ws.send(JSON.stringify({ t: 'duel', to: r.id }));
  uiMsg('You challenge ' + r.name + ' to a duel...');
}

function netAcceptDuel() {
  if (!NET.duelReq) return;
  NET.ws.send(JSON.stringify({ t: 'duelok', to: NET.duelReq.from }));
  NET.duelReq = null;
}

function netDeclineDuel() {
  if (!NET.duelReq) return;
  uiMsg('You decline ' + NET.duelReq.name + '\'s challenge.');
  NET.duelReq = null;
}

// ---- chat ---------------------------------------------------------------------

function openChat() {
  if (!NET.active || GAME.uiOpen) return;
  GAME.uiOpen = 'chat';
  document.exitPointerLock();
  document.getElementById('chatWrap').style.display = 'block';
  const inp = document.getElementById('chatInput');
  inp.value = '';
  inp.focus();
}

function closeChat(sendIt) {
  const inp = document.getElementById('chatInput');
  if (sendIt) {
    const txt = inp.value.replace(/\s+/g, ' ').trim().slice(0, 120);
    if (txt && NET.active) NET.ws.send(JSON.stringify({ t: 'chat', msg: txt }));
  }
  inp.blur();
  document.getElementById('chatWrap').style.display = 'none';
  if (GAME.uiOpen === 'chat') GAME.uiOpen = null;
  lockPointer();
}

// ---- name tags --------------------------------------------------------------------

function netDrawNameTags(proj, view) {
  const cont = document.getElementById('nametags');
  if (!NET.active || NET.remotes.size === 0) {
    if (cont.children.length) cont.innerHTML = '';
    return;
  }
  const pv = M4.mul(proj, view);
  let html = '';
  for (const r of NET.remotes.values()) {
    const x = r.pos.x, y = r.pos.y + 2.15, z = r.pos.z;
    const cw = pv[3] * x + pv[7] * y + pv[11] * z + pv[15];
    if (cw < 0.5) continue;
    const d = Math.hypot(x - GAME.player.pos.x, z - GAME.player.pos.z);
    if (d > 45) continue;
    const cx = (pv[0] * x + pv[4] * y + pv[8] * z + pv[12]) / cw;
    const cy = (pv[1] * x + pv[5] * y + pv[9] * z + pv[13]) / cw;
    const sx = (cx * 0.5 + 0.5) * 100;
    const sy = (-cy * 0.5 + 0.5) * 100;
    const bubble = (r.chatT > 0 && r.chatMsg)
      ? '<div class="chatbubble">' + escapeHtml(r.chatMsg) + '</div>' : '';
    html += '<div class="nametag" style="left:' + sx.toFixed(2) + '%;top:' + sy.toFixed(2)
          + '%">' + bubble + escapeHtml(r.name) + '</div>';
  }
  cont.innerHTML = html;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---- local progress persistence (per browser) ----------------------------------

function saveProgress() {
  if (IS_TEST_MODE || DEMO_MODE) return;
  const p = GAME.player;
  localStorage.setItem('gothic_save', JSON.stringify({
    level: p.level, xp: p.xp, hp: p.hp, maxhp: p.maxhp, ore: p.ore,
    items: p.items, hasSword: p.hasSword, weaponName: p.weaponName,
    weaponDmg: p.weaponDmg, torchLit: p.torchLit,
    quest: GAME.quest, kills: GAME.kills, day: GAME.day,
    merchant: { stock: MERCHANT.stock, smelted: MERCHANT.smelted },
  }));
}

function loadProgress() {
  if (IS_TEST_MODE || DEMO_MODE) return;
  if (window.location.search.indexOf('reset') >= 0) {
    localStorage.removeItem('gothic_save');
    return;
  }
  const raw = localStorage.getItem('gothic_save');
  if (!raw) return;
  const s = JSON.parse(raw);
  const p = GAME.player;
  p.level = s.level; p.xp = s.xp; p.maxhp = s.maxhp;
  p.hp = Math.max(s.hp, Math.floor(s.maxhp * 0.5));
  p.ore = s.ore; p.items = s.items;
  p.hasSword = s.hasSword; p.weaponName = s.weaponName; p.weaponDmg = s.weaponDmg;
  p.torchLit = !!(s.torchLit && p.items['Torch']);
  // saves from before weapons lived in the inventory: grant the equipped one
  if (p.weaponName !== 'Fists' && !p.items[p.weaponName]) p.items[p.weaponName] = 1;
  if (s.merchant) {
    for (const k in s.merchant.stock) {
      if (MERCHANT.stock[k] !== undefined) MERCHANT.stock[k] = s.merchant.stock[k];
    }
    MERCHANT.smelted = s.merchant.smelted || 0;
  }
  GAME.quest = s.quest;
  GAME.kills = s.kills;
  GAME.day = s.day || 1;
}
