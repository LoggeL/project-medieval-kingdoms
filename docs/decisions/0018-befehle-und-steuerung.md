# 0018 – Befehle und Steuerung: Formation, Angriffsmarsch, Patrouille, Rückzug, Haltung, Kontrollgruppen

**Status:** angenommen (17.11.2026). Grundlage der Truppenführung nach Briefing §7. Kampfwerte, Belagerung und weitere Einheiten bauen darauf auf.

## Kontext
Bis hier kannten Soldaten fünf Befehle: Bewegen (Rechtsklick, Spirale um den Zielpunkt), Angreifen, Halten (H), Stationieren (T) und Untätig. Untätig griffen sie alles in Sichtweite an. Das Briefing (§7) verlangt außerdem:
- Gruppen
- Patrouille
- Formation
- Rückzug
- Halteposition

Das Gelände soll dabei taktisch zählen.

Es gelten drei Anforderungen:
- Die Befehle müssen in der Simulation laufen, deterministisch sein und sich speichern lassen; Darstellung und Eingabe zeigen sie nur.
- Die 90°-Drehung muss überall stimmen: Ziehen, Vorschau, Blickrichtung.
- Die Tasten müssen auf einer deutschen Tastatur zu WASD (Kamera), Q/E (Drehen), T/H und den Baukarten passen.

## Optionen
1. **Befehle nur in der Eingabe** (die UI zerlegt Patrouille und Angriffsmarsch in viele Bewegen-Befehle): wenig Simulationscode, aber nicht speicherbar, nicht testbar ohne Renderer und abhängig von der Bildrate.
2. **Eigene Auftragsarten an der Einheit, Formation als reine Funktion der Simulation, Haltung als Daten**: Die Simulation plant die Plätze, die Eingabe ruft dieselbe Planung nur für die Vorschau auf.
3. **Gruppenobjekt mit Anführer** (Trupp als eigene Einheit im Zustand): echte Marschformation, aber viel neuer Zustand, Sonderfälle bei Tod und Teilauswahl und schwer mit Mauerposten und Stationierung zu verbinden.

## Entscheidung
Option 2.

**Daten** (`src/data/befehle.ts`):
- `FORMATIONS`: `linie`, `block` (voreingestellt) und `locker`, je mit Abstand, Seitenverhältnis und Ikone.
- `STANCES`: `aggressiv` (voreingestellt), `defensiv` und `stellung`.
  - `engage`: Angriffsradius.
  - `leash`: Verfolgungsgrenze.
  - `anchored`: misst vom Standplatz statt vom Soldaten.
  - Aggressiv entspricht genau dem bisherigen Verhalten (Sicht 8, Verfolgen bis 12).
- `COMMANDS`: Namen, Beschreibungen und Ikonen der Befehle.
- `COMMAND_TUNING`: Rückzugstempo ×1,4, Angriffsradius und Verfolgungsgrenze unterwegs, höchstens 8 Wegmarken, Suchradius für Formationsplätze.
- Tasten in `src/data/hotkeys.ts` (`BUTTON_KEYS`). A bleibt Kamera, deshalb liegt der Angriffsmarsch auf K:

  | Taste | Befehl |
  |---|---|
  | K | Angriffsmarsch |
  | J | Patrouille |
  | Z (physisch `KeyY`) | Rückzug |
  | L | Formation weiter |
  | Ö (`Semicolon`) | Haltung weiter |
  | H | Stellung halten (wie bisher) |
  | Strg + 1–9 / 1–9 | Kontrollgruppen |

**Simulation** (`src/sim/befehle.ts`, Auftragsarten in `UnitOrder`):
- *Formation:* `placeGroup` legt für die Gruppe Wunschpunkte um das Ziel.
  - Reihen stehen quer zur Blickrichtung, Nahkämpfer vorn, Schützen in eigenen Reihen dahinter.
  - Innerhalb einer Reihe wird nach Seitenlage geordnet, damit sich keine Wege kreuzen.
  - Jeder Wunschpunkt wird zum nächsten freien, begehbaren Tile derselben Zusammenhangskomponente (Spirale, sonst `nearestInComp`). So fließt die Formation um Häuser, Mauern und Wasser.
  - Die Blickrichtung kommt aus dem Rechtsziehen (`fx`/`fy` am Befehl), sonst aus der Richtung vom Schwerpunkt der Gruppe zum Ziel.
  - Die Gruppe läuft im Tempo des Langsamsten (`pace`); am Ziel blicken alle in die befohlene Richtung.
  - Auf Wehrgängen gibt es keine Formation (dort verteilt die Stationierung).
  - `Game.planFormation` liefert dieselben Plätze der Eingabe für die Vorschau.
