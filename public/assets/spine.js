// spine.js - HISTORY MODE navigation (stage 2 of 3).
//
// The spine is a strip down the edge of the reading area that lets you leave the
// live stream and navigate back through CY's days. It reports WHERE you are; it
// does NOT yet re-render the past handwriting (that is stage 3). Selecting a
// moment resolves it to a seq + timestamp and announces it via a `cy:moment`
// event (and an onSelect callback) for stage 3 to consume.
//
// SHAPE OF THE DATA (from GET /api/history.php - aggregates only):
//   days[]  ascending by date, each: { date, seq:[min,max], ts:[min,max], chars,
//           bursts, silence, mood:{dominant,tint,score}, markers:{...}, hours:[...] }
//   hour    tight shape: { h, c(chars), b(bursts), s(silence), t(tint), dom?, m? }
//   moods   legend axis->tint (unused here; each band/hour already carries its tint)
//
// IT MUST NEVER FETCH RAW EVENTS TO DRAW ITSELF. The whole picture comes from the
// day index. The only raw touch is on COMMIT: one range.php?ts=&limit=1 call to
// resolve the chosen hour to an exact seq (best-effort; degrades to a constructed
// timestamp + null seq if it fails). Hover/scrub never fetch.
//
// HOW IT SCALES (decided, so stage 3 can rely on it): each day is ONE gradient
// band with 24 hard hour-stops - so the DOM is O(days), not O(days*24), and it
// stays light at a hundred days. Bands shrink to a floor height as days pile up;
// past the point where they all fit, the strip scrolls (newest at the top). Date
// labels drop out once bands fall below a legibility threshold. Hour resolution is
// never lost to compression: the pointer/scrub/keyboard maths pick the hour from a
// position within the band, so even a 7px band is fully hour-addressable.
//
// MOBILE: on a narrow screen the strip would eat the reading width, so it COLLAPSES
// BEHIND A CONTROL - a slide-in drawer from the left with a backdrop, opened by a
// small floating toggle (auto-opened when you enter history). Same vertical
// rendering, just presented as an overlay instead of a fixed gutter.
//
// It self-boots and exposes window.__cySpine for app.js:
//   show()      enter history: load the index if needed, reveal, render
//   hide()      leave history: dismiss the drawer/tooltip
//   refresh()   re-fetch the index
//   onSelect(fn)  register a committed-moment callback (also see the DOM event)
//   selected()  the last committed moment, or null

const CFG = window.CY || {};
const HISTORY_URL = CFG.history || 'api/history.php';
const RANGE_URL = CFG.range || 'api/range.php';

