# Militärwirtschaft (ADR 0014): Erzmine, Schmelzhütte, Waffenschmiede, Bognerei, Rüstungsschmiede, Erzbrocken und
# die Lagerstapel Erz, Armbrüste, Piken, Rüstungen. Wird von buildings.py im selben Namensraum ausgeführt (exec), nutzt
# dessen Bausteine (MB, masonry, timber_frame, gable_roof, cut_house …) und hängt sich an BUILD, SITE_RECTS,
# SITE_KIND und SCAFFOLDS an. Seeds 500-599 (buildings/buildings.json).
#
# Werkstätten 3 x 2 (Waffenschmiede, Bognerei, Rüstungsschmiede, Schmelzhütte): Haus im Westen und hinten, vorn ein
# Streifen für den Eingangspuffer, im Osten einer für den Ausgabestapel (src/data/ruestung.ts, production.inputPiles
# [-1.05, -0.78] und [1.05, -0.78], outputPiles [1.05, 0.45] in Tiles). Tür mittig in der Vorderwand (door [0, -1.5]).

WS_X0, WS_X1, WS_Y0, WS_Y1 = -3.6, 1.62, -1.35, 2.3
WS_BASE, WS_EAVE = 0.35, 2.5
WS_DOOR = (-0.48, 0.48, 2.0)
WS_FORGE = (-3.35, -2.25, 1.05, 2.15)          # Esse in der Nordwestecke (innen), Rauchabzug darüber
WS_CHIMNEY = (-3.05, -2.45, 1.3, 1.9, 5.0)     # x0, x1, y0, y1, Oberkante (src/render/smoke.ts CHIMNEYS)
SM_STACK = (0.15, 1.35, 0.55, 1.75)            # Schmelzofen an der Ostseite (innen), Schlot durchs Dach
SM_TOP = 5.4
SM_DOOR_X = -1.2                               # Tür der Schmelzhütte (door [-0.5, -1.5] in den Daten)


def anvil(mb, x, y, z=0.0, rz=0.0):
    """Anvil on a wooden block: horn towards +x (local)."""
    with mb.at((x, y, z), rz):
        mb.cyl("wood", (0, 0, 0.27), 0.25, 0.54, n=9)
        mb.cyl("wood_hi", (0, 0, 0.545), 0.23, 0.02, n=9)
        mb.bx("iron", -0.16, 0.16, -0.11, 0.11, 0.55, 0.68)
        mb.bx("iron", -0.26, 0.24, -0.13, 0.13, 0.68, 0.82)
        mb.cyl("iron", (0.37, 0, 0.77), 0.09, 0.26, n=6, rot=(0, 90, 0), r2=0.0)
        mb.bx("steel", -0.25, 0.23, -0.12, 0.12, 0.82, 0.84)


def tongs_rack(mb, x, y, z, along="x"):
    """A rail with hanging tongs and hammers (on a full wall)."""
    if along == "x":
        mb.bx("timber", x - 0.6, x + 0.6, y - 0.04, y + 0.04, z, z + 0.06)
        for q in range(4):
            xx = x - 0.45 + q * 0.3
            mb.bx("iron", xx - 0.015, xx + 0.015, y - 0.06, y - 0.03, z - 0.55, z)
            mb.bx("iron", xx - 0.05, xx + 0.05, y - 0.07, y - 0.03, z - 0.6, z - 0.52)
    else:
        mb.bx("timber", x - 0.04, x + 0.04, y - 0.6, y + 0.6, z, z + 0.06)
        for q in range(4):
            yy = y - 0.45 + q * 0.3
            mb.bx("iron", x - 0.06, x - 0.03, yy - 0.015, yy + 0.015, z - 0.55, z)
            mb.bx("iron", x - 0.07, x - 0.03, yy - 0.05, yy + 0.05, z - 0.6, z - 0.52)


def forge(mb, glow=True):
    """Brick forge in the north-west corner: hearth with coals, a hood and the flue up to the chimney."""
    x0, x1, y0, y1 = WS_FORGE
    masonry(mb, x0, x1, y0, y1, 0.04, 0.85, row=0.21)
    mb.bx("coal", x0 + 0.15, x1 - 0.15, y0 + 0.15, y1 - 0.2, 0.85, 0.9)
    if glow:
        mb.blob("ember", ((x0 + x1) / 2, (y0 + y1) / 2 - 0.05, 0.9), (0.32, 0.25, 0.07), seg=8, rings=4, jitter=0.15)
    # hood and flue
    mb.bx("stone2", x0 + 0.05, x1 - 0.05, y0 + 0.3, y1, 1.75, 1.95)
    cx0, cx1, cy0, cy1, _ = WS_CHIMNEY
    masonry(mb, cx0, cx1, cy0, cy1, 1.95, WS_EAVE, row=0.27, top=True)
    # bellows beside the hearth
    with mb.at((x1 + 0.35, y1 - 0.45, 0.6), 0):
        mb.box("leather", (0, 0, 0), (0.5, 0.75, 0.22), rot=(0, 0, 0))
        mb.box("wood", (0, 0, 0.13), (0.55, 0.8, 0.04))
        mb.box("wood", (0, 0.55, 0.12), (0.06, 0.4, 0.04))
    mb.box("wood", (x1 + 0.35, y1 - 0.45, 0.3), (0.08, 0.08, 0.6))


def quench_tub(mb, x, y):
    mb.cyl("barrel", (x, y, 0.22), 0.36, 0.44, n=10)
    mb.cyl("iron", (x, y, 0.4), 0.37, 0.04, n=10)
    mb.cyl("window", (x, y, 0.445), 0.31, 0.01, n=10)


