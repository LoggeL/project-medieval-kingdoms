"""Turn supersampled Blender renders into pixel-art sprite sheets.

  python3 tools/blender/pixelize.py --style tools/blender/styles/chronik.json \
      --src .local/blender/chronik --out assets/figures/chronik [--steps speer:1]

Per unit writes <out>/<unit>.png: rows = 8 directions (S, SE, E, NE, N, NW, W, SW),
columns = frame 0 (stand) + walk frames. Plus <out>/sheet.json with cell size, anchor and team swap table.

Every output colour is a fixed function of (material, light band) or (material, outline side), so each
material has a small ramp and the team colour can be swapped exactly (palette swap), see sheet.json "team_swap".

Steps (concept chapter 07):
 1. map every render pixel to its material (flat colour pass = exact style colour)
 2. per ss×ss block: dominant material; small features (eyes, hands, gold, blades) win from priority_cover on
 3. light band per block from the light pass, hard thresholds; despeckle isolated band pixels
 4. shade: levels per band, shadows tinted towards shadow_tint, highlights blended towards light_tint
 5. optional hatch: every n-th diagonal in the darkest band is darkened (woodcut look)
 6. outline: dark, selective (darkened neighbour material, lighter on the lit upper-left side),
    or rim (no outline, the figure's own edge pixels are darkened, like pre-rendered sprites)
 7. optional ordered dither between light bands (soft, pre-rendered look) and a cast ground shadow
"""
import argparse
import json
import os
import sys

import numpy as np
from scipy import ndimage
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument("--style", required=True)
ap.add_argument("--src", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--steps", help="unit:dir, writes the intermediate steps of frame 0 to <out>/_steps/")
ap.add_argument("--palette", help="JSON with the colours used in the render (buildings); output colours come from the style where it has the key")
ap.add_argument("--lref-src", help="take the light reference from these renders (figures), so buildings and figures share one light scale")
ap.add_argument("--lscale", type=float, default=1.0, help="multiply the light reference (buildings: moves lit faces off a band threshold)")
a = ap.parse_args()

STYLE = json.load(open(a.style))
PX = STYLE.get("pixel", {})
META = json.load(open(os.path.join(a.src, "render.json")))
SS, CELL, FRAMES = META["ss"], META["cell"], META["frames"]
CW, CH = (CELL, CELL) if isinstance(CELL, int) else CELL
PPM = META.get("ppm", 32 / 1.8)
COVER = PX.get("coverage", 0.45)
os.makedirs(a.out, exist_ok=True)


def hexrgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], np.float32)


if a.palette:
    # renders use a shared palette (IDS) to recognise materials; the style supplies its own colour where it has the key
    _pal = {k: v for k, v in json.load(open(a.palette)).items() if not k.startswith("_")}
    NAMES = list(_pal.keys())
    IDS = np.stack([hexrgb(_pal[n]) for n in NAMES])
    MATS = np.stack([hexrgb(STYLE["colors"].get(n, _pal[n])) for n in NAMES])
    if len({tuple(m) for m in IDS.tolist()}) != len(NAMES):
        sys.exit("palette %s: two keys share the same value" % a.palette)
else:
    NAMES = list(STYLE["colors"].keys())
    MATS = np.stack([hexrgb(STYLE["colors"][n]) for n in NAMES])  # (M,3)
    IDS = MATS
M = len(NAMES)
if len({tuple(m) for m in MATS.tolist()}) != M:
    sys.exit("style %s: two colour keys share the same value, materials would be confused" % STYLE.get("label"))
TEAM = NAMES.index("team")
TEAM_ALT = {k: hexrgb(v) for k, v in PX.get("team_alt", {"rot": "#b02a26", "gruen": "#1f8f8a"}).items()}
BODY_DY = [int(round(v)) for v in META.get("body_dy", [0] * FRAMES)]

