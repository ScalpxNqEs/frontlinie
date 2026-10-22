// Kontaktblatt der neuen Einheiten aus js/sprites-extra.js neben vorhandenen Einheiten zum Vergleich.
// Je Zeile: neue Einheit (Rot F1/F2, Blau F1/F2, 4-fach, dann 1-fach Rot + Blau gespiegelt)
// | Vergleichseinheit aus sprites.js (gleiches Schema).
// Aufruf: node tools/preview-sprites-extra.js [out.png]   (Standard: tools/sprites-extra-preview.png)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { loadAll } = require('./check-sprites-extra');

const out = process.argv[2] || path.join(__dirname, 'sprites-extra-preview.png');
const RED = ['#f87858', '#e03020', '#a01810', '#580808'];
const BLUE = ['#78b0f8', '#3070e0', '#1840a0', '#0c2058'];
const SC = 4, T = 16 * SC;

// neue Einheit -> [Bereich, Vergleichseinheit]
const ROWS = [
  ['moto', 'ground', 'recon'],
  ['flame', 'ground', 'tank'],
  ['pionier', 'ground', 'inf'],
  ['bergepanzer', 'ground', 'apc'],
  ['drone', 'air', 'fighter'],
  ['gunship', 'air', 'bomber'],
  ['airlift', 'air', 'tcopter'],
  ['pboat', 'sea', 'lander'],
  ['carrier', 'sea', 'battleship'],
  ['bunker', 'ground', 'mdtank'],
  ['turret', 'ground', 'tank'],
  ['flak', 'ground', 'aa'],
  ['coast', 'ground', 'arty']
];
const AREA = { ground: [136, 192, 112], air: [150, 200, 240], sea: [64, 120, 200] };
const AREA_OF = { recon: 'ground', tank: 'ground', inf: 'ground', apc: 'ground', mdtank: 'ground', arty: 'ground', aa: 'ground',
  fighter: 'air', bomber: 'air', tcopter: 'air', lander: 'sea', battleship: 'sea', cruiser: 'sea' };

// 3x5-Pixelschrift für Beschriftungen
const FONT = {
  a: '010101111101101', b: '110101110101110', c: '011100100100011', d: '110101101101110', e: '111100110100111',
  f: '111100110100100', g: '011100101101011', h: '101101111101101', i: '111010010010111', j: '001001001101010',
  k: '101101110101101', l: '100100100100111', m: '101111111101101', n: '110101101101101', o: '010101101101010',
  p: '110101110100100', q: '010101101110011', r: '110101110101101', s: '011100010001110', t: '111010010010010',
  u: '101101101101111', v: '101101101101010', w: '101101111111101', x: '101101010101101', y: '101101010010010',
  z: '111001010100111', '1': '010110010010111', '2': '110001010100111', ' ': '000000000000000', '-': '000000111000000',
  '/': '001001010100100', '|': '010010010010010', '4': '101101111001001'
};

const { G } = loadAll();
const U = G.SPRITES.units, PAL = G.SPRITE_PALETTE;
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

const CELL = 4 * (T + 4) + 16 + 2 * 20; // 4 Kacheln + 1-fach-Paar
const LABEL = 110;
const W = 10 + LABEL + CELL + 30 + LABEL + CELL + 10;
const H = 40 + ROWS.length * (T + 10) + 10;
const img = Buffer.alloc(W * H * 3);
function fill(x, y, w, h, c) {
  for (let j = Math.max(0, y); j < Math.min(H, y + h); j++)
    for (let i = Math.max(0, x); i < Math.min(W, x + w); i++) { const o = (j * W + i) * 3; img[o] = c[0]; img[o + 1] = c[1]; img[o + 2] = c[2]; }
}
function draw(rows, x, y, cols, bg, sc, flip) {
  if (bg) fill(x, y, 16 * sc, 16 * sc, bg);
  for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) {
    const ch = rows[j][flip ? 15 - i : i];
    if (ch === '.') continue;
    const c = (ch >= '1' && ch <= '4') ? hex(cols[ch.charCodeAt(0) - 49]) : PAL[ch] ? hex(PAL[ch]) : [255, 0, 255];
    fill(x + i * sc, y + j * sc, sc, sc, c);
  }
}
function text(s, x, y, c, sc) {
  for (const ch of s.toLowerCase()) {
    const g = FONT[ch] || FONT[' '];
    for (let j = 0; j < 5; j++) for (let i = 0; i < 3; i++) if (g[j * 3 + i] === '1') fill(x + i * sc, y + j * sc, sc, sc, c);
    x += 4 * sc;
  }
}
function cell(id, x, y, area) {
  const bg = AREA[area];
  const f = U[id].frames;
  draw(f[0], x, y, RED, bg, SC); draw(f[1], x + (T + 4), y, RED, bg, SC);
  draw(f[0], x + 2 * (T + 4), y, BLUE, bg, SC); draw(f[1], x + 3 * (T + 4), y, BLUE, bg, SC);
  const sx = x + 4 * (T + 4) + 8;
  draw(f[0], sx, y + 8, RED, bg, 1); draw(f[0], sx + 20, y + 8, BLUE, bg, 1, true);
  draw(f[1], sx, y + 30, RED, bg, 1); draw(f[1], sx + 20, y + 30, BLUE, bg, 1, true);
}

fill(0, 0, W, H, [48, 48, 64]);
const xNew = 10 + LABEL, xCmpLabel = xNew + CELL + 30, xCmp = xCmpLabel + LABEL;
text('neu  rot f1 f2  blau f1 f2  1x', xNew, 14, [230, 230, 240], 2);
text('vergleich', xCmp, 14, [180, 180, 200], 2);
ROWS.forEach(([id, area, cmp], n) => {
  const y = 40 + n * (T + 10);
  text(id, 10, y + 26, [240, 240, 250], 2);
  cell(id, xNew, y, area);
  text(cmp, xCmpLabel, y + 26, [170, 170, 190], 2);
  cell(cmp, xCmp, y, AREA_OF[cmp]);
});

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; img.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3); }
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
fs.writeFileSync(out, Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
]));
console.log('geschrieben: ' + out + ` (${W}x${H})`);
