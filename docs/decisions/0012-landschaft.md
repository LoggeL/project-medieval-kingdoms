# 0012 – Landschaft: Gebirge, Hügel, Sumpf, See, Küste, fruchtbarer Boden und Steinvorkommen

**Status:** angenommen (17.11.2026). Hügel sind ein Zwischenschritt ohne echte Höhenstufen (siehe Folgen).

## Kontext
BRIEF §3 verlangt Landschaftstypen mit wirtschaftlichen und strategischen Folgen: Wälder, fruchtbare Ebenen, Hügel und Gebirge, Flüsse und Seen, Küsten, Steinbrüche nur an Felsformationen, Sümpfe. Bisher kannte die Karte Gras, Wiese, Waldboden, Erde, Fels und Wasser: Wald im Westen, ein Felsfeld im Norden, Fluss mit Furt im Osten. Auf der Standardkarte (Seed 1) lagen 13 Brocken mit zusammen 164 Steinblöcken. Das reicht für eine Burg nicht.

Randbedingungen:
- Die Startsiedlung muss spielbar bleiben: Wald, Fels und Wiese erreichbar, und der Überfallweg von Osten über die Furt frei.
- Sieben andere Zweige bauen gleichzeitig auf demselben Stand und haben Tests mit Seed 1. Deren Verlauf soll sich so wenig wie möglich verschieben.
- Bestehende Grafik bleibt bytegleich.

## Optionen
1. **Echte Höhenstufen** (Höhe je Kachel, Böschungskacheln, Sortierung und Wege mit Höhe): passt zur Isometrie am besten, berührt aber Raster, Sortierung, Laufraster, Platzierung und alle Gebäudesprites. Das ist ein eigenes Vorhaben.
2. **Geländearten mit Eigenschaften, Gebirge als nicht begehbares Hindernis mit eigenem Sprite je Kachel, Hügel als langsamere Geländeart**: Diese Option fügt sich in TERRAIN, Laufraster und Bauregeln ein, ohne dass ein Sonderfall nötig wird.
3. **Gebirge nur als dunkle Bodenkachel**: Das wäre billig, wirkt aber nicht wie ein Berg. Ein Hindernis, das man nicht als solches sieht, ist für den Spieler kaum lesbar.

## Entscheidung
Option 2.

**Daten** (`src/data/gelaende.ts`, in `index.ts` nur eingehängt):

| Art | begehbar | bebaubar | Kosten | Bedeutung |
|---|---|---|---|---|
| `gebirge` | nein | nein | – | Felsmassiv, festes Hindernis wie Wasser |
| `huegel` | ja | ja | 1,5 | Hügel als Geländeart (Zwischenschritt) |
| `sumpf` | ja | nein | 2,2 | langsam und kein Bauland |
| `sand` | ja | ja | 1,15 | Strand und Seeufer |
| `fruchtbar` | ja | ja | 1 | Auenboden, bester Ackerboden |

- `cost` ist wie bisher zugleich Wegkosten und Gangart (`speedOf` = 1 / cost, begrenzt auf 0,55–1,45). Wege machen deshalb einen Bogen um Sumpf und Hügel, wenn er sich lohnt.
- **Felder:** `FELD_BODEN = { fruchtbar: 1, wiese: 0,7 }` mit `feldErlaubt(t)` und `fruchtbarkeit(t)`. Der Ackerbau (Zweig nahrung) fragt je Feldkachel ab, ob ein Feld möglich ist und mit welchem Ertragsfaktor.
- **Stein** (`STEIN`):
  - `field` 8–16 Blöcke je Brocken im Felsfeld an der Startsiedlung, wie vorher, damit der Spielbeginn gleich bleibt.
  - `amount` 20–36 je Brocken der neuen Vorkommen: Die reichen Lagerstätten liegen weiter draußen, an den Hügelkuppen und an der Geröllhalde.
  - Nachrutschen: `reach`, `slideSeconds`, `slideAmount`, `slideMax`.
- **Aufbau** (`LANDSCHAFT`): Lage und Größe von Massiv, Halde, Hügelsaum, Kuppen, See, Küste, Sumpf und Auen, jeweils als Anteil der Kartengröße. Dazu `schutz`, den Abstand um die Startsiedlung, in dem nichts verändert wird.

