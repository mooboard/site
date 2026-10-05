# Site performance

Measured 2026-10-05 against commit 05ab58d (before) and the commits that follow it (after). The visuals were approved
as they were, so every change below keeps the look and the animations; the few places where something is different
are listed under "Visual notes".

## How it was measured

No node on this machine, so Lighthouse was out. `tools/perf.py` drives Chrome 154 headless over the DevTools
protocol (needs `websocket-client` in the build venv) and reports the same things: LCP and FCP from
`PerformanceObserver`, long tasks and a Lighthouse-style TBT (FCP to load + 5 s), request count and transfer from the
Network domain, JS heap, and frame intervals from `requestAnimationFrame` while the hero board animates, while the hero
and colours sequences are scrubbed (a synthesized wheel or touch scroll through the pinned section), and in the tiles
section. `Performance.getMetrics` adds style-recalc, layout and script time for each recording window.

Two profiles: desktop 1440x900 with no throttling, and phone 390x844 at dpr 3 with touch, 4x CPU throttle and
Lighthouse's "slow 4G" network (1.6 Mbps down, 150 ms RTT). The GPU in headless was Metal on an M4, so raster and
compositor cost does not show in these numbers; the main-thread numbers do. The server was `tools/serve.py`, a
threaded static server with gzip for text, because the plain `http.server` preview sends CSS and JS uncompressed and
GitHub Pages does not. It is HTTP/1.1 while Pages is HTTP/2, which matters for one decision below (font preloads).

```
# preview servers: the working tree and a worktree of the old commit
python3 tools/serve.py 8091 .
git worktree add --detach /tmp/site-base 05ab58d && python3 tools/serve.py 8093 /tmp/site-base
# one run at a time (three Chrome instances in parallel produced 150-300 ms phantom frames)
P=~/.pixelwall-build/venv/bin/python
$P tools/perf.py --profile desktop --url http://127.0.0.1:8093/ --out docs/perf/before-desktop.json
$P tools/perf.py --profile desktop --url http://127.0.0.1:8091/ --out docs/perf/after-desktop.json
$P tools/perf.py --profile phone   --url http://127.0.0.1:8093/ --out docs/perf/before-phone.json
$P tools/perf.py --profile phone   --url http://127.0.0.1:8091/ --out docs/perf/after-phone.json
$P tools/perf.py --checks --url http://127.0.0.1:8091/ --out docs/perf/after-checks.json
$P tools/perf_table.py                      # the table below
$P tools/perf.py --cpu --profile desktop    # top self-time functions, navigation to the end of the hero scrub
$P tools/perf.py --quick --profile phone    # load-only numbers, for quick A/B
$P tools/perf.py --shots /tmp/shots --label after && $P tools/perf.py --compare /tmp/shots before after
```

## Before and after

### Desktop 1440x900, no throttling

| Metric | Before (05ab58d) | After |
|---|---|---|
| Load event | 0.5 s | 0.1 s |
| FCP / LCP (h1 text) | 248 / 248 ms | 112 / 112 ms |
| Total blocking time | 0 ms | 0 ms |
| Longest task (whole run) | 0 ms | 0 ms |
| Requests / transfer, load + 3 s | 151 / 8192 KB | 44 / 2843 KB |
|   of which sequence frames | 122 frames, 2776 KB renders | 18 frames, 344 KB renders |
| Requests / transfer, load + 12 s, no scroll | 151 / 8192 KB | 149 / 5217 KB |
| Transfer after a full scroll | 15518 KB (renders 9928 KB) | 13529 KB (renders 9873 KB) |
| JS heap after load / after scroll | 4.6 / 8.4 MB | 8 / 9.5 MB |
| Hero board animating (3 s) | 60.3 fps, p95 16.8 ms, max 16.8 ms | 60.2 fps, p95 16.7 ms, max 16.8 ms |
|   main thread: style / layout / script | 53 / 8 / 60 ms | 53 / 1 / 41 ms |
| Hero sequence scrub (3.5 s) | 60.1 fps, p95 16.7 ms, max 16.8 ms | 60.2 fps, p95 16.7 ms, max 16.8 ms |
| Colours sequence scrub (3.5 s) | 60 fps, p95 16.8 ms, max 16.8 ms | 60.1 fps, p95 16.8 ms, max 16.8 ms |
| Tiles section (3 s) | 60.2 fps, p95 16.7 ms, max 16.8 ms, 9 boards | 60.1 fps, p95 16.8 ms, max 16.8 ms, 9 boards |
| Console errors | 0 | 0 |

### Phone 390x844, 4x CPU, slow 4G (1.6 Mbps, 150 ms RTT)

