/* MooBoard scroll sequences: rendered frames scrubbed by scroll position.
   renders/manifest.json lists each sequence; frames come in two sizes (960 px for phones, full for everything else)
   plus a tiny poster. A section fetches nothing until it is near the viewport; the hero sequence (right under the fold)
   fetches every 8th frame once the page has loaded and fills the gaps when the visitor scrolls or has stayed 5 s.
   Frames stay as <img> elements (the browser keeps the decoded bitmaps it needs); the frames about to be shown are
   decoded ahead with img.decode() so a scrub never waits on a decode. */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }
  var DPR = Math.min(devicePixelRatio || 1, 2), PAR = 6;

  var loaded = new Promise(function (res) { if (document.readyState === 'complete') res(); else addEventListener('load', res); });
  // the visitor has settled in: first scroll, wheel, touch, key or pointer, or 5 s after load
  var settled = new Promise(function (res) {
    var evs = ['scroll', 'wheel', 'touchstart', 'keydown', 'pointerdown'];
    var done = function () { res(); evs.forEach(function (e) { removeEventListener(e, done); }); };
    evs.forEach(function (e) { addEventListener(e, done, { passive: true }); });
    loaded.then(function () { setTimeout(done, 5000); });
  });

  function Seq(section, spec) {
    this.section = section; this.spec = spec; this.n = spec.frames;
    this.cv = $('.seq-canvas', section); this.ctx = this.cv.getContext('2d'); this.shiftProgress = null;
    this.imgs = new Array(this.n); this.ok = new Uint8Array(this.n); this.want = 0; this.poster = null;
    this.tier = this.pickTier();
  }
  // Which frame size to fetch, decided once: the full size unless this is a phone or small tablet whose canvas
  // would draw the frame at no more than ~1.4x the 960 px rendition (a 390 px phone at dpr 2 draws it 1209 px wide).
  Seq.prototype.pickTier = function () {
    var s = this.spec, sizes = s.sizes, full = s.width;
    if (!sizes || sizes.length < 2 || innerWidth > 820) return full;
    var cw = innerWidth * DPR, ch = innerHeight * DPR, portrait = cw / ch <= 1, pf = s.portrait;
    var need = portrait ? (pf ? cw / Math.min(pf.from.w, (pf.to || pf.from).w) : cw * 1.55) : Math.max(cw, ch * 16 / 9);
    var pick = full;
    sizes.slice().sort(function (a, b) { return a - b; }).some(function (z) { if (z >= need * .72) { pick = z; return true; } return false; });
    return pick;
  };
  Seq.prototype.url = function (i) {
    var s = this.spec;
    return 'renders/' + s.dir + (this.tier < s.width ? '/' + this.tier : '') + '/' + pad(i + 1, s.pad || 4) + '.' + (s.ext || 'webp');
  };
  Seq.prototype.load = function (i) {
    var self = this;
    if (this.imgs[i]) return this.imgs[i].p;
    var img = new Image(); img.decoding = 'async';
    img.p = new Promise(function (res) {
      img.onload = function () { self.ok[i] = 1; res(true); if (Math.abs(i - self.want) < 3) { self.draw(); self.warm(); } };
      img.onerror = function () {
        if (img.retried) return res(false);
        img.retried = true; setTimeout(function () { img.src = self.url(i) + '?r=1'; }, 400);
      };
    });
    img.src = this.url(i); this.imgs[i] = img;
    return img.p;
  };
  // the poster: the first frame at 480 px, drawn until real frames arrive and read for the section tint
  Seq.prototype.loadPoster = function () {
    var self = this, s = this.spec;
    if (!s.poster) return this.load(0).then(function (ok) { return ok ? self.imgs[0] : null; });
    var img = new Image(); img.decoding = 'async';
    return new Promise(function (res) {
      img.onload = function () { self.poster = img; res(img); };
      img.onerror = function () { res(null); };
      img.src = 'renders/' + s.dir + '/' + s.poster;
    });
  };
  // fetch order: every 8th frame (a coarse but complete scrub), then stride 4, 2, 1; at most PAR in flight
  Seq.prototype.order = function () {
    var order = [], seen = {}, n = this.n;
    [8, 4, 2, 1].forEach(function (st) { for (var i = 0; i < n; i += st) if (!seen[i]) { seen[i] = 1; order.push(i); } });
    return order;
  };
  // full: everything now. Otherwise the sparse set now and the gaps once the visitor has settled.
  Seq.prototype.preload = function (full) {
    var self = this;
    if (full) this.fill = true;
    if (this.pump) return this.pump();
    var order = this.order(), sparse = Math.ceil(this.n / 8), k = 0, active = 0;
    var pump = this.pump = function () {
      while (active < PAR && k < order.length) {
        if (k >= sparse && !self.fill) return;
        active++;
        self.load(order[k++]).then(function () { active--; pump(); });
      }
    };
    pump();
    if (!this.fill) settled.then(function () { self.fill = true; pump(); });
  };
  // The canvas backing: the screen's pixels, but never much past the frames' own (a 1600 px frame on a 1440 px window
  // at 2x drew 2880 px of canvas, twice the pixels to fill on every scrub step for no detail the frame has)
  Seq.prototype.size = function () {
    var w = this.cv.clientWidth, h = this.cv.clientHeight, k = Math.min(DPR, Math.max(1, this.tier * 1.25 / Math.max(1, w)));
    var bw = Math.round(w * k), bh = Math.round(h * k);
    if (this.cv.width !== bw || this.cv.height !== bh) { this.cv.width = bw; this.cv.height = bh; this.drawn = -1; }
  };
  Seq.prototype.set = function (p) { this.want = Math.round(Math.max(0, Math.min(1, p)) * (this.n - 1)); this.draw(); this.warm(); };
  // decode the next few frames either side off the main thread
  Seq.prototype.warm = function () {
    var w = this.want;
    if (this.warmed === w) return; this.warmed = w;
    for (var d = 1; d <= 4; d++) {
      var a = this.imgs[w + d], b = this.imgs[w - d];
      if (a && this.ok[w + d] && a.decode && a.warm !== w) { a.warm = w; a.decode().catch(function () {}); }
      if (b && this.ok[w - d] && b.decode && b.warm !== w) { b.warm = w; b.decode().catch(function () {}); }
    }
  };
  Seq.prototype.draw = function () {
    var i = this.want, j = -1;
    for (var d = 0; d < this.n; d++) { if (this.ok[i - d]) { j = i - d; break; } if (this.ok[i + d]) { j = i + d; break; } }
    var img = j >= 0 ? this.imgs[j] : this.poster, fi = j >= 0 ? j : i;
    if (!img || !this.cv.clientWidth) return;
    this.size();
    var cw = this.cv.width, ch = this.cv.height, ir = img.naturalWidth / img.naturalHeight;
    var iw = img.naturalWidth, ih = img.naturalHeight, portrait = cw / ch <= 1;
    var sp = this.shiftProgress;
    // Pan the crop from a right-side start toward center, with separate framing for phone and landscape views.
    var shift = sp == null ? 0 : (portrait ? .295 - .386 * sp : .263 - .327 * sp) * cw;
    var key = j >= 0 ? j : -2;
    if (key === this.drawn && cw === this.lastW && shift === this.lastShift) return;
    this.drawn = key; this.lastW = cw; this.lastShift = shift;
    // landscape: cover. portrait: a little wider than the screen, with the frame's top and bottom rows stretched to fill
    var s = portrait ? cw * 1.55 / iw : Math.max(cw / iw, ch / ih);
    var w = iw * s, h = w / ir, x0 = (cw - w) / 2, y0 = (ch - h) / 2 + ch * (portrait ? 0 : this.spec.shiftY || 0);
    var pf = portrait && this.spec.portrait;
    if (pf) {
      // phones: frame a focus point (x, y as fractions of the render) showing a set share of its width,
      // eased from the first frame's framing to the last one's
      var k = this.n > 1 ? fi / (this.n - 1) : 0, a = pf.from, b = pf.to || pf.from, L = function (u, v) { return u + (v - u) * k; };
      var fw = L(a.w, b.w), fx = L(a.x, b.x), fy = L(a.y, b.y), at = pf.at || .46;
      w = cw / fw; h = w / ir; x0 = cw / 2 - fx * w; y0 = ch * at - fy * h;
    }
    x0 += shift;
    var ctx = this.ctx;
    ctx.clearRect(0, 0, cw, ch);
    if (y0 > 0) ctx.drawImage(img, 0, 0, iw, 1, x0, 0, w, y0 + 1);
    if (y0 + h < ch) ctx.drawImage(img, 0, ih - 1, iw, 1, x0, y0 + h - 1, w, ch - y0 - h + 1);
    ctx.drawImage(img, x0, y0, w, h);
    if (x0 > 0) {
      // Extend a narrow strip of the scene beyond its left edge and soften the join.
      var edgeW = Math.min(iw * .05, x0 / s);
      ctx.save();
      if ('filter' in ctx) ctx.filter = 'blur(4px)';
      ctx.translate(x0, 0); ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0, edgeW, ih, 0, 0, x0, ch); ctx.restore();
    }
    // The last black render has a clipped duplicate board at its right edge; cover that crop area cleanly.
    if (this.section.id === 'colors' && !portrait && sp != null && sp > .8) {
      // The black render has a second board at the far-right edge; extend only the clean wall before it.
      var maskX = x0 + w * .96;
      if (maskX < cw) {
        var edgeWidth = cw - maskX;
        ctx.save();
        if ('filter' in ctx) ctx.filter = 'blur(4px)';
        ctx.translate(maskX, 0); ctx.scale(-1, 1);
        ctx.drawImage(img, iw * .93, 0, iw * .03, ih, -edgeWidth, 0, edgeWidth, ch);
        ctx.restore();
      }
    }
    var q = this.cv.clientWidth / cw;
    this.rect = { x: x0 * q, y: y0 * q, w: w * q, h: h * q };
    if (this.onDraw) this.onDraw(fi);
  };
  Seq.prototype.redraw = function () { this.drawn = -1; this.draw(); };

  function tint(section, img) {
    try {
      var c = document.createElement('canvas'); c.width = c.height = 1;
      var x = c.getContext('2d'); x.drawImage(img, 2, 2, 1, 1, 0, 0, 1, 1);
      var d = x.getImageData(0, 0, 1, 1).data;
      section.style.background = 'rgb(' + d[0] + ',' + d[1] + ',' + d[2] + ')';
      section.classList.toggle('on-light', d[0] * .3 + d[1] * .59 + d[2] * .11 > 150);
    } catch (e) { /* keep css background */ }
  }

  // reads the manifest and sets up every [data-seq] section; resolves to { name: Seq }
  function load() {
    return fetch('renders/manifest.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (man) {
        var list = (man && man.sequences) || {}, seqs = {};
        return Promise.all($$('[data-seq]').map(function (sec) {
          var name = sec.dataset.seq, spec = list[name];
          if (!spec || !(spec.frames > 0)) return null;
          var s = new Seq(sec, spec);
          return s.loadPoster().then(function (img) {
            if (!img) return;
            seqs[name] = s; sec.classList.add('has-frames');
            if (spec.tint !== false) tint(sec, img);
            s.set(0);
            // the hero sequence sits right under the fold: sparse set at load, the rest once the visitor settles;
            // the others fetch everything, but only once they are within 1.5 viewports
            var near = function () { loaded.then(function () { s.preload(name !== 'hero'); }); };
            if ('IntersectionObserver' in window) {
              var io = new IntersectionObserver(function (e) { if (e[0].isIntersecting) { near(); io.disconnect(); } }, { rootMargin: '150% 0px' });
              io.observe(sec);
            } else near();
          });
        })).then(function () { return seqs; });
      });
  }

  window.MooSeq = { Seq: Seq, load: load, tint: tint };
})();
