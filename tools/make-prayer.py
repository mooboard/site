#!/usr/bin/env python3
"""The Prayer face's Devanagari, drawn the way the board draws it, written into js/board.js.

  ~/.pixelwall-build/venv/bin/python tools/make-prayer.py [--firmware ~/.pixelwall-build/wt/release-2]

The board never typesets Devanagari itself: its prayer pack holds every line pre-rendered by HarfBuzz and FreeType
in Mukta ExtraBold (SIL OFL 1.1) as 2-bit strips, with each syllable's columns. This runs the firmware's own pack
code (tools/prayer_pack.py) on the Gayatri Mantra, so the site's strips are the board's, pixel for pixel, and no
font file ships with the site. The leading ॐ is cut out of the first line into a strip of its own (the glyph slot,
to be swapped for the Prayer glyph set later) with the gap that keeps the line where the board puts it.

The rhythm is a real recording's syllable timing (the pack's yt:nwRoHC83wx0, its first four lines); the site plays
no prayer audio. Needs uharfbuzz and freetype-py (the build venv has both)."""
import argparse
import base64
import json
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
BOARD = os.path.join(ROOT, 'js', 'board.js')
BEGIN, END = '/* prayer-data:begin (tools/make-prayer.py) */', '/* prayer-data:end */'

NAME_EN, NAME_HI = 'Gayatri Mantra', 'गायत्री मंत्र'
# The four lines as the site shows them, and each line's syllables as the recording times them: the Hindi syllables
# (which spell the line), the English syllables with their letter counts, grouped by word. Seconds from the line's
# first word.
LINES = [
    ('ॐ भूर्भुवः स्वः', 'Om Bhur Bhuvah Svah', 0.74, [
        ([('ॐ', .74, 1.4)], [('om', .74, 1.4)]),
        ([('भू', 1.5, 1.56), ('र्', 1.62, 2.24)], [('bhur', 1.5, 2.24)]),
        ([('भु', 2.36, 2.5), ('वः', 2.62, 2.92)], [('bhu', 2.36, 2.5), ('vah', 2.62, 2.92)]),
        ([('स्वः', 2.92, 3.28)], [('svah', 2.92, 3.28)])]),
    ('तत्सवितुर्वरेण्यं', 'Tat Savitur Varenyam', 4.12, [
        ([('त', 4.12, 4.14), ('त्', 4.22, 4.38)], [('tat', 4.12, 4.38)]),
        ([('स', 4.52, 4.54), ('वि', 4.64, 4.8), ('तु', 4.86, 5.02), ('र्', 5.08, 5.32)],
         [('sa', 4.52, 4.66), ('vi', 4.78, 4.88), ('tur', 5.0, 5.32)]),
        ([('व', 5.66, 5.74), ('रे', 5.9, 6.34), ('ण्यं', 6.72, 7.0)], [('va', 5.66, 5.74), ('ren', 5.9, 6.74), ('yam', 6.78, 7.0)])]),
    ('भर्गो देवस्य धीमहि', 'Bhargo Devasya Dhimahi', 7.62, [
        ([('भ', 7.62, 7.7), ('र्गो', 7.74, 8.14)], [('bhar', 7.62, 7.9), ('go', 8.04, 8.14)]),
        ([('दे', 8.46, 8.6), ('व', 8.88, 8.96), ('स्य', 9.12, 9.42)], [('de', 8.46, 8.6), ('vas', 8.88, 9.14), ('ya', 9.32, 9.42)]),
        ([('धी', 9.54, 9.62), ('म', 9.66, 10.02), ('हि', 10.08, 10.3)], [('dhi', 9.54, 9.68), ('ma', 10.0, 10.1), ('hi', 10.2, 10.3)])]),
    ('धियो यो नः प्रचोदयात्', 'Dhiyo Yo Nah Prachodayat', 11.08, [
        ([('धि', 11.08, 11.14), ('यो', 11.22, 11.46)], [('dhi', 11.08, 11.24), ('yo', 11.34, 11.46)]),
        ([('यो', 11.9, 12.02)], [('yo', 11.9, 12.02)]),
        ([('नः', 12.36, 12.58)], [('nah', 12.36, 12.58)]),
        ([('प्र', 12.78, 12.88), ('चो', 12.92, 13.14), ('द', 13.18, 13.2), ('या', 13.48, 13.72), ('त्', 13.78, 14.62)],
         [('pra', 12.78, 12.94), ('cho', 13.06, 13.2), ('da', 13.48, 13.6), ('yat', 13.7, 14.62)])]),
]
CYCLE = 14.68 - .74   # the recording's next "ॐ" comes 13.94 s after the first: the mantra's own repeat


def pack(levels):
    """2-bit levels, four to a byte, row-major, base64."""
    flat = [v for row in levels for v in row]
    flat += [0] * (-len(flat) % 4)
    out = bytearray((flat[i] | flat[i + 1] << 2 | flat[i + 2] << 4 | flat[i + 3] << 6) for i in range(0, len(flat), 4))
    return base64.b64encode(bytes(out)).decode('ascii')


