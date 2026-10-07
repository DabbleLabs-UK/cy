import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
    removeChild(child) { const i = el.children.indexOf(child); if (i >= 0) el.children.splice(i, 1); return child; },
    get firstChild() { return el.children[0] || null; },
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
plain.beginDay('2026-09-08', '2026-09-10');
plain.handle({ kind: 'text', ts: '2026-09-08 20:15:45', payload: { mode: 'journal', s: 'a thought' } }, true);
plain.handle({ kind: 'gen', ts: '2026-09-08 20:20:48', payload: { mode: 'journal' } }, true);

const col = window.__CY_PLAIN__.col();
assert.equal(col.children[0].children[2].children[1].textContent, 'Live now', 'plain history has a direct live escape');
const writing = col.children[1];
assert.ok(writing.children[0]._classes.has('pl-meta-start'), 'plain writing shows its start endpoint');
assert.ok(writing.children[2]._classes.has('pl-meta-end'), 'plain writing shows its end endpoint');
assert.match(writing.children[0].children[0].textContent, /^20:15:45 \(/);
assert.match(writing.children[2].children[0].textContent, /^20:20:48 \(/);

plain.handle({ kind: 'silence', ts: '2026-09-08 20:25:48', payload: { seconds: 300 } }, true);
const silence = col.children[2];
assert.equal(silence.children.length, 3, 'a silence span has a start, label, and end');
assert.match(silence.children[0].children[0].textContent, /^20:20:48 \(/);
assert.match(silence.children[2].children[0].textContent, /^20:25:48 \(/);

plain.handle({ kind: 'event', ts: '2026-09-08 20:30:00', payload: { name: 'cell_search' } }, true);
const point = col.children[3];
assert.ok(point.children[0]._classes.has('pl-meta-point'), 'a point event has one timestamp endpoint');

plain.handle({
  kind: 'dream', ts: '2026-09-08 23:17:00', payload: {
    id: 'dream-event-1', sleep_period_id: 'sleep-1', state: 'DREAMING',
    fragments: ['door will not fit the frame', 'proctor with no face'],
  },
}, true);
const dream = col.children[4];
assert.ok(dream._classes.has('pl-block-dream'), 'plain view uses a distinct dream block');
assert.equal(dream.children[1].children[1].children.length, 2, 'plain view preserves fragment boundaries');
assert.equal(dream.children[1].children[1].children[0].textContent, 'door will not fit the frame');

plain.handle({
  kind: 'draw', ts: '2026-09-08 23:18:00', payload: {
    id: 'dream-drawing-1', dream: true, dream_id: 'sleep-1', sleep_period_id: 'sleep-1',
    strokes: [{ t: 'C', x: 50, y: 50, r: 12 }], seq: 0, total: 1,
  },
}, true);
assert.equal(col.children.length, 5, 'plain dream drawing integrates into the same block');
assert.equal(dream.children[1].children[0].children.length, 1, 'plain dream field owns the drawing SVG');

for (const bootstrap of [true, false]) {
  for (const boundary of [
    { kind: 'postcard_in', payload: { from: 'Reader', body: 'a postcard between dreams' }, blockKind: 'postcard-in' },
    { kind: 'event', payload: { name: 'cell_search' }, blockKind: 'event' },
  ]) {
    plain.reset();
    plain.beginDay('2026-09-08', '2026-09-08');
    const context = `${bootstrap ? 'historical' : 'live'} ${boundary.kind} boundary`;
    const emitDream = (id, fragment, ts) => plain.handle({
      kind: 'dream', ts, payload: { id, sleep_period_id: 'one-sleep', fragments: [fragment] },
    }, bootstrap);
    const emitStroke = (seq, x, ts) => plain.handle({
      kind: 'draw', ts, payload: {
        id: 'one-drawing', dream: true, sleep_period_id: 'one-sleep',
        strokes: [{ t: 'C', x, y: 50, r: 5 }], seq, total: 4,
      },
    }, bootstrap);
    const svgFor = (block) => block.children[1].children[0].children[0];
    const fragmentsFor = (block) => block.children[1].children[1].children.map((fragment) => fragment.textContent);
    const snapshotSvg = (svg) => ({ viewBox: svg.viewBox, paths: svg.children.map((path) => path.d) });

    emitDream('before-boundary', 'the first fragment', '2026-09-08 23:10:00');
    emitStroke(0, 15, '2026-09-08 23:11:00');
    emitStroke(1, 30, '2026-09-08 23:12:00');
    assert.equal(col.children.length, 2, `${context}: contiguous dream events share one field`);
    const firstDream = col.children[1];
    const firstSvg = svgFor(firstDream);
    assert.equal(firstSvg.children.length, 2, `${context}: contiguous drawing chunks accumulate`);
    const firstSnapshot = snapshotSvg(firstSvg);

    plain.handle({ kind: boundary.kind, payload: boundary.payload, ts: '2026-09-08 23:13:00' }, bootstrap);
    const boundaryBlock = col.children[2];
    emitDream('after-boundary', 'the second fragment', '2026-09-08 23:14:00');
    emitStroke(2, 65, '2026-09-08 23:15:00');
    emitStroke(3, 80, '2026-09-08 23:16:00');
    const secondDream = col.children[3];

    assert.deepEqual(col.children.slice(1).map((block) => block.dataset.kind),
      ['dream', boundary.blockKind, 'dream'], `${context}: dream segments preserve event order without duplicates`);
    assert.equal(col.children[1], firstDream, `${context}: the first dream stays in place`);
    assert.equal(col.children[2], boundaryBlock, `${context}: the boundary event stays in place`);
    assert.deepEqual(fragmentsFor(firstDream), ['the first fragment'], `${context}: earlier fragments remain frozen`);
    assert.deepEqual(fragmentsFor(secondDream), ['the second fragment'], `${context}: later fragments stay after the boundary`);
    assert.equal(svgFor(firstDream), firstSvg, `${context}: earlier drawing keeps its original SVG`);
    assert.deepEqual(snapshotSvg(firstSvg), firstSnapshot, `${context}: later strokes cannot redraw the earlier segment`);
    const secondSvg = svgFor(secondDream);
    assert.ok(secondSvg && secondSvg !== firstSvg, `${context}: later strokes have their own drawing SVG`);
    assert.equal(secondSvg.children.length, 2, `${context}: the later drawing contains only its own stroke chunks`);
    const allPaths = [...firstSvg.children, ...secondSvg.children].map((path) => path.d);
    assert.equal(new Set(allPaths).size, 4, `${context}: each distinct stroke appears exactly once`);
    assert.match(secondDream.children[0].children[0].textContent, /^23:14:00 \(/,
      `${context}: the new dream segment starts at its own event time`);
  }
}

plain.reset();
plain.beginDay('2026-09-09', '2026-09-09');
plain.handle({ kind: 'event', ts: '2026-09-09 19:00:00', payload: { name: 'no_eggs' } }, true);
plain.handle({ kind: 'event', ts: '2026-09-09 19:02:00', payload: { name: 'cold_tea' } }, true);
assert.equal(col.children.length, 2, 'plain view also groups a short ambient run');
assert.equal(col.children[1].tag, 'details');
assert.equal(col.children[1].children[1].children.length, 2);
plain.handle({ kind: 'text', ts: '2026-09-09 19:03:00', payload: { mode: 'journal', s: 'my own thought' } }, true);
assert.equal(col.children[2]._classes.has('pl-block-text'), true, 'plain journal remains standalone');

const realSearches = JSON.parse(readFileSync(new URL('./fixtures/chronology-searches-2026-10-01.json', import.meta.url)));
plain.reset();
plain.beginDay('2026-10-01', '2026-10-01');
for (const event of realSearches) plain.handle(event, true);
assert.deepEqual(col.children.slice(1).map((group) => group.children[1].children.length), [10, 9],
  'the real public search records form two separate plain-view groups');
plain.handle({ kind: 'text', ts: '2026-10-01 23:49:11', payload: { mode: 'journal', s: 'a thought' } }, true);
assert.equal(col.children[3]._classes.has('pl-block-text'), true, 'journal after the real searches stays standalone');
plain.reset();
plain.beginDay('2026-10-01', '2026-10-01');
plain.handle(realSearches[7], true);
assert.equal(col.children[1].children.length, 2,
  'a standalone plain-view search step does not repeat its own title as detail');

console.log('plain-feed.test.js: all checks passed');
