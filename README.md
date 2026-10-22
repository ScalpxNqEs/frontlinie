# FRONTLINIE

Rundenbasiertes Taktikspiel im Stil der klassischen Handheld-Taktikspiele
(Spielmechanik angelehnt an die GBA-Advance-Wars-Reihe). Grafik, Figuren,
Story, Karten und Musik sind komplett eigenständig.

## Starten
- **Einfach:** `index.html` im Browser öffnen (Doppelklick). Funktioniert offline (Kampagne, Gefecht, Hotseat).
- **Mit Online-Gefecht:** `./start.sh` startet den Spielserver (Node.js) und öffnet den Browser.
- **Aus dem Dateimanager:** Rechtsklick auf `Spiel starten.sh` → **„Als Programm ausführen“** (ein Doppelklick öffnet Skripte nur im Texteditor). `Spiel starten (Internet).sh` zusätzlich mit Internet-Adresse.
- **App-Menü:** „FRONTLINIE“ und „FRONTLINIE (Internet)“ (Starter in `~/.local/share/applications`).
- Die Internet-Adresse lässt sich auch im laufenden Spiel holen: Knopf **„Internet-Adresse holen“** unter „Handy-App“ bzw. in der Online-Lobby.

## Handy-App (offline, ohne PC)
1. Am PC das Spiel starten, **Handy-App** wählen und auf **„Internet-Adresse holen“** klicken (oder gleich `Spiel starten (Internet)` nutzen).
2. QR-Code mit dem Handy scannen (iPhone: in Safari öffnen) und warten, bis „✓ Offline gespeichert“ erscheint – die Seite zeigt
   den Fortschritt („12 von 27 Dateien“).
3. **Android:** „Installieren“ (bzw. Menü ⋮ → „App installieren“).
   **iPhone:** Safari → Teilen □↑ → „Zum Home-Bildschirm“ → „Hinzufügen“ – und dann die App **einmal vom neuen Symbol öffnen,
   solange der PC läuft**, bis „✓ Fertig“ erscheint. (Das Symbol hat auf dem iPhone einen eigenen Speicher, getrennt von Safari;
   beim ersten Start lädt es das Spiel deshalb noch einmal vom PC.)

Danach startet FRONTLINIE vom Startbildschirm – ohne PC und ohne Internet (Kampagne, Gefecht gegen KI, Hotseat, Handy zu Handy).
- Immer dieselbe Variante nutzen (App-Symbol **oder** Browser): Spielstände und „Deine Spiele“ sind pro Variante getrennt.
- Die Internet-Adresse (`https://….lhr.life`) wechselt bei jedem PC-Start. Die installierte App läuft trotzdem weiter, denn sie liegt
  komplett auf dem Handy. Eine neuere Version installiert man einfach nochmal über diesen Weg – sie erscheint als neues Symbol mit
  eigenen Spielständen; das alte Symbol kann weg.
- Scheitert beim Speichern eine Datei (wackliger Tunnel), bleibt der Rest erhalten und wird nachgeladen, sobald der PC wieder
  erreichbar ist; der Bildschirm „Handy-App“ zeigt den Stand. Am PC selbst (localhost) wird nichts zwischengespeichert.
- Für eine feste Adresse (z. B. GitHub Pages): `node tools/build-web.js` erzeugt `dist/`.

## Handy zu Handy (ohne PC)
Zwei (bis vier) Handys spielen direkt miteinander – kein PC, kein Server. Beide brauchen dieselbe Spielversion
(am besten beide gleichzeitig über „Handy-App“ installieren).
1. **Handy 1:** Titelmenü **Handy zu Handy → Spiel eröffnen**, Karte wählen (Platz 2 = „Mitspieler (Netz)“) → „Raum eröffnen“
   → **„Einladung zeigen“**.
2. **Handy 2:** **Handy zu Handy → Beitreten → Scannen** und den QR-Code von Handy 1 scannen. Handy 2 zeigt einen Antwort-Code.
3. **Handy 1:** bei „Antwort“ auf **Scannen** tippen und den Code von Handy 2 scannen → verbunden → „Spiel starten“.

Statt zu scannen lassen sich die Codes per Messenger schicken („Teilen“) und einfügen. Am zuverlässigsten im selben WLAN
oder im Hotspot von Handy 1 (geht dann auch ohne Internet); über Mobilfunk an verschiedenen Orten klappt es nur manchmal.
Handy 1 ist Gastgeber (prüft die Züge, rechnet KI-Gegner, speichert den Raum) und muss an bleiben. Reißt die Verbindung ab:
Spielmenü → „Mitspieler verbinden“ (Handy 1) bzw. „Neu verbinden“ (Handy 2), Codes erneut tauschen – das Spiel geht genau
dort weiter. Technik: WebRTC-Datenkanal, öffentliche STUN-Server von Google/Cloudflare zur Adressermittlung;
QR-Leser jsQR (Apache-2.0, `js/jsqr.js`, Lizenz in `docs/LICENSE-jsQR.txt`) für Browser ohne eingebauten Leser.

