#!/bin/bash
# Render all figure styles and pixelize them.  Usage: tools/blender/build.sh [style ...]
set -eo pipefail
cd "$(dirname "$0")/../.."
STYLES=${*:-$(ls tools/blender/styles | sed 's/\.json$//')}
mkdir -p .local/blender
for s in $STYLES; do
  log=.local/blender/$s.log
  if ! blender -b --factory-startup --python-exit-code 1 -P tools/blender/figures.py -- \
      --style tools/blender/styles/$s.json --out .local/blender/$s > "$log" 2>&1; then
    echo "Blender failed for $s, see $log" >&2; tail -20 "$log" >&2; exit 1
  fi
  python3 tools/blender/pixelize.py --style tools/blender/styles/$s.json --src .local/blender/$s --out assets/figures/$s
done
