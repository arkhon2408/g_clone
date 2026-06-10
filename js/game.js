'use strict';
// ---------------------------------------------------------------------------
// game.js — player, NPCs, AI, combat, quests and dialogue.
// ---------------------------------------------------------------------------

const GAME = {
  started: false,
  uiOpen: null,            // null | 'dialog' | 'inventory' | 'journal' | 'death'
  timeOfDay: 10.2 / 24,    // fraction of a day; starts mid-morning
  dayLength: 480,          // seconds per in-game day
  player: null,
  npcs: [],
  focusEnemy: null,
  focusT: 0,
  quest: { molerats: 'none', kills: 0 }, // none | active | rewarded
  dialogNpc: null,
  kills: 0, // every beast and man slain
  day: 1,
  lastSoupDay: 0, // Snaf ladles out one free soup per day
};

const SKIN = [0.82, 0.62, 0.48];

function makePlayer() {
  const x = 0, z = 60;
  return {
    kind: 'human',
    name: 'You',
    pos: { x: x, y: terrainH(x, z), z: z },
    vel: { y: 0 },
    yaw: Math.PI, pitch: -0.08,
    grounded: true,
    hp: 100, maxhp: 100,
    xp: 0, level: 1,
    ore: 10,
    items: { 'Dried meat': 1, 'Molerat meat': 0 },
    hasSword: false,
    weaponName: 'Fists', weaponDmg: 6,
    torchLit: false,
    attackT: 0, attackCd: 0, hitDone: false,
    hurtFlash: 0,
    anim: { walkPhase: 0, moveAmt: 0, attackT: 0, deadT: 0, flash: 0 },
    colors: { skin: SKIN, torso: [0.38, 0.30, 0.22], legs: [0.30, 0.24, 0.18], hair: [0.30, 0.20, 0.10] },
  };
}

function addNPC(o) {
  const n = Object.assign({
    kind: 'human',
    hp: 60, maxhp: 60,
    dmg: 8, speed: 3.4,
    aggroR: 0, attackR: 1.8, leashR: 26, atkRate: 1.4,
    hostile: false, damageable: false,
    wanderR: 0,
    dialog: null,
    state: 'idle',
    stateT: 1 + Math.random() * 3,
    target: null,
    atkCd: 0, hitPending: 0,
    helmet: false, hasSword: false,
    anim: { walkPhase: Math.random() * 6, moveAmt: 0, attackT: 0, deadT: 0, flash: 0 },
    colors: { skin: SKIN, torso: [0.45, 0.38, 0.28], legs: [0.32, 0.26, 0.20], hair: [0.25, 0.18, 0.10] },
  }, o);
  n.maxhp = n.hp;
  n.pos = { x: o.x, y: terrainH(o.x, o.z), z: o.z };
  n.home = { x: o.x, z: o.z };
  n.yaw = o.yaw !== undefined ? o.yaw : Math.random() * Math.PI * 2;
  GAME.npcs.push(n);
  return n;
}

