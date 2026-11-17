# Blender-Figurentest

Prozedurale Low-Poly-Figuren, gerendert aus einer festen 2:1-Iso-Kamera und zu Pixelart verkleinert. Erster Test der Pipeline aus [Kapitel 07](../../docs/concept/07-art-direction.md).

```sh
tools/blender/build.sh            # alle Stile
tools/blender/build.sh wappen     # nur einen Stil
```

Braucht Blender 5.x im `PATH` sowie Python 3 mit Pillow und NumPy.

| Datei | Aufgabe |
|---|---|
| `figures.py` | baut die Figuren in Blender, rendert 8 Richtungen × (Stehen, 8 Laufbilder, Aktion, Sterben, tot), je ein Farb- und ein Lichtdurchgang, nach `.local/blender/<stil>/` |
| `pixelize.py` | Materialzuordnung, Blockverkleinerung mit Vorrang für kleine Merkmale, harte Lichtstufen (optional Dither, Schraffur), Kontur oder Innenrand, Schlagschatten, Teamtausch-Tabelle → `assets/figures/<stil>/<einheit>.png` |
| `units.json` | Einheiten: Rumpf, Helm, Wappenrock, Ausrüstung, Haltung, Griffwinkel, `action` (`anim` = Name im Blatt, `motion` = Bewegung aus `ACTIONS` in `figures.py`), `swing` (Armschwung beim Gehen, 0 = Last mit beiden Armen), `dies: false` = ohne Sterbebilder. `showcase: false` = nur Hilfsfigur für die Gebäudeszene der Konzeptseite (Tagelöhner ohne Last) |
| `styles/*.json` | Stilrichtungen: Figurengröße, Proportionen, Palette, Licht, Kontur |
| `build.sh` | beides für alle oder einzelne Stile |

**Sprite-Blatt:** Zeilen = Richtungen S, SO, O, NO, N, NW, W, SW (Bildschirmrichtungen), Spalten (für jede Einheit gleich):

| Spalten | Animation | Wer |
|---|---|---|
| 0 | `stehen` | alle |
| 1–8 | `gehen` | alle |
| 9–12 | Aktion: `hacken` (Holzfäller), `abbauen` (Steinmetz), `angriff` (Speer: Stoß, Schwert: Hieb), `schiessen` (Bogen) | nur Einheiten mit `action`, sonst leer |
| 13–15 | `sterben` (getroffen, Knie geben nach, kippt nach hinten) | alle |
| 16 | `tot` (liegt auf dem Rücken, um den Fußpunkt zentriert) | alle |

`sheet.json` nennt pro Einheit `frames` (Spaltenzahl des Blatts, 17), `anims` (`{name: [erste Spalte, Anzahl]}`, nur vorhandene Animationen) und `row` (erste Zeile im Atlas). `atlas.png` enthält alle Einheiten in der Reihenfolge von `units` untereinander (Einheit i ab Zeile 8 · i, auch Hilfsfiguren), zusätzlich liegt jede Einheit einzeln als `<einheit>.png` daneben. Zellgröße, Fußpunkt und die Tabelle `team_swap` (Teamfarbe Blau → Rot/Grün, exakte Farbpaare) stehen ebenfalls in `sheet.json`. Die Posen der Aktionen und des Sterbens stehen als Schlüsselbilder in `figures.py` (`ACTIONS`, `DYING`); gehaltenes Gerät wird über einen absoluten Griffwinkel geführt (Speer waagerecht beim Stoß, Axt hinter dem Kopf beim Ausholen).

**Regeln, die das Bauen prüft:** jede Farbe eines Stils nur einmal (sonst Abbruch), keine Teamfarbe, die auch ein anderes Material erzeugt (sonst Abbruch), Warnung bei Renderfarben ohne passenden Stilschlüssel, Blender-Fehler brechen `build.sh` ab (Log in `.local/blender/<stil>.log`).

Einzelne Einheiten neu rendern: `blender -b --factory-startup --python-exit-code 1 -P tools/blender/figures.py -- --style … --out .local/blender/<stil> --units speer` (optional `--frames 9-16` nur diese Spalten). Die übrigen Einheiten bleiben in `render.json` erhalten.

**Richtung d** entspricht einer Drehung der Figur um 45° + d · 45° um die Hochachse. d = 0 schaut zur Kamera.

**Stiloptionen für den vorgerenderten Eindruck** (siehe `styles/vorgerendert.json`): `smooth` (glatt schattierte, abgerundete Grundkörper), `cavity` (Kontaktschatten in Falten, nur im Lichtdurchgang), `quantize_hip` (Körperhub in ganzen Pixeln), `back_hair` (Haar am Hinterkopf unter Mützen), in `pixel`: `rim_sides: "shade"`, `metal` + `metal_gain`, `shadow.solid`, `shadow.fringe_alpha`, `shadow.contact`.

`pixelize.py --steps speer:1` schreibt zusätzlich die Zwischenschritte eines Bildes nach `_steps/`.

## Gebäude

