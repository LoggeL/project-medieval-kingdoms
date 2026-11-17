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


def fence(mb, pts, h=0.95, step=1.1, gaps=()):
    """Post-and-rail fence along a polyline in the ground plane; gaps = list of (segment index)."""
    for si in range(len(pts) - 1):
        (ax, ay), (bx_, by) = pts[si], pts[si + 1]
        L = math.hypot(bx_ - ax, by - ay)
        n = max(1, round(L / step))
        if si in gaps:
            continue
        for i in range(n + 1):
            t = i / n
            mb.box("wood", (ax + (bx_ - ax) * t, ay + (by - ay) * t, h / 2), (0.11, 0.11, h))
        ang = math.degrees(math.atan2(by - ay, bx_ - ax))
        for zr in (0.42, 0.82):
            mb.box("wood_hi", ((ax + bx_) / 2, (ay + by) / 2, h * zr), (L, 0.06, 0.08), rot=(0, 0, ang))


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
    w = T - 0.15  # 2 tiles wide, slightly inset
    masonry(mb, -w, w, -w, w, 0, h, row=0.36, top=False)
    mb.bx("stone_top", -w - 0.12, w + 0.12, -w - 0.12, w + 0.12, h - 0.22, h)  # cornice
    mb.bx("stone_top", -w, w, -w, w, h - 0.02, h + 0.04)                        # platform
    mb.bx("wood", -0.5, 0.1, 0.3, 0.9, h + 0.04, h + 0.08)                       # trapdoor
    groups = {"s": "f:0:-1", "n": "f:0:1", "e": "f:1:0", "w": "f:-1:0"}
    battlements(mb, -w - 0.12, w + 0.12, -w - 0.12, w + 0.12, h, sides="nesw", side_groups=groups)
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


def b_treppe(mb, var):
    h = 3 * STEP
    n = 10
    y0, y1 = -T + 0.05, T - 0.05
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


BUILD = {"haus": b_haus, "holzfaeller": b_holzfaeller, "steinbruch": b_steinbruch, "lager": b_lager, "kaserne": b_kaserne,
         "turm": b_turm, "mauer": b_mauer, "treppe": b_treppe, "baum": b_baum, "tanne": b_tanne}


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
                for o in objs:
                    o.color = cols[o.name]
                sh.color_type = "OBJECT"
            print("rendered", key, f, flush=True)
        meta["units"].append({"key": key, "name": df["name"], "frames": len(df["variants"]), "variants": df["variants"],
                              "footprint": df["footprint"], "posts": df.get("posts", []), "front": bool(df.get("front"))})
    rj = os.path.join(OUT, "render.json")
    if ONLY and os.path.exists(rj):
        old = {u["key"]: u for u in json.load(open(rj)).get("units", [])}
        old.update({u["key"]: u for u in meta["units"]})
        meta["units"] = [old[k] for k in DEFS if k in old]
    json.dump(meta, open(rj, "w"), indent=1, ensure_ascii=False)


main()
