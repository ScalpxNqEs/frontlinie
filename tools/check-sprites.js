// Prüft js/sprites.js: Maße aller Raster und alle Zeichen gegen Palette + reservierte Zeichen.
// Aufruf: node tools/check-sprites.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadSprites() {
  globalThis.G = {};
  const p = path.join(__dirname, '..', 'js', 'sprites.js');
  vm.runInThisContext(fs.readFileSync(p, 'utf8'), { filename: p });
  return globalThis.G;
}

const UNIT_IDS = 'inf mech recon apc tank mdtank titan arty rocket aa missile tcopter bcopter fighter bomber lander cruiser sub battleship'.split(' ');
const BUILDING_IDS = ['C', 'K', 'A', 'O', 'Q'];
const PORTRAIT_IDS = ['rika', 'bastian', 'jara', 'viktor', 'fortuna', 'mira', 'ole', 'kurt', 'greta', 'kraehe'];
const ICON_IDS = { capture: 8, fuel: 8, ammo: 8, hidden: 8, star: 8, cursor: 16 };
const RESERVED = '.1234';

function check() {
  const G = loadSprites();
  const errors = [];
  const pal = G.SPRITE_PALETTE || {};
  for (const k of Object.keys(pal)) {
    if (k.length !== 1) errors.push(`Palette: Schlüssel "${k}" ist kein einzelnes Zeichen`);
    if (RESERVED.includes(k)) errors.push(`Palette: "${k}" ist reserviert`);
    if (!/^#[0-9a-fA-F]{6}$/.test(pal[k])) errors.push(`Palette: "${k}" hat ungültige Farbe ${pal[k]}`);
  }
  const used = new Set();
  function grid(name, rows, w, h) {
    if (!Array.isArray(rows)) { errors.push(`${name}: kein Array`); return; }
    if (rows.length !== h) errors.push(`${name}: ${rows.length} Zeilen statt ${h}`);
    rows.forEach((row, y) => {
      if (typeof row !== 'string') { errors.push(`${name}[${y}]: kein String`); return; }
      if (row.length !== w) errors.push(`${name}[${y}]: Breite ${row.length} statt ${w}: "${row}"`);
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        used.add(ch);
        if (!RESERVED.includes(ch) && !(ch in pal)) errors.push(`${name}[${y}][${x}]: unbekanntes Zeichen "${ch}"`);
      }
    });
  }
  const S = G.SPRITES || {};
  for (const id of UNIT_IDS) {
    const u = S.units && S.units[id];
    if (!u || !Array.isArray(u.frames)) { errors.push(`units.${id}: fehlt`); continue; }
    if (u.frames.length !== 2) errors.push(`units.${id}: ${u.frames.length} Frames statt 2`);
    u.frames.forEach((f, i) => grid(`units.${id}.frames[${i}]`, f, 16, 16));
    if (u.frames.length === 2 && u.frames[0].join() === u.frames[1].join()) errors.push(`units.${id}: Frames identisch`);
  }
  for (const id of BUILDING_IDS) grid(`buildings.${id}`, S.buildings && S.buildings[id], 16, 16);
  for (const id of PORTRAIT_IDS) grid(`portraits.${id}`, S.portraits && S.portraits[id], 32, 32);
  for (const id of Object.keys(ICON_IDS)) grid(`icons.${id}`, S.icons && S.icons[id], ICON_IDS[id], ICON_IDS[id]);
  for (const id of Object.keys(S.icons || {})) if (!(id in ICON_IDS)) grid(`icons.${id}`, S.icons[id], 8, 8);
  const unused = Object.keys(pal).filter(k => !used.has(k));
  return { errors, unused };
}

if (require.main === module) {
  const { errors, unused } = check();
  if (unused.length) console.log('Hinweis: ungenutzte Palettenzeichen: ' + unused.join(' '));
  if (errors.length) {
    console.log(errors.length + ' Fehler:');
    errors.slice(0, 80).forEach(e => console.log('  ' + e));
    process.exit(1);
  }
  console.log('sprites.js OK');
}
module.exports = { check, loadSprites };
