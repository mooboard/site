#!/usr/bin/env python3
"""MooBoard retail mailer box: dieline + face artwork generator.

All units are millimetres. Run: python3 build_box.py
Writes ../box-dieline.svg, ../faces/*.svg and src/*.html wrappers used for the PDF,
the flats PNG and the 3D mockup (rendered with headless Chrome by render.sh).
"""
import base64, math, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
BOX = os.path.dirname(HERE)
BRAND = os.path.dirname(BOX)
FACES = os.path.join(BOX, 'faces')
os.makedirs(FACES, exist_ok=True)

# ---------------------------------------------------------------- box size
L, W, H = 545.0, 160.0, 60.0      # inside dimensions
TUCK = 52.0                       # lid tuck flap depth
HI = H - 2.0                      # inner (folded-in) wall height
TAB = 6.0                         # lock tab depth
EAR = 72.0                        # ear (dust flap) length on front and back walls
DUST = 55.0                       # lid dust flap depth
BLEED = 3.0

# ---------------------------------------------------------------- palette
SKY, DEEP, INK, MIST, CREAM, PINK = '#77EDD7', '#0E6B5E', '#0E1A22', '#E9FBF7', '#F5E9D6', '#FFB7C9'
SKY_HI = '#56CDE6'
FRAMES = [('Black', '#17191C'), ('White', '#F5F3EF'), ('Orange', '#FF7A21'), ('Teal', '#77EDD7')]
UNLIT, PANEL = '#1B1920', '#0A0A0D'
WARM, WARM_HALO, MARIGOLD = '#FFF3E2', '#FFD49A', '#FFB81C'

# ---------------------------------------------------------------- brand assets
def _inner(path):
    s = open(path).read()
    return re.sub(r'^.*?<svg[^>]*>|</svg>\s*$', '', s, flags=re.S).strip()

WORD = {c: _inner(os.path.join(BRAND, f'wordmark-{c}.svg')) for c in ('deep', 'white', 'sky', 'black')}
MARK = {c: _inner(os.path.join(BRAND, f'mark-{c}.svg')) for c in ('sky', 'black', 'white', 'orange')}

def font_css():
    def b64(f):
        return base64.b64encode(open(os.path.join(BRAND, 'fonts', f), 'rb').read()).decode()
    return ("@font-face{font-family:'Fredoka';font-weight:600;src:url(data:font/ttf;base64,%s) format('truetype')}"
            "@font-face{font-family:'Nunito';font-weight:200 1000;src:url(data:font/ttf;base64,%s) format('truetype')}"
            ".fd{font-family:'Fredoka';font-weight:600;letter-spacing:-0.01em}"
            ".nu{font-family:'Nunito';font-weight:800}"
            ".nr{font-family:'Nunito';font-weight:600}"
            ".tab{font-variant-numeric:tabular-nums}") % (b64('Fredoka-SemiBold.ttf'), b64('Nunito.ttf'))

def mark(x, y, h, c='sky'):
    w = h * 136 / 112
    return f'<svg x="{x:.2f}" y="{y:.2f}" width="{w:.2f}" height="{h:.2f}" viewBox="0 0 136 112">{MARK[c]}</svg>'

def word(x, y, h, c='deep'):
    w = h * 4483 / 775
    return f'<svg x="{x:.2f}" y="{y:.2f}" width="{w:.2f}" height="{h:.2f}" viewBox="0 0 4483 775">{WORD[c]}</svg>'

def lockup_size(mh):
    wh = mh * 0.6
    return mh * 136 / 112 + 0.35 * mh + wh * 4483 / 775, mh

def lockup(x, y, mh, wc='deep', mc='sky'):
    """Mark left of wordmark. Returns (svg, width). y is the top of the mark box."""
    wh = mh * 0.6
    mw = mh * 136 / 112
    gap = 0.35 * mh
    wy = y + mh * 60 / 112 - wh * 0.635
    return mark(x, y, mh, mc) + word(x + mw + gap, wy, wh, wc), mw + gap + wh * 4483 / 775

def text(x, y, s, size, cls='nu', fill=INK, anchor='start', extra=''):
    return (f'<text x="{x:.2f}" y="{y:.2f}" font-size="{size}" class="{cls}" fill="{fill}" '
            f'text-anchor="{anchor}" {extra}>{s}</text>')

# ---------------------------------------------------------------- LED face
BIG = {
    '1': ["   ##  ", "  ###  ", " ####  ", "   ##  ", "   ##  ", "   ##  ", "   ##  ", "   ##  ", "   ##  ", "   ##  ", " ######"],
    '0': [" ##### ", "##   ##", "##   ##", "##   ##", "##   ##", "##   ##", "##   ##", "##   ##", "##   ##", "##   ##", " ##### "],
}
SMALL = {
    '7': ["#####", "    #", "   # ", "  #  ", " #   ", " #   ", " #   "],
    '2': [" ### ", "#   #", "    #", "   # ", "  #  ", " #   ", "#####"],
    'o': [" # ", "# #", " # "],
}

