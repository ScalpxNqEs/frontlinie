// FRONTLINIE – Handy-App (PWA): offline speichern, auf dem Startbildschirm installieren
var G = (typeof globalThis !== 'undefined' ? globalThis : window).G = (globalThis.G || {});
(function () {
  'use strict';
  var UI = G.UI, h = UI.h;
  var App = G.App = { prompt: null, reg: null, status: null };

  function isLocalHost() { return /^(localhost|127\.|\[?::1\]?$)/.test(location.hostname); }
  /** Läuft die Seite als installierte App (Startbildschirm-Symbol)? Dort hat sie einen eigenen Speicher. */
  App.standalone = function () {
    try { return window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true; }
    catch (e) { return false; }
  };
  App.isIOS = function () { return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); };
  App.canOffline = function () { return 'serviceWorker' in navigator && window.isSecureContext && /^https?:$/.test(location.protocol); };

  // Android/Chrome: Installationsangebot merken, um es per Knopf auszulösen
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); App.prompt = e; if (App.onChange) App.onChange(); });
  window.addEventListener('appinstalled', function () { App.prompt = null; UI.toast('FRONTLINIE ist installiert.'); if (App.onChange) App.onChange(); });

  // Fortschrittsmeldungen des Service Workers (kommen auch an, solange die Seite noch nicht von ihm kontrolliert wird)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', function (e) {
      var d = e.data;
      if (!d || d.type !== 'status') return;
      App.status = d;
      if (App.onProgress) App.onProgress(d);
      if (App.onChange) App.onChange();
    });
    if (navigator.serviceWorker.startMessages) navigator.serviceWorker.startMessages();
  }

  /** Frage an einen Service Worker ('status' | 'fill'); Antwort kommt über einen eigenen Kanal → Promise */
  App.ask = function (sw, type, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var ch = new MessageChannel(), done = false;
      var t = setTimeout(function () { if (!done) { done = true; reject(new Error('keine Antwort')); } }, timeoutMs || 3000);
      ch.port1.onmessage = function (e) { if (!done) { done = true; clearTimeout(t); resolve(e.data); } };
      try { sw.postMessage({ type: type }, [ch.port2]); } catch (e) { done = true; clearTimeout(t); reject(e); }
    });
  };
  /** Der zuständige Service Worker (aktiv, wartend oder gerade installierend) oder null */
  App.worker = function () {
    if (!App.canOffline()) return Promise.resolve(null);
    return navigator.serviceWorker.getRegistration().then(function (reg) { return (reg && (reg.active || reg.waiting || reg.installing)) || null; }).catch(function () { return null; });
  };
  /** Fehlende Dateien sofort nachladen lassen */
  App.fill = function () {
    return App.worker().then(function (sw) { return sw ? App.ask(sw, 'fill') : null; }).catch(function () { return null; });
  };

  /** Service Worker anmelden (nicht am PC selbst – dort stört der Zwischenspeicher beim Entwickeln) */
  App.register = function () {
    if (!App.canOffline() || isLocalHost()) return;
    navigator.serviceWorker.register('sw.js').then(function (reg) {
      App.reg = reg;
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
      if (App.onChange) navigator.serviceWorker.ready.then(App.onChange);
    }).catch(function (e) {
      console.warn('[App] Offline-Speicher nicht möglich:', e && e.message);
    }).then(function () {
      // Vom Startbildschirm gestartet? Dann hat die App einen eigenen, anfangs leeren Speicher → Fortschritt zeigen
      if (App.standalone()) App.firstStart();
    });
  };

  /** Sind alle Dateien offline gespeichert? → { ok, registered, state, version, files, total, failed, busy, why } */
  App.offlineStatus = function () {
    if (!App.canOffline() || typeof caches === 'undefined') return Promise.resolve({ ok: false, why: 'kein sicherer Kontext' });
    return navigator.serviceWorker.getRegistration().then(function (reg) {
      var sw = reg && (reg.active || reg.waiting || reg.installing);
      if (!sw) return { ok: false, registered: !!reg, state: 'keiner', files: 0 };
      return App.ask(sw, 'status').then(function (st) {
        return { ok: !!reg.active && st.cached >= st.total, registered: true, state: sw.state, version: st.version,
          files: st.cached, total: st.total, failed: st.failed || 0, busy: !!st.busy };
      }, function () { return legacyStatus(reg, sw); });
    }).catch(function (e) { return { ok: false, why: e && e.message }; });
  };
  // Älterer Service Worker ohne Statuskanal: Einträge im Speicher zählen
  function legacyStatus(reg, sw) {
    return caches.keys().then(function (keys) {
      var k = keys.filter(function (x) { return x.indexOf('frontlinie-') === 0; }).sort().pop();
      if (!k) return { ok: false, registered: true, state: sw.state, files: 0 };
      return caches.open(k).then(function (c) { return c.keys(); }).then(function (entries) {
        return { ok: !!reg.active && entries.length > 20, registered: true, state: sw.state, version: k.slice(11), files: entries.length };
      });
    });
  }

  /** Fortschrittsbalken (n von total) */
  function progressBar(n, total) {
    var pct = total ? Math.round(100 * n / total) : 0;
    var bar = h('div', { class: 'progress', style: { height: '14px', border: '2px solid #181018', borderRadius: '7px', background: '#e9e2cc', overflow: 'hidden', margin: '8px auto', maxWidth: '420px' } });
    bar.appendChild(h('div', { style: { width: pct + '%', height: '100%', background: '#40b030', transition: 'width .3s' } }));
    return bar;
  }

  /** Erststart als installierte App: Hinweis und Fortschritt zeigen, bis alles auf dem Gerät liegt */
  App.firstStart = function () {
    if (App.firstStartActive) return;
    App.firstStartActive = true;
    var box = null, started = Date.now(), timer = null, lastFill = 0, hidden = false, finishing = false, pending = false;
    var hintStyle = { fontSize: '13px', opacity: '.85', marginTop: '4px' };
    function el() {
      if (box) return box;
      box = h('div', { id: 'app-first-start', class: 'panel dark', style: { position: 'fixed', left: '12px', right: '12px', maxWidth: '520px', margin: '0 auto',
        bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))', zIndex: '80', textAlign: 'center', fontSize: '15px', lineHeight: '1.45', cursor: 'pointer' },
        onclick: function () { if (finishing) remove(); else { hidden = true; box.style.display = 'none'; } } });
      document.body.appendChild(box);
      return box;
    }
    function remove() { if (box && box.parentNode) box.parentNode.removeChild(box); box = null; stop(); }
    function stop() { if (timer) clearInterval(timer); timer = null; App.onProgress = null; }
    function render(st) {
      var b = el(); b.innerHTML = '';
      if (st.ok) {
        b.appendChild(h('div', { html: '<b>✓ Fertig</b> – FRONTLINIE läuft jetzt auch ohne PC und ohne Internet.' }));
        b.appendChild(h('div', { style: hintStyle, text: 'Nutze ab jetzt immer dieses App-Symbol – Spielstände sind hier getrennt vom Browser. (Antippen blendet aus.)' }));
        return;
      }
      var total = st.total || 0, n = st.files || 0;
      b.appendChild(h('div', { html: '<b>Spiel wird aufs Handy geladen …</b>' }));
      b.appendChild(progressBar(n, total));
      b.appendChild(h('div', { text: (total ? n + '/' + total + ' Dateien' : 'Verbinde mit dem PC …') + ' – bitte nicht schließen' }));
      var stuck = !st.busy && Date.now() - started > 20000;
      if (st.failed || stuck) {
        b.appendChild(h('div', { style: hintStyle, text: (st.failed ? st.failed + ' Datei(en) fehlen noch – es wird weiter versucht. ' : '') +
          'Läuft das Spiel am PC noch? Seine Internet-Adresse wechselt bei jedem PC-Start – dann die App am PC über „Handy-App“ neu installieren.' }));
      }
    }
    function tick() {
      if (pending) return; pending = true;
      App.offlineStatus().then(function (st) {
        pending = false;
        if (st.ok) {
          if (!box) { stop(); return; }                   // war schon komplett – nichts anzeigen
          if (finishing) return;
          finishing = true; render(st); box.style.display = '';
          stop(); setTimeout(remove, 8000);
          return;
        }
        if (!hidden) render(st);
        // Hängt das Laden (Fehler, nichts in Arbeit)? Dann nachladen lassen, aber höchstens alle 8 s
        if (!st.busy && st.failed && Date.now() - lastFill > 8000) { lastFill = Date.now(); App.fill(); }
      }).catch(function () { pending = false; });
    }
    App.onProgress = function () { tick(); };
    tick();
    timer = setInterval(tick, 1500);
  };

  /** Bildschirm „Handy-App“ */
  UI.showPhoneApp = function () {
    UI.music('menu');
    var timer = null, opened = Date.now(), lastFill = 0;
    UI.screen('online phone-app', function (wrap) {
      wrap.appendChild(h('h2', { text: 'HANDY-APP' }));
      var body = h('div', {});
      wrap.appendChild(body);
      wrap.appendChild(h('div', { class: 'actions' }, [h('button', { class: 'btn', text: 'Zurück', onclick: function () { UI.showTitle(); } })]));
      var last = '';
      function render() {
        if (isLocalHost()) renderPc(); else renderPhone();
      }
      // ---- Am PC: QR-Code zur Internet-Adresse zeigen
      function renderPc() {
        G.Net.available().then(function (info) {
          var key = JSON.stringify(info && [info.public, info.tunnel]);
          if (key === last) return; last = key;
          body.innerHTML = '';
          var p = h('div', { class: 'panel invite' });
          body.appendChild(p);
          p.appendChild(h('h3', { text: 'FRONTLINIE aufs Handy holen' }));
          if (!info) {
            p.appendChild(h('p', { html: 'Starte das Spiel über <b>Spiel starten</b> im Spielordner (oder „FRONTLINIE“ im App-Menü) – dann erscheint hier ein QR-Code.' }));
            return;
          }
          if (!info.public) {
            p.appendChild(h('p', { html: 'Für die Installation braucht das Handy einmal eine sichere Internet-Adresse. Der QR-Code erscheint hier, sobald sie da ist.' }));
            var tb = UI.tunnelButton(info, function () { last = ''; render(); });
            if (tb) p.appendChild(tb);
            return;
          }
          var url = info.public.replace(/\/?$/, '/') + '#app';
          var qr = G.QR.canvas(url, 5); qr.className = 'qr';
          p.appendChild(qr);
          p.appendChild(h('input', { type: 'text', readonly: 'readonly', value: url, class: 'text-in link' }));
          p.appendChild(h('ol', { class: 'steps', html:
            '<li>QR-Code mit der Handy-Kamera scannen und die Seite öffnen (iPhone: in Safari).</li>' +
            '<li>Warten, bis <b>„✓ Offline gespeichert“</b> erscheint (wenige Sekunden).</li>' +
            '<li><b>Android:</b> „Installieren“ tippen (oder Menü ⋮ → „App installieren“ / „Zum Startbildschirm“).<br>' +
            '<b>iPhone:</b> in Safari „Teilen“ □↑ → „Zum Home-Bildschirm“ → „Hinzufügen“. Dann die App <b>einmal vom neuen Symbol öffnen</b>, ' +
            'solange der PC läuft, und warten, bis <b>„✓ Fertig“</b> erscheint (das Symbol hat einen eigenen Speicher).</li>' +
            '<li>Fertig – FRONTLINIE startet jetzt vom Startbildschirm, auch ohne PC und ohne Internet.</li>' }));
          p.appendChild(h('p', { class: 'hint', text: 'Auf dem Handy immer dieselbe Variante nutzen (App-Symbol oder Browser) – Spielstände und „Deine Spiele“ sind pro Variante getrennt. ' +
            'Diese Adresse wechselt bei jedem PC-Start; eine neuere Version installierst du einfach nochmal über diesen Weg (sie erscheint als neues Symbol).' }));
        });
      }
      // ---- Auf dem Handy: offline speichern & installieren
      function renderPhone() {
        App.offlineStatus().then(function (st) {
          // Hängt das Laden (Fehler, nichts in Arbeit)? Nachladen anstoßen, höchstens alle 8 s
          if (!st.ok && st.failed && !st.busy && Date.now() - lastFill > 8000) { lastFill = Date.now(); App.fill(); }
          var slow = st.state === 'keiner' && Date.now() - opened > 8000;
          var key = JSON.stringify([st, !!App.prompt, App.standalone(), slow]);
          if (key === last) return; last = key;
          body.innerHTML = '';
          var p = h('div', { class: 'panel' });
          body.appendChild(p);
          if (!App.canOffline()) {
            p.appendChild(h('h3', { text: 'Über diese Adresse geht es nicht' }));
            p.appendChild(h('p', { html: 'Zum Installieren braucht das Handy eine sichere Adresse (https mit echtem Zertifikat). ' +
              'Öffne am PC im Spiel <b>Handy-App</b>, klicke auf <b>„Internet-Adresse holen“</b> und scanne dann den QR-Code.' }));
            return;
          }
          var total = st.total || 0, files = st.files || 0;
          if (st.ok) {
            p.appendChild(h('h3', { text: '✓ Offline gespeichert' }));
            p.appendChild(h('p', { text: 'Das ganze Spiel liegt jetzt auf diesem Gerät und läuft ohne PC und ohne Internet.' }));
          } else {
            p.appendChild(h('h3', { text: 'Speichere das Spiel auf dem Handy …' }));
            p.appendChild(progressBar(files, total));
            p.appendChild(h('p', { text: total ? files + ' von ' + total + ' Dateien geladen – bitte die Seite offen lassen.' : 'Einen Moment – alle Spieldateien werden geladen.' }));
            if (st.failed) p.appendChild(h('p', { class: 'hint', text: st.failed + ' Datei(en) konnten gerade nicht geladen werden – es wird weiter versucht. Läuft das Spiel am PC noch?' }));
            if (slow) p.appendChild(h('p', { class: 'hint', text: 'Geht es nicht weiter? Die Seite muss in Safari bzw. Chrome geöffnet sein – nicht im privaten Modus / Inkognito und nicht im Browser einer anderen App.' }));
          }
          p.appendChild(h('p', { class: 'hint', text: 'Status: ' + (st.why || ('Speicher ' + (st.state || '–') + ', ' + files + (total ? ' von ' + total : '') + ' Dateien' + (st.version ? ', Version ' + st.version : ''))) }));
          if (App.standalone()) {
            p.appendChild(h('p', { html: '<b>Du spielst bereits die installierte App.</b> Nutze immer dieses App-Symbol – Spielstände und „Deine Spiele“ sind hier getrennt vom Browser.' }));
          } else if (App.prompt) {
            p.appendChild(h('button', { class: 'btn primary big', onclick: function () {
              var pr = App.prompt; App.prompt = null;
              pr.prompt();
              (pr.userChoice || Promise.resolve()).then(function () { last = ''; render(); });
            } }, [h('b', { text: '📲 Installieren' }), h('small', { text: 'Als App auf den Startbildschirm' })]));
            p.appendChild(h('p', { class: 'hint', text: 'Danach immer das App-Symbol nutzen – Spielstände und „Deine Spiele“ sind pro Variante (App oder Browser) getrennt.' }));
          } else if (App.isIOS()) {
            p.appendChild(h('ol', { class: 'steps', html:
              '<li>Warten, bis oben <b>„✓ Offline gespeichert“</b> steht.</li>' +
              '<li>In <b>Safari</b> unten auf <b>„Teilen“</b> (□↑) tippen → <b>„Zum Home-Bildschirm“</b> → „Hinzufügen“.</li>' +
              '<li><b>Wichtig:</b> Die App jetzt <b>einmal vom neuen Symbol öffnen</b>, solange das Spiel am PC noch läuft, und warten, bis ' +
              '<b>„✓ Fertig“</b> erscheint. Das Symbol hat einen eigenen Speicher – erst danach läuft es ohne PC.</li>' }));
            p.appendChild(h('p', { class: 'hint', text: 'Danach immer das App-Symbol nutzen, nicht Safari: Spielstände und „Deine Spiele“ sind pro Variante getrennt. ' +
              'Die Internet-Adresse wechselt bei jedem PC-Start – eine neuere Version installierst du einfach nochmal über den QR-Code (neues Symbol).' }));
          } else {
            p.appendChild(h('p', { html: 'Im Browser-Menü <b>⋮</b> → <b>„App installieren“</b> bzw. <b>„Zum Startbildschirm hinzufügen“</b> wählen. ' +
              'Danach immer das App-Symbol nutzen – Spielstände sind pro Variante (App oder Browser) getrennt.' }));
          }
          p.appendChild(h('div', { class: 'actions' }, [h('button', { class: 'btn primary', text: 'Jetzt spielen ▶', onclick: function () { UI.showTitle(); } })]));
        });
      }
      App.onChange = function () { last = ''; render(); };
      render();
      timer = setInterval(render, 2000);
      return { cleanup: function () { clearInterval(timer); App.onChange = null; }, onAction: function (a) { if (a === 'b') UI.showTitle(); return true; } };
    });
  };
})();
