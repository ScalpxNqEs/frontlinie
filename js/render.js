// FRONTLINIE – Darstellung (Canvas, vektorgezeichnetes Gelände in hoher Auflösung, geglättete Sprites)
var G = (typeof globalThis !== 'undefined' ? globalThis : window).G = (globalThis.G || {});

(function () {
  'use strict';
  // Weltmaß: 16 Einheiten je Feld (Spiellogik, Kamera). Das Gelände wird mit Faktor D (2–4) feiner gezeichnet,
  // Einheiten-Pixelgrafik wird per Scale3x auf 48×48 geglättet. Alle Zeichenroutinen rechnen in 16er-Koordinaten.
  var TS = 16;
  var R = G.Render = { TILE: TS, D: 3, fx: [], cache: {}, time: 0 };

  // ------------------------------------------------------------ Farben
  var C = {
    grass: '#6ec84c', grassD: '#56ad3c', grassL: '#90dc6a', grassX: '#62ba44',
    tree: '#2f9c40', treeD: '#1e6c2c', treeL: '#72d65a', trunk: '#6a4524',
    rock: '#8f7c68', rockD: '#5f4e40', rockL: '#bba893', snow: '#f6f9ff', outline: '#2a2230',
    road: '#d2cab8', roadD: '#9c9385', roadL: '#efe9dc',
    sea: '#2d7ce4', seaD: '#1d5cbf', seaL: '#62abff', shallow: '#7fd0f5', foam: '#f2fbff',
    river: '#3e95ee', riverD: '#2466c2', riverL: '#9fd3ff',
    sand: '#f1dd9c', sandD: '#d3b56c', sandL: '#fbf0c8',
    reef: '#857a6a', reefD: '#574b3f', reefL: '#aea293',
    plank: '#b47c3e', plankD: '#6f4818', plankL: '#dba866',
    plaza: '#dcd6c8', plazaD: '#aaa294', wall: '#ece8e0', wallD: '#c9c3b8', glass: '#9fd6ff', glassD: '#4f8fc8'
  };
  R.COLORS = C;
  // Landschaften: Farbsätze, die die Grundfarben überschreiben
  var BASE_C = Object.assign({}, C);
  var THEME_C = {
    sommer: {},
    herbst: { grass: '#b9b85c', grassD: '#949a40', grassL: '#d6d47e', grassX: '#aaac52', tree: '#d8862e', treeD: '#8f4a16', treeL: '#f5bc52', trunk: '#5a3a1a',
      plaza: '#d8d0bc', sand: '#e8d090' },
    winter: { grass: '#e8eef6', grassD: '#c6d3e2', grassL: '#ffffff', grassX: '#dde6f0', tree: '#3e7a62', treeD: '#1f4838', treeL: '#e9f5ff', trunk: '#4d3a2a',
      rock: '#a6aec0', rockD: '#6a7286', rockL: '#dde4ee', road: '#c8c2bc', roadD: '#938b85', roadL: '#e8e4e0',
      sea: '#2f5fb0', seaD: '#20448a', seaL: '#88b0e8', shallow: '#9cc8ec', river: '#7fb0e8', riverL: '#cce6ff', riverD: '#4f7fc0',
      sand: '#e2e6ec', sandD: '#b8c0ca', sandL: '#f4f6f8', plaza: '#e4e8ee', plazaD: '#aab2bc', foam: '#ffffff' },
    gebirge: { grass: '#a8b876', grassD: '#889852', grassL: '#c4d292', grassX: '#9eae6c', tree: '#3f7a38', treeD: '#234f28', treeL: '#6aa452',
      rock: '#a98d6d', rockD: '#6b5541', rockL: '#d1bda1', sand: '#d9c992', plaza: '#d6cfbe' }
  };
  var MINI = { P: '#6ec84c', F: '#2c8a3c', M: '#8c7a66', R: '#d2cab8', B: '#b47c3e', I: '#3e95ee', S: '#2d7ce4', H: '#f1dd9c', X: '#5f6a8a' };
  var THEME_MINI = {
    sommer: {}, herbst: { P: '#b9b85c', F: '#c87a2c', H: '#e8d090' },
    winter: { P: '#e8eef6', F: '#3e7a62', M: '#9aa2b2', S: '#2f5fb0', I: '#7fb0e8', H: '#e2e6ec', R: '#c8c2bc' },
    gebirge: { P: '#a8b876', F: '#3f7a38', M: '#8a6c50', H: '#d9c992' }
  };
  var TC = {}; // Geländefeld-Cache (je Landschaft, Detailfaktor, Art, Umgebung)
  R.theme = 'sommer';
  R.setTheme = function (name) {
    name = THEME_C[name] ? name : 'sommer';
    Object.keys(BASE_C).forEach(function (k) { C[k] = BASE_C[k]; });
    Object.assign(C, THEME_C[name]);
    R.theme = name;
    TC = {};
  };

  function hash(x, y, s) {
    var h = (x * 374761393 + y * 668265263 + (s || 0) * 2147483647) | 0;
    h = (h ^ (h >>> 13)) * 1274126177 | 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function mkCanvas(w, h) {
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    var ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
    return c;
  }
  R.mkCanvas = mkCanvas;
  function rect(ctx, x, y, w, h, col) { ctx.fillStyle = col; ctx.fillRect(x, y, w, h); }
  function disc(ctx, cx, cy, r, col) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); }

  // ------------------------------------------------------------ Farb- und Zeichenhilfen
  function hexToRgb(h) { var n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function rgbToHex(r, g, b) { return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1); }
  function shade(hex, f) { var c = hexToRgb(hex); return rgbToHex(Math.min(255, Math.round(c[0] * f)), Math.min(255, Math.round(c[1] * f)), Math.min(255, Math.round(c[2] * f))); }
  function grey(hex) { var c = hexToRgb(hex); var l = Math.round((c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11) * 0.62); return rgbToHex(l, l, Math.min(255, l + 8)); }
  function rgba(hex, a) { var c = hexToRgb(hex); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  R.shade = shade;
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }
  function fillRR(ctx, x, y, w, h, r, col) { rr(ctx, x, y, w, h, r); ctx.fillStyle = col; ctx.fill(); }
  function strokeRR(ctx, x, y, w, h, r, col, lw) { rr(ctx, x, y, w, h, r); ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.stroke(); }
  function circle(ctx, cx, cy, r, col) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill(); }
  function ellipse(ctx, cx, cy, rx, ry, col) { ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill(); }
  function poly(ctx, pts, col) {
    ctx.beginPath();
    for (var i = 0; i < pts.length; i++) { if (i) ctx.lineTo(pts[i][0], pts[i][1]); else ctx.moveTo(pts[i][0], pts[i][1]); }
    ctx.closePath(); ctx.fillStyle = col; ctx.fill();
  }
  function line(ctx, x1, y1, x2, y2, col, w) { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }

  // ------------------------------------------------------------ Scale3x: Pixelgrafik glätten (Kanten-Interpolation)
  function scale3x(rows) {
    var h = rows.length, w = rows[0].length, out = [];
    function at(x, y) { return (x < 0 || y < 0 || x >= w || y >= h) ? '.' : (rows[y][x] || '.'); }
    for (var y = 0; y < h; y++) {
      var r0 = '', r1 = '', r2 = '';
      for (var x = 0; x < w; x++) {
        var A = at(x - 1, y - 1), B = at(x, y - 1), Cc = at(x + 1, y - 1), D = at(x - 1, y), E = at(x, y), F = at(x + 1, y), Gg = at(x - 1, y + 1), H = at(x, y + 1), I = at(x + 1, y + 1);
        var E0 = E, E1 = E, E2 = E, E3 = E, E5 = E, E6 = E, E7 = E, E8 = E;
        if (B !== H && D !== F) {
          E0 = D === B ? D : E;
          E1 = (D === B && E !== Cc) || (B === F && E !== A) ? B : E;
          E2 = B === F ? F : E;
          E3 = (D === B && E !== Gg) || (D === H && E !== A) ? D : E;
          E5 = (B === F && E !== I) || (H === F && E !== Cc) ? F : E;
          E6 = D === H ? D : E;
          E7 = (D === H && E !== I) || (H === F && E !== Gg) ? H : E;
          E8 = H === F ? F : E;
        }
        r0 += E0 + E1 + E2; r1 += E3 + E + E5; r2 += E6 + E7 + E8;
      }
      out.push(r0, r1, r2);
    }
    return out;
  }
  R.scale3x = scale3x;

  // ------------------------------------------------------------ Sprite-Rendering
  /** Zeichnet ein Raster (Array von Strings) mit Palette und Teamfarben in ein Canvas (3-fach geglättet). */
  function rasterToCanvas(rows, teamColors, opts) {
    opts = opts || {};
    var big = opts.raw ? rows : scale3x(rows);
    var h = big.length, w = big[0].length;
    var c = mkCanvas(w, h), ctx = c.getContext('2d');
    var pal = G.SPRITE_PALETTE || {};
    for (var y = 0; y < h; y++) {
      var row = big[y];
      for (var x = 0; x < w; x++) {
        var ch = row[x];
        if (ch === '.' || ch === ' ' || ch === undefined) continue;
        var col;
        if (ch >= '1' && ch <= '4') col = teamColors[ch.charCodeAt(0) - 49];
        else col = pal[ch];
        if (!col) continue;
        if (opts.grey) col = grey(col);
        var dx = opts.flip ? (w - 1 - x) : x;
        rect(ctx, dx, y, 1, 1, col);
      }
    }
    return c;
  }
  R.rasterToCanvas = rasterToCanvas;
  function teamColors(faction) { return (G.FACTIONS[faction] || G.FACTIONS.neutral).colors; }

  /** Einheiten-Sprite 48×48 (gecacht). */
  R.unitSprite = function (type, faction, frame, flip, done) {
    var key = 'u|' + type + '|' + faction + '|' + frame + '|' + (flip ? 1 : 0) + '|' + (done ? 1 : 0);
    if (R.cache[key]) return R.cache[key];
    var spr = G.SPRITES && G.SPRITES.units && G.SPRITES.units[type];
    var c;
    if (spr && spr.frames && spr.frames.length) {
      var n = spr.frames.length, f = spr.frames[((frame % n) + n) % n];
      c = rasterToCanvas(f, teamColors(faction), { flip: flip, grey: done });
    } else {
      c = fallbackUnit(type, faction, frame, flip, done);
    }
    R.cache[key] = c;
    return c;
  };
  function fallbackUnit(type, faction, frame, flip, done) {
    var c = mkCanvas(TS, TS), ctx = c.getContext('2d');
    var col = teamColors(faction);
    var a = done ? grey(col[1]) : col[1], b = done ? grey(col[3]) : col[3];
    var T = G.UNITS[type];
    var bob = frame ? 1 : 0;
    if (T.cls === 'foot') {
      disc(ctx, 8, 4 + bob, 2, '#f0c090'); rect(ctx, 6, 7 + bob, 5, 6, a); rect(ctx, 6, 13, 2, 2, b); rect(ctx, 9, 13, 2, 2, b);
      rect(ctx, 10, 8 + bob, 5, 1, '#404048');
    } else if (T.domain === 'air') {
      rect(ctx, 2, 7 + bob, 12, 3, a); rect(ctx, 6, 4 + bob, 3, 9, b); rect(ctx, 12, 5 + bob, 2, 4, a);
    } else if (T.domain === 'sea') {
      ctx.fillStyle = b; ctx.beginPath(); ctx.moveTo(1, 9); ctx.lineTo(15, 9); ctx.lineTo(12, 13); ctx.lineTo(3, 13); ctx.fill();
      rect(ctx, 5, 6, 6, 3, a);
    } else {
      rect(ctx, 2, 7, 12, 5, a); rect(ctx, 2, 11, 12, 3, b); rect(ctx, 5, 4, 6, 3, a); rect(ctx, 10, 5, 5, 1, b);
    }
    var big = mkCanvas(TS * 3, TS * 3), bx = big.getContext('2d');
    bx.imageSmoothingEnabled = false;
    if (flip) { bx.translate(TS * 3, 0); bx.scale(-1, 1); }
    bx.drawImage(c, 0, 0, TS * 3, TS * 3);
    return big;
  }
  /** Einheit als DOM-Canvas (für Karten, Menüs) */
  R.unitCanvas = function (type, faction, cssSize, frame, flip) {
    var spr = R.unitSprite(type, faction, frame || 0, !!flip, false);
    var c = mkCanvas(spr.width, spr.height);
    c.getContext('2d').drawImage(spr, 0, 0);
    c.className = 'spr';
    if (cssSize) { c.style.width = cssSize + 'px'; c.style.height = cssSize + 'px'; }
    return c;
  };

  /** CO-Porträt (96×96, geglättet) */
  R.portrait = function (coId, faction) {
    var key = 'p|' + coId + '|' + faction;
    if (R.cache[key]) return R.cache[key];
    if (coId === 'random') {
      // Zufalls-Kommandant: Silhouette in Teamfarbe mit großem Fragezeichen
      var rc = mkCanvas(96, 96), rx = rc.getContext('2d'), tc = teamColors(faction || 'neutral');
      var gr = rx.createLinearGradient(0, 0, 0, 96); gr.addColorStop(0, '#3b4a5c'); gr.addColorStop(1, '#1b232c');
      rx.fillStyle = gr; rx.fillRect(0, 0, 96, 96);
      rx.fillStyle = tc[1]; rx.beginPath(); rx.ellipse(48, 100, 34, 30, 0, Math.PI, 0); rx.fill();
      rx.fillStyle = 'rgba(0,0,0,0.35)'; rx.beginPath(); rx.arc(48, 40, 19, 0, Math.PI * 2); rx.fill();
      rx.font = '900 46px sans-serif'; rx.textAlign = 'center'; rx.textBaseline = 'middle';
      rx.lineWidth = 5; rx.strokeStyle = '#141710'; rx.strokeText('?', 48, 42);
      rx.fillStyle = '#ffc233'; rx.fillText('?', 48, 42);
      R.cache[key] = rc;
      return rc;
    }
    var spr = G.SPRITES && G.SPRITES.portraits && G.SPRITES.portraits[coId];
    var c;
    if (spr) c = rasterToCanvas(spr, teamColors(faction || (G.COS[coId] && G.COS[coId].faction) || 'neutral'));
    else {
      c = mkCanvas(96, 96); var ctx = c.getContext('2d'), col = teamColors(faction || 'neutral');
      ctx.scale(3, 3);
      disc(ctx, 16, 12, 8, '#f0c090'); rect(ctx, 6, 22, 20, 10, col[1]); rect(ctx, 8, 3, 16, 5, '#503020');
      rect(ctx, 12, 12, 2, 2, '#202020'); rect(ctx, 18, 12, 2, 2, '#202020');
    }
    R.cache[key] = c;
    return c;
  };
  /** Porträt als DOM-Canvas; mit co2 als Fusion (zwei Köpfe, diagonal geteilt) */
  R.portraitCanvas = function (coId, faction, cssSize, co2) {
    var c = mkCanvas(96, 96), ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    var a = R.portrait(coId, faction);
    if (co2 && co2 !== coId) {
      var b = R.portrait(co2, faction);
      // links/oben der erste, rechts/unten der zweite Kommandant, leicht nach außen versetzt
      ctx.save(); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(96, 0); ctx.lineTo(0, 96); ctx.closePath(); ctx.clip();
      ctx.drawImage(a, -12, -4); ctx.restore();
      ctx.save(); ctx.beginPath(); ctx.moveTo(96, 0); ctx.lineTo(96, 96); ctx.lineTo(0, 96); ctx.closePath(); ctx.clip();
      ctx.drawImage(b, 12, 6); ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(96, 0); ctx.lineTo(0, 96); ctx.stroke();
      ctx.strokeStyle = 'rgba(30,24,36,0.6)'; ctx.lineWidth = 1; ctx.stroke();
    } else ctx.drawImage(a, 0, 0);
    c.className = 'portrait-img';
    if (cssSize) { c.style.width = cssSize + 'px'; c.style.height = cssSize + 'px'; }
    return c;
  };
  R.icon = function (name) {
    var key = 'i|' + name;
    if (R.cache[key]) return R.cache[key];
    var spr = G.SPRITES && G.SPRITES.icons && G.SPRITES.icons[name];
    var c = spr ? rasterToCanvas(spr, teamColors('neutral')) : null;
    R.cache[key] = c;
    return c;
  };

  // ------------------------------------------------------------ Gelände: Umgebung lesen
  function tAt(map, x, y) {
    if (x < 0 || y < 0 || x >= map.w || y >= map.h) return null;
    return map.terrain[y][x];
  }
  function isWaterish(t) { return t === 'S' || t === 'X'; }
  function connects(t, kind) {
    if (!t) return false;
    if (kind === 'road') return t === 'R' || t === 'B' || G.TERRAIN[t].prop;
    if (kind === 'river') return t === 'I' || t === 'S' || t === 'X' || t === 'H' || t === 'B';
    return false;
  }
  function waterLike(t) { return t === 'I' || t === 'S' || t === 'X' || t === 'H'; }
  /** Brücke "vertikal" = Weg läuft Nord-Süd, Wasser fließt Ost-West */
  function bridgeVertical(map, x, y) {
    var w = tAt(map, x - 1, y), e = tAt(map, x + 1, y), n = tAt(map, x, y - 1), s = tAt(map, x, y + 1);
    var wetWE = waterLike(w) || waterLike(e);
    var wetNS = waterLike(n) || waterLike(s);
    var roadWE = (w && !waterLike(w) && w !== 'B') || (e && !waterLike(e) && e !== 'B');
    var roadNS = (n && !waterLike(n) && n !== 'B') || (s && !waterLike(s) && s !== 'B');
    if (wetWE && !wetNS) return true;
    if (wetNS && !wetWE) return false;
    if (roadNS && !roadWE) return true;
    if (roadWE && !roadNS) return false;
    if (n === 'B' || s === 'B') return true;
    return false;
  }
  /** Küsten-Umgebung eines Wasserfelds: 0 = Wasser, 1 = Land, 2 = Strand (8 Nachbarn) */
  function seaCtx(map, x, y) {
    function k(dx, dy) {
      var t = tAt(map, x + dx, y + dy);
      if (t == null) return 0;
      if (t === 'S' || t === 'X' || t === 'B' || t === 'O' || t === 'I') return 0;
      return t === 'H' ? 2 : 1;
    }
    return { n: k(0, -1), e: k(1, 0), s: k(0, 1), w: k(-1, 0), ne: k(1, -1), nw: k(-1, -1), se: k(1, 1), sw: k(-1, 1) };
  }
  function seaKey(m) { return [m.n, m.e, m.s, m.w, m.ne, m.nw, m.se, m.sw].join(''); }
  function riverCtx(map, x, y) {
    var n = connects(tAt(map, x, y - 1), 'river'), s = connects(tAt(map, x, y + 1), 'river');
    var w = connects(tAt(map, x - 1, y), 'river'), e = connects(tAt(map, x + 1, y), 'river');
    var bt;
    bt = tAt(map, x, y - 1); if (bt === 'B' && bridgeVertical(map, x, y - 1)) n = false;
    bt = tAt(map, x, y + 1); if (bt === 'B' && bridgeVertical(map, x, y + 1)) s = false;
    bt = tAt(map, x - 1, y); if (bt === 'B' && !bridgeVertical(map, x - 1, y)) w = false;
    bt = tAt(map, x + 1, y); if (bt === 'B' && !bridgeVertical(map, x + 1, y)) e = false;
    return { n: n, s: s, w: w, e: e,
      nw: connects(tAt(map, x - 1, y - 1), 'river'), ne: connects(tAt(map, x + 1, y - 1), 'river'),
      sw: connects(tAt(map, x - 1, y + 1), 'river'), se: connects(tAt(map, x + 1, y + 1), 'river') };
  }
  function roadCtx(map, x, y) {
    return { n: connects(tAt(map, x, y - 1), 'road'), s: connects(tAt(map, x, y + 1), 'road'), w: connects(tAt(map, x - 1, y), 'road'), e: connects(tAt(map, x + 1, y), 'road') };
  }
  function dirKey(c) { return (c.n ? 1 : 0) + '' + (c.e ? 1 : 0) + (c.s ? 1 : 0) + (c.w ? 1 : 0); }
  function shoalCtx(map, x, y) {
    function k(dx, dy) { var t = tAt(map, x + dx, y + dy); if (t == null) return 0; if (t === 'S' || t === 'X' || t === 'O') return 0; return t === 'H' ? 2 : 1; }
    return { n: k(0, -1), e: k(1, 0), s: k(0, 1), w: k(-1, 0) };
  }

  // ------------------------------------------------------------ Gelände: Maler (16er-Koordinaten, Feld = 0..16)
  function paintGrass(ctx, v) {
    ctx.fillStyle = C.grass; ctx.fillRect(-0.5, -0.5, 17, 17);
    for (var i = 0; i < 3; i++) {
      var bx = 2 + hash(v, i, 1) * 12, by = 2 + hash(v, i, 2) * 12, br = 3.5 + hash(v, i, 3) * 4;
      var g = ctx.createRadialGradient(bx, by, 0, bx, by, br);
      var col = i === 1 ? C.grassL : C.grassX;
      g.addColorStop(0, rgba(col, i === 1 ? 0.5 : 0.7)); g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g; ctx.fillRect(bx - br, by - br, br * 2, br * 2);
    }
    ctx.strokeStyle = rgba(C.grassD, 0.85); ctx.lineWidth = 0.5; ctx.lineCap = 'round';
    for (var k = 0; k < 4; k++) {
      var tx = 1.5 + hash(v, k, 7) * 13, ty = 2.5 + hash(v, k, 8) * 12;
      ctx.beginPath();
      ctx.moveTo(tx, ty); ctx.lineTo(tx - 0.5, ty - 1.3);
      ctx.moveTo(tx + 0.35, ty); ctx.lineTo(tx + 0.7, ty - 1.5);
      ctx.moveTo(tx + 0.7, ty); ctx.lineTo(tx + 1.4, ty - 1.0);
      ctx.stroke();
    }
  }
  function rotated(ctx, quarter, fn) {
    ctx.save(); ctx.translate(8, 8); ctx.rotate(quarter * Math.PI / 2); ctx.translate(-8, -8); fn(); ctx.restore();
  }
  /** Küste an der Oberkante des (ggf. gedrehten) Feldes: kind 1 = Wiese, 2 = Strand; left/right = Nachbarseiten sind auch Land */
  function coastSide(ctx, kind, left, right, lc, rc) {
    var g = ctx.createLinearGradient(0, 0, 0, 5.2);
    g.addColorStop(0, rgba(C.shallow, 0.7)); g.addColorStop(1, rgba(C.shallow, 0));
    ctx.fillStyle = g; ctx.fillRect(-0.5, 0, 17, 5.2);
    // Strand mit abgerundeter Ecke (Nachbar diagonal ist Wasser): Streifen dort kürzen
    var x0 = left ? 1.5 : (kind === 2 && !lc ? 4.2 : -0.5), x1 = right ? 14.5 : (kind === 2 && !rc ? 11.8 : 16.5);
    ctx.strokeStyle = rgba(C.foam, 0.9); ctx.lineWidth = 0.8; ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.moveTo(x0, 1.5); ctx.lineTo(x1, 1.5); ctx.stroke();
    ctx.fillStyle = kind === 2 ? C.sand : C.grassD;
    ctx.fillRect(x0 - (left ? 2 : 0), -0.5, x1 - x0 + (left ? 2 : 0) + (right ? 2 : 0), kind === 2 ? 1.6 : 1.2);
  }
  /** Küstenecke (Land nur diagonal) an der linken oberen Ecke des gedrehten Feldes */
  function coastCorner(ctx, kind) {
    var g = ctx.createRadialGradient(0, 0, 0, 0, 0, 5.2);
    g.addColorStop(0, rgba(C.shallow, 0.7)); g.addColorStop(1, rgba(C.shallow, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 5.2, 0, Math.PI / 2); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = rgba(C.foam, 0.9); ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(0, 0, 1.6, 0, Math.PI / 2); ctx.stroke();
    ctx.fillStyle = kind === 2 ? C.sand : C.grassD; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, kind === 2 ? 1.4 : 1.0, 0, Math.PI / 2); ctx.closePath(); ctx.fill();
  }
  function paintCoast(ctx, m) {
    if (m.n) rotated(ctx, 0, function () { coastSide(ctx, m.n, !!m.w, !!m.e, !!m.nw, !!m.ne); });
    if (m.e) rotated(ctx, 1, function () { coastSide(ctx, m.e, !!m.n, !!m.s, !!m.ne, !!m.se); });
    if (m.s) rotated(ctx, 2, function () { coastSide(ctx, m.s, !!m.e, !!m.w, !!m.se, !!m.sw); });
    if (m.w) rotated(ctx, 3, function () { coastSide(ctx, m.w, !!m.s, !!m.n, !!m.sw, !!m.nw); });
    if (m.nw && !m.n && !m.w) rotated(ctx, 0, function () { coastCorner(ctx, m.nw); });
    if (m.ne && !m.n && !m.e) rotated(ctx, 1, function () { coastCorner(ctx, m.ne); });
    if (m.se && !m.s && !m.e) rotated(ctx, 2, function () { coastCorner(ctx, m.se); });
    if (m.sw && !m.s && !m.w) rotated(ctx, 3, function () { coastCorner(ctx, m.sw); });
  }
  function paintSea(ctx, v, m) {
    ctx.fillStyle = C.sea; ctx.fillRect(-0.5, -0.5, 17, 17);
    for (var b = 0; b < 2; b++) {
      var bx = 2 + hash(v, b, 20) * 12, by = 2 + hash(v, b, 21) * 12, br = 4 + hash(v, b, 22) * 4;
      var g = ctx.createRadialGradient(bx, by, 0, bx, by, br);
      var bc = b ? C.seaL : C.seaD;
      g.addColorStop(0, rgba(bc, 0.28)); g.addColorStop(1, rgba(bc, 0));
      ctx.fillStyle = g; ctx.fillRect(bx - br, by - br, br * 2, br * 2);
    }
    ctx.strokeStyle = rgba(C.seaL, 0.5); ctx.lineWidth = 0.7; ctx.lineCap = 'round';
    for (var i = 0; i < 3; i++) {
      var wx = 1 + hash(v, i, 11) * 9, wy = 2 + hash(v, i, 12) * 12;
      ctx.beginPath(); ctx.moveTo(wx, wy); ctx.quadraticCurveTo(wx + 1.5, wy - 1.1, wx + 3, wy); ctx.quadraticCurveTo(wx + 4.5, wy + 1.1, wx + 6, wy); ctx.stroke();
    }
    if (m) paintCoast(ctx, m);
  }
  function paintShoal(ctx, v, m) {
    var water = function (k) { return m[k] === 0; };
    var anyWater = water('n') || water('e') || water('s') || water('w');
    if (anyWater) paintSea(ctx, v, null);
    // Sandform: Außenecken zum Wasser hin abgerundet
    var r = 4.6, rNW = water('n') && water('w') ? r : 0, rNE = water('n') && water('e') ? r : 0, rSE = water('s') && water('e') ? r : 0, rSW = water('s') && water('w') ? r : 0;
    function sandPath() {
      ctx.beginPath();
      ctx.moveTo(-0.5 + rNW, -0.5); ctx.lineTo(16.5 - rNE, -0.5); if (rNE) ctx.quadraticCurveTo(16.5, -0.5, 16.5, -0.5 + rNE);
      ctx.lineTo(16.5, 16.5 - rSE); if (rSE) ctx.quadraticCurveTo(16.5, 16.5, 16.5 - rSE, 16.5);
      ctx.lineTo(-0.5 + rSW, 16.5); if (rSW) ctx.quadraticCurveTo(-0.5, 16.5, -0.5, 16.5 - rSW);
      ctx.lineTo(-0.5, -0.5 + rNW); if (rNW) ctx.quadraticCurveTo(-0.5, -0.5, -0.5 + rNW, -0.5);
      ctx.closePath();
    }
    if (anyWater) {
      // Untiefe und Gischt rund um den Sand
      ctx.save(); sandPath(); ctx.strokeStyle = rgba(C.shallow, 0.55); ctx.lineWidth = 7; ctx.stroke(); ctx.restore();
      ctx.save(); sandPath(); ctx.strokeStyle = rgba(C.foam, 0.9); ctx.lineWidth = 1.6; ctx.stroke(); ctx.restore();
    }
    sandPath(); ctx.fillStyle = C.sand; ctx.fill();
    ctx.save(); sandPath(); ctx.clip();
    for (var i = 0; i < 7; i++) circle(ctx, 1 + hash(v, i, 50) * 14, 1 + hash(v, i, 60) * 14, 0.35 + hash(v, i, 61) * 0.3, i % 2 ? rgba(C.sandD, 0.7) : rgba(C.sandL, 0.9));
    function wet() { var g = ctx.createLinearGradient(0, 0, 0, 3.6); g.addColorStop(0, rgba(C.sandD, 0.8)); g.addColorStop(1, rgba(C.sandD, 0)); ctx.fillStyle = g; ctx.fillRect(-0.5, -0.5, 17, 4); }
    function edge() { ctx.fillStyle = rgba(C.grassD, 0.55); ctx.fillRect(-0.5, -0.5, 17, 1.2); }
    [['n', 0], ['e', 1], ['s', 2], ['w', 3]].forEach(function (d) {
      if (m[d[0]] === 0) rotated(ctx, d[1], wet);
      else if (m[d[0]] === 1) rotated(ctx, d[1], edge);
    });
    ctx.restore();
  }
  function bandStrokes(ctx, c, w, col) {
    ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = 'butt';
    ctx.beginPath();
    if (c.n) { ctx.moveTo(8, 8); ctx.lineTo(8, -0.5); }
    if (c.s) { ctx.moveTo(8, 8); ctx.lineTo(8, 16.5); }
    if (c.w) { ctx.moveTo(8, 8); ctx.lineTo(-0.5, 8); }
    if (c.e) { ctx.moveTo(8, 8); ctx.lineTo(16.5, 8); }
    ctx.stroke();
    circle(ctx, 8, 8, w / 2, col);
  }
  function paintRoad(ctx, v, c0) {
    paintGrass(ctx, v);
    var c = Object.assign({}, c0);
    if (!c.n && !c.s && !c.w && !c.e) { c.w = c.e = true; }
    bandStrokes(ctx, c, 9.6, C.roadD);
    bandStrokes(ctx, c, 7.8, C.road);
    var straightNS = c.n && c.s && !c.w && !c.e, straightWE = c.w && c.e && !c.n && !c.s;
    if (straightNS || straightWE) {
      ctx.setLineDash([2.4, 2.4]); ctx.lineDashOffset = 1.2;
      ctx.strokeStyle = rgba(C.roadL, 0.95); ctx.lineWidth = 0.6; ctx.beginPath();
      if (straightNS) { ctx.moveTo(8, -0.5); ctx.lineTo(8, 16.5); } else { ctx.moveTo(-0.5, 8); ctx.lineTo(16.5, 8); }
      ctx.stroke(); ctx.setLineDash([]);
    }
    // leichte Abnutzung
    ctx.fillStyle = rgba(C.roadD, 0.25);
    for (var i = 0; i < 3; i++) { var px = 2 + hash(v, i, 30) * 12, py = 2 + hash(v, i, 31) * 12; ellipse(ctx, px, py, 1.2, 0.5, rgba(C.roadD, 0.22)); }
  }
  function paintRiver(ctx, v, c0) {
    paintGrass(ctx, v);
    var c = Object.assign({}, c0);
    if (!c.n && !c.s && !c.w && !c.e) { c.w = c.e = true; }
    bandStrokes(ctx, c, 11.2, C.riverD);
    bandStrokes(ctx, c, 9.4, C.river);
    [[c.n && c.w && c.nw, 0, 0], [c.n && c.e && c.ne, 8, 0], [c.s && c.w && c.sw, 0, 8], [c.s && c.e && c.se, 8, 8]].forEach(function (q) {
      if (q[0]) { ctx.fillStyle = C.river; ctx.fillRect(q[1] - 0.5, q[2] - 0.5, 9, 9); }
    });
    // Strömungs-Glanz
    ctx.strokeStyle = rgba(C.riverL, 0.55); ctx.lineWidth = 0.7; ctx.lineCap = 'round';
    for (var i = 0; i < 2; i++) {
      var sx = 4 + hash(v, i, 40) * 8, sy = 4 + hash(v, i, 41) * 8;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo(sx + 1.2, sy - 0.8, sx + 2.4, sy); ctx.quadraticCurveTo(sx + 3.6, sy + 0.8, sx + 4.8, sy); ctx.stroke();
    }
  }
  function paintReef(ctx, v) {
    for (var i = 0; i < 3; i++) {
      var rx = 3 + hash(v, i, 90) * 10, ry = 3 + hash(v, i, 91) * 10, r = 1.5 + hash(v, i, 92) * 1.2;
      ellipse(ctx, rx, ry + 0.5, r * 1.35, r * 0.8, 'rgba(255,255,255,0.38)');
      ellipse(ctx, rx, ry, r, r * 0.72, C.reefD);
      ellipse(ctx, rx - r * 0.22, ry - r * 0.22, r * 0.62, r * 0.42, C.reef);
      circle(ctx, rx - r * 0.42, ry - r * 0.4, r * 0.2, C.reefL);
    }
  }
  function paintBridge(ctx, v, info) {
    if (info.onSea) paintSea(ctx, v, info.sea);
    else {
      paintGrass(ctx, v);
      var c = info.vertical ? { w: true, e: true } : { n: true, s: true };
      bandStrokes(ctx, c, 11.2, C.riverD); bandStrokes(ctx, c, 9.4, C.river);
    }
    rotated(ctx, info.vertical ? 1 : 0, function () {
      // Weg läuft nach der Drehung West–Ost
      ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(-0.5, 12.4, 17, 1.2);
      ctx.fillStyle = C.plankD; ctx.fillRect(-0.5, 2.6, 17, 10.8);
      ctx.fillStyle = C.plank; ctx.fillRect(-0.5, 3.2, 17, 9.6);
      ctx.strokeStyle = rgba(C.plankD, 0.75); ctx.lineWidth = 0.45; ctx.beginPath();
      for (var i = 0; i < 16; i += 2.3) { ctx.moveTo(i + 0.4, 3.2); ctx.lineTo(i + 0.4, 12.8); }
      ctx.stroke();
      ctx.fillStyle = rgba(C.plankL, 0.6); ctx.fillRect(-0.5, 3.4, 17, 0.6);
      ctx.fillStyle = C.outline; ctx.fillRect(-0.5, 2.3, 17, 0.7); ctx.fillRect(-0.5, 12.8, 17, 0.7);
      ctx.fillStyle = C.plankL;
      for (var j = 1; j < 16; j += 3.6) { ctx.fillRect(j, 1.6, 0.9, 1.4); ctx.fillRect(j, 12.9, 0.9, 1.4); }
    });
  }
  function paintMountain(ctx, v) {
    var px = 8.3 + (hash(v, 1, 70) - 0.5) * 1.6;
    ellipse(ctx, 8.5, 14.7, 7, 1.3, 'rgba(0,0,0,0.16)');
    // Nebengipfel hinten links
    poly(ctx, [[0.4, 14.4], [4.3, 6.4], [8.6, 14.4]], shade(C.rockL, 0.86));
    poly(ctx, [[4.3, 6.4], [8.6, 14.4], [4.3, 14.4]], shade(C.rock, 0.92));
    poly(ctx, [[4.3, 6.4], [3.1, 8.8], [3.8, 8.5], [4.4, 9.1], [5.1, 8.5], [5.5, 8.9]], shade(C.snow, 0.94));
    // Hauptgipfel
    poly(ctx, [[1.4, 14.7], [px, 1.6], [15.6, 14.7]], C.rockL);
    poly(ctx, [[px, 1.6], [15.6, 14.7], [px + 0.6, 14.7]], C.rockD);
    poly(ctx, [[px, 1.6], [px + 0.6, 14.7], [px - 1.9, 14.7]], C.rock);
    // Felsrisse
    ctx.strokeStyle = rgba(C.rockD, 0.4); ctx.lineWidth = 0.4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(px - 1.2, 7); ctx.lineTo(px - 3.4, 11.5); ctx.moveTo(px + 2.4, 8.5); ctx.lineTo(px + 4.6, 12.5); ctx.moveTo(px - 0.3, 9); ctx.lineTo(px - 1.6, 13.2); ctx.stroke();
    // Schneekappe
    poly(ctx, [[px, 1.6], [px - 2.7, 6.5], [px - 1.7, 6.0], [px - 0.8, 7.0], [px + 0.1, 6.1], [px + 1.0, 6.9], [px + 1.9, 6.1], [px + 2.8, 6.6]], C.snow);
    poly(ctx, [[px, 1.6], [px + 2.8, 6.6], [px + 1.9, 6.1], [px + 1.0, 6.9], [px + 0.1, 6.1], [px + 0.2, 1.9]], shade(C.snow, 0.86));
    ctx.strokeStyle = rgba(C.outline, 0.5); ctx.lineWidth = 0.45; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(1.4, 14.7); ctx.lineTo(px, 1.6); ctx.lineTo(15.6, 14.7); ctx.stroke();
    ctx.fillStyle = rgba(C.grassD, 0.55); ctx.fillRect(0.8, 14.6, 15.4, 1.0);
  }
  function paintForest(ctx, v) {
    var base = [[3.4, 5.4], [11.4, 4.8], [7.4, 9.2], [13.0, 11.0], [3.6, 12.0], [8.8, 12.6]];
    var trees = [];
    base.forEach(function (t, i) {
      if (i >= 4 && hash(v, i, 83) < 0.35) return;
      var x = t[0] + (hash(v, i, 80) - 0.5) * 2.2, y = t[1] + (hash(v, i, 81) - 0.5) * 1.8;
      if (v % 2) x = 16 - x;           // jede zweite Variante gespiegelt: weniger Reihenmuster
      if (v >= 3) y = 16.6 - y;
      trees.push({ x: x, y: Math.max(3.4, Math.min(12.4, y)), r: 2.5 + hash(v, i, 82) * 1.0 });
    });
    trees.sort(function (a, b) { return a.y - b.y; });
    trees.forEach(function (t) {
      ellipse(ctx, t.x + 0.7, t.y + t.r * 0.95, t.r * 0.95, t.r * 0.36, 'rgba(0,0,0,0.2)');
      ctx.fillStyle = C.trunk; ctx.fillRect(t.x - 0.5, t.y + 0.5, 1.0, t.r * 0.85);
      circle(ctx, t.x, t.y, t.r, C.treeD);
      circle(ctx, t.x - t.r * 0.12, t.y - t.r * 0.2, t.r * 0.78, C.tree);
      circle(ctx, t.x - t.r * 0.36, t.y - t.r * 0.44, t.r * 0.34, rgba(C.treeL, 0.9));
    });
  }

  // ------------------------------------------------------------ Gebäude (vektorgezeichnet, Teamfarben)
  // Leichte 2.5D-Schrägansicht: Die Frontfassade zeigt zum Betrachter, die Tiefe läuft nach rechts oben
  // (je Tiefeneinheit OX/OY). So sind Dach und rechte Seitenfläche sichtbar. Licht fällt von links oben:
  // Dach und Front hell, Seite dunkel, Schlagschatten nach rechts. Alle Maße in 16er-Feldkoordinaten;
  // Linien nie dünner als 0.4, damit bei D = 2 (32 px) nichts zu Matsch wird.
  var OX = 0.45, OY = -0.6, SHX = 0.42, SHY = -0.1;
  var INK = '#2a2434', STONE = '#efe9dc', STEEL = '#8d929b';

  function mix(a, b, t) {
    var p = hexToRgb(a), q = hexToRgb(b);
    return rgbToHex(Math.round(p[0] + (q[0] - p[0]) * t), Math.round(p[1] + (q[1] - p[1]) * t), Math.round(p[2] + (q[2] - p[2]) * t));
  }
  function lp(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }
  function isNeutral(cols) { return cols === teamColors('neutral'); }
  function snowy() { return R.theme === 'winter'; }
  var SNOW = 'rgba(250,252,255,0.92)';
  /** Punkt auf einem Baukörper b: u = Abstand von der linken Frontkante, s = Tiefe nach hinten, z = Höhe */
  function pt(b, u, s, z) { return [b.x + u + s * OX, b.y - z + s * OY]; }
  /** Quader: (x, y) = vordere linke Bodenecke, w = Breite, h = Höhe, d = Tiefe */
  function cube(x, y, w, h, d) {
    var b = { x: x, y: y, w: w, h: h, d: d };
    b.front = [pt(b, 0, 0, 0), pt(b, w, 0, 0), pt(b, w, 0, h), pt(b, 0, 0, h)];
    b.side = [pt(b, w, 0, 0), pt(b, w, d, 0), pt(b, w, d, h), pt(b, w, 0, h)];
    b.top = [pt(b, 0, 0, h), pt(b, w, 0, h), pt(b, w, d, h), pt(b, 0, d, h)];
    b.hull = [pt(b, 0, 0, 0), pt(b, w, 0, 0), pt(b, w, d, 0), pt(b, w, d, h), pt(b, 0, d, h), pt(b, 0, 0, h)];
    b.foot = [pt(b, 0, 0, 0), pt(b, w, 0, 0), pt(b, w, d, 0), pt(b, 0, d, 0)];
    return b;
  }
  /** Fläche auf der Front (u0..u1, z0..z1) bzw. auf der rechten Seite (s0..s1, z0..z1) */
  function fRect(b, u0, u1, z0, z1) { return [pt(b, u0, 0, z0), pt(b, u1, 0, z0), pt(b, u1, 0, z1), pt(b, u0, 0, z1)]; }
  function sRect(b, s0, s1, z0, z1) { return [pt(b, b.w, s0, z0), pt(b, b.w, s1, z0), pt(b, b.w, s1, z1), pt(b, b.w, s0, z1)]; }
  function tRect(b, u0, u1, s0, s1) { return [pt(b, u0, s0, b.h), pt(b, u1, s0, b.h), pt(b, u1, s1, b.h), pt(b, u0, s1, b.h)]; }
  function vgrad(ctx, y0, y1, c0, c1) { var g = ctx.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, c0); g.addColorStop(1, c1); return g; }
  function hgrad(ctx, x0, x1, c0, c1) { var g = ctx.createLinearGradient(x0, 0, x1, 0); g.addColorStop(0, c0); g.addColorStop(1, c1); return g; }
  function pathOf(ctx, pts) { ctx.beginPath(); pts.forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }); ctx.closePath(); }
  /** Dunkle Kontur (Silhouette), damit Gebäude auf Gras und Schnee klar stehen */
  function ink(ctx, pts, a, lw) {
    pathOf(ctx, pts); ctx.strokeStyle = rgba(INK, a == null ? 0.78 : a); ctx.lineWidth = lw || 0.45; ctx.lineJoin = 'round'; ctx.stroke();
  }
  function seg(ctx, p, q, col, lw) {
    ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.strokeStyle = col; ctx.lineWidth = lw || 0.4; ctx.lineCap = 'round'; ctx.stroke();
  }
  /** Konvexe Hülle (monotone Kette) – für Schlagschatten */
  function convexHull(pts) {
    pts = pts.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    function cr(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
    var lo = [], up = [], i;
    for (i = 0; i < pts.length; i++) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], pts[i]) <= 0) lo.pop(); lo.push(pts[i]); }
    for (i = pts.length - 1; i >= 0; i--) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], pts[i]) <= 0) up.pop(); up.push(pts[i]); }
    lo.pop(); up.pop();
    return lo.concat(up);
  }
  /** Schlagschatten eines Körpers mit Grundriss foot und Höhe h (auf das Feld beschnitten) */
  function castShadow(ctx, foot, h, a) {
    var pts = foot.slice();
    foot.forEach(function (p) { pts.push([p[0] + h * SHX, p[1] + h * SHY]); });
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, 16, 16); ctx.clip();
    poly(ctx, convexHull(pts), 'rgba(16,20,36,' + (a || 0.26) + ')');
    ctx.restore();
  }
  function cubeShadow(ctx, b, a, extraH) {
    castShadow(ctx, b.foot, b.h + (extraH || 0), a);
    // Kontaktschatten an der Fassadenunterkante
    var g = vgrad(ctx, b.y - 0.1, b.y + 0.7, 'rgba(16,20,36,0.3)', 'rgba(16,20,36,0)');
    ctx.fillStyle = g; ctx.fillRect(b.x - 0.2, b.y - 0.1, b.w + 0.4, 0.8);
  }
  /** Quader malen: Front mit leichtem Verlauf, Seite dunkler, Dach optional */
  function paintCube(ctx, b, front, side, top) {
    poly(ctx, b.side, vgrad(ctx, b.y - b.h + b.d * OY, b.y, side, shade(side, 0.82)));
    poly(ctx, b.front, vgrad(ctx, b.y - b.h, b.y, shade(front, 1.04), shade(front, 0.86)));
    if (top) poly(ctx, b.top, top);
  }
  /** Fensterscheibe auf der Front: dunkle Laibung, Glas mit Himmelsreflex oder warm beleuchtet */
  function pane(ctx, x, y, w, h, lit) {
    ctx.fillStyle = rgba(INK, 0.6); ctx.fillRect(x - 0.18, y - 0.18, w + 0.36, h + 0.3);
    var g = ctx.createLinearGradient(x, y, x + w * 0.6, y + h);
    if (lit) { g.addColorStop(0, '#fff6cf'); g.addColorStop(1, '#f0b23c'); }
    else { g.addColorStop(0, mix(C.glass, '#ffffff', 0.45)); g.addColorStop(0.5, C.glass); g.addColorStop(1, C.glassD); }
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  }
  /** Fenster auf der Seitenfläche (Parallelogramm, im Schatten) */
  function sidePane(ctx, b, s, z, ws, h, lit) {
    var q = sRect(b, s, s + ws, z, z + h);
    poly(ctx, q, rgba(INK, 0.55));
    var r = sRect(b, s + 0.12, s + ws - 0.12, z + 0.1, z + h - 0.1);
    poly(ctx, r, lit ? '#e8a838' : shade(C.glassD, 0.75));
    poly(ctx, [r[3], r[2], lp(r[1], r[2], 0.6), lp(r[0], r[3], 0.6)], lit ? 'rgba(255,236,170,0.75)' : rgba(C.glass, 0.45));
  }
  function isLit(i, j, seed, rate) { return hash(i + 17, j + 5, seed) < rate; }
  /** Gepflasterter Platz mit sichtbarer Bordsteinkante vorn */
  function yard(ctx, x0, y0, x1, y1, top) {
    top = top || C.plaza;
    var w = x1 - x0, h = y1 - y0;
    fillRR(ctx, x0 + 0.3, y0 + 0.7, w, h, 1.3, 'rgba(16,20,36,0.2)');
    fillRR(ctx, x0, y0 + 0.55, w, h, 1.3, shade(top, 0.7));
    fillRR(ctx, x0, y0, w, h, 1.3, vgrad(ctx, y0, y1, shade(top, 1.03), shade(top, 0.95)));
    ctx.save(); rr(ctx, x0, y0, w, h, 1.3); ctx.clip();
    ctx.strokeStyle = rgba(C.plazaD, 0.3); ctx.lineWidth = 0.4; ctx.beginPath();
    for (var gy = y0 + 1.7, row = 0; gy < y1; gy += 1.7, row++) {
      ctx.moveTo(x0, gy); ctx.lineTo(x1, gy);
      for (var gx = x0 + 1.1 + (row % 2) * 1.0; gx < x1; gx += 2.0) { ctx.moveTo(gx, gy); ctx.lineTo(gx, gy + 1.7); }
    }
    ctx.stroke();
    ctx.restore();
    strokeRR(ctx, x0 + 0.35, y0 + 0.35, w - 0.7, h - 0.7, 1.0, 'rgba(255,255,255,0.28)', 0.4);
    rr(ctx, x0, y0, w, h + 0.55, 1.3); ctx.strokeStyle = rgba(INK, 0.4); ctx.lineWidth = 0.4; ctx.stroke();
  }
  /** Satteldach mit First parallel zur Front; rh = Firsthöhe, ov = Dachüberstand */
  function gableRoof(ctx, b, rh, cols, side, ov) {
    var h = b.h, d = b.d, w = b.w;
    ov = ov == null ? 0.35 : ov;
    var e0 = pt(b, -ov, -ov, h - 0.15), e1 = pt(b, w + ov, -ov, h - 0.15);
    var r0 = pt(b, -ov, d / 2, h + rh), r1 = pt(b, w + ov, d / 2, h + rh);
    var k0 = pt(b, -ov, d + ov, h - 0.15), k1 = pt(b, w + ov, d + ov, h - 0.15);
    // hintere Dachfläche: nur als dunkle Ortgangkante rechts sichtbar
    poly(ctx, [r0, r1, k1, k0], cols[2]);
    // Giebeldreieck auf der Seite (Wandfarbe)
    poly(ctx, [pt(b, w, 0, h), pt(b, w, d, h), pt(b, w, d / 2, h + rh)], shade(side, 0.94));
    // Schatten des Dachüberstands auf der Fassade
    poly(ctx, fRect(b, 0, w, h - 0.75, h), 'rgba(16,20,36,0.22)');
    poly(ctx, sRect(b, 0, d, h - 0.75, h), 'rgba(16,20,36,0.18)');
    // vordere Dachfläche mit Ziegelreihen
    poly(ctx, [e0, e1, r1, r0], vgrad(ctx, r0[1], e0[1], mix(cols[1], cols[0], 0.5), shade(cols[1], 0.88)));
    for (var i = 1; i <= 3; i++) seg(ctx, lp(e0, r0, i / 4), lp(e1, r1, i / 4), rgba(cols[2], 0.5), 0.4);
    if (snowy()) poly(ctx, [lp(e0, r0, 0.58), lp(e1, r1, 0.58), r1, r0], SNOW);
    // Traufkante und First
    seg(ctx, e0, e1, cols[2], 0.5);
    seg(ctx, r0, r1, mix(cols[0], '#ffffff', 0.3), 0.45);
    ink(ctx, [e0, e1, r1, r0], 0.78);
    ink(ctx, [r1, k1, pt(b, w, d, h), pt(b, w, d / 2, h + rh)], 0.6);
    return { r0: r0, r1: r1 };
  }
  /** Markise vor der Front (u0..u1) auf Höhe z, p Einheiten vorstehend, gestreift in Teamfarbe */
  function awning(ctx, b, u0, u1, z, p, cols) {
    var drop = 0.75, vh = 0.5;
    var a0 = pt(b, u0, 0, z), a1 = pt(b, u1, 0, z), f0 = pt(b, u0, -p, z - drop), f1 = pt(b, u1, -p, z - drop);
    poly(ctx, fRect(b, u0, u1, z - drop - 0.9, z), 'rgba(16,20,36,0.22)');
    var n = Math.max(3, Math.round((u1 - u0) / 0.85)), light = mix('#f7f2e8', cols[0], 0.15), i;
    for (i = 0; i < n; i++) poly(ctx, [lp(a0, a1, i / n), lp(a0, a1, (i + 1) / n + 0.01), lp(f0, f1, (i + 1) / n + 0.01), lp(f0, f1, i / n)], i % 2 ? light : cols[1]);
    for (i = 0; i < n; i++) {
      var p0 = lp(f0, f1, i / n), p1 = lp(f0, f1, (i + 1) / n);
      ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.lineTo(p1[0], p1[1] + vh * 0.55);
      ctx.quadraticCurveTo((p0[0] + p1[0]) / 2, p1[1] + vh * 1.5, p0[0], p0[1] + vh * 0.55); ctx.closePath();
      ctx.fillStyle = i % 2 ? shade(light, 0.86) : cols[2]; ctx.fill();
    }
    ink(ctx, [a0, a1, f1, f0], 0.6, 0.4);
  }
  /** Fahne am Mast: Fuß bei (x, y), Mast der Länge len, Tuch weht nach rechts */
  function flag(ctx, x, y, len, cols, fw, fh) {
    fw = fw || 3.0; fh = fh || 1.8;
    var top = y - len;
    ctx.fillStyle = INK; ctx.fillRect(x - 0.24, top, 0.48, len);
    ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.fillRect(x - 0.18, top + 0.2, 0.16, len - 0.3);
    var fx = x + 0.2, fy = top + 0.3;
    function cloth() {
      ctx.beginPath(); ctx.moveTo(fx, fy);
      ctx.bezierCurveTo(fx + fw * 0.35, fy - 0.5, fx + fw * 0.65, fy + 0.45, fx + fw, fy - 0.05);
      ctx.lineTo(fx + fw - 0.1, fy + fh - 0.05);
      ctx.bezierCurveTo(fx + fw * 0.65, fy + fh + 0.45, fx + fw * 0.35, fy + fh - 0.5, fx, fy + fh);
      ctx.closePath();
    }
    cloth();
    var g = ctx.createLinearGradient(fx, 0, fx + fw, 0);
    g.addColorStop(0, cols[1]); g.addColorStop(0.3, mix(cols[1], cols[0], 0.55)); g.addColorStop(0.62, shade(cols[1], 0.82)); g.addColorStop(1, mix(cols[1], cols[0], 0.3));
    ctx.fillStyle = g; ctx.fill();
    ctx.save(); cloth(); ctx.clip();
    ctx.fillStyle = rgba(cols[2], 0.75); ctx.fillRect(fx, fy + fh * 0.62, fw, fh);
    ctx.restore();
    circle(ctx, fx + fw * 0.42, fy + fh * 0.36, Math.min(0.42, fh * 0.2), 'rgba(255,255,255,0.9)');
    cloth(); ctx.strokeStyle = rgba(INK, 0.75); ctx.lineWidth = 0.4; ctx.lineJoin = 'round'; ctx.stroke();
    circle(ctx, x, top, 0.36, '#f2dc8a');
  }
  /** Kleiner Straßenbaum (Farben folgen der Landschaft) */
  function smallTree(ctx, x, y, r) {
    ellipse(ctx, x + r * 0.7, y + 0.1, r * 1.1, r * 0.4, 'rgba(16,20,36,0.26)');
    ctx.fillStyle = C.trunk; ctx.fillRect(x - 0.3, y - r * 1.1, 0.6, r * 1.1 + 0.1);
    var cy = y - r * 1.45;
    circle(ctx, x, cy, r + 0.22, rgba(INK, 0.55));
    circle(ctx, x, cy, r, C.treeD);
    circle(ctx, x - r * 0.12, cy - r * 0.18, r * 0.8, C.tree);
    circle(ctx, x - r * 0.38, cy - r * 0.42, r * 0.34, rgba(C.treeL, 0.9));
  }
  /** Straßenlaterne */
  function streetLamp(ctx, x, y, hgt) {
    ellipse(ctx, x + 0.5, y + 0.05, 0.8, 0.28, 'rgba(16,20,36,0.25)');
    ctx.fillStyle = INK; ctx.fillRect(x - 0.22, y - hgt, 0.44, hgt); ctx.fillRect(x - 0.4, y - 0.5, 0.8, 0.5);
    ctx.fillRect(x - 0.22, y - hgt, 1.1, 0.42);
    fillRR(ctx, x + 0.45, y - hgt + 0.25, 0.9, 0.5, 0.2, INK);
    ellipse(ctx, x + 0.9, y - hgt + 0.75, 0.42, 0.2, '#fff1b0');
  }
  /** Kleiner Kasten auf dem Dach (Klimagerät, Aufzugshaus) */
  function roofBox(ctx, b, u, s, w, h, d, col) {
    var p = pt(b, u, s, b.h), k = cube(p[0], p[1], w, h, d);
    poly(ctx, [k.foot[1], [k.foot[1][0] + 0.5, k.foot[1][1]], [k.foot[2][0] + 0.5, k.foot[2][1]], k.foot[2]], 'rgba(16,20,36,0.25)');
    paintCube(ctx, k, col, shade(col, 0.7), mix(col, '#ffffff', 0.25));
    ink(ctx, k.hull, 0.6, 0.4);
    return k;
  }
  /** Antenne mit Warnlicht */
  function antenna(ctx, x, y, len) {
    ctx.fillStyle = INK; ctx.fillRect(x - 0.38, y - 0.4, 0.76, 0.45);
    seg(ctx, [x, y], [x, y - len], INK, 0.42);
    circle(ctx, x, y - len, 0.34, '#ff4a3a'); circle(ctx, x - 0.1, y - len - 0.1, 0.12, '#ffd0c8');
  }

  // --- Stadt: Häuserblock aus Bürohochhaus, Wohnhaus mit Satteldach und Ladenzeile
  var FACADES = ['#f2e6cf', '#f1d9c2', '#e2e6ea', '#efe0c8', '#e8dccd', '#dfe3e0'];
  function cityTower(ctx, b, cols, v) {
    var wall = v % 2 ? '#d7dbe1' : '#e3ddd3', side = shade(wall, 0.68);
    paintCube(ctx, b, wall, side, null);
    // Fensterbänder je Geschoss (vorn 4 Scheiben, seitlich eine lange)
    var fl = 1.2, n = Math.floor((b.h - 1.4) / fl), segs = 4, sw = (b.w - 0.9) / segs;
    for (var i = 0; i < n; i++) {
      var z = 0.7 + i * fl;
      for (var j = 0; j < segs; j++) pane(ctx, b.x + 0.45 + j * sw + 0.12, b.y - z - 0.72, sw - 0.24, 0.72, isLit(j, i, 40 + v, 0.17));
      sidePane(ctx, b, 0.35, z, b.d - 0.7, 0.72, isLit(9, i, 50 + v, 0.2));
    }
    // Kopfband in Teamfarbe
    var cz = b.h - 0.85;
    poly(ctx, fRect(b, 0, b.w, cz, b.h), vgrad(ctx, b.y - b.h, b.y - cz, mix(cols[1], cols[0], 0.25), cols[1]));
    poly(ctx, sRect(b, 0, b.d, cz, b.h), cols[2]);
    // Flachdach mit Attika
    poly(ctx, b.top, mix(cols[0], '#ffffff', 0.25));
    poly(ctx, tRect(b, 0.4, b.w - 0.4, 0.4, b.d - 0.4), snowy() ? '#f2f5f9' : '#8f9299');
    poly(ctx, tRect(b, 0.4, b.w - 0.4, 0.4, 0.75), snowy() ? '#c9d2de' : '#74777e');
    ink(ctx, b.hull, 0.8);
    seg(ctx, pt(b, 0, 0, b.h), pt(b, b.w, 0, b.h), 'rgba(255,255,255,0.55)', 0.4);
    var k = roofBox(ctx, b, 0.7, 1.0, 1.4, 0.7, 1.1, '#c5c8ce');
    ellipse(ctx, k.top[0][0] + 0.95, k.top[0][1] - 0.32, 0.42, 0.22, '#4c4f57');
    var a = pt(b, b.w - 0.9, b.d - 0.8, b.h);
    antenna(ctx, a[0], a[1], 1.5);
  }
  function cityHouse(ctx, b, cols, v, wall) {
    var side = shade(wall, 0.7);
    paintCube(ctx, b, wall, side, null);
    poly(ctx, fRect(b, 0, b.w, 0, 0.45), shade(wall, 0.78));
    poly(ctx, sRect(b, 0, b.d, 0, 0.45), shade(side, 0.8));
    // Gesims zwischen den Geschossen
    poly(ctx, fRect(b, 0, b.w, 2.45, 2.8), mix(wall, '#ffffff', 0.5));
    poly(ctx, fRect(b, 0, b.w, 2.3, 2.45), 'rgba(16,20,36,0.18)');
    poly(ctx, sRect(b, 0, b.d, 2.45, 2.8), shade(side, 1.08));
    // Erdgeschoss: Tür und zwei Fenster, Obergeschoss: drei Fenster
    pane(ctx, b.x + 0.6, b.y - 2.0, 0.95, 1.2, isLit(0, 0, 60 + v, 0.3));
    pane(ctx, b.x + 2.15, b.y - 2.0, 0.95, 1.2, isLit(1, 0, 60 + v, 0.3));
    ctx.fillStyle = rgba(INK, 0.6); ctx.fillRect(b.x + 3.75, b.y - 2.3, 1.3, 2.3);
    ctx.fillStyle = vgrad(ctx, b.y - 2.1, b.y, '#8a5a36', '#5c3a22'); ctx.fillRect(b.x + 3.92, b.y - 2.12, 0.96, 2.12);
    ctx.fillStyle = rgba(C.glass, 0.8); ctx.fillRect(b.x + 4.1, b.y - 1.95, 0.6, 0.5);
    for (var j = 0; j < 3; j++) pane(ctx, b.x + 0.6 + j * 1.68, b.y - 4.25, 0.95, 1.25, isLit(j, 1, 60 + v, 0.22));
    sidePane(ctx, b, 0.6, 3.0, 1.2, 1.2, isLit(5, 1, 61 + v, 0.3));
    sidePane(ctx, b, 0.6, 0.8, 1.2, 1.2, false);
    ink(ctx, b.hull, 0.8);
    return gableRoof(ctx, b, 1.9, cols, side, 0.35);
  }
  function cityShop(ctx, b, cols, v) {
    var wall = '#ebe6dc', side = shade(wall, 0.68);
    paintCube(ctx, b, wall, side, '#a6a5a2');
    poly(ctx, tRect(b, 0.3, b.w - 0.3, 0.3, b.d - 0.3), snowy() ? '#f2f5f9' : '#8e8d8b');
    // Schaufenster und Ladentür
    pane(ctx, b.x + 0.5, b.y - 1.75, 2.7, 1.4, isLit(2, 2, 70 + v, 0.45));
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(b.x + 0.7, b.y - 1.6, 0.4, 1.1);
    ctx.fillStyle = rgba(INK, 0.6); ctx.fillRect(b.x + 3.6, b.y - 2.0, 1.2, 2.0);
    ctx.fillStyle = vgrad(ctx, b.y - 1.85, b.y, mix(C.glass, '#ffffff', 0.3), C.glassD); ctx.fillRect(b.x + 3.76, b.y - 1.85, 0.88, 1.85);
    sidePane(ctx, b, 0.5, 0.6, 1.3, 1.1, false);
    ink(ctx, b.hull, 0.8);
    seg(ctx, pt(b, 0, 0, b.h), pt(b, b.w, 0, b.h), 'rgba(255,255,255,0.5)', 0.4);
    // Werbeschild auf dem Dach in Teamfarbe
    var s0 = pt(b, 0.8, 0.5, b.h), s1 = pt(b, b.w - 1.0, 0.5, b.h);
    seg(ctx, [s0[0] + 0.5, s0[1]], [s0[0] + 0.5, s0[1] - 0.5], INK, 0.4); seg(ctx, [s1[0] - 0.5, s1[1]], [s1[0] - 0.5, s1[1] - 0.5], INK, 0.4);
    var sg = [[s0[0], s0[1] - 0.45], [s1[0], s1[1] - 0.45], [s1[0], s1[1] - 1.55], [s0[0], s0[1] - 1.55]];
    poly(ctx, sg, vgrad(ctx, sg[2][1], sg[0][1], mix(cols[1], cols[0], 0.3), cols[1]));
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.fillRect(s0[0] + 0.5, s0[1] - 1.2, 0.8, 0.45); ctx.fillRect(s0[0] + 1.6, s0[1] - 1.2, 1.2, 0.45);
    ink(ctx, sg, 0.75, 0.4);
    awning(ctx, b, 0.25, b.w - 0.25, 2.3, 0.9, cols);
  }
  function bCity(ctx, cols, v) {
    var neu = isNeutral(cols);
    yard(ctx, 0.7, 4.2, 15.3, 14.6);
    var T = cube(7.9, 10.8, 4.5, 7.4 - (v % 3 === 1 ? 0.9 : 0), 3.0);
    var H = cube(1.3, 12.4, 5.6, 4.9, 2.8);
    var S = cube(9.1, 14.5, 5.2, 2.8, 2.3);
    cubeShadow(ctx, T); cubeShadow(ctx, H, 0.26, 1.2); cubeShadow(ctx, S);
    cityTower(ctx, T, cols, v);
    var roof = cityHouse(ctx, H, cols, v, FACADES[v % FACADES.length]);
    cityShop(ctx, S, cols, v);
    streetLamp(ctx, 8.0, 14.5, 3.6);
    smallTree(ctx, 1.9, 14.7, 1.35);
    if (!neu) flag(ctx, roof.r0[0] + 0.75, roof.r0[1] + 0.2, 3.3, cols, 3.0, 1.7);
    else { var a = lp(roof.r0, roof.r1, 0.2); antenna(ctx, a[0], a[1], 1.6); }
  }

  // --- Fabrik: Halle mit Sheddach, Rolltor, Schornstein mit Rauch
  function chimney(ctx, x, top, w, bottom, cols) {
    ctx.fillStyle = hgrad(ctx, x, x + w, '#d8d0c6', '#857a70'); ctx.fillRect(x, top, w, bottom - top);
    ctx.fillStyle = hgrad(ctx, x, x + w, mix(cols[1], cols[0], 0.4), cols[2]);
    ctx.fillRect(x, top + 0.7, w, 0.65); ctx.fillRect(x, top + 1.75, w, 0.45);
    ctx.fillStyle = 'rgba(16,20,36,0.18)'; ctx.fillRect(x, top + 1.35, w, 0.25);
    ctx.strokeStyle = rgba(INK, 0.75); ctx.lineWidth = 0.42; ctx.strokeRect(x, top, w, bottom - top);
    ellipse(ctx, x + w / 2, top, w / 2 + 0.12, 0.34, '#6f665e');
    ellipse(ctx, x + w / 2, top, w / 2 - 0.16, 0.2, '#2c2830');
  }
  /** Stehender Tank mit Kuppel und Leiter (hinter der Halle) */
  function silo(ctx, x, top, w, bottom, cols) {
    ctx.fillStyle = hgrad(ctx, x, x + w, '#f1f2f4', '#9ea3ab'); ctx.fillRect(x, top, w, bottom - top);
    ctx.fillStyle = hgrad(ctx, x, x + w, mix(cols[1], cols[0], 0.3), cols[2]); ctx.fillRect(x, top + 0.9, w, 0.5);
    for (var y = top + 1.9; y < bottom; y += 0.9) seg(ctx, [x + 0.2, y], [x + w - 0.2, y], 'rgba(16,20,36,0.14)', 0.4);
    ctx.strokeStyle = rgba(INK, 0.75); ctx.lineWidth = 0.42; ctx.strokeRect(x, top, w, bottom - top);
    ctx.beginPath(); ctx.ellipse(x + w / 2, top, w / 2, 0.75, 0, Math.PI, 0); ctx.closePath();
    ctx.fillStyle = hgrad(ctx, x, x + w, '#ffffff', '#a9aeb6'); ctx.fill(); ctx.stroke();
    seg(ctx, [x + w - 0.45, top + 0.2], [x + w - 0.45, bottom], rgba(INK, 0.55), 0.4);
  }
  function smoke(ctx, x, y) {
    [[0, 0, 0.75, 0.9], [0.95, -0.55, 0.68, 0.8], [1.75, -0.9, 0.5, 0.6]].forEach(function (p) {
      circle(ctx, x + p[0] + 0.12, y + p[1] + 0.14, p[2], 'rgba(120,124,136,' + (p[3] * 0.55) + ')');
      circle(ctx, x + p[0], y + p[1], p[2], 'rgba(238,240,244,' + p[3] + ')');
    });
  }
  function factoryHall(ctx, b, cols, v) {
    var wall = '#ddd8cd', side = shade(wall, 0.66), n = 3, tw = b.w / n, th = 1.9, i;
    poly(ctx, b.side, vgrad(ctx, b.y - b.h + b.d * OY, b.y, side, shade(side, 0.82)));
    for (i = 1; i < 4; i++) seg(ctx, pt(b, b.w, b.d * i / 4, 0.1), pt(b, b.w, b.d * i / 4, b.h - 0.1), 'rgba(16,20,36,0.16)', 0.4);
    sidePane(ctx, b, 0.6, 1.4, 1.1, 0.9, false); sidePane(ctx, b, 2.3, 1.4, 1.1, 0.9, isLit(3, 3, 80 + v, 0.4));
    // Sheddach: Dachflächen in Teamfarbe, senkrechte Oberlichter zur Seite
    for (i = 0; i < n; i++) {
      var u0 = i * tw, u1 = u0 + tw;
      var A = pt(b, u0, 0, b.h), B = pt(b, u1, 0, b.h + th), Bb = pt(b, u1, b.d, b.h + th), Ab = pt(b, u0, b.d, b.h);
      poly(ctx, [A, B, Bb, Ab], vgrad(ctx, Bb[1], A[1], mix(cols[1], cols[0], 0.4), shade(cols[1], 0.85)));
      for (var k = 1; k < 3; k++) seg(ctx, lp(A, Ab, k / 3), lp(B, Bb, k / 3), rgba(cols[2], 0.45), 0.4);
      if (snowy()) poly(ctx, [lp(A, B, 0.6), B, Bb, lp(Ab, Bb, 0.6)], SNOW);
      var G0 = pt(b, u1, 0, b.h), G1 = pt(b, u1, b.d, b.h);
      poly(ctx, [B, Bb, G1, G0], vgrad(ctx, Bb[1], G0[1], mix(C.glass, '#ffffff', 0.3), C.glassD));
      for (k = 1; k < 4; k++) seg(ctx, lp(B, Bb, k / 4), lp(G0, G1, k / 4), rgba(INK, 0.4), 0.4);
      ink(ctx, [A, B, Bb, Ab], 0.7, 0.42);
    }
    // Front mit Zackengiebeln
    var front = [pt(b, 0, 0, 0)];
    for (i = 0; i < n; i++) { front.push(pt(b, i * tw, 0, b.h)); front.push(pt(b, (i + 1) * tw, 0, b.h + th)); }
    front.push(pt(b, b.w, 0, 0));
    poly(ctx, front, vgrad(ctx, b.y - b.h - th, b.y, shade(wall, 1.04), shade(wall, 0.84)));
    ctx.save(); pathOf(ctx, front); ctx.clip();
    for (var x = b.x + 0.8; x < b.x + b.w; x += 0.85) seg(ctx, [x, b.y - b.h - th], [x, b.y], 'rgba(16,20,36,0.08)', 0.4);
    ctx.restore();
    for (i = 0; i < n; i++) circle(ctx, b.x + i * tw + tw * 0.62, b.y - b.h - th * 0.4, 0.42, rgba(INK, 0.35));
    // Fensterband links, Rolltor in der Mitte, Personaltür
    for (i = 0; i < 3; i++) pane(ctx, b.x + 0.6 + i * 1.45, b.y - 2.45, 1.05, 0.9, isLit(i, 0, 81 + v, 0.3));
    var dx = b.x + 5.3, dw = 3.4, dh = 2.8;
    ctx.fillStyle = cols[2]; ctx.fillRect(dx - 0.35, b.y - dh - 0.4, dw + 0.7, dh + 0.4);
    ctx.fillStyle = mix(cols[1], cols[0], 0.2); ctx.fillRect(dx - 0.35, b.y - dh - 0.4, dw + 0.7, 0.3);
    ctx.fillStyle = vgrad(ctx, b.y - dh, b.y, '#a7adb6', '#6d737d'); ctx.fillRect(dx, b.y - dh, dw, dh);
    for (var yy = b.y - dh + 0.5; yy < b.y - 0.1; yy += 0.5) seg(ctx, [dx + 0.1, yy], [dx + dw - 0.1, yy], 'rgba(30,32,40,0.35)', 0.4);
    ctx.fillStyle = '#f2c43c'; ctx.fillRect(dx, b.y - 0.45, dw, 0.45);
    ctx.fillStyle = INK; for (var hx = dx + 0.2; hx < dx + dw - 0.3; hx += 0.9) { ctx.beginPath(); ctx.moveTo(hx, b.y); ctx.lineTo(hx + 0.45, b.y - 0.45); ctx.lineTo(hx + 0.85, b.y - 0.45); ctx.lineTo(hx + 0.4, b.y); ctx.closePath(); ctx.fill(); }
    ctx.fillStyle = rgba(INK, 0.6); ctx.fillRect(b.x + 9.05, b.y - 2.1, 1.0, 2.1);
    ctx.fillStyle = '#6d737d'; ctx.fillRect(b.x + 9.2, b.y - 1.95, 0.7, 1.95);
    ink(ctx, front.concat([pt(b, b.w, 0, 0)]), 0.8);
    ink(ctx, b.side, 0.75);
  }
  function crate(ctx, x, y, s) {
    var k = cube(x, y, s, s * 0.85, s * 0.8);
    paintCube(ctx, k, '#c69a5c', '#8e6a3a', '#dcb57a');
    seg(ctx, pt(k, 0.15, 0, 0.15), pt(k, s - 0.15, 0, k.h - 0.15), 'rgba(90,60,30,0.6)', 0.4);
    ink(ctx, k.hull, 0.7, 0.4);
  }
  function barrel(ctx, x, y, col) {
    ellipse(ctx, x + 0.75, y, 0.8, 0.28, 'rgba(16,20,36,0.25)');
    ctx.fillStyle = hgrad(ctx, x - 0.55, x + 0.55, mix(col, '#ffffff', 0.25), shade(col, 0.6)); ctx.fillRect(x - 0.55, y - 1.3, 1.1, 1.3);
    ctx.fillStyle = 'rgba(16,20,36,0.3)'; ctx.fillRect(x - 0.55, y - 0.95, 1.1, 0.18); ctx.fillRect(x - 0.55, y - 0.45, 1.1, 0.18);
    ellipse(ctx, x, y - 1.3, 0.55, 0.24, shade(col, 0.8));
    ctx.strokeStyle = rgba(INK, 0.7); ctx.lineWidth = 0.4; ctx.strokeRect(x - 0.55, y - 1.3, 1.1, 1.3);
  }
  function bFactory(ctx, cols, v) {
    yard(ctx, 0.7, 4.8, 15.3, 14.6, mix(C.plaza, '#9ea3ab', 0.35));
    var hall = cube(1.2, 13.5, 10.3, 3.9, 4.2);
    silo(ctx, 1.9, 4.6, 2.3, 10.0, cols);
    chimney(ctx, 12.55, 2.3, 1.5, 9.8, cols);
    smoke(ctx, 13.55, 1.55);
    cubeShadow(ctx, hall, 0.26, 1.2);
    factoryHall(ctx, hall, cols, v);
    crate(ctx, 12.2, 14.2, 1.2); crate(ctx, 13.5, 14.3, 1.1); crate(ctx, 12.5, 13.18, 1.0);
    barrel(ctx, 14.6, 12.6, cols[1]);
  }

  // --- Flughafen: Rundbogenhangar, Tower, Start- und Landebahn
  function runway(ctx, y0, y1) {
    fillRR(ctx, 0.2, y0 + 0.45, 15.6, y1 - y0, 0.8, '#3c3f46');
    fillRR(ctx, 0.2, y0, 15.6, y1 - y0, 0.8, vgrad(ctx, y0, y1, '#686b73', '#585b63'));
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(0.7, y0 + 0.45, 14.6, 0.4); ctx.fillRect(0.7, y1 - 0.85, 14.6, 0.4);
    var cy = (y0 + y1) / 2 - 0.22;
    for (var x = 4.2; x < 15.0; x += 2.7) ctx.fillRect(x, cy, 1.5, 0.45);
    for (var i = 0; i < 4; i++) ctx.fillRect(0.9, y0 + 1.15 + i * 0.62 + (i > 1 ? 0.5 : 0), 2.2, 0.38);
    ctx.fillStyle = 'rgba(16,20,36,0.12)'; ctx.fillRect(9.5, y0 + 1.4, 3.2, 0.6);
    rr(ctx, 0.2, y0, 15.6, y1 - y0 + 0.45, 0.8); ctx.strokeStyle = rgba(INK, 0.5); ctx.lineWidth = 0.4; ctx.stroke();
  }
  function hangar(ctx, x, y, w, hs, d, cols) {
    var r = w / 2, cx = x + r, ys = y - hs, ox = d * OX, oy = d * OY;
    var thH = Math.PI - Math.atan2(-oy, ox);           // ab diesem Winkel ist das Tonnendach sichtbar
    function P(a, f) { return [cx + r * Math.cos(a) + f * ox, ys - r * Math.sin(a) + f * oy]; }
    // Schlagschatten und rechte Seitenwand
    castShadow(ctx, [[x, y], [x + w, y], [x + w + ox, y + oy], [x + ox, y + oy]], hs + r * 0.8, 0.26);
    poly(ctx, [[x + w, y], [x + w + ox, y + oy], [x + w + ox, ys + oy], [x + w, ys]], vgrad(ctx, ys + oy, y, '#a2a6af', '#80858e'));
    // Tonnendach in Streifen, nach Lichteinfall schattiert
    var N = 18, lightC = mix(cols[1], cols[0], 0.55);
    for (var i = 0; i < N; i++) {
      var a0 = thH * (1 - i / N), a1 = thH * (1 - (i + 1) / N) - 0.02, am = (a0 + a1) / 2;
      var k = Math.max(0, -0.55 * Math.cos(am) + 0.83 * Math.sin(am));
      var col = k > 0.6 ? mix(cols[1], lightC, (k - 0.6) / 0.4) : mix(cols[2], cols[1], k / 0.6);
      poly(ctx, [P(a0, 0), P(a1, 0), P(a1, 1), P(a0, 1)], col);
    }
    ctx.lineWidth = 0.4; ctx.strokeStyle = rgba(cols[3] || cols[2], 0.45);
    for (var f = 0.25; f < 1; f += 0.25) { ctx.beginPath(); ctx.arc(cx + f * ox, ys + f * oy, r, -thH, 0); ctx.stroke(); }
    // Umriss des Daches
    ctx.strokeStyle = rgba(INK, 0.8); ctx.lineWidth = 0.45; ctx.beginPath();
    ctx.moveTo(P(thH, 0)[0], P(thH, 0)[1]); ctx.lineTo(P(thH, 1)[0], P(thH, 1)[1]);
    ctx.arc(cx + ox, ys + oy, r, -thH, 0); ctx.lineTo(x + w + ox, y + oy); ctx.lineTo(x + w, y); ctx.stroke();
    // Stirnwand mit Tor
    function front() { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, ys); ctx.arc(cx, ys, r, Math.PI, 0); ctx.lineTo(x + w, y); ctx.closePath(); }
    front(); ctx.fillStyle = vgrad(ctx, ys - r, y, '#f4f5f7', '#c4c8cf'); ctx.fill();
    ctx.save(); front(); ctx.clip();
    ctx.strokeStyle = mix(cols[1], cols[0], 0.2); ctx.lineWidth = 0.7; ctx.beginPath(); ctx.arc(cx, ys, r - 0.35, Math.PI, 0); ctx.stroke();
    ctx.restore();
    var dh = hs + r * 0.42, dx0 = x + 0.8, dw = w - 1.6;
    ctx.fillStyle = rgba(INK, 0.65); ctx.fillRect(dx0 - 0.2, y - dh - 0.2, dw + 0.4, dh + 0.2);
    ctx.fillStyle = vgrad(ctx, y - dh, y, '#b9c0c9', '#8a919b'); ctx.fillRect(dx0, y - dh, dw * 0.68, dh);
    ctx.fillStyle = vgrad(ctx, y - dh, y, '#2a2b33', '#3f414a'); ctx.fillRect(dx0 + dw * 0.68, y - dh, dw * 0.32, dh);
    for (i = 1; i < 4; i++) seg(ctx, [dx0 + dw * 0.68 * i / 4, y - dh + 0.1], [dx0 + dw * 0.68 * i / 4, y - 0.1], 'rgba(30,32,40,0.45)', 0.4);
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(dx0, y - dh, dw * 0.68, 0.4);
    circle(ctx, cx, ys - r * 0.5, 0.75, '#ffffff'); circle(ctx, cx, ys - r * 0.5, 0.52, cols[1]); circle(ctx, cx - 0.15, ys - r * 0.5 - 0.15, 0.2, cols[0]);
    front(); ctx.strokeStyle = rgba(INK, 0.8); ctx.lineWidth = 0.45; ctx.stroke();
  }
  function controlTower(ctx, cols, v) {
    var sh = cube(11.9, 11.3, 1.5, 6.2, 1.4);
    cubeShadow(ctx, sh, 0.24);
    paintCube(ctx, sh, '#e6e8ec', '#a4a9b2');
    for (var i = 0; i < 3; i++) { ctx.fillStyle = rgba(C.glassD, 0.85); ctx.fillRect(sh.x + 0.55, sh.y - 1.6 - i * 1.6, 0.4, 0.8); }
    ink(ctx, sh.hull, 0.75);
    var cab = cube(11.05, 5.3, 3.2, 1.55, 2.3);
    paintCube(ctx, cab, '#d3d7dd', '#959ba5');
    poly(ctx, fRect(cab, 0.15, cab.w - 0.15, 0.3, 1.3), vgrad(ctx, cab.y - 1.3, cab.y - 0.3, mix(C.glass, '#ffffff', 0.4), C.glassD));
    poly(ctx, sRect(cab, 0.1, cab.d - 0.1, 0.3, 1.3), shade(C.glassD, 0.8));
    for (i = 1; i < 4; i++) seg(ctx, pt(cab, cab.w * i / 4, 0, 0.35), pt(cab, cab.w * i / 4, 0, 1.25), rgba(INK, 0.5), 0.4);
    seg(ctx, pt(cab, cab.w, cab.d / 2, 0.35), pt(cab, cab.w, cab.d / 2, 1.25), rgba(INK, 0.5), 0.4);
    if (isLit(1, 1, 90 + v, 0.5)) poly(ctx, fRect(cab, 0.25 + cab.w / 4, cab.w / 2 - 0.1, 0.35, 0.9), 'rgba(255,214,107,0.7)');
    ink(ctx, cab.hull, 0.75);
    var cap = cube(10.85, 3.75, 3.6, 0.6, 2.5);
    paintCube(ctx, cap, cols[1], cols[2], mix(cols[0], '#ffffff', 0.2));
    ink(ctx, cap.hull, 0.8);
    var a = pt(cap, 1.9, 1.3, 0.6);
    antenna(ctx, a[0], a[1], 1.9);
  }
  function bAirport(ctx, cols, v) {
    yard(ctx, 0.7, 3.8, 15.3, 11.8, mix(C.plaza, '#b8bcc4', 0.3));
    runway(ctx, 11.3, 15.3);
    hangar(ctx, 1.1, 11.2, 7.6, 1.5, 4.0, cols);
    controlTower(ctx, cols, v);
  }

  // --- Hafen: Kai mit Kaimauer zur Wasserseite, Lagerhaus, Container, Containerbrücke, Poller
  function bollard(ctx, x, y) {
    ellipse(ctx, x + 0.25, y + 0.15, 0.45, 0.22, 'rgba(16,20,36,0.3)');
    ctx.fillStyle = '#34323a'; ctx.fillRect(x - 0.3, y - 0.5, 0.6, 0.55);
    ellipse(ctx, x, y - 0.5, 0.42, 0.22, '#4c4a54'); circle(ctx, x - 0.12, y - 0.55, 0.13, '#8a8894');
  }
  function container(ctx, x, y, w, col) {
    var k = cube(x, y, w, 1.25, 1.25);
    paintCube(ctx, k, col, shade(col, 0.66), mix(col, '#ffffff', 0.22));
    ctx.save(); pathOf(ctx, k.front); ctx.clip();
    for (var xx = x + 0.35; xx < x + w - 0.1; xx += 0.5) seg(ctx, [xx, y - 1.2], [xx, y - 0.05], 'rgba(16,20,36,0.2)', 0.4);
    ctx.restore();
    seg(ctx, pt(k, w, 0.62, 0.1), pt(k, w, 0.62, 1.15), 'rgba(16,20,36,0.45)', 0.4);
    ink(ctx, k.hull, 0.75, 0.42);
    return k;
  }
  /** Hafen-Wippkran auf Portal: Fuß (x, y) = vordere linke Portalecke; dir = 1 Ausleger nach rechts, −1 nach links */
  function crane(ctx, x, y, cols, dir) {
    var F = { x: x, y: y }, main = cols[1], dark = cols[2], light = mix(cols[1], cols[0], 0.45);
    function block(u, s, z, w, h, d, f, sd, tp) {
      var p = pt(F, u, s, z), k = cube(p[0], p[1], w, h, d);
      paintCube(ctx, k, f || main, sd || dark, tp || light); ink(ctx, k.hull, 0.75, 0.42); return k;
    }
    function weight() { block(dir > 0 ? -0.5 : 2.55, 0.5, 3.1, 1.0, 1.0, 1.1, '#5c5a62', '#3e3c44', '#77757e'); }
    castShadow(ctx, [pt(F, 0, 0, 0), pt(F, 3.0, 0, 0), pt(F, 3.0, 2.0, 0), pt(F, 0, 2.0, 0)], 3.2, 0.2);
    // Portal: hintere Beine, Plattform, vordere Beine
    block(0, 1.5, 0, 0.6, 2.5, 0.55); block(2.4, 1.5, 0, 0.6, 2.5, 0.55);
    block(-0.1, 0, 2.5, 3.2, 0.6, 2.1, STEEL, shade(STEEL, 0.7), mix(STEEL, '#ffffff', 0.3));
    block(0, 0, 0, 0.6, 2.5, 0.55); block(2.4, 0, 0, 0.6, 2.5, 0.55);
    seg(ctx, pt(F, 0.6, 0, 2.4), pt(F, 2.4, 0, 1.2), dark, 0.42);
    ctx.fillStyle = INK; ctx.fillRect(x - 0.3, y - 0.3, 1.2, 0.42); ctx.fillRect(x + 2.1, y - 0.3, 1.2, 0.42);
    // Gegengewicht und Maschinenhaus (Teamfarbe)
    if (dir > 0) weight();
    var cab = block(0.4, 0.3, 3.1, 2.0, 1.9, 1.4);
    poly(ctx, fRect(cab, 1.0, 1.75, 0.8, 1.5), INK);
    poly(ctx, fRect(cab, 1.1, 1.65, 0.9, 1.4), vgrad(ctx, cab.y - 1.4, cab.y - 0.9, mix(C.glass, '#ffffff', 0.4), C.glassD));
    poly(ctx, fRect(cab, 0, cab.w, 1.55, 1.9), mix(cols[0], '#ffffff', 0.35));
    if (dir < 0) weight();
    // Ausleger als kräftiger Fachwerkträger bis zur Spitze (Oberkante im Licht)
    var piv = pt(cab, dir > 0 ? cab.w - 0.2 : 0.2, 0.7, 1.2), tip = dir > 0 ? [15.2, 2.5] : [0.85, 2.5];
    var dx = tip[0] - piv[0], dy = tip[1] - piv[1], L = Math.sqrt(dx * dx + dy * dy), nx = -dy / L * 0.42, ny = dx / L * 0.42;
    if (ny < 0) { nx = -nx; ny = -ny; }
    var jib = [[piv[0] - nx, piv[1] - ny], [tip[0] - nx * 0.6, tip[1] - ny * 0.6], [tip[0] + nx * 0.6, tip[1] + ny * 0.6], [piv[0] + nx, piv[1] + ny]];
    poly(ctx, jib, main);
    poly(ctx, [jib[0], jib[1], lp(jib[1], jib[2], 0.45), lp(jib[0], jib[3], 0.45)], light);
    for (var i = 1; i < 7; i++) seg(ctx, lp(jib[0], jib[1], i / 7 - 0.07), lp(jib[3], jib[2], i / 7), dark, 0.4);
    ink(ctx, jib, 0.8, 0.42);
    // Bock mit Abspannung zur Spitze und zum Gegengewicht
    var bock = pt(cab, dir > 0 ? 0.6 : 1.4, 0.7, 3.1);
    seg(ctx, pt(cab, 0.3, 0.7, 1.9), bock, dark, 0.5); seg(ctx, pt(cab, 1.7, 0.7, 1.9), bock, dark, 0.5);
    seg(ctx, bock, tip, INK, 0.4); seg(ctx, bock, pt(F, dir > 0 ? -0.5 : 3.55, 1.0, 4.1), INK, 0.4);
    // Seil, Haken und Last (Container in Teamfarbe)
    var hx = tip[0] - 0.2 * dir;
    seg(ctx, [hx, tip[1] + 0.3], [hx, 6.4], INK, 0.4);
    fillRR(ctx, hx - 0.45, 6.2, 0.9, 0.5, 0.15, '#f2c43c');
    var ld = cube(hx - 0.96 - 0.25 * dir, 8.2, 1.6, 1.0, 0.7);
    paintCube(ctx, ld, cols[1], dark, light); ink(ctx, ld.hull, 0.75, 0.4);
    seg(ctx, [hx, 6.7], [ld.x + 0.3, ld.y - 1.0], INK, 0.4); seg(ctx, [hx, 6.7], [ld.x + 1.4, ld.y - 1.0], INK, 0.4);
  }
  function bPort(ctx, cols, v, info) {
    var m = info && info.sea ? info.sea : { n: 0, e: 0, s: 0, w: 1 };
    var x0 = m.w ? -0.5 : 1.0, x1 = m.e ? 16.5 : 14.4, y0 = m.n ? -0.5 : 2.4, y1 = m.s ? 16.5 : 13.6;
    // Wasser nur im Westen: Anordnung spiegeln, damit der Kran über das Wasser greift (Licht bleibt von links)
    var flip = !!(m.e && !m.w);
    var deck = mix(C.plaza, '#b9b6ae', 0.45);
    // Kaimauern zur Wasserseite und ihr Schatten im Wasser
    ctx.fillStyle = 'rgba(10,30,70,0.32)';
    if (!m.s) ctx.fillRect(x0 + 0.3, y1 + 1.0, x1 - x0, 0.7);
    if (!m.e) ctx.fillRect(x1 + 0.45, y0 + 0.4, 0.6, y1 - y0 + 1.0);
    if (!m.e) { ctx.fillStyle = '#6f6a62'; ctx.fillRect(x1, y0 + 0.15, 0.45, y1 - y0 + (m.s ? 0 : 1.0)); }
    if (!m.s) {
      ctx.fillStyle = vgrad(ctx, y1, y1 + 1.05, '#9a948a', '#6c675f'); ctx.fillRect(x0, y1, x1 - x0, 1.05);
      for (var fx = x0 + 1.6; fx < x1 - 0.8; fx += 2.4) fillRR(ctx, fx, y1 + 0.15, 0.7, 0.75, 0.25, '#2a2830');
      ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fillRect(x0 + 0.3, y1 + 1.05, x1 - x0 - 0.3, 0.4);
    }
    // Kaifläche mit Fugen und Kantensteinen
    ctx.fillStyle = vgrad(ctx, y0, y1, shade(deck, 1.04), shade(deck, 0.94)); ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.strokeStyle = 'rgba(16,20,36,0.12)'; ctx.lineWidth = 0.4; ctx.beginPath();
    for (var gx = Math.ceil(x0 / 2.6) * 2.6; gx < x1; gx += 2.6) { ctx.moveTo(gx, y0); ctx.lineTo(gx, y1); }
    for (var gy = Math.ceil(y0 / 2.6) * 2.6; gy < y1; gy += 2.6) { ctx.moveTo(x0, gy); ctx.lineTo(x1, gy); }
    ctx.stroke();
    ctx.fillStyle = shade(deck, 1.12);
    if (!m.s) ctx.fillRect(x0, y1 - 0.5, x1 - x0, 0.5);
    if (!m.n) ctx.fillRect(x0, y0, x1 - x0, 0.5);
    if (!m.w) ctx.fillRect(x0, y0, 0.5, y1 - y0);
    if (!m.e) ctx.fillRect(x1 - 0.5, y0, 0.5, y1 - y0);
    ctx.fillStyle = 'rgba(242,196,60,0.85)';
    if (!m.s) ctx.fillRect(x0 + 0.4, y1 - 1.2, x1 - x0 - 0.8, 0.4);
    if (!m.e) ctx.fillRect(x1 - 1.2, y0 + 0.4, 0.4, y1 - y0 - 0.8);
    if (!m.w) ctx.fillRect(x0 + 0.8, y0 + 0.4, 0.4, y1 - y0 - 0.8);
    ctx.strokeStyle = rgba(INK, 0.6); ctx.lineWidth = 0.42; ctx.beginPath();
    if (!m.s) { ctx.moveTo(x0, y1 + 1.05); ctx.lineTo(x1, y1 + 1.05); }
    if (!m.n) { ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); }
    if (!m.w) { ctx.moveTo(x0, y0); ctx.lineTo(x0, y1 + (m.s ? 0 : 1.05)); }
    if (!m.e) { ctx.moveTo(x1 + 0.45, y0 + 0.15); ctx.lineTo(x1 + 0.45, y1 + (m.s ? 0 : 1.05)); }
    ctx.stroke();
    // Lagerhaus mit Teamdach
    var W = cube(flip ? 8.1 : 1.7, 8.6, 6.0, 3.0, 3.0), wall = '#e4ddd0', side = shade(wall, 0.68);
    cubeShadow(ctx, W, 0.26, 1.0);
    paintCube(ctx, W, wall, side, null);
    ctx.fillStyle = rgba(INK, 0.6); ctx.fillRect(W.x + 1.7, W.y - 2.35, 2.6, 2.35);
    ctx.fillStyle = vgrad(ctx, W.y - 2.2, W.y, '#a7adb6', '#6d737d'); ctx.fillRect(W.x + 1.85, W.y - 2.2, 2.3, 2.2);
    for (var yy = W.y - 1.75; yy < W.y - 0.1; yy += 0.45) seg(ctx, [W.x + 1.95, yy], [W.x + 4.05, yy], 'rgba(30,32,40,0.35)', 0.4);
    pane(ctx, W.x + 0.45, W.y - 2.1, 0.8, 0.8, false); pane(ctx, W.x + 4.75, W.y - 2.1, 0.8, 0.8, isLit(1, 1, 100 + v, 0.35));
    sidePane(ctx, W, 0.7, 1.2, 1.4, 0.8, false);
    ink(ctx, W.hull, 0.8);
    var roof = gableRoof(ctx, W, 1.25, cols, side, 0.3);
    // Container (oberster in Teamfarbe)
    var cx0 = flip ? 9.3 : 1.5;
    container(ctx, cx0, 12.6, 2.7, '#a4623e'); container(ctx, cx0 + 3.0, 12.6, 2.7, '#5d7488');
    container(ctx, cx0 + 1.1, 11.35, 2.7, cols[1]);
    // Poller an der Kaikante
    if (!m.s) { bollard(ctx, flip ? 6.6 : 8.6, y1 - 0.15); bollard(ctx, flip ? 14.6 : 13.0, y1 - 0.15); }
    if (!m.e) bollard(ctx, x1 - 0.45, 4.2);
    if (!m.w) bollard(ctx, x0 + 0.45, 4.2);
    crane(ctx, flip ? 1.6 : 9.7, 12.7, cols, flip ? -1 : 1);
    if (!isNeutral(cols)) flag(ctx, roof.r0[0] + 0.7, roof.r0[1] + 0.2, 3.0, cols, 2.8, 1.6);
  }

  // --- Hauptquartier: Regierungsbau mit Säulenportikus, Kuppel und großer Fahne
  function star(ctx, cx, cy, r, col) {
    ctx.beginPath();
    for (var i = 0; i < 10; i++) { var a = -Math.PI / 2 + i * Math.PI / 5, rr2 = i % 2 ? r * 0.45 : r; ctx.lineTo(cx + Math.cos(a) * rr2, cy + Math.sin(a) * rr2); }
    ctx.closePath(); ctx.fillStyle = col; ctx.fill();
  }
  function column(ctx, x, yb, yt, w) {
    ctx.fillStyle = hgrad(ctx, x, x + w, '#ffffff', '#b9b2a4'); ctx.fillRect(x, yt, w, yb - yt);
    ctx.fillStyle = '#f7f3ea'; ctx.fillRect(x - 0.18, yt - 0.05, w + 0.36, 0.38); ctx.fillRect(x - 0.18, yb - 0.33, w + 0.36, 0.33);
    ctx.strokeStyle = rgba(INK, 0.55); ctx.lineWidth = 0.4; ctx.strokeRect(x, yt, w, yb - yt);
  }
  /** Walmdach (Pyramide) über einem Quader, für die Eckpavillons des Hauptquartiers */
  function hipRoof(ctx, b, rh, cols, ov) {
    ov = ov == null ? 0.25 : ov;
    var F0 = pt(b, -ov, -ov, b.h), F1 = pt(b, b.w + ov, -ov, b.h), B1 = pt(b, b.w + ov, b.d + ov, b.h), B0 = pt(b, -ov, b.d + ov, b.h);
    var A = pt(b, b.w / 2, b.d / 2, b.h + rh);
    poly(ctx, fRect(b, 0, b.w, b.h - 0.6, b.h), 'rgba(16,20,36,0.2)');
    poly(ctx, [B0, B1, A], cols[2]);
    poly(ctx, [B0, F0, A], mix(cols[1], cols[0], 0.2));
    poly(ctx, [F1, B1, A], shade(cols[1], 0.7));
    poly(ctx, [F0, F1, A], vgrad(ctx, A[1], F0[1], mix(cols[1], cols[0], 0.5), shade(cols[1], 0.92)));
    seg(ctx, F0, F1, cols[2], 0.45);
    if (snowy()) poly(ctx, [lp(F0, A, 0.6), lp(F1, A, 0.6), A], 'rgba(250,252,255,0.9)');
    ink(ctx, convexHull([F0, F1, B1, B0, A]), 0.8);
    seg(ctx, F1, A, rgba(INK, 0.5), 0.4);
    circle(ctx, A[0], A[1] - 0.2, 0.3, '#f2dc8a');
  }
  /** Hängendes Banner in Teamfarbe mit Stern */
  function banner(ctx, x, y, w, h, cols) {
    ctx.fillStyle = rgba(INK, 0.6); ctx.fillRect(x - 0.25, y - 0.2, w + 0.5, 0.4);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w / 2, y + h - 0.6); ctx.lineTo(x, y + h); ctx.closePath();
    ctx.fillStyle = hgrad(ctx, x, x + w, mix(cols[1], cols[0], 0.35), cols[2]); ctx.fill();
    ctx.strokeStyle = rgba(INK, 0.75); ctx.lineWidth = 0.4; ctx.stroke();
    star(ctx, x + w / 2, y + h * 0.35, Math.min(0.5, w * 0.36), 'rgba(255,246,220,0.95)');
  }
  function bHQ(ctx, cols, v) {
    yard(ctx, 0.3, 5.4, 15.7, 15.0);
    var wall = '#f1ece2', side = shade(wall, 0.68), i;
    var M = cube(1.5, 13.0, 11.6, 4.7, 2.3);                     // Mittelbau
    var Lp = cube(0.65, 13.35, 2.9, 5.7, 2.5), Rp = cube(11.4, 13.35, 3.0, 5.7, 2.5);   // Eckpavillons
    cubeShadow(ctx, M, 0.26, 1.6); cubeShadow(ctx, Rp, 0.26, 1.2);
    // Mittelbau mit Fenstern und Kranzgesims
    paintCube(ctx, M, wall, side, null);
    poly(ctx, fRect(M, 0, M.w, 0, 0.55), shade(wall, 0.8));
    [[2.15, 2], [8.25, 2]].forEach(function (g, wi) {
      for (var c = 0; c < g[1]; c++) for (var r = 0; r < 2; r++) pane(ctx, M.x + g[0] + c * 1.15, M.y - 0.95 - r * 1.85 - 1.3, 0.72, 1.3, isLit(c + wi * 3, r, 110 + v, 0.22));
    });
    poly(ctx, fRect(M, -0.1, M.w + 0.1, M.h - 0.4, M.h), '#fbf8f1');
    poly(ctx, fRect(M, 0, M.w, M.h - 0.6, M.h - 0.4), 'rgba(16,20,36,0.2)');
    ink(ctx, M.hull, 0.8);
    // Dach des Mittelbaus: Attika aus Stein, Dachfläche in Teamfarbe
    poly(ctx, M.top, STONE);
    poly(ctx, tRect(M, 0.3, M.w - 0.3, 0.3, M.d - 0.3), snowy() ? '#f4f7fb' : vgrad(ctx, M.y - M.h + M.d * OY, M.y - M.h, mix(cols[1], cols[0], 0.35), shade(cols[1], 0.9)));
    ink(ctx, M.top, 0.6, 0.4);
    // Tambour mit Kuppel in Teamfarbe
    var dp = pt(M, 4.15, 0.55, M.h), D = cube(dp[0], dp[1], 3.4, 1.5, 1.3);
    paintCube(ctx, D, STONE, shade(STONE, 0.7), null);
    for (i = 0; i < 4; i++) { ctx.fillStyle = rgba(INK, 0.6); ctx.fillRect(D.x + 0.4 + i * 0.75, D.y - 1.2, 0.38, 0.85); }
    ink(ctx, D.hull, 0.75, 0.42);
    var dc = pt(D, 1.7, 0.65, 1.5), rx = 2.05, ry = 2.3;
    ctx.beginPath(); ctx.ellipse(dc[0], dc[1], rx, ry, 0, Math.PI, 0); ctx.closePath();
    var g = ctx.createRadialGradient(dc[0] - rx * 0.4, dc[1] - ry * 0.6, 0.2, dc[0], dc[1] - ry * 0.3, rx * 1.3);
    g.addColorStop(0, mix(cols[0], '#ffffff', 0.45)); g.addColorStop(0.35, cols[1]); g.addColorStop(1, cols[2]);
    ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = rgba(INK, 0.8); ctx.lineWidth = 0.45; ctx.stroke();
    ctx.strokeStyle = rgba(cols[3], 0.45); ctx.lineWidth = 0.4; ctx.beginPath();
    ctx.ellipse(dc[0], dc[1], rx * 0.45, ry, 0, Math.PI, Math.PI * 2); ctx.moveTo(dc[0], dc[1]); ctx.lineTo(dc[0], dc[1] - ry); ctx.stroke();
    fillRR(ctx, dc[0] - 0.45, dc[1] - ry - 0.6, 0.9, 0.7, 0.2, STONE); strokeRR(ctx, dc[0] - 0.45, dc[1] - ry - 0.6, 0.9, 0.7, 0.2, rgba(INK, 0.6), 0.4);
    // Eckpavillons mit Walmdach und Bannern
    [Lp, Rp].forEach(function (p, k) {
      paintCube(ctx, p, shade(wall, 0.97), side, null);
      poly(ctx, fRect(p, 0, p.w, 0, 0.6), shade(wall, 0.8));
      poly(ctx, fRect(p, -0.1, p.w + 0.1, p.h - 0.4, p.h), '#fbf8f1');
      pane(ctx, p.x + 0.4, p.y - 2.3, 0.62, 1.4, isLit(k, 5, 112 + v, 0.3)); pane(ctx, p.x + p.w - 1.02, p.y - 2.3, 0.62, 1.4, false);
      sidePane(ctx, p, 0.6, 1.0, 1.3, 1.4, false); sidePane(ctx, p, 0.6, 3.3, 1.3, 1.4, false);
      banner(ctx, p.x + 1.08, p.y - p.h + 0.75, 0.84, 3.3, cols);
      ink(ctx, p.hull, 0.8);
      hipRoof(ctx, p, 1.7, cols, 0.25);
    });
    // Portikus: Säulenhalle vor dem Eingang mit Dreiecksgiebel
    var P = cube(4.55, 14.1, 5.5, 4.1, 1.6), sty = cube(4.25, 14.3, 6.1, 0.55, 1.9);
    poly(ctx, fRect(M, 3.6, 9.4, 0.4, 4.2), 'rgba(60,50,40,0.3)');
    ctx.fillStyle = rgba(INK, 0.65); ctx.fillRect(M.x + 5.15, M.y - 2.75, 1.9, 2.75);
    ctx.fillStyle = vgrad(ctx, M.y - 2.6, M.y, cols[2], shade(cols[2], 0.6)); ctx.fillRect(M.x + 5.3, M.y - 2.6, 1.6, 2.6);
    seg(ctx, [M.x + 6.1, M.y - 2.55], [M.x + 6.1, M.y - 0.05], 'rgba(255,255,255,0.35)', 0.4);
    paintCube(ctx, sty, STONE, shade(STONE, 0.72), mix(STONE, '#ffffff', 0.4));
    ink(ctx, sty.hull, 0.65, 0.4);
    for (i = 0; i < 4; i++) column(ctx, P.x + 0.3 + i * 1.6, P.y - 0.3, P.y - 3.4, 0.72);
    var ent = cube(P.x - 0.15, P.y - 3.4, P.w + 0.3, 0.7, P.d);
    paintCube(ctx, ent, STONE, shade(STONE, 0.7), STONE);
    poly(ctx, fRect(ent, 0, ent.w, 0.2, 0.45), cols[1]);
    ink(ctx, ent.hull, 0.75, 0.42);
    var L = pt(ent, -0.2, 0, ent.h), R2 = pt(ent, ent.w + 0.2, 0, ent.h), A = pt(ent, ent.w / 2, 0, ent.h + 1.7);
    var dd = [P.d * OX + 0.3, P.d * OY - 0.35];
    function off(p) { return [p[0] + dd[0], p[1] + dd[1]]; }
    poly(ctx, [L, A, off(A), off(L)], mix(cols[1], cols[0], 0.3));
    poly(ctx, [A, R2, off(R2), off(A)], cols[2]);
    ink(ctx, [L, A, off(A), off(R2), R2], 0.7, 0.42);
    poly(ctx, [L, R2, A], STONE);
    var inner = [[L[0] + 0.85, L[1] - 0.3], [R2[0] - 0.85, R2[1] - 0.3], [A[0], A[1] + 0.55]];
    poly(ctx, inner, vgrad(ctx, inner[2][1], inner[0][1], mix(cols[1], cols[0], 0.3), cols[2]));
    star(ctx, A[0], (inner[0][1] + inner[2][1]) / 2 + 0.2, 0.55, '#fff6dc');
    ink(ctx, [L, R2, A], 0.8);
    // Freitreppe
    ctx.fillStyle = shade(STONE, 0.8); ctx.fillRect(4.6, 14.3, 5.8, 0.35);
    ctx.fillStyle = STONE; ctx.fillRect(4.35, 14.65, 6.3, 0.3);
    ctx.fillStyle = shade(STONE, 0.78); ctx.fillRect(4.35, 14.95, 6.3, 0.35);
    ctx.strokeStyle = rgba(INK, 0.5); ctx.lineWidth = 0.4; ctx.strokeRect(4.35, 14.3, 6.3, 1.0);
    // große Fahne über der Kuppel
    if (!isNeutral(cols)) flag(ctx, dc[0], dc[1] - ry - 0.55, 2.7, cols, 3.6, 1.9);
  }
  /** Zeichenzustand (Linienenden, Clip …) je Gebäude kapseln */
  function guarded(fn) { return function (ctx, cols, v, info) { ctx.save(); fn(ctx, cols, v || 0, info); ctx.restore(); }; }
  var BUILDERS = { C: guarded(bCity), K: guarded(bFactory), A: guarded(bAirport), O: guarded(bPort), Q: guarded(bHQ) };

  // ------------------------------------------------------------ Feld-Cache und Geländeebene
  function detailFor(map) { var a = map.w * map.h; return a <= 1800 ? 4 : a <= 4600 ? 3 : 2; }
  R.detailFor = detailFor;
  /** Umgebungs-Schlüssel und -Daten eines Feldes (bestimmt das gecachte Bild) */
  function tileInfo(map, x, y, t) {
    var v = Math.floor(hash(x, y, 1) * 6), o = map.owner[y][x];
    var fac = G.TERRAIN[t] && G.TERRAIN[t].prop ? (R.slotFaction ? R.slotFaction(o) : 'neutral') : '';
    var info = { v: v, fac: fac, key: v + '|' + fac };
    switch (t) {
      case 'S': case 'X': case 'O': info.sea = seaCtx(map, x, y); info.key += '|' + seeKeyOf(info.sea); break;
      case 'H': info.shoal = shoalCtx(map, x, y); info.key += '|' + [info.shoal.n, info.shoal.e, info.shoal.s, info.shoal.w].join(''); break;
      case 'R': info.road = roadCtx(map, x, y); info.key += '|' + dirKey(info.road); break;
      case 'I': info.river = riverCtx(map, x, y); info.key += '|' + dirKey(info.river) + [info.river.nw, info.river.ne, info.river.sw, info.river.se].map(function (b) { return b ? 1 : 0; }).join(''); break;
      case 'B': {
        var nbs = [tAt(map, x - 1, y), tAt(map, x + 1, y), tAt(map, x, y - 1), tAt(map, x, y + 1)];
        info.vertical = bridgeVertical(map, x, y);
        info.onSea = nbs.some(function (q) { return q === 'S' || q === 'X'; });
        if (info.onSea) info.sea = seaCtx(map, x, y);
        info.key += '|' + (info.vertical ? 'v' : 'h') + (info.onSea ? 's' + seeKeyOf(info.sea) : 'r');
        break;
      }
    }
    return info;
  }
  function seeKeyOf(m) { return seaKey(m); }
  function paintKind(ctx, t, info) {
    var v = info.v;
    switch (t) {
      case 'S': paintSea(ctx, v, info.sea); break;
      case 'X': paintSea(ctx, v, info.sea); paintReef(ctx, v); break;
      case 'O': paintSea(ctx, v, info.sea); break;
      case 'H': paintShoal(ctx, v, info.shoal); break;
      case 'B': paintBridge(ctx, v, info); break;
      case 'I': paintRiver(ctx, v, info.river); break;
      case 'R': paintRoad(ctx, v, info.road); break;
      case 'M': paintGrass(ctx, v); paintMountain(ctx, v); break;
      case 'F': paintGrass(ctx, v); paintForest(ctx, v); break;
      default: paintGrass(ctx, v);
    }
    if (BUILDERS[t]) BUILDERS[t](ctx, teamColors(info.fac || 'neutral'), v, info);
  }
  function tileCanvas(map, x, y, D) {
    var t = map.terrain[y][x];
    if (!G.TERRAIN[t]) t = 'P';
    var info = tileInfo(map, x, y, t);
    var key = R.theme + '|' + D + '|' + t + '|' + info.key;
    var c = TC[key];
    if (c) return c;
    c = mkCanvas(TS * D, TS * D);
    var g = c.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.scale(D, D);
    paintKind(g, t, info);
    TC[key] = c;
    return c;
  }
  /** Malt ein einzelnes Geländefeld (inkl. Gebäude) an (ox, oy) in Ebenen-Pixeln; D = Detailfaktor (Standard: der Ebene) */
  R.paintTile = function (ctx, map, x, y, ox, oy, D) {
    D = D || (ctx.canvas && ctx.canvas.D) || R.D;
    var TP = TS * D;
    ox = ox == null ? x * TP : ox; oy = oy == null ? y * TP : oy;
    ctx.drawImage(tileCanvas(map, x, y, D), ox, oy);
  };
  /** Gebäude-Bild 48×48 (für Symbole) */
  R.buildingSprite = function (t, faction) {
    var key = 'b|' + t + '|' + faction + '|' + R.theme;
    if (R.cache[key]) return R.cache[key];
    var c = mkCanvas(48, 48), g = c.getContext('2d');
    g.imageSmoothingEnabled = true; g.scale(3, 3);
    paintGrass(g, 2);
    if (BUILDERS[t]) BUILDERS[t](g, teamColors(faction), 0, null);
    R.cache[key] = c;
    return c;
  };

  /** Rendert die gesamte Geländeebene einer Karte in ein Canvas (TS·D Pixel je Feld). */
  R.buildTerrain = function (map) {
    var D = detailFor(map), TP = TS * D;
    var c = mkCanvas(map.w * TP, map.h * TP), ctx = c.getContext('2d');
    c.D = D; c.TP = TP;
    R.D = D;
    for (var y = 0; y < map.h; y++) for (var x = 0; x < map.w; x++) R.paintTile(ctx, map, x, y, x * TP, y * TP, D);
    return c;
  };
  /** Graue, abgedunkelte Kopie der Geländeebene in 16 px je Feld (für unerforschte Gebiete) */
  R.greyLayer = function (layer) {
    var D = layer.D || R.D, w = layer.width / D, h = layer.height / D;
    var c = mkCanvas(w, h), cx = c.getContext('2d');
    cx.imageSmoothingEnabled = true;
    if ('filter' in cx) { cx.filter = 'grayscale(1) brightness(0.55) contrast(0.85)'; cx.drawImage(layer, 0, 0, w, h); cx.filter = 'none'; }
    else { cx.drawImage(layer, 0, 0, w, h); cx.fillStyle = 'rgba(40,40,48,0.7)'; cx.fillRect(0, 0, w, h); }
    return c;
  };
  R.updateTiles = function (layer, map, tiles) {
    var ctx = layer.getContext('2d'), D = layer.D || R.D, TP = TS * D;
    tiles.forEach(function (t) {
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        var x = t.x + dx, y = t.y + dy;
        if (x >= 0 && y >= 0 && x < map.w && y < map.h) R.paintTile(ctx, map, x, y, x * TP, y * TP, D);
      }
    });
  };

  /** Minikarte (s Pixel je Feld) für Auswahlmenüs und das Spiel */
  R.minimap = function (def, s, slotFaction) {
    var map = def.terrain ? def : G.parseMap(def);
    var MI = Object.assign({}, MINI, THEME_MINI[def.theme] || {});
    s = s || 4;
    var c = mkCanvas(map.w * s, map.h * s), ctx = c.getContext('2d');
    for (var y = 0; y < map.h; y++) for (var x = 0; x < map.w; x++) {
      var t = map.terrain[y][x], o = map.owner[y][x];
      ctx.fillStyle = MI[t] || MI.P;
      ctx.fillRect(x * s, y * s, s, s);
      if (s >= 4 && (t === 'F' || t === 'M')) { ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(x * s + 1, y * s + 1, s - 2, s - 2); }
      if (G.TERRAIN[t] && G.TERRAIN[t].prop) {
        var fac = o ? (slotFaction ? slotFaction(o) : G.FACTION_ORDER[o - 1]) : 'neutral';
        var cols = G.FACTIONS[fac] ? G.FACTIONS[fac].colors : G.FACTIONS.neutral.colors;
        if (s >= 3) {
          ctx.fillStyle = '#16121a'; ctx.fillRect(x * s, y * s, s, s);
          ctx.fillStyle = cols[1]; ctx.fillRect(x * s + 0.6, y * s + 0.6, s - 1.2, s - 1.2);
          if (t === 'Q') { ctx.fillStyle = cols[0]; ctx.fillRect(x * s + s * 0.3, y * s + s * 0.3, s * 0.4, s * 0.4); }
        } else { ctx.fillStyle = cols[1]; ctx.fillRect(x * s, y * s, s, s); }
      }
    }
    (def.units || []).forEach(function (u) {
      var fac = slotFaction ? slotFaction(u[3]) : G.FACTION_ORDER[u[3] - 1];
      var col = G.FACTIONS[fac] ? G.FACTIONS[fac].colors[0] : '#fff';
      ctx.fillStyle = '#16121a'; ctx.fillRect(u[1] * s, u[2] * s, s, s);
      ctx.fillStyle = col; ctx.fillRect(u[1] * s + 0.8, u[2] * s + 0.8, Math.max(1, s - 1.6), Math.max(1, s - 1.6));
    });
    return c;
  };

  // ------------------------------------------------------------ Effekte
  R.addFx = function (fx) { fx.t0 = R.time; R.fx.push(fx); };
  R.explosion = function (x, y, big) { R.addFx({ type: 'boom', x: x, y: y, dur: big ? 700 : 500, big: big }); };
  R.floatText = function (x, y, text, color) { R.addFx({ type: 'text', x: x, y: y, text: text, color: color || '#fff', dur: 1000 }); };

  function drawFx(ctx) {
    var now = R.time;
    R.fx = R.fx.filter(function (f) { return now - f.t0 < f.dur; });
    R.fx.forEach(function (f) {
      var p = (now - f.t0) / f.dur;
      var cx = f.x * TS + 8, cy = f.y * TS + 8;
      if (f.type === 'boom') {
        var r = (f.big ? 9.5 : 6.5) * Math.sin(p * Math.PI);
        if (r > 0.3) {
          var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
          g.addColorStop(0, p < 0.3 ? '#ffffff' : '#fff2a8'); g.addColorStop(0.55, '#ffb030'); g.addColorStop(1, 'rgba(255,90,30,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
          for (var i = 0; i < 7; i++) {
            var a = i / 7 * Math.PI * 2 + f.t0, d = p * 11;
            circle(ctx, cx + Math.cos(a) * d, cy + Math.sin(a) * d - p * 3, p < 0.6 ? 1.1 : 1.5, p < 0.6 ? '#ff7030' : 'rgba(80,70,70,' + (1 - p) + ')');
          }
        }
      } else if (f.type === 'text') {
        ctx.save();
        ctx.globalAlpha = p > 0.7 ? (1 - p) / 0.3 : 1;
        ctx.font = 'bold 7px "Trebuchet MS", Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.fillStyle = f.color;
        var ty = cy - 5 - p * 10;
        ctx.strokeText(f.text, cx, ty); ctx.fillText(f.text, cx, ty);
        ctx.restore();
      } else if (f.type === 'dust') {
        for (var dd = 0; dd < 3; dd++) {
          var dr = 2 + p * 4 + dd, dax = cx - 4 + dd * 4 + Math.sin(f.t0 + dd) * 2, day = cy + 5 - p * 4;
          ctx.fillStyle = 'rgba(210,190,150,' + (0.45 * (1 - p)) + ')';
          ctx.beginPath(); ctx.arc(dax, day, dr, 0, Math.PI * 2); ctx.fill();
        }
      } else if (f.type === 'sparkle') {
        for (var k = 0; k < 4; k++) {
          var aa = k / 4 * Math.PI * 2 + p * 4;
          circle(ctx, cx + Math.cos(aa) * 7, cy + Math.sin(aa) * 7 - p * 4, 1.1, k % 2 ? '#a0f8a0' : '#ffffff');
        }
      }
    });
  }

  // ------------------------------------------------------------ Hauptzeichnen
  /**
   * view: { game, terrain(layer), camX, camY (in Feldern, float), scale, cursor:{x,y}, viewer(slot|null),
   *         moveSet: {idx:..}, attackSet: {idx:..}, path: [{x,y}], anim: {unitId:{x,y,hide}}, faction(slot)->id,
   *         facing(slot)->bool flip, showCursor, dangerSet }
   */
  R.draw = function (ctx, cw, ch, view) {
    var g = view.game, map = g.map, sc = view.scale;
    R.time = view.time;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    try { ctx.imageSmoothingQuality = 'high'; } catch (e) { /* egal */ }
    ctx.fillStyle = '#0d0f18'; ctx.fillRect(0, 0, cw, ch);
    var offX = Math.round(-view.camX * TS * sc), offY = Math.round(-view.camY * TS * sc);
    ctx.setTransform(sc, 0, 0, sc, offX, offY);
    // sichtbarer Ausschnitt
    var x0 = Math.max(0, Math.floor(view.camX) - 1), y0 = Math.max(0, Math.floor(view.camY) - 1);
    var x1 = Math.min(map.w - 1, Math.ceil(view.camX + cw / (TS * sc)) + 1), y1 = Math.min(map.h - 1, Math.ceil(view.camY + ch / (TS * sc)) + 1);
    var L = view.terrain, LD = L.D || R.D;
    // nur den sichtbaren Teil der Geländeebene zeichnen
    var sx = x0 * TS * LD, sy = y0 * TS * LD, sw = (x1 - x0 + 1) * TS * LD, sh = (y1 - y0 + 1) * TS * LD;
    ctx.drawImage(L, sx, sy, sw, sh, x0 * TS, y0 * TS, (x1 - x0 + 1) * TS, (y1 - y0 + 1) * TS);
    // Wasser-Glitzern
    var tick = Math.floor(view.time / 400);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (var yy = y0; yy <= y1; yy++) for (var xx = x0; xx <= x1; xx++) {
      var tt = map.terrain[yy][xx];
      if (tt === 'S' || tt === 'X') {
        var hx = hash(xx, yy, tick % 7) * 11 + 2, hy = hash(xx, yy, (tick % 7) + 11) * 11 + 2;
        ctx.fillRect(xx * TS + hx, yy * TS + hy, 1.6, 0.6);
      }
    }
    // Nebel
    var vis = view.viewer != null ? g.visibility(view.viewer) : null;
    // Bewegungs- und Angriffsbereiche: Bewegung = blaue Fläche mit heller Kontur,
    // Angriff = rot schraffiert mit roter Kontur (klar unterscheidbar, auch wenn beides zu sehen ist)
    var pulse = 0.06 * Math.sin(view.time / 180);
    var bounds = { x0: x0, y0: y0, x1: x1, y1: y1 };
    if (view.visionSet) drawTileSet(ctx, Object.keys(view.visionSet), map.w, bounds, { fill: 'rgba(255,200,40,0.2)', hatch: 'rgba(255,235,140,0.4)', edge: 'rgba(255,215,80,0.9)' });
    if (view.dangerSet) drawTileSet(ctx, Object.keys(view.dangerSet), map.w, bounds, { fill: 'rgba(170,40,210,0.26)', hatch: 'rgba(255,190,255,0.45)', edge: 'rgba(240,170,255,0.9)' });
    if (view.moveSet) drawTileSet(ctx, Object.keys(view.moveSet), map.w, bounds, { fill: 'rgba(50,140,255,' + (0.40 + pulse) + ')', edge: 'rgba(225,242,255,0.95)', edgeW: 1.2 });
    if (view.attackSet) {
      var keys = Object.keys(view.attackSet), mv = view.moveSet || {};
      var only = keys.filter(function (k) { return !mv[k]; }), both = keys.filter(function (k) { return mv[k]; });
      if (only.length) drawTileSet(ctx, only, map.w, bounds, { fill: 'rgba(255,45,35,' + (0.42 + pulse) + ')', hatch: 'rgba(255,225,215,0.55)', edge: 'rgba(255,215,205,0.95)', edgeW: 1.2 });
      if (both.length) drawTileSet(ctx, both, map.w, bounds, { hatch: 'rgba(255,90,70,0.75)' });
    }
    if (view.unloadSet) {
      var uk = view.unloadSet.map(function (t) { return t.y * map.w + t.x; });
      drawTileSet(ctx, uk, map.w, bounds, { fill: 'rgba(70,230,110,' + (0.42 + pulse) + ')', edge: 'rgba(230,255,235,0.95)', edgeW: 1.2 });
    }
    // Pfad
    if (view.path && view.path.length > 1) drawPath(ctx, view.path);
    // Einheiten
    var frame = Math.floor(view.time / 450) % 2;
    var units = g.units.slice().sort(function (a, b) { return a.y - b.y; });
    units.forEach(function (u) {
      var an = view.anim && view.anim[u.id];
      if (an && an.hide) return;
      var ux = an ? an.x : u.x, uy = an ? an.y : u.y;
      if (ux < x0 - 1 || ux > x1 + 1 || uy < y0 - 1 || uy > y1 + 1) return;
      if (!an && view.viewer != null && !g.unitVisibleTo(u, view.viewer)) return;
      var fac = view.faction(u.p);
      var flip = an && an.flip != null ? an.flip : view.facing(u.p);
      var done = u.moved && u.p === g.currentPlayer().slot && !an;
      var selected = view.selectedId === u.id;
      var fr = an ? Math.floor(view.time / 110) % 2 : selected ? Math.floor(view.time / 160) % 2 : frame;
      var spr = R.unitSprite(u.type, fac, fr, flip, done);
      var dx = ux * TS, dy = uy * TS;
      var T = G.UNITS[u.type];
      var air = T.domain === 'air';
      if (selected && !an) dy -= (Math.floor(view.time / 160) % 2) * 0.7;
      // Bodenschatten (Luftfahrzeuge: versetzt, sie schweben)
      ctx.fillStyle = air ? 'rgba(0,0,0,0.22)' : 'rgba(0,0,0,0.2)';
      ctx.beginPath();
      if (air) { ctx.ellipse(ux * TS + 9.5, uy * TS + 14.8, 5, 1.3, 0, 0, Math.PI * 2); dy -= 1.2 + Math.sin(view.time / 300 + u.id) * 0.5; }
      else ctx.ellipse(ux * TS + 8, uy * TS + 14.3, 6, 1.5, 0, 0, Math.PI * 2);
      ctx.fill();
      if (u.dived) ctx.globalAlpha = 0.55;
      if (done) ctx.globalAlpha = 0.85;
      ctx.drawImage(spr, dx, dy, TS, TS);
      ctx.globalAlpha = 1;
      // Status-Symbole
      var hp = g.dispHp(u);
      if (hp < 10) drawHp(ctx, String(hp), dx, dy);
      var badge = null;
      var capturing = u.cp < G.RULES.capturePoints && T.capture && !an;
      if (capturing) badge = 'capture';
      else if (u.cargo && u.cargo.length) badge = 'load';
      else if ((T.fuel && u.fuel <= T.fuel * 0.25) || (T.ammo && u.ammo === 0) || (T.ammo && u.ammo <= Math.floor(T.ammo / 4))) badge = 'low';
      else if (u.dived) badge = 'dive';
      if (badge && (Math.floor(view.time / 700) % 2 === 0 || badge === 'capture')) drawBadge(ctx, badge, dx, dy + 9);
      // Laufende Einnahme deutlich markieren: Fortschrittsbalken über der Einheit in der Teamfarbe
      if (capturing) drawCaptureBar(ctx, dx, dy, (G.RULES.capturePoints - u.cp) / G.RULES.capturePoints, G.FACTIONS[fac].colors, view.time);
    });
    // Vorgeplante Züge (während der Gegner zieht): Pfeil, halbdurchsichtiges Ziel, Angriffsmarke
    if (view.plans) view.plans.forEach(function (pl) {
      var d = pl.path[pl.path.length - 1];
      if (pl.path.length > 1) {
        drawPath(ctx, pl.path, { out: '#0c2a6a', inn: '#8cd0ff', w: 4, dash: [3, 2] });
        ctx.globalAlpha = 0.55;
        ctx.drawImage(R.unitSprite(pl.type, pl.faction, 0, pl.flip, false), d.x * TS, d.y * TS, TS, TS);
        ctx.globalAlpha = 1;
      }
      if (pl.act === 'attack' && pl.tx != null) {
        var ax = pl.tx * TS, ay = pl.ty * TS, bl = Math.floor(view.time / 300) % 2;
        ctx.strokeStyle = bl ? '#ff4030' : '#ffd040'; ctx.lineWidth = 1.5;
        ctx.strokeRect(ax + 1.5, ay + 1.5, TS - 3, TS - 3);
        ctx.beginPath(); ctx.moveTo(ax + 8, ay + 3); ctx.lineTo(ax + 8, ay + 13); ctx.moveTo(ax + 3, ay + 8); ctx.lineTo(ax + 13, ay + 8); ctx.stroke();
      } else if (pl.act === 'capture') drawBadge(ctx, 'capture', d.x * TS + 9, d.y * TS + 1);
      fillRR(ctx, d.x * TS + 1, d.y * TS + 1, 5, 5, 1, '#0c2a6a'); fillRR(ctx, d.x * TS + 2, d.y * TS + 2, 3, 3, 0.6, '#8cd0ff');
    });
    // Erkundung: nie gesehene Felder sind grau/schwarz
    if (view.explored) {
      var ex = view.explored, greyL = view.unexplored !== 'schwarz' ? view.terrainGrey : null;
      for (var ey = y0; ey <= y1; ey++) for (var exx = x0; exx <= x1; exx++) {
        if (ex[ey * map.w + exx]) continue;
        if (greyL) { ctx.drawImage(greyL, exx * TS, ey * TS, TS, TS, exx * TS, ey * TS, TS, TS); continue; }
        rect(ctx, exx * TS, ey * TS, TS, TS, '#05050c');
        if (exx > 0 && ex[ey * map.w + exx - 1]) rect(ctx, exx * TS - 2, ey * TS, 2, TS, 'rgba(5,5,12,0.55)');
        if (ey > 0 && ex[(ey - 1) * map.w + exx]) rect(ctx, exx * TS, ey * TS - 2, TS, 2, 'rgba(5,5,12,0.55)');
      }
    }
    // Nebel-Overlay
    if (vis) {
      ctx.fillStyle = 'rgba(10,12,42,0.45)';
      for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) if (!vis[y * map.w + x]) ctx.fillRect(x * TS, y * TS, TS, TS);
    }
    drawFx(ctx);
    if (view.weather && view.weather !== 'klar') drawWeather(ctx, view, x0, y0, x1, y1);
    // Cursor
    if (view.showCursor && view.cursor) drawCursor(ctx, view.cursor.x, view.cursor.y, view.time, view.cursorMode);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  };

  /** Wetter-Effekte im Kartenraum: Nacht abdunkeln, Regen- und Schneepartikel */
  function drawWeather(ctx, view, x0, y0, x1, y1) {
    var X = x0 * TS, Y = y0 * TS, W = (x1 - x0 + 1) * TS, H = (y1 - y0 + 1) * TS, t = view.time;
    var area = (x1 - x0 + 1) * (y1 - y0 + 1);
    if (view.weather === 'nacht') {
      ctx.fillStyle = 'rgba(6,8,36,0.40)'; ctx.fillRect(X, Y, W, H);
      for (var s = 0; s < area * 0.05; s++) {
        var sx = X + Math.floor(hash(s, 7, 3) * W), sy = Y + Math.floor(hash(s, 9, 5) * H);
        var tx = Math.floor(sx / TS), ty = Math.floor(sy / TS);
        if (!view.game.inBounds(tx, ty) || view.game.map.terrain[ty][tx] !== 'S') continue;
        if ((Math.floor(t / 600) + s) % 5) rect(ctx, sx, sy, 1, 1, 'rgba(255,255,220,0.8)');
      }
    } else if (view.weather === 'regen') {
      ctx.fillStyle = 'rgba(30,48,78,0.18)'; ctx.fillRect(X, Y, W, H);
      ctx.fillStyle = 'rgba(200,215,255,0.55)';
      var n = Math.floor(area * 0.9);
      for (var i = 0; i < n; i++) {
        var px0 = hash(i, 1, 2) * W, py0 = hash(i, 3, 4) * H;
        var sp = 0.18 + hash(i, 5, 6) * 0.08;
        var py = (py0 + t * sp) % H, pxx = (px0 - t * sp * 0.35) % W; if (pxx < 0) pxx += W;
        for (var k = 0; k < 4; k++) ctx.fillRect(Math.floor(X + pxx - k * 0.35), Math.floor(Y + py + k), 1, 1);
      }
    } else if (view.weather === 'schnee') {
      ctx.fillStyle = 'rgba(225,235,255,0.10)'; ctx.fillRect(X, Y, W, H);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      var m = Math.floor(area * 0.5);
      for (var j = 0; j < m; j++) {
        var fx = hash(j, 11, 12) * W, fy = hash(j, 13, 14) * H, v = 0.02 + hash(j, 15, 16) * 0.025;
        var yy = (fy + t * v) % H, xx = fx + Math.sin(t / 700 + j) * 3;
        var sz = hash(j, 17, 18) > 0.7 ? 2 : 1;
        ctx.fillRect(Math.floor(X + ((xx % W) + W) % W), Math.floor(Y + yy), sz, sz);
      }
    }
  }
  /**
   * Feldmenge einheitlich zeichnen: Füllung, optional Schraffur, Kontur nur am Rand der Menge.
   * keys: Feldindizes (y*w+x) als Strings/Zahlen; b: sichtbarer Bereich in Feldern.
   */
  function drawTileSet(ctx, keys, w, b, o) {
    var has = {};
    for (var i = 0; i < keys.length; i++) has[keys[i]] = 1;
    var vis = keys.filter(function (k) { var x = k % w, y = (k - x) / w; return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1; });
    if (!vis.length) return;
    function each(fn) { for (var j = 0; j < vis.length; j++) { var k = +vis[j], x = k % w, y = (k - x) / w; fn(k, x, y); } }
    if (o.fill) { ctx.fillStyle = o.fill; each(function (k, x, y) { ctx.fillRect(x * TS, y * TS, TS, TS); }); }
    if (o.hatch) {
      ctx.save();
      ctx.beginPath(); each(function (k, x, y) { ctx.rect(x * TS, y * TS, TS, TS); }); ctx.clip();
      ctx.strokeStyle = o.hatch; ctx.lineWidth = 1.2;
      var X0 = b.x0 * TS, Y0 = b.y0 * TS, W = (b.x1 - b.x0 + 1) * TS, H = (b.y1 - b.y0 + 1) * TS;
      ctx.beginPath();
      for (var d = -H; d < W; d += 5) { ctx.moveTo(X0 + d, Y0); ctx.lineTo(X0 + d + H, Y0 + H); }
      ctx.stroke();
      ctx.restore();
    }
    if (o.edge) {
      ctx.strokeStyle = o.edge; ctx.lineWidth = o.edgeW || 1; ctx.lineCap = 'square';
      var hw = (o.edgeW || 1) / 2;
      ctx.beginPath();
      each(function (k, x, y) {
        var Lx = x * TS, T = y * TS, Rr = Lx + TS, B = T + TS;
        if (y === 0 || !has[k - w]) { ctx.moveTo(Lx, T + hw); ctx.lineTo(Rr, T + hw); }
        if (!has[k + w]) { ctx.moveTo(Lx, B - hw); ctx.lineTo(Rr, B - hw); }
        if (x === 0 || !has[k - 1]) { ctx.moveTo(Lx + hw, T); ctx.lineTo(Lx + hw, B); }
        if (x === w - 1 || !has[k + 1]) { ctx.moveTo(Rr - hw, T); ctx.lineTo(Rr - hw, B); }
      });
      ctx.stroke();
    }
  }
  R.drawTileSet = drawTileSet;
  /** KP-Anzeige: kleine dunkle Plakette rechts unten mit weißer Zahl */
  function drawHp(ctx, str, dx, dy) {
    var w = str.length > 1 ? 7.4 : 5.6, x = dx + TS - w - 0.6, y = dy + TS - 5.2;
    fillRR(ctx, x, y, w, 4.8, 1.3, 'rgba(18,14,24,0.85)');
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 4.3px "Trebuchet MS", Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(str, x + w / 2, y + 2.55);
  }
  /** Einnahme-Fortschritt (0..1) als Balken mit Fahne über dem Feld (dx, dy = Feld-Ecke in Kartenpixeln) */
  function drawCaptureBar(ctx, dx, dy, frac, cols, time) {
    var blink = 0.75 + 0.25 * Math.sin(time / 220);
    ctx.save();
    ctx.globalAlpha = blink;
    fillRR(ctx, dx + 0.5, dy - 3.8, TS - 1, 4.4, 1.2, 'rgba(0,0,0,0.78)');
    fillRR(ctx, dx + 1.1, dy - 3.2, Math.max(0.8, (TS - 2.2) * frac), 3.2, 0.9, cols[1]);
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fillRect(dx + 1.4, dy - 3.0, Math.max(0.5, (TS - 2.8) * frac), 0.9);
    strokeRR(ctx, dx + 0.6, dy + 0.6, TS - 1.2, TS - 1.2, 1.2, cols[1], 0.9);
    ctx.restore();
  }
  R.drawCaptureBar = drawCaptureBar;
  function drawBadge(ctx, kind, x, y) {
    var ic = R.icon(kind === 'capture' ? 'capture' : kind === 'load' ? 'load' : kind === 'dive' ? 'hidden' : kind === 'low' ? 'fuel' : kind);
    if (ic) { ctx.drawImage(ic, x, y - 1, 8, 8); return; }
    rect(ctx, x, y, 6, 6, '#000');
    var col = kind === 'capture' ? '#f8f8f8' : kind === 'load' ? '#58c8f8' : kind === 'dive' ? '#3870e0' : '#f8c030';
    rect(ctx, x + 1, y + 1, 4, 4, col);
  }
  function drawPath(ctx, path, col) {
    col = col || { out: '#a01818', inn: '#f8b020' };
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = col.out; ctx.lineWidth = col.w || 6;
    ctx.beginPath();
    path.forEach(function (p, i) { var x = p.x * TS + 8, y = p.y * TS + 8; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.stroke();
    ctx.strokeStyle = col.inn; ctx.lineWidth = (col.w || 6) / 2;
    if (col.dash) ctx.setLineDash(col.dash);
    ctx.stroke();
    ctx.setLineDash([]);
    var a = path[path.length - 1], b = path[path.length - 2];
    var dx = a.x - b.x, dy = a.y - b.y, cx = a.x * TS + 8, cy = a.y * TS + 8;
    ctx.fillStyle = col.inn; ctx.strokeStyle = col.out; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx + dx * 6, cy + dy * 6);
    ctx.lineTo(cx - dy * 5 - dx * 1, cy + dx * 5 - dy * 1);
    ctx.lineTo(cx + dy * 5 - dx * 1, cy - dx * 5 - dy * 1);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  function drawCursor(ctx, x, y, time, mode) {
    var o = (Math.floor(time / 250) % 2) * 0.8, ox = x * TS - o, oy = y * TS - o, sz = TS + 2 * o, L = 5;
    var col = mode === 'attack' ? '#ff5a48' : '#ffffff';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    [[ox, oy, 1, 1], [ox + sz, oy, -1, 1], [ox, oy + sz, 1, -1], [ox + sz, oy + sz, -1, -1]].forEach(function (p) {
      ctx.beginPath(); ctx.moveTo(p[0], p[1] + p[3] * L); ctx.lineTo(p[0], p[1]); ctx.lineTo(p[0] + p[2] * L, p[1]);
      ctx.strokeStyle = 'rgba(20,16,24,0.8)'; ctx.lineWidth = 2.6; ctx.stroke();
      ctx.strokeStyle = col; ctx.lineWidth = 1.3; ctx.stroke();
    });
  }

  // ------------------------------------------------------------ Kampfszene (Overlay-Canvas)
  // Ablauf (ms, vor Skalierung): Einfahren -> Angreifer feuert -> Einschläge -> ggf. Gegenschlag -> Ende
  function weaponFx(att, def) {
    var D = G.DAMAGE[att] || {}, prim = !!(D.primary && D.primary[def] != null);
    if (att === 'flame') return 'flame';
    if (att === 'bomber') return 'bomb';
    if (att === 'sub' || (att === 'pboat' && prim)) return 'torpedo';
    if (att === 'arty' || att === 'battleship' || att === 'turret' || att === 'coast') return 'arc';
    if (att === 'rocket' || att === 'missile' || att === 'flak' || (prim && (att === 'mech' || att === 'bcopter' || att === 'gunship'))) return 'rocket';
    if (att === 'aa' || att === 'cruiser' || att === 'carrier') return 'flak';
    if (prim && (att === 'tank' || att === 'mdtank' || att === 'titan' || att === 'fighter')) return att === 'fighter' ? 'rocket' : 'cannon';
    return 'mg';
  }
  R.weaponFx = weaponFx;
  var FLY = { mg: 230, cannon: 260, flak: 240, rocket: 480, arc: 700, bomb: 520, torpedo: 560, flame: 160 };
  /** Zeitplan einer Kampfszene */
  R.battlePlan = function (ev, short) {
    var k = short ? 0.55 : 1;
    var fa = weaponFx(ev.att.type, ev.def.type), fd = weaponFx(ev.def.type, ev.att.type);
    var hasCounter = ev.counter > 0 || ev.att.hp1 < ev.att.hp0;
    var p = { k: k, fxA: fa, fxD: fd, counter: hasCounter, intro: 380 * k };
    p.aFire = 420 * k; p.aFireDur = 420 * k; p.aFly = FLY[fa] * k;
    p.aImp = p.aFire + p.aFly; p.aImpDur = (380 + p.aFireDur / k * 0.6) * k;
    if (hasCounter) {
      p.dFire = p.aImp + p.aImpDur + 260 * k; p.dFireDur = 380 * k; p.dFly = FLY[fd] * k;
      p.dImp = p.dFire + p.dFly; p.dImpDur = (380 + p.dFireDur / k * 0.6) * k;
      p.end = p.dImp + p.dImpDur + 520 * k;
    } else p.end = p.aImp + p.aImpDur + 620 * k;
    return p;
  };
  function ease(t) { t = Math.max(0, Math.min(1, t)); return 1 - Math.pow(1 - t, 3); }
  function clamp01(t) { return Math.max(0, Math.min(1, t)); }
  function unitCount(type, hp) {
    var d = Math.ceil(Math.max(0, hp) / 10);
    if (G.UNITS[type].cls === 'foot') return d;
    return d <= 0 ? 0 : Math.max(1, Math.ceil(d / 3.4));
  }
  /** KP, ab der Einheit Nr. i (0-basiert) verschwunden ist */
  function deathHp(type, i) {
    if (G.UNITS[type].cls === 'foot') return i * 10;
    return Math.floor(i * 3.4) * 10;
  }
  var THEME_HILLS = { sommer: ['#4cae3c', '#2f8a2c'], herbst: ['#c89040', '#9a6424'], winter: ['#dce8f4', '#a8bccc'], gebirge: ['#8c7a62', '#5e5040'] };
  var THEME_GROUND = { sommer: '#6ec84c', herbst: '#b9b85c', winter: '#eef4fa', gebirge: '#a8b876' };
  /** Hintergrund eines Halbbilds */
  function battleBackdrop(ctx, x, y, w, h, side, st, mirror) {
    var theme = st.theme || 'sommer', wx = st.weather || 'klar', t = st.time;
    var night = wx === 'nacht', rain = wx === 'regen', snow = wx === 'schnee' || theme === 'winter';
    var gy = y + Math.floor(h * 0.66);
    // Himmel
    var sky = night ? ['#0a1030', '#24306a'] : rain ? ['#6a7a94', '#a8b6c8'] : snow && wx === 'schnee' ? ['#a8c0dc', '#e4eef8'] : ['#3c8cf0', '#b8e0ff'];
    var g = ctx.createLinearGradient(0, y, 0, gy);
    g.addColorStop(0, sky[0]); g.addColorStop(1, sky[1]);
    ctx.fillStyle = g; ctx.fillRect(x, y, w, gy - y);
    if (night) for (var si = 0; si < 40; si++) {
      var sx = x + hash(si, 3, 1) * w, sy = y + hash(si, 5, 2) * (gy - y) * 0.8;
      ctx.fillStyle = 'rgba(255,255,230,' + (0.4 + 0.5 * Math.abs(Math.sin(t / 400 + si))) + ')'; ctx.fillRect(Math.floor(sx), Math.floor(sy), 2, 2);
    }
    // Wolken (ziehen)
    if (!night) for (var ci = 0; ci < 4; ci++) {
      var cw = 50 + hash(ci, 7, 7) * 50, cxp = x + ((hash(ci, 9, 9) * w + t * (0.008 + ci * 0.004)) % (w + cw)) - cw, cyp = y + 12 + ci * 16;
      ctx.fillStyle = rain ? 'rgba(90,100,120,0.8)' : 'rgba(255,255,255,0.85)';
      ctx.beginPath(); ctx.ellipse(cxp + cw / 2, cyp + 4, cw / 2, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cxp + cw * 0.45, cyp - 3, cw * 0.28, 8, 0, 0, Math.PI * 2); ctx.fill();
    }
    var naval = G.UNITS[side.type].domain === 'sea';
    var ter = naval ? 'S' : side.terrain;
    var hills = THEME_HILLS[theme] || THEME_HILLS.sommer;
    // ferne Hügel
    ctx.fillStyle = night ? '#1c2a3a' : hills[0];
    ctx.beginPath(); ctx.moveTo(x, gy);
    for (var hx = 0; hx <= w; hx += 8) ctx.lineTo(x + hx, gy - 26 - Math.sin((hx + (mirror ? 300 : 0)) / 55) * 14 - Math.sin(hx / 23) * 5);
    ctx.lineTo(x + w, gy); ctx.closePath(); ctx.fill();
    // Gelände-Kulisse
    if (ter === 'M') {
      ctx.fillStyle = night ? '#2a2a3a' : (theme === 'winter' ? '#9aa4b8' : '#a87848');
      ctx.beginPath(); ctx.moveTo(x + w * 0.05, gy); ctx.lineTo(x + w * 0.32, y + h * 0.12); ctx.lineTo(x + w * 0.6, gy); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x + w * 0.4, gy); ctx.lineTo(x + w * 0.72, y + h * 0.2); ctx.lineTo(x + w * 1.05, gy); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.moveTo(x + w * 0.32, y + h * 0.12); ctx.lineTo(x + w * 0.27, y + h * 0.22); ctx.lineTo(x + w * 0.37, y + h * 0.22); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x + w * 0.72, y + h * 0.2); ctx.lineTo(x + w * 0.67, y + h * 0.29); ctx.lineTo(x + w * 0.77, y + h * 0.29); ctx.fill();
    } else if (ter === 'F') {
      for (var ti = 0; ti < 9; ti++) {
        var tx = x + ti * (w / 8) + (mirror ? 10 : 0), tsz = 18 + (ti % 3) * 5;
        ctx.fillStyle = '#5a3a1a'; ctx.fillRect(tx - 2, gy - 14, 5, 14);
        ctx.fillStyle = theme === 'herbst' ? '#c8701c' : theme === 'winter' ? '#2e6450' : '#1e8a2c';
        ctx.beginPath(); ctx.arc(tx, gy - 14 - tsz * 0.6, tsz, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = theme === 'herbst' ? '#f0a838' : theme === 'winter' ? '#f0f8ff' : '#48c040';
        ctx.beginPath(); ctx.arc(tx - tsz * 0.3, gy - 14 - tsz, tsz * 0.45, 0, Math.PI * 2); ctx.fill();
      }
    } else if (G.TERRAIN[ter] && G.TERRAIN[ter].prop) {
      for (var bi = 0; bi < 4; bi++) {
        var bw = 34 + hash(bi, 2, 3) * 26, bh = 40 + hash(bi, 4, 5) * 50, bx = x + 6 + bi * (w / 4);
        ctx.fillStyle = night ? '#2a2c40' : '#8890a8'; ctx.fillRect(bx, gy - bh, bw, bh);
        ctx.fillStyle = night ? '#f8e070' : '#d8e8f8';
        for (var wy = gy - bh + 6; wy < gy - 8; wy += 10) for (var wxp = bx + 5; wxp < bx + bw - 6; wxp += 9) if (!night || hash(wxp, wy, 1) > 0.4) ctx.fillRect(wxp, wy, 4, 5);
      }
    }
    // Boden
    var gc = THEME_GROUND[theme] || THEME_GROUND.sommer;
    var groundCol = { S: '#2d7ce4', X: '#2d7ce4', I: '#3e95ee', H: '#f1dd9c', R: '#d2cab8', B: '#b47c3e', M: '#c09060' }[ter] || gc;
    if (G.TERRAIN[ter] && G.TERRAIN[ter].prop) groundCol = '#c4bfb4';
    if (night) groundCol = shade(groundCol, 0.45); else if (rain) groundCol = shade(groundCol, 0.82);
    var gg = ctx.createLinearGradient(0, gy, 0, y + h);
    gg.addColorStop(0, shade(groundCol, 0.8)); gg.addColorStop(0.15, groundCol); gg.addColorStop(1, shade(groundCol, 0.9));
    ctx.fillStyle = gg; ctx.fillRect(x, gy - 3, w, y + h - gy + 3);
    if (ter === 'S' || ter === 'X') {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      for (var wi = 0; wi < 14; wi++) {
        var wv = x + ((wi * 53 + t * 0.03 * (wi % 2 ? 1 : -1)) % w + w) % w, wyy = gy + 6 + (wi % 4) * 12;
        ctx.beginPath(); ctx.ellipse(wv + 7, wyy, 8, 1.5, 0, 0, Math.PI * 2); ctx.fill();
      }
    } else if (ter === 'R' || ter === 'B') {
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      for (var ri = 0; ri < w; ri += 34) ctx.fillRect(x + ri, gy + 24, 18, 3);
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.07)';
      for (var li = 0; li < 6; li++) ctx.fillRect(x, gy + 6 + li * li * 3, w, 2);
    }
    return gy;
  }
  /** Position der Einheit Nr. i einer Seite (Mittelpunkt) */
  function unitPos(side, i, x, w, gy, h, size, mirror) {
    var T = G.UNITS[side.type], foot = T.cls === 'foot', air = T.domain === 'air';
    var bx, by;
    if (foot) {
      var col = i % 5, row = Math.floor(i / 5), stepF = Math.min(size * 0.78, (w - size * 1.4) / 4.6);
      var spanF = stepF * 4 + size * 0.35;
      bx = (w - spanF) / 2 + col * stepF + row * size * 0.35; by = gy - size * 0.55 - row * size * 0.42 + size * 0.1;
    } else {
      var stepV = Math.min(size * 0.95, (w - size * 1.2) / 2);
      bx = (w - stepV * 2) / 2 + i * stepV; by = gy - size * 0.55 - (i % 2) * size * 0.18 + size * 0.08;
    }
    if (air) by -= h * 0.28;
    if (mirror) bx = w - bx;
    return { x: x + bx, y: by };
  }
  function drawSprite(ctx, type, faction, frame, flip, cx, cy, size) {
    var spr = R.unitSprite(type, faction, frame, flip, false);
    ctx.drawImage(spr, Math.round(cx - size / 2), Math.round(cy - size / 2), Math.round(size), Math.round(size));
  }
  function boom(ctx, cx, cy, r, p) {
    if (p < 0 || p > 1) return;
    var rr2 = r * Math.sin(Math.min(1, p * 1.3) * Math.PI / 1.1 + 0.15);
    var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, rr2));
    g.addColorStop(0, p < 0.35 ? '#ffffff' : '#fff0a0'); g.addColorStop(0.5, p < 0.6 ? '#ffd040' : '#ff9030'); g.addColorStop(1, 'rgba(255,80,20,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, Math.max(1, rr2), 0, Math.PI * 2); ctx.fill();
    for (var k = 0; k < 7; k++) {
      var a = k / 7 * Math.PI * 2 + cx, d = p * r * 1.6;
      ctx.fillStyle = p < 0.6 ? '#ff6020' : 'rgba(70,60,60,' + (1 - p) + ')';
      ctx.beginPath(); ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d - p * 10, 2.2, 0, Math.PI * 2); ctx.fill();
    }
    if (p > 0.4) { ctx.fillStyle = 'rgba(60,60,64,' + (0.6 * (1 - p)) + ')'; ctx.beginPath(); ctx.arc(cx, cy - p * 26, r * 0.7, 0, Math.PI * 2); ctx.fill(); }
  }
  /** Projektil von a nach b, Fortschritt p (0..1) */
  function projectile(ctx, kind, a, b, p, seed, H) {
    if (p < 0 || p > 1) return;
    var x = a.x + (b.x - a.x) * p, y = a.y + (b.y - a.y) * p;
    var dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
    if (kind === 'mg' || kind === 'flak') {
      for (var k = 0; k < (kind === 'flak' ? 4 : 3); k++) {
        var q = clamp01(p - k * 0.12); if (q <= 0 || q >= 1) continue;
        var qx = a.x + dx * q + (kind === 'flak' ? (hash(seed, k, 3) - 0.5) * 20 : 0), qy = a.y + dy * q + (hash(seed, k, 4) - 0.5) * 8;
        ctx.strokeStyle = kind === 'flak' ? '#ffd040' : '#fff8a0'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(qx, qy); ctx.lineTo(qx - ux * 12, qy - uy * 12); ctx.stroke();
      }
    } else if (kind === 'cannon') {
      ctx.fillStyle = '#fff4c0'; ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,220,120,0.6)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - ux * 22, y - uy * 22); ctx.stroke();
    } else if (kind === 'rocket') {
      var ry = y - Math.sin(p * Math.PI) * 18;
      for (var s2 = 1; s2 < 7; s2++) {
        var sp = p - s2 * 0.05; if (sp < 0) break;
        ctx.fillStyle = 'rgba(200,200,210,' + (0.55 - s2 * 0.07) + ')';
        ctx.beginPath(); ctx.arc(a.x + dx * sp, a.y + dy * sp - Math.sin(sp * Math.PI) * 18, 3 + s2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.save(); ctx.translate(x, ry); ctx.rotate(Math.atan2(dy - Math.cos(p * Math.PI) * 18 * Math.PI, dx));
      ctx.fillStyle = '#e8e8f0'; ctx.fillRect(-8, -2, 12, 4); ctx.fillStyle = '#e03020'; ctx.fillRect(4, -2, 3, 4);
      ctx.fillStyle = '#ffb020'; ctx.fillRect(-12, -1, 4, 2); ctx.restore();
    } else if (kind === 'arc') {
      var ay = y - Math.sin(p * Math.PI) * H * 0.45;
      ctx.fillStyle = '#303038'; ctx.beginPath(); ctx.arc(x, ay, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffe080'; ctx.fillRect(x - 1, ay - 1, 2, 2);
    } else if (kind === 'bomb') {
      var bx2 = b.x + (hash(seed, 1, 1) - 0.5) * 20, by0 = b.y - H * 0.6;
      var byy = by0 + (b.y - by0) * p * p;
      ctx.fillStyle = '#383840'; ctx.fillRect(bx2 - 3, byy - 6, 6, 11); ctx.fillStyle = '#e03020'; ctx.fillRect(bx2 - 3, byy - 8, 6, 3);
    } else if (kind === 'torpedo') {
      ctx.fillStyle = '#d0d8e0'; ctx.fillRect(x - 8, y + 10, 14, 3);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      for (var bb = 1; bb < 5; bb++) ctx.fillRect(x - ux * bb * 10, y + 8 - bb, 3, 3);
    } else if (kind === 'flame') {
      var reach = p;
      for (var f = 0; f < 10; f++) {
        var fp = reach * f / 10;
        ctx.fillStyle = f < 3 ? 'rgba(255,255,200,0.9)' : f < 6 ? 'rgba(255,170,40,0.85)' : 'rgba(255,80,20,0.7)';
        ctx.beginPath(); ctx.arc(a.x + dx * fp, a.y + dy * fp + Math.sin(f + seed) * 3, 4 + f * 1.5, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  /**
   * Zeichnet die Kampfszene. st: { ev, plan, t (ms seit Start), time, att:{type,faction,terrain}, def:{...}, theme, weather }
   */
  R.drawBattle = function (ctx, W, H, st) {
    var ev = st.ev, P = st.plan, t = st.t;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    var half = Math.floor(W / 2);
    var sizeFoot = Math.max(32, Math.floor(Math.min(half / 5.2, H / 4.2) / 16) * 16);
    var sizeVeh = Math.max(48, Math.floor(Math.min(half / 3.4, H / 3) / 16) * 16);
    var hpAtt = ev.att.hp0, hpDef = ev.def.hp0;
    var dImpP = clamp01((t - P.aImp) / P.aImpDur);
    hpDef = ev.def.hp0 + (ev.def.hp1 - ev.def.hp0) * dImpP;
    if (P.counter) hpAtt = ev.att.hp0 + (ev.att.hp1 - ev.att.hp0) * clamp01((t - P.dImp) / P.dImpDur);
    var sides = [
      { key: 'att', s: st.att, ev: ev.att, hp: hpAtt, x: 0, w: half, mirror: false, fire: P.aFire, fireDur: P.aFireDur, fly: P.aFly, fx: P.fxA,
        imp: P.counter ? P.dImp : 1e9, impDur: P.counter ? P.dImpDur : 1 },
      { key: 'def', s: st.def, ev: ev.def, hp: hpDef, x: half, w: W - half, mirror: true, fire: P.counter ? P.dFire : 1e9, fireDur: P.dFireDur || 1, fly: P.dFly || 1, fx: P.fxD,
        imp: P.aImp, impDur: P.aImpDur }
    ];
    var intro = ease(t / P.intro);
    sides.forEach(function (sd, si) {
      var T = G.UNITS[sd.s.type], size = T.cls === 'foot' ? sizeFoot : sizeVeh;
      sd.size = size;
      var shakeOn = t > sd.imp && t < sd.imp + sd.impDur + 120;
      var shake = shakeOn ? Math.round(Math.sin(t / 22) * 3) : 0;
      ctx.save();
      ctx.beginPath(); ctx.rect(sd.x, 0, sd.w, H); ctx.clip();
      ctx.translate(shake, Math.round(Math.cos(t / 31) * (shakeOn ? 2 : 0)));
      var gy = battleBackdrop(ctx, sd.x, 0, sd.w, H - 34, sd.s, st, sd.mirror);
      sd.gy = gy;
      var slide = (1 - intro) * sd.w * 0.75 * (sd.mirror ? 1 : -1);
      var n0 = unitCount(sd.s.type, sd.ev.hp0), nNow = unitCount(sd.s.type, sd.hp);
      var alive = [];
      for (var i = 0; i < n0; i++) {
        var pos = unitPos(sd.s, i, sd.x, sd.w, gy, H - 34, size, sd.mirror);
        pos.x += slide;
        var air = T.domain === 'air';
        if (air) pos.y += Math.sin(st.time / 180 + i) * 3;
        if (i >= nNow) {
          var thr = deathHp(sd.s.type, i), td = sd.imp + (sd.ev.hp0 - thr) / Math.max(1, sd.ev.hp0 - sd.ev.hp1) * sd.impDur;
          var dp = (t - td) / 520;
          if (dp < 0) dp = 0;
          if (dp < 1) {
            if (T.cls === 'foot') {
              ctx.save(); ctx.globalAlpha = 1 - dp; ctx.translate(pos.x, pos.y + dp * 10);
              ctx.rotate((sd.mirror ? 1 : -1) * dp * 1.4);
              drawSprite(ctx, sd.s.type, sd.s.faction, 0, sd.mirror, 0, 0, size); ctx.restore();
              boom(ctx, pos.x, pos.y, size * 0.25, dp);
            } else {
              if (dp < 0.3) drawSprite(ctx, sd.s.type, sd.s.faction, 0, sd.mirror, pos.x, pos.y, size);
              boom(ctx, pos.x, pos.y, size * 0.6, dp);
            }
          }
          continue;
        }
        var myShot = sd.fire + (i / Math.max(1, nNow)) * sd.fireDur;
        var recoil = (t > myShot && t < myShot + 120) ? (sd.mirror ? 3 : -3) : 0;
        if (!air && T.domain !== 'sea') {
          ctx.fillStyle = 'rgba(0,0,0,0.22)';
          ctx.beginPath(); ctx.ellipse(pos.x, gy + 2 - (T.cls === 'foot' ? size * 0.05 : 0), size * 0.35, size * 0.08, 0, 0, Math.PI * 2); ctx.fill();
        }
        var walking = intro < 1 || (T.cls === 'foot' && Math.abs(slide) > 1);
        var frame = walking ? Math.floor(st.time / 110 + i) % 2 : Math.floor(st.time / 300 + i) % 2;
        drawSprite(ctx, sd.s.type, sd.s.faction, frame, sd.mirror, pos.x + recoil, pos.y, size);
        alive.push({ i: i, pos: pos, shot: myShot });
        if (t > myShot && t < myShot + 110 && sd.fx !== 'flame') {
          var mx = pos.x + (sd.mirror ? -size * 0.48 : size * 0.48), my = pos.y - size * 0.08;
          ctx.fillStyle = '#fff6b0'; ctx.beginPath(); ctx.arc(mx, my, size * 0.12, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#ff9020'; ctx.beginPath(); ctx.arc(mx, my, size * 0.06, 0, Math.PI * 2); ctx.fill();
        }
      }
      sd.alive = alive;
      if (st.weather === 'regen') { ctx.strokeStyle = 'rgba(210,225,255,0.5)'; ctx.lineWidth = 1; for (var r2 = 0; r2 < 50; r2++) { var rx = sd.x + ((hash(r2, 1, si) * sd.w + st.time * 0.1) % sd.w), ry = (hash(r2, 2, si) * H + st.time * 0.5) % (H - 34); ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx - 3, ry + 9); ctx.stroke(); } }
      if (st.weather === 'schnee') { ctx.fillStyle = 'rgba(255,255,255,0.9)'; for (var s3 = 0; s3 < 45; s3++) { var fx = sd.x + ((hash(s3, 3, si) * sd.w + Math.sin(st.time / 600 + s3) * 8) % sd.w), fy = (hash(s3, 4, si) * H + st.time * 0.04) % (H - 34); ctx.fillRect(fx, fy, 2, 2); } }
      if (st.weather === 'nacht') { ctx.fillStyle = 'rgba(5,8,30,0.25)'; ctx.fillRect(sd.x, 0, sd.w, H - 34); }
      ctx.restore();
    });
    // Projektile und Einschläge (über die Mittellinie hinweg)
    sides.forEach(function (sd, si) {
      var other = sides[1 - si];
      if (!other.alive || !other.alive.length) other.alive = [{ pos: { x: other.x + other.w / 2, y: other.gy - 30 } }];
      (sd.alive || []).forEach(function (a, k) {
        var tg = other.alive[k % other.alive.length].pos;
        var from = { x: a.pos.x + (sd.mirror ? -sd.size * 0.48 : sd.size * 0.48), y: a.pos.y - sd.size * 0.08 };
        var to = { x: tg.x + (hash(k, si, 7) - 0.5) * 16, y: tg.y + (hash(k, si, 8) - 0.5) * 10 };
        var p = (t - a.shot) / sd.fly;
        projectile(ctx, sd.fx, from, to, p, k + si * 13, H);
        if (p >= 1 && p < 1 + 300 / sd.fly) {
          var ip = (p - 1) * sd.fly / 300;
          if (sd.fx === 'mg' || sd.fx === 'flak') { ctx.fillStyle = 'rgba(255,240,180,' + (1 - ip) + ')'; ctx.fillRect(to.x - 3 + ip * 6, to.y - 3, 4, 4); ctx.fillRect(to.x + 4, to.y + 2 - ip * 6, 3, 3); }
          else boom(ctx, to.x, to.y, sd.fx === 'arc' || sd.fx === 'bomb' ? 22 : 15, ip);
        }
      });
    });
    // Mittellinie und Info-Leisten
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(half - 2, 0, 4, H); ctx.fillStyle = '#ffffff'; ctx.fillRect(half - 1, 0, 2, H - 34);
    sides.forEach(function (sd) {
      var T = G.UNITS[sd.s.type], fc = G.FACTIONS[sd.s.faction].colors, y = H - 34;
      var gr = ctx.createLinearGradient(0, y, 0, H);
      gr.addColorStop(0, fc[1]); gr.addColorStop(1, fc[2]);
      ctx.fillStyle = fc[3]; ctx.fillRect(sd.x, y, sd.w, 34);
      ctx.fillStyle = gr; ctx.fillRect(sd.x + 2, y + 3, sd.w - 4, 29);
      ctx.fillStyle = 'rgba(255,255,255,0.16)'; ctx.fillRect(sd.x + 2, y + 3, sd.w - 4, 10);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 15px "Trebuchet MS", sans-serif'; ctx.textAlign = sd.mirror ? 'right' : 'left'; ctx.textBaseline = 'alphabetic';
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 3;
      ctx.strokeText(T.name, sd.mirror ? sd.x + sd.w - 10 : sd.x + 10, y + 23); ctx.fillText(T.name, sd.mirror ? sd.x + sd.w - 10 : sd.x + 10, y + 23);
      var bw = Math.min(150, sd.w * 0.42), bx = sd.mirror ? sd.x + 10 : sd.x + sd.w - bw - 10;
      ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(bx, y + 9, bw, 16);
      ctx.fillStyle = sd.hp > 50 ? '#40e040' : sd.hp > 20 ? '#ffd020' : '#ff3820';
      ctx.fillRect(bx + 2, y + 11, Math.max(0, (bw - 4) * sd.hp / 100), 12);
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = 'bold 13px monospace';
      ctx.strokeText(Math.ceil(sd.hp / 10) + ' KP', bx + bw / 2, y + 22); ctx.fillText(Math.ceil(sd.hp / 10) + ' KP', bx + bw / 2, y + 22);
    });
  };
})();
