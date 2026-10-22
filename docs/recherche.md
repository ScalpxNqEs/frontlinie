# Recherche: Spielmechanik Advance Wars 1/2 (Referenz für FRONTLINIE)

Kompakte Regelreferenz in eigenen Worten. Es geht nur um Regeln und Zahlen, nicht um Story, Figuren oder Grafik.
Die Einheiten-IDs entsprechen unserer `SPEC.md` (z. B. `titan` = Neotank aus AW2).

**Quellenlage:** Hauptquelle sind die Tabellen von *Advance Wars By Web* (AWBW, awbw.amarriner.com, plus dessen Wiki). AWBW
setzt nach eigener Aussage die Regeln von AW2 um, CO-Werte und Schadenstabelle eingeschlossen, und listet seine wenigen Abweichungen auf (siehe §9).
Dazu kamen Fan-Wikis (Fandom, StrategyWiki) und ein GameSpot-Guide. Wo sich Quellen widersprechen, steht die plausibelste Variante
im Text und daneben **(unsicher)**.

---

## 1. Kampf und Schaden

### 1.1 Lebenspunkte
- Jede Einheit hat intern **100 HP**, egal wie teuer sie ist.
- Angezeigt werden **1–10 HP**: `anzeigeHP = ceil(internHP / 10)`. Bei 10 steht keine Zahl am Sprite.
  Eine Einheit mit 91 % zeigt also 10, eine mit 1 % zeigt 1.
- Schaden wird intern in Prozent (= interne HP) abgezogen.
- **Angriffsstärke und Geländeschutz rechnen mit den angezeigten HP.** Abgezogen wird aber von den internen HP.

### 1.2 Schadensformel (AW2, in AWBW übernommen; AW1 rechnet im Kern genauso)

```
schaden% = ( B * AV/100 + L ) * (HP_A / 10) * ( 200 - (DV + Sterne * HP_D) ) / 100
```

| Größe | Bedeutung |
|---|---|
| `B` | Basisschaden für die Paarung Angreifer → Ziel aus der Tabelle (§4), mit der verwendeten Waffe |
| `AV` | Angriffswert, Standard 100. CO-Boni addieren sich, z. B. +10 während einer Power → 110 |
| `L` | Glück: ganzzahliger Zufallswert **0–9** (gleichverteilt). Er wird als flache Prozentpunkte addiert und **nicht** mit `AV` multipliziert |
| `HP_A` | angezeigte HP des Angreifers (1–10) |
| `DV` | Verteidigungswert, Standard 100. CO-Boni addieren sich, z. B. +10 während einer Power → 110 |
| `Sterne` | Verteidigungssterne des Geländes unter dem Verteidiger (0–4). **Lufteinheiten bekommen immer 0** |
| `HP_D` | angezeigte HP des Verteidigers (1–10) |

- Geländeschutz: Jeder Stern gibt 10 % Verteidigung, skaliert mit `HP_D/10`. Deshalb steht in der Formel `Sterne × HP_D` (in Prozentpunkten).
  Beispiel: 10 HP im Wald (2 Sterne) → 20 % weniger Schaden; 5 HP im Wald → nur 10 %.
- **Rundung** (AWBW ahmt damit das Modul nach): Das Ergebnis wird zuerst **auf das nächste Vielfache von 0,05 aufgerundet** und dann
  **abgerundet**. Ein Wert von 0,936 wird so zu 0,95 und dann zu 0; ein Wert von 0,96 wird zu 1. Negative Ergebnisse werden zu 0.
  JS-Vorschlag: `dmg = Math.max(0, Math.floor(Math.ceil(x * 20 - 1e-9) / 20))`.
  Einfachere Variante, nur aus Fan-Quellen belegt: `floor(x)`.
- Ohne Basiswert (`–` in der Tabelle) ist kein Angriff möglich. Jeder vorhandene Basiswert ist mindestens 1.
- Kampf kann eine Einheit auf 0 bringen und zerstören. Schaden außerhalb des Kampfes (Power-Effekte, Raketensilo) lässt mindestens 1 HP übrig.

**Rechenbeispiele** (ohne CO-Boni):
- Panzer (10 HP) greift Infanterie (10 HP) im Wald an, MG-Basis 75:
  `(75 + 0..9) × 1,0 × (200 − 120)/100` = 60,0 … 67,2 → **60–67 %**.
- Infanterie (10 HP) greift Panzer (10 HP) auf der Ebene an, Basis 5:
  `(5 + 0..9) × 0,9` = 4,5 … 12,6 → **4–12 %**.
  Glück wirkt also bei schwachen Einheiten besonders stark.
