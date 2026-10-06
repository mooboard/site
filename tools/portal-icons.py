#!/usr/bin/env python3
# the portal app icons from the brand kit app icon + the matrix cow on the site background
# run with ~/.pixelwall-build/venv/bin/python tools/portal-icons.py from the site folder + needs pillow
import os

from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
KIT = os.path.join(ROOT, 'brand', 'kit')
OUT = os.path.join(ROOT, 'portal')
BG = (14, 26, 34)
# the kit app icon as brand/kit/src/icons.py places it + the mark at scale 5.6 centred on 512 520 of 1024
APP, APP_SCALE, APP_CENTRE = 'app-icon-1024.png', 5.6 / 1024, (512, 520)
# the maskable one takes the kit android foreground placement + scale 1.9 centred on 216 218 of 432 + well inside the round safe zone
MASK_SCALE, MASK_CENTRE = 1.9 / 432, (216 / 432, 218 / 432)
# each icon file + its size + whether it is the maskable one
ICONS = [('icon-192.png', 192, False), ('icon-512.png', 512, False), ('icon-maskable-512.png', 512, True), ('apple-touch-icon.png', 180, False)]


def maskable(app):
    k = MASK_SCALE / APP_SCALE
    small = app.resize((round(1024 * k), round(1024 * k)), Image.LANCZOS)
    out = Image.new('RGB', (1024, 1024), BG)
    out.paste(small, (round(MASK_CENTRE[0] * 1024 - APP_CENTRE[0] * k), round(MASK_CENTRE[1] * 1024 - APP_CENTRE[1] * k)))
    return out


def main():
    app = Image.open(os.path.join(KIT, APP)).convert('RGB')
    assert app.size == (1024, 1024), app.size
    os.makedirs(OUT, exist_ok=True)
    for name, size, mask in ICONS:
        (maskable(app) if mask else app).resize((size, size), Image.LANCZOS).save(os.path.join(OUT, name), optimize=True)
        print(name, size)


if __name__ == '__main__':
    main()
