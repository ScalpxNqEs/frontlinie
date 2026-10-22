#!/usr/bin/env node
// KI gegen KI, headless.  node tools/sim.js [--seeds 3] [--days 60] [--maps a,b] [--test] [--jobs N] [--quiet]
//   Standard: alle Karten aus G.MAPS (falls leer: tools/testmaps.js), 2-Spieler-Karten als schwer gegen leicht
//   (beide Seiten getauscht), Mehrspieler-Karten mit gemischten Stufen. Nebel auf Karten mit fog:true oder 'nebel' im Namen.
//   --test   zusätzlich die eigenen Testkarten (inkl. 30x20-Leistungstest)
//   --jobs N Anzahl paralleler Prozesse (Standard: CPU-Kerne; für genaue Zeitmessung --jobs 1)
//   --pair a,b  Stufen der 2-Spieler-Duelle (Standard schwer,leicht)
//   --campaign  Kampagnenmissionen: Spieler+Verbündete mit Stufe a, Gegner mit Stufe b, Missionsziel aktiv
//   --tune JSON Parameter überschreiben, z. B. '{"schwer":{"threatW":1.2}}'
'use strict';
const path = require('path');
const os = require('os');
const { fork } = require('child_process');

const args = process.argv.slice(2);
function arg(name, def) { const i = args.indexOf('--' + name); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : def; }
const SEEDS = +arg('seeds', 3);
const MAX_DAYS = +arg('days', 60);
const MAX_CMDS = 300;
const PAIR = (arg('pair', null) && arg('pair') !== true) ? arg('pair').split(',') : ['schwer', 'leicht'];

function loadAll() {
  const G = require('./load')();
  const maps = (G.MAPS || []).slice();
  const test = require('./testmaps');
  let list = maps.length ? maps : test.slice();
  if (arg('test', false) && maps.length) list = list.concat(test);
  if (arg('campaign', false)) {
    list = (G.CAMPAIGN || []).map(m => Object.assign({}, m.map, { id: m.id, scenario: m }));
  }
  return { G, list };
}

function matchups(def, G) {
  const n = G.mapPlayerCount(def);
  const out = [];
  for (let s = 1; s <= SEEDS; s++) {
    if (def.scenario) {
      const sc = def.scenario, lv = [];
      lv[sc.player.slot - 1] = PAIR[0];
      (sc.allies || []).forEach(a => { lv[a.slot - 1] = PAIR[0]; });
      (sc.enemies || []).forEach(e => { lv[e.slot - 1] = PAIR[1]; });
      for (let i = 0; i < lv.length; i++) if (!lv[i]) lv[i] = PAIR[1];
      out.push({ seed: s, levels: lv });
    } else if (n === 2) {
      out.push({ seed: s, levels: [PAIR[0], PAIR[1]] });
      out.push({ seed: s, levels: [PAIR[1], PAIR[0]] });
    } else {
      const lv = [];
      for (let i = 0; i < n; i++) lv.push(['schwer', 'leicht', 'normal', 'leicht'][(i + s) % 4]);
      out.push({ seed: s, levels: lv });
    }
  }
  return out;
}

