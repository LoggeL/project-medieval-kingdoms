# 0013 – Landwirtschaft mit sichtbaren Feldern, Ernährung mit Rationen und Hunger

**Status:** angenommen (17.11.2026). Baut auf ADR 0011 (Rezepte, Lagertypen, Kornkammer) auf und schließt die Brotkette: Feld → Kornkammer → Mühle → Bäckerei → Kornkammer → Verbrauch.

## Kontext
Bis hier entstand Getreide nirgends; die Brotkette lief vom Startvorrat, und Brot wurde nicht gegessen. Das Briefing verlangt einen Bauernhof, dessen Felder sichtbar bearbeitet werden, auf denen Getreide sichtbar wächst und geerntet wird (§5.2), Waren, die Figuren tragen (§5.3, §13), und eine Kopfleiste mit Nahrung (§8.2). Nahrung soll einen Zweck haben: Ohne Essen muss die Siedlung spürbar leiden, mit genug Essen soll man über Rationen steuern können.

Was zu entscheiden war:
- Wie liegen Felder in der Welt (eigene Objekte, Teil des Grundrisses, Gelände)?
- Was macht der Bauer, und wann wächst etwas ohne ihn?
- Wo und wie wird gegessen, und was folgt aus Hunger?
- Wie bleibt das für weitere Feldfrüchte und Höfe reine Datenarbeit?

## Optionen
**Felder**
1. *Felder als Teil des Gebäudegrundrisses* (großes Sprite mit Feld): einfach, aber Wachstumsstufen je Beet und Arbeit an einzelnen Stellen wären nicht darstellbar, und das Grundstück wäre ein festes Hindernis.
2. *Felder als Gelände* (Tile-Typ „Acker“): passt zur Kachelwelt, aber Stufen, Reservierung durch den Bauern und Abriss müssten im Gelände leben; das Gelände ist bisher unveränderlich und gehört einem anderen Zweig.
3. *Beete als Zustand des Hofs*: Der Hof besitzt ein Rechteck neben seinem Grundriss (Daten), jede passende Kachel darin ist ein Beet mit Stufe und Zeit. Begehbar, aber nicht bebaubar.

**Essen**
1. *Jede Figur geht essen*: sehr lebendig, aber viele Wege und Aufträge je Minute; mit dem Disponenten der Träger nicht zu vereinbaren, ohne dass Arbeit liegen bleibt.
2. *Verbrauch aus der Kornkammer*: Die Bewohner essen Stück für Stück aus den Fächern der Kornkammer. Der Vorrat schrumpft sichtbar in den Regalen; Hunger hat feste, prüfbare Folgen.

## Entscheidung
Felder Option 3, Essen Option 2.

**Daten** (`src/data/landwirtschaft.ts`, `src/data/nahrung.ts`):
- `CROPS`: Feldfrucht mit Sprite im Gebäudeblatt und Stufen. Eine Stufe ist entweder Arbeit (`work`: Animation, Sekunden, Verb für das Panel) oder Wachstum (`grow`: Sekunden). Die Erntestufe hat zusätzlich `harvest` (Ware, Stück je Gang). Nach der Ernte geht es bei `after` weiter.
  - Getreide: brach → umgegraben → gesät → keimt → wächst → reif. Umgraben, Säen und Ernten tut der Bauer; die drei Stufen dazwischen wachsen von selbst. Ernte 2 Garben je Beet.
  - Äpfel: Setzling → belaubt → blüht → trägt Früchte. Der Obstbauer pflückt einen Korb; danach treibt der Baum neu aus (zurück auf „belaubt“).
