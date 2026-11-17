# Bildgenerierung über Codex

Übernommen aus *crownward*. Aufruf aus dem Projektordner:

```sh
python3 tools/codex-imagegen.py --prompt-file art/prompts/NAME.txt --out assets/NAME.png
```

- `--transparent` für Sprites und Freisteller.
- Bestehende Dateien werden nie überschrieben; Revisionen bekommen einen neuen Dateinamen.
- Ausgabe nur als PNG unter `assets/` oder `public/assets/`.
- Das Skript ruft `codex exec --enable image_generation` mit der vorhandenen ChatGPT-Anmeldung auf. Es wird kein API-Key gelesen oder ausgegeben.
- Logs und Berichte liegen in `.local/art-runs/` (von git ignoriert). Aufrufe werden per Lock nacheinander abgearbeitet und können mehrere Minuten dauern, deshalb im Hintergrund starten.
- Ein Bild gilt erst als vorhanden, wenn das Skript erfolgreich endet und JSON mit Pfad und Maßen ausgibt. Bild vor der Verwendung ansehen.

Für PROJECT: MEDIEVAL KINGDOMS eignet sich das vor allem für **Konzeptbilder, Stimmungsbilder und UI-Texturen**. Spielfertige Sprites mit vier Drehansichten und Animationsframes brauchen eine eigene Pipeline (siehe `docs/concept/07-art-direction.md`).
