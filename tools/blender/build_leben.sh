#!/bin/bash
# Lebendige Welt (ADR 0016): Tiere, Lebensblätter der Figuren, Bäume im Wind, Setzlinge und Gebäude mit wehenden
# Bannern rendern, verpixeln und an die bestehenden Blätter ANHÄNGEN (alte Bilder und Einträge bleiben unverändert).
# Usage: tools/blender/build_leben.sh [style]   (Standard: vorgerendert). Braucht die Figurenrenders des Stils
# (.local/blender/<stil>, Lichtbezug), siehe build.sh.
set -eo pipefail
cd "$(dirname "$0")/../.."
S=${1:-vorgerendert}
FIG=tageloehner_leben,speer_leben,schwert_leben,bogen_leben,schaf,kuh,pferd,hirsch,reh,kraehe
BLD=baum_wind,tanne_wind,baum_jung,tanne_jung,kaserne_fahne,turm_fahne,bergfried_holz_fahne,bergfried_stein_fahne,bergfried_burg_fahne
OUT=.local/blender/leben
mkdir -p $OUT
if [ ! -f .local/blender/$S/render.json ]; then
  echo "figure renders for $S missing (light reference), run tools/blender/build.sh $S first" >&2; exit 1
fi
blender -b --factory-startup --python-exit-code 1 -P tools/blender/figures.py -- --style tools/blender/styles/$S.json \
    --out $OUT/fig --units $FIG > $OUT/fig.log 2>&1 || { tail -20 $OUT/fig.log >&2; exit 1; }
blender -b --factory-startup --python-exit-code 1 -P tools/blender/buildings.py -- --out $OUT/bld --only $BLD \
    > $OUT/bld.log 2>&1 || { tail -20 $OUT/bld.log >&2; exit 1; }
python3 tools/blender/pixelize.py --style tools/blender/styles/$S.json --src $OUT/fig --out $OUT/pix_fig --lref-src .local/blender/$S
python3 tools/blender/pixelize.py --style tools/blender/styles/$S.json --src $OUT/bld --out $OUT/pix_bld \
    --palette tools/blender/buildings/palette.json --lref-src .local/blender/$S --lscale 1.06
python3 tools/blender/append_sheet.py --src $OUT/pix_fig --dst assets/figures/$S --keys $FIG
python3 tools/blender/append_sheet.py --src $OUT/pix_bld --dst assets/buildings/$S --keys $BLD