function initGame() {
  GAME.player = makePlayer();

  // --- Old Camp folk ---
  addNPC({ name: 'Diego', x: 5, z: 40, yaw: Math.PI * 0.9, dialog: 'diego', hasSword: true,
           colors: { skin: SKIN, torso: [0.62, 0.14, 0.10], legs: [0.16, 0.14, 0.13], hair: [0.12, 0.10, 0.08] } });
  addNPC({ name: 'Gate Guard', x: -3.4, z: 36.5, yaw: Math.PI, dialog: 'guard', helmet: true, hasSword: true,
           colors: { skin: SKIN, torso: [0.55, 0.16, 0.12], legs: [0.20, 0.17, 0.15], hair: [0.2, 0.15, 0.1] } });
  addNPC({ name: 'Gate Guard', x: 3.4, z: 36.5, yaw: Math.PI, dialog: 'guard', helmet: true, hasSword: true,
           colors: { skin: SKIN, torso: [0.55, 0.16, 0.12], legs: [0.20, 0.17, 0.15], hair: [0.2, 0.15, 0.1] } });
  addNPC({ name: 'Whistler', x: 10, z: 13, dialog: 'whistler', wanderR: 3,
           colors: { skin: SKIN, torso: [0.25, 0.30, 0.38], legs: [0.25, 0.20, 0.16], hair: [0.35, 0.28, 0.15] } });
  addNPC({ name: 'Snaf', x: -13.5, z: 0.5, dialog: 'snaf', wanderR: 2.5,
           colors: { skin: SKIN, torso: [0.40, 0.34, 0.26], legs: [0.3, 0.25, 0.2], hair: [0.15, 0.12, 0.08] } });
  for (let i = 0; i < 4; i++) {
    addNPC({ name: 'Digger', x: -8 + i * 6, z: 18 - (i % 2) * 24, dialog: 'digger', wanderR: 9, speed: 1.6,
             colors: { skin: SKIN, torso: [0.42 + i * 0.02, 0.36, 0.27], legs: [0.32, 0.27, 0.21], hair: [0.2 + i * 0.05, 0.15, 0.1] } });
  }

  // --- hostiles: spawn order MUST match server.js (MR_SPOTS / B_SPOTS) ---
  GAME.hostiles = [];
  function addHostile(o) {
    const n = addNPC(o);
    n.netId = GAME.hostiles.length;
    GAME.hostiles.push(n);
    return n;
  }

  // molerats on the path to the old mine
  const mrSpots = [[22, 92], [30, 100], [26, 106], [34, 92], [18, 102], [38, 104], [28, 86]];
  for (const s of mrSpots) {
    addHostile({ name: 'Molerat', kind: 'molerat', x: s[0], z: s[1],
             hp: 40, dmg: 7, speed: 3.6, aggroR: 9, attackR: 1.8, leashR: 22, atkRate: 1.3,
             hostile: true, damageable: true, wanderR: 6, xp: 30, respawn: 60 });
  }

  // bandits at the ruined watchtower
  const bSpots = [[58, -66], [63, -70], [55, -71]];
  for (const s of bSpots) {
    addHostile({ name: 'Bandit', kind: 'human', x: s[0], z: s[1],
             hp: 70, dmg: 11, speed: 4.6, aggroR: 13, attackR: 2.1, leashR: 30, atkRate: 1.5,
             hostile: true, damageable: true, wanderR: 5, xp: 60, respawn: 120, hasSword: true,
             colors: { skin: SKIN, torso: [0.22, 0.18, 0.15], legs: [0.18, 0.15, 0.12], hair: [0.1, 0.08, 0.06] } });
  }

  // wolves guarding the ore vein in the north-west
  const wSpots = [[-42, -82], [-51, -90], [-44, -93]];
  for (const s of wSpots) {
    addHostile({ name: 'Wolf', kind: 'wolf', x: s[0], z: s[1],
             hp: 55, dmg: 12, speed: 5.2, aggroR: 12, attackR: 1.9, leashR: 24, atkRate: 1.1,
             hostile: true, damageable: true, wanderR: 7, xp: 45, respawn: 90 });
  }

  // shadowbeasts at the rich vein by the old mine — bring the Ore blade,
  // level 5 and a pocketful of potions, or don't come at all
  const sbSpots = [[6, -108], [14, -115]];
  for (const s of sbSpots) {
    addHostile({ name: 'Shadowbeast', kind: 'shadowbeast', x: s[0], z: s[1],
             hp: 300, dmg: 36, speed: 5.4, aggroR: 14, attackR: 2.2, leashR: 26, atkRate: 1.0,
             hostile: true, damageable: true, wanderR: 6, xp: 200, respawn: 180 });
  }

  loadProgress();
}

// ---- shared movement helpers ----------------------------------------------

function pushOutOfColliders(p, radius) {
  // the palisade ring (analytic): solid except for the gate arc facing south
  const rr = Math.hypot(p.x, p.z);
  if (rr > 0.001) {
    let ang = Math.atan2(p.x, p.z);              // 0 at the gate (+Z)
    const inGate = Math.abs(ang) < 0.095;
    const R = WORLD.campR, wall = 0.55 + radius;
    if (!inGate && rr > R - wall && rr < R + wall) {
      const side = rr < R ? R - wall : R + wall;
      p.x *= side / rr;
      p.z *= side / rr;
    }
  }
  for (const c of WORLD.colliders) {
    const dx = p.x - c.x, dz = p.z - c.z;
    const d = Math.hypot(dx, dz);
    const min = c.r + radius;
    if (d < min && d > 0.0001) {
      p.x = c.x + dx / d * min;
      p.z = c.z + dz / d * min;
    }
  }
  for (const nd of WORLD.nodes) {
    if (!nd.alive) continue;
    const dx = p.x - nd.x, dz = p.z - nd.z;
    const d = Math.hypot(dx, dz);
    const min = nd.r + radius;
    if (d < min && d > 0.0001) {
      p.x = nd.x + dx / d * min;
      p.z = nd.z + dz / d * min;
    }
  }
}

function groundY(x, z) {
  const t = terrainH(x, z);
  // shallow "swimming" over the lake
  return Math.max(t, Math.min(WORLD.waterLevel - 1.1, t + 4));
}

// ---- combat ----------------------------------------------------------------

function addXP(amount) {
  const p = GAME.player;
  p.xp += amount;
  uiMsg('Experience: +' + amount);
  while (p.xp >= p.level * 150) {
    p.xp -= p.level * 150;
    p.level++;
    p.maxhp += 20;
    p.hp = p.maxhp;
    uiMsg('LEVEL UP! You feel stronger. (Level ' + p.level + ')');
  }
}

