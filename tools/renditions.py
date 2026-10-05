#!/usr/bin/env python3
"""Phone renditions and posters for the scroll sequences, and 1200 px copies of the tech-card stills.

  ~/.pixelwall-build/venv/bin/python tools/renditions.py

For every sequence in renders/manifest.json this writes
  renders/<dir>/960/NNNN.webp   960x540, quality 80  (phones and narrow windows pick these)
  renders/<dir>/poster.webp     480x270, quality 70  (first frame, drawn until the real frames land)
and records "sizes": [960, <full>] in the manifest. Re-running only writes files that are missing or older than
their source. Needs Pillow (in the build venv)."""
import json
import os
import sys

from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
MAN = os.path.join(ROOT, 'renders', 'manifest.json')
SMALL = 960
POSTER = 480


def newer(dst, src):
    return os.path.exists(dst) and os.path.getmtime(dst) >= os.path.getmtime(src)


def save(im, w, dst, q):
    h = round(w * im.height / im.width)
    im.resize((w, h), Image.LANCZOS).save(dst, 'WEBP', quality=q, method=6)


def main():
    man = json.load(open(MAN))
    written = 0
    for name, s in man['sequences'].items():
        if not s.get('frames'):
            continue
        d = os.path.join(ROOT, 'renders', s['dir'])
        small = os.path.join(d, str(SMALL))
        os.makedirs(small, exist_ok=True)
        pad, ext = s.get('pad', 4), s.get('ext', 'webp')
        for i in range(1, s['frames'] + 1):
            fn = str(i).zfill(pad) + '.' + ext
            src, dst = os.path.join(d, fn), os.path.join(small, fn)
            if not newer(dst, src):
                save(Image.open(src).convert('RGB'), SMALL, dst, 80)
                written += 1
        first = os.path.join(d, '1'.zfill(pad) + '.' + ext)
        poster = os.path.join(d, 'poster.webp')
        if not newer(poster, first):
            save(Image.open(first).convert('RGB'), POSTER, poster, 70)
            written += 1
        s['sizes'] = [SMALL, s['width']]
        s['poster'] = 'poster.webp'
        total = sum(os.path.getsize(os.path.join(small, f)) for f in os.listdir(small))
        print('%s: %d frames at %d px, %d KB (full %d KB)' % (name, s['frames'], SMALL, total // 1024,
              sum(os.path.getsize(os.path.join(d, f)) for f in os.listdir(d) if f.endswith('.' + ext)) // 1024))
    # the two tech-card stills get a 1200 px copy for the srcset (they show at most ~700 css px wide)
    stills = os.path.join(ROOT, 'renders', 'stills')
    for name in ('closeup-led', 'bottom-cable'):
        src, dst = os.path.join(stills, name + '.webp'), os.path.join(stills, name + '-1200.webp')
        if not newer(dst, src):
            save(Image.open(src).convert('RGB'), 1200, dst, 82)
            written += 1
    json.dump(man, open(MAN, 'w'), indent=2)
    open(MAN, 'a').write('\n')
    print('wrote', written, 'files')
    return 0


if __name__ == '__main__':
    sys.exit(main())