## Online-Gefecht (z. B. mit dem Handy)
1. `./start.sh` ausführen, im Spiel **Online-Gefecht → Raum eröffnen**, Karte und Plätze wählen
   (Du / Mitspieler (Netz) / KI).
2. Mitspieler scannt den **QR-Code** oder öffnet den Einladungslink im Handy-Browser, gibt einen Namen
   ein und wählt seinen Kommandanten. Der Gastgeber startet das Spiel.
3. **Gleiches WLAN:** Adresse `http://<PC-IP>:8642/`. Ist die Firewall (ufw) aktiv, einmalig freigeben:
   `sudo ufw allow from 192.168.178.0/24 to any port 8642 proto tcp` (das Spiel zeigt den passenden Befehl).
4. **Über das Internet / Mobilfunk:** Knopf „Internet-Adresse holen“ in der Lobby oder `./start.sh --internet` – öffnet per SSH einen Tunnel
   (localhost.run) und zeigt eine `https://…lhr.life`-Adresse samt QR-Code. Keine Freigabe nötig.

Details: Der Server prüft jeden Zug mit derselben Spiellogik, KI-Gegner rechnen auf dem Server.
Verbindungsabbrüche (Handy im Hintergrund, Funkloch) werden automatisch nachgeholt; neu laden führt
zurück ins Spiel. Spielstände überleben Server-Neustarts (`~/.local/share/frontlinie/rooms`).
Ist ein Mitspieler weg, kann der Gastgeber dessen Armee im Menü an die KI übergeben. Chat mit
Schnellnachrichten über 💬. Revanche im gleichen Raum nach Spielende.

## Inhalt
- 32 Einheitentypen: Boden (Fabrik), Luft (Flughafen), See (Hafen) und feste Verteidigungsstellungen (vom Pionier gebaut); 14 Geländearten
- Einnehmen, Einkommen, Nachschub, Reparatur, Treibstoff, Munition, Laden/Entladen, Vereinen, Tauchen
- Sicht wie beim Original: Erkundung (Unerforschtes ausgegraut oder schwarz, gemerkte Gebäudebesitzer), Nebel des Krieges oder offene Karte; unterschiedliche Sichtweiten je Einheit; Hinterhalte
- 10 Kommandanten mit je zwei Kräften
- Fusion: Ein Spieler kann zwei Kommandanten wählen, die gemeinsam führen – Angriffs- und Verteidigungsboni beider zu je 70 %,
  Bewegung, Reichweite und Sicht addiert, beide Kräfte zugleich (Sterne: 75 % der Summe). Wählbar bei der Kommandantenwahl vor
  dem Spiel, in der Online-Lobby über „＋ Fusion“ (auch der Gastgeber für KI-Plätze)