function damageNPC(n, dmg) {
  if (n.state === 'dead') return;
  if (!n.damageable) {
    uiMsg('You had better not anger the people of the Old Camp.');
    return;
  }
  n.hp -= dmg;
  n.anim.flash = 1;
  GAME.focusEnemy = n;
  GAME.focusT = 6;
  if (!n.hostileNow) n.hostileNow = true;
  if (n.state === 'idle' || n.state === 'wander') n.state = 'chase';
  if (n.hp <= 0) {
    n.hp = 0;
    n.state = 'dead';
    n.respawnT = n.respawn || 0;
    creditKill(n);
  }
}

// XP, loot and quest credit for a hostile this player brought down.
function creditKill(n) {
  GAME.kills++;
  uiMsg('You killed the ' + n.name.toLowerCase() + '.');
  addXP(n.xp || 25);
  if (n.kind === 'molerat') {
    GAME.quest.kills++;
    GAME.player.items['Molerat meat'] = (GAME.player.items['Molerat meat'] || 0) + 1;
    uiMsg('Taken: Molerat meat');
    if (GAME.quest.molerats === 'active' && GAME.quest.kills === 5) {
      uiMsg('Quest updated: the path is clear. Report to Diego.');
    }
  } else if (n.kind === 'wolf') {
    GAME.player.items['Wolf meat'] = (GAME.player.items['Wolf meat'] || 0) + 1;
    uiMsg('Taken: Wolf meat');
  } else if (n.kind === 'shadowbeast') {
    const loot = 35 + Math.floor(Math.random() * 16);
    GAME.player.ore += loot;
    uiMsg('Taken: ' + loot + ' ore nuggets');
  } else {
    const loot = 5 + Math.floor(Math.random() * 10);
    GAME.player.ore += loot;
    uiMsg('Taken: ' + loot + ' ore nuggets');
  }
}

function damagePlayer(dmg, from) {
  const p = GAME.player;
  if (p.hp <= 0) return;
  p.hp -= dmg;
  p.hurtFlash = 1;
  GAME.focusT = 6;
  if (p.hp <= 0) {
    p.hp = 0;
    uiMsg('Slain by ' + from + '.');
    showDeath();
  }
}

function playerSwing() {
  const p = GAME.player;
  if (p.attackCd > 0 || p.attackT > 0) return;
  p.attackT = 0.0001;
  p.hitDone = false;
  p.attackCd = 0.62;
}

function applyPlayerHit() {
  if (tryHitNode()) return; // gather nodes are local in both modes
  if (NET.active) { netSendSwing(); return; } // the server judges hits online
  const p = GAME.player;
  const f = [Math.sin(p.yaw), Math.cos(p.yaw)];
  for (const n of GAME.npcs) {
    if (n.state === 'dead') continue;
    const dx = n.pos.x - p.pos.x, dz = n.pos.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 2.5) continue;
    if ((dx * f[0] + dz * f[1]) / (d || 1) < 0.35) continue;
    const dmg = p.weaponDmg + (p.level - 1) * 3 + Math.floor(Math.random() * 4);
    damageNPC(n, dmg);
  }
}

// ---- gathering: dry pines, stone blocks, the ore vein ------------------------

const NODE_TOOLS = { tree: 'Woodcutter\'s axe', stone: 'Pickaxe', ore: 'Pickaxe' };
const NODE_YIELD = { tree: 'Wood', stone: 'Stone', ore: 'Raw ore' };
const NODE_LABEL = { tree: 'tree', stone: 'rock', ore: 'ore vein' };

function nearestNode(maxD) {
  const p = GAME.player;
  let best = null, bestD = maxD;
  for (const nd of WORLD.nodes) {
    if (!nd.alive) continue;
    const d = Math.hypot(nd.x - p.pos.x, nd.z - p.pos.z);
    if (d < bestD) { bestD = d; best = nd; }
  }
  return best;
}

function tryHitNode() {
  const p = GAME.player;
  const f = [Math.sin(p.yaw), Math.cos(p.yaw)];
  for (const nd of WORLD.nodes) {
    if (!nd.alive) continue;
    const dx = nd.x - p.pos.x, dz = nd.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > nd.r + 2.0) continue;
    if ((dx * f[0] + dz * f[1]) / (d || 1) < 0.25) continue;
    const tool = NODE_TOOLS[nd.kind];
    if (!p.items[tool]) {
      uiMsg('You need a ' + tool.toLowerCase() + ' for the ' + NODE_LABEL[nd.kind]
          + '. Whistler sells tools.');
      return true;
    }
    nd.hits--;
    nd.shakeT = 0.3;
    const res = NODE_YIELD[nd.kind];
    p.items[res] = (p.items[res] || 0) + nd.mult;
    uiMsg('Gathered: ' + (nd.mult > 1 ? nd.mult + ' × ' : '') + res + ' (' + p.items[res] + ')');
    if (nd.hits <= 0) {
      nd.alive = false;
      nd.respawnT = nd.respawn;
      addXP(nd.kind === 'ore' ? 25 : 10);
    }
    return true;
  }
  return false;
}

