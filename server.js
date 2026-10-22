#!/usr/bin/env node
// FRONTLINIE – Spielserver für Online-Gefechte (Node, ohne Zusatzpakete)
//
//   node server.js [--port 8642] [--host 0.0.0.0] [--internet] [--data DIR]
//
// Liefert das Spiel aus (auch an Handys im WLAN), verwaltet Spielräume, prüft jeden Zug mit
// derselben Spiellogik wie der Browser und lässt KI-Gegner auf dem Server rechnen.
// Übertragung: Server-Sent Events (Server → Browser) und JSON-POST (Browser → Server).
'use strict';
const http = require('http');
const https = require('https');
const net = require('net');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const vm = require('vm');
const { spawn } = require('child_process');

const ROOT = __dirname;
const ARGS = parseArgs(process.argv.slice(2));
const PORT = +(ARGS.port || process.env.PORT || 8642);
const HOST = ARGS.host || process.env.HOST || '0.0.0.0';
const DATA_DIR = ARGS.data || process.env.FRONTLINIE_DATA || path.join(os.homedir(), '.local', 'share', 'frontlinie', 'rooms');
const QUIET = !!ARGS.quiet;
const ROOM_TTL_DAYS = 14;
const MAX_ROOMS = 200;

function parseArgs(list) {
  const o = {};
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2), n = list[i + 1];
    if (n != null && !n.startsWith('--')) { o[k] = n; i++; } else o[k] = true;
  }
  return o;
}
function log() { if (!QUIET) console.log.apply(console, ['[frontlinie]'].concat([].slice.call(arguments))); }

// ------------------------------------------------------------------ Spiellogik laden (dieselbe wie im Browser)
globalThis.G = {};
for (const f of ['data.js', 'maps.js', 'campaign.js', 'game.js', 'ai.js', 'room.js']) {
  const p = path.join(ROOT, 'js', f);
  vm.runInThisContext(fs.readFileSync(p, 'utf8'), { filename: p });
}
const G = globalThis.G;

// ------------------------------------------------------------------ Adressen
let publicUrl = ARGS['public-url'] || process.env.PUBLIC_URL || null;
function lanSubnet() {
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    if (/^(docker|br-|veth|virbr|lo|tun|tap|wg|zt|vmnet|vboxnet)/.test(name)) continue;
    for (const a of ifs[name] || []) {
      if (a.family !== 'IPv4' || a.internal || !a.cidr) continue;
      const bits = +a.cidr.split('/')[1];
      const ip = a.address.split('.').reduce(function (n, o) { return n * 256 + +o; }, 0);
      const mask = bits ? (0xffffffff << (32 - bits)) >>> 0 : 0;
      const netw = (ip & mask) >>> 0;
      return [netw >>> 24, (netw >>> 16) & 255, (netw >>> 8) & 255, netw & 255].join('.') + '/' + bits;
    }
  }
  return null;
}
function lanUrls() {
  const out = [];
  const ifs = os.networkInterfaces();
  Object.keys(ifs).forEach(function (name) {
    if (/^(docker|br-|veth|virbr|lo|tun|tap|wg|zt|vmnet|vboxnet)/.test(name)) return;
    (ifs[name] || []).forEach(function (a) {
      if (a.family === 'IPv4' && !a.internal) out.push('http://' + a.address + ':' + PORT + '/');
    });
  });
  return out;
}

// Firewall (ufw) prüfen: blockiert sie Handys im WLAN?
function firewallInfo() {
  try {
    const conf = fs.readFileSync('/etc/ufw/ufw.conf', 'utf8');
    if (!/^ENABLED=yes/m.test(conf)) return { active: false };
    let rules = '';
    try { rules = fs.readFileSync('/etc/ufw/user.rules', 'utf8'); } catch (e) { return { active: true, open: null, cmd: 'sudo ufw allow ' + PORT + '/tcp' }; }
    const re = new RegExp('-A ufw-user-input .*-p tcp .*--dport ' + PORT + '\\b.*-j ACCEPT|-A ufw-user-input .*--dports? [0-9,:]*\\b' + PORT + '\\b.*-j ACCEPT');
    const open = re.test(rules) || /-A ufw-user-input -j ACCEPT/.test(rules);
    const net = lanSubnet();
    return { active: true, open: open, cmd: net ? 'sudo ufw allow from ' + net + ' to any port ' + PORT + ' proto tcp' : 'sudo ufw allow ' + PORT + '/tcp' };
  } catch (e) { return { active: false }; }
}

