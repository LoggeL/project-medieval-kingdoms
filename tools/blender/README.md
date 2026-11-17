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
| `units.json` | Einheiten: Rumpf, Helm, Wappenrock, Ausrüstung, Haltung, Griffwinkel, `action` (`anim` = Name im Blatt, `motion` = Bewegung aus `ACTIONS` in `figures.py`), `action_gear` (Gerät, das nur in den Aktionsbildern zu sehen ist, z. B. der Hammer des Tagelöhners), `swing` (Armschwung beim Gehen, 0 = Last mit beiden Armen), `dies: false` = ohne Sterbebilder. `showcase: false` = nur Hilfsfigur für die Gebäudeszene der Konzeptseite (Tagelöhner ohne Last). Neue Einheiten kommen ans Ende, damit die Atlaszeilen der bisherigen gleich bleiben |
| `styles/*.json` | Stilrichtungen: Figurengröße, Proportionen, Palette, Licht, Kontur |
| `build.sh` | beides für alle oder einzelne Stile |

**Sprite-Blatt:** Zeilen = Richtungen S, SO, O, NO, N, NW, W, SW (Bildschirmrichtungen), Spalten (für jede Einheit gleich):

| Spalten | Animation | Wer |
|---|---|---|
| 0 | `stehen` | alle |
| 1–8 | `gehen` | alle |
| 9–12 | Aktion: `hacken` (Holzfäller), `abbauen` (Steinmetz), `bauen` (Tagelöhner: Hammerschläge tief vor dem Körper, Hammer nur in diesen Bildern), `angriff` (Speer: Stoß, Schwert: Hieb), `schiessen` (Bogen: Anlegen, Heben mit eingelegtem Pfeil, voller Auszug mit Sehne zur Hand, Lösen) | nur Einheiten mit `action`, sonst leer |
| 13–15 | `sterben` (getroffen, Knie geben nach, kippt nach hinten) | alle |
| 16 | `tot` (liegt auf dem Rücken, um den Fußpunkt zentriert) | alle |

`sheet.json` nennt pro Einheit `frames` (Spaltenzahl des Blatts, 17), `anims` (`{name: [erste Spalte, Anzahl]}`, nur vorhandene Animationen) und `row` (erste Zeile im Atlas). `atlas.png` enthält alle Einheiten in der Reihenfolge von `units` untereinander (Einheit i ab Zeile 8 · i, auch Hilfsfiguren), zusätzlich liegt jede Einheit einzeln als `<einheit>.png` daneben. Zellgröße, Fußpunkt und die Tabelle `team_swap` (Teamfarbe Blau → Rot/Grün, exakte Farbpaare) stehen ebenfalls in `sheet.json`. Die Posen der Aktionen und des Sterbens stehen als Schlüsselbilder in `figures.py` (`ACTIONS`, `DYING`); gehaltenes Gerät wird über einen absoluten Griffwinkel geführt (Speer waagerecht beim Stoß, Axt hinter dem Kopf beim Ausholen).

**Regeln, die das Bauen prüft:** jede Farbe eines Stils nur einmal (sonst Abbruch), keine Teamfarbe, die auch ein anderes Material erzeugt (sonst Abbruch), Warnung bei Renderfarben ohne passenden Stilschlüssel, Blender-Fehler brechen `build.sh` ab (Log in `.local/blender/<stil>.log`).

Einzelne Einheiten neu rendern: `blender -b --factory-startup --python-exit-code 1 -P tools/blender/figures.py -- --style … --out .local/blender/<stil> --units speer` (optional `--frames 9-16` nur diese Spalten). Die übrigen Einheiten bleiben in `render.json` erhalten.

**Richtung d** entspricht einer Drehung der Figur um 45° + d · 45° um die Hochachse. d = 0 schaut zur Kamera.

**Seitenansicht:** In den Richtungen O und W sieht man die Figur im Profil, dort zählt nur die Körpertiefe. Damit sie nicht zum dünnen Strich wird, gilt für alle Menschenfiguren `PROFILE` in `figures.py` (pro Stil überschreibbar mit dem Schlüssel `profile`): Brust und Hüfte 1,55-mal so tief, freie Arme in Ruhe 18° nach vorn und 5° nach außen, Oberarme und Hände etwas kräftiger, ein Pixel Nase (nicht unter Nasal- oder Schallernhelm). Der Tagelöhner ist im Profil jetzt 10 statt 5 px breit (vorgerendert), von vorn unverändert 15.