def clock_pixels():
    """Returns {(col,row): colour} for a 128 x 32 clock scene: 10:10 and a sun with 72 degrees."""
    px = {}
    def blit(bm, c0, r0, scale, col):
        for r, line in enumerate(bm):
            for c, ch in enumerate(line):
                if ch == '#':
                    for dy in range(scale):
                        for dx in range(scale):
                            px[(c0 + c * scale + dx, r0 + r * scale + dy)] = col
    x = 12
    for ch in '10':
        blit(BIG[ch], x, 5, 2, WARM); x += 16
    x += 1
    for r0 in (11, 17):
        for dy in range(4):
            for dx in range(4):
                if not ((dx in (0, 3)) and (dy in (0, 3))):
                    px[(x + dx, r0 + dy)] = WARM
    x += 7
    for ch in '10':
        blit(BIG[ch], x, 5, 2, WARM); x += 16
    # sun
    cx, cy = 106, 11
    for c in range(cx - 9, cx + 10):
        for r in range(cy - 9, cy + 10):
            d = math.hypot(c - cx, r - cy)
            if d <= 3.7:
                px[(c, r)] = MARIGOLD
    for k in range(8):
        a = k * math.pi / 4
        for rr in (6, 7):
            px[(round(cx + rr * math.cos(a)), round(cy + rr * math.sin(a)))] = MARIGOLD
    blit(SMALL['7'], 98, 22, 1, '#FFE9C8'); blit(SMALL['2'], 104, 22, 1, '#FFE9C8'); blit(SMALL['o'], 110, 22, 1, '#FFE9C8')
    return px

def board(x, y, frame='#17191C', pixels=None, uid='b', scale=1.0):
    """The product front at real size (518.6 x 134.6), top-left at x,y, optional scale."""
    pixels = clock_pixels() if pixels is None else pixels
    s = [f'<g transform="translate({x:.2f},{y:.2f}) scale({scale})">']
    s.append(f'<defs><pattern id="{uid}u" width="4" height="4" patternUnits="userSpaceOnUse" x="3.3" y="3.3">'
             f'<circle cx="2" cy="2" r="1.05" fill="{UNLIT}"/></pattern>')
    cols = sorted(set(pixels.values()))
    grads = {}
    for i, c in enumerate(cols):
        gid = f'{uid}g{i}'
        grads[c] = gid
        s.append(f'<radialGradient id="{gid}"><stop offset="0" stop-color="{c}" stop-opacity="0.75"/>'
                 f'<stop offset="0.45" stop-color="{c}" stop-opacity="0.28"/><stop offset="1" stop-color="{c}" stop-opacity="0"/></radialGradient>')
    s.append('</defs>')
    # frame: 3.3 mm bezel with a 1 mm chamfer highlight
    s.append(f'<rect x="0" y="0" width="518.6" height="134.6" rx="2.2" fill="{frame}"/>')
    s.append(f'<rect x="0.5" y="0.5" width="517.6" height="133.6" rx="1.8" fill="none" stroke="#FFFFFF" stroke-opacity="0.10" stroke-width="0.8"/>')
    s.append(f'<rect x="3.3" y="3.3" width="512" height="128" fill="{PANEL}"/>')
    s.append(f'<rect x="3.3" y="3.3" width="512" height="128" fill="url(#{uid}u)"/>')
    halo, core = [], []
    for (c, r), col in pixels.items():
        cx, cy = 3.3 + 2 + 4 * c, 3.3 + 2 + 4 * r
        halo.append(f'<circle cx="{cx}" cy="{cy}" r="4.2" fill="url(#{grads[col]})"/>')
        core.append(f'<circle cx="{cx}" cy="{cy}" r="1.45" fill="{col}"/>')
    s.append(''.join(halo))
    s.append(''.join(core))
    # a very soft glass sheen
    s.append(f'<rect x="3.3" y="3.3" width="512" height="40" fill="url(#{uid}sh)" opacity="0.5"/>')
    s.append(f'<defs><linearGradient id="{uid}sh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.06"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient></defs>')
    s.append('</g>')
    return ''.join(s)

# ---------------------------------------------------------------- icons (24 grid, stroked)
ICONS = {
    'Lyrics':   '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
    'Weather':  '<circle cx="9" cy="8.5" r="3.2"/><path d="M9 2.2v1.2M3.2 8.5h1.2M4.9 4.4l.9.9M13.1 4.4l-.9.9"/><path d="M8 20h9.5a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.4 1.3A2.9 2.9 0 0 0 8 20z"/>',
    'Clocks':   '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
    'Lights':   '<path d="M9.5 18h5M10.5 21h3"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z"/>',
    'TV':       '<rect x="3" y="6" width="18" height="12.5" rx="2.5"/><path d="M8.5 21.5h7M9 2.5l3 3 3-3"/>',
    'Calendar': '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><circle cx="12" cy="15" r="1" fill="currentColor"/>',
    'Prayer':   '<path d="M3 14h18c0 3.6-4 6.2-9 6.2S3 17.6 3 14z"/><path d="M12 3.2c1.9 2.3 2.9 4 2.9 5.7a2.9 2.9 0 0 1-5.8 0c0-1.7 1-3.4 2.9-5.7z"/>',
    # in the box
    'Board':    '<rect x="2" y="8" width="20" height="8" rx="1.5"/><path d="M5 12h.01M8 12h.01M11 12h.01M14 12h.01"/>',
    'Cable':    '<rect x="4" y="3" width="6" height="5" rx="1.5"/><path d="M7 8v4a5 5 0 0 0 10 0v-1a3 3 0 0 1 6 0"/>',
    'Screws':   '<path d="M6 4h6M9 4v2M7 6h4l-.5 12L9 21l-1.5-3z"/><path d="M15 6h4l-.4 13h-3.2z"/>',
    'Card':     '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    'Recycle':  '<path d="M7 19H4.5a1.5 1.5 0 0 1-1.3-2.2L6 12M13 20h6.5a1.5 1.5 0 0 0 1.3-2.2L18 13M9.5 6.5l1.2-2.1a1.5 1.5 0 0 1 2.6 0L16 9"/><path d="M4 11l2 1 1-2M15 9l1.2.1.6-2.2M11 22l2-2-2-2"/>',
}

