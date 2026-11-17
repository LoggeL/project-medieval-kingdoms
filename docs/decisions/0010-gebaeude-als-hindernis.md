# 0010 – Gebäude als feste Hindernisse, Zugang über Türkacheln

**Status:** angenommen (17.11.2026). Beim Zusammenführen mit dem geschlossenen Lagerhaus (ADR 0005), dem Bergfried (ADR 0006) und den Baustellen (ADR 0009) zu einem gemeinsamen Türmodell vereinheitlicht.

## Kontext
Im Prototyp liefen Figuren über die Stapel des offenen Lagerplatzes (sein Grundriss war ganz begehbar, Träger standen auf einem beliebigen Nachbarfeld des Stellplatzes), schnitten im Belagerungsmodus Diagonalen zwischen zwei Gebäudeecken und wurden beim Auseinanderschieben diagonal an Ecken vorbeigedrückt. Baustellenmaterial lag auf dem Feld vor der Tür, also mitten im Weg. Dazu kam ein Sortierfehler: Eine Figur dicht hinter einer Wand wurde vor das Gebäude gezeichnet, weil ihre Sortierbox in den Grundriss ragte.

Unabhängig davon hat ADR 0005 den Lagerplatz durch ein geschlossenes Lagerhaus mit Tor ersetzt und dafür eine eigene Zugangskachel (`BuildingDef.access`) eingeführt.

## Optionen
1. Lagerhof begehbar lassen und nur belegte Stellplätze sperren: Hintere Stapel sind dann nur über volle vordere erreichbar, das Lager würde je nach Füllstand anders begehbar.
2. Ganzen Grundriss sperren, Zugang über eine Türkachel aus den Daten. Liegt die Tür im Grundriss (offene Einfahrt), bleibt nur sie begehbar.
3. Ganzen Grundriss sperren, Ware über den Zaun von außen reichen.

## Entscheidung
Option 2, als ein Türmodell für alle Gebäude.
- `BuildingDef.door` (Modellachsen ab Grundrissmitte, dreht mit der Ausrichtung, gilt für alle Ausbaustufen) beschreibt die Tür. Es ersetzt `access` aus ADR 0005. Alle Gebäude mit Tür tragen den Eintrag: Lagerhaus (`[0, −2]`, vor dem Tor), Bergfried (`[0, −2]`, Stufe 1 bis 3; ab Stufe 2 führt dieselbe Tür auf die Wehrplattform), Holzfällerhütte, Steinbruch, Kaserne, Wohnhaus und Mauerturm. Fehlt der Eintrag, liegt die Tür mittig vor der Vorderkante.
- `geom.entrance` liefert die Tür, `geom.approach` den Vorplatz davor (bei einer Einfahrt im Grundriss den ersten Tile außerhalb), `geom.doorInside` sagt, ob die Tür im Grundriss liegt. Zurzeit liegt sie bei keinem Gebäude im Grundriss; das Modell und die Tests (mit einer Testtür) halten den Fall bereit.
- Das Laufraster sperrt jeden Grundriss ganz, auch den der Baustellen, des Lagerhauses und des Bergfrieds; ausgenommen sind nur Tor (für eigene Leute), Fuß der Treppe und eine Tür im Grundriss am fertigen Gebäude. Diagonalen an gesperrten Ecken sind verboten, auch im Belagerungsmodus und beim Auseinanderschieben.
- Lagergänge (`goalSlot`) führen auf die Tür des Lagerhauses. Von dort geht der Träger durchs Tor den Mittelgang entlang an sein Fach und schaut es an (`storeVisit`, ADR 0005); nur dann ist er im Grundriss (`Unit.inside`).
- Nichts darf auf den Vorplatz einer Tür gebaut werden (auch keine Mauer), damit kein Gebäude nur „durch die Wand“ erreichbar wird. Das gilt auch für den Bergfried.
- Baumaterial liegt im Grundriss (`construction.piles`, ADR 0009), beim Ausbau des Bergfrieds an den vorderen Ecken links und rechts der Tür, nie auf der Zugangskachel.
- Tiefensortierung: Ragt nur die Sortierbox einer Figur von hinten in ein Gebäude (Fußpunkt dahinter), wird sie vor dem Gebäude gezeichnet, also verdeckt.

## Folgen
Alle Träger eines Gebäudes teilen sich eine Tür; ohne Ausweichen zwischen Figuren stehen sie dort zeitweise übereinander. Bäume bleiben begehbar (Wald ist Gelände, kein Gebäude). Die Tests in `tests/sim/wegfindung.test.ts` prüfen Wege um alle Gebäude der Daten in allen vier Ausrichtungen (den Bergfried in allen drei Stufen), den Zugang über die Tür, den Gang durchs Lagerhaus-Tor und einen Langzeitlauf von 9000 Ticks je Seed.