- *Angriffsmarsch* (`amove`): Die Einheit läuft wie beim Bewegen in Formation.
  - Unterwegs greift sie Gegner im Umkreis an: Nahkämpfer nur erreichbare, Schützen das gefährlichste Ziel.
  - Sie verfolgt höchstens `marchLeash` Felder von dem Punkt, an dem der Kampf begann (`ai.anchor`), und marschiert danach weiter.
- *Patrouille* (`patrol`): Die Route ist der Standort der Gruppe plus bis zu 8 Wegmarken, im Kreis.
  - Jede Einheit hat ihre eigene Route mit ihrem Formationsversatz. Die Ausrichtung bleibt fest, damit alle Routen gleich lang sind und die Formation hält.
  - Unterwegs gilt dieselbe Kampfregel wie beim Angriffsmarsch.
  - Unerreichbare Marken werden übersprungen; sind alle unerreichbar, endet die Patrouille.
- *Rückzug* (`retreat`): Block-Formation am Eingang des Bergfrieds (sonst am Lagerplatz), 1,4-fach schnell, ohne Ziel und ohne zurückzuschlagen. Die Laufanimation läuft entsprechend schneller.
- *Haltung* (`Unit.stance`): Untätige Soldaten handeln nach `STANCES`.
  - Defensiv merkt sich einen Standplatz (`ai.anchor`), kämpft nur in der Nähe und kehrt dorthin zurück.
  - „Stellung halten“ kämpft nur in Reichweite. Der Befehl H setzt genau diese Haltung, H und der Haltungsknopf sind dasselbe.
- *Formation wechseln* (`formation`): Stehende Gruppen formieren sich um ihren Schwerpunkt mit ihrer mittleren Blickrichtung neu, marschierende um ihr Ziel.
- *Speichern:* Alle neuen Felder (`stance`, `formation`, Auftragsfelder, `ai.anchor`, `ai.pfail`) liegen im JSON-Zustand. `SAVE_VERSION` bleibt 2, weil alle Felder optional sind. Felder werden mit `delete` entfernt, nicht auf `undefined` gesetzt; so bleibt die Schlüsselreihenfolge beim Laden gleich (Test: gleiche Fortsetzung nach Laden).
- *Nebenbefunde, mitbehoben:*
  - `separate()` schiebt eigene stehende Soldaten nicht mehr beiseite, wenn eigene Figuren durchlaufen; sonst zerfiel die Formation am Ziel. Angreifer verhalten sich wie bisher.
  - `evictUnits` lässt Figuren in Ruhe, die gerade eine Turmtür hinaufsteigen (`z > 0.05`).

**Eingabe und Oberfläche:**
- `src/app/groups.ts`: Kontrollgruppen ohne DOM-Abhängigkeit (`installControlGroups(target, host, blocked)`).
  - Strg + Ziffer speichert; ohne Auswahl leert es die Gruppe.
  - Die Ziffer wählt die Gruppe wieder; Gefallene fallen heraus.
  - Zweimal innerhalb von 400 ms: Die Kamera fährt zur Gruppe.
  - Umschalt + Ziffer nimmt die Gruppe zur Auswahl hinzu.
  - Cmd + Ziffer bleibt beim Browser (Reiterwechsel am Mac).
- `src/app/input.ts`:
  - Rechtsziehen mit Soldaten richtet die Formation aus (Vorschau der Plätze und Pfeil).
  - Ein Rechtsklick ohne Ziehen bewegt bzw. greift an wie bisher.
  - Werkzeug `befehl` für K und J: Ein Klick setzt das Ziel bzw. die Wegmarke, mit Umschalt bleibt das Werkzeug für weitere Marken. Ein Klick auf einen Gegner beim Angriffsmarsch greift ihn direkt an.
- `src/ui/befehle.ts`: Befehlsleiste im Auswahlpanel.
  - Vier Befehlsknöpfe.
  - Umschalter für Formation und Haltung mit der gerade gültigen Mehrheitswahl und einem „weiter“-Knopf (L, Ö).
  - Tastenschilder aus `BUTTON_KEYS`.
