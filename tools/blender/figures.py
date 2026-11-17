"""Procedural low-poly medieval figures, rendered from a fixed 2:1 iso camera.

Run (from project root):
  blender -b --factory-startup -P tools/blender/figures.py -- \
      --style tools/blender/styles/klassisch.json --out .local/blender/klassisch [--units speer,bogen] [--quick]

Writes RGBA renders  <out>/<unit>/d<dir>_f<frame>.png  (frame 0 = idle, 1..N = walk cycle)
and <out>/render.json with camera/cell metadata. Pixelization happens in pixelize.py.

Direction index d (screen): 0 S, 1 SE, 2 E, 3 NE, 4 N, 5 NW, 6 W, 7 SW.
Light is the Workbench studio light, which is camera-relative (concept: light relative to camera).
"""
import bpy
from mathutils import Euler, Vector
import json
import math
import os
import sys

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    if name in ARGS:
        i = ARGS.index(name)
        return ARGS[i + 1] if i + 1 < len(ARGS) and not ARGS[i + 1].startswith("--") else True
    return default


STYLE = json.load(open(arg("--style")))
OUT = arg("--out")
ONLY = arg("--units")
QUICK = bool(arg("--quick", False))
os.makedirs(OUT, exist_ok=True)

DIR_NAMES = ["S", "SE", "E", "NE", "N", "NW", "W", "SW"]


# ---------------------------------------------------------------- colors
def lin(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def col(hexstr):
    h = hexstr.lstrip("#")
    return (lin(int(h[0:2], 16)), lin(int(h[2:4], 16)), lin(int(h[4:6], 16)), 1.0)


PAL = STYLE["colors"]


def C(key):
    if key.startswith("#"):
        return col(key)
    if key not in PAL:
        raise KeyError("colour '%s' missing in style %s" % (key, STYLE.get("label")))
    return col(PAL[key])


# ---------------------------------------------------------------- scene
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sh = sc.display.shading
    sh.light = "STUDIO"
    sh.color_type = "OBJECT"
    sh.show_cavity = False
    sh.show_object_outline = False
    sh.show_specular_highlight = False
    sh.show_shadows = bool(STYLE.get("shadows", False))
    if sh.show_shadows:
        sh.shadow_intensity = STYLE.get("shadow_intensity", 0.35)
    sc.display.render_aa = "OFF"
    sc.render.film_transparent = True
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    return sc


def empty(name, loc=(0, 0, 0), parent=None):
    o = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(o)
    o.location = loc
    if parent:
        o.parent = parent
    return o


def _finish(o, name, color, parent, loc, rot, scale):
    o.name = name
    o.color = C(color)
    if parent:
        o.parent = parent
    o.location = loc
    o.rotation_euler = rot
    o.scale = scale
    return o


# style option "smooth": rounded, smooth-shaded primitives for a continuous pre-rendered tone
SMOOTH = bool(STYLE.get("smooth", False))


def _smooth(o, bevel=False):
    if not SMOOTH:
        return
    if bevel:
        m = o.modifiers.new("bevel", "BEVEL")
        m.width = 0.15  # cube of size 1, scaled afterwards: rounds every edge by ~15 % of its side
        m.segments = 2
    bpy.ops.object.shade_smooth()


def box(name, size, loc, color, parent=None, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1)
    o = bpy.context.active_object
    _smooth(o, bevel=True)
    return _finish(o, name, color, parent, loc, rot, size)


def cyl(name, r, depth, loc, color, parent=None, rot=(0, 0, 0), verts=8, sx=1.0, sy=1.0):
    bpy.ops.mesh.primitive_cylinder_add(vertices=max(verts, 16) if SMOOTH else verts, radius=1, depth=1)
    o = bpy.context.active_object
    _smooth(o)
    return _finish(o, name, color, parent, loc, rot, (r * sx, r * sy, depth))


def cone(name, r1, r2, depth, loc, color, parent=None, rot=(0, 0, 0), verts=8):
    bpy.ops.mesh.primitive_cone_add(vertices=max(verts, 16) if SMOOTH else verts, radius1=r1, radius2=r2, depth=depth)
    o = bpy.context.active_object
    _smooth(o)
    return _finish(o, name, color, parent, loc, rot, (1, 1, 1))


def ball(name, size, loc, color, parent=None, rot=(0, 0, 0), seg=8, rings=6):
    if SMOOTH:
        seg, rings = max(seg, 16), max(rings, 10)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, radius=1)
    o = bpy.context.active_object
    if SMOOTH:
        bpy.ops.object.shade_smooth()
    else:
        bpy.ops.object.shade_flat()
    return _finish(o, name, color, parent, loc, rot, size)


# ---------------------------------------------------------------- figure
UNITS = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "units.json")))


PXM = 1.8 / STYLE["height_px"]  # one target pixel in metres
# Side views (screen E/W) show the figure in profile, where only the body depth counts. These settings keep the
# profile readable: deeper chest and hips, arms a little forward and out at rest, larger hands, a nose.
# Style key "profile" overrides single values; {"depth": 1, "arm_fwd": 0, "arm_out": 0, "hand": 1, "nose": false} is the old look.
PROFILE = dict({"depth": 1.55, "arm_fwd": 18, "arm_out": 5, "upper_arm": 1.2, "hand": 1.2, "nose": True}, **STYLE.get("profile", {}))


def th(x):
    """Minimum thickness so thin gear survives the downscale (style min_px, default 1.6 px)."""
    return max(x, STYLE.get("min_px", 1.6) * 1.8 / STYLE["height_px"])


