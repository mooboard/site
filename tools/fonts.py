#!/usr/bin/env python3
"""Self-hosted web fonts for the site (replaces the Google Fonts stylesheet).

  ~/.pixelwall-build/venv/bin/python tools/fonts.py

fonts/fredoka.woff2     Fredoka variable, wdth pinned to 100, wght 500..700, latin subset (from brand/fonts/Fredoka.ttf)
fonts/nunito.woff2      Nunito variable, wght 400..900, latin subset (from brand/fonts/Nunito.ttf)
fonts/silkscreen.woff2  Silkscreen Regular, latin (Google Fonts' own woff2, OFL)
fonts/devanagari.woff2  Noto Sans Devanagari 600, devanagari subset (Google Fonts' own woff2, OFL)
Needs fontTools + brotli (in the build venv) and the network for the last two."""
import os
import re
import sys
import urllib.request

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'fonts')
LATIN = ('U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,'
         'U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD')
GF = ('https://fonts.googleapis.com/css2?family=Silkscreen&family=Noto+Sans+Devanagari:wght@600&display=swap')
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36'


def build(src, dst, axes):
    f = TTFont(os.path.join(ROOT, src))
    o = subset.Options()
    o.flavor = 'woff2'
    o.layout_features = ['*']
    o.notdef_outline = True
    o.hinting = False
    s = subset.Subsetter(o)
    s.populate(unicodes=subset.parse_unicodes(LATIN))
    s.subset(f)
    f = instancer.instantiateVariableFont(f, axes, inplace=False, updateFontNames=False)
    f.flavor = 'woff2'
    f.save(dst)
    return os.path.getsize(dst)


def google(family, block, dst):
    req = urllib.request.Request(GF, headers={'User-Agent': UA})
    css = urllib.request.urlopen(req).read().decode()
    for m in re.finditer(r'/\* (\w[\w-]*) \*/\s*@font-face \{(.*?)\}', css, re.S):
        if m.group(1) == block and ("font-family: '%s'" % family) in m.group(2):
            url = re.search(r"url\((https://fonts\.gstatic\.com/[^)]+\.woff2)\)", m.group(2)).group(1)
            urllib.request.urlretrieve(url, dst)
            return os.path.getsize(dst)
    raise SystemExit('no %s %s block in the Google Fonts css' % (family, block))


def main():
    os.makedirs(OUT, exist_ok=True)
    print('fredoka.woff2', build('brand/fonts/Fredoka.ttf', os.path.join(OUT, 'fredoka.woff2'), {'wdth': 100, 'wght': (500, 700)}))
    print('nunito.woff2', build('brand/fonts/Nunito.ttf', os.path.join(OUT, 'nunito.woff2'), {'wght': (400, 900)}))
    print('silkscreen.woff2', google('Silkscreen', 'latin', os.path.join(OUT, 'silkscreen.woff2')))
    print('devanagari.woff2', google('Noto Sans Devanagari', 'devanagari', os.path.join(OUT, 'devanagari.woff2')))
    return 0


if __name__ == '__main__':
    sys.exit(main())
