# 0017 – Belagerung und Befestigung: Leitern, Rammbock, Breschen, Schaden, Reparatur, Heilung, Palisade und Graben

**Status:** angenommen (17.11.2026).

## Kontext
Bis hier hatten Überfälle nur ein Werkzeug: Sie reißen ein, was im Weg steht (Durchbruchmodus der Wegfindung). Mauern hielten so lange, bis ihre Lebenspunkte aufgebraucht waren, dann verschwanden sie spurlos. Das Briefing verlangt mehr (§4.2, §4.3, §7):
- Belagerungsabwehr, Gräben und Palisaden.
- Mauern, die militärisch genutzt und auch angegriffen werden.
- Verteidiger, die Wehrgänge halten.

Keine Kernmechanik darf dabei bloß kosmetisch sein (§13). Eine Leiter muss also wirklich einen Weg auf den Wehrgang öffnen. Eine Bresche muss wirklich begehbar sein. Eine Reparatur muss wirklich Material kosten und von einer Figur ausgeführt werden.

## Optionen
1. **Belagerung als Zahlenwerte** (Schadensbonus gegen Mauern, Mauer „erklettert“ nach Zeit): wenig Code, aber unsichtbar und ohne Gegenspiel.
2. **Belagerung als Teil der Wegfindung**: Leitern sind Verbindungen im Laufgraphen, Trümmer und Gräben sind Bodenarten mit Kosten, Fahrzeuge laufen in einem eigenen Bodenmodus. Alles Weitere (Umstoßen, Zuschütten, Reparieren) verändert diesen Graphen.
3. **Eigene Belagerungsphase mit Skript** (feste Abfolge Ramme → Leitern → Sturm): gut inszeniert, aber unabhängig von der Burg, die der Spieler gebaut hat.

## Entscheidung
Option 2. Alle Werte stehen in `src/data/belagerung.ts`, die Regeln in `src/sim/belagerung.ts`. Die Einhängepunkte sind:
- `nav.ts`: Leiterverbindungen, Graben, Trümmer.
- `move.ts`: Bodenmodus, Klettertempo.
- `raid.ts`: Wellen, Graben zuschütten, Leiter bevorzugen.
- `build.ts`: Trümmer, Leitern fallen mit der Mauer, Linienbau für jede Ziehware.
- `combat.ts`: Treffer merken, Wucht, Gräben unverwundbar.
- `economy.ts`/`jobs.ts`: Reparaturaufträge.
- `game.ts`: Tick, Befehl `reparatur`.

**Sturmleitern** (`SimState.ladders`, `Ladder {x, y, wx, wy, o, state, t, push}`)
- Ein Sturmknecht mit `gear: "leiter"` sucht einmal je Sekunde eine Stelle (`chooseLadderSpot`). Das ist ein freier Bodentile, der an einen Wehrgang grenzt und in seiner eigenen Wegkomponente liegt. Unbesetzte Abschnitte werden bevorzugt (Abstand + 10 je Verteidiger oben).
- Dort richtet er die Leiter in `ladderPlaceSeconds` auf, und sie wird zu einer Verbindung `foeLinks` (Fuß ↔ Wehrgang) **nur für Team 1**. Klettern kostet `ladderCost` und läuft mit `climbFactor` Tempo; die Höhe steigt dabei sichtbar (z zwischen den Knoten).
- Ausrichtung `o` = Richtung vom Fuß zur Mauer (`ladderDir(o) = modelToWorld(0, 1, o)`). Das Sprite nimmt Ansicht `(o − r) mod 4` wie jedes Gebäude.
- Steht eine Leiter, nehmen Angreifer den Weg über sie und eine Treppe innen, statt einzureißen (`viaLadder`, nur wenn diese Wegkomponente das Ziel erreicht). Ohne Leiter bleibt alles wie vorher; Welle 1 ist unverändert.
- **Umstoßen:**
  - Verteidiger auf dem Wehrgang im Umkreis `ladderPushReach` des Leiterkopfs schieben mit `min(2, n) / ladderPushSeconds` je Sekunde.
  - Steht ein Angreifer oben am Kopf (`ladderHeadGuard`), geht es nicht.
  - Nahkämpfer auf einem Posten laufen zu Leitern in ihrem Abschnitt (`ladderDuty`), Schützen stoßen um, wenn sie danebenstehen.
  - Die Leiter kippt (`faellt`, 1 s), liegt (`liegt`, 8 s) und verschwindet dann.
  - Wer auf ihr war, stürzt an den Fuß und nimmt `ladderFallDamage`.
  - Alle Wege von Team 1 werden neu geplant (die Bewegung prüft Knoten, nicht Kanten).
