// FRONTLINIE – Pixel-Art (eigenständig gezeichnet). Raster als Strings.
// '.' = transparent, '1'..'4' = Teamfarbe hell -> dunkel (zur Laufzeit ersetzt), sonst G.SPRITE_PALETTE.
var G = (typeof globalThis !== 'undefined' ? globalThis : window).G = (globalThis.G || {});

G.SPRITE_PALETTE = {
  k: '#181018', // Kontur
  w: '#f8f8f8', // Weiß / Augenweiß / Glanz
  g: '#c8c8d0', // Metall hell
  G: '#888898', // Metall mittel
  d: '#505060', // Metall dunkel
  D: '#303038', // fast schwarz (Mützenschirm, Kragen)
  y: '#f8d838', // Gold / Gelb
  Y: '#c09018', // Gold Schatten
  o: '#f08828', // Orange (Raketenspitzen, Flammen)
  s: '#f8d0b0', // Haut hell
  S: '#d89878', // Haut Schatten
  t: '#b07850', // dunkle Haut
  T: '#7a4a30', // dunkle Haut Schatten
  p: '#f0e4ec', // bleiche Haut
  P: '#b8a8c0', // bleiche Haut Schatten
  r: '#e85030', // Haar rot / Iris rot
  R: '#a02818', // Haar rot Schatten
  n: '#9a6038', // Haar braun / Iris braun
  N: '#603818', // Haar braun Schatten
  h: '#f8e090', // Haar blond
  H: '#c8a040', // Haar blond Schatten
  v: '#b080e0', // Haar violett
  V: '#7048a8', // Haar violett Schatten / Iris violett
  x: '#585868', // schwarzes Haar Glanz
  X: '#28283a', // schwarzes Haar
  e: '#58a0f0', // Iris blau
  E: '#2050a0', // Iris blau dunkel
  a: '#60c050', // Iris grün
  A: '#2a7028', // Iris grün dunkel
  l: '#d05858', // Lippen / Mund
  f: '#f0a090', // Wangenröte / Sommersprossen
  j: '#90e0f8', // Glas hell
  J: '#3890c8', // Glas dunkel
  c: '#68b840', // Gras
  C: '#3c8028'  // Gras dunkel
};

