#!/usr/bin/env python3
"""Performance measurement for the MooBoard site over the Chrome DevTools protocol (no node needed).

  python tools/perf.py --profile desktop --url http://127.0.0.1:8091/
  python tools/perf.py --profile phone   --url http://127.0.0.1:8091/
  python tools/perf.py --checks          --url http://127.0.0.1:8091/

desktop: 1440x900, dpr 1, no throttling.
phone:   390x844, dpr 3, touch, 4x CPU throttle, Lighthouse "slow 4G" network (1.6 Mbps down, 150 ms RTT).
Reports: requests and transfer at load+1.5 s quiet ("initial") and at load+8 s ("idle"), LCP, FCP, long tasks,
TBT (FCP to load+5 s), JS heap, frame intervals while the hero board animates and while the hero / colours
sequences are scrubbed, and the render payload after a full scroll. --checks loads 390/430/768/1440 and reports
console errors, horizontal overflow, a few feature probes, and the reduced-motion sequence bypass.
Needs the websocket-client package. Set CHROME to the Chrome binary if it is not the default Mac path."""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

import websocket

CHROME = os.environ.get('CHROME', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
PORT = int(os.environ.get('PERF_PORT', '9333'))

PROFILES = {
    'desktop': dict(width=1440, height=900, dpr=1, mobile=False, cpu=1, net=None),
    'phone': dict(width=390, height=844, dpr=3, mobile=True, cpu=4,
                  net=dict(offline=False, latency=150, downloadThroughput=1.6 * 1024 * 1024 / 8, uploadThroughput=750 * 1024 / 8)),
}

OBSERVERS = r"""
(function () {
  var P = window.__perf = { lcp: 0, lcpEl: '', fcp: 0, long: [], errors: [], renderMs: 0 };
  try { new PerformanceObserver(function (l) { l.getEntries().forEach(function (e) { P.lcp = e.startTime; P.lcpEl = (e.element && (e.element.tagName + (e.element.id ? '#' + e.element.id : '') + (e.element.className ? '.' + String(e.element.className).split(' ')[0] : ''))) || e.url || ''; }); }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch (e) {}
  try { new PerformanceObserver(function (l) { l.getEntries().forEach(function (e) { if (e.name === 'first-contentful-paint') P.fcp = e.startTime; }); }).observe({ type: 'paint', buffered: true }); } catch (e) {}
  try { new PerformanceObserver(function (l) { l.getEntries().forEach(function (e) { P.long.push([Math.round(e.startTime), Math.round(e.duration)]); }); }).observe({ type: 'longtask', buffered: true }); } catch (e) {}
  addEventListener('error', function (e) { P.errors.push(String(e.message || 'resource error') + ' ' + (e.filename || (e.target && (e.target.src || e.target.href)) || '')); }, true);
  addEventListener('unhandledrejection', function (e) { P.errors.push('rejection ' + e.reason); });
  // frame recorder: rAF intervals over ms, plus long-task time and board render time in the window
  window.__rec = function (ms) {
    return new Promise(function (res) {
      var ts = [], t0 = performance.now(), lt = -1, longs = 0, po;
      try { po = new PerformanceObserver(function (l) { l.getEntries().forEach(function (e) { longs += e.duration; }); }); po.observe({ type: 'longtask' }); } catch (e) {}
      P.renderMs = 0;
      (function f(now) { if (lt >= 0) ts.push(now - lt); lt = now; if (now - t0 < ms) requestAnimationFrame(f); else done(now); })(t0);
      function done(now) {
        if (po) po.disconnect();
        var s = ts.slice().sort(function (a, b) { return a - b; }), n = s.length;
        var q = function (p) { return n ? s[Math.min(n - 1, Math.floor(p * n))] : 0; };
        res({ frames: n, elapsed: Math.round(now - t0), avg: n ? +(ts.reduce(function (a, b) { return a + b; }, 0) / n).toFixed(1) : 0,
          p50: +q(.5).toFixed(1), p95: +q(.95).toFixed(1), max: +(n ? s[n - 1] : 0).toFixed(1),
          over17: ts.filter(function (x) { return x > 17.5; }).length, over34: ts.filter(function (x) { return x > 34; }).length,
          fps: n ? +(1000 * n / (now - t0)).toFixed(1) : 0, longMs: Math.round(longs), renderMs: Math.round(P.renderMs) });
      }
    });
  };
  window.__hookBoards = function () {
    var MB = window.MooBoard; if (!MB || MB.__hooked) return !!MB;
    var r = MB.Board.prototype.render;
    MB.Board.prototype.render = function () { var a = performance.now(); try { return r.apply(this, arguments); } finally { P.renderMs += performance.now() - a; } };
    MB.__hooked = true; return true;
  };
})();
"""


class CDP:
    def __init__(self, url):
        self.ws = websocket.create_connection(url, suppress_origin=True, max_size=None, timeout=60)
        self.n = 0
        self.events = []
        self.net = {}

    def call(self, method, params=None, session=None, timeout=60):
        self.n += 1
        mid = self.n
        msg = {'id': mid, 'method': method, 'params': params or {}}
        if session:
            msg['sessionId'] = session
        self.ws.send(json.dumps(msg))
        end = time.time() + timeout
        while time.time() < end:
            self.ws.settimeout(max(.05, end - time.time()))
            try:
                m = json.loads(self.ws.recv())
            except websocket.WebSocketTimeoutException:
                break
            if m.get('id') == mid:
                if 'error' in m:
                    raise RuntimeError(method + ': ' + json.dumps(m['error']))
                return m.get('result', {})
            self.on_event(m)
        raise TimeoutError(method)

    def on_event(self, m):
        self.events.append(m)
        meth = m.get('method', '')
        p = m.get('params', {})
        if meth == 'Network.requestWillBeSent':
            self.net[p['requestId']] = {'url': p['request']['url'], 'type': p.get('type', ''), 'bytes': 0, 'done': False, 'ts': p['timestamp']}
        elif meth == 'Network.responseReceived' and p['requestId'] in self.net:
            r = self.net[p['requestId']]
            r['mime'] = p['response'].get('mimeType', '')
            r['cache'] = p['response'].get('fromDiskCache') or p['response'].get('fromMemoryCache')
            r['status'] = p['response'].get('status')
        elif meth == 'Network.loadingFinished' and p['requestId'] in self.net:
            r = self.net[p['requestId']]
            r['bytes'] = p.get('encodedDataLength', 0)
            r['done'] = True
            r['end'] = p['timestamp']
        elif meth == 'Network.loadingFailed' and p['requestId'] in self.net:
            self.net[p['requestId']]['done'] = True
            self.net[p['requestId']]['failed'] = p.get('errorText')

    def pump(self, seconds):
        end = time.time() + seconds
        while time.time() < end:
            self.ws.settimeout(max(.05, end - time.time()))
            try:
                m = json.loads(self.ws.recv())
            except websocket.WebSocketTimeoutException:
                break
            if 'method' in m:
                self.on_event(m)

    def wait_event(self, name, timeout=30):
        end = time.time() + timeout
        while time.time() < end:
            self.ws.settimeout(max(.05, end - time.time()))
            try:
                m = json.loads(self.ws.recv())
            except websocket.WebSocketTimeoutException:
                break
            if 'method' in m:
                self.on_event(m)
                if m['method'] == name:
                    return m['params']
        raise TimeoutError(name)

    def quiet(self, idle=1.5, timeout=20):
        """pump until no request finishes for `idle` seconds"""
        start = time.time()
        last = time.time()
        while time.time() - start < timeout:
            before = sum(1 for r in self.net.values() if r['done'])
            self.pump(.25)
            after = sum(1 for r in self.net.values() if r['done'])
            if after != before or any(not r['done'] for r in self.net.values()):
                last = time.time()
            if time.time() - last > idle:
                return
        return


def launch(width, height):
    prof = tempfile.mkdtemp(prefix='mooperf-')
    args = [CHROME, '--headless=new', '--remote-debugging-port=%d' % PORT, '--user-data-dir=' + prof, '--no-first-run',
            '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars', '--window-size=%d,%d' % (width, height),
            '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--autoplay-policy=no-user-gesture-required',
            '--enable-gpu-rasterization', '--ignore-gpu-blocklist', 'about:blank']
    proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(100):
        try:
            v = json.load(urllib.request.urlopen('http://127.0.0.1:%d/json/version' % PORT))
            return proc, prof, v['webSocketDebuggerUrl']
        except Exception:
            time.sleep(.1)
    raise RuntimeError('chrome did not start')


class Page:
    def __init__(self, cdp, prof, media=None):
        self.c = cdp
        self.p = prof
        t = cdp.call('Target.createTarget', {'url': 'about:blank'})
        self.s = cdp.call('Target.attachToTarget', {'targetId': t['targetId'], 'flatten': True})['sessionId']
        for d in ('Page', 'Network', 'Runtime', 'Log', 'Performance'):
            self.call(d + '.enable')
        self.call('Network.setCacheDisabled', {'cacheDisabled': True})
        self.call('Emulation.setDeviceMetricsOverride', {'width': prof['width'], 'height': prof['height'], 'deviceScaleFactor': prof['dpr'], 'mobile': prof['mobile']})
        if prof['mobile']:
            self.call('Emulation.setTouchEmulationEnabled', {'enabled': True, 'maxTouchPoints': 5})
            self.call('Emulation.setUserAgentOverride', {'userAgent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', 'platform': 'iPhone'})
        if prof['cpu'] > 1:
            self.call('Emulation.setCPUThrottlingRate', {'rate': prof['cpu']})
        if prof['net']:
            self.call('Network.emulateNetworkConditions', prof['net'])
        if media:
            self.call('Emulation.setEmulatedMedia', {'features': media})
        self.call('Page.addScriptToEvaluateOnNewDocument', {'source': OBSERVERS})

    def call(self, m, p=None, timeout=60):
        return self.c.call(m, p, self.s, timeout)

    def js(self, expr, await_promise=False):
        r = self.call('Runtime.evaluate', {'expression': expr, 'returnByValue': True, 'awaitPromise': await_promise}, timeout=120)
        if 'exceptionDetails' in r:
            raise RuntimeError(r['exceptionDetails'].get('text', '') + ' ' + json.dumps(r['exceptionDetails'].get('exception', {}).get('description', '')))
        return r.get('result', {}).get('value')

    def goto(self, url):
        self.c.net.clear()
        self.t_nav = time.time()
        self.call('Page.navigate', {'url': url})
        self.c.wait_event('Page.loadEventFired', 90)
        self.t_load = time.time()

    def net_snapshot(self):
        rs = [r for r in self.c.net.values() if r.get('status') != 0]
        img = [r for r in rs if '/renders/' in r['url']]
        seqf = [r for r in img if '/seq-' in r['url']]
        by = {}
        for r in rs:
            host = r['url'].split('/')[2] if '//' in r['url'] else r['url'][:20]
            k = host + ' ' + (r.get('mime', '') or r['type']).split(';')[0]
            by.setdefault(k, [0, 0])
            by[k][0] += 1
            by[k][1] += r['bytes']
        top = sorted(rs, key=lambda r: -r['bytes'])[:6]
        return {'requests': len(rs), 'kb': round(sum(r['bytes'] for r in rs) / 1024), 'renders_kb': round(sum(r['bytes'] for r in img) / 1024),
                'seq_frames': len(seqf), 'failed': [r['url'] for r in rs if r.get('failed')],
                'by_type': {k: [v[0], round(v[1] / 1024)] for k, v in sorted(by.items(), key=lambda kv: -kv[1][1])},
                'top': [[r['url'][-70:], round(r['bytes'] / 1024)] for r in top]}

    def perf(self):
        return self.js('(function(){var P=__perf;return {lcp:Math.round(P.lcp),lcpEl:P.lcpEl,fcp:Math.round(P.fcp),long:P.long,errors:P.errors,heapMB:performance.memory?+(performance.memory.usedJSHeapSize/1048576).toFixed(1):null,renderer:(function(){try{var g=document.createElement("canvas").getContext("webgl"),x=g.getExtension("WEBGL_debug_renderer_info");return g.getParameter(x.UNMASKED_RENDERER_WEBGL)}catch(e){return ""}})()}})()')

    def scroll_to(self, y):
        self.js('window.scrollTo(0, %d)' % y)

    def gesture(self, distance, seconds, touch):
        # one synthesized scroll (wheel or touch drag) from the viewport centre; CDP returns when it is done
        x, y = self.p['width'] / 2, self.p['height'] / 2
        self.call('Input.synthesizeScrollGesture', {'x': x, 'y': y, 'yDistance': -distance, 'speed': int(distance / seconds),
                                                    'gestureSourceType': 'touch' if touch else 'mouse', 'preventFling': True}, timeout=120)

    def metrics(self):
        m = {x['name']: x['value'] for x in self.call('Performance.getMetrics')['metrics']}
        return {k: m.get(k, 0) for k in ('RecalcStyleCount', 'RecalcStyleDuration', 'LayoutCount', 'LayoutDuration', 'ScriptDuration', 'TaskDuration')}

    def record_during(self, ms, action):
        m0 = self.metrics()
        self.call('Runtime.evaluate', {'expression': 'window.__hookBoards(); window.__recP = window.__rec(%d)' % ms})
        action()
        r = self.js('window.__recP', True)
        m1 = self.metrics()
        r['styleRecalcs'] = int(m1['RecalcStyleCount'] - m0['RecalcStyleCount'])
        r['styleMs'] = round((m1['RecalcStyleDuration'] - m0['RecalcStyleDuration']) * 1000)
        r['layouts'] = int(m1['LayoutCount'] - m0['LayoutCount'])
        r['layoutMs'] = round((m1['LayoutDuration'] - m0['LayoutDuration']) * 1000)
        r['scriptMs'] = round((m1['ScriptDuration'] - m0['ScriptDuration']) * 1000)
        r['taskMs'] = round((m1['TaskDuration'] - m0['TaskDuration']) * 1000)
        return r


def cpu_top(profile, n=18):
    """self time per function from a Profiler.stop result, top n, with the long tasks' worst offenders"""
    nodes = {nd['id']: nd for nd in profile['nodes']}
    self_t = {}
    for sid, dt in zip(profile['samples'], profile['timeDeltas']):
        cf = nodes[sid]['callFrame']
        key = '%s  %s:%s' % (cf['functionName'] or '(anon)', cf['url'].split('/')[-1] or '(native)', cf['lineNumber'] + 1)
        self_t[key] = self_t.get(key, 0) + dt
    total = sum(self_t.values()) / 1000
    top = sorted(self_t.items(), key=lambda kv: -kv[1])[:n]
    return {'total_ms': round(total), 'top': [[k, round(v / 1000)] for k, v in top]}


def measure(url, name, out, cpu=False):
    prof = PROFILES[name]
    proc, udir, ws = launch(prof['width'], prof['height'])
    res = {'profile': name, 'url': url, 'when': time.strftime('%Y-%m-%d %H:%M')}
    try:
        cdp = CDP(ws)
        pg = Page(cdp, prof)
        if cpu:
            pg.call('Profiler.enable'); pg.call('Profiler.setSamplingInterval', {'interval': 500}); pg.call('Profiler.start')
        pg.goto(url)
        res['nav_to_load_s'] = round(pg.t_load - pg.t_nav, 1)
        # initial: what the page has fetched 3 s after the load event, with no interaction
        while time.time() - pg.t_load < 3:
            cdp.pump(.25)
        res['initial'] = pg.net_snapshot()
        p = pg.perf()
        res['lcp_ms'] = p['lcp']; res['lcp_el'] = p['lcpEl']; res['fcp_ms'] = p['fcp']
        res['renderer'] = p['renderer']
        # idle: everything the page fetches on its own before any scroll (load + 12 s)
        while time.time() - pg.t_load < 12:
            cdp.pump(.5)
        res['idle'] = pg.net_snapshot()
        p = pg.perf()
        load_ms = pg.js('performance.timing.loadEventStart - performance.timing.navigationStart')
        res['load_ms'] = load_ms
        res['dcl_ms'] = pg.js('performance.timing.domContentLoadedEventStart - performance.timing.navigationStart')
        longs = p['long']
        tbt = sum(max(0, d - 50) for s, d in longs if p['fcp'] <= s <= load_ms + 5000)
        res['tbt_ms'] = round(tbt)
        res['long_tasks'] = {'count': len(longs), 'max_ms': max([d for s, d in longs] or [0]),
                             'after_load': [[s, d] for s, d in longs if s > load_ms], 'max_after_load_ms': max([d for s, d in longs if s > load_ms] or [0])}
        res['heap_mb'] = p['heapMB']
        res['errors'] = p['errors']
        # hero board animating at the top, no scroll
        pg.scroll_to(0)
        cdp.pump(.8)
        res['board_frames'] = pg.record_during(3000, lambda: cdp.pump(3.2))
        # scrub the hero (story) sequence: pinned for 260% of the viewport
        vh = prof['height']
        top = pg.js('(function(){var e=document.querySelector("#story");return Math.round(e.getBoundingClientRect().top+scrollY)})()')
        pg.scroll_to(top)
        cdp.pump(1.5)
        res['hero_scrub'] = pg.record_during(3500, lambda: pg.gesture(2.6 * vh, 3.0, prof['mobile']))
        res['hero_scrub']['seq_frames_loaded'] = pg.net_snapshot()['seq_frames']
        if cpu:
            res['cpu'] = cpu_top(pg.call('Profiler.stop', timeout=120)['profile'])
        top = pg.js('(function(){var e=document.querySelector("#colors");return Math.round(e.getBoundingClientRect().top+scrollY)})()')
        pg.scroll_to(top)
        cdp.pump(2.5)
        res['colors_scrub'] = pg.record_during(3500, lambda: pg.gesture(2.2 * vh, 3.0, prof['mobile']))
        # the tiles section: several boards animating at once
        top = pg.js('(function(){var e=document.querySelector("#shows");return Math.round(e.getBoundingClientRect().top+scrollY)+Math.round(innerHeight*.6)})()')
        pg.scroll_to(top)
        cdp.pump(2.0)
        res['tiles_frames'] = pg.record_during(3000, lambda: cdp.pump(3.2))
        res['tiles_frames']['boards_rendering'] = pg.js('MooBoard.boards.filter(function(b){return b.visible&&!(b.opts.when&&!b.opts.when())}).length')
        # full scroll payload
        h = pg.js('document.documentElement.scrollHeight')
        y = 0
        while y < h:
            y += int(vh * .8)
            pg.scroll_to(y)
            cdp.pump(.35)
        cdp.pump(1.0)
        cdp.quiet(2.0, 40)
        res['full_scroll'] = pg.net_snapshot()
        p = pg.perf()
        res['heap_mb_end'] = p['heapMB']
        res['errors'] = p['errors']
        res['long_tasks']['max_total_ms'] = max([d for s, d in p['long']] or [0])
        res['scrollWidth_overflow'] = pg.js('document.documentElement.scrollWidth > innerWidth')
    finally:
        proc.terminate()
        shutil.rmtree(udir, ignore_errors=True)
    if out:
        with open(out, 'w') as f:
            json.dump(res, f, indent=1)
    return res


def quick(url, name):
    """load only: FCP, LCP, load, TBT, initial transfer"""
    prof = PROFILES[name]
    proc, udir, ws = launch(prof['width'], prof['height'])
    try:
        cdp = CDP(ws)
        pg = Page(cdp, prof)
        pg.goto(url)
        while time.time() - pg.t_load < 3:
            cdp.pump(.25)
        p = pg.perf()
        load_ms = pg.js('performance.timing.loadEventStart - performance.timing.navigationStart')
        tbt = sum(max(0, d - 50) for s, d in p['long'] if p['fcp'] <= s <= load_ms + 5000)
        snap = pg.net_snapshot()
        return {'url': url, 'fcp': p['fcp'], 'lcp': p['lcp'], 'load': load_ms, 'tbt': round(tbt), 'long': p['long'], 'requests': snap['requests'], 'kb': snap['kb'], 'errors': p['errors']}
    finally:
        proc.terminate()
        shutil.rmtree(udir, ignore_errors=True)


def checks(url, out):
    rows = []
    for w, h, mobile in ((390, 844, True), (430, 932, True), (768, 1024, True), (1440, 900, False)):
        proc, udir, ws = launch(w, h)
        try:
            cdp = CDP(ws)
            prof = dict(width=w, height=h, dpr=2 if mobile else 1, mobile=mobile, cpu=1, net=None)
            pg = Page(cdp, prof)
            pg.goto(url)
            cdp.pump(2.5)
            r = pg.js(r'''(function(){
              var q=function(s){return document.querySelector(s)};
              var gn=q('.controls .glass-hero'), gs=getComputedStyle(gn);
              var ov=[].slice.call(document.querySelectorAll('body *')).filter(function(e){var r=e.getBoundingClientRect();return r.right>innerWidth+1&&getComputedStyle(e).position!=='fixed'&&r.width>0}).slice(0,5).map(function(e){return e.tagName+(e.id?'#'+e.id:'')+(e.className&&typeof e.className==='string'?'.'+e.className.split(' ')[0]:'')});
              return {overflow:document.documentElement.scrollWidth>innerWidth, overflowers:ov, badge:gs.opacity==='1'&&parseFloat(gs.maxWidth)>0,
                badgeText:gn.textContent.trim(), hasFrames:!!q('#story.has-frames'), chips:document.querySelectorAll('#chips .chip').length,
                syllables:(window.MooBoard&&MooBoard.syllables('kitchen').join('-')), hero:!!q('#hero-board canvas'),
                colorsFirst:(q('.cp.on')||{}).dataset&&q('.cp.on').dataset.frame,
                form:(function(){var f=q('#wl-form'),i=q('#wl-email');i.value='nope';f.dispatchEvent(new Event('submit',{cancelable:true}));var m=q('#wl-msg').textContent;i.value='';return m})(),
                errors:__perf.errors.slice()};
            })()''')
            # colours pan direction: the drawn board should move from right of centre toward centre as the section scrubs
            top = pg.js('(function(){var e=document.querySelector("#colors");return Math.round(e.getBoundingClientRect().top+scrollY)})()')
            def centre():
                # horizontal centre of the dark (board) pixels across the middle band of the colours canvas
                return pg.js(r'''(function(){var c=document.querySelector('#colors .seq-canvas');if(!c||!c.width)return null;var x=c.getContext('2d'),w=c.width,h=c.height,s=0,n=0;for(var row=Math.round(h*.3);row<h*.7;row+=Math.max(1,Math.round(h/40))){var d=x.getImageData(0,row,w,1).data;for(var i=0;i<w;i++){var l=d[i*4]+d[i*4+1]+d[i*4+2];if(l<150){s+=i;n++}}}return n>50?+(s/n/w).toFixed(3):null})()''')
            pg.scroll_to(top); cdp.pump(1.2); c0 = centre()
            pg.scroll_to(top + int(h * 2.2)); cdp.pump(1.5); c1 = centre()
            r['colorsPan'] = [c0, c1]
            # reduced motion: no sequence frames
            pg2 = Page(cdp, prof, media=[{'name': 'prefers-reduced-motion', 'value': 'reduce'}])
            pg2.goto(url)
            cdp.pump(2.5)
            cdp.quiet(1.0, 6)
            r['reducedSeqFrames'] = sum(1 for x in cdp.net.values() if '/seq-' in x['url'])
            r['reducedNoAnim'] = pg2.js('document.documentElement.classList.contains("no-anim")')
            r['width'] = w
            rows.append(r)
        finally:
            proc.terminate()
            shutil.rmtree(udir, ignore_errors=True)
    if out:
        with open(out, 'w') as f:
            json.dump(rows, f, indent=1)
    return rows


SHOT_SPOTS = [('top', None, 0), ('story50', '#story', 1.3), ('story100', '#story', 2.55), ('colors0', '#colors', 0), ('colors50', '#colors', 1.1),
              ('colors100', '#colors', 2.15), ('room0', '#room', 0), ('shows', '#shows', .4), ('apps', '#apps', 0), ('tech', '#tech', 0), ('waitlist', '#waitlist', 0)]


def shots(url, outdir, label):
    """screenshots at fixed scroll spots, 390 and 1440 wide, for before/after pixel comparison (tools/perf.py --compare)"""
    os.makedirs(outdir, exist_ok=True)
    out = []
    for w, h, mobile in ((390, 844, True), (1440, 900, False)):
        proc, udir, ws = launch(w, h)
        try:
            cdp = CDP(ws)
            pg = Page(cdp, dict(width=w, height=h, dpr=1, mobile=mobile, cpu=1, net=None))
            pg.goto(url)
            cdp.pump(5.0)
            for name, sel, k in SHOT_SPOTS:
                y = 0 if not sel else pg.js('(function(){var e=document.querySelector("%s");return Math.round(e.getBoundingClientRect().top+scrollY+%f*innerHeight)})()' % (sel, k))
                pg.scroll_to(y)
                cdp.pump(2.5)
                png = pg.call('Page.captureScreenshot', {'format': 'png'})['data']
                fn = os.path.join(outdir, '%s-%d-%s.png' % (label, w, name))
                import base64
                with open(fn, 'wb') as f:
                    f.write(base64.b64decode(png))
                out.append(fn)
        finally:
            proc.terminate()
            shutil.rmtree(udir, ignore_errors=True)
    return out


def compare(outdir, a, b):
    """share of pixels that differ by more than 24/255 between <a>-*.png and <b>-*.png in outdir; writes diff images"""
    from PIL import Image, ImageChops
    rows = []
    for fa in sorted(os.listdir(outdir)):
        if not fa.startswith(a + '-') or not fa.endswith('.png'):
            continue
        fb = b + fa[len(a):]
        if not os.path.exists(os.path.join(outdir, fb)):
            continue
        ia, ib = Image.open(os.path.join(outdir, fa)).convert('RGB'), Image.open(os.path.join(outdir, fb)).convert('RGB')
        if ia.size != ib.size:
            rows.append([fa, 'size differs', ia.size, ib.size]); continue
        d = ImageChops.difference(ia, ib).convert('L').point(lambda v: 255 if v > 24 else 0)
        n = sum(1 for v in d.getdata() if v)
        rows.append([fa[len(a) + 1:-4], round(100.0 * n / (d.size[0] * d.size[1]), 2)])
        d.save(os.path.join(outdir, 'diff' + fa[len(a):]))
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', default='http://127.0.0.1:8091/')
    ap.add_argument('--profile', choices=list(PROFILES), default='desktop')
    ap.add_argument('--checks', action='store_true')
    ap.add_argument('--out')
    ap.add_argument('--cpu', action='store_true', help='CPU profile from navigation to the end of the hero scrub; top self-time functions')
    ap.add_argument('--quick', action='store_true', help='load-only: FCP, LCP, load, TBT, initial transfer')
    ap.add_argument('--shots', metavar='DIR', help='screenshots at fixed scroll spots into DIR (name them with --label)')
    ap.add_argument('--label', default='site')
    ap.add_argument('--compare', nargs=3, metavar=('DIR', 'A', 'B'), help='pixel difference between two --shots labels')
    a = ap.parse_args()
    if a.compare:
        r = compare(*a.compare)
    elif a.shots:
        r = shots(a.url, a.shots, a.label)
    else:
        r = checks(a.url, a.out) if a.checks else quick(a.url, a.profile) if a.quick else measure(a.url, a.profile, a.out, a.cpu)
    json.dump(r, sys.stdout, indent=1)
    print()


if __name__ == '__main__':
    main()
