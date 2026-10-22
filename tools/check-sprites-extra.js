// Prüft js/sprites.js + js/sprites-extra.js zusammen:
// - alle Einheiten (alt + neu): 2 Frames, 16x16, nur Palettenzeichen bzw. '.', '1'..'4', Frames verschieden
// - sprites-extra.js überschreibt keine vorhandene Palettenfarbe und keine vorhandene Einheit
// - neue Palettenzeichen: genau ein Zeichen, nicht reserviert, gültige Farbe
// - Hinweise (keine Fehler): Randpixel ohne Kontur, leere Frames
// Aufruf: node tools/check-sprites-extra.js [--verbose]
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS = path.join(__dirname, '..', 'js');
const OLD_UNITS = 'inf mech recon apc tank mdtank titan arty rocket aa missile tcopter bcopter fighter bomber lander cruiser sub battleship'.split(' ');
const NEW_UNITS = 'moto flame pionier bergepanzer drone gunship airlift pboat carrier bunker turret flak coast'.split(' ');
const RESERVED = '.1234';

function run(file) { const p = path.join(JS, file); vm.runInThisContext(fs.readFileSync(p, 'utf8'), { filename: p }); }

// Lädt beide Dateien und merkt sich den Stand vor sprites-extra.js.
function loadAll() {
  globalThis.G = {};
  run('sprites.js');
  const G = globalThis.G;
  const palBefore = Object.assign({}, G.SPRITE_PALETTE);
  const unitsBefore = {};
  for (const id of Object.keys(G.SPRITES.units)) unitsBefore[id] = JSON.stringify(G.SPRITES.units[id]);
  run('sprites-extra.js');
  return { G: globalThis.G, palBefore, unitsBefore };
}

function check(verbose) {
  const { G, palBefore, unitsBefore } = loadAll();
  const errors = [], hints = [];
  const pal = G.SPRITE_PALETTE || {};
  const added = Object.keys(pal).filter(k => !(k in palBefore));
  for (const k of Object.keys(palBefore)) {
    if (pal[k] !== palBefore[k]) errors.push(`Palette: vorhandenes Zeichen "${k}" geändert (${palBefore[k]} -> ${pal[k]})`);
  }
  for (const k of Object.keys(pal)) {
    if (k.length !== 1) errors.push(`Palette: Schlüssel "${k}" ist kein einzelnes Zeichen`);
    if (RESERVED.includes(k)) errors.push(`Palette: "${k}" ist reserviert`);
    if (!/^#[0-9a-fA-F]{6}$/.test(pal[k])) errors.push(`Palette: "${k}" hat ungültige Farbe ${pal[k]}`);
  }
  const U = (G.SPRITES && G.SPRITES.units) || {};
  for (const id of Object.keys(unitsBefore)) {
    if (JSON.stringify(U[id]) !== unitsBefore[id]) errors.push(`units.${id}: vorhandene Einheit wurde verändert`);
  }
  const usedNew = new Set();
  function grid(name, rows, collect) {
    if (!Array.isArray(rows)) { errors.push(`${name}: kein Array`); return; }
    if (rows.length !== 16) errors.push(`${name}: ${rows.length} Zeilen statt 16`);
    let filled = 0;
    rows.forEach((row, y) => {
      if (typeof row !== 'string') { errors.push(`${name}[${y}]: kein String`); return; }
      if (row.length !== 16) errors.push(`${name}[${y}]: Breite ${row.length} statt 16: "${row}"`);
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if (collect) collect.add(ch);
        if (ch !== '.') filled++;
        if (!RESERVED.includes(ch) && !(ch in pal)) errors.push(`${name}[${y}][${x}]: unbekanntes Zeichen "${ch}"`);
      }
    });
    if (filled === 0) errors.push(`${name}: Frame ist leer`);
    return filled;
  }
  // Konturhinweis: deckende Pixel (außer Rotor/Effekt-Zeichen) direkt neben Transparenz, die nicht 'k' sind
  const SOFT = 'Gg wjoycCdbB';
  function contour(name, rows) {
    const gaps = [];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const ch = rows[y][x];
      if (ch === '.' || ch === 'k' || SOFT.includes(ch)) continue;
      const nb = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
      if (nb.some(([i, j]) => i >= 0 && j >= 0 && i < 16 && j < 16 && rows[j][i] === '.')) gaps.push(`${x},${y}(${ch})`);
    }
    if (gaps.length) hints.push(`${name}: ${gaps.length} Randpixel ohne Kontur: ${gaps.slice(0, 8).join(' ')}${gaps.length > 8 ? ' …' : ''}`);
  }
  for (const id of OLD_UNITS.concat(NEW_UNITS)) {
    const u = U[id];
    if (!u || !Array.isArray(u.frames)) { errors.push(`units.${id}: fehlt`); continue; }
    if (u.frames.length !== 2) errors.push(`units.${id}: ${u.frames.length} Frames statt 2`);
    const isNew = NEW_UNITS.includes(id);
    u.frames.forEach((f, i) => {
      grid(`units.${id}.frames[${i}]`, f, isNew ? usedNew : null);
      if (isNew && verbose && Array.isArray(f) && f.length === 16) contour(`units.${id}.frames[${i}]`, f);
    });
    if (u.frames.length === 2 && u.frames[0].join() === u.frames[1].join()) errors.push(`units.${id}: Frames identisch`);
  }
  const extraIds = Object.keys(U).filter(id => !OLD_UNITS.includes(id) && !NEW_UNITS.includes(id));
  if (extraIds.length) hints.push('weitere Einheiten-IDs: ' + extraIds.join(' '));
  const unusedAdded = added.filter(k => !usedNew.has(k));
  if (unusedAdded.length) errors.push('neue Palettenzeichen werden nicht benutzt: ' + unusedAdded.join(' '));
  return { errors, hints, added, pal };
}

if (require.main === module) {
  const verbose = process.argv.includes('--verbose');
  const { errors, hints, added, pal } = check(verbose);
  if (added.length) console.log('neue Palettenzeichen: ' + added.map(k => `${k}=${pal[k]}`).join(' '));
  hints.forEach(h => console.log('Hinweis: ' + h));
  if (errors.length) {
    console.log(errors.length + ' Fehler:');
    errors.slice(0, 80).forEach(e => console.log('  ' + e));
    process.exit(1);
  }
  console.log(`sprites.js + sprites-extra.js OK (${OLD_UNITS.length} + ${NEW_UNITS.length} Einheiten)`);
}
module.exports = { check, loadAll, NEW_UNITS, OLD_UNITS };
