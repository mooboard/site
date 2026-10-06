#!/usr/bin/env python3
"""Phone renditions and posters for the scroll sequences, and a 1200 px copy of the tech-card still.

  ~/.pixelwall-build/venv/bin/python tools/renditions.py

For every sequence in renders/manifest.json this writes
  renders/<dir>/960/NNNN.webp   960x540, quality 80  (phones and narrow windows pick these)
  renders/<dir>/poster.webp     480x270, quality 70  (first frame, drawn until the real frames land)
and records "sizes": [960, <full>] in the manifest, with "src", a digest of the full-size frames they were made from
(the still's digest goes under "stills"). Re-running only writes files that are missing or whose source changed (file
times say nothing after a git checkout), and removes 960 px frames the sequence no longer has. Needs Pillow (in the
build venv)."""
import hashlib
import json
import os
import sys

from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
MAN = os.path.join(ROOT, 'renders', 'manifest.json')
SMALL = 960
POSTER = 480


def digest(paths):
    h = hashlib.sha1()
    for p in paths:
        with open(p, 'rb') as f:
            h.update(f.read())
    return h.hexdigest()[:16]


def save(im, w, dst, q):
    h = round(w * im.height / im.width)
    im.resize((w, h), Image.LANCZOS).save(dst, 'WEBP', quality=q, method=6)


def main():
    with open(MAN) as f:
        man = json.load(f)
    written = removed = 0
    for name, s in man['sequences'].items():
        if not s.get('frames'):
            continue
        d = os.path.join(ROOT, 'renders', s['dir'])
        small = os.path.join(d, str(SMALL))
        os.makedirs(small, exist_ok=True)
        pad, ext = s.get('pad', 4), s.get('ext', 'webp')
        names = [str(i).zfill(pad) + '.' + ext for i in range(1, s['frames'] + 1)]
        src = digest(os.path.join(d, fn) for fn in names)
        same = s.get('src') == src
        for fn in names:
            dst = os.path.join(small, fn)
            if not (same and os.path.exists(dst)):
                save(Image.open(os.path.join(d, fn)).convert('RGB'), SMALL, dst, 80)
                written += 1
        # frames left over from a longer render
        for fn in os.listdir(small):
            if fn not in names:
                os.remove(os.path.join(small, fn))
                removed += 1
        poster = os.path.join(d, 'poster.webp')
        if not (same and os.path.exists(poster)):
            save(Image.open(os.path.join(d, names[0])).convert('RGB'), POSTER, poster, 70)
            written += 1
        s['sizes'] = [SMALL, s['width']]
        s['poster'] = 'poster.webp'
        s['src'] = src
        print('%s: %d frames at %d px, %d KB (full %d KB)' % (name, s['frames'], SMALL,
              sum(os.path.getsize(os.path.join(small, fn)) for fn in names) // 1024,
              sum(os.path.getsize(os.path.join(d, fn)) for fn in names) // 1024))
    # the tech-card still gets a 1200 px copy for the srcset (it shows at most ~700 css px wide)
    stills = os.path.join(ROOT, 'renders', 'stills')
    done = man.setdefault('stills', {})
    for name in ('bottom-cable',):
        src, dst = os.path.join(stills, name + '.webp'), os.path.join(stills, name + '-1200.webp')
        dig = digest([src])
        if not (done.get(name) == dig and os.path.exists(dst)):
            save(Image.open(src).convert('RGB'), 1200, dst, 82)
            written += 1
        done[name] = dig
    tmp = MAN + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(man, f, indent=2)
        f.write('\n')
    os.replace(tmp, MAN)
    print('wrote', written, 'files, removed', removed)
    return 0


if __name__ == '__main__':
    sys.exit(main())