// ------------------------------------------------------------------ Räume (Logik in js/room.js, hier nur Speichern)
const pending = new Map();
const hub = G.RoomHub({
  log: log, maxRooms: MAX_ROOMS,
  defer: function (fn) { setImmediate(fn); },
  persist: persist,
  remove: deleteRoomFile
});
const rooms = hub.rooms;

// ------------------------------------------------------------------ Speichern (überlebt Server-Neustarts)
function persist(room) {
  if (ARGS['no-persist']) return;
  if (pending.has(room.code)) return;
  pending.set(room.code, setTimeout(function () {
    pending.delete(room.code);
    if (rooms.get(room.code) === room) writeRoom(room);
  }, 400));
}
function writeRoom(room) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const file = path.join(DATA_DIR, room.code + '.json');
    fs.writeFileSync(file + '.tmp', JSON.stringify(hub.dump(room)));
    fs.renameSync(file + '.tmp', file);
  } catch (e) { log('Speichern fehlgeschlagen', e.message); }
}
function loadRooms() {
  if (ARGS['no-persist']) return;
  let files = [];
  try { files = fs.readdirSync(DATA_DIR).filter(function (f) { return /^[A-Z0-9]{5}\.json$/.test(f); }); } catch (e) { return; }
  const limit = Date.now() - ROOM_TTL_DAYS * 864e5;
  files.forEach(function (f) {
    const file = path.join(DATA_DIR, f);
    try {
      const d = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (d.updated < limit) { fs.unlinkSync(file); return; }
      hub.load(d);
    } catch (e) { log('Raum nicht lesbar', f, e.message); }
  });
  if (rooms.size) log(rooms.size + ' Raum/Räume wiederhergestellt');
}
function deleteRoomFile(code) {
  const t = pending.get(code); if (t) { clearTimeout(t); pending.delete(code); }
  try { fs.unlinkSync(path.join(DATA_DIR, code + '.json')); } catch (e) { /* egal */ }
}
setInterval(function () {
  const limit = Date.now() - ROOM_TTL_DAYS * 864e5;
  rooms.forEach(function (r, code) { if (r.updated < limit && !r.clients.size) { rooms.delete(code); deleteRoomFile(code); } });
}, 3600e3).unref();

// ------------------------------------------------------------------ Server-Sent Events
function sse(res, event, data, id) {
  let s = '';
  if (id != null) s += 'id: ' + id + '\n';
  s += 'event: ' + event + '\n';
  s += 'data: ' + JSON.stringify(data) + '\n\n';
  res.write(s);
}
function openStream(req, res, code, token, lastId) {
  const client = { send: function (event, data, id) { sse(res, event, data, id); }, end: function () { res.end(); } };
  let headed = false;
  // Kopfzeilen erst schreiben, wenn der Platz geprüft ist (sonst JSON-Fehler)
  const realSend = client.send;
  client.send = function (event, data, id) {
    if (!headed) {
      headed = true;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive', 'X-Accel-Buffering': 'no'
      });
      res.write('retry: 2000\n\n');
    }
    realSend(event, data, id);
  };
  const r = hub.stream(code, token, lastId, client);
  if (!r.ok) return sendJson(res, r.status, { ok: false, error: r.error });
  const ping = setInterval(function () { try { res.write(': ping\n\n'); } catch (e) { /* egal */ } }, 15000);
  req.on('close', function () { clearInterval(ping); r.close(); });
}

