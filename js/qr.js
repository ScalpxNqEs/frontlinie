// FRONTLINIE – kleiner QR-Code-Erzeuger (Byte-Modus, Fehlerkorrektur M, Version 1–15), offline
var G = (typeof globalThis !== 'undefined' ? globalThis : window).G = (globalThis.G || {});
(function () {
  'use strict';
  // Version → [EC-Codewörter je Block, Blöcke Gruppe 1, Daten je Block G1, Blöcke G2, Daten je Block G2] (Stufe M)
  var EC_M = [null, [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0], [24, 2, 43, 0, 0],
    [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44],
    [30, 1, 50, 4, 51], [22, 6, 36, 2, 37], [22, 8, 37, 1, 38], [24, 4, 40, 5, 41], [24, 5, 41, 5, 42]];
  var ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
    [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70]];

  function gfMul(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; }
    return z;
  }
  function rsDivisor(deg) {
    var d = []; for (var i = 0; i < deg; i++) d.push(0);
    d[deg - 1] = 1;
    var root = 1;
    for (i = 0; i < deg; i++) {
      for (var j = 0; j < d.length; j++) { d[j] = gfMul(d[j], root); if (j + 1 < d.length) d[j] ^= d[j + 1]; }
      root = gfMul(root, 2);
    }
    return d;
  }
  function rsRemainder(data, div) {
    var res = div.map(function () { return 0; });
    data.forEach(function (b) {
      var f = b ^ res.shift(); res.push(0);
      div.forEach(function (c, i) { res[i] ^= gfMul(c, f); });
    });
    return res;
  }
  function utf8(s) {
    var out = [];
    var e = unescape(encodeURIComponent(s));
    for (var i = 0; i < e.length; i++) out.push(e.charCodeAt(i));
    return out;
  }

  function encode(text) {
    var bytes = utf8(text), ver = 0, info;
    for (var v = 1; v <= 15; v++) {
      info = EC_M[v];
      var cap = info[1] * info[2] + info[3] * info[4];
      if (4 + (v < 10 ? 8 : 16) + bytes.length * 8 <= cap * 8) { ver = v; break; }
    }
    if (!ver) throw new Error('Text zu lang für QR-Code');
    info = EC_M[ver];
    var dataCw = info[1] * info[2] + info[3] * info[4];
    // Bitstrom
    var bits = [];
    function put(val, n) { for (var i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); }
    put(4, 4); put(bytes.length, ver < 10 ? 8 : 16);
    bytes.forEach(function (b) { put(b, 8); });
    put(0, Math.min(4, dataCw * 8 - bits.length));
    while (bits.length % 8) bits.push(0);
    var cw = [];
    for (var i = 0; i < bits.length; i += 8) { var b = 0; for (var k = 0; k < 8; k++) b = (b << 1) | bits[i + k]; cw.push(b); }
    for (var pad = 0xEC; cw.length < dataCw; pad ^= 0xEC ^ 0x11) cw.push(pad);
    // Blöcke + Fehlerkorrektur, verschränkt
    var blocks = [], pos = 0, div = rsDivisor(info[0]);
    for (i = 0; i < info[1] + info[3]; i++) {
      var len = i < info[1] ? info[2] : info[4];
      var d = cw.slice(pos, pos + len); pos += len;
      blocks.push({ d: d, e: rsRemainder(d, div) });
    }
    var all = [], maxD = Math.max(info[2], info[4]);
    for (i = 0; i < maxD; i++) blocks.forEach(function (bl) { if (i < bl.d.length) all.push(bl.d[i]); });
    for (i = 0; i < info[0]; i++) blocks.forEach(function (bl) { all.push(bl.e[i]); });

    var size = ver * 4 + 17;
    var mod = [], fn = [];
    for (var y = 0; y < size; y++) { mod.push(new Array(size).fill(false)); fn.push(new Array(size).fill(false)); }
    function setF(x, y, dark) { mod[y][x] = dark; fn[y][x] = true; }
    // Zeitmuster
    for (i = 0; i < size; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
    // Suchmuster
    [[3, 3], [size - 4, 3], [3, size - 4]].forEach(function (c) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var dist = Math.max(Math.abs(dx), Math.abs(dy)), xx = c[0] + dx, yy = c[1] + dy;
        if (xx >= 0 && yy >= 0 && xx < size && yy < size) setF(xx, yy, dist !== 2 && dist !== 4);
      }
    });
    // Ausrichtungsmuster
    var al = ALIGN[ver];
    al.forEach(function (ay, ia) {
      al.forEach(function (ax, ib) {
        if ((ia === 0 && ib === 0) || (ia === 0 && ib === al.length - 1) || (ia === al.length - 1 && ib === 0)) return;
        for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) setF(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      });
    });
    function drawFormat(mask) {
      var data = (0 << 3) | mask, rem = data; // Stufe M = 00
      for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      var fb = ((data << 10) | rem) ^ 0x5412;
      function bit(i) { return ((fb >>> i) & 1) !== 0; }
      for (i = 0; i <= 5; i++) setF(8, i, bit(i));
      setF(8, 7, bit(6)); setF(8, 8, bit(7)); setF(7, 8, bit(8));
      for (i = 9; i < 15; i++) setF(14 - i, 8, bit(i));
      for (i = 0; i < 8; i++) setF(size - 1 - i, 8, bit(i));
      for (i = 8; i < 15; i++) setF(8, size - 15 + i, bit(i));
      setF(8, size - 8, true);
    }
    drawFormat(0);
    if (ver >= 7) {
      var rem = ver;
      for (i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      var vb = (ver << 12) | rem;
      for (i = 0; i < 18; i++) {
        var c = ((vb >>> i) & 1) !== 0, a = size - 11 + i % 3, bb = Math.floor(i / 3);
        setF(a, bb, c); setF(bb, a, c);
      }
    }
    // Daten platzieren
    var bi = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) for (var j = 0; j < 2; j++) {
        var x = right - j, up = ((right + 1) & 2) === 0, yy = up ? size - 1 - vert : vert;
        if (!fn[yy][x] && bi < all.length * 8) { mod[yy][x] = ((all[bi >>> 3] >>> (7 - (bi & 7))) & 1) !== 0; bi++; }
      }
    }
    // Maske mit geringster Strafe wählen
    function maskFn(m, x, y) {
      switch (m) {
        case 0: return (x + y) % 2 === 0;
        case 1: return y % 2 === 0;
        case 2: return x % 3 === 0;
        case 3: return (x + y) % 3 === 0;
        case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
        case 5: return x * y % 2 + x * y % 3 === 0;
        case 6: return (x * y % 2 + x * y % 3) % 2 === 0;
        default: return ((x + y) % 2 + x * y % 3) % 2 === 0;
      }
    }
    function applyMask(m) {
      for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) if (!fn[y][x] && maskFn(m, x, y)) mod[y][x] = !mod[y][x];
    }
    function penalty() {
      var p = 0, dark = 0, x, y;
      for (y = 0; y < size; y++) {
        var runC = null, run = 0, runC2 = null, run2 = 0;
        for (x = 0; x < size; x++) {
          if (mod[y][x]) dark++;
          if (mod[y][x] === runC) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else { runC = mod[y][x]; run = 1; }
          if (mod[x][y] === runC2) { run2++; if (run2 === 5) p += 3; else if (run2 > 5) p++; } else { runC2 = mod[x][y]; run2 = 1; }
        }
      }
      for (y = 0; y < size - 1; y++) for (x = 0; x < size - 1; x++) {
        var c = mod[y][x];
        if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) p += 3;
      }
      var pat = [true, false, true, true, true, false, true, false, false, false, false];
      var pat2 = pat.slice().reverse();
      for (y = 0; y < size; y++) for (x = 0; x <= size - 11; x++) {
        var h1 = true, h2 = true, v1 = true, v2 = true;
        for (var k = 0; k < 11; k++) {
          if (mod[y][x + k] !== pat[k]) h1 = false;
          if (mod[y][x + k] !== pat2[k]) h2 = false;
          if (mod[x + k][y] !== pat[k]) v1 = false;
          if (mod[x + k][y] !== pat2[k]) v2 = false;
        }
        p += 40 * ((h1 ? 1 : 0) + (h2 ? 1 : 0) + (v1 ? 1 : 0) + (v2 ? 1 : 0));
      }
      var total = size * size;
      p += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
      return p;
    }
    var best = 0, bestP = Infinity;
    for (var m = 0; m < 8; m++) {
      applyMask(m); drawFormat(m);
      var pp = penalty();
      if (pp < bestP) { bestP = pp; best = m; }
      applyMask(m);
    }
    applyMask(best); drawFormat(best);
    return { size: size, version: ver, mask: best, modules: mod };
  }

  /** QR-Code als Canvas (mit Ruhezone) */
  function toCanvas(text, scale) {
    var q = encode(text), s = scale || 6, quiet = 4;
    var c = document.createElement('canvas');
    c.width = c.height = (q.size + quiet * 2) * s;
    var x2 = c.getContext('2d');
    x2.fillStyle = '#ffffff'; x2.fillRect(0, 0, c.width, c.height);
    x2.fillStyle = '#000000';
    for (var y = 0; y < q.size; y++) for (var x = 0; x < q.size; x++) if (q.modules[y][x]) x2.fillRect((x + quiet) * s, (y + quiet) * s, s, s);
    return c;
  }
  G.QR = { encode: encode, canvas: toCanvas };
})();
