'use strict';
// ---------------------------------------------------------------------------
// server.js — the Gothic world server. One persistent world, n players.
//
// Zero dependencies: the WebSocket protocol (RFC 6455) is implemented by hand
// on top of node's http module, in the same from-scratch spirit as the game.
//
//   node server.js            (port 8080, or $PORT when set by the host)
//
// The server owns: time of day, hostile NPCs (molerats, bandits, wolves)
// including their AI, deaths and respawns, relays player states and chat, and
// referees duels — the only way players can hurt players, and it never kills:
// at 10 HP the duel ends and the loser forfeits half their ore to the winner.
// World time is saved to world.json periodically; set GITHUB_TOKEN + GIST_ID
// to also back it up to a GitHub Gist (free hosts wipe the disk on restart).
// ---------------------------------------------------------------------------

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');

const PORT = process.env.PORT || 8080;
const SAVE_FILE = 'world.json';
const TICK = 0.1;          // 10 simulation ticks per second
const DAY_LENGTH = 480;    // seconds per in-game day (matches the client)
const GIST_ID = process.env.GIST_ID || '';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';

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

// Hostile roster. Spawn positions MUST match js/game.js (mrSpots / bSpots /
// wSpots) — clients map these to their local NPCs by array order.
const MR_SPOTS = [[22, 92], [30, 100], [26, 106], [34, 92], [18, 102], [38, 104], [28, 86]];
const B_SPOTS = [[58, -66], [63, -70], [55, -71]];
const W_SPOTS = [[-42, -82], [-51, -90], [-44, -93]]; // wolves around the ore vein

const npcs = [];
for (const s of MR_SPOTS) {
  npcs.push({ tpl: 'molerat', x: s[0], z: s[1], maxhp: 40, dmg: 7, speed: 3.6,
              aggroR: 9, attackR: 1.8, leashR: 22, atkRate: 1.3, respawn: 60 });
}
for (const s of B_SPOTS) {
  npcs.push({ tpl: 'bandit', x: s[0], z: s[1], maxhp: 70, dmg: 11, speed: 4.6,
              aggroR: 13, attackR: 2.1, leashR: 30, atkRate: 1.5, respawn: 120 });
}
for (const s of W_SPOTS) {
  npcs.push({ tpl: 'wolf', x: s[0], z: s[1], maxhp: 55, dmg: 12, speed: 5.2,
              aggroR: 12, attackR: 1.9, leashR: 24, atkRate: 1.1, respawn: 90 });
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
} else if (GIST_ID) {
  // fresh disk (free hosts wipe it on every deploy) — restore from the gist
  gistFetch(function(saved) {
    if (saved && saved.day >= world.day) {
      world.timeOfDay = saved.timeOfDay;
      world.day = saved.day;
      console.log('Restored world from gist: day ' + world.day);
    }
  });
}

// ---- gist backup (zero-dep; survives free-tier disk wipes) ---------------------

function gistRequest(method, body, cb) {
  const headers = {
    'User-Agent': 'gothic-world-server',
    'Accept': 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };
  if (GITHUB_TOKEN) headers['Authorization'] = 'Bearer ' + GITHUB_TOKEN;
  const req = https.request({
    hostname: 'api.github.com',
    path: '/gists/' + GIST_ID,
    method: method,
    headers: headers,
  }, function(res) {
    let data = '';
    res.on('data', function(ch) { data += ch; });
    res.on('end', function() { cb(res.statusCode, data); });
  });
  req.on('error', function(e) { console.log('gist ' + method + ' failed: ' + e.message); });
  if (body) req.write(body);
  req.end();
}

function gistFetch(cb) {
  gistRequest('GET', null, function(status, data) {
    if (status !== 200) { console.log('gist fetch: HTTP ' + status); cb(null); return; }
    const g = JSON.parse(data);
    const f = g.files && g.files[SAVE_FILE];
    cb(f && f.content ? JSON.parse(f.content) : null);
  });
}

