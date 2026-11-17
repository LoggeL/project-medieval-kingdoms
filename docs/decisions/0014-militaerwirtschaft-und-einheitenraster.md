# 0014 – Militärwirtschaft, Rüstungsklassen und Einheitenraster aus Daten

**Status:** angenommen (17.11.2026). Baut auf ADR 0011 (Rezepte, Lagertypen) und ADR 0006 (Forschung) auf.

## Kontext
Bis hier kamen Waffen nur aus dem Startlager: Speer, Schwert und Bogen lagen dort, die Kaserne bildete drei Soldaten aus, Eisen hatte keine Quelle. Das Briefing verlangt die Kette Eisenmine → Lager → Schmelzhütte → Lager → Waffenschmiede → Lager (§5.5). Dazu kommen viele Einheiten unterschiedlicher Qualität und Ausrüstung, die einzeln über Forschung freigeschaltet werden (§6.1–6.4). Pikeniere sollen gegen Reiter stark sein und Armbrustschützen gegen schwere Rüstung (§7). Das Einheitenraster soll alle Einheiten zeigen, gesperrte ausgegraut und mit ihren Voraussetzungen (§8.3). Kernmechanik ist nach Briefing physisch: Erz wird sichtbar abgebaut und getragen, Waffen und Rüstungen liegen als eigene Waren im Lager.

## Optionen
1. **Neue Einheiten als Sonderfälle in Kaserne und Raster**: schnell, aber jede Einheit bräuchte Code in Simulation und Oberfläche.
2. **Alles aus Daten** über das Rezeptsystem (ADR 0011), dazu `UnitDef` mit Rüstungsklasse, Gruppe, Ausrüstungsliste und Sperren. Das Raster liest nur `UNITS`.
3. **Ausrüstung als Zahlenwert am Soldaten** (Waffenstufe statt Ware): weniger Waren, aber dann läge nichts sichtbar im Lager, und niemand würde etwas tragen.

## Entscheidung
Option 2.

**Rohstoff Erz:**
- `Rock.kind = "erz"` markiert Erzbrocken. `ResourceTag` (`tree`, `rock`, `erz`) mit `RESOURCE_TAGS` (Meldungen, Sprite `fels_erz`) ersetzt die festen Tags in `CycleStep.reserveNearest` und `placement.nearTag`.
- Der Steinbruch nimmt nur `rock`, die Erzmine nur `erz` (`rockTag`).
- Der Kartengenerator legt auf der Standardkarte drei bis fünf Erzbrocken (je 18–28 Erz) an den Südwestrand des Felsfelds, zur Siedlung hin und höchstens drei Felder vom Bauland. Ein eigener Zufall aus dem Rauschen hält die übrige Kartenfolge unverändert.

**Gebäude** (`src/data/ruestung.ts`, Reiter „Handwerk“, F7):

| Gebäude | Arbeiter | Was geschieht | Sperre |
|---|---|---|---|
| Erzmine | 2 Bergleute | Wie der Steinbruch: hacken Erz am Brocken (`abbauen`), tragen es auf den Hof. Tagelöhner bringen es ins Lagerhaus. | – |
| Schmelzhütte | Schmelzer | Erz 2 + Holz 1 → Eisen. Glut im Ofen und am Schlot, solange gearbeitet wird (`workAnim.idle`: ruhend der kalte Ofen). | Rennofen |
| Waffenschmiede | Schmied | Eisen → Schwert. Nach Gewalthaufen: Eisen 1 + Holz 2 → 2 Piken. | – |
| Bognerei | Bogner | Holz 2 → Bogen, Holz 1 → Speer. Nach Armbrustbau: Holz 2 + Eisen 1 → Armbrust. | – |
| Rüstungsschmiede | Schmied | Eisen 2 → Rüstung. | Kettenschmiede |

- Alle Rezepte laufen über ADR 0011, die Werkstätten teilen ein `production`-Layout.
- Neue Waren im Materiallager: Erz, Pike, Armbrust, Rüstung, jeweils mit Stapel-Sprite und Trägerfigur.
- Teilen sich mehrere Werkstätten eine knappe Ware (Eisen), wechselt der Disponent den Anfang der Werkstattliste jede Sekunde (`economy.ts`). Sonst bekäme die zuerst gebaute jedes Stück.

