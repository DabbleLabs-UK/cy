// plain.js - the PLAIN reading view for CY.
//
// A third way of reading the same stream, sitting between the two extremes:
//   HANDWRITTEN - animated pen strokes on paper. Atmospheric, styled for effect.
//   RAW         - a terminal log of every event with payloads. Hard data.
//   PLAIN (this) - how an ordinary, well-made LLM interface presents output.
//                  Clean, legible, unstyled by comparison: the content, presented
//                  properly, and nothing else. No paper, no ink, no jitter, no
//                  instrument chrome around the text itself (the side panels stay).
//
// It does NOT poll on its own. app.js owns the single poll loop and dispatches
// every event; it forwards each one here via window.__cyPlain.handle(ev, bootstrap)
// (and hands us the font once loaded, for inline drawings). So PLAIN sees exactly
// the same stream the handwritten view does - including the backlog replayed on
// first load (bootstrap=true), which backfills recent blocks complete so a reader
// arriving mid-stream is not staring at an empty pane.
//
// Text simply APPEARS as it arrives, the way a normal chat interface streams -
// no pen pacing, no animation. Each generation burst becomes one rounded, softly
// bordered block, in order, newest at the bottom, auto-scrolling unless the reader
// has scrolled up. Everything is ordinary selectable/copyable text.
//
// The view switch (app.js) owns which view is on screen; this module is agnostic
// about how it is turned on. It stays hidden until the switch selects it and
// exposes window.__cyPlain (event sink + font handoff + reveal) for app.js.

import { sketchToPaths } from './pen.js';

// ---- module state -------------------------------------------------------
let root = null;      // #plain
let scrollEl = null;  // the scrolling region
let colEl = null;     // the centred reading column blocks live in
let jumpBtn = null;   // 'jump to latest' affordance
let font = null;      // Hershey font, for the 'T' label strokes in drawings

let stuck = true;                 // pinned to the live bottom edge
let curText = null;               // { el, textEl, cut } - open journal/dream block
let openReply = null;             // { el, textEl, cut } - reply being written now
let pendingReply = null;          // a finished reply awaiting its authoritative body
let lastIncomingFrom = '';        // sender of the most recent postcard, for the reply label
const draws = new Map();          // drawing id -> { svg, strokes[] }

// ---- boot ---------------------------------------------------------------

function boot() {
  root = document.getElementById('plain');
  if (!root) return;

  buildShell();

  // The view switch (app.js) owns visibility - PLAIN stays hidden (index.php marks
  // #plain hidden) until it is selected. app.js forwards EVERY event here from the
  // moment it registers, so the pane is always populated and switching to it is
  // instant; reveal() just pins it to the live edge when it becomes visible.
  window.__cyPlain = { handle, setFont, reveal };

  if (document.body.dataset.test === '1') {
    window.__CY_PLAIN__ = {
      handle,
      blocks: () => [...colEl.querySelectorAll('.pl-block')],
      kinds: () => [...colEl.querySelectorAll('.pl-block')].map((b) => b.dataset.kind),
      isStuck: () => stuck,
      col: () => colEl,
    };
  }
}

function buildShell() {
  scrollEl = document.createElement('div');
  scrollEl.className = 'pl-scroll';
  scrollEl.addEventListener('scroll', onScroll);

  colEl = document.createElement('div');
  colEl.className = 'pl-col';
  scrollEl.appendChild(colEl);
  root.appendChild(scrollEl);

  jumpBtn = document.createElement('button');
  jumpBtn.type = 'button';
  jumpBtn.className = 'pl-jump';
  jumpBtn.textContent = 'jump to latest';
  jumpBtn.hidden = true;
  jumpBtn.addEventListener('click', () => { stuck = true; scrollToBottom(); });
  root.appendChild(jumpBtn);
}

function setFont(f) {
  font = f;
  // any sketch that somehow rendered before the font arrived gets its labels back
  for (const d of draws.values()) renderSketch(d.svg, d.strokes);
}