LIGHT = PX.get("light", {})
THRESH = np.array(LIGHT.get("thresholds", [0.55, 0.85, 0.97]), np.float32)
LEVELS = LIGHT.get("levels", [0.58, 0.8, 1.0, 1.14])
NB = len(LEVELS)
SHADOW_TINT = hexrgb(LIGHT.get("shadow_tint", "#2a2350"))
LIGHT_TINT = hexrgb(LIGHT.get("light_tint", "#fff0c8"))
HUE = LIGHT.get("hue_shift", 0.18)
HATCH = PX.get("hatch")
DITHER = LIGHT.get("dither", 0.0)
BAYER = (np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]], np.float32) + 0.5) / 16
SHADOW = PX.get("shadow")
RIM = PX.get("rim", 0.72)
RIM_SIDES = PX.get("rim_sides", "all")  # "all" or "shade": only edges facing away from the light (right, bottom)
METAL = set(PX.get("metal", []))  # materials with a stronger light curve (shine)
METAL_GAIN = PX.get("metal_gain", 1.0)
DARK = hexrgb(PX.get("outline_color", "#1e1a1c"))

prio = np.zeros(M, np.float32)
for i, n in enumerate(PX.get("priority", [])):
    if n in NAMES:
        prio[NAMES.index(n)] = 1000.0 * (len(PX["priority"]) - i)
PCOVER = PX.get("priority_cover", 0.25) * SS * SS

# light reference: fixed per style, or 99th percentile over the standing frames of all units
if "ref" in LIGHT:
    LREF = LIGHT["ref"]
else:
    vals = []
    lsrc = a.lref_src or a.src
    for u in json.load(open(os.path.join(lsrc, "render.json")))["units"]:
        l_ = np.asarray(Image.open(os.path.join(lsrc, u["key"], "d0_f0_l.png")).convert("RGBA")).astype(np.float32)
        vals.append(l_[..., 0][l_[..., 3] > 127])
    vals = np.concatenate(vals) if vals else np.zeros(0)
    if not vals.size:
        sys.exit("no opaque pixels in the standing frames, cannot derive the light reference")
    LREF = float(np.percentile(vals, 99)) / 255
LREF *= a.lscale
if LREF <= 0:
    sys.exit("light reference is zero")
BLD = bool(a.palette)  # building renders (shared palette, height pass)
# buildings: parts near the ground get a little darker (soft sky light, pre-rendered look), foliage is not dithered
HGRAD = PX.get("height_gradient", 0.16) if BLD else 0.0
NODITHER = [i for i, n in enumerate(NAMES) if n in PX.get("no_dither", ["leaf", "leaf_dk", "leaf_hi", "needle"])] if BLD else []
HATCH_SKIP = [i for i, n in enumerate(NAMES) if n in PX.get("hatch_skip", [])]


# ---------------------------------------------------------------- colour tables
def shade(base, band, metal=False):
    k = LEVELS[band]
    if metal:
        k = 1.0 + (k - 1.0) * METAL_GAIN
    if k > 1.0:
        rgb = base + (LIGHT_TINT - base) * min(1.0, (k - 1.0) * 2.5 * (1.5 if metal else 1.0))
    else:
        rgb = base * k
        if band == 0 or (band == 1 and NB > 3):
            t = HUE * (1.0 if band == 0 else 0.5)
            rgb = rgb * (1 - t) + SHADOW_TINT * k * t
    return np.clip(np.round(rgb), 0, 255)


def hatch(base):
    return np.clip(np.round(shade(base, 0) * HATCH["factor"]), 0, 255)


def outline_col(base, lit):
    if PX.get("outline", "dark") == "dark":
        return DARK
    f = PX.get("outline_dark_lit", 0.8) if lit else PX.get("outline_dark", 0.45)
    mix = PX.get("outline_mix", 0.3)
    return np.clip(np.round(shade(base, 0) * f * (1 - mix) + DARK * mix), 0, 255)