function runGame(G, def, levels, seed) {
  const n = levels.length;
  const players = [];
  for (let i = 0; i < n; i++) {
    players.push({ slot: i + 1, faction: G.FACTION_ORDER[i], co: G.CO_ORDER[(seed * 3 + i * 4) % G.CO_ORDER.length], ai: true, aiLevel: levels[i] });
  }
  let fog = !!def.fog || /nebel/i.test(def.id || '') || /nebel/i.test(def.name || '');
  const opts = { map: def, players, fog, seed: seed * 7919 + 13, funds: def.funds || 0 };
  if (arg('noresign', false)) opts.meta = Object.assign(opts.meta || {}, { aiResign: false });
  const wx = arg('weather', null);
  if (wx && wx !== true) opts.meta = Object.assign(opts.meta || {}, { weatherMode: wx });
  const lim = arg('limit', null);
  if (lim && lim !== true) opts.meta = Object.assign(opts.meta || {}, { dayLimit: lim === "auto" ? "auto" : +lim });
  if (def.scenario) {
    const sc = def.scenario;
    players.length = 0;
    players.push(Object.assign({ team: 1 }, sc.player, { ai: false, aiLevel: levels[sc.player.slot - 1] }));
    (sc.allies || []).forEach(a => players.push(Object.assign({ team: 1 }, a, { ai: true, aiLevel: levels[a.slot - 1] })));
    (sc.enemies || []).forEach(e => players.push(Object.assign({ team: 2 }, e, { ai: true, aiLevel: levels[e.slot - 1] })));
    fog = !!sc.fog;
    Object.assign(opts, { fog, funds: sc.funds || 0, objective: sc.objective });
  }
  const g = G.Game.create(opts);
  const res = { map: def.id, campaign: !!def.scenario, levels, seed, fog, winner: null, winnerLevel: null, days: 0, reason: 'timeout', invalid: 0, soft: 0,
    maxMs: 0, totalMs: 0, calls: 0, built: {}, exception: null, loops: 0, loads: 0, unloads: 0, captures: 0, attacks: 0 };
  const t0 = Date.now();
  try {
    while (!g.over && g.day <= MAX_DAYS) {
      const slot = g.currentPlayer().slot;
      const lvl = levels[slot - 1];
      let cmds = 0;
      for (;;) {
        if (++cmds > MAX_CMDS) { res.loops++; break; }
        const a = process.hrtime.bigint();
        const cmd = G.AI.planNext(g, slot, { level: lvl });
        const ms = Number(process.hrtime.bigint() - a) / 1e6;
        res.calls++; res.totalMs += ms; if (ms > res.maxMs) res.maxMs = ms;
        if (!cmd || cmd.kind === 'end') break;
        let ok = false;
        if (cmd.kind === 'resign') { g.resign(slot); res.resigns = (res.resigns || 0) + 1; ok = true; break; }
        if (cmd.kind === 'power') ok = !!g.activatePower(slot, cmd.level);
        else if (cmd.kind === 'build') {
          ok = !!g.build(slot, cmd.type, cmd.x, cmd.y);
          if (ok) res.built[cmd.type] = (res.built[cmd.type] || 0) + 1;
        } else if (cmd.kind === 'unit') {
          const r = g.commit(cmd.unitId, cmd.path, cmd.action);
          ok = r.ok;
          if (ok) {
            const types = r.events.map(e => e.type);
            const t = cmd.action.type;
            if (t === 'attack' && types.indexOf('attack') < 0 && types.indexOf('trap') < 0) res.soft++;
            if (t === 'unload' && types.indexOf('trap') < 0) {
              const ev = r.events.find(e => e.type === 'unload');
              if (!ev || !ev.units.length) res.soft++; else res.unloads++;
            }
            if (t === 'load') res.loads++;
            if (t === 'capture' && types.indexOf('capture') >= 0) res.captures++;
            if (t === 'attack' && types.indexOf('attack') >= 0) res.attacks++;
          } else if (process.env.SIM_DEBUG) console.error('ungültig', JSON.stringify(cmd), r.error);
        }
        if (!ok) res.invalid++;
        if (g.over) break;
      }
      if (g.over) break;
      if (g.currentPlayer().slot !== slot) continue; // aufgegeben: resign() hat den Zug schon weitergegeben
      g.endTurn();
    }
  } catch (e) {
    res.exception = (e && e.stack || String(e)).split('\n').slice(0, 4).join(' | ');
  }
  res.days = Math.min(g.day, MAX_DAYS);
  if (g.over && g.winner != null) {
    res.winner = g.winner;
    res.winnerTeam = g.winner;
    res.winnerLevel = levels[g.players.find(p => p.team === g.winner).slot - 1];
    const losers = g.players.filter(p => !p.alive);
    res.reason = losers.map(p => p.lostReason).filter(Boolean)[losers.length - 1] || 'ziel';
  } else if (!g.over) {
    // Zeitlimit: nach Wert werten (nur Info)
    let best = null, bv = -1;
    g.players.forEach(p => { if (!p.alive) return; const s = g.scoreFor(p.slot); const v = s.value + s.props * 3000; if (v > bv) { bv = v; best = p; } });
    res.leader = best ? levels[best.slot - 1] : null;
  }
  res.wallMs = Date.now() - t0;
  return res;
}

