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

## Einladungslink / Handy zu Handy
Zwei bis vier Geräte spielen direkt miteinander – kostenlos, ohne eigenen Server, ohne Konto. Am einfachsten per **Einladungslink**:
1. **Gastgeber:** Titelmenü **Mit Freunden spielen → Einladungslink erstellen**, Karte wählen (Plätze für Freunde = „Mitspieler (Netz)“)
   → „Raum eröffnen“. In der Lobby erscheint der Link (`…/#einladung=<code>`) als QR-Code und als Text, mit **Teilen** und **Kopieren**.
2. Den Link per Messenger schicken – oder den QR-Code mit der Kamera scannen lassen.
3. **Freunde tippen nur den Link an:** Das Spiel öffnet sich (im Browser oder in der installierten App) und verbindet sich von selbst
   mit der Lobby. Der Gastgeber tippt auf „Spiel starten“.

So funktioniert es: Der Link enthält einen zufälligen Code. Daraus leiten beide Geräte einen Themennamen und einen Schlüssel ab und
tauschen ihre Verbindungsdaten (WebRTC-Angebot und -Antwort) über den kostenlosen öffentlichen Dienst [ntfy.sh](https://ntfy.sh) aus.
ntfy.sh sieht dabei nur verschlüsselte Nachrichten (AES-GCM) und die IP-Adressen der Geräte – nie den Code und keine Spielzüge.
Danach läuft das Spiel direkt zwischen den Geräten (WebRTC-Datenkanal; öffentliche STUN-Server von Google/Cloudflare zur
Adressermittlung). Nach jedem Beitritt stellt der Gastgeber sofort ein neues Angebot bereit, so dass weitere Freunde denselben Link nutzen.
- Der Gastgeber führt den Raum (prüft die Züge, rechnet KI-Gegner) und muss FRONTLINIE offen und den Bildschirm an lassen. Die Partie
  läuft, solange die Verbindung steht; im Internet wird nichts gespeichert (nur das Gerät des Gastgebers merkt sich den Raum unter
  „Deine Spiele“). Reißt die Verbindung ab, den Link einfach nochmal antippen (oder Spielmenü → „Neu verbinden“) – man landet wieder
  auf seinem Platz.
- Der Link braucht eine https-Adresse, unter der auch die Freunde das Spiel erreichen, z. B. GitHub Pages (`node tools/build-web.js`,
  dann `dist/` hochladen). Ein Link auf `localhost` oder eine WLAN-Adresse funktioniert nur im eigenen Netz bzw. Gerät.
- Grenzen: ntfy.sh erlaubt ohne Konto etwa 250 Nachrichten pro Tag und IP-Adresse (ein Beitritt braucht 2–4), Nachrichten bis 4 KB
  (längere werden gestückelt) und hält sie 12 Stunden vor. Klappt der Austausch nicht (Dienst weg, Gastgeber weg, Zeitüberschreitung
  nach spätestens 25 Sekunden), nennt das Spiel den Grund und bietet den QR-Weg an. Zwischen manchen Mobilfunknetzen kommt keine
  Direktverbindung zustande (es gibt keinen Umleitungs-/TURN-Server) – dann hilft dasselbe WLAN oder der Hotspot des Gastgebers.
- Anderer Dienst: Die Adresse steht als `P2P.RELAY` in `js/p2p.js` (ein eigener ntfy-Server funktioniert ohne weitere Änderung);
  über `P2P.relayFactory` lässt sich ein ganz anderer Dienst (z. B. MQTT) einsetzen.

**Ersatzweg ohne Internet (Codes per QR):**
1. **Handy 1:** **Mit Freunden spielen → Spiel eröffnen (ohne Internet)**, Karte wählen → „Raum eröffnen“ → **„Einladung per QR-Code“**.
2. **Handy 2:** **Mit Freunden spielen → Beitreten → Scannen** und den QR-Code von Handy 1 scannen. Handy 2 zeigt einen Antwort-Code.
3. **Handy 1:** bei „Antwort“ auf **Scannen** tippen und den Code von Handy 2 scannen → verbunden → „Spiel starten“.

Statt zu scannen lassen sich die Codes per Messenger schicken („Teilen“) und einfügen. Am zuverlässigsten im selben WLAN
oder im Hotspot von Handy 1 (geht dann ganz ohne Internet). Beide Geräte brauchen dieselbe Spielversion. Reißt die Verbindung ab:
Spielmenü → „Mitspieler verbinden“ (Handy 1) bzw. „Neu verbinden“ (Handy 2), Codes erneut tauschen – das Spiel geht genau dort
weiter. QR-Leser jsQR (Apache-2.0, `js/jsqr.js`, Lizenz in `docs/LICENSE-jsQR.txt`) für Browser ohne eingebauten Leser.

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
- 10 Kommandanten mit je zwei Kräften (Kraft und Superkraft; die Sterne laden sich im Kampf auf):
  Rika (ausgeglichen, heilt), Bastian (Nahkampf), Jara (Artillerie; ihre Kräfte reparieren Maschinen), Viktor (Verteidigung),
  Tilda (Geld: +10 % Einkommen, Kräfte zahlen sofort aus), Mira (Luftwaffe), Frida (Schnee: lässt es schneien,
  im Schnee stärker und ohne Bewegungsnachteil), Kurt (Infanterie, schnelle Einnahme), Nora (Regen: lässt es regnen,
  im Regen +10 % Angriff und ohne Bewegungsnachteil), Marschall Krähe (zermürbt mit seinen Kräften alle Gegner).
  Wetter-Kräfte gelten heute und morgen, auch bei „Immer klar“. Ausbalanciert per KI-gegen-KI-Messung
  (`tools/co-balance.js`, schwer gegen schwer, 1080 Partien auf Grenzland, Langes Tal und Seenkreuz): jede Siegquote liegt zwischen 44 und 57 % (vorher 14–92 %)
- Fusion: Ein Spieler kann zwei Kommandanten wählen, die gemeinsam führen – Angriffs- und Verteidigungsboni beider zu je 70 %,
  Bewegung, Reichweite und Sicht addiert, Einkommenszuschläge zu 70 %, Wetterfestigkeit beider, beide Kräfte zugleich (Sterne: 75 % der Summe). Wählbar bei der Kommandantenwahl vor
  dem Spiel, in der Online-Lobby über „＋ Fusion“ (auch der Gastgeber für KI-Plätze)
- Kampagne mit 12 Missionen, 23 Gefechtskarten (30×30 bis 71×59) für 2–4 Spieler: Kontinent, Rund, L, Ring mit Mittelinsel, Hufeisen, langes Tal, zwei Kontinente, Hochgebirge, Eisseen sowie vier Seekarten ohne Landweg zwischen den Spielern (Inselreich, Küstenkrieg, Vier Inseln, Dreimeer) mit Häfen, Stränden und Riffen, dazu vier Schnellkarten 30×30 für kurze Duelle (Flussgabel, Ahornbucht, Seenkreuz, Bergpass: HQ-Fußweg 26–30, erste neutrale Stadt 3 Felder vor dem HQ, ein Gebäude je ~15 Landfelder). Jede Karte ist auf Tempo gebaut: HQ-Fußweg 34–46 Felder, 3–4 neutrale Städte in Reichweite der ersten Infanterie (≤ 6 Felder), je Spieler eine Vorposten-Fabrik auf halbem Weg, umkämpfte Mitte mit Fabrik/Flughafen/Hafen, ein Gebäude je ~20 Landfelder
- Landschaften Sommer, Herbst, Winter, Gebirge; Wetter Regen, Schnee, Nacht (wechselhaft, Tag & Nacht oder dauerhaft) mit Auswirkungen auf Bewegung und Sicht
- Grafik: vektorgezeichnetes Gelände in hoher Auflösung (Küsten mit Untiefen und Gischt, Berge mit Schneekappen, Wälder, Straßen, Flüsse, Gebäude mit Tiefe und Teamfarbe), per Scale3x geglättete Einheiten mit Schatten und KP-Plaketten
- Oberfläche im Feldkommando-Stil (css/style.css): Oliv/Khaki, Signalorange, abgeschrägte Ecken, Stempelschrift; Titelbildschirm mit lebendiger Front (Kameraschwenk über eine echte Karte, zwei Heere beziehen Stellung und beschießen sich, Flieger, Wolkenschatten)
- Bewegungsbereich (blau, helle Kontur) und Angriffsbereich (rot schraffiert) sind klar getrennt; laufende Einnahmen zeigen einen Fortschrittsbalken über der Einheit, die Info-Karte „Einnahme läuft“ und das Spiel fragt nach, bevor eine halb eingenommene Stadt verlassen wird
- Minikarte (Taste C) mit Ein-/Ausklapp-Knopf, Transporter zeigen ihre Ladung (Bilder mit KP)
- Knöpfe unten rechts (Touch): „Nächste“ schaltet durch die bereiten Einheiten und wird zu „Ende“, sobald alle gehandelt haben; „Wählen“ bestätigt – ohne genaues Tippen auf die Einheit; die Info-Karten rücken darüber
- Touch-Bedienung: Tipp außerhalb der Reichweite hebt die Auswahl auf; ein Tipp auf ein leeres Feld setzt nur den Cursor, ein zweiter Tipp auf dasselbe Feld öffnet das Menü (auch ☰ oder Esc); bei mehreren Zielen zeigt der erste Tipp die Schadensvorschau, der zweite greift an (am PC: Maus darüber = Vorschau). „Nächste“ zeigt die Zahl der noch bereiten Einheiten und wird zu „Ende“ (mit Rückfrage), wenn alle gehandelt haben
- Zug rückgängig (Menü oder U), einmal je Runde: der letzte Zug oder Bau wird zurückgenommen – nicht nach Angriffen, Hinterhalten oder wenn der Zug neue Gegner aufgedeckt hat (sonst gäbe es Nebel-Wissen gratis); online läuft das als normaler Befehl über alle Geräte
- Gegner-Sicht (Auge-Knopf oder V): gelb markiert, welche Felder sichtbare Gegner einsehen; Gegner-Reichweite (Q oder Menü): lila, wo sie angreifen können; die Einheitenkarte zeigt die Sichtweite (👁)
- Tastenkürzel für alles Wichtige, Übersicht mit **F1** oder **?** (z. B. N/Tab nächste Einheit, B nächste Fabrik, H Hauptquartier, E Runde beenden, 1–9 Menüeintrag, Strg+S Speichern)
- Gegner-KI in drei Stufen, Hotseat für mehrere Menschen, Teams, Online-Gefecht übers Netzwerk (Handy-tauglich), Handy zu Handy ohne PC
- Online: Wer wartet, kann seine Einheiten **vorplanen** (antippen → Ziel → Aktion), auch während der Gegner gerade zieht; eine Leiste erklärt es. Die Pläne laufen zu Beginn des eigenen Zuges automatisch ab, sofern noch möglich; alle anderen Einheiten bleiben frei
- Fabrik: Steckbrief jeder Einheit (Knopf „i“ bzw. Taste I) mit allen Werten und Stärken/Schwächen; auf dem Handy erst antippen (Werte), nochmal tippen (bauen)
- Kommandanten vor dem Spiel nachlesen und wählen: aufs Porträt tippen (Gefecht-Menü und Online-Lobby)
- Handy: stufenloser Fingerzoom (rastet weich auf scharfe Stufen ein), Mausrad zum Zeiger hin, scharfe Darstellung bei hoher Pixeldichte
- Die KI gibt bei aussichtsloser Lage auf (abschaltbar)
- Karteneditor mit Symmetrie-Werkzeug, Export/Import und **🎲 Zufallskarte**: Spielerzahl (2/4), Größe, Landform (Kontinent, Insel, Ring, zwei Kontinente, Gebirgspass, Seenplatte, langes Tal) und Landschaft wählen – der Generator (`js/mapgen.js`) baut eine symmetrische Karte und prüft sie auf Fairness (gleiche Gebäude, gleich lange Wege)
- Kommandantenwahl mit **🎲 Zufall** je Platz (oder „Alle Kommandanten zufällig“); ausgelost wird erst beim Spielstart, möglichst ohne Doppelungen – auch im Einladungs-Raum
- Speichern (3 Slots + Autosave), Kampfanimationen, Chiptune-Musik

## Entwicklung
- `node tests/core.test.js` – Regeltests; `node tests/net.test.js` – Online-Spiel (Server, Synchronität, Wiederverbindung); `node tests/p2p.test.js` – Handy zu Handy: Verbindungscodes und Einladungslink (Relay-Protokoll, Stückelung, Verschlüsselung, Zeitüberschreitungen – mit nachgebildetem ntfy.sh)
- `node tests/undo.test.js` – Rückgängig-Regeln
- `node tests/random.test.js` – Zufallskarten (alle Landformen/Größen fair und spielbar) und Zufalls-Kommandanten
- `node tools/sim.js` – KI-gegen-KI-Simulation über alle Karten
- `node tools/co-balance.js [--seeds 3] [--maps grenzland,langes-tal] [--focus nora]` – Kommandanten-Balance: KI gegen KI (schwer gegen schwer), jedes Paar in beiden Sitzen, Siegquote je Kommandant (Ziel 40–60 %), `--json`/`--compare` für Vorher/Nachher
- `node tools/check-maps.js` – Kartenprüfung
- `node tools/mapgen.js` – erzeugt js/maps.js neu (symmetrische, faire Karten; der Generator-Kern liegt in `js/mapgen.js` und läuft auch im Browser); `node tools/preview-maps.js` – PNG-Übersicht
- `node tools/sim.js --limit auto` – Simulation mit Tageslimit; `tools/bench.sh '<tune-json>'` vergleicht KI-Parameter nach Ø Spieltagen
- Spiellogik (`js/data.js`, `js/game.js`, `js/ai.js`, Karten) und Spielräume (`js/room.js`, genutzt vom PC-Server und vom Gastgeber-Handy) sind DOM-frei.
- Darstellung (`js/render.js`): Geländefelder werden vektoriell in 16er-Koordinaten gemalt und je Umgebung gecacht (Detailfaktor 2–4 je Kartengröße); Einheiten/Porträts entstehen per Scale3x aus den 16×16-Rastern in `js/sprites*.js`.

## Veröffentlichen (GitHub Pages, kostenlos)
1. Repository auf GitHub anlegen und diesen Ordner hochladen (`git remote add origin …`, `git push -u origin main`).
2. Im Repository: **Settings → Pages → Source: „GitHub Actions“**.
3. Jeder Push auf `main` startet `.github/workflows/pages.yml`: Tests, `node tools/build-web.js`, Veröffentlichung von `dist/`
   unter `https://<name>.github.io/<repo>/`. Diese Adresse bleibt fest – einmal pro Gerät öffnen und „Zum Home-Bildschirm“,
   Updates holt sich die App selbst. Einladungslinks zeigen ebenfalls auf diese Adresse.

## Testszenario
`index.html#demo-pionier` startet ein Szenario mit Pionier, Bergepanzer, Flugzeugträger und Schlachtflieger; `index.html#demo-kampf` eine Panzer-Kampfszene.