- `src/render/overlays.ts`:
  - Für die ausgewählten Soldaten zeichnet es Linie und Ring zum Ziel; die Farbe zeigt die Art: grün bewegen, rot Angriffsmarsch, blau Patrouille, hell Rückzug.
  - Patrouillen bekommen eine gestrichelte Route mit Fähnchen an den Wegmarken.
  - Dazu kommen die Vorschau der Formation beim Ziehen und die Route beim Setzen der Wegmarken.
  - Alles wird aus dem Weltzustand gezeichnet und dreht deshalb mit der Ansicht.
- Grafik: zehn Befehlsikonen (`assets/ui/befehle.png`, 10 × 64 px) per Codex (`tools/codex-imagegen.py`, Auftrag `art/prompts/befehle_ikonen.txt`, Rohbild `art/ui-quelle/befehle_ikonen.png`), zugeschnitten mit `tools/ui/befehle_ikonen.py`.

## Folgen
- Eine neue Formation oder Haltung ist ein Dateneintrag plus Ikone; Planung, Panel und Speichern brauchen keine Änderung.
- Formationen geben noch keinen Kampfbonus (z. B. Pikenblock gegen Reiter). Das gehört zu den Kampfwerten (Briefing §7), nicht zur Steuerung.
- Der Sammelpunkt des Rückzugs ist fest der Bergfried bzw. der Lagerplatz; ein frei setzbarer Sammelpunkt fehlt.
- Rennbilder gibt es seit der Zusammenführung mit ADR 0016 nur für Figuren mit Lebensblatt (`LIFE_FIGURES`: Speerträger, Schwertkämpfer, Bogenschütze); alle anderen spielen beim Rückzug „gehen“ schneller ab.
- Strg + Ziffer kann unter Windows und Linux je nach Browser vom Browser selbst belegt sein (Reiterwechsel). Dann greift der Browser zuerst.
- Rechtsziehen mit ausgewählten Soldaten verschiebt nicht mehr die Kamera (das tun weiterhin WASD, Rand und mittlere Maustaste).
- Die Zielmarken sind wie die bestehenden Markierungen prozedural gezeichnet (Linien, Rauten, Fähnchen); sie sind Bedienhilfe, keine Spielgrafik.
- Tests:
  - `tests/sim/befehle.test.ts`: jede Formation in vier Blickrichtungen und um Hindernisse; Angriffsmarsch mit Verfolgungsgrenze; Patrouille mit Kampf und mehreren Marken; Rückzug; Haltungen; Formationswechsel; Speichern und Laden.
  - `tests/app/groups.test.ts`: Kontrollgruppen mit DOM-Attrappe.
  - `tests/data/befehle-tasten.test.ts`: eindeutige Tasten, Schilder, Tastenübersicht, Ikonenspalten.

## Zusammenführung mit den anderen Zweigen der Welle 2
- **Rückzug = Rennen (mit ADR 0016):** Der Zweig „leben“ hat für fliehende Tagelöhner die Markierung `Unit.run` und Rennbilder im Lebensblatt eingeführt, dieser Zweig für den Rückzug ein eigenes Tempo (`orderSpeed`, `animRate`). Beides ist jetzt eine Lösung: `soldierAct` setzt `run` für die Dauer des Rückzugs und nimmt es bei jedem anderen Befehl wieder weg. Die Darstellung zeigt dadurch die vorhandenen Rennbilder; das Tempo bleibt `COMMAND_TUNING.retreatSpeed` (mal `LIFE.run.factor`, derzeit 1). Test: `tests/sim/zusammen-befehle.test.ts`.
- **Tasten (mit ADR 0014):** Der Zweig „rüstung“ hatte der Kaserne für sechs Truppen U I O J K L gegeben, dieser Zweig den Befehlen J K L. Die Befehle der Soldaten behalten J K L (im Kampf häufiger, Reihe neben WASD); die Kaserne bildet jetzt auf U I O Ü Ä # aus (rechter Rand der deutschen Tastatur; im Reiter Militär haben die Truppen zusätzlich ihre Baukarten-Tasten).
- **Hinaufsteigen (mit ADR 0017):** `evictUnits` lässt jede Figur mit Höhe über dem Boden stehen (Treppe, Turmtür, Sturmleiter); die Leiterregel aus „belagerung“ ist darin enthalten.
- **Rennen und Tempo:** `speedOf` verbindet Rückzug und Formationstempo (`orderSpeed`) mit dem Rennfaktor fliehender Tagelöhner.
