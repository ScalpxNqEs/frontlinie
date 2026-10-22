#!/usr/bin/env node
// FRONTLINIE – Generator für symmetrische Gefechtskarten.
//   node tools/mapgen.js                    -> schreibt js/maps.js
//   node tools/mapgen.js --print id         -> zeigt eine Karte als ASCII
//   node tools/mapgen.js --print id --wide  -> ASCII mit 2 Zeichen je Feld (Gebäude + Besitzer)
// Jede Karte entsteht aus einer Landform (Kontinent, rund, L, O, U, lang, zwei Kontinente, Archipel),
// Rauschen für Wald/Berge/Seen, Flüssen, Stützpunkten, Gebäuden und einem Straßennetz.
// Alles wird über die Symmetriegruppe der Karte gespiegelt/gedreht, damit alle Spieler fair starten.
//
// Gebäude (Advance-Wars-Maßstab: HQ-Fußweg 30–45 bei 2, 35–55 bei 3–4 Spielern; ein Gebäude je ~21 Landfelder):
//   Heimatbasis    HQ, 2 Fabriken (2–4 Felder), Hafen (Küste ≤ 8, notfalls ≤ 12), Flughafen (3–6), 4 Städte (2–6)
//   Expansion      3–4 neutrale Städte 4–9 Felder ums HQ (die erste ≤ 6) für frühe Einnahmen
//   Vorposten      je Spieler eine neutrale Fabrik bei 35–50 % des HQ-Abstands Richtung Mitte, seitlich versetzt
//   Mitte          Fabrik, Flughafen, Hafen (falls Küste) und Städte um den Mittelpunkt (Kartenmitte bzw. Punkt
//                  gleichen Abstands zu allen HQs) – dort kreuzen sich die Hauptstraßen
//   Füllstädte     verteilt („bester Kandidat“) bis zur Zieldichte, gern an den Rändern (Ausbaugebiet)
// Straßen: zuerst die Hauptachse (Mitte untereinander, HQ -> Mitte, HQ -> HQ), dann ein Spannbaum über die Gebäude;
// zuletzt bekommen Landstücke, die Kettenfahrzeuge nicht erreichen (hinter Flüssen/Bergen), eine Brücke bzw. einen Pass.
//
// Flags der Kartendefinition (alle optional):
//   anchor: [u, v]       Lage des HQs von Spieler 1 (Anteil von Breite/Höhe); lieber nicht ganz in die Ecke
//   anchor3: [u, v]      Spieler 3 auf der Spiegelachse (sym 'mirror3'); generateBest() sucht dann Anker
//                        (search: {u, v, v3} als [von, bis], hqRange: [min, max] Zielbereich der HQ-Wege)
//   center: [u, v]       Mittelpunkt des Mitte-Clusters (Standard: Kartenmitte)
//   mid: {K, A, O, C}    Bahnen im Mitte-Cluster (Standard {K: 1, A: 1, O: 1, C: 2})
//   expand: n            Expansionsstädte je HQ (Standard 4)
//   forward: [a, b] | 0  Band der Vorposten-Fabrik relativ zum HQ-Abstand (Standard [0.35, 0.5]); side: s seitlicher
//                        Versatz relativ zum HQ-Abstand (Standard 0.2)
//   density: n           Zieldichte: ein Gebäude je n Landfelder (Standard 21)
//   neutral: {A, O}      zusätzliche neutrale Flughäfen/Häfen (Bahnen); aBand: [a, b] Abstandsband der Flughäfen
//   ports: n             Häfen je Spieler (Standard 1)
//   seaBridges: true     Straßen dürfen Meer überbrücken (bridge: Kosten je Meerfeld, Standard 9)
//   ridges: true         Gebirgsketten an Ober- und Unterkante (Langes Tal)
//   shape: 'archipel', islands: [...]  Inselgruppe aus Kreisen/Kapseln (Feldkoordinaten, werden gespiegelt)
//   archipelago: true    Inselkarte: Landflecken bereinigen, Heimatgebäude nur auf der HQ-Insel (erster Hafen zur
//                        Mittelinsel), Vorposten auf einem Eiland, Mitte auf der größten neutralen Insel, jede neutrale
//                        Insel mit Stadt und Strand, Häfen über die Inseln verteilt, Straßen je Insel, keine Brücken
//   reef: s / beach: s   Schwellen für Riffe im offenen Meer (Standard 0.8) und Strände (Standard 0.55)
'use strict';
const fs = require('fs');
const path = require('path');

// ------------------------------------------------------------------ Zufall & Rauschen
function makeRng(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Glattes Wertrauschen (mehrere Oktaven), Ergebnis 0..1 */
function makeNoise(w, h, rand, cell, octaves) {
  const layers = [];
  let c = cell, amp = 1, total = 0;
  for (let o = 0; o < (octaves || 3); o++) {
    const gw = Math.ceil(w / c) + 2, gh = Math.ceil(h / c) + 2;
    const grid = new Float32Array(gw * gh);
    for (let i = 0; i < grid.length; i++) grid[i] = rand();
    layers.push({ c, gw, grid, amp });
    total += amp; amp *= 0.5; c = Math.max(2, c / 2);
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 0;
    for (const L of layers) {
      const fx = x / L.c, fy = y / L.c, ix = Math.floor(fx), iy = Math.floor(fy);
      const tx = fx - ix, ty = fy - iy;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const g = (a, b) => L.grid[b * L.gw + a];
      const top = g(ix, iy) * (1 - sx) + g(ix + 1, iy) * sx;
      const bot = g(ix, iy + 1) * (1 - sx) + g(ix + 1, iy + 1) * sx;
      v += (top * (1 - sy) + bot * sy) * L.amp;
    }
    out[y * w + x] = v / total;
  }
  return out;
}

// ------------------------------------------------------------------ Symmetriegruppen
// Jedes Element: f(x,y) -> [x,y] und perm[spieler] -> spieler
function group(type, w, h) {
  const id = { f: (x, y) => [x, y], perm: [0, 1, 2, 3, 4] };
  switch (type) {
    case 'rot2': return [id, { f: (x, y) => [w - 1 - x, h - 1 - y], perm: [0, 2, 1, 4, 3] }];
    case 'mirrorX': return [id, { f: (x, y) => [w - 1 - x, y], perm: [0, 2, 1, 4, 3] }];
    case 'mirror3': return [id, { f: (x, y) => [w - 1 - x, y], perm: [0, 2, 1, 3, 4] }];
    case 'diag': return [id, { f: (x, y) => [w - 1 - y, h - 1 - x], perm: [0, 2, 1, 4, 3] }];
    case 'rot4': {
      const R = (x, y) => [w - 1 - y, x];
      return [id,
        { f: R, perm: [0, 2, 3, 4, 1] },
        { f: (x, y) => { const a = R(x, y); return R(a[0], a[1]); }, perm: [0, 3, 4, 1, 2] },
        { f: (x, y) => { let a = R(x, y); a = R(a[0], a[1]); return R(a[0], a[1]); }, perm: [0, 4, 1, 2, 3] }];
    }
    case 'mirrorXY': return [id,
      { f: (x, y) => [w - 1 - x, y], perm: [0, 2, 1, 4, 3] },
      { f: (x, y) => [x, h - 1 - y], perm: [0, 3, 4, 1, 2] },
      { f: (x, y) => [w - 1 - x, h - 1 - y], perm: [0, 4, 3, 2, 1] }];
    case 'rot3': {
      const cx = (w - 1) / 2, cy = (h - 1) / 2;
      const rot = k => (x, y) => {
        const a = k * 2 * Math.PI / 3, dx = x - cx, dy = y - cy;
        return [Math.round(cx + dx * Math.cos(a) - dy * Math.sin(a)), Math.round(cy + dx * Math.sin(a) + dy * Math.cos(a))];
      };
      return [id, { f: rot(1), perm: [0, 2, 3, 1, 4] }, { f: rot(2), perm: [0, 3, 1, 2, 4] }];
    }
  }
  throw new Error('Symmetrie ' + type);
}

// ------------------------------------------------------------------ Landformen (u,v in 0..1, Rückgabe: <0 Land, >0 Wasser)
const SHAPES = {
  // Fast vollständiges Land mit ausgefranster Küste
  continent: (u, v) => Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5)) * 2 - 0.94,
  // Runde Insel
  round: (u, v) => Math.hypot(u - 0.5, v - 0.5) * 2 - 0.9,
  // L: senkrechter Arm links, waagerechter Arm unten (symmetrisch zur Nebendiagonalen)
  L: (u, v) => {
    const arm = 0.44;
    const inArm = u < arm || v > 1 - arm;
    const border = Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5)) * 2 - 0.94;
    return inArm ? border : Math.min(0.5, Math.min(u - arm, (1 - arm) - v) * 4 + 0.02);
  },
  // O: Landring um ein Binnenmeer mit Mittelinsel
  ring: (u, v) => {
    const r = Math.hypot(u - 0.5, v - 0.5) * 2;
    if (r < 0.27) return r - 0.25;           // Mittelinsel
    if (r < 0.46) return 0.46 - r + 0.01;    // Binnenmeer (positiv = Wasser)
    return Math.max(0.46 - r, r - 0.95);     // Ring
  },
  // U: zwei Arme oben offen, verbunden unten, Insel in der Bucht
  U: (u, v) => {
    const border = Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5)) * 2 - 0.94;
    const isl = Math.hypot((u - 0.5) * 1.1, v - 0.4) - 0.13;
    if (isl < 0) return isl;
    const arm = u < 0.31 || u > 0.69 || v > 0.7;
    if (!arm) return Math.min(0.5, Math.min(0.19 - Math.abs(u - 0.5), 0.7 - v) * 4 + 0.02);
    return border;
  },
  // Lang gestreckt
  long: (u, v) => Math.max(Math.abs(u - 0.5) * 2 - 0.985, Math.abs(v - 0.5) * 2 - 0.9),
  // Zwei Kontinente, getrennt durch eine Meerenge
  twin: (u, v) => {
    const border = Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5)) * 2 - 0.94;
    const strait = 0.022 - Math.abs(u - 0.5 + (v - 0.5) * 0.25);
    return Math.max(border, strait);
  },
  // Archipel: Vereinigung der in def.islands angegebenen Kreise/Kapseln (Feldkoordinaten), über die
  // Symmetriegruppe vervielfältigt. Maßstab: 25 Felder ≙ 1, damit das Küstenrauschen ±1,5 Felder ausmacht.
  archipel: (u, v, def) => islandField(def)(u * (def.w - 1), v * (def.h - 1)) / 25
};