- Ein Angreifer mit 5 HP macht halb so viel Schaden, das Glück eingeschlossen.

Folgerungen aus der Formel:
- Angriffsboni wirken nur auf `B`.
- Verteidigungsboni wirken auf den gesamten Schaden. Verteidigung stapelt sich deshalb stärker.
- Bei 100 % Gesamtverteidigung ist eine Einheit im Kampf unverwundbar.

### 1.3 Gegenangriff
- Ein Gegenangriff folgt nur, wenn alle drei Bedingungen erfüllt sind:
  1. Der Angriff war **direkt** (Reichweite 1).
  2. Der Verteidiger **überlebt**.
  3. Der Verteidiger hat einen Basiswert gegen den Angreifer und, falls die Waffe Munition braucht, noch Munition.
- **Fernkampfeinheiten** (Artillerie, Raketenwerfer, Flugabwehrraketen, Schlachtschiff) werden nie gekontert. Wer sie direkt angreift, bekommt
  auch keinen Konter von ihnen: Ihre Mindestreichweite ist 2 (bzw. 3), sie können also nicht auf Nachbarfelder schießen.
- Der Konter benutzt dieselbe Formel mit vertauschten Rollen. Es zählen die **neuen, reduzierten HP** des Verteidigers und das Gelände unter dem Angreifer.
- Fernkämpfer dürfen **nicht im selben Zug ziehen und feuern**. Sie feuern nur, wenn sie in diesem Zug nicht bewegt wurden.
  Direkte Einheiten dürfen ziehen und danach angreifen.

### 1.4 Primär- und Sekundärwaffe, Munition
- Viele Einheiten haben eine **Primärwaffe** mit Munition (Kanone, Bazooka, Raketen) und eine **Sekundärwaffe** (MG) ohne Munitionsverbrauch.
- Gewählt wird automatisch die Waffe mit Basiswert. Gibt es beide, nimmt das Spiel die Primärwaffe, solange Munition da ist.
  Gegen Fußtruppen und Helikopter haben Panzer nur einen MG-Wert.
- Jeder Schuss mit der Primärwaffe kostet 1 Munition, auch beim Konter.
- Bei 0 Munition bleibt nur das MG. Wer keins hat, kann weder angreifen noch kontern.

---

## 2. Gelände

### 2.1 Verteidigung und Bewegungskosten (klares Wetter)
Legende Bewegungsarten: **Fuß** (Infanterie), **Stiefel** (Mech), **Kette**, **Reifen**, **Luft**, **See**, **Landungsboot** (Lander).
`–` = unpassierbar.

| Gelände (SPEC-Zeichen) | Sterne | Fuß | Stiefel | Kette | Reifen | Luft | See | Lander |
|---|---|---|---|---|---|---|---|---|
| Ebene `P` | 1 | 1 | 1 | 1 | 2 | 1 | – | – |
| Wald `F` | 2 | 1 | 1 | 2 | 3 | 1 | – | – |
| Berg `M` | 4 | 2 | 1 | – | – | 1 | – | – |
| Straße `R` | 0 | 1 | 1 | 1 | 1 | 1 | – | – |
| Brücke `B` | 0 | 1 | 1 | 1 | 1 | 1 | – | – |
| Fluss `I` | 0 | 2 | 1 | – | – | 1 | – | – |
| Meer `S` | 0 | – | – | – | – | 1 | 1 | 1 |
| Strand/Untiefe `H` | 0 | 1 | 1 | 1 | 1 | 1 | – | 1 |
| Riff `X` | 1 | – | – | – | – | 1 | 2 | 2 |
| Stadt `C` | 3 | 1 | 1 | 1 | 1 | 1 | – | – |
| Fabrik/Basis `K` | 3 | 1 | 1 | 1 | 1 | 1 | – | – |
| Flughafen `A` | 3 | 1 | 1 | 1 | 1 | 1 | – | – |
| Hafen `O` | 3 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| Hauptquartier `Q` | 4 | 1 | 1 | 1 | 1 | 1 | – | – |

- Lufteinheiten bekommen **keinen** Geländeschutz.
- Schiffe bekommen auf Meer 0 Sterne, auf Riff 1 Stern und im Hafen 3 Sterne.
- Brücken sperren Schiffe.
- Landungsboote laden und entladen nur auf **Strand** oder im **Hafen**.
- Bewegungspunkte werden pro Feld nach den Kosten abgezogen. Der Treibstoff sinkt um die verbrauchten Bewegungspunkte (§3.2).
- Eigene Einheiten darf man durchqueren, aber nicht auf ihnen stehen bleiben (außer bei Join oder Laden). Feindliche Einheiten blockieren.

