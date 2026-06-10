'use strict';
// ---------------------------------------------------------------------------
// tools/bot.js — minimal headless test client for server.js (zero deps).
//   node tools/bot.js [ws-host] [ws-port] [name] [x] [z]
// Connects as a player, stands at (x, z) idly turning, and logs world events.
// ---------------------------------------------------------------------------

const net = require('net');
const tls = require('tls');
const crypto = require('crypto');

const HOST = process.argv[2] || 'localhost';
const PORT = parseInt(process.argv[3] || '8080', 10);
const NAME = process.argv[4] || 'TestBot';
const X = parseFloat(process.argv[5] || '3');
const Z = parseFloat(process.argv[6] || '56');

const key = crypto.randomBytes(16).toString('base64');
function onConnect() {
  sock.write('GET / HTTP/1.1\r\nHost: ' + HOST + '\r\nUpgrade: websocket\r\n'
           + 'Connection: Upgrade\r\nSec-WebSocket-Key: ' + key + '\r\n'
           + 'Sec-WebSocket-Version: 13\r\n\r\n');
}
// port 443 -> wss (TLS), anything else -> plain ws
const sock = PORT === 443
  ? tls.connect(PORT, HOST, { servername: HOST }, onConnect)
  : net.connect(PORT, HOST, onConnect);

function frame(str) {
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

let buf = Buffer.alloc(0);
let upgraded = false;
let yaw = 0;

sock.on('data', function(data) {
  buf = Buffer.concat([buf, data]);
  if (!upgraded) {
    const end = buf.indexOf('\r\n\r\n');
    if (end < 0) return;
    const head = buf.slice(0, end).toString();
    if (head.indexOf('101') < 0) { console.log('UPGRADE FAILED:\n' + head); process.exit(1); }
    console.log('upgraded to websocket');
    buf = buf.slice(end + 4);
    upgraded = true;
    sock.write(frame(JSON.stringify({ t: 'hello', name: NAME })));
    setInterval(function() {
      yaw += 0.15;
      sock.write(frame(JSON.stringify({ t: 's', x: X, z: Z, yaw: yaw, m: 0, a: 0,
                                        hp: 100, sw: 1, lv: 2, tc: 1 })));
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
    if (opcode !== 1) continue;
    const m = JSON.parse(payload);
    if (m.t === 'welcome') {
      console.log('WELCOME id=' + m.id + ' day=' + m.day + ' npcs=' + m.npcs.length
                + ' players=' + m.players.length);
    } else if (m.t !== 'p' && m.t !== 'n') {
      console.log('EVENT ' + payload.slice(0, 140));
    }
  }
});
sock.on('error', function(e) { console.log('SOCKET ERROR: ' + e.message); process.exit(1); });
