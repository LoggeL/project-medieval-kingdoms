# Blender-Figurentest

Prozedurale Low-Poly-Figuren, gerendert aus einer festen 2:1-Iso-Kamera und zu Pixelart verkleinert. Erster Test der Pipeline aus [Kapitel 07](../../docs/concept/07-art-direction.md).

```sh
tools/blender/build.sh            # alle Stile
tools/blender/build.sh wappen     # nur einen Stil
```

Braucht Blender 5.x im `PATH` sowie Python 3 mit Pillow und NumPy.

| Datei | Aufgabe |
|---|---|
| `figures.py` | baut die Figuren in Blender, rendert 8 Richtungen × (Stehen + 8 Laufbilder), je ein Farb- und ein Lichtdurchgang, nach `.local/blender/<stil>/` |
| `pixelize.py` | Materialzuordnung, Blockverkleinerung mit Vorrang für kleine Merkmale, harte Lichtstufen (optional Dither, Schraffur), Kontur oder Innenrand, Schlagschatten, Teamtausch-Tabelle → `assets/figures/<stil>/<einheit>.png` |
| `units.json` | Einheiten: Rumpf, Helm, Wappenrock, Ausrüstung, Haltung, Griffwinkel. `showcase: false` = nur Hilfsfigur für die Gebäudeszene (Tagelöhner ohne Last) |
| `styles/*.json` | Stilrichtungen: Figurengröße, Proportionen, Palette, Licht, Kontur |
| `build.sh` | beides für alle oder einzelne Stile |

**Sprite-Blatt:** Zeilen = Richtungen S, SO, O, NO, N, NW, W, SW (Bildschirmrichtungen), Spalten = Bild 0 (Stehen) und 1–8 (Gehen). Zellgröße, Fußpunkt und die Tabelle `team_swap` (Teamfarbe Blau → Rot/Grün, exakte Farbpaare) stehen in `sheet.json`.

**Regeln, die das Bauen prüft:** jede Farbe eines Stils nur einmal (sonst Abbruch), keine Teamfarbe, die auch ein anderes Material erzeugt (sonst Abbruch), Warnung bei Renderfarben ohne passenden Stilschlüssel, Blender-Fehler brechen `build.sh` ab (Log in `.local/blender/<stil>.log`).

Einzelne Einheiten neu rendern: `blender -b --factory-startup --python-exit-code 1 -P tools/blender/figures.py -- --style … --out .local/blender/<stil> --units speer`. Die übrigen Einheiten bleiben in `render.json` erhalten.

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
| `buildings/buildings.json` | Bauten: Name, Grundriss in Tiles, Varianten (Füllstufen, Hof), Posten `[x, y, Höhenstufe]` in Tiles ab Grundrissmitte (Modellachsen), `front` |
| `buildings/palette.json` | Erkennungsfarben der Renders. Hat ein Stil denselben Schlüssel (team, gold, wood …), nimmt das Verpixeln die Stilfarbe |
| `build_buildings.sh` | rendert einmal und verpixelt alle Stile parallel nach `assets/buildings/<stil>/` |

**Maßstab:** ein Tile ist 64 × 32 px (2,55 m Kante), eine Höhenstufe 16 px (1,04 m), eine 1,8 m große Figur rund 28 px hoch (32 px je 1,8 m in der Bildebene, dieselbe Pixeldichte wie bei den Figuren). Wehrgang auf 3 Stufen, Turmplattform auf 5. Zelle 320 × 256 px, Anker (Grundrissmitte) bei 144, 184.

**Ansicht k** zeigt das Modell um k · 90° gegen den Uhrzeigersinn gedreht. Mit Weltausrichtung o und Kameradrehung r zeigt das Spiel Ansicht (o − r) mod 4 (Konzept Kapitel 09). Die y-Achse des Modells zeigt in die Gegenrichtung der Tile-y-Achse.

**Drehsinn:** Raster-u = Modell +x, Raster-v = Modell −y. Ansicht d zeigt das Modell um d · 90° gegen den Uhrzeigersinn gedreht. Posten und Grundriss stehen in Modellachsen, `sheet.json` vermerkt das unter `axes`.

**Schatten:** `pixelize.py` liest das Höhenbild. Jeder Gebäudepunkt in Höhe z wirft seinen Schatten um z · (dx, 1 − dy) Bildpunkte versetzt auf den Boden, dieselbe Richtung wie bei den Figuren. Waagerechte Flächen (Lagerboden, Turmplattform) bekommen die Schatten höherer Teile als dunklere Lichtstufe. Sehr kleine Schattenflecken werden verworfen, schmale Steinoberkanten zählen nicht als Fläche.

**Licht:** Gebäude werden mit `--lscale 1.06` verpixelt, damit Oberseite, Lichtseite und Schattenseite auf drei getrennten Stufen liegen und keine Wand genau auf einer Schwelle flimmert. Teile nahe am Boden werden etwas dunkler (Stil-Schlüssel `height_gradient`, Standard 0,16), Laub und Nadeln ohne Dither. `hatch_skip` nimmt Materialien von der Schraffur aus (Holzschnitt: Mauerwerk, Fels).

**Vorderteil:** `<bau>_front.png` enthält nur die Pixel der Brüstung (und der Turmfahne), die zur Kamera zeigt, samt Kontur. Gezeichnet wird Gebäude, dann Figuren auf den Posten, dann das Vorderteil.

Auf die Konzeptseite kommen Figuren und Gebäude mit [`tools/konzeptseite/build.py`](../konzeptseite/README.md).
