# 0016 – Lebendige Welt: Tiere, nachwachsender Wald, Ruhebilder, Fahnen, Tageslicht

**Status:** angenommen (17.11.2026).

## Kontext
Das Briefing verlangt eine Welt, die nie statisch wirkt (§2.1, §10): grasende Tiere, Wild, Vögel, Fahnen im Wind, Wachen auf den Mauern, Arbeiter, die auch in Pausen etwas tun, Gefallene, die nicht einfach verschwinden. Bisher bewegten sich nur Figuren mit einem Auftrag. Untätige Tagelöhner standen still, der Wald wuchs nach dem Fällen nicht nach, und Fahnen und Bäume waren Standbilder.

Dabei gilt weiter: Keine Kernmechanik nur kosmetisch, Simulation ohne Renderer, deterministisch und speicherbar, Drehung als echte Logik. Sieben Zweige arbeiten parallel. Der Zweig „nahrung“ baut eigene Wildpunkte für ein Jägerhaus. Bestehende Spielstände, Tests und Bilder dürfen sich nicht verschieben.

## Optionen
1. **Alles nur in der Darstellung** (Tiere als Partikel, Wiegen als Shader, Tageslicht als Filter): billig, aber Tiere wären nicht jagdbar, nicht speicherbar und in jeder Drehung anders.
2. **Tiere als Einheiten** (`SimState.units`, Team „Natur“): Kampf, Raum-Raster und Wegnetz kennen sie sofort. Aber jede Zählung von Einheiten (Bevölkerung, Wellen, Zielwahl, Lasttests) müsste sie ausnehmen, und jedes Tier würde die IDs und den Zufall der übrigen Simulation verschieben.
3. **Eigene Simulationsobjekte mit eigenem Zufallsstrom und ID-Bereich**: Tiere als `SimState.animals`, nachwachsende Bäume im vorhandenen `trees`. Die Darstellung bekommt reine Bildwahl-Funktionen.

## Entscheidung
Option 3.

**Daten** (`src/data/leben.ts`, in `index.ts` mit einer Zeile eingehängt):
- `ANIMALS`: Art, Figur, Verhalten (`herde`, `wild`, `vogel`), Gelände, Gehen/Rennen, Scheu-Abstand, Streifgebiet, Gruppengröße und -zahl, Pausen, Bilder pro Sekunde. Wild hat `game {meat, hp}`.
- `LIFE`: Nachzucht, Flucht, Flughöhe, Kadaver, Wald (Stumpf → Setzling, drei Wachstumsstufen, Säen), Ruhebilder, Wache, Rennen, Treffer, Ausblenden der Gefallenen.
- `FLAGS` (Gebäudebild → Bild mit wehenden Bannern), `TREE_ART`, `LIFE_FIGURES` (Figur → Lebensblatt), `DAYLIGHT`.
- `AnimKey` kennt zusätzlich `sitzen` und `plaudern`.

**Simulation:**
- `src/sim/animals.ts`: Tiere ziehen geradlinig über begehbares Gelände ohne Gebäude (kein A*, kurze Wege im Streifgebiet; bei einem Hindernis wird ein neues Ziel gewählt).
  - Weidetiere wechseln zwischen Grasen und Weiterziehen.
  - Wild sieht sich gestaffelt alle 5 Ticks im Raum-Raster um und rennt vor jeder Figur weg (beide Teams). Wo es zur Ruhe kommt, ist sein neues Streifgebiet.
  - Krähen fliegen mit dem Schwarm auf, steigen, fliegen 8–16 Felder weit und landen auf passendem Gelände.
  - Fehlt eine Art (erlegt), kommt alle 90 s eine Gruppe nach, höchstens bis zum Startbestand.
- `src/sim/forest.ts`: Ein Stumpf treibt nach 60 s aus (Zustand `waechst`, `Tree.stage` 0–2) und ist nach 45 + 60 + 75 s wieder ein fällbarer Baum. Darunter darf kein Gebäude oder Fels liegen.
  - Solange weniger Bäume stehen oder wachsen als beim Start (`meta.life.trees0`), sät alle 30 s ein zufälliger Baum einen Setzling bis 2 Felder weit auf Waldboden oder Gras.
  - Wachsende Bäume sperren das Bauen nicht, die Baustelle räumt sie wie Stümpfe (`build.ts`).
  - Der Wald rechnet nur jeden 10. Tick.
- **Eigener Zufallsstrom und ID-Bereich:** `meta.life = {rng, nextId ab 1 000 000, trees0, want, respawn}`.
  - Tiere und nachwachsende Bäume ziehen weder aus `meta.rng` noch aus `meta.nextId`. Alle bisherigen Abläufe (Karten, IDs, Kämpfe) bleiben Tick für Tick gleich. Das prüfen die bestehenden Determinismus- und Balancetests.
- **Ruhe und Wache:**
  - Untätige Tagelöhner wechseln alle 7 s zwischen Stehen, Sitzen und Plaudern (`idlePose`, rein aus Tick und ID). Geplaudert wird nur, wenn ein anderer untätiger Tagelöhner höchstens 1,7 Felder entfernt steht; dann drehen sie sich zueinander.
  - Wachen auf dem Posten drehen sich alle 4 s ein Stück und treten 0,5 s auf der Stelle (`guardIdle`). Sie verlassen den Posten nicht, weil die Posten pixelgenau gelten (`military.test.ts`). Ihre Anzeige bleibt „wache“.
- **Treffer und Rennen:**
  - `Unit.hitT` ist der Tick des letzten Treffers.
  - `Unit.run` ist gesetzt, solange ein Tagelöhner flieht. `LIFE.run.factor` (Tempo beim Rennen) steht auf 1: Schon 1,2 lässt die Angreifer in `bergfried.test.ts` den Bergfried früher erreichen. Das Rennen ist deshalb vorerst nur ein Bild.