def icon(name, x, y, size, color, sw=1.8):
    k = size / 24
    return (f'<g transform="translate({x:.2f},{y:.2f}) scale({k:.4f})" fill="none" stroke="{color}" '
            f'stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round" color="{color}">{ICONS[name]}</g>')

def dots_field(w, h, color, pitch=4.0, r=0.7, uid='df', opacity=1.0):
    return (f'<defs><pattern id="{uid}" width="{pitch}" height="{pitch}" patternUnits="userSpaceOnUse">'
            f'<circle cx="{pitch/2}" cy="{pitch/2}" r="{r}" fill="{color}"/></pattern></defs>'
            f'<rect width="{w}" height="{h}" fill="url(#{uid})" opacity="{opacity}"/>')

def moo_led(x, y, pitch, color, halo=None, uid='ml'):
    """'moo' spelled in 5x7-ish LED dots."""
    glyphs = {
        'm': ["        ", "## ## ", "# # # #", "# # # #", "# # # #", "#  #  #", "#  #  #"],
    }
    m = ["         ", "         ", "#### ### ", "#  ##  # ", "#  #   # ", "#  #   # ", "#  #   # "]
    o = ["     ", "     ", " ### ", "#   #", "#   #", "#   #", " ### "]
    pts = []
    cx = 0
    for g in (m, o, o):
        for r, line in enumerate(g):
            for c, ch in enumerate(line):
                if ch == '#':
                    pts.append((cx + c, r))
        cx += len(g[0]) + 1
    s = []
    if halo:
        s.append(f'<defs><radialGradient id="{uid}"><stop offset="0" stop-color="{halo}" stop-opacity=".7"/>'
                 f'<stop offset="1" stop-color="{halo}" stop-opacity="0"/></radialGradient></defs>')
        s += [f'<circle cx="{x + c * pitch:.2f}" cy="{y + r * pitch:.2f}" r="{pitch * 0.95:.2f}" fill="url(#{uid})"/>' for c, r in pts]
    s += [f'<circle cx="{x + c * pitch:.2f}" cy="{y + r * pitch:.2f}" r="{pitch * 0.36:.2f}" fill="{color}"/>' for c, r in pts]
    return ''.join(s), cx * pitch

# ---------------------------------------------------------------- faces (upright, local coords)
def face_lid():
    """Top of the mailer: the board at actual size on Sky Teal."""
    w, h = L, W
    bx, by = (w - 518.6) / 2, (h - 134.6) / 2 - 1.5
    s = [f'<rect x="-3" y="-3" width="{w+6}" height="{h+6}" fill="{SKY}"/>']
    # soft cast shadow (vector: stacked translucent rounded rects)
    for i, (d, o) in enumerate([(5, .05), (3.5, .06), (2.2, .07), (1.2, .08)]):
        s.append(f'<rect x="{bx - d + 1:.2f}" y="{by - d + 3.5:.2f}" width="{518.6 + 2*d - 2:.2f}" height="{134.6 + 2*d:.2f}" rx="{3 + d}" fill="#06414D" opacity="{o}"/>')
    s.append(board(bx, by, uid='lid'))
    s.append(text(w - bx, h - 2.6, 'actual size', 3.2, 'nu', DEEP, 'end', 'letter-spacing="0.35"'))
    s.append(mark(bx - 0.5, h - 10.4, 8.4, 'white'))
    return w, h, ''.join(s)

def swatches(x, y, d, label_color, box_color, tick=None):
    """Four frame colour dots, each with a tick box under it."""
    s = []
    pitch = d * 1.9
    for i, (name, hexc) in enumerate(FRAMES):
        cx = x + i * pitch + d / 2
        if name == 'Teal':
            s.append(f'<circle cx="{cx:.2f}" cy="{y + d/2:.2f}" r="{d/2:.2f}" fill="#77EDD7" fill-opacity="0.75" stroke="#FFFFFF" stroke-width="0.6"/>')
            s.append(f'<circle cx="{cx - d*0.14:.2f}" cy="{y + d*0.36:.2f}" r="{d*0.16:.2f}" fill="#FFFFFF" opacity="0.55"/>')
        else:
            stroke = ' stroke="#FFFFFF" stroke-width="0.6"' if name != 'White' else f' stroke="{label_color}" stroke-opacity=".25" stroke-width="0.4"'
            s.append(f'<circle cx="{cx:.2f}" cy="{y + d/2:.2f}" r="{d/2:.2f}" fill="{hexc}"{stroke}/>')
        s.append(text(cx, y + d + 4.6, name, 3.4, 'nu', label_color, 'middle'))
        bs = 6.0
        s.append(f'<rect x="{cx - bs/2:.2f}" y="{y + d + 7.0:.2f}" width="{bs}" height="{bs}" rx="1" fill="#FFFFFF" stroke="{box_color}" stroke-width="0.5"/>')
        if tick == name:
            s.append(f'<path d="M{cx-1.3:.2f} {y+d+8.4:.2f}l1 1 2-2.4" fill="none" stroke="{INK}" stroke-width="0.7" stroke-linecap="round"/>')
    return ''.join(s), pitch * 4

