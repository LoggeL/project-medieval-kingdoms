# Simulation (`src/sim`)

Spiellogik ohne DOM und Pixi, 20 Ticks pro Sekunde, deterministisch aus dem Seed. Einstieg: `createGame({ seed, size })` und `loadGame(json)` aus `index.ts`, beide liefern ein `Game` (Vertrag in `types.ts`).

| Datei | Inhalt |
|---|---|
| `world.ts` | Innerer Zustand: `World` (Zustand + Meta + Laufraster + Nachschlagetabellen), Aufträge (`Job`), `ai`-Feld an Einheiten und Gebäuden |
| `mapgen.ts` | Kartengenerator: Wald im Westen, Felsfeld im Norden, Fluss mit Furt im Osten, Wege, Startlager in der Mitte |
| `nav.ts` | Laufraster mit drei Ebenen (Boden, Wehrgang, Turm), Gebäude als feste Hindernisse (Zugang nur über die Tür, Daten `door`), Treppen- und Turmübergänge, Tore und Turmtüren (nur Team 0), A* mit Wegkosten, keine Diagonale an gesperrten Ecken, Komponenten, Cache, Belagerungsmodus |
| `move.ts` | Gehen entlang von Pfaden (Höhe gleitet mit, auf Treppen nach den Stufen), Pfadbudget pro Tick, Ziele an Gebäuden, Einheiten aus neuen Grundrissen schieben |
| `build.ts` | Platzierungsregeln, Baustellen, Mauerlinien (Vorschau = Bau), Tor nur in gerader Mauer, Fertigstellung, Abriss, Zerstörung, Mauer-Nachbarschaft |
| `activity.ts` | Anzeige-Zustand: `Unit.activity`, `Building.recruits`, `Building.gateOpen` |
| `storage.ts` | Lager-Slots je Lagertyp (`storagesNear(kind)`, Materiallager/Kornkammer): reservieren, einlagern, verplante Waren, Bestand und `stores` (Bestand/Kapazität je Typ) |
| `production.ts` | Verarbeitung nach Rezept (ADR 0011): Eingangspuffer, Arbeitsgang, Ausgabestapel, Stillstandsgrund, Rezeptwahl, Anhalten, Rückgabe bei Abriss |
| `jobs.ts` | Aufträge ausführen: Arbeitszyklen aus den Daten (auch `process`), Tragen (Hofstapel und Ausgabestapel), Anliefern (Baustelle, Forschung, Eingangspuffer), Bauen, Rekrut holt Waffe |
| `economy.ts` | Disponent (2× pro Sekunde, prüft Erreichbarkeit vorab, verschränkt Forschung, Baustellen und Verarbeitung gerecht), untätige Tagelöhner (Sammelplatz, Flucht), Bäume, Zuzug, Wohnraum |
| `combat.ts` | Reichweite, Schaden (Mauerbonus), Zielwahl nach Gefahr mit Haltezeit, Geschosse, Tod, Abstand halten |
| `military.ts` | Soldatenverhalten je Befehl, Befehle bewegen/angreifen/halten/stationieren, Posten (Feindseite, verteilt), Nahkämpfer verteidigen Tor, Treppe und Wehrgang ihres Abschnitts, Ausbildung |
| `raid.ts` | Überfallwellen mit Vorwarnung (30 s), Angreifer-KI (Belagerungspfad, Hindernis einreißen, Graben zuschütten, Rückzug), Belagerungswerkzeug ab Welle 2 |
| `belagerung.ts` | Belagerung und Befestigung (ADR 0017): Sturmleitern (anlegen, klettern, umstoßen), Rammbock und Mannschaft, Trümmer (Bresche), Schadensstufen, Reparatur durch Tagelöhner, Heilung, Graben zuschütten |
| `game.ts` | `Simulation` (implementiert `Game`), Tick-Reihenfolge, Befehle, Einführung (Zielkette aus `TUTORIAL`), Speichern/Laden |
| `debug.ts` | Hilfen für Tests (fertig bauen, Einheiten setzen, Lager füllen) |
| `demo.ts` | alte Platzhalter-Welt (für Darstellungsversuche) |

## Für Darstellung und UI wichtig

