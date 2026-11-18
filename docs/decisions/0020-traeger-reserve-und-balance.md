# 0020 – Träger-Reserve, Meldungen bei vollem Hof und Lager, Balance auf „Normal“

**Status:** angenommen (18.11.2026). Befunde der Gesamtprüfung von Welle 2 (Spiel, Simulation, Darstellung, Briefing).

## Kontext
Die Gesamtprüfung hat geskriptete Partien ohne Debug-Hilfen gespielt. Dabei zeigten sich vier Probleme:

- **Träger-Verklemmung.** Jeder Rekrut ist ein Tagelöhner. Wer alle ausbildete, hatte niemanden mehr, der Baustellen belieferte oder Höfe leerte. Soldaten belegen weiter Wohnraum, deshalb zog auch niemand nach. Ein Wohnhaus blieb über 15 Spielminuten bei „Noch nichts angeliefert“, obwohl 36 Holz im Lager lagen. Danach verhungerte die Siedlung, ohne dass eine Meldung den Grund nannte.
- **Irreführende Meldungen.**
  - „Hof ist voll“ kam alle paar Sekunden, während das Lager Platz hatte. Der eigentliche Grund waren fehlende Träger, Tipp 12 riet aber zu einem weiteren Lagerhaus.
  - „Das Lager ist voll“ erschien bei 95 von 160, weil jedes der acht Fächer nur eine Ware aufnimmt. Die Meldung nannte weder die Ware noch diesen Grund.
- **„Normal“ war kaum zu gewinnen.** Drei Strategien verloren: Das Startbrot war nach 6–8 Minuten aufgebraucht, der erste Überfall kam bei 5:00, die Zuwanderung lief langsam.
- **Texte ohne Wirkung.**
  - Speerträger, Schwertkämpfer, Bogenschütze und Sturmknecht hatten keine Rüstungsklasse. Damit wirkte die Rüstungsmatrix (ADR 0014) gegen keinen einzigen Angreifer, obwohl die Texte „in Kette“ und „schwach gegen Kette“ behaupten.
  - Fliehende Tagelöhner zeigten Rennbilder, liefen aber im Gehtempo.
  - Der Konter gegen Reiter wurde als Stärke angezeigt, obwohl es im Spiel keine Reiter gibt.

## Optionen
**Träger**
1. *Soldaten belegen keinen Wohnraum.* Das ändert die Bevölkerungsrechnung überall (Statistik, Nahrung, Siegtafel) und löst die Verklemmung nur langsam, über die Zuwanderung.
2. *Reserve und Notzuzug.* Die Kaserne bildet die letzten N Tagelöhner nicht aus, und Hunger vertreibt sie nicht. Fehlen trotzdem Träger (z. B. gefallen), zieht trotz vollem Wohnraum und Hunger jemand zu.
3. *Nur warnen.* Die Siedlung bliebe trotzdem verklemmt.

**Balance:** den ersten Überfall abschwächen, später legen, mehr Startnahrung oder schnellere Zuwanderung.

**Rüstung**
1. *Grundeinheiten bekommen Klassen*, passend zu ihren Texten.
2. *Texte kürzen*, sodass sie nur noch zutreffende Wirkungen nennen.

## Entscheidung
**Träger, Option 2** (`src/data/traeger.ts`: `CARRIERS = { reserve: 2, emergency: true }`):
- Die Kaserne wartet, solange nur noch `reserve` Tagelöhner frei sind, und meldet: „Ausbildung wartet: Die letzten 2 Tagelöhner bleiben Träger. Baue Wohnhäuser für mehr Leute.“
- Gezählt werden Tagelöhner, die nicht gerade angestellt, ausgebildet oder vertrieben werden (`carrierCount`).
- Hunger vertreibt keinen Tagelöhner, solange es nicht mehr als `reserve` Träger gibt.
- *Notzuzug:* Sind es weniger als `reserve`, zieht beim nächsten Zuzugstermin trotz vollem Wohnraum und Hunger jemand zu. Das gilt nur, wenn es Wohnraum gibt (Bergfried oder Häuser). Leere Testkarten bleiben leer.
- Gibt es gar keinen Träger, aber offene Baustellen, Höfe oder Anlieferungen, kommt die Meldung „Kein Tagelöhner als Träger frei: …“.

**Meldungen** (`src/data/goods.ts` `StoreDef.slots`, `src/sim/storage.ts`):
- `fullText` unterscheidet zwei Fälle: alles voll („Das Lager ist voll“) und Stück frei, aber kein Fach („Kein freies Fach für Stein: Jedes Fach nimmt nur eine Ware, alle sind belegt (95 von 160 Stück)“).
- Für den vollen Hof gibt es `yardFullMessage`:
  - Liegt es am Lager, nennt die Meldung Ware und Grund.
  - Sonst heißt sie „Kein Tagelöhner kommt zum Abholen nach: Mehr Leute (Wohnhäuser) helfen.“ Diese Fassung wird für alle Höfe gemeinsam höchstens alle 60 s gemeldet (Sprecheransage `hof_voll`).