// ---- the event sink -----------------------------------------------------
//
// Called for EVERY dispatched event (bootstrap = replayed backlog vs a live poll).
// PLAIN treats both the same: it just appends. Silences, aborts and drawings are
// rendered on backfill too, so a reader arriving mid-stream sees complete blocks
// rather than a stripped-down history.
function handle(ev, bootstrap) {
  const p = ev.payload || {};
  switch (ev.kind) {
    case 'text':
      if (p.mode === 'letter') appendReply(p.s);
      else appendText(p.s, p.mode, ev.ts);
      break;

    case 'mode': {
      finalizeText(); // any mode change closes the open journal block
      if (p.to === 'letter') beginReply(ev.ts);
      else if (p.from === 'letter') settleReply();
      break;
    }

    case 'gen':
      // a burst finished: close the open journal block so the next burst starts
      // its own. (A letter burst is closed by the mode flip back, not here.)
      if (p.mode !== 'letter') finalizeText();
      break;

    case 'silence':
      finalizeText();
      addGap(Number(p.seconds) || 0);
      break;

    case 'abort':
      markCut();
      break;

    case 'draw':
      addDraw(p);
      break;

    case 'postcard_in':
      lastIncomingFrom = p.from || '';
      break;

    case 'postcard_out':
      fillReply(p.body);
      break;
  }
  autoScroll();
}

// ---- journal / dream text ----------------------------------------------

function appendText(s, mode, ts) {
  if (s == null || s === '') return;
  if (!curText) curText = makeTextBlock(mode, ts);
  // a plain text node: newlines survive (CSS white-space: pre-wrap), so lists and
  // runs of short fragments read as themselves. Nothing is styled for effect - the
  // capitalisation Cy produces when angry is already in the text and simply shows.
  curText.textEl.appendChild(document.createTextNode(s));
}

function makeTextBlock(mode, ts) {
  const b = makeBlock('text');
  addMeta(b.el, clockOf(ts), textModeLabel(mode));
  const t = document.createElement('div');
  t.className = 'pl-text';
  b.el.appendChild(t);
  return { el: b.el, textEl: t, cut: false };
}

function finalizeText() {
  curText = null;
}

function textModeLabel(mode) {
  switch (mode) {
    case 'dream': return 'dream';
    case 'warden': return 'notice';
    case 'sleep': return 'asleep';
    default: return 'journal';
  }
}

// ---- postcard replies ---------------------------------------------------
//
// A reply is a distinct block, clearly a reply, without the franking and stamp
// theatre of the handwritten card. It streams in live (the letter-mode tokens),
// then postcard_out delivers the authoritative full text which we settle in - so
// a reply whose per-token stream scrolled out of the backlog window still reads
// complete.

function beginReply(ts) {
  const b = makeBlock('reply');
  addMeta(b.el, clockOf(ts), lastIncomingFrom ? 'reply to ' + lastIncomingFrom : 'reply');
  const t = document.createElement('div');
  t.className = 'pl-text';
  b.el.appendChild(t);
  openReply = { el: b.el, textEl: t, cut: false };
}

function appendReply(s) {
  if (s == null || s === '') return;
  if (!openReply) beginReply(null); // a stray letter token with no mode flip seen
  openReply.textEl.appendChild(document.createTextNode(s));
}

function settleReply() {
  if (openReply) { pendingReply = openReply; openReply = null; }
}

function fillReply(body) {
  if (body == null) return;
  let target = openReply || pendingReply;
  if (!target) {
    // only the authoritative reply survived the backlog window: build a block for it
    beginReply(null);
    target = openReply;
  }
  // authoritative text wins; if it was cut mid-stream the full body supersedes it
  if (!target.cut || String(body).length > target.textEl.textContent.length) {
    target.textEl.textContent = String(body);
  }
  pendingReply = null;
}

// ---- abort: cut off -----------------------------------------------------

