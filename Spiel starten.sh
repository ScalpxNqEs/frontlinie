#!/usr/bin/env bash
# FRONTLINIE starten: Rechtsklick → „Als Programm ausführen“ (Doppelklick öffnet nur den Texteditor).
# Bequemer: „FRONTLINIE“ im App-Menü.
exec "$(cd "$(dirname "$0")" && pwd)/tools/launch.sh" "$@"
