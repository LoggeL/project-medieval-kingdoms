"""Flat terrain tiles (64 x 32 diamonds) from the same iso camera, light and palette logic as figures and buildings.

Two steps, one file:
  blender -b --factory-startup --python-exit-code 1 -P tools/blender/terrain.py -- --out .local/blender/terrain
      renders per terrain type, variant and frame a flat colour pass, a light pass and a height pass
  python3 tools/blender/terrain.py --style tools/blender/styles/vorgerendert.json --src .local/blender/terrain \
      --out assets/terrain/vorgerendert --lref-src .local/blender/vorgerendert [--lscale 1.06]
      pixelizes them (material per block, hard light bands with the style's levels and dither, short shadows of
      grass and stones) and writes terrain.png + sheet.json

Seamless tiling: ground tone and micro relief come from noise that is periodic over one tile. Near the tile edges
every variant of a type uses the same (shared) noise, inside each variant has its own, so variants can be laid next
to each other in any order. Structured details (tufts, flowers, leaves, stones) stay inside the diamond, nothing
crosses an edge. Water waves travel: every wave component is periodic over the tile and moves a whole number of
periods over the eight frames, so the loop is seamless in space and time. The four water variants share the waves
near the tile edges and differ inside (as the ground), so a lake does not show the tile grid.

Added later (rows after the first six, earlier rows unchanged): erz (rock with rusty ore veins), sumpf (boggy ground
with murky puddles and reeds), acker (ploughed field with young crop). The acker furrows have a direction:
variants 0 and 1 run along world x, variants 2 and 3 along world y. Terrain tiles are not turned with the camera,
so a renderer swaps the pair (v xor 2) for the views r = 1 and r = 3.

Added for the landscape (ADR 0012), in their own image gelaende.png so terrain.png stays byte-identical: huegel (dry
olive grass on broad bumps with heather and stones), fruchtbar (lush dark green with loam patches and molehills), sand
(beach with ripples, pebbles, shells, beach grass and driftwood) and gebirge (dark scree under the mountain sprites).
Render them with --only and pixelize with --only huegel,fruchtbar,sand,gebirge --image gelaende.png --merge: the keys
are added to the existing sheet.json with "image": "gelaende.png" (rows count inside that image), the rest is kept.

Transitions: the pixelize step also writes blend.png (edge masks ne, se, sw, nw x 4 variants, white with hard alpha,
see blend_masks()) and the "blend" entry of sheet.json; tools/blender/preview_blend.py composes a check picture.
"""
import json
import math
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PAL = {k: v for k, v in json.load(open(os.path.join(HERE, "terrain", "palette.json"))).items() if not k.startswith("_")}

PPM = 32 / 1.8                                  # pixels per metre, as figures and buildings
T = 64 / (math.sqrt(2) * PPM)                   # tile edge in metres
SS = 4
TW, TH = 64, 32
ANCHOR = (32, 16)
WATER_FRAMES = 8                                # wave loop, one frame per 1/8 of every wave period
WIND = (0.83, 0.55)                             # direction (model x, y) the wavelets travel in
# key, variants, frames (row order in the sheet)
TYPES = [("gras", 4, 1), ("wiese", 4, 1), ("waldboden", 4, 1), ("erde", 4, 1), ("fels", 4, 1), ("wasser", 4, WATER_FRAMES),
         ("erz", 4, 1), ("sumpf", 4, 1), ("acker", 4, 1),
         ("huegel", 4, 1), ("fruchtbar", 4, 1), ("sand", 4, 1), ("gebirge", 4, 1)]
# ground tones (low, mid, high noise value) with their thresholds, relief amplitude (m), relief noise frequency limit
GROUND = {
    "gras": (("gras2", "gras1", "gras3"), (-0.45, 0.5), 0.035, 5),
    "wiese": (("klee", "wiese1", "wiese2"), (-0.6, 0.4), 0.03, 5),
    "waldboden": (("humus1", "humus2", "moos"), (-0.2, 1.05), 0.04, 6),
    "erde": (("erde2", "erde1", "erde3"), (-0.45, 0.5), 0.025, 6),
    "fels": (("fels3", "fels1", "fels2"), (-0.45, 0.5), 0.06, 4),
    "erz": (("erzboden3", "erzboden1", "erzboden2"), (-0.45, 0.5), 0.06, 4),
    "sumpf": (("sumpfwasser", "sumpf1", "sumpf2"), (-0.5, 0.55), 0.02, 4),
    "acker": (("acker_dk", "acker1", "acker_hell"), (-0.45, 0.5), 0.05, 5),   # tone and relief: furrows, see ground()
    "huegel": (("huegel2", "huegel1", "huegel3"), (-0.5, 0.45), 0.13, 2),     # broad bumps: the light shows the slopes
    "fruchtbar": (("auboden", "aue1", "aue2"), (-1.3, 0.4), 0.03, 5),
    "sand": (("sand2", "sand1", "sand3"), (-0.5, 0.5), 0.02, 6),
    "gebirge": (("schotter3", "schotter1", "schotter2"), (-0.45, 0.45), 0.07, 4),
}
FURROWS = 4                                     # furrows per tile edge (integer, so the tile stays seamless)


def diamond(x, y):
    """Pixel (x, y) of a 64 x 32 tile belongs to the tile (exact tiling with offsets (32, 16), no overlaps)."""
    return abs(x + 0.5 - 32) / 32 + abs(y + 0.5 - 16) / 16 < 1


# ---------------------------------------------------------------- periodic noise (tile = 1 x 1 in u, v)
class PNoise:
    def __init__(self, seed, fmax, n=14):
        r = random.Random(seed)
        self.w = []
        for _ in range(n):
            a, b = r.randint(-fmax, fmax), r.randint(-fmax, fmax)
            if a == 0 and b == 0:
                a = 1
            f = math.hypot(a, b)
            self.w.append((a, b, r.uniform(0, 2 * math.pi), 1.0 / f))
        self.norm = math.sqrt(sum(w[3] ** 2 for w in self.w) / 2)

    def __call__(self, u, v):
        return sum(amp * math.sin(2 * math.pi * (a * u + b * v) + ph) for a, b, ph, amp in self.w) / self.norm


