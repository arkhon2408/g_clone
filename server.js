'use strict';
// ---------------------------------------------------------------------------
// server.js — the Gothic world server. One persistent world, n players.
//
// Zero dependencies: the WebSocket protocol (RFC 6455) is implemented by hand
// on top of node's http module, in the same from-scratch spirit as the game.
//
//   node server.js            (port 8080, or $PORT when set by the host)
//
// The server owns: time of day, hostile NPCs (molerats + bandits) including
// their AI, deaths and respawns, and relays player states. Friendly camp NPCs
// are cosmetic and stay client-side. There is no PvP code path at all, so
// players cannot hurt players. World time is saved to world.json periodically.
// ---------------------------------------------------------------------------

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');

const PORT = process.env.PORT || 8080;
const SAVE_FILE = 'world.json';
const TICK = 0.1;          // 10 simulation ticks per second
const DAY_LENGTH = 480;    // seconds per in-game day (matches the client)

// ---- websocket plumbing -----------------------------------------------------

function acceptKey(key) {
  return crypto.createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
}

function encodeFrame(str, opcode) {
  const payload = Buffer.from(str);
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x80 | (opcode === undefined ? 1 : opcode); // FIN + opcode
  return Buffer.concat([header, payload]);
}

// Parses as many complete frames as possible from c.buf. Returns messages.
function parseFrames(c) {
  const messages = [];
  while (true) {
    const buf = c.buf;
    if (buf.length < 2) return messages;
    const opcode = buf[0] & 0x0f;
    const masked = buf[1] & 0x80;
    let len = buf[1] & 0x7f;
    let off = 2;
    if (len === 126) {
      if (buf.length < 4) return messages;
      len = buf.readUInt16BE(2);
      off = 4;
    } else if (len === 127) {
      if (buf.length < 10) return messages;
      len = Number(buf.readBigUInt64BE(2));
      off = 10;
    }
    let mask = null;
    if (masked) {
      if (buf.length < off + 4) return messages;
      mask = buf.slice(off, off + 4);
      off += 4;
    }
    if (buf.length < off + len) return messages;
    const payload = buf.slice(off, off + len);
    if (mask) {
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
    }
    c.buf = buf.slice(off + len);
    if (opcode === 8) { messages.push(null); return messages; }      // close
    if (opcode === 9) { c.sock.write(encodeFrame(payload.toString(), 10)); continue; } // ping->pong
    if (opcode === 1) messages.push(payload.toString());
  }
}

// ---- world state -------------------------------------------------------------

// Hostile roster. Spawn positions MUST match js/game.js (mrSpots / bSpots) —
// clients map these to their local NPCs by array order.
const MR_SPOTS = [[22, 92], [30, 100], [26, 106], [34, 92], [18, 102], [38, 104], [28, 86]];
const B_SPOTS = [[58, -66], [63, -70], [55, -71]];

const npcs = [];
for (const s of MR_SPOTS) {
  npcs.push({ tpl: 'molerat', x: s[0], z: s[1], maxhp: 40, dmg: 7, speed: 3.6,
              aggroR: 9, attackR: 1.8, leashR: 22, atkRate: 1.3, respawn: 60 });
}
for (const s of B_SPOTS) {
  npcs.push({ tpl: 'bandit', x: s[0], z: s[1], maxhp: 70, dmg: 11, speed: 4.6,
              aggroR: 13, attackR: 2.1, leashR: 30, atkRate: 1.5, respawn: 120 });
}
npcs.forEach(function(n, i) {
  n.id = i;
  n.home = { x: n.x, z: n.z };
  n.yaw = 0;
  n.hp = n.maxhp;
  n.state = 'idle';
  n.stateT = 1 + Math.random() * 4;
  n.target = null;
  n.atkCd = 0;
  n.respawnT = 0;
  n.moving = false;
  n.dirty = true;
});

const world = { timeOfDay: 10.2 / 24, day: 1 };
if (fs.existsSync(SAVE_FILE)) {
  const saved = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8'));
  world.timeOfDay = saved.timeOfDay;
  world.day = saved.day;
  console.log('Restored world: day ' + world.day);
}

const clients = new Map(); // id -> client
let nextId = 1;
const pendingHits = [];    // {at, npcId, playerId, dmg}
let now = 0;               // server uptime seconds

// ---- messaging ----------------------------------------------------------------

function send(c, obj) {
  if (!c.sock.destroyed) c.sock.write(encodeFrame(JSON.stringify(obj)));
}
function broadcast(obj, exceptId) {
  const frame = encodeFrame(JSON.stringify(obj));
  for (const c of clients.values()) {
    if (c.id !== exceptId && c.ready && !c.sock.destroyed) c.sock.write(frame);
  }
}

