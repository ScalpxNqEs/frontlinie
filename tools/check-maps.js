#!/usr/bin/env node
// Prüft alle Gefechtskarten (js/maps.js) und Kampagnenkarten (js/campaign.js).
//   node tools/check-maps.js            -> Prüfung + Fairness-Kennzahlen
//   node tools/check-maps.js --render   -> zusätzlich ASCII-Übersicht nach docs/karten.txt
// Exit-Code 1 bei Fehlern.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ctx = vm.createContext({ console });
for (const f of ['data.js', 'maps.js', 'campaign.js']) {
  const p = path.join(ROOT, 'js', f);
  if (fs.existsSync(p)) vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: p });
  else if (f !== 'data.js') { console.error('Fehlt: ' + p); process.exit(1); }
}
const G = ctx.G || {};

// ------------------------------------------------------------------ Stammdaten
const TERRAIN = 'PFMRBISHXCKAOQ';
const BUILDINGS = 'CKAOQ';
const FOOT_OK = 'PFMRBIHCKAOQ';                 // Fußbewegung
const FOOT_COST = { P: 1, F: 1, M: 2, R: 1, B: 1, I: 2, H: 1, C: 1, K: 1, A: 1, O: 1, Q: 1 };
const SEA_UNITS = ['lander', 'cruiser', 'sub', 'battleship'];
const AIR_UNITS = ['tcopter', 'bcopter', 'fighter', 'bomber'];
const UNIT_IDS = (G.UNITS && Object.keys(G.UNITS)) || ['inf', 'mech', 'recon', 'apc', 'tank', 'mdtank', 'titan', 'arty',
  'rocket', 'aa', 'missile', 'tcopter', 'bcopter', 'fighter', 'bomber', 'lander', 'cruiser', 'sub', 'battleship'];
const domainOf = t => (G.UNITS && G.UNITS[t] && G.UNITS[t].domain) ||
  (SEA_UNITS.includes(t) ? 'sea' : AIR_UNITS.includes(t) ? 'air' : 'ground');
const CO_IDS = (G.COS && Object.keys(G.COS)) ||
  ['rika', 'bastian', 'jara', 'viktor', 'fortuna', 'mira', 'ole', 'kurt', 'greta', 'kraehe'];
const FACTIONS = ['red', 'blue', 'green', 'yellow'];

let errors = 0, warnings = 0;
const out = [];
function err(where, msg) { errors++; out.push('  FEHLER  ' + msg); }
function warn(where, msg) { warnings++; out.push('  Warnung ' + msg); }
function info(msg) { out.push('  ' + msg); }

// ------------------------------------------------------------------ Karte parsen
function parseMap(map) {
  const rows = map.rows || [];
  const H = rows.length, W = H ? rows[0].length / 2 : 0;
  const cells = [];
  const probs = [];
  rows.forEach((r, y) => {
    if (typeof r !== 'string') { probs.push('Zeile ' + y + ' ist kein String'); return; }
    if (r.length % 2) probs.push('Zeile ' + y + ' hat ungerade Zeichenzahl (' + r.length + ')');
    if (r.length !== rows[0].length) probs.push('Zeile ' + y + ' hat Länge ' + r.length + ' statt ' + rows[0].length);
    const row = [];
    for (let x = 0; x < Math.floor(r.length / 2); x++) {
      const t = r[2 * x], o = r[2 * x + 1];
      if (TERRAIN.indexOf(t) < 0) probs.push('Ungültiges Terrain "' + t + '" bei ' + x + '/' + y);
      if (!/^[.1-4]$/.test(o)) probs.push('Ungültiger Besitzer "' + o + '" bei ' + x + '/' + y);
      row.push({ t, o: o === '.' ? 0 : +o });
    }
    cells.push(row);
  });
  return { W, H, cells, probs };
}
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// Dijkstra mit Fußkosten ab Startfeld
function footDist(m, sx, sy) {
  const d = m.cells.map(r => r.map(() => Infinity));
  d[sy][sx] = 0;
  const pq = [[0, sx, sy]];
  while (pq.length) {
    pq.sort((a, b) => a[0] - b[0]);
    const [c, x, y] = pq.shift();
    if (c > d[y][x]) continue;
    for (const [dx, dy] of N4) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= m.W || ny >= m.H) continue;
      const t = m.cells[ny][nx].t;
      if (FOOT_OK.indexOf(t) < 0) continue;
      const nc = c + FOOT_COST[t];
      if (nc < d[ny][nx]) { d[ny][nx] = nc; pq.push([nc, nx, ny]); }
    }
  }
  return d;
}

