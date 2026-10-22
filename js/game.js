// FRONTLINIE – Spielregeln (DOM-frei, in Node testbar)
var G = (typeof globalThis !== 'undefined' ? globalThis : window).G = (globalThis.G || {});

(function () {
  'use strict';

  var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  // --------------------------------------------------------------- Zufall (seeded)
  function rngNext(state) { // mulberry32
    var t = (state.s = (state.s + 0x6D2B79F5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // --------------------------------------------------------------- Karte parsen
  G.parseMap = function (def) {
    var h = def.rows.length, w = def.rows[0].length / 2;
    var terrain = [], owner = [];
    for (var y = 0; y < h; y++) {
      var tr = [], orow = [];
      for (var x = 0; x < w; x++) {
        var t = def.rows[y][x * 2], o = def.rows[y][x * 2 + 1];
        if (!G.TERRAIN[t]) t = 'P';
        tr.push(t);
        orow.push(o >= '1' && o <= '4' && G.TERRAIN[t].prop ? (o.charCodeAt(0) - 48) : 0);
      }
      terrain.push(tr); owner.push(orow);
    }
    return { w: w, h: h, terrain: terrain, owner: owner, name: def.name, id: def.id };
  };
  G.mapToDef = function (map, units) {
    var rows = [];
    for (var y = 0; y < map.h; y++) {
      var s = '';
      for (var x = 0; x < map.w; x++) s += map.terrain[y][x] + (map.owner[y][x] ? String(map.owner[y][x]) : '.');
      rows.push(s);
    }
    return { id: map.id, name: map.name, rows: rows, units: (units || []).map(function (u) { return [u.type, u.x, u.y, u.p, Math.ceil(u.hp / 10)]; }) };
  };
  /** Automatisches Tageslimit: je nach Kartengröße und Spielerzahl 15–30 Tage (Ziel: Partien von 15–60 Minuten) */
  G.autoDayLimit = function (def) {
    var m = def.terrain ? def : G.parseMap(def);
    var n = def.rows ? G.mapPlayerCount(def) : (def.players || 2);
    var base = Math.round((m.w + m.h) * 0.6) - (n - 2) * 3;
    return Math.max(15, Math.min(30, base));
  };
  /** Anzahl Spieler-Slots einer Karte (höchster Besitzer/Einheiten-Slot) */
  G.mapPlayerCount = function (def) {
    var m = 0;
    def.rows.forEach(function (r) { for (var i = 1; i < r.length; i += 2) { var o = r[i]; if (o >= '1' && o <= '4') m = Math.max(m, +o); } });
    (def.units || []).forEach(function (u) { m = Math.max(m, u[3]); });
    return Math.max(def.players || 0, m);
  };

  // --------------------------------------------------------------- Wetter
  // extra(mt, terrain) -> zusätzliche Bewegungskosten; fog: Nebel an diesem Tag; vision: Sichtänderung
  G.WEATHER = {
    klar: { id: 'klar', name: 'Klar', icon: '☀', desc: 'Gute Sicht, normale Bewegung.' },
    regen: { id: 'regen', name: 'Regen', icon: '🌧', fog: true, vision: -1,
      desc: 'Nebel des Krieges, Sicht −1. Ketten- und Radfahrzeuge kommen auf Ebene und im Wald schwerer voran.',
      extra: function (mt, t) { return (mt === 'tread' || mt === 'tire') && (t === 'P' || t === 'F') ? 1 : 0; } },
    schnee: { id: 'schnee', name: 'Schnee', icon: '❄', vision: 0,
      desc: 'Bodeneinheiten brauchen auf Ebene, Wald und Berg mehr Bewegung, Luftfahrzeuge überall.',
      extra: function (mt, t) {
        if (mt === 'air') return 1;
        if (mt === 'ship' || mt === 'trans') return 0;
        return (t === 'P' || t === 'F' || (t === 'M' && mt === 'foot')) ? 1 : 0;
      } },
    nacht: { id: 'nacht', name: 'Nacht', icon: '🌙', fog: true, vision: -1, desc: 'Dunkelheit: Nebel des Krieges und Sicht −1.' }
  };
  G.WEATHER_MODES = {
    klar: 'Immer klar', auto: 'Passend zur Karte', wechselhaft: 'Wechselhaft', regen: 'Dauerregen', schnee: 'Dauerschnee',
    tagnacht: 'Tag & Nacht', nacht: 'Ewige Nacht'
  };
  // Wahrscheinlichkeiten für wechselhaftes Wetter je Landschaft
  var THEME_WEATHER = {
    sommer: { klar: 0.75, regen: 0.25 },
    herbst: { klar: 0.55, regen: 0.45 },
    winter: { klar: 0.45, schnee: 0.55 },
    gebirge: { klar: 0.55, regen: 0.2, schnee: 0.25 }
  };
  G.THEMES = { sommer: 'Sommer', herbst: 'Herbst', winter: 'Winter', gebirge: 'Gebirge' };

  // --------------------------------------------------------------- Game
  function Game() {}
  G.Game = Game;

  /**
   * opts: { map: mapDef, players: [{slot, faction, co, ai, team, name}], fog, funds: {slot: n} | n,
   *         objective, seed, meta }
   */
  Game.create = function (opts) {
    var g = new Game();
    var def = opts.map;
    g.map = G.parseMap(def);
    g.mapDef = { id: def.id, name: def.name, players: def.players };
    var vmode = (opts.meta && opts.meta.vision) || (opts.fog ? 'nebel' : 'offen');
    g.explore = vmode === 'erkundung';
    g.fog = !!opts.fog || vmode !== 'offen';
    g.memo = {};
    g.theme = def.theme || (opts.meta && opts.meta.theme) || 'sommer';
    g.weatherMode = (opts.meta && opts.meta.weatherMode) || opts.weather || 'klar';
    g.weather = 'klar'; g.weatherLeft = 0;
    g.day = 1;
    g.turnIdx = 0;
    g.nextId = 1;
    g.rng = { s: (opts.seed != null ? opts.seed : Math.floor(Math.random() * 1e9)) | 0 };
    g.objective = opts.objective || { type: 'standard' };
    g.meta = opts.meta || {};
    if (g.meta.dayLimit === 'auto') g.meta.dayLimit = G.autoDayLimit(def);
    g.winner = null; // team-Nummer
    g.over = false;
    g.players = opts.players.map(function (p) {
      var funds = typeof opts.funds === 'number' ? opts.funds : (opts.funds && opts.funds[p.slot]) || 0;
      var co = p.co || G.FACTIONS[p.faction].co;
      return {
        slot: p.slot, faction: p.faction, co: co, ai: !!p.ai,
        // Fusion: zweiter Kommandant nur, wenn gültig und ein anderer als der erste
        co2: p.co2 && G.COS[p.co2] && p.co2 !== co ? p.co2 : null,
        team: p.team || p.slot, name: p.name || G.FACTIONS[p.faction].name, aiLevel: p.aiLevel || 'normal',
        funds: funds, power: 0, powerUses: 0, powerActive: 0, alive: true, hadUnits: false, turns: 0,
        stats: { built: 0, lost: 0, killed: 0, dealt: 0, captured: 0 }
      };
    });
    g.players.sort(function (a, b) { return a.slot - b.slot; });
    g.units = [];
    (def.units || []).forEach(function (u) {
      if (!g.playerBySlot(u[3]) || !G.UNITS[u[0]]) return;
      g.spawn(u[0], u[1], u[2], u[3], u[4] ? u[4] * 10 : 100);
    });
    // Eigentümer ohne Spieler -> neutral
    for (var y = 0; y < g.map.h; y++) for (var x = 0; x < g.map.w; x++) {
      var o = g.map.owner[y][x];
      if (o && !g.playerBySlot(o)) g.map.owner[y][x] = 0;
    }
    g.version = 0;
    g._vis = {};
    g.rollWeather(true);
    g.startEvents = g.startTurn(true);
    return g;
  };

  /** Partie aus einer Spiel-Konfiguration (Gefecht, Kampagne, Netzwerk) */
  G.gameFromSetup = function (cfg) {
    var game = Game.create({
      map: cfg.map, players: cfg.players, fog: cfg.fog, funds: cfg.funds, objective: cfg.objective,
      seed: cfg.seed, meta: Object.assign({ income: cfg.income || 1000, mapSource: G.mapToDef(G.parseMap(cfg.map), []) }, cfg.meta || {})
    });
    game.meta.mapDefFull = { id: cfg.map.id, name: cfg.map.name, players: cfg.map.players, rows: cfg.map.rows, units: cfg.map.units, desc: cfg.map.desc, theme: cfg.map.theme };
    game.meta.setup = cfg;
    return game;
  };

  Game.prototype.serialize = function () {
    var self = this;
    return JSON.stringify({
      v: 1, map: this.map, mapDef: this.mapDef, fog: this.fog, day: this.day, turnIdx: this.turnIdx,
      theme: this.theme, weatherMode: this.weatherMode, weather: this.weather, weatherLeft: this.weatherLeft,
      explore: this.explore, memo: this.packMemo(),
      nextId: this.nextId, rng: this.rng, objective: this.objective, meta: this.meta, winner: this.winner,
      over: this.over, players: this.players,
      units: this.units.map(function (u) { return self._plainUnit(u); })
    });
  };
  Game.prototype._plainUnit = function (u) {
    var self = this, o = {};
    for (var k in u) if (Object.prototype.hasOwnProperty.call(u, k)) o[k] = u[k];
    o.cargo = (u.cargo || []).map(function (c) { return self._plainUnit(c); });
    return o;
  };
  Game.load = function (json) {
    var d = typeof json === 'string' ? JSON.parse(json) : json;
    var g = new Game();
    ['map', 'mapDef', 'fog', 'day', 'turnIdx', 'nextId', 'rng', 'objective', 'meta', 'winner', 'over', 'players', 'units',
      'theme', 'weatherMode', 'weather', 'weatherLeft', 'explore']
      .forEach(function (k) { g[k] = d[k]; });
    g.version = 0;
    g._vis = {};
    g.unpackMemo(d.memo);
    return g;
  };
  Game.prototype.clone = function () { return Game.load(this.serialize()); };

  // --------------------------------------------------------------- Grundabfragen
  Game.prototype.touch = function () { this.version++; this._vis = {}; };
  Game.prototype.inBounds = function (x, y) { return x >= 0 && y >= 0 && x < this.map.w && y < this.map.h; };
  Game.prototype.terrainAt = function (x, y) { return G.TERRAIN[this.map.terrain[y][x]]; };
  Game.prototype.ownerAt = function (x, y) { return this.map.owner[y][x]; };
  Game.prototype.unitAt = function (x, y) {
    for (var i = 0; i < this.units.length; i++) { var u = this.units[i]; if (u.x === x && u.y === y) return u; }
    return null;
  };
  Game.prototype.unitById = function (id) {
    for (var i = 0; i < this.units.length; i++) {
      var u = this.units[i];
      if (u.id === id) return u;
      if (u.cargo) for (var j = 0; j < u.cargo.length; j++) if (u.cargo[j].id === id) return u.cargo[j];
    }
    return null;
  };
  Game.prototype.transportOf = function (id) {
    for (var i = 0; i < this.units.length; i++) {
      var u = this.units[i];
      if (u.cargo) for (var j = 0; j < u.cargo.length; j++) if (u.cargo[j].id === id) return u;
    }
    return null;
  };
  Game.prototype.playerBySlot = function (slot) {
    for (var i = 0; i < this.players.length; i++) if (this.players[i].slot === slot) return this.players[i];
    return null;
  };
  Game.prototype.currentPlayer = function () { return this.players[this.turnIdx]; };
  Game.prototype.isEnemy = function (a, b) {
    if (a === b) return false;
    var pa = this.playerBySlot(a), pb = this.playerBySlot(b);
    if (!pa || !pb) return false;
    return pa.team !== pb.team;
  };
  Game.prototype.isAlly = function (a, b) { return !this.isEnemy(a, b); };
  Game.prototype.dispHp = function (u) { return Math.ceil(u.hp / 10); };
  Game.prototype.unitsOf = function (slot) { return this.units.filter(function (u) { return u.p === slot; }); };
  Game.prototype.countUnits = function (slot, mobileOnly) {
    var n = 0;
    this.units.forEach(function (u) {
      if (u.p !== slot) return;
      if (mobileOnly && G.UNITS[u.type].cls === 'static') return;
      n += 1 + (u.cargo ? u.cargo.length : 0);
    });
    return n;
  };
  Game.prototype.propertiesOf = function (slot) {
    var out = [];
    for (var y = 0; y < this.map.h; y++) for (var x = 0; x < this.map.w; x++)
      if (this.map.owner[y][x] === slot) out.push({ x: x, y: y, t: this.map.terrain[y][x] });
    return out;
  };
  Game.prototype.allProperties = function () {
    var out = [];
    for (var y = 0; y < this.map.h; y++) for (var x = 0; x < this.map.w; x++)
      if (G.TERRAIN[this.map.terrain[y][x]].prop) out.push({ x: x, y: y, t: this.map.terrain[y][x], owner: this.map.owner[y][x] });
    return out;
  };
  Game.prototype.hqOf = function (slot) {
    for (var y = 0; y < this.map.h; y++) for (var x = 0; x < this.map.w; x++)
      if (this.map.owner[y][x] === slot && this.map.terrain[y][x] === 'Q') return { x: x, y: y };
    return null;
  };
  Game.prototype.rand = function () { return rngNext(this.rng); };

  Game.prototype.spawn = function (type, x, y, slot, hp) {
    var T = G.UNITS[type];
    var u = { id: this.nextId++, type: type, x: x, y: y, p: slot, hp: hp == null ? 100 : hp, fuel: T.fuel, ammo: T.ammo,
      moved: false, dived: false, cargo: [], cp: G.RULES.capturePoints };
    this.units.push(u);
    var pl = this.playerBySlot(slot);
    if (pl) pl.hadUnits = true;
    this.touch();
    return u;
  };
  Game.prototype.removeUnit = function (u) {
    var i = this.units.indexOf(u);
    if (i >= 0) this.units.splice(i, 1);
    this.touch();
  };

  // --------------------------------------------------------------- CO-Hooks
  /** Wirksamer Kommandant (bei Fusion das kombinierte Objekt aus G.coFor) */
  Game.prototype.coOf = function (slot) { var p = this.playerBySlot(slot); return p ? G.coFor(p) : null; };
  Game.prototype.powerOf = function (slot) { var p = this.playerBySlot(slot); return p ? p.powerActive : 0; };
  Game.prototype.coAtk = function (u, target) {
    var co = this.coOf(u.p), p = this.powerOf(u.p);
    var v = 100 + (co && co.atk ? co.atk(u.type, target ? target.type : null, p, this) : 0);
    if (p) v += G.RULES.powerAtk;
    return v;
  };
  Game.prototype.coDef = function (u, attacker) {
    var co = this.coOf(u.p), p = this.powerOf(u.p);
    var v = 100 + (co && co.def ? co.def(u.type, attacker ? attacker.type : null, p, this) : 0) + (G.UNITS[u.type].defBonus || 0);
    if (p) v += G.RULES.powerDef;
    return v;
  };
  Game.prototype.moveOf = function (u) {
    if (!G.UNITS[u.type].move) return 0; // feste Stellung
    var co = this.coOf(u.p);
    return Math.max(1, G.UNITS[u.type].move + (co && co.move ? co.move(u.type, this.powerOf(u.p)) : 0));
  };
  Game.prototype.rangeOf = function (u) {
    var T = G.UNITS[u.type], co = this.coOf(u.p);
    var bonus = co && co.range ? co.range(u.type, this.powerOf(u.p)) : 0;
    return [T.range[0], T.range[1] + (T.range[0] > 1 ? bonus : 0)];
  };
  Game.prototype.visionOf = function (u, x, y) {
    var T = G.UNITS[u.type], co = this.coOf(u.p);
    var v = T.vision + (co && co.vision ? co.vision(u.type, this.powerOf(u.p)) : 0);
    var W = G.WEATHER[this.weather];
    if (W && W.vision) v += W.vision;
    if (T.cls === 'foot' && G.TERRAIN[this.map.terrain[y][x]].peak) v += 3;
    return Math.max(1, v);
  };
  Game.prototype.luckOf = function (slot) {
    var co = this.coOf(slot);
    return co && co.luck ? co.luck(this.powerOf(slot)) : [0, 9];
  };
  Game.prototype.costOf = function (type, slot) {
    var co = this.coOf(slot);
    return Math.round(G.UNITS[type].cost * (co && co.cost ? co.cost(type) : 1));
  };
  /** Tageseinkommen: Gebäude × Einkommen je Gebäude × CO-Faktor (Hook income) */
  Game.prototype.incomeOf = function (slot) {
    var co = this.coOf(slot);
    var base = this.propertiesOf(slot).length * (this.meta.income || G.RULES.income);
    return Math.round(base * (co && co.income ? co.income(this.powerOf(slot)) : 1));
  };
  Game.prototype.piercing = function (slot) {
    var co = this.coOf(slot);
    return !!(co && co.piercing && co.piercing(this.powerOf(slot)));
  };

  // --------------------------------------------------------------- Sicht / Nebel
  /** Liefert Uint8Array (w*h): 1 = sichtbar. Ohne Nebel alles sichtbar. */
  Game.prototype.visibility = function (slot) {
    if (this._vis[slot]) return this._vis[slot];
    var w = this.map.w, h = this.map.h, vis = new Uint8Array(w * h);
    if (!this.fogActive()) { vis.fill(1); this._vis[slot] = vis; this.remember(slot, vis); return vis; }
    var self = this, pierce = this.piercing(slot);
    this.units.forEach(function (u) {
      if (!self.isAlly(u.p, slot)) return;
      var r = self.visionOf(u, u.x, u.y);
      for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++) {
        var d = Math.abs(dx) + Math.abs(dy); if (d > r) continue;
        var x = u.x + dx, y = u.y + dy; if (!self.inBounds(x, y)) continue;
        if (G.TERRAIN[self.map.terrain[y][x]].hides && d > 1 && !pierce) continue;
        vis[y * w + x] = 1;
      }
    });
    // Eigene Gebäude: im Nebel nur das Feld selbst, bei Erkundung etwas Umgebung (HQ mehr)
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var o = this.map.owner[y][x];
      if (!o || !this.isAlly(o, slot)) continue;
      var tt = this.map.terrain[y][x];
      var rr = tt === 'Q' ? 5 : G.TERRAIN[tt].builds ? 3 : 2;
      for (var yy = y - rr; yy <= y + rr; yy++) for (var xx = x - rr; xx <= x + rr; xx++) {
        if (!this.inBounds(xx, yy) || Math.abs(xx - x) + Math.abs(yy - y) > rr) continue;
        if (G.TERRAIN[this.map.terrain[yy][xx]].hides && (xx !== x || yy !== y) && !pierce) continue;
        vis[yy * w + xx] = 1;
      }
    }
    this._vis[slot] = vis;
    this.remember(slot, vis);
    return vis;
  };
  // --------------------------------------------------------------- Erkundungs-Gedächtnis
  // memo[slot] = { seen: Uint8Array, owner: Int8Array (zuletzt gesehener Besitzer), changed: [Indizes] }
  Game.prototype.memoOf = function (slot) {
    if (!this.memo) this.memo = {};
    var m = this.memo[slot], N = this.map.w * this.map.h;
    if (!m) {
      m = this.memo[slot] = { seen: new Uint8Array(N), owner: new Int8Array(N), changed: [] };
      for (var i = 0; i < N; i++) m.owner[i] = -1;
    }
    return m;
  };
  Game.prototype.remember = function (slot, vis) {
    if (!this.explore || slot == null) return;
    var m = this.memoOf(slot), w = this.map.w;
    for (var i = 0; i < vis.length; i++) {
      if (!vis[i]) continue;
      var x = i % w, y = (i - x) / w, o = this.map.owner[y][x];
      if (!m.seen[i] || m.owner[i] !== o) { if (m.changed.length < 20000) m.changed.push(i); else m.overflow = true; }
      m.seen[i] = 1; m.owner[i] = o;
    }
  };
  Game.prototype.isExplored = function (slot, x, y) {
    if (!this.explore || slot == null) return true;
    this.visibility(slot);
    return !!this.memoOf(slot).seen[y * this.map.w + x];
  };
  Game.prototype.packMemo = function () {
    var out = {}, self = this;
    Object.keys(this.memo || {}).forEach(function (k) {
      var m = self.memo[k], s = '', o = '';
      for (var i = 0; i < m.seen.length; i++) { s += m.seen[i] ? '1' : '0'; o += m.owner[i] < 0 ? '.' : String(m.owner[i]); }
      out[k] = { s: s, o: o };
    });
    return out;
  };
  Game.prototype.unpackMemo = function (d) {
    this.memo = {};
    if (!d) return;
    var self = this;
    Object.keys(d).forEach(function (k) {
      var m = self.memoOf(+k);
      for (var i = 0; i < m.seen.length && i < d[k].s.length; i++) {
        m.seen[i] = d[k].s[i] === '1' ? 1 : 0;
        m.owner[i] = d[k].o[i] === '.' ? -1 : +d[k].o[i];
      }
    });
  };
  Game.prototype.tileVisible = function (slot, x, y) { return !!this.visibility(slot)[y * this.map.w + x]; };
  /** Ist Einheit u für Spieler slot sichtbar? (slot null = allwissend) */
  Game.prototype.unitVisibleTo = function (u, slot) {
    if (slot == null) return true;
    if (this.isAlly(u.p, slot)) return true;
    if (u.dived) {
      // getauchte U-Boote nur direkt neben eigenen/verbündeten Einheiten
      for (var i = 0; i < DIRS.length; i++) {
        var n = this.unitAt(u.x + DIRS[i][0], u.y + DIRS[i][1]);
        if (n && this.isAlly(n.p, slot)) return true;
      }
      return false;
    }
    return this.tileVisible(slot, u.x, u.y);
  };

  // --------------------------------------------------------------- Bewegung
  Game.prototype.moveCost = function (type, x, y, slot) {
    return this.moveCostMt(G.UNITS[type].mt, x, y, slot);
  };
  /** Bewegungskosten je Bewegungsart inkl. Wetter (0 = unpassierbar). slot (optional): Besitzer – CO-Hook weatherImmune hebt den Wetter-Nachteil auf */
  Game.prototype.moveCostMt = function (mt, x, y, slot) {
    if (!this.inBounds(x, y)) return 0;
    var t = this.map.terrain[y][x], c = G.TERRAIN[t].move[mt] || 0;
    if (!c) return 0;
    var W = G.WEATHER[this.weather];
    if (!W || !W.extra) return c;
    var co = slot != null ? this.coOf(slot) : null;
    if (co && co.weatherImmune && co.weatherImmune(this.weather, this.powerOf(slot))) return c;
    return c + W.extra(mt, t);
  };
  /** Nebel ist aktiv bei Nebel-Einstellung oder Wetter mit Sichtbehinderung (Regen, Nacht) */
  Game.prototype.fogActive = function () {
    var W = G.WEATHER[this.weather];
    return !!(this.fog || (W && W.fog));
  };
  /** Würfelt das Wetter für den neuen Tag (deterministisch über den Spiel-Zufall) */
  Game.prototype.rollWeather = function (first) {
    var mode = this.weatherMode || 'klar', w = 'klar';
    // weatherLeft > 0: Wetter bleibt (wechselhaft gewürfelt oder per CO-Kraft gesetzt – dann in jedem Modus)
    if (!first && this.weatherLeft > 0) { this.weatherLeft--; return; }
    if (mode === 'auto') mode = 'wechselhaft';
    if (mode === 'klar' || mode === 'regen' || mode === 'schnee' || mode === 'nacht') w = mode;
    else if (mode === 'tagnacht') w = this.day % 3 === 0 ? 'nacht' : 'klar';
    else if (mode === 'wechselhaft') {
      if (first) { this.weather = 'klar'; this.weatherLeft = 2; this.touch(); return; }
      if (this.weatherLeft > 0) { this.weatherLeft--; return; }
      var probs = THEME_WEATHER[this.theme] || THEME_WEATHER.sommer;
      if (this.weatherMode === 'wechselhaft' && this.theme === 'sommer') probs = { klar: 0.6, regen: 0.25, schnee: 0.15 };
      var r = this.rand(), acc = 0;
      Object.keys(probs).forEach(function (k) { if (w === 'klar' && r >= acc && r < acc + probs[k]) w = k; acc += probs[k]; });
      if (r >= acc) w = 'klar';
      this.weatherLeft = w === 'klar' ? 1 + Math.floor(this.rand() * 3) : Math.floor(this.rand() * 2);
    }
    this.weather = w;
    this.touch();
  };
  /**
   * Erreichbare Felder. opts.viewer: Spieler, aus dessen Sicht (Nebel) gerechnet wird (Standard = Besitzer).
   * opts.omniscient: alle Gegner blockieren. opts.ignoreMove: unbegrenzte Reichweite (für KI-Distanzen).
   * Rückgabe: { nodes: {idx: {x,y,cost,prev,end}}, list, w }. 'end' = darf dort stehen bleiben.
   */
  Game.prototype.reachable = function (u, opts) {
    opts = opts || {};
    var viewer = opts.viewer != null ? opts.viewer : u.p;
    var w = this.map.w, self = this;
    var budget = opts.ignoreMove ? 9999 : Math.min(this.moveOf(u), u.fuel);
    var nodes = {}, start = u.y * w + u.x;
    nodes[start] = { x: u.x, y: u.y, cost: 0, prev: -1 };
    var open = [start];
    var blockers = {};
    this.units.forEach(function (o) {
      if (self.isEnemy(o.p, u.p) && (opts.omniscient || self.unitVisibleTo(o, viewer))) blockers[o.y * w + o.x] = 1;
    });
    while (open.length) {
      var bi = 0;
      for (var i = 1; i < open.length; i++) if (nodes[open[i]].cost < nodes[open[bi]].cost) bi = i;
      var cur = open[bi]; open[bi] = open[open.length - 1]; open.pop();
      var cn = nodes[cur];
      for (var d = 0; d < 4; d++) {
        var nx = cn.x + DIRS[d][0], ny = cn.y + DIRS[d][1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= this.map.h) continue;
        var c = this.moveCost(u.type, nx, ny, u.p);
        if (!c) continue;
        var nc = cn.cost + c;
        if (nc > budget) continue;
        var ni = ny * w + nx;
        if (blockers[ni]) continue;
        if (!nodes[ni] || nodes[ni].cost > nc) {
          nodes[ni] = { x: nx, y: ny, cost: nc, prev: cur };
          open.push(ni);
        }
      }
    }
    var list = [];
    Object.keys(nodes).forEach(function (k) {
      var n = nodes[k];
      var occ = self.unitAt(n.x, n.y);
      n.end = !occ || occ === u || (occ.p === u.p && (self.canJoin(u, occ) || self.canLoad(u, occ))) ||
        (self.isEnemy(occ.p, u.p) && !opts.omniscient && !self.unitVisibleTo(occ, viewer));
      list.push(n);
    });
    return { nodes: nodes, list: list, w: w };
  };
  Game.prototype.pathTo = function (reach, x, y) {
    var n = reach.nodes[y * reach.w + x];
    if (!n) return null;
    var path = [];
    while (n) { path.unshift({ x: n.x, y: n.y }); n = n.prev >= 0 ? reach.nodes[n.prev] : null; }
    return path;
  };
  /** Läuft den Pfad ab und prüft auf Hinterhalt (versteckte Gegner). Mutiert nichts. */
  Game.prototype.simulatePath = function (u, path) {
    var out = [path[0]], fuel = 0;
    for (var i = 1; i < path.length; i++) {
      var occ = this.unitAt(path[i].x, path[i].y);
      if (occ && occ !== u && this.isEnemy(occ.p, u.p)) {
        // zurückweichen, falls wir auf einer eigenen Einheit stehen würden
        while (out.length > 1) {
          var e = out[out.length - 1], o2 = this.unitAt(e.x, e.y);
          if (!o2 || o2 === u) break;
          out.pop(); fuel -= this.moveCost(u.type, e.x, e.y, u.p);
        }
        return { path: out, trapped: true, fuel: fuel, blocker: occ };
      }
      fuel += this.moveCost(u.type, path[i].x, path[i].y, u.p);
      out.push(path[i]);
    }
    return { path: out, trapped: false, fuel: fuel };
  };

  Game.prototype.canJoin = function (mover, target) {
    return target !== mover && target.p === mover.p && target.type === mover.type && target.hp < 100 &&
      !(mover.cargo && mover.cargo.length) && !(target.cargo && target.cargo.length);
  };
  Game.prototype.canCarry = function (transport, unit) {
    var T = G.UNITS[transport.type];
    if (!T.carries || transport.p !== unit.p) return false;
    if ((transport.cargo || []).length >= T.cap) return false;
    return T.carries.indexOf(G.UNITS[unit.type].cls) >= 0;
  };
  Game.prototype.canLoad = function (mover, target) { return target !== mover && this.canCarry(target, mover); };

  // --------------------------------------------------------------- Kampf
  Game.prototype.weaponFor = function (att, def) {
    if (!def) return null;
    var D = G.DAMAGE[att.type];
    if (!D) return null;
    if (def.dived && !(att.type === 'sub' || att.type === 'cruiser')) return null;
    if (D.primary && D.primary[def.type] != null && att.ammo > 0) return { w: 'primary', base: D.primary[def.type] };
    if (D.secondary && D.secondary[def.type] != null) return { w: 'secondary', base: D.secondary[def.type] };
    return null;
  };
  Game.prototype.canAttackType = function (attType, defType) {
    var D = G.DAMAGE[attType];
    return !!(D && ((D.primary && D.primary[defType] != null) || (D.secondary && D.secondary[defType] != null)));
  };
  Game.prototype.terrainStars = function (u, x, y) {
    var c = G.UNITS[u.type].cls;
    if (c === 'copter' || c === 'plane') return 0;
    return G.TERRAIN[this.map.terrain[y][x]].def;
  };
  /** Schaden in internen KP (0–100). luck: konkreter Glückswert. */
  Game.prototype.calcDamage = function (att, def, attHp, defX, defY, luck) {
    var wpn = this.weaponFor(att, def);
    if (!wpn) return 0;
    var aHp = Math.ceil(attHp / 10);
    var dHp = Math.ceil(def.hp / 10);
    var atk = this.coAtk(att, def);
    var dv = this.coDef(def, att);
    var stars = this.terrainStars(def, defX, defY);
    var raw = (wpn.base * atk / 100 + luck) * (aHp / 10) * (200 - (dv + stars * dHp)) / 100;
    // auf 0,05 aufrunden (Gleitkomma-Glättung), dann abrunden
    return Math.max(0, Math.floor(Math.ceil(raw * 20 - 1e-9) / 20));
  };
  Game.prototype.rollLuck = function (slot) {
    var l = this.luckOf(slot);
    return l[0] + Math.floor(this.rand() * (l[1] - l[0] + 1));
  };
  /** Kann def zurückschlagen, wenn att von (ax,ay) angreift? */
  Game.prototype.canCounter = function (att, def, ax, ay) {
    var R = this.rangeOf(def);
    if (R[0] !== 1 || R[1] !== 1) return false;
    if (Math.abs(ax - def.x) + Math.abs(ay - def.y) !== 1) return false;
    return !!this.weaponFor(def, att);
  };
  /** Vorschau: {min,max,cMin,cMax,counter} in internen KP. */
  Game.prototype.forecast = function (att, def, ax, ay) {
    var l = this.luckOf(att.p);
    var min = Math.min(def.hp, this.calcDamage(att, def, att.hp, def.x, def.y, l[0]));
    var max = Math.min(def.hp, this.calcDamage(att, def, att.hp, def.x, def.y, l[1]));
    var res = { min: min, max: max, cMin: 0, cMax: 0, counter: false };
    if (this.canCounter(att, def, ax, ay)) {
      var dl = this.luckOf(def.p);
      var probe = { type: att.type, p: att.p, hp: att.hp, x: ax, y: ay, dived: att.dived, ammo: att.ammo };
      if (def.hp - max > 0) res.cMin = Math.min(att.hp, this.calcDamage(def, probe, def.hp - max, ax, ay, dl[0]));
      if (def.hp - min > 0) res.cMax = Math.min(att.hp, this.calcDamage(def, probe, def.hp - min, ax, ay, dl[1]));
      res.counter = def.hp - min > 0;
    }
    return res;
  };
  /** Ziele, die u von (x,y) aus angreifen könnte. moved: hat sich bewegt. viewer: Sichtprüfung. */
  Game.prototype.targetsFrom = function (u, x, y, moved, viewer) {
    var R = this.rangeOf(u), out = [];
    if (R[1] === 0) return out;
    if (R[0] > 1 && moved) return out;
    viewer = viewer !== undefined ? viewer : u.p;
    for (var i = 0; i < this.units.length; i++) {
      var t = this.units[i];
      if (!this.isEnemy(t.p, u.p)) continue;
      var d = Math.abs(t.x - x) + Math.abs(t.y - y);
      if (d < R[0] || d > R[1]) continue;
      if (!this.unitVisibleTo(t, viewer)) continue;
      if (!this.weaponFor(u, t)) continue;
      out.push(t);
    }
    return out;
  };

  // --------------------------------------------------------------- CO-Kräfte
  Game.prototype.addPowerCharge = function (slot, value) {
    var pl = this.playerBySlot(slot);
    if (!pl || pl.powerActive || this.meta.powers === false) return;
    pl.power = Math.min(this.powerMax(slot), pl.power + value);
  };
  Game.prototype.starCost = function (slot) {
    var pl = this.playerBySlot(slot);
    return G.RULES.starValue * (1 + G.RULES.starGrowth * Math.min(pl.powerUses, G.RULES.starGrowthMax));
  };
  Game.prototype.powerMax = function (slot) { return this.coOf(slot).superPower.stars * this.starCost(slot); };
  Game.prototype.powerStars = function (slot) { return this.playerBySlot(slot).power / this.starCost(slot); };
  Game.prototype.canActivate = function (slot, level) {
    var pl = this.playerBySlot(slot), co = this.coOf(slot);
    if (!pl || pl.powerActive || this.over || this.meta.powers === false) return false;
    var need = (level === 2 ? co.superPower.stars : co.power.stars) * this.starCost(slot);
    return pl.power >= need - 0.5;
  };
  Game.prototype.activatePower = function (slot, level) {
    if (!this.canActivate(slot, level)) return null;
    var pl = this.playerBySlot(slot), co = this.coOf(slot);
    pl.power = 0;
    pl.powerActive = level;
    pl.powerUses++;
    // co = Haupt-Kommandant, co2 = Fusionspartner (oder null); name stammt vom (ggf. fusionierten) CO
    var ev = { type: 'power', slot: slot, level: level, co: pl.co, co2: pl.co2 || null, name: level === 2 ? co.superPower.name : co.power.name };
    var w0 = this.weather;
    if (co.onPower) co.onPower(this, slot, level);
    if (this.weather !== w0) ev.weather = this.weather;   // Wetter-Kraft: Anzeige soll den Umschwung zeigen
    this.touch();
    return ev;
  };
  Game.prototype.healAll = function (slot, amount) {
    this.units.forEach(function (u) { if (u.p === slot) u.hp = Math.min(100, u.hp + amount); });
  };
  Game.prototype.damageEnemies = function (slot, amount) {
    var self = this;
    this.units.forEach(function (u) { if (self.isEnemy(u.p, slot)) u.hp = Math.max(1, u.hp - amount); });
  };

  /** Führt einen Angriff aus (att steht schon auf seinem Feld). Gibt Ereignis zurück. */
  Game.prototype.resolveAttack = function (att, def) {
    var ax = att.x, ay = att.y;
    var w1 = this.weaponFor(att, def);
    var hpA0 = att.hp, hpD0 = def.hp;
    var dmg = Math.min(def.hp, this.calcDamage(att, def, att.hp, def.x, def.y, this.rollLuck(att.p)));
    if (w1 && w1.w === 'primary') att.ammo--;
    def.hp -= dmg;
    var costD = G.UNITS[def.type].cost, costA = G.UNITS[att.type].cost;
    var lostD = Math.ceil(hpD0 / 10) - Math.ceil(Math.max(0, def.hp) / 10);
    this.addPowerCharge(att.p, costD * lostD / 10 * 0.5);
    this.addPowerCharge(def.p, costD * lostD / 10);
    var pa = this.playerBySlot(att.p), pd = this.playerBySlot(def.p);
    pa.stats.dealt += dmg;
    var counter = 0, killedDef = false, killedAtt = false;
    if (def.hp <= 0) { killedDef = true; }
    else if (this.canCounter(att, def, ax, ay)) {
      var w2 = this.weaponFor(def, att);
      counter = Math.min(att.hp, this.calcDamage(def, att, def.hp, ax, ay, this.rollLuck(def.p)));
      if (w2 && w2.w === 'primary') def.ammo--;
      att.hp -= counter;
      var lostA = Math.ceil(hpA0 / 10) - Math.ceil(Math.max(0, att.hp) / 10);
      this.addPowerCharge(def.p, costA * lostA / 10 * 0.5);
      this.addPowerCharge(att.p, costA * lostA / 10);
      pd.stats.dealt += counter;
      if (att.hp <= 0) killedAtt = true;
    }
    var ev = { type: 'attack',
      att: { id: att.id, type: att.type, p: att.p, x: ax, y: ay, hp0: hpA0, hp1: Math.max(0, att.hp) },
      def: { id: def.id, type: def.type, p: def.p, x: def.x, y: def.y, hp0: hpD0, hp1: Math.max(0, def.hp) },
      dmg: dmg, counter: counter, killedDef: killedDef, killedAtt: killedAtt };
    if (killedDef) { this.destroy(def); pa.stats.killed++; }
    if (killedAtt) { this.destroy(att); pd.stats.killed++; }
    this.touch();
    return ev;
  };
  Game.prototype.destroy = function (u) {
    var pl = this.playerBySlot(u.p);
    if (pl) pl.stats.lost += 1 + (u.cargo ? u.cargo.length : 0);
    this.removeUnit(u);
  };

  // --------------------------------------------------------------- Aktionen
  /** Mögliche Aktionen, wenn u über path an dessen Ende zieht. Array von {type, targets?, options?, target?} */
  Game.prototype.actionsFor = function (u, path, trapped) {
    var end = path[path.length - 1], x = end.x, y = end.y;
    var moved = path.length > 1;
    var T = G.UNITS[u.type], acts = [];
    var occ = this.unitAt(x, y);
    if (occ && occ !== u) {
      if (this.canJoin(u, occ)) acts.push({ type: 'join', target: occ });
      else if (this.canLoad(u, occ)) acts.push({ type: 'load', target: occ });
      return acts;
    }
    if (trapped) { acts.push({ type: 'wait' }); return acts; }
    var targets = this.targetsFrom(u, x, y, moved);
    if (targets.length) acts.push({ type: 'attack', targets: targets });
    var ter = G.TERRAIN[this.map.terrain[y][x]];
    if (T.capture && ter.prop && this.isEnemyOrNeutralProp(u.p, x, y)) acts.push({ type: 'capture' });
    if (T.carries && u.cargo && u.cargo.length) {
      var opts = this.unloadOptions(u, x, y);
      if (opts.some(function (o) { return o.tiles.length; })) acts.push({ type: 'unload', options: opts });
    }
    if (T.supplies && this.supplyTargets(u, x, y).length) acts.push({ type: 'supply' });
    if (T.fortifies) {
      var fo = this.fortifyOptions(u, x, y);
      if (fo.some(function (o) { return o.tiles.length && o.affordable; })) acts.push({ type: 'fortify', options: fo });
    }
    if (T.repairs) {
      var rt = this.repairTargets(u, x, y);
      if (rt.length) acts.push({ type: 'repair', targets: rt });
    }
    if (T.canDive) acts.push({ type: u.dived ? 'surface' : 'dive' });
    acts.push({ type: 'wait' });
    return acts;
  };
  Game.prototype.isEnemyOrNeutralProp = function (slot, x, y) {
    var o = this.map.owner[y][x];
    return o === 0 || this.isEnemy(o, slot);
  };
  Game.prototype.unloadOptions = function (t, x, y, viewer) {
    var self = this;
    if (viewer === undefined) viewer = t.p;
    return (t.cargo || []).map(function (c, idx) {
      var tiles = [];
      if (self.moveCost(c.type, x, y)) {
        DIRS.forEach(function (d) {
          var nx = x + d[0], ny = y + d[1];
          if (!self.inBounds(nx, ny) || !self.moveCost(c.type, nx, ny)) return;
          var o = self.unitAt(nx, ny);
          if (o && o !== t && self.unitVisibleTo(o, viewer)) return;
          tiles.push({ x: nx, y: ny });
        });
      }
      return { idx: idx, unit: c, tiles: tiles };
    });
  };
  /** Mögliche Stellungen für einen Pionier auf (x,y): [{type, cost, affordable, tiles}] */
  Game.prototype.fortifyOptions = function (u, x, y, viewer) {
    var self = this, pl = this.playerBySlot(u.p);
    if (viewer === undefined) viewer = u.p;
    return (G.UNITS[u.type].fortifies || []).map(function (t) {
      var cost = self.costOf(t, u.p), tiles = [];
      DIRS.forEach(function (d) {
        var nx = x + d[0], ny = y + d[1];
        if (!self.inBounds(nx, ny)) return;
        var ter = self.map.terrain[ny][nx];
        if ('PFMRH'.indexOf(ter) < 0) return;
        if (G.UNITS[t].coastal && !DIRS.some(function (e) { var tx = nx + e[0], ty = ny + e[1]; return self.inBounds(tx, ty) && G.TERRAIN[self.map.terrain[ty][tx]].water; })) return;
        var o = self.unitAt(nx, ny);
        if (o && o !== u && self.unitVisibleTo(o, viewer)) return;
        if (o === u) return;
        tiles.push({ x: nx, y: ny });
      });
      return { type: t, cost: cost, affordable: pl.funds >= cost, tiles: tiles };
    });
  };
  /** Nachbarn, die ein Bergepanzer reparieren kann */
  Game.prototype.repairTargets = function (u, x, y) {
    var self = this, pl = this.playerBySlot(u.p);
    return this.supplyTargets(u, x, y).filter(function (t) {
      var T = G.UNITS[t.type];
      return t.hp < 100 && (T.domain === 'ground' || T.cls === 'copter') && pl.funds >= Math.floor(self.costOf(t.type, t.p) / 10);
    });
  };
  Game.prototype.supplyTargets = function (u, x, y) {
    var out = [], self = this;
    DIRS.forEach(function (d) {
      var o = self.unitAt(x + d[0], y + d[1]);
      if (o && o !== u && o.p === u.p) out.push(o);
    });
    return out;
  };
  Game.prototype.resupply = function (u) {
    var T = G.UNITS[u.type];
    u.fuel = T.fuel; u.ammo = T.ammo;
  };

  /**
   * Zentrale Aktion: Einheit zieht über path und führt action aus.
   * action: {type:'wait'|'attack'|'capture'|'join'|'load'|'unload'|'supply'|'dive'|'surface',
   *          targetId?, unloads?: [{idx,x,y}]}
   * Rückgabe: { ok, events: [...], error? }. Bei Hinterhalt wird die Aktion zu 'wait'.
   */
  Game.prototype.commit = function (unitId, path, action) {
    var u = this.unitById(unitId);
    var cp = this.currentPlayer();
    action = action || { type: 'wait' };
    if (!u || u.x === undefined || u.p !== cp.slot || u.moved || this.over) return { ok: false, error: 'invalid unit', events: [] };
    if (!path || !path.length) path = [{ x: u.x, y: u.y }];
    if (path[0].x !== u.x || path[0].y !== u.y) return { ok: false, error: 'path start', events: [] };
    var cost = 0;
    for (var i = 1; i < path.length; i++) {
      var dd = Math.abs(path[i].x - path[i - 1].x) + Math.abs(path[i].y - path[i - 1].y);
      var c = this.moveCost(u.type, path[i].x, path[i].y, u.p);
      if (dd !== 1 || !c) return { ok: false, error: 'bad path', events: [] };
      cost += c;
    }
    if (cost > Math.min(this.moveOf(u), u.fuel)) return { ok: false, error: 'too far', events: [] };
    var sim = this.simulatePath(u, path);
    var events = [];
    var end = sim.path[sim.path.length - 1];
    if (sim.trapped) {
      action = { type: 'wait' };
      events.push({ type: 'trap', unitId: u.id, x: end.x, y: end.y, blocker: sim.blocker.id, bx: sim.blocker.x, by: sim.blocker.y });
    }
    var occ = this.unitAt(end.x, end.y);
    var moved = sim.path.length > 1;
    var acts = this.actionsFor(u, sim.path, sim.trapped);
    var allowed = acts.map(function (a) { return a.type; });
    if (allowed.indexOf(action.type) < 0) {
      return { ok: false, error: 'action not allowed: ' + action.type + ' (' + allowed.join(',') + ')', events: [] };
    }
    if (action.type === 'attack') {
      var tgt0 = this.unitById(action.targetId);
      var atk0 = acts.filter(function (a) { return a.type === 'attack'; })[0];
      if (!tgt0 || atk0.targets.indexOf(tgt0) < 0) return { ok: false, error: 'invalid target', events: [] };
    }
    if (action.type === 'fortify') {
      var fo0 = acts.filter(function (a) { return a.type === 'fortify'; })[0].options.filter(function (o) { return o.type === action.build; })[0];
      if (!fo0 || !fo0.affordable || !fo0.tiles.some(function (t) { return t.x === action.x && t.y === action.y; })) return { ok: false, error: 'invalid fortify', events: [] };
    }
    if (action.type === 'repair') {
      var rp0 = this.unitById(action.targetId), ra = acts.filter(function (a) { return a.type === 'repair'; })[0];
      if (!rp0 || ra.targets.indexOf(rp0) < 0) return { ok: false, error: 'invalid repair', events: [] };
    }
    if (action.type === 'unload') {
      var opts0 = this.unloadOptions(u, end.x, end.y), seen0 = {};
      var bad = !(action.unloads && action.unloads.length) || action.unloads.some(function (ul) {
        var o = opts0[ul.idx], k = ul.x + ',' + ul.y;
        if (!o || seen0[k] || seen0['i' + ul.idx]) return true;
        seen0[k] = 1; seen0['i' + ul.idx] = 1;
        return !o.tiles.some(function (t) { return t.x === ul.x && t.y === ul.y; });
      });
      if (bad) return { ok: false, error: 'invalid unload', events: [] };
    }
    if (moved) {
      u.fuel -= sim.fuel;
      u.cp = G.RULES.capturePoints;
      events.unshift({ type: 'move', unitId: u.id, path: sim.path });
    }
    var self = this;
    var pl = this.playerBySlot(u.p);
    switch (action.type) {
      case 'join': {
        var tgt = occ, sum = this.dispHp(tgt) + this.dispHp(u), over = Math.max(0, sum - 10);
        var refund = Math.floor(over * this.costOf(u.type, u.p) / 10);
        tgt.hp = Math.min(10, sum) * 10;
        pl.funds += refund;
        tgt.fuel = Math.max(tgt.fuel, u.fuel); tgt.ammo = Math.max(tgt.ammo, u.ammo);
        tgt.moved = true;
        this.removeUnit(u);
        events.push({ type: 'join', unitId: tgt.id, refund: refund, x: tgt.x, y: tgt.y });
        break;
      }
      case 'load': {
        this.units.splice(this.units.indexOf(u), 1);
        u.x = undefined; u.y = undefined; u.moved = true; u.cp = G.RULES.capturePoints;
        occ.cargo.push(u);
        events.push({ type: 'load', unitId: u.id, transportId: occ.id });
        break;
      }
      default: {
        u.x = end.x; u.y = end.y; u.moved = true;
        if (action.type === 'attack') {
          var tg = this.unitById(action.targetId);
          var atkAct = acts.filter(function (a) { return a.type === 'attack'; })[0];
          if (!tg || atkAct.targets.indexOf(tg) < 0) { events.push({ type: 'wait', unitId: u.id }); break; }
          events.push(this.resolveAttack(u, tg));
        } else if (action.type === 'capture') {
          var co = this.coOf(u.p);
          var fac = co && co.capture ? co.capture(this.powerOf(u.p)) : 1;
          u.cp -= Math.floor(this.dispHp(u) * fac);
          var done = u.cp <= 0;
          var prev = this.map.owner[u.y][u.x];
          events.push({ type: 'capture', unitId: u.id, x: u.x, y: u.y, left: Math.max(0, u.cp), done: done, prevOwner: prev, p: u.p });
          if (done) {
            u.cp = G.RULES.capturePoints;
            pl.stats.captured++;
            var wasHQ = this.map.terrain[u.y][u.x] === 'Q';
            this.map.owner[u.y][u.x] = u.p;
            if (wasHQ && prev) {
              this.map.terrain[u.y][u.x] = 'C';
              this.eliminate(prev, u.p, 'hq');
              events.push({ type: 'hqfall', slot: prev, by: u.p });
            }
            if (this.objective.type === 'capture' && this.objective.x === u.x && this.objective.y === u.y) {
              this.objectiveWin(u.p);
              events.push({ type: 'gameover', winner: this.winner, reason: 'capture' });
            }
          }
        } else if (action.type === 'unload') {
          var opts = this.unloadOptions(u, u.x, u.y);
          var used = {};
          var takes = (action.unloads || []).slice().sort(function (a, b) { return b.idx - a.idx; });
          var unloaded = [];
          takes.forEach(function (ul) {
            var o = opts[ul.idx]; if (!o) return;
            var okTile = o.tiles.some(function (t) { return t.x === ul.x && t.y === ul.y; });
            var key = ul.x + ',' + ul.y;
            if (!okTile || used[key]) return;
            var hid = self.unitAt(ul.x, ul.y);
            if (hid) { events.push({ type: 'trap', unitId: u.id, x: u.x, y: u.y, blocker: hid.id, bx: hid.x, by: hid.y, unload: true }); return; }
            used[key] = 1;
            var cg = u.cargo[ul.idx];
            u.cargo.splice(ul.idx, 1);
            cg.x = ul.x; cg.y = ul.y; cg.moved = true;
            self.units.push(cg);
            unloaded.push({ unitId: cg.id, x: ul.x, y: ul.y, fx: u.x, fy: u.y });
          });
          this.touch();
          events.push({ type: 'unload', unitId: u.id, units: unloaded });
        } else if (action.type === 'fortify') {
          var hidden = this.unitAt(action.x, action.y);
          if (hidden) {
            events.push({ type: 'trap', unitId: u.id, x: u.x, y: u.y, blocker: hidden.id, bx: hidden.x, by: hidden.y, unload: true });
          } else {
            var fc = this.costOf(action.build, u.p);
            pl.funds -= fc; pl.stats.built++;
            var st = this.spawn(action.build, action.x, action.y, u.p, 100);
            st.moved = true;
            events.push({ type: 'fortify', unitId: u.id, build: action.build, x: action.x, y: action.y, cost: fc, newId: st.id });
          }
        } else if (action.type === 'repair') {
          var rt0 = this.unitById(action.targetId), disp0 = this.dispHp(rt0), uc = this.costOf(rt0.type, rt0.p);
          var heal = Math.min(2, 10 - disp0);
          while (heal > 0 && pl.funds < Math.floor(heal * uc / 10)) heal--;
          if (heal > 0) { pl.funds -= Math.floor(heal * uc / 10); rt0.hp = Math.min(100, (disp0 + heal) * 10); }
          events.push({ type: 'repair', unitId: rt0.id, amount: heal, x: rt0.x, y: rt0.y, by: u.id });
        } else if (action.type === 'supply') {
          this.supplyTargets(u, u.x, u.y).forEach(function (t) { self.resupply(t); });
          events.push({ type: 'supply', unitId: u.id, x: u.x, y: u.y });
        } else if (action.type === 'dive') {
          u.dived = true; events.push({ type: 'dive', unitId: u.id });
        } else if (action.type === 'surface') {
          u.dived = false; events.push({ type: 'surface', unitId: u.id });
        } else {
          events.push({ type: 'wait', unitId: u.id });
        }
      }
    }
    this.touch();
    this.checkVictory(events);
    return { ok: true, events: events };
  };

  // --------------------------------------------------------------- Produktion
  Game.prototype.buildOptions = function (slot, x, y, viewer) {
    var ter = G.TERRAIN[this.map.terrain[y][x]];
    if (viewer === undefined) viewer = slot;
    var occ = this.unitAt(x, y);
    if (!ter.builds || this.map.owner[y][x] !== slot || (occ && this.unitVisibleTo(occ, viewer))) return [];
    var self = this, pl = this.playerBySlot(slot);
    var allowed = this.meta.banned || [];
    return G.BUILD_LISTS[ter.builds].filter(function (t) { return allowed.indexOf(t) < 0; }).map(function (t) {
      var c = self.costOf(t, slot);
      return { type: t, cost: c, affordable: pl.funds >= c };
    });
  };
  Game.prototype.build = function (slot, type, x, y) {
    if (this.over || this.currentPlayer().slot !== slot) return null;
    var opt = this.buildOptions(slot, x, y).filter(function (o) { return o.type === type; })[0];
    if (!opt || !opt.affordable || this.unitAt(x, y)) return null;
    var pl = this.playerBySlot(slot);
    pl.funds -= opt.cost;
    pl.stats.built++;
    var u = this.spawn(type, x, y, slot, 100);
    u.moved = true;
    return u;
  };

  // --------------------------------------------------------------- Rundenablauf
  Game.prototype.endTurn = function () {
    if (this.over) return [];
    var events = [];
    var n = this.players.length, cur = this.turnIdx;
    for (var k = 1; k <= n; k++) {
      var idx = (cur + k) % n;
      if (this.players[idx].alive) {
        if (idx <= cur) {
          this.day++; events.push({ type: 'day', day: this.day });
          var before = this.weather;
          this.rollWeather(false);
          if (this.weather !== before) events.push({ type: 'weather', weather: this.weather, prev: before });
        }
        this.turnIdx = idx;
        break;
      }
    }
    if (this.objective.type === 'survive' && this.day > this.objective.days && !this.over) {
      this.objectiveWin(this.objective.slot || this.humanSlot());
      events.push({ type: 'gameover', winner: this.winner, reason: 'survive' });
      return events;
    }
    if (this.meta.dayLimit && this.day > this.meta.dayLimit && !this.over) {
      this.decideByScore();
      events.push({ type: 'gameover', winner: this.winner, reason: 'daylimit' });
      return events;
    }
    return events.concat(this.startTurn(false));
  };
  Game.prototype.humanSlot = function () {
    var h = this.players.filter(function (p) { return !p.ai; })[0];
    return h ? h.slot : this.players[0].slot;
  };
  Game.prototype.startTurn = function () {
    var pl = this.currentPlayer(), self = this, events = [];
    pl.powerActive = 0;
    pl.turns++;
    // Treibstoff
    if (pl.turns > 1) {
      var crashed = [];
      this.units.forEach(function (u) {
        if (u.p !== pl.slot) return;
        var T = G.UNITS[u.type];
        var burn = u.dived ? (T.diveFpd || T.fpd) : T.fpd;
        if (!burn) return;
        u.fuel = Math.max(0, u.fuel - burn);
        if (u.fuel <= 0 && (T.domain === 'air' || T.domain === 'sea')) crashed.push(u);
      });
      crashed.forEach(function (u) {
        var ter = self.map.terrain[u.y][u.x];
        if (self.map.owner[u.y][u.x] === pl.slot && G.REPAIRS[ter] === G.UNITS[u.type].domain) return;
        events.push({ type: 'crash', unitId: u.id, unitType: u.type, x: u.x, y: u.y, p: u.p });
        self.destroy(u);
      });
    }
    // Einkommen
    var income = this.incomeOf(pl.slot);
    pl.funds += income;
    events.push({ type: 'income', slot: pl.slot, amount: income });
    // Reparatur & Nachschub auf Gebäuden
    this.units.forEach(function (u) {
      if (u.p !== pl.slot) return;
      var ter = self.map.terrain[u.y][u.x];
      if (self.map.owner[u.y][u.x] !== pl.slot || G.REPAIRS[ter] !== G.UNITS[u.type].domain) return;
      self.resupply(u);
      var disp = self.dispHp(u);
      if (disp >= 10) { u.hp = 100; return; }
      var unitCost = self.costOf(u.type, u.p);
      var heal = Math.min(2, 10 - disp);
      while (heal > 0 && pl.funds < Math.floor(heal * unitCost / 10)) heal--;
      if (heal > 0) {
        pl.funds -= Math.floor(heal * unitCost / 10);
        u.hp = Math.min(100, (disp + heal) * 10);
        events.push({ type: 'repair', unitId: u.id, amount: heal, x: u.x, y: u.y });
      }
    });
    // Träger versorgen ihre Fracht
    this.units.forEach(function (u) {
      if (u.p === pl.slot && G.UNITS[u.type].servicesCargo) (u.cargo || []).forEach(function (c) { self.resupply(c); });
    });
    // Transporter versorgen Nachbarn
    this.units.forEach(function (u) {
      if (u.p !== pl.slot || !G.UNITS[u.type].supplies) return;
      self.supplyTargets(u, u.x, u.y).forEach(function (t) { self.resupply(t); });
    });
    this.units.forEach(function (u) {
      if (u.p === pl.slot) { u.moved = false; (u.cargo || []).forEach(function (c) { c.moved = false; }); }
    });
    this.touch();
    this.checkVictory(events);
    events.push({ type: 'turn', slot: pl.slot, day: this.day });
    return events;
  };

  // --------------------------------------------------------------- Sieg & Niederlage
  Game.prototype.eliminate = function (slot, bySlot, reason) {
    var pl = this.playerBySlot(slot);
    if (!pl || !pl.alive) return;
    pl.alive = false;
    pl.lostReason = reason;
    this.units = this.units.filter(function (u) { return u.p !== slot; });
    for (var y = 0; y < this.map.h; y++) for (var x = 0; x < this.map.w; x++) {
      if (this.map.owner[y][x] === slot) {
        this.map.owner[y][x] = bySlot && reason === 'hq' ? bySlot : 0;
        if (this.map.terrain[y][x] === 'Q') this.map.terrain[y][x] = 'C';
      }
    }
    this.touch();
  };
  /** Punkte für das Tageslimit: Gebäude (je 4000) plus Armeewert */
  Game.prototype.teamScores = function () {
    var self = this, teams = {};
    this.players.forEach(function (p) {
      if (!p.alive) return;
      var sc = self.scoreFor(p.slot);
      var t = teams[p.team] || (teams[p.team] = { team: p.team, props: 0, value: 0, points: 0 });
      t.props += sc.props; t.value += sc.value; t.points += sc.props * 4000 + sc.value;
    });
    return teams;
  };
  /** Tageslimit: Team mit den meisten Punkten gewinnt */
  Game.prototype.decideByScore = function () {
    var teams = this.teamScores(), best = null;
    Object.keys(teams).forEach(function (k) { var t = teams[k]; if (!best || t.points > best.points) best = t; });
    this.over = true;
    this.winner = best ? best.team : null;
  };
  Game.prototype.objectiveWin = function (slot) {
    var pl = this.playerBySlot(slot);
    this.over = true;
    this.winner = pl ? pl.team : null;
  };
  Game.prototype.resign = function (slot) {
    var ev = [{ type: 'eliminated', slot: slot, reason: 'resign' }];
    var wasCurrent = this.currentPlayer().slot === slot;
    this.eliminate(slot, null, 'resign');
    this.checkVictory(ev);
    if (!this.over && wasCurrent) ev = ev.concat(this.endTurn());
    return ev;
  };
  // --------------------------------------------------------------- Netzwerk: Befehle & Prüfsumme
  // --------------------------------------------------------------- Rückgängig (einmal je Runde)
  // Vor jedem Einheiten-/Baubefehl eines Menschen wird der Zustand gesichert. Nicht zurücknehmbar sind Angriffe,
  // Hinterhalte und Züge, die neue Gegner aufgedeckt haben (sonst gäbe es Nebel-Wissen gratis). Kräfte, Rundenende
  // und Aufgabe löschen die Sicherung. Die Sicherung wird nicht gespeichert; players[].undoDay merkt die Nutzung.
  Game.prototype._enemiesSeen = function (slot) {
    var self = this, ids = [];
    this.units.forEach(function (u) { if (self.isEnemy(u.p, slot) && self.unitVisibleTo(u, slot)) ids.push(u.id); });
    return ids;
  };
  Game.prototype._undoBefore = function () {
    var cp = this.currentPlayer();
    if (!cp || cp.ai || this.over) return null;
    return { snap: this.serialize(), slot: cp.slot, seen: this._enemiesSeen(cp.slot) };
  };
  Game.prototype._undoAfter = function (pre, ok, events, forbid, unitId, pos) {
    if (!pre || !ok) return;   // abgelehnter Befehl: eine ältere Sicherung bleibt gültig
    var revealed = (events || []).some(function (e) { return e.type === 'trap'; }) ||
      this._enemiesSeen(pre.slot).some(function (id) { return pre.seen.indexOf(id) < 0; });
    this._undo = (forbid || revealed) ? null : { snap: pre.snap, slot: pre.slot, day: this.day, turnIdx: this.turnIdx, unitId: unitId == null ? null : unitId, pos: pos || null };
  };
  /** Darf `slot` den letzten Zug zurücknehmen? → { ok, reason } */
  Game.prototype.canUndo = function (slot) {
    var cp = this.currentPlayer();
    if (this.over || !cp || cp.slot !== slot) return { ok: false, reason: 'nicht am Zug' };
    if (cp.undoDay === this.day) return { ok: false, reason: 'in dieser Runde schon benutzt' };
    var u = this._undo;
    if (!u || u.slot !== slot || u.day !== this.day || u.turnIdx !== this.turnIdx) return { ok: false, reason: 'nichts zurückzunehmen (Angriffe und aufgedeckte Gegner ausgenommen)' };
    return { ok: true };
  };
  Game.prototype.undo = function (slot) {
    var can = this.canUndo(slot);
    if (!can.ok) return { ok: false, error: 'undo', reason: can.reason, events: [] };
    var d = JSON.parse(this._undo.snap), self = this, unitId = this._undo.unitId, pos = this._undo.pos;
    ['map', 'fog', 'day', 'turnIdx', 'nextId', 'rng', 'objective', 'meta', 'winner', 'over', 'players', 'units', 'weather', 'weatherLeft']
      .forEach(function (k) { self[k] = d[k]; });
    this._undo = null;
    var cp = this.currentPlayer();
    cp.undoDay = this.day;
    this.touch();
    var u = unitId != null ? this.unitById(unitId) : null;
    var at = u && u.x !== undefined ? { x: u.x, y: u.y } : pos;
    return { ok: true, events: [{ type: 'undo', slot: slot, unitId: unitId, x: at ? at.x : undefined, y: at ? at.y : undefined }] };
  };
  (function wrapForUndo() {
    var commit = Game.prototype.commit, build = Game.prototype.build, power = Game.prototype.activatePower, end = Game.prototype.endTurn, resign = Game.prototype.resign;
    Game.prototype.commit = function (unitId, path, action) {
      var pre = this._undoBefore();
      var r = commit.call(this, unitId, path, action);
      this._undoAfter(pre, r && r.ok, r && r.events, !!(action && action.type === 'attack'), unitId, null);
      return r;
    };
    Game.prototype.build = function (slot, type, x, y) {
      var pre = this._undoBefore();
      var b = build.call(this, slot, type, x, y);
      this._undoAfter(pre, !!b, [], false, null, { x: x, y: y });
      return b;
    };
    Game.prototype.activatePower = function () { var r = power.apply(this, arguments); if (r) this._undo = null; return r; };
    Game.prototype.endTurn = function () { this._undo = null; return end.apply(this, arguments); };
    Game.prototype.resign = function () { this._undo = null; return resign.apply(this, arguments); };
  })();

  /**
   * Führt einen serialisierbaren Befehl des Spielers `slot` aus (Server und Clients identisch).
   * cmd: {t:'unit', id, path, action} | {t:'build', type, x, y} | {t:'power', level} | {t:'end'} | {t:'resign'} | {t:'ai', slot} | {t:'undo'}
   */
  Game.prototype.applyCmd = function (slot, cmd) {
    if (!cmd || this.over) return { ok: false, error: 'over' };
    var cp = this.currentPlayer();
    if (cmd.t !== 'ai' && cp.slot !== slot) return { ok: false, error: 'not-your-turn' };
    switch (cmd.t) {
      case 'unit': {
        var u = this.unitById(cmd.id);
        if (!u || u.p !== slot) return { ok: false, error: 'unit' };
        return this.commit(cmd.id, cmd.path, cmd.action);
      }
      case 'build': {
        var b = this.build(slot, cmd.type, cmd.x, cmd.y);
        return b ? { ok: true, events: [{ type: 'build', unitId: b.id, unitType: b.type, x: b.x, y: b.y }] } : { ok: false, error: 'build' };
      }
      case 'power': {
        var ev = this.activatePower(slot, cmd.level);
        return ev ? { ok: true, events: [ev] } : { ok: false, error: 'power' };
      }
      case 'end': return { ok: true, events: this.endTurn() };
      case 'resign': return { ok: true, events: this.resign(slot) };
      case 'undo': return this.undo(slot);
      case 'ai': {
        // Abwesenden Spieler durch die KI ersetzen (nur wenn er gerade am Zug ist)
        var pl = this.playerBySlot(cmd.slot);
        if (!pl || pl.ai || cp.slot !== cmd.slot) return { ok: false, error: 'ai' };
        pl.ai = true; pl.aiLevel = cmd.level || 'normal';
        return { ok: true, events: [{ type: 'aitakeover', slot: cmd.slot }] };
      }
    }
    return { ok: false, error: 'unknown' };
  };
  /** Prüfsumme des spielrelevanten Zustands (ohne Erkundungs-Gedächtnis) */
  Game.prototype.stateHash = function () {
    var self = this;
    var s = JSON.stringify([this.day, this.turnIdx, this.rng, this.weather, this.weatherLeft, this.over, this.winner, this.nextId,
      this.players.map(function (p) { return [p.slot, p.funds, p.power, p.powerUses, p.powerActive, p.alive, p.ai, p.team]; }),
      this.map.owner, this.map.cap || null,
      this.units.map(function (u) { return self._plainUnit(u); })]);
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16);
  };

  Game.prototype.checkVictory = function (events) {
    if (this.over) return;
    var self = this;
    this.players.forEach(function (p) {
      if (!p.alive || !p.hadUnits) return;
      if (self.countUnits(p.slot, true) === 0) {
        self.eliminate(p.slot, null, 'rout');
        if (events) events.push({ type: 'eliminated', slot: p.slot, reason: 'rout' });
      }
    });
    var teams = {};
    this.players.forEach(function (p) { if (p.alive) teams[p.team] = true; });
    var alive = Object.keys(teams);
    if (alive.length <= 1) {
      this.over = true;
      this.winner = alive.length ? Number(alive[0]) : null;
      if (events) events.push({ type: 'gameover', winner: this.winner });
    }
  };

  // --------------------------------------------------------------- Hilfen für UI/KI
  Game.prototype.readyUnits = function (slot) {
    return this.units.filter(function (u) { return u.p === slot && !u.moved; });
  };
  Game.prototype.scoreFor = function (slot) {
    var value = 0;
    this.units.forEach(function (u) {
      if (u.p === slot) {
        value += G.UNITS[u.type].cost * u.hp / 100;
        (u.cargo || []).forEach(function (c) { value += G.UNITS[c.type].cost * c.hp / 100; });
      }
    });
    return { units: this.countUnits(slot), value: Math.round(value), props: this.propertiesOf(slot).length,
      funds: this.playerBySlot(slot).funds };
  };
  G.DIRS = DIRS;
})();