- Einheiten, Gebäude und Geschosse im Zustand tragen ein zusätzliches Feld `ai` bzw. Zusatzfelder (Geschoss: `target`, `akey`, `dur` …). Das ist innerer Zustand, nicht lesen.
- Ein Rekrut verschwindet während der Ausbildung aus `state.units` (er ist in der Kaserne) und kommt mit derselben ID als Soldat am Eingang heraus. `training.t` und `training.dur` sind Sekunden.
- Baustelle: `built` 0..1, `needs` = noch fehlendes Material, `site` = angeliefertes, noch nicht verbautes Material (sichtbar im Grundriss), `mat` = Material insgesamt. Ein Bauarbeiter baut, sobald Material liegt, verbaut es Stück für Stück und kommt nie über `verbaut / mat` hinaus (`buildCap`, `canWork`, `useMaterial` in `build.ts`, ADR 0009).
- Bäume: `faellt` mit `progress` 0..1 (1,5 s) und Fallrichtung, `liegt` mit `logs` und `progress` = Zerlegefortschritt, dann `stumpf`. Felsbrocken verschwinden bei `amount` 0.
- Einheiten auf Treppen haben eine Zwischenhöhe `z`; `layer` wechselt am Knoten (oberer Treppen-Tile zählt schon zu Ebene 1).
- Lager: 8 Slots mit je 20 Stück (Balance in `src/data`), Füllstufe = `amount / perSlot`. Kornkammer: 6 Slots zu 20. Jedes Lager nimmt nur Waren seines Typs (`storage.kind`, `GOODS[..].store`); `state.stores[kind]` = `{ used, cap }` für die Kopfleiste, `state.capacity` bleibt die Summe aller Lager.
- Verarbeitung (`Building.proc`, nur fertige Gebäude mit `production`, nur Team 0): `recipe`, Eingangspuffer `in` (+ `enroute`/`picked` = unterwegs bzw. schon aus dem Lager genommen), Ausgabestapel `out` (+ `res` = für Träger reserviert), `busy`/`t` (Arbeitsgang läuft, Sekunden darin), `done`, `paused`, `why`. Für die Oberfläche: `inputCap`, `outputCap`, `procProgress`, `procReason` (Spielertext, null = läuft) aus `production.ts`. Befehle `{ t: "rezept", building, recipe }` und `{ t: "produktion", building, an }`. Der Arbeiter ist während der Arbeit `inside` und steht am `production.spot` (Schnittbild).
- Gebäude sind feste Hindernisse (ADR 0010), auch Lagerhaus, Bergfried (alle Stufen) und Baustellen: Figuren betreten sie nur über die Tür (`BUILDINGS[..].door`, `geom.entrance`), die bei allen Gebäuden vor dem Grundriss liegt. Ins Lagerhaus gehen Träger von dort durchs Tor bis an ihr Fach (`storeVisit`, ADR 0005). Läge eine Tür im Grundriss (offene Einfahrt, `geom.doorInside`), bliebe nur sie begehbar. Keine Diagonale an gesperrten Ecken. Auf den Vorplatz einer Tür (`geom.approach`) lässt sich nichts bauen, auch keine Mauer.
- `Unit.activity` sagt, was eine Figur tut (wartet, unterwegs, baut, traegt, faellt, zerlegt, baut_ab, holt_waffe, flieht, kaempft, wache, haelt, zieht_zu); die Animation (`anim`) ist nur das Bild dazu. Tagelöhner bauen mit `anim = "bauen"`.
- `Building.recruits` (Ausbildungsstätten): der Rekrut, der gerade die Waffe holt (`stage "waffe"`) bzw. zur Kaserne trägt (`"weg"`); `training` gibt es erst, wenn er eingetreten ist. `Building.gateOpen`: Tor offen, solange eigene Leute am Boden im oder vor dem Tor stehen.
- Sprecheransagen: `Message.voice` bzw. `CommandResult.voice` (Schlüssel aus `VOICE` in `src/data/audio.ts`). Jede Ansage hat einen Auslöser, siehe `tests/sim/voice.test.ts`. Wiederholungen drosselt schon die Simulation über den Meldungsschlüssel; die App drosselt zusätzlich nach `repeatSeconds`.
- Mauerlinie: `wallPath` (Vorschau) und Befehl `mauer` liefern dasselbe. Ein Hindernis auf der Linie lehnt die ganze Linie ab; reicht das Material nur für einen Teil, ist `ok` true, die unbezahlbaren Tiles sind rot und `reason` lautet „Nur n von m Mauerstücken bezahlbar“ (auch im Befehlsergebnis bei `ok: true`).
- Stationieren: Schützen zuerst auf Turmposten und auf die Mauerseite zur Bedrohung (lebende Angreifer, sonst Anmarschpunkt der Überfälle), mit Abstand zueinander; Nahkämpfer nur auf den Wehrgang, nahe Treppen, Toren und Türmen.
- Auf dem Posten: Schützen schießen auf das gefährlichste Ziel in Reichweite (feindliche Schützen, wer Tor oder Mauer angreift, wen ihre Pfeile schnell erledigen) und halten es `TUNING.targetHoldSeconds`. Nahkämpfer verlassen den Posten (`activity` „kaempft“/„unterwegs“, Befehl bleibt `station`), wenn ein Gegner bis auf `TUNING.postLeash` Felder an ein Tor oder eine Treppe ihres Abschnitts (`TUNING.postGuardRadius`) kommt oder auf den Wehrgang steigt, gehen über Treppe und Tor hin und kehren danach zurück.
- Rückzug: Angreifer unter `TUNING.retreatHp` ihrer LP oder als Letzte ihrer Welle (nachdem andere gefallen oder geflohen sind) haben `activity` „flieht“, kämpfen nicht mehr und verlassen die Karte am Anmarschpunkt (ohne Tod, ohne Kopfgeld). Danach meldet die Welle „abgewehrt“.
- Nahkampf gegen Gebäude nur aus dem Nachbarfeld (nicht durch eine Mauer hindurch); wer auf einer Treppe steht, trifft sie in jeder Höhe.
- Einführung: `TUTORIAL` in `src/data` ist eine Zielkette; jeder Schritt erscheint als Meldung (`kind` „info“), sobald der vorige erreicht ist, erledigte Schritte werden übersprungen.
- Ein Tor in einem fertigen Mauerstück übernimmt dessen Steine (`costAt` in `build.ts`); die Vorschau prüft dieselben Kosten.