function playerList() {
  const list = [];
  for (const c of clients.values()) {
    if (c.ready) list.push({ id: c.id, name: c.name, s: c.state });
  }
  return list;
}

function npcSnapshot() {
  return npcs.map(function(n) {
    return { id: n.id, x: r2(n.x), z: r2(n.z), hp: n.hp, dead: n.state === 'dead' ? 1 : 0 };
  });
}

function r2(v) { return Math.round(v * 100) / 100; }

// ---- client handling -----------------------------------------------------------

function handleMessage(c, raw) {
  const m = JSON.parse(raw);
  if (m.t === 'hello') {
    c.name = String(m.name || 'Stranger').slice(0, 24);
    c.ready = true;
    send(c, { t: 'welcome', id: c.id, tod: world.timeOfDay, day: world.day,
              players: playerList().filter(function(p) { return p.id !== c.id; }),
              npcs: npcSnapshot() });
    broadcast({ t: 'join', id: c.id, name: c.name }, c.id);
    console.log('+ ' + c.name + ' (#' + c.id + ') — ' + clients.size + ' online');
  } else if (m.t === 's') {
    c.state = [r2(m.x), r2(m.z), r2(m.yaw), r2(m.m), m.a ? 1 : 0, Math.round(m.hp),
               m.sw ? 1 : 0, m.lv | 0];
    c.lastSeen = now;
  } else if (m.t === 'swing') {
    // server-authoritative hit detection against hostiles only — no PvP
    const fx = Math.sin(m.yaw), fz = Math.cos(m.yaw);
    const base = m.sw ? 18 : 6;
    for (const n of npcs) {
      if (n.state === 'dead') continue;
      const dx = n.x - m.x, dz = n.z - m.z;
      const d = Math.hypot(dx, dz);
      if (d > 2.6) continue;
      if ((dx * fx + dz * fz) / (d || 1) < 0.3) continue;
      const dmg = base + Math.max(0, (m.lv | 0) - 1) * 3 + Math.floor(Math.random() * 4);
      n.hp -= dmg;
      if (n.state === 'idle' || n.state === 'wander') n.state = 'chase';
      if (n.hp <= 0) {
        n.hp = 0;
        n.state = 'dead';
        n.respawnT = n.respawn;
        n.moving = false;
        broadcast({ t: 'ndead', id: n.id, by: c.id });
      } else {
        broadcast({ t: 'nhit', id: n.id, hp: n.hp, by: c.id });
      }
    }
  }
}

function dropClient(c, reason) {
  if (clients.delete(c.id) && c.ready) {
    broadcast({ t: 'leave', id: c.id, name: c.name });
    console.log('- ' + c.name + ' (#' + c.id + ', ' + reason + ') — ' + clients.size + ' online');
  }
  c.sock.destroy();
}