- Fällt das Mauerstück, fällt auch die Leiter (`laddersLoseWall`).
- Lebt kein Angreifer mehr, kippen die übrigen Leitern ebenfalls und verschwinden (sonst blieben sie nach einem abgewehrten Überfall für immer stehen).

**Rammbock** (Einheit mit `vehicle: {crew: 3}`, Schadensart `wucht`)
- Er fährt im Bodenmodus (`ground`): keine Treppen, keine Leitern, keine Gräben, auch nicht im Durchbruchmodus.
- Er bewegt sich nur, solange ein Mann seiner Mannschaft (`ai.ram`) in `ramCrewReach` ist. Die Mannschaft hält Plätze hinter ihm und kämpft nur gegen Feinde direkt daneben.
- Ziele, in dieser Reihenfolge: Tore, dann Befestigungen, dann alles andere.
- Ist die ganze Mannschaft tot, ist er aufgegeben (wird entfernt, Meldung), damit die Welle enden kann.
- Gezeichnet wird er aus dem Gebäudeblatt (`rammbock`: Ruhe, ausgeholt, Stoß, Wrack), in vier Ausrichtungen nach der Fahrtrichtung.

**Breschen** (`SimState.rubble`, `Rubble {x, y, sprite, v, o}`)
- Wird eine fertige Befestigung zerstört (`zerstoert`), bleibt je Grundrisstile ein Trümmertile (`RUINS`: Stein, Holz, zugeschütteter Graben).
- Trümmer sind begehbar (Wegkosten `rubbleCost`), die Bresche ist ein offener Weg für beide Seiten.
- Neubau an der Stelle räumt sie (`clearRubble`).

**Schadensstufen**
- `damageStage(b)`: 0 bis 3 nach `DAMAGE_STAGES` (75 / 50 / 25 % der Lebenspunkte).
- Mauerstücke, Tor (offen und zu), Turm und Treppe haben eigene Blätter `<sprite>_schaden` mit drei Stufen. Sie haben dieselbe Geometrie wie das heile Stück: ausgeschlagene Steine, fehlende Zinnen, Risse, Ruß, Schutt am Fuß.
- Die Palisade hat die Stufen als Varianten ihrer Stücke.
- Alle anderen Bauten bekommen eine Überlagerung `schaden_<b>x<t>`: Schutt, Bretter, Ziegelscherben und Brandflecken an den Kanten zur Kamera, je Ansicht gebaut, damit sie das Gebäude nie von hinten überdeckt.
- Ab Stufe 2 steigt Rauch auf (dieselben Rauchwölkchen wie aus Schornsteinen, prozedural).

**Reparatur**
- Der Disponent vergibt höchstens `REPAIR.crews` Aufträge `repair` an Tagelöhner. Voraussetzungen:
  - Der Bau ist eigen, fertig und beschädigt.
  - Die Automatik ist nicht abgeschaltet (`Building.repairOff`, Befehl `reparatur`, Knopf im Seitenpanel).
  - Es ist ruhig: `calmSeconds` kein Treffer, kein Angreifer im Umkreis `enemyRadius`.
  - Es fehlt mindestens ein halbes Stück.
- Der Tagelöhner holt ein Stück der Hauptware der Baukosten aus dem Lager (`repairPlan`: die häufigste Ware; bei Ausbaustufen die Kosten der Stufe). Er trägt es hin und hämmert `REPAIR.seconds` (mal Arbeitsfaktor).
- Das stellt `maxHp / Stückzahl` Lebenspunkte her. Fehlt die Ware, kommt eine Meldung.

