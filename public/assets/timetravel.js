// timetravel.js - day-only history navigation.
//
// The centre feed deliberately contains one prison day at a time. This dialog
// selects that day either through a native date field or a month grid. Aggregated
// history adds colour and event markers, but it never determines whether a raw
// day may be opened: the rollup can legitimately lag behind the event stream.

const CFG = window.CY || {};
const HISTORY_URL = CFG.history || 'api/history.php';
const RELOAD_AFTER_MS = 60000;

const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const TINT_NONE = '#4a4a52';

const MARKER_SHAPES = {
  post: { label: 'postcard', path: 'M0 6 L4 1 L8 6 Z' },
  draw: { label: 'drawing', path: 'M4 0 L8 4 L4 8 L0 4 Z' },
  warden: { label: 'warden notice', path: 'M3 0 h2 v3 h3 v2 h-3 v3 h-2 v-3 h-3 v-2 h3 z' },
};

let dlg = null;
let dateInput = null;
let monthLabelEl = null;
let prevBtn = null;
let nextBtn = null;
let gridEl = null;
let legendEl = null;
let index = null;
let loadedAt = 0;
let maxDayChars = 1;
let viewYear = 0;
let viewMonth = 0;
let minDate = '';
let maxDate = '';
let minYM = 0;
let maxYM = 0;
let selectedDate = '';
let lastCommitted = null;
let openerFocus = null;
const selectListeners = [];

function boot() {
  build();
  window.__cyTimeTravel = { open, close, onSelect, selected: () => lastCommitted };
  if (document.body.dataset.test === '1') {
    window.__CY_TT__ = {
      load, open, close, confirmDay, renderMonth, stepMonth, getIndex: () => index,
    };
  }
}

function build() {
  dlg = document.createElement('dialog');
  dlg.className = 'tt-dialog';
  dlg.setAttribute('aria-label', 'Choose a day to view');

  const head = document.createElement('div');
  head.className = 'tt-head';
  const title = document.createElement('div');
  title.className = 'tt-title';
  title.textContent = 'Choose a day';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'tt-close';
  closeBtn.setAttribute('aria-label', 'Close the day chooser');
  closeBtn.innerHTML = '&times;';
  closeBtn.addEventListener('click', close);
  head.appendChild(title);
  head.appendChild(closeBtn);

  const intro = document.createElement('p');
  intro.className = 'tt-intro';
  intro.textContent = 'The feed shows one complete day at a time. Choose another date here.';

  const dateForm = document.createElement('form');
  dateForm.className = 'tt-date-form';
  dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.className = 'tt-date-input';
  dateInput.setAttribute('aria-label', 'Date to view');
  const openBtn = document.createElement('button');
  openBtn.type = 'submit';
  openBtn.className = 'tt-date-open';
  openBtn.textContent = 'Open day';
  dateForm.appendChild(dateInput);
  dateForm.appendChild(openBtn);
  dateForm.addEventListener('submit', (e) => {
    e.preventDefault();
    confirmDay(dateInput.value);
  });
  dateInput.addEventListener('change', () => {
    if (!validDate(dateInput.value)) return;
    selectedDate = clampDate(dateInput.value);
    dateInput.value = selectedDate;
    viewYear = Number(selectedDate.slice(0, 4));
    viewMonth = Number(selectedDate.slice(5, 7)) - 1;
    renderMonth();
  });

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

  const dow = document.createElement('div');
  dow.className = 'tt-dow';
  for (const weekday of WEEKDAYS) {
    const cell = document.createElement('span');
    cell.textContent = weekday;
    dow.appendChild(cell);
  }

  gridEl = document.createElement('div');
  gridEl.className = 'tt-grid';
  legendEl = document.createElement('div');
  legendEl.className = 'tt-legend';

  dlg.appendChild(head);
  dlg.appendChild(intro);
  dlg.appendChild(dateForm);
  dlg.appendChild(nav);
  dlg.appendChild(dow);
  dlg.appendChild(gridEl);
  dlg.appendChild(legendEl);
  document.body.appendChild(dlg);

  dlg.addEventListener('close', () => {
    if (openerFocus && typeof openerFocus.focus === 'function') openerFocus.focus();
  });
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) close();
  });
}

async function open(initialDate = '') {
  openerFocus = document.activeElement;
  if (!index || Date.now() - loadedAt > RELOAD_AFTER_MS) await load();
  selectedDate = clampDate(initialDate || (lastCommitted && lastCommitted.date) || maxDate);
  dateInput.min = minDate;
  dateInput.max = maxDate;
  dateInput.value = selectedDate;
  viewYear = Number(selectedDate.slice(0, 4));
  viewMonth = Number(selectedDate.slice(5, 7)) - 1;
  renderMonth();
  renderLegend();
  if (!dlg.open) dlg.showModal();
}

