// tests for /start + the start page's words and links + js/start.js's reading of ?m= ?u= and ?frame= + the rail model's
// names + run node --test tools/hi.test.mjs tools/portal.test.mjs tools/start.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { test } from 'node:test';
import vm from 'node:vm';
import { json, load, nearbyOf, read } from './finder-harness.mjs';

const html = read('start/index.html');
const startJs = read('js/start.js');
const mount = read('js/mount.mjs');
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
    .replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]+>/g, ' ');
  const labels = [...page.matchAll(/(?:aria-label|alt|content)="([^"]*)"/g)].map((m) => m[1]);
  return [text, ...labels].join(' ').replace(/\s+/g, ' ');
}
const items = (block) => [...block.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').trim());
const between = (s, a, b) => s.slice(s.indexOf(a), s.indexOf(b, s.indexOf(a) + a.length));

test('the start page loads the site\'s own files only, and nothing from anywhere else', () => {
  for (const text of [html, startJs, mount, css]) {
    assert.doesNotMatch(text, /https?:\/\//, 'no other site');
    assert.doesNotMatch(text, /@import/);
    assert.doesNotMatch(text, /\/\/(?:fonts|cdn|unpkg|ajax)\./);
  }
  assert.deepEqual(html.match(/<script[^>]*src="[^"]*"/g), ['<script src="/js/board.js"', '<script src="/js/start.js"']);
  assert.deepEqual(html.match(/<link[^>]+stylesheet[^>]*>/g), ['<link rel="stylesheet" href="/css/start.css">']);
  assert.match(html, /<meta name="referrer" content="no-referrer">/);
  assert.deepEqual([...mount.matchAll(/from '([^']+)'/g)].map((m) => m[1]), ['three', 'three/addons/environments/RoomEnvironment.js', './viewer.mjs']);
  assert.deepEqual([...mount.matchAll(/'(\/assets\/[^']+)'/g)].map((m) => m[1]), ['/assets/3d/board.glb', '/assets/3d/rail.glb']);
});

test('three.js and the mounting steps load only when the mounting card is reached', () => {
  const page = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script type="importmap">[\s\S]*?<\/script>/, '');
  assert.doesNotMatch(page, /mount\.mjs|modulepreload|three\.module/, 'nothing of the 3d on the page itself, the import map aside');
  assert.match(html, /<script type="importmap">\{"imports":\{"three":"\/js\/vendor\/three\/build\/three\.module\.min\.js"/);
  assert.doesNotMatch(startJs, /\bimport\s*\(/, 'no import syntax in the page script');
  assert.equal(startJs.match(/'\/js\/mount\.mjs'/g).length, 1, 'one place loads it');
  assert.match(between(startJs, 'function startMount', 'function reached'), /mount\.mjs/, 'only startMount loads it');
  assert.match(between(startJs, 'function reached', '\n  }'), /if \(card === M\.card\) startMount\(\)/, 'and only on the mounting card');
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

test('?frame= takes the frames boards name, and nothing else', () => {
  const { frameOf } = helpers();
  for (const f of ['midnight', 'moonlight', 'sunset', 'mint', 'red']) assert.equal(frameOf('?frame=' + f), f);
  for (const s of ['', '?frame=', '?frame=purple', '?frame=constructor', '?frame=__proto__', '?frame=Mint']) assert.equal(frameOf(s), null, s);
});

test('the desk stand is a way to put it up only for the desk board, and it is coming soon', () => {
  const { waysOf } = helpers();
  assert.deepEqual([...waysOf('MB1D')], ['strips', 'screws', 'stand']);
  assert.deepEqual([...waysOf('MB1W')], ['strips', 'screws']);
  assert.deepEqual([...waysOf('MB1P')], ['strips', 'screws']);
  assert.deepEqual([...html.matchAll(/<button type="button" class="chip"[^>]*data-way="(\w+)"[^>]*>([^<]+)</g)].map((m) => [m[1], m[2]]),
    [['strips', 'Adhesive strips'], ['screws', 'Screws'], ['stand', 'Desk stand']]);
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
  assert.equal([...html.matchAll(/href="\/hi\/" data-hi/g)].length, 2, 'both mooboard.co/hi links take the code');
});

test('the five cards, in order, with one h1', () => {
  const ids = [...html.matchAll(/<section class="card[^"]*" id="(\w+)" aria-roledescription="slide" aria-label="(\d) of 5"/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(ids, [['hello', '1'], ['box', '2'], ['hardware', '3'], ['mounting', '4'], ['setup', '5']]);
  assert.equal(html.match(/<h1>/g).length, 1);
  assert.deepEqual([...html.matchAll(/<h[12]>([^<]+)</g)].map((m) => m[1]), ['Meet your mooboard', 'In the box', 'Hardware', 'Mounting', 'Set up']);
});

test('in the box: the board, the rail with its hooks, the strips, the screws and anchors, the charger and the cable', () => {
  const box = between(html, 'id="box"', '</section>');
  assert.deepEqual([...box.matchAll(/<b>([^<]+)<\/b>/g)].map((m) => m[1]),
    ['mooboard', 'Wall rail with 2 hooks', 'Adhesive strips', 'Screws and anchors', '20 W USB-C charger', '2 m USB-C cable']);
  assert.equal((box.match(/<span class="ic" aria-hidden="true"><svg/g) || []).length, 6, 'a small drawing for each');
});

test('hardware: where each thing is, and Watch opens the buttons tour', () => {
  const hw = between(html, 'id="hardware"', '</section>');
  assert.deepEqual([...hw.matchAll(/<b>([^<]+)<\/b><small>([^<]+)<\/small>/g)].map((m) => [m[1], m[2]]), [
    ['BOOT and RESET', 'Top edge'], ['Status light', 'Bottom, near the right end'], ['USB-C port', 'Bottom center'], ['NFC', 'Left side']]);
  assert.match(hw, /<a class="pill" id="watch" href="\/hi\/buttons\/" target="_blank" rel="noopener"[^>]*>[\s\S]*?Watch<\/a>/, 'in a tab of its own so its Done closes it and lands back here');
  assert.match(startJs, /'\/hi\/buttons\/\?frame=' \+ frame/, 'with the board\'s frame when the link names one');
});

test('set up uses the words /hi uses for a new board, and says where a board that is set up is', async () => {
  const hi = load('/hi', nearbyOf([]));
  await hi.settle();
  const theirs = hi.setup().children[1].children.map((li) => li.textContent);
  assert.deepEqual(items(between(html, '<ol class="steps">', '</ol>')), theirs);
  assert.equal(items(`<li>${between(html, '<p class="hint">', '</p>').slice(16)}</li>`)[0], 'Already set up? Open mooboard.co/hi on the same Wi-Fi as your mooboard.');
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
    'Take the rail down. Screw an anchor into each mark.',
    'Screw the rail on.',
    'Line up the hooks with the rail’s round holes and push in.',
    'Lift the board a little and slide it left until it clicks.',
  ]);
  assert.equal(own('strips') + hang, caps('strips').length);
  assert.equal(own('screws') + hang, caps('screws').length);
  assert.equal((mount.match(/still: [\d.]+/g) || []).length, (mount.match(/\{ dur: /g) || []).length, 'a still for each step');
  assert.match(startJs, /if \(REDUCED\) \{\s*M\.api\.show\(way, step\)/, 'less motion shows the steps as stills and plays nothing');
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
  for (const s of ['Next', 'Done', ' of ', 'Step ']) assert.ok(startJs.includes(`'${s}'`), s);
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
