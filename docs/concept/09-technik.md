# 09 – Technik und Architektur

> Status: **Entwurf v1** (16.11.2026). Beantwortet die Punkte aus Briefing §14.

## 1. Engine

**Vorschlag: TypeScript + PixiJS v8 + Vite**, Simulation als renderer-freies Modul. Begründung und Alternativen in [ADR 0001](../decisions/0001-engine.md). Kurz: Den Iso-Renderer mit echter Drehung muss man in jeder Engine selbst bauen. Im Browser ist der Prototyp sofort mit Sebastian teilbar, und die Simulation lässt sich ohne Grafik testen.

## 2. Schichten

```
src/
  data/      Definitionen: Gelände, Waren, Gebäude, Einheiten, Rezepte, Technologien (TS + Schema-Prüfung)
  sim/       Spiellogik: Welt, Raster, Entitäten, Systeme, Pfadsuche, Wirtschaft, Kampf, Forschung
             – kein Import aus render/ oder ui/, läuft auch in Node (Tests) und im Web Worker
  render/    Iso-Projektion, Kamera, Drehung, Tiefensortierung, Sprites, Animation, Effekte
  ui/        Leisten, Panels, Raster, Overlays (DOM oder Pixi, mittelalterliches Skin)
  app/       Spielschleife, Eingabe → Befehle, Laden und Speichern, Einstellungen
tests/       Simulationstests (Vitest), Rendering-Stichproben (Playwright-Screenshots)
```

Die UI schickt **Befehle** an die Simulation (`PlaceBuilding`, `MoveUnits`, `StationOnWall` …), die Simulation meldet **Ereignisse** zurück. Das macht später auch Mehrspieler (Befehle übers Netz) und Wiederholungen möglich.

## 3. Isometrisches Koordinatensystem

- **Wahrheit ist das Weltraster:** Tile `(x, y)` mit Höhe `h` und Laufebene `l`. Einheiten haben eine Weltposition in Bruchteilen von Tiles.
- **Drehung** `r ∈ {0, 1, 2, 3}` transformiert Welt in Ansicht, bevor projiziert wird (Karte W × H):

| r | u (Ansicht) | v (Ansicht) |
|---|---|---|
| 0 | x | y |
| 1 | H − 1 − y | x |
| 2 | W − 1 − x | H − 1 − y |
| 3 | y | W − 1 − x |

- **Projektion** (Tile 64 × 32, Höhenstufe 16 px):
  `bildX = (u − v) · 32` · `bildY = (u + v) · 16 − h · 16`
- **Mausauswahl** rechnet rückwärts: Bild → (u, v) → Welt, wobei die Höhe von vorn nach hinten geprüft wird (der höchste getroffene Tile gewinnt).
- **Tiefensortierung:** Sortierschlüssel `u + v`, dann Höhe, dann Laufebene, dann Objektart. Große Gebäude werden in **Tile-breite Streifen geschnitten**, und jeder Streifen wird einzeln einsortiert. Das löst die klassischen Überlappungsfehler mehrteiliger Iso-Gebäude, auch nach jeder Drehung.

## 4. Drehung und Zoom

- **Gebäude** speichern ihre Welt-Ausrichtung `o`. Angezeigt wird die Ansicht `(o − r) mod 4`. Der Grundriss wird in Weltkoordinaten geprüft, die Drehung der Kamera ändert daran nichts.
- **Figuren** speichern ihre Blickrichtung in Welt-Oktanten `d`. Angezeigt wird `(d − 2r) mod 8`.
- **Mauern** speichern ihre Nachbarschaft in Welt-Richtungen, das Autotile-Sprite wird erst beim Zeichnen gewählt.
- **Drehwechsel:** kurzes Überblenden (ca. 150 ms), danach werden Sortierung und sichtbarer Bereich neu aufgebaut. Der Kamerafokus bleibt auf demselben Welt-Tile.
- **Zoom:** ganzzahlige Faktoren 1×–3× für pixelscharfe Darstellung. Die 0,5×-Übersicht nutzt vorgerechnete, verkleinerte Atlanten. Die Kamera bewegt sich weich, rastet aber beim Stillstand auf ganze Bildschirmpixel ein.
  *Umgesetzt (ADR 0005):* acht Stufen 0,25×–4×; 1,5× wird pixelgenau bei 2× gerendert und weich verkleinert, Stufen unter 1× linear gefiltert statt mit vorgerechneten Atlanten.

