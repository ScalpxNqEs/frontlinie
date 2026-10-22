// FRONTLINIE – zusätzliche Einheiten-Sprites (eigenständig gezeichnet), ergänzt G.SPRITES.units.
// Muss nach js/sprites.js geladen werden. Gleiche Konventionen wie dort:
// 16x16, Blick nach rechts, 2 Frames, '.' transparent, '1'..'4' Teamfarbe hell -> dunkel, Kontur 'k'.
var G = (typeof globalThis !== 'undefined' ? globalThis : window).G = (globalThis.G || {});

(function () {
  if (!G.SPRITES || !G.SPRITES.units || !G.SPRITE_PALETTE) return; // sprites.js fehlt
  // Zusätzliche feste Farben; vorhandene Zeichen werden nie überschrieben.
  var PAL = G.SPRITE_PALETTE;
  if (!('b' in PAL)) PAL.b = '#d8c088'; // Sandsack hell
  if (!('B' in PAL)) PAL.B = '#9c8050'; // Sandsack Schatten
  var U = G.SPRITES.units;
  var E16 = '................';
  // Hilfsfunktionen wie in sprites.js (dort privat).
  // Wippen: Zeile `cut` entfällt, oben kommt eine leere Zeile hinzu.
  function bob(f, cut) { var r = f.slice(); r.splice(cut, 1); r.unshift(E16); return r; }
  // Ganzes Sprite eine Zeile nach unten (unterste Zeile muss leer sein).
  function sink(f) { var r = f.slice(0, f.length - 1); r.unshift(E16); return r; }
  // Zeichen a<->b in Zeilen r0..r1 tauschen (Ketten/Räder drehen).
  function swap(f, r0, r1, a, b) {
    return f.map(function (row, i) {
      if (i < r0 || i > r1) return row;
      return row.split('').map(function (ch) { return ch === a ? b : ch === b ? a : ch; }).join('');
    });
  }
  // Einzelne Zeilen ersetzen.
  function put(f, map) { var r = f.slice(); for (var k in map) r[+k] = map[k]; return r; }
  // Wippen nur links von Spalte x1 (rechts bleibt stehen, z. B. eine abgestellte Schaufel).
  function bobLeft(f, cut, x1) {
    var b = bob(f, cut);
    return f.map(function (row, i) { return b[i].slice(0, x1) + row.slice(x1); });
  }
  // Kettenzeilen wie in sprites.js: A = Glieder (zwei Phasen), B = Laufrollen, C = Unterkante
  var TA = 'kGGdGGdGGdGGdGGk', TA2 = 'kGdGGdGGdGGdGGdk', TB = 'kddgddgddgddgddk', TC = '.kkkkkkkkkkkkkk.';

  // ---------------------------------------------------------------- Boden
  // Kradschütze: Soldat auf Motorrad, Räder drehen sich.
  var MOTO = [
    '................',
    '.....kkkk.......',
    '....k1112k......',
    '...k111122k.....',
    '...k3333333k....',
    '....kssssk......',
    '....kSsksk......',
    '.....kSSk...kk..',
    '....k1122k.kgk..',
    '.kkk11222sskGkk.',
    'k111k2222k111Gyk',
    '.kkkk333k222kGk.',
    'kdGdkkGd3kkkdGdk',
    'kGkGkkggddkkGkGk',
    'kdGdk.kkkk.kdGdk',
    '.kkk........kkk.'
  ];
  U.moto = { frames: [MOTO, swap(MOTO, 12, 14, 'G', 'd')] };

  // Flammenpanzer: gedrungen, Brennstoffflaschen am Heck, kurze Düse; Frame 2 mit Zündflamme.
  var FLAME = [
    '................',
    '................',
    '................',
    '................',
    '.kk.kk..........',
    'kwgkwgk.........',
    'kgGkgGk.kkkk....',
    'kyYkyYkk1112k...',
    'kgGkgGkk11122kkk',
    'kdGkdGkk33333Gdk',
    'k111111111111kkk',
    'k22222222222222k',
    'kkkkkkkkkkkkkkkk',
    TA,
    TB,
    TC
  ];
  U.flame = { frames: [FLAME, put(FLAME, { 8: 'kgGkgGkk11122kky', 9: 'kdGkdGkk33333Gdo', 13: TA2 })] };

  // Pionier: Soldat mit abgestellter Schaufel und Werkzeugtasche, wippt.
  var PIONIER = [
    '................',
    '......kkkk..kkk.',
    '.....k1112k.knk.',
    '....k111122kknk.',
    '....k3333333knk.',
    '.....kssssk.knk.',
    '.....kSsksk.knk.',
    '......kSSk..knk.',
    '.....k1122k.knk.',
    '..kk.k11222sssk.',
    '.knnkk1222kkknk.',
    '.kNNkk1222kkgGkk',
    '.kNNkk3333kgGGGk',
    '.kkkkk3kk3kgGGGk',
    '.....kddkddkgGk.',
    '............kk..'
  ];
  // Zeile 5: Helmkrempe reicht bis an den Stiel (beim Teilwippen sonst abgeschnitten)
  U.pionier = { frames: [PIONIER, put(bobLeft(PIONIER, 12, 11), { 5: PIONIER[4] })] };

  // Bergepanzer: Kettenfahrzeug mit Heckkran und Haken, Räumschild vorn.
  var BERGE = [
    '................',
    '.kk.............',
    'kGGk............',
    '.kkGk...........',
    '.k.kGk..........',
    '.k..kGk.........',
    'kYk..kGk.kkkk...',
    'ky.k..kGkjj1k...',
    '.kk.kkkkkkkkkkk.',
    '...k111111112kyk',
    '...k222222222kkk',
    '...k333333333kyk',
    'kkkkkkkkkkkkkkkk',
    TA,
    TB,
    TC
  ];
  U.bergepanzer = { frames: [BERGE, put(BERGE, { 6: '.k...kGk.kkkk...', 7: 'kYk...kGkjj1k...', 8: 'ky.kkkkkkkkkkkk.', 13: TA2 })] };

  // ---------------------------------------------------------------- Luft
  // Aufklärungsdrohne: schlanker Körper, Kameraauge unter der Nase, Schubpropeller hinten; schwebt.
  var DRONE = [
    '................',
    '................',
    '................',
    '................',
    '.kk.............',
    '.k1k.....kkkk...',
    'Gk11kkkkk1112kk.',
    'Gk1111111111112k',
    'Gk2222222222222k',
    'Gkk333333kkkkkk.',
    '.k3kk2222k.kDDk.',
    '.kk.kkkkkk.kJwk.',
    '............kk..',
    '................',
    '................',
    '................'
  ];
  U.drone = { frames: [DRONE, sink(put(DRONE, {
    6: '.k11kkkkk1112kk.', 9: '.kk333333kkkkkk.', 11: '.kk.kkkkkk.kwJk.' }))] };

  // Schlachtflieger: zweimotorig (beide Triebwerke sichtbar), Bordkanone unter der Nase.
  var GUNSHIP = [
    '................',
    '.....kkk........',
    '.kk..k11k...g...',
    'k11k..k11kkkg...',
    'k12k..kk112Gk...',
    'k112kkkkkkkkgkk.',
    'k1111111111kjjwk',
    'k22222222222jjjk',
    'k33333333333333k',
    '.kkkk22kkkkkkGGG',
    '....k22kk112Gk..',
    '...k222kkkkkgk..',
    '..k223k.....g...',
    '..kkkk......g...',
    '................',
    '................'
  ];
  U.gunship = { frames: [GUNSHIP, sink(put(GUNSHIP, {
    2: '.kk..k11k.......', 5: 'k112kkkkkkkkkkk.', 12: '..k223k.........', 13: '..kkkk..........' }))] };

  // Transportflugzeug: bauchiger Rumpf, Schulterdecker mit Triebwerk, hohes T-Leitwerk, volle Breite.
  var AIRLIFT = [
    'kkkkkk..........',
    'k11112k.........',
    'kkk11kk.........',
    '..k112k......g..',
    '..k1112kkkkkkgk.',
    '..k11112kdGGGgk.',
    '.k11111kkkkkkgkk',
    '.k11111111111jjk',
    'k22k222222222jjk',
    'k22k22222222222k',
    'k333k3333333333k',
    '.kkkk333333333k.',
    '....kkdGdkkkkk..',
    '......kkk.......',
    '................',
    '................'
  ];
  U.airlift = { frames: [AIRLIFT, sink(put(AIRLIFT, { 3: '..k112k.........', 4: '..k1112kkkkkkkk.', 6: '.k11111kkkkkkgkk' }))] };

  // ---------------------------------------------------------------- Wasser
  // Schnellboot: flacher Gleitrumpf, Kajüte, MG am Bug, Bugwelle und Kielwasser.
  var PBOAT = [
    '................',
    '................',
    '................',
    '................',
    '.....k..........',
    '.....k..........',
    '....kkkk........',
    '...kjjj1k..kkk..',
    '..k111112kkkdGGk',
    'kkkkkkkkkkkkkkk.',
    'k11111111111112k',
    'wk22222222222kk.',
    'jwk333333333kww.',
    '.jwkkkkkkkkkww..',
    '................',
    '................'
  ];
  U.pboat = { frames: [PBOAT, sink(put(PBOAT, { 11: 'jk22222222222kkw', 12: 'wjk333333333kwj.', 13: '.wjkkkkkkkkkwjw.' }))] };

  // Flugzeugträger: langes flaches Deck mit Markierung, Inselturm rechts, Radar dreht.
  var CARRIER = [
    '................',
    '............k...',
    '...........kGk..',
    '............k...',
    '...........kkkk.',
    '...........k1jk.',
    '...........k12k.',
    'kkkkkkkkkkkk12k.',
    'kGGGGGGGGGGkkkkk',
    'kdwddwddwddwdddk',
    'kkkkkkkkkkkkkkkk',
    '.k111111111111k.',
    '.k333333333333k.',
    '..kkkkkkkkkkkk..',
    '................',
    '................'
  ];
  U.carrier = { frames: [CARRIER, sink(put(CARRIER, { 1: '................', 2: '...........kGGGk', 3: '............k...' }))] };

  // ---------------------------------------------------------------- Verteidigung
  // Betonbunker: eingegraben (Grasdach), Sehschlitz, Teamfahne weht.
  var BUNKER = [
    '................',
    '...k............',
    '..kgkkkkkk......',
    '..kGk11112k.....',
    '..kGk11222k.....',
    '..kGk12223k.....',
    '..kGkkkkkk......',
    '..kGkkkkkkkk....',
    '.kcCcccCccCcck..',
    'kgggggggggggggk.',
    'kgGGGGGGGGGGGGGk',
    'kgGkkkkkkkkkkGdk',
    'kgGkDDDDDDDDkGdk',
    'kgGGGGGGGGGGGGdk',
    'kkkkkkkkkkkkkkkk',
    '................'
  ];
  U.bunker = { frames: [BUNKER, put(BUNKER, {
    2: '..kgkkkk.kk.....', 3: '..kGk111k12k....', 4: '..kGk1122k2k....', 5: '..kGk1223kk.....', 6: '..kGkkkkk.......' })] };

  // Geschützturm: gepanzerte Drehkuppel auf Betonsockel, langes Rohr, Radar dreht.
  var TURRET = [
    '................',
    '................',
    '....kkkkk.......',
    '.....kdk........',
    '......k.........',
    '....kkkkk.......',
    '...k11112k......',
    '..k1111122kkkkkk',
    '..k1222222GGGGGk',
    '..k3333333kkkkkk',
    '.kkkkkkkkkkk....',
    '.kgggggggggk....',
    'kgGGGGGGGGGGk...',
    'kdddddddddddk...',
    'kkkkkkkkkkkkk...',
    '................'
  ];
  U.turret = { frames: [TURRET, put(TURRET, { 2: '......k.........', 3: '.....kdk........' })] };

  // Flakstellung: Doppelrohr hinter Sandsackring.
  var FLAK = [
    '................',
    '...........k..k.',
    '..........kgkkgk',
    '.........kgkkgk.',
    '........kgkkgk..',
    '.......kgkkgk...',
    '....kkkgkkgk....',
    '...k1111kk2k....',
    '...k1222222k....',
    '..kkkkkkkkkkkk..',
    '.kbbBkbbbBkbbBk.',
    'kbbbBkbbbBkbbbBk',
    'kBBBkkBBBkkBBBkk',
    'kbbBkbbbBkbbbBkk',
    'kkkkkkkkkkkkkkkk',
    '................'
  ];
  // Frame 2: Rohre fahren ein Segment zurück (Rückholbewegung)
  U.flak = { frames: [FLAK, put(FLAK, { 1: E16, 2: '..........k..k..' })] };

  // Küstenbatterie: Betonkasematte mit schwerem Rohr und Mündungsbremse, Entfernungsmesser dreht.
  var COAST = [
    '................',
    '.kkkkk..........',
    '.kgGGk..........',
    '..kdk...........',
    '.kkkkkkkkkk.....',
    'kgggggggggggk...',
    'k33333333333k...',
    'kgggkkkkkkkk..kk',
    'kgggkD111kkkkkdk',
    'kgggkD112gggggdk',
    'kgggkD123GGGGGdk',
    'kgggkD333kkkkkdk',
    'kGGGGGGGGGGk..kk',
    'kdddddddddddk...',
    'kkkkkkkkkkkkk...',
    '................'
  ];
  U.coast = { frames: [COAST, put(COAST, { 1: '................', 2: '..kgk...........' })] };
})();
