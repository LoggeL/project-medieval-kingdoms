# 0002 – Koordinaten und Drehung

**Status:** entschieden (17.11.2026), umgesetzt in `src/sim/geom.ts`.

## Kontext
Drehung ist laut Briefing echte Logik. Simulation, Darstellung und Blender-Sprites müssen denselben Drehsinn haben, sonst landen Posten, Eingänge und Mauerteile spiegelverkehrt.

## Entscheidung
- **Welt ist die Wahrheit.** Tile `(x, y)`, Einheiten in Bruchteilen von Tiles, Höhe in Höhenstufen (16 px, 1,04 m). Laufebenen 0 Boden, 1 Wehrgang (Höhe 3), 2 Turmplattform (Höhe 5).
- **Kamera:** Drehung `r ∈ {0..3}` nach der Tabelle in Kapitel 09 §3, Projektion `bildX = (u − v) · 32`, `bildY = (u + v) · 16 − z · 16`.
- **Sprites:** Raster-u = Modell +x, Raster-v = Modell −y. Ansicht `d` zeigt das Modell um `d · 90°` gegen den Uhrzeigersinn gedreht. Ein Gebäude mit Ausrichtung `o` zeigt die Ansicht `(o − r) mod 4`.
- **Versätze** in Modellachsen (Posten, Lager-Slots, Eingang) gehen mit `modelToWorld(mx, my, o) = turn(mx, −my, o)` in die Welt.
- **Vorderseite** eines Gebäudes ist Modell −y (Tür); der Eingangs-Tile liegt davor.
- **Mauern** speichern ihre Nachbarschaft in Welt-Richtungen (Bit 0 N, 1 O, 2 S, 3 W). `wallPiece(mask)` wählt Teil (gerade, Ende, Ecke, T, Kreuz, einzeln) und Ausrichtung; die Darstellung rechnet daraus wie bei jedem Gebäude die Ansicht.
- **Figuren** speichern ihre Blickrichtung als Welt-Vektor; die Darstellung projiziert ihn und wählt eine der 8 Bildrichtungen.

## Folgen
Eine Funktion pro Frage, von Simulation und Darstellung gemeinsam benutzt, mit Tests (`tests/geom.test.ts`). Die Konzeptseite (`tools/konzeptseite/bauten.js`) rechnet nach denselben Formeln.