// ------------------------------------------------------------------ HTTP
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8'
};
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function readBody(req) {
  return new Promise(function (resolve, reject) {
    let size = 0; const chunks = [];
    req.on('data', function (c) { size += c.length; if (size > 4e6) { reject(new Error('zu groß')); req.destroy(); } else chunks.push(c); });
    req.on('end', function () {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}
function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  let rel;
  try { rel = decodeURIComponent(pathname); } catch (e) { res.writeHead(400); res.end(); return; }
  rel = path.normalize(rel).replace(/^([/\\])+/, '');
  if (rel === 'sw.js') {
    // Service Worker mit aktueller Version und Dateiliste
    let body;
    try { body = require('./tools/pwa').serviceWorker(); } catch (e) { res.writeHead(500); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' });
    res.end(body);
    return;
  }
  if (!(rel === 'index.html' || rel === 'manifest.webmanifest' || /^(js|css|icons)[/\\][\w.-]+$/.test(rel))) { res.writeHead(404); res.end('Nicht gefunden'); return; }
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, function (err, data) {
    if (err) { res.writeHead(404); res.end('Nicht gefunden'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

async function handleApi(req, res, parts, url) {
  // parts: ['api', ...]
  if (parts[1] === 'info' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, game: 'frontlinie', lan: lanUrls(), public: publicUrl, port: PORT, firewall: firewallInfo(), tls: !!httpsServer,
      secure: !!req.socket.encrypted, tunnel: tunnelOn });
  }
  // Internet-Adresse nachträglich anfordern – nur vom PC selbst (nicht aus dem WLAN)
  if (parts[1] === 'tunnel' && req.method === 'POST') {
    if (!isLoopback(req)) return sendJson(res, 403, { ok: false, error: 'Nur am PC selbst möglich.' });
    startTunnel();
    return sendJson(res, 200, { ok: true, public: publicUrl, tunnel: tunnelOn });
  }
  if (parts[1] !== 'rooms') return sendJson(res, 404, { ok: false, error: 'Unbekannt' });
  if (req.method === 'GET' && parts[3] === 'stream') {
    return openStream(req, res, parts[2], url.searchParams.get('token'), req.headers['last-event-id'] || url.searchParams.get('last'));
  }
  const body = req.method === 'POST' ? await readBody(req) : {};
  const query = {}; url.searchParams.forEach(function (v, k) { query[k] = v; });
  const r = hub.handle(req.method, parts.slice(1), query, body);
  return sendJson(res, r.status, r.body);
}

function onRequest(req, res) {
  let url;
  try { url = new URL(req.url, 'http://x'); } catch (e) { res.writeHead(400); res.end(); return; }
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] === 'api') {
    handleApi(req, res, parts, url).catch(function (e) {
      log('API-Fehler', e.message);
      if (!res.headersSent) sendJson(res, 400, { ok: false, error: 'Ungültige Anfrage' });
    });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  serveStatic(req, res, url.pathname);
}

// ------------------------------------------------------------------ http und https auf demselben Port
// Manche Handy-Browser öffnen Adressen automatisch verschlüsselt (https). Damit das nicht mit
// „keine sichere Verbindung“ scheitert, erkennt der Server TLS am ersten Byte und antwortet dann
// verschlüsselt (selbst signiertes Zertifikat, einmalig erzeugt).
const TLS_DIR = ARGS.tls || path.join(DATA_DIR, '..', 'tls');
function localIps() {
  const out = ['127.0.0.1'];
  const ifs = os.networkInterfaces();
  Object.keys(ifs).forEach(function (n) { (ifs[n] || []).forEach(function (a) { if (a.family === 'IPv4' && !a.internal) out.push(a.address); }); });
  return out;
}
function tlsOptions() {
  if (ARGS['no-tls']) return null;
  const keyF = path.join(TLS_DIR, 'key.pem'), certF = path.join(TLS_DIR, 'cert.pem'), metaF = path.join(TLS_DIR, 'ips.json');
  const ips = localIps();
  let have = [];
  try { have = JSON.parse(fs.readFileSync(metaF, 'utf8')); } catch (e) { /* neu */ }
  const fresh = fs.existsSync(keyF) && fs.existsSync(certF) && ips.every(function (ip) { return have.indexOf(ip) >= 0; });
  if (!fresh) {
    try {
      fs.mkdirSync(TLS_DIR, { recursive: true });
      const san = ['DNS:localhost'].concat(ips.map(function (ip) { return 'IP:' + ip; })).join(',');
      const r = require('child_process').spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '3650',
        '-keyout', keyF, '-out', certF, '-subj', '/CN=FRONTLINIE Spielserver', '-addext', 'subjectAltName=' + san], { stdio: 'ignore' });
      if (r.status !== 0) { log('openssl fehlt – nur http'); return null; }
      fs.writeFileSync(metaF, JSON.stringify(ips));
      try { fs.chmodSync(keyF, 0o600); } catch (e) { /* egal */ }
    } catch (e) { log('Zertifikat nicht erzeugt:', e.message); return null; }
  }
  try { return { key: fs.readFileSync(keyF), cert: fs.readFileSync(certF) }; } catch (e) { return null; }
}
const httpServer = http.createServer(onRequest);
const tlsOpts = tlsOptions();
const httpsServer = tlsOpts ? https.createServer(tlsOpts, onRequest) : null;
const server = net.createServer(function (sock) {
  sock.once('data', function (buf) {
    sock.pause();
    sock.unshift(buf);
    const target = buf[0] === 0x16 && httpsServer ? httpsServer : httpServer;
    target.emit('connection', sock);
    process.nextTick(function () { sock.resume(); });
  });
  sock.on('error', function () { /* Verbindung abgebrochen */ });
});

// ------------------------------------------------------------------ Internet-Tunnel (optional)
let tunnelOn = false;
function isLoopback(req) {
  const a = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  return (a === '127.0.0.1' || a === '::1') && !req.headers['x-forwarded-for'];
}
function startTunnel() {
  if (tunnelOn) return;
  tunnelOn = true;
  let delay = 3000;
  function run() {
    log('Öffne Internet-Tunnel über localhost.run …');
    const p = spawn('ssh', ['-T', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ServerAliveInterval=30', '-o', 'ExitOnForwardFailure=yes',
      '-R', '80:localhost:' + PORT, 'nokey@localhost.run'], { stdio: ['ignore', 'pipe', 'pipe'] });
    function scan(buf) {
      const m = /https:\/\/[a-z0-9.-]+\.(?:lhr\.life|localhost\.run)/i.exec(buf.toString());
      if (m && m[0] !== publicUrl && !/admin\.localhost\.run/.test(m[0])) {
        publicUrl = m[0] + '/';
        delay = 3000;
        log('Internet-Adresse: ' + publicUrl);
      }
    }
    p.stdout.on('data', scan); p.stderr.on('data', scan);
    p.on('exit', function () {
      publicUrl = null;
      log('Tunnel getrennt – neuer Versuch in ' + Math.round(delay / 1000) + ' s');
      setTimeout(run, delay);
      delay = Math.min(delay * 2, 60000);
    });
    process.on('exit', function () { try { p.kill(); } catch (e) { /* egal */ } });
  }
  run();
}

loadRooms();
server.listen(PORT, HOST, function () {
  log('Server läuft auf Port ' + PORT);
  log('Auf diesem PC:  http://127.0.0.1:' + PORT + '/');
  lanUrls().forEach(function (u) { log('Im WLAN/Heimnetz: ' + u); });
  if (process.send) process.send({ ready: true, port: PORT });
});
if (ARGS.internet) startTunnel();
process.on('SIGINT', function () { pending.forEach(function (t, code) { clearTimeout(t); writeRoom(rooms.get(code)); }); process.exit(0); });
process.on('SIGTERM', function () { pending.forEach(function (t, code) { clearTimeout(t); writeRoom(rooms.get(code)); }); process.exit(0); });
module.exports = { server: server, rooms: rooms };
