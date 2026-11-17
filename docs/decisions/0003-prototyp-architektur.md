# 0003 – Architektur des ersten Prototyps

**Status:** entschieden (17.11.2026).

## Entscheidung
- **TypeScript + PixiJS 8 + Vite**, Tests mit Vitest (ADR 0001 damit festgezurrt).
- **Schichten:** `src/data` (Definitionen), `src/sim` (Spiellogik ohne DOM und Pixi, 20 Ticks pro Sekunde, deterministisch), `src/render` (Pixi: Projektion, Drehung, Sortierung, Sprites), `src/ui` (DOM-Oberfläche), `src/app` (Spielschleife, Eingabe, Brücke).
- **Vertrag:** `src/sim/types.ts` (Zustand, Befehle, Prüfungen) und `src/app/contract.ts` (Brücke zur Oberfläche). Die Oberfläche liest den Zustand und schickt Befehle, sie verändert ihn nie direkt.
- **Grafik:** dieselben Blätter wie die Konzeptseite (`assets/figures`, `assets/buildings`, neu `assets/terrain`), Stil „Vorgerendert“. Vite liefert `assets/` als statisches Verzeichnis aus.
- **Arbeitszyklen als Daten** (`BUILDINGS[..].workers.cycle`), interpretiert von der Simulation.

## Folgen
Simulation, Darstellung und Oberfläche lassen sich getrennt bauen und testen. Neue Gebäude und Einheiten sind Daten plus Grafik.
