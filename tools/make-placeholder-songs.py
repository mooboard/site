"""Writes music/archive/playlist.json and music/archive/<id>.timing.json for the five placeholder tracks.

Every melody, chord pattern and lyric here is original, written for MooBoard. The site plays them live with
Web Audio (js/music.js) while a track has no audio file ("src": null). When the real songs arrive, set "src"
to the audio file and replace the timing file; the "synth" block is then ignored.

Run:  python3 tools/make-placeholder-songs.py
"""
import json, os, random

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'music', 'archive')

NOTE = {'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11}
MAJOR = [0, 2, 4, 5, 7, 9, 11]
MINOR = [0, 2, 3, 5, 7, 8, 10]

TRACKS = [
    dict(id='red', title='Red', artist='mooboard', genre='Pop country', tint='#E0343C',
         style='country', bpm=104, key='G', scale=MAJOR, bars_per_line=2, seed=7,
         chords=[('G', 'maj'), ('C', 'maj'), ('D', 'maj'), ('G', 'maj')],
         rhythm=[0, 4, 8, 10, 12, 16, 20, 24, 28],
         lyrics=['red barn heart', 'boots in the clover', 'sing it out loud', 'moo till it is over',
                 'red sky tonight', 'red sky tonight']),
    dict(id='yellow', title='Yellow', artist='mooboard', genre='Piano rock', tint='#FFD23F',
         style='piano', bpm=120, key='C', scale=MAJOR, bars_per_line=2, seed=3,
         chords=[('C', 'maj'), ('G', 'maj'), ('A', 'min'), ('F', 'maj')],
         rhythm=[0, 4, 6, 8, 12, 16, 20, 22, 24, 28],
         lyrics=['yellow morning', 'sun on the keys', 'open the window', 'moo with the breeze',
                 'we light it up', 'yellow and free']),
    dict(id='blue', title='Blue', artist='mooboard', genre='Hyperpop', tint='#2F6BFF',
         style='hyper', bpm=160, key='E', scale=MAJOR, bars_per_line=2, seed=11,
         chords=[('E', 'maj'), ('C#', 'min'), ('A', 'maj'), ('B', 'maj')],
         rhythm=[0, 2, 4, 6, 8, 12, 14, 16, 18, 20, 24, 28],
         lyrics=['blue blue blue', 'zoom through the sky', 'electric moo', 'turn it up high',
                 'pixel rain', 'beep boop blue', 'brighter than', 'the whole moon']),
    dict(id='violet', title='Violet', artist='mooboard', genre='Late night R&B', tint='#8F00FF',
         style='rnb', bpm=78, key='D', scale=MINOR, bars_per_line=2, seed=5,
         chords=[('D', 'min7'), ('G', 'dom7'), ('C', 'maj7'), ('A', 'min7')],
         rhythm=[0, 3, 6, 8, 12, 16, 19, 22, 24],
         lyrics=['violet midnight', 'soft glow on the wall', 'hum a little moo', 'take it slow']),
    dict(id='heat', title='Heat', artist='mooboard', genre='Psych pop', tint='#FF7A2F', tint2='#FF2E88',
         style='psych', bpm=100, key='A', scale=MINOR, bars_per_line=2, seed=9,
         chords=[('A', 'min7'), ('F', 'maj7'), ('C', 'maj7'), ('G', 'maj')],
         rhythm=[0, 3, 6, 8, 11, 14, 16, 19, 22, 24],
         lyrics=['feel the heat', 'orange into pink', 'melting slow', 'deeper than you think',
                 'moo in the haze', 'feel the heat']),
]

QUALITY = {'maj': [0, 4, 7], 'min': [0, 3, 7], 'min7': [0, 3, 7, 10], 'dom7': [0, 4, 7, 10], 'maj7': [0, 4, 7, 11]}


def build(t):
    rnd = random.Random(t['seed'])
    step = 60.0 / t['bpm'] / 4                      # one 16th note
    line_steps = 16 * t['bars_per_line']
    key = NOTE[t['key']]
    scale = [key + 60 + s + o for o in (-12, 0, 12) for s in t['scale']]
    lead, bass, chords, lines = [], [], [], []
    prev = key + 67
    for li, text in enumerate(t['lyrics']):
        root, q = t['chords'][li % len(t['chords'])]
        r = NOTE[root]
        tones = [((r + i) % 12) for i in QUALITY[q]]
        base = li * line_steps * step
        chords.append([round(base, 3), [48 + ((r + i - 48) % 12) + 12 for i in QUALITY[q]], round(line_steps * step, 3)])
        for b in range(t['bars_per_line'] * 4):     # bass on every beat, root and fifth
            n = 36 + (r % 12) + (7 if b % 4 == 2 else 0) + (12 if t['style'] == 'hyper' and b % 2 else 0)
            bass.append([round(base + b * 4 * step, 3), n, round(3.4 * step, 3)])
        ons = t['rhythm']
        notes = []
        for k, s in enumerate(ons):
            end = ons[k + 1] if k + 1 < len(ons) else line_steps
            ln = end - s
            cands = [n for n in scale if abs(n - prev) <= 5] or scale
            chord_c = [n for n in cands if n % 12 in tones]
            pool = chord_c if (s % 8 == 0 or k == len(ons) - 1) and chord_c else cands
            n = rnd.choice(pool)
            if n > 81: n -= 12
            if n < 62: n += 12
            prev = n
            notes.append((s, n, ln))
            lead.append([round(base + s * step, 3), n, round(ln * step * .92, 3)])
        words = text.split(' ')
        wl = []
        for i, w in enumerate(words):
            oi = round(i * len(notes) / len(words))
            t0 = base + notes[oi][0] * step
            nxt = round((i + 1) * len(notes) / len(words))
            t1 = base + (notes[nxt][0] * step if nxt < len(notes) else line_steps * step)
            wl.append({'t0': round(t0, 3), 't1': round(t1, 3)})
        lines.append({'en': text, 'words': wl})
    length = round(len(t['lyrics']) * line_steps * step, 3)
    synth = {'style': t['style'], 'bpm': t['bpm'], 'length': length, 'lead': lead, 'bass': bass, 'chords': chords}
    # same shape as the Prayer mode timings: lines[].en is the text, words[] line up with its words
    timing = {'title': t['title'], 'artist': t['artist'], 'length': length, 'offsetMs': 0, 'lines': lines}
    return synth, timing


def main():
    os.makedirs(OUT, exist_ok=True)
    playlist = []
    for t in TRACKS:
        synth, timing = build(t)
        tf = 'music/archive/%s.timing.json' % t['id']
        with open(os.path.join(ROOT, tf), "w") as f:
            json.dump(timing, f, separators=(',', ':'))
        entry = {'id': t['id'], 'title': t['title'], 'artist': t['artist'], 'genre': t['genre'],
                 'tint': t['tint'], 'src': None, 'lyrics': tf, 'synth': synth}
        if t.get('tint2'): entry['tint2'] = t['tint2']
        playlist.append(entry)
        print('%-22s %5.1f s  %d lines' % (t['title'], synth['length'], len(timing['lines'])))
    with open(os.path.join(OUT, 'playlist.json'), 'w') as f:
        json.dump(playlist, f, indent=1)


main()
