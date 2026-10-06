#!/usr/bin/env python3
"""Posters for the 3D viewer: the viewer's own first frame, shot in headless Chrome, for the moment before three.js
and the model arrive (and for browsers without WebGL).

  ~/.pixelwall-build/venv/bin/python tools/viewer-poster.py http://localhost:8000/

Serve the site first (any static server). Writes
  renders/stills/viewer-poster.webp        the desktop stage, 1440 px wide
  renders/stills/viewer-poster-phone.webp  the phone stage, 390 px wide at 2x
The board wears Mint Glow (the site's first frame) at its home angle, its face showing the Classic clock at 10:08 on
the default clear day (the weather request is blocked, so the poster never bakes in a real forecast; no album art
either). Needs Pillow; uses tools/perf.py's Chrome driver."""
import base64
import io
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from perf import CDP, Page, launch  # noqa: E402
from PIL import Image  # noqa: E402

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'renders', 'stills')


def shoot(url, w, h, dpr, mobile, dst):
    proc, udir, ws = launch(w, h)
    try:
        cdp = CDP(ws)
        pg = Page(cdp, dict(width=w, height=h, dpr=dpr, mobile=mobile, cpu=1, net=None))
        pg.call('Network.setBlockedURLs', {'urls': ['*open-meteo*']})
        pg.goto(url)
        cdp.pump(2)
        pg.js('try { localStorage.removeItem("moo-wx") } catch (e) {}')
        y = pg.js('Math.round(document.querySelector("#viewer").getBoundingClientRect().top + scrollY)')
        for k in range(1, 9):
            pg.scroll_to(int(y * k / 8))
            cdp.pump(.4)
        for _ in range(60):
            if pg.js('document.querySelector("#viewer").classList.contains("v-live")'):
                break
            cdp.pump(.5)
        else:
            raise SystemExit('the viewer did not start')
        pg.js('''(function () {
          MooBoard.setNow(function () { return new Date(2026, 9, 6, 10, 8, 30); });
          var led = MooBoard.boards.filter(function (b) { return b.opts.external; })[0];
          led.go('time');
          document.querySelector('.v-spin').click();
          document.querySelector('.v-canvas').dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
          document.querySelector('.v-hint').style.visibility = 'hidden';
        })()''')
        cdp.pump(3.5)
        r = pg.js('(function(){var r=document.querySelector(".v-stage").getBoundingClientRect();window.scrollBy(0,r.top-(innerHeight-r.height)/2);r=document.querySelector(".v-stage").getBoundingClientRect();return [r.left+scrollX,r.top+scrollY,r.width,r.height]})()')
        cdp.pump(1.0)
        png = pg.call('Page.captureScreenshot', {'format': 'png', 'clip': {'x': r[0], 'y': r[1], 'width': r[2], 'height': r[3], 'scale': 1}})['data']
        im = Image.open(io.BytesIO(base64.b64decode(png))).convert('RGB')
        im.save(dst, 'WEBP', quality=78, method=6)
        print(dst, im.size, os.path.getsize(dst), 'bytes')
    finally:
        proc.terminate()


def main():
    url = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8000/'
    os.makedirs(OUT, exist_ok=True)
    shoot(url, 1440, 900, 1, False, os.path.join(OUT, 'viewer-poster.webp'))
    shoot(url, 390, 844, 2, True, os.path.join(OUT, 'viewer-poster-phone.webp'))


if __name__ == '__main__':
    main()