## 5. Simulation

- **Feste Tick-Rate: 20 Ticks pro Sekunde**, unabhängig von der Bildrate. Die Darstellung interpoliert Positionen zwischen zwei Ticks.
- **Deterministisch:** eigener Zufallsgenerator mit Seed, feste Systemreihenfolge, keine Abhängigkeit von Bildrate oder Uhrzeit. Das hilft bei Tests, Wiederholungen und späterem Lockstep-Mehrspieler.
- **Entitäten mit Komponenten** (leichtgewichtiges ECS mit flachen Arrays): Position, Bewegung, Arbeiter, Träger, Ladung, Gebäude, Lager, Kampf, Posten, Moral … Systeme laufen nacheinander über die passenden Entitäten.
- **Teure Arbeit gestaffelt:** Nicht jedes System muss jeden Tick laufen. Der Disponent läuft z. B. 2× pro Sekunde, Zufriedenheit 1× pro Sekunde, Wachstum alle 5 Sekunden.

## 6. Sichtbare Produktion: Arbeitszyklen

Gebäude beschreiben ihre Arbeit **als Daten**, die Simulation führt sie als Zustandsautomaten aus:

```ts
woodcutter: {
  footprint: [2, 2], workers: 1, storage: { output: { wood: 4 } },
  placement: { nearby: { tag: 'tree', count: 8, radius: 10 } },
  cycle: [
    { do: 'reserveNearest', tag: 'tree', radius: 10 },
    { do: 'walkTo', target: 'reserved' },
    { do: 'work', anim: 'chop', seconds: 6, effect: 'fellTree' },
    { do: 'work', anim: 'saw',  seconds: 4, produce: { wood: 1 }, carry: true },
    { do: 'walkTo', target: 'home' },
    { do: 'deposit', into: 'output' },
  ],
}
```

- `anim` sagt der Darstellung, was gezeigt wird. Die Simulation kennt nur Dauer und Wirkung.
- `effect` ändert die Welt: Baum wird Stumpf, Fels schrumpft, Feld wechselt die Wachstumsstufe.
- Animationen kosten die Simulation nichts. Sie sind reine Darstellung.

## 7. Arbeiter und Transport

- **Hofstapel und Lager-Slots** sind Komponenten mit Warenart und Menge. Daraus entstehen **Angebote** (abzuholen) und **Nachfragen** (anzuliefern).
- Der **Disponent** ordnet 2× pro Sekunde zu: Für jede Nachfrage wird das günstigste Angebot über Wegkosten gesucht und ein freier passender Träger beauftragt. Ware wird beim Auftrag **reserviert**, damit nicht zwei Träger dasselbe holen.
- **Distanzkarten:** Für jedes Lager wird eine Wegkostenkarte über das ganze Raster vorgehalten (Dijkstra von den Lager-Eingängen). Damit ist die Frage „welches Lager ist am nächsten?“ ein Nachschlagen statt einer Suche. Neu berechnet wird nur bei Bauänderungen, und dann nur lokal.
- **Karren** benutzen ein eigenes Kostenprofil (Straße billig, Gelände teuer) und eine eigene Karte.

## 8. Pfadsuche

- **Graph:** Raster-Tiles je Laufebene (Boden, Wehrgang, Turm) mit **Übergangskanten** an Treppen, Türmen, Toren, Leitern und Breschen. Kosten nach Untergrund, Straße und Steigung.
- **Einzelwege:** A* auf einem **hierarchischen Raster** (Abschnitte von 16 × 16 Tiles mit vorberechneten Übergängen). Das ist schnell auch auf 256 × 256.
- **Gruppenbewegung:** Ein **Flussfeld** zum Ziel, dem alle Einheiten der Gruppe folgen, dazu lokales Ausweichen (Abstoßung) und Formations-Slots.
- **Änderungen** (neue Mauer, Tor zu, Bresche) machen nur betroffene Abschnitte ungültig.
- **Caching** häufiger Routen (Arbeiter ↔ Lager) über die Distanzkarten.

## 9. Gebäude und Einheiten modular

