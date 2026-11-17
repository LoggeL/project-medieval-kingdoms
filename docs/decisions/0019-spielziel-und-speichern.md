# 0019 – Spielziel, Schwierigkeit und Spielstände

**Status:** angenommen (17.11.2026). Erstes Spielziel der Partie, Speichern und Laden in der Oberfläche, Spielstand-Version 3.

## Kontext
Bis hier hatte die Partie kein Ziel: Die Überfälle kamen ohne Ende, nur der Fall des Bergfrieds beendete sie (Niederlage). Speichern gab es nur in der Simulation (`Simulation.save`/`loadGame`, im Spiel über die Konsole). Ein Spieler konnte also weder gewinnen noch aufhören und später weiterspielen. Dazu kamen Befunde aus der Prüfung der Oberfläche:
- Das Ziel war nirgends dauerhaft zu sehen.
- Die Kopfleiste zeigte den Bestand mit den für Baustellen, Forschung und Rekruten verplanten Waren. Wer danach plante, wunderte sich über „zu wenig Holz“.
- Eine Ausbildung ließ sich nicht abbrechen.
- Meldungen verschwanden nach wenigen Sekunden aus der Chronik.

Sieben weitere Zweige bauen gleichzeitig am Zustand (Gelände, Nahrung, Rüstung, Transport, Leben, Belagerung, Befehle). Ein Spielstand muss ihre neuen Felder mitnehmen, ohne dass jemand eine Feldliste pflegt.

## Optionen
**Spielziel**
1. *Abgewehrte Überfälle* („Halte die Siedlung, bis N Wellen abgewehrt sind“): nutzt die bestehende Kernschleife (Wirtschaft → Befestigung → Mauerverteidigung). Dazu reicht ein Zähler, es braucht keine neuen Sprites und keine neue KI.
2. *Gegnerlager zerstören:* bräuchte ein Lager mit eigenen Gebäuden und Sprites, eine angreifbare KI-Basis, Wegfindung über die Karte und eigene Balance. Das ist ein eigener Zweig.
3. *Ausbauziel* (Bergfried Stufe N, Bevölkerung N): allein zu friedlich, die Mauerverteidigung (§4.3 des Briefings) bliebe optional.

**Speichern im Browser**
1. *Nur localStorage:* einfach, aber etwa 5 MB je Herkunft, synchron (Ruckler beim automatischen Speichern) und in manchen Browsern im privaten Modus gesperrt.
2. *IndexedDB mit Rückfall:* asynchron, viel Platz; Rückfall auf localStorage, dann auf den Arbeitsspeicher der Sitzung.

## Entscheidung
Spielziel Option 1, Speichern Option 2.

**Daten** (`src/data/spielziel.ts`):
- `SCENARIOS`: ein Szenario „Das Tal halten“ mit `sieg: VictoryGoal[]`. `VictoryGoal` ist `{ wellen: n }` (abgewehrte Überfälle) oder `{ stufe: n }` (Ausbaustufe des Sitzes). Weitere Zielarten sind ein neuer Eintrag in der Vereinigung und ein Fall in `goalProgress`. Das Standardszenario verlangt 5 Wellen.
- `DIFFICULTIES` leicht/normal/schwer: Startgold, Überschreibungen für `START.raid` (erste Welle, Abstand, Größe, Zuwachs) und ein Faktor auf die Lebenspunkte der Angreifer. „Normal“ ist genau `START`, sodass bestehende Tests und Balance unverändert gelten.
- `SAVE_SLOTS`: `auto`, `schnell`, `platz1` bis `platz3`. `AUTOSAVE_SECONDS` = 120 Spielsekunden.

