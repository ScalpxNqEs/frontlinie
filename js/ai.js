// FRONTLINIE – Gegner-KI (DOM-frei, in Node testbar)
// Schnittstelle: G.AI.planNext(game, slot, {level}) -> ein Befehl pro Aufruf.
//   {kind:'power', level} | {kind:'unit', unitId, path, action} | {kind:'build', type, x, y} | {kind:'end'}
// Die KI sieht im Nebel nur, was game.unitVisibleTo(u, slot) liefert, und nutzt reachable() ohne omniscient.
// Zwischenstände liegen in game._aiState (wird nicht gespeichert, darf jederzeit fehlen).
var G = (typeof globalThis !== 'undefined' ? globalThis : window).G = (globalThis.G || {});

(function () {
  'use strict';

  var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  var INF = 1000000000;
  var END = { kind: 'end' };

  // ------------------------------------------------------------------ Schwierigkeitsgrade
  var LEVELS = {
    leicht: { id: 'leicht', topK: 4, threatW: 0.12, killW: 0.4, attackMin: -1000, counterW: 0, buyNoise: 0.8,
      retreat: false, hqGuard: false, focus: 0, moveTop: 4, smartPower: false, infBias: 1.6, capW: 0.8, combo: false, coBuy: false, support: false },
    normal: { id: 'normal', topK: 1, threatW: 0.75, killW: 1.0, attackMin: -150, counterW: 0.5, buyNoise: 0.15,
      retreat: true, hqGuard: true, focus: 0.1, moveTop: 1, smartPower: true, infBias: 1, capW: 1, combo: false, coBuy: false, support: true },
    schwer: { id: 'schwer', topK: 1, threatW: 1.5, killW: 1.3, attackMin: -100, counterW: 0.9, buyNoise: 0,
      retreat: true, hqGuard: true, focus: 0.25, moveTop: 1, smartPower: true, infBias: 1, capW: 1.1, combo: true, coBuy: true, support: true }
  };

  // Wert eines Gebäudes für Einnahme (in "Geld"-Einheiten, vergleichbar mit Einheitenwerten)
  var PROP_WORTH = { C: 4000, K: 7000, A: 5000, O: 4500, Q: 9000 };
  // Grundneigung beim Kauf (Wert je Geld, ohne Lage)
  var PRIOR = { inf: 0.55, mech: 0.5, recon: 0.3, apc: 0, tank: 0.95, mdtank: 0.95, titan: 0.7, arty: 0.45,
    rocket: 0.55, aa: 0.3, missile: 0, tcopter: 0, bcopter: 0.65, fighter: 0, bomber: 0.65, lander: 0,
    cruiser: 0.15, sub: 0.25, battleship: 0.5,
    // Erweiterung (Spezialisten mit eigenen Aktionen kauft die KI nicht)
    moto: 0.45, flame: 0.6, pionier: 0, bergepanzer: 0, drone: 0.05, gunship: 0.65, airlift: 0, pboat: 0.35, carrier: 0,
    bunker: 0, turret: 0, flak: 0, coast: 0 };

  function ucost(type) { return G.UNITS[type].cost; }
  function isIndirectT(type) { return G.UNITS[type].range[0] > 1; }
  function hasWeapon(type) { var D = G.DAMAGE[type]; return !!(D && (D.primary || D.secondary)); }
  function isCarrierT(type) { return !!G.UNITS[type].carries && !hasWeapon(type); }
  function isAirT(type) { var c = G.UNITS[type].cls; return c === 'copter' || c === 'plane'; }
  function manh(ax, ay, bx, by) { return Math.abs(ax - bx) + Math.abs(ay - by); }
  function baseDmg(a, d) {
    var D = G.DAMAGE[a]; if (!D) return 0;
    var p = D.primary && D.primary[d] != null ? D.primary[d] : 0;
    var s = D.secondary && D.secondary[d] != null ? D.secondary[d] : 0;
    return Math.max(p, s);
  }

  // ------------------------------------------------------------------ Zustand
  function getState(g) {
    var st = g._aiState;
    if (!st || st.map !== g.map || st.w !== g.map.w || st.h !== g.map.h) {
      st = g._aiState = { map: g.map, w: g.map.w, h: g.map.h, fields: {}, nFields: 0, slots: {}, costs: {},
        stand: {}, rs: (((g.rng && g.rng.s) | 0) ^ 0x2545F491) | 0, props: null };
    }
    return st;
  }
  function slotState(st, g, slot) {
    var ss = st.slots[slot];
    if (!ss) ss = st.slots[slot] = { seen: {}, retreat: {}, waits: {}, cargoGoal: {}, invalid: 0 };
    var key = g.day + ':' + g.turnIdx;
    if (ss.turnKey !== key) {
      ss.turnKey = key; ss.rej = {}; ss.badBuild = {}; ss.noPower = false; ss.last = null;
      ss.calls = 0; ss.acted = 0; ss.claims = {}; ss.pickup = {}; ss.attacked = {}; ss.mf = {};
      // Wurden eigene Einheiten seit dem letzten Zug beschädigt? -> es wird gekämpft
      var hpNow = 0;
      g.units.forEach(function (u) { if (u.p === slot) hpNow += u.hp; });
      if (ss.hpEnd != null && hpNow < ss.hpEnd - 5) st.lastFight = Math.max(st.lastFight || 0, g.day);
    }
    return ss;
  }
  function rand(st) { // mulberry32, eigener Strom (verändert game.rng nicht)
    var t = (st.rs = (st.rs + 0x6D2B79F5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function costTable(st, g, mt) {
    var key = mt + '|' + (g.weather || 'klar');
    var t = st.costs[key];
    if (t) return t;
    t = new Uint8Array(st.w * st.h);
    for (var y = 0; y < st.h; y++) for (var x = 0; x < st.w; x++) {
      t[y * st.w + x] = g.moveCostMt ? g.moveCostMt(mt, x, y) : (G.TERRAIN[g.map.terrain[y][x]].move[mt] || 0);
    }
    st.costs[key] = t;
    return t;
  }
  function allProps(st, g) {
    if (st.props) return st.props;
    var out = [];
    for (var y = 0; y < st.h; y++) for (var x = 0; x < st.w; x++) {
      if (G.TERRAIN[g.map.terrain[y][x]].prop) out.push({ x: x, y: y, idx: y * st.w + x });
    }
    st.props = out;
    return out;
  }

  // ------------------------------------------------------------------ Distanzfelder (Dijkstra mit Binärheap)
  function dijkstra(st, g, mt, sources, reverse) {
    var w = st.w, h = st.h, N = w * h, cst = costTable(st, g, mt);
    var dist = new Int32Array(N); dist.fill(INF);
    var hk = [], hv = [];
    function push(d, i) {
      var k = hk.length; hk.push(d); hv.push(i);
      while (k > 0) { var p = (k - 1) >> 1; if (hk[p] <= d) break; hk[k] = hk[p]; hv[k] = hv[p]; k = p; }
      hk[k] = d; hv[k] = i;
    }
    function pop() {
      var top = hv[0], ld = hk.pop(), lv = hv.pop(), n = hk.length;
      if (n) {
        var k = 0;
        for (;;) {
          var l = 2 * k + 1; if (l >= n) break;
          var r = l + 1, m = (r < n && hk[r] < hk[l]) ? r : l;
          if (hk[m] >= ld) break;
          hk[k] = hk[m]; hv[k] = hv[m]; k = m;
        }
        hk[k] = ld; hv[k] = lv;
      }
      return top;
    }
    for (var s = 0; s < sources.length; s++) { dist[sources[s]] = 0; push(0, sources[s]); }
    while (hk.length) {
      var d0 = hk[0], cur = pop();
      if (d0 > dist[cur]) continue;
      var cx = cur % w, cy = (cur - cx) / w;
      for (var k = 0; k < 4; k++) {
        var nx = cx + DIRS[k][0], ny = cy + DIRS[k][1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        var ni = ny * w + nx, c;
        if (!reverse) { c = cst[ni]; if (!c) continue; }
        else { if (!cst[ni]) continue; c = cst[cur] || 1; }
        var nd = d0 + c;
        if (nd < dist[ni]) { dist[ni] = nd; push(nd, ni); }
      }
    }
    return dist;
  }
  /** reverse=true: Kosten von jedem Feld zu idx; sonst Kosten von idx zu jedem Feld. Gelände ist statisch → dauerhaft gecacht. */
  function field(ctx, mt, idx, reverse) {
    var st = ctx.st, key = (reverse ? 'r' : 'f') + mt + ':' + idx + ':' + (ctx.g.weather || 'klar');
    var f = st.fields[key];
    if (f) return f;
    if (st.nFields > 1200) { st.fields = {}; st.nFields = 0; }
    f = dijkstra(st, ctx.g, mt, [idx], reverse);
    st.fields[key] = f; st.nFields++;
    return f;
  }
  /** Mehrquellen-Rückwärtsfeld, pro Zug gecacht */
  function multiField(ctx, mt, idxs, key) {
    var k = mt + ':' + key + ':' + (ctx.g.weather || 'klar'), f = ctx.ss.mf[k];
    if (f) return f;
    f = dijkstra(ctx.st, ctx.g, mt, idxs, true);
    ctx.ss.mf[k] = f;
    return f;
  }

  // ------------------------------------------------------------------ Kontext eines Aufrufs
  function makeCtx(g, slot, opts, st, ss) {
    var pl = g.playerBySlot(slot);
    var lvName = (opts && opts.level) || (pl && pl.aiLevel) || 'normal';
    var lv = LEVELS[lvName] || LEVELS.normal;
    var w = g.map.w, h = g.map.h, N = w * h;
    var ctx = { g: g, slot: slot, pl: pl, lv: lv, st: st, ss: ss, w: w, h: h, N: N, reachC: {}, tm: null };
    var occ = new Array(N), enemies = [], mine = [];
    var myValue = 0;
    for (var i = 0; i < g.units.length; i++) {
      var u = g.units[i];
      if (g.isEnemy(u.p, slot)) {
        if (!g.unitVisibleTo(u, slot)) continue; // Nebel / getauchte U-Boote
        enemies.push(u);
      } else if (u.p === slot) {
        mine.push(u);
        myValue += ucost(u.type) * u.hp / 100;
        (u.cargo || []).forEach(function (c) { myValue += ucost(c.type) * c.hp / 100; });
      }
      occ[u.y * w + u.x] = u;
    }
    ctx.occ = occ; ctx.enemies = enemies; ctx.mine = mine;
    ctx.ready = mine.filter(function (u) { return !u.moved && !(ss.rej[u.id] >= 2); });
    // Gegner-Gedächtnis (für Nebel und Kaufentscheidungen)
    enemies.forEach(function (e) { ss.seen[e.id] = { type: e.type, hp: e.hp, day: g.day, x: e.x, y: e.y, p: e.p }; });
    var enemyValue = 0;
    Object.keys(ss.seen).forEach(function (id) {
      var s = ss.seen[id];
      if (g.day - s.day > 6) { delete ss.seen[id]; return; }
      enemyValue += ucost(s.type) * s.hp / 100;
    });
    ctx.myValue = myValue; ctx.enemyValue = enemyValue;
    ctx.myHQ = g.hqOf(slot);
    ctx.enemyHQs = [];
    // Schwerpunktgegner (bei mehreren Gegnern): schwach und nah, für einige Tage beibehalten
    var foes = g.players.filter(function (p) { return p.alive && g.isEnemy(p.slot, slot); });
    ctx.primary = null;
    if (foes.length > 1) {
      var keep = ss.primary && foes.some(function (p) { return p.slot === ss.primary; }) && g.day - ss.primaryDay < 6;
      if (!keep) {
        var best = null, bs = INF, me = ctx.myHQ || (mine[0] ? { x: mine[0].x, y: mine[0].y } : { x: 0, y: 0 });
        foes.forEach(function (p) {
          var val = 0, hq = g.hqOf(p.slot);
          Object.keys(ss.seen).forEach(function (id) { var sn = ss.seen[id]; if (sn.p === p.slot) val += ucost(sn.type) * sn.hp / 100; });
          var d = hq ? manh(me.x, me.y, hq.x, hq.y) : 30;
          var sc = (val + 20000) * (d + 10) / (1 + g.propertiesOf(p.slot).length * 0.05);
          if (sc < bs) { bs = sc; best = p.slot; }
        });
        ss.primary = best; ss.primaryDay = g.day;
      }
      ctx.primary = ss.primary;
    }
    foes.forEach(function (p) {
      var hq = g.hqOf(p.slot);
      if (hq) { hq.slot = p.slot; ctx.enemyHQs.push(hq); }
    });
    // Eigene Produktionsfelder (nicht blockieren)
    var bt = new Uint8Array(N);
    allProps(st, g).forEach(function (pr) {
      if (g.map.owner[pr.y][pr.x] === slot && G.TERRAIN[g.map.terrain[pr.y][pr.x]].builds) bt[pr.idx] = 1;
    });
    ctx.buildTile = bt;
    var ef = new Uint8Array(N);
    allProps(st, g).forEach(function (pr) {
      var o = g.map.owner[pr.y][pr.x];
      if (o && g.isEnemy(o, slot) && G.TERRAIN[g.map.terrain[pr.y][pr.x]].builds) ef[pr.idx] = 1;
    });
    ctx.enemyFactory = ef;
    // HQ-Bedrohung
    // Zu bewachendes Feld: eigenes HQ bzw. ein eigenes Missionsziel (Einnahme-Ziel)
    var obj = g.objective || {};
    ctx.objTile = obj.type === 'capture' && g.inBounds(obj.x, obj.y) ? { x: obj.x, y: obj.y } : null;
    ctx.guard = ctx.myHQ;
    if (ctx.objTile && g.map.owner[obj.y][obj.x] === slot) ctx.guard = ctx.objTile;
    ctx.hqThreat = 0;
    if (ctx.guard) {
      enemies.forEach(function (e) {
        var d = manh(e.x, e.y, ctx.guard.x, ctx.guard.y);
        if (G.UNITS[e.type].capture && d <= 4) ctx.hqThreat += (d === 0 ? 3 : 1);
      });
    }
    // Aggressivität: stärkere Seite und späte Tage drücken nach vorn
    var ratio = myValue / Math.max(3000, enemyValue);
    var thW = lv.threatW;
    if (ratio > 1.8) thW *= 0.5; else if (ratio > 1.3) thW *= 0.7; else if (ratio < 0.7) thW *= 1.2;
    thW *= Math.max(lv.lateFloor != null ? lv.lateFloor : 0.4, 1 - Math.max(0, g.day - (lv.lateStart != null ? lv.lateStart : 6)) / (lv.lateSpan || 16));
    // Stillstand: liegt der letzte Kampf zwei oder mehr Tage zurück, obwohl Gegner in Sicht sind -> vorrücken
    var lastFight = st.lastFight || 0, stall = g.day - Math.max(lastFight, 3);
    ctx.stall = 0;
    if (lv.stallMul != null && lv.stallMul >= 1) stall = 0;
    if (stall >= 2 && enemies.length) {
      var near = false;
      for (var a = 0; a < mine.length && !near; a++) for (var b = 0; b < enemies.length; b++) {
        if (manh(mine[a].x, mine[a].y, enemies[b].x, enemies[b].y) <= 12) { near = true; break; }
      }
      if (near) { ctx.stall = Math.min(4, stall - 1); thW *= Math.pow(lv.stallMul != null ? lv.stallMul : 0.6, ctx.stall); }
    }
    if (obj.type === 'survive') {
      var defender = obj.slot || g.humanSlot();
      if (g.isEnemy(defender, slot)) thW *= 0.6; // Angreifer: Zeit drängt
    }
    // Tageslimit naht: wer nach Punkten hinten liegt, geht volles Risiko; wer vorne liegt, sichert ab
    ctx.endgame = 0;
    var lim = g.meta && g.meta.dayLimit;
    if (lim && g.day >= lim - 4 && g.teamScores) {
      var ts = g.teamScores(), mine2 = ts[pl ? pl.team : slot], bestOther = 0;
      Object.keys(ts).forEach(function (k) { if (+k !== (pl ? pl.team : slot)) bestOther = Math.max(bestOther, ts[k].points); });
      if (mine2 && mine2.points < bestOther) { ctx.endgame = 1; thW *= 0.4; }
      else if (mine2) { ctx.endgame = -1; thW *= 1.15; }
    }
    // Mehrere Gegner: sie binden sich gegenseitig, also offensiver spielen
    if (foes.length > 1) thW *= (lv.multiAgg != null ? lv.multiAgg : 0.6);
    ctx.thW = thW;
    ctx.ratio = ratio;
    return ctx;
  }
  function reach(ctx, u) { return ctx.reachC[u.id] || (ctx.reachC[u.id] = ctx.g.reachable(u)); }
  function freeFor(ctx, idx, u) { var o = ctx.occ[idx]; return !o || o === u; }
  function cmdUnit(u, path, action) { return { kind: 'unit', unitId: u.id, path: path, action: action }; }
  function here(u) { return [{ x: u.x, y: u.y }]; }
  function waitCmd(u) { return cmdUnit(u, here(u), { type: 'wait' }); }
  function avgLuck(g, slot) { var l = g.luckOf(slot); return (l[0] + l[1]) / 2; }

  // ------------------------------------------------------------------ Bedrohungskarte
  // Für jedes Feld: Liste sichtbarer Gegner, die es im nächsten Zug angreifen könnten.
  function threatMap(ctx) {
    if (ctx.tm) return ctx.tm;
    var g = ctx.g, st = ctx.st, w = ctx.w, h = ctx.h, N = ctx.N;
    var key = ctx.ss.turnKey + '|' + g.version;
    if (ctx.ss.tmKey === key) { ctx.tm = ctx.ss.tm; return ctx.tm; }
    var lists = new Array(N);
    var block = new Uint8Array(N);
    g.units.forEach(function (u) { if (!g.isEnemy(u.p, ctx.slot)) block[u.y * w + u.x] = 1; });
    var stamp = new Int32Array(N), sid = 0;
    var dist = new Int32Array(N);
    function add(i, e) { if (stamp[i] === sid) return; stamp[i] = sid; (lists[i] || (lists[i] = [])).push(e); }
    ctx.enemies.forEach(function (e) {
      if (!hasWeapon(e.type)) return;
      sid++;
      var R = g.rangeOf(e);
      if (R[0] > 1 || g.moveOf(e) === 0) {
        for (var dy = -R[1]; dy <= R[1]; dy++) for (var dx = -R[1]; dx <= R[1]; dx++) {
          var d = Math.abs(dx) + Math.abs(dy);
          if (d < R[0] || d > R[1]) continue;
          var x = e.x + dx, y = e.y + dy;
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          add(y * w + x, e);
        }
        return;
      }
      var mv = Math.min(g.moveOf(e), e.fuel);
      var cst = costTable(st, g, G.UNITS[e.type].mt);
      var s = e.y * w + e.x, touched = [s], open = [s];
      dist[s] = 0;
      var seen = {}; seen[s] = 1;
      while (open.length) {
        var bi = 0;
        for (var i = 1; i < open.length; i++) if (dist[open[i]] < dist[open[bi]]) bi = i;
        var cur = open[bi]; open[bi] = open[open.length - 1]; open.pop();
        var cx = cur % w, cy = (cur - cx) / w;
        for (var k = 0; k < 4; k++) {
          var nx = cx + DIRS[k][0], ny = cy + DIRS[k][1];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          var ni = ny * w + nx, c = cst[ni];
          if (!c || block[ni]) continue;
          var nd = dist[cur] + c;
          if (nd > mv) continue;
          if (!seen[ni] || nd < dist[ni]) {
            if (!seen[ni]) touched.push(ni);
            seen[ni] = 1; dist[ni] = nd; open.push(ni);
          }
        }
      }
      touched.forEach(function (t) {
        var tx = t % w, ty = (t - tx) / w;
        add(t, e);
        for (var k = 0; k < 4; k++) {
          var nx = tx + DIRS[k][0], ny = ty + DIRS[k][1];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          add(ny * w + nx, e);
        }
      });
    });
    ctx.tm = lists; ctx.ss.tm = lists; ctx.ss.tmKey = key;
    return lists;
  }
  /** Eigene Schlagkraft: Summe der Werte eigener Einheiten, die ein Feld im nächsten Zug angreifen könnten. */
  function supportMap(ctx) {
    if (ctx.sm) return ctx.sm;
    var g = ctx.g, st = ctx.st, w = ctx.w, h = ctx.h, N = ctx.N;
    var key = ctx.ss.turnKey + '|' + g.version;
    if (ctx.ss.smKey === key) { ctx.sm = ctx.ss.sm; return ctx.sm; }
    var val = new Float32Array(N), block = new Uint8Array(N);
    ctx.enemies.forEach(function (e) { block[e.y * w + e.x] = 1; });
    var stamp = new Int32Array(N), sid = 0, dist = new Int32Array(N);
    ctx.mine.forEach(function (u) {
      if (!hasWeapon(u.type)) return;
      sid++;
      var v = ucost(u.type) * u.hp / 100, R = g.rangeOf(u);
      function add(i) { if (stamp[i] === sid) return; stamp[i] = sid; val[i] += v; }
      if (R[0] > 1 || g.moveOf(u) === 0) {
        for (var dy = -R[1]; dy <= R[1]; dy++) for (var dx = -R[1]; dx <= R[1]; dx++) {
          var d = Math.abs(dx) + Math.abs(dy), x = u.x + dx, y = u.y + dy;
          if (d < R[0] || d > R[1] || x < 0 || y < 0 || x >= w || y >= h) continue;
          add(y * w + x);
        }
        return;
      }
      var mv = Math.min(g.moveOf(u), u.fuel), cst = costTable(st, g, G.UNITS[u.type].mt);
      var s0 = u.y * w + u.x, open = [s0], seen = {}, touched = [s0];
      seen[s0] = 1; dist[s0] = 0;
      while (open.length) {
        var bi = 0;
        for (var i = 1; i < open.length; i++) if (dist[open[i]] < dist[open[bi]]) bi = i;
        var cur = open[bi]; open[bi] = open[open.length - 1]; open.pop();
        var cx = cur % w, cy = (cur - cx) / w;
        for (var k = 0; k < 4; k++) {
          var nx = cx + DIRS[k][0], ny = cy + DIRS[k][1];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          var ni = ny * w + nx, c = cst[ni];
          if (!c || block[ni]) continue;
          var nd = dist[cur] + c;
          if (nd > mv) continue;
          if (!seen[ni] || nd < dist[ni]) { if (!seen[ni]) touched.push(ni); seen[ni] = 1; dist[ni] = nd; open.push(ni); }
        }
      }
      touched.forEach(function (t) {
        var tx = t % w, ty = (t - tx) / w;
        add(t);
        for (var k = 0; k < 4; k++) {
          var nx = tx + DIRS[k][0], ny = ty + DIRS[k][1];
          if (nx >= 0 && ny >= 0 && nx < w && ny < h) add(ny * w + nx);
        }
      });
    });
    ctx.sm = val; ctx.ss.sm = val; ctx.ss.smKey = key;
    return val;
  }
  /** Faktor für die Bedrohung auf Feld idx: eigene lokale Überlegenheit senkt sie. */
  function threatFactor(ctx, u, idx) {
    if (!ctx.lv.support) return 1;
    var lst = threatMap(ctx)[idx];
    if (!lst || !lst.length) return 1;
    var theirs = 0;
    for (var i = 0; i < lst.length; i++) theirs += ucost(lst[i].type) * lst[i].hp / 100;
    var ours = supportMap(ctx)[idx];
    // u selbst zählt nicht als Rückendeckung (grob: Anteil abziehen)
    ours = Math.max(0, ours - ucost(u.type) * u.hp / 100 * 0.5);
    var f = theirs / (theirs + ours + 1) * 2;
    return Math.max(0.35, Math.min(1.4, f));
  }
  /** Erwarteter KP-Verlust (intern, 0–hp) für u auf (x,y), wenn die Gegner im nächsten Zug zuschlagen. */
  function threatLoss(ctx, u, x, y, hp, exclude) {
    var lst = threatMap(ctx)[y * ctx.w + x];
    if (!lst || hp <= 0) return 0;
    var g = ctx.g, probe = { type: u.type, p: u.p, hp: hp, x: x, y: y, dived: u.dived, ammo: u.ammo };
    var total = 0, n = 0;
    var ds = [];
    for (var i = 0; i < lst.length; i++) {
      var e = lst[i];
      if (e === exclude || e.hp <= 0) continue;
      var d = g.calcDamage(e, probe, e.hp, x, y, avgLuck(g, e.p));
      if (d > 0) ds.push(d);
    }
    if (!ds.length) return 0;
    ds.sort(function (a, b) { return b - a; });
    // Nicht alle Bedroher kommen tatsächlich zum Zug: abnehmende Gewichte
    var wts = [1, 0.8, 0.6, 0.45, 0.35];
    for (var j = 0; j < ds.length; j++) { total += ds[j] * (wts[j] != null ? wts[j] : 0.3); n++; }
    return Math.min(hp, total);
  }

  // ------------------------------------------------------------------ Bewertung von Zielen
  function capWorth(ctx, x, y) {
    var g = ctx.g, t = g.map.terrain[y][x], o = g.map.owner[y][x];
    var w = PROP_WORTH[t] || 3000;
    if (t === 'Q' && ctx.lv.hqWorth) w = ctx.lv.hqWorth;
    if (t === 'A' || t === 'O') {
      // Häfen/Flughäfen bringen vor allem Einkommen
      w = t === 'A' ? 5000 : 4500;
    }
    if (ctx.objTile && ctx.objTile.x === x && ctx.objTile.y === y) w = 40000;
    if (ctx.endgame === 1) w *= 1.6; // Punkte aufholen: jedes Gebäude zählt
    if (o && g.isEnemy(o, ctx.slot)) {
      w *= (t === 'Q' ? 1.6 * Math.max(1, Math.min(4, ctx.ratio * ctx.ratio)) : 1.4);
      if (ctx.primary && o === ctx.primary) w *= 1.2;
    }
    return w;
  }
  function targetValue(ctx, e) {
    var g = ctx.g, v = ucost(e.type);
    (e.cargo || []).forEach(function (c) { v += ucost(c.type); });
    if (ctx.primary && e.p === ctx.primary) v *= 1.2;
    if (isIndirectT(e.type)) v *= 1.2;
    if (G.UNITS[e.type].capture) {
      var o = g.map.owner[e.y][e.x], t = g.map.terrain[e.y][e.x];
      if (o && !g.isEnemy(o, ctx.slot) && G.TERRAIN[t].prop) {
        var prog = 2 - (e.cp != null ? e.cp : 20) / 20;
        v += (t === 'Q' ? 30000 : (PROP_WORTH[t] || 3000)) * prog;
      }
      if (ctx.objTile && e.x === ctx.objTile.x && e.y === ctx.objTile.y) v += 30000 * (2 - (e.cp != null ? e.cp : 20) / 20);
      if (ctx.guard) {
        var d = manh(e.x, e.y, ctx.guard.x, ctx.guard.y);
        if (d <= 3) v += 6000 / (1 + d);
      }
    }
    return v;
  }

  function evalAttack(ctx, u, tx, ty, e, moved) {
    var g = ctx.g, lu = g.luckOf(u.p);
    var dAvg = Math.min(e.hp, g.calcDamage(u, e, u.hp, e.x, e.y, (lu[0] + lu[1]) / 2));
    if (dAvg <= 0) return null;
    var dMin = Math.min(e.hp, g.calcDamage(u, e, u.hp, e.x, e.y, lu[0]));
    var dMax = Math.min(e.hp, g.calcDamage(u, e, u.hp, e.x, e.y, lu[1]));
    var killP = dMin >= e.hp ? 1 : (dMax < e.hp ? 0 : (dMax - e.hp + 1) / (dMax - dMin + 1));
    var vE = targetValue(ctx, e), costU = ucost(u.type), lv = ctx.lv;
    var gain = vE * dAvg / 100;
    gain += killP * (vE * (e.hp - dAvg) / 100 * 0.5 + ucost(e.type) * 0.3 * lv.killW);
    if (lv.focus && e.hp < 100) gain *= 1 + lv.focus * (1 - e.hp / 100);
    // Fokusfeuer: Ziel ist mit den verfügbaren Angreifern in diesem Zug zu vernichten
    if (killP < 1 && ctx.combo && ctx.combo[e.id]) gain += ucost(e.type) * 0.35 * lv.killW * (1 - killP);
    var counter = 0;
    if (killP < 1 && g.canCounter(u, e, tx, ty)) {
      var probe = { type: u.type, p: u.p, hp: u.hp, x: tx, y: ty, dived: u.dived, ammo: u.ammo };
      counter = Math.min(u.hp, g.calcDamage(e, probe, Math.max(1, e.hp - dAvg), tx, ty, avgLuck(g, e.p))) * (1 - killP);
    }
    var loss = counter / 100 * costU;
    var hpAfter = u.hp - counter;
    var thr = 0;
    if (moved || !isIndirectT(u.type)) {
      thr = threatLoss(ctx, u, tx, ty, hpAfter, killP > 0.5 ? e : null) / 100 * costU * ctx.thW * 0.6;
      if (thr) thr *= threatFactor(ctx, u, ty * ctx.w + tx);
      if (!moved) thr *= 0.5; // stand dort ohnehin
    }
    var score = gain - loss - thr + g.terrainStars(u, tx, ty) * costU * 0.01;
    if (isIndirectT(u.type)) score += 200;
    return score;
  }

  function evalCapture(ctx, u, x, y, inPlace) {
    var g = ctx.g, worth = capWorth(ctx, x, y);
    var t = g.map.terrain[y][x], owner = g.map.owner[y][x];
    var cp = inPlace ? u.cp : G.RULES.capturePoints;
    var co = g.coOf(u.p), fac = co && co.capture ? co.capture(g.powerOf(u.p)) : 1;
    var step = Math.floor(Math.ceil(u.hp / 10) * fac);
    var left = cp - step;
    var score;
    var wins = (t === 'Q' && owner) || (ctx.objTile && ctx.objTile.x === x && ctx.objTile.y === y);
    if (left <= 0) score = worth * 1.6 + (wins ? 1e7 : 0);
    else score = worth * (0.3 + 0.9 * (1 - left / 20));
    if (inPlace && cp < G.RULES.capturePoints) score += worth * 0.4;
    var tl = left > 0 ? threatLoss(ctx, u, x, y, u.hp, null) : 0;
    if (tl) score -= tl / 100 * (ucost(u.type) + worth * 0.6) * ctx.thW * threatFactor(ctx, u, y * ctx.w + x);
    score += g.terrainStars(u, x, y) * 30;
    return score * ctx.lv.capW;
  }

  // ------------------------------------------------------------------ Kandidaten: Angriffe & Einnahmen
  function attackCands(ctx, u, out) {
    var g = ctx.g, R = g.rangeOf(u), w = ctx.w;
    if (R[1] === 0) return;
    if (R[0] > 1 || g.moveOf(u) === 0) {
      ctx.enemies.forEach(function (e) {
        var d = manh(e.x, e.y, u.x, u.y);
        if (d < R[0] || d > R[1] || !g.weaponFor(u, e)) return;
        var s = evalAttack(ctx, u, u.x, u.y, e, false);
        if (s == null) return;
        out.push({ kind: 'atk', score: s, unit: u, target: e, cmd: cmdUnit(u, here(u), { type: 'attack', targetId: e.id }) });
      });
      return;
    }
    var mv = g.moveOf(u), rc = null;
    ctx.enemies.forEach(function (e) {
      if (manh(e.x, e.y, u.x, u.y) > mv + 1 || !g.weaponFor(u, e)) return;
      rc = rc || reach(ctx, u);
      for (var k = 0; k < 4; k++) {
        var tx = e.x + DIRS[k][0], ty = e.y + DIRS[k][1];
        if (tx < 0 || ty < 0 || tx >= ctx.w || ty >= ctx.h) continue;
        var idx = ty * w + tx, n = rc.nodes[idx];
        if (!n || !n.end || !freeFor(ctx, idx, u)) continue;
        var moved = tx !== u.x || ty !== u.y;
        var s = evalAttack(ctx, u, tx, ty, e, moved);
        if (s == null) continue;
        if (moved && !fuelOk(ctx, u, idx, n.cost)) s -= ucost(u.type) * 0.8;
        out.push({ kind: 'atk', score: s, unit: u, target: e,
          cmd: cmdUnit(u, moved ? g.pathTo(rc, tx, ty) : here(u), { type: 'attack', targetId: e.id }) });
      }
    });
  }
  function captureCands(ctx, u, out) {
    var g = ctx.g, w = ctx.w, rc = reach(ctx, u);
    for (var i = 0; i < rc.list.length; i++) {
      var n = rc.list[i];
      if (!n.end || !G.TERRAIN[g.map.terrain[n.y][n.x]].prop) continue;
      if (!g.isEnemyOrNeutralProp(u.p, n.x, n.y)) continue;
      var idx = n.y * w + n.x;
      if (!freeFor(ctx, idx, u)) continue;
      if (ctx.ss.claims[idx] && ctx.ss.claims[idx] !== u.id) continue;
      var inPlace = n.x === u.x && n.y === u.y;
      var s = evalCapture(ctx, u, n.x, n.y, inPlace);
      out.push({ kind: 'cap', score: s, unit: u, idx: idx,
        cmd: cmdUnit(u, inPlace ? here(u) : g.pathTo(rc, n.x, n.y), { type: 'capture' }) });
    }
  }
  /** Welche Gegner können die bereiten Einheiten gemeinsam in diesem Zug vernichten? (grobe Schätzung) */
  function comboKills(ctx) {
    var g = ctx.g, res = {}, w = ctx.w;
    ctx.enemies.forEach(function (e) {
      var dmgs = [];
      ctx.ready.forEach(function (u) {
        var R = g.rangeOf(u);
        if (!R[1] || !g.weaponFor(u, e)) return;
        var ok;
        if (R[0] > 1 || g.moveOf(u) === 0) { var d = manh(u.x, u.y, e.x, e.y); ok = d >= R[0] && d <= R[1]; }
        else {
          if (manh(u.x, u.y, e.x, e.y) > g.moveOf(u) + 1) return;
          var rc = reach(ctx, u);
          ok = false;
          for (var k = 0; k < 4 && !ok; k++) {
            var tx = e.x + DIRS[k][0], ty = e.y + DIRS[k][1];
            if (tx < 0 || ty < 0 || tx >= w || ty >= ctx.h) continue;
            var n = rc.nodes[ty * w + tx];
            ok = !!(n && n.end && freeFor(ctx, ty * w + tx, u));
          }
        }
        if (ok) dmgs.push(g.calcDamage(u, e, u.hp, e.x, e.y, avgLuck(g, u.p)));
      });
      if (dmgs.length < 2) return;
      dmgs.sort(function (a, b) { return b - a; });
      var sum = 0;
      for (var i = 0; i < Math.min(3, dmgs.length); i++) sum += dmgs[i];
      if (sum >= e.hp * 1.05) res[e.id] = true;
    });
    return res;
  }
  function bestTactical(ctx) {
    var cands = [];
    if (ctx.lv.combo && ctx.enemies.length) ctx.combo = comboKills(ctx);
    ctx.ready.forEach(function (u) {
      if (G.UNITS[u.type].range[1] > 0 && ctx.enemies.length) attackCands(ctx, u, cands);
      if (G.UNITS[u.type].capture) captureCands(ctx, u, cands);
    });
    if (!cands.length) return null;
    var lv = ctx.lv;
    var pool = cands.filter(function (c) { return c.score > (c.kind === 'cap' ? 0 : lv.attackMin); });
    if (!pool.length) return null;
    pool.sort(function (a, b) { return b.score - a.score; });
    var k = Math.min(lv.topK, pool.length), pick = pool[0];
    if (k > 1) pick = pool[Math.floor(rand(ctx.st) * k)];
    if (pick.kind === 'atk') ctx.ss.attacked[pick.target.id] = 1;
    if (pick.kind === 'cap') ctx.ss.claims[pick.idx] = pick.unit.id;
    return pick.cmd;
  }

  // ------------------------------------------------------------------ CO-Kraft
  function choosePower(ctx) {
    var g = ctx.g, slot = ctx.slot, co = g.coOf(slot);
    if (!co) return null;
    var can2 = g.canActivate(slot, 2), can1 = g.canActivate(slot, 1);
    if (!can1 && !can2) return null;
    if (!ctx.lv.smartPower) return { kind: 'power', level: can2 ? 2 : 1 };
    var level = can2 ? 2 : 1;
    if (!can2 && g.powerStars(slot) >= co.superPower.stars - 1.2) return null; // auf Superkraft sparen
    var useful = false;
    if (co.id === 'rika') {
      var dmg = 0;
      ctx.mine.forEach(function (u) { dmg += Math.min(level === 2 ? 50 : 20, 100 - u.hp) * ucost(u.type) / 100; });
      useful = dmg >= (level === 2 ? 9000 : 4000);
    } else if (co.id === 'kraehe' || (level === 2 && (co.id === 'mira' || co.id === 'ole'))) {
      useful = ctx.enemies.length >= 2;
    } else if (co.id === 'viktor') {
      var thr = 0;
      ctx.mine.forEach(function (u) { if (threatMap(ctx)[u.y * ctx.w + u.x]) thr++; });
      useful = thr >= 2 || ctx.enemies.length >= 4;
    } else {
      // Angriffs-/Bewegungskräfte: lohnt sich, wenn mehrere Ziele in Reichweite sind
      var pairs = 0;
      ctx.ready.forEach(function (u) {
        var R = g.rangeOf(u); if (!R[1]) return;
        var reachD = (R[0] > 1 ? 0 : g.moveOf(u) + 1) + R[1] + (R[0] > 1 ? 0 : -1) + level;
        for (var i = 0; i < ctx.enemies.length; i++) {
          var e = ctx.enemies[i];
          if (manh(u.x, u.y, e.x, e.y) <= reachD && g.weaponFor(u, e)) { pairs++; break; }
        }
      });
      useful = pairs >= 3 || (co.id === 'kurt' && ctx.mine.some(function (u) { return u.cp < 20; }));
    }
    if (!useful && can2 && ctx.enemies.length >= 3) useful = true; // volle Leiste nicht verfallen lassen
    return useful ? { kind: 'power', level: level } : null;
  }

  // ------------------------------------------------------------------ Bewegung
  function pickBest(ctx, cands) {
    if (!cands.length) return null;
    cands.sort(function (a, b) { return b.s - a.s; });
    var k = Math.min(ctx.lv.moveTop, cands.length);
    if (k > 1) {
      // nur unter halbwegs guten Optionen würfeln
      var lim = cands[0].s - Math.abs(cands[0].s) * 0.5 - 300;
      var n = 1; while (n < k && cands[n].s >= lim) n++;
      return cands[Math.floor(rand(ctx.st) * n)];
    }
    return cands[0];
  }
  /** Bewegt u Richtung Feld R (Kosten zum Ziel). opts: {gx, gy, threatMul, keepOff, stay} */
  function moveByField(ctx, u, R, opts) {
    opts = opts || {};
    var g = ctx.g, w = ctx.w, rc = reach(ctx, u), costU = ucost(u.type);
    costU += (u.cargo || []).reduce(function (s, c) { return s + ucost(c.type); }, 0);
    var step = costU * 0.035 + 60;
    var thMul = (opts.threatMul != null ? opts.threatMul : 1) * ctx.thW;
    var cands = [];
    for (var i = 0; i < rc.list.length; i++) {
      var n = rc.list[i];
      if (!n.end) continue;
      var idx = n.y * w + n.x;
      if (!freeFor(ctx, idx, u)) continue;
      var d = R ? R[idx] : INF;
      if (d >= INF) d = opts.gx != null ? 300 + manh(n.x, n.y, opts.gx, opts.gy) * 2 : 600;
      if (opts.minDist && d < opts.minDist) d = opts.minDist + (opts.minDist - d) * 1.5;
      var s = -d * step;
      var tl = threatLoss(ctx, u, n.x, n.y, u.hp, null);
      if (tl) s -= tl / 100 * costU * thMul * threatFactor(ctx, u, idx);
      s += g.terrainStars(u, n.x, n.y) * costU * 0.012;
      if (ctx.buildTile[idx] && !opts.allowBuildTile) s -= 2500;
      if (ctx.enemyFactory && ctx.enemyFactory[idx] && G.UNITS[u.type].domain === 'ground' && !isIndirectT(u.type)) s += 1500 + costU * 0.05;
      if (G.UNITS[u.type].fpd && !fuelOk(ctx, u, idx, n.cost)) s -= costU;
      if (opts.bonus) s += opts.bonus(n.x, n.y, idx) || 0;
      cands.push({ n: n, s: s });
    }
    var best = pickBest(ctx, cands);
    if (!best) return waitCmd(u);
    var path = (best.n.x === u.x && best.n.y === u.y) ? here(u) : g.pathTo(rc, best.n.x, best.n.y);
    return cmdUnit(u, path, finalAction(ctx, u, best.n.x, best.n.y));
  }
  function moveToward(ctx, u, gidx, opts) {
    opts = opts || {};
    var gx = gidx % ctx.w, gy = (gidx - gx) / ctx.w;
    opts.gx = gx; opts.gy = gy;
    return moveByField(ctx, u, field(ctx, G.UNITS[u.type].mt, gidx, true), opts);
  }
  /** Abschluss-Aktion nach einer Bewegung ohne Angriff */
  function finalAction(ctx, u, x, y) {
    var g = ctx.g, T = G.UNITS[u.type];
    if (T.canDive) {
      var near = ctx.enemies.some(function (e) { return manh(e.x, e.y, x, y) <= 9; });
      if (!u.dived && u.fuel > 22 && near) return { type: 'dive' };
      if (u.dived && (u.fuel <= 18 || !near)) return { type: 'surface' };
      return { type: 'wait' };
    }
    if (T.supplies) {
      var need = g.supplyTargets(u, x, y).some(function (t) {
        var TT = G.UNITS[t.type];
        return t.fuel < TT.fuel * 0.6 || (TT.ammo > 0 && t.ammo < TT.ammo * 0.5);
      });
      if (need) return { type: 'supply' };
    }
    return { type: 'wait' };
  }

  function repairField(ctx, domain, mt) {
    var g = ctx.g, idxs = [];
    allProps(ctx.st, g).forEach(function (pr) {
      if (g.map.owner[pr.y][pr.x] !== ctx.slot) return;
      if (G.REPAIRS[g.map.terrain[pr.y][pr.x]] !== domain) return;
      var o = ctx.occ[pr.idx];
      if (o && !(o.p === ctx.slot && !o.moved)) return; // besetzt
      idxs.push(pr.idx);
    });
    if (!idxs.length) return null;
    return multiField(ctx, mt, idxs, 'rep' + domain + ':' + idxs.join(','));
  }
  /** Reicht der Treibstoff nach einem Zug nach idx (Kosten moveCost) noch für den Heimweg? (Luft/See) */
  function fuelOk(ctx, u, idx, moveCost) {
    var T = G.UNITS[u.type];
    if (!T.fpd) return true;
    var R = repairField(ctx, T.domain, T.mt);
    if (!R) return true;
    var d = R[idx];
    if (d >= INF) return true;
    var f = u.fuel - moveCost, mv = Math.max(1, ctx.g.moveOf(u));
    var burn = u.dived ? (T.diveFpd || T.fpd) : T.fpd;
    return f >= d + burn * (Math.ceil(d / mv) + 1) + 2;
  }
  /** Liefert ein Rückwärtsfeld zum Reparaturgebäude, falls u zurück muss. */
  function retreatField(ctx, u) {
    var g = ctx.g, T = G.UNITS[u.type], ss = ctx.ss, w = ctx.w;
    var R = null, low = false;
    if (T.fpd > 0 || (T.domain === 'ground' && T.fuel < 99) || T.ammo > 0) R = repairField(ctx, T.domain, T.mt);
    if (T.fpd > 0 && R) {
      var d = R[u.y * w + u.x];
      if (d < INF) {
        var mv = Math.max(1, g.moveOf(u));
        var need = d + T.fpd * (Math.ceil(d / mv) + 1) + 4;
        if (u.fuel < need) low = true;
      }
    }
    if (T.ammo > 0 && u.ammo === 0 && !G.DAMAGE[u.type].secondary) low = true;
    if (T.domain === 'ground' && T.fuel < 99 && u.fuel < Math.max(8, T.fuel * 0.2)) low = true;
    if (ctx.lv.retreat && T.cls !== 'foot' && u.hp <= 30) ss.retreat[u.id] = 1;
    if (ss.retreat[u.id] && u.hp >= 80) delete ss.retreat[u.id];
    if (!low && !ss.retreat[u.id]) return null;
    if (!R) R = repairField(ctx, T.domain, T.mt);
    if (!R || R[u.y * w + u.x] >= INF) { delete ss.retreat[u.id]; return null; }
    if (!low && R[u.y * w + u.x] > g.moveOf(u) * 3) { delete ss.retreat[u.id]; return null; }
    return R;
  }

  /** Bestes Ziel (Feldindex) für eine Kampfeinheit */
  function combatGoal(ctx, u) {
    var g = ctx.g, T = G.UNITS[u.type], w = ctx.w, h = ctx.h;
    var F = field(ctx, T.mt, u.y * w + u.x, false);
    var mv = Math.max(1, g.moveOf(u)), costU = ucost(u.type);
    var best = -1, bestS = -INF, landReach = false;
    function consider(idx, s) { if (s > bestS) { bestS = s; best = idx; } }
    ctx.enemies.forEach(function (e) {
      if (!g.weaponFor(u, e)) return;
      var d = INF;
      for (var k = 0; k < 4; k++) {
        var nx = e.x + DIRS[k][0], ny = e.y + DIRS[k][1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (F[ny * w + nx] < d) d = F[ny * w + nx];
      }
      if (d >= INF) return;
      landReach = true;
      var dmg = g.calcDamage(u, e, u.hp, e.x, e.y, 4);
      var val = Math.min(dmg, e.hp) / 100 * targetValue(ctx, e);
      if (dmg < e.hp && G.UNITS[e.type].range[0] <= 1) {
        var probe = { type: u.type, p: u.p, hp: u.hp, x: u.x, y: u.y, dived: u.dived, ammo: u.ammo };
        var cd = g.weaponFor(e, probe) ? g.calcDamage(e, probe, e.hp - dmg, e.x, e.y, 4) : 0;
        val -= cd / 100 * costU * 0.6;
      }
      if (val <= 0) return;
      consider(e.y * w + e.x, val / (1 + d / mv));
    });
    // Gegnerische Einheiten aus dem Gedächtnis (Nebel)
    if (ctx.g.fogActive ? ctx.g.fogActive() : ctx.g.fog) {
      Object.keys(ctx.ss.seen).forEach(function (id) {
        var s = ctx.ss.seen[id];
        if (s.day === g.day) return;
        if (!g.canAttackType(u.type, s.type)) return;
        var idx = s.y * w + s.x, d = F[idx];
        if (d >= INF) return;
        var val = baseDmg(u.type, s.type) / 100 * ucost(s.type) * 0.4;
        consider(idx, val / (1 + d / mv));
      });
    }
    // HQ verteidigen
    if (ctx.hqThreat && ctx.guard) {
      var hi = ctx.guard.y * w + ctx.guard.x;
      if (F[hi] <= mv * 3) consider(hi, 6000 * ctx.hqThreat / (1 + F[hi] / mv));
    }
    // Vorrücken: gegnerisches HQ und gegnerische Gebäude
    ctx.enemyHQs.forEach(function (hq) {
      var hi = hq.y * w + hq.x;
      var pf = ctx.primary ? (hq.slot === ctx.primary ? 1.8 : 0.3) : 1;
      var push = Math.max(1, Math.min(5, ctx.ratio * ctx.ratio)) * (1 + 0.5 * (ctx.stall || 0));
      if (F[hi] < INF) { landReach = true; consider(hi, pf * costU * 0.25 * push / (1 + F[hi] / mv)); }
    });
    // Gegnerische Fabriken besetzen: blockiert dort die Produktion
    if (T.domain === 'ground') {
      allProps(ctx.st, g).forEach(function (pr) {
        var o = g.map.owner[pr.y][pr.x];
        if (!o || !g.isEnemy(o, ctx.slot) || G.TERRAIN[g.map.terrain[pr.y][pr.x]].builds !== 'ground') return;
        if (ctx.occ[pr.idx] && ctx.occ[pr.idx] !== u) return;
        if (F[pr.idx] >= INF) return;
        var pfac = ctx.primary ? (o === ctx.primary ? 1.4 : 0.5) : 1;
        if (ctx.lv.factoryW === 0) return;
        consider(pr.idx, pfac * costU * (ctx.lv.factoryW != null ? ctx.lv.factoryW : 0.18) * Math.max(1, Math.min(4, ctx.ratio * ctx.ratio)) * (1 + 0.4 * (ctx.stall || 0)) / (1 + F[pr.idx] / mv));
      });
    }
    if (best < 0 || bestS < costU * 0.05) {
      allProps(ctx.st, g).forEach(function (pr) {
        var o = g.map.owner[pr.y][pr.x];
        if (!o || !g.isEnemy(o, ctx.slot)) return;
        if (F[pr.idx] < INF) consider(pr.idx, costU * 0.08 / (1 + F[pr.idx] / mv));
      });
    }
    return { idx: best, landReach: landReach };
  }

  // Indirekte Einheiten: Feuerstellung für den nächsten Zug suchen, ohne selbst in Gefahr zu geraten
  function moveIndirect(ctx, u) {
    var g = ctx.g, R = g.rangeOf(u), w = ctx.w;
    var targets = ctx.enemies.filter(function (e) { return g.weaponFor(u, e); });
    var goal = combatGoal(ctx, u);
    var gidx = goal.idx;
    if (gidx < 0 && ctx.enemyHQs.length) gidx = ctx.enemyHQs[0].y * w + ctx.enemyHQs[0].x;
    var Rf = gidx >= 0 ? field(ctx, G.UNITS[u.type].mt, gidx, true) : null;
    return moveByField(ctx, u, Rf, {
      gx: gidx >= 0 ? gidx % w : undefined, gy: gidx >= 0 ? (gidx - gidx % w) / w : undefined,
      threatMul: 1.4, minDist: R[0] + 1,
      bonus: function (x, y) {
        var best = 0;
        for (var i = 0; i < targets.length; i++) {
          var e = targets[i], d = manh(e.x, e.y, x, y);
          if (d >= R[0] && d <= R[1] + 1) {
            var v = baseDmg(u.type, e.type) / 100 * ucost(e.type) * (d <= R[1] ? 0.6 : 0.3);
            if (v > best) best = v;
          }
        }
        return best;
      }
    });
  }

  // ------------------------------------------------------------------ Einnahme-Zuweisung
  function captureAssign(ctx) {
    if (ctx.capAssign) return ctx.capAssign;
    var g = ctx.g, w = ctx.w, ss = ctx.ss;
    var feet = ctx.ready.filter(function (u) { return G.UNITS[u.type].capture; });
    var targets = [];
    allProps(ctx.st, g).forEach(function (pr) {
      if (!g.isEnemyOrNeutralProp(ctx.slot, pr.x, pr.y)) return;
      var o = ctx.occ[pr.idx];
      if (o && !g.isEnemy(o.p, ctx.slot) && !(o.p === ctx.slot && !o.moved)) return;
      if (ss.claims[pr.idx]) return;
      targets.push({ idx: pr.idx, x: pr.x, y: pr.y, worth: capWorth(ctx, pr.x, pr.y), enemyOn: !!(o && g.isEnemy(o.p, ctx.slot)) });
    });
    var ferryOK = ctx.ferryPossible();
    var pairs = [];
    feet.forEach(function (u) {
      var F = field(ctx, G.UNITS[u.type].mt, u.y * w + u.x, false), mv = Math.max(1, g.moveOf(u));
      targets.forEach(function (t) {
        var d = F[t.idx], ferry = false;
        if (d >= INF) { if (!ferryOK) return; d = manh(u.x, u.y, t.x, t.y) * 1.3 + 10; ferry = true; }
        var turns = d / mv;
        var s = t.worth / Math.pow(1 + turns, 1.15);
        if (ferry) s *= 0.75;
        if (t.enemyOn) s *= 0.6;
        pairs.push({ u: u, t: t, s: s, ferry: ferry });
      });
    });
    pairs.sort(function (a, b) { return b.s - a.s; });
    var res = {}, usedT = {}, usedU = {};
    pairs.forEach(function (p) {
      if (usedU[p.u.id] || usedT[p.t.idx]) return;
      usedU[p.u.id] = 1; usedT[p.t.idx] = 1;
      res[p.u.id] = { idx: p.t.idx, ferry: p.ferry };
    });
    ctx.capAssign = res;
    return res;
  }

  // ------------------------------------------------------------------ Transport
  function carriersOf(ctx) {
    return ctx.mine.filter(function (u) { return isCarrierT(u.type); });
  }
  /** Will Einheit u per Transporter übersetzen? → Zielfeld oder -1 */
  function ferryGoal(ctx, u) {
    ctx.fgC = ctx.fgC || {};
    if (ctx.fgC[u.id] != null) return ctx.fgC[u.id];
    var g = ctx.g, T = G.UNITS[u.type], w = ctx.w, res = -1;
    if (T.domain !== 'ground') { ctx.fgC[u.id] = -1; return -1; }
    if (T.capture) {
      var a = !u.moved ? captureAssign(ctx)[u.id] : null;
      if (a && a.ferry) res = a.idx;
      else if (!a) {
        // keine Einnahme an Land → irgendein Ziel jenseits des Wassers
        res = remoteCaptureTarget(ctx, u, u.x, u.y);
      }
    } else if (T.cls === 'vehicle' && hasWeapon(u.type)) {
      var cg = combatGoal(ctx, u);
      if (!cg.landReach && ctx.enemyHQs.length) {
        res = nearestEnemyLandTarget(ctx, u.x, u.y);
      }
    }
    ctx.fgC[u.id] = res;
    return res;
  }
  function remoteCaptureTarget(ctx, u, x, y) {
    var g = ctx.g, F = field(ctx, G.UNITS[u.type].mt, y * ctx.w + x, false), best = -1, bs = -INF;
    allProps(ctx.st, g).forEach(function (pr) {
      if (!g.isEnemyOrNeutralProp(ctx.slot, pr.x, pr.y)) return;
      if (F[pr.idx] < INF) return; // an Land erreichbar → kein Übersetzen nötig
      var s = capWorth(ctx, pr.x, pr.y) / (1 + manh(x, y, pr.x, pr.y) / 4);
      if (s > bs) { bs = s; best = pr.idx; }
    });
    return best;
  }
  function nearestEnemyLandTarget(ctx, x, y) {
    var g = ctx.g, best = -1, bd = INF, w = ctx.w;
    ctx.enemies.forEach(function (e) {
      if (G.UNITS[e.type].domain !== 'ground') return;
      var d = manh(x, y, e.x, e.y); if (d < bd) { bd = d; best = e.y * w + e.x; }
    });
    ctx.enemyHQs.forEach(function (hq) { var d = manh(x, y, hq.x, hq.y) + 4; if (d < bd) { bd = d; best = hq.y * w + hq.x; } });
    return best;
  }
  function cargoGoal(ctx, T, c) {
    var g = ctx.g, ss = ctx.ss, w = ctx.w;
    var gi = ss.cargoGoal[c.id];
    if (gi != null && gi >= 0) {
      var gx = gi % w, gy = (gi - gx) / w;
      if (G.UNITS[c.type].capture) { if (g.isEnemyOrNeutralProp(ctx.slot, gx, gy)) return gi; }
      else if (ctx.enemyHQs.some(function (hq) { return hq.x === gx && hq.y === gy; }) ||
        ctx.enemies.some(function (e) { return e.x === gx && e.y === gy; })) return gi;
    }
    if (G.UNITS[c.type].capture) {
      gi = -1; var bs = -INF;
      var claimed = {};
      Object.keys(ss.cargoGoal).forEach(function (k) { if (+k !== c.id) claimed[ss.cargoGoal[k]] = 1; });
      allProps(ctx.st, g).forEach(function (pr) {
        if (!g.isEnemyOrNeutralProp(ctx.slot, pr.x, pr.y)) return;
        var s = capWorth(ctx, pr.x, pr.y) / (1 + manh(T.x, T.y, pr.x, pr.y) / 4);
        if (claimed[pr.idx]) s *= 0.4;
        if (s > bs) { bs = s; gi = pr.idx; }
      });
    } else gi = nearestEnemyLandTarget(ctx, T.x, T.y);
    ss.cargoGoal[c.id] = gi;
    return gi;
  }
  function standTiles(ctx, mtA, mtB) {
    var key = mtA + '/' + mtB, st = ctx.st;
    if (st.stand[key]) return st.stand[key];
    var a = costTable(st, ctx.g, mtA), b = costTable(st, ctx.g, mtB), out = [];
    for (var i = 0; i < ctx.N; i++) if (a[i] && b[i]) out.push(i);
    st.stand[key] = out;
    return out;
  }

  /** Einheiten, die übersetzen wollen und einen Transporter mit Platz in Reichweite haben, steigen ein. */
  function loadPhase(ctx) {
    var g = ctx.g, carriers = carriersOf(ctx);
    if (!carriers.length) return null;
    var w = ctx.w, best = null;
    ctx.ready.forEach(function (u) {
      if (isCarrierT(u.type) || G.UNITS[u.type].domain !== 'ground') return;
      if (ferryGoal(ctx, u) < 0) return;
      var rc = null;
      carriers.forEach(function (t) {
        if (!g.canCarry(t, u)) return;
        if (manh(t.x, t.y, u.x, u.y) > g.moveOf(u) + 1) return;
        rc = rc || reach(ctx, u);
        var n = rc.nodes[t.y * w + t.x];
        if (!n || !n.end) return;
        var s = (t.moved ? 0 : 100) - n.cost;
        if (!best || s > best.s) best = { s: s, cmd: cmdUnit(u, g.pathTo(rc, t.x, t.y), { type: 'load' }) };
      });
    });
    return best ? best.cmd : null;
  }

  function transportPhase(ctx) {
    for (var i = 0; i < ctx.ready.length; i++) {
      var T = ctx.ready[i];
      if (!isCarrierT(T.type)) continue;
      return transportMove(ctx, T);
    }
    return null;
  }
  function transportMove(ctx, T) {
    var g = ctx.g, w = ctx.w, TT = G.UNITS[T.type], ss = ctx.ss;
    if (TT.fpd && !fuelOk(ctx, T, T.y * w + T.x, 0)) {
      var RF = repairField(ctx, TT.domain, TT.mt);
      if (RF) return moveByField(ctx, T, RF, { threatMul: 1.5, allowBuildTile: true });
    }
    if (T.cargo && T.cargo.length) {
      var c0 = T.cargo[0], gi = cargoGoal(ctx, T, c0);
      if (gi < 0) return unloadAnywhere(ctx, T) || waitCmd(T);
      // Lander wartet kurz auf einen zweiten Passagier
      if (T.cargo.length < TT.cap && TT.cap > 1) {
        var waiting = ctx.mine.some(function (u) {
          return u !== c0 && !u.moved && G.UNITS[u.type].domain === 'ground' && g.canCarry(T, u) &&
            manh(u.x, u.y, T.x, T.y) <= g.moveOf(u) * 2 && ferryGoal(ctx, u) >= 0;
        });
        var wk = T.id;
        if (waiting && (ss.waits[wk] || 0) < 2 && !threatMap(ctx)[T.y * w + T.x]) {
          ss.waitTurn = ss.waitTurn || {};
          if (ss.waitTurn[wk] !== ss.turnKey) { ss.waits[wk] = (ss.waits[wk] || 0) + 1; ss.waitTurn[wk] = ss.turnKey; }
          return waitCmd(T);
        }
      }
      ss.waits[T.id] = 0;
      var un = tryUnload(ctx, T, gi);
      if (un) return un;
      // Richtung Landeplatz
      var site = landingSite(ctx, T, c0, gi);
      if (site < 0) return unloadAnywhere(ctx, T) || waitCmd(T);
      return moveToward(ctx, T, site, { threatMul: 1.5, allowBuildTile: true });
    }
    // leer und beschädigt: reparieren
    if (T.hp <= 60) {
      var RR = repairField(ctx, TT.domain, TT.mt);
      if (RR && RR[T.y * w + T.x] < INF) return moveByField(ctx, T, RR, { threatMul: 2, allowBuildTile: true });
    }
    // leer: Passagier abholen
    var p = pickPassenger(ctx, T);
    if (p) {
      ss.pickup[p.u.id] = { tid: T.id, idx: p.idx };
      if (T.y * w + T.x === p.idx) return waitCmd(T);
      return moveToward(ctx, T, p.idx, { threatMul: 1.5, allowBuildTile: TT.domain === 'sea' });
    }
    // nichts zu tun: von Bauplätzen weg, Gefahr meiden; Transporter versorgen Truppen
    if (TT.supplies) {
      var thirsty = null, td = INF;
      ctx.mine.forEach(function (u) {
        if (u === T) return;
        var UT = G.UNITS[u.type];
        if (u.fuel < UT.fuel * 0.5 || (UT.ammo > 0 && u.ammo < UT.ammo * 0.4)) {
          var d = manh(u.x, u.y, T.x, T.y); if (d < td) { td = d; thirsty = u; }
        }
      });
      if (thirsty) return moveToward(ctx, T, thirsty.y * w + thirsty.x, { threatMul: 1.5 });
    }
    // Warteposition nahe der eigenen Truppen, abseits der Bauplätze
    var home = ctx.myHQ || { x: T.x, y: T.y };
    return moveByField(ctx, T, null, { threatMul: 2.5, bonus: function (x, y) { return -manh(x, y, home.x, home.y) * 40; } });
  }
  function landingSite(ctx, T, c, gi) {
    var g = ctx.g, w = ctx.w;
    var Rc = field(ctx, G.UNITS[c.type].mt, gi, true);
    var FT = field(ctx, G.UNITS[T.type].mt, T.y * w + T.x, false);
    var tiles = standTiles(ctx, G.UNITS[T.type].mt, G.UNITS[c.type].mt), best = -1, bs = INF;
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      if (Rc[t] >= INF || FT[t] >= INF) continue;
      var o = ctx.occ[t];
      if (o && o !== T && !g.isEnemy(o.p, ctx.slot)) continue;
      var s = Rc[t] * 2 + FT[t] * 0.3;
      if (s < bs) { bs = s; best = t; }
    }
    return best;
  }
  function tryUnload(ctx, T, gi) {
    var g = ctx.g, w = ctx.w, h = ctx.h, rc = reach(ctx, T);
    var cargo = T.cargo, fields = cargo.map(function (c) {
      var gg = cargoGoal(ctx, T, c);
      return gg >= 0 ? field(ctx, G.UNITS[c.type].mt, gg, true) : null;
    });
    var Rc0 = fields[0];
    // bestmöglicher Wert irgendwo (Landeplatz)
    var site = landingSite(ctx, T, cargo[0], gi);
    var siteVal = site >= 0 ? Rc0[site] : INF;
    var best = null;
    for (var i = 0; i < rc.list.length; i++) {
      var n = rc.list[i];
      if (!n.end) continue;
      var idx = n.y * w + n.x;
      if (!freeFor(ctx, idx, T)) continue;
      var used = {}, unloads = [], sum = 0, d0 = INF;
      for (var ci = 0; ci < cargo.length; ci++) {
        var c = cargo[ci], mtc = G.UNITS[c.type].mt;
        if (!g.moveCost(c.type, n.x, n.y)) { unloads = null; break; }
        var bt = -1, bd = INF;
        for (var k = 0; k < 4; k++) {
          var nx = n.x + DIRS[k][0], ny = n.y + DIRS[k][1];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          var ni = ny * w + nx;
          if (used[ni] || !g.moveCost(c.type, nx, ny)) continue;
          if (ctx.occ[ni] && ctx.occ[ni] !== T) continue;
          var dd = fields[ci] ? fields[ci][ni] : 50;
          if (dd < bd) { bd = dd; bt = ni; }
        }
        if (bt < 0 || bd >= INF) continue;
        used[bt] = 1;
        unloads.push({ idx: ci, x: bt % w, y: (bt - bt % w) / w });
        sum += bd;
        if (ci === 0) d0 = bd;
      }
      if (!unloads || !unloads.length || d0 >= INF) continue;
      var close = d0 <= siteVal + 1 || d0 <= g.moveOf(cargo[0]) + 1;
      if (!close) continue;
      var tl = threatLoss(ctx, T, n.x, n.y, T.hp, null);
      var s = -sum * 100 - tl * 30 + unloads.length * 400;
      if (!best || s > best.s) best = { s: s, n: n, unloads: unloads };
    }
    if (!best) return null;
    var path = (best.n.x === T.x && best.n.y === T.y) ? here(T) : g.pathTo(rc, best.n.x, best.n.y);
    return cmdUnit(T, path, { type: 'unload', unloads: best.unloads });
  }
  function unloadAnywhere(ctx, T) {
    // eigene Prüfung statt game.unloadOptions (das kennt auch versteckte Gegner)
    var g = ctx.g, unloads = [], used = {};
    (T.cargo || []).forEach(function (c, idx) {
      if (!g.moveCost(c.type, T.x, T.y)) return;
      for (var k = 0; k < 4; k++) {
        var nx = T.x + DIRS[k][0], ny = T.y + DIRS[k][1];
        if (nx < 0 || ny < 0 || nx >= ctx.w || ny >= ctx.h) continue;
        var ni = ny * ctx.w + nx;
        if (used[ni] || ctx.occ[ni] || !g.moveCost(c.type, nx, ny)) continue;
        used[ni] = 1; unloads.push({ idx: idx, x: nx, y: ny }); break;
      }
    });
    return unloads.length ? cmdUnit(T, here(T), { type: 'unload', unloads: unloads }) : null;
  }
  function pickPassenger(ctx, T) {
    var g = ctx.g, w = ctx.w, ss = ctx.ss, TT = G.UNITS[T.type];
    var FT = field(ctx, TT.mt, T.y * w + T.x, false);
    var best = null;
    ctx.mine.forEach(function (u) {
      if (u === T || isCarrierT(u.type) || !g.canCarry(T, u)) return;
      var pk = ss.pickup[u.id];
      if (pk && pk.tid !== T.id) return;
      if (ferryGoal(ctx, u) < 0) return;
      var mtU = G.UNITS[u.type].mt, FU = field(ctx, mtU, u.y * w + u.x, false);
      var idx = -1, sc = INF;
      if (TT.domain === 'sea') {
        var tiles = standTiles(ctx, TT.mt, mtU);
        for (var i = 0; i < tiles.length; i++) {
          var t = tiles[i];
          if (FU[t] >= INF || FT[t] >= INF) continue;
          var o = ctx.occ[t];
          if (o && o !== T && !g.isEnemy(o.p, ctx.slot)) continue;
          if (ctx.buildTile[t] && t !== T.y * w + T.x) continue;
          var s = FU[t] * 1.2 + FT[t] * 0.5;
          if (s < sc) { sc = s; idx = t; }
        }
      } else {
        // Treffpunkt: Nachbarfeld des Passagiers
        for (var k = 0; k < 4; k++) {
          var nx = u.x + DIRS[k][0], ny = u.y + DIRS[k][1];
          if (nx < 0 || ny < 0 || nx >= w || ny >= ctx.h) continue;
          var ni = ny * w + nx;
          if (!g.moveCost(u.type, nx, ny) || FT[ni] >= INF) continue;
          if (ctx.occ[ni] && ctx.occ[ni] !== T) continue;
          if (FT[ni] < sc) { sc = FT[ni]; idx = ni; }
        }
      }
      if (idx < 0) return;
      if (!best || sc < best.s) best = { u: u, idx: idx, s: sc };
    });
    return best;
  }

  // ------------------------------------------------------------------ Bewegung der übrigen Einheiten
  function hqBlock(ctx) {
    if (!ctx.lv.hqGuard || !ctx.hqThreat || !ctx.guard) return null;
    var g = ctx.g, w = ctx.w, hi = ctx.guard.y * w + ctx.guard.x;
    var o = ctx.occ[hi];
    if (o) return null;
    var best = null;
    ctx.ready.forEach(function (u) {
      if (G.UNITS[u.type].domain !== 'ground' || isCarrierT(u.type)) return;
      if (manh(u.x, u.y, ctx.guard.x, ctx.guard.y) > g.moveOf(u)) return;
      var n = reach(ctx, u).nodes[hi];
      if (!n || !n.end) return;
      var s = -ucost(u.type);
      if (!best || s > best.s) best = { s: s, u: u };
    });
    if (!best) return null;
    return cmdUnit(best.u, g.pathTo(reach(ctx, best.u), ctx.guard.x, ctx.guard.y), { type: 'wait' });
  }

  function movePhase(ctx) {
    var g = ctx.g, w = ctx.w;
    var list = ctx.ready.filter(function (u) { return !isCarrierT(u.type); });
    if (!list.length) return null;
    // Reihenfolge: zuerst Fabrik-Besetzer, dann vordere Einheiten
    var eh = ctx.enemyHQs[0];
    list.sort(function (a, b) {
      var pa = ctx.buildTile[a.y * w + a.x] ? 1 : 0, pb = ctx.buildTile[b.y * w + b.x] ? 1 : 0;
      if (pa !== pb) return pb - pa;
      if (!eh) return a.id - b.id;
      return manh(a.x, a.y, eh.x, eh.y) - manh(b.x, b.y, eh.x, eh.y);
    });
    return chooseMove(ctx, list[0]);
  }
  function chooseMove(ctx, u) {
    var g = ctx.g, T = G.UNITS[u.type], w = ctx.w;
    var R = retreatField(ctx, u);
    if (R) return moveByField(ctx, u, R, { threatMul: 1.3, allowBuildTile: true });
    // Übersetzen?
    var fg = ferryGoal(ctx, u);
    if (fg >= 0 && carriersOf(ctx).length) {
      var pk = ctx.ss.pickup[u.id];
      if (pk) return moveToward(ctx, u, pk.idx, { allowBuildTile: true });
      // zum nächsten Transporter
      var bestT = null, bd = INF, F = field(ctx, T.mt, u.y * w + u.x, false);
      carriersOf(ctx).forEach(function (t) {
        if (!g.canCarry(t, u)) return;
        var d = F[t.y * w + t.x]; if (d < bd) { bd = d; bestT = t; }
      });
      if (bestT) return moveToward(ctx, u, bestT.y * w + bestT.x, { allowBuildTile: true });
    }
    if (T.capture && ctx.ratio >= (ctx.lv.hqPushRatio || 1.4) && ctx.enemyHQs.length) {
      var hqT = ctx.enemyHQs.filter(function (q) { return !ctx.primary || q.slot === ctx.primary; })[0] || ctx.enemyHQs[0];
      var Fh = field(ctx, T.mt, u.y * w + u.x, false), hqi = hqT.y * w + hqT.x;
      var asg = captureAssign(ctx)[u.id];
      var asgD = asg ? Fh[asg.idx] : INF;
      if (Fh[hqi] < INF && (!asg || Fh[hqi] <= asgD + g.moveOf(u) * 2)) {
        ctx.ss.claims[hqi] = u.id;
        return moveToward(ctx, u, hqi, { threatMul: 0.6 });
      }
    }
    if (T.capture) {
      var a = captureAssign(ctx)[u.id];
      if (a && !a.ferry) {
        ctx.ss.claims[a.idx] = u.id;
        return moveToward(ctx, u, a.idx, { threatMul: 0.8 });
      }
      if (fg >= 0) {
        // auf Transporter warten: Richtung Küste/Hafen nahe Heimat
        var emb = embarkTile(ctx, u);
        if (emb >= 0) return moveToward(ctx, u, emb, { allowBuildTile: false });
      }
    }
    if (isIndirectT(u.type) || u.type === 'missile') return moveIndirect(ctx, u);
    var goal = combatGoal(ctx, u);
    if (goal.idx < 0) {
      if (fg >= 0) { var e2 = embarkTile(ctx, u); if (e2 >= 0) return moveToward(ctx, u, e2, {}); }
      return moveByField(ctx, u, null, {});
    }
    return moveToward(ctx, u, goal.idx, {});
  }
  function embarkTile(ctx, u) {
    var g = ctx.g, w = ctx.w, F = field(ctx, G.UNITS[u.type].mt, u.y * w + u.x, false);
    var tiles = standTiles(ctx, 'trans', G.UNITS[u.type].mt), best = -1, bd = INF;
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      if (F[t] >= INF || ctx.buildTile[t]) continue;
      if (F[t] < bd) { bd = F[t]; best = t; }
    }
    return best;
  }

  // ------------------------------------------------------------------ Produktion
  function enemyComposition(ctx) {
    var comp = {}, any = false;
    Object.keys(ctx.ss.seen).forEach(function (id) {
      var s = ctx.ss.seen[id];
      comp[s.type] = (comp[s.type] || 0) + ucost(s.type) * s.hp / 100; any = true;
    });
    if (!any) comp = { inf: 3000, tank: 7000, arty: 6000 };
    return comp;
  }
  function counterScore(type, comp, coastal) {
    var tot = 0, sum = 0, off = 0;
    Object.keys(comp).forEach(function (e) {
      var wv = comp[e];
      var a = Math.min(110, baseDmg(type, e)) / 100;
      if (G.UNITS[type].domain === 'sea' && G.UNITS[e].domain === 'ground') a *= coastal;
      var dd = Math.min(110, baseDmg(e, type)) / 100;
      if (isIndirectT(type)) dd *= 0.5;
      else if (!isIndirectT(e) && baseDmg(type, e) > 0) dd *= 0.75; // wir schlagen zurück
      if (isIndirectT(e) && !isIndirectT(type)) { dd *= 0.8; a *= 1.15; } // Artillerie ist im Nahkampf wehrlos
      var o = a * ucost(e) / ucost(type);
      off += a * wv;
      sum += (Math.min(2, o) - dd) * wv; tot += wv;
    });
    if (off <= 0) return -1;
    return tot ? sum / tot : 0;
  }
  function chooseBuild(ctx) {
    var g = ctx.g, pl = ctx.pl, slot = ctx.slot, w = ctx.w, ss = ctx.ss, lv = ctx.lv;
    if (!pl || pl.funds < 1000) return null;
    var tiles = [];
    allProps(ctx.st, g).forEach(function (pr) {
      if (g.map.owner[pr.y][pr.x] !== slot) return;
      var ter = G.TERRAIN[g.map.terrain[pr.y][pr.x]];
      if (!ter.builds || ctx.occ[pr.idx] || ss.badBuild[pr.x + ',' + pr.y]) return;
      tiles.push({ x: pr.x, y: pr.y, idx: pr.idx, dom: ter.builds });
    });
    if (!tiles.length) return null;
    var info = ctx.buildInfo || (ctx.buildInfo = buildInfo(ctx));
    var comp = enemyComposition(ctx);
    var nGround = tiles.filter(function (t) { return t.dom === 'ground'; }).length;
    var best = null, bestAll = null;
    var income = g.propertiesOf(slot).length * ((g.meta && g.meta.income) || G.RULES.income);
    // Viel Geld pro freiem Bauplatz → teure Einheiten bevorzugen (ungenutztes Geld ist verschenkt)
    var perTile = pl.funds / tiles.length;
    var alpha = Math.max(0.6, Math.min(1.2, 0.45 + perTile / 20000));
    tiles.forEach(function (tile) {
      // Bauliste selbst bestimmen (game.buildOptions prüft auch unsichtbare Belegung)
      var banned = (g.meta && g.meta.banned) || [];
      var opts = G.BUILD_LISTS[tile.dom].filter(function (t) { return banned.indexOf(t) < 0; }).map(function (t) {
        var c = g.costOf(t, slot);
        return { type: t, cost: c, affordable: pl.funds >= c };
      });
      // Reserve für weitere Fabriken (frühe Phase: Infanterie überall)
      var others = tile.dom === 'ground' ? nGround - 1 : nGround;
      var reserve = info.footNeed > 0 && g.day <= 6 ? Math.min(others, info.footNeed) * 1000 : 0;
      opts.forEach(function (o) {
        var s = typeScore(ctx, o.type, comp, info, tile);
        if (s <= 0) return;
        if (lv.buyNoise) s *= 1 + (rand(ctx.st) * 2 - 1) * lv.buyNoise;
        var util = s * Math.pow(o.cost, alpha);
        if (o.cost <= pl.funds + income * 0.8 && (!bestAll || util > bestAll.u)) bestAll = { u: util, s: s, cost: o.cost };
        if (!o.affordable) return;
        if (o.cost > pl.funds - reserve && o.cost > 1000) return;
        if (!best || util > best.u) best = { u: util, s: s, type: o.type, x: tile.x, y: tile.y, foot: G.UNITS[o.type].cls === 'foot' };
      });
    });
    if (!best) return null;
    if (best.type === 'lander' || best.type === 'tcopter' || best.type === 'apc') ss.boughtT = (ss.boughtT || 0) + 1;
    // Kurz sparen nur, wenn das Bessere schon nächste Runde bezahlbar ist und wenig Geld liegt
    if (lv.id !== 'leicht' && bestAll && bestAll.u > best.u * 1.6 && !(best.foot && info.footNeed > 0) &&
        pl.funds < 9000 && ctx.mine.length >= 8 && tiles.length === 1) return null;
    return { kind: 'build', type: best.type, x: best.x, y: best.y };
  }
  function buildInfo(ctx) {
    var g = ctx.g, w = ctx.w, slot = ctx.slot;
    var info = { counts: {}, foot: 0, indirect: 0, direct: 0, carriersSea: 0, carriersAir: 0, groundCombat: 0, footNeed: 0, ferryDemand: 0,
      island: false, coastal: 0.3, enemyAir: 0, enemySea: 0 };
    ctx.mine.forEach(function (u) {
      info.counts[u.type] = (info.counts[u.type] || 0) + 1;
      (u.cargo || []).forEach(function (c) { info.counts[c.type] = (info.counts[c.type] || 0) + 1; if (G.UNITS[c.type].cls === 'foot') info.foot++; });
      var T = G.UNITS[u.type];
      if (T.cls === 'foot') info.foot++;
      if (u.type === 'lander') info.carriersSea++;
      if (u.type === 'tcopter') info.carriersAir++;
      if (T.domain === 'ground' && T.cls === 'vehicle' && hasWeapon(u.type)) info.groundCombat++;
      if (hasWeapon(u.type) && T.cls !== 'foot') { if (isIndirectT(u.type)) info.indirect++; else info.direct++; }
    });
    // Einnahmeziele an Land (von der eigenen HQ/Fabrik aus)
    var origin = ctx.myHQ;
    if (!origin) {
      var f = allProps(ctx.st, g).filter(function (p) { return g.map.owner[p.y][p.x] === slot; })[0];
      origin = f || (ctx.mine[0] ? { x: ctx.mine[0].x, y: ctx.mine[0].y } : null);
    }
    var landTargets = 0, remoteTargets = 0;
    if (origin) {
      var F = field(ctx, 'foot', origin.y * w + origin.x, false);
      allProps(ctx.st, g).forEach(function (pr) {
        if (!g.isEnemyOrNeutralProp(slot, pr.x, pr.y)) return;
        if (F[pr.idx] < INF) landTargets++; else remoteTargets++;
      });
      ctx.enemyHQs.forEach(function (hq) {
        var Ft = field(ctx, 'tread', origin.y * w + origin.x, false);
        if (F[hq.y * w + hq.x] >= INF || Ft[hq.y * w + hq.x] >= INF) info.island = true;
      });
    }
    info.landTargets = landTargets; info.remoteTargets = remoteTargets;
    var wantFoot = Math.min(landTargets * 0.7 + 1, g.day > 15 ? 5 : 8);
    info.ferryCap = info.carriersSea * 2 + info.carriersAir;
    if (remoteTargets) wantFoot += Math.min(3, 1 + info.ferryCap);
    if (g.day <= 2) wantFoot = Math.max(wantFoot, 3);
    info.footNeed = Math.max(0, Math.ceil(wantFoot - info.foot));
    ctx.mine.forEach(function (u) { if (ferryGoal(ctx, u) >= 0) info.ferryDemand++; });
    info.ferryJam = info.ferryDemand >= info.ferryCap + 2;
    // Gegner nahe Wasser? (für Schiffe)
    var seaN = 0, totN = 0, sea = costTable(ctx.st, g, 'ship');
    Object.keys(ctx.ss.seen).forEach(function (id) {
      var s = ctx.ss.seen[id], T = G.UNITS[s.type];
      if (isAirT(s.type)) info.enemyAir += ucost(s.type);
      if (T.domain === 'sea') info.enemySea += ucost(s.type);
      totN++;
      outer: for (var dy = -3; dy <= 3; dy++) for (var dx = -3; dx <= 3; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > 3) continue;
        var x = s.x + dx, y = s.y + dy;
        if (x < 0 || y < 0 || x >= w || y >= ctx.h) continue;
        if (sea[y * w + x]) { seaN++; break outer; }
      }
    });
    info.coastal = totN ? Math.max(0.15, seaN / totN) : (info.island ? 0.7 : 0.3);
    return info;
  }
  function typeScore(ctx, type, comp, info, tile) {
    var lv = ctx.lv, T = G.UNITS[type], cnt = info.counts[type] || 0, g = ctx.g;
    var s = (lv.prior && lv.prior[type] != null ? lv.prior[type] : PRIOR[type]) || 0;
    if (lv.counterW && hasWeapon(type)) {
      var cs = counterScore(type, comp, info.coastal);
      if (cs < 0) s = type === 'missile' || type === 'fighter' ? -1 : s * 0.3;
      else s += lv.counterW * cs * 0.8;
    }
    if (type === 'fighter') s = info.enemyAir > 0 ? s + 0.4 + Math.min(0.6, info.enemyAir / 40000) : -1;
    if (type === 'missile') s = info.enemyAir > 9000 ? s + 0.4 : -1;
    if (type === 'aa' && info.enemyAir > 0) s += 0.3;
    if (T.cls === 'foot') {
      if (info.footNeed > 0) s += (type === 'inf' ? 1.2 : 0.4) * lv.infBias;
      else if (info.foot >= 6) s *= 0.5;
      if (type === 'mech' && g.day <= 3) s *= 0.5;
    }
    if ((type === 'recon' || type === 'drone') && (g.fog || g.weatherMode !== 'klar')) s += type === 'drone' ? 0.25 : 0.15;
    if (type === 'drone' && (info.counts.drone || 0) >= 1) s = -1;
    if (T.domain === 'sea' && hasWeapon(type)) {
      s *= info.island ? 1 : 0.6;
      if (type === 'battleship') s *= 0.5 + info.coastal;
      if ((type === 'cruiser' || type === 'sub') && !info.enemySea) s *= type === 'cruiser' && info.enemyAir ? 0.8 : 0.3;
    }
    // Transporter nach Bedarf
    if (type === 'lander') s = (info.ferryDemand >= 1 || (info.island && g.day >= 3)) && info.carriersSea < (info.island ? 2 : 1) ? 1.4 : -1;
    if (type === 'tcopter') s = (info.ferryDemand >= 1 && info.carriersAir < 1 && (info.island || info.remoteTargets)) ? 0.9 : -1;
    if (type === 'apc') s = -1;
    // Transporter nicht endlos nachkaufen, wenn sie ständig verloren gehen
    if ((type === 'lander' || type === 'tcopter') && (ctx.ss.boughtT || 0) >= 3 + Math.floor(g.day / 8)) s = -1;
    // Insel: Bodentruppen nur, soweit Transporter sie tragen können
    if (info.island && T.domain === 'ground' && T.cls === 'vehicle') {
      var cap = info.carriersSea * 2;
      s *= info.groundCombat < cap && !info.ferryJam ? 0.8 : 0.1;
    }
    if (info.island && T.cls === 'foot' && info.footNeed <= 0) s *= info.ferryJam ? 0.1 : 0.5;
    // Vielfalt
    if (T.cls !== 'foot') s /= 1 + 0.12 * cnt;
    if (isIndirectT(type) && T.domain === 'ground' && info.indirect > 0.6 * (info.direct + 1)) s *= 0.4;
    if (type === 'titan' && ctx.pl.funds < 30000) s *= 0.9;
    if (lv.coBuy && s > 0 && hasWeapon(type)) {
      var co = g.coOf(ctx.slot);
      if (co) {
        var bonus = (co.atk ? co.atk(type, null, 0, g) : 0) + (co.def ? co.def(type, null, 0) * 0.7 : 0) +
          (co.move ? co.move(type, 0) * 8 : 0);
        var cf = co.cost ? co.cost(type) : 1;
        s *= Math.max(0.6, 1 + bonus / 100 * 1.5) / cf;
      }
    }
    return s;
  }

  // ------------------------------------------------------------------ Aufgeben bei aussichtsloser Lage
  // Einmal pro Zug geprüft. Aufgegeben wird erst, wenn die Lage zwei eigene Züge in Folge aussichtslos ist.
  function hopeless(g, slot, ss) {
    if (g.meta && g.meta.aiResign === false) return false;
    if (g.day < 8) return false;
    var pl = g.playerBySlot(slot);
    if (!pl) return false;
    // Nie aufgeben, solange ein Mensch im eigenen Team kämpft
    if (g.players.some(function (p) { return p.alive && p.team === pl.team && !p.ai; })) return false;
    var teams = {};
    g.players.forEach(function (p) {
      if (!p.alive) return;
      var sc = g.scoreFor(p.slot);
      var t = teams[p.team] || (teams[p.team] = { value: 0, props: 0 });
      t.value += sc.value + sc.funds * 0.5; t.props += sc.props;
    });
    var mine = teams[pl.team], best = null;
    Object.keys(teams).forEach(function (k) { if (+k !== pl.team && (!best || teams[k].value > best.value)) best = teams[k]; });
    if (!mine || !best) return false;
    var bad = mine.value < best.value * 0.22 && mine.props < best.props * 0.6;
    ss.hopeless = bad ? (ss.hopeless || 0) + 1 : 0;
    return ss.hopeless >= 2;
  }

  // ------------------------------------------------------------------ Hauptablauf
  function decide(ctx) {
    var ss = ctx.ss;
    // Abgelehnte Einheiten einmal warten lassen
    for (var i = 0; i < ctx.ready.length; i++) if (ss.rej[ctx.ready[i].id] === 1) return waitCmd(ctx.ready[i]);
    if (!ss.acted && !ss.noPower) { var pw = choosePower(ctx); if (pw) return pw; }
    return bestTactical(ctx) || hqBlock(ctx) || loadPhase(ctx) || transportPhase(ctx) || movePhase(ctx) ||
      chooseBuild(ctx) || END;
  }

  function planNext(game, slot, opts) {
    var g = game;
    if (!g || g.over) return END;
    var cp = g.currentPlayer();
    if (!cp || cp.slot !== slot) return END;
    var st = getState(g), ss = slotState(st, g, slot);
    if (ss.last && ss.last.version === g.version) {
      var lc = ss.last.cmd;
      if (lc.kind === 'unit') { ss.rej[lc.unitId] = (ss.rej[lc.unitId] || 0) + 1; ss.invalid++; }
      else if (lc.kind === 'build') { ss.badBuild[lc.x + ',' + lc.y] = 1; ss.invalid++; }
      else if (lc.kind === 'power') { ss.noPower = true; ss.invalid++; }
    }
    ss.calls++;
    var cmd;
    if (ss.calls === 1 && hopeless(g, slot, ss)) cmd = { kind: 'resign' };
    else if (ss.calls > 280) cmd = END;
    else {
      var ctx = makeCtx(g, slot, opts || {}, st, ss);
      ctx.ferryPossible = function () {
        if (ctx._fp != null) return ctx._fp;
        var ok = carriersOf(ctx).some(function (t) { return G.UNITS[t.type].carries.indexOf('foot') >= 0; });
        if (!ok) ok = allProps(st, g).some(function (pr) {
          var t = g.map.terrain[pr.y][pr.x];
          return g.map.owner[pr.y][pr.x] === slot && (t === 'O' || t === 'A');
        });
        return (ctx._fp = ok);
      };
      try { cmd = decide(ctx) || END; }
      catch (e) {
        if (G.AI.rethrow) throw e;
        if (typeof console !== 'undefined' && console.error) console.error('KI-Fehler:', e);
        cmd = END;
      }
    }
    ss.last = { version: g.version, cmd: cmd };
    if (cmd.kind !== 'end') ss.acted++;
    if (cmd.kind === 'unit' && cmd.action && cmd.action.type === 'attack') st.lastFight = g.day;
    if (cmd.kind === 'end') { var hs = 0; g.units.forEach(function (u) { if (u.p === slot) hs += u.hp; }); ss.hpEnd = hs; }
    return cmd;
  }

  G.AI = {
    planNext: planNext,
    LEVELS: LEVELS,
    rethrow: false,
    // nur für Tests/Diagnose
    _internals: { makeCtx: makeCtx, getState: getState, slotState: slotState, buildInfo: buildInfo, typeScore: typeScore,
      enemyComposition: enemyComposition, chooseBuild: chooseBuild }
  };
})();
