"""Check picture for the terrain transitions (blend.png): a small map of gras, wiese, waldboden, fels, erde and wasser,
composed the way the renderer is meant to do it, next to the same map without transitions.

  python3 tools/blender/preview_blend.py [--style vorgerendert] [--out .local/preview/blend.png] [--scale 3]

Rule (as agreed for src/render/terrain.ts): for every edge of a tile whose neighbour has a higher priority
(wasser < erde < fels < waldboden < gras < wiese), draw the neighbour's tile over the tile, cut by the mask of that
edge (sheet.json "blend": rows ne, se, sw, nw, a variant per tile and edge). Lower-priority overlays first.
Land over water gives the shore; water never covers land.
"""
import argparse
import json
import os
import random

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
ap = argparse.ArgumentParser()
ap.add_argument("--style", default="vorgerendert")
ap.add_argument("--out", default=os.path.join(ROOT, ".local", "preview", "blend.png"))
ap.add_argument("--scale", type=int, default=3)
ap.add_argument("--frame", type=int, default=0, help="water frame")
a = ap.parse_args()

D = os.path.join(ROOT, "assets", "terrain", a.style)
meta = json.load(open(os.path.join(D, "sheet.json")))
sheet = Image.open(os.path.join(D, meta.get("image", "terrain.png"))).convert("RGBA")
bl = meta.get("blend")
if not bl:
    raise SystemExit("sheet.json has no \"blend\" entry, run tools/blender/build_terrain.sh")
masks = Image.open(os.path.join(D, bl["image"])).convert("RGBA")
TW, TH = meta["tile"]
PRIO = ["wasser", "erde", "fels", "waldboden", "gras", "wiese"]
# neighbour across each screen edge for a tile drawn at ((i - j) * 32, (i + j) * 16)
NB = {"ne": (0, -1), "se": (1, 0), "sw": (0, 1), "nw": (-1, 0)}

N = 16


def kind(i, j):
    """Hand-made little landscape: a lake with a shore, a rock outcrop, a forest floor, a path, a meadow."""
    if (i - 3.5) ** 2 + (j - 4) ** 2 * 1.4 < 9:
        return "wasser"
    if (i - 11) ** 2 + (j - 4) ** 2 < 6:
        return "fels"
    if j > 9 and i < 8 and (i + j) % 7 != 0:
        return "waldboden"
    if abs(i - j + 1) <= 0 or (i == 8 and j > 8):
        return "erde"
    if (i - 12) ** 2 + (j - 12) ** 2 < 7:
        return "wiese"
    return "gras"


rng = random.Random(5)
grid = [[kind(i, j) for j in range(N)] for i in range(N)]
var = [[rng.randrange(meta["keys"][grid[i][j]]["variants"]) for j in range(N)] for i in range(N)]


def tile(key, v, f=0):
    k = meta["keys"][key]
    col = v * k["frames"] + (f % k["frames"])
    return sheet.crop((col * TW, k["row"] * TH, (col + 1) * TW, (k["row"] + 1) * TH))


def mask(edge, v):
    r = bl["edges"].index(edge)
    return masks.crop((v * TW, r * TH, (v + 1) * TW, (r + 1) * TH))


def compose(with_blend):
    W, H = (2 * N) * 32 + TW, (2 * N) * 16 + TH
    im = Image.new("RGBA", (W, H), (24, 24, 24, 255))
    for s in range(2 * N - 1):           # back to front
        for i in range(N):
            j = s - i
            if not 0 <= j < N:
                continue
            x, y = (i - j) * 32 + N * 32 - 32 + TW // 2 - 32, (i + j) * 16
            k = grid[i][j]
            im.alpha_composite(tile(k, var[i][j], a.frame), (x, y))
            if not with_blend:
                continue
            over = []
            for e, (di, dj) in NB.items():
                ni, nj = i + di, j + dj
                if 0 <= ni < N and 0 <= nj < N and PRIO.index(grid[ni][nj]) > PRIO.index(k):
                    over.append((PRIO.index(grid[ni][nj]), e, ni, nj))
            for _, e, ni, nj in sorted(over):
                mv = (i * 7 + j * 13 + "nesw".index(e[0]) * 3) % bl["variants"]
                t = tile(grid[ni][nj], var[ni][nj], a.frame)
                cut = Image.new("RGBA", t.size, (0, 0, 0, 0))
                cut.paste(t, (0, 0), mask(e, mv))
                im.alpha_composite(cut, (x, y))
    return im


left, right = compose(False), compose(True)
out = Image.new("RGBA", (left.width * 2 + 16, left.height), (0, 0, 0, 255))
out.paste(left, (0, 0))
out.paste(right, (left.width + 16, 0))
out = out.resize((out.width * a.scale, out.height * a.scale), Image.NEAREST)
os.makedirs(os.path.dirname(a.out), exist_ok=True)
out.save(a.out)
print("wrote", a.out)
