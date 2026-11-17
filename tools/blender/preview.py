"""Check pictures for the sprite sheets: enlarged contact sheets and small test scenes in all four views.

  python3 tools/blender/preview.py [--style vorgerendert] [--out .local/preview] [--scale 3]

Writes into --out (default .local/preview):
  kontakt_<key>.png     every view (rows) and variant (columns) of an object from assets/buildings/<style>/
  figuren_<key>.png     every direction (rows) and column of a unit from assets/figures/<style>/atlas.png
  gelaende.png          all terrain tiles and a 3 x 3 patch per tile (seams), from assets/terrain/<style>/
  szene_mauer.png       wall pieces chosen by the same autotiling as src/sim/geom.ts (wallPiece), tower, gate,
                        stairs and figures on the posts, in all four camera turns
  szene_lager.png       storage yard (lager_boden) with all stacks at their fill levels and the two carriers
The scenes use the drawing order of the game: buildings and stacks back to front, figures on posts after their wall,
then the front part (<key>_front.png).
"""
import argparse
import json
import os

from PIL import Image, ImageDraw

ap = argparse.ArgumentParser()
ap.add_argument("--style", default="vorgerendert")
ap.add_argument("--out", default=".local/preview")
ap.add_argument("--scale", type=int, default=3)
ap.add_argument("--bdir", help="building sheets instead of assets/buildings/<style>")
ap.add_argument("--fdir", help="figure sheets instead of assets/figures/<style>")
a = ap.parse_args()
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
BD = os.path.join(ROOT, "assets", "buildings", a.style)
FD = os.path.join(ROOT, "assets", "figures", a.style)
TD = os.path.join(ROOT, "assets", "terrain", a.style)
BD = os.path.abspath(a.bdir) if a.bdir else BD
FD = os.path.abspath(a.fdir) if a.fdir else FD
OUT = os.path.join(ROOT, a.out)
os.makedirs(OUT, exist_ok=True)
GREEN = (104, 132, 70, 255)

BS = json.load(open(os.path.join(BD, "sheet.json")))
FS = json.load(open(os.path.join(FD, "sheet.json")))
BU = {u["key"]: u for u in BS["units"]}
CW, CH = BS["cell"]
AX, AY = BS["anchor"]
_cache = {}


def sheet(path):
    if path not in _cache:
        _cache[path] = Image.open(path).convert("RGBA") if os.path.exists(path) else None
    return _cache[path]


def big(im, s=None):
    s = s or a.scale
    return im.resize((im.width * s, im.height * s), Image.NEAREST)


def on_green(im):
    bg = Image.new("RGBA", im.size, GREEN)
    bg.alpha_composite(im)
    return bg


# ---------------------------------------------------------------- contact sheets
def contact_building(key):
    u = BU[key]
    im = sheet(os.path.join(BD, key + ".png"))
    fr = sheet(os.path.join(BD, key + "_front.png"))
    nf = u.get("frames", 1)
    out = Image.new("RGBA", (CW * nf, CH * 4), GREEN)
    out.alpha_composite(im.crop((0, 0, CW * nf, CH * 4)))
    d = ImageDraw.Draw(out)
    for v in range(4):
        for f in range(nf):
            x, y = f * CW + AX, v * CH + AY
            d.line((x - 32, y, x, y - 16, x + 32, y, x, y + 16, x - 32, y), fill=(255, 255, 255, 70))
    if fr is not None:  # the front part, tinted, below
        tint = fr.copy()
        px = tint.load()
        for yy in range(tint.height):
            for xx in range(tint.width):
                p = px[xx, yy]
                if p[3]:
                    px[xx, yy] = (255, 80, 80, 255)
        out2 = Image.new("RGBA", (out.width, out.height * 2), GREEN)
        out2.alpha_composite(out)
        low = Image.new("RGBA", out.size, GREEN)
        low.alpha_composite(im.crop((0, 0, CW * nf, CH * 4)))
        low.alpha_composite(tint.crop((0, 0, CW * nf, CH * 4)))
        out2.alpha_composite(low, (0, out.height))
        out = out2
    big(out).save(os.path.join(OUT, "kontakt_%s.png" % key))


