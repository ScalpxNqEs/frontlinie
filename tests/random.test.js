// Zufall: Zufallskarten (Karteneditor) und Zufalls-Kommandanten. node tests/random.test.js
const assert = require('assert');
const G = require('../tools/load')(['mapgen.js', 'room.js']);

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.log('FAIL  ' + name + '\n      ' + e.stack.split('\n').slice(0, 3).join('\n      ')); process.exitCode = 1; }
}
const MG = G.MapGen;

test('Zufallskarten: jede Landform und Größe ist fair, spielbar und gültig', () => {
  [2, 4].forEach(players => {
    Object.keys(MG.random.FORMS).filter(k => MG.random.FORMS[k].p.indexOf(players) >= 0).forEach(form => {
      ['klein', 'mittel', 'gross'].forEach(size => {
        for (let seed = 1; seed <= 3; seed++) {
          const m = MG.random({ players, size, form, seed: seed * 1009 });
          const tag = players + '/' + form + '/' + size + '/' + seed;
          const f = MG.fairness(m);
          assert.ok(f.kit.every(k => k === f.kit[0]), tag + ': gleiche Ausstattung ' + f.kit.join(' | '));
          assert.ok(Math.max(...f.near) - Math.min(...f.near) <= 2, tag + ': HQ-Wege ' + f.near.join('/'));
          assert.ok(Math.min(...f.near) >= 18 && Math.max(...f.near) < 1e6, tag + ': HQ erreichbar, nicht zu nah (' + f.near.join('/') + ')');
          const p = G.parseMap(m);
          assert.strictEqual(m.players, players);
          let hq = 0; for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) if (p.terrain[y][x] === 'Q') hq++;
          assert.strictEqual(hq, players, tag + ': je Spieler ein HQ');
          // Spielbar: ein Spiel lässt sich damit starten
          const g = G.Game.create({ map: m, players: Array.from({ length: players }, (_, i) => ({ slot: i + 1, faction: G.FACTION_ORDER[i], co: 'rika' })), seed: 1 });
          assert.ok(g.currentPlayer().funds > 0, tag + ': Starteinkommen');
        }
      });
    });
  });
});
test('Zufallskarten: gleicher Startwert → gleiche Karte, anderer → andere', () => {
  const a = MG.random({ players: 2, size: 'klein', seed: 42 }), b = MG.random({ players: 2, size: 'klein', seed: 42 });
  const c = MG.random({ players: 2, size: 'klein', seed: 43 });
  assert.deepStrictEqual(a.rows, b.rows);
  assert.notDeepStrictEqual(a.rows, c.rows);
  assert.ok(/^Zufallskarte:/.test(a.desc) && a.name.length > 3);
});
test('Zufalls-Kommandant: wird aufgelöst, möglichst ohne Doppelungen', () => {
  for (let i = 0; i < 200; i++) {
    const pl = [{ co: 'random' }, { co: 'rika', co2: 'nora' }, { co: 'random', co2: 'tilda' }, { co: 'random' }];
    G.resolveRandomCOs(pl);
    pl.forEach(p => assert.ok(G.COS[p.co], 'aufgelöst: ' + p.co));
    const all = pl.map(p => p.co).concat(['nora', 'tilda']);
    assert.strictEqual(new Set(all).size, all.length, 'keine Doppelung: ' + all.join(','));
    assert.notStrictEqual(pl[2].co, pl[2].co2);
  }
  const seen = new Set();
  for (let i = 0; i < 300; i++) seen.add(G.resolveRandomCOs([{ co: 'random' }])[0].co);
  assert.strictEqual(seen.size, G.CO_ORDER.length, 'alle Kommandanten kommen vor');
  assert.ok(G.isCoChoice('random') && G.isCoChoice('rika') && !G.isCoChoice('fortuna_x'));
});
console.log(passed + ' Zufalls-Tests bestanden');
