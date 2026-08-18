// dream-viewer.test.js - the VIEWER half of dream mode, headless.
//
// Drives the real Pen renderer through a minimal DOM stub (no browser) to assert
// the two viewer claims:
//   1. a 'dream' mode text event renders in the fainter (and smaller) style than
//      waking prose, and carries the dream style hook;
//   2. progressive dream draw strokes ACCUMULATE on the separate, non-scrolling
//      dream surface, and rebuild identically across a simulated page reload.
//
// Self-checking: throws (non-zero exit) on any failure.
//
//   node runner/dream-viewer.test.js

import assert from 'node:assert/strict';
import { Pen, dreamTextStyle } from '../public/assets/pen.js';

let n = 0;
const ok = (msg) => { n++; console.log('  ok - ' + msg); };

// ---- a minimal DOM stub: just enough for the Pen instant-fill paths ----
function makeEl(tag) {
  const el = {
    tag,
    children: [],
    attrs: {},
    style: {},
    parentNode: null,
    _text: '',
    _classes: new Set(),
    classList: {
      add: (c) => el._classes.add(c),
      remove: (c) => el._classes.delete(c),
      toggle: (c, on) => (on ? el._classes.add(c) : el._classes.delete(c)),
      contains: (c) => el._classes.has(c),
    },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] ?? null; },
    hasAttribute(k) { return k in this.attrs; },
    removeAttribute(k) { delete this.attrs[k]; },
    appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
    removeChild(c) { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); return c; },
    get firstChild() { return el.children[0] || null; },
    remove() { if (el.parentNode) el.parentNode.removeChild(el); },
    set textContent(v) { el._text = v; },
    get textContent() { return el._text; },
    get childElementCount() { return el.children.length; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { width: 600, height: 800 }; },
    // never hit in instant mode, present so nothing throws if reached:
    getTotalLength() { return 10; },
    getPointAtLength() { return { matrixTransform: () => ({ x: 0, y: 0 }) }; },
    getCTM() { return {}; },
    animate() { return { cancel() {}, finish() {}, onfinish: null, oncancel: null }; },
    addEventListener() {},
  };
  return el;
}

