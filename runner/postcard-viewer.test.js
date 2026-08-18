// postcard-viewer.test.js - the reply renders as a franked postcard, headless.
//
// Drives the real Postcards manager + Pen renderer through a minimal DOM stub (no
// browser) to assert the reply-as-a-postcard claims:
//   1. the reply renders on a distinct CARD element carrying a stamp, an HMP
//      THINKPAD franking mark, a PASSED BY CENSOR / 7734 censor mark, and the
//      sender's handle in the address panel;
//   2. the strokes animate PROGRESSIVELY on the card (dashed reveal) and NOT on
//      the journal sheet;
//   3. a long reply SHRINKS and CRAMS toward the bottom edge rather than clipping
//      or truncating;
//   4. a replayed backlog postcard (instant fill) appears COMPLETE - laid down
//      flat with no per-stroke animation.
//
// Self-checking: throws (non-zero exit) on any failure.
//
//   node runner/postcard-viewer.test.js

import assert from 'node:assert/strict';
import { Pen } from '../public/assets/pen.js';
import { Postcards } from '../public/assets/postcard.js';

let n = 0;
const ok = (msg) => { n++; console.log('  ok - ' + msg); };

// ---- a minimal DOM stub: enough for Pen + Postcards, no browser ----
function makeEl(tag) {
  const el = {
    tag,
    children: [],
    attrs: {},
    style: {},
    parentNode: null,
    _text: '',
    _className: '',
    _classes: new Set(),
    classList: {
      add: (c) => el._classes.add(c),
      remove: (c) => el._classes.delete(c),
      toggle: (c, on) => (on ? el._classes.add(c) : el._classes.delete(c)),
      contains: (c) => el._classes.has(c),
    },
    // keep className and classList in sync, like a real element
    set className(v) { el._className = String(v); el._classes = new Set(String(v).split(/\s+/).filter(Boolean)); },
    get className() { return el._className; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] ?? null; },
    hasAttribute(k) { return k in this.attrs; },
    removeAttribute(k) { delete this.attrs[k]; },
    appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
    insertBefore(c, ref) {
      c.parentNode = el;
      const i = ref ? el.children.indexOf(ref) : -1;
      if (i >= 0) el.children.splice(i, 0, c); else el.children.push(c);
      return c;
    },
    removeChild(c) { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); return c; },
    get firstChild() { return el.children[0] || null; },
    remove() { if (el.parentNode) el.parentNode.removeChild(el); },
    set textContent(v) { el._text = v; },
    get textContent() { return el._text; },
    get childElementCount() { return el.children.length; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    // the card message area is small so the cram path can be exercised; the sheet
    // is large. Keyed off the class name Postcards/Pen assign.
    getBoundingClientRect() {
      const cls = (el._className || '') + ' ' + (el.attrs.class || '');
      if (/pcard-msg/.test(cls)) return { width: 280, height: 110 };
      return { width: 600, height: 820 };
    },
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
  // the animated (non-instant) pen path uses these; keep them cheap.
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  globalThis.performance = { now: () => Date.now() };
  globalThis.getComputedStyle = () => ({ strokeDashoffset: '0' });
}
installDom();

// a tiny font: every printable char maps to one simple 3-point stroke.
const FONT = { name: 'stub', chars: Array.from({ length: 95 }, () => ({ d: 'M0,22 L5,10 L10,22', o: 6 })) };

const newRoot = () => makeEl('div');

// exact class-token set for a node (so "pcard-stamp" never matches "pcard-stamp-inner")
function classTokens(node) {
  const set = new Set();
  for (const src of [node._className || '', node.attrs && node.attrs.class ? node.attrs.class : '']) {
    for (const t of String(src).split(/\s+/)) if (t) set.add(t);
  }
  if (node._classes) for (const t of node._classes) set.add(t);
  return set;
}
// walk a subtree collecting nodes that carry an EXACT class token.
function findAll(node, cls, out = []) {
  if (classTokens(node).has(cls)) out.push(node);
  for (const c of node.children || []) findAll(c, cls, out);
  return out;
}
function textUnder(node) {
  let t = node._text || '';
  for (const c of node.children || []) t += ' ' + textUnder(c);
  return t;
}
// every rendered stroke path under a pen's ink layer.
const inkStrokes = (pen) => {
  const out = [];
  for (const grp of pen.ink.children) for (const p of grp.children) out.push(p);
  return out;
};
const glyphGroups = (pen) => pen.ink.children.filter((g) => (g.attrs.class || '').startsWith('glyph'));

