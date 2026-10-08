// tests for /hi and 404.html + js/finder.js runs in the stand in browser of tools/finder-harness.mjs
// + run node --test tools/hi.test.mjs tools/portal.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { API, BEDROOM, CROSS, FOUND, KITCHEN, PLUS, SHARED, json, load, nearbyOf, read, script, sharedNet } from './finder-harness.mjs';

const hi = read('hi/index.html');
const notFound = read('404.html');
const css = read('css/finder.css');

const SAME_WIFI = 'Open this on the same Wi-Fi as your mooboard';
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
    ['mooboard.co/hi', '/hi/'],
    ['Setup guide', 'https://mooboard.co/guide'],
  ]);
  assert.deepEqual(page.buttons().map((b) => b.textContent), ['Try again']);
  assert.match(page.find((e) => e.className === 'quiet')?.textContent ?? '', /^A VPN or iCloud Private Relay/, 'the VPN note keeps its look');
  assert.deepEqual(page.replaced, []);
  assert.equal(page.pupils.pl.getAttribute('fill'), '#0E1A22', 'the cow settles');
  const setup = page.setup();
  assert.ok(setup, 'the new-board steps');
  assert.equal(setup.children[0].textContent, 'Setting up a new mooboard?');
  assert.deepEqual(setup.children[1].children.map((li) => li.textContent), SETUP_STEPS);
}

const DOWN = 'Could not reach mooboard.co';

// the api did not answer + a page of its own that blames nothing on the wifi
function assertDown(page) {
  assert.equal(page.h1(), DOWN);
  assert.deepEqual(page.buttons().map((b) => b.textContent), ['Try again']);
  assert.deepEqual(page.links(), [
    ['Try mooboard.local', 'http://mooboard.local'],
    ['Setup guide', 'https://mooboard.co/guide'],
  ]);
  assert.doesNotMatch(page.text(), /same Wi-Fi|VPN|same home network/, 'nothing blames the Wi-Fi');
  assert.equal(page.setup(), undefined);
  assert.deepEqual(page.replaced, []);
  assert.equal(page.pupils.pl.getAttribute('fill'), '#0E1A22', 'the cow settles');
}

test('404.html and hi/index.html are the same page', () => {
  assert.equal(notFound, hi);
});

