# mooboard.co

The website for mooboard. It is plain static files with no build step: `index.html`, `css/`, `js/` (plain scripts,
plus the ES module `js/viewer.mjs` for the 3D viewer), `fonts/`, `renders/`, `assets/` and `music/`, and the
`privacy/` and `support/` pages. `hi/index.html` and `404.html` are the same page, served at `/hi` and at every
unknown path: it finds the boards on the phone's network and opens one. `portal/` is the everyday way in. It opens the
only board on the phone's network or lists them with the last one opened on top. It installs as an app. A board's
`/portal/<code>` link opens that board. Both run `js/finder.js` and `css/finder.css`. `hi/buttons/` is the short
tour of the two buttons that the board's setup links to, with its frame in `?frame=`: `js/tour.mjs`, `css/tour.css`,
`assets/3d/board-tour.glb` and the panel's frames in `assets/tour/`. `start/` is the get started page for a new board: the
logo, a light window with one three.js scene, and cards to flick under it for what is in the box, the hardware,
mounting, its Wi-Fi, setup and Wi-Fi help. A board's sticker link (`/hi/<code>?m=<model>`) goes there when its board is
not on the phone's network yet. It runs `js/start.js` and `css/start.css`. The scene is `js/scene.mjs`: it loads at the
start with the homepage's board model and `assets/3d/rail.glb`, the wall rail and its two hooks, and moves to each
card's pose as the cards change. Without WebGL each card shows its own drawing instead. GitHub Pages serves the repository as it is, at the domain in
`CNAME`.

## Preview

    python3 tools/serve.py                       # http://127.0.0.1:8091/
    python3 tools/serve.py 8092 ../another-checkout

`tools/serve.py` serves the files the way Pages does, with caching off: gzip for text, a folder without its slash
redirected, and `404.html` for any path that isn't there, so `/hi` and the printed links work locally too. The radio's
previews and lyrics and the weather come from other services, so those parts need the network.

## Checks

    sh tools/check-no-music.sh       # no audio, video, lyric or subtitle file, and nothing from local-music/, is in git
    python3 tools/check-lyrics.py    # every line of the archived songs lights up on the board, music/radio.json adds up
    node --test tools/hi.test.mjs tools/portal.test.mjs tools/start.test.mjs    # /hi, 404, /portal and /start (node 18 or later)

To have git run all three before every commit, once per clone:

    git config core.hooksPath tools/hooks

## Tools

The Python tools that need packages run from the build venv, `~/.pixelwall-build/venv`. Each one explains itself at
the top of its file.

- `perf.py`, `perf_table.py`: load, transfer and frame-rate measurements in headless Chrome, written up in
  `docs/perf.md` (websocket-client, and Pillow for `--compare`)
- `renditions.py`: the 960 px phone frames and the posters of the scroll sequences (Pillow)
- `viewer-poster.py`: the 3D viewer's poster stills (Pillow, websocket-client)
- `fonts.py`: the self-hosted web fonts in `fonts/` (fontTools, brotli)
- `sync-mark.py`: copies the mark from `brand/` into the header and footer of `index.html`
- `make-radio.py`: `music/radio.json`, from Apple's previews and the owner's own copies of the songs in
  `local-music/`, which never go in git (numpy, mlx_whisper, ffmpeg)
- `make-placeholder-songs.py`: the original placeholder songs in `music/archive/`
- `make-prayer.py`: the Prayer face's lettering inside `js/board.js` (uharfbuzz, freetype-py)
- `og.html`: the social card. Serve the repo, open `/tools/og.html` in Chrome at 1200x630, let the board settle and
  save a screenshot as `og.png`
- `icon.html`: the mark at the touch icon size, and at the favicon size with `#fav`
- `portal-icons.py`: the portal's app icons, made from the brand kit's app icon (Pillow)
- `tour-frames.py`: the panel's frames for the buttons tour in `assets/tour/`, from the firmware's own renders (Pillow)

## The rail model

`assets/3d/rail.glb` holds the wall rail and its two hooks from the CAD, with the places the mounting steps use as empty
nodes, all as the board hangs: `at_wall`, `at_top`, `at_pocket_1` to `4`, `at_screw_1` to `3`, `at_hole_l`, `at_hole_r`,
`at_latch`, `at_entry` and `at_click` (the top of `js/scene.mjs` says what each one is). A new rail is a new `rail.glb`
and its `rail.glb.gz` with the same node names, and nothing else changes. `tools/start.test.mjs` checks the names.

## Publishing

Pages publishes everything in the repository, not only the site. `robots.txt` keeps search engines to the site's own
files (a new top-level folder the site loads needs an `Allow` line there), but it doesn't stop anyone from opening the
rest. To publish only the site, deploy an allowlist of its files with a GitHub Actions workflow instead of serving the
branch.

## License

See `LICENSE`. Third-party fonts and scripts keep their own licenses, in the files next to them.
