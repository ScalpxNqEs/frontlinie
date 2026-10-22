#!/usr/bin/env bash
# Startet FRONTLINIE mit Spielserver (auch für Online-Gefechte mit Handys)
#
#   ./start.sh              Spiel + Server im Heimnetz (WLAN)
#   ./start.sh --internet   zusätzlich Internet-Adresse (Mitspieler überall, auch Mobilfunk)
#   PORT=9000 ./start.sh    anderer Port
cd "$(dirname "$0")"
PORT=${PORT:-8642}
ARGS=(--port "$PORT")
for a in "$@"; do [ "$a" = "--internet" ] && ARGS+=(--internet); done

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js fehlt – starte nur das Einzelspiel (ohne Online-Gefecht)."
  python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
  SRV=$!; trap 'kill $SRV' EXIT; sleep 0.5
  xdg-open "http://127.0.0.1:$PORT/index.html" >/dev/null 2>&1 || echo "Öffne http://127.0.0.1:$PORT/index.html"
  wait $SRV; exit
fi

# Läuft der Server schon? Dann nur den Browser öffnen
if curl -fs "http://127.0.0.1:$PORT/api/info" 2>/dev/null | grep -q frontlinie; then
  echo "FRONTLINIE läuft bereits – öffne den Browser."
  # Internet-Adresse gewünscht? Dann beim laufenden Server nachträglich anfordern
  for a in "$@"; do [ "$a" = "--internet" ] && curl -fs -X POST "http://127.0.0.1:$PORT/api/tunnel" >/dev/null 2>&1 && echo "Internet-Adresse wird geholt."; done
  xdg-open "http://127.0.0.1:$PORT/" >/dev/null 2>&1 &
  sleep 1; exit 0
fi

node server.js "${ARGS[@]}" &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT INT TERM
for i in $(seq 1 30); do curl -fs "http://127.0.0.1:$PORT/api/info" >/dev/null 2>&1 && break; sleep 0.2; done

LAN=$(curl -fs "http://127.0.0.1:$PORT/api/info" | sed -n 's/.*"lan":\["\([^"]*\)".*/\1/p')
echo
echo "  FRONTLINIE läuft.  Auf diesem PC: http://127.0.0.1:$PORT/"
if [ -n "$LAN" ]; then
  echo "  Handy im selben WLAN:  $LAN"
  echo "  (Warnt das Handy „Verbindung ist nicht privat“: „Erweitert“ → „Weiter zu …“ tippen.)"
  if command -v qrencode >/dev/null 2>&1; then qrencode -t ansiutf8 -m 2 "$LAN"; fi
  if grep -qs '^ENABLED=yes' /etc/ufw/ufw.conf && ! grep -qs -- "--dport $PORT" /etc/ufw/user.rules; then
    NET=$(curl -fs "http://127.0.0.1:$PORT/api/info" | sed -n 's/.*"cmd":"\([^"]*\)".*/\1/p')
    echo "  Hinweis: Die Firewall blockiert Handys noch. Einmalig freigeben mit:"
    echo "      $NET"
    echo "  (oder ./start.sh --internet nutzen)"
  fi
fi
echo "  Einladungslink und QR-Code findest du im Spiel unter „Online-Gefecht“."
echo "  Strg+C beendet den Server."
echo
xdg-open "http://127.0.0.1:$PORT/" >/dev/null 2>&1 &
wait $SRV
