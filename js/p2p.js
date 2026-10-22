// FRONTLINIE – Handy zu Handy: direkte Verbindung zwischen zwei (bis vier) Geräten, ganz ohne PC
//
// Handy 1 (Gastgeber) führt den Spielraum selbst (js/room.js – dieselbe Logik wie der PC-Server).
// Die anderen verbinden sich per WebRTC-Datenkanal. Zum Verbinden zeigt Handy 1 einen Code (QR oder Text),
// Handy 2 antwortet mit einem eigenen Code – danach laufen alle Spielzüge direkt zwischen den Geräten.
// Lobby, Spiel und Abgleich sind dieselben wie beim Online-Gefecht (js/online.js), nur der Übertragungsweg ist anders.
//
// Bequemer Weg: Einladungslink („…#einladung=<code>“). Dann tauschen die Geräte die Codes selbst über einen kostenlosen
// öffentlichen Relay (ntfy.sh, verschlüsselt) – Freunde tippen nur den Link an. Der manuelle QR-/Text-Weg bleibt als Ersatz.
var G = (typeof globalThis !== 'undefined' ? globalThis : window).G = (globalThis.G || {});
(function () {
  'use strict';
  var P2P = G.P2P = G.P2P || {};

  // ================================================================ Verbindungscodes (ohne DOM, auch in Node testbar)
  // Statt der ganzen Sitzungsbeschreibung (SDP, ~1 KB) wird nur das Nötige übertragen:
  // ICE-Kennung/-Passwort, Zertifikat-Fingerabdruck, Rolle und wenige Adressen. Daraus entsteht beim Gegenüber wieder eine SDP.
  var PREFIX = 'FL1';
  var MAX_CANDS = 6, MAX_LEN = 400; // passt in einen QR-Code (Version ≤ 15)
  var SETUPS = ['actpass', 'active', 'passive'];
  var UUID_LOCAL = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\.local$/i;
  var IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

  function b64uEnc(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64uDec(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    var bin = atob(str), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function ip6Bytes(a) {
    a = a.replace(/^\[|\]$/g, '').split('%')[0];
    var halves = a.split('::');
    if (halves.length > 2) return null;
    function grp(s) { return s ? s.split(':') : []; }
    var head = grp(halves[0]), tail = halves.length === 2 ? grp(halves[1]) : [];
    // eingebettete IPv4 (::ffff:1.2.3.4)
    var last = tail.length ? tail : head, m4 = last.length && IPV4.exec(last[last.length - 1]);
    if (m4) { last.pop(); last.push(((+m4[1] << 8) | +m4[2]).toString(16), ((+m4[3] << 8) | +m4[4]).toString(16)); }
    var fill = 8 - head.length - tail.length;
    if (halves.length === 1 && fill !== 0) return null;
    if (fill < 0) return null;
    var groups = head.concat(new Array(halves.length === 2 ? fill : 0).fill('0'), tail), out = [];
    for (var i = 0; i < 8; i++) {
      var v = parseInt(groups[i], 16);
      if (!(v >= 0 && v <= 0xffff) || !/^[0-9a-f]{1,4}$/i.test(groups[i])) return null;
      out.push(v >> 8, v & 255);
    }
    return out;
  }
  function ip6Str(b) {
    var g = [];
    for (var i = 0; i < 16; i += 2) g.push(((b[i] << 8) | b[i + 1]).toString(16));
    return g.join(':');
  }
  function hexBytes(h) { var o = []; for (var i = 0; i < h.length; i += 2) o.push(parseInt(h.substr(i, 2), 16)); return o; }
  function bytesHex(b) { var s = ''; for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16); return s; }

  /** Lokale SDP → { ufrag, pwd, setup, mid, alg, fp:[bytes], cands:[{typ, addr, port}] } */
  function parseSdp(sdp) {
    var o = { ufrag: '', pwd: '', setup: 'actpass', mid: '0', alg: 'sha-256', fp: [], cands: [] }, seen = {};
    String(sdp).split(/\r?\n/).forEach(function (l) {
      var m;
      if ((m = /^a=ice-ufrag:(.+)$/.exec(l))) o.ufrag = m[1].trim();
      else if ((m = /^a=ice-pwd:(.+)$/.exec(l))) o.pwd = m[1].trim();
      else if ((m = /^a=setup:(\w+)/.exec(l))) o.setup = m[1];
      else if ((m = /^a=mid:(.+)$/.exec(l))) o.mid = m[1].trim();
      else if ((m = /^a=fingerprint:(\S+) ([0-9A-Fa-f:]+)/.exec(l))) { o.alg = m[1].toLowerCase(); o.fp = hexBytes(m[2].replace(/:/g, '')); }
      else if ((m = /^a=candidate:(\S+) (\d+) (\S+) (\d+) (\S+) (\d+) typ (\w+)/.exec(l))) {
        if (m[2] !== '1' || m[3].toLowerCase() !== 'udp') return;
        var typ = m[7];
        if (typ !== 'host' && typ !== 'srflx') return;
        var key = m[5] + ' ' + m[6];
        if (seen[key]) return; seen[key] = 1;
        o.cands.push({ typ: typ, addr: m[5], port: +m[6] });
      }
    });
    o.cands.sort(function (a, b) { return candRank(a) - candRank(b); });
    o.cands = o.cands.filter(function (c) { return candRank(c) < 9; });
    return o;
  }
  function candRank(c) {
    var a = c.addr, v4 = IPV4.exec(a);
    if (v4) {
      if (a === '0.0.0.0' || /^127\./.test(a) || /^169\.254\./.test(a)) return 9;
      return c.typ === 'host' ? 0 : 2;
    }
    if (UUID_LOCAL.test(a) || /\.local$/i.test(a)) return c.typ === 'host' ? 1 : 9;
    if (a.indexOf(':') >= 0) {
      if (/^(fe80|::1$|::$)/i.test(a)) return 9;
      return c.typ === 'host' ? 3 : 4;
    }
    return 9;
  }

  /** { t:'O'|'A', code?, lid?, ...parseSdp } → Text „FL1…“. lim: { len, cands } – Obergrenzen (Standard: passt in einen QR-Code) */
  function pack(o, lim) {
    var maxCands = (lim && lim.cands) || MAX_CANDS, maxLen = (lim && lim.len) || MAX_LEN;
    var head = [];
    function str(s) { s = String(s || ''); if (s.length > 255) throw new Error('zu lang'); head.push(s.length); for (var i = 0; i < s.length; i++) head.push(s.charCodeAt(i) & 255); }
    head.push(0x10 | (o.t === 'O' ? 1 : 2));
    if (o.t === 'O') {
      var code = String(o.code || '').toUpperCase();
      for (var i = 0; i < 5; i++) head.push(code.charCodeAt(i) || 32);
      var lid = o.lid >>> 0;
      head.push(lid >>> 24, (lid >>> 16) & 255, (lid >>> 8) & 255, lid & 255);
    }
    str(o.ufrag); str(o.pwd);
    head.push(Math.max(0, SETUPS.indexOf(o.setup)));
    str(o.mid);
    str(o.alg === 'sha-256' ? '' : o.alg);
    head.push(o.fp.length); o.fp.forEach(function (b) { head.push(b); });
    var cands = [];
    (o.cands || []).forEach(function (c) {
      if (cands.length >= maxCands) return;
      var b = [], kind, m;
      if ((m = IPV4.exec(c.addr))) { kind = 0; b = [+m[1], +m[2], +m[3], +m[4]]; }
      else if ((m = UUID_LOCAL.exec(c.addr))) { kind = 2; b = hexBytes((m[1] + m[2] + m[3] + m[4] + m[5]).toLowerCase()); }
      else if (c.addr.indexOf(':') >= 0 && (b = ip6Bytes(c.addr))) kind = 1;
      else { kind = 3; if (c.addr.length > 255) return; b = [c.addr.length]; for (var k = 0; k < c.addr.length; k++) b.push(c.addr.charCodeAt(k) & 255); }
      var enc = [((c.typ === 'srflx' ? 1 : 0) << 4) | kind].concat(b, [c.port >> 8, c.port & 255]);
      var test = head.concat([cands.length + 1], [].concat.apply([], cands), enc);
      if (PREFIX.length + Math.ceil(test.length * 4 / 3) > maxLen) return;
      cands.push(enc);
    });
    var all = head.concat([cands.length], [].concat.apply([], cands));
    return PREFIX + b64uEnc(all);
  }
  /** Text (auch mitten in einer Nachricht) → Objekt; wirft bei Unsinn */
  function unpack(text) {
    var m = /FL1([A-Za-z0-9_-]{20,})/.exec(String(text || ''));
    if (!m) throw new Error('Kein FRONTLINIE-Code gefunden');
    var b = b64uDec(m[1]), p = 0;
    function need(n) { if (p + n > b.length) throw new Error('Code unvollständig'); }
    function byte() { need(1); return b[p++]; }
    function str() { var n = byte(); need(n); var s = ''; for (var i = 0; i < n; i++) s += String.fromCharCode(b[p++]); return s; }
    var t0 = byte();
    if ((t0 >> 4) !== 1) throw new Error('Unbekannte Code-Version');
    var o = { t: (t0 & 15) === 1 ? 'O' : 'A', cands: [] };
    if (o.t === 'O') {
      need(9);
      o.code = String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3], b[p + 4]); p += 5;
      o.lid = ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0; p += 4;
    }
    o.ufrag = str(); o.pwd = str();
    o.setup = SETUPS[byte()] || 'actpass';
    o.mid = str() || '0';
    o.alg = str() || 'sha-256';
    var fl = byte(); need(fl); o.fp = Array.prototype.slice.call(b, p, p + fl); p += fl;
    var n = byte();
    for (var i = 0; i < n; i++) {
      var k = byte(), kind = k & 15, typ = (k >> 4) === 1 ? 'srflx' : 'host', addr;
      if (kind === 0) { need(4); addr = b[p] + '.' + b[p + 1] + '.' + b[p + 2] + '.' + b[p + 3]; p += 4; }
      else if (kind === 1) { need(16); addr = ip6Str(b.slice(p, p + 16)); p += 16; }
      else if (kind === 2) {
        need(16); var hx = bytesHex(b.slice(p, p + 16)); p += 16;
        addr = hx.substr(0, 8) + '-' + hx.substr(8, 4) + '-' + hx.substr(12, 4) + '-' + hx.substr(16, 4) + '-' + hx.substr(20) + '.local';
      } else addr = str();
      need(2); var port = (b[p] << 8) | b[p + 1]; p += 2;
      o.cands.push({ typ: typ, addr: addr, port: port });
    }
    if (!o.ufrag || !o.pwd || !o.fp.length) throw new Error('Code unvollständig');
    return o;
  }
  /** Objekt → vollständige SDP für setRemoteDescription */
  function buildSdp(o) {
    var fp = o.fp.map(function (x) { return (x < 16 ? '0' : '') + x.toString(16).toUpperCase(); }).join(':');
    var sid = String(Date.now()) + String(Math.floor(Math.random() * 1e6));
    var L = [
      'v=0', 'o=- ' + sid + ' 2 IN IP4 127.0.0.1', 's=-', 't=0 0',
      'a=group:BUNDLE ' + o.mid, 'a=msid-semantic: WMS',
      'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0',
      'a=ice-ufrag:' + o.ufrag, 'a=ice-pwd:' + o.pwd, 'a=ice-options:trickle',
      'a=fingerprint:' + o.alg + ' ' + fp, 'a=setup:' + o.setup, 'a=mid:' + o.mid,
      'a=sctp-port:5000', 'a=max-message-size:262144'
    ];
    o.cands.forEach(function (c, i) {
      var prio = (c.typ === 'host' ? 2122260223 : 1686052607) - i;
      L.push('a=candidate:' + (i + 1) + ' 1 udp ' + prio + ' ' + c.addr + ' ' + c.port + ' typ ' + c.typ + (c.typ === 'srflx' ? ' raddr 0.0.0.0 rport 0' : '') + ' generation 0');
    });
    L.push('a=end-of-candidates');
    return L.join('\r\n') + '\r\n';
  }
  /** Prüfsumme der Spiellogik: Beide Geräte müssen dieselbe Version haben */
  var lidCache = null;
  function logicId() {
    if (lidCache != null) return lidCache;
    var src = '';
    try {
      var GP = G.Game.prototype;
      Object.getOwnPropertyNames(GP).sort().forEach(function (k) { var v = GP[k]; src += k + (typeof v === 'function' ? String(v) : ''); });
      src += String(G.gameFromSetup) + String(G.parseMap) + String(G.Game.load);
      src += JSON.stringify([G.UNITS, G.TERRAIN, G.COS, G.FACTIONS], function (k, v) { return typeof v === 'function' ? String(v) : v; });
    } catch (e) { /* egal */ }
    var hh = 0x811c9dc5;
    for (var i = 0; i < src.length; i++) { hh ^= src.charCodeAt(i); hh = Math.imul(hh, 16777619) >>> 0; }
    lidCache = hh >>> 0;
    return lidCache;
  }
  P2P.codec = { pack: pack, unpack: unpack, parseSdp: parseSdp, buildSdp: buildSdp, ip6Bytes: ip6Bytes, ip6Str: ip6Str };
  P2P.logicId = logicId;

  // ================================================================ Einladungslink: Austausch über einen Relay (ohne DOM, in Node testbar)
  // Ein Link „…#einladung=<code>“ genügt: Gastgeber und Gast tauschen ihre FL1-Codes selbsttätig über einen kostenlosen
  // öffentlichen Nachrichtendienst aus (ntfy.sh – ohne Konto, ohne eigenen Server). Aus dem Code im Link werden Themenname
  // und Schlüssel abgeleitet: Der Dienst sieht nur verschlüsselte Nachrichten und die IP-Adressen der Abrufer, nie den Code.
  // Gespielt wird danach direkt zwischen den Geräten; der Dienst wird nur zum Verbinden gebraucht.
  //
  // Jede Relay-Nachricht: „FLX <id> <i>/<n> <stück>“ – längere Inhalte werden in Stücke ≤ 3000 Zeichen zerlegt
  // (ntfy.sh nimmt höchstens 4096 Byte, größere würden zum Dateianhang). Inhalt: JSON, mit AES-GCM verschlüsselt.
  //   Thema …-o (Angebote vom Gastgeber): { t:'O', r:[bezug], p:<vergebenes Angebot>, c:'FL1…', n:Name, m:Karte }
  //     bezug '-' = erstes Angebot, 'a:<id>' = neues Angebot, nachdem Antwort <id> angenommen wurde (p = das damit
  //     vergebene Angebot), 'r:<id>' = gezielt auf Anfrage <id>
  //   Thema …-a (an den Gastgeber):       { t:'A', o:<angebots-id>, c:'FL1…' } (Antwort) oder { t:'R' } (bitte frisches Angebot)
  // Ein Angebot gilt für genau eine Antwort; jede Nachricht hat eine eigene id, doppelt oder verspätet zugestellte zählen nicht.
  // Beide lassen sich vor dem Laden von p2p.js setzen (G.P2P = { RELAY: 'https://ntfy.example.org' }), z. B. für einen eigenen Server.
  P2P.RELAY = P2P.RELAY || 'https://ntfy.sh';
  P2P.relayFactory = P2P.relayFactory || null; // function () → Relay; zum Austausch des Dienstes (eigener ntfy-Server, MQTT …) und für Tests
  /** Zeiten (fresh in s, sonst ms): ready = Verbindung zum Relay, ask = Antwort auf eine Anfrage, wait = je Verbindungsversuch,
   *  total = Gast insgesamt, pending = so lange darf eine angenommene Antwort zum Verbinden brauchen, tries = Versuche des Gastes,
   *  retry = erste Pause vor dem Neuverbinden mit dem Relay (verdoppelt sich bis 30 s) */
  P2P.LINK_TIMES = { fresh: 60, ready: 10000, publish: 10000, ask: 10000, wait: 12000, total: 25000, pending: 45000, tries: 3, retry: 1000 };
  var INVITE_ABC = 'abcdefghjkmnpqrstuvwxyz23456789'; // ohne verwechselbare Zeichen (i, l, o, 0, 1)
  var INVITE_LEN = 14;                                 // ≈ 69 Bit Zufall
  var PIECE = 3000;
  var RELAY_LIM = { len: 1200, cands: 12 };          // über den Relay passen mehr Adressen als in einen QR-Code
  var INVITE_RE = /#einladung=([A-Za-z0-9]{12,32})/;
  var LINK_MSG = {
    relay: 'Der Einladungsdienst (ntfy.sh) ist gerade nicht erreichbar.',
    nohost: 'Kein Gastgeber gefunden: Die Einladung ist abgelaufen, oder FRONTLINIE ist beim Gastgeber nicht mehr offen (sein Bildschirm muss an bleiben).',
    connect: 'Die direkte Verbindung kommt nicht zustande – vermutlich lassen eure Netze (oft Mobilfunk) keine Direktverbindung zu. Am sichersten: beide ins selbe WLAN oder in den Hotspot des Gastgebers.'
  };

  function randomChars(n) {
    var out = '', lim = 256 - (256 % INVITE_ABC.length), buf = new Uint8Array(n * 2);
    while (out.length < n) {
      globalThis.crypto.getRandomValues(buf);
      for (var i = 0; i < buf.length && out.length < n; i++) if (buf[i] < lim) out += INVITE_ABC[buf[i] % INVITE_ABC.length];
    }
    return out;
  }
  function newInvite() { return randomChars(INVITE_LEN); }
  function newMsgId() { return randomChars(8); }
  function validInvite(c) { return typeof c === 'string' && /^[a-hjkmnp-z2-9]{12,32}$/.test(c); }
  /** Einladungscode aus einem Text (Link, Nachricht) oder null */
  function inviteIn(text) { var m = INVITE_RE.exec(String(text || '')); var c = m && m[1].toLowerCase(); return c && validInvite(c) ? c : null; }
  function relayErr(msg) { var e = new Error(msg || LINK_MSG.relay); e.kind = 'relay'; return e; }
  function times(over) { return Object.assign({}, P2P.LINK_TIMES, over || {}); }

  // ---------------------------------------------------------------- Schlüssel und Verschlüsselung (Web Crypto)
  function subtle() { var c = globalThis.crypto; return c && c.subtle; }
  function utf8(s) { return new TextEncoder().encode(s); }
  function sha256(text) { return subtle().digest('SHA-256', utf8(text)).then(function (b) { return new Uint8Array(b); }); }
  /** Code → { offers, answers (Themennamen), key (AES-GCM) } – der Code selbst verlässt das Gerät nie */
  function inviteKeys(code) {
    return Promise.all([sha256('frontlinie-thema|' + code), sha256('frontlinie-schluessel|' + code)]).then(function (r) {
      var topic = 'frontlinie-' + bytesHex(r[0].slice(0, 10));
      return subtle().importKey('raw', r[1], { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']).then(function (key) {
        return { offers: topic + '-o', answers: topic + '-a', key: key };
      });
    });
  }
  function seal(key, obj) {
    var iv = new Uint8Array(12);
    globalThis.crypto.getRandomValues(iv);
    return subtle().encrypt({ name: 'AES-GCM', iv: iv }, key, utf8(JSON.stringify(obj))).then(function (ct) {
      var c = new Uint8Array(ct), all = new Uint8Array(12 + c.length);
      all.set(iv); all.set(c, 12);
      return b64uEnc(all);
    });
  }
  function unseal(key, text) {
    return Promise.resolve().then(function () {
      var b = b64uDec(text);
      if (b.length < 29) throw new Error('zu kurz');
      return subtle().decrypt({ name: 'AES-GCM', iv: b.slice(0, 12) }, key, b.slice(12));
    }).then(function (pt) { return JSON.parse(new TextDecoder().decode(pt)); });
  }

  // ---------------------------------------------------------------- Stückeln und Zusammensetzen
  function pieces(id, text) {
    var n = Math.max(1, Math.ceil(text.length / PIECE)), out = [];
    for (var i = 0; i < n; i++) out.push('FLX ' + id + ' ' + (i + 1) + '/' + n + ' ' + text.substr(i * PIECE, PIECE));
    return out;
  }
  /** Sammelt Stücke; add({ message, time }) liefert jede vollständige Nachricht genau einmal: { id, text, time } */
  function Assembler() {
    var got = {};
    return {
      add: function (m) {
        var x = /^FLX ([a-z0-9]{4,16}) (\d{1,2})\/(\d{1,2}) ([A-Za-z0-9_-]+)$/.exec(String((m && m.message) || ''));
        if (!x) return null;
        var id = x[1], i = +x[2], n = +x[3];
        if (!(n >= 1 && i >= 1 && i <= n)) return null;
        var r = got[id] || (got[id] = { n: n, have: 0, arr: [], time: 0, done: false });
        if (r.done || r.n !== n) return null;
        if (r.arr[i - 1] == null) { r.arr[i - 1] = x[4]; r.have++; }
        if (+m.time > r.time) r.time = +m.time;
        if (r.have < n) return null;
        var text = r.arr.join('');
        r.done = true; r.arr = [];
        return { id: id, text: text, time: r.time };
      }
    };
  }
  /** Inhalt verschlüsseln, stückeln und der Reihe nach veröffentlichen */
  function sendSealed(relay, topic, key, id, obj) {
    return seal(key, obj).then(function (txt) {
      var p = Promise.resolve();
      pieces(id, txt).forEach(function (m) { p = p.then(function () { return relay.publish(topic, m); }); });
      return p;
    });
  }

  // ---------------------------------------------------------------- Relay „ntfy“ (HTTP + WebSocket)
  /**
   * opts: { base ('https://ntfy.sh' oder eigener ntfy-Server), fetch, WebSocket (beide austauschbar, z. B. für Tests), times }
   * → { publish(topic, text) → Promise<{id,time}>, poll(topic) → Promise<[{id,time,message}]>,
   *     subscribe(topic, onMsg) → { ready: Promise, now() (Serverzeit in s), kick(), close() } }
   */
  P2P.ntfyRelay = function (opts) {
    opts = opts || {};
    var base = String(opts.base || P2P.RELAY).replace(/\/+$/, ''), wsBase = base.replace(/^http/i, 'ws');
    var host = base.replace(/^\w+:\/\//, '');
    var doFetch = opts.fetch || function (u, o) { return fetch(u, o); };
    var WS = opts.WebSocket || (typeof WebSocket !== 'undefined' ? WebSocket : null);
    var t = times(opts.times);
    var down = 'Der Einladungsdienst (' + host + ') ist nicht erreichbar.';
    function timed(run) {
      return new Promise(function (resolve, reject) {
        var timer = setTimeout(function () { reject(relayErr('Der Einladungsdienst (' + host + ') antwortet nicht.')); }, t.publish);
        Promise.resolve().then(run).then(function (v) { clearTimeout(timer); resolve(v); }, function (e) {
          clearTimeout(timer); reject(e && e.kind ? e : relayErr(down));
        });
      });
    }
    function checked(res) {
      if (res.status === 429) throw relayErr('Der Einladungsdienst ist gerade überlastet (zu viele Anfragen) – bitte eine Minute warten.');
      if (!res.ok) throw relayErr('Der Einladungsdienst meldet Fehler ' + res.status + '.');
      return res;
    }
    var R = { base: base };
    R.publish = function (topic, text) {
      return timed(function () {
        return doFetch(base + '/' + topic, { method: 'POST', body: text }).then(checked).then(function (res) { return res.json(); });
      }).then(function (j) { return { id: j && j.id, time: j && j.time }; });
    };
    R.poll = function (topic) {
      return timed(function () {
        return doFetch(base + '/' + topic + '/json?poll=1&since=all', { cache: 'no-store' }).then(checked).then(function (res) { return res.text(); });
      }).then(function (txt) {
        var out = [];
        String(txt || '').split('\n').forEach(function (l) {
          if (!l.trim()) return;
          var m; try { m = JSON.parse(l); } catch (e) { return; }
          if (m && m.event === 'message') out.push({ id: m.id, time: m.time, message: String(m.message || '') });
        });
        return out;
      });
    };
    /** Live-Empfang; verbindet sich nach Abbrüchen selbst neu (mit wachsender Pause) und holt Verpasstes nach */
    R.subscribe = function (topic, onMsg) {
      var S = { up: false, closed: false, skew: 0 }, ws = null, timer = null, delay = t.retry, lastId = null, downAt = 0, everOpen = false;
      var seen = Date.now(), SILENT = 120000; // ntfy schickt regelmäßig „keepalive“ – bleibt alles still, ist die Verbindung tot
      var readyOk, readyFail;
      S.ready = new Promise(function (a, b) { readyOk = a; readyFail = b; });
      S.ready.catch(function () { /* wird vom Aufrufer behandelt */ });
      var readyTimer = setTimeout(function () { if (!everOpen) { readyFail(relayErr(down)); S.close(); } }, t.ready);
      function connect() {
        if (S.closed) return;
        var q = lastId ? '?since=' + encodeURIComponent(lastId) : downAt ? '?since=' + Math.max(0, Math.floor(downAt - 10)) : '';
        var sock;
        seen = Date.now();
        try { sock = ws = new WS(wsBase + '/' + topic + '/ws' + q); } catch (e) { ws = null; lost(); return; }
        sock.onmessage = function (e) {
          if (ws !== sock) return;
          seen = Date.now();
          var m; try { m = JSON.parse(e.data); } catch (err) { return; }
          if (!m) return;
          if (m.event === 'open') {
            S.up = true; delay = t.retry;
            if (typeof m.time === 'number') S.skew = m.time - Date.now() / 1000;
            if (!everOpen) { everOpen = true; clearTimeout(readyTimer); readyOk(); }
            return;
          }
          if (m.event !== 'message') return;
          if (m.id) lastId = m.id;
          try { onMsg({ id: m.id, time: m.time, message: String(m.message || '') }); } catch (err) { console.warn('[P2P] Relay:', err); }
        };
        sock.onclose = function () {
          if (ws !== sock) return;
          ws = null;
          if (S.up) downAt = Date.now() / 1000 + S.skew;
          S.up = false;
          lost();
        };
        sock.onerror = function () { /* onclose folgt */ };
      }
      function lost() {
        if (S.closed) return;
        if (!everOpen) { clearTimeout(readyTimer); readyFail(relayErr(down)); S.close(); return; }
        clearTimeout(timer);
        timer = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 30000);
      }
      S.now = function () { return Date.now() / 1000 + S.skew; };
      /** Halbtote Verbindung (z. B. nach dem Hintergrund am Handy) verwerfen und neu verbinden */
      function restart() {
        var s = ws; ws = null;
        if (s) { s.onclose = s.onmessage = null; try { s.close(); } catch (e) { /* egal */ } }
        if (S.up) downAt = Date.now() / 1000 + S.skew;
        S.up = false;
        clearTimeout(timer); delay = t.retry; connect();
      }
      S.kick = function () {
        if (S.closed || !everOpen) return;
        if (!ws) { clearTimeout(timer); delay = t.retry; connect(); } else if (Date.now() - seen > SILENT) restart();
      };
      var watch = setInterval(function () { if (!S.closed && everOpen && ws && Date.now() - seen > SILENT) restart(); }, 30000);
      S.close = function () {
        if (S.closed) return;
        S.closed = true;
        clearInterval(watch);
        clearTimeout(timer); clearTimeout(readyTimer);
        var s = ws; ws = null;
        if (s) { try { s.close(); } catch (e) { /* egal */ } }
      };
      if (!WS) { clearInterval(watch); setTimeout(lost, 0); return S; }
      connect();
      return S;
    };
    return R;
  };

  // ---------------------------------------------------------------- Gastgeber-Seite
  /**
   * Veröffentlicht Angebote und nimmt Antworten entgegen (solange der Raum besteht).
   * o: { invite, relay, offer() → Promise<{ code, accept(antwortCode) → Promise, drop(), opened?: Promise }>,
   *      info() → { n: Name, m: Karte }, onChange(H), times }
   * H.state: 'neu' | 'start' | 'bereit' | 'fehler' | 'aus'
   */
  P2P.LinkHost = function (o) {
    var t = times(o.times), relay = o.relay;
    var H = { invite: o.invite, state: 'neu', error: '', joined: 0, connecting: 0, offers: 0 };
    var keys = null, sub = null, offers = {}, general = null, seen = {}, asm = Assembler(), chain = Promise.resolve(), stopped = true, timers = [];
    function later(fn, ms) {
      var id = setTimeout(function () { var k = timers.indexOf(id); if (k >= 0) timers.splice(k, 1); fn(); }, ms);
      timers.push(id);
    }
    function changed(state, err) {
      if (state) H.state = state;
      if (err != null) H.error = err;
      if (o.onChange) { try { o.onChange(H); } catch (e) { console.warn('[P2P]', e); } }
    }
    // Angebote nacheinander erzeugen (jedes braucht ein paar Sekunden für die Adressermittlung)
    function queue(fn) {
      chain = chain.then(function () { if (!stopped) return fn(); }).catch(function (e) {
        if (!stopped) console.warn('[P2P] Angebot nicht veröffentlicht:', e && e.message);
      });
      return chain;
    }
    function retire(rec) {
      if (offers[rec.id] === rec) delete offers[rec.id];
      try { rec.hd.drop(); } catch (e) { /* egal */ }
    }
    function offerNow(ref, isGeneral, prev) {
      return Promise.resolve().then(function () { return o.offer(); }).then(function (hd) {
        if (stopped) { hd.drop(); return; }
        var rec = { id: newMsgId(), hd: hd, general: isGeneral, used: false };
        offers[rec.id] = rec; // schon vor dem Veröffentlichen bekannt – eine schnelle Antwort darf nicht verloren gehen
        var info = (o.info && o.info()) || {};
        return sendSealed(relay, keys.offers, keys.key, rec.id, { t: 'O', r: [ref], p: prev || '', c: hd.code, n: info.n || '', m: info.m || '' }).then(function () {
          if (stopped) { retire(rec); return; }
          H.offers++;
          if (isGeneral) { if (general && general !== rec && !general.used) retire(general); general = rec; }
          else later(function () { if (!rec.used) retire(rec); }, t.pending);
        }, function (e) { retire(rec); throw e; });
      });
    }
    function onAnswer(p, x) {
      var rec = offers[x.o];
      if (!rec || rec.used || typeof x.c !== 'string') return; // unbekannt, schon vergeben oder kaputt
      rec.used = true;
      H.joined++; H.connecting++;
      changed();
      var settled = false;
      function settle() { if (settled) return; settled = true; H.connecting = Math.max(0, H.connecting - 1); changed(); }
      if (rec.hd.opened) rec.hd.opened.then(settle, settle);
      Promise.resolve().then(function () { return rec.hd.accept(x.c); }).catch(function (e) {
        console.warn('[P2P] Antwort passt nicht:', e && e.message); settle();
      });
      later(function () { settle(); retire(rec); }, t.pending);
      // Sofort ein frisches Angebot für den nächsten Gast (und als Bestätigung für diesen: Bezug 'a:<id>')
      if (rec.general) queue(function () { return offerNow('a:' + p.id, true, rec.id); });
    }
    function onMsg(m) {
      var p = asm.add(m), k = keys;
      if (!p || !k || seen[p.id]) return;
      seen[p.id] = true;
      unseal(k.key, p.text).then(function (x) {
        if (stopped || keys !== k || !x) return;
        if (x.t === 'R') queue(function () { return offerNow('r:' + p.id, false); });
        else if (x.t === 'A') onAnswer(p, x);
      }, function () { /* nicht für uns oder kaputt */ });
    }
    H.start = function () {
      if (!stopped) return Promise.resolve();
      stopped = false;
      changed('start', '');
      return inviteKeys(o.invite).then(function (k) {
        if (stopped) return;
        keys = k;
        sub = relay.subscribe(k.answers, onMsg);
        return sub.ready.then(function () { if (!stopped) return offerNow('-', true); })
          .then(function () { if (!stopped) changed('bereit', ''); });
      }).catch(function (e) {
        if (!stopped) H.stop('fehler', (e && e.message) || 'Einladungslink nicht möglich.');
      });
    };
    H.stop = function (state, err) {
      stopped = true;
      timers.forEach(clearTimeout); timers = [];
      if (sub) { sub.close(); sub = null; }
      Object.keys(offers).forEach(function (id) { retire(offers[id]); });
      general = null; keys = null; chain = Promise.resolve();
      changed(state || 'aus', err || '');
    };
    /** Nach dem Aufwachen (Handy war im Hintergrund): Relay sofort neu verbinden */
    H.wake = function () { if (sub) sub.kick(); };
    return H;
  };

  // ---------------------------------------------------------------- Gast-Seite
  /**
   * Aktuelles Angebot holen (zu alt oder keins → frisches anfordern), beantworten, auf die direkte Verbindung warten.
   * o: { invite, relay, answer(angebotsCode) → Promise<{ code, opened: Promise<link>, close() }>, onStep(text), times }
   * → { promise: Promise<{ link, offer, info: { n, m } }>, cancel() }; Fehler tragen kind: 'relay' | 'nohost' | 'connect' | 'abort'
   */
  P2P.linkJoin = function (o) {
    var t = times(o.times), relay = o.relay;
    var keys = null, sub = null, asm = Assembler(), known = {}, decrypting = [], order = 0;
    var cur = null, waitReq = null, tries = 0, answered = false, finished = false, timers = [], handles = [];
    var resolveP, rejectP, promise = new Promise(function (a, b) { resolveP = a; rejectP = b; });
    function later(fn, ms) {
      var id = setTimeout(function () { var k = timers.indexOf(id); if (k >= 0) timers.splice(k, 1); fn(); }, ms);
      timers.push(id);
    }
    function step(s) { if (!finished && o.onStep) { try { o.onStep(s); } catch (e) { /* egal */ } } }
    function finish(err, val) {
      if (finished) return;
      finished = true;
      timers.forEach(clearTimeout); timers = [];
      if (sub) { sub.close(); sub = null; }
      handles.forEach(function (hd) { if (!val || hd !== val.hd) { try { hd.close(); } catch (e) { /* egal */ } } });
      if (err) rejectP(err); else resolveP({ link: val.link, offer: val.offer, info: val.info });
    }
    function fail(kind, msg) { var e = new Error(msg || LINK_MSG[kind]); e.kind = kind; finish(e); }
    function failNoConn() { fail(answered ? 'connect' : 'nohost'); }
    function general(rec) { return rec.refs.some(function (r) { return r === '-' || r.indexOf('a:') === 0; }); }
    function remember(p) {
      var seq = ++order; // Eingangsreihenfolge (ntfy liefert der Zeit nach) – entscheidet bei gleicher Sekunde
      var pr = unseal(keys.key, p.text).then(function (x) {
        if (!x || x.t !== 'O' || typeof x.c !== 'string') return null;
        var off;
        try { off = unpack(x.c); } catch (e) { return null; }
        if (off.t !== 'O') return null;
        var rec = { id: p.id, time: +p.time || 0, seq: seq, refs: Array.isArray(x.r) ? x.r.map(String) : [], prev: String(x.p || ''), code: x.c, offer: off,
          info: { n: String(x.n || '').slice(0, 18), m: String(x.m || '').slice(0, 40) } };
        known[p.id] = rec;
        return rec;
      }, function () { return null; });
      decrypting.push(pr);
      return pr;
    }
    function onLive(m) {
      if (!keys) return;
      var p = asm.add(m);
      if (!p) return;
      remember(p).then(function (rec) {
        if (!rec || finished) return;
        if (waitReq && rec.refs.indexOf('r:' + waitReq) >= 0) { waitReq = null; use(rec); return; }
        if (!cur || !cur.general || !cur.answerId || !general(rec) || rec.id === cur.rec.id) return;
        if (rec.refs.indexOf('a:' + cur.answerId) >= 0) { cur.accepted = true; step('Der Gastgeber nimmt an – verbinde direkt …'); }
        // Ein anderer Gast war schneller (oder der Gastgeber hat neu begonnen): gleich das neue Angebot nehmen
        else if (!cur.accepted && !waitReq && (rec.prev === cur.rec.id || rec.refs[0] === '-')) use(rec);
      });
    }
    function use(rec) {
      if (finished) return;
      if (tries >= t.tries) { failNoConn(); return; }
      tries++;
      if (cur && cur.hd) { try { cur.hd.close(); } catch (e) { /* egal */ } }
      var c = cur = { rec: rec, general: general(rec), answerId: null, accepted: false, hd: null };
      step((rec.info.n ? 'Einladung von ' + rec.info.n : 'Einladung gefunden') + ' – Antwort wird erstellt …');
      Promise.resolve().then(function () { return o.answer(rec.code); }).then(function (hd) {
        handles.push(hd);
        if (finished || cur !== c) { try { hd.close(); } catch (e) { /* egal */ } return; }
        c.hd = hd;
        Promise.resolve(hd.opened).then(function (link) {
          if (link && !finished && cur === c) finish(null, { link: link, offer: rec.offer, info: rec.info, hd: hd });
        });
        var id = c.answerId = newMsgId();
        return sendSealed(relay, keys.answers, keys.key, id, { t: 'A', o: rec.id, c: hd.code }).then(function () {
          if (finished || cur !== c) return;
          answered = true;
          step('Warte auf den Gastgeber …');
          // Keine Verbindung? Dann ein frisches Angebot anfordern (der laufende Versuch darf derweil weiterlaufen)
          later(function () { if (!finished && cur === c && !waitReq) request(); }, t.wait);
        });
      }).catch(function (e) {
        if (finished) return;
        if (e && e.kind === 'relay') fail('relay', e.message);
        else fail('connect', (e && e.message) || LINK_MSG.connect);
      });
    }
    function request() {
      if (finished) return;
      if (tries >= t.tries) { failNoConn(); return; }
      var id = waitReq = newMsgId();
      step('Frage beim Gastgeber nach einem frischen Angebot …');
      sendSealed(relay, keys.answers, keys.key, id, { t: 'R' }).then(function () {
        later(function () {
          if (finished || waitReq !== id) return;
          if (cur && cur.hd) return; // ein laufender Versuch darf bis zum Ende der Gesamtzeit weiterlaufen
          failNoConn();
        }, t.ask);
      }, function (e) { if (!finished) fail('relay', e && e.message); });
    }
    later(failNoConn, t.total);
    step('Hole die Einladung …');
    Promise.resolve().then(function () { return inviteKeys(o.invite); }).then(function (k) {
      if (finished) return;
      keys = k;
      sub = relay.subscribe(k.offers, onLive);   // zuerst live zuhören, dann Gepuffertes holen – so geht nichts verloren
      return sub.ready.then(function () { return relay.poll(k.offers); }).then(function (list) {
        list.forEach(function (m) { var p = asm.add(m); if (p) remember(p); });
        return Promise.all(decrypting.slice());
      }).then(function () {
        if (finished || cur || waitReq) return;
        // Das neueste allgemeine Angebot, das noch nicht vergeben ist
        var best = null, used = {};
        Object.keys(known).forEach(function (id) { if (known[id].prev) used[known[id].prev] = true; });
        Object.keys(known).forEach(function (id) {
          var r = known[id];
          if (general(r) && !used[id] && (!best || r.time > best.time || (r.time === best.time && r.seq > best.seq))) best = r;
        });
        var now = sub ? sub.now() : Date.now() / 1000;
        // Ein frisches Angebot sofort nutzen; ein altes nicht (die Adressen im Router könnten verfallen sein)
        if (best && now - best.time <= t.fresh) use(best); else request();
      });
    }).catch(function (e) { if (!finished) fail('relay', e && e.kind === 'relay' ? e.message : LINK_MSG.relay); });
    return { promise: promise, cancel: function () { fail('abort', 'Abgebrochen.'); } };
  };
  P2P.invite = { make: newInvite, valid: validInvite, find: inviteIn, keys: inviteKeys, seal: seal, unseal: unseal, pieces: pieces, Assembler: Assembler, PIECE: PIECE, RELAY_LIM: RELAY_LIM };

  if (typeof document === 'undefined' || !G.UI) return; // ab hier nur im Browser

  // ================================================================ Browser-Teil
  var UI = G.UI, h = UI.h, $ = UI.$, Store = UI.Store;
  var STUN = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
  var CHUNK = 15000;
  function Net() { return G.Net; }
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  P2P.supported = function () { return typeof RTCPeerConnection === 'function'; };

  // ---------------------------------------------------------------- Datenkanal mit Stückelung und Lebenszeichen
  function Link(pc, dc) {
    var L = { pc: pc, dc: dc, closed: false, onmsg: null, onclose: null, last: Date.now() };
    var parts = {}, seq = 0;
    function deliver(str) { var o; try { o = JSON.parse(str); } catch (e) { return; } if (L.onmsg) L.onmsg(o); }
    dc.onmessage = function (e) {
      L.last = Date.now();
      var d = e.data;
      if (typeof d !== 'string' || d === 'P') return;
      if (d[0] === 'J') { deliver(d.slice(1)); return; }
      if (d[0] === 'C') {
        var m = /^C(\d+),(\d+),(\d+),/.exec(d); if (!m) return;
        var id = m[1], i = +m[2], n = +m[3], rec = parts[id] || (parts[id] = { n: n, got: 0, arr: [] });
        if (rec.arr[i] == null) { rec.arr[i] = d.slice(m[0].length); rec.got++; }
        if (rec.got === rec.n) { delete parts[id]; deliver(rec.arr.join('')); }
      }
    };
    L.send = function (obj) {
      if (L.closed || dc.readyState !== 'open') return false;
      var s = JSON.stringify(obj);
      try {
        if (s.length <= CHUNK) dc.send('J' + s);
        else {
          var id = ++seq, n = Math.ceil(s.length / CHUNK);
          for (var i = 0; i < n; i++) dc.send('C' + id + ',' + i + ',' + n + ',' + s.substr(i * CHUNK, CHUNK));
        }
      } catch (e) { L.close('send'); return false; }
      return true;
    };
    function onVis() { if (document.visibilityState === 'visible') L.last = Date.now(); }
    document.addEventListener('visibilitychange', onVis);
    var hb = setInterval(function () {
      if (dc.readyState === 'open') { try { dc.send('P'); } catch (e) { /* egal */ } }
      if (document.visibilityState === 'visible' && Date.now() - L.last > 25000) L.close('timeout');
    }, 4000);
    dc.onclose = function () { L.close('dc'); };
    pc.addEventListener('connectionstatechange', function () {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') L.close(pc.connectionState);
    });
    L.close = function (why) {
      if (L.closed) return;
      L.closed = true;
      clearInterval(hb);
      document.removeEventListener('visibilitychange', onVis);
      try { dc.close(); } catch (e) { /* egal */ }
      try { pc.close(); } catch (e) { /* egal */ }
      console.warn('[P2P] Verbindung beendet:', why);
      if (L.onclose) L.onclose(why);
    };
    return L;
  }
  function gather(pc, ms) {
    return new Promise(function (resolve) {
      if (pc.iceGatheringState === 'complete') { resolve(); return; }
      var t = setTimeout(done, ms || 3500);
      function done() {
        clearTimeout(t);
        pc.removeEventListener('icegatheringstatechange', chk);
        pc.removeEventListener('icecandidate', cand);
        resolve();
      }
      function chk() { if (pc.iceGatheringState === 'complete') done(); }
      function cand(e) { if (!e.candidate) done(); }
      pc.addEventListener('icegatheringstatechange', chk);
      pc.addEventListener('icecandidate', cand);
    });
  }

  // ---------------------------------------------------------------- Einladungslink: WebRTC-Anbindung und Relay
  function getRelay() { return (P2P.relayFactory && P2P.relayFactory()) || P2P.ntfyRelay({ base: P2P.RELAY }); }
  /** Warum geht der Einladungslink hier nicht? ('' = geht) */
  function linkProblem() {
    if (!P2P.supported()) return 'Dieser Browser kann keine direkte Verbindung (WebRTC fehlt).';
    if (!/^https?:$/.test(location.protocol)) return 'Aus einer lokalen Datei heraus geht kein Einladungslink – öffne das Spiel über seine Internet-Adresse (z. B. GitHub Pages).';
    if (!window.isSecureContext || !subtle()) return 'Der Einladungslink braucht eine sichere Adresse (https), z. B. die Fassung auf GitHub Pages.';
    if (typeof WebSocket === 'undefined' || typeof fetch !== 'function') return 'Dieser Browser ist zu alt für den Einladungslink.';
    return '';
  }
  P2P.linkSupported = function () { return !linkProblem(); };
  P2P.linkProblem = linkProblem;
  function linkUrl(invite) { return location.origin + location.pathname + '#einladung=' + invite; }
  /** Adresse nur im eigenen Netz/Gerät erreichbar? (dann taugt der Link nicht für Freunde) */
  function localAddress() { return /^(localhost|127\.|\[?::1\]?$|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|[^.]+$)/.test(location.hostname); }
  var NO_NET = 'Keine Netzverbindung gefunden – bitte WLAN oder mobile Daten einschalten.';

  /** Gastgeber: ein Angebot (eigene Verbindung) für den Einladungslink. Verbindet sich der Gast, wird er Mitspieler. */
  function rtcOffer(roomCode) {
    var pc = new RTCPeerConnection({ iceServers: STUN });
    var dc = pc.createDataChannel('frontlinie', { ordered: true });
    var linked = false, dropped = false, openOk;
    var opened = new Promise(function (r) { openOk = r; });
    dc.onopen = function () {
      if (linked || dropped) return;
      linked = true;
      attachPeer(Link(pc, dc));
      UI.sfx('confirm');
      UI.toast('✓ Mitspieler verbunden.', 3500);
      openOk(true);
    };
    function drop() { if (!linked && !dropped) { dropped = true; try { pc.close(); } catch (e) { /* egal */ } } }
    return pc.createOffer().then(function (o) { return pc.setLocalDescription(o); }).then(function () { return gather(pc); }).then(function () {
      var info = parseSdp(pc.localDescription.sdp);
      if (!info.cands.length) throw new Error(NO_NET);
      return {
        code: pack(Object.assign({ t: 'O', code: roomCode, lid: logicId() }, info), RELAY_LIM),
        opened: opened,
        accept: function (txt) {
          var a = unpack(txt);
          if (a.t !== 'A') throw new Error('Das ist keine Antwort.');
          return pc.setRemoteDescription({ type: 'answer', sdp: buildSdp(a) });
        },
        drop: drop
      };
    }).catch(function (e) { drop(); throw e; });
  }
  /** Gast: Antwort auf ein Angebot; opened liefert die fertige Verbindung (Link) */
  function rtcAnswer(offerCode) {
    var o = unpack(offerCode);
    var pc = new RTCPeerConnection({ iceServers: STUN });
    var link = null, closed = false, openOk;
    var opened = new Promise(function (r) { openOk = r; });
    pc.ondatachannel = function (ev) {
      var dc = ev.channel;
      function go() { if (link || closed) return; link = Link(pc, dc); openOk(link); }
      if (dc.readyState === 'open') go(); else dc.onopen = go;
    };
    function close() {
      if (closed) return;
      closed = true;
      if (link) link.close('überzählig'); else { try { pc.close(); } catch (e) { /* egal */ } }
    }
    return pc.setRemoteDescription({ type: 'offer', sdp: buildSdp(o) })
      .then(function () { return pc.createAnswer(); })
      .then(function (a) { return pc.setLocalDescription(a); })
      .then(function () { return gather(pc); })
      .then(function () {
        var info = parseSdp(pc.localDescription.sdp);
        if (!info.cands.length) throw new Error(NO_NET);
        return { code: pack(Object.assign({ t: 'A' }, info), RELAY_LIM), opened: opened, close: close };
      })
      .catch(function (e) { close(); throw e; });
  }

  // ---------------------------------------------------------------- Nachgebildeter Ereignisstrom (wie EventSource)
  function FakeES() {
    var es = { readyState: 0, onopen: null, onerror: null, _l: {}, _q: [], _t: null, _dead: false, _onclose: null };
    es.addEventListener = function (n, f) { (es._l[n] = es._l[n] || []).push(f); };
    es.close = function () {
      if (es._dead) return;
      es._dead = true; es.readyState = 2;
      if (es._onclose) es._onclose();
    };
    // Daten sofort kopieren (wie über das Netz), Auslieferung aber erst im nächsten Takt und in Reihenfolge
    es._emit = function (event, data, id) { if (!es._dead) { es._q.push({ type: event, data: JSON.stringify(data), lastEventId: id != null ? String(id) : '' }); flush(); } };
    es._open = function () { if (!es._dead) { es._q.push({ open: true }); flush(); } };
    es._fail = function (final) { if (!es._dead) { es._q.push({ error: true, final: !!final }); flush(); } };
    function flush() {
      if (es._t) return;
      es._t = setTimeout(function () {
        es._t = null;
        var q = es._q; es._q = [];
        for (var i = 0; i < q.length && !es._dead; i++) {
          var ev = q[i];
          if (ev.open) { es.readyState = 1; if (es.onopen) es.onopen({}); }
          else if (ev.error) {
            es.readyState = ev.final ? 2 : 0;
            if (ev.final) es._dead = true;
            if (es.onerror) es.onerror({});
          } else (es._l[ev.type] || []).forEach(function (f) { f(ev); });
        }
      }, 0);
    }
    return es;
  }
  function splitPath(p) {
    var q = {}, i = p.indexOf('?'), path = i >= 0 ? p.slice(0, i) : p;
    if (i >= 0) p.slice(i + 1).split('&').forEach(function (kv) {
      var j = kv.indexOf('=');
      if (j > 0) q[decodeURIComponent(kv.slice(0, j))] = decodeURIComponent(kv.slice(j + 1));
    });
    var parts = path.split('/').filter(Boolean);
    if (parts[0] === 'api') parts.shift();
    return { parts: parts, q: q };
  }

  // ================================================================ Gastgeber: Raum läuft auf diesem Handy
  var hub = null, peers = [], saveTimers = {};
  function getHub() {
    if (!hub) hub = G.RoomHub({
      maxRooms: 8,
      log: function () { console.log.apply(console, ['[P2P]'].concat([].slice.call(arguments))); },
      persist: saveRoomSoon, remove: dropRoom,
      defer: function (fn) { setTimeout(fn, 0); }
    });
    return hub;
  }
  function hubRequest(p, body) {
    var sp = splitPath(p);
    var r = getHub().handle(body ? 'POST' : 'GET', sp.parts, sp.q, body ? clone(body) : null);
    return clone(r.body);
  }
  function hubStream(url, client) {
    var sp = splitPath(url);
    if (sp.parts[0] !== 'rooms' || sp.parts[2] !== 'stream') return { ok: false, error: 'Unbekannt' };
    return getHub().stream(sp.parts[1], sp.q.token, sp.q.last, client);
  }
  // Speichern im Browser (überlebt Neuladen und App-Neustart)
  function roomIndex() { return Store.get('p2p:rooms', []); }
  function saveRoomSoon(room) {
    if (saveTimers[room.code]) return;
    saveTimers[room.code] = setTimeout(function () { delete saveTimers[room.code]; saveRoom(room); }, 600);
  }
  function saveRoom(room) {
    if (!hub || hub.rooms.get(room.code) !== room) return;
    Store.set('p2p:room:' + room.code, hub.dump(room));
    var idx = roomIndex().filter(function (x) { return x.code !== room.code; });
    idx.unshift({ code: room.code, map: room.setup.map.name, phase: room.phase, day: room.game ? room.game.day : 0, updated: room.updated });
    idx.slice(4).forEach(function (x) { Store.del('p2p:room:' + x.code); });
    Store.set('p2p:rooms', idx.slice(0, 4));
  }
  function dropRoom(code) {
    if (saveTimers[code]) { clearTimeout(saveTimers[code]); delete saveTimers[code]; }
    stopLink(code);
    Store.del('p2p:link:' + code);
    Store.del('p2p:room:' + code);
    Store.set('p2p:rooms', roomIndex().filter(function (x) { return x.code !== code; }));
  }
  window.addEventListener('pagehide', function () {
    Object.keys(saveTimers).forEach(function (code) { clearTimeout(saveTimers[code]); delete saveTimers[code]; var r = hub && hub.rooms.get(code); if (r) saveRoom(r); });
  });

  // ---------------------------------------------------------------- Einladungslink des Gastgebers (je Raum, solange der Raum besteht)
  var linkHosts = {}, wantLink = false;
  function startLink(code, invite) {
    stopLink(code);
    invite = validInvite(invite) ? invite : newInvite();
    Store.set('p2p:link:' + code, invite);
    var lh = linkHosts[code] = P2P.LinkHost({
      invite: invite, relay: getRelay(),
      offer: function () { return rtcOffer(code); },
      info: function () {
        var r = hub && hub.rooms.get(code), seat = r && r.seats.filter(function (x) { return x.host; })[0];
        return { n: (seat && seat.name) || Net().name() || '', m: r ? r.setup.map.name : '' };
      },
      onChange: function () { if (P2P.onPeers) P2P.onPeers(); }
    });
    lh.start();
    return lh;
  }
  function stopLink(code) { var lh = linkHosts[code]; if (lh) { delete linkHosts[code]; lh.stop(); } }
  // Handy war im Hintergrund: Relay sofort neu verbinden statt auf die nächste Wiederholung zu warten
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') Object.keys(linkHosts).forEach(function (k) { linkHosts[k].wake(); });
  });

  function hostTransport(code) {
    return {
      kind: 'host', code: code, hash: '#p2p=' + code, home: P2P.show,
      api: function (p, body) {
        return new Promise(function (resolve) { setTimeout(function () { resolve(hubRequest(p, body)); }, 0); });
      },
      stream: function (url) {
        var es = FakeES();
        setTimeout(function () {
          if (es._dead) return;
          es._open();
          var r = hubStream(url, { send: es._emit, end: function () { es._fail(true); } });
          if (!r.ok) { es._fail(true); return; }
          es._onclose = r.close;
        }, 0);
        return es;
      },
      invitePanel: hostInvitePanel,
      reconnectMenu: function () { if (linkHosts[code]) openLinkDialog(code); else openHostInvite(code); }
    };
  }
  /** Verbundenes Handy bedienen: Anfragen und Ereignisströme über den Datenkanal */
  function attachPeer(link) {
    var peer = { link: link, subs: {} };
    peers.push(peer);
    link.onmsg = function (m) {
      if (m.k === 'req') {
        var r;
        try { r = hubRequest(m.p, m.b || null); } catch (e) { console.warn('[P2P]', e); r = { ok: false, error: 'Fehler beim Gastgeber' }; }
        link.send({ k: 'res', id: m.id, r: r });
      } else if (m.k === 'sub') {
        var sid = m.sid;
        var st = hubStream(m.p, {
          send: function (e, d, i) { link.send({ k: 'ev', sid: sid, e: e, d: d, i: i }); },
          end: function () { delete peer.subs[sid]; link.send({ k: 'end', sid: sid }); }
        });
        if (!st.ok) link.send({ k: 'end', sid: sid, err: st.error });
        else peer.subs[sid] = st;
      } else if (m.k === 'unsub') {
        var s = peer.subs[m.sid];
        if (s) { delete peer.subs[m.sid]; s.close(); }
      }
    };
    link.onclose = function () {
      var subs = peer.subs; peer.subs = {};
      Object.keys(subs).forEach(function (k) { subs[k].close(); });
      peers = peers.filter(function (p) { return p !== peer; });
      var s = Net() && Net().s;
      if (s && s.tr && s.tr.kind === 'host') UI.toast('Verbindung zu einem Mitspieler verloren – Menü → „Mitspieler verbinden“.', 6000);
      if (P2P.onPeers) P2P.onPeers();
    };
    if (P2P.onPeers) P2P.onPeers();
  }
  P2P.peerCount = function () { return peers.length; };

  P2P.createRoom = function (setup) {
    var r = hubRequest('api/rooms', { setup: setup, name: Net().name() });
    if (!r || !r.ok) { UI.alert((r && r.error) || 'Raum konnte nicht eröffnet werden.'); return; }
    UI.sfx('confirm');
    if (wantLink && P2P.linkSupported()) startLink(r.code);
    wantLink = false;
    Net().open(r.code, r.token, r.slot, hostTransport(r.code));
  };
  function openHostRoom(code) {
    var hb = getHub(), room = hb.rooms.get(code);
    if (!room) {
      var d = Store.get('p2p:room:' + code, null);
      if (!d) { UI.toast('Dieses Spiel ist nicht mehr gespeichert.'); P2P.show(); return; }
      try { room = hb.load(d); } catch (e) { UI.alert('Spielstand nicht lesbar.'); return; }
    }
    var seat = room.seats.filter(function (s) { return s.host; })[0];
    // Gab es einen Einladungslink, gilt er weiter – Mitspieler kommen über denselben Link zurück
    var inv = Store.get('p2p:link:' + room.code, null);
    if (inv && !linkHosts[room.code] && P2P.linkSupported()) startLink(room.code, inv);
    Net().open(room.code, seat.token, seat.slot, hostTransport(room.code));
  }

  /** Einladung zeigen (Gastgeber) und Antwort von Handy 2 entgegennehmen */
  function openHostInvite(code) {
    if (!P2P.supported()) { UI.alert('Dieser Browser kann keine direkte Verbindung.'); return; }
    var d = dialog('📲 Mitspieler verbinden');
    var pc = new RTCPeerConnection({ iceServers: STUN });
    var dc = pc.createDataChannel('frontlinie', { ordered: true });
    var done = false, timer = null;
    d.onclose = function () { clearTimeout(timer); if (!done) { try { pc.close(); } catch (e) { /* egal */ } } };
    d.body.appendChild(h('p', { text: 'Einladung wird erstellt …' }));
    dc.onopen = function () {
      if (done || d.closed) return;
      done = true; clearTimeout(timer);
      attachPeer(Link(pc, dc));
      d.close();
      UI.sfx('confirm');
      UI.toast('✓ Mitspieler verbunden.', 3500);
    };
    pc.createOffer().then(function (o) { return pc.setLocalDescription(o); }).then(function () { return gather(pc); }).then(function () {
      if (d.closed) return;
      var info = parseSdp(pc.localDescription.sdp);
      d.body.innerHTML = '';
      if (!info.cands.length) { d.body.appendChild(h('p', { class: 'warn', text: 'Keine Netzverbindung gefunden. Bitte WLAN einschalten oder einen Hotspot öffnen – dann nochmal.' })); return; }
      var text = pack(Object.assign({ t: 'O', code: code, lid: logicId() }, info));
      d.body.appendChild(h('p', { class: 'step', html: '<b>1.</b> Auf <b>Handy 2</b>: FRONTLINIE → <b>Handy zu Handy</b> → <b>Beitreten</b> → diesen Code scannen.' }));
      d.body.appendChild(codeBlock(text, 'O'));
      d.body.appendChild(h('p', { class: 'step', html: '<b>2.</b> Handy 2 zeigt dann einen Antwort-Code. Den hier scannen oder einfügen:' }));
      var status = h('p', { class: 'hint' });
      d.body.appendChild(codeInput('A', function (txt) {
        var a;
        try { a = unpack(txt); } catch (e) { status.className = 'warn'; status.textContent = 'Das ist kein gültiger Antwort-Code.'; return false; }
        if (a.t !== 'A') { status.className = 'warn'; status.textContent = 'Das ist eine Einladung, keine Antwort. Handy 2 muss erst diese Einladung scannen.'; return false; }
        status.className = 'hint'; status.textContent = 'Verbinde …';
        pc.setRemoteDescription({ type: 'answer', sdp: buildSdp(a) }).then(function () {
          timer = setTimeout(function () {
            if (done || d.closed) return;
            status.className = 'warn';
            status.innerHTML = 'Die Verbindung kommt nicht zustande. Am sichersten: beide Handys ins <b>selbe WLAN</b> – oder Handy 2 in den <b>Hotspot</b> von Handy 1. Dann „Abbrechen“ und neu einladen.';
          }, 20000);
        }).catch(function (e) { status.className = 'warn'; status.textContent = 'Antwort passt nicht zu dieser Einladung (' + (e && e.message) + '). Bitte neu einladen.'; });
        return true;
      }));
      d.body.appendChild(status);
    }).catch(function (e) {
      d.body.innerHTML = '';
      d.body.appendChild(h('p', { class: 'warn', text: 'Einladung nicht möglich: ' + (e && e.message) }));
    });
  }
  function hostInvitePanel(s) {
    var box = h('div', { class: 'p2p-invite' });
    function render() {
      box.innerHTML = '';
      var lh = linkHosts[s.code], n = peers.length, can = P2P.linkSupported();
      box.appendChild(h('h3', { text: lh ? '🔗 Einladungslink' : 'Mitspieler verbinden' }));
      box.appendChild(h('p', { html: n ? '<span class="dot on"></span> ' + n + ' Mitspieler direkt verbunden.' : 'Noch kein Mitspieler verbunden.' }));
      if (lh) box.appendChild(linkBlock(lh, s.code));
      else if (can) {
        box.appendChild(h('button', { class: 'btn primary big', onclick: function () { startLink(s.code); render(); } }, [
          h('b', { text: '🔗 Einladungslink erstellen' }), h('small', { text: 'Ein Link für alle – Freunde tippen ihn einfach an' })]));
      }
      box.appendChild(h('button', { class: 'btn big' + (lh || can ? '' : ' primary'), onclick: function () { openHostInvite(s.code); } }, [
        h('b', { text: '📲 Einladung per QR-Code' }), h('small', { text: 'Ohne Internet (selbes WLAN, Hotspot): Codes gegenseitig scannen' })]));
      box.appendChild(h('p', { class: 'hint', text: 'Dieses Gerät ist der Gastgeber: Während des Spiels FRONTLINIE offen und den Bildschirm an lassen.' }));
    }
    P2P.onPeers = function () { if (box.isConnected) render(); };
    render();
    return box;
  }
  /** Link als QR-Code und Text, Teilen/Kopieren und Stand des Einladungslinks */
  function linkBlock(lh, code) {
    var wrap = h('div', { class: 'p2p-link invite' });
    if (lh.state === 'fehler') {
      wrap.appendChild(h('p', { class: 'warn', text: lh.error || LINK_MSG.relay }));
      wrap.appendChild(h('button', { class: 'btn primary', text: 'Nochmal versuchen', onclick: function () { startLink(code, lh.invite); if (P2P.onPeers) P2P.onPeers(); } }));
      wrap.appendChild(h('p', { class: 'hint', text: 'Bis dahin geht es mit „Einladung per QR-Code“.' }));
      return wrap;
    }
    if (lh.state !== 'bereit') { wrap.appendChild(h('p', { class: 'hint', html: '<span class="dot wait"></span> Einladungslink wird erstellt …' })); return wrap; }
    var url = linkUrl(lh.invite);
    var qr; try { qr = G.QR.canvas(url, 5); qr.className = 'qr'; } catch (e) { qr = h('p', { class: 'hint', text: '(QR-Code nicht möglich)' }); }
    wrap.appendChild(qr);
    var input = h('input', { type: 'text', readonly: 'readonly', value: url, class: 'text-in link' });
    input.addEventListener('focus', function () { input.select(); });
    wrap.appendChild(input);
    var row = h('div', { class: 'row' });
    if (navigator.share) row.appendChild(h('button', { class: 'btn primary', text: 'Teilen …', onclick: function () {
      navigator.share({ title: 'FRONTLINIE', text: 'Spiel mit mir FRONTLINIE! Einfach den Link antippen:', url: url }).catch(function () {});
    } }));
    row.appendChild(h('button', { class: 'btn' + (navigator.share ? '' : ' primary'), text: 'Kopieren', onclick: function () { copyText(url, input); } }));
    wrap.appendChild(row);
    wrap.appendChild(h('p', { class: 'p2p-link-status', html: lh.connecting ? '<span class="dot wait"></span> Ein Mitspieler verbindet sich …' : '<span class="dot wait"></span> Warte auf Mitspieler …' }));
    if (localAddress()) wrap.appendChild(h('p', { class: 'warn', text: 'Achtung: Der Link zeigt auf „' + location.host + '“ – das erreichen Freunde nicht. Für Einladungen das Spiel über seine Internet-Adresse öffnen (z. B. GitHub Pages).' }));
    wrap.appendChild(h('p', { class: 'hint', text: 'Per Messenger schicken oder den QR-Code scannen lassen. Der Link gilt, solange dieser Raum offen ist – auch zum Zurückkommen nach einem Verbindungsabbruch.' }));
    return wrap;
  }
  /** Im Spiel: Einladungslink nochmal zeigen (z. B. wenn ein Mitspieler die Verbindung verloren hat) */
  function openLinkDialog(code) {
    var d = dialog('🔗 Mitspieler einladen'), key = null;
    function state() { var lh = linkHosts[code]; return [lh ? lh.state : '-', lh ? lh.connecting : 0, peers.length].join(); }
    function render() {
      key = state();
      d.body.innerHTML = '';
      var lh = linkHosts[code];
      if (!lh) { d.close(); openHostInvite(code); return; }
      d.body.appendChild(h('p', { html: peers.length ? '<span class="dot on"></span> ' + peers.length + ' Mitspieler direkt verbunden.' : 'Gerade ist kein Mitspieler verbunden.' }));
      d.body.appendChild(linkBlock(lh, code));
      d.body.appendChild(h('p', { class: 'hint', text: 'Verbindung verloren? Der Mitspieler tippt einfach nochmal auf den Link (oder Spielmenü → „Neu verbinden“) und kommt auf seinen Platz zurück.' }));
      d.body.appendChild(h('button', { class: 'btn', text: '📲 Einladung per QR-Code (ohne Internet)', onclick: function () { d.close(); openHostInvite(code); } }));
    }
    var timer = setInterval(function () { if (!d.closed && state() !== key) render(); }, 700);
    d.onclose = function () { clearInterval(timer); };
    render();
  }

  // ================================================================ Mitspieler: verbindet sich mit Handy 1
  function guestSessions() { return Store.get('p2p:guest', {}); }
  function saveGuest(code, token, slot, invite) {
    var all = guestSessions(), old = all[code];
    all[code] = { token: token, slot: slot, at: Date.now(), invite: invite || (old && old.invite) || null };
    Object.keys(all).sort(function (a, b) { return all[b].at - all[a].at; }).slice(6).forEach(function (k) { delete all[k]; });
    Store.set('p2p:guest', all);
  }
  function forgetGuest(code) { var all = guestSessions(); delete all[code]; Store.set('p2p:guest', all); }

  /** Einladung scannen → Antwort zeigen → verbunden. onLink(link, offer) */
  function openGuestPair(expectCode, onLink) {
    if (!P2P.supported()) { UI.alert('Dieser Browser kann keine direkte Verbindung.'); return; }
    var d = dialog(expectCode ? '🔌 Neu verbinden' : '🔌 Mit Handy 1 verbinden');
    var pc = null, done = false;
    d.onclose = function () { if (!done && pc) { try { pc.close(); } catch (e) { /* egal */ } } };
    var status = h('p', { class: 'hint' });
    d.body.appendChild(h('p', { class: 'step', html: '<b>1.</b> Auf <b>Handy 1</b> in der Lobby (oder im Spielmenü) <b>„Einladung per QR-Code“</b> tippen. Den Code, der dort erscheint, hier scannen oder einfügen:' }));
    var input = codeInput('O', useOffer);
    d.body.appendChild(input);
    d.body.appendChild(status);
    function useOffer(txt) {
      var inv = inviteIn(txt);
      if (inv) { // ein Einladungslink (gescannt oder eingefügt): automatisch verbinden
        d.close();
        openLinkJoin(inv, { title: expectCode ? '🔌 Neu verbinden' : '🔗 Einladung angenommen', expect: expectCode || null, askName: !expectCode },
          expectCode ? onLink : function (l, off) { guestConnected(l, off, inv); });
        return true;
      }
      var o;
      try { o = unpack(txt); } catch (e) { status.className = 'warn'; status.textContent = 'Das ist kein gültiger Einladungs-Code.'; return false; }
      if (o.t !== 'O') { status.className = 'warn'; status.textContent = 'Das ist ein Antwort-Code. Hier wird die Einladung von Handy 1 gebraucht.'; return false; }
      if (expectCode && o.code !== expectCode) { status.className = 'warn'; status.textContent = 'Diese Einladung gehört zu Raum ' + o.code + ', nicht zu ' + expectCode + '.'; return false; }
      if (o.lid !== logicId()) {
        status.className = 'warn';
        status.innerHTML = 'Achtung: Die beiden Handys haben <b>unterschiedliche Spielversionen</b>. Das kann zu Fehlern führen – am besten beide neu installieren. ';
        status.appendChild(h('button', { class: 'btn small', text: 'Trotzdem verbinden', onclick: function () { status.className = 'hint'; status.textContent = ''; answer(o); } }));
        return true;
      }
      answer(o);
      return true;
    }
    function answer(o) {
      input.style.display = 'none';
      status.className = 'hint'; status.textContent = 'Antwort wird erstellt …';
      pc = new RTCPeerConnection({ iceServers: STUN });
      pc.ondatachannel = function (ev) {
        var dc = ev.channel;
        function opened() {
          if (done || d.closed) return;
          done = true;
          var link = Link(pc, dc);
          d.close();
          UI.sfx('confirm');
          onLink(link, o);
        }
        if (dc.readyState === 'open') opened(); else dc.onopen = opened;
      };
      pc.setRemoteDescription({ type: 'offer', sdp: buildSdp(o) })
        .then(function () { return pc.createAnswer(); })
        .then(function (a) { return pc.setLocalDescription(a); })
        .then(function () { return gather(pc); })
        .then(function () {
          if (d.closed || done) return;
          var info = parseSdp(pc.localDescription.sdp);
          if (!info.cands.length) { status.className = 'warn'; status.textContent = 'Keine Netzverbindung gefunden. Bitte WLAN einschalten oder in den Hotspot von Handy 1 gehen.'; return; }
          var text = pack(Object.assign({ t: 'A' }, info));
          status.textContent = '';
          d.body.insertBefore(h('div', { class: 'p2p-answer' }, [
            h('p', { class: 'step', html: '<b>2.</b> Jetzt auf <b>Handy 1</b> diesen Antwort-Code scannen (oder per Nachricht schicken):' }),
            codeBlock(text, 'A'),
            h('p', { class: 'hint wait-dots', text: 'Warte auf Handy 1 …' })
          ]), status);
          setTimeout(function () {
            if (done || d.closed) return;
            status.className = 'warn';
            status.innerHTML = 'Noch keine Verbindung. Hat Handy 1 den Antwort-Code gescannt? Klappt es nicht: beide Handys ins <b>selbe WLAN</b> oder in den <b>Hotspot</b> von Handy 1 – dann neu einladen.';
          }, 60000);
        })
        .catch(function (e) { status.className = 'warn'; status.textContent = 'Einladung nicht nutzbar (' + (e && e.message) + '). Bitte auf Handy 1 neu einladen.'; input.style.display = ''; });
    }
  }
  function guestTransport(code, link) {
    var tr = { kind: 'guest', code: code, hash: '#p2p=' + code, home: P2P.show, link: null, reqs: {}, n: 0, streams: {} };
    function onmsg(m) {
      if (m.k === 'res') {
        var r = tr.reqs[m.id];
        if (r) { delete tr.reqs[m.id]; clearTimeout(r.t); r.res(m.r); }
      } else if (m.k === 'ev') {
        var es = tr.streams[m.sid];
        if (es) es._emit(m.e, m.d, m.i);
      } else if (m.k === 'end') {
        var es2 = tr.streams[m.sid];
        if (es2) { delete tr.streams[m.sid]; es2._fail(true); }
      }
    }
    tr.setLink = function (l) {
      if (tr.link && tr.link !== l) { var old = tr.link; old.onclose = null; old.close('ersetzt'); }
      tr.link = l;
      l.onmsg = onmsg;
      l.onclose = function () {
        if (tr.link !== l) return;
        var reqs = tr.reqs; tr.reqs = {};
        Object.keys(reqs).forEach(function (k) { clearTimeout(reqs[k].t); reqs[k].rej(new Error('Verbindung weg')); });
        var st = tr.streams; tr.streams = {};
        Object.keys(st).forEach(function (k) { st[k]._fail(false); });
        var s = Net() && Net().s;
        if (s && s.tr === tr) {
          UI.toast('Verbindung zu Handy 1 verloren – Menü → „Neu verbinden“.', 6000);
          if (s.renderLobby) s.renderLobby();
        }
      };
    };
    tr.api = function (p, body) {
      return new Promise(function (resolve, reject) {
        var l = tr.link;
        if (!l || l.closed) { reject(new Error('Keine Verbindung zu Handy 1')); return; }
        var id = ++tr.n;
        var t = setTimeout(function () { delete tr.reqs[id]; reject(new Error('Keine Antwort von Handy 1')); }, 20000);
        tr.reqs[id] = { res: resolve, rej: reject, t: t };
        if (!l.send({ k: 'req', id: id, p: p, b: body || null })) { clearTimeout(t); delete tr.reqs[id]; reject(new Error('Keine Verbindung zu Handy 1')); }
      });
    };
    tr.stream = function (url) {
      var es = FakeES(), l = tr.link, sid = ++tr.n;
      if (!l || l.closed) { es._fail(false); return es; }
      tr.streams[sid] = es;
      es._onclose = function () { delete tr.streams[sid]; if (tr.link === l && !l.closed) l.send({ k: 'unsub', sid: sid }); };
      es._open();
      l.send({ k: 'sub', sid: sid, p: url });
      return es;
    };
    tr.connected = function () { return !!(tr.link && !tr.link.closed); };
    tr.reconnectMenu = function () {
      function relink(l) { tr.setLink(l); Net().reconnect(); UI.toast('✓ Wieder verbunden.', 3000); }
      function manual() { openGuestPair(code, relink); }
      if (tr.invite && P2P.linkSupported()) openLinkJoin(tr.invite, { title: '🔌 Neu verbinden', expect: code, manual: manual }, relink);
      else manual();
    };
    tr.invitePanel = function () {
      var box = h('div', { class: 'p2p-invite' }), shown = null;
      function render() {
        var on = tr.connected();
        if (on === shown) return; shown = on;
        box.innerHTML = '';
        box.appendChild(h('h3', { text: 'Verbindung' }));
        if (on) box.appendChild(h('p', { html: '<span class="dot on"></span> Direkt mit Handy 1 verbunden.' }));
        else {
          box.appendChild(h('p', { class: 'warn', text: 'Verbindung zu Handy 1 unterbrochen.' }));
          box.appendChild(h('button', { class: 'btn primary', text: '🔌 Neu verbinden', onclick: tr.reconnectMenu }));
        }
        box.appendChild(h('p', { class: 'hint', text: 'Handy 1 ist der Gastgeber und startet das Spiel.' }));
      }
      render();
      var t = setInterval(function () { if (!box.isConnected) { clearInterval(t); return; } render(); }, 1000);
      setTimeout(function () { if (!box.isConnected) clearInterval(t); }, 3000);
      return box;
    };
    tr.onClosed = function () { forgetGuest(code); if (tr.link) { var l = tr.link; tr.link = null; l.onclose = null; l.close('Raum zu'); } };
    tr.setLink(link);
    return tr;
  }
  /** Nach dem Verbinden: dem Raum beitreten (bzw. mit gespeichertem Platz zurückkehren) */
  function guestConnected(link, offer, invite) {
    var code = offer.code, tr = guestTransport(code, link);
    var sess = guestSessions()[code];
    tr.invite = invite || (sess && sess.invite) || null;
    function join(body, retry) {
      return tr.api('api/rooms/' + code + '/join', body).then(function (j) {
        if (!j.ok && retry) { forgetGuest(code); return join({ name: Net().name() }, false); }
        if (!j.ok) { tr.onClosed(); UI.alert(j.error || 'Beitritt nicht möglich.'); return; }
        saveGuest(code, j.token, j.slot, tr.invite);
        Net().open(code, j.token, j.slot, tr);
      });
    }
    join(sess ? { token: sess.token } : { name: Net().name() }, !!sess).catch(function (e) {
      UI.alert('Keine Antwort von Handy 1 (' + (e && e.message) + ').');
    });
  }

  /** Einladungslink folgen: Dialog mit Fortschritt; onLink(link, offer, info) bei Erfolg. opts: { title, expect, manual, askName } */
  function openLinkJoin(invite, opts, onLink) {
    var d = dialog(opts.title || '🔗 Einladung angenommen');
    var status = h('p', { class: 'step' }), extra = h('div', {});
    d.body.appendChild(status);
    d.body.appendChild(extra);
    if (opts.askName) {
      var nm = h('input', { type: 'text', maxlength: '18', placeholder: 'Dein Name', value: Net().name() || '', class: 'text-in' });
      nm.addEventListener('input', function () { Net().setName(nm.value.trim()); });
      d.body.appendChild(h('label', { class: 'field' }, [h('span', { text: 'Dein Name' }), nm]));
    }
    d.body.appendChild(h('p', { class: 'hint', text: 'Das geht von selbst: Die Verbindungsdaten laufen verschlüsselt über den Dienst ntfy.sh, gespielt wird danach direkt zwischen euren Geräten.' }));
    var job = null;
    function say(text, warn) { status.className = warn ? 'warn' : 'step'; status.innerHTML = (warn ? '' : '<span class="dot wait"></span> ') + UI.esc(text); }
    function run() {
      extra.innerHTML = '';
      say('Einladung angenommen – verbinde …');
      var my = job = P2P.linkJoin({ invite: invite, relay: getRelay(), answer: rtcAnswer, onStep: function (t) { if (job === my && !d.closed) say(t); } });
      my.promise.then(function (r) {
        if (job !== my || d.closed) { r.link.close('abgebrochen'); return; }
        job = null;
        if (opts.expect && r.offer.code !== opts.expect) {
          r.link.close('falscher Raum');
          say('Dieser Link gehört zu Raum ' + r.offer.code + ', nicht zu ' + opts.expect + '.', true);
          return;
        }
        d.close();
        UI.sfx('confirm');
        if (r.offer.lid !== logicId()) UI.toast('Achtung: Ihr habt unterschiedliche Spielversionen – am besten beide die Seite neu laden.', 7000);
        onLink(r.link, r.offer, r.info);
      }, function (e) {
        if (job !== my) return;
        job = null;
        if (d.closed || e.kind === 'abort') return;
        say(e.message, true);
        extra.appendChild(h('p', { class: 'hint', text: e.kind === 'relay'
          ? 'Ohne den Dienst geht es per QR-Code: Der Gastgeber tippt in der Lobby auf „Einladung per QR-Code“, du hier auf „Per QR-Code verbinden“.'
          : 'Es geht auch per QR-Code: Der Gastgeber tippt in der Lobby auf „Einladung per QR-Code“.' }));
        extra.appendChild(h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center', margin: '8px 0' } }, [
          h('button', { class: 'btn primary', text: 'Nochmal versuchen', onclick: run }),
          h('button', { class: 'btn', text: '📷 Per QR-Code verbinden', onclick: function () {
            d.close();
            if (opts.manual) opts.manual(); else openGuestPair(null, guestConnected);
          } })
        ]));
      });
    }
    d.onclose = function () { if (job) { var j = job; job = null; j.cancel(); } };
    run();
  }
  /** Einladungslink öffnen (#einladung=<code>, auch beim Start der App). opts.resume = Raumcode (nach Neuladen) */
  P2P.joinInvite = function (invite, opts) {
    opts = opts || {};
    invite = String(invite || '').toLowerCase();
    if (!validInvite(invite)) { P2P.show(); UI.alert('Dieser Einladungslink ist unvollständig – bitte nochmal schicken lassen.'); return; }
    var why = linkProblem();
    if (why) { P2P.show(); UI.alert(why + ' Lass dir vom Gastgeber stattdessen „Einladung per QR-Code“ zeigen und tippe hier auf „Beitreten“.'); return; }
    function go() {
      P2P.show();
      openLinkJoin(invite, { title: opts.resume ? '🔌 Verbinde neu …' : '🔗 Einladung angenommen', askName: !opts.resume, expect: opts.resume || null },
        function (link, offer) { guestConnected(link, offer, invite); });
    }
    var s = Net() && Net().s;
    if (!s) { go(); return; }
    UI.confirm('Du bist gerade in Raum ' + s.code + '. Trotzdem der Einladung folgen?').then(function (ok) {
      if (!ok) return;
      var st = G.Play && G.Play.state && G.Play.state();
      if (st && st.net) G.Play.stop();
      Net().close();
      go();
    });
  };

  // ================================================================ Bausteine: Code anzeigen, scannen, einfügen
  function dialog(title) {
    var body = h('div', { class: 'p2p-body' });
    var panel = h('div', { class: 'panel p2p-dialog' }, [h('h3', { text: title }), body,
      h('div', { class: 'actions' }, [h('button', { class: 'btn', text: 'Abbrechen', onclick: close })])]);
    var box = h('div', { class: 'p2p-box' }, [panel]);
    var layer = UI.push({ modal: true, onAction: function (a) { if (a === 'b') close(); return true; } });
    $('#overlay').appendChild(box);
    var d = { body: body, panel: panel, closed: false, onclose: null, close: close };
    var watch = setInterval(function () { if (!box.isConnected) close(); }, 700);
    function close() {
      if (d.closed) return;
      d.closed = true;
      clearInterval(watch);
      if (box.parentNode) box.parentNode.removeChild(box);
      UI.pop(layer);
      if (d.onclose) d.onclose();
    }
    return d;
  }
  function codeBlock(text, kind) {
    var wrap = h('div', { class: 'p2p-code' });
    var qr;
    try { qr = G.QR.canvas(text, 4); qr.className = 'qr'; } catch (e) { qr = h('p', { class: 'hint', text: '(Für einen QR-Code zu lang – bitte als Nachricht schicken.)' }); }
    wrap.appendChild(qr);
    var ta = h('textarea', { readonly: 'readonly', class: 'text-in code-text', rows: '3', spellcheck: 'false' });
    ta.value = text;
    ta.addEventListener('focus', function () { ta.select(); });
    wrap.appendChild(ta);
    var row = h('div', { class: 'row' });
    var msg = (kind === 'O' ? 'FRONTLINIE-Einladung – in FRONTLINIE „Handy zu Handy“ → „Beitreten“ → „Code einfügen“:\n' : 'FRONTLINIE-Antwort – auf Handy 1 bei „Antwort“ einfügen:\n') + text;
    if (navigator.share) row.appendChild(h('button', { class: 'btn', text: 'Teilen …', onclick: function () { navigator.share({ text: msg }).catch(function () {}); } }));
    row.appendChild(h('button', { class: 'btn', text: 'Kopieren', onclick: function () { copyText(text, ta); } }));
    wrap.appendChild(row);
    return wrap;
  }
  function copyText(text, ta) {
    function fallback() { ta.focus(); ta.select(); try { document.execCommand('copy'); UI.toast('Kopiert.'); } catch (e) { UI.toast('Bitte markieren und kopieren.'); } }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(function () { UI.toast('Kopiert.'); }, fallback);
    else fallback();
  }
  /** Eingabe für einen Code: Kamera oder Einfügen. use(text) → true wenn angenommen */
  function codeInput(kind, use) {
    var wrap = h('div', { class: 'p2p-input' });
    var ta = h('textarea', { class: 'text-in code-text', rows: '2', spellcheck: 'false', placeholder: kind === 'O' ? 'Einladungs-Code (FL1…) oder Einladungslink hier einfügen' : 'Antwort-Code hier einfügen (FL1…)' });
    function tryText(t) { if (t && (/FL1[A-Za-z0-9_-]{20,}/.test(t) || (kind === 'O' && inviteIn(t)))) use(t); }
    ta.addEventListener('input', function () { tryText(ta.value); });
    var row = h('div', { class: 'row' });
    row.appendChild(h('button', { class: 'btn primary', text: '📷 Scannen', onclick: function () {
      scanQR().then(function (t) { if (t) { ta.value = t; use(t); } });
    } }));
    if (navigator.clipboard && navigator.clipboard.readText && window.isSecureContext) {
      row.appendChild(h('button', { class: 'btn', text: '📋 Einfügen', onclick: function () {
        navigator.clipboard.readText().then(function (t) { ta.value = t || ''; if (t) use(t); }, function () { ta.focus(); UI.toast('Bitte lange ins Feld tippen → Einfügen.'); });
      } }));
    }
    row.appendChild(h('button', { class: 'btn', text: 'OK', onclick: function () { if (ta.value.trim()) use(ta.value); } }));
    wrap.appendChild(row);
    wrap.appendChild(ta);
    return wrap;
  }
  var jsqrLoading = null;
  function loadJsQR() {
    if (window.jsQR) return Promise.resolve();
    if (!jsqrLoading) jsqrLoading = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'js/jsqr.js';
      s.onload = function () { resolve(); };
      s.onerror = function () { jsqrLoading = null; reject(new Error('QR-Leser nicht ladbar')); };
      document.head.appendChild(s);
    });
    return jsqrLoading;
  }
  function getDecoder(canvas) {
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    function viaJsQR() {
      return loadJsQR().then(function () {
        return function (video) {
          var w = video.videoWidth, hh = video.videoHeight;
          if (!w || !hh) return Promise.resolve(null);
          var sc = Math.min(1, 720 / Math.max(w, hh)), cw = Math.round(w * sc), ch = Math.round(hh * sc);
          canvas.width = cw; canvas.height = ch;
          ctx.drawImage(video, 0, 0, cw, ch);
          var r = window.jsQR(ctx.getImageData(0, 0, cw, ch).data, cw, ch, { inversionAttempts: 'dontInvert' });
          return Promise.resolve(r ? r.data : null);
        };
      });
    }
    if (typeof BarcodeDetector === 'function' && BarcodeDetector.getSupportedFormats) {
      return BarcodeDetector.getSupportedFormats().then(function (f) {
        if (f.indexOf('qr_code') < 0) return viaJsQR();
        var bd = new BarcodeDetector({ formats: ['qr_code'] });
        return function (video) { return bd.detect(video).then(function (r) { return r && r[0] ? r[0].rawValue : null; }); };
      }, viaJsQR);
    }
    return viaJsQR();
  }
  /** Kamera öffnen und QR-Code lesen → Text oder null */
  function scanQR() {
    return new Promise(function (resolve) {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.isSecureContext) {
        UI.toast('Kamera ist hier nicht verfügbar – bitte den Code einfügen.', 4000); resolve(null); return;
      }
      var video = h('video', { class: 'p2p-video' });
      video.setAttribute('playsinline', ''); video.setAttribute('muted', ''); video.muted = true; video.autoplay = true;
      var info = h('p', { class: 'hint', text: 'Halte die Kamera auf den QR-Code des anderen Handys.' });
      var box = h('div', { class: 'p2p-box p2p-scan' }, [h('div', { class: 'panel' }, [h('h3', { text: '📷 Code scannen' }), video, info,
        h('div', { class: 'actions' }, [h('button', { class: 'btn', text: 'Abbrechen', onclick: function () { finish(null); } })])])]);
      var layer = UI.push({ modal: true, onAction: function (a) { if (a === 'b') finish(null); return true; } });
      $('#overlay').appendChild(box);
      var stream = null, timer = null, done = false, canvas = document.createElement('canvas');
      function finish(v) {
        if (done) return;
        done = true; clearTimeout(timer);
        if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
        if (box.parentNode) box.parentNode.removeChild(box);
        UI.pop(layer);
        resolve(v);
      }
      navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }).then(function (st) {
        if (done) { st.getTracks().forEach(function (t) { t.stop(); }); return; }
        stream = st;
        video.srcObject = st;
        var p = video.play(); if (p && p.catch) p.catch(function () {});
        return getDecoder(canvas).then(function (dec) {
          (function loop() {
            if (done) return;
            timer = setTimeout(function () {
              dec(video).then(function (t) {
                if (t && (/FL1/.test(t) || inviteIn(t))) { UI.sfx('confirm'); finish(t); }
                else if (t) { info.textContent = 'Das ist kein FRONTLINIE-Code. Bitte den Code aus „Handy zu Handy“ scannen.'; loop(); }
                else loop();
              }, function () { loop(); });
            }, 200);
          })();
        });
      }).catch(function (e) {
        UI.toast('Kamera nicht freigegeben – bitte den Code einfügen.', 4000);
        console.warn('[P2P] Kamera', e);
        finish(null);
      });
    });
  }

  // ================================================================ Bildschirm „Handy zu Handy“
  P2P.show = function () {
    UI.music('menu');
    UI.screen('online p2p', function (wrap) {
      wrap.appendChild(h('h2', { text: 'HANDY ZU HANDY' }));
      var panel = h('div', { class: 'panel online-menu' });
      var nm = h('input', { type: 'text', maxlength: '18', placeholder: 'Dein Name', value: Net().name() || '', class: 'text-in' });
      nm.addEventListener('change', function () { Net().setName(nm.value.trim()); });
      panel.appendChild(h('label', { class: 'field' }, [h('span', { text: 'Dein Name' }), nm]));
      function named() {
        if (!nm.value.trim()) { nm.focus(); UI.toast('Bitte gib einen Namen ein.'); return false; }
        Net().setName(nm.value.trim());
        return true;
      }
      var why = linkProblem();
      panel.appendChild(h('div', { class: 'big-choices' }, [
        h('button', { class: 'btn primary big', onclick: function () {
          if (why) { UI.alert(why + ' Bis dahin: „Spiel eröffnen (ohne Internet)“ mit QR-Codes.'); return; }
          if (named()) { wantLink = true; UI.showSkirmish({ p2p: true }); }
        } }, [
          h('b', { text: '🔗 Einladungslink erstellen' }), h('small', { text: why ? 'Geht hier nicht – antippen für den Grund' : 'Karte wählen, dann den Link an Freunde schicken – sie tippen ihn nur an' })]),
        h('button', { class: 'btn big', onclick: function () { if (named()) { wantLink = false; UI.showSkirmish({ p2p: true }); } } }, [
          h('b', { text: 'Spiel eröffnen (ohne Internet)' }), h('small', { text: 'Einladung per QR-Code – z. B. im selben WLAN oder Hotspot' })]),
        h('button', { class: 'btn big', onclick: function () { if (named()) openGuestPair(null, guestConnected); } }, [
          h('b', { text: 'Beitreten' }), h('small', { text: 'Code von Handy 1 scannen oder einfügen (Einladungslinks einfach antippen)' })])
      ]));
      // Am PC: QR-Code, mit dem beide Handys das Spiel (neueste Version) bekommen
      var pcBox = null, pcKey = '', pcTimer = null;
      if (/^(localhost|127\.|\[?::1\]?$)/.test(location.hostname) && G.Net && G.Net.available) {
        pcBox = h('div', {});
        wrap.appendChild(pcBox);
        var poll = function () { G.Net.available().then(function (info) { if (pcBox.isConnected) renderPc(info); }); };
        poll();
        pcTimer = setInterval(function () { if (!pcBox.isConnected) { clearInterval(pcTimer); return; } poll(); }, 2500);
      }
      function renderPc(info) {
        var lanOk = info && !(info.firewall && info.firewall.active && info.firewall.open === false);
        var base = info && (info.public || (lanOk && info.lan && info.lan[0])) || null;
        var key = JSON.stringify([!!info, base, info && info.tunnel]);
        if (key === pcKey) return; pcKey = key;
        pcBox.innerHTML = '';
        var p = h('div', { class: 'panel invite phones' });
        pcBox.appendChild(p);
        p.appendChild(h('h3', { text: '📱📱 Spiel auf beide Handys holen' }));
        if (!info) { p.appendChild(h('p', { html: 'Starte das Spiel über <b>„FRONTLINIE (Internet)“</b> im App-Menü – dann erscheint hier ein QR-Code.' })); return; }
        if (!info.public) {
          var tb = UI.tunnelButton(info, function () { pcKey = ''; poll(); });
          if (tb) { p.appendChild(h('p', { text: 'Für die Installation brauchen die Handys einmal eine sichere Internet-Adresse:' })); p.appendChild(tb); }
          if (!info.public) return;
        }
        var url = info.public.replace(/\/?$/, '/') + '#app';
        var qr; try { qr = G.QR.canvas(url, 5); qr.className = 'qr'; } catch (e) { qr = h('div', { text: '(QR nicht möglich)' }); }
        p.appendChild(qr);
        p.appendChild(h('input', { type: 'text', readonly: 'readonly', value: url, class: 'text-in link' }));
        p.appendChild(h('ol', { class: 'steps', html:
          '<li><b>Beide Handys</b> scannen diesen QR-Code mit der Kamera und öffnen den Link.</li>' +
          '<li>Warten bis „✓ Offline gespeichert“ erscheint, dann <b>Installieren</b> (bzw. Menü ⋮ → „App installieren“, iPhone: Teilen → „Zum Home-Bildschirm“).</li>' +
          '<li>Auf beiden Handys die App öffnen → <b>Handy zu Handy</b>. Ab jetzt braucht ihr den PC nicht mehr.</li>' }));
        p.appendChild(h('p', { class: 'hint', text: 'Die Adresse ist bei jedem Start eine andere – immer den aktuellen QR-Code hier scannen. Beide Handys brauchen dieselbe Version.' }));
      }
      wrap.appendChild(panel);
      if (pcBox) wrap.insertBefore(pcBox, panel);
      // Gespeicherte eigene Spiele (Gastgeber)
      var idx = roomIndex();
      if (idx.length) {
        var list = h('div', { class: 'panel' }, [h('h3', { text: 'Deine Spiele (du bist Gastgeber)' })]);
        idx.forEach(function (r) {
          var phase = r.phase === 'lobby' ? 'Lobby' : r.phase === 'play' ? 'läuft' + (r.day ? ' · Tag ' + r.day : '') : 'beendet';
          var row = h('div', { class: 'room-row' }, [
            h('span', { class: 'code', text: r.code }), h('span', { text: r.map + ' · ' + phase }),
            h('button', { class: 'btn primary', text: 'Weiter ▶', onclick: function () { openHostRoom(r.code); } }),
            h('button', { class: 'btn small', text: '✕', title: 'Spiel löschen', onclick: function () {
              UI.confirm('Spiel ' + r.code + ' (' + r.map + ') löschen?').then(function (ok) {
                if (!ok) return;
                var room = hub && hub.rooms.get(r.code);
                if (room) hub.closeRoom(room, 'Der Gastgeber hat das Spiel gelöscht.'); else dropRoom(r.code);
                P2P.show();
              });
            } })
          ]);
          list.appendChild(row);
        });
        wrap.appendChild(list);
      }
      wrap.appendChild(h('div', { class: 'panel p2p-help', html:
        '<h3>So geht’s</h3><ol class="steps">' +
        '<li><b>Gastgeber</b>: „Einladungslink erstellen“ → Karte wählen (Plätze für Freunde = „Mitspieler (Netz)“) → „Raum eröffnen“.</li>' +
        '<li>Den Link mit <b>„Teilen“</b> per Messenger schicken – oder den QR-Code mit der Kamera scannen lassen.</li>' +
        '<li><b>Freunde</b> tippen den Link an: Das Spiel öffnet sich und verbindet sich von selbst mit der Lobby.</li>' +
        '<li>Der Gastgeber tippt auf <b>„Spiel starten“</b>.</li></ol>' +
        '<p class="hint">Der Link läuft über den kostenlosen Dienst ntfy.sh – nur zum Verbinden und verschlüsselt; gespielt wird direkt zwischen den Geräten. ' +
        'Die Partie läuft, solange die Verbindung steht: Der Gastgeber muss FRONTLINIE offen und den Bildschirm an lassen. ' +
        'Reißt die Verbindung ab, einfach den Link nochmal antippen (bzw. Spielmenü → „Neu verbinden“). ' +
        'Zwischen manchen Mobilfunknetzen klappt keine Direktverbindung – dann hilft dasselbe WLAN oder der Hotspot des Gastgebers.</p>' +
        '<p class="hint"><b>Ohne Internet</b>: „Spiel eröffnen (ohne Internet)“ → in der Lobby „Einladung per QR-Code“; Handy 2 tippt „Beitreten“ → „Scannen“ ' +
        'und zeigt danach einen Antwort-Code, den Handy 1 scannt. Am zuverlässigsten im selben WLAN oder im Hotspot von Handy 1.</p>' }));
      wrap.appendChild(h('div', { class: 'actions' }, [h('button', { class: 'btn', text: 'Zurück', onclick: function () { UI.sfx('cancel'); UI.showTitle(); } })]));
      return { cleanup: function () { clearInterval(pcTimer); }, onAction: function (a) { if (a === 'b') UI.showTitle(); return true; } };
    });
  };
  /** Nach Neuladen (#p2p=CODE) */
  P2P.resume = function (code) {
    code = String(code || '').toUpperCase();
    if ((hub && hub.rooms.get(code)) || Store.get('p2p:room:' + code, null)) { openHostRoom(code); return; }
    var gs = guestSessions()[code];
    if (gs && validInvite(gs.invite) && P2P.linkSupported() && Date.now() - gs.at < 12 * 3600 * 1000) { P2P.joinInvite(gs.invite, { resume: code }); return; }
    P2P.show();
    if (gs) UI.toast('Raum ' + code + ': Lass dir von Handy 1 eine neue Einladung zeigen → „Beitreten“.', 7000);
  };
  // Für Tests
  P2P._test = { Link: Link, FakeES: FakeES, hostTransport: hostTransport, guestTransport: guestTransport, attachPeer: attachPeer, getHub: getHub, guestConnected: guestConnected, gather: gather, STUN: STUN,
    rtcOffer: rtcOffer, rtcAnswer: rtcAnswer, startLink: startLink, stopLink: stopLink, linkHosts: linkHosts, linkUrl: linkUrl, openLinkJoin: openLinkJoin, peers: function () { return peers; } };
})();