function updateNodes(dt) {
  for (const nd of WORLD.nodes) {
    if (nd.shakeT > 0) nd.shakeT -= dt;
    if (!nd.alive) {
      nd.respawnT -= dt;
      if (nd.respawnT <= 0) {
        nd.alive = true;
        nd.hits = nd.maxHits;
      }
    }
  }
}

// ---- Whistler's economy -------------------------------------------------------
// Players sell gathered goods for ore; Whistler's smelter slowly burns his stock
// down into nuggets (two goods in, one good's worth of ore out — lossy on
// purpose, so the valley never drowns in ore) which frees room to buy more.

const TRADE_PRICES = { 'Wood': 4, 'Stone': 6, 'Raw ore': 12 };

const MERCHANT = {
  stock: { 'Dried meat': 8, 'Health potion': 4, 'Wood': 0, 'Stone': 0, 'Raw ore': 0 },
  cap:   { 'Dried meat': 8, 'Health potion': 4, 'Wood': 18, 'Stone': 14, 'Raw ore': 8 },
  smelted: 0,
  convertT: 16,
  restockT: 40,
};

function updateMerchant(dt) {
  MERCHANT.convertT -= dt;
  if (MERCHANT.convertT <= 0) {
    MERCHANT.convertT = 16;
    let pick = null;
    for (const res in TRADE_PRICES) {
      if (MERCHANT.stock[res] > 0 && (!pick || MERCHANT.stock[res] > MERCHANT.stock[pick])) pick = res;
    }
    if (pick) {
      const used = Math.min(2, MERCHANT.stock[pick]);
      MERCHANT.stock[pick] -= used;
      MERCHANT.smelted += Math.max(1, Math.floor(TRADE_PRICES[pick] * used / 2));
    }
  }
  MERCHANT.restockT -= dt;
  if (MERCHANT.restockT <= 0) {
    MERCHANT.restockT = 40;
    if (MERCHANT.stock['Dried meat'] < MERCHANT.cap['Dried meat']) MERCHANT.stock['Dried meat']++;
    if (MERCHANT.stock['Health potion'] < MERCHANT.cap['Health potion']) MERCHANT.stock['Health potion']++;
  }
}

// ---- per-frame updates ------------------------------------------------------

function updatePlayer(dt, input) {
  const p = GAME.player;
  if (p.hp <= 0) return;

  const f = [Math.sin(p.yaw), Math.cos(p.yaw)];
  const r = [Math.cos(p.yaw), -Math.sin(p.yaw)];
  let mx = 0, mz = 0;
  if (input.KeyW) { mx += f[0]; mz += f[1]; }
  if (input.KeyS) { mx -= f[0]; mz -= f[1]; }
  if (input.KeyD) { mx += r[0]; mz += r[1]; }
  if (input.KeyA) { mx -= r[0]; mz -= r[1]; }
  if (input.tMoveX || input.tMoveY) { // virtual joystick (analog)
    mx += r[0] * input.tMoveX + f[0] * input.tMoveY;
    mz += r[1] * input.tMoveX + f[1] * input.tMoveY;
  }
  let ml = Math.hypot(mx, mz);
  if (ml > 1) { mx /= ml; mz /= ml; ml = 1; }
  const speed = input.ShiftLeft || input.ShiftRight ? 2.6 : 6.4;
  p.pos.x += mx * speed * dt;
  p.pos.z += mz * speed * dt;
  p.anim.moveAmt = lerp(p.anim.moveAmt, ml, dt * 10);
  p.anim.walkPhase += speed * 1.55 * dt * ml;

  // the Barrier repels everything
  const rr = Math.hypot(p.pos.x, p.pos.z);
  if (rr > WORLD.barrierR - 4) {
    p.pos.x *= (WORLD.barrierR - 4) / rr;
    p.pos.z *= (WORLD.barrierR - 4) / rr;
    uiMsg('The Barrier flings you back with a crackle of blue lightning.');
  }
  pushOutOfColliders(p.pos, 0.45);
  for (const n of GAME.npcs) {
    if (n.state === 'dead') continue;
    const dx = p.pos.x - n.pos.x, dz = p.pos.z - n.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.9 && d > 0.001) {
      p.pos.x = n.pos.x + dx / d * 0.9;
      p.pos.z = n.pos.z + dz / d * 0.9;
    }
  }

  // gravity / jumping
  const gy = groundY(p.pos.x, p.pos.z);
  p.vel.y -= 22 * dt;
  p.pos.y += p.vel.y * dt;
  if (p.pos.y <= gy) {
    p.pos.y = gy;
    p.vel.y = 0;
    p.grounded = true;
  } else {
    p.grounded = false;
  }
  if (input.Space && p.grounded) {
    p.vel.y = 8.2;
    p.grounded = false;
  }

  // attack swing timing
  if (p.attackCd > 0) p.attackCd -= dt;
  if (p.attackT > 0) {
    p.attackT += dt / 0.45;
    if (!p.hitDone && p.attackT >= 0.5) {
      p.hitDone = true;
      applyPlayerHit();
    }
    if (p.attackT >= 1) p.attackT = 0;
  }
  p.anim.attackT = p.attackT;
  if (p.hurtFlash > 0) p.hurtFlash -= dt * 2.5;
}

