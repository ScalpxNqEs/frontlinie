// FRONTLINIE – Spielräume für Online-Gefechte (ohne DOM, läuft im Node-Server und auf dem Gastgeber-Handy)
//
// Ein Raum hält die Plätze, die laufende Partie und das Befehlsprotokoll. Jeder Befehl wird mit derselben
// Spiellogik geprüft wie im Browser und dann an alle verbundenen Mitspieler verteilt. KI-Plätze rechnet der Raum selbst.
// Die Übertragung (HTTP/SSE am PC, WebRTC zwischen Handys) steckt nicht hier, sondern im jeweiligen Adapter.
var G = (typeof globalThis !== 'undefined' ? globalThis : window).G = (globalThis.G || {});
(function () {
  'use strict';
  var CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  function rnd(n) {
    var a = new Uint32Array(1);
    globalThis.crypto.getRandomValues(a);
    return a[0] % n;
  }
  function newToken() {
    var a = new Uint8Array(16), s = '';
    globalThis.crypto.getRandomValues(a);
    for (var i = 0; i < a.length; i++) s += (a[i] < 16 ? '0' : '') + a[i].toString(16);
    return s;
  }
  function cleanName(s, def) {
    s = String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 18);
    return s || def;
  }
  function res(status, body) { return { status: status, body: body }; }

  /**
   * opts: log(...), persist(room), remove(code), defer(fn), maxRooms, codeChars
   */
  G.RoomHub = function (opts) {
    opts = opts || {};
    var rooms = new Map();
    var log = opts.log || function () {};
    var persist = opts.persist || function () {};
    var remove = opts.remove || function () {};
    var defer = opts.defer || function (fn) { setTimeout(fn, 0); };
    var MAX_ROOMS = opts.maxRooms || 200;

    function newCode() {
      for (var n = 0; n < 1000; n++) {
        var c = '';
        for (var i = 0; i < 5; i++) c += CODE_CHARS[rnd(CODE_CHARS.length)];
        if (!rooms.has(c)) return c;
      }
      throw new Error('Kein freier Raumcode');
    }
    function seatOf(room, token) { return token ? room.seats.find(function (s) { return s.token === token; }) || null : null; }
    function onlineSlots(room) {
      var set = new Set();
      room.clients.forEach(function (c) { if (c.seat) set.add(c.seat.slot); });
      return Array.from(set).sort();
    }
    function lobbyInfo(room) {
      var online = onlineSlots(room);
      return {
        code: room.code, phase: room.phase, gameNo: room.gameNo,
        map: { id: room.setup.map.id, name: room.setup.map.name, players: room.setup.map.players, w: (room.setup.map.rows[0] || '').length / 2, h: room.setup.map.rows.length },
        settings: { vision: room.setup.meta.vision, weatherMode: room.setup.meta.weatherMode, funds: room.setup.funds, income: room.setup.income, powers: room.setup.meta.powers !== false },
        seats: room.seats.map(function (s) {
          return { slot: s.slot, faction: s.faction, co: s.co, co2: s.co2 || null, team: s.team, kind: s.kind, aiLevel: s.aiLevel, name: s.name || null,
            host: !!s.host, taken: !!s.token, online: online.indexOf(s.slot) >= 0 };
        })
      };
    }
    function validateSetup(setup) {
      if (!setup || typeof setup !== 'object') return 'Konfiguration fehlt';
      var m = setup.map;
      if (!m || !Array.isArray(m.rows) || !m.rows.length || m.rows.length > 200) return 'Karte fehlt';
      try { G.parseMap(m); } catch (e) { return 'Karte ungültig'; }
      if (!Array.isArray(setup.seats) || setup.seats.length < 2 || setup.seats.length > 4) return 'Plätze ungültig';
      var hosts = setup.seats.filter(function (s) { return s.control === 'host'; });
      if (hosts.length !== 1) return 'Genau ein Platz muss dir gehören';
      var teams = new Set(setup.seats.map(function (s) { return s.team; }));
      if (teams.size < 2) return 'Mindestens zwei Teams nötig';
      for (var i = 0; i < setup.seats.length; i++) {
        var s = setup.seats[i];
        if (!G.FACTIONS[s.faction] || !G.COS[s.co]) return 'Fraktion oder Kommandant unbekannt';
        // Fusion: zweiter Kommandant ist optional; leer/null heißt keiner, gleich dem ersten wird ignoriert
        if (s.co2 != null && s.co2 !== '' && !G.COS[s.co2]) return 'Zweiter Kommandant unbekannt';
      }
      return null;
    }
    /** Gültiger Fusionspartner zu co (sonst null) */
    function partnerOf(co2, co) { return co2 && G.COS[co2] && co2 !== co ? co2 : null; }
    function createRoom(setup, hostName) {
      var code = newCode();
      var room = {
        code: code, created: Date.now(), updated: Date.now(), phase: 'lobby', gameNo: 0,
        setup: {
          map: setup.map, fog: !!setup.fog, funds: +setup.funds || 0, income: +setup.income || 1000,
          meta: Object.assign({}, setup.meta || {}, { mode: 'online' })
        },
        seats: setup.seats.map(function (s) {
          var ai = /^ai/.test(s.control);
          return { slot: s.slot, faction: s.faction, co: s.co, co2: partnerOf(s.co2, s.co), team: s.team || s.slot, kind: ai ? 'ai' : 'human',
            aiLevel: ai ? (s.control.split(':')[1] || 'normal') : null, host: s.control === 'host', token: null, name: null };
        }),
        game: null, seq: 0, log: [], startEvents: null, clients: new Set(), aiRunning: false
      };
      var host = room.seats.find(function (s) { return s.host; });
      host.token = newToken();
      host.name = cleanName(hostName, 'Spieler 1');
      rooms.set(code, room);
      persist(room);
      return { room: room, seat: host };
    }
    function startGame(room) {
      var cfg = {
        map: room.setup.map, fog: room.setup.fog, funds: room.setup.funds, income: room.setup.income,
        meta: Object.assign({}, room.setup.meta, { mode: 'online', room: room.code }),
        seed: rnd(1e9),
        players: room.seats.map(function (s) {
          return { slot: s.slot, faction: s.faction, co: s.co, co2: s.co2 || null, team: s.team, ai: s.kind === 'ai', aiLevel: s.aiLevel || 'normal',
            name: s.kind === 'human' && s.name ? s.name : undefined };
        })
      };
      var g = G.gameFromSetup(cfg);
      room.game = g;
      room.startEvents = g.startEvents || [];
      room.seq = 0;
      room.log = [];
      room.gameNo++;
      room.phase = 'play';
      touchMemo(room);
      broadcast(room, 'start', startPayload(room), room.gameNo + ':0');
      broadcast(room, 'lobby', lobbyInfo(room));
      persist(room);
      scheduleAI(room);
    }
    function startPayload(room) {
      return { gameNo: room.gameNo, seq: 0, state: room.game.serialize(), hash: room.game.stateHash(), startEvents: room.startEvents };
    }
    function statePayload(room) { return { gameNo: room.gameNo, seq: room.seq, state: room.game.serialize(), hash: room.game.stateHash() }; }
    // Erkundungsgedächtnis der Menschen aktuell halten (für Wiederverbindungen)
    function touchMemo(room) {
      var g = room.game;
      if (!g || !g.explore) return;
      g.players.forEach(function (p) { if (!p.ai && p.alive) g.visibility(p.slot); });
    }

    /** Führt einen Befehl aus, protokolliert ihn und verteilt ihn an alle Mitspieler. */
    function applyAndLog(room, slot, cmd, cid) {
      var g = room.game, r;
      try { r = g.applyCmd(slot, cmd); } catch (e) { log('Befehl-Fehler', room.code, e.message); r = { ok: false, error: 'exception' }; }
      if (!r || !r.ok) return { ok: false, error: (r && r.error) || 'invalid' };
      room.seq++;
      var hash = g.stateHash();
      var entry = { seq: room.seq, slot: slot, cmd: cmd, cid: cid || null, hash: hash };
      room.log.push(entry);
      if (room.log.length > 2000) room.log.splice(0, room.log.length - 1500);
      room.updated = Date.now();
      touchMemo(room);
      broadcast(room, 'cmd', Object.assign({ gameNo: room.gameNo }, entry), room.gameNo + ':' + room.seq);
      if (g.over && room.phase === 'play') { room.phase = 'over'; broadcast(room, 'lobby', lobbyInfo(room)); }
      persist(room);
      return { ok: true, seq: room.seq, hash: hash };
    }

    // ---------------------------------------------------------------- KI
    function scheduleAI(room) {
      if (room.aiRunning || !room.game || room.game.over) return;
      if (!room.game.currentPlayer().ai) return;
      room.aiRunning = true;
      defer(function () {
        runAI(room).catch(function (e) { log('KI-Fehler', e && e.message); }).then(function () { room.aiRunning = false; });
      });
    }
    function aiToCmd(c) {
      if (!c || c.kind === 'end') return { t: 'end' };
      if (c.kind === 'resign') return { t: 'resign' };
      if (c.kind === 'power') return { t: 'power', level: c.level };
      if (c.kind === 'build') return { t: 'build', type: c.type, x: c.x, y: c.y };
      if (c.kind === 'unit') return { t: 'unit', id: c.unitId, path: c.path, action: c.action };
      return { t: 'end' };
    }
    function runAI(room) {
      var g = room.game;
      var steps = 0, fails = 0, slot = null, turnSteps = 0;
      return new Promise(function (resolve) {
        function loop() {
          while (rooms.get(room.code) === room && room.game === g && !g.over && g.currentPlayer().ai) {
            var cp = g.currentPlayer();
            if (cp.slot !== slot) { slot = cp.slot; turnSteps = 0; fails = 0; }
            var plan;
            try { plan = G.AI.planNext(g, cp.slot, { level: cp.aiLevel || 'normal' }); } catch (e) { log('KI-Planung', e.message); plan = { kind: 'end' }; }
            var cmd = aiToCmd(plan);
            if (fails > 40 || turnSteps > 600) cmd = { t: 'end' };
            var r = applyAndLog(room, cp.slot, cmd);
            if (!r.ok) {
              fails++;
              if (cmd.t === 'end') break; // sollte nie passieren
            }
            turnSteps++;
            if (++steps % 4 === 0) { defer(loop); return; }
          }
          resolve();
        }
        loop();
      });
    }

    // ---------------------------------------------------------------- Mitspieler-Verbindungen
    function broadcast(room, event, data, id) {
      room.clients.forEach(function (c) { try { c.send(event, data, id); } catch (e) { /* Verbindung weg */ } });
    }
    function presence(room) { broadcast(room, 'presence', { online: onlineSlots(room) }); }
    /**
     * Ereignisstrom eines Mitspielers öffnen. client: { send(event, data, id), end() }
     * → { ok, status, error } bzw. { ok: true, close() }
     */
    function stream(code, token, lastId, client) {
      var room = rooms.get(String(code || '').toUpperCase());
      if (!room) return { ok: false, status: 404, error: 'Raum ' + code + ' gibt es nicht (mehr).' };
      var seat = seatOf(room, token);
      if (!seat) return { ok: false, status: 403, error: 'Kein Platz in diesem Raum' };
      client.seat = seat;
      room.clients.add(client);
      client.send('hello', { slot: seat.slot, code: room.code, host: !!seat.host, name: seat.name });
      client.send('lobby', lobbyInfo(room));
      if (room.game) {
        // Fortsetzen nach kurzer Unterbrechung: nur verpasste Befehle schicken
        var resumed = false;
        var m = /^(\d+):(\d+)$/.exec(lastId || '');
        if (m && +m[1] === room.gameNo) {
          var after = +m[2];
          var first = room.log.length ? room.log[0].seq : room.seq + 1;
          if (after <= room.seq && after >= first - 1) {
            room.log.forEach(function (e) { if (e.seq > after) client.send('cmd', Object.assign({ gameNo: room.gameNo }, e), room.gameNo + ':' + e.seq); });
            resumed = true;
          }
        }
        if (!resumed) client.send('state', statePayload(room), room.gameNo + ':' + room.seq);
      }
      presence(room);
      return {
        ok: true,
        close: function () {
          if (!room.clients.has(client)) return;
          room.clients.delete(client);
          presence(room);
        }
      };
    }
    function closeRoom(room, reason) {
      broadcast(room, 'closed', { reason: reason || 'Der Gastgeber hat den Raum geschlossen.' });
      room.clients.forEach(function (c) { try { c.end(); } catch (e) { /* egal */ } });
      room.clients.clear();
      rooms.delete(room.code);
      remove(room.code);
    }

    // ---------------------------------------------------------------- Anfragen (wie HTTP: method, ['rooms', CODE, action], query, body)
    function handle(method, parts, query, body) {
      query = query || {};
      body = body || {};
      if (parts[0] !== 'rooms') return res(404, { ok: false, error: 'Unbekannt' });
      if (parts.length === 1 && method === 'POST') {
        if (rooms.size >= MAX_ROOMS) return res(503, { ok: false, error: 'Zu viele Räume' });
        var err = validateSetup(body.setup);
        if (err) return res(400, { ok: false, error: err });
        var r = createRoom(body.setup, body.name);
        log('Raum ' + r.room.code + ' eröffnet: ' + r.room.setup.map.name);
        return res(200, { ok: true, code: r.room.code, token: r.seat.token, slot: r.seat.slot });
      }
      var code = String(parts[1] || '').toUpperCase();
      var room = rooms.get(code);
      if (!room) return res(404, { ok: false, error: 'Raum ' + code + ' gibt es nicht (mehr).' });
      var action = parts[2] || '';
      var seat;
      if (method === 'GET' && action === '') return res(200, Object.assign({ ok: true }, lobbyInfo(room)));
      if (method === 'GET' && action === 'state') {
        seat = seatOf(room, query.token);
        if (!seat) return res(403, { ok: false, error: 'Kein Platz' });
        if (!room.game) return res(409, { ok: false, error: 'Kein laufendes Spiel' });
        return res(200, Object.assign({ ok: true }, statePayload(room)));
      }
      if (method !== 'POST') return res(405, { ok: false, error: 'Methode' });
      seat = seatOf(room, body.token);

      if (action === 'join') {
        if (seat) return res(200, { ok: true, token: seat.token, slot: seat.slot, code: room.code });
        if (room.phase !== 'lobby') return res(409, { ok: false, error: 'Das Spiel läuft schon.' });
        var free = room.seats.filter(function (s) { return s.kind === 'human' && !s.token; });
        if (body.slot) free = free.filter(function (s) { return s.slot === +body.slot; });
        if (!free.length) return res(409, { ok: false, error: 'Kein freier Platz mehr.' });
        var ns = free[0];
        ns.token = newToken();
        ns.name = cleanName(body.name, 'Spieler ' + ns.slot);
        room.updated = Date.now();
        broadcast(room, 'lobby', lobbyInfo(room));
        persist(room);
        log('Raum ' + room.code + ': ' + ns.name + ' tritt bei (Platz ' + ns.slot + ')');
        return res(200, { ok: true, token: ns.token, slot: ns.slot, code: room.code });
      }
      if (!seat) return res(403, { ok: false, error: 'Kein Platz in diesem Raum' });

      if (action === 'seat') {
        if (room.phase !== 'lobby') return res(409, { ok: false, error: 'Nur vor dem Start' });
        var target = seat;
        if (body.slot && body.slot !== seat.slot) {
          if (!seat.host) return res(403, { ok: false, error: 'Nur der Gastgeber' });
          target = room.seats.find(function (s) { return s.slot === +body.slot; });
          if (!target || target.host) return res(400, { ok: false, error: 'Platz' });
          if (body.kind === 'ai' || body.kind === 'human') {
            target.kind = body.kind;
            target.aiLevel = body.kind === 'ai' ? (['leicht', 'normal', 'schwer'].indexOf(body.aiLevel) >= 0 ? body.aiLevel : 'normal') : null;
            if (body.kind === 'ai') { target.token = null; target.name = null; }
          }
        }
        if (body.co && G.COS[body.co]) {
          target.co = body.co;
          if (target.co2 === body.co) target.co2 = null; // Haupt-CO gleich dem Partner → Fusion auflösen
        }
        // Fusion: co2 = gültige CO-Id (≠ co) setzt den Partner, '' oder null (im Body vorhanden) entfernt ihn
        if (Object.prototype.hasOwnProperty.call(body, 'co2')) {
          if (body.co2 === '' || body.co2 === null) target.co2 = null;
          else if (partnerOf(body.co2, target.co)) target.co2 = body.co2;
        }
        if (body.name != null && target === seat) target.name = cleanName(body.name, seat.name);
        room.updated = Date.now();
        broadcast(room, 'lobby', lobbyInfo(room));
        persist(room);
        return res(200, { ok: true });
      }
      if (action === 'start') {
        if (!seat.host) return res(403, { ok: false, error: 'Nur der Gastgeber kann starten.' });
        if (room.phase === 'play') return res(409, { ok: false, error: 'Läuft schon' });
        var open = room.seats.filter(function (s) { return s.kind === 'human' && !s.token; });
        if (open.length) return res(409, { ok: false, error: 'Es fehlen noch ' + open.length + ' Mitspieler.' });
        startGame(room);
        log('Raum ' + room.code + ': Spiel ' + room.gameNo + ' gestartet');
        return res(200, { ok: true });
      }
      if (action === 'cmd') {
        if (room.phase !== 'play' || !room.game) return res(409, { ok: false, error: 'Kein laufendes Spiel', resync: true });
        // Doppelt gesendet (Antwort ging verloren)? Dann dasselbe Ergebnis zurückgeben
        if (body.cid) {
          var dup = room.log.find(function (e) { return e.cid === body.cid && e.slot === seat.slot; });
          if (dup && body.gameNo === room.gameNo) return res(200, { ok: true, seq: dup.seq, hash: dup.hash, duplicate: true });
        }
        if (body.gameNo !== room.gameNo || body.base !== room.seq) return res(409, { ok: false, error: 'Nicht synchron', resync: true });
        var cmd = body.cmd || {};
        if (cmd.t === 'ai') {
          // Abwesenden Mitspieler durch KI ersetzen (nur Gastgeber)
          if (!seat.host) return res(403, { ok: false, error: 'Nur der Gastgeber' });
          if (onlineSlots(room).indexOf(cmd.slot) >= 0) return res(409, { ok: false, error: 'Der Spieler ist online.' });
        }
        var ar = applyAndLog(room, seat.slot, cmd, body.cid);
        if (!ar.ok) return res(409, { ok: false, error: ar.error, resync: true });
        scheduleAI(room);
        return res(200, ar);
      }
      if (action === 'chat') {
        var text = String(body.text || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 140);
        if (!text) return res(400, { ok: false });
        broadcast(room, 'chat', { slot: seat.slot, name: seat.name, text: text, at: Date.now() });
        return res(200, { ok: true });
      }
      if (action === 'rematch') {
        if (!seat.host) return res(403, { ok: false, error: 'Nur der Gastgeber' });
        if (room.phase === 'play' && room.game && !room.game.over) return res(409, { ok: false, error: 'Spiel läuft noch' });
        room.phase = 'lobby'; room.game = null; room.log = []; room.seq = 0;
        room.updated = Date.now();
        broadcast(room, 'lobby', lobbyInfo(room));
        persist(room);
        return res(200, { ok: true });
      }
      if (action === 'leave') {
        if (room.phase === 'lobby' && !seat.host) { seat.token = null; seat.name = null; broadcast(room, 'lobby', lobbyInfo(room)); persist(room); }
        else if (room.phase === 'lobby' && seat.host) closeRoom(room);
        return res(200, { ok: true });
      }
      return res(404, { ok: false, error: 'Unbekannte Aktion' });
    }

    // ---------------------------------------------------------------- Speichern / Laden
    function dump(room) {
      return {
        v: 1, code: room.code, created: room.created, updated: room.updated, phase: room.phase, gameNo: room.gameNo,
        setup: room.setup, seats: room.seats, seq: room.seq, log: room.log.slice(-400), startEvents: room.startEvents,
        state: room.game ? room.game.serialize() : null
      };
    }
    function load(d) {
      var room = {
        code: d.code, created: d.created, updated: d.updated, phase: d.phase, gameNo: d.gameNo, setup: d.setup, seats: d.seats,
        game: d.state ? G.Game.load(d.state) : null, seq: d.seq, log: d.log || [], startEvents: d.startEvents, clients: new Set(), aiRunning: false
      };
      rooms.set(room.code, room);
      scheduleAI(room);
      return room;
    }

    return {
      rooms: rooms, handle: handle, stream: stream, createRoom: createRoom, closeRoom: closeRoom,
      lobbyInfo: lobbyInfo, onlineSlots: onlineSlots, applyAndLog: applyAndLog, dump: dump, load: load
    };
  };
})();
