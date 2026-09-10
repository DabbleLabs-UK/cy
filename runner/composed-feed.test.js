import assert from 'node:assert/strict';

function makeEl(tag) {
  const el = {
    tag,
    children: [],
    parentNode: null,
    dataset: {},
    style: {},
    _text: '',
    _classes: new Set(),
    scrollTop: 0,
    scrollHeight: 1000,
    clientHeight: 500,
    classList: {
      add: (c) => el._classes.add(c),
      remove: (c) => el._classes.delete(c),
      toggle: (c, on) => (on ? el._classes.add(c) : el._classes.delete(c)),
      contains: (c) => el._classes.has(c),
    },
    set className(v) { el._className = String(v); el._classes = new Set(String(v).split(/\s+/).filter(Boolean)); },
    get className() { return el._className || ''; },
    appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
    addEventListener() {},
    setAttribute(name, value) { el[name] = String(value); },
    set textContent(v) { el._text = String(v); if (v === '') el.children = []; },
    get textContent() { return el._text; },
  };
  return el;
}

globalThis.document = {
  createElement: (tag) => makeEl(tag),
};

const { ComposedFeed } = await import('../public/assets/composed-feed.js');
const root = makeEl('div');
const feed = new ComposedFeed(root, { chars: [] });

feed.setInstant(true);
for (let i = 0; i < 4130; i++) {
  feed.beginEntry('2026-09-09 12:00:00', 'journal');
  feed.write('x'.repeat(160), 'journal');
  feed.closeEntry();
}

assert.equal(feed.pens.length, 0, 'high-volume history creates no SVG Pen instances');
assert.equal(feed.flow.children.length, 4130, 'every historical writing period remains present');
assert.ok(feed.flow.children.every((block) => block.children[1]._classes.has('cy-writing-static')));
assert.equal(feed.flow.children[0].children[1].textContent.length, 160);

feed.beginEntry('2026-09-09 12:01:00', 'journal');
feed.write('historical tail', 'journal');
assert.ok(feed.current && feed.current.static, 'replay tail is lightweight text');
feed.setInstant(false);
assert.equal(feed.current, null, 'switching to live closes the historical segment');

const chronologyRoot = makeEl('div');
const chronology = new ComposedFeed(chronologyRoot, { chars: [] });
chronology.setInstant(true);
chronology.beginEntry('2026-09-09 10:00:00', 'journal');
chronology.write('before search', 'journal');
chronology.event('the cell is searched', '', '2026-09-09 10:15:00', 'prison');
chronology.beginEntry('2026-09-09 10:20:00', 'journal');
chronology.write('after search', 'journal');

assert.equal(chronology.flow.children.length, 3, 'ambient events remain between surrounding writing periods');
assert.equal(chronology.flow.children[1].dataset.kind, 'prison');
assert.equal(chronology.flow.children[1].children[1].textContent, '[the cell is searched]');

const spanRoot = makeEl('div');
const spans = new ComposedFeed(spanRoot, { chars: [] });
spans.setInstant(true);
spans.beginDay('2026-09-09', '2026-09-10');
spans.beginEntry('2026-09-09 20:15:45', 'journal');
spans.write('one bounded thought', 'journal');
spans.closeEntry('2026-09-09 20:20:48');
const entry = spans.flow.children[1];
assert.ok(entry.children[0]._classes.has('cy-moment-start'), 'writing shows its start endpoint');
assert.ok(entry.children[2]._classes.has('cy-moment-end'), 'writing shows its end endpoint');
assert.match(entry.children[0].children[0].textContent, /^20:15:45 \(/);
assert.match(entry.children[2].children[0].textContent, /^20:20:48 \(/);
assert.equal(spans.flow.children[0].children.length, 3, 'day banner exposes previous, chooser, and next controls');

console.log('composed-feed.test.js: all checks passed');
