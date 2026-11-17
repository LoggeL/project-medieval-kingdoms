# 0006 – Bergfried als Sitz, Ausbaustufen und Forschung

**Status:** entschieden (17.11.2026, Wunsch Logge: ein Bergfried wie in Stronghold als Stadtgebäude, das Lager daneben, der Bergfried entwickelt sich über Forschung weiter).

## Kontext
Das BRIEF verlangt Fortschritt ohne Zeitalter: einzelne Forschungen schalten Einheiten, Gebäude und Verbesserungen frei (§6.3). Bisher gab es keine Forschung und kein Zentrum. Wenn ein Überfall alles zerstörte, lief die Partie trotzdem weiter. Gesucht war ein Ort für die Forschung, ein Ziel für die Verteidigung und ein Gebäude, das sichtbar mit der Siedlung wächst.

## Entscheidung
- **Ein Sitz je Spieler.** `BuildingDef.seat` markiert den Bergfried. Er steht beim Start neben dem Lagerhaus (`START.buildings`). Man kann ihn nicht bauen, nicht ein zweites Mal setzen und nicht abreißen. Fällt er, setzt die Simulation `SimState.outcome = "niederlage"` und meldet es. Die Oberfläche hält das Spiel an und zeigt eine Tafel. Die Simulation selbst läuft weiter, damit Tests und Zuschauen möglich bleiben.
- **Ausbaustufen als Daten.** `BuildingDef.levels[]` überschreibt Name, Sprite, Leben, Wohnraum, Steuern, Wehrplattform (`walkway`, `deck` = Höhenstufe, `posts`) und Innenansicht je Stufe. `levelDef(key, level)` liefert die zusammengeführte Sicht, und alle Stellen (Kampf, Laufraster, Posten, Darstellung, Panel) lesen nur diese. Ein Ausbau (`BuildingLevel.upgrade`: Kosten, Bauzeit, nötige Forschung) läuft wie eine Baustelle: Gold sofort, Material tragen Tagelöhner herbei (`needs`/`site`), dann baut ein Tagelöhner mit Bauanimation (`Building.upgrade.t`). Das Gebäude bleibt dabei in Betrieb.
  - Stufe 1, hölzerner Bergfried: 2500 Leben, 10 Wohnraum, 4 Gold je Minute, keine Plattform.
  - Stufe 2, steinerner Bergfried (Steinbaukunst): 5000 Leben, 14 Wohnraum, 8 Gold je Minute, Plattform auf 5 Stufen mit 4 Posten.
  - Stufe 3, Burgfried (Festungsbau): 8000 Leben, 18 Wohnraum, 12 Gold je Minute, Plattform auf 6 Stufen mit 6 Posten.
- **Forschung als Daten** (`src/data/research.ts`, `TECHS`). Jede Technik hat Kosten, Dauer, Voraussetzungen (Techniken, fertige Gebäude, Stufe des Bergfrieds), Effekte (Arbeitszeit je Animation, Einheitenboni, Tragtempo, Steuerfaktor), Ikone und Zweig. Freischaltungen stehen beim Freigeschalteten (`BuildingDef.tech`, `UnitDef.tech`, `BuildingLevel.upgrade.tech`). Die Oberfläche liest daraus, was eine Technik freischaltet. Sieben Techniken im Prototyp: Steinbaukunst, Festungsbau, Marktrecht, Gehärtete Werkzeuge, Tragjoch, Langbogen, Schwere Rüstung.
- **Forschung ist physisch.** Geforscht wird im Bergfried, immer nur eine Technik. Gold wird beim Start bezahlt. Die Waren holen Tagelöhner aus dem Lager und tragen sie durch die Tür in den Bergfried (derselbe Versorgungsauftrag wie für Baustellen, mit `rk` = Technik). Die Zeit läuft erst, wenn alles angekommen ist. Im Schnittbild steht dann der Gelehrte am Pult. Wird abgebrochen, gehen Gold und schon angelieferte Waren zurück.
- **Regeln an einer Stelle.** Die lesenden Prüfungen (`techStatus`, `techMissing`, `upgradeMissing`, `lockedBy` in `src/sim/research.ts`) arbeiten nur auf `SimState`. Simulation und Oberfläche nutzen dieselben Funktionen.
- **Angreifer-KI:** Erst Wirtschaft, Wohnen und Kaserne, dann der Bergfried, Befestigungen zuletzt. So bleibt die Mauerverteidigung der Kern, und die Niederlage kommt nicht schon in der ersten Welle.
- **Grafik:** `bergfried_holz`, `bergfried_stein`, `bergfried_burg` und die Schnittbilder `bergfried_*_innen` kommen aus der Blender-Pipeline (`tools/blender/buildings.py`). Stufe 2 und 3 haben ein Vorderteil (`_front`) für die Brüstung vor den Posten. Die Technik-Ikonen stammen von Codex (`art/prompts/forschung_ikonen.txt`, `assets/ui/forschung.png`).

## Folgen
- `TUNING.baseHousing` ist 0, der Grundwohnraum kommt vom Bergfried (10). Der Start ist damit gleich, wächst aber mit dem Ausbau.
- Im Prototyp ist noch kein vorhandenes Gebäude und keine vorhandene Einheit hinter Forschung gesperrt, damit der Start nicht schwerer wird. Die Sperre selbst (`tech` an Gebäude oder Einheit, Anzeige „Forschung: …“ in Bauleiste, Einheitenraster und Panel) ist eingebaut und getestet. Die gesperrten Konzept-Einheiten im Raster (`src/ui/roster.ts`) sind noch keine Daten.
- Der Ausbau verbraucht viel Stein (Stufe 2: 30, Stufe 3: 50). Ohne Steinbruch reicht der Startbestand nicht für Steinbaukunst, Ausbau und Kaserne zusammen. Das ist gewollt, denn Wirtschaft soll den Ausbau tragen.
- Solange das Schnittbild des Bergfrieds offen ist (Überfahren oder Auswahl), sind die Schützen auf der Plattform ausgeblendet, weil das Schnittbild nur das Erdgeschoss zeigt.
- Hinauf auf die Plattform geht es durch die Tür. Eine sichtbare Treppe außen gibt es nicht, im Schnittbild steht sie innen an der Wand.
