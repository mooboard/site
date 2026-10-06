#!/usr/bin/env python3
# the portal app icons from the led cow in js/board.js + round leds in the board colours on the site background
# run with ~/.pixelwall-build/venv/bin/python tools/portal-icons.py from the site folder + needs pillow
import os
import re

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'portal')
BG = (14, 26, 34)
INK = {'s': (119, 237, 215), 'c': (245, 233, 214), 'p': (255, 170, 195), 'w': (255, 255, 255)}
# each icon file + its size + how much of its width the cow takes + a maskable one keeps the cow in the safe circle
ICONS = [('icon-192.png', 192, .74), ('icon-512.png', 512, .74), ('icon-maskable-512.png', 512, .56), ('apple-touch-icon.png', 180, .74)]
SS = 4


def mark():
    src = open(os.path.join(ROOT, 'js', 'board.js'), encoding='utf-8').read()
    body = re.search(r"  var MARK = \[\n(.*?)\n  \];\n", src, re.S).group(1)
    rows = re.findall(r"'([.cspwo]+)'", body)
    assert len(rows) == 25 and all(len(r) == 34 for r in rows)
    return rows


def icon(rows, size, share):
    big = size * SS
    pitch = share * big / 34
    x0 = (big - 34 * pitch) / 2
    y0 = (big - 25 * pitch) / 2
    dots = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(dots)
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch not in INK:
                continue
            cx, cy, r = x0 + (x + .5) * pitch, y0 + (y + .5) * pitch, .42 * pitch
            d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=INK[ch] + (255,))
    glow = dots.filter(ImageFilter.GaussianBlur(pitch * .6))
    glow.putalpha(glow.getchannel('A').point(lambda a: int(a * .55)))
    out = Image.new('RGBA', (big, big), BG + (255,))
    out.alpha_composite(glow)
    out.alpha_composite(dots)
    return out.convert('RGB').resize((size, size), Image.LANCZOS)


def main():
    rows = mark()
    os.makedirs(OUT, exist_ok=True)
    for name, size, share in ICONS:
        icon(rows, size, share).save(os.path.join(OUT, name), optimize=True)
        print(name, size)


if __name__ == '__main__':
    main()