// Insel-Landformen: {x, y, r} Kreis, {x, y, x2, y2, r} Kapsel (Strecke mit Radius), cut: true schneidet Wasser aus
// (Buchten). Rückgabe: vorzeichenbehafteter Abstand in Feldern (<0 Land).
const fieldCache = new WeakMap();
function islandField(def) {
  let f = fieldCache.get(def);
  if (f) return f;
  const Gs = group(def.sym, def.w, def.h);
  const parts = [];
  (def.islands || []).forEach(isl => {
    Gs.forEach(g => {
      const a = g.f(isl.x, isl.y);
      const b = isl.x2 != null ? g.f(isl.x2, isl.y2) : a;
      parts.push({ x1: a[0], y1: a[1], x2: b[0], y2: b[1], r: isl.r, cut: !!isl.cut });
    });
  });
  const segDist = (px, py, p) => {
    const dx = p.x2 - p.x1, dy = p.y2 - p.y1, L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((px - p.x1) * dx + (py - p.y1) * dy) / L2)) : 0;
    return Math.hypot(px - (p.x1 + dx * t), py - (p.y1 + dy * t));
  };
  f = (x, y) => {
    let land = 1e9, cut = -1e9;
    for (const p of parts) {
      const d = segDist(x, y, p) - p.r;
      if (p.cut) cut = Math.max(cut, -d); else land = Math.min(land, d);
    }
    return Math.max(land, cut);
  };
  fieldCache.set(def, f);
  return f;
}
/** Zusammenhängende Landkomponenten (Inseln, 4er-Nachbarschaft). comp[i] = Nummer, -1 für Wasser (S/X); sizes[nr] = Felder */
function landComponents(T, w, h) {
  const N = w * h, comp = new Int32Array(N).fill(-1), sizes = [];
  for (let s = 0; s < N; s++) {
    if (comp[s] >= 0 || T[s] === 'S' || T[s] === 'X') continue;
    const id = sizes.length, q = [s];
    comp[s] = id;
    for (let k = 0; k < q.length; k++) {
      const i = q[k], x = i % w, y = (i - x) / w;
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(d => {
        const nx = x + d[0], ny = y + d[1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
        const j = ny * w + nx;
        if (comp[j] < 0 && T[j] !== 'S' && T[j] !== 'X') { comp[j] = id; q.push(j); }
      });
    }
    sizes.push(q.length);
  }
  return { comp, sizes };
}

// ------------------------------------------------------------------ Kartendefinitionen
const DEFS = [
  { id: 'grenzland', theme: 'sommer', name: 'Grenzland', players: 2, w: 30, h: 30, shape: 'continent', sym: 'rot2', anchor: [0.2, 0.22], seed: 11,
    lakes: 0.03, forest: 0.2, mountain: 0.06, rivers: 2, desc: 'Kompakte Karte für schnelle Duelle: ein Kontinent mit Flüssen, Seen und Städten.' },
  { id: 'langes-tal', theme: 'gebirge', name: 'Langes Tal', players: 2, w: 54, h: 30, shape: 'long', sym: 'rot2', anchor: [0.16, 0.5], seed: 23,
    lakes: 0.02, forest: 0.2, mountain: 0.1, rivers: 2, ridges: true, desc: 'Ein langes Tal zwischen zwei Gebirgsketten. Straßen entscheiden das Tempo.' },
  { id: 'rundinsel', theme: 'sommer', name: 'Rundinsel', players: 2, w: 45, h: 45, shape: 'round', sym: 'rot2', anchor: [0.27, 0.3], seed: 37,
    lakes: 0.03, forest: 0.27, mountain: 0.06, rivers: 2, desc: 'Eine runde Insel im offenen Meer. Häfen und Flughäfen an allen Küsten.' },
  { id: 'winkelfront', theme: 'herbst', name: 'Winkelfront', players: 2, w: 40, h: 40, shape: 'L', sym: 'diag', anchor: [0.24, 0.26], center: [0.22, 0.78], seed: 41,
    lakes: 0.03, forest: 0.26, mountain: 0.06, rivers: 2, desc: 'Ein L-förmiges Land: Die Heere stehen an den beiden Enden, die Ecke ist heiß umkämpft.' },
  { id: 'ringwall', theme: 'sommer', name: 'Ringwall', players: 2, w: 45, h: 45, shape: 'ring', sym: 'rot2', anchor: [0.5, 0.14], seed: 53,
    lakes: 0, forest: 0.2, mountain: 0.06, rivers: 1, seaBridges: true,
    desc: 'Ein Landring um ein Binnenmeer. In der Mitte lockt eine Insel mit Fabrik und Flughafen.' },
  { id: 'hufeisen', theme: 'herbst', name: 'Hufeisen', players: 2, w: 48, h: 40, shape: 'U', sym: 'mirrorX', anchor: [0.15, 0.4], center: [0.5, 0.4], seed: 67,
    lakes: 0.02, forest: 0.2, mountain: 0.06, rivers: 2, seaBridges: true,
    desc: 'Zwei Arme eines Hufeisens, unten verbunden. In der Bucht liegt eine reiche Insel.' },
  { id: 'zwei-kontinente', theme: 'winter', name: 'Zwei Kontinente', players: 2, w: 50, h: 40, shape: 'twin', sym: 'rot2', anchor: [0.2, 0.38], seed: 79,
    lakes: 0.03, forest: 0.2, mountain: 0.06, rivers: 2, seaBridges: true, bridge: 6, desc: 'Zwei Landmassen, getrennt durch eine Meerenge mit wenigen Brücken.' },
  { id: 'hochgebirge', theme: 'gebirge', name: 'Hochgebirge', players: 2, w: 46, h: 40, shape: 'continent', sym: 'rot2', anchor: [0.2, 0.35], seed: 89,
    lakes: 0.02, forest: 0.16, mountain: 0.18, rivers: 2, desc: 'Schroffe Gipfel, enge Pässe: Fahrzeuge müssen die Straßen nehmen, Infanterie klettert.' },
  { id: 'eisseenplatte', theme: 'winter', name: 'Eisseenplatte', players: 2, w: 46, h: 44, shape: 'continent', sym: 'rot2', anchor: [0.22, 0.34], seed: 91,
    lakes: 0.1, forest: 0.2, mountain: 0.05, rivers: 1, desc: 'Verschneites Land voller Seen. Brücken und Landengen sind heiß begehrt.' },
  { id: 'weite-ebene', theme: 'sommer', name: 'Weite Ebene', players: 2, w: 64, h: 46, shape: 'continent', sym: 'rot2', anchor: [0.22, 0.44], seed: 97,
    lakes: 0.04, forest: 0.2, mountain: 0.06, rivers: 3, desc: 'Die größte Duellkarte: eine weite Ebene mit Seen, Flüssen und dutzenden Städten an den Flanken.' },
  { id: 'dreistern', theme: 'herbst', name: 'Dreistern', players: 3, w: 57, h: 57, shape: 'round', sym: 'mirror3', anchor: [0.2, 0.25], anchor3: [0.5, 0.8], seed: 101,
    hqRange: [35, 42], lakes: 0.03, forest: 0.2, mountain: 0.06, rivers: 2, side: 0, desc: 'Drei Reiche auf einer runden Insel – wer zwei Fronten hat, muss klug haushalten.' },
  { id: 'dreilaendereck', theme: 'gebirge', name: 'Dreiländereck', players: 3, w: 59, h: 53, shape: 'continent', sym: 'mirror3', anchor: [0.12, 0.12], anchor3: [0.5, 0.85], seed: 103,
    lakes: 0.05, forest: 0.2, mountain: 0.07, rivers: 3, side: 0, desc: 'Drei Länder an einem großen See. Bündnisse halten selten lange.' },
  { id: 'vier-reiche', theme: 'winter', name: 'Vier Reiche', players: 4, w: 53, h: 53, shape: 'continent', sym: 'rot4', anchor: [0.15, 0.15], seed: 113,
    lakes: 0.04, forest: 0.2, mountain: 0.06, rivers: 2, desc: 'Vier Reiche in den Ecken eines Kontinents, in der Mitte umkämpftes Land.' },
  { id: 'kreuzring', theme: 'sommer', name: 'Kreuzring', players: 4, w: 55, h: 55, shape: 'ring', sym: 'rot4', anchor: [0.5, 0.08], seed: 127,
    lakes: 0, forest: 0.25, mountain: 0.06, rivers: 1, seaBridges: true,
    desc: 'Vier Armeen auf einem Landring. Wer die Insel in der Mitte hält, beherrscht das Binnenmeer.' },
  { id: 'grosses-viereck', theme: 'sommer', name: 'Großes Viereck', players: 4, w: 71, h: 59, shape: 'continent', sym: 'mirrorXY', anchor: [0.2, 0.18], seed: 131,
    lakes: 0.04, forest: 0.2, mountain: 0.06, rivers: 3, desc: 'Die größte Karte: vier Armeen, ein weiter Kontinent und lange Fronten.' },
  // ---- Seekarten: Inselgruppen ohne Landverbindung zwischen den Spielern (Flags siehe Kopf der Datei)
  { id: 'inselreich', theme: 'sommer', name: 'Inselreich', players: 2, w: 48, h: 40, shape: 'archipel', sym: 'rot2', anchor: [0.19, 0.22], seed: 137,
    archipelago: true, ports: 2, expand: 3, neutral: { O: 3 }, reef: 0.62, beach: 0.5,
    islands: [
      { x: 9, y: 9, r: 7 }, { x: 12.5, y: 12.5, r: 3.5 },   // Heimatinsel (mit Ausläufer zur Mitte)
      { x: 23.5, y: 19.5, r: 5.5 },                         // Mittelinsel
      { x: 27, y: 6, r: 3 },                                // Vorposten-Eiland (gespiegelt vor dem Gegner)
      { x: 39, y: 9, r: 3.5 }                               // Eiland an der Flanke
    ],
    lakes: 0, forest: 0.2, mountain: 0.04, rivers: 0,
    desc: 'Ein Archipel: Jeder Spieler hält eine Heimatinsel, dazwischen locken Eilande mit Häfen, Städten und Fabriken. Ohne Schiffe und Flieger geht nichts.' },
  { id: 'kuestenkrieg', theme: 'herbst', name: 'Küstenkrieg', players: 2, w: 60, h: 36, shape: 'archipel', sym: 'rot2', anchor: [0.25, 0.14], seed: 139,
    archipelago: true, ports: 3, neutral: { O: 3 }, density: 18, reef: 0.62, beach: 0.5,
    islands: [
      { x: -6, y: -2, x2: 66, y2: -2, r: 8 }, { x: 15, y: 3, r: 6.5 }, { x: 42, y: 1, r: 6 },  // Küstenstreifen (Norden; Süden gespiegelt)
      { x: 29.5, y: 17.5, r: 4.5 },                                                           // Mittelinsel der Kette
      { x: 7, y: 18, r: 3.5 }, { x: 18, y: 19, r: 3 }                                         // weitere Kettenglieder (gespiegelt)
    ],
    lakes: 0, forest: 0.2, mountain: 0.06, rivers: 0,
    desc: 'Zwei lange Küsten liegen sich gegenüber, dazwischen ein Meer mit einer Inselkette. Wer die See beherrscht, landet, wo er will.' },
  { id: 'vier-inseln', theme: 'winter', name: 'Vier Inseln', players: 4, w: 57, h: 57, shape: 'archipel', sym: 'rot4', anchor: [0.18, 0.18], seed: 149,
    archipelago: true, ports: 2, expand: 3, neutral: { A: 1, O: 1 }, aBand: [0.35, 0.7], mid: { K: 1, A: 0, O: 1, C: 1 }, reef: 0.7, beach: 0.5,
    islands: [
      { x: 10, y: 10, r: 7 }, { x: 14, y: 14, r: 4 }, { x: 17.5, y: 17.5, r: 3 },   // Heimatinsel mit Halbinsel zur Mitte (Ecke; dreimal gedreht)
      { x: 28, y: 28, r: 6.5 },                               // Mittelinsel
      { x: 28, y: 9, r: 3.8 }                                 // Zwischeninseln (viermal)
    ],
    lakes: 0, forest: 0.2, mountain: 0.05, rivers: 0,
    desc: 'Vier Heimatinseln in den Ecken, eine reiche Insel in der Mitte, dazwischen Eilande mit Fabrik und Flughafen. Flotten und Landungsboote entscheiden.' },
  { id: 'dreimeer', theme: 'gebirge', name: 'Dreimeer', players: 3, w: 57, h: 57, shape: 'archipel', sym: 'rot3', anchor: [0.5, 0.17], seed: 151,
    archipelago: true, ports: 2, expand: 3, neutral: { A: 1, O: 2 }, aBand: [0.4, 0.8], reef: 0.6, beach: 0.5,
    islands: [
      { x: 28, y: 9.5, r: 7.5 },                           // Heimatinsel (dreimal gedreht)
      { x: 28, y: 28, r: 5.5 },                            // Mittelinsel
      { x: 44.5, y: 18.5, r: 4 },                          // umkämpfte Inseln zwischen zwei Nachbarn
      { x: 13.5, y: 7.5, r: 3 }                            // Vorinseln vor jeder Heimat
    ],
    lakes: 0, forest: 0.18, mountain: 0.12, rivers: 0,
    desc: 'Drei felsige Heimatinseln um ein stürmisches Binnenmeer voller Riffe. In der Mitte wartet eine Insel mit Fabrik, zwischen den Nachbarn liegen umkämpfte Eilande.' }
];

// ------------------------------------------------------------------ Generator
function generate(def) {
  const { w, h } = def;
  const N = w * h;
  const rand = makeRng(def.seed * 7919 + 1);
  const G = group(def.sym, w, h);
  const idx = (x, y) => y * w + x;
  const inb = (x, y) => x >= 0 && y >= 0 && x < w && y < h;
  const images = (x, y) => G.map(g => g.f(x, y)).filter(p => inb(p[0], p[1]));
  const canon = new Int32Array(N);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let best = idx(x, y);
    if (def.sym === 'rot3') {
      // Annäherung: Bild im ersten 120°-Sektor
      const cx = (w - 1) / 2, cy = (h - 1) / 2;
      let bestA = 99;
      images(x, y).forEach(p => {
        const a = (Math.atan2(p[1] - cy, p[0] - cx) + Math.PI * 2.5) % (Math.PI * 2);
        if (a < bestA) { bestA = a; best = idx(p[0], p[1]); }
      });
    } else images(x, y).forEach(p => { best = Math.min(best, idx(p[0], p[1])); });
    canon[idx(x, y)] = best;
  }
  const sym = F => { const o = new Float32Array(N); for (let i = 0; i < N; i++) o[i] = F[canon[i]]; return o; };

  // 1) Land/Wasser
  const coastN = sym(makeNoise(w, h, rand, 7, 3));
  const lakeN = sym(makeNoise(w, h, rand, 9, 2));
  const forestN = sym(makeNoise(w, h, rand, 6, 3));
  const mountN = sym(makeNoise(w, h, rand, 8, 3));
  const T = new Array(N).fill('P');
  const own = new Uint8Array(N);
  const shape = SHAPES[def.shape];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = idx(x, y), c = canon[i], cx = c % w, cy = (c - cx) / w;
    const u = cx / (w - 1), v = cy / (h - 1);
    const s = shape(u, v, def) + (coastN[i] - 0.5) * 0.12;
    if (s > 0) T[i] = 'S';
  }
  // Inselkarten: winzige Landflecken im Meer (vom Rauschen abgetrennt) wieder zu Wasser
  if (def.archipelago) {
    const lc = landComponents(T, w, h);
    for (let i = 0; i < N; i++) if (lc.comp[i] >= 0 && lc.sizes[lc.comp[i]] < (def.minIsland || 6)) T[i] = 'S';
  }
  // Rand immer Wasser bei Inselformen (Ränder sauber)
  // 2) Stützpunkt-Lage (vor Seen/Bergen, damit sie freigehalten werden)
  const anchors = [];
  {
    let ax = Math.round(def.anchor[0] * (w - 1)), ay = Math.round(def.anchor[1] * (h - 1));
    // nächstes Landfeld mit etwas Platz
    let best = null, bd = 1e9;
    for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
      if (T[idx(x, y)] !== 'P') continue;
      let land = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (T[idx(x + dx, y + dy)] === 'P') land++;
      if (land < 23) continue;
      const d = Math.abs(x - ax) + Math.abs(y - ay);
      if (d < bd) { bd = d; best = [x, y]; }
    }
    G.forEach((g, k) => { const p = g.f(best[0], best[1]); anchors.push({ x: p[0], y: p[1], player: g.perm[1] }); });
    if (def.anchor3) {
      const cx = (w - 1) / 2, ay3 = Math.round(def.anchor3[1] * (h - 1));
      let b3 = null, bd3 = 1e9;
      for (let y = 2; y < h - 2; y++) {
        let land = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (T[idx(cx + dx, y + dy)] === 'P') land++;
        if (T[idx(cx, y)] !== 'P' || land < 23) continue;
        if (Math.abs(y - ay3) < bd3) { bd3 = Math.abs(y - ay3); b3 = [cx, y]; }
      }
      anchors.push({ x: b3[0], y: b3[1], player: 3 });
    }
  }
  const nearAnchor = (x, y, r) => anchors.some(a => Math.abs(a.x - x) + Math.abs(a.y - y) <= r);

  // 3) Seen, Wald, Berge – Schwellen als Perzentile der Landfelder (Anteile laut Definition)
  function quantile(F, q) {
    const vals = []; for (let i = 0; i < N; i++) if (T[i] === 'P') vals.push(F[i]);
    vals.sort((a, b) => a - b); return vals[Math.min(vals.length - 1, Math.floor(vals.length * q))];
  }
  const ridgeF = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const x = i % w, y = (i - x) / w;
    ridgeF[i] = mountN[i];
    if (def.ridges) { const v = y / (h - 1); ridgeF[i] += Math.max(0, 0.3 - Math.min(v, 1 - v) * 2) * 1.5; }
  }
  const mThr = quantile(ridgeF, 1 - def.mountain), fThr = quantile(forestN, 1 - def.forest), lThr = quantile(lakeN, 1 - def.lakes);
  for (let i = 0; i < N; i++) {
    if (T[i] !== 'P') continue;
    const x = i % w, y = (i - x) / w;
    if (nearAnchor(x, y, 6)) { if (forestN[i] > 0.7) T[i] = 'F'; continue; }
    if (def.lakes && lakeN[i] > lThr) { T[i] = 'S'; continue; }
    if (ridgeF[i] > mThr) T[i] = 'M';
    else if (forestN[i] > fThr) T[i] = 'F';
  }
  // Seen ohne Verbindung zum Meer sind ok; kleine Wasserflecken (1–2 Felder) wieder zu Land
  for (let i = 0; i < N; i++) {
    if (T[i] !== 'S') continue;
    const x = i % w, y = (i - x) / w;
    let wet = 0;
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(d => { const nx = x + d[0], ny = y + d[1]; if (!inb(nx, ny) || T[idx(nx, ny)] === 'S') wet++; });
    if (wet === 0) T[i] = 'P';
  }

  // Abstand zum Wasser (für Flüsse und Küstenbauten)
  function waterDist() {
    const d = new Int32Array(N).fill(1e9), q = [];
    for (let i = 0; i < N; i++) if (T[i] === 'S') { d[i] = 0; q.push(i); }
    for (let k = 0; k < q.length; k++) {
      const i = q[k], x = i % w, y = (i - x) / w;
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(dd => {
        const nx = x + dd[0], ny = y + dd[1]; if (!inb(nx, ny)) return;
        const j = idx(nx, ny); if (d[j] > d[i] + 1) { d[j] = d[i] + 1; q.push(j); }
      });
    }
    return d;
  }
  let WD = waterDist();

  // 4) Flüsse: vom Landesinneren bergab zur nächsten Küste
  const placeAll = (x, y, t, owner) => {
    G.forEach(g => {
      const p = g.f(x, y); if (!inb(p[0], p[1])) return;
      const j = idx(p[0], p[1]);
      T[j] = t; own[j] = owner ? g.perm[owner] : 0;
    });
  };
  for (let r = 0; r < def.rivers; r++) {
    let tries = 0;
    while (tries++ < 200) {
      const x0 = 2 + Math.floor(rand() * (w - 4)), y0 = 2 + Math.floor(rand() * (h - 4));
      const i0 = idx(x0, y0);
      if (T[i0] === 'S' || WD[i0] < 7 || nearAnchor(x0, y0, 8)) continue;
      // Pfad bergab entlang des Wasserabstands
      const pathR = [[x0, y0]];
      let x = x0, y = y0, guard = 0, ok = false;
      while (guard++ < w + h) {
        const cand = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(d => [x + d[0], y + d[1]]).filter(p => inb(p[0], p[1]));
        const seen = new Set(pathR.map(p => p[0] + ',' + p[1]));
        const opts = cand.filter(p => !seen.has(p[0] + ',' + p[1]));
        if (!opts.length) break;
        opts.sort((a, b) => (WD[idx(a[0], a[1])] + rand() * 2.2) - (WD[idx(b[0], b[1])] + rand() * 2.2));
        const nx = opts[0][0], ny = opts[0][1];
        if (T[idx(nx, ny)] === 'S') { ok = true; break; }
        if (WD[idx(nx, ny)] > WD[idx(x, y)] + 1) break;
        // nicht neben den eigenen Lauf zurückfallen (sonst Flussflächen)
        const touch = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(d => seen.has((nx + d[0]) + ',' + (ny + d[1]))).length;
        if (touch > 1) break;
        x = nx; y = ny;
        if (nearAnchor(x, y, 4)) break;
        pathR.push([x, y]);
      }
      if (!ok || pathR.length < 5) continue;
      pathR.forEach(p => placeAll(p[0], p[1], 'I', 0));
      break;
    }
  }
  // Strände: Teile der Küste
  const beachN = sym(makeNoise(w, h, rand, 5, 2));
  const beachThr = def.beach != null ? def.beach : 0.55;
  const isCoastTile = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(d => { const nx = x + d[0], ny = y + d[1]; return inb(nx, ny) && T[idx(nx, ny)] === 'S'; });
  for (let i = 0; i < N; i++) {
    if (T[i] !== 'P' && T[i] !== 'F') continue;
    const x = i % w, y = (i - x) / w;
    const coast = isCoastTile(x, y);
    if (coast && beachN[i] > beachThr && !nearAnchor(x, y, 3)) T[i] = 'H';
  }
  // Riffe im offenen Meer
  WD = waterDist();
  const reefThr = def.reef != null ? def.reef : 0.8;
  for (let i = 0; i < N; i++) {
    if (T[i] !== 'S') continue;
    const x = i % w, y = (i - x) / w;
    let landNear = false;
    for (let dy = -2; dy <= 2 && !landNear; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx, ny = y + dy; if (inb(nx, ny) && T[idx(nx, ny)] !== 'S' && T[idx(nx, ny)] !== 'X') { landNear = true; break; }
    }
    if (!landNear && beachN[canon[i]] > reefThr && lakeN[i] > 0.6) T[i] = 'X';
  }
  // Inselkarten: Landkomponenten (Inseln) bestimmen; jede Insel braucht mindestens zwei Strandfelder zum Anlanden
  let comp = null, compSizes = null;
  if (def.archipelago) {
    ({ comp, sizes: compSizes } = landComponents(T, w, h));
    compSizes.forEach((size, id) => {
      if (size < 6) return;
      let guard = 0;
      while (guard++ < 4) {
        let beaches = 0;
        for (let i = 0; i < N; i++) if (comp[i] === id && T[i] === 'H') beaches++;
        if (beaches >= 2) break;
        let best = -1, bv = -1;
        for (let i = 0; i < N; i++) {
          if (comp[i] !== id || (T[i] !== 'P' && T[i] !== 'F')) continue;
          const x = i % w, y = (i - x) / w;
          if (!isCoastTile(x, y) || nearAnchor(x, y, 3) || beachN[i] <= bv) continue;
          bv = beachN[i]; best = i;
        }
        if (best < 0) break;
        placeAll(best % w, (best - best % w) / w, 'H', 0);
      }
    });
  }

  // 5) Gebäude
  // Reihenfolge: Heimatbasis (HQ, 2 Fabriken, Hafen, Flughafen, 4 Städte) -> Expansionsstädte rund ums HQ ->
  // Vorposten-Fabrik auf halbem Weg -> Mitte-Cluster -> zusätzliche Häfen/Flughäfen -> Füllstädte bis zur Zieldichte.
  // Alles wird als Bahn der Symmetriegruppe gesetzt (ein Gebäude je Spieler bzw. ein Fixpunkt für alle).
  const isBuildable = (x, y) => inb(x, y) && (T[idx(x, y)] === 'P' || T[idx(x, y)] === 'F');
  // Häfen nur an großen Gewässern (Meer bzw. Binnenmeer ab 80 Feldern), nicht an kleinen Seen
  const waterComp = new Int32Array(N).fill(-1), waterSize = [];
  for (let s0 = 0; s0 < N; s0++) {
    if (waterComp[s0] >= 0 || T[s0] !== 'S') continue;
    const q = [s0]; waterComp[s0] = waterSize.length;
    for (let k = 0; k < q.length; k++) {
      const i = q[k], x = i % w, y = (i - x) / w;
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(d => {
        const nx = x + d[0], ny = y + d[1]; if (!inb(nx, ny)) return;
        const j = idx(nx, ny); if (waterComp[j] < 0 && (T[j] === 'S' || T[j] === 'X')) { waterComp[j] = waterSize.length; q.push(j); }
      });
    }
    waterSize.push(q.length);
  }
  const coastal = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(d => {
    const nx = x + d[0], ny = y + d[1];
    return inb(nx, ny) && T[idx(nx, ny)] === 'S' && waterSize[waterComp[idx(nx, ny)]] >= 80;
  });
  const isCoastBuildable = (x, y) => inb(x, y) && (T[idx(x, y)] === 'P' || T[idx(x, y)] === 'F' || T[idx(x, y)] === 'H') && coastal(x, y);
  // Wasserfelder im 5×5-Umfeld (Häfen brauchen offenes Wasser davor)
  const wetAround = (x, y) => {
    let n = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (inb(x + dx, y + dy) && T[idx(x + dx, y + dy)] === 'S') n++;
    return n;
  };
  const bldg = [];
  const minDistB = (x, y) => { let m = 1e9; for (const b of bldg) { const d = Math.abs(b.x - x) + Math.abs(b.y - y); if (d < m) m = d; } return m; };
  const farFromBuildings = (x, y, r) => minDistB(x, y) >= r;
  // Bahn eines Feldes: die verschiedenen Bilder unter der Symmetriegruppe (null, wenn ein Bild außerhalb liegt)
  const orbitOf = (x, y) => {
    const im = images(x, y);
    if (im.length !== G.length) return null;
    const out = [];
    im.forEach(p => { if (!out.some(q => q[0] === p[0] && q[1] === p[1])) out.push(p); });
    return out;
  };
  // Bahn zulässig: alle Bilder erfüllen test und liegen paarweise ≥ minSep auseinander; Fixpunkte (Bilder fallen
  // zusammen, z. B. Kartenmitte) nur mit partial – für Spielergebäude nie, die braucht jeder Spieler einzeln.
  const orbitOk = (x, y, minSep, test, partial) => {
    const im = orbitOf(x, y);
    if (!im || (!partial && im.length !== G.length)) return false;
    for (let a = 0; a < im.length; a++) for (let b = a + 1; b < im.length; b++) {
      if (Math.abs(im[a][0] - im[b][0]) + Math.abs(im[a][1] - im[b][1]) < minSep) return false;
    }
    return im.every(p => (test || isBuildable)(p[0], p[1]));
  };
  const addBuilding = (x, y, t, owner) => {
    const done = new Set();
    G.forEach(g => {
      const p = g.f(x, y); if (!inb(p[0], p[1])) return;
      const j = idx(p[0], p[1]);
      if (done.has(j)) return;
      done.add(j);
      T[j] = t; own[j] = owner ? g.perm[owner] : 0;
      bldg.push({ x: p[0], y: p[1], t, owner: own[j] });
    });
  };
  const a1 = anchors.find(a => a.player === 1) || anchors[0];
  const a3 = anchors.find(a => a.player === 3 && def.anchor3) || null;
  const homes = a3 ? [a1, a3] : [a1];
  const axisX = (w - 1) / 2;
  // Region eines Stützpunkts: Felder, die ihm am nächsten liegen; für Spieler 3 (Spiegelachse) nur die linke Hälfte
  // samt Achse – die rechte entsteht durch Spiegelung.
  const homeOf = (x, y) => { let best = null, bd = 1e9; anchors.forEach(a => { const d = Math.abs(a.x - x) + Math.abs(a.y - y); if (d < bd) { bd = d; best = a; } }); return best; };
  const inRegion = (a, x, y) => homeOf(x, y) === a && (a !== a3 || x <= axisX);
  const hqDistOf = a => Math.min(...anchors.filter(b => b !== a).map(b => Math.abs(b.x - a.x) + Math.abs(b.y - a.y)));
  const hqDist = hqDistOf(a1);
  const ownerOf = a => (a === a3 ? 3 : 1);
  // Mittelpunkt der umkämpften Mitte: def.center, sonst Kartenmitte; bei drei Spielern der Punkt auf der Achse mit
  // gleichem Abstand zu allen HQs
  let mid = { x: axisX, y: (h - 1) / 2 };
  if (def.center) mid = { x: def.center[0] * (w - 1), y: def.center[1] * (h - 1) };
  else if (a3) {
    // gleicher Abstand ist in Manhattan-Metrik oft ein ganzer Strahl -> zusätzlich den Abstand selbst minimieren
    let bs = 1e9;
    for (let y = 0; y < h; y++) {
      const d1 = Math.abs(axisX - a1.x) + Math.abs(y - a1.y), d3 = Math.abs(y - a3.y);
      const s = Math.abs(d1 - d3) * 10 + Math.max(d1, d3);
      if (s < bs) { bs = s; mid = { x: axisX, y }; }
    }
  }
  // Inselkarten: Landkomponenten mit HQ (Heimatinseln) und neutrale Inseln (größte zuerst)
  let anchorComps = null, islands = [];
  if (def.archipelago) {
    anchorComps = new Set(anchors.map(a => comp[idx(a.x, a.y)]));
    islands = compSizes.map((s, id) => id).filter(id => compSizes[id] >= 6 && !anchorComps.has(id)).sort((a, b) => compSizes[b] - compSizes[a]);
  }
  const offHome = (x, y) => !anchorComps || !anchorComps.has(comp[idx(x, y)]);
  const midIsland = def.archipelago && islands.length ? (x, y) => comp[idx(x, y)] === islands[0] : null;

  // Allgemeine Platzierung: Kandidaten im Manhattan-Ring [dMin, dMax] um o.at (Standard: Stützpunkt o.home), in der
  // Region von o.home (falls gesetzt), sortiert nach o.score + Zufall. Rückgabe: gesetzte Gebäude je Spieler.
  // Für Spieler 3 zählt ein gespiegeltes Paar doppelt, ein Achsenfeld einfach.
  function place(t, owner, count, o) {
    if (count <= 0) return 0;
    const at = o.at || o.home, sep = o.sep != null ? o.sep : 2;
    const test = o.coast ? isCoastBuildable : isBuildable;
    const isA3 = !!o.home && o.home === a3;
    const partial = !!o.partial || isA3;
    const minSep = o.minSep != null ? o.minSep : (isA3 ? 2 : 6);
    const cands = [];
    const xa = Math.max(0, Math.floor(at.x - o.dMax)), xb = Math.min(w - 1, Math.ceil(at.x + o.dMax));
    const ya = Math.max(0, Math.floor(at.y - o.dMax)), yb = Math.min(h - 1, Math.ceil(at.y + o.dMax));
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
      const d = Math.abs(x - at.x) + Math.abs(y - at.y);
      if (d < o.dMin || d > o.dMax || !test(x, y)) continue;
      if (o.home && !inRegion(o.home, x, y)) continue;
      if (o.wet && wetAround(x, y) < o.wet) continue;
      if (o.filter && !o.filter(x, y, d)) continue;
      cands.push({ x, y, s: (o.score ? o.score(x, y, d) : 0) + rand() * (o.jitter != null ? o.jitter : 3) });
    }
    cands.sort((a, b) => a.s - b.s);
    let n = 0;
    for (const c of cands) {
      if (n >= count) break;
      if (!farFromBuildings(c.x, c.y, sep) || !orbitOk(c.x, c.y, minSep, test, partial)) continue;
      const wgt = isA3 ? orbitOf(c.x, c.y).length : 1;
      if (n + wgt > count) continue;
      addBuilding(c.x, c.y, t, owner); n += wgt;
    }
    return n;
  }
  // Füllen mit Abstand („bester Kandidat“): von je 30 Zufallsfeldern das mit dem größten Abstand zu allen Gebäuden
  // (gekappt bei 9, damit es nicht schematisch wird). Rückgabe: gesetzte Gebäude je Spieler (Spieler 3 wie oben).
  function fill(t, home, count, o) {
    o = o || {};
    const isA3 = home === a3, test = o.coast ? isCoastBuildable : isBuildable;
    let n = 0, fails = 0;
    while (n < count && fails < 40) {
      let best = null;
      for (let k = 0; k < 30; k++) {
        const x = 1 + Math.floor(rand() * (w - 2)), y = 1 + Math.floor(rand() * (h - 2));
        if (!test(x, y) || !inRegion(home, x, y) || nearAnchor(x, y, o.near != null ? o.near : 6)) continue;
        if (o.wet && wetAround(x, y) < o.wet) continue;
        if (o.filter && !o.filter(x, y)) continue;
        const md = minDistB(x, y);
        if (md < (o.sep || 4) || !orbitOk(x, y, 4, test, true)) continue;
        const wgt = isA3 ? orbitOf(x, y).length : 1;
        if (n + wgt > count) continue;
        const s = Math.min(md, 9) + rand() * 2;
        if (!best || s > best.s) best = { x, y, s, wgt };
      }
      if (!best) { fails++; continue; }
      addBuilding(best.x, best.y, t, 0); n += best.wgt;
    }
    return n;
  }

  // 5a) Heimatbasis je Stützpunkt
  const others = anchors.filter(a => a !== a1);
  const ex = others.reduce((s, a) => s + a.x, 0) / others.length, ey = others.reduce((s, a) => s + a.y, 0) / others.length;
  const toEnemy = (x, y) => Math.hypot(x - ex, y - ey);
  // Inselkarten: Heimatgebäude und Expansionsstädte nur auf der Insel des HQs
  const isleOf = a => (def.archipelago ? (x, y) => comp[idx(x, y)] === comp[idx(a.x, a.y)] : null);
  homes.forEach(a => {
    const pl = ownerOf(a), isle = isleOf(a);
    addBuilding(a.x, a.y, 'Q', pl);
    place('K', pl, 2, { home: a, dMin: 2, dMax: 4, filter: isle });
    // Häfen: auf Inselkarten an der den Gegnern zugewandten Küste, sonst die nächste Küste (≤ 8, notfalls ≤ 12)
    const nP = def.ports || 1;
    const portOpt = { home: a, dMin: 1, dMax: 8, sep: def.archipelago ? 4 : 3, coast: true, wet: def.archipelago ? 8 : 6, filter: isle,
      score: def.archipelago ? (x, y, d) => d + Math.max(0, toEnemy(x, y) - toEnemy(a.x, a.y)) : (x, y, d) => d };
    let np = 0;
    // Inselkarten: der erste Hafen an der Küste, die der Mittelinsel am nächsten liegt (kurzer Seeweg zur Mitte)
    if (def.archipelago) np = place('O', pl, Math.min(1, nP), Object.assign({}, portOpt, { dMax: 18, score: (x, y, d) => Math.hypot(x - mid.x, y - mid.y) + d * 0.3 }));
    np += place('O', pl, nP - np, portOpt);
    if (np < nP) np += place('O', pl, nP - np, Object.assign({}, portOpt, { dMax: def.archipelago ? 13 : 12 }));
    if (!place('A', pl, 1, { home: a, dMin: 3, dMax: 6, filter: isle })) place('A', pl, 1, { home: a, dMin: 3, dMax: 9, filter: isle });
    const nc = place('C', pl, 4, { home: a, dMin: 2, dMax: 6, filter: isle });
    if (nc < 4) place('C', pl, 4 - nc, { home: a, dMin: 2, dMax: 9, filter: isle });
  });

  // 5b) Expansionsstädte: neutrale Städte 4–9 Felder ums HQ für frühe Einnahmen (die erste höchstens 6 entfernt);
  // auf Inselkarten nur auf der Heimatinsel
  const nExp = def.expand != null ? def.expand : 4;
  homes.forEach(a => {
    const sameIsland = isleOf(a);
    let n = place('C', 0, Math.min(1, nExp), { home: a, dMin: 4, dMax: 6, sep: 3, partial: true, filter: sameIsland });
    if (!n && a === a3 && nExp >= 2) n = place('C', 0, 2, { home: a, dMin: 4, dMax: 6, sep: 3, filter: sameIsland }); // Achse belegt: Paar
    n += place('C', 0, nExp - n, { home: a, dMin: 4, dMax: 9, sep: 3, partial: true, filter: sameIsland });
  });

  // 5c) Vorposten: je Spieler eine neutrale Fabrik bei 35–50 % des HQ-Abstands, in Richtung Mitte und etwas seitlich
  // versetzt (def.side × HQ-Abstand), damit die Front Breite bekommt; auf Inselkarten auf einem Eiland
  const fw = def.forward === 0 ? null : (def.forward || [0.35, 0.5]);
  const side = def.side != null ? def.side : 0.2;
  if (fw) homes.forEach(a => {
    const hd = hqDistOf(a), dx = mid.x - a.x, dy = mid.y - a.y, L = Math.hypot(dx, dy) || 1;
    const perp = (x, y) => Math.abs((x - a.x) * dy - (y - a.y) * dx) / L;
    const ahead = (x, y) => (x - a.x) * dx + (y - a.y) * dy > 0;
    const opt = { home: a, dMin: Math.round(hd * fw[0]), dMax: Math.round(hd * fw[1]), sep: 4, partial: true,
      filter: def.archipelago ? (x, y) => offHome(x, y) && !(midIsland && midIsland(x, y)) : ahead,
      score: (x, y, d) => Math.abs(perp(x, y) - side * hd) + Math.abs(d - hd * (fw[0] + fw[1]) / 2) * 0.5 };
    if (!place('K', 0, 1, opt)) place('K', 0, 1, Object.assign({}, opt, { dMin: Math.round(hd * 0.25), dMax: Math.round(hd * 0.7), filter: def.archipelago ? offHome : ahead }));
  });

  // 5d) Mitte-Cluster: Fabrik, Flughafen, Hafen (falls Küste) und Städte um den Mittelpunkt (Anzahl = Bahnen)
  const md = def.mid || {};
  const midOpt = { at: mid, dMin: 0, sep: 3, minSep: 3, partial: true, score: (x, y, d) => d, filter: midIsland, jitter: 2 };
  place('K', 0, md.K != null ? md.K : 1, Object.assign({}, midOpt, { dMax: 6 }));
  place('A', 0, md.A != null ? md.A : 1, Object.assign({}, midOpt, { dMax: 8 }));
  place('O', 0, md.O != null ? md.O : 1, Object.assign({}, midOpt, { dMax: 10, coast: true, wet: 6, minSep: 4 }));
  place('C', 0, md.C != null ? md.C : 2, Object.assign({}, midOpt, { dMin: 1, dMax: 9, score: null, jitter: 1 }));

  // 5e) Zusätzliche neutrale Häfen und Flughäfen (Bahnen) sowie Füllstädte bis zur Zieldichte
  const land = T.filter(t => t !== 'S' && t !== 'X').length;
  const nd = def.neutral || {};
  const dA1 = (x, y) => Math.abs(x - a1.x) + Math.abs(y - a1.y);
  const nO = nd.O != null ? nd.O : Math.floor(w * h / 2500);
  const nA = nd.A != null ? nd.A : 0;
  const aBand = def.aBand || [0.25, 0.9];
  if (def.archipelago) {
    // Jede neutrale Insel bekommt eine Stadt, dann Häfen über die Inseln verteilt (erst je Insel einer), dann Flughäfen
    const hasCity = id => bldg.some(b => b.t === 'C' && comp[idx(b.x, b.y)] === id);
    islands.forEach(id => {
      if (hasCity(id)) return; // schon durch ein Spiegelbild versorgt
      let best = null, bk = -1e9;
      for (let i = 0; i < N; i++) {
        if (comp[i] !== id) continue;
        const x = i % w, y = (i - x) / w;
        if (homeOf(x, y) !== a1 || !farFromBuildings(x, y, 3) || !orbitOk(x, y, 4, null, true)) continue;
        const k = WD[i] + rand(); // lieber im Inselinneren, Küste bleibt frei
        if (k > bk) { bk = k; best = [x, y]; }
      }
      if (best) addBuilding(best[0], best[1], 'C', 0);
    });
    islands.forEach(id => { if (!hasCity(id)) console.warn('Hinweis: ' + def.id + ' – Insel #' + id + ' (' + compSizes[id] + ' Felder) ohne Stadt'); });
    placePort(nO, (x, y, d) => d > 6 && offHome(x, y));
    fill('A', a1, nA, { near: 6, sep: 3, filter: (x, y) => offHome(x, y) && dA1(x, y) > hqDist * aBand[0] && dA1(x, y) < hqDist * aBand[1] });
  } else {
    placePort(nO, (x, y, d) => d > 10);
    fill('A', a1, nA, { near: 8, sep: 6, filter: (x, y) => dA1(x, y) > hqDist * aBand[0] && dA1(x, y) < hqDist * aBand[1] });
  }
  // Füllstädte: Zielgröße land / density Gebäude insgesamt; bei drei Spielern nach Fläche auf die Regionen verteilt
  const need = Math.round(land / (def.density || 21)) - bldg.length;
  if (need > 0) {
    if (a3) {
      let area1 = 0, area3 = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (T[idx(x, y)] === 'S' || T[idx(x, y)] === 'X') continue;
        const ho = homeOf(x, y); if (ho === a1) area1++; else if (ho === a3) area3++;
      }
      const n3 = Math.round(need * area3 / (2 * area1 + area3));
      fill('C', a1, Math.round((need - n3) / 2));
      fill('C', a3, n3);
    } else fill('C', a1, Math.round(need / G.length));
  }

  // Neutrale Häfen in der Region von Spieler 1 (gespiegelt); auf Inselkarten erst je Insel höchstens einer
  function placePort(count, filter) {
    const cands = [];
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      if (!isCoastBuildable(x, y) || homeOf(x, y) !== a1) continue;
      const d = dA1(x, y);
      if (filter && !filter(x, y, d)) continue;
      if (wetAround(x, y) < 6) continue;
      cands.push({ x, y, d: d + rand() * 3 });
    }
    cands.sort((a, b) => a.d - b.d);
    let n = 0;
    // Inseln mit Hafen (z. B. aus dem Mitte-Cluster) gelten in der ersten Runde als versorgt
    const usedIsland = new Set(def.archipelago ? bldg.filter(b => b.t === 'O').map(b => comp[idx(b.x, b.y)]) : []);
    for (let round = 0; round < (def.archipelago ? 2 : 1) && n < count; round++) {
      for (const c of cands) {
        if (n >= count) break;
        if (!farFromBuildings(c.x, c.y, 5)) continue;
        if (def.archipelago && round === 0 && usedIsland.has(comp[idx(c.x, c.y)])) continue;
        if (!orbitOk(c.x, c.y, 4, isCoastBuildable, true)) continue;
        addBuilding(c.x, c.y, 'O', 0); n++;
        if (def.archipelago) orbitOf(c.x, c.y).forEach(p => usedIsland.add(comp[idx(p[0], p[1])])); // Spiegelinseln gelten als versorgt
      }
    }
    return n;
  }

  // 6) Straßen: Knoten verbinden (A*), Pfade inkl. Bildern übernehmen
  const roadCost = t => ({ P: 1.2, F: 2.5, M: 7, H: 2, I: 4, R: 0.6, B: 0.6, S: def.seaBridges ? (def.bridge || 9) : 0, X: 0 })[t];
  // Dijkstra/A* über Straßenkosten von mehreren Startfeldern zu irgendeinem Zielfeld (goal(i) === true);
  // heur(x, y) = Schätzung bis zum Ziel (0 = reiner Dijkstra). noSea: Meer nie überbrücken.
  function roadPath(starts, goal, heur, noSea) {
    const dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1);
    const heap = [];
    const push = (f, i, g) => { heap.push([f, i, g]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
    starts.forEach(s => { dist[s] = 0; push(0, s, 0); });
    let found = -1;
    while (heap.length) {
      const [, i, g0] = pop();
      if (g0 > dist[i]) continue; // veralteter Eintrag
      if (goal(i)) { found = i; break; }
      const x = i % w, y = (i - x) / w;
      for (const dd of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dd[0], ny = y + dd[1]; if (!inb(nx, ny)) continue;
        const j = idx(nx, ny), tt = T[j];
        // Meer neben einem Hafen bleibt frei (sonst verliert der Hafen seinen Zugang zum Wasser)
        const c = 'CKAOQ'.indexOf(tt) >= 0 ? 0.8 : (tt === 'S' && (noSea || nextToPort(nx, ny)) ? 0 : roadCost(tt));
        if (!c) continue;
        const nd2 = dist[i] + c;
        if (nd2 < dist[j]) { dist[j] = nd2; prev[j] = i; push(nd2 + heur(nx, ny), j, nd2); }
      }
    }
    if (found < 0) return null;
    const out = []; let k = found;
    while (k >= 0) { out.push([k % w, (k - k % w) / w]); k = prev[k]; }
    return out.reverse();
  }
  const nextToPort = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(d => inb(x + d[0], y + d[1]) && T[idx(x + d[0], y + d[1])] === 'O');
  const astar = (sx, sy, tx, ty) => roadPath([idx(sx, sy)], i => i === idx(tx, ty), (x, y) => (Math.abs(x - tx) + Math.abs(y - ty)) * 0.6);
  const paveTile = (x, y) => {
    const j = idx(x, y), t = T[j];
    if ('CKAOQRB'.indexOf(t) >= 0) return;
    if (t === 'I' || t === 'S' || t === 'X') T[j] = 'B';
    else T[j] = 'R';
  };
  const pave = p => {
    // Pfad samt allen Bildern pflastern; Lücken (rot3-Rundung) schließen
    G.forEach(g => {
      let last = null;
      p.forEach(pt => {
        const q = g.f(pt[0], pt[1]);
        if (last) {
          let x = last[0], y = last[1];
          while (x !== q[0] || y !== q[1]) {
            if (x !== q[0]) x += Math.sign(q[0] - x); else y += Math.sign(q[1] - y);
            if (inb(x, y) && (def.seaBridges || 'SX'.indexOf(T[idx(x, y)]) < 0)) paveTile(x, y);
          }
        } else if (inb(q[0], q[1]) && (def.seaBridges || 'SX'.indexOf(T[idx(q[0], q[1])]) < 0)) paveTile(q[0], q[1]);
        last = q;
      });
    });
  };
  const nodes = bldg.filter(b => homes.some(a => inRegion(a, b.x, b.y)) && (b.t !== 'C' || rand() < 0.35));
  // Minimaler Spannbaum über die Knoten (Manhattan-Distanz), dann zusätzliche Querverbindungen
  const edges = [];
  const spanTree = list => {
    const inTree = new Set([0]);
    while (inTree.size < list.length) {
      let best = null;
      list.forEach((a, i) => {
        if (!inTree.has(i)) return;
        list.forEach((b, j) => {
          if (inTree.has(j)) return;
          const d = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
          if (!best || d < best.d) best = { a, b, j, d };
        });
      });
      inTree.add(best.j); edges.push(best);
    }
  };
  if (def.archipelago) {
    // Inselkarte: Straßen nur innerhalb einer Insel (keine Brücken, keine HQ-Achse)
    const byIsland = new Map();
    nodes.forEach(b => { const c = comp[idx(b.x, b.y)]; if (!byIsland.has(c)) byIsland.set(c, []); byIsland.get(c).push(b); });
    byIsland.forEach(spanTree);
  } else {
    // Hauptachse zuerst (später gebaute Straßen nutzen sie): Mitte untereinander (Bilder des Mitte-Gebäudes –
    // Querstraße bzw. Brücke durch die Kartenmitte), HQ zur Mitte, HQ zu den gegnerischen HQs; dann der Spannbaum
    const midB = bldg.filter(b => !b.owner && 'KA'.indexOf(b.t) >= 0).sort((p, q) => Math.hypot(p.x - mid.x, p.y - mid.y) - Math.hypot(q.x - mid.x, q.y - mid.y))[0];
    if (midB) {
      orbitOf(midB.x, midB.y).forEach(p => { if (p[0] !== midB.x || p[1] !== midB.y) edges.push({ a: midB, b: { x: p[0], y: p[1] } }); });
      homes.forEach(a => edges.push({ a, b: midB }));
    }
    const hqs = bldg.filter(b => b.t === 'Q');
    hqs.forEach(a => hqs.forEach(b => { if (a !== b && a.owner < b.owner) edges.push({ a, b }); }));
    spanTree(nodes);
  }
  edges.forEach(e => {
    const p = astar(e.a.x, e.a.y, e.b.x, e.b.y);
    if (p) pave(p);
  });
  // Abgeschnittene Taschen: Landstücke, die Kettenfahrzeuge (keine Berge/Flüsse) nicht vom Kern ihrer Landmasse
  // erreichen – Kern = Teil mit HQ, sonst der größte –, bekommen eine Straße (Brücke bzw. Pass) dorthin, sofern sie
  // ein Gebäude tragen oder mindestens 5 Felder groß sind.
  const TREAD_OK = 'PFRBHCKAOQ';
  for (let round = 0; round < 8; round++) {
    const lc = landComponents(T, w, h);
    const tc = new Int32Array(N).fill(-1), tSize = [], tBld = [];
    for (let s = 0; s < N; s++) {
      if (tc[s] >= 0 || TREAD_OK.indexOf(T[s]) < 0) continue;
      const id = tSize.length, q = [s]; tc[s] = id;
      let nb = 0;
      for (let k = 0; k < q.length; k++) {
        const i = q[k], x = i % w, y = (i - x) / w;
        if ('CKAOQ'.indexOf(T[i]) >= 0) nb++;
        for (const dd of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dd[0], ny = y + dd[1]; if (!inb(nx, ny)) continue;
          const j = idx(nx, ny);
          if (tc[j] < 0 && TREAD_OK.indexOf(T[j]) >= 0) { tc[j] = id; q.push(j); }
        }
      }
      tSize.push(q.length); tBld.push(nb);
    }
    // Kern je Landmasse: Teil mit HQ, sonst der größte
    const core = new Map(), withHQ = new Set();
    for (let i = 0; i < N; i++) if (T[i] === 'Q') { core.set(lc.comp[i], tc[i]); withHQ.add(lc.comp[i]); }
    for (let i = 0; i < N; i++) {
      if (tc[i] < 0 || withHQ.has(lc.comp[i])) continue;
      const cur = core.get(lc.comp[i]);
      if (cur == null || tSize[tc[i]] > tSize[cur]) core.set(lc.comp[i], tc[i]);
    }
    // erste Tasche suchen, die angebunden werden muss
    let pocket = -1;
    for (let i = 0; i < N && pocket < 0; i++) {
      if (tc[i] < 0 || tc[i] === core.get(lc.comp[i])) continue;
      if (tBld[tc[i]] > 0 || tSize[tc[i]] >= 5) pocket = tc[i];
    }
    if (pocket < 0) break;
    const starts = []; for (let i = 0; i < N; i++) if (tc[i] === pocket) starts.push(i);
    const target = core.get(lc.comp[starts[0]]);
    const p = roadPath(starts, i => tc[i] === target, () => 0, true);
    if (!p) break;
    pave(p);
  }

  const rows = [];
  for (let y = 0; y < h; y++) {
    let s = '';
    for (let x = 0; x < w; x++) { const i = idx(x, y); s += T[i] + (own[i] ? String(own[i]) : '.'); }
    rows.push(s);
  }
  return { id: def.id, name: def.name, players: def.players, desc: def.desc, theme: def.theme || 'sommer', rows, units: [] };
}

