// mooboard's font tool: cuts a font down to the characters a board draws, in the browser, before the board's web app
// sends it to the board (Settings > Display > Font > Add a font). The board's own web app is too small to carry
// HarfBuzz, so it imports this module from mooboard.co. Nothing here sends the font anywhere: the web app uploads
// what this returns straight to the board on the home network.
//
// "Download SF Pro" fetches Apple's SF Pro faces in this browser from the mirror sf-pro.json names, and builds one
// collection with a face for each kind of text the board draws. mooboard never hosts or passes on the font.
//
// HarfBuzz's subsetter (harfbuzz-subset.wasm, from npm harfbuzzjs 1.6.3, MIT and HarfBuzz's Old MIT, LICENSES.txt).

const HERE = new URL('./', import.meta.url);
// the largest font the board takes (pw::text::kMaxUserFontBytes)
export const MAX_BYTES = 320 * 1024;
// the kinds of text in the board's role order (pw::text::FaceId): a collection of five faces gives one to each
export const ROLES = ['SfMedium', 'SfSemibold', 'SfSemiboldClock', 'SfrSemibold', 'SfrBold'];

const HB_MEMORY_MODE_READONLY = 1;
const HB_SUBSET_SETS_DROP_TABLE_TAG = 3;
const HB_SUBSET_SETS_LAYOUT_FEATURE_TAG = 6;
const HB_SUBSET_FLAGS_NO_HINTING = 0x1;
const HB_SUBSET_FLAGS_NOTDEF_OUTLINE = 0x40;
// tables the board never reads, dropped to keep the font small
const DROP = ['GSUB', 'GDEF', 'DSIG', 'BASE', 'JSTF', 'MATH', 'STAT', 'meta', 'morx', 'mort', 'kerx', 'trak', 'feat',
  'ltag', 'COLR', 'CPAL', 'SVG ', 'sbix', 'CBDT', 'CBLC', 'EBDT', 'EBLC', 'EBSC', 'VORG', 'vhea', 'vmtx', 'hdmx',
  'LTSH', 'VDMX', 'PCLT', 'gasp', 'MVAR', 'HVAR', 'VVAR', 'avar', 'cvar', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'];

let wasmBytes = null;
let exportsPromise = null;

// node's tests hand the wasm over themselves: node's fetch cannot read a file
export function useWasm(bytes) {
  wasmBytes = bytes;
  exportsPromise = null;
}

function harfbuzz() {
  if (!exportsPromise) {
    exportsPromise = (async () => {
      let bytes = wasmBytes;
      if (!bytes) {
        const response = await fetch(new URL('harfbuzz-subset.wasm', HERE));
        if (!response.ok) throw new Error('Could not load the font tools.');
        bytes = await response.arrayBuffer();
      }
      const { instance } = await WebAssembly.instantiate(bytes, {});
      return instance.exports;
    })();
    exportsPromise.catch(() => { exportsPromise = null; });
  }
  return exportsPromise;
}

const tagOf = (s) => ((s.charCodeAt(0) << 24) | (s.charCodeAt(1) << 16) | (s.charCodeAt(2) << 8) | s.charCodeAt(3)) >>> 0;
const u16 = (b, at) => (b[at] << 8) | b[at + 1];
const u32 = (b, at) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
const s16 = (b, at) => (u16(b, at) << 16) >> 16;
const fixed = (b, at) => (u32(b, at) | 0) / 65536;
const ascii = (b, at) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);

// -- reading a font --------------------------------------------------------------------------------------------------

// the faces of a font file or a collection, as where each one's table directory starts
function faceStarts(bytes) {
  if (bytes.length < 12) throw new Error('Use a .ttf, .otf or .ttc file.');
  const head = ascii(bytes, 0);
  if (head === 'wOFF' || head === 'wOF2') throw new Error('Use a .ttf, .otf or .ttc file.');
  if (head === 'ttcf') {
    const count = u32(bytes, 8);
    if (count < 1 || count > 64 || bytes.length < 12 + 4 * count) throw new Error('The font file is damaged.');
    return Array.from({ length: count }, (_, i) => u32(bytes, 12 + 4 * i));
  }
  const version = u32(bytes, 0);
  if (version !== 0x00010000 && head !== 'OTTO' && head !== 'true') throw new Error('Use a .ttf, .otf or .ttc file.');
  return [0];
}