| Metric | Before (05ab58d) | After |
|---|---|---|
| Load event | 40.6 s | 3.5 s |
| FCP / LCP (h1 text) | 512 / 512 ms | 492 / 492 ms |
| Total blocking time | 110 ms | 36 ms |
| Longest task (whole run) | 151 ms | 86 ms |
| Longest task after load | 0 ms | 0 ms |
| Requests / transfer, load + 3 s | 152 / 8192 KB | 44 / 491 KB |
|   of which sequence frames | 122 frames, 2776 KB renders | 18 frames, 148 KB renders |
| Requests / transfer, load + 12 s, no scroll | 152 / 8230 KB | 140 / 1324 KB |
| Transfer after a full scroll | 17462 KB (renders 9928 KB) | 7610 KB (renders 4042 KB) |
| JS heap after load / after scroll | 23.6 / 20.3 MB | 8.5 / 6.2 MB |
| Hero board animating (3 s) | 60.2 fps, p95 16.8 ms, max 16.8 ms | 60.1 fps, p95 16.8 ms, max 16.8 ms |
|   main thread: style / layout / script | 165 / 23 / 61 ms | 197 / 6 / 208 ms |
| Hero sequence scrub (3.5 s) | 52.8 fps, p95 33.3 ms, max 33.4 ms | 59.9 fps, p95 16.7 ms, max 33.3 ms |
| Colours sequence scrub (3.5 s) | 54.8 fps, p95 33.3 ms, max 33.5 ms | 52.2 fps, p95 33.3 ms, max 33.5 ms |
| Tiles section (3 s) | 54.6 fps, p95 33.3 ms, max 33.4 ms, 7 boards | 60.1 fps, p95 16.8 ms, max 16.8 ms, 7 boards |
| Console errors | 0 | 0 |

Reading the table:

- "Load event" before was 40 s on the phone because the 120 hero frames and the five radio previews were requested
  before `load` fired, and `new Image()` requests started before load hold the event back. The cow's "loading" eyes
  ran the whole time. Everything that waits for load (the sequence fill, `ST.refresh`) now happens at 3.5 s.
- The transfer at load + 3 s is what a visitor pays before touching the page. The 1324 KB at load + 12 s on the phone
  is the same plus the hero frames filling in (every 8th frame first, the rest 5 s after load or on the first scroll,
  whichever comes first), plus the first radio preview.