## Verarbeitung erweitern (ADR 0011)

Alles ist Daten; Disponent, Panel, Kopfleiste, Speichern und Darstellung brauchen keine Änderung.

**Neue Ware** (`src/data/goods.ts`): Schlüssel in `Good`, Eintrag in `GOODS` mit `store` (Lagertyp), `group` (Kopfleiste), `stack` (Lagerstapel im Gebäudeblatt, 5 Varianten = Füllstufen 0–4) und `carrier` (Trägerfigur im Figurenblatt). Dazu Ersatzfarben in `src/render/fallbacks.ts` (`PILE`) und `src/ui/dev/mock.ts` (`GOOD_TINT`), damit die Typprüfung vollständig bleibt. Die Ikone der Oberfläche wird aus dem vollen Stapel geschnitten.

**Neues Rezept** (`src/data/recipes.ts`): Schlüssel in `RecipeKey`, Eintrag in `RECIPES` mit `building`, `inputs`, `outputs`, `seconds`, `anim` (Schlüssel in `AnimKey`, Aktion im Figurenblatt des Arbeiters; fehlt sie, zeigt die Darstellung einen Ersatz) und optional `tech`. Mehrere Rezepte je Gebäude: Das erste ist voreingestellt, das Panel bietet die Auswahl an.

**Neues Verarbeitungsgebäude**: eigene Datei in `src/data` (Muster `verarbeitung.ts`), mit einer Zeile in `BUILDINGS` eingehängt (`...VERARBEITUNG`). Felder:
- `workers: { unit, count, cycle: [{ do: "process" }] }`, Arbeitereinheit in `UNITS` (Rolle „arbeiter“)
- `production: { buffer, stock, spot, face, inputPiles, outputPiles }` (Modellachsen ab Grundrissmitte, drehen mit der Ausrichtung; Stapel neben der Tür, nicht auf dem Vorplatz `door`)
- `door`, `construction` (ADR 0009), `interior.sprite` (Schnittbild), optional `workAnim: { fps }`, wenn die Sprite-Varianten die Arbeit zeigen (Mühlenflügel)
- Schornsteinrauch: `CHIMNEYS` in `src/render/smoke.ts` (Modellmeter) und eine gemessene Zeile in `tests/render/smoke.test.ts`; Verarbeitungsgebäude rauchen nur bei laufendem Arbeitsgang.

**Neues Lager bzw. neuer Lagertyp**: Lagertyp = Eintrag in `STORES` (Name, Meldungen „voll“/„keines“). Lagergebäude = `storage: { kind, slots, perSlot, shelves }` (`shelves` dieselben Werte wie im Blender-Eintrag `*_innen`), `door`, `interior`. Die Kopfleiste zeigt je Lagertyp eine Zelle.

**Sprites** (nur Blender-Pipeline, Stil „vorgerendert“, ADR-Seeds je Zweig):
1. `tools/blender/buildings.py`: Builder-Funktionen `b_<key>` und `b_<key>_innen` (Schnitt je Ansicht), Grundriss in `SITE_RECTS`, Gerüst in `SCAFFOLDS`, Eintrag in `BUILD`.
2. `tools/blender/buildings/buildings.json`: Einträge **anhängen** (Gebäude, `_innen` mit `cutaway`/`front`, `baustelle_*`, `geruest_*`, `stapel_*`) mit eigenem Seed; neue Farben ans Ende von `palette.json`.
3. Figuren: Ausrüstung und Aktionen in `tools/blender/figures.py`, Einheiten in `tools/blender/units.json` anhängen.
4. Rendern mit `--only` und `pixelize.py` (Lichtreferenz `.local/blender/vorgerendert`), neue Einträge **nur anhängen** an `sheet.json`; bestehende PNGs müssen bytegleich bleiben. Jedes Bild ansehen (Maße, Transparenz, Stil), bevor es als vorhanden gilt.