def ws_house(mb, roof="roof_tile", stone=False, chimney=True):
    """House body of a workshop: plinth, half-timbered (or stone) walls, roof with the ridge along x, door, windows."""
    x0, x1, y0, y1 = WS_X0, WS_X1, WS_Y0, WS_Y1
    masonry(mb, x0 - 0.05, x1 + 0.05, y0 - 0.05, y1 + 0.05, 0, WS_BASE, row=0.175, top=True)
    if stone:
        masonry(mb, x0, x1, y0, y1, WS_BASE, WS_EAVE, row=0.3, top=False)
    else:
        timber_frame(mb, x0, x1, y0, y1, WS_BASE, WS_EAVE, spacing=1.05)
    cy = (y0 + y1) / 2
    with mb.at(((x0 + x1) / 2, cy, 0)):
        gable_roof(mb, x1 - x0, (y1 - y0) / 2 + 0.42, WS_EAVE, 1.85, roof, ov=0.3, row=0.32 if roof != "thatch" else 0.42,
                   thick=0.08 if roof != "thatch" else 0.2, gable="plaster" if not stone else "stone2",
                   ridge="roof_tile" if roof == "roof_tile" else ("thatch_dk" if roof == "thatch" else "timber"),
                   edge="thatch_dk" if roof == "thatch" else None)
    if chimney:
        cx0, cx1, cy0, cy1, ctop = WS_CHIMNEY
        masonry(mb, cx0, cx1, cy0, cy1, WS_EAVE - 0.2, ctop, row=0.27)
        mb.bx("mortar", cx0 + 0.07, cx1 - 0.07, cy0 + 0.07, cy1 - 0.07, ctop - 0.02, ctop + 0.02)
        mb.bx("stone_top", cx0 - 0.06, cx1 + 0.06, cy0 - 0.06, cy1 + 0.06, ctop - 0.2, ctop - 0.08)
    a, b, top = WS_DOOR
    door(mb, "s", ((a + b) / 2, y0, 0.0), w=b - a, h=top)
    mb.bx("stone_top", a - 0.15, b + 0.15, y0 - 0.42, y0 - 0.05, 0, 0.12)
    for wx in (-2.4,):
        window(mb, "s", (wx, y0, 1.25), w=0.6, h=0.5)
    window(mb, "e", (x1, 0.6, 1.3), w=0.5, h=0.5)


def ws_cut(mb, stone=False, floor="stone", door_x=0.0):
    """Cutaway shell of a workshop: low walls towards the camera, floor of flags or planks (dirt: none)."""
    x0, x1, y0, y1 = WS_X0, WS_X1, WS_Y0, WS_Y1
    th = 0.15
    a, b, top = WS_DOOR
    cut_house(mb, x0, x1, y0, y1, WS_BASE, WS_EAVE, th=th, gaps={"s": (a + door_x, b + door_x, top)}, posts=1.05, wall="stone" if stone else "plaster")
    if floor == "planks":
        plank_floor(mb, x0 + th, x1 - th, y0 + th, y1 - th, 0.0, 0.04, pitch=0.36, along="x")
    elif floor == "stone":
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
    return th


def sign_bracket(mb, x, y0, z=2.0):
    """Iron bracket with a hanging sign board beside the door; returns the board centre."""
    mb.bx("iron", x - 0.02, x + 0.02, y0 - 0.75, y0, z + 0.18, z + 0.22)
    mb.bx("wood_hi", x - 0.15, x + 0.15, y0 - 0.72, y0 - 0.68, z - 0.38, z + 0.12)
    return (x, y0 - 0.76, z - 0.13)


# ---------------------------------------------------------------- Waffenschmiede
def b_waffenschmiede(mb, var):
    """Weapon smithy 3 x 2: stone plinth, half-timbering, tiled roof with the forge chimney at the north-west end, a sign
    with crossed blades, a grindstone and a rack of finished blades outside."""
    S0, S1 = 3 * T / 2, T
    ground(mb, "dirt", -S0 + 0.05, S0 - 0.05, -S1 + 0.05, S1 - 0.05, ragged=0.08)
    ws_house(mb, roof="roof_tile")
    cx, cy, cz = sign_bracket(mb, -0.85, WS_Y0)
    for a in (-35, 35):
        mb.box("steel_hi", (cx, cy, cz), (0.05, 0.03, 0.45), rot=(0, a, 0))
    # grindstone on a frame at the west gable
    with mb.at((WS_X0 - 0.05, 0.9, 0)):
        for sy in (-0.25, 0.25):
            mb.bx("wood", -0.05, 0.05, sy - 0.04, sy + 0.04, 0, 0.75)
        mb.cyl("stone2", (0, 0, 0.75), 0.36, 0.14, n=12, rot=(90, 0, 0))
        mb.bx("wood", -0.04, 0.04, -0.42, 0.42, 0.72, 0.78)
    quench_tub(mb, WS_X1 + 0.55, 2.0)


