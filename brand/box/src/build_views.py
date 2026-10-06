#!/usr/bin/env python3
"""Presentation pages for the box: flats.html (all faces upright) and mockup.html (CSS 3D)."""
import os, base64
from build_box import L, W, H, font_css, HERE

FONTS = font_css()

def face(name):
    return f'../faces/{name}.svg'

def flats():
    k = 2.0  # px per mm
    def f(name, label, w, h):
        return (f'<figure><img src="{face(name)}" style="width:{w*k}px;height:{h*k}px">'
                f'<figcaption>{label}</figcaption></figure>')
    return f'''<!doctype html><html><head><meta charset="utf-8"><style>{FONTS}
html,body{{margin:0;background:#E9FBF7}}
body{{padding:56px 60px 40px;font-family:Nunito;color:#0E1A22;width:{2*L*k+60}px}}
h1{{font-family:Fredoka;font-weight:600;font-size:34px;margin:0 0 6px;letter-spacing:-.01em;color:#0E6B5E}}
p.sub{{margin:0 0 36px;font-weight:700;font-size:16px;color:#0E6B5E;opacity:.8}}
.grid{{display:grid;grid-template-columns:{L*k}px {L*k}px;gap:40px 60px;align-items:start}}
figure{{margin:0}}img{{display:block;border-radius:6px;box-shadow:0 10px 30px rgba(14,107,94,.18)}}
figcaption{{font-weight:800;font-size:15px;margin-top:10px;letter-spacing:.02em;color:#0E6B5E}}
.pair{{display:flex;gap:40px}}
</style></head><body>
<h1>mooboard mailer</h1><p class="sub">Inside {L:.0f} × {W:.0f} × {H:.0f} mm. All faces upright.</p>
<div class="grid">
{f('lid', 'Lid, the front', L, W)}
{f('inside-lid', 'Inside the lid', L, W)}
{f('front', 'Front wall', L, H)}
{f('back-wall', 'Back wall', L, H)}
{f('bottom', 'Underside, the back', L, W)}
<div class="pair">{f('left', 'Left side', W, H)}{f('right', 'Right side, tick the colour', W, H)}</div>
</div></body></html>'''