def edge_weight(u, v):
    """1 near the tile edges (shared noise), 0 inside (variant noise)."""
    u, v = u % 1.0, v % 1.0
    de = min(u, 1 - u, v, 1 - v)
    t = min(1.0, max(0.0, (de - 0.07) / 0.13))
    return 1.0 - t * t * (3 - 2 * t)


class Field:
    def __init__(self, key, variant, salt, fmax):
        base = sum(ord(c) for c in key) * 101 + salt
        self.shared = PNoise(base, fmax)
        self.own = PNoise(base + 7919 * (variant + 1), fmax)

    def __call__(self, x, y):
        u, v = x / T + 0.5, y / T + 0.5
        w = edge_weight(u, v)
        return w * self.shared(u, v) + (1 - w) * self.own(u, v)


# ================================================================ transition masks (plain Python, no Blender)
BLEND_EDGES = ["ne", "se", "sw", "nw"]          # edges of the screen diamond: ne = between the top and the right corner
BLEND_VARIANTS = 4
BLEND_END = 3                                   # coverage depth (px, vertical) at both ends of every edge: runs connect
BLEND_MIN, BLEND_MAX = 2, 7                     # always opaque right at the edge, never deeper than 7 of 16 px, so a strip
                                                # one tile wide (a path) keeps its middle


