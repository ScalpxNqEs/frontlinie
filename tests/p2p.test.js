// Tests: Verbindungscodes für „Handy zu Handy“ (js/p2p.js, ohne Browser)
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

console.log('\n' + pass + ' bestanden, ' + fail + ' fehlgeschlagen');
process.exit(fail ? 1 : 0);