// ------------------------------------------------------------------ Kartenprüfung
// teams: {slot: teamId}; versus=true -> Fairness wird erzwungen
function checkMap(map, label, teams, versus) {
  const W0 = out.length;
  out.push(label);
  if (!map || !Array.isArray(map.rows) || !map.rows.length) { err(label, 'keine rows'); return null; }
  const P = map.players;
  if (!(P >= 2 && P <= 4)) err(label, 'players muss 2..4 sein, ist ' + P);
  const m = parseMap(map);
  m.probs.forEach(p => err(label, p));
  if (m.probs.length) return null;

  // Besitzer / Gebäude
  const hq = {}, owned = {}, neutral = { C: 0, K: 0, A: 0, O: 0, Q: 0 };
  for (let s = 1; s <= 4; s++) owned[s] = { C: 0, K: 0, A: 0, O: 0, Q: 0 };
  for (let y = 0; y < m.H; y++) for (let x = 0; x < m.W; x++) {
    const c = m.cells[y][x];
    const isB = BUILDINGS.indexOf(c.t) >= 0;
    if (c.o && !isB) err(label, 'Besitzer auf Nicht-Gebäude ' + c.t + ' bei ' + x + '/' + y);
    if (c.o > P) err(label, 'Besitzer ' + c.o + ' > players bei ' + x + '/' + y);
    if (c.t === 'Q' && !c.o) err(label, 'neutrales HQ bei ' + x + '/' + y);
    if (isB) { if (c.o) owned[c.o][c.t]++; else neutral[c.t]++; }
    if (c.t === 'Q' && c.o) (hq[c.o] = hq[c.o] || []).push([x, y]);
    if (c.t === 'O' && !N4.some(([dx, dy]) => { const r = m.cells[y + dy]; return r && r[x + dx] && r[x + dx].t === 'S'; }))
      err(label, 'Hafen bei ' + x + '/' + y + ' grenzt nicht an Meer');
    if (c.t === 'B' && !N4.some(([dx, dy]) => { const r = m.cells[y + dy]; return r && r[x + dx] && 'ISXB'.indexOf(r[x + dx].t) >= 0; }))
      warn(label, 'Brücke bei ' + x + '/' + y + ' liegt nicht an Fluss/Meer');
  }
  for (let s = 1; s <= P; s++) {
    const n = (hq[s] || []).length;
    if (n !== 1) err(label, 'Spieler ' + s + ' hat ' + n + ' HQs (genau 1 nötig)');
  }

  // Einheiten
  const units = map.units || [];
  const seen = {}, unitCount = {};
  units.forEach((u, i) => {
    const [t, x, y, o, hp] = u;
    const where = 'Einheit #' + i + ' ' + JSON.stringify(u);
    if (UNIT_IDS.indexOf(t) < 0) { err(label, where + ': unbekannter Typ'); return; }
    if (!(x >= 0 && y >= 0 && x < m.W && y < m.H && x === (x | 0) && y === (y | 0))) { err(label, where + ': außerhalb der Karte'); return; }
    if (!(o >= 1 && o <= P)) err(label, where + ': ungültiger Spieler');
    if (hp !== undefined && !(hp >= 1 && hp <= 10)) err(label, where + ': hp muss 1..10 sein');
    const k = x + ',' + y;
    if (seen[k]) err(label, where + ': Feld doppelt belegt');
    seen[k] = 1;
    unitCount[o] = (unitCount[o] || 0) + 1;
    const ter = m.cells[y][x].t, dom = domainOf(t);
    if (dom === 'ground' && (ter === 'S' || ter === 'X')) err(label, where + ': Bodeneinheit auf ' + ter);
    if (dom === 'sea') {
      const ok = t === 'lander' ? 'SXOH' : 'SXO';
      if (ok.indexOf(ter) < 0) err(label, where + ': Schiff auf ' + ter);
    }
  });
  for (let s = 1; s <= P; s++) {
    const prod = owned[s].K + owned[s].A + owned[s].O;
    if (!unitCount[s] && !prod) err(label, 'Spieler ' + s + ' hat weder Einheiten noch Produktionsgebäude');
    if (!unitCount[s] && !owned[s].K) warn(label, 'Spieler ' + s + ' startet ohne Einheiten und ohne Fabrik');
  }

  // Erreichbarkeit
  const dist = {};
  for (let s = 1; s <= P; s++) if (hq[s] && hq[s].length === 1) dist[s] = footDist(m, hq[s][0][0], hq[s][0][1]);
  const enemyOf = (a, b) => a !== b && (teams[a] || a) !== (teams[b] || b);
  const hqDist = {};
  for (let s = 1; s <= P; s++) {
    if (!dist[s]) continue;
    let best = Infinity;
    for (let e = 1; e <= P; e++) if (enemyOf(s, e) && hq[e]) best = Math.min(best, dist[s][hq[e][0][1]][hq[e][0][0]]);
    hqDist[s] = best;
    if (best === Infinity) {
      if (owned[s].A && owned[s].O) info('Spieler ' + s + ': kein Landweg zum Gegner-HQ, aber eigener Hafen + Flughafen (Inselkarte)');
      else err(label, 'Spieler ' + s + ' erreicht kein Gegner-HQ über Land und hat nicht Hafen + Flughafen');
    }
  }

  // Fairness-Kennzahlen
  const fmt = o => ['Q', 'K', 'A', 'O', 'C'].map(t => t + o[t]).join(' ');
  const total = o => o.C + o.K + o.A + o.O + o.Q;
  info('Größe ' + m.W + 'x' + m.H + ', Spieler ' + P + ', Einheiten ' + units.length +
    ' (' + Object.keys(unitCount).map(k => 'P' + k + ':' + unitCount[k]).join(' ') + ')');
  for (let s = 1; s <= P; s++)
    info('Spieler ' + s + ': ' + fmt(owned[s]) + ' = ' + total(owned[s]) + ' Gebäude; Fußweg zum nächsten Gegner-HQ: ' +
      (hqDist[s] === Infinity ? '–' : hqDist[s]));
  info('Neutral:   ' + fmt(neutral) + ' = ' + total(neutral) + ' Gebäude');
  // Einflusszonen: neutrales Gebäude gehört dem Spieler mit kürzestem Fußweg (Gleichstand geteilt)
  const zone = {};
  for (let s = 1; s <= P; s++) zone[s] = 0;
  for (let y = 0; y < m.H; y++) for (let x = 0; x < m.W; x++) {
    const c = m.cells[y][x];
    if (BUILDINGS.indexOf(c.t) < 0 || c.o) continue;
    let best = Infinity, who = [];
    for (let s = 1; s <= P; s++) {
      if (!dist[s]) continue;
      const d = dist[s][y][x];
      if (d < best) { best = d; who = [s]; } else if (d === best && d < Infinity) who.push(s);
    }
    who.forEach(s => { zone[s] += 1 / who.length; });
  }
  info('Nächstgelegene neutrale Gebäude: ' + Object.keys(zone).map(s => 'P' + s + ' ' + (+zone[s].toFixed(1))).join(', '));

  if (versus) {
    const ref = fmt(owned[1]);
    for (let s = 2; s <= P; s++) if (fmt(owned[s]) !== ref) err(label, 'Unfair: Gebäude von Spieler ' + s + ' weichen von Spieler 1 ab');
    const uref = units.filter(u => u[3] === 1).map(u => u[0]).sort().join();
    for (let s = 2; s <= P; s++) if (units.filter(u => u[3] === s).map(u => u[0]).sort().join() !== uref)
      err(label, 'Unfair: Einheiten von Spieler ' + s + ' weichen von Spieler 1 ab');
    const ds = Object.values(hqDist).filter(d => d < Infinity);
    if (ds.length > 1 && Math.max(...ds) - Math.min(...ds) > 2) warn(label, 'HQ-Abstände ungleich: ' + ds.join('/'));
    const zs = Object.values(zone);
    if (Math.max(...zs) - Math.min(...zs) > 1.01) warn(label, 'Einflusszonen ungleich');
  }
  return m;
}

