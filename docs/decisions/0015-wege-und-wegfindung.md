# 0015 – Wege, Brücken und schnellere Wegfindung

**Status:** angenommen (17.11.2026). Grundlage für Transport (BRIEF §5.3) und für viele Figuren auf großen Karten (§11). Das Fuhrwesen mit Ochsenkarren ist noch offen (siehe Grenzen).

## Kontext
Das Briefing verlangt, dass Straßen den Transport beschleunigen und die Transportwege sinnvoll berechnet werden (§5.3). Flüsse sollen den Transport beeinflussen (§3), und die Leistung soll auch bei vielen arbeitenden Figuren halten (§11).

Bis hier gab es nur die vorgegebenen Erdwege der Karte (Gelände `erde`). Über den Fluss führte eine Furt, gebaut werden konnte keine Brücke. Dazu baute jede Änderung an Gebäuden oder Fels das ganze Laufraster neu auf und beschriftete die Zusammenhangskomponenten neu. Jede Suche lief als vollständiges A*, und der Pfad-Cache wurde dabei jedes Mal ganz geleert.

## Optionen
**Wege:**
1. *Wege als Geländeart* (Kachel wird `pflaster`): Das ist einfach. Bauen, Material, Abriss und Baustelle müssten aber eigens nachgebaut werden, und das Gelände ist bisher unveränderlich.
2. *Wege als Bauten mit `road` in den Daten*: Ein Weg ist ein 1 × 1-Bau, der kein Hindernis ist und im Laufraster nur Kosten setzt. Baustelle, Materiallieferung, Bauarbeiter, Abriss, Speichern, Auswahl und Darstellung kommen von den Bauten.

**Wegfindung:**
1. *Flussfelder je Ziel*: Sie lohnen sich bei wenigen Zielen mit vielen Suchern, etwa beim Marsch auf einen Punkt. Hier sind die Ziele aber sehr verschieden (jede Baustelle, jedes Fach, jeder Baum), und jedes Feld kostet Speicher in Kartengröße.
2. *Inkrementelles Laufraster, örtlich nachgeführte Komponenten und ein Pfad-Cache mit gezielter Invalidierung*: Diese Variante behält A* und das Ergebnis bitgenau bei und spart die wiederholte Arbeit.

## Entscheidung
Für die Wege Option 2, für die Wegfindung ebenfalls Option 2.

### Wege und Brücke (Daten `src/data/transport.ts`, Reiter „Wege“ auf F7)

| Bau | Kosten je Feld | `road.cost` | Tempo |
|---|---|---|---|
| Kiesweg | 1 Stein | 0,62 | × 1,61 |
| Pflasterstraße | 2 Stein | 0,55 | × 1,82 |
| Holzbrücke | 4 Holz | 0,7, `bridge` | nur auf Wasser |

Zum Vergleich: Gras hat die Kosten 1, der vorgegebene Erdweg 0,7.

- **Ziehen wie eine Mauer:** Der Befehl ist `weg` (`build.roadPath`, Vorschau `Game.roadPath`). Wege laufen gerade oder L-förmig. Schon liegende Wege und Brücken werden übersprungen. Ein Hindernis lehnt die ganze Linie ab. Reicht das Material nur für einen Teil, werden die bezahlbaren Stücke vom Start aus gebaut.
- **Wege vor Türen:** Ein Weg darf vor einer Tür liegen (ADR 0010). Er ist kein Ziel für Angreifer.
- **Brücke:**
  - Sie läuft gerade in Zugrichtung (Ausrichtung 0 entlang Welt-x, 1 entlang Welt-y), nur über Wasser und höchstens 8 Felder.
  - Landfelder an den Enden werden übersprungen. Beide Enden müssen an begehbarem Ufer liegen.
  - Eine Brücken-Baustelle macht das Wasser nicht begehbar. Erst das fertige Joch ist begehbar. So wird die Brücke vom Ufer aus Feld für Feld gebaut: Das nächste Joch ist erst erreichbar, wenn das vorige steht. Für noch nicht erreichbare Joche gibt es keine Warnung.
- **Bauen:** Tagelöhner bringen das Material und bauen Feld für Feld, wie bei jeder Baustelle (ADR 0009). Die Fertigmeldung ist gedrosselt.
- **Laufraster:** Ein fertiger Weg setzt an seinem Feld `road.cost` statt der Geländekosten. Figuren gehen dort mit `1 / Kosten` schneller (`move.speedOf`, Obergrenze `1 / MIN_COST` aus den Daten). A* bevorzugt Wege von selbst, weil sie billiger sind.
- **Darstellung:**
  - Autotiling mit derselben Nachbarmaske und denselben Teilen wie die Mauer (`geom.wallPiece`, Teile `<road.pieces>_<teil>`). Kies und Pflaster schließen aneinander an.
  - Wege liegen flach in der Tiefensortierung: Figuren gehen darüber, hohe Bauten davor verdecken sie. Sie sind anklickbar (Abriss).
  - Die Brücke ist ein Joch mit Pfählen, Bohlen und Geländer, Ansicht `(o − r) mod 4`.
- **Grafik:**
  - Blender (`tools/blender/buildings.py`, Seeds 600–614), Stil vorgerendert.
  - Je 6 Teile Kies und Pflaster auf einem 8 × 8-Zellenraster, das unter Vierteldrehungen gleich bleibt. Dadurch gibt es keine Naht in keiner Drehung.
  - Dazu die Brücke sowie die Baustellen `baustelle_weg` (abgesteckt, Bett mit Kies) und `baustelle_bruecke` (Pflöcke, Joch).