**Wetter** (AW2, Gefecht optional; Regen und Schnee):
- **Regen:** Kette und Reifen zahlen +1 auf Ebene und Wald. Im Nebel sinkt die Sicht aller Einheiten um 1 (Minimum 1).
- **Schnee:**
  - Infanterie zahlt doppelt auf Ebene, Wald und Berg.
  - Mech zahlt doppelt auf Berg.
  - Kette und Reifen zahlen +1 auf Ebene.
  - Luft zahlt überall doppelt.
  - See und Lander zahlen doppelt auf Meer und Hafen.
- **Zufallswetter** (AWBW): etwa 4 % Chance pro Zug auf Regen und 4 % auf Schnee, jeweils für 1 Tag.

### 2.2 Nebel des Krieges (Fog of War)
- Jede Einheit deckt Felder im **Sichtradius** (Manhattan-Distanz) auf. Eigene Gebäude decken ihr eigenes Feld auf.
- Die Sicht wird zwischen allen Einheiten eines Spielers und unter Verbündeten geteilt.
- **Wald und Riff verbergen** Boden- und Seeeinheiten. Sie werden erst sichtbar, wenn eine gegnerische Einheit **direkt angrenzt**.
  Lufteinheiten werden dort nicht verborgen.
- **Berg:** Infanterie und Mech bekommen dort **+3 Sicht**. Lufteinheiten bekommen den Bonus nicht.
- Was man nicht sieht, kann man nicht angreifen.
- Im Nebel sind auch Gegnergeld und Einheitenzahl unbekannt. Die Power-Leiste des Gegners bleibt sichtbar.
- **Hinterhalt ("Trap"):** Läuft eine Einheit über ein Feld mit einer unsichtbaren Feindeinheit, bricht der Zug direkt davor ab.
  Die Einheit darf in diesem Zug nichts mehr tun, kann also weder angreifen noch einnehmen.
  Im Modul gilt das auch für einen Transporter, der auf ein solches Feld entladen will: Das Entladen scheitert.

---

## 3. Einheiten

### 3.1 Werte (AW2/AWBW)
Abkürzungen: Bew = Bewegungspunkte, Treib = Treibstoff, T/Tag = Verbrauch pro Tag, Mun = Munition der Primärwaffe (0 = nur MG oder unbewaffnet).

| ID | Original | Kosten | Bew | Art | Sicht | Treib | T/Tag | Mun | Reichw. | Besonderes |
|---|---|---|---|---|---|---|---|---|---|---|
| inf | Infantry | 1000 | 3 | Fuß | 2 | 99 | 0 | 0 (MG) | 1 | Einnehmen; +3 Sicht auf Berg |
| mech | Mech | 3000 | 2 | Stiefel | 2 | 70 | 0 | 3 (+MG) | 1 | Einnehmen; Bazooka gegen Fahrzeuge |
| recon | Recon | 4000 | 8 | Reifen | 5 | 80 | 0 | 0 (MG) | 1 | Späher |
| apc | APC | 5000 | 6 | Kette | 1 | 70 | 0 | – | – | Trägt 1 Inf/Mech; versorgt Nachbarn |
| tank | Tank | 7000 | 6 | Kette | 3 | 70 | 0 | 9 (+MG) | 1 | |
| mdtank | Md. Tank | 16000 | 5 | Kette | 1 | 50 | 0 | 8 (+MG) | 1 | |
| titan | Neotank (AW2) | 22000 | 6 | Kette | 1 | 99 | 0 | 9 (+MG) | 1 | |
| arty | Artillery | 6000 | 5 | Kette | 1 | 50 | 0 | 9 | 2–3 | Fernkampf |
| rocket | Rockets | 15000 | 5 | Reifen | 1 | 50 | 0 | 6 | 3–5 | Fernkampf |
| aa | Anti-Air | 8000 | 6 | Kette | 2 | 60 | 0 | 9 | 1 | Stark gegen Luft und Infanterie |
| missile | Missiles | 12000 | 4 | Reifen | 5 | 50 | 0 | 6 | 3–5 | Fernkampf, nur gegen Luft |
| tcopter | T-Copter | 5000 | 6 | Luft | 2 | 99 | 2 | – | – | Trägt 1 Inf/Mech |
| bcopter | B-Copter | 9000 | 6 | Luft | 3 | 99 | 2 | 6 (+MG) | 1 | |
| fighter | Fighter | 20000 | 9 | Luft | 2 | 99 | 5 | 9 | 1 | Nur gegen Luft |
| bomber | Bomber | 22000 | 7 | Luft | 2 | 99 | 5 | 9 | 1 | Nur gegen Boden und See |
| lander | Lander | 12000 | 6 | Lander | 1 | 99 | 1 | – | – | Trägt 2 beliebige Bodeneinheiten |
| cruiser | Cruiser | 18000 | 6 | See | 3 | 99 | 1 | 9 (+Flak) | 1 | Jagt U-Boote; Flak gegen Luft; trägt 2 Helikopter |
| sub | Sub | 20000 | 5 | See | 5 | 60 | 1 (getaucht 5) | 6 | 1 | Tauchen/Auftauchen |
| battleship | Battleship | 28000 | 5 | See | 2 | 99 | 1 | 9 | 2–6 | Fernkampf |

