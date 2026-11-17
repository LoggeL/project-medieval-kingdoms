"""Append freshly pixelized sheets to an existing asset sheet without touching the old entries.

    python3 tools/blender/append_sheet.py --src <pixelize out> --dst assets/figures/vorgerendert --keys schaf,kuh

Copies <key>.png (and <key>_front.png when present) from --src to --dst and appends the unit entries from
<src>/sheet.json to <dst>/sheet.json.  Units already present in the destination are replaced in place (same
position), so the step can be repeated.  Old images and the order of old entries stay as they are.
Figure sheets get a "row" after the last row of the destination; the atlas is not rebuilt, so the loader
falls back to the single images while the atlas is shorter than the rows (see src/render/assets.ts).
"""
import argparse
import json
import os
import shutil

ap = argparse.ArgumentParser()
ap.add_argument("--src", required=True)
ap.add_argument("--dst", required=True)
ap.add_argument("--keys", required=True)
a = ap.parse_args()

keys = [k for k in a.keys.split(",") if k]
src = json.load(open(os.path.join(a.src, "sheet.json")))
dpath = os.path.join(a.dst, "sheet.json")
raw = open(dpath).read()
dst = json.loads(raw)
by_key = {u["key"]: u for u in src["units"]}
figures = isinstance(dst.get("cell"), int)
for k in keys:
    if k not in by_key:
        raise SystemExit(f"{k} fehlt in {a.src}/sheet.json")
    u = dict(by_key[k])
    old = next((i for i, d in enumerate(dst["units"]) if d["key"] == k), None)
    if figures:
        if old is not None:
            u["row"] = dst["units"][old].get("row", old * 8)
        else:
            u["row"] = max([d.get("row", i * 8) + 8 for i, d in enumerate(dst["units"])] + [0])
    if old is None:
        dst["units"].append(u)
    else:
        dst["units"][old] = u
    for suffix in ("", "_front"):
        p = os.path.join(a.src, f"{k}{suffix}.png")
        if os.path.exists(p):
            shutil.copyfile(p, os.path.join(a.dst, f"{k}{suffix}.png"))
    print("angehängt:", k)
with open(dpath, "w") as f:
    json.dump(dst, f, indent=1, ensure_ascii=False)
    if raw.endswith("\n"):
        f.write("\n")