def build(unit):
    P = STYLE["proportions"]
    H = 1.8
    head = P["head"] * H
    legs = P["legs"] * H
    torso = P["torso"] * H
    neck = max(0.0, H - head - legs - torso)
    sw = P["shoulder"] * H
    hw = P["hip"] * H
    limb = P["limb"] * H
    depth = P["depth"] * H * PROFILE["depth"]
    headw = P["head_w"] * H
    arm_len = P.get("arm", 0.9) * torso
    team = unit.get("team", "team")

    root = empty("root")
    hip = empty("hip", (0, 0, legs), root)
    upper = empty("upper", (0, 0, 0), hip)  # torso, arms, head and carried gear (lean in action frames)

    # legs
    legs_col = unit.get("legs", "hose")
    legs_col2 = unit.get("legs2", legs_col)
    pivots = {}
    for side, sx in (("L", 1), ("R", -1)):
        pv = empty("leg" + side, (sx * hw * 0.27, 0, 0), hip)
        pivots["leg" + side] = pv
        c = legs_col if side == "L" else legs_col2
        box("thigh" + side, (limb * 1.05, limb * 1.1, legs * 0.55), (0, 0, -legs * 0.27), c, pv)
        kn = empty("knee" + side, (0, 0, -legs * 0.5), pv)
        pivots["knee" + side] = kn
        box("shin" + side, (limb * 0.95, limb, legs * 0.5), (0, 0, -legs * 0.2), unit.get("shins", c), kn)
        an = empty("ankle" + side, (0, 0, -legs * 0.4), kn)
        pivots["ankle" + side] = an
        box("boot" + side, (limb * 1.1, limb * 1.55, legs * 0.16), (0, -limb * 0.25, -legs * 0.03), "boots", an)

    # torso
    tk = unit["torso"]
    SA, SB = unit.get("slash_a", "slash1"), unit.get("slash_b", "slash2")
    tcol = {"tunic": unit.get("tunic", team), "gambeson": "gambeson", "leather": "leather",
            "mail_tabard": team, "plate": "plate", "slashed": SA, "worker": unit.get("tunic", "brown")}[tk]
    body = empty("body", (0, 0, 0), upper)
    if tk == "slashed":
        box("torsoL", (sw * 0.5, depth, torso), (sw * 0.25, 0, torso / 2), SA, body)
        box("torsoR", (sw * 0.5, depth, torso), (-sw * 0.25, 0, torso / 2), SB, body)
    else:
        box("torso", (sw * 0.92, depth, torso * 0.62), (0, 0, torso * 0.69), tcol, body)
        box("waist", (hw * 1.05, depth * 0.95, torso * 0.42), (0, 0, torso * 0.21), tcol, body)
    if tk == "plate" and not unit.get("tabard"):
        box("breast", (sw * 0.8, depth * 0.4, torso * 0.5), (0, -depth * 0.4, torso * 0.62), "plate_hi", body)
    if tk == "mail_tabard":
        for sx in (1, -1):
            box("spaulder", (limb * 1.5, depth * 1.05, torso * 0.2), (sx * sw * 0.42, 0, torso * 0.9), "mail", body)
    # skirt
    skirt = {"tunic": tcol, "gambeson": "gambeson", "leather": "leather", "mail_tabard": team, "plate": "plate",
             "slashed": SB, "worker": tcol}[tk]
    sl = unit.get("skirt", 0.3)
    if sl > 0:
        box("skirt", (hw * 1.25, depth * 1.12, legs * sl), (0, 0, -legs * sl / 2 + torso * 0.02), skirt, body)
    box("belt", (hw * 1.12, depth * 1.06, torso * 0.07), (0, 0, torso * 0.04), "belt", body)
    if unit.get("tabard"):
        box("tabard", (sw * 0.96, depth * 1.18, torso * 0.6), (0, 0, torso * 0.6), unit["tabard"], body)
        box("tabard_skirt", (hw * 1.2, depth * 1.22, legs * 0.3), (0, 0, -legs * 0.13), unit["tabard"], body)
    if unit.get("tabard_trim"):
        box("trim", (sw * 0.18, depth * 1.08, torso * 0.6), (0, 0, torso * 0.6), unit["tabard_trim"], body)

    # arms
    acol = {"tunic": tcol, "gambeson": "gambeson", "leather": unit.get("sleeve", "cloth"), "mail_tabard": "mail",
            "plate": "plate", "slashed": None, "worker": tcol}[tk]
    for side, sx in (("L", 1), ("R", -1)):
        pv = empty("arm" + side, (sx * (sw * 0.46 + limb * 0.5), 0, torso * 0.9), upper)
        pivots["arm" + side] = pv
        c = acol or (SB if side == "L" else SA)
        if tk == "slashed":
            ball("puff" + side, (limb * 0.9, limb * 0.9, arm_len * 0.3), (0, 0, -arm_len * 0.22), c, pv)
        ua = PROFILE["upper_arm"]
        box("upper" + side, (limb * 0.9 * ua, limb * 0.9 * ua, arm_len * 0.55), (0, 0, -arm_len * 0.27), c, pv)
        # elbow: forearm, hand and held gear (rest = straight arm, bent only in action poses such as the bow draw)
        el = empty("elbow" + side, (0, 0, -arm_len * 0.5), pv)
        pivots["elbow" + side] = el
        box("fore" + side, (limb * 0.85, limb * 0.85, arm_len * 0.45), (0, 0, -arm_len * 0.22), c, el)
        hs = PROFILE["hand"]
        box("hand" + side, (limb * 1.1 * hs, limb * 1.1 * hs, limb * 1.0 * hs), (0, 0, -arm_len * 0.48), unit.get("hands", "skin"), el)
        hand = empty("handpt" + side, (0, 0, -arm_len * 0.48), el)
        pivots["hand" + side] = hand

    # neck + head
    hz = torso + neck + head * 0.5
    if neck > 0:
        box("neck", (limb * 0.8, limb * 0.8, neck + head * 0.2), (0, 0, torso + neck / 2), "skin", upper)
    headp = empty("head", (0, 0, hz), upper)
    ball("skull", (headw * 0.5, headw * 0.52, head * 0.5), (0, 0, 0), "skin", headp)
    if PROFILE["nose"] and unit.get("helmet") not in ("sallet", "nasal"):
        # one pixel of nose, so the face side reads in profile (hidden under a helmet's nasal or visor)
        box("nose", (max(headw * 0.16, PXM), headw * 0.24, max(head * 0.16, PXM)), (0, -headw * 0.53, -head * 0.06), "skin", headp)
    if STYLE.get("eyes"):
        for sx in (1, -1):
            box("eye", (PXM, headw * 0.08, PXM), (sx * max(headw * 0.17, PXM), -headw * 0.49, head * 0.0), "eye", headp)
    helmet(unit.get("helmet", "hair"), headp, head, headw, team, unit)

    # gear (action_gear: only shown in the action frames, e.g. the day labourer's hammer)
    action_only = []
    for g in unit.get("gear", []) + unit.get("action_gear", []):
        before = {o.name for o in bpy.data.objects}
        gear(g, pivots, upper, body, H, torso, limb, depth, sw, team, unit)
        if g in unit.get("action_gear", []):
            action_only += [o.name for o in bpy.data.objects if o.name not in before and o.type == "MESH"]
    pivots["upper"] = upper
    # rest stance: free arms a little forward and out (wider profile), held arms keep their pose
    for side, sx in (("L", 1), ("R", -1)):
        if "arm" + side not in unit.get("pose", {}):
            pivots["arm" + side].rotation_euler = (math.radians(-PROFILE["arm_fwd"]), math.radians(-sx * PROFILE["arm_out"]), 0)

    # pose offsets (stance)
    for k, v in unit.get("pose", {}).items():
        pivots[k].rotation_euler = [math.radians(a) for a in v]
        if k.startswith("arm"):
            # held gear stays upright: the hand counter-rotates the arm pose
            g = unit.get("grip", {}).get(k, [0, 0, 0])
            inv = Euler([math.radians(a) for a in v], "XYZ").to_matrix().inverted()
            pivots["hand" + k[3:]].rotation_euler = (inv @ Euler([math.radians(b) for b in g], "XYZ").to_matrix()).to_euler("XYZ")
    return root, hip, pivots, legs, action_only