- `BuildingDef.fields` (`FieldDef`): Feldfrucht, Rechteck in Modellachsen ab Grundrissmitte (dreht mit der Ausrichtung), erlaubtes Gelände und Mindestzahl der Beete. Der Getreidehof braucht `wiese`, der Obstgarten `gras` oder `wiese`. Kommt später „fruchtbarer Boden“ dazu, ist das ein weiterer Eintrag in `terrain`.
- Getreidehof (`bauernhof`) und Obstgarten (`obstgarten`): Hofstapel `output` der Ernteware, Arbeiter `bauer` bzw. `obstbauer` mit dem Zyklus `[{ do: "farm" }]`.
- `RATIONS` (knapp, normal, reichlich: Portionen je Bewohner und Minute, Faktor auf den Abstand des Zuzugs), `FOOD` (essbare Waren mit Portionen, Startration, Schonfrist, Abstand des Fortgehens, Vielfalt). Neue Ware Äpfel (Lagertyp Nahrung, Stapel, Trägerfigur). Startvorrat 40 Brot.

**Simulation** (`src/sim/farm.ts`, `src/sim/food.ts`):
- *Platzieren:* Die Beete entstehen beim Setzen der Baustelle (`fieldPlan`): jede Kachel im gedrehten Rechteck auf passendem Gelände, ohne Bau, Baum, Fels, fremdes Beet und Türvorplatz. Die Vorschau zeigt die Feldkacheln grün bzw. rot. Unter der Mindestzahl lautet der Grund „Zu wenig freie Wiese für die Felder (n von mindestens m Beeten)“. Auf Beete baut man nichts, laufen kann man darüber.
- *Arbeit:* Der Bauer wählt das nächste Beet (Ernte vor Säen vor Umgraben; Ernte nur, wenn der Hofstapel Platz hat), reserviert es (`Plot.by`), geht hin, schaut darauf und arbeitet mit der Animation der Stufe. Weiter geht es nur, solange er dort arbeitet. Die Ernte trägt er selbst zum Hof (`j.n` Stück), von dort holen Träger sie in die Kornkammer (Disponent wie bei jedem Hofstapel).
- *Wachstum:* `updateFarms` zählt die Wachstumsstufen fertiger eigener Höfe je Tick weiter.
- *Essen:* `updateFood` rechnet je Tick Bevölkerung × Ration auf eine offene Portion. Ist eine ganze offen, wird ein Stück gegessen: die essbare Ware mit dem größten Vorrat, aus dem Fach mit dem kleinsten Rest. Reservierte Stücke bleiben liegen.
- *Hunger:* Ist nichts mehr da, wächst `food.hunger`. Folgen:
  - Meldung (keine Sprecheransage, es gibt keine passende)
  - kein Zuzug
  - nach `graceSeconds` geht ein untätiger Tagelöhner sichtbar zum Kartenrand und verlässt die Siedlung, danach alle `leaveSeconds` ein weiterer
  Mit dem ersten Bissen endet der Hunger.
- *Rationen und Vielfalt:* Befehl `rationen`. Die Ration und die Zahl der vorrätigen Sorten (`FOOD.variety` je weiterer Sorte) ändern den Abstand des Zuzugs.
- *Abriss:* Die Beete werden frei. Der Bauer wird Tagelöhner; seine getragene Ernte wird gebucht.
- *Speichern:* `Building.farm` und `SimState.food` liegen im Spielstand. Alte Spielstände ohne `food` bekommen ihn beim ersten Tick.
- Im leeren Testszenario isst niemand (`meta.hungerOff`), damit bestehende Tests ohne Kornkammer gleich bleiben.
- *Disponent:* Er beginnt seine Verschränkung je Durchgang bei einem anderen Gebäude (`rotate`). Vorher bekam bei wenigen freien Trägern immer dasselbe Gebäude den ersten Auftrag. Der Brotstapel der Bäckerei wurde dann nie abgeholt, und die Kette stand.