def tables(mats):
    sh = np.stack([np.stack([shade(m, b, NAMES[i] in METAL) for b in range(NB)]) for i, m in enumerate(mats)])  # (M,NB,3)
    ht = np.stack([hatch(m) if HATCH else shade(m, 0) for m in mats])  # (M,3)
    ol = np.stack([np.stack([outline_col(m, lit) for lit in (0, 1)]) for m in mats])  # (M,2,3)
    rim = np.clip(np.round(sh * RIM), 0, 255)  # (M,NB,3) darkened edge pixels for outline "rim"
    return sh, ht, ol, rim


SH, HT, OL, RM = tables(MATS)


# ---------------------------------------------------------------- per frame
def analyse(img, lim, f=0, where="", hpath=None):
    """-> mat (h,w) int with -1 = empty, band (h,w) int."""
    arr = np.asarray(img.convert("RGBA")).astype(np.float32)
    lig = np.asarray(lim.convert("RGBA"))[..., 0].astype(np.float32) / 255
    H, W = arr.shape[:2]
    h, w = H // SS, W // SS
    op = arr[..., 3] > 127
    idx = np.zeros((H, W), np.int64)
    dmin = np.zeros((H, W), np.float32)
    for r0 in range(0, H, 128):  # nearest render colour, in row chunks (large building renders)
        dist = ((arr[r0:r0 + 128, :, None, :3] - IDS[None, None]) ** 2).sum(-1)
        idx[r0:r0 + 128] = dist.argmin(-1)
        dmin[r0:r0 + 128] = dist.min(-1)
    worst = np.sqrt(dmin[op].max()) if op.any() else 0.0
    if worst > 8:
        print("warning: %s has a colour %.0f away from every style colour (missing key?)" % (where, worst), file=sys.stderr)

    def blk(x):
        return x[:h * SS, :w * SS].reshape(h, SS, w, SS).transpose(0, 2, 1, 3).reshape(h, w, SS * SS)

    ib, ob, lb = blk(idx), blk(op), blk(lig)
    counts = ((ib[..., None] == np.arange(M)) & ob[..., None]).sum(2).astype(np.float32)  # (h,w,M)
    mat = (counts + prio * (counts >= PCOVER)).argmax(-1)
    sel = (ib == mat[..., None]) & ob
    L = (lb * sel).sum(-1) / np.maximum(sel.sum(-1), 1) / LREF
    if HGRAD and hpath and os.path.exists(hpath):
        zb = blk(np.asarray(Image.open(hpath)).astype(np.float32) / 65535.0 * 16.0)
        zm = (zb * sel).sum(-1) / np.maximum(sel.sum(-1), 1)
        L = L * (1 - HGRAD + HGRAD * np.clip(zm / 2.5, 0, 1))
    if DITHER:
        yy, xx = np.mgrid[0:h, 0:w]
        yy = yy - BODY_DY[f]  # pattern moves with the body, no crawling while walking
        dz = (BAYER[yy % 4, xx % 4] - 0.5) * DITHER
        if NODITHER:
            dz = np.where(np.isin(mat, NODITHER), 0.0, dz)
        L = L + dz
    band = np.searchsorted(THRESH, L).astype(np.int64)
    mat = np.where(ob.sum(-1) >= COVER * SS * SS, mat, -1)
    return mat, band


def despeckle(mat, band):
    """A pixel whose same-material 4-neighbours (at least 3) agree on another band takes that band."""
    if not PX.get("despeckle"):
        return band
    h, w = mat.shape
    pm = np.pad(mat, 1, constant_values=-1)
    pb = np.pad(band, 1, constant_values=-1)
    shifts = [(0, 1), (2, 1), (1, 0), (1, 2)]
    nm = np.stack([pm[dy:dy + h, dx:dx + w] for dy, dx in shifts])
    nb = np.stack([pb[dy:dy + h, dx:dx + w] for dy, dx in shifts])
    same = nm == mat[None]
    out = band.copy()
    for b in range(NB):
        flip = (mat >= 0) & (band != b) & (((nb == b) & same).sum(0) >= 3)
        out[flip] = b
    return out


BSHADOW = SHADOW or PX.get("building_shadow", {"dx": 0.62, "dy": 0.1, "alpha": 90, "color": "#1c2412"})
COS30 = np.cos(np.radians(30))