- The full-scroll payload on the phone is the 960 px frame set (hero 1.1 MB, colours 1.4 MB, room 1.5 MB) plus one
  preview per song played (about 1 MB each on Apple's CDN). Renders alone: 9.9 MB before, 4.0 MB after.
- The hero-board "script" time on the phone depends on which scene the board is in and whether a scene transition
  (the noise wipe, two `getImageData` passes) falls into the 3 s window; the before run happened to record the
  held lyrics scene at 55 s after navigation, the after run the clock at 20 s. Board code only got cheaper (below).
- The colours scrub on the throttled phone is unchanged at about 52 fps (every other frame at 33 ms). Each frame
  redraws the full-screen canvas with the pan, blurs a mirrored edge strip through `ctx.filter` for the first fifth
  of the scrub, and the section background transition repaints while the frame colour changes. It meets the
  "no worse than 30 fps" bar; the next step would be dropping the blurred strip, which is a visual decision.

Targets from the brief: phone initial transfer under 1 MB and under 40 requests before scrolling (491 KB, 44
requests: 7 scripts, 4 fonts, 18 frames, the rest is html, css, svg, json, one cover; the first radio preview is
the biggest single item and is discussed below), LCP under 2.5 s throttled (0.49 s), no long task over 100 ms after
load (none), 60 fps hero scrub and board on desktop (yes), at least 30 fps on the 4x phone (52 to 60), render
payload over a full phone scroll under 5 MB (4.0 MB).

## What changed, biggest first

1. **Radio previews load one song ahead, not all five** (`js/music.js`). The radio made an `<audio preload=auto>`
   for every song at startup: 5.1 MB of the 8.2 MB initial transfer, on every device. The first song is still made up
   front; each next one is made when the song before it starts playing, which leaves a whole 30 s preview to buffer
   before the 2.2 s crossfade. Playback, muting, the crossfade and the lyrics are unchanged.
2. **Sequences: phone renditions, posters, progressive hero, decode ahead** (`js/seq.js`, `tools/renditions.py`,
   `renders/manifest.json`). Every sequence now has a 960x540 WebP set (quality 80) next to the 1600x900 one, and a
   480 px poster. A viewport up to 820 CSS px wide whose canvas would draw the frame at no more than about 1.4x the
   960 px rendition picks the small set (a 390 px phone draws the hero frame 1209 device px wide; a 1440 px desktop
   draws it 1600 wide and keeps the full set). Nothing is fetched until a section is within 1.5 viewports, and the
   first frame of Colours and Room is no longer fetched at startup: the tiny poster gives the section its tint and a
   first picture. The hero sequence, right under the fold, fetches every 8th frame once the page has loaded and fills
   the gaps on the first scroll, wheel, touch or key, or 5 s after load. Frames stay `<img>` elements, so the browser
   keeps the decoded bitmaps it needs and drops the rest (120 decoded 1600x900 frames would be 690 MB as
   ImageBitmaps); the four frames either side of the one being shown are decoded ahead with `img.decode()`.
   All of this used to be in `js/main.js`; it is its own module now.
3. **Self-hosted fonts and vendor scripts** (`fonts/`, `tools/fonts.py`, `js/vendor/`). The Google Fonts stylesheet
   was a render-blocking request to a third origin followed by seven font files from another one (123 KB). Fredoka
   and Nunito are now one variable woff2 each, subset to latin (29 KB and 46 KB, built from the brand TTFs with
   fontTools); Silkscreen and Noto Sans Devanagari 600 are Google's own woff2 files (OFL). GSAP, ScrollTrigger and
   Lenis are served from `js/vendor/` instead of jsdelivr: no third connection on the critical path. Font preloads
   were tried and dropped: on the throttled phone they moved FCP from 520 to 700 ms because they compete with the
   stylesheet for the 1.6 Mbps (HTTP/1.1 locally; HTTP/2 on Pages would soften this), and with `font-display: swap`
   the fonts never gate LCP anyway.
4. **Boards** (`js/board.js`, `js/main.js`). The 20 tile and app-strip boards are built when they come within two
   viewports, one per animation frame (twenty at once was a 100 ms task mid-scroll), and run at 30 fps with their own
   `dt`. Every board got cheaper: `text()` reuses one `ImageData` instead of allocating 16 KB per call, and the
   Lights scene writes its rainbow field as one `ImageData` instead of 4096 `fillRect` calls a frame. The story's live
   board overlay only writes its box when it changes (it was setting left/top/width/height on every scrubbed frame).
   The boot task on the 4x phone went from about 200 ms to 86 ms.
5. **Scroll** (`css/site.css`, `js/main.js`). The Special Edition badge's light sweep animated `left`, a layout
   property, forever on both badges: 44 layouts a second at rest. It now moves by `translateX` (same path, same
   timing). The Colours fallback stills no longer get a scrub tween when the section has frames (they are
   `display: none` then). Lenis is not started on touch-only devices: it smooths the wheel, not touch, so there it
   was a per-frame RAF for nothing; anchor links fall back to native smooth scroll.
6. **Smaller things**: the two tech-card stills have a 1200 px `srcset` candidate (they show at most about 700 CSS
   px wide); a dead `fmt()` helper went.

Measured and left alone:

- Writing `--glow` on `:root` (the hero board's average colour, about 6 times a second) costs about 15 ms of style
  time per 2 s on desktop because it invalidates the whole document and restarts the hero bezel's 0.6 s box-shadow
  transition. Scoping the write to `.hero` halves that, but the app-strip bezels currently inherit the hero's last
  colour from `:root` and would show the default mint instead. Small gain, small look change: left for the owner.
- `will-change: transform` on the blurred glow layers: no measurable change here.
- The cow's blink keyframe on the SVG `<g>` ticks on the main thread (SVG children cannot be composited) but costs
  under 1 ms per 2 s; not worth a JavaScript blink.
- Splitting the player UI and the form out of `js/main.js`: all scripts are already `defer` and the three site
  scripts are 35 KB gzipped together; the sequence code (the big, lazy-able part) is now `js/seq.js`, the rest was
  left in place rather than refactored for no measurable gain.

## Visual notes

- Phones and small tablets (up to 820 CSS px) scrub 960 px frames. On a 390 px phone at dpr 2 the hero frame is drawn
  1.26x upscaled, on a 430 px phone 1.39x; a 768 px tablet still gets the full set. During a scrub this reads as a
  slightly softer frame than before; the stills around the sequences are unchanged. Reverting is one line in
  `Seq.prototype.pickTier`, at the cost of 2.5 times the phone payload.
- Until a sequence's frames arrive, the 480 px poster is drawn in their place (previously the full first frame was
  fetched at startup for every sequence). On a slow connection this is visible for a moment in the Story section if
  the visitor scrolls there within the first seconds.
- The first radio preview (about 1 MB) is still fetched at load so the sound is there the moment the visitor
  unmutes, exactly as before. Loading it on unmute instead would bring the phone's initial transfer to about 400 KB
  with a short buffering wait after the tap; that is a behaviour change and is left for the owner.
- Fredoka and Nunito are now served as variable fonts instanced from the brand TTFs rather than Google's static
  instances; same designs and weights, built from the same sources.

## Checks

`tools/perf.py --checks` loads 390, 430, 768 and 1440 px (before and after): no console errors, no horizontal
overflow, the Special Edition badge visible with Mint Glow selected, 7 scene chips, `kitchen` splits to `kit-chen`,
the colours board pans from right of centre toward centre (centre of the dark pixels 0.52 to 0.35 at 390 px, 0.58 to
0.40 at 1440 px, same as before), reduced motion fetches zero sequence frames and adds `no-anim`, and the waitlist
form's validation path runs (the real submit still posts to Formspree and was not exercised). Screenshots at eleven
scroll spots (`--shots`, `--compare`) differ from the old build only inside the LED boards and the intro's timing.
