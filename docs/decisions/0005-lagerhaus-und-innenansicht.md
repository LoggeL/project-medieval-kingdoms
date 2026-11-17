# 0005 – Geschlossenes Lagerhaus und Innenansicht

**Status:** entschieden (17.11.2026, Wunsch Logge: Lager als geschlossenes Haus, das man vorne betritt; beim Überfahren in Gebäude hineinsehen).

## Kontext
Das BRIEF verlangt, dass eingelagerte Waren sichtbar sind („Ein Lagerhaus, das nur eine Zahl zeigt, reicht nicht“). Der bisherige offene Lagerplatz erfüllte das direkt: Stapel standen im Freien, Träger liefen quer über den Platz. Ein geschlossenes Haus verdeckt die Waren. Es braucht also einen anderen Weg, damit der Bestand weiter in der Welt sichtbar bleibt, und eine echte Regel, wie Figuren hinein- und herauskommen.

## Entscheidung
- **Zugang als Daten.** `BuildingDef.access` ist die Zugangskachel in Modellachsen ab Grundrissmitte (Lagerhaus: `[0, −2]`, vor dem Tor). `entrance()` dreht sie mit der Ausrichtung. Der Grundriss ist für die Wegesuche gesperrt, Träger laufen nur bis zur Zugangskachel. Die Kaserne und andere Gebäude nutzen denselben Weg ohne eigenen Sonderfall.
- **Hineingehen ist Simulation.** An der Zugangskachel tritt der Träger ein (`Unit.inside = Gebäude-ID`), geht den Mittelgang bis an sein Fach (`storeWalk`), tauscht die Ware dort (`TUNING.shelfSeconds`) und geht denselben Weg zurück vor das Tor. Ein- und ausgelagert wird nur am Fach. Figuren im Inneren sind kein Ziel für Angreifer und werden beim Abriss oder Abbruch vor das Tor gesetzt.
- **Fächer als Daten.** `storage.shelves` legt die Fachmitten fest (acht Fächer, Kapazität und Drosselung unverändert). Dieselben Werte stehen in `tools/blender/buildings/buildings.json` für das Schnittbild, ein Test hält beide gleich.
- **Sichtbarer Bestand an drei Stellen:**
  1. **Außen:** Kisten, Fässer und Säcke vor dem Tor zeigen den Füllstand des ganzen Lagers (5 Stufen, 0 nur bei wirklich leerem Lager).
  2. **Innenansicht:** Beim Überfahren und für das ausgewählte Gebäude blendet das Dach weich aus (180 ms, bei reduzierter Bewegung sofort). Das Schnittbild zeigt jede Ware als Stapel auf ihrem Fach in der echten Füllstufe, dazu die Träger, die gerade drinnen sind. Dasselbe gibt es für Holzfällerhütte (Hofstufe), Kaserne (Rekrut in Ausbildung am Übungsplatz) und Wohnhaus (Bewohner nach Bevölkerung).
  3. **Auswahlfeld:** Fächer mit Ware und Menge wie bisher.
- **Nur Darstellung.** Die Innenansicht (`SceneOptions.interiors`, `src/render/interior.ts`) liest den Simulationszustand und ändert ihn nie. Das Außenbild bleibt der Treffer, damit das Überfahren nicht flackert.
- **Grafik aus der Blender-Pipeline.** `lagerhaus` und die Schnittbilder `*_innen` (je Ansicht gebaut, Wände zur Kamera niedrig im Vorderteil `_front`) in den Seeds und Böden der Außenbilder. Die Warenstapel sind dieselben `stapel_*` wie zuvor auf dem Lagerplatz.
- **Startaufbau als Daten.** `START.buildings` legt fest, welche Gebäude zu Beginn stehen (relativ zur Startstelle der Karte). Weitere Startgebäude kommen dort als Eintrag dazu.

## Folgen
- Der Bestand ist weiter physisch: Jede Ware wird von einer Figur durch das Tor an ein Fach getragen und ist dort im Schnittbild zu sehen. Ohne Überfahren zeigt das Haus nur den Gesamtfüllstand, nicht jede Ware einzeln.
- Der Gang ins Haus kostet Zeit. Im Prototyp verlängert das die Wege: die Bauordnung in der Wirtschaftsmessung dauert etwa 160 statt 150 Sekunden.
- `lager_boden` (offener Platz) bleibt im Blatt, wird aber nicht mehr gezeichnet. Fehlt das Lagerhaus-Bild, nimmt die Darstellung das alte Füllstufenbild `lager`, fehlt auch das, stehen die Stapel frei an den Fächern.
- Die Konzepttexte unter `docs/concept/` nennen noch den „Lagerplatz“. Gemeint ist dort das Materiallager allgemein.
