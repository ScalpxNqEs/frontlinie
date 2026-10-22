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
  const f = G.fuseCOs('rika', 'frida');
  assert.strictEqual(f, G.fuseCOs('rika', 'frida'), 'gleiche Identität bei gleichen Argumenten');
  assert.strictEqual(f.id, 'rika+frida'); assert.ok(f.fused); assert.strictEqual(f.a, G.COS.rika); assert.strictEqual(f.b, G.COS.frida);
  assert.strictEqual(f.name, 'Rika & Frida'); assert.strictEqual(f.fullName, 'Rika Brand & Frida Frost'); assert.strictEqual(f.faction, 'red');
  assert.strictEqual(f.power.stars, Math.ceil((G.COS.rika.power.stars + G.COS.frida.power.stars) * 0.75));
  assert.strictEqual(f.superPower.stars, Math.ceil((G.COS.rika.superPower.stars + G.COS.frida.superPower.stars) * 0.75));
  assert.strictEqual(f.power.name, 'Zweiter Atem + Kälteeinbruch'); assert.strictEqual(f.superPower.name, 'Flammenfront + Schneesturm');
  assert.ok(/^Fusion – Boni beider Kommandanten zu je 70 %: /.test(f.d2d) && f.bio);
  assert.strictEqual(G.coFor({ co: 'rika', co2: 'frida' }), f);
  assert.strictEqual(G.coFor({ co: 'rika' }), G.COS.rika);
  assert.strictEqual(G.coFor({ co: 'rika', co2: 'rika' }), G.COS.rika);
  assert.strictEqual(G.coFor({ co: 'rika', co2: 'nix' }), G.COS.rika);
  assert.strictEqual(G.fuseCOs('rika', 'nix'), null);
});
test('Fusion: Hooks – 70 % der Summe, Summe, Spanne, Produkt, Maximum', () => {
  const bj = G.fuseCOs('bastian', 'jara'), B = G.COS.bastian, J = G.COS.jara;
  assert.strictEqual(bj.atk('tank', null, 0), Math.round(0.7 * (B.atk('tank', null, 0) + J.atk('tank', null, 0))));
  assert.strictEqual(bj.atk('arty', null, 2), Math.round(0.7 * (B.atk('arty', null, 2) + J.atk('arty', null, 2))));
  assert.strictEqual(bj.atk('apc', null, 0), 0);
  assert.ok(!bj.def && !bj.vision && !bj.luck && !bj.cost && !bj.capture && !bj.piercing && !bj.income && !bj.weatherImmune, 'Hooks nur, wenn ein Partner sie hat');
  assert.ok(bj.onPower && !G.fuseCOs('bastian', 'mira').def, 'Sofort-Effekt von Jara übernommen');
  assert.strictEqual(bj.move('tank', 1), 1); assert.strictEqual(bj.range('arty', 2), J.range('arty', 2)); assert.strictEqual(bj.range('tank', 2), 0);
  const vb = G.fuseCOs('viktor', 'bastian');
  assert.strictEqual(vb.def('tank', null, 0), Math.round(0.7 * G.COS.viktor.def('tank', null, 0)));
  assert.strictEqual(vb.move('tank', 0), -1);       // Viktor −1 (Fahrzeug ohne Kraft), Bastian 0
  assert.strictEqual(vb.move('tank', 1), 1);        // Viktor 0, Bastian +1
  assert.strictEqual(vb.atk('tank', null, 0), Math.round(0.7 * (G.COS.viktor.atk('tank', null, 0) + B.atk('tank', null, 0))));
  assert.strictEqual(G.fuseCOs('mira', 'rika').cost('fighter'), 0.9); assert.strictEqual(G.fuseCOs('mira', 'rika').cost('tank'), 1);
  assert.strictEqual(G.fuseCOs('kurt', 'rika').capture(0), 1.5); assert.strictEqual(G.fuseCOs('kurt', 'rika').capture(2), 2);
  // Glück, Sicht, Durchblick nutzt derzeit kein Kommandant – mit einem Probe-CO prüfen, dass die Fusion sie weiter kann
  G.COS.probe = { id: 'probe', name: 'Probe Test', faction: 'red', d2d: '-', power: { name: 'P', stars: 2, desc: '' }, superPower: { name: 'S', stars: 4, desc: '' },
    luck: p => [0, 19 + 25 * p], vision: (t, p) => 1 + p, piercing: p => p > 0 };
  try {
    const pr = G.fuseCOs('probe', 'rika');
    assert.deepStrictEqual(pr.luck(0), [0, 19]); assert.deepStrictEqual(pr.luck(2), [0, 69]);
    assert.strictEqual(pr.piercing(0), false); assert.strictEqual(pr.piercing(1), true);
    assert.strictEqual(pr.vision('inf', 0), 1); assert.strictEqual(pr.vision('inf', 2), 3);
  } finally { delete G.COS.probe; }
});
test('Fusion im Spiel: coOf, Angriff, Verteidigung, Bewegung, Kraftleiste', () => {
  const g = newGame({ players: [{ slot: 1, faction: 'blue', co: 'bastian', co2: 'jara' }, { slot: 2, faction: 'yellow', co: 'viktor', co2: 'bastian' }] });
  assert.ok(g.coOf(1).fused); assert.strictEqual(g.coOf(1).id, 'bastian+jara'); assert.strictEqual(g.coOf(1), G.fuseCOs('bastian', 'jara'));
  assert.strictEqual(g.coAtk(g.unitAt(3, 0), null), 100 + Math.round(0.7 * (G.COS.bastian.atk('tank', null, 0) + G.COS.jara.atk('tank', null, 0))));
  assert.strictEqual(g.coDef(g.unitAt(5, 0), null), 100 + Math.round(0.7 * G.COS.viktor.def('inf', null, 0)));
  const t2 = g.spawn('tank', 6, 2, 2);
  assert.strictEqual(g.moveOf(t2), G.UNITS.tank.move - 1);
  assert.strictEqual(g.powerMax(1), Math.ceil((G.COS.bastian.superPower.stars + G.COS.jara.superPower.stars) * 0.75) * g.starCost(1));
  assert.strictEqual(g.powerMax(2), Math.ceil((G.COS.viktor.superPower.stars + G.COS.bastian.superPower.stars) * 0.75) * g.starCost(2));
  const a = g.spawn('arty', 3, 2, 1); g.playerBySlot(1).powerActive = 2;
  assert.deepStrictEqual(g.rangeOf(a), [2, 3 + G.COS.jara.range('arty', 2)]); // Jaras Reichweite bei Superkraft (Summe, nicht 70 %)
});
test('Fusion: Kraft löst beide Sofort-Effekte aus, Ereignis trägt co und co2', () => {
  const g = newGame({ players: [{ slot: 1, faction: 'red', co: 'rika', co2: 'kraehe' }, { slot: 2, faction: 'blue', co: 'bastian' }] });
  const pl = g.currentPlayer(); pl.power = g.powerMax(1);
  const t = g.unitAt(3, 0); t.hp = 50; const e = g.unitAt(5, 0);
  assert.ok(g.canActivate(1, 2));
  const ev = g.activatePower(1, 2);
  const hit = 100 - e.hp;
  assert.strictEqual(t.hp, 100, 'Rika heilt 5 KP'); assert.ok(hit >= 10 && hit % 10 === 0, 'Krähe nimmt Gegnern KP: ' + hit);
  assert.strictEqual(ev.co, 'rika'); assert.strictEqual(ev.co2, 'kraehe'); assert.strictEqual(ev.name, 'Flammenfront + Krähenschwarm');
  assert.strictEqual(g.coAtk(t, null), 100 + Math.round(0.7 * (10 + G.COS.kraehe.atk('tank', null, 2))) + G.RULES.powerAtk);
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
  const g4 = G.gameFromSetup({ map: MAP, players: [{ slot: 1, faction: 'red', co: 'rika', co2: 'kurt' }, { slot: 2, faction: 'blue', co: 'frida' }], funds: 1000 });
  assert.strictEqual(g4.coOf(1).name, 'Rika & Kurt');
});
// ---- Kommandanten-Kader, Geld- und Wetter-Kommandanten
test('Kader: höchstens 10 Kommandanten, Reihenfolge vollständig, Fraktionen und Kampagne gültig', () => {
  const ids = Object.keys(G.COS);
  assert.ok(ids.length <= 10, ids.length + ' Kommandanten');
  assert.deepStrictEqual(G.CO_ORDER.slice().sort(), ids.slice().sort(), 'CO_ORDER enthält genau alle Kommandanten');
  assert.strictEqual(G.CO_ORDER[0], 'rika'); assert.strictEqual(G.CO_ORDER[1], 'bastian');
  ids.forEach(id => {
    const co = G.COS[id];
    assert.strictEqual(co.id, id); assert.ok(G.FACTIONS[co.faction] && co.faction !== 'neutral', id + ': Fraktion');
    assert.ok(co.name && co.bio && co.d2d && co.power.name && co.superPower.name && co.power.desc && co.superPower.desc, id + ': Texte');
  });
  G.FACTION_ORDER.forEach(f => assert.ok(G.COS[G.FACTIONS[f].co], f + ': Standard-CO'));
  const used = new Set();
  G.CAMPAIGN.forEach(m => {
    [m.player].concat(m.enemies || [], m.allies || []).forEach(p => { if (p.co) used.add(p.co); });
    (m.intro || []).concat(m.outro || []).forEach(l => { if (l.co) used.add(l.co); });
  });
  used.forEach(id => assert.ok(ids.indexOf(id) >= 0, 'Kampagne nutzt unbekannten Kommandanten ' + id));
});
test('Geld-Kommandantin: Einkommen-Hook und Sofort-Auszahlung', () => {
  const g = newGame({ players: [{ slot: 1, faction: 'yellow', co: 'tilda' }, { slot: 2, faction: 'blue', co: 'rika' }] });
  const f = G.COS.tilda.income(0);
  assert.ok(f > 1 && f < 1.3, 'Einkommen-Faktor ' + f);
  assert.strictEqual(g.incomeOf(1), Math.round(2 * 1000 * f)); assert.strictEqual(g.incomeOf(2), 2000);
  assert.strictEqual(g.currentPlayer().funds, 10000 + Math.round(2000 * f), 'Tag 1 mit Zuschlag');
  g.endTurn();
  const ev = g.endTurn().find(e => e.type === 'income');
  assert.strictEqual(ev.slot, 1); assert.strictEqual(ev.amount, Math.round(2000 * f));
  const g5 = newGame({ players: [{ slot: 1, faction: 'yellow', co: 'tilda' }, { slot: 2, faction: 'blue', co: 'rika' }], meta: { income: 500 } });
  assert.strictEqual(g5.incomeOf(1), Math.round(1000 * f), 'Faktor auch bei anderem Einkommen je Gebäude');
  // Kraft: Sofort-Auszahlung als Anteil eines Tageseinkommens (ohne Faktor), Superkraft mehr
  const pl = g.currentPlayer(); const before = pl.funds;
  pl.power = g.powerMax(1); g.activatePower(1, 1);
  const k1 = pl.funds - before; assert.ok(k1 > 0 && k1 < 2000, 'Kraft zahlt ' + k1);
  g.endTurn(); g.endTurn();
  const b2 = pl.funds; pl.power = g.powerMax(1); g.activatePower(1, 2);
  assert.ok(pl.funds - b2 > k1, 'Superkraft zahlt mehr');
  assert.ok(!G.COS.tilda.atk && !G.COS.tilda.def, 'keine Einheiten-Boni');
});
test('Wetter-Kraft: Regen heute und morgen, danach wieder frei – auch bei „Immer klar“', () => {
  const g = newGame({ players: [{ slot: 1, faction: 'green', co: 'nora' }, { slot: 2, faction: 'blue', co: 'rika' }], meta: { weatherMode: 'klar' } });
  assert.strictEqual(g.weather, 'klar');
  g.currentPlayer().power = g.powerMax(1);
  g.activatePower(1, 1);
  assert.strictEqual(g.weather, 'regen'); assert.strictEqual(g.weatherLeft, 1); assert.ok(g.fogActive());
  const log = [];
  for (let i = 0; i < 6; i++) { const evs = g.endTurn(); log.push(g.day + '/' + g.turnIdx + ':' + g.weather + (evs.some(e => e.type === 'weather') ? '!' : '')); }
  assert.deepStrictEqual(log, ['1/1:regen', '2/0:regen', '2/1:regen', '3/0:klar!', '3/1:klar', '4/0:klar']);
  const g2 = G.Game.load(g.serialize()); assert.strictEqual(g2.weatherLeft, g.weatherLeft);
});
test('Wetter-Kraft bei wechselhaftem Wetter und Dauerwetter', () => {
  const g = newGame({ players: [{ slot: 1, faction: 'blue', co: 'frida' }, { slot: 2, faction: 'blue', co: 'rika' }], meta: { weatherMode: 'regen' } });
  g.currentPlayer().power = g.powerMax(1); g.activatePower(1, 2);
  assert.strictEqual(g.weather, 'schnee');
  g.endTurn(); g.endTurn(); assert.strictEqual(g.weather, 'schnee', 'Tag 2: noch Schnee');
  g.endTurn(); g.endTurn(); assert.strictEqual(g.weather, 'regen', 'Tag 3: zurück zum Dauerregen');
  const w = newGame({ players: [{ slot: 1, faction: 'green', co: 'nora' }, { slot: 2, faction: 'blue', co: 'rika' }], meta: { weatherMode: 'wechselhaft' }, seed: 9 });
  w.currentPlayer().power = w.powerMax(1); w.activatePower(1, 1);
  w.endTurn(); w.endTurn(); assert.strictEqual(w.weather, 'regen');
  const kinds = {}; for (let i = 0; i < 40; i++) { w.endTurn(); w.endTurn(); kinds[w.weather] = 1; }
  assert.ok(Object.keys(kinds).length >= 2, 'danach würfelt das Wetter wieder: ' + JSON.stringify(kinds));
});
test('Wetter-Bonus: Nora +10 % Angriff nur bei Regen, Frida (kleinerer Bonus) nur bei Schnee', () => {
  const g = newGame({ players: [{ slot: 1, faction: 'green', co: 'nora' }, { slot: 2, faction: 'blue', co: 'frida' }] });
  const t = g.unitAt(3, 0), e = g.unitAt(5, 0);
  const atk = w => { g.weather = w; g.touch(); return [g.coAtk(t, e), g.coAtk(e, t)]; };
  assert.deepStrictEqual(atk('klar'), [100, 100]);
  assert.deepStrictEqual(atk('regen'), [110, 100]);
  const fs = G.COS.frida.atk('inf', null, 0, { weather: 'schnee' });
  assert.ok(fs > 0 && fs <= 10, 'Frida-Schneebonus ' + fs);
  assert.deepStrictEqual(atk('schnee'), [100, 100 + fs]);
  assert.deepStrictEqual(atk('nacht'), [100, 100]);
  g.weather = 'regen'; const d1 = g.calcDamage(t, e, 100, 5, 0, 0); g.weather = 'klar'; const d0 = g.calcDamage(t, e, 100, 5, 0, 0);
  assert.ok(d1 > d0, 'mehr Schaden im Regen: ' + d0 + ' → ' + d1);
  assert.strictEqual(g.coDef(t, e), 100, 'bei Sonne keine Verteidigung extra');
  g.weather = 'regen'; assert.strictEqual(g.coDef(t, e), 105, 'Nora im Regen +5 % Verteidigung'); assert.strictEqual(g.coDef(e, t), 100);
  // mit aktiver Kraft steigt der Regen-Bonus, der allgemeine Kraft-Bonus kommt dazu
  g.weather = 'regen'; g.playerBySlot(1).powerActive = 1;
  assert.strictEqual(g.coAtk(t, e), 100 + G.COS.nora.atk('tank', null, 1, g) + G.RULES.powerAtk);
  assert.ok(G.COS.nora.atk('tank', null, 2, g) > G.COS.nora.atk('tank', null, 1, g));
});
test('Bewegungs-Immunität: Wetter-CO ohne Bewegungsnachteil; Gegner, Zugprüfung, Kosten ohne Besitzer', () => {
  const mk = co => {
    const g = newGame({ players: [{ slot: 1, faction: 'green', co }, { slot: 2, faction: 'blue', co: co === 'nora' ? 'frida' : 'nora' }] });
    g.units = []; g.weather = 'regen'; g.touch(); return g;
  };
  const g = mk('nora');
  assert.strictEqual(g.moveCost('tank', 0, 3, 1), 1, 'Nora im Regen: Ebene 1');
  assert.strictEqual(g.moveCost('tank', 0, 3, 2), 2, 'Frida im Regen: Ebene 2');
  assert.strictEqual(g.moveCost('tank', 0, 3), 2, 'ohne Besitzer (z. B. KI-Kostentabellen): normale Wetterkosten');
  assert.strictEqual(g.moveCostMt('tread', 0, 3, 1), 1);
  g.weather = 'schnee'; g.touch();
  assert.strictEqual(g.moveCost('tank', 0, 3, 1), 2, 'Nora im Schnee: Nachteil');
  assert.strictEqual(g.moveCost('tank', 0, 3, 2), 1, 'Frida im Schnee: kein Nachteil');
  assert.strictEqual(g.moveCost('fighter', 3, 4, 2), 1); assert.strictEqual(g.moveCost('fighter', 3, 4, 1), 2);
  assert.strictEqual(g.moveCost('tank', 4, 1, 2), 0, 'Berg bleibt für Panzer unpassierbar');
  // 4 Felder Ebene im Regen: 4 statt 8 Bewegungspunkte (Panzer hat 6)
  g.weather = 'regen'; g.touch();
  const path = [2, 3, 4, 5, 6].map(x => ({ x, y: 0 }));
  const t = g.spawn('tank', 2, 0, 1);
  assert.ok(g.reachable(t).nodes[6], 'Nora-Panzer erreicht (6,0)');
  const r = g.commit(t.id, path, { type: 'wait' }); assert.ok(r.ok, r.error); assert.strictEqual(t.x, 6);
  const h = mk('frida'); const t2 = h.spawn('tank', 2, 0, 1);
  assert.ok(!h.reachable(t2).nodes[6], 'ohne Immunität zu weit');
  assert.strictEqual(h.commit(t2.id, path, { type: 'wait' }).error, 'too far');
  h.weather = 'klar'; h.touch(); assert.ok(h.reachable(t2).nodes[6], 'bei Sonne erreichbar');
});
test('Fusion mit Geld- und Wetter-Hooks: Einkommen 70 %, Wetterfestigkeit einer genügt, beide Kräfte', () => {
  const tn = G.fuseCOs('tilda', 'nora');
  assert.ok(Math.abs(tn.income(0) - (1 + 0.7 * (G.COS.tilda.income(0) - 1))) < 1e-9, 'Zuschlag zu 70 %');
  assert.strictEqual(tn.weatherImmune('regen', 0), true); assert.strictEqual(tn.weatherImmune('schnee', 0), false);
  const nf = G.fuseCOs('nora', 'frida');
  assert.ok(nf.weatherImmune('regen', 0) && nf.weatherImmune('schnee', 0) && !nf.weatherImmune('nacht', 0));
  const rb = G.fuseCOs('rika', 'bastian');
  assert.ok(!rb.income && !rb.weatherImmune, 'Hooks nur, wenn ein Partner sie hat');
  const g = newGame({ players: [{ slot: 1, faction: 'yellow', co: 'tilda', co2: 'nora' }, { slot: 2, faction: 'blue', co: 'rika' }], meta: { weatherMode: 'klar' } });
  assert.strictEqual(g.incomeOf(1), Math.round(2000 * tn.income(0)));
  g.weather = 'regen'; g.touch();
  assert.strictEqual(g.moveCost('tank', 0, 3, 1), 1, 'Fusion erbt Noras Wetterfestigkeit');
  assert.strictEqual(g.coAtk(g.unitAt(3, 0), null), 100 + Math.round(0.7 * 10), 'Regen-Bonus zu 70 %');
  g.weather = 'klar'; g.touch();
  const pl = g.currentPlayer(), f0 = pl.funds; pl.power = g.powerMax(1); g.activatePower(1, 1);
  assert.ok(pl.funds > f0, 'Tildas Auszahlung'); assert.strictEqual(g.weather, 'regen', 'Noras Regen');
  const h = newGame({ players: [{ slot: 1, faction: 'green', co: 'nora', co2: 'frida' }, { slot: 2, faction: 'blue', co: 'rika' }] });
  h.currentPlayer().power = h.powerMax(1); h.activatePower(1, 1);
  assert.strictEqual(h.weather, 'schnee', 'zwei Wetter-Kräfte: das Wetter des zweiten gilt');
});
test('Alte Spielstände mit entfernten Kommandanten laden weiter (Nachfolger, nicht in Listen)', () => {
  assert.strictEqual(G.COS.fortuna, G.COS.tilda); assert.strictEqual(G.COS.ole, G.COS.frida); assert.strictEqual(G.COS.greta, G.COS.nora);
  ['fortuna', 'ole', 'greta'].forEach(id => assert.ok(Object.keys(G.COS).indexOf(id) < 0 && G.CO_ORDER.indexOf(id) < 0, id));
  const g = newGame({ players: [{ slot: 1, faction: 'blue', co: 'ole', co2: 'greta' }, { slot: 2, faction: 'yellow', co: 'fortuna' }] });
  const g2 = G.Game.load(g.serialize());
  assert.strictEqual(g2.coOf(2), G.COS.tilda); assert.ok(g2.coOf(1).fused);
  assert.ok(g2.powerMax(1) > 0 && g2.incomeOf(2) > 2000);
  assert.ok(JSON.stringify(G.COS).indexOf('"fortuna"') < 0, 'nicht in der Prüfsumme');
});
// ---- Statische Balance-Schranke (grobe Plausibilität; die eigentliche Messung macht tools/co-balance.js)
// Wirkung = Änderung des Kampfwerts einer KI-typischen Armee (nach Kosten gewichtet): Angriff, 0,7 × Verteidigung,
// 8 % je Feld Bewegung, 10 % je Feld Reichweite, geheilte KP, Schaden an allen Gegnern, Sofort-Geld; eine Wetter-Kraft,
// gegen deren Wetter die eigenen Truppen gefeit sind, zählt pauschal +10 % (Gegner langsamer). Bezug: 20 Gebäude
// (≈ 20 000 G am Tag wie in den KI-Partien auf 30×30-Karten) und eine Armee im Wert von 132 000 G.
const BAL_MAP = { id: 'bal', name: 'Balance', players: 2, rows: [
  'Q1' + 'C1'.repeat(18) + 'K1', 'P.'.repeat(20), 'P.'.repeat(20), 'P.'.repeat(20), 'P.'.repeat(20), 'Q2' + 'P.'.repeat(19)] };
