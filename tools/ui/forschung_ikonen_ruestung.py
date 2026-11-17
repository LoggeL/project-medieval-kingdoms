#!/usr/bin/env python3
"""Forschungs-Ikonen der Militärwirtschaft aus dem Codex-Bild schneiden (art/ui-quelle/forschung_ikonen_ruestung.png,
Raster 2 × 2, Prompt art/prompts/forschung_ikonen_ruestung.txt).

Wie tools/ui/forschung_ikonen.py: Alpha hart machen (Codex legt einen weichen Schein um jede Ikone, der bleibt unter der
Schwelle weg), Umriss zuschneiden, quadratisch einpassen, auf 96 × 96 verkleinern und nebeneinander nach
assets/ui/forschung_ruestung.png legen. Das Blatt hat wie forschung.png 8 Spalten (die Oberfläche rechnet mit 8), die
Spalten 4–7 bleiben leer. Spalte i = TechDef.icon mit TechDef.iconSheet = "forschung_ruestung" (src/data/ruestung.ts).

    python3 tools/ui/forschung_ikonen_ruestung.py
"""
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "art/ui-quelle/forschung_ikonen_ruestung.png"
OUT = ROOT / "assets/ui/forschung_ruestung.png"
COLS, ROWS, SIZE, PAD, SHEET_COLS = 2, 2, 96, 4, 8
# Reihenfolge im Blatt: Rennofen, Armbrustbau, Kettenschmiede, Gewalthaufen (Zeilen des Codex-Bildes)


def main() -> None:
    im = Image.open(SRC).convert("RGBA")
    a = np.array(im)
    a[:, :, 3] = np.where(a[:, :, 3] >= 200, 255, 0)
    W, H = im.size
    sheet = Image.new("RGBA", (SIZE * SHEET_COLS, SIZE), (0, 0, 0, 0))
    for r in range(ROWS):
        for c in range(COLS):
            x0, x1, y0, y1 = int(c * W / COLS), int((c + 1) * W / COLS), int(r * H / ROWS), int((r + 1) * H / ROWS)
            cell = a[y0:y1, x0:x1]
            ys, xs = np.where(cell[:, :, 3] > 0)
            crop = Image.fromarray(cell[ys.min():ys.max() + 1, xs.min():xs.max() + 1])
            side = max(crop.size)
            sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
            sq.paste(crop, ((side - crop.size[0]) // 2, side - crop.size[1]))  # unten bündig wie die Sprite-Ikonen
            small = sq.resize((SIZE - 2 * PAD, SIZE - 2 * PAD), Image.LANCZOS)
            s = np.array(small)
            s[:, :, 3] = np.where(s[:, :, 3] >= 128, 255, 0)
            sheet.paste(Image.fromarray(s), ((r * COLS + c) * SIZE + PAD, PAD))
    sheet.save(OUT, optimize=True)
    print(OUT, sheet.size)


if __name__ == "__main__":
    main()
