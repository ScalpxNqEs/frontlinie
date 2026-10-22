#!/usr/bin/env bash
# FRONTLINIE mit Internet-Adresse starten (Handy-App installieren, Mitspieler über Mobilfunk):
# Rechtsklick → „Als Programm ausführen“. Bequemer: „FRONTLINIE (Internet)“ im App-Menü –
# oder im laufenden Spiel auf „Internet-Adresse holen“ klicken.
exec "$(cd "$(dirname "$0")" && pwd)/tools/launch.sh" --internet "$@"
