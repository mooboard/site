#!/usr/bin/env python3
"""Markdown before/after table from docs/perf/{before,after}-{desktop,phone}.json (written by tools/perf.py)."""
import json
import os
import sys

D = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'docs', 'perf')


def load(n):
    with open(os.path.join(D, n + '.json')) as f:
        return json.load(f)


def fr(x, key='fps'):
    return '%s fps, p95 %s ms, max %s ms' % (x['fps'], x['p95'], x['max'])


ROWS = [
    ('Load event', lambda r: '%.1f s' % (r['load_ms'] / 1000)),
    ('FCP / LCP (h1 text)', lambda r: '%d / %d ms' % (r['fcp_ms'], r['lcp_ms'])),
    ('Total blocking time', lambda r: '%d ms' % r['tbt_ms']),
    ('Longest task (whole run)', lambda r: '%d ms' % r['long_tasks']['max_total_ms']),
    ('Longest task after load', lambda r: '%d ms' % r['long_tasks']['max_after_load_ms']),
    ('Requests / transfer, load + 3 s', lambda r: '%d / %s KB' % (r['initial']['requests'], r['initial']['kb'])),
    ('  of which sequence frames', lambda r: '%d frames, %s KB renders' % (r['initial']['seq_frames'], r['initial']['renders_kb'])),
    ('Requests / transfer, load + 12 s, no scroll', lambda r: '%d / %s KB' % (r['idle']['requests'], r['idle']['kb'])),
    ('Transfer after a full scroll', lambda r: '%s KB (renders %s KB)' % (r['full_scroll']['kb'], r['full_scroll']['renders_kb'])),
    ('JS heap after load / after scroll', lambda r: '%s / %s MB' % (r['heap_mb'], r['heap_mb_end'])),
    ('Hero board animating (3 s)', lambda r: fr(r['board_frames'])),
    ('  main thread: style / layout / script', lambda r: '%d / %d / %d ms' % (r['board_frames']['styleMs'], r['board_frames']['layoutMs'], r['board_frames']['scriptMs'])),
    ('Hero sequence scrub (3.5 s)', lambda r: fr(r['hero_scrub'])),
    ('Colours sequence scrub (3.5 s)', lambda r: fr(r['colors_scrub'])),
    ('Tiles section (3 s)', lambda r: fr(r['tiles_frames']) + ', %s boards' % r['tiles_frames'].get('boards_rendering')),
    ('Console errors', lambda r: str(len(r['errors']))),
]


def main():
    for prof in ('desktop', 'phone'):
        b, a = load('before-' + prof), load('after-' + prof)
        print('\n### %s\n' % ('Desktop 1440x900, no throttling' if prof == 'desktop' else 'Phone 390x844, 4x CPU, slow 4G (1.6 Mbps, 150 ms RTT)'))
        print('| Metric | Before (05ab58d) | After |\n|---|---|---|')
        for name, f in ROWS:
            try:
                print('| %s | %s | %s |' % (name, f(b), f(a)))
            except Exception as e:  # a metric missing from an older json
                print('| %s | ? | ? (%s) |' % (name, e))
    return 0


if __name__ == '__main__':
    sys.exit(main())
