// Tests: Verbindungscodes und Einladungslink für „Handy zu Handy“ (js/p2p.js, ohne Browser, ohne echtes Netz)
'use strict';
const path = require('path');
const G = require('../tools/load.js')();
require(path.join(__dirname, '..', 'js', 'qr.js'));
require(path.join(__dirname, '..', 'js', 'p2p.js'));
const C = G.P2P.codec;
let pass = 0, fail = 0;
function ok(cond, name) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

const FP = 'A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90:01:12:23:34:45:56:67:78:89:9A:AB:BC:CD:DE:EF:F0';
const CHROME_OFFER = [
  'v=0', 'o=- 4611731400430051336 2 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE 0', 'a=extmap-allow-mixed', 'a=msid-semantic: WMS',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0',
  'a=candidate:1467250027 1 udp 2122260223 0b2c7a3e-1f4d-4c3a-9e2b-1234567890ab.local 54321 typ host generation 0 network-id 1',
  'a=candidate:1467250028 1 tcp 1518280447 0b2c7a3e-1f4d-4c3a-9e2b-1234567890ab.local 9 typ host tcptype active generation 0',
  'a=candidate:842163049 1 udp 1686052607 93.184.216.34 61234 typ srflx raddr 0.0.0.0 rport 0 generation 0 network-id 1',
  'a=candidate:842163050 1 udp 1686052351 2a02:8108:1234:5600::1f 61235 typ srflx raddr :: rport 0 generation 0',
  'a=candidate:3 1 udp 2122194687 2a02:8108:1234:5600:a1b2:c3d4:e5f6:789 50000 typ host generation 0',
  'a=candidate:4 1 udp 2122129151 fe80::1 50001 typ host generation 0',
  'a=ice-ufrag:Xy7Q', 'a=ice-pwd:aB3dE6fG9hJ2kL5mN8pQ1rS4', 'a=ice-options:trickle',
  'a=fingerprint:sha-256 ' + FP, 'a=setup:actpass', 'a=mid:0', 'a=sctp-port:5000', 'a=max-message-size:262144', ''
].join('\r\n');
const FIREFOX_ANSWER = [
  'v=0', 'o=mozilla...THIS_IS_SDPARTA-99.0 1234 0 IN IP4 0.0.0.0', 's=-', 't=0 0',
  'a=fingerprint:sha-256 ' + FP, 'a=group:BUNDLE 0', 'a=ice-options:trickle', 'a=msid-semantic:WMS *',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0',
  'a=candidate:0 1 UDP 2122252543 192.168.178.42 40001 typ host',
  'a=candidate:1 1 UDP 1686052863 93.184.216.35 40001 typ srflx raddr 192.168.178.42 rport 40001',
  'a=sendrecv', 'a=end-of-candidates', 'a=ice-pwd:0123456789abcdef0123456789abcdef', 'a=ice-ufrag:89abcdef',
  'a=mid:0', 'a=setup:active', 'a=sctp-port:5000', 'a=max-message-size:1073741823', ''
].join('\r\n');

console.log('Handy zu Handy: SDP auslesen');
const o = C.parseSdp(CHROME_OFFER);
ok(o.ufrag === 'Xy7Q' && o.pwd === 'aB3dE6fG9hJ2kL5mN8pQ1rS4', 'ICE-Kennung und -Passwort');
ok(o.alg === 'sha-256' && o.fp.length === 32 && o.fp[0] === 0xA1 && o.fp[31] === 0xF0, 'Fingerabdruck');
ok(o.setup === 'actpass' && o.mid === '0', 'Rolle und mid');
ok(o.cands.length === 4, 'TCP und fe80 aussortiert (' + o.cands.length + ' Adressen)');
ok(o.cands[0].addr.endsWith('.local') && o.cands[1].typ === 'srflx', 'Reihenfolge: mDNS, dann öffentliche IPv4');

