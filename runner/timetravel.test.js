import assert from 'node:assert/strict';

function makeEl(tag) {
  const listeners = new Map();
  const el = {
    tag,
    children: [],
    parentNode: null,
    parentElement: null,
    dataset: {},
    style: {},
    disabled: false,
    hidden: false,
    open: false,
    _text: '',
    _classes: new Set(),
    classList: {
      add: (...names) => names.forEach((name) => el._classes.add(name)),
      remove: (...names) => names.forEach((name) => el._classes.delete(name)),
      contains: (name) => el._classes.has(name),
    },
    set className(value) {
      el._className = String(value);
      el._classes = new Set(String(value).split(/\s+/).filter(Boolean));
    },
    get className() { return el._className || ''; },
    appendChild(child) {
      child.parentNode = el;
      child.parentElement = el;
      el.children.push(child);
      return child;
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    dispatchEvent(event) {
      event.target ||= el;
      for (const fn of listeners.get(event.type) || []) fn(event);
      if (event.bubbles && el.parentNode && el.parentNode.dispatchEvent) el.parentNode.dispatchEvent(event);
      return true;
    },
    setAttribute(name, value) { el[name] = String(value); },
    getAttribute(name) { return el[name] == null ? null : String(el[name]); },
    showModal() { el.open = true; },
    close() { el.open = false; el.dispatchEvent({ type: 'close', bubbles: false }); },
    focus() {},
    set textContent(value) {
      el._text = String(value);
      if (value === '') el.children = [];
    },
    get textContent() { return el._text; },
  };
  return el;
}

const documentListeners = new Map();
const documentBody = makeEl('body');
documentBody.dataset.test = '1';
globalThis.document = {
  body: documentBody,
  activeElement: null,
  createElement: (tag) => makeEl(tag),
  createElementNS: (_ns, tag) => makeEl(tag),
  createTextNode: (text) => ({ textContent: String(text), parentNode: null, parentElement: null }),
  addEventListener(type, fn) {
    if (!documentListeners.has(type)) documentListeners.set(type, []);
    documentListeners.get(type).push(fn);
  },
  dispatchEvent(event) {
    for (const fn of documentListeners.get(event.type) || []) fn(event);
    return true;
  },
};
documentBody.parentNode = globalThis.document;
globalThis.window = {
  CY: { today: '2026-09-10', day: 41, history: '/history' },
};
globalThis.CustomEvent = class CustomEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.detail = options.detail;
    this.bubbles = !!options.bubbles;
  }
};
globalThis.fetch = async () => ({
  json: async () => ({
    ok: true,
    moods: { tense: '#aa5533' },
    days: [{ date: '2026-08-01', chars: 20, mood: { dominant: 'tense', tint: '#aa5533' }, markers: {} }],
  }),
});

await import('../public/assets/timetravel.js');
await window.__CY_TT__.load();
await window.__CY_TT__.open('2026-09-10');

function findByClass(root, name) {
  if (root.classList && root.classList.contains(name)) return root;
  for (const child of root.children || []) {
    const found = findByClass(child, name);
    if (found) return found;
  }
  return null;
}

const month = findByClass(documentBody, 'tt-month');
const grid = findByClass(documentBody, 'tt-grid');
assert.equal(month.textContent, 'September 2026', 'the chooser can show today even when rollups end in August');
window.__CY_TT__.stepMonth(-1);
assert.equal(month.textContent, 'August 2026', 'previous-month navigation is not capped by a stale rollup month');
window.__CY_TT__.stepMonth(1);
assert.equal(month.textContent, 'September 2026', 'next-month navigation returns to the current month');
const sep9 = grid.children.find((cell) => cell.children[0] && cell.children[0].textContent === '9');
const sep10 = grid.children.find((cell) => cell.children[0] && cell.children[0].textContent === '10');
assert.ok(sep9.classList.contains('is-unindexed'), 'a raw date after the rollup watermark remains selectable');
assert.equal(sep9.disabled, false);
assert.ok(sep10.classList.contains('is-selected'), 'the currently viewed date is highlighted');
assert.match(sep10.getAttribute('aria-label'), /return to live/, 'today is described as the route back to live');

window.__CY_TT__.setToday('2026-09-11');
const sep11 = grid.children.find((cell) => cell.children[0] && cell.children[0].textContent === '11');
assert.ok(sep11.classList.contains('is-today'), 'the chooser follows a live midnight rollover without reload');

let selections = 0;
document.addEventListener('cy:moment', () => { selections++; });
window.__CY_TT__.confirmDay('2026-09-09');
assert.equal(selections, 1, 'a selected day emits exactly once');

console.log('timetravel.test.js: all checks passed');
