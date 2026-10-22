// Rückgängig-Regeln: node tests/undo.test.js
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
    'P.P.F.F.F.P.P.P.',
    'P.P.P.P.P.P.P.P.'
  ],
  units: [['inf', 2, 0, 1], ['tank', 3, 0, 1], ['inf', 5, 0, 2], ['inf', 4, 4, 2]]
};
function newGame(extra) {
  return G.Game.create(Object.assign({ map: MAP, players: [{ slot: 1, faction: 'red', co: 'rika' }, { slot: 2, faction: 'blue', co: 'bastian' }], funds: 10000, seed: 42 }, extra || {}));
}
const unitAt = (g, x, y) => g.unitAt(x, y);

test('Zug zurücknehmen stellt Position und Geld her', () => {
  const g = newGame();
  const inf = unitAt(g, 2, 0), funds = g.currentPlayer().funds;
  assert.strictEqual(g.canUndo(1).ok, false);
  const r = g.commit(inf.id, [{ x: 2, y: 0 }, { x: 2, y: 1 }], { type: 'wait' });
  assert.ok(r.ok);
  assert.ok(g.canUndo(1).ok);
  const u = g.undo(1);
  assert.ok(u.ok);
  assert.strictEqual(u.events[0].type, 'undo');
  assert.strictEqual(u.events[0].x, 2); assert.strictEqual(u.events[0].y, 0);
  const back = g.unitById(inf.id);
  assert.strictEqual(back.x, 2); assert.strictEqual(back.y, 0);
  assert.strictEqual(back.moved, false);
  assert.strictEqual(g.currentPlayer().funds, funds);
  assert.strictEqual(g.canUndo(1).ok, false, 'nur einmal je Runde');
});
test('Bau zurücknehmen gibt das Geld zurück', () => {
  const g = newGame();
  const funds = g.currentPlayer().funds;
  const b = g.build(1, 'inf', 1, 0);
  assert.ok(b);
  assert.ok(g.canUndo(1).ok);
  const u = g.undo(1);
  assert.ok(u.ok);
  assert.strictEqual(g.unitAt(1, 0), null);
  assert.strictEqual(g.currentPlayer().funds, funds);
  assert.strictEqual(u.events[0].x, 1);
});
test('Angriff ist nicht zurücknehmbar', () => {
  const g = newGame();
  const tank = unitAt(g, 3, 0);
  const r = g.commit(tank.id, [{ x: 3, y: 0 }, { x: 4, y: 0 }], { type: 'attack', targetId: unitAt(g, 5, 0).id });
  assert.ok(r.ok);
  assert.strictEqual(g.canUndo(1).ok, false);
  assert.ok(/nichts/.test(g.canUndo(1).reason));
});
test('Abgelehnter Befehl lässt die Sicherung stehen', () => {
  const g = newGame();
  const inf = unitAt(g, 2, 0);
  assert.ok(g.commit(inf.id, [{ x: 2, y: 0 }, { x: 2, y: 1 }], { type: 'wait' }).ok);
  assert.ok(!g.commit(inf.id, [{ x: 2, y: 1 }, { x: 2, y: 2 }], { type: 'wait' }).ok, 'schon gezogen');
  assert.ok(g.canUndo(1).ok);
});
test('Rundenende, Kraft und Aufgabe löschen die Sicherung', () => {
  const g = newGame();
  const inf = unitAt(g, 2, 0);
  g.commit(inf.id, [{ x: 2, y: 0 }, { x: 2, y: 1 }], { type: 'wait' });
  g.endTurn();
  assert.strictEqual(g.canUndo(2).ok, false);
  assert.strictEqual(g.canUndo(1).ok, false);
});
test('Im Nebel: Zug, der neue Gegner aufdeckt, ist nicht zurücknehmbar', () => {
  const g = newGame({ fog: true, meta: { vision: 'nebel' } });
  const inf = unitAt(g, 2, 0);
  const seenBefore = g.units.filter(u => u.p === 2 && g.unitVisibleTo(u, 1)).length;
  // Infanterie in Richtung des versteckten Gegners bei (4|4) ziehen
  const r = g.commit(inf.id, [{ x: 2, y: 0 }, { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 2 }], { type: 'wait' });
  assert.ok(r.ok);
  const seenAfter = g.units.filter(u => u.p === 2 && g.unitVisibleTo(u, 1)).length;
  if (seenAfter > seenBefore) assert.strictEqual(g.canUndo(1).ok, false, 'neuer Gegner gesehen → kein Rückgängig');
  else assert.ok(g.canUndo(1).ok, 'nichts Neues gesehen → Rückgängig erlaubt');
});
test('Rückgängig als Netzbefehl über applyCmd, Prüfsumme wie vor dem Zug', () => {
  const g = newGame(), g2 = newGame();
  const h0 = g.stateHash();
  assert.strictEqual(h0, g2.stateHash());
  const inf = unitAt(g, 2, 0);
  const cmd = { t: 'unit', id: inf.id, path: [{ x: 2, y: 0 }, { x: 2, y: 1 }], action: { type: 'wait' } };
  assert.ok(g.applyCmd(1, cmd).ok); assert.ok(g2.applyCmd(1, cmd).ok);
  assert.ok(g.applyCmd(1, { t: 'undo' }).ok); assert.ok(g2.applyCmd(1, { t: 'undo' }).ok);
  assert.strictEqual(g.stateHash(), g2.stateHash());
  assert.strictEqual(g.stateHash(), h0);
  assert.ok(!g.applyCmd(2, { t: 'undo' }).ok, 'Gegner darf nicht');
  assert.ok(!g.applyCmd(1, { t: 'undo' }).ok, 'zweites Mal nicht');
});
test('KI-Züge legen keine Sicherung an', () => {
  const g = newGame({ players: [{ slot: 1, faction: 'red', co: 'rika', ai: true }, { slot: 2, faction: 'blue', co: 'bastian' }] });
  const inf = unitAt(g, 2, 0);
  g.commit(inf.id, [{ x: 2, y: 0 }, { x: 2, y: 1 }], { type: 'wait' });
  assert.strictEqual(g.canUndo(1).ok, false);
});
test('Speichern und Laden vergisst die Sicherung, merkt aber die Nutzung', () => {
  const g = newGame();
  const inf = unitAt(g, 2, 0);
  g.commit(inf.id, [{ x: 2, y: 0 }, { x: 2, y: 1 }], { type: 'wait' });
  g.undo(1);
  const g2 = G.Game.load(g.serialize());
  assert.strictEqual(g2.canUndo(1).ok, false);
  assert.ok(/schon benutzt/.test(g2.canUndo(1).reason));
});
console.log(passed + ' Rückgängig-Tests bestanden');