```sh
tools/blender/build_buildings.sh            # alle Stile (braucht die Figuren-Renders als Lichtbezug)
tools/blender/build_buildings.sh wappen
```

| Datei | Aufgabe |
|---|---|
| `buildings.py` | baut die Bauten aus Bausteinen (Mauerwerk, Fachwerk, Dächer, Zinnen, Zäune, Stapel) und rendert jede Ansicht und Variante viermal nach `.local/blender/buildings/`: flache Farben, Licht, Höhe (16 bit, Meter / 16) und bei Mauer und Turm die vordere Brüstung |
| `buildings/buildings.json` | Bauten und Objekte: Name, Grundriss in Tiles, Varianten (Füllstufen, Hof, Abbaustufen), Posten `[x, y, Höhenstufe]` in Tiles ab Grundrissmitte (Modellachsen), `front` |
| `buildings/palette.json` | Erkennungsfarben der Renders. Hat ein Stil denselben Schlüssel (team, gold, wood …), nimmt das Verpixeln die Stilfarbe |
| `build_buildings.sh` | rendert einmal und verpixelt alle Stile parallel nach `assets/buildings/<stil>/` |

**Maßstab:** ein Tile ist 64 × 32 px (2,55 m Kante), eine Höhenstufe 16 px (1,04 m), eine 1,8 m große Figur rund 28 px hoch (32 px je 1,8 m in der Bildebene, dieselbe Pixeldichte wie bei den Figuren). Wehrgang auf 3 Stufen, Turmplattform auf 5. Zelle 320 × 256 px, Anker (Grundrissmitte) bei 144, 184.

**Ansicht k** zeigt das Modell um k · 90° gegen den Uhrzeigersinn gedreht. Mit Weltausrichtung o und Kameradrehung r zeigt das Spiel Ansicht (o − r) mod 4 (Konzept Kapitel 09). Die y-Achse des Modells zeigt in die Gegenrichtung der Tile-y-Achse.

**Drehsinn:** Raster-u = Modell +x, Raster-v = Modell −y. Ansicht d zeigt das Modell um d · 90° gegen den Uhrzeigersinn gedreht. Posten und Grundriss stehen in Modellachsen, `sheet.json` vermerkt das unter `axes`.

**Schatten:** `pixelize.py` liest das Höhenbild. Jeder Gebäudepunkt in Höhe z wirft seinen Schatten um z · (dx, 1 − dy) Bildpunkte versetzt auf den Boden, dieselbe Richtung wie bei den Figuren. Waagerechte Flächen (Lagerboden, Turmplattform) bekommen die Schatten höherer Teile als dunklere Lichtstufe. Sehr kleine Schattenflecken werden verworfen, schmale Steinoberkanten zählen nicht als Fläche.

**Licht:** Gebäude werden mit `--lscale 1.06` verpixelt, damit Oberseite, Lichtseite und Schattenseite auf drei getrennten Stufen liegen und keine Wand genau auf einer Schwelle flimmert. Teile nahe am Boden werden etwas dunkler (Stil-Schlüssel `height_gradient`, Standard 0,16), Laub und Nadeln ohne Dither. `hatch_skip` nimmt Materialien von der Schraffur aus (Holzschnitt: Mauerwerk, Fels).

**Vorderteil:** `<bau>_front.png` enthält nur die Pixel der Brüstung (und der Turmfahne, beim Lagerboden des Zauns), die zur Kamera zeigt, samt Kontur. Gezeichnet wird Gebäude, dann Figuren auf den Posten (bzw. Stapel und Figuren im Lager), dann das Vorderteil.

**Nachbarmaske:** Mauerteile und Tor rendern zusätzlich `_n.png`, die Stellen der angeschlossenen Nachbarn (unsichtbare Platzhalter, Gruppe `ghost`). Dort entfällt der Bodenschatten des Teils, sonst läge er im Spiel über der Wand des Nachbarn.

### Objekte für den Prototyp

