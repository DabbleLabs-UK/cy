import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function makeEl(tag) {
  const el = {
    tag,
    children: [],
    parentNode: null,
    dataset: {},
    style: {},
    _text: '',
    _classes: new Set(),
    _listeners: {},
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
    addEventListener(type, fn) { (el._listeners[type] ||= []).push(fn); },
    dispatchEvent(event) { for (const fn of el._listeners[event.type] || []) fn(event); },
    setAttribute(name, value) { el[name] = String(value); },
    set textContent(v) { el._text = String(v); if (v === '') el.children = []; },
    get textContent() { return el._text; },
  };
  return el;
}

globalThis.document = {
  createElement: (tag) => makeEl(tag),
};

const { ComposedFeed, HandwritingLane } = await import('../public/assets/composed-feed.js');

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
assert.equal(chronology.flow.children[1]._classes.has('cy-journal-entry'), false, 'event records never receive journal paper');

chronology.beginEntry('2026-09-09 10:25:00', 'dream');
assert.ok(chronology.current.block._classes.has('cy-writing-note'), 'dream writing uses unruled note stock');
assert.equal(chronology.current.block._classes.has('cy-journal-entry'), false, 'dream writing is not presented as a journal entry');

const movingRoot = makeEl('div');
const moving = new ComposedFeed(movingRoot, { chars: [] });
let olderFinished = 0;
moving.setInstant(true);
moving.pens.push({ finishImmediately() { olderFinished++; }, setInstant() {} });
moving.event('a later event', '', '2026-09-09 10:30:00', 'prison');
assert.equal(olderFinished, 1, 'a later visible event finishes animation on older writing');
moving.beginEntry('2026-09-09 10:31:00', 'journal');
assert.equal(olderFinished, 2, 'a newer journal entry finishes animation on older writing');

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