Hinweise zur Tabelle:
- Neotank gibt es erst in AW2. Die übrigen Werte gelten in AW1 und AW2 weitgehend gleich.
- Im Original werden Kosten in "G" angegeben. Typische Gefechtseinstellung: 1000 G Einkommen pro Gebäude und Tag.

### 3.2 Treibstoff
- Bewegung verbraucht 1 Treibstoff pro verbrauchtem Bewegungspunkt. Ein Panzer zahlt im Wald also 2 pro Feld.
- Bei 0 Treibstoff kann eine Einheit nicht mehr ziehen. Bodeneinheiten bleiben dann einfach stehen.
- **Luft- und Seeeinheiten** verlieren zu Beginn jedes eigenen Tages ihren Tagesverbrauch:
  - Helikopter 2, Flugzeuge 5, Schiffe 1, getauchtes U-Boot 5.
  - Fällt der Treibstoff dabei auf 0, **stürzt die Einheit ab oder sinkt**.
  - Reihenfolge im Modul: erst Tagesverbrauch und Absturz, dann Versorgung durch APC.
    AWBW versorgt zuerst; dort kann ein APC eine Einheit mit 0 Treibstoff also noch retten.

### 3.3 Sonderfähigkeiten
- **Einnehmen** (nur `inf` und `mech`), siehe §5.1.
- **APC – Versorgen:**
  - Zu Beginn des eigenen Zuges füllt der APC Treibstoff und Munition aller angrenzenden eigenen Einheiten automatisch auf.
  - Dasselbe geht manuell mit dem Befehl "Versorgen"; danach ist sein Zug beendet.
  - Der APC trägt 1 Infanterie oder 1 Mech.
- **Laden und Entladen:**
  - Eine Einheit zieht auf den Transporter und wird verladen ("Laden").
  - Der Transporter entlädt am Ende seiner Bewegung auf ein angrenzendes, für die Fracht begehbares Feld. Danach ist sein Zug zu Ende.
    In AWBW darf er jederzeit entladen, das ist eine Abweichung vom Modul.
  - Entladene Einheiten dürfen im selben Zug nichts mehr tun.
  - Wird ein Transporter zerstört, ist die Fracht auch verloren.
  - Verladene Einheiten nehmen keinen Schaden und sind für Effekte unerreichbar.
  - Kapazitäten:

    | Transporter | Kapazität |
    |---|---|
    | APC, T-Copter | 1 Fußeinheit |
    | Lander | 2 Bodeneinheiten (beliebig); laden/entladen nur auf Strand oder im Hafen |
    | Cruiser | 2 Helikopter (B/T); versorgt sie zu Tagesbeginn |
- **U-Boot – Tauchen/Auftauchen** (Aktion, die den Zug beendet):
  - Getaucht ist das U-Boot für den Gegner **unsichtbar, auch ohne Nebel**.
  - Sichtbar wird es nur, wenn eine gegnerische Einheit angrenzt.
  - Getaucht können es nur **Cruiser und U-Boote** angreifen.
  - Verbrauch getaucht: 5 Treibstoff pro Tag.
- **Join (Zusammenführen):**
  - Eine Einheit zieht auf eine **beschädigte** eigene Einheit **desselben Typs**.
  - HP, Treibstoff und Munition werden addiert, jeweils begrenzt auf das Maximum.
  - Überschüssige HP über 10 werden in Geld erstattet, **10 % des Stückpreises pro HP**. Diese Erstattung gilt in AW2 und AWBW; ob es sie in AW1 schon gab: (unsicher).
  - Die vereinte Einheit ist für diesen Zug fertig.
  - Ein Einnahme-Fortschritt bleibt erhalten.
  - Transporter dürfen nur leer zusammengeführt werden.
