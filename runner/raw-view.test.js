import assert from 'node:assert/strict';

function makeEl(tag) {
  const el = {
    tag,
    children: [],
    parentNode: null,
    dataset: {},
    style: {},
    hidden: false,
    disabled: false,
    scrollTop: 0,
    scrollHeight: 1000,
    clientHeight: 500,
    _text: '',
    _classes: new Set(),
    _listeners: {},
    classList: {
      add: (...names) => names.forEach((name) => el._classes.add(name)),
      remove: (...names) => names.forEach((name) => el._classes.delete(name)),
      toggle: (name, on) => {
        if (on === undefined) on = !el._classes.has(name);
        if (on) el._classes.add(name);
        else el._classes.delete(name);
        return on;
      },
      contains: (name) => el._classes.has(name),
    },
    set className(value) {
      el._className = String(value);
      el._classes = new Set(String(value).split(/\s+/).filter(Boolean));
    },
    get className() { return el._className || ''; },
    get firstChild() { return el.children[0] || null; },
    appendChild(child) { child.parentNode = el; el.children.push(child); return child; },
    append(...children) { children.forEach((child) => el.appendChild(child)); },
    insertBefore(child, before) {
      child.parentNode = el;
      const index = el.children.indexOf(before);
      if (index < 0) el.children.push(child);
      else el.children.splice(index, 0, child);
      return child;
    },
    removeChild(child) {
      const index = el.children.indexOf(child);
      if (index >= 0) el.children.splice(index, 1);
      child.parentNode = null;
      return child;
    },
    addEventListener(type, fn) { (el._listeners[type] ||= []).push(fn); },
    dispatchEvent(event) { for (const fn of el._listeners[event.type] || []) fn(event); },
    setAttribute(name, value) { el[name] = String(value); },
    querySelectorAll(selector) {
      const found = [];
      const visit = (node) => {
        for (const child of node.children || []) {
          const isRl = child._classes && child._classes.has('rl');
          const match = selector === '.rl'
            ? isRl
            : selector === '.rl:not(.filtered)'
              ? isRl && !child._classes.has('filtered')
              : selector === '.raw-chip'
                ? child._classes && child._classes.has('raw-chip')
                : false;
          if (match) found.push(child);
          visit(child);
        }
      };
      visit(el);
      return found;
    },
    querySelector(selector) { return el.querySelectorAll(selector)[0] || null; },
    set textContent(value) {
      el._text = String(value);
      if (value === '') el.children = [];
    },
    get textContent() { return el._text; },
  };
  return el;
}

const root = makeEl('div');
const body = makeEl('body');
body.dataset.test = '1';

globalThis.document = {
  body,
  querySelector: (selector) => selector === '#raw' ? root : null,
  createElement: (tag) => makeEl(tag),
};
globalThis.window = {
  CY: { raw: true, stream: '/stream', range: '/range' },
};

const requests = [];
globalThis.fetch = async (url) => {
  requests.push(String(url));
  if (String(url).startsWith('/range')) {
    return {
      ok: true,
      json: async () => ({
        events: [
          { seq: 996, ts: '2026-09-10 10:00:00', kind: 'event', payload: { name: 'meal_breakfast' } },
          { seq: 997, ts: '2026-09-10 10:01:00', kind: 'silence', payload: { seconds: 60 } },
        ],
        cursors: { has_more_backward: true },
      }),
    };
  }
  return {
    ok: true,
    json: async () => ({
      now: 1000,
      events: [
        { seq: 998, ts: '2026-09-10 10:02:00', kind: 'text', payload: { s: 'token' } },
        { seq: 999, ts: '2026-09-10 10:02:01', kind: 'gen', payload: { mode: 'journal' } },
        { seq: 1000, ts: '2026-09-10 10:02:02', kind: 'event', payload: { name: 'association' } },
      ],
    }),
  };
};
globalThis.setInterval = () => 1;
globalThis.clearInterval = () => {};

await import('../public/assets/raw.js');
const raw = window.__CY_RAW__;
assert.equal(requests.length, 0, 'closed diagnostics performs no feed request');

window.__cyRaw.start();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(requests[0], '/stream?since=-100&limit=100', 'opening diagnostics requests only a small recent window');
assert.equal(raw.rowCount(), 3, 'only the bounded recent response is rendered');
assert.ok(raw.log().children[0]._classes.has('filtered'), 'high-volume text tokens are hidden by default');
assert.equal(raw.olderBtn().disabled, false, 'older diagnostics are available explicitly');

raw.olderBtn().dispatchEvent({ type: 'click' });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(requests[1], '/range?before=998&limit=100', 'older diagnostics load only after the operator asks');
assert.deepEqual(raw.kinds().slice(0, 2), ['event', 'silence'], 'older records prepend in chronological order');
assert.match(raw.cap(), /older records load only when requested/);

window.__cyRaw.stop();
console.log('raw-view.test.js: all checks passed');
