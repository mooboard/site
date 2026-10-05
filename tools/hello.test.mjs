// Tests for /hello and 404.html: the page's own script, run in node with a small stand-in DOM, fake timers and a
// scripted fetch. Run: node --test tools/hello.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const hello = read('hello/index.html');
const notFound = read('404.html');
const script = hello.match(/<script>([\s\S]*?)<\/script>/)[1];
const API = 'https://api.mooboard.co';

class El {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attrs = {};
    this.listeners = {};
    this.text = '';
    this.html = null;
    this.className = '';
  }

  get textContent() {
    return this.text + this.children.map((c) => c.textContent).join('');
  }

  set textContent(v) {
    this.children = [];
    this.html = null;
    this.text = String(v);
  }

  set innerHTML(v) {
    this.children = [];
    this.text = '';
    this.html = String(v);
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  setAttribute(k, v) {
    this.attrs[k] = String(v);
  }

  getAttribute(k) {
    return k in this.attrs ? this.attrs[k] : null;
  }

  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }

  click() {
    for (const fn of this.listeners.click || []) fn({ preventDefault() {}, target: this });
  }

  all() {
    return [this, ...this.children.flatMap((c) => c.all())];
  }
}

function fakeTimers() {
  let now = 0;
  let nextId = 1;
  const pending = new Map();
  const add = (fn, ms, every) => {
    const id = nextId++;
    pending.set(id, { at: now + Math.max(0, ms), fn, every });
    return id;
  };
  return {
    setTimeout: (fn, ms) => add(fn, ms, 0),
    setInterval: (fn, ms) => add(fn, ms, Math.max(1, ms)),
    clearTimeout: (id) => pending.delete(id),
    clearInterval: (id) => pending.delete(id),
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let id = null;
        let due = null;
        for (const [k, t] of pending) if (t.at <= end && (due === null || t.at < due.at)) [id, due] = [k, t];
        if (due === null) break;
        now = due.at;
        if (due.every) due.at += due.every;
        else pending.delete(id);
        due.fn();
      }
      now = end;
    },
    count: () => pending.size,
  };
}

const json = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });

// Loads the page at `pathname` with `answer(url, opts)` as the network; returns what a test needs to look at.
function load(pathname, answer = () => new Promise(() => {})) {
  const view = new El('div');
  const pupils = { pl: new El('circle'), pr: new El('circle') };
  pupils.pl.setAttribute('fill', '#0E1A22');
  pupils.pr.setAttribute('fill', '#0E1A22');
  const ids = { view, ...pupils };
  const timers = fakeTimers();
  const replaced = [];
  const fetches = [];
  const context = {
    document: { getElementById: (id) => ids[id] ?? null, createElement: (tag) => new El(tag) },
    location: { pathname, replace: (url) => replaced.push(url) },
    fetch: (url, opts) => {
      fetches.push({ url, opts });
      return Promise.resolve().then(() => answer(url, opts));
    },
    AbortController,
    Math,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
  };
  vm.createContext(context);
  vm.runInContext(script, context);
  const page = {
    view,
    pupils,
    timers,
    replaced,
    fetches,
    settle: async () => {
      for (let i = 0; i < 20; i += 1) await new Promise((r) => setImmediate(r));
    },
    text: () => view.textContent,
    h1: () => view.all().find((e) => e.tagName === 'H1')?.textContent,
    find: (pred) => view.all().find(pred),
    buttons: () => view.all().filter((e) => e.tagName === 'BUTTON'),
    cards: () => view.all().filter((e) => e.className === 'card'),
    links: () => view.all().filter((e) => e.tagName === 'A').map((a) => [a.textContent, a.getAttribute('href')]),
  };
  return page;
}

const SAME_WIFI = 'Open this on the same Wi-Fi as your MooBoard';

function assertSameWifi(page) {
  assert.equal(page.h1(), SAME_WIFI);
  assert.deepEqual(page.links(), [['Try mooboard.local', 'http://mooboard.local'], ['Setup guide', 'https://mooboard.co/guide']]);
  assert.match(page.text(), /VPN or iCloud Private Relay/);
  assert.deepEqual(page.replaced, []);
  assert.equal(page.pupils.pl.getAttribute('fill'), '#0E1A22', 'the cow settles');
}

test('404.html and hello/index.html are the same page', () => {
  assert.equal(notFound, hello);
});

