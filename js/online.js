// FRONTLINIE – Online-Gefecht: Verbindung zum Spielserver, Lobby, Beitreten per Link/QR-Code
var G = (typeof globalThis !== 'undefined' ? globalThis : window).G = (globalThis.G || {});
(function () {
  'use strict';
  var UI = G.UI, h = UI.h, $ = UI.$, Store = UI.Store;
  var Net = G.Net = { s: null, info: null };

  // ================================================================ Transport
  // Übertragungsweg: HTTP/SSE zum PC-Server (Standard) oder – mit s.tr – direkt zwischen Handys (js/p2p.js)
  function api(p, body) {
    var tr = Net.s && Net.s.tr;
    return tr ? tr.api(p, body) : httpApi(p, body);
  }
  function httpApi(p, body) {
    var opt = body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' };
    return fetch(p, opt).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: 'Antwort unlesbar (' + r.status + ')' }; });
    });
  }
  Net.api = api;
  Net.httpApi = httpApi;
  function postRetry(p, body, tries) {
    return api(p, body).catch(function (e) {
      if (tries <= 1) return { ok: false, error: 'Keine Verbindung zum Server', network: true };
      return UI.sleep(Math.min(8000, 700 * Math.pow(2, 6 - tries))).then(function () { return postRetry(p, body, tries - 1); });
    });
  }
  /** Läuft der Spielserver? (nicht bei file://) */
  Net.available = function () {
    if (!/^https?:$/.test(location.protocol)) return Promise.resolve(null);
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    if (ctl) setTimeout(function () { ctl.abort(); }, 3000);
    return fetch('api/info', { cache: 'no-store', signal: ctl ? ctl.signal : undefined })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (i) { Net.info = i && i.game === 'frontlinie' ? i : null; return Net.info; })
      .catch(function () { return null; });
  };
  /** Internet-Adresse am laufenden Server anfordern (nur am PC selbst) */
  Net.startTunnel = function () {
    return fetch('api/tunnel', { method: 'POST', cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (r) { if (Net.info && r && r.ok) Net.info.tunnel = true; return r; })
      .catch(function () { return { ok: false, error: 'Server nicht erreichbar.' }; });
  };
  /** Knopf „Internet-Adresse holen“ bzw. Wartehinweis (nur am PC, solange es keine gibt) */
  UI.tunnelButton = function (info, onChange) {
    if (!info || info.public || !isLocalHost()) return null;
    if (info.tunnel) return h('p', { class: 'hint', text: '🌐 Internet-Adresse wird geholt … (dauert meist 5–15 Sekunden)' });
    return h('button', { class: 'btn primary', text: '🌐 Internet-Adresse holen', onclick: function (ev) {
      ev.target.disabled = true;
      Net.startTunnel().then(function (r) {
        if (!r.ok) UI.toast(r.error || 'Nicht möglich.');
        if (onChange) onChange();
      });
    } });
  };
  Net.name = function () { return Store.get('net:name', ''); };
  Net.setName = function (n) { Store.set('net:name', String(n || '').slice(0, 18)); };
  function sessions() { return Store.get('net:sessions', {}); }
  function rememberSession(code, token, slot) {
    var all = sessions(); all[code] = { token: token, slot: slot, at: Date.now() };
    // nur die letzten 8 behalten
    var keys = Object.keys(all).sort(function (a, b) { return all[b].at - all[a].at; });
    keys.slice(8).forEach(function (k) { delete all[k]; });
    Store.set('net:sessions', all);
  }
  function forgetSession(code) { var all = sessions(); delete all[code]; Store.set('net:sessions', all); }
  Net.sessions = sessions;

  // ================================================================ Sitzung (eine Raum-Verbindung)
  Net.open = function (code, token, slot, tr) {
    Net.close();
    var s = Net.s = {
      tr: tr || null,
      code: code, token: token, slot: slot, host: false, name: '', lobby: null, gameNo: 0,
      received: 0, applied: 0, queue: [], waiter: null, pending: {}, online: [], chain: Promise.resolve(), n: 0,
      connected: false, view: 'connecting', epoch: 0, lastId: null, buffer: null, chat: []
    };
    if (!tr) rememberSession(code, token, slot);
    // Neu laden führt direkt zurück in den Raum
    try { history.replaceState(null, '', location.pathname + location.search + (tr && tr.hash ? tr.hash : '#join=' + code)); } catch (e) { /* egal */ }
    connect(s);
    return s;
  };
  function connect(s) {
    if (s.es) try { s.es.close(); } catch (e) { /* egal */ }
    var url = 'api/rooms/' + s.code + '/stream?token=' + encodeURIComponent(s.token) + (s.lastId ? '&last=' + encodeURIComponent(s.lastId) : '');
    var es = s.es = s.tr ? s.tr.stream(url) : new EventSource(url);
    function on(name, fn) {
      es.addEventListener(name, function (e) {
        if (Net.s !== s) return;
        var d; try { d = JSON.parse(e.data); } catch (err) { return; }
        if (e.lastEventId) s.lastId = e.lastEventId;
        fn(d);
      });
    }
    es.onopen = function () { if (Net.s !== s) return; s.connected = true; Net.hud(); };
    es.onerror = function () {
      if (Net.s !== s) return;
      s.connected = false; Net.hud();
      if (es.readyState === 2) {
        // endgültig abgelehnt (Raum weg / kein Platz) oder Server aus
        api('api/rooms/' + s.code).then(function (r) {
          if (Net.s !== s) return;
          if (r && r.ok === false && /gibt es nicht/.test(r.error || '')) {
            var home = Net.home(); forgetSession(s.code); Net.close(); G.Play.stop();
            UI.alert(r.error).then(home);
          } else setTimeout(function () { if (Net.s === s && s.es === es) connect(s); }, 3000);
        }).catch(function () { setTimeout(function () { if (Net.s === s && s.es === es) connect(s); }, 3000); });
      }
    };
    on('hello', function (d) { s.host = d.host; s.name = d.name || ''; s.connected = true; Net.hud(); });
    on('lobby', function (d) {
      s.lobby = d;
      s.online = d.seats.filter(function (x) { return x.online; }).map(function (x) { return x.slot; });
      if (d.phase === 'lobby') {
        if (s.view !== 'lobby') { s.view = 'lobby'; var st = G.Play.state(); if (st && st.net) G.Play.stop(); UI.showLobby(); }
        else if (s.renderLobby) s.renderLobby();
      } else if (s.renderLobby) s.renderLobby();
      Net.hud();
    });
    on('start', function (d) {
      s.gameNo = d.gameNo; s.received = s.applied = 0; s.queue = []; s.pending = {}; s.view = 'game';
      G.Play.startNet(d.state, { fresh: true, startEvents: d.startEvents, net: s });
    });
    on('state', function (d) {
      var st = G.Play.state();
      if (s.view === 'game' && st && st.net === s && s.gameNo === d.gameNo && s.applied === d.seq && !s.queue.length && st.game.stateHash() === d.hash) return;
      s.gameNo = d.gameNo; s.received = s.applied = d.seq; s.queue = []; s.pending = {}; s.view = 'game';
      G.Play.startNet(d.state, { fresh: false, net: s });
    });
    on('cmd', onCmd.bind(null, s));
    on('presence', function (d) { s.online = d.online || []; if (s.renderLobby) s.renderLobby(); Net.hud(); });
    on('chat', function (d) {
      s.chat.push(d); if (s.chat.length > 30) s.chat.shift();
      UI.toast('💬 ' + (d.name || G.FACTIONS[factionOfSlot(s, d.slot)].name) + ': ' + d.text, 4500);
      if (d.slot !== s.slot) UI.sfx('menu');
    });
    on('closed', function (d) {
      var home = Net.home(); forgetSession(s.code); if (s.tr && s.tr.onClosed) s.tr.onClosed(s); Net.close();
      var st = G.Play.state(); if (st && st.net) G.Play.stop();
      UI.alert(d.reason || 'Raum geschlossen.').then(home);
    });
  }
  function onCmd(s, d) {
    if (d.gameNo !== s.gameNo) return;
    if (s.buffer) { s.buffer.push(d); return; }
    if (d.seq <= s.received) { delete s.pending[d.cid]; return; }
    if (d.seq !== s.received + 1) { Net.resync('Befehl ' + (s.received + 1) + ' fehlt'); return; }
    s.received = d.seq;
    s.queue.push(d);
    wake(s);
  }
  function wake(s) {
    if (s.waiter && s.queue.length) { var w = s.waiter; s.waiter = null; w(s.queue.shift()); }
  }
  /** Nächsten fremden Befehl abwarten (Spielablauf) */
  Net.next = function () {
    var s = Net.s;
    if (!s) return Promise.resolve(null);
    if (s.queue.length) return Promise.resolve(s.queue.shift());
    return new Promise(function (r) { s.waiter = r; });
  };
  Net.cancelWait = function () {
    var s = Net.s;
    if (s && s.waiter) { var w = s.waiter; s.waiter = null; w(null); }
  };
  /** Fremder Befehl wurde lokal ausgeführt: Prüfsumme vergleichen */
  Net.done = function (m, game) {
    var s = Net.s; if (!s) return;
    s.applied = m.seq;
    if (m.hash && game.stateHash() !== m.hash) Net.resync('Prüfsumme weicht ab');
  };
  /** Eigener Befehl wurde lokal ausgeführt: an den Server schicken */
  Net.send = function (cmd, game) {
    var s = Net.s; if (!s) return;
    var base = s.received, epoch = s.epoch, gameNo = s.gameNo;
    s.received++; s.applied = s.received;
    var cid = s.slot + '.' + Date.now().toString(36) + '.' + (++s.n);
    var hash = game.stateHash();
    s.pending[cid] = 1;
    s.chain = s.chain.then(function () {
      if (Net.s !== s || s.epoch !== epoch) return;
      return postRetry('api/rooms/' + s.code + '/cmd', { token: s.token, gameNo: gameNo, base: base, cid: cid, cmd: cmd }, 6).then(function (res) {
        if (Net.s !== s || s.epoch !== epoch) return;
        if (!res || !res.ok) { Net.resync(res && res.error || 'Server lehnt ab'); return; }
        if (res.hash !== hash) Net.resync('Prüfsumme nach eigenem Zug');
      });
    });
  };
  /** Befehl ohne lokale Ausführung (z. B. Übergabe an KI) – kommt über den Server zurück */
  Net.request = function (cmd) {
    var s = Net.s; if (!s) return Promise.resolve({ ok: false });
    return api('api/rooms/' + s.code + '/cmd', { token: s.token, gameNo: s.gameNo, base: s.received, cid: s.slot + '.r' + Date.now().toString(36), cmd: cmd });
  };
  Net.resync = function (reason) {
    var s = Net.s; if (!s || s.buffer) return;
    console.warn('[Netz] Abgleich mit dem Server:', reason);
    s.buffer = []; s.epoch++;
    api('api/rooms/' + s.code + '/state?token=' + encodeURIComponent(s.token)).then(function (d) {
      if (Net.s !== s) return;
      var buf = s.buffer; s.buffer = null;
      if (!d || !d.ok) { UI.toast('Abgleich fehlgeschlagen: ' + ((d && d.error) || '?')); return; }
      s.gameNo = d.gameNo; s.received = s.applied = d.seq; s.queue = []; s.pending = {}; s.lastId = d.gameNo + ':' + d.seq; s.view = 'game';
      UI.toast('Spielstand mit dem Server abgeglichen.');
      G.Play.startNet(d.state, { fresh: false, net: s, resync: true });
      buf.forEach(function (m) { onCmd(s, m); });
    }).catch(function () { s.buffer = null; setTimeout(function () { Net.resync(reason); }, 3000); });
  };
  Net.close = function () {
    var s = Net.s;
    if (!s) return;
    Net.cancelWait();
    try { s.es && s.es.close(); } catch (e) { /* egal */ }
    Net.s = null;
    Net.hud();
  };
  /** Raum verlassen. full: Platz freigeben (Lobby) bzw. Raum schließen (Gastgeber in Lobby) */
  Net.leave = function (full) {
    var s = Net.s; if (!s) return Promise.resolve();
    var p = full ? api('api/rooms/' + s.code + '/leave', { token: s.token }).catch(function () {}) : Promise.resolve();
    if (full && s.lobby && s.lobby.phase === 'lobby') forgetSession(s.code);
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* egal */ }
    Net.close();
    return p;
  };
  Net.chat = function (text) {
    var s = Net.s; if (!s || !text) return;
    api('api/rooms/' + s.code + '/chat', { token: s.token, text: text }).catch(function () { UI.toast('Nachricht nicht gesendet.'); });
  };
  Net.rematch = function () {
    var s = Net.s; if (!s) return;
    api('api/rooms/' + s.code + '/rematch', { token: s.token }).then(function (r) { if (!r.ok) UI.toast(r.error || 'Nicht möglich'); });
  };
  /** Zurück zum passenden Menü (Online-Gefecht oder Handy zu Handy) */
  Net.home = function () {
    var tr = Net.s && Net.s.tr;
    return tr && tr.home ? tr.home : UI.showOnline;
  };
  /** Ereignisstrom neu öffnen (z. B. nach neuer Handy-Verbindung) */
  Net.reconnect = function () { if (Net.s) connect(Net.s); };
  Net.isOnline = function (slot) { return !!(Net.s && Net.s.online.indexOf(slot) >= 0); };
  function factionOfSlot(s, slot) {
    var seat = s.lobby && s.lobby.seats.filter(function (x) { return x.slot === slot; })[0];
    return seat ? seat.faction : 'neutral';
  }

  // ================================================================ Status im Spiel
  Net.hud = function () {
    var hud = $('#hud'); if (!hud) return;
    var el = $('#net-status');
    var st = G.Play && G.Play.state && G.Play.state();
    var s = Net.s;
    if (!s || !st || st.net !== s) { if (el) el.classList.add('hidden'); return; }
    if (!el) { el = h('div', { id: 'net-status', class: 'panel' }); hud.appendChild(el); }
    el.classList.remove('hidden');
    var g = st.game, cp = g.currentPlayer();
    var dots = g.players.map(function (p) {
      var on = p.ai || s.online.indexOf(p.slot) >= 0;
      return '<span class="nd' + (on ? '' : ' off') + (p.slot === cp.slot ? ' cur' : '') + '" style="--c:' + G.FACTIONS[p.faction].colors[1] + '" title="' +
        UI.esc(p.name) + (p.ai ? ' (KI)' : on ? ' (online)' : ' (getrennt)') + '"></span>';
    }).join('');
    var txt;
    if (!s.connected) txt = '<b class="warn">Verbindung weg – verbinde neu …</b>';
    else if (g.over) txt = 'Spiel beendet';
    else if (cp.slot === s.slot) txt = '<b>Du bist am Zug</b>';
    else if (cp.ai) txt = UI.esc(cp.name) + ' (KI) zieht …';
    else txt = 'Warte auf ' + UI.esc(cp.name) + (s.online.indexOf(cp.slot) < 0 ? ' <b class="warn">(getrennt)</b>' : ' …');
    el.innerHTML = '<span class="code">' + s.code + '</span>' + dots + '<span class="txt">' + txt + '</span>';
  };

  // ================================================================ Bildschirme
  function nameInput(onChange) {
    var inp = h('input', { type: 'text', maxlength: '18', placeholder: 'Dein Name', value: Net.name() || '', class: 'text-in' });
    inp.addEventListener('change', function () { Net.setName(inp.value.trim()); if (onChange) onChange(inp.value.trim()); });
    return inp;
  }
  function serverMissing(wrap) {
    var p = h('div', { class: 'panel online-help' });
    if (!isLocalHost() && /^https?:$/.test(location.protocol)) {
      p.innerHTML = '<h3>Keine Verbindung zum PC</h3>' +
        '<p>' + (G.App && G.App.standalone() ? 'Die installierte App spielt offline (Kampagne, Gefecht, abwechselnd auf einem Handy). ' : '') +
        'Fürs Online-Gefecht braucht es den PC als Server – und dessen Internet-Adresse ist bei jedem Start eine andere.</p>' +
        '<ol><li>Am PC <b>„FRONTLINIE (Internet)“</b> starten.</li>' +
        '<li>Am PC im Spiel <b>Online-Gefecht</b> öffnen – dort erscheint ein QR-Code.</li>' +
        '<li>Den QR-Code mit der <b>Handy-Kamera</b> scannen und im Browser öffnen.</li></ol>';
      wrap.appendChild(p);
      return;
    }
    p.innerHTML = '<h3>Spielserver nicht gefunden</h3>' +
      '<p>Für Online-Spiele muss FRONTLINIE über den mitgelieferten Server laufen (nicht per Doppelklick auf <code>index.html</code>).</p>' +
      '<ol><li>Terminal im Spielordner öffnen</li><li><code>./start.sh</code> ausführen</li>' +
      '<li>Das Spiel öffnet sich im Browser – dann hier „Online-Gefecht“ wählen.</li></ol>' +
      '<p>Mitspieler öffnen den Einladungslink oder scannen den QR-Code mit dem Handy.</p>';
    wrap.appendChild(p);
  }

  /** Online-Hauptmenü */
  UI.showOnline = function () {
    UI.music('menu');
    UI.screen('online', function (wrap) {
      wrap.appendChild(h('h2', { text: 'ONLINE-GEFECHT' }));
      var body = h('div', {}, [h('p', { text: 'Verbinde mit dem Spielserver …' })]);
      wrap.appendChild(body);
      var acts = h('div', { class: 'actions' }, [h('button', { class: 'btn', text: 'Zurück', onclick: function () { UI.sfx('cancel'); UI.showTitle(); } })]);
      wrap.appendChild(acts);
      Net.available().then(function (info) {
        body.innerHTML = '';
        if (!info) { serverMissing(body); return; }
        var panel = h('div', { class: 'panel online-menu' });
        var nm = nameInput();
        panel.appendChild(h('label', { class: 'field' }, [h('span', { text: 'Dein Name' }), nm]));
        panel.appendChild(h('div', { class: 'big-choices' }, [
          h('button', { class: 'btn primary big', onclick: function () { if (!nm.value.trim()) { nm.focus(); UI.toast('Bitte gib einen Namen ein.'); return; } Net.setName(nm.value.trim()); UI.showSkirmish({ online: true }); } }, [
            h('b', { text: 'Raum eröffnen' }), h('small', { text: 'Karte wählen, Mitspieler per Link oder QR-Code einladen' })]),
          (function () {
            var code = h('input', { type: 'text', maxlength: '5', placeholder: 'CODE', class: 'text-in code-in', autocapitalize: 'characters', autocomplete: 'off' });
            function go() {
              var c = code.value.trim().toUpperCase();
              if (!/^[A-Z0-9]{5}$/.test(c)) { UI.toast('Der Raumcode hat 5 Zeichen.'); code.focus(); return; }
              if (nm.value.trim()) Net.setName(nm.value.trim());
              UI.showJoin(c);
            }
            code.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') go(); });
            return h('div', { class: 'btn big join-box' }, [h('b', { text: 'Raum beitreten' }), h('small', { text: 'Code vom Gastgeber eingeben' }),
              h('div', { class: 'row' }, [code, h('button', { class: 'btn primary', text: 'Los', onclick: go })])]);
          })()
        ]));
        body.appendChild(panel);
        // Frühere Räume
        var sess = sessions(), codes = Object.keys(sess).sort(function (a, b) { return sess[b].at - sess[a].at; });
        if (codes.length) {
          var list = h('div', { class: 'panel' }, [h('h3', { text: 'Deine Räume' })]);
          body.appendChild(list);
          codes.forEach(function (c) {
            httpApi('api/rooms/' + c).then(function (r) {
              if (!r.ok) { forgetSession(c); return; }
              var phase = r.phase === 'lobby' ? 'Lobby' : r.phase === 'play' ? 'Spiel läuft' : 'Spiel beendet';
              list.appendChild(h('div', { class: 'room-row' }, [
                h('span', { class: 'code', text: c }), h('span', { text: r.map.name + ' · ' + phase }),
                h('button', { class: 'btn primary', text: 'Weiter ▶', onclick: function () { Net.open(c, sess[c].token, sess[c].slot); } })
              ]));
            }).catch(function () {});
          });
        }
        if (isLocalHost()) { phones = h('div', {}); body.insertBefore(phones, panel); renderPhones(info); }
        if (info.firewall && info.firewall.active && info.firewall.open === false && isLocalHost()) body.appendChild(firewallNote(info));
      });
      // Am PC: QR-Code, mit dem beide Handys direkt ins Online-Gefecht kommen
      var phones = null, lastKey = '', timer = setInterval(function () {
        if (phones) Net.available().then(function (i) { if (i) renderPhones(i); });
      }, 2500);
      function renderPhones(info) {
        var lanOk = !(info.firewall && info.firewall.active && info.firewall.open === false);
        var base = info.public || (lanOk && info.lan && info.lan[0]) || null;
        var key = JSON.stringify([base, info.tunnel]);
        if (key === lastKey) return; lastKey = key;
        phones.innerHTML = '';
        var p = h('div', { class: 'panel invite phones' });
        phones.appendChild(p);
        p.appendChild(h('h3', { text: '📱📱 Mit zwei Handys spielen (der PC ist nur der Server)' }));
        if (!info.public) {
          var tb = UI.tunnelButton(info, function () { lastKey = ''; Net.available().then(function (i) { if (i) renderPhones(i); }); });
          if (tb) { p.appendChild(h('p', { text: 'Hol dir zuerst eine Internet-Adresse – dann klappt es mit jedem Handy, auch über Mobilfunk:' })); p.appendChild(tb); }
        }
        if (!base) return;
        var url = base.replace(/\/?$/, '/') + '#online';
        var qr; try { qr = G.QR.canvas(url, 5); qr.className = 'qr'; } catch (e) { qr = h('div', { text: '(QR nicht möglich)' }); }
        p.appendChild(qr);
        p.appendChild(h('input', { type: 'text', readonly: 'readonly', value: url, class: 'text-in link' }));
        p.appendChild(h('ol', { class: 'steps', html:
          '<li><b>Beide Handys</b> scannen diesen QR-Code mit der Kamera und öffnen den Link im Browser (nicht die installierte App).</li>' +
          '<li><b>Handy 1:</b> Name eingeben → <b>Raum eröffnen</b> → Karte wählen (Platz 1 „Du“, Platz 2 „Mitspieler (Netz)“) → <b>Raum eröffnen</b>.</li>' +
          '<li><b>Handy 2:</b> den 5-stelligen Code von Handy 1 bei <b>Raum beitreten</b> eingeben (oder den QR-Code auf Handy 1 scannen).</li>' +
          '<li>Handy 1 tippt auf <b>Starten</b>. Das Fenster mit dem Server am PC offen lassen.</li>' }));
        p.appendChild(h('p', { class: 'hint', text: info.public ? 'Die Internet-Adresse ist bei jedem Start eine andere – also jedes Mal neu scannen.' : 'Diese Adresse funktioniert nur im selben WLAN.' }));
      }
      return { cleanup: function () { clearInterval(timer); }, onAction: function (a) { if (a === 'b') UI.showTitle(); return true; } };
    });
  };
  function isLocalHost() { return /^(localhost|127\.|\[?::1\]?$)/.test(location.hostname); }
  function firewallNote(info) {
    var p = h('div', { class: 'panel note' });
    p.innerHTML = '<b>Hinweis Firewall:</b> Deine Firewall lässt Handys im WLAN noch nicht zum Spiel durch. Einmalig im Terminal ausführen:' +
      '<pre>' + UI.esc(info.firewall.cmd) + '</pre>' +
      (info.public ? 'Alternativ funktioniert die <b>Internet-Adresse</b> (QR-Code oben) ohne Freigabe.' : 'Alternativ oben auf <b>„Internet-Adresse holen“</b> klicken – die funktioniert ohne Freigabe (auch über Mobilfunk).');
    return p;
  }

  /** Beitreten per Code oder Link (#join=CODE) */
  UI.showJoin = function (code) {
    code = String(code || '').toUpperCase();
    var sess = sessions()[code];
    UI.screen('online', function (wrap) {
      wrap.appendChild(h('h2', { text: 'RAUM ' + code }));
      var body = h('div', { class: 'panel' }, [h('p', { text: 'Lade Raum …' })]);
      wrap.appendChild(body);
      var acts = h('div', { class: 'actions' }, [h('button', { class: 'btn', text: 'Zurück', onclick: function () { UI.showOnline(); } })]);
      wrap.appendChild(acts);
      httpApi('api/rooms/' + code).then(function (r) {
        body.innerHTML = '';
        if (!r.ok) { body.appendChild(h('p', { text: r.error || 'Raum nicht gefunden.' })); return; }
        if (sess) {
          // schon in diesem Raum → direkt weiter
          httpApi('api/rooms/' + code + '/join', { token: sess.token }).then(function (j) {
            if (j.ok) Net.open(code, j.token, j.slot);
            else { forgetSession(code); UI.showJoin(code); }
          });
          body.appendChild(h('p', { text: 'Verbinde …' }));
          return;
        }
        body.appendChild(lobbySummary(r));
        if (r.phase !== 'lobby') { body.appendChild(h('p', { class: 'warn', text: 'Das Spiel in diesem Raum läuft bereits – Beitritt nicht mehr möglich.' })); return; }
        var free = r.seats.filter(function (x) { return x.kind === 'human' && !x.taken; });
        if (!free.length) { body.appendChild(h('p', { class: 'warn', text: 'Alle Plätze sind belegt.' })); return; }
        var nm = nameInput();
        body.appendChild(h('label', { class: 'field' }, [h('span', { text: 'Dein Name' }), nm]));
        var btn = h('button', { class: 'btn primary big-join', text: 'Beitreten ▶', onclick: join });
        acts.appendChild(btn);
        function join() {
          var n = nm.value.trim();
          if (!n) { nm.focus(); UI.toast('Bitte gib einen Namen ein.'); return; }
          Net.setName(n);
          btn.disabled = true;
          httpApi('api/rooms/' + code + '/join', { name: n }).then(function (j) {
            btn.disabled = false;
            if (!j.ok) { UI.alert(j.error || 'Beitritt nicht möglich.'); return; }
            UI.sfx('confirm');
            Net.open(code, j.token, j.slot);
          }).catch(function () { btn.disabled = false; UI.toast('Keine Verbindung zum Server.'); });
        }
        nm.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') join(); });
      }).catch(function () { body.innerHTML = ''; serverMissing(body); });
      return { onAction: function (a) { if (a === 'b') UI.showOnline(); return true; } };
    });
  };
  function lobbySummary(r) {
    var s = r.settings || {};
    var vis = { erkundung: 'Erkundung', nebel: 'Nebel', offen: 'Offene Karte' }[s.vision] || 'Erkundung';
    return h('div', { class: 'lobby-sum', html: '<b>' + UI.esc(r.map.name) + '</b> · ' + r.map.w + '×' + r.map.h + ' · ' + r.map.players + ' Spieler<br>' +
      'Sicht: ' + vis + ' · Wetter: ' + UI.esc((G.WEATHER_MODES && G.WEATHER_MODES[s.weatherMode]) || s.weatherMode || '–') +
      ' · Startkapital ' + UI.fmt(s.funds || 0) + ' G · Einkommen ' + UI.fmt(s.income || 1000) + ' G' + (s.powers === false ? ' · ohne CO-Kräfte' : '') });
  }

  /** Einladungs-Adressen (WLAN / Internet) */
  function inviteOptions(code) {
    var info = Net.info || {}, out = [], seen = {};
    function add(label, base, hint) {
      if (!base) return;
      base = base.replace(/#.*$/, '').replace(/index\.html$/, '');
      if (!/\/$/.test(base)) base += '/';
      if (seen[base]) return; seen[base] = 1;
      out.push({ label: label, url: base + '#join=' + code, hint: hint });
    }
    if (!isLocalHost()) add('Diese Adresse', location.origin + location.pathname, '');
    if (info.public) add('Internet', info.public, 'Funktioniert überall – auch über Mobilfunk.');
    (info.lan || []).forEach(function (u) {
      add('WLAN', u, 'Handy muss im selben WLAN sein.' + (info.tls ? ' Zeigt das Handy „Verbindung ist nicht privat“: auf „Erweitert“ → „Weiter zu …“ tippen (eigenes Zertifikat deines PCs, unbedenklich).' : ''));
    });
    // Reihenfolge: WLAN zuerst, wenn die Firewall offen ist
    var fwBlocks = info.firewall && info.firewall.active && info.firewall.open === false;
    out.sort(function (a, b) {
      function rank(o) { return o.label === 'Diese Adresse' ? 0 : o.label === 'WLAN' ? (fwBlocks && info.public ? 2 : 1) : (fwBlocks ? 1 : 2); }
      return rank(a) - rank(b);
    });
    return out;
  }

  /** Lobby: wartet auf Mitspieler, Kommandantenwahl, Start */
  UI.showLobby = function () {
    var s = Net.s;
    if (!s) { UI.showTitle(); return; }
    UI.music('menu');
    var inviteIdx = 0, infoTimer = null;
    UI.screen('online lobby', function (wrap) {
      var head = h('h2', {});
      var grid = h('div', { class: 'lobby-grid' });
      var left = h('div', { class: 'panel invite' }), right = h('div', { class: 'panel' });
      grid.appendChild(right); grid.appendChild(left);
      var acts = h('div', { class: 'actions' });
      wrap.appendChild(head); wrap.appendChild(grid); wrap.appendChild(acts);
      function renderInvite() {
        left.innerHTML = '';
        if (s.tr) { if (s.tr.invitePanel) left.appendChild(s.tr.invitePanel(s)); return; }
        left.appendChild(h('h3', { text: 'Mitspieler einladen' }));
        var opts = inviteOptions(s.code);
        if (!opts.length) { left.appendChild(h('p', { text: 'Raumcode: ' + s.code })); return; }
        inviteIdx = Math.min(inviteIdx, opts.length - 1);
        if (opts.length > 1) {
          left.appendChild(h('div', { class: 'tabs' }, opts.map(function (o, i) {
            return h('button', { class: 'btn' + (i === inviteIdx ? ' primary' : ''), text: o.label, onclick: function () { inviteIdx = i; renderInvite(); } });
          })));
        }
        var tb = UI.tunnelButton(Net.info, function () { Net.available().then(renderInvite); });
        if (tb) left.appendChild(tb);
        var o = opts[inviteIdx];
        var qr; try { qr = G.QR.canvas(o.url, 5); qr.className = 'qr'; } catch (e) { qr = h('div', { text: '(QR nicht möglich)' }); }
        left.appendChild(qr);
        left.appendChild(h('div', { class: 'code-big', text: s.code }));
        var link = h('input', { type: 'text', readonly: 'readonly', value: o.url, class: 'text-in link' });
        link.addEventListener('focus', function () { link.select(); });
        left.appendChild(link);
        var row = h('div', { class: 'row' });
        row.appendChild(h('button', { class: 'btn', text: 'Link kopieren', onclick: function () { copy(o.url, link); } }));
        if (navigator.share) row.appendChild(h('button', { class: 'btn', text: 'Teilen …', onclick: function () {
          navigator.share({ title: 'FRONTLINIE', text: 'Spiel mit mir FRONTLINIE! Raum ' + s.code, url: o.url }).catch(function () {});
        } }));
        left.appendChild(row);
        if (o.hint) left.appendChild(h('p', { class: 'hint', text: o.hint + ' Handy-Kamera auf den QR-Code halten.' }));
        var info = Net.info;
        if (s.host && info && info.firewall && info.firewall.active && info.firewall.open === false && isLocalHost() && o.label === 'WLAN') left.appendChild(firewallNote(info));
      }
      function copy(text, input) {
        if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(function () { UI.toast('Link kopiert.'); }, fallback);
        else fallback();
        function fallback() { input.focus(); input.select(); try { document.execCommand('copy'); UI.toast('Link kopiert.'); } catch (e) { UI.toast('Bitte Link markieren und kopieren.'); } }
      }
      function render() {
        var L = s.lobby;
        head.textContent = 'RAUM ' + s.code;
        right.innerHTML = '';
        if (!L) { right.appendChild(h('p', { text: 'Verbinde …' })); return; }
        right.appendChild(lobbySummary(L));
        var my = L.seats.filter(function (x) { return x.slot === s.slot; })[0];
        var nm = nameInput(function (v) { if (v) api('api/rooms/' + s.code + '/seat', { token: s.token, name: v }); });
        if (my && my.name) nm.value = my.name;
        right.appendChild(h('label', { class: 'field' }, [h('span', { text: 'Dein Name' }), nm]));
        var seats = h('div', { class: 'slots' });
        L.seats.forEach(function (seat) {
          var row = h('div', { class: 'slot lobby-seat' + (seat.slot === s.slot ? ' me' : '') });
          var mine = seat.slot === s.slot && L.phase === 'lobby';
          var seatUrl = 'api/rooms/' + s.code + '/seat';
          // Porträt: bei Fusion beide Kommandanten (UI.coPortrait), sonst das einzelne
          var portrait = UI.coPortrait ? UI.coPortrait(seat.co, seat.co2 || null, seat.faction) : UI.portraitCanvas(seat.co, seat.faction);
          row.appendChild(h('button', { class: 'co-pick', title: mine ? 'Kommandanten ansehen und wählen' : 'Kommandant ansehen', onclick: function () {
            if (mine) UI.coSheet(seat.co, { pick: true, faction: seat.faction, title: 'Dein Kommandant' }).then(function (id) {
              if (id && id !== seat.co) api(seatUrl, { token: s.token, co: id });
            });
            else UI.coSheet(seat.co, { only: seat.co, faction: seat.faction, title: (seat.name || 'Mitspieler') + ' – Kommandant' });
          } }, [portrait, h('span', { class: 'co-pick-i', text: 'i' })]));
          var who;
          if (seat.kind === 'ai') who = 'KI ' + (seat.aiLevel || 'normal');
          else if (!seat.taken) who = 'wartet auf Mitspieler …';
          else who = (seat.name || 'Spieler') + (seat.slot === s.slot ? ' (du)' : '');
          var isOn = s.online.indexOf(seat.slot) >= 0 || (seat.slot === s.slot && s.connected);
          var status = seat.kind === 'ai' ? '' : !seat.taken ? '<span class="dot wait"></span>' : isOn ? '<span class="dot on"></span>' : '<span class="dot off"></span>';
          row.appendChild(h('div', { class: 'who', html: status + '<b>' + UI.esc(who) + '</b><br><small>' + UI.esc(G.FACTIONS[seat.faction].name) + ' · Team ' + seat.team + (seat.host ? ' · Gastgeber' : '') + '</small>' }));
          if (mine) {
            var CO_CHOICES = [G.RANDOM_CO].concat(G.CO_ORDER);
            row.appendChild(UI.cycler(CO_CHOICES, Math.max(0, CO_CHOICES.indexOf(seat.co)), function (v) {
              api(seatUrl, { token: s.token, co: v });
            }, function (v) { return v === G.RANDOM_CO ? '🎲 Zufall' : G.COS[v].name; }));
            // Fusion: zweiten Kommandanten wählen bzw. wieder abwählen (Antwort: CO-Id, 'none' oder null)
            var partner = seat.co2 && G.COS[seat.co2] ? G.COS[seat.co2] : null;
            row.appendChild(h('button', { class: 'btn small fusion', text: partner ? 'Fusion: ' + partner.name.split(' ')[0] + ' ✕' : '＋ Fusion',
              title: partner ? 'Fusionspartner wechseln oder entfernen' : 'Mit einem zweiten Kommandanten fusionieren', onclick: function () {
                UI.coSheet(seat.co2 || null, { pick: true, faction: seat.faction, title: 'Fusion – zweiter Kommandant', exclude: seat.co, allowNone: !!seat.co2 }).then(function (id) {
                  if (id === 'none') { if (seat.co2) api(seatUrl, { token: s.token, co2: '' }); }
                  else if (id && G.COS[id] && id !== seat.co && id !== seat.co2) api(seatUrl, { token: s.token, co2: id });
                });
              } }));
          } else {
            var eff = seat.co === G.RANDOM_CO ? null : G.coFor(seat);
            row.appendChild(h('div', { class: 'co-name', text: eff ? eff.name : seat.co === G.RANDOM_CO ? '🎲 Zufall' : seat.co }));
          }
          if (s.host && !seat.host && L.phase === 'lobby') {
            var toAi = seat.kind === 'human';
            row.appendChild(h('button', { class: 'btn small', text: toAi ? '→ KI' : '→ Mitspieler', title: toAi ? 'Platz mit KI besetzen' : 'Platz für Mitspieler öffnen', onclick: function () {
              var go = function () { api('api/rooms/' + s.code + '/seat', { token: s.token, slot: seat.slot, kind: toAi ? 'ai' : 'human', aiLevel: 'normal' }); };
              if (toAi && seat.taken) UI.confirm('Mitspieler ' + (seat.name || '') + ' entfernen?').then(function (ok) { if (ok) go(); });
              else go();
            } }));
          }
          seats.appendChild(row);
        });
        right.appendChild(seats);
        acts.innerHTML = '';
        acts.appendChild(h('button', { class: 'btn', text: s.host ? 'Raum schließen' : 'Raum verlassen', onclick: function () {
          UI.confirm(s.host ? 'Raum schließen? Alle Mitspieler werden getrennt.' : 'Raum verlassen?').then(function (ok) {
            if (!ok) return;
            var home = Net.home();
            Net.leave(true).then(function () { home(); });
          });
        } }));
        if (L.phase !== 'lobby') {
          acts.appendChild(h('button', { class: 'btn primary', text: 'Zum Spiel ▶', onclick: function () { s.view = 'connecting'; connect(s); } }));
        } else if (s.host) {
          var open = L.seats.filter(function (x) { return x.kind === 'human' && !x.taken; }).length;
          var offline = L.seats.filter(function (x) { return x.kind === 'human' && x.taken && x.slot !== s.slot && s.online.indexOf(x.slot) < 0; }).length;
          var b = h('button', { class: 'btn primary', text: open ? 'Warte auf ' + open + ' Mitspieler …' : 'Spiel starten ▶', onclick: function () {
            var go = function () {
              b.disabled = true;
              api('api/rooms/' + s.code + '/start', { token: s.token }).then(function (r) { if (!r.ok) { b.disabled = false; UI.alert(r.error || 'Start nicht möglich.'); } });
            };
            if (offline) UI.confirm(offline + ' Mitspieler ist gerade nicht verbunden. Trotzdem starten?').then(function (ok) { if (ok) go(); });
            else go();
          } });
          if (open) b.disabled = true;
          acts.appendChild(b);
        } else acts.appendChild(h('div', { class: 'wait-host', text: 'Der Gastgeber startet das Spiel …' }));
        if (!s.connected) right.appendChild(h('p', { class: 'warn', text: 'Verbindung zum Server unterbrochen – verbinde neu …' }));
      }
      s.renderLobby = render;
      render();
      renderInvite();
      // Internet-Adresse kann nachträglich kommen (Tunnel)
      if (!s.tr) infoTimer = setInterval(function () {
        var before = JSON.stringify(Net.info);
        Net.available().then(function () { if (JSON.stringify(Net.info) !== before) renderInvite(); });
      }, 5000);
      if (!Net.info && !s.tr) Net.available().then(renderInvite);
      return {
        cleanup: function () { clearInterval(infoTimer); if (s.renderLobby === render) s.renderLobby = null; },
        onAction: function (a) { return true; }
      };
    });
  };

  /** Chat im Spiel */
  UI.chatMenu = function () {
    if (!Net.s) return;
    var presets = ['👍 Gut gespielt!', '⏳ Moment, bin gleich zurück', '😅 Autsch!', '🔥 Jetzt geht’s los!', '🤝 Revanche?', '😴 Du bist dran …'];
    var items = presets.map(function (p) { return { label: p, value: p }; });
    items.push({ label: 'Eigener Text …', value: '__own' });
    if (Net.s.chat.length) items.push({ label: 'Verlauf anzeigen', value: '__log' });
    UI.menu(items, {
      title: 'Nachricht',
      onSelect: function (it) {
        if (it.value === '__own') { UI.promptText('Nachricht an alle', '').then(function (t) { if (t) Net.chat(t); }); return; }
        if (it.value === '__log') {
          UI.alert(Net.s.chat.slice(-10).map(function (c) { return (c.name || '?') + ': ' + c.text; }).join('\n'));
          return;
        }
        Net.chat(it.value);
      },
      onCancel: function () {}
    });
  };
  /** Einfaches Texteingabe-Fenster */
  UI.promptText = function (title, value) {
    return new Promise(function (resolve) {
      var inp = h('input', { type: 'text', maxlength: '140', value: value || '', class: 'text-in' });
      var box = h('div', { class: 'prompt-box' }, [h('div', { class: 'panel' }, [
        h('div', { class: 'head', text: title }), inp,
        h('div', { class: 'actions' }, [
          h('button', { class: 'btn', text: 'Abbrechen', onclick: function () { done(null); } }),
          h('button', { class: 'btn primary', text: 'Senden', onclick: function () { done(inp.value.trim()); } })
        ])
      ])]);
      var layer = UI.push({ modal: true, onAction: function (a) { if (a === 'b') done(null); return true; } });
      inp.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') done(inp.value.trim()); else if (ev.key === 'Escape') done(null); });
      $('#overlay').appendChild(box);
      setTimeout(function () { inp.focus(); }, 30);
      function done(v) { if (box.parentNode) box.parentNode.removeChild(box); UI.pop(layer); resolve(v || null); }
    });
  };

  /** Raum aus der Gefecht-Einstellung eröffnen */
  Net.createRoom = function (setup) {
    return httpApi('api/rooms', { setup: setup, name: Net.name() }).then(function (r) {
      if (!r.ok) { UI.alert(r.error || 'Raum konnte nicht eröffnet werden.'); return; }
      UI.sfx('confirm');
      Net.open(r.code, r.token, r.slot);
    }).catch(function () { UI.alert('Keine Verbindung zum Spielserver.'); });
  };

  // Handy kommt aus dem Hintergrund zurück: Verbindung prüfen
  document.addEventListener('visibilitychange', function () {
    var s = Net.s;
    if (!document.hidden && s && s.es && s.es.readyState === 2) connect(s);
  });
})();
