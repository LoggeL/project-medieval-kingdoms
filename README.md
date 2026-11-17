# PROJECT: MEDIEVAL KINGDOMS

Isometrisches 2D-Pixelart-Echtzeitstrategiespiel vom Hochmittelalter bis zur frühen Pike-and-Shot-Zeit. Es verbindet Wirtschaftssimulation, Städtebau, Burgenbau und klassisches RTS. Leitprinzip: **Die Welt lebt.** Jede Ware wird sichtbar produziert, getragen und eingelagert, jede Mauer ist begehbar und verteidigbar.

Idee und Anforderungen: Sebastian (Auftraggeber). Das vollständige Briefing steht in [BRIEF.md](BRIEF.md).

## Stand

Erster spielbarer Prototyp nach Briefing §14 (Browser, TypeScript + PixiJS). Aktueller Stand: [docs/STATUS.md](docs/STATUS.md).

```bash
npm install
npm run dev      # Spiel unter http://localhost:5173/
npm test         # Vitest
```

## Aufbau

| Pfad | Inhalt |
|---|---|
| [BRIEF.md](BRIEF.md) | Original-Briefing, verbindliche Anforderungen |
| [docs/concept/](docs/concept/README.md) | Spiel- und Technikkonzept in Kapiteln |
| [docs/decisions/](docs/decisions/README.md) | Architektur- und Designentscheidungen (ADRs) |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Meilensteine vom Konzept zum Prototyp |
| [docs/STATUS.md](docs/STATUS.md) | Laufender Projektstand |
| `art/prompts/` | Prompts für generierte Bilder |
| `art/reference/` | Referenz- und Stimmungsbilder |
| `src/` | Spielcode: `data` (Definitionen), `sim` (Simulation ohne DOM), `render` (PixiJS), `ui`, `app` |
| `tests/` | Automatisierte Tests (Vitest) |
| `assets/` | Grafiken aus der Blender-Pipeline, UI-Texturen, Audio |
| [tools/](tools/IMAGEGEN.md) | Hilfsskripte: Blender-Pipeline, Audio ([tools/audio/](tools/audio/README.md)), Bildgenerierung über Codex, kopfloser Testbrowser |

## Lizenz

Alle Rechte vorbehalten, siehe [LICENSE](LICENSE). Das Repository ist öffentlich lesbar, aber nicht Open Source.