**Forschung:** vier Techniken auf einem eigenen Ikonenblatt (`TechDef.iconSheet = "forschung_ruestung"`):
- Rennofen
- Kettenschmiede (braucht Rennofen und eine Waffenschmiede)
- Armbrustbau (braucht Rennofen und eine Bognerei)
- Gewalthaufen (braucht Kettenschmiede und eine Kaserne)

Zusammen kosten sie 95 Gold. Gesperrte Rezepte stehen im Panel ausgegraut und nennen die Technik. `unlocksOf` listet Rezepte mit Gebäude.

**Einheiten** (`src/data/militaer.ts`):
- Alle 24 Konzepteinheiten (Fußvolk, Schützen, Reiterei, Tross) sind `UnitDef` mit Werten, Rüstungsklasse, Schadensart, Kosten und Beschreibung. Belagerungsgerät ist ein eigener Zweig.
- Spielbar ist eine Einheit, wenn ein Gebäude sie in `trains` führt und `planned` leer ist.
- Neu spielbar in der Kaserne, jeweils mit eigener Blender-Figur:
  - **Waffenknecht**: Speer, 4 Gold
  - **Pikenier**: Pike und Rüstung, Gewalthaufen
  - **Armbrustschütze**: Armbrust, Armbrustbau
- Die übrigen nennen in `planned`, was es noch nicht gibt: Reitstall, Pferde, Pulver, Söldnerlager, Moral und Formationen.
- `UnitDef.train` hat `equipment` und `extra` (weitere Stücke). `equipmentOf` und `trainCost` liefern die Liste der Stücke und die Kosten.
- Der Rekrut holt die Stücke nacheinander aus dem Lager (Auftrag `recruit` mit `more`/`n`). Sichtbar trägt er das erste Stück.
- Bei Abbruch oder Abriss gehen alle schon geholten Stücke zurück ins Lager.

**Schaden** (Konzept 05):
- Grundschaden × `hitFactor`, dann wie bisher abzüglich Rüstungspunkte × `DAMAGE_TYPES[art].armor`.
- `hitFactor` = Konter-Bonus × `ARMOR_MATRIX[Schadensart][Rüstungsklasse]`.
- Gegen berittene Ziele ersetzt `bonus.reiter` den Rollenbonus.
- Neue Schadensarten: Wucht, Bolzen, Kugel.
- Einheiten ohne Rüstungsklasse (Arbeiter, die alten drei Soldaten) rechnen mit Faktor 1. Für sie ändert sich nichts.

**Oberfläche:**
- `roster.ts` baut das Raster nur aus `UNITS` und `UNIT_GROUPS` (Test: keine Einheit beim Namen im Quelltext).
- Die Detailkarte zeigt für alle Einheiten Werte, Rüstungsklasse und „Stark gegen“. Spielbare zeigen ihre Ausrüstung, gesperrte ihre Voraussetzungen.
- Die Kaserne hat sechs Ausbildungsknöpfe (Tasten U I O J K L).

## Folgen
- Neue Einheiten, Rezepte oder Werkstätten brauchen nur Daten und Grafik. Für eine bisher geplante Einheit genügt der Eintrag in `trains`, sobald ihre `planned`-Liste leer ist.
- Erz ist endlich wie Stein. Eine Erzmine erreicht im Umkreis von 9 Feldern meist drei der Brocken, für den Rest braucht es eine zweite Mine.
- Das Startlager hat acht Fächer, und die neuen Waren brauchen Platz: Wer Militärwirtschaft betreibt, baut ein zweites Lagerhaus. Das ist gewollt (Briefing §5.4), die Meldung „Lager voll“ nennt es.
- Grenzen:
  - Die alten Einheiten Speerträger, Schwertkämpfer und Bogenschütze haben keine Rüstungsklasse.
  - Reiterei, Pulverwaffen, Söldner und Tross sind nur Daten.
  - Formationen fehlen.
  - Von den Ausrüstungsstücken trägt der Rekrut nur das erste sichtbar.
