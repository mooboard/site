// tests for /start + the start page's words and links + js/start.js's reading of ?m= ?u= and ?frame= + the board's own
// wi-fi named after its code + wi-fi help in a sheet + the rail model's names + run node --test tools/hi.test.mjs
// tools/portal.test.mjs tools/start.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { test } from 'node:test';
import vm from 'node:vm';
import { json, load, nearbyOf, read } from './finder-harness.mjs';

const html = read('start/index.html');
const startJs = read('js/start.js');
const mount = read('js/scene.mjs');
const css = read('css/start.css');
const glb = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url));

// js/start.js in node with no deck to run + its readers of the address are all that is left
function helpers() {
  const window = {};
  const context = { window, location: { search: '' }, document: { getElementById: () => null, documentElement: { classList: { contains: () => true } } } };
  vm.createContext(context);
  vm.runInContext(startJs, context);
  return window.mooStart;
}
// the words a person reads on the page + its text and its labels + no markup, scripts, styles, drawings or comments
function words(page) {
  const text = page.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<\/?(?:span|b|i|a|small)\b[^>]*>/g, '').replace(/<[^>]+>/g, ' ');
  const labels = [...page.matchAll(/(?:aria-label|alt|content)="([^"]*)"/g)].map((m) => m[1]);
  return [text, ...labels].join(' ').replace(/\s+/g, ' ');
}
const items = (block) => [...block.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').trim());
const between = (s, a, b) => s.slice(s.indexOf(a), s.indexOf(b, s.indexOf(a) + a.length));

test('the start page loads the site\'s own files only, and nothing from anywhere else', () => {
  for (const text of [startJs, mount, css]) assert.doesNotMatch(text, /https?:\/\//, 'no other site');
  // the link preview's tags name the page and its picture on mooboard.co itself, as the other pages' tags do, and load nothing
  const previews = [...html.matchAll(/<meta property="og:(?:url|image)" content="([^"]+)">/g)].map((m) => m[1]);
  assert.deepEqual(previews, ['https://mooboard.co/start/', 'https://mooboard.co/og-start.png'], 'the preview names this page and the site\'s picture');
  const page = html.replace(/<meta property="og:(?:url|image)" content="[^"]+">/g, '');
  assert.deepEqual([...new Set(page.match(/https?:\/\/[^\s"'<>)]+/g))], ['http://4.3.2.1'], 'only the hotspot address');
  assert.deepEqual(html.match(/(?:href|src)="https?:[^"]*"/g), ['href="http://4.3.2.1"'], 'as the one link a person taps on the board\'s own Wi-Fi, and never a file');
  for (const text of [html, startJs, mount, css]) {
    assert.doesNotMatch(text, /@import/);
    assert.doesNotMatch(text, /\/\/(?:fonts|cdn|unpkg|ajax)\./);
  }
  assert.deepEqual(html.match(/<script[^>]*src="[^"]*"/g), ['<script src="/js/board.js"', '<script src="/js/start.js"']);
  assert.deepEqual(html.match(/<link[^>]+stylesheet[^>]*>/g), ['<link rel="stylesheet" href="/css/start.css">']);
  assert.match(html, /<meta name="referrer" content="no-referrer">/);
  assert.deepEqual([...mount.matchAll(/from '([^']+)'/g)].map((m) => m[1]), ['three', 'three/addons/environments/RoomEnvironment.js', './viewer.mjs']);
  assert.deepEqual([...mount.matchAll(/'(\/assets\/[^']+)'/g)].map((m) => m[1]), ['/assets/3d/board.glb', '/assets/3d/rail.glb']);
});

test('the one scene loads at the start once the first card is up, and the page itself names none of it', () => {
  const page = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script type="importmap">[\s\S]*?<\/script>/, '');
  assert.doesNotMatch(page, /scene\.mjs|modulepreload|three\.module/, 'nothing of the 3d on the page itself, the import map aside');
  assert.match(html, /<script type="importmap">\{"imports":\{"three":"\/js\/vendor\/three\/build\/three\.module\.min\.js"/);
  assert.doesNotMatch(startJs, /\bimport\s*\(/, 'no import syntax in the page script');
  assert.equal(startJs.match(/'\/js\/scene\.mjs'/g).length, 1, 'one place loads it');
  assert.match(between(startJs, 'function startScene', 'function reached'), /scene\.mjs/, 'startScene loads it');
  assert.match(startJs, /arrive\(false\);\n  startScene\(\);/, 'right after the first card is placed');
  assert.match(between(startJs, 'function reached', '\n  }'), /S\.api\.card\(card\.id\)/, 'and each card moves it');
});

test('the logo, then the light window with the scene, then the cards to flick, then the dots and the dock', () => {
  const order = ['<header class="bar">', '<div class="window" id="window"', '<main class="deck"', '<nav class="pager"'].map((x) => html.indexOf(x));
  assert.ok(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])), JSON.stringify(order));
  const win = between(html, '<div class="window"', '\n</div>');
  assert.match(win, /<canvas id="scene"><\/canvas>/);
  assert.match(win, /<div class="poster" id="poster">/, 'the hello waits in it until the models are in');
  assert.match(win, /<div class="clock" id="clock"/);
  assert.match(win, /<span class="tag">Coming soon<\/span>/);
  assert.match(css, /\.window \{[^}]*background: radial-gradient\(130% 110% at 50% 28%, #fbfcfc, #ebeff1 55%, #d8dfe3\)/, 'a very light cool grey');
  const dark = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'), css.indexOf('}\n}', css.indexOf('@media (prefers-color-scheme: dark)')));
  assert.doesNotMatch(dark, /\.window/, 'and the same in the dark');
  assert.match(css, /\.js \.card \.vis \{ display: none; \}/, 'the cards keep their words');
  assert.match(css, /\.flat3d \.card \.vis \{ display: block; \}/, 'their own drawings come back without 3d');
  assert.match(css, /\.flat3d \.window \{ display: none; \}|html:not\(\.js\) \.window, \.flat3d \.window \{ display: none; \}/);
});

test('the hardware rows take the camera to their spot, and the scene moves card to card or cuts with less motion', () => {
  assert.deepEqual([...html.matchAll(/<button type="button" class="spot" data-spot="(\d)" aria-pressed="false">/g)].map((m) => m[1]), ['1', '2', '3', '4']);
  assert.match(mount, /const k = reduced \? 1 : ease\(seg\(\(now - moveAt\) \/ 1000, 0, MOVE\)\)/, 'about a second with an ease, or a cut');
  assert.match(mount, /let touring = !reduced/, 'the camera tour plays only with motion');
  assert.match(mount, /mt\.held = reduced; mt\.playing = !reduced/, 'the steps are stills with less motion');
  for (const id of ['hello', 'box', 'hardware', 'mounting', 'wifi']) assert.match(mount, new RegExp('\\n    ' + id + ': '), id + ' has a pose');
  assert.doesNotMatch(mount, /\n    (?:setup|help): /, 'and the cards that went have none');
});

test('the BOOT and RESET row shows 1 and their caps in place of their names, and close up the scene labels each button', () => {
  const tour = read('hi/buttons/index.html');
  for (const id of ['k-boot', 'k-reset']) {
    const sym = tour.match(new RegExp(`<symbol id="${id}"[\\s\\S]*?</symbol>`))[0];
    assert.ok(html.includes(sym), `the tour's ${id}`);
  }
  const hw = between(html, 'id="hardware"', '</section>');
  const keys = '<span class="keys" role="img" aria-label="BOOT and RESET"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#k-boot"/></svg><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#k-reset"/></svg></span>';
  assert.ok(hw.includes(`data-spot="1" aria-pressed="false"><i class="pin" aria-hidden="true">1</i><span class="what">${keys}<small>Top edge</small></span>`), 'the row reads 1, BOOT\'s cap, RESET\'s cap and has a name');
  assert.deepEqual([...hw.matchAll(/<i class="pin" aria-hidden="true">(\d)<\/i>/g)].map((m) => m[1]), ['1', '2', '3', '4'], 'every row has its number');
  assert.deepEqual([...hw.matchAll(/<i class="pin" style="[^"]+">(\d)<\/i>/g)].map((m) => m[1]), ['1', '2', '3', '4'], 'and so does the drawing without 3d');
  assert.doesNotMatch(hw, /BOOT and RESET<\/b>|class="pin caps"/, 'no names in words in the row');
  // the scene + the 1 like the others + close up a label on each button where the model has its cap
  assert.doesNotMatch(between(mount, 'function makeMarker', 'function makeLabel'), /drawCap|CAP\b/, 'the marker is a number');
  assert.match(mount, /\[\['reset', 'RESET', true\], \['boot', 'BOOT', false\]\]/, 'a label for each button');
  assert.match(mount, /B\.root\.getObjectByName\('cap_' \+ cap\)/, 'at its cap in the model');
  const doc = (() => { const b = glb('assets/3d/board.glb'); return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8')); })();
  for (const n of ['cap_boot', 'cap_reset']) assert.ok(doc.nodes.some((x) => x.name === n), `the board model has ${n}`);
  assert.match(mount, /f\.near = spot === 1 \? k : spotWas === 1 \? 1 - k : 0;/, 'the labels come in with the camera and go as it leaves');
  assert.match(mount, /const k = spotFrom && !reduced \? ease\(seg\(\(now - spotAt\) \/ 1000, 0, MOVE\)\) : 1;/, 'in step with the camera, or at once with less motion');
  assert.match(mount, /m\.material\.opacity = f\.markers \* \(k === 0 \? 1 - f\.near : 1\);/, 'the 1 gives way');
  assert.match(mount, /l\.material\.opacity = f\.markers \* f\.near;/, 'the labels take over');
  for (const d of ['M11.4 4.2 14.6 6.6 11.4 9z', 'M15.9 8.6A5.4 5.4 0 1 1 12 6.6']) {
    assert.ok(tour.includes(d) && mount.includes(d), 'the labels draw RESET\'s arrow as the tour does');
  }
});

test('the board\'s face in 3d is a board of its own with a clock that asks nothing of the network', () => {
  assert.match(startJs, /scenes: \['hello', 'off', 'join', 'clock'\], auto: false, external: true/);
  assert.doesNotMatch(startJs + mount, /'time'|weatherNow/, 'never the board\'s weather clock');
});

test('?m= is MB1W, MB1D or MB1P in any case, and anything else or nothing is the wall board', () => {
  const { modelOf } = helpers();
  const cases = [['?m=MB1W', 'MB1W'], ['?m=MB1D', 'MB1D'], ['?m=MB1P', 'MB1P'], ['?m=mb1d', 'MB1D'], ['?m=Mb1P', 'MB1P'],
    ['', 'MB1W'], ['?m=', 'MB1W'], ['?m=MB1X', 'MB1W'], ['?m=MB1DD', 'MB1W'], ['?m=<b>', 'MB1W'], ['?u=5KAS&m=MB1D', 'MB1D'],
    ['?m=MB1P&u=5KAS', 'MB1P'], ['?mm=MB1D', 'MB1W']];
  for (const [search, want] of cases) assert.equal(modelOf(search), want, search);
});

test('?u= is a board code with the label\'s letters in any case, and anything else is no code', () => {
  const { codeOf, hiOf } = helpers();
  const cases = [['?u=5KAS', '5KAS'], ['?u=5kas', '5KAS'], ['?m=MB1D&u=t8qp', 'T8QP'], ['?u=5KA0', null], ['?u=OOPS', null],
    ['?u=5KASX', null], ['?u=5KA', null], ['?u=', null], ['', null], ['?u=<b>a', null], ['?u=5K%41S', null]];
  for (const [search, want] of cases) assert.equal(codeOf(search), want, search);
  assert.equal(hiOf('5KAS'), '/hi/5KAS', 'a code opens that board');
  assert.equal(hiOf(null), '/hi/', 'else the boards near you');
});

test('the board\'s own Wi-Fi is mooboard- and its code from ?u=, and mooboard-XXXX without one', () => {
  const { ssidOf } = helpers();
  const cases = [['?u=5KAS', 'mooboard-5KAS'], ['?m=MB1D&u=t8qp', 'mooboard-T8QP'], ['', 'mooboard-XXXX'], ['?u=OOPS', 'mooboard-XXXX'],
    ['?u=5KASX', 'mooboard-XXXX'], ['?w=3F9C', 'mooboard-XXXX'], ['?m=MB1W', 'mooboard-XXXX']];
  for (const [search, want] of cases) assert.equal(ssidOf(search), want, search);
  assert.equal((startJs.match(/'mooboard-'/g) || []).length, 1, 'the rule in one place');
  assert.doesNotMatch(startJs, /param\(search, 'w'\)/, 'no ?w=');
  assert.match(html, /<b><span class="nw">Wi-Fi<\/span> SSID:<\/b> <span class="nw" data-ssid>mooboard-XXXX<\/span>/, 'the card');
  assert.match(startJs, /all\('\[data-ssid\]'\)\.forEach\(function \(s\) \{ s\.textContent = ssid; \}\)/, 'fills it');
  assert.match(startJs, /MB\.scenes\.join = joinScene\(MB, ssid\)/, 'and the board\'s join card in 3d says the same');
});

test('?frame= takes the frames boards name, and nothing else', () => {
  const { frameOf } = helpers();
  for (const f of ['midnight', 'moonlight', 'sunset', 'mint', 'red']) assert.equal(frameOf('?frame=' + f), f);
  for (const s of ['', '?frame=', '?frame=purple', '?frame=constructor', '?frame=__proto__', '?frame=Mint']) assert.equal(frameOf(s), null, s);
});

test('?rail= picks a white rail and hooks, and anything else is black', () => {
  const { railOf } = helpers();
  assert.equal(railOf('?rail=white'), 'white');
  for (const s of ['', '?rail=black', '?rail=WHITE', '?rail=', '?rail=red', '?rails=white']) assert.equal(railOf(s), 'black', s);
});

test('light parts keep an outline and a soft shadow on the light backdrops, here and on the buttons tour', () => {
  const viewer = read('js/viewer.mjs'), tour = read('js/tour.mjs');
  assert.match(viewer, /export function lightEdges\(/);
  assert.match(viewer, /export function softShadow\(/);
  assert.match(mount, /lightEdges\(B\.root, \['frame'\]\)/);
  assert.match(mount, /lightEdges\(railMesh, \['rail'\]\)/);
  assert.match(mount, /lightEdges\(h, \['rail'\]\)/);
  assert.match(tour, /V\.lightEdges\(root, \['frame'\]\)/);
  assert.match(tour, /V\.softShadow\(/);
});

test('the desk stand is a way to put it up only for the desk board, and it is coming soon', () => {
  const { waysOf } = helpers();
  assert.deepEqual([...waysOf('MB1D')], ['screws', 'strips', 'stand']);
  assert.deepEqual([...waysOf('MB1W')], ['screws', 'strips']);
  assert.deepEqual([...waysOf('MB1P')], ['screws', 'strips']);
  assert.deepEqual([...html.matchAll(/<button type="button" class="chip"[^>]*data-way="(\w+)"[^>]*>([^<]+)</g)].map((m) => [m[1], m[2]]),
    [['screws', 'Screws'], ['strips', 'Adhesive strips'], ['stand', 'Desk stand']]);
  assert.match(html, /<span class="tag">Coming soon<\/span>/);
});

test('a sticker link\'s trip to the start page lands with its model and code, and its links go back to that board without ?m=', async () => {
  const page = load('/hi/5KAS', () => json({ found: false }), { search: '?m=mb1d' });
  await page.settle();
  const [to] = page.replaced;
  assert.equal(to, '/start/?m=MB1D&u=5KAS');
  const { modelOf, codeOf, hiOf } = helpers();
  const search = to.slice(to.indexOf('?'));
  assert.equal(modelOf(search), 'MB1D');
  assert.equal(codeOf(search), '5KAS');
  assert.equal(hiOf(codeOf(search)), '/hi/5KAS', 'no ?m= so a board still away shows the same-Wi-Fi page and never comes round again');
  assert.equal([...html.matchAll(/href="\/portal\/" data-portal/g)].length, 1, 'the mooboard.co/portal link in Wi-Fi help takes the code');
  const { portalOf } = helpers();
  assert.equal(portalOf('5KAS'), '/portal/5KAS');
  assert.equal(portalOf(null), '/portal/');
});

test('the dots sit over a dock of back and next, back hides on the first card and next says Finish on the last, which opens this board', () => {
  const pager = between(html, '<nav class="pager"', '</nav>');
  assert.match(pager, /<ol class="dots" id="dots"><\/ol>\s*<div class="dock">\s*<button type="button" class="back" id="back" hidden>Back<\/button>\s*<button type="button" class="btn" id="next">Next<\/button>\s*<\/div>/);
  assert.match(startJs, /back\.hidden = i === 0/);
  assert.match(startJs, /next\.textContent = i === cards\.length - 1 \? 'Finish' : 'Next'/);
  assert.match(startJs, /if \(index === cards\.length - 1\) location\.href = hi/);
  assert.equal((html.match(/id="back"|id="next"|class="dots"/g) || []).length, 3, 'one back, one next and one row of dots');
});

test('the five cards, in order, with one h1, and Wi-Fi help is a sheet and not a card', () => {
  const ids = [...html.matchAll(/<section class="card[^"]*" id="(\w+)" aria-roledescription="slide" aria-label="(\d) of 5"/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(ids, [['hello', '1'], ['box', '2'], ['hardware', '3'], ['mounting', '4'], ['wifi', '5']]);
  assert.equal((html.match(/<section class="card/g) || []).length, 5);
  assert.equal(html.match(/<h1>/g).length, 1);
  assert.deepEqual([...html.matchAll(/<h[12]>([\s\S]*?)<\/h[12]>/g)].map((m) => m[1].replace(/<[^>]+>/g, '')),
    ['Meet your mooboard', 'In the box', 'Hardware', 'Mounting', 'Join its Wi-Fi']);
  assert.doesNotMatch(html, /id="setup"|<section[^>]*id="help"|Already set up/);
  assert.match(css, /\.js:not\(\.flat3d\) \.card > \.txt \{ margin-block: auto; \}/, 'the words sit in the middle of each card');
});

test('in the box: the board, the rail with its hooks, the strips, the screws and anchors, the charger and the cable', () => {
  const box = between(html, 'id="box"', '</section>');
  assert.deepEqual([...box.matchAll(/<b>([^<]+)<\/b>/g)].map((m) => m[1]),
    ['mooboard', 'Wall rail with 2 hooks', 'Adhesive strips', 'Screws and anchors', '20 W USB-C charger', '2 m USB-C cable']);
  assert.equal((box.match(/<span class="ic" aria-hidden="true"><svg/g) || []).length, 6, 'a small drawing for each');
});

test('hardware: where each thing is, and Watch opens the buttons tour', () => {
  const hw = between(html, 'id="hardware"', '</section>');
  assert.deepEqual([...hw.matchAll(/(?:<b>([^<]+)<\/b>|<span class="keys" role="img" aria-label="([^"]+)">(?:<svg[^>]*><use[^>]*\/><\/svg>)+<\/span>)<small>([^<]+)<\/small>/g)].map((m) => [m[1] || m[2], m[3]]), [
    ['BOOT and RESET', 'Top edge'], ['Status light', 'Bottom, near the right end'], ['USB-C port', 'Bottom center'], ['NFC', 'Left side']]);
  assert.match(hw, /<a class="pill" id="watch" href="\/hi\/buttons\/" target="_blank" rel="noopener"[^>]*>[\s\S]*?Watch<\/a>/, 'in a tab of its own so its Done closes it and lands back here');
  assert.match(startJs, /'\/hi\/buttons\/\?frame=' \+ frame/, 'with the board\'s frame when the link names one');
});

test('the Wi-Fi card says what the owner wrote, word for word, and its links work', () => {
  const card = between(html, 'id="wifi"', '</section>');
  const said = words(card.slice(card.indexOf('<div class="txt">'))).replace(/’/g, "'").trim();
  assert.equal(said, [
    'Join its Wi-Fi',
    'After plugging in your mooboard, it will show info to join its Wi-Fi.',
    'Wi-Fi SSID: mooboard-XXXX',
    'Password: See on board.',
    "You can also scan the QR code with your phone's camera.",
    "Once connected, a captive portal will launch where you will input your home's Wi-Fi details.",
    "If it doesn't open, go to http://4.3.2.1 in your browser manually.",
    'Note: mooboard can only join WPA2, WPA3 Personal or open networks on the 2.4GHz band. Press here for more details.',
  ].join(' '));
  assert.match(card, /<a class="nw" href="http:\/\/4\.3\.2\.1" target="_blank" rel="noopener">http:\/\/4\.3\.2\.1<\/a>/, 'the address to tap');
  assert.match(card, /<a class="more" id="more" href="#help" role="button" aria-haspopup="dialog" aria-controls="help">Press here for more details\.<\/a>/);
  assert.match(startJs, /more\.addEventListener\('click', function \(e\) \{ e\.preventDefault\(\); openHelp\(\); \}\)/, 'it opens Wi-Fi help');
});

test('Wi-Fi help is a sheet with the help card\'s words, a Close button, Escape, a focus trap and a body that scrolls', () => {
  const sheet = between(html, '<dialog class="sheet" id="help"', '</dialog>');
  assert.match(sheet, /aria-labelledby="help-title"/);
  assert.match(sheet, /<h2 id="help-title"><span class="nw">Wi-Fi<\/span> help<\/h2>\s*<button type="button" class="close" id="help-close">Close<\/button>/);
  assert.deepEqual([...sheet.matchAll(/<h3>([\s\S]*?)<\/h3>/g)].map((m) => m[1].replace(/<[^>]+>/g, '')), ['Tips', 'Change Wi-Fi later', 'Factory reset']);
  const text = words(sheet);
  for (const fact of [
    'mooboard needs a 2.4 GHz network.', 'It joins WPA2 and WPA3 Personal networks, and open ones.', 'Do not pick a guest network.',
    'Wi-Fi with a sign-in page, like at hotels, schools, and work, won’t work.',
    'A VPN or iCloud Private Relay can hide that you are home.', 'Move the board closer to your router and scan again.',
    'Other network', 'Change Wi-Fi', 'Save and restart', 'the board shows its code again after 2 minutes',
  ]) assert.ok(text.includes(fact), fact);
  // factory reset as the owner cut it + BOOT's cap in place of its name with its name for a screen reader
  const reset = [...between(sheet, '<h3>Factory reset</h3>', '</ul>').matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
  assert.deepEqual(reset, [
    'Hold <svg class="key" role="img" aria-label="BOOT"><use href="#k-boot"/></svg> for 10 seconds.',
    'Then the board restarts and shows its code to join.',
    'Or in the web app, open <b>System</b>, then <b>Advanced</b>. Under <b>Erase everything</b>, type RESET and tap <b>Erase</b>.',
  ]);
  assert.doesNotMatch(text, /amber to red|Factory resetting|BOOT does nothing|sign-ins/, 'the cut lines are gone');
  assert.doesNotMatch(words(html), /5 GHz|192\.168\.4\.1|WiFi/, 'nothing the firmware does not say');
  assert.ok(html.indexOf('<dialog class="sheet"') > html.indexOf('</main>'), 'outside the cards so it is never inert with them');
  const js = between(startJs, '// ---- wi-fi help', '// ---- the one scene');
  assert.match(js, /help\.showModal\(\)/, 'a modal sheet');
  assert.match(js, /helpClose\.addEventListener\('click', closeHelp\)/, 'Close shuts it');
  assert.match(js, /e\.key === 'Escape'/, 'and Escape');
  assert.match(js, /help\.addEventListener\('cancel'/);
  assert.match(js, /e\.key !== 'Tab'/, 'tab stays inside');
  assert.match(js, /last\.focus\(\)/);
  assert.match(js, /first\.focus\(\)/);
  assert.match(js, /more\.focus\(/, 'and focus goes back');
  assert.match(startJs, /e\.defaultPrevented \|\| help\.open\) return;/, 'the arrow keys leave the cards alone meanwhile');
  assert.match(css, /\.sheet-body \{[^}]*overflow-y: auto/, 'its body scrolls on a short phone');
  assert.match(css, /\.sheet \{[^}]*max-height: min\(88dvh, 760px\)/);
});

test('every mounting way has a caption for each of its steps in 3d, and stills for less motion', () => {
  const hang = (between(mount, 'function hangSteps', 'function ways').match(/\{ dur: /g) || []).length;
  const own = (way) => (between(mount, `${way}: {`, '...hangSteps(A)').match(/\{ dur: /g) || []).length;
  const caps = (way) => items(between(html, `<div data-way="${way}">`, '</ol>'));
  assert.deepEqual(caps('strips'), [
    'Press a strip into each of the rail’s 4 pockets.',
    'Hold the rail level on a clean wall and press it on.',
    'Wait 1 hour before you hang the board.',
    'Line up the hooks with the rail’s round holes and push in.',
    'Lift the board a little and slide it left until it clicks.',
  ]);
  assert.deepEqual(caps('screws'), [
    'Hold the rail level on the wall.',
    'Mark the wall through the rail’s 3 holes.',
    'Take the rail down and screw an anchor into each mark.',
    'Screw the rail on.',
    'Line up the hooks with the rail’s round holes and push in.',
    'Lift the board a little and slide it left until it clicks.',
  ]);
  assert.equal(own('strips') + hang, caps('strips').length);
  assert.equal(own('screws') + hang, caps('screws').length);
  assert.equal((mount.match(/still: [\d.]+/g) || []).length, (mount.match(/\{ dur: /g) || []).length, 'a still for each step');
  assert.match(startJs, /reduced: REDUCED/, 'the scene knows when less motion is asked for');
  assert.match(mount, /if \(reduced\) mt\.time = WAYS\[mt\.way\]\.steps\[step\]\.still/, 'and shows each step as its still');
  assert.doesNotMatch(mount + html, /\bdrill\b/i, 'self-drilling anchors go in with a screwdriver, no drill');
  assert.match(mount, /function makeDriver\(\)/);
  assert.match(mount, /function makeAnchor\(\)/);
});

test('no em dashes, en dashes or semicolons in what a person reads, mooboard in lowercase, American English and Wi-Fi with its hyphen', () => {
  const text = words(html);
  assert.doesNotMatch(text, /[—–;]/);
  assert.doesNotMatch(text, /MooBoard|Mooboard|MOOBOARD/);
  assert.doesNotMatch(text, /colour|centre|favourite|metre|organis|customis/i);
  assert.doesNotMatch(text, /\bWiFi\b|\bwifi\b|\bWifi\b/);
  assert.match(text, /Wi-Fi/);
  for (const s of ['Next', 'Finish', ' of ', 'Step ']) assert.ok(startJs.includes(`'${s}'`), s);
});

test('the rail model has the rail, both hooks and every place the steps use, so a new rail is one new file', () => {
  const bytes = glb('assets/3d/rail.glb');
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, 'a glb');
  const len = bytes.readUInt32LE(12);
  const doc = JSON.parse(bytes.subarray(20, 20 + len).toString('utf8'));
  const names = doc.nodes.map((n) => n.name);
  const want = ['rail', 'hook_l', 'hook_r', 'at_wall', 'at_top', 'at_pocket_1', 'at_pocket_2', 'at_pocket_3', 'at_pocket_4',
    'at_screw_1', 'at_screw_2', 'at_screw_3', 'at_hole_l', 'at_hole_r', 'at_latch', 'at_entry', 'at_click'];
  for (const n of want) assert.ok(names.includes(n), n);
  for (const n of want.filter((x) => x.startsWith('at_'))) assert.ok(mount.includes(`'${n.replace(/\d$/, '')}`), `mount.mjs reads ${n}`);
  for (const n of ['rail', 'hook_l', 'hook_r']) assert.ok(doc.nodes.find((x) => x.name === n).mesh != null, `${n} is a mesh`);
  assert.deepEqual(gunzipSync(glb('assets/3d/rail.glb.gz')), bytes, 'the .gz the viewer fetches is the same model');
  assert.ok(bytes.length < 200 * 1024, 'small');
  // the hooks go in at the round holes + the board's offset there lines each stud up with its hole as the cad has it
  const at = (n) => doc.nodes.find((x) => x.name === n).translation;
  assert.deepEqual(at('at_hole_l').map((v, i) => +(v - at('at_entry')[i]).toFixed(3)).slice(0, 1), [-102], 'the left stud at board x 154');
  assert.deepEqual(at('at_hole_r').map((v, i) => +(v - at('at_entry')[i]).toFixed(3)).slice(0, 1), [102], 'the right stud at board x 358');
  assert.ok(at('at_click')[0] > 0 && at('at_click')[0] < at('at_entry')[0], 'the latch clicks before the board is centered');
});