def b_waffenschmiede_innen(mb, var):
    """Weapon smithy cutaway: forge with glowing coals and bellows in the north-west corner, the anvil in the middle (the
    smith stands west of it and faces +x, production.spot/face in src/data), tongs and hammers on the back wall, a sword
    rack and a crate of blanks."""
    S0, S1 = 3 * T / 2, T
    ground(mb, "dirt", -S0 + 0.05, S0 - 0.05, -S1 + 0.05, S1 - 0.05, ragged=0.08)
    mb.rnd = random.Random(1000 * mb.seed + 77)
    th = ws_cut(mb)
    d = mb.view
    forge(mb)
    anvil(mb, -0.55, 0.46)
    quench_tub(mb, 0.55, 1.45)
    if not low_side("n", d):
        tongs_rack(mb, -0.6, WS_Y1 - th - 0.05, 1.9)
    # sword rack against the east wall, blades point down
    if not low_side("e", d):
        xr = WS_X1 - th - 0.25
        mb.bx("wood", xr - 0.08, xr + 0.08, -0.6, 0.9, 0.04, 0.12)
        mb.bx("wood", xr - 0.05, xr + 0.05, -0.6, 0.9, 0.8, 0.88)
        for q in range(5):
            yy = -0.45 + q * 0.3
            mb.bx("steel_hi", xr - 0.012, xr + 0.012, yy - 0.035, yy + 0.035, 0.12, 0.95)
            mb.bx("steel", xr - 0.03, xr + 0.03, yy - 0.12, yy + 0.12, 0.95, 1.0)
            mb.bx("leather", xr - 0.025, xr + 0.025, yy - 0.025, yy + 0.025, 1.0, 1.14)
    crate(mb, -2.9, -0.6, 0.04, s=0.5, rz=8)
    for q in range(3):
        mb.bx("iron", -2.75 + q * 0.12 - 0.04, -2.75 + q * 0.12 + 0.04, -0.85, -0.35, 0.56, 0.6)


# ---------------------------------------------------------------- Rüstungsschmiede
def mail_stand(mb, x, y, z=0.0, rz=0.0, helmet=True):
    """T-stand with a mail shirt and a kettle hat."""
    with mb.at((x, y, z), rz):
        mb.bx("wood", -0.25, 0.25, -0.18, 0.18, 0, 0.06)
        mb.bx("wood", -0.04, 0.04, -0.04, 0.04, 0.06, 1.55)
        mb.bx("wood", -0.32, 0.32, -0.04, 0.04, 1.35, 1.42)
        mb.bx("steel", -0.27, 0.27, -0.13, 0.13, 0.78, 1.38)
        mb.bx("iron", -0.25, 0.25, -0.14, 0.14, 0.75, 0.8)
        for k in (-1, 1):
            mb.bx("steel", k * 0.27 - 0.08 * (k < 0), k * 0.27 + 0.08 * (k > 0), -0.12, 0.12, 1.12, 1.38)
        if helmet:
            mb.cyl("steel_hi", (0, 0, 1.6), 0.24, 0.03, n=10)
            mb.blob("steel_hi", (0, 0, 1.62), (0.15, 0.15, 0.13), seg=8, rings=4, jitter=0.02)


def b_ruestungsschmiede(mb, var):
    """Armourer 3 x 2: stone ground floor, timber gable, shingle roof, forge chimney; a mail shirt on a stand beside
    the door as the house sign, a quench tub and a crate of rings."""
    S0, S1 = 3 * T / 2, T
    ground(mb, "dirt", -S0 + 0.05, S0 - 0.05, -S1 + 0.05, S1 - 0.05, ragged=0.08)
    ws_house(mb, roof="shingle", stone=True)
    mail_stand(mb, -1.55, WS_Y0 - 0.45)
    quench_tub(mb, WS_X0 + 0.05, 1.7)
    crate(mb, WS_X1 + 0.5, 2.0, 0, s=0.45, rz=-10)


def b_ruestungsschmiede_innen(mb, var):
    """Armourer cutaway: forge and bellows in the north-west corner, anvil in the middle (the armourer stands west of it),
    mail shirts and a helmet on stands at the east wall, a bench with rings and a coif."""
    S0, S1 = 3 * T / 2, T
    ground(mb, "dirt", -S0 + 0.05, S0 - 0.05, -S1 + 0.05, S1 - 0.05, ragged=0.08)
    mb.rnd = random.Random(1000 * mb.seed + 77)
    th = ws_cut(mb, stone=True)
    d = mb.view
    forge(mb)
    anvil(mb, -0.55, 0.46)
    mail_stand(mb, 0.95, 1.55, 0.04)
    mail_stand(mb, 0.95, 0.35, 0.04, helmet=False)
    if not low_side("n", d):
        tongs_rack(mb, -0.6, WS_Y1 - th - 0.05, 1.9)
    mb.bx("wood_hi", -3.15, -1.95, -0.95, -0.45, 0.72, 0.78)
    for (lx, ly) in ((-3.05, -0.88), (-2.05, -0.88), (-3.05, -0.52), (-2.05, -0.52)):
        mb.bx("wood", lx - 0.04, lx + 0.04, ly - 0.04, ly + 0.04, 0.04, 0.72)
    mb.blob("steel", (-2.55, -0.7, 0.8), (0.28, 0.16, 0.04), seg=8, rings=3, jitter=0.1)
    mb.blob("iron", (-2.25, -0.65, 0.8), (0.1, 0.1, 0.05), seg=6, rings=3, jitter=0.1)


# ---------------------------------------------------------------- Bognerei
def bow_rack(mb, x, y, n, along="x"):
    """A rail with n strung bows hanging from it, facing the camera side."""
    if along == "x":
        mb.bx("wood", x - 0.7, x + 0.7, y - 0.04, y + 0.04, 2.0, 2.06)
    else:
        mb.bx("wood", x - 0.04, x + 0.04, y - 0.7, y + 0.7, 2.0, 2.06)
    for q in range(n):
        off = -0.55 + q * (1.1 / max(1, n - 1))
        px, py = (x + off, y) if along == "x" else (x, y + off)
        with mb.at((px, py, 1.25), 0 if along == "x" else 90):
            for i, (z, rx) in enumerate(((0.36, 16), (0, 0), (-0.36, -16))):
                mb.box("bow", (0, -0.08 if i == 1 else -0.06, z * 1.05), (0.05, 0.06, 0.42), rot=(rx, 0, 0))
            mb.box("string", (0, 0.03, 0), (0.02, 0.02, 1.1))