def blocks_mean(x):
    H, W = x.shape
    h, w = H // SS, W // SS
    return x[:h * SS, :w * SS].reshape(h, SS, w, SS).mean((1, 3))


def splat(mask, sx, sy):
    H, W = mask.shape
    sx, sy = np.round(sx).astype(int), np.round(sy).astype(int)
    ok = (sx >= 0) & (sx < W) & (sy >= 0) & (sy < H)
    mask[sy[ok], sx[ok]] = True
    return mask


def height_shadows(img, hpath, fill=True):
    """Cast shadow on the ground and on horizontal parts of the building itself, from the height pass.
    A point at height z (screen px zp) lies above the ground point (x, y + zp); its shadow on a plane at height zr
    lands at (x + d*dx, y + d - d*dy) with d = (z - zr) in screen px. Returns (ground, self) masks at sprite size."""
    op = np.asarray(img.convert("RGBA"))[..., 3] > 127
    z = np.asarray(Image.open(hpath)).astype(np.float32) / 65535.0 * 16.0
    k = COS30 * PPM * SS  # metres -> render px
    dx, dy = BSHADOW.get("dx", 0.5), BSHADOW.get("dy", 0.25)
    ys, xs = np.nonzero(op)
    zs = z[ys, xs]
    # ground shadow
    d = zs * k
    g = splat(np.zeros(op.shape, bool), xs + d * dx, ys + d - d * dy)
    g = ndimage.binary_closing(g, np.ones((2 * SS + 1, 2 * SS + 1), bool), border_value=0)
    # closed outlines cast a solid shadow (walls hide the ground inside); open structures (scaffold, stake-out
    # string, foundation ring) set "shadow_fill": false in buildings.json and keep only the shadow of their parts
    g = (ndimage.binary_fill_holes(g) if fill else g) & ~op
    ground = drop_small(blocks_mean(g.astype(np.float32)) >= 0.5, 12)
    # shadows on horizontal surfaces of the building (floors, platforms, roofs of lower parts)
    gx = np.abs(np.diff(z, axis=1, append=z[:, -1:]))
    gy = np.abs(np.diff(z, axis=0, append=z[-1:, :]))
    flat = op & (gx < 0.004) & (gy < 0.004)
    selfm = np.zeros(op.shape, bool)
    zq = np.round(z / 0.1).astype(np.int32)
    for b in np.unique(zq[flat]):
        # receivers need at least one sprite pixel of extent (the 5 cm tops of wall stones are no floor)
        rec = ndimage.binary_opening(flat & (zq == b), np.ones((SS, SS), bool))
        if rec.sum() < SS * SS * 2:
            continue
        zr = b * 0.1
        cast = zs > zr + 0.25
        dd = (zs[cast] - zr) * k
        m = splat(np.zeros(op.shape, bool), xs[cast] + dd * dx, ys[cast] + dd - dd * dy)
        m = ndimage.binary_closing(m, np.ones((SS + 1, SS + 1), bool), border_value=0)
        selfm |= rec & m
    selfb = drop_small(blocks_mean(selfm.astype(np.float32)) >= 0.5, 4)
    return ground, selfb


def drop_small(mask, n):
    """Remove connected islands smaller than n pixels."""
    lab, k = ndimage.label(mask)
    if not k:
        return mask
    sizes = ndimage.sum(mask, lab, range(1, k + 1))
    return np.isin(lab, 1 + np.nonzero(sizes >= n)[0])


def front_mask(mpath):
    m = np.asarray(Image.open(mpath).convert("RGBA")).astype(np.float32)
    return blocks_mean(((m[..., 0] > 127) & (m[..., 3] > 127)).astype(np.float32)) >= 0.5


