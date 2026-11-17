# 0005 – Gebäude als feste Hindernisse, Zugang über Türkacheln

**Status:** angenommen (17.11.2026).

## Kontext
Im Prototyp liefen Figuren über die Stapel des Lagerplatzes (sein Grundriss war ganz begehbar, Träger standen auf einem beliebigen Nachbarfeld des Stellplatzes), schnitten im Belagerungsmodus Diagonalen zwischen zwei Gebäudeecken und wurden beim Auseinanderschieben diagonal an Ecken vorbeigedrückt. Baustellenmaterial lag auf dem Feld vor der Tür, also mitten im Weg. Dazu kam ein Sortierfehler: Eine Figur dicht hinter einer Wand wurde vor das Gebäude gezeichnet, weil ihre Sortierbox in den Grundriss ragte.

## Optionen
1. Lagerhof begehbar lassen und nur belegte Stellplätze sperren: Hintere Stapel sind dann nur über volle vordere erreichbar, das Lager würde je nach Füllstand anders begehbar.
2. Ganzen Grundriss sperren, Zugang über eine Türkachel aus den Daten. Liegt die Tür im Grundriss (Einfahrt), bleibt nur sie begehbar.
3. Ganzen Grundriss sperren, Ware über den Zaun von außen reichen.

## Entscheidung
Option 2.
- `BuildingDef.door` (Modellachsen ab Grundrissmitte, dreht mit der Ausrichtung) beschreibt die Tür. Fehlt der Eintrag, liegt sie mittig vor der Vorderkante. `geom.entrance` liefert die Tür, `geom.approach` den Vorplatz davor (bei einer Einfahrt im Grundriss den ersten Tile außerhalb), `geom.doorInside` sagt, ob die Tür im Grundriss liegt.
- Das Laufraster sperrt jeden Grundriss ganz; ausgenommen sind nur Tor (für eigene Leute), Fuß der Treppe und eine Tür im Grundriss am fertigen Gebäude. Die Einfahrt des Lagerplatzes ist von der Seite nicht zu betreten, weil Diagonalen an gesperrten Ecken auch im Belagerungsmodus verboten sind.
- Alle Lagergänge (`goalSlot`) führen auf die Tür; dort tritt die Figur zur Seite des Stapels und schaut ihn an.
- Nichts darf auf den Vorplatz einer Tür gebaut werden (auch keine Mauer), damit kein Gebäude nur „durch die Wand“ erreichbar wird.

## Folgen
Ein geschlossenes Lagerhaus mit Vordertür braucht nur einen anderen `door`-Eintrag (vor der Vorderkante) und eigene Stellplätze; Wegfindung, Platzierung und Tests gelten unverändert. Alle Träger eines Lagers teilen sich eine Tür; ohne Ausweichen zwischen Figuren stehen sie dort zeitweise übereinander. Bäume bleiben begehbar (Wald ist Gelände, kein Gebäude).