def b_bognerei(mb, var):
    """Bowyer 3 x 2: half-timbered workshop with a thatched roof; at the west gable a rack of bow staves drying in the air,
    a chopping block with shavings, a bundle of shafts by the door."""
    S0, S1 = 3 * T / 2, T
    ground(mb, "dirt", -S0 + 0.05, S0 - 0.05, -S1 + 0.05, S1 - 0.05, ragged=0.08)
    ws_house(mb, roof="thatch", chimney=False)
    # stave rack at the west gable: two posts, a rail, staves leaning against it
    with mb.at((WS_X0 - 0.12, 0.5, 0)):
        for sy in (-0.9, 0.9):
            mb.bx("timber", -0.06, 0.06, sy - 0.06, sy + 0.06, 0, 1.7)
        mb.bx("timber", -0.05, 0.05, -1.0, 1.0, 1.55, 1.65)
        for q in range(7):
            yy = -0.75 + q * 0.25
            mb.box("bow", (-0.18, yy, 0.82), (0.05, 0.06, 1.7), rot=(0, -12, 0))
    cx, cy, cz = sign_bracket(mb, -0.85, WS_Y0)
    with mb.at((cx, cy, cz)):
        for i, (z, rx) in enumerate(((0.16, 16), (0, 0), (-0.16, -16))):
            mb.box("bow", (0, -0.03 if i == 1 else -0.02, z * 1.05), (0.04, 0.04, 0.2), rot=(rx, 0, 0))
    # shavings and a block
    mb.cyl("wood", (WS_X1 + 0.55, 1.9, 0.22), 0.25, 0.44, n=9)
    for q in range(6):
        a_ = q * 60 + 15
        mb.box("wood_hi", (WS_X1 + 0.55 + 0.45 * math.cos(math.radians(a_)), 1.9 + 0.45 * math.sin(math.radians(a_)), 0.03), (0.22, 0.05, 0.03), rot=(0, 0, a_))


def b_bognerei_innen(mb, var):
    """Bowyer cutaway: plank floor, the work bench (shaving horse) in the middle where the bowyer sits facing +x, bows
    hanging on the back wall, staves and a crossbow stock on a table, a bundle of spear shafts in the corner."""
    S0, S1 = 3 * T / 2, T
    ground(mb, "dirt", -S0 + 0.05, S0 - 0.05, -S1 + 0.05, S1 - 0.05, ragged=0.08)
    mb.rnd = random.Random(1000 * mb.seed + 77)
    th = ws_cut(mb, floor="planks")
    d = mb.view
    # shaving horse: bench with a clamp head, a stave clamped on it
    with mb.at((-0.35, 0.46, 0.04)):
        mb.bx("wood", -0.75, 0.75, -0.14, 0.14, 0.42, 0.52)
        for lx in (-0.6, 0.6):
            mb.bx("wood", lx - 0.05, lx + 0.05, -0.12, 0.12, 0, 0.42)
        mb.bx("wood_hi", 0.2, 0.6, -0.16, 0.16, 0.52, 0.72)
        mb.box("bow", (0.55, 0, 0.78), (1.1, 0.05, 0.05))
    if not low_side("n", d):
        bow_rack(mb, -1.6, WS_Y1 - th - 0.08, 5)
    # table with a crossbow stock and bows
    mb.bx("wood_hi", -3.15, -2.0, -0.95, -0.4, 0.75, 0.81)
    for (lx, ly) in ((-3.05, -0.88), (-2.1, -0.88), (-3.05, -0.47), (-2.1, -0.47)):
        mb.bx("wood", lx - 0.04, lx + 0.04, ly - 0.04, ly + 0.04, 0.04, 0.75)
    mb.bx("wood_hi", -2.95, -2.2, -0.72, -0.62, 0.81, 0.87)
    mb.bx("steel_hi", -2.4, -2.36, -0.95, -0.4, 0.84, 0.88)
    # bundle of shafts in the corner
    for q in range(6):
        a_ = q * 60
        mb.box("wood_hi", (1.15 + 0.08 * math.cos(math.radians(a_)), 1.75 + 0.08 * math.sin(math.radians(a_)), 1.1), (0.04, 0.04, 2.1), rot=(4, -4, 0))
    mb.cyl("rope", (1.15, 1.75, 0.9), 0.15, 0.06, n=8)


# ---------------------------------------------------------------- Schmelzhütte
def smelt_glow(mb, var, x0, x1, y, z0, z1):
    """Glowing tap hole of the furnace towards -y: cold (var 0) or glowing in three steps (1-3, the work animation)."""
    mb.bx("coal", x0, x1, y - 0.03, y + 0.02, z0, z1)
    if var:
        k = [0, 0.55, 0.85, 1.0][var]
        w, h = (x1 - x0) * k, (z1 - z0) * k
        cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
        mb.bx("ember", cx - w / 2, cx + w / 2, y - 0.05, y, cz - h / 2, cz + h / 2)


def smelt_furnace(mb, var, inside=False):
    """Bloomery furnace at the east end: clay and stone shaft, glowing tap hole at the south, stack through the roof."""
    x0, x1, y0, y1 = SM_STACK
    masonry(mb, x0, x1, y0, y1, 0.0, 1.3, row=0.26)
    mb.cyl("clay", ((x0 + x1) / 2, (y0 + y1) / 2, 2.0), 0.55, 1.4, n=10, r2=0.4)
    smelt_glow(mb, var, -0.25 + (x0 + x1) / 2, 0.25 + (x0 + x1) / 2, y0, 0.25, 0.75)
    if inside:
        return
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    masonry(mb, cx - 0.35, cx + 0.35, cy - 0.35, cy + 0.35, WS_EAVE, SM_TOP, row=0.27)
    mb.bx("coal", cx - 0.26, cx + 0.26, cy - 0.26, cy + 0.26, SM_TOP - 0.02, SM_TOP + 0.02)
    if var:
        mb.bx("ember", cx - 0.18 - 0.03 * var, cx + 0.18 + 0.03 * var, cy - 0.18 - 0.03 * var, cy + 0.18 + 0.03 * var, SM_TOP + 0.02, SM_TOP + 0.04)


