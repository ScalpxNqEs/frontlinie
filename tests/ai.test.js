// KI-Tests: node tests/ai.test.js
const assert = require('assert');
const G = require('../tools/load')();
const TESTMAPS = require('../tools/testmaps');
G.AI.rethrow = true;

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.log('FAIL  ' + name + '\n      ' + e.stack.split('\n').slice(0, 4).join('\n      ')); process.exitCode = 1; }
}
const ALL = (G.MAPS || []).concat(TESTMAPS);
function mapById(id) { return ALL.find(m => m.id === id); }
function newGame(mapId, extra) {
  const def = mapById(mapId);
  const n = G.mapPlayerCount(def);
  const players = [];
  for (let i = 0; i < n; i++) players.push({ slot: i + 1, faction: G.FACTION_ORDER[i], co: G.CO_ORDER[i * 3 % G.CO_ORDER.length], ai: true, aiLevel: 'normal' });
  return G.Game.create(Object.assign({ map: def, players, seed: 5 }, extra || {}));
}
function exec(g, slot, cmd) {
  if (cmd.kind === 'power') return !!g.activatePower(slot, cmd.level);
  if (cmd.kind === 'build') return !!g.build(slot, cmd.type, cmd.x, cmd.y);
  if (cmd.kind === 'unit') return g.commit(cmd.unitId, cmd.path, cmd.action).ok;
  return true;
}
/** Spielt bis Tag `days`; hook(g, slot, cmd) vor jeder Ausführung */
function play(g, days, level, hook) {
  let invalid = 0;
  while (!g.over && g.day <= days) {
    const slot = g.currentPlayer().slot;
    let n = 0;
    for (;;) {
      assert.ok(++n <= 300, 'mehr als 300 Befehle in einem Zug');
      const cmd = G.AI.planNext(g, slot, { level });
      if (cmd.kind === 'end') break;
      if (hook && hook(g, slot, cmd) === false) continue;
      if (!exec(g, slot, cmd)) invalid++;
      if (g.over) break;
    }
    if (!g.over) g.endTurn();
  }
  return invalid;
}

test('Befehle sind gültig (alle Stufen, Landkarte)', () => {
  ['leicht', 'normal', 'schwer'].forEach(lv => {
    const g = newGame('t-land');
    assert.strictEqual(play(g, 12, lv), 0);
  });
});

test('Befehle sind gültig (Inselkarte mit Transportern)', () => {
  const g = newGame('t-insel');
  assert.strictEqual(play(g, 20, 'schwer'), 0);
});

test('Nebel: Angriffe nur auf sichtbare Ziele, nur sichtbare Pfade', () => {
  const g = newGame('t-nebel', { fog: true });
  play(g, 25, 'schwer', (g, slot, cmd) => {
    if (cmd.kind === 'unit' && cmd.action.type === 'attack') {
      const t = g.unitById(cmd.action.targetId);
      assert.ok(t && g.unitVisibleTo(t, slot), 'Ziel unsichtbar');
    }
    if (cmd.kind === 'unit' && cmd.path.length > 1) {
      // Pfad darf nur durch sichtbare Gegner blockiert sein → kein sichtbarer Gegner auf dem Pfad
      cmd.path.slice(1).forEach(p => {
        const o = g.unitAt(p.x, p.y);
        if (o && g.isEnemy(o.p, slot)) assert.ok(!g.unitVisibleTo(o, slot), 'Pfad durch sichtbaren Gegner');
      });
    }
  });
});

test('Nebel: versteckte Einheit ändert die Planung nicht', () => {
  function firstCmds(withHidden) {
    const g = newGame('t-nebel', { fog: true, seed: 9 });
    // ein paar Runden vorspielen, damit Einheiten existieren
    play(g, 4, 'normal');
    while (g.currentPlayer().slot !== 1) g.endTurn();
    if (withHidden) {
      // Gegner tief im Nebel nahe der eigenen Truppen, aber nicht sichtbar
      let placed = false;
      for (let y = 0; y < g.map.h && !placed; y++) for (let x = 0; x < g.map.w && !placed; x++) {
        if (g.unitAt(x, y) || g.tileVisible(1, x, y) || !g.moveCost('tank', x, y)) continue;
        g.spawn('tank', x, y, 2); placed = true;
      }
      assert.ok(placed);
    }
    g._aiState = null; // gleicher Ausgangszustand in beiden Fällen
    const out = [];
    for (let i = 0; i < 6; i++) {
      const cmd = G.AI.planNext(g, 1, { level: 'schwer' });
      out.push(JSON.stringify(cmd));
      if (cmd.kind === 'end') break;
      // Ausführen nur, wenn kein Hinterhalt die Vergleichbarkeit stört
      const r = cmd.kind === 'unit' ? g.commit(cmd.unitId, cmd.path, cmd.action) : { ok: exec(g, 1, cmd), events: [] };
      if (r.events && r.events.some(e => e.type === 'trap')) break;
    }
    return out;
  }
  const a = firstCmds(false), b = firstCmds(true);
  const n = Math.min(a.length, b.length);
  assert.ok(n > 0);
  assert.deepStrictEqual(b.slice(0, n), a.slice(0, n));
});

