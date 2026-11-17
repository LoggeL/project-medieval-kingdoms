#!/usr/bin/env python3
"""Forschungs-Ikonen aus dem Codex-Bild schneiden (art/ui-quelle/forschung_ikonen.png, Raster 4 × 2).

Jede Zelle: Alpha hart machen (Codex liefert die Ikonen mit Alpha um 250 und einem leichten Schleier), Umriss
zuschneiden, quadratisch einpassen, auf 96 × 96 verkleinern und nebeneinander nach assets/ui/forschung.png legen.
Spalte i = TechDef.icon (src/data/research.ts).

    python3 tools/ui/forschung_ikonen.py
"""
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "art/ui-quelle/forschung_ikonen.png"
OUT = ROOT / "assets/ui/forschung.png"
COLS, ROWS, SIZE, PAD = 4, 2, 96, 4


def main() -> None:
    im = Image.open(SRC).convert("RGBA")
    a = np.array(im)
    a[:, :, 3] = np.where(a[:, :, 3] >= 100, 255, 0)
    W, H = im.size
    sheet = Image.new("RGBA", (SIZE * COLS * ROWS, SIZE), (0, 0, 0, 0))
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
