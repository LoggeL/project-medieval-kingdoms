# 0008 – Zoomstufen, Pixeltreue und Tastenkürzel

**Status:** angenommen (17.11.2026, Wunsch Logge: mehr Zoomstufen und Tastenkürzel für die Aktionen unten).

## Kontext
Der Prototyp hatte vier Zoomstufen (0,5×, 1×, 2×, 3×), die sprunghaft wechselten. Pixelart verträgt nur ganzzahlige Faktoren ohne Verzerrung: Bei 1,5× mit nächstem Nachbarn werden Sprite-Pixel abwechselnd ein und zwei Bildschirmpixel breit, bei linearer Filterung verschwimmt das ganze Bild. Das Canvas rendert mit Auflösung 1 (ein Canvas-Pixel je CSS-Pixel) und wird vom Browser pixelig auf die Gerätepixel hochskaliert.

Die Knöpfe der Fußleiste und des Auswahlpanels waren nur mit der Maus erreichbar.

## Entscheidung

### Zoom
- **Acht Stufen** als Daten in `src/data/view.ts`: 0,25 · 0,5 · 0,75 · 1 · 1,5 · 2 · 3 · 4, Start bei 2×. Bei 0,25× passt die ganze 64 × 64-Karte in ein 1440 × 900-Fenster.
- **Sanfter Übergang** (160 ms, logarithmisch, abbremsend) zwischen zwei Stufen, der Punkt unter der Maus bleibt stehen. Mausrad, `+`/`−` und die Knöpfe oben nutzen denselben Weg. Bei `prefers-reduced-motion` springt der Zoom.
- **Zeichenweise je Stufe** (`pixelMode` in `src/render/camera.ts`), gewählt nach der angesteuerten Stufe, damit sich während des Übergangs nichts neu anlegt:
  - ganzzahlig (1, 2, 3, 4): Texturen nächster Nachbar, Auflösung 1, Canvas pixelig skaliert. Pixelgenau.
  - 1,5: Auflösung 2/1,5. Die Welt landet mit Faktor 2 im Canvas (pixelgenau), der Browser verkleinert das Canvas weich auf die Fenstergröße. Ergebnis: gleich große Pixelblöcke mit leicht weichen Kanten. Kostet etwa 1,8-mal so viel Füllarbeit wie 2×.
  - unter 1 (0,25, 0,5, 0,75): Texturen linear gefiltert, Auflösung 1, Canvas weich skaliert (wie die bisherige 0,5×-Übersicht).
- Der Welt-Ursprung wird auf ganze Canvas-Pixel gerundet (bei 1,5× also auf Dreiviertel-CSS-Pixel).

### Tasten
- **Belegung als Daten** in `src/data/hotkeys.ts` nach `KeyboardEvent.code` (physische Taste). `APP_KEYS` wertet die Eingabe aus (`src/app/input.ts`), die übrigen Tasten lösen Knöpfe aus (`src/ui/hotkeys.ts`). Ein Test prüft Eindeutigkeit und Kollisionsfreiheit.
- **Schema:** Bau-Reiter F2–F5, Baukarten des offenen Reiters nach ihrer Lage auf der unteren Buchstabenreihe (deutsch Y X C V B N M), danach im Reiter Militär die ausbildbaren Einheiten des Rasters, Ausbilden in der Kaserne U I O, Abriss Entf (am Mac auch ⌫). Stationieren T, Halten H und Auswahl Esc bleiben. Die Debug-Anzeige zieht von F3 auf F9.
- **Bergfried (seit ADR 0006):** Forschungsbaum F (Knopf „Forschung“ in der Fußleiste und im Bergfried-Panel; der Baum wertet F selbst aus und schließt sich damit auch wieder, die Knöpfe leuchten nur auf), Ausbau des gewählten Bergfrieds G (gesperrt meldet die Taste, was fehlt). „Forschung abbrechen“ bleibt ohne Taste, damit kein Fortschritt aus Versehen verfällt. Der Bergfried selbst (Kategorie `zentrum`) hat keinen Bau-Reiter.
- Jeder Knopf zeigt seine Taste auf einem Schild, das beim Drücken aufleuchtet; der Tooltip nennt sie. Die Aufschrift folgt dem gemeldeten Tastaturlayout (`navigator.keyboard.getLayoutMap`, nur Chromium), sonst QWERTZ.
- Keine Taste wirkt, solange ein Eingabefeld den Fokus hat oder eine Tafel (`aria-modal`, z. B. die Hilfe) offen ist. Gesperrte Knöpfe (`.mk-locked`, `disabled`) lösen nur ihre Sperr-Meldung aus (`data-locked`).

## Optionen, die verworfen wurden
- 1,5× mit nächstem Nachbarn bei Auflösung 1: ungleichmäßige Pixel, beim Schwenken flimmernd.
- 1,5× mit linearer Filterung: verschwommen.
- Mipmaps für 0,25×: nicht nötig, die Übersicht wirkt mit linearer Filterung ruhig genug.
- Reiter auf `Tab`: nimmt der Tastaturbedienung den Fokuswechsel; im Konzept ist `Tab` für die Durchsicht vorgesehen, `O` für Overlays. Beide bleiben frei.

## Folgen
Neue Zoomstufen oder Tasten sind Datenänderungen. Neue Gebäude eines Reiters bekommen ihre Taste automatisch über ihre Lage; mehr als sieben Karten in einem Reiter schlägt der Test an. F-Tasten brauchen auf Mac-Laptops je nach Einstellung `fn`.