(function () {
  var E16 = '................';
  // Rumpf/Oberkörper wippt: Zeile `cut` entfällt, oben kommt eine leere Zeile hinzu.
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

  var U = {};
  // Kettenzeilen: A = Glieder (zwei Phasen), B = Laufrollen, C = Unterkante
  var TA = 'kGGdGGdGGdGGdGGk', TA2 = 'kGdGGdGGdGGdGGdk', TB = 'kddgddgddgddgddk', TC = '.kkkkkkkkkkkkkk.';
  var NA = '.kGGdGGdGGdGGdk.', NA2 = '.kGdGGdGGdGGdGk.', NB = '.kdgddgddgddgdk.', NC = '..kkkkkkkkkkkk..';

  // ---------------------------------------------------------------- Infanterie
  var INF = [
    '................',
    '......kkkk......',
    '.....k1112k.....',
    '....k111122k....',
    '....k3333333k...',
    '.....kssssk.....',
    '.....kSsksk.....',
    '......kSSk......',
    '.....k1122k.....',
    '....k11222sskkkk',
    '....k1222kdGGGGk',
    '....k1222kkkkkk.',
    '....k3333k......',
    '....k3kk3k......',
    '....kddkddk.....',
    '................'
  ];
  U.inf = { frames: [INF, bob(INF, 12)] };

  var MECH = [
    '......kkkk......',
    '.....k1112k.....',
    '....k111122k....',
    '....k3333333k...',
    '.....kssssk.....',
    '.....kSsksk.....',
    '......kSSk......',
    'kkkkkkkkkkkkkkk.',
    'kdgggggggggggyyk',
    'kdGGGGGGGGGGGook',
    'kkkkk1sskkkkkkk.',
    '..kdk122k.......',
    '.kddk2222k......',
    '.kkkk3333k......',
    '....k3kk3k......',
    '...kddkddk......'
  ];
  U.mech = { frames: [MECH, bob(MECH, 13)] };

  // ---------------------------------------------------------------- Fahrzeuge
  var RECON = [
    '................',
    '................',
    '................',
    '................',
    '................',
    '......kkkk......',
    '.....k1112kkkkk.',
    '.....k1223GGGGk.',
    '...kkkkkkkkkkkk.',
    '..k111111111122k',
    '.k122222222222yk',
    '.k33kkk3333kkk3k',
    '.kkkdGdkkkkdGdkk',
    '...kGkGk..kGkGk.',
    '...kdGdk..kdGdk.',
    '....kkk....kkk..'
  ];
  U.recon = { frames: [RECON, swap(bob(RECON, 10), 12, 14, 'G', 'd')] };

  var APC = [
    '................',
    '................',
    '..k.............',
    '..k.............',
    '..k.kkkk........',
    '.kkkk11kkkkkkk..',
    '.k111111111112k.',
    '.k1111111111122k',
    '.k2kjjk22222222k',
    '.k2kkkk2222k222k',
    '.k333333333k333k',
    'kkkkkkkkkkkkkkkk',
    TA,
    TB,
    TC,
    '................'
  ];
  U.apc = { frames: [APC, put(APC, { 12: TA2 })] };

  var TANK = [
    '................',
    '................',
    '................',
    '................',
    '................',
    '.....kkkkk......',
    '....k11112kkkkkk',
    '....k12223GGGGGk',
    '...k1233333kkkkk',
    '..kkkkkkkkkkkkk.',
    '.k111111111122k.',
    '.k333333333333k.',
    '.kkkkkkkkkkkkkk.',
    NA,
    NB,
    NC
  ];
  U.tank = { frames: [TANK, put(TANK, { 13: NA2 })] };

  var MDTANK = [
    '................',
    '................',
    '....kkkkkk......',
    '...k111112k...kk',
    '..k1111122kkkkgk',
    '..k12222223GGGGk',
    '..k23333333ddddk',
    '..kkkkkkkkkkkkkk',
    '.k111111111111kk',
    'k11111111111122k',
    'k22222222222222k',
    'k33333333333333k',
    'kkkkkkkkkkkkkkkk',
    TA,
    TB,
    TC
  ];
  U.mdtank = { frames: [MDTANK, put(MDTANK, { 13: TA2 })] };

  var TITAN = [
    '................',
    '.....kkkkkkk....',
    '....k1111111kkkk',
    '...k1jjj1112gggk',
    '..k11jJj1122kkkk',
    '..k222222223gggk',
    '..k333333333kkkk',
    '.kkkkkkkkkkkkkk.',
    'k11111111111122k',
    'k2jj22jj22jj223k',
    'k33333333333333k',
    'kkkkkkkkkkkkkkkk',
    TA,
    'kdjddjddjddjddjk',
    TC,
    '................'
  ];
  U.titan = { frames: [TITAN, swap(put(TITAN, { 12: TA2 }), 9, 13, 'j', 'J')] };

  var ARTY = [
    '................',
    '.............kkk',
    '............kgGk',
    '...........kgGk.',
    '..........kgGk..',
    '.........kgGk...',
    '...kkkkkkgGk....',
    '..k111112Gk.....',
    '..k1222222k.....',
    '..k3333333k.....',
    '.kkkkkkkkkkkkkk.',
    '.k111111111122k.',
    '.kkkkkkkkkkkkkk.',
    NA,
    NB,
    NC
  ];
  U.arty = { frames: [ARTY, put(ARTY, { 13: NA2 })] };

  var ROCKET = [
    '................',
    '................',
    '................',
    '........kkkkkkkk',
    '..kkkkkk111kokok',
    '..k11111222kkkkk',
    '..k22222333kokok',
    '..k33333kkkkkkkk',
    '..kkkkkk.kkkkk..',
    '.k22222222k1jjjk',
    '.k33333333k1112k',
    'kkkkkkkkkkkkkkkk',
    '.kdGkkdGk..kdGk.',
    '.kGdkkGdk..kGdk.',
    '..kk..kk....kk..',
    '................'
  ];
  U.rocket = { frames: [ROCKET, swap(ROCKET, 12, 13, 'G', 'd')] };

  var AA = [
    '................',
    '...........k..k.',
    '..........kgkkgk',
    '.........kgkkgk.',
    '........kgkkgk..',
    '.......kgkkgk...',
    '...kkkkgkkgk....',
    '..k1111112k.....',
    '..k1222222k.....',
    '..k3333333k.....',
    '.kkkkkkkkkkkkkk.',
    '.k111111111122k.',
    '.kkkkkkkkkkkkkk.',
    NA,
    NB,
    NC
  ];
  U.aa = { frames: [AA, put(AA, { 13: NA2 })] };

  var MISSILE = [
    '................',
    '.........kk..kk.',
    '........k11kk11k',
    '.......kwwkkwwk.',
    '......kwwkkwwk..',
    '.....kgwkkgwk...',
    '....kgwkkgwk....',
    '...kkkkkkkkk....',
    '..k22222k.kkkkk.',
    '.k22222222k1jjjk',
    '.k33333333k1112k',
    'kkkkkkkkkkkkkkkk',
    '.kdGkkdGk..kdGk.',
    '.kGdkkGdk..kGdk.',
    '..kk..kk....kk..',
    '................'
  ];
  U.missile = { frames: [MISSILE, swap(MISSILE, 12, 13, 'G', 'd')] };

  // ---------------------------------------------------------------- Luft
  var TCOP = [
    '................',
    'GGGGGGG..GGGGGGG',
    '...kk......kk...',
    '..kkkkkkkkkkkk..',
    '.k111111111111k.',
    'k1111111111jjjjk',
    'k22jj2jj2jj2222k',
    'k33333333333333k',
    '.kkkkkkkkkkkkkk.',
    '..kdk......kdk..',
    '...k........k...',
    '................',
    '................',
    '................',
    '................',
    '................'
  ];
  U.tcopter = { frames: [TCOP, sink(put(TCOP, { 1: '..GGG......GGG..' }))] };

  var BCOP = [
    '................',
    'GGGGGGGGkGGGGGGG',
    '........kk......',
    '.......kkkk.....',
    '......kjj11k....',
    'k....kjj1jjjk...',
    'kk..k111111jjk..',
    'k1kk2222222222k.',
    '.kk.k33333333kGk',
    '....kdddddkkk...',
    '.....kkkkk......',
    '.....k...k......',
    '...kkkkkkkkk....',
    '................',
    '................',
    '................'
  ];
  U.bcopter = { frames: [BCOP, sink(put(BCOP, { 1: '.....GGGkGGG....' }))] };

  var FIGHTER = [
    '................',
    '................',
    'k...............',
    'kk..............',
    'k1k.............',
    'k11k............',
    'k111k...kkkk....',
    'k1111kkkjjwjkk..',
    'ok111111111111kk',
    'ok2222222222222k',
    'kk33333333333kk.',
    '...k3333kk......',
    '....kkkk........',
    '................',
    '................',
    '................'
  ];
  U.fighter = { frames: [FIGHTER, sink(swap(FIGHTER, 8, 9, 'o', 'y'))] };

  var BOMBER = [
    '................',
    'k...............',
    'kk..............',
    'k1k.............',
    'k11k............',
    'k111kkkkkkkkkk..',
    'k11111111111jjk.',
    'k22222222222jjjk',
    'k33333333333333k',
    '.kkk11111111kkk.',
    '..kdGk11111kdGk.',
    '.k22222222kkk...',
    'k3333333kkk.....',
    'kkkkkkk.........',
    '................',
    '................'
  ];
  U.bomber = { frames: [BOMBER, sink(BOMBER)] };

  // ---------------------------------------------------------------- See
  var LANDER = [
    '................',
    '................',
    '................',
    '................',
    '................',
    '.kkkk...........',
    '.kjjk........kk.',
    '.k11k.......kGgk',
    'kkkkkkkkkkkkGgk.',
    'k111111111111gkk',
    'k22222222222222k',
    '.k333333333333k.',
    '..kkkkkkkkkkkk..',
    '................',
    '................',
    '................'
  ];
  U.lander = { frames: [LANDER, sink(LANDER)] };

  var CRUISER = [
    '................',
    '................',
    '........k.......',
    '.......kkk......',
    '........k.......',
    '.......kkk......',
    '......kjjjk.....',
    '.....k11111k....',
    '..kkkk22222k.kk.',
    '.kGGGk22222kk1kd',
    'kggggggggggggggk',
    '.k333333333333k.',
    '..kkkkkkkkkkkk..',
    '................',
    '................',
    '................'
  ];
  U.cruiser = { frames: [CRUISER, sink(CRUISER)] };

  var SUB = [
    '................',
    '................',
    '................',
    '................',
    '................',
    '........k.......',
    '........k.......',
    '.......kkkk.....',
    '......k1112k....',
    '..kkkkk112kkkkk.',
    '.k2222222222222k',
    'k33333333333333k',
    '.k444444444444k.',
    '..kkkkkkkkkkkk..',
    '................',
    '................'
  ];
  U.sub = { frames: [SUB, sink(SUB)] };

  var BSHIP = [
    '................',
    '.......k........',
    '......kkk.......',
    '.......k........',
    '.....kkkkk......',
    '.....kjjjk......',
    '.kkkk11111kkkk..',
    'dk11k22222k11kdd',
    'dk22k33333k22kdd',
    'kggggggggggggggk',
    'k33333333333333k',
    '.k333333333333k.',
    '..k3333333333k..',
    '...kkkkkkkkkk...',
    '................',
    '................'
  ];
  U.battleship = { frames: [BSHIP, sink(BSHIP)] };

  // ---------------------------------------------------------------- Gebäude
  var B = {};
  B.C = [
    '................',
    '................',
    '..........kk....',
    '.........k11k...',
    '........k1112k..',
    '.......k111222k.',
    '...kk.kkkkkkkkkk',
    '..k11k.kwwwwwgk.',
    '.k1122kkwJwJwgk.',
    'k111222kwJwJwgk.',
    '.kwwwgkkwwwwwgk.',
    '.kJwJgkkwJwJwgk.',
    '.kwwwgkkwJwJwgk.',
    '.kwddgkkwwddwgk.',
    '.kkkkkkkkkkkkkk.',
    '................'
  ];
  B.K = [
    '..gw............',
    '.gwwg...........',
    '..gg............',
    '.kkk............',
    '.kGk............',
    '.kGk..kk..kk..kk',
    '.kGkkk1kkk1kkk1k',
    '.kGkk1121112111k',
    '.kGkkkkkkkkkkkkk',
    '.kwJJwJJwJJwJJgk',
    '.k2222kkkkk2223k',
    '.kwwwwkdddkwwwgk',
    '.kwwwwkGGGkwwwgk',
    '.kwwwwkdddkwwwgk',
    '.kkkkkkkkkkkkkkk',
    '................'
  ];
  B.A = [
    '................',
    '.kkkkk..........',
    'kjjwjjk.........',
    'kJJJJJk.........',
    'kkkkkkk.........',
    '..k1k...........',
    '..k1k...kkkkk...',
    '..k1k.kk11111kk.',
    '..k2kk111111122k',
    '..k2kkkkkkkkkkkk',
    '..k2kkdgdgdgdgdk',
    '..k2kkdgdgdgdgdk',
    'kkkkkkkkkkkkkkkk',
    'kddwwdddwwdddwwk',
    'kkkkkkkkkkkkkkkk',
    '................'
  ];
  B.O = [
    '................',
    '..kkkkkkkkkkkkk.',
    '.k1111111111112k',
    '.k22kkkkkkkkkkk.',
    '.k12k......k....',
    '.k21k......k....',
    '.k12k......k....',
    '.k21k.....kdk...',
    '.k12k...kkkkk...',
    '.k21k...knNnk...',
    '.k12k...kNnNk...',
    'kkkkkkkkkkkkkkkk',
    'kggggggggggggggk',
    'kGGdGGGdGGGdGGGk',
    'kkkkkkkkkkkkkkkk',
    '................'
  ];
  B.Q = [
    '.......kkkkk....',
    '.......k1112k...',
    '.......k1222k...',
    '.......kkkkk....',
    '......kkkk......',
    '.....k1111k.....',
    '....k111122k....',
    '....kkkkkkkk....',
    '....kwgyygwk....',
    '....kwgYYgwk....',
    '.kkkkkkkkkkkkkk.',
    'k11111111111122k',
    'kwgkwgkddkwgkwgk',
    'kwgkwgkddkwgkwgk',
    'kkkkkkkkkkkkkkkk',
    '................'
  ];

  // ---------------------------------------------------------------- Icons (feste Farben)
  var I = {};
  I.capture = [
    '.kkkkkk.',
    'kgkyyyYk',
    'kgkyyYYk',
    'kgkyYYk.',
    'kgkkkkk.',
    'kgk.....',
    'kgk.....',
    'kkk.....'
  ];
  I.fuel = [
    '.kkk....',
    '.kgkkkk.',
    'kkkooook',
    'kooooook',
    'kowwoook',
    'kooooook',
    'kooooook',
    'kkkkkkkk'
  ];
  I.ammo = [
    '.kk..kk.',
    'kgGkkgGk',
    'kgGkkgGk',
    'kkkkkkkk',
    'kyYkkyYk',
    'kyYkkyYk',
    'kyYkkyYk',
    'kkkkkkkk'
  ];
  I.hidden = [
    '..kkkk..',
    '..kjjk..',
    'kkkjjkkk',
    '.kjjjjk.',
    '..kjjk..',
    '...kk...',
    'kkkkkkkk',
    'jJjJjJjJ'
  ];
  I.star = [
    '...kk...',
    '..kyyk..',
    'kkkyykkk',
    'kyyyyyYk',
    '.kyyyYk.',
    '.kyYkYk.',
    'kyYk.kYk',
    'kkk...kk'
  ];
  I.load = [
    'kkkkkkkk',
    'kggggggk',
    'kgkkkkgk',
    'kgkjjkgk',
    'kgkjjkgk',
    'kgkkkkgk',
    'kggggggk',
    'kkkkkkkk'
  ];
  I.cursor = [
    'kkkkk......kkkkk',
    'kwwwk......kwwwk',
    'kwkkk......kkkwk',
    'kwk..........kwk',
    'kkk..........kkk',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    'kkk..........kkk',
    'kwk..........kwk',
    'kwkkk......kkkwk',
    'kwwwk......kwwwk',
    'kkkkk......kkkkk'
  ];

  // ---------------------------------------------------------------- Porträts 32x32
  var P = {};
  // Gemeinsamer Uniform-Oberkörper (Zeilen 23-31), Teamfarbe
  var BODY = [
    '........kk1111kSSk1111kk........',
    '....kk22211111kwwk11111222kk....',
    '...k22221111111kk11111112222k...',
    '..k32222111111133111111122223k..',
    '.k3322221111111331111111222233k.',
    '.k3322221yy1111331111111222233k.',
    'k333222211111113311111112222333k',
    'k333222211111113311111112222333k',
    'k333222211111113311111112222333k'
  ];

  P.rika = [
    '................................',
    '................................',
    '...........kkkkkkkk.............',
    '.........kk11111111kk...........',
    '........k1111111111122k.........',
    '.......k211111111111222k........',
    '......k322y22222222222223k......',
    '.......kk44444444444444kk.......',
    '.......krrrrrrrrrrrrrrrRk.......',
    '.......krrRrrrrrrrRrrrRRk.......',
    '.......krRrsRrrrsRrrrsRRk.......',
    '.......kRRssRsssssRsssRRk.......',
    '.......kRRsRRRssssRRRsRRk.......',
    '.......kRkskkksssskkkskRk.......',
    '.......kRkswaAssssAawskRk.......',
    '.......kRkswAAssssAAwskRk.......',
    '.......kRksssssssssssskRk.......',
    '........kkssssssSssssskk........',
    '.........kSssssSkssssSk.........',
    '..........kSssssssssSk..........',
    '...........kSSssssSSk...........',
    '............kkSSSSkk............',
    '.............kSssSk.............'
  ].concat(BODY);

  P.bastian = [
    '................................',
    '................................',
    '................................',
    '...........kkkkkkkkkk...........',
    '.........kknnnnnnnnnnkk.........',
    '.......kGGGGGGGGGGGGGGGGk.......',
    '.......kdnnnnnnnnnnnnnNdk.......',
    '.......kdnnnNnnnnnnNnnNdk.......',
    '.......kdnnNnnnnNnnnnNNdk.......',
    '.......kdnNnnNnnnnNnnNNdk.......',
    '.......kdNNsNsssssNssNNdk.......',
    '......kkkNssNsssssNsssNkkk......',
    '.....kGGdksNNNssssNNNskdGGk.....',
    '.....kGddkskkksssskkkskddGk.....',
    '.....kGddksweEssssEewskddGk.....',
    '.....kGddkswEEssssEEwskddGk.....',
    '.....kGGdksssssssssssskdGGk.....',
    '......kkkkssssssSssssskkkk......',
    '.........kSssslsslsssSk.........',
    '..........kSsssllsssSk..........',
    '...........kSSssssSSk...........',
    '............kkSSSSkk............',
    '.............kSssSk.............'
  ].concat(BODY);

  P.jara = [
    '................................',
    '................................',
    '................................',
    '...........kkkkkkkkkk...........',
    '.........kkXXXXXXXXXXkk.........',
    '........kXXXxxXXXXXXXXXk........',
    '.......kXXXxxxXXXXXXXXXXk.......',
    '.......kXXxxXXXXXXXXXXXXk.......',
    '.......kXXXXXXXXXXXXXXXXk.......',
    '.......kXXXXXXttttXXXXXXk.......',
    '.......kXXXttttttttttXXXk.......',
    '.......kXXttttttttttttXXk.......',
    '.......kXXtXXXttttXXXtXXk.......',
    '.......kXkkkkkkttkkkkkkXk.......',
    '.......kXkkwnnkkkknnwkkXk.......',
    '.......kXkkjnNkttkNnjkkXk.......',
    '.......kXktkkkttttkkktkXk.......',
    '........kkttttttTtttttkkXk......',
    '.........kTttttkkttttTkkxXk.....',
    '..........kTtttlltttTk.kXxk.....',
    '...........kTTttttTTk..kxXk.....',
    '............kkTTTTkk...kXxk.....',
    '.............kTttTk....kxXk.....',
    '........kk1111kTTk1111kkXxk.....',
    '....kk22211111kwwk11111kxXkk....',
    '...k22221111111kk111111kXxk2k...',
    '..k32222111111133111111kxXk23k..',
    '.k332222111111133111111kyyk233k.',
    '.k3322221yy111133111111kXxk233k.',
    'k33322221111111331111111kk22333k',
    'k333222211111113311111112222333k',
    'k333222211111113311111112222333k'
  ];

  P.viktor = [
    '................................',
    '................................',
    '..........kkkkkkkkkkkk..........',
    '........kk111111111111kk........',
    '.......k1111111111111122k.......',
    '......k211111111111111222k......',
    '......k2222222yy222222333k......',
    '.......k4444444YY4444444k.......',
    '.......kddddddddddddddddk.......',
    '........kkkkkkkkkkkkkkkk........',
    '........kgSSSSSSSSSSSSgk........',
    '........kgssssssssssssgk........',
    '........kgsGggssssggGsgk........',
    '........kgskkksssskkksgk........',
    '........kgsweksssskewsgk........',
    '........kgsSSSssssSSSsgk........',
    '........kgssssssSsssssgk........',
    '.........ksssggggggsssk.........',
    '.........kSgggGGGGgggSk.........',
    '..........kSssssssssSk..........',
    '...........kSSssssSSk...........',
    '............kkSSSSkk............',
    '.............kSssSk.............',
    '........kk1111kSSk1111kk........',
    '....kkyyy11111k11k11111yyykk....',
    '...kYYYY1111111kk1111111YYYYk...',
    '..k32222111111133111111122223k..',
    '.k3322221rerey1331111111222233k.',
    '.k3322221yyyyy1331111111222233k.',
    'k333222211111113311111112222333k',
    'k333222211111113311111112222333k',
    'k333222211111113311111112222333k'
  ];

  P.fortuna = [
    '................................',
    '................................',
    '...........kkkkkkkkkk...........',
    '.........kkvvvvvvvvvvkk.........',
    '........kvvvvvvvvvvvvvVk........',
    '.......kvvwwvvvvvvvvvvVVk.......',
    '......kvvvwwvvvvvvvvvvvVVk......',
    '......kvvvvVvvvvvvvVvvvVVk......',
    '......kvvvVvvvvVvvvvVvVVVk......',
    '......kvvVvvVvvvvVvvvvVVVk......',
    '......kvvVvVsvVssVvsVvVVVk......',
    '......kvVVsVsssVssssVsVVVk......',
    '......kvVVsVVVssssVVVsVVVk......',
    '......kvVkskkksssssssskVvk...w..',
    '......kvVkswvVsssssssskVvk.kkk..',
    '......kvVkswVVsssskkkskVvkkyyYk.',
    '......kvVksffsssssffsskVvkkwyYk.',
    '......kvVkssssssSsslsskVvkkyYYk.',
    '......kvVkSssssslllssSkVvk.kkk..',
    '......kvVVkSssssssssSkVVvk......',
    '......kvVVVkSSssssSSkVVVvk......',
    '......kvVVVVkkSSSSkkVVVVvk......',
    '.....kvvVVVVVkSssSkVVVVVvvk.....',
    '....kvvVVVkk11kSSk11kkVVVvvk....',
    '...kvvVVVV21111kk11112VVVVvvk...',
    '..kvvVVVV22111111111122VVVVvvk..',
    '.kvvVVV32221111yy11112223VVVvvk.',
    '.kvVVV33222111111111122233VVVvk.',
    'kvVVV3332221111111111222333VVVvk',
    'kvVVV3332221111111111222333VVVvk',
    'kvVVV3332221111111111222333VVVvk',
    'kvVVV3332221111111111222333VVVvk'
  ];

  P.mira = [
    '................................',
    '................................',
    '...........kkkkkkkkkk...........',
    '.........kkhhhhhhhhhhkk.........',
    '........khhhwwhhhhhhhhHk........',
    '.......khhhhhhhhhhhhhhHHk.......',
    '.......khkkkkkkhhkkkkkkHk.......',
    '.......knkjwjJkkkkjwjJknk.......',
    '.......knkjjJJkhhkjjJJknk.......',
    '.......khkkkkkkhhkkkkkkHk.......',
    '.......khhHhhhHhhhhHhhHHk.......',
    '.......khHsHssssHssHssHHk.......',
    '.......kHHsHHHssssHHHsHHk.......',
    '.......kHkskkksssskkkskHk.......',
    '.......kHksweEssssEewskHk.......',
    '.......kHkswEEssssEEwskHk.......',
    '.......kHksffssssssffskHk.......',
    '........kkssssssSssssskk........',
    '.........kSssslsslsssSk.........',
    '..........kSsssllsssSk..........',
    '...........kSSssssSSk...........',
    '............kkSSSSkk............',
    '..........kwwkSssSkwwk..........',
    '.......kkwwgwwwSSwwwgwwkk.......',
    '....kk22wwgwwgwkkwgwwgww22kk....',
    '...k22222wgwwk1111kwwgw22222k...',
    '..k32222111111133111111122223k..',
    '.k3322221111111331111111222233k.',
    '.k3322221yy1111331111111222233k.',
    'k333222211111113311111112222333k',
    'k333222211111113311111112222333k',
    'k333222211111113311111112222333k'
  ];

  P.ole = [
    '................................',
    '................................',
    '..........kkkkkkkkkkkk..........',
    '........kkwwwwwwwwwwwwkk........',
    '.......kwwwwwwwwwwwwwwggk.......',
    '......kgwwwwwwwwwwwwwwgggk......',
    '......kggggggggggggggGGGGk......',
    '.......k2222222yy2222223k.......',
    '.......k3333333YY3333334k.......',
    '.......kkkkkkkkkkkkkkkkkk.......',
    '........kddddddddddddddk........',
    '........kGSSSSSSSSSSSSGk........',
    '........kGsGGGssssGGGsGk........',
    '........kGskkksssskkksGk........',
    '........kgsweEssssEewsgk........',
    '........kgssssssssssssgk........',
    '........kggssssSSssssggk........',
    '........kggggggSSggggggk........',
    '........kgwgggkllkgggwgk........',
    '........kGgwggggggggwgGk........',
    '.........kGgggwggggwgGk.........',
    '..........kGggggggggGk..........',
    '.....kk2222kGGggggGGk2222kk.....',
    '...kk2222111kGGGGGGk1112222kk...',
    '..k32221111kwwwwwwwwk11112223k..',
    '.k3322211111kwwwwwwk1111122233k.',
    'k333222111111kwwwwk111111222333k',
    'k3332221111111kwwk1111111222333k',
    'k3332221111y111kk111y1111222333k',
    'k33322211111111kk11111111222333k',
    'k3332221111y111kk111y1111222333k',
    'k33322211111111kk11111111222333k'
  ];

  P.kurt = [
    '................................',
    '................................',
    '............kkkkkkkk............',
    '..........kk11111122kk..........',
    '.........k1ww111111222k.........',
    '........k11w11111111222k........',
    '........k11111111111222k........',
    '.......k1111111111112223k.......',
    '.......k2222222222222333k.......',
    '......k333333333333333334k......',
    '......kkkkkkkkkkkkkkkkkkkk......',
    '........kdnNnnsnNnnsnNdk........',
    '........kdsnnnssssnnnsdk........',
    '........kdskkksssskkksdk........',
    '........kdsweEssssEewsdk........',
    '........kdswEEssssEEwsdk........',
    '........kdsfsfssssfsfsdk........',
    '........kdssssssSsssssdk........',
    '.........dSssslsslsssSd.........',
    '..........dSsssllsssSd..........',
    '...........dSSssssSSd...........',
    '............kdSSSSdk............',
    '.............kSssSk.............'
  ].concat(BODY);

  P.greta = [
    '................................',
    '................................',
    '...........kkkkkkkkkk...........',
    '.........kkXXXXXXXXXXkk.........',
    '........kXXxxXXXXXXXXXXk........',
    '.......kGGGGGGGGGGGGGGGGk.......',
    '......kdXxxXXXXXXXXXXXXXdk......',
    '......kdXxXXXXXXXXXXXXXXdk......',
    '......kdXXXXXXXXXXXXXXXXdk......',
    '......kdXXXXXXXXXXXXXXXXdk......',
    '......kdXXXXXXXXXXXXXXXXdk......',
    '......kdXXxXXXXxXXXXxXXXdk......',
    '.....kkkXXskkksssskkksXXkkk.....',
    '.....kGdkXswaAssssAawsXkdGk.....',
    '.....kGdkXswAAssssAAwsXkdGk.....',
    '.....kGdkXssssssssssssXkdGk.....',
    '.....kkkdXssssssSsssssXXkkk.....',
    '......kXXdssssssssssssXXXk......',
    '......kXXXdddkskkssssSXXXk......',
    '......kXXXkSssssssssSkXXXk......',
    '......kkkkkkSSssssSSkkkkkk......',
    '............kkSSSSkk............',
    '.............kSssSk.............'
  ].concat(BODY);

  P.kraehe = [
    '................................',
    '................................',
    '...........kkkkkkkkkk...........',
    '.........kkXXXXXXXXXXkk.........',
    '........kXXxxxXXXXXXXXXk........',
    '.......kXXxxXXXXXXXXXXXXk.......',
    '.......kXxxXXXXXXXXXXXXXk.......',
    '.......kXXXXXXXXXXXXXXXXk.......',
    '.......kXXXXXXXXXXXXXXXXk.......',
    '.......kXXXpppXXXXpppXXXk.......',
    '.......kXXpppppXXpppppXXk.......',
    '.......kXXpXXppppppXXpXXk.......',
    '.......kXXppXXppppYYYpXXk.......',
    '.......kXkpkkkpppYkkkYkXk.......',
    '.......kXkpwrRpppYRrjYkXk.......',
    '.......kXkpwRRpppYRRjYkXk.......',
    '.......kXkpPPPppppYYYpkXk.......',
    '........kkppppppPppppykk........',
    '......kDDkPppppkkkkppPyDDk......',
    '.....kDDd2kPppppppppPk2dDDk.....',
    '.....kDDd21kPPppppPPk12dDDk.....',
    '.....kDDd211kkPPPPkk112dDDk.....',
    '.k.kkDDDd2111kPppPk1112dDDDkk.k.',
    'kxkxkDDd21111kwwwwk11112dDDkxkxk',
    'kXxXxkDd211111kwwk111112dDkxXxXk',
    'kXXxXxkd2111111kk1111112dkxXxXXk',
    'kXXXxXxd2111111yy1111112dxXxXXXk',
    'kxXXXxX32111111kk11111123XxXXXxk',
    'kXxXXXx32111111kk11111123xXXXxXk',
    'kXXxXXX32111111kk11111123XXXxXXk',
    'kXXXxXX32111111kk11111123XXxXXXk',
    'kxXXXxX32111111kk11111123XxXXXxk'
  ];

  G.SPRITES = { units: U, buildings: B, portraits: P, icons: I };
})();
