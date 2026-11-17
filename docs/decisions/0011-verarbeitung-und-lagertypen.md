# 0011 – Verarbeitung nach Rezept, Lagertypen und Kornkammer

**Status:** angenommen (17.11.2026). Grundlage der Verarbeitungswirtschaft, auf der weitere Ketten (Eisen, Leder, Stoff, Fleisch …) aufbauen.

## Kontext
Bis hier kannte die Wirtschaft nur Gewinnung: Holzfäller und Steinbruch legen Ware auf ihren Hofstapel, Träger bringen sie ins Lagerhaus. Das Briefing verlangt Ketten, deren Stufen tatsächlich ineinandergreifen (§5.5: Getreidefarm → Kornkammer → Mühle → Bäckerei → Kornkammer). Die Ware soll dabei sichtbar angeliefert, verarbeitet und eingelagert werden (§5.2, §13), und Lebensmittel sollen getrennt von Baustoffen in einer Kornkammer liegen (§5.4). Ein Gebäude, das nach Zeit X eine Zahl umbucht, reicht nicht.

Acht weitere Zweige bauen auf diesem Stand auf. Die Schnittstelle muss deshalb so beschaffen sein, dass eine neue Ware, ein neues Rezept, ein neues Verarbeitungsgebäude oder ein weiteres Lager nur Daten braucht.

## Optionen
1. **Werkstatt mit festem Ein-/Ausgang im Code** (je Gebäude eine Funktion): schnell, aber jede Kette wäre ein Sonderfall, und Panel und Disponent müssten jedes Gebäude kennen.
2. **Rezepte als Daten, Puffer am Gebäude, Waren nur über Figuren**: Ein Rezept nennt Eingänge, Ausgänge, Zeit, Gebäude und Animation. Das Gebäude hat einen sichtbaren Eingangspuffer und Ausgabestapel. Anliefern und Abholen übernehmen die Tagelöhner des Disponenten, das Verarbeiten übernimmt der angestellte Arbeiter im Gebäude.
3. **Direkter Bezug aus dem Lager ohne Puffer** (der Arbeiter holt selbst): weniger Zustand, aber der Arbeiter wäre die meiste Zeit unterwegs, und am Gebäude wäre nicht zu sehen, was fehlt.

## Entscheidung
Option 2.

**Daten** (`src/data`):
- `goods.ts`: Jede Ware hat einen Lagertyp `store` (`STORES`: `material` → Lagerhaus, `nahrung` → Kornkammer), eine Gruppe für die Kopfleiste (`GOOD_GROUPS`), einen Stapel-Sprite `stack` und eine Trägerfigur `carrier`. Neu sind Getreide, Mehl und Brot.
- `recipes.ts`: `RECIPES` mit `building`, `inputs`, `outputs`, `seconds`, `anim` und optional `tech`. Ein Gebäude kann mehrere Rezepte haben. Das erste ist voreingestellt, das Panel zeigt dann eine Auswahl (Befehl `rezept`).
- `BuildingDef.production` (`ProductionDef`): `buffer` und `stock` (in Arbeitsgängen), Arbeitsplatz `spot` und Blickrichtung `face` im Inneren, `inputPiles` und `outputPiles` (Stellen der sichtbaren Stapel). Alle Positionen sind Modellachsen ab Grundrissmitte und drehen mit der Ausrichtung. Der Arbeitszyklus des Arbeiters ist `[{ do: "process" }]`.
- `BuildingDef.storage.kind` legt fest, welchen Lagertyp ein Lager aufnimmt (ohne Angabe: `material`). `verarbeitung.ts` enthält Kornkammer, Windmühle und Bäckerei.

**Simulation** (`src/sim/production.ts`, `ProcState` an `Building.proc`):
1. *Anliefern:* Der Disponent gibt Tagelöhnern Aufträge `supply` mit `pk`. Sie holen eine Eingangsware aus einem Lager des passenden Typs (Reservierung im Fach) und legen sie vor der Tür in den Puffer. Angeliefert wird bis Rezeptmenge × `buffer`, und nur, was frei im Lager liegt; Baustellen und Forschung haben ihre Waren vorher verplant.
2. *Verarbeiten:* Der Arbeiter geht durch die Tür an seinen Arbeitsplatz (`u.inside`, nur im Schnittbild sichtbar). Liegt genug im Puffer und passt die Ausgabe auf den Stapel, nimmt er die Eingänge (`busy`). Dann arbeitet er `seconds` mit der Rezeptanimation und legt die Ausgänge auf den Ausgabestapel.
3. *Abholen:* Träger (`haul`) bringen den Ausgabestapel ins Lager des Ausgangstyps. Ist dort kein Platz, bleibt die Ware liegen, der Stapel läuft voll, und die Arbeit ruht.
- *Stillstandsgrund* `proc.why`: `angehalten`, `kein_arbeiter`, `unterwegs`, `eingang` (fehlende Waren) oder `ausgang` (Stapel voll, `full` = auch das Lager ist voll). Als Spielertext liefert ihn `procReason`. Fehlt eine Eingangsware im ganzen Lager, meldet die Simulation das (gedrosselt über den Meldungsschlüssel).
- *Gerechte Träger:* Der Disponent verschränkt Forschung, Baustellen und Verarbeitung (`interleave`), und innerhalb der Verarbeitung die Gebäude und Waren. So geht keine Aufgabe leer aus, wenn die anderen viele Aufträge haben.
- *Anhalten* (`produktion`): Es wird nichts mehr angeliefert, und es beginnt kein neuer Arbeitsgang; ein laufender wird fertig.
- *Rezeptwechsel und Abriss:* Puffer, Ausgabestapel und die Eingänge eines laufenden Arbeitsgangs gehen sofort ins Lager zurück, wie die Kostenerstattung. Reicht der Platz nicht, verfällt der Rest.
- *Speichern:* `proc` liegt im Spielstand. Nach dem Laden laufen dieselben Ticks gleich weiter (Test).

