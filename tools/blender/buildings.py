"""Procedural medieval buildings, rendered from the same fixed 2:1 iso camera as the figures.

Run (from project root):
  blender -b --factory-startup --python-exit-code 1 -P tools/blender/buildings.py -- \
      --out .local/blender/buildings [--only turm,mauer]

Per building, view d (model turned by d x 90 degrees about the vertical axis) and variant f it writes
  d<d>_f<f>.png    flat colours (the shared palette in buildings/palette.json, exact)
  d<d>_f<f>_l.png  light only (camera-relative studio light, contact darkening)
  d<d>_f<f>_h.png  height above ground per pixel (16 bit, value = metres / 16), for cast shadows
  d<d>_f<f>_m.png  only for buildings with "front": parts in front of the walkway (parapet towards the camera)
and render.json. Scale: one tile is 64 x 32 px, one height step 16 px = 1.04 m, a 1.8 m figure about 28 px tall
(32 px per 1.8 m in the image plane, the same PPM as the figures).
The geometry is built from simple solids into one mesh per material (fast, exact heights per vertex).
"""
import bpy
import bmesh
from mathutils import Euler, Matrix, Vector
import json
import math
import os
import random
import sys

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    if name in ARGS:
        i = ARGS.index(name)
        return ARGS[i + 1] if i + 1 < len(ARGS) and not ARGS[i + 1].startswith("--") else True
    return default


HERE = os.path.dirname(os.path.abspath(__file__))
OUT = arg("--out")
ONLY = arg("--only")
os.makedirs(OUT, exist_ok=True)
PAL = {k: v for k, v in json.load(open(os.path.join(HERE, "buildings", "palette.json"))).items() if not k.startswith("_")}
DEFS = json.load(open(os.path.join(HERE, "buildings", "buildings.json")))

PPM = 32 / 1.8                                            # pixels per metre (figure 1.8 m = 32 px)
T = 64 / (math.sqrt(2) * PPM)                             # tile edge in metres (64 x 32 px diamond)
STEP = 16 / (math.cos(math.radians(30)) * PPM)            # one height step (16 px) in metres
SS = 4
CELL_W, CELL_H = 320, 256
ANCHOR = (144, 184)                                       # footprint centre in the cell (px)
DIRS = ["0", "90", "180", "270"]