- **Produktion:**
  - Fabrik (`K`) baut Bodeneinheiten, Flughafen (`A`) Lufteinheiten, Hafen (`O`) Seeeinheiten.
  - Pro Gebäude und Tag 1 Einheit, und nur wenn das Feld frei ist.
  - Neu gebaute Einheiten sind im Bauzug erschöpft.

---

## 4. Basis-Schadenstabelle (AW2-Werte, Quelle AWBW)
Zeilen = Angreifer, Spalten = Ziel, Werte in % bei 10 HP gegen 10 HP, ohne Boni, Glück und Gelände.

Notation:
- `55/6`: Primärwaffe 55, MG 6. Die Primärwaffe wird benutzt, solange Munition da ist; ohne Munition gilt das MG.
- `·75`: nur das MG (kein Munitionsverbrauch).
- `–`: kein Angriff möglich.
- Gegen ein **getauchtes** U-Boot gelten nur die Werte von Cruiser (90) und Sub (55).

| Angr.↓ / Ziel→ | inf | mech | recon | apc | tank | mdtank | titan | arty | rocket | aa | missile | tcopter | bcopter | fighter | bomber | lander | cruiser | sub | battleship |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **inf** | 55 | 45 | 12 | 12 | 5 | 1 | 1 | 15 | 25 | 5 | 25 | 30 | 7 | – | – | – | – | – | – |
| **mech** | ·65 | ·55 | 85/18 | 75/20 | 55/6 | 15/1 | 15/1 | 70/32 | 85/35 | 65/6 | 85/35 | ·35 | ·9 | – | – | – | – | – | – |
| **recon** | 70 | 65 | 35 | 45 | 6 | 1 | 1 | 45 | 55 | 4 | 28 | 35 | 10 | – | – | – | – | – | – |
| **apc** | – | – | – | – | – | – | – | – | – | – | – | – | – | – | – | – | – | – | – |
| **tank** | ·75 | ·70 | 85/40 | 75/54 | 55/6 | 15/1 | 15/1 | 70/45 | 85/55 | 65/5 | 85/30 | ·40 | ·10 | – | – | 10 | 5 | 1 | 1 |
| **mdtank** | ·105 | ·95 | 105/45 | 105/45 | 85/8 | 55/1 | 45/1 | 105/45 | 105/45 | 105/7 | 105/35 | ·45 | ·12 | – | – | 35 | 45 | 10 | 10 |
| **titan** | ·125 | ·115 | 125/65 | 125/65 | 105/10 | 75/1 | 55/1 | 115/65 | 125/75 | 115/17 | 125/55 | ·55 | ·22 | – | – | 40 | 50 | 15 | 15 |
| **arty** | 90 | 85 | 80 | 70 | 70 | 45 | 40 | 75 | 80 | 75 | 80 | – | – | – | – | 55 | 65 | 60 | 40 |
| **rocket** | 95 | 90 | 90 | 80 | 80 | 55 | 50 | 80 | 85 | 85 | 90 | – | – | – | – | 60 | 85 | 85 | 55 |
| **aa** | 105 | 105 | 60 | 50 | 25 | 10 | 5 | 50 | 55 | 45 | 55 | 120 | 120 | 65 | 75 | – | – | – | – |
| **missile** | – | – | – | – | – | – | – | – | – | – | – | 120 | 120 | 100 | 100 | – | – | – | – |
| **tcopter** | – | – | – | – | – | – | – | – | – | – | – | – | – | – | – | – | – | – | – |
| **bcopter** | ·75 | ·75 | 55/30 | 60/20 | 55/6 | 25/1 | 20/1 | 65/25 | 65/35 | 25/6 | 65/35 | ·95 | ·65 | – | – | 25 | 55 | 25 | 25 |
| **fighter** | – | – | – | – | – | – | – | – | – | – | – | 100 | 100 | 55 | 100 | – | – | – | – |
| **bomber** | 110 | 110 | 105 | 105 | 105 | 95 | 90 | 105 | 105 | 95 | 105 | – | – | – | – | 95 | 85 | 95 | 75 |
| **lander** | – | – | – | – | – | – | – | – | – | – | – | – | – | – | – | – | – | – | – |
| **cruiser** | – | – | – | – | – | – | – | – | – | – | – | ·115 | ·115 | ·55 | ·65 | – | – | 90 | – |
| **sub** | – | – | – | – | – | – | – | – | – | – | – | – | – | – | – | 95 | 25 | 55 | 55 |
| **battleship** | 95 | 90 | 90 | 80 | 80 | 55 | 50 | 80 | 85 | 85 | 90 | – | – | – | – | 95 | 95 | 95 | 50 |