def mockup(open_lid=False):
    k = 1.9 if not open_lid else 1.75  # px per mm
    l, w, h = L * k, W * k, H * k
    lid_angle = 196 if open_lid else 90
    board_uri = '../faces/board-top.svg'
    inner = ''
    if open_lid:
        # inner faces of the walls and the tray with the board under a card
        inner = f'''
<div class="f in" style="width:{l}px;height:{h}px;transform:translate(-50%,-50%) translateZ({w/2-1.5}px) rotateY(180deg)"></div>
<div class="f in" style="width:{l}px;height:{h}px;transform:translate(-50%,-50%) translateZ({-w/2+1.5}px)"></div>
<div class="f in" style="width:{w}px;height:{h}px;transform:translate(-50%,-50%) rotateY(-90deg) translateZ({l/2-1.5}px)"></div>
<div class="f in" style="width:{w}px;height:{h}px;transform:translate(-50%,-50%) rotateY(90deg) translateZ({l/2-1.5}px)"></div>
<div class="f tray" style="width:{l-3}px;height:{w-3}px;transform:translate(-50%,-50%) rotateX(90deg) translateZ({-(h/2-18*k)}px)">
  <img src="{board_uri}" style="position:absolute;left:{(l-3-518.6*k)/2}px;top:{(w-3-134.6*k)/2}px;width:{518.6*k}px;height:{134.6*k}px">
  <div class="card" style="left:{l*0.52}px;top:{w*0.18}px;width:{150*k}px;height:{100*k}px"><img src="../../mark-teal.svg"><b>hello.</b></div>
</div>'''
    faces = f'''
<div class="f" style="width:{l}px;height:{h}px;transform:translate(-50%,-50%) translateZ({w/2}px)"><img src="{face('front')}"><i class="sh" style="opacity:.0"></i></div>
<div class="f" style="width:{l}px;height:{h}px;transform:translate(-50%,-50%) rotateY(180deg) translateZ({w/2}px)"><img src="{face('back-wall')}"></div>
<div class="f" style="width:{w}px;height:{h}px;transform:translate(-50%,-50%) rotateY(90deg) translateZ({l/2}px)"><img src="{face('right')}"><i class="sh" style="opacity:.22"></i></div>
<div class="f" style="width:{w}px;height:{h}px;transform:translate(-50%,-50%) rotateY(-90deg) translateZ({l/2}px)"><img src="{face('left')}"><i class="sh" style="opacity:.3"></i></div>
<div class="f" style="width:{l}px;height:{w}px;transform:translate(-50%,-50%) rotateX(-90deg) translateZ({h/2}px)"><img src="{face('bottom')}"></div>
{inner}
<div class="lid" style="width:{l}px;height:{w}px;transform:translate(-50%,0) translateY({-h/2}px) translateZ({-w/2}px) rotateX({lid_angle}deg)">
  <div class="f2"><img src="{face('lid')}"><i class="sh" style="background:linear-gradient(180deg,rgba(255,255,255,.10),rgba(0,0,0,0) 40%)"></i></div>
  <div class="f2 back"><img src="{face('inside-lid')}"><i class="sh" style="opacity:.03"></i></div>
</div>'''
    rot = 'rotateX(-26deg) rotateY(-30deg)' if not open_lid else 'rotateX(-30deg) rotateY(-18deg)'
    ty = 30 if not open_lid else 110
    return f'''<!doctype html><html><head><meta charset="utf-8"><style>
html,body{{margin:0;height:100%;overflow:hidden}}
body{{background:radial-gradient(120% 90% at 50% 38%,#FFFFFF 0%,#E9FBF7 55%,#CDEDE6 100%)}}
.stage{{position:absolute;inset:0;perspective:2600px;perspective-origin:50% 30%}}
.shadow{{position:absolute;left:{57 if not open_lid else 53}%;top:{55 if not open_lid else 60}%;width:{l*1.25}px;height:{w*1.3}px;transform:translate(-50%,-10%);
 background:radial-gradient(closest-side,rgba(14,107,94,.38),rgba(14,107,94,.14) 55%,rgba(14,107,94,0));filter:blur(18px)}}
.box{{position:absolute;left:50%;top:50%;transform-style:preserve-3d;transform:translateY({ty}px) {rot}}}
.f,.lid{{position:absolute;left:0;top:0;transform-style:preserve-3d;backface-visibility:hidden}}
.f img,.f2 img{{width:100%;height:100%;display:block}}
.f .sh,.f2 .sh{{position:absolute;inset:0;background:#0E6B5E}}
.lid{{transform-origin:50% 0}}
.f2{{position:absolute;inset:0;backface-visibility:hidden}}
.f2.back{{transform:rotateX(180deg)}}
.in{{background:#F5E9D6;backface-visibility:hidden}}
.tray{{background:#E9DCC6;backface-visibility:visible}}
.card{{position:absolute;background:#FFFFFF;border-radius:6px;box-shadow:0 6px 14px rgba(0,0,0,.25);transform:rotate(-7deg);
 display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;font:600 28px Fredoka;color:#0E6B5E}}
.card img{{width:40%}}
{FONTS}
</style></head><body><div class="stage"><div class="shadow"></div><div class="box">{faces}</div></div></body></html>'''

if __name__ == '__main__':
    from build_box import board
    b = board(0, 0, uid='bt')
    open(os.path.join(HERE, '..', 'faces', 'board-top.svg'), 'w').write(
        f'<svg xmlns="http://www.w3.org/2000/svg" width="518.6mm" height="134.6mm" viewBox="0 0 518.6 134.6">{b}</svg>')
    open(os.path.join(HERE, 'flats.html'), 'w').write(flats())
    open(os.path.join(HERE, 'mockup.html'), 'w').write(mockup(False))
    open(os.path.join(HERE, 'mockup-open.html'), 'w').write(mockup(True))
    print('ok')
