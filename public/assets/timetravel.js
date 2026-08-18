// timetravel.js - HISTORY navigation via a tinted month-calendar dialog.
//
// Leaving the live stream is a matter of PICKING A MOMENT, and the natural unit is
// a day: everyone can already operate a month calendar. So this is a proper modal
// dialog holding a familiar calendar, opened by the live pill (app.js wires that).
//
//   - Each day cell is TINTED by that day's dominant mood (the tint legend the
//     history API returns), at an intensity set by how much he wrote that day
//     (sqrt-scaled). The calendar doubles as an at-a-glance emotional record.
//   - Days with no data are inert and not selectable.
//   - Small SHAPE markers flag notable days (postcards, drawings, warden notices) -
//     shape, not more hue, so they stay separable from the mood tint.
//   - Selecting a day reveals a 24-cell hour strip, tinted the same way, so the
//     second click gets full resolution. Two clicks, both familiar.
//   - Quiet shortcuts (earlier today, yesterday, last postcard, last drawing).
//   - A small legend explains the tints and the marker shapes.
//
// It draws itself ENTIRELY from the aggregate day index (GET /api/history.php); the
// only raw touch is on COMMIT - one range.php?ts=&limit=1 call to resolve the chosen
// hour to an exact seq (best-effort; degrades to a constructed ts + null seq).
//
// Confirming a moment resolves it to a seq + timestamp and announces it via a
// `cy:moment` event (and an onSelect callback), exactly as the previous stage did,
// so the replay stage consumes it unchanged. This does NOT render the past itself.
//
// Self-boots and exposes window.__cyTimeTravel for app.js:
//   open()        load the index if needed and open the dialog
//   close()       dismiss the dialog
//   onSelect(fn)  register a committed-moment callback (also see the DOM event)
//   selected()    the last committed moment, or null

const CFG = window.CY || {};
const HISTORY_URL = CFG.history || 'api/history.php';
const RANGE_URL = CFG.range || 'api/range.php';

const RELOAD_AFTER_MS = 60000; // re-fetch the index if a re-open is this stale

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']; // week starts Monday

const TINT_NONE = '#4a4a52';

// Notable-day markers, distinguished by SHAPE (postcards fold together). Each is a
// tiny neutral-coloured glyph - the hue carries mood, the shape carries the event.
const MARKER_SHAPES = {
  post: { label: 'postcard', path: 'M0 6 L4 1 L8 6 Z' },       // triangle
  draw: { label: 'drawing', path: 'M4 0 L8 4 L4 8 L0 4 Z' },   // diamond
  warden: { label: 'warden notice', path: 'M3 0 h2 v3 h3 v2 h-3 v3 h-2 v-3 h-3 v-2 h3 z' }, // cross
};

// ---- module state -------------------------------------------------------
let dlg = null;         // the <dialog>
let monthLabelEl = null;
let prevBtn = null, nextBtn = null;
let gridEl = null;      // the calendar grid
let hourWrapEl = null;  // the revealed hour strip container
let hourHeadEl = null;
let hourStripEl = null;
let shortcutsEl = null;
let legendEl = null;
let emptyEl = null;

let index = null;       // { days:[], byDate:{}, moods:{} }
let loadedAt = 0;
let maxDayChars = 1;    // busiest day's char count, for day-cell intensity
let shortcuts = {};     // computed quick targets
let viewYear = 0, viewMonth = 0; // the month on screen (0-based month)
let minYM = 0, maxYM = 0;        // data bounds as year*12+month
let selectedDate = null;         // the day whose hour strip is showing

let lastCommitted = null;
let openerFocus = null;
const selectListeners = [];
const seqCache = new Map();

// ---- boot ---------------------------------------------------------------

function boot() {
  build();
  window.__cyTimeTravel = { open, close, onSelect, selected: () => lastCommitted };

  if (document.body.dataset.test === '1') {
    window.__CY_TT__ = {
      load, open, close, confirmMoment, selectDay, renderMonth,
      buildMoment, getIndex: () => index, getShortcuts: () => shortcuts,
    };
  }
}

