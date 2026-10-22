// Eigene Testkarten für tools/sim.js (Fallback, falls G.MAPS leer ist, sonst mit --test).
// Halbe Karte als Ein-Zeichen-Raster; die zweite Hälfte entsteht durch Punktspiegelung (fair).
// Kleinbuchstaben q k c a o = Gebäude von Spieler 1 (Q K C A O), Spiegelbild gehört Spieler 2.
'use strict';

function sym(id, name, half, opts) {
  opts = opts || {};
  const W = half[0].length, H = opts.height;
  const grid = [];
  for (let y = 0; y < H; y++) grid.push(new Array(W).fill(null));
  half.forEach((row, y) => {
    for (let x = 0; x < W; x++) {
      const ch = row[x];
      const own = ch >= 'a' && ch <= 'z' ? 1 : 0;
      const t = ch.toUpperCase();
      grid[y][x] = { t, o: own };
      const my = H - 1 - y, mx = W - 1 - x;
      if (!grid[my][mx] || my >= half.length) grid[my][mx] = { t, o: own ? 2 : 0 };
    }
  });
  const rows = grid.map(r => r.map(c => (c ? c.t : 'P') + (c && c.o ? String(c.o) : '.')).join(''));
  const units = [];
  (opts.units || []).forEach(u => {
    units.push([u[0], u[1], u[2], 1]);
    units.push([u[0], W - 1 - u[1], H - 1 - u[2], 2]);
  });
  return { id, name, players: 2, desc: 'Testkarte', rows, units, fog: !!opts.fog };
}

module.exports = [
  // Landkarte 15x10 mit Fabriken
  fixLand(),
  // Inselkarte 20x14 mit Häfen und Flughäfen
  sym('t-insel', 'Test Inseln', [
    'SSSSSSSSSSSSSSSSSSSS',
    'SHHHHHSSSSSSSSSSSSSS',
    'HPPCPPHSSSSSSSSSSSSS',
    'HqRkPCoSSSSHHHSSSSSS',
    'HcRRaPHSSSSHCCSSSSSS',
    'HPRcPPHSSSXHAPHSSSSS',
    'SHPPCHSSSSSHHHHSSSSS',
  ], { height: 14 }),
  // Nebelkarte 15x12
  sym('t-nebel', 'Test Nebel', [
    'FFFCFFPRRRRFFCF',
    'FqRRRFFRFFCFFFF',
    'FkFcFRRRFFFRRRF',
    'PFFFFRFFCFFRFFP',
    'FCFFRRFFFFRRFCF',
    'FFFFRFFCFFRFFFF',
  ], { height: 12, fog: true }),
  // Leistungstest: 30x20 mit je 20 Einheiten
  sym('t-gross', 'Test Groß', [
    'MMFPPCPPFFPPIPPCPPFPPCPPFFPPCP',
    'MqRRRRkRRRRRBRRRRRRRRRRRRRRRPP',
    'FPPRPPPPFPCPIPCPPFPRPPPPCPPRPP',
    'PcPkPFFPPPPPIPPPMMPRPPFPPPPRPC',
    'FPPRPFCPPMPPIPPFMMCRPCPPPCPRPP',
    'PaPRPPPPMMPPIPPPPPPRPPPFPPPRPP',
    'PPPRRRRRRRRRBRRRRRRRPFPPPPPRPP',
    'CPFPPCPPFPPAIPPCPPFPPPCPPPPRPP',
    'MMPPFPPCPPFPIIPPPCPPFPPPPPPRPP',
    'PPPPPFPPCPPPIIPFPPCPPFPPMMPRPP',
  ], { height: 20, units: [
    ['tank', 4, 2], ['tank', 5, 3], ['tank', 8, 2], ['mdtank', 6, 4], ['arty', 2, 4], ['arty', 3, 5], ['rocket', 1, 6],
    ['aa', 7, 5], ['inf', 9, 3], ['inf', 10, 4], ['inf', 11, 5], ['mech', 8, 6], ['mech', 9, 7], ['recon', 12, 6],
    ['bcopter', 6, 7], ['fighter', 2, 8], ['bomber', 3, 8], ['apc', 4, 6], ['inf', 5, 8], ['tank', 10, 8],
  ] }),
];

function fixLand() {
  // 15 Spalten, 10 Zeilen; HQ und Fabriken explizit gesetzt
  return sym('t-land', 'Test Land', [
    'qkPCPPFRRRRCPPF',
    'kRRRRRRRPFPPPCP',
    'cRPFCPMPPPCRRPF',
    'CRPPPPRRRRPPRPP',
    'FRRRCPPFPCPPRPC',
  ], { height: 10 });
}