function tables(bytes, start) {
  const out = {};
  const count = u16(bytes, start + 4);
  for (let i = 0; i < count; i++) {
    const at = start + 12 + 16 * i;
    if (at + 16 > bytes.length) break;
    const offset = u32(bytes, at + 8), length = u32(bytes, at + 12);
    if (offset + length <= bytes.length) out[ascii(bytes, at)] = bytes.subarray(offset, offset + length);
  }
  return out;
}

function nameOf(name, ids) {
  if (!name || name.length < 6) return '';
  const count = u16(name, 2), strings = u16(name, 4);
  for (const id of ids) {
    for (let i = 0; i < count; i++) {
      const r = 6 + 12 * i;
      if (r + 12 > name.length || u16(name, r + 6) !== id) continue;
      const platform = u16(name, r), length = u16(name, r + 8), at = strings + u16(name, r + 10);
      if (at + length > name.length) continue;
      if (platform === 3 || platform === 0) {
        let s = '';
        for (let k = 0; k + 1 < length; k += 2) s += String.fromCharCode(u16(name, at + k));
        if (s.trim()) return s.trim();
      } else if (platform === 1) {
        const s = String.fromCharCode(...name.subarray(at, at + length)).replace(/[^\x20-\x7e]/g, '');
        if (s.trim()) return s.trim();
      }
    }
  }
  return '';
}

function weightAxis(fvar) {
  if (!fvar || fvar.length < 16) return null;
  const axesAt = u16(fvar, 4), count = u16(fvar, 8), size = u16(fvar, 10);
  for (let i = 0; i < count; i++) {
    const a = axesAt + i * size;
    if (a + 20 > fvar.length) break;
    if (ascii(fvar, a) === 'wght') return { min: fixed(fvar, a + 4), value: fixed(fvar, a + 8), max: fixed(fvar, a + 12) };
  }
  return null;
}

// What the web app shows before it cuts a font: each face's name and style, and its weight range when it has one.
export function inspect(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  return {
    faces: faceStarts(bytes).map((start) => {
      const t = tables(bytes, start);
      if (!t.cmap || !t.head || !t.maxp) throw new Error('The font file is damaged.');
      if (!t.glyf && !t['CFF '] && t.CFF2) throw new Error('This font uses outlines the board cannot draw.');
      return { name: nameOf(t.name, [16, 1]), style: nameOf(t.name, [17, 2]), weight: weightAxis(t.fvar) };
    }),
  };
}

// -- cutting a font down -------------------------------------------------------------------------------------------

// The characters as ranges [first, last], as the board's web app sends them (gen_fonts.py's TEXT_SET).
function* codes(charset) {
  for (const [first, last] of charset) for (let cp = first; cp <= last; cp++) yield cp;
}

// one face of `bytes` with only the board's characters, its kerning and the tables the board reads, at `weight` on
// a variable font's weight axis and every other axis at its default
async function subsetFace(bytes, { face = 0, weight = null, charset }) {
  const x = await harfbuzz();
  const at = x.malloc(bytes.length);
  new Uint8Array(x.memory.buffer).set(bytes, at);
  const blob = x.hb_blob_create(at, bytes.length, HB_MEMORY_MODE_READONLY, 0, 0);
  const hbFace = x.hb_face_create(blob, face);
  x.hb_blob_destroy(blob);
  const input = x.hb_subset_input_create_or_fail();
  try {
    if (!input) throw new Error('This font could not be cut down for the board.');
    const unicodes = x.hb_subset_input_unicode_set(input);
    for (const cp of codes(charset)) x.hb_set_add(unicodes, cp);
    const drop = x.hb_subset_input_set(input, HB_SUBSET_SETS_DROP_TABLE_TAG);
    for (const t of DROP) x.hb_set_add(drop, tagOf(t));
    const features = x.hb_subset_input_set(input, HB_SUBSET_SETS_LAYOUT_FEATURE_TAG);
    x.hb_set_clear(features);
    x.hb_set_add(features, tagOf('kern'));
    x.hb_subset_input_set_flags(input, HB_SUBSET_FLAGS_NO_HINTING | HB_SUBSET_FLAGS_NOTDEF_OUTLINE);
    if (tables(bytes, faceStarts(bytes)[face]).fvar) {
      x.hb_subset_input_pin_all_axes_to_default(input, hbFace);
      if (weight != null) x.hb_subset_input_pin_axis_location(input, hbFace, tagOf('wght'), weight);
    }
    const cut = x.hb_subset_or_fail(hbFace, input);
    if (!cut) throw new Error('This font could not be cut down for the board.');
    const outBlob = x.hb_face_reference_blob(cut);
    const length = x.hb_blob_get_length(outBlob);
    const lengthAt = x.malloc(4);
    const data = x.hb_blob_get_data(outBlob, lengthAt);
    const out = new Uint8Array(x.memory.buffer, data, length).slice();
    x.free(lengthAt);
    x.hb_blob_destroy(outBlob);
    x.hb_face_destroy(cut);
    return out;
  } finally {
    if (input) x.hb_subset_input_destroy(input);
    x.hb_face_destroy(hbFace);
    x.free(at);
  }
}

