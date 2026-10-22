// Netzwerk-Test: Server starten, Raum eröffnen, beitreten, ganze Partien über den Server spielen.
// Jeder simulierte Browser führt eine eigene Kopie der Partie und prüft nach jedem Befehl die Prüfsumme.
'use strict';
const { fork } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const G = require('../tools/load')();

const PORT = 18900 + Math.floor(Math.random() * 90);
const BASE = 'http://127.0.0.1:' + PORT + '/';
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); } }

async function api(p, body) {
  const r = await fetch(BASE + p, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  return r.json();
}
/** Minimaler SSE-Client mit Nachrichtenwarteschlange */
function stream(code, token, lastId) {
  const ctrl = new AbortController();
  const queue = [], waiters = [];
  const st = { queue, close: () => ctrl.abort(), next };
  function push(ev) { if (waiters.length) waiters.shift()(ev); else queue.push(ev); }
  function next(filter, ms) {
    return new Promise((resolve, reject) => {
      const i = queue.findIndex(e => !filter || filter(e));
      if (i >= 0) { resolve(queue.splice(i, 1)[0]); return; }
      const t = setTimeout(() => reject(new Error('Zeitüberschreitung beim Warten auf Ereignis')), ms || 8000);
      const w = ev => {
        if (!filter || filter(ev)) { clearTimeout(t); resolve(ev); } else { queue.push(ev); waiters.push(w); }
      };
      waiters.push(w);
    });
  }
  (async () => {
    const headers = lastId ? { 'Last-Event-ID': lastId } : {};
    const r = await fetch(BASE + 'api/rooms/' + code + '/stream?token=' + token, { signal: ctrl.signal, headers });
    const dec = new TextDecoder();
    let buf = '';
    for await (const chunk of r.body) {
      buf += dec.decode(chunk, { stream: true });
      let k;
      while ((k = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, k); buf = buf.slice(k + 2);
        let event = 'message', data = '', id = null;
        block.split('\n').forEach(l => {
          if (l.startsWith('event: ')) event = l.slice(7);
          else if (l.startsWith('data: ')) data += l.slice(6);
          else if (l.startsWith('id: ')) id = l.slice(4);
        });
        if (data) push({ event, data: JSON.parse(data), id });
      }
    }
  })().catch(() => {});
  return st;
}

function smallMap() {
  // 14×10, zwei HQs, Fabriken, Städte
  const rows = [];
  for (let y = 0; y < 10; y++) {
    let r = '';
    for (let x = 0; x < 14; x++) {
      let t = 'P.';
      if (x === 1 && y === 1) t = 'Q1'; else if (x === 12 && y === 8) t = 'Q2';
      else if (x === 2 && y === 2) t = 'K1'; else if (x === 11 && y === 7) t = 'K2';
      else if ((x === 6 || x === 7) && (y === 2 || y === 7)) t = 'C.';
      else if (y === 5 && x > 2 && x < 11) t = 'R.';
      else if ((x + y * 3) % 11 === 0) t = 'F.';
      r += t;
    }
    rows.push(r);
  }
  return { id: 'nettest', name: 'Netz-Test', players: 2, rows, units: [['inf', 3, 2, 1], ['inf', 10, 7, 2], ['tank', 2, 3, 1], ['tank', 11, 6, 2]] };
}

/** Simulierter Browser: hält eigene Partie-Kopie, spielt eigene Züge per KI-Planer, wendet fremde Befehle an */
function makeClient(name, code, token, slot) {
  return { name, code, token, slot, game: null, gameNo: 0, applied: 0, s: null, mismatches: 0, cmds: 0 };
}
function aiToCmd(c) {
  if (!c || c.kind === 'end') return { t: 'end' };
  if (c.kind === 'resign') return { t: 'resign' };
  if (c.kind === 'power') return { t: 'power', level: c.level };
  if (c.kind === 'build') return { t: 'build', type: c.type, x: c.x, y: c.y };
  return { t: 'unit', id: c.unitId, path: c.path, action: c.action };
}
async function drain(c, untilMyTurn) {
  // fremde Befehle anwenden, bis der eigene Zug dran ist (oder das Spiel endet)
  while (!c.game.over && (c.game.currentPlayer().slot !== c.slot || c.pendingRemote())) {
    const ev = await c.s.next(e => e.event === 'cmd' || e.event === 'state', 15000);
    if (ev.event === 'state') { c.game = G.Game.load(ev.data.state); c.applied = ev.data.seq; continue; }
    const m = ev.data;
    if (m.seq <= c.applied) continue;
    if (m.cid && m.cid.startsWith(c.name + ':')) { c.applied = m.seq; continue; }
    if (m.seq !== c.applied + 1) throw new Error(c.name + ': Lücke ' + c.applied + ' → ' + m.seq);
    const r = c.game.applyCmd(m.slot, m.cmd);
    if (!r.ok) throw new Error(c.name + ': fremder Befehl abgelehnt ' + JSON.stringify(m.cmd) + ' ' + r.error);
    c.applied = m.seq;
    if (c.game.stateHash() !== m.hash) c.mismatches++;
    if (!untilMyTurn) break;
  }
}
async function playMyTurn(c) {
  let n = 0;
  while (!c.game.over && c.game.currentPlayer().slot === c.slot && n++ < 300) {
    let cmd = aiToCmd(G.AI.planNext(c.game, c.slot, { level: 'normal' }));
    if (n > 250) cmd = { t: 'end' };
    const r = c.game.applyCmd(c.slot, cmd);
    if (!r.ok) { cmd = { t: 'end' }; c.game.applyCmd(c.slot, cmd); }
    const cid = c.name + ':' + (++c.cmds);
    const res = await api('api/rooms/' + c.code + '/cmd', { token: c.token, gameNo: c.gameNo, base: c.applied, cid, cmd });
    if (!res.ok) throw new Error(c.name + ': Server lehnt ab: ' + res.error);
    c.applied = res.seq;
    if (res.hash !== c.game.stateHash()) c.mismatches++;
    if (cmd.t === 'end' || cmd.t === 'resign') break;
  }
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontlinie-net-'));
  const srv = fork(path.join(__dirname, '..', 'server.js'), ['--port', String(PORT), '--host', '127.0.0.1', '--data', dataDir, '--quiet', '--no-tls']);
  await new Promise((res, rej) => { srv.on('message', m => m.ready && res()); setTimeout(() => rej(new Error('Server startet nicht')), 5000); });
  try {
    console.log('Netzwerk: Raum & Lobby');
    const info = await api('api/info');
    ok(info.ok && info.game === 'frontlinie', 'Server antwortet auf /api/info');
    const map = smallMap();
    const setup = {
      map, fog: true, funds: 2000, income: 1000, meta: { vision: 'erkundung', weatherMode: 'klar', powers: true, aiResign: true },
      seats: [{ slot: 1, faction: 'red', co: 'rika', co2: 'mira', team: 1, control: 'host' }, { slot: 2, faction: 'blue', co: 'bastian', team: 2, control: 'net' }]
    };
    const bad = await api('api/rooms', { setup: Object.assign({}, setup, { seats: [setup.seats[1], setup.seats[1]] }), name: 'x' });
    ok(!bad.ok, 'Ungültige Konfiguration wird abgelehnt');
    const badCo2 = await api('api/rooms', { setup: Object.assign({}, setup, { seats: [Object.assign({}, setup.seats[0], { co2: 'nix' }), setup.seats[1]] }), name: 'x' });
    ok(!badCo2.ok, 'Unbekannter Fusionspartner wird abgelehnt');
    const host = await api('api/rooms', { setup, name: 'Daniel' });
    ok(host.ok && /^[A-Z0-9]{5}$/.test(host.code), 'Raum eröffnet (' + host.code + ')');
    const lobby = await api('api/rooms/' + host.code);
    ok(lobby.seats.length === 2 && lobby.seats[1].taken === false, 'Lobby zeigt freien Platz');
    ok(lobby.seats[0].co2 === 'mira' && lobby.seats[1].co2 === null, 'Fusionspartner aus der Konfiguration übernommen');
    const early = await api('api/rooms/' + host.code + '/start', { token: host.token });
    ok(!early.ok, 'Start ohne Mitspieler wird verhindert');
    const guest = await api('api/rooms/' + host.code + '/join', { name: 'Handy' });
    ok(guest.ok && guest.slot === 2, 'Mitspieler tritt bei (Platz 2)');
    const third = await api('api/rooms/' + host.code + '/join', { name: 'Dritter' });
    ok(!third.ok, 'Voller Raum lehnt weitere Spieler ab');
    const again = await api('api/rooms/' + host.code + '/join', { token: guest.token });
    ok(again.ok && again.slot === 2, 'Wiederbeitritt mit Token behält den Platz');
    const seatCo = await api('api/rooms/' + host.code + '/seat', { token: guest.token, co: 'jara' });
    ok(seatCo.ok, 'Mitspieler wählt Kommandant');
    // Fusion über die 'seat'-Aktion
    const seatUrl = 'api/rooms/' + host.code + '/seat';
    const seatCo2 = await api(seatUrl, { token: guest.token, co2: 'frida' });
    let lob = await api('api/rooms/' + host.code);
    ok(seatCo2.ok && lob.seats[1].co2 === 'frida', 'Mitspieler wählt Fusionspartner (co2)');
    await api(seatUrl, { token: guest.token, co2: 'jara' });
    lob = await api('api/rooms/' + host.code);
    ok(lob.seats[1].co2 === 'frida', 'Partner gleich dem Haupt-CO wird ignoriert');
    await api(seatUrl, { token: guest.token, co2: 'nix' });
    lob = await api('api/rooms/' + host.code);
    ok(lob.seats[1].co2 === 'frida', 'Unbekannter Partner wird ignoriert');
    await api(seatUrl, { token: guest.token, co: 'frida' });
    lob = await api('api/rooms/' + host.code);
    ok(lob.seats[1].co === 'frida' && lob.seats[1].co2 === null, 'Haupt-CO gleich dem Partner löst die Fusion auf');
    await api(seatUrl, { token: guest.token, co: 'jara', co2: 'frida' });
    lob = await api('api/rooms/' + host.code);
    ok(lob.seats[1].co === 'jara' && lob.seats[1].co2 === 'frida', 'co und co2 gemeinsam setzen');
    await api(seatUrl, { token: guest.token, co2: '' });
    lob = await api('api/rooms/' + host.code);
    ok(lob.seats[1].co2 === null, 'co2: "" entfernt den Partner');
    await api(seatUrl, { token: guest.token, co2: 'frida' });
    await api(seatUrl, { token: guest.token, co2: null });
    lob = await api('api/rooms/' + host.code);
    ok(lob.seats[1].co2 === null, 'co2: null entfernt den Partner');
    await api(seatUrl, { token: guest.token, co2: 'frida' });
    await api(seatUrl, { token: guest.token, name: 'Handy' });
    lob = await api('api/rooms/' + host.code);
    ok(lob.seats[1].co2 === 'frida', 'Body ohne co2 lässt den Partner unverändert');

    const A = makeClient('A', host.code, host.token, 1), B = makeClient('B', host.code, guest.token, 2);
    A.s = stream(host.code, host.token); B.s = stream(host.code, guest.token);
    await A.s.next(e => e.event === 'hello'); await B.s.next(e => e.event === 'hello');
    const st = await api('api/rooms/' + host.code + '/start', { token: host.token });
    ok(st.ok, 'Gastgeber startet das Spiel');
    for (const c of [A, B]) {
      const ev = await c.s.next(e => e.event === 'start');
      c.game = G.Game.load(ev.data.state); c.gameNo = ev.data.gameNo; c.applied = 0;
      c.pendingRemote = () => c.s.queue.some(e => e.event === 'cmd' && e.data.seq > c.applied && !(e.data.cid || '').startsWith(c.name + ':'));
    }
    ok(A.game.stateHash() === B.game.stateHash(), 'Beide Browser starten mit identischem Zustand');
    ok(A.game.playerBySlot(2).co === 'jara' && A.game.playerBySlot(2).name === 'Handy', 'Gewählter Kommandant und Name übernommen');
    ok(A.game.playerBySlot(2).co2 === 'frida' && A.game.coOf(2).fused && A.game.coOf(2).name === 'Jara & Frida', 'Fusion des Mitspielers im gestarteten Spiel');
    ok(A.game.playerBySlot(1).co2 === 'mira' && B.game.coOf(1) === G.fuseCOs('rika', 'mira'), 'Fusion des Gastgebers im gestarteten Spiel');

    const wrong = await api('api/rooms/' + host.code + '/cmd', { token: guest.token, gameNo: 1, base: 0, cid: 'x', cmd: { t: 'end' } });
    ok(!wrong.ok, 'Zug außerhalb der Reihe wird abgelehnt');

    console.log('Netzwerk: Partie Mensch gegen Mensch (KI-gesteuerte Browser)');
    let turns = 0;
    while (!A.game.over && turns < 24) {
      const cur = A.game.currentPlayer().slot === 1 ? A : B;
      const other = cur === A ? B : A;
      await drain(cur, true);
      if (cur.game.over) break;
      await playMyTurn(cur);
      await drain(other, true);
      turns++;
    }
    ok(A.mismatches === 0 && B.mismatches === 0, 'Keine Abweichung der Prüfsummen (' + A.applied + ' Befehle, ' + turns + ' Züge)');
    ok(A.game.stateHash() === B.game.stateHash(), 'Beide Browser haben am Ende denselben Zustand');
    const srvState = await api('api/rooms/' + host.code + '/state?token=' + host.token);
    ok(srvState.ok && srvState.hash === A.game.stateHash(), 'Server-Zustand stimmt mit den Browsern überein');

    console.log('Netzwerk: Wiederverbindung');
    B.s.close();
    // A spielt weiter, B verpasst Befehle
    if (!A.game.over) { await drain(A, true); if (!A.game.over && A.game.currentPlayer().slot === 1) await playMyTurn(A); }
    const lastId = A.gameNo + ':' + B.applied;
    const B2 = stream(host.code, guest.token, lastId);
    B.s = B2;
    await B2.next(e => e.event === 'hello');
    await new Promise(r => setTimeout(r, 300));
    const missed = B2.queue.filter(e => e.event === 'cmd').length;
    const gotState = B2.queue.some(e => e.event === 'state');
    ok(!gotState && (missed > 0 || A.game.over), 'Nach Unterbrechung kommen nur die verpassten Befehle (' + missed + ')');
    await drain(B, true).catch(() => {});
    if (A.game.over || B.game.currentPlayer().slot === 2) ok(B.game.stateHash() === A.game.stateHash(), 'Nach Wiederverbindung wieder synchron');
    const B3 = stream(host.code, guest.token);
    await B3.next(e => e.event === 'hello');
    const full = await B3.next(e => e.event === 'state');
    ok(full.data.hash === G.Game.load(full.data.state).stateHash(), 'Neuer Seitenaufruf bekommt vollständigen Zustand');
    B3.close();
    A.s.close(); B.s.close();

    console.log('Netzwerk: Gemischtes Spiel mit Server-KI (3 Spieler)');
    const map3 = G.MAPS.find(m => m.players === 3) || G.MAPS[0];
    const setup3 = {
      map: map3, fog: true, funds: 0, income: 1000, meta: { vision: 'erkundung', weatherMode: 'auto', powers: true, aiResign: true },
      seats: [{ slot: 1, faction: G.FACTION_ORDER[0], co: G.FACTIONS[G.FACTION_ORDER[0]].co, team: 1, control: 'host' },
        { slot: 2, faction: G.FACTION_ORDER[1], co: G.FACTIONS[G.FACTION_ORDER[1]].co, team: 2, control: 'ai:normal' },
        { slot: 3, faction: G.FACTION_ORDER[2], co: G.FACTIONS[G.FACTION_ORDER[2]].co, team: 3, control: 'net' }].slice(0, map3.players)
    };
    const h3 = await api('api/rooms', { setup: setup3, name: 'Host' });
    const g3 = await api('api/rooms/' + h3.code + '/join', { name: 'Gast' });
    ok(h3.ok && g3.ok && g3.slot === 3, 'Raum mit KI-Platz: Gast bekommt Platz 3');
    // Gastgeber gibt dem KI-Platz einen Fusionspartner
    const aiCo2 = await api('api/rooms/' + h3.code + '/seat', { token: h3.token, slot: 2, co2: 'kraehe' });
    const lob3 = await api('api/rooms/' + h3.code);
    ok(aiCo2.ok && lob3.seats[1].co2 === 'kraehe', 'Gastgeber setzt Fusionspartner für den KI-Platz');
    const C = makeClient('C', h3.code, h3.token, 1), D = makeClient('D', h3.code, g3.token, 3);
    C.s = stream(h3.code, h3.token); D.s = stream(h3.code, g3.token);
    await C.s.next(e => e.event === 'hello'); await D.s.next(e => e.event === 'hello');
    await api('api/rooms/' + h3.code + '/start', { token: h3.token });
    for (const c of [C, D]) {
      const ev = await c.s.next(e => e.event === 'start');
      c.game = G.Game.load(ev.data.state); c.gameNo = ev.data.gameNo;
      c.pendingRemote = () => c.s.queue.some(e => e.event === 'cmd' && e.data.seq > c.applied && !(e.data.cid || '').startsWith(c.name + ':'));
    }
    ok(C.game.playerBySlot(2).co2 === 'kraehe' && C.game.coOf(2).fused, 'Server-KI spielt mit fusioniertem Kommandanten');
    const t0 = Date.now();
    for (let round = 0; round < 3; round++) {
      await drain(C, true); await playMyTurn(C);
      await drain(D, true); await playMyTurn(D);
    }
    await drain(C, true);
    const aiCmds = C.applied - C.cmds - D.cmds;
    ok(aiCmds > 5, 'Server-KI hat gespielt (' + aiCmds + ' KI-Befehle in ' + (Date.now() - t0) + ' ms)');
    ok(C.mismatches === 0 && D.mismatches === 0, 'Drei Spieler bleiben synchron');

    console.log('Netzwerk: Abwesenden Spieler durch KI ersetzen');
    // D (Gast) trennt sich, ist am Zug → Gastgeber übergibt an KI
    D.s.close();
    await new Promise(r => setTimeout(r, 200));
    await drain(C, false).catch(() => {});
    while (C.game.currentPlayer().slot !== 3 && !C.game.over) {
      if (C.game.currentPlayer().slot === 1) await playMyTurn(C); else await drain(C, false);
    }
    const take = await api('api/rooms/' + h3.code + '/cmd', { token: h3.token, gameNo: C.gameNo, base: C.applied, cid: 'C:ai', cmd: { t: 'ai', slot: 3 } });
    ok(take.ok, 'Gastgeber übergibt abwesenden Spieler an die KI');
    if (take.ok) { C.game.applyCmd(1, { t: 'ai', slot: 3 }); C.applied = take.seq; }
    await drain(C, true);
    ok(C.game.playerBySlot(3).ai && C.game.currentPlayer().slot === 1, 'KI hat den Zug des Abwesenden gespielt');
    ok(C.mismatches === 0, 'Weiterhin synchron');
    C.s.close();

    console.log('Netzwerk: Speichern & Neustart');
    srv.kill('SIGTERM');
    await new Promise(r => srv.on('exit', r));
    const files = fs.readdirSync(dataDir);
    ok(files.includes(h3.code + '.json'), 'Raum wurde gespeichert');
    const srv2 = fork(path.join(__dirname, '..', 'server.js'), ['--port', String(PORT), '--host', '127.0.0.1', '--data', dataDir, '--quiet', '--no-tls']);
    await new Promise((res, rej) => { srv2.on('message', m => m.ready && res()); setTimeout(() => rej(new Error('Server startet nicht')), 5000); });
    const after = await api('api/rooms/' + h3.code + '/state?token=' + h3.token);
    ok(after.ok && after.hash === C.game.stateHash(), 'Nach Server-Neustart geht das Spiel genau dort weiter');
    srv2.kill('SIGTERM');
    await new Promise(r => srv2.on('exit', r));
  } finally {
    try { srv.kill(); } catch (e) { /* egal */ }
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  console.log('\n' + pass + ' bestanden, ' + fail + ' fehlgeschlagen');
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
