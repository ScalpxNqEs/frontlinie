// FRONTLINIE – Karteneditor
var G = (typeof globalThis !== 'undefined' ? globalThis : window).G = (globalThis.G || {});

(function () {
  'use strict';
  var UI = G.UI, R = G.Render, h = UI.h;
  var TS = 16;
  var E = G.Editor = {};

  var TERRAIN_TOOLS = ['P', 'F', 'M', 'R', 'I', 'B', 'S', 'H', 'X'];
  var PROP_TOOLS = ['C', 'K', 'A', 'O', 'Q'];

  function blankMap(w, h2) {
    var terrain = [], owner = [];
    for (var y = 0; y < h2; y++) { var r = [], o = []; for (var x = 0; x < w; x++) { r.push('P'); o.push(0); } terrain.push(r); owner.push(o); }
    return { w: w, h: h2, terrain: terrain, owner: owner };
  }
  function fromDef(def) {
    var m = G.parseMap(def);
    return { map: { w: m.w, h: m.h, terrain: m.terrain, owner: m.owner }, units: (def.units || []).map(function (u) { return { type: u[0], x: u[1], y: u[2], p: u[3] }; }), name: def.name || 'Neue Karte', id: def.id, desc: def.desc || '', theme: def.theme || 'sommer' };
  }

  E.open = function (def) {
    G.Play.stop();
    UI.music('map_editor');
    var st = def ? fromDef(def) : { map: blankMap(40, 40), units: [], name: 'Neue Karte', desc: '', theme: 'sommer' };
    R.setTheme(st.theme);
    st.tool = { kind: 'terrain', t: 'P' };
    st.owner = 1;
    st.sym = 'off';
    st.scale = 3;
    var prevSlotFaction = R.slotFaction;
    R.slotFaction = function (slot) { return slot ? G.FACTION_ORDER[slot - 1] : 'neutral'; };
    var layer, canvas, ctx, scroller, toolButtons = [], themeCyc = null;
    // Einstellungen des Zufallsgenerators (bleiben für „Nochmal“ erhalten)
    var rnd = UI.Store.get('editor:random', { players: 2, size: 'klein', form: 'zufall', theme: 'zufall' });
    var undo = [];

    UI.screen('', function (wrap, el) {
      el.style.background = '#101018';
      wrap.style.maxWidth = 'none'; wrap.style.padding = '0';
      // Kopfzeile
      var top = h('div', { class: 'editor-top' });
      var nameIn = h('input', { value: st.name, maxlength: 32, oninput: function () { st.name = nameIn.value; } });
      top.appendChild(nameIn);
      top.appendChild(h('button', { class: 'btn', text: 'Neu', onclick: newMap }));
      top.appendChild(h('button', { class: 'btn primary', text: '🎲 Zufallskarte', title: 'Faire, symmetrische Karte erzeugen lassen', onclick: randomMap }));
      top.appendChild(h('button', { class: 'btn', text: 'Öffnen', onclick: openMap }));
      top.appendChild(h('button', { class: 'btn primary', text: 'Speichern', onclick: saveMap }));
      top.appendChild(h('button', { class: 'btn', text: 'Testspiel', onclick: testPlay }));
      top.appendChild(h('button', { class: 'btn', text: 'Export/Import', onclick: exportImport }));
      top.appendChild(h('button', { class: 'btn', text: '↶', title: 'Rückgängig (Strg+Z)', onclick: doUndo }));
      top.appendChild(h('button', { class: 'btn', text: 'Zurück', onclick: close }));
      el.appendChild(top);
      // Zeichenfläche
      scroller = h('div', { style: { position: 'absolute', left: 0, right: 0, top: '60px', bottom: '120px', overflow: 'auto', display: 'flex', alignItems: 'flex-start', justifyContent: 'center' } });
      canvas = h('canvas');
      canvas.style.margin = '10px';
      canvas.style.cursor = 'crosshair';
      canvas.style.touchAction = 'none';
      scroller.appendChild(canvas);
      el.appendChild(scroller);
      ctx = canvas.getContext('2d');
      // Werkzeugleiste
      var bar = h('div', { class: 'editor-bar' });
      var g1 = h('div', { class: 'grp' });
      TERRAIN_TOOLS.forEach(function (t) { g1.appendChild(toolBtn({ kind: 'terrain', t: t }, G.TERRAIN[t].name)); });
      bar.appendChild(g1);
      var g2 = h('div', { class: 'grp' });
      PROP_TOOLS.forEach(function (t) { g2.appendChild(toolBtn({ kind: 'prop', t: t }, G.TERRAIN[t].name)); });
      bar.appendChild(g2);
      var g3 = h('div', { class: 'grp' });
      G.UNIT_ORDER.forEach(function (t) { g3.appendChild(toolBtn({ kind: 'unit', t: t }, G.UNITS[t].name)); });
      g3.appendChild(toolBtn({ kind: 'erase' }, 'Einheit entfernen'));
      bar.appendChild(g3);
      var g4 = h('div', { class: 'grp' });
      g4.appendChild(h('label', { text: 'Besitzer' }));
      g4.appendChild(UI.cycler([0, 1, 2, 3, 4], st.owner, function (v) { st.owner = v; refreshTools(); }, function (v) { return v ? G.FACTIONS[G.FACTION_ORDER[v - 1]].name : 'Neutral'; }));
      g4.appendChild(h('label', { text: 'Symmetrie' }));
      g4.appendChild(UI.cycler(['off', 'h', 'v', 'rot'], 0, function (v) { st.sym = v; }, function (v) { return { off: 'Aus', h: 'Spiegel ↔', v: 'Spiegel ↕', rot: 'Drehung 180°' }[v]; }));
      var THEMES = Object.keys(G.THEMES);
      g4.appendChild(h('label', { text: 'Landschaft' }));
      themeCyc = UI.cycler(THEMES, Math.max(0, THEMES.indexOf(st.theme)), function (v) { st.theme = v; R.setTheme(v); refreshTools(); draw(); }, function (v) { return G.THEMES[v]; });
      g4.appendChild(themeCyc);
      g4.appendChild(h('label', { text: 'Zoom' }));
      g4.appendChild(UI.cycler([1, 2, 3, 4, 5], 2, function (v) { st.scale = v; draw(); }, function (v) { return v + '×'; }));
      bar.appendChild(g4);
      el.appendChild(bar);
      bindCanvas();
      refreshTools();
      draw();
      layer = UI.push({ onAction: function (a) { if (a === 'b') close(); return true; } });
      document.addEventListener('keydown', keyUndo);
      return { cleanup: function () { document.removeEventListener('keydown', keyUndo); R.slotFaction = prevSlotFaction; } };
    });

    function keyUndo(ev) { if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'z' || ev.key === 'Z')) { ev.preventDefault(); doUndo(); } }
    function toolIcon(tool) {
      var c = document.createElement('canvas'); c.width = 48; c.height = 48;
      var cx = c.getContext('2d'); cx.imageSmoothingEnabled = true;
      if (tool.kind === 'terrain' || tool.kind === 'prop') {
        var m = blankMap(3, 3);
        m.terrain[1][1] = tool.t;
        if (tool.t === 'S' || tool.t === 'X' || tool.t === 'O') { for (var y = 0; y < 3; y++) for (var x = 0; x < 3; x++) m.terrain[y][x] = 'S'; m.terrain[1][1] = tool.t; }
        if (tool.t === 'R') { m.terrain[1][0] = 'R'; m.terrain[1][2] = 'R'; }
        if (tool.t === 'I') { m.terrain[0][1] = 'I'; m.terrain[2][1] = 'I'; }
        if (tool.t === 'B') { m.terrain[0][1] = 'I'; m.terrain[2][1] = 'I'; m.terrain[1][0] = 'R'; m.terrain[1][2] = 'R'; }
        if (tool.kind === 'prop') m.owner[1][1] = st.owner;
        R.paintTile(cx, m, 1, 1, 0, 0, 3);
      } else if (tool.kind === 'unit') {
        cx.drawImage(R.unitSprite(tool.t, G.FACTION_ORDER[Math.max(1, st.owner) - 1], 0, false, false), 0, 0, 48, 48);
      } else {
        cx.scale(3, 3);
        cx.fillStyle = '#d02818'; cx.fillRect(3, 7, 10, 2); cx.fillRect(7, 3, 2, 10);
        cx.save(); cx.translate(8, 8); cx.rotate(Math.PI / 4); cx.fillRect(-5, -1, 10, 2); cx.fillRect(-1, -5, 2, 10); cx.restore();
      }
      return c;
    }
    function toolBtn(tool, title) {
      var b = h('button', { class: 'tool', title: title, onclick: function () { st.tool = tool; refreshTools(); UI.sfx('menu'); } });
      b._tool = tool;
      toolButtons.push(b);
      return b;
    }
    function refreshTools() {
      toolButtons.forEach(function (b) {
        b.innerHTML = '';
        b.appendChild(toolIcon(b._tool));
        var t = b._tool;
        b.classList.toggle('sel', t.kind === st.tool.kind && t.t === st.tool.t);
      });
    }
    function draw() {
      var m = st.map, sc = st.scale;
      canvas.width = m.w * TS * sc; canvas.height = m.h * TS * sc;
      ctx.imageSmoothingEnabled = true;
      var layerC = R.buildTerrain(m);
      ctx.drawImage(layerC, 0, 0, canvas.width, canvas.height);
      st.units.forEach(function (u) {
        ctx.drawImage(R.unitSprite(u.type, G.FACTION_ORDER[u.p - 1], 0, u.x > m.w / 2, false), u.x * TS * sc, u.y * TS * sc, TS * sc, TS * sc);
      });
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      for (var x = 0; x <= m.w; x++) ctx.fillRect(x * TS * sc, 0, 1, canvas.height);
      for (var y = 0; y <= m.h; y++) ctx.fillRect(0, y * TS * sc, canvas.width, 1);
      if (st.sym !== 'off') {
        ctx.fillStyle = 'rgba(255,224,112,0.5)';
        if (st.sym === 'h' || st.sym === 'rot') ctx.fillRect(canvas.width / 2 - 1, 0, 2, canvas.height);
        if (st.sym === 'v' || st.sym === 'rot') ctx.fillRect(0, canvas.height / 2 - 1, canvas.width, 2);
      }
    }
    function mirrorOwner(o) { return o ? ({ 1: 2, 2: 1, 3: 4, 4: 3 })[o] : 0; }
    function targets(x, y) {
      var m = st.map, list = [{ x: x, y: y, mir: false }];
      if (st.sym === 'h') list.push({ x: m.w - 1 - x, y: y, mir: true });
      if (st.sym === 'v') list.push({ x: x, y: m.h - 1 - y, mir: true });
      if (st.sym === 'rot') list.push({ x: m.w - 1 - x, y: m.h - 1 - y, mir: true });
      return list;
    }
    function snapshot() {
      undo.push(JSON.stringify({ map: st.map, units: st.units }));
      if (undo.length > 60) undo.shift();
    }
    function doUndo() {
      var s = undo.pop(); if (!s) return;
      var d = JSON.parse(s); st.map = d.map; st.units = d.units; draw();
    }
    function paint(x, y) {
      var m = st.map, changed = false;
      if (x < 0 || y < 0 || x >= m.w || y >= m.h) return;
      targets(x, y).forEach(function (t) {
        var tool = st.tool;
        if (tool.kind === 'terrain' || tool.kind === 'prop') {
          var owner = tool.kind === 'prop' ? (t.mir ? mirrorOwner(st.owner) : st.owner) : 0;
          if (m.terrain[t.y][t.x] !== tool.t || m.owner[t.y][t.x] !== owner) {
            if (tool.t === 'Q' && owner) { // nur ein HQ pro Spieler
              for (var yy = 0; yy < m.h; yy++) for (var xx = 0; xx < m.w; xx++) if (m.terrain[yy][xx] === 'Q' && m.owner[yy][xx] === owner) { m.terrain[yy][xx] = 'C'; }
            }
            m.terrain[t.y][t.x] = tool.t; m.owner[t.y][t.x] = owner; changed = true;
            // Einheiten auf unpassendem Gelände entfernen
            st.units = st.units.filter(function (u) { return !(u.x === t.x && u.y === t.y) || G.TERRAIN[tool.t].move[G.UNITS[u.type].mt] || (G.UNITS[u.type].cls === 'static' && 'PFMRH'.indexOf(tool.t) >= 0); });
          }
        } else if (tool.kind === 'unit') {
          var p = Math.max(1, t.mir ? mirrorOwner(Math.max(1, st.owner)) : st.owner);
          var isStatic = G.UNITS[tool.t].cls === 'static';
          if (isStatic ? 'PFMRH'.indexOf(m.terrain[t.y][t.x]) < 0 : !G.TERRAIN[m.terrain[t.y][t.x]].move[G.UNITS[tool.t].mt]) return;
          st.units = st.units.filter(function (u) { return !(u.x === t.x && u.y === t.y); });
          st.units.push({ type: tool.t, x: t.x, y: t.y, p: p }); changed = true;
        } else if (tool.kind === 'erase') {
          var n = st.units.length;
          st.units = st.units.filter(function (u) { return !(u.x === t.x && u.y === t.y); });
          changed = changed || st.units.length !== n;
        }
      });
      if (changed) draw();
    }
    function bindCanvas() {
      var painting = false, last = null;
      function tile(ev) {
        var r = canvas.getBoundingClientRect();
        return { x: Math.floor((ev.clientX - r.left) / r.width * st.map.w), y: Math.floor((ev.clientY - r.top) / r.height * st.map.h) };
      }
      canvas.addEventListener('pointerdown', function (ev) {
        if (ev.button === 2) { // Pipette
          var t0 = tile(ev), tt = st.map.terrain[t0.y] && st.map.terrain[t0.y][t0.x];
          if (tt) { st.tool = { kind: G.TERRAIN[tt].prop ? 'prop' : 'terrain', t: tt }; st.owner = st.map.owner[t0.y][t0.x] || st.owner; refreshTools(); }
          return;
        }
        canvas.setPointerCapture(ev.pointerId);
        painting = true; snapshot();
        var t = tile(ev); last = t.x + ',' + t.y; paint(t.x, t.y);
      });
      canvas.addEventListener('pointermove', function (ev) {
        if (!painting) return;
        var t = tile(ev), k = t.x + ',' + t.y;
        if (k !== last) { last = k; if (st.tool.kind === 'terrain' || st.tool.kind === 'erase') paint(t.x, t.y); }
      });
      canvas.addEventListener('pointerup', function () { painting = false; });
    }
    function toDef() {
      var d = G.mapToDef({ w: st.map.w, h: st.map.h, terrain: st.map.terrain, owner: st.map.owner, name: st.name, id: st.id }, []);
      d.units = st.units.map(function (u) { return [u.type, u.x, u.y, u.p]; });
      d.name = st.name || 'Eigene Karte';
      d.id = st.id || ('custom-' + Date.now().toString(36));
      st.id = d.id;
      d.desc = st.desc || 'Eigene Karte';
      d.theme = st.theme || 'sommer';
      d.players = G.mapPlayerCount(d);
      return d;
    }
    function validate(d) {
      var problems = [];
      var n = d.players;
      if (n < 2) problems.push('Mindestens zwei Spieler nötig (Gebäude oder Einheiten mit Besitzer 1 und 2).');
      var m = G.parseMap(d);
      for (var p = 1; p <= n; p++) {
        var hq = 0, hasAny = false, factory = 0;
        for (var y = 0; y < m.h; y++) for (var x = 0; x < m.w; x++) {
          if (m.owner[y][x] === p) { hasAny = true; if (m.terrain[y][x] === 'Q') hq++; if (G.TERRAIN[m.terrain[y][x]].builds) factory++; }
        }
        var units = d.units.filter(function (u) { return u[3] === p; }).length;
        if (hq !== 1) problems.push('Spieler ' + p + ' braucht genau ein Hauptquartier.');
        if (!units && !factory) problems.push('Spieler ' + p + ' hat weder Einheiten noch eine Fabrik.');
        if (!hasAny && !units) problems.push('Spieler ' + p + ' fehlt.');
      }
      for (var y2 = 0; y2 < m.h; y2++) for (var x2 = 0; x2 < m.w; x2++) {
        if (m.terrain[y2][x2] === 'O') {
          var sea = G.DIRS.some(function (dd) { var t = m.terrain[y2 + dd[1]] && m.terrain[y2 + dd[1]][x2 + dd[0]]; return t === 'S' || t === 'X'; });
          if (!sea) problems.push('Hafen bei ' + (x2 + 1) + '|' + (y2 + 1) + ' liegt nicht am Meer.');
        }
      }
      return problems;
    }
    function saveMap() {
      var d = toDef();
      var probs = validate(d);
      var list = UI.customMaps().filter(function (m) { return m.id !== d.id; });
      list.push(d);
      UI.saveCustomMaps(list);
      UI.sfx('confirm');
      if (probs.length) UI.alert('Gespeichert, aber noch nicht spielbar:\n' + probs.slice(0, 4).join('\n'));
      else UI.toast('Karte „' + d.name + '“ gespeichert. Sie erscheint unter Gefecht → Eigene Karten.');
    }
    function testPlay() {
      var d = toDef();
      var probs = validate(d);
      if (probs.length) { UI.alert(probs.slice(0, 4).join('\n')); return; }
      saveMap();
      UI.skirmishSetup.mapId = d.id;
      R.slotFaction = prevSlotFaction;
      UI.showSkirmish();
    }
    function newMap() {
      var sizes = [[40, 40], [50, 50], [60, 40], [64, 64], [80, 30], [80, 60], [100, 70]];
      UI.menu(sizes.map(function (s) { return { label: s[0] + ' × ' + s[1], value: s }; }).concat([{ label: 'Abbrechen', value: null }]), {
        title: 'Neue Karte – Größe',
        onSelect: function (it) {
          if (!it.value) return;
          snapshot();
          st.map = blankMap(it.value[0], it.value[1]); st.units = []; st.id = null; st.name = 'Neue Karte';
          var inp = document.querySelector('.editor-top input'); if (inp) inp.value = st.name;
          draw();
        },
        onCancel: function () {}
      });
    }
    /** Zufallskarte: Spieler, Größe, Landform, Landschaft wählen → faire, symmetrische Karte (js/mapgen.js) */
    function randomMap() {
      var MG = G.MapGen;
      if (!MG || !MG.random) { UI.toast('Generator nicht geladen.'); return; }
      var body = h('div', { class: 'opts', style: { marginTop: '0' } });
      function opt(label, el) { body.appendChild(h('div', { class: 'opt' }, [h('span', { text: label }), el])); }
      var formCyc = null, formBox = h('span');
      function formValues() { return ['zufall'].concat(Object.keys(MG.random.FORMS).filter(function (k) { return MG.random.FORMS[k].p.indexOf(rnd.players) >= 0; })); }
      function renderForm() {
        var vals = formValues();
        if (vals.indexOf(rnd.form) < 0) rnd.form = 'zufall';
        formCyc = UI.cycler(vals, vals.indexOf(rnd.form), function (v) { rnd.form = v; }, function (v) { return v === 'zufall' ? '🎲 Zufall' : MG.random.FORMS[v].name; });
        formBox.innerHTML = ''; formBox.appendChild(formCyc);
      }
      opt('Spieler', UI.cycler([2, 4], rnd.players === 4 ? 1 : 0, function (v) { rnd.players = v; renderForm(); }, function (v) { return v + ' Spieler'; }));
      opt('Größe', UI.cycler(['klein', 'mittel', 'gross'], Math.max(0, ['klein', 'mittel', 'gross'].indexOf(rnd.size)), function (v) { rnd.size = v; }, function (v) { return MG.random.SIZES[v].name; }));
      opt('Landform', formBox);
      opt('Landschaft', UI.cycler(['zufall'].concat(Object.keys(G.THEMES)), Math.max(0, ['zufall'].concat(Object.keys(G.THEMES)).indexOf(rnd.theme)), function (v) { rnd.theme = v; }, function (v) { return v === 'zufall' ? '🎲 Zufall' : G.THEMES[v]; }));
      renderForm();
      var content = h('div', {}, [h('p', { class: 'hint', text: 'Jede Karte ist punkt- bzw. drehsymmetrisch und wird auf Fairness geprüft: gleiche Gebäude und gleich lange Wege für alle Spieler. Danach kannst du sie bearbeiten, speichern und im Gefecht spielen.' }), body]);
      UI.sheet('🎲 Zufallskarte', content, [{ label: 'Abbrechen', value: null }, { label: 'Erzeugen', value: 'go', primary: true }]).then(function (v) {
        if (v !== 'go') return;
        UI.Store.set('editor:random', rnd);
        var m;
        try { m = MG.random({ players: rnd.players, size: rnd.size, form: rnd.form, theme: rnd.theme }); }
        catch (e) { UI.sfx('error'); UI.toast('Keine faire Karte gefunden – bitte nochmal versuchen.'); return; }
        var s = fromDef(m);
        snapshot();
        st.map = s.map; st.units = []; st.id = null; st.name = m.name; st.desc = m.desc;
        st.theme = m.theme; R.setTheme(st.theme); if (themeCyc) themeCyc.set(st.theme); refreshTools();
        var inp = document.querySelector('.editor-top input'); if (inp) inp.value = st.name;
        draw();
        UI.sfx('confirm');
        UI.toast(m.desc.replace(/^Zufallskarte: /, '') + ' – „Speichern“, dann im Gefecht unter „Eigene Karten“.', 4500);
      });
    }
    function openMap() {
      var items = [{ label: 'Eigene Karten', head: true }];
      UI.customMaps().forEach(function (m) { items.push({ label: m.name, sub: G.parseMap(m).w + '×' + G.parseMap(m).h, value: { def: m, custom: true } }); });
      items.push({ label: 'Vorlagen (Kopie)', head: true });
      (G.MAPS || []).forEach(function (m) { items.push({ label: m.name, sub: m.players + 'S', value: { def: m } }); });
      UI.menu(items, {
        title: 'Karte öffnen', cls: 'build',
        onSelect: function (it) {
          var s = fromDef(it.value.def);
          snapshot();
          st.map = s.map; st.units = s.units; st.name = s.name + (it.value.custom ? '' : ' (Kopie)'); st.id = it.value.custom ? s.id : null; st.desc = s.desc;
          st.theme = s.theme; R.setTheme(st.theme); refreshTools();
          var inp = document.querySelector('.editor-top input'); if (inp) inp.value = st.name;
          draw();
        },
        onCancel: function () {}
      });
      // Löschen eigener Karten per Taste "Entf" ist bewusst nicht vorgesehen; stattdessen im Export-Dialog
    }
    function exportImport() {
      var d = toDef();
      var box = h('div', { class: 'panel', style: { position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', zIndex: 60, width: 'min(700px, 94vw)' } });
      var ta = h('textarea', { class: 'export' });
      ta.value = JSON.stringify(d, null, 1);
      box.appendChild(h('h3', { text: 'Export / Import', style: { marginTop: 0 } }));
      box.appendChild(h('p', { text: 'Kopiere den Text, um die Karte weiterzugeben – oder füge eine Karte ein und klicke „Importieren“.', style: { fontSize: '13px' } }));
      box.appendChild(ta);
      var acts = h('div', { class: 'actions' });
      acts.appendChild(h('button', { class: 'btn', text: 'Kopieren', onclick: function () { ta.select(); try { document.execCommand('copy'); UI.toast('Kopiert.'); } catch (e) { /* ignore */ } } }));
      acts.appendChild(h('button', { class: 'btn primary', text: 'Importieren', onclick: function () {
        try {
          var nd = JSON.parse(ta.value);
          if (!nd.rows || !nd.rows.length) throw new Error('rows');
          var s = fromDef(nd); snapshot();
          st.map = s.map; st.units = s.units; st.name = s.name; st.id = null;
          var inp = document.querySelector('.editor-top input'); if (inp) inp.value = st.name;
          draw(); closeBox(); UI.toast('Importiert.');
        } catch (e) { UI.toast('Ungültige Kartendaten.'); }
      } }));
      acts.appendChild(h('button', { class: 'btn danger', text: 'Diese Karte löschen', onclick: function () {
        UI.confirm('Gespeicherte Karte „' + st.name + '“ löschen?').then(function (ok) {
          if (!ok) return;
          UI.saveCustomMaps(UI.customMaps().filter(function (m) { return m.id !== st.id; }));
          st.id = null; UI.toast('Gelöscht.');
        });
      } }));
      acts.appendChild(h('button', { class: 'btn', text: 'Schließen', onclick: closeBox }));
      box.appendChild(acts);
      document.getElementById('overlay').appendChild(box);
      var lay = UI.push({ modal: true, onAction: function (a) { if (a === 'b') closeBox(); return a === 'b'; } });
      function closeBox() { if (box.parentNode) box.parentNode.removeChild(box); UI.pop(lay); }
    }
    function close() {
      R.slotFaction = prevSlotFaction;
      if (layer) UI.pop(layer);
      UI.showTitle();
    }
  };
})();