**Kartengenerator** (`src/sim/mapgen.ts`):
- Der Grundaufbau zieht genau dieselben Zufallszahlen wie vorher. Danach legt `landscape()` mit eigenem Zufall (aus dem Seed abgeleitet) die Landschaft darüber:
  - Felsmassiv im Nordwesten mit Geröllhalde (Fels) und Hügelsaum
  - zwei Hügelkuppen mit Felskopf: eine südlich der Siedlung, eine östlich des Flusses
  - ein See mit Sandufer am Waldrand
  - die Küste im Süden (Sandstrand und Meer)
  - Sumpf an der Flussmündung
  - fruchtbarer Boden in den Auen, am See und in Flecken
- **Unverändert bleiben:** Startsiedlung, Straße, Furt, Erde, Wasser und der Weg zum Steinbruch.
- **Bäume und Brocken:**
  - Alte Bäume bleiben nur auf Boden, der Bäume trägt, alte Brocken nur auf Fels.
  - Neue Bäume wachsen auf Hügeln und im Sumpf, nicht in Siedlungsnähe.
  - Neue Brocken entstehen auf den Felsköpfen und an der Halde. Die Halde startet voll mit `slideMax` Brocken.
- **Späte IDs:** Die neuen Bäume und Brocken bekommen ihre IDs erst nach der Startaufstellung (`MapResult.late`). Gebäude und Figuren behalten so dieselben IDs wie auf der Karte ohne Landschaft.
- **Darstellung:** `mountainClass()` liefert die Höhenklasse eines Gebirgsfelds (0 Rand, 1 Hang, 2 Gipfel, nach dem Abstand zum Rand des Massivs; außerhalb der Karte zählt als Gebirge).

**Nachrutschen** (`src/sim/gelaende.ts`, im Tick nach den Bäumen):
- Die Felskacheln bis `reach` Felder vom Gebirge bilden die Geröllhalde.
- Alle `slideSeconds` (40 s) rutscht dort ein Brocken mit 10–16 Blöcken nach, solange weniger als `slideMax` (6) Brocken auf der Halde liegen. Weil die Halde voll beginnt, rutscht erst nach dem Abbau etwas nach.
- **Wo kein Brocken nachrutscht:**
  - neben einem anderen Brocken
  - auf einem Baum oder Gebäude
  - in der Nähe einer Figur
  - vor einer Tür
  - wenn er Wege trennen würde: Die begehbaren Nachbarn müssen ohne die Stelle über Kantennachbarn zusammenhängen, siehe ADR 0010.
- **Wahl der Stelle:** Ein Hash aus Tick und Seed wählt die Stelle, nicht der Weltzufall. Andere Systeme ziehen daher dieselben Zufallszahlen.
- **Zustand:** Es gibt keinen eigenen Zustand. Ob etwas nachrutscht, folgt aus Tick, Gelände und Brocken, die alle im Spielstand liegen; Speichern und Laden ist geprüft.
- Eine Meldung (gedrosselt) sagt dem Spieler, dass am Hang neue Brocken liegen.

**Wege:** Beim Prüfen der Kartendaten fiel ein alter Fehler auf. Ein schon geplanter Weg wurde nach einer Änderung des Laufrasters (`navVersion`) nur auf gesperrte Knoten geprüft, nicht auf Diagonalen, an deren Ecke inzwischen etwas steht. Eine Figur konnte so an einer neuen Baustelle die Ecke schneiden. Neu prüft `nav.cutsCorner()` dieselbe Regel wie die Suche, und `move.ts` verwirft solche Wege.

**Grafik** (Blender, Stil „vorgerendert“, Seeds 300–399):
- **Bodenkacheln** `huegel`, `fruchtbar`, `sand`, `gebirge` (Geröll) aus `tools/blender/terrain.py`:
  - Sie liegen in einem eigenen Bild `gelaende.png`, damit `terrain.png` und `blend.png` bytegleich bleiben.
  - `sheet.json` bekommt die Schlüssel mit `"image": "gelaende.png"`; der Loader liest Kacheln aus mehreren Bildern.
  - `sumpf` gab es im Blatt schon.
  - Übergänge über `BLEND_ORDER`: wasser, sumpf, sand, erde, gebirge, fels, huegel, waldboden, fruchtbar, gras, wiese.
