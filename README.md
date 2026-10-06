# mooboard.co

The website for mooboard. It is plain static files with no build step: `index.html`, `css/`, `js/` (plain scripts,
plus the ES module `js/viewer.mjs` for the 3D viewer), `fonts/`, `renders/`, `assets/` and `music/`, and the
`privacy/` and `support/` pages. `hi/index.html` and `404.html` are the same page, served at `/hi` and at every
unknown path: it finds the boards on the phone's network and opens one. `portal/` is the everyday way in: it opens the
board it opened last and installs as an app. Both run `js/finder.js` and `css/finder.css`. GitHub Pages serves the
repository as it is, at the domain in `CNAME`.

## Preview

    python3 tools/serve.py                       # http://127.0.0.1:8091/
    python3 tools/serve.py 8092 ../another-checkout

`tools/serve.py` serves the files the way Pages does, with caching off: gzip for text, a folder without its slash
redirected, and `404.html` for any path that isn't there, so `/hi` and the printed links work locally too. The radio's
previews and lyrics and the weather come from other services, so those parts need the network.

## Checks

    sh tools/check-no-music.sh       # no audio, video, lyric or subtitle file, and nothing from local-music/, is in git
    python3 tools/check-lyrics.py    # every line of the archived songs lights up on the board, music/radio.json adds up
    node --test tools/hi.test.mjs tools/portal.test.mjs    # /hi, 404 and /portal (node 18 or later)

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

## Publishing

Pages publishes everything in the repository, not only the site. `robots.txt` keeps search engines to the site's own
files (a new top-level folder the site loads needs an `Allow` line there), but it doesn't stop anyone from opening the
rest. To publish only the site, deploy an allowlist of its files with a GitHub Actions workflow instead of serving the
branch.

## License

See `LICENSE`. Third-party fonts and scripts keep their own licenses, in the files next to them.
