// FRONTLINIE – Service Worker: hält das ganze Spiel auf dem Gerät vor (läuft danach ohne PC und ohne Internet).
// Platzhalter werden vom Server (server.js → tools/pwa.js) bzw. von tools/build-web.js ersetzt.
//
// Robust gegen wacklige Verbindungen (Internet-Tunnel, Mobilfunk): Die Dateien werden einzeln geholt – scheitert
// eine, bleiben die anderen trotzdem gespeichert und werden beim nächsten Start nachgeladen. Seitenaufrufe
// (Navigationen) werden immer aus dem Speicher bedient, sobald index.html da ist – so startet die App auch dann,
// wenn die Internet-Adresse des PCs längst gewechselt hat.
'use strict';
var VERSION = '__VERSION__';
var FILES = [/*__FILES__*/];
var PREFIX = 'frontlinie-';
var CACHE = PREFIX + VERSION;
var URLS = FILES.map(abs);                               // absolute Adressen ohne Suchteil
var WANTED = {}; URLS.forEach(function (u) { WANTED[u] = true; });
var INDEX = abs('./index.html');
var PARALLEL = 4;                                        // gleichzeitige Downloads (schonend für den Tunnel)
var RETRY_MS = 30000;                                    // fehlende Dateien frühestens so oft erneut versuchen
var filling = null, lastFill = 0, lastFailed = 0;

function abs(u) { var x = new URL(u, self.location.href); x.search = ''; x.hash = ''; return x.href; }

/** Welche gewünschten Dateien liegen schon im Speicher? → { total, cached, missing[] } */
function inventory(c) {
  return c.keys().then(function (reqs) {
    var have = {};
    reqs.forEach(function (r) { have[abs(r.url)] = true; });
    var missing = URLS.filter(function (u) { return !have[u]; });
    return { total: URLS.length, cached: URLS.length - missing.length, missing: missing };
  });
}
/** Antwort speichern; Umleitungen werden entschärft, weil Browser umgeleitete Antworten für Navigationen ablehnen */
function store(c, url, res) {
  if (!res.redirected) return c.put(url, res);
  return res.blob().then(function (b) { return c.put(url, new Response(b, { status: 200, headers: res.headers })); });
}
function fetchFile(c, url) {
  return fetch(new Request(url, { cache: 'no-cache', credentials: 'same-origin' })).then(function (res) {
    if (!res.ok) throw new Error(url + ' → ' + res.status);
    return store(c, url, res);
  });
}
/** Stand an alle offenen Seiten melden (auch an noch nicht kontrollierte, z. B. beim Erststart) */
function broadcast(part) {
  var msg = message(part);
  return self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then(function (list) {
    list.forEach(function (cl) { cl.postMessage(msg); });
  }).catch(function () { /* egal */ });
}
function message(part) {
  var m = { type: 'status', version: VERSION, total: URLS.length, cached: 0, failed: lastFailed, busy: !!filling };
  Object.keys(part || {}).forEach(function (k) { m[k] = part[k]; });
  m.complete = m.cached >= m.total;
  return m;
}
function status() {
  return caches.open(CACHE).then(inventory).then(function (inv) { return message({ cached: inv.cached }); });
}

/** Fehlende Dateien laden (läuft nie doppelt); Fortschritt wird gemeldet. → { total, cached, failed } */
function fill() {
  if (filling) return filling;
  lastFill = Date.now();
  filling = caches.open(CACHE).then(function (c) {
    return inventory(c).then(function (inv) {
      var queue = inv.missing.slice(), cached = inv.cached, failed = 0, active = 0;
      if (!queue.length) { lastFailed = 0; return { total: inv.total, cached: cached, failed: 0 }; }
      broadcast({ cached: cached, failed: 0, busy: true });
      function lane() {
        var url = queue.shift();
        if (!url) return Promise.resolve();
        active++;
        return fetchFile(c, url).then(function () { cached++; }, function (e) { failed++; console.warn('[sw] nicht geladen:', e && e.message); })
          .then(function () {
            active--;
            lastFailed = failed;
            broadcast({ cached: cached, failed: failed, busy: queue.length > 0 || active > 0 });
            return lane();
          });
      }
      var lanes = []; for (var i = 0; i < PARALLEL; i++) lanes.push(lane());
      return Promise.all(lanes).then(function () { return { total: inv.total, cached: cached, failed: failed }; });
    });
  }).then(function (r) { filling = null; return r; }, function (e) { filling = null; throw e; });
  return filling;
}
/** Nachladen, aber nicht ständig (Seitenaufrufe, Statusanfragen) */
function maybeFill() {
  if (filling) return filling;
  if (Date.now() - lastFill < RETRY_MS) return Promise.resolve();
  return fill();
}

self.addEventListener('install', function (e) {
  var update = !!(self.registration && self.registration.active);   // es läuft schon eine ältere Fassung
  e.waitUntil(fill().then(function (r) {
    return caches.open(CACHE).then(function (c) { return c.match(INDEX); }).then(function (idx) {
      // Ohne Startseite ist nichts gewonnen → Installation abbrechen, der Browser versucht es beim nächsten Start neu.
      if (!idx) throw new Error('index.html nicht ladbar');
      // Aktualisierung: nur komplett umschalten, sonst bleibt die alte, vollständige Fassung aktiv (nächster Versuch
      // beim nächsten Start – schon geladene Dateien bleiben liegen). Erstinstallation: lieber unvollständig als gar
      // nicht; der Rest wird nachgeladen, sobald die Verbindung wieder da ist.
      if (r.failed && update) throw new Error(r.failed + ' Datei(en) fehlen – alte Fassung bleibt aktiv');
      return self.skipWaiting();
    });
  }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf(PREFIX) === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }).then(function () { return status().then(broadcast); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.indexOf('/api/') >= 0) return; // Online-Gefecht & Fremdes direkt
  var key = abs(req.url), storeKey = WANTED[key] ? key : null;
  e.respondWith(caches.open(CACHE).then(function (c) {
    return c.match(key).then(function (hit) {
      if (hit) return hit;
      // Seitenaufruf (egal welcher Pfad oder Hash innerhalb der App): immer die gespeicherte Startseite
      if (req.mode === 'navigate') return c.match(INDEX).then(function (idx) { return idx || through(c, req, storeKey); });
      return through(c, req, storeKey);
    });
  }).catch(function () { return fetch(req); }));
  if (req.mode === 'navigate') e.waitUntil(maybeFill());
});
/** Aus dem Netz holen; gelistete Dateien dabei gleich speichern (heilt Lücken, solange der PC erreichbar ist) */
function through(c, req, storeKey) {
  return fetch(req).then(function (res) {
    if (storeKey && res.ok) store(c, storeKey, res.clone()).catch(function () { /* egal */ });
    return res;
  });
}
// Nachrichten der Seite: 'status' (Stand), 'fill' (sofort nachladen), 'version' (alt). Antwort über den mitgeschickten
// Kanal (MessageChannel) oder an den Absender.
self.addEventListener('message', function (e) {
  var d = e.data, type = d && typeof d === 'object' ? d.type : d;
  if (type !== 'status' && type !== 'fill' && type !== 'version') return;
  var port = e.ports && e.ports[0], src = e.source;
  e.waitUntil(status().then(function (msg) {
    msg.files = msg.total; // alte Form
    if (port) port.postMessage(msg); else if (src) src.postMessage(msg);
    return type === 'fill' ? fill() : maybeFill();
  }).catch(function () { /* egal */ }));
});