- Tipp 12 nennt beide Ursachen.
- Steinbruch, Holzfäller und Erzmine melden „kein Fels/Baum/Erz mehr in Reichweite“ nur noch, wenn wirklich nichts mehr da ist. Hält ein Kollege den letzten Fels, wartet der zweite Arbeiter ohne Meldung.

**Balance auf „Normal“** (`START`, `TUNING`, `DIFFICULTIES`):

| Wert | vorher | jetzt |
| --- | --- | --- |
| erster Überfall | 300 s | 360 s |
| erster Überfall auf „Leicht“ | 420 s | 480 s |
| Zuzug | alle 20 s | alle 15 s |
| Startbrot | 40 | 60 |

Wellengröße und Belagerungsgerät bleiben unverändert. `tests/sim/balance.test.ts` spielt eine Standardstrategie auf Seed 1, nur mit Befehlen wie im Spiel:
- Holzfäller, Steinbruch, Obstgärten, Getreidehof, Mühle, Bäckerei, Wohnhäuser, Kaserne und Bognerei
- eine Mauer mit Tor und Treppe an der Furt, vor jeder Welle stationieren

Die Strategie muss drei Wellen abwehren. Dabei darf der Bergfried nicht unter die Hälfte fallen, es müssen immer mindestens zwei Tagelöhner bleiben, und die Bevölkerung darf nicht unter den Wohnraum des Bergfrieds sinken.

**Rüstung, Option 1:** Speerträger `gepolstert`, Schwertkämpfer `kette`, Bogenschütze `leder`, Sturmknecht `leder`. Damit wirkt die Matrix auch gegen die Angreifer. Armbrustbolzen treffen den Schwertkämpfer in Kette stärker als Pfeile (BRIEF §7). Die Grenze aus ADR 0014 („alte Einheiten ohne Rüstungsklasse“) ist damit aufgehoben. Bergfried-, Abwehr-, Belagerungs- und Balance-Tests bestehen ohne Nachstimmung.

**Reiter:** Solange keine berittene Einheit ausbildbar oder unter den Angreifern ist (`RIDERS_IN_PLAY` in `src/ui/roster.ts`, aus den Daten berechnet), zeigt die Detailkarte den Konter als „Reiter (×3, sobald es Reiterei gibt)“.

**Flucht:** `LIFE.run.factor` gilt nur noch für Arbeiter. Soldaten im Rückzug haben ihr Tempo schon aus `COMMAND_TUNING.retreatSpeed`. Der Faktor bleibt bei 1: Mit 1,3 verlor der Speicher-Lauf Seed 7 („schwer“) die Partie, ohne einen einzigen Angreifer zu besiegen (mit 1: 12 besiegt, zwei Wellen abgewehrt). Die Flucht schneller zu machen, braucht eine eigene Balance-Runde.

**Angreifer-Wegfindung** (beim Balance-Lauf gefunden):
- Ein Angreifer mitten auf einer Treppe wertet für die Leiterwahl die andere Ebene derselben Kachel. Vorher wechselte die Entscheidung bei jedem Schritt, und er trat für immer auf der Stelle.
- Ein Rammbock, der am Grundriss ankommt, aber schräg außer Reichweite steht, geht die letzten Schritte heran.

## Folgen
- Neue Zustandsfelder gibt es nicht. Reserve und Notzuzug lesen nur Einheiten und Gebäude, ältere Spielstände laden unverändert.
- Wer ausbilden will, braucht Wohnhäuser. Die Kaserne sagt das, statt die Siedlung lahmzulegen.
- Tests, die feste Zeiten (300 s) oder eine feste Zahl Tagelöhner annahmen, lesen jetzt `START.raid.firstSeconds` oder schalten die Zuwanderung ab.
- Grenzen:
  - Der Balance-Lauf deckt einen Seed und eine Strategie ab. Ein Spieler, der früh alles in Soldaten steckt, kann auf „Normal“ weiter verlieren. Das soll so sein, die Siedlung verklemmt aber nicht mehr.
  - Der Suchradius des Steinbruchs (8 Felder) und die Erzmenge der Karte (5 Vorkommen, etwa 104 Erz) sind unverändert. Eine lange Eisenkette über ein ganzes Spiel ist damit nicht gesichert.
  - Reiterei bleibt Daten. Der Konter gegen Reiter wird erst mit berittenen Angreifern spielbar.
  - Fliehende Tagelöhner zeigen weiter Rennbilder im Gehtempo (siehe oben).
  - Die neuen Einheiten (Waffenknecht, Pikenier, Armbrustschütze) haben weiter weder Rennbilder noch Trefferbilder. Dafür braucht es Lebensblätter aus der Blender-Pipeline.
