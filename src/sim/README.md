# Simulation (`src/sim`)

Spiellogik ohne DOM und Pixi, 20 Ticks pro Sekunde, deterministisch aus dem Seed. Einstieg: `createGame({ seed, size })` und `loadGame(json)` aus `index.ts`, beide liefern ein `Game` (Vertrag in `types.ts`).

| Datei | Inhalt |
|---|---|
| `world.ts` | Innerer Zustand: `World` (Zustand + Meta + Laufraster + Nachschlagetabellen), Aufträge (`Job`), `ai`-Feld an Einheiten und Gebäuden |
| `mapgen.ts` | Kartengenerator: Wald im Westen, Felsfeld im Norden, Fluss mit Furt im Osten, Wege, Startlager in der Mitte |
| `nav.ts` | Laufraster mit drei Ebenen (Boden, Wehrgang, Turm), Treppen- und Turmübergänge, Tore und Turmtüren (nur Team 0), A* mit Wegkosten, Komponenten, Cache, Belagerungsmodus |
| `move.ts` | Gehen entlang von Pfaden (Höhe gleitet mit, auf Treppen nach den Stufen), Pfadbudget pro Tick, Ziele an Gebäuden, Einheiten aus neuen Grundrissen schieben |
| `build.ts` | Platzierungsregeln, Baustellen, Mauerlinien (Vorschau = Bau), Tor nur in gerader Mauer, Fertigstellung, Abriss, Zerstörung, Mauer-Nachbarschaft |
| `activity.ts` | Anzeige-Zustand: `Unit.activity`, `Building.recruits`, `Building.gateOpen` |
| `storage.ts` | Lager-Slots: reservieren, einlagern, verplante Waren, Bestand |
| `jobs.ts` | Aufträge ausführen: Arbeitszyklen aus den Daten, Tragen, Bauen, Rekrut holt Waffe |
| `economy.ts` | Disponent (2× pro Sekunde, prüft Erreichbarkeit vorab), untätige Tagelöhner (Sammelplatz, Flucht), Bäume, Zuzug, Wohnraum |
| `combat.ts` | Reichweite, Schaden, Geschosse, Tod, Abstand halten |
| `military.ts` | Soldatenverhalten je Befehl, Befehle bewegen/angreifen/halten/stationieren, Posten (Feindseite, verteilt), Ausbildung |
| `raid.ts` | Überfallwellen mit Vorwarnung (30 s), Angreifer-KI (Belagerungspfad, Hindernis einreißen) |
| `game.ts` | `Simulation` (implementiert `Game`), Tick-Reihenfolge, Befehle, Speichern/Laden |
| `debug.ts` | Hilfen für Tests (fertig bauen, Einheiten setzen, Lager füllen) |
| `demo.ts` | alte Platzhalter-Welt (für Darstellungsversuche) |

## Für Darstellung und UI wichtig

- Einheiten, Gebäude und Geschosse im Zustand tragen ein zusätzliches Feld `ai` bzw. Zusatzfelder (Geschoss: `target`, `akey`, `dur` …). Das ist innerer Zustand, nicht lesen.
- Ein Rekrut verschwindet während der Ausbildung aus `state.units` (er ist in der Kaserne) und kommt mit derselben ID als Soldat am Eingang heraus. `training.t` und `training.dur` sind Sekunden.
- Baustelle: `built` 0..1, `needs` = noch fehlendes Material, `site` = schon angeliefertes Material (sichtbar neben dem Grundriss). Gebaut wird erst, wenn `needs` leer ist.
- Bäume: `faellt` mit `progress` 0..1 (1,5 s) und Fallrichtung, `liegt` mit `logs` und `progress` = Zerlegefortschritt, dann `stumpf`. Felsbrocken verschwinden bei `amount` 0.
- Einheiten auf Treppen haben eine Zwischenhöhe `z`; `layer` wechselt am Knoten (oberer Treppen-Tile zählt schon zu Ebene 1).
- Lager: 8 Slots mit je 20 Stück (Balance in `src/data`), Füllstufe = `amount / perSlot`.
- `Unit.activity` sagt, was eine Figur tut (wartet, unterwegs, baut, traegt, faellt, zerlegt, baut_ab, holt_waffe, flieht, kaempft, wache, haelt, zieht_zu); die Animation (`anim`) ist nur das Bild dazu. Tagelöhner bauen mit `anim = "bauen"`.
- `Building.recruits` (Ausbildungsstätten): der Rekrut, der gerade die Waffe holt (`stage "waffe"`) bzw. zur Kaserne trägt (`"weg"`); `training` gibt es erst, wenn er eingetreten ist. `Building.gateOpen`: Tor offen, solange eigene Leute am Boden im oder vor dem Tor stehen.
- Sprecheransagen: `Message.voice` bzw. `CommandResult.voice` (Schlüssel aus `VOICE` in `src/data/audio.ts`). Jede Ansage hat einen Auslöser, siehe `tests/sim/voice.test.ts`. Wiederholungen drosselt schon die Simulation über den Meldungsschlüssel; die App drosselt zusätzlich nach `repeatSeconds`.
- Mauerlinie: `wallPath` (Vorschau) und Befehl `mauer` liefern dasselbe. Ein Hindernis auf der Linie lehnt die ganze Linie ab; reicht das Material nur für einen Teil, ist `ok` true, die unbezahlbaren Tiles sind rot und `reason` lautet „Nur n von m Mauerstücken bezahlbar“ (auch im Befehlsergebnis bei `ok: true`).
- Stationieren: Schützen zuerst auf Turmposten und auf die Mauerseite zur Bedrohung (lebende Angreifer, sonst Anmarschpunkt der Überfälle), mit Abstand zueinander; Nahkämpfer nur auf den Wehrgang, nahe Treppen, Toren und Türmen.

## Grenzen (Stand Prototyp)

- Kein echtes Ausweichen zwischen Figuren; nur stehende Soldaten schieben sich auseinander. Wartende Arbeiter einer Werkstatt stehen auf eigenen Feldern neben dem Eingang.
- Angreifer kommen nicht durch Tore und Turmtüren, eigene Treppen dürfen sie aber benutzen: Wer durch eine Bresche im Hof steht, steigt auf den Wehrgang (und von dort auf Türme). Eine Treppe außen an der Mauer ist deshalb eine Schwachstelle.
- Holzfäller und Steinmetze ohne Baum bzw. Fels in Reichweite warten an ihrer Hütte (Meldung „keine Bäume mehr“), bis der Spieler abreißt.
- Abriss gibt die Hälfte der Kosten sofort ins Lager zurück (nicht als getragene Ware).
- Arbeiter fliehen nicht, nur untätige Tagelöhner. Angreifer haben keine Leitern; sie reißen Mauern und Tore ein.
- Pfadsuche ist A* auf dem vollen Raster mit Komponenten-Vorprüfung, kein hierarchisches Raster und keine Flussfelder.