function build() {
  dlg = document.createElement('dialog');
  dlg.className = 'tt-dialog';
  dlg.setAttribute('aria-label', 'Travel back through the days');

  // header
  const head = document.createElement('div');
  head.className = 'tt-head';
  const title = document.createElement('div');
  title.className = 'tt-title';
  title.textContent = 'Travel back';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'tt-close';
  closeBtn.setAttribute('aria-label', 'Close and stay live');
  closeBtn.innerHTML = '&times;';
  closeBtn.addEventListener('click', () => close());
  head.appendChild(title);
  head.appendChild(closeBtn);

  // month navigation
  const nav = document.createElement('div');
  nav.className = 'tt-nav';
  prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = 'tt-nav-btn';
  prevBtn.setAttribute('aria-label', 'Previous month');
  prevBtn.innerHTML = '&lsaquo;';
  prevBtn.addEventListener('click', () => stepMonth(-1));
  monthLabelEl = document.createElement('div');
  monthLabelEl.className = 'tt-month';
  monthLabelEl.setAttribute('aria-live', 'polite');
  nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'tt-nav-btn';
  nextBtn.setAttribute('aria-label', 'Next month');
  nextBtn.innerHTML = '&rsaquo;';
  nextBtn.addEventListener('click', () => stepMonth(1));
  nav.appendChild(prevBtn);
  nav.appendChild(monthLabelEl);
  nav.appendChild(nextBtn);

  // weekday header
  const dow = document.createElement('div');
  dow.className = 'tt-dow';
  for (const w of WEEKDAYS) {
    const c = document.createElement('span');
    c.textContent = w;
    dow.appendChild(c);
  }

  gridEl = document.createElement('div');
  gridEl.className = 'tt-grid';

  emptyEl = document.createElement('div');
  emptyEl.className = 'tt-empty';
  emptyEl.hidden = true;
  emptyEl.textContent = 'No history has been rolled up yet.';

  // hour strip (hidden until a day is chosen)
  hourWrapEl = document.createElement('div');
  hourWrapEl.className = 'tt-hours';
  hourWrapEl.hidden = true;
  hourHeadEl = document.createElement('div');
  hourHeadEl.className = 'tt-hours-head';
  hourStripEl = document.createElement('div');
  hourStripEl.className = 'tt-hours-strip';
  hourWrapEl.appendChild(hourHeadEl);
  hourWrapEl.appendChild(hourStripEl);

  // shortcuts
  shortcutsEl = document.createElement('div');
  shortcutsEl.className = 'tt-shortcuts';

  // legend
  legendEl = document.createElement('div');
  legendEl.className = 'tt-legend';

  dlg.appendChild(head);
  dlg.appendChild(nav);
  dlg.appendChild(dow);
  dlg.appendChild(gridEl);
  dlg.appendChild(emptyEl);
  dlg.appendChild(hourWrapEl);
  dlg.appendChild(shortcutsEl);
  dlg.appendChild(legendEl);
  document.body.appendChild(dlg);

  // native <dialog>: Escape fires 'cancel' then 'close'; focus is trapped while
  // modal and returns to the opener on close (we restore it explicitly too).
  dlg.addEventListener('close', () => {
    hideHours();
    if (openerFocus && typeof openerFocus.focus === 'function') openerFocus.focus();
  });
  // a click on the backdrop (outside the dialog box) closes it
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) close();
  });
}

// ---- public surface -----------------------------------------------------

async function open() {
  openerFocus = document.activeElement;
  if (!index || Date.now() - loadedAt > RELOAD_AFTER_MS) await load();
  renderAll();
  if (!dlg.open) dlg.showModal();
}

function close() {
  if (dlg && dlg.open) dlg.close();
}

function onSelect(fn) {
  if (typeof fn === 'function') selectListeners.push(fn);
}

// ---- data ---------------------------------------------------------------

async function load() {
  let days = [], moods = {};
  try {
    const res = await fetch(HISTORY_URL, { cache: 'no-store' });
    const d = await res.json();
    if (d && d.ok) {
      days = Array.isArray(d.days) ? d.days : [];
      moods = d.moods || {};
    }
  } catch (e) {
    days = []; moods = {};
  }
  loadedAt = Date.now();
  computeDerived(days, moods);
}