**Lager:**
- `storage.ts` sucht Platz und Ware nur in Lagern des passenden Typs (`storagesNear(kind)`, Reservierungen je Typ).
- `SimState.stores` führt Bestand und Kapazität je Typ. Die Kopfleiste zeigt sie getrennt, eine Zelle je `STORE_KEYS`-Eintrag mit dem Bild des Lagers.
- Die Kornkammer ist ein geschlossenes Bohlenhaus mit Tür (`door`, ADR 0010). Sie hat sechs Fächer zu je 20 Stück (Regale mit Säcken, Fässern und Körben), einen Schnitt wie das Lagerhaus (ADR 0005) und lässt sich mehrfach bauen. START stellt eine Kornkammer mit 40 Getreide neben Lagerhaus und Bergfried.

**Darstellung:**
- Eingangspuffer und Ausgabestapel stehen als Lagerstapel (`stack`) an den Stellen aus `production`, Füllstufe = Menge / Stapelgröße.
- `BuildingDef.workAnim` macht aus den Sprite-Varianten eine Arbeitsanimation. Sie läuft nur, solange `proc.busy` ist, und bleibt beim Anhalten stehen, ohne zu springen; das gilt für die Mühlenflügel.
- Schornsteinrauch rauchen Verarbeitungsgebäude nur bei laufendem Arbeitsgang (Bäckerei).

**Grafik:** Blender-Pipeline im Stil „vorgerendert“, Seeds 200–232:
- Kornkammer, Windmühle (6 Flügelstellungen) und Bäckerei, je mit Schnittbild, Baustelle und Gerüst (ADR 0009).
- Stapel für Getreide, Mehl und Brot.
- Figuren Müller, Bäcker und drei Träger.

**Oberfläche:**
- Reiter „Nahrung“ (F6, `src/data/hotkeys.ts`).
- Panel „Verarbeitung“: Rezept, Vorrat mit Füllbalken und „unterwegs“, Fortschritt, Ausgabestapel, Stillstandsgrund und Anhalten/Fortsetzen.

## Folgen
- Eine neue Kette braucht nur Daten:
  - Ware mit Stapel und Träger
  - Rezept
  - Gebäude mit `production`
  - Sprites über die Pipeline
  Panel, Kopfleiste, Disponent und Speichern brauchen keine Änderung.
- Ein neuer Lagertyp ist ein Eintrag in `STORES` und ein Gebäude mit `storage.kind`.
- Getreide gibt es noch nicht aus eigener Erzeugung: Die Kette läuft vom Startvorrat. Ein Bauernhof (Getreidefarm → Kornkammer) folgt in einem eigenen Zweig.
- Die Kornkammer hat 100 LP statt der 300 des Lagerhauses. Das ist eine Balance-Wahl: Sie steht ab Spielbeginn neben dem Bergfried, und die Angreifer der ersten Welle sollen sich nicht spürbar länger an ihr aufhalten. Sonst würde die Prüfung „braucht dort über zwei Minuten“ in `tests/sim/bergfried.test.ts` nicht mehr gelten. Der Wert ist vorläufig.
- Verarbeitet wird nur für Team 0. Angreifer haben keine Wirtschaft.
- Getragene Waren sind sichtbar, Rückgaben bei Abriss und Rezeptwechsel jedoch nicht; sie werden sofort gebucht, wie die Kostenerstattung im Prototyp.
- Die Tests in `tests/sim/verarbeitung.test.ts` decken ab:
  - die ganze Kette über echte Ticks mit Mengenerhalt
  - Anlieferung nur durch Träger an der Tür
  - Drosselung bei voller Kornkammer und das Weiterlaufen mit einer zweiten
  - fehlende Eingänge, fehlende Arbeiter, Anhalten
  - Abriss mit Rückgabe
  - Speichern und Laden mitten im Arbeitsgang
  - alle vier Ausrichtungen
  - die Verteilung der Träger
  `tests/render/verarbeitung.test.ts` prüft Flügel, Rauch und Stapel.
