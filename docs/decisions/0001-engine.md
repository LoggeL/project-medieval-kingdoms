# 0001 – Engine / Framework

**Status:** Plattform entschieden: **Browser** (Logge, 17.11.2026, vorerst). Framework **TypeScript + PixiJS + Vite** für den Prototyp angenommen (17.11.2026, Details in [0003](0003-prototyp-architektur.md)).

## Kontext
2D-Isometrie mit echter 90°-Drehung, mehrere Zoomstufen, große Karten, hunderte gleichzeitig animierte Figuren, mehrschichtige Pfadfindung (Boden und Wehrgänge), datengetriebene Inhalte, Speichern. Die Simulation muss ohne Renderer testbar sein. Weder Godot noch Phaser bringen eine drehbare Iso-Ansicht mit, der Iso-Renderer wird in jedem Fall selbst gebaut.

## Optionen
| | TypeScript + PixiJS (WebGL) | Godot 4 (GDScript/C#) | Unity / C# |
|---|---|---|---|
| Teilen mit Sebastian | Link im Browser, sofort spielbar | Export (Desktop oder Web) | Export |
| Viele Sprites | Sehr gut (Batching) | Gut | Gut |
| Iso + Rotation | Eigenbau (volle Kontrolle) | TileMap hilft kaum bei Drehung, ebenfalls Eigenbau | Eigenbau |
| Sim ohne Renderer testen | Einfach (reines TS, Vitest) | Möglich, umständlicher | Möglich |
| Werkzeuge / Editor | Selbst bauen | Integrierter Editor | Integrierter Editor |
| Desktop-Release | Tauri oder Electron | Nativ | Nativ |
| KI-gestützte Entwicklung | Sehr gut | Gut | Gut |

## Vorschlag
**TypeScript + PixiJS v8 + Vite**, Simulation als eigenständiges, renderer-freies TS-Modul (optional im Web Worker). Begründung: schnelle Iteration, Browser-Prototyp für Sebastian sofort teilbar, gute Testbarkeit, volle Kontrolle über den sowieso nötigen eigenen Iso-Renderer. Später Desktop-Build über Tauri möglich.

## Entscheidung Plattform (17.11.2026)
Prototyp und Tests laufen im Browser. Ein Desktop-Build bleibt später möglich (Tauri oder Electron). Die Wahl von PixiJS gegenüber anderen Web-Renderern ist damit naheliegend, aber noch nicht festgezurrt.

## Offene Punkte
- Reicht die Browser-Performance bei z. B. 1000+ Figuren? → früher Lasttest im Prototyp.
- Brauchen wir einen visuellen Karteneditor früh, der in Godot gratis wäre?