- **Speichern:** Alles steckt in `state` (`animals`, `Tree.stage/age`, `Unit.hitT/run`, `ai.step`) und `meta.life`. Ohne `meta.life` (alte Stände, leeres Szenario ohne Tiere) bleibt die lebendige Welt aus, die Speicherversion ändert sich nicht.

**Darstellung** (`src/render/life.ts`, reine Funktionen; Einbau in `scene.ts` und `index.ts`):
- Stehende Bäume wiegen im Wind: `baum_wind`/`tanne_wind`, Variante = Baum · 4 + Phase, mit eigenem Takt je Baum. Die Verdeckungsprüfung (Silhouetten) nimmt weiter das stille Bild.
- Wachsende Bäume zeigen `baum_jung`/`tanne_jung` (Stufe = Variante).
- Fertige Gebäude mit Fahnenbild zeigen dieses in 6 Bildern (Kaserne, Mauerturm, alle Bergfried-Stufen).
- Sitzen, Plaudern, Rennen (ohne Last) und Zusammenzucken (0,25 s nach `hitT`) kommen aus dem Lebensblatt der Figur.
- Gefallene blenden in den letzten 3 s vor dem Wegräumen aus.
- Tiere werden wie Figuren sortiert und gedreht (`figureDir`). Fliegende Krähen werfen einen flachen Schatten am Boden: dasselbe Bild, schwarz und flachgedrückt.
- Das Tageslicht färbt Gelände und Objekte über einen Spieltag von 8 Minuten (`daylightTint`, aus dem Tick: die Pause hält die Uhrzeit an, in jeder Drehung gleich). Die Nacht bleibt hell genug zum Spielen.

**Grafik:** Alle Bilder kommen aus der Blender-Pipeline als neue Blatteinträge, Seeds 700–799.
- Neue Blatteinträge: `tageloehner_leben`, `speer_leben`, `schwert_leben`, `bogen_leben`, die Tiere, die Windbäume, die Setzlinge und die Fahnenbilder.
- Alte Bilder bleiben Byte für Byte gleich, das wurde für Figuren und Gebäude geprüft.
- Siehe `tools/blender/README.md`, Abschnitt „Lebendige Welt“, und `tools/blender/build_leben.sh`.

### Jagd: Schnittstelle und Zusammenführung mit dem Zweig „nahrung“
`animals.ts` bietet:
- `findGame(w, x, y, r, filter?)`: nächstes lebendes, nicht reserviertes Wild.
- `reserveGame` / `releaseGame`.
- `damageAnimal(w, id, dmg)`: angeschossenes Wild flieht, bei 0 LP ist es erlegt.
- `killAnimal`: das Tier stirbt sichtbar und bleibt mit `meat` liegen.
- `takeMeat(w, id, n)`: Fleisch nehmen; ist es leer, verschwindet das Tier.
- Unberührte Kadaver verschwinden nach 120 s.

Für die Zusammenführung mit den Wildpunkten aus „nahrung“:
1. **Ziel des Jägerhauses:** Das Jägerhaus soll keine eigenen Wildpunkte mehr anlegen, sondern über `findGame` die Tiere im Umkreis seines Gebäudes suchen (`placement.nearTag` sinngemäß: „Wild in Reichweite“).
2. **Ablauf im Arbeitszyklus:** `reserveGame` beim Zielwählen, Annähern bis Schussweite, `damageAnimal` je Schuss (Wild flieht, der Jäger folgt), dann zum Kadaver gehen, `takeMeat`, Fleisch zum Hofstapel tragen. `releaseJob` muss `releaseGame` aufrufen.
3. **Wenn „nahrung“ zuerst landet:** Seine Wildpunkte werden zu Spawn-Gebieten. Ein Wildpunkt legt per `spawnGroup` eine Gruppe in seiner Nähe an (dafür bekommt `spawnGroup` optional einen Mittelpunkt). Das Jägerhaus stellt auf `findGame` um, die Wildpunkte als eigene Beute fallen weg.
4. **Bestand und Fleisch:** Die Nachzucht hält den Bestand je Art (`meta.life.want`). Soll Wild knapp werden können, wird `want` gesenkt oder `respawnSeconds` erhöht, beides Daten. Die Fleischmenge je Tier (`ANIMALS.*.game.meat`) ersetzt die Menge je Wildpunkt.

## Folgen
- Die Welt bewegt sich auch ohne Aufträge: rund 33 Tiere auf der Startkarte, wiegende Bäume, wehende Banner, ruhende Tagelöhner, Wachen, die sich umsehen, Tageslicht.
- Der Wald verschwindet nicht mehr, wächst aber nie über seinen Startbestand hinaus.
- Kosten: Tiere und Wald zusammen rund 3 µs je Tick (Messung in `tests/sim/leben.test.ts`). Je Tier und Baum gibt es ein Objekt mehr in der Tiefensortierung.
- Tiere sind (noch) nicht anklickbar und haben keine Silhouette hinter Bäumen. Wild im dichten Wald ist darum oft verdeckt.
- Offen:
  - Jägerhaus (Zweig „nahrung“).
  - `geben` (Übergabebild) ist gerendert, aber noch nicht eingesetzt.
  - Wachen gehen nicht auf dem Wehrgang auf und ab.
  - Jahreszeiten (bewusst weggelassen: Laub-, Schnee- und Feldbilder für alle Blätter wären ein eigener Arbeitsgang).
  - Rennen ohne Tempogewinn (siehe oben).