def helmet(kind, hp, head, hw, team, unit):
    steel = "steel"
    if kind == "hair":
        ball("hair", (hw * 0.53, hw * 0.55, head * 0.32), (0, hw * 0.06, head * 0.18), "hair", hp)
    elif kind == "hood":
        ball("hood", (hw * 0.58, hw * 0.6, head * 0.56), (0, hw * 0.1, head * 0.06), unit.get("hood", "hood"), hp)
        box("cape", (hw * 1.1, hw * 0.7, head * 0.3), (0, hw * 0.18, -head * 0.42), unit.get("hood", "hood"), hp)
    elif kind == "cap":
        ball("cap", (hw * 0.55, hw * 0.57, head * 0.3), (0, 0.0, head * 0.22), unit.get("capc", "cap"), hp)
        if STYLE.get("back_hair"):
            # hair down to the nape, so the back of the head reads differently from the face
            ball("hair", (hw * 0.5, hw * 0.5, head * 0.42), (0, hw * 0.12, 0), "hair", hp)
    elif kind == "kettle":
        cyl("brim", hw * 0.66, head * 0.06, (0, 0, head * 0.24), steel, hp, verts=10)
        ball("dome", (hw * 0.5, hw * 0.5, head * 0.36), (0, 0, head * 0.26), steel, hp)
    elif kind == "nasal":
        cone("cone", hw * 0.56, 0.0, head * 0.62, (0, 0, head * 0.36), steel, hp, verts=8)
        box("nasal", (hw * 0.08, hw * 0.08, head * 0.38), (0, -hw * 0.52, head * 0.0), steel, hp)
        ball("coif", (hw * 0.6, hw * 0.62, head * 0.45), (0, hw * 0.05, -head * 0.15), "mail", hp)
    elif kind == "sallet":
        ball("sallet", (hw * 0.6, hw * 0.75, head * 0.48), (0, hw * 0.12, head * 0.08), steel, hp)
        box("visor", (hw * 0.75, hw * 0.12, th(head * 0.08) * 0.75), (0, -hw * 0.56, head * 0.05), "eye", hp)
        box("bevor", (hw * 0.7, hw * 0.5, head * 0.35), (0, -hw * 0.2, -head * 0.4), steel, hp)
    elif kind == "beret":
        cyl("beret", hw * 0.85, head * 0.12, (hw * 0.06, 0, head * 0.36), unit.get("beretc", "dark"), hp,
            rot=(math.radians(-8), math.radians(14), 0), verts=10)
        ball("plume", (hw * 0.18, hw * 0.55, head * 0.16), (-hw * 0.42, hw * 0.25, head * 0.62), unit.get("plume", "feather"), hp,
             rot=(math.radians(25), math.radians(-30), 0))
        ball("hair", (hw * 0.53, hw * 0.55, head * 0.3), (0, hw * 0.08, head * 0.12), "hair", hp)


def legs_len(unit, H):
    return STYLE["proportions"]["legs"] * H