def b_schmelzhuette(mb, var):
    """Smelting hut 3 x 2: rough stone walls under a shingle roof, the bloomery stack rising through the roof at the east
    end, its tap hole glowing through a wide opening in the south wall while iron is smelted (variants 1-3, work
    animation; variant 0 = cold). Charcoal heap and slag outside."""
    S0, S1 = 3 * T / 2, T
    ground(mb, "dirt", -S0 + 0.05, S0 - 0.05, -S1 + 0.05, S1 - 0.05, ragged=0.08)
    x0, x1, y0, y1 = WS_X0, WS_X1, WS_Y0, WS_Y1
    masonry(mb, x0 - 0.05, x1 + 0.05, y0 - 0.05, y1 + 0.05, 0, WS_BASE, row=0.175, top=True)
    masonry(mb, x0, x1, y0, y1, WS_BASE, WS_EAVE, row=0.3, top=False)
    cy = (y0 + y1) / 2
    with mb.at(((x0 + x1) / 2, cy, 0)):
        gable_roof(mb, x1 - x0, (y1 - y0) / 2 + 0.42, WS_EAVE, 1.7, "shingle", ov=0.3, row=0.3, thick=0.07, gable="stone2", ridge="timber")
    smelt_furnace(mb, var)
    # opening in the south wall in front of the furnace: dark recess with the glowing tap hole
    sx0, sx1, _, _ = SM_STACK
    mb.bx("coal", sx0 - 0.05, sx1 + 0.05, y0 - 0.04, y0 + 0.01, 0.05, 1.25)
    mb.bx("timber", sx0 - 0.15, sx1 + 0.15, y0 - 0.08, y0, 1.25, 1.4)
    smelt_glow(mb, var, (sx0 + sx1) / 2 - 0.25, (sx0 + sx1) / 2 + 0.25, y0 - 0.05, 0.25, 0.75)
    a, b, top = WS_DOOR
    door(mb, "s", (SM_DOOR_X, y0, 0.0), w=b - a, h=top)
    mb.bx("stone_top", SM_DOOR_X - 0.6, SM_DOOR_X + 0.6, y0 - 0.42, y0 - 0.05, 0, 0.12)
    # charcoal heap at the west gable, slag by the east wall
    mb.blob("coal", (x0 + 0.1, 1.2, 0.2), (0.55, 0.7, 0.35), seg=8, rings=5, jitter=0.2)
    for q in range(5):
        mb.blob("rock_dk", (x1 + 0.45 + 0.2 * math.cos(q * 1.3), 2.0 + 0.2 * math.sin(q * 1.3), 0.07), (0.14, 0.12, 0.09), seg=5, rings=3, jitter=0.3)


def b_schmelzhuette_innen(mb, var):
    """Smelting hut cutaway: the furnace with its glowing tap hole at the east end, the smelter at the bellows west of it
    (facing +x), baskets of ore, a charcoal heap and a raw bloom on a block."""
    S0, S1 = 3 * T / 2, T
    ground(mb, "dirt", -S0 + 0.05, S0 - 0.05, -S1 + 0.05, S1 - 0.05, ragged=0.08)
    mb.rnd = random.Random(1000 * mb.seed + 77)
    th = ws_cut(mb, stone=True, floor="dirt", door_x=SM_DOOR_X)
    smelt_furnace(mb, 2, inside=True)
    # big bellows west of the furnace
    with mb.at((-0.35, 1.15, 0.0)):
        mb.box("leather", (0, 0, 0.45), (0.6, 0.9, 0.3))
        mb.box("wood", (0, 0, 0.62), (0.65, 0.95, 0.05))
        mb.box("wood", (0, -0.6, 0.62), (0.06, 0.35, 0.04))
        mb.bx("wood", -0.3, 0.3, -0.45, 0.45, 0.0, 0.3)
    mb.blob("coal", (-2.8, 1.5, 0.15), (0.6, 0.55, 0.3), seg=8, rings=5, jitter=0.2)
    for (bx_, by_) in ((-2.6, -0.65), (-2.0, -0.8)):
        mb.cyl("bow", (bx_, by_, 0.22), 0.26, 0.4, n=10)
        mb.blob("ore", (bx_, by_, 0.42), (0.22, 0.22, 0.08), seg=7, rings=4, jitter=0.25)
    mb.cyl("wood", (-1.3, -0.65, 0.25), 0.25, 0.5, n=9)
    mb.blob("iron", (-1.3, -0.65, 0.55), (0.16, 0.14, 0.09), seg=6, rings=4, jitter=0.25)


# ---------------------------------------------------------------- Erzmine
def ore_vein(mb, x, y, z, s=1.0):
    """A few rust-red ore lumps on a rock surface."""
    r = mb.rnd
    for q in range(3):
        mb.blob("ore" if q % 2 else "ore_hi", (x + r.uniform(-0.2, 0.2) * s, y + r.uniform(-0.15, 0.15) * s, z + r.uniform(-0.1, 0.1) * s),
                (0.13 * s, 0.11 * s, 0.09 * s), seg=5, rings=3, jitter=0.3)


def ore_heap(mb, x, y, level):
    """Heap of ore lumps on the yard (level 0-4)."""
    r = random.Random(1000 * mb.seed + 5)
    lumps = [(r.uniform(-0.55, 0.55), r.uniform(-0.5, 0.5), r.uniform(0.11, 0.17), r.random()) for _ in range(40)]
    n = [0, 10, 20, 30, 40][level]
    for i, (dx, dy, rr, c) in enumerate(lumps[:n]):
        k = i / 40
        h = (1 - (dx * dx + dy * dy) / 0.6) * 0.2 + k * 0.45
        mb.blob("ore" if c < 0.45 else ("ore_hi" if c < 0.7 else "rock_dk"), (x + dx * (1 - 0.5 * k), y + dy * (1 - 0.5 * k), max(rr * 0.6, h)),
                (rr, rr * 0.9, rr * 0.75), seg=5, rings=3, jitter=0.25)