def face_front():
    """Front wall: the lockup large, and the four frame colours with tick boxes."""
    w, h = L, H
    s = [f'<rect x="-3" y="-3" width="{w+6}" height="{h+6}" fill="{SKY}"/>']
    s.append(dots_field(w, h, SKY_HI, uid='dfF', r=0.8))
    lk, lw = lockup(24, 11, 38, 'white', 'white')
    s.append(f'<rect x="12" y="6" width="{lw + 24:.1f}" height="48" rx="12" fill="{SKY}"/>')
    s.append(lk)
    d = 12
    gw = 3 * d * 1.9 + d
    s.append(f'<rect x="{w - 24 - gw - 8:.1f}" y="6" width="{gw + 16:.1f}" height="48" rx="12" fill="{SKY}"/>')
    sw, swd = swatches(w - 24 - gw, 9, d, INK, INK)
    s.append(sw)
    return w, h, ''.join(s)

def face_side(which):
    w, h = W, H
    s = [f'<rect x="-3" y="-3" width="{w+6}" height="{h+6}" fill="{SKY}"/>']
    s.append(dots_field(w, h, SKY_HI, uid=f'dfS{which}', r=0.8))
    if which == 'left':
        s.append(f'<rect x="12" y="10" width="{w-24}" height="40" rx="12" fill="{SKY}"/>')
        s.append(mark((w - 36 * 136 / 112) / 2, 5, 36, 'white'))
        s.append(word((w - 9 * 4483 / 775) / 2, 43, 9, 'white'))
    else:
        s.append(f'<rect x="10" y="7" width="{w-20}" height="46" rx="12" fill="{SKY}"/>')
        sw, swd = swatches(0, 0, 16, INK, INK)
        s.append(f'<g transform="translate({(w - (3*16*1.9 + 16))/2:.2f},12)">{sw}</g>')
    return w, h, ''.join(s)

def face_back_wall():
    """Back wall (hinge side): what's in the box, small print, placeholders."""
    w, h = L, H
    s = [f'<rect x="-3" y="-3" width="{w+6}" height="{h+6}" fill="{SKY}"/>']
    s.append(dots_field(w, h, SKY_HI, uid='dfBW', r=0.8))
    # in the box
    x0 = 20
    s.append(f'<rect x="10" y="5" width="176" height="50" rx="12" fill="{SKY}"/>')
    for i, n in enumerate(['Board', 'Cable', 'Screws', 'Card']):
        cx = x0 + 14 + i * 36
        s.append(f'<circle cx="{cx:.1f}" cy="23" r="13" fill="#FFFFFF"/>')
        s.append(icon(n, cx - 9, 14, 18, DEEP, 1.9))
        s.append(text(cx, 44, n, 4.0, 'nu', INK, 'middle'))
    s.append(text(x0 + 2, 52.5, 'Charger sold separately', 3.2, 'nr', INK))
    # centre: made by + placeholder
    cx = w / 2
    s.append(f'<rect x="{cx - 90}" y="5" width="180" height="50" rx="12" fill="{SKY}"/>')
    s.append(text(cx, 16, 'Designed by mooboard', 5.2, 'fd', '#FFFFFF', 'middle'))
    s.append(f'<rect x="{cx - 82}" y="22" width="164" height="28" rx="3" fill="#FFFFFF" fill-opacity=".45" stroke="{INK}" stroke-width="0.4" stroke-dasharray="1.6 1.1"/>')
    s.append(text(cx, 31.5, 'PLACEHOLDER: company name and address', 3.6, 'nu', '#B3261E', 'middle'))
    s.append(text(cx, 38.5, 'country of origin, model number,', 3.0, 'nr', INK, 'middle'))
    s.append(text(cx, 44, 'compliance marks (FCC, CE, UKCA, WEEE)', 3.0, 'nr', INK, 'middle'))
    # right: recycling + web
    rx = w - 22
    s.append(f'<rect x="{rx - 70}" y="5" width="80" height="50" rx="12" fill="{SKY}"/>')
    s.append(icon('Recycle', rx - 20, 9, 20, INK, 1.6))
    s.append(text(rx, 38, 'mooboard.com', 4.4, 'nu', INK, 'end'))
    s.append(text(rx, 44.5, 'Recycle the box', 3.2, 'nr', INK, 'end'))
    s.append(text(rx, 53, 'moo.', 5.0, 'fd', '#FFFFFF', 'end'))
    return w, h, ''.join(s)