test('the page loads nothing but the api: no external scripts, styles, fonts or images', () => {
  assert.doesNotMatch(hello, /<script[^>]+src=/i);
  assert.doesNotMatch(hello, /<link[^>]+stylesheet/i);
  assert.doesNotMatch(hello, /<img\b/i);
  assert.doesNotMatch(hello, /url\(/i);
  assert.doesNotMatch(hello, /@import/i);
  const urls = new Set(hello.match(/https?:\/\/[^\s"'<>)]+/g));
  assert.deepEqual([...urls].sort(), [API, 'http://mooboard.local', 'https://mooboard.co/guide'].sort());
  assert.doesNotMatch(hello.replace(/<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>|<!--[\s\S]*?-->/g, ''), /—|;/,
    'no em dashes or semicolons in visible copy');
});

test('routing: a board code under any path word, or bare, looks that code up', async () => {
  const paths = ['/wall/5KAS', '/WALL/5kas/', '/my/5KAS', '/moo/5kas', '/go/5KAS', '/open/5KAS', '/hello/5KAS', '/hello/5kas/', '/5KAS', '/5kas/'];
  for (const path of paths) {
    const page = load(path);
    await page.settle();
    assert.deepEqual(page.fetches.map((f) => f.url), [`${API}/lookup/5KAS`], path);
    assert.equal(page.h1(), 'Finding your MooBoard', path);
  }
});

test('routing: /hello asks for the nearby boards, the other words go to /hello', async () => {
  for (const path of ['/hello', '/hello/', '/hello/index.html', '/HELLO/']) {
    const page = load(path);
    await page.settle();
    assert.deepEqual(page.fetches.map((f) => f.url), [`${API}/nearby`], path);
  }
  for (const path of ['/wall', '/my/', '/moo', '/go', '/open/', '/Wall']) {
    const page = load(path);
    await page.settle();
    assert.deepEqual(page.replaced, ['/hello'], path);
    assert.deepEqual(page.fetches, [], path);
  }
});

test('routing: everything else is the not-found page with a link home', async () => {
  const paths = ['/guide', '/wall/5KA', '/wall/5KASX', '/wall/5KA0', '/team/5KAS', '/LOVE', '/blog', '/', '/hello/OOPS', '/wall/5KAS/x', '/5KAS.html'];
  for (const path of paths) {
    const page = load(path);
    await page.settle();
    assert.equal(page.h1(), 'Page not found', path);
    assert.deepEqual(page.links(), [['Go to mooboard.co', '/']], path);
    assert.deepEqual(page.fetches, [], path);
    assert.deepEqual(page.replaced, [], path);
  }
});

test('a printed link opens the board when the api finds it', async () => {
  const page = load('/wall/5KAS', () => json({ found: true, localIp: '192.168.0.110', name: 'Kitchen' }));
  await page.settle();
  assert.deepEqual(page.replaced, ['http://192.168.0.110/']);
  assert.equal(page.h1(), 'Opening Kitchen…');
  const { opts } = page.fetches[0];
  assert.equal(opts.cache, 'no-store');
  assert.equal(opts.credentials, 'omit');
  assert.ok(opts.signal, 'a timeout can abort it');
  assert.equal(page.timers.count(), 0, 'no timer left running');
});

test('a printed link shows the same-Wi-Fi page when the board is not found, or on any failure', async () => {
  const answers = {
    'not found': () => json({ found: false }),
    'a public address': () => json({ found: true, localIp: '8.8.8.8', name: 'x' }),
    'a bad address': () => json({ found: true, localIp: 'http://evil.example/', name: 'x' }),
    'bad JSON': () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); } }),
    'an HTTP error': () => json({ error: 'store' }, 503),
    'rate limited': () => json({ error: 'rate' }, 429),
    'a network error': () => Promise.reject(new TypeError('Failed to fetch')),
    'not an object': () => json(null),
  };
  for (const [why, answer] of Object.entries(answers)) {
    const page = load('/5KAS', answer);
    await page.settle();
    assert.equal(page.h1(), SAME_WIFI, why);
    assertSameWifi(page);
  }
});

test('a lookup that hangs gives up after 6 s', async () => {
  const page = load('/5KAS', (url, opts) => new Promise((resolve, reject) => {
    opts.signal.addEventListener('abort', () => reject(new Error('aborted')));
  }));
  await page.settle();
  page.timers.advance(5999);
  await page.settle();
  assert.equal(page.h1(), 'Finding your MooBoard');
  page.timers.advance(1);
  await page.settle();
  assertSameWifi(page);
});

test('the cow\'s pupils flicker through full hues while it looks, every 100 ms', async () => {
  const page = load('/hello');
  const seen = new Set();
  for (let i = 0; i < 10; i += 1) {
    const fill = page.pupils.pl.getAttribute('fill');
    assert.match(fill, /^hsl\(\d{1,3},100%,50%\)$/);
    seen.add(fill + page.pupils.pr.getAttribute('fill'));
    page.timers.advance(100);
  }
  assert.ok(seen.size > 5, 'new colours as it goes');
});

const nearbyOf = (boards, shared = false) => (url) => {
  if (url === `${API}/nearby`) return json({ boards, shared });
  throw new Error(`unexpected ${url}`);
};
const KITCHEN = { code: '5KAS', name: 'Kitchen', localIp: '192.168.0.110', version: '1.4.0', lastSeen: 1 };
const BEDROOM = { code: 'T8QP', name: 'bedroom', localIp: '192.168.0.111', version: '1.4.0', lastSeen: 1 };

