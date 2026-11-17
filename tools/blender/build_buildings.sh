#!/bin/bash
# Render the buildings once (shared palette) and pixelize them in every figure style (in parallel).
# Usage: tools/blender/build_buildings.sh [style ...]   Needs the figure renders of the same styles (light reference).
set -eo pipefail
cd "$(dirname "$0")/../.."
STYLES=${*:-$(ls tools/blender/styles | sed 's/\.json$//')}
mkdir -p .local/blender
log=.local/blender/buildings.log
if ! blender -b --factory-startup --python-exit-code 1 -P tools/blender/buildings.py -- --out .local/blender/buildings > "$log" 2>&1; then
  echo "Blender failed for the buildings, see $log" >&2; tail -20 "$log" >&2; exit 1
fi
pids=()
for s in $STYLES; do
  if [ ! -f .local/blender/$s/render.json ]; then
    echo "figure renders for $s missing (light reference), run tools/blender/build.sh $s first" >&2; exit 1
  fi
  python3 tools/blender/pixelize.py --style tools/blender/styles/$s.json --src .local/blender/buildings \
      --out assets/buildings/$s --palette tools/blender/buildings/palette.json --lref-src .local/blender/$s --lscale 1.06 \
      > .local/blender/buildings-$s.log 2>&1 &
  pids+=($!)
done
fail=0
for i in "${!pids[@]}"; do
  if ! wait "${pids[$i]}"; then fail=1; fi
done
for s in $STYLES; do echo "$s: $(tail -1 .local/blender/buildings-$s.log)"; done
grep -h "warning" .local/blender/buildings-*.log | sort | uniq -c | head -5 || true
exit $fail