def b_erzmine(mb, var):
    """Ore mine 3 x 3: a rocky mound at the back with rust-red ore veins and a timbered adit (dark opening) leading into
    it, a windlass over a shaft, rails with an ore cart out of the adit, a lean-to for tools; the ore heap in the front
    right corner grows with the yard (variants 0-2)."""
    S = 3 * T / 2
    ground(mb, "gravel", -S + 0.1, S - 0.1, -S + 0.1, S - 0.1, ragged=0.3)
    r = mb.rnd
    for i in range(22):
        x = -S + 0.9 + i * (2 * S - 1.8) / 21 + r.uniform(-0.25, 0.25)
        y = r.uniform(1.4, S - 0.9)
        rx = min(r.uniform(0.6, 0.95), S - abs(x) - 0.12)
        ry = min(r.uniform(0.55, 0.85), S - y - 0.12)
        z = r.uniform(0.7, 1.3)
        mb.blob("rock" if i % 3 else "rock_dk", (x, y, z), (rx, ry, r.uniform(0.8, 1.05)), seg=7, rings=5, jitter=0.2)
        if i % 4 == 1:
            ore_vein(mb, x, y - ry * 0.7, z + 0.2)
    for i in range(6):
        x = r.uniform(-S + 1.0, S - 1.0)
        y = r.uniform(2.0, S - 1.0)
        mb.blob("rock_dk" if i % 2 else "rock", (x, y, r.uniform(1.6, 1.9)), (0.45, 0.42, 0.38), seg=6, rings=4, jitter=0.25)
    # adit: timber frame (two posts and a cap) in a cut face, dark opening behind
    ax, ay = -0.9, 1.05
    mb.bx("rock_cut", ax - 1.4, ax + 1.4, ay - 0.1, ay + 0.6, 0, 2.3)
    mb.bx("coal", ax - 0.62, ax + 0.62, ay - 0.13, ay - 0.08, 0, 1.75)
    for sx in (-0.72, 0.72):
        mb.bx("timber", ax + sx - 0.1, ax + sx + 0.1, ay - 0.3, ay - 0.1, 0, 1.85)
    mb.bx("timber", ax - 0.9, ax + 0.9, ay - 0.32, ay - 0.08, 1.8, 2.0)
    ore_vein(mb, ax + 1.0, ay - 0.15, 1.5)
    ore_vein(mb, ax - 1.1, ay - 0.15, 0.6)
    # rails and an ore cart out of the adit
    for sx in (-0.25, 0.25):
        mb.bx("iron", ax + sx - 0.03, ax + sx + 0.03, -1.6, ay - 0.1, 0.06, 0.1)
    for q in range(7):
        yy = -1.5 + q * 0.4
        mb.bx("wood", ax - 0.42, ax + 0.42, yy - 0.06, yy + 0.06, 0.0, 0.06)
    with mb.at((ax, -0.55, 0.1)):
        mb.bx("wood", -0.38, 0.38, -0.5, 0.5, 0.18, 0.75)
        mb.bx("iron", -0.4, 0.4, -0.52, 0.52, 0.7, 0.76)
        for (wx, wy) in ((-0.3, -0.33), (0.3, -0.33), (-0.3, 0.33), (0.3, 0.33)):
            mb.cyl("iron", (wx, wy, 0.13), 0.12, 0.06, n=8, rot=(0, 90, 0))
        if var:
            for q in range(5):
                mb.blob("ore" if q % 2 else "ore_hi", (r.uniform(-0.2, 0.2), r.uniform(-0.3, 0.3), 0.78), (0.15, 0.13, 0.1), seg=5, rings=3, jitter=0.3)
    # windlass over a small shaft at the east side
    wx, wy = 1.75, 0.35
    mb.bx("coal", wx - 0.45, wx + 0.45, wy - 0.45, wy + 0.45, 0.0, 0.03)
    mb.bx("timber", wx - 0.55, wx + 0.55, wy - 0.55, wy + 0.55, 0.0, 0.18)
    mb.bx("coal", wx - 0.4, wx + 0.4, wy - 0.4, wy + 0.4, 0.0, 0.19)
    for sx in (-0.55, 0.55):
        mb.bx("timber", wx + sx - 0.07, wx + sx + 0.07, wy - 0.07, wy + 0.07, 0.18, 1.3)
    mb.cyl("log", (wx, wy, 1.2), 0.13, 1.2, n=8, rot=(0, 90, 0))
    mb.cyl("rope", (wx + 0.1, wy, 1.2), 0.15, 0.3, n=8, rot=(0, 90, 0))
    mb.box("rope", (wx + 0.1, wy - 0.1, 0.7), (0.025, 0.025, 1.0))
    mb.box("wood", (wx + 0.66, wy, 1.05), (0.06, 0.06, 0.4), rot=(30, 0, 0))
    # lean-to with picks
    for (x, y, h) in ((-3.25, -3.2, 2.0), (-2.0, -3.2, 2.0), (-3.25, -2.1, 2.4), (-2.0, -2.1, 2.4)):
        mb.box("wood", (x, y, h / 2), (0.12, 0.12, h))
    mb.box("shingle", (-2.62, -2.65, 2.27), (1.75, 1.55, 0.08), rot=(-13, 0, 0))
    for q in range(2):
        with mb.at((-3.0 + q * 0.5, -2.2, 0), 10):
            mb.box("wood_hi", (0, 0, 0.6), (0.05, 0.05, 1.2), rot=(12, 0, 0))
            mb.box("steel", (0, -0.12, 1.15), (0.06, 0.65, 0.07), rot=(12, 0, 0))
    # output pile: ore heap in the front right corner
    ore_heap(mb, 2.35, -2.35, [0, 2, 4][var])


