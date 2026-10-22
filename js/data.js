// FRONTLINIE – Spieldaten (Gelände, Einheiten, Schaden, Kommandanten)
var G = (typeof globalThis !== 'undefined' ? globalThis : window).G = (globalThis.G || {});

(function () {
  'use strict';

  // ---------------------------------------------------------------- Fraktionen
  G.FACTIONS = {
    red:     { id: 'red',     name: 'Karmesin',  colors: ['#f87858', '#e03020', '#a01810', '#580808'], co: 'rika' },
    blue:    { id: 'blue',    name: 'Azur',      colors: ['#78b0f8', '#3070e0', '#1840a0', '#0c2058'], co: 'bastian' },
    green:   { id: 'green',   name: 'Smaragd',   colors: ['#88e060', '#40b030', '#207018', '#0c4008'], co: 'jara' },
    yellow:  { id: 'yellow',  name: 'Bernstein', colors: ['#f8e070', '#e0b020', '#a07810', '#584008'], co: 'viktor' },
    neutral: { id: 'neutral', name: 'Neutral',   colors: ['#f0f0f0', '#b8b8c0', '#787880', '#383840'] }
  };
  G.FACTION_ORDER = ['red', 'blue', 'green', 'yellow'];

  // ---------------------------------------------------------------- Gelände
  // move: Bewegungskosten je Bewegungsart (0 = unpassierbar)
  //           foot mech tread tire air ship trans
  function mv(foot, mech, tread, tire, air, ship, trans) {
    return { foot: foot, mech: mech, tread: tread, tire: tire, air: air, ship: ship, trans: trans };
  }
  G.TERRAIN = {
    P: { id: 'P', name: 'Ebene',        def: 1, move: mv(1, 1, 1, 2, 1, 0, 0) },
    F: { id: 'F', name: 'Wald',         def: 2, move: mv(1, 1, 2, 3, 1, 0, 0), hides: true },
    M: { id: 'M', name: 'Berg',         def: 4, move: mv(2, 1, 0, 0, 1, 0, 0), peak: true },
    R: { id: 'R', name: 'Straße',       def: 0, move: mv(1, 1, 1, 1, 1, 0, 0) },
    B: { id: 'B', name: 'Brücke',       def: 0, move: mv(1, 1, 1, 1, 1, 0, 0) },
    I: { id: 'I', name: 'Fluss',        def: 0, move: mv(2, 1, 0, 0, 1, 0, 0) },
    S: { id: 'S', name: 'Meer',         def: 0, move: mv(0, 0, 0, 0, 1, 1, 1), water: true },
    H: { id: 'H', name: 'Strand',       def: 0, move: mv(1, 1, 1, 1, 1, 0, 1) },
    X: { id: 'X', name: 'Riff',         def: 1, move: mv(0, 0, 0, 0, 1, 2, 2), water: true, hides: true },
    C: { id: 'C', name: 'Stadt',        def: 3, move: mv(1, 1, 1, 1, 1, 0, 0), prop: true },
    K: { id: 'K', name: 'Fabrik',       def: 3, move: mv(1, 1, 1, 1, 1, 0, 0), prop: true, builds: 'ground' },
    A: { id: 'A', name: 'Flughafen',    def: 3, move: mv(1, 1, 1, 1, 1, 0, 0), prop: true, builds: 'air' },
    O: { id: 'O', name: 'Hafen',        def: 3, move: mv(1, 1, 1, 1, 1, 1, 1), prop: true, builds: 'sea' },
    Q: { id: 'Q', name: 'Hauptquartier', def: 4, move: mv(1, 1, 1, 1, 1, 0, 0), prop: true, hq: true }
  };
  G.TERRAIN_DESC = {
    P: 'Offenes Gelände. Gute Wege für alle Bodeneinheiten.',
    F: 'Wald bietet Deckung. Im Nebel sind Einheiten hier nur aus nächster Nähe sichtbar.',
    M: 'Berge: hohe Verteidigung, nur Fußtruppen kommen hinauf. Infanterie sieht von hier weiter.',
    R: 'Straßen: schnelles Vorankommen, aber keine Deckung.',
    B: 'Brücke über Wasser. Keine Deckung.',
    I: 'Fluss: nur Fußtruppen können ihn durchwaten.',
    S: 'Offenes Meer. Nur Schiffe und Flugzeuge.',
    H: 'Strand: Landungsboote können hier anlegen.',
    X: 'Riff: verlangsamt Schiffe und verbirgt sie im Nebel.',
    C: 'Stadt: bringt Einkommen und repariert Bodeneinheiten.',
    K: 'Fabrik: baut Bodeneinheiten, bringt Einkommen.',
    A: 'Flughafen: baut und repariert Luftfahrzeuge.',
    O: 'Hafen: baut und repariert Schiffe.',
    Q: 'Hauptquartier: fällt es, ist die Schlacht verloren.'
  };
  // Welche Einheitenklassen ein Gebäude reparieren/versorgen kann
  G.REPAIRS = { C: 'ground', K: 'ground', Q: 'ground', A: 'air', O: 'sea' };

  // ---------------------------------------------------------------- Einheiten
  // cls: foot | vehicle | copter | plane | ship | sub
  // domain: ground | air | sea  (für Bau/Reparatur)
  G.UNITS = {
    inf:        { name: 'Infanterie',      short: 'Inf',   cost: 1000,  move: 3, mt: 'foot',  vision: 2, fuel: 99, fpd: 0, ammo: 0, range: [1, 1], cls: 'foot',    domain: 'ground', capture: true,
                  desc: 'Billig und vielseitig. Nimmt Gebäude ein.' },
    mech:       { name: 'Grenadier',       short: 'Gren',  cost: 3000,  move: 2, mt: 'mech',  vision: 2, fuel: 70, fpd: 0, ammo: 3, range: [1, 1], cls: 'foot',    domain: 'ground', capture: true,
                  desc: 'Panzerfaust gegen Fahrzeuge. Klettert mühelos auf Berge.' },
    recon:      { name: 'Späher',          short: 'Späh',  cost: 4000,  move: 8, mt: 'tire',  vision: 5, fuel: 80, fpd: 0, ammo: 0, range: [1, 1], cls: 'vehicle', domain: 'ground',
                  desc: 'Schnell mit großer Sicht. Gut gegen Infanterie.' },
    apc:        { name: 'Transporter',     short: 'TPz',   cost: 5000,  move: 6, mt: 'tread', vision: 1, fuel: 70, fpd: 0, ammo: 0, range: [0, 0], cls: 'vehicle', domain: 'ground',
                  carries: ['foot'], cap: 1, supplies: true, desc: 'Trägt 1 Fußtruppe und versorgt Nachbarn mit Munition und Treibstoff.' },
    tank:       { name: 'Panzer',          short: 'Pz',    cost: 7000,  move: 6, mt: 'tread', vision: 3, fuel: 70, fpd: 0, ammo: 9, range: [1, 1], cls: 'vehicle', domain: 'ground',
                  desc: 'Wendiger Kampfpanzer. Das Rückgrat jeder Armee.' },
    mdtank:     { name: 'Schwerer Panzer', short: 'sPz',   cost: 16000, move: 5, mt: 'tread', vision: 1, fuel: 50, fpd: 0, ammo: 8, range: [1, 1], cls: 'vehicle', domain: 'ground',
                  desc: 'Starke Kanone und dicke Panzerung.' },
    titan:      { name: 'Titan',           short: 'Titan', cost: 22000, move: 6, mt: 'tread', vision: 1, fuel: 99, fpd: 0, ammo: 9, range: [1, 1], cls: 'vehicle', domain: 'ground',
                  desc: 'Experimenteller Superpanzer. Teuer, aber kaum aufzuhalten.' },
    arty:       { name: 'Artillerie',      short: 'Art',   cost: 6000,  move: 5, mt: 'tread', vision: 1, fuel: 50, fpd: 0, ammo: 9, range: [2, 3], cls: 'vehicle', domain: 'ground',
                  desc: 'Indirekter Beschuss auf 2–3 Felder. Kann nicht ziehen und feuern.' },
    rocket:     { name: 'Raketenwerfer',   short: 'Rak',   cost: 15000, move: 5, mt: 'tire',  vision: 1, fuel: 50, fpd: 0, ammo: 6, range: [3, 5], cls: 'vehicle', domain: 'ground',
                  desc: 'Weitreichender Beschuss auf 3–5 Felder.' },
    aa:         { name: 'Flakpanzer',      short: 'Flak',  cost: 8000,  move: 6, mt: 'tread', vision: 2, fuel: 60, fpd: 0, ammo: 9, range: [1, 1], cls: 'vehicle', domain: 'ground',
                  desc: 'Zerfetzt Hubschrauber und Infanterie.' },
    missile:    { name: 'Flugabwehr-Rak.', short: 'FlaR',  cost: 12000, move: 4, mt: 'tire',  vision: 5, fuel: 50, fpd: 0, ammo: 6, range: [3, 5], cls: 'vehicle', domain: 'ground',
                  desc: 'Holt Flugzeuge auf 3–5 Felder vom Himmel. Nur gegen Luftziele.' },
    tcopter:    { name: 'Transporthub.',   short: 'THub',  cost: 5000,  move: 6, mt: 'air',   vision: 2, fuel: 99, fpd: 2, ammo: 0, range: [0, 0], cls: 'copter',  domain: 'air',
                  carries: ['foot'], cap: 1, desc: 'Fliegt 1 Fußtruppe übers Gelände. Unbewaffnet.' },
    bcopter:    { name: 'Kampfhub.',       short: 'KHub',  cost: 9000,  move: 6, mt: 'air',   vision: 3, fuel: 99, fpd: 2, ammo: 6, range: [1, 1], cls: 'copter',  domain: 'air',
                  desc: 'Vielseitiger Angreifer gegen Boden- und Seeziele.' },
    fighter:    { name: 'Jäger',           short: 'Jäg',   cost: 20000, move: 9, mt: 'air',   vision: 2, fuel: 99, fpd: 5, ammo: 9, range: [1, 1], cls: 'plane',   domain: 'air',
                  desc: 'Luftüberlegenheit. Greift nur Luftziele an.' },
    bomber:     { name: 'Bomber',          short: 'Bomb',  cost: 22000, move: 7, mt: 'air',   vision: 2, fuel: 99, fpd: 5, ammo: 9, range: [1, 1], cls: 'plane',   domain: 'air',
                  desc: 'Verheerend gegen Boden und See, wehrlos gegen Luft.' },
    lander:     { name: 'Landungsboot',    short: 'LBoot', cost: 12000, move: 6, mt: 'trans', vision: 1, fuel: 99, fpd: 1, ammo: 0, range: [0, 0], cls: 'ship',    domain: 'sea',
                  carries: ['foot', 'vehicle'], cap: 2, desc: 'Trägt 2 Bodeneinheiten. Legt an Strand und Hafen an.' },
    cruiser:    { name: 'Kreuzer',         short: 'Kreuz', cost: 18000, move: 6, mt: 'ship',  vision: 3, fuel: 99, fpd: 1, ammo: 9, range: [1, 1], cls: 'ship',    domain: 'sea',
                  carries: ['copter'], cap: 2, desc: 'Jagt U-Boote und Luftfahrzeuge. Trägt 2 Hubschrauber.' },
    sub:        { name: 'U-Boot',          short: 'U-B',   cost: 20000, move: 5, mt: 'ship',  vision: 5, fuel: 60, fpd: 1, ammo: 6, range: [1, 1], cls: 'sub',     domain: 'sea',
                  canDive: true, diveFpd: 5, desc: 'Kann abtauchen und ist dann fast unsichtbar.' },
    battleship: { name: 'Schlachtschiff',  short: 'SSch',  cost: 28000, move: 5, mt: 'ship',  vision: 2, fuel: 99, fpd: 1, ammo: 9, range: [2, 6], cls: 'ship',    domain: 'sea',
                  desc: 'Schwere Geschütze mit 2–6 Feldern Reichweite.' }
  };
  // ---- Erweiterung: weitere Boden-, Luft- und Seeeinheiten sowie feste Verteidigungsstellungen
  var EXTRA = {
    moto:       { name: 'Kradschütze',     short: 'Krad',  cost: 2500,  move: 5, mt: 'tire',  vision: 3, fuel: 60, fpd: 0, ammo: 0, range: [1, 1], cls: 'foot',    domain: 'ground', capture: true,
                  desc: 'Schneller Einnehmer auf dem Motorrad. Auf Straßen sehr flink, im Gelände langsam.' },
    flame:      { name: 'Flammenpanzer',   short: 'Flam',  cost: 9000,  move: 5, mt: 'tread', vision: 2, fuel: 60, fpd: 0, ammo: 5, range: [1, 1], cls: 'vehicle', domain: 'ground',
                  desc: 'Räuchert Infanterie und Stellungen aus. Gegen schwere Panzer machtlos.' },
    pionier:    { name: 'Pionier',         short: 'Pion',  cost: 4500,  move: 3, mt: 'mech',  vision: 2, fuel: 60, fpd: 0, ammo: 0, range: [1, 1], cls: 'foot',    domain: 'ground',
                  fortifies: ['bunker', 'turret', 'flak', 'coast'], desc: 'Baut Bunker, Geschütztürme, Flakstellungen und Küstenbatterien auf Nachbarfeldern.' },
    bergepanzer:{ name: 'Bergepanzer',     short: 'Berg',  cost: 6000,  move: 6, mt: 'tread', vision: 2, fuel: 70, fpd: 0, ammo: 0, range: [0, 0], cls: 'vehicle', domain: 'ground',
                  repairs: true, supplies: true, desc: 'Repariert eine benachbarte Einheit um 2 KP und versorgt Nachbarn mit Nachschub.' },
    drone:      { name: 'Aufklärungsdrohne', short: 'Drohn', cost: 3000, move: 7, mt: 'air',  vision: 6, fuel: 90, fpd: 2, ammo: 0, range: [0, 0], cls: 'copter',  domain: 'air',
                  desc: 'Billiges Auge am Himmel mit riesiger Sicht und großem Tank. Unbewaffnet und zerbrechlich.' },
    gunship:    { name: 'Schlachtflieger', short: 'Schl',  cost: 15000, move: 6, mt: 'air',   vision: 2, fuel: 80, fpd: 4, ammo: 6, range: [1, 1], cls: 'plane',   domain: 'air',
                  desc: 'Robuster Tiefflieger gegen Fahrzeuge und Stellungen. Günstiger als ein Bomber.' },
    airlift:    { name: 'Transportflugzeug', short: 'TFlz', cost: 14000, move: 8, mt: 'air', vision: 2, fuel: 99, fpd: 4, ammo: 0, range: [0, 0], cls: 'plane',   domain: 'air',
                  carries: ['foot', 'vehicle'], cap: 2, desc: 'Fliegt 2 Bodeneinheiten über weite Strecken. Unbewaffnet.' },
    pboat:      { name: 'Schnellboot',     short: 'SBoot', cost: 7000,  move: 8, mt: 'trans', vision: 4, fuel: 60, fpd: 1, ammo: 6, range: [1, 1], cls: 'ship',    domain: 'sea',
                  desc: 'Schnell und billig. Jagt Landungsboote und U-Boote, fährt bis an den Strand.' },
    carrier:    { name: 'Flugzeugträger',  short: 'Träg',  cost: 26000, move: 5, mt: 'ship',  vision: 3, fuel: 99, fpd: 1, ammo: 0, range: [1, 1], cls: 'ship',    domain: 'sea',
                  carries: ['copter', 'plane'], cap: 2, servicesCargo: true, desc: 'Trägt 2 Luftfahrzeuge und versorgt sie. Flugabwehr an Bord.' },
    bunker:     { name: 'Bunker',          short: 'Bunk',  cost: 6000,  move: 0, mt: 'none',  vision: 3, fuel: 99, fpd: 0, ammo: 0, range: [1, 1], cls: 'static',  domain: 'ground',
                  defBonus: 30, desc: 'Feste Stellung mit MG gegen Infanterie. Sehr zäh. Wird vom Pionier gebaut.' },
    turret:     { name: 'Geschützturm',    short: 'Turm',  cost: 10000, move: 0, mt: 'none',  vision: 3, fuel: 99, fpd: 0, ammo: 9, range: [2, 4], cls: 'static',  domain: 'ground',
                  defBonus: 20, desc: 'Feststehende Kanone mit 2–4 Feldern Reichweite – feuert jede Runde.' },
    flak:       { name: 'Flakstellung',    short: 'FlSt',  cost: 8000,  move: 0, mt: 'none',  vision: 4, fuel: 99, fpd: 0, ammo: 9, range: [1, 3], cls: 'static',  domain: 'ground',
                  defBonus: 20, desc: 'Flugabwehr mit 1–3 Feldern Reichweite. Nur gegen Luftziele.' },
    coast:      { name: 'Küstenbatterie',  short: 'Küst',  cost: 14000, move: 0, mt: 'none',  vision: 4, fuel: 99, fpd: 0, ammo: 9, range: [2, 5], cls: 'static',  domain: 'ground',
                  defBonus: 25, coastal: true, desc: 'Schweres Geschütz an der Küste, 2–5 Felder. Gefürchtet von Schiffen.' }
  };
  Object.keys(EXTRA).forEach(function (k) { G.UNITS[k] = EXTRA[k]; });
  G.UNIT_ORDER = ['inf', 'moto', 'mech', 'pionier', 'recon', 'apc', 'bergepanzer', 'tank', 'flame', 'mdtank', 'titan', 'arty', 'rocket', 'aa', 'missile',
    'drone', 'tcopter', 'bcopter', 'gunship', 'airlift', 'fighter', 'bomber',
    'pboat', 'lander', 'cruiser', 'sub', 'carrier', 'battleship',
    'bunker', 'turret', 'flak', 'coast'];
  G.BUILD_LISTS = {
    ground: ['inf', 'moto', 'mech', 'pionier', 'recon', 'apc', 'bergepanzer', 'tank', 'flame', 'mdtank', 'titan', 'arty', 'rocket', 'aa', 'missile'],
    air: ['drone', 'tcopter', 'bcopter', 'gunship', 'airlift', 'fighter', 'bomber'],
    sea: ['pboat', 'lander', 'cruiser', 'sub', 'carrier', 'battleship']
  };
  G.FORTIFY = ['bunker', 'turret', 'flak', 'coast'];
  Object.keys(G.UNITS).forEach(function (k) { G.UNITS[k].id = k; });

  // ---------------------------------------------------------------- Schaden
  // Basisschaden in % bei 10 HP, ohne Gelände. Primärwaffe verbraucht Munition, Sekundärwaffe nicht.
  // Reihenfolge der Spalten: siehe COLS.
  var COLS = ['inf', 'mech', 'recon', 'apc', 'tank', 'mdtank', 'titan', 'arty', 'rocket', 'aa', 'missile',
    'tcopter', 'bcopter', 'fighter', 'bomber', 'lander', 'cruiser', 'sub', 'battleship'];
  var _ = null;
  function row(arr) { var o = {}; arr.forEach(function (v, i) { if (v !== null) o[COLS[i]] = v; }); return o; }
  //                       inf mech recon apc tank md titan arty rock aa  miss tcop bcop figh bomb land crui sub  bat
  G.DAMAGE = {
    inf: {
      primary: null,
      secondary: row([52, 44, 14, 12, 6, 2, 1, 18, 24, 6, 24, 28, 10, _, _, _, _, _, _])
    },
    mech: {
      primary: row([_, _, 80, 72, 58, 20, 12, 68, 80, 62, 80, _, _, _, _, _, _, _, _]),
      secondary: row([62, 52, 16, 18, 7, 2, 1, 30, 32, 7, 32, 32, 10, _, _, _, _, _, _])
    },
    recon: {
      primary: null,
      secondary: row([72, 62, 38, 42, 8, 2, 1, 42, 52, 5, 30, 32, 12, _, _, _, _, _, _])
    },
    apc: { primary: null, secondary: null },
    tank: {
      primary: row([_, _, 82, 72, 52, 18, 12, 72, 82, 62, 82, _, _, _, _, 12, 6, 2, 2]),
      secondary: row([72, 66, 38, 42, 7, 2, 1, 42, 52, 6, 30, 38, 12, _, _, _, _, _, _])
    },
    mdtank: {
      primary: row([_, _, 100, 98, 82, 52, 40, 100, 100, 100, 100, _, _, _, _, 38, 32, 12, 12]),
      secondary: row([100, 92, 42, 44, 9, 2, 1, 42, 52, 8, 34, 42, 14, _, _, _, _, _, _])
    },
    titan: {
      primary: row([_, _, 120, 118, 100, 70, 52, 112, 120, 112, 120, _, _, _, _, 42, 34, 18, 18]),
      secondary: row([118, 110, 62, 60, 12, 2, 1, 62, 70, 18, 52, 52, 24, _, _, _, _, _, _])
    },
    arty: {
      primary: row([88, 82, 78, 68, 66, 42, 36, 72, 78, 72, 78, _, _, _, _, 52, 62, 58, 38]),
      secondary: null
    },
    rocket: {
      primary: row([92, 88, 88, 78, 76, 52, 46, 78, 82, 82, 88, _, _, _, _, 62, 80, 80, 52]),
      secondary: null
    },
    aa: {
      primary: row([100, 98, 58, 48, 28, 12, 6, 48, 52, 42, 52, 115, 112, 68, 72, _, _, _, _]),
      secondary: null
    },
    missile: {
      primary: row([_, _, _, _, _, _, _, _, _, _, _, 115, 115, 95, 98, _, _, _, _]),
      secondary: null
    },
    tcopter: { primary: null, secondary: null },
    bcopter: {
      primary: row([_, _, 58, 58, 52, 28, 18, 62, 62, 22, 62, _, _, _, _, 28, 50, 28, 22]),
      secondary: row([72, 62, _, _, _, _, _, _, _, _, _, 92, 62, _, _, _, _, _, _])
    },
    fighter: {
      primary: row([_, _, _, _, _, _, _, _, _, _, _, 98, 98, 52, 98, _, _, _, _]),
      secondary: null
    },
    bomber: {
      primary: row([108, 106, 102, 102, 100, 92, 86, 102, 102, 92, 102, _, _, _, _, 92, 52, 90, 72]),
      secondary: null
    },
    lander: { primary: null, secondary: null },
    cruiser: {
      primary: row([_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, 28, 8, 88, 8]),
      secondary: row([_, _, _, _, _, _, _, _, _, _, _, 112, 112, 58, 62, _, _, _, _])
    },
    sub: {
      primary: row([_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, 92, 28, 52, 58]),
      secondary: null
    },
    battleship: {
      primary: row([92, 88, 88, 78, 78, 52, 46, 78, 82, 82, 88, _, _, _, _, 92, 92, 92, 48]),
      secondary: null
    }
  };

  // ---- Schaden der Erweiterung
  // 1) Neue Ziele: Panzerung wie eine vergleichbare Einheit (Proxy) mal Faktor
  var PROXY = { moto: ['inf', 1.0], flame: ['tank', 1.05], pionier: ['mech', 1.0], bergepanzer: ['apc', 1.0],
    drone: ['tcopter', 1.1], gunship: ['bomber', 1.0], airlift: ['bomber', 1.1], pboat: ['lander', 1.05], carrier: ['battleship', 1.0],
    bunker: ['mdtank', 0.75], turret: ['mdtank', 0.85], flak: ['aa', 0.9], coast: ['mdtank', 0.8] };
  // 2) Neue Angreifer
  function scaled(src, f) { var o = {}; Object.keys(src || {}).forEach(function (k) { o[k] = Math.round(src[k] * f); }); return o; }
  var FOOT = { inf: 1, mech: 1, moto: 1, pionier: 1 };
  G.DAMAGE.moto = { primary: null, secondary: scaled(G.DAMAGE.inf.secondary, 1.0) };
  G.DAMAGE.pionier = { primary: null, secondary: scaled(G.DAMAGE.inf.secondary, 0.9) };
  G.DAMAGE.flame = { primary: { inf: 105, mech: 100, moto: 100, pionier: 100, recon: 55, apc: 50, bergepanzer: 50, tank: 22, flame: 25, mdtank: 6, titan: 3,
    arty: 55, rocket: 60, aa: 22, missile: 55, bunker: 35, turret: 15, flak: 35, coast: 15 }, secondary: null };
  G.DAMAGE.bergepanzer = { primary: null, secondary: null };
  G.DAMAGE.drone = { primary: null, secondary: null };
  G.DAMAGE.airlift = { primary: null, secondary: null };
  G.DAMAGE.gunship = { primary: { recon: 85, apc: 85, bergepanzer: 85, tank: 75, flame: 75, mdtank: 55, titan: 45, arty: 85, rocket: 85, aa: 40, missile: 85,
    lander: 50, pboat: 60, cruiser: 35, sub: 40, battleship: 30, carrier: 30, bunker: 45, turret: 50, flak: 40, coast: 45 },
    secondary: { inf: 80, mech: 75, moto: 80, pionier: 75 } };
  G.DAMAGE.pboat = { primary: { lander: 60, pboat: 55, cruiser: 20, sub: 45, battleship: 12, carrier: 15 },
    secondary: { inf: 45, mech: 40, moto: 45, pionier: 40, recon: 20, apc: 15, bergepanzer: 15, tcopter: 30, bcopter: 15, drone: 40 } };
  G.DAMAGE.carrier = { primary: null, secondary: { tcopter: 90, bcopter: 85, fighter: 45, bomber: 55, drone: 100, gunship: 55, airlift: 60 } };
  G.DAMAGE.bunker = { primary: null, secondary: { inf: 75, mech: 65, moto: 70, pionier: 65, recon: 35, apc: 30, bergepanzer: 30, tank: 8, flame: 8, mdtank: 2, titan: 1,
    arty: 35, rocket: 40, aa: 6, missile: 30, tcopter: 30, bcopter: 12, drone: 40 } };
  G.DAMAGE.turret = { primary: { inf: 70, mech: 65, moto: 70, pionier: 65, recon: 85, apc: 75, bergepanzer: 75, tank: 65, flame: 65, mdtank: 45, titan: 35,
    arty: 75, rocket: 80, aa: 70, missile: 80, lander: 50, pboat: 60, cruiser: 40, sub: 40, battleship: 25, carrier: 25, bunker: 35, turret: 35, flak: 40, coast: 30 }, secondary: null };
  G.DAMAGE.flak = { primary: { tcopter: 115, bcopter: 110, fighter: 75, bomber: 80, drone: 120, gunship: 80, airlift: 90 }, secondary: null };
  G.DAMAGE.coast = { primary: { lander: 85, pboat: 90, cruiser: 75, sub: 70, battleship: 55, carrier: 55, inf: 80, mech: 75, moto: 80, pionier: 75, recon: 80,
    apc: 70, bergepanzer: 70, tank: 65, flame: 65, mdtank: 45, titan: 40, arty: 70, rocket: 75, aa: 70, missile: 75, bunker: 30, turret: 30, flak: 35, coast: 30 }, secondary: null };
  // Proxy-Spalten in allen Zeilen ergänzen (explizite Werte haben Vorrang)
  Object.keys(G.DAMAGE).forEach(function (a) {
    ['primary', 'secondary'].forEach(function (w) {
      var row = G.DAMAGE[a][w]; if (!row) return;
      Object.keys(PROXY).forEach(function (t) {
        if (row[t] != null) return;
        var px = PROXY[t];
        if (row[px[0]] != null) row[t] = Math.max(1, Math.round(row[px[0]] * px[1]));
      });
    });
  });
  // Stellungen sind keine Fußtruppen: MG der Infanterie richtet kaum etwas aus
  ['inf', 'moto', 'pionier', 'recon'].forEach(function (a) {
    var r = G.DAMAGE[a].secondary; if (!r) return;
    ['bunker', 'turret', 'coast'].forEach(function (t) { if (r[t] != null) r[t] = Math.min(r[t], 2); });
  });
  Object.keys(G.UNITS).forEach(function (k) { G.UNITS[k].id = k; });
  // Sichtweiten: Original-Werte (inf 2, Späher 5, Panzer 3 …) erhöht, weil unsere Karten 2–4-mal so groß sind
  var VISION = { inf: 3, mech: 3, moto: 4, pionier: 3, recon: 7, apc: 2, bergepanzer: 3, tank: 4, flame: 3, mdtank: 3, titan: 3,
    arty: 3, rocket: 3, aa: 4, missile: 6, drone: 9, tcopter: 4, bcopter: 5, gunship: 4, airlift: 4, fighter: 5, bomber: 4,
    pboat: 5, lander: 3, cruiser: 5, sub: 6, carrier: 5, battleship: 4, bunker: 4, turret: 5, flak: 5, coast: 6 };
  Object.keys(VISION).forEach(function (k) { if (G.UNITS[k]) G.UNITS[k].vision = VISION[k]; });

  // ---------------------------------------------------------------- Kommandanten (COs)
  // Hooks (alle optional) – power: 0 = normal, 1 = Kraft, 2 = Superkraft; game = laufendes Spiel (kann fehlen)
  //   atk(type, target, power, game) -> Prozent-Bonus (additiv, 0 = neutral)
  //   def(type, attacker, power, game) -> Prozent-Bonus
  //   move(type, power) -> zusätzliche Bewegung
  //   range(type, power) -> zusätzliche Max-Reichweite (nur indirekt)
  //   vision(type, power) -> zusätzliche Sicht
  //   luck(power) -> [min,max] Glück (Standard [0,9])
  //   cost(type) -> Kostenfaktor (1 = normal)
  //   capture(power) -> Faktor für Einnahme
  //   piercing(power) -> true: Verstecke im Nebel werden aufgedeckt
  //   income(power) -> Faktor für das Tageseinkommen (1 = normal)
  //   weatherImmune(weather, power) -> true: eigene Einheiten ohne Bewegungsnachteil durch dieses Wetter
  //   onPower(game, slot, level) -> Sofort-Effekt
  // Kraft-Texte nennen, was zum Tagesbonus hinzukommt; jede aktive Kraft gibt außerdem G.RULES.powerAtk/powerDef.
  // Balance: Sterne ≈ Wirkung (grobe Schranke im Kern-Test „Statische Balance-Schranke“); die Werte sind per
  // KI-gegen-KI-Messung abgestimmt (tools/co-balance.js, Ziel: jede Siegquote 40–60 %). Erfahrung daraus: Boni, die
  // nur einen kleinen Teil der Armee betreffen (Artillerie ~10 %, Fußtruppen ~10 % des Werts), tragen wenig – solche
  // Spezialisten brauchen Kräfte mit Breitenwirkung (Reparatur, Einnahme); Schaden an allen Gegnern wirkt sehr stark.
  function isDirect(t) { var u = G.UNITS[t]; return u.range[1] === 1 && u.range[0] <= 1 && (G.DAMAGE[t].primary || G.DAMAGE[t].secondary); }
  function isIndirect(t) { return G.UNITS[t].range[0] > 1; }
  function isAir(t) { var c = G.UNITS[t].cls; return c === 'copter' || c === 'plane'; }
  function isSea(t) { return G.UNITS[t].domain === 'sea'; }
  function isFoot(t) { return G.UNITS[t].cls === 'foot'; }
  G.unitIsDirect = isDirect; G.unitIsIndirect = isIndirect; G.unitIsAir = isAir; G.unitIsSea = isSea; G.unitIsFoot = isFoot;
  /** Wetter-Kraft: Wetter w heute und an den folgenden (days − 1) Tagen; Game.rollWeather lässt es so lange stehen */
  function forceWeather(g, w, days) { g.weather = w; g.weatherLeft = Math.max(0, (days || 2) - 1); }
  /** Tageseinkommen eines Spielers ohne CO-Faktor (für Sofort-Auszahlungen) */
  function baseIncome(g, slot) { return g.propertiesOf(slot).length * ((g.meta && g.meta.income) || G.RULES.income); }
  /** Repariert alle eigenen Maschinen (alles außer Fußtruppen) um amount interne KP */
  function repairMachines(g, slot, amount) {
    g.units.forEach(function (u) { if (u.p === slot && !isFoot(u.type)) u.hp = Math.min(100, u.hp + amount); });
  }

  G.COS = {
    rika: {
      id: 'rika', name: 'Rika Brand', faction: 'red',
      bio: 'Junge Hauptfrau der Karmesin-Armee. Ausgeglichen, mutig und immer an vorderster Front.',
      d2d: 'Keine Stärken, keine Schwächen.',
      power: { name: 'Zweiter Atem', stars: 3, desc: 'Alle eigenen Einheiten erhalten 2 KP zurück.' },
      superPower: { name: 'Flammenfront', stars: 6, desc: 'Alle eigenen Einheiten erhalten 5 KP zurück, Angriff +10 %.' },
      atk: function (t, tg, p) { return p === 2 ? 10 : 0; },
      onPower: function (g, pl, lvl) { g.healAll(pl, lvl === 2 ? 50 : 20); }
    },
    bastian: {
      id: 'bastian', name: 'Bastian Kell', faction: 'blue',
      bio: 'Panzerkommandant von Azur. Liebt den Nahkampf und hält Artillerie für Feigheit.',
      d2d: 'Direkte Angreifer +5 % Angriff, indirekte −10 %.',
      power: { name: 'Vollgas', stars: 3, desc: 'Direkte Angreifer +1 Bewegung und +15 % Angriff.' },
      superPower: { name: 'Stahlgewitter', stars: 6, desc: 'Direkte Angreifer +2 Bewegung und +30 % Angriff.' },
      atk: function (t, tg, p) { if (isDirect(t)) return 5 + (p === 1 ? 15 : p === 2 ? 30 : 0); if (isIndirect(t)) return -10; return 0; },
      move: function (t, p) { return isDirect(t) ? p : 0; }
    },
    jara: {
      id: 'jara', name: 'Jara Moos', faction: 'green',
      bio: 'Ingenieurin aus Smaragd. Berechnet jede Flugbahn bis auf die dritte Nachkommastelle – und repariert nebenbei alles mit Motor.',
      d2d: 'Indirekte Einheiten +1 Reichweite und +10 % Angriff.',
      power: { name: 'Feldwerkstatt', stars: 3, desc: 'Fahrzeuge, Flieger und Schiffe erhalten 2 KP zurück; indirekte Einheiten +1 weitere Reichweite und +10 % Angriff.' },
      superPower: { name: 'Trommelfeuer', stars: 6, desc: 'Fahrzeuge, Flieger und Schiffe erhalten 4 KP zurück; indirekte Einheiten +2 weitere Reichweite und +30 % Angriff.' },
      atk: function (t, tg, p) { return isIndirect(t) ? 10 + (p === 1 ? 10 : p === 2 ? 30 : 0) : 0; },
      range: function (t, p) { return isIndirect(t) ? 1 + p : 0; },
      onPower: function (g, pl, lvl) { repairMachines(g, pl, lvl === 2 ? 40 : 20); }
    },
    viktor: {
      id: 'viktor', name: 'Viktor Stahl', faction: 'yellow',
      bio: 'Altgedienter General aus Bernstein. Hat noch nie eine Stellung freiwillig geräumt.',
      d2d: 'Alle Einheiten +15 % Verteidigung, aber −1 Bewegung für Fahrzeuge.',
      power: { name: 'Bollwerk', stars: 3, desc: 'Verteidigung +25 %, Fahrzeuge wieder voll beweglich.' },
      superPower: { name: 'Festung', stars: 7, desc: 'Verteidigung +45 % und Angriff +20 %, Fahrzeuge wieder voll beweglich.' },
      def: function (t, at, p) { return 15 + (p === 1 ? 25 : p === 2 ? 45 : 0); },
      atk: function (t, tg, p) { return p === 2 ? 20 : 0; },
      move: function (t, p) { return (G.UNITS[t].cls === 'vehicle' && p === 0) ? -1 : 0; }
    },
    tilda: {
      id: 'tilda', name: 'Tilda Taler', faction: 'yellow',
      bio: 'Söldnerin und Geschäftsfrau aus Bernstein. Kämpft für den, der am besten zahlt – und rechnet jeden Schuss ab.',
      d2d: 'Einkommen +10 %. Ihre Truppen selbst kämpfen ohne Bonus.',
      power: { name: 'Kapitalspritze', stars: 3, desc: 'Sofort-Auszahlung: 30 % eines Tageseinkommens.' },
      superPower: { name: 'Goldregen', stars: 6, desc: 'Sofort-Auszahlung: 60 % eines Tageseinkommens.' },
      income: function (p) { return 1.1; },
      onPower: function (g, pl, lvl) {
        var p = g.playerBySlot(pl);
        if (p) p.funds += Math.round(baseIncome(g, pl) * (lvl === 2 ? 0.6 : 0.3));
      }
    },
    mira: {
      id: 'mira', name: 'Mira Wolke', faction: 'red',
      bio: 'Fliegerass der Karmesin-Luftwaffe. Fühlt sich am Boden fremd.',
      d2d: 'Luftfahrzeuge +20 % Angriff, Schiffe −10 %. Luftfahrzeuge kosten 10 % weniger.',
      power: { name: 'Steigflug', stars: 3, desc: 'Luftfahrzeuge +2 Bewegung und +10 % Angriff.' },
      superPower: { name: 'Sturmfront', stars: 6, desc: 'Luftfahrzeuge +2 Bewegung, +30 % Angriff; alle Gegner verlieren 1 KP.' },
      atk: function (t, tg, p) { if (isAir(t)) return 20 + (p === 1 ? 10 : p === 2 ? 30 : 0); if (isSea(t)) return -10; return 0; },
      move: function (t, p) { return isAir(t) && p ? 2 : 0; },
      cost: function (t) { return isAir(t) ? 0.9 : 1; },
      onPower: function (g, pl, lvl) { if (lvl === 2) g.damageEnemies(pl, 10); }
    },
    frida: {
      id: 'frida', name: 'Frida Frost', faction: 'blue',
      bio: 'Admiralin der Azur-Eismeerflotte. Je kälter der Wind, desto wärmer ihr Lächeln.',
      d2d: 'Bei Schnee +5 % Angriff und keine Bewegungsnachteile durch Schnee.',
      power: { name: 'Kälteeinbruch', stars: 5, desc: 'Es schneit heute und morgen.' },
      superPower: { name: 'Schneesturm', stars: 9, desc: 'Es schneit heute und morgen, Angriff bei Schnee +20 % statt +5 %.' },
      atk: function (t, tg, p, g) { return g && g.weather === 'schnee' ? (p === 2 ? 20 : 5) : 0; },
      weatherImmune: function (w) { return w === 'schnee'; },
      onPower: function (g, pl, lvl) { forceWeather(g, 'schnee', 2); }
    },
    kurt: {
      id: 'kurt', name: 'Kurt Kies', faction: 'red',
      bio: 'Junger Infanterist aus Karmesin. Begeisterter Marschierer, schlechter Sänger.',
      d2d: 'Fußtruppen +20 % Angriff und nehmen schneller ein.',
      power: { name: 'Gewaltmarsch', stars: 3, desc: 'Fußtruppen +2 Bewegung, +30 % Angriff, Einnahme verdoppelt.' },
      superPower: { name: 'Massenaufgebot', stars: 6, desc: 'Fußtruppen +2 Bewegung, +50 % Angriff, Einnahme verdoppelt.' },
      atk: function (t, tg, p) { return isFoot(t) ? 20 + (p === 1 ? 30 : p === 2 ? 50 : 0) : 0; },
      move: function (t, p) { return isFoot(t) && p ? 2 : 0; },
      capture: function (p) { return p ? 2 : 1.5; }
    },
    nora: {
      id: 'nora', name: 'Nora Niesel', faction: 'green',
      bio: 'Wetterkundlerin aus Smaragd. Riecht den Regen drei Tage im Voraus – und bestellt ihn notfalls selbst.',
      d2d: 'Bei Regen +10 % Angriff, +5 % Verteidigung und keine Bewegungsnachteile durch Regen.',
      power: { name: 'Landregen', stars: 3, desc: 'Es regnet heute und morgen, Angriff bei Regen +15 % statt +10 %.' },
      superPower: { name: 'Wolkenbruch', stars: 6, desc: 'Es regnet heute und morgen, bei Regen Angriff +30 % statt +10 % und Verteidigung +15 % statt +5 %.' },
      atk: function (t, tg, p, g) { return g && g.weather === 'regen' ? (p === 2 ? 30 : p === 1 ? 15 : 10) : 0; },
      def: function (t, at, p, g) { return g && g.weather === 'regen' ? (p === 2 ? 15 : 5) : 0; },
      weatherImmune: function (w) { return w === 'regen'; },
      onPower: function (g, pl, lvl) { forceWeather(g, 'regen', 2); }
    },
    kraehe: {
      id: 'kraehe', name: 'Marschall Krähe', faction: 'yellow',
      bio: 'Ein Stratege ohne Heimat, der Länder gegeneinander ausspielt. Sammelt Orden – und Gebiete.',
      d2d: 'Truppen aus Überläufern: alle Einheiten −5 % Verteidigung. Krähe zermürbt den Gegner mit seinen Kräften.',
      power: { name: 'Schwarzer Flügel', stars: 6, desc: 'Alle Gegner verlieren 1 KP.' },
      superPower: { name: 'Krähenschwarm', stars: 10, desc: 'Alle Gegner verlieren 2 KP, eigener Angriff +10 %.' },
      atk: function (t, tg, p) { return p === 2 ? 10 : 0; },
      def: function () { return -5; },
      onPower: function (g, pl, lvl) { g.damageEnemies(pl, lvl === 2 ? 20 : 10); }
    }
  };
  // höchstens 10 Kommandanten; Reihenfolge = Auswahl in den Menüs (je Fraktion gemischt)
  G.CO_ORDER = ['rika', 'bastian', 'jara', 'viktor', 'tilda', 'mira', 'frida', 'kurt', 'nora', 'kraehe'];
  // Ältere Spielstände: entfernte Kommandanten verweisen auf ihre Nachfolger – nicht aufzählbar,
  // erscheinen also in keiner Auswahl, Liste oder Prüfsumme (Fortuna → Tilda, Ole → Frida, Greta → Nora)
  [['fortuna', 'tilda'], ['ole', 'frida'], ['greta', 'nora']].forEach(function (p) {
    Object.defineProperty(G.COS, p[0], { value: G.COS[p[1]], enumerable: false });
  });

  // ---- Fusion: zwei Kommandanten führen eine Armee gemeinsam.
  // Das fusionierte Objekt sieht aus wie ein einzelner CO (gleiche Felder, gleiche Hook-Signaturen) und wird
  // je Paar genau einmal gebaut (stabile Identität). Angriff/Verteidigung: 70 % der Summe (auch Abzüge),
  // Einkommen: 70 % der Summe der Zuschläge, Bewegung/Reichweite/Sicht: Summe, Glück: weiteste Spanne,
  // Kosten: Produkt, Einnahme: Maximum, Durchblick und Wetterfestigkeit: einer genügt, Sofort-Effekte: beide
  // (bei zwei Wetter-Kräften gilt das Wetter des zweiten). Hooks gibt es nur, wenn mindestens ein Partner sie hat.
  var fuseCache = {};
  function firstName(co) { return co.name.split(' ')[0]; }
  G.fuseCOs = function (aId, bId) {
    var key = aId + '+' + bId;
    if (fuseCache[key]) return fuseCache[key];
    var a = G.COS[aId], b = G.COS[bId];
    if (!a || !b) return null;
    if (a === b) return a; // mit sich selbst fusionieren ergibt nichts Neues
    var f = {
      id: key, fused: true, a: a, b: b,
      name: firstName(a) + ' & ' + firstName(b),
      fullName: a.name + ' & ' + b.name,
      faction: a.faction,
      bio: a.name + ' und ' + b.name + ' führen die Armee gemeinsam – zwei Köpfe, eine Front.',
      d2d: 'Fusion – Boni beider Kommandanten zu je 70 %: ' + a.d2d + ' / ' + b.d2d,
      power: {
        name: a.power.name + ' + ' + b.power.name,
        stars: Math.ceil((a.power.stars + b.power.stars) * 0.75),
        desc: 'Beide Kräfte zugleich: ' + a.power.desc + ' ' + b.power.desc
      },
      superPower: {
        name: a.superPower.name + ' + ' + b.superPower.name,
        stars: Math.ceil((a.superPower.stars + b.superPower.stars) * 0.75),
        desc: 'Beide Kräfte zugleich: ' + a.superPower.desc + ' ' + b.superPower.desc
      }
    };
    if (a.atk || b.atk) f.atk = function (t, tg, p, g) {
      return Math.round(0.7 * ((a.atk ? a.atk(t, tg, p, g) : 0) + (b.atk ? b.atk(t, tg, p, g) : 0)));
    };
    if (a.def || b.def) f.def = function (t, at, p, g) {
      return Math.round(0.7 * ((a.def ? a.def(t, at, p, g) : 0) + (b.def ? b.def(t, at, p, g) : 0)));
    };
    if (a.move || b.move) f.move = function (t, p) { return (a.move ? a.move(t, p) : 0) + (b.move ? b.move(t, p) : 0); };
    if (a.range || b.range) f.range = function (t, p) { return (a.range ? a.range(t, p) : 0) + (b.range ? b.range(t, p) : 0); };
    if (a.vision || b.vision) f.vision = function (t, p) { return (a.vision ? a.vision(t, p) : 0) + (b.vision ? b.vision(t, p) : 0); };
    if (a.luck || b.luck) f.luck = function (p) {
      var la = a.luck ? a.luck(p) : [0, 9], lb = b.luck ? b.luck(p) : [0, 9];
      return [Math.min(la[0], lb[0]), Math.max(la[1], lb[1])];
    };
    if (a.cost || b.cost) f.cost = function (t) { return (a.cost ? a.cost(t) : 1) * (b.cost ? b.cost(t) : 1); };
    if (a.capture || b.capture) f.capture = function (p) { return Math.max(a.capture ? a.capture(p) : 1, b.capture ? b.capture(p) : 1); };
    if (a.piercing || b.piercing) f.piercing = function (p) { return !!((a.piercing && a.piercing(p)) || (b.piercing && b.piercing(p))); };
    if (a.income || b.income) f.income = function (p) {
      return 1 + 0.7 * ((a.income ? a.income(p) - 1 : 0) + (b.income ? b.income(p) - 1 : 0));
    };
    if (a.weatherImmune || b.weatherImmune) f.weatherImmune = function (w, p) {
      return !!((a.weatherImmune && a.weatherImmune(w, p)) || (b.weatherImmune && b.weatherImmune(w, p)));
    };
    if (a.onPower || b.onPower) f.onPower = function (g, pl, lvl) {
      if (a.onPower) a.onPower(g, pl, lvl);
      if (b.onPower) b.onPower(g, pl, lvl);
    };
    fuseCache[key] = f;
    return f;
  };
  /** Wirksamer Kommandant eines Spielers: Fusion, wenn ein gültiger zweiter CO (≠ erster) gesetzt ist, sonst der einzelne */
  G.coFor = function (player) {
    if (!player) return null;
    return player.co2 && G.COS[player.co2] && player.co2 !== player.co ? G.fuseCOs(player.co, player.co2) : G.COS[player.co];
  };

  G.RULES = {
    income: 1000,
    capturePoints: 20,
    repairHp: 20,          // interne KP (2 Anzeige-KP)
    starValue: 9000,       // Wert eines Power-Sterns in Geld-Schaden
    starGrowth: 0.2,       // jede Aktivierung macht Sterne 20 % teurer
    starGrowthMax: 10,
    powerAtk: 10, powerDef: 10
  };
})();
