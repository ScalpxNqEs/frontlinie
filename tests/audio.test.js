// Audio-Tests ohne Browser: node tests/audio.test.js
// Lädt js/audio.js ohne window/AudioContext, ruft die API auf und prüft die Struktur aller Musikstücke.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

globalThis.G = {};
const file = path.join(__dirname, '..', 'js', 'audio.js');
vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: file });
const A = globalThis.G.Audio;

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.log('FAIL  ' + name + '\n      ' + e.message); process.exitCode = 1; }
}

const COS = ['rika', 'bastian', 'jara', 'viktor', 'tilda', 'mira', 'frida', 'kurt', 'nora', 'kraehe'];
const TRACKS = ['title', 'menu', 'map_editor', 'power', 'victory', 'defeat', 'briefing'].concat(COS.map(c => 'co_' + c));
const SFX = ['cursor', 'select', 'cancel', 'menu', 'confirm', 'error', 'move_foot', 'move_tread', 'move_tire', 'move_air',
  'move_ship', 'shot_mg', 'shot_cannon', 'shot_artillery', 'shot_rocket', 'shot_aa', 'explosion', 'hit', 'capture_tick',
  'capture_done', 'build', 'supply', 'repair', 'power', 'power_super', 'day', 'victory', 'defeat', 'trap', 'dive',
  'surface', 'load', 'unload', 'coin'];

test('API vorhanden', () => {
  for (const f of ['init', 'sfx', 'music', 'setVolume', 'getVolume', 'toggleMute']) assert.strictEqual(typeof A[f], 'function', f);
  assert.strictEqual(A.muted, false);
});
test('Aufrufe ohne AudioContext werfen nicht', () => {
  assert.strictEqual(A.init(), false);
  SFX.forEach(n => A.sfx(n));
  A.sfx('gibtsnicht'); A.sfx(); A.sfx(null);
  TRACKS.forEach(t => A.music(t));
  A.music('gibtsnicht'); A.music(null); A.music();
  A.setVolume(0.3, 0.9);
  assert.deepStrictEqual(A.getVolume(), { music: 0.3, sfx: 0.9 });
  A.setVolume(5, -1);
  assert.deepStrictEqual(A.getVolume(), { music: 1, sfx: 0 });
  A.setVolume('x', undefined);
  assert.deepStrictEqual(A.getVolume(), { music: 1, sfx: 0 });
  assert.strictEqual(A.toggleMute(), true); assert.strictEqual(A.muted, true);
  assert.strictEqual(A.toggleMute(), false); assert.strictEqual(A.muted, false);
});
test('Gewünschter Track wird vor init gemerkt', () => {
  A.music('menu'); assert.strictEqual(A.current(), 'menu');
  A.music('menu'); assert.strictEqual(A.current(), 'menu');
  A.music(null); assert.strictEqual(A.current(), null);
});
test('Alle Effekte und Tracks vorhanden', () => {
  SFX.forEach(n => assert.ok(A.SFX.includes(n), 'SFX fehlt: ' + n));
  TRACKS.forEach(n => assert.ok(A.TRACKS.includes(n), 'Track fehlt: ' + n));
});
const info = A._check();
info.forEach(r => {
  test('Track ' + r.name + ' (' + r.bars + ' Takte, ' + r.seconds.toFixed(1) + ' s, ' + r.bpm + ' BPM)', () => {
    assert.deepStrictEqual(r.errors, []);
    assert.ok(r.notes > 20, 'zu wenige Noten');
    assert.ok(r.bpm >= 100 && r.bpm <= 160, 'Tempo');
    if (r.loop && r.name !== 'power') assert.ok(r.seconds >= 30 && r.seconds <= 60, 'Looplänge ' + r.seconds);
    if (r.name === 'power') assert.ok(r.loop && r.seconds >= 8 && r.seconds <= 30);
    if (!r.loop) assert.ok(['victory', 'defeat'].includes(r.name) && r.seconds < 20);
  });
});
console.log(passed + ' Tests bestanden' + (process.exitCode ? ' – FEHLER vorhanden' : ''));
