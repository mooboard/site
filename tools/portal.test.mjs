// tests for mooboard.co/portal + js/finder.js runs in the stand in browser of tools/finder-harness.mjs
// + run node --test tools/hi.test.mjs tools/portal.test.mjs
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { API, BEDROOM, CROSS, FOUND, IPAD, IPHONE, KITCHEN, PLUS, SHARED, json, load, nearbyOf, read, script, sharedNet } from './finder-harness.mjs';

const portal = read('portal/index.html');
const hi = read('hi/index.html');
const manifest = JSON.parse(read('portal/manifest.webmanifest'));
const sw = read('portal/sw.js');
const MINE = 'mooboard.portal';
const SAME_NETWORK = 'Your phone and mooboard need to be on the same home\u00a0network.';
const DIDNT_OPEN = `Didn\u2019t open? ${SAME_NETWORK}`;
const SAME_WIFI = 'Open this on the same Wi-Fi as your mooboard';
const remembered = (b) => ({ [MINE]: JSON.stringify(b) });
const mine = (page) => JSON.parse(page.store.get(MINE) ?? 'null');
const openPortal = (answer, opts = {}) => load('/portal/', answer, { page: 'portal', ...opts });
// the network of a phone at home with a remembered board + lookup answers for it
const homeWith = (lookup, boards = [KITCHEN]) => (url) => {
  if (url === `${API}/lookup/5KAS`) return lookup();
  if (url === `${API}/nearby`) return json({ boards, shared: false });
  throw new Error(`unexpected ${url}`);
};
// a third board for the lists
const PANTRY = { code: 'M7RX', name: 'Pantry', localIp: '192.168.0.112', version: '1.4.0', lastSeen: 1 };
const DONT_SEE = `Don\u2019t see your board? ${SAME_NETWORK}`;
const DOWN = 'Could not reach mooboard.co';
// the view from top to bottom by class or tag + the home network lines in it
const layout = (page) => page.view.children.map((c) => c.className || c.tagName.toLowerCase());
const hints = (page) => page.view.children.filter((c) => c.className === 'hint').map((c) => c.textContent);
const names = (page) => page.cards().map((c) => c.textContent);
const installBox = (page) => page.install.children;
const promptEvent = () => {
  const e = { prevented: 0, prompted: 0 };
  e.preventDefault = () => { e.prevented += 1; };
  e.prompt = () => { e.prompted += 1; };
  return e;
};
const pngSize = (rel) => {
  const b = readFileSync(new URL(`../${rel}`, import.meta.url));
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};