function close() {
  if (dlg && dlg.open) dlg.close();
}

function onSelect(fn) {
  if (typeof fn === 'function') selectListeners.push(fn);
}

async function load() {
  let days = [];
  let moods = {};
  try {
    const res = await fetch(HISTORY_URL, { cache: 'no-store' });
    const data = await res.json();
    if (data && data.ok) {
      days = Array.isArray(data.days) ? data.days : [];
      moods = data.moods || {};
    }
  } catch (e) {
    days = [];
    moods = {};
  }
  loadedAt = Date.now();
  computeDerived(days, moods);
}

function computeDerived(days, moods) {
  const byDate = {};
  maxDayChars = 1;
  for (const day of days) {
    byDate[day.date] = day;
    if (day.chars > maxDayChars) maxDayChars = day.chars;
  }
  index = { days, byDate, moods };
  maxDate = validDate(CFG.today) ? CFG.today : londonToday();
  const prisonDays = Math.max(1, Math.floor(Number(CFG.day) || 1));
  const inferredStart = shiftDate(maxDate, 1 - prisonDays);
  const indexedStart = days.length && validDate(days[0].date) ? days[0].date : maxDate;
  minDate = indexedStart < inferredStart ? indexedStart : inferredStart;
  if (minDate > maxDate) minDate = maxDate;
  minYM = ymOf(minDate);
  maxYM = ymOf(maxDate);
}

function renderMonth() {
  gridEl.textContent = '';
  monthLabelEl.textContent = MONTHS_FULL[viewMonth] + ' ' + viewYear;
  const curYM = viewYear * 12 + viewMonth;
  prevBtn.disabled = curYM <= minYM;
  nextBtn.disabled = curYM >= maxYM;

  const first = new Date(viewYear, viewMonth, 1);
  const lead = (first.getDay() + 6) % 7;
  const dayCount = new Date(viewYear, viewMonth + 1, 0).getDate();
  for (let i = 0; i < lead; i++) {
    const blank = document.createElement('span');
    blank.className = 'tt-day tt-blank';
    blank.setAttribute('aria-hidden', 'true');
    gridEl.appendChild(blank);
  }

  for (let number = 1; number <= dayCount; number++) {
    const date = viewYear + '-' + pad2(viewMonth + 1) + '-' + pad2(number);
    const day = index.byDate[date] || null;
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'tt-day';
    const num = document.createElement('span');
    num.className = 'tt-day-num';
    num.textContent = String(number);
    cell.appendChild(num);

    if (date < minDate || date > maxDate) {
      cell.classList.add('is-empty');
      cell.disabled = true;
    } else {
      if (day) applyDaySummary(cell, day, number);
      else {
        cell.classList.add('is-unindexed');
        cell.setAttribute('aria-label', longDate(date) + ', raw day not yet summarised');
      }
      if (date === maxDate) cell.classList.add('is-today');
      if (date === selectedDate) cell.classList.add('is-selected');
      cell.addEventListener('click', () => confirmDay(date));
    }
    gridEl.appendChild(cell);
  }
}

function applyDaySummary(cell, day, number) {
  const tint = (day.mood && day.mood.tint) || TINT_NONE;
  const rgb = hexToRgb(tint);
  const intensity = clamp(Math.sqrt((day.chars || 0) / maxDayChars), 0.12, 1);
  cell.style.backgroundColor = 'rgba(' + rgb.r + ', ' + rgb.g + ', ' + rgb.b + ', ' +
    (0.1 + 0.8 * intensity).toFixed(3) + ')';
  addDayMarkers(cell, day);
  cell.setAttribute('aria-label', dayGlance(day, number));
}