test('Abgelehnte Befehle: keine Endlosschleife, Zug endet', () => {
  const g = newGame('t-land');
  let k = 0;
  const seen = {};
  play(g, 10, 'schwer', (g, slot, cmd) => {
    k++;
    const key = g.day + ':' + slot + ':' + JSON.stringify(cmd);
    seen[key] = (seen[key] || 0) + 1;
    assert.ok(seen[key] <= 2, 'derselbe Befehl zu oft: ' + key);
    return k % 3 !== 0; // jeden dritten Befehl "ablehnen" (nicht ausführen)
  });
});

test('Laden mitten im Zug (ohne _aiState)', () => {
  const g = newGame('t-land');
  play(g, 5, 'normal');
  const slot = g.currentPlayer().slot;
  const c1 = G.AI.planNext(g, slot, { level: 'normal' });
  exec(g, slot, c1);
  const g2 = G.Game.load(g.serialize());
  assert.ok(!g2._aiState);
  let n = 0;
  for (;;) {
    const cmd = G.AI.planNext(g2, slot, { level: 'normal' });
    if (cmd.kind === 'end') break;
    assert.ok(exec(g2, slot, cmd), 'ungültig nach Laden: ' + JSON.stringify(cmd));
    assert.ok(++n < 300);
  }
});

test('Nicht am Zug / Spiel vorbei → end', () => {
  const g = newGame('t-land');
  assert.strictEqual(G.AI.planNext(g, 2, {}).kind, 'end');
  g.over = true;
  assert.strictEqual(G.AI.planNext(g, 1, {}).kind, 'end');
});

test('Laufzeit: 30x20 mit 40 Einheiten', () => {
  const g = newGame('t-gross');
  let max = 0, tot = 0, calls = 0;
  while (!g.over && g.day <= 8) {
    const slot = g.currentPlayer().slot;
    for (let i = 0; i < 300; i++) {
      const t0 = process.hrtime.bigint();
      const cmd = G.AI.planNext(g, slot, { level: 'schwer' });
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      max = Math.max(max, ms); tot += ms; calls++;
      if (cmd.kind === 'end') break;
      exec(g, slot, cmd);
      if (g.over) break;
    }
    if (!g.over) g.endTurn();
  }
  console.log(`      Ø ${(tot / calls).toFixed(2)} ms, max ${max.toFixed(1)} ms bei ${calls} Aufrufen`);
  assert.ok(max < 300, 'max ' + max);
  assert.ok(tot / calls < 50, 'Ø ' + tot / calls);
});

test('Geld- und Wetter-Kommandanten: KI setzt die Kräfte ein, Wetter wechselt, Befehle gültig', () => {
  [['nora', 'frida'], ['tilda', 'kraehe']].forEach(([a, b]) => {
    const g = G.Game.create({ map: mapById('t-land'), seed: 3, meta: { weatherMode: 'klar' }, players: [
      { slot: 1, faction: 'green', co: a, ai: true, aiLevel: 'schwer' }, { slot: 2, faction: 'blue', co: b, ai: true, aiLevel: 'schwer' }] });
    const used = [];
    let bad = 0;
    const invalid = play(g, 30, 'schwer', (g, slot, cmd) => {
      if (cmd.kind !== 'power') return true;
      const funds = g.playerBySlot(slot).funds;
      if (!g.activatePower(slot, cmd.level)) { bad++; return false; }
      used.push({ co: g.playerBySlot(slot).co, weather: g.weather, paid: g.playerBySlot(slot).funds - funds });
      return false; // schon ausgeführt
    });
    assert.strictEqual(invalid + bad, 0, a + '/' + b + ': ungültige Befehle');
    const own = used.filter(u => u.co === a);
    assert.ok(own.length > 0, a + ' setzt keine Kraft ein');
    if (a === 'nora') assert.ok(own.every(u => u.weather === 'regen'), 'Noras Kraft bringt Regen');
    if (a === 'tilda') assert.ok(own.every(u => u.paid > 0), 'Tildas Kraft zahlt aus');
    used.filter(u => u.co === 'frida').forEach(u => assert.strictEqual(u.weather, 'schnee'));
  });
});

console.log(`\n${passed} KI-Tests bestanden`);