const MOBILE_Q = window.matchMedia('(max-width: 900px)');
const BAND_MIN = 7;      // floor band height; below the strip scrolls
const BAND_IDEAL = 26;   // a comfortable band when there is room
const LABEL_MIN_H = 17;  // show the per-day date label only above this height
const RELOAD_AFTER_MS = 60000; // re-fetch the index if a re-entry is this stale

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Marker types we surface as dots, in colour-priority order (first wins the dot
// colour when an hour carries several; the tooltip still lists them all).
const MARKERS = [
  { key: 'warden', label: 'warden notice', color: '#ff6a45' },
  { key: 'abort', label: 'abort', color: '#b0668f' },
  { key: 'pout', label: 'postcard out', color: '#6fcf97' },
  { key: 'pin', label: 'postcard in', color: '#7fb0d0' },
  { key: 'draw', label: 'drawing', color: '#d9a441' },
];

// ---- module state -------------------------------------------------------
let root = null;       // .cy-spine
let track = null;      // the scrolling band region (focusable, the slider)
let readoutEl = null;  // selected-moment readout
let jumpsEl = null;    // quick-jump buttons
let rangeEl = null;    // header sub: which span the index covers
let tip = null;        // floating hover tooltip (fixed)
let backdrop = null;   // mobile drawer backdrop
let toggleBtn = null;  // mobile floating open/close control

let index = null;      // { days:[], moods:{} } with derived fields attached
let loadedAt = 0;
let globalMaxHour = 1; // busiest hour's char count, for intensity scaling
let jumps = {};        // computed quick-jump targets {key:{di,hour,label}}

let cursor = { di: -1, hour: -1 }; // where the selection sits (index into days)
let scrubbing = false;
let lastCommitted = null;
const selectListeners = [];
const seqCache = new Map();

// ---- boot ---------------------------------------------------------------

function boot() {
  build();
  window.__cySpine = { show, hide, refresh, onSelect, selected: () => lastCommitted };

  if (document.body.dataset.test === '1') {
    window.__CY_SPINE__ = {
      load, render, setCursor, momentFromCursor, commitMoment, selectDayStart,
      getIndex: () => index, getCursor: () => ({ ...cursor }),
    };
  }
}

function build() {
  root = document.createElement('aside');
  root.className = 'cy-spine';
  root.setAttribute('aria-label', "CY's history timeline");
  root.hidden = false; // visibility is driven by body.cy-history in CSS

  const head = document.createElement('div');
  head.className = 'spine-head';
  const title = document.createElement('div');
  title.className = 'spine-title';
  title.innerHTML = '<span class="spine-live-dot" aria-hidden="true"></span>READING THE PAST';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'spine-close';
  close.setAttribute('aria-label', 'Close timeline');
  close.textContent = '×';
  close.addEventListener('click', closeDrawer);
  rangeEl = document.createElement('div');
  rangeEl.className = 'spine-range';
  head.appendChild(title);
  head.appendChild(close);
  head.appendChild(rangeEl);

  jumpsEl = document.createElement('div');
  jumpsEl.className = 'spine-jumps';

  track = document.createElement('div');
  track.className = 'spine-track';
  track.tabIndex = 0;
  track.setAttribute('role', 'slider');
  track.setAttribute('aria-label', "Timeline - navigate CY's days and hours");
  track.addEventListener('keydown', onKeydown);

  readoutEl = document.createElement('div');
  readoutEl.className = 'spine-readout';
  readoutEl.setAttribute('aria-live', 'polite');

  root.appendChild(head);
  root.appendChild(jumpsEl);
  root.appendChild(track);
  root.appendChild(readoutEl);
  document.body.appendChild(root);

  tip = document.createElement('div');
  tip.className = 'spine-tip';
  tip.hidden = true;
  document.body.appendChild(tip);

  backdrop = document.createElement('div');
  backdrop.className = 'spine-backdrop';
  backdrop.hidden = true;
  backdrop.addEventListener('click', closeDrawer);
  document.body.appendChild(backdrop);

  toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'spine-toggle';
  toggleBtn.setAttribute('aria-label', 'Open timeline');
  toggleBtn.textContent = 'Timeline';
  toggleBtn.addEventListener('click', () => (isDrawerOpen() ? closeDrawer() : openDrawer()));
  document.body.appendChild(toggleBtn);

  renderReadout(null);

  let rt = null;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => { if (isActive()) render(); }, 120);
  });
}

// ---- public surface -----------------------------------------------------

async function show() {
  if (!index || Date.now() - loadedAt > RELOAD_AFTER_MS) await load();
  render();
  if (MOBILE_Q.matches) openDrawer();
  // Sizes computed while hidden are wrong; recompute once the strip is laid out.
  requestAnimationFrame(render);
}

function hide() {
  hideTip();
  closeDrawer();
}

async function refresh() {
  await load();
  if (isActive()) render();
}

function onSelect(fn) {
  if (typeof fn === 'function') selectListeners.push(fn);
}

// ---- data ---------------------------------------------------------------

async function load() {
  try {
    const res = await fetch(HISTORY_URL, { cache: 'no-store' });
    const d = await res.json();
    index = d && d.ok ? { days: Array.isArray(d.days) ? d.days : [], moods: d.moods || {} } : { days: [], moods: {} };
  } catch (e) {
    index = { days: [], moods: {} };
  }
  loadedAt = Date.now();
  computeDerived();
}

