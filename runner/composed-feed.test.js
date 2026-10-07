import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ambientEventLabel, refreshEndpointTimes, timestampMs } from '../public/assets/timeline.js';

function makeEl(tag) {
  const el = {
    tag,
    children: [],
    parentNode: null,
    dataset: {},
    style: { setProperty(name, value) { this[name] = String(value); } },
    _text: '',
    _classes: new Set(),
    _listeners: {},
    scrollTop: 0,
    scrollHeight: 1000,
    clientHeight: 500,
    getBoundingClientRect() { return { width: 500, height: 500 }; },
    classList: {
      add: (c) => el._classes.add(c),
      remove: (c) => el._classes.delete(c),
      toggle: (c, on) => (on ? el._classes.add(c) : el._classes.delete(c)),
      contains: (c) => el._classes.has(c),
    },
    set className(v) { el._className = String(v); el._classes = new Set(String(v).split(/\s+/).filter(Boolean)); },
    get className() { return el._className || ''; },
    appendChild(c) {
      if (c.parentNode) c.parentNode.removeChild(c);
      c.parentNode = el;
      el.children.push(c);
      return c;
    },
    removeChild(c) {
      const i = el.children.indexOf(c);
      if (i >= 0) { el.children.splice(i, 1); c.parentNode = null; }
      return c;
    },
    get firstChild() { return el.children[0] || null; },
    get lastElementChild() { return el.children[el.children.length - 1] || null; },
    remove() { if (el.parentNode) el.parentNode.removeChild(el); },
    addEventListener(type, fn) { (el._listeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) { el._listeners[type] = (el._listeners[type] || []).filter((listener) => listener !== fn); },
    dispatchEvent(event) { for (const fn of el._listeners[event.type] || []) fn(event); },
    setAttribute(name, value) { el[name] = String(value); },
    getAttribute(name) { return el[name] ?? null; },
    removeAttribute(name) { delete el[name]; },
    hasAttribute(name) { return name in el; },
    querySelectorAll() { return []; },
    set textContent(v) {
      el._text = String(v);
      for (const child of el.children) child.parentNode = null;
      el.children = [];
    },
    get textContent() { return el._text; },
  };
  return el;
}

globalThis.document = {
  createElement: (tag) => makeEl(tag),
  createElementNS: (_ns, tag) => makeEl(tag),
  createTextNode: (value) => { const node = makeEl('#text'); node.textContent = value; return node; },
  addEventListener() {},
  removeEventListener() {},
};
globalThis.window = { addEventListener() {}, removeEventListener() {}, getSelection: () => null };

const { ComposedFeed, HandwritingLane } = await import('../public/assets/composed-feed.js');
const { Postcards } = await import('../public/assets/postcard.js');

const lane = new HandwritingLane();
let releaseFirst;
const firstIdle = new Promise((resolve) => { releaseFirst = resolve; });
const firstPen = {
  gate: null,
  waitFor(gate) { this.gate = gate; },
  whenIdle() { return firstIdle; },
};
const secondPen = {
  gate: null,
  waitFor(gate) { this.gate = gate; },
  whenIdle() { return Promise.resolve(); },
};
const finishFirst = lane.begin(firstPen);
finishFirst();
const finishSecond = lane.begin(secondPen);
let secondStarted = false;
secondPen.gate.then(() => { secondStarted = true; });
await Promise.resolve();
assert.equal(secondStarted, false, 'a later physical pen waits while the first is active');
releaseFirst();
await secondPen.gate;
assert.equal(secondStarted, true, 'the later physical pen starts when the first becomes idle');
finishSecond();
await lane.whenIdle();

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
assert.ok(feed.flow.children.every((block) => block._classes.has('cy-journal-entry')), 'journal entries alone receive the ruled-card class');
assert.equal(feed.flow.children[0].children[1].textContent.length, 160);

feed.beginEntry('2026-09-09 12:01:00', 'journal');
feed.write('historical tail', 'journal');
assert.ok(feed.current && feed.current.static, 'replay tail is lightweight text');
feed.setInstant(false);
assert.equal(feed.current, null, 'switching to live closes the historical segment');

const fallbackRoot = makeEl('div');
const fallbackFeed = new ComposedFeed(fallbackRoot, { chars: [] });
fallbackFeed.setInstant(true);
fallbackFeed.write('continuing after replay', 'journal', false, false, '2026-09-10 18:32:28.843');
const fallbackEntry = fallbackFeed.flow.children[0];
assert.match(
  fallbackEntry.children[0].children[0].textContent,
  /^18:32:28 \(/,
  'an internally recreated writing card inherits the triggering token time',
);
assert.notEqual(
  fallbackEntry.children[0].children[0].textContent,
  '--:--:--',
  'a timestamped token never creates an undated writing endpoint',
);

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
assert.match(chronology.flow.children[1].children[0].children[0].textContent, /^10:15:00 \(/,
  'standalone public event retains its elapsed age');
assert.equal(chronology.flow.children[1]._classes.has('cy-journal-entry'), false, 'event records never receive journal paper');

const groupedRoot = makeEl('div');
const grouped = new ComposedFeed(groupedRoot, { chars: [] });
grouped.setInstant(true);
grouped.event("Mr Proctor arrived at Cy's cell to begin a search", '', '2026-09-09 10:15:00', 'search', '', {
  name: 'cell_search_initiated', text: "Mr Proctor arrived at Cy's cell to begin a search",
});
grouped.event('The search found nothing', '', '2026-09-09 10:16:00', 'search', '', {
  name: 'cell_search_property_result', text: 'The search found nothing',
});
assert.equal(grouped.flow.children.length, 1, 'the handwritten view groups successive search stages');
assert.equal(grouped.flow.children[0].tag, 'details');
assert.equal(grouped.flow.children[0].children[1].children.length, 2);
assert.match(grouped.flow.children[0].children[0].children[0].children[0].textContent, /^10:15:00 \(/);
assert.match(grouped.flow.children[0].children[0].children[0].children[2].textContent, /^10:16:00 \(/);
assert.match(grouped.flow.children[0].children[1].children[0].children[0].textContent, /^10:15:00 \(/);
grouped.beginEntry('2026-09-09 10:17:00', 'journal');
grouped.write('a thought after the search', 'journal');
assert.equal(grouped.flow.children[1]._classes.has('cy-journal-entry'), true, 'journal stays outside the group');

const realSearches = JSON.parse(await readFile(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'chronology-searches-2026-10-01.json')));
const liveSearchRoot = makeEl('div');
const liveSearchFeed = new ComposedFeed(liveSearchRoot, { chars: [] });
liveSearchFeed.setInstant(true);
for (const event of realSearches) {
  const p = event.payload;
  liveSearchFeed.event(ambientEventLabel(p), p.name.startsWith('cell_search_') ? p.text : '',
    event.ts, 'search', '', p);
}
assert.deepEqual(liveSearchFeed.flow.children.map((block) => block.children[1].children.length), [10, 9],
  'the actual public search payloads group through the handwritten feed');
liveSearchFeed.reset();
for (const event of realSearches) {
  const p = event.payload;
  liveSearchFeed.event(ambientEventLabel(p), p.name.startsWith('cell_search_') ? p.text : '',
    event.ts, 'search', '', p);
}
assert.deepEqual(liveSearchFeed.flow.children.map((block) => block.children[1].children.length), [10, 9],
  'replaying an older page reconstructs the same two groups');
const singleSearchStep = new ComposedFeed(makeEl('div'), { chars: [] });
singleSearchStep.setInstant(true);
singleSearchStep.event('The search found nothing', 'The search found nothing.',
  '2026-10-01 23:43:33.973', 'search', '', realSearches[7].payload);
assert.equal(singleSearchStep.flow.children[0].children.length, 2,
  'a standalone search card does not print its own title again as detail');

chronology.beginEntry('2026-09-09 10:25:00', 'dream');
assert.ok(chronology.current.block._classes.has('cy-dream-field'), 'legacy dream text uses the distinct dream field');
assert.equal(chronology.current.block._classes.has('cy-journal-entry'), false, 'dream writing is not presented as a journal entry');

const dreamRoot = makeEl('div');
const dreamFeed = new ComposedFeed(dreamRoot, { chars: [] });
dreamFeed.dream({
  id: 'dream-event-1', sleep_period_id: 'sleep-1', state: 'DREAMING',
  fragments: ['door will not fit the frame', 'proctor with no face'],
}, '2026-09-09 03:17:00', true);
const dreamBlock = dreamFeed.flow.children[0];
assert.ok(dreamBlock._classes.has('cy-dream-field'), 'structured dreams use a dark dream field');
assert.equal(dreamBlock._classes.has('cy-writing-segment'), false, 'structured dreams never use notebook-card presentation');
assert.ok(dreamBlock._classes.has('is-live'), 'the newest live dream alone has the animation hook');
const dreamFragments = dreamBlock.children[1].children[1];
assert.equal(dreamFragments.children.length, 2, 'dream fragments remain separate DOM nodes');
assert.notEqual(dreamFragments.children[0].style['--dream-offset'], undefined, 'fragment layout is deterministic CSS data');

dreamFeed.draw({
  id: 'dream-drawing-1', dream: true, dream_id: 'sleep-1', sleep_period_id: 'sleep-1',
  strokes: [{ t: 'C', x: 50, y: 50, r: 12 }], seq: 0, total: 2,
}, '2026-09-09 03:18:00', true);
assert.equal(dreamFeed.flow.children.length, 1, 'dream drawing joins the existing dream field instead of creating another card');
assert.equal(dreamBlock.children[1].children[0].children.length, 1, 'dream field owns one integrated SVG drawing');
assert.equal(dreamBlock.children[0].children[1].textContent, 'DREAMING', 'a live drawing keeps the shared field visibly active');
dreamFeed.event('lights on', '', '2026-09-09 06:30:00', 'prison');
assert.equal(dreamBlock._classes.has('is-live'), false, 'a completed dream has no live animation class');
assert.ok([...dreamFragments.children].every((fragment) => !fragment._classes.has('is-new')), 'completed fragments are static');
assert.equal(dreamFeed.pens.length, 0, 'dream text and drawings create no Pen renderer resources');

// The reported event IDs and timestamps are retained here. Text is
// synthetic so the regression depends only on placement, not private messages.
const interruptedDreamHistory = [
  { id: 2252008, type: 'dream', ts: '2026-10-07 01:09:00.050', payload: {
    id: 'dream-2252008', sleep_period_id: 'sleep-2026-10-06', fragments: ['before the postcard'],
  } },
  { id: 2252103, type: 'postcard_reply_begin', ts: '2026-10-07 01:12:15.386', payload: {
    id: 67, from: 'regression sender',
  } },
  { id: 2252117, type: 'postcard_out', ts: '2026-10-07 01:12:17.361', payload: {
    id: 67, to: 'regression sender', body: 'reply between dream segments',
  } },
  { id: 2252274, type: 'dream', ts: '2026-10-07 01:17:33.009', payload: {
    id: 'dream-2252274', sleep_period_id: 'sleep-2026-10-06', fragments: ['after the postcard at 01:17'],
  } },
  { id: 2252551, type: 'dream', ts: '2026-10-07 01:27:08.104', payload: {
    id: 'dream-2252551', sleep_period_id: 'sleep-2026-10-06', fragments: ['after the postcard at 01:27'],
  } },
  { id: 2253159, type: 'dream', ts: '2026-10-07 01:48:15.988', payload: {
    id: 'dream-2253159', sleep_period_id: 'sleep-2026-10-06', fragments: ['after the postcard at 01:48'],
  } },
];

function dreamFragmentsIn(block) {
  return block.children[1].children[1].children;
}

function snapshotNode(node) {
  return {
    tag: node.tag,
    text: node.textContent,
    style: Object.fromEntries(Object.entries(node.style).filter(([, value]) => typeof value !== 'function')),
    viewBox: node.getAttribute('viewBox'),
    path: node.getAttribute('d'),
    children: node.children.map(snapshotNode),
  };
}

function assertUniqueTree(node, seen = new Set()) {
  assert.equal(seen.has(node), false, 'a chronology node occurs exactly once in the DOM');
  seen.add(node);
  for (const child of node.children) {
    assert.equal(child.parentNode, node, 'a chronology child retains its actual parent');
    assertUniqueTree(child, seen);
  }
}

function newDreamChronology(instant) {
  const renderer = new ComposedFeed(makeEl('div'), { chars: [] });
  const cards = new Postcards(renderer.contentRoot(), { chars: [] }, {
    inline: true, lane: renderer.animationLane(),
  });
  renderer.setInstant(instant);
  cards.setInstant(instant);
  return { renderer, cards, instant };
}

function dispatchDreamHistory(view, events) {
  const { renderer, cards, instant } = view;
  for (const event of events) {
    const payload = event.payload;
    if (event.type === 'dream') {
      cards.finishAnimations();
      renderer.dream(payload, event.ts, !instant);
    } else if (event.type === 'draw') {
      cards.finishAnimations();
      renderer.draw(payload, event.ts, !instant);
    } else if (event.type === 'postcard_reply_begin') {
      renderer.finishAnimations();
      renderer.closeEntry(event.ts);
      cards.begin(payload);
    } else if (event.type === 'postcard_out') {
      cards.reply(payload.body, payload);
      cards.settle();
    } else {
      assert.fail('unhandled regression event: ' + event.type);
    }
  }
}

function chronologySnapshot(view) {
  return view.renderer.flow.children.map((block) => {
    if (block.dataset.kind === 'dream') {
      return {
        kind: 'dream', sleepPeriod: block.dataset.dreamId,
        time: block.children[0].children[0].textContent.slice(0, 8),
        events: dreamFragmentsIn(block).map((fragment) => fragment.dataset.eventId),
        canvas: snapshotNode(block.children[1]),
      };
    }
    const card = view.cards.cards.find((item) => item.el === block);
    assert.ok(card, 'each non-dream item is the actual inline postcard');
    return { kind: 'postcard', id: card.id, body: card.msg.textContent };
  });
}

const interruptedViews = [];
for (const instant of [false, true]) {
  const view = newDreamChronology(instant);
  const { renderer, cards } = view;
  dispatchDreamHistory(view, interruptedDreamHistory.slice(0, 1));
  const earlier = renderer.flow.children[0];
  dispatchDreamHistory(view, interruptedDreamHistory.slice(1, 3));
  const postcard = cards.cards[0].el;
  const earlierCanvas = snapshotNode(earlier.children[1]);
  const earlierTime = earlier.children[0].children[0].textContent;
  for (const event of interruptedDreamHistory.slice(3)) {
    dispatchDreamHistory(view, [event]);
    assert.equal(renderer.flow.children.length, 3,
      'later dreams in the same sleep period begin one new segment after the postcard');
    assert.deepEqual(renderer.flow.children.slice(0, 2), [earlier, postcard],
      'later dream fragments neither move the earlier segment nor displace the postcard');
    assert.deepEqual(snapshotNode(earlier.children[1]), earlierCanvas,
      'later dreams leave earlier text, drawing, spacing and height-affecting child structure unchanged');
    assert.equal(earlier.children[0].children[0].textContent, earlierTime,
      'later dreams do not replace the earlier segment timestamp');
  }
  const later = renderer.flow.children[2];
  assert.notEqual(later, earlier, 'a resumed sleep period owns a fresh physical field');
  assert.equal(later.dataset.dreamId, earlier.dataset.dreamId, 'both segments retain their shared sleep identity');
  assert.deepEqual(dreamFragmentsIn(earlier).map((fragment) => fragment.dataset.eventId), ['dream-2252008']);
  assert.deepEqual(dreamFragmentsIn(later).map((fragment) => fragment.dataset.eventId),
    ['dream-2252274', 'dream-2252551', 'dream-2253159'],
    'the three later contiguous dreams remain grouped once and in arrival order');
  assert.match(later.children[0].children[0].textContent, /^01:17:33 /,
    'the resumed segment starts at its own first event time');
  assert.equal(cards.cards.length, 1, 'the completed reply is retained exactly once');
  assert.equal(cards.cards[0].msg.textContent, 'reply between dream segments');
  assert.equal(earlier._classes.has('is-live'), false, 'the earlier field remains static');
  assert.equal(later._classes.has('is-live'), !instant, 'only a live resumed field has the animation hook');
  assertUniqueTree(renderer.flow);
  interruptedViews.push(view);
}
assert.deepEqual(chronologySnapshot(interruptedViews[0]), chronologySnapshot(interruptedViews[1]),
  'live delivery and instant history produce identical content and chronology');

// incoming() may move an already-open inline card. Match browser appendChild
// semantics so a fake duplicate node cannot conceal the real boundary.
const movedPostcardView = newDreamChronology(true);
dispatchDreamHistory(movedPostcardView, interruptedDreamHistory.slice(0, 2));
const openCard = movedPostcardView.cards.active.el;
movedPostcardView.cards.incoming(interruptedDreamHistory[1].payload);
assert.deepEqual(movedPostcardView.renderer.flow.children,
  [movedPostcardView.renderer.flow.children[0], openCard],
  'moving the active postcard to the end does not duplicate its DOM node');
dispatchDreamHistory(movedPostcardView, interruptedDreamHistory.slice(2));
assert.deepEqual(chronologySnapshot(movedPostcardView), chronologySnapshot(interruptedViews[1]));
assertUniqueTree(movedPostcardView.renderer.flow);

const pagedDreamView = newDreamChronology(true);
dispatchDreamHistory(pagedDreamView, interruptedDreamHistory.slice(3));
assert.equal(pagedDreamView.renderer.flow.children.length, 1, 'a history tail starts with its own contiguous dream field');
const oldTail = pagedDreamView.renderer.flow.children[0];
const beforePrepend = pagedDreamView.renderer.scrollState();
pagedDreamView.cards.reset();
pagedDreamView.renderer.reset();
assert.equal(oldTail.parentNode, null, 'reset detaches the previously loaded tail');
assert.equal(pagedDreamView.renderer.dreamFields.size, 0, 'reset clears dream grouping state before an older page is replayed');
dispatchDreamHistory(pagedDreamView, interruptedDreamHistory);
pagedDreamView.renderer.restoreAfterPrepend(beforePrepend);
assert.deepEqual(chronologySnapshot(pagedDreamView), chronologySnapshot(interruptedViews[1]),
  'loading earlier history and replaying reconstructs the same dream/postcard order as a full load');
assertUniqueTree(pagedDreamView.renderer.flow);

for (const [kind, insertBoundary] of [
  ['event', (renderer) => renderer.event('a visible event', '', '2026-10-07 01:12:00', 'prison')],
  ['journal', (renderer) => {
    renderer.beginEntry('2026-10-07 01:12:00', 'journal');
    renderer.write('waking words remain between dreams', 'journal');
    renderer.closeEntry('2026-10-07 01:13:00');
  }],
  ['day', (renderer) => renderer.beginDay('2026-10-08', '2026-10-08')],
  ['other sleep period', (renderer) => renderer.dream({
    id: 'other-sleep-event', sleep_period_id: 'another-sleep', fragments: ['another sleep period'],
  }, '2026-10-07 01:12:00', false)],
]) {
  const view = newDreamChronology(true);
  dispatchDreamHistory(view, [interruptedDreamHistory[0]]);
  const earlier = view.renderer.flow.children[0];
  const earlierCanvas = snapshotNode(earlier.children[1]);
  insertBoundary(view.renderer);
  const boundary = view.renderer.flow.children[1];
  dispatchDreamHistory(view, interruptedDreamHistory.slice(3));
  assert.equal(view.renderer.flow.children.length, 3, kind + ' closes the previous contiguous dream field');
  assert.deepEqual(view.renderer.flow.children.slice(0, 2), [earlier, boundary], kind + ' stays between the two dream fields');
  assert.deepEqual(snapshotNode(earlier.children[1]), earlierCanvas, kind + ' prevents changes to the earlier canvas');
  assert.equal(dreamFragmentsIn(view.renderer.flow.children[2]).length, 3,
    kind + ' allows subsequent compatible dreams to share the new field');
  assertUniqueTree(view.renderer.flow);
}

for (const instant of [false, true]) {
  const view = newDreamChronology(instant);
  const drawing = (seq) => ({
    id: 2260000 + seq, type: 'draw', ts: '2026-10-07 01:' + (10 + seq * 4) + ':00',
    payload: {
      id: 'shared-drawing-id', dream: true, dream_id: 'sleep-2026-10-06',
      sleep_period_id: 'sleep-2026-10-06', strokes: [{ t: 'D', x: 10 + seq * 20, y: 20 + seq * 10 }],
      seq, total: 3,
    },
  });
  dispatchDreamHistory(view, [interruptedDreamHistory[0], drawing(0)]);
  const earlier = view.renderer.flow.children[0];
  const earlierSvg = earlier.children[1].children[0].children[0];
  assert.equal(earlierSvg.children.length, 1, 'the initial drawing chunk shares its contiguous dream field');
  dispatchDreamHistory(view, interruptedDreamHistory.slice(1, 3));
  const frozenCanvas = snapshotNode(earlier.children[1]);
  dispatchDreamHistory(view, [drawing(1), interruptedDreamHistory[3], drawing(2)]);
  assert.equal(view.renderer.flow.children.length, 3, 'a later drawing chunk opens a field after the postcard');
  assert.deepEqual(snapshotNode(earlier.children[1]), frozenCanvas,
    'a repeated drawing ID never adds new strokes to the earlier field or changes its bounds');
  const later = view.renderer.flow.children[2];
  const laterSketch = later.children[1].children[0];
  assert.equal(laterSketch.children.length, 1, 'contiguous chunks reuse one SVG within the resumed segment');
  const laterSvg = laterSketch.children[0];
  assert.notEqual(laterSvg, earlierSvg, 'a drawing continued across a postcard gets a separate SVG');
  assert.deepEqual(earlierSvg.children.map((path) => path.getAttribute('d')), ['M10.00,20.00 L10.20,20.00']);
  assert.deepEqual(laterSvg.children.map((path) => path.getAttribute('d')),
    ['M30.00,30.00 L30.20,30.00', 'M50.00,40.00 L50.20,40.00'],
    'the resumed drawing contains exactly the later chunks without copying earlier strokes');
  assert.equal(earlierSvg.children.length + laterSvg.children.length, 3, 'each drawing stroke appears once across the complete chronology');
  assert.equal(dreamFragmentsIn(later)[0].dataset.eventId, 'dream-2252274', 'a later text fragment joins the resumed drawing field');
  assertUniqueTree(view.renderer.flow);
  view.cards.reset();
  view.renderer.reset();
  assert.equal(view.renderer.dreamDrawings.size, 0, 'reset discards drawing records for replay');
}

const manyDreams = new ComposedFeed(makeEl('div'), { chars: [] });
manyDreams.setInstant(true);
for (let i = 0; i < 1000; i++) {
  manyDreams.dream({ id: 'event-' + i, sleep_period_id: 'sleep-' + i, fragments: ['small fragment'] }, '2026-09-09 03:17:00', false);
}
assert.equal(manyDreams.dreamFields.size, 1000, 'large dream history retains every stable field');
assert.equal(manyDreams.pens.length, 0, 'large dream history accumulates no live pen resources');
assert.ok(manyDreams.flow.children.every((block) => !block._classes.has('is-live')), 'historical dream fields are all static');

const movingRoot = makeEl('div');
const moving = new ComposedFeed(movingRoot, { chars: [] });
let olderFinished = 0;
moving.setInstant(true);
moving.pens.push({ finishImmediately() { olderFinished++; }, setInstant() {} });
moving.event('a later event', '', '2026-09-09 10:30:00', 'prison');
assert.equal(olderFinished, 1, 'a later visible event finishes animation on older writing');
moving.beginEntry('2026-09-09 10:31:00', 'journal');
assert.equal(olderFinished, 1, 'a retired renderer is not revisited by every later feed item');

const boundedRoot = makeEl('div');
const bounded = new ComposedFeed(boundedRoot, { chars: [] });
const surface = makeEl('div');
let aborted = 0;
let destroyed = 0;
let laneReleased = 0;
const livePen = {
  abort() { aborted++; },
  destroy() { destroyed++; },
};
const liveEntry = {
  block: makeEl('article'), surface, pen: livePen, text: 'complete retained words',
  finishLane() { laneReleased++; }, static: false,
};
bounded.pens.push(livePen);
bounded.penEntries.set(livePen, liveEntry);
bounded.current = liveEntry;
bounded.finishAnimations();
assert.equal(surface.textContent, 'complete retained words', 'superseded live writing becomes lightweight text');
assert.ok(surface._classes.has('cy-writing-static'), 'the retired surface uses static handwriting styling');
assert.equal(bounded.pens.length, 0, 'the retired live Pen is released from the day-long renderer list');
assert.equal(bounded.penEntries.size, 0, 'the retired live Pen metadata is released');
assert.equal(aborted, 1, 'detached stroke work is stopped');
assert.equal(destroyed, 1, 'detached observers and listeners are removed');
assert.equal(laneReleased, 1, 'the shared handwriting lane is released once');

const jumpRoot = makeEl('div');
const jumpFeed = new ComposedFeed(jumpRoot, { chars: [] });
jumpFeed.scrollEl.scrollHeight = 1200;
jumpFeed.scrollEl.clientHeight = 500;
jumpFeed.scrollEl.scrollTop = 200;
jumpFeed.scrollEl.dispatchEvent({ type: 'scroll' });
const jumpButton = jumpRoot.children[1];
assert.ok(jumpButton._classes.has('feed-jump'), 'handwritten uses the shared jump-to-latest control');
assert.equal(jumpButton.hidden, false, 'handwritten shows jump to latest when scrolled away from the end');
jumpButton.dispatchEvent({ type: 'click' });
assert.equal(jumpFeed.scrollEl.scrollTop, 1200, 'handwritten jump returns to the latest item');
assert.equal(jumpButton.hidden, true, 'jump control hides again at the latest item');

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
const journalAge = entry.children[0].children[0];
const beforeTick = journalAge.textContent;
refreshEndpointTimes(timestampMs('2026-09-10 20:15:46'));
assert.notEqual(journalAge.textContent, beforeTick, 'journal timestamp age remains live');
const sketchFeed = new ComposedFeed(makeEl('div'), { chars: [] });
sketchFeed.setInstant(true);
globalThis.window = { addEventListener() {}, removeEventListener() {} };
sketchFeed.draw({ strokes: [] }, '2026-09-09 20:22:00', false);
assert.match(sketchFeed.flow.children[0].children[0].children[0].textContent, /^20:22:00 \(/,
  'standalone sketch retains its elapsed-age endpoint');
assert.equal(spans.flow.children[0].children.length, 3, 'day banner exposes previous, chooser, and next controls');
const historyActions = spans.flow.children[0].children[2];
assert.ok(historyActions._classes.has('cy-day-actions'), 'history day groups its forward and live actions');
assert.equal(historyActions.children[0].textContent, 'Live today', 'the final forward step clearly returns to live');
assert.equal(historyActions.children.length, 1, 'the day before today does not duplicate the live action');

const olderRoot = makeEl('div');
const olderFeed = new ComposedFeed(olderRoot, { chars: [] });
olderFeed.beginDay('2026-09-08', '2026-09-10');
assert.equal(olderFeed.flow.children[0].children[2].children[1].textContent, 'Live now', 'an older history day has a direct live escape');

const liveRoot = makeEl('div');
const liveFeed = new ComposedFeed(liveRoot, { chars: [] });
liveFeed.beginDay('2026-09-10', '2026-09-10');
assert.equal(liveFeed.flow.children[0].children[1].children[0].textContent, 'LIVE');
assert.equal(liveFeed.flow.children[0].children[2].children.length, 1, 'the live day does not show a redundant live button');

const here = dirname(fileURLToPath(import.meta.url));
const css = await readFile(join(here, '..', 'public', 'assets', 'style.css'), 'utf8');
const app = await readFile(join(here, '..', 'public', 'assets', 'app.js'), 'utf8');
assert.match(app, /pen\.write\(p\.s, p\.mode, p\.lucid, p\.shout, ev\.ts\)/, 'dispatch preserves token time for a recreated handwritten card');
assert.match(app, /instrumental_situation.*instrumental_action.*instrumental_outcome/,
  'public chronology routes instrumental situation, action, and consequence events into the feed');
const trayRule = css.match(/(?:^|\n)\.paper \{([\s\S]*?)\n\}/);
const journalRule = css.match(/(?:^|\n)\.cy-journal-entry \{([\s\S]*?)\n\}/);
assert.ok(trayRule, 'chronology tray has an explicit surface rule');
assert.doesNotMatch(trayRule[1], /repeating-linear-gradient/, 'chronology tray has no ruled-paper lines');
assert.ok(journalRule, 'journal cards have an explicit surface rule');
assert.match(journalRule[1], /repeating-linear-gradient/, 'ruled lines belong to journal cards');

console.log('composed-feed.test.js: all checks passed');