function fmtBuilt(b) {
  return Object.keys(b).sort((x, y) => b[y] - b[x]).map(k => k + ':' + b[k]).join(' ');
}
function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }
function lpad(s, n) { s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; }

// ---------------------------------------------------------------- Arbeiterprozess
if (process.env.SIM_WORKER) {
  const { G, list } = loadAll();
  G.AI.rethrow = true;
  // Experimente: --tune '{"schwer":{"threatW":0.5}}' überschreibt KI-Parameter
  const tune = arg('tune', null);
  if (tune && tune !== true && G.AI.LEVELS) {
    const t = JSON.parse(tune);
    Object.keys(t).forEach(k => Object.assign(G.AI.LEVELS[k], t[k]));
  }
  process.on('message', job => {
    const def = list.find(m => m.id === job.map);
    const r = runGame(G, def, job.levels, job.seed);
    process.send(r);
  });
  process.send({ ready: true });
  return;
}

// ---------------------------------------------------------------- Hauptprozess
const { G, list } = loadAll();
let maps = list;
const only = arg('maps', null);
if (only && only !== true) { const ids = only.split(','); maps = maps.filter(m => ids.indexOf(m.id) >= 0); }
const jobs = [];
maps.forEach(def => matchups(def, G).forEach(m => jobs.push({ map: def.id, levels: m.levels, seed: m.seed })));
const nJobs = Math.max(1, Math.min(+arg('jobs', os.cpus().length), jobs.length));
const results = [];
let next = 0, running = 0;
const quiet = arg('quiet', false);
console.log(`FRONTLINIE KI-Simulation: ${maps.length} Karten, ${jobs.length} Partien, max ${MAX_DAYS} Tage, ${nJobs} Prozesse\n`);
console.log(pad('Karte', 15) + pad('Stufen', 16) + pad('Seed', 5) + pad('Sieger', 8) + lpad('Tage', 5) + '  ' + pad('Grund', 8) + lpad('ungült', 7) + lpad('max ms', 8) + lpad('Ø ms', 6) + '  gebaut');

function line(r) {
  const lv = r.levels.map(l => l[0].toUpperCase()).join('/');
  const win = r.exception ? 'FEHLER' : r.winnerLevel ? r.winnerLevel : '—' + (r.leader ? '(' + r.leader[0].toUpperCase() + ')' : '');
  return pad(r.map + (r.fog ? '*' : ''), 15) + pad(lv, 16) + pad(r.seed, 5) + pad(win, 8) + lpad(r.days, 5) + '  ' + pad(r.reason, 8) +
    lpad(r.invalid + (r.soft ? '+' + r.soft : '') + (r.loops ? ' L' + r.loops : ''), 7) + lpad(r.maxMs.toFixed(0), 8) + lpad((r.totalMs / Math.max(1, r.calls)).toFixed(1), 6) +
    '  ' + fmtBuilt(r.built) + (r.loads ? `  [lad ${r.loads}/ent ${r.unloads}]` : '') + (r.exception ? '\n    ' + r.exception : '');
}

function startWorker() {
  const w = fork(__filename, args, { env: Object.assign({}, process.env, { SIM_WORKER: '1' }) });
  w.on('message', msg => {
    if (!msg.ready) { results.push(msg); if (!quiet) console.log(line(msg)); running--; }
    if (next < jobs.length) { running++; w.send(jobs[next++]); }
    else { w.kill(); if (running === 0 && results.length === jobs.length) summary(); }
  });
}
for (let i = 0; i < nJobs; i++) startWorker();

