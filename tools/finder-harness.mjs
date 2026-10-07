// the shared test harness for /hi and /portal + js/finder.js run in node with a small stand in dom and fake timers
// + a scripted fetch and a stand in window open and storage and install events
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
export const script = read('js/finder.js');
export const API = 'https://api.mooboard.co';

export class El {
  constructor(tag, doc = null) {
    this.doc = doc;
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attrs = {};
    this.listeners = {};
    this.text = '';
    this.html = null;
    this.className = '';
    this.parent = null;
  }

  get textContent() {
    return this.text + this.children.map((c) => c.textContent).join('');
  }

  set textContent(v) {
    this.detach();
    this.html = null;
    this.text = String(v);
  }

  set innerHTML(v) {
    this.detach();
    this.text = '';
    this.html = String(v);
  }

  detach() {
    for (const c of this.children) c.parent = null;
    this.children = [];
  }

  get isConnected() {
    let e = this;
    while (e.parent) e = e.parent;
    return Boolean(e.root);
  }

  appendChild(child) {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  get parentNode() {
    return this.parent;
  }

  // ref is a child of this element as the dom asks + child goes in just before it
  insertBefore(child, ref) {
    const at = this.children.indexOf(ref);
    if (at < 0) throw new Error('insertBefore: the reference is not a child');
    child.parent = this;
    this.children.splice(at, 0, child);
    return child;
  }

  removeChild(child) {
    const at = this.children.indexOf(child);
    if (at < 0) throw new Error('removeChild: not a child');
    this.children.splice(at, 1);
    child.parent = null;
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

  focus() {
    if (this.doc) this.doc.active = this;
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

export const json = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });

// a tab window open hands back + it remembers where it was sent and whether it was closed
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

// each eye's middle three by three dots row by row, by their place round its centre + '' is the centre, the brand mark's pupil
const EYE_PLACES = ['nw', 'n', 'ne', 'w', '', 'e', 'sw', 's', 'se'];
// the dots a pupil lights as eyes() lists them + the board's plus and the x where something went wrong
export const PLUS = ['n', 'w', 'c', 'e', 's'];
export const CROSS = ['nw', 'ne', 'c', 'sw', 'se'];

export const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
export const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
// an ipad's safari asks for the desktop site so it says macintosh as a mac does + its touch points tell them apart
export const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15';

// loads js/finder.js at pathname with answer as the network + page picks the markup of hi or portal
// + popups false is a popup blocker + storage seeds local storage or blocked makes it throw
// + the ua and standalone options are the browser it runs in + abort false leaves out abort controller
// + reducedMotion is a phone that asks for less motion + search is the address query as ?install=1
// + touchPoints 0 with the ipad ua is a mac
export function load(pathname, answer = () => new Promise(() => {}), opts = {}) {
  const { popups = true, page: kind = 'hi', storage = {}, ua = ANDROID, standalone = false, displayStandalone = false, abort = true,
    reducedMotion = false, search = '', touchPoints = 5 } = opts;
  const view = new El('div');
  const top = new El('div');
  const hero = new El('div');
  const head = new El('head');
  const install = new El('div');
  const lead = new El('div');
  for (const root of [view, top, hero, head, install, lead]) root.root = true;
  top.className = 'top';
  hero.className = 'hero';
  install.className = 'install';
  lead.className = 'lead';
  // both pages show the brand mark + the middle dots of each eye are the ones its pupils light + as in the markup the
  // centre (pl, pr) has the pupil's ink and the dots round it no fill of their own, so their group's white
  const pupils = {};
  for (const eye of ['pl', 'pr']) {
    for (const place of EYE_PLACES) {
      const dot = new El('circle');
      if (!place) dot.setAttribute('fill', '#0E1A22');
      pupils[place ? `${eye}-${place}` : eye] = dot;
    }
  }
  const ids = { view, top, hero, ...pupils };
  if (kind === 'portal') Object.assign(ids, { install, lead });
  const roots = [top, view, hero, install, lead];
  const byId = (id) => ids[id] ?? roots.flatMap((r) => r.all()).find((e) => e.attrs && e.attrs.id === id) ?? null;
  // a fake js/board.js + it records each board the page asks it to draw
  const made = [];
  function Board(el, o) {
    made.push({ el, opts: o });
  }
  const timers = fakeTimers();
  const replaced = [];
  const assigned = [];
  const fetches = [];
  const opened = [];
  const registered = [];
  const addresses = [];   // each address the page put in the bar with history replace state
  const winListeners = {};
  const store = new Map(Object.entries(storage === 'blocked' ? {} : storage));
  // what has focus and who listens for keys
  const doc = { active: null, keydown: [] };
  const context = {
    document: {
      getElementById: byId,
      createElement: (tag) => new El(tag, doc),
      createElementNS: (ns, tag) => Object.assign(new El(tag, doc), { ns }),
      createTextNode: (text) => new Text(text),
      head,
      addEventListener: (type, fn) => type === 'keydown' && doc.keydown.push(fn),
      removeEventListener: (type, fn) => {
        if (type === 'keydown') doc.keydown = doc.keydown.filter((f) => f !== fn);
      },
    },
    location: {
      pathname,
      search,
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
      addEventListener: (type, fn) => {
        (winListeners[type] ||= []).push(fn);
      },
      matchMedia: (q) => ({
        matches: (/display-mode:\s*standalone/.test(q) && displayStandalone) || (/prefers-reduced-motion:\s*reduce/.test(q) && reducedMotion),
      }),
      history: {
        replaceState: (state, title, url) => addresses.push(url),
      },
    },
    navigator: {
      userAgent: ua,
      platform: ua === IPHONE ? 'iPhone' : ua === IPAD ? 'MacIntel' : 'Linux armv8l',
      maxTouchPoints: touchPoints,
      standalone: ua === IPHONE || ua === IPAD ? standalone : undefined,
      serviceWorker: {
        register: (url, o) => {
          registered.push({ url, opts: o });
          return Promise.resolve({});
        },
      },
    },
    fetch: (url, o) => {
      fetches.push({ url, opts: o });
      return Promise.resolve().then(() => answer(url, o));
    },
    ...(abort ? { AbortController } : {}),
    Math,
    JSON,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
  };
  if (storage === 'blocked') {
    Object.defineProperty(context, 'localStorage', { get() { throw new Error('SecurityError'); } });
  } else {
    context.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    };
  }
  vm.createContext(context);
  vm.runInContext(script, context);
  const page = {
    view,
    top,
    hero,
    install,
    lead,
    addresses,
    made,
    store,
    registered,
    pupils,
    timers,
    replaced,
    assigned,
    fetches,
    opened,
    settle: async () => {
      for (let i = 0; i < 20; i += 1) await new Promise((r) => setImmediate(r));
    },
    // a window event as the browser sends it
    fire: (type, event = {}) => {
      for (const fn of winListeners[type] || []) fn(event);
    },
    // a key pressed anywhere as the browser sends it
    key: (key) => {
      for (const fn of [...doc.keydown]) fn({ key });
    },
    focused: () => doc.active,
    text: () => view.textContent,
    h1: () => view.all().find((e) => e.tagName === 'H1')?.textContent,
    find: (pred) => view.all().find(pred),
    buttons: () => view.all().filter((e) => e.tagName === 'BUTTON'),
    cards: () => view.all().filter((e) => e.className === 'card'),
    idents: () => view.all().filter((e) => e.className === 'ident'),
    setup: () => view.all().find((e) => e.className === 'setup'),
    links: () => view.all().filter((e) => e.tagName === 'A' && e.className !== 'ident').map((a) => [a.textContent, a.getAttribute('href')]),
    scripts: () => head.children.filter((e) => e.tagName === 'SCRIPT').map((e) => e.src),
    frames: (root) => root.all().filter((e) => e.className === 'bezel').map((e) => e.getAttribute('data-frame')),
    // each eye's pupil: the dots it lights as PLUS and CROSS list them (c the centre) and their colours + the rest are white
    eyes: () => ['pl', 'pr'].map((eye) => {
      const fill = (place) => pupils[place ? `${eye}-${place}` : eye].getAttribute('fill');
      const lit = EYE_PLACES.filter((place) => fill(place) !== null && fill(place) !== '#FFFFFF');
      return { lit: lit.map((place) => place || 'c'), colours: [...new Set(lit.map(fill))] };
    }),
    // the loading line's dots
    dots: () => view.all().find((e) => e.className === 'dots'),
    // js/board.js arrives + mark false is an older copy without the mark scene
    boardJs: ({ mark = true } = {}) => {
      context.window.MooBoard = { Board, scenes: mark ? { mark() {}, moo() {} } : { moo() {} } };
      for (const e of head.children) if (e.onload) e.onload();
    },
    boardJsFails: () => {
      for (const e of head.children) if (e.onerror) e.onerror();
    },
  };
  return page;
}

export const nearbyOf = (boards, shared = false) => (url) => {
  if (url === `${API}/nearby`) return json({ boards, shared });
  throw new Error(`unexpected ${url}`);
};
export const KITCHEN = { code: '5KAS', name: 'Kitchen', localIp: '192.168.0.110', version: '1.4.0', lastSeen: 1 };
export const BEDROOM = { code: 'T8QP', name: 'bedroom', localIp: '192.168.0.111', version: '1.4.0', lastSeen: 1 };
export const SHARED = [
  { code: '5KAS', name: 'Kitchen', version: '1.4.0', lastSeen: 1 },
  { code: 'T8QP', name: 'Kitchen', version: '1.4.0', lastSeen: 1 },
];
export const sharedNet = (lookup) => (url) => {
  if (url === `${API}/nearby`) return json({ boards: SHARED, shared: true });
  if (url === `${API}/lookup/T8QP`) return lookup();
  throw new Error(`unexpected ${url}`);
};
export const FOUND = () => json({ found: true, localIp: '192.168.0.120', name: 'Kitchen' });