def face_bottom():
    """The underside, read as the back of the box: features, specs, barcode."""
    w, h = L, W
    s = [f'<rect x="-3" y="-3" width="{w+6}" height="{h+6}" fill="{INK}"/>']
    s.append(dots_field(w, h, '#1B2A33', uid='dfB', r=0.75))
    # feature row
    feats = ['Lyrics', 'Weather', 'Clocks', 'Lights', 'TV', 'Calendar', 'Prayer']
    x0, pitch, cy = 34, 50, 44
    for i, n in enumerate(feats):
        cx = x0 + i * pitch
        s.append(f'<circle cx="{cx}" cy="{cy}" r="15" fill="{SKY}"/>')
        s.append(icon(n, cx - 10, cy - 10, 20, INK, 1.9))
        s.append(text(cx, cy + 26, n, 6.0, 'fd', '#FFFFFF', 'middle'))
    # specs
    specs = [('128', '×32', 'pixels'), ('4096', '', 'LEDs'), ('52', ' cm', 'wide'), ('USB-C', '', 'power')]
    x = 19
    for big, small, lab in specs:
        s.append(f'<text x="{x}" y="134" font-size="22" class="fd tab" fill="#FFFFFF">{big}'
                 f'<tspan font-size="12" fill="{SKY}">{small}</tspan></text>')
        s.append(text(x + 0.6, 145, lab, 5.2, 'nu', SKY))
        x += {'128': 86, '4096': 72, '52': 64}.get(big, 0)
    # right column: mark + barcode placeholder
    bx = w - 23 - 100
    s.append(f'<rect x="{bx}" y="96" width="100" height="48" rx="3" fill="#FFFFFF"/>')
    import random
    rnd = random.Random(29)
    xx = bx + 10
    while xx < bx + 90:
        bw = rnd.choice([0.5, 0.5, 1.0, 1.5])
        s.append(f'<rect x="{xx:.2f}" y="101" width="{bw}" height="28" fill="{INK}"/>')
        xx += bw + rnd.choice([0.5, 0.5, 1.0, 1.5])
    s.append(text(bx + 50, 135, 'PLACEHOLDER: UPC / EAN', 3.0, 'nu', '#B3261E', 'middle'))
    s.append(text(bx + 50, 140.5, 'replace with the real code', 2.4, 'nr', INK, 'middle'))
    lk, lw = lockup(0, 0, 22, 'white', 'sky')
    s.append(f'<g transform="translate({w - 23 - lw:.2f},31)">{lk}</g>')
    return w, h, ''.join(s)

def face_inside_lid():
    """Printed on the reverse: seen when the lid opens. The moo surprise."""
    w, h = L, W
    s = [f'<rect x="-3" y="-3" width="{w+6}" height="{h+6}" fill="{CREAM}"/>']
    # cow spots
    spots = [(40, 30, 34, 22, 10), (512, 130, 36, 22, -14), (470, 26, 22, 14, 20), (80, 138, 26, 16, -8), (300, 150, 30, 12, 4), (250, 8, 18, 10, 0)]
    for x, y, rx, ry, rot in spots:
        s.append(f'<ellipse cx="{x}" cy="{y}" rx="{rx}" ry="{ry}" transform="rotate({rot} {x} {y})" fill="{INK}" opacity="0.9"/>')
    # speech bubble made like a tiny board
    bw, bh = 196, 72
    bx, by = w / 2 - bw / 2 + 40, h / 2 - bh / 2 - 6
    s.append(f'<rect x="{bx}" y="{by}" width="{bw}" height="{bh}" rx="18" fill="{INK}"/>')
    s.append(f'<path d="M{bx + 24} {by + bh - 1} l-26 22 l44 -22 z" fill="{INK}"/>')
    s.append(f'<defs><pattern id="ilu" width="6" height="6" patternUnits="userSpaceOnUse" x="{bx}" y="{by}">'
             f'<circle cx="3" cy="3" r="1.3" fill="{UNLIT}"/></pattern></defs>')
    s.append(f'<rect x="{bx + 8}" y="{by + 8}" width="{bw - 16}" height="{bh - 16}" rx="11" fill="url(#ilu)"/>')
    mo, mw = moo_led(0, 0, 6, PINK, PINK, uid='ilm')
    s.append(f'<g transform="translate({bx + (bw - mw) / 2 + 3:.2f},{by + 18:.2f})">{mo}</g>')
    # the mark, big, peeking from the lower left
    s.append(mark(bx - 138, h - 104, 110, 'sky'))
    s.append(text(bx + bw, by + bh + 16, 'Hello from the herd.', 8.0, 'fd', DEEP, 'end'))
    return w, h, ''.join(s)

def face_inner_wall(w, h, uid):
    s = [f'<rect x="-3" y="-3" width="{w+6}" height="{h+6}" fill="{CREAM}"/>']
    return w, h, ''.join(s)

FACE_FUNCS = {
    'lid': face_lid, 'front': face_front, 'left': lambda: face_side('left'), 'right': lambda: face_side('right'),
    'back-wall': face_back_wall, 'bottom': face_bottom, 'inside-lid': face_inside_lid,
}

# ---------------------------------------------------------------- dieline geometry
M = 26.0                          # sheet margin around the bleed
X = M + BLEED + TAB + HI + H      # left edge of the base panel
yT = M + BLEED
yLid = yT + TUCK
yBack = yLid + W
yBot = yBack + H
yFront = yBot + W
yFin = yFront + H
yEnd = yFin + HI
FLAT_W = X + L + H + HI + TAB + BLEED + M
FLAT_H = yEnd + TAB + BLEED + M

