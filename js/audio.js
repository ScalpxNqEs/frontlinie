// FRONTLINIE – Audio: Soundeffekte und Musik, komplett live per Web Audio API synthetisiert.
// Keine Audiodateien, keine externen Ressourcen. Alle Melodien sind eigenständig für dieses Spiel komponiert.
//
// Aufbau:
//   1. Noten/Akkorde parsen          5. Synthese-Umgebung (Busse, Kompressor, Wellenformen, Rauschen)
//   2. Pattern-Notation & Compiler   6. Stimmen (Ton, Rauschen, Schlagzeug)
//   3. Instrument-Voreinstellungen   7. Soundeffekte
//   4. Musikstücke                   8. Sequencer (Lookahead-Scheduler) + öffentliche API
//
// Pattern-Notation (Melodie/Begleitung, explizit):
//   "@2 C5 E5:2 G5 - . | ..."   @n = Einheit in Ticks (Raster: 16tel bei tpb 4), Ton:n = n Einheiten,
//   "-" = vorherigen Ton verlängern, "." = Pause, "|" = Taktstrich (wird auf Taktlänge geprüft),
//   "A3+C4+E4:4" = Akkord als schnelles Chiptune-Arpeggio.
// Vorlagen (hT/bT) benutzen Stufen statt Tönen und werden auf die Akkordfolge gelegt:
//   R 3 5 7 = Grundton/Terz/Quinte/Septime, C = ganzer Akkord (Arpeggio), A = chromatischer Anlauf zum
//   nächsten Akkord; ' = Oktave höher, , = Oktave tiefer.
// Schlagzeug: ein Zeichen pro Tick, [..] = mehrere Instrumente gleichzeitig:
//   k Kick, s Snare, S Snare laut, g Ghost-Snare, h Hihat, o offene Hihat, z Shaker, x Rimshot,
//   c Becken, t/m/T Toms tief/mittel/hoch, . Pause.
var G = (typeof globalThis!=='undefined'?globalThis:window).G = (globalThis.G||{});
(function () {
  'use strict';
  var ROOT = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : {});
  var DOC = ROOT.document || null;

  // ---------------------------------------------------------------- 1. Noten & Akkorde
  var PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function acc(c) { return c === '#' ? 1 : c === 'b' ? -1 : 0; }
  function parseNote(s) {
    var m = /^([A-G])(#|b)?(-?\d)$/.exec(s);
    return m ? 12 * (+m[3] + 1) + PC[m[1]] + acc(m[2]) : null;
  }
  function parsePc(s) {
    var m = /^([A-G])(#|b)?$/.exec(s);
    return m ? (PC[m[1]] + acc(m[2]) + 12) % 12 : null;
  }
  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function nf(s) { return mtof(parseNote(s)); }

  var QUAL = {
    '': [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11],
    '6': [0, 4, 7, 9], m6: [0, 3, 7, 9], dim: [0, 3, 6], dim7: [0, 3, 6, 9], m7b5: [0, 3, 6, 10],
    aug: [0, 4, 8], sus4: [0, 5, 7], sus2: [0, 2, 7], add9: [0, 4, 7, 14], '5': [0, 7, 12]
  };
  function parseChord(sym) {
    if (sym === 'N') return null;                       // N = kein Akkord (Pause)
    var m = /^([A-G][#b]?)([^\/]*)(?:\/([A-G][#b]?))?$/.exec(sym);
    if (!m || !Object.prototype.hasOwnProperty.call(QUAL, m[2])) throw new Error('unbekannter Akkord "' + sym + '"');
    var root = parsePc(m[1]);
    return { root: root, iv: QUAL[m[2]], bass: m[3] ? parsePc(m[3]) : root, sym: sym };
  }

  // ---------------------------------------------------------------- 2. Pattern-Notation & Compiler
  function parseDeg(s) {
    var m = /^(R|3|5|7|C|A)(['",]*)$/.exec(s);
    if (!m) return null;
    var o = 0;
    for (var i = 0; i < m[2].length; i++) o += m[2][i] === ',' ? -1 : 1;
    return { deg: m[1], oct: o };
  }
  function parsePitch(s) {
    if (s.indexOf('+') >= 0) {
      var ps = s.split('+').map(parseNote);
      return ps.some(function (p) { return p == null; }) ? null : ps;
    }
    return parseNote(s);
  }
  // mode 'n' = Noten, 't' = Stufen-Vorlage
  function parseSeq(str, mode, barT, err) {
    var toks = String(str).replace(/\|/g, ' | ').trim().split(/\s+/);
    var unit = 1, t = 0, lastBar = 0, ev = [], last = null, bar = 1;
    for (var i = 0; i < toks.length; i++) {
      var tok = toks[i];
      if (!tok) continue;
      if (tok === '|') {
        if (t - lastBar !== barT) err('Takt ' + bar + ' hat ' + (t - lastBar) + ' statt ' + barT + ' Ticks');
        lastBar = t; bar++; continue;
      }
      if (tok[0] === '@') { unit = +tok.slice(1); continue; }
      var parts = tok.split(':'), base = parts[0];
      var d = (parts.length > 1 ? parseFloat(parts[1]) : 1) * unit;
      if (!(d > 0) || Math.abs(d - Math.round(d)) > 1e-6) { err('ungültige Dauer "' + tok + '"'); d = 1; }
      d = Math.round(d);
      if (base === '.') last = null;
      else if (base === '-') {
        if (last && last.t + last.d === t) last.d += d; else err('Haltebogen ohne Ton (Takt ' + bar + ')');
      } else {
        var p = mode === 'n' ? parsePitch(base) : parseDeg(base);
        if (p == null) err('unbekanntes Zeichen "' + tok + '" (Takt ' + bar + ')');
        else { last = { t: t, d: d, p: p }; ev.push(last); }
      }
      t += d;
    }
    if (t > lastBar && t - lastBar !== barT) err('letzter Takt hat ' + (t - lastBar) + ' statt ' + barT + ' Ticks');
    return { ev: ev, len: t };
  }
  var DRUMS = 'ksSghozxctmT';
  function parseDrums(str, barT, err) {
    var s = String(str), t = 0, lastBar = 0, ev = [];
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (ch === ' ' || ch === '\n' || ch === '\t') continue;
      if (ch === '|') { if (t - lastBar !== barT) err('Schlagzeug-Takt hat ' + (t - lastBar) + ' statt ' + barT + ' Ticks'); lastBar = t; continue; }
      if (ch === '.') { t++; continue; }
      var k = ch;
      if (ch === '[') { var j = s.indexOf(']', i); if (j < 0) { err('fehlende ]'); break; } k = s.slice(i + 1, j); i = j; }
      for (var q = 0; q < k.length; q++) if (DRUMS.indexOf(k[q]) < 0) err('unbekannte Trommel "' + k[q] + '"');
      ev.push({ t: t, k: k });
      t++;
    }
    if (t > lastBar && t - lastBar !== barT) err('letzter Schlagzeug-Takt hat ' + (t - lastBar) + ' statt ' + barT + ' Ticks');
    return { ev: ev, len: t };
  }
  function parseChords(str, barT, err) {
    var bars = String(str).split('|'), segs = [];
    bars.forEach(function (b, bi) {
      var syms = b.trim().split(/\s+/), n = syms.length;
      if (barT % n) err('Takt ' + (bi + 1) + ': ' + n + ' Akkorde passen nicht ins Raster');
      var L = Math.floor(barT / n);
      syms.forEach(function (sy, k) {
        var c = null;
        try { c = parseChord(sy); } catch (e) { err(e.message); }
        segs.push({ s: bi * barT + k * L, e: bi * barT + (k === n - 1 ? barT : (k + 1) * L), ch: c });
      });
    });
    return { segs: segs, bars: bars.length };
  }
  function lowest(low, pc) { return low + (((pc - low) % 12) + 12) % 12; }
  function resolveDeg(dg, chord, next, isBass, def) {
    var low = isBass ? (def.bassLow || 40) : (def.harmLow || 55);
    var b0 = lowest(low, chord.bass);
    var r0 = isBass ? b0 - ((chord.bass - chord.root + 12) % 12) : lowest(low, chord.root);
    var o = dg.oct * 12, iv = chord.iv;
    switch (dg.deg) {
      case 'R': return (isBass ? b0 : r0) + o;
      case '3': return r0 + iv[1] + o;
      case '5': return r0 + (iv[2] != null ? iv[2] : 7) + o;
      case '7': return r0 + (iv[3] != null ? iv[3] : 12) + o;
      case 'C': return iv.map(function (x) { return r0 + x + o; });
      case 'A':
        if (!next) return b0 - 1 + o;
        var tb = isBass ? lowest(low, next.bass) : lowest(low, next.root);
        var cur = isBass ? b0 : r0;
        return (tb > cur ? tb - 1 : tb + 1) + o;
    }
    return r0;
  }
  var tplCache = {};
  function applyTemplate(tpl, segs, isBass, def, barT, err) {
    var tp = tplCache[tpl + '#' + barT];
    if (!tp) {
      tp = tplCache[tpl + '#' + barT] = parseSeq(tpl, 't', barT, err);
      if (tp.len % barT) err('Vorlage "' + tpl + '" ist keine ganze Taktzahl lang');
    }
    var out = [], TL = tp.len || barT;
    segs.forEach(function (sg, i) {
      if (!sg.ch) return;
      var next = (segs[i + 1] || segs[0]).ch;
      for (var k = Math.floor(sg.s / TL); k * TL < sg.e; k++) {
        var base = k * TL;
        tp.ev.forEach(function (e) {
          var s = Math.max(base + e.t, sg.s), en = Math.min(base + e.t + e.d, sg.e);
          if (s < en) out.push({ t: s, d: en - s, p: resolveDeg(e.p, sg.ch, next, isBass, def) });
        });
      }
    });
    return out;
  }

  // ---------------------------------------------------------------- 3. Instrumente
  // w: Wellenform (p12/p25/p50 = Rechteck 12,5/25/50 %, tri, sine), v: Lautstärke, a/d/s/r: Hüllkurve
  // (d = Zeitkonstante bis Sustain), gate: Anteil der Notenlänge, vib: Vibrato in Cent, arp: Arpeggio-Schritt (s)
  var DEF_INST = {
    lead: { w: 'p25', v: 0.15, a: 0.006, d: 0.25, s: 0.65, r: 0.06, gate: 0.92, vib: 12, vibD: 0.2, vibR: 5.5, fx: 1 },
    harm: { w: 'p12', v: 0.07, a: 0.004, d: 0.12, s: 0.45, r: 0.04, gate: 0.8, vib: 0, arp: 1 / 40, fx: 1 },
    bass: { w: 'tri', v: 0.30, a: 0.004, d: 0.15, s: 0.85, r: 0.035, gate: 0.9, vib: 0 }
  };

  // ---------------------------------------------------------------- 4. Musikstücke
  // Jedes Stück: bpm, tpb (Ticks pro Schlag, Standard 4 = 16tel), bar (Ticks pro Takt, Standard 16 = 4/4),
  // tr (Transposition), swing, echo, inst, Vorlagen hT/bT/drT/fillT, Abschnitte sec, Reihenfolge form.
  var T = {};

  // Titel – heroisch-feierlich (B-Dur)
  T.title = {
    bpm: 112, tr: -2, echo: { beats: 0.75, fb: 0.28, mix: 0.18 },
    inst: { lead: { w: 'p25', v: 0.16, vib: 14 }, harm: { w: 'p50', v: 0.05, gate: 0.8, s: 0.5 } },
    hT: '@2 C:3 C C:2 C:2', bT: "@2 R:2 . R 5:2 R':2",
    drT: 'k.h.s.hhk.h.s.h.', fillT: 'k.h.s.h.ssssmmtt',
    sec: {
      I: { c: 'C | Bb F', m: '@2 G4 . G4 . C5:2 . E5 | F5:3 D5 C5:2 D5:2', dr: 'c...t...t.t.t...|t.s.s.s.ssssSSSS' },
      A: { c: 'C | G/B | Am | Em/G | F | C/E | Dm7 G | C',
        m: '@2 E5:3 D5 C5:2 G4:2 | D5:3 C5 B4:2 G4:2 | C5:2 E5:2 A5:3 G5 | G5:4 . E5 D5 E5 | F5:3 E5 D5:2 C5:2 | G5:3 F5 E5:2 C5:2 | D5:2 F5:2 B4:2 D5:2 | C5:6 .:2' },
      B: { c: 'F | G | Em | Am | F | G | Ab Bb | C',
        m: '@2 A5:3 G5 F5:2 C5:2 | B4:2 D5:2 G5:3 F5 | E5:3 D5 E5:2 G5:2 | A5:2 C6:4 A5:2 | C6:3 A5 F5:2 A5:2 | B5:3 A5 G5:2 D5:2 | C6:2 Eb5:2 D5:2 F5:2 | E5:2 G5:2 C6:4' }
    },
    form: 'I A B'
  };

  // Menü – locker, leicht jazzig (F-Dur)
  T.menu = {
    bpm: 116, echo: { beats: 0.5, fb: 0.25, mix: 0.15 },
    inst: { lead: { w: 'p50', v: 0.13, vib: 10 }, harm: { w: 'p12', v: 0.065, gate: 0.45 } },
    hT: '@2 . C . C . C . C', bT: "@2 R:2 . 5 R' . 5 R",
    drT: 'k.z.s.z.k.zks.zz', fillT: 'k.z.s.z.k.s.ssmt',
    sec: {
      A: { c: 'Fmaj7 | Em7 A7 | Dm7 | Cm7 F7 | Bbmaj7 | Am7 | Gm7 | C7',
        m: '@2 . A4 C5 E5:2 D5 C5 A4 | G4:2 B4 D5 C#5:3 A4 | D5:4 . F5 E5 D5 | C5:2 Eb5 G5 F5:2 Eb5 C5 | D5:3 F5 A5:2 G5 F5 | E5:4 C5:2 . A4 | Bb4:2 D5 F5 E5:2 D5 Bb4 | C5:6 .:2' },
      B: { c: 'Bbmaj7 | C7 | Am7 | Dm7 | Gm7 | C7 | F Dm7 | Gm7 C7',
        m: '@2 F5:2 D5 F5 A5:3 F5 | G5:2 E5 C5 Bb4:4 | A4 C5 E5 G5 E5:2 C5:2 | F5:3 E5 D5:4 | Bb4 D5 G5 Bb5 A5:2 G5:2 | E5:3 G5 Bb5:2 G5 E5 | F5:2 A5:2 C6:2 A5:2 | G5:2 F5 D5 E5:2 C5 .' }
    },
    form: 'A B'
  };

  // Karteneditor – entspannt (D-Dur)
  T.map_editor = {
    bpm: 100, echo: { beats: 0.75, fb: 0.35, mix: 0.25 },
    inst: { lead: { w: 'p25', v: 0.12, vib: 16, vibD: 0.25, a: 0.02 }, harm: { w: 'p12', v: 0.055, gate: 0.6, s: 0.3 }, bass: { v: 0.26 } },
    hT: "@1 R 5 7 3' 5' 3' 7 5 R 5 7 3' 5' 3' 7 5", bT: '@2 R:3 R 5:3 R',
    drT: 'k.z.x.zzk.z.x.z.', fillT: 'k.z.x.zzk.x.xxmt', dv: 0.8,
    sec: {
      A: { c: 'Dmaj7 | Bm7 | Gmaj7 | Asus4 A | Dmaj7 | F#m7 | Gmaj7 | Em7 A',
        m: '@2 F#5:3 E5 C#5:4 | D5:2 B4:2 .:2 F#4 A4 | B4:3 D5 F#5:4 | E5:3 D5 C#5:4 | A5:3 F#5 E5:2 D5 E5 | C#5:4 A4:2 .:2 | B4 D5 F#5 A5 G5:2 F#5 D5 | E5:4 .:2 C#5 E5' },
      B: { c: 'Gmaj7 | F#m7 | Em7 | Dmaj7 | Gmaj7 | F#m7 B7 | Em7 | Asus4 A',
        m: '@2 D5:2 F#5:2 B5:4 | A5:3 F#5 E5:2 C#5:2 | B4:2 D5:2 G5:3 F#5 | F#5:4 .:2 E5 D5 | E5:2 D5:2 B4:2 D5:2 | C#5:3 A4 D#5:3 F#5 | E5:6 B4 D5 | D5:4 C#5:4' }
    },
    form: 'A B'
  };

  // Rika – mutig-optimistisch (G-Dur)
  T.co_rika = {
    bpm: 140, echo: { beats: 0.75, fb: 0.25, mix: 0.15 },
    inst: { lead: { w: 'p25', v: 0.15, vib: 14 }, harm: { w: 'p12', v: 0.055, gate: 0.7, s: 0.4 } },
    hT: "@1 R 5 R' 5 3' 5 R' 5 R 5 R' 5 3' 5 R' 5", bT: "@2 R R R' R R R R' R",
    drT: 'k.h.s.h.k.khs.h.', fillT: 'k.h.s.h.s.ssmmtt',
    sec: {
      A: { c: 'G | D/F# | Em | C D | G | Bm | C | D',
        m: '@2 D5 . G5:2 B5:2 A5 G5 | A5:3 F#5 D5:4 | E5 G5 B5:2 A5 G5 E5:2 | G5:3 E5 F#5:4 | D5 . G5:2 B5:2 D6:2 | D6:3 B5 F#5:4 | E5 G5 C6:2 B5 A5 G5:2 | A5:6 . D5' },
      B: { c: 'C | D | Bm | Em | C | D | Eb F | G',
        m: '@2 E5:2 G5:2 C6:3 B5 | A5:2 F#5:2 D5:4 | F#5 . F#5 G5 A5:2 B5:2 | G5:6 E5 F#5 | G5:2 E5 C5 G5:2 A5 B5 | C6:2 B5 A5 F#5:2 D5:2 | G5:2 Bb5:2 A5:2 C6:2 | B5:4 G5:2 D5:2' },
      C: { c: 'Em | C | G | D | Em | C | Am7 | D7', drT: 'k...s...k.k.s...',
        m: '@2 B4:3 E5 G5:4 | G5:3 E5 C5:4 | D5:3 G5 B5:4 | A5:6 F#5 A5 | B5:3 G5 E5:2 B4:2 | C5:2 E5:2 G5:2 C6:2 | B5:3 A5 G5:2 E5:2 | F#5:2 A5:2 C6:2 D6:2' }
    },
    form: 'A B C'
  };

  // Bastian – rockig, vorwärtsdrängend (e-Moll, Powerchords)
  T.co_bastian = {
    bpm: 152, echo: false,
    inst: { lead: { w: 'p25', v: 0.15, vib: 8, gate: 0.85 }, harm: { w: 'p12', v: 0.065, gate: 0.55, s: 0.6 }, bass: { gate: 0.7, v: 0.32 } },
    hT: '@2 C C C C C C C C', bT: "@2 R R R R R R R' R",
    drT: 'k.h.s.hkk.khs.h.', fillT: 'k.s.sssmmmttttc.',
    sec: {
      A: { c: 'E5 | E5 | G5 A5 | E5 | E5 | E5 | C5 D5 | B5',
        m: '@2 E4 E4 G4 E4 A4 E4 Bb4 A4 | E4 E4 G4 E4 D5:2 B4:2 | G4:2 B4 D5 A4:2 C#5 E5 | E5:6 D5 B4 | E4 E4 G4 E4 A4 E4 Bb4 A4 | E4 E4 G4 E4 G5:2 E5:2 | C5:2 E5 G5 D5:2 F#5 A5 | B5:4 A5 F#5 D#5 B4' },
      B: { c: 'C5 | D5 | E5 | E5 | C5 | D5 | B5 | B5',
        m: '@2 G5:3 E5 G5:2 A5:2 | F#5:3 D5 A5:4 | B5:6 A5 G5 | E5:4 .:2 E5 F#5 | G5:3 A5 B5:2 C6:2 | D6:3 C6 B5:2 A5:2 | B5:2 F#5:2 D#5:2 F#5:2 | B5:6 .:2' },
      C: { c: 'A5 | A5 | C5 | C5 | A5 | A5 | B5 | B5', drT: 'k.h.s.h.k.h.s.hh',
        m: '@2 A4 . A4 C5 . A4 D5 C5 | A4 . A4 C5 . E5 D5 C5 | C5 . C5 E5 . C5 F#5 E5 | C5 . C5 E5 . G5 F#5 E5 | A5:2 G5 E5 A5:2 G5 E5 | C6:2 B5 A5 G5 A5 E5 . | F#5:3 D#5 B4:2 D#5:2 | F#5:2 G5:2 A5:2 B5:2' }
    },
    form: 'A B C'
  };

  // Jara – tüftelnd und präzise, Arpeggios (a-Moll)
  T.co_jara = {
    bpm: 126, echo: { beats: 0.5, fb: 0.3, mix: 0.18 },
    inst: { lead: { w: 'p25', v: 0.14, gate: 0.75, vib: 6, vibD: 0.3 }, harm: { w: 'p12', v: 0.065, gate: 0.6, s: 0.5 }, bass: { gate: 0.55 } },
    hT: "@1 R 3 5 R' 5 3 R 3 R 3 5 R' 3' R' 5 3", bT: "@2 R . R' . 5 . R' .",
    drT: 'k.hhs.hhk.hhs.hx', fillT: 'k.hhs.hhkxxxsxxx',
    sec: {
      A: { c: 'Am | Fmaj7 | Dm7 | E7 | Am | Fmaj7 | Bm7b5 | E7',
        m: '@1 E5:2 A5:2 E5:2 C5:2 B4 C5 D5 E5 C5:4 | A4:2 C5:2 F5:2 E5:2 C5:4 .:4 | F5 E5 D5 E5 F5:2 A5:2 G5:2 F5:2 E5:2 D5:2 | G#5:4 B5:2 G#5:2 E5:4 D5:2 B4:2 | C6:2 B5 A5 G#5:2 A5:2 E5:2 C5:2 A4:4 | F5:2 A5:2 C6:2 E6:2 C6:4 A5:4 | D6:2 B5 A5 F5:2 D5:2 B4:4 .:4 | E5 F5 E5 D5 C5:2 B4:2 G#4:4 B4:4' },
      B: { c: 'C | G/B | Am7 | Em7 | F | C/E | Dm7 | Esus4 E7',
        m: '@1 G5 . E5 . C5 . E5 . G5 . C6 . G5:4 | F5 . D5 . B4 . D5 . G5 . B5 . G5:4 | E5 . C5 . A4 . C5 . E5 . A5 . G5:4 | B4:4 D5:4 E5:4 G5:4 | A5:2 G5:2 F5:2 C5:2 A5:2 G5:2 F5:4 | G5:2 F5:2 E5:2 C5:2 G5:2 F5:2 E5:4 | D5 E5 F5 G5 A5 G5 F5 E5 D5:4 F5:4 | A5:4 E5:4 G#5:4 B5:4' }
    },
    form: 'A B A'
  };

  // Viktor – marschartig und schwer (c-Moll, punktierte Rhythmen)
  T.co_viktor = {
    bpm: 104, bassLow: 43, echo: { beats: 1, fb: 0.2, mix: 0.12 },
    inst: { lead: { w: 'p50', v: 0.14, vib: 10, gate: 0.88 }, harm: { w: 'p25', v: 0.07, gate: 0.6, s: 0.5 }, bass: { v: 0.34, gate: 0.6 } },
    hT: '@2 . . C . . . C .', bT: '@2 R . 5, . R . 5, .',
    drT: 'k..gs.gsk.k.s.gg', fillT: 'S.ssS.ssSsssssss',
    sec: {
      A: { c: 'Cm | Ab | Fm | G | Cm | Ab | Db | G',
        m: '@1 C5:3 C5 C5:4 Eb5:4 G5:4 | Ab5:6 G5:2 F5:4 Eb5:4 | C5:3 C5 F5:4 Ab5:4 F5:4 | G5:8 D5:4 B4:4 | C5:3 C5 C5:4 Eb5:3 Eb5 G5:4 | C6:6 Bb5:2 Ab5:4 Eb5:4 | F5:3 Ab5 Db6:8 C6:4 | B5:8 G5:4 D5:4' },
      B: { c: 'Fm | Cm | Fm | Cm | Ab | Eb | Db G | Cm',
        m: '@1 Ab4:3 Ab4 C5:4 F5:8 | G5:6 F5:2 Eb5:4 C5:4 | Ab5:3 Ab5 Ab5:4 G5:4 F5:4 | G5:12 .:4 | Eb5:3 Eb5 Ab5:4 C6:4 Ab5:4 | Bb5:6 G5:2 Eb5:8 | F5:4 Ab5:4 G5:4 B4:4 | C5:12 G4:2 G4:2' }
    },
    form: 'A B'
  };

  // Fortuna – jazzig-verspielt mit Swing (F-Dur, Walking Bass)
  T.co_fortuna = {
    bpm: 138, swing: 0.33, swingT: 2, echo: { beats: 0.5, fb: 0.2, mix: 0.12 },
    inst: { lead: { w: 'p50', v: 0.13, vib: 18, vibD: 0.15, gate: 0.9 }, harm: { w: 'p25', v: 0.055, gate: 0.5, s: 0.5 }, bass: { gate: 0.85 } },
    hT: '@2 C:2 . C . . C .', bT: '@2 R:2 3:2 5:2 A:2',
    drT: '[kh]...[xh].h.[kh]...[xh].h.', fillT: '[kh]...[xh].gg[kh].g.sgSS', dv: 0.85,
    sec: {
      A: { c: 'Fmaj7 | D7 | Gm7 | C7 | Am7 D7 | Gm7 C7 | F6 | Gm7 C7',
        m: '@2 A4 C5 E5 G5 A5:2 . F5 | F#5:3 E5 D5 C5 A4:2 | Bb4 D5 F5 A5 G5 F5 D5 Bb4 | Db5 . E5:2 G5 Bb5 . G5 | C5:2 E5 G5 F#5:2 A5 C6 | Bb5:2 A5 G5 E5:2 G5 Bb4 | A4:2 D5:2 C5 . A4 F4 | .:2 G4 A4 Bb4 B4 C5 .' },
      B: { c: 'Am7 | D7 | Gm7 | C7 | Bbmaj7 | Bbm6 | Am7 D7 | Gm7 C7',
        m: '@2 E5:3 G5 C6:2 B5 A5 | F#5:3 A5 D6:2 C6 A5 | Bb5:2 A5 G5 F5 D5 Bb4 D5 | E5:4 . G5 Bb5 G5 | A5:3 F5 D5:2 F5 A5 | G5:3 Db5 F5:2 . Db5 | C5 E5 G5 E5 F#5 A5 C6 A5 | Bb5:2 G5:2 E5 G5 Bb4 C5' }
    },
    form: 'A B A'
  };

  // Mira – luftig und schnell (D-Lydisch)
  T.co_mira = {
    bpm: 160, echo: { beats: 0.75, fb: 0.35, mix: 0.2 },
    inst: { lead: { w: 'p50', v: 0.12, vib: 16, vibD: 0.12, a: 0.01 }, harm: { w: 'p12', v: 0.055, gate: 0.6, s: 0.4 }, bass: { v: 0.28, gate: 0.8 } },
    hT: "@1 R 3 5 R' 3' 5' R' 5' 3' R' 5 3 R 3 5 R'", bT: '@2 R:3 R:3 5:2',
    drT: 'kzhzszhzkzhzszhh', fillT: 'kzhzszhzTTmmttc.', dv: 0.85,
    sec: {
      A: { c: 'D | E/D | D | E/D | Bm7 | G | Em7 | Asus4 A',
        m: '@2 A5:3 F#5 D6:4 | G#5:3 E5 B5:4 | A5 B5 C#6 D6 E6:2 D6 A5 | B5:6 G#5 B5 | D6:3 C#6 B5:2 F#5:2 | G5 A5 B5 D6 B5:4 | E6:3 D6 B5:2 G5:2 | D6:4 C#6:4' },
      B: { c: 'G | A | F#m | Bm | G | A | Bm A/C# | D',
        m: '@2 D6:3 B5 G5:4 | E6:3 C#6 A5:4 | F#5 A5 C#6 F#6 E6:4 | D6:6 C#6 B5 | B5:3 A5 G5:2 B5:2 | C#6:3 B5 A5:2 E6:2 | D6:2 F#6:2 E6:2 C#6:2 | D6:6 .:2' }
    },
    form: 'A B A'
  };

  // Ole – maritim im 6/8 (G-Dur, Tempo in punktierten Vierteln)
  T.co_ole = {
    bpm: 100, tpb: 6, bar: 12, echo: { beats: 0.5, fb: 0.3, mix: 0.18 },
    inst: { lead: { w: 'p25', v: 0.14, vib: 20, vibD: 0.15, vibR: 5 }, harm: { w: 'p50', v: 0.05, gate: 0.55, s: 0.6 }, bass: { gate: 0.8 } },
    hT: '@2 . C C . C C', bT: "@2 R:2 5 R':2 5",
    drT: 'k.h.h.s.h.h.', fillT: 'k.h.h.s.TmTt',
    sec: {
      A: { c: 'G | C/G | G | D | Em | C | Am D | G',
        m: '@2 D5:2 G5 B5:2 G5 | C6:2 B5 A5:2 G5 | B5:2 G5 D5:2 B4 | A4:2 D5 F#5:2 A5 | G5:2 E5 B5:2 G5 | E5:2 C5 G5:2 E5 | C5:2 E5 D5:2 F#5 | G5:3 .:2 D5' },
      B: { c: 'C | D | Bm | Em | C | D | G/B C | D',
        m: '@2 E5:2 G5 C6:3 | D6:2 C6 A5:3 | B5:2 A5 F#5:2 D5 | E5:3 G5:2 B5 | C6:2 B5 A5 G5 E5 | F#5:2 A5 D6:3 | B5:2 G5 E5:2 G5 | A5:3 .:2 D5' },
      C: { c: 'Em | C | D | Bm | Em | C | Am B7 | Em D',
        m: '@2 B4:2 E5 G5:2 E5 | C6:3 B5:2 G5 | A5:2 F#5 D5:2 F#5 | B5:5 F#5 | G5:2 F#5 E5:2 B4 | C5:2 E5 G5:2 C6 | A5:2 E5 D#5:2 F#5 | E5:3 F#5:2 A5' }
    },
    form: 'A B C A'
  };

  // Kurt – fröhlicher Marsch (F-Dur, Humpta)
  T.co_kurt = {
    bpm: 128, bassLow: 45, echo: false,
    inst: { lead: { w: 'p25', v: 0.15, vib: 10, gate: 0.8 }, harm: { w: 'p50', v: 0.055, gate: 0.45, s: 0.6 }, bass: { gate: 0.5, v: 0.32 } },
    hT: '@2 . . C . . . C .', bT: '@2 R . . . 5, . . .',
    drT: 'k...s.g.k...s.gg', fillT: 'k.ssS.ssk.ssSSSS',
    sec: {
      A: { c: 'F | C7 | F | Bb | F | C7 | F C7 | F',
        m: '@2 C5 A4 C5 F5 A5:2 F5:2 | G5:2 E5 G5 Bb5:2 G5:2 | A5 G5 F5 A5 C6:2 A5:2 | D6:3 C6 Bb5:2 F5:2 | C5 A4 C5 F5 A5:2 C6:2 | Bb5 A5 G5 A5 Bb5:2 E5:2 | F5:2 A5:2 G5:2 E5:2 | F5:2 C5:2 F5:2 .:2' },
      B: { c: 'Bb | F | C7 | F | Bb | F | G7 | C7',
        m: '@2 D5:3 F5 Bb5:4 | A5:3 F5 C5:4 | E5 F5 G5 A5 Bb5:2 G5:2 | A5:6 .:2 | D6:3 C6 Bb5 A5 G5 F5 | F5:3 A5 C6:4 | B5:2 G5:2 D5:2 F5:2 | E5:2 G5:2 C6:2 Bb5:2' }
    },
    form: 'A B A'
  };

  // Greta – geheimnisvoll (d-Moll, harmonisch Moll, viel Echo)
  T.co_greta = {
    bpm: 108, echo: { beats: 0.75, fb: 0.45, mix: 0.3 },
    inst: { lead: { w: 'p50', v: 0.12, vib: 22, vibD: 0.3, vibR: 4.5, a: 0.03 }, harm: { w: 'p12', v: 0.055, gate: 0.7, s: 0.3 }, bass: { v: 0.3 } },
    hT: "@2 R 5 R' 3' 5' 3' R' 5", bT: '@2 R:4 R:2 5,:2',
    drT: 'k.....x...k.x..z', fillT: 'k.....x...k.xTmt', dv: 0.8,
    sec: {
      A: { c: 'Dm | Bb/D | Dm | A/C# | Gm | Dm/F | Em7b5 | A7',
        m: '@2 A4:3 D5 F5:2 E5 D5 | F5:4 .:2 E5 F5 | G5 F5 E5 D5 A5:4 | E5:3 C#5 A4:4 | Bb4:3 D5 G5:2 F5 Eb5 | D5:4 F5:2 A5:2 | G5:3 Bb5 E5:4 | C#5:3 E5 G5:2 Bb5:2' },
      B: { c: 'Bb | Gm | Dm | A | Bb | Gm | Eb | A7',
        m: '@2 D6:3 C6 Bb5:2 F5:2 | G5:3 A5 Bb5:4 | A5:3 F5 D5:4 | C#5:2 E5:2 A5:4 | F5:3 G5 A5:2 Bb5:2 | D6:4 Bb5:2 G5:2 | G5:3 Bb5 Eb6:4 | C#6:3 Bb5 G5:2 E5:2' }
    },
    form: 'A B'
  };

  // Marschall Krähe – bedrohlich, Moll mit Halbtonschritten (e-Phrygisch)
  T.co_kraehe = {
    bpm: 112, echo: { beats: 0.5, fb: 0.35, mix: 0.18 },
    inst: { lead: { w: 'p25', v: 0.15, vib: 12, vibD: 0.2, vibR: 6.5 }, harm: { w: 'p12', v: 0.05, gate: 0.9, s: 0.7 }, bass: { v: 0.34, gate: 0.75 } },
    hT: '@1 R 3 R 3 R 3 R 3 5 3 5 3 5 3 5 3', bT: "@2 R R R R R R R' R",
    drT: 'k..t..k.s..t..k.', fillT: 'k..t..k.s.ttmmTT',
    sec: {
      A: { c: 'Em | F | Em | F | Em | F | C | B',
        m: '@2 E4:2 . E4 F4:2 E4:2 | C5:3 B4 A4:2 F4:2 | G4:2 . G4 F#4:2 E4:2 | F4:3 A4 C5:2 B4:2 | E5:2 . E5 F5:2 E5:2 | C6:3 B5 A5:2 F5:2 | G5:3 F5 E5:2 C5:2 | D#5:3 E5 F5:2 D#5:2' },
      B: { c: 'Am | Bb | Am | Bb | G | Ab | F | B',
        m: '@2 A4:3 C5 E5:2 F5:2 | F5:4 D5:2 Bb4:2 | C5:3 B4 A4:2 G#4:2 | Bb4:6 A4:2 | G4:2 B4:2 D5:2 F5:2 | Eb5:3 C5 Ab4:4 | A4:2 C5:2 F5:3 E5 | D#5:2 F#5:2 B5:2 C6:2' }
    },
    form: 'A B'
  };

  // CO-Kraft aktiv – kurzer, intensiver Loop (c-Moll)
  T.power = {
    bpm: 156, echo: false,
    inst: { lead: { w: 'p25', v: 0.13, gate: 0.8, vib: 0 }, harm: { w: 'p12', v: 0.065, gate: 0.55, s: 0.6 }, bass: { gate: 0.6, v: 0.32 } },
    hT: '@2 C C C C C C C C', bT: "@1 R R R' R R R R' R R R R' R R R R' R",
    drT: 'k.hhs.hhk.khs.hh', fillT: 'SSSSssssmmmmtttt',
    sec: {
      A: { c: 'Cm | Ab | Bb | G | Cm | Ab | Bb | G',
        m: '@1 C5 Eb5 G5 C6 G5 Eb5 C5 Eb5 G5 C6 Eb6 C6 G5 Eb5 C5 G4 | Ab4 C5 Eb5 Ab5 Eb5 C5 Ab4 C5 Eb5 Ab5 C6 Ab5 Eb5 C5 Ab4 Eb4 | Bb4 D5 F5 Bb5 F5 D5 Bb4 D5 F5 Bb5 D6 Bb5 F5 D5 Bb4 F4 | G4 B4 D5 G5 D5 B4 G4 B4 D5 G5 B5 G5 F5 D5 B4 G4 | G5:4 C6:4 Eb6:6 D6:2 | C6:4 Ab5:4 Eb5:8 | D6:4 F6:4 Bb5:6 C6:2 | B5:4 G5:4 D6:4 B5:4' }
    },
    form: 'A'
  };

  // Sieg – Fanfare, einmalig (D-Dur)
  T.victory = {
    bpm: 132, tr: 2, loop: false, echo: { beats: 0.5, fb: 0.3, mix: 0.2 },
    inst: { lead: { w: 'p25', v: 0.16, vib: 16 }, harm: { w: 'p50', v: 0.08, vib: 10, s: 0.6 } },
    sec: {
      A: { c: 'C | F | G | C | N',
        m: '@2 G4 . C5 E5 G5:3 E5 | F5:2 A5:2 C6:3 A5 | B5:2 D6:2 G5 A5 B5 D6 | C6:8 | .:8',
        h: '@2 E4 . G4 C5 E5:3 C5 | C5:2 F5:2 A5:3 F5 | G5:2 B5:2 D5 F5 G5 B5 | E5:8 | .:8',
        b: '@2 C3:2 C3 C3 G2:4 | F2:2 F2 F2 C3:4 | G2:2 G2 G2 D3:2 G2:2 | C3:8 | .:8',
        dr: 'c...s.s.k...s.s.|k...s.s.k...s.ss|k...s.s.ssssSSSS|[kc]...............|................' }
    },
    form: 'A'
  };

  // Niederlage – traurig, einmalig (a-Moll)
  T.defeat = {
    bpm: 100, loop: false, echo: { beats: 0.75, fb: 0.4, mix: 0.25 },
    inst: { lead: { w: 'p50', v: 0.13, vib: 20, vibD: 0.2, vibR: 4.5, a: 0.02 }, harm: { w: 'p12', v: 0.055, s: 0.5 } },
    hT: '@2 C:8', bT: '@2 R:8',
    sec: {
      A: { c: 'Am | F | Dm E | Am | N',
        m: '@2 E5:3 D5 C5:2 B4:2 | A4:4 C5:2 B4 A4 | F4:2 A4:2 G#4:3 B4 | A4:8 | .:8',
        dr: 't...............|t...............|t.......t.......|[tc]...............|................' }
    },
    form: 'A'
  };

  // Briefing – Dialogszenen der Kampagne, zurückhaltend (e-Moll)
  T.briefing = {
    bpm: 100, echo: { beats: 0.75, fb: 0.35, mix: 0.22 },
    inst: { lead: { w: 'p50', v: 0.1, vib: 14, vibD: 0.3, a: 0.03 }, harm: { w: 'p12', v: 0.05, gate: 0.8, s: 0.35 }, bass: { v: 0.24 } },
    hT: "@2 R 5 7 3' R 5 7 3'", bT: '@2 R:4 R:2 5,:2',
    drT: 'k...x.....k.x...', fillT: 'k...x.....k.x.xx', dv: 0.6,
    sec: {
      A: { c: 'Em | Cmaj7 | G | D/F# | Em | Cmaj7 | Am7 | Bsus4 B',
        m: '@2 B4:6 G4 A4 | B4:4 E5:4 | D5:6 B4 D5 | A4:8 | G4:3 A4 B4:4 | E5:3 D5 B4:4 | C5:3 B4 A4:2 G4:2 | E4:4 D#4:4' },
      B: { c: 'Cmaj7 | D | Bm7 | Em | Am7 | D | Gmaj7 | Bsus4 B',
        m: '@2 G4:3 B4 E5:4 | F#5:3 E5 D5:4 | D5:2 F#5:2 A5:4 | G5:6 F#5 E5 | E5:4 C5:4 | D5:3 E5 F#5:4 | B5:4 F#5:2 D5:2 | E5:4 D#5:4' }
    },
    form: 'A B'
  };

  var TRACK_NAMES = ['title', 'menu', 'map_editor', 'co_rika', 'co_bastian', 'co_jara', 'co_viktor', 'co_fortuna',
    'co_mira', 'co_ole', 'co_kurt', 'co_greta', 'co_kraehe', 'power', 'victory', 'defeat', 'briefing'];

  // ---- Compiler: Stück → sortierte Ereignisliste in Ticks
  function tickTime(c, tick) {
    var s = c.swing;
    if (!s) return tick * c.tickSec;
    var u = c.swingT, p = tick % (2 * u), base = tick - p;
    var x = p <= u ? p * (1 + s) : u * (1 + s) + (p - u) * (1 - s);
    return (base + x) * c.tickSec;
  }
  var compiled = {};
  function compile(name) {
    if (compiled[name]) return compiled[name];
    var def = T[name], errors = [];
    if (!def) return null;
    var tpb = def.tpb || 4, barT = def.bar || tpb * 4, tr = def.tr || 0;
    var ev = [], pos = 0, bars = 0, chords = [];
    var inst = {};
    ['lead', 'harm', 'bass'].forEach(function (ch) {
      inst[ch] = Object.assign({}, DEF_INST[ch], (def.inst && def.inst[ch]) || {});
    });
    String(def.form).trim().split(/\s+/).forEach(function (sn) {
      var sec = def.sec[sn];
      var err = function (m) { errors.push(name + '/' + sn + ': ' + m); };
      if (!sec) { err('Abschnitt fehlt'); return; }
      var ch = parseChords(sec.c, barT, err), L = ch.bars * barT;
      [['lead', 'm', null], ['harm', 'h', 'hT'], ['bass', 'b', 'bT']].forEach(function (cfg) {
        var chan = cfg[0], ex = sec[cfg[1]], notes = [];
        var cerr = function (m) { err(chan + ': ' + m); };
        if (ex != null) {
          var r = parseSeq(ex, 'n', barT, cerr);
          if (r.len !== L) cerr('Länge ' + r.len + ' statt ' + L + ' Ticks');
          notes = r.ev;
        } else if (cfg[2]) {
          var tpl = sec[cfg[2]] !== undefined ? sec[cfg[2]] : def[cfg[2]];
          if (tpl) notes = applyTemplate(tpl, ch.segs, chan === 'bass', def, barT, cerr);
        }
        notes.forEach(function (n) {
          var p = Array.isArray(n.p) ? n.p.map(function (x) { return x + tr; }) : n.p + tr;
          var lo = Array.isArray(p) ? Math.min.apply(null, p) : p, hi = Array.isArray(p) ? Math.max.apply(null, p) : p;
          if (lo < 28 || hi > 100) cerr('Ton außerhalb des Bereichs (' + lo + '–' + hi + ')');
          ev.push({ t: pos + n.t, d: n.d, ch: chan, p: p });
        });
      });
      var dr;
      if (sec.dr != null) {
        dr = parseDrums(sec.dr, barT, function (m) { err('dr: ' + m); });
        if (dr.len !== L) err('dr: Länge ' + dr.len + ' statt ' + L);
        dr = dr.ev;
      } else {
        dr = [];
        var main = sec.drT !== undefined ? sec.drT : def.drT;
        var fill = sec.fillT !== undefined ? sec.fillT : def.fillT;
        for (var b = 0; b < ch.bars; b++) {
          var pat = (b === ch.bars - 1 && fill) ? fill : main;
          if (!pat) continue;
          var pr = parseDrums(pat, barT, function (m) { err('drT: ' + m); });
          if (pr.len !== barT) err('Schlagzeug-Vorlage "' + pat + '" hat ' + pr.len + ' Ticks');
          pr.ev.forEach(function (e) { dr.push({ t: b * barT + e.t, k: e.k }); });
        }
      }
      dr.forEach(function (e) { ev.push({ t: pos + e.t, d: 1, ch: 'dr', k: e.k }); });
      ch.segs.forEach(function (sg) { if (sg.ch) chords.push({ s: pos + sg.s, e: pos + sg.e, pcs: sg.ch.iv.map(function (x) { return (sg.ch.root + x + tr + 1200) % 12; }), sym: sg.ch.sym }); });
      pos += L; bars += ch.bars;
    });
    var ORD = { bass: 0, dr: 1, harm: 2, lead: 3 };
    ev.sort(function (a, b) { return a.t - b.t || ORD[a.ch] - ORD[b.ch]; });
    var c = {
      name: name, ev: ev, len: pos, bars: bars, tickSec: 60 / def.bpm / tpb, swing: def.swing || 0,
      swingT: def.swingT || 2, loop: def.loop !== false, echo: def.echo || null, inst: inst,
      dv: def.dv || 1, bpm: def.bpm, chords: chords,
      errors: errors.filter(function (x, i) { return errors.indexOf(x) === i; })
    };
    c.loopSec = tickTime(c, pos);
    compiled[name] = c;
    return c;
  }

  // ---------------------------------------------------------------- 5. Synthese-Umgebung
  var MUSIC_LVL = 0.5, SFX_LVL = 0.9;
  function pulseWave(ac, duty) {
    var N = 64, re = new Float32Array(N), im = new Float32Array(N);
    for (var n = 1; n < N; n++) re[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty);
    return ac.createPeriodicWave(re, im);
  }
  function noiseBuffer(ac, metal) {
    var sr = ac.sampleRate, len = metal ? Math.floor(sr * 0.5) : sr * 2;
    var buf = ac.createBuffer(1, len, sr), d = buf.getChannelData(0);
    if (metal) {
      // NES-artiges Kurzzyklus-Rauschen (15-Bit-LFSR, Abgriff Bit 6) → metallisch, leicht tonal
      var reg = 1, step = Math.max(1, Math.round(sr / 9000)), v = 0;
      for (var i = 0; i < len; i++) {
        if (i % step === 0) { var bit = (reg ^ (reg >> 6)) & 1; reg = (reg >> 1) | (bit << 14); v = (reg & 1) ? 0.8 : -0.8; }
        d[i] = v;
      }
    } else {
      var seed = 22222;
      for (var j = 0; j < len; j++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; d[j] = (seed / 0x3fffffff) - 1; }
    }
    return buf;
  }
  function softClipCurve() {
    var n = 2048, c = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var x = (i / (n - 1)) * 2 - 1, ax = Math.abs(x);
      var y = ax <= 0.7 ? ax : 0.7 + 0.28 * Math.tanh((ax - 0.7) / 0.28);
      c[i] = x < 0 ? -y : y;
    }
    return c;
  }
  function buildEnv(ac) {
    var E = { ac: ac };
    E.waves = { p12: pulseWave(ac, 0.125), p25: pulseWave(ac, 0.25), p50: pulseWave(ac, 0.5) };
    E.white = noiseBuffer(ac, false);
    E.metal = noiseBuffer(ac, true);
    E.master = ac.createGain();
    E.comp = ac.createDynamicsCompressor();
    E.comp.threshold.value = -10; E.comp.knee.value = 8; E.comp.ratio.value = 3;
    E.comp.attack.value = 0.003; E.comp.release.value = 0.25;
    E.clip = ac.createWaveShaper(); E.clip.curve = softClipCurve(); E.clip.oversample = '2x';
    E.music = ac.createGain(); E.duck = ac.createGain(); E.sfx = ac.createGain();
    E.music.connect(E.duck); E.duck.connect(E.master); E.sfx.connect(E.master);
    E.master.connect(E.comp); E.comp.connect(E.clip); E.clip.connect(ac.destination);
    return E;
  }

  // ---------------------------------------------------------------- 6. Stimmen
  function mkOsc(E, w) {
    var o = E.ac.createOscillator();
    if (w === 'tri') o.type = 'triangle';
    else if (w === 'sine') o.type = 'sine';
    else if (w === 'saw') o.type = 'sawtooth';
    else o.setPeriodicWave(E.waves[w] || E.waves.p50);
    return o;
  }
  // Hüllkurve: Anstieg a → Abfall Richtung Sustain (Zeitkonstante d) → Release ab te. Gibt Stopp-Zeit zurück.
  function ampEnv(gp, o, t, te) {
    var v = o.v, a = o.a || 0.003, s = o.s == null ? 1 : o.s, r = o.r || 0.03;
    gp.setValueAtTime(0, t);
    gp.linearRampToValueAtTime(v, t + a);
    if (s < 1) gp.setTargetAtTime(v * s, t + a, o.d || 0.08);
    gp.setTargetAtTime(0, te, r / 4);
    return te + r * 1.6 + 0.01;
  }
  function amStage(E, o, t, end) {
    var am = E.ac.createGain(), l = E.ac.createOscillator(), lg = E.ac.createGain();
    var depth = Math.min(0.5, o.amD || 0.4);
    am.gain.value = 1 - depth; lg.gain.value = depth;
    l.type = o.amW || 'square'; l.frequency.value = o.am;
    l.connect(lg); lg.connect(am.gain); l.start(t); l.stop(end);
    return am;
  }
  // Ton: w, f (Hz) | seq (Hz-Liste fürs Arpeggio) + step, f2 (Glissando-Ziel), t, dur, v, a, d, s, r, vib, vibD, vibR, det, am
  function voice(E, dest, o, dest2) {
    var ac = E.ac, t = o.t, a = o.a || 0.003;
    var te = Math.max(t + a + 0.003, t + o.dur);
    var osc = mkOsc(E, o.w), g = ac.createGain(), fq = osc.frequency;
    if (o.seq) {
      var st = o.step || 1 / 40, i = 0;
      for (var x = t; x < te + (o.r || 0.03) * 1.6; x += st, i++) fq.setValueAtTime(o.seq[i % o.seq.length], x);
    } else {
      fq.setValueAtTime(o.f, t);
      if (o.f2) {
        var tt = o.slideT ? t + o.slideT : te;
        if (o.curve === 'lin') fq.linearRampToValueAtTime(o.f2, tt); else fq.exponentialRampToValueAtTime(o.f2, tt);
      }
    }
    if (o.det) osc.detune.setValueAtTime(o.det, t);
    var end = ampEnv(g.gain, o, t, te);
    if (o.vib && te - t > (o.vibD || 0) + 0.06) {
      var l = ac.createOscillator(), lg = ac.createGain(), vd = t + (o.vibD || 0);
      l.frequency.value = o.vibR || 5.5;
      lg.gain.setValueAtTime(0, t); lg.gain.setValueAtTime(0, vd); lg.gain.linearRampToValueAtTime(o.vib, vd + 0.15);
      l.connect(lg); lg.connect(osc.detune); l.start(t); l.stop(end);
    }
    osc.connect(g);
    var out = g;
    if (o.am) { out = amStage(E, o, t, end); g.connect(out); }
    out.connect(dest);
    if (dest2) out.connect(dest2);
    osc.start(t); osc.stop(end);
    osc.onended = function () { try { out.disconnect(); g.disconnect(); } catch (e) { /* egal */ } };
    return out;
  }
  // Rauschen: t, dur, v, a, d, s, r, ft (Filtertyp), f, f2, q, buf ('m' = metallisch), rate, rate2, am
  function noise(E, dest, o) {
    var ac = E.ac, t = o.t, a = o.a || 0.002;
    var te = Math.max(t + a + 0.003, t + o.dur);
    var src = ac.createBufferSource(), g = ac.createGain(), node = src;
    src.buffer = o.buf === 'm' ? E.metal : E.white; src.loop = true;
    if (o.rate) {
      src.playbackRate.setValueAtTime(o.rate, t);
      if (o.rate2) src.playbackRate.exponentialRampToValueAtTime(o.rate2, te);
    }
    if (o.ft) {
      var bq = ac.createBiquadFilter();
      bq.type = o.ft; bq.Q.value = o.q || 0.7;
      bq.frequency.setValueAtTime(o.f, t);
      if (o.f2) bq.frequency.exponentialRampToValueAtTime(o.f2, te);
      src.connect(bq); node = bq;
    }
    var end = ampEnv(g.gain, o, t, te);
    node.connect(g);
    var out = g;
    if (o.am) { out = amStage(E, o, t, end); g.connect(out); }
    out.connect(dest);
    src.start(t, Math.random() * 0.4); src.stop(end);
    src.onended = function () { try { out.disconnect(); g.disconnect(); node.disconnect(); } catch (e) { /* egal */ } };
    return out;
  }
  // Kurzformen für Effekte: Blip (perkussiv) und gehaltener Ton
  function bl(E, d, w, f, t, dur, v, x) {
    return voice(E, d, Object.assign({ w: w, f: f, t: t, dur: dur, v: v, a: 0.002, s: 0, d: dur * 0.45, r: 0.02 }, x || {}));
  }
  function fl(E, d, w, f, t, dur, v, x) {
    return voice(E, d, Object.assign({ w: w, f: f, t: t, dur: dur, v: v, a: 0.004, s: 1, r: 0.04 }, x || {}));
  }
  function nz(E, d, t, dur, v, x) {
    return noise(E, d, Object.assign({ t: t, dur: dur, v: v, a: 0.002, s: 0, d: dur * 0.4, r: 0.02 }, x || {}));
  }

  // Schlagzeug (für die Musik)
  function drumHit(E, d, k, t, dv) {
    switch (k) {
      case 'k':
        voice(E, d, { w: 'sine', f: 150, f2: 45, slideT: 0.09, t: t, dur: 0.12, v: 0.5 * dv, a: 0.002, s: 0, d: 0.06, r: 0.04 });
        nz(E, d, t, 0.015, 0.08 * dv, { ft: 'lowpass', f: 1600 });
        break;
      case 's': case 'S': case 'g':
        var sv = (k === 'S' ? 1.25 : k === 'g' ? 0.35 : 1) * dv;
        nz(E, d, t, 0.13, 0.2 * sv, { ft: 'highpass', f: 1100, d: 0.045 });
        bl(E, d, 'tri', 200, t, 0.06, 0.16 * sv, { f2: 150 });
        break;
      case 'h': nz(E, d, t, 0.04, 0.07 * dv, { ft: 'highpass', f: 7500, d: 0.012 }); break;
      case 'o': nz(E, d, t, 0.2, 0.06 * dv, { ft: 'highpass', f: 6500, d: 0.07 }); break;
      case 'z': nz(E, d, t, 0.05, 0.05 * dv, { ft: 'bandpass', f: 6000, q: 1.5, a: 0.008, d: 0.018 }); break;
      case 'x':
        nz(E, d, t, 0.03, 0.12 * dv, { ft: 'bandpass', f: 2600, q: 3, d: 0.01 });
        bl(E, d, 'p50', 1700, t, 0.012, 0.04 * dv);
        break;
      case 'c':
        nz(E, d, t, 1.0, 0.1 * dv, { ft: 'highpass', f: 3500, d: 0.35 });
        nz(E, d, t, 0.6, 0.04 * dv, { buf: 'm', rate: 1.7, ft: 'highpass', f: 2500, d: 0.2 });
        break;
      case 't': case 'm': case 'T':
        var tf = k === 't' ? 100 : k === 'm' ? 140 : 190;
        voice(E, d, { w: 'tri', f: tf, f2: tf * 0.6, t: t, dur: 0.2, v: 0.3 * dv, a: 0.002, s: 0, d: 0.08, r: 0.04 });
        nz(E, d, t, 0.04, 0.06 * dv, { ft: 'lowpass', f: 1200 });
        break;
    }
  }

  // ---------------------------------------------------------------- 7. Soundeffekte
  function duck(E, t, amount, hold) {
    var p = E.duck.gain;
    p.cancelScheduledValues(t);
    p.setTargetAtTime(amount, t, 0.03);
    p.setTargetAtTime(1, t + hold, 0.25);
  }
  function arp(E, d, w, notes, t, step, v, last, x) {
    notes.forEach(function (nn, i) {
      bl(E, d, w, nf(nn), t + i * step, i === notes.length - 1 ? (last || step * 2) : step * 1.2, v, x);
    });
  }
  function boom(E, d, t, v, len) {
    nz(E, d, t, len, v, { ft: 'lowpass', f: 3500, f2: 90, d: len * 0.35 });
    voice(E, d, { w: 'sine', f: 110, f2: 32, t: t, dur: len * 0.6, v: v * 0.9, a: 0.003, s: 0, d: len * 0.2, r: 0.05 });
  }
  var SFX = {
    cursor: function (E, t, d) { bl(E, d, 'p25', 2093, t, 0.028, 0.2); },
    menu: function (E, t, d) { bl(E, d, 'p25', 1397, t, 0.03, 0.15); bl(E, d, 'p25', 1865, t + 0.022, 0.03, 0.11); },
    select: function (E, t, d) { bl(E, d, 'p25', nf('E6'), t, 0.05, 0.2); bl(E, d, 'p25', nf('B6'), t + 0.05, 0.09, 0.2); },
    cancel: function (E, t, d) { bl(E, d, 'p25', nf('G5'), t, 0.05, 0.2); bl(E, d, 'p25', nf('C5'), t + 0.05, 0.1, 0.2); },
    confirm: function (E, t, d) { arp(E, d, 'p25', ['C6', 'E6', 'G6', 'C7'], t, 0.035, 0.17, 0.2); },
    error: function (E, t, d) {
      fl(E, d, 'p50', 196, t, 0.08, 0.12, { f2: 180 }); fl(E, d, 'p12', 199, t, 0.08, 0.05);
      fl(E, d, 'p50', 196, t + 0.11, 0.13, 0.12, { f2: 150 }); fl(E, d, 'p12', 199, t + 0.11, 0.13, 0.05);
    },
    move_foot: function (E, t, d) {
      for (var i = 0; i < 4; i++) {
        var tt = t + i * 0.12;
        nz(E, d, tt, 0.045, 0.3, { ft: 'lowpass', f: i % 2 ? 900 : 1300 });
        bl(E, d, 'tri', i % 2 ? 110 : 130, tt, 0.035, 0.14, { f2: 70 });
      }
    },
    move_tread: function (E, t, d) {
      nz(E, d, t, 0.62, 0.14, { buf: 'm', rate: 0.5, ft: 'lowpass', f: 1400, s: 1, a: 0.04, r: 0.12, am: 24, amD: 0.45 });
      fl(E, d, 'tri', 55, t, 0.62, 0.18, { a: 0.04, r: 0.12, f2: 62 });
      for (var i = 0; i < 7; i++) nz(E, d, t + i * 0.085, 0.03, 0.07, { buf: 'm', rate: 1.3, ft: 'bandpass', f: 2600, q: 2 });
    },
    move_tire: function (E, t, d) {
      fl(E, d, 'p25', 72, t, 0.55, 0.06, { f2: 98, curve: 'lin', a: 0.05, r: 0.12, vib: 35, vibR: 11 });
      fl(E, d, 'tri', 72, t, 0.55, 0.14, { f2: 98, curve: 'lin', a: 0.05, r: 0.12 });
      nz(E, d, t, 0.55, 0.05, { ft: 'lowpass', f: 700, s: 1, a: 0.05, r: 0.1 });
    },
    move_air: function (E, t, d) {
      nz(E, d, t, 0.7, 0.24, { ft: 'bandpass', f: 800, q: 1.1, s: 1, a: 0.06, r: 0.15, am: 15, amD: 0.5 });
      fl(E, d, 'tri', 110, t, 0.7, 0.07, { f2: 135, a: 0.06, r: 0.15 });
      nz(E, d, t, 0.7, 0.03, { ft: 'highpass', f: 4000, s: 1, a: 0.1, r: 0.15 });
    },
    move_ship: function (E, t, d) {
      nz(E, d, t, 0.9, 0.22, { ft: 'lowpass', f: 520, f2: 240, s: 1, a: 0.18, r: 0.2, am: 3, amD: 0.35, amW: 'sine' });
      fl(E, d, 'tri', 62, t, 0.9, 0.15, { a: 0.15, r: 0.2, vib: 40, vibR: 3 });
      nz(E, d, t + 0.1, 0.6, 0.03, { ft: 'highpass', f: 3000, s: 1, a: 0.2, r: 0.2 });
    },
    shot_mg: function (E, t, d) {
      for (var i = 0; i < 6; i++) {
        var tt = t + i * 0.065;
        nz(E, d, tt, 0.045, 0.3, { ft: 'bandpass', f: 1700, q: 0.8 });
        bl(E, d, 'p50', 240, tt, 0.03, 0.07, { f2: 110 });
      }
    },
    shot_cannon: function (E, t, d) {
      boom(E, d, t, 0.45, 0.5);
      bl(E, d, 'p50', 220, t, 0.12, 0.1, { f2: 60 });
    },
    shot_artillery: function (E, t, d) {
      boom(E, d, t, 0.38, 0.4);
      fl(E, d, 'tri', 2300, t + 0.18, 0.75, 0.09, { f2: 650, a: 0.05, r: 0.08, vib: 30, vibR: 9 });
      fl(E, d, 'p12', 2300, t + 0.18, 0.75, 0.02, { f2: 650, a: 0.05, r: 0.08 });
    },
    shot_rocket: function (E, t, d) {
      nz(E, d, t, 0.06, 0.28, { ft: 'lowpass', f: 2200 });
      nz(E, d, t, 0.55, 0.22, { ft: 'bandpass', f: 500, f2: 3200, q: 1.4, s: 1, a: 0.03, r: 0.12 });
      fl(E, d, 'p25', 280, t, 0.4, 0.06, { f2: 1300, a: 0.02, r: 0.1 });
    },
    shot_aa: function (E, t, d) {
      for (var i = 0; i < 4; i++) {
        var tt = t + i * 0.08;
        bl(E, d, 'p25', 950, tt, 0.06, 0.09, { f2: 280 });
        nz(E, d, tt, 0.05, 0.2, { ft: 'highpass', f: 1500 });
      }
    },
    explosion: function (E, t, d) {
      nz(E, d, t, 0.95, 0.5, { ft: 'lowpass', f: 4000, f2: 70, d: 0.3 });
      nz(E, d, t, 0.6, 0.18, { buf: 'm', rate: 0.35, ft: 'lowpass', f: 1000, d: 0.18 });
      voice(E, d, { w: 'sine', f: 95, f2: 28, t: t, dur: 0.55, v: 0.45, a: 0.003, s: 0, d: 0.18, r: 0.05 });
    },
    hit: function (E, t, d) {
      nz(E, d, t, 0.1, 0.5, { ft: 'bandpass', f: 1200, q: 0.7 });
      bl(E, d, 'p50', 420, t, 0.09, 0.2, { f2: 90 });
    },
    capture_tick: function (E, t, d) { bl(E, d, 'p25', nf('A5'), t, 0.04, 0.17); bl(E, d, 'p25', nf('D6'), t + 0.045, 0.05, 0.17); },
    capture_done: function (E, t, d) {
      duck(E, t, 0.45, 0.7);
      arp(E, d, 'p25', ['G5', 'C6', 'E6', 'G6'], t, 0.06, 0.11, 0.08);
      voice(E, d, { w: 'p25', seq: [nf('C6'), nf('E6'), nf('G6'), nf('C7')], step: 1 / 45, t: t + 0.26, dur: 0.32, v: 0.1, s: 0.5, d: 0.12, r: 0.12 });
      fl(E, d, 'tri', nf('C4'), t + 0.26, 0.32, 0.2, { r: 0.12 });
    },
    build: function (E, t, d) {
      for (var i = 0; i < 2; i++) {
        nz(E, d, t + i * 0.12, 0.06, 0.22, { buf: 'm', rate: 1.6, ft: 'bandpass', f: 3000, q: 2 });
        bl(E, d, 'p12', 1250, t + i * 0.12, 0.05, 0.06, { f2: 800 });
      }
      arp(E, d, 'p25', ['E6', 'G6', 'C7'], t + 0.27, 0.05, 0.15, 0.16);
    },
    supply: function (E, t, d) {
      arp(E, d, 'p25', ['G5', 'B5', 'D6', 'G6', 'B6'], t, 0.045, 0.14, 0.14);
      fl(E, d, 'tri', nf('G4'), t, 0.25, 0.14, { r: 0.08 });
    },
    repair: function (E, t, d) {
      for (var i = 0; i < 3; i++) bl(E, d, 'p25', 600, t + i * 0.09, 0.07, 0.17, { f2: 950, curve: 'lin' });
      arp(E, d, 'p25', ['C7', 'E7'], t + 0.3, 0.045, 0.13, 0.12);
    },
    power: function (E, t, d) {
      duck(E, t, 0.35, 1.3);
      fl(E, d, 'p25', 180, t, 0.7, 0.12, { f2: 1400, a: 0.02, r: 0.03 });
      fl(E, d, 'p50', 182, t, 0.7, 0.07, { f2: 1420, a: 0.02, r: 0.03, det: 18 });
      nz(E, d, t, 0.7, 0.13, { ft: 'highpass', f: 700, f2: 6000, s: 1, a: 0.5, r: 0.03 });
      var t2 = t + 0.72;
      voice(E, d, { w: 'p25', seq: [nf('C6'), nf('E6'), nf('G6')], step: 1 / 40, t: t2, dur: 0.55, v: 0.13, s: 0.5, d: 0.2, r: 0.15 });
      voice(E, d, { w: 'p50', seq: [nf('G5'), nf('C6'), nf('E6')], step: 1 / 30, t: t2, dur: 0.55, v: 0.07, s: 0.5, d: 0.2, r: 0.15 });
      fl(E, d, 'tri', nf('C3'), t2, 0.55, 0.25, { r: 0.15 });
      nz(E, d, t2, 0.8, 0.16, { ft: 'highpass', f: 3500, d: 0.3 });
      boom(E, d, t2, 0.35, 0.35);
    },
    power_super: function (E, t, d) {
      duck(E, t, 0.3, 1.8);
      for (var i = 0; i < 2; i++) {
        var ts = t + i * 0.35;
        fl(E, d, 'p25', 160 * (i + 1), ts, 0.45, 0.11, { f2: 900 * (i + 1), a: 0.02, r: 0.03 });
        fl(E, d, 'p50', 162 * (i + 1), ts, 0.45, 0.06, { f2: 910 * (i + 1), a: 0.02, r: 0.03, det: 20 });
        boom(E, d, ts, 0.2, 0.25);
      }
      nz(E, d, t, 0.95, 0.12, { ft: 'highpass', f: 600, f2: 7000, s: 1, a: 0.8, r: 0.03 });
      var t2 = t + 0.95;
      voice(E, d, { w: 'p25', seq: [nf('D6'), nf('F#6'), nf('A6'), nf('D7')], step: 1 / 45, t: t2, dur: 0.75, v: 0.13, s: 0.5, d: 0.25, r: 0.2, vib: 20 });
      voice(E, d, { w: 'p50', seq: [nf('A5'), nf('D6'), nf('F#6')], step: 1 / 30, t: t2, dur: 0.75, v: 0.07, s: 0.5, d: 0.25, r: 0.2 });
      fl(E, d, 'tri', nf('D3'), t2, 0.75, 0.26, { r: 0.2 });
      nz(E, d, t2, 1.2, 0.18, { ft: 'highpass', f: 3000, d: 0.45 });
      boom(E, d, t2, 0.42, 0.6);
    },
    day: function (E, t, d) {
      [['E5', 0, 0.3], ['B5', 0.13, 0.3], ['E6', 0.26, 0.7]].forEach(function (x) {
        bl(E, d, 'p50', nf(x[0]), t + x[1], x[2], 0.08, { d: x[2] * 0.4 });
        bl(E, d, 'tri', nf(x[0]), t + x[1], x[2], 0.16, { d: x[2] * 0.5 });
      });
    },
    victory: function (E, t, d) {
      duck(E, t, 0.3, 1.1);
      [['C6', 0, 0.09], ['E6', 0.1, 0.09], ['G6', 0.2, 0.09], ['E6', 0.32, 0.07], ['C7', 0.42, 0.55]].forEach(function (x) {
        fl(E, d, 'p25', nf(x[0]), t + x[1], x[2], 0.12, { r: 0.08, vib: x[2] > 0.3 ? 20 : 0, vibD: 0.1 });
      });
      fl(E, d, 'p50', nf('E6'), t + 0.42, 0.55, 0.07, { r: 0.1 });
      fl(E, d, 'tri', nf('C4'), t, 0.3, 0.2); fl(E, d, 'tri', nf('C3'), t + 0.42, 0.55, 0.24, { r: 0.1 });
    },
    defeat: function (E, t, d) {
      duck(E, t, 0.3, 1.4);
      [['G4', 0, 0.2], ['F#4', 0.24, 0.2], ['F4', 0.48, 0.2], ['E4', 0.72, 0.65]].forEach(function (x, i) {
        fl(E, d, 'p50', nf(x[0]), t + x[1], x[2], 0.11, { r: 0.1, vib: i === 3 ? 30 : 0, vibD: 0.15, vibR: 4.5 });
      });
      fl(E, d, 'tri', nf('C3'), t, 0.7, 0.18); fl(E, d, 'tri', nf('A2'), t + 0.72, 0.65, 0.2, { r: 0.15 });
    },
    trap: function (E, t, d) {
      duck(E, t, 0.3, 0.7);
      [[0, 'E5', 'F5', 'Bb4'], [0.2, 'Eb5', 'E5', 'A4']].forEach(function (x, i) {
        var tt = t + x[0], len = i ? 0.4 : 0.14;
        fl(E, d, 'p25', nf(x[1]), tt, len, 0.1, { r: 0.08 });
        fl(E, d, 'p25', nf(x[2]), tt, len, 0.1, { r: 0.08 });
        fl(E, d, 'p50', nf(x[3]), tt, len, 0.08, { r: 0.08 });
        nz(E, d, tt, 0.15, 0.25, { ft: 'lowpass', f: 2500 });
        voice(E, d, { w: 'sine', f: 160, f2: 45, t: tt, dur: 0.25, v: 0.4, s: 0, d: 0.08, r: 0.04 });
      });
    },
    dive: function (E, t, d) {
      fl(E, d, 'tri', 720, t, 0.6, 0.15, { f2: 120, r: 0.08 });
      nz(E, d, t, 0.6, 0.1, { ft: 'lowpass', f: 700, f2: 150, s: 1, r: 0.1 });
      for (var i = 0; i < 5; i++) {
        var f = 450 + ((i * 173) % 400);
        bl(E, d, 'p12', f, t + 0.08 + i * 0.1, 0.04, 0.04, { f2: f * 1.5 });
      }
    },
    surface: function (E, t, d) {
      fl(E, d, 'tri', 150, t, 0.4, 0.15, { f2: 820, r: 0.06 });
      nz(E, d, t + 0.35, 0.35, 0.22, { ft: 'bandpass', f: 2600, f2: 1200, q: 0.8, d: 0.12 });
    },
    load: function (E, t, d) {
      bl(E, d, 'p25', nf('C6'), t, 0.05, 0.16); bl(E, d, 'p25', nf('G5'), t + 0.06, 0.06, 0.16);
      nz(E, d, t + 0.14, 0.08, 0.28, { ft: 'lowpass', f: 900 });
      bl(E, d, 'sine', 150, t + 0.14, 0.1, 0.3, { f2: 60 });
    },
    unload: function (E, t, d) {
      nz(E, d, t, 0.08, 0.28, { ft: 'lowpass', f: 900 });
      bl(E, d, 'sine', 150, t, 0.1, 0.3, { f2: 60 });
      bl(E, d, 'p25', nf('G5'), t + 0.1, 0.05, 0.16); bl(E, d, 'p25', nf('C6'), t + 0.16, 0.07, 0.16);
    },
    coin: function (E, t, d) {
      bl(E, d, 'p25', nf('G6'), t, 0.05, 0.15); bl(E, d, 'p25', nf('C7'), t + 0.05, 0.05, 0.15);
      bl(E, d, 'p25', nf('E7'), t + 0.1, 0.2, 0.13);
    }
  };
  var SFX_NAMES = Object.keys(SFX);

  // ---------------------------------------------------------------- 8. Sequencer & API
  var LOOKAHEAD = 0.1, TICK_MS = 25, HIDDEN_LOOKAHEAD = 1.2;
  var ctx = null, E = null, timer = null, P = null, want = null, muted = false;
  var vol = { music: 0.7, sfx: 0.8 }, lastSfx = {};

  function clamp01(x, d) { x = +x; return isFinite(x) ? Math.max(0, Math.min(1, x)) : d; }
  function applyVol(instant) {
    if (!E) return;
    var t = ctx.currentTime, k = instant ? 0.001 : 0.03;
    E.music.gain.setTargetAtTime(vol.music * MUSIC_LVL, t, k);
    E.sfx.gain.setTargetAtTime(vol.sfx * SFX_LVL, t, k);
    E.master.gain.setTargetAtTime(muted ? 0 : 1, t, k);
  }
  // Wiedergabe-Kette eines Stücks: out (für Fades) + optionales Echo (Delay mit Rückkopplung und Tiefpass)
  function mkPlayback(Env, c, t0) {
    var ac = Env.ac, out = ac.createGain(), nodes = [out];
    out.connect(Env.music);
    var pb = { c: c, E: Env, out: out, send: null, nodes: nodes, t0: t0, idx: 0, n: 0 };
    if (c.echo) {
      var send = ac.createGain(), dl = ac.createDelay(2), lp = ac.createBiquadFilter(), fb = ac.createGain();
      send.gain.value = c.echo.mix;
      dl.delayTime.value = Math.min(1.9, c.echo.beats * 60 / c.bpm);
      lp.type = 'lowpass'; lp.frequency.value = 2600;
      fb.gain.value = c.echo.fb;
      send.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(out);
      pb.send = send; nodes.push(send, dl, lp, fb);
    }
    return pb;
  }
  function playEvent(pb, e, t) {
    var c = pb.c, Env = pb.E;
    if (e.ch === 'dr') {
      for (var i = 0; i < e.k.length; i++) drumHit(Env, pb.out, e.k[i], t, c.dv);
      return;
    }
    var ins = c.inst[e.ch];
    var dur = (tickTime(c, e.t + e.d) - tickTime(c, e.t)) * ins.gate;
    var o = { w: ins.w, t: t, dur: dur, v: ins.v, a: ins.a, d: ins.d, s: ins.s, r: ins.r, vib: ins.vib, vibD: ins.vibD, vibR: ins.vibR, det: ins.det };
    if (Array.isArray(e.p)) { o.seq = e.p.map(mtof); o.step = ins.arp || 1 / 40; o.vib = 0; }
    else o.f = mtof(e.p);
    voice(Env, pb.out, o, ins.fx ? pb.send : null);
  }
  function pump() {
    if (!P || !ctx) { if (!P) stopTimer(); return; }
    var now = ctx.currentTime, c = P.c;
    var horizon = now + ((DOC && DOC.hidden) ? HIDDEN_LOOKAHEAD : LOOKAHEAD);
    if (!c.ev.length) return;
    for (var guard = 0; guard < 4000; guard++) {
      if (P.idx >= c.ev.length) {
        if (!c.loop) break;
        P.idx = 0; P.n++;
      }
      var e = c.ev[P.idx], base = P.t0 + P.n * c.loopSec, t = base + tickTime(c, e.t);
      if (t > horizon) break;
      if (t >= now - 0.03) playEvent(P, e, t);   // zu spät (z. B. nach Hänger) → auslassen statt nachholen
      P.idx++;
    }
    if (!c.loop && P.idx >= c.ev.length && now > P.t0 + c.loopSec + 0.5) {
      // Einmaliges Stück zu Ende: Kette abbauen, Zustand zurücksetzen
      release(P, 0.2); P = null; want = null; stopTimer();
    }
  }
  function startTimer() { if (!timer) timer = setInterval(pump, TICK_MS); }
  function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }
  function release(pb, fade) {
    var t = ctx.currentTime, g = pb.out.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0, t + fade);
    var nodes = pb.nodes;
    setTimeout(function () { nodes.forEach(function (n) { try { n.disconnect(); } catch (e) { /* egal */ } }); }, (fade + HIDDEN_LOOKAHEAD + 0.5) * 1000);
  }
  function startWanted() {
    if (!ctx || !E) return;
    var now = ctx.currentTime, hadOld = !!P;
    if (P) { release(P, 0.45); P = null; }
    if (!want) { stopTimer(); return; }
    var c = compile(want);
    if (!c || !c.ev.length) return;
    var t0 = now + (hadOld ? 0.3 : 0.05);
    P = mkPlayback(E, c, t0);
    P.name = want;
    P.out.gain.setValueAtTime(0, now);
    P.out.gain.linearRampToValueAtTime(1, t0 + 0.03);
    startTimer();
    pump();
  }
  function safe(fn) {
    return function () { try { return fn.apply(this, arguments); } catch (e) { if (ROOT.console && console.warn) console.warn('[Audio]', e); } };
  }

  // Offline-Rendering für Tests (OfflineAudioContext, kein Nutzerklick nötig)
  function analyse(buf) {
    var n = buf.length, chs = buf.numberOfChannels, sr = buf.sampleRate, peak = 0, sum = 0, hot = 0;
    var win = Math.floor(sr * 0.5), wsum = 0, wcount = 0, silentRun = 0, maxSilent = 0, windows = [];
    for (var i = 0; i < n; i++) {
      var m = 0;
      for (var c = 0; c < chs; c++) { var v = buf.getChannelData(c)[i]; if (Math.abs(v) > Math.abs(m)) m = v; }
      var a = Math.abs(m);
      if (a > peak) peak = a;
      if (a > 0.95) hot++;
      sum += m * m; wsum += m * m; wcount++;
      if (wcount === win || i === n - 1) {
        var r = Math.sqrt(wsum / wcount);
        windows.push(r);
        if (r < 0.002) { silentRun += wcount / sr; if (silentRun > maxSilent) maxSilent = silentRun; } else silentRun = 0;
        wsum = 0; wcount = 0;
      }
    }
    return { seconds: n / sr, peak: peak, rms: Math.sqrt(sum / n), hotSamples: hot, maxSilence: maxSilent, windowRms: windows };
  }
  function render(what, opt) {
    opt = opt || {};
    var OAC = ROOT.OfflineAudioContext || ROOT.webkitOfflineAudioContext;
    if (!OAC) return Promise.reject(new Error('kein OfflineAudioContext'));
    var kind = what.split(':')[0], name = what.slice(kind.length + 1), sr = opt.sampleRate || 44100, secs, c = null;
    if (kind === 'music') { c = compile(name); if (!c) return Promise.reject(new Error('unbekannter Track ' + name)); secs = Math.min(opt.maxSeconds || 90, c.loopSec + 1.5); }
    else if (kind === 'sfx') { if (!SFX[name]) return Promise.reject(new Error('unbekannter Effekt ' + name)); secs = 3; }
    else return Promise.reject(new Error('music:<name> oder sfx:<name>'));
    var oac = new OAC(2, Math.ceil(sr * secs), sr), Env = buildEnv(oac);
    var mv = opt.music != null ? opt.music : vol.music, sv = opt.sfx != null ? opt.sfx : vol.sfx;
    Env.music.gain.value = mv * MUSIC_LVL; Env.sfx.gain.value = sv * SFX_LVL;
    if (c) {
      var pb = mkPlayback(Env, c, 0.05);
      c.ev.forEach(function (e) { playEvent(pb, e, 0.05 + tickTime(c, e.t)); });
    } else SFX[name](Env, 0.02, Env.sfx);
    return oac.startRendering().then(function (buf) {
      var r = analyse(buf);
      r.name = what; r.loopSeconds = c ? c.loopSec : null; r.buffer = buf;
      return r;
    });
  }

  var API = {
    init: safe(function () {
      if (!ctx) {
        var AC = ROOT.AudioContext || ROOT.webkitAudioContext;
        if (!AC) return false;
        ctx = new AC({ latencyHint: 'interactive' });
        E = buildEnv(ctx);
        applyVol(true);
        if (DOC && DOC.addEventListener) DOC.addEventListener('visibilitychange', function () { if (P) pump(); });
      }
      if (ctx.state === 'suspended' && ctx.resume) { var pr = ctx.resume(); if (pr && pr.catch) pr.catch(function () {}); }
      if (want && !P) startWanted();
      return true;
    }),
    sfx: safe(function (name) {
      if (!ctx || !E || !Object.prototype.hasOwnProperty.call(SFX, name)) return;
      if (ctx.state === 'suspended' && ctx.resume) { var pr = ctx.resume(); if (pr && pr.catch) pr.catch(function () {}); }
      var now = ctx.currentTime;
      if (lastSfx[name] != null && now - lastSfx[name] < 0.03 && now >= lastSfx[name]) return;   // Spam-Schutz
      lastSfx[name] = now;
      SFX[name](E, now + 0.005, E.sfx);
    }),
    music: safe(function (track) {
      if (track === undefined || track === '') track = null;
      if (track !== null && !Object.prototype.hasOwnProperty.call(T, track)) return;   // unbekannt → ignorieren
      if (track === want) return;
      want = track;
      startWanted();
    }),
    setVolume: safe(function (musicVol, sfxVol) {
      vol.music = clamp01(musicVol, vol.music);
      vol.sfx = clamp01(sfxVol, vol.sfx);
      applyVol(false);
    }),
    getVolume: function () { return { music: vol.music, sfx: vol.sfx }; },
    toggleMute: function () { API.muted = !muted; return muted; },
    // Zusätzliches (nicht Teil der Pflicht-Schnittstelle):
    TRACKS: TRACK_NAMES.slice(),
    SFX: SFX_NAMES.slice(),
    current: function () { return want; },
    _check: function () {
      return TRACK_NAMES.map(function (n) {
        compiled[n] = null;
        var c = compile(n), notes = 0;
        c.ev.forEach(function (e) { if (e.ch !== 'dr') notes++; });
        return { name: n, bars: c.bars, seconds: c.loopSec, loop: c.loop, bpm: c.bpm, events: c.ev.length, notes: notes, errors: c.errors };
      });
    },
    _render: render,
    _compile: function (n) { return compile(n); }
  };
  Object.defineProperty(API, 'muted', {
    enumerable: true,
    get: function () { return muted; },
    set: function (v) { muted = !!v; try { applyVol(false); } catch (e) { /* egal */ } }
  });
  G.Audio = API;
})();
