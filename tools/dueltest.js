'use strict';
// ---------------------------------------------------------------------------
// tools/dueltest.js — end-to-end duel + chat test against a running server.
//   node tools/dueltest.js [host] [port]
// Connects two players, has A challenge B, B accept, A beat B down to the
// 10-HP yield point, checks the ore forfeit reaches A, and checks chat relay.
// Prints PASS/FAIL lines and exits 0/1.
// ---------------------------------------------------------------------------

const net = require('net');
const tls = require('tls');
const crypto = require('crypto');

const HOST = process.argv[2] || 'localhost';
const PORT = parseInt(process.argv[3] || '8080', 10);

const results = [];
function check(name, cond) {
  results.push((cond ? 'PASS  ' : 'FAIL  ') + name);
  console.log(results[results.length - 1]);
}
function finish() {
  const failed = results.filter(function(r) { return r.indexOf('FAIL') === 0; }).length;
  console.log(failed ? 'DUELTEST FAILED (' + failed + ')' : 'DUELTEST ALL PASS ('
              + results.length + ' checks)');
  process.exit(failed ? 1 : 0);
}
setTimeout(function() { check('finished within 30s', false); finish(); }, 30000);

function wsFrame(str) {
  const payload = Buffer.from(str);
  const mask = crypto.randomBytes(4);
  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i & 3];
  let header;
  if (payload.length < 126) {
    header = Buffer.alloc(2);
    header[1] = 0x80 | payload.length;
  } else {
    header = Buffer.alloc(4);
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
  }
  header[0] = 0x81;
  return Buffer.concat([header, mask, masked]);
}

function connect(name, x, z, onMsg) {
  const key = crypto.randomBytes(16).toString('base64');
  function hello() {
    sock.write('GET / HTTP/1.1\r\nHost: ' + HOST + '\r\nUpgrade: websocket\r\n'
             + 'Connection: Upgrade\r\nSec-WebSocket-Key: ' + key + '\r\n'
             + 'Sec-WebSocket-Version: 13\r\n\r\n');
  }
  const sock = PORT === 443
    ? tls.connect(PORT, HOST, { servername: HOST }, hello)
    : net.connect(PORT, HOST, hello);
  const c = { name: name, sock: sock, id: null, otherId: null, hp: 100, ore: 42,
              x: x, z: z, yaw: 0, send: function(obj) { sock.write(wsFrame(JSON.stringify(obj))); } };
  let buf = Buffer.alloc(0);
  let upgraded = false;
  sock.on('data', function(data) {
    buf = Buffer.concat([buf, data]);
    if (!upgraded) {
      const end = buf.indexOf('\r\n\r\n');
      if (end < 0) return;
      buf = buf.slice(end + 4);
      upgraded = true;
      c.send({ t: 'hello', name: name });
      setInterval(function() {
        c.send({ t: 's', x: c.x, z: c.z, yaw: c.yaw, m: 0, a: 0, hp: c.hp, sw: 1,
                 lv: 2, tc: 0 });
      }, 100);
    }
    while (true) {
      if (buf.length < 2) return;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (buf.length < off + len) return;
      const opcode = buf[0] & 0x0f;
      const payload = buf.slice(off, off + len).toString();
      buf = buf.slice(off + len);
      if (opcode === 1) onMsg(c, JSON.parse(payload));
    }
  });
  sock.on('error', function(e) { check(name + ' socket ok (' + e.message + ')', false); finish(); });
  return c;
}

// --- the script ------------------------------------------------------------

let A = null, B = null;
let duelStarted = 0, chatSeen = false, duelWinOre = -1, duelEndSeen = false;

function handle(c, m) {
  if (m.t === 'welcome') {
    c.id = m.id;
    for (const p of m.players) c.otherId = p.id;
    if (c === A && B === null) {
      B = connect('DuelB', 4.5, 56, handle);
    }
    if (c.id && A.id && B && B.id) afterBothIn();
  } else if (m.t === 'join') {
    c.otherId = m.id;
    if (A.id && B && B.id) afterBothIn();
  } else if (m.t === 'duelreq') {
    check('B got the duel request from A', c === B && m.from === A.id && m.name === 'DuelA');
    c.send({ t: 'duelok', to: m.from });
  } else if (m.t === 'duelstart') {
    duelStarted++;
    if (duelStarted === 2) {
      check('both got duelstart', true);
      // A faces B and swings with the best blade until B yields
      A.yaw = Math.atan2(B.x - A.x, B.z - A.z);
      const swinger = setInterval(function() {
        if (duelEndSeen) { clearInterval(swinger); return; }
        A.send({ t: 'swing', x: A.x, z: A.z, yaw: A.yaw, sw: 1, lv: 2, wd: 40 });
      }, 400);
    }
  } else if (m.t === 'dhit') {
    if (c === B) c.hp = Math.max(1, c.hp - m.dmg); // mirror the client clamp
  } else if (m.t === 'duelend') {
    if (c === B && !duelEndSeen) {
      duelEndSeen = true;
      check('duel ended with A the winner', m.winner === A.id && m.loser === B.id);
      check('B was beaten to the yield point, not killed', B.hp <= 10 && B.hp >= 1);
      const lost = Math.floor(B.ore / 2);
      B.ore -= lost;
      B.send({ t: 'duelore', to: m.winner, ore: lost });
    }
  } else if (m.t === 'duelwin') {
    if (c === A) {
      duelWinOre = m.ore;
      check('A received half of B\'s ore (21)', m.ore === 21);
      A.send({ t: 'chat', msg: 'well fought' });
    }
  } else if (m.t === 'chat') {
    if (c === B && m.id === A.id && !chatSeen) {
      chatSeen = true;
      check('chat relayed to B', m.msg === 'well fought' && m.name === 'DuelA');
      check('all expected events arrived', duelWinOre === 21 && duelEndSeen);
      finish();
    }
  }
}

let kicked = false;
function afterBothIn() {
  if (kicked) return;
  kicked = true;
  check('both players joined', A.id !== null && B.id !== null && A.id !== B.id);
  // give the 10 Hz state senders a moment so the server knows both positions
  setTimeout(function() { A.send({ t: 'duel', to: A.otherId }); }, 600);
}

A = connect('DuelA', 3, 56, handle);
