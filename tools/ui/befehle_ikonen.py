#!/usr/bin/env python3
"""Befehls-Ikonen aus dem Codex-Bild schneiden (art/ui-quelle/befehle_ikonen.png, Raster 5 × 2).

Wie tools/ui/forschung_ikonen.py: Alpha hart machen, Umriss zuschneiden, quadratisch einpassen (hier mittig, die
Formationen sind flach), auf 64 × 64 verkleinern und nebeneinander nach assets/ui/befehle.png legen.
Spalte i = Ikone in COMMANDS, FORMATIONS und STANCES (src/data/befehle.ts):
0 Stationieren, 1 Stellung halten, 2 Patrouille, 3 Angriffsbewegung, 4 Rückzug,
5 Linie, 6 Block, 7 Locker, 8 aggressiv, 9 defensiv.

    python3 tools/ui/befehle_ikonen.py
"""
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "art/ui-quelle/befehle_ikonen.png"
OUT = ROOT / "assets/ui/befehle.png"
COLS, ROWS, SIZE, PAD = 5, 2, 64, 3


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
            sq.paste(crop, ((side - crop.size[0]) // 2, (side - crop.size[1]) // 2))
            small = sq.resize((SIZE - 2 * PAD, SIZE - 2 * PAD), Image.LANCZOS)
            s = np.array(small)
            s[:, :, 3] = np.where(s[:, :, 3] >= 128, 255, 0)
            sheet.paste(Image.fromarray(s), ((r * COLS + c) * SIZE + PAD, PAD))
    sheet.save(OUT, optimize=True)
    print(OUT, sheet.size)


if __name__ == "__main__":
    main()