// Attach an hour-lookup to each day, find the busiest day (for intensity scaling),
// set the month bounds, and precompute the quick-jump targets - all from aggregates.
function computeDerived(days, moods) {
  const byDate = {};
  maxDayChars = 1;
  for (const day of days) {
    const byNum = {};
    for (const h of day.hours || []) byNum[h.h] = h;
    day.hoursByNum = byNum;
    if (day.chars > maxDayChars) maxDayChars = day.chars;
    byDate[day.date] = day;
  }
  index = { days, byDate, moods };

  if (days.length) {
    minYM = ymOf(days[0].date);
    maxYM = ymOf(days[days.length - 1].date);
    const nm = days[days.length - 1].date;
    viewYear = parseInt(nm.slice(0, 4), 10);
    viewMonth = parseInt(nm.slice(5, 7), 10) - 1;
  }
  computeShortcuts();
}

function computeShortcuts() {
  shortcuts = {};
  if (!index || !index.days.length) return;
  const days = index.days;
  const newest = days[days.length - 1];
  shortcuts.today = { date: newest.date, hour: firstActiveHour(newest), label: 'Earlier today' };
  if (days.length >= 2) {
    const y = days[days.length - 2];
    shortcuts.yesterday = { date: y.date, hour: firstActiveHour(y), label: 'Yesterday' };
  }
  // last postcard / drawing: newest day first, latest marked hour within it
  for (let di = days.length - 1; di >= 0 && (!shortcuts.post || !shortcuts.draw); di--) {
    const day = days[di];
    const hrs = (day.hours || []).slice().sort((a, b) => b.h - a.h);
    for (const h of hrs) {
      const m = h.m;
      if (!m) continue;
      if (!shortcuts.post && (m.pin || m.pout)) shortcuts.post = { date: day.date, hour: h.h, label: 'Last postcard' };
      if (!shortcuts.draw && m.draw) shortcuts.draw = { date: day.date, hour: h.h, label: 'Last drawing' };
    }
  }
}

function firstActiveHour(day) {
  let best = null;
  for (const h of day.hours || []) if (h.c > 0 && (best === null || h.h < best)) best = h.h;
  if (best !== null) return best;
  const ts = day.ts && day.ts[0];
  return ts ? (parseInt(String(ts).slice(11, 13), 10) || 0) : 0;
}

// ---- rendering ----------------------------------------------------------

function renderAll() {
  selectedDate = null;
  hideHours();
  const has = index && index.days.length > 0;
  emptyEl.hidden = has;
  gridEl.hidden = !has;
  monthLabelEl.parentElement.hidden = !has;
  if (has) renderMonth();
  renderShortcuts();
  renderLegend();
}