**Darstellung** (`src/render/scene.ts`):
- Jedes Beet ist ein eigenes Objekt in der Tiefensortierung, Sprite der Feldfrucht in der Variante seiner Stufe.
- Getreidebeete liegen längs der Hofausrichtung (drehen mit, `viewOf(o, r)`). Niedrige Stufen sind flach wie Boden, hohe Halme und Apfelbäume verdecken Figuren wie Bäume.
- Ein Klick auf ein Beet wählt den Hof.
- `UnitDef.animSprite` gibt einer Arbeitsanimation eine eigene Figur: Bauer mit Hacke beim Umgraben, mit Saatbeutel beim Säen. Ein Figurenblatt kennt nur eine Aktion.
- `UnitDef.carrySprite` gibt der getragenen Ware eine eigene Figur: Bauer mit Garbe; der Obstbauer trägt seinen Korb selbst.
- Der Hofstapel zeigt sich in den Varianten des Hofsprites (Garben-Hocken bzw. Apfelkörbe an den Ecken). In der Kornkammer stehen Äpfel als eigener Stapel.

**Grafik:** Blender-Pipeline, Stil „vorgerendert“, Seeds 400–407.
- Getreidehof (Fachwerk, Strohdach, Heuboden, Hof leer/halb/voll), Baustelle, Gerüst
- Obstgarten (Bohlenhütte mit Leiter, Körbe), Baustelle
- Getreidebeet in 6 Stufen, Apfelbaum in 4 Stufen, Stapel Äpfel
- Figuren: Bauer (Sichel, Ernten), Bauer mit Hacke, Bauer beim Säen, Bauer mit Garbe, Obstbauer (Pflücken), Träger mit Apfelkorb
- Neue Gebäudefarben am Ende von `palette.json`: Ackerboden, Weizen, Keim, Apfel, Blüte

**Oberfläche:**
- Kopfleiste: Zelle „Nahrung“ mit Vorrat und Verbrauch je Minute. Sie warnt bei Hunger und wenn der Vorrat unter einer Minute liegt; der Tooltip nennt Sorten, Ration und Reichweite.
- Hof-Panel: „Felder“ mit Beeten je Stufe, was der Bauer dort tut, Grund des Stillstands und Ernte insgesamt.
- Kornkammer-Panel: „Ernährung“ mit Vorrat, Verbrauch, Reichweite und den drei Rationen als Knöpfe.

## Folgen
- Eine neue Feldfrucht ist ein Eintrag in `CROPS` mit Sprite (Varianten = Stufen). Ein neuer Hof ist ein Gebäude mit `fields`, Zyklus `farm` und `output`. Eine neue essbare Ware ist ein Eintrag in `FOOD.goods`. Panel, Kopfleiste, Disponent und Speichern brauchen keine Änderung.
- Gegessen wird ohne Figuren, die zur Kornkammer laufen; sichtbar ist es nur am schrumpfenden Bestand in den Fächern. Das ist eine bewusste Vereinfachung (Leistung, Disponent).
- Hunger trifft nur untätige Tagelöhner. Arbeiter und Soldaten bleiben, kämpfen und arbeiten ungemindert.
- Getreide ist kein Essen; es muss erst durch Mühle und Bäckerei. Wer nur Getreidehöfe baut, hungert trotz voller Kornkammer. Äpfel sind die schnelle, schwächere Quelle.
- Die Balance ist vorläufig:
  - Getreidehof mit 6 bis 12 Beeten: etwa 4–5 Getreide je Minute
  - Obstgarten: etwa 3 Äpfel je Minute
  - Verbrauch bei 10 Bewohnern und normaler Ration: 4 je Minute
  - Der Startvorrat (40 Brot, 40 Getreide) reicht im Standardspiel über die ersten Minuten (Test).
- Tests:
  - `tests/sim/nahrung.test.ts`:
    - Daten
    - Platzierung auf Wiese in allen vier Ausrichtungen
    - sichtbare Feldarbeit nur mit Bauer am Beet
    - voller Hof, Obstgarten
    - ganze Kette bis zum Verbrauch mit Mengenerhalt
    - Verbrauchsrate, Hunger mit Fortgang und Ende
    - Standardspiel ohne Hunger, Abriss
    - Speichern/Laden, alte Spielstände
    - Disponent
  - `tests/render/landwirtschaft.test.ts`: Beet-Varianten in allen Hof- und Kameradrehungen, Figurenwechsel.