async function drain(pen, cap = 4000) {
  for (let i = 0; i < cap && (pen.running || pen.jobs.length); i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

// ---- 1. the reply renders on a franked, censored, addressed CARD ----
await (async () => {
  const pcRoot = newRoot();
  const pc = new Postcards(pcRoot, FONT);
  pc.incoming({ id: 42, from: 'Mum', image: '' });
  pc.begin();

  assert.ok(pcRoot.children.length === 1, 'a single card object was created');
  const card = pc.active.el;
  assert.ok(card._classes.has('pcard-obj') && card._classes.has('writing'), 'card is a .pcard-obj in the writing state');

  // a divided back: message side + address side either side of a divide
  assert.equal(findAll(card, 'pcard-msg-side').length, 1, 'has a message side');
  assert.equal(findAll(card, 'pcard-addr-side').length, 1, 'has an address side');
  assert.equal(findAll(card, 'pcard-divide').length, 1, 'has a dividing line between them');

  // a stamp with an HMP THINKPAD franking mark
  assert.equal(findAll(card, 'pcard-stamp').length, 1, 'has a stamp');
  const frank = findAll(card, 'pcard-frank')[0];
  assert.ok(frank, 'has a franking mark');
  const frankText = textUnder(frank).replace(/\s+/g, ' ');
  assert.ok(/HMP/.test(frankText) && /THINKPAD/.test(frankText), `franking reads HMP THINKPAD [${frankText.trim()}]`);

  // a censor's mark: PASSED BY CENSOR + his number 7734
  const censor = findAll(card, 'pcard-censor')[0];
  assert.ok(censor, 'has a censor mark');
  const censorText = textUnder(censor);
  assert.ok(/PASSED BY CENSOR/.test(censorText), 'censor reads PASSED BY CENSOR');
  assert.ok(/7734/.test(censorText), 'censor carries his number 7734');

  // addressed back to the sender's handle
  const handle = findAll(card, 'pcard-handle')[0];
  assert.ok(handle && handle._text === 'Mum', `address panel shows the sender handle [${handle && handle._text}]`);
  ok('reply renders on a franked, censored postcard addressed back to the sender');
})();

// ---- 1b. an incoming picture is pinned to the card ----
await (async () => {
  const pc = new Postcards(newRoot(), FONT);
  pc.incoming({ id: 7, from: 'a stranger', image: 'uploads/x.webp' });
  pc.begin();
  assert.equal(findAll(pc.active.el, 'pcard-pic').length, 1, 'a pinned photo is present when the postcard carried an image');
  const img = findAll(pc.active.el, 'pcard-pic-img')[0];
  assert.equal(img && img.getAttribute('src'), 'uploads/x.webp', 'the pinned photo shows the incoming picture');
  ok('an incoming picture is pinned to the card as a photo');
})();

// ---- 1c. runner ordering: mode->letter (begin) BEFORE postcard_in ----
// The real runner opens the reply (mode letter) before it emits postcard_in, so
// the card must be re-addressed and its photo pinned when postcard_in lands.
await (async () => {
  const pc = new Postcards(newRoot(), FONT);
  pc.begin(); // mode->letter first, no sender known yet
  let handle = findAll(pc.active.el, 'pcard-handle')[0];
  assert.equal(handle._text, 'a stranger', 'before postcard_in the card shows the placeholder address');
  pc.incoming({ id: 9, from: 'Denny', image: 'uploads/y.webp' }); // now the sender is known
  handle = findAll(pc.active.el, 'pcard-handle')[0];
  assert.equal(handle._text, 'Denny', 'postcard_in re-addresses the open card to the real sender');
  assert.equal(findAll(pc.active.el, 'pcard-pic').length, 1, 'postcard_in pins the photo onto the open card');
  ok('a card opened before postcard_in is re-addressed and gets its photo (runner order)');
})();

// ---- 2. strokes animate progressively on the CARD, not on the SHEET ----
await (async () => {
  const sheet = new Pen(newRoot(), FONT);   // the journal paper
  const pc = new Postcards(newRoot(), FONT); // live (not instant)
  pc.incoming({ id: 1, from: 'Mum', image: '' });
  pc.begin();
  const cardPen = pc.active.pen;

  // route a couple of reply tokens to the card
  pc.write('hi');
  // let the queue lay down at least the first animated stroke
  for (let i = 0; i < 80 && !inkStrokes(cardPen).length; i++) await new Promise((r) => setTimeout(r, 0));

  const cardStrokes = inkStrokes(cardPen);
  assert.ok(cardStrokes.length >= 1, 'the reply produced strokes on the card');
  const animated = cardStrokes.some((p) => p.style.strokeDasharray != null && p.style.strokeDasharray !== '');
  assert.ok(animated, 'card strokes carry a dashed reveal (they animate progressively, not laid flat)');

  // the journal sheet received NONE of the reply
  assert.equal(inkStrokes(sheet).length, 0, 'the reply did not write on the journal sheet');
  assert.equal(sheet.ink.children.length, 0, 'the journal sheet ink layer is untouched by the reply');

  cardPen.abort(); // stop the in-flight animation so the test settles
  ok('reply strokes animate progressively on the card and never on the sheet');
})();

// ---- 3. a long reply shrinks and crams rather than clipping ----
await (async () => {
  const pc = new Postcards(newRoot(), FONT);
  pc.setInstant(true); // drain flat + fast; the cram logic runs regardless of instant
  pc.incoming({ id: 2, from: 'Mum', image: '' });
  pc.begin();
  const cardPen = pc.active.pen;
  const startSize = cardPen.size;

  // a reply far longer than the small (280x110) card message area
  const line = 'the wall listens and i keep writing until the hand forgets it is mine ';
  const reply = line.repeat(20); // ~1400 chars, far past the card's message area
  pc.write(reply);
  await drain(cardPen);

  // it shrank (crammed) but never below the floor
  assert.ok(cardPen.size < startSize, `the hand shrank to fit (${cardPen.size} < ${startSize})`);
  assert.ok(cardPen.size >= cardPen.minSize, `it never shrank below the floor (${cardPen.size} >= ${cardPen.minSize})`);

  // nothing was clipped or truncated: every non-space glyph was laid down
  const nonSpace = [...reply].filter((c) => c !== ' ' && c !== '\n' && c !== '\t').length;
  const groups = glyphGroups(cardPen).length;
  assert.equal(groups, nonSpace, `every character was written, none clipped (${groups} == ${nonSpace})`);

  // and it crammed IN PLACE - a card pen never scrolls the earlier lines away
  assert.equal(cardPen.scrollG.getAttribute('transform'), null, 'the card never scrolled (crammed in place)');
  ok('a long reply shrinks and crams toward the bottom edge rather than clipping');
})();

// ---- 4. a replayed backlog postcard appears complete, not re-animated ----
await (async () => {
  const pc = new Postcards(newRoot(), FONT);
  pc.setInstant(true); // backlog fill, exactly as firstLoad sets it
  pc.incoming({ id: 3, from: 'Mum', image: '' });
  pc.begin();
  const cardPen = pc.active.pen;
  const body = 'Mum - I read it four times. Tell the garden I said hello. 7734.';
  pc.write(body);
  pc.reply(body);
  pc.settle();
  await drain(cardPen);

  const strokes = inkStrokes(cardPen);
  assert.ok(strokes.length >= 1, 'the backlog card has ink');
  const anyAnimated = strokes.some((p) => p.style.strokeDasharray != null && p.style.strokeDasharray !== '');
  assert.equal(anyAnimated, false, 'no stroke carries a dashed reveal - it was laid down complete, not re-animated');

  // the card settled into place
  assert.ok(pc.active === null, 'the reply is finished (no active card)');
  const card = pc.cards[pc.cards.length - 1].el;
  assert.ok(card._classes.has('settled') && !card._classes.has('writing'), 'the card settled into place');

  const nonSpace = [...body].filter((c) => c !== ' ').length;
  assert.equal(glyphGroups(cardPen).length, nonSpace, 'the whole reply is present on the settled card');
  ok('a replayed backlog postcard appears complete, laid flat without re-animating');
})();

// ---- 5. settle backfills a card that only carried the postcard_out ----
await (async () => {
  const pc = new Postcards(newRoot(), FONT);
  pc.setInstant(true);
  pc.incoming({ id: 4, from: 'Denny', image: '' });
  pc.begin(); // mode->letter, but the per-token text scrolled out of the window
  pc.reply('short reply that only arrived as the full body.');
  pc.settle();
  const last = pc.cards[pc.cards.length - 1];
  assert.ok(last.body && last.body.length > 0, 'settle backfilled the full reply so the card is never blank');
  ok('a partial-window card is backfilled from the full reply at settle');
})();

console.log(`\npostcard-viewer.test.js: all ${n} checks passed`);