const server = http.createServer(function(req, res) {
  if (req.url.indexOf('/wait') === 0) {
    // responds after a delay — used by the client test harness to hold the
    // page's load event open until the websocket handshake has finished
    setTimeout(function() {
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
      res.end('ok');
    }, 5000);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
  res.end('Gothic world server — day ' + world.day + ', ' + clients.size + ' players online.\n'
        + 'Point the game at this host with ?server=ws(s)://...\n');
});

server.on('upgrade', function(req, sock) {
  const key = req.headers['sec-websocket-key'];
  if (!key) { sock.destroy(); return; }
  sock.write('HTTP/1.1 101 Switching Protocols\r\n'
           + 'Upgrade: websocket\r\nConnection: Upgrade\r\n'
           + 'Sec-WebSocket-Accept: ' + acceptKey(key) + '\r\n\r\n');
  const c = { id: nextId++, sock: sock, buf: Buffer.alloc(0), ready: false,
              name: '', state: [0, 60, 0, 0, 0, 100, 0, 1], lastSeen: now };
  clients.set(c.id, c);
  sock.on('data', function(data) {
    c.buf = Buffer.concat([c.buf, data]);
    for (const msg of parseFrames(c)) {
      if (msg === null) { dropClient(c, 'closed'); return; }
      handleMessage(c, msg);
    }
  });
  sock.on('error', function() { dropClient(c, 'error'); });
  sock.on('close', function() { dropClient(c, 'gone'); });
});

// ---- simulation ------------------------------------------------------------------

function nearestPlayer(x, z, maxR) {
  let best = null, bestD = maxR;
  for (const c of clients.values()) {
    if (!c.ready || c.state[5] <= 0) continue; // dead players are not prey
    const d = Math.hypot(c.state[0] - x, c.state[1] - z);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

function moveToward(n, tx, tz, dt) {
  const dx = tx - n.x, dz = tz - n.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.3) { n.moving = false; return true; }
  n.yaw = Math.atan2(dx, dz);
  n.x += dx / d * n.speed * dt;
  n.z += dz / d * n.speed * dt;
  n.moving = true;
  n.dirty = true;
  return false;
}

function tickNPC(n, dt) {
  if (n.state === 'dead') {
    n.respawnT -= dt;
    if (n.respawnT <= 0) {
      n.hp = n.maxhp;
      n.x = n.home.x;
      n.z = n.home.z;
      n.state = 'idle';
      n.stateT = 2 + Math.random() * 4;
      broadcast({ t: 'nspawn', id: n.id, x: r2(n.x), z: r2(n.z), hp: n.hp });
    }
    return;
  }
  if (n.atkCd > 0) n.atkCd -= dt;
  n.moving = false;

  const prey = nearestPlayer(n.x, n.z, n.state === 'chase' ? n.aggroR * 2.4 : n.aggroR);
  if (prey && (n.state === 'idle' || n.state === 'wander')) {
    n.state = 'chase';
    broadcast({ t: 'naggro', id: n.id, target: prey.id });
  }
  if (n.state === 'chase') {
    const leash = Math.hypot(n.x - n.home.x, n.z - n.home.z);
    if (!prey || leash > n.leashR) {
      n.state = 'wander';
      n.target = { x: n.home.x, z: n.home.z };
      return;
    }
    const dist = Math.hypot(prey.state[0] - n.x, prey.state[1] - n.z);
    if (dist < n.attackR) {
      n.yaw = Math.atan2(prey.state[0] - n.x, prey.state[1] - n.z);
      n.dirty = true;
      if (n.atkCd <= 0) {
        n.atkCd = n.atkRate;
        broadcast({ t: 'natk', id: n.id });
        pendingHits.push({ at: now + 0.3, npcId: n.id, playerId: prey.id,
                           dmg: n.dmg + Math.floor(Math.random() * 3) });
      }
    } else {
      moveToward(n, prey.state[0], prey.state[1], dt);
    }
    return;
  }
  // idle / wander around home
  n.stateT -= dt;
  if (n.state === 'idle') {
    if (n.stateT <= 0) {
      n.state = 'wander';
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.random() * 6;
      n.target = { x: n.home.x + Math.sin(ang) * rad, z: n.home.z + Math.cos(ang) * rad };
      n.stateT = 8;
    }
  } else if (n.state === 'wander') {
    if (!n.target || moveToward(n, n.target.x, n.target.z, dt) || n.stateT <= 0) {
      n.state = 'idle';
      n.stateT = 2 + Math.random() * 5;
    }
  }
}

setInterval(function() {
  now += TICK;
  const prevTod = world.timeOfDay;
  world.timeOfDay = (world.timeOfDay + TICK / DAY_LENGTH) % 1;
  if (world.timeOfDay < prevTod) world.day++;

  for (const n of npcs) tickNPC(n, TICK);

  // delayed melee hits land only if the victim is still in reach
  for (let i = pendingHits.length - 1; i >= 0; i--) {
    const h = pendingHits[i];
    if (h.at > now) continue;
    pendingHits.splice(i, 1);
    const victim = clients.get(h.playerId);
    const n = npcs[h.npcId];
    if (!victim || !victim.ready || n.state === 'dead') continue;
    const dist = Math.hypot(victim.state[0] - n.x, victim.state[1] - n.z);
    if (dist < n.attackR + 0.9 && victim.state[5] > 0) {
      send(victim, { t: 'phit', dmg: h.dmg, by: n.tpl });
    }
  }

  // broadcast moved hostiles
  const moved = [];
  for (const n of npcs) {
    if (n.dirty) {
      moved.push([n.id, r2(n.x), r2(n.z), r2(n.yaw), n.moving ? 1 : 0]);
      n.dirty = false;
    }
  }
  if (moved.length) broadcast({ t: 'n', l: moved });

  // broadcast all player states
  const list = [];
  for (const c of clients.values()) {
    if (c.ready) list.push([c.id].concat(c.state));
  }
  if (list.length) broadcast({ t: 'p', l: list });

  // drop silent connections
  for (const c of clients.values()) {
    if (now - c.lastSeen > 30) dropClient(c, 'timeout');
  }
}, TICK * 1000);

// time sync + persistence
setInterval(function() {
  broadcast({ t: 'time', tod: world.timeOfDay, day: world.day });
  fs.writeFileSync(SAVE_FILE, JSON.stringify({ timeOfDay: world.timeOfDay, day: world.day }));
}, 10000);

server.listen(PORT, function() {
  console.log('Gothic world server listening on port ' + PORT);
});
