import re, os
B = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
K = B + '/kit'
def inner(name):
    s = open(f'{B}/{name}').read()
    return re.sub(r'^\s*<svg[^>]*>|</svg>\s*$', '', s.strip()).strip()
MARK = {c: inner(f'mark-{c}.svg') for c in ['black','white','orange','teal']}
def placed(markinner, cx, cy, s):
    # the onesie mark: viewBox 136 x 108, centre (68, 54)
    return f'<g transform="translate({cx-68*s:.2f},{cy-54*s:.2f}) scale({s:.4f})">{markinner}</g>'
def svg(w,h,body): return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">{body}</svg>\n'
# App icon, full bleed
open(f'{K}/app-icon.svg','w').write(svg(1024,1024, '<rect width="1024" height="1024" fill="#0E1A22"/>'+placed(MARK['teal'],512,520,5.6)))
# iOS rounded preview (squircle-ish: rx 22.4%)
open(f'{K}/app-icon-ios.svg','w').write(svg(1024,1024, '<rect width="1024" height="1024" rx="229" fill="#0E1A22"/>'+placed(MARK['teal'],512,520,5.6)))
# Android adaptive foreground 432 (safe zone 264 diameter circle centred)
open(f'{K}/app-icon-android-foreground.svg','w').write(svg(432,432, placed(MARK['teal'],216,218,1.9)))
open(f'{K}/app-icon-android-background.svg','w').write(svg(432,432, '<rect width="432" height="432" fill="#0E1A22"/>'))
# Avatar 800, circle safe
open(f'{K}/avatar.svg','w').write(svg(800,800, '<rect width="800" height="800" fill="#0E1A22"/>'+placed(MARK['teal'],400,405,4.3)))
# GitHub avatar 1024, rounded-square safe
open(f'{K}/github-avatar.svg','w').write(svg(1024,1024, '<rect width="1024" height="1024" fill="#0E1A22"/>'+placed(MARK['teal'],512,520,5.8729)))
# Favicon: simplified mark for tiny sizes
fav = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
<rect x="10" y="2.5" width="2.6" height="5" rx="1.3" fill="#F5E9D6"/><rect x="19.4" y="2.5" width="2.6" height="5" rx="1.3" fill="#F5E9D6"/>
<ellipse cx="3.6" cy="11.5" rx="3.4" ry="1.9" fill="#77EDD7"/><ellipse cx="28.4" cy="11.5" rx="3.4" ry="1.9" fill="#77EDD7"/>
<rect x="4" y="6" width="24" height="21" rx="6.5" fill="#77EDD7"/>
<rect x="7" y="9" width="18" height="15" rx="4" fill="#0E1A22"/>
<rect x="9.5" y="11.5" width="5" height="5" rx="1.2" fill="#FFFFFF"/><rect x="17.5" y="11.5" width="5" height="5" rx="1.2" fill="#FFFFFF"/><rect x="11" y="13" width="2" height="2" rx="1" fill="#0E1A22"/><rect x="19" y="13" width="2" height="2" rx="1" fill="#0E1A22"/>
<rect x="10" y="18" width="12" height="5" rx="2.5" fill="#FFB7C9"/><rect x="13" y="20" width="2" height="2" rx="1" fill="#0E1A22"/><rect x="17" y="20" width="2" height="2" rx="1" fill="#0E1A22"/>
</svg>
'''
open(f'{K}/favicon.svg','w').write(fav)
