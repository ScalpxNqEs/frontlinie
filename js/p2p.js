// FRONTLINIE – Handy zu Handy: direkte Verbindung zwischen zwei (bis vier) Geräten, ganz ohne PC
//
// Handy 1 (Gastgeber) führt den Spielraum selbst (js/room.js – dieselbe Logik wie der PC-Server).
// Die anderen verbinden sich per WebRTC-Datenkanal. Zum Verbinden zeigt Handy 1 einen Code (QR oder Text),
// Handy 2 antwortet mit einem eigenen Code – danach laufen alle Spielzüge direkt zwischen den Geräten.
// Lobby, Spiel und Abgleich sind dieselben wie beim Online-Gefecht (js/online.js), nur der Übertragungsweg ist anders.
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

  /** { t:'O'|'A', code?, lid?, ...parseSdp } → Text „FL1…“ */
  function pack(o) {
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
      if (cands.length >= MAX_CANDS) return;
      var b = [], kind, m;
      if ((m = IPV4.exec(c.addr))) { kind = 0; b = [+m[1], +m[2], +m[3], +m[4]]; }
      else if ((m = UUID_LOCAL.exec(c.addr))) { kind = 2; b = hexBytes((m[1] + m[2] + m[3] + m[4] + m[5]).toLowerCase()); }
      else if (c.addr.indexOf(':') >= 0 && (b = ip6Bytes(c.addr))) kind = 1;
      else { kind = 3; if (c.addr.length > 255) return; b = [c.addr.length]; for (var k = 0; k < c.addr.length; k++) b.push(c.addr.charCodeAt(k) & 255); }
      var enc = [((c.typ === 'srflx' ? 1 : 0) << 4) | kind].concat(b, [c.port >> 8, c.port & 255]);
      var test = head.concat([cands.length + 1], [].concat.apply([], cands), enc);
      if (PREFIX.length + Math.ceil(test.length * 4 / 3) > MAX_LEN) return;
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
    Store.del('p2p:room:' + code);
    Store.set('p2p:rooms', roomIndex().filter(function (x) { return x.code !== code; }));
  }
  window.addEventListener('pagehide', function () {
    Object.keys(saveTimers).forEach(function (code) { clearTimeout(saveTimers[code]); delete saveTimers[code]; var r = hub && hub.rooms.get(code); if (r) saveRoom(r); });
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
      reconnectMenu: function () { openHostInvite(code); }
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
      box.appendChild(h('h3', { text: 'Mitspieler verbinden' }));
      var n = peers.length;
      box.appendChild(h('p', { html: n ? '<span class="dot on"></span> ' + n + ' Handy' + (n > 1 ? 's' : '') + ' verbunden.' : 'Noch kein Handy verbunden.' }));
      box.appendChild(h('button', { class: 'btn primary big', onclick: function () { openHostInvite(s.code); } }, [
        h('b', { text: '📲 Einladung zeigen' }), h('small', { text: 'Handy 2 scannt sie unter „Handy zu Handy“ → „Beitreten“' })]));
      box.appendChild(h('p', { class: 'hint', text: 'Am zuverlässigsten: beide Handys im selben WLAN – oder Handy 2 im Hotspot dieses Handys. Dieses Handy ist der Gastgeber und muss während des Spiels an bleiben.' }));
    }
    P2P.onPeers = function () { if (box.isConnected) render(); };
    render();
    return box;
  }

  // ================================================================ Mitspieler: verbindet sich mit Handy 1
  function guestSessions() { return Store.get('p2p:guest', {}); }
  function saveGuest(code, token, slot) {
    var all = guestSessions(); all[code] = { token: token, slot: slot, at: Date.now() };
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
    d.body.appendChild(h('p', { class: 'step', html: '<b>1.</b> Auf <b>Handy 1</b> in der Lobby (oder im Spielmenü) <b>„Mitspieler verbinden“</b> tippen. Den Code, der dort erscheint, hier scannen oder einfügen:' }));
    var input = codeInput('O', useOffer);
    d.body.appendChild(input);
    d.body.appendChild(status);
    function useOffer(txt) {
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
      openGuestPair(code, function (l) { tr.setLink(l); Net().reconnect(); UI.toast('✓ Wieder verbunden.', 3000); });
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
  function guestConnected(link, offer) {
    var code = offer.code, tr = guestTransport(code, link);
    var sess = guestSessions()[code];
    function join(body, retry) {
      return tr.api('api/rooms/' + code + '/join', body).then(function (j) {
        if (!j.ok && retry) { forgetGuest(code); return join({ name: Net().name() }, false); }
        if (!j.ok) { tr.onClosed(); UI.alert(j.error || 'Beitritt nicht möglich.'); return; }
        saveGuest(code, j.token, j.slot);
        Net().open(code, j.token, j.slot, tr);
      });
    }
    join(sess ? { token: sess.token } : { name: Net().name() }, !!sess).catch(function (e) {
      UI.alert('Keine Antwort von Handy 1 (' + (e && e.message) + ').');
    });
  }

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
    var ta = h('textarea', { class: 'text-in code-text', rows: '2', spellcheck: 'false', placeholder: kind === 'O' ? 'Einladungs-Code hier einfügen (FL1…)' : 'Antwort-Code hier einfügen (FL1…)' });
    function tryText(t) { if (t && /FL1[A-Za-z0-9_-]{20,}/.test(t)) use(t); }
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
                if (t && /FL1/.test(t)) { UI.sfx('confirm'); finish(t); }
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
      panel.appendChild(h('div', { class: 'big-choices' }, [
        h('button', { class: 'btn primary big', onclick: function () { if (named()) UI.showSkirmish({ p2p: true }); } }, [
          h('b', { text: 'Spiel eröffnen' }), h('small', { text: 'Du bist Gastgeber: Karte wählen, dann Handy 2 einladen' })]),
        h('button', { class: 'btn big', onclick: function () { if (named()) openGuestPair(null, guestConnected); } }, [
          h('b', { text: 'Beitreten' }), h('small', { text: 'Einladung von Handy 1 scannen oder einfügen' })])
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
        '<li><b>Handy 1</b>: „Spiel eröffnen“ → Karte wählen (Platz 2 = „Mitspieler (Netz)“) → „Raum eröffnen“ → <b>„Einladung zeigen“</b>.</li>' +
        '<li><b>Handy 2</b>: „Beitreten“ → <b>„Scannen“</b> und die Kamera auf den Code von Handy 1 halten. Handy 2 zeigt danach einen Antwort-Code.</li>' +
        '<li><b>Handy 1</b>: bei „Antwort“ auf <b>„Scannen“</b> tippen und den Code von Handy 2 scannen → verbunden.</li>' +
        '<li>Handy 1 tippt auf <b>„Spiel starten“</b>.</li></ol>' +
        '<p class="hint">Statt zu scannen könnt ihr die Codes auch per Nachricht schicken („Teilen“) und einfügen. ' +
        'Am zuverlässigsten klappt es im <b>selben WLAN</b> oder wenn Handy 2 im <b>Hotspot</b> von Handy 1 ist – ganz ohne Internet. ' +
        'Über Mobilfunk an verschiedenen Orten klappt es nur manchmal. Handy 1 ist der Gastgeber und muss während des Spiels an bleiben. ' +
        'Reißt die Verbindung ab: im Spielmenü „Mitspieler verbinden“ (Handy 1) bzw. „Neu verbinden“ (Handy 2).</p>' }));
      wrap.appendChild(h('div', { class: 'actions' }, [h('button', { class: 'btn', text: 'Zurück', onclick: function () { UI.sfx('cancel'); UI.showTitle(); } })]));
      return { cleanup: function () { clearInterval(pcTimer); }, onAction: function (a) { if (a === 'b') UI.showTitle(); return true; } };
    });
  };
  /** Nach Neuladen (#p2p=CODE) */
  P2P.resume = function (code) {
    code = String(code || '').toUpperCase();
    if ((hub && hub.rooms.get(code)) || Store.get('p2p:room:' + code, null)) { openHostRoom(code); return; }
    P2P.show();
    if (guestSessions()[code]) UI.toast('Raum ' + code + ': Lass dir von Handy 1 eine neue Einladung zeigen → „Beitreten“.', 7000);
  };
  // Für Tests
  P2P._test = { Link: Link, FakeES: FakeES, hostTransport: hostTransport, guestTransport: guestTransport, attachPeer: attachPeer, getHub: getHub, guestConnected: guestConnected, gather: gather, STUN: STUN };
})();
