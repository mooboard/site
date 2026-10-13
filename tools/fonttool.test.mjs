// tests for fonts/tool + the font tool a board's web app imports to cut a font down before it adds it to the board
// + run node --test tools/fonttool.test.mjs (node 18 or later)
// tools/fixtures/test-font.ttf is Outfit SemiBold (SIL OFL 1.1, test-font-OFL.txt) cut to ASCII and named Test Font
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as tool from '../fonts/tool/fonttool.mjs';

const here = (rel) => new URL(rel, import.meta.url);
tool.useWasm(readFileSync(here('../fonts/tool/harfbuzz-subset.wasm')));
const font = new Uint8Array(readFileSync(here('fixtures/test-font.ttf')));
// the characters a board draws (the firmware's tools/gen_fonts.py TEXT_SET), as its web app sends them
const CHARSET = [[32, 126], [160, 383], [8211, 8212], [8216, 8217], [8220, 8221], [8226, 8226], [8230, 8230], [9834, 9834]];
const u16 = (b, at) => (b[at] << 8) | b[at + 1];
const u32 = (b, at) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
const tagsOf = (b, start = 0) => Array.from({ length: u16(b, start + 4) }, (_, i) => String.fromCharCode(...b.subarray(start + 12 + 16 * i, start + 16 + 16 * i)));

test('a font is read before it is cut: its faces, names and weight axis', () => {
  const info = tool.inspect(font);
  assert.equal(info.faces.length, 1);
  assert.equal(info.faces[0].name, 'Test Font');
  assert.equal(info.faces[0].weight, null);
  assert.throws(() => tool.inspect(new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 0, 0, 0, 0, 0, 0, 0])), /Use a .ttf, .otf or .ttc file/);
  assert.throws(() => tool.inspect(new Uint8Array(4)), /Use a .ttf, .otf or .ttc file/);
});

test('a cut font keeps only the tables the board reads, its name, and fits the board', async () => {
  const cut = await tool.prepare(font, { charset: CHARSET });
  assert.equal(cut.type, 'font/ttf');
  assert.equal(cut.name, 'Test Font');
  assert.ok(cut.bytes.length < font.length, 'smaller than it came');
  assert.ok(cut.bytes.length <= tool.MAX_BYTES);
  const tags = tagsOf(cut.bytes);
  for (const t of ['cmap', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp', 'name']) assert.ok(tags.includes(t), t);
  for (const t of ['GSUB', 'GDEF', 'STAT', 'gasp']) assert.ok(!tags.includes(t), t);
  assert.deepEqual([...tags].sort(), tags, 'tables in tag order');
  assert.equal(tool.inspect(cut.bytes).faces[0].name, 'Test Font');
});

test('a collection holds the faces in the board\'s role order', async () => {
  assert.deepEqual(tool.ROLES, ['SfMedium', 'SfSemibold', 'SfSemiboldClock', 'SfrSemibold', 'SfrBold']);
  const source = JSON.parse(readFileSync(here('../fonts/tool/sf-pro.json'), 'utf8'));
  assert.deepEqual(Object.keys(source.roles), tool.ROLES);
  assert.ok(source.base.startsWith('https://raw.githubusercontent.com/'), 'the browser fetches the faces itself');
  assert.ok(!/mooboard/.test(source.base), 'never from mooboard');
  assert.equal(source.license, 'https://developer.apple.com/fonts/');
  // the faces from a pretend mirror: the test font for every role
  const saved = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url) => { asked.push(String(url)); return new Response(font); };
  try {
    const pack = await tool.sfPro({ charset: CHARSET, source: { ...source, base: 'https://mirror.example/' } });
    assert.equal(pack.type, 'font/collection');
    assert.equal(pack.name, 'SF Pro');
    assert.equal(String.fromCharCode(...pack.bytes.subarray(0, 4)), 'ttcf');
    assert.equal(u32(pack.bytes, 8), 5);
    for (let i = 0; i < 5; i++) {
      const start = u32(pack.bytes, 12 + 4 * i);
      assert.ok(tagsOf(pack.bytes, start).includes('glyf'));
    }
    assert.deepEqual(tool.inspect(pack.bytes).faces.map((f) => f.name), Array(5).fill('SF Pro'));
    assert.deepEqual(asked.sort(), [...new Set(Object.values(source.roles))].map((f) => 'https://mirror.example/' + f).sort());
  } finally {
    globalThis.fetch = saved;
  }
});

test('a download that fails says so', async () => {
  const saved = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 404 });
  try {
    await assert.rejects(tool.sfPro({ charset: CHARSET, source: { base: 'https://mirror.example/', roles: { SfMedium: 'a', SfSemibold: 'a', SfSemiboldClock: 'a', SfrSemibold: 'a', SfrBold: 'a' } } }), /Could not download SF Pro/);
  } finally {
    globalThis.fetch = saved;
  }
});