function markCut() {
  const target = openReply || curText;
  if (!target || target.cut) return;
  target.cut = true;
  target.el.classList.add('pl-block-cut');
  const m = document.createElement('span');
  m.className = 'pl-cut';
  m.textContent = 'cut off';
  target.textEl.appendChild(m);
  if (target === curText) finalizeText();
}

// ---- silence: a quiet gap marker ---------------------------------------

function addGap(secs) {
  if (secs <= 0) return;
  const g = document.createElement('div');
  g.className = 'pl-gap';
  g.textContent = 'quiet for ' + humanDur(secs);
  colEl.appendChild(g);
}

// ---- drawings: the finished sketch, inline -----------------------------
//
// The same 0-100 stroke DSL the pen draws, rendered straight to a small SVG. A
// drawing arrives as one or more passes (and dream drawings as a long run of
// single strokes) sharing an id; we accumulate by id and re-render in place, so
// the reader sees the finished sketch rather than a re-animation.

function addDraw(p) {
  if (!p || !Array.isArray(p.strokes) || !p.strokes.length) return;
  const id = p.id != null ? String(p.id) : ('anon-' + colEl.childElementCount);
  let d = draws.get(id);
  if (!d) {
    finalizeText(); // a fresh drawing is its own block, in order
    const b = makeBlock('draw');
    if (p.title) addMeta(b.el, null, p.dream ? 'dream drawing' : String(p.title));
    else if (p.dream) addMeta(b.el, null, 'dream drawing');
    const wrap = document.createElement('div');
    wrap.className = 'pl-sketch';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', p.title ? 'drawing: ' + p.title : 'drawing');
    wrap.appendChild(svg);
    b.el.appendChild(wrap);
    d = { svg, strokes: [] };
    draws.set(id, d);
  }
  d.strokes.push(...p.strokes);
  renderSketch(d.svg, d.strokes);
}

function renderSketch(svg, strokes) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  for (const seg of sketchToPaths(strokes, { font })) {
    if (!seg || !seg.d) continue;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', seg.d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', seg.dot ? '2.6' : '1.4');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
  }
}

// ---- block + meta helpers ----------------------------------------------

function makeBlock(kind) {
  const el = document.createElement('div');
  el.className = 'pl-block pl-block-' + kind;
  el.dataset.kind = kind;
  colEl.appendChild(el);
  return { el };
}

// A quiet meta line: a small, muted timestamp and, where relevant, the mode.
// Understated - not a header bar. Either part may be omitted.
function addMeta(blockEl, time, label) {
  const meta = document.createElement('div');
  meta.className = 'pl-meta';
  if (time) {
    const t = document.createElement('span');
    t.className = 'pl-time';
    t.textContent = time;
    meta.appendChild(t);
  }
  if (label) {
    const l = document.createElement('span');
    l.className = 'pl-mode';
    l.textContent = label;
    meta.appendChild(l);
  }
  blockEl.appendChild(meta);
}

// ---- formatting ---------------------------------------------------------

function clockOf(ts) {
  if (!ts) return '';
  const m = String(ts).match(/(\d{2}):(\d{2})/);
  return m ? m[1] + ':' + m[2] : '';
}

function humanDur(secs) {
  if (secs < 60) return Math.round(secs) + 's';
  if (secs < 3600) return Math.round(secs / 60) + 'm';
  return Math.round(secs / 3600) + 'h';
}

// ---- scrolling ----------------------------------------------------------

function onScroll() {
  const nearBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 48;
  stuck = nearBottom;
  if (jumpBtn) jumpBtn.hidden = nearBottom;
}
function autoScroll() {
  if (stuck) scrollToBottom();
}
function scrollToBottom() {
  scrollEl.scrollTop = scrollEl.scrollHeight;
  if (jumpBtn) jumpBtn.hidden = true;
}

// Called by the view switch (app.js) when PLAIN becomes visible: pin it to the
// live edge. Scroll offsets computed while the pane was display:none are
// meaningless, so this restores the "following live" position on reveal.
function reveal() {
  stuck = true;
  scrollToBottom();
}

boot();