// ------------------------------------------------------------------ Fairness (Fußwege wie tools/check-maps.js)
const FOOT_COST = { P: 1, F: 1, M: 2, R: 1, B: 1, I: 2, H: 1, C: 1, K: 1, A: 1, O: 1, Q: 1 };
function fairness(m) {
  const w = m.rows[0].length / 2, h = m.rows.length, N = w * h;
  const T = [], O = [];
  m.rows.forEach(r => { for (let x = 0; x < w; x++) { T.push(r[x * 2]); O.push(r[x * 2 + 1] === '.' ? 0 : +r[x * 2 + 1]); } });
  const hq = {};
  T.forEach((t, i) => { if (t === 'Q') hq[O[i]] = i; });
  const dist = {};
  Object.keys(hq).forEach(p => {
    const d = new Int32Array(N).fill(1e9), q = [hq[p]]; d[hq[p]] = 0;
    // Dijkstra light (Kosten 1/2) über Bucket-Queue
    const buckets = [[hq[p]]];
    for (let c = 0; c < buckets.length; c++) {
      const b = buckets[c]; if (!b) continue;
      for (const i of b) {
        if (d[i] !== c) continue;
        const x = i % w, y = (i - x) / w;
        for (const dd of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dd[0], ny = y + dd[1]; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx, k = FOOT_COST[T[j]]; if (!k) continue;
          if (c + k < d[j]) { d[j] = c + k; (buckets[c + k] || (buckets[c + k] = [])).push(j); }
        }
      }
    }
    dist[p] = d;
  });
  const ps = Object.keys(hq);
  const near = ps.map(p => Math.min(...ps.filter(q => q !== p).map(q => dist[p][hq[q]])));
  const zone = {}; ps.forEach(p => zone[p] = 0);
  T.forEach((t, i) => {
    if ('CKAO'.indexOf(t) < 0 || O[i]) return;
    const ds = ps.map(p => dist[p][i]), mn = Math.min(...ds);
    const win = ps.filter((p, k) => ds[k] === mn);
    win.forEach(p => zone[p] += 1 / win.length);
  });
  const zs = Object.values(zone);
  // Gleiche Gebäudeausstattung je Spieler ist Pflicht
  const kit = {};
  T.forEach((t, i) => { if (O[i] && 'QCKAO'.indexOf(t) >= 0) { const k = kit[O[i]] || (kit[O[i]] = {}); k[t] = (k[t] || 0) + 1; } });
  const sig = ps.map(p => 'QKACO'.split('').map(t => (kit[p] && kit[p][t]) || 0).join(','));
  const kitPenalty = sig.every(x => x === sig[0]) ? 0 : 1000;
  return { near, zone, kit: sig, score: kitPenalty + Math.max(...near) - Math.min(...near) + 2 * (Math.max(...zs) - Math.min(...zs)) };
}
/** Summe über alle HQs: wie viele Felder (bis 5) fehlen bis zum nächsten Meer- oder Randfeld */
function coastPenalty(m) {
  const w = m.rows[0].length / 2, h = m.rows.length;
  const t = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 'S' : m.rows[y][x * 2];
  let pen = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (t(x, y) !== 'Q') continue;
    let d = 5;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const k = Math.abs(dx) + Math.abs(dy);
      if (k < d && (t(x + dx, y + dy) === 'S' || t(x + dx, y + dy) === 'X')) d = k;
    }
    pen += 5 - d;
  }
  return pen;
}
function generateBest(def) {
  if (!def.anchor3) return generate(def);
  let best = null;
  // Suchraum (def.search: {u, v, v3} als [von, bis]) bewusst nicht am äußersten Rand: hinter den HQs bleibt Ausbaugebiet
  const S = Object.assign({ u: [0.12, 0.32], v: [0.14, 0.5], v3: [0.55, 0.88] }, def.search || {});
  for (let u1 = S.u[0]; u1 <= S.u[1] + 1e-9; u1 += 0.03) {
    for (let v1 = S.v[0]; v1 <= S.v[1] + 1e-9; v1 += 0.05) {
      for (let v3 = S.v3[0]; v3 <= S.v3[1] + 1e-9; v3 += 0.03) {
        for (let s = 0; s < 2; s++) {
          const d2 = Object.assign({}, def, { anchor: [u1, v1], anchor3: [0.5, v3], seed: def.seed + s * 1000 });
          let m;
          try { m = generate(d2); } catch (e) { continue; }
          const f = fairness(m);
          // Zielbereich der HQ-Wege (def.hqRange, Standard 35–55) zählt mit
          const range = def.hqRange || [35, 55];
          f.score += Math.max(0, range[0] - Math.min(...f.near)) + Math.max(0, Math.max(...f.near) - range[1]);
          // HQs nicht direkt an die Küste/den Rand: Strafe, wenn das Meer näher als 5 Felder liegt
          f.score += coastPenalty(m) * 1.5;
          // bei Gleichstand: HQ-Wege nahe der Mitte des Zielbereichs
          f.score += Math.abs(f.near.reduce((a, b) => a + b, 0) / f.near.length - (range[0] + range[1]) / 2) * 0.02;
          if (!best || f.score < best.f.score) best = { m, f, d2 };
        }
      }
    }
  }
  const d = best.d2;
  console.error(`  ${def.id}: Spieler 1 bei (${d.anchor.map(x => x.toFixed(2))}), Spieler 3 bei v=${d.anchor3[1].toFixed(2)} – HQ-Wege ${best.f.near.join('/')}, Zonen ${Object.values(best.f.zone).map(z => z.toFixed(1)).join('/')}`);
  return best.m;
}