- **Felsmassiv** `gebirge` aus `tools/blender/buildings.py`:
  - 12 Bilder: 3 Höhenklassen (Rand mit Krüppelkiefer, Hang, Gipfel mit Schnee) × 4 Varianten, je 4 Ansichten.
  - Die Darstellung setzt auf jedes Gebirgsfeld ein Teil (Bild = Höhenklasse · 4 + Variante aus der Tile-Nummer, Ansicht aus `viewOf`). Das Massiv steigt so zur Mitte hin an und dreht sich in jeder Ansicht richtig.
  - Die Teile verdecken Figuren dahinter (Silhouette).
  - Gezeichnet wird nur der Inhaltsrahmen der Zelle; das hat die Füllrate im Kopflos-Browser von 310 auf 72 ms pro Bild gesenkt.
  - Fehlt das Sprite, bleibt nur der Geröllboden, ohne Ersatzbild.
- **Übersichtskarte:** zeigt alle Arten, das Gebirge zum Gipfel hin heller.

## Folgen
- **Hügel ohne echte Höhe:** Hügel sind langsamer und bebaubar, aber sie heben nichts an. Es gibt keinen Sicht- oder Reichweitenbonus, und die Hügelkacheln zeigen ihre Wölbung nur über die Lichtschattierung. Echte Höhenstufen (Option 1) bleiben offen. Sie würden `huegel` ablösen, und die Kartendaten (Lage der Kuppen) können dann die Höhe liefern.
- **Gebirge als Hindernis:** Das Gebirge ist ein festes Hindernis wie Wasser. Auch Angreifer im Belagerungsmodus kommen nicht hindurch (Langlauf mit Überfällen). Ob sich Mauern sauber an den Fuß des Massivs anschließen lassen, ist nicht eigens geprüft.
- **Steinmengen:**

  | Karte | Brocken | Steinblöcke | dazu |
  |---|---|---|---|
  | 64 × 64, vorher (Seed 1) | 13 | 164 | – |
  | 64 × 64, Seeds 1–12 | 26–32 | 537–690 | Nachrutschen |
  | 96 × 96, Seeds 1–12 | 54–61 | 989–1272 | – |

- **Messung bei 96 × 96** (Seed 1): Erzeugen etwa 15 ms (64: 9 ms), ein Simulationstick ohne Überfall etwa 0,007 ms wie bei 64.
  - Darstellung im kopflosen Chrome, also Software-Rendering: Startansicht 33–35 ms pro Bild auf beiden Karten.
  - Blick aufs Massiv: 72 ms (64) bzw. 72–130 ms (96, 289 Gebirgsfelder statt 116).
  - Auf einer echten Grafikkarte nicht gemessen.
  - `?karte=96&seed=7` (nur im Entwicklungsmodus) startet eine größere Karte.
- **Folge für die Tests anderer Zweige:** Der Verlauf von Seed 1 ändert sich, weil Bäume, Brocken und Wegkosten anders sind. Die Prüfung „braucht dort über zwei Minuten“ in `tests/sim/bergfried.test.ts` liegt knapp über der Grenze: 2454, 2504 und 2454 Ticks bei Grenze 2400. Mit der ersten Fassung, in der die Halde halb leer begann und sofort nachrutschte, lag ein Lauf bei 2393. Die Halde beginnt deshalb voll, und das Felsfeld am Start behält 8–16 Blöcke.
- **Tests:** `tests/sim/gelaende.test.ts` prüft:
  - den Generator: deterministisch, alle Arten bei 64 und 96, Bäume und Brocken auf passendem Boden, eindeutige IDs
  - die Bauregeln je Art und die Feldabfrage
  - Wege um Gebirge und Sumpf, auch eine laufende Figur
  - die Startsiedlung für 9 Karten: Wald, Fels und Wiese erreichbar, Überfallweg frei, Straße durchgehend
  - die Steinmenge und Verteilung
  - das Nachrutschen: deterministisch, trennt keine Wege, Speichern und Laden
  - zwei Langläufe: Steinbruch an der Halde über 24 000 Ticks; Überfälle auf drei Karten, bei denen keine Figur das Gebirge betritt

  `tests/render/gelaende.test.ts` prüft:
  - die Massivteile in allen Drehungen
  - die Verdeckung mit beschnittenen Texturen
  - Blatt und Übergänge für jede Art
