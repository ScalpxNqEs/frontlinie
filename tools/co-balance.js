#!/usr/bin/env node
// CO-Balance: KI gegen KI auf gleicher Stufe, jedes Kommandanten-Paar in beiden Sitzen, Kräfte an, headless.
//   node tools/co-balance.js [--maps grenzland,langes-tal] [--seeds 3] [--days 60] [--level schwer]
//        [--cos a,b,…] [--focus co] [--weather auto] [--vision offen] [--jobs N] [--json datei] [--compare datei] [--quiet]
//   --cos      nur diese Kommandanten (Standard: G.CO_ORDER)
//   --focus    nur Paarungen mit diesem Kommandanten (schnelle Iteration an einem CO)
//   --weather  Wettermodus wie im Menü (Standard 'auto' = passend zur Karte, wie die Menü-Voreinstellung)
//   --vision   offen | nebel | erkundung (Standard offen)
//   --json     Rohdaten + Auswertung speichern; --compare: frühere JSON-Datei, zeigt Veränderung je CO
//   --patch    JS-Datei, die nach dem Laden G.COS verändert (Werte ausprobieren, ohne js/data.js anzufassen):
//              module.exports = function (G) { G.COS.jara.atk = function (t, tg, p) { return 15; }; };
// Ausgabe: Siegquote je CO (Unentschieden = halber Sieg), Quote als Spieler 1 / 2, Ø Tage, Kreuztabelle.
// Ziel: jede Siegquote 40–60 %. Gleiche Seeds für alle Paarungen (gemeinsame Zufallszahlen), Sitze getauscht.
'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const { fork } = require('child_process');

const args = process.argv.slice(2);
function arg(name, def) { const i = args.indexOf('--' + name); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : def; }
function list(name, def) { const v = arg(name, null); return v && v !== true ? String(v).split(',').filter(Boolean) : def; }
const SEEDS = +arg('seeds', 3);
const MAX_DAYS = +arg('days', 60);
const MAX_CMDS = 300;
const LEVEL = arg('level', 'schwer');
const WEATHER = arg('weather', 'auto');
const VISION = arg('vision', 'offen');
const MAPS = list('maps', ['grenzland', 'langes-tal']);

function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }
function lpad(s, n) { s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; }
function pct(x) { return isFinite(x) ? (100 * x).toFixed(0) + ' %' : '–'; }

// ---------------------------------------------------------------- eine Partie
function runGame(G, job) {
  const def = G.MAPS.find(m => m.id === job.map);
  const players = [
    { slot: 1, faction: 'red', co: job.a, ai: true, aiLevel: LEVEL },
    { slot: 2, faction: 'blue', co: job.b, ai: true, aiLevel: LEVEL }
  ];
  const g = G.Game.create({
    map: def, players, fog: VISION !== 'offen', seed: job.seed * 7919 + 13, funds: def.funds || 0,
    meta: { powers: true, income: 1000, aiResign: true, weatherMode: WEATHER, vision: VISION }
  });
  const res = { map: job.map, a: job.a, b: job.b, seed: job.seed, winner: 0, days: 0, reason: 'timeout',
    powers: [0, 0], supers: [0, 0], income: [0, 0], built: [{}, {}], invalid: 0, exception: null };
  try {
    while (!g.over && g.day <= MAX_DAYS) {
      const slot = g.currentPlayer().slot;
      let cmds = 0;
      for (;;) {
        if (++cmds > MAX_CMDS) break;
        const cmd = G.AI.planNext(g, slot, { level: LEVEL });
        if (!cmd || cmd.kind === 'end') break;
        let ok = false;
        if (cmd.kind === 'resign') { g.resign(slot); break; }
        if (cmd.kind === 'power') {
          ok = !!g.activatePower(slot, cmd.level);
          if (ok) res[cmd.level === 2 ? 'supers' : 'powers'][slot - 1]++;
        } else if (cmd.kind === 'build') {
          ok = !!g.build(slot, cmd.type, cmd.x, cmd.y);
          if (ok) res.built[slot - 1][cmd.type] = (res.built[slot - 1][cmd.type] || 0) + 1;
        }
        else if (cmd.kind === 'unit') ok = g.commit(cmd.unitId, cmd.path, cmd.action).ok;
        if (!ok) res.invalid++;
        if (g.over) break;
      }
      if (g.over) break;
      if (g.currentPlayer().slot !== slot) continue; // aufgegeben: Zug ist schon weitergegeben
      g.endTurn().forEach(ev => { if (ev.type === 'income') res.income[ev.slot - 1] += ev.amount; });
    }
  } catch (e) {
    res.exception = (e && e.stack || String(e)).split('\n').slice(0, 4).join(' | ');
  }
  res.days = Math.min(g.day, MAX_DAYS);
  if (g.over && g.winner != null) {
    const w = g.players.find(p => p.team === g.winner);
    res.winner = w ? w.slot : 0;
    const losers = g.players.filter(p => !p.alive);
    res.reason = losers.map(p => p.lostReason).filter(Boolean)[0] || 'ziel';
  }
  return res;
}

