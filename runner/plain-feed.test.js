import assert from 'node:assert/strict';

function makeEl(tag) {
  const el = {
    tag,
    children: [],
    parentNode: null,
    dataset: {},
    style: {},
    hidden: false,
    scrollTop: 0,
    scrollHeight: 1000,
    clientHeight: 500,
    _text: '',
    _classes: new Set(),
    classList: {
      add: (...names) => names.forEach((name) => el._classes.add(name)),
      contains: (name) => el._classes.has(name),
    },
    set className(value) {
      el._className = String(value);
      el._classes = new Set(String(value).split(/\s+/).filter(Boolean));
    },
    get className() { return el._className || ''; },
    appendChild(child) { child.parentNode = el; el.children.push(child); return child; },
    addEventListener() {},
    setAttribute(name, value) { el[name] = String(value); },
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
  getElementById: (id) => id === 'plain' ? root : null,
  createElement: (tag) => makeEl(tag),
  createElementNS: (_ns, tag) => makeEl(tag),
  createTextNode: (text) => ({ textContent: String(text), parentNode: null }),
};
globalThis.window = {};

await import('../public/assets/plain.js');
const plain = window.__cyPlain;
plain.beginDay('2026-09-09', '2026-09-10');
plain.handle({ kind: 'text', ts: '2026-09-09 20:15:45', payload: { mode: 'journal', s: 'a thought' } }, true);
plain.handle({ kind: 'gen', ts: '2026-09-09 20:20:48', payload: { mode: 'journal' } }, true);

const col = window.__CY_PLAIN__.col();
const writing = col.children[1];
assert.ok(writing.children[0]._classes.has('pl-meta-start'), 'plain writing shows its start endpoint');
assert.ok(writing.children[2]._classes.has('pl-meta-end'), 'plain writing shows its end endpoint');
assert.match(writing.children[0].children[0].textContent, /^20:15:45 \(/);
assert.match(writing.children[2].children[0].textContent, /^20:20:48 \(/);

plain.handle({ kind: 'silence', ts: '2026-09-09 20:25:48', payload: { seconds: 300 } }, true);
const silence = col.children[2];
assert.equal(silence.children.length, 3, 'a silence span has a start, label, and end');
assert.match(silence.children[0].children[0].textContent, /^20:20:48 \(/);
assert.match(silence.children[2].children[0].textContent, /^20:25:48 \(/);

plain.handle({ kind: 'event', ts: '2026-09-09 20:30:00', payload: { name: 'cell_search' } }, true);
const point = col.children[3];
assert.ok(point.children[0]._classes.has('pl-meta-point'), 'a point event has one timestamp endpoint');

console.log('plain-feed.test.js: all checks passed');
