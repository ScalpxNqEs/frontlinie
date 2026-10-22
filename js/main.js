// FRONTLINIE – Start
var G = (typeof globalThis !== 'undefined' ? globalThis : window).G = (globalThis.G || {});
(function () {
  'use strict';
  function boot() {
    G.MAPS = G.MAPS || [];
    G.CAMPAIGN = G.CAMPAIGN || [];
    try { if (G.Audio) G.Audio.setVolume(G.UI.settings.music, G.UI.settings.sfx); } catch (e) { /* ignore */ }
    G.Play.init();
    if (G.App) G.App.register();
    if (location.hash === '#demo-pionier') { demoPionier(); return; }
    if (location.hash === '#demo-kampf') { demoKampf(); return; }
    if (location.hash === '#app' && G.UI.showPhoneApp) { history.replaceState(null, '', location.pathname); G.UI.showPhoneApp(); return; }
    if (location.hash === '#online' && G.UI.showOnline) { history.replaceState(null, '', location.pathname); G.UI.showOnline(); return; }
    var pm = /^#p2p=([A-Za-z0-9]{5})$/.exec(location.hash);
    if (pm && G.P2P && G.P2P.resume) { G.P2P.resume(pm[1]); return; }
    var jm = /^#join=([A-Za-z0-9]{5})$/.exec(location.hash);
    if (jm && G.UI.showJoin) { G.UI.showJoin(jm[1]); return; }
    G.UI.showTitle();
  }
  // Testszenario: Pionier, Bergepanzer, Flugzeugträger nebeneinander (für Bedienungstests)
  function demoPionier() {
    var rows = [];
    for (var y = 0; y < 12; y++) {
      var r = '';
      for (var x = 0; x < 16; x++) r += (y >= 9 ? 'S.' : (x === 1 && y === 1) ? 'Q1' : (x === 14 && y === 1) ? 'Q2' : (x === 2 && y === 1) ? 'K1' : 'P.');
      rows.push(r);
    }
    G.Play.startNew({
      map: { id: 'demo', name: 'Pionier-Test', players: 2, rows: rows,
        units: [['pionier', 4, 4, 1], ['bergepanzer', 6, 4, 1], ['tank', 7, 4, 1, 4], ['carrier', 5, 9, 1], ['gunship', 5, 8, 1], ['inf', 13, 6, 2]] },
      players: [{ slot: 1, faction: 'red', co: 'rika' }, { slot: 2, faction: 'blue', co: 'bastian', ai: true }],
      fog: true, funds: 30000, meta: { mode: 'skirmish', vision: 'erkundung', weatherMode: 'klar' }
    });
  }
  // Testszenario: Panzer gegen Panzer im Wald (Kampfszene mit Gegenschlag)
  function demoKampf() {
    var rows = [];
    for (var y = 0; y < 10; y++) {
      var r = '';
      for (var x = 0; x < 14; x++) r += (x === 1 && y === 1) ? 'Q1' : (x === 12 && y === 8) ? 'Q2' : (x === 6 && y === 4) ? 'F.' : (y === 4 ? 'R.' : 'P.');
      rows.push(r);
    }
    G.Play.startNew({
      map: { id: 'demo-kampf', name: 'Kampf-Test', players: 2, rows: rows, units: [['tank', 5, 4, 1], ['tank', 6, 4, 2], ['inf', 2, 2, 1], ['inf', 11, 7, 2]] },
      players: [{ slot: 1, faction: 'red', co: 'rika' }, { slot: 2, faction: 'blue', co: 'bastian', ai: true }],
      fog: false, funds: 0, meta: { mode: 'skirmish', vision: 'offen', weatherMode: 'klar' }
    });
  }
  window.addEventListener('error', function (ev) {
    try { G.UI.toast('Fehler: ' + (ev.message || ev.error)); } catch (e) { /* ignore */ }
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