// ---------------------------------------------------------------- Arbeiterprozess
function applyPatch(G) {
  const f = arg('patch', null);
  if (f && f !== true) require(path.resolve(f))(G);
}

if (process.env.CO_BALANCE_WORKER) {
  const G = require('./load')();
  applyPatch(G);
  G.AI.rethrow = true;
  process.on('message', job => process.send(runGame(G, job)));
  process.send({ ready: true });
  return;
}

// ---------------------------------------------------------------- Hauptprozess
const G = require('./load')();
applyPatch(G);
const COS = list('cos', G.CO_ORDER.slice()).filter(id => {
  if (!G.COS[id]) { console.error('Unbekannter Kommandant: ' + id); process.exit(2); }
  return true;
});
const FOCUS = arg('focus', null);
MAPS.forEach(id => { if (!G.MAPS.find(m => m.id === id)) { console.error('Unbekannte Karte: ' + id); process.exit(2); } });

const jobs = [];
MAPS.forEach(map => {
  for (let s = 1; s <= SEEDS; s++) {
    COS.forEach(a => COS.forEach(b => {
      if (a === b) return;
      if (FOCUS && FOCUS !== true && a !== FOCUS && b !== FOCUS) return;
      jobs.push({ map, seed: s, a, b });
    }));
  }
});
const nJobs = Math.max(1, Math.min(+arg('jobs', os.cpus().length), jobs.length));
const quiet = arg('quiet', false);
console.log(`FRONTLINIE CO-Balance: ${COS.length} Kommandanten, Karten ${MAPS.join(', ')}, ${SEEDS} Seeds, ` +
  `Stufe ${LEVEL}, Wetter ${WEATHER}, Sicht ${VISION}, max ${MAX_DAYS} Tage – ${jobs.length} Partien auf ${nJobs} Prozessen\n`);

const results = [];
let next = 0, running = 0;
const t0 = Date.now();
function startWorker() {
  const w = fork(__filename, args, { env: Object.assign({}, process.env, { CO_BALANCE_WORKER: '1' }) });
  w.on('message', msg => {
    if (!msg.ready) {
      results.push(msg); running--;
      if (!quiet) {
        const win = msg.exception ? 'FEHLER' : msg.winner ? (msg.winner === 1 ? msg.a : msg.b) : 'offen';
        console.log(pad(msg.map, 12) + pad(msg.seed, 3) + pad(msg.a + ' – ' + msg.b, 22) + pad(win, 10) + lpad(msg.days, 3) + ' Tage' +
          (msg.exception ? '\n    ' + msg.exception : ''));
      }
    }
    if (next < jobs.length) { running++; w.send(jobs[next++]); }
    else { w.kill(); if (running === 0 && results.length === jobs.length) summary(); }
  });
}
for (let i = 0; i < nJobs; i++) startWorker();