def cut_outline():
    """Closed outline of the blank, clockwise from the tuck flap's top left."""
    R = []  # right side, top to bottom (x >= X+L)
    xr = X + L
    R += [(xr - 2, yLid), (xr, yLid), (xr, yLid + 4)]
    # lid dust flap
    R += [(xr + DUST - 8, yLid + 14), (xr + DUST, yLid + 26), (xr + DUST, yLid + W - 26), (xr + DUST - 8, yLid + W - 14), (xr, yLid + W - 4)]
    R += [(xr, yBack + 2)]
    # back ear
    R += [(xr + EAR - 12, yBack + 8), (xr + EAR, yBack + 18), (xr + EAR, yBack + H - 3), (xr, yBack + H - 3), (xr, yBot)]
    # side wall + inner side wall with lock tab
    xs, xi = xr + H, xr + H + HI
    R += [(xs, yBot), (xs, yBot + 2), (xi, yBot + 8), (xi, yBot + W / 2 - 22), (xi + TAB, yBot + W / 2 - 18),
          (xi + TAB, yBot + W / 2 + 18), (xi, yBot + W / 2 + 22), (xi, yBot + W - 8), (xs, yBot + W - 2), (xs, yBot + W), (xr, yBot + W)]
    # front ear
    R += [(xr, yFront + 3), (xr + EAR, yFront + 3), (xr + EAR, yFront + H - 18), (xr + EAR - 12, yFront + H - 8), (xr, yFront + H - 2), (xr, yFin)]
    # inner front wall, right half of the bottom edge with tabs
    R += [(xr - 3, yFin + 3), (xr - 3, yEnd)]
    for tx in (X + 3 * L / 4,):
        R += [(tx + 24, yEnd), (tx + 20, yEnd + TAB), (tx - 20, yEnd + TAB), (tx - 24, yEnd)]
    R += [(X + L / 2, yEnd)]
    mirror = lambda p: (2 * X + L - p[0], p[1])
    Lside = [mirror(p) for p in reversed(R)]
    # tuck flap across the top (left to right), rounded corners handled in path building
    pts = Lside + [(X + 2, yLid)]
    d = 'M%.2f %.2f ' % R[0]
    d += ' '.join('L%.2f %.2f' % p for p in R[1:])
    d += ' ' + ' '.join('L%.2f %.2f' % p for p in Lside[1:])
    # tuck flap
    d += (f' L{X + 2:.2f} {yLid:.2f} L{X + 6:.2f} {yT + 14:.2f} Q{X + 8:.2f} {yT:.2f} {X + 22:.2f} {yT:.2f}'
          f' L{X + L - 22:.2f} {yT:.2f} Q{X + L - 8:.2f} {yT:.2f} {X + L - 6:.2f} {yT + 14:.2f} Z')
    return d

def cut_extras():
    """Internal cuts: thumb notch and lock slots."""
    cx = X + L / 2
    d = f'M{cx - 18:.2f} {yFin:.2f} A18 11 0 0 0 {cx + 18:.2f} {yFin:.2f} A18 11 0 0 0 {cx - 18:.2f} {yFin:.2f} Z '
    for tx in (X + L / 4, X + 3 * L / 4):
        d += f'M{tx - 20:.2f} {yFront - 5:.2f} h40 v2.2 h-40 Z '
    for sx in (X + 3, X + L - 5.2):
        d += f'M{sx:.2f} {yBot + W / 2 - 18:.2f} v36 h2.2 v-36 Z '
    return d

def fold_lines():
    xr = X + L
    segs = [
        (X + 2, yLid, xr - 2, yLid), (X, yBack, xr, yBack), (X, yBot, xr, yBot), (X, yFront, xr, yFront),
        (X, yFin, X + L / 2 - 18, yFin), (X + L / 2 + 18, yFin, xr, yFin),
        (X, yLid + 4, X, yLid + W - 4), (xr, yLid + 4, xr, yLid + W - 4),
        (X, yBack + 2, X, yBack + H - 3), (xr, yBack + 2, xr, yBack + H - 3),
        (X, yBot, X, yBot + W), (xr, yBot, xr, yBot + W),
        (X - H, yBot + 2, X - H, yBot + W - 2), (xr + H, yBot + 2, xr + H, yBot + W - 2),
        (X, yFront + 3, X, yFront + H - 2), (xr, yFront + 3, xr, yFront + H - 2),
    ]
    return ''.join(f'M{a:.2f} {b:.2f}L{c:.2f} {d:.2f}' for a, b, c, d in segs)

# face placement on the outside print: (face, x, y, rotation) ; rotation about the panel
def placements():
    xr = X + L
    return [
        ('lid', X, yLid, 180),
        ('back-wall', X, yBack, 0),
        ('bottom', X, yBot, 0),
        ('front', X, yFront, 180),
        ('left', X - H, yBot, -90),
        ('right', xr, yBot, 90),
    ]

def place(face_svg, fw, fh, x, y, rot):
    """Place an upright face so that it fills the panel at x,y with the given rotation."""
    if rot == 0:
        t = f'translate({x:.2f},{y:.2f})'
    elif rot == 180:
        t = f'translate({x + fw:.2f},{y + fh:.2f}) rotate(180)'
    elif rot == 90:   # panel is fh wide, fw tall; face's down points to -x (towards the base on the left)
        t = f'translate({x + fh:.2f},{y:.2f}) rotate(90)'
    elif rot == -90:  # face's down points to +x
        t = f'translate({x:.2f},{y + fw:.2f}) rotate(-90)'
    return f'<g transform="{t}">{face_svg}</g>'