Hinweise:
- Einheiten ohne MG-Angabe (Artillerie, Raketen, Flugabwehr, Schlachtschiff, Bomber, Jäger, U-Boot, Flugabwehrraketen) können mit 0 Munition gar nicht schießen.
- Infanterie und Recon haben nur ein MG mit unbegrenzter Munition.
- Der Cruiser greift mit Raketen (Munition) U-Boote an und mit Flak (ohne Munition) Lufteinheiten. Schlachtschiffe, Lander und andere Cruiser kann er in AW2 nicht angreifen.

---

## 5. Wirtschaft, Einnahme, Versorgung, Sieg

### 5.1 Einnehmen
- Jedes einnehmbare Gebäude (Stadt, Fabrik, Flughafen, Hafen, HQ) hat **20 Einnahmepunkte**.
- Die Aktion "Einnehmen" zieht die **angezeigten HP** der Fußeinheit ab: Mit 10 HP dauert es 2 Züge, mit 9 HP 3 Züge.
- Bei 0 Punkten wechselt das Gebäude den Besitzer, und der Zähler springt auf 20 zurück.
- Verlässt die Einheit das Feld oder stirbt sie, wird der Zähler **auf 20 zurückgesetzt**.
- Eine andere Aktion auf dem Feld (z. B. Angreifen) pausiert die Einnahme, setzt sie aber nicht zurück.
- Join erhält den Fortschritt und kann die Einnahme so beschleunigen.

### 5.2 Einkommen
- Standard: **1000 G pro eigenem Gebäude und Tag**, gezahlt zu Beginn des eigenen Zuges. Das gilt für HQ, Stadt, Fabrik, Flughafen und Hafen.
- Im Versus-Modus kann man den Betrag pro Gebäude einstellen (AW2: 1000–9500 in 500er-Schritten).

### 5.3 Reparatur und Nachschub
- Gilt zu Beginn des eigenen Zuges für eigene Einheiten auf einem **eigenen** passenden Gebäude:
  - Bodeneinheiten auf Stadt, Fabrik oder HQ.
  - Luft auf Flughafen.
  - See auf Hafen.
- **+2 angezeigte HP** (höchstens 10) und vollständiges Auffüllen von Treibstoff und Munition.
- **Kosten:** 10 % des Stückpreises pro geheiltem HP, für +2 HP also 20 %.
  - Im Modul wird auf den nächsten vollen Anzeige-HP-Wert geheilt. AWBW heilt immer genau 20 interne HP.
  - Reicht das Geld nicht, gibt es keine Reparatur (AWBW) oder nur +1 HP (unsicher, Modul). Nachschub ist immer gratis.
- Versorgung durch APC: siehe §3.3. Der Cruiser versorgt seine geladenen Helikopter.

### 5.4 Siegbedingungen
- **HQ des Gegners einnehmen.** Damit ist der Gegner sofort besiegt.
- **Alle Einheiten des Gegners vernichten** ("Rout"). Das greift erst, wenn der Gegner schon Einheiten hatte bzw. nach dem ersten Tag.
- Gegner **gibt auf** (Menüpunkt "Aufgeben").
- Kampagnenkarten können eigene Ziele haben, z. B.:
  - eine bestimmte Einheit vernichten oder ein Gebäude halten,
  - X Tage überstehen,
  - eine Mindestzahl an Gebäuden besitzen.
- In AWBW und späteren Teilen gibt es optional auch ein Gebäude-Limit ("Capture Limit") und ein Tageslimit.
- Im Mehrspieler scheidet der besiegte Spieler aus und seine Einheiten verschwinden. Was mit seinen Gebäuden passiert, war nicht eindeutig belegt (unsicher).

### 5.5 Tagesablauf (Zugbeginn eines Spielers)
1. Einkommen gutschreiben.
2. Reparatur und Nachschub auf Gebäuden.
3. Tagesverbrauch von Luft- und Seeeinheiten abziehen, Absturz bei 0.
4. APC-Versorgung der angrenzenden Einheiten.
5. Wetter und Power-Effekte des Vortags laufen aus.

Danach ziehen die Einheiten in beliebiger Reihenfolge, jede einmal: Bewegen und dann Feuern, Einnehmen, Laden, Join, Versorgen, Tauchen oder Warten.
Zum Schluss beendet der Spieler seinen Zug. Nach dem letzten Spieler beginnt der nächste Tag.

---

## 6. CO-Power-Leiste