def gear(g, pv, hip, body, H, torso, limb, depth, sw, team, unit):
    hr, hl = pv["handR"], pv["handL"]
    if g == "spear":
        cyl("shaft", th(limb * 0.44) / 2, H * 1.25, (0, 0, H * 0.33), "wood", hr)
        cone("tip", limb * 0.45, 0, H * 0.12, (0, 0, H * 1.0), "steel", hr)
    elif g == "pike":
        cyl("shaft", th(limb * 0.4) / 2, H * 1.9, (0, 0, H * 0.6), "wood", hr)
        cone("tip", limb * 0.4, 0, H * 0.1, (0, 0, H * 1.6), "steel", hr)
    elif g == "halberd":
        cyl("shaft", th(limb * 0.44) / 2, H * 1.35, (0, 0, H * 0.38), "wood", hr)
        box("blade", (th(limb * 0.2), limb * 1.8, H * 0.14), (0, -limb * 0.9, H * 0.95), "steel", hr)
        box("hook", (limb * 0.2, limb * 0.9, H * 0.05), (0, limb * 0.5, H * 0.97), "steel", hr)
        cone("spike", limb * 0.3, 0, H * 0.14, (0, 0, H * 1.12), "steel", hr)
    elif g == "sword":
        box("grip", (limb * 0.25, limb * 0.25, H * 0.07), (0, 0, 0.0), "leather", hr)
        box("guard", (limb * 1.1, limb * 0.25, limb * 0.25), (0, 0, H * 0.04), "steel", hr)
        box("blade", (th(limb * 0.38), th(limb * 0.12), H * 0.38), (0, 0, H * 0.24), "steel_hi", hr)
    elif g == "mace":
        cyl("haft", th(limb * 0.4) / 2, H * 0.42, (0, 0, H * 0.14), "wood", hr)
        ball("head", (th(limb * 0.85), th(limb * 0.85), th(limb * 0.95)), (0, 0, H * 0.36), "steel_hi", hr, seg=6, rings=4)
    elif g == "axe":
        cyl("haft", th(limb * 0.44) / 2, H * 0.5, (0, 0, H * 0.18), "wood", hr)
        box("blade", (th(limb * 0.18), limb * 1.6, limb * 1.6), (0, -limb * 0.7, H * 0.4), "steel", hr)
    elif g == "zweihander":
        b = empty("zh", (0, 0, 0), hr)
        b.rotation_euler = (math.radians(unit.get("zh_tilt", -25)), 0, 0)
        box("grip", (th(limb * 0.3), th(limb * 0.3), H * 0.18), (0, 0, 0), "leather", b)
        box("guard", (limb * 2.2, limb * 0.3, limb * 0.3), (0, 0, H * 0.1), "steel", b)
        box("blade", (th(limb * 0.5), th(limb * 0.14), H * 0.75), (0, 0, H * 0.48), "steel_hi", b)
    elif g in ("shield_round", "shield_kite", "shield_heater"):
        s = empty("shield", (limb * 0.55, -limb * 0.35, 0), pv["armL"])
        s.location = (limb * 0.7, -limb * 0.2, -torso * 0.55)
        s.rotation_euler = (0, 0, math.radians(-35))
        if g == "shield_round":
            cyl("face", H * 0.17, limb * 0.25, (0, 0, 0), team, s, rot=(math.radians(90), 0, 0), verts=10)
            cyl("boss", H * 0.045, limb * 0.4, (0, -limb * 0.1, 0), "steel", s, rot=(math.radians(90), 0, 0), verts=6)
        elif g == "shield_kite":
            box("face", (H * 0.24, limb * 0.25, H * 0.36), (0, 0, -H * 0.04), team, s)
            box("stripe", (H * 0.06, limb * 0.3, H * 0.34), (0, -limb * 0.02, -H * 0.04), "gold", s)
            cone("point", H * 0.12, 0, H * 0.16, (0, 0, -H * 0.3), team, s, rot=(math.radians(180), 0, 0), verts=4)
        else:
            box("face", (H * 0.22, limb * 0.25, H * 0.22), (0, 0, 0), team, s)
            cone("point", H * 0.155, 0, H * 0.12, (0, 0, -H * 0.17), team, s, rot=(math.radians(180), 0, math.radians(45)), verts=4)
            box("charge", (H * 0.08, limb * 0.3, H * 0.08), (0, -limb * 0.03, 0), "gold", s)
    elif g == "bow":
        b = empty("bow", (0, -limb * 0.2, 0), hl)
        for i, (z, rx) in enumerate([(H * 0.2, -18), (0, 0), (-H * 0.2, 18)]):
            box("limb%d" % i, (th(limb * 0.2), th(limb * 0.24), H * 0.26), (0, 0 if i == 1 else math.sin(math.radians(18)) * H * 0.13, z * 1.15),
                "bow", b, rot=(math.radians(rx), 0, 0))
        box("bowstring", (th(0) * 0.7, th(0) * 0.7, H * 0.74), (0, limb * 0.55, 0), "string", b)
        # string ends and grip, for the drawn string and the arrow of the shooting frames
        empty("bowtipT", (0, limb * 0.55, H * 0.37), b)
        empty("bowtipB", (0, limb * 0.55, -H * 0.37), b)
        empty("bowmid", (0, 0, 0), b)
    elif g == "crossbow":
        c = empty("xbow", (0, 0, 0), hip)
        c.location = (0, -depth * 1.1, torso * 0.55)
        box("stock", (th(limb * 0.5), H * 0.42, th(limb * 0.5)), (0, 0, 0), "wood_hi", c)
        box("prod", (H * 0.44, th(limb * 0.3), th(limb * 0.3)), (0, -H * 0.18, limb * 0.1), "steel_hi", c)
        box("xstring", (H * 0.4, th(0) * 0.7, th(0) * 0.7), (0, -H * 0.1, limb * 0.1), "string", c)
    elif g == "pavise":
        # large shield carried on the back, team colour, historically typical for crossbowmen
        pv_ = empty("pavise", (0, depth * 0.78, torso * 0.42), hip)
        pv_.rotation_euler = (math.radians(-8), 0, 0)
        box("face", (sw * 0.95, th(limb * 0.35), torso * 1.05), (0, 0, 0), team, pv_)
        box("rib", (th(limb * 0.5), th(limb * 0.45), torso * 1.0), (0, limb * 0.18, 0), "gold", pv_)
    elif g == "quiver":
        q = empty("quiver", (sw * 0.15, depth * 0.62, torso * 0.55), hip)
        q.rotation_euler = (math.radians(-15), math.radians(20), 0)
        cyl("tube", limb * 0.55, torso * 0.65, (0, 0, 0), "leather", q, verts=6)
        box("fletch", (limb * 1.1, limb * 1.1, torso * 0.14), (0, 0, torso * 0.38), "cloth", q)
    elif g == "log":
        # log along the walking direction on the right shoulder, front end up and turned a little outwards (so it
        # does not shrink to a dot when the carrier walks towards the camera), held by the right hand
        lg = empty("logpv", (-sw * 0.36, -H * 0.02, torso * 0.98 + limb * 0.55), hip)
        lg.rotation_euler = (math.radians(58), 0, math.radians(-22.5))
        cyl("log", limb * 0.85, H * 0.62, (0, 0, 0), "log", lg, verts=8)
        cyl("logend", limb * 0.78, limb * 0.12, (0, 0, H * 0.31), "wood_hi", lg, verts=8)
    elif g == "pick":
        # stonemason's pick: long haft, steel head pointed on both sides
        cyl("haft", th(limb * 0.44) / 2, H * 0.55, (0, 0, H * 0.2), "wood", hr)
        box("head", (th(limb * 0.5), limb * 3.4, th(limb * 0.5)), (0, 0, H * 0.46), "steel", hr)
        box("tip", (th(limb * 0.3), limb * 0.9, th(limb * 0.3)), (0, -limb * 2.0, H * 0.44), "steel_hi", hr, rot=(math.radians(-20), 0, 0))
    elif g == "apron":
        box("apron", (sw * 0.8, th(limb * 0.3), torso * 0.55 + legs_len(unit, H) * 0.3), (0, -depth * 0.56, torso * 0.2), "leather", body)
    elif g == "stone_block":
        # dressed stone block on the right shoulder, steadied by the raised right hand
        sb = empty("blockpv", (-sw * 0.42, depth * 0.1, torso * 0.98 + limb * 1.6), hip)
        sb.rotation_euler = (0, math.radians(8), math.radians(10))
        box("block", (H * 0.26, H * 0.21, H * 0.19), (0, 0, 0), "stone", sb)
    elif g == "hammer":
        # carpenter's hammer for building: short haft, steel head across the haft (shown in the action frames only)
        cyl("haft", th(limb * 0.42) / 2, H * 0.3, (0, 0, H * 0.1), "wood", hr)
        box("head", (th(limb * 0.7), limb * 2.0, th(limb * 0.75)), (0, -limb * 0.2, H * 0.25), "steel", hr)
    elif g == "spear_bundle":
        # two spears on the right shoulder like the log, points forward, up and a little outwards, held by the raised hand
        sp = empty("spearpv", (-sw * 0.4, -H * 0.02, torso * 0.98 + limb * 0.6), hip)
        sp.rotation_euler = (math.radians(55), 0, math.radians(-22.5))
        for k, (dx, dz) in enumerate(((-limb * 0.3, 0.0), (limb * 0.3, -H * 0.05))):
            cyl("bshaft%d" % k, th(limb * 0.42) / 2, H * 1.15, (dx, 0, H * 0.12 + dz), "wood", sp)
            cone("btip%d" % k, limb * 0.5, 0, H * 0.12, (dx, 0, H * 0.75 + dz), "steel_hi", sp)
        box("bcord", (limb * 1.6, limb * 0.9, th(limb * 0.3)), (0, 0, -H * 0.12), "belt", sp)
    elif g == "sword_bundle":
        # three swords carried diagonally across the chest with both arms, points up past the right shoulder, tied
        sb = empty("swordpv", (0, -depth * 0.5 - H * 0.08, torso * 0.35), hip)
        sb.rotation_euler = (math.radians(8), math.radians(-35), 0)
        for k, dx in enumerate((-limb * 0.9, 0.0, limb * 0.9)):
            s_ = empty("sw%d" % k, (dx, 0, (k % 2) * H * 0.03), sb)
            s_.rotation_euler = (0, math.radians(-10 * (k - 1)), 0)
            box("sgrip%d" % k, (th(limb * 0.3), th(limb * 0.3), H * 0.08), (0, 0, -H * 0.05), "leather", s_)
            box("spommel%d" % k, (th(limb * 0.45), th(limb * 0.45), th(limb * 0.4)), (0, 0, -H * 0.1), "gold", s_)
            box("sguard%d" % k, (limb * 1.3, th(limb * 0.3), th(limb * 0.3)), (0, 0, 0), "steel", s_)
            box("sblade%d" % k, (th(limb * 0.42), th(limb * 0.14), H * 0.4), (0, 0, H * 0.21), "steel_hi", s_)
        box("sstrap", (limb * 3.0, limb * 0.6, th(limb * 0.35)), (0, 0, H * 0.06), "belt", sb)
    elif g == "bow_bundle":
        # three strung bows held upright by their grips in the right hand, slightly fanned
        for k in range(3):
            b = empty("bb%d" % k, (0, (k - 1) * limb * 0.5, 0), hr)
            b.rotation_euler = (math.radians(6 * (k - 1)), math.radians(9 * (k - 1)), 0)
            for i, (z, rx) in enumerate([(H * 0.2, -18), (0, 0), (-H * 0.2, 18)]):
                box("bblimb%d%d" % (k, i), (th(limb * 0.2), th(limb * 0.24), H * 0.26),
                    (0, 0 if i == 1 else math.sin(math.radians(18)) * H * 0.13, z * 1.15), "bow", b, rot=(math.radians(rx), 0, 0))
            box("bbstring%d" % k, (th(0) * 0.7, th(0) * 0.7, H * 0.74), (0, limb * 0.55, 0), "string", b)
    elif g == "crate":
        # crate carried in front of the chest with both arms
        cr = empty("cratepv", (0, -depth * 0.5 - H * 0.13, torso * 0.45), hip)
        box("crate", (H * 0.27, H * 0.22, H * 0.22), (0, 0, 0), "crate", cr)
        for k in (-1, 1):
            box("band", (H * 0.28, H * 0.23, th(limb * 0.3)), (0, 0, k * H * 0.07), "wood", cr)
    elif g in ("grain_sack", "flour_sack"):
        # full sack over the right shoulder like the stone block, the raised right hand holds the tied neck;
        # grain in burlap, flour in white linen
        c = "bow" if g == "grain_sack" else "feather"
        sk = empty("sackpv", (-sw * 0.3, depth * 0.15, torso * 0.98 + limb * 1.3), hip)
        sk.rotation_euler = (math.radians(12), math.radians(-18), math.radians(15))
        ball("sack", (H * 0.13, H * 0.17, H * 0.1), (0, 0, 0), c, sk, seg=8, rings=6)
        ball("sackneck", (H * 0.05, H * 0.05, H * 0.06), (0, H * 0.17, H * 0.02), c, sk, seg=6, rings=4)
        box("sacktie", (H * 0.06, th(limb * 0.3), H * 0.06), (0, H * 0.14, H * 0.02), "belt", sk)
    elif g == "bread_basket":
        # wicker basket with loaves carried in front of the chest with both arms
        bk = empty("basketpv", (0, -depth * 0.5 - H * 0.13, torso * 0.4), hip)
        cyl("basket", H * 0.13, H * 0.12, (0, 0, 0), "bow", bk, verts=10)
        cyl("rim", H * 0.135, th(limb * 0.35), (0, 0, H * 0.06), "wood_hi", bk, verts=10)
        for k, (dx, dy) in enumerate(((-H * 0.05, -H * 0.03), (H * 0.05, -H * 0.02), (0.0, H * 0.05))):
            ball("loaf%d" % k, (H * 0.055, H * 0.05, H * 0.035), (dx, dy, H * 0.075), "leather", bk, seg=6, rings=4)
    elif g == "meal_sack":
        # sack held in both hands (miller pouring grain into the hopper; shown in the action frames only)
        ms = empty("mealpv", (sw * 0.48, -limb * 0.6, -limb * 0.4), hr)
        ball("mealsack", (H * 0.11, H * 0.08, H * 0.13), (0, 0, 0), "bow", ms, seg=8, rings=6)
        ball("mealmouth", (H * 0.06, H * 0.06, H * 0.03), (0, 0, -H * 0.12), "gambeson", ms, seg=6, rings=4)
    elif g == "peel":
        # baker's peel: long pole with a flat blade, held like a spear (action frames only)
        cyl("peelshaft", th(limb * 0.4) / 2, H * 1.0, (0, 0, H * 0.3), "wood_hi", hr)
        box("peelblade", (H * 0.16, th(limb * 0.2), H * 0.18), (0, 0, H * 0.86), "wood_hi", hr)
        ball("peelloaf", (H * 0.05, H * 0.045, H * 0.03), (0, -limb * 0.25, H * 0.86), "leather", hr, seg=6, rings=4)
    # ---- Militärwirtschaft (ADR 0014)
    elif g == "poker":
        # smelter's iron poker, held like the baker's peel, glowing tip (action frames only)
        cyl("pokershaft", th(limb * 0.36) / 2, H * 0.95, (0, 0, H * 0.3), "dark", hr)
        box("pokertip", (th(limb * 0.45), th(limb * 0.45), H * 0.08), (0, 0, H * 0.8), "slash1", hr)
    elif g == "stave":
        # bow stave held upright in the left hand while the bowyer shaves it (action frames only)
        b = empty("stavepv", (0, -limb * 0.4, 0), hl)
        box("stave", (th(limb * 0.35), th(limb * 0.45), H * 0.7), (0, 0, H * 0.12), "bow", b)
    elif g == "drawknife":
        # short blade with a handle in the right hand (action frames only)
        box("dkhandle", (limb * 0.3, limb * 0.3, H * 0.08), (0, 0, 0), "wood", hr)
        box("dkblade", (th(limb * 0.2), limb * 1.6, th(limb * 0.5)), (0, -limb * 0.7, H * 0.05), "steel_hi", hr)
    elif g == "crossbow_hand":
        # crossbow held in the right hand: stock along the hand axis (upright on the march, forward when aiming),
        # steel prod across the front end, string and stirrup
        cyl("xbstock", th(limb * 0.5) / 2, H * 0.44, (0, 0, H * 0.14), "wood_hi", hr, verts=6)
        box("xbprod", (H * 0.42, th(limb * 0.32), th(limb * 0.32)), (0, 0, H * 0.33), "steel_hi", hr)
        box("xbstring", (H * 0.38, th(0) * 0.7, th(0) * 0.7), (0, limb * 0.25, H * 0.27), "string", hr)
        box("xbstirrup", (limb * 1.2, th(limb * 0.25), limb * 0.9), (0, 0, H * 0.38), "steel", hr)
    elif g == "ore_basket":
        # wicker basket full of reddish ore lumps carried in front of the chest with both arms
        bk = empty("orepv", (0, -depth * 0.5 - H * 0.13, torso * 0.4), hip)
        cyl("orebasket", H * 0.13, H * 0.12, (0, 0, 0), "bow", bk, verts=10)
        cyl("orerim", H * 0.135, th(limb * 0.35), (0, 0, H * 0.06), "wood_hi", bk, verts=10)
        for k, (dx, dy, c) in enumerate(((-H * 0.05, -H * 0.03, "cap"), (H * 0.05, -H * 0.02, "dark"), (0.0, H * 0.05, "cap"),
                                         (H * 0.01, -H * 0.06, "cap"))):
            ball("ore%d" % k, (H * 0.05, H * 0.045, H * 0.04), (dx, dy, H * 0.075), c, bk, seg=5, rings=3)
    elif g == "pike_bundle":
        # two pikes on the right shoulder like the spear bundle, much longer
        sp = empty("pikepv", (-sw * 0.4, -H * 0.02, torso * 0.98 + limb * 0.6), hip)
        sp.rotation_euler = (math.radians(62), 0, math.radians(-22.5))
        for k, (dx, dz) in enumerate(((-limb * 0.3, 0.0), (limb * 0.3, -H * 0.06))):
            cyl("pshaft%d" % k, th(limb * 0.4) / 2, H * 1.7, (dx, 0, H * 0.25 + dz), "wood", sp)
            cone("ptip%d" % k, limb * 0.45, 0, H * 0.1, (dx, 0, H * 1.14 + dz), "steel_hi", sp)
        box("pcord", (limb * 1.6, limb * 0.9, th(limb * 0.3)), (0, 0, -H * 0.1), "belt", sp)