def render(mat, band, base_only=False, outline=True, f=0, ground_shadow=None, joined=None):
    """joined: where connected neighbours stand (wall pieces). The piece continues there, so its edge towards
    them is no silhouette: no rim and no outline ring (else every tile joint shows a dark seam)."""
    h, w = mat.shape
    out = np.zeros((h, w, 4), np.uint8)
    fig = mat >= 0
    m = np.where(fig, mat, 0)
    if base_only:
        out[..., :3] = MATS[m].astype(np.uint8)
    else:
        rgb = SH[m, np.clip(band, 0, NB - 1)]
        if HATCH:
            yy, xx = np.mgrid[0:h, 0:w]
            hm = fig & (band == 0) & (((xx + yy - BODY_DY[f]) % HATCH["every"]) == 0)
            if HATCH_SKIP:
                hm &= ~np.isin(m, HATCH_SKIP)
            rgb[hm] = HT[m[hm]]
        out[..., :3] = rgb.astype(np.uint8)
    out[~fig, :3] = 0  # transparent pixels carry no colour (no team-blue fringe when filtered)
    out[fig, 3] = 255
    mode = PX.get("outline", "dark")
    if outline and mode == "rim":
        pm = np.pad(np.where(joined & ~fig, M, mat) if joined is not None else mat, 1, constant_values=-1)
        if RIM_SIDES == "shade" and BLD:
            # buildings: no rim on 2:1 edges rising to the right (would give a dotted line), only on true right/bottom edges
            edge = fig & ((pm[2:, 1:-1] < 0) | ((pm[1:-1, 2:] < 0) & (pm[2:, 2:] < 0)))
        elif RIM_SIDES == "shade":
            edge = fig & ((pm[2:, 1:-1] < 0) | (pm[1:-1, 2:] < 0))
        else:
            edge = fig & ((pm[:-2, 1:-1] < 0) | (pm[2:, 1:-1] < 0) | (pm[1:-1, :-2] < 0) | (pm[1:-1, 2:] < 0))
        out[edge, :3] = RM[m[edge], np.clip(band[edge], 0, NB - 1)].astype(np.uint8)
    if outline and ground_shadow is not None:
        alpha = np.zeros((h, w), np.int32)
        alpha[ground_shadow & ~fig] = BSHADOW.get("alpha", 90)
        fr_a = BSHADOW.get("fringe_alpha")
        if fr_a:
            ring = ndimage.binary_dilation(ground_shadow, np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], bool)) & ~ground_shadow & ~fig
            alpha[ring] = np.maximum(alpha[ring], fr_a)
        sm = alpha > 0
        out[sm, :3] = hexrgb(BSHADOW.get("color", "#1c2412")).astype(np.uint8)
        out[sm, 3] = alpha[sm]
    elif outline and SHADOW:
        # cast shadow: every figure pixel at height hgt above the feet lands at (x + hgt*dx, foot - hgt*dy)
        foot = h - STYLE.get("foot_margin_px", 4)
        ys, xs = np.nonzero(fig)
        hgt = np.maximum(foot - ys, 0)
        sx = np.round(xs + hgt * SHADOW.get("dx", 0.55)).astype(int)
        sy = np.round(foot - hgt * SHADOW.get("dy", 0.22)).astype(int)
        ok = (sx >= 0) & (sx < w) & (sy >= 0) & (sy < h)
        smask = np.zeros((h, w), bool)
        smask[sy[ok], sx[ok]] = True
        if SHADOW.get("solid"):
            # one solid shape: close projection gaps, fill holes, drop specks
            smask = ndimage.binary_closing(smask, np.ones((3, 3), bool), border_value=0)
            smask = ndimage.binary_fill_holes(smask)
            lab, n = ndimage.label(smask)
            if n:
                sizes = ndimage.sum(smask, lab, range(1, n + 1))
                smask = np.isin(lab, 1 + np.nonzero(sizes >= 4)[0])
        else:
            # close 1-px gaps from the projection
            smask |= np.roll(smask, 1, 1) & np.roll(smask, -1, 1)
        alpha = np.zeros((h, w), np.int32)
        alpha[smask] = SHADOW.get("alpha", 110)
        fr_a = SHADOW.get("fringe_alpha")
        if fr_a:
            ring = ndimage.binary_dilation(smask, np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], bool)) & ~smask
            alpha[ring] = np.maximum(alpha[ring], fr_a)
        ct = SHADOW.get("contact")
        if ct:
            # contact patch under the feet (ellipse rx x ry around the foot point)
            yy, xx = np.mgrid[0:h, 0:w]
            cx = w // 2
            ell = ((xx - cx + 0.5) / ct["rx"]) ** 2 + ((yy - foot + 0.5) / ct["ry"]) ** 2 <= 1.0
            alpha[ell] = np.maximum(alpha[ell], ct["alpha"])
        alpha[fig] = 0
        sm = alpha > 0
        out[sm, :3] = hexrgb(SHADOW.get("color", "#2a1e10")).astype(np.uint8)
        out[sm, 3] = alpha[sm]
    if outline and mode not in ("none", "rim"):
        pm = np.pad(mat, 1, constant_values=-1)
        # neighbour order: right, below (ring on the lit upper-left side), then left, above
        order = [((1, 2), 1), ((2, 1), 1), ((1, 0), 0), ((0, 1), 0)]
        if PX.get("outline_diag"):
            order += [((2, 2), 1), ((0, 0), 0), ((0, 2), 0), ((2, 0), 0)]
        nbm = np.full((h, w), -1)
        lit = np.zeros((h, w), np.int64)
        for (dy, dx), l_ in order:
            cand = pm[dy:dy + h, dx:dx + w]
            take = (nbm < 0) & (cand >= 0) & ~fig
            if joined is not None:
                take &= ~joined
            nbm[take] = cand[take]
            lit[take] = l_
        ring = nbm >= 0
        out[ring, :3] = OL[nbm[ring], lit[ring]].astype(np.uint8)
        out[ring, 3] = 255
    return out


