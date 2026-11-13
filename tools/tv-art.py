#!/usr/bin/env python3
"""The TV tile's covers (js/board.js WATCHING): each title's 16:9 key art from the Apple TV app (tv.apple.com's
og:image, 1200x675), made into the 57x32 box the board draws for an Apple TV's 600 px artwork (WatchArt.cpp and
pw_art boxDownsample), plus the S/E row's accent (pw_art accentColor at 28x28). Writes assets/clips/tv.png (the boxes
top to bottom, in WATCHING's order) and prints the accents to copy into WATCHING.
Run:  python3 tools/tv-art.py
"""
import io, json, math, os, sys, urllib.request
from PIL import Image

TITLES = [
    ('Bluey', 'https://is1-ssl.mzstatic.com/image/thumb/isS4VSQXVbUIZeSILfZtrQ/1200x675.jpg'),
    ('Stranger Things', 'https://is1-ssl.mzstatic.com/image/thumb/bdrIrPGWj3bC6ITpNooZ7w/1200x675.jpg'),
    ('The Office', 'https://is1-ssl.mzstatic.com/image/thumb/Video221/v4/f3/4b/bf/f34bbf3d-012d-e412-0e8b-cdbcab66e106/nbc-the-office-4.000-keyart-72-dpi-3840-x-2160-16-9-domestic-network-logo-ok-1.png/1200x675.jpg'),
    ('Dune: Part Two', 'https://is1-ssl.mzstatic.com/image/thumb/Video211/v4/78/b1/52/78b15200-df9f-624c-75b9-d586d9801c9c/cd6db9a4-7489-4ea3-a5c6-012d3512a3e0_DUNE_PART2_H_DD_KA_TT_CVRART_3840x2160_300dpi_EN-p3.lsr/1200x675.jpg'),
    ('Only Murders in the Building', 'https://is1-ssl.mzstatic.com/image/thumb/ibET33Xv5pssBImuHdLWxA/1200x675.jpg'),
    ('Ted Lasso', 'https://is1-ssl.mzstatic.com/image/thumb/eD8DZGJ170t3MyFhlWOkdw/1200x675.jpg'),
]


def box_downsample(src, sw, sh, dw, dh):
    bw, bh = sw / dw, sh / dh
    out = bytearray(dw * dh * 3)
    for oy in range(dh):
        y0 = int(math.floor(oy * bh)); y1 = int(math.ceil((oy + 1) * bh))
        if y1 <= y0: y1 = y0 + 1
        y0 = min(max(y0, 0), sh - 1); y1 = min(max(y1, y0 + 1), sh)
        for ox in range(dw):
            x0 = int(math.floor(ox * bw)); x1 = int(math.ceil((ox + 1) * bw))
            if x1 <= x0: x1 = x0 + 1
            x0 = min(max(x0, 0), sw - 1); x1 = min(max(x1, x0 + 1), sw)
            s = [0, 0, 0]; n = 0
            for y in range(y0, y1):
                i = (y * sw + x0) * 3
                for x in range(x0, x1):
                    s[0] += src[i]; s[1] += src[i + 1]; s[2] += src[i + 2]; i += 3; n += 1
            d = (oy * dw + ox) * 3
            out[d], out[d + 1], out[d + 2] = s[0] // n, s[1] // n, s[2] // n
    return bytes(out)

def to_hsl(c):
    r, g, b = c[0] / 255, c[1] / 255, c[2] / 255
    mx, mn = max(r, g, b), min(r, g, b); l = (mx + mn) / 2; d = mx - mn
    if d < 1e-9: return 0.0, 0.0, l
    s = d / (1 - abs(2 * l - 1))
    if mx == r: h = 60 * math.fmod((g - b) / d + 6, 6)
    elif mx == g: h = 60 * ((b - r) / d + 2)
    else: h = 60 * ((r - g) / d + 4)
    return (h + 360 if h < 0 else h), s, l

def from_hsl(h, s, l):
    c = (1 - abs(2 * l - 1)) * s; hp = h / 60; x = c * (1 - abs(math.fmod(hp, 2) - 1))
    r1, g1, b1 = [(c, x, 0), (x, c, 0), (0, c, x), (0, x, c), (x, 0, c), (c, 0, x)][min(5, int(hp))]
    m = l - c / 2
    return [min(max(int(math.floor((v + m) * 255.0 + 0.5)), 0), 255) for v in (r1, g1, b1)]   # std::lround

def accent_color(tex):
    px = [tuple(float(v) for v in tex[i * 3:i * 3 + 3]) for i in range(28 * 28)]
    cen = [px[i] for i in (0, 261, 522, 783)]; counts = [0] * 4
    for _ in range(8):
        sums = [[0.0, 0.0, 0.0] for _ in range(4)]; cnt = [0] * 4
        for p in px:
            best = min(range(4), key=lambda k: (sum((p[j] - cen[k][j]) ** 2 for j in range(3)), k))
            for j in range(3): sums[best][j] += p[j]
            cnt[best] += 1
        for k in range(4):
            if cnt[k]: cen[k] = tuple(sums[k][j] / cnt[k] for j in range(3))
        counts = cnt
    hsl = [to_hsl(c) for c in cen]; best = 0
    for k in range(1, 4):
        if hsl[k][1] > hsl[best][1] + 1e-9 or (abs(hsl[k][1] - hsl[best][1]) <= 1e-9 and counts[k] > counts[best]): best = k
    h, s, l = hsl[best]
    return from_hsl(h, s, min(max(l, .45), .75))

def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    strip = Image.new('RGB', (57, 32 * len(TITLES)))
    for i, (name, url) in enumerate(TITLES):
        with urllib.request.urlopen(url, timeout=30) as r:
            im = Image.open(io.BytesIO(r.read())).convert('RGB')
        im = im.resize((600, round(600 * im.height / im.width)), Image.LANCZOS)   # what the Apple TV sends
        cols = max(1, min(57, round(32 * im.width / im.height)))
        if cols != 57:
            sys.exit('%s is not 16:9 (%d columns at 32 rows)' % (name, cols))
        art = box_downsample(im.tobytes(), im.width, im.height, 57, 32)
        strip.paste(Image.frombytes('RGB', (57, 32), art), (0, 32 * i))
        print('%-30s accent %s' % (name, json.dumps(accent_color(box_downsample(art, 57, 32, 28, 28)))))
    strip.save(os.path.join(root, 'assets', 'clips', 'tv.png'), optimize=True)


if __name__ == '__main__':
    main()
