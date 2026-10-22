// FRONTLINIE – Oberfläche: Eingabe, Menüs, Bildschirme, Speicher
var G = (typeof globalThis !== 'undefined' ? globalThis : window).G = (globalThis.G || {});

(function () {
  'use strict';
  var UI = G.UI = {};

  // ================================================================ DOM-Helfer
  function $(sel, root) { return (root || document).querySelector(sel); }
  function h(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (k === 'class') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
    });
    (children || []).forEach(function (c) { if (c == null) return; e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  UI.$ = $; UI.h = h;
  UI.fmt = function (n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); };
  UI.esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  UI.sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  UI.sfx = function (n) { try { if (G.Audio) G.Audio.sfx(n); } catch (e) { /* ignore */ } };
  UI.music = function (n) { try { if (G.Audio) G.Audio.music(n); } catch (e) { /* ignore */ } };

  // ================================================================ Speicher
  var PREFIX = 'frontlinie:';
  var Store = UI.Store = {
    get: function (k, def) { try { var v = localStorage.getItem(PREFIX + k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
    set: function (k, v) { try { localStorage.setItem(PREFIX + k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del: function (k) { try { localStorage.removeItem(PREFIX + k); } catch (e) { /* ignore */ } }
  };
  UI.settings = Object.assign({ music: 0.55, sfx: 0.8, battleAnim: 'on', aiSpeed: 'normal', zoom: 'auto', confirmEnd: true, showGrid: false, unexplored: 'grau' },
    Store.get('settings', {}));
  UI.saveSettings = function () {
    Store.set('settings', UI.settings);
    try { if (G.Audio) G.Audio.setVolume(UI.settings.music, UI.settings.sfx); } catch (e) { /* ignore */ }
  };
  UI.customMaps = function () { return Store.get('maps', []); };
  UI.saveCustomMaps = function (list) { return Store.set('maps', list); };
  UI.campaignProgress = function () { return Store.get('campaign', { done: {} }); };
  UI.saveCampaignProgress = function (p) { Store.set('campaign', p); };

  // ================================================================ Eingabe
  var layers = [];
  UI.layers = layers;
  UI.push = function (layer) { layers.push(layer); return layer; };
  UI.pop = function (layer) { var i = layers.indexOf(layer); if (i >= 0) layers.splice(i, 1); };
  UI.top = function () { return layers[layers.length - 1]; };
  var KEYMAP = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right',
    Enter: 'a', ' ': 'a', z: 'a', Z: 'a', j: 'a', J: 'a',
    Escape: 'b', Backspace: 'b', x: 'b', X: 'b', k: 'b', K: 'b',
    i: 'info', I: 'info', r: 'info', R: 'info',
    e: 'end', E: 'end', n: 'next', N: 'next', Tab: 'next',
    q: 'danger', Q: 'danger', v: 'vision', V: 'vision', u: 'undo', U: 'undo', m: 'mute', M: 'mute', p: 'power', P: 'power',
    '+': 'zoomin', '=': 'zoomin', '-': 'zoomout', c: 'minimap', C: 'minimap',
    h: 'hq', H: 'hq', b: 'factory', B: 'factory', l: 'intel', L: 'intel', o: 'options', O: 'options',
    t: 'chat', T: 'chat', f: 'fullscreen', F: 'fullscreen', F1: 'keys', '?': 'keys', F11: 'fullscreen',
    '1': 'num1', '2': 'num2', '3': 'num3', '4': 'num4', '5': 'num5', '6': 'num6', '7': 'num7', '8': 'num8', '9': 'num9'
  };
  UI.keyHeld = {};
  UI.toggleFullscreen = function () {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(function () {});
    } catch (e) { /* ignore */ }
  };
  document.addEventListener('keydown', function (ev) {
    if (ev.target && (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA' || ev.target.tagName === 'SELECT')) return;
    var act;
    if (ev.ctrlKey || ev.metaKey || ev.altKey) {
      // Browser-Kürzel (Strg+R, Strg+W, …) nicht abfangen – nur Strg+S = Speichern
      if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && (ev.key === 's' || ev.key === 'S')) act = 'save';
      else return;
    } else act = KEYMAP[ev.key];
    if (!act) return;
    // Umschalt: Tab/N rückwärts, Pfeile in großen Schritten
    if (act === 'next' && ev.shiftKey) act = 'prev';
    UI.keyHeld[act] = true;
    try { if (G.Audio) G.Audio.init(); } catch (e) { /* ignore */ }
    if (act === 'mute') {
      try { var m = G.Audio.toggleMute(); UI.toast(m ? 'Ton aus' : 'Ton an'); } catch (e) { /* ignore */ }
      ev.preventDefault(); return;
    }
    if (act === 'fullscreen') { UI.toggleFullscreen(); ev.preventDefault(); return; }
    for (var i = layers.length - 1; i >= 0; i--) {
      var l = layers[i];
      if (l.onAction && l.onAction(act, ev) !== false) { ev.preventDefault(); return; }
      if (l.modal) break;
    }
  });
  document.addEventListener('keyup', function (ev) { var act = KEYMAP[ev.key]; if (act) UI.keyHeld[act] = false; });
  document.addEventListener('pointerdown', function () { try { if (G.Audio) G.Audio.init(); } catch (e) { /* ignore */ } }, { capture: true });
  document.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });

  // ================================================================ Toast & Banner
  UI.toast = function (msg, ms) {
    var box = $('#toast');
    var t = h('div', { class: 't', text: msg });
    box.appendChild(t);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, ms || 2200);
  };
  UI.banner = function (text, sub, color, ms, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var inner = h('div', { class: 'inner', style: { '--c': color || '#e03020' } });
      if (opts.portrait) { var pc = opts.portrait; pc.style.width = '96px'; pc.style.height = '96px'; inner.appendChild(pc); }
      inner.appendChild(h('div', {}, [text, sub ? h('small', { text: sub }) : null]));
      var b = h('div', { class: 'banner' + (opts.power ? ' power' : '') }, [inner]);
      $('#overlay').appendChild(b);
      var done = false;
      function fin() { if (done) return; done = true; if (b.parentNode) b.parentNode.removeChild(b); UI.pop(layer); resolve(); }
      var layer = UI.push({ modal: true, onAction: function (a) { if (a === 'a' || a === 'b') fin(); return true; } });
      b.addEventListener('pointerdown', fin);
      setTimeout(fin, ms || 1300);
    });
  };

  // ================================================================ Menü
  /**
   * items: [{label, sub, disabled, value, icon(canvas), head(bool)}]
   * opts: {x, y, cls, title, onSelect(item, idx), onCancel(), onHover(item), parent(element), anchor:'center'}
   */
  UI.menu = function (items, opts) {
    opts = opts || {};
    var el = h('div', { class: 'menu panel ' + (opts.cls || '') });
    if (opts.title) el.appendChild(h('div', { class: 'head', text: opts.title }));
    var rows = [];
    var sel = -1;
    items.forEach(function (it, i) {
      if (it.head) { el.appendChild(h('div', { class: 'head' + (it.cls ? ' ' + it.cls : ''), text: it.label })); return; }
      var row = h('div', { class: 'item' + (it.disabled ? ' disabled' : '') + (it.cls ? ' ' + it.cls : '') });
      var ri = rows.length;
      if (ri < 9) row.appendChild(h('span', { class: 'key', text: String(ri + 1) }));
      if (it.icon) row.appendChild(it.icon);
      row.appendChild(h('span', { class: 'name', text: it.label }));
      if (it.sub != null) row.appendChild(h('span', { class: 'sub', text: it.sub }));
      if (opts.info) row.appendChild(h('button', { class: 'info-btn', text: 'i', title: 'Alle Werte', onclick: function (ev) { ev.stopPropagation(); setSel(rows.indexOf(row)); opts.info(it); } }));
      row.addEventListener('pointerenter', function (ev) { if (ev.pointerType === 'mouse') setSel(rows.indexOf(row)); });
      row.addEventListener('pointerdown', function (ev) { row._touch = ev.pointerType !== 'mouse'; });
      row.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var i = rows.indexOf(row);
        // Touch: erster Tipp zeigt die Beschreibung, zweiter Tipp wählt
        if (opts.touchConfirm && row._touch && sel !== i) { setSel(i); UI.sfx('menu'); return; }
        setSel(i); activate();
      });
      row._item = it; row._idx = i;
      rows.push(row);
      el.appendChild(row);
    });
    function firstEnabled() { for (var i = 0; i < rows.length; i++) if (!rows[i]._item.disabled) return i; return 0; }
    function setSel(i) {
      if (i < 0 || i >= rows.length) return;
      if (sel >= 0 && rows[sel]) rows[sel].classList.remove('sel');
      sel = i;
      rows[sel].classList.add('sel');
      rows[sel].scrollIntoView({ block: 'nearest' });
      if (opts.onHover) opts.onHover(rows[sel]._item, sel);
    }
    function move(d) {
      if (!rows.length) return;
      var i = sel;
      for (var k = 0; k < rows.length; k++) {
        i = (i + d + rows.length) % rows.length;
        if (!rows[i]._item.disabled || opts.allowDisabledFocus) break;
      }
      setSel(i); UI.sfx('menu');
    }
    var closed = false;
    function close() { if (closed) return; closed = true; if (el.parentNode) el.parentNode.removeChild(el); UI.pop(layer); }
    function activate() {
      var it = rows[sel] && rows[sel]._item;
      if (!it) return;
      if (it.disabled) { UI.sfx('error'); return; }
      UI.sfx('select');
      if (!opts.keepOpen) close();
      if (opts.onSelect) opts.onSelect(it, sel);
    }
    var layer = UI.push({
      modal: true, el: el,
      onAction: function (a) {
        if (a === 'up') move(-1);
        else if (a === 'down') move(1);
        else if (a === 'a') activate();
        else if (/^num\d$/.test(a)) { var n = +a.slice(3) - 1; if (rows[n]) { setSel(n); activate(); } }
        else if (a === 'info' && opts.info && rows[sel]) opts.info(rows[sel]._item);
        else if (a === 'b') { if (opts.onCancel) { UI.sfx('cancel'); close(); opts.onCancel(); } }
        else if (opts.onKey) opts.onKey(a, rows[sel] && rows[sel]._item);
        return true;
      }
    });
    (opts.parent || $('#overlay')).appendChild(el);
    if (opts.x != null) {
      var r = el.getBoundingClientRect(), W = window.innerWidth, H = window.innerHeight;
      var x = Math.max(8, Math.min(W - r.width - 8, opts.x));
      var y = Math.max(8, Math.min(H - r.height - 8, opts.y));
      el.style.left = x + 'px'; el.style.top = y + 'px';
    } else if (!opts.inline) {
      el.style.left = '50%'; el.style.top = '50%'; el.style.transform = 'translate(-50%,-50%)';
    }
    setSel(opts.initial != null ? opts.initial : firstEnabled());
    return { el: el, close: close, layer: layer, select: setSel, isClosed: function () { return closed; } };
  };

  /** Blatt (Overlay) mit Inhalt und Knöpfen → Promise mit dem Wert des gedrückten Knopfs (null = schließen) */
  UI.sheet = function (title, content, buttons) {
    return new Promise(function (resolve) {
      var acts = h('div', { class: 'actions' });
      var panel = h('div', { class: 'panel' }, [title ? h('h3', { text: title }) : null, content, acts]);
      var box = h('div', { class: 'sheet-box' }, [panel]);
      (buttons || [{ label: 'Schließen', value: null }]).forEach(function (b) {
        acts.appendChild(h('button', { class: 'btn' + (b.primary ? ' primary' : ''), text: b.label, disabled: b.disabled ? 'disabled' : null, onclick: function () { done(b.value); } }));
      });
      box.addEventListener('click', function (ev) { if (ev.target === box) done(null); });
      var layer = UI.push({ modal: true, onAction: function (a) {
        if (a === 'b' || a === 'info') done(null);
        else if (a === 'a') { var pb = (buttons || []).filter(function (b) { return b.primary && !b.disabled; })[0]; done(pb ? pb.value : null); }
        else if (a === 'down') panel.scrollTop += 60; else if (a === 'up') panel.scrollTop -= 60;
        return true;
      } });
      $('#overlay').appendChild(box);
      var finished = false;
      function done(v) { if (finished) return; finished = true; if (box.parentNode) box.parentNode.removeChild(box); UI.pop(layer); resolve(v); }
      box._done = done;
    });
  };

  // ---------------------------------------------------------------- Einheiten-Steckbrief
  var MT_NAMES = { foot: 'zu Fuß', mech: 'Gelände (Grenadier)', tread: 'Kette', tire: 'Räder', air: 'Luft', ship: 'Schiff', trans: 'Landungsboot', none: 'unbeweglich' };
  UI.unitInfo = function (type, faction) {
    var T = G.UNITS[type], root = h('div', { class: 'unit-info' });
    var c = G.Render.unitCanvas(type, faction || 'red', 64);
    c.className = 'ui-sprite spr';
    root.appendChild(h('div', { class: 'ui-head' }, [c, h('div', {}, [h('h3', { text: T.name }), h('p', { text: T.desc })])]));
    var rows = [['Preis', UI.fmt(T.cost) + ' G'], ['Bewegung', T.move + ' Felder · ' + (MT_NAMES[T.mt] || T.mt)], ['Sicht', T.vision + ' Felder'],
      ['Treibstoff', T.fuel + (T.fpd ? ' (−' + T.fpd + ' pro Tag' + (T.diveFpd ? ', getaucht −' + T.diveFpd : '') + ')' : '')]];
    var dmg = G.DAMAGE[type] || {};
    var hasPrim = dmg.primary && Object.keys(dmg.primary).length, hasSec = dmg.secondary && Object.keys(dmg.secondary).length;
    if (!hasPrim && !hasSec) rows.push(['Angriff', 'keiner']);
    else {
      rows.push(['Reichweite', T.range[1] > 1 ? T.range[0] + '–' + T.range[1] + ' Felder (Fernkampf, nicht nach dem Ziehen)' : 'Nahkampf (Nachbarfeld)']);
      rows.push(['Munition', (hasPrim && T.ammo ? T.ammo + ' Schuss Hauptwaffe' : hasPrim ? 'unbegrenzt' : '–') + (hasSec ? (hasPrim ? ' + ' : '') + 'MG (unbegrenzt)' : '')]);
    }
    if (T.cap) rows.push(['Transport', T.cap + ' × ' + (T.carries || []).map(function (k) { return { foot: 'Fußtruppe', vehicle: 'Fahrzeug', copter: 'Hubschrauber', plane: 'Flugzeug' }[k] || k; }).join(' / ')]);
    var extra = [];
    if (T.capture) extra.push('nimmt Gebäude ein');
    if (T.supplies) extra.push('versorgt Nachbarn mit Munition und Treibstoff');
    if (T.repairs) extra.push('repariert');
    if (T.canDive) extra.push('kann tauchen (unsichtbar)');
    if (T.fortifies) extra.push('baut Stellungen');
    if (extra.length) rows.push(['Besonders', extra.join(' · ')]);
    root.appendChild(h('table', { class: 'ustats', html: rows.map(function (r) { return '<tr><th>' + UI.esc(r[0]) + '</th><td>' + UI.esc(r[1]) + '</td></tr>'; }).join('') }));
    var strong = [], weak = [];
    (G.UNIT_ORDER || Object.keys(G.UNITS)).forEach(function (k) {
      var D = G.DAMAGE[k] || {};
      var b = Math.max((dmg.primary && dmg.primary[k]) || 0, (dmg.secondary && dmg.secondary[k]) || 0);
      if (b >= 65) strong.push([G.UNITS[k].name, b]);
      var inc = Math.max((D.primary && D.primary[type]) || 0, (D.secondary && D.secondary[type]) || 0);
      if (inc >= 65) weak.push([G.UNITS[k].name, inc]);
    });
    function list(a) { a.sort(function (x, y) { return y[1] - x[1]; }); return a.length ? a.map(function (x) { return UI.esc(x[0]) + ' <span class="pct">' + x[1] + '%</span>'; }).join(', ') : '–'; }
    root.appendChild(h('p', { class: 'vs', html: '<b>Stark gegen:</b> ' + list(strong) }));
    root.appendChild(h('p', { class: 'vs', html: '<b>Gefährdet durch:</b> ' + list(weak) }));
    root.appendChild(h('p', { class: 'hint', text: 'Prozent = Grundschaden bei voller Stärke, ohne Gelände und Kommandant.' }));
    return root;
  };
  /** Steckbrief als Blatt; mit opts.build {cost, affordable} gibt es einen Bauen-Knopf → Promise(true wenn bauen) */
  UI.unitSheet = function (type, faction, opts) {
    opts = opts || {};
    var btns = [{ label: 'Zurück', value: false }];
    if (opts.build) btns.push({ label: opts.build.affordable ? 'Bauen · ' + UI.fmt(opts.build.cost) + ' G' : 'Zu teuer (' + UI.fmt(opts.build.cost) + ' G)', value: true, primary: true, disabled: !opts.build.affordable });
    return UI.sheet(null, UI.unitInfo(type, faction), btns).then(function (v) { return !!v; });
  };
  /** Kommandanten lesen und (optional) wählen → Promise(id | null) */
  UI.coSheet = function (current, opts) {
    opts = opts || {};
    var list = h('div', { class: 'co-sheet' });
    var btns = [{ label: opts.pick ? 'Abbrechen' : 'Schließen', value: null }];
    if (opts.allowNone) btns.unshift({ label: '✕ Keine Fusion', value: 'none' });
    var p = UI.sheet(opts.title || 'Kommandanten', list, btns);
    if (opts.intro) list.appendChild(h('p', { class: 'co-intro', text: opts.intro }));
    (opts.only ? [].concat(opts.only) : G.CO_ORDER).forEach(function (id) {
      if (opts.exclude && id === opts.exclude) return;
      var btn = opts.pick ? h('button', { class: 'btn small' + (id === current ? '' : ' primary'), text: id === current ? '✓ Gewählt' : 'Diesen wählen', onclick: function () { var b = list.closest('.sheet-box'); if (b && b._done) b._done(id); } }) : null;
      var card = UI.coCard(id, btn, opts.faction);
      if (id === current) card.classList.add('sel');
      list.appendChild(card);
    });
    setTimeout(function () { var sel = list.querySelector('.sel'); if (sel && opts.pick) sel.scrollIntoView({ block: 'center' }); }, 30);
    return p;
  };

  UI.confirm = function (text, yes, no) {
    return new Promise(function (resolve) {
      UI.menu([{ label: yes || 'Ja', value: true }, { label: no || 'Nein', value: false }], {
        title: text, cls: 'confirm', initial: 1,
        onSelect: function (it) { resolve(it.value); },
        onCancel: function () { resolve(false); }
      });
    });
  };
  UI.alert = function (text) {
    return new Promise(function (resolve) {
      UI.menu([{ label: 'OK' }], { title: text, onSelect: function () { resolve(); }, onCancel: function () { resolve(); } });
    });
  };

  // ================================================================ Dialog (Kampagne)
  UI.dialog = function (lines, factionOf) {
    return new Promise(function (resolve) {
      if (!lines || !lines.length) { resolve(); return; }
      var idx = 0, typing = null, full = '', shown = 0;
      var box = h('div', { class: 'dialog' });
      var pbox = h('div', { class: 'portrait-box' });
      var bubble = h('div', { class: 'bubble panel' });
      var who = h('div', { class: 'who' }), txt = h('div', { class: 'txt' }), more = h('div', { class: 'more', text: '▼' });
      bubble.appendChild(who); bubble.appendChild(txt); bubble.appendChild(more);
      box.appendChild(pbox); box.appendChild(bubble);
      $('#overlay').appendChild(box);
      var lastCo = null;
      function show() {
        var L = lines[idx];
        var co = G.COS[L.co];
        var fac = (factionOf && factionOf(L.co)) || (co && co.faction) || 'neutral';
        pbox.innerHTML = '';
        if (co) pbox.appendChild(G.Render.portraitCanvas(L.co, fac));
        who.textContent = co ? co.name : (L.name || '');
        box.style.setProperty('--c', G.FACTIONS[fac] ? G.FACTIONS[fac].colors[1] : '#e03020');
        if (lastCo && lastCo !== L.co) box.classList.toggle('right');
        lastCo = L.co;
        full = L.text; shown = 0; txt.textContent = '';
        more.style.visibility = 'hidden';
        clearInterval(typing);
        typing = setInterval(function () {
          shown += 2;
          txt.textContent = full.slice(0, shown);
          if (shown % 6 === 0) UI.sfx('cursor');
          if (shown >= full.length) { clearInterval(typing); typing = null; more.style.visibility = 'visible'; }
        }, 22);
      }
      function next() {
        if (typing) { clearInterval(typing); typing = null; txt.textContent = full; more.style.visibility = 'visible'; return; }
        idx++;
        if (idx >= lines.length) { finish(); return; }
        UI.sfx('menu');
        show();
      }
      function finish() { clearInterval(typing); if (box.parentNode) box.parentNode.removeChild(box); UI.pop(layer); resolve(); }
      var layer = UI.push({ modal: true, onAction: function (a) { if (a === 'a') next(); else if (a === 'b') finish(); return true; } });
      box.addEventListener('click', next);
      show();
    });
  };

  // ================================================================ Bildschirme
  var current = null;
  UI.clearScreen = function () {
    var s = $('#screens');
    s.innerHTML = '';
    if (current && current.layer) UI.pop(current.layer);
    if (current && current.cleanup) current.cleanup();
    current = null;
  };
  UI.screen = function (cls, build) {
    UI.clearScreen();
    var el = h('div', { class: 'screen ' + (cls || '') });
    var wrap = h('div', { class: 'wrap' });
    el.appendChild(wrap);
    $('#screens').appendChild(el);
    current = { el: el };
    var res = build(wrap, el) || {};
    current.cleanup = res.cleanup;
    if (res.onAction) current.layer = UI.push({ onAction: res.onAction });
    return el;
  };
  function cycler(values, idx, onChange, labelFn) {
    var span = h('span');
    var box = h('div', { class: 'cycler' });
    function upd() { span.textContent = labelFn ? labelFn(values[idx]) : values[idx]; }
    box.appendChild(h('button', { text: '◀', onclick: function () { idx = (idx - 1 + values.length) % values.length; upd(); UI.sfx('menu'); onChange(values[idx]); } }));
    box.appendChild(span);
    box.appendChild(h('button', { text: '▶', onclick: function () { idx = (idx + 1) % values.length; upd(); UI.sfx('menu'); onChange(values[idx]); } }));
    upd();
    box.set = function (v) { var i = values.indexOf(v); if (i >= 0) { idx = i; upd(); } };
    return box;
  }
  UI.cycler = cycler;
  function portraitCanvas(coId, fac, size) { return G.Render.portraitCanvas(coId, fac, size); }
  UI.portraitCanvas = portraitCanvas;
  /** Porträt eines Spielers/Platzes, bei Fusion beide Kommandanten */
  UI.coPortrait = function (coId, co2, fac, size) { return G.Render.portraitCanvas(coId, fac, size, co2 || null); };

  // ---------------------------------------------------------------- Titel
  UI.showTitle = function () {
    G.Play && G.Play.stop && G.Play.stop();
    UI.music('title');
    var anim = null;
    UI.screen('title-screen', function (wrap, el) {
      wrap.style.display = 'contents';
      var bg = h('canvas', { class: 'bg' });
      el.insertBefore(bg, wrap);
      anim = titleBackground(bg);
      el.appendChild(h('h1', { class: 'title-logo', text: 'FRONTLINIE' }));
      el.appendChild(h('div', { class: 'title-sub', text: 'TAKTIK IM TASCHENFORMAT' }));
      var auto = Store.get('save:auto', null);
      var items = [];
      if (auto) items.push({ label: 'Fortsetzen', sub: auto.label || '', value: 'continue' });
      items.push({ label: 'Kampagne', value: 'campaign' });
      items.push({ label: 'Gefecht', value: 'skirmish' });
      items.push({ label: 'Online-Gefecht', sub: 'Handy & Netzwerk', value: 'online' });
      if (G.P2P && G.P2P.supported()) items.push({ label: 'Handy zu Handy', sub: 'Direkt, ohne PC', value: 'p2p' });
      if (G.App && G.App.standalone()) items.push({ label: 'Offline-Speicher', sub: 'Stand der App', value: 'phoneapp' });
      else items.push({ label: 'Handy-App', sub: 'offline aufs Handy', value: 'phoneapp' });
      items.push({ label: 'Spiel laden', value: 'load' });
      items.push({ label: 'Karteneditor', value: 'editor' });
      items.push({ label: 'Kommandanten', value: 'cos' });
      items.push({ label: 'Anleitung', value: 'help' });
      items.push({ label: 'Optionen', value: 'options' });
      var holder = h('div', { style: { position: 'relative' } });
      el.appendChild(holder);
      UI.menu(items, {
        parent: holder, inline: true, cls: 'title-menu', keepOpen: true,
        onSelect: function (it) {
          if (it.value === 'continue') G.Play.loadSave('auto');
          else if (it.value === 'campaign') UI.showCampaign();
          else if (it.value === 'skirmish') UI.showSkirmish();
          else if (it.value === 'online') UI.showOnline();
          else if (it.value === 'p2p') G.P2P.show();
          else if (it.value === 'phoneapp') UI.showPhoneApp();
          else if (it.value === 'load') UI.showLoad();
          else if (it.value === 'editor') G.Editor && G.Editor.open();
          else if (it.value === 'cos') UI.showCOs();
          else if (it.value === 'help') UI.showHelp();
          else if (it.value === 'options') UI.showOptions(UI.showTitle);
        }
      });
      el.appendChild(h('div', { class: 'title-foot', text: 'Pfeiltasten/WASD + Enter · Maus · Touch   —   M: Ton an/aus' }));
      el.appendChild(h('div', { class: 'title-tag', text: 'Schauplatz ' + (anim.scene || '') }));
      el.appendChild(h('div', { class: 'title-tag r', text: 'PC · Handy · Offline' }));
      return { cleanup: function () { anim && anim.stop(); clearMenusIn(holder); } };
    });
  };
  function clearMenusIn(root) {
    // Menü-Layer entfernen, deren Element nicht mehr im DOM hängt
    for (var i = layers.length - 1; i >= 0; i--) if (layers[i].el && !document.body.contains(layers[i].el)) layers.splice(i, 1);
  }
  UI.clearDeadLayers = clearMenusIn;
  /** Lebendiger Titelhintergrund: Kameraschwenk über eine echte Karte, zwei Heere beziehen Stellung und
   *  beschießen sich (Leuchtspur, Einschläge, Rauch), Flieger ziehen vorbei, Wolkenschatten wandern. */
  function titleBackground(canvas) {
    var R = G.Render;
    var maps = (G.MAPS || []).filter(function (m) { return m.rows && m.rows.length >= 20 && (m.rows[0].length / 2) >= 28; });
    if (!maps.length || !R) return { stop: function () {} };
    var def = maps[Math.floor(Math.random() * maps.length)];
    var map = G.parseMap(def);
    R.setTheme(def.theme || 'sommer');
    R.slotFaction = function (o) { return o ? G.FACTION_ORDER[(o - 1) % G.FACTION_ORDER.length] : 'neutral'; };
    var layer = R.buildTerrain(map);
    var ctx = canvas.getContext('2d');
    var running = true, t0 = performance.now();
    var left = G.FACTION_ORDER[0], right = G.FACTION_ORDER[1];
    var types = ['tank', 'inf', 'mdtank', 'mech', 'arty', 'recon', 'apc', 'aa', 'tank', 'inf', 'titan', 'rocket'];
    var troops = [];
    for (var i = 0; i < 12; i++) {
      troops.push({ type: types[i], fac: left, row: i % 4, col: Math.floor(i / 4), jit: Math.random() * 0.6, delay: Math.random() * 2.5, speed: 0.85 + Math.random() * 0.3 });
      troops.push({ type: types[(i + 5) % 12], fac: right, row: (i + 2) % 4, col: Math.floor(i / 4), jit: Math.random() * 0.6, delay: Math.random() * 2.5, speed: 0.85 + Math.random() * 0.3 });
    }
    var air = [{ type: 'bcopter', fac: left, y: 0.13, off: 0, v: 1 }, { type: 'fighter', fac: right, y: 0.22, off: 6, v: 1.9 }, { type: 'tcopter', fac: left, y: 0.31, off: 12, v: 0.8 }, { type: 'bomber', fac: right, y: 0.08, off: 19, v: 1.3 }];
    var clouds = [];
    for (var c = 0; c < 5; c++) clouds.push({ x: Math.random(), y: Math.random(), r: 0.25 + Math.random() * 0.3, v: 0.012 + Math.random() * 0.01 });
    var shots = [], nextShot = 3.5, flashUntil = {};
    var fx = [];
    function sprite(u, frame, flip) { return R.unitSprite(u.type, u.fac, frame, flip, false); }
    function frame(now) {
      if (!running) return;
      var W = canvas.clientWidth, H = canvas.clientHeight;
      if (!W || !H) { requestAnimationFrame(frame); return; }
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
      ctx.imageSmoothingEnabled = true;
      var t = Math.max(0, now - t0) / 1000;
      var sc = Math.max(2, Math.min(4, Math.ceil(H / (map.h * 16) * 1.3)));
      var mw = map.w * 16 * sc, mh = map.h * 16 * sc;
      // Kameraschwenk (langsam hin und her)
      var ox = (Math.sin(t * 0.045) * 0.5 + 0.5) * Math.max(0, mw - W), oy = (Math.sin(t * 0.03 + 1.7) * 0.5 + 0.5) * Math.max(0, mh - H);
      ctx.fillStyle = '#0f120b'; ctx.fillRect(0, 0, W, H);
      ctx.drawImage(layer, 0, 0, layer.width, layer.height, -ox, -oy, mw, mh);
      // Abendlicht
      var lg = ctx.createLinearGradient(0, 0, 0, H);
      lg.addColorStop(0, 'rgba(255, 170, 90, 0.12)'); lg.addColorStop(0.5, 'rgba(60, 40, 80, 0.16)'); lg.addColorStop(1, 'rgba(10, 14, 40, 0.34)');
      ctx.fillStyle = lg; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = R.theme === 'winter' ? 'rgba(14, 18, 30, 0.42)' : 'rgba(14, 18, 30, 0.3)'; ctx.fillRect(0, 0, W, H);   // Schnee blendet sonst
      // Wolkenschatten
      clouds.forEach(function (cl) {
        var cx = ((cl.x + t * cl.v) % 1.4 - 0.2) * W, cy = cl.y * H, r = cl.r * W;
        var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, 'rgba(0, 0, 20, 0.22)'); g.addColorStop(0.6, 'rgba(0, 0, 20, 0.12)'); g.addColorStop(1, 'rgba(0, 0, 20, 0)');
        ctx.fillStyle = g; ctx.fillRect(cx - r, cy - r * 0.6, r * 2, r * 1.2);
      });
      // Heere: rücken von beiden Seiten ein und halten dann Stellung
      var us = 16 * sc, rowGap = us * 1.15, colGap = us * 1.6;
      // Breite Bildschirme: Front rechts neben der Befehlsliste; Handy: unterhalb des Menüs
      var wide = W >= 900 && H >= 560, fcx = wide ? W * 0.69 : W * 0.5, fcy = wide ? H * 0.5 : H * 0.86;
      var frontL = fcx - us * 2.7, frontR = fcx + us * 1.7;
      var baseY = fcy - rowGap * 1.5;
      var pos = {};
      troops.forEach(function (u, k) {
        var tt = Math.max(0, t - u.delay);
        var goal = u.fac === left ? frontL - u.col * colGap - u.jit * us : frontR + u.col * colGap + u.jit * us;
        var start = u.fac === left ? Math.min(-us * (2 + u.col * 2), frontL - W * 0.5) : Math.max(W + us * (1 + u.col * 2), frontR + W * 0.5);
        var dist = Math.abs(goal - start), travel = Math.min(dist, tt * u.speed * us * 1.7);
        var x = u.fac === left ? start + travel : start - travel;
        var moving = travel < dist - 0.5;
        var y = baseY + u.row * rowGap + (moving ? Math.sin(t * 9 + k) * 1.2 : 0);
        pos[k] = { x: x, y: y, moving: moving };
      });
      // Beschuss: nach dem Aufmarsch feuert abwechselnd eine Einheit, Leuchtspur + Einschlag
      if (t > nextShot) {
        nextShot = t + 0.7 + Math.random() * 1.1;
        var k = Math.floor(Math.random() * troops.length), u = troops[k], p = pos[k];
        if (p && !p.moving) {
          var targets = troops.map(function (v, j) { return { v: v, j: j }; }).filter(function (e) { return e.v.fac !== u.fac && pos[e.j] && !pos[e.j].moving; });
          if (targets.length) {
            var tg = targets[Math.floor(Math.random() * targets.length)], q = pos[tg.j];
            var big = u.type === 'arty' || u.type === 'rocket' || u.type === 'mdtank' || u.type === 'titan';
            shots.push({ t0: t, x0: p.x + (u.fac === left ? us * 0.8 : us * 0.2), y0: p.y + us * 0.45, x1: q.x + us * 0.5 + (Math.random() - 0.5) * us, y1: q.y + us * 0.5 + (Math.random() - 0.5) * us * 0.6, dur: big ? 0.55 : 0.18, arc: big ? us * 2.5 : 0, big: big });
            flashUntil[k] = t + 0.08;
          }
        }
      }
      // Einheiten zeichnen (hintere Reihen zuerst)
      var order = troops.map(function (u, k) { return k; }).sort(function (a, b) { return pos[a].y - pos[b].y; });
      order.forEach(function (k) {
        var u = troops[k], p = pos[k], flip = u.fac !== left;
        var fr = p.moving ? Math.floor(t * 6) % 2 : 0;
        ctx.drawImage(sprite(u, fr, flip), Math.round(p.x), Math.round(p.y), us, us);
        if (flashUntil[k] > t) {
          var fxp = flip ? p.x + us * 0.15 : p.x + us * 0.85;
          var g = ctx.createRadialGradient(fxp, p.y + us * 0.45, 0, fxp, p.y + us * 0.45, us * 0.35);
          g.addColorStop(0, 'rgba(255, 250, 200, 0.95)'); g.addColorStop(0.5, 'rgba(255, 170, 40, 0.7)'); g.addColorStop(1, 'rgba(255, 120, 20, 0)');
          ctx.fillStyle = g; ctx.fillRect(fxp - us * 0.4, p.y, us * 0.8, us * 0.9);
        }
      });
      // Geschosse und Einschläge
      shots = shots.filter(function (s) {
        var f = (t - s.t0) / s.dur;
        if (f >= 1) { fx.push({ t0: t, x: s.x1, y: s.y1, big: s.big }); return false; }
        var x = s.x0 + (s.x1 - s.x0) * f, y = s.y0 + (s.y1 - s.y0) * f - Math.sin(f * Math.PI) * s.arc;
        ctx.strokeStyle = 'rgba(255, 230, 150, 0.9)'; ctx.lineWidth = Math.max(1.5, sc * 0.6); ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x, y);
        var fb = Math.max(0, f - 0.12);
        ctx.lineTo(s.x0 + (s.x1 - s.x0) * fb, s.y0 + (s.y1 - s.y0) * fb - Math.sin(fb * Math.PI) * s.arc); ctx.stroke();
        ctx.fillStyle = '#fff6d0'; ctx.beginPath(); ctx.arc(x, y, sc * 0.7, 0, Math.PI * 2); ctx.fill();
        return true;
      });
      fx = fx.filter(function (e) {
        var age = t - e.t0, life = e.big ? 1.4 : 0.9;
        if (age > life) return false;
        var f = age / life, r = (e.big ? us * 0.9 : us * 0.55) * (0.3 + f * 0.7);
        if (f < 0.35) {
          var g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, r);
          g.addColorStop(0, 'rgba(255, 245, 190, ' + (1 - f * 2) + ')'); g.addColorStop(0.45, 'rgba(255, 140, 30, ' + (0.9 - f * 2) + ')'); g.addColorStop(1, 'rgba(120, 40, 10, 0)');
          ctx.fillStyle = g; ctx.fillRect(e.x - r, e.y - r, r * 2, r * 2);
        }
        // Rauch steigt auf
        for (var j = 0; j < 3; j++) {
          var sy = e.y - f * us * (0.8 + j * 0.3), sx = e.x + Math.sin(f * 5 + j * 2.1) * us * 0.2 + (j - 1) * us * 0.18;
          var sr = r * (0.5 + j * 0.15) * (0.6 + f);
          ctx.fillStyle = 'rgba(40, 40, 46, ' + (0.42 * (1 - f)) + ')';
          ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.fill();
        }
        return true;
      });
      // Luftstreitkräfte mit Schatten
      air.forEach(function (a) {
        var span = W + us * 3, px = ((t * a.v * us * 1.1 + a.off * us * 2) % span) - us * 1.5;
        if (a.fac !== left) px = W - px;
        var y = a.y * H + Math.sin(t * 1.3 + a.off) * us * 0.15;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.22)'; ctx.beginPath(); ctx.ellipse(px + us * 0.5, y + us * 2.2, us * 0.45, us * 0.16, 0, 0, Math.PI * 2); ctx.fill();
        ctx.drawImage(sprite(a, Math.floor(t * 12) % 2, a.fac !== left), Math.round(px), Math.round(y), us, us);
      });
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    return { stop: function () { running = false; }, scene: def.name + ' · ' + ({ sommer: 'Sommer', herbst: 'Herbst', winter: 'Winter', gebirge: 'Gebirge' }[def.theme] || 'Sommer') };
  }

  // ---------------------------------------------------------------- Gefecht-Einrichtung
  UI.skirmishSetup = Store.get('skirmish', { mapId: null, fog: false, funds: 0, income: 1000, slots: {}, powers: true, aiResign: true });
  delete UI.skirmishSetup.dayLimit; delete UI.skirmishSetup.v;
  if (UI.skirmishSetup.aiResign == null) UI.skirmishSetup.aiResign = true;
  UI.allMaps = function () {
    var list = (G.MAPS || []).map(function (m) { return Object.assign({ group: m.players + ' Spieler' }, m); });
    UI.customMaps().forEach(function (m) { list.push(Object.assign({ group: 'Eigene Karten', custom: true }, m)); });
    list.forEach(function (m) { m.players = G.mapPlayerCount(m); });
    return list;
  };
  UI.onlineSetup = Store.get('online', { mapId: null, funds: 0, income: 1000, slots: {}, powers: true, aiResign: true });
  UI.showSkirmish = function (mode) {
    UI.music('menu');
    var p2p = !!(mode && mode.p2p);
    var online = !!(mode && (mode.online || p2p));
    function back() { if (p2p) G.P2P.show(); else if (online) UI.showOnline(); else UI.showTitle(); }
    var S = online ? UI.onlineSetup : UI.skirmishSetup;
    var maps = UI.allMaps();
    if (!maps.length) { UI.alert('Keine Karten gefunden.'); return; }
    var mapIdx = Math.max(0, maps.findIndex(function (m) { return m.id === S.mapId; }));
    var CONTROL = online ? ['host', 'net', 'ai:leicht', 'ai:normal', 'ai:schwer'] : ['human', 'ai:leicht', 'ai:normal', 'ai:schwer'];
    var CONTROL_LABEL = { 'human': 'Mensch', 'host': 'Du', 'net': 'Mitspieler (Netz)', 'ai:leicht': 'KI leicht', 'ai:normal': 'KI normal', 'ai:schwer': 'KI schwer' };
    UI.screen('', function (wrap) {
      wrap.appendChild(h('h2', { text: p2p ? 'HANDY ZU HANDY · KARTE WÄHLEN' : online ? 'ONLINE-GEFECHT · KARTE WÄHLEN' : 'GEFECHT' }));
      var grid = h('div', { class: 'grid2' });
      var list = h('div', { class: 'panel maplist' });
      var right = h('div', { class: 'panel' });
      grid.appendChild(list); grid.appendChild(right);
      wrap.appendChild(grid);
      var lastGroup = null, rows = [];
      maps.forEach(function (m, i) {
        if (m.group !== lastGroup) { list.appendChild(h('div', { class: 'group', text: m.group })); lastGroup = m.group; }
        var p = G.parseMap(m);
        var r = h('div', { class: 'mi', onclick: function () { pick(i); } }, [m.name, h('span', { text: p.w + '×' + p.h })]);
        rows.push(r); list.appendChild(r);
      });
      function slotCfg(slot) {
        var c = S.slots[slot] || {};
        var co = c.co && G.COS[c.co] ? c.co : G.FACTIONS[c.faction || G.FACTION_ORDER[slot - 1]].co;
        return {
          faction: c.faction || G.FACTION_ORDER[slot - 1],
          co: co,
          co2: c.co2 && G.COS[c.co2] && c.co2 !== co ? c.co2 : null,
          control: c.control && CONTROL.indexOf(c.control) >= 0 ? c.control : (online ? (slot === 1 ? 'host' : slot === 2 ? 'net' : 'ai:normal') : (slot === 1 ? 'human' : 'ai:normal')),
          team: c.team || slot
        };
      }
      function pick(i) {
        mapIdx = i;
        rows.forEach(function (r, k) { r.classList.toggle('sel', k === i); });
        rows[i].scrollIntoView({ block: 'nearest' });
        S.mapId = maps[i].id;
        renderRight();
      }
      function renderRight() {
        var m = maps[mapIdx], p = G.parseMap(m), n = m.players;
        right.innerHTML = '';
        var props = G.Game.prototype.allProperties.call({ map: p });
        var pv = h('div', { class: 'preview' });
        var mm = G.Render.minimap(m, Math.max(3, Math.min(10, Math.floor(300 / Math.max(p.w, p.h)))), function (slot) { return slotCfg(slot).faction; });
        pv.appendChild(mm);
        var cnt = {}; props.forEach(function (q) { cnt[q.t] = (cnt[q.t] || 0) + 1; });
        pv.appendChild(h('div', {}, [
          h('h3', { text: m.name, style: { margin: '0 0 4px' } }),
          h('p', { text: m.desc || '', style: { margin: '0 0 6px', fontSize: '14px' } }),
          h('div', { style: { fontSize: '13px' }, html: p.w + '×' + p.h + ' Felder · ' + n + ' Spieler · Landschaft: ' + (G.THEMES[m.theme] || 'Sommer') + '<br>Städte ' + (cnt.C || 0) + ' · Fabriken ' + (cnt.K || 0) + ' · Flughäfen ' + (cnt.A || 0) + ' · Häfen ' + (cnt.O || 0) + (m.units && m.units.length ? '<br>Vorplatzierte Einheiten: ' + m.units.length : '') })
        ]));
        right.appendChild(pv);
        var slots = h('div', { class: 'slots' });
        for (var s = 1; s <= n; s++) (function (slot) {
          var cfg = slotCfg(slot);
          S.slots[slot] = cfg;
          var pc = UI.coPortrait(cfg.co, cfg.co2, cfg.faction);
          var row = h('div', { class: 'slot setup-slot' });
          var pick = h('button', { class: 'co-pick', title: 'Kommandanten ansehen und wählen', onclick: function () {
            UI.coSheet(S.slots[slot].co, { pick: true, faction: S.slots[slot].faction, title: 'Kommandant für ' + G.FACTIONS[S.slots[slot].faction].name }).then(function (id) {
              if (id && id !== 'none') { S.slots[slot].co = id; if (S.slots[slot].co2 === id) S.slots[slot].co2 = null; coCyc.set(id); refreshPortrait(); }
            });
          } }, [pc, h('span', { class: 'co-pick-i', text: 'i' })]);
          function refreshPortrait() {
            var c2 = UI.coPortrait(S.slots[slot].co, S.slots[slot].co2, S.slots[slot].faction); pick.replaceChild(c2, pick.firstChild);
            var p2 = S.slots[slot].co2;
            fusionBtn.textContent = p2 ? 'Fusion: ' + G.COS[p2].name.split(' ')[0] + ' ✕' : '＋ Fusion';
            fusionBtn.classList.toggle('on', !!p2);
            fusionBtn.title = p2 ? 'Fusion mit ' + G.COS[p2].name + ' – antippen zum Ändern oder Entfernen' : 'Zweiten Kommandanten dazunehmen: beide Fähigkeiten (je 70 %), beide Kräfte zugleich';
          }
          row.appendChild(pick);
          var coCyc = cycler(G.CO_ORDER, Math.max(0, G.CO_ORDER.indexOf(cfg.co)), function (v) { S.slots[slot].co = v; if (S.slots[slot].co2 === v) S.slots[slot].co2 = null; refreshPortrait(); }, function (v) { return G.COS[v].name; });
          var fusionBtn = h('button', { class: 'btn small fusion', onclick: function () {
            var cur = S.slots[slot];
            UI.coSheet(cur.co2 || null, { pick: true, faction: cur.faction, title: 'Fusion – zweiter Kommandant', exclude: cur.co, allowNone: !!cur.co2,
              intro: 'Zwei Kommandanten führen gemeinsam: Beide Dauer-Fähigkeiten gelten (zu je 70 %), die Kräfte beider werden zugleich ausgelöst – brauchen dafür aber mehr Sterne.' }).then(function (id) {
              if (id === 'none') cur.co2 = null; else if (id) cur.co2 = id; else return;
              refreshPortrait();
            });
          } });
          row.appendChild(cycler(G.FACTION_ORDER, G.FACTION_ORDER.indexOf(cfg.faction), function (v) {
            S.slots[slot].faction = v; refreshPortrait(); renderPreviewOnly();
          }, function (v) { return G.FACTIONS[v].name; }));
          row.appendChild(h('div', { class: 'co-cell' }, [coCyc, fusionBtn]));
          refreshPortrait();
          row.appendChild(cycler(CONTROL, CONTROL.indexOf(cfg.control), function (v) { S.slots[slot].control = v; }, function (v) { return CONTROL_LABEL[v]; }));
          row.appendChild(cycler([1, 2, 3, 4], cfg.team - 1, function (v) { S.slots[slot].team = v; }, function (v) { return 'Team ' + v; }));
          slots.appendChild(row);
        })(s);
        right.appendChild(slots);
        right.appendChild(h('p', { class: 'hint co-hint', text: 'Tipp: Aufs Bild tippen, um alle Kommandanten mit ihren Fähigkeiten zu lesen und auszuwählen. „＋ Fusion“ nimmt einen zweiten Kommandanten dazu.' }));
        function renderPreviewOnly() {
          var mm2 = G.Render.minimap(m, Math.max(3, Math.min(10, Math.floor(300 / Math.max(p.w, p.h)))), function (slot) { return S.slots[slot].faction; });
          pv.replaceChild(mm2, pv.firstChild);
        }
        var opts = h('div', { class: 'opts' });
        function opt(label, el) { opts.appendChild(h('div', { class: 'opt' }, [h('span', { text: label }), el])); }
        var VIS = ['erkundung', 'nebel', 'offen'];
        if (!S.vision) S.vision = 'erkundung';
        opt('Sicht', cycler(VIS, Math.max(0, VIS.indexOf(S.vision)), function (v) { S.vision = v; }, function (v) {
          return { erkundung: 'Erkundung', nebel: 'Nebel des Krieges', offen: 'Offene Karte' }[v];
        }));
        opt('Startkapital', cycler([0, 1000, 3000, 5000, 10000, 20000, 50000], [0, 1000, 3000, 5000, 10000, 20000, 50000].indexOf(S.funds) < 0 ? 0 : [0, 1000, 3000, 5000, 10000, 20000, 50000].indexOf(S.funds), function (v) { S.funds = v; }, function (v) { return UI.fmt(v) + ' G'; }));
        opt('Einkommen/Gebäude', cycler([500, 1000, 1500, 2000, 3000], Math.max(0, [500, 1000, 1500, 2000, 3000].indexOf(S.income)), function (v) { S.income = v; }, function (v) { return UI.fmt(v) + ' G'; }));
        opt('CO-Kräfte', cycler([true, false], S.powers === false ? 1 : 0, function (v) { S.powers = v; }, function (v) { return v ? 'An' : 'Aus'; }));
        var WM = Object.keys(G.WEATHER_MODES);
        opt('Wetter', cycler(WM, Math.max(0, WM.indexOf(S.weather || 'auto')), function (v) { S.weather = v; }, function (v) { return G.WEATHER_MODES[v]; }));
        opt('KI gibt aussichtslos auf', cycler([true, false], S.aiResign === false ? 1 : 0, function (v) { S.aiResign = v; }, function (v) { return v ? 'Ja' : 'Nein'; }));
        right.appendChild(opts);
        var acts = h('div', { class: 'actions' });
        acts.appendChild(h('button', { class: 'btn', text: 'Zurück', onclick: function () { UI.sfx('cancel'); back(); } }));
        acts.appendChild(h('button', { class: 'btn primary', text: online ? 'Raum eröffnen ▶' : 'Schlacht beginnen ▶', onclick: start }));
        right.appendChild(acts);
      }
      function start() {
        var m = maps[mapIdx];
        var players = [];
        for (var s = 1; s <= m.players; s++) {
          var c = S.slots[s];
          players.push({ slot: s, faction: c.faction, co: c.co, co2: c.co2 || null, ai: c.control !== 'human', aiLevel: c.control.split(':')[1] || 'normal', team: c.team });
        }
        var teams = {}; players.forEach(function (p) { teams[p.team] = 1; });
        if (Object.keys(teams).length < 2) { UI.alert('Mindestens zwei verschiedene Teams nötig.'); return; }
        // gleiche Fraktion doppelt? -> zulassen, aber Farbe muss unterscheidbar sein
        var used = {}, dup = false; players.forEach(function (p) { if (used[p.faction]) dup = true; used[p.faction] = 1; });
        if (dup) { UI.alert('Jede Fraktion darf nur einmal vorkommen.'); return; }
        if (online) {
          var ctl = []; for (var q = 1; q <= m.players; q++) ctl.push(S.slots[q].control);
          if (ctl.filter(function (c) { return c === 'host'; }).length !== 1) { UI.alert('Genau ein Platz muss „Du“ sein.'); return; }
          if (ctl.indexOf('net') < 0) { UI.alert('Mindestens ein Platz muss „Mitspieler (Netz)“ sein.'); return; }
          Store.set('online', S);
          UI.sfx('confirm');
          (p2p ? G.P2P.createRoom : G.Net.createRoom)({
            map: { id: m.id, name: m.name, players: m.players, rows: m.rows, units: m.units, desc: m.desc, theme: m.theme },
            fog: (S.vision || 'erkundung') !== 'offen', funds: S.funds, income: S.income,
            meta: { powers: S.powers !== false, income: S.income, aiResign: S.aiResign !== false, weatherMode: S.weather || 'auto', vision: S.vision || 'erkundung' },
            seats: players.map(function (p) { return { slot: p.slot, faction: p.faction, co: p.co, co2: p.co2 || null, team: p.team, control: S.slots[p.slot].control }; })
          });
          return;
        }
        Store.set('skirmish', S);
        UI.sfx('confirm');
        G.Play.startNew({
          map: m, players: players, fog: (S.vision || 'erkundung') !== 'offen', funds: S.funds, income: S.income,
          meta: { mode: 'skirmish', powers: S.powers !== false, income: S.income, aiResign: S.aiResign !== false, weatherMode: S.weather || 'auto', vision: S.vision || 'erkundung' }
        });
      }
      pick(mapIdx);
      return {
        onAction: function (a) {
          if (a === 'up') pick((mapIdx - 1 + maps.length) % maps.length);
          else if (a === 'down') pick((mapIdx + 1) % maps.length);
          else if (a === 'a') start();
          else if (a === 'b') back();
          return true;
        }
      };
    });
  };

  // ---------------------------------------------------------------- Kampagne
  UI.showCampaign = function () {
    UI.music('menu');
    var C = G.CAMPAIGN || [];
    var prog = UI.campaignProgress();
    var sel = 0;
    for (var i = 0; i < C.length; i++) if (prog.done[C[i].id]) sel = Math.min(C.length - 1, i + 1);
    UI.screen('', function (wrap) {
      wrap.appendChild(h('h2', { text: 'KAMPAGNE – DER FRIEDENSPOKAL' }));
      var grid = h('div', { class: 'missions' });
      wrap.appendChild(grid);
      var cards = [];
      C.forEach(function (m, i) {
        var unlocked = i === 0 || prog.done[C[i - 1].id] || prog.done[m.id];
        var d = prog.done[m.id];
        var card = h('div', { class: 'panel mission' + (unlocked ? '' : ' locked'), onclick: function () { if (unlocked) { setSel(i); go(); } } }, [
          h('div', { class: 'num', text: 'MISSION ' + (i + 1) }),
          h('div', { class: 'mt', text: unlocked ? m.title : '???' }),
          h('div', { style: { fontSize: '13px' }, text: unlocked ? (m.hint || '') : 'Noch gesperrt.' }),
          d ? h('div', { class: 'rank', text: d.rank }) : null
        ]);
        card._unlocked = unlocked;
        cards.push(card); grid.appendChild(card);
      });
      function setSel(i) { sel = i; cards.forEach(function (c, k) { c.classList.toggle('sel', k === i); }); if (cards[i]) cards[i].scrollIntoView({ block: 'nearest' }); }
      function go() { if (!cards[sel] || !cards[sel]._unlocked) { UI.sfx('error'); return; } UI.sfx('confirm'); G.Play.startMission(sel); }
      var acts = h('div', { class: 'actions' });
      acts.appendChild(h('button', { class: 'btn', text: 'Zurück', onclick: function () { UI.showTitle(); } }));
      acts.appendChild(h('button', { class: 'btn danger', text: 'Fortschritt löschen', onclick: function () {
        UI.confirm('Kampagnenfortschritt wirklich löschen?').then(function (ok) { if (ok) { UI.saveCampaignProgress({ done: {} }); UI.showCampaign(); } });
      } }));
      wrap.appendChild(acts);
      setSel(sel);
      return {
        onAction: function (a) {
          var cols = Math.max(1, Math.round(grid.clientWidth / 262));
          if (a === 'left') setSel(Math.max(0, sel - 1));
          else if (a === 'right') setSel(Math.min(C.length - 1, sel + 1));
          else if (a === 'up') setSel(Math.max(0, sel - cols));
          else if (a === 'down') setSel(Math.min(C.length - 1, sel + cols));
          else if (a === 'a') go();
          else if (a === 'b') UI.showTitle();
          return true;
        }
      };
    });
  };

  // ---------------------------------------------------------------- Laden
  UI.saveLabel = function (game) {
    var cp = game.currentPlayer();
    return (game.mapDef.name || 'Karte') + ' · Tag ' + game.day + ' · ' + cp.name;
  };
  UI.showLoad = function (back) {
    UI.screen('', function (wrap) {
      wrap.appendChild(h('h2', { text: 'SPIEL LADEN' }));
      var keys = ['auto', 1, 2, 3];
      var box = h('div', { class: 'panel', style: { maxWidth: '640px' } });
      keys.forEach(function (k) {
        var s = Store.get('save:' + k, null);
        var row = h('div', { class: 'opt', style: { marginBottom: '6px' } }, [
          h('span', { text: (k === 'auto' ? 'Autosave' : 'Slot ' + k) + ': ' + (s ? s.label + ' (' + new Date(s.date).toLocaleString('de-DE') + ')' : '— leer —') }),
          h('button', { class: 'btn primary', text: 'Laden', disabled: !s, onclick: function () { G.Play.loadSave(k); } })
        ]);
        box.appendChild(row);
      });
      wrap.appendChild(box);
      var acts = h('div', { class: 'actions', style: { justifyContent: 'flex-start' } });
      acts.appendChild(h('button', { class: 'btn', text: 'Zurück', onclick: function () { (back || UI.showTitle)(); } }));
      wrap.appendChild(acts);
      return { onAction: function (a) { if (a === 'b') (back || UI.showTitle)(); return true; } };
    });
  };

  // ---------------------------------------------------------------- Optionen
  UI.optionsPanel = function (onChange) {
    var S = UI.settings;
    var box = h('div', { class: 'opts' });
    function opt(label, el) { box.appendChild(h('div', { class: 'opt' }, [h('span', { text: label }), el])); }
    var vols = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
    function near(v) { var b = 0; vols.forEach(function (x, i) { if (Math.abs(x - v) < Math.abs(vols[b] - v)) b = i; }); return b; }
    opt('Musik', cycler(vols, near(S.music), function (v) { S.music = v; UI.saveSettings(); }, function (v) { return Math.round(v * 100) + ' %'; }));
    opt('Effekte', cycler(vols, near(S.sfx), function (v) { S.sfx = v; UI.saveSettings(); UI.sfx('select'); }, function (v) { return Math.round(v * 100) + ' %'; }));
    opt('Kampfanimation', cycler(['on', 'short', 'off'], ['on', 'short', 'off'].indexOf(S.battleAnim), function (v) { S.battleAnim = v; UI.saveSettings(); }, function (v) { return { on: 'Voll', short: 'Kurz', off: 'Aus' }[v]; }));
    opt('KI-Tempo', cycler(['normal', 'fast', 'instant'], ['normal', 'fast', 'instant'].indexOf(S.aiSpeed), function (v) { S.aiSpeed = v; UI.saveSettings(); }, function (v) { return { normal: 'Normal', fast: 'Schnell', instant: 'Sofort' }[v]; }));
    opt('Zoom', cycler(['auto', 2, 3, 4, 5], Math.max(0, ['auto', 2, 3, 4, 5].indexOf(S.zoom)), function (v) { S.zoom = v; UI.saveSettings(); if (onChange) onChange(); }, function (v) { return v === 'auto' ? 'Auto' : v + '×'; }));
    opt('Runde beenden fragen', cycler([true, false], S.confirmEnd ? 0 : 1, function (v) { S.confirmEnd = v; UI.saveSettings(); }, function (v) { return v ? 'Ja' : 'Nein'; }));
    opt('Unerforschtes Gebiet', cycler(['grau', 'schwarz'], S.unexplored === 'schwarz' ? 1 : 0, function (v) { S.unexplored = v; UI.saveSettings(); }, function (v) { return v === 'grau' ? 'Ausgegraut' : 'Schwarz'; }));
    opt('Gitterlinien', cycler([false, true], S.showGrid ? 1 : 0, function (v) { S.showGrid = v; UI.saveSettings(); }, function (v) { return v ? 'An' : 'Aus'; }));
    return box;
  };
  UI.showOptions = function (back) {
    UI.screen('', function (wrap) {
      wrap.appendChild(h('h2', { text: 'OPTIONEN' }));
      var p = h('div', { class: 'panel' });
      p.appendChild(UI.optionsPanel());
      wrap.appendChild(p);
      var acts = h('div', { class: 'actions', style: { justifyContent: 'flex-start' } });
      acts.appendChild(h('button', { class: 'btn', text: 'Zurück', onclick: function () { (back || UI.showTitle)(); } }));
      wrap.appendChild(acts);
      return { onAction: function (a) { if (a === 'b') (back || UI.showTitle)(); return true; } };
    });
  };

  // ---------------------------------------------------------------- Kommandanten
  UI.coCard = function (id, extra, faction) {
    var co = G.COS[id];
    var card = h('div', { class: 'panel co-card' });
    card.appendChild(portraitCanvas(id, faction || co.faction));
    card.appendChild(h('div', {}, [
      h('h3', { text: co.name }),
      h('p', { text: co.bio }),
      h('p', { html: '<b>Ständig:</b> ' + UI.esc(co.d2d) }),
      h('p', { class: 'pw', html: '<b>' + UI.esc(co.power.name) + '</b> (' + co.power.stars + '★): ' + UI.esc(co.power.desc) }),
      h('p', { class: 'pw', html: '<b>' + UI.esc(co.superPower.name) + '</b> (' + co.superPower.stars + '★): ' + UI.esc(co.superPower.desc) }),
      extra || null
    ]));
    return card;
  };
  UI.showCOs = function () {
    UI.screen('', function (wrap) {
      wrap.appendChild(h('h2', { text: 'KOMMANDANTEN' }));
      var grid = h('div', { class: 'co-grid' });
      G.CO_ORDER.forEach(function (id) { grid.appendChild(UI.coCard(id)); });
      wrap.appendChild(grid);
      var acts = h('div', { class: 'actions', style: { justifyContent: 'flex-start' } });
      acts.appendChild(h('button', { class: 'btn', text: 'Zurück', onclick: function () { UI.showTitle(); } }));
      wrap.appendChild(acts);
      return { onAction: function (a) { if (a === 'b') UI.showTitle(); return true; } };
    });
  };

  // ---------------------------------------------------------------- Anleitung
  /** Tastenkürzel – eine Liste für Übersicht (F1) und Anleitung */
  var KEYS = [
    ['Karte', [
      [['←↑↓→', 'WASD'], 'Cursor bewegen'],
      [['Umschalt', '+ Pfeile'], 'Cursor 5 Felder weit'],
      [['Enter', 'Leertaste'], 'Auswählen / bestätigen'],
      [['Esc', 'X'], 'Zurück · auf leerem Feld: Menü'],
      [['N', 'Tab'], 'Nächste bereite Einheit'],
      [['Umschalt', '+ Tab'], 'Vorige bereite Einheit'],
      [['B'], 'Nächste freie Fabrik (zum Bauen)'],
      [['H'], 'Zum eigenen Hauptquartier'],
      [['I'], 'Info zu Feld und Einheit (inkl. Ladung)'],
      [['Q'], 'Gegner-Reichweite an/aus'],
      [['V'], 'Gegner-Sicht an/aus (gelb: dort sieht dich der Gegner)'],
      [['U'], 'Letzten Zug zurücknehmen (einmal je Runde; nicht nach Angriffen)'],
      [['C'], 'Minikarte an/aus'],
      [['+', '−'], 'Zoom']
    ]],
    ['Zug', [
      [['E'], 'Runde beenden'],
      [['P'], 'CO-Kraft'],
      [['L'], 'Lagebericht'],
      [['Strg', '+ S'], 'Speichern'],
      [['T'], 'Nachricht senden (online)'],
      [['Enter'], 'Online, während der Gegner zieht: eigene Einheit vorplanen']
    ]],
    ['Menüs', [
      [['1', '…', '9'], 'Eintrag direkt wählen'],
      [['↑', '↓'], 'Eintrag wechseln'],
      [['Enter'], 'Wählen'],
      [['I'], 'Alle Werte (z. B. in der Fabrik)'],
      [['Esc'], 'Schließen']
    ]],
    ['Allgemein', [
      [['O'], 'Optionen'],
      [['M'], 'Ton an/aus'],
      [['F', 'F11'], 'Vollbild'],
      [['F1', '?'], 'Diese Übersicht']
    ]]
  ];
  UI.keysTable = function () {
    return '<div class="keys-grid">' + KEYS.map(function (grp) {
      return '<div class="keys-group"><h4>' + grp[0] + '</h4><table>' + grp[1].map(function (r) {
        var k = r[0].map(function (x) {
          if (x === '…') return '…';
          if (x.indexOf('+ ') === 0) return '+ <span class="kbd">' + x.slice(2) + '</span>';
          return '<span class="kbd">' + x + '</span>';
        }).join(' ');
        return '<tr><td class="k">' + k + '</td><td>' + r[1] + '</td></tr>';
      }).join('') + '</table></div>';
    }).join('') + '</div>';
  };
  UI.keysHtml = function () { return '<h3 style="margin-top:0">Tastenkürzel</h3>' + UI.keysTable(); };
  UI.helpHtml = function () {
    var units = G.UNIT_ORDER.map(function (k) {
      var u = G.UNITS[k];
      return '<tr><td>' + u.name + '</td><td>' + UI.fmt(u.cost) + '</td><td>' + u.move + '</td><td>' + u.vision + '</td><td>' +
        (u.range[1] ? (u.range[0] === u.range[1] ? u.range[0] : u.range[0] + '–' + u.range[1]) : '–') + '</td><td>' + u.fuel + '</td><td>' + (u.ammo || '–') + '</td><td style="text-align:left">' + u.desc + '</td></tr>';
    }).join('');
    var terr = Object.keys(G.TERRAIN).map(function (k) {
      var t = G.TERRAIN[k];
      return '<tr><td>' + t.name + '</td><td>' + '★'.repeat(t.def) + '</td><td style="text-align:left">' + (G.TERRAIN_DESC[k] || '') + '</td></tr>';
    }).join('');
    var cols = G.UNIT_ORDER;
    var dmg = '<table class="dmgtable"><tr><th>A \\ V</th>' + cols.map(function (c) { return '<th title="' + G.UNITS[c].name + '">' + G.UNITS[c].short + '</th>'; }).join('') + '</tr>' +
      cols.map(function (a) {
        var D = G.DAMAGE[a];
        return '<tr><th>' + G.UNITS[a].short + '</th>' + cols.map(function (d) {
          var p = D.primary && D.primary[d], s = D.secondary && D.secondary[d];
          var v = p != null ? p : (s != null ? s : '');
          return '<td' + (p != null ? ' style="font-weight:bold"' : '') + '>' + v + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</table>';
    return '' +
      '<h3>Ziel</h3><p>Erobere das gegnerische <b>Hauptquartier</b> oder vernichte alle feindlichen Einheiten. In der Kampagne gibt es auch Missionen, in denen du durchhalten oder ein bestimmtes Gebäude einnehmen musst.</p>' +
      '<h3>Steuerung</h3>' + UI.keysTable() +
      '<ul><li>Maus: Linksklick = auswählen, Rechtsklick = zurück, Mittlere Taste ziehen = Karte verschieben, Mausrad = Zoom. Touch: Tippen = auswählen, Wischen = verschieben, zwei Finger = Zoom.</li></ul>' +
      '<h3>Ablauf eines Zuges</h3><p>Wähle eine Einheit, ziehe sie auf ein blaues Feld und wähle eine Aktion: <b>Angriff</b>, <b>Einnehmen</b>, <b>Warten</b>, <b>Laden/Entladen</b>, <b>Versorgen</b>, <b>Vereinen</b> (gleicher Typ, beschädigt), <b>Tauchen</b>, <b>Befestigen</b> (Pionier baut Bunker, Geschützturm, Flakstellung oder Küstenbatterie auf ein Nachbarfeld) oder <b>Reparieren</b> (Bergepanzer heilt einen Nachbarn um 2 KP). Auf eigenen Fabriken, Flughäfen und Häfen baust du neue Einheiten. Jedes Gebäude bringt pro Tag Einkommen.</p>' +
      '<h3>Kampf</h3><p>Schaden hängt vom Einheitentyp, den Lebenspunkten (KP) beider Seiten, der Geländedeckung (★) des Verteidigers und dem CO ab. Direkte Angreifer erhalten einen Gegenschlag, sofern der Verteidiger überlebt und zurückschießen kann. Indirekte Einheiten (Artillerie, Raketen, Schlachtschiff …) dürfen nicht im selben Zug ziehen und feuern, bekommen aber auch keinen Gegenschlag.</p>' +
      '<h3>Einnehmen</h3><p>Infanterie und Grenadiere nehmen Gebäude ein. Ein Gebäude hat 20 Punkte; pro Einnahme-Aktion werden die KP der Einheit abgezogen. Verlässt die Einheit das Feld, beginnt die Einnahme von vorn.</p>' +
      '<h3>Nachschub & Reparatur</h3><p>Auf eigenen Gebäuden werden passende Einheiten zu Rundenbeginn um 2 KP repariert (kostet 10 % des Preises pro KP) und aufgetankt. Transporter versorgen angrenzende Einheiten. Flugzeuge und Schiffe verbrauchen täglich Treibstoff – bei 0 stürzen sie ab bzw. sinken.</p>' +
      '<h3>Sicht: Erkundung und Nebel</h3><p>Bei <b>Erkundung</b> (Standard) ist alles ausgegraut (oder in den Optionen: schwarz), was du noch nie gesehen hast. Erkundetes Gelände bleibt sichtbar, zeigt aber nur den zuletzt gesehenen Besitzer der Gebäude. Gegner siehst du nur im Sichtbereich deiner Truppen. Jede Einheit hat ihre eigene Sichtweite (Späher 7, Drohne 9, Infanterie 3 … – die Einheitenkarte zeigt sie als 👁, der Auge-Knopf oben bzw. die Taste V zeigt gelb, welche Felder sichtbare Gegner einsehen), dein HQ deckt die Umgebung auf. Beim klassischen <b>Nebel des Krieges</b> ist das Gelände bekannt, Einheiten sind aber verborgen. Du siehst nur, was deine Einheiten sehen. Wald und Riffe verbergen Einheiten, bis man direkt daneben steht. Infanterie auf Bergen sieht weiter. Läufst du in einen versteckten Gegner, gerätst du in einen <b>Hinterhalt</b> und dein Zug endet.</p>' +
      '<h3>CO-Kräfte</h3><p>Jeder Kommandant hat Dauer-Eigenschaften und zwei Kräfte. Die Sterne füllen sich durch Schaden (erlittener zählt voll, ausgeteilter halb). Mit genug Sternen aktivierst du die Kraft oder die Superkraft über das Menü. Während einer Kraft bekommen alle Einheiten zusätzlich +10 % Angriff und Verteidigung. Jede Aktivierung macht die nächste etwas teurer.</p>' +
      '<h3>Einheiten</h3><table class="stats"><tr><th>Einheit</th><th>Preis</th><th>Bew.</th><th>Sicht</th><th>Reichw.</th><th>Treibst.</th><th>Mun.</th><th>Beschreibung</th></tr>' + units + '</table>' +
      '<h3>Gelände</h3><table class="stats"><tr><th>Gelände</th><th>Deckung</th><th>Hinweis</th></tr>' + terr + '</table>' +
      '<h3>Basisschaden (%)</h3><p>Zeile = Angreifer, Spalte = Verteidiger. Fett = Hauptwaffe (verbraucht Munition).</p><div style="overflow-x:auto">' + dmg + '</div>';
  };
  UI.showHelp = function (back) {
    UI.screen('', function (wrap) {
      wrap.appendChild(h('h2', { text: 'ANLEITUNG' }));
      wrap.appendChild(h('div', { class: 'panel help', html: UI.helpHtml() }));
      var acts = h('div', { class: 'actions', style: { justifyContent: 'flex-start' } });
      acts.appendChild(h('button', { class: 'btn', text: 'Zurück', onclick: function () { (back || UI.showTitle)(); } }));
      wrap.appendChild(acts);
      return { onAction: function (a, ev) {
        if (a === 'b') (back || UI.showTitle)();
        else if (a === 'down') wrap.parentNode.scrollTop += 60;
        else if (a === 'up') wrap.parentNode.scrollTop -= 60;
        return true;
      } };
    });
  };
})();