test('the portal page links its manifest and icons and the shared css and js, and shows the matrix cow as /hi does', () => {
  assert.match(portal, /<link rel="manifest" href="\/portal\/manifest\.webmanifest">/);
  assert.match(portal, /<link rel="apple-touch-icon" href="\/portal\/apple-touch-icon\.png">/);
  assert.match(portal, /<meta name="theme-color" content="#0E1A22">/);
  assert.match(portal, /<meta name="apple-mobile-web-app-capable" content="yes">/);
  assert.deepEqual(portal.match(/<script[^>]*src="[^"]*"/g), ['<script src="/js/finder.js"']);
  assert.deepEqual(portal.match(/<link[^>]+stylesheet[^>]*>/g), ['<link rel="stylesheet" href="/css/finder.css">']);
  const symbol = (src) => src.match(/<symbol id="cow"[\s\S]*?<\/symbol>/)[0];
  assert.equal(symbol(portal), symbol(hi), 'the same brand mark as /hi');
  assert.match(portal, /<svg class="cow" viewBox="0 0 136 108" role="img" aria-label="mooboard"><use href="#cow"\/><\/svg>/);
  assert.doesNotMatch(portal, /class="cow pixel"/, 'no cow drawn all in dots');
  assert.match(portal, /<div id="install" class="install"><\/div>/);
  assert.match(portal, /<meta name="referrer" content="no-referrer">/);
});

test('the portal says when it needs JavaScript, and its view is not one big live region', () => {
  const noscript = portal.match(/<noscript>([\s\S]*?)<\/noscript>/)[1];
  assert.match(noscript, /<h1>This page needs JavaScript<\/h1>/);
  assert.match(noscript, /<a href="http:\/\/mooboard\.local">mooboard\.local<\/a>/);
  assert.match(noscript, /<a href="\/">mooboard\.co<\/a>/);
  assert.doesNotMatch(portal, /id="view"[^>]*aria-live/);
});

test('the manifest makes it installable: the portal as its start and scope, standalone, the site colours, and icons that exist at their sizes', () => {
  assert.equal(manifest.name, 'mooboard');
  assert.equal(manifest.short_name, 'mooboard');
  assert.equal(manifest.start_url, '/portal/');
  assert.equal(manifest.scope, '/portal/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.theme_color, '#0E1A22');
  assert.equal(manifest.background_color, '#0E1A22');
  for (const icon of manifest.icons) {
    const rel = icon.src.slice(1);
    assert.ok(existsSync(new URL(`../${rel}`, import.meta.url)), rel);
    assert.deepEqual(pngSize(rel), icon.sizes.split('x').map(Number), rel);
    assert.equal(icon.type, 'image/png');
  }
  assert.ok(manifest.icons.some((i) => i.sizes === '192x192' && i.purpose === 'any'));
  assert.ok(manifest.icons.some((i) => i.sizes === '512x512' && i.purpose === 'any'));
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'));
  assert.deepEqual(pngSize('portal/apple-touch-icon.png'), [180, 180]);
});

test('the service worker keeps the portal shell and leaves the api and the boards alone', () => {
  for (const path of ['/portal/', '/css/finder.css', '/js/finder.js']) assert.ok(sw.includes(`'${path}'`), path);
  assert.match(sw, /url\.origin !== self\.location\.origin\) return;/, 'other origins pass straight through');
  assert.match(sw, /req\.method !== 'GET'/);
});

test('the logo is the matrix cow, its plus pupils flickering while it looks and settling black after', async () => {
  assert.doesNotMatch(script, /var MARK = |pixelCow/, 'no cow drawn all in dots by the script');
  const page = openPortal(nearbyOf([]));
  assert.equal(page.h1(), 'Looking for your mooboard');
  assert.match(page.pupils.pl.getAttribute('fill'), /^hsl\(\d{1,3},100%,50%\)$/, 'looking');
  assert.deepEqual(page.eyes().map((e) => e.lit), [PLUS, PLUS]);
  await page.settle();
  assert.equal(page.pupils.pl.getAttribute('fill'), '#0E1A22', 'settled');
  assert.deepEqual(page.eyes(), [{ lit: PLUS, colours: ['#0E1A22'] }, { lit: PLUS, colours: ['#0E1A22'] }]);
  assert.equal(page.top.className, 'top', 'the cow on top');
});

test('One moment on the portal has the running dots too, still where less motion is asked for', () => {
  const page = openPortal(nearbyOf([]));
  assert.equal(page.view.children[1].text, 'One moment');
  const states = [];
  for (let i = 0; i < 5; i += 1) {
    states.push(page.dots().getAttribute('data-n'));
    page.timers.advance(400);
  }
  assert.deepEqual(states, ['0', '1', '2', '3', '0']);
  const still = openPortal(nearbyOf([]), { reducedMotion: true });
  still.timers.advance(1200);
  assert.equal(still.dots().getAttribute('data-n'), '3');
});

test('nothing on the portal mentions a guest network', () => {
  assert.doesNotMatch(portal, /guest/i);
  assert.doesNotMatch(script, /guest/i);
});

test('one board on the network opens after a short Opening with Pick another, kept or not, and is kept once it opens, never its address', async () => {
  for (const storage of [{}, remembered({ code: 'T8QP', name: 'bedroom' })]) {
    const why = storage[MINE] ? 'another board kept' : 'a first visit';
    const page = openPortal(nearbyOf([{ ...KITCHEN, frameColor: 'moonlight' }]), { storage });
    assert.equal(page.h1(), 'Looking for your mooboard', `${why}: it asks which boards are on this network first`);
    await page.settle();
    assert.equal(page.h1(), 'Opening Kitchen…', why);
    assert.deepEqual(layout(page), ['h1', 'link', 'hint'], `${why}: the opening view as it was`);
    assert.deepEqual(page.buttons().map((b) => b.textContent), ['Pick another'], why);
    assert.deepEqual(hints(page), [DIDNT_OPEN], why);
    assert.equal(page.top.className, 'top lit', `${why}: the board on top`);
    assert.deepEqual(page.frames(page.hero), ['white'], why);
    assert.deepEqual(page.fetches.map((f) => f.url), [`${API}/nearby`], `${why}: no lookup needed`);
    assert.equal(page.store.get(MINE), storage[MINE], `${why}: nothing new kept until it opens`);
    page.timers.advance(1499);
    assert.deepEqual(page.replaced, [], why);
    page.timers.advance(1);
    assert.deepEqual(page.replaced, ['http://192.168.0.110/'], why);
    assert.deepEqual(mine(page), { code: '5KAS', name: 'Kitchen', frameColor: 'moonlight' }, why);
    assert.doesNotMatch(page.store.get(MINE), /192\.168/, why);
  }
});

test('several boards: the pick list, and the board tapped is the one remembered', async () => {
  const page = openPortal(nearbyOf([{ ...BEDROOM, frameColor: 'mint' }, KITCHEN]));
  await page.settle();
  assert.equal(page.h1(), 'Pick your mooboard');
  page.cards()[1].click();
  assert.deepEqual(page.replaced, ['http://192.168.0.110/']);
  assert.deepEqual(mine(page), { code: '5KAS', name: 'Kitchen', frameColor: '' });
});

test('two or more boards: the list with names, codes and Identify, the board opened last on top', async () => {
  const page = openPortal(nearbyOf([BEDROOM, { ...PANTRY, frameColor: 'sunset' }, { ...KITCHEN, frameColor: 'mint' }]), {
    storage: remembered({ code: '5KAS', name: 'Kitchen', frameColor: 'mint' }),
  });
  await page.settle();
  assert.equal(page.h1(), 'Pick your mooboard');
  assert.equal(page.view.children[1].textContent, 'Tap a board to open it.');
  assert.deepEqual(names(page), ['Kitchen5KAS', 'bedroomT8QP', 'PantryM7RX'], 'the rest in the order the api gave');
  assert.deepEqual(page.cards().map((c) => page.frames(c)), [['teal'], ['black'], ['orange']]);
  const rows = page.view.all().filter((e) => e.className === 'row');
  assert.deepEqual(rows.map((r) => r.children.map((c) => c.className)), [['card', 'ident'], ['card', 'ident'], ['card', 'ident']]);
  assert.deepEqual(page.idents().map((a) => [a.tagName, a.textContent, a.getAttribute('href'), a.getAttribute('aria-label')]), [
    ['A', 'Identify', 'http://192.168.0.110/identify', 'Identify Kitchen'],
    ['A', 'Identify', 'http://192.168.0.111/identify', 'Identify bedroom'],
    ['A', 'Identify', 'http://192.168.0.112/identify', 'Identify Pantry'],
  ]);
  assert.deepEqual(hints(page), [DONT_SEE]);
  assert.equal(page.top.className, 'top', 'the cow on top');
  assert.deepEqual(page.fetches.map((f) => f.url), [`${API}/nearby`]);
  page.timers.advance(10000);
  assert.deepEqual(page.replaced, [], 'nothing opens by itself');
  page.cards()[2].click();
  assert.deepEqual(page.replaced, ['http://192.168.0.112/']);
  assert.deepEqual(mine(page), { code: 'M7RX', name: 'Pantry', frameColor: 'sunset' });
  const next = openPortal(nearbyOf([BEDROOM, KITCHEN, PANTRY]), { storage: Object.fromEntries(page.store) });
  await next.settle();
  assert.deepEqual(names(next), ['PantryM7RX', 'bedroomT8QP', 'Kitchen5KAS'], 'the next visit puts it on top');
  const gone = openPortal(nearbyOf([BEDROOM, PANTRY]), { storage: remembered({ code: '5KAS', name: 'Kitchen' }) });
  await gone.settle();
  assert.deepEqual(names(gone), ['bedroomT8QP', 'PantryM7RX'], 'a list without it keeps the api order');
});

test('a shared connection: the shared list with the board opened last on top, an Identify button on each, and nothing opens by itself', async () => {
  const page = openPortal((url) => {
    if (url === `${API}/nearby`) return json({ boards: SHARED, shared: true });
    if (url === `${API}/lookup/5KAS`) return json({ found: false });
    if (url === `${API}/lookup/T8QP`) return FOUND();
    throw new Error(`unexpected ${url}`);
  }, { storage: remembered({ code: 'T8QP', name: 'Kitchen' }) });
  await page.settle();
  assert.equal(page.h1(), 'Pick your mooboard');
  assert.equal(page.view.children[1].textContent, 'This internet connection is shared.');
  assert.deepEqual(names(page), ['KitchenT8QP', 'Kitchen5KAS'], 'the api gave 5KAS first');
  assert.deepEqual(page.idents().map((b) => [b.tagName, b.textContent]), [['BUTTON', 'Identify'], ['BUTTON', 'Identify']]);
  page.timers.advance(10000);
  assert.deepEqual(page.replaced, [], 'nothing opens by itself');
  assert.deepEqual(page.fetches.map((f) => f.url), [`${API}/nearby`], 'no lookup until a tap');
  page.cards()[1].click();
  await page.settle();
  assert.equal(page.h1(), 'Could not reach Kitchen');
  assert.deepEqual(names(page), ['KitchenT8QP', 'Kitchen5KAS'], 'the list stays in its order');
  page.cards()[0].click();
  await page.settle();
  assert.deepEqual(page.replaced, ['http://192.168.0.120/']);
  assert.equal(mine(page).code, 'T8QP');
  // one board on a shared connection is listed too + it may be a neighbor board
  const one = openPortal(nearbyOf([{ code: '5KAS', name: 'Kitchen' }], true), { storage: remembered({ code: '5KAS', name: 'Kitchen' }) });
  await one.settle();
  assert.equal(one.h1(), 'Pick your mooboard');
  assert.deepEqual(names(one), ['Kitchen5KAS']);
  one.timers.advance(10000);
  assert.deepEqual(one.replaced, []);
  assert.deepEqual(one.fetches.map((f) => f.url), [`${API}/nearby`]);
});

test('no board on this network: the board opened last is looked up by its code and opens after a short Opening with Pick another', async () => {
  for (const shared of [false, true]) {
    const why = shared ? 'a shared connection' : 'a vpn';
    const page = openPortal((url) => {
      if (url === `${API}/nearby`) return json({ boards: [], shared });
      if (url === `${API}/lookup/5KAS`) return json({ found: true, localIp: '192.168.0.130', name: 'Kitchen', frameColor: 'moonlight' });
      throw new Error(`unexpected ${url}`);
    }, { storage: remembered({ code: '5KAS', name: 'Kitchen', frameColor: 'moonlight' }) });
    await page.settle();
    assert.deepEqual(page.fetches.map((f) => f.url), [`${API}/nearby`, `${API}/lookup/5KAS`], why);
    assert.equal(page.h1(), 'Opening Kitchen…', why);
    assert.deepEqual(layout(page), ['h1', 'link', 'hint'], why);
    assert.deepEqual(page.buttons().map((b) => b.textContent), ['Pick another'], why);
    assert.equal(page.top.className, 'top lit', why);
    assert.deepEqual(page.frames(page.hero), ['white'], why);
    page.timers.advance(1499);
    assert.deepEqual(page.replaced, [], why);
    page.timers.advance(1);
    assert.deepEqual(page.replaced, ['http://192.168.0.130/'], why);
    assert.deepEqual(mine(page), { code: '5KAS', name: 'Kitchen', frameColor: 'moonlight' }, why);
  }
  const first = openPortal(nearbyOf([]));
  await first.settle();
  assert.equal(first.h1(), SAME_WIFI, 'nothing kept: the same-Wi-Fi page');
  assert.deepEqual(first.fetches.map((f) => f.url), [`${API}/nearby`], 'and nothing to look up');
});

test('a board looked up by its code that answers late still opens as soon as it answers', async () => {
  let answer;
  const page = openPortal(homeWith(() => new Promise((r) => { answer = r; }), []), { storage: remembered({ code: '5KAS', name: 'Kitchen' }) });
  await page.settle();
  assert.equal(page.h1(), 'Opening Kitchen…');
  page.timers.advance(5000);
  assert.deepEqual(page.replaced, []);
  answer(json({ found: true, localIp: '192.168.0.110', name: 'Kitchen' }));
  await page.settle();
  assert.deepEqual(page.replaced, ['http://192.168.0.110/']);
});

test('a board the lookup cannot find shows the same-Wi-Fi page and stays kept, and a failed lookup says mooboard.co could not be reached', async () => {
  for (const lookup of [() => json({ found: false }), () => json({ found: true, localIp: '8.8.8.8' })]) {
    const page = openPortal(homeWith(lookup, []), { storage: remembered({ code: '5KAS', name: 'Kitchen' }) });
    await page.settle();
    assert.deepEqual(page.fetches.map((f) => f.url), [`${API}/nearby`, `${API}/lookup/5KAS`]);
    assert.equal(page.h1(), SAME_WIFI);
    page.timers.advance(10000);
    assert.deepEqual(page.replaced, []);
    assert.equal(mine(page).code, '5KAS');
  }
  let lookups = 0;
  const lookup = () => (lookups++ ? json({ found: true, localIp: '192.168.0.110', name: 'Kitchen' }) : Promise.reject(new TypeError('offline')));
  const page = openPortal(homeWith(lookup, []), { storage: remembered({ code: '5KAS', name: 'Kitchen' }) });
  await page.settle();
  assert.equal(page.h1(), DOWN);
  assert.deepEqual(page.buttons().map((b) => b.textContent), ['Try again']);
  assert.deepEqual(page.eyes(), [{ lit: CROSS, colours: ['#0E1A22'] }, { lit: CROSS, colours: ['#0E1A22'] }], 'x pupils');
  page.timers.advance(10000);
  assert.deepEqual(page.replaced, [], 'nothing opens once it has failed');
  page.buttons()[0].click();
  await page.settle();
  assert.deepEqual(page.fetches.map((f) => f.url), [`${API}/nearby`, `${API}/lookup/5KAS`, `${API}/nearby`, `${API}/lookup/5KAS`], 'Try again asks for both again');
  page.timers.advance(1500);
  assert.deepEqual(page.replaced, ['http://192.168.0.110/']);
});

test('Pick another stops the open and lists the boards, and never opens one by itself', async () => {
  const one = openPortal(nearbyOf([KITCHEN]));
  await one.settle();
  one.timers.advance(500);
  one.buttons().find((b) => b.textContent === 'Pick another').click();
  assert.equal(one.h1(), 'Looking for your mooboard', 'it asks again');
  await one.settle();
  assert.equal(one.h1(), 'mooboard', 'one board to tap');
  one.timers.advance(10000);
  assert.deepEqual(one.replaced, [], 'nothing opens by itself');
  one.cards()[0].click();
  assert.deepEqual(one.replaced, ['http://192.168.0.110/']);
  // a lookup that answers after the list is up opens nothing + the list keeps the board opened last on top
  for (const late of [json({ found: true, localIp: '192.168.0.110', name: 'Kitchen' }), json({ found: false })]) {
    let reply;
    let asks = 0;
    const slow = openPortal((url) => {
      if (url === `${API}/lookup/5KAS`) return new Promise((r) => { reply = r; });
      if (url === `${API}/nearby`) return json({ boards: asks++ ? [BEDROOM, KITCHEN] : [], shared: false });
      throw new Error(`unexpected ${url}`);
    }, { storage: remembered({ code: '5KAS', name: 'Kitchen' }) });
    await slow.settle();
    assert.equal(slow.h1(), 'Opening Kitchen…');
    slow.timers.advance(2000);
    slow.buttons().find((b) => b.textContent === 'Pick another').click();
    await slow.settle();
    reply(late);
    await slow.settle();
    slow.timers.advance(10000);
    assert.deepEqual(slow.replaced, [], 'nothing opens by itself');
    assert.equal(slow.h1(), 'Pick your mooboard');
    assert.deepEqual(names(slow), ['Kitchen5KAS', 'bedroomT8QP']);
  }
  // nothing on the network when picking shows the same wifi page + no second lookup
  const none = openPortal(homeWith(() => new Promise(() => {}), []), { storage: remembered({ code: '5KAS', name: 'Kitchen' }) });
  await none.settle();
  none.buttons().find((b) => b.textContent === 'Pick another').click();
  await none.settle();
  assert.equal(none.h1(), SAME_WIFI);
  assert.equal(none.fetches.filter((f) => f.url === `${API}/lookup/5KAS`).length, 1);
});

test('a key pressed before a board opens lists the boards instead, so keyboard users get to choose', async () => {
  const page = openPortal(nearbyOf([KITCHEN]));
  await page.settle();
  assert.equal(page.focused()?.textContent, 'Opening Kitchen…', 'focus on the heading, so it is read out');
  page.timers.advance(600);
  page.key('Tab');
  await page.settle();
  page.timers.advance(10000);
  assert.deepEqual(page.replaced, [], 'nothing opens by itself');
  assert.equal(page.h1(), 'mooboard', 'one board to tap');
  assert.equal(page.focused(), page.find((e) => e.tagName === 'H1'));
  page.key('Enter');
  assert.equal(page.h1(), 'mooboard', 'a later key changes nothing');
  page.cards()[0].click();
  assert.deepEqual(page.replaced, ['http://192.168.0.110/']);
});

test('when the api cannot be reached the portal says so, and Try again asks again', async () => {
  let asks = 0;
  const page = openPortal((url) => {
    if (url === `${API}/lookup/5KAS`) return Promise.reject(new TypeError('offline'));
    return asks++ ? json({ boards: [BEDROOM, KITCHEN] }) : Promise.reject(new TypeError('offline'));
  }, { storage: remembered({ code: '5KAS', name: 'Kitchen' }) });
  await page.settle();
  assert.equal(page.h1(), 'Could not reach mooboard.co');
  assert.deepEqual(page.buttons().map((b) => b.textContent), ['Try again']);
  assert.equal(page.focused(), page.find((e) => e.tagName === 'H1'));
  assert.deepEqual(page.eyes(), [{ lit: CROSS, colours: ['#0E1A22'] }, { lit: CROSS, colours: ['#0E1A22'] }], 'x pupils');
  page.buttons()[0].click();
  await page.settle();
  assert.equal(page.h1(), 'Pick your mooboard');
  assert.deepEqual(names(page), ['Kitchen5KAS', 'bedroomT8QP'], 'the board opened last on top');
  assert.deepEqual(page.fetches.map((f) => f.url), [`${API}/nearby`, `${API}/nearby`], 'no lookup while the api is down');
  assert.deepEqual(page.replaced, []);
  assert.equal(mine(page).code, '5KAS', 'still remembered');
});

test('when the browser blocks storage the portal works as on a first visit', async () => {
  const page = openPortal(nearbyOf([BEDROOM, KITCHEN]), { storage: 'blocked' });
  await page.settle();
  assert.equal(page.h1(), 'Pick your mooboard');
  page.cards()[0].click();
  assert.deepEqual(page.replaced, ['http://192.168.0.111/']);
});

test('the install button shows where the browser offers its prompt, only on pages that wait for a tap, and goes once used or installed', async () => {
  const page = openPortal(nearbyOf([BEDROOM, KITCHEN]));
  const e = promptEvent();
  page.fire('beforeinstallprompt', e);
  assert.equal(e.prevented, 1, 'the browser keeps its own banner back');
  assert.deepEqual(installBox(page), [], 'not while it looks');
  await page.settle();
  const button = installBox(page)[0];
  assert.equal(button.tagName, 'BUTTON');
  assert.equal(button.textContent, 'Add to home screen');
  assert.equal(button.className, 'add');
  button.click();
  assert.equal(e.prompted, 1);
  assert.deepEqual(installBox(page), [], 'one prompt per offer');
  page.fire('beforeinstallprompt', promptEvent());
  assert.equal(installBox(page).length, 1);
  page.fire('appinstalled');
  assert.deepEqual(installBox(page), []);
  const opening = openPortal(nearbyOf([KITCHEN]));
  opening.fire('beforeinstallprompt', promptEvent());
  await opening.settle();
  assert.equal(opening.h1(), 'Opening Kitchen…');
  assert.deepEqual(installBox(opening), [], 'not while it opens a board');
});

test('on an iPhone the share steps show instead, and nothing shows once it runs from the home screen', async () => {
  const page = openPortal(nearbyOf([BEDROOM, KITCHEN]), { ua: IPHONE });
  await page.settle();
  const steps = installBox(page)[0];
  assert.equal(steps.className, 'steps');
  assert.equal(steps.children[0].tagName, 'B');
  assert.equal(steps.children[0].textContent, 'Add mooboard to your Home Screen');
  const icon = steps.children.find((c) => c.tagName === 'SVG');
  assert.equal(icon.getAttribute('class'), 'share');
  assert.equal(steps.textContent, 'Add mooboard to your Home ScreenTap  Share, then Add to Home Screen.');
  for (const opts of [{ ua: IPHONE, standalone: true }, { displayStandalone: true }]) {
    const app = openPortal(nearbyOf([BEDROOM, KITCHEN]), opts);
    app.fire('beforeinstallprompt', promptEvent());
    await app.settle();
    assert.deepEqual(installBox(app), [], JSON.stringify(opts));
  }
});

// the board's setup opens mooboard.co/portal/?install=1 from its Add to home screen button
const INSTALL = { search: '?install=1' };
const lead = (page) => page.lead.children;
// the add to home screen button the portal leads with + in the view right above its setup guide
const leadGo = (page) => page.view.children.find((e) => e.className === 'lead__go');
const aboveGuide = (page) => {
  const kids = page.view.children;
  const at = kids.indexOf(leadGo(page));
  return at >= 0 && at + 1 < kids.length && kids[at + 1].className === 'foot' &&
    kids[at + 1].children[0].textContent === 'Setup guide';
};

test('the portal page keeps the iPhone hint after the view, where the install it leads with is', () => {
  assert.match(portal, /<\/noscript><\/div>\n<div id="lead" class="lead"><\/div>\n<div id="install" class="install"><\/div>/);
  assert.match(portal, /<div id="hero" class="hero"><\/div><\/div>\n<div id="view">/);
});

test('with ?install=1 the portal leads with Add to home screen right above the setup guide, one tap opens the prompt the browser offered, and the address drops the query', async () => {
  const page = openPortal(nearbyOf([KITCHEN]), INSTALL);
  assert.deepEqual(page.addresses, ['/portal/'], 'so the app starts at the portal and a reload is the everyday portal');
  assert.equal(leadGo(page), undefined, 'none while it looks: no setup guide yet');
  await page.settle();
  const e = promptEvent();
  page.fire('beforeinstallprompt', e);
  assert.equal(e.prevented, 1, 'the browser keeps its own banner back');
  const go = leadGo(page);
  assert.equal(go.className, 'lead__go');
  assert.ok(aboveGuide(page), 'the owner: right above the setup guide button');
  assert.deepEqual(lead(page), [], 'nothing at the top');
  assert.equal(go.children.length, 1, 'one button and no steps to read');
  const button = go.children[0];
  assert.equal(button.tagName, 'BUTTON');
  assert.equal(button.className, 'btn');
  assert.equal(button.textContent, 'Add to home screen');
  button.click();
  assert.equal(e.prompted, 1);
  await page.settle();
  assert.deepEqual(installBox(page), [], 'the lead has the install, not the foot');
  page.fire('appinstalled');
  assert.equal(leadGo(page), undefined, 'nothing once installed');
  assert.deepEqual(lead(page), []);
});

test('with ?install=1 before the browser offers its prompt, a tap shows the menu step, and the prompt takes over once offered', async () => {
  const page = openPortal(nearbyOf([KITCHEN]), INSTALL);
  await page.settle();
  const button = () => leadGo(page).children[0];
  assert.equal(button().textContent, 'Add to home screen');
  button().click();
  assert.equal(leadGo(page).children[1].className, 'quiet');
  assert.equal(leadGo(page).children[1].textContent, 'Tap the ⋮ menu, then Add to Home screen.');
  assert.ok(aboveGuide(page), 'still right above the setup guide');
  const e = promptEvent();
  page.fire('beforeinstallprompt', e);
  assert.equal(leadGo(page).children.length, 1, 'the step goes once the prompt is there');
  assert.equal(page.view.children.filter((c) => c.className === 'lead__go').length, 1, 'one button');
  button().click();
  assert.equal(e.prompted, 1);
});

test('with ?install=1 the button sits right above the setup guide on every view that has one, and on none without it', async () => {
  const views = [
    ['two boards', nearbyOf([BEDROOM, KITCHEN]), 'Pick your mooboard'],
    ['no board', nearbyOf([]), SAME_WIFI],
    ['the api down', () => { throw new Error('offline'); }, 'Could not reach mooboard.co'],
  ];
  for (const [name, answer, h1] of views) {
    const page = openPortal(answer, INSTALL);
    await page.settle();
    assert.equal(page.h1(), h1, name);
    assert.ok(aboveGuide(page), name);
    assert.equal(page.view.children.at(-1).className, 'foot', `${name}: the setup guide stays last`);
  }
  const opening = openPortal(nearbyOf([KITCHEN]), INSTALL);
  await opening.settle();
  opening.cards()[0].click();
  assert.equal(opening.h1(), 'Opening Kitchen…');
  assert.equal(leadGo(opening), undefined, 'opening a board shows no button');
});

test('with ?install=1 an iPhone gets a hint at the Share button below and an iPad at the top right, and nothing once it runs from the home screen', async () => {
  for (const [ua, where] of [[IPHONE, 'iphone'], [IPAD, 'ipad']]) {
    const page = openPortal(nearbyOf([KITCHEN]), { ...INSTALL, ua });
    const tip = lead(page)[0];
    assert.equal(tip.className, `tip tip--${where}`, ua);
    assert.equal(tip.getAttribute('role'), 'note');
    assert.equal(tip.children[0].textContent, 'Add mooboard to your Home Screen');
    assert.equal(tip.children.find((c) => c.tagName === 'SVG').getAttribute('class'), 'share');
    assert.equal(tip.textContent, 'Add mooboard to your Home ScreenTap  Share, then Add to Home Screen.');
    await page.settle();
    assert.deepEqual(installBox(page), [], 'the hint is the only one');
  }
  const app = openPortal(nearbyOf([KITCHEN]), { ...INSTALL, ua: IPHONE, standalone: true });
  assert.deepEqual(lead(app), []);
  const mac = openPortal(nearbyOf([KITCHEN]), { ...INSTALL, ua: IPAD, touchPoints: 0 });
  assert.deepEqual(lead(mac), [], 'a mac has no share button to point at and no prompt to open');
});

test('with ?install=1 the portal opens no board by itself: a lone board and a remembered one wait for a tap', async () => {
  const lone = openPortal(nearbyOf([KITCHEN]), INSTALL);
  await lone.settle();
  assert.equal(lone.h1(), 'mooboard');
  lone.timers.advance(10000);
  assert.deepEqual(lone.replaced, []);
  lone.cards()[0].click();
  assert.deepEqual(lone.replaced, ['http://192.168.0.110/']);
  const back = openPortal(homeWith(() => json({ found: true, localIp: '192.168.0.130', name: 'Kitchen' })), {
    ...INSTALL, storage: remembered({ code: '5KAS', name: 'Kitchen' }),
  });
  await back.settle();
  assert.equal(back.h1(), 'mooboard', 'the board to tap, not Opening');
  back.timers.advance(10000);
  assert.deepEqual(back.replaced, []);
  assert.deepEqual(back.fetches.map((f) => f.url), [`${API}/nearby`]);
});

test('from the home screen ?install=1 changes nothing: a lone board opens as every day', async () => {
  const app = openPortal(nearbyOf([KITCHEN]), { ...INSTALL, displayStandalone: true, storage: remembered({ code: '5KAS', name: 'Kitchen' }) });
  assert.deepEqual(app.addresses, ['/portal/']);
  await app.settle();
  assert.equal(app.h1(), 'Opening Kitchen…');
  app.timers.advance(1500);
  assert.deepEqual(app.replaced, ['http://192.168.0.110/']);
  assert.deepEqual(lead(app), []);
});

test('only install=1 asks for the lead, the portal leads with nothing without it, and /hi never leads or touches the address', async () => {
  for (const [search, leads] of [['?install=1', true], ['?ref=board&install=1', true], ['?install=10', false], ['?install=0', false], ['', false]]) {
    const page = openPortal(nearbyOf([KITCHEN]), { search });
    await page.settle();
    assert.equal(leadGo(page) ? 1 : 0, leads ? 1 : 0, search);
    assert.deepEqual(lead(page), [], search);
  }
  const page = openPortal(nearbyOf([BEDROOM, KITCHEN]));
  page.fire('beforeinstallprompt', promptEvent());
  await page.settle();
  assert.deepEqual(lead(page), []);
  assert.equal(installBox(page)[0].textContent, 'Add to home screen', 'the foot keeps its button');
  assert.deepEqual(page.addresses, []);
  const hiPage = load('/hi', nearbyOf([BEDROOM, KITCHEN]), INSTALL);
  hiPage.fire('beforeinstallprompt', promptEvent());
  await hiPage.settle();
  assert.deepEqual(hiPage.lead.children, []);
  assert.deepEqual(hiPage.addresses, []);
});

test('the portal registers its service worker once the page has loaded, and /hi never does, remembers nothing and offers no install', async () => {
  const page = openPortal();
  assert.deepEqual(page.registered, []);
  page.fire('load');
  assert.deepEqual(page.registered.map((r) => r.url), ['/portal/sw.js']);
  const hi = load('/hi', nearbyOf([BEDROOM, KITCHEN]));
  hi.fire('beforeinstallprompt', promptEvent());
  hi.fire('load');
  await hi.settle();
  hi.cards()[1].click();
  assert.deepEqual(hi.registered, []);
  assert.equal(hi.store.size, 0);
  assert.deepEqual(installBox(hi), []);
});

test('a remembered name is text, never markup, and the portal draws nothing through innerHTML', async () => {
  const name = '<img src=x onerror=alert(1)>';
  const page = openPortal(homeWith(() => new Promise(() => {}), []), { storage: remembered({ code: '5KAS', name }) });
  await page.settle();
  assert.equal(page.h1(), `Opening ${name}…`);
  assert.ok([page.view, page.hero, page.install].flatMap((r) => r.all()).every((e) => e.html === null));
  const bad = openPortal(nearbyOf([]), { storage: { [MINE]: '{not json' } });
  await bad.settle();
  assert.equal(bad.h1(), SAME_WIFI, 'a broken memory is a first visit');
  assert.deepEqual(bad.fetches.map((f) => f.url), [`${API}/nearby`], 'with nothing to look up');
});

test('/portal/<code> from the card on the board opens that board as /hi/<code> does, and the portal keeps it', async () => {
  for (const path of ['/portal/5KAS', '/portal/5kas/', '/PORTAL/5KAS', '/Portal/5Kas', '/portal/5KAS/index.html']) {
    const page = load(path, () => json({ found: true, localIp: '192.168.0.110', name: 'Kitchen', frameColor: 'mint' }));
    assert.equal(page.h1(), 'Finding your mooboard', path);
    await page.settle();
    assert.deepEqual(page.fetches.map((f) => f.url), [`${API}/lookup/5KAS`], path);
    assert.equal(page.h1(), 'Opening Kitchen…', path);
    assert.deepEqual(page.frames(page.hero), ['teal'], path);
    assert.deepEqual(hints(page), [DIDNT_OPEN], path);
    assert.deepEqual(page.replaced, ['http://192.168.0.110/'], path);
    assert.deepEqual(mine(page), { code: '5KAS', name: 'Kitchen', frameColor: 'mint' }, path);
    assert.doesNotMatch(page.store.get(MINE), /192\.168/, path);
  }
  const card = load('/portal/5KAS', () => json({ found: true, localIp: '192.168.0.110', name: 'Kitchen' }));
  card.fire('load');
  card.fire('beforeinstallprompt', promptEvent());
  await card.settle();
  assert.deepEqual(card.registered, [], 'the page of a board link registers no service worker');
  assert.deepEqual(card.addresses, []);
  const next = openPortal(nearbyOf([BEDROOM, KITCHEN]), { storage: Object.fromEntries(card.store) });
  await next.settle();
  assert.deepEqual(names(next), ['Kitchen5KAS', 'bedroomT8QP'], 'the portal lists it on top next time');
  const away = load('/portal/5KAS', () => json({ found: false }));
  await away.settle();
  assert.equal(away.h1(), SAME_WIFI);
  assert.equal(away.store.size, 0, 'nothing kept when it does not open');
  const down = load('/portal/5KAS', () => Promise.reject(new TypeError('offline')));
  await down.settle();
  assert.equal(down.h1(), DOWN);
  for (const path of ['/portal/OOPS', '/portal/5KA', '/portal/5KASX', '/portal/5KA0', '/portal/5KAS/x', '/portals/5KAS', '/portal5KAS']) {
    const page = load(path);
    await page.settle();
    assert.equal(page.h1(), 'Page not found', path);
    assert.deepEqual(page.fetches, [], path);
  }
});

test('/hi stays as it was: the api order, the countdown for one board, no lookup and nothing kept, even with a board the portal kept', async () => {
  const storage = remembered({ code: '5KAS', name: 'Kitchen' });
  const list = load('/hi', nearbyOf([BEDROOM, KITCHEN]), { storage });
  await list.settle();
  assert.deepEqual(names(list), ['bedroomT8QP', 'Kitchen5KAS']);
  const shared = load('/hi', sharedNet(FOUND), { storage: remembered({ code: 'T8QP', name: 'Kitchen' }) });
  await shared.settle();
  assert.deepEqual(names(shared), ['Kitchen5KAS', 'KitchenT8QP']);
  const one = load('/hi', nearbyOf([KITCHEN]), { storage });
  await one.settle();
  assert.equal(one.h1(), 'Opening Kitchen…');
  assert.deepEqual(layout(one), ['h1', 'cards', 'link', 'hint'], 'the countdown with its card');
  assert.deepEqual(one.buttons().filter((b) => b.className === 'link').map((b) => b.textContent), ['Stay here']);
  assert.equal(one.top.className, 'top');
  one.timers.advance(2999);
  assert.deepEqual(one.replaced, []);
  one.timers.advance(1);
  assert.deepEqual(one.replaced, ['http://192.168.0.110/']);
  assert.equal(one.store.get(MINE), storage[MINE], 'nothing kept');
  const none = load('/hi', nearbyOf([]), { storage });
  await none.settle();
  assert.equal(none.h1(), SAME_WIFI);
  assert.deepEqual(none.fetches.map((f) => f.url), [`${API}/nearby`], 'no lookup');
  const code = load('/hi/5KAS', () => json({ found: true, localIp: '192.168.0.110', name: 'Kitchen' }));
  await code.settle();
  assert.deepEqual(code.replaced, ['http://192.168.0.110/']);
  assert.equal(code.store.size, 0, '/hi/<code> keeps nothing');
});

test('no em dashes or semicolons in any copy the portal shows', async () => {
  const kept = { storage: remembered({ code: '5KAS', name: 'Kitchen' }) };
  const states = [
    openPortal(nearbyOf([KITCHEN])),
    openPortal(nearbyOf([BEDROOM, KITCHEN]), { ...kept, ua: IPHONE }),
    openPortal(sharedNet(FOUND), kept),
    openPortal(homeWith(() => new Promise(() => {}), []), kept),
    openPortal(nearbyOf([])),
    openPortal(() => Promise.reject(new TypeError('offline'))),
    load('/portal/5KAS', () => json({ found: true, localIp: '192.168.0.110', name: 'Kitchen' })),
  ];
  for (const page of states) {
    await page.settle();
    assert.doesNotMatch(page.text() + page.install.textContent, /—|;/, page.h1());
  }
});