console.log('Handy zu Handy: Code packen und entpacken');
const lid = G.P2P.logicId();
ok(typeof lid === 'number' && lid > 0, 'Spielversion-Prüfsumme ' + lid.toString(16));
const txt = C.pack(Object.assign({ t: 'O', code: 'K7M2P', lid: lid }, o));
ok(/^FL1[A-Za-z0-9_-]+$/.test(txt) && txt.length <= 400, 'Einladungs-Code ist kurz (' + txt.length + ' Zeichen)');
const u = C.unpack('Hier ist meine Einladung: ' + txt + ' – bis gleich!');
ok(u.t === 'O' && u.code === 'K7M2P' && u.lid === lid, 'Raumcode und Version kommen an (auch mitten im Text)');
ok(u.ufrag === o.ufrag && u.pwd === o.pwd && u.fp.join() === o.fp.join(), 'ICE-Daten kommen an');
ok(JSON.stringify(u.cands.map(c => [c.typ, c.port])) === JSON.stringify(o.cands.map(c => [c.typ, c.port])), 'Adressen kommen an');
ok(u.cands[0].addr === '0b2c7a3e-1f4d-4c3a-9e2b-1234567890ab.local', 'mDNS-Name exakt');
ok(C.ip6Bytes(u.cands[2].addr).join() === C.ip6Bytes('2a02:8108:1234:5600:a1b2:c3d4:e5f6:789').join() &&
  C.ip6Bytes(u.cands[3].addr).join() === C.ip6Bytes('2a02:8108:1234:5600::1f').join(), 'IPv6 exakt (auch mit ::)');
const qr = G.QR.encode(txt);
ok(qr.version <= 15, 'passt in QR-Code (Version ' + qr.version + ')');

console.log('Handy zu Handy: Antwort (Firefox-Stil) und SDP-Neubau');
const a = C.parseSdp(FIREFOX_ANSWER);
const at = C.pack(Object.assign({ t: 'A' }, a));
const au = C.unpack(at);
ok(au.t === 'A' && au.setup === 'active' && au.ufrag === '89abcdef' && au.pwd.length === 32, 'Antwort vollständig (' + at.length + ' Zeichen)');
ok(au.cands.length === 2 && au.cands[0].addr === '192.168.178.42', 'Firefox-Adressen (UDP groß geschrieben)');
const sdp = C.buildSdp(au);
const back = C.parseSdp(sdp);
ok(back.ufrag === a.ufrag && back.pwd === a.pwd && back.fp.join() === a.fp.join() && back.setup === 'active', 'Neu gebaute SDP enthält alles');
ok(/^m=application 9 UDP\/DTLS\/SCTP webrtc-datachannel$/m.test(sdp) && /a=sctp-port:5000/.test(sdp) && /\r\n$/.test(sdp), 'SDP-Form stimmt');
ok(back.cands.length === 2 && back.cands[1].typ === 'srflx', 'Adressen in der SDP');

console.log('Handy zu Handy: Unsinn wird abgelehnt');
let threw = 0;
['', 'hallo', 'FL1abc', 'FL1' + 'A'.repeat(40)].forEach(t => { try { C.unpack(t); } catch (e) { threw++; } });
ok(threw === 4, 'ungültige Codes werfen Fehler');
// Viele Adressen: Code bleibt unter der Grenze
const many = Object.assign({}, o, { cands: [] });
for (let i = 0; i < 20; i++) many.cands.push({ typ: 'host', addr: '2a02:8108:1234:5600::' + (i + 1).toString(16), port: 50000 + i });
const mt = C.pack(Object.assign({ t: 'O', code: 'ABCDE', lid: 1 }, many));
ok(mt.length <= 400 && C.unpack(mt).cands.length >= 3, 'viele Adressen werden gekürzt (' + C.unpack(mt).cands.length + ' behalten)');

const RL = G.P2P.invite.RELAY_LIM;
const mr = C.pack(Object.assign({ t: 'O', code: 'ABCDE', lid: 1 }, many), RL);
ok(C.unpack(mr).cands.length > C.unpack(mt).cands.length && mr.length <= RL.len, 'über den Relay passen mehr Adressen (' + C.unpack(mr).cands.length + ')');

// ================================================================ Einladungslink über einen Relay (nur Nachbildungen, kein echtes Netz)
const P = G.P2P, INV = P.invite;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const FAST = { fresh: 60, ready: 300, publish: 300, ask: 250, wait: 400, total: 1500, pending: 600, tries: 3, retry: 40 };