function summary() {
  if (summary.done) return; summary.done = true;
  const stat = {};
  COS.forEach(id => { stat[id] = { n: 0, w: 0, d: 0, l: 0, n1: 0, s1: 0, n2: 0, s2: 0, days: 0, dec: 0, pw: 0, sp: 0, inc: 0, maps: {}, built: {} }; });
  const vs = {}; // vs[a][b] = [Punkte, Partien] aus Sicht von a
  COS.forEach(a => { vs[a] = {}; COS.forEach(b => { vs[a][b] = [0, 0]; }); });
  let exc = 0, p1 = 0, dec = 0, invalid = 0;
  results.forEach(r => {
    if (r.exception) { exc++; return; }
    invalid += r.invalid;
    [[r.a, 1, r.b], [r.b, 2, r.a]].forEach(([id, slot, opp]) => {
      const s = stat[id], pts = r.winner === slot ? 1 : r.winner ? 0 : 0.5;
      s.n++; if (pts === 1) s.w++; else if (pts === 0) s.l++; else s.d++;
      if (slot === 1) { s.n1++; s.s1 += pts; } else { s.n2++; s.s2 += pts; }
      if (r.winner) { s.days += r.days; s.dec++; }
      s.pw += r.powers[slot - 1]; s.sp += r.supers[slot - 1]; s.inc += r.income[slot - 1] / Math.max(1, r.days);
      const m = s.maps[r.map] = s.maps[r.map] || [0, 0]; m[0] += pts; m[1]++;
      const b = r.built[slot - 1]; Object.keys(b).forEach(t => { s.built[t] = (s.built[t] || 0) + b[t]; });
      vs[id][opp][0] += pts; vs[id][opp][1]++;
    });
    if (r.winner) { dec++; if (r.winner === 1) p1++; }
  });
  const ok = results.length - exc;
  const score = id => (stat[id].w + stat[id].d / 2) / Math.max(1, stat[id].n);
  const prev = (() => {
    const f = arg('compare', null);
    if (!f || f === true) return null;
    try { return JSON.parse(fs.readFileSync(f, 'utf8')).scores || null; } catch (e) { console.error('Vergleichsdatei nicht lesbar: ' + f); return null; }
  })();
  const sec = ((Date.now() - t0) / 1000).toFixed(0);
  console.log('\n================ CO-Balance ================');
  console.log(`Partien: ${results.length} (${sec} s)   entschieden: ${dec}   offen (Tag ${MAX_DAYS}): ${ok - dec}   Exceptions: ${exc}   ungültige Befehle: ${invalid}`);
  console.log(`Sitz-Vorteil: Spieler 1 gewinnt ${pct(p1 / Math.max(1, dec))} der entschiedenen Partien\n`);
  const order = COS.slice().sort((x, y) => score(y) - score(x));
  console.log(pad('Kommandant', 12) + lpad('Partien', 8) + lpad('S', 5) + lpad('U', 4) + lpad('N', 5) + lpad('Quote', 7) + (prev ? lpad('vorher', 8) : '') +
    lpad('als P1', 8) + lpad('als P2', 8) + lpad('Ø Tage', 8) + lpad('Kräfte', 8) + lpad('Ø Eink./Tag', 13) + '  ' + MAPS.map(m => pad(m.slice(0, 11), 12)).join('') + ' Bewertung');
  order.forEach(id => {
    const s = stat[id], q = score(id);
    const flag = q > 0.6 ? 'zu stark' : q < 0.4 ? 'zu schwach' : 'ok';
    console.log(pad(id, 12) + lpad(s.n, 8) + lpad(s.w, 5) + lpad(s.d, 4) + lpad(s.l, 5) + lpad(pct(q), 7) +
      (prev ? lpad(prev[id] != null ? pct(prev[id]) : 'neu', 8) : '') +
      lpad(pct(s.s1 / Math.max(1, s.n1)), 8) + lpad(pct(s.s2 / Math.max(1, s.n2)), 8) +
      lpad(s.dec ? (s.days / s.dec).toFixed(1) : '–', 8) + lpad((s.pw / Math.max(1, s.n)).toFixed(1) + '/' + (s.sp / Math.max(1, s.n)).toFixed(1), 8) +
      lpad(Math.round(s.inc / Math.max(1, s.n)), 13) + '  ' +
      MAPS.map(m => pad(s.maps[m] ? pct(s.maps[m][0] / s.maps[m][1]) : '–', 12)).join('') + ' ' + flag);
  });
  // Kreuztabelle: Punkte der Zeile gegen die Spalte (beide Sitze, alle Karten/Seeds)
  console.log('\nKreuztabelle (Quote der Zeile gegen die Spalte):');
  const ab = id => id.slice(0, 6);
  console.log(pad('', 10) + order.map(id => lpad(ab(id), 7)).join(''));
  order.forEach(a => {
    console.log(pad(a, 10) + order.map(b => {
      if (a === b) return lpad('·', 7);
      const v = vs[a][b];
      return lpad(v[1] ? (100 * v[0] / v[1]).toFixed(0) : '–', 7);
    }).join(''));
  });
  // Bauanteile (nach Kosten): zeigt, wohin die KI das Geld eines Kommandanten lenkt
  const share = (b, f) => { let all = 0, part = 0; Object.keys(b).forEach(t => { const v = b[t] * G.UNITS[t].cost; all += v; if (f(t)) part += v; }); return all ? part / all : 0; };
  console.log('\nBauanteile nach Kosten:  ' + ['Fuß', 'direkt', 'indirekt', 'Luft', 'See'].map(x => lpad(x, 9)).join('') + '   Einheiten/Partie');
  order.forEach(id => {
    const b = stat[id].built, n = Object.keys(b).reduce((a, t) => a + b[t], 0);
    console.log(pad(id, 24) + [t => G.unitIsFoot(t), t => G.UNITS[t].domain === 'ground' && !G.unitIsFoot(t) && !G.unitIsIndirect(t),
      t => G.unitIsIndirect(t), t => G.unitIsAir(t), t => G.unitIsSea(t)].map(f => lpad(pct(share(b, f)), 9)).join('') + lpad((n / Math.max(1, stat[id].n)).toFixed(1), 10));
  });
  const scores = {}; COS.forEach(id => { scores[id] = score(id); });
  const spread = Math.max.apply(null, COS.map(score)) - Math.min.apply(null, COS.map(score));
  const outOf = COS.filter(id => score(id) > 0.6 || score(id) < 0.4);
  console.log(`\nSpanne der Quoten: ${pct(spread)}   außerhalb 40–60 %: ${outOf.length ? outOf.join(', ') : 'keiner'}`);
  const jf = arg('json', null);
  if (jf && jf !== true) {
    fs.writeFileSync(jf, JSON.stringify({ when: new Date().toISOString(), maps: MAPS, seeds: SEEDS, level: LEVEL, weather: WEATHER, vision: VISION,
      cos: COS, scores, stat, vs, results }, null, 1));
    console.log('gespeichert: ' + jf);
  }
  process.exitCode = exc ? 1 : 0;
}
