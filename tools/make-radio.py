"""Builds music/radio.json: the five radio songs, played as Apple's 30 s previews.

The site hosts no audio and no lyrics. Each entry holds Apple's preview URL, the lrclib.net id the browser fetches
synced lyrics from, where the preview starts inside the full song (so LRC times can be shifted onto it), and the
word onsets Whisper heard in the preview (numbers only), which js/music.js uses to sweep words in time.

Needs the owner's full songs in local-music/ (never committed) to find each preview's start by cross-correlation.
Run with a python that has numpy and mlx_whisper:  python tools/make-radio.py
"""
import json, os, subprocess, urllib.request

import numpy as np
import mlx_whisper

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = {'User-Agent': 'MooBoard-site/1.0'}
# id, shown title, shown artist, Apple track id, lrclib id, tint, tint2, cover (Apple track id to take art from),
# lyric nudge in seconds (LRC vs what is actually sung, measured against Whisper)
SONGS = [
    ('red', 'Red', 'Taylor Swift', 1590368453, 37292040, '#E0343C', None, None, 0),
    ('yellow', 'Yellow', 'Coldplay', 1122782283, 37471750, '#FFD23F', None, None, -.4),
    ('blue', 'BIPP', 'SOPHIE', 1818968513, 23539956, '#1F6FE5', '#F28CF0', 1528286691, -.3),
    ('violet', 'The Color Violet', 'Tory Lanez', 1599010268, 36674590, '#8F00FF', None, None, -.2),
    ('waves', 'Heat Waves', 'Glass Animals', 1686519894, 38538493, '#FF7A2F', '#FF2E88', None, 0),
]
SR = 4000
MIN_MATCH = .5   # the weakest probe's normalized correlation with the song (the same recording scores near 1)


def get(url):
    return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA)))


def lookup(sid, apple):
    r = get('https://itunes.apple.com/lookup?country=US&id=%d' % apple)['results']
    if not r:
        raise SystemExit('%s: Apple track %d no longer resolves (delisted, or not in the US store)' % (sid, apple))
    return r[0]


def pcm(src, sr=SR):
    if not os.path.isfile(src):
        raise SystemExit('missing ' + src)
    r = subprocess.run(['ffmpeg', '-v', 'error', '-i', src, '-ac', '1', '-ar', str(sr), '-f', 'f32le', '-'], capture_output=True)
    if r.returncode or not r.stdout:
        raise SystemExit('ffmpeg could not read %s: %s' % (src, r.stderr.decode(errors='replace').strip()))
    return np.frombuffer(r.stdout, np.float32)


def start_in_song(sid, full, prev):
    """Seconds into the full song where the preview begins (median of three 6 s probes). Stops the run when the probes
    disagree, match weakly or put the preview past the song's end: local-music/<id>.mp3 is then another edit or
    recording than Apple's, and every lyric line would be shifted by the wrong amount."""
    hits, match = [], []
    for a in (5, 12, 20):
        seg = prev[a * SR:(a + 6) * SR]; seg = (seg - seg.mean()) / seg.std()
        n = 1 << (len(full) + len(seg) - 1).bit_length()
        c = np.fft.irfft(np.fft.rfft(full, n) * np.conj(np.fft.rfft(seg, n)), n)[:len(full) - len(seg)]
        e = np.sqrt(np.convolve(full ** 2, np.ones(len(seg)), 'valid')[:len(c)]) + 1e-9
        k = int(np.argmax(c / e))
        hits.append(k / SR - a)
        match.append(float(c[k] / e[k] / np.sqrt(len(seg))))
    at = round(float(np.median(hits)), 3)
    if max(hits) - min(hits) > .1 or min(match) < MIN_MATCH or not 0 <= at <= (len(full) - len(prev)) / SR + .5:
        raise SystemExit('%s: the preview does not line up with local-music/%s.mp3 (probes at %s s, match %s)'
                         % (sid, sid, ', '.join('%.2f' % h for h in hits), ', '.join('%.2f' % m for m in match)))
    return at


def onsets_of(w, length):
    """Whisper's word starts, once each: a word the clip cuts off gets the clip's end as its start, and two pieces of one
    word at times share a start."""
    out = []
    for x in (round(x['start'], 2) for s in w['segments'] for x in s.get('words', [])):
        if x < length - .1 and not (out and x - out[-1] < .05):
            out.append(x)
    return out


def main():
    tmp = os.path.join(ROOT, 'local-music', '.previews'); os.makedirs(tmp, exist_ok=True)
    out = []
    for sid, title, artist, apple, lrc, tint, tint2, art_id, nudge in SONGS:
        it = lookup(sid, apple)
        art = lookup(sid, art_id) if art_id else it
        pv = os.path.join(tmp, sid + '.m4a')
        urllib.request.urlretrieve(it['previewUrl'], pv)
        prev = pcm(pv)
        at = start_in_song(sid, pcm(os.path.join(ROOT, 'local-music', sid + '.mp3')), prev)
        w = mlx_whisper.transcribe(pv, path_or_hf_repo='mlx-community/whisper-large-v3-turbo', word_timestamps=True, language='en')
        onsets = onsets_of(w, len(prev) / SR)
        t = {'id': sid, 'title': title, 'artist': artist, 'tint': tint, 'src': it['previewUrl'],
             'art': art['artworkUrl100'].replace('100x100bb', '600x600bb'), 'link': it['trackViewUrl'],
             'lrclib': lrc, 'at': round(at - nudge, 3), 'onsets': onsets}
        if tint2: t['tint2'] = tint2
        # the whole song's length, for the boards' progress bar on the song's own timeline (Album art)
        if it.get('trackTimeMillis'): t['dur'] = round(it['trackTimeMillis'] / 1000, 3)
        out.append(t)
        print(sid, 'starts at', at, 'words', len(onsets))
    with open(os.path.join(ROOT, 'music', 'radio.json'), 'w') as f:
        json.dump({'source': 'Apple Music previews; lyrics from lrclib.net, fetched by the browser', 'tracks': out}, f, indent=1)


if __name__ == '__main__':
    main()