test('the page loads its shared css and js, the api, and /js/board.js for a board: no other scripts, styles, fonts or images', () => {
  assert.deepEqual(hi.match(/<script[^>]*src="[^"]*"/g), ['<script src="/js/finder.js"']);
  assert.deepEqual(hi.match(/<link[^>]+stylesheet[^>]*>/g), ['<link rel="stylesheet" href="/css/finder.css">']);
  assert.deepEqual(script.match(/'[^']*\.js'/g), ["'/js/board.js'", "'/portal/sw.js'"]);
  for (const text of [hi, css]) {
    assert.doesNotMatch(text, /<img\b/i);
    assert.doesNotMatch(text, /url\(/i);
    assert.doesNotMatch(text, /@import/i);
  }
  const urls = new Set((hi + script).match(/https?:\/\/[^\s"'<>)]+/g));
  assert.deepEqual([...urls].sort(), [API, 'http://mooboard.local', 'http://www.w3.org/2000/svg', 'https://mooboard.co/guide'].sort());
  assert.match(hi, /<meta name="referrer" content="no-referrer">/);
});

test('without JavaScript it says so, for a board and for any other page', () => {
  const noscript = hi.match(/<noscript>([\s\S]*?)<\/noscript>/)[1];
  assert.match(noscript, /<h1>This page needs JavaScript<\/h1>/);
  assert.match(noscript, /<a href="http:\/\/mooboard\.local">mooboard\.local<\/a>/);
  assert.match(noscript, /<a href="\/">mooboard\.co<\/a>/);
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
    assert.equal(page.h1(), 'Finding your mooboard', path);
  }
});

test('routing: /hi asks for the boards near you, the other words go to /hi', async () => {
  for (const path of ['/hi', '/hi/', '/hi/index.html', '/HI/']) {
    const page = load(path);
    await page.settle();
    assert.deepEqual(page.fetches.map((f) => f.url), [`${API}/nearby`], path);
    assert.equal(page.h1(), 'Looking for your mooboard', path);
  }
  for (const path of ['/hello', '/hello/', '/wall', '/my/', '/moo', '/go', '/open/', '/Wall', '/HELLO']) {
    const page = load(path);
    await page.settle();
    assert.deepEqual(page.replaced, ['/hi/'], path);
    assert.deepEqual(page.fetches, [], path);
  }
});

test('routing: the buttons tour is a sheet on the start page now, and every spelling of its old address goes there with its frame', async () => {
  for (const [path, search, to] of [['/hi/buttons', '', '/start/#buttons'], ['/hi/buttons/', '?frame=midnight', '/start/?frame=midnight#buttons'],
    ['/hi/Buttons/', '', '/start/#buttons'], ['/HI/BUTTONS', '?frame=red', '/start/?frame=red#buttons'],
    ['/hi/buttons/index.html', '?frame=mint', '/start/?frame=mint#buttons'], ['/hi/Buttons/index.html', '?frame=mint', '/start/?frame=mint#buttons']]) {
    const page = load(path, undefined, { search });
    await page.settle();
    assert.deepEqual(page.replaced, [to], path);
    assert.deepEqual(page.fetches, [], path);
  }
  // never a board code + other words are not found
  for (const path of ['/hi/buttons/x', '/hi/buttonss', '/buttons']) {
    const page = load(path);
    await page.settle();
    assert.equal(page.h1(), 'Page not found', path);
    assert.deepEqual(page.replaced, [], path);
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
  assert.equal(opts.referrerPolicy, 'no-referrer');
  assert.ok(opts.signal, 'a timeout can abort it');
  assert.equal(page.timers.count(), 0, 'no timer left running');
});

test('a printed link shows the same-Wi-Fi page, with the new-board steps, when the api has no board for it', async () => {
  const answers = {
    'not found': () => json({ found: false }),
    'a public address': () => json({ found: true, localIp: '8.8.8.8', name: 'x' }),
    'a bad address': () => json({ found: true, localIp: 'http://evil.example/', name: 'x' }),
    'not an object': () => json(null),
  };
  for (const [why, answer] of Object.entries(answers)) {
    const page = load('/5KAS', answer);
    await page.settle();
    assert.equal(page.h1(), SAME_WIFI, why);
    assertSameWifi(page);
  }
});

test('a printed link says the api could not be reached, not that the Wi-Fi is wrong, when the api fails', async () => {
  const answers = {
    'bad JSON': () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); } }),
    'an HTTP error': () => json({ error: 'store' }, 503),
    'rate limited': () => json({ error: 'rate' }, 429),
    'a network error': () => Promise.reject(new TypeError('Failed to fetch')),
  };
  for (const [why, answer] of Object.entries(answers)) {
    const page = load('/5KAS', answer);
    await page.settle();
    assert.equal(page.h1(), DOWN, why);
    assertDown(page);
  }
});

// the start page a new board's sticker link goes to + its model and its code
const START = (m) => `/start/?m=${m}&u=5KAS`;

test('a sticker link names the model in ?m= and goes to the start page when the api has no board for it on this network', async () => {
  const answers = {
    'not found': () => json({ found: false }),
    'a public address': () => json({ found: true, localIp: '8.8.8.8', name: 'x' }),
    'a bad address': () => json({ found: true, localIp: 'http://evil.example/', name: 'x' }),
    'not an object': () => json(null),
  };
  for (const path of ['/hi/5KAS', '/hi/5kas/', '/HI/5KAS', '/5KAS', '/wall/5KAS', '/portal/5KAS']) {
    for (const [why, answer] of Object.entries(answers)) {
      const page = load(path, answer, { search: '?m=MB1W' });
      assert.equal(page.h1(), 'Finding your mooboard', path);
      await page.settle();
      assert.deepEqual(page.fetches.map((f) => f.url), [`${API}/lookup/5KAS`], `${path} ${why}`);
      assert.deepEqual(page.replaced, [START('MB1W')], `${path} ${why}`);
      assert.equal(page.store.size, 0, 'nothing kept');
    }
  }
});

test('the model in ?m= is exactly MB1W, MB1D or MB1P in any case, and anything else there is the wall board', async () => {
  const cases = [
    ['?m=MB1W', 'MB1W'], ['?m=MB1D', 'MB1D'], ['?m=MB1P', 'MB1P'], ['?m=mb1d', 'MB1D'], ['?m=Mb1p', 'MB1P'], ['?m=mB1w', 'MB1W'],
    ['?m=MB1X', 'MB1W'], ['?m=MB1', 'MB1W'], ['?m=MB1DD', 'MB1W'], ['?m=', 'MB1W'], ['?m=%4DB1D', 'MB1W'], ['?m=MB1D%20', 'MB1W'],
    ['?m=<b>MB1D', 'MB1W'], ['?m=MB1D&x=1', 'MB1D'], ['?x=1&m=MB1P', 'MB1P'], ['?m=MB1D&m=MB1P', 'MB1D'],
  ];
  for (const [search, want] of cases) {
    const page = load('/hi/5KAS', () => json({ found: false }), { search });
    await page.settle();
    assert.deepEqual(page.replaced, [START(want)], search);
  }
});

test('a sticker link opens its board as any printed link does when the api finds it on this network', async () => {
  for (const search of ['?m=MB1W', '?m=MB1D', '?m=MB1P', '?m=nope']) {
    const page = load('/hi/5KAS', () => json({ found: true, localIp: '192.168.0.110', name: 'Kitchen' }), { search });
    await page.settle();
    assert.deepEqual(page.replaced, ['http://192.168.0.110/'], search);
    assert.equal(page.h1(), 'Opening Kitchen…', search);
  }
});

test('a sticker link says the api could not be reached when it fails, as any printed link does', async () => {
  for (const answer of [() => json({ error: 'store' }, 503), () => Promise.reject(new TypeError('Failed to fetch'))]) {
    const page = load('/hi/5KAS', answer, { search: '?m=MB1D' });
    await page.settle();
    assertDown(page);
  }
});

test('a link without m= works as it always has, whatever else its query says', async () => {
  for (const search of ['', '?x=1', '?mm=MB1W', '?am=MB1D', '?M=MB1W', '?model=MB1W', '?m']) {
    const page = load('/hi/5KAS', () => json({ found: false }), { search });
    await page.settle();
    assertSameWifi(page);
  }
});

test('?m= changes only a board code link: /hi, the other words and the not-found page stay as they were', async () => {
  const near = load('/hi', nearbyOf([]), { search: '?m=MB1W' });
  await near.settle();
  assert.deepEqual(near.fetches.map((f) => f.url), [`${API}/nearby`]);
  assertSameWifi(near);
  const word = load('/wall', undefined, { search: '?m=MB1W' });
  await word.settle();
  assert.deepEqual(word.replaced, ['/hi/']);
  for (const path of ['/hi/OOPS', '/start', '/hi/5KAS/x']) {
    const page = load(path, undefined, { search: '?m=MB1W' });
    await page.settle();
    assert.equal(page.h1(), 'Page not found', path);
    assert.deepEqual(page.replaced, [], path);
    assert.deepEqual(page.fetches, [], path);
  }
});

test('Try again looks again, from the same-Wi-Fi page and from the api-down page', async () => {
  let lookups = 0;
  const page = load('/5KAS', () => (lookups++ ? json({ found: true, localIp: '192.168.0.110', name: 'Kitchen' }) : json({ found: false })));
  await page.settle();
  assertSameWifi(page);
  page.buttons()[0].click();
  assert.equal(page.h1(), 'Finding your mooboard');
  await page.settle();
  assert.deepEqual(page.fetches.map((f) => f.url), [`${API}/lookup/5KAS`, `${API}/lookup/5KAS`]);
  assert.deepEqual(page.replaced, ['http://192.168.0.110/']);
  let asks = 0;
  const near = load('/hi', () => (asks++ ? json({ boards: [BEDROOM, KITCHEN] }) : json({ error: 'store' }, 503)));
  await near.settle();
  assertDown(near);
  near.buttons()[0].click();
  assert.equal(near.h1(), 'Looking for your mooboard');
  await near.settle();
  assert.equal(near.h1(), 'Pick your mooboard');
  assert.equal(near.cards().length, 2);
});

test('only a private IPv4 address, written plainly, is ever opened', async () => {
  const good = ['10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.254', '192.168.0.0', '192.168.1.1', '192.168.255.255'];
  const bad = ['172.15.255.255', '172.32.0.1', '192.169.0.1', '192.167.255.255', '11.0.0.1', '9.255.255.255', '256.0.0.1', '10.256.0.1',
    '10.0.256.1', '10.0.0.256', '192.168.1.1000', '010.0.0.1', '0172.16.0.1', '10.00.0.1', '192.168.01.1', '10.0.0.01', ' 10.0.0.1',
    '10.0.0.1 ', '10.0.0.1\n', '\n10.0.0.1', '0xa.0.0.1', '0xa000001', '167772161', '10.0.1', '10.1', '10.0.0.1.', '10.0.0.1.5', '10..0.1',
    '10.0.0.1/', '10.0.0.1:80', 'http://10.0.0.1/', '+10.0.0.1', '10.0.0.-1', '', 167772161, null];
  for (const ip of good) {
    const page = load('/5KAS', () => json({ found: true, localIp: ip, name: 'Kitchen' }));
    await page.settle();
    assert.deepEqual(page.replaced, [`http://${ip}/`], ip);
  }
  for (const ip of bad) {
    const page = load('/5KAS', () => json({ found: true, localIp: ip, name: 'Kitchen' }));
    await page.settle();
    assert.deepEqual(page.replaced, [], JSON.stringify(ip));
    assert.equal(page.h1(), SAME_WIFI, JSON.stringify(ip));
  }
});

test('a lookup that hangs gives up after 6 s', async () => {
  const page = load('/5KAS', (url, opts) => new Promise((resolve, reject) => {
    opts.signal.addEventListener('abort', () => reject(new Error('aborted')));
  }));
  await page.settle();
  page.timers.advance(5999);
  await page.settle();
  assert.equal(page.h1(), 'Finding your mooboard');
  page.timers.advance(1);
  await page.settle();
  assertDown(page);
  assert.equal(page.timers.count(), 0, 'no timer left running');
});

test('a lookup that hangs gives up after 6 s even where a fetch cannot be aborted', async () => {
  const page = load('/5KAS', () => new Promise(() => {}), { abort: false });
  await page.settle();
  assert.equal(page.fetches[0].opts.signal, undefined);
  page.timers.advance(5999);
  await page.settle();
  assert.equal(page.h1(), 'Finding your mooboard');
  page.timers.advance(1);
  await page.settle();
  assertDown(page);
});

test('while it looks the cow\'s pupils are the board\'s plus, each a new full hue every 100 ms, with white round them', async () => {
  const page = load('/hi');
  const seen = new Set();
  for (let i = 0; i < 10; i += 1) {
    const eyes = page.eyes();
    for (const eye of eyes) {
      assert.deepEqual(eye.lit, PLUS, 'a plus, the corners white');
      assert.equal(eye.colours.length, 1, 'one hue for the whole pupil');
      assert.match(eye.colours[0], /^hsl\(\d{1,3},100%,50%\)$/);
    }
    seen.add(eyes.map((e) => e.colours[0]).join());
    page.timers.advance(100);
  }
  assert.ok(seen.size > 5, 'new colours as it goes');
});

const BLACK_PLUS = { lit: PLUS, colours: ['#0E1A22'] };
const BLACK_X = { lit: CROSS, colours: ['#0E1A22'] };

test('the pupils settle as a black plus on the pages that wait for a tap, and turn to a black x where something went wrong', async () => {
  const stay = load('/hi', nearbyOf([KITCHEN]));
  await stay.settle();
  stay.buttons().find((b) => b.textContent === 'Stay here').click();
  const missed = load('/hi', sharedNet(() => json({ found: false })));
  await missed.settle();
  missed.cards()[1].click();
  const calm = [load('/hi', nearbyOf([KITCHEN])), stay, load('/hi', nearbyOf([BEDROOM, KITCHEN])), load('/hi', sharedNet(FOUND)),
    load('/hi', nearbyOf([])), load('/5KAS', () => json({ found: false }))];
  const wrong = [load('/hi', () => json({}, 503)), load('/5KAS', () => Promise.reject(new TypeError('offline'))), missed, load('/nope')];
  for (const page of calm) {
    await page.settle();
    assert.deepEqual(page.eyes(), [BLACK_PLUS, BLACK_PLUS], page.h1());
  }
  for (const page of wrong) {
    await page.settle();
    assert.deepEqual(page.eyes(), [BLACK_X, BLACK_X], page.h1());
  }
  // Try again from the api-down page looks with plus pupils again, the x gone
  let asks = 0;
  const near = load('/hi', () => (asks++ ? json({ boards: [BEDROOM, KITCHEN] }) : json({}, 503)));
  await near.settle();
  assert.deepEqual(near.eyes(), [BLACK_X, BLACK_X]);
  near.buttons()[0].click();
  assert.deepEqual(near.eyes().map((e) => e.lit), [PLUS, PLUS]);
  await near.settle();
  assert.deepEqual(near.eyes(), [BLACK_PLUS, BLACK_PLUS]);
  assert.equal(near.timers.count(), 0, 'no rainbow or dots left running');
});

test('One moment ends in dots that run none, one, two, three, 400 ms each and round again, as on the board', async () => {
  const page = load('/hi');
  const line = page.view.children[1];
  assert.equal(line.tagName, 'P');
  assert.equal(line.text, 'One moment', 'the words, the dots after them');
  const dots = page.dots();
  assert.equal(dots.parent, line);
  assert.equal(dots.getAttribute('aria-hidden'), 'true', 'not read aloud');
  assert.deepEqual(dots.children.map((d) => d.textContent), ['.', '.', '.'], 'all three always there, so the words never move');
  const states = [];
  for (let i = 0; i < 9; i += 1) {
    states.push(dots.getAttribute('data-n'));
    page.timers.advance(400);
  }
  assert.deepEqual(states, ['0', '1', '2', '3', '0', '1', '2', '3', '0']);
  assert.match(css, /\.dots\[data-n="0"\] i,\.dots\[data-n="1"\] i\+i,\.dots\[data-n="2"\] i\+i\+i\{visibility:hidden\}/, 'hidden, not gone');
  for (const path of ['/5KAS', '/hi']) {
    const finding = load(path, nearbyOf([KITCHEN]));
    assert.equal(finding.dots().getAttribute('data-n'), '0', path);
  }
  const shared = load('/hi', sharedNet(() => new Promise(() => {})));
  await shared.settle();
  shared.cards()[1].click();
  assert.equal(shared.h1(), 'Finding Kitchen');
  assert.equal(shared.dots().getAttribute('data-n'), '0', 'finding a shared board');
});

test('with less motion asked for, the dots stand still at three', async () => {
  const page = load('/hi', undefined, { reducedMotion: true });
  for (let i = 0; i < 6; i += 1) {
    assert.equal(page.dots().getAttribute('data-n'), '3');
    page.timers.advance(400);
  }
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\.dots i\{visibility:visible!important\}\}/, 'and the css holds them still too');
});