/** Nachgebildeter ntfy-Dienst: POST /<thema>, GET /<thema>/json?poll=1&since=all, WebSocket /<thema>/ws[?since=…] */
function FakeNtfy() {
  const S = { offset: 0, down: false, msgs: {}, socks: new Set(), posts: [], polls: 0, wsUrls: [], n: 0 };
  const now = () => Math.floor(Date.now() / 1000) + S.offset;
  const rid = () => 'm' + (++S.n).toString(36).padStart(11, '0');
  function resp(status, json, text) {
    return { status, ok: status >= 200 && status < 300, json: () => Promise.resolve(json), text: () => Promise.resolve(text != null ? text : JSON.stringify(json)) };
  }
  S.fetch = function (url, opts) {
    opts = opts || {};
    return new Promise((resolve, reject) => setTimeout(() => {
      if (S.down) { reject(new TypeError('Failed to fetch')); return; }
      const u = new URL(url), parts = u.pathname.split('/').filter(Boolean);
      if ((opts.method || 'GET') === 'POST' && parts.length === 1) {
        const body = String(opts.body);
        if (Buffer.byteLength(body) > 4096) { resolve(resp(413, { error: 'zu groß – ntfy.sh würde einen Anhang daraus machen' })); return; }
        const msg = { id: rid(), time: now(), expires: now() + 43200, event: 'message', topic: parts[0], message: body };
        (S.msgs[parts[0]] = S.msgs[parts[0]] || []).push(msg);
        S.posts.push({ url, body });
        for (const ws of S.socks) if (ws._topic === parts[0]) setTimeout(() => ws._send(msg), 0);
        resolve(resp(200, msg));
        return;
      }
      if (parts.length === 2 && parts[1] === 'json' && u.searchParams.get('poll') === '1' && u.searchParams.get('since') === 'all') {
        S.polls++;
        const list = S.msgs[parts[0]] || [];
        resolve(resp(200, null, list.map(m => JSON.stringify(m)).join('\n') + (list.length ? '\n' : '')));
        return;
      }
      resolve(resp(404, { error: 'unbekannt' }));
    }, 1));
  };
  S.WebSocket = class {
    constructor(url) {
      S.wsUrls.push(url);
      const u = new URL(url), parts = u.pathname.split('/').filter(Boolean);
      this._topic = parts[0]; this.readyState = 0; this.onmessage = this.onclose = this.onerror = null;
      setTimeout(() => {
        if (this.readyState === 3) return;
        if (S.down || parts[1] !== 'ws' || u.protocol !== 'wss:') { this.readyState = 3; if (this.onerror) this.onerror({}); if (this.onclose) this.onclose({}); return; }
        this.readyState = 1; S.socks.add(this);
        this._send({ id: rid(), time: now(), event: 'open', topic: this._topic });
        const since = u.searchParams.get('since');
        if (since) {
          const list = S.msgs[this._topic] || [];
          let from;
          if (since === 'all') from = list;
          else if (/^\d+$/.test(since)) from = list.filter(m => m.time >= +since);
          else { const i = list.findIndex(m => m.id === since); from = i >= 0 ? list.slice(i + 1) : list; }
          from.forEach(m => this._send(m));
        }
      }, 1);
    }
    _send(m) { if (this.readyState === 1 && this.onmessage) this.onmessage({ data: JSON.stringify(m) }); }
    close() { if (this.readyState === 3) return; this.readyState = 3; S.socks.delete(this); setTimeout(() => { if (this.onclose) this.onclose({}); }, 0); }
    _cut() { this.readyState = 3; S.socks.delete(this); if (this.onclose) this.onclose({}); } // Verbindung reißt ab
  };
  S.relay = () => P.ntfyRelay({ base: 'https://ntfy.example', fetch: S.fetch, WebSocket: S.WebSocket, times: FAST });
  S.sockets = topic => [...S.socks].filter(w => !topic || w._topic === topic);
  return S;
}
/** Nachgebildetes WebRTC: Ein Angebot verbindet genau den Gast, dessen Antwort zu ihm gehört */
function FakeRTC(opts) {
  opts = opts || {};
  const guests = new Map(), R = { offers: [], answers: [] };
  let uf = 0;
  function info() { const o = C.parseSdp(CHROME_OFFER); o.ufrag = 'f' + (++uf).toString(36).padStart(4, '0'); return o; }
  R.offer = room => () => {
    const inf = info();
    let ok1;
    const hd = { ufrag: inf.ufrag, code: C.pack(Object.assign({ t: 'O', code: room, lid: 7 }, inf), RL), accepted: 0, dropped: false, linked: false, opened: new Promise(r => { ok1 = r; }) };
    hd.accept = a => {
      hd.accepted++;
      const g = guests.get(C.unpack(a).ufrag);
      if (!g) return Promise.reject(new Error('unbekannte Antwort'));
      if (!opts.noConnect && g.offerUfrag === hd.ufrag) setTimeout(() => {
        if (hd.dropped || g.closed) return;
        hd.linked = true;
        g._open({ room, host: hd, guest: g, close() { this.closed = true; } });
        ok1(true);
      }, 5);
      return Promise.resolve();
    };
    hd.drop = () => { if (!hd.linked) hd.dropped = true; };
    R.offers.push(hd);
    return Promise.resolve(hd);
  };
  R.answer = code => {
    const o = C.unpack(code);
    if (o.t !== 'O') return Promise.reject(new Error('kein Angebot'));
    const inf = info();
    let ok2;
    const hd = { code: C.pack(Object.assign({ t: 'A' }, inf), RL), closed: false, offerUfrag: o.ufrag, opened: new Promise(r => { ok2 = r; }) };
    hd._open = l => { if (!hd.closed) ok2(l); };
    hd.close = () => { hd.closed = true; };
    guests.set(inf.ufrag, hd); R.answers.push(hd);
    return Promise.resolve(hd);
  };
  return R;
}
function host(net, rtc, invite, room) {
  return P.LinkHost({ invite, relay: net.relay(), offer: rtc.offer(room || 'K7M2P'), info: () => ({ n: 'Daniel', m: 'Brückenkopf' }), times: FAST });
}
function guest(net, rtc, invite, steps) {
  return P.linkJoin({ invite, relay: net.relay(), answer: rtc.answer, times: FAST, onStep: steps ? t => steps.push(t) : null });
}
async function decrypt(keys, msg) { return INV.unseal(keys.key, msg.message.split(' ')[3]); }
async function within(p, ms) { return Promise.race([p, sleep(ms).then(() => { throw new Error('Zeitüberschreitung im Test'); })]); }