**Ellbogen:** Unterarm, Hand und gehaltenes Gerät hängen an einem Ellbogen-Gelenk (`elbowL`/`elbowR`). In Ruhe ist der Arm gestreckt wie bisher, Aktionen können ihn beugen (`"elbowR": (x, y, z)` in `ACTIONS`), so beim vollen Auszug des Bogens (Ellbogen hoch, Hand an der Wange). Beim Schießen spannt `bow_extras` die Sehne von beiden Bogenenden zur rechten Hand (`"string": "drawn"`) und legt den Pfeil ein (`"arrow": "nocked"` bzw. `"drawn"`).

**Träger:** Alle Trägerfiguren tragen das Gewand des Tagelöhners (Kittel `cloth`, Hose `hose2`, Mütze in Teamfarbe). Holzstamm und Speerbündel liegen auf der rechten Schulter, um 22,5° nach außen gedreht, damit sie auch beim Gehen auf die Kamera zu nicht zum Punkt schrumpfen. `traeger_speer`: zwei Speere geschultert; `traeger_schwert`: drei Schwerter schräg vor der Brust, mit Riemen gebunden; `traeger_bogen`: drei bespannte Bögen aufrecht in der rechten Hand. Eisen trägt weiter `traeger_kiste`.

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

**Nachbarmaske:** Mauerteile und Tor rendern zusätzlich `_n.png`, die Stellen der angeschlossenen Nachbarn (unsichtbare Platzhalter, Gruppe `ghost`). Dort entfällt der Bodenschatten des Teils, sonst läge er im Spiel über der Wand des Nachbarn. Ebenso entfallen dort Randabdunklung (`rim`) und Konturring: Zum Nachbarn hin läuft die Mauer weiter, die Kante ist keine Silhouette. Vorher lag in den Ansichten 1 und 3 an jeder Kachelgrenze eine senkrechte dunkle Naht (der abgedunkelte rechte Rand des vorderen Stücks über der Wand des hinteren).

### Felsmassiv (ADR 0012)

`gebirge` (Seed 300, `b_gebirge` mit `crag`): ein Teil des Massivs je Gebirgsfeld, 12 Bilder = 3 Höhenklassen × 4 Varianten. Rand (Bild 0–3): flache Felsrippen mit Büschen, teils einer Krüppelkiefer, 1,3–2,1 m. Hang (4–7): facettierte Felsspitze mit zwei Nebenspitzen, 2,8–3,6 m. Gipfel (8–11): breite Spitze mit Schneekappe und Schneeresten in den Rinnen, 4,2–5,4 m. Die Teile reichen etwas über ihr Feld hinaus, damit Nachbarn zu einem Massiv zusammenwachsen; die Darstellung wählt die Klasse nach dem Abstand zum Rand (`mountainClass`). Neue Palettenfarbe `snow`.

### Objekte für den Prototyp