def b_fels_erz(mb, var):
    """Ore boulder (Felsen-Art Erz): a reddish-dark rock with rust-red ore lumps; variants from untouched to almost mined
    out, like fels."""
    r = mb.rnd
    s = [1.0, 0.76, 0.54, 0.3][var]
    parts = [((0, 0.05), (0.92, 0.85, 0.85), "rock_dk"), ((-0.45, 0.35), (0.6, 0.55, 0.62), "rock"),
             ((0.5, 0.4), (0.55, 0.5, 0.55), "rock_dk"), ((0.15, -0.45), (0.55, 0.5, 0.5), "rock"),
             ((-0.2, 0.15), (0.5, 0.5, 0.45), "rock_dk")]
    jit = [(r.uniform(-0.05, 0.05), r.uniform(-0.05, 0.05), r.uniform(0.9, 1.1)) for _ in parts]
    veins = [(q * 2 * math.pi / 9 + r.uniform(-0.2, 0.2), 0.88 if q % 3 else 0.35) for q in range(9)]
    rubble = [(r.uniform(-1.0, 1.0), r.uniform(-1.0, 1.0), r.uniform(0.08, 0.16)) for _ in range(14)]
    zs = [0.0, 0.0, 0.0, 0.0, 0.75]
    for i, ((x, y), (rx, ry, rz), m) in enumerate(parts):
        if var >= 3 and i >= 3:
            continue
        jx, jy, k = jit[i]
        rz_ = rz * s * k
        mb.blob(m, ((x + jx) * (0.6 + 0.4 * s), (y + jy) * (0.6 + 0.4 * s), rz_ * 0.85 + zs[i] * s),
                (rx * (0.55 + 0.45 * s), ry * (0.55 + 0.45 * s), rz_), seg=8, rings=6, jitter=0.18)
    # ore lumps on the surface of the main block, all around (the rock is seen from all four views)
    (bx_, by_), (rx, ry, rz), _ = parts[0]
    jx, jy, k = jit[0]
    Rx, Ry, Rz = rx * (0.55 + 0.45 * s), ry * (0.55 + 0.45 * s), rz * s * k
    cx, cy, cz = (bx_ + jx) * (0.6 + 0.4 * s), (by_ + jy) * (0.6 + 0.4 * s), Rz * 0.85
    ls = 0.6 + 0.4 * s
    for q, (a, rad) in enumerate(veins[:[9, 7, 5, 3][var]]):
        u, v = rad * math.cos(a), rad * math.sin(a)
        z = cz + Rz * math.sqrt(max(0.0, 1 - u * u - v * v)) - 0.04
        mb.blob("ore" if q % 3 else "ore_hi", (cx + u * Rx, cy + v * Ry, z), (0.2 * ls, 0.17 * ls, 0.14 * ls), seg=6, rings=4, jitter=0.3)
    if var >= 1:
        hh = 1.3 * s
        mb.bx("rock_cut", -0.55 * s - 0.1, 0.45 * s + 0.1, -0.62 * s - 0.08, -0.1, 0, hh)
        for zz in (hh * 0.33, hh * 0.66):
            mb.bx("ore", -0.3 * s, 0.25 * s, -0.62 * s - 0.1, -0.6 * s - 0.06, zz - 0.05, zz + 0.02)
    n_rub = [3, 6, 10, 14][var]
    for q, (x, y, rr) in enumerate(rubble[:n_rub]):
        if abs(x) < 0.45 * s + 0.2 and abs(y) < 0.45 * s + 0.2:
            x = math.copysign(0.45 * s + 0.3, x)
        mb.blob("ore" if q % 3 == 0 else ("rock_dk" if rr > 0.12 else "gravel"), (x, y, rr * 0.5), (rr, rr * 0.9, rr * 0.7), seg=5, rings=3, jitter=0.25)


# ---------------------------------------------------------------- Lagerstapel
def b_stapel_erz(mb, var):
    """Ore in a low plank bin, the heap grows with the fill level (1-4)."""
    if not var:
        return
    mb.bx("wood", -0.85, 0.85, -0.7, 0.7, STACK_Z, STACK_Z + 0.05)
    for (x0, x1, y0, y1) in ((-0.88, 0.88, -0.74, -0.66), (-0.88, 0.88, 0.66, 0.74), (-0.88, -0.8, -0.66, 0.66), (0.8, 0.88, -0.66, 0.66)):
        mb.bx("wood_hi", x0, x1, y0, y1, STACK_Z, STACK_Z + 0.3)
    r = random.Random(1000 * mb.seed + 3)
    lumps = [(r.uniform(-0.62, 0.62), r.uniform(-0.48, 0.48), r.uniform(0.15, 0.21), r.random(), r.uniform(-0.04, 0.04)) for _ in range(48)]
    for i, (dx, dy, rr, c, dz) in enumerate(lumps[:var * 12]):
        L = i // 12  # one more, narrower layer per fill level: the heap rises to a cone
        sh = 1 - 0.24 * L
        mb.blob("ore" if c < 0.5 else ("ore_hi" if c < 0.75 else "rock_dk"), (dx * sh, dy * sh, STACK_Z + 0.12 + L * 0.24 + dz),
                (rr, rr * 0.9, rr * 0.75), seg=5, rings=3, jitter=0.25)


