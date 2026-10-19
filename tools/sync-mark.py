"""Copy the mooboard mark from brand/ into index.html (header + footer) as inline SVG,
grouped so the site can animate it: ears wiggle, eyes blink, pupils look and the ring spins the rainbow.
The header cow has the mark's square eyes: each pupil is the middle three by three dots of its eye, inside a ring of
12 white dots. The footer cow, the one that follows the mouse, keeps the old dot eyes (owner 2026-10-19): one dark
pupil in the middle of each eye and the 8 dots round it white. Both carry class="ring" and data-ring (0 to 11,
clockwise from the top row's left dot) on the ring dots, so js/main.js can spin the rainbow round them.
The variant's frame shows in its own fill until the visitor picks a frame. 404.html, hi/index.html, portal/index.html
and link/done/index.html draw their own copy of the cow (<symbol id="cow">), so this exits 1 if theirs no longer
matches the mark, or if index.html lost its markers.
Run after the mark changes:  python3 tools/sync-mark.py [teal|sky|black|white|orange]"""
import re, sys, os

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
variant = sys.argv[1] if len(sys.argv) > 1 else 'teal'
src = open(os.path.join(root, 'brand', 'mark-%s.svg' % variant)).read()
view = re.search(r'viewBox="([^"]+)"', src).group(1)
vx, vy, vw, vh = [float(v) for v in view.split()]
inner = re.sub(r'^.*?<svg[^>]*>|</svg>\s*$', '', src.strip(), flags=re.S)
# the ring round each eye, clockwise from the top row's left dot, in mark units from the eye's middle
RING = [(-4, -8), (0, -8), (4, -8), (8, -4), (8, 0), (8, 4), (4, 8), (0, 8), (-4, 8), (-8, 4), (-8, 0), (-8, -4)]

def num(el, k):
    m = re.search(r'\b%s="([\d.]+)"' % k, el)
    return float(m.group(1)) if m else None

ear_l, ear_r, eyes, pupils, rest = [], [], [], [], []
for el in re.findall(r'<clipPath.*?</clipPath>|<g [^>]*>|</g>|<[^>]+/>', inner, flags=re.S):
    cx, cy = num(el, 'cx'), num(el, 'cy')
    if el.startswith('<ellipse') and cx is not None and cx < vw * .3:
        ear_l.append(el)
    elif el.startswith('<ellipse') and cx is not None and cx > vw * .7:
        ear_r.append(el)
    elif 'class="pupil"' in el:
        pupils.append(el)
    elif el.startswith('<circle') and 'fill="#FFFFFF"' in el and cy is not None and cy < vh * .6:
        eyes.append(el)
    else:
        rest.append(el)

# each eye's middle: the middle of its pupil dots (the mark's pupil is three by three, so its middle dot)
middles = {}
for p in pupils:
    middles.setdefault(num(p, 'cx') < vw / 2, []).append((num(p, 'cx'), num(p, 'cy')))
middles = {side: (sum(x for x, _ in c) / len(c), sum(y for _, y in c) / len(c)) for side, c in middles.items()}

def middle(el):
    return middles[num(el, 'cx') < vw / 2]

def ringed(el):
    # a ring dot says where it sits on the ring, so the rainbow can run round it in order
    mx, my = middle(el)
    at = (round(num(el, 'cx') - mx), round(num(el, 'cy') - my))
    return el.replace('<circle ', '<circle data-ring="%d" ' % RING.index(at), 1) if at in RING else el

def dot(el, fill):
    return '<circle cx="%g" cy="%g" r="1.75" fill="%s"/>' % (num(el, 'cx'), num(el, 'cy'), fill)

def face(square):
    """the eye dots and the pupils: square eyes, or the old dot eyes with one pupil in each eye's middle"""
    whites, dark = [ringed(el) for el in eyes], []
    for p in pupils:
        if square or (num(p, 'cx'), num(p, 'cy')) == middle(p):
            dark.append(p)
        else:
            whites.append(dot(p, '#FFFFFF'))
    # On the site each eye is whole: a white dot sits under each pupil dot too, so a pupil that looks away leaves white
    # behind it instead of a dark hole. The pupil is drawn a hair bigger than the LED dots so no white fringe shows
    # around it wherever it sits.
    whites += [dot(p, '#FFFFFF') for p in dark]
    return whites, [re.sub(r'\br="[\d.]+"', 'r="2"', p) for p in dark]

def build(uid, square):
    # the frame-coloured parts follow the picked frame through --mark-frame, never the dots (a white frame matches them)
    frame = re.search(r'fill="(#[0-9A-Fa-f]{6})"', ''.join(ear_l)).group(1)
    def mf(els):
        return ''.join(el if el.startswith('<circle') else el.replace('fill="%s"' % frame, 'class="mf" fill="%s"' % frame)
                       for el in els)
    whites, dark = face(square)
    body = mf(rest).replace('id="f"', 'id="%s"' % uid).replace('url(#f)', 'url(#%s)' % uid)
    # the eye dots and pupils live inside the screen's clip group, so close it before adding them
    if body.endswith('</g>'):
        body = body[:-4] + '<g class="eyes">' + ''.join(whites) + '<g class="pupils">' + ''.join(dark) + '</g></g></g>'
    else:
        body += '<g class="eyes">' + ''.join(whites) + '<g class="pupils">' + ''.join(dark) + '</g></g>'
    return ('<svg class="mark" viewBox="%s" style="--mark-frame:%s" aria-hidden="true">'
            '<g class="ear ear-l">%s</g><g class="ear ear-r">%s</g>%s</svg>' % (view, frame, mf(ear_l), mf(ear_r), body))

def shapes(svg):
    # every shape with its fill, however the fills are grouped and whatever classes, ids or data it carries
    out, fills = [], []
    for el in re.findall(r'<g\b[^>]*>|</g>|<[a-z]+\b[^>]*/>', svg):
        if el.startswith('<g'):
            m = re.search(r'fill="([^"]+)"', el)
            fills.append(m.group(1) if m else fills[-1] if fills else None)
        elif el == '</g>':
            fills.pop()
        else:
            el = re.sub(r'\s(?:class|id|data-[\w-]+)="[^"]*"', '', el)
            out.append(el if 'fill=' in el or not fills or not fills[-1] else el[:-2] + ' fill="%s"/>' % fills[-1])
    return sorted(out)

path = os.path.join(root, 'index.html')
html = open(path).read()
n = [0]
def rep(m):
    # the first place is the header (square eyes), the second the footer (dot eyes)
    n[0] += 1
    return m.group(1) + build('mclip%d' % n[0], n[0] == 1) + m.group(3)
html = re.sub(r'(<!--mark-->)(.*?)(<!--/mark-->)', rep, html, flags=re.S)
if n[0] != 2:
    sys.exit('index.html has %d <!--mark--> places, not 2 (header and footer): nothing written' % n[0])
open(path, 'w').write(html)
print('mark %s -> %d places (header square eyes, footer dot eyes)' % (variant, n[0]))
stale = []
for name in ('404.html', 'hi/index.html', 'portal/index.html', 'link/done/index.html'):
    m = re.search(r'<symbol id="cow"[^>]*>(.*?)</symbol>', open(os.path.join(root, name)).read(), flags=re.S)
    if m and shapes(m.group(1)) != shapes(inner):
        stale.append(name)
if stale:
    sys.exit('%s draw their own cow (<symbol id="cow">), which no longer matches brand/mark-%s.svg: update it there'
             % (', '.join(stale), variant))
