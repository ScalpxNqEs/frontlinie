// Rendert ein PNG-Kontaktblatt aller Sprites (Teamfarbe Rot, 4-fach) nach tools/sprites-preview.png.
// Reiner PNG-Encoder über zlib, keine npm-Pakete. Aufruf: node tools/preview-sprites.js [out.png] [faction]
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { loadSprites } = require('./check-sprites');

const FACTIONS = {
  red: ['#f87858', '#e03020', '#a01810', '#580808'],
  blue: ['#78b0f8', '#3070e0', '#1840a0', '#0c2058'],
  green: ['#88e060', '#40b030', '#207018', '#0c4008'],
  yellow: ['#f8e070', '#e0b020', '#a07810', '#584008'],
  neutral: ['#f0f0f0', '#b8b8c0', '#787880', '#383840']
};
const out = process.argv[2] || path.join(__dirname, 'sprites-preview.png');
const team = FACTIONS[process.argv[3] || 'red'];
const SC = 4;

const G = loadSprites();
const S = G.SPRITES, PAL = G.SPRITE_PALETTE;
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

const W = 1400, H = 750;
const img = Buffer.alloc(W * H * 3);
function fill(x, y, w, h, c) {
  for (let j = Math.max(0, y); j < Math.min(H, y + h); j++)
    for (let i = Math.max(0, x); i < Math.min(W, x + w); i++) { const o = (j * W + i) * 3; img[o] = c[0]; img[o + 1] = c[1]; img[o + 2] = c[2]; }
}
function draw(rows, x, y, cols, bg) {
  const h = rows.length, w = rows[0].length;
  if (bg) fill(x, y, w * SC, h * SC, bg);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const ch = rows[j][i];
    if (ch === '.') continue;
    const c = (ch >= '1' && ch <= '4') ? hex(cols[ch.charCodeAt(0) - 49]) : PAL[ch] ? hex(PAL[ch]) : [255, 0, 255];
    fill(x + i * SC, y + j * SC, SC, SC, c);
  }
}
fill(0, 0, W, H, [48, 48, 64]);
const plain = [136, 192, 112], sea = [64, 120, 200], sky = [150, 200, 240], panel = [40, 48, 72];
const air = ['tcopter', 'bcopter', 'fighter', 'bomber'], ship = ['lander', 'cruiser', 'sub', 'battleship'];
// Einheiten: je Einheit Frame 1 + Frame 2, 5 Einheiten pro Zeile
const ids = Object.keys(S.units);
ids.forEach((id, n) => {
  const x = 10 + (n % 5) * 276, y = 10 + Math.floor(n / 5) * 74;
  const bg = air.includes(id) ? sky : ship.includes(id) ? sea : plain;
  S.units[id].frames.forEach((f, k) => draw(f, x + k * 68, y, team, bg));
  // gespiegelt (Blick nach links) klein daneben, wie im Spiel
  draw(S.units[id].frames[0].map(r => r.split('').reverse().join('')), x + 136, y, team, bg);
});
// Gebäude: Teamfarbe und neutral
let y0 = 10 + 4 * 74 + 10;
Object.keys(S.buildings).forEach((id, n) => {
  draw(S.buildings[id], 10 + n * 140, y0, team, plain);
  draw(S.buildings[id], 10 + n * 140 + 68, y0, FACTIONS.neutral, plain);
});
// Icons
y0 += 74;
Object.keys(S.icons).forEach((id, n) => draw(S.icons[id], 10 + n * 74, y0, FACTIONS.neutral, [96, 96, 112]));
// Porträts
y0 += 74;
const fac = { rika: 'red', bastian: 'blue', jara: 'green', viktor: 'yellow', fortuna: 'yellow', mira: 'red', ole: 'blue', kurt: 'red', greta: 'green', kraehe: 'yellow' };
Object.keys(S.portraits).forEach((id, n) => {
  const x = 10 + (n % 5) * 270, y = y0 + Math.floor(n / 5) * 138;
  draw(S.portraits[id], x, y, team, panel);
  // Fraktionsfarbe in 1x-ähnlich kleiner Größe (2x) daneben
  draw(S.portraits[id], x + 130, y, FACTIONS[fac[id] || 'red'], panel);
});

// PNG schreiben
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
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
fs.writeFileSync(out, Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
]));
console.log('geschrieben: ' + out);