| Schlüssel | Varianten (Spalten) | Hinweise |
|---|---|---|
| `baum_liegt` | 3, 2, 1 Stammstücke | gefällter Laubbaum entlang Modell +x, mittig auf seinem Tile; Fußende Richtung −x (zum Stumpf), Variante 0 mit Krone, die bis ins Nachbartile +x reicht |
| `baum_stumpf` | Laubbaum, Tanne | |
| `fels` | unberührt, angebrochen, halb abgebaut, fast abgebaut | einzelner Brocken 1 × 1 mit frischer Schnittfläche und Schutt |
| `stapel_holz`, `stapel_stein`, `stapel_eisen`, `stapel_speer`, `stapel_schwert`, `stapel_bogen` | Füllstufe 0–4 | 1 × 1, Stufe 0 leer (transparent), stehen auf den Fächern von `lagerhaus_innen` (Höhe 0,06 m); Speere im hohen Gestell, Schwerter im niedrigen Ständer mit Parierstange und Goldknauf (ab Stufe 3 Kiste), Bögen hängend mit Pfeilfass ab Stufe 2 |
| `lager_boden` | 1 | Früherer offener Lagerplatz 3 × 3 (Zaun, acht Bohlenflächen). Seit ADR 0005 nicht mehr im Spiel, bleibt im Blatt als Bezug |
| `lagerhaus` | Füllstand 0–4 | geschlossenes Fachwerk-Lagerhaus 3 × 3 mit Satteldach und Tor an Modell (0, −1,5) (Tür bzw. Zugang `door` [0, −2] in `src/data`, ADR 0010); vor dem Tor Kisten, Fässer und Säcke als Füllstandsanzeige |
| `lagerhaus_innen` | Füllstand 0–4 | Schnittbild ohne Dach: Bohlenboden, acht Fächer an `shelves` (dieselben Werte wie `BUILDINGS.lager.storage.shelves`), Regale an den hohen Wänden, Mittelgang zum Tor. Waren (`stapel_*`) und Figuren zeichnet das Spiel darauf, dann `lagerhaus_innen_front.png` |
| `haus_innen` | 0–4 Bewohner | Wohnhaus ohne Dach: Herd am Schornstein, Tisch mit Bank, Truhe, Betten; Variante = belegte Betten |
| `holzfaeller_innen` | Hof leer, halb, voll | Holzfällerhütte ohne Dach: Werkbank mit Säge und Stamm, Äxte an der Rückwand, Scheite, Strohlager; Hof wie beim Außenbild |
| `kaserne_innen` | 1 | Kaserne ohne Dach (Erdgeschoss): Speergestelle und Schilde, Pritschen, Rüstungsständer, Tisch, Sack-Übungspuppe bei `dummy`; der Rekrut in Ausbildung steht bei `interior.spots[0]` |
| `bergfried_holz` | 1 | Bergfried Stufe 1, 3 × 3: Fachwerkturm mit vorkragendem Obergeschoss auf Steinsockel, Pyramidendach aus Schindeln mit Fahne, Treppe zur Tür an Modell (0, −2,45), Palisade mit Lücke vor der Tür |
| `bergfried_stein` | 1 | Stufe 2: Wohnturm aus Quadern mit Anlauf, Gesims, Schießscharten, Hauswappen über der Tür, Plattform auf 5 Stufen mit Zinnen (`front`), Posten `[±0,8, ±0,8, 5]` wie `BUILDINGS.bergfried.levels[1].posts` |
| `bergfried_burg` | 1 | Stufe 3 (Burgfried): höher, Plattform auf 6 Stufen, Konsolenfries, vier Ecktürmchen mit Ziegelkegeln (Gruppe je Ecke im `front`), Treppenturm in der Mitte mit Banner, Feuerkörbe an der Tür; 6 Posten wie `levels[2].posts` |
| `bergfried_holz_innen`, `bergfried_stein_innen`, `bergfried_burg_innen` | Burgherr, Burgherr und Gelehrter | Schnittbild der Halle (Erdgeschoss): Burgherr mit Goldreif am Tisch im Lehnstuhl, Wandteppich mit Hauszeichen, Fackeln, Kamin, Bücherregal, Treppe nach oben an der linken Wand, Truhe; Variante 1 zusätzlich der Gelehrte am Pult mit offenem Buch (das Spiel zeigt sie, solange geforscht wird). Hof wie außen |
| `mauer_gerade`, `mauer_ende`, `mauer_ecke`, `mauer_t`, `mauer_kreuz`, `mauer_einzel` | 1 | Verbindungen bei Ausrichtung 0 (Modell +x = Welt Ost, Modell +y = Welt Nord): gerade O+W, ende O, ecke O+N, t O+W+N, kreuz alle, einzel keine (wie `wallPiece` in `src/sim/geom.ts`). Wehrgang auf Stufe 3, Zinnen auf beiden Außenseiten, Posten `[0, 0, 3]`, `front` |
| `tor` | geschlossen, offen | gerades Mauerstück O+W mit Torbogen, Durchgang entlang Modell ±y, Wehrgang oben, Posten `[0, 0, 3]`. Hinter jeder der beiden Bogenseiten ein Fallgatter aus Bohlen mit Querriegeln und Eisenspitzen, beide Seiten gleich (das Spiel kennt kein Innen und Außen eines Tors, `gateOrientation` liefert nur 0 oder 1). Geschlossen: Gatter unten, das Gitter füllt den Bogen bündig. Offen: Gatter hochgezogen (`GATE_UP`), nur Unterriegel und Spitzen unter dem Bogenscheitel, der Durchgang ist frei. Torflügel gibt es bewusst nicht: In der Iso-Ansicht deckt ein an die sichtbare Laibung geklappter Flügel die halbe Öffnung und sieht wie geschlossen aus |
| `baustelle_haus`, `_holzfaeller`, `_kaserne`, `_turm`, `_mauer`, `_treppe`, `_steinbruch`, `_lager`, `_lagerhaus`, `_bergfried` | abgesteckt, Fundament | Grundriss wie der Bau (`SITE_RECTS` in `buildings.py`). Abgesteckt: Pflöcke und Schnur. Fundament: gestampfter Boden mit Grundmauerring (bei Steinbruch und dem früheren Lagerplatz `_lager` nur Pfosten; `_bergfried` dient nur als Grundmauer nach der Zerstörung), dazu Bruchsteine und Mörteltrog. `"shadow_fill": false` |
| `geruest_haus`, `_holzfaeller`, `_kaserne`, `_turm`, `_lagerhaus` | 1 | Stangengerüst mit Riegeln, Bohlen, Geländer, Diagonalen und Leiter um den Umriss (`SCAFFOLDS`: Ebenen und Höhe), `front` = die Seiten zur Kamera. Das Spiel deckt Gerüst und Vorderteil nur bis knapp über den gebauten Teil auf (ADR 0009) |
| `baustoff_holz`, `baustoff_stein` | Füllstufe 0–4 | Baustoff auf der Baustelle (1 × 1): Bretter und Kanthölzer auf Unterlegern bzw. Quader auf einer Palette, Stufe 0 leer |

