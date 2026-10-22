#!/usr/bin/env bash
# Vergleicht KI-Parameter: Ø Spieltage (unentschieden zählt als 60). Aufruf: tools/bench.sh '<tune-json>' [seeds]
cd "$(dirname "$0")/.."
node tools/sim.js --pair normal,normal --seeds "${2:-6}" --quiet --tune "${1:-{\}}" 2>&1 | awk '
  /^[a-z-]+ +[0-9]+ +[0-9]+ +([0-9.]+|-) / { n=$2; dec=$3; d=($4=="-")?60:$4; v=dec*d+(n-dec)*60;
     multi = ($1=="dreilaendereck"||$1=="drei-inseln"||$1=="kreuzweg"||$1=="vier-winde");
     if (multi) { t4+=v; g4+=n } else { t2+=v; g2+=n } und+=n-dec; games+=n; tot+=v }
  /Exceptions:/ { exc=$2 }
  END { printf "Ø Tage gesamt %.1f | 2 Spieler %.1f | 3-4 Spieler %.1f | unentschieden %d/%d | Exceptions %s\n", tot/games, t2/g2, t4/g4, und, games, exc }'
