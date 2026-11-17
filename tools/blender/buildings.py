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
    # garden strip
    ground(mb, "dirt", -2.3, 2.4, -2.45, -D / 2 - 0.05, ragged=0.1)


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
}
SITE_KIND = {"steinbruch": "yard", "lager": "yard"}
# scaffold: outline, number of levels, level height (m)
SCAFFOLDS = {
    "haus": (SITE_RECTS["haus"][0], 2, 1.45),
    "holzfaeller": (SITE_RECTS["holzfaeller"][0], 1, 1.4),
    "kaserne": (SITE_RECTS["kaserne"][0], 3, 1.45),
    "turm": (SITE_RECTS["turm"][0], 4, 1.3),
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
         "lager_boden": b_lager_boden, "tor": b_tor}
BUILD.update({k: b_wallpiece(k) for k in WALL_CONN})
BUILD.update({"baustelle_" + k: b_site(k) for k in SITE_RECTS})
BUILD.update({"geruest_" + k: b_geruest(k) for k in SCAFFOLDS})
BUILD.update({"baustoff_holz": b_baustoff_holz, "baustoff_stein": b_baustoff_stein})


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
        for f, _ in enumerate(df["variants"]):
            for o in list(bpy.data.objects):
                if o.type != "CAMERA":
                    bpy.data.objects.remove(o, do_unlink=True)
            root = bpy.data.objects.new("root", None)
            sc.collection.objects.link(root)
            mb = MB(df.get("seed", 1) * 100 + f * 0 + 7)
            BUILD[key](mb, f)
            objs = realize(mb, root)
            cols = {o.name: tuple(o.color) for o in objs}
            for d in range(4):
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
