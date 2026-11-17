# Simulation (`src/sim`)

Spiellogik ohne DOM und Pixi, 20 Ticks pro Sekunde, deterministisch aus dem Seed. Einstieg: `createGame({ seed, size })` und `loadGame(json)` aus `index.ts`, beide liefern ein `Game` (Vertrag in `types.ts`).

| Datei | Inhalt |
|---|---|
| `world.ts` | Innerer Zustand: `World` (Zustand + Meta + Laufraster + Nachschlagetabellen), Aufträge (`Job`), `ai`-Feld an Einheiten und Gebäuden |
| `mapgen.ts` | Kartengenerator: Wald im Westen, Felsfeld im Norden, Fluss mit Furt im Osten, Wege, Startlager in der Mitte |
| `nav.ts` | Laufraster mit drei Ebenen (Boden, Wehrgang, Turm), Treppen- und Turmübergänge, Tore, A* mit Wegkosten, Komponenten, Cache, Belagerungsmodus |
| `move.ts` | Gehen entlang von Pfaden (Höhe gleitet mit, auf Treppen nach den Stufen), Pfadbudget pro Tick, Ziele an Gebäuden |
| `build.ts` | Platzierungsregeln, Baustellen, Mauerlinien, Tor in Mauer, Fertigstellung, Abriss, Zerstörung, Mauer-Nachbarschaft |
| `storage.ts` | Lager-Slots: reservieren, einlagern, verplante Waren, Bestand |
| `jobs.ts` | Aufträge ausführen: Arbeitszyklen aus den Daten, Tragen, Bauen, Rekrut holt Waffe |
| `economy.ts` | Disponent (2× pro Sekunde), untätige Tagelöhner (Sammelplatz, Flucht), Bäume, Zuzug |
| `combat.ts` | Reichweite, Schaden, Geschosse, Tod, Abstand halten |
| `military.ts` | Soldatenverhalten je Befehl, Befehle bewegen/angreifen/halten/stationieren, Posten, Ausbildung |
| `raid.ts` | Überfallwellen und Angreifer-KI (Belagerungspfad, Hindernis einreißen) |
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

## Grenzen (Stand Prototyp)

- Kein echtes Ausweichen zwischen Figuren; nur stehende Soldaten schieben sich auseinander.
- Abriss gibt die Hälfte der Kosten sofort ins Lager zurück (nicht als getragene Ware).
- Arbeiter fliehen nicht, nur untätige Tagelöhner. Angreifer haben keine Leitern; sie reißen Mauern und Tore ein.
- Pfadsuche ist A* auf dem vollen Raster mit Komponenten-Vorprüfung, kein hierarchisches Raster und keine Flussfelder.