function moveNPCToward(n, tx, tz, dt) {
  const dx = tx - n.pos.x, dz = tz - n.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.3) return true;
  n.yaw = Math.atan2(dx, dz);
  n.pos.x += dx / d * n.speed * dt;
  n.pos.z += dz / d * n.speed * dt;
  pushOutOfColliders(n.pos, 0.4);
  n.anim.walkPhase += n.speed * 1.6 * dt;
  n.anim.moveAmt = lerp(n.anim.moveAmt, 1, dt * 8);
  return false;
}

function updateNPC(n, dt) {
  if (NET.active && n.netId !== undefined) return; // server-driven, see netUpdate()
  const a = n.anim;
  if (a.flash > 0) a.flash -= dt * 3;
  if (n.state === 'dead') {
    a.deadT = Math.min(a.deadT + dt * 2.2, 1);
    a.attackT = 0;
    a.moveAmt = 0;
    if (n.respawn) { // single-player: beasts and bandits return after a while
      n.respawnT -= dt;
      if (n.respawnT <= 0) {
        n.hp = n.maxhp;
        n.state = 'idle';
        n.stateT = 2 + Math.random() * 5;
        n.hostileNow = false;
        n.pos.x = n.home.x;
        n.pos.z = n.home.z;
        a.deadT = 0;
      }
    }
    return;
  }
  n.pos.y = terrainH(n.pos.x, n.pos.z);
  a.moveAmt = lerp(a.moveAmt, 0, dt * 6);

  const p = GAME.player;
  const dx = p.pos.x - n.pos.x, dz = p.pos.z - n.pos.z;
  const dist = Math.hypot(dx, dz);

  if (n.atkCd > 0) n.atkCd -= dt;
  if (a.attackT > 0) {
    a.attackT += dt / 0.5;
    if (n.hitPending > 0) {
      n.hitPending -= dt;
      if (n.hitPending <= 0 && dist < n.attackR + 0.7 && p.hp > 0) {
        damagePlayer(n.dmg + Math.floor(Math.random() * 3), n.name);
      }
    }
    if (a.attackT >= 1) a.attackT = 0;
  }

  const aggressive = (n.hostile || n.hostileNow) && p.hp > 0;
  if (aggressive) {
    if ((n.state === 'idle' || n.state === 'wander') && dist < n.aggroR) {
      n.state = 'chase';
      if (n.kind === 'human') uiMsg(n.name + ': "You picked the wrong path, stranger!"');
    }
    if (n.state === 'chase') {
      const leash = Math.hypot(n.pos.x - n.home.x, n.pos.z - n.home.z);
      if (dist > n.aggroR * 2.4 || leash > n.leashR) {
        n.state = 'wander';
        n.target = { x: n.home.x, z: n.home.z };
      } else if (dist < n.attackR) {
        n.yaw = Math.atan2(dx, dz);
        if (n.atkCd <= 0 && a.attackT <= 0) {
          a.attackT = 0.0001;
          n.atkCd = n.atkRate;
          n.hitPending = 0.27;
        }
      } else {
        moveNPCToward(n, p.pos.x, p.pos.z, dt);
      }
      return;
    }
  }

  // peaceful wandering / standing around
  n.stateT -= dt;
  if (n.state === 'idle') {
    // face the player if they come close for a chat
    if (dist < 3.5 && n.dialog) n.yaw = Math.atan2(dx, dz);
    if (n.stateT <= 0 && n.wanderR > 0) {
      n.state = 'wander';
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.random() * n.wanderR;
      n.target = { x: n.home.x + Math.sin(ang) * rad, z: n.home.z + Math.cos(ang) * rad };
      n.stateT = 8;
    }
  } else if (n.state === 'wander') {
    if (!n.target || moveNPCToward(n, n.target.x, n.target.z, dt) || n.stateT <= 0) {
      n.state = 'idle';
      n.stateT = 2 + Math.random() * 5;
    }
  }
}

function updateGame(dt, input) {
  const prevTod = GAME.timeOfDay;
  GAME.timeOfDay = (GAME.timeOfDay + dt / GAME.dayLength) % 1;
  if (GAME.timeOfDay < prevTod) GAME.day++; // midnight rolled over
  updatePlayer(dt, input);
  for (const n of GAME.npcs) updateNPC(n, dt);
  updateNodes(dt);
  updateMerchant(dt);
  if (GAME.focusT > 0) GAME.focusT -= dt;
}

// ---- interaction ------------------------------------------------------------

