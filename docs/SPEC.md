# FRONTLINIE – Spezifikation

Rundenbasiertes Taktikspiel im Stil der GBA-Taktikspiele (Advance-Wars-artige Spielmechanik),
aber mit **komplett eigener** Grafik, eigenen Figuren, eigenen Namen, eigener Musik und eigenen Karten.
Keine Nintendo-/Intelligent-Systems-Assets, -Namen, -Figuren oder -Karten übernehmen.

Sprache der Oberfläche: Deutsch. Läuft offline: `index.html` per Doppelklick (file://), keine Build-Tools,
keine Module (klassische `<script>`-Dateien), keine externen Ressourcen.

## Code-Konventionen
- Jede Datei hängt sich an den globalen Namensraum: `var G = (typeof globalThis!=='undefined'?globalThis:window).G = (globalThis.G||{});`
- Spiel-Logik (`data.js`, `maps.js`, `campaign.js`, `game.js`, `ai.js`) darf **kein** DOM benutzen → in Node testbar
  (`tools/sim.js` lädt sie per `vm`/`require`).
- Darstellung/Ein-/Ausgabe: `sprites.js`, `render.js`, `audio.js`, `ui.js`, `editor.js`, `main.js`.

## Fraktionen (Spieler-Slots 1–4 einer Karte werden beim Start einer Fraktion zugeordnet)
| id | Name | Farbtöne (hell → dunkel) |
|---|---|---|
| red | Karmesin | #f87858 #e03020 #a01810 #580808 |
| blue | Azur | #78b0f8 #3070e0 #1840a0 #0c2058 |
| green | Smaragd | #88e060 #40b030 #207018 #0c4008 |
| yellow | Bernstein | #f8e070 #e0b020 #a07810 #584008 |
| neutral | Neutral | #f0f0f0 #b8b8c0 #787880 #383840 |

## Kartenformat (`maps.js`)
```js
G.MAPS.push({
  id: 'zwei-ufer', name: 'Zwei Ufer', players: 2, desc: 'Kurzbeschreibung',
  rows: [            // jede Zelle = 2 Zeichen: Terrain + Besitzer ('.' neutral, '1'-'4' Spieler)
    'P.P.F.C.R.R.Q1',
    ...
  ],
  units: [ ['inf', 3, 4, 1], ['tank', 5, 2, 2, 7] ],  // [typ, x, y, spieler, hp(1-10, optional)]
});
```
Terrain-Zeichen: `P` Ebene, `F` Wald, `M` Berg, `R` Straße, `B` Brücke, `I` Fluss, `S` Meer, `H` Strand,
`X` Riff, `C` Stadt, `K` Fabrik (baut Bodeneinheiten), `A` Flughafen, `O` Hafen, `Q` Hauptquartier.
Besitzer nur bei Gebäuden (C K A O Q) sinnvoll, sonst `.`. Jede Karte: jeder Spieler genau ein `Q`.
Häfen müssen an `S` grenzen. Brücken liegen auf Fluss/Meer-Linien.

## Einheiten-IDs
inf mech recon apc tank mdtank titan arty rocket aa missile tcopter bcopter fighter bomber lander cruiser sub battleship

## Sprites (`sprites.js`)
```js
G.SPRITE_PALETTE = { 'k':'#181018', 'w':'#f8f8f8', ... };  // feste Farben
// '1'..'4' = Teamfarbe hell→dunkel (wird zur Laufzeit ersetzt), '.' = transparent
G.SPRITES = {
  units: { inf: { frames: [ [16 Strings à 16 Zeichen], [...] ] }, ... },   // 16x16, Blick nach rechts
  buildings: { C: [16 Zeilen à 16], K:..., A:..., O:..., Q: [16 Zeilen, 16 breit, darf 'höher' wirken] },
  portraits: { rika: [32 Zeilen à 32], ... },  // CO-Porträts
  icons: { capture: [...8x8], hp digits optional }
};
```
