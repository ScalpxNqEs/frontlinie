#!/usr/bin/env bash
# Startet FRONTLINIE in einem Terminalfenster (für die Starter „Spiel starten“ im Ordner und im App-Menü).
# Das Fenster zeigt den Server; Fenster schließen oder Strg+C beendet ihn.
#   tools/launch.sh             Spiel + Server
#   tools/launch.sh --internet  zusätzlich Internet-Adresse (für Handy-App und Mitspieler über Mobilfunk)
DIR="$(cd "$(dirname "$0")/.." && pwd)"
SELF="$DIR/tools/launch.sh"
if [ ! -t 1 ] && [ -z "$FRONTLINIE_IN_TERM" ]; then
  export FRONTLINIE_IN_TERM=1
  for T in xdg-terminal-exec foot alacritty ghostty kitty gnome-terminal konsole xterm; do
    if command -v "$T" >/dev/null 2>&1; then
      case "$T" in
        gnome-terminal) exec "$T" -- "$SELF" "$@" ;;
        *) exec "$T" -e "$SELF" "$@" ;;
      esac
    fi
  done
fi
"$DIR/start.sh" "$@"
echo
read -r -p "Server beendet – Enter schließt das Fenster. " _