function nearestTalkable() {
  const p = GAME.player;
  let best = null, bestD = 3.2;
  for (const n of GAME.npcs) {
    if (n.state === 'dead' || !n.dialog || n.hostile || n.hostileNow) continue;
    const d = Math.hypot(n.pos.x - p.pos.x, n.pos.z - p.pos.z);
    if (d < bestD) { bestD = d; best = n; }
  }
  return best;
}

// ---- items -------------------------------------------------------------------

const ITEM_DEFS = {
  'Dried meat': { heal: 30, desc: 'Tough as leather, but it fills the stomach.' },
  'Molerat meat': { heal: 20, desc: 'Smells awful. Tastes worse. Still food.' },
  'Molerat soup': { heal: 40, desc: 'Snaf\'s daily ladle. Better than it has any right to be.' },
  'Wolf meat': { heal: 25, desc: 'Lean and stringy. A real meal, if you killed it yourself.' },
  'Health potion': { heal: 50, verb: 'Drink', desc: 'An alchemist\'s brew. Knits flesh in seconds.' },
  'Wood': { desc: 'Seasoned pine timber. Whistler pays 4 ore for it.' },
  'Stone': { desc: 'Quarried stone. Whistler pays 6 ore for it.' },
  'Raw ore': { desc: 'Magic ore, straight from the vein. Whistler pays 12 ore for it.' },
  'Pickaxe': { desc: 'Breaks stone blocks and the glowing ore vein.' },
  'Woodcutter\'s axe': { desc: 'Fells the dry pines scattered around the valley.' },
  'Torch': { desc: 'An offhand torch. Light it and the night backs off a few paces.' },
  'Old Camp blade': { dmg: 18, desc: 'Diego\'s gift. Plain, pitted, and it cuts.' },
  'Soldier\'s sword': { dmg: 28, desc: 'Guard issue. Its last owner no longer needs it.' },
  'Ore blade': { dmg: 40, desc: 'Forged with magic ore. The barons would not approve.' },
};

const SHOP_WEAPONS = [
  { name: 'Soldier\'s sword', price: 80 },
  { name: 'Ore blade', price: 220 },
];

// Equip a weapon from the inventory ('Fists' is always available).
function equipWeapon(name) {
  const p = GAME.player;
  if (name !== 'Fists' && (!p.items[name] || !ITEM_DEFS[name].dmg)) return;
  p.weaponName = name;
  p.weaponDmg = name === 'Fists' ? 6 : ITEM_DEFS[name].dmg;
  p.hasSword = name !== 'Fists';
  uiMsg('Equipped: ' + name);
  renderInventory();
}

function toggleTorch() {
  const p = GAME.player;
  if (!p.items['Torch']) return;
  p.torchLit = !p.torchLit;
  uiMsg(p.torchLit ? 'You light the torch.' : 'You snuff the torch.');
  renderInventory();
}

function eatItem(name) {
  const p = GAME.player;
  if (!p.items[name] || p.items[name] <= 0) return;
  const def = ITEM_DEFS[name];
  if (!def.heal) return;
  p.items[name]--;
  p.hp = Math.min(p.maxhp, p.hp + def.heal);
  uiMsg('You ' + (def.verb || 'eat').toLowerCase() + ' the ' + name.toLowerCase()
      + '. (+' + def.heal + ' HP)');
  renderInventory();
}

// ---- dialogue ------------------------------------------------------------------

