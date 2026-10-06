"""Copy the MooBoard mark from brand/ into index.html (header + footer) as inline SVG,
grouped so the site can animate it: ears wiggle, eyes blink, pupils look and change colour.
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
    body = ''.join(rest).replace('id="f"', 'id="%s"' % uid).replace('url(#f)', 'url(#%s)' % uid)
    # the eye dots and pupils live inside the screen's clip group, so close it before adding them
    if body.endswith('</g>'):
        body = body[:-4] + '<g class="eyes">' + ''.join(eyes) + '<g class="pupils">' + ''.join(pupils) + '</g></g></g>'
    else:
        body += '<g class="eyes">' + ''.join(eyes) + '<g class="pupils">' + ''.join(pupils) + '</g></g>'
    # the frame-coloured parts follow the chosen frame colour through --mark-frame
    frame = re.search(r'fill="(#[0-9A-Fa-f]{6})"', ''.join(ear_l)).group(1)
    ears_l = ''.join(ear_l).replace('fill="%s"' % frame, 'class="mf" fill="%s"' % frame)
    ears_r = ''.join(ear_r).replace('fill="%s"' % frame, 'class="mf" fill="%s"' % frame)
    body = body.replace('fill="%s"' % frame, 'class="mf" fill="%s"' % frame)
    return ('<svg class="mark" viewBox="%s" aria-hidden="true"><g class="ear ear-l">%s</g><g class="ear ear-r">%s</g>%s</svg>'
            % (view, ears_l, ears_r, body))

path = os.path.join(root, 'index.html')
html = open(path).read()
n = [0]
def rep(m):
    n[0] += 1
    return m.group(1) + build('mclip%d' % n[0]) + m.group(3)
html = re.sub(r'(<!--mark-->)(.*?)(<!--/mark-->)', rep, html, flags=re.S)
open(path, 'w').write(html)
print('mark %s -> %d places' % (variant, n[0]))