// -- writing fonts ------------------------------------------------------------------------------------------------

function checksum(data) {
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum = (sum + ((data[i] << 24) | ((data[i + 1] || 0) << 16) | ((data[i + 2] || 0) << 8) | (data[i + 3] || 0))) >>> 0;
  }
  return sum;
}

const pad4 = (n) => (n + 3) & ~3;

function putU16(b, at, v) { b[at] = (v >> 8) & 255; b[at + 1] = v & 255; }
function putU32(b, at, v) { b[at] = (v >>> 24) & 255; b[at + 1] = (v >>> 16) & 255; b[at + 2] = (v >>> 8) & 255; b[at + 3] = v & 255; }

// a name table with the family and style the board shows, in UTF-16 for Windows
function nameTable(family, style) {
  const records = [[1, family], [2, style], [4, `${family} ${style}`.trim()], [6, `${family}-${style}`.replace(/[^A-Za-z0-9-]/g, '')]];
  const strings = records.map(([, s]) => {
    const b = new Uint8Array(s.length * 2);
    for (let i = 0; i < s.length; i++) putU16(b, 2 * i, s.charCodeAt(i));
    return b;
  });
  const head = 6 + 12 * records.length;
  const out = new Uint8Array(head + strings.reduce((n, s) => n + s.length, 0));
  putU16(out, 2, records.length);
  putU16(out, 4, head);
  let at = 0;
  records.forEach(([id], i) => {
    const r = 6 + 12 * i;
    putU16(out, r, 3); putU16(out, r + 2, 1); putU16(out, r + 4, 0x409); putU16(out, r + 6, id);
    putU16(out, r + 8, strings[i].length); putU16(out, r + 10, at);
    out.set(strings[i], head + at);
    at += strings[i].length;
  });
  return out;
}

function readFont(bytes) {
  const all = tables(bytes, 0);
  return { version: u32(bytes, 0), tables: Object.keys(all).sort().map((tag) => ({ tag, data: all[tag] })) };
}