def strip_doc(s, cols=None):
    c0, c1 = cols or (0, s.width)
    lv = [row[c0:c1] for row in s.levels]
    # the strip trimmed to its ink rows again (a cut can leave blank rows)
    r0 = next(i for i, row in enumerate(lv) if any(row))
    r1 = len(lv) - next(i for i, row in enumerate(reversed(lv)) if any(row))
    return {'w': c1 - c0, 'h': r1 - r0, 'top': s.top + r0, 'px': pack(lv[r0:r1])}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--firmware', default=os.path.expanduser('~/.pixelwall-build/wt/release-2'))
    args = ap.parse_args()
    sys.path.insert(0, os.path.join(args.firmware, 'tools'))
    import prayer_pack as pp

    r = pp.Renderer()
    texts = [hi for hi, _en, _t, _w in LINES] + [NAME_HI, pp.OM]
    ppem, baseline = pp.fit_aarti(r, texts, 'both')
    out = {'font': 'Mukta ExtraBold (SIL OFL 1.1), rendered by the firmware pack code', 'ppem': ppem, 'cycle': round(CYCLE, 3),
           'name': NAME_EN, 'lines': []}
    t00 = LINES[0][2]
    for hi, en, t0, words in LINES:
        syls = [s for hw, _ew in words for s in hw]
        ranges = pp.syllable_char_ranges(hi, [s[0] for s in syls])
        if ranges is None:
            raise SystemExit('%r: the syllables do not spell the line' % hi)
        s = pp.line_strip(r, hi, 'both', ppem, baseline, ranges)
        line = {'hi': hi, 'en': en, 'syl': [[round(a, 2), round(b, 2)] for a, b in s.syl],
                'hiT': [[int(round((a - t00) * 1000)), int(round((b - t00) * 1000))] for _t, a, b in syls],
                'words': [], 'enT': []}
        h0 = e0 = 0
        for hw, ew in words:
            line['words'].append([int(round((hw[0][1] - t00) * 1000)), int(round((max(x[2] for x in hw + ew) - t00) * 1000)),
                                  h0, len(hw), e0, len(ew)])
            for txt, a, b in ew:
                line['enT'].append([int(round((a - t00) * 1000)), int(round((b - t00) * 1000)), len(txt)])
            h0 += len(hw)
            e0 += len(ew)
        if hi.startswith(pp.OM):
            # the glyph slot: the ॐ's own columns, cut from the line as the board lays it out, and the gap after it
            a, d, left, right = r.ink_metrics(pp.OM, s.ppem)
            omW = right - left
            restX = next(c for c in range(omW, s.width) if any(row[c] for row in s.levels))
            line['slot'] = dict(strip_doc(s, (0, omW)), glyph='om')
            line['gap'] = restX - omW
            line['strip'] = strip_doc(s, (restX, s.width))
            line['syl'] = [[round(a - restX, 2), round(b - restX, 2)] for a, b in s.syl]   # syllable 0 is the slot
            line['syl'][0] = [-restX, -line['gap']]   # the slot's own columns, left of the rest
        else:
            line['strip'] = strip_doc(s)
        out['lines'].append(line)
    # the start screen's ॐ: centred in 21 rows here (the board's box is 22, from row 0; the site keeps row 0 dark)
    big = pp.centred_strip(r, pp.OM, 'om')
    out['om'] = strip_doc(big)
    om21 = None
    p = pp.PPEM_START * 2
    while p > 4:
        a, d, left, right = r.ink_metrics(pp.OM, p)
        if a + d <= 21 and right - left <= pp.MAX_WIDTH:
            om21 = pp.make_strip(r, pp.OM, 'om', p, a + (21 - (a + d)) // 2, 21, pp.akshara_ranges(pp.OM))
            break
        p -= pp.PPEM_STEP
    out['om'] = dict(strip_doc(om21), top=1 + om21.top)
    js = 'var PRAYER = ' + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ';'
    src = open(BOARD, encoding='utf-8').read()
    i, j = src.find(BEGIN), src.find(END)
    if i < 0 or j < 0:
        raise SystemExit('board.js has no prayer-data markers')
    src = src[:i + len(BEGIN)] + '\n  ' + js + '\n  ' + src[j:]
    open(BOARD, 'w', encoding='utf-8').write(src)
    print('ppem %.1f baseline %d; %d bytes of prayer data' % (ppem, baseline, len(js.encode('utf-8'))))
    for l in out['lines']:
        print(' ', l['hi'], l['strip']['w'], 'x', l['strip']['h'], 'top', l['strip']['top'], 'slot' if 'slot' in l else '',
              l.get('slot', {}).get('w', ''), l.get('gap', ''))


if __name__ == '__main__':
    main()