const DIALOGS = {
  diego: {
    main(n) {
      const q = GAME.quest;
      const opts = [
        { t: 'Who are you?', next: 'who' },
        { t: 'Where am I?', next: 'where' },
        { t: 'What is this Barrier everyone talks about?', next: 'barrier' },
      ];
      if (q.molerats === 'none') opts.push({ t: 'I could use some work.', next: 'offer' });
      if (q.molerats === 'active' && q.kills < 5) opts.push({ t: 'About those molerats...', next: 'progress' });
      if (q.molerats === 'active' && q.kills >= 5) opts.push({ t: 'The molerats are dead.', next: 'reward' });
      opts.push({ t: 'I\'ll be on my way.', next: null });
      return {
        text: 'Hey, you! I haven\'t seen your face before — you must be the one they threw '
            + 'over the Barrier this morning. I\'m Diego. I keep an eye on the gate, and on '
            + 'the new diggers. Stay out of trouble and we\'ll get along.',
        opts: opts,
      };
    },
    who(n) {
      return {
        text: 'One of Gomez\'s men. The Old Camp belongs to him — the ore barons sit in the '
            + 'castle, the diggers sweat in the mine, and people like me keep the whole thing '
            + 'from falling apart.',
        opts: [{ t: 'Back.', next: 'main' }],
      };
    },
    where(n) {
      return {
        text: 'You\'re in the Colony, my friend. The King needs magic ore for his war, and '
            + 'convicts dig it. Doesn\'t matter what you did out there — in here you start '
            + 'with nothing, like everyone else. There\'s no way out, so get used to it.',
        opts: [{ t: 'Back.', next: 'main' }],
      };
    },
    barrier(n) {
      return {
        text: 'The King\'s twelve mages were supposed to seal the mine valley with a small '
            + 'dome of magic. It grew far beyond what they planned — and trapped them inside '
            + 'with us. You can see it shimmer above the mountains. Anything can pass in. '
            + 'Nothing passes out. Touch it and it throws you back.',
        opts: [{ t: 'Back.', next: 'main' }],
      };
    },
    offer(n) {
      return {
        text: 'As it happens, yes. Molerats have dug in along the path to the old mine, east '
            + 'of the gate. The diggers refuse to pass. Kill five of those beasts and I\'ll '
            + 'pay you 50 ore nuggets. Here — take this blade. You\'ll need it.',
        opts: [
          { t: 'Consider it done.', fn: function() {
              GAME.quest.molerats = 'active';
              const p = GAME.player;
              p.items['Old Camp blade'] = 1;
              uiMsg('Received: Old Camp blade');
              equipWeapon('Old Camp blade');
              uiMsg('New quest: clear the molerats from the mine path. (Journal: J)');
              return null;
            } },
          { t: 'I\'ll think about it.', next: 'main' },
        ],
      };
    },
    progress(n) {
      return {
        text: 'Counting ' + GAME.quest.kills + ' of 5 so far. The path follows the valley '
            + 'south-east of the gate — you\'ll hear the beasts squeal before you see them.',
        opts: [{ t: 'Back.', next: 'main' }],
      };
    },
    reward(n) {
      return {
        text: 'All five? Good work. Here\'s your ore — 50 nuggets, as agreed. Maybe you\'re '
            + 'worth something after all. Keep your head down and your blade sharp.',
        opts: [{ t: 'Thanks.', fn: function() {
            GAME.quest.molerats = 'rewarded';
            GAME.player.ore += 50;
            uiMsg('Received: 50 ore nuggets');
            addXP(120);
            return null;
          } }],
      };
    },
  },
  guard: {
    main(n) {
      const lines = [
        'Keep moving. And don\'t even think about getting into the castle — barons only.',
        'New face, huh? Rule one: don\'t touch the guards\' ore. Rule two: see rule one.',
        'The old mine\'s crawling with molerats lately. Talk to Diego if you want coin for blade work.',
      ];
      return {
        text: lines[Math.floor(Math.random() * lines.length)],
        opts: [{ t: 'Understood.', next: null }],
      };
    },
  },
  whistler: {
    main(n) {
      return {
        text: 'Psst. New blood. Got ore on you? I deal in things a digger actually needs — '
            + 'food, tools, steel. And I BUY: wood, stone, raw ore. My smelter turns the lot '
            + 'into nuggets, slowly. You carry ' + GAME.player.ore + ' ore.',
        opts: [
          { t: 'Show me food and potions.', next: 'trade' },
          { t: 'I need tools.', next: 'tools' },
          { t: 'Show me your blades.', next: 'weapons' },
          { t: 'I have goods to sell.', next: 'sell' },
          { t: 'Not interested.', next: null },
        ],
      };
    },
    trade(n) {
      function buy(name, price) {
        return function() {
          const p = GAME.player;
          if (MERCHANT.stock[name] <= 0) {
            uiMsg('Whistler: "Fresh out. My stock comes back slowly — check later."');
          } else if (p.ore >= price) {
            p.ore -= price;
            MERCHANT.stock[name]--;
            p.items[name] = (p.items[name] || 0) + 1;
            uiMsg('Bought: ' + name);
          } else {
            uiMsg('Not enough ore.');
          }
          return 'trade';
        };
      }
      return {
        text: 'Dried meat keeps you on your feet, the potion puts you back ON them. '
            + 'Stock: ' + MERCHANT.stock['Dried meat'] + ' meat, '
            + MERCHANT.stock['Health potion'] + ' potions. You carry ' + GAME.player.ore + ' ore.',
        opts: [
          { t: 'Buy dried meat. (10 ore)', fn: buy('Dried meat', 10) },
          { t: 'Buy a health potion. (25 ore)', fn: buy('Health potion', 25) },
          { t: 'That\'s all.', next: 'main' },
        ],
      };
    },
    tools(n) {
      function buyTool(name, price) {
        return function() {
          const p = GAME.player;
          if (p.items[name]) {
            uiMsg('You already own a ' + name.toLowerCase() + '.');
          } else if (p.ore >= price) {
            p.ore -= price;
            p.items[name] = 1;
            uiMsg('Bought: ' + name);
          } else {
            uiMsg('Not enough ore.');
          }
          return 'tools';
        };
      }
      return {
        text: 'A pickaxe for the stone blocks and the ore vein out north-west — mind the '
            + 'wolves. An axe for the dry pines. A torch for when the sun leaves you. '
            + 'You carry ' + GAME.player.ore + ' ore.',
        opts: [
          { t: 'Buy a pickaxe. (35 ore)', fn: buyTool('Pickaxe', 35) },
          { t: 'Buy a woodcutter\'s axe. (35 ore)', fn: buyTool('Woodcutter\'s axe', 35) },
          { t: 'Buy a torch. (15 ore)', fn: buyTool('Torch', 15) },
          { t: 'That\'s all.', next: 'main' },
        ],
      };
    },
    weapons(n) {
      const opts = SHOP_WEAPONS.map(function(w) {
        return { t: 'Buy the ' + w.name.toLowerCase() + ' — damage ' + ITEM_DEFS[w.name].dmg
                  + '. (' + w.price + ' ore)',
          fn: function() {
            const p = GAME.player;
            if (p.items[w.name]) {
              uiMsg('You already own the ' + w.name.toLowerCase() + '.');
            } else if (p.ore >= w.price) {
              p.ore -= w.price;
              p.items[w.name] = 1;
              uiMsg('Bought: ' + w.name);
              if (ITEM_DEFS[w.name].dmg > p.weaponDmg) equipWeapon(w.name);
            } else {
              uiMsg('Not enough ore.');
            }
            return 'weapons';
          } };
      });
      opts.push({ t: 'That\'s all.', next: 'main' });
      return {
        text: 'Steel that beats the Old Camp blade — don\'t ask where it\'s from. '
            + 'Win a duel or two and it pays for itself. You carry ' + GAME.player.ore + ' ore.',
        opts: opts,
      };
    },
    sell(n) {
      const p = GAME.player;
      const opts = [];
      for (const res in TRADE_PRICES) {
        const have = p.items[res] || 0;
        const room = MERCHANT.cap[res] - MERCHANT.stock[res];
        opts.push({ t: 'Sell ' + res.toLowerCase() + ' ×' + have + '. (' + TRADE_PRICES[res]
                      + ' ore each, takes up to ' + room + ')',
          fn: function(r) { return function() {
            const amt = Math.min(GAME.player.items[r] || 0, MERCHANT.cap[r] - MERCHANT.stock[r]);
            if (!(GAME.player.items[r] > 0)) {
              uiMsg('You have no ' + r.toLowerCase() + ' to sell.');
            } else if (amt <= 0) {
              uiMsg('Whistler: "No room for more ' + r.toLowerCase()
                  + ' until the smelter catches up. Come back later."');
            } else {
              GAME.player.items[r] -= amt;
              MERCHANT.stock[r] += amt;
              GAME.player.ore += amt * TRADE_PRICES[r];
              uiMsg('Sold: ' + amt + ' × ' + r + ' for ' + amt * TRADE_PRICES[r] + ' ore');
            }
            return 'sell';
          }; }(res) });
      }
      opts.push({ t: 'That\'s all.', next: 'main' });
      return {
        text: 'Wood 4, stone 6, raw ore 12 nuggets apiece — while I have room. The smelter '
            + 'has burned my stock into ' + MERCHANT.smelted + ' nuggets so far. Holding: '
            + MERCHANT.stock['Wood'] + '/' + MERCHANT.cap['Wood'] + ' wood, '
            + MERCHANT.stock['Stone'] + '/' + MERCHANT.cap['Stone'] + ' stone, '
            + MERCHANT.stock['Raw ore'] + '/' + MERCHANT.cap['Raw ore'] + ' raw ore.',
        opts: opts,
      };
    },
  },
  snaf: {
    main(n) {
      const opts = [];
      if (GAME.day > GAME.lastSoupDay) {
        opts.push({ t: 'I\'ll take that ladle.', fn: function() {
            GAME.lastSoupDay = GAME.day;
            const p = GAME.player;
            p.items['Molerat soup'] = (p.items['Molerat soup'] || 0) + 1;
            uiMsg('Received: Molerat soup');
            return null;
          } });
      }
      opts.push({ t: GAME.day > GAME.lastSoupDay ? 'I\'ll pass.' : 'See you tomorrow.', next: null });
      return {
        text: GAME.day > GAME.lastSoupDay
          ? 'Soup\'s on! One ladle per digger per day, that\'s the rule. It\'s molerat. '
            + 'It\'s always molerat. You want it or not?'
          : 'You already had your ladle today. The pot has to last the whole camp — '
            + 'come back tomorrow.',
        opts: opts,
      };
    },
  },
  digger: {
    main(n) {
      const lines = [
        'Another day in this hole. Dig, eat, sleep. At least nobody collects taxes.',
        'Got any ore on you? ...Forget it, the guards are watching.',
        'I used to be a merchant, you know. One sack of stolen grain and — poof — over the Barrier I went.',
        'Stay away from the south-west lake at night. Things drink there that I don\'t have a name for.',
        'They say the mages live in their own circle now. Fat lot of good their magic does us.',
      ];
      return {
        text: lines[Math.floor(Math.random() * lines.length)],
        opts: [{ t: 'See you around.', next: null }],
      };
    },
  },
};