# ---------------------------------------------------------------- camera
def camera(cell, ppm):
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = cell / ppm
    cam = bpy.data.objects.new("cam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    margin = STYLE.get("foot_margin_px", 4)
    zc = (cell / 2 - margin) / (ppm * math.cos(math.radians(30)))
    # forward vector for rotation (60, 0, 45): (-0.612, 0.612, -0.5)
    f = (-0.6124, 0.6124, -0.5)
    d = 20.0
    cam.location = (0 - f[0] * d, 0 - f[1] * d, zc - f[2] * d)
    cam.rotation_euler = (math.radians(60), 0, math.radians(45))
    return cam


# ---------------------------------------------------------------- actions
# Sheet columns (the same for every unit): 0 stand, 1..8 walk, 9..12 action (units with "action"), 13..15 dying, 16 dead.
ACTION_COL, ACTION_N = 9, 4
DIE_COL, DIE_N, DEAD_COL = 13, 3, 16
NCOLS = 17

# Key poses per motion, angles in degrees. arm: (x, y, z) rotation of the shoulder pivot (x < 0 swings forward/up),
# grip: absolute orientation of the held gear in the upper-body frame (x rotation, 0 = upright, 90 = pointing forward),
# lean: upper body forward (+) / back (-), legs: (left, right) thigh angle (< 0 forward).
ACTIONS = {
    # two-handed axe blow: wind up over the shoulder, strike forward at hip height
    "hacken": [
        {"armR": (-195, 0, 8), "armL": (-190, 0, -8), "gripR": -50, "lean": -6},
        {"armR": (-150, 0, 6), "armL": (-148, 0, -6), "gripR": 5, "lean": 2},
        {"armR": (-110, 0, 4), "armL": (-108, 0, -4), "gripR": 60, "lean": 12},
        {"armR": (-72, 0, 4), "armL": (-70, 0, -4), "gripR": 100, "lean": 22, "legs": (-12, 8)},
    ],
    # pick swing at the rock face low in front
    "abbauen": [
        {"armR": (-200, 0, 8), "armL": (-195, 0, -8), "gripR": -60, "lean": -4},
        {"armR": (-150, 0, 6), "armL": (-146, 0, -6), "gripR": 20, "lean": 8},
        {"armR": (-95, 0, 4), "armL": (-92, 0, -4), "gripR": 85, "lean": 22},
        {"armR": (-50, 0, 4), "armL": (-48, 0, -4), "gripR": 125, "lean": 34, "legs": (-18, 10)},
    ],
    # spear thrust: pull back, lunge, full thrust, recover
    "stoss": [
        {"armR": (15, 0, 0), "gripR": 84, "lean": -6, "legs": (-8, 6)},
        {"armR": (-30, 0, 0), "gripR": 88, "lean": 6, "legs": (-18, 10)},
        {"armR": (-85, 0, 0), "gripR": 92, "lean": 18, "legs": (-30, 18)},
        {"armR": (-45, 0, 0), "gripR": 90, "lean": 8, "legs": (-14, 8)},
    ],
    # sword cut from above
    "hieb": [
        {"armR": (-170, 0, 0), "gripR": -35, "lean": -6},
        {"armR": (-145, 0, 0), "gripR": 25, "lean": 2, "legs": (-10, 6)},
        {"armR": (-100, 0, 0), "gripR": 80, "lean": 14, "legs": (-22, 12)},
        {"armR": (-45, 0, 0), "gripR": 135, "lean": 20, "legs": (-24, 14)},
    ],
    # bow: nock, raise with the arrow on the string, full draw (elbow high, hand at the cheek, string pulled to the
    # hand), release (string straight again, hand flies back). "string": drawn = string from both tips to the right hand,
    # "arrow": nocked = from the string forward, drawn = from the right hand through the bow
    "schiessen": [
        {"armL": (-45, 0, 10), "armR": (-40, 0, -10), "gripL": 0, "lean": 0},
        {"armL": (-75, 0, 4), "armR": (-70, 0, -18), "gripL": 0, "lean": 0, "arrow": "nocked"},
        {"armL": (-90, 0, 0), "armR": (95, 0, 15), "elbowR": (0, -150, 0), "gripL": 0, "lean": -3, "string": "drawn", "arrow": "drawn"},
        {"armL": (-90, 0, 0), "armR": (100, 0, 35), "elbowR": (0, -60, 0), "gripL": 0, "lean": -5},
    ],
    # miller: lift a sack of grain from the floor and tip it into the hopper above the millstones
    "mahlen": [
        {"armR": (-35, 0, -12), "armL": (-35, 0, 12), "lean": 22, "legs": (-14, 8)},
        {"armR": (-85, 0, -10), "armL": (-85, 0, 10), "lean": 8, "legs": (-8, 4)},
        {"armR": (-135, 0, -8), "armL": (-135, 0, 8), "lean": -2},
        {"armR": (-160, 0, -6), "armL": (-160, 0, 6), "lean": 6},
    ],
    # baker: push the peel into the oven and pull it back out (both hands on the pole)
    "backen": [
        {"armR": (-18, 0, -6), "armL": (-40, 0, 14), "gripR": 86, "lean": -4, "legs": (-6, 4)},
        {"armR": (-42, 0, -6), "armL": (-62, 0, 14), "gripR": 88, "lean": 6, "legs": (-14, 8)},
        {"armR": (-72, 0, -6), "armL": (-88, 0, 14), "gripR": 90, "lean": 15, "legs": (-24, 12)},
        {"armR": (-48, 0, -6), "armL": (-66, 0, 14), "gripR": 89, "lean": 7, "legs": (-12, 8)},
    ],
    # building: one-handed hammer blows low in front (beam, peg, plank), the left hand steadies the work piece
    "bauen": [
        {"armR": (-165, 0, 6), "armL": (-50, 0, -12), "gripR": -70, "lean": 14, "legs": (-16, 10)},
        {"armR": (-130, 0, 4), "armL": (-50, 0, -12), "gripR": -10, "lean": 18, "legs": (-16, 10)},
        {"armR": (-85, 0, 2), "armL": (-48, 0, -12), "gripR": 55, "lean": 24, "legs": (-18, 12)},
        {"armR": (-52, 0, 2), "armL": (-46, 0, -12), "gripR": 95, "lean": 28, "legs": (-18, 12)},
    ],
    # smith: hammer blows on the anvil at hip height, the left hand holds the work piece on the anvil
    "schmieden": [
        {"armR": (-175, 0, 6), "armL": (-55, 0, -14), "gripR": -60, "lean": 2, "legs": (-10, 6)},
        {"armR": (-140, 0, 4), "armL": (-55, 0, -14), "gripR": 0, "lean": 6, "legs": (-10, 6)},
        {"armR": (-100, 0, 2), "armL": (-53, 0, -14), "gripR": 60, "lean": 10, "legs": (-12, 8)},
        {"armR": (-68, 0, 2), "armL": (-52, 0, -14), "gripR": 100, "lean": 13, "legs": (-12, 8)},
    ],
    # bowyer: stave upright in the left hand, the right hand pulls the draw knife down along it
    "schnitzen": [
        {"armL": (-55, 0, 6), "armR": (-95, 0, -14), "gripR": 90, "lean": 10, "legs": (-8, 4)},
        {"armL": (-55, 0, 6), "armR": (-80, 0, -14), "gripR": 95, "lean": 12, "legs": (-8, 4)},
        {"armL": (-55, 0, 6), "armR": (-62, 0, -14), "gripR": 100, "lean": 14, "legs": (-8, 4)},
        {"armL": (-55, 0, 6), "armR": (-46, 0, -14), "gripR": 105, "lean": 15, "legs": (-8, 4)},
    ],
    # crossbow: aim at the shoulder, loose (recoil), tip the bow down, span with the foot in the stirrup
    "armbrust": [
        {"armR": (-82, 0, -10), "armL": (-96, 0, 16), "gripR": 92, "lean": -2, "legs": (-10, 8)},
        {"armR": (-90, 0, -10), "armL": (-102, 0, 16), "gripR": 84, "lean": -7, "legs": (-10, 8)},
        {"armR": (-38, 0, -6), "armL": (-40, 0, 10), "gripR": 170, "lean": 24, "legs": (-18, 10)},
        {"armR": (-18, 0, -6), "armL": (-62, 0, 10), "gripR": 176, "lean": 30, "legs": (-22, 10)},
    ],
}
# collapse: hit, knees buckle, topple backwards, lying on the back (corpse centred on the foot point)
DYING = [
    {"tilt": -8, "shift": 0.0, "knees": 25, "legs": (0, 0), "lean": 20, "armL": (-35, 0, -10), "armR": (-30, 0, 10)},
    {"tilt": -20, "shift": -0.25, "knees": 100, "legs": (-55, -45), "lean": 12, "armL": (-60, 0, -25), "armR": (-20, 0, 25)},
    {"tilt": -58, "shift": -0.6, "knees": 55, "legs": (-45, -35), "lean": -12, "armL": (-120, 0, -30), "armR": (-105, 0, 30)},
    {"tilt": -90, "shift": -0.9, "knees": 8, "legs": (-4, 3), "lean": 0, "armL": (-20, -70, 0), "armR": (-15, 75, 0)},
]
AWAY = (-0.7071, 0.7071)  # ground direction away from the camera (world)


def rot(v):
    return Euler([math.radians(a) for a in v], "XYZ")


def set_grip(pv, side, arm_deg, grip_x):
    """Hand rotation so the held gear points at grip_x (x rotation) in the upper-body frame, whatever arm and elbow do."""
    inv = (rot(arm_deg).to_matrix() @ pv["elbow" + side].rotation_euler.to_matrix()).inverted()
    pv["hand" + side].rotation_euler = (inv @ rot((grip_x, 0, 0)).to_matrix()).to_euler("XYZ")


def ground(root):
    """Lift or lower the figure so its lowest point touches the ground (z = 0)."""
    bpy.context.view_layer.update()
    zmin = min((o.matrix_world @ v.co).z for o in bpy.data.objects if o.type == "MESH" for v in o.data.vertices)
    root.location.z -= zmin


def frame_list(unit):
    cols = list(range(9))
    if unit.get("action"):
        cols += list(range(ACTION_COL, ACTION_COL + ACTION_N))
    if unit.get("dies", True):
        cols += list(range(DIE_COL, DIE_COL + DIE_N)) + [DEAD_COL]
    return cols


def anims_of(unit, walk_frames):
    an = {"stehen": [0, 1], "gehen": [1, walk_frames]}
    if unit.get("action"):
        an[unit["action"]["anim"]] = [ACTION_COL, ACTION_N]
    if unit.get("dies", True):
        an["sterben"] = [DIE_COL, DIE_N]
        an["tot"] = [DEAD_COL, 1]
    return an


def pose_reset(root, hip, pv, base, legs, dirz):
    root.rotation_euler = (0, 0, dirz)
    root.location = (0, 0, 0)
    hip.location.z = legs
    for k, v in base.items():
        pv[k].rotation_euler = v


def pose_action(unit, pv, base, i):
    k = ACTIONS[unit["action"]["motion"]][i]
    pv["upper"].rotation_euler = (math.radians(k.get("lean", 0)), 0, 0)
    for side in ("L", "R"):
        arm = k.get("arm" + side)
        if arm is not None:
            pv["arm" + side].rotation_euler = rot(arm)
        if "elbow" + side in k:
            pv["elbow" + side].rotation_euler = rot(k["elbow" + side])
        if "grip" + side in k:
            set_grip(pv, side, arm if arm is not None else [math.degrees(a) for a in base["arm" + side]], k["grip" + side])
    lg = k.get("legs", (0, 0))
    pv["legL"].rotation_euler = (math.radians(lg[0]), 0, 0)
    pv["legR"].rotation_euler = (math.radians(lg[1]), 0, 0)
    for side, a in (("L", lg[0]), ("R", lg[1])):
        pv["ankle" + side].rotation_euler = (-math.radians(a), 0, 0)


def seg(name, a, b, t, color):
    """Thin box from world point a to world point b (drawn bow string, arrow)."""
    d = b - a
    bpy.ops.mesh.primitive_cube_add(size=1)
    o = bpy.context.active_object
    o.name = name
    o.color = C(color)
    o.location = (a + b) / 2
    o.rotation_euler = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_euler()
    o.scale = (t, t, d.length)
    return o


def bow_extras(unit, pv, i):
    """Shooting frames: drawn string from both bow tips to the right hand, the arrow. Returns the new objects."""
    k = ACTIONS[unit["action"]["motion"]][i]
    ob = bpy.data.objects
    if "bowstring" not in ob or not (k.get("string") or k.get("arrow")):
        return []
    bpy.context.view_layer.update()

    def w(n):
        return ob[n].matrix_world.translation.copy()
    tT, tB, mid, hand = w("bowtipT"), w("bowtipB"), w("bowmid"), pv["handR"].matrix_world.translation.copy()
    t = th(0) * 0.7
    out = []
    if k.get("string") == "drawn":
        ob["bowstring"].hide_render = True
        out += [seg("dstringT", tT, hand, t, "string"), seg("dstringB", tB, hand, t, "string")]
    if k.get("arrow"):
        if k["arrow"] == "drawn":
            nock = hand
            fwd = (mid - nock).normalized()
            tip = mid + fwd * 0.16
        else:
            nock = (tT + tB) / 2
            fwd = (ob["bowmid"].matrix_world.to_3x3() @ Vector((0, -1, 0))).normalized()
            tip = nock + fwd * 0.6
        out.append(seg("arrow", nock, tip, th(0) * 0.8, "wood"))
        out.append(seg("arrowtip", tip - fwd * 0.05, tip + fwd * 0.05, th(0) * 1.1, "steel_hi"))
    return out


def pose_dying(root, pv, i, dirz):
    k = DYING[i]
    root.rotation_euler = (math.radians(k["tilt"]), 0, dirz)
    # shift along the figure's own forward axis (local -y turned by the direction), plus a little away from the camera
    fwd = (math.sin(dirz), -math.cos(dirz))
    sh = k["shift"]
    away = 0.2 * i / (len(DYING) - 1)
    root.location = (-fwd[0] * sh + AWAY[0] * away, -fwd[1] * sh + AWAY[1] * away, 0)
    pv["upper"].rotation_euler = (math.radians(k["lean"]), 0, 0)
    for side in ("L", "R"):
        pv["arm" + side].rotation_euler = rot(k["arm" + side])
        pv["knee" + side].rotation_euler = (math.radians(k["knees"]), 0, 0)
    pv["legL"].rotation_euler = (math.radians(k["legs"][0]), 0, 0)
    pv["legR"].rotation_euler = (math.radians(k["legs"][1]), 0, 0)
    ground(root)


def unit_meta(key):
    u = UNITS[key]
    return {"key": key, "name": u["name"], "showcase": u.get("showcase", True), "frames": NCOLS,
            "anims": anims_of(u, STYLE.get("walk_frames", 8))}


# ---------------------------------------------------------------- main
def main():
    sc = reset()
    target = STYLE["height_px"]
    ss = STYLE.get("supersample", 4)
    cell = STYLE.get("cell_px", int(round(target * 1.75)))
    H = 1.8
    ppm = target / H
    sc.render.resolution_x = cell * ss
    sc.render.resolution_y = cell * ss
    sc.render.resolution_percentage = 100
    frames = STYLE.get("walk_frames", 6)
    if frames != 8:
        sys.exit("the sheet layout expects 8 walk frames (columns 1..8)")
    dirs = [0] if QUICK else list(range(8))
    names = [u for u in UNITS if not ONLY or u in ONLY.split(",")]
    only_cols = None
    if arg("--frames"):
        a_, b_ = (int(x) for x in arg("--frames").split("-"))
        only_cols = set(range(a_, b_ + 1))
    meta = {"cell": cell, "ss": ss, "frames": NCOLS, "dirs": [DIR_NAMES[d] for d in dirs], "units": [], "body_dy": []}
    la = math.radians(STYLE.get("leg_swing", 26))
    legs_m = STYLE["proportions"]["legs"] * H
    for f in range(NCOLS):
        s_ = 0.0 if f == 0 or f > frames else math.sin(2 * math.pi * (f - 1) / frames)
        # how far the body sinks on screen in this frame (target pixels), used to anchor dither/hatch patterns
        meta["body_dy"].append(round((legs_m - legs_m * math.cos(la * abs(s_))) * ppm * math.cos(math.radians(30)), 3))
    for key in names:
        unit = UNITS[key]
        # clear previous figure
        for o in list(bpy.data.objects):
            bpy.data.objects.remove(o, do_unlink=True)
        camera(cell, ppm)
        root, hip, pv, legs, action_only = build(unit)
        base = {k: tuple(v.rotation_euler) for k, v in pv.items()}
        hold = set(unit.get("hold", []))
        la = math.radians(STYLE.get("leg_swing", 26))
        aa = math.radians(STYLE.get("arm_swing", 22)) * unit.get("swing", 1.0)
        kb = math.radians(STYLE.get("knee_bend", 40))
        os.makedirs(os.path.join(OUT, key), exist_ok=True)
        cols = [c for c in frame_list(unit) if only_cols is None or c in only_cols]
        for d in dirs:
            dirz = math.radians(45 + d * 45)
            for f in cols:
                pose_reset(root, hip, pv, base, legs, dirz)
                is_action = ACTION_COL <= f < ACTION_COL + ACTION_N
                for n in action_only:
                    bpy.data.objects[n].hide_render = not is_action
                if "bowstring" in bpy.data.objects:
                    bpy.data.objects["bowstring"].hide_render = False
                extras = []
                if f <= frames:
                    if f == 0:
                        s, c = 0.0, 0.0
                    else:
                        ph = (f - 1) / frames
                        s = math.sin(2 * math.pi * ph)
                        c = math.cos(2 * math.pi * ph)
                    # positive leg angle = leg swings back. L moves forward while ds/dt < 0 (c < 0): bend that knee.
                    kL, kR = kb * max(0.0, -c), kb * max(0.0, c)
                    pv["legL"].rotation_euler = (base["legL"][0] + s * la, base["legL"][1], base["legL"][2])
                    pv["legR"].rotation_euler = (base["legR"][0] - s * la, base["legR"][1], base["legR"][2])
                    pv["kneeL"].rotation_euler = (kL, 0, 0)
                    pv["kneeR"].rotation_euler = (kR, 0, 0)
                    # ankles keep the feet level with the ground
                    pv["ankleL"].rotation_euler = (-(s * la + kL), 0, 0)
                    pv["ankleR"].rotation_euler = (-(-s * la + kR), 0, 0)
                    # keep the straight (stance) leg's foot on the ground
                    hip.location.z = legs * math.cos(la * abs(s))
                    if STYLE.get("quantize_hip"):
                        # body bob in whole target pixels, so dither patterns stay locked to the body
                        hip.location.z = legs - round((legs - hip.location.z) / PXM) * PXM
                    for side, sgn in (("armL", -1), ("armR", 1)):
                        amp = aa * (STYLE.get("held_swing", 0.45) if side in hold else 1.0)
                        pv[side].rotation_euler = (base[side][0] + sgn * s * amp, base[side][1], base[side][2])
                elif f < ACTION_COL + ACTION_N:
                    pose_action(unit, pv, base, f - ACTION_COL)
                    extras = bow_extras(unit, pv, f - ACTION_COL)
                else:
                    pose_dying(root, pv, f - DIE_COL, dirz)
                base_path = os.path.join(OUT, key, "d%d_f%d" % (d, f))
                sh = sc.display.shading
                sh.light = "FLAT"
                sc.render.filepath = base_path + ".png"
                bpy.ops.render.render(write_still=True)
                cols_ = {o.name: tuple(o.color) for o in bpy.data.objects if o.type == "MESH"}
                for o in bpy.data.objects:
                    if o.type == "MESH":
                        o.color = (0.8, 0.8, 0.8, 1)
                sh.light = "STUDIO"
                cav = STYLE.get("cavity")
                if cav:
                    # contact darkening in folds and gaps, light pass only (the colour pass must stay flat)
                    sh.show_cavity = True
                    sh.cavity_type = "WORLD"
                    sh.cavity_valley_factor = cav
                    sh.cavity_ridge_factor = 0.0
                sc.render.filepath = base_path + "_l.png"
                bpy.ops.render.render(write_still=True)
                sh.show_cavity = False
                for o in bpy.data.objects:
                    if o.type == "MESH":
                        o.color = cols_[o.name]
                for o in extras:
                    bpy.data.objects.remove(o, do_unlink=True)
        meta["units"].append(unit_meta(key))
        print("rendered", key, flush=True)
    rj = os.path.join(OUT, "render.json")
    if ONLY and os.path.exists(rj):
        # partial render: keep the other units listed, in units.json order
        old = json.load(open(rj))
        keys = {u["key"] for u in old.get("units", [])} | {u["key"] for u in meta["units"]}
        meta["units"] = [unit_meta(k) for k in UNITS if k in keys]
        if QUICK:
            meta["dirs"] = old.get("dirs", meta["dirs"])
    json.dump(meta, open(rj, "w"), indent=1, ensure_ascii=False)


main()