async function relayTests() {
  console.log('Einladungslink: Code, Themen, Verschlüsselung');
  const codes = Array.from({ length: 300 }, () => INV.make());
  ok(codes.every(c => /^[a-hjkmnp-z2-9]{14}$/.test(c) && INV.valid(c)), 'Codes: 14 Zeichen, ohne i/l/o/0/1');
  ok(new Set(codes).size === codes.length, 'Codes sind zufällig');
  const code = codes[0];
  ok(INV.find('Spiel mit mir! https://du.github.io/frontlinie/#einladung=' + code + ' bis gleich') === code, 'Code wird im Text eines Links gefunden');
  ok(INV.find('#einladung=abc') === null && INV.find('nix') === null && INV.find('#einladung=' + code.replace(/./, '0') + 'xx') === null, 'unvollständige/falsche Links werden abgelehnt');
  const k1 = await INV.keys(code), k2 = await INV.keys(code), k3 = await INV.keys(codes[1]);
  ok(k1.offers === k2.offers && k1.answers === k2.answers && k1.offers !== k3.offers, 'Themen sind je Code fest und verschieden');
  ok(/^frontlinie-[0-9a-f]{20}-o$/.test(k1.offers) && /^frontlinie-[0-9a-f]{20}-a$/.test(k1.answers) && k1.offers.length <= 64, 'Themenname gültig für ntfy (' + k1.offers + ')');
  ok(k1.offers.indexOf(code) < 0, 'Thema verrät den Code nicht');
  const sealed = await INV.seal(k1.key, { t: 'O', c: txt });
  ok(/^[A-Za-z0-9_-]+$/.test(sealed) && sealed.indexOf('FL1') < 0, 'verschlüsselt (' + sealed.length + ' Zeichen)');
  ok((await INV.unseal(k2.key, sealed)).c === txt, 'mit demselben Code wieder lesbar');
  let wrong = false; try { await INV.unseal(k3.key, sealed); } catch (e) { wrong = true; }
  ok(wrong, 'mit anderem Code nicht lesbar');

  console.log('Einladungslink: Stückeln und Zusammensetzen');
  const long = Array.from({ length: 7000 }, (_, i) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[i * 7 % 64]).join('');
  const parts = INV.pieces('abcd2345', long);
  ok(parts.length === 3 && parts.every(m => /^FLX abcd2345 [123]\/3 /.test(m) && Buffer.byteLength(m) < 4096), '7000 Zeichen → 3 Stücke unter 4 KB');
  const asm = INV.Assembler();
  const order = [parts[2], parts[0], 'Müll', parts[2], 'FLX x 1/1 a b', parts[1], parts[0]];
  const out = order.map((m, i) => asm.add({ message: m, time: 100 + i })).filter(Boolean);
  ok(out.length === 1 && out[0].text === long && out[0].id === 'abcd2345' && out[0].time === 105, 'in beliebiger Reihenfolge zusammengesetzt, doppelt Zugestelltes zählt einmal');

  console.log('Einladungslink: ntfy-Protokoll (nachgebildet)');
  {
    const net = FakeNtfy(), relay = net.relay();
    net.offset = 120;
    const got = [], sub = relay.subscribe('frontlinie-test-o', m => got.push(m));
    await sub.ready;
    ok(net.wsUrls[0] === 'wss://ntfy.example/frontlinie-test-o/ws', 'Live-Empfang per WebSocket (' + net.wsUrls[0] + ')');
    ok(Math.abs(sub.now() - (Date.now() / 1000 + 120)) < 2, 'Serverzeit aus dem open-Ereignis (Uhrabweichung ausgeglichen)');
    const pub = await relay.publish('frontlinie-test-o', 'FLX aaaa2222 1/1 eins');
    ok(net.posts[0].url === 'https://ntfy.example/frontlinie-test-o' && typeof pub.id === 'string' && typeof pub.time === 'number', 'Veröffentlichen per POST, Antwort mit id/time');
    await sleep(20);
    ok(got.length === 1 && got[0].message === 'FLX aaaa2222 1/1 eins' && got[0].id === pub.id, 'Nachricht kommt live an');
    net.sockets()[0]._cut();
    await relay.publish('frontlinie-test-o', 'FLX bbbb3333 1/1 zwei');      // während der Verbindung weg ist
    await sleep(150);
    ok(net.wsUrls.length === 2 && net.wsUrls[1].endsWith('?since=' + pub.id), 'neu verbunden ab der letzten Nachricht (' + net.wsUrls[1].split('?')[1] + ')');
    ok(got.length === 2 && got[1].message === 'FLX bbbb3333 1/1 zwei', 'Verpasstes wird nachgeliefert');
    const list = await relay.poll('frontlinie-test-o');
    ok(list.length === 2 && list[1].message === 'FLX bbbb3333 1/1 zwei' && net.polls === 1, 'Abruf gepufferter Nachrichten (poll=1&since=all)');
    sub.close();
    ok(net.sockets().length === 0, 'Abmelden schließt die Verbindung');
    net.down = true;
    let e1 = null, e2 = null;
    try { await relay.publish('t', 'x'); } catch (e) { e1 = e; }
    const sub2 = relay.subscribe('t', () => {});
    try { await sub2.ready; } catch (e) { e2 = e; }
    ok(e1 && e1.kind === 'relay' && e2 && e2.kind === 'relay', 'Relay weg → klarer Fehler („' + (e1 && e1.message) + '“)');
  }

  console.log('Einladungslink: Gastgeber und Gäste');
  {
    const net = FakeNtfy(), rtc = FakeRTC(), invite = INV.make(), keys = await INV.keys(invite);
    const H = host(net, rtc, invite);
    await H.start();
    ok(H.state === 'bereit' && (net.msgs[keys.offers] || []).length === 1, 'Gastgeber veröffentlicht ein Angebot');
    const first = await decrypt(keys, net.msgs[keys.offers][0]);
    ok(first.t === 'O' && first.r[0] === '-' && first.n === 'Daniel' && C.unpack(first.c).code === 'K7M2P', 'Angebot: Raumcode, Name, Karte');
    const steps = [];
    const r1 = await within(guest(net, rtc, invite, steps).promise, 2000);
    ok(r1.link && r1.offer.code === 'K7M2P' && r1.info.n === 'Daniel' && r1.info.m === 'Brückenkopf', 'Gast 1 verbunden (über das vorhandene Angebot)');
    ok(steps.some(t => /Antwort/.test(t)), 'Gast sieht Fortschritt („' + steps.join(' → ') + '“)');
    await sleep(60);
    ok(H.joined === 1 && net.msgs[keys.offers].length === 2, 'Nach dem Beitritt sofort ein frisches Angebot');
    const second = await decrypt(keys, net.msgs[keys.offers][1]);
    const ans1 = net.msgs[keys.answers][0];
    ok(second.r[0] === 'a:' + ans1.message.split(' ')[1] && second.p === net.msgs[keys.offers][0].message.split(' ')[1], 'frisches Angebot nennt die angenommene Antwort und das vergebene Angebot');
    const r2 = await within(guest(net, rtc, invite).promise, 2000);
    await sleep(60);
    ok(r2.link && H.joined === 2 && net.msgs[keys.offers].length === 3, 'Gast 2 verbunden, Angebot erneuert');
    const reqs = await Promise.all(net.msgs[keys.answers].map(m => decrypt(keys, m)));
    ok(reqs.every(x => x.t === 'A'), 'keine Anfragen nötig, solange die Angebote frisch sind');
    // Gepufferte/doppelt zugestellte Antwort und fremde Nachrichten
    const acceptedBefore = rtc.offers.map(o => o.accepted).join();
    net.sockets(keys.answers).forEach(ws => { ws._send(ans1); ws._send({ id: 'x1', time: 0, event: 'message', message: 'FLX zzzz9999 1/1 AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }); ws._send({ id: 'x2', event: 'message', message: 'hallo' }); });
    await sleep(60);
    ok(H.joined === 2 && rtc.offers.map(o => o.accepted).join() === acceptedBefore, 'alte/doppelte Antwort und Fremdes werden ignoriert');
    const all = JSON.stringify(net.posts) + net.wsUrls.join();
    ok(all.indexOf('FL1') < 0 && all.indexOf(invite) < 0, 'Relay sieht weder Codes noch Einladung im Klartext');
    ok(net.posts.every(p => Buffer.byteLength(p.body) <= 4096), 'alle Nachrichten unter 4 KB');
    H.stop();
    await sleep(20);
    ok(H.state === 'aus' && net.sockets().length === 0, 'Gastgeber beendet: keine offenen Verbindungen');
    ok(rtc.offers.filter(o => !o.linked).every(o => o.dropped), 'unbenutzte Angebote werden geschlossen');
  }

  console.log('Einladungslink: altes Angebot → frisches anfordern');
  {
    const net = FakeNtfy(), rtc = FakeRTC(), invite = INV.make(), keys = await INV.keys(invite);
    const H = host(net, rtc, invite);
    await H.start();
    net.offset = 600; // 10 Minuten später: Router-Adressen im alten Angebot könnten verfallen sein
    const r = await within(guest(net, rtc, invite).promise, 2000);
    const msgs = await Promise.all(net.msgs[keys.answers].map(m => decrypt(keys, m)));
    const offs = await Promise.all(net.msgs[keys.offers].map(m => decrypt(keys, m)));
    ok(r.link && msgs[0].t === 'R' && msgs[1].t === 'A', 'Gast fragt nach einem frischen Angebot und antwortet darauf');
    ok(offs[1].r[0] === 'r:' + net.msgs[keys.answers][0].message.split(' ')[1] && msgs[1].o === net.msgs[keys.offers][1].message.split(' ')[1], 'Angebot gezielt für diese Anfrage');
    H.stop();
  }

  console.log('Einladungslink: zwei Gäste gleichzeitig');
  {
    const net = FakeNtfy(), rtc = FakeRTC(), invite = INV.make();
    const H = host(net, rtc, invite);
    await H.start();
    const both = await within(Promise.all([guest(net, rtc, invite).promise, guest(net, rtc, invite).promise]), 3000);
    await sleep(60);
    ok(both.every(r => r.link) && H.joined === 2, 'beide verbunden (' + rtc.offers.length + ' Angebote)');
    ok(rtc.offers.every(o => o.accepted <= 1), 'jedes Angebot wird höchstens einmal angenommen');
    ok(both[0].link.host !== both[1].link.host, 'jeder Gast hat eine eigene Verbindung');
    H.stop();
  }

  console.log('Einladungslink: Fehlerfälle und Zeitüberschreitung');
  {
    // Relay nicht erreichbar
    const net = FakeNtfy(), rtc = FakeRTC(), invite = INV.make();
    net.down = true;
    const H = host(net, rtc, invite);
    await H.start();
    ok(H.state === 'fehler' && /nicht erreichbar/.test(H.error), 'Gastgeber: Relay weg → Fehlerzustand („' + H.error + '“)');
    let t0 = Date.now(), err = null;
    try { await within(guest(net, rtc, invite).promise, 2000); } catch (e) { err = e; }
    ok(err && err.kind === 'relay' && Date.now() - t0 < FAST.ready + 200, 'Gast: Relay weg → kind „relay“ (Rückfall auf QR-Weg)');
    ok(net.sockets().length === 0, 'keine offene Verbindung bleibt zurück');
  }
  {
    // Gastgeber weg: nur ein altes Angebot im Puffer, niemand antwortet auf die Anfrage
    const net = FakeNtfy(), rtc = FakeRTC(), invite = INV.make();
    const H = host(net, rtc, invite);
    await H.start();
    H.stop();
    net.offset = 3600;
    const t0 = Date.now();
    let err = null;
    try { await within(guest(net, rtc, invite).promise, 2000); } catch (e) { err = e; }
    ok(err && err.kind === 'nohost' && /Kein Gastgeber/.test(err.message), 'Gastgeber weg → „' + (err && err.message.slice(0, 40)) + '…“');
    ok(Date.now() - t0 < FAST.ask + 300, 'Meldung kommt nach der Anfrage-Wartezeit, nicht erst am Ende');
    ok(net.sockets().length === 0, 'Gast räumt auf');
  }
  {
    // Gastgeber da, aber die Direktverbindung kommt nie zustande
    const net = FakeNtfy(), rtc = FakeRTC({ noConnect: true }), invite = INV.make();
    const H = host(net, rtc, invite);
    await H.start();
    const t0 = Date.now();
    let err = null;
    try { await within(guest(net, rtc, invite).promise, 3000); } catch (e) { err = e; }
    const took = Date.now() - t0;
    ok(err && err.kind === 'connect', 'keine Direktverbindung → kind „connect“ (' + took + ' ms)');
    ok(took <= FAST.total + 150, 'spätestens nach der Gesamtzeit (' + FAST.total + ' ms) – keine Endlosschleife');
    ok(rtc.answers.length >= 2 && rtc.answers.length <= FAST.tries && rtc.answers.every(a => a.closed), 'mehrere Versuche (' + rtc.answers.length + '), danach alles geschlossen');
    await sleep(FAST.pending + 50);
    ok(H.connecting === 0 && rtc.offers.filter(o => o.accepted).every(o => o.dropped), 'Gastgeber gibt hängende Verbindungen nach Frist auf');
    H.stop();
    ok(net.sockets().length === 0, 'alles aufgeräumt');
  }
  {
    // Abbrechen
    const net = FakeNtfy(), rtc = FakeRTC(), invite = INV.make();
    const job = guest(net, rtc, invite);
    await sleep(5);
    job.cancel();
    let err = null;
    try { await job.promise; } catch (e) { err = e; }
    await sleep(30);
    ok(err && err.kind === 'abort' && net.sockets().length === 0, 'Abbrechen beendet alles sofort');
  }
}

relayTests().catch(e => { fail++; console.log('  ✗ Ausnahme: ' + (e && e.stack || e)); }).then(() => {
  console.log('\n' + pass + ' bestanden, ' + fail + ' fehlgeschlagen');
  process.exit(fail ? 1 : 0);
});
