"""Insert the Blender figure and building tests into the concept page (idempotent via markers).

Reads assets/figures/<style>/, assets/buildings/<style>/ and tools/blender/styles/, writes the figure atlases
next to the sheets and replaces the marked FIGLAB and BAUTEN blocks in docs/konzept-seite.html (or --page PATH).
"""
import argparse, base64, io, json, os, re, sys
from PIL import Image

SP = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(SP, "..", ".."))
ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
ap.add_argument("--page", default=os.path.join(ROOT, "docs", "konzept-seite.html"), help="HTML page to update in place")
PAGE = ap.parse_args().page
ORDER = ["vorgerendert", "wappen", "chronik", "miniatur", "holzschnitt"]


def b64(im):
    buf = io.BytesIO(); im.save(buf, "PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


data = {"order": ORDER, "styles": {}}
total = 0
for k in ORDER:
    d = os.path.join(ROOT, "assets/figures", k)
    meta = json.load(open(os.path.join(d, "sheet.json")))
    style = json.load(open(os.path.join(ROOT, "tools/blender/styles", k + ".json")))
    c, F = meta["cell"], meta["frames"]
    shown = [u for u in meta["units"] if u.get("showcase", True)]
    extra = [u for u in meta["units"] if not u.get("showcase", True)]  # helpers for the building scene only

    def stack(units):
        at = Image.new("RGBA", (c * F, c * 8 * max(1, len(units))), (0, 0, 0, 0))
        for i, u in enumerate(units):
            at.paste(Image.open(os.path.join(d, u["key"] + ".png")), (0, i * 8 * c))
        return at
    at = stack(shown)
    at.save(os.path.join(d, "atlas.png"), optimize=True)
    total += len(shown) * 8 * F
    data["styles"][k] = {"label": style["label"], "desc": style["desc"], "height": style["height_px"],
                         "cell": c, "frames": F, "anchor": meta["anchor"], "units": [{"key": u["key"], "name": u["name"]} for u in shown],
                         "swap": meta.get("team_swap", {}), "shadow": meta.get("shadow", False),
                         "ground": meta.get("ground") or ["#6a8e44", "#5f8440"], "src": b64(at),
                         "xunits": [{"key": u["key"], "name": u["name"]} for u in extra], "xsrc": b64(stack(extra)) if extra else None}

# steps strip: 5 panels at 4x cell (236 px for chronik)
sd = os.path.join(ROOT, "assets/figures/chronik/_steps")
PW = 4 * json.load(open(os.path.join(ROOT, "assets/figures/chronik/sheet.json")))["cell"]
panels = []
for n in ["1_render", "2_light", "3_blocks", "4_shaded", "5_final"]:
    im = Image.open(os.path.join(sd, n + ".png")).convert("RGBA")
    if im.width != PW:
        im = im.resize((PW, PW), Image.NEAREST)
    panels.append(im)
gap = 12
strip = Image.new("RGBA", (PW * 5 + gap * 4, PW), (0, 0, 0, 0))
for i, im in enumerate(panels):
    bg = Image.new("RGBA", (PW, PW), (104, 128, 74, 255))
    bg.alpha_composite(im)
    strip.paste(bg, (i * (PW + gap), 0))
# crop empty top/bottom rows
strip = strip.crop((0, 40, strip.width, PW))
data["steps"] = b64(strip)
data["count"] = total

# ---------------------------------------------------------------- buildings
bdata = {"order": ORDER, "styles": {}}
btotal = 0
for k in ORDER:
    d = os.path.join(ROOT, "assets/buildings", k)
    meta = json.load(open(os.path.join(d, "sheet.json")))
    cw, ch = meta["cell"]
    ax, ay = meta["anchor"]
    blocks, fblocks, entries = [], [], []
    for u in meta["units"]:
        sh = Image.open(os.path.join(d, u["key"] + ".png")).convert("RGBA")
        fp = os.path.join(d, u["key"] + "_front.png")
        fr = Image.open(fp).convert("RGBA") if os.path.exists(fp) else None
        nf = u.get("frames", 1)
        # one crop rectangle for all views and variants, so the anchor stays the same
        x0 = y0 = 10 ** 6; x1 = y1 = 0
        for v in range(4):
            for f in range(nf):
                bb = sh.crop((f * cw, v * ch, (f + 1) * cw, (v + 1) * ch)).getbbox()
                if bb:
                    x0, y0, x1, y1 = min(x0, bb[0]), min(y0, bb[1]), max(x1, bb[2]), max(y1, bb[3])
        bw, bh = x1 - x0, y1 - y0
        blk = Image.new("RGBA", (bw * nf, bh * 4), (0, 0, 0, 0))
        fblk = Image.new("RGBA", (bw * nf, bh * 4), (0, 0, 0, 0)) if fr else None
        for v in range(4):
            for f in range(nf):
                box = (f * cw + x0, v * ch + y0, f * cw + x1, v * ch + y1)
                blk.paste(sh.crop(box), (f * bw, v * bh))
                if fr:
                    fblk.paste(fr.crop(box), (f * bw, v * bh))
        btotal += 4 * nf
        blocks.append(blk); fblocks.append(fblk)
        entries.append({"key": u["key"], "name": u["name"], "fp": u["footprint"], "frames": nf, "variants": u.get("variants", []),
                        "posts": u.get("posts", []), "w": bw, "h": bh, "ax": ax - x0, "ay": ay - y0})
    W = max(b.width for b in blocks)
    atlas = Image.new("RGBA", (W, sum(b.height for b in blocks)), (0, 0, 0, 0))
    fl = [b for b in fblocks if b]
    fatlas = Image.new("RGBA", (W, max(1, sum(b.height for b in fl))), (0, 0, 0, 0))
    y = fy = 0
    for e, b, fb in zip(entries, blocks, fblocks):
        atlas.paste(b, (0, y)); e["at"] = y; y += b.height
        if fb:
            fatlas.paste(fb, (0, fy)); e["fat"] = fy; fy += fb.height
    bdata["styles"][k] = {"units": entries, "swap": meta.get("team_swap", {}), "src": b64(atlas), "fsrc": b64(fatlas),
                          "colours": meta.get("colours")}
bdata["count"] = btotal

page = open(PAGE).read()
sec, nsub = re.subn(r'<b id="figCount">[^<]*</b>', '<b id="figCount">%s</b>' % f"{total:,}".replace(",", "."), open(os.path.join(SP, "figlab.section.html")).read())
assert nsub == 1, "figCount placeholder missing"
css = open(os.path.join(SP, "figlab.css")).read()
js = open(os.path.join(SP, "figlab.js")).read()
blob = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")


def put(page, tag, content, anchor_re, before=True, cm=("<!-- ", " -->")):
    start, end = cm[0] + tag + cm[1], cm[0] + "/" + tag + cm[1]
    if start in page:
        return re.sub(re.escape(start) + ".*?" + re.escape(end), lambda m: start + "\n" + content + "\n" + end, page, flags=re.S)
    m = re.search(anchor_re, page, flags=re.S)
    assert m, anchor_re
    i = m.start() if before else m.end()
    return page[:i] + start + "\n" + content + "\n" + end + "\n" + page[i:]


page = put(page, "FIGLAB", sec, r'  <div class="grid g3">\s*<div class="panel"><h3>Lebendigkeit')
page = put(page, "FIGLAB-CSS", css, r"@media \(prefers-reduced-motion: reduce\)", cm=("/* ", " */"))
page = put(page, "FIGLAB-JS", '<script type="application/json" id="figData">' + blob + "</script>\n<script>\n" + js + "</script>", r"</script>\s*$", before=False)
bsec = open(os.path.join(SP, "bauten.section.html")).read()
bblob = json.dumps(bdata, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
page = put(page, "BAUTEN", bsec, r"<!-- /FIGLAB -->\n", before=False)
page = put(page, "BAUTEN-CSS", open(os.path.join(SP, "bauten.css")).read(), r"/\* /FIGLAB-CSS \*/\n", before=False, cm=("/* ", " */"))
page = put(page, "BAUTEN-JS", '<script type="application/json" id="bauData">' + bblob + "</script>\n<script>\n" + open(os.path.join(SP, "bauten.js")).read() + "</script>",
           r"<!-- /FIGLAB-JS -->\n?", before=False)
if '<a href="#bauten">' not in page:
    page = page.replace('<a href="#figuren"><span>07b</span>Figurentests</a>', '<a href="#figuren"><span>07b</span>Figurentests</a>\n    <a href="#bauten"><span>07c</span>Gebäudetests</a>', 1)
    assert '<a href="#bauten">' in page, "toc link"
open(PAGE, "w").write(page)
print("bytes", len(page), "sprites", total, "building sprites", bdata["count"])