const BAL_ARMY = ['inf', 'inf', 'inf', 'inf', 'mech', 'mech', 'mech', 'mech', 'aa', 'aa', 'gunship', 'gunship', 'mdtank', 'fighter', 'missile', 'tank', 'bcopter', 'arty'];
function balGame(id) {
  const g = G.Game.create({ map: BAL_MAP, players: [{ slot: 1, faction: 'red', co: id }, { slot: 2, faction: 'blue', co: 'rika' }], funds: 0, seed: 1, meta: { weatherMode: 'klar' } });
  g.units = [];
  const own = BAL_ARMY.map((t, i) => g.spawn(t, i % 16, 1 + Math.floor(i / 16), 1, 70));
  const foe = BAL_ARMY.map((t, i) => g.spawn(t, i % 16, 3 + Math.floor(i / 16), 2, 100));
  return { g, own, foe, val: own.reduce((a, u) => a + G.UNITS[u.type].cost, 0) };
}
/** Kampfwert-Bonus des Tagesgeschäfts (ohne Kraft) in Anteilen, bei klarem Wetter */
function dayEffect(id) {
  const { g, own, val } = balGame(id), co = G.COS[id];
  let w = co.income ? co.income(0) - 1 : 0;
  own.forEach(u => {
    const c = G.UNITS[u.type].cost / val;
    w += c * (((co.atk ? co.atk(u.type, null, 0, g) : 0) + 0.7 * (co.def ? co.def(u.type, null, 0, g) : 0)) / 100 +
      0.08 * (g.moveOf(u) - G.UNITS[u.type].move) + 0.1 * (g.rangeOf(u)[1] - G.UNITS[u.type].range[1]) + (1 / (co.cost ? co.cost(u.type) : 1) - 1));
  });
  return w;
}
function powerEffect(id, lvl) {
  const { g, own, foe, val } = balGame(id), co = G.COS[id];
  const snap = () => {
    const p = g.powerOf(1);
    return { w: g.weather, funds: g.playerBySlot(1).funds, foe: foe.map(u => u.hp),
      own: own.map(u => ({ hp: u.hp, atk: co.atk ? co.atk(u.type, null, p, g) : 0, def: co.def ? co.def(u.type, null, p, g) : 0, mv: g.moveOf(u), rg: g.rangeOf(u)[1] })) };
  };
  const a = snap();
  g.playerBySlot(1).power = g.powerMax(1);
  assert.ok(g.activatePower(1, lvl), id + ': Kraft ' + lvl);
  const b = snap();
  let w = (b.funds - a.funds) / val;
  own.forEach((u, i) => {
    const x = a.own[i], y = b.own[i];
    w += G.UNITS[u.type].cost / val * ((y.atk - x.atk) / 100 + 0.7 * (y.def - x.def) / 100 + 0.08 * (y.mv - x.mv) + 0.1 * (y.rg - x.rg) + (y.hp - x.hp) / 100);
  });
  foe.forEach((u, i) => { w += G.UNITS[u.type].cost / val * (a.foe[i] - b.foe[i]) / 100; });
  if (b.w !== a.w && co.weatherImmune && co.weatherImmune(b.w, lvl)) w += 0.1;
  return w;
}
test('Statische Balance-Schranke: Sterne passen grob zur Wirkung, Tagesboni begrenzt', () => {
  const per = [];
  G.CO_ORDER.forEach(id => {
    const co = G.COS[id];
    assert.ok(co.power.stars >= 2 && co.superPower.stars > co.power.stars && co.superPower.stars <= 10, id + ': Sterne ' + co.power.stars + '/' + co.superPower.stars);
    const w1 = powerEffect(id, 1), w2 = powerEffect(id, 2);
    assert.ok(w1 > 0 && w2 > w1, id + ': Superkraft wirkt stärker als Kraft (' + w1.toFixed(3) + ' / ' + w2.toFixed(3) + ')');
    per.push([id + ' Kraft', w1 / co.power.stars], [id + ' Superkraft', w2 / co.superPower.stars]);
    const d = dayEffect(id);
    assert.ok(d >= -0.1 && d <= 0.2, id + ': Tagesbonus ' + (100 * d).toFixed(1) + ' % außerhalb −10…+20 %');
  });
  const v = per.map(p => p[1]).sort((x, y) => x - y), med = (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
  per.forEach(([name, r]) => assert.ok(r >= med / 4 && r <= med * 4,
    name + ': ' + (100 * r).toFixed(1) + ' % je Stern, erlaubt ' + (25 * med).toFixed(1) + '–' + (400 * med).toFixed(1) + ' %'));
  // Gegenprobe: ein grob überteuerter bzw. zu billiger Kraft-Entwurf fiele durch
  assert.ok(0.5 / 1 > med * 4 && 0.01 / 9 < med / 4);
});
console.log(`\n${passed} Tests bestanden`);