function renderMonth() {
  gridEl.textContent = '';
  monthLabelEl.textContent = `${MONTHS_FULL[viewMonth]} ${viewYear}`;
  const curYM = viewYear * 12 + viewMonth;
  prevBtn.disabled = curYM <= minYM;
  nextBtn.disabled = curYM >= maxYM;

  const first = new Date(viewYear, viewMonth, 1);
  const lead = (first.getDay() + 6) % 7; // Monday-based blanks before day 1
  const nDays = new Date(viewYear, viewMonth + 1, 0).getDate();

  for (let i = 0; i < lead; i++) {
    const blank = document.createElement('span');
    blank.className = 'tt-day tt-blank';
    blank.setAttribute('aria-hidden', 'true');
    gridEl.appendChild(blank);
  }

  for (let d = 1; d <= nDays; d++) {
    const date = `${viewYear}-${pad2(viewMonth + 1)}-${pad2(d)}`;
    const day = index.byDate[date];
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'tt-day';
    const num = document.createElement('span');
    num.className = 'tt-day-num';
    num.textContent = String(d);
    cell.appendChild(num);

    if (day) {
      const tint = (day.mood && day.mood.tint) || TINT_NONE;
      const rgb = hexToRgb(tint);
      const intensity = clamp(Math.sqrt(day.chars / maxDayChars), 0.12, 1);
      cell.style.backgroundColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${(0.1 + 0.8 * intensity).toFixed(3)})`;
      addDayMarkers(cell, day);
      if (date === selectedDate) cell.classList.add('is-selected');
      cell.setAttribute('aria-label', dayGlance(day, d));
      cell.addEventListener('click', () => selectDay(date));
    } else {
      cell.classList.add('is-empty');
      cell.disabled = true;
    }
    gridEl.appendChild(cell);
  }
}

function addDayMarkers(cell, day) {
  const mk = day.markers || {};
  const wrap = document.createElement('span');
  wrap.className = 'tt-marks';
  let any = false;
  if (mk.pin || mk.pout) { wrap.appendChild(markerGlyph('post')); any = true; }
  if (mk.draw) { wrap.appendChild(markerGlyph('draw')); any = true; }
  if (mk.warden) { wrap.appendChild(markerGlyph('warden')); any = true; }
  if (any) cell.appendChild(wrap);
}

function markerGlyph(key) {
  const spec = MARKER_SHAPES[key];
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 8 8');
  svg.setAttribute('class', 'tt-mark tt-mark-' + key);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', spec.path);
  svg.appendChild(path);
  return svg;
}

function stepMonth(delta) {
  let ym = viewYear * 12 + viewMonth + delta;
  if (ym < minYM) ym = minYM;
  if (ym > maxYM) ym = maxYM;
  viewYear = Math.floor(ym / 12);
  viewMonth = ym % 12;
  renderMonth();
}

// Reveal the 24-cell hour strip for a chosen day (the second click gets full
// resolution). Selecting the day itself never commits - only an hour or a shortcut.
function selectDay(date) {
  selectedDate = date;
  const day = index.byDate[date];
  if (!day) return;
  gridEl.querySelectorAll('.tt-day.is-selected').forEach((e) => e.classList.remove('is-selected'));
  const cell = [...gridEl.querySelectorAll('.tt-day')].find(
    (c) => !c.classList.contains('is-empty') && !c.classList.contains('tt-blank') &&
      c.getAttribute('aria-label') && c.querySelector('.tt-day-num') &&
      Number(c.querySelector('.tt-day-num').textContent) === Number(date.slice(8, 10)),
  );
  if (cell) cell.classList.add('is-selected');

  hourHeadEl.textContent = `Pick an hour on ${shortDate(date)}`;
  hourStripEl.textContent = '';

  let maxC = 1;
  for (const h of day.hours || []) if (h.c > maxC) maxC = h.c;

  let firstActive = null;
  for (let h = 0; h < 24; h++) {
    const hcell = day.hoursByNum[h] || null;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tt-hour';
    const lab = document.createElement('span');
    lab.className = 'tt-hour-lab';
    lab.textContent = pad2(h);
    btn.appendChild(lab);
    const active = hcell && (hcell.c || hcell.s);
    if (active) {
      const tint = hcell.t || (day.mood && day.mood.tint) || TINT_NONE;
      const rgb = hexToRgb(tint);
      const intensity = clamp(Math.sqrt((hcell.c || 0) / maxC), 0.14, 1);
      btn.style.backgroundColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${(0.14 + 0.82 * intensity).toFixed(3)})`;
      const s = summarize(day, h, hcell);
      btn.setAttribute('aria-label', s.aria);
      btn.title = s.aria;
      btn.addEventListener('click', () => confirmMoment(date, h));
      if (firstActive === null) firstActive = btn;
    } else {
      btn.classList.add('is-empty');
      btn.disabled = true;
    }
    hourStripEl.appendChild(btn);
  }

  hourWrapEl.hidden = false;
  const focusTarget = firstActive || hourHeadEl;
  if (focusTarget && focusTarget.focus) {
    if (focusTarget === hourHeadEl) hourHeadEl.setAttribute('tabindex', '-1');
    focusTarget.focus();
  }
}

function hideHours() {
  if (hourWrapEl) hourWrapEl.hidden = true;
}

function renderShortcuts() {
  shortcutsEl.textContent = '';
  const order = ['today', 'yesterday', 'post', 'draw'];
  const present = order.filter((k) => shortcuts[k]);
  if (!present.length) return;
  const lab = document.createElement('span');
  lab.className = 'tt-sc-label';
  lab.textContent = 'Jump to';
  shortcutsEl.appendChild(lab);
  for (const key of present) {
    const j = shortcuts[key];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tt-sc';
    b.textContent = j.label;
    b.title = `${j.label} - ${shortDate(j.date)}, ${pad2(j.hour)}:00`;
    b.addEventListener('click', () => confirmMoment(j.date, j.hour));
    shortcutsEl.appendChild(b);
  }
}

