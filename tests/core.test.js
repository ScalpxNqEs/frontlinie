// Kern-Regeltests: node tests/core.test.js
const assert = require('assert');
const G = require('../tools/load')();

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.log('FAIL  ' + name + '\n      ' + e.stack.split('\n').slice(0, 3).join('\n      ')); process.exitCode = 1; }
}
const MAP = {
  id: 't', name: 'Test', players: 2,
  rows: [
    'Q1K1P.P.P.P.P.K2',
    'P.P.F.P.M.P.P.Q2',
    'C.R.R.R.R.R.R.C.',
    'P.P.I.B.I.P.P.P.',
    'S.S.S.S.S.S.O.P.'
  ],
  units: [['inf', 2, 0, 1], ['tank', 3, 0, 1], ['inf', 5, 0, 2], ['apc', 0, 1, 1]]
};
function newGame(extra) {
  return G.Game.create(Object.assign({ map: MAP, players: [{ slot: 1, faction: 'red', co: 'rika' }, { slot: 2, faction: 'blue', co: 'rika' }], funds: 10000, seed: 42 }, extra || {}));
}
test('Karte parsen', () => {
  const g = newGame();
  assert.strictEqual(g.map.w, 8); assert.strictEqual(g.map.h, 5);
  assert.strictEqual(g.map.terrain[0][0], 'Q'); assert.strictEqual(g.map.owner[0][0], 1);
  assert.strictEqual(g.map.owner[2][0], 0);
});
test('Starteinkommen Tag 1', () => { assert.strictEqual(newGame().currentPlayer().funds, 12000); });
test('Bewegung: Panzer nicht in Berg/Fluss', () => {
  const g = newGame(); const r = g.reachable(g.unitAt(3, 0));
  assert.ok(!r.nodes[1 * 8 + 4]); assert.ok(r.nodes[3 * 8 + 3]); assert.ok(!r.nodes[3 * 8 + 2]);
});
test('Bewegung: Gegner blockiert', () => { const g = newGame(); assert.ok(!g.reachable(g.unitAt(2, 0)).nodes[5]); });
test('Angriff & Gegenschlag', () => {
  const g = newGame(); const t = g.unitAt(3, 0), e = g.unitAt(5, 0);
  const res = g.commit(t.id, g.pathTo(g.reachable(t), 4, 0), { type: 'attack', targetId: e.id });
  assert.ok(res.ok, res.error);
  const atk = res.events.find(ev => ev.type === 'attack');
  assert.ok(atk.dmg > 50, 'dmg ' + atk.dmg); assert.ok(t.moved);
});
test('Schadensformel Beispiel', () => {
  const g = newGame(); const t = g.unitAt(3, 0), e = g.unitAt(5, 0);
  // Panzer-MG 72 gegen Inf auf Ebene (1 Stern, 10 KP), Glück 0: 72 * 1 * (200-110)/100 = 64.8 -> 64
  assert.strictEqual(g.calcDamage(t, e, 100, 5, 0, 0), 64);
});
test('Indirekt: kein Feuern nach Bewegung', () => {
  const g = newGame(); const a = g.spawn('arty', 3, 2, 1); g.spawn('tank', 6, 2, 2);
  assert.strictEqual(g.targetsFrom(a, 3, 2, false).length, 1);
  assert.strictEqual(g.targetsFrom(a, 4, 2, true).length, 0);
});
test('Einnehmen dauert 2 Runden mit 10 KP', () => {
  const g = newGame(); const inf = g.spawn('inf', 0, 2, 1);
  let res = g.commit(inf.id, [{ x: 0, y: 2 }], { type: 'capture' });
  assert.ok(res.ok, res.error); assert.strictEqual(inf.cp, 10);
  g.endTurn(); g.endTurn();
  res = g.commit(inf.id, [{ x: 0, y: 2 }], { type: 'capture' });
  assert.ok(res.ok, res.error); assert.strictEqual(g.map.owner[2][0], 1);
});
test('HQ-Einnahme beendet das Spiel', () => {
  const g = newGame(); const inf = g.spawn('inf', 7, 1, 1);
  g.removeUnit(g.unitAt(5, 0)); g.spawn('inf', 6, 0, 2); inf.cp = 5;
  const res = g.commit(inf.id, [{ x: 7, y: 1 }], { type: 'capture' });
  assert.ok(res.ok, res.error); assert.ok(g.over); assert.strictEqual(g.winner, 1);
});
test('Vernichtung beendet das Spiel', () => {
  const g = newGame(); const e = g.unitAt(5, 0); e.hp = 1; const t = g.unitAt(3, 0);
  assert.ok(g.commit(t.id, g.pathTo(g.reachable(t), 4, 0), { type: 'attack', targetId: e.id }).ok);
  assert.ok(g.over); assert.strictEqual(g.winner, 1);
});
test('Laden und Entladen', () => {
  const g = newGame(); const inf = g.unitAt(2, 0), apc = g.unitAt(0, 1);
  const p = g.pathTo(g.reachable(inf), 0, 1); assert.ok(p);
  let res = g.commit(inf.id, p, { type: 'load' }); assert.ok(res.ok, res.error);
  assert.strictEqual(apc.cargo.length, 1);
  res = g.commit(apc.id, g.pathTo(g.reachable(apc), 1, 2), { type: 'unload', unloads: [{ idx: 0, x: 2, y: 2 }] });
  assert.ok(res.ok, res.error); assert.strictEqual(apc.cargo.length, 0); assert.ok(g.unitAt(2, 2));
});
test('Zusammenführen', () => {
  const g = newGame(); const a = g.spawn('inf', 1, 2, 1, 40); const b = g.spawn('inf', 2, 2, 1, 80);
  const res = g.commit(a.id, [{ x: 1, y: 2 }, { x: 2, y: 2 }], { type: 'join' });
  assert.ok(res.ok, res.error); assert.strictEqual(b.hp, 100); assert.ok(!g.unitById(a.id));
  assert.strictEqual(res.events.find(e => e.type === 'join').refund, 200);
});
test('Bau in Fabrik', () => {
  const g = newGame(); assert.ok(g.build(1, 'tank', 1, 0)); assert.strictEqual(g.currentPlayer().funds, 5000);
  assert.ok(!g.build(1, 'tank', 1, 0));
});
test('Reparatur auf Stadt', () => {
  const g = newGame(); const t = g.spawn('tank', 0, 2, 1, 50); g.map.owner[2][0] = 1;
  g.endTurn(); g.endTurn(); assert.strictEqual(t.hp, 70);
});
test('Treibstoff: Flieger stürzt ab', () => {
  const g = newGame(); const f = g.spawn('fighter', 4, 3, 1); f.fuel = 3;
  g.endTurn(); const ev = g.endTurn();
  assert.ok(ev.some(e => e.type === 'crash')); assert.ok(!g.unitById(f.id));
});
test('Nebel versteckt Gegner', () => {
  const g = newGame({ fog: true }); const far = g.spawn('tank', 7, 4, 2);
  assert.ok(!g.unitVisibleTo(far, 1)); assert.ok(g.unitVisibleTo(far, 2));
});
test('Hinterhalt im Nebel', () => {
  const g = newGame({ fog: true });
  g.units = g.units.filter(u => u.p === 1);
  const hid = g.spawn('inf', 6, 2, 2); const t = g.spawn('tank', 0, 2, 1); // Panzer sieht 4 Felder
  assert.ok(!g.unitVisibleTo(hid, 1));
  const res = g.commit(t.id, [0, 1, 2, 3, 4, 5, 6].map(x => ({ x, y: 2 })), { type: 'wait' });
  assert.ok(res.ok, res.error); assert.ok(res.events.some(e => e.type === 'trap')); assert.strictEqual(t.x, 5);
});
test('CO-Kraft lädt und wirkt', () => {
  const g = newGame(); const pl = g.currentPlayer(); pl.power = g.powerMax(1);
  const t = g.unitAt(3, 0); t.hp = 50;
  assert.ok(g.canActivate(1, 2)); g.activatePower(1, 2);
  assert.strictEqual(t.hp, 100); assert.strictEqual(pl.power, 0); assert.strictEqual(pl.powerActive, 2);
  g.endTurn(); g.endTurn(); assert.strictEqual(pl.powerActive, 0);
});
test('Power lädt durch Kampf', () => {
  const g = newGame(); const t = g.unitAt(3, 0), e = g.unitAt(5, 0);
  g.commit(t.id, g.pathTo(g.reachable(t), 4, 0), { type: 'attack', targetId: e.id });
  assert.ok(g.playerBySlot(1).power > 0 && g.playerBySlot(2).power > g.playerBySlot(1).power);
});
test('Speichern & Laden', () => {
  const g = newGame(); const s = g.serialize(); const g2 = G.Game.load(s);
  assert.strictEqual(g2.units.length, g.units.length); assert.strictEqual(g2.serialize(), s);
});
test('U-Boot getaucht: nur Kreuzer/U-Boot', () => {
  const g = newGame(); const sub = g.spawn('sub', 3, 4, 2); sub.dived = true;
  assert.strictEqual(g.weaponFor(g.spawn('bcopter', 3, 3, 1), sub), null);
  assert.ok(g.weaponFor(g.spawn('cruiser', 4, 4, 1), sub));
});
test('Aufgeben', () => {
  const g = newGame(); g.resign(1); assert.ok(g.over); assert.strictEqual(g.winner, 2);
});
test('Überlebensziel', () => {
  const g = newGame({ objective: { type: 'survive', days: 2, slot: 1 } });
  g.endTurn(); g.endTurn(); assert.ok(!g.over); g.endTurn(); g.endTurn(); assert.ok(g.over); assert.strictEqual(g.winner, 1);
});
test('Wetter: Schnee verteuert Bewegung, Schiffe unbeeinflusst', () => {
  const g = newGame(); g.weather = 'schnee';
  assert.strictEqual(g.moveCost('tank', 0, 3), 2);   // Ebene 1 + 1
  assert.strictEqual(g.moveCost('tank', 1, 2), 1);   // Straße bleibt
  assert.strictEqual(g.moveCost('fighter', 3, 4), 2); // Luft überall +1
  assert.strictEqual(g.moveCost('lander', 3, 4), 1); // Meer unverändert
});
test('Wetter: Regen schaltet Nebel ein und senkt Sicht', () => {
  const g = newGame(); const t = g.unitAt(3, 0);
  const v0 = g.visionOf(t, t.x, t.y);
  g.weather = 'regen'; g.touch();
  assert.ok(g.fogActive()); assert.strictEqual(g.visionOf(t, t.x, t.y), v0 - 1);
  assert.strictEqual(g.moveCost('tank', 0, 3), 2); assert.strictEqual(g.moveCost('inf', 0, 3), 1);
});
test('Wetter: Tag & Nacht wechselt jeden dritten Tag', () => {
  const g = newGame({ meta: { weatherMode: 'tagnacht' } });
  const seen = [];
  for (let i = 0; i < 8; i++) { seen.push(g.day + ':' + g.weather); g.endTurn(); g.endTurn(); }
  assert.ok(seen.indexOf('3:nacht') >= 0 && seen.indexOf('2:klar') >= 0 && seen.indexOf('6:nacht') >= 0, seen.join(' '));
});
test('Wetter wird gespeichert', () => {
  const g = newGame({ meta: { weatherMode: 'schnee' } });
  assert.strictEqual(g.weather, 'schnee');
  const g2 = G.Game.load(g.serialize());
  assert.strictEqual(g2.weather, 'schnee'); assert.strictEqual(g2.weatherMode, 'schnee');
});
test('Wechselhaftes Wetter ändert sich', () => {
  const g = newGame({ meta: { weatherMode: 'wechselhaft' }, seed: 5 });
  const kinds = {};
  for (let i = 0; i < 40; i++) { kinds[g.weather] = 1; g.endTurn(); g.endTurn(); if (g.over) break; }
  assert.ok(Object.keys(kinds).length >= 2, JSON.stringify(kinds));
});
test('Pionier baut Bunker, Bunker ist unbeweglich und zäh', () => {
  const g = newGame(); const p = g.spawn('pionier', 1, 3, 1);
  const acts = g.actionsFor(p, [{ x: 1, y: 3 }]);
  const fo = acts.find(a => a.type === 'fortify'); assert.ok(fo, 'fortify verfügbar');
  const funds = g.currentPlayer().funds;
  const res = g.commit(p.id, [{ x: 1, y: 3 }], { type: 'fortify', build: 'bunker', x: 0, y: 3 });
  assert.ok(res.ok, res.error);
  const b = g.unitAt(0, 3); assert.strictEqual(b.type, 'bunker');
  assert.strictEqual(g.currentPlayer().funds, funds - 6000);
  assert.strictEqual(g.moveOf(b), 0);
  assert.ok(g.coDef(b, null) >= 130);
});
test('Küstenbatterie nur an der Küste', () => {
  const g = newGame(); const p = g.spawn('pionier', 6, 2, 1);
  const fo = g.fortifyOptions(p, 6, 2).find(o => o.type === 'coast');
  assert.ok(fo.tiles.every(t => t.y === 3), JSON.stringify(fo.tiles)); // nur Felder neben dem Meer (Zeile 3 grenzt an Zeile 4 = Meer)
});
test('Geschützturm feuert jede Runde ohne Bewegung', () => {
  const g = newGame(); const t = g.spawn('turret', 3, 2, 1); const tk = g.spawn('tank', 6, 2, 2);
  const tg = g.targetsFrom(t, 3, 2, false);
  assert.ok(tg.indexOf(tk) >= 0); assert.ok(tg.every(u => Math.abs(u.x - 3) + Math.abs(u.y - 2) >= 2));
});
test('Bergepanzer repariert Nachbarn', () => {
  const g = newGame(); const r = g.spawn('bergepanzer', 2, 2, 1); const t = g.spawn('tank', 3, 2, 1, 50);
  const res = g.commit(r.id, [{ x: 2, y: 2 }], { type: 'repair', targetId: t.id });
  assert.ok(res.ok, res.error); assert.strictEqual(t.hp, 70);
});
test('Flugzeugträger trägt und versorgt Flieger', () => {
  const g = newGame(); const c = g.spawn('carrier', 4, 4, 1); const f = g.spawn('fighter', 4, 3, 1); f.fuel = 20;
  const res = g.commit(f.id, [{ x: 4, y: 3 }, { x: 4, y: 4 }], { type: 'load' });
  assert.ok(res.ok, res.error); assert.strictEqual(c.cargo.length, 1);
  g.endTurn(); g.endTurn();
  assert.strictEqual(c.cargo[0].fuel, G.UNITS.fighter.fuel);
});
test('Stellungen zählen nicht als Armee', () => {
  const g = newGame();
  g.units = g.units.filter(u => u.p === 1); g.spawn('bunker', 6, 2, 2); g.playerBySlot(2).hadUnits = true;
  g.checkVictory([]); assert.ok(g.over); assert.strictEqual(g.winner, 1);
});
test('Erkundung: nur Gesehenes ist bekannt, Besitzer wird gemerkt', () => {
  const g = newGame({ meta: { vision: 'erkundung' } });
  assert.ok(g.fogActive());
  assert.ok(g.isExplored(1, 0, 0)); assert.ok(!g.isExplored(1, 7, 4));
  const r = g.spawn('recon', 6, 3, 1); g.touch();
  assert.ok(g.isExplored(1, 7, 4));
  const m = g.memoOf(1); assert.strictEqual(m.owner[1 * 8 + 7], 2); // gegnerisches HQ gesehen
  g.removeUnit(r); g.map.owner[1][7] = 0; g.touch(); g.visibility(1);
  assert.strictEqual(m.owner[1 * 8 + 7], 2, 'nicht mehr sichtbar: alter Besitzer bleibt im Gedächtnis');
  const g2 = G.Game.load(g.serialize());
  assert.ok(g2.isExplored(1, 7, 4)); assert.strictEqual(g2.memoOf(1).owner[1 * 8 + 7], 2);
});
// ---- Fusion zweier Kommandanten
test('Fusion: stabiles Objekt, Name, Sterne, coFor', () => {
  const f = G.fuseCOs('rika', 'ole');
  assert.strictEqual(f, G.fuseCOs('rika', 'ole'), 'gleiche Identität bei gleichen Argumenten');
  assert.strictEqual(f.id, 'rika+ole'); assert.ok(f.fused); assert.strictEqual(f.a, G.COS.rika); assert.strictEqual(f.b, G.COS.ole);
  assert.strictEqual(f.name, 'Rika & Ole'); assert.strictEqual(f.fullName, 'Rika Brand & Ole Gischt'); assert.strictEqual(f.faction, 'red');
  assert.strictEqual(f.power.stars, 5); assert.strictEqual(f.superPower.stars, 9);
  assert.strictEqual(f.power.name, 'Zweiter Atem + Springflut'); assert.strictEqual(f.superPower.name, 'Flammenfront + Sturmflut');
  assert.ok(/^Fusion – Boni beider Kommandanten zu je 70 %: /.test(f.d2d) && f.bio);
  assert.strictEqual(G.coFor({ co: 'rika', co2: 'ole' }), f);
  assert.strictEqual(G.coFor({ co: 'rika' }), G.COS.rika);
  assert.strictEqual(G.coFor({ co: 'rika', co2: 'rika' }), G.COS.rika);
  assert.strictEqual(G.coFor({ co: 'rika', co2: 'nix' }), G.COS.rika);
  assert.strictEqual(G.fuseCOs('rika', 'nix'), null);
});
test('Fusion: Hooks – 70 % der Summe, Summe, Spanne, Produkt, Maximum', () => {
  const bj = G.fuseCOs('bastian', 'jara');
  assert.strictEqual(bj.atk('tank', null, 0), 7);   // round(0.7 * (20 - 10))
  assert.strictEqual(bj.atk('arty', null, 0), 7);   // round(0.7 * (-10 + 20))
  assert.strictEqual(bj.atk('apc', null, 0), 0);
  assert.ok(!bj.def && !bj.vision && !bj.luck && !bj.cost && !bj.capture && !bj.piercing && !bj.onPower, 'Hooks nur, wenn ein Partner sie hat');
  assert.strictEqual(bj.move('tank', 1), 1); assert.strictEqual(bj.range('arty', 2), 2); assert.strictEqual(bj.range('tank', 2), 0);
  const vb = G.fuseCOs('viktor', 'bastian');
  assert.strictEqual(vb.def('tank', null, 0), 14);  // round(0.7 * (20 + 0))
  assert.strictEqual(vb.move('tank', 0), -1);       // Viktor −1 (Fahrzeug ohne Kraft), Bastian 0
  assert.strictEqual(vb.move('tank', 1), 1);        // Viktor 0, Bastian +1
  assert.strictEqual(vb.atk('tank', null, 0), 14);
  assert.deepStrictEqual(G.fuseCOs('fortuna', 'rika').luck(0), [0, 19]);
  assert.deepStrictEqual(G.fuseCOs('fortuna', 'rika').luck(2), [0, 69]);
  assert.strictEqual(G.fuseCOs('mira', 'rika').cost('fighter'), 0.9); assert.strictEqual(G.fuseCOs('mira', 'rika').cost('tank'), 1);
  assert.strictEqual(G.fuseCOs('kurt', 'rika').capture(0), 1.5); assert.strictEqual(G.fuseCOs('kurt', 'rika').capture(2), 2);
  const gr = G.fuseCOs('greta', 'rika');
  assert.strictEqual(gr.piercing(0), false); assert.strictEqual(gr.piercing(1), true);
  assert.strictEqual(gr.vision('inf', 0), 1); assert.strictEqual(gr.vision('inf', 2), 4);
});
test('Fusion im Spiel: coOf, Angriff, Verteidigung, Bewegung, Kraftleiste', () => {
  const g = newGame({ players: [{ slot: 1, faction: 'blue', co: 'bastian', co2: 'jara' }, { slot: 2, faction: 'yellow', co: 'viktor', co2: 'bastian' }] });
  assert.ok(g.coOf(1).fused); assert.strictEqual(g.coOf(1).id, 'bastian+jara'); assert.strictEqual(g.coOf(1), G.fuseCOs('bastian', 'jara'));
  assert.strictEqual(g.coAtk(g.unitAt(3, 0), null), 107);
  assert.strictEqual(g.coDef(g.unitAt(5, 0), null), 114);
  const t2 = g.spawn('tank', 6, 2, 2);
  assert.strictEqual(g.moveOf(t2), G.UNITS.tank.move - 1);
  assert.strictEqual(g.powerMax(1), 9 * g.starCost(1));
  assert.strictEqual(g.powerMax(2), Math.ceil((7 + 6) * 0.75) * g.starCost(2));
  const a = g.spawn('arty', 3, 2, 1); g.playerBySlot(1).powerActive = 2;
  assert.deepStrictEqual(g.rangeOf(a), [2, 5]); // Jara +2 Reichweite bei Superkraft
});
test('Fusion: Kraft löst beide Sofort-Effekte aus, Ereignis trägt co und co2', () => {
  const g = newGame({ players: [{ slot: 1, faction: 'red', co: 'rika', co2: 'ole' }, { slot: 2, faction: 'blue', co: 'bastian' }] });
  const pl = g.currentPlayer(); pl.power = g.powerMax(1);
  const t = g.unitAt(3, 0); t.hp = 50; const e = g.unitAt(5, 0);
  assert.ok(g.canActivate(1, 2));
  const ev = g.activatePower(1, 2);
  assert.strictEqual(t.hp, 100, 'Rika heilt 5 KP'); assert.strictEqual(e.hp, 80, 'Ole nimmt Gegnern 2 KP');
  assert.strictEqual(ev.co, 'rika'); assert.strictEqual(ev.co2, 'ole'); assert.strictEqual(ev.name, 'Flammenfront + Sturmflut');
  assert.strictEqual(g.coAtk(t, null), 110); // Rika +10, Ole −10 (Boden) → 0, plus Kraft-Bonus 10
  // ohne Fusion: co2 im Ereignis null
  const g2 = newGame(); g2.currentPlayer().power = g2.powerMax(1);
  const ev2 = g2.activatePower(1, 1);
  assert.strictEqual(ev2.co, 'rika'); assert.strictEqual(ev2.co2, null); assert.strictEqual(ev2.name, 'Zweiter Atem');
});
test('Fusion: co2 nur bei gültigem Wert; Speichern & Laden behält co2, alte Spielstände laden', () => {
  const g = newGame({ players: [{ slot: 1, faction: 'red', co: 'rika', co2: 'mira' }, { slot: 2, faction: 'blue', co: 'bastian', co2: 'bastian' }] });
  assert.strictEqual(g.playerBySlot(1).co2, 'mira'); assert.strictEqual(g.playerBySlot(2).co2, null);
  assert.strictEqual(newGame({ players: [{ slot: 1, faction: 'red', co: 'rika', co2: 'nix' }, { slot: 2, faction: 'blue', co: 'rika' }] }).playerBySlot(1).co2, null);
  assert.strictEqual(newGame({ players: [{ slot: 1, faction: 'red', co2: 'rika' }, { slot: 2, faction: 'blue', co: 'rika' }] }).playerBySlot(1).co2, null, 'Standard-CO der Fraktion = Partner');
  assert.strictEqual(newGame().playerBySlot(1).co2, null);
  const g2 = G.Game.load(g.serialize());
  assert.strictEqual(g2.playerBySlot(1).co2, 'mira'); assert.strictEqual(g2.coOf(1), g.coOf(1)); assert.strictEqual(g2.coOf(2), G.COS.bastian);
  const d = JSON.parse(g.serialize()); d.players.forEach(p => { delete p.co2; });
  const g3 = G.Game.load(JSON.stringify(d));
  assert.strictEqual(g3.coOf(1), G.COS.rika, 'alter Spielstand ohne co2: kein Fusion');
  assert.strictEqual(g3.stateHash(), g.stateHash(), 'Kommandanten sind nicht Teil der Prüfsumme');
  const g4 = G.gameFromSetup({ map: MAP, players: [{ slot: 1, faction: 'red', co: 'rika', co2: 'kurt' }, { slot: 2, faction: 'blue', co: 'ole' }], funds: 1000 });
  assert.strictEqual(g4.coOf(1).name, 'Rika & Kurt');
});
console.log(`\n${passed} Tests bestanden`);
