// Erzeugt die App-Symbole (PNG) für die Handy-App: node tools/make-icons.js
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');
// 24×24 Pixelbild: Panzer in Signalorange auf dunklem Oliv (Himmel = Oliv, Wolken = Khaki-Schatten)
const ART = [
  'SSSSSSSSSSSSSSSSSSSSSSSS',
  'SSSSSSSSSSSSSSSSSSSSSSSS',
  'SSSSSSWWWSSSSSSSSSSSSSSS',
  'SSSSSWWWWWSSSSSSSSWWSSSS',
  'SSSSSSSSSSSSSSSSSWWWWSSS',
  'SSSSSSSSSSSSSSSSSSSSSSSS',
  'SSSSSSSSSSSSSSSSSSSSSSSS',
  'SSSSSSSSSSSSSSSSSSSSSSSS',
  'SSSSSSSSSKKKKKKSSSSSSSSS',
  'SSSSSSSSKrrrrrrKSSSSSSSS',
  'SSSSSSSKrRRRRRRrKKKKKKKK',
  'SSSSSSSKrRRRRRRrkkkkkkkK',
  'SSSSSSSKRRRRRRRRKKKKKKKK',
  'SSSKKKKKKKKKKKKKKKKKKSSS',
  'SSKrrrrrrrrrrrrrrrrrrKSS',
  'SKrRRRRRRRRRRRRRRRRRRRKS',
  'GKRRRRRRRRRRRRRRRRRRRRKG',
  'GKddddddddddddddddddddKG',
  'GKdKKdKKdKKdKKdKKdKKddKG',
  'GKddddddddddddddddddddKG',
  'GGKKKKKKKKKKKKKKKKKKKKGG',
  'GGGgGGGGGgGGGGGGgGGGGgGG',
  'GgGGGGgGGGGGgGGGGGGgGGGG',
  'GGGGGGGGGGGGGGGGGGGGGGGG'
];
// Farben im Feldkommando-Stil der Oberfläche: Oliv, Khaki, Signalorange, Creme
const COL = { S: [42, 49, 34], W: [78, 88, 62], G: [30, 36, 24], g: [52, 61, 42], K: [20, 23, 16], r: [255, 214, 120], R: [255, 122, 26], d: [150, 62, 10], k: [142, 154, 116] };
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pad) {
  // pad: Anteil Rand (für „maskable“-Symbole, die rund zugeschnitten werden)
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const inner = Math.floor(size * (1 - 2 * pad)), off = Math.floor((size - inner) / 2);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const ix = Math.min(23, Math.max(0, Math.floor((x - off) * 24 / inner)));
      const iy = Math.min(23, Math.max(0, Math.floor((y - off) * 24 / inner)));
      let ch = ART[iy][ix];
      if (x < off || x >= off + inner) ch = y < size * 0.66 ? 'S' : 'G';
      if (y < off) ch = 'S'; if (y >= off + inner) ch = 'G';
      const c = COL[ch];
      raw.set(c, y * (size * 3 + 1) + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const out = path.join(__dirname, '..', 'icons');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon-192.png'), png(192, 0.04));
fs.writeFileSync(path.join(out, 'icon-512.png'), png(512, 0.04));
fs.writeFileSync(path.join(out, 'icon-maskable-512.png'), png(512, 0.14));
fs.writeFileSync(path.join(out, 'apple-touch-icon.png'), png(180, 0.06));
console.log('Symbole erzeugt in icons/');