def blend_masks(nvar=BLEND_VARIANTS, seed=4711):
    """White masks with hard alpha (0 or 255), one 64 x 32 cell per edge (rows, BLEND_EDGES order) and variant
    (columns). A mask covers its edge of the diamond to an irregular depth: opaque at the edge, ragged towards the
    inside with tongues and a few loose pixels, in 2-px column steps like hand-set pixel art. Both ends of every edge
    have the same depth in every variant, so masks of neighbouring tiles along a boundary run on without a step.
    Used by the renderer: the tile of a neighbour with higher priority, cut by the mask of the shared edge, over the tile."""
    import numpy as np
    from PIL import Image
    corners = {"ne": ((32, 0), (64, 16), 1), "se": ((64, 16), (32, 32), -1),
               "sw": ((32, 32), (0, 16), -1), "nw": ((0, 16), (32, 0), 1)}   # A, B, inward direction in screen y
    yy, xx = np.mgrid[0:TH, 0:TW]
    px, py = xx + 0.5, yy + 0.5
    inside = (np.abs(px - 32) / 32 + np.abs(py - 16) / 16) < 1
    out = np.zeros((TH * len(BLEND_EDGES), TW * nvar, 4), np.uint8)
    for ei, e in enumerate(BLEND_EDGES):
        (ax, ay), (bx, by), inward = corners[e]
        line_y = ay + (px - ax) * (by - ay) / (bx - ax)
        dv = (py - line_y) * inward                    # vertical distance from the edge line, > 0 inside
        t = (px - ax) / (bx - ax)                      # 0 at A, 1 at B
        for v in range(nvar):
            r = random.Random(seed + 101 * ei + 7 * v)
            # depth profile: control points every 1/6 of the edge, pinned ends, linear in between
            n = 7
            ctrl = [BLEND_END] + [r.uniform(BLEND_MIN + 0.5, BLEND_MAX - 2.0) for _ in range(n - 2)] + [BLEND_END]
            # one or two tongues reaching further in
            tongues = [(r.uniform(0.2, 0.8), r.uniform(0.05, 0.09), r.uniform(1.5, 2.5)) for _ in range(r.randint(1, 2))]
            # ragged 2-px column steps (+-1 px), none at the ends
            cols = {c: r.choice([-1, 0, 0, 1]) for c in range(-1, 33)}

            def depth(tt, col):
                tt = min(max(tt, 0.0), 1.0)
                k = min(int(tt * (n - 1)), n - 2)
                f = tt * (n - 1) - k
                d = ctrl[k] * (1 - f) + ctrl[k + 1] * f
                for c0, w, h in tongues:
                    d += h * max(0.0, 1 - abs(tt - c0) / w)
                end = min(tt, 1 - tt)
                if end > 0.08:
                    d += cols[col]
                return min(max(d, BLEND_MIN), BLEND_MAX)
            m = np.zeros((TH, TW), bool)
            for y in range(TH):
                for x in range(TW):
                    tt = t[y, x]
                    if not inside[y, x] or tt < 0 or tt > 1 or dv[y, x] <= 0:
                        continue
                    if dv[y, x] <= depth(tt, int(tt * 32) // 2 * 2):
                        m[y, x] = True
            # a few loose pixels and pairs just beyond the boundary
            for _ in range(r.randint(3, 5)):
                tt = r.uniform(0.15, 0.85)
                x = int(round(ax + tt * (bx - ax)))
                ly = ay + (x + 0.5 - ax) * (by - ay) / (bx - ax)
                d = depth(tt, int(tt * 32) // 2 * 2) + r.choice([1.0, 2.0])
                y = int(math.floor(ly + inward * d))
                for dx in ([0] if r.random() < 0.5 else [0, 1]):
                    if 0 <= y < TH and 0 <= x + dx < TW and inside[y, x + dx]:
                        m[y, x + dx] = True
            # no single-pixel holes inside the covered band
            pad = np.pad(m, 1)
            holes = ~m & pad[:-2, 1:-1] & pad[2:, 1:-1] & pad[1:-1, :-2] & pad[1:-1, 2:]
            m |= holes & inside
            cell = out[ei * TH:(ei + 1) * TH, v * TW:(v + 1) * TW]
            cell[m] = (255, 255, 255, 255)
    return Image.fromarray(out, "RGBA")


# ================================================================ Blender part
def blender_main():
    import bpy
    import bmesh
    from mathutils import Euler, Matrix, Vector

    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = argv[argv.index("--out") + 1]
    only = argv[argv.index("--only") + 1].split(",") if "--only" in argv else None
    os.makedirs(out, exist_ok=True)

    def lin(c):
        c = c / 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    def col(h):
        h = h.lstrip("#")
        return (lin(int(h[0:2], 16)), lin(int(h[2:4], 16)), lin(int(h[4:6], 16)), 1.0)

    class MB:
        def __init__(self):
            self.parts = {}

        def add(self, mat, verts, faces):
            if mat not in PAL:
                raise KeyError("material '%s' missing in terrain/palette.json" % mat)
            v, f = self.parts.setdefault(mat, ([], []))
            o = len(v)
            v.extend(verts)
            f.extend(tuple(i + o for i in fc) for fc in faces)

        def box(self, mat, c, s, rot=(0, 0, 0)):
            hx, hy, hz = s[0] / 2, s[1] / 2, s[2] / 2
            R = Matrix.Translation(Vector(c)) @ Euler([math.radians(a) for a in rot]).to_matrix().to_4x4()
            pts = [(-hx, -hy, -hz), (hx, -hy, -hz), (hx, hy, -hz), (-hx, hy, -hz),
                   (-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz)]
            faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
            self.add(mat, [tuple(R @ Vector(p)) for p in pts], faces)

        def blob(self, mat, c, r, rnd, seg=6, rings=4, jitter=0.2):
            pts = [(0, 0, -r[2])]
            for j in range(1, rings):
                th = math.pi * j / rings
                for i in range(seg):
                    ph = 2 * math.pi * (i + 0.5 * (j % 2)) / seg
                    k = 1 + rnd.uniform(-jitter, jitter)
                    pts.append((r[0] * k * math.sin(th) * math.cos(ph), r[1] * k * math.sin(th) * math.sin(ph), -r[2] * k * math.cos(th)))
            pts.append((0, 0, r[2]))
            top = len(pts) - 1
            faces = [(0, 1 + (i + 1) % seg, 1 + i) for i in range(seg)]
            for j in range(rings - 2):
                a, b = 1 + j * seg, 1 + (j + 1) * seg
                faces += [(a + i, a + (i + 1) % seg, b + (i + 1) % seg, b + i) for i in range(seg)]
            last = 1 + (rings - 2) * seg
            faces += [(last + i, last + (i + 1) % seg, top) for i in range(seg)]
            self.add(mat, [(c[0] + p[0], c[1] + p[1], c[2] + p[2]) for p in pts], faces)

    # ------------------------------------------------------------ ground surface
    def ground(mb, key, var):
        tones, (lo, hi), amp, fmax = GROUND[key]
        tone = Field(key, var, 1, fmax)
        relief = Field(key, var, 2, fmax + 2)
        n = 96
        g = 2 * T / n
        if key == "acker":
            # furrows along world x (variants 0, 1) or world y (2, 3): a periodic ridge profile plus a little noise
            along_y = var >= 2

            def furrow(x, y):
                w = (y if not along_y else x) / T + 0.5
                return math.sin(2 * math.pi * FURROWS * w)

            def relief_(x, y):
                return furrow(x, y) + 0.25 * relief(x, y)

            def tone_(x, y):
                return furrow(x, y) + 0.3 * tone(x, y)
        else:
            relief_, tone_ = relief, tone
        Z = [[amp * relief_(-T + i * g, -T + j * g) for i in range(n + 1)] for j in range(n + 1)]
        for j in range(n):
            for i in range(n):
                x0, y0 = -T + i * g, -T + j * g
                f = tone_(x0 + g / 2, y0 + g / 2)
                m = tones[0] if f < lo else (tones[2] if f > hi else tones[1])
                mb.add(m, [(x0, y0, Z[j][i]), (x0 + g, y0, Z[j][i + 1]), (x0 + g, y0 + g, Z[j + 1][i + 1]), (x0, y0 + g, Z[j + 1][i])],
                       [(0, 1, 2, 3)])
        return lambda x, y: amp * relief_(x, y)

    def spots(rnd, count, margin, min_d=0.0, taken=None):
        """Random points inside the tile, at least `margin` m from every edge."""
        lim = T / 2 - margin
        out = taken if taken is not None else []
        n0 = len(out)
        tries = 0
        while len(out) - n0 < count and tries < count * 60:
            tries += 1
            p = (rnd.uniform(-lim, lim), rnd.uniform(-lim, lim))
            if all(math.hypot(p[0] - q[0], p[1] - q[1]) >= min_d for q in out):
                out.append(p)
        return out[n0:]

    def tuft(mb, rnd, x, y, z, h, mats=("halm", "halm_hi")):
        for k in range(rnd.randint(4, 6)):
            a = rnd.uniform(0, 360)
            tilt = rnd.uniform(8, 30)
            hh = h * rnd.uniform(0.6, 1.0)
            ca, sa = math.cos(math.radians(a)), math.sin(math.radians(a))
            off = math.sin(math.radians(tilt)) * hh / 2
            mb.box(mats[0] if k % 2 == 0 else mats[1], (x + ca * (off + 0.02), y + sa * (off + 0.02), z + hh / 2 * math.cos(math.radians(tilt))),
                   (0.035, 0.035, hh), rot=(-tilt * sa, tilt * ca, 0))

    def details(mb, key, var, zf):
        rnd = random.Random(1000 + 37 * var + sum(ord(c) for c in key))
        if key in ("gras", "wiese"):
            for (x, y) in spots(rnd, 7 if key == "gras" else 4, 0.5, 0.35):
                tuft(mb, rnd, x, y, zf(x, y), rnd.uniform(0.16, 0.26))
        if key == "wiese":
            cols = ["bluete_w", "bluete_w", "bluete_g", "bluete_g", "bluete_v", "bluete_r"]
            for (cx, cy) in spots(rnd, 4, 0.45, 0.4):
                c = rnd.choice(cols)
                for k in range(rnd.randint(2, 4)):
                    x, y = cx + rnd.uniform(-0.14, 0.14), cy + rnd.uniform(-0.14, 0.14)
                    z = zf(x, y)
                    hh = rnd.uniform(0.08, 0.16)
                    mb.box("halm", (x, y, z + hh / 2), (0.025, 0.025, hh))
                    mb.blob(c, (x, y, z + hh + 0.03), (0.055, 0.055, 0.04), rnd, seg=5, rings=3, jitter=0.1)
        if key == "waldboden":
            for (x, y) in spots(rnd, 10, 0.3, 0.14):
                m = rnd.choice(["laub_o", "laub_b", "laub_b", "laub_b", "laub_g"])
                mb.box(m, (x, y, zf(x, y) + 0.012), (0.14, 0.09, 0.014), rot=(rnd.uniform(-10, 10), rnd.uniform(-10, 10), rnd.uniform(0, 180)))
            for (x, y) in spots(rnd, 30, 0.3):
                mb.box("nadel", (x, y, zf(x, y) + 0.01), (0.16, 0.018, 0.012), rot=(0, 0, rnd.uniform(0, 180)))
            for (x, y) in spots(rnd, 2, 0.6, 0.6):
                mb.blob("moos", (x, y, zf(x, y)), (0.17, 0.14, 0.05), rnd, seg=7, rings=3)
            if var % 2 == 0:
                (x, y), = spots(rnd, 1, 0.65)
                mb.box("zweig", (x, y, zf(x, y) + 0.025), (0.5, 0.035, 0.035), rot=(0, 0, rnd.uniform(0, 180)))
                mb.box("zweig", (x + 0.1, y + 0.05, zf(x, y) + 0.025), (0.18, 0.025, 0.025), rot=(0, 0, rnd.uniform(0, 180)))
        if key == "erde":
            for (x, y) in spots(rnd, 9, 0.3, 0.15):
                rr = rnd.uniform(0.04, 0.08)
                mb.blob(rnd.choice(["kiesel", "kiesel", "kiesel_dk"]), (x, y, zf(x, y) + rr * 0.3), (rr, rr * 0.85, rr * 0.6), rnd, seg=5, rings=3)
            if var in (1, 3):
                for (x, y) in spots(rnd, 2, 0.5, 0.5):
                    tuft(mb, rnd, x, y, zf(x, y), 0.12, mats=("halm", "gras1"))
        if key == "fels":
            for (x, y) in spots(rnd, 3, 0.55, 0.5):
                rr = rnd.uniform(0.14, 0.24)
                mb.blob(rnd.choice(["fels2", "fels3"]), (x, y, zf(x, y) + rr * 0.35), (rr, rr * 0.85, rr * 0.7), rnd, seg=7, rings=4)
            for (x, y) in spots(rnd, 12, 0.3, 0.1):
                rr = rnd.uniform(0.04, 0.07)
                mb.blob("geroell", (x, y, zf(x, y) + rr * 0.3), (rr, rr, rr * 0.6), rnd, seg=5, rings=3)
            for (x, y) in spots(rnd, 2, 0.6, 0.5):  # cracks: short zig-zag of thin dark strips
                a = rnd.uniform(0, 180)
                for k in range(3):
                    a += rnd.uniform(-35, 35)
                    dx, dy = math.cos(math.radians(a)) * 0.13, math.sin(math.radians(a)) * 0.13
                    mb.box("riss", (x, y, zf(x, y) + 0.004), (0.28, 0.03, 0.01), rot=(0, 0, a))
                    x, y = x + 2 * dx, y + 2 * dy
            for (x, y) in spots(rnd, 3, 0.4, 0.3):
                mb.blob("flechte", (x, y, zf(x, y)), (0.08, 0.07, 0.012), rnd, seg=6, rings=3)
        if key == "erz":
            # rusty veins (zig-zag strips), ore lumps, a little scree; the colour is the tell, as in the concept
            for (x, y) in spots(rnd, 2, 0.55, 0.6):
                a = rnd.uniform(0, 180)
                for k in range(4):
                    a += rnd.uniform(-30, 30)
                    dx, dy = math.cos(math.radians(a)) * 0.12, math.sin(math.radians(a)) * 0.12
                    mb.box("erz_ader", (x, y, zf(x, y) + 0.006), (0.26, 0.07, 0.014), rot=(0, 0, a))
                    x, y = x + 2 * dx, y + 2 * dy
            for (x, y) in spots(rnd, 4, 0.5, 0.35):
                rr = rnd.uniform(0.09, 0.16)
                mb.blob(rnd.choice(["erz_brocken", "erz_brocken", "fels3"]), (x, y, zf(x, y) + rr * 0.35), (rr, rr * 0.8, rr * 0.65), rnd, seg=6, rings=4)
            for (x, y) in spots(rnd, 6, 0.35, 0.2):
                rr = rnd.uniform(0.04, 0.06)
                mb.blob("erz_rost", (x, y, zf(x, y) + rr * 0.3), (rr, rr, rr * 0.6), rnd, seg=5, rings=3)
            for (x, y) in spots(rnd, 8, 0.3, 0.1):
                rr = rnd.uniform(0.035, 0.06)
                mb.blob("geroell", (x, y, zf(x, y) + rr * 0.3), (rr, rr, rr * 0.6), rnd, seg=5, rings=3)
        if key == "sumpf":
            # reeds and a few cattails, low mossy humps
            for (x, y) in spots(rnd, 5, 0.5, 0.4):
                tuft(mb, rnd, x, y, zf(x, y), rnd.uniform(0.28, 0.42), mats=("schilf", "schilf_hi"))
            for (x, y) in spots(rnd, 2, 0.6, 0.5):
                hh = rnd.uniform(0.34, 0.44)
                mb.box("schilf", (x, y, zf(x, y) + hh / 2), (0.03, 0.03, hh))
                mb.box("rohrkolben", (x, y, zf(x, y) + hh + 0.05), (0.06, 0.06, 0.12))
            for (x, y) in spots(rnd, 2, 0.55, 0.45):
                mb.blob("moos", (x, y, zf(x, y)), (0.16, 0.13, 0.05), rnd, seg=7, rings=3)
        if key == "acker":
            # young crop in rows on the ridge crests, a few clods in the furrows
            along_y = var >= 2
            lim = T / 2 - 0.3
            for i in range(FURROWS):
                c = ((i + 0.25) / FURROWS - 0.5) * T          # crest of furrow i (sin maximum)
                if abs(c) > lim:
                    continue
                t = -lim + rnd.uniform(0, 0.12)
                while t < lim:
                    x, y = (t, c) if not along_y else (c, t)
                    tuft(mb, rnd, x, y, zf(x, y), rnd.uniform(0.09, 0.15), mats=("saat", "saat_hi"))
                    t += rnd.uniform(0.2, 0.3)
            for (x, y) in spots(rnd, 6, 0.3, 0.2):
                rr = rnd.uniform(0.04, 0.07)
                mb.blob("acker_dk", (x, y, zf(x, y) + rr * 0.4), (rr, rr * 0.8, rr * 0.6), rnd, seg=5, rings=3)

        if key == "huegel":
            # dry tufts, heather cushions and a few stones on the bumps
            for (x, y) in spots(rnd, 5, 0.45, 0.4):
                tuft(mb, rnd, x, y, zf(x, y), rnd.uniform(0.14, 0.22), mats=("halm", "huegel3"))
            for (x, y) in spots(rnd, 3, 0.5, 0.45):
                mb.blob("heide", (x, y, zf(x, y) + 0.03), (0.13, 0.11, 0.07), rnd, seg=6, rings=3, jitter=0.25)
                mb.blob("heide_hi", (x + 0.03, y - 0.02, zf(x, y) + 0.08), (0.06, 0.05, 0.03), rnd, seg=5, rings=3)
            for (x, y) in spots(rnd, 2 + var % 2, 0.55, 0.5):
                rr = rnd.uniform(0.07, 0.13)
                mb.blob(rnd.choice(["fels2", "fels3", "kiesel"]), (x, y, zf(x, y) + rr * 0.35), (rr, rr * 0.85, rr * 0.65), rnd, seg=6, rings=3)
        if key == "fruchtbar":
            # lush grass, a few buttercups, molehills of dark loam
            for (x, y) in spots(rnd, 8, 0.4, 0.3):
                tuft(mb, rnd, x, y, zf(x, y), rnd.uniform(0.18, 0.28), mats=("aue2", "halm_hi"))
            for (x, y) in spots(rnd, 1 + (var % 2), 0.6, 0.6):
                mb.blob("auboden", (x, y, zf(x, y)), (0.17, 0.15, 0.09), rnd, seg=7, rings=4, jitter=0.1)
                mb.blob("auboden_hi", (x - 0.03, y - 0.03, zf(x, y) + 0.06), (0.08, 0.07, 0.03), rnd, seg=5, rings=3)
            for (x, y) in spots(rnd, 2, 0.5, 0.5):
                z = zf(x, y)
                mb.box("halm", (x, y, z + 0.07), (0.025, 0.025, 0.14))
                mb.blob("bluete_g", (x, y, z + 0.16), (0.05, 0.05, 0.035), rnd, seg=5, rings=3, jitter=0.1)
        if key == "sand":
            # wind ripples (low ridges across the tile), pebbles, shells, beach grass, now and then driftwood
            a = 30 + 15 * var
            ca, sa = math.cos(math.radians(a)), math.sin(math.radians(a))
            lim = T / 2 - 0.35
            for k in range(-4, 5):
                d = k * 0.32
                t = -lim
                while t < lim:
                    ln = rnd.uniform(0.18, 0.4)
                    px, py = -sa * d + ca * (t + ln / 2), ca * d + sa * (t + ln / 2)
                    if abs(px) < lim and abs(py) < lim and rnd.random() < 0.7:
                        mb.box("sand3", (px, py, zf(px, py) + 0.006), (ln, 0.035, 0.012), rot=(0, 0, a))
                    t += ln + rnd.uniform(0.05, 0.2)
            for (x, y) in spots(rnd, 6, 0.3, 0.15):
                rr = rnd.uniform(0.03, 0.06)
                mb.blob(rnd.choice(["kiesel", "kiesel_dk", "muschel"]), (x, y, zf(x, y) + rr * 0.3), (rr, rr * 0.8, rr * 0.5), rnd, seg=5, rings=3)
            for (x, y) in spots(rnd, 2, 0.55, 0.5):
                tuft(mb, rnd, x, y, zf(x, y), rnd.uniform(0.2, 0.3), mats=("strandhafer", "halm_hi"))
            if var == 1:
                (x, y), = spots(rnd, 1, 0.65)
                mb.box("treibholz", (x, y, zf(x, y) + 0.03), (0.55, 0.06, 0.05), rot=(0, 0, rnd.uniform(0, 180)))
        if key == "gebirge":
            # coarse scree: many angular stones, the mountain sprite stands on top
            for (x, y) in spots(rnd, 4, 0.5, 0.4):
                rr = rnd.uniform(0.12, 0.2)
                mb.blob(rnd.choice(["fels3", "schotter3"]), (x, y, zf(x, y) + rr * 0.35), (rr, rr * 0.8, rr * 0.6), rnd, seg=6, rings=4)
            for (x, y) in spots(rnd, 16, 0.3, 0.1):
                rr = rnd.uniform(0.04, 0.08)
                mb.blob(rnd.choice(["geroell", "schotter2"]), (x, y, zf(x, y) + rr * 0.3), (rr, rr, rr * 0.6), rnd, seg=5, rings=3)

    class Waves:
        """Sum of travelling plane waves, periodic over the tile (integer wave numbers) and over WATER_FRAMES frames
        (each component advances `speed` whole periods per loop). Wavelets travel roughly along WIND."""

        def __init__(self, seed, n, fmin, fmax, along=None):
            r = random.Random(seed)
            self.c = []
            k = int(math.ceil(fmax))
            while len(self.c) < n:
                a, b = r.randint(-k, k), r.randint(-k, k)
                f = math.hypot(a, b)
                if not fmin <= f <= fmax:
                    continue
                d = (a * WIND[0] + b * WIND[1]) / f
                if along is not None and abs(d) < along:
                    continue                      # crests across the wind only (long, parallel wave fronts)
                speed = 1 if f < 3 else (1 if f < 6 else 2)
                # phase velocity points along -sign(c) * (a, b): pick the sign that moves with the wind
                c = -speed if d > 0 else speed
                self.c.append((a, b, r.uniform(0, 2 * math.pi), c, 1.0 / f))
            self.norm = math.sqrt(sum(c_[4] ** 2 for c_ in self.c) / 2)

        def __call__(self, u, v, frame):
            return sum(amp * math.sin(2 * math.pi * (a * u + b * v) + ph + c * 2 * math.pi * frame / WATER_FRAMES)
                       for a, b, ph, c, amp in self.c) / self.norm

    def water(mb, var, frame):
        """Calm swell picks the base tone, long wavelets across the wind give moving light crests, foam only where a
        crest rides on a high swell. Edges use shared waves (any variants fit together), the inside its own."""
        sh_s, sh_r = Waves(77, 4, 2, 3.2), Waves(78, 5, 4, 7.5, along=0.92)
        ow_s, ow_r = Waves(1077 + 31 * var, 4, 2, 3.2), Waves(1078 + 31 * var, 5, 4, 7.5, along=0.92)

        def field(a_, b_, x, y):
            u, v = x / T + 0.5, y / T + 0.5
            w = edge_weight(u, v)
            return w * a_(u, v, frame) + (1 - w) * b_(u, v, frame)
        n = 96
        g = 2 * T / n
        S = [[field(sh_s, ow_s, -T + i * g, -T + j * g) for i in range(n + 1)] for j in range(n + 1)]
        R = [[field(sh_r, ow_r, -T + i * g, -T + j * g) for i in range(n + 1)] for j in range(n + 1)]
        A, B = 0.02, 0.008
        for j in range(n):
            for i in range(n):
                x0, y0 = -T + i * g, -T + j * g
                sc_ = (S[j][i] + S[j][i + 1] + S[j + 1][i] + S[j + 1][i + 1]) / 4
                rc = (R[j][i] + R[j][i + 1] + R[j + 1][i] + R[j + 1][i + 1]) / 4
                m = "wasser2" if sc_ > 0.6 else ("wasser_dk" if sc_ < -0.85 else "wasser1")
                if rc > 1.55 and sc_ > -0.4:
                    m = "wasser_hi"
                if rc > 2.0 and sc_ > 1.0:
                    m = "schaum"
                z = [A * S[jj][ii] + B * R[jj][ii] for jj, ii in ((j, i), (j, i + 1), (j + 1, i + 1), (j + 1, i))]
                mb.add(m, [(x0, y0, z[0]), (x0 + g, y0, z[1]), (x0 + g, y0 + g, z[2]), (x0, y0 + g, z[3])], [(0, 1, 2, 3)])

    # ------------------------------------------------------------ scene
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sh = sc.display.shading
    sh.color_type = "OBJECT"
    sh.show_object_outline = False
    sh.show_specular_highlight = False
    sh.show_shadows = False
    sc.display.render_aa = "OFF"
    sc.render.film_transparent = True
    sc.render.dither_intensity = 0.0
    sc.view_settings.view_transform = "Standard"
    sc.render.image_settings.file_format = "PNG"
    sc.render.resolution_x, sc.render.resolution_y = TW * SS, TH * SS
    sc.render.resolution_percentage = 100
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = TW / PPM
    cam = bpy.data.objects.new("cam", cam_data)
    sc.collection.objects.link(cam)
    sc.camera = cam
    cos30 = math.cos(math.radians(30))
    right = Vector((0.7071, 0.7071, 0.0))
    up = Vector((-0.3536, 0.3536, cos30))
    fwd = Vector((-0.6124, 0.6124, -0.5))
    centre = right * ((TW / 2 - ANCHOR[0]) / PPM) + up * ((ANCHOR[1] - TH / 2) / PPM)
    cam.location = centre - fwd * 40
    cam.rotation_euler = (math.radians(60), 0, math.radians(45))
    cam_data.clip_end = 100

    meta = {"tile": [TW, TH], "ss": SS, "ppm": PPM, "anchor": list(ANCHOR), "types": []}
    for key, nv, nf in TYPES:
        if only and key not in only:
            continue
        os.makedirs(os.path.join(out, key), exist_ok=True)
        for v in range(nv):
            for f in range(nf):
                for o in list(bpy.data.objects):
                    if o.type != "CAMERA":
                        bpy.data.objects.remove(o, do_unlink=True)
                mb = MB()
                if key == "wasser":
                    water(mb, v, f)
                else:
                    zf = ground(mb, key, v)
                    details(mb, key, v, zf)
                objs = []
                for mat, (vv, ff) in mb.parts.items():
                    me = bpy.data.meshes.new(mat)
                    me.from_pydata(vv, [], ff)
                    bm = bmesh.new()
                    bm.from_mesh(me)
                    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
                    bm.to_mesh(me)
                    bm.free()
                    attr = me.color_attributes.new("h", "FLOAT_COLOR", "POINT")
                    vals = []
                    for vert in me.vertices:
                        z = max(vert.co.z + 0.1, 0.0) / 16.0   # +0.1 m: water troughs stay above zero
                        vals += [z, z, z, 1.0]
                    attr.data.foreach_set("color", vals)
                    me.color_attributes.active_color = attr
                    o = bpy.data.objects.new(mat, me)
                    sc.collection.objects.link(o)
                    o.color = col(PAL[mat])
                    objs.append(o)
                base = os.path.join(out, key, "v%d_f%d" % (v, f))
                sh.light, sh.color_type = "FLAT", "OBJECT"
                sh.show_cavity = False
                sc.render.image_settings.color_mode, sc.render.image_settings.color_depth = "RGBA", "8"
                sc.render.filepath = base + ".png"
                bpy.ops.render.render(write_still=True)
                cols = {o.name: tuple(o.color) for o in objs}
                for o in objs:
                    o.color = (0.8, 0.8, 0.8, 1)
                sh.light = "STUDIO"
                sh.show_cavity = True
                sh.cavity_type = "WORLD"
                sh.cavity_valley_factor = 1.0
                sh.cavity_ridge_factor = 0.0
                sc.render.filepath = base + "_l.png"
                bpy.ops.render.render(write_still=True)
                sh.show_cavity = False
                sh.light, sh.color_type = "FLAT", "VERTEX"
                sc.view_settings.view_transform = "Raw"
                sc.render.image_settings.color_mode, sc.render.image_settings.color_depth = "BW", "16"
                sc.render.filepath = base + "_h.png"
                bpy.ops.render.render(write_still=True)
                sc.view_settings.view_transform = "Standard"
                for o in objs:
                    o.color = cols[o.name]
                print("rendered", key, v, f, flush=True)
        meta["types"].append({"key": key, "variants": nv, "frames": nf})
    json.dump(meta, open(os.path.join(out, "render.json"), "w"), indent=1)


# ================================================================ pixelize part (plain Python 3)
def pixel_main():
    import argparse
    import numpy as np
    from PIL import Image

    ap = argparse.ArgumentParser()
    ap.add_argument("--style", required=True)
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--lref-src", required=True, help="figure renders of the style (light reference, as for the buildings)")
    ap.add_argument("--lscale", type=float, default=1.06)
    ap.add_argument("--only", help="comma separated terrain types (default: all in render.json)")
    ap.add_argument("--image", default="terrain.png", help="image to write the rows into")
    ap.add_argument("--merge", action="store_true",
                    help="add the keys to the existing sheet.json (with their image) instead of writing a new one")
    a = ap.parse_args()
    style = json.load(open(a.style))
    px = style.get("pixel", {})
    light = px.get("light", {})
    thresh = np.array(light.get("thresholds", [0.55, 0.85, 0.97]), np.float32)
    levels = light.get("levels", [0.58, 0.8, 1.0, 1.14])
    nb = len(levels)

    def hexrgb(h):
        h = h.lstrip("#")
        return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], np.float32)
    shadow_tint, light_tint = hexrgb(light.get("shadow_tint", "#2a2350")), hexrgb(light.get("light_tint", "#fff0c8"))
    hue = light.get("hue_shift", 0.18)
    dither = light.get("dither", 0.0)
    hatch = px.get("hatch")
    bayer = (np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]], np.float32) + 0.5) / 16
    names = list(PAL)
    ids = np.stack([hexrgb(PAL[n]) for n in names])
    mats = np.stack([hexrgb(style["colors"].get(n, PAL[n])) for n in names])
    if len({tuple(m) for m in mats.tolist()}) != len(names):
        sys.exit("terrain palette: two materials share a colour in style %s" % style.get("label"))
    prio_names = ["bluete_w", "bluete_g", "bluete_v", "bluete_r", "schaum", "halm_hi", "laub_o", "laub_g",
                  "erz_rost", "rohrkolben", "saat_hi",
                  "heide_hi", "muschel", "treibholz"]   # appended later: the order of the earlier entries is unchanged
    prio = np.array([1000.0 * (len(prio_names) - prio_names.index(n)) if n in prio_names else 0.0 for n in names], np.float32)

    def shade(base, band):
        # the same formula as pixelize.py shade(), so ground and buildings share their light steps
        k = levels[band]
        if k > 1.0:
            rgb = base + (light_tint - base) * min(1.0, (k - 1.0) * 2.5)
        else:
            rgb = base * k
            if band == 0 or (band == 1 and nb > 3):
                t = hue * (1.0 if band == 0 else 0.5)
                rgb = rgb * (1 - t) + shadow_tint * k * t
        return np.clip(np.round(rgb), 0, 255)
    SH = np.stack([np.stack([shade(m, b) for b in range(nb)]) for m in mats])
    HT = np.stack([np.clip(np.round(shade(m, 0) * hatch["factor"]), 0, 255) for m in mats]) if hatch else None

    # light reference: 99th percentile of the standing figures, as pixelize.py with --lref-src
    vals = []
    for u in json.load(open(os.path.join(a.lref_src, "render.json")))["units"]:
        l_ = np.asarray(Image.open(os.path.join(a.lref_src, u["key"], "d0_f0_l.png")).convert("RGBA")).astype(np.float32)
        vals.append(l_[..., 0][l_[..., 3] > 127])
    lref = float(np.percentile(np.concatenate(vals), 99)) / 255 * a.lscale

    yy, xx = np.mgrid[0:TH, 0:TW]
    mask = (np.abs(xx + 0.5 - 32) / 32 + np.abs(yy + 0.5 - 16) / 16) < 1
    k_px = math.cos(math.radians(30)) * PPM          # metres -> target px
    sdx, sdy = 0.62, 0.1                             # shadow direction as the buildings

    def blk(x):
        H, W = x.shape[:2]
        return x[:TH * SS, :TW * SS].reshape(TH, SS, TW, SS, *x.shape[2:]).swapaxes(1, 2).reshape(TH, TW, SS * SS, *x.shape[2:])

    def tile(base):
        img = np.asarray(Image.open(base + ".png").convert("RGBA")).astype(np.float32)
        lig = np.asarray(Image.open(base + "_l.png").convert("RGBA"))[..., 0].astype(np.float32) / 255
        z = np.asarray(Image.open(base + "_h.png")).astype(np.float32) / 65535.0 * 16.0 - 0.1
        dist = ((img[..., None, :3] - ids[None, None]) ** 2).sum(-1)
        idx = dist.argmin(-1)
        ib, lb, zb = blk(idx), blk(lig), blk(z)
        counts = (ib[..., None] == np.arange(len(names))).sum(2).astype(np.float32)
        mat = (counts + prio * (counts >= 0.2 * SS * SS)).argmax(-1)
        sel = ib == mat[..., None]
        L = (lb * sel).sum(-1) / np.maximum(sel.sum(-1), 1) / lref
        zm = (zb * sel).sum(-1) / np.maximum(sel.sum(-1), 1)
        if dither:
            L = L + (bayer[yy % 4, xx % 4] - 0.5) * dither
        band = np.searchsorted(thresh, L).astype(np.int64)
        # short cast shadows of tufts, flowers and stones on the ground around them
        ground_z = np.median(zm[mask])
        tall = (zm - ground_z) > 0.06
        shad = np.zeros((TH, TW), bool)
        for y, x in zip(*np.nonzero(tall & mask)):
            # the pixel shows a point d px above its ground foot (x, y + d); a point at height s * d of that column
            # casts its shadow to (x + s d dx, y + d - s d dy), the same direction as the buildings
            d = (zm[y, x] - ground_z) * k_px
            for s in np.linspace(0.3, 1.0, 4):
                sx, sy = int(round(x + s * d * sdx)), int(round(y + d - s * d * sdy))
                if 0 <= sx < TW and 0 <= sy < TH:
                    shad[sy, sx] = True
        shad &= ~tall
        band = np.where(shad, np.maximum(band - 1, 0), band)
        rgb = SH[mat, np.clip(band, 0, nb - 1)]
        if hatch:
            hm = (band == 0) & (((xx + yy) % hatch["every"]) == 0)
            rgb[hm] = HT[mat[hm]]
        out = np.zeros((TH, TW, 4), np.uint8)
        out[..., :3] = rgb.astype(np.uint8)
        out[..., 3] = np.where(mask, 255, 0)
        out[~mask, :3] = 0
        return out

    meta = json.load(open(os.path.join(a.src, "render.json")))
    if a.only:
        want = a.only.split(",")
        missing = [k for k in want if k not in [t["key"] for t in meta["types"]]]
        if missing:
            sys.exit("not rendered: %s" % ", ".join(missing))
        meta["types"] = [t for t in meta["types"] if t["key"] in want]
    ncols = max(t["variants"] * t["frames"] for t in meta["types"])
    sheet = Image.new("RGBA", (TW * ncols, TH * len(meta["types"])), (0, 0, 0, 0))
    keys, used = {}, set()
    for row, t in enumerate(meta["types"]):
        for v in range(t["variants"]):
            for f in range(t["frames"]):
                fr = tile(os.path.join(a.src, t["key"], "v%d_f%d" % (v, f)))
                used |= set(map(tuple, fr[fr[..., 3] == 255][:, :3]))
                sheet.paste(Image.fromarray(fr, "RGBA"), ((v * t["frames"] + f) * TW, row * TH))
        keys[t["key"]] = {"row": row, "variants": t["variants"], "frames": t["frames"]}
    # water must move: every frame of a variant differs from the others
    wt = keys.get("wasser")
    if wt and wt["frames"] > 1:
        arr = np.asarray(sheet)
        for v in range(wt["variants"]):
            fr = [arr[wt["row"] * TH:(wt["row"] + 1) * TH, (v * wt["frames"] + f) * TW:(v * wt["frames"] + f + 1) * TW] for f in range(wt["frames"])]
            for i in range(len(fr)):
                for j in range(i + 1, len(fr)):
                    if np.array_equal(fr[i], fr[j]):
                        sys.exit("water variant %d: frames %d and %d are identical" % (v, i, j))
    os.makedirs(a.out, exist_ok=True)
    sheet.save(os.path.join(a.out, a.image), optimize=True)
    if a.merge:
        # keep everything else (terrain.png, blend.png, the other keys) as it is
        sj = os.path.join(a.out, "sheet.json")
        old = json.load(open(sj))
        clash = [k for k in keys if k in old["keys"] and old["keys"][k].get("image", old.get("image")) != a.image]
        if clash:
            sys.exit("keys already in another image: %s" % ", ".join(clash))
        for k, v in keys.items():
            old["keys"][k] = dict(v, image=a.image)
        old.setdefault("images", {})[a.image] = {"colours": len(used)}
        json.dump(old, open(sj, "w"), ensure_ascii=False, indent=1)
        print("terrain", style.get("label"), a.image, "tiles:", sum(t["variants"] * t["frames"] for t in meta["types"]), "colours:", len(used))
        return
    blend_masks().save(os.path.join(a.out, "blend.png"), optimize=True)
    json.dump({"style": style.get("label"), "tile": [TW, TH], "anchor": list(ANCHOR), "image": a.image, "keys": keys,
               "layout": "row = terrain type, column = variant * frames + frame",
               "mask": "pixel (x, y) belongs to the tile if |x + 0.5 - 32| / 32 + |y + 0.5 - 16| / 16 < 1; tiles at offsets (32, 16) fit without gaps or overlaps",
               "fps": 4, "colours": len(used),
               "blend": {"image": "blend.png", "tile": [TW, TH], "edges": BLEND_EDGES, "variants": BLEND_VARIANTS},
               "blend_note": "row = edge of the screen diamond (ne = between top and right corner), column = variant; white, "
                             "alpha 0 or 255. Draw the tile of a neighbour with higher priority (wasser < erde < fels < "
                             "waldboden < gras < wiese) over the tile, cut by the mask of the shared edge"},
              open(os.path.join(a.out, "sheet.json"), "w"), ensure_ascii=False, indent=1)
    print("terrain", style.get("label"), "tiles:", sum(t["variants"] * t["frames"] for t in meta["types"]), "colours:", len(used))


if __name__ == "__main__":
    try:
        import bpy  # noqa: F401
        blender_main()
    except ImportError:
        pixel_main()