let lastGistDay = 0;
function gistBackup() {
  if (!GIST_ID || !GITHUB_TOKEN || world.day === lastGistDay) return;
  lastGistDay = world.day;
  const files = {};
  files[SAVE_FILE] = { content: JSON.stringify({ timeOfDay: world.timeOfDay, day: world.day }) };
  gistRequest('PATCH', JSON.stringify({ files: files }), function(status) {
    if (status !== 200) console.log('gist backup: HTTP ' + status);
  });
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
               m.sw ? 1 : 0, m.lv | 0, m.tc ? 1 : 0];
    c.lastSeen = now;
  } else if (m.t === 'swing') {
    // server-authoritative hit detection. Base damage comes from the client's
    // equipped weapon, clamped to what the shop can actually sell.
    const fx = Math.sin(m.yaw), fz = Math.cos(m.yaw);
    const base = m.wd ? Math.max(6, Math.min(40, m.wd | 0)) : (m.sw ? 18 : 6);
    const dmg = base + Math.max(0, (m.lv | 0) - 1) * 3 + Math.floor(Math.random() * 4);
    for (const n of npcs) {
      if (n.state === 'dead') continue;
      const dx = n.x - m.x, dz = n.z - m.z;
      const d = Math.hypot(dx, dz);
      if (d > 2.6) continue;
      if ((dx * fx + dz * fz) / (d || 1) < 0.3) continue;
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
    // duels are the one way players can hurt players — and they never kill
    if (c.duelWith) {
      const o = clients.get(c.duelWith);
      if (o && o.ready && o.state[5] > 0) {
        const dx = o.state[0] - m.x, dz = o.state[1] - m.z;
        const d = Math.hypot(dx, dz);
        if (d < 3.0 && (dx * fx + dz * fz) / (d || 1) > 0.25) {
          send(o, { t: 'dhit', dmg: dmg, by: c.name });
        }
      }
    }
  } else if (m.t === 'chat') {
    const txt = String(m.msg || '').slice(0, 120);
    if (txt && now - (c.lastChat || 0) > 0.8) {
      c.lastChat = now;
      broadcast({ t: 'chat', id: c.id, name: c.name, msg: txt });
    }
  } else if (m.t === 'duel') {
    const o = clients.get(m.to | 0);
    if (o && o.ready && o.id !== c.id && !c.duelWith && !o.duelWith) {
      const d = Math.hypot(c.state[0] - o.state[0], c.state[1] - o.state[1]);
      if (d < 8) {
        o.pendingDuelFrom = c.id;
        o.pendingDuelT = now + 20;
        send(o, { t: 'duelreq', from: c.id, name: c.name });
      }
    }
  } else if (m.t === 'duelok') {
    const a = clients.get(m.to | 0); // the challenger
    if (a && a.ready && c.pendingDuelFrom === a.id && now < c.pendingDuelT
        && !a.duelWith && !c.duelWith) {
      c.pendingDuelFrom = null;
      a.duelWith = c.id;
      c.duelWith = a.id;
      send(a, { t: 'duelstart', opp: c.id, name: c.name });
      send(c, { t: 'duelstart', opp: a.id, name: a.name });
      console.log('duel: ' + a.name + ' vs ' + c.name);
    }
  } else if (m.t === 'duelore') {
    // the loser hands over half their ore; forward it to the winner
    const w = clients.get(m.to | 0);
    const amt = Math.max(0, m.ore | 0);
    if (w && w.ready && c.lastDuelWinner === w.id) {
      c.lastDuelWinner = null;
      send(w, { t: 'duelwin', ore: amt });
    }
  }
}

function dropClient(c, reason) {
  if (c.duelWith) { // walking out on a duel calls it off
    const o = clients.get(c.duelWith);
    c.duelWith = null;
    if (o && o.duelWith === c.id) {
      o.duelWith = null;
      send(o, { t: 'duelcancel', why: c.name + ' left the world' });
    }
  }
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
              name: '', state: [0, 60, 0, 0, 0, 100, 0, 1, 0], lastSeen: now,
              duelWith: null, pendingDuelFrom: null, pendingDuelT: 0,
              lastDuelWinner: null, lastChat: 0 };
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

  // referee the duels: expired challenges, runaways, and the 10-HP yield point
  for (const c of clients.values()) {
    if (!c.ready) continue;
    if (c.pendingDuelFrom && now > c.pendingDuelT) c.pendingDuelFrom = null;
    if (!c.duelWith || c.id > c.duelWith) continue; // handle each pair once
    const o = clients.get(c.duelWith);
    if (!o || !o.ready) continue; // dropClient cleans broken pairs
    const dist = Math.hypot(c.state[0] - o.state[0], c.state[1] - o.state[1]);
    if (dist > 25) {
      c.duelWith = null;
      o.duelWith = null;
      const msg = { t: 'duelcancel', why: 'you drifted too far apart' };
      send(c, msg);
      send(o, msg);
    } else if (c.state[5] <= 10 || o.state[5] <= 10) {
      const loser = c.state[5] <= 10 ? c : o;
      const winner = loser === c ? o : c;
      c.duelWith = null;
      o.duelWith = null;
      loser.lastDuelWinner = winner.id;
      broadcast({ t: 'duelend', winner: winner.id, loser: loser.id,
                  wname: winner.name, lname: loser.name });
      console.log('duel: ' + winner.name + ' defeats ' + loser.name);
    }
  }

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

// time sync + persistence (gist backup once per in-game day at most)
setInterval(function() {
  broadcast({ t: 'time', tod: world.timeOfDay, day: world.day });
  fs.writeFileSync(SAVE_FILE, JSON.stringify({ timeOfDay: world.timeOfDay, day: world.day }));
  gistBackup();
}, 10000);

server.listen(PORT, function() {
  console.log('Gothic world server listening on port ' + PORT);
});