# ---------------------------------------------------------------- colours
def lin(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def col(hexstr):
    h = hexstr.lstrip("#")
    return (lin(int(h[0:2], 16)), lin(int(h[2:4], 16)), lin(int(h[4:6], 16)), 1.0)


# ---------------------------------------------------------------- mesh builder
class MB:
    """Collects solids per (material, group) in building coordinates; one Blender object per key."""

    def __init__(self, seed):
        self.parts = {}
        self.seed = seed
        self.rnd = random.Random(seed)
        self.M = Matrix.Identity(4)
        self.view = 0  # cutaway buildings are built per view (walls towards the camera stay low)

    def at(self, loc=(0, 0, 0), rz=0.0):
        mb = self

        class Ctx:
            def __enter__(self):
                self.old = mb.M
                mb.M = mb.M @ Matrix.Translation(Vector(loc)) @ Matrix.Rotation(math.radians(rz), 4, "Z")

            def __exit__(self, *a):
                mb.M = self.old
        return Ctx()

    def add(self, mat, verts, faces, group=None):
        if mat not in PAL:
            raise KeyError("material '%s' missing in buildings/palette.json" % mat)
        v, f = self.parts.setdefault((mat, group), ([], []))
        o = len(v)
        v.extend(tuple(self.M @ Vector(p)) for p in verts)
        f.extend(tuple(i + o for i in fc) for fc in faces)

    def box(self, mat, c, s, rot=(0, 0, 0), group=None):
        hx, hy, hz = s[0] / 2, s[1] / 2, s[2] / 2
        R = Matrix.Translation(Vector(c)) @ Euler([math.radians(a) for a in rot]).to_matrix().to_4x4()
        pts = [(-hx, -hy, -hz), (hx, -hy, -hz), (hx, hy, -hz), (-hx, hy, -hz),
               (-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz)]
        faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
        self.add(mat, [tuple(R @ Vector(p)) for p in pts], faces, group)

    def bx(self, mat, x0, x1, y0, y1, z0, z1, group=None):
        self.box(mat, ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), (x1 - x0, y1 - y0, z1 - z0), group=group)

    def cyl(self, mat, c, r, h, n=8, rot=(0, 0, 0), r2=None, group=None):
        r2 = r if r2 is None else r2
        R = Matrix.Translation(Vector(c)) @ Euler([math.radians(a) for a in rot]).to_matrix().to_4x4()
        pts = []
        for z, rr in ((-h / 2, r), (h / 2, r2)):
            for i in range(n):
                a = 2 * math.pi * (i + 0.5) / n
                pts.append((rr * math.cos(a), rr * math.sin(a), z))
        faces = [tuple(range(n - 1, -1, -1)), tuple(range(n, 2 * n))]
        faces += [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
        if r2 == 0:  # cone: collapse the top ring into one point
            pts = pts[:n] + [(0, 0, h / 2)]
            faces = [tuple(range(n - 1, -1, -1))] + [(i, (i + 1) % n, n) for i in range(n)]
        self.add(mat, [tuple(R @ Vector(p)) for p in pts], faces, group)

    def blob(self, mat, c, r, seg=8, rings=6, jitter=0.12):
        """Lumpy low-poly sphere (foliage, rock)."""
        pts = [(0, 0, -r[2])]
        for j in range(1, rings):
            th = math.pi * j / rings
            for i in range(seg):
                ph = 2 * math.pi * (i + 0.5 * (j % 2)) / seg
                k = 1 + self.rnd.uniform(-jitter, jitter)
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

    def prism_gable(self, mat, L, B, z0, h, group=None):
        """Solid gable along x: half depth B at z0, ridge at z0 + h."""
        x = L / 2
        pts = [(-x, -B, z0), (x, -B, z0), (x, B, z0), (-x, B, z0), (-x, 0, z0 + h), (x, 0, z0 + h)]
        faces = [(0, 3, 2, 1), (0, 1, 5, 4), (2, 3, 4, 5), (0, 4, 3), (1, 2, 5)]
        self.add(mat, pts, faces, group)


# ---------------------------------------------------------------- building blocks
def masonry(mb, x0, x1, y0, y1, z0, z1, row=0.36, joint=0.085, skin=0.05, top=True, sides="nesw", group=None, cap="stone_top"):
    """Stone block wall: mortar core with a skin of staggered blocks (two stone tones) on the given sides."""
    r = mb.rnd
    mb.bx("mortar", x0 + skin, x1 - skin, y0 + skin, y1 - skin, z0, z1 - (0.02 if top else 0), group=group)
    n = max(1, round((z1 - z0) / row))
    rh = (z1 - z0) / n

    def course(axis_len, place):
        for k in range(n):
            pos = -r.uniform(0.0, 0.5) if k % 2 else 0.0
            while pos < axis_len - 1e-6:
                L = r.uniform(0.42, 0.85)
                end = min(axis_len, pos + L)
                if axis_len - end < 0.25:
                    end = axis_len
                a, b = max(pos, 0.0), end - (joint if end < axis_len else 0.0)
                if b - a > 0.08:
                    m = "stone2" if r.random() < 0.28 else "stone"
                    place(m, a, b, z0 + k * rh + (joint / 2 if k else 0), z0 + (k + 1) * rh - joint / 2)
                pos = end
    if "s" in sides:  # face at y0, outward -y
        course(x1 - x0, lambda m, a, b, za, zb: mb.bx(m, x0 + a, x0 + b, y0, y0 + skin, za, zb, group=group))
    if "n" in sides:
        course(x1 - x0, lambda m, a, b, za, zb: mb.bx(m, x1 - b, x1 - a, y1 - skin, y1, za, zb, group=group))
    if "e" in sides:  # face at x1, outward +x
        course(y1 - y0 - 2 * skin, lambda m, a, b, za, zb: mb.bx(m, x1 - skin, x1, y0 + skin + a, y0 + skin + b, za, zb, group=group))
    if "w" in sides:
        course(y1 - y0 - 2 * skin, lambda m, a, b, za, zb: mb.bx(m, x0, x0 + skin, y1 - skin - b, y1 - skin - a, za, zb, group=group))
    if top:
        mb.bx(cap, x0, x1, y0, y1, z1 - 0.06, z1, group=group)


def battlements(mb, x0, x1, y0, y1, z, h=0.95, th=0.42, merlon=0.62, gap=0.48, sides="nesw", side_groups=None, centred=False):
    """Parapet with merlons around a platform edge (or on chosen sides). side_groups maps side -> group name.
    centred: half gaps at both ends, so pieces laid end to end keep an even rhythm (wall tiles)."""
    def run(side, ax0, ax1, place):
        g = (side_groups or {}).get(side)
        length = ax1 - ax0
        if centred:
            k = max(1, round(length / (merlon + gap)))
            mw = (length - k * gap) / k
            a0 = ax0 + gap / 2
        else:
            k = max(1, round((length + gap) / (merlon + gap)))
            mw = (length - (k - 1) * gap) / k
            a0 = ax0
        place(g, ax0, ax1, z, z + h * 0.42, "stone")          # low breastwork
        for i in range(k):
            a = a0 + i * (mw + gap)
            place(g, a, a + mw, z + h * 0.42, z + h, "stone2" if i % 3 == 1 else "stone")
            place(g, a - 0.02, a + mw + 0.02, z + h, z + h + 0.07, "stone_top")
    if "s" in sides:
        run("s", x0, x1, lambda g, a, b, za, zb, m: mb.bx(m, a, b, y0, y0 + th, za, zb, group=g))
    if "n" in sides:
        run("n", x0, x1, lambda g, a, b, za, zb, m: mb.bx(m, a, b, y1 - th, y1, za, zb, group=g))
    if "e" in sides:
        run("e", y0 + th, y1 - th, lambda g, a, b, za, zb, m: mb.bx(m, x1 - th, x1, a, b, za, zb, group=g))
    if "w" in sides:
        run("w", y0 + th, y1 - th, lambda g, a, b, za, zb, m: mb.bx(m, x0, x0 + th, a, b, za, zb, group=g))


def timber_frame(mb, x0, x1, y0, y1, z0, z1, beam=0.12, out=0.035, spacing=1.0, braces=True):
    """Plastered box with half-timbering on all four faces."""
    mb.bx("plaster", x0, x1, y0, y1, z0, z1)
    mid = z0 + (z1 - z0) * 0.48

    def face(length, place):
        k = max(1, round(length / spacing))
        xs = [i * length / k for i in range(k + 1)]
        place(0, length, z0, z0 + beam)                 # sill
        place(0, length, z1 - beam, z1)                 # top plate
        place(0, length, mid - beam / 2, mid + beam / 2)  # rail
        for i, x in enumerate(xs):
            a = min(max(x - beam / 2, 0), length - beam)
            place(a, a + beam, z0, z1)
        return xs
    sides = [
        (x1 - x0, lambda a, b, za, zb: mb.bx("timber", x0 + a, x0 + b, y0 - out, y0, za, zb)),
        (x1 - x0, lambda a, b, za, zb: mb.bx("timber", x0 + a, x0 + b, y1, y1 + out, za, zb)),
        (y1 - y0, lambda a, b, za, zb: mb.bx("timber", x1, x1 + out, y0 + a, y0 + b, za, zb)),
        (y1 - y0, lambda a, b, za, zb: mb.bx("timber", x0 - out, x0, y0 + a, y0 + b, za, zb)),
    ]
    for n, (length, place) in enumerate(sides):
        xs = face(length, place)
        if braces and len(xs) > 2:
            # diagonal braces in the outer lower panels
            for (a, b) in ((xs[0], xs[1]), (xs[-2], xs[-1])):
                ph = mid - z0
                d = math.hypot(b - a, ph)
                ang = math.degrees(math.atan2(ph, b - a)) * (1 if a == xs[0] else -1)
                cxl, czl = (a + b) / 2, (z0 + mid) / 2
                if n == 0:
                    mb.box("timber", (x0 + cxl, y0 - out / 2, czl), (d, out, beam), rot=(0, -ang, 0))
                elif n == 1:
                    mb.box("timber", (x0 + cxl, y1 + out / 2, czl), (d, out, beam), rot=(0, -ang, 0))
                elif n == 2:
                    mb.box("timber", (x1 + out / 2, y0 + cxl, czl), (out, d, beam), rot=(ang, 0, 0))
                else:
                    mb.box("timber", (x0 - out / 2, y0 + cxl, czl), (out, d, beam), rot=(ang, 0, 0))


def gable_roof(mb, L, B, z0, h, mat, ov=0.35, row=0.45, thick=0.09, gable="plaster", ridge=None, edge=None, B_wall=None):
    """Roof with the ridge along local x: a solid gable fill under rows of overlapping slabs (thatch, shingles, tiles)."""
    bw = B_wall if B_wall is not None else B - ov
    mb.prism_gable(gable, L, bw, z0, h * bw / B)
    a = math.atan2(h, B)
    S = B / math.cos(a)
    n = max(2, round(S / row))
    if mat == "thatch":
        # thatch: one thick slab per side, straw streaks running down the slope
        r = mb.rnd
        z_e = z0 - (B - bw) * math.tan(a)
        for s in (-1, 1):
            c = (0, s * B / 2, z_e + h / 2 + thick * 0.5)
            mb.box(mat, c, (L + 2 * ov, S + 0.05, thick), rot=(-s * math.degrees(a), 0, 0))
            x = -L / 2 - ov
            while x < L / 2 + ov - 0.05:
                w = r.uniform(0.06, 0.16)
                lift = r.uniform(0.01, 0.05)
                m = "thatch_dk" if r.random() < 0.3 else mat
                frac = r.uniform(0.3, 1.0)
                sl = S * frac
                d0 = S - sl  # streaks start at the eave, shorter ones stop below the ridge
                dc = d0 + sl / 2
                yy = s * (B - dc * math.cos(a))
                zz = z_e + dc * math.sin(a) + thick + lift / 2
                mb.box(m, (min(x + w / 2, L / 2 + ov - 0.02), yy, zz), (w * 0.92, sl, lift), rot=(-s * math.degrees(a), 0, 0))
                x += w
            for q in (1, 2, 3):  # courses: a darker step every quarter of the slope
                dc = S * q / 4
                yy = s * (B - dc * math.cos(a))
                zz = z_e + dc * math.sin(a) + thick + 0.03
                mb.box("thatch_dk", (0, yy, zz), (L + 2 * ov, 0.07, 0.06), rot=(-s * math.degrees(a), 0, 0))
        if ridge:
            zt = z_e + h + thick * 0.6
            mb.box(ridge, (0, 0, zt), (L + 2 * ov + 0.04, 0.42, thick * 1.2))
        return
    for s in (-1, 1):
        for i in range(n):
            d = (i + 0.5) * S / n
            y = s * (B - d * math.cos(a))
            z = z0 - (B - bw) * math.tan(a) + d * math.sin(a) + thick * 0.55
            m = edge if (edge and i == 0) else mat
            tilt = math.degrees(a) - 7.0  # each row shows a lit lower edge and a shadow line
            # single tiles / shingles with small gaps, staggered per row
            piece = 0.3 if mat == "roof_tile" else 0.26
            x = -L / 2 - ov - (piece / 2 if i % 2 else 0.0)
            while x < L / 2 + ov - 1e-6:
                xa, xb = max(x, -L / 2 - ov), min(x + piece - 0.035, L / 2 + ov)
                if xb - xa > 0.04:
                    mb.box(m, ((xa + xb) / 2, y, z), (xb - xa, S / n * 1.18, thick), rot=(-s * tilt, 0, 0))
                x += piece
            mb.box("mortar" if mat == "roof_tile" else "timber", (0, y, z - thick * 0.4), (L + 2 * ov - 0.02, S / n * 1.1, thick * 0.5), rot=(-s * tilt, 0, 0))
    if ridge:
        zt = z0 - (B - bw) * math.tan(a) + h + thick * 0.6
        mb.box(ridge, (0, 0, zt), (L + 2 * ov + 0.04, 0.34, thick * 1.6))
        mb.box(ridge, (0, 0, zt - thick * 0.6), (L + 2 * ov + 0.04, 0.5, thick))


def door(mb, face, c, w=0.9, h=1.8, mat="door", frame="timber", out=0.04):
    """Door on face 's' (y = c[1], outward -y) or 'e' (x = c[0], outward +x); c = centre bottom."""
    x, y, z = c
    if face == "s":
        mb.bx(frame, x - w / 2 - 0.1, x + w / 2 + 0.1, y - out, y, z, z + h + 0.12)
        mb.bx(mat, x - w / 2, x + w / 2, y - out - 0.03, y - out + 0.01, z, z + h)
        for k in (-1, 1):
            mb.bx("iron", x - w / 2 + 0.06, x + w / 2 - 0.06, y - out - 0.05, y - out - 0.02, z + h * (0.5 + 0.3 * k) - 0.03, z + h * (0.5 + 0.3 * k) + 0.03)
    else:
        mb.bx(frame, x, x + out, y - w / 2 - 0.1, y + w / 2 + 0.1, z, z + h + 0.12)
        mb.bx(mat, x + out - 0.01, x + out + 0.03, y - w / 2, y + w / 2, z, z + h)


def window(mb, face, c, w=0.55, h=0.55, shutters=True):
    x, y, z = c
    if face == "s":
        mb.bx("timber", x - w / 2 - 0.08, x + w / 2 + 0.08, y - 0.05, y, z - 0.08, z + h + 0.08)
        mb.bx("window", x - w / 2, x + w / 2, y - 0.07, y - 0.04, z, z + h)
        if shutters:
            for k in (-1, 1):
                mb.bx("wood_hi", x + k * (w / 2 + 0.08) + (0 if k > 0 else -w / 2), x + k * (w / 2 + 0.08) + (w / 2 if k > 0 else 0), y - 0.09, y - 0.05, z, z + h)
    else:
        mb.bx("timber", x, x + 0.05, y - w / 2 - 0.08, y + w / 2 + 0.08, z - 0.08, z + h + 0.08)
        mb.bx("window", x + 0.04, x + 0.07, y - w / 2, y + w / 2, z, z + h)
        if shutters:
            for k in (-1, 1):
                a = y + k * (w / 2 + 0.08)
                mb.bx("wood_hi", x + 0.05, x + 0.09, min(a, a + k * w / 2), max(a, a + k * w / 2), z, z + h)


def log(mb, c, length, r=0.14, axis="x", mat="log"):
    rot = (0, 90, 0) if axis == "x" else (90, 0, 0)
    mb.cyl(mat, c, r, length, n=8, rot=rot)
    for k in (-1, 1):
        e = list(c)
        e[0 if axis == "x" else 1] += k * (length / 2 + 0.006)
        mb.cyl("wood_hi", tuple(e), r * 0.86, 0.02, n=8, rot=rot)


def log_pile(mb, x, y, z, level, length=1.6, r=0.14, axis="x"):
    """Pyramid of logs; level = number of courses (0 = nothing)."""
    for k in range(level):
        cnt = 4 - k
        for i in range(cnt):
            off = (i - (cnt - 1) / 2) * 2 * r * 1.02
            p = (x, y + off, z + r + k * r * 1.75) if axis == "x" else (x + off, y, z + r + k * r * 1.75)
            log(mb, p, length * (1 - 0.05 * ((i + k) % 2)), r, axis)


def block_stack(mb, x, y, z, level, size=0.5, grid=3, maxlevel=4):
    """Stacked stone blocks; the random draws always run for maxlevel courses, so a higher level only adds blocks."""
    for k in range(maxlevel):
        g = max(1, grid - k // 2)
        for i in range(g):
            for j in range(g):
                skip = k and mb.rnd.random() < 0.12
                s = size * mb.rnd.uniform(0.9, 1.0)
                if skip or k >= level:
                    continue
                off = (g - 1) / 2
                cx = x + (i - off) * size * 1.06
                cy = y + (j - off) * size * 1.06
                mb.box("stone2" if (i + j + k) % 3 == 0 else "stone", (cx, cy, z + s * 0.4 + k * size * 0.8), (s, s, s * 0.8))


def pallet(mb, x, y, z, w, d):
    for i in range(3):
        yy = y + (i - 1) * (d / 2 - 0.06)
        mb.bx("wood", x - w / 2, x + w / 2, yy - 0.05, yy + 0.05, z, z + 0.08)
    for i in range(4):
        xx = x + (i - 1.5) * (w - 0.12) / 3
        mb.bx("wood_hi", xx - 0.07, xx + 0.07, y - d / 2, y + d / 2, z + 0.08, z + 0.12)


def barrel(mb, x, y, z, r=0.3, h=0.75, upright=True):
    rot = (0, 0, 0) if upright else (90, 0, 0)
    mb.cyl("barrel", (x, y, z + (h / 2 if upright else r)), r, h, n=10, rot=rot)
    for t in (-0.32, 0.32):
        if upright:
            mb.cyl("iron", (x, y, z + h / 2 + t * h), r * 1.03, 0.05, n=10)
        else:
            mb.cyl("iron", (x, y + t * h, z + r), r * 1.03, 0.05, n=10, rot=rot)
    if upright:
        mb.cyl("wood_hi", (x, y, z + h + 0.005), r * 0.9, 0.02, n=10)


def crate(mb, x, y, z, s=0.55, rz=0.0):
    with mb.at((x, y, z), rz):
        mb.box("crate", (0, 0, s / 2), (s, s, s))
        for k in (-1, 1):
            mb.box("wood", (0, 0, s / 2 + k * s * 0.3), (s + 0.02, s + 0.02, 0.06))
        mb.box("wood", (0, 0, s + 0.01), (s * 0.12, s + 0.02, 0.03))


def banner(mb, x, y, z, h=3.2, w=0.6, bh=1.25, face="s", group=None):
    """Pole with a team-coloured cloth and a gold chevron (the house sign, not a cross)."""
    mb.cyl("wood", (x, y, z + h / 2), 0.06, h, n=6, group=group)
    mb.cyl("gold", (x, y, z + h + 0.06), 0.09, 0.12, n=6, group=group)
    zt = z + h - 0.12
    arm = w * 0.62
    if face == "s":
        mb.box("wood", (x, y - 0.08, zt), (w + 0.12, 0.06, 0.06), group=group)
        mb.bx("team", x - w / 2, x + w / 2, y - 0.12, y - 0.07, zt - bh, zt, group=group)
        for k in (-1, 1):
            mb.box("gold", (x + k * w * 0.22, y - 0.12, zt - bh * 0.55), (arm, 0.02, 0.12), rot=(0, k * 38, 0), group=group)
    else:
        mb.box("wood", (x + 0.08, y, zt), (0.06, w + 0.12, 0.06), group=group)
        mb.bx("team", x + 0.07, x + 0.12, y - w / 2, y + w / 2, zt - bh, zt, group=group)
        for k in (-1, 1):
            mb.box("gold", (x + 0.12, y + k * w * 0.22, zt - bh * 0.55), (0.02, arm, 0.12), rot=(-k * 38, 0, 0), group=group)


def ground(mb, mat, x0, x1, y0, y1, z=0.0, ragged=0.25):
    """Flat ground patch with a slightly irregular edge (few px high, no shadow)."""
    r = mb.rnd
    inset = ragged * 0.5
    mb.bx(mat, x0 + inset, x1 - inset, y0 + inset, y1 - inset, z, z + 0.03)
    for i in range(28):
        t = r.uniform(0.04, 0.96)
        e = r.choice("nesw")
        rr = r.uniform(0.08, 0.08 + ragged * 0.6)
        d = inset + r.uniform(-0.05, 0.1)  # centre a little inside the edge, never beyond the footprint
        if e in "ns":
            xx, yy = x0 + t * (x1 - x0), (y0 + d if e == "s" else y1 - d)
        else:
            xx, yy = (x1 - d if e == "e" else x0 + d), y0 + t * (y1 - y0)
        xx = min(max(xx, x0 + rr), x1 - rr)
        yy = min(max(yy, y0 + rr), y1 - rr)
        mb.cyl(mat, (xx, yy, z + 0.015), rr, 0.03, n=7)
    if mat in ("gravel", "dirt"):
        for i in range(int((x1 - x0) * (y1 - y0) * 1.2)):
            mb.blob("rock" if mat == "gravel" else "gravel", (r.uniform(x0 + 0.2, x1 - 0.2), r.uniform(y0 + 0.2, y1 - 0.2), 0.03),
                    (0.07, 0.06, 0.04), seg=5, rings=3, jitter=0.2)


def fence(mb, pts, h=0.95, step=1.1, gaps=(), groups=None):
    """Post-and-rail fence along a polyline in the ground plane; gaps = list of (segment index),
    groups = group name per segment (front mask)."""
    for si in range(len(pts) - 1):
        g = groups[si] if groups else None
        (ax, ay), (bx_, by) = pts[si], pts[si + 1]
        L = math.hypot(bx_ - ax, by - ay)
        n = max(1, round(L / step))
        if si in gaps:
            continue
        for i in range(n + 1):
            t = i / n
            mb.box("wood", (ax + (bx_ - ax) * t, ay + (by - ay) * t, h / 2), (0.11, 0.11, h), group=g)
        ang = math.degrees(math.atan2(by - ay, bx_ - ax))
        for zr in (0.42, 0.82):
            mb.box("wood_hi", ((ax + bx_) / 2, (ay + by) / 2, h * zr), (L, 0.06, 0.08), rot=(0, 0, ang), group=g)


# ---------------------------------------------------------------- buildings
def b_haus(mb, var):
    b_haus_body(mb)
    haus_garden(mb)


def b_haus_body(mb):
    W, D = 3.9, 3.2
    masonry(mb, -W / 2 - 0.1, W / 2 + 0.1, -D / 2 - 0.1, D / 2 + 0.1, 0, 0.42, row=0.21, top=True)
    timber_frame(mb, -W / 2, W / 2, -D / 2, D / 2, 0.42, 2.75, spacing=0.98)
    gable_roof(mb, W, D / 2 + 0.5, 2.75, 2.35, "thatch", ov=0.38, row=0.42, thick=0.2, gable="plaster", ridge="thatch_dk", edge="thatch_dk")
    masonry(mb, 0.75, 1.3, 0.25, 0.8, 2.6, 5.35, row=0.27)
    mb.bx("mortar", 0.82, 1.23, 0.32, 0.73, 5.33, 5.37)
    door(mb, "s", (-0.65, -D / 2, 0.42), h=1.95)
    mb.bx("stone_top", -1.15, -0.15, -D / 2 - 0.38, -D / 2 - 0.1, 0, 0.21)
    window(mb, "s", (0.85, -D / 2, 1.35))
    window(mb, "e", (W / 2, 0.0, 1.35))
    with mb.at((-W / 2 - 0.15, -D / 2 - 0.55, 0)):
        barrel(mb, 0, 0, 0)
    # bench and woodpile against the right wall
    mb.bx("wood", 0.1, 1.5, -D / 2 - 0.55, -D / 2 - 0.25, 0.4, 0.47)
    for x in (0.2, 1.4):
        mb.bx("wood", x - 0.05, x + 0.05, -D / 2 - 0.5, -D / 2 - 0.3, 0, 0.4)
    log_pile(mb, W / 2 + 0.38, 0.6, 0, 3, length=0.7, r=0.1, axis="y")


def haus_garden(mb):
    ground(mb, "dirt", -2.3, 2.4, -2.45, -3.2 / 2 - 0.05, ragged=0.1)


def b_holzfaeller(mb, var):
    # hut in the back corner (-x, +y); the yard pile is split onto the two side corners, so one half shows in every view
    W, D = 2.6, 2.1
    cx, cy = -1.15, 1.2
    r = 0.13
    ground(mb, "dirt", -2.5, 2.5, -2.5, 2.5, ragged=0.3)
    with mb.at((cx, cy, 0)):
        mb.bx("log", -W / 2 + 0.1, W / 2 - 0.1, -D / 2 + 0.1, D / 2 - 0.1, 0, 2.05)
        k, z = 0, r
        while z < 2.1:
            if k % 2 == 0:
                for yy in (-D / 2, D / 2):
                    mb.cyl("log", (0, yy, z), r, W + 0.4, n=8, rot=(0, 90, 0))
            else:
                for xx in (-W / 2, W / 2):
                    mb.cyl("log", (xx, 0, z), r, D + 0.4, n=8, rot=(90, 0, 0))
            k += 1
            z += r
        gable_roof(mb, W + 0.2, D / 2 + 0.45, 2.15, 1.35, "shingle", ov=0.3, row=0.3, thick=0.07, gable="wood", ridge="timber")
        door(mb, "s", (-0.45, -D / 2 - r, 0.0), w=0.9, h=1.95)
        window(mb, "s", (0.75, -D / 2 - r, 1.0), w=0.45, h=0.4)
        window(mb, "e", (W / 2 + r, 0.1, 1.0), w=0.45, h=0.4)
    # chopping block with axe (front corner)
    with mb.at((1.8, -1.8, 0)):
        mb.cyl("wood", (0, 0, 0.25), 0.27, 0.5, n=9)
        mb.cyl("wood_hi", (0, 0, 0.505), 0.25, 0.02, n=9)
        mb.box("wood_hi", (0.15, 0.05, 0.72), (0.06, 0.06, 0.6), rot=(0, 25, 0))
        mb.box("steel", (0.05, 0.05, 0.52), (0.22, 0.04, 0.14), rot=(0, 25, 0))
        for q in range(5):  # split billets
            a_ = q * 72 + 20
            mb.box("wood_hi", (0.55 * math.cos(math.radians(a_)), 0.55 * math.sin(math.radians(a_)), 0.07), (0.32, 0.1, 0.1), rot=(0, 0, a_))
    # saw horse with a log
    with mb.at((0.35, -1.95, 0)):
        for x in (-0.3, 0.3):
            mb.box("wood", (x, -0.15, 0.38), (0.08, 0.08, 0.85), rot=(18, 0, 0))
            mb.box("wood", (x, 0.15, 0.38), (0.08, 0.08, 0.85), rot=(-18, 0, 0))
        log(mb, (0.0, 0.0, 0.72), 1.4, r=0.13)
    # output pile (Hofstapel) in two halves on the side corners: 0, 2, 4 courses each
    log_pile(mb, 1.65, 1.55, 0, [0, 2, 4][var], length=1.7, r=0.16, axis="y")
    log_pile(mb, -1.55, -1.65, 0, [0, 2, 4][var], length=1.7, r=0.16, axis="x")


def b_steinbruch(mb, var):
    S = 3 * T / 2
    ground(mb, "gravel", -S + 0.1, S - 0.1, -S + 0.1, S - 0.1, ragged=0.3)
    r = mb.rnd
    # rock outcrop at the back: a hill of lumpy boulders, cut into two terraces towards the front
    # many smaller boulders (not a few big facets), radius capped so nothing leaves the footprint, at most ~2.3 m high
    for i in range(26):
        x = -S + 0.9 + i * (2 * S - 1.8) / 25 + r.uniform(-0.25, 0.25)
        y = r.uniform(1.6, S - 0.9)
        rx = min(r.uniform(0.6, 0.95), S - abs(x) - 0.12)
        ry = min(r.uniform(0.55, 0.85), S - y - 0.12)
        mb.blob("rock" if i % 3 else "rock_dk", (x, y, r.uniform(0.7, 1.3)), (rx, ry, r.uniform(0.8, 1.05)), seg=7, rings=5, jitter=0.2)
    for i in range(10):
        x = r.uniform(-S + 1.0, S - 1.0)
        y = r.uniform(2.0, S - 1.0)
        mb.blob("rock_dk" if i % 2 else "rock", (x, y, r.uniform(1.6, 1.9)), (0.45, 0.42, 0.38), seg=6, rings=4, jitter=0.25)
    # fresh cut faces (lighter stone) with chisel lines, stepping down to the quarry floor
    for (x0, x1, y0, y1, h) in ((-S + 0.5, 1.9, 0.75, 2.4, 2.2), (-S + 0.6, 0.2, -0.35, 0.8, 1.15)):
        mb.bx("rock_cut", x0, x1, y0, y1, 0, h)
        for zz in [h * k / 4 for k in (1, 2, 3)]:
            mb.bx("stone2", x0 - 0.02, x1 + 0.02, y0 - 0.03, y0 + 0.02, zz - 0.04, zz)
        for xx in (x0 + (x1 - x0) * t for t in (0.3, 0.62)):
            mb.bx("stone2", xx - 0.03, xx + 0.03, y0 - 0.03, y0 + 0.02, 0, h)
    mb.blob("rock", (1.9, 0.4, 0.7), (0.8, 0.7, 0.8), seg=7, rings=5, jitter=0.2)
    mb.blob("rock_dk", (-S + 0.5, 0.2, 0.5), (0.6, 0.6, 0.6), seg=7, rings=5, jitter=0.2)
    for i in range(7):  # rubble
        mb.blob("rock", (r.uniform(-1.5, 2.5), r.uniform(-2.0, 0.3), 0.08), (0.18, 0.15, 0.12), seg=5, rings=3, jitter=0.25)
    # derrick crane
    mb.box("wood", (1.9, -0.9, 2.4), (0.18, 0.18, 4.8))
    mb.box("wood", (1.25, -1.45, 3.95), (0.12, 0.12, 2.3), rot=(28, -32, 0))
    mb.box("rope", (0.7, -1.95, 3.2), (0.03, 0.03, 2.4))
    mb.box("stone", (0.7, -1.95, 1.85), (0.5, 0.45, 0.4))
    for a in (0, 120, 240):
        mb.box("wood", (1.9 + 0.5 * math.cos(math.radians(a)), -0.9 + 0.5 * math.sin(math.radians(a)), 0.5), (0.1, 0.1, 1.2), rot=(0, 0, 0))
    # lean-to shed
    for (x, y, h) in ((-3.2, -3.2, 2.1), (-1.8, -3.2, 2.1), (-3.2, -1.9, 2.5), (-1.8, -1.9, 2.5)):
        mb.box("wood", (x, y, h / 2), (0.12, 0.12, h))
    mb.box("shingle", (-2.5, -2.55, 2.38), (1.9, 1.75, 0.08), rot=(-13, 0, 0))
    mb.bx("wood", -3.1, -1.9, -3.0, -2.1, 0.6, 0.68)
    # output pile of cut blocks
    block_stack(mb, 2.45, -2.45, 0, [0, 2, 4][var], size=0.48, grid=3)


def b_lager(mb, var):
    S = 3 * T / 2
    ground(mb, "dirt", -S + 0.05, S - 0.05, -S + 0.05, S - 0.05, ragged=0.05)
    e = S - 0.15
    fence(mb, [(-0.8, -e), (-e, -e), (-e, e), (e, e), (e, -e), (0.8, -e)])
    lvl = var  # 0..4
    c = 2 * S / 3
    slots = {(-1, 1): "wood", (0, 1): "wood", (1, 1): "stone", (-1, 0): "stone", (1, 0): "iron",
             (-1, -1): "barrels", (1, -1): "crates", (0, 0): "weapons"}
    base_rnd = mb.rnd
    for si, ((i, j), kind) in enumerate(slots.items()):
        x, y = i * c, j * c
        mb.rnd = random.Random(1000 * mb.seed + si)
        for q in range(5):  # floor of five planks
            y_ = y - 0.95 + q * 0.38
            mb.bx("wood" if q % 2 else "wood_hi", x - 0.95, x + 0.95, y_ + 0.02, y_ + 0.36, 0.03, 0.06)
        if kind == "wood":
            log_pile(mb, x, y, 0.06, lvl, length=1.8, r=0.16, axis="x")
        elif kind == "stone":
            block_stack(mb, x, y, 0.06, lvl, size=0.52, grid=3)
        elif kind == "iron" and lvl:
            pallet(mb, x, y, 0.06, 1.5, 1.2)
            for k in range(lvl):
                for q in range(4 - (k % 2)):
                    xx = x + (q - 1.5 + 0.5 * (k % 2)) * 0.32
                    mb.box("iron", (xx, y, 0.18 + 0.075 + k * 0.13), (0.22, 1.0, 0.12))
        elif kind == "barrels":
            spots = [(-0.4, -0.4), (0.4, -0.4), (-0.4, 0.4), (0.4, 0.4)]
            for q in range(lvl):
                bx, by = spots[q]
                barrel(mb, x + bx, y + by, 0.06)
        elif kind == "crates":
            spots = [(-0.35, -0.35, 0), (0.35, -0.3, 0), (-0.3, 0.38, 0), (0.0, 0.0, 1)]
            turns = [mb.rnd.uniform(-8, 8) for _ in spots]
            for q in range(lvl):
                cx, cy, up = spots[q]
                crate(mb, x + cx, y + cy, 0.06 + up * 0.56, rz=turns[q])
        elif kind == "weapons" and lvl:
            # spear rack, more spears per level
            for k in (-1, 1):
                mb.box("wood", (x + k * 0.8, y + 0.4, 0.75), (0.1, 0.1, 1.4))
            mb.box("wood", (x, y + 0.4, 1.35), (1.7, 0.08, 0.08))
            mb.box("wood", (x, y + 0.4, 0.35), (1.7, 0.08, 0.08))
            for q in range(lvl * 3):
                xx = x - 0.65 + q * 0.11
                mb.box("wood_hi", (xx, y + 0.28, 1.05), (0.04, 0.04, 2.0), rot=(-12, 0, 0))
                mb.cyl("steel", (xx, y + 0.07, 2.08), 0.05, 0.22, n=4, rot=(-12, 0, 0), r2=0)
    mb.rnd = base_rnd


def b_kaserne(mb, var):
    X, Y = 4 * T / 2, 3 * T / 2
    ground(mb, "gravel", -X + 0.1, X - 0.1, -Y + 0.1, -0.6, ragged=0.1)
    W, D = 2 * X - 0.8, 4.0
    cy = Y - D / 2 - 0.35
    masonry(mb, -W / 2, W / 2, cy - D / 2, cy + D / 2, 0, 2.7, row=0.34, top=False)
    timber_frame(mb, -W / 2 + 0.1, W / 2 - 0.1, cy - D / 2 + 0.1, cy + D / 2 - 0.1, 2.7, 4.3, spacing=1.05, braces=True)
    with mb.at((0, cy, 0)):
        gable_roof(mb, W, D / 2 + 0.55, 4.3, 2.0, "roof_tile", ov=0.35, row=0.32, thick=0.08, gable="plaster", ridge="roof_tile")
        masonry(mb, -2.3, -1.7, 0.6, 1.2, 4.6, 6.6, row=0.3, sides="nesw")  # chimney through the roof
    # gate with stone surround
    mb.bx("stone_top", -0.85, 0.85, cy - D / 2 - 0.12, cy - D / 2, 0, 2.55)
    mb.bx("door", -0.65, 0.65, cy - D / 2 - 0.16, cy - D / 2 - 0.1, 0, 2.3)
    mb.bx("iron", -0.62, 0.62, cy - D / 2 - 0.19, cy - D / 2 - 0.16, 0.6, 0.66)
    mb.bx("iron", -0.62, 0.62, cy - D / 2 - 0.19, cy - D / 2 - 0.16, 1.7, 1.76)
    for x in (-2.9, -1.8, 1.8, 2.9):
        mb.bx("window", x - 0.14, x + 0.14, cy - D / 2 - 0.05, cy - D / 2 + 0.01, 1.0, 1.9)
        mb.bx("stone_top", x - 0.22, x + 0.22, cy - D / 2 - 0.07, cy - D / 2, 0.9, 0.98)
    for x in (-2.6, -0.9, 0.9, 2.6):
        window(mb, "s", (x, cy - D / 2 + 0.1, 3.25), w=0.5, h=0.5, shutters=False)
    for y in (cy - 1.0, cy + 1.0):
        mb.bx("window", W / 2, W / 2 + 0.04, y - 0.14, y + 0.14, 1.0, 1.9)
    banner(mb, -1.35, cy - D / 2 - 0.35, 0, h=3.3)
    banner(mb, 1.35, cy - D / 2 - 0.35, 0, h=3.3)
    # training yard: dummy, target, rack
    with mb.at((-3.3, -2.6, 0)):
        mb.box("wood", (0, 0, 0.9), (0.12, 0.12, 1.8))
        mb.box("wood", (0, 0, 1.45), (0.9, 0.1, 0.1))
        mb.cyl("sack", (0, 0, 1.15), 0.24, 0.65, n=8)
        mb.blob("sack", (0, 0, 1.68), (0.17, 0.17, 0.17), seg=6, rings=4, jitter=0.05)
    with mb.at((3.6, -2.4, 0), rz=-30):
        mb.box("wood", (0, 0.15, 0.6), (0.1, 0.1, 1.3), rot=(-15, 0, 0))
        mb.cyl("sack", (0, 0, 1.0), 0.55, 0.16, n=12, rot=(90, 0, 0))
        mb.cyl("target", (0, -0.085, 1.0), 0.36, 0.02, n=12, rot=(90, 0, 0))
        mb.cyl("sack", (0, -0.095, 1.0), 0.2, 0.02, n=12, rot=(90, 0, 0))
        mb.cyl("target", (0, -0.105, 1.0), 0.08, 0.02, n=8, rot=(90, 0, 0))
    with mb.at((0.2, -2.9, 0)):
        for k in (-1, 1):
            mb.box("wood", (k * 0.85, 0, 0.7), (0.1, 0.1, 1.4))
        mb.box("wood", (0, 0, 1.3), (1.8, 0.08, 0.08))
        for q in range(7):
            xx = -0.7 + q * 0.23
            mb.box("wood_hi", (xx, 0.1, 1.05), (0.04, 0.04, 2.0), rot=(-10, 0, 0))
            mb.cyl("steel", (xx, -0.08, 2.07), 0.05, 0.22, n=4, rot=(-10, 0, 0), r2=0)


def b_turm(mb, var):
    h = 5 * STEP
    w = T - 0.03  # 2 tiles wide, flush with the footprint, so wall pieces meet the tower without a gap
    masonry(mb, -w, w, -w, w, 0, h, row=0.36, top=False)
    mb.bx("stone_top", -w - 0.08, w + 0.08, -w - 0.08, w + 0.08, h - 0.22, h)  # cornice
    mb.bx("stone_top", -w, w, -w, w, h - 0.02, h + 0.04)                        # platform
    mb.bx("wood", -0.5, 0.1, 0.3, 0.9, h + 0.04, h + 0.08)                       # trapdoor
    groups = {"s": "f:0:-1", "n": "f:0:1", "e": "f:1:0", "w": "f:-1:0"}
    battlements(mb, -w - 0.08, w + 0.08, -w - 0.08, w + 0.08, h, sides="nesw", side_groups=groups)
    door(mb, "s", (0, -w, 0), w=1.0, h=2.0)
    mb.bx("stone_top", -0.62, 0.62, -w - 0.06, -w, 2.0, 2.3)
    for (x, y, f) in ((0, -w, "s"), (w, 0, "e"), (-w, 0, "w"), (0, w, "n")):
        for zz in (2.9,):
            if f == "s":
                mb.bx("window", x - 0.07, x + 0.07, y - 0.03, y + 0.01, zz, zz + 0.75)
            elif f == "n":
                mb.bx("window", x - 0.07, x + 0.07, y - 0.01, y + 0.03, zz, zz + 0.75)
            elif f == "e":
                mb.bx("window", x - 0.01, x + 0.03, y - 0.07, y + 0.07, zz, zz + 0.75)
            else:
                mb.bx("window", x - 0.03, x + 0.01, y - 0.07, y + 0.07, zz, zz + 0.75)
    banner(mb, w - 0.45, w - 0.45, h, h=2.6, w=0.55, bh=1.0, face="s", group="f:1:1")


def b_mauer(mb, var):
    h = 3 * STEP
    L = T / 2
    y0, y1 = -1.1, 1.1
    masonry(mb, -L, L, y0, y1, 0, h - 0.03, row=0.36, top=False, sides="nesw")
    mb.bx("stone_top", -L, L, y0, y1, h - 0.03, h)
    for x in (-L / 2, L / 2):  # slab joints across the walkway
        mb.bx("stone2", x - 0.03, x + 0.03, y0 + 0.16, y1 - 0.42, h - 0.01, h + 0.005)
    battlements(mb, -L, L, y1 - 0.42, y1, h, sides="n", side_groups={"n": "f:0:1"}, centred=True)
    mb.bx("stone_top", -L, L, y0, y0 + 0.16, h, h + 0.12)
    wall_ghosts(mb, {"e", "w"})


def b_treppe(mb, var):
    h = 3 * STEP
    n = 10
    y0, y1 = -T + 0.05, T + 0.17  # the top step reaches the face of the wall on the next tile
    w = 0.9
    depth = (y1 - y0) / n
    for i in range(n):
        za = (i + 1) * h / n
        yy = y0 + i * depth
        masonry(mb, -w, w, yy, y1, za - h / n, za - 0.05, row=h / n, top=False, sides="ewns" if i == 0 else "ews")
        mb.bx("stone_top", -w, w, yy, yy + depth + 0.02, za - 0.05, za)


def b_baum(mb, var):
    r = mb.rnd
    th = 2.1 if var == 0 else 2.6
    mb.cyl("bark", (0, 0, th / 2), 0.3, th, n=8, r2=0.22)
    for a in (30, 150, 270):
        ca, sa = math.cos(math.radians(a)), math.sin(math.radians(a))
        mb.box("bark", (0.45 * ca, 0.45 * sa, th + 0.3), (0.16, 0.16, 1.3), rot=(-30 * sa, 30 * ca, 0))
        mb.box("bark", (0.32 * ca, 0.32 * sa, 0.12), (0.5, 0.18, 0.18), rot=(0, 0, a))
    R, Hc = (2.2, 1.8) if var == 0 else (1.75, 2.4)
    zc = th + Hc * 0.9
    mb.blob("leaf_dk", (0, 0, zc - 0.2), (R * 0.82, R * 0.82, Hc * 0.88), seg=10, rings=7, jitter=0.1)
    # light comes from the left/back of the screen: model direction (-0.7, 0.3) and from above
    for i in range(150):
        u = r.uniform(0, 2 * math.pi)
        v = r.uniform(-0.7, 1.0)
        d = math.sqrt(max(0.0, 1 - v * v)) * R * r.uniform(0.82, 1.0)
        z = zc + v * Hc * 0.92
        s_ = r.uniform(0.3, 0.5)
        lit = math.cos(u - 2.75) * 0.6 + v * 0.8
        m = "leaf_hi" if lit > 0.55 else ("leaf" if lit > -0.25 else "leaf_dk")
        mb.blob(m, (d * math.cos(u), d * math.sin(u), z), (s_, s_, s_ * 0.8), seg=5, rings=4, jitter=0.3)


def b_tanne(mb, var):
    mb.cyl("bark", (0, 0, 0.7), 0.24, 1.4, n=7)
    z = 0.8
    for i, (r_, h_) in enumerate(((1.85, 2.4), (1.55, 2.3), (1.22, 2.2), (0.9, 2.0), (0.55, 1.8), (0.28, 1.4))):
        # two cones turned against each other give a jagged, branchy rim
        mb.cyl("needle", (0, 0, z + h_ / 2), r_, h_, n=7, r2=0)
        mb.cyl("needle", (0, 0, z + h_ / 2 - 0.08), r_ * 0.86, h_, n=7, r2=0, rot=(0, 0, 360 / 14))
        mb.cyl("leaf_dk", (0, 0, z + 0.05), r_ * 0.8, 0.12, n=7, rot=(0, 0, 360 / 14))
        z += h_ * 0.6


# ---------------------------------------------------------------- prototype objects (trees, rocks, stacks, wall pieces)
WALL_H = 3 * STEP          # walkway height (3 steps), the same as "mauer"
WALL_D = 1.1               # half thickness of the wall body (model y for a wall along x)
PARA_T, PARA_H = 0.42, 0.95
MERLON, GAP = 0.62, 0.48
SIDE_GROUP = {"s": "f:0:-1", "n": "f:0:1", "w": "f:-1:0", "e": "f:1:0"}


def parapet_run(mb, side, a, b, open_a, open_b, z):
    """Breastwork and merlons along one outer edge of a wall top. side: s/n (line y = -/+WALL_D, run along x)
    or w/e (line x = -/+WALL_D, run along y). open_*: the end is a tile edge (half gap, so neighbours keep the rhythm),
    otherwise a corner (merlon flush with the end)."""
    g = SIDE_GROUP[side]
    ma, mb_ = (GAP / 2 if open_a else 0.0), (GAP / 2 if open_b else 0.0)
    length = b - a - ma - mb_
    k = max(1, round((length + GAP) / (MERLON + GAP)))
    mw = (length - (k - 1) * GAP) / k
    D, t = WALL_D, PARA_T

    def place(a0, a1, z0, z1, m):
        if side == "s":
            mb.bx(m, a0, a1, -D, -D + t, z0, z1, group=g)
        elif side == "n":
            mb.bx(m, a0, a1, D - t, D, z0, z1, group=g)
        elif side == "w":
            mb.bx(m, -D, -D + t, a0, a1, z0, z1, group=g)
        else:
            mb.bx(m, D - t, D, a0, a1, z0, z1, group=g)
    place(a, b, z, z + PARA_H * 0.42, "stone")
    for i in range(k):
        x = a + ma + i * (mw + GAP)
        place(x, x + mw, z + PARA_H * 0.42, z + PARA_H, "stone2" if i % 3 == 1 else "stone")
        place(x - 0.02, x + mw + 0.02, z + PARA_H, z + PARA_H + 0.07, "stone_top")


def wall_outline(conn):
    """Parapet runs of a wall piece: (side, a, b, open_a, open_b). conn = connected model directions (e +x, w -x, n +y, s -y).
    The body is a square of 2 WALL_D around the centre plus an arm to the tile edge per connection."""
    L, D, t = T / 2, WALL_D, PARA_T
    runs = []
    # line, axis of the run (negative and positive end direction), the arm that crosses this line
    for side, neg, pos in (("s", "w", "e"), ("n", "w", "e"), ("w", "s", "n"), ("e", "s", "n")):
        a = -L if neg in conn else -D
        b = L if pos in conn else D
        segs = [(a, b, neg in conn, pos in conn)]
        if side in conn:  # the arm leaves through this side: two flanks, extended into the inner corners
            segs = [(a, -D + t, neg in conn, False), (D - t, b, False, pos in conn)]
            segs = [s_ for s_ in segs if s_[1] - s_[0] > t + 0.05]
        runs += [(side,) + s_ for s_ in segs]
    return runs


def wall_body(mb, conn, z0=0.0, z1=None, skip_main=False):
    """Masonry of a wall piece: main box along x (all pieces connect east), cross box along y for n/s arms."""
    L, D = T / 2, WALL_D
    z1 = WALL_H - 0.03 if z1 is None else z1
    xa = -L if "w" in conn else -D
    xb = L if "e" in conn else D
    cross = "n" in conn or "s" in conn
    if not skip_main:
        sides = "sn" + ("" if ("w" in conn or cross) else "w") + ("" if ("e" in conn or cross) else "e")
        masonry(mb, xa, xb, -D, D, z0, z1, row=0.36, top=False, sides=sides)
    if cross:
        ya = -L if "s" in conn else -D
        yb = L if "n" in conn else D
        masonry(mb, -D, D, ya, yb, z0, z1, row=0.36, top=False, sides="ew")
    return xa, xb


def wall_top(mb, conn):
    L, D, h = T / 2, WALL_D, WALL_H
    xa = -L if "w" in conn else -D
    xb = L if "e" in conn else D
    mb.bx("stone_top", xa, xb, -D, D, h - 0.03, h)
    if "n" in conn or "s" in conn:
        mb.bx("stone_top", -D, D, -L if "s" in conn else -D, L if "n" in conn else D, h - 0.03, h)
    for x in (-L / 2, L / 2):  # slab joints across the walkway
        if xa < x < xb:
            mb.bx("stone2", x - 0.03, x + 0.03, -D + PARA_T + 0.04, D - PARA_T - 0.04, h - 0.01, h + 0.005)
    for run in wall_outline(conn):
        parapet_run(mb, run[0], run[1], run[2], run[3], run[4], h)


WALL_CONN = {"mauer_gerade": "ew", "mauer_ende": "e", "mauer_ecke": "en", "mauer_t": "ewn", "mauer_kreuz": "ewns", "mauer_einzel": ""}


def wall_ghosts(mb, conn):
    """Stand-ins for the connected neighbours (group "ghost", not drawn): the ground shadow of this piece must not
    fall on the place where a neighbour stands, or the game would draw the shadow over that neighbour's face."""
    L, D, z = T / 2, WALL_D, WALL_H + PARA_H + 0.1
    if "e" in conn:
        mb.bx("stone", L, 3 * L, -D, D, 0, z, group="ghost")
    if "w" in conn:
        mb.bx("stone", -3 * L, -L, -D, D, 0, z, group="ghost")
    if "n" in conn:
        mb.bx("stone", -D, D, L, 3 * L, 0, z, group="ghost")
    if "s" in conn:
        mb.bx("stone", -D, D, -3 * L, -L, 0, z, group="ghost")


def b_wallpiece(key):
    def build(mb, var):
        conn = set(WALL_CONN[key])
        wall_body(mb, conn)
        wall_top(mb, conn)
        wall_ghosts(mb, conn)
    return build


GATE_DOWN, GATE_UP = 0.18, 1.8   # underside of the portcullis grid: lowered (spikes in the ground) / raised


def portcullis(mb, sgn, z0, hw, wall_h):
    """Heavy timber portcullis in a slot just behind the face y = sgn * WALL_D; z0 = underside of the grid
    (spikes reach 0.18 m lower). Parts above the arch are hidden in the masonry."""
    D = WALL_D
    ya, yb = sorted((sgn * (D - 0.30), sgn * (D - 0.16)))
    yf0, yf1 = sorted((sgn * (D - 0.16), sgn * (D - 0.12)))       # cross bars, towards the face
    zt = wall_h - 0.12
    for x in (-0.62, -0.31, 0.0, 0.31, 0.62):
        mb.bx("door", x - 0.075, x + 0.075, ya, yb, z0, zt)
        mb.cyl("iron", (x, (ya + yb) / 2, z0 - 0.09), 0.065, 0.18, n=4, r2=0, rot=(180, 0, 45))
    zz = z0 + 0.05
    while zz < zt - 0.1:
        mb.bx("timber", -hw - 0.05, hw + 0.05, yf0, yf1, zz, zz + 0.13)
        zz += 0.48


def b_tor(mb, var):
    """Straight wall piece (e + w) with an arched gateway through the wall (model +-y), closed by two portcullises."""
    L, D, h = T / 2, WALL_D, WALL_H
    hw, spring, top = 0.78, 1.55, 2.5           # half opening, springing line, underside of the lintel
    rr = hw
    masonry(mb, -L, -hw, -D, D, 0, h - 0.03, row=0.36, top=False, sides="sne")
    masonry(mb, hw, L, -D, D, 0, h - 0.03, row=0.36, top=False, sides="snw")
    masonry(mb, -hw, hw, -D, D, top, h - 0.03, row=0.36, top=False, sides="sn")
    n = 10
    for i in range(n):  # fill between the arch and the lintel, slice by slice
        x0, x1 = -hw + 2 * hw * i / n, -hw + 2 * hw * (i + 1) / n
        xe = max(abs(x0), abs(x1))
        za = spring + math.sqrt(max(0.0, rr * rr - xe * xe))
        if za < top:
            mb.bx("mortar", x0, x1, -D + 0.05, D - 0.05, za, top + 0.02)
            for y0, y1 in ((-D, -D + 0.05), (D - 0.05, D)):
                mb.bx("stone2" if i % 2 else "stone", x0 + 0.01, x1 - 0.01, y0, y1, za, top + 0.02)
    # voussoirs on both faces
    for k in range(9):
        a = math.pi * (k + 0.5) / 9
        cx, cz = -math.cos(a) * (rr + 0.14), spring + math.sin(a) * (rr + 0.14)
        for y in (-D - 0.02, D + 0.02):
            mb.box("stone_top", (cx, y, cz), (0.2, 0.06, 0.3), rot=(0, math.degrees(a) - 90, 0))
    # passage floor
    mb.bx("dirt", -hw, hw, -D, D, 0, 0.02)
    # one portcullis behind each face, the same on both sides (the game knows no inside or outside of a gate):
    # closed = lowered, the grid fills the arch; open = raised, only the bottom bar and the spikes show under the arch
    for sgn in (-1, 1):
        portcullis(mb, sgn, GATE_DOWN if var == 0 else GATE_UP, hw, h)
    wall_top(mb, {"e", "w"})
    wall_ghosts(mb, {"e", "w"})


def b_baum_liegt(mb, var):
    """Felled broadleaf trunk along model +x, cut into sections: variant 0 three sections and the crown, 1 two, 2 one.
    The foot end points to -x (towards the stump on the neighbouring tile), the crown reaches into the tile at +x."""
    r = mb.rnd
    secs = [(-1.3, -0.44), (-0.4, 0.46), (0.5, 1.36)]
    keep = 3 - var
    draws = [(r.uniform(-0.1, 0.1), r.uniform(0.2, 0.5), r.uniform(-50, 50)) for _ in range(40)]
    for i, (a, b) in enumerate(secs[:keep]):
        rad = 0.3 - 0.03 * i
        mb.cyl("bark", ((a + b) / 2, 0, rad), rad, b - a, n=9, rot=(0, 90, 0))
        for x in (a - 0.004, b + 0.004):  # cut faces
            mb.cyl("wood_hi", (x, 0, rad), rad * 0.88, 0.02, n=9, rot=(0, 90, 0))
            mb.cyl("wood", (x + (0.006 if x > a else -0.006), 0, rad), rad * 0.4, 0.02, n=7, rot=(0, 90, 0))
    if var == 0:
        # crown: branches spreading on the ground, leaves still on them
        for j in range(7):
            dy, ln, ang = draws[j]
            yaw = -55 + j * 18
            c = (1.45 + 0.4 * math.cos(math.radians(yaw)) + ln, 0.45 * math.sin(math.radians(yaw)) * 1.6, 0.28 + dy)
            mb.box("bark", c, (1.1 + ln, 0.1, 0.1), rot=(0, -8, yaw * 0.6))
        for j in range(26):
            u = r.uniform(0, 2 * math.pi)
            rr = r.uniform(0.2, 1.0)
            x = 2.15 + rr * math.cos(u) * 0.75
            y = rr * math.sin(u) * 1.0
            s_ = r.uniform(0.28, 0.42)
            m = "leaf_hi" if math.sin(u) > 0.4 else ("leaf" if j % 3 else "leaf_dk")
            mb.blob(m, (x, y, 0.3 + r.uniform(-0.05, 0.25)), (s_, s_, s_ * 0.7), seg=5, rings=4, jitter=0.3)
    else:
        # stubs of lopped branches and a few twigs on the ground
        for j in range(3 + var):
            dy, ln, ang = draws[10 + j]
            x = r.uniform(-1.2, 1.3 - 0.9 * var)
            mb.box("bark", (x, r.choice((-1, 1)) * 0.55, 0.05), (0.5 * ln + 0.2, 0.06, 0.06), rot=(0, 0, ang))
        for j in range(5):
            mb.box("leaf_dk", (r.uniform(-1.0, 1.6), r.uniform(-0.8, 0.8), 0.03), (0.18, 0.12, 0.04), rot=(0, 0, r.uniform(0, 90)))


def b_baum_stumpf(mb, var):
    r = mb.rnd
    if var == 0:  # broadleaf stump: wide, low, roots
        rad, h = 0.32, 0.5
        mb.cyl("bark", (0, 0, h / 2), rad, h, n=9, r2=rad * 0.92)
        mb.cyl("wood_hi", (0, 0, h + 0.005), rad * 0.85, 0.02, n=9)
        mb.cyl("wood", (0, 0, h + 0.012), rad * 0.45, 0.02, n=8)
        mb.cyl("wood", (0, 0, h + 0.018), rad * 0.12, 0.02, n=6)
        for a in (20, 110, 200, 290):
            ca, sa = math.cos(math.radians(a)), math.sin(math.radians(a))
            mb.box("bark", (0.38 * ca, 0.38 * sa, 0.09), (0.45, 0.16, 0.16), rot=(0, 18, a))
        for j in range(6):  # chips
            mb.box("wood_hi", (r.uniform(-0.8, 0.8), r.uniform(-0.8, 0.8), 0.02), (0.12, 0.06, 0.03), rot=(0, 0, r.uniform(0, 180)))
    else:  # fir stump: narrower, slanted cut, needle litter
        rad, h = 0.25, 0.38
        mb.cyl("bark", (0, 0, h / 2), rad, h, n=8, r2=rad * 0.95)
        mb.cyl("wood_hi", (0, 0, h + 0.03), rad * 0.9, 0.04, n=8, rot=(9, 0, 0))
        mb.cyl("wood", (0, 0, h + 0.05), rad * 0.3, 0.02, n=6, rot=(9, 0, 0))
        for a in (60, 180, 300):
            ca, sa = math.cos(math.radians(a)), math.sin(math.radians(a))
            mb.box("bark", (0.3 * ca, 0.3 * sa, 0.07), (0.32, 0.12, 0.12), rot=(0, 15, a))
        for j in range(10):
            mb.box("needle", (r.uniform(-0.9, 0.9), r.uniform(-0.9, 0.9), 0.02), (0.2, 0.05, 0.03), rot=(0, 0, r.uniform(0, 180)))


def b_fels(mb, var):
    """Single boulder as a quarry target; variants from untouched to almost mined out (fresh cut faces, rubble)."""
    r = mb.rnd
    s = [1.0, 0.76, 0.54, 0.3][var]
    parts = [((0, 0.05), (0.95, 0.85, 0.9), "rock"), ((-0.45, 0.35), (0.6, 0.55, 0.65), "rock_dk"),
             ((0.5, 0.4), (0.55, 0.5, 0.55), "rock"), ((0.15, -0.45), (0.55, 0.5, 0.5), "rock_dk"),
             ((-0.2, 0.15), (0.5, 0.5, 0.45), "rock")]
    jit = [(r.uniform(-0.05, 0.05), r.uniform(-0.05, 0.05), r.uniform(0.9, 1.1)) for _ in parts]
    rubble = [(r.uniform(-1.0, 1.0), r.uniform(-1.0, 1.0), r.uniform(0.08, 0.16)) for _ in range(14)]
    zs = [0.0, 0.0, 0.0, 0.0, 0.75]
    for i, ((x, y), (rx, ry, rz), m) in enumerate(parts):
        if var >= 3 and i >= 3:
            continue
        jx, jy, k = jit[i]
        rz_ = rz * s * k
        mb.blob(m, ((x + jx) * (0.6 + 0.4 * s), (y + jy) * (0.6 + 0.4 * s), rz_ * 0.85 + zs[i] * s),
                (rx * (0.55 + 0.45 * s), ry * (0.55 + 0.45 * s), rz_), seg=8, rings=6, jitter=0.18)
    if var >= 1:
        # fresh flat cut on the front and on top, with chisel lines
        hh = 1.3 * s
        mb.bx("rock_cut", -0.55 * s - 0.1, 0.45 * s + 0.1, -0.62 * s - 0.08, -0.1, 0, hh)
        for zz in (hh * 0.33, hh * 0.66):
            mb.bx("stone2", -0.55 * s - 0.12, 0.45 * s + 0.12, -0.62 * s - 0.1, -0.6 * s - 0.06, zz - 0.03, zz)
    n_rub = [3, 6, 10, 14][var]
    for (x, y, rr) in rubble[:n_rub]:
        if abs(x) < 0.45 * s + 0.2 and abs(y) < 0.45 * s + 0.2:
            x = math.copysign(0.45 * s + 0.3, x)
        mb.blob("rock" if rr > 0.12 else "gravel", (x, y, rr * 0.5), (rr, rr * 0.9, rr * 0.7), seg=5, rings=3, jitter=0.25)


STACK_Z = 0.06  # stacks stand on the planks of lager_boden


def b_stapel_holz(mb, var):
    log_pile(mb, 0, 0, STACK_Z, var, length=1.8, r=0.16, axis="x")


def b_stapel_stein(mb, var):
    block_stack(mb, 0, 0, STACK_Z, var, size=0.52, grid=3)


def b_stapel_eisen(mb, var):
    if not var:
        return
    pallet(mb, 0, 0, STACK_Z, 1.5, 1.2)
    for k in range(var):
        for q in range(4 - (k % 2)):
            xx = (q - 1.5 + 0.5 * (k % 2)) * 0.32
            # ingots: narrow bars with a lighter top
            mb.box("iron", (xx, 0, 0.18 + 0.075 + k * 0.13), (0.22, 1.0, 0.12))
            mb.box("steel", (xx, 0, 0.18 + 0.14 + k * 0.13), (0.14, 0.92, 0.02))


def b_stapel_speer(mb, var):
    """Tall upright rack, three more spears per level."""
    if not var:
        return
    for k in (-1, 1):
        mb.box("wood", (k * 0.8, 0.3, 0.75), (0.1, 0.1, 1.5))
    mb.box("wood", (0, 0.3, 1.4), (1.7, 0.08, 0.08))
    mb.box("wood", (0, 0.3, 0.35), (1.7, 0.08, 0.08))
    mb.bx("wood_hi", -0.85, 0.85, -0.05, 0.35, STACK_Z, STACK_Z + 0.08)  # foot board
    for q in range(var * 3):
        xx = -0.66 + q * 0.12
        mb.box("wood_hi", (xx, 0.18, 1.06), (0.045, 0.045, 2.0), rot=(-12, 0, 0))
        mb.cyl("steel", (xx, -0.03, 2.09), 0.055, 0.24, n=4, rot=(-12, 0, 0), r2=0)


def b_stapel_schwert(mb, var):
    """Low sword rack: swords stand point down in a slotted board, hilts with cross guards and gold pommels up."""
    if not var:
        return
    for k in (-1, 1):
        mb.bx("wood", k * 0.78 - 0.06, k * 0.78 + 0.06, -0.3, 0.3, STACK_Z, STACK_Z + 0.8)
    mb.bx("wood", -0.84, 0.84, -0.12, 0.12, STACK_Z + 0.62, STACK_Z + 0.72)      # slotted top board
    mb.bx("wood_hi", -0.84, 0.84, -0.32, 0.32, STACK_Z, STACK_Z + 0.1)           # base
    n = var * 2 + (2 if var >= 2 else 0)
    for q in range(n):
        xx = -0.65 + q * (1.3 / max(1, 9))
        z0 = STACK_Z + 0.1
        mb.bx("steel_hi", xx - 0.035, xx + 0.035, -0.012, 0.012, z0, z0 + 0.85)          # blade
        mb.bx("steel", xx - 0.12, xx + 0.12, -0.03, 0.03, z0 + 0.85, z0 + 0.9)           # cross guard
        mb.bx("leather", xx - 0.025, xx + 0.025, -0.025, 0.025, z0 + 0.9, z0 + 1.05)     # grip
        mb.box("gold", (xx, 0, z0 + 1.08), (0.07, 0.07, 0.06))                           # pommel
    if var >= 3:  # an open crate of spare blades in front
        crate(mb, 0.35, -0.6, 0, s=0.45)


def b_stapel_bogen(mb, var):
    """Frame with strung bows hanging from the top bar, an arrow barrel from level 2."""
    if not var:
        return
    for k in (-1, 1):
        mb.box("wood", (k * 0.8, 0.25, 0.85), (0.1, 0.1, 1.7))
        mb.box("wood", (k * 0.8, 0.25, 0.08), (0.12, 0.6, 0.1))
    mb.box("wood", (0, 0.25, 1.62), (1.7, 0.08, 0.08))
    for q in range(var * 2):
        xx = -0.62 + q * 0.18
        with mb.at((xx, 0.18, 0.95)):
            for i, (z, rx) in enumerate(((0.36, 16), (0, 0), (-0.36, -16))):
                mb.box("bow", (0, -0.08 if i == 1 else -0.06 * (1 if i == 0 else 1), z * 1.05), (0.05, 0.06, 0.42), rot=(rx, 0, 0))
            mb.box("string", (0, 0.03, 0), (0.02, 0.02, 1.1))
            mb.box("rope", (0, 0.05, 0.62), (0.03, 0.03, 0.08))
    if var >= 2:
        barrel(mb, 0.5, -0.55, 0, r=0.24, h=0.6)
        for q in range(9 if var >= 4 else 5):
            a = q * 2.4
            px, py = 0.5 + 0.12 * math.cos(a), -0.55 + 0.12 * math.sin(a)
            mb.box("wood_hi", (px, py, 0.75), (0.025, 0.025, 0.45))
            mb.box("cloth", (px, py, 0.98), (0.06, 0.02, 0.1))


def b_lager_boden(mb, var):
    """Storage yard without goods: fence (front parts in the _front mask) and eight plank floors (slots as in b_lager)."""
    S = 3 * T / 2
    ground(mb, "dirt", -S + 0.05, S - 0.05, -S + 0.05, S - 0.05, ragged=0.05)
    e = S - 0.15
    fence(mb, [(-0.8, -e), (-e, -e), (-e, e), (e, e), (e, -e), (0.8, -e)],
          groups=["f:0:-1", "f:-1:0", "f:0:1", "f:1:0", "f:0:-1"])
    c = 2 * S / 3
    for (i, j) in ((-1, 1), (0, 1), (1, 1), (-1, 0), (1, 0), (-1, -1), (1, -1), (0, 0)):
        x, y = i * c, j * c
        for q in range(5):
            y_ = y - 0.95 + q * 0.38
            mb.bx("wood" if q % 2 else "wood_hi", x - 0.95, x + 0.95, y_ + 0.02, y_ + 0.36, 0.03, 0.06)


# ---------------------------------------------------------------- storehouse and cutaways (interior views)
# Cutaway sprites ("cutaway": true in buildings.json) are built once per view d (mb.view): the walls that face the camera
# in that view stay low (group "f:x:y", drawn again as the _front overlay after goods and figures), the others stand at
# full height, there is no roof. Ground and everything outside match the exterior sprite (same seed, same draws first),
# so swapping the sprites only opens the house.
SIDE_N = {"s": (0, -1), "n": (0, 1), "e": (1, 0), "w": (-1, 0)}


def low_side(side, d):
    """Does wall side (outward normal in model axes) face the camera in view d?"""
    return is_front("f:%d:%d" % SIDE_N[side], d)


def side_group(side):
    return "f:%d:%d" % SIDE_N[side]


def wall_box(side, x0, x1, y0, y1, th):
    """One side of a rectangular wall ring (outer faces x0..x1, y0..y1, thickness th): (x0, x1, y0, y1)."""
    if side == "s":
        return (x0, x1, y0, y0 + th)
    if side == "n":
        return (x0, x1, y1 - th, y1)
    if side == "e":
        return (x1 - th, x1, y0 + th, y1 - th)
    return (x0, x0 + th, y0 + th, y1 - th)


def split_gap(side, box, gap):
    """Parts of a wall box left and right of an opening gap = (a, b, top) along the wall."""
    x0, x1, y0, y1 = box
    if not gap:
        return [box]
    a, b = gap[0], gap[1]
    if side in "sn":
        return [p for p in ((x0, a, y0, y1), (b, x1, y0, y1)) if p[1] - p[0] > 0.01]
    return [p for p in ((x0, x1, y0, a), (x0, x1, b, y1)) if p[3] - p[2] > 0.01]


def above_gap(side, box, gap):
    x0, x1, y0, y1 = box
    a, b = gap[0], gap[1]
    return (a, b, y0, y1) if side in "sn" else (x0, x1, a, b)


def slab(mb, mat, side, box, z0, z1, gap=None, group=None):
    """Plain wall slab with an optional opening gap = (a, b, top)."""
    if z1 <= z0 + 1e-3:
        return
    for p in split_gap(side, box, gap):
        mb.bx(mat, p[0], p[1], p[2], p[3], z0, z1, group=group)
    if gap and z1 > gap[2]:
        p = above_gap(side, box, gap)
        mb.bx(mat, p[0], p[1], p[2], p[3], max(z0, gap[2]), z1, group=group)


def stone_slab(mb, side, box, z0, z1, gap=None, group=None, row=0.3):
    """Wall slab in block masonry (outer face on this side), with an optional opening."""
    if z1 <= z0 + 1e-3:
        return
    for p in split_gap(side, box, gap):
        masonry(mb, p[0], p[1], p[2], p[3], z0, z1, row=row, top=True, sides=side, group=group)
    if gap and z1 > gap[2]:
        p = above_gap(side, box, gap)
        masonry(mb, p[0], p[1], p[2], p[3], max(z0, gap[2]), z1, row=row, top=True, sides=side, group=group)


def cut_house(mb, x0, x1, y0, y1, base, eave, th=0.16, gaps=None, posts=1.1, plinth=True, wall="plaster"):
    """Hollow framed house walls for a cutaway: stone base 0..base (unless plinth=False), plastered wall with posts
    base..eave on the full sides, a timber sill on the low sides. gaps: side -> (a, b, top) door opening."""
    gaps = gaps or {}
    d = mb.view
    for side in "nesw":
        is_low = low_side(side, d)
        g = side_group(side) if is_low else None
        box = wall_box(side, x0, x1, y0, y1, th)
        gap = gaps.get(side)
        ground_gap = (gap[0], gap[1], 0.0) if gap else None
        if plinth:
            stone_slab(mb, side, box, 0, base, ground_gap, group=g, row=base / 2)
        if is_low:
            slab(mb, "timber", side, box, base, base + 0.16, ground_gap, group=g)
            continue
        slab(mb, wall, side, box, base, eave - 0.12, gap)
        slab(mb, "timber", side, box, eave - 0.12, eave, gap)  # top plate (no roof above)
        bx0, bx1, by0, by1 = box
        if side in "sn":
            k = max(1, round((x1 - x0) / posts))
            for i in range(k + 1):
                xx = x0 + th + (x1 - x0 - 2 * th) * i / k
                if gap and gap[0] - 0.12 < xx < gap[1] + 0.12:
                    continue
                yy = by1 if side == "s" else by0 - 0.05
                mb.bx("timber", xx - 0.07, xx + 0.07, yy, yy + 0.05, base, eave - 0.12)
        else:
            k = max(1, round((y1 - y0) / posts))
            for i in range(k + 1):
                yy = y0 + th + (y1 - y0 - 2 * th) * i / k
                if gap and gap[0] - 0.12 < yy < gap[1] + 0.12:
                    continue
                xx = bx1 if side == "w" else bx0 - 0.05
                mb.bx("timber", xx, xx + 0.05, yy - 0.07, yy + 0.07, base, eave - 0.12)
        if gap:  # door frame of an opening in a full wall
            a, b, top = gap
            if side in "sn":
                mb.bx("timber", a - 0.08, a, by0 - 0.02, by1 + 0.02, 0, top)
                mb.bx("timber", b, b + 0.08, by0 - 0.02, by1 + 0.02, 0, top)
                mb.bx("timber", a - 0.08, b + 0.08, by0 - 0.02, by1 + 0.02, top, top + 0.14)
            else:
                mb.bx("timber", bx0 - 0.02, bx1 + 0.02, a - 0.08, a, 0, top)
                mb.bx("timber", bx0 - 0.02, bx1 + 0.02, b, b + 0.08, 0, top)
                mb.bx("timber", bx0 - 0.02, bx1 + 0.02, a - 0.08, b + 0.08, top, top + 0.14)


def plank_floor(mb, x0, x1, y0, y1, z0, z1, pitch=0.36, along="x"):
    k = 0
    if along == "x":
        y = y0
        while y < y1 - 0.02:
            mb.bx("wood_hi" if k % 2 else "wood", x0, x1, y + 0.015, min(y1, y + pitch) - 0.015, z0, z1)
            y += pitch
            k += 1
    else:
        x = x0
        while x < x1 - 0.02:
            mb.bx("wood_hi" if k % 2 else "wood", x + 0.015, min(x1, x + pitch) - 0.015, y0, y1, z0, z1)
            x += pitch
            k += 1


# storehouse: wall ring (outer faces) and the gate in the front wall (model -y, the access tile lies in front of it)
LH_X, LH_Y0, LH_Y1, LH_BASE, LH_EAVE = 3.5, -2.95, 3.6, 0.45, 2.9
LH_GATE = (-1.0, 1.0, 2.35)


def lager_apron(mb, var):
    """Fill level in front of the gate: crates, barrels and sacks on the apron (variants 0..4)."""
    y = -3.42
    if var >= 1:
        crate(mb, -2.25, y, 0, s=0.5, rz=6)
    if var >= 2:
        barrel(mb, 2.2, y, 0, r=0.27, h=0.7)
    if var >= 3:
        crate(mb, -1.65, y - 0.02, 0, s=0.46, rz=-9)
        barrel(mb, 1.62, y + 0.02, 0, r=0.25, h=0.66)
    if var >= 4:
        crate(mb, -2.2, y + 0.03, 0.5, s=0.42, rz=14)
        for (sx, sy, sz) in ((2.75, y - 0.05, 0.16), (2.72, y + 0.2, 0.16), (2.75, y + 0.06, 0.42)):
            mb.blob("sack", (sx, sy, sz), (0.24, 0.2, 0.17), seg=7, rings=4, jitter=0.06)


def b_lagerhaus(mb, var):
    """Closed storehouse 3 x 3: stone base, timber frame, tiled roof (ridge along x), double gate in the front wall."""
    S = 3 * T / 2
    ground(mb, "dirt", -S + 0.05, S - 0.05, -S + 0.05, S - 0.05, ragged=0.05)
    x, y0, y1 = LH_X, LH_Y0, LH_Y1
    masonry(mb, -x - 0.05, x + 0.05, y0 - 0.05, y1 + 0.05, 0, LH_BASE, row=0.225, top=True)
    timber_frame(mb, -x, x, y0, y1, LH_BASE, LH_EAVE, spacing=1.17)
    cy = (y0 + y1) / 2
    with mb.at((0, cy, 0)):
        gable_roof(mb, 2 * x, (y1 - y0) / 2 + 0.42, LH_EAVE, 2.4, "roof_tile", ov=0.3, row=0.32, thick=0.08, gable="plaster", ridge="roof_tile")
    # gate: two plank leaves with braces and iron bands, timber frame, stone ramp
    a, b, top = LH_GATE
    mb.bx("timber", a - 0.16, a, y0 - 0.1, y0 + 0.02, 0, top + 0.05)
    mb.bx("timber", b, b + 0.16, y0 - 0.1, y0 + 0.02, 0, top + 0.05)
    mb.bx("timber", a - 0.22, b + 0.22, y0 - 0.12, y0 + 0.02, top, top + 0.2)
    for (l0, l1) in ((a, -0.02), (0.02, b)):
        mb.bx("door", l0, l1, y0 - 0.09, y0 - 0.04, 0.02, top)
        for q in range(1, 4):  # plank seams
            xx = l0 + (l1 - l0) * q / 4
            mb.bx("wood", xx - 0.012, xx + 0.012, y0 - 0.1, y0 - 0.08, 0.02, top)
        for zz in (0.45, top - 0.45):
            mb.bx("iron", l0 + 0.04, l1 - 0.04, y0 - 0.12, y0 - 0.09, zz - 0.04, zz + 0.04)
        ang = math.degrees(math.atan2(top - 0.9, l1 - l0))
        mb.box("wood_hi", ((l0 + l1) / 2, y0 - 0.11, top / 2), (math.hypot(l1 - l0, top - 0.9) * 0.98, 0.03, 0.09),
               rot=(0, -ang if l0 < 0 else ang, 0))
    mb.bx("iron", -0.05, 0.05, y0 - 0.14, y0 - 0.1, 1.0, 1.3)  # latch
    mb.bx("stone_top", a - 0.3, b + 0.3, y0 - 0.5, y0 - 0.05, 0, 0.1)
    # hoist beam above the gate and a sign board with a crate
    mb.bx("timber", -0.09, 0.09, y0 - 0.95, y0, top + 0.3, top + 0.45)
    mb.box("rope", (0, y0 - 0.85, top - 0.15), (0.03, 0.03, 0.85))
    mb.bx("timber", 1.45, 1.53, y0 - 0.45, y0, 2.15, 2.21)
    mb.bx("wood_hi", 1.25, 1.75, y0 - 0.42, y0 - 0.38, 1.6, 2.05)
    mb.bx("crate", 1.38, 1.62, y0 - 0.44, y0 - 0.42, 1.7, 1.94)
    for yy in (y0 + 1.6, y1 - 1.6):
        window(mb, "e", (x, yy, 1.45), w=0.45, h=0.5)
    lager_apron(mb, var)


def b_lagerhaus_innen(mb, var):
    """Storehouse cutaway: plank floor with eight bays (shelves from buildings.json, the same as
    BUILDINGS.lager.storage.shelves in src/data), racks against the full walls, gate opening, hand cart.
    Goods (stapel_*) and carriers are drawn by the game on top, then the low front walls (_front)."""
    S = 3 * T / 2
    ground(mb, "dirt", -S + 0.05, S - 0.05, -S + 0.05, S - 0.05, ragged=0.05)
    x, y0, y1 = LH_X, LH_Y0, LH_Y1
    mb.rnd = random.Random(1000 * mb.seed + 77)
    th = 0.16
    cut_house(mb, -x, x, y0, y1, LH_BASE, LH_EAVE, th=th, gaps={"s": LH_GATE}, posts=1.17)
    plank_floor(mb, -x + th, x - th, y0 + th, y1 - th, 0.0, STACK_Z - 0.01, pitch=0.42, along="y")
    mb.bx("stone_top", LH_GATE[0], LH_GATE[1], y0 - 0.5, y0 + th, 0, 0.06)
    d = mb.view
    for (sx, sy) in DEFS["lagerhaus_innen"]["shelves"]:
        cx, cy = sx * T, sy * T
        sg = 1 if cx > 0 else -1
        # bay: darker boards under the goods, a low kerb towards the aisle
        mb.bx("wood", cx - 0.9, cx + 0.9, cy - 0.66, cy + 0.66, STACK_Z - 0.01, STACK_Z)
        kx = cx - sg * 0.93
        mb.bx("timber", kx - 0.03, kx + 0.03, cy - 0.66, cy + 0.66, STACK_Z, STACK_Z + 0.08)
        # posts between the bays and a shelf board with sacks (only against a wall at full height)
        if not low_side("e" if sg > 0 else "w", d):
            wx = sg * (x - th - 0.06)
            for yy in (cy - 0.72, cy + 0.72):
                mb.bx("timber", wx - 0.05, wx + 0.05, yy - 0.05, yy + 0.05, 0, 2.6)
            mb.bx("wood_hi", min(wx, wx - sg * 0.4), max(wx, wx - sg * 0.4), cy - 0.7, cy + 0.7, 2.45, 2.5)
            for q in range(2):
                mb.blob("sack", (wx - sg * 0.2, cy - 0.32 + q * 0.6, 2.63), (0.15, 0.17, 0.13), seg=6, rings=4, jitter=0.08)
    # back wall: ladder and rope coils when it stands at full height
    if not low_side("n", d):
        yb = y1 - th
        for lx in (-0.6, 0.0):
            mb.box("wood_hi", (lx, yb - 0.3, 1.35), (0.07, 0.06, 2.7), rot=(-12, 0, 0))
        for k in range(6):
            zz = 0.3 + k * 0.4
            mb.bx("wood", -0.6, 0.0, yb - 0.3 - (1.35 - zz) * 0.21 - 0.03, yb - 0.3 - (1.35 - zz) * 0.21 + 0.03, zz, zz + 0.05)
        mb.cyl("rope", (0.8, yb - 0.05, 1.7), 0.22, 0.08, n=10, rot=(90, 0, 0))
        mb.cyl("rope", (1.25, yb - 0.05, 1.55), 0.16, 0.08, n=10, rot=(90, 0, 0))
    with mb.at((-1.0, y0 + 0.75, 0), rz=-12):  # hand cart beside the aisle entrance
        mb.bx("wood", -0.32, 0.32, -0.22, 0.22, 0.3, 0.4)
        mb.bx("wood_hi", -0.32, 0.32, -0.22, -0.18, 0.4, 0.55)
        mb.bx("wood_hi", -0.32, 0.32, 0.18, 0.22, 0.4, 0.55)
        mb.cyl("wood", (0.0, -0.27, 0.28), 0.27, 0.05, n=10, rot=(90, 0, 0))
        mb.box("wood", (0.0, 0.55, 0.4), (0.05, 0.7, 0.05), rot=(-10, 0, 0))
    lager_apron(mb, var)


def haus_outside(mb):
    """The things outside the house, as in b_haus_body: door step, barrel, bench, woodpile."""
    W, D = 3.9, 3.2
    mb.bx("stone_top", -1.15, -0.15, -D / 2 - 0.38, -D / 2 - 0.1, 0, 0.21)
    with mb.at((-W / 2 - 0.15, -D / 2 - 0.55, 0)):
        barrel(mb, 0, 0, 0)
    mb.bx("wood", 0.1, 1.5, -D / 2 - 0.55, -D / 2 - 0.25, 0.4, 0.47)
    for x in (0.2, 1.4):
        mb.bx("wood", x - 0.05, x + 0.05, -D / 2 - 0.5, -D / 2 - 0.3, 0, 0.4)
    log_pile(mb, W / 2 + 0.38, 0.6, 0, 3, length=0.7, r=0.1, axis="y")


def bed(mb, x0, x1, y0, y1, z, along, sleeper):
    """Straw bed in a wooden frame; sleeper = a resident under the blanket, head on the pillow (low end)."""
    mb.bx("wood", x0, x1, y0, y1, z, z + 0.2)
    mb.bx("sack", x0 + 0.05, x1 - 0.05, y0 + 0.05, y1 - 0.05, z + 0.2, z + 0.3)
    if along == "y":
        mb.bx("cloth", x0 + 0.12, x1 - 0.12, y0 + 0.08, y0 + 0.4, z + 0.3, z + 0.4)
        hx, hy = (x0 + x1) / 2, y0 + 0.25
        bl = (x0 + 0.07, x1 - 0.07, y0 + 0.45, y1 - 0.08)
    else:
        mb.bx("cloth", x0 + 0.08, x0 + 0.4, y0 + 0.12, y1 - 0.12, z + 0.3, z + 0.4)
        hx, hy = x0 + 0.25, (y0 + y1) / 2
        bl = (x0 + 0.45, x1 - 0.08, y0 + 0.07, y1 - 0.07)
    if sleeper:
        mb.blob("leather", ((bl[0] + bl[1]) / 2, (bl[2] + bl[3]) / 2, z + 0.4),
                ((bl[1] - bl[0]) / 2, (bl[3] - bl[2]) / 2, 0.14), seg=8, rings=4, jitter=0.04)
        mb.blob("skin", (hx, hy, z + 0.5), (0.12, 0.12, 0.11), seg=7, rings=5, jitter=0.02)
        mb.blob("hair", (hx + (0.04 if along == "x" else 0), hy + (0.04 if along == "y" else 0), z + 0.56), (0.11, 0.11, 0.06), seg=7, rings=4, jitter=0.02)
    elif along == "y":  # folded blanket at the foot
        mb.bx("leather", x0 + 0.1, x1 - 0.1, y1 - 0.45, y1 - 0.12, z + 0.3, z + 0.38)
    else:
        mb.bx("leather", x1 - 0.45, x1 - 0.12, y0 + 0.1, y1 - 0.1, z + 0.3, z + 0.38)


def b_haus_innen(mb, var):
    """Living house cutaway: four beds (two bunks), hearth at the chimney, table with bench, chest. var = beds occupied."""
    scratch = MB(mb.seed)
    b_haus_body(scratch)          # same random draws as the exterior first, so the garden strip matches exactly
    mb.rnd = scratch.rnd
    haus_garden(mb)
    mb.rnd = random.Random(1000 * mb.seed + 78)
    W, D = 3.9, 3.2
    z = 0.42
    masonry(mb, -W / 2 - 0.1, W / 2 + 0.1, -D / 2 - 0.1, D / 2 + 0.1, 0, z, row=0.21, top=True)
    cut_house(mb, -W / 2, W / 2, -D / 2, D / 2, z, 2.75, th=0.14, gaps={"s": (-1.1, -0.2, z + 1.95)}, posts=0.98, plinth=False)
    plank_floor(mb, -W / 2 + 0.14, W / 2 - 0.14, -D / 2 + 0.14, D / 2 - 0.14, z, z + 0.03, pitch=0.3, along="x")
    z += 0.03
    haus_outside(mb)
    # hearth with the chimney (where the exterior chimney stands)
    masonry(mb, 0.75, 1.3, 0.25, 0.8, z, 2.75, row=0.27, top=True)
    mb.bx("stone_top", 0.6, 1.45, 0.05, 0.85, z, z + 0.16)
    mb.bx("window", 0.85, 1.2, 0.22, 0.26, z + 0.16, z + 0.7)
    mb.bx("target", 0.85, 1.2, 0.1, 0.3, z + 0.16, z + 0.22)
    for (fx, fh) in ((0.93, 0.3), (1.03, 0.4), (1.12, 0.26)):
        mb.box("gold", (fx, 0.18, z + 0.22 + fh / 2), (0.07, 0.05, fh), rot=(0, 8 if fx < 1 else -8, 0))
    mb.cyl("iron", (1.02, 0.06, z + 0.62), 0.15, 0.22, n=8)  # pot
    # beds: two bunks, lower beds first
    beds = [((-1.8, -1.05, -1.4, 0.4), z, "y"), ((-0.95, 0.6, 0.85, 1.5), z, "x"),
            ((-1.8, -1.05, -1.4, 0.4), z + 1.15, "y"), ((-0.95, 0.6, 0.85, 1.5), z + 1.15, "x")]
    for (x0, x1, y0, y1), bz, _ in beds[2:]:
        for (px, py) in ((x0, y0), (x1, y0), (x0, y1), (x1, y1)):
            mb.bx("wood", px - 0.04, px + 0.04, py - 0.04, py + 0.04, z, bz + 0.55)
    for i, ((x0, x1, y0, y1), bz, along) in enumerate(beds):
        bed(mb, x0, x1, y0, y1, bz, along, i < var)
    # table with bench, jug and bowl; a chest by the window
    mb.bx("wood_hi", 0.0, 1.0, -1.2, -0.55, z + 0.7, z + 0.76)
    for (lx, ly) in ((0.08, -1.12), (0.92, -1.12), (0.08, -0.63), (0.92, -0.63)):
        mb.bx("wood", lx - 0.04, lx + 0.04, ly - 0.04, ly + 0.04, z, z + 0.7)
    mb.bx("wood", 0.05, 0.95, -0.4, -0.22, z + 0.42, z + 0.47)
    for lx in (0.12, 0.88):
        mb.bx("wood", lx - 0.04, lx + 0.04, -0.35, -0.27, z, z + 0.42)
    mb.cyl("barrel", (0.3, -0.85, z + 0.86), 0.07, 0.2, n=8)
    mb.cyl("wood", (0.65, -0.95, z + 0.78), 0.12, 0.04, n=8)
    with mb.at((1.5, -1.1, z)):
        mb.bx("crate", -0.3, 0.3, -0.2, 0.2, 0, 0.42)
        mb.bx("iron", -0.32, 0.32, -0.22, 0.22, 0.38, 0.42)


def b_holzfaeller_innen(mb, var):
    """Woodcutter's hut without roof: workbench with saw and log, axes on the back wall, billets, a straw bed.
    The yard (chopping block, saw horse, output piles) is the same as outside."""
    W, D = 2.6, 2.1
    cx, cy = -1.15, 1.2
    r = 0.13
    ground(mb, "dirt", -2.5, 2.5, -2.5, 2.5, ragged=0.3)
    d = mb.view
    with mb.at((cx, cy, 0)):
        plank_floor(mb, -W / 2 + 0.05, W / 2 - 0.05, -D / 2 + 0.05, D / 2 - 0.05, 0.0, 0.05, pitch=0.3, along="x")
        # log courses as outside; on the camera sides only the two lowest courses
        k, z = 0, r
        while z < 2.1:
            if k % 2 == 0:
                for yy, side in ((-D / 2, "s"), (D / 2, "n")):
                    lo = low_side(side, d)
                    if lo and z > 2.5 * r:
                        continue
                    g = side_group(side) if lo else None
                    if side == "s" and not lo and z < 1.95:  # door opening in a full front wall
                        for (a, b) in ((-W / 2 - 0.2, -0.9), (0.0, W / 2 + 0.2)):
                            mb.cyl("log", ((a + b) / 2, yy, z), r, b - a, n=8, rot=(0, 90, 0))
                        continue
                    mb.cyl("log", (0, yy, z), r, W + 0.4, n=8, rot=(0, 90, 0), group=g)
            else:
                for xx, side in ((-W / 2, "w"), (W / 2, "e")):
                    lo = low_side(side, d)
                    if lo and z > 2.5 * r:
                        continue
                    mb.cyl("log", (xx, 0, z), r, D + 0.4, n=8, rot=(90, 0, 0), group=side_group(side) if lo else None)
            k += 1
            z += r
        # workbench with a log and a saw
        mb.bx("wood_hi", -0.2, 0.9, 0.3, 0.8, 0.72, 0.8)
        for (lx, ly) in ((-0.15, 0.35), (0.85, 0.35), (-0.15, 0.75), (0.85, 0.75)):
            mb.bx("wood", lx - 0.04, lx + 0.04, ly - 0.04, ly + 0.04, 0.05, 0.72)
        log(mb, (0.3, 0.6, 0.9), 0.8, r=0.1)
        mb.box("steel", (0.5, 0.42, 0.84), (0.6, 0.02, 0.1), rot=(0, 0, 8))
        mb.bx("wood", 0.8, 0.92, 0.38, 0.46, 0.8, 0.9)
        if not low_side("n", d):  # axes on the back wall
            for q in range(3):
                ax = -0.95 + q * 0.32
                mb.box("wood_hi", (ax, D / 2 - 0.22, 1.3), (0.04, 0.04, 0.75))
                mb.box("steel", (ax + 0.07, D / 2 - 0.22, 1.6), (0.16, 0.03, 0.13))
        log_pile(mb, -0.85, -0.4, 0.05, 2, length=0.5, r=0.08, axis="y")
        mb.bx("wood", 0.35, 1.1, -0.9, 0.05, 0.05, 0.2)
        mb.bx("sack", 0.4, 1.05, -0.85, 0.0, 0.2, 0.3)
        mb.bx("leather", 0.43, 1.02, -0.18, -0.02, 0.3, 0.36)
    # yard as outside
    with mb.at((1.8, -1.8, 0)):
        mb.cyl("wood", (0, 0, 0.25), 0.27, 0.5, n=9)
        mb.cyl("wood_hi", (0, 0, 0.505), 0.25, 0.02, n=9)
        mb.box("wood_hi", (0.15, 0.05, 0.72), (0.06, 0.06, 0.6), rot=(0, 25, 0))
        mb.box("steel", (0.05, 0.05, 0.52), (0.22, 0.04, 0.14), rot=(0, 25, 0))
        for q in range(5):
            a_ = q * 72 + 20
            mb.box("wood_hi", (0.55 * math.cos(math.radians(a_)), 0.55 * math.sin(math.radians(a_)), 0.07), (0.32, 0.1, 0.1), rot=(0, 0, a_))
    with mb.at((0.35, -1.95, 0)):
        for x in (-0.3, 0.3):
            mb.box("wood", (x, -0.15, 0.38), (0.08, 0.08, 0.85), rot=(18, 0, 0))
            mb.box("wood", (x, 0.15, 0.38), (0.08, 0.08, 0.85), rot=(-18, 0, 0))
        log(mb, (0.0, 0.0, 0.72), 1.4, r=0.13)
    log_pile(mb, 1.65, 1.55, 0, [0, 2, 4][var], length=1.7, r=0.16, axis="y")
    log_pile(mb, -1.55, -1.65, 0, [0, 2, 4][var], length=1.7, r=0.16, axis="x")


def b_kaserne_innen(mb, var):
    """Barracks cutaway (ground floor): spear racks and shields on the back wall, bunks on the left wall, armour stand,
    a sack dummy for the recruit in training (position in buildings.json), table. The yard is the same as outside."""
    X, Y = 4 * T / 2, 3 * T / 2
    ground(mb, "gravel", -X + 0.1, X - 0.1, -Y + 0.1, -0.6, ragged=0.1)
    mb.rnd = random.Random(1000 * mb.seed + 79)
    W, D = 2 * X - 0.8, 4.0
    cy = Y - D / 2 - 0.35
    d = mb.view
    x0, x1, y0, y1 = -W / 2, W / 2, cy - D / 2, cy + D / 2
    th = 0.3
    for side in "nesw":
        lo = low_side(side, d)
        box = wall_box(side, x0, x1, y0, y1, th)
        gap = (-0.65, 0.65, 2.3) if side == "s" else None
        if lo:
            stone_slab(mb, side, box, 0, 0.6, (gap[0], gap[1], 0.0) if gap else None, group=side_group(side), row=0.3)
            continue
        stone_slab(mb, side, box, 0, 2.7, gap, row=0.34)
        bx0, bx1, by0, by1 = box  # plastered inner face
        ib = {"s": (bx0 + th, bx1 - th, by1, by1 + 0.03), "n": (bx0 + th, bx1 - th, by0 - 0.03, by0),
              "e": (bx0 - 0.03, bx0, by0, by1), "w": (bx1, bx1 + 0.03, by0, by1)}[side]
        slab(mb, "plaster", side, ib, 0.25, 2.62, gap)
        if gap:
            a, b, top = gap
            mb.bx("stone_top", a - 0.2, a, by0 - 0.04, by1 + 0.04, 0, top + 0.25)
            mb.bx("stone_top", b, b + 0.2, by0 - 0.04, by1 + 0.04, 0, top + 0.25)
            mb.bx("stone_top", a - 0.2, b + 0.2, by0 - 0.04, by1 + 0.04, top, top + 0.25)
    plank_floor(mb, x0 + th, x1 - th, y0 + th, y1 - th, 0.0, 0.05, pitch=0.4, along="x")
    if not low_side("n", d):  # spear racks and shields on the back wall
        yb = y1 - th - 0.25
        for (rx, n_) in ((-2.7, 6), (2.6, 5)):
            for k in (-1, 1):
                mb.box("wood", (rx + k * 0.7, yb, 0.75), (0.09, 0.09, 1.5))
            mb.box("wood", (rx, yb, 1.35), (1.5, 0.07, 0.07))
            mb.box("wood", (rx, yb, 0.35), (1.5, 0.07, 0.07))
            for q in range(n_):
                xx = rx - 0.55 + q * 1.1 / max(1, n_ - 1)
                mb.box("wood_hi", (xx, yb - 0.08, 1.05), (0.04, 0.04, 2.0), rot=(-10, 0, 0))
                mb.cyl("steel", (xx, yb - 0.26, 2.07), 0.05, 0.2, n=4, rot=(-10, 0, 0), r2=0)
        for q in range(4):
            sx = -1.0 + q * 0.62
            mb.cyl("team" if q % 2 else "wood", (sx, y1 - th - 0.05, 1.75), 0.24, 0.05, n=10, rot=(90, 0, 0))
            mb.cyl("iron", (sx, y1 - th - 0.09, 1.75), 0.07, 0.04, n=6, rot=(90, 0, 0))
    if not low_side("w", d):  # two bunks against the left wall
        bx0, bx1 = x0 + th + 0.05, x0 + th + 1.85
        for by_ in (cy - 0.85, cy + 0.75):
            for bz in (0.05, 1.15):
                bed(mb, bx0, bx1, by_ - 0.38, by_ + 0.38, bz, "x", False)
            for (px, py) in ((bx0, by_ - 0.38), (bx1, by_ - 0.38), (bx0, by_ + 0.38), (bx1, by_ + 0.38)):
                mb.bx("wood", px - 0.04, px + 0.04, py - 0.04, py + 0.04, 0.05, 1.7)
    with mb.at((-1.3, cy + 1.0, 0)):  # armour stand: mail on a cross, helmet
        mb.box("wood", (0, 0, 0.75), (0.08, 0.08, 1.5))
        mb.box("wood", (0, 0, 1.35), (0.6, 0.07, 0.07))
        mb.bx("iron", -0.24, 0.24, -0.13, 0.13, 0.75, 1.38)
        mb.blob("steel", (0, 0, 1.55), (0.14, 0.14, 0.12), seg=7, rings=4, jitter=0.02)
    dx_, dy_ = DEFS["kaserne_innen"]["dummy"]
    with mb.at((dx_ * T, dy_ * T, 0)):  # sack dummy
        mb.box("wood", (0, 0, 0.9), (0.12, 0.12, 1.8))
        mb.box("wood", (0, 0, 1.45), (0.9, 0.1, 0.1))
        mb.cyl("sack", (0, 0, 1.15), 0.24, 0.65, n=8)
        mb.blob("sack", (0, 0, 1.68), (0.17, 0.17, 0.17), seg=6, rings=4, jitter=0.05)
        mb.bx("wood", -0.35, 0.35, -0.35, 0.35, 0.05, 0.1)
    mb.bx("wood_hi", 2.2, 3.4, cy - 1.15, cy - 0.5, 0.78, 0.84)  # table with a candle
    for (lx, ly) in ((2.28, cy - 1.07), (3.32, cy - 1.07), (2.28, cy - 0.58), (3.32, cy - 0.58)):
        mb.bx("wood", lx - 0.04, lx + 0.04, ly - 0.04, ly + 0.04, 0.05, 0.78)
    mb.cyl("cloth", (2.6, cy - 0.85, 0.92), 0.04, 0.16, n=6)
    mb.box("gold", (2.6, cy - 0.85, 1.03), (0.03, 0.03, 0.06))
    # yard as outside
    banner(mb, -1.35, cy - D / 2 - 0.35, 0, h=3.3)
    banner(mb, 1.35, cy - D / 2 - 0.35, 0, h=3.3)
    with mb.at((-3.3, -2.6, 0)):
        mb.box("wood", (0, 0, 0.9), (0.12, 0.12, 1.8))
        mb.box("wood", (0, 0, 1.45), (0.9, 0.1, 0.1))
        mb.cyl("sack", (0, 0, 1.15), 0.24, 0.65, n=8)
        mb.blob("sack", (0, 0, 1.68), (0.17, 0.17, 0.17), seg=6, rings=4, jitter=0.05)
    with mb.at((3.6, -2.4, 0), rz=-30):
        mb.box("wood", (0, 0.15, 0.6), (0.1, 0.1, 1.3), rot=(-15, 0, 0))
        mb.cyl("sack", (0, 0, 1.0), 0.55, 0.16, n=12, rot=(90, 0, 0))
        mb.cyl("target", (0, -0.085, 1.0), 0.36, 0.02, n=12, rot=(90, 0, 0))
        mb.cyl("sack", (0, -0.095, 1.0), 0.2, 0.02, n=12, rot=(90, 0, 0))
        mb.cyl("target", (0, -0.105, 1.0), 0.08, 0.02, n=8, rot=(90, 0, 0))
    with mb.at((0.2, -2.9, 0)):
        for k in (-1, 1):
            mb.box("wood", (k * 0.85, 0, 0.7), (0.1, 0.1, 1.4))
        mb.box("wood", (0, 0, 1.3), (1.8, 0.08, 0.08))
        for q in range(7):
            xx = -0.7 + q * 0.23
            mb.box("wood_hi", (xx, 0.1, 1.05), (0.04, 0.04, 2.0), rot=(-10, 0, 0))
            mb.cyl("steel", (xx, -0.08, 2.07), 0.05, 0.22, n=4, rot=(-10, 0, 0), r2=0)


# ---------------------------------------------------------------- Bergfried (town centre, three levels)
# Footprint 3 x 3, door in the front wall (model -y, the access tile lies in front of it).
# Level 1: timber tower on a stone plinth inside a palisade. Level 2: stone keep, platform on 5 steps.
# Level 3: "Burgfried", platform on 6 steps, corner bartizans, a stair turret with the banner.
# Posts (archers on the platform) are in buildings.json and BUILDINGS.bergfried.levels in src/data.
BF_HW = {1: 2.45, 2: 2.85, 3: 2.85}
BF_H = {2: 5 * STEP, 3: 6 * STEP}
BF_DOOR = {1: (-0.55, 0.55, 0.7 + 2.1), 2: (-0.6, 0.6, 2.3), 3: (-0.7, 0.7, 2.5)}


def pyramid_roof(mb, hw, z0, h, mat, courses=6, ov=0.3, group=None):
    """Square pyramid roof over a body of half width hw: stacked courses, each lapping over the one above it."""
    R = (hw + ov) * math.sqrt(2)  # cyl with n = 4 puts its corners on the diagonals
    for i in range(courses):
        t0, t1 = i / courses, (i + 1) / courses
        za, zb = z0 + h * t0, z0 + h * t1
        top = R * (1 - t1)
        mb.cyl(mat, (0, 0, (za + zb) / 2), R * (1 - t0) + 0.06, zb - za, n=4, r2=(top + 0.01) if i < courses - 1 else 0, group=group)


def palisade(mb, P, gap):
    """Pointed stakes around the yard (half width P), open in front between -gap and gap."""
    step = 0.27
    r = random.Random(17)  # own draws: the same stakes outside and in the cutaway

    def run(pts):
        for (x, y) in pts:
            h = 1.35 + 0.18 * r.random()
            mb.cyl("log", (x, y, h / 2), 0.12, h, n=6)
            mb.cyl("wood_hi", (x, y, h + 0.14), 0.12, 0.28, n=6, r2=0)
    n = int(2 * P / step)
    xs = [-P + (i + 0.5) * 2 * P / n for i in range(n)]
    run([(x, P) for x in xs])                                    # back
    run([(P, x) for x in xs[1:-1]] + [(-P, x) for x in xs[1:-1]])  # sides
    run([(x, -P) for x in xs if abs(x) > gap])                   # front, open at the door
    for (a, b) in ((-P, -gap), (gap, P)):                        # rail inside the front stakes
        mb.bx("timber", a, b, -P + 0.12, -P + 0.2, 0.75, 0.85)
    mb.bx("timber", -P, P, P - 0.2, P - 0.12, 0.75, 0.85)
    for s in (-1, 1):
        mb.bx("timber", s * P - 0.04 - (0.12 if s > 0 else -0.12), s * P + 0.04 - (0.12 if s > 0 else -0.12), -P, P, 0.75, 0.85)


def bf_yard(mb, lvl):
    """Things around the keep (the same outside and in the cutaway)."""
    hw = BF_HW[lvl]
    if lvl == 1:
        palisade(mb, 3.62, 1.05)
        log_pile(mb, -3.05, 1.6, 0, 3, length=1.0, r=0.11, axis="y")
        barrel(mb, 3.05, -2.0, 0, r=0.26, h=0.66)
        crate(mb, 3.0, -1.35, 0, s=0.46, rz=8)
        mb.bx("stone_top", -0.75, 0.75, -hw - 0.95, -hw - 0.05, 0, 0.23)   # steps up to the door on the plinth
        mb.bx("stone_top", -0.75, 0.75, -hw - 0.55, -hw - 0.05, 0.23, 0.46)
        return
    a, b, top = BF_DOOR[lvl]
    mb.bx("stone_top", a - 0.35, b + 0.35, -hw - 0.7, -hw, 0, 0.12)
    barrel(mb, hw + 0.45, -hw - 0.3, 0, r=0.27, h=0.7)
    barrel(mb, hw + 0.5, -hw + 0.35, 0, r=0.25, h=0.66)
    crate(mb, -hw - 0.45, -hw - 0.2, 0, s=0.5, rz=-10)
    with mb.at((-hw - 0.5, 1.2, 0)):  # mounting block and a hitching rail
        mb.bx("stone", -0.3, 0.3, -0.35, 0.35, 0, 0.35)
        mb.bx("stone_top", -0.3, 0.3, -0.35, 0.0, 0.35, 0.55)
    for yy in (-0.6, 0.6):
        mb.bx("wood", hw + 0.55, hw + 0.65, yy - 0.05, yy + 0.05, 0, 1.0)
    mb.bx("wood_hi", hw + 0.55, hw + 0.65, -0.7, 0.7, 0.9, 1.0)
    if lvl == 3:
        for (x, y) in ((-1.9, -hw - 0.55), (1.9, -hw - 0.55)):   # braziers beside the door
            mb.cyl("iron", (x, y, 0.45), 0.05, 0.9, n=6)
            mb.cyl("iron", (x, y, 0.95), 0.2, 0.16, n=8, r2=0.26)
            mb.blob("target", (x, y, 1.08), (0.15, 0.15, 0.12), seg=6, rings=4, jitter=0.2)
            mb.blob("gold", (x, y, 1.18), (0.08, 0.08, 0.12), seg=5, rings=3, jitter=0.2)


def slit(mb, face, c, h=0.75, w=0.14):
    """Arrow slit with a stone sill on face s/n/e/w (c = centre of the opening at its bottom, on the wall face)."""
    x, y, z = c
    if face in "sn":
        k = -1 if face == "s" else 1
        mb.bx("window", x - w / 2, x + w / 2, y + k * 0.03 - 0.02, y + k * 0.03 + 0.02, z, z + h)
        mb.bx("stone_top", x - w / 2 - 0.12, x + w / 2 + 0.12, y + k * 0.06 - 0.04, y + k * 0.06 + 0.04, z - 0.08, z)
    else:
        k = 1 if face == "e" else -1
        mb.bx("window", x + k * 0.03 - 0.02, x + k * 0.03 + 0.02, y - w / 2, y + w / 2, z, z + h)
        mb.bx("stone_top", x + k * 0.06 - 0.04, x + k * 0.06 + 0.04, y - w / 2 - 0.12, y + w / 2 + 0.12, z - 0.08, z)


def shield_sign(mb, x, y, z, s=0.5):
    """House sign above the door: team-coloured shield with the gold chevron (as on the banners)."""
    mb.bx("team", x - s / 2, x + s / 2, y - 0.08, y, z, z + s * 1.05)
    mb.cyl("team", (x, y - 0.04, z), s / 2, 0.08, n=10, rot=(90, 0, 0))
    for k in (-1, 1):
        mb.box("gold", (x + k * s * 0.18, y - 0.1, z + s * 0.45), (s * 0.55, 0.02, 0.09), rot=(0, k * 38, 0))


def keep_body(mb, lvl):
    """Stone keep of level 2 or 3: battered base, masonry, string courses, cornice, platform with battlements."""
    hw, H = BF_HW[lvl], BF_H[lvl]
    a, b, top = BF_DOOR[lvl]
    batter = 0.25 if lvl == 2 else 0.35
    masonry(mb, -hw - batter, hw + batter, -hw - batter, hw + batter, 0, 0.5, row=0.25, top=True)
    if lvl == 3:
        masonry(mb, -hw - 0.17, hw + 0.17, -hw - 0.17, hw + 0.17, 0.5, 1.0, row=0.25, top=True)
    masonry(mb, -hw, hw, -hw, hw, 0, H, row=0.36, top=False)
    for zc in ((2.8,) if lvl == 2 else (2.9, 4.6)):
        mb.bx("stone_top", -hw - 0.06, hw + 0.06, -hw - 0.06, hw + 0.06, zc, zc + 0.14)
    mb.bx("stone_top", -hw - 0.1, hw + 0.1, -hw - 0.1, hw + 0.1, H - 0.22, H)   # cornice
    mb.bx("stone_top", -hw, hw, -hw, hw, H - 0.02, H + 0.04)                    # platform
    mb.bx("wood", -1.6, -1.0, 0.9, 1.5, H + 0.04, H + 0.08)                      # trapdoor
    mb.bx("iron", -1.35, -1.25, 0.95, 1.45, H + 0.08, H + 0.1)
    if lvl == 3:  # corbels under the cornice
        n = 9
        for i in range(n):
            t = -hw + (i + 0.5) * 2 * hw / n
            for (x0, x1, y0, y1) in ((t - 0.1, t + 0.1, -hw - 0.1, -hw), (t - 0.1, t + 0.1, hw, hw + 0.1),
                                     (-hw - 0.1, -hw, t - 0.1, t + 0.1), (hw, hw + 0.1, t - 0.1, t + 0.1)):
                mb.bx("stone2", x0, x1, y0, y1, H - 0.55, H - 0.22)
    groups = {"s": "f:0:-1", "n": "f:0:1", "e": "f:1:0", "w": "f:-1:0"}
    battlements(mb, -hw - 0.1, hw + 0.1, -hw - 0.1, hw + 0.1, H, sides="nesw", side_groups=groups)
    # door: stone surround, plank leaves with iron bands; the house sign above it
    y0 = -hw
    mb.bx("stone_top", a - 0.22, b + 0.22, y0 - 0.1, y0, 0, top + 0.28)
    mb.bx("door", a, b, y0 - 0.14, y0 - 0.08, 0, top)
    mb.bx("wood", -0.015, 0.015, y0 - 0.16, y0 - 0.14, 0, top)
    for zz in (0.5, top * 0.55, top - 0.35):
        mb.bx("iron", a + 0.05, b - 0.05, y0 - 0.17, y0 - 0.14, zz - 0.035, zz + 0.035)
    shield_sign(mb, 0, y0 - 0.1, top + 0.45, s=0.5 if lvl == 2 else 0.62)
    # arrow slits and windows on all faces
    zs = (1.4, 3.4) if lvl == 2 else (1.5, 3.3, 5.0)
    for zi, z in enumerate(zs):
        for t in ((-1.4, 1.4) if zi else (-1.6, 1.6)):
            if zi == 0 and abs(t) < 1.0:
                continue
            slit(mb, "s", (t, -hw, z))
            slit(mb, "n", (t, hw, z))
            slit(mb, "e", (hw, t, z))
            slit(mb, "w", (-hw, t, z))
    if lvl == 3:  # paired lancet windows of the hall over the door
        for x in (-0.25, 0.25):
            mb.bx("window", x - 0.11, x + 0.11, -hw - 0.04, -hw + 0.01, 3.35, 4.25)
        mb.bx("stone_top", -0.55, 0.55, -hw - 0.08, -hw, 3.27, 3.35)
        for t in (-0.25, 0.25):
            mb.bx("window", hw - 0.01, hw + 0.04, t - 0.11, t + 0.11, 3.35, 4.25)
        mb.bx("stone_top", hw, hw + 0.08, -0.55, 0.55, 3.27, 3.35)


def bartizan(mb, sx, sy, hw, H):
    """Corner turret corbelled out at the top of the keep, with a conical tiled roof."""
    g = "f:%d:%d" % (sx, sy)
    c = (sx * (hw - 0.05), sy * (hw - 0.05))
    mb.cyl("stone2", (c[0], c[1], H - 1.85), 0.12, 0.9, n=10, r2=0.68, group=g)    # corbel cone
    mb.cyl("stone", (c[0], c[1], H - 0.45), 0.7, 1.9, n=10, group=g)
    mb.cyl("stone_top", (c[0], c[1], H + 0.45), 0.76, 0.12, n=10, group=g)
    for k in range(5):  # merlons on the outer half
        a = math.atan2(sy, sx) + (k - 2) * 0.55
        mb.box("stone", (c[0] + 0.58 * math.cos(a), c[1] + 0.58 * math.sin(a), H + 0.82), (0.26, 0.26, 0.6), rot=(0, 0, math.degrees(a)), group=g)
    mb.cyl("roof_tile", (c[0], c[1], H + 1.05 + 0.7), 0.82, 1.4, n=10, r2=0, group=g)
    mb.cyl("gold", (c[0], c[1], H + 2.5), 0.06, 0.12, n=6, group=g)
    a = math.atan2(sy, sx)
    mb.bx("window", c[0] + 0.69 * math.cos(a) - 0.05, c[0] + 0.69 * math.cos(a) + 0.05,
          c[1] + 0.69 * math.sin(a) - 0.05, c[1] + 0.69 * math.sin(a) + 0.05, H - 0.6, H - 0.05, group=g)


def b_bergfried_holz(mb, var):
    S = 3 * T / 2
    ground(mb, "dirt", -S + 0.05, S - 0.05, -S + 0.05, S - 0.05, ragged=0.05)
    mb.rnd = random.Random(1000 * mb.seed + 81)
    hw = BF_HW[1]
    masonry(mb, -hw - 0.1, hw + 0.1, -hw - 0.1, hw + 0.1, 0, 0.7, row=0.235, top=True)
    timber_frame(mb, -hw, hw, -hw, hw, 0.7, 3.9, spacing=0.98, braces=True)
    mb.bx("timber", -hw - 0.28, hw + 0.28, -hw - 0.28, hw + 0.28, 3.9, 4.1)           # jetty beams
    for t in (-1.6, -0.55, 0.55, 1.6):
        for (x0, x1, y0, y1) in ((t - 0.07, t + 0.07, -hw - 0.3, -hw), (hw, hw + 0.3, t - 0.07, t + 0.07),
                                 (t - 0.07, t + 0.07, hw, hw + 0.3), (-hw - 0.3, -hw, t - 0.07, t + 0.07)):
            mb.bx("timber", x0, x1, y0, y1, 3.62, 3.9)
    timber_frame(mb, -hw - 0.2, hw + 0.2, -hw - 0.2, hw + 0.2, 4.1, 6.3, spacing=0.88, braces=False)
    pyramid_roof(mb, hw + 0.2, 6.3, 2.9, "shingle", courses=7, ov=0.35)
    mb.cyl("gold", (0, 0, 9.25), 0.1, 0.16, n=6)
    banner(mb, 0, 0, 9.2, h=1.5, w=0.5, bh=0.85, face="s")
    a, b, top = BF_DOOR[1]
    door(mb, "s", (0, -hw, 0.7), w=b - a, h=top - 0.7)
    for x in (-1.3, 1.3):
        window(mb, "s", (x, -hw, 2.1), w=0.45, h=0.5)
    for y in (-1.0, 1.0):
        window(mb, "e", (hw, y, 2.1), w=0.45, h=0.5)
        window(mb, "w", (-hw - 0.03, y, 2.1), w=0.45, h=0.5, shutters=False)
    for t in (-1.1, 0.0, 1.1):
        window(mb, "s", (t, -hw - 0.2, 4.95), w=0.42, h=0.55)
        window(mb, "e", (hw + 0.2, t, 4.95), w=0.42, h=0.55)
    bf_yard(mb, 1)


def b_bergfried_stein(mb, var):
    S = 3 * T / 2
    ground(mb, "gravel", -S + 0.05, S - 0.05, -S + 0.05, S - 0.05, ragged=0.05)
    mb.rnd = random.Random(1000 * mb.seed + 82)
    keep_body(mb, 2)
    hw, H = BF_HW[2], BF_H[2]
    banner(mb, hw - 0.5, hw - 0.5, H, h=2.4, w=0.55, bh=1.0, face="s", group="f:1:1")
    bf_yard(mb, 2)


def b_bergfried_burg(mb, var):
    S = 3 * T / 2
    ground(mb, "gravel", -S + 0.05, S - 0.05, -S + 0.05, S - 0.05, ragged=0.05)
    mb.rnd = random.Random(1000 * mb.seed + 83)
    keep_body(mb, 3)
    hw, H = BF_HW[3], BF_H[3]
    for sx in (-1, 1):
        for sy in (-1, 1):
            bartizan(mb, sx, sy, hw, H)
    # stair turret in the middle of the platform, the banner on top
    masonry(mb, -0.6, 0.6, -0.6, 0.6, H, H + 1.9, row=0.32, top=True)
    mb.bx("door", -0.3, 0.3, -0.64, -0.6, H + 0.04, H + 1.4)
    battlements(mb, -0.68, 0.68, -0.68, 0.68, H + 1.9, h=0.5, th=0.18, merlon=0.3, gap=0.22)
    banner(mb, 0.25, 0.25, H + 1.9, h=2.1, w=0.55, bh=0.95, face="s")
    bf_yard(mb, 3)


def seated_lord(mb, x, y, z):
    """The lord at the table, seen from the front (faces model -y): tunic in the house colour, cloak, gold circlet."""
    mb.bx("leather", x - 0.2, x + 0.2, y - 0.25, y + 0.1, z + 0.42, z + 0.56)              # thighs on the seat
    mb.blob("team", (x, y + 0.02, z + 0.88), (0.24, 0.17, 0.34), seg=8, rings=5, jitter=0.03)
    mb.blob("target", (x, y + 0.13, z + 0.92), (0.27, 0.12, 0.36), seg=8, rings=5, jitter=0.03)  # cloak behind
    for k in (-1, 1):  # arms forward onto the table
        mb.box("team", (x + k * 0.24, y - 0.15, z + 0.9), (0.1, 0.38, 0.11), rot=(-25, 0, 0))
        mb.bx("skin", x + k * 0.24 - 0.05, x + k * 0.24 + 0.05, y - 0.42, y - 0.32, z + 0.78, z + 0.84)
    mb.blob("skin", (x, y, z + 1.33), (0.13, 0.13, 0.15), seg=8, rings=5, jitter=0.02)
    mb.blob("hair", (x, y + 0.03, z + 1.4), (0.13, 0.12, 0.09), seg=7, rings=4, jitter=0.02)
    mb.bx("hair", x - 0.08, x + 0.08, y - 0.14, y - 0.06, z + 1.17, z + 1.27)             # beard
    mb.cyl("gold", (x, y, z + 1.45), 0.14, 0.06, n=8)


def scholar(mb, x, y, z):
    """The scholar standing at the lectern (faces model +x): long brown robe, grey hair, hands on the book."""
    mb.cyl("leather", (x, y, z + 0.55), 0.27, 1.1, n=8, r2=0.19)
    mb.blob("leather", (x, y, z + 1.18), (0.2, 0.2, 0.22), seg=8, rings=5, jitter=0.03)
    mb.blob("skin", (x + 0.02, y, z + 1.5), (0.12, 0.12, 0.14), seg=8, rings=5, jitter=0.02)
    mb.blob("steel", (x - 0.03, y, z + 1.56), (0.12, 0.13, 0.08), seg=7, rings=4, jitter=0.03)
    for k in (-1, 1):
        mb.box("leather", (x + 0.2, y + k * 0.16, z + 1.08), (0.36, 0.09, 0.1), rot=(0, 20, 0))
        mb.bx("skin", x + 0.34, x + 0.42, y + k * 0.12 - 0.04, y + k * 0.12 + 0.04, z + 0.98, z + 1.04)


def lectern(mb, x, y, z, book):
    mb.bx("wood", x - 0.06, x + 0.06, y - 0.06, y + 0.06, z, z + 0.95)
    mb.bx("wood", x - 0.25, x + 0.25, y - 0.25, y + 0.25, z, z + 0.05)
    mb.box("wood_hi", (x, y, z + 1.0), (0.42, 0.55, 0.05), rot=(0, 20, 0))
    if book:
        for k in (-1, 1):
            mb.box("cloth", (x - 0.02, y + k * 0.13, z + 1.05), (0.3, 0.24, 0.04), rot=(0, 20, 0))
        mb.box("leather", (x - 0.02, y, z + 1.03), (0.33, 0.52, 0.02), rot=(0, 20, 0))
        mb.cyl("cloth", (x + 0.18, y + 0.35, z + 1.0), 0.03, 0.14, n=6)      # candle
        mb.box("gold", (x + 0.18, y + 0.35, z + 1.1), (0.03, 0.03, 0.06))
    else:
        mb.box("leather", (x - 0.02, y, z + 1.05), (0.3, 0.4, 0.06), rot=(0, 20, 0))   # closed book


def b_bergfried_innen(lvl):
    """Cutaway of the keep's hall (ground floor): the lord at his table; variant 1 adds the scholar at the lectern
    (shown while research is running). Walls towards the camera stay low (front mask)."""
    def build(mb, var):
        S = 3 * T / 2
        ground(mb, "dirt" if lvl == 1 else "gravel", -S + 0.05, S - 0.05, -S + 0.05, S - 0.05, ragged=0.05)
        mb.rnd = random.Random(1000 * mb.seed + 84)
        hw = BF_HW[lvl]
        d = mb.view
        a, b, top = BF_DOOR[lvl]
        if lvl == 1:
            z0 = 0.73
            masonry(mb, -hw - 0.1, hw + 0.1, -hw - 0.1, hw + 0.1, 0, 0.7, row=0.235, top=True)
            cut_house(mb, -hw, hw, -hw, hw, 0.7, 3.2, th=0.16, gaps={"s": (a, b, top)}, posts=0.98, plinth=False)
            plank_floor(mb, -hw + 0.16, hw - 0.16, -hw + 0.16, hw - 0.16, 0.7, z0, pitch=0.34, along="x")
            th = 0.16
        else:
            z0 = 0.06
            th = 0.42
            for side in "nesw":
                lo = low_side(side, d)
                box = wall_box(side, -hw, hw, -hw, hw, th)
                gap = (a, b, top) if side == "s" else None
                if lo:
                    stone_slab(mb, side, box, 0, 0.6, (gap[0], gap[1], 0.0) if gap else None, group=side_group(side), row=0.3)
                    continue
                stone_slab(mb, side, box, 0, 3.0, gap, row=0.36)
                bx0, bx1, by0, by1 = box
                ib = {"s": (bx0 + th, bx1 - th, by1, by1 + 0.03), "n": (bx0 + th, bx1 - th, by0 - 0.03, by0),
                      "e": (bx0 - 0.03, bx0, by0, by1), "w": (bx1, bx1 + 0.03, by0, by1)}[side]
                slab(mb, "plaster", side, ib, 0.3, 2.92, gap)
            # flagstone floor
            n = 6
            q = (2 * (hw - th)) / n
            for i in range(n):
                for j in range(n):
                    x0_, y0_ = -hw + th + i * q, -hw + th + j * q
                    mb.bx("stone2" if (i * 7 + j * 3) % 4 == 0 else "stone_top", x0_ + 0.02, x0_ + q - 0.02, y0_ + 0.02, y0_ + q - 0.02, 0, z0)
            if lvl == 3:
                mb.bx("target", -1.35, 1.35, -0.4, 1.6, z0, z0 + 0.02)          # carpet under the table
                mb.bx("gold", -1.35, 1.35, -0.4, -0.3, z0 + 0.02, z0 + 0.025)
        inner = hw - th
        # stair up to the platform along the left wall, rising towards the back
        nst = 9
        for i in range(nst):
            yy = -0.9 + i * (inner + 0.9 - 0.1) / nst
            zz = z0 + (i + 1) * (2.9 - z0) / nst
            mb.bx("wood" if lvl == 1 else "stone", -inner, -inner + 0.85, yy, yy + (inner + 0.8) / nst + 0.02, zz - 0.12, zz)
            mb.bx("wood_hi" if lvl == 1 else "stone_top", -inner, -inner + 0.85, yy, yy + 0.08, zz - 0.02, zz)
        # back wall: tapestry with the house sign, torches; left of it the hearth
        if not low_side("n", d):
            yb = inner - 0.02
            mb.bx("team", -0.7, 0.7, yb - 0.04, yb, 1.1, 2.6)
            for k in (-1, 1):
                mb.box("gold", (k * 0.25, yb - 0.06, 1.95), (0.75, 0.02, 0.12), rot=(0, k * 38, 0))
            mb.bx("gold", -0.72, 0.72, yb - 0.06, yb - 0.04, 2.55, 2.62)
            for x in (-1.3, 1.3):
                mb.bx("iron", x - 0.04, x + 0.04, yb - 0.2, yb, 1.85, 1.92)
                mb.cyl("wood", (x, yb - 0.18, 2.0), 0.04, 0.24, n=6)
                mb.blob("gold", (x, yb - 0.18, 2.18), (0.07, 0.07, 0.11), seg=5, rings=3, jitter=0.15)
        if not low_side("e", d):  # hearth against the right wall
            xh = inner - 0.02
            masonry(mb, xh - 0.45, xh, -1.6, -0.5, z0, 2.0, row=0.3, top=True)
            mb.bx("window", xh - 0.47, xh - 0.44, -1.4, -0.7, z0, z0 + 0.7)
            mb.bx("stone_top", xh - 0.7, xh, -1.75, -0.35, z0, z0 + 0.08)
            mb.blob("target", (xh - 0.45, -1.05, z0 + 0.18), (0.2, 0.25, 0.12), seg=6, rings=4, jitter=0.2)
            mb.blob("gold", (xh - 0.45, -1.05, z0 + 0.3), (0.1, 0.14, 0.12), seg=5, rings=3, jitter=0.2)
            log(mb, (xh - 0.5, -1.05, z0 + 0.08), 0.6, r=0.06, axis="y")
            # shelf with books and scrolls behind the lectern
            mb.bx("wood", xh - 0.35, xh, 0.4, 1.6, z0, z0 + 1.9)
            for k, zz in enumerate((z0 + 0.5, z0 + 1.1, z0 + 1.7)):
                mb.bx("wood_hi", xh - 0.37, xh, 0.4, 1.6, zz - 0.04, zz)
                for i in range(6):
                    yy = 0.5 + i * 0.18
                    m = ("leather", "team", "target", "leather", "wood_hi", "steel")[(i + k) % 6]
                    if (i + k) % 5 == 4:
                        mb.cyl("sack", (xh - 0.18, yy, zz + 0.07), 0.06, 0.3, n=6, rot=(0, 90, 0))
                    else:
                        mb.bx(m, xh - 0.3, xh - 0.06, yy - 0.06, yy + 0.06, zz, zz + 0.32 - 0.04 * (i % 2))
        # table with the lord in his chair, goblet, plate, a charter
        ty = 0.75
        mb.bx("wood_hi", -1.0, 1.0, ty - 0.45, ty + 0.3, z0 + 0.74, z0 + 0.8)
        for (lx, ly) in ((-0.9, ty - 0.37), (0.9, ty - 0.37), (-0.9, ty + 0.22), (0.9, ty + 0.22)):
            mb.bx("wood", lx - 0.05, lx + 0.05, ly - 0.05, ly + 0.05, z0, z0 + 0.74)
        cy_ = ty + 0.55
        mb.bx("wood", -0.32, 0.32, cy_ - 0.28, cy_ + 0.25, z0 + 0.4, z0 + 0.48)        # chair seat
        mb.bx("wood", -0.34, 0.34, cy_ + 0.22, cy_ + 0.32, z0, z0 + 1.75)               # high back
        mb.bx("team", -0.26, 0.26, cy_ + 0.18, cy_ + 0.22, z0 + 0.6, z0 + 1.55)
        mb.cyl("gold", (-0.3, cy_ + 0.27, z0 + 1.8), 0.05, 0.1, n=6)
        mb.cyl("gold", (0.3, cy_ + 0.27, z0 + 1.8), 0.05, 0.1, n=6)
        seated_lord(mb, 0, cy_, z0)
        mb.cyl("gold", (0.55, ty - 0.2, z0 + 0.9), 0.05, 0.2, n=8, r2=0.07)
        mb.cyl("steel", (-0.5, ty - 0.2, z0 + 0.82), 0.16, 0.03, n=10)
        mb.bx("cloth", -0.2, 0.2, ty - 0.38, ty - 0.12, z0 + 0.8, z0 + 0.82)
        mb.bx("target", -0.03, 0.03, ty - 0.4, ty - 0.36, z0 + 0.79, z0 + 0.82)          # seal
        # chest and a barrel by the door
        with mb.at((-1.25, -inner + 0.45, z0)):
            mb.bx("crate", -0.35, 0.35, -0.22, 0.22, 0, 0.45)
            mb.bx("iron", -0.37, 0.37, -0.24, 0.24, 0.41, 0.46)
            mb.bx("gold", -0.05, 0.05, -0.25, -0.22, 0.25, 0.38)
        barrel(mb, inner - 0.35, -inner + 0.35, z0, r=0.24, h=0.62)
        # lectern; the scholar stands at it while research runs
        lx, ly = 1.25, -0.55
        lectern(mb, lx + 0.45, ly, z0, var >= 1)
        if var >= 1:
            scholar(mb, lx - 0.05, ly, z0)
            for i in range(3):  # scrolls on the floor beside him
                mb.cyl("sack", (lx - 0.2 + i * 0.2, ly - 0.55, z0 + 0.06), 0.06, 0.35, n=6, rot=(90, 0, 15 * i))
        bf_yard(mb, lvl)
    return build


# ---------------------------------------------------------------- bread chain (ADR 0011): granary, mill, bakery, goods
def sack(mb, x, y, z, mat="sack", s=1.0, rz=0.0, fill=None):
    """Sack standing upright: tied neck, or open with its filling on top (fill = material, e.g. thatch for grain)."""
    with mb.at((x, y, z), rz):
        mb.blob(mat, (0, 0, 0.22 * s), (0.2 * s, 0.17 * s, 0.22 * s), seg=8, rings=5, jitter=0.05)
        if fill:
            mb.cyl(mat, (0, 0, 0.42 * s), 0.16 * s, 0.08 * s, n=8, r2=0.18 * s)
            mb.cyl(fill, (0, 0, 0.465 * s), 0.15 * s, 0.03 * s, n=8)
        else:
            mb.cyl(mat, (0, 0, 0.47 * s), 0.06 * s, 0.1 * s, n=6, r2=0.1 * s)
            mb.cyl("rope", (0, 0, 0.43 * s), 0.075 * s, 0.03 * s, n=6)


def sack_lying(mb, x, y, z, mat="sack", rz=0.0):
    """Full sack lying on its side (long axis along local y), tied end towards +y."""
    with mb.at((x, y, z), rz):
        mb.blob(mat, (0, 0, 0.14), (0.21, 0.3, 0.14), seg=8, rings=5, jitter=0.04)
        mb.cyl(mat, (0, 0.33, 0.13), 0.055, 0.1, n=6, rot=(90, 0, 0))
        mb.cyl("rope", (0, 0.29, 0.13), 0.07, 0.025, n=6, rot=(90, 0, 0))


def loaf(mb, x, y, z, s=1.0, long=False, rz=0.0):
    """Bread: round loaf with a lighter scored top, or a long loaf."""
    with mb.at((x, y, z), rz):
        if long:
            mb.blob("bread", (0, 0, 0.06 * s), (0.17 * s, 0.075 * s, 0.065 * s), seg=8, rings=4, jitter=0.03)
            for k in (-1, 0, 1):
                mb.box("wood_hi", (k * 0.07 * s, 0, 0.12 * s), (0.02 * s, 0.07 * s, 0.012 * s), rot=(0, 0, 30))
        else:
            mb.blob("bread", (0, 0, 0.055 * s), (0.11 * s, 0.11 * s, 0.065 * s), seg=8, rings=4, jitter=0.03)
            mb.box("wood_hi", (0, 0, 0.115 * s), (0.12 * s, 0.025 * s, 0.012 * s), rot=(0, 0, 40))


def basket(mb, x, y, z, fill=None, r=0.26, h=0.24):
    """Wicker basket with a rim; fill = 'bread' (loaves heaped on top) or a material heaped inside (grain)."""
    mb.cyl("thatch_dk", (x, y, z + h / 2), r, h, n=10, r2=r * 1.12)
    for q in (0.3, 0.65):
        mb.cyl("thatch", (x, y, z + h * q), r * (1 + 0.12 * q) + 0.008, 0.03, n=10)
    mb.cyl("wood_hi", (x, y, z + h - 0.015), r * 1.14, 0.035, n=10)
    if fill == "bread":
        for (dx, dy, dz) in ((-0.1, -0.07, 0), (0.1, -0.05, 0), (0.0, 0.1, 0), (0.02, -0.01, 0.07)):
            loaf(mb, x + dx * r / 0.26, y + dy * r / 0.26, z + h - 0.05 + dz, s=0.85)
    elif fill:
        mb.blob(fill, (x, y, z + h - 0.02), (r * 0.95, r * 0.95, 0.07), seg=8, rings=4, jitter=0.04)


# stacks in the storage bays (1 x 1, level 0 empty), the same sprites stand at the processing buildings' piles
_SACK_GRID = [(x, y, 0.0) for y in (-0.3, 0.3) for x in (-0.48, 0.0, 0.48)] + \
             [(x, y, 0.25) for y in (-0.3, 0.3) for x in (-0.24, 0.24)] + [(0.0, -0.3, 0.5), (0.0, 0.3, 0.5)]
_SACK_COUNT = [0, 3, 6, 10, 12]


def b_stapel_getreide(mb, var):
    """Grain: burlap sacks lying in courses (3, 6, 10, 12) on two boards, an open sack of grain in front from level 2."""
    if not var:
        return
    for y in (-0.3, 0.3):
        mb.bx("wood", -0.75, 0.75, y - 0.12, y + 0.12, STACK_Z, STACK_Z + 0.05)
    for i, (x, y, z) in enumerate(_SACK_GRID[:_SACK_COUNT[var]]):
        sack_lying(mb, x, y, STACK_Z + 0.05 + z, "sack", rz=180 if (i % 2) else 0)
    if var >= 2:
        sack(mb, 0.62, -0.62, STACK_Z, "sack", s=0.85, fill="thatch")


def b_stapel_mehl(mb, var):
    """Flour: white linen sacks lying in courses, flour dust on the boards, a flour barrel from level 3."""
    if not var:
        return
    for y in (-0.3, 0.3):
        mb.bx("wood", -0.75, 0.75, y - 0.12, y + 0.12, STACK_Z, STACK_Z + 0.05)
    mb.cyl("flour", (-0.45, -0.58, STACK_Z + 0.006), 0.22, 0.012, n=9)
    n = _SACK_COUNT[var] - (2 if var >= 3 else 0)
    for i, (x, y, z) in enumerate(_SACK_GRID[:n]):
        sack_lying(mb, x, y, STACK_Z + 0.05 + z, "cloth", rz=180 if (i % 2) else 0)
    if var >= 3:
        barrel(mb, 0.68, -0.62, STACK_Z, r=0.22, h=0.6)
        mb.cyl("flour", (0.68, -0.62, STACK_Z + 0.62), 0.19, 0.02, n=10)


def b_stapel_brot(mb, var):
    """Bread: wicker baskets with loaves (1-4), a board of long loaves across the back baskets at level 4."""
    if not var:
        return
    spots = [(-0.34, -0.28), (0.34, -0.28), (-0.34, 0.32), (0.34, 0.32)]
    for (x, y) in spots[:var]:
        basket(mb, x, y, STACK_Z, "bread")
    if var >= 4:
        mb.bx("wood_hi", -0.7, 0.7, 0.62, 0.86, STACK_Z, STACK_Z + 0.32)
        for k in range(4):
            loaf(mb, -0.48 + k * 0.32, 0.74, STACK_Z + 0.32, long=True, rz=90)


# granary: same outline and gate position as the storehouse (access tile in front of the -y wall), plank walls, thatch
KK_X, KK_Y0, KK_Y1, KK_BASE, KK_EAVE = 3.5, -2.95, 3.6, 0.5, 2.6
KK_DOOR = (-0.75, 0.75, 2.1)


def board_wall(mb, x0, x1, y0, y1, z0, z1, pitch=0.27):
    """Closed plank-clad wall body: a core, vertical boards proud on every face, corner posts, a rail and a top plate."""
    mb.bx("wood", x0 + 0.02, x1 - 0.02, y0 + 0.02, y1 - 0.02, z0, z1)
    k, x = 0, x0
    while x < x1 - 0.05:
        m = "log" if k % 3 == 0 else "wood_hi"
        xa, xb = x + 0.02, min(x1, x + pitch) - 0.02
        mb.bx(m, xa, xb, y0 - 0.02, y0 + 0.03, z0, z1)
        mb.bx(m, xa, xb, y1 - 0.03, y1 + 0.02, z0, z1)
        x += pitch
        k += 1
    k, y = 0, y0
    while y < y1 - 0.05:
        m = "log" if k % 3 == 0 else "wood_hi"
        ya, yb = y + 0.02, min(y1, y + pitch) - 0.02
        mb.bx(m, x0 - 0.02, x0 + 0.03, ya, yb, z0, z1)
        mb.bx(m, x1 - 0.03, x1 + 0.02, ya, yb, z0, z1)
        y += pitch
        k += 1
    for (px, py) in ((x0, y0), (x1, y0), (x1, y1), (x0, y1)):
        mb.bx("timber", px - 0.12, px + 0.12, py - 0.12, py + 0.12, z0, z1 + 0.04)
    for (za, zb) in ((z0 + (z1 - z0) * 0.45, z0 + (z1 - z0) * 0.45 + 0.1), (z1 - 0.12, z1)):
        mb.bx("timber", x0 - 0.05, x1 + 0.05, y0 - 0.05, y0, za, zb)
        mb.bx("timber", x0 - 0.05, x1 + 0.05, y1, y1 + 0.05, za, zb)
        mb.bx("timber", x0 - 0.05, x0, y0, y1, za, zb)
        mb.bx("timber", x1, x1 + 0.05, y0, y1, za, zb)


def kk_gate(mb, y0):
    """Double plank door from the ground (cut through the plinth) with frame, iron bands and a stone sill."""
    a, b, top = KK_DOOR
    mb.bx("timber", a - 0.16, a, y0 - 0.1, y0 + 0.02, 0, top + 0.05)
    mb.bx("timber", b, b + 0.16, y0 - 0.1, y0 + 0.02, 0, top + 0.05)
    mb.bx("timber", a - 0.22, b + 0.22, y0 - 0.12, y0 + 0.02, top, top + 0.2)
    for (l0, l1) in ((a, -0.02), (0.02, b)):
        mb.bx("door", l0, l1, y0 - 0.09, y0 - 0.04, 0.02, top)
        for q in range(1, 3):
            xx = l0 + (l1 - l0) * q / 3
            mb.bx("wood", xx - 0.012, xx + 0.012, y0 - 0.1, y0 - 0.08, 0.02, top)
        for zz in (0.4, top - 0.4):
            mb.bx("iron", l0 + 0.04, l1 - 0.04, y0 - 0.12, y0 - 0.09, zz - 0.04, zz + 0.04)
    mb.bx("stone_top", a - 0.3, b + 0.3, y0 - 0.5, y0 - 0.05, 0, 0.1)


def kk_apron(mb, var):
    """Fill level in front of the door: grain sacks, a basket of bread, a flour sack and a barrel (variants 0..4)."""
    y = -3.42
    if var >= 1:
        sack(mb, -2.3, y, 0, "sack", rz=8, fill="thatch")
    if var >= 2:
        basket(mb, 2.25, y, 0, "bread")
    if var >= 3:
        sack(mb, -1.78, y - 0.04, 0, "cloth", rz=-12)
        barrel(mb, 1.62, y + 0.02, 0, r=0.25, h=0.66)
    if var >= 4:
        sack_lying(mb, -2.05, y + 0.02, 0.42, "sack", rz=90)
        basket(mb, 2.78, y + 0.08, 0, "thatch", r=0.22, h=0.22)


def b_kornkammer(mb, var):
    """Granary 3 x 3: stone plinth with vent slits, vertical plank walls, thatched roof (ridge along x), a sheaf over the
    double door under a small shingled porch roof. Variant = fill level (sacks and baskets in front of the door)."""
    S = 3 * T / 2
    ground(mb, "dirt", -S + 0.05, S - 0.05, -S + 0.05, S - 0.05, ragged=0.05)
    x, y0, y1 = KK_X, KK_Y0, KK_Y1
    masonry(mb, -x - 0.05, x + 0.05, y0 - 0.05, y1 + 0.05, 0, KK_BASE, row=0.25, top=True)
    for xx in (-2.5, -1.6, 1.6, 2.5):
        mb.bx("window", xx - 0.13, xx + 0.13, y0 - 0.08, y0 - 0.04, 0.17, 0.31)
    for yy in (-1.7, 0.3, 2.3):
        mb.bx("window", x + 0.04, x + 0.08, yy - 0.13, yy + 0.13, 0.17, 0.31)
        mb.bx("window", -x - 0.08, -x - 0.04, yy - 0.13, yy + 0.13, 0.17, 0.31)
    board_wall(mb, -x, x, y0, y1, KK_BASE, KK_EAVE)
    cy = (y0 + y1) / 2
    with mb.at((0, cy, 0)):
        gable_roof(mb, 2 * x, (y1 - y0) / 2 + 0.45, KK_EAVE, 2.5, "thatch", ov=0.35, row=0.42, thick=0.2, gable="wood",
                   ridge="thatch_dk", edge="thatch_dk")
    kk_gate(mb, y0)
    top = KK_DOOR[2]
    # porch roof over the door on two posts, the sheaf of grain (house sign) above the door
    for px in (-1.05, 1.05):
        mb.bx("timber", px - 0.07, px + 0.07, y0 - 0.92, y0 - 0.78, 0, top + 0.42)
    mb.bx("timber", -1.15, 1.15, y0 - 0.92, y0 - 0.78, top + 0.32, top + 0.44)
    mb.box("shingle", (0, y0 - 0.5, top + 0.55), (2.6, 1.15, 0.07), rot=(18, 0, 0))
    mb.cyl("thatch", (0, y0 - 0.12, top + 0.4), 0.13, 0.42, n=8, r2=0.2)
    mb.cyl("rope", (0, y0 - 0.12, top + 0.36), 0.15, 0.05, n=8)
    # hatches in the gable walls
    mb.bx("timber", x + 0.02, x + 0.08, 0.0, 0.62, 1.3, 1.85)
    mb.bx("door", x + 0.06, x + 0.1, 0.06, 0.56, 1.36, 1.79)
    mb.bx("timber", -x - 0.08, -x - 0.02, 0.0, 0.62, 1.3, 1.85)
    mb.bx("door", -x - 0.1, -x - 0.06, 0.06, 0.56, 1.36, 1.79)
    kk_apron(mb, var)


def b_kornkammer_innen(mb, var):
    """Granary cutaway: plank floor with six bays (shelves from buildings.json, the same as
    BUILDINGS.kornkammer.storage.shelves in src/data), racks with sacks and baskets on the full walls, a grain bin at the
    back. Goods (stapel_*) and carriers are drawn by the game on top, then the low front walls (_front)."""
    S = 3 * T / 2
    ground(mb, "dirt", -S + 0.05, S - 0.05, -S + 0.05, S - 0.05, ragged=0.05)
    x, y0, y1 = KK_X, KK_Y0, KK_Y1
    mb.rnd = random.Random(1000 * mb.seed + 77)
    th = 0.16
    cut_house(mb, -x, x, y0, y1, KK_BASE, KK_EAVE, th=th, gaps={"s": KK_DOOR}, posts=0.9, wall="wood_hi")
    plank_floor(mb, -x + th, x - th, y0 + th, y1 - th, 0.0, STACK_Z - 0.01, pitch=0.36, along="x")
    mb.bx("stone_top", KK_DOOR[0], KK_DOOR[1], y0 - 0.5, y0 + th, 0, 0.06)
    d = mb.view
    for k, (sx, sy) in enumerate(DEFS["kornkammer_innen"]["shelves"]):
        cx, cy = sx * T, sy * T
        sg = 1 if cx > 0 else -1
        mb.bx("wood", cx - 0.9, cx + 0.9, cy - 0.78, cy + 0.78, STACK_Z - 0.01, STACK_Z)
        kx = cx - sg * 0.93
        mb.bx("timber", kx - 0.03, kx + 0.03, cy - 0.78, cy + 0.78, STACK_Z, STACK_Z + 0.08)
        if not low_side("e" if sg > 0 else "w", d):
            wx = sg * (x - th - 0.06)
            for yy in (cy - 0.86, cy + 0.86):
                mb.bx("timber", wx - 0.05, wx + 0.05, yy - 0.05, yy + 0.05, 0, 2.45)
            mb.bx("wood_hi", min(wx, wx - sg * 0.42), max(wx, wx - sg * 0.42), cy - 0.84, cy + 0.84, 2.0, 2.05)
            if k % 2:
                basket(mb, wx - sg * 0.21, cy - 0.3, 2.05, "bread", r=0.17, h=0.16)
                basket(mb, wx - sg * 0.21, cy + 0.3, 2.05, "thatch", r=0.17, h=0.16)
            else:
                for q in range(2):
                    sack(mb, wx - sg * 0.21, cy - 0.3 + q * 0.6, 2.05, "sack" if q else "cloth", s=0.7)
    # back wall at full height: grain bin with a heap of grain, wooden shovel, a beam scale
    if not low_side("n", d):
        yb = y1 - th
        mb.bx("wood", -0.85, 0.85, yb - 0.75, yb, 0, 0.95)
        mb.bx("wood_hi", -0.88, 0.88, yb - 0.78, yb - 0.7, 0, 1.0)
        mb.blob("thatch", (0, yb - 0.38, 0.92), (0.75, 0.32, 0.16), seg=8, rings=4, jitter=0.05)
        mb.box("wood_hi", (1.15, yb - 0.25, 0.75), (0.08, 0.05, 1.5), rot=(-10, 0, 0))
        mb.box("wood_hi", (1.15, yb - 0.38, 0.12), (0.28, 0.32, 0.04), rot=(-10, 0, 0))
        mb.bx("timber", -0.07, 0.07, yb - 0.35, yb, 2.15, 2.3)
        mb.box("rope", (0, yb - 0.3, 1.95), (0.02, 0.02, 0.4))
        mb.bx("wood", -0.55, 0.55, yb - 0.33, yb - 0.27, 1.73, 1.77)
        for sx in (-0.5, 0.5):
            mb.box("rope", (sx, yb - 0.3, 1.6), (0.015, 0.015, 0.26))
            mb.cyl("iron", (sx, yb - 0.3, 1.47), 0.13, 0.03, n=8)
    kk_apron(mb, var)


# windmill: round stone tower, cap with the windshaft along +x, four sails turning in the y-z plane on the +x side
ML_R0, ML_R1, ML_H = 2.4, 1.9, 5.6
ML_HUB = (2.75, 0.0, 6.12)
ML_SAIL = 3.7
ML_N = 20
ML_DOOR = (-0.55, 0.55, 2.0)


def ml_r(z):
    return ML_R0 + (ML_R1 - ML_R0) * z / ML_H


def mill_ground(mb):
    S = 3 * T / 2
    ground(mb, "dirt", -S + 0.1, S - 0.1, -S + 0.1, S - 0.1, ragged=0.3)


def mill_tower(mb):
    mb.cyl("stone", (0, 0, ML_H / 2), ML_R0, ML_H, n=ML_N, r2=ML_R1)
    z = 0.42
    while z < ML_H - 0.2:
        mb.cyl("mortar", (0, 0, z), ml_r(z) + 0.012, 0.04, n=ML_N)
        z += 0.42
    r = mb.rnd
    for i in range(90):
        a = r.uniform(0, 2 * math.pi)
        z = r.uniform(0.45, ML_H - 0.3)
        rr = ml_r(z) * math.cos(math.pi / ML_N)
        mb.box("stone2" if i % 3 else "stone_top", (rr * math.cos(a), rr * math.sin(a), z), (0.05, r.uniform(0.35, 0.6), 0.3),
               rot=(0, 0, math.degrees(a)))
    mb.cyl("stone_top", (0, 0, 0.16), ML_R0 + 0.14, 0.32, n=ML_N)
    mb.cyl("stone_top", (0, 0, ML_H - 0.08), ML_R1 + 0.1, 0.16, n=ML_N)


def mill_door(mb):
    a, b, top = ML_DOOR
    y = -ml_r(1.0) * math.cos(math.pi / ML_N)
    mb.bx("stone_top", a - 0.28, b + 0.28, y - 0.18, y + 0.25, 0, top + 0.28)
    mb.bx("window", a, b, y - 0.2, y - 0.17, 0.0, top)
    mb.bx("door", a + 0.02, b - 0.02, y - 0.24, y - 0.19, 0.02, top - 0.02)
    for zz in (0.45, top - 0.45):
        mb.bx("iron", a + 0.06, b - 0.06, y - 0.27, y - 0.24, zz - 0.04, zz + 0.04)
    mb.bx("stone_top", a - 0.35, b + 0.35, y - 0.6, y - 0.15, 0, 0.12)


def mill_windows(mb):
    for (ang, z) in ((54, 2.7), (-54, 3.9), (144, 3.3), (-144, 2.4), (0, 4.2)):
        rr = ml_r(z) * math.cos(math.pi / ML_N)
        with mb.at((0, 0, 0), ang):
            mb.bx("stone_top", -0.34, 0.34, -rr - 0.06, -rr + 0.2, z - 0.12, z + 0.62)
            mb.bx("window", -0.22, 0.22, -rr - 0.08, -rr - 0.05, z, z + 0.5)


def mill_cap(mb):
    z = ML_H
    mb.cyl("timber", (0, 0, z + 0.1), ML_R1 + 0.18, 0.2, n=ML_N)
    with mb.at((0.25, 0, z + 0.2)):
        mb.bx("wood", -1.75, 1.75, -1.1, 1.1, 0, 0.7)
        k, x = 0, -1.75
        while x < 1.7:
            m = "log" if k % 3 == 0 else "wood_hi"
            mb.bx(m, x + 0.02, min(1.75, x + 0.27) - 0.02, -1.13, -1.08, 0, 0.7)
            mb.bx(m, x + 0.02, min(1.75, x + 0.27) - 0.02, 1.08, 1.13, 0, 0.7)
            x += 0.27
            k += 1
        gable_roof(mb, 3.5, 1.4, 0.7, 1.15, "shingle", ov=0.18, row=0.3, thick=0.06, gable="wood", ridge="timber")
    hx, hy, hz = ML_HUB
    mb.cyl("timber", ((hx + 1.6) / 2, hy, hz), 0.17, hx - 1.6, n=8, rot=(0, 90, 0))
    mb.cyl("timber", (hx, hy, hz), 0.3, 0.36, n=8, rot=(0, 90, 0))
    mb.cyl("iron", (hx + 0.19, hy, hz), 0.16, 0.04, n=8, rot=(0, 90, 0))
    # tail pole down to the ground on the -x side (the miller turns the cap into the wind with it)
    p0, p1 = (-1.4, 0.0, z + 0.45), (-3.35, 0.0, 0.75)
    L = math.dist(p0, p1)
    ang = math.degrees(math.atan2(-(p1[2] - p0[2]), p1[0] - p0[0]))
    mb.box("timber", tuple((p0[i] + p1[i]) / 2 for i in range(3)), (L, 0.16, 0.16), rot=(0, ang, 0))
    for sy in (-0.7, 0.7):
        q0, q1 = (-1.4, sy, z + 0.25), (-2.6, 0.0, 2.9)
        L2 = math.dist(q0, q1)
        mb.box("timber", tuple((q0[i] + q1[i]) / 2 for i in range(3)), (L2, 0.09, 0.09),
               rot=(0, math.degrees(math.atan2(-(q1[2] - q0[2]), math.hypot(q1[0] - q0[0], q1[1] - q0[1]))),
                    math.degrees(math.atan2(q1[1] - q0[1], q1[0] - q0[0]))))
    mb.cyl("wood", (-3.35, 0.0, 0.75), 0.32, 0.08, n=10, rot=(90, 0, 0))


def mill_sails(mb, ang):
    """Four sails at angle ang (degrees, turning counter-clockwise seen from +x): stock, cloth on a lattice."""
    hx, hy, hz = ML_HUB
    L = ML_SAIL
    for k in range(4):
        a = math.radians(ang + 90 * k)
        ca, sa = math.cos(a), math.sin(a)

        def P(r, w, dx=0.0):
            return (hx + dx, hy + r * ca - w * sa, hz + r * sa + w * ca)
        rot = (math.degrees(a), 0, 0)
        mb.box("timber", P(L / 2, 0.0, 0.1), (0.12, L, 0.15), rot=rot)
        mb.box("cloth", P((0.85 + L - 0.1) / 2, 0.47, 0.06), (0.03, L - 0.95, 0.74), rot=rot)
        r_ = 1.0
        while r_ < L - 0.05:
            mb.box("wood", P(r_, 0.4, 0.09), (0.035, 0.045, 0.92), rot=rot)
            r_ += 0.45
        mb.box("wood", P((0.85 + L) / 2, 0.88, 0.09), (0.04, L - 0.85, 0.05), rot=rot)
        mb.box("wood", P((0.85 + L) / 2, -0.12, 0.09), (0.035, L - 0.85, 0.04), rot=rot)


def mill_extras(mb):
    """A spare millstone leaning against the tower and a bench."""
    with mb.at((-2.05, 1.55, 0), 35):
        mb.cyl("rock_cut", (0, 0, 0.5), 0.5, 0.18, n=12, rot=(0, 72, 0))
        mb.cyl("iron", (0.06, 0, 0.5), 0.09, 0.2, n=6, rot=(0, 72, 0))
    with mb.at((1.95, -1.75, 0), -40):
        mb.bx("wood_hi", -0.55, 0.55, -0.15, 0.15, 0.42, 0.48)
        for sx in (-0.45, 0.45):
            mb.bx("wood", sx - 0.05, sx + 0.05, -0.12, 0.12, 0, 0.42)


def b_muehle(mb, var):
    """Tower windmill 3 x 3 with the door at model -y (access tile in front). Variant = sail position, 15 degrees per
    step (6 steps = a quarter turn, the sails look the same after 90 degrees); the game cycles them while the miller works."""
    mill_ground(mb)
    mill_tower(mb)
    mill_door(mb)
    mill_windows(mb)
    mill_cap(mb)
    mill_extras(mb)
    mill_sails(mb, 45 + 15 * var)


def b_muehle_innen(mb, var):
    """Windmill cutaway (ground floor): millstones in their wooden tun on a platform, hopper with grain above, the
    upright shaft with the spur wheel, meal bin, sacks, ladder. Cap and sails are gone, as is every roof in a cutaway."""
    mill_ground(mb)
    scratch = MB(mb.seed)
    scratch.rnd = mb.rnd
    mill_tower(scratch)          # same random draws as the exterior, so the extras below match
    mb.rnd = random.Random(1000 * mb.seed + 77)
    d = mb.view
    mb.cyl("wood", (0, 0, 0.02), ML_R0 - 0.3, 0.04, n=ML_N)
    zf = 0.04
    chord = 2 * ML_R0 * math.sin(math.pi / ML_N) + 0.04
    door_i = round(270 / (360 / ML_N)) % ML_N
    for i in range(ML_N):
        a = 2 * math.pi * i / ML_N
        ca, sa = math.cos(a), math.sin(a)
        g = "f:%.4f:%.4f" % (ca, sa)
        low = is_front(g, d)
        rr = ML_R0 * math.cos(math.pi / ML_N) - 0.2
        h = 0.75 if low else 2.6
        mb.box("stone_top", ((rr + 0.12) * ca, (rr + 0.12) * sa, 0.16), (0.5, chord + 0.08, 0.32), rot=(0, 0, math.degrees(a)),
               group=g if low else None)
        if i == door_i:
            for k in (-1, 1):
                px = k * (ML_DOOR[1] + 0.15)
                mb.bx("stone_top", px - 0.13, px + 0.13, -rr - 0.25, -rr + 0.2, 0, h if low else ML_DOOR[2] + 0.28,
                      group=g if low else None)
            if not low:
                mb.bx("stone_top", ML_DOOR[0] - 0.28, ML_DOOR[1] + 0.28, -rr - 0.25, -rr + 0.2, ML_DOOR[2], ML_DOOR[2] + 0.28)
                mb.bx("stone", ML_DOOR[0] - 0.28, ML_DOOR[1] + 0.28, -rr - 0.2, -rr + 0.2, ML_DOOR[2] + 0.28, h)
            continue
        mb.box("stone", (rr * ca, rr * sa, h / 2), (0.42, chord, h), rot=(0, 0, math.degrees(a)), group=g if low else None)
        z = 0.42
        while z < h - 0.1:
            mb.box("mortar", (rr * ca, rr * sa, z), (0.44, chord + 0.01, 0.04), rot=(0, 0, math.degrees(a)), group=g if low else None)
            z += 0.42
        mb.box("stone_top", (rr * ca, rr * sa, h + 0.04), (0.46, chord + 0.02, 0.08), rot=(0, 0, math.degrees(a)), group=g if low else None)
    mill_door_step = ML_R0 * math.cos(math.pi / ML_N)
    mb.bx("stone_top", ML_DOOR[0] - 0.35, ML_DOOR[1] + 0.35, -mill_door_step - 0.6, -mill_door_step - 0.15, 0, 0.12)
    # millstones on the platform (the miller stands south-east of them, see production.spot in src/data)
    mx, my = -0.55, 0.85
    mb.bx("wood", mx - 0.75, mx + 0.75, my - 0.75, my + 0.75, zf, zf + 0.5)
    for (lx, ly) in ((-0.68, -0.68), (0.68, -0.68), (-0.68, 0.68), (0.68, 0.68)):
        mb.bx("timber", mx + lx - 0.07, mx + lx + 0.07, my + ly - 0.07, my + ly + 0.07, zf, zf + 0.55)
    mb.cyl("wood_hi", (mx, my, zf + 0.68), 0.62, 0.36, n=12)
    mb.cyl("rock_cut", (mx, my, zf + 0.88), 0.52, 0.12, n=12)
    mb.cyl("iron", (mx, my, zf + 0.95), 0.09, 0.04, n=8)
    # hopper on a frame, full of grain; upright shaft with the spur wheel near the ceiling
    for sx in (-0.5, 0.5):
        mb.bx("timber", mx + sx - 0.05, mx + sx + 0.05, my + 0.45, my + 0.55, zf + 0.5, zf + 1.75)
    mb.bx("timber", mx - 0.55, mx + 0.55, my + 0.45, my + 0.55, zf + 1.6, zf + 1.7)
    mb.cyl("wood", (mx, my + 0.15, zf + 1.4), 0.12, 0.5, n=4, r2=0.42, rot=(0, 0, 45))
    mb.cyl("thatch", (mx, my + 0.15, zf + 1.66), 0.38, 0.04, n=4, rot=(0, 0, 45))
    mb.box("wood", (mx, my + 0.15, zf + 1.08), (0.08, 0.08, 0.2))
    mb.cyl("timber", (mx, my, zf + 1.85), 0.09, 1.6, n=8)
    mb.cyl("wood", (mx, my, 2.35), 0.62, 0.12, n=12)
    for k in range(12):
        a = 2 * math.pi * k / 12
        mb.box("wood_hi", (mx + 0.66 * math.cos(a), my + 0.66 * math.sin(a), 2.35), (0.12, 0.08, 0.14), rot=(0, 0, math.degrees(a)))
    # meal spout into the bin in front of the platform, flour on top
    mb.box("wood", (mx + 0.1, my - 0.85, zf + 0.42), (0.1, 0.35, 0.08), rot=(30, 0, 0))
    mb.bx("wood", mx - 0.35, mx + 0.45, my - 1.3, my - 0.95, zf, zf + 0.5)
    mb.bx("flour", mx - 0.3, mx + 0.4, my - 1.26, my - 0.99, zf + 0.5, zf + 0.53)
    # sacks along the wall: grain (burlap) on the east side, flour (linen) on the west
    for (sx, sy, m, fill) in ((1.5, -0.55, "sack", "thatch"), (1.72, -0.05, "sack", None), (1.15, -0.98, "sack", None),
                              (-1.75, -0.45, "cloth", None), (-1.55, -0.95, "cloth", "flour")):
        sack(mb, sx, sy, zf, m, s=0.9, fill=fill)
    # ladder to the floor above against the back wall (where it stands at full height)
    if not is_front("f:0.5000:0.8660", d):
        with mb.at((0.95, 1.6, zf), -30):
            for sx in (-0.22, 0.22):
                mb.box("wood_hi", (sx, 0.12, 1.15), (0.06, 0.06, 2.35), rot=(-8, 0, 0))
            for k in range(1, 7):
                zz = k * 0.33
                mb.bx("wood", -0.22, 0.22, 0.12 + (zz - 1.15) * math.tan(math.radians(8)) - 0.025,
                      0.12 + (zz - 1.15) * math.tan(math.radians(8)) + 0.025, zz - 0.025, zz + 0.025)


# bakery 3 x 2: house along x, the oven at the east end with its chimney, door at model (-1.27, -1.35)
BK_X0, BK_X1, BK_Y0, BK_Y1, BK_BASE, BK_EAVE = -3.35, 3.35, -1.35, 2.3, 0.35, 2.55
BK_DOOR = (-1.72, -0.82, 2.0)
BK_CHIMNEY = (2.45, 3.05, 0.75, 1.35, 5.15)


def bk_outside(mb):
    """Things outside the bakery: woodpile for the oven at the west gable, a step stone, a barrel at the back."""
    log_pile(mb, BK_X0 - 0.3, 0.75, 0, 3, length=1.1, r=0.1, axis="y")
    mb.bx("stone_top", BK_DOOR[0] - 0.15, BK_DOOR[1] + 0.15, BK_Y0 - 0.42, BK_Y0 - 0.05, 0, 0.12)
    barrel(mb, BK_X0 - 0.15, 2.2, 0, r=0.25, h=0.62)


def b_baeckerei(mb, var):
    """Bakery 3 x 2: stone plinth, timber frame, tiled roof (ridge along x), the oven chimney through the roof at the east
    end, door with a loaf sign, shuttered windows. The game shows smoke over the chimney while the baker bakes."""
    S0, S1 = 3 * T / 2, T
    ground(mb, "dirt", -S0 + 0.05, S0 - 0.05, -S1 + 0.05, S1 - 0.05, ragged=0.08)
    x0, x1, y0, y1 = BK_X0, BK_X1, BK_Y0, BK_Y1
    masonry(mb, x0 - 0.05, x1 + 0.05, y0 - 0.05, y1 + 0.05, 0, BK_BASE, row=0.175, top=True)
    timber_frame(mb, x0, x1, y0, y1, BK_BASE, BK_EAVE, spacing=1.1)
    cy = (y0 + y1) / 2
    with mb.at((0, cy, 0)):
        gable_roof(mb, x1 - x0, (y1 - y0) / 2 + 0.42, BK_EAVE, 1.95, "roof_tile", ov=0.3, row=0.32, thick=0.08, gable="plaster",
                   ridge="roof_tile")
    cx0, cx1, cy0, cy1, ctop = BK_CHIMNEY
    masonry(mb, cx0, cx1, cy0, cy1, 0.0, ctop, row=0.27)
    mb.bx("mortar", cx0 + 0.07, cx1 - 0.07, cy0 + 0.07, cy1 - 0.07, ctop - 0.02, ctop + 0.02)
    mb.bx("stone_top", cx0 - 0.06, cx1 + 0.06, cy0 - 0.06, cy1 + 0.06, ctop - 0.2, ctop - 0.08)
    a, b, top = BK_DOOR
    door(mb, "s", ((a + b) / 2, y0, 0.0), w=b - a, h=top)
    for wx in (0.55, 2.15):
        window(mb, "s", (wx, y0, 1.25), w=0.6, h=0.55)
    window(mb, "e", (x1, -0.3, 1.3), w=0.5, h=0.5)
    # loaf sign on an iron bracket beside the door
    mb.bx("iron", -0.62, -0.58, y0 - 0.75, y0, 2.18, 2.22)
    mb.bx("wood_hi", -0.75, -0.45, y0 - 0.72, y0 - 0.68, 1.62, 2.12)
    with mb.at((-0.6, y0 - 0.76, 1.84), 0):
        mb.blob("bread", (0, 0, 0), (0.2, 0.06, 0.14), seg=8, rings=4, jitter=0.02)
    # bread board under the second window (the game's output pile stands in front of the first)
    mb.bx("wood_hi", 1.75, 2.55, y0 - 0.38, y0 - 0.02, 0.8, 0.86)
    for sx in (1.85, 2.45):
        mb.bx("wood", sx - 0.04, sx + 0.04, y0 - 0.3, y0 - 0.1, 0, 0.8)
    for k in range(3):
        loaf(mb, 1.9 + k * 0.25, y0 - 0.2, 0.86, s=0.9)
    bk_outside(mb)


def b_baeckerei_innen(mb, var):
    """Bakery cutaway: stone floor, the domed oven at the east end with the fire in its mouth (the baker faces it, see
    production.spot/face in src/data), kneading trough, table with loaves, flour sacks, bread shelf on the back wall."""
    S0, S1 = 3 * T / 2, T
    ground(mb, "dirt", -S0 + 0.05, S0 - 0.05, -S1 + 0.05, S1 - 0.05, ragged=0.08)
    mb.rnd = random.Random(1000 * mb.seed + 77)
    x0, x1, y0, y1 = BK_X0, BK_X1, BK_Y0, BK_Y1
    th = 0.15
    d = mb.view
    cut_house(mb, x0, x1, y0, y1, BK_BASE, BK_EAVE, th=th, gaps={"s": BK_DOOR}, posts=1.1)
    # stone flags
    k = 0
    xx = x0 + th
    while xx < x1 - th - 0.02:
        yy = y0 + th
        while yy < y1 - th - 0.02:
            mb.bx("stone_top" if (k % 3) else "stone", xx + 0.02, min(x1 - th, xx + 0.62) - 0.02, yy + 0.02, min(y1 - th, yy + 0.6) - 0.02, 0, 0.04)
            yy += 0.6
            k += 1
        xx += 0.62
        k += 1
    # oven: masonry base with the mouth facing -x, domed top, chimney up to the wall plate
    ox0, ox1, oy0, oy1 = 2.0, x1 - th, -0.95, 1.6
    masonry(mb, ox0, ox1, oy0, oy1, 0.04, 0.95, row=0.23)
    mb.blob("stone", ((ox0 + ox1) / 2 + 0.05, (oy0 + oy1) / 2, 0.95), ((ox1 - ox0) / 2, (oy1 - oy0) / 2, 0.5), seg=10, rings=5, jitter=0.03)
    mb.bx("window", ox0 - 0.03, ox0 + 0.02, 0.0, 0.55, 0.5, 0.88)
    mb.bx("stone_top", ox0 - 0.08, ox0 + 0.02, -0.1, 0.65, 0.88, 0.98)
    mb.bx("stone_top", ox0 - 0.25, ox0 + 0.02, -0.15, 0.7, 0.44, 0.5)
    for (fy, fh) in ((0.12, 0.16), (0.27, 0.24), (0.42, 0.14)):
        mb.box("gold", (ox0 - 0.04, fy, 0.5 + fh / 2), (0.03, 0.08, fh))
    mb.bx("target", ox0 - 0.045, ox0 - 0.035, 0.05, 0.5, 0.5, 0.54)
    cx0, cx1, cy0, cy1, _ = BK_CHIMNEY
    masonry(mb, cx0, cx1, cy0, cy1, 1.2, BK_EAVE, row=0.27, top=True)
    # peel and wood for the fire
    mb.box("wood_hi", (ox0 - 0.15, -1.08, 1.05), (0.05, 0.05, 2.0), rot=(0, -8, 0))
    mb.box("wood_hi", (ox0 - 0.29, -1.08, 0.12), (0.3, 0.22, 0.03), rot=(0, -8, 0))
    log_pile(mb, 2.55, -1.12 + 0.02, 0.04, 2, length=0.7, r=0.08, axis="x")
    # kneading trough against the back wall, dough inside
    tx0, tx1 = -1.0, 0.7
    for lx in (tx0 + 0.1, tx1 - 0.1):
        mb.bx("wood", lx - 0.05, lx + 0.05, 1.5, 1.95, 0, 0.62)
    mb.bx("wood", tx0, tx1, 1.42, 2.02, 0.62, 0.95)
    mb.bx("flour", tx0 + 0.07, tx1 - 0.07, 1.49, 1.95, 0.95, 0.97)
    mb.blob("cloth", (-0.3, 1.72, 0.97), (0.3, 0.18, 0.06), seg=8, rings=4, jitter=0.05)
    # table with loaves in front of the window, south of the baker's path
    mb.bx("wood_hi", -0.2, 0.95, -0.95, -0.42, 0.78, 0.84)
    for (lx, ly) in ((-0.13, -0.88), (0.88, -0.88), (-0.13, -0.49), (0.88, -0.49)):
        mb.bx("wood", lx - 0.04, lx + 0.04, ly - 0.04, ly + 0.04, 0.04, 0.78)
    for (bx_, by_, lg) in ((0.05, -0.7, False), (0.32, -0.62, False), (0.62, -0.75, True), (0.75, -0.55, False)):
        loaf(mb, bx_, by_, 0.84, s=1.0, long=lg, rz=20)
    # flour sacks and a flour bin at the west end
    for (sx, sy, fill) in ((-2.75, 1.65, None), (-2.3, 1.75, "flour"), (-2.85, 1.1, None)):
        sack(mb, sx, sy, 0.04, "cloth", s=0.9, fill=fill)
    mb.bx("wood", -2.95, -2.35, -0.9, -0.4, 0.04, 0.62)
    mb.bx("flour", -2.9, -2.4, -0.85, -0.45, 0.62, 0.64)
    # bread shelf on the back wall (only where it stands at full height)
    if not low_side("n", d):
        yb = y1 - th
        for sx in (-2.0, -0.6):
            mb.bx("timber", sx - 0.04, sx + 0.04, yb - 0.38, yb, 1.55, 1.62)
        mb.bx("wood_hi", -2.2, -0.4, yb - 0.4, yb, 1.62, 1.67)
        for q in range(5):
            loaf(mb, -2.05 + q * 0.37, yb - 0.2, 1.67, s=0.95, long=q % 2 == 1)
    bk_outside(mb)


# ---------------------------------------------------------------- construction sites
# Outlines of the main bodies (metres, model axes), taken from the b_* functions above. A site shows: stake-out
# (variant 0), foundation (variant 1); the game then draws the scaffold, reveals the finished sprite from the bottom up
# and puts the delivered material (baustoff_*) on the lot.
_KAS_W, _KAS_D = 4 * T - 0.8, 4.0
_KAS_CY = 3 * T / 2 - _KAS_D / 2 - 0.35
_TURM_W = T - 0.03
SITE_RECTS = {
    "haus": [(-2.05, 2.05, -1.7, 1.7)],
    "holzfaeller": [(-1.15 - 1.43, -1.15 + 1.43, 1.2 - 1.18, 1.2 + 1.18)],
    "kaserne": [(-_KAS_W / 2, _KAS_W / 2, _KAS_CY - _KAS_D / 2, _KAS_CY + _KAS_D / 2)],
    "turm": [(-_TURM_W, _TURM_W, -_TURM_W, _TURM_W)],
    "mauer": [(-1.1, 1.1, -1.1, 1.1)],
    "treppe": [(-0.9, 0.9, -T + 0.05, T + 0.12)],
    "steinbruch": [(-3.3, -1.7, -3.3, -1.8), (1.4, 2.4, -1.4, -0.4)],
    "lager": [(-3 * T / 2 + 0.15, 3 * T / 2 - 0.15, -3 * T / 2 + 0.15, 3 * T / 2 - 0.15)],
    "lagerhaus": [(-LH_X, LH_X, LH_Y0, LH_Y1)],
    "bergfried": [(-BF_HW[1] - 0.1, BF_HW[1] + 0.1, -BF_HW[1] - 0.1, BF_HW[1] + 0.1)],
    "kornkammer": [(-KK_X, KK_X, KK_Y0, KK_Y1)],
    "muehle": [(-ML_R0, ML_R0, -ML_R0, ML_R0)],
    "baeckerei": [(BK_X0, BK_X1, BK_Y0, BK_Y1)],
}
SITE_KIND = {"steinbruch": "yard", "lager": "yard", "muehle": "round"}
# scaffold: outline, number of levels, level height (m)
SCAFFOLDS = {
    "haus": (SITE_RECTS["haus"][0], 2, 1.45),
    "holzfaeller": (SITE_RECTS["holzfaeller"][0], 1, 1.4),
    "kaserne": (SITE_RECTS["kaserne"][0], 3, 1.45),
    "turm": (SITE_RECTS["turm"][0], 4, 1.3),
    "lagerhaus": (SITE_RECTS["lagerhaus"][0], 2, 1.45),
    "kornkammer": (SITE_RECTS["kornkammer"][0], 2, 1.4),
    "muehle": (SITE_RECTS["muehle"][0], 3, 1.85),
    "baeckerei": (SITE_RECTS["baeckerei"][0], 2, 1.3),
}
SIDE_GROUP = {"s": "f:0:-1", "n": "f:0:1", "e": "f:1:0", "w": "f:-1:0"}


def corner_group(x, y):
    """Group of a corner post: facing the camera only in the view where this corner is the nearest one."""
    return "f:%d:%d" % (1 if x > 0 else -1, 1 if y > 0 else -1)


def peg(mb, x, y, h=0.55, group=None):
    mb.bx("wood", x - 0.045, x + 0.045, y - 0.045, y + 0.045, 0, h, group=group)
    mb.bx("wood_hi", x - 0.05, x + 0.05, y - 0.05, y + 0.05, h - 0.04, h, group=group)


def string_line(mb, a, b, z=0.34):
    (ax, ay), (bx_, by) = a, b
    if abs(ay - by) < 1e-6:
        mb.bx("string", min(ax, bx_), max(ax, bx_), ay - 0.03, ay + 0.03, z, z + 0.05)
    else:
        mb.bx("string", ax - 0.03, ax + 0.03, min(ay, by), max(ay, by), z, z + 0.05)


def b_site(key):
    def build(mb, var):
        rects = SITE_RECTS[key]
        kind = SITE_KIND.get(key, "masonry")
        r = mb.rnd
        for (x0, x1, y0, y1) in rects:
            m = 0.3  # pegs and string stand a little outside the future walls
            corners = [(x0 - m, y0 - m), (x1 + m, y0 - m), (x1 + m, y1 + m), (x0 - m, y1 + m)]
            if var == 0:
                # stake-out: trampled earth along the line, pegs at the corners and every ~1.4 m, string between
                for i in range(4):
                    a, b = corners[i], corners[(i + 1) % 4]
                    L = math.hypot(b[0] - a[0], b[1] - a[1])
                    n = max(1, round(L / 1.4))
                    for k in range(n):
                        t = k / n
                        x, y = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
                        peg(mb, x, y, 0.55 if k == 0 else 0.42)
                        if r.random() < 0.7:
                            mb.cyl("dirt", (x + r.uniform(-0.2, 0.2), y + r.uniform(-0.2, 0.2), 0.012), r.uniform(0.18, 0.32), 0.024, n=7)
                    string_line(mb, a, b)
            else:
                pad = 0.35
                ground(mb, "dirt", x0 - pad, x1 + pad, y0 - pad, y1 + pad, ragged=0.2)
                if kind == "masonry":
                    t, h = 0.42, 0.42
                    masonry(mb, x0, x1, y0, y0 + t, 0, h, row=0.21, sides="nesw")
                    masonry(mb, x0, x1, y1 - t, y1, 0, h, row=0.21, sides="nesw")
                    masonry(mb, x0, x0 + t, y0 + t, y1 - t, 0, h, row=0.21, sides="nesw")
                    masonry(mb, x1 - t, x1, y0 + t, y1 - t, 0, h, row=0.21, sides="nesw")
                elif kind == "round":
                    # round tower (windmill): a ring of footing stones
                    R, n = (x1 - x0) / 2, 20
                    for i in range(n):
                        a = 2 * math.pi * i / n
                        rr = R * math.cos(math.pi / n) - 0.21
                        c = ((x0 + x1) / 2 + rr * math.cos(a), (y0 + y1) / 2 + rr * math.sin(a))
                        mb.box("stone" if i % 2 else "stone2", (c[0], c[1], 0.21), (0.42, 2 * R * math.sin(math.pi / n) + 0.03, 0.42),
                               rot=(0, 0, math.degrees(a)))
                        mb.box("mortar", (c[0], c[1], 0.43), (0.38, 2 * R * math.sin(math.pi / n) - 0.02, 0.03), rot=(0, 0, math.degrees(a)))
                else:
                    # yard: levelled ground, posts set along the edge
                    for i in range(4):
                        a, b = corners[i], corners[(i + 1) % 4]
                        L = math.hypot(b[0] - a[0], b[1] - a[1])
                        n = max(1, round(L / 1.1))
                        for k in range(n):
                            x, y = a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n
                            mb.bx("wood", x - 0.06, x + 0.06, y - 0.06, y + 0.06, 0, 0.75)
                for (x, y) in corners:
                    peg(mb, x, y, 0.55)
        if var == 1 and key not in ("mauer", "treppe"):
            # a few loose blocks and a mortar trough at the first outline (not on narrow wall sites: they stay on the tile)
            x0, x1, y0, y1 = rects[0]
            for k in range(3):
                mb.box("stone", (x0 + 0.5 + k * 0.5, y0 - 0.62, 0.13), (0.4, 0.32, 0.26), rot=(0, 0, r.uniform(-12, 12)))
            mb.bx("wood", x1 - 1.1, x1 - 0.3, y0 - 0.85, y0 - 0.45, 0, 0.22)
            mb.bx("mortar", x1 - 1.05, x1 - 0.35, y0 - 0.8, y0 - 0.5, 0.18, 0.23)
    return build


def scaffold(mb, rect, levels, lift):
    """Pole scaffold around an outline: standards, ledgers, putlogs and plank decks on every level, one diagonal brace
    per side, a ladder on the south side. Each side is its own front-mask group, so the game can draw the sides facing
    the camera over the rising building and the others behind it."""
    x0, x1, y0, y1 = rect
    off = 0.38
    X0, X1, Y0, Y1 = x0 - off, x1 + off, y0 - off, y1 + off
    top = levels * lift + 1.0
    sides = {"s": ((X0, Y0), (X1, Y0)), "e": ((X1, Y0), (X1, Y1)), "n": ((X1, Y1), (X0, Y1)), "w": ((X0, Y1), (X0, Y0))}
    for (x, y) in ((X0, Y0), (X1, Y0), (X1, Y1), (X0, Y1)):
        g = corner_group(x, y)
        mb.cyl("timber", (x, y, top / 2), 0.065, top, n=6, group=g)
    for side, ((ax, ay), (bx_, by)) in sides.items():
        g = SIDE_GROUP[side]
        L = math.hypot(bx_ - ax, by - ay)
        along_x = abs(ay - by) < 1e-6
        n = max(1, round(L / 1.9))
        for k in range(1, n):
            t = k / n
            mb.cyl("timber", (ax + (bx_ - ax) * t, ay + (by - ay) * t, top / 2), 0.06, top, n=6, group=g)
        cx, cy = (ax + bx_) / 2, (ay + by) / 2
        # wall face on this side (deck runs from the poles to the wall)
        if along_x:
            wy = y0 if side == "s" else y1
            dy0, dy1 = min(wy, ay), max(wy, ay)
        else:
            wx = x1 if side == "e" else x0
            dx0, dx1 = min(wx, ax), max(wx, ax)
        for lv in range(1, levels + 1):
            z = lv * lift
            if along_x:
                mb.bx("wood", min(ax, bx_) - 0.08, max(ax, bx_) + 0.08, ay - 0.05, ay + 0.05, z - 0.1, z - 0.02, group=g)
                mb.bx("wood_hi", min(ax, bx_), max(ax, bx_), dy0, dy1, z, z + 0.05, group=g)
                for q in range(n + 1):
                    xx = ax + (bx_ - ax) * q / n
                    mb.bx("wood", xx - 0.04, xx + 0.04, dy0, dy1, z - 0.08, z - 0.02, group=g)
            else:
                mb.bx("wood", ax - 0.05, ax + 0.05, min(ay, by) - 0.08, max(ay, by) + 0.08, z - 0.1, z - 0.02, group=g)
                mb.bx("wood_hi", dx0, dx1, min(ay, by), max(ay, by), z, z + 0.05, group=g)
                for q in range(n + 1):
                    yy = ay + (by - ay) * q / n
                    mb.bx("wood", dx0, dx1, yy - 0.04, yy + 0.04, z - 0.08, z - 0.02, group=g)
        # hand rail on the top level and a lower guard rail
        zr = levels * lift + 0.9
        if along_x:
            mb.bx("wood", min(ax, bx_), max(ax, bx_), ay - 0.04, ay + 0.04, zr, zr + 0.07, group=g)
        else:
            mb.bx("wood", ax - 0.04, ax + 0.04, min(ay, by), max(ay, by), zr, zr + 0.07, group=g)
        # diagonal brace across the side
        H = levels * lift
        ang = math.degrees(math.atan2(H, L))
        if along_x:
            mb.box("wood", (cx, ay + (0.07 if side == "n" else -0.07), H / 2), (math.hypot(L, H), 0.06, 0.06), rot=(0, -ang if side == "s" else ang, 0), group=g)
        else:
            mb.box("wood", (ax + (0.07 if side == "e" else -0.07), cy, H / 2), (0.06, math.hypot(L, H), 0.06), rot=(ang if side == "e" else -ang, 0, 0), group=g)
    # ladder to the first level, leaning against the south side
    lx = X1 - 0.9
    with mb.at((lx, Y0 - 0.35, 0)):
        for sx in (-0.22, 0.22):
            mb.box("wood_hi", (sx, 0.17, lift / 2 + 0.25), (0.06, 0.06, lift + 0.6), rot=(-13, 0, 0), group="f:0:-1")
        for k in range(1, int(lift / 0.32) + 1):
            z = k * 0.32
            mb.bx("wood", -0.22, 0.22, 0.17 + (z - lift / 2 - 0.25) * math.tan(math.radians(13)) - 0.025,
                  0.17 + (z - lift / 2 - 0.25) * math.tan(math.radians(13)) + 0.025, z - 0.025, z + 0.025, group="f:0:-1")


def b_geruest(key):
    def build(mb, var):
        rect, levels, lift = SCAFFOLDS[key]
        scaffold(mb, rect, levels, lift)
    return build


def b_baustoff_holz(mb, var):
    """Sawn timber on two sleepers: boards and squared beams in crossed layers (1-4)."""
    for y in (-0.42, 0.42):
        mb.bx("wood", -0.75, 0.75, y - 0.07, y + 0.07, 0, 0.1)
    z = 0.1
    for k in range(var):
        if k % 2 == 0:  # boards along x
            for i in range(5):
                yy = -0.5 + i * 0.25
                mb.bx("wood_hi" if (i + k) % 3 else "wood", -0.82, 0.82 - 0.06 * ((i + k) % 2), yy - 0.11, yy + 0.11, z, z + 0.06)
            z += 0.06
        else:  # squared beams across
            for i in range(4):
                xx = -0.6 + i * 0.4
                mb.bx("wood", xx - 0.09, xx + 0.09, -0.62, 0.62, z, z + 0.16)
            z += 0.16


def b_baustoff_stein(mb, var):
    """Cut ashlar blocks on a pallet (1-4 = 3, 6, 9, 12 blocks)."""
    pallet(mb, 0, 0, 0, 1.3, 0.9)
    spots = [(-0.42, -0.2, 0), (0.0, -0.2, 0), (0.42, -0.2, 0), (-0.42, 0.22, 0), (0.0, 0.22, 0), (0.42, 0.22, 0),
             (-0.21, -0.2, 1), (0.21, -0.2, 1), (-0.21, 0.22, 1), (0.21, 0.22, 1), (0.0, 0.0, 2), (0.0, 0.0, 3)]
    r = mb.rnd
    for i in range(12):
        x, y, lv = spots[i]
        rz = r.uniform(-6, 6)
        if i >= var * 3:
            continue
        mb.box("stone2" if i % 4 == 1 else "stone", (x, y, 0.12 + 0.15 + lv * 0.3), (0.38, 0.36, 0.28), rot=(0, 0, rz))


BUILD = {"haus": b_haus, "holzfaeller": b_holzfaeller, "steinbruch": b_steinbruch, "lager": b_lager, "kaserne": b_kaserne,
         "turm": b_turm, "mauer": b_mauer, "treppe": b_treppe, "baum": b_baum, "tanne": b_tanne,
         "baum_liegt": b_baum_liegt, "baum_stumpf": b_baum_stumpf, "fels": b_fels,
         "stapel_holz": b_stapel_holz, "stapel_stein": b_stapel_stein, "stapel_eisen": b_stapel_eisen,
         "stapel_speer": b_stapel_speer, "stapel_schwert": b_stapel_schwert, "stapel_bogen": b_stapel_bogen,
         "lager_boden": b_lager_boden, "tor": b_tor,
         "lagerhaus": b_lagerhaus, "lagerhaus_innen": b_lagerhaus_innen, "haus_innen": b_haus_innen,
         "holzfaeller_innen": b_holzfaeller_innen, "kaserne_innen": b_kaserne_innen,
         "bergfried_holz": b_bergfried_holz, "bergfried_stein": b_bergfried_stein, "bergfried_burg": b_bergfried_burg,
         "bergfried_holz_innen": b_bergfried_innen(1), "bergfried_stein_innen": b_bergfried_innen(2),
         "bergfried_burg_innen": b_bergfried_innen(3),
         "kornkammer": b_kornkammer, "kornkammer_innen": b_kornkammer_innen, "muehle": b_muehle, "muehle_innen": b_muehle_innen,
         "baeckerei": b_baeckerei, "baeckerei_innen": b_baeckerei_innen,
         "stapel_getreide": b_stapel_getreide, "stapel_mehl": b_stapel_mehl, "stapel_brot": b_stapel_brot}
BUILD.update({k: b_wallpiece(k) for k in WALL_CONN})
BUILD.update({"baustelle_" + k: b_site(k) for k in SITE_RECTS})
BUILD.update({"geruest_" + k: b_geruest(k) for k in SCAFFOLDS})
BUILD.update({"baustoff_holz": b_baustoff_holz, "baustoff_stein": b_baustoff_stein})
# Militärwirtschaft (ADR 0014): eigene Datei im selben Namensraum, hängt sich an BUILD, SITE_RECTS und SCAFFOLDS an
exec(compile(open(os.path.join(HERE, "buildings_ruestung.py"), encoding="utf-8").read(), "buildings_ruestung.py", "exec"))


# ---------------------------------------------------------------- scene and render
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sh = sc.display.shading
    sh.light = "FLAT"
    sh.color_type = "OBJECT"
    sh.show_cavity = False
    sh.show_object_outline = False
    sh.show_specular_highlight = False
    sh.show_shadows = False
    sc.display.render_aa = "OFF"
    sc.render.film_transparent = True
    sc.render.dither_intensity = 0.0
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sc.render.image_settings.file_format = "PNG"
    sc.render.resolution_x = CELL_W * SS
    sc.render.resolution_y = CELL_H * SS
    sc.render.resolution_percentage = 100
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = CELL_W / PPM
    cam = bpy.data.objects.new("cam", cam_data)
    sc.collection.objects.link(cam)
    sc.camera = cam
    cos30 = math.cos(math.radians(30))
    # the footprint centre (world origin) lands on ANCHOR: shift the view centre right/up accordingly
    right = Vector((0.7071, 0.7071, 0.0))
    up = Vector((-0.3536, 0.3536, cos30))
    fwd = Vector((-0.6124, 0.6124, -0.5))
    dx = (CELL_W / 2 - ANCHOR[0]) / PPM
    dy = (ANCHOR[1] - CELL_H / 2) / PPM
    centre = right * dx + up * dy
    cam.location = centre - fwd * 40
    cam.rotation_euler = (math.radians(60), 0, math.radians(45))
    cam_data.clip_end = 100
    return sc


def realize(mb, root):
    objs = []
    for (mat, group), (v, f) in mb.parts.items():
        me = bpy.data.meshes.new("%s_%s" % (mat, group))
        me.from_pydata(v, [], f)
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
        me.update()
        attr = me.color_attributes.new("h", "FLOAT_COLOR", "POINT")
        vals = []
        for vert in me.vertices:
            z = max(vert.co.z, 0.0) / 16.0
            vals += [z, z, z, 1.0]
        attr.data.foreach_set("color", vals)
        me.color_attributes.active_color = attr
        o = bpy.data.objects.new(me.name, me)
        bpy.context.scene.collection.objects.link(o)
        o.parent = root
        o.color = col(PAL[mat])
        o["mat"] = mat
        o["group"] = group or ""
        o.hide_render = group == "ghost"  # neighbour stand-ins: only in the neighbour mask pass
        objs.append(o)
    return objs


def is_front(group, d):
    """group 'f:x:y' = parapet facing local (x, y). Front if, turned by d x 90 deg, it faces the camera."""
    if not group.startswith("f:"):
        return False
    _, x, y = group.split(":")
    x, y = float(x), float(y)
    a = math.radians(90 * d)
    wx, wy = x * math.cos(a) - y * math.sin(a), x * math.sin(a) + y * math.cos(a)
    return (wx * -0.7071 + wy * 0.7071) < -0.1


def render(sc, path):
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def main():
    sc = reset()
    keys = [k for k in DEFS if not ONLY or k in ONLY.split(",")]
    meta = {"cell": [CELL_W, CELL_H], "ss": SS, "ppm": PPM, "frames": max(len(DEFS[k]["variants"]) for k in DEFS), "dirs": DIRS,
            "anchor": list(ANCHOR), "tile": [64, 32], "step_px": 16, "units": []}
    for key in keys:
        df = DEFS[key]
        # cutaway sprites are built per view (the walls towards the camera stay low), all others once for all views
        passes = [(dv, [dv]) for dv in range(4)] if df.get("cutaway") else [(0, range(4))]
        for f, dv, views in ((f, dv, views) for f, _ in enumerate(df["variants"]) for dv, views in passes):
            for o in list(bpy.data.objects):
                if o.type != "CAMERA":
                    bpy.data.objects.remove(o, do_unlink=True)
            root = bpy.data.objects.new("root", None)
            sc.collection.objects.link(root)
            mb = MB(df.get("seed", 1) * 100 + f * 0 + 7)
            mb.view = dv
            BUILD[key](mb, f)
            objs = realize(mb, root)
            cols = {o.name: tuple(o.color) for o in objs}
            for d in views:
                root.rotation_euler = (0, 0, math.radians(90 * d))
                base = os.path.join(OUT, key, "d%d_f%d" % (d, f))
                os.makedirs(os.path.dirname(base), exist_ok=True)
                sh = sc.display.shading
                # 1 flat colours
                sh.light, sh.color_type = "FLAT", "OBJECT"
                sc.render.image_settings.color_mode, sc.render.image_settings.color_depth = "RGBA", "8"
                render(sc, base + ".png")
                # 2 light only
                for o in objs:
                    o.color = (0.8, 0.8, 0.8, 1)
                sh.light = "STUDIO"
                sh.show_cavity = True
                sh.cavity_type = "WORLD"
                sh.cavity_valley_factor = 1.0
                sh.cavity_ridge_factor = 0.0
                render(sc, base + "_l.png")
                sh.show_cavity = False
                # 3 height (vertex colour = z / 16, raw, 16 bit)
                sh.light, sh.color_type = "FLAT", "VERTEX"
                sc.view_settings.view_transform = "Raw"
                sc.render.image_settings.color_mode, sc.render.image_settings.color_depth = "BW", "16"
                render(sc, base + "_h.png")
                sc.view_settings.view_transform = "Standard"
                sc.render.image_settings.color_mode, sc.render.image_settings.color_depth = "RGBA", "8"
                # 4 front mask
                if df.get("front"):
                    sh.color_type = "OBJECT"
                    for o in objs:
                        o.color = (1, 1, 1, 1) if is_front(o["group"], d) else (0, 0, 0, 1)
                    render(sc, base + "_m.png")
                # 5 neighbour mask: where connected neighbours stand (their bodies hide this piece's ground shadow)
                ghosts = [o for o in objs if o["group"] == "ghost"]
                if ghosts:
                    sh.color_type = "OBJECT"
                    for o in objs:
                        o.hide_render = o["group"] != "ghost"
                        o.color = (1, 1, 1, 1)
                    render(sc, base + "_n.png")
                    for o in objs:
                        o.hide_render = o["group"] == "ghost"
                for o in objs:
                    o.color = cols[o.name]
                sh.color_type = "OBJECT"
            print("rendered", key, f, flush=True)
        meta["units"].append({"key": key, "name": df["name"], "frames": len(df["variants"]), "variants": df["variants"],
                              "footprint": df["footprint"], "posts": df.get("posts", []), "front": bool(df.get("front")),
                              **({"shadow_fill": False} if df.get("shadow_fill") is False else {})})
    rj = os.path.join(OUT, "render.json")
    if ONLY and os.path.exists(rj):
        old = {u["key"]: u for u in json.load(open(rj)).get("units", [])}
        old.update({u["key"]: u for u in meta["units"]})
        meta["units"] = [old[k] for k in DEFS if k in old]
    json.dump(meta, open(rj, "w"), indent=1, ensure_ascii=False)


main()
