#!/bin/bash
# Render the terrain tiles once and pixelize them in every style.  Usage: tools/blender/build_terrain.sh [style ...]
# Needs the figure renders of the same styles (light reference), as build_buildings.sh.
set -eo pipefail
cd "$(dirname "$0")/../.."
STYLES=${*:-$(ls tools/blender/styles | sed 's/\.json$//')}
mkdir -p .local/blender
log=.local/blender/terrain.log
if ! blender -b --factory-startup --python-exit-code 1 -P tools/blender/terrain.py -- --out .local/blender/terrain > "$log" 2>&1; then
  echo "Blender failed for the terrain, see $log" >&2; tail -20 "$log" >&2; exit 1
fi
for s in $STYLES; do
  if [ ! -f .local/blender/$s/render.json ]; then
    echo "figure renders for $s missing (light reference), run tools/blender/build.sh $s first" >&2; exit 1
  fi
  python3 tools/blender/terrain.py --style tools/blender/styles/$s.json --src .local/blender/terrain \
      --out assets/terrain/$s --lref-src .local/blender/$s --lscale 1.06
done