function summary() {
  if (summary.done) return; summary.done = true;
  const order = {}; jobs.forEach((j, i) => order[j.map + j.levels.join() + j.seed] = i);
  results.sort((a, b) => order[a.map + a.levels.join() + a.seed] - order[b.map + b.levels.join() + b.seed]);
  if (quiet) results.forEach(r => console.log(line(r)));
  const n = results.length;
  const exc = results.filter(r => r.exception).length;
  const loops = results.reduce((s, r) => s + r.loops, 0);
  const inval = results.reduce((s, r) => s + r.invalid, 0);
  const soft = results.reduce((s, r) => s + r.soft, 0);
  const decided = results.filter(r => r.winner != null).length;
  const maxMs = Math.max.apply(null, results.map(r => r.maxMs));
  const avgMs = results.reduce((s, r) => s + r.totalMs, 0) / Math.max(1, results.reduce((s, r) => s + r.calls, 0));
  const duel = results.filter(r => r.levels.length === 2 && r.levels.indexOf(PAIR[0]) >= 0 && r.levels.indexOf(PAIR[1]) >= 0);
  const sw = duel.filter(r => r.winnerLevel === PAIR[0]).length, lw = duel.filter(r => r.winnerLevel === PAIR[1]).length;
  const avgDays = results.filter(r => r.winner != null).reduce((s, r) => s + r.days, 0) / Math.max(1, decided);
  console.log('\n================ Zusammenfassung ================');
  console.log(`Partien: ${n}   mit Sieger vor Tag ${MAX_DAYS}: ${decided} (${(100 * decided / n).toFixed(0)} %), Ø ${avgDays.toFixed(1)} Tage`);
  console.log(`Exceptions: ${exc}   Endlosschleifen (>${MAX_CMDS} Befehle/Zug): ${loops}   ungültige Befehle: ${inval}   wirkungslose Befehle: ${soft}`);
  console.log(`planNext: max ${maxMs.toFixed(1)} ms, Ø ${avgMs.toFixed(2)} ms`);
  console.log(`${PAIR[0]} gegen ${PAIR[1]} (2-Spieler-Karten, Seiten getauscht): ${PAIR[0]} ${sw} – ${PAIR[1]} ${lw} – offen ${duel.length - sw - lw}`);
  const camp = results.filter(r => r.campaign);
  if (camp.length) console.log(`Kampagne: Spielerseite (${PAIR[0]}) gewinnt ${camp.filter(r => r.winnerTeam === 1).length}, Gegner (${PAIR[1]}) ${camp.filter(r => r.winnerTeam != null && r.winnerTeam !== 1).length}, offen ${camp.filter(r => r.winnerTeam == null).length}`);
  const isl = results.filter(r => /insel/i.test(r.map));
  if (isl.length) {
    const tr = isl.reduce((s, r) => s + (r.built.lander || 0) + (r.built.tcopter || 0), 0);
    const ships = isl.reduce((s, r) => s + ['cruiser', 'sub', 'battleship'].reduce((a, k) => a + (r.built[k] || 0), 0), 0);
    const ld = isl.reduce((s, r) => s + r.loads, 0), ul = isl.reduce((s, r) => s + r.unloads, 0);
    console.log(`Inselkarten (${isl.length} Partien): Transporter gebaut ${tr}, Kriegsschiffe gebaut ${ships}, Einladen ${ld}, Ausladen ${ul}`);
  }
  // pro Karte
  console.log('\nKarte            Partien  Sieger  Ø Tage  ' + pad(PAIR[0] + ':' + PAIR[1], 14) + ' max ms');
  const byMap = {};
  results.forEach(r => (byMap[r.map] = byMap[r.map] || []).push(r));
  Object.keys(byMap).forEach(m => {
    const rs = byMap[m], dec = rs.filter(r => r.winner != null);
    const s = rs.filter(r => r.winnerLevel === PAIR[0]).length, l = rs.filter(r => r.winnerLevel === PAIR[1]).length;
    console.log(pad(m, 17) + lpad(rs.length, 7) + lpad(dec.length, 8) + lpad(dec.length ? (dec.reduce((a, r) => a + r.days, 0) / dec.length).toFixed(1) : '-', 8) +
      lpad(s + ':' + l, 15) + lpad(Math.max.apply(null, rs.map(r => r.maxMs)).toFixed(0), 8));
  });
  process.exitCode = exc || loops ? 1 : 0;
}