**Tests**: Kette über echte Ticks, Drosselung, fehlende Eingänge, Abriss, Speichern/Laden und alle vier Ausrichtungen nach dem Muster `tests/sim/verarbeitung.test.ts`.

## Belagerung (ADR 0017)

- **Leitern** sind Laufverbindungen nur für Team 1 (`nav.foeLinks`, Fuß ↔ Wehrgang), neu aufgebaut bei jedem `nav.rebuild()` aus `SimState.ladders`. Wer eine Leiter umstößt oder ein Mauerstück zerstört, ändert den Graphen: danach `nav.rebuild()` und für Team 1 `stop()`, die Bewegung prüft nur Knoten, nicht Kanten. Lebt kein Angreifer mehr, kippen die übrigen Leitern von selbst.
- **Bodenmodus** (`TravelGoal.ground`, `route(..., ground)`): keine Treppen, Leitern, Turmtüren und Gräben. Für Fahrzeuge (`UnitDef.vehicle`).
- **Graben** = Bodenwert `DITCH`: Team 0 zahlt `ditch.ownCost`, Team 1 nur im Durchbruchmodus (zuschütten), Bodenmodus nie.
- **Trümmer** (`SimState.rubble`) heben die Wegkosten auf `SIEGE.rubbleCost`; `placeSite` und `spawnBuilt` räumen sie.
- **Neue Ziehware** (Linie wie die Mauer): `drag: true` und `pieces: {prefix}` in den Daten, Sprites `<prefix>_gerade|ende|ecke|t|kreuz|einzel`; Befehl `{t: "mauer", key}`.
- **Schaden** zeigt die Darstellung aus `damageStage(b)`: Blatt `<sprite>_schaden` (Stufen 1–3) oder die Überlagerung `schaden_<b>x<t>`.
- Tests: `tests/sim/belagerung.test.ts`.

## Grenzen (Stand Prototyp)

- Kein echtes Ausweichen zwischen Figuren; nur stehende Soldaten schieben sich auseinander. Wartende Arbeiter einer Werkstatt stehen auf eigenen Feldern neben dem Eingang.
- Angreifer kommen nicht durch Tore und Turmtüren, eigene Treppen dürfen sie aber benutzen: Wer durch eine Bresche im Hof steht, steigt auf den Wehrgang (und von dort auf Türme). Eine Treppe außen an der Mauer ist deshalb eine Schwachstelle.
- Holzfäller und Steinmetze ohne Baum bzw. Fels in Reichweite warten an ihrer Hütte (Meldung „keine Bäume mehr“), bis der Spieler abreißt.
- Abriss gibt die Hälfte der Kosten sofort ins Lager zurück (nicht als getragene Ware), bei Verarbeitungsgebäuden auch Puffer, Ausgabestapel und die Eingänge eines laufenden Arbeitsgangs (ebenso beim Rezeptwechsel); was nicht ins Lager passt, verfällt.
- Getreide entsteht noch nirgends (kein Bauernhof): Die Brotkette läuft vom Startvorrat der Kornkammer (40 Getreide = 20 Mehl = 40 Brot). Brot wird noch nicht verbraucht.
- Arbeiter fliehen nicht, nur untätige Tagelöhner. Angreifer reißen Mauern und Tore ein; ab Welle 2 bringen sie Sturmleitern, ab Welle 3 einen Rammbock (ADR 0017). Auf Arbeiter gehen sie nur aus der Nähe los (`TUNING.raiderWorkerReach`), flüchtenden Tagelöhnern laufen sie nicht über die Karte nach.
- Fällt ein Tor, kann ein Mauerabschnitt vom Treppenzugang abgeschnitten sein: Die Wachen dort melden „Posten nicht erreichbar“ und werden untätig (kämpfen dann wie freie Soldaten).
- Die Balance ist auf die Standardkarte (Seed 1) und die Furt abgestimmt; ab Welle 2 (6 Angreifer) reichen drei Verteidiger ohne Turm nicht mehr.
- Pfadsuche ist A* auf dem vollen Raster mit Komponenten-Vorprüfung, kein hierarchisches Raster und keine Flussfelder.