**Simulation:**
- `SimState.match` (`src/sim/match.ts`): Szenario, Schwierigkeit, Schritt der Einführung, `endTick` und `stats`. Die Statistik umfasst Wellen, besiegte Angreifer, gefallene Soldaten und Arbeiter, zerstörte, errichtete und ausgebildete Einheiten bzw. Gebäude sowie erzeugte Waren je Ware.
- Die Zähler hängen an genau einer Stelle der Mechanik:
  - Tod in `combat.kill`
  - Zerstörung in `build`
  - Fertigstellung einer Baustelle
  - Ende der Ausbildung
  - Ende einer Welle in `raid`
  - erzeugte Waren, wenn ein Träger sie von einem Hof- oder Ausgabestapel ins Lager bringt (`runHaul`, `j.from ≠ 0`)

  Neue Erzeuger anderer Zweige zählen damit ohne Änderung mit, solange ihre Ware über einen Stapel getragen wird. Rückgaben bei Abriss zählen nicht.
- Sieg (`updateMatch`): Alle Ziele sind erfüllt und kein Angreifer ist mehr auf der Karte. Dann `outcome = "sieg"`, `endTick` und eine Meldung. Danach kommen keine Wellen mehr, Wirtschaft und Zuzug laufen weiter („Weiterbauen“). Die Niederlage bleibt wie bisher der Fall des Sitzes, jetzt mit `endTick`.
- `SimState.free`: frei verfügbare Menge je Ware (Bestand minus verplant), dieselbe Rechnung wie `storage.available`. Kopfleiste, Baukarten und Rekrutieren zeigen und prüfen diese Zahl.
- Befehl `ausbildung_abbrechen { building, index }`: `index` −1 bricht die laufende Ausbildung ab, sonst einen Platz der Warteschlange. Das Gold kommt zurück. Holt der Tagelöhner die Waffe noch, wird der Auftrag freigegeben. Hat er sie schon oder steht er in der Ausbildung, kommt er als Tagelöhner heraus und trägt die Waffe sichtbar ins Lager zurück.

**Spielstand:**
- Format `{ v, state, meta }`, jetzt `SAVE_VERSION` 3. `src/sim/migrate.ts` führt eine Kette `MIGRATIONS[v]` (v → v+1). Version 2 bekommt ein `match` aus der Einführung von damals (Szenario „tal“, normal, Statistik leer).
- Was nicht geladen werden kann, wird mit einem Spielertext abgelehnt: kein JSON, kein Spielstand, älter als `OLDEST_LOADABLE`, neuer als das Spiel.
- `Simulation.restore(json)` lädt an Ort und Stelle: Die Welt wird ersetzt, Spielschleife, Eingabe, Brücke und Audio behalten ihre Verweise. `main.ts/afterLoad` setzt Auswahl, Gruppen, Darstellungsspuren (Trümmer, Bauphasen) und Ansagen zurück und richtet die Kamera auf das Lager.
- **Rundreisetest über den ganzen Zustand** (`tests/sim/speicher.test.ts`), ohne Feldliste:
  1. Ein datengetriebener Treiber spielt drei Partien (je Schwierigkeit) mit allen baubaren Gebäuden aus `BUILDINGS`, allen Rezepten, Techniken und ausbildbaren Einheiten, mit Mauern, Überfällen, Befehlen, Abriss und Abbrüchen.
  2. Alle 30 Sekunden prüft er: Zustand und Meta sind reines JSON (keine Map, kein Set, keine Klasse, kein NaN, kein geteiltes Objekt außer den unveränderlichen Pfaden aus dem Pfad-Cache). Danach speichert er, lädt und lässt Original und Kopie mit denselben Befehlen weiterlaufen. Der gesamte Baum muss gleich bleiben, bei Abweichung nennt der Test die Pfade.
  3. `World` und `Simulation` dürfen keine eigenen Felder außerhalb von Zustand und Meta tragen (`DERIVED`). Ein neues Feld eines anderen Zweigs fällt also entweder in die Prüfung oder bricht diesen Test.