def dieline_sheet(inside=False, ox=0.0):
    """One print side of the blank. inside=True draws the reverse side (mirrored)."""
    cut = cut_outline()
    mir = f'translate({FLAT_W:.2f},0) scale(-1,1)' if inside else ''
    s = [f'<g transform="translate({ox:.2f},0)">' if not inside else f'<g transform="translate({ox:.2f},0)">']
    g_open = f'<g transform="{mir}">' if inside else '<g>'
    # the ground with bleed
    ground = WHITE_KRAFT if inside else SKY
    s.append(f'<g id="{"inside" if inside else "outside"}-art">')
    if inside:
        s.append(f'<g transform="translate({FLAT_W:.2f},0) scale(-1,1)">'
                 f'<path d="{cut}" fill="{ground}" stroke="{ground}" stroke-width="{2*BLEED}" stroke-linejoin="round"/></g>')
        fw, fh, art = face_inside_lid()
        # lid on the reverse: mirrored x position, upright (tuck at the top)
        s.append(f'<clipPath id="clipIL"><rect x="{FLAT_W - X - L - BLEED:.2f}" y="{yLid - TUCK - BLEED:.2f}" width="{L + 2*BLEED}" height="{W + TUCK + BLEED}"/></clipPath>')
        s.append(f'<g clip-path="url(#clipIL)">{place(art, fw, fh, FLAT_W - X - L, yLid, 0)}'
                 f'<rect x="{FLAT_W - X - L:.2f}" y="{yT - BLEED:.2f}" width="{L}" height="{TUCK + BLEED}" fill="{CREAM}"/>'
                 f'{text(FLAT_W - X - L / 2, yT + 30, "moo.", 12, "fd", DEEP, "middle")}</g>')
    else:
        s.append(f'<path d="{cut}" fill="{ground}" stroke="{ground}" stroke-width="{2*BLEED}" stroke-linejoin="round"/>')
        # inner walls on the outside print face inwards once folded: cream
        s.append(f'<rect x="{X - 2:.2f}" y="{yFin:.2f}" width="{L + 4}" height="{HI + TAB + BLEED}" fill="{CREAM}"/>')
        s.append(f'<rect x="{X - H - HI - TAB - BLEED:.2f}" y="{yBot - 1:.2f}" width="{HI + TAB + BLEED}" height="{W + 2}" fill="{CREAM}"/>')
        s.append(f'<rect x="{X + L + H:.2f}" y="{yBot - 1:.2f}" width="{HI + TAB + BLEED}" height="{W + 2}" fill="{CREAM}"/>')
        s.append(f'<g transform="translate({X + L / 2:.2f},{yFin + HI / 2 + 4:.2f})">{text(0, 0, "hi.", 10, "fd", DEEP, "middle")}</g>')
        # tuck flap reads as the lid's front edge
        s.append(f'<g transform="translate({X + L / 2:.2f},{yT + 26:.2f}) rotate(180)">{text(0, 0, "open here", 5, "fd", "#FFFFFF", "middle")}</g>')
        for name, x, y, rot in placements():
            fw, fh, art = FACE_FUNCS[name]()
            s.append(place(art, fw, fh, x, y, rot))
    s.append('</g>')
    # technical layers
    s.append(g_open)
    s.append(f'<path class="bleed" d="{cut}" fill="none"/>')
    s.append(f'<path class="cut" d="{cut}"/><path class="cut" d="{cut_extras()}"/>')
    s.append(f'<path class="fold" d="{fold_lines()}"/>')
    s.append('</g></g>')
    return ''.join(s)

WHITE_KRAFT = '#FBFAF7'

def bleed_ring_defs(cut):
    # outer bleed ring: stroke 2*bleed minus the fill of the blank minus a slightly thinner stroke
    return (f'<mask id="bleedmask" maskUnits="userSpaceOnUse">'
            f'<path d="{cut}" fill="none" stroke="#fff" stroke-width="{2*BLEED + 0.3}"/>'
            f'<path d="{cut}" fill="#000"/>'
            f'<path d="{cut}" fill="none" stroke="#000" stroke-width="{2*BLEED - 0.3}"/></mask>')

def dimension(x1, y1, x2, y2, label, off=0, vertical=False):
    s = f'<path class="dim" d="M{x1:.2f} {y1:.2f}L{x2:.2f} {y2:.2f}" marker-start="url(#arr)" marker-end="url(#arr)"/>'
    mx, my = (x1 + x2) / 2, (y1 + y2) / 2
    if vertical:
        s += f'<g transform="translate({mx - 2:.2f},{my:.2f}) rotate(-90)">{text(0, 0, label, 4.5, "nu", "#555", "middle")}</g>'
    else:
        s += text(mx, my - 2, label, 4.5, 'nu', '#555', 'middle')
    return s