**Heilung**
- Einmal je Sekunde heilen eigene Verwundete, die nicht kämpfen und seit `HEAL.calmSeconds` keinen Treffer erlitten haben (`ai.hurtT`).
- Sie heilen `restPerSecond`, im Umkreis `nearRadius` um Bergfried oder Kaserne `nearPerSecond`.
- Tätigkeit „Erholt sich“.

**Palisade und Graben** (`BuildingDef.pieces`, `flat`, `ditch`)
- Beide werden wie die Mauer als Linie gezogen (Befehl `mauer` mit `key`; Werkzeug `{t: "mauer", key}`). Sie verbinden sich per Autotiling (`<prefix>_gerade|ende|ecke|t|kreuz|einzel`); die Palisade schließt auch an Mauer, Tor und Turm an.
- **Palisade:** Holz, 220 Lebenspunkte. Sperrt wie eine Mauer, trägt aber keinen Wehrgang.
- **Graben:** kostet nur Arbeit (Tagelöhner heben ihn aus). Bodenwert `DITCH`:
  - Eigene Leute waten mit `ownCost` hindurch.
  - Angreifer kommen nur im Durchbruchmodus hindurch: Sie schütten ihn Stück für Stück zu (`fillDitch`, `ditchFillPerStrike`). Daraus wird `graben_verfuellt`.
  - Fahrzeuge (Rammbock) kommen nie hindurch.
  - Ein Graben nimmt keinen Kampfschaden.

**Wellen** (`RAID_SIEGE`)
- Ab Welle 2 ersetzen zwei Sturmknechte mit Leiter Krieger der Welle.
- Ab Welle 3 kommt ein Rammbock mit drei Mann dazu.
- Die Zahl der Männer bleibt gleich (der Rammbock zählt nicht).
- Welle 1 bleibt genau wie vorher, also mit 3 stationierten Soldaten zu halten (Tests r22/r23 unverändert grün).

## Folgen
- Neue Zustandsfelder, alle serialisierbar und im Speichertest geprüft:
  - Am Zustand: `ladders`, `rubble`.
  - Am Gebäude: `repairOff`, `ai.repairer`, `ai.hitT`.
  - An der Einheit: `gear`, `ai.hurtT`, `ai.ladder`, `ai.ram`, `ai.skipB`.
- Der Routen-Cache unterscheidet den Bodenmodus (`g`), `TravelGoal.ground` ebenso.
- Grafik über die Blender-Pipeline (Seeds 800–833). Neue Sprites:
  - Palisaden- und Grabenstücke, Baustelle Graben, Trümmer.
  - Leiter, Rammbock.
  - Schadensblätter und Schadensüberlagerungen.
  - Figuren `sturmknecht` und `leitertraeger`.
- Die Schadensblätter nehmen den Seed des heilen Stücks für die Geometrie (sonst würden die Steine beim Stufenwechsel springen); ihr eigener Seed steht im Eintrag. Schadensentscheidungen kommen aus einem Hash der Koordinaten, nicht aus dem Zufallsstrom.
- `sheet.json` (Gebäude und Figuren) wurde nur verlängert, bestehende Bilder sind unverändert.

## Grenzen
- Torhaus und Zugbrücke fehlen.
- Leitern gibt es nur an Mauerstücken mit Wehrgang 1 (nicht an Türmen).
- Angreifer auf dem Wehrgang ohne Treppe innen kämpfen oben, kommen aber nicht hinunter.
- Wohn- und Wirtschaftsbauten zeigen Schaden nur als Schutt und Brandflecken davor und Rauch, nicht als Löcher in ihren Wänden.
- Der Rammbock fährt über Trümmer, aber nicht durch Gräben. Ist das Tor nur über einen Graben zu erreichen, greift er die nächste Befestigung an, die er erreicht, oder bleibt stehen.