units = [u["key"] for u in META["units"]]
ndirs = len(META["dirs"])
used = set()
SELF_BANDS = PX.get("self_shadow_bands", 2)
for ui, u in enumerate(units):
    nf = META["units"][ui].get("frames", FRAMES)
    sheet = Image.new("RGBA", (CW * nf, CH * ndirs), (0, 0, 0, 0))
    front = None
    for d in range(ndirs):
        for f in range(nf):
            p = os.path.join(a.src, u, "d%d_f%d.png" % (d, f))
            if not os.path.exists(p):
                continue
            img = Image.open(p)
            mat, band = analyse(img, Image.open(p[:-4] + "_l.png"), f, "%s d%d f%d" % (u, d, f), p[:-4] + "_h.png")
            band = despeckle(mat, band)
            gsh = None
            joined = front_mask(p[:-4] + "_n.png") if os.path.exists(p[:-4] + "_n.png") else None
            if os.path.exists(p[:-4] + "_h.png"):
                gsh, selfb = height_shadows(img, p[:-4] + "_h.png", META["units"][ui].get("shadow_fill", True))
                if os.path.exists(p[:-4] + "_n.png"):
                    # no ground shadow where a connected neighbour stands (wall pieces)
                    gsh = drop_small(gsh & ~joined, 12)
                band = np.where(selfb & (mat >= 0), np.maximum(band - SELF_BANDS, 0), band)
            fr = render(mat, band, f=f, ground_shadow=gsh, joined=joined)
            used |= set(map(tuple, fr[fr[..., 3] == 255][:, :3]))
            sheet.paste(Image.fromarray(fr, "RGBA"), (f * CW, d * CH))
            if os.path.exists(p[:-4] + "_m.png"):
                if front is None:
                    front = Image.new("RGBA", sheet.size, (0, 0, 0, 0))
                fm = front_mask(p[:-4] + "_m.png") & (fr[..., 3] == 255)
                # the contour ring right next to the front parts belongs to them (styles with an outline)
                fm |= (fr[..., 3] == 255) & (mat < 0) & ndimage.binary_dilation(fm, np.ones((3, 3), bool))
                fo = np.zeros_like(fr)
                fo[fm] = fr[fm]
                front.paste(Image.fromarray(fo, "RGBA"), (f * CW, d * CH))
            if a.steps == "%s:%d" % (u, d) and f == 0:
                sd = os.path.join(a.out, "_steps")
                os.makedirs(sd, exist_ok=True)
                Image.open(p).save(os.path.join(sd, "1_render.png"))
                Image.open(p[:-4] + "_l.png").save(os.path.join(sd, "2_light.png"))
                Image.fromarray(render(mat, band, base_only=True, outline=False), "RGBA").save(os.path.join(sd, "3_blocks.png"))
                Image.fromarray(render(mat, band, outline=False), "RGBA").save(os.path.join(sd, "4_shaded.png"))
                Image.fromarray(fr, "RGBA").save(os.path.join(sd, "5_final.png"))
    sheet.save(os.path.join(a.out, u + ".png"), optimize=True)
    if front is not None:
        front.save(os.path.join(a.out, u + "_front.png"), optimize=True)