`"shadow_fill": false` (in `buildings.json`) lässt beim Verpixeln die Schattenfläche ungefüllt: Offene Gerüste und Schnüre werfen nur den Schatten ihrer Teile statt einer geschlossenen Fläche.

**Schnittbilder** (`"cutaway": true`): werden je Kameransicht einzeln gebaut (`mb.view`), damit die Wände zur Kamera niedrig bleiben und ins Vorderteil (`_front`) fallen. Boden, Sockel und Grundriss decken sich mit dem Außenbild (gleiche Seeds und Zeichenreihenfolge), damit das Überblenden nicht springt. Das Spiel zeigt sie beim Überfahren und für das ausgewählte Gebäude (ADR 0005).

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
          "erde": {"row": 3, …}, "fels": {"row": 4, …}, "wasser": {"row": 5, "variants": 4, "frames": 8},
          "erz": {"row": 6, …}, "sumpf": {"row": 7, …}, "acker": {"row": 8, …}}}
```

`erz` (Fels mit rostroten Adern und Erzbrocken), `sumpf` (Moorboden mit trüben Pfützen, Schilf und Rohrkolben) und `acker` (Furchen mit junger Saat) sind später angehängt, die Zeilen 0–5 sind unverändert. Die Furchen haben eine Richtung: Varianten 0 und 1 verlaufen entlang Welt-x, 2 und 3 entlang Welt-y. Geländekacheln werden beim Drehen nicht mitgedreht, für die Ansichten r = 1 und r = 3 nimmt die Darstellung deshalb die andere Hälfte (Variante xor 2).

**Landschaft (ADR 0012), eigenes Bild `gelaende.png`:** `huegel` (trockenes Olivgras auf breiten Buckeln, Heide, Steine), `fruchtbar` (sattes Auengras, Maulwurfshügel, Hahnenfuß), `sand` (Strand mit Rippeln, Kieseln, Muscheln, Strandhafer, Treibholz) und `gebirge` (Geröll unter den Massivteilen), je 4 Varianten. Damit `terrain.png` und `blend.png` bytegleich bleiben, stehen sie in einem eigenen Bild: Im `sheet.json` tragen diese Schlüssel `"image": "gelaende.png"` (Zeilen zählen in diesem Bild), `images` nennt die Farbzahl. Erzeugen: in Blender mit `--only huegel,fruchtbar,sand,gebirge` rendern, dann `python3 tools/blender/terrain.py --style … --src .local/blender/terrain --out assets/terrain/vorgerendert --lref-src .local/blender/vorgerendert --only huegel,fruchtbar,sand,gebirge --image gelaende.png --merge` (hängt nur die Schlüssel an, schreibt kein `blend.png`). Übergangsvorrang im Spiel: wasser < sumpf < sand < erde < gebirge < fels < huegel < waldboden < fruchtbar < gras < wiese (`BLEND_ORDER` in `src/render/blend.ts`).

Zeile = Geländetyp, Variante v und Bild f in Spalte v · frames + f. Wasser hat 4 Varianten zu je 8 Bildern (Spalten 0–31 der Zeile 5). Ein Pixel (x, y) gehört zur Kachel, wenn |x + 0,5 − 32| / 32 + |y + 0,5 − 16| / 16 < 1; Kacheln im Abstand (32, 16) schließen dann ohne Lücke und Überlappung. Der Anker (32, 16) ist die Kachelmitte.

**Nahtlos:** Grundton und Feinrelief kommen aus Rauschen, das über eine Kachel periodisch ist. Am Rand nutzen alle Varianten eines Typs dasselbe Rauschen, innen jede ihr eigenes, daher passen beliebige Varianten aneinander. Halme, Blüten, Laub, Steine und Risse liegen ganz innerhalb der Raute.

**Wasser:** Wellen laufen. Jede Wellenkomponente ist über die Kachel periodisch (ganzzahlige Wellenzahlen) und rückt in den 8 Bildern eine ganze Zahl von Perioden weiter, die Schleife ist also in Raum und Zeit nahtlos. Eine ruhige Dünung (Wellenzahl 2–3,2) wählt den Grundton, wenige kurze Wellen quer zum Wind (`WIND`) geben die hellen Kämme, Schaum nur, wo ein Kamm auf hoher Dünung liegt. Am Rand teilen alle vier Varianten dieselben Wellen, innen hat jede ihre eigenen, daher passen sie beliebig aneinander und eine Seefläche zeigt kein Kachelraster. Das Verpixeln bricht ab, wenn zwei Bilder einer Variante gleich sind. Hinweis für die Darstellung: Benachbarte Wasserkacheln müssen dasselbe Bild zeigen, sonst passen die Wellen an der Kante nicht (kein Versatz der Bildnummer je Kachel).

**Übergänge (`blend.png`):** Masken für weiche, unregelmäßige Geländegrenzen, für alle Stile gleich (`blend_masks()` in `terrain.py`, beim Verpixeln geschrieben). Im `sheet.json`:

```json
"blend": {"image": "blend.png", "tile": [64, 32], "edges": ["ne", "se", "sw", "nw"], "variants": 4}
```

Zeile = Kante der Bildschirmraute (`ne` = Kante zwischen oberer und rechter Ecke, `se` rechte–untere, `sw` untere–linke, `nw` linke–obere), Spalte = Variante. Jede Zelle ist weiß mit hartem Alpha (0 oder 255): an ihrer Kante deckend (mindestens 2 px senkrecht), nach innen unregelmäßig in 2-px-Stufen bis höchstens 7 px, mit Zungen und einzelnen losen Pixeln. Beide Enden jeder Kante sind in allen Varianten 3 px tief, damit Masken benachbarter Kacheln entlang einer Grenze ohne Stufe weiterlaufen; mit höchstens 7 von 16 px bleibt ein Weg von einer Kachel Breite in der Mitte sichtbar. Verwendung in der Darstellung: Für jede Kante, deren Nachbar höheren Vorrang hat (wasser < erde < fels < waldboden < gras < wiese), die Kachel des Nachbarn (seine Variante, damit die Kante genau passt) mit der Maske dieser Kante über die Kachel legen, niedrigeren Vorrang zuerst. Land über Wasser ergibt das Ufer, Wasser deckt nie Land. Fehlt `blend.png`, bleibt alles wie bisher.

Prüfbild: `python3 tools/blender/preview_blend.py [--style vorgerendert] [--out .local/preview/blend.png]` setzt eine kleine Karte aus Gras, Wiese, Waldboden, Fels, Erde und Wasser einmal ohne und einmal mit Übergängen zusammen, genau nach dieser Regel.

## Prüfbilder

```sh
python3 tools/blender/preview.py [--style vorgerendert] [--out .local/preview]
```

Schreibt vergrößerte Kontaktbögen der neuen Objekte und aller Figuren, ein Geländebild (Blatt und Flächen aus gemischten Varianten) und zwei Testszenen in allen vier Kameradrehungen: Mauerzug mit Turm, Treppe, Tor, Ecke, T, Kreuz, Enden und Schützen auf den Posten (Teile per Autotiling wie im Spiel) sowie den früheren Lagerplatz mit allen Stapeln und den Trägern (zeigt noch `lager_boden`, nicht das Lagerhaus).

Auf die Konzeptseite kommen Figuren und Gebäude mit [`tools/konzeptseite/build.py`](../konzeptseite/README.md).