def contact_figure(key):
    units = [u["key"] for u in FS["units"]]
    i = units.index(key)
    c = FS["cell"]
    at = sheet(os.path.join(FD, "atlas.png"))
    u = FS["units"][i]
    row = u.get("row", i * 8)
    im = at.crop((0, row * c, c * u.get("frames", FS["frames"]), (row + 8) * c))
    big(on_green(im)).save(os.path.join(OUT, "figuren_%s.png" % key))


def terrain_sheet():
    if not os.path.exists(os.path.join(TD, "sheet.json")):
        return
    ts = json.load(open(os.path.join(TD, "sheet.json")))
    im = sheet(os.path.join(TD, ts["image"]))
    tw, th = ts["tile"]
    keys = list(ts["keys"].items())
    # left: the sheet; right: per type a 4 x 4 patch with random variants, and a 3 x 3 patch of one variant
    rows = []
    import random
    rnd = random.Random(3)
    for k, e in keys:
        n = e["variants"]
        patch = Image.new("RGBA", (tw * 7, th * 7), GREEN)
        for j in range(6):
            for i in range(6):
                v = rnd.randrange(n)
                f = 0
                tile = im.crop(((v * e["frames"] + f) * tw, e["row"] * th, (v * e["frames"] + f + 1) * tw, (e["row"] + 1) * th))
                patch.alpha_composite(tile, ((i - j) * tw // 2 + 3 * tw - tw // 2 + tw // 2, (i + j) * th // 2 + th // 2))
        rows.append(patch)
    W = max(im.width, sum(r.width for r in rows[:3]))
    out = Image.new("RGBA", (max(im.width, rows[0].width * 3), im.height + 8 + rows[0].height * 2), GREEN)
    out.alpha_composite(im, (0, 0))
    for i, r in enumerate(rows):
        out.alpha_composite(r, ((i % 3) * r.width, im.height + 8 + (i // 3) * r.height))
    big(out, 4).save(os.path.join(OUT, "gelaende.png"))


# ---------------------------------------------------------------- scenes
NEIGHBOURS = [(0, -1), (1, 0), (0, 1), (-1, 0)]   # bit 0 N (-y), 1 O (+x), 2 S (+y), 3 W (-x), as src/sim/geom.ts


def turn(dx, dy, k):
    for _ in range(k % 4):
        dx, dy = dy, -dx
    return dx, dy


def rot_mask(mask, o):
    out = 0
    for bit, (dx, dy) in enumerate(NEIGHBOURS):
        if mask & (1 << bit):
            out |= 1 << NEIGHBOURS.index(turn(dx, dy, o))
    return out


PIECES = [("mauer_einzel", 0), ("mauer_ende", 0b0010), ("mauer_gerade", 0b1010), ("mauer_ecke", 0b0011), ("mauer_t", 0b1011),
          ("mauer_kreuz", 0b1111)]


def wall_piece(mask):
    for piece, m in PIECES:
        for o in range(4):
            if rot_mask(m, o) == mask:
                return piece, o
    return "mauer_einzel", 0


def to_view(x, y, r, W, H):
    return [(x, y), (H - y, x), (W - x, H - y), (y, W - x)][r]


class Scene:
    def __init__(self, W, H):
        self.W, self.H = W, H
        self.items = []   # dict(kind, key, x, y (centre, world tiles), o, var, fp, posts=[...])

    def building(self, key, x0, y0, o=0, var=0):
        fw, fh = BU[key]["footprint"]
        if o % 2:
            fw, fh = fh, fw
        it = {"kind": "b", "key": key, "x": x0 + fw / 2, "y": y0 + fh / 2, "o": o, "var": var, "fp": (fw, fh), "figs": [],
              "floor": key == "lager_boden"}
        self.items.append(it)
        return it

    def figure(self, unit, x, y, face, col=0, on=None, post=0):
        f = {"kind": "f", "unit": unit, "x": x, "y": y, "face": face, "col": col, "h": 0}
        if on is not None:
            p = BU[on["key"]]["posts"][post]
            ox, oy = turn(p[0], -p[1], on["o"])
            f.update(x=on["x"] + ox, y=on["y"] + oy, h=p[2])
            on["figs"].append(f)
        else:
            self.items.append(f)
        return f

    def render(self, r):
        W, H = self.W, self.H
        X0, Y0 = H * 32 + 40, 200
        img = Image.new("RGBA", ((W + H) * 32 + 80, Y0 + (W + H) * 16 + 80), GREEN)
        d = ImageDraw.Draw(img)
        for j in range(H):  # grid
            for i in range(W):
                u, v = to_view(i + 0.5, j + 0.5, r, W, H)
                X, Y = X0 + (u - v) * 32, Y0 + (u + v) * 16
                d.polygon([(X - 32, Y), (X, Y - 16), (X + 32, Y), (X, Y + 16)], outline=(90, 116, 60, 255))

        def box(it):
            u, v = to_view(it["x"], it["y"], r, W, H)
            if it["kind"] == "b":
                fw, fh = it["fp"]
                if r % 2:
                    fw, fh = fh, fw
                return (u - fw / 2, u + fw / 2, v - fh / 2, v + fh / 2)
            return (u - 0.2, u + 0.2, v - 0.2, v + 0.2)
        items = self.items[:]
        for it in items:
            it["box"] = box(it)
        for it in order(items):
            if it["kind"] == "b":
                self.draw_b(img, it, r, X0, Y0, False)
                for f in it["figs"]:
                    self.draw_f(img, f, r, X0, Y0)
                if BU[it["key"]].get("front"):
                    self.draw_b(img, it, r, X0, Y0, True)
            else:
                self.draw_f(img, it, r, X0, Y0)
        return img

    def draw_b(self, img, it, r, X0, Y0, front):
        im = sheet(os.path.join(BD, it["key"] + ("_front" if front else "") + ".png"))
        if im is None:
            return
        view = (it["o"] - r) % 4
        u, v = to_view(it["x"], it["y"], r, self.W, self.H)
        X, Y = X0 + (u - v) * 32, Y0 + (u + v) * 16
        spr = im.crop((it["var"] * CW, view * CH, (it["var"] + 1) * CW, (view + 1) * CH))
        img.alpha_composite(spr, (round(X - AX), round(Y - AY)))

    def draw_f(self, img, f, r, X0, Y0):
        at = sheet(os.path.join(FD, "atlas.png"))
        units = [u["key"] for u in FS["units"]]
        i = units.index(f["unit"])
        row = FS["units"][i].get("row", i * 8)
        c = FS["cell"]
        ax, ay = FS["anchor"]
        du, dv = turn(f["face"][0], f["face"][1], -r)
        import math
        sx, sy = (du - dv) * 32, (du + dv) * 16
        oc = (2 - round(math.atan2(sy, sx) / (math.pi / 4))) % 8
        u, v = to_view(f["x"], f["y"], r, self.W, self.H)
        X, Y = X0 + (u - v) * 32, Y0 + (u + v) * 16 - f["h"] * 16
        spr = at.crop((f["col"] * c, (row + oc) * c, (f["col"] + 1) * c, (row + oc + 1) * c))
        img.alpha_composite(spr, (round(X - ax), round(Y - ay)))


def order(items):
    """Same topological order as tools/konzeptseite/bauten.js: A before B if A lies completely behind B in u or v."""
    n = len(items)
    before = [[] for _ in items]
    indeg = [0] * n
    e = 1e-3
    for i in range(n):
        for j in range(i + 1, n):
            A, B = items[i]["box"], items[j]["box"]
            if A[1] <= B[0] + e or A[3] <= B[2] + e:
                before[i].append(j); indeg[j] += 1
            elif B[1] <= A[0] + e or B[3] <= A[2] + e:
                before[j].append(i); indeg[i] += 1
            elif items[i].get("floor") != items[j].get("floor"):  # a floor (lager_boden) before what stands on it
                if items[i].get("floor"):
                    before[i].append(j); indeg[j] += 1
                else:
                    before[j].append(i); indeg[i] += 1
            elif items[i]["kind"] == "f" and items[j]["kind"] != "f":
                before[j].append(i); indeg[i] += 1
            elif items[j]["kind"] == "f" and items[i]["kind"] != "f":
                before[i].append(j); indeg[j] += 1
    depth = lambda i: sum(items[i]["box"]) / 2
    out, ready, done = [], [i for i in range(n) if not indeg[i]], [False] * n
    while len(out) < n:
        if not ready:
            m = min((i for i in range(n) if not done[i]), key=depth)
            ready.append(m); indeg[m] = 0
        ready.sort(key=lambda i: -depth(i))
        i = ready.pop()
        if done[i]:
            continue
        done[i] = True
        out.append(items[i])
        for j in before[i]:
            indeg[j] -= 1
            if indeg[j] == 0 and not done[j]:
                ready.append(j)
    return out


def wall_scene():
    sc = Scene(12, 10)
    walls = {(x, 2) for x in range(2, 10)} | {(9, y) for y in range(3, 8)} | {(5, 3), (5, 4)} | {(8, 6), (10, 6)} | {(2, 8)}
    gate = (7, 2)
    tower = [(0, 1), (1, 1), (0, 2), (1, 2)]
    solid = walls | set(tower)
    for (x, y) in sorted(walls):
        mask = 0
        for bit, (dx, dy) in enumerate(NEIGHBOURS):
            if (x + dx, y + dy) in solid:
                mask |= 1 << bit
        if (x, y) == gate:
            sc.building("tor", x, y, 0, 0)
            continue
        piece, o = wall_piece(mask)
        it = sc.building(piece, x, y, o)
        if (x, y) in ((3, 2), (9, 4), (8, 6)):
            sc.figure("bogen", 0, 0, (0, 1), on=it)
        if (x, y) == (6, 2):
            sc.figure("speer", 0, 0, (0, -1), on=it)
    t = sc.building("turm", 0, 1, 0)
    sc.figure("bogen", 0, 0, (0, 1), on=t, post=0)
    sc.figure("schwert", 0, 0, (1, 0), on=t, post=3)
    sc.building("treppe", 3, 3, 0)
    sc.figure("speer", 7.5, 3.6, (0, -1), col=0)
    sc.figure("schwert", 4.4, 6.5, (1, 0), col=12)
    return sc


def lager_scene():
    sc = Scene(9, 7)
    sc.building("lager_boden", 1, 1, 0)
    slots = [(-1, 1), (0, 1), (1, 1), (-1, 0), (1, 0), (-1, -1), (1, -1), (0, 0)]
    goods = ["stapel_holz", "stapel_holz", "stapel_stein", "stapel_eisen", "stapel_speer", "stapel_schwert", "stapel_bogen", "stapel_stein"]
    levels = [4, 2, 4, 3, 4, 4, 4, 1]
    for (mx, my), g, lv in zip(slots, goods, levels):
        tx, ty = 2 + mx, 2 - my  # model y points the other way than tile y
        sc.building(g, tx, ty, 0, lv)
    sc.figure("traeger_stein", 2.5, 4.6, (0, -1), col=3)
    sc.figure("traeger_kiste", 3.2, 4.9, (0, -1), col=5)
    return sc


def stacks_row():
    """All stacks, levels 0..4 (columns), view 0, on plank floors."""
    keys = ["stapel_holz", "stapel_stein", "stapel_eisen", "stapel_speer", "stapel_schwert", "stapel_bogen"]
    rows = []
    for k in keys:
        im = sheet(os.path.join(BD, k + ".png"))
        rows.append(im.crop((0, 0, CW * 5, CH)).crop((0, 40, CW * 5, CH - 30)))
    out = Image.new("RGBA", (rows[0].width, sum(r.height for r in rows)), GREEN)
    y = 0
    for r_ in rows:
        out.alpha_composite(r_, (0, y))
        y += r_.height
    big(out, 2).save(os.path.join(OUT, "stapel_stufen.png"))


def four(sc, name):
    ims = [sc.render(r) for r in range(4)]
    w, h = ims[0].size
    out = Image.new("RGBA", (w * 2, h * 2), GREEN)
    for r, im in enumerate(ims):
        out.alpha_composite(im, ((r % 2) * w, (r // 2) * h))
    out.save(os.path.join(OUT, name + ".png"))
    big(ims[0], 2).save(os.path.join(OUT, name + "_r0_gross.png"))
    big(ims[1], 2).save(os.path.join(OUT, name + "_r1_gross.png"))


if __name__ == "__main__":
    new = ["baum_liegt", "baum_stumpf", "fels", "stapel_holz", "stapel_stein", "stapel_eisen", "stapel_speer", "stapel_schwert",
           "stapel_bogen", "lager_boden", "mauer_gerade", "mauer_ende", "mauer_ecke", "mauer_t", "mauer_kreuz", "mauer_einzel", "tor"]
    for k in new:
        if k in BU:
            contact_building(k)
    for u in FS["units"]:
        contact_figure(u["key"])
    terrain_sheet()
    stacks_row()
    four(wall_scene(), "szene_mauer")
    four(lager_scene(), "szene_lager")
    print("written to", OUT)