function renderLegend() {
  legendEl.textContent = '';
  const moods = (index && index.moods) || {};
  const moodKeys = Object.keys(moods);
  if (moodKeys.length) {
    const row = document.createElement('div');
    row.className = 'tt-legend-row';
    const cap = document.createElement('span');
    cap.className = 'tt-legend-cap';
    cap.textContent = 'Mood';
    row.appendChild(cap);
    for (const k of moodKeys) {
      const chip = document.createElement('span');
      chip.className = 'tt-legend-chip';
      const sw = document.createElement('span');
      sw.className = 'tt-swatch';
      sw.style.backgroundColor = moods[k];
      chip.appendChild(sw);
      chip.appendChild(document.createTextNode(k));
      row.appendChild(chip);
    }
    legendEl.appendChild(row);
  }

  const mrow = document.createElement('div');
  mrow.className = 'tt-legend-row';
  const cap = document.createElement('span');
  cap.className = 'tt-legend-cap';
  cap.textContent = 'Events';
  mrow.appendChild(cap);
  for (const key of Object.keys(MARKER_SHAPES)) {
    const chip = document.createElement('span');
    chip.className = 'tt-legend-chip';
    chip.appendChild(markerGlyph(key));
    chip.appendChild(document.createTextNode(MARKER_SHAPES[key].label));
    mrow.appendChild(chip);
  }
  legendEl.appendChild(mrow);

  const hint = document.createElement('div');
  hint.className = 'tt-legend-hint';
  hint.textContent = 'Brighter = more written that day. Pick a day, then an hour.';
  legendEl.appendChild(hint);
}

// ---- commit -------------------------------------------------------------

function buildMoment(date, hour) {
  const day = index.byDate[date] || null;
  const cell = day ? (day.hoursByNum[hour] || null) : null;
  const ts = `${date} ${pad2(hour)}:00:00`;
  const summary = summarize(day, hour, cell);
  return { date, hour, cell, day, ts, summary };
}

// Resolve the chosen moment's exact seq (best-effort) and announce it. This is the
// ONLY place a raw endpoint is touched, and only on a deliberate selection.
async function confirmMoment(date, hour) {
  const moment = buildMoment(date, hour);
  const r = await resolveSeq(moment.ts);
  const detail = {
    date: moment.date,
    hour: moment.hour,
    ts: r.ts,
    seq: r.seq,
    summary: moment.summary,
  };
  lastCommitted = detail;
  emit(detail);
  close();
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
  document.dispatchEvent(new CustomEvent('cy:moment', { detail }));
  if (dlg) dlg.dispatchEvent(new CustomEvent('cy:moment', { detail, bubbles: true, composed: true }));
  for (const fn of selectListeners) {
    try { fn(detail); } catch (e) { /* a listener must not break the picker */ }
  }
}

// ---- summaries ----------------------------------------------------------

// A compact, human summary of one hour, shared by the hour tooltip/aria and the
// emitted moment (so the ticker/handoff text matches what stage 3 will replay).
function summarize(day, hour, cell) {
  const when = day ? `${shortDate(day.date)}, ${pad2(hour)}:00` : `${pad2(hour)}:00`;
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
  if (m.pin) parts.push(`${m.pin} postcard${m.pin > 1 ? 's' : ''} in`);
  if (m.pout) parts.push(`${m.pout} postcard${m.pout > 1 ? 's' : ''} out`);
  if (m.draw) parts.push(`${m.draw} drawing${m.draw > 1 ? 's' : ''}`);
  if (m.warden) parts.push(`${m.warden} warden notice${m.warden > 1 ? 's' : ''}`);
  if (m.abort) parts.push(`${m.abort} abort${m.abort > 1 ? 's' : ''}`);
  return parts.join(', ');
}

function dayGlance(day, d) {
  const mood = day.mood && day.mood.dominant ? day.mood.dominant : 'quiet';
  const parts = [`${MONTHS_FULL[viewMonth]} ${d}`, `${fmtNum(day.chars)} chars`, `mood ${mood}`];
  const ev = markerText(hoursMarkerRoll(day));
  if (ev) parts.push(ev);
  return parts.join(', ');
}

// Fold a day's markers object into the same short shape markerText reads.
function hoursMarkerRoll(day) {
  return day.markers || null;
}

// ---- helpers ------------------------------------------------------------

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function fmtNum(n) { return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n); }
function ymOf(iso) { return parseInt(iso.slice(0, 4), 10) * 12 + (parseInt(iso.slice(5, 7), 10) - 1); }

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
