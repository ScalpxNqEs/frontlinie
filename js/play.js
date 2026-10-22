// FRONTLINIE – Spielsteuerung (Kartenansicht, Züge, KI-Ablauf, Animationen)
var G = (typeof globalThis !== 'undefined' ? globalThis : window).G = (globalThis.G || {});

(function () {
  'use strict';
  var UI = G.UI, R = G.Render, h = UI.h, $ = UI.$;
  var TS = 16;
  var P = G.Play = {};

  var ACTION_LABEL = { attack: 'Angriff', capture: 'Einnehmen', join: 'Vereinen', load: 'Einsteigen', unload: 'Absetzen',
    supply: 'Versorgen', dive: 'Tauchen', surface: 'Auftauchen', wait: 'Warten', fortify: 'Befestigen', repair: 'Reparieren' };
  var MOVE_SFX = { foot: 'move_foot', mech: 'move_foot', tread: 'move_tread', tire: 'move_tire', air: 'move_air', ship: 'move_ship', trans: 'move_ship' };

  // Zustand
  var S = null;       // laufende Partie
  var savedPlans = null; // vorgeplante Züge (Online), überleben einen Neuaufbau der Partie
  var canvas, ctx;
  var running = false;

  // ================================================================ Start / Stop
  P.init = function () {
    canvas = $('#map');
    ctx = canvas.getContext('2d');
    bindPointer();
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', function () { setTimeout(resize, 250); });
    if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
    if (typeof ResizeObserver === 'function') new ResizeObserver(function () { resize(); }).observe(canvas);
    resize();
    $('#btn-menu').addEventListener('click', function () { if (S && S.mode === 'free' && !S.busy) openMainMenu(); });
    // Minikarte mit Ein-/Ausklapp-Knopf
    var mbox = h('div', { id: 'minibox', class: 'hidden' });
    var mm = document.createElement('canvas'); mm.id = 'minimap';
    var mt = h('button', { id: 'mini-toggle', title: 'Minikarte ein-/ausklappen (C)', text: '–', onclick: function (ev) { ev.stopPropagation(); if (S) setMini(!S.mini.on); } });
    mbox.appendChild(mm); mbox.appendChild(mt);
    $('#hud').appendChild(mbox); bindMinimap();
    // Einheiten-Knöpfe (Touch): nächste bereite Einheit durchschalten, Auswahl bestätigen
    $('#btn-next').addEventListener('click', function () {
      if (!S || UI.top() !== S.layer) return;
      // Alle Einheiten haben gehandelt? Dann heißt der Knopf „Ende“ und beendet die Runde
      if (isHumanTurn() && S.mode === 'free' && !S.busy && !S.game.readyUnits(S.game.currentPlayer().slot).length) askEndTurn(true);
      else onAction('next');
    });
    $('#btn-eye').addEventListener('click', function () { if (S && UI.top() === S.layer) toggleVision(); });
    $('#btn-pick').addEventListener('click', function () {
      if (!S) return;
      var top = UI.top();
      if (top && top !== S.layer && top.onAction) { top.onAction('a'); return; }
      onAction('a');
    });
    $('#btn-end').addEventListener('click', function () { if (S && S.mode === 'free' && !S.busy && isHumanTurn()) askEndTurn(); });
    $('#btn-back').addEventListener('click', function () {
      if (!S) return;
      var top = UI.top();
      if (top && top !== S.layer && top.onAction) { top.onAction('b'); return; }
      onAction('b');
      updateBackButton();
    });
    $('#btn-chat').addEventListener('click', function () { if (S && S.net) UI.chatMenu(); });
  };
  // Zurück-Knopf (für Touch): nur zeigen, wenn es etwas abzubrechen gibt
  var backShown = null;
  function updateBackButton() {
    var b = $('#btn-back'); if (!b) return;
    var show = !!S && !S.busy && (S.mode === 'move' || S.mode === 'action' || S.mode === 'target' || S.mode === 'pickTile' || S.mode === 'unloadTile' || (S.mode === 'free' && !!S.inspect));
    if (show === backShown) return;
    backShown = show;
    b.classList.toggle('hidden', !show);
  }
  // Bildpuffer immer genau so groß wie die sichtbare Fläche (sonst wird das Bild verzerrt),
  // auf Handys mit doppelter Pixeldichte für scharfe Kanten.
  var DPR = 1;
  function resize() {
    var r = canvas.getBoundingClientRect();
    var cssW = r.width || window.innerWidth, cssH = r.height || window.innerHeight;
    DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    var w = Math.max(1, Math.round(cssW * DPR)), hh = Math.max(1, Math.round(cssH * DPR));
    if (w === canvas.width && hh === canvas.height && (!S || S.dpr === DPR)) return;
    // Kartenmitte merken, damit das Bild beim Drehen nicht springt
    var mid = S ? { x: S.cam.x + canvas.width / (TS * S.scale) / 2, y: S.cam.y + canvas.height / (TS * S.scale) / 2 } : null;
    canvas.width = w; canvas.height = hh;
    if (S) {
      S.dpr = DPR; S.zoomAnim = null;
      computeScale();
      var v = viewTiles();
      S.cam.x = S.camTarget.x = mid.x - v.w / 2; S.cam.y = S.camTarget.y = mid.y - v.h / 2;
      clampCam(true);
    }
  }

  P.stop = function () {
    if (S && S.layer) UI.pop(S.layer);
    var wasNet = S && S.net;
    S = null;
    if (wasNet && G.Net) { G.Net.cancelWait(); G.Net.hud(); }
    document.title = 'FRONTLINIE';
    running = false;
    $('#hud').classList.add('hidden');
    $('#overlay').innerHTML = '';
    UI.layers.length = 0;
  };

  /** Neue Partie. cfg: {map, players, fog, funds, income, meta, objective, seed} */
  P.startNew = function (cfg) {
    var game = G.gameFromSetup(cfg);
    begin(game, true, cfg.intro);
  };

  P.startMission = function (idx) {
    var M = G.CAMPAIGN[idx];
    if (!M) return;
    var players = [];
    players.push({ slot: M.player.slot, faction: M.player.faction, co: M.player.co, ai: false, team: 1 });
    (M.allies || []).forEach(function (a) { players.push({ slot: a.slot, faction: a.faction, co: a.co, ai: true, aiLevel: 'normal', team: a.team || 1 }); });
    (M.enemies || []).forEach(function (e) { players.push({ slot: e.slot, faction: e.faction, co: e.co, ai: true, aiLevel: e.aiLevel || (idx < 3 ? 'leicht' : 'normal'), team: e.team || 2 }); });
    var obj = Object.assign({}, M.objective || { type: 'standard' });
    if (obj.type === 'survive') obj.slot = M.player.slot;
    var map = Object.assign({ id: M.id, name: M.title }, M.map);
    var cfg = { map: map, players: players, fog: !!M.fog, funds: M.funds || 0, objective: obj,
      meta: { mode: 'campaign', mission: idx, missionId: M.id }, intro: M.intro || [] };
    P.startNew(cfg);
  };

  /** Online-Partie aus Server-Zustand starten (neu, fortgesetzt oder nach Abgleich) */
  P.startNet = function (state, opts) {
    var game = G.Game.load(state);
    if (opts.startEvents) game.startEvents = opts.startEvents;
    begin(game, !!opts.fresh, null, opts.net);
  };

  P.loadSave = function (key) {
    var s = UI.Store.get('save:' + key, null);
    if (!s) { UI.toast('Kein Spielstand vorhanden.'); return; }
    try {
      var game = G.Game.load(s.game);
      begin(game, false);
    } catch (e) {
      console.error(e);
      UI.alert('Spielstand konnte nicht geladen werden.');
    }
  };

  function begin(game, fresh, intro, net) {
    UI.clearScreen();
    P.stop();
    S = {
      net: net || null,
      game: game, mode: 'free', busy: false,
      cursor: { x: 0, y: 0 }, cam: { x: 0, y: 0 }, camTarget: { x: 0, y: 0 }, scale: 3, zoomOff: 0, dpr: DPR, zoomAnim: null,
      sel: null, anim: {}, inspect: null, danger: null, dangerOn: false, vision: null, visionOn: false, fresh: fresh,
      viewer: null, lastHuman: null, hudKey: '', layer: null, introPending: intro || null,
      plans: {}, planOrder: [], lastInput: 0
    };
    if (net && savedPlans && savedPlans.code === net.code && savedPlans.slot === net.slot && savedPlans.gameNo === net.gameNo) { S.plans = savedPlans.plans; S.planOrder = savedPlans.order; }
    else if (net) savedPlans = { code: net.code, slot: net.slot, gameNo: net.gameNo, plans: S.plans, order: S.planOrder };
    R.slotFaction = function (slot) { var p = slot && game.playerBySlot(slot); return p ? p.faction : 'neutral'; };
    R.setTheme(game.theme || 'sommer');
    S.terrain = R.buildTerrain(game.map);
    S.mini = { last: 0, on: UI.settings.minimap != null ? !!UI.settings.minimap : (game.map.w > 24 || game.map.h > 24) };
    computeFacing();
    computeScale();
    S.layer = UI.push({ onAction: onAction });
    $('#hud').classList.remove('hidden');
    $('#btn-chat').classList.toggle('hidden', !S.net);
    if (!running) { running = true; requestAnimationFrame(loop); }
    var cp = game.currentPlayer();
    S.lastHuman = humanSlots()[0] || null;
    centerOn(focusPoint(cp.slot), true);
    (async function () {
      if (S.introPending && S.introPending.length) {
        S.busy = true;
        UI.music('briefing');
        await UI.dialog(S.introPending, factionForCo);
        S.introPending = null;
        S.busy = false;
        var M = G.CAMPAIGN[game.meta.mission];
        if (M && M.hint) UI.toast('Ziel: ' + objectiveText(game), 4200);
      }
      if (fresh) await turnStartFlow(game.startEvents || []);
      else await turnStartFlow([{ type: 'turn', slot: cp.slot, day: game.day }], true);
    })();
  }
  function factionForCo(coId) {
    if (!S) return null;
    var p = S.game.players.filter(function (q) { return q.co === coId; })[0];
    return p ? p.faction : (G.COS[coId] && G.COS[coId].faction);
  }
  function objectiveText(game) {
    var o = game.objective;
    if (o.type === 'survive') return 'Halte ' + o.days + ' Tage durch.';
    if (o.type === 'capture') return 'Nimm das markierte Gebäude bei (' + (o.x + 1) + '|' + (o.y + 1) + ') ein.';
    if (o.type === 'rout') return 'Vernichte alle feindlichen Einheiten.';
    return 'Erobere das feindliche HQ oder vernichte alle Gegner.';
  }

  // ================================================================ Hilfen
  function humanSlots() {
    if (S.net) { var me = S.game.playerBySlot(S.net.slot); return me && me.alive ? [me.slot] : []; }
    return S.game.players.filter(function (p) { return !p.ai && p.alive; }).map(function (p) { return p.slot; });
  }
  /** Darf an diesem Gerät gerade gezogen werden? */
  function isHumanTurn() {
    if (!S || S.game.over) return false;
    var cp = S.game.currentPlayer();
    return !cp.ai && (!S.net || cp.slot === S.net.slot);
  }
  function netSend(cmd) { if (S && S.net && G.Net) G.Net.send(cmd, S.game); }
  function computeViewer() {
    var g = S.game;
    if (!g.fog) return null;
    if (S.net) { var me = g.playerBySlot(S.net.slot); return me && me.alive ? me.slot : null; }
    var cp = g.currentPlayer();
    if (!cp.ai) { S.lastHuman = cp.slot; return cp.slot; }
    var hs = humanSlots();
    if (!hs.length) return null;
    // Bei mehreren Menschen: Sicht des letzten aktiven Menschen
    return S.lastHuman && hs.indexOf(S.lastHuman) >= 0 ? S.lastHuman : hs[0];
  }
  function computeFacing() {
    var g = S.game;
    S.facing = {};
    g.players.forEach(function (p) {
      var hq = g.hqOf(p.slot);
      var x = hq ? hq.x : null;
      if (x == null) {
        var us = g.unitsOf(p.slot);
        if (us.length) x = us.reduce(function (a, u) { return a + u.x; }, 0) / us.length;
      }
      S.facing[p.slot] = x != null && x > g.map.w / 2;
    });
  }
  function focusPoint(slot) {
    var g = S.game;
    var ready = g.readyUnits(slot);
    if (ready.length) return { x: ready[0].x, y: ready[0].y };
    var hq = g.hqOf(slot);
    if (hq) return hq;
    var props = g.propertiesOf(slot);
    if (props.length) return props[0];
    return { x: Math.floor(g.map.w / 2), y: Math.floor(g.map.h / 2) };
  }
  function facOf(slot) { var p = S.game.playerBySlot(slot); return p ? p.faction : 'neutral'; }
  function speed() { return UI.settings.aiSpeed; }
  function isAiTurn() { return S && S.game.currentPlayer().ai; }
  function moveDelay() {
    if (isAiTurn()) return speed() === 'instant' ? 0 : speed() === 'fast' ? 25 : 55;
    return 70;
  }

  // ================================================================ Kamera & Zoom
  // Zoom: S.scale = Bildpunkte je Kartenpixel im Bildpuffer (darf beim Zoomen krumm sein),
  // S.zoomOff = Abstand zur Grundstufe in Bildschirm-Einheiten.
  var MIN_ZOOM = 1, MAX_ZOOM = 8;
  function baseScale() {
    var g = S.game, W = canvas.width / S.dpr, H = canvas.height / S.dpr;
    var z = UI.settings.zoom;
    if (z !== 'auto') return +z;
    var sc = Math.floor(Math.min(W / (Math.min(g.map.w, 20) * TS), H / (Math.min(g.map.h, 13) * TS)));
    return Math.max(2, Math.min(6, sc));
  }
  function clampScale(sc) { return Math.max(MIN_ZOOM * S.dpr, Math.min(MAX_ZOOM * S.dpr, sc)); }
  function computeScale() {
    if (!S.dpr) S.dpr = DPR;
    S.scale = clampScale((baseScale() + S.zoomOff) * S.dpr);
  }
  /** Maßstab ändern, ohne dass sich der Kartenpunkt unter (ax, ay) bewegt (Bildpuffer-Koordinaten) */
  function setScaleAt(sc, ax, ay) {
    sc = clampScale(sc);
    var wx = S.cam.x + ax / (TS * S.scale), wy = S.cam.y + ay / (TS * S.scale);
    S.scale = sc;
    S.zoomOff = sc / S.dpr - baseScale();
    S.camTarget.x = wx - ax / (TS * sc); S.camTarget.y = wy - ay / (TS * sc);
    clampCam(true);
  }
  /** Weich auf einen Maßstab gleiten (Tasten, Mausrad, Einrasten nach dem Fingerzoom) */
  function animateScale(target, ax, ay, ms) {
    target = clampScale(target);
    if (Math.abs(target - S.scale) < 0.001) { S.zoomAnim = null; return; }
    S.zoomAnim = { from: S.scale, to: target, ax: ax, ay: ay, t0: performance.now(), ms: ms || 180 };
  }
  function stepZoomAnim(now) {
    var z = S.zoomAnim; if (!z) return;
    var k = Math.min(1, (now - z.t0) / z.ms), e = 1 - Math.pow(1 - k, 3);
    setScaleAt(z.from + (z.to - z.from) * e, z.ax, z.ay);
    if (k >= 1) S.zoomAnim = null;
  }
  /** Auf die nächste ganze (gestochen scharfe) Stufe einrasten */
  function snapScale(ax, ay) { animateScale(Math.round(S.scale), ax, ay, 160); }
  function viewTiles() { return { w: canvas.width / (TS * S.scale), h: canvas.height / (TS * S.scale) }; }
  function clampCam(snap) {
    var v = viewTiles(), g = S.game;
    function cl(val, size, view) {
      if (size <= view) return -(view - size) / 2;
      return Math.max(-0.5, Math.min(size - view + 0.5, val));
    }
    S.camTarget.x = cl(S.camTarget.x, g.map.w, v.w);
    S.camTarget.y = cl(S.camTarget.y, g.map.h, v.h);
    if (snap) { S.cam.x = S.camTarget.x; S.cam.y = S.camTarget.y; }
  }
  function ensureVisible(x, y, margin) {
    var v = viewTiles(); margin = margin == null ? 2 : margin;
    margin = Math.min(margin, Math.floor((v.w - 1) / 2), Math.floor((v.h - 1) / 2));
    if (x < S.camTarget.x + margin) S.camTarget.x = x - margin;
    if (x + 1 > S.camTarget.x + v.w - margin) S.camTarget.x = x + 1 - v.w + margin;
    if (y < S.camTarget.y + margin) S.camTarget.y = y - margin;
    if (y + 1 > S.camTarget.y + v.h - margin) S.camTarget.y = y + 1 - v.h + margin;
    clampCam();
  }
  function centerOn(p, snap) {
    var v = viewTiles();
    S.cursor = { x: p.x, y: p.y };
    S.camTarget.x = p.x + 0.5 - v.w / 2; S.camTarget.y = p.y + 0.5 - v.h / 2;
    clampCam(snap);
    updateHud(true);
  }
  function tileOnScreen(x, y) {
    var v = viewTiles();
    return x >= S.cam.x && y >= S.cam.y && x + 1 <= S.cam.x + v.w && y + 1 <= S.cam.y + v.h;
  }
  /** Eine Stufe rein/raus (Tasten, Knöpfe) – auf den Cursor bezogen, weich animiert */
  function zoom(d) {
    var cur = S.zoomAnim ? S.zoomAnim.to : S.scale;
    var step = S.dpr;
    var target = clampScale((Math.round(cur / step) + d) * step);
    if (Math.abs(target - cur) < 0.001) return;
    var ax = (S.cursor.x + 0.5 - S.cam.x) * TS * S.scale, ay = (S.cursor.y + 0.5 - S.cam.y) * TS * S.scale;
    if (ax < 0 || ay < 0 || ax > canvas.width || ay > canvas.height) { ax = canvas.width / 2; ay = canvas.height / 2; }
    animateScale(target, ax, ay, 200);
  }

  // ================================================================ Render-Schleife
  function loop(now) {
    if (!running) return;
    requestAnimationFrame(loop);
    if (!S) return;
    if (canvas.width !== Math.round(canvas.clientWidth * DPR) || canvas.height !== Math.round(canvas.clientHeight * DPR)) resize();
    stepZoomAnim(now);
    // Kamera glätten
    S.cam.x += (S.camTarget.x - S.cam.x) * 0.25;
    S.cam.y += (S.camTarget.y - S.cam.y) * 0.25;
    if (Math.abs(S.cam.x - S.camTarget.x) < 0.01) S.cam.x = S.camTarget.x;
    if (Math.abs(S.cam.y - S.camTarget.y) < 0.01) S.cam.y = S.camTarget.y;
    S.viewer = computeViewer();
    syncExploreTerrain();
    var sel = S.sel;
    var view = {
      game: S.game, terrain: S.terrain, camX: S.cam.x, camY: S.cam.y, scale: S.scale, time: now,
      cursor: S.cursor, viewer: S.viewer, anim: S.anim, weather: S.game.weather,
      selectedId: S.sel && (S.mode === 'move' || S.mode === 'action' || S.mode === 'target') ? S.sel.unit.id : null,
      showCursor: !S.busy || S.mode === 'target' || S.mode === 'unloadTile' || S.mode === 'pickTile',
      cursorMode: S.mode === 'target' ? 'attack' : null,
      faction: facOf, facing: function (slot) { return S.facing[slot]; },
      moveSet: sel && S.mode === 'move' ? sel.moveSet : (S.inspect ? S.inspect.moveSet : null),
      attackSet: S.mode === 'target' ? S.targetSet : (S.inspect ? S.inspect.attackSet : (sel && S.mode === 'move' && sel.indirect ? sel.attackSet : null)),
      path: sel && S.mode === 'move' ? sel.path : null,
      unloadSet: S.mode === 'unloadTile' ? S.unloadTiles : S.mode === 'pickTile' ? S.pick.tiles : null,
      explored: exploredFor(S.viewer), terrainGrey: S.terrainGrey, unexplored: UI.settings.unexplored,
      dangerSet: S.dangerOn ? S.danger : null,
      visionSet: S.visionOn ? S.vision : null,
      plans: planView()
    };
    R.draw(ctx, canvas.width, canvas.height, view);
    updateBackButton();
    if (now - (S.mini.last || 0) > 220) { S.mini.last = now; drawMinimap(); updatePlanBar(); updateSideButtons(); }
    if (UI.settings.showGrid) drawGrid();
    drawObjectiveMarker(now);
  }
  // ---------------------------------------------------------------- Erkundung: Gelände mit gemerkten Besitzern
  function exploredFor(viewer) {
    var g = S.game;
    if (!g.explore || viewer == null) return null;
    g.visibility(viewer);
    return g.memoOf(viewer).seen;
  }
  function syncExploreTerrain() {
    var g = S.game;
    if (!g.explore) return;
    var viewer = S.viewer;
    if (viewer == null) {
      if (S.terrainViewer != null) { S.terrainViewer = null; S.terrain = R.buildTerrain(g.map); }
      return;
    }
    g.visibility(viewer);
    var m = g.memoOf(viewer), w = g.map.w;
    if (S.terrainViewer !== viewer || !S.viewMap || m.overflow) {
      m.overflow = false;
      var owner = [];
      for (var y = 0; y < g.map.h; y++) { var row = []; for (var x = 0; x < w; x++) { var o = m.owner[y * w + x]; row.push(o > 0 ? o : 0); } owner.push(row); }
      S.viewMap = { w: g.map.w, h: g.map.h, terrain: g.map.terrain, owner: owner };
      S.terrain = R.buildTerrain(S.viewMap);
      S.terrainGrey = R.greyLayer(S.terrain);
      S.terrainViewer = viewer;
      m.changed.length = 0;
      return;
    }
    if (m.changed.length) {
      var tiles = [];
      m.changed.forEach(function (i) {
        var x = i % w, y = (i - x) / w, o = m.owner[i];
        if (S.viewMap.owner[y][x] !== (o > 0 ? o : 0)) { S.viewMap.owner[y][x] = o > 0 ? o : 0; tiles.push({ x: x, y: y }); }
      });
      m.changed.length = 0;
      if (tiles.length) R.updateTiles(S.terrain, S.viewMap, tiles);
    }
  }
  function drawGrid() {
    var sc = S.scale, g = S.game;
    ctx.save();
    ctx.setTransform(sc, 0, 0, sc, Math.round(-S.cam.x * TS * sc), Math.round(-S.cam.y * TS * sc));
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (var x = 0; x <= g.map.w; x++) ctx.fillRect(x * TS, 0, 1 / sc, g.map.h * TS);
    for (var y = 0; y <= g.map.h; y++) ctx.fillRect(0, y * TS, g.map.w * TS, 1 / sc);
    ctx.restore();
  }
  function drawObjectiveMarker(now) {
    var o = S.game.objective;
    if (o.type !== 'capture') return;
    var sc = S.scale;
    var x = (o.x - S.cam.x) * TS * sc, y = (o.y - S.cam.y) * TS * sc;
    var k = S.dpr, b = Math.sin(now / 200) * 3 * k;
    ctx.save();
    ctx.fillStyle = '#ffe070'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2 * k;
    ctx.beginPath();
    ctx.moveTo(x + TS * sc / 2, y - 2 * k + b); ctx.lineTo(x + TS * sc / 2 - 8 * k, y - 14 * k + b); ctx.lineTo(x + TS * sc / 2 + 8 * k, y - 14 * k + b); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  // ================================================================ Minikarte
  function setMini(on) {
    if (!S) return;
    S.mini.on = !!on; S.mini.last = 0;
    UI.settings.minimap = S.mini.on; UI.saveSettings();
    UI.sfx('menu');
    drawMinimap();
  }
  function drawMinimap() {
    var mc = $('#minimap'), box = $('#minibox');
    if (!S || !mc || !box) return;
    var g = S.game;
    box.classList.remove('hidden');
    box.classList.toggle('collapsed', !S.mini.on);
    var tg = $('#mini-toggle');
    if (tg) { tg.textContent = S.mini.on ? '–' : '🗺'; tg.title = S.mini.on ? 'Minikarte einklappen (C)' : 'Minikarte ausklappen (C)'; }
    if (!S.mini.on) { $('#hud-info').style.left = ''; return; }
    // Auflösung: k Bildpunkte je Feld, Anzeige höchstens 240 px breit
    var k = Math.max(2, Math.min(6, Math.floor(240 / Math.max(g.map.w, g.map.h))));
    if (mc.width !== g.map.w * k || mc.height !== g.map.h * k) { mc.width = g.map.w * k; mc.height = g.map.h * k; }
    var cw = Math.min(240, g.map.w * k), chh = Math.round(cw * g.map.h / g.map.w);
    mc.style.width = cw + 'px'; mc.style.height = chh + 'px';
    var mctx = mc.getContext('2d');
    var def = { terrain: g.map.terrain, owner: (S.viewMap && g.explore && S.viewer != null) ? S.viewMap.owner : g.map.owner, w: g.map.w, h: g.map.h, theme: g.theme, units: [] };
    mctx.drawImage(R.minimap(def, k, facOf), 0, 0);
    var vis = S.viewer != null ? g.visibility(S.viewer) : null;
    var seen = exploredFor(S.viewer);
    if (seen) {
      mctx.fillStyle = UI.settings.unexplored === 'schwarz' ? '#05050c' : 'rgba(60,60,72,0.8)';
      for (var yy = 0; yy < g.map.h; yy++) for (var xx = 0; xx < g.map.w; xx++) if (!seen[yy * g.map.w + xx]) mctx.fillRect(xx * k, yy * k, k, k);
    }
    if (vis) {
      mctx.fillStyle = 'rgba(10,10,40,0.45)';
      for (var y = 0; y < g.map.h; y++) for (var x = 0; x < g.map.w; x++) if (!vis[y * g.map.w + x]) mctx.fillRect(x * k, y * k, k, k);
    }
    g.units.forEach(function (u) {
      if (S.viewer != null && !g.unitVisibleTo(u, S.viewer)) return;
      var cols = G.FACTIONS[facOf(u.p)].colors;
      mctx.fillStyle = '#101018'; mctx.fillRect(u.x * k, u.y * k, k, k);
      mctx.fillStyle = u.moved && u.p === g.currentPlayer().slot ? cols[3] : cols[0];
      mctx.fillRect(u.x * k + 0.5, u.y * k + 0.5, k - 1, k - 1);
    });
    var v = viewTiles();
    mctx.strokeStyle = 'rgba(0,0,0,0.6)'; mctx.lineWidth = 3;
    mctx.strokeRect(S.cam.x * k, S.cam.y * k, v.w * k, v.h * k);
    mctx.strokeStyle = '#ffffff'; mctx.lineWidth = 1.5;
    mctx.strokeRect(S.cam.x * k, S.cam.y * k, v.w * k, v.h * k);
    // Info-Karten nicht überdecken
    var info = $('#hud-info');
    if (info.classList.contains('left')) info.style.left = (cw + 22) + 'px'; else info.style.left = '';
  }
  // ---------------------------------------------------------------- Hinweisleiste beim Warten (Online): Vorplanen erklären
  function updatePlanBar() {
    var el = $('#plan-bar'); if (!el || !S) return;
    var show = canPlan();
    el.classList.toggle('hidden', !show);
    if (!show) { S.planBarKey = ''; return; }
    var cp = S.game.currentPlayer(), n = S.planOrder.length, planning = !!(S.sel && S.sel.plan);
    var key = cp.slot + '|' + n + '|' + (planning ? 1 : 0);
    if (key === S.planBarKey) return;
    S.planBarKey = key;
    el.innerHTML = '';
    el.appendChild(h('span', { class: 'who', text: '⏳ ' + cp.name + ' zieht' }));
    el.appendChild(h('span', { class: 'tip', text: planning ? 'Zielfeld antippen – oder einen Gegner für einen Angriff' :
      n ? n + ' Zug' + (n > 1 ? 'e' : '') + ' vorgeplant · weitere Einheit antippen' : 'Eigene Einheit antippen und ihren Zug vorplanen' }));
  }
  // ---------------------------------------------------------------- Einheiten-Knöpfe (rechts): Zustand
  function updateSideButtons() {
    var bn = $('#btn-next'), bp = $('#btn-pick');
    if (!bn || !bp || !S) return;
    var g = S.game, human = isHumanTurn(), plan = canPlan();
    var ready = human ? g.readyUnits(g.currentPlayer().slot).length : plan ? g.unitsOf(S.net.slot).length : 0;
    var modal = UI.top() !== S.layer;
    var allDone = human && !ready && S.mode === 'free';   // alle Einheiten haben gehandelt → Knopf wird zu „Ende“
    bn.disabled = modal || (!ready && !allDone) || (S.busy && !plan) || (S.mode !== 'free');
    bn.classList.toggle('hidden', !human && !plan);
    bn.classList.toggle('end', allDone);
    var nl = bn.querySelector('.lbl'), ni = bn.querySelector('.ico'), nn = bn.querySelector('.num');
    if (nl) nl.textContent = allDone ? 'Ende' : 'Nächste';
    if (ni) ni.textContent = allDone ? '⏹' : '⏭';
    if (nn) { nn.textContent = ready ? String(ready) : ''; nn.classList.toggle('hidden', !ready || allDone); }
    var be = $('#btn-eye'); if (be) be.classList.toggle('on', !!S.visionOn);
    var lbl = bp.querySelector('.lbl'), ico = bp.querySelector('.ico');
    var inMove = S.mode === 'move', inTarget = S.mode === 'target' || S.mode === 'unloadTile' || S.mode === 'pickTile';
    bp.disabled = (S.busy && !plan) || (!human && !plan && !modal);
    bp.classList.toggle('hidden', !human && !plan && !modal);
    // Knopfleiste unten rechts sichtbar? Dann rücken die Info-Karten darüber (CSS #hud.side-on)
    $('#hud').classList.toggle('side-on', !bn.classList.contains('hidden') || !bp.classList.contains('hidden'));
    if (lbl) lbl.textContent = inMove ? 'Hierhin' : inTarget ? 'Angriff' : modal ? 'OK' : 'Wählen';
    if (ico) ico.textContent = inMove ? '➜' : inTarget ? '✕' : '✔';
  }
  function bindMinimap() {
    var mc = $('#minimap');
    if (!mc || mc._bound) return;
    mc._bound = true;
    var drag = false;
    function go(ev) {
      if (!S) return;
      var r = mc.getBoundingClientRect(), g = S.game;
      var tx = (ev.clientX - r.left) / r.width * g.map.w, ty = (ev.clientY - r.top) / r.height * g.map.h;
      var v = viewTiles();
      S.camTarget.x = tx - v.w / 2; S.camTarget.y = ty - v.h / 2;
      clampCam(true);
      if (!S.busy && S.mode === 'free') { S.cursor = { x: Math.max(0, Math.min(g.map.w - 1, Math.floor(tx))), y: Math.max(0, Math.min(g.map.h - 1, Math.floor(ty))) }; updateHud(true); }
    }
    mc.addEventListener('pointerdown', function (ev) { drag = true; mc.setPointerCapture(ev.pointerId); go(ev); ev.stopPropagation(); });
    mc.addEventListener('pointermove', function (ev) { if (drag) go(ev); });
    mc.addEventListener('pointerup', function () { drag = false; });
  }

  // ================================================================ HUD
  function updateHud(force) {
    if (!S) return;
    var g = S.game, cp = g.currentPlayer();
    var key = [g.version, cp.slot, S.cursor.x, S.cursor.y, cp.funds, cp.power, S.viewer, S.mode].join('|');
    if (!force && key === S.hudKey) return;
    S.hudKey = key;
    var hp = $('#hud-player');
    hp.innerHTML = '';
    hp.style.setProperty('--c', G.FACTIONS[cp.faction].colors[1]);   // Teamfarbe für den Seitenstreifen
    var co = g.coOf(cp.slot);
    hp.appendChild(R.portraitCanvas(cp.co, cp.faction, 64, cp.co2));
    hp.lastChild.className = 'portrait';
    var info = h('div', {});
    info.appendChild(h('div', { class: 'pname' }, [h('span', { class: 'swatch', style: { background: G.FACTIONS[cp.faction].colors[1] } }), co.name]));
    info.appendChild(h('div', { class: 'funds', text: 'G ' + UI.fmt(cp.funds) }));
    var Wt = G.WEATHER[g.weather] || G.WEATHER.klar;
    info.appendChild(h('div', { class: 'day', text: 'Tag ' + g.day + (g.meta.dayLimit ? '/' + g.meta.dayLimit : '') + ' · ' + cp.name + (cp.ai ? ' (KI)' : '') }));
    info.appendChild(h('div', { class: 'day weather', title: Wt.desc, text: Wt.icon + ' ' + Wt.name }));
    if (g.meta.powers !== false) {
      if (cp.powerActive) info.appendChild(h('span', { class: 'power-active', text: cp.powerActive === 2 ? co.superPower.name.toUpperCase() : co.power.name.toUpperCase() }));
      else info.appendChild(starsEl(g, cp.slot));
    }
    hp.appendChild(info);
    if (S.net && G.Net) G.Net.hud();
    updateBackButton();
    // Seite wechseln, wenn Cursor oben links ist
    var v = viewTiles();
    var relX = (S.cursor.x - S.cam.x) / v.w, relY = (S.cursor.y - S.cam.y) / v.h;
    hp.classList.toggle('right', relX < 0.4 && relY < 0.35);
    var bottom = $('#hud-info');
    bottom.classList.toggle('left', relX > 0.6 && relY > 0.6);
    bottom.innerHTML = '';
    if (!g.inBounds(S.cursor.x, S.cursor.y)) return;
    bottom.appendChild(terrainCard(S.cursor.x, S.cursor.y));
    var u = g.unitAt(S.cursor.x, S.cursor.y);
    if (u && (S.viewer == null || g.unitVisibleTo(u, S.viewer)) && g.isExplored(S.viewer, S.cursor.x, S.cursor.y)) bottom.appendChild(unitCard(u));
  }
  P.updateHud = updateHud;
  function starsEl(g, slot) {
    var co = g.coOf(slot), pl = g.playerBySlot(slot);
    var box = h('div', { class: 'stars', title: 'Kraft: ' + co.power.stars + '★ · Superkraft: ' + co.superPower.stars + '★' });
    var have = pl.power / g.starCost(slot);
    for (var i = 0; i < co.superPower.stars; i++) {
      var big = i >= co.power.stars;
      var f = Math.max(0, Math.min(1, have - i));
      var st = h('div', { class: 'star' + (big ? ' big' : '') + (f >= 1 ? ' full' : '') }, [h('div', { class: 'fill', style: { height: (f * 100) + '%' } })]);
      box.appendChild(st);
    }
    return box;
  }
  function tileCanvas(x, y) {
    var L = S.terrain, TP = L.TP || TS * (L.D || R.D);
    var c = document.createElement('canvas'); c.width = 48; c.height = 48;
    var cx = c.getContext('2d'); cx.imageSmoothingEnabled = true;
    cx.drawImage(L, x * TP, y * TP, TP, TP, 0, 0, 48, 48);
    c.className = 'spr'; c.style.width = '40px'; c.style.height = '40px';
    return c;
  }
  function terrainCard(x, y) {
    var g = S.game, t = g.terrainAt(x, y);
    if (!g.isExplored(S.viewer, x, y)) {
      var unk = h('div', { class: 'panel hud-card' });
      unk.appendChild(h('div', { class: 'title', text: 'Unerforscht' }));
      unk.appendChild(h('div', { class: 'row' }, [h('b', { text: '?' }), h('span', { text: '' })]));
      return unk;
    }
    var card = h('div', { class: 'panel hud-card' });
    card.appendChild(h('div', { class: 'title', text: t.name }));
    card.appendChild(tileCanvas(x, y));
    card.appendChild(h('div', { class: 'row' }, [h('b', { text: '★' }), h('span', { text: String(t.def) })]));
    if (t.prop) {
      var u = g.unitAt(x, y);
      var capturing = u && G.UNITS[u.type].capture && u.cp < G.RULES.capturePoints && (S.viewer == null || g.unitVisibleTo(u, S.viewer));
      var cp = capturing ? u.cp : G.RULES.capturePoints;
      card.appendChild(h('div', { class: 'row' + (capturing ? ' cap' : '') }, [h('b', { text: '⚑' }), h('span', { text: capturing ? (G.RULES.capturePoints - cp) + '/' + G.RULES.capturePoints : String(cp) })]));
      if (capturing) card.appendChild(h('div', { class: 'capnote', text: 'Einnahme läuft' }));
    }
    return card;
  }
  function unitCard(u) {
    var g = S.game, T = G.UNITS[u.type];
    var card = h('div', { class: 'panel hud-card' });
    card.appendChild(h('div', { class: 'title', text: T.name }));
    card.appendChild(R.unitCanvas(u.type, facOf(u.p), 40));
    card.appendChild(h('div', { class: 'row' }, [h('b', { text: 'KP' }), h('span', { text: String(g.dispHp(u)) })]));
    card.appendChild(h('div', { class: 'row' }, [h('b', { text: '⛽' }), h('span', { text: String(u.fuel) })]));
    if (T.ammo) card.appendChild(h('div', { class: 'row' }, [h('b', { text: '◆' }), h('span', { text: String(u.ammo) })]));
    card.appendChild(h('div', { class: 'row', title: 'Sichtweite (Felder)' }, [h('b', { text: '👁' }), h('span', { text: String(g.visionOf(u, u.x, u.y)) })]));
    if (T.cap) card.appendChild(cargoBox(u));
    return card;
  }
  /** Ladung eines Transporters: kleine Bilder mit KP, dazu belegte/freie Plätze */
  function cargoBox(u) {
    var g = S.game, T = G.UNITS[u.type], cargo = u.cargo || [];
    var box = h('div', { class: 'cargo' + (cargo.length >= T.cap ? ' full' : ''), title: cargo.length ? 'Geladen: ' + cargoText(u) : 'Leer' });
    box.appendChild(h('div', { class: 'cap', text: '▣ ' + cargo.length + '/' + T.cap + (cargo.length >= T.cap ? ' voll' : '') }));
    var slots = h('div', { class: 'cslots' });
    for (var i = 0; i < T.cap; i++) {
      var c2 = cargo[i], cell = h('div', { class: 'cslot' + (c2 ? '' : ' empty') });
      if (c2) {
        cell.appendChild(R.unitCanvas(c2.type, facOf(c2.p != null ? c2.p : u.p), 32));
        cell.appendChild(h('span', { class: 'hp', text: String(g.dispHp(c2)) }));
        cell.title = G.UNITS[c2.type].name + ' · ' + g.dispHp(c2) + ' KP';
      }
      slots.appendChild(cell);
    }
    box.appendChild(slots);
    return box;
  }
  function cargoText(u) {
    var g = S.game;
    return (u.cargo || []).map(function (c2) { return G.UNITS[c2.type].name + ' (' + g.dispHp(c2) + ' KP)'; }).join(', ') || 'leer';
  }
  function showForecast(att, def, ax, ay) {
    var f = S.game.forecast(att, def, ax, ay);
    var box = $('#hud-forecast');
    box.classList.remove('hidden');
    function pct(a, b) { return a === b ? a + ' %' : a + '–' + b + ' %'; }
    box.innerHTML = '';
    box.appendChild(h('div', { text: G.UNITS[att.type].name + ' → ' + G.UNITS[def.type].name }));
    box.appendChild(h('div', { class: 'dmg', text: pct(f.min, f.max) }));
    if (f.max >= def.hp) box.appendChild(h('div', { style: { color: '#d02818', fontWeight: 'bold' }, text: f.min >= def.hp ? 'Sicher zerstört!' : 'Kann zerstören!' }));
    box.appendChild(h('div', { class: 'counter', text: f.counter ? 'Gegenschlag: ' + pct(f.cMin, f.cMax) : 'Kein Gegenschlag' }));
  }
  function hideForecast() { $('#hud-forecast').classList.add('hidden'); }

  // ================================================================ Zeiger (Maus/Touch)
  function bindPointer() {
    var down = null, pinch = null;
    var pointers = {};
    function canvasPt(x, y) {
      var r = canvas.getBoundingClientRect();
      return { x: (x - r.left) * (canvas.width / r.width), y: (y - r.top) * (canvas.height / r.height) };
    }
    function pinchInfo() {
      var ids = Object.keys(pointers), a = pointers[ids[0]], b = pointers[ids[1]];
      return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: canvasPt((a.x + b.x) / 2, (a.y + b.y) / 2) };
    }
    var wheelSnap = null;
    function tileAt(ev) {
      var r = canvas.getBoundingClientRect();
      var sx = (ev.clientX - r.left) * (canvas.width / r.width), sy = (ev.clientY - r.top) * (canvas.height / r.height);
      return { x: Math.floor(sx / (TS * S.scale) + S.cam.x), y: Math.floor(sy / (TS * S.scale) + S.cam.y) };
    }
    canvas.addEventListener('pointerdown', function (ev) {
      if (!S) return;
      S.lastInput = performance.now();
      pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* egal */ }
      var ids = Object.keys(pointers);
      if (ids.length === 2) {
        // Zwei Finger: stufenlos zoomen und schieben – der Punkt zwischen den Fingern bleibt unter den Fingern
        var pi = pinchInfo();
        S.zoomAnim = null;
        pinch = { d0: pi.d, s0: S.scale, wx: S.cam.x + pi.mid.x / (TS * S.scale), wy: S.cam.y + pi.mid.y / (TS * S.scale), mid: pi.mid };
        down = null;
        return;
      }
      if (ids.length > 2) return;
      down = { x: ev.clientX, y: ev.clientY, btn: ev.button, cam: { x: S.camTarget.x, y: S.camTarget.y }, dragged: false, type: ev.pointerType };
      if (ev.button === 1) ev.preventDefault();
    });
    canvas.addEventListener('pointermove', function (ev) {
      if (!S) return;
      if (pointers[ev.pointerId]) pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      if (pinch) {
        if (Object.keys(pointers).length >= 2) {
          var pn = pinchInfo();
          var sc = clampScale(pinch.s0 * pn.d / pinch.d0);
          S.scale = sc; S.zoomOff = sc / S.dpr - baseScale();
          S.camTarget.x = pinch.wx - pn.mid.x / (TS * sc); S.camTarget.y = pinch.wy - pn.mid.y / (TS * sc);
          clampCam(true);
          pinch.mid = pn.mid;
        }
        return;
      }
      if (down) {
        var dx = ev.clientX - down.x, dy = ev.clientY - down.y;
        var thresh = down.type === 'touch' ? 12 : 6;
        var panBtn = down.btn === 1 || down.type === 'touch' || (down.btn === 0 && S.mode === 'free');
        if (!down.dragged && Math.hypot(dx, dy) > thresh && panBtn) down.dragged = true;
        if (down.dragged) {
          var r = canvas.getBoundingClientRect(), k = canvas.width / r.width / (TS * S.scale);
          S.camTarget.x = down.cam.x - dx * k; S.camTarget.y = down.cam.y - dy * k;
          clampCam(true);
          return;
        }
      }
      if (ev.pointerType === 'mouse' && (!S.busy || canPlan())) {
        var t = tileAt(ev);
        if (S.game.inBounds(t.x, t.y) && (t.x !== S.cursor.x || t.y !== S.cursor.y)) setCursor(t.x, t.y, true);
      }
    });
    canvas.addEventListener('pointerup', function (ev) {
      if (!S) return;
      delete pointers[ev.pointerId];
      if (pinch) {
        if (Object.keys(pointers).length < 2 && !pinch.snapped) { pinch.snapped = true; snapScale(pinch.mid.x, pinch.mid.y); }
        if (!Object.keys(pointers).length) pinch = null;
        down = null; return;
      }
      var d = down; down = null;
      if (!d || d.dragged) return;
      if (UI.top() !== S.layer) {
        // Klick neben ein offenes Menü = zurück
        var top = UI.top();
        if (top && top.onAction && d.btn === 0) top.onAction('b');
        return;
      }
      var t = tileAt(ev);
      if (d.btn === 2) { onAction('b'); return; }
      if (d.btn !== 0) return;
      if (!S.game.inBounds(t.x, t.y)) return;
      // Während eigener Animationen nichts annehmen – beim Warten auf den Gegner darf aber weiter geplant werden
      if (S.busy && !canPlan()) { return; }
      var same = t.x === S.cursor.x && t.y === S.cursor.y;
      // Zielwahl per Finger: der erste Tipp auf ein anderes Ziel zeigt nur die Schadensvorschau, der zweite greift an
      if (S.mode === 'target' && d.type !== 'mouse') {
        var ti = targetIndexAt(t.x, t.y);
        if (ti >= 0 && ti !== S.targetIdx) { S.targetIdx = ti; UI.sfx('cursor'); focusTarget(); return; }
      }
      setCursor(t.x, t.y, !same);
      onAction('a', { pointer: true, touch: d.type !== 'mouse', same: same });
    });
    canvas.addEventListener('pointercancel', function (ev) {
      delete pointers[ev.pointerId];
      if (pinch && !pinch.snapped && Object.keys(pointers).length < 2) { pinch.snapped = true; snapScale(pinch.mid.x, pinch.mid.y); }
      if (!Object.keys(pointers).length) pinch = null;
      down = null;
    });
    canvas.addEventListener('wheel', function (ev) {
      if (!S) return;
      ev.preventDefault();
      // Mausrad/Touchpad: stufenlos zum Mauszeiger hin, kurz danach weich auf eine scharfe Stufe einrasten
      var dy = ev.deltaMode === 1 ? ev.deltaY * 33 : ev.deltaMode === 2 ? ev.deltaY * 400 : ev.deltaY;
      if (ev.ctrlKey) dy *= 3; // Touchpad-Zweifinger-Zoom
      var at = canvasPt(ev.clientX, ev.clientY);
      S.zoomAnim = null;
      setScaleAt(S.scale * Math.exp(-Math.max(-120, Math.min(120, dy)) * 0.0022), at.x, at.y);
      clearTimeout(wheelSnap);
      wheelSnap = setTimeout(function () { if (S) snapScale(at.x, at.y); }, 220);
    }, { passive: false });
  }

  // ================================================================ Cursor
  function setCursor(x, y, sound) {
    var g = S.game;
    x = Math.max(0, Math.min(g.map.w - 1, x)); y = Math.max(0, Math.min(g.map.h - 1, y));
    if (x === S.cursor.x && y === S.cursor.y) return;
    S.cursor = { x: x, y: y };
    if (sound) UI.sfx('cursor');
    ensureVisible(x, y);
    if (S.mode === 'move') updatePath(x, y);
    if (S.mode === 'target') { var ti = targetIndexAt(x, y); if (ti >= 0 && ti !== S.targetIdx) { S.targetIdx = ti; focusTarget(); return; } }
    updateHud();
  }

  // ================================================================ Eingabe-Hauptverteiler
  function onAction(a, ev) {
    if (!S) return true;
    S.lastInput = performance.now();
    if (a === 'minimap') { setMini(!S.mini.on); return true; }
    if (a === 'zoomin') { zoom(1); return true; }
    if (a === 'zoomout') { zoom(-1); return true; }
    if (a === 'keys') { showKeysOverlay(); return true; }
    if (a === 'vision') { toggleVision(); return true; }
    if (a === 'danger') { toggleDanger(); return true; }
    if (a === 'undo') { doUndo(); return true; }
    // Beschäftigt (Animation läuft): eigene Eingaben überspringen nur die Animation.
    // Ausnahme: Wer online auf den Gegner wartet, darf währenddessen weiter vorplanen.
    if (S.busy && !(canPlan() && (S.mode === 'free' || (S.mode === 'move' && S.sel && S.sel.plan)))) {
      if (a === 'a' || a === 'b') S.skip = true;
      return true;
    }
    var dirs = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    if (dirs[a]) {
      if (S.mode === 'target') { cycleTarget(a === 'down' || a === 'right' ? 1 : -1); return true; }
      if (S.mode === 'unloadTile') { cycleUnloadTile(a === 'down' || a === 'right' ? 1 : -1); return true; }
      if (S.mode === 'pickTile') return pickTileAction(a, ev);
      var step = ev && ev.shiftKey ? 5 : 1;
      setCursor(S.cursor.x + dirs[a][0] * step, S.cursor.y + dirs[a][1] * step, true);
      return true;
    }
    if (a === 'intel') { showIntel(); return true; }
    if (a === 'options') { showOptionsOverlay(); return true; }
    if (a === 'chat') { if (S.net) UI.chatMenu(); return true; }
    switch (S.mode) {
      case 'free': return freeAction(a, ev);
      case 'move': return moveAction(a, ev);
      case 'target': return targetAction(a, ev);
      case 'unloadTile': return unloadTileAction(a, ev);
      case 'pickTile': return pickTileAction(a, ev);
    }
    return true;
  }

  // ---------------------------------------------------------------- Freier Cursor
  function freeAction(a, ev) {
    var g = S.game, cp = g.currentPlayer();
    var human = isHumanTurn();
    if (a === 'b') {
      if (S.inspect) { S.inspect = null; return true; }
      // B auf Einheit: Reichweite zeigen (wie Gedrückthalten)
      var u0 = g.unitAt(S.cursor.x, S.cursor.y);
      if (u0 && (S.viewer == null || g.unitVisibleTo(u0, S.viewer))) { inspectUnit(u0); return true; }
      // Esc auf leerem Feld: Menü
      if (ev && ev.key === 'Escape') openMainMenu();
      return true;
    }
    if (a === 'hq') { jumpToHq(); return true; }
    if (a === 'info') { showInfo(S.cursor.x, S.cursor.y); return true; }
    if (!human) {
      if (canPlan() && (a === 'next' || a === 'prev')) { var mine = g.unitsOf(S.net.slot).filter(function (q) { return q.x !== undefined; }); if (mine.length) cycleTo(mine, a === 'prev' ? -1 : 1); return true; }
      if (a === 'a') {
        var uo = g.unitAt(S.cursor.x, S.cursor.y);
        if (uo && canPlan() && uo.p === S.net.slot) { startPlan(uo); return true; }
        if (uo && (S.viewer == null || g.unitVisibleTo(uo, S.viewer))) inspectUnit(uo);
        else S.inspect = null;
      }
      return true;
    }
    if (a === 'end') { askEndTurn(); return true; }
    if (a === 'next') { nextReady(); return true; }
    if (a === 'prev') { nextReady(-1); return true; }
    if (a === 'factory') { nextFactory(); return true; }
    if (a === 'power') { openPowerMenu(); return true; }
    if (a === 'save') { if (!S.net) openSaveMenu(); return true; }
    if (a !== 'a') return true;
    S.inspect = null;
    var u = g.unitAt(S.cursor.x, S.cursor.y);
    var visible = u && (S.viewer == null || g.unitVisibleTo(u, S.viewer));
    if (u && visible && u.p === cp.slot && !u.moved) { selectUnit(u); return true; }
    if (u && visible) { inspectUnit(u); return true; }
    var t = g.terrainAt(S.cursor.x, S.cursor.y);
    if (t.builds && g.ownerAt(S.cursor.x, S.cursor.y) === cp.slot && !u) { openBuildMenu(S.cursor.x, S.cursor.y); return true; }
    // Leeres Feld: Enter öffnet das Menü; ein Tipp setzt nur den Cursor, ein zweiter Tipp auf dasselbe Feld öffnet das Menü
    if (!(ev && ev.pointer) || ev.same) openMainMenu();
    return true;
  }
  /** Cursor zum nächsten Eintrag einer Liste von Feldern (Lesereihenfolge), dir = 1 vorwärts, -1 rückwärts */
  function cycleTo(list, dir) {
    list.sort(function (a, b) { return a.y - b.y || a.x - b.x; });
    var cx = S.cursor.x, cy = S.cursor.y, idx;
    function after(t) { return t.y > cy || (t.y === cy && t.x > cx); }
    if (dir < 0) {
      idx = list.length - 1;
      for (var j = list.length - 1; j >= 0; j--) if (list[j].y < cy || (list[j].y === cy && list[j].x < cx)) { idx = j; break; }
    } else {
      idx = 0;
      for (var i = 0; i < list.length; i++) if (after(list[i])) { idx = i; break; }
    }
    UI.sfx('cursor');
    setCursor(list[idx].x, list[idx].y);
  }
  function nextReady(dir) {
    var g = S.game, list = g.readyUnits(g.currentPlayer().slot);
    if (!list.length) { UI.toast('Alle Einheiten haben gehandelt.'); return; }
    cycleTo(list.slice(), dir || 1);
  }
  /** Nächstes eigenes Gebäude, auf dem jetzt gebaut werden kann (frei, genug Geld) */
  function nextFactory() {
    var g = S.game, slot = g.currentPlayer().slot, list = [];
    for (var y = 0; y < g.map.h; y++) for (var x = 0; x < g.map.w; x++) {
      if (!g.terrainAt(x, y).builds || g.ownerAt(x, y) !== slot || g.unitAt(x, y)) continue;
      if (g.buildOptions(slot, x, y).some(function (o) { return o.affordable; })) list.push({ x: x, y: y });
    }
    if (!list.length) { UI.toast('Keine freie Fabrik, auf der du dir etwas leisten kannst.'); return; }
    cycleTo(list, 1);
  }
  function jumpToHq() {
    var g = S.game, slot = S.viewer != null ? S.viewer : g.currentPlayer().slot;
    for (var y = 0; y < g.map.h; y++) for (var x = 0; x < g.map.w; x++) {
      if (g.terrainAt(x, y).hq && g.ownerAt(x, y) === slot) { UI.sfx('cursor'); setCursor(x, y); return; }
    }
    UI.toast('Kein Hauptquartier.');
  }
  function inspectUnit(u) {
    var g = S.game;
    var reach = g.reachable(u, { viewer: S.viewer != null ? S.viewer : u.p });
    var moveSet = {}, attackSet = {};
    var R2 = g.rangeOf(u);
    reach.list.forEach(function (n) { moveSet[n.y * g.map.w + n.x] = 1; });
    if (R2[1] > 0 && (G.DAMAGE[u.type].primary || G.DAMAGE[u.type].secondary)) {
      var origins = R2[0] > 1 ? [{ x: u.x, y: u.y }] : reach.list.filter(function (n) { return n.end; });
      origins.forEach(function (o) {
        for (var dy = -R2[1]; dy <= R2[1]; dy++) for (var dx = -R2[1]; dx <= R2[1]; dx++) {
          var d = Math.abs(dx) + Math.abs(dy); if (d < R2[0] || d > R2[1]) continue;
          var x = o.x + dx, y = o.y + dy; if (!g.inBounds(x, y)) continue;
          attackSet[y * g.map.w + x] = 1;
        }
      });
    }
    if (R2[0] > 1) moveSet = {};
    S.inspect = { moveSet: moveSet, attackSet: attackSet };
    UI.sfx('select');
  }
  function computeDanger() {
    var g = S.game, viewer = S.viewer != null ? S.viewer : g.currentPlayer().slot, set = {};
    g.units.forEach(function (u) {
      if (!g.isEnemy(u.p, viewer) || !g.unitVisibleTo(u, viewer)) return;
      var R2 = g.rangeOf(u);
      if (!R2[1] || !(G.DAMAGE[u.type].primary || G.DAMAGE[u.type].secondary)) return;
      var origins = R2[0] > 1 ? [{ x: u.x, y: u.y }] : g.reachable(u, { omniscient: true }).list;
      origins.forEach(function (o) {
        for (var dy = -R2[1]; dy <= R2[1]; dy++) for (var dx = -R2[1]; dx <= R2[1]; dx++) {
          var d = Math.abs(dx) + Math.abs(dy); if (d < R2[0] || d > R2[1]) continue;
          var x = o.x + dx, y = o.y + dy; if (g.inBounds(x, y)) set[y * g.map.w + x] = 1;
        }
      });
    });
    return set;
  }

  /** Felder, die sichtbare Gegner einsehen können (Sichtweite je Einheit, Wald/Riff verbergen ab Abstand 2, Gebäude wie im Spiel) */
  function computeEnemyVision() {
    var g = S.game, viewer = S.viewer != null ? S.viewer : g.currentPlayer().slot, set = {}, w = g.map.w;
    function mark(cx, cy, r, pierce, bld) {
      for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++) {
        var d = Math.abs(dx) + Math.abs(dy); if (d > r) continue;
        var x = cx + dx, y = cy + dy; if (!g.inBounds(x, y)) continue;
        if (G.TERRAIN[g.map.terrain[y][x]].hides && d > (bld ? 0 : 1) && !pierce) continue;
        set[y * w + x] = 1;
      }
    }
    g.units.forEach(function (u) {
      if (!g.isEnemy(u.p, viewer) || !g.unitVisibleTo(u, viewer)) return;
      mark(u.x, u.y, g.visionOf(u, u.x, u.y), g.piercing(u.p), false);
    });
    if (g.fogActive()) for (var y = 0; y < g.map.h; y++) for (var x = 0; x < w; x++) {
      var o = g.map.owner[y][x];
      if (!o || !g.isEnemy(o, viewer) || !g.isExplored(viewer, x, y)) continue;
      var tt = g.map.terrain[y][x];
      mark(x, y, tt === 'Q' ? 5 : G.TERRAIN[tt].builds ? 3 : 2, g.piercing(o), true);
    }
    return set;
  }
  function toggleVision() {
    S.visionOn = !S.visionOn;
    if (S.visionOn) { S.vision = computeEnemyVision(); UI.toast('Gegner-Sicht: an – gelb = dort sieht dich der Gegner'); } else UI.toast('Gegner-Sicht: aus');
    var be = $('#btn-eye'); if (be) be.classList.toggle('on', S.visionOn);
  }
  /** Letzten Zug zurücknehmen (einmal je Runde; Regeln siehe Game.canUndo) */
  function doUndo() {
    var g = S.game;
    if (!isHumanTurn() || S.busy || S.mode !== 'free') { UI.sfx('error'); return; }
    var slot = g.currentPlayer().slot, can = g.canUndo(slot);
    if (!can.ok) { UI.sfx('error'); UI.toast('Rückgängig nicht möglich: ' + can.reason + '.', 3000); return; }
    var r = g.undo(slot);
    if (!r.ok) { UI.sfx('error'); return; }
    netSend({ t: 'undo' });
    S.anim = {}; S.sel = null; S.inspect = null;
    rebuildTerrain();
    var ev = r.events[0];
    if (ev && ev.x != null) S.cursor = { x: ev.x, y: ev.y };
    if (S.dangerOn) S.danger = computeDanger();
    if (S.visionOn) S.vision = computeEnemyVision();
    updateHud(true);
    UI.sfx('cancel');
    UI.toast('Letzter Zug zurückgenommen – einmal je Runde.');
  }
  function toggleDanger() {
    S.dangerOn = !S.dangerOn;
    if (S.dangerOn) { S.danger = computeDanger(); UI.toast('Gegner-Reichweite: an – lila = dort kann der Gegner angreifen'); } else UI.toast('Gegner-Reichweite: aus');
  }

  // ---------------------------------------------------------------- Einheit gewählt
  function selectUnit(u) {
    var g = S.game;
    var reach = g.reachable(u);
    var moveSet = {};
    reach.list.forEach(function (n) { if (n.end) moveSet[n.y * g.map.w + n.x] = 1; });
    var indirect = g.rangeOf(u)[0] > 1;
    var attackSet = null;
    if (indirect) {
      attackSet = {};
      var R2 = g.rangeOf(u);
      for (var dy = -R2[1]; dy <= R2[1]; dy++) for (var dx = -R2[1]; dx <= R2[1]; dx++) {
        var d = Math.abs(dx) + Math.abs(dy); if (d < R2[0] || d > R2[1]) continue;
        if (g.inBounds(u.x + dx, u.y + dy)) attackSet[(u.y + dy) * g.map.w + u.x + dx] = 1;
      }
    }
    S.sel = { unit: u, reach: reach, moveSet: moveSet, path: [{ x: u.x, y: u.y }], cost: 0, indirect: indirect, attackSet: attackSet,
      budget: Math.min(g.moveOf(u), u.fuel) };
    S.mode = 'move';
    UI.sfx('select');
  }
  function updatePath(x, y) {
    var sel = S.sel, g = S.game;
    var node = sel.reach.nodes[y * g.map.w + x];
    if (!node) return;
    var path = sel.path, last = path[path.length - 1];
    var inPath = -1;
    for (var i = 0; i < path.length; i++) if (path[i].x === x && path[i].y === y) { inPath = i; break; }
    if (inPath >= 0) { sel.path = path.slice(0, inPath + 1); }
    else if (Math.abs(last.x - x) + Math.abs(last.y - y) === 1) {
      var cost = pathCost(path) + g.moveCost(sel.unit.type, x, y);
      if (cost <= sel.budget) sel.path = path.concat([{ x: x, y: y }]);
      else sel.path = g.pathTo(sel.reach, x, y);
    } else sel.path = g.pathTo(sel.reach, x, y);
  }
  function pathCost(path) {
    var c = 0, g = S.game;
    for (var i = 1; i < path.length; i++) c += g.moveCost(S.sel.unit.type, path[i].x, path[i].y);
    return c;
  }
  function moveAction(a, ev) {
    var g = S.game, sel = S.sel;
    if (sel.plan) return planMoveAction(a, ev);
    if (a === 'b') { cancelSelection(); return true; }
    if (a === 'info') { showInfo(S.cursor.x, S.cursor.y); return true; }
    if (a !== 'a') return true;
    var x = S.cursor.x, y = S.cursor.y, idx = y * g.map.w + x;
    // Komfort: auf sichtbaren Gegner klicken -> passendes Feld wählen und angreifen
    var enemy = g.unitAt(x, y);
    if (enemy && g.isEnemy(enemy.p, sel.unit.p) && g.unitVisibleTo(enemy, sel.unit.p)) {
      var plan = autoAttackPath(sel.unit, enemy);
      if (plan) { confirmLeaveCapture(sel.unit, plan).then(function (ok) { if (ok && S && S.sel === sel) executeMove(plan, enemy); }); return true; }
      if (ev && ev.pointer) { cancelSelection(); UI.sfx('cancel'); return true; }   // unerreichbarer Gegner angetippt: Auswahl aufheben
      UI.sfx('error'); return true;
    }
    if (!sel.moveSet[idx]) {
      // Eigener Transporter, der diese Einheit tragen könnte, aber voll ist: Inhalt zeigen
      var occ = g.unitAt(x, y), OT = occ && G.UNITS[occ.type];
      if (occ && occ !== sel.unit && occ.p === sel.unit.p && OT.carries && OT.carries.indexOf(G.UNITS[sel.unit.type].cls) >= 0 &&
          (occ.cargo || []).length >= OT.cap) { UI.toast(OT.name + ' ist voll: ' + cargoText(occ), 3500); UI.sfx('error'); return true; }
      // Tipp/Klick außerhalb der Reichweite: Auswahl aufheben (wie Esc)
      if (ev && ev.pointer) { cancelSelection(); UI.sfx('cancel'); return true; }
      UI.sfx('error'); return true;
    }
    var path = sel.path;
    var end = path[path.length - 1];
    if (end.x !== x || end.y !== y) path = g.pathTo(sel.reach, x, y);
    confirmLeaveCapture(sel.unit, path).then(function (ok) { if (ok && S && S.sel === sel) executeMove(path, null); });
    return true;
  }
  /** Läuft eine Einnahme und die Einheit soll wegziehen? Dann nachfragen (sonst geht der Fortschritt verloren). */
  function confirmLeaveCapture(u, path) {
    var T = G.UNITS[u.type];
    if (!path || path.length < 2 || !T.capture || u.cp >= G.RULES.capturePoints) return Promise.resolve(true);
    var g = S.game, t = g.terrainAt(u.x, u.y);
    UI.sfx('error');
    return UI.confirm('Einnahme abbrechen? ' + t.name + ' ist schon zu ' + (G.RULES.capturePoints - u.cp) + '/' + G.RULES.capturePoints + ' eingenommen – zieht die Einheit weg, beginnt sie von vorn.', 'Trotzdem wegziehen', 'Hier bleiben');
  }
  /** Wie viele Einnahme-Punkte nach dieser Aktion noch fehlen (0 = Gebäude fällt) */
  function captureLeft(u, path) {
    var g = S.game, co = g.coOf(u.p), fac = co && co.capture ? co.capture(g.powerOf(u.p)) : 1;
    var cp = path.length > 1 ? G.RULES.capturePoints : u.cp;
    return Math.max(0, cp - Math.floor(g.dispHp(u) * fac));
  }
  function autoAttackPath(u, enemy) {
    var g = S.game, sel = S.sel, R2 = g.rangeOf(u);
    if (!g.weaponFor(u, enemy)) return null;
    var d0 = Math.abs(u.x - enemy.x) + Math.abs(u.y - enemy.y);
    if (R2[0] > 1) return d0 >= R2[0] && d0 <= R2[1] ? [{ x: u.x, y: u.y }] : null;
    var last = sel.path[sel.path.length - 1];
    if (Math.abs(last.x - enemy.x) + Math.abs(last.y - enemy.y) === 1 && sel.moveSet[last.y * g.map.w + last.x]) return sel.path;
    var best = null;
    G.DIRS.forEach(function (dd) {
      var nx = enemy.x + dd[0], ny = enemy.y + dd[1];
      if (!sel.moveSet[ny * g.map.w + nx]) return;
      var occ = g.unitAt(nx, ny); if (occ && occ !== u) return;
      var n = sel.reach.nodes[ny * g.map.w + nx];
      var score = g.terrainAt(nx, ny).def * 10 - n.cost;
      if (!best || score > best.score) best = { score: score, x: nx, y: ny };
    });
    return best ? g.pathTo(sel.reach, best.x, best.y) : null;
  }
  function cancelSelection() {
    var u = S.sel && S.sel.unit;
    S.sel = null; S.mode = 'free';
    delete S.anim[u && u.id];
    if (u) setCursor(u.x, u.y);
    UI.sfx('cancel');
    updateHud(true);
  }

  // ---------------------------------------------------------------- Vorplanen (während der Gegner zieht)
  // Eigene Einheiten bekommen Marschbefehle (Ziel + Aktion). Zu Beginn des eigenen Zuges werden sie der Reihe nach
  // ausgeführt, sofern sie dann noch möglich sind. Einheiten ohne Plan (oder mit unmöglichem Plan) bleiben frei.
  function canPlan() {
    if (!S || !S.net || S.game.over || isHumanTurn()) return false;
    var me = S.game.playerBySlot(S.net.slot);
    return !!(me && me.alive);
  }
  function followRemote() {
    if (!S || !S.net || isHumanTurn()) return true;
    if (S.sel && S.sel.plan) return false;
    // Wer gerade selbst tippt oder die Karte verschiebt, will nicht weggerissen werden
    return performance.now() - (S.lastInput || 0) > 6000;
  }
  function planView() {
    if (!S.planOrder.length) return null;
    var g = S.game, out = [];
    S.planOrder.forEach(function (id) {
      var pl = S.plans[id], u = pl && g.unitById(id);
      if (!u || u.x === undefined) return;
      if (S.sel && S.sel.plan && S.sel.unit.id === id) return; // wird gerade bearbeitet
      var tgt = pl.action.type === 'attack' ? g.unitById(pl.action.targetId) : null;
      out.push({ path: pl.path, type: u.type, faction: facOf(u.p), flip: S.facing[u.p], act: pl.action.type,
        tx: tgt && tgt.x !== undefined ? tgt.x : null, ty: tgt && tgt.x !== undefined ? tgt.y : null });
    });
    return out;
  }
  function startPlan(u) {
    var g = S.game, me = S.net.slot;
    var reach = g.reachable(u, { viewer: me });
    var moveSet = {};
    reach.list.forEach(function (n) { if (n.end) moveSet[n.y * g.map.w + n.x] = 1; });
    var old = S.plans[u.id];
    var path = [{ x: u.x, y: u.y }];
    if (old) { var d = old.path[old.path.length - 1]; var pp = moveSet[d.y * g.map.w + d.x] ? g.pathTo(reach, d.x, d.y) : null; if (pp) path = pp; }
    S.inspect = null;
    S.sel = { unit: u, reach: reach, moveSet: moveSet, path: path, cost: 0, indirect: g.rangeOf(u)[0] > 1, attackSet: null,
      budget: Math.min(g.moveOf(u), u.fuel), plan: true };
    S.mode = 'move';
    UI.sfx('select');
    if (!S.planTipShown) { S.planTipShown = true; UI.toast('Vorplanen: Zielfeld antippen (oder einen Gegner für einen Angriff).', 3500); }
    updateHud(true);
  }
  /** Nach einem fremden Zug: geplante Auswahl an die neue Lage anpassen */
  function refreshPlanSelection() {
    if (!(S.sel && S.sel.plan)) return;
    var u = S.game.unitById(S.sel.unit.id);
    if (!u || u.x === undefined) { closePlanning(); return; }
    var path = S.sel.path, end = path[path.length - 1];
    startPlanQuiet(u, end);
  }
  function startPlanQuiet(u, end) {
    var g = S.game, reach = g.reachable(u, { viewer: S.net.slot }), moveSet = {};
    reach.list.forEach(function (n) { if (n.end) moveSet[n.y * g.map.w + n.x] = 1; });
    var path = moveSet[end.y * g.map.w + end.x] ? g.pathTo(reach, end.x, end.y) : [{ x: u.x, y: u.y }];
    Object.assign(S.sel, { unit: u, reach: reach, moveSet: moveSet, path: path, budget: Math.min(g.moveOf(u), u.fuel) });
  }
  function closePlanning() {
    if (S.planMenu) { try { S.planMenu.close(); } catch (e) { /* egal */ } S.planMenu = null; }
    if (S.sel && S.sel.plan) { S.sel = null; S.mode = 'free'; }
  }
  function savePlan(u, path, action, label) {
    S.plans[u.id] = { path: path.map(function (q) { return { x: q.x, y: q.y }; }), action: action };
    var i = S.planOrder.indexOf(u.id); if (i >= 0) S.planOrder.splice(i, 1);
    S.planOrder.push(u.id);
    S.sel = null; S.mode = 'free';
    UI.sfx('confirm');
    UI.toast('Geplant: ' + G.UNITS[u.type].name + ' – ' + label + ' (' + S.planOrder.length + ' Plan' + (S.planOrder.length > 1 ? 'e' : '') + ')', 2200);
    updateHud(true);
  }
  function dropPlan(u) {
    delete S.plans[u.id];
    var i = S.planOrder.indexOf(u.id); if (i >= 0) S.planOrder.splice(i, 1);
    S.sel = null; S.mode = 'free';
    UI.sfx('cancel'); UI.toast('Plan gelöscht.');
  }
  function planMoveAction(a, ev) {
    var g = S.game, sel = S.sel, u = sel.unit;
    if (a === 'b') { S.sel = null; S.mode = 'free'; UI.sfx('cancel'); setCursor(u.x, u.y); return true; }
    if (a === 'info') { showInfo(S.cursor.x, S.cursor.y); return true; }
    if (a !== 'a') return true;
    var x = S.cursor.x, y = S.cursor.y, idx = y * g.map.w + x;
    var enemy = g.unitAt(x, y);
    if (enemy && g.isEnemy(enemy.p, u.p) && g.unitVisibleTo(enemy, u.p)) {
      var ap = autoAttackPath(u, enemy);
      if (ap) { savePlan(u, ap, { type: 'attack', targetId: enemy.id }, 'Angriff auf ' + G.UNITS[enemy.type].name); return true; }
      if (ev && ev.pointer) { S.sel = null; S.mode = 'free'; UI.sfx('cancel'); return true; }
      UI.sfx('error'); UI.toast('Dieses Ziel ist von hier aus nicht erreichbar.'); return true;
    }
    if (!sel.moveSet[idx]) {
      if (ev && ev.pointer) { S.sel = null; S.mode = 'free'; UI.sfx('cancel'); return true; }   // außerhalb angetippt: Auswahl aufheben
      UI.sfx('error'); return true;
    }
    var path = sel.path, end = path[path.length - 1];
    if (end.x !== x || end.y !== y) path = g.pathTo(sel.reach, x, y);
    sel.path = path;
    var acts = g.actionsFor(u, path, false), items = [];
    if (path.length > 1 && G.UNITS[u.type].capture && u.cp < G.RULES.capturePoints) items.push({ head: true, cls: 'warn-head', label: '⚑ Achtung: Wegziehen bricht die laufende Einnahme ab' });
    acts.forEach(function (ac) {
      if (ac.type === 'attack') {
        ac.targets.slice(0, 4).forEach(function (t) {
          items.push({ label: 'Angriff: ' + G.UNITS[t.type].name + ' (' + g.dispHp(t) + ' KP)', value: { action: { type: 'attack', targetId: t.id }, label: 'Angriff auf ' + G.UNITS[t.type].name } });
        });
      } else if (['capture', 'join', 'load', 'supply', 'dive', 'surface', 'wait'].indexOf(ac.type) >= 0) {
        var it = { label: ac.type === 'wait' ? (path.length > 1 ? 'Hierhin ziehen' : 'Stehen bleiben') : ACTION_LABEL[ac.type], value: { action: { type: ac.type }, label: ac.type === 'wait' ? 'Ziel (' + (x + 1) + '|' + (y + 1) + ')' : ACTION_LABEL[ac.type] } };
        if (ac.type === 'capture') { var left = captureLeft(u, path); it.sub = left ? 'noch ' + left + '/' + G.RULES.capturePoints : '✓ fällt dann'; }
        items.push(it);
      }
    });
    if (S.plans[u.id]) items.push({ label: 'Plan löschen', value: { drop: true } });
    if (!items.length) { UI.sfx('error'); return true; }
    var sp = screenPos(path[path.length - 1]);
    S.planMenu = UI.menu(items, {
      title: 'Vorplanen', x: sp.x + tileCss() + 10, y: sp.y - 10,
      onSelect: function (it) {
        S.planMenu = null;
        if (!S.sel || !S.sel.plan) return;
        if (it.value.drop) { dropPlan(u); return; }
        savePlan(u, S.sel.path, it.value.action, it.value.label);
      },
      onCancel: function () { S.planMenu = null; }
    });
    return true;
  }
  /** Zu Beginn des eigenen Zuges: Pläne der Reihe nach ausführen */
  async function runPlans() {
    var me = S, g = S.game, slot = S.net.slot, ids = S.planOrder.slice(), done = 0, failed = [];
    UI.toast('Vorgeplante Züge werden ausgeführt …', 1800);
    for (var i = 0; i < ids.length; i++) {
      if (S !== me || g.over || !isHumanTurn()) return;
      var id = ids[i], pl = S.plans[id];
      delete S.plans[id];
      var u = g.unitById(id);
      if (!pl || !u || u.x === undefined || u.p !== slot) continue;
      var name = G.UNITS[u.type].name;
      if (u.moved) { failed.push(name); continue; }
      var dest = pl.path[pl.path.length - 1], path;
      if (dest.x === u.x && dest.y === u.y) path = [{ x: u.x, y: u.y }];
      else {
        var reach = g.reachable(u), n = reach.nodes[dest.y * g.map.w + dest.x];
        path = n && n.end ? g.pathTo(reach, dest.x, dest.y) : null;
      }
      if (!path) { failed.push(name); continue; }
      var acts = g.actionsFor(u, path, false), action = null;
      if (pl.action.type === 'attack') {
        var att = acts.filter(function (q) { return q.type === 'attack'; })[0];
        var tg = att && att.targets.filter(function (t) { return t.id === pl.action.targetId; })[0];
        if (tg) action = { type: 'attack', targetId: tg.id };
      } else if (acts.some(function (q) { return q.type === pl.action.type; })) action = { type: pl.action.type };
      if (!action) { failed.push(name); continue; }
      var sim = g.simulatePath(u, path);
      S.busy = true;
      if (!tileOnScreen(u.x, u.y)) { ensureVisible(u.x, u.y, 3); await UI.sleep(120); }
      S.cursor = { x: u.x, y: u.y };
      await animateMove(u, sim.path, 60);
      var end = sim.path[sim.path.length - 1];
      S.anim[u.id] = { x: end.x, y: end.y, flip: S.anim[u.id] ? S.anim[u.id].flip : S.facing[u.p] };
      S.cursor = { x: end.x, y: end.y };
      if (sim.trapped) {
        R.floatText(end.x, end.y, '!', '#ffe040'); UI.sfx('trap');
        UI.toast('Hinterhalt! ' + name + ' wurde aufgehalten.');
        await UI.sleep(400);
        action = { type: 'wait' };
      }
      await commitAndPlay(u.id, path, action);
      done++;
    }
    if (S !== me) return;
    S.plans = {}; S.planOrder.length = 0;
    if (savedPlans && savedPlans.code === S.net.code) savedPlans.plans = S.plans;
    if (failed.length) UI.toast(done + ' Plan' + (done === 1 ? '' : 'e') + ' ausgeführt. Nicht mehr möglich: ' + failed.join(', ') + ' – diese Einheiten sind frei.', 5000);
    else if (done) UI.toast(done + ' vorgeplante' + (done === 1 ? 'r Zug' : ' Züge') + ' ausgeführt. Die übrigen Einheiten kannst du jetzt ziehen.', 3500);
    updateHud(true);
  }

  // ---------------------------------------------------------------- Bewegung ausführen
  async function animateMove(u, path, speedMs) {
    if (path.length < 2) return;
    var T = G.UNITS[u.type];
    UI.sfx(MOVE_SFX[T.mt] || 'move_foot');
    var ms = speedMs != null ? speedMs : 70;
    if (ms <= 0) return;
    for (var i = 1; i < path.length; i++) {
      var a = path[i - 1], b = path[i];
      var flip = b.x < a.x ? true : b.x > a.x ? false : (S.anim[u.id] ? S.anim[u.id].flip : S.facing[u.p]);
      var t0 = performance.now();
      while (true) {
        var p = Math.min(1, (performance.now() - t0) / ms);
        S.anim[u.id] = { x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p, flip: flip };
        if (p >= 1) break;
        await nextFrame();
      }
      if ((isAiTurn() || S.busy) && followRemote()) ensureVisible(b.x, b.y, 3);
      if (T.mt === 'tread' || T.mt === 'tire') R.addFx({ type: 'dust', x: a.x, y: a.y, dur: 420 });
    }
  }
  function nextFrame() { return new Promise(function (r) { requestAnimationFrame(function () { r(); }); }); }

  async function executeMove(path, autoTarget) {
    var g = S.game, u = S.sel.unit;
    var sim = g.simulatePath(u, path);
    S.busy = true;
    await animateMove(u, sim.path, 60);
    var end = sim.path[sim.path.length - 1];
    S.anim[u.id] = { x: end.x, y: end.y, flip: S.anim[u.id] ? S.anim[u.id].flip : S.facing[u.p] };
    S.busy = false;
    S.cursor = { x: end.x, y: end.y };
    if (sim.trapped) {
      R.floatText(end.x, end.y, '!', '#ffe040');
      UI.sfx('trap');
      UI.toast('Hinterhalt! Ein versteckter Gegner blockiert den Weg.');
      await UI.sleep(500);
      await commitAndPlay(u.id, path, { type: 'wait' });
      return;
    }
    S.movePath = sim.path;
    if (autoTarget) {
      var acts0 = g.actionsFor(u, sim.path, false);
      var att = acts0.filter(function (x) { return x.type === 'attack'; })[0];
      if (att && att.targets.indexOf(autoTarget) >= 0) {
        enterTargetMode(att.targets, autoTarget);
        return;
      }
    }
    openActionMenu();
  }
  function openActionMenu() {
    var g = S.game, u = S.sel.unit, path = S.movePath;
    var acts = g.actionsFor(u, path, false);
    S.mode = 'action';
    if (!acts.length) { revertMove(); return; }
    var items = acts.map(function (a) {
      var it = { label: ACTION_LABEL[a.type], value: a };
      if (a.type === 'capture') { var left = captureLeft(u, path); it.sub = left ? 'noch ' + left + '/' + G.RULES.capturePoints : '✓ fällt jetzt'; it.cls = 'capture'; }
      return it;
    });
    if (u.cargo && u.cargo.length) items.unshift({ head: true, cls: 'cargo-head', label: '▣ ' + cargoText(u) });
    var sp = screenPos(path[path.length - 1]);
    UI.menu(items, {
      x: sp.x + tileCss() + 10, y: sp.y - 10,
      onSelect: function (it) { doAction(it.value); },
      onCancel: function () { revertMove(); }
    });
  }
  function revertMove() {
    var u = S.sel.unit;
    delete S.anim[u.id];
    S.mode = 'move';
    var end = S.movePath[S.movePath.length - 1];
    S.cursor = { x: end.x, y: end.y };
    updateHud(true);
  }
  function tileCss() { var r = canvas.getBoundingClientRect(); return TS * S.scale * r.width / canvas.width; }
  function screenPos(t) {
    var r = canvas.getBoundingClientRect();
    return { x: r.left + (t.x - S.cam.x) * TS * S.scale * r.width / canvas.width, y: r.top + (t.y - S.cam.y) * TS * S.scale * r.height / canvas.height };
  }
  function doAction(a) {
    var u = S.sel.unit;
    if (a.type === 'attack') { enterTargetMode(a.targets); return; }
    if (a.type === 'unload') { startUnload(a.options); return; }
    if (a.type === 'fortify') { chooseFortify(a.options); return; }
    if (a.type === 'repair') {
      pickTile(a.targets.map(function (t) { return { x: t.x, y: t.y, unit: t }; }), function (t) {
        commitAndPlay(u.id, S.movePath, { type: 'repair', targetId: t.unit.id });
      }, function () { openActionMenu(); });
      return;
    }
    var action = { type: a.type };
    commitAndPlay(u.id, S.movePath, action);
  }

  // ---------------------------------------------------------------- Zielwahl
  function enterTargetMode(targets, preferred) {
    S.mode = 'target';
    S.targets = targets.slice().sort(function (a, b) { return a.y - b.y || a.x - b.x; });
    S.targetIdx = preferred ? Math.max(0, S.targets.indexOf(preferred)) : 0;
    S.targetSet = {};
    S.targets.forEach(function (t) { S.targetSet[t.y * S.game.map.w + t.x] = 1; });
    focusTarget();
  }
  function focusTarget() {
    var t = S.targets[S.targetIdx], u = S.sel.unit, end = S.movePath[S.movePath.length - 1];
    S.cursor = { x: t.x, y: t.y };
    ensureVisible(t.x, t.y);
    var probe = Object.assign({}, u, { x: end.x, y: end.y });
    showForecast(probe, t, end.x, end.y);
    updateHud(true);
  }
  function targetIndexAt(x, y) {
    for (var i = 0; i < (S.targets || []).length; i++) if (S.targets[i].x === x && S.targets[i].y === y) return i;
    return -1;
  }
  function cycleTarget(d) {
    S.targetIdx = (S.targetIdx + d + S.targets.length) % S.targets.length;
    UI.sfx('cursor');
    focusTarget();
  }
  function targetAction(a, ev) {
    if (a === 'b') { hideForecast(); S.mode = 'action'; openActionMenu(); UI.sfx('cancel'); return true; }
    if (a !== 'a') return true;
    var g = S.game;
    var t = S.targets[S.targetIdx];
    if (ev && ev.pointer) {
      var clicked = S.targets.filter(function (q) { return q.x === S.cursor.x && q.y === S.cursor.y; })[0];
      if (!clicked) { // Klick auf anderes Feld: zurück
        hideForecast(); S.mode = 'action'; openActionMenu(); return true;
      }
      t = clicked;
    }
    hideForecast();
    commitAndPlay(S.sel.unit.id, S.movePath, { type: 'attack', targetId: t.id });
    return true;
  }

  // ---------------------------------------------------------------- Feld wählen (Befestigen, Reparieren)
  function pickTile(tiles, onPick, onCancel) {
    S.pick = { tiles: tiles, idx: 0, onPick: onPick, onCancel: onCancel };
    S.mode = 'pickTile';
    S.cursor = { x: tiles[0].x, y: tiles[0].y };
    updateHud(true);
  }
  function pickTileAction(a, ev) {
    var P2 = S.pick;
    if (a === 'up' || a === 'down' || a === 'left' || a === 'right') {
      P2.idx = (P2.idx + (a === 'down' || a === 'right' ? 1 : -1) + P2.tiles.length) % P2.tiles.length;
      S.cursor = { x: P2.tiles[P2.idx].x, y: P2.tiles[P2.idx].y }; UI.sfx('cursor'); updateHud(); return true;
    }
    if (a === 'b') { S.mode = 'action'; UI.sfx('cancel'); P2.onCancel(); return true; }
    if (a !== 'a') return true;
    var t = P2.tiles.filter(function (q) { return q.x === S.cursor.x && q.y === S.cursor.y; })[0];
    if (!t) { if (ev && ev.pointer) { S.mode = 'action'; P2.onCancel(); } else UI.sfx('error'); return true; }
    UI.sfx('select');
    P2.onPick(t);
    return true;
  }
  function chooseFortify(options) {
    var g = S.game, cp = g.currentPlayer();
    var items = options.map(function (o) {
      var c = R.unitCanvas(o.type, cp.faction, 32);
      return { label: G.UNITS[o.type].name, sub: UI.fmt(o.cost) + ' G', icon: c, value: o, disabled: !o.affordable || !o.tiles.length };
    });
    var sp = screenPos(S.movePath[S.movePath.length - 1]);
    S.mode = 'action';
    UI.menu(items, {
      title: 'Befestigen · G ' + UI.fmt(cp.funds), cls: 'build', allowDisabledFocus: true, x: sp.x + tileCss() + 10, y: sp.y - 10,
      onSelect: function (it) {
        pickTile(it.value.tiles, function (t) {
          commitAndPlay(S.sel.unit.id, S.movePath, { type: 'fortify', build: it.value.type, x: t.x, y: t.y });
        }, function () { chooseFortify(options); });
      },
      onCancel: function () { openActionMenu(); }
    });
  }

  // ---------------------------------------------------------------- Entladen
  function startUnload(options) {
    S.unloads = [];
    S.unloadOptions = options;
    chooseCargo();
  }
  function remainingOptions() {
    var used = S.unloads.map(function (u) { return u.x + ',' + u.y; });
    var taken = S.unloads.map(function (u) { return u.idx; });
    return S.unloadOptions.filter(function (o) { return taken.indexOf(o.idx) < 0; }).map(function (o) {
      return { idx: o.idx, unit: o.unit, tiles: o.tiles.filter(function (t) { return used.indexOf(t.x + ',' + t.y) < 0; }) };
    }).filter(function (o) { return o.tiles.length; });
  }
  function chooseCargo() {
    var rem = remainingOptions();
    if (!rem.length) { finishUnload(); return; }
    var items = rem.map(function (o) { return { label: G.UNITS[o.unit.type].name + ' (' + S.game.dispHp(o.unit) + ' KP)', value: o }; });
    if (S.unloads.length) items.push({ label: 'Fertig', value: null });
    var sp = screenPos(S.movePath[S.movePath.length - 1]);
    S.mode = 'action';
    UI.menu(items, {
      title: 'Absetzen', x: sp.x + tileCss() + 10, y: sp.y - 10,
      onSelect: function (it) {
        if (!it.value) { finishUnload(); return; }
        S.unloadCur = it.value;
        S.unloadTiles = it.value.tiles;
        S.unloadTileIdx = 0;
        S.mode = 'unloadTile';
        S.cursor = { x: S.unloadTiles[0].x, y: S.unloadTiles[0].y };
      },
      onCancel: function () {
        if (S.unloads.length) { S.unloads.pop(); chooseCargo(); }
        else { S.mode = 'action'; openActionMenu(); }
      }
    });
  }
  function cycleUnloadTile(d) {
    S.unloadTileIdx = (S.unloadTileIdx + d + S.unloadTiles.length) % S.unloadTiles.length;
    var t = S.unloadTiles[S.unloadTileIdx];
    S.cursor = { x: t.x, y: t.y }; UI.sfx('cursor'); updateHud();
  }
  function unloadTileAction(a, ev) {
    if (a === 'b') { chooseCargo(); UI.sfx('cancel'); return true; }
    if (a !== 'a') return true;
    var t = S.unloadTiles.filter(function (q) { return q.x === S.cursor.x && q.y === S.cursor.y; })[0];
    if (!t) { if (ev && ev.pointer) { chooseCargo(); } else UI.sfx('error'); return true; }
    S.unloads.push({ idx: S.unloadCur.idx, x: t.x, y: t.y });
    UI.sfx('select');
    var rem = remainingOptions();
    if (rem.length) chooseCargo(); else finishUnload();
    return true;
  }
  function finishUnload() {
    if (!S.unloads.length) { S.mode = 'action'; openActionMenu(); return; }
    commitAndPlay(S.sel.unit.id, S.movePath, { type: 'unload', unloads: S.unloads });
  }

  // ---------------------------------------------------------------- Ausführen & Ereignisse
  async function commitAndPlay(unitId, path, action) {
    var g = S.game;
    S.busy = true;
    S.mode = 'busy';
    var res = g.commit(unitId, path, action);
    if (res.ok) netSend({ t: 'unit', id: unitId, path: path.map(function (q) { return { x: q.x, y: q.y }; }), action: action });
    delete S.anim[unitId];
    S.sel = null;
    if (!res.ok) { console.warn('Befehl abgelehnt', res.error); UI.toast('Aktion nicht möglich.'); }
    else await playEvents(res.events);
    S.busy = false;
    S.mode = 'free';
    S.inspect = null;
    if (S.dangerOn) S.danger = computeDanger();
    if (S.visionOn) S.vision = computeEnemyVision();
    updateHud(true);
    if (g.over) { await gameOverFlow(); return; }
    if (isHumanTurn() && !g.readyUnits(g.currentPlayer().slot).length && UI.settings.confirmEnd) {
      // alle Einheiten fertig: Hinweis
      UI.toast('Alle Einheiten haben gehandelt. [E] beendet die Runde.');
    }
  }

  async function playEvents(events) {
    var g = S.game;
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      switch (ev.type) {
        case 'attack': await playAttack(ev); break;
        case 'capture': await playCapture(ev); break;
        case 'hqfall':
          await UI.banner('HQ GEFALLEN!', facName(ev.slot) + ' ist besiegt.', G.FACTIONS[facOf(ev.by)].colors[1], 1800);
          rebuildTerrain();
          break;
        case 'eliminated':
          rebuildTerrain();
          await UI.banner(facName(ev.slot) + ' besiegt', ev.reason === 'rout' ? 'Keine Einheiten mehr.' : ev.reason === 'resign' ? 'Aufgegeben.' : '', '#606070', 1600);
          break;
        case 'join': UI.sfx('supply'); if (ev.refund) { R.floatText(ev.x, ev.y, '+' + ev.refund + ' G', '#ffe070'); UI.sfx('coin'); } break;
        case 'load': UI.sfx('load'); break;
        case 'unload': UI.sfx('unload'); break;
        case 'fortify':
          UI.sfx('build'); R.addFx({ type: 'sparkle', x: ev.x, y: ev.y, dur: 900 });
          R.floatText(ev.x, ev.y, '-' + UI.fmt(ev.cost) + ' G', '#ffe070');
          break;
        case 'repair':
          if (ev.by) { UI.sfx('repair'); R.addFx({ type: 'sparkle', x: ev.x, y: ev.y, dur: 700 }); R.floatText(ev.x, ev.y, '+' + ev.amount + ' KP', '#a0f8a0'); }
          else R.addFx({ type: 'sparkle', x: ev.x, y: ev.y, dur: 700 });
          break;
        case 'supply': UI.sfx('supply'); R.addFx({ type: 'sparkle', x: ev.x, y: ev.y, dur: 700 }); R.floatText(ev.x, ev.y, 'Nachschub', '#a0f8a0'); break;
        case 'dive': UI.sfx('dive'); break;
        case 'surface': UI.sfx('surface'); break;
        case 'trap':
          if (ev.unload) { R.floatText(ev.bx, ev.by, '!', '#ffe040'); UI.sfx('trap'); UI.toast('Absetzen blockiert – dort versteckt sich ein Gegner!'); }
          break;
        case 'crash':
          R.explosion(ev.x, ev.y, true); UI.sfx('explosion');
          UI.toast(G.UNITS[ev.unitType].name + ' ohne Treibstoff verloren!');
          await UI.sleep(500); break;
        case 'repair': R.addFx({ type: 'sparkle', x: ev.x, y: ev.y, dur: 700 }); break;
        case 'gameover': break;
      }
      updateHud(true);
    }
  }
  function facName(slot) { var p = S.game.playerBySlot(slot); return p ? p.name : '?'; }
  function rebuildTerrain() { S.terrainViewer = undefined; S.viewMap = null; S.terrain = R.buildTerrain(S.game.map); syncExploreTerrain(); }

  function shotSfx(type) {
    var T = G.UNITS[type];
    if (type === 'arty' || type === 'battleship') return 'shot_artillery';
    if (type === 'rocket' || type === 'missile' || type === 'mech' || type === 'bcopter' || type === 'bomber' || type === 'sub') return 'shot_rocket';
    if (type === 'aa' || type === 'cruiser') return 'shot_aa';
    if (T.cls === 'foot' || type === 'recon' || type === 'fighter') return 'shot_mg';
    return 'shot_cannon';
  }
  async function playAttack(ev) {
    var g = S.game;
    var visible = S.viewer == null || g.tileVisible(S.viewer, ev.att.x, ev.att.y) || g.tileVisible(S.viewer, ev.def.x, ev.def.y) ||
      g.isAlly(ev.att.p, S.viewer) || g.isAlly(ev.def.p, S.viewer);
    var mode = UI.settings.battleAnim;
    if (isAiTurn() && speed() === 'instant') mode = 'off';
    if (visible && mode !== 'off') await battleScene(ev, mode === 'short');
    else if (visible) { UI.sfx(shotSfx(ev.att.type)); await UI.sleep(isAiTurn() && speed() !== 'normal' ? 80 : 200); }
    if (ev.dmg) R.floatText(ev.def.x, ev.def.y, '-' + (Math.ceil(ev.def.hp0 / 10) - Math.ceil(ev.def.hp1 / 10)), '#ff8070');
    if (ev.counter) R.floatText(ev.att.x, ev.att.y, '-' + (Math.ceil(ev.att.hp0 / 10) - Math.ceil(ev.att.hp1 / 10)), '#ff8070');
    if (ev.killedDef) { R.explosion(ev.def.x, ev.def.y, true); UI.sfx('explosion'); }
    if (ev.killedAtt) { R.explosion(ev.att.x, ev.att.y, true); UI.sfx('explosion'); }
    if (ev.killedDef || ev.killedAtt) await UI.sleep(isAiTurn() && speed() === 'instant' ? 50 : 450);
  }
  function battleScene(ev, short) {
    return new Promise(function (resolve) {
      var g = S.game;
      var wrap = h('div', { id: 'battle-wrap' });
      var W = Math.min(820, window.innerWidth - 24), H2 = Math.round(W * 0.46);
      var c = h('canvas', { width: W, height: H2 });
      wrap.appendChild(c);
      $('#overlay').appendChild(wrap);
      var bctx = c.getContext('2d');
      var plan = R.battlePlan(ev, short);
      var base = {
        ev: ev, plan: plan, theme: g.theme, weather: g.weather,
        att: { type: ev.att.type, faction: facOf(ev.att.p), terrain: g.map.terrain[ev.att.y][ev.att.x] },
        def: { type: ev.def.type, faction: facOf(ev.def.p), terrain: g.inBounds(ev.def.x, ev.def.y) ? g.map.terrain[ev.def.y][ev.def.x] : 'P' }
      };
      // Geräusche entlang des Zeitplans
      var cues = [{ t: plan.aFire, s: shotSfx(ev.att.type) }, { t: plan.aImp, s: ev.killedDef ? 'explosion' : 'hit' }];
      if (plan.counter) cues.push({ t: plan.dFire, s: shotSfx(ev.def.type) }, { t: plan.dImp, s: ev.killedAtt ? 'explosion' : 'hit' });
      var t0 = performance.now(), done = false;
      function finish() { if (done) return; done = true; if (wrap.parentNode) wrap.parentNode.removeChild(wrap); UI.pop(layer); resolve(); }
      var layer = UI.push({ modal: true, onAction: function (a) { if (a === 'a' || a === 'b') finish(); return true; } });
      wrap.addEventListener('pointerdown', finish);
      function frame(now) {
        if (done) return;
        var t = now - t0;
        cues.forEach(function (q) { if (!q.done && t >= q.t) { q.done = true; UI.sfx(q.s); } });
        R.drawBattle(bctx, W, H2, Object.assign({ t: t, time: now }, base));
        if (t > plan.end) { finish(); return; }
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
  }
  async function playCapture(ev) {
    var g = S.game;
    var visible = S.viewer == null || g.tileVisible(S.viewer, ev.x, ev.y);
    if (!visible) return;
    UI.sfx(ev.done ? 'capture_done' : 'capture_tick');
    var box = h('div', { class: 'panel', style: { position: 'absolute', left: '50%', top: '30%', transform: 'translate(-50%,-50%)', textAlign: 'center', zIndex: 45, minWidth: '220px' } });
    var bar = h('div', { style: { height: '14px', background: '#ccc', border: '2px solid #181018', borderRadius: '3px', overflow: 'hidden', margin: '6px 0' } });
    var fill = h('div', { style: { height: '100%', width: (ev.left / 20 * 100) + '%', background: G.FACTIONS[facOf(ev.p)].colors[1], transition: 'width .5s' } });
    bar.appendChild(fill);
    box.appendChild(h('div', { style: { fontWeight: 'bold', fontSize: '18px' }, text: ev.done ? 'Eingenommen!' : 'Einnahme läuft' }));
    box.appendChild(bar);
    box.appendChild(h('div', { text: ev.done ? g.terrainAt(ev.x, ev.y).name + ' gehört jetzt ' + facName(ev.p) + '.' : 'Noch ' + ev.left + ' von 20 Punkten' }));
    $('#overlay').appendChild(box);
    if (ev.done) { R.updateTiles(S.terrain, g.map, [{ x: ev.x, y: ev.y }]); R.addFx({ type: 'sparkle', x: ev.x, y: ev.y, dur: 900 }); }
    var fast = isAiTurn() && speed() !== 'normal';
    await UI.sleep(fast ? 300 : isAiTurn() ? 550 : 800);
    box.parentNode && box.parentNode.removeChild(box);
  }

  // ================================================================ Menüs
  function openMainMenu() {
    var g = S.game, cp = g.currentPlayer(), co = g.coOf(cp.slot);
    var human = isHumanTurn();
    var items = [];
    if (human) {
      items.push({ label: 'Runde beenden', value: 'end' });
      var cu = g.canUndo(cp.slot);
      items.push({ label: 'Zug rückgängig', sub: cu.ok ? '1× je Runde' : cu.reason.split(' (')[0], value: 'undo', disabled: !cu.ok });
      if (g.meta.powers !== false) {
        items.push({ label: co.power.name, sub: co.power.stars + '★', value: 'p1', disabled: !g.canActivate(cp.slot, 1) });
        items.push({ label: co.superPower.name, sub: co.superPower.stars + '★', value: 'p2', disabled: !g.canActivate(cp.slot, 2) });
      }
    }
    if (S.net) {
      items.push({ label: 'Nachricht senden', value: 'chat' });
      if (S.net.host && !cp.ai && cp.slot !== S.net.slot && !G.Net.isOnline(cp.slot)) items.push({ label: cp.name + ' an KI übergeben', value: 'takeover' });
      if (S.net.tr && S.net.tr.reconnectMenu) items.push({ label: S.net.host ? 'Mitspieler verbinden' : 'Neu verbinden', value: 'p2p' });
    }
    items.push({ label: 'Kommandanten', value: 'co' });
    items.push({ label: 'Lagebericht', value: 'intel' });
    items.push({ label: 'Gegner-Sicht', sub: S.visionOn ? 'an' : 'aus', value: 'vision' });
    items.push({ label: 'Gegner-Reichweite', sub: S.dangerOn ? 'an' : 'aus', value: 'danger' });
    if (g.meta.mode === 'campaign') items.push({ label: 'Missionsziel', value: 'goal' });
    if (human && !S.net) items.push({ label: 'Speichern', value: 'save' });
    items.push({ label: 'Optionen', value: 'options' });
    items.push({ label: 'Anleitung', value: 'help' });
    if (human) items.push({ label: 'Aufgeben', value: 'resign' });
    items.push({ label: S.net ? 'Spiel verlassen' : 'Hauptmenü', value: 'quit' });
    UI.menu(items, {
      title: 'Tag ' + g.day,
      onSelect: function (it) {
        switch (it.value) {
          case 'end': askEndTurn(); break;
          case 'undo': doUndo(); break;
          case 'p1': activatePower(1); break;
          case 'p2': activatePower(2); break;
          case 'co': showCoInfo(); break;
          case 'intel': showIntel(); break;
          case 'vision': toggleVision(); break;
          case 'danger': toggleDanger(); break;
          case 'goal': UI.alert(objectiveText(g)); break;
          case 'save': openSaveMenu(); break;
          case 'options': showOptionsOverlay(); break;
          case 'help': showHelpOverlay(); break;
          case 'resign': UI.confirm('Wirklich aufgeben?').then(function (ok) { if (ok) resign(); }); break;
          case 'chat': UI.chatMenu(); break;
          case 'p2p': S.net.tr.reconnectMenu(S.net); break;
          case 'takeover':
            UI.confirm(cp.name + ' ist nicht verbunden. Seinen Zug und alle weiteren von der KI spielen lassen?').then(function (ok) {
              if (ok) G.Net.request({ t: 'ai', slot: cp.slot }).then(function (r) { if (!r.ok) UI.toast(r.error || 'Nicht möglich.'); });
            });
            break;
          case 'quit':
            if (S.net) {
              UI.confirm(S.net.tr ? 'Spiel verlassen? Ihr könnt später über „Handy zu Handy“ → „Deine Spiele“ weiterspielen.' : 'Spiel verlassen? Du kannst später über „Online-Gefecht“ wieder einsteigen.').then(function (ok) {
                if (ok) { G.Net.leave(false); P.stop(); UI.showTitle(); }
              });
              break;
            }
            UI.confirm('Zum Hauptmenü? Nicht gespeicherter Fortschritt geht verloren (Autosave bleibt).').then(function (ok) { if (ok) { P.stop(); UI.showTitle(); } }); break;
        }
      },
      onCancel: function () {}
    });
  }
  function openPowerMenu() {
    var g = S.game, cp = g.currentPlayer(), co = g.coOf(cp.slot);
    if (g.meta.powers === false) return;
    if (!g.canActivate(cp.slot, 1)) { UI.toast('Die Kraft ist noch nicht bereit.'); return; }
    UI.menu([
      { label: co.power.name, sub: co.power.stars + '★', value: 1, disabled: !g.canActivate(cp.slot, 1) },
      { label: co.superPower.name, sub: co.superPower.stars + '★', value: 2, disabled: !g.canActivate(cp.slot, 2) }
    ], { title: 'CO-Kraft', onSelect: function (it) { activatePower(it.value); }, onCancel: function () {} });
  }
  async function activatePower(level) {
    var g = S.game, cp = g.currentPlayer();
    var ev = g.activatePower(cp.slot, level);
    if (!ev) return;
    netSend({ t: 'power', level: level });
    S.busy = true;
    await powerBanner(ev);
    S.busy = false;
    updateHud(true);
  }
  async function powerBanner(ev) {
    var pl = S.game.playerBySlot(ev.slot), co = S.game.coOf(ev.slot);
    UI.sfx(ev.level === 2 ? 'power_super' : 'power');
    UI.music('power');
    await UI.banner(ev.name.toUpperCase(), co.name + (ev.level === 2 ? ' · SUPERKRAFT' : ' · KRAFT') + (co.fused ? ' (FUSION)' : ''), G.FACTIONS[pl.faction].colors[1], 2000,
      { power: true, portrait: R.portraitCanvas(ev.co, pl.faction, null, ev.co2 || pl.co2) });
    // Sofort-Effekte sichtbar machen
    S.game.units.forEach(function (u) { if (u.p === ev.slot || S.game.isEnemy(u.p, ev.slot)) R.addFx({ type: 'sparkle', x: u.x, y: u.y, dur: 600 }); });
  }
  function openBuildMenu(x, y) {
    var g = S.game, cp = g.currentPlayer();
    var opts = g.buildOptions(cp.slot, x, y);
    if (!opts.length) return;
    var items = opts.map(function (o) {
      var c = R.unitCanvas(o.type, cp.faction, 32);
      return { label: G.UNITS[o.type].name, sub: UI.fmt(o.cost) + ' G', icon: c, value: o, disabled: !o.affordable };
    });
    var touch = window.matchMedia && window.matchMedia('(hover: none), (pointer: coarse)').matches;
    var desc = h('div', { class: 'panel build-desc' });
    function doBuild(o) {
      cleanupDesc();
      var u = g.build(cp.slot, o.type, x, y);
      if (u) netSend({ t: 'build', type: o.type, x: x, y: y });
      if (u) { UI.sfx('build'); R.addFx({ type: 'sparkle', x: x, y: y, dur: 800 }); updateHud(true); }
      else if (g.unitAt(x, y)) { UI.sfx('trap'); UI.toast('Blockiert! Ein versteckter Gegner steht auf dem Gebäude.'); }
    }
    var m = UI.menu(items, {
      title: 'Bauen · G ' + UI.fmt(cp.funds), cls: 'build', allowDisabledFocus: true, touchConfirm: true,
      x: 16, y: 16,
      onHover: function (it) {
        var T = G.UNITS[it.value.type];
        var R2 = T.range;
        desc.innerHTML = '<b>' + UI.esc(T.name) + '</b> · ' + UI.fmt(it.value.cost) + ' G<br>' + UI.esc(T.desc) +
          '<div class="bstats"><span>Bew ' + T.move + '</span><span>Sicht ' + T.vision + '</span><span>Treibst ' + T.fuel + '</span>' +
          (T.ammo ? '<span>Mun ' + T.ammo + '</span>' : '') + (R2[1] > 1 ? '<span>Reichw ' + R2[0] + '–' + R2[1] + '</span>' : '') + (T.cap ? '<span>Lädt ' + T.cap + '</span>' : '') + '</div>' +
          '<div class="bhint">' + (touch ? (it.disabled ? 'Zu teuer · ' : 'Nochmal tippen zum Bauen · ') + 'Knopf „i“ zeigt alle Werte' : 'Enter bauen · I alle Werte') + '</div>';
        fitDesc();
      },
      info: function (it) {
        UI.unitSheet(it.value.type, cp.faction, { build: { cost: it.value.cost, affordable: it.value.affordable } }).then(function (go) {
          if (go && !m.isClosed()) { m.close(); doBuild(it.value); }
        });
      },
      onSelect: function (it) { doBuild(it.value); },
      onCancel: function () { cleanupDesc(); }
    });
    var wide = window.innerWidth - m.el.getBoundingClientRect().right > 220;
    if (wide) {
      var r = m.el.getBoundingClientRect();
      desc.style.left = (r.right + 8) + 'px'; desc.style.top = r.top + 'px'; desc.style.maxWidth = '300px';
    } else {
      // schmaler Bildschirm (Handy): Beschreibung fest unten, Liste darüber (rollbar, nichts verdeckt)
      desc.classList.add('bottom');
    }
    $('#overlay').appendChild(desc);
    fitDesc();
    function fitDesc() {
      if (wide || !desc.parentNode) return;
      var dh = desc.getBoundingClientRect().height;
      m.el.style.maxHeight = Math.max(140, window.innerHeight - dh - 40) + 'px';
    }
    function cleanupDesc() { if (desc.parentNode) desc.parentNode.removeChild(desc); }
    // aufräumen, falls das Menü anders geschlossen wird
    var watch = setInterval(function () { if (m.isClosed()) { clearInterval(watch); cleanupDesc(); } }, 300);
  }
  function openSaveMenu() {
    var items = [1, 2, 3].map(function (k) {
      var s = UI.Store.get('save:' + k, null);
      return { label: 'Slot ' + k, sub: s ? s.label : 'leer', value: k };
    });
    UI.menu(items, {
      title: 'Speichern',
      onSelect: function (it) { save(it.value); UI.toast('Gespeichert in Slot ' + it.value + '.'); UI.sfx('confirm'); },
      onCancel: function () {}
    });
  }
  function save(key) {
    var g = S.game;
    return UI.Store.set('save:' + key, { game: g.serialize(), label: UI.saveLabel(g), date: Date.now() });
  }
  P.save = save;
  async function resign() {
    var g = S.game;
    var ev = g.resign(g.currentPlayer().slot);
    netSend({ t: 'resign' });
    S.busy = true;
    await playEvents(ev);
    S.busy = false;
    if (g.over) await gameOverFlow();
    else await turnStartFlow(ev.filter(function (e) { return e.type !== 'eliminated'; }));
  }

  // ---------------------------------------------------------------- Info-Fenster
  function modalPanel(content, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var box = h('div', { class: 'panel', style: { position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', zIndex: 48, maxWidth: 'min(920px, 94vw)', maxHeight: '88vh', overflow: 'auto' } });
      box.appendChild(content);
      box.appendChild(h('div', { class: 'actions' }, [h('button', { class: 'btn', text: 'Schließen', onclick: close })]));
      $('#overlay').appendChild(box);
      function close() { if (box.parentNode) box.parentNode.removeChild(box); UI.pop(layer); resolve(); }
      var layer = UI.push({ modal: true, onAction: function (a) {
        if (a === 'b' || a === 'a' || a === 'info' || a === 'keys') close();
        else if (a === 'down') box.scrollTop += 60; else if (a === 'up') box.scrollTop -= 60;
        return true;
      } });
    });
  }
  function showInfo(x, y) {
    var g = S.game, t = g.terrainAt(x, y);
    var root = h('div', {});
    var u = g.unitAt(x, y);
    if (u && (S.viewer == null || g.unitVisibleTo(u, S.viewer))) {
      var T = G.UNITS[u.type];
      var c = R.unitCanvas(u.type, facOf(u.p), 64);
      c.style.float = 'left'; c.style.marginRight = '10px';
      root.appendChild(c);
      var R2 = g.rangeOf(u);
      root.appendChild(h('h3', { text: T.name + ' (' + facName(u.p) + ')', style: { margin: '0 0 4px' } }));
      root.appendChild(h('p', { text: T.desc }));
      root.appendChild(h('p', { style: { fontFamily: 'monospace', clear: 'both' },
        text: 'KP ' + g.dispHp(u) + '/10 · Bewegung ' + g.moveOf(u) + ' · Sicht ' + T.vision + ' · Treibstoff ' + u.fuel + '/' + T.fuel +
          (T.ammo ? ' · Munition ' + u.ammo + '/' + T.ammo : '') + (R2[1] ? ' · Reichweite ' + R2[0] + '–' + R2[1] : '') + ' · Preis ' + UI.fmt(T.cost) }));
      var strong = [], weak = [];
      G.UNIT_ORDER.forEach(function (k) {
        var b = (G.DAMAGE[u.type].primary && G.DAMAGE[u.type].primary[k]) || (G.DAMAGE[u.type].secondary && G.DAMAGE[u.type].secondary[k]) || 0;
        if (b >= 70) strong.push(G.UNITS[k].short);
        var inc = (G.DAMAGE[k].primary && G.DAMAGE[k].primary[u.type]) || (G.DAMAGE[k].secondary && G.DAMAGE[k].secondary[u.type]) || 0;
        if (inc >= 70) weak.push(G.UNITS[k].short);
      });
      root.appendChild(h('p', { html: '<b>Stark gegen:</b> ' + (strong.join(', ') || '–') + '<br><b>Gefährdet durch:</b> ' + (weak.join(', ') || '–') }));
      if (u.cargo && u.cargo.length) root.appendChild(h('p', { text: 'Geladen: ' + u.cargo.map(function (c2) { return G.UNITS[c2.type].name + ' ' + g.dispHp(c2) + ' KP'; }).join(', ') }));
      root.appendChild(h('hr'));
    }
    root.appendChild(h('h3', { text: t.name + ' ' + '★'.repeat(t.def), style: { margin: '0 0 4px' } }));
    root.appendChild(h('p', { text: G.TERRAIN_DESC[t.id] || '' }));
    var mts = { foot: 'Infanterie', mech: 'Grenadier', tread: 'Kette', tire: 'Räder', air: 'Luft', ship: 'Schiff', trans: 'Landungsboot' };
    root.appendChild(h('p', { style: { fontFamily: 'monospace', fontSize: '12px' }, text: 'Bewegungskosten: ' + Object.keys(mts).map(function (k) { return mts[k] + ' ' + (t.move[k] || '–'); }).join(' · ') }));
    if (t.prop) { var o = g.ownerAt(x, y); root.appendChild(h('p', { text: 'Besitzer: ' + (o ? facName(o) : 'neutral') })); }
    modalPanel(root);
  }
  function showCoInfo() {
    var g = S.game, root = h('div', { class: 'co-grid' });
    g.players.forEach(function (p) {
      var co = g.coOf(p.slot);
      var extra = h('p', { html: '<b>' + UI.esc(p.name) + '</b>' + (p.alive ? '' : ' (besiegt)') + ' · Team ' + p.team + ' · Leiste ' + g.powerStars(p.slot).toFixed(1) + '★' + (p.powerActive ? ' · <b>Kraft aktiv</b>' : '') +
        (co.fused ? '<br><b>Fusion:</b> ' + UI.esc(co.fullName) + ' – ' + UI.esc(co.power.name) + ' (' + co.power.stars + '★) / ' + UI.esc(co.superPower.name) + ' (' + co.superPower.stars + '★)' : '') });
      var card = UI.coCard(p.co, extra, p.faction);
      root.appendChild(card);
      if (p.co2) root.appendChild(UI.coCard(p.co2, h('p', { html: '<b>Fusionspartner von ' + UI.esc(p.name) + '</b>' }), p.faction));
    });
    modalPanel(root);
  }
  function showIntel() {
    var g = S.game;
    var rows = g.players.map(function (p) {
      var sc = g.scoreFor(p.slot), v = S.viewer;
      var hidden = g.fog && v != null && g.isEnemy(p.slot, v);
      return '<tr><td><span class="swatch" style="display:inline-block;width:10px;height:10px;background:' + G.FACTIONS[p.faction].colors[1] + '"></span> ' + UI.esc(p.name) + (p.alive ? '' : ' ✝') + '</td><td>' + UI.esc(G.coFor(p).name) +
        '</td><td>' + (hidden ? '?' : sc.units) + '</td><td>' + sc.props + '</td><td>' + UI.fmt(sc.props * (g.meta.income || 1000)) + '</td><td>' + (hidden ? '?' : UI.fmt(sc.funds)) + '</td><td>' + (hidden ? '?' : UI.fmt(sc.value)) + '</td></tr>';
    }).join('');
    var root = h('div', { html: '<h3 style="margin-top:0">Lagebericht – Tag ' + g.day + '</h3><table class="stats"><tr><th>Armee</th><th>CO</th><th>Einheiten</th><th>Gebäude</th><th>Einkommen</th><th>Kasse</th><th>Armeewert</th></tr>' + rows + '</table>' +
      '<p style="font-size:13px">Ziel: ' + UI.esc(objectiveText(g)) + (g.meta.dayLimit ? ' Tageslimit: ' + g.meta.dayLimit + ' Tage – danach gewinnt das Team mit den meisten Punkten (je Gebäude 4.000 + Armeewert). Stand: ' +
        (function () { var t = g.teamScores(); return Object.keys(t).map(function (k) { return 'Team ' + k + ' ' + UI.fmt(t[k].points); }).join(', '); })() + '.' : '') + '</p>' });
    modalPanel(root);
  }
  function showOptionsOverlay() {
    var root = h('div', {}, [h('h3', { text: 'Optionen', style: { marginTop: 0 } }), UI.optionsPanel(function () { computeScale(); clampCam(true); })]);
    modalPanel(root);
  }
  function showHelpOverlay() { modalPanel(h('div', { class: 'help', html: UI.helpHtml() })); }
  function showKeysOverlay() { modalPanel(h('div', { class: 'help keys', html: UI.keysHtml() })); }

  // ================================================================ Rundenwechsel
  /** Runde beenden; force = immer nachfragen (Knopf „Ende“ unten rechts), sonst nur bei bereiten Einheiten laut Einstellung */
  async function askEndTurn(force) {
    var g = S.game;
    if (!isHumanTurn() || S.busy) return;
    var ready = g.readyUnits(g.currentPlayer().slot).length;
    if (force || (UI.settings.confirmEnd && ready > 0)) {
      var ok = await UI.confirm(ready > 0 ? 'Runde beenden? ' + ready + ' Einheit' + (ready === 1 ? '' : 'en') + ' noch bereit.' : 'Runde beenden?', 'Beenden', 'Weiter');
      if (!ok) return;
    }
    await endTurnFlow(true);
  }
  async function endTurnFlow(local) {
    var g = S.game;
    S.mode = 'free'; S.sel = null; S.inspect = null;
    var events = g.endTurn();
    if (local) netSend({ t: 'end' });
    if (g.over) { S.busy = true; await playEvents(events); S.busy = false; await gameOverFlow(); return; }
    await turnStartFlow(events);
  }
  async function turnStartFlow(events, resumed) {
    var g = S.game, cp = g.currentPlayer();
    S.busy = true;
    S.mode = 'free';
    S.viewer = computeViewer();
    // Hotseat-Übergabe im Nebel
    var hs = humanSlots();
    if (!cp.ai && g.fog && hs.length > 1 && !S.net) {
      S.coverOn = true;
      await coverScreen(cp);
      S.coverOn = false;
    }
    UI.music('co_' + cp.co);
    var co = g.coOf(cp.slot);
    UI.sfx('day');
    if (!resumed || true) {
      await UI.banner('TAG ' + g.day + (g.meta.dayLimit ? ' / ' + g.meta.dayLimit : ''), cp.name + ' · ' + co.name, G.FACTIONS[cp.faction].colors[1], isAiTurn() ? (speed() === 'normal' ? 850 : 450) : 1100,
        { portrait: R.portraitCanvas(cp.co, cp.faction, null, cp.co2) });
    }
    centerOn(focusPoint(cp.slot), false);
    var wev = events.filter(function (e) { return e.type === 'weather'; })[0];
    if (wev || (S.fresh && g.day === 1 && g.weather !== 'klar' && !S.weatherShown)) {
      S.weatherShown = true;
      var Wn = G.WEATHER[g.weather];
      UI.sfx(g.weather === 'nacht' ? 'dive' : 'menu');
      await UI.banner(Wn.icon + ' ' + (wev ? 'Wetterumschwung: ' : '') + Wn.name, Wn.desc, g.weather === 'nacht' ? '#283068' : g.weather === 'schnee' ? '#8098c0' : g.weather === 'regen' ? '#406080' : '#e0b020', isAiTurn() ? 900 : 1500);
    }
    // Ereignisse des Rundenbeginns
    var crashes = events.filter(function (e) { return e.type === 'crash' || e.type === 'repair' || e.type === 'eliminated'; });
    if (crashes.length) await playEvents(crashes);
    var inc = events.filter(function (e) { return e.type === 'income'; })[0];
    if (inc && isHumanTurn() && inc.amount) { UI.toast('Einkommen: +' + UI.fmt(inc.amount) + ' G'); UI.sfx('coin'); }
    if (!cp.ai && g.meta.dayLimit) {
      var left = g.meta.dayLimit - g.day;
      if (left <= 3) UI.toast(left === 0 ? 'Letzter Tag! Danach wird nach Punkten gewertet.' : 'Noch ' + (left + 1) + ' Tage bis zur Wertung nach Punkten.', 3500);
    }
    if (g.over) { S.busy = false; await gameOverFlow(); return; }
    updateHud(true);
    if (S.net) {
      if (G.Net) G.Net.hud();
      if (!isHumanTurn()) {
        S.busy = false; document.title = 'FRONTLINIE · ' + cp.name + ' zieht';
        if (canPlan() && !S.planHintShown) {
          S.planHintShown = true;
          UI.toast(Object.keys(S.plans).length ? 'Deine vorgeplanten Züge sind gespeichert.' : 'Während du wartest: Tippe deine Einheiten an und plane ihre Züge vor.', 4500);
        }
        await runRemote(); return;
      }
      // Eigener Zug: bemerkbar machen (Handy im Hintergrund)
      document.title = '▶ Dein Zug – FRONTLINIE';
      try { if (navigator.vibrate) navigator.vibrate([120, 60, 120]); } catch (e) { /* egal */ }
      closePlanning();
      if (S.planOrder.length) { await runPlans(); if (!S || g.over) return; }
      S.busy = false;
      return;
    }
    if (cp.ai) { await runAI(); return; }
    // Autosave zu Beginn eines menschlichen Zuges
    save('auto');
    S.busy = false;
  }

  // ================================================================ Fremde Züge (Online)
  async function runRemote() {
    var me = S, g = S.game, slot = g.currentPlayer().slot;
    while (S === me && !g.over && g.currentPlayer().slot === slot) {
      var m = await G.Net.next();
      if (!m || S !== me) return;
      var cmd = m.cmd || {};
      S.busy = true; S.inspect = null;
      if (S.mode !== 'free' && !(S.sel && S.sel.plan)) { S.mode = 'free'; S.sel = null; }
      if (cmd.t === 'unit') {
        await aiUnitCommand({ unitId: cmd.id, path: cmd.path, action: cmd.action });
      } else if (cmd.t === 'build') {
        var u = g.build(m.slot, cmd.type, cmd.x, cmd.y);
        if (u) await showBuild(cmd);
      } else if (cmd.t === 'power') {
        var ev = g.activatePower(m.slot, cmd.level);
        if (ev) await powerBanner(ev);
      } else if (cmd.t === 'ai') {
        var ra = g.applyCmd(m.slot, cmd);
        if (ra.ok) UI.toast(g.playerBySlot(cmd.slot).name + ' wird jetzt von der KI gespielt.', 3500);
      } else if (cmd.t === 'undo') {
        var ru = g.applyCmd(m.slot, cmd);
        if (ru.ok) { S.anim = {}; rebuildTerrain(); UI.toast(g.playerBySlot(m.slot).name + ' nimmt den letzten Zug zurück.', 2500); }
      } else if (cmd.t === 'resign') {
        var who = g.currentPlayer();
        var rev = g.resign(m.slot);
        G.Net.done(m, g);
        await UI.banner(who.name + ' gibt auf!', g.coOf(who.slot).name + ' streckt die Waffen.', G.FACTIONS[who.faction].colors[1], 1800,
          { portrait: R.portraitCanvas(who.co, who.faction, null, who.co2) });
        rebuildTerrain();
        if (S !== me) return;
        S.busy = false;
        if (g.over) { await gameOverFlow(); return; }
        await turnStartFlow(rev.filter(function (e) { return e.type !== 'eliminated'; }));
        return;
      } else if (cmd.t === 'end') {
        S.busy = false;
        var events = g.endTurn();
        G.Net.done(m, g);
        if (g.over) { S.busy = true; await playEvents(events); S.busy = false; await gameOverFlow(); return; }
        await turnStartFlow(events);
        return;
      }
      if (S !== me) return;
      G.Net.done(m, g);
      S.busy = false;
      refreshPlanSelection();
      updateHud(true);
      if (S.dangerOn) S.danger = computeDanger();
      if (S.visionOn) S.vision = computeEnemyVision();
    }
    if (S === me && g.over) { S.busy = false; await gameOverFlow(); }
  }
  async function showBuild(cmd) {
    var g = S.game;
    var vis = S.viewer == null || g.tileVisible(S.viewer, cmd.x, cmd.y);
    if (vis && speed() !== 'instant') {
      if (followRemote()) { ensureVisible(cmd.x, cmd.y, 2); S.cursor = { x: cmd.x, y: cmd.y }; }
      UI.sfx('build'); R.addFx({ type: 'sparkle', x: cmd.x, y: cmd.y, dur: 600 });
      await UI.sleep(speed() === 'fast' ? 80 : 220);
    }
  }
  function coverScreen(cp) {
    return new Promise(function (resolve) {
      var co = S.game.coOf(cp.slot);
      var el = h('div', { class: 'cover' }, [
        R.portraitCanvas(cp.co, cp.faction, 128, cp.co2),
        h('h2', { text: cp.name + ' ist am Zug' }),
        h('div', { text: co.name + ' · Tag ' + S.game.day }),
        h('button', { class: 'btn primary', text: 'Bereit ▶', onclick: done })
      ]);
      $('#overlay').appendChild(el);
      function done() { if (el.parentNode) el.parentNode.removeChild(el); UI.pop(layer); resolve(); }
      var layer = UI.push({ modal: true, onAction: function (a) { if (a === 'a') done(); return true; } });
    });
  }

  // ================================================================ KI-Zug
  async function runAI() {
    var g = S.game, cp = g.currentPlayer(), slot = cp.slot;
    S.busy = true;
    var guard = 0, fails = 0;
    var t0 = performance.now();
    while (S && !g.over && g.currentPlayer().slot === slot && guard++ < 500) {
      var cmd = null;
      try { cmd = G.AI ? G.AI.planNext(g, slot, { level: cp.aiLevel || 'normal' }) : { kind: 'end' }; }
      catch (e) { console.error('KI-Fehler', e); cmd = { kind: 'end' }; }
      if (!cmd || cmd.kind === 'end') break;
      if (cmd.kind === 'resign') {
        var rev = g.resign(slot);
        await UI.banner(cp.name + ' gibt auf!', g.coOf(slot).name + ' streckt die Waffen.', G.FACTIONS[cp.faction].colors[1], 1800,
          { portrait: R.portraitCanvas(cp.co, cp.faction, null, cp.co2) });
        rebuildTerrain();
        S.busy = false;
        if (g.over) { await gameOverFlow(); return; }
        await turnStartFlow(rev.filter(function (e) { return e.type !== 'eliminated'; }));
        return;
      }
      if (cmd.kind === 'power') {
        var ev = g.activatePower(slot, cmd.level);
        if (ev) await powerBanner(ev); else fails++;
      } else if (cmd.kind === 'build') {
        var u = g.build(slot, cmd.type, cmd.x, cmd.y);
        if (u) await showBuild(cmd);
        else fails++;
      } else if (cmd.kind === 'unit') {
        await aiUnitCommand(cmd);
      } else fails++;
      if (fails > 40) break;
      updateHud(true);
      if (g.over) break;
      // Rendering Luft lassen
      if (performance.now() - t0 > 30) { await nextFrame(); t0 = performance.now(); }
    }
    S.skip = false;
    if (!S) return;
    if (g.over) { S.busy = false; await gameOverFlow(); return; }
    if (g.currentPlayer().slot === slot) await endTurnFlow();
    else await turnStartFlow([]);
  }
  async function aiUnitCommand(cmd) {
    var g = S.game, u = g.unitById(cmd.unitId);
    if (!u || u.x === undefined) { g.commit(cmd.unitId, cmd.path, cmd.action); return; }
    var path = cmd.path && cmd.path.length ? cmd.path : [{ x: u.x, y: u.y }];
    var sim = g.simulatePath(u, path);
    var end = sim.path[sim.path.length - 1];
    var viewer = S.viewer;
    var visStart = viewer == null || g.unitVisibleTo(u, viewer);
    var visEnd = viewer == null || g.tileVisible(viewer, end.x, end.y);
    var show = (visStart || visEnd) && speed() !== 'instant';
    var follow = followRemote();
    if (show) {
      if (follow && !tileOnScreen(u.x, u.y)) { ensureVisible(u.x, u.y, 3); await UI.sleep(150); }
      if (follow) S.cursor = { x: u.x, y: u.y };
      await animateMove(u, sim.path, moveDelay());
      S.anim[u.id] = { x: end.x, y: end.y, flip: S.anim[u.id] ? S.anim[u.id].flip : S.facing[u.p] };
      if (follow) S.cursor = { x: end.x, y: end.y };
    }
    var res = g.commit(cmd.unitId, path, cmd.action);
    delete S.anim[cmd.unitId];
    if (!res.ok) return;
    if (show || res.events.some(function (e) { return e.type === 'attack' || e.type === 'capture' || e.type === 'hqfall' || e.type === 'eliminated'; })) {
      await playEvents(res.events);
    } else {
      // Unsichtbar: nur Status-relevante Ereignisse
      await playEvents(res.events.filter(function (e) { return e.type === 'hqfall' || e.type === 'eliminated'; }));
    }
    if (show && speed() === 'normal') await UI.sleep(50);
  }

  // ================================================================ Spielende
  function rankFor(g, slot) {
    var p = g.playerBySlot(slot);
    var par = Math.ceil((g.map.w + g.map.h) / 2.2);
    var speedS = Math.max(0, Math.min(100, 100 - Math.max(0, g.day - par) * 6));
    var k = p.stats.killed, l = p.stats.lost;
    var power = k + l ? Math.round(100 * k / (k + l * 0.8)) : 70;
    power = Math.max(0, Math.min(100, power));
    var tech = Math.max(0, 100 - l * 6);
    var score = Math.round((speedS + power + tech) / 3);
    var rank = score >= 85 ? 'S' : score >= 70 ? 'A' : score >= 55 ? 'B' : 'C';
    return { score: score, rank: rank, speed: speedS, power: power, tech: tech };
  }
  async function gameOverFlow() {
    var g = S.game;
    S.busy = true;
    if (!S.net) UI.Store.del('save:auto');
    document.title = 'FRONTLINIE';
    var humans = S.net ? g.players.filter(function (p) { return p.slot === S.net.slot; }) : g.players.filter(function (p) { return !p.ai; });
    var humanWon = humans.some(function (p) { return p.team === g.winner; });
    var winTeam = g.players.filter(function (p) { return p.team === g.winner; });
    var title = humans.length === 1 ? (humanWon ? 'SIEG!' : 'NIEDERLAGE') : (winTeam.map(function (p) { return p.name; }).join(' & ') + ' gewinnt!');
    UI.music(humanWon || humans.length !== 1 ? 'victory' : 'defeat');
    UI.sfx(humanWon ? 'victory' : 'defeat');
    var byLimit = g.meta.dayLimit && g.day > g.meta.dayLimit;
    await UI.banner(title, byLimit ? 'Tageslimit erreicht – Wertung nach Punkten' : (winTeam.length ? 'Team ' + g.winner : ''), humanWon ? '#e0b020' : '#606070', 2200);
    var mission = g.meta.mode === 'campaign' ? G.CAMPAIGN[g.meta.mission] : null;
    var rank = humans.length ? rankFor(g, humans[0].slot) : null;
    if (mission && humanWon) {
      var prog = UI.campaignProgress();
      var prev = prog.done[mission.id];
      if (!prev || rank.score > prev.score) prog.done[mission.id] = { rank: rank.rank, score: rank.score, days: g.day };
      UI.saveCampaignProgress(prog);
      UI.music('briefing');
      await UI.dialog(mission.outro || [], factionForCo);
    }
    showResult(g, title, humanWon, rank, mission, S.net);
  }
  function showResult(g, title, humanWon, rank, mission, net) {
    var setup = g.meta.setup;
    P.stop();
    if (net && G.Net && G.Net.s === net) net.view = 'result';
    UI.screen('result', function (wrap) {
      wrap.appendChild(h('h1', { text: title }));
      if (rank && (mission ? humanWon : true)) {
        wrap.appendChild(h('div', { class: 'rank-big', text: rank.rank }));
        wrap.appendChild(h('p', { text: 'Tempo ' + rank.speed + ' · Stärke ' + rank.power + ' · Technik ' + rank.tech + ' · Gesamt ' + rank.score + ' Punkte' }));
      }
      var rows = g.players.map(function (p) {
        return '<tr><td>' + UI.esc(p.name) + ' (' + UI.esc(G.coFor(p).name) + ')' + (p.team === g.winner ? ' 🏆' : '') + '</td><td>' + p.stats.built + '</td><td>' + p.stats.killed + '</td><td>' + p.stats.lost + '</td><td>' + p.stats.captured + '</td></tr>';
      }).join('');
      wrap.appendChild(h('div', { class: 'panel', style: { maxWidth: '640px', margin: '16px auto' }, html: '<table class="stats"><tr><th>Armee</th><th>Gebaut</th><th>Vernichtet</th><th>Verloren</th><th>Eingenommen</th></tr>' + rows + '</table><p>Dauer: ' + Math.min(g.day, g.meta.dayLimit || g.day) + ' Tage · Karte: ' + UI.esc(g.mapDef.name || '') +
        (g.meta.dayLimit && g.day > g.meta.dayLimit ? '<br>Entschieden nach Punkten (Tageslimit ' + g.meta.dayLimit + '): ' +
          (function () { var t = g.teamScores(); return Object.keys(t).map(function (k) { return 'Team ' + k + ' ' + UI.fmt(t[k].points); }).join(' · '); })() : '') + '</p>' }));
      var acts = h('div', { class: 'actions', style: { justifyContent: 'center' } });
      if (mission) {
        if (humanWon && G.CAMPAIGN[g.meta.mission + 1]) acts.appendChild(h('button', { class: 'btn primary', text: 'Nächste Mission ▶', onclick: function () { G.Play.startMission(g.meta.mission + 1); } }));
        acts.appendChild(h('button', { class: 'btn' + (humanWon ? '' : ' primary'), text: 'Mission wiederholen', onclick: function () { G.Play.startMission(g.meta.mission); } }));
        acts.appendChild(h('button', { class: 'btn', text: 'Kampagne', onclick: function () { UI.showCampaign(); } }));
      } else if (net) {
        if (net.host) acts.appendChild(h('button', { class: 'btn primary', text: 'Revanche (gleicher Raum)', onclick: function () { G.Net.rematch(); } }));
        else acts.appendChild(h('div', { class: 'wait-host', text: 'Revanche? Der Gastgeber kann eine neue Runde starten.' }));
        acts.appendChild(h('button', { class: 'btn', text: 'Raum verlassen', onclick: function () { G.Net.leave(false).then(function () { UI.showTitle(); }); } }));
      } else if (setup) {
        acts.appendChild(h('button', { class: 'btn primary', text: 'Revanche', onclick: function () { G.Play.startNew(setup); } }));
        acts.appendChild(h('button', { class: 'btn', text: 'Gefecht-Auswahl', onclick: function () { UI.showSkirmish(); } }));
      }
      if (!net) acts.appendChild(h('button', { class: 'btn', text: 'Hauptmenü', onclick: function () { UI.showTitle(); } }));
      wrap.appendChild(acts);
      return { onAction: function (a) { if (a === 'a' && acts.firstChild) acts.firstChild.click(); else if (a === 'b') UI.showTitle(); return true; } };
    });
  }

  // Test-/Debug-Zugriff
  P.state = function () { return S; };
  P.endTurn = function () { return endTurnFlow(); };
})();