// Attach an hour-lookup to each day, find the busiest hour (for intensity
// scaling), and precompute the quick-jump targets - all from aggregates.
function computeDerived() {
  globalMaxHour = 1;
  jumps = {};
  let lastPost = null, lastDraw = null, heavy = null, quiet = null;

  index.days.forEach((day, di) => {
    const byNum = {};
    for (const h of day.hours || []) {
      byNum[h.h] = h;
      if (h.c > globalMaxHour) globalMaxHour = h.c;
      const m = h.m || {};
      if ((m.pin || m.pout) && isLater(lastPost, di, h.h)) lastPost = { di, hour: h.h };
      if (m.draw && isLater(lastDraw, di, h.h)) lastDraw = { di, hour: h.h };
      if (!heavy || h.c > heavy.c) heavy = { di, hour: h.h, c: h.c };
      // quietest: the longest silence; ignore hours with no recorded silence.
      if (h.s > 0 && (!quiet || h.s > quiet.s)) quiet = { di, hour: h.h, s: h.s };
    }
    day.hoursByNum = byNum;
  });

  if (index.days.length) {
    const newest = index.days.length - 1;
    jumps.latest = { di: newest, hour: activeHour(index.days[newest], 'last'), label: 'Latest' };
    jumps.earliest = { di: 0, hour: activeHour(index.days[0], 'first'), label: 'Earliest' };
  }
  if (heavy) jumps.heavy = { di: heavy.di, hour: heavy.hour, label: 'Heaviest hour' };
  if (quiet) jumps.quiet = { di: quiet.di, hour: quiet.hour, label: 'Quietest stretch' };
  if (lastPost) jumps.post = { di: lastPost.di, hour: lastPost.hour, label: 'Last postcard' };
  if (lastDraw) jumps.draw = { di: lastDraw.di, hour: lastDraw.hour, label: 'Last drawing' };
}

function isLater(cur, di, hour) {
  if (!cur) return true;
  return di > cur.di || (di === cur.di && hour > cur.hour);
}

// The first/last hour of a day that actually carries writing (falls back to the
// hour of the day's ts bound so "day start/end" always lands somewhere real).
function activeHour(day, which) {
  const hs = (day.hours || []).map((h) => h.h).sort((a, b) => a - b);
  if (hs.length) return which === 'first' ? hs[0] : hs[hs.length - 1];
  const ts = which === 'first' ? day.ts[0] : day.ts[1];
  return ts ? parseInt(String(ts).slice(11, 13), 10) || 0 : 0;
}

// ---- rendering ----------------------------------------------------------

function render() {
  if (!track) return;
  track.textContent = '';
  updateRangeHeader();
  renderJumps();

  if (!index || !index.days.length) {
    const empty = document.createElement('div');
    empty.className = 'spine-empty';
    empty.textContent = 'No history rolled up yet.';
    track.appendChild(empty);
    return;
  }

  const avail = track.clientHeight || 480;
  const n = index.days.length;
  const bandH = Math.max(BAND_MIN, Math.min(BAND_IDEAL, Math.floor(avail / n)));

  // newest day at the top
  for (let di = n - 1; di >= 0; di--) {
    const day = index.days[di];
    const dayEl = document.createElement('div');
    dayEl.className = 'spine-day';
    dayEl.dataset.di = String(di);

    if (bandH >= LABEL_MIN_H) {
      const lab = document.createElement('button');
      lab.type = 'button';
      lab.className = 'spine-day-label';
      lab.textContent = shortDate(day.date);
      lab.title = 'Jump to the start of ' + day.date;
      lab.addEventListener('click', () => selectDayStart(di));
      dayEl.appendChild(lab);
    }

    const band = document.createElement('div');
    band.className = 'spine-band';
    band.style.height = bandH + 'px';
    band.style.backgroundImage = gradientFor(day);
    band.title = dayGlance(day);
    addMarkers(band, day);
    wireBand(band, di);
    dayEl.appendChild(band);

    day._el = dayEl;
    day._band = band;
    track.appendChild(dayEl);
  }
  updateCursorOverlay();
}