def crossbow_model(mb, x, y, z, rz=0.0):
    """A crossbow lying flat: stock along local y, steel prod across, string."""
    with mb.at((x, y, z), rz):
        mb.bx("wood_hi", -0.05, 0.05, -0.4, 0.3, 0, 0.07)
        mb.bx("wood", -0.06, 0.06, -0.45, -0.3, 0, 0.09)
        mb.box("steel_hi", (0, 0.24, 0.05), (0.75, 0.05, 0.04))
        mb.box("string", (0, 0.12, 0.06), (0.68, 0.02, 0.02))
        mb.bx("iron", -0.03, 0.03, -0.1, -0.02, -0.04, 0.0)


def b_stapel_armbrust(mb, var):
    """Shelf with crossbows lying on two boards, two more per fill level."""
    if not var:
        return
    for k in (-1, 1):
        mb.bx("wood", k * 0.8 - 0.05, k * 0.8 + 0.05, -0.45, 0.45, STACK_Z, STACK_Z + 0.95)
    for z in (0.35, 0.85):
        mb.bx("wood_hi", -0.85, 0.85, -0.45, 0.45, STACK_Z + z, STACK_Z + z + 0.05)
    spots = [(-0.45, 0.4, 0), (0.0, 0.4, -6), (0.45, 0.4, 5), (-0.45, 0.9, 4), (0.0, 0.9, -3), (0.45, 0.9, 7), (-0.25, 0.04, 90), (0.35, 0.04, 85)]
    for q in range(min(len(spots), var * 2)):
        x, z, rz = spots[q]
        crossbow_model(mb, x, 0.0, STACK_Z + z + (0.05 if z > 0.1 else 0.0), rz)


def b_stapel_pike(mb, var):
    """Very tall upright rack, three more pikes per level (taller than the spear rack)."""
    if not var:
        return
    for k in (-1, 1):
        mb.box("wood", (k * 0.8, 0.3, 1.0), (0.1, 0.1, 2.0))
    mb.box("wood", (0, 0.3, 1.9), (1.7, 0.08, 0.08))
    mb.box("wood", (0, 0.3, 0.45), (1.7, 0.08, 0.08))
    mb.bx("wood_hi", -0.85, 0.85, -0.05, 0.35, STACK_Z, STACK_Z + 0.08)
    for q in range(var * 3):
        xx = -0.66 + q * 0.12
        mb.box("wood", (xx, 0.2, 1.65), (0.045, 0.045, 3.2), rot=(-8, 0, 0))
        mb.cyl("steel_hi", (xx, -0.03, 3.28), 0.04, 0.3, n=4, rot=(-8, 0, 0), r2=0)


def b_stapel_ruestung(mb, var):
    """Armour on stands: one more mail shirt (with a kettle hat from the second) per fill level."""
    if not var:
        return
    mb.bx("wood_hi", -0.88, 0.88, -0.4, 0.4, STACK_Z, STACK_Z + 0.06)
    spots = [(-0.45, 0.12), (0.45, 0.12), (-0.45, -0.22), (0.45, -0.22)]
    for q in range(var):
        x, y = spots[q]
        with mb.at((x, y, STACK_Z + 0.06)):
            mb.bx("wood", -0.03, 0.03, -0.03, 0.03, 0, 1.15)
            mb.bx("wood", -0.24, 0.24, -0.03, 0.03, 0.98, 1.04)
            mb.bx("steel", -0.21, 0.21, -0.1, 0.1, 0.45, 1.02)
            mb.bx("iron", -0.2, 0.2, -0.11, 0.11, 0.42, 0.47)
            for k in (-1, 1):
                mb.bx("steel", k * 0.21 - 0.07 * (k < 0), k * 0.21 + 0.07 * (k > 0), -0.09, 0.09, 0.78, 1.02)
            if q >= 1:
                mb.cyl("steel_hi", (0, 0, 1.2), 0.19, 0.025, n=10)
                mb.blob("steel_hi", (0, 0, 1.22), (0.12, 0.12, 0.1), seg=8, rings=4, jitter=0.02)


# ---------------------------------------------------------------- Anmeldung
BUILD.update({
    "erzmine": b_erzmine, "schmelzhuette": b_schmelzhuette, "schmelzhuette_innen": b_schmelzhuette_innen,
    "waffenschmiede": b_waffenschmiede, "waffenschmiede_innen": b_waffenschmiede_innen,
    "bognerei": b_bognerei, "bognerei_innen": b_bognerei_innen,
    "ruestungsschmiede": b_ruestungsschmiede, "ruestungsschmiede_innen": b_ruestungsschmiede_innen,
    "fels_erz": b_fels_erz, "stapel_erz": b_stapel_erz, "stapel_armbrust": b_stapel_armbrust,
    "stapel_pike": b_stapel_pike, "stapel_ruestung": b_stapel_ruestung,
})
_WS_RECT = (WS_X0, WS_X1, WS_Y0, WS_Y1)
SITE_RECTS.update({
    "erzmine": [(-2.3, 0.5, 0.95, 2.6), (1.2, 2.3, -0.2, 0.9)],
    "schmelzhuette": [_WS_RECT], "waffenschmiede": [_WS_RECT], "bognerei": [_WS_RECT], "ruestungsschmiede": [_WS_RECT],
})
SITE_KIND.update({"erzmine": "yard"})
SCAFFOLDS.update({k: (_WS_RECT, 2, 1.3) for k in ("schmelzhuette", "waffenschmiede", "bognerei", "ruestungsschmiede")})
for _k in ("erzmine", "schmelzhuette", "waffenschmiede", "bognerei", "ruestungsschmiede"):
    BUILD["baustelle_" + _k] = b_site(_k)
for _k in ("schmelzhuette", "waffenschmiede", "bognerei", "ruestungsschmiede"):
    BUILD["geruest_" + _k] = b_geruest(_k)