function installDom() {
  globalThis.document = {
    createElementNS: (_ns, tag) => makeEl(tag),
    createElement: (tag) => makeEl(tag),
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.window = { addEventListener() {}, getSelection: () => null };
  // ResizeObserver deliberately left undefined (the Pen guards on typeof).
}
installDom();

// a tiny font: every printable char maps to one simple 3-point stroke.
const FONT = { name: 'stub', chars: Array.from({ length: 95 }, () => ({ d: 'M0,22 L5,10 L10,22', o: 6 })) };

const newRoot = () => makeEl('div');
const newPen = () => new Pen(newRoot(), FONT);

// drain the async instant-fill queue (promises resolve synchronously in instant
// mode, but still through microtasks/timers).
async function drain(pen) {
  for (let i = 0; i < 20000 && (pen.running || pen.jobs.length); i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

// find rendered glyph groups on the ink layer by their class string.
const glyphGroups = (pen) => pen.ink.children.filter((g) => (g.attrs.class || '').startsWith('glyph'));
const opacityOf = (grp) => (grp.children.length ? parseFloat(grp.children[0].style.opacity) : NaN);

// ---- 0. the pure style helper is genuinely fainter + smaller ----
const ds = dreamTextStyle();
assert.ok(ds.opacityScale > 0 && ds.opacityScale < 1, `dream opacityScale ${ds.opacityScale} is < 1 (fainter)`);
assert.ok(ds.sizeScale > 0 && ds.sizeScale < 1, `dream sizeScale ${ds.sizeScale} is < 1 (smaller)`);
ok('dreamTextStyle() is fainter and smaller than waking prose');

// ---- 1. a 'dream' mode text event renders in the fainter style ----
await (async () => {
  const prevRandom = Math.random;
  Math.random = () => 0.5; // freeze jitter so the opacity comparison is exact
  try {
    const pen = newPen();
    pen.setInstant(true);

    pen.write('ab'); // waking prose (no mode)
    await drain(pen);
    const wakeGroups = glyphGroups(pen).filter((g) => g.attrs.class === 'glyph');
    assert.ok(wakeGroups.length >= 1, 'waking glyphs rendered');
    const wakeOp = opacityOf(wakeGroups[0]);

    pen.write('cd', 'dream'); // a murmur
    await drain(pen);
    const dreamGroups = glyphGroups(pen).filter((g) => g.attrs.class === 'glyph dream');
    assert.ok(dreamGroups.length >= 1, 'dream glyphs rendered and tagged with the dream class');
    const dreamOp = opacityOf(dreamGroups[0]);

    assert.ok(dreamOp < wakeOp, `dream ink (${dreamOp}) is fainter than waking ink (${wakeOp})`);
    // and it is fainter by the dream opacity scale (jitter frozen, so exact-ish)
    assert.ok(Math.abs(dreamOp - wakeOp * ds.opacityScale) < 0.02, `dream opacity ~= waking * ${ds.opacityScale}`);

    // a LUCID night-waking line (mode dream + lucid) is NOT faint - it lands hard
    pen.write('ef', 'dream', true);
    await drain(pen);
    const lucidGroups = glyphGroups(pen).filter((g) => g.attrs.class === 'glyph');
    const lucidOp = opacityOf(lucidGroups[lucidGroups.length - 1]);
    assert.ok(Math.abs(lucidOp - wakeOp) < 0.02, `lucid night-waking ink (${lucidOp}) is normal weight, not faint`);
    ok('a dream murmur renders fainter than waking prose; a lucid night-waking line does not');
  } finally {
    Math.random = prevRandom;
  }
})();

// ---- 2. progressive dream strokes accumulate on the (separate) surface ----
// one dream draw event per stroke, all sharing an id (as the runner emits them).
function dreamEvents(id, count) {
  const evs = [];
  for (let i = 0; i < count; i++) {
    evs.push({ id, dream: true, strokes: [{ t: 'C', x: 50, y: 50, r: 5 + i * 4 }], seq: i, total: count });
  }
  return evs;
}
const countDreamStrokes = (pen) =>
  pen.dreamLayer.children.reduce((s, grp) => s + grp.children.length, 0);

const events = dreamEvents('drNight', 6);

// live pass: strokes arrive one at a time and accumulate
const penA = newPen();
penA.setInstant(true);
// the dream surface is a sibling of the scroll group, in root user space, so it
// does NOT scroll away with the text.
assert.equal(penA.dreamLayer.parentNode, penA.svg, 'dream layer sits in the SVG root (not scrolled)');
assert.notEqual(penA.dreamLayer, penA.scrollG, 'dream layer is separate from the scrolling text layer');

for (let i = 0; i < 3; i++) { penA.draw(events[i]); await drain(penA); }
const partial = countDreamStrokes(penA);
assert.equal(partial, 3, 'after 3 events the surface holds 3 marks (it accumulated, not replaced)');
for (let i = 3; i < events.length; i++) { penA.draw(events[i]); await drain(penA); }
const full = countDreamStrokes(penA);
assert.equal(full, 6, 'after all 6 events the surface holds 6 marks');
assert.equal(penA.dreamLayer.children.length, 1, 'all marks share ONE surface box (same drawing id)');
ok('dream strokes accumulate one at a time on a single, non-scrolling surface');

// ---- 3. the surface rebuilds identically across a simulated page reload ----
// a reload = a fresh Pen replaying the whole event backlog (as firstLoad does).
const penB = newPen();
penB.setInstant(true);
for (const ev of events) { penB.draw(ev); await drain(penB); }
const reloaded = countDreamStrokes(penB);
assert.equal(reloaded, full, `after a reload the surface rebuilds to the same ${full} marks`);
assert.equal(penB.dreamLayer.children.length, 1, 'reload rebuilds the single surface box');
ok('a mid-drawing page reload replays the strokes and rebuilds the surface exactly');

// ---- 4. lights_on: the dream surface is set aside; ruled paper resumes ----
penA.setMode('dream'); // ensure we are in dream paper first
penA.setMode('journal'); // lights_on transition
assert.ok(penA.dreamLayer._classes.has('faded') || penA.dreamLayer.children.length === 0, 'dream surface is faded/cleared on waking');
assert.ok(!penA.root._classes.has('paper-dream'), 'the dream paper hook is removed on waking');
ok('at lights_on the dream surface fades aside and normal paper resumes');

console.log(`\ndream-viewer.test.js: all ${n} checks passed`);