Alle Inhalte sind Daten mit Schema-Prüfung beim Start:
- **Gebäude:** Grundriss, Eingang, Platzierungsregeln, Kosten, Bauzeit, Arbeitsplätze, Lager, Arbeitszyklus, Ausbaustufen, Freischaltung, Sprite-Satz
- **Einheiten:** Werte, Schadensart, Rüstungsklasse, Ausrüstung (Waren), Kosten, Sold, Ausbildungsgebäude, Freischaltung, Animationssatz, Fähigkeiten (z. B. `climbLadder`, `stationOnWall`, `formation:pike`)
- **Waren, Gelände, Technologien** ebenso

Neue Einheiten und Gebäude brauchen im Regelfall **keinen neuen Code**, nur Daten und Grafik.

## 10. Forschung und Freischaltung

- Jede Technologie hat Voraussetzungen, Kosten, Dauer, Forschungsstätte, optional eine Doktrin-Gruppe und eine Liste von **Wirkungen**: `unlock(building|unit|formation)`, `modify(stat, wert)`, `upgradeVisual(set)`.
- Freischaltungen sind ein Set im Spielerzustand. Kaserne, Baumenü und Raster fragen nur dieses Set ab.
- Wirkungen auf Werte laufen über ein **Modifikator-System**, sodass alles nachvollziehbar und rücknehmbar bleibt.

## 11. Leistung

Ziel: **1.500 aktive Figuren bei 60 FPS** auf einem durchschnittlichen Laptop (256 × 256-Karte).
- Rendering: Texturatlanten, Sprite-Batching, Culling auf den sichtbaren Bereich, Gelände als vorgerenderte Abschnitte (Chunks)
- Simulation optional im **Web Worker**, Übergabe der Positionen über geteilte Puffer
- Kein Pfadsuchen pro Bild, nur bei Bedarf und gestaffelt
- Früher **Lasttest** im Prototyp: 2.000 Träger auf einer leeren Karte

## 12. Speichern

Versionierter Schnappschuss des gesamten Simulationszustands (JSON, komprimiert) mit Schema-Version und Migrationsfunktionen. Zufallsgenerator-Stand und Tick-Nummer werden mitgespeichert. Darstellung und UI werden beim Laden neu aufgebaut.

## 13. Tests

- **Simulation (Vitest, ohne Grafik):** Holzfäller liefert in X Ticks Y Holz; volles Lager stoppt Produktion; Fuhrwerk bevorzugt Straße; Stationierung verteilt korrekt; Einheit am Boden erreicht Wehrgang nur über Treppe oder Leiter; Speicherstand ergibt nach dem Laden identische Folge-Ticks
- **Rendering (Playwright):** Screenshots in allen vier Drehungen und drei Zoomstufen, Mausauswahl trifft nach Drehung den richtigen Tile
- **Leistung:** automatischer Lasttest mit Bildzeit-Messung

## 14. Erster spielbarer Prototyp (M1–M3)

| Briefing §14 | Umsetzung |
|---|---|
| Detailreiche iso Landschaft | Prototyp-Karte (siehe [Welt](02-welt-und-karten.md)), Assets aus dem Look-Test |
| Kamera mit Rotation und Zoom | 4 Drehungen, 3 Zoomstufen plus Übersicht |
| Auswahl und Platzierung | Baumenü, Vorschau, Regeln, Gebäude drehen |
| Holzfäller | Arbeitszyklus wie oben, Bäume fallen, Stümpfe bleiben |
| Steinbruch | 3 Arbeiter, Fels schrumpft, Hofstapel, Ochsenkarren |
| Physischer Transport | Selbstträger, Tagelöhner, Fuhrhof |
| Lager mit wachsendem Bestand | Lagerplatz-Module mit sichtbaren Füllstufen, erweiterbar |
| Kaserne | Ausbildung mit Ausrüstung aus dem Lager |
| 3 Militäreinheiten | Speerkämpfer, Schwertkämpfer, Bogenschütze |
| Begehbare Mauer | Steinmauer, Treppe, Turm, Tor, Stationierung, geskripteter Überfall mit Leitern |
| Mittelalterliches UI | Kopfleiste, Fußleiste, Pergament-Panel, Einheitenraster |
