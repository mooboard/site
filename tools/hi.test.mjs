// Tests for /hi and 404.html: the page's own script, run in node with a small stand-in DOM, fake timers, a scripted
// fetch and a stand-in window.open. Run: node --test tools/hi.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const hi = read('hi/index.html');
const notFound = read('404.html');
const script = hi.match(/<script>([\s\S]*?)<\/script>/)[1];
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

class Text {
  constructor(text) {
    this.tagName = '#TEXT';
    this.textContent = String(text);
    this.className = '';
    this.html = null;
  }

  all() {
    return [this];
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

// A tab window.open() hands back: it remembers where it was sent and whether it was closed.
class Tab {
  constructor() {
    this.opener = 'the page';
    this.closed = false;
    this.location = { href: 'about:blank' };
  }

  close() {
    this.closed = true;
  }
}

// Loads the page at `pathname` with `answer(url, opts)` as the network; returns what a test needs to look at.
// `popups: false` makes window.open return null, as a popup blocker would.
function load(pathname, answer = () => new Promise(() => {}), { popups = true } = {}) {
  const view = new El('div');
  const pupils = { pl: new El('circle'), pr: new El('circle') };
  pupils.pl.setAttribute('fill', '#0E1A22');
  pupils.pr.setAttribute('fill', '#0E1A22');
  const ids = { view, ...pupils };
  const timers = fakeTimers();
  const replaced = [];
  const assigned = [];
  const fetches = [];
  const opened = [];
  const context = {
    document: {
      getElementById: (id) => ids[id] ?? null,
      createElement: (tag) => new El(tag),
      createTextNode: (text) => new Text(text),
    },
    location: {
      pathname,
      replace: (url) => replaced.push(url),
      set href(url) {
        assigned.push(url);
      },
    },
    window: {
      open: (url, target) => {
        const tab = popups ? new Tab() : null;
        opened.push({ url, target, tab, fetchesBefore: fetches.length });
        return tab;
      },
    },
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
    assigned,
    fetches,
    opened,
    settle: async () => {
      for (let i = 0; i < 20; i += 1) await new Promise((r) => setImmediate(r));
    },
    text: () => view.textContent,
    h1: () => view.all().find((e) => e.tagName === 'H1')?.textContent,
    find: (pred) => view.all().find(pred),
    buttons: () => view.all().filter((e) => e.tagName === 'BUTTON'),
    cards: () => view.all().filter((e) => e.className === 'card'),
    idents: () => view.all().filter((e) => e.className === 'ident'),
    setup: () => view.all().find((e) => e.className === 'setup'),
    links: () => view.all().filter((e) => e.tagName === 'A' && e.className !== 'ident').map((a) => [a.textContent, a.getAttribute('href')]),
  };
  return page;
}

const SAME_WIFI = 'Open this on the same Wi-Fi as your MooBoard';
const SETUP_STEPS = [
  'Plug it in. Its screen shows how to join its own Wi-Fi.',
  'Scan the code with your phone\u2019s camera, or join mooboard-XXXX with the password shown.',
  'The setup page opens. Pick your home Wi-Fi.',
  'Come back to mooboard.co/hi.',
];

function assertSameWifi(page) {
  assert.equal(page.h1(), SAME_WIFI);
  assert.deepEqual(page.links(), [
    ['Try mooboard.local', 'http://mooboard.local'],
    ['mooboard.co/hi', '/hi'],
    ['Setup guide', 'https://mooboard.co/guide'],
  ]);
  assert.match(page.text(), /VPN or iCloud Private Relay/);
  assert.deepEqual(page.replaced, []);
  assert.equal(page.pupils.pl.getAttribute('fill'), '#0E1A22', 'the cow settles');
  const setup = page.setup();
  assert.ok(setup, 'the new-board steps');
  assert.equal(setup.children[0].textContent, 'Setting up a new MooBoard?');
  assert.deepEqual(setup.children[1].children.map((li) => li.textContent), SETUP_STEPS);
}

test('404.html and hi/index.html are the same page', () => {
  assert.equal(notFound, hi);
});

test('the page loads nothing but the api: no external scripts, styles, fonts or images', () => {
  assert.doesNotMatch(hi, /<script[^>]+src=/i);
  assert.doesNotMatch(hi, /<link[^>]+stylesheet/i);
  assert.doesNotMatch(hi, /<img\b/i);
  assert.doesNotMatch(hi, /url\(/i);
  assert.doesNotMatch(hi, /@import/i);
  const urls = new Set(hi.match(/https?:\/\/[^\s"'<>)]+/g));
  assert.deepEqual([...urls].sort(), [API, 'http://mooboard.local', 'https://mooboard.co/guide'].sort());
});

test('the old confirm step is gone', () => {
  assert.doesNotMatch(hi, /Is this yours/i);
  assert.doesNotMatch(hi, /Check the code on the label/i);
});

test('routing: a board code under any path word, or bare, looks that code up', async () => {
  const paths = ['/hi/5KAS', '/hi/5kas/', '/HI/5KAS', '/hello/5KAS', '/hello/5kas/', '/wall/5KAS', '/WALL/5kas/', '/my/5KAS',
    '/moo/5kas', '/go/5KAS', '/open/5KAS', '/5KAS', '/5kas/'];
  for (const path of paths) {
    const page = load(path);
    await page.settle();
    assert.deepEqual(page.fetches.map((f) => f.url), [`${API}/lookup/5KAS`], path);
    assert.equal(page.h1(), 'Finding your MooBoard', path);
  }
});

test('routing: /hi asks for the boards near you, the other words go to /hi', async () => {
  for (const path of ['/hi', '/hi/', '/hi/index.html', '/HI/']) {
    const page = load(path);
    await page.settle();
    assert.deepEqual(page.fetches.map((f) => f.url), [`${API}/nearby`], path);
    assert.equal(page.h1(), 'Looking for your MooBoard', path);
  }
  for (const path of ['/hello', '/hello/', '/wall', '/my/', '/moo', '/go', '/open/', '/Wall', '/HELLO']) {
    const page = load(path);
    await page.settle();
    assert.deepEqual(page.replaced, ['/hi'], path);
    assert.deepEqual(page.fetches, [], path);
  }
});

test('routing: everything else is the not-found page with a link home', async () => {
  const paths = ['/guide', '/wall/5KA', '/wall/5KASX', '/wall/5KA0', '/team/5KAS', '/LOVE', '/blog', '/', '/hi/OOPS', '/hi/5KAS/x',
    '/wall/5KAS/x', '/5KAS.html', '/hii', '/hi5KAS'];
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
  const page = load('/hi/5KAS', () => json({ found: true, localIp: '192.168.0.110', name: 'Kitchen' }));
  await page.settle();
  assert.deepEqual(page.replaced, ['http://192.168.0.110/']);
  assert.equal(page.h1(), 'Opening Kitchen…');
  const { opts } = page.fetches[0];
  assert.equal(opts.cache, 'no-store');
  assert.equal(opts.credentials, 'omit');
  assert.ok(opts.signal, 'a timeout can abort it');
  assert.equal(page.timers.count(), 0, 'no timer left running');
});

test('a printed link shows the same-Wi-Fi page, with the new-board steps, when not found or on any failure', async () => {
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
  const page = load('/hi');
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

test('/hi with several boards: a card each, a tap opens that one, and Identify opens its page in a new tab', async () => {
  const page = load('/hi', nearbyOf([BEDROOM, KITCHEN]));
  await page.settle();
  assert.equal(page.h1(), 'Pick your MooBoard');
  const cards = page.cards();
  assert.equal(cards.length, 2);
  assert.deepEqual(cards.map((c) => c.textContent), ['bedroomT8QP', 'Kitchen5KAS']);
  assert.ok(cards.every((c) => c.children[0].html.includes('<use href="#cow"/>')), 'a mini cow on each');
  assert.equal(cards[0].children[1].children[0].tagName, 'B', 'the name in big type');
  assert.equal(cards[0].children[1].children[1].tagName, 'SMALL', 'the code small');
  assert.equal(page.setup(), undefined, 'no new-board steps when boards are found');
  const idents = page.idents();
  assert.equal(idents.length, 2);
  for (const [i, board] of [BEDROOM, KITCHEN].entries()) {
    const a = idents[i];
    assert.equal(a.tagName, 'A', 'a real link, so no popup blocker stands in the way');
    assert.equal(a.textContent, 'Identify');
    assert.equal(a.getAttribute('href'), `http://${board.localIp}/identify`);
    assert.equal(a.getAttribute('target'), '_blank');
    assert.equal(a.getAttribute('rel'), 'noopener noreferrer');
    assert.equal(a.getAttribute('aria-label'), `Identify ${board.name}`);
  }
  // Each Identify sits beside its own card, not inside it.
  const rows = page.view.all().filter((e) => e.className === 'row');
  assert.deepEqual(rows.map((r) => r.children.map((c) => c.className)), [['card', 'ident'], ['card', 'ident']]);
  assert.equal(page.pupils.pl.getAttribute('fill'), '#0E1A22');
  cards[1].click();
  assert.deepEqual(page.replaced, ['http://192.168.0.110/']);
  assert.deepEqual(page.opened, [], 'opening a board opens no tab');
});

test('/hi with one board opens it after 1.5 s, with no Identify', async () => {
  const page = load('/hi', nearbyOf([KITCHEN]));
  await page.settle();
  assert.equal(page.h1(), 'Opening Kitchen…');
  assert.equal(page.cards().length, 1);
  assert.deepEqual(page.idents(), []);
  assert.equal(page.setup(), undefined);
  page.timers.advance(1499);
  assert.deepEqual(page.replaced, []);
  page.timers.advance(1);
  assert.deepEqual(page.replaced, ['http://192.168.0.110/']);
});

test('/hi with one board: "Stay here" cancels, and the card still opens it', async () => {
  const page = load('/hi', nearbyOf([KITCHEN]));
  await page.settle();
  page.timers.advance(800);
  page.buttons().find((b) => b.textContent === 'Stay here').click();
  page.timers.advance(10000);
  assert.deepEqual(page.replaced, []);
  assert.equal(page.h1(), 'Your MooBoard');
  assert.deepEqual(page.idents(), []);
  page.cards()[0].click();
  assert.deepEqual(page.replaced, ['http://192.168.0.110/']);
  assert.equal(page.timers.count(), 0);
});

test('/hi with one board: tapping the card goes at once, and only once', async () => {
  const page = load('/hi', nearbyOf([KITCHEN]));
  await page.settle();
  page.cards()[0].click();
  page.timers.advance(5000);
  assert.deepEqual(page.replaced, ['http://192.168.0.110/']);
});

test('/hi with no boards, or a failure, shows the same-Wi-Fi page and the new-board steps', async () => {
  for (const answer of [nearbyOf([]), () => Promise.reject(new TypeError('offline')), () => json({}, 500), () => json({ boards: 'x' }),
    nearbyOf([{ code: '5KAS', name: 'Kitchen', localIp: '8.8.8.8' }]), nearbyOf([], true)]) {
    const page = load('/hi', answer);
    await page.settle();
    assertSameWifi(page);
  }
});

const SHARED = [
  { code: '5KAS', name: 'Kitchen', version: '1.4.0', lastSeen: 1 },
  { code: 'T8QP', name: 'Kitchen', version: '1.4.0', lastSeen: 1 },
];
const sharedNet = (lookup) => (url) => {
  if (url === `${API}/nearby`) return json({ boards: SHARED, shared: true });
  if (url === `${API}/lookup/T8QP`) return lookup();
  throw new Error(`unexpected ${url}`);
};
const FOUND = () => json({ found: true, localIp: '192.168.0.120', name: 'Kitchen' });

test('/hi on a shared connection: name and code only, each with an Identify button', async () => {
  const page = load('/hi', sharedNet(FOUND));
  await page.settle();
  assert.equal(page.h1(), 'Pick your MooBoard');
  assert.match(page.text(), /shared/);
  assert.deepEqual(page.cards().map((c) => c.textContent), ['Kitchen5KAS', 'KitchenT8QP']);
  const idents = page.idents();
  assert.deepEqual(idents.map((b) => [b.tagName, b.textContent]), [['BUTTON', 'Identify'], ['BUTTON', 'Identify']]);
  assert.equal(page.setup(), undefined);
  page.timers.advance(10000);
  assert.deepEqual(page.replaced, [], 'nothing opens by itself');
});

test('/hi on a shared connection: Identify opens a tab in the tap, looks the board up, then sends the tab there', async () => {
  const page = load('/hi', sharedNet(FOUND));
  await page.settle();
  page.idents()[1].click();
  assert.equal(page.opened.length, 1);
  const { url, target, tab, fetchesBefore } = page.opened[0];
  assert.deepEqual([url, target], ['', '_blank']);
  assert.equal(fetchesBefore, 1, 'the tab opens before the lookup is even asked for');
  assert.equal(tab.opener, null, 'the new tab cannot reach back');
  assert.equal(tab.location.href, 'about:blank');
  await page.settle();
  assert.deepEqual(page.fetches.map((f) => f.url), [`${API}/nearby`, `${API}/lookup/T8QP`]);
  assert.equal(tab.location.href, 'http://192.168.0.120/identify');
  assert.equal(tab.closed, false);
  assert.deepEqual(page.replaced, [], 'this page stays on the list');
  assert.deepEqual(page.assigned, []);
  assert.equal(page.h1(), 'Pick your MooBoard');
});

test('/hi on a shared connection: Identify for a board the lookup cannot find closes the tab and shows the same-Wi-Fi page', async () => {
  for (const lookup of [() => json({ found: false }), () => Promise.reject(new TypeError('offline')), () => json({ found: true, localIp: '1.2.3.4' })]) {
    const page = load('/hi', sharedNet(lookup));
    await page.settle();
    page.idents()[1].click();
    await page.settle();
    const { tab } = page.opened[0];
    assert.equal(tab.closed, true);
    assert.equal(tab.location.href, 'about:blank', 'never sent anywhere');
    assertSameWifi(page);
  }
});

test('/hi on a shared connection: with popups blocked, Identify uses this tab', async () => {
  const page = load('/hi', sharedNet(FOUND), { popups: false });
  await page.settle();
  page.idents()[1].click();
  await page.settle();
  assert.deepEqual(page.assigned, ['http://192.168.0.120/identify']);
  assert.deepEqual(page.replaced, [], 'assigned, so Back returns to the list');
});

test('/hi on a shared connection: tapping a card looks it up and opens it, with no confirmation step', async () => {
  const page = load('/hi', sharedNet(FOUND));
  await page.settle();
  page.cards()[1].click();
  assert.equal(page.h1(), 'Finding Kitchen');
  await page.settle();
  assert.deepEqual(page.fetches.map((f) => f.url), [`${API}/nearby`, `${API}/lookup/T8QP`]);
  assert.deepEqual(page.replaced, ['http://192.168.0.120/']);
  assert.deepEqual(page.opened, []);
  assert.doesNotMatch(page.text(), /Is this yours/);
});

test('/hi on a shared connection: a card the lookup cannot find gives the same-Wi-Fi page', async () => {
  const page = load('/hi', sharedNet(() => json({ found: false })));
  await page.settle();
  page.cards()[1].click();
  await page.settle();
  assertSameWifi(page);
});

test('names are text, never markup, on cards and in Identify labels', async () => {
  const name = '<img src=x onerror=alert(1)>';
  const page = load('/hi', nearbyOf([{ ...KITCHEN, name }, BEDROOM]));
  await page.settle();
  const card = page.cards().find((c) => c.textContent.startsWith('<img'));
  assert.ok(card, 'listed by its literal name');
  assert.ok(page.view.all().every((e) => e.html === null || !e.html.includes('onerror')), 'never through innerHTML');
  assert.ok(page.idents().some((a) => a.getAttribute('aria-label') === `Identify ${name}`));
});

test('no em dashes or semicolons in any copy the page shows', async () => {
  const states = [
    load('/hi', nearbyOf([BEDROOM, KITCHEN])),
    load('/hi', nearbyOf([KITCHEN])),
    load('/hi', nearbyOf([])),
    load('/hi', sharedNet(FOUND)),
    load('/5KAS', () => json({ found: true, localIp: '192.168.0.110', name: 'Kitchen' })),
    load('/nope'),
    load('/hi'),
  ];
  for (const page of states) {
    await page.settle();
    assert.doesNotMatch(page.text(), /—|;/, page.h1());
  }
  const markup = hi.replace(/<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>|<!--[\s\S]*?-->/g, '');
  assert.doesNotMatch(markup, /—|;/);
});