def build_dieline():
    gap = 40.0
    SW = FLAT_W * 2 + gap
    LEG = 118.0
    SH = FLAT_H + LEG
    cut = cut_outline()
    s = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{SW:.1f}mm" height="{SH:.1f}mm" viewBox="0 0 {SW:.1f} {SH:.1f}">']
    s.append(f'<title>mooboard mailer dieline, inside {L:.0f} x {W:.0f} x {H:.0f} mm, scale 1:1</title>')
    s.append('<style>' + font_css() +
             '.cut{fill:none;stroke:#E6007E;stroke-width:0.5}'
             '.fold{fill:none;stroke:#00A0E0;stroke-width:0.5;stroke-dasharray:4 2.5}'
             '.bleed{fill:none;stroke:#7A7A7A;stroke-width:' + str(2 * BLEED + 0.3) + ';stroke-dasharray:1.5 1.5}'
             '.dim{fill:none;stroke:#555;stroke-width:0.3}</style>')
    s.append('<defs>' + bleed_ring_defs(cut) +
             '<marker id="arr" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="4" markerHeight="4" orient="auto-start-reverse">'
             '<path d="M0 0L6 3L0 6z" fill="#555"/></marker></defs>')
    s.append(f'<rect width="{SW:.1f}" height="{SH:.1f}" fill="#FFFFFF"/>')
    # bleed ring drawn via the mask on a dashed thick stroke
    out = dieline_sheet(False, 0).replace('class="bleed"', 'class="bleed" mask="url(#bleedmask)"')
    ins = dieline_sheet(True, FLAT_W + gap).replace('class="bleed"', 'class="bleed" mask="url(#bleedmask)"')
    s.append(out)
    s.append(ins)
    # sheet labels
    s.append(text(M, M - 8, 'OUTSIDE  (printed side, as seen from outside)', 6, 'nu', INK))
    s.append(text(FLAT_W + gap + M, M - 8, 'INSIDE  (reverse side, as seen when the lid is open)', 6, 'nu', INK))
    # dimensions on the outside sheet
    dy = yEnd + TAB + 12
    s.append(dimension(X, dy, X + L, dy, f'L {L:.0f}'))
    s.append(dimension(X - 8, yBot, X - 8, yBot + W, f'W {W:.0f}', vertical=True) if False else '')
    s.append(dimension(X + L + H + HI + TAB + 10, yBot, X + L + H + HI + TAB + 10, yBot + W, f'W {W:.0f}', vertical=True))
    s.append(dimension(X + L + H + HI + TAB + 10, yFront, X + L + H + HI + TAB + 10, yFin, f'H {H:.0f}', vertical=True))
    # legend
    ly = FLAT_H + 8
    s.append(f'<line x1="{M}" y1="{ly - 4}" x2="{SW - M}" y2="{ly - 4}" stroke="#DDD" stroke-width="0.4"/>')
    lx = M
    s.append(mark(lx, ly + 6, 30, 'sky'))
    s.append(word(lx + 44, ly + 12, 14, 'deep'))
    s.append(text(lx + 44, ly + 40, 'Mailer box, roll end front tuck (FEFCO 0427 style)', 6, 'nu', INK))
    s.append(text(lx + 44, ly + 50, 'Draft 1, 2026-09-29. Scale 1:1, units mm.', 5, 'nr', '#555'))
    items = [
        ('cut', 'Cut'), ('fold', 'Fold (crease)'), ('bleed', 'Bleed 3 mm outside the cut'),
    ]
    lx2 = lx + 250
    for i, (cls, lab) in enumerate(items):
        yy = ly + 12 + i * 12
        if cls == 'bleed':
            s.append(f'<line x1="{lx2}" y1="{yy}" x2="{lx2 + 30}" y2="{yy}" stroke="#7A7A7A" stroke-width="0.4" stroke-dasharray="1.5 1.5"/>')
        else:
            s.append(f'<line x1="{lx2}" y1="{yy}" x2="{lx2 + 30}" y2="{yy}" class="{cls}"/>')
        s.append(text(lx2 + 36, yy + 2, lab, 5, 'nu', INK))
    lx3 = lx2 + 190
    spec = [
        f'Inside  {L:.0f} x {W:.0f} x {H:.0f} mm',
        'Product  518.6 x 134.6 x 44 mm, ~13 mm clearance each side',
        'Board  E flute, 1.5 mm, white outside, kraft or white inside',
        'Print  outside CMYK + inside 1 colour area (lid)',
        'Insert  moulded pulp or folded E flute cradle, 3 mm pad under the board,',
        '             13 mm accessory layer on top (cable, screw bag, quick-start card)',
    ]
    for i, t in enumerate(spec):
        s.append(text(lx3, ly + 12 + i * 8.5, t, 4.6, 'nr' if i else 'nu', INK))
    lx4 = lx3 + 250
    s.append(text(lx4, ly + 12, 'Blank', 5, 'nu', INK))
    s.append(text(lx4, ly + 21, f'{FLAT_W - 2*M - 2*BLEED:.0f} x {FLAT_H - 2*M - 2*BLEED:.0f} mm flat', 4.6, 'nr', INK))
    s.append(text(lx4, ly + 34, 'Check with the box maker', 5, 'nu', '#B3261E'))
    s.append(text(lx4, ly + 43, 'flute allowances, tab and slot fit,', 4.6, 'nr', INK))
    s.append(text(lx4, ly + 51.5, 'glue free lock, final insert.', 4.6, 'nr', INK))
    s.append('</svg>')
    svg = ''.join(s)
    open(os.path.join(BOX, 'box-dieline.svg'), 'w').write(svg)
    return svg, SW, SH

def write_faces():
    css = '<style>' + font_css() + '</style>'
    out = {}
    for name, fn in FACE_FUNCS.items():
        fw, fh, art = fn()
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{fw}mm" height="{fh}mm" viewBox="0 0 {fw} {fh}">'
               f'{css}<g clip-path="url(#c)"><clipPath id="c"><rect width="{fw}" height="{fh}"/></clipPath>{art}</g></svg>')
        open(os.path.join(FACES, f'{name}.svg'), 'w').write(svg)
        out[name] = (fw, fh)
    return out

if __name__ == '__main__':
    svg, SW, SH = build_dieline()
    sizes = write_faces()
    html = (f'<!doctype html><html><head><meta charset="utf-8"><style>@page{{size:{SW:.1f}mm {SH:.1f}mm;margin:0}}'
            f'html,body{{margin:0;padding:0}}svg{{display:block}}</style></head><body>{svg}</body></html>')
    open(os.path.join(HERE, 'dieline-print.html'), 'w').write(html)
    print('sheet mm', round(SW, 1), round(SH, 1), 'flat', round(FLAT_W, 1), round(FLAT_H, 1))
    print(sizes)
