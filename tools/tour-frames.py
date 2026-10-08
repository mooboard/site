#!/usr/bin/env python3
"""the panel frames for the buttons tour on /start + assets/tour/panel.png from the firmware's own 128 x 32 renders

  ~/.pixelwall-build/venv/bin/python tools/tour-frames.py <sim frames> <cards>

<sim frames> is a sim --all --scale 1 output with setup-reset-early setup-reset-cancel setup-reset-hold and
status-starting + <cards> holds portal-card.png guide-card.png and startup-portal.png from the round 8 panel + the
strip is the clock from the press to the last held frame 50 ms apart with the fill + 8 frames of the let go with the
fill fading over the portal card + the portal card + the guide card + the startup card every 100 ms + the startup card
with mooboard.co/portal + the let go is the firmware's drawResetFill in python and it must match the sim's own frames
before anything is written + needs pillow"""
import math
import os
import struct
import sys

from PIL import Image

W, H = 128, 32
AMBER, RED = (255, 150, 0), (255, 0, 0)                  # pw_scenes SetupCards.cpp kAmber kResetRed
PULSE_MS, SHOW_AFTER_MS, FADE_IN_MS, FADE_MS, RESET_MS = 1600, 1000, 300, 400, 10000
LEFT, RIGHT, TOP, BOTTOM = 1, 126, 1, 30                  # the fill leaves the edge ring dark
WIDTH = RIGHT - LEFT + 1
PRESS_S, LET_GO_S, FPS = 0.3, 3.3, 20                     # setup-reset-early holds boot from 0.3 s to 3.3 s
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'tour', 'panel.png')


def f32(x):
    return struct.unpack('f', struct.pack('f', x))[0]


# c's lround + halves go away from zero where python's round goes to even
def lround(x):
    return int(math.floor(x + 0.5)) if x >= 0 else -int(math.floor(0.5 - x))


# pw::lerp on 8 bit channels with the firmware's float sums
def lerp(a, b, t):
    t = min(1.0, max(0.0, t))
    return [int(f32(f32(a[k] + f32(f32(b[k] - a[k]) * t)) + 0.5)) for k in range(3)]


# drawResetFill over px + words is the coverage of factory resetting as the flashing card lays it out
def draw_fill(px, words, held, mono, level=1.0):
    if held < SHOW_AFTER_MS or level <= 0:
        return
    fade_in = min(1.0, f32((held - SHOW_AFTER_MS) / FADE_IN_MS))
    pulse = f32(0.85 + f32(0.15 * math.sin(f32(6.2831853 * f32((mono % PULSE_MS) / PULSE_MS)))))
    f = 1.0 if held >= RESET_MS else f32(held / RESET_MS)
    base = [lround(f32(AMBER[k] + f32((RED[k] - AMBER[k]) * f))) for k in range(3)]
    amber = [int(f32(base[k] * pulse)) & 255 for k in range(3)]
    alpha = f32(fade_in * min(1.0, level))
    exact = float(WIDTH) if held >= RESET_MS else f32(f32(held) * WIDTH / RESET_MS)
    whole = WIDTH if held >= RESET_MS else held * WIDTH // RESET_MS
    for i in range(min(whole + 1, WIDTH)):
        a = alpha if i < whole else f32(alpha * f32(exact - whole))
        if a > 0:
            for y in range(TOP, BOTTOM + 1):
                px[y][LEFT + i] = lerp(px[y][LEFT + i], amber, a)
    for y in range(TOP, BOTTOM + 1):
        for x in range(LEFT, LEFT + whole):
            if words[y][x]:
                px[y][x] = lerp(px[y][x], (0, 0, 0), f32(alpha * f32(words[y][x] / 255.0)))


def load(path):
    im = Image.open(path).convert('RGB')
    if im.size != (W, H):
        sys.exit('%s is not %d x %d' % (path, W, H))
    return [[list(im.getpixel((x, y))) for x in range(W)] for y in range(H)]


def image(px):
    im = Image.new('RGB', (W, H))
    im.putdata([tuple(px[y][x]) for y in range(H) for x in range(W)])
    return im


def held_at(i):
    t = i / FPS
    return int((t - PRESS_S) * 1000 + 0.5) if PRESS_S <= t < LET_GO_S else 0


# the port against the sim + the cancel's fade over the hi card exactly + the early let go outside the moving sun
def check(sim, words):
    cancel = os.path.join(sim, 'setup-reset-cancel')
    card = load(os.path.join(cancel, 'frame_0136.png'))
    for k in range(8):
        px = [[c[:] for c in r] for r in card]
        draw_fill(px, words, 5950, (126 + k) * 50, 1.0 - k * 50 / FADE_MS)
        if px != load(os.path.join(cancel, 'frame_%04d.png' % (126 + k))):
            sys.exit('the fill does not match setup-reset-cancel frame %d' % (126 + k))
    early = os.path.join(sim, 'setup-reset-early')
    clock = load(os.path.join(early, 'frame_0080.png'))
    for i in range(30, 75):
        px = [[c[:] for c in r] for r in clock]
        held = held_at(i)
        if held:
            draw_fill(px, words, held, i * 50)
        else:
            draw_fill(px, words, held_at(65), i * 50, 1.0 - (i - 66) * 50 / FADE_MS)
        real = load(os.path.join(early, 'frame_%04d.png' % i))
        if any(px[y][x] != real[y][x] for y in range(H) for x in range(W) if not (3 <= x <= 25 and y <= 22)):
            sys.exit('the fill does not match setup-reset-early frame %d' % i)


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    sim, cards = sys.argv[1], sys.argv[2]
    # the lit factory resetting card is the same layout in red on black + red's channel is the coverage
    flash = load(os.path.join(sim, 'setup-reset-hold', 'frame_0206.png'))
    words = [[flash[y][x][0] for x in range(W)] for y in range(H)]
    check(sim, words)
    early = os.path.join(sim, 'setup-reset-early')
    frames = [Image.open(os.path.join(early, 'frame_%04d.png' % i)).convert('RGB') for i in range(6, 66)]
    portal = load(os.path.join(cards, 'portal-card.png'))
    for k in range(8):
        px = [[c[:] for c in r] for r in portal]
        draw_fill(px, words, held_at(65), (66 + k) * 50, 1.0 - k * 50 / FADE_MS)
        frames.append(image(px))
    frames += [image(portal), image(load(os.path.join(cards, 'guide-card.png')))]
    frames += [Image.open(os.path.join(sim, 'status-starting', 'frame_%04d.png' % i)).convert('RGB') for i in range(0, 40, 2)]
    frames.append(image(load(os.path.join(cards, 'startup-portal.png'))))
    strip = Image.new('RGB', (W, H * len(frames)))
    for k, f in enumerate(frames):
        strip.paste(f, (0, k * H))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    strip.save(OUT, optimize=True)
    print('%d frames %d bytes %s' % (len(frames), os.path.getsize(OUT), os.path.normpath(OUT)))


if __name__ == '__main__':
    main()
