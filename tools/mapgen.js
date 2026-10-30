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
//   expand: n            Expansionsstädte je HQ (Standard 4); expandNear: [a, b] Abstandsband der ersten (Standard [4, 6])
//   forward: [a, b] | 0  Band der Vorposten-Fabrik relativ zum HQ-Abstand (Standard [0.35, 0.5]); side: s seitlicher
//                        Versatz relativ zum HQ-Abstand (Standard 0.2)
//   density: n           Zieldichte: ein Gebäude je n Landfelder (Standard 21)
//   neutral: {A, O}      zusätzliche neutrale Flughäfen/Häfen (Bahnen); aBand: [a, b] Abstandsband der Flughäfen
//   ports: n             Häfen je Spieler (Standard 1)
//   seaBridges: true     Straßen dürfen Meer überbrücken (bridge: Kosten je Meerfeld, Standard 9)
//   ridges: true         Gebirgsketten an Ober- und Unterkante (Langes Tal)
//   crest: n             Gebirgskamm senkrecht durch die Kartenmitte (halbe Breite n Felder); Lücken entstehen dort, wo das
//                        Bergrauschen niedrig ist, den Rest überqueren die Straßen als Pässe
//   shape: 'carved', carve: [...]  Kontinent mit ausgeschnittenen Gewässern (Kreise/Kapseln wie bei islands, gespiegelt):
//                        Buchten am Rand, Seen im Inneren
//   shape: 'archipel', islands: [...]  Inselgruppe aus Kreisen/Kapseln (Feldkoordinaten, werden gespiegelt)
//   archipelago: true    Inselkarte: Landflecken bereinigen, Heimatgebäude nur auf der HQ-Insel (erster Hafen zur
//                        Mittelinsel), Vorposten auf einem Eiland, Mitte auf der größten neutralen Insel, jede neutrale
//                        Insel mit Stadt und Strand, Häfen über die Inseln verteilt, Straßen je Insel, keine Brücken
//   reef: s / beach: s   Schwellen für Riffe im offenen Meer (Standard 0.8) und Strände (Standard 0.55)
'use strict';
const fs = require('fs');
const path = require('path');
const { generate, generateBest, fairness } = require('../js/mapgen.js');   // Generator-Kern (auch im Browser)

// ------------------------------------------------------------------ Kartendefinitionen
const DEFS = [
  { id: 'grenzland', theme: 'sommer', name: 'Grenzland', players: 2, w: 30, h: 30, shape: 'continent', sym: 'rot2', anchor: [0.2, 0.22], seed: 11,
    lakes: 0.03, forest: 0.2, mountain: 0.06, rivers: 2, desc: 'Kompakte Karte für schnelle Duelle: ein Kontinent mit Flüssen, Seen und Städten.' },
  // ---- Schnelle Duelle 30×30: HQ-Fußweg 26–30, erste neutrale Stadt 3–4 Felder vor dem HQ, dichte Bebauung, wenig Hindernisse
  { id: 'flussgabel', theme: 'sommer', name: 'Flussgabel', players: 2, w: 30, h: 30, shape: 'continent', sym: 'rot2', anchor: [0.24, 0.3], seed: 211,
    lakes: 0.01, forest: 0.1, mountain: 0.04, rivers: 3, density: 16, expandNear: [3, 4],
    desc: 'Schnelles Duell: offenes Land mit kurzen Wegen, an beiden Flanken gabeln sich Flüsse zur Küste. Wer die freie Mitte zuerst besetzt, gibt das Tempo vor.' },
  { id: 'ahornbucht', theme: 'herbst', name: 'Ahornbucht', players: 2, w: 30, h: 30, shape: 'carved', sym: 'mirrorX', anchor: [0.12, 0.42], seed: 301,
    carve: [{ x: -5, y: -3, x2: 34, y2: -3, r: 5 },                         // Küste im Norden
      { x: 14.5, y: 1, x2: 14.5, y2: 11, r: 3.5 }, { x: 14.5, y: 3, r: 6 }], // tiefe Bucht zwischen den HQs
    lakes: 0, forest: 0.11, mountain: 0.04, rivers: 1, density: 15, expandNear: [3, 4],
    desc: 'Schnelles Duell: Eine tiefe Bucht trennt die beiden Heere. An ihrer Spitze warten Fabriken, Flughäfen und Häfen – dort fällt die Entscheidung.' },
  { id: 'seenkreuz', theme: 'winter', name: 'Seenkreuz', players: 2, w: 30, h: 30, shape: 'carved', sym: 'rot2', anchor: [0.26, 0.26], seed: 403,
    carve: [{ x: 14.5, y: 8, r: 3 }, { x: 8, y: 14.5, r: 3 }],             // vier Seen um die Kartenmitte (gedreht)
    lakes: 0.02, forest: 0.11, mountain: 0.03, rivers: 1, density: 15, expand: 3, expandNear: [3, 4],
    desc: 'Schnelles Duell: Vier Seen umrahmen die Kreuzung in der Mitte, wo Fabriken und Flughäfen warten. Zwischen den Ufern führen kurze Wege direkt zum Gegner.' },
  { id: 'bergpass', theme: 'gebirge', name: 'Bergpass', players: 2, w: 30, h: 30, shape: 'continent', sym: 'rot2', anchor: [0.15, 0.38], seed: 503,
    crest: 4, lakes: 0.01, forest: 0.1, mountain: 0.11, rivers: 1, density: 16, expandNear: [3, 4],
    desc: 'Schnelles Duell: Ein Gebirgskamm teilt das Land von Nord nach Süd. Durch den Pass in der Mitte mit Fabriken und Flughäfen führt der kürzeste Weg zum Gegner.' },
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