### 6.1 AW2 (empfohlenes Modell)
- Die Leiste besteht aus **Sternen**:
  - Die **kleinen Sterne** reichen für die **CO-Power**.
  - Kleine plus große Sterne, also die ganze Leiste, reichen für die **Super-CO-Power**.
  - Typisch sind 2–6 kleine und 2–5 große Sterne, insgesamt 5–10 Sterne je nach CO.
- **1 Stern = 9000 G Schadenswert** zu Spielbeginn.
- **Laden** über den **Geldwert des Schadens**. Gerechnet wird mit den angezeigten HP, die tatsächlich verloren gingen:
  - **Erlittener Schaden: 100 %** von `(verlorene Anzeige-HP / 10) × Stückpreis` der eigenen Einheit.
  - **Ausgeteilter Schaden: 50 %** von `(verlorene Anzeige-HP des Gegners / 10) × Stückpreis` der gegnerischen Einheit.
  - Beides gilt für Angriff und Konter. Bei einem Kampf bekommen also beide Spieler Ladung.
  - Formel für den Angreifer: `0,5 × dmgDealtHP/10 × Wert(Verteidiger) + dmgTakenHP/10 × Wert(Angreifer)`. Für den Verteidiger gilt sie spiegelbildlich.
  - Beispiel: Ein voller Panzer (7000) wird vernichtet. Sein Besitzer bekommt +7000, der Angreifer +3500.
  - Schaden durch Power-Effekte zählt nicht.
- Die Leiste kann nicht überladen werden; was über das Maximum hinausgeht, verfällt.
- **Während eine Power aktiv ist, lädt die Leiste nicht.**
- **Kostensteigerung:** Jeder Einsatz einer CO-Power oder Super-Power erhöht den Sternpreis um **20 % des Grundwerts (+1800 G)**.
  Nach dem 10. Einsatz steigt er nicht mehr (Maximum 9000 + 10 × 1800 = 27000 pro Stern).
- **Restladung:**
  - Was nach dem Einsatz übrig bleibt, bleibt erhalten.
  - Beispiel: Die Leiste steht bei 40000, die CO-Power kostet 3 Sterne × 9000 = 27000. Es bleiben 13000. Danach kostet ein Stern 10800.
  - Laut AWBW-Wiki zieht AW2 bei Einsatz der kleinen Power mit Fortschritt Richtung Super-Power bis zu 20 % zusätzlich ab (Detail, unsicher).
- **Allgemeiner Bonus während einer Power:**
  - AW1, Dual Strike und AWBW: **+10 % Angriff und +10 % Verteidigung** für alle Einheiten, zusätzlich zum Effekt der jeweiligen Power.
  - AW2: Laut AWBW-Wiki gibt es dort pauschal nur +10 % Verteidigung; Angriffsboni stehen bei den einzelnen Powers.
  - Empfehlung für uns: **+10/+10** (bei uns `AV` bzw. `DV` += 10).
- Eine Power wird zu Beginn oder während des eigenen Zuges aktiviert, bevor man zieht, und gilt bis zum Beginn des nächsten eigenen Zuges.
  Sie wirkt damit auch in der gegnerischen Runde, z. B. auf die Verteidigung.

### 6.2 AW1 (zum Vergleich)
- Nur eine CO-Power, keine Super-Power.
- Die Leistengröße hängt vom CO ab. Fandom nennt Stufen zwischen etwa 25000 und 50000 G.
- Ladung: ausgeteilter Schaden **25 %**, erlittener **100 %** (Geldwert, Konter eingeschlossen).
- Jeder Einsatz erhöht die Kosten um 20 %, höchstens auf 280 % des Grundwerts.

---

## 7. Spielmodi im Original (Funktionsumfang)
- **Kampagne:**
  - Story-Missionen in fester Reihenfolge; in AW2 auch mit Verzweigungen.
  - CO-Wahl in manchen Missionen.
  - Schwerer Modus nach dem Durchspielen ("Advance Campaign" in AW1, "Hard Campaign" in AW2).
  - Bewertung nach jeder Mission (siehe War Room).
- **Field Training** (nur AW1): Tutorial-Missionen, die nach und nach Einnehmen, Fernkampf, Nebel, Luft und See einführen.
- **War Room:**
  - Einzelkarten gegen die KI mit fester Gegner-CO und Highscore pro Karte.
  - Bewertung in den drei Kategorien **Speed** (Tage gegenüber Soll-Tagen), **Power** (Stärke und Wirkung der Angriffe) und **Technique** (eigene Verluste im Verhältnis zu eingesetzten Einheiten).
  - Jede Kategorie bringt bis zu 100 Punkte, zusammen höchstens 300. Daraus ergibt sich der Rang S/A/B/C. Schwellen etwa S ≥ 280, A ≥ 250, B ≥ 200 (unsicher).