### Inkrementelles Laufraster (`src/sim/nav.ts`)
- **Teilaufbau:** `Nav.refresh()` vergleicht die Signatur jedes Baus mit dem letzten Stand: Schlüssel, Lage, Ausrichtung, fertig ja/nein und Ausbaustufe. Ebenso vergleicht es Felsbrocken und Gelände. Neu bestimmt werden nur die Rechtecke der Änderungen samt Rand von einem Feld (Eckenregel der Diagonalen). Übergänge (Treppen, Turmtüren) werden nur dort neu gesetzt, wo ein Ende im Rechteck liegt.
- **Komponenten:**
  - Sie werden erst bei Bedarf bestimmt (`comp`) und nach einer Änderung örtlich nachgeführt (`patchComponents`).
  - Ein Fenster um die Änderung wird neu geflutet. Berührt ein Stück dabei mehrere alte Nummern, werden diese über eine Aliasliste vereinigt. Neue Inseln bekommen neue Nummern.
  - Nur bei einer möglichen Trennung (eine alte Nummer verschwindet aus dem Fensterrand) wird alles neu beschriftet.
  - Die Nummern dürfen von einer vollständigen Beschriftung abweichen, die Einteilung ist dieselbe (Test).
- **Pfad-Cache:**
  - A* entscheidet bei Gleichstand nach (Schätzung, Knotennummer). Das Ergebnis hängt also nur von Raster, Start und Ziel ab.
  - Ein gespeicherter Weg mit Kosten C bleibt nach einer Änderung im Rechteck R gültig, wenn schon die Luftlinie Start → R → Ziel (Oktil-Abstand × kleinste Feldkosten) mehr als C kostet. Kein besserer Weg kann dann durch R führen, und der alte berührt R nicht.
  - Unerreichbar-Einträge werden immer verworfen.
  - Ändert sich die kleinste Feldkosten auf der Karte (das erste Pflaster), wird der Cache geleert.
- **Kleinste Feldkosten:** Die untere Schranke der Suche ist nicht das kleinste denkbare `road.cost`, sondern das kleinste tatsächlich vorhandene. Sonst würde allein die Existenz von Pflaster in den Daten die Suche auf Karten ohne Pflaster verlangsamen.
- **Haufen:** Der Haufen der Suche liegt in typisierten Feldern.

### Messung (`tests/sim/transport-leistung.test.ts`, lokal gemessen, Mittel mehrerer Läufe)

| | vorher | nachher |
|---|---|---|
| Großkarte 128 × 128, 330 Figuren, 26 Bauänderungen in 60 s: ms je Tick | 0,61–0,65 (p99 5,3–5,6) | 0,38–0,42 (p99 3,2–3,5) |
| Suchen / Knoten | 774 / 373 899 | 738 / 372 341 |
| Treffer im Pfad-Cache | gering (Cache bei jeder Änderung leer) | 361; 5807 Wege behalten, 385 verworfen |
| Rasteränderung 128 × 128 | 2,4–3,4 ms (Neuaufbau) | 0,15–0,25 ms |
| Rasteränderung 256 × 256 | 9,8–14 ms | 0,39–0,64 ms |
| Lasttest (`perf.test.ts`) ms je Tick | 0,21–0,23 | 0,15–0,17 |

Die Komponenten wurden in 19 von 20 Änderungen örtlich nachgeführt.

**Bestimmtheit:**
- `transport-raster.test.ts` prüft als Eigenschaft: Nach jeder zufälligen Folge von Bauen, Mauern, Fertigstellen, Abriss, Fels- und Geländeänderung ist das Raster gleich dem Neuaufbau (Begehbarkeit aller Ebenen, Kosten, Höhen, Übergänge, Komponenten).
- Ein Spiel mit Cache verläuft gleich wie eines, das den Cache nach jedem Tick leert.
- Laden mitten im Spiel läuft gleich weiter.

## Grenzen
- **Fuhrwesen:** Ochsenkarren, Fuhrhof, Handkarren und Karrenfiguren sind nicht umgesetzt. Große Mengen gehen weiterhin zu Fuß, Stück für Stück.
- **Märsche:** Keine Flussfelder. Marschbefehle vieler Soldaten suchen weiter je Einheit. Der Gewinn je Tick kommt vor allem aus den gesparten Neuaufbauten, die Trefferquote des Caches liegt bei etwa einem Viertel.
- **Brücke:**
  - Sie liegt flach in der Tiefensortierung. Das vordere Geländer verdeckt Figuren auf der Brücke deshalb nicht.
  - Figuren gehen auf Bodenhöhe, das Deck liegt nur 0,16 m über dem Wasser.
  - Für Angreifer ist die Brücke ein Weg wie jeder andere: Sie können sie nutzen, aber nicht gezielt zerstören.
- **Wege:**
  - Sie verbinden sich nur mit Wegen, nicht mit Türen oder dem vorgegebenen Erdweg.
  - Ein Weg über den Erdweg bringt mit Kies kaum etwas (0,62 statt 0,7).

## Folgen
- Neue Wegarten oder Brücken sind ein Eintrag in `transport.ts` mit `road` und, für Autotiling, sechs Sprites `<pieces>_<teil>`.
- Wer Gelände oder Bauten ändert, ruft `nav.refresh()` statt `rebuild()`. Das Raster findet die Änderungen selbst.