**Ablage** (`src/app/saves.ts`, `src/app/spielstand.ts`):
- IndexedDB, Datenbank `medieval-kingdoms` mit den Speichern `info` (Übersicht `SaveInfo` je Platz) und `daten` (der Spielstand). Menüs lesen nur die Übersicht.
- Rückfall auf localStorage (`mk-save-<platz>`, `mk-save-index`), danach auf den Arbeitsspeicher. Jeder Zugriff ist abgesichert, ein voller Speicher kommt als Spielertext zurück, und ein halb geschriebener Platz wird entfernt.
- Das Öffnen von IndexedDB darf dauern: Das Spiel wartet nicht darauf, die Sitzung hält ein Promise. Erst nach 30 s gilt die Datenbank als hängend, und auch dann nur, wenn ihr Erfolg nicht schon in der Ereignisschleife wartet. In der Prüfung lag das Spiel beim Laden 15 bis 25 s im Hauptthread, eine Grenze von 3 s verteilte die Stände auf zwei Ablagen.
- `adoptSaves` übernimmt beim nächsten Start Stände aus einer Ausweich-Ablage; je Platz gewinnt der neuere.
- `SaveSession` speichert, lädt (`restore` + `afterLoad`) und speichert automatisch alle 120 Spielsekunden auf „auto“. Fehler beim automatischen Speichern erscheinen als Warnung, das Spiel läuft weiter.

**Oberfläche** (nur über die `UiBridge`, `bridge.saves`, `bridge.toTitle`, Ereignisse `menu` und `loaded`):
- *Titel:*
  - „Fortsetzen“ (neuester Stand gleich welchen Platzes; nur sichtbar, wenn es einen gibt, dann oben mit Fokus)
  - „Neues Spiel“ (Tafel mit Szenariotext und Schwierigkeit)
  - „Laden“ (Plätze mit Spielzeit, Welle, Schwierigkeit, Ausgang, Alter)
- *Spielmenü:* Esc, wenn weder Werkzeug noch Auswahl aktiv ist, oder ☰ in der Kopfleiste. Es pausiert und bietet Speichern, Laden, Einstellungen (Klang) und Hauptmenü (speichert vorher auf „auto“). Überschreiben eines belegten Platzes braucht einen zweiten Klick.
- *Schnellspeichern:* F8 (`APP_KEYS.schnellspeichern`). Schnellladen gibt es bewusst nicht: Laden geht über das Menü, damit ein Fehlgriff keine Partie verwirft.
- *Aufgabenleiste* links über der Chronik: Szenario, Fortschritt (Rauten), der aktuelle Schritt der Einführung, einklappbar und mit Knopf „Verlauf“.
- *Meldungsverlauf:* alle Meldungen der Partie (bis 300), Filter Kampf/Warnungen/Hinweise.
- *Tafel am Ende:* Sieg oder Niederlage mit Statistik und erzeugten Waren, „Weiterbauen“ bzw. „Weiter zusehen“ und „Hauptmenü“.
- *Kopfleiste:* freie Menge je Ware, verplante Menge als kleines Schild „+n“ (Tooltip: frei, verplant, im Lager). Damit Menüknopf und Überfall-Anzeige in jede Breite passen, gilt bis 1919 px die kurze Form „Überfall 4:59“ ohne Zoomzahl. Der Waffenvorrat erscheint ab 1440 px, der Nahrungsvorrat ab 1700 px (vorher 1366 bzw. 1600 px).
- *Ausbildung im Panel:* × an der laufenden Ausbildung und an jedem Platz der Warteschlange.

## Folgen
- Neue Zustandsfelder anderer Zweige müssen reines JSON sein. Der Rundreisetest prüft das ohne Anpassung; ein abgeleitetes Feld an `World` gehört nach `DERIVED`.
- Ändert ein Zweig das Format, erhöht er `SAVE_VERSION` und ergänzt `MIGRATIONS` (Test für den Schritt in `speicher.test.ts`).
- Neue Erzeuger zählen in der Statistik, wenn ihre Waren über einen Stapel getragen werden. Wer Waren direkt bucht, muss `noteProduced` aufrufen.
- Die Balance der Schwierigkeitsgrade ist nur durch Tests (Wellen, Gold, Lebenspunkte) und nicht von Hand erspielt. Ob fünf Wellen als Ziel richtig sind, ist offen.
- Ein Gegnerlager als zweites Szenario braucht einen eigenen Zweig (Sprites über die Pipeline, KI).
- Das automatische Speichern läuft synchron (`JSON.stringify` des Zustands) und kann auf großen Karten kurz ruckeln.
- IndexedDB ist nur in Chrome (kopflos) geprüft, Safari und private Fenster nicht.