- **Versus:**
  - 2–4 Spieler im Hotseat an einem Gerät, Mensch und KI frei pro Slot.
  - Teams.
  - Einstellungen: Nebel an/aus, Wetter (klar/Regen/Schnee/zufällig), Geld pro Gebäude, CO-Powers an/aus, CO-Wahl, Kartenwahl.
- **Link-Modus:** mehrere Geräte. Für uns irrelevant, wir haben nur Hotseat.
- **Design Room:**
  - Karteneditor für Gelände, Gebäude mit Besitzer und vorplatzierte Einheiten.
  - Karten speichern, in Versus und War Room spielen.
  - Spielfeldgröße im Original bis 30×20.
- **Battle Maps (Shop):**
  - Mit Punkten oder Münzen aus Kampagne und War Room kauft man neue Karten, COs und Extras wie alternative Farben.
- **Records/Statistik:** Bestwerte und Ränge, freigeschaltete Inhalte.

---

## 8. Original-KI (zur Inspiration)
- **Aggressiv und gierig:**
  - Sucht pro Einheit den Angriff mit dem höchsten erwarteten Schaden, gemessen am Geldwert, oder einen möglichen Kill.
  - Meidet Angriffe mit schlechtem Konter.
- **Plant kurzfristig:** Kaum Planung über mehrere Züge, wenig echte Formationen. Nachschub und Transport nutzt sie schwach.
- **Gibt alles Geld aus:**
  - Baut jede Runde an jeder Fabrik etwas.
  - Reagiert grob mit Kontereinheiten, z. B. Flugabwehr gegen Luft oder Bazooka-Mechs gegen Panzer.
- **Bekannte Schwächen, die man ausnutzen kann:**
  - Lässt sich mit Ködern locken; sie greift z. B. bevorzugt APCs an.
  - Fernkampfeinheiten bleiben an Engstellen stehen und blockieren eigene Truppen.
  - Zieht beschädigte Einheiten erst spät zur Reparatur zurück.
- **Power-Einsatz:** Sie zündet Powers meist, sobald sie verfügbar sind.
- **Nebel:** Spieler unterstellen der KI oft, die Lage zu kennen (unbelegt).
  Für unser Spiel ist es fairer, wenn die KI nur sieht, was sichtbar ist.
- **Ideen für unsere KI:**
  - Pro Einheit Kandidaten bewerten: `Score = Schaden×Zielwert − erwarteter Konter×Eigenwert + Bonus für Kill/Einnahme/HQ-Nähe − Gefahr am Zielfeld`.
  - Fußtruppen auf Einnahme priorisieren.
  - Fernkampf hinter der Front halten.
  - Bauen nach Budget und Gegnermix.
  - Schwierigkeitsgrade über Zufallsrauschen und Bedrohungsanalyse steuern.

---

## 9. Abweichungen AWBW ↔ Original (nur zur Einordnung)
- AWBW gibt +10 % Angriff und Verteidigung bei jeder Power. In AW2 sind es pauschal nur +10 % Verteidigung.
- Reparatur: AWBW heilt genau +20 interne HP, das Modul heilt auf den nächsten vollen Anzeige-HP-Wert.
- AWBW versorgt per APC vor dem Treibstoffabzug, das Modul danach.
- Entladen ist in AWBW eine freie Aktion, im Modul nur am Bewegungsende.
- Modul: Man kann eine Bewegung abbrechen. Im Nebel ließ sich das zum "Abtasten" ausnutzen, AWBW unterbindet es.

## Quellen
- AWBW Damage Chart, Unit Data und Terrain Chart: https://awbw.amarriner.com/damage.php, /units.php, /terrain.php
- AWBW-Wiki (Fandom; über die API abgerufen): Seiten "Damage Formula", "CO" (Power Meter), "Units", "Properties", "Terrain", "Fog of War", "Weather", "Luck", "Changes in AWBW", Modul `UnitDmg/data` (Primär- und Sekundärwerte)
- StrategyWiki, Advance Wars 2 / COs (Power-Leiste: 9000 G pro Stern, +1800 pro Einsatz, halber Wert für ausgeteilten Schaden)
- advancewars.fandom.com "Power Meter" (AW1: 25 % und 100 %, +20 % pro Einsatz bis 280 %)
- GameSpot, Walkthrough zu Advance Wars 2 (Ladebeispiel)
- Gamereactor, Guide zu Re-Boot Camp, und Spielerberichte (KI-Verhalten)