test('the dots stop once the page moves on', async () => {
  const page = load('/hi', nearbyOf([BEDROOM, KITCHEN]));
  const dots = page.dots();
  await page.settle();
  const n = dots.getAttribute('data-n');
  page.timers.advance(2000);
  assert.equal(dots.getAttribute('data-n'), n);
  assert.equal(page.timers.count(), 0, 'no timer left running');
});

test('/hi with several boards: a card each, a tap opens that one, and Identify opens its page in a new tab', async () => {
  const page = load('/hi', nearbyOf([BEDROOM, KITCHEN]));
  await page.settle();
  assert.equal(page.h1(), 'Pick your mooboard');
  assert.equal(page.view.children[1].textContent, 'Tap a board to open it.', 'Identify explains itself');
  const cards = page.cards();
  assert.equal(cards.length, 2);
  assert.deepEqual(cards.map((c) => c.textContent), ['bedroomT8QP', 'Kitchen5KAS']);
  assert.ok(cards.every((c) => c.children[0].className === 'mini' && c.children[0].children[0].className === 'bezel'), 'a mini mooboard on each');
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

test('/hi with one board opens it after 3 s, with no Identify', async () => {
  const page = load('/hi', nearbyOf([KITCHEN]));
  await page.settle();
  assert.equal(page.h1(), 'Opening Kitchen…');
  assert.equal(page.focused(), page.find((e) => e.tagName === 'H1'), 'focus starts on the heading, so it is read out');
  assert.equal(page.cards().length, 1);
  assert.deepEqual(page.idents(), []);
  assert.equal(page.setup(), undefined);
  page.timers.advance(2999);
  assert.deepEqual(page.replaced, []);
  page.timers.advance(1);
  assert.deepEqual(page.replaced, ['http://192.168.0.110/']);
});

test('/hi with one board: "Stay here" cancels, even at the last moment, and the card still opens it', async () => {
  const page = load('/hi', nearbyOf([KITCHEN]));
  await page.settle();
  page.timers.advance(2999);
  page.buttons().find((b) => b.textContent === 'Stay here').click();
  page.timers.advance(10000);
  assert.deepEqual(page.replaced, []);
  assert.equal(page.h1(), 'mooboard', 'just mooboard, no Your');
  assert.deepEqual(page.idents(), []);
  page.key('Tab');
  assert.equal(page.h1(), 'mooboard', 'a later key changes nothing');
  page.cards()[0].click();
  assert.deepEqual(page.replaced, ['http://192.168.0.110/']);
  assert.equal(page.timers.count(), 0);
});

test('/hi with one board: any key pressed before it opens stays here, so keyboard users get to choose', async () => {
  const page = load('/hi', nearbyOf([KITCHEN]));
  await page.settle();
  page.timers.advance(800);
  page.key('Tab');
  page.timers.advance(10000);
  assert.deepEqual(page.replaced, []);
  assert.equal(page.h1(), 'mooboard');
  assert.equal(page.focused(), page.find((e) => e.tagName === 'H1'));
  page.cards()[0].click();
  assert.deepEqual(page.replaced, ['http://192.168.0.110/']);
});

test('each new view moves focus to its heading, and the view is not one big live region', async () => {
  assert.doesNotMatch(hi, /id="view"[^>]*aria-live/);
  assert.match(css, /h1:focus\{outline:none\}/);
  const page = load('/hi', nearbyOf([KITCHEN]));
  assert.equal(page.focused()?.textContent, 'Looking for your mooboard');
  assert.equal(page.focused().getAttribute('tabindex'), '-1');
  await page.settle();
  page.buttons().find((b) => b.textContent === 'Stay here').click();
  assert.equal(page.focused(), page.find((e) => e.tagName === 'H1'));
  assert.equal(page.focused().textContent, 'mooboard');
  const none = load('/hi', nearbyOf([]));
  await none.settle();
  assert.equal(none.focused()?.textContent, SAME_WIFI);
});

test('/hi with one board: tapping the card goes at once, and only once', async () => {
  const page = load('/hi', nearbyOf([KITCHEN]));
  await page.settle();
  page.cards()[0].click();
  page.timers.advance(5000);
  assert.deepEqual(page.replaced, ['http://192.168.0.110/']);
});

test('/hi with no boards shows the same-Wi-Fi page and the new-board steps', async () => {
  for (const answer of [nearbyOf([]), () => json({ boards: 'x' }), nearbyOf([{ code: '5KAS', name: 'Kitchen', localIp: '8.8.8.8' }]),
    nearbyOf([], true)]) {
    const page = load('/hi', answer);
    await page.settle();
    assertSameWifi(page);
  }
});

test('/hi says the api could not be reached when it fails', async () => {
  for (const answer of [() => Promise.reject(new TypeError('offline')), () => json({}, 500), () => json({}, 429)]) {
    const page = load('/hi', answer);
    await page.settle();
    assertDown(page);
  }
});

test('a board\'s address is checked again on the way out, whatever handed it over', async () => {
  const kitchen = { ...KITCHEN };
  const page = load('/hi', nearbyOf([kitchen, BEDROOM]));
  await page.settle();
  kitchen.localIp = '8.8.8.8';
  page.cards()[0].click();
  assert.deepEqual(page.replaced, []);
  assertSameWifi(page);
});

test('/hi on a shared connection: name and code only, each with an Identify button', async () => {
  const page = load('/hi', sharedNet(FOUND));
  await page.settle();
  assert.equal(page.h1(), 'Pick your mooboard');
  assert.equal(page.view.children[1].textContent, 'This internet connection is shared.', 'Identify explains itself');
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
  assert.equal(page.h1(), 'Pick your mooboard');
});

// the shared list again with the board that did not answer named
function assertMissed(page) {
  assert.equal(page.h1(), 'Could not reach Kitchen');
  assert.equal(page.focused(), page.find((e) => e.tagName === 'H1'));
  assert.equal(page.view.children[1].textContent, 'Try again in a moment, or pick another board.');
  assert.deepEqual(page.cards().map((c) => c.textContent), ['Kitchen5KAS', 'KitchenT8QP'], 'the list stays');
  assert.equal(page.idents().length, 2);
  assert.equal(page.setup(), undefined);
  assert.doesNotMatch(page.text(), /same Wi-Fi|VPN/);
  assert.deepEqual(page.replaced, []);
  assert.equal(page.pupils.pl.getAttribute('fill'), '#0E1A22');
}

test('/hi on a shared connection: Identify for a board the lookup cannot find closes the tab and keeps the list', async () => {
  for (const lookup of [() => json({ found: false }), () => Promise.reject(new TypeError('offline')), () => json({ found: true, localIp: '1.2.3.4' })]) {
    const page = load('/hi', sharedNet(lookup));
    await page.settle();
    page.idents()[1].click();
    await page.settle();
    const { tab } = page.opened[0];
    assert.equal(tab.closed, true);
    assert.equal(tab.location.href, 'about:blank', 'never sent anywhere');
    assertMissed(page);
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

test('/hi on a shared connection: a card the lookup cannot find goes back to the list, and the list still works', async () => {
  for (const lookup of [() => json({ found: false }), () => Promise.reject(new TypeError('offline')), () => json({}, 503)]) {
    const page = load('/hi', sharedNet(lookup));
    await page.settle();
    page.cards()[1].click();
    await page.settle();
    assertMissed(page);
  }
  let lookups = 0;
  const page = load('/hi', sharedNet(() => (lookups++ ? FOUND() : json({ found: false }))));
  await page.settle();
  page.cards()[1].click();
  await page.settle();
  assertMissed(page);
  page.cards()[1].click();
  await page.settle();
  assert.deepEqual(page.replaced, ['http://192.168.0.120/']);
});

test('/hi on a shared connection lists only the boards with a well-formed code', async () => {
  const odd = [{ code: '../nearby?x', name: 'a' }, { code: '5ka', name: 'b' }, { code: '5kas', name: 'c' }, { code: 'O0I1', name: 'd' },
    { code: 5, name: 'e' }, { name: 'f' }];
  const page = load('/hi', nearbyOf([...odd, { code: 'T8QP', name: 'Kitchen' }], true));
  await page.settle();
  assert.deepEqual(page.cards().map((c) => c.textContent), ['KitchenT8QP']);
  const none = load('/hi', nearbyOf(odd, true));
  await none.settle();
  assertSameWifi(none);
});

const SAME_NETWORK = 'Your phone and mooboard need to be on the same home\u00a0network.';
const DIDNT_OPEN = `Didn\u2019t open? ${SAME_NETWORK}`;
const DONT_SEE = `Don\u2019t see your board? ${SAME_NETWORK}`;
// the view from top to bottom by class or tag
const layout = (page) => page.view.children.map((c) => c.className || c.tagName.toLowerCase());
const hint = (page) => page.view.children.filter((c) => c.className === 'hint').map((c) => c.textContent);

test('"Didn\u2019t open?" sits under the board on the countdown and stays on the page that opens it', async () => {
  const page = load('/hi', nearbyOf([KITCHEN]));
  await page.settle();
  assert.deepEqual(layout(page), ['h1', 'cards', 'link', 'hint']);
  assert.deepEqual(hint(page), [DIDNT_OPEN]);
  page.timers.advance(3000);
  assert.equal(page.h1(), 'Opening Kitchen…');
  assert.deepEqual(layout(page), ['h1', 'hint']);
  assert.deepEqual(hint(page), [DIDNT_OPEN]);
  assert.deepEqual(page.replaced, ['http://192.168.0.110/']);
});

test('the home network line is on every page a board opens from: "Didn\u2019t open?" while opening, "Don\u2019t see your board?" on the lists', async () => {
  const stay = load('/hi', nearbyOf([KITCHEN]));
  await stay.settle();
  stay.buttons().find((b) => b.textContent === 'Stay here').click();
  const shared = load('/hi', sharedNet(FOUND));
  await shared.settle();
  shared.cards()[1].click();
  const pages = [
    ['a printed link', load('/5KAS', () => json({ found: true, localIp: '192.168.0.110', name: 'Kitchen' })), ['h1', 'hint'], DIDNT_OPEN],
    ['a shared board once found', shared, ['h1', 'hint'], DIDNT_OPEN],
    ['after Stay here', stay, ['h1', 'p', 'cards', 'hint', 'foot'], DONT_SEE],
    ['several boards', load('/hi', nearbyOf([BEDROOM, KITCHEN])), ['h1', 'p', 'cards', 'hint', 'foot'], DONT_SEE],
    ['a shared connection', load('/hi', sharedNet(FOUND)), ['h1', 'p', 'cards', 'hint', 'foot'], DONT_SEE],
  ];
  for (const [why, page, rows, line] of pages) {
    await page.settle();
    assert.deepEqual(layout(page), rows, why);
    assert.deepEqual(hint(page), [line], why);
    const p = page.view.children.find((c) => c.className === 'hint');
    assert.equal(p.children[0].tagName, 'B', `${why}: the question in bold`);
    assert.equal(p.children[0].textContent, line.slice(0, line.indexOf('?') + 1), why);
    assert.equal(p.children[1].textContent, ` ${SAME_NETWORK}`, `${why}: the network sentence after it`);
  }
  assert.match(css, /\.hint b\{display:block;/, 'the question has a line of its own');
  assert.deepEqual(shared.replaced, ['http://192.168.0.120/']);
});

test('the home network line ends at the home network, with no guest network anywhere on the page', () => {
  assert.doesNotMatch(script, /guest/i);
  assert.doesNotMatch(hi, /guest/i);
});

test('the home network line stays off the loading, same-Wi-Fi, api-down and not-found pages', async () => {
  const pages = [load('/hi'), load('/5KAS'), load('/hi', nearbyOf([])), load('/5KAS', () => json({ found: false })), load('/nope'),
    load('/hi', () => json({}, 503))];
  const shared = load('/hi', sharedNet(() => new Promise(() => {})));
  await shared.settle();
  shared.cards()[1].click();
  pages.push(shared);
  for (const page of pages) {
    await page.settle();
    assert.doesNotMatch(page.text(), /same home network/, page.h1());
  }
  assert.equal(shared.h1(), 'Finding Kitchen');
});

test('/js/board.js loads once, only when a board is shown, never on the loading, same-Wi-Fi or not-found pages', async () => {
  for (const page of [load('/hi'), load('/5KAS'), load('/nope'), load('/hi', nearbyOf([])), load('/5KAS', () => json({ found: false }))]) {
    await page.settle();
    assert.deepEqual(page.scripts(), [], page.h1());
  }
  const page = load('/hi', nearbyOf([{ ...KITCHEN, frameColor: 'midnight' }]));
  await page.settle();
  assert.deepEqual(page.scripts(), ['/js/board.js']);
  page.buttons().find((b) => b.textContent === 'Stay here').click();
  assert.deepEqual(page.scripts(), ['/js/board.js'], 'asked for once');
  page.boardJs();
  page.cards()[0].click();
  assert.deepEqual(page.scripts(), ['/js/board.js'], 'and never again');
});

test('the countdown and Stay here keep the logo on top, and the page that opens a board shows it on top in its own frame', async () => {
  const page = load('/hi', nearbyOf([{ ...KITCHEN, frameColor: 'moonlight' }]));
  await page.settle();
  assert.equal(page.top.className, 'top', 'the countdown: the logo');
  assert.deepEqual(page.hero.children, []);
  assert.deepEqual(page.frames(page.cards()[0]), ['white'], 'the board in its card');
  assert.deepEqual(page.made, [], 'drawn once board.js is in');
  page.boardJs();
  assert.equal(page.made.length, 1, 'the card');
  for (const { el, opts } of page.made) {
    assert.equal(el.className, 'led');
    assert.deepEqual([...opts.scenes], ['mark']);
    assert.equal(opts.auto, false);
  }
  page.timers.advance(3000);
  assert.equal(page.h1(), 'Opening Kitchen…');
  assert.equal(page.top.className, 'top lit', 'the connecting page');
  assert.deepEqual(page.frames(page.hero), ['white']);
  assert.equal(page.hero.children[0].getAttribute('role'), 'img');
  assert.equal(page.hero.children[0].getAttribute('aria-label'), 'Kitchen, a Moonlight mooboard');
  assert.equal(page.made.length, 2, 'drawn at once now board.js is in');
  const stay = load('/hi', nearbyOf([{ ...KITCHEN, frameColor: 'sunset' }]));
  await stay.settle();
  stay.buttons().find((b) => b.textContent === 'Stay here').click();
  assert.equal(stay.h1(), 'mooboard');
  assert.equal(stay.top.className, 'top', 'after Stay here: the logo');
  assert.deepEqual(stay.hero.children, []);
  assert.deepEqual(stay.frames(stay.cards()[0]), ['orange']);
  const printed = load('/5KAS', () => json({ found: true, localIp: '192.168.0.110', name: 'Kitchen', frameColor: 'mint' }));
  await printed.settle();
  assert.equal(printed.top.className, 'top lit', 'a printed link');
  assert.deepEqual(printed.frames(printed.hero), ['teal']);
});

test('the board in a card has the frame colour of the board itself, the one the connecting page draws on top', async () => {
  const frames = { midnight: 'black', moonlight: 'white', sunset: 'orange', mint: 'teal', red: 'red' };
  for (const [frameColor, frame] of Object.entries(frames)) {
    const page = load('/hi', nearbyOf([{ ...KITCHEN, frameColor }]));
    await page.settle();
    assert.deepEqual(page.frames(page.view), [frame], `${frameColor}: the countdown`);
    page.buttons().find((b) => b.textContent === 'Stay here').click();
    assert.deepEqual(page.frames(page.view), [frame], `${frameColor}: after Stay here`);
    page.cards()[0].click();
    assert.deepEqual(page.frames(page.hero), [frame], `${frameColor}: on top while it opens`);
  }
});

test('every card shows its board as a mini mooboard in its own frame, and the lists keep the cow on top', async () => {
  const page = load('/hi', nearbyOf([{ ...BEDROOM, frameColor: 'mint' }, { ...KITCHEN, frameColor: 'midnight' }]));
  await page.settle();
  assert.deepEqual(page.cards().map((c) => page.frames(c)), [['teal'], ['black']]);
  assert.ok(page.cards().every((c) => c.children[0].getAttribute('aria-hidden') === 'true'), 'the card text names the board');
  assert.equal(page.top.className, 'top', 'no one board: the cow');
  assert.deepEqual(page.hero.children, []);
  const shared = load('/hi', (url) => (url === `${API}/nearby`
    ? json({ boards: [{ ...SHARED[0], frameColor: 'sunset' }, { ...SHARED[1], frameColor: 'moonlight' }], shared: true })
    : new Promise(() => {})));
  await shared.settle();
  assert.deepEqual(shared.cards().map((c) => shared.frames(c)), [['orange'], ['white']]);
  assert.equal(shared.top.className, 'top');
});

test('a missing or unknown frameColor draws the board in midnight', async () => {
  for (const frameColor of [undefined, '', 'Midnight', 'black', 'teal', 'mint ', 7, null, {}, 'constructor', '__proto__', 'toString']) {
    const page = load('/hi', nearbyOf([{ ...KITCHEN, frameColor }]));
    await page.settle();
    const why = JSON.stringify(frameColor) ?? 'undefined';
    assert.deepEqual(page.frames(page.cards()[0]), ['black'], why);
    page.timers.advance(3000);
    assert.deepEqual(page.frames(page.hero), ['black'], why);
    assert.equal(page.hero.children[0].getAttribute('aria-label'), 'Kitchen, a Midnight mooboard', why);
  }
});

test('red draws the red edition frame, its shade one constant the owner can swap', async () => {
  const page = load('/hi', nearbyOf([{ ...KITCHEN, frameColor: 'red' }]));
  await page.settle();
  assert.deepEqual(page.frames(page.cards()[0]), ['red']);
  page.timers.advance(3000);
  assert.deepEqual(page.frames(page.hero), ['red']);
  assert.equal(page.hero.children[0].getAttribute('aria-label'), 'Kitchen, a Red mooboard');
  assert.equal(css.match(/--red:#[0-9A-Fa-f]{6}/g).length, 1, 'one shade, set once');
  assert.match(css, /\.bezel\[data-frame="red"\]\{--frame:var\(--red\)/);
});

test('the connecting page takes the colour from /lookup, else from the list', async () => {
  const cases = [[{ frameColor: 'mint' }, 'sunset', 'teal'], [{}, 'sunset', 'orange'], [{ frameColor: 'black' }, 'sunset', 'orange'], [{}, undefined, 'black']];
  for (const [extra, listed, want] of cases) {
    const page = load('/hi', (url) => (url === `${API}/nearby`
      ? json({ boards: SHARED.map((b) => ({ ...b, frameColor: listed })), shared: true })
      : json({ found: true, localIp: '192.168.0.120', name: 'Kitchen', ...extra })));
    await page.settle();
    page.cards()[1].click();
    await page.settle();
    assert.equal(page.h1(), 'Opening Kitchen…');
    assert.deepEqual(page.frames(page.hero), [want], JSON.stringify([extra, listed]));
  }
});

test('when /js/board.js cannot load the frames stay with dark panels and the page works on', async () => {
  const page = load('/hi', nearbyOf([{ ...KITCHEN, frameColor: 'sunset' }]));
  await page.settle();
  page.boardJsFails();
  assert.deepEqual(page.made, []);
  assert.deepEqual(page.frames(page.cards()[0]), ['orange']);
  page.buttons().find((b) => b.textContent === 'Stay here').click();
  assert.deepEqual(page.scripts(), ['/js/board.js'], 'no second try');
  page.cards()[0].click();
  assert.deepEqual(page.replaced, ['http://192.168.0.110/']);
});

test('an older cached board.js without the mark scene runs its moo scene', async () => {
  const page = load('/hi', nearbyOf([KITCHEN]));
  await page.settle();
  page.boardJs({ mark: false });
  assert.equal(page.made.length, 1);
  assert.ok(page.made.every(({ opts }) => opts.scenes.length === 1 && opts.scenes[0] === 'moo'));
});

test('a panel the page has moved on from is not drawn', async () => {
  const page = load('/hi', nearbyOf([{ ...KITCHEN, frameColor: 'mint' }]));
  await page.settle();
  const countdown = page.view.all().concat(page.hero.all()).filter((e) => e.className === 'led');
  assert.equal(countdown.length, 1);
  page.buttons().find((b) => b.textContent === 'Stay here').click();
  page.boardJs();
  assert.equal(page.made.length, 1, 'the panel on the page now');
  assert.ok(page.made.every(({ el }) => !countdown.includes(el) && el.isConnected));
});

test('the cow stays on top while it looks, on the countdown and after Stay here, and on the same-Wi-Fi, api-down and not-found pages', async () => {
  const stay = load('/hi', nearbyOf([KITCHEN]));
  await stay.settle();
  stay.buttons().find((b) => b.textContent === 'Stay here').click();
  for (const page of [load('/hi'), load('/5KAS'), load('/hi', nearbyOf([KITCHEN])), stay, load('/hi', nearbyOf([])), load('/nope'),
    load('/hi', () => json({}, 503))]) {
    await page.settle();
    assert.equal(page.top.className, 'top', page.h1());
    assert.deepEqual(page.hero.children, [], page.h1());
  }
});

test('Setup guide is a quiet button that does not compete with the main action', async () => {
  const stay = load('/hi', nearbyOf([KITCHEN]));
  await stay.settle();
  stay.buttons().find((b) => b.textContent === 'Stay here').click();
  for (const page of [stay, load('/hi', nearbyOf([BEDROOM, KITCHEN])), load('/hi', sharedNet(FOUND)), load('/hi', nearbyOf([]))]) {
    await page.settle();
    const guide = page.find((e) => e.tagName === 'A' && e.textContent === 'Setup guide');
    assert.equal(guide.className, 'sub', page.h1());
    assert.equal(guide.getAttribute('href'), 'https://mooboard.co/guide');
  }
  const sub = css.match(/\.sub\{[^}]*\}/)[0];
  assert.match(sub, /border:1px solid #23404A/, 'the quiet fill the cards use');
  assert.doesNotMatch(sub, /#77EDD7/, 'not the mint of the main button');
});

test('no heading on the page starts with Your', async () => {
  const stay = load('/hi', nearbyOf([KITCHEN]));
  await stay.settle();
  stay.buttons().find((b) => b.textContent === 'Stay here').click();
  const pages = [stay, load('/hi'), load('/5KAS'), load('/hi', nearbyOf([KITCHEN])), load('/hi', nearbyOf([BEDROOM, KITCHEN])),
    load('/hi', sharedNet(FOUND)), load('/hi', nearbyOf([])), load('/nope'), load('/5KAS', () => json({ found: true, localIp: '192.168.0.110' }))];
  for (const page of pages) {
    await page.settle();
    assert.doesNotMatch(page.h1(), /^Your\b/, page.h1());
  }
});

test('names are text, never markup, on cards and in Identify labels', async () => {
  const name = '<img src=x onerror=alert(1)>';
  const page = load('/hi', nearbyOf([{ ...KITCHEN, name }, BEDROOM]));
  await page.settle();
  const card = page.cards().find((c) => c.textContent.startsWith('<img'));
  assert.ok(card, 'listed by its literal name');
  assert.ok(page.view.all().every((e) => e.html === null || !e.html.includes('onerror')), 'never through innerHTML');
  assert.ok(page.view.all().concat(page.hero.all()).every((e) => e.html === null), 'no innerHTML anywhere');
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
    load('/hi', () => json({}, 503)),
  ];
  for (const page of states) {
    await page.settle();
    assert.doesNotMatch(page.text(), /—|;/, page.h1());
  }
  const missed = load('/hi', sharedNet(() => json({ found: false })));
  await missed.settle();
  missed.cards()[1].click();
  await missed.settle();
  assert.doesNotMatch(missed.text(), /—|;/, missed.h1());
  const markup = hi.replace(/<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>|<!--[\s\S]*?-->/g, '');
  assert.doesNotMatch(markup, /—|;/);
});