test('/hello with several boards lists them as cards and a tap opens that one', async () => {
  const page = load('/hello', nearbyOf([BEDROOM, KITCHEN]));
  await page.settle();
  assert.equal(page.h1(), 'Pick your MooBoard');
  const cards = page.cards();
  assert.equal(cards.length, 2);
  assert.deepEqual(cards.map((c) => c.textContent), ['bedroomT8QP', 'Kitchen5KAS']);
  assert.ok(cards.every((c) => c.children[0].html.includes('<use href="#cow"/>')), 'a mini cow on each');
  assert.equal(cards[0].children[1].children[0].tagName, 'B', 'the name in big type');
  assert.equal(cards[0].children[1].children[1].tagName, 'SMALL', 'the code small');
  assert.equal(page.pupils.pl.getAttribute('fill'), '#0E1A22');
  cards[1].click();
  assert.deepEqual(page.replaced, ['http://192.168.0.110/']);
});

test('/hello with one board opens it after 1.5 s', async () => {
  const page = load('/hello', nearbyOf([KITCHEN]));
  await page.settle();
  assert.equal(page.h1(), 'Opening Kitchen…');
  assert.equal(page.cards().length, 1);
  page.timers.advance(1499);
  assert.deepEqual(page.replaced, []);
  page.timers.advance(1);
  assert.deepEqual(page.replaced, ['http://192.168.0.110/']);
});

test('/hello with one board: "Stay here" cancels, and the card still opens it', async () => {
  const page = load('/hello', nearbyOf([KITCHEN]));
  await page.settle();
  page.timers.advance(800);
  page.buttons().find((b) => b.textContent === 'Stay here').click();
  page.timers.advance(10000);
  assert.deepEqual(page.replaced, []);
  assert.equal(page.h1(), 'Your MooBoard');
  page.cards()[0].click();
  assert.deepEqual(page.replaced, ['http://192.168.0.110/']);
  assert.equal(page.timers.count(), 0);
});

test('/hello with one board: tapping the card goes at once, and only once', async () => {
  const page = load('/hello', nearbyOf([KITCHEN]));
  await page.settle();
  page.cards()[0].click();
  page.timers.advance(5000);
  assert.deepEqual(page.replaced, ['http://192.168.0.110/']);
});

test('/hello with no boards, or a failure, shows the same-Wi-Fi page', async () => {
  for (const answer of [nearbyOf([]), () => Promise.reject(new TypeError('offline')), () => json({}, 500), () => json({ boards: 'x' }),
    nearbyOf([{ code: '5KAS', name: 'Kitchen', localIp: '8.8.8.8' }]), nearbyOf([], true)]) {
    const page = load('/hello', answer);
    await page.settle();
    assertSameWifi(page);
  }
});

test('/hello on a shared connection: name and code only, and a tap asks "Is this yours?" before opening', async () => {
  const shared = [
    { code: '5KAS', name: 'Kitchen', version: '1.4.0', lastSeen: 1 },
    { code: 'T8QP', name: 'Kitchen', version: '1.4.0', lastSeen: 1 },
  ];
  const page = load('/hello', (url) => {
    if (url === `${API}/nearby`) return json({ boards: shared, shared: true });
    if (url === `${API}/lookup/T8QP`) return json({ found: true, localIp: '192.168.0.120', name: 'Kitchen' });
    throw new Error(`unexpected ${url}`);
  });
  await page.settle();
  assert.equal(page.h1(), 'Pick your MooBoard');
  assert.match(page.text(), /shared/);
  assert.deepEqual(page.cards().map((c) => c.textContent), ['Kitchen5KAS', 'KitchenT8QP']);
  page.timers.advance(10000);
  assert.deepEqual(page.replaced, [], 'nothing opens by itself');
  page.cards()[1].click();
  await page.settle();
  assert.deepEqual(page.fetches.map((f) => f.url), [`${API}/nearby`, `${API}/lookup/T8QP`]);
  assert.equal(page.h1(), 'Is this yours?');
  assert.match(page.text(), /Check the code on the label/);
  assert.equal(page.find((e) => e.className === 'code').textContent, 'T8QP', 'the code, big');
  assert.deepEqual(page.replaced, [], 'not before the owner confirms');
  page.buttons().find((b) => b.textContent === 'Back').click();
  assert.equal(page.h1(), 'Pick your MooBoard');
  page.cards()[1].click();
  await page.settle();
  page.buttons().find((b) => b.textContent === 'Yes, open it').click();
  assert.deepEqual(page.replaced, ['http://192.168.0.120/']);
});

test('/hello on a shared connection: a board the lookup cannot find gives the same-Wi-Fi page', async () => {
  const page = load('/hello', (url) => (url.endsWith('/nearby')
    ? json({ boards: [{ code: '5KAS', name: 'Kitchen' }], shared: true })
    : json({ found: false })));
  await page.settle();
  page.cards()[0].click();
  await page.settle();
  assertSameWifi(page);
});

test('names are text, never markup', async () => {
  const name = '<img src=x onerror=alert(1)>';
  const page = load('/hello', nearbyOf([{ ...KITCHEN, name }, BEDROOM]));
  await page.settle();
  const card = page.cards().find((c) => c.textContent.startsWith('<img'));
  assert.ok(card, 'listed by its literal name');
  assert.ok(page.view.all().every((e) => e.html === null || !e.html.includes('onerror')), 'never through innerHTML');
});