| Schlüssel | Varianten (Spalten) | Hinweise |
|---|---|---|
| `baum_liegt` | 3, 2, 1 Stammstücke | gefällter Laubbaum entlang Modell +x, mittig auf seinem Tile; Fußende Richtung −x (zum Stumpf), Variante 0 mit Krone, die bis ins Nachbartile +x reicht |
| `baum_stumpf` | Laubbaum, Tanne | |
| `fels` | unberührt, angebrochen, halb abgebaut, fast abgebaut | einzelner Brocken 1 × 1 mit frischer Schnittfläche und Schutt |
| `stapel_holz`, `stapel_stein`, `stapel_eisen`, `stapel_speer`, `stapel_schwert`, `stapel_bogen` | Füllstufe 0–4 | 1 × 1, Stufe 0 leer (transparent), stehen auf den Bohlen von `lager_boden` (Höhe 0,06 m); Speere im hohen Gestell, Schwerter im niedrigen Ständer mit Parierstange und Goldknauf (ab Stufe 3 Kiste), Bögen hängend mit Pfeilfass ab Stufe 2 |
| `lager_boden` | 1 | Lagerplatz 3 × 3 ohne Waren: Zaun (Einfahrt bei Modell (0, −1)), acht Bohlenflächen an den Slots von `b_lager` bzw. `STORAGE_SLOTS` in `src/sim/geom.ts`; `front` = Zaun zur Kamera. Ist ein Boden: zuerst zeichnen, dann Stapel und Figuren darin, dann `lager_boden_front.png` |
| `mauer_gerade`, `mauer_ende`, `mauer_ecke`, `mauer_t`, `mauer_kreuz`, `mauer_einzel` | 1 | Verbindungen bei Ausrichtung 0 (Modell +x = Welt Ost, Modell +y = Welt Nord): gerade O+W, ende O, ecke O+N, t O+W+N, kreuz alle, einzel keine (wie `wallPiece` in `src/sim/geom.ts`). Wehrgang auf Stufe 3, Zinnen auf beiden Außenseiten, Posten `[0, 0, 3]`, `front` |
| `tor` | geschlossen, offen | gerades Mauerstück O+W mit Torbogen, Durchgang entlang Modell ±y, Torflügel öffnen nach +y, Wehrgang oben, Posten `[0, 0, 3]` |

Die Mauerteile verbinden sich nahtlos: Wandkörper 2,2 m breit bis an die Tile-Kante, Zinnenrhythmus mit halber Lücke an jeder offenen Kante. Der Mauerturm füllt seinen 2 × 2-Grundriss jetzt ganz aus (vorher 0,15 m eingerückt), damit angesetzte Mauern ohne Spalt anschließen; die oberste Treppenstufe reicht 0,17 m über den Grundriss bis an die Mauerfront.

## Gelände

```sh
tools/blender/build_terrain.sh            # alle Stile (braucht die Figuren-Renders als Lichtbezug)
```

`terrain.py` läuft zweimal: in Blender rendert es flache Kacheln (Farbe, Licht, Höhe) nach `.local/blender/terrain/`, mit `python3` verpixelt es sie in der Lichtlogik des Stils (dieselbe Schattierungsformel und Lichtreferenz wie `pixelize.py`, kurze Schatten von Halmen und Steinen) nach `assets/terrain/<stil>/`. Farben in `terrain/palette.json`.

**Blatt:** `terrain.png` + `sheet.json`:

```json
{"tile": [64, 32], "anchor": [32, 16], "image": "terrain.png", "fps": 4,
 "keys": {"gras": {"row": 0, "variants": 4, "frames": 1}, "wiese": {"row": 1, …}, "waldboden": {"row": 2, …},
          "erde": {"row": 3, …}, "fels": {"row": 4, …}, "wasser": {"row": 5, "variants": 1, "frames": 4},
          "erz": {"row": 6, …}, "sumpf": {"row": 7, …}, "acker": {"row": 8, …}}}
```

`erz` (Fels mit rostroten Adern und Erzbrocken), `sumpf` (Moorboden mit trüben Pfützen, Schilf und Rohrkolben) und `acker` (Furchen mit junger Saat) sind später angehängt, die Zeilen 0–5 sind unverändert. Die Furchen haben eine Richtung: Varianten 0 und 1 verlaufen entlang Welt-x, 2 und 3 entlang Welt-y. Geländekacheln werden beim Drehen nicht mitgedreht, für die Ansichten r = 1 und r = 3 nimmt die Darstellung deshalb die andere Hälfte (Variante xor 2).

Zeile = Geländetyp, Variante v und Bild f in Spalte v · frames + f. Ein Pixel (x, y) gehört zur Kachel, wenn |x + 0,5 − 32| / 32 + |y + 0,5 − 16| / 16 < 1; Kacheln im Abstand (32, 16) schließen dann ohne Lücke und Überlappung. Der Anker (32, 16) ist die Kachelmitte.

**Nahtlos:** Grundton und Feinrelief kommen aus Rauschen, das über eine Kachel periodisch ist. Am Rand nutzen alle Varianten eines Typs dasselbe Rauschen, innen jede ihr eigenes, daher passen beliebige Varianten aneinander. Halme, Blüten, Laub, Steine und Risse liegen ganz innerhalb der Raute. Wasser hat vier Wellenbilder, periodisch in Raum und Zeit.

## Prüfbilder

```sh
python3 tools/blender/preview.py [--style vorgerendert] [--out .local/preview]
```

Schreibt vergrößerte Kontaktbögen der neuen Objekte und aller Figuren, ein Geländebild (Blatt und Flächen aus gemischten Varianten) und zwei Testszenen in allen vier Kameradrehungen: Mauerzug mit Turm, Treppe, Tor, Ecke, T, Kreuz, Enden und Schützen auf den Posten (Teile per Autotiling wie im Spiel) sowie den Lagerplatz mit allen Stapeln und den Trägern.

Auf die Konzeptseite kommen Figuren und Gebäude mit [`tools/konzeptseite/build.py`](../konzeptseite/README.md).
