"""Self-check: every lyric line in every timing file gets lit during playback, and radio.json's previews add up.

Mirrors the board's lyric wheel (js/board.js activeLineIndex, wordState, sheetOf) over js/music.js loadTiming: the centre
line is the last line whose start has passed (a line that starts no later than the one before it is never the centre),
it stays there until the next line starts or the song ends, and a word lights once playback passes its t0. A word
with no text is not drawn. A line passes if one of its drawn words starts while it is the centre line.
The radio's lines come from lrclib.net in the browser, so for music/radio.json this only checks that each preview
sits inside its song ('at', 'dur') and that its onsets are in order inside the 30 s preview.
Run:  python3 tools/check-lyrics.py        (exit 1 on any unlit line or bad radio entry)
"""
import json, glob, os, sys

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
bad = 0
for f in sorted(glob.glob(os.path.join(root, 'music', 'archive', '*.timing.json'))):
    with open(f) as fh:
        j = json.load(fh)
    off = j.get('offsetMs', 0) / 1000
    L = [l for l in j['lines'] if l.get('words')]
    for l in L:
        l['t0'] = l['words'][0]['t0'] + off
    length = j.get('length') or L[-1]['words'][-1]['t1'] + off + .6
    unlit = 0
    for i, l in enumerate(L):
        start = max(x['t0'] for x in L[:i + 1])
        end = min(L[i + 1]['t0'] if i + 1 < len(L) else length, length)
        parts = str(l.get('en') or l.get('text') or '').split()
        drawn = [w for k, w in enumerate(l['words']) if w.get('text') or w.get('w') or k < len(parts)]
        if not any(start <= w['t0'] + off < end for w in drawn):
            unlit += 1
            print('UNLIT %s line %d (starts %.2f, centre %.2f-%.2f)' % (os.path.basename(f), i + 1, l['t0'], start, end))
    print('%-22s %d lines %s' % (os.path.basename(f), len(L), 'ok' if not unlit else 'UNLIT %d' % unlit))
    bad += unlit

with open(os.path.join(root, 'music', 'radio.json')) as fh:
    radio = json.load(fh)
rbad = 0
for t in radio['tracks']:
    at, dur, on = t['at'], t.get('dur'), t.get('onsets') or []
    if at < -1 or (dur and at + 29 > dur):
        rbad += 1
        print('BAD radio %s: the preview starts at %.3f s, outside the %s s song' % (t['id'], at, dur))
    if on != sorted(on) or (on and (on[0] < 0 or on[-1] > 30.5)):
        rbad += 1
        print('BAD radio %s: onsets out of order or outside the 30 s preview' % t['id'])
print('%-22s %d tracks %s' % ('radio.json', len(radio['tracks']), 'ok' if not rbad else 'BAD %d' % rbad))
sys.exit(1 if bad or rbad else 0)