// ------------------------------------------------------------------ Gefechtskarten
const MAPS = G.MAPS || [];
out.push('=== Gefechtskarten (' + MAPS.length + ') ===');
const ids = {};
const byPlayers = { 2: 0, 3: 0, 4: 0 };
MAPS.forEach((map, i) => {
  const label = '[' + (map.id || '#' + i) + '] ' + map.name;
  if (!map.id) err(label, 'id fehlt');
  if (ids[map.id]) err(label, 'id doppelt: ' + map.id);
  ids[map.id] = 1;
  if (!map.name || !map.desc) err(label, 'name/desc fehlt');
  byPlayers[map.players] = (byPlayers[map.players] || 0) + 1;
  checkMap(map, label, {}, true);
});
out.push('Karten nach Spielerzahl: ' + JSON.stringify(byPlayers));
if (MAPS.length < 12 || byPlayers[2] < 8 || byPlayers[3] < 2 || byPlayers[4] < 2) err('MAPS', 'zu wenige Karten (mind. 8x2, 2x3, 2x4 Spieler)');

// ------------------------------------------------------------------ Kampagne
const CAMP = G.CAMPAIGN || [];
out.push('', '=== Kampagne (' + CAMP.length + ' Missionen) ===');
const objTypes = {};
CAMP.forEach((ms, i) => {
  const label = '[' + (ms.id || '#' + i) + '] ' + ms.title;
  out.push('');
  const map = ms.map || {};
  const teams = {};
  const slots = [];
  const sides = [].concat(ms.player ? [ms.player] : [], ms.enemies || [], ms.allies || []);
  if (!ms.player) err(label, 'player fehlt');
  if (!ms.enemies || !ms.enemies.length) err(label, 'keine Gegner');
  (ms.player ? [ms.player] : []).forEach(p => { teams[p.slot] = 1; });
  (ms.allies || []).forEach(a => { teams[a.slot] = a.team || 1; if ((a.team || 1) !== 1) warn(label, 'Verbündeter mit team != 1'); });
  (ms.enemies || []).forEach(e => { teams[e.slot] = e.team || 2; });
  const facs = {};
  sides.forEach(sd => {
    slots.push(sd.slot);
    if (CO_IDS.indexOf(sd.co) < 0) err(label, 'unbekannte CO-ID ' + sd.co);
    if (FACTIONS.indexOf(sd.faction) < 0) err(label, 'unbekannte Fraktion ' + sd.faction);
    if (facs[sd.faction]) err(label, 'Fraktion doppelt: ' + sd.faction);
    facs[sd.faction] = 1;
  });
  slots.sort();
  const want = []; for (let s = 1; s <= map.players; s++) want.push(s);
  if (slots.join() !== want.join()) err(label, 'Slots ' + slots.join(',') + ' passen nicht zu players=' + map.players);
  const m = checkMap(map, label + ' – Karte "' + map.name + '"', teams, false);
  if (ms.funds) Object.keys(ms.funds).forEach(k => { if (!(+k >= 1 && +k <= map.players)) err(label, 'funds für ungültigen Slot ' + k); });
  const ob = ms.objective || {};
  objTypes[ob.type] = (objTypes[ob.type] || 0) + 1;
  if (['standard', 'survive', 'capture', 'rout'].indexOf(ob.type) < 0) err(label, 'unbekanntes Ziel ' + ob.type);
  if (ob.type === 'survive' && !(ob.days >= 1)) err(label, 'survive ohne days');
  if (ob.type === 'capture' && m) {
    const c = m.cells[ob.y] && m.cells[ob.y][ob.x];
    if (!c || BUILDINGS.indexOf(c.t) < 0) err(label, 'capture-Ziel ' + ob.x + '/' + ob.y + ' ist kein Gebäude');
    else if (teams[c.o] === 1) err(label, 'capture-Ziel gehört schon dem Spieler-Team');
    else info('Ziel: ' + c.t + ' bei ' + ob.x + '/' + ob.y + ' (Besitzer ' + (c.o || 'neutral') + ')');
  }
  if (ob.type === 'rout') {
    const enemySlots = (ms.enemies || []).map(e => e.slot);
    if (!(map.units || []).some(u => enemySlots.includes(u[3]))) err(label, 'rout ohne Gegnereinheiten');
  }
  if (typeof ms.fog !== 'boolean') warn(label, 'fog nicht gesetzt');
  if (!ms.hint) warn(label, 'hint fehlt');
  const chk = (arr, nm, lo, hi) => {
    if (!Array.isArray(arr)) { err(label, nm + ' fehlt'); return; }
    if (arr.length < lo || arr.length > hi) warn(label, nm + ' hat ' + arr.length + ' Zeilen (' + lo + '–' + hi + ' erwartet)');
    arr.forEach((l, j) => {
      if (CO_IDS.indexOf(l.co) < 0) err(label, nm + '[' + j + '] unbekannte CO-ID ' + l.co);
      if (!l.text) err(label, nm + '[' + j + '] ohne Text');
      else if (l.text.length > 140) warn(label, nm + '[' + j + '] ist ' + l.text.length + ' Zeichen lang');
    });
  };
  chk(ms.intro, 'intro', 4, 10);
  chk(ms.outro, 'outro', 2, 4);
  info('Spieler: ' + ms.player.co + '/' + ms.player.faction + '  Gegner: ' + (ms.enemies || []).map(e => e.co + '/' + e.faction).join(', ') +
    ((ms.allies || []).length ? '  Verbündete: ' + ms.allies.map(a => a.co + '/' + a.faction).join(', ') : '') +
    '  Ziel: ' + ob.type + (ob.days ? ' ' + ob.days + ' Tage' : '') + (ms.fog ? '  Nebel' : ''));
});
out.push('', 'Zieltypen: ' + JSON.stringify(objTypes));
if (CAMP.length < 12) err('CAMP', 'weniger als 12 Missionen');
['survive', 'capture', 'rout'].forEach(t => { if (!objTypes[t]) err('CAMP', 'keine Mission vom Typ ' + t); });