// A 24-stop horizontal gradient: one hard segment per hour, coloured by that
// hour's mood tint at an intensity set by how much he wrote. Silence is a gap.
function gradientFor(day) {
  const stops = [];
  for (let h = 0; h < 24; h++) {
    const cell = day.hoursByNum[h];
    const a = ((h / 24) * 100).toFixed(3);
    const b = (((h + 1) / 24) * 100).toFixed(3);
    stops.push(`${cellColor(cell, day)} ${a}% ${b}%`);
  }
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

function cellColor(cell, day) {
  if (!cell || !cell.c) return 'rgba(14, 17, 22, 0.9)'; // an empty hour: a visible gap
  const tint = cell.t || (day.mood && day.mood.tint) || '#4a4a52';
  const rgb = hexToRgb(tint);
  // sqrt-compress so a heavy night reads dense without a quiet hour vanishing.
  const intensity = clamp(Math.sqrt(cell.c / globalMaxHour), 0.14, 1);
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${(0.16 + 0.84 * intensity).toFixed(3)})`;
}

function addMarkers(band, day) {
  for (const h of day.hours || []) {
    const m = h.m;
    if (!m) continue;
    const present = MARKERS.filter((mk) => m[mk.key]);
    if (!present.length) continue;
    const dot = document.createElement('span');
    dot.className = 'spine-marker';
    dot.style.left = (((h.h + 0.5) / 24) * 100).toFixed(2) + '%';
    dot.style.background = present[0].color;
    if (m.abort && m.abort >= 3) dot.classList.add('is-heavy'); // abort-heavy spell
    dot.title = present.map((mk) => `${m[mk.key]} ${mk.label}${m[mk.key] > 1 ? 's' : ''}`).join(', ');
    band.appendChild(dot);
  }
}

function renderJumps() {
  jumpsEl.textContent = '';
  const order = ['latest', 'heavy', 'quiet', 'post', 'draw', 'earliest'];
  for (const key of order) {
    const j = jumps[key];
    if (!j) continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'spine-jump';
    b.textContent = j.label;
    b.title = j.label + ' - ' + shortDate(index.days[j.di].date);
    b.addEventListener('click', () => {
      setCursor(j.di, j.hour);
      ensureVisible(j.di);
      commitMoment(momentFromCursor());
    });
    jumpsEl.appendChild(b);
  }
}

function updateRangeHeader() {
  if (!index || !index.days.length) { rangeEl.textContent = ''; return; }
  const first = index.days[0].date;
  const last = index.days[index.days.length - 1].date;
  const n = index.days.length;
  rangeEl.textContent = n === 1 ? shortDate(first) : `${shortDate(first)} - ${shortDate(last)} (${n} days)`;
}

// ---- cursor + selection -------------------------------------------------

function setCursor(di, hour) {
  cursor = { di, hour: clamp(hour, 0, 23) };
  updateCursorOverlay();
  const m = momentFromCursor();
  track.setAttribute('aria-valuetext', m.aria);
  renderReadout(m, false, true); // preview (not yet committed)
}

function updateCursorOverlay() {
  track.querySelectorAll('.spine-day.is-selected').forEach((e) => e.classList.remove('is-selected'));
  const old = track.querySelector('.spine-cursor');
  if (old) old.remove();
  if (cursor.di < 0 || !index.days[cursor.di]) return;
  const day = index.days[cursor.di];
  if (!day._band) return;
  day._el.classList.add('is-selected');
  const c = document.createElement('div');
  c.className = 'spine-cursor';
  c.style.left = (((cursor.hour + 0.5) / 24) * 100).toFixed(2) + '%';
  day._band.appendChild(c);
}

function momentFromCursor() {
  const day = index.days[cursor.di];
  const hour = cursor.hour;
  const cell = day.hoursByNum[hour] || null;
  const ts = `${day.date} ${pad2(hour)}:00:00`;
  const summary = summarize(day, hour, cell);
  return { di: cursor.di, date: day.date, hour, cell, day, ts, summary, aria: summary.aria };
}

function selectDayStart(di) {
  const day = index.days[di];
  const hour = activeHour(day, 'first');
  setCursor(di, hour);
  ensureVisible(di);
  // A day-start has an exact seq/ts from the aggregate - no raw lookup needed.
  commitMoment(momentFromCursor(), { seq: day.seq[0], ts: day.ts[0] || momentFromCursor().ts });
}

// Commit the current moment: resolve its exact seq (best-effort), show it, and
// announce it. This is the ONLY place a raw endpoint is touched, and only on a
// deliberate selection - never while drawing, hovering, or scrubbing.
async function commitMoment(moment, preset) {
  renderReadout(moment, true); // "resolving..."
  let seq = null;
  let ts = moment.ts;
  if (preset) {
    seq = typeof preset.seq === 'number' ? preset.seq : null;
    ts = preset.ts || ts;
  } else {
    const r = await resolveSeq(moment.ts);
    seq = r.seq;
    ts = r.ts;
  }
  const detail = {
    date: moment.date,
    hour: moment.hour,
    ts,
    seq,
    summary: moment.summary,
  };
  lastCommitted = detail;
  renderReadout({ ...moment, ts }, false, false, seq);
  emit(detail);
}

async function resolveSeq(ts) {
  if (seqCache.has(ts)) return seqCache.get(ts);
  let out = { seq: null, ts };
  try {
    const res = await fetch(`${RANGE_URL}?ts=${encodeURIComponent(ts)}&limit=1`, { cache: 'no-store' });
    if (res.ok) {
      const d = await res.json();
      const ev = d.events && d.events[0];
      out = {
        seq: ev && typeof ev.seq === 'number' ? ev.seq : (d.page ? d.page.first_seq : null),
        ts: ev && ev.ts ? ev.ts : ts,
      };
    }
  } catch (e) { /* best-effort: keep the constructed ts, null seq */ }
  seqCache.set(ts, out);
  return out;
}

function emit(detail) {
  root.dispatchEvent(new CustomEvent('cy:moment', { detail, bubbles: true, composed: true }));
  document.dispatchEvent(new CustomEvent('cy:moment', { detail }));
  for (const fn of selectListeners) {
    try { fn(detail); } catch (e) { /* a listener must not break the spine */ }
  }
}

// ---- band interaction ---------------------------------------------------

function wireBand(band, di) {
  band.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (band.setPointerCapture) { try { band.setPointerCapture(e.pointerId); } catch (_) {} }
    scrubbing = true;
    track.focus({ preventScroll: true });
    setCursor(di, hourAt(band, e.clientX));
  });
  band.addEventListener('pointermove', (e) => {
    const hour = hourAt(band, e.clientX);
    if (scrubbing) setCursor(di, hour);
    else showTip(e, di, hour);
  });
  const end = () => { if (scrubbing) { scrubbing = false; commitMoment(momentFromCursor()); } };
  band.addEventListener('pointerup', end);
  band.addEventListener('pointercancel', () => { scrubbing = false; });
  band.addEventListener('pointerleave', hideTip);
}

function hourAt(band, clientX) {
  const r = band.getBoundingClientRect();
  return clamp(Math.floor(((clientX - r.left) / r.width) * 24), 0, 23);
}

function onKeydown(e) {
  if (!index || !index.days.length) return;
  const n = index.days.length;
  if (cursor.di < 0) setCursor(n - 1, 23);
  let handled = true;
  switch (e.key) {
    case 'ArrowLeft': setCursor(cursor.di, cursor.hour - 1); break;
    case 'ArrowRight': setCursor(cursor.di, cursor.hour + 1); break;
    case 'ArrowUp': setCursor(Math.min(n - 1, cursor.di + 1), cursor.hour); break;   // newer
    case 'ArrowDown': setCursor(Math.max(0, cursor.di - 1), cursor.hour); break;      // older
    case 'Home': setCursor(n - 1, 23); break;   // newest
    case 'End': setCursor(0, 0); break;          // oldest
    case 'PageUp': setCursor(Math.min(n - 1, cursor.di + 1), cursor.hour); break;
    case 'PageDown': setCursor(Math.max(0, cursor.di - 1), cursor.hour); break;
    case 'Enter':
    case ' ':
    case 'Spacebar': commitMoment(momentFromCursor()); break;
    default: handled = false;
  }
  if (handled) { e.preventDefault(); ensureVisible(cursor.di); }
}

function ensureVisible(di) {
  const day = index.days[di];
  if (day && day._el && day._el.scrollIntoView) day._el.scrollIntoView({ block: 'nearest' });
}

// ---- tooltip + readout --------------------------------------------------

function showTip(e, di, hour) {
  const day = index.days[di];
  if (!day) return;
  const s = summarize(day, hour, day.hoursByNum[hour] || null);
  tip.innerHTML = `<b>${s.when}</b><br>${s.lines.join('<br>')}`;
  tip.hidden = false;
  const pad = 12;
  let x = e.clientX + pad;
  let y = e.clientY + pad;
  const r = tip.getBoundingClientRect();
  if (x + r.width > window.innerWidth - 6) x = e.clientX - r.width - pad;
  if (y + r.height > window.innerHeight - 6) y = e.clientY - r.height - pad;
  tip.style.left = Math.max(6, x) + 'px';
  tip.style.top = Math.max(6, y) + 'px';
}

function hideTip() { if (tip) tip.hidden = true; }

function renderReadout(moment, resolving, preview, seq) {
  if (!moment) {
    readoutEl.innerHTML = '<span class="spine-ro-hint">Pick a moment on the strip, or use a jump above.</span>';
    return;
  }
  const s = moment.summary || summarize(moment.day, moment.hour, moment.cell);
  const seqTxt = resolving ? 'resolving...' : (typeof seq === 'number' ? ('#' + seq) : (preview ? '' : 'unresolved'));
  const tag = preview ? 'Selecting' : (resolving ? 'Selecting' : 'Selected');
  readoutEl.innerHTML =
    `<div class="spine-ro-head"><span class="spine-ro-tag">${tag}</span>` +
    `<span class="spine-ro-when">${s.when}</span>` +
    (seqTxt ? `<span class="spine-ro-seq">${seqTxt}</span>` : '') + '</div>' +
    `<div class="spine-ro-body">${s.lines.join(' &middot; ')}</div>`;
}

// A compact, human summary of one hour, shared by the tooltip, the readout, the
// aria value, and the emitted moment.
function summarize(day, hour, cell) {
  const when = `${shortDate(day.date)}, ${pad2(hour)}:00`;
  const lines = [];
  if (!cell || (!cell.c && !cell.s)) {
    lines.push('nothing written');
  } else {
    if (cell.c) lines.push(`${fmtNum(cell.c)} chars` + (cell.b ? `, ${cell.b} burst${cell.b > 1 ? 's' : ''}` : ''));
    else lines.push('no writing');
    if (cell.s) lines.push(`${humanDur(cell.s)} silent`);
    if (cell.dom) lines.push(`mood: ${cell.dom}`);
    const ev = markerText(cell.m);
    if (ev) lines.push(ev);
  }
  return { when, lines, aria: `${when}. ${lines.join('. ')}` };
}

function markerText(m) {
  if (!m) return '';
  const parts = [];
  for (const mk of MARKERS) if (m[mk.key]) parts.push(`${m[mk.key]} ${mk.label}${m[mk.key] > 1 ? 's' : ''}`);
  return parts.join(', ');
}

function dayGlance(day) {
  const mood = day.mood && day.mood.dominant ? day.mood.dominant : 'quiet';
  return `${day.date}: ${fmtNum(day.chars)} chars, ${day.bursts} bursts, mood ${mood}`;
}

// ---- mobile drawer ------------------------------------------------------

function isActive() { return document.body.classList.contains('cy-history'); }
function isDrawerOpen() { return root.classList.contains('is-open'); }
function openDrawer() {
  root.classList.add('is-open');
  backdrop.hidden = false;
  toggleBtn.setAttribute('aria-label', 'Close timeline');
}
function closeDrawer() {
  root.classList.remove('is-open');
  backdrop.hidden = true;
  toggleBtn.setAttribute('aria-label', 'Open timeline');
}

// ---- helpers ------------------------------------------------------------

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function fmtNum(n) { return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n); }

function shortDate(iso) {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${MONTHS[(parseInt(m[2], 10) || 1) - 1]} ${parseInt(m[3], 10)}`;
}

function humanDur(secs) {
  if (secs < 60) return Math.round(secs) + 's';
  if (secs < 3600) return Math.round(secs / 60) + 'm';
  return Math.round(secs / 3600) + 'h';
}

function hexToRgb(hex) {
  let h = String(hex).replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  if (!Number.isFinite(n)) return { r: 74, g: 74, b: 82 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

boot();
