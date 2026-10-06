"""Copy the MooBoard mark from brand/ into index.html (header + footer) as inline SVG,
grouped so the site can animate it: ears wiggle, eyes blink, pupils look and change colour.
The variant's frame shows in its own fill until the visitor picks a frame. 404.html and hi/index.html draw their own
copy of the cow (<symbol id="cow">), so this exits 1 if theirs no longer matches the mark, or if index.html lost its
markers.
Run after the mark changes:  python3 tools/sync-mark.py [teal|sky|black|white|orange]"""
import re, sys, os

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
variant = sys.argv[1] if len(sys.argv) > 1 else 'teal'
src = open(os.path.join(root, 'brand', 'mark-%s.svg' % variant)).read()
view = re.search(r'viewBox="([^"]+)"', src).group(1)
vx, vy, vw, vh = [float(v) for v in view.split()]
inner = re.sub(r'^.*?<svg[^>]*>|</svg>\s*$', '', src.strip(), flags=re.S)

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

# On the site each eye is whole: a white dot sits under the pupil too, so a pupil that looks away leaves white behind
# it instead of a dark hole (the hole plus the moved pupil read as a little line). The pupil is drawn a hair bigger
# than the LED dots so no white fringe shows around it wherever it sits.
for p in pupils:
    eyes.append('<circle cx="%g" cy="%g" r="1.75" fill="#FFFFFF"/>' % (num(p, 'cx'), num(p, 'cy')))
pupils = [re.sub(r'\br="[\d.]+"', 'r="2"', p) for p in pupils]

def build(uid):
    # the frame-coloured parts follow the picked frame through --mark-frame, never the dots (a white frame matches them)
    frame = re.search(r'fill="(#[0-9A-Fa-f]{6})"', ''.join(ear_l)).group(1)
    def mf(els):
        return ''.join(el if el.startswith('<circle') else el.replace('fill="%s"' % frame, 'class="mf" fill="%s"' % frame)
                       for el in els)
    body = mf(rest).replace('id="f"', 'id="%s"' % uid).replace('url(#f)', 'url(#%s)' % uid)
    # the eye dots and pupils live inside the screen's clip group, so close it before adding them
    if body.endswith('</g>'):
        body = body[:-4] + '<g class="eyes">' + ''.join(eyes) + '<g class="pupils">' + ''.join(pupils) + '</g></g></g>'
    else:
        body += '<g class="eyes">' + ''.join(eyes) + '<g class="pupils">' + ''.join(pupils) + '</g></g>'
    return ('<svg class="mark" viewBox="%s" style="--mark-frame:%s" aria-hidden="true">'
            '<g class="ear ear-l">%s</g><g class="ear ear-r">%s</g>%s</svg>' % (view, frame, mf(ear_l), mf(ear_r), body))

def shapes(svg):
    # every shape with its fill, however the fills are grouped and whatever classes or ids it carries
    out, fills = [], []
    for el in re.findall(r'<g\b[^>]*>|</g>|<[a-z]+\b[^>]*/>', svg):
        if el.startswith('<g'):
            m = re.search(r'fill="([^"]+)"', el)
            fills.append(m.group(1) if m else fills[-1] if fills else None)
        elif el == '</g>':
            fills.pop()
        else:
            el = re.sub(r'\s(?:class|id)="[^"]*"', '', el)
            out.append(el if 'fill=' in el or not fills or not fills[-1] else el[:-2] + ' fill="%s"/>' % fills[-1])
    return sorted(out)

path = os.path.join(root, 'index.html')
html = open(path).read()
n = [0]
def rep(m):
    n[0] += 1
    return m.group(1) + build('mclip%d' % n[0]) + m.group(3)
html = re.sub(r'(<!--mark-->)(.*?)(<!--/mark-->)', rep, html, flags=re.S)
if n[0] != 2:
    sys.exit('index.html has %d <!--mark--> places, not 2 (header and footer): nothing written' % n[0])
open(path, 'w').write(html)
print('mark %s -> %d places' % (variant, n[0]))
stale = []
for name in ('404.html', 'hi/index.html'):
    m = re.search(r'<symbol id="cow"[^>]*>(.*?)</symbol>', open(os.path.join(root, name)).read(), flags=re.S)
    if m and shapes(m.group(1)) != shapes(inner):
        stale.append(name)
if stale:
    sys.exit('%s draw their own cow (<symbol id="cow">), which no longer matches brand/mark-%s.svg: update it there'
             % (' and '.join(stale), variant))
