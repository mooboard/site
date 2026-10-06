#!/bin/sh
# Render helper: render.sh <html> <png> <w> <h> [scale], or no arguments to render every box image and the dieline pdf
# CHROME picks the browser, chrome-headless-shell on linux
set -e
C="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
shot() { [ -f "$1" ] || { echo "render.sh: no $1" >&2; exit 1; }; "$C" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=${5:-1} --window-size=$3,$4 --screenshot="$2" "file://$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"; }
if [ $# -gt 0 ]; then shot "$@"; exit; fi
S=$(cd "$(dirname "$0")" && pwd)
shot "$S/flats.html" "$S/../box-flats.png" 2360 1131 2
shot "$S/mockup.html" "$S/../box-mockup.png" 1800 1200 2
shot "$S/mockup-open.html" "$S/../box-mockup-open.png" 1800 1200 2
"$C" --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf="$S/../box-dieline.pdf" "file://$S/dieline-print.html"
