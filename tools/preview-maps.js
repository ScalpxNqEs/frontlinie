#!/usr/bin/env node
// Rendert alle Karten aus js/maps.js als PNG-Übersicht: node tools/preview-maps.js [out.png] [px pro Feld]
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const load = require('./load');
const G = load();
const out = process.argv[2] || path.join(__dirname, 'maps-preview.png');
const S = +(process.argv[3] || 4);
const COL = { P: [136, 208, 112], F: [47, 138, 52], M: [160, 120, 72], R: [216, 208, 184], B: [176, 120, 64], I: [72, 144, 240],
  S: [48, 96, 200], H: [240, 216, 144], X: [90, 106, 138] };
const OWN = [[240, 240, 240], [224, 48, 32], [48, 112, 224], [64, 176, 48], [224, 176, 32]];
const maps = G.MAPS;
const pad = 8, cols = 4;
const cellW = Math.max(...maps.map(m => m.rows[0].length / 2)) * S + pad, cellH = Math.max(...maps.map(m => m.rows.length)) * S + pad;
const W = cols * cellW + pad, H = Math.ceil(maps.length / cols) * cellH + pad;
const img = Buffer.alloc(W * H * 3, 20);
function px(x, y, c) { if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 3; img[i] = c[0]; img[i + 1] = c[1]; img[i + 2] = c[2]; }
maps.forEach((m, k) => {
  const ox = pad + (k % cols) * cellW, oy = pad + Math.floor(k / cols) * cellH;
  m.rows.forEach((r, y) => { for (let x = 0; x < r.length / 2; x++) {
    const t = r[x * 2], o = r[x * 2 + 1];
    let c = COL[t];
    const bld = 'CKAOQ'.indexOf(t) >= 0;
    if (bld) c = OWN[o === '.' ? 0 : +o];
    for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) {
      let cc = c;
      if (bld && (dx === 0 || dy === 0)) cc = [0, 0, 0];
      if (t === 'Q' && dx > 0 && dy > 0 && dx < S - 1 && dy < S - 1 && (dx + dy) % 2) cc = [255, 255, 0];
      if (t === 'K' && dy === S - 1) cc = [0, 0, 0];
      px(ox + x * S + dx, oy + y * S + dy, cc);
    }
  } });
});
// PNG
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; img.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3); }
function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
fs.writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log('geschrieben: ' + out + ' (' + W + '×' + H + ')');
