#!/bin/sh
# render.sh in.svg out.png size, or no arguments to render every kit png from its svg
# CHROME picks the browser, chrome-headless-shell on linux
set -e
C="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
shot() {
  [ -f "$1" ] || { echo "render.sh: no $1" >&2; exit 1; }
  t=$(mktemp -d)
  printf '<html><body style="margin:0;background:transparent"><img src="file://%s/%s" style="width:%spx;height:%spx;display:block"></body></html>\n' \
    "$(cd "$(dirname "$1")" && pwd)" "$(basename "$1")" "$3" "$3" > "$t/r.html"
  "$C" --headless=new --hide-scrollbars --force-device-scale-factor=1 --default-background-color=00000000 --window-size=$3,$3 --screenshot="$t/r.png" "file://$t/r.html"
  mv "$t/r.png" "$2"
  rm -r "$t"
}
if [ $# -gt 0 ]; then shot "$@"; exit; fi
K=$(cd "$(dirname "$0")/.." && pwd)
shot "$K/app-icon.svg" "$K/app-icon-1024.png" 1024
shot "$K/app-icon-ios.svg" "$K/app-icon-ios-1024.png" 1024
shot "$K/app-icon-android-foreground.svg" "$K/app-icon-android-foreground-432.png" 432
shot "$K/app-icon-android-background.svg" "$K/app-icon-android-background-432.png" 432
shot "$K/avatar.svg" "$K/avatar-800.png" 800
shot "$K/favicon-16.svg" "$K/favicon-16.png" 16
shot "$K/favicon.svg" "$K/favicon-32.png" 32
shot "$K/app-icon.svg" "$K/favicon-180.png" 180
shot "$K/app-icon.svg" "$K/favicon-512.png" 512