function addDayMarkers(cell, day) {
  const markers = day.markers || {};
  const wrap = document.createElement('span');
  wrap.className = 'tt-marks';
  if (markers.pin || markers.pout) wrap.appendChild(markerGlyph('post'));
  if (markers.draw) wrap.appendChild(markerGlyph('draw'));
  if (markers.warden) wrap.appendChild(markerGlyph('warden'));
  if (wrap.children.length) cell.appendChild(wrap);
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

function confirmDay(date) {
  if (!validDate(date) || date < minDate || date > maxDate) return;
  const detail = {
    date,
    hour: 0,
    ts: date + ' 00:00:00',
    seq: null,
    summary: { when: longDate(date), lines: [] },
  };
  lastCommitted = detail;
  emit(detail);
  close();
}

function emit(detail) {
  if (dlg) dlg.dispatchEvent(new CustomEvent('cy:moment', { detail, bubbles: true, composed: true }));
  else document.dispatchEvent(new CustomEvent('cy:moment', { detail }));
  for (const fn of selectListeners) {
    try { fn(detail); } catch (e) { /* a listener must not break the picker */ }
  }
}

function renderLegend() {
  legendEl.textContent = '';
  const moods = (index && index.moods) || {};
  const moodKeys = Object.keys(moods);
  if (moodKeys.length) {
    const row = document.createElement('div');
    row.className = 'tt-legend-row';
    addLegendCaption(row, 'Mood');
    for (const key of moodKeys) {
      const chip = document.createElement('span');
      chip.className = 'tt-legend-chip';
      const swatch = document.createElement('span');
      swatch.className = 'tt-swatch';
      swatch.style.backgroundColor = moods[key];
      chip.appendChild(swatch);
      chip.appendChild(document.createTextNode(key));
      row.appendChild(chip);
    }
    legendEl.appendChild(row);
  }

  const events = document.createElement('div');
  events.className = 'tt-legend-row';
  addLegendCaption(events, 'Events');
  for (const key of Object.keys(MARKER_SHAPES)) {
    const chip = document.createElement('span');
    chip.className = 'tt-legend-chip';
    chip.appendChild(markerGlyph(key));
    chip.appendChild(document.createTextNode(MARKER_SHAPES[key].label));
    events.appendChild(chip);
  }
  legendEl.appendChild(events);

  const hint = document.createElement('div');
  hint.className = 'tt-legend-hint';
  hint.textContent = 'Tinted days have summaries. Untinted days can still be opened.';
  legendEl.appendChild(hint);
}

function addLegendCaption(row, text) {
  const caption = document.createElement('span');
  caption.className = 'tt-legend-cap';
  caption.textContent = text;
  row.appendChild(caption);
}

function dayGlance(day, number) {
  const mood = day.mood && day.mood.dominant ? day.mood.dominant : 'quiet';
  const parts = [MONTHS_FULL[viewMonth] + ' ' + number, fmtNum(day.chars || 0) + ' chars', 'mood ' + mood];
  const markerSummary = markerText(day.markers);
  if (markerSummary) parts.push(markerSummary);
  return parts.join(', ');
}

function markerText(markers) {
  if (!markers) return '';
  const parts = [];
  if (markers.pin) parts.push(markers.pin + ' postcard' + (markers.pin > 1 ? 's' : '') + ' in');
  if (markers.pout) parts.push(markers.pout + ' postcard' + (markers.pout > 1 ? 's' : '') + ' out');
  if (markers.draw) parts.push(markers.draw + ' drawing' + (markers.draw > 1 ? 's' : ''));
  if (markers.warden) parts.push(markers.warden + ' warden notice' + (markers.warden > 1 ? 's' : ''));
  return parts.join(', ');
}

function clampDate(date) {
  if (!validDate(date)) return maxDate;
  if (date < minDate) return minDate;
  if (date > maxDate) return maxDate;
  return date;
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function londonToday() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const values = {};
  for (const part of parts) {
    if (part.type !== 'literal') values[part.type] = part.value;
  }
  return values.year + '-' + values.month + '-' + values.day;
}

function longDate(iso) {
  if (!validDate(iso)) return String(iso || '');
  const date = new Date(iso + 'T12:00:00Z');
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London',
  }).format(date);
}

function clamp(value, low, high) { return value < low ? low : value > high ? high : value; }
function pad2(number) { return number < 10 ? '0' + number : '' + number; }
function fmtNum(number) {
  return number >= 1000 ? (number / 1000).toFixed(number >= 10000 ? 0 : 1) + 'k' : String(number);
}
function ymOf(iso) {
  return Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;
}
function shiftDate(iso, days) {
  const date = new Date(iso + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

const RGB_FALLBACK = { r: 74, g: 74, b: 82 };

function hexToRgb(hex) {
  let value = String(hex).replace('#', '');
  if (value.length === 3) value = value.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return RGB_FALLBACK;
  const number = parseInt(value, 16);
  if (!Number.isFinite(number)) return RGB_FALLBACK;
  return { r: (number >> 16) & 255, g: (number >> 8) & 255, b: number & 255 };
}

boot();