# exact team swap table: every colour the team material can produce -> the same for another base colour
swap = {}
for name, alt in TEAM_ALT.items():
    mats2 = MATS.copy()
    mats2[TEAM] = alt
    sh2, ht2, ol2, rm2 = tables(mats2)
    pairs = [SH[TEAM, b].tolist() + sh2[TEAM, b].tolist() for b in range(NB)]
    if HATCH:
        pairs.append(HT[TEAM].tolist() + ht2[TEAM].tolist())
    if PX.get("outline", "dark") == "selective":
        pairs += [OL[TEAM, lit].tolist() + ol2[TEAM, lit].tolist() for lit in (0, 1)]
    if PX.get("outline", "dark") == "rim":
        pairs += [RM[TEAM, b].tolist() + rm2[TEAM, b].tolist() for b in range(NB)]
    swap[name] = [[int(v) for v in p_] for p_ in pairs]

# clash check: a team colour must not also come from another material
team_cols = {tuple(p_[:3]) for p_ in next(iter(swap.values()))} if swap else set()
other = set()
for mi in range(M):
    if mi == TEAM:
        continue
    other |= {tuple(int(v) for v in SH[mi, b]) for b in range(NB)}
    if PX.get("outline", "dark") == "selective":
        other |= {tuple(int(v) for v in OL[mi, lit]) for lit in (0, 1)}
    if HATCH:
        other.add(tuple(int(v) for v in HT[mi]))
    if PX.get("outline", "dark") == "rim":
        other |= {tuple(int(v) for v in RM[mi, b]) for b in range(NB)}
if PX.get("outline", "dark") == "dark":
    other.add(tuple(int(v) for v in DARK))
clash = team_cols & other

atlas = None
if not BLD:
    # figures: one atlas with every unit in sheet order, 8 direction rows each (unit i starts at row 8 i)
    at = Image.new("RGBA", (CW * FRAMES, CH * ndirs * len(units)), (0, 0, 0, 0))
    for ui, u in enumerate(units):
        at.paste(Image.open(os.path.join(a.out, u + ".png")), (0, ui * ndirs * CH))
        META["units"][ui]["row"] = ui * ndirs
    at.save(os.path.join(a.out, "atlas.png"), optimize=True)
    atlas = "atlas.png"

json.dump({"style": STYLE.get("label"), "cell": CELL, "frames": FRAMES, "dirs": META["dirs"], "atlas": atlas,
           "anchor": META.get("anchor") or [CW // 2, CH - STYLE.get("foot_margin_px", 4)],
           "tile": META.get("tile"), "step_px": META.get("step_px"),
           "axes": {"u": "+x", "v": "-y", "views": "view d = model turned d x 90 deg counter-clockwise; posts and footprint in model axes"} if BLD else None,
           "units": META["units"], "team_swap": swap, "colours": len(used),
           "shadow": bool(SHADOW), "ground": STYLE.get("ground")},
          open(os.path.join(a.out, "sheet.json"), "w"), ensure_ascii=False, indent=1)
print("sheets:", len(units), "colours used:", len(used), "team clash:", sorted(clash) or "none")
if clash:
    sys.exit("team colours collide with other materials, palette swap would recolour them")