console.log(out.join('\n'));
console.log('\n' + (errors ? '✗ ' + errors + ' Fehler' : '✓ keine Fehler') + ', ' + warnings + ' Warnungen');

// ------------------------------------------------------------------ ASCII-Übersicht
if (process.argv.includes('--render')) {
  const GLYPH = { P: '. ', F: 'f ', M: '/\\', R: '==', B: '##', I: '~ ', S: '~~', H: ', ', X: '**' };
  const UNIT_CH = { inf: 'i', mech: 'g', recon: 's', apc: 't', tank: 'p', mdtank: 'P', titan: 'T', arty: 'a', rocket: 'r',
    aa: 'f', missile: 'm', tcopter: 'h', bcopter: 'k', fighter: 'j', bomber: 'b', lander: 'L', cruiser: 'K', sub: 'U', battleship: 'S' };
  function render(map, title) {
    const m = parseMap(map);
    const L = [title, '-'.repeat(title.length)];
    const ux = {};
    (map.units || []).forEach(u => { ux[u[1] + ',' + u[2]] = (UNIT_CH[u[0]] || '?') + u[3]; });
    let head = '    ';
    for (let x = 0; x < m.W; x++) head += String(x % 10) + ' ';
    L.push(head);
    for (let y = 0; y < m.H; y++) {
      let s = String(y).padStart(3) + ' ';
      for (let x = 0; x < m.W; x++) {
        const c = m.cells[y][x];
        s += BUILDINGS.indexOf(c.t) >= 0 ? c.t + (c.o || '.') : GLYPH[c.t];
      }
      if (Object.keys(ux).length) {
        s += '   ';
        for (let x = 0; x < m.W; x++) {
          const c = m.cells[y][x];
          s += ux[x + ',' + y] || (c.t === 'S' || c.t === 'X' ? '~~' : BUILDINGS.indexOf(c.t) >= 0 ? c.t + ' ' : '. ');
        }
      }
      L.push(s);
    }
    return L.join('\n');
  }
  const doc = [
    'FRONTLINIE – Kartenübersicht (erzeugt von tools/check-maps.js --render)',
    'Legende: . Ebene  f Wald  /\\ Berg  == Straße  ## Brücke  ~ Fluss  ~~ Meer  , Strand  ** Riff',
    '         Gebäude: C Stadt  K Fabrik  A Flughafen  O Hafen  Q HQ, dahinter Besitzer (. = neutral)',
    '         Rechts daneben (falls vorhanden) Einheiten: Kürzel + Spieler',
    '         i Inf  g Gren  s Späh  t TPz  p Pz  P sPz  T Titan  a Art  r Rak  f Flak  m FlaR',
    '         h THub  k KHub  j Jäg  b Bomb  L LBoot  K Kreuz  U U-Boot  S SSch',
    ''];
  MAPS.forEach(mp => doc.push(render(mp, '[' + mp.id + '] ' + mp.name + ' – ' + mp.players + ' Spieler: ' + mp.desc), ''));
  CAMP.forEach(ms => doc.push(render(ms.map, '[' + ms.id + '] ' + ms.title + ' – Karte "' + ms.map.name + '", Ziel ' + (ms.objective || {}).type), ''));
  fs.writeFileSync(path.join(ROOT, 'docs', 'karten.txt'), doc.join('\n'));
  console.log('docs/karten.txt geschrieben');
}
process.exit(errors ? 1 : 0);