// fonts into one file: a lone font when there is one, else a collection + every table's checksum + head's adjustment
function writeFonts(fonts) {
  const collection = fonts.length > 1;
  const header = collection ? 12 + 4 * fonts.length : 0;
  const dirs = fonts.map((f) => 12 + 16 * f.tables.length);
  let at = header + dirs.reduce((n, d) => n + d, 0);
  const placed = fonts.map((f) => f.tables.map((t) => {
    const where = at;
    at += pad4(t.data.length);
    return where;
  }));
  const out = new Uint8Array(at);
  if (collection) {
    out.set([0x74, 0x74, 0x63, 0x66]);
    putU32(out, 4, 0x00010000);
    putU32(out, 8, fonts.length);
  }
  let dirAt = header;
  fonts.forEach((f, i) => {
    if (collection) putU32(out, 12 + 4 * i, dirAt);
    const n = f.tables.length;
    let pow = 1, log = 0;
    while (pow * 2 <= n) { pow *= 2; log++; }
    putU32(out, dirAt, f.version);
    putU16(out, dirAt + 4, n);
    putU16(out, dirAt + 6, pow * 16);
    putU16(out, dirAt + 8, log);
    putU16(out, dirAt + 10, n * 16 - pow * 16);
    f.tables.forEach((t, k) => {
      const data = t.tag === 'head' ? t.data.slice() : t.data;
      if (t.tag === 'head') putU32(data, 8, 0);
      const r = dirAt + 12 + 16 * k;
      for (let c = 0; c < 4; c++) out[r + c] = t.tag.charCodeAt(c);
      putU32(out, r + 4, checksum(data));
      putU32(out, r + 8, placed[i][k]);
      putU32(out, r + 12, t.data.length);
      out.set(data, placed[i][k]);
    });
    if (!collection) {
      const head = f.tables.findIndex((t) => t.tag === 'head');
      if (head >= 0) putU32(out, placed[i][head] + 8, (0xB1B0AFBA - checksum(out)) >>> 0);
    }
    dirAt += dirs[i];
  });
  return out;
}

function typeOf(bytes) {
  if (ascii(bytes, 0) === 'ttcf') return 'font/collection';
  return ascii(bytes, 0) === 'OTTO' ? 'font/otf' : 'font/ttf';
}

function fits(bytes) {
  if (bytes.length > MAX_BYTES) throw new Error('The font is too large for the board.');
  return bytes;
}

// A font someone brings, cut down for the board: one face of it, at `weight` when it has a weight axis.
export async function prepare(input, { face = 0, weight = null, charset }) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const faces = inspect(bytes).faces;
  if (face < 0 || face >= faces.length) throw new Error('Pick a face of this font.');
  const cut = readFont(await subsetFace(bytes, { face, weight, charset }));
  // its own name in the form the board reads: the cut keeps only some of a font's names
  const name = faces[face].name || 'Added font';
  cut.tables = cut.tables.map((t) => (t.tag === 'name' ? { tag: 'name', data: nameTable(name, faces[face].style) } : t));
  if (!cut.tables.some((t) => t.tag === 'name')) {
    cut.tables.push({ tag: 'name', data: nameTable(name, faces[face].style) });
    cut.tables.sort((a, b) => (a.tag < b.tag ? -1 : 1));
  }
  const single = fits(writeFonts([cut]));
  return { bytes: single, type: typeOf(single), name };
}

// -- the SF Pro download ---------------------------------------------------------------------------------------------

// where the faces come from and which face draws which kind of text, kept in sf-pro.json beside this module so a
// mirror that goes away is changed there alone
export async function sfProSource() {
  const response = await fetch(new URL('sf-pro.json', HERE));
  if (!response.ok) throw new Error('Could not download SF Pro.');
  return response.json();
}

// Apple's SF Pro faces fetched in this browser, cut down and put in one collection, a face for each kind of text.
// `progress` hears a number from 0 to 1 as the faces arrive.
export async function sfPro({ charset, progress = () => {}, source = null }) {
  const src = source || await sfProSource();
  const files = ROLES.map((role) => src.roles[role]);
  const unique = [...new Set(files)];
  let done = 0;
  const fetched = await Promise.all(unique.map(async (file) => {
    let response;
    try {
      response = await fetch(src.base + encodeURIComponent(file));
    } catch (error) {
      throw new Error('Could not download SF Pro.');
    }
    if (!response.ok) throw new Error('Could not download SF Pro.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    progress(++done / unique.length);
    return [file, bytes];
  }));
  const byFile = new Map(fetched);
  const faces = [];
  for (let r = 0; r < ROLES.length; r++) {
    const cut = readFont(await subsetFace(byFile.get(files[r]), { charset }));
    const style = (src.styles && src.styles[ROLES[r]]) || '';
    cut.tables = cut.tables.map((t) => (t.tag === 'name' ? { tag: 'name', data: nameTable(src.family || 'SF Pro', style) } : t));
    faces.push(cut);
  }
  const pack = fits(writeFonts(faces));
  return { bytes: pack, type: typeOf(pack), name: src.family || 'SF Pro', files };
}