// ------------------------------------------------------------------ Ausgabe
function toJs(maps) {
  const lines = [];
  lines.push('// FRONTLINIE – Gefechtskarten (erzeugt von tools/mapgen.js – nicht von Hand bearbeiten)');
  lines.push("var G = (typeof globalThis !== 'undefined' ? globalThis : window).G = (globalThis.G || {});");
  lines.push('G.MAPS = G.MAPS || [];');
  maps.forEach(m => {
    lines.push('G.MAPS.push({');
    lines.push('  id: ' + JSON.stringify(m.id) + ', name: ' + JSON.stringify(m.name) + ', players: ' + m.players + ',');
    lines.push('  desc: ' + JSON.stringify(m.desc) + ', theme: ' + JSON.stringify(m.theme) + ',');
    lines.push('  rows: [');
    m.rows.forEach((r, i) => lines.push('    ' + JSON.stringify(r) + (i < m.rows.length - 1 ? ',' : '')));
    lines.push('  ],');
    lines.push('  units: []');
    lines.push('});');
  });
  return lines.join('\n') + '\n';
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const pi = args.indexOf('--print');
  // --print erzeugt nur die gewünschte Karte (schneller beim Entwerfen)
  const maps = (pi >= 0 && DEFS.some(d => d.id === args[pi + 1]) ? DEFS.filter(d => d.id === args[pi + 1]) : DEFS).map(generateBest);
  if (pi >= 0) {
    const m = maps.find(x => x.id === args[pi + 1]) || maps[0];
    console.log(m.name, m.rows[0].length / 2 + '×' + m.rows.length);
    const wide = args.includes('--wide'); // 2 Zeichen je Feld: Gebäudebuchstabe + Besitzer
    const glyph = { P: '.', F: 'f', M: '^', R: '=', B: '#', I: '~', S: ' ', H: ',', X: '*' };
    if (wide) { let hd = '   '; for (let x = 0; x < m.rows[0].length / 2; x++) hd += (x % 10) + ' '; console.log(hd); }
    m.rows.forEach((r, y) => {
      let s = wide ? String(y).padStart(2) + ' ' : '';
      for (let i = 0; i < r.length; i += 2) {
        const t = r[i], o = r[i + 1];
        if (wide) s += (glyph[t] || t) + (o !== '.' ? o : ' ');
        else s += o !== '.' ? o : (glyph[t] || t);
      }
      console.log(s);
    });
  } else {
    const out = path.join(__dirname, '..', 'js', 'maps.js');
    fs.writeFileSync(out, toJs(maps));
    console.log('geschrieben: ' + out + ' (' + maps.length + ' Karten)');
    maps.forEach(m => console.log('  ' + m.id.padEnd(16) + (m.rows[0].length / 2 + '×' + m.rows.length).padEnd(8) + m.players + ' Spieler'));
  }
}
module.exports = { generate, generateBest, fairness, DEFS };