- Kampagne mit 12 Missionen, 19 Gefechtskarten (30×30 bis 71×59) für 2–4 Spieler: Kontinent, Rund, L, Ring mit Mittelinsel, Hufeisen, langes Tal, zwei Kontinente, Hochgebirge, Eisseen sowie vier Seekarten ohne Landweg zwischen den Spielern (Inselreich, Küstenkrieg, Vier Inseln, Dreimeer) mit Häfen, Stränden und Riffen. Jede Karte ist auf Tempo gebaut: HQ-Fußweg 34–46 Felder, 3–4 neutrale Städte in Reichweite der ersten Infanterie (≤ 6 Felder), je Spieler eine Vorposten-Fabrik auf halbem Weg, umkämpfte Mitte mit Fabrik/Flughafen/Hafen, ein Gebäude je ~20 Landfelder
- Landschaften Sommer, Herbst, Winter, Gebirge; Wetter Regen, Schnee, Nacht (wechselhaft, Tag & Nacht oder dauerhaft) mit Auswirkungen auf Bewegung und Sicht
- Grafik: vektorgezeichnetes Gelände in hoher Auflösung (Küsten mit Untiefen und Gischt, Berge mit Schneekappen, Wälder, Straßen, Flüsse, Gebäude mit Tiefe und Teamfarbe), per Scale3x geglättete Einheiten mit Schatten und KP-Plaketten
- Oberfläche im Feldkommando-Stil (css/style.css): Oliv/Khaki, Signalorange, abgeschrägte Ecken, Stempelschrift; Titelbildschirm mit lebendiger Front (Kameraschwenk über eine echte Karte, zwei Heere beziehen Stellung und beschießen sich, Flieger, Wolkenschatten)
- Bewegungsbereich (blau, helle Kontur) und Angriffsbereich (rot schraffiert) sind klar getrennt; laufende Einnahmen zeigen einen Fortschrittsbalken über der Einheit, die Info-Karte „Einnahme läuft“ und das Spiel fragt nach, bevor eine halb eingenommene Stadt verlassen wird
- Minikarte (Taste C) mit Ein-/Ausklapp-Knopf, Transporter zeigen ihre Ladung (Bilder mit KP)
- Knöpfe unten rechts (Touch): „Nächste“ schaltet durch die bereiten Einheiten und wird zu „Ende“, sobald alle gehandelt haben; „Wählen“ bestätigt – ohne genaues Tippen auf die Einheit; die Info-Karten rücken darüber
- Touch-Bedienung: Tipp außerhalb der Reichweite hebt die Auswahl auf; ein Tipp auf ein leeres Feld setzt nur den Cursor (Menü über ☰ oder Esc); bei mehreren Zielen zeigt der erste Tipp die Schadensvorschau, der zweite greift an (am PC: Maus darüber = Vorschau)
- Gegner-Sicht (Auge-Knopf oder V): gelb markiert, welche Felder sichtbare Gegner einsehen; Gegner-Reichweite (Q oder Menü): lila, wo sie angreifen können; die Einheitenkarte zeigt die Sichtweite (👁)
- Tastenkürzel für alles Wichtige, Übersicht mit **F1** oder **?** (z. B. N/Tab nächste Einheit, B nächste Fabrik, H Hauptquartier, E Runde beenden, 1–9 Menüeintrag, Strg+S Speichern)
- Gegner-KI in drei Stufen, Hotseat für mehrere Menschen, Teams, Online-Gefecht übers Netzwerk (Handy-tauglich), Handy zu Handy ohne PC
- Online: Wer wartet, kann seine Einheiten **vorplanen** (antippen → Ziel → Aktion), auch während der Gegner gerade zieht; eine Leiste erklärt es. Die Pläne laufen zu Beginn des eigenen Zuges automatisch ab, sofern noch möglich; alle anderen Einheiten bleiben frei
- Fabrik: Steckbrief jeder Einheit (Knopf „i“ bzw. Taste I) mit allen Werten und Stärken/Schwächen; auf dem Handy erst antippen (Werte), nochmal tippen (bauen)
- Kommandanten vor dem Spiel nachlesen und wählen: aufs Porträt tippen (Gefecht-Menü und Online-Lobby)
- Handy: stufenloser Fingerzoom (rastet weich auf scharfe Stufen ein), Mausrad zum Zeiger hin, scharfe Darstellung bei hoher Pixeldichte
- Die KI gibt bei aussichtsloser Lage auf (abschaltbar)
- Karteneditor mit Symmetrie-Werkzeug, Export/Import
- Speichern (3 Slots + Autosave), Kampfanimationen, Chiptune-Musik

## Entwicklung
- `node tests/core.test.js` – Regeltests; `node tests/net.test.js` – Online-Spiel (Server, Synchronität, Wiederverbindung); `node tests/p2p.test.js` – Verbindungscodes für Handy zu Handy
- `node tools/sim.js` – KI-gegen-KI-Simulation über alle Karten
- `node tools/check-maps.js` – Kartenprüfung
- `node tools/mapgen.js` – erzeugt js/maps.js neu (symmetrische, faire Karten); `node tools/preview-maps.js` – PNG-Übersicht
- `node tools/sim.js --limit auto` – Simulation mit Tageslimit; `tools/bench.sh '<tune-json>'` vergleicht KI-Parameter nach Ø Spieltagen
- Spiellogik (`js/data.js`, `js/game.js`, `js/ai.js`, Karten) und Spielräume (`js/room.js`, genutzt vom PC-Server und vom Gastgeber-Handy) sind DOM-frei.
- Darstellung (`js/render.js`): Geländefelder werden vektoriell in 16er-Koordinaten gemalt und je Umgebung gecacht (Detailfaktor 2–4 je Kartengröße); Einheiten/Porträts entstehen per Scale3x aus den 16×16-Rastern in `js/sprites*.js`.

## Testszenario
`index.html#demo-pionier` startet ein Szenario mit Pionier, Bergepanzer, Flugzeugträger und Schlachtflieger; `index.html#demo-kampf` eine Panzer-Kampfszene.
