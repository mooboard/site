#!/bin/sh
# rebuild every brand file: the kit icons and their pngs, the kit page, the box art, its renders and the dieline pdf
set -e
B=$(cd "$(dirname "$0")" && pwd)
python3 "$B/kit/src/icons.py"
sh "$B/kit/src/render.sh"
python3 "$B/kit/src/build.py"
python3 "$B/box/src/build_box.py"
python3 "$B/box/src/build_views.py"
sh "$B/box/src/render.sh"
sh "$B/box/src/render.sh" "$B/lockup.html" "$B/lockup.png" 1500 560
