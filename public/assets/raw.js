// raw.js - the RAW debugging view for CY.
//
// An unstyled, live, debugging-grade view of what the runner is actually doing.
// Gated behind ?111 (index.php sets window.CY.raw): only then does the
// HANDWRITTEN | RAW toggle appear and this module do anything. The choice is
// remembered per session (sessionStorage) so a reload stays in RAW while ?111 is
// still present. This is deliberate light obscurity, agreed with the owner - NOT
// a login.
//
// RAW replaces the paper sheet in place (the instrument panels keep updating,
// driven by app.js as normal). It polls the SAME public event feed as app.js but
// FASTER (~400ms) and renders every event as a terminal line the instant it
// arrives - no pen pacing, no animation - so the stream feels like the model's
// real output rate, stalls and all. Newest at the BOTTOM, auto-scrolling unless
// you have scrolled up.
//
// SAFETY: this view is POST-WARDEN only. It never has, and never requests, any
// pre-warden text. A blocked chunk reaches the feed only as a `warden` event
// carrying its category and a character count (no content), which renders here as
// a [redacted by warden: <category>] marker - the mechanism is visible, the
// blocked text is not.

const CFG = window.CY || {};
const STREAM = CFG.stream || 'api/stream.php';
const POLL_MS = 400; // faster than the handwritten view's 1000ms - watch the rate
const MAX_ROWS = 1500; // rolling DOM cap (see NOTE below)

// Every event kind the feed can carry. Order defines the filter-chip order.
const KINDS = [
  'text', 'gen', 'silence', 'mode', 'abort', 'draw', 'vitals', 'host',
  'power', 'tempo', 'postcard_in', 'postcard_out', 'news_in', 'warden',
  'event', 'day',
];

const $ = (sel, root = document) => root.querySelector(sel);

// ---- module state -------------------------------------------------------
let logEl = null;        // the scrolling line container
let jumpBtn = null;      // 'jump to live' affordance
let capNote = null;      // "showing last N of M" footer
let searchInput = null;
let toggleWrap = null;

let mode = 'handwritten'; // current view
let pollTimer = null;
let hydrated = false;     // has RAW loaded a backlog yet
let sinceSeq = 0;         // raw's own high-water mark (independent of app.js)
let seenTotal = 0;        // total events rendered (for the cap note)
let dropped = 0;          // rows removed from the top by the cap
let stuck = true;         // pinned to the live bottom edge
let lastRenderMs = null;  // for the per-line arrival delta

const hiddenKinds = new Set(); // kinds toggled OFF in the filter bar
let searchTerm = '';

// Warden drops seen since the last `gen`, attached to that burst's detail so the
// burst view can list what the warden removed (category + char count only).
let wardenSinceGen = [];

// ---- boot ---------------------------------------------------------------

function boot() {
  if (!CFG.raw) return; // no ?111 -> no toggle, no raw view, nothing to do
  buildToggle();
  buildShell();
  // restore the session's choice; default to the ordinary handwritten sheet
  const stored = sessionStorage.getItem('cy-view');
  setMode(stored === 'raw' ? 'raw' : 'handwritten');

  if (document.body.dataset.test === '1') {
    window.__CY_RAW__ = {
      setMode,
      isStuck: () => stuck,
      rowCount: () => logEl.querySelectorAll('.rl').length,
      kinds: () => [...logEl.querySelectorAll('.rl')].map((r) => r.dataset.kind),
      log: () => logEl,
      jumpBtn: () => jumpBtn,
    };
  }
}

// ---- the chrome toggle: HANDWRITTEN | RAW -------------------------------

function buildToggle() {
  const meta = $('.topmeta');
  toggleWrap = document.createElement('div');
  toggleWrap.className = 'viewtoggle';
  toggleWrap.setAttribute('role', 'group');
  toggleWrap.setAttribute('aria-label', 'view');
  for (const [key, label] of [['handwritten', 'HANDWRITTEN'], ['raw', 'RAW']]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'vt-btn';
    b.dataset.view = key;
    b.textContent = label;
    b.addEventListener('click', () => setMode(key));
    toggleWrap.appendChild(b);
  }
  // place it before the status pill so it reads left-to-right in the chrome
  if (meta) meta.insertBefore(toggleWrap, meta.firstChild);
}

// ---- the raw view shell -------------------------------------------------

function buildShell() {
  const root = $('#raw');
  if (!root) return;

  // filter bar: a search box, per-kind include/exclude chips, and copy-visible
  const bar = document.createElement('div');
  bar.className = 'raw-bar';

  const search = document.createElement('input');
  search.type = 'text';
  search.className = 'raw-search';
  search.placeholder = 'search the stream...';
  search.addEventListener('input', () => {
    searchTerm = search.value.trim().toLowerCase();
    applyFilterAll();
  });
  searchInput = search;
  bar.appendChild(search);

  const chips = document.createElement('div');
  chips.className = 'raw-chips';
  for (const k of KINDS) {
    const c = document.createElement('button');
    c.type = 'button';
    c.className = 'raw-chip on k-' + k;
    c.dataset.kind = k;
    c.textContent = k;
    c.title = 'toggle ' + k + ' events';
    c.addEventListener('click', () => {
      if (hiddenKinds.has(k)) { hiddenKinds.delete(k); c.classList.add('on'); }
      else { hiddenKinds.add(k); c.classList.remove('on'); }
      applyFilterAll();
    });
    chips.appendChild(c);
  }
  bar.appendChild(chips);

  const tools = document.createElement('div');
  tools.className = 'raw-tools';
  const allBtn = mkBtn('all', () => { hiddenKinds.clear(); syncChips(); applyFilterAll(); });
  const noneBtn = mkBtn('none', () => { KINDS.forEach((k) => hiddenKinds.add(k)); syncChips(); applyFilterAll(); });
  const copyBtn = mkBtn('copy visible', copyVisible);
  tools.append(allBtn, noneBtn, copyBtn);
  bar.appendChild(tools);

  root.appendChild(bar);

  // the scrolling log
  logEl = document.createElement('div');
  logEl.className = 'raw-log';
  logEl.addEventListener('scroll', onScroll);
  root.appendChild(logEl);

  // jump-to-live affordance (shown only when scrolled up)
  jumpBtn = document.createElement('button');
  jumpBtn.type = 'button';
  jumpBtn.className = 'raw-jump';
  jumpBtn.textContent = 'jump to live';
  jumpBtn.hidden = true;
  jumpBtn.addEventListener('click', () => { stuck = true; scrollToBottom(); jumpBtn.hidden = true; });
  root.appendChild(jumpBtn);

  // footer: the rolling-window cap note
  capNote = document.createElement('div');
  capNote.className = 'raw-cap';
  root.appendChild(capNote);
  updateCap();
}

function mkBtn(label, fn) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'raw-tool';
  b.textContent = label;
  b.addEventListener('click', fn);
  return b;
}

function syncChips() {
  for (const c of logRootChips()) {
    const on = !hiddenKinds.has(c.dataset.kind);
    c.classList.toggle('on', on);
  }
}
function logRootChips() {
  return $('#raw') ? $('#raw').querySelectorAll('.raw-chip') : [];
}

// ---- mode switching -----------------------------------------------------

function setMode(next) {
  mode = next === 'raw' ? 'raw' : 'handwritten';
  sessionStorage.setItem('cy-view', mode);
  document.body.classList.toggle('raw-active', mode === 'raw');

  const paper = $('#paper');
  const raw = $('#raw');
  if (paper) paper.hidden = mode === 'raw';
  if (raw) raw.hidden = mode !== 'raw';

  if (toggleWrap) {
    for (const b of toggleWrap.querySelectorAll('.vt-btn')) {
      b.classList.toggle('sel', b.dataset.view === mode);
    }
  }

  if (mode === 'raw') startRaw();
  else stopRaw();
}

function startRaw() {
  if (!hydrated) { hydrated = true; hydrate(); }
  if (!pollTimer) pollTimer = setInterval(pollRaw, POLL_MS);
}
function stopRaw() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// ---- polling ------------------------------------------------------------

async function fetchStream(since) {
  const url = `${STREAM}?since=${since}&limit=500`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('stream ' + res.status);
  return res.json();
}

// First entry into RAW: pull a chunk of backlog so history is visible at once.
async function hydrate() {
  try {
    const data = await fetchStream(-500);
    for (const ev of data.events || []) render(ev);
    if (typeof data.now === 'number') sinceSeq = Math.max(sinceSeq, data.now);
    stuck = true;
    scrollToBottom();
  } catch {
    /* offline: pollRaw will keep trying */
  }
}

async function pollRaw() {
  if (mode !== 'raw') return;
  try {
    const data = await fetchStream(sinceSeq);
    for (const ev of data.events || []) render(ev);
    if (typeof data.now === 'number') sinceSeq = Math.max(sinceSeq, data.now);
  } catch {
    /* transient: try again next tick */
  }
}

// ---- rendering ----------------------------------------------------------

function render(ev) {
  if (typeof ev.seq === 'number' && ev.seq > sinceSeq) sinceSeq = ev.seq;

  // keep the warden->burst association current
  if (ev.kind === 'warden') {
    const p = ev.payload || {};
    wardenSinceGen.push({ category: p.category || 'unknown', chars: p.chars || 0 });
  }

  const row = document.createElement('div');
  row.className = 'rl';
  row.dataset.kind = ev.kind;
  if (typeof ev.seq === 'number') row.dataset.seq = String(ev.seq);

  const head = document.createElement('div');
  head.className = 'rl-head';

  const now = new Date();
  const dt = lastRenderMs == null ? 0 : Math.max(0, Math.round(performance.now() - lastRenderMs));
  lastRenderMs = performance.now();

  const ts = document.createElement('span');
  ts.className = 'rl-ts';
  ts.textContent = clockMs(ev.ts, now);
  head.appendChild(ts);

  const delta = document.createElement('span');
  delta.className = 'rl-dt';
  delta.textContent = '+' + dt + 'ms';
  head.appendChild(delta);

  const seq = document.createElement('span');
  seq.className = 'rl-seq';
  seq.textContent = ev.seq != null ? '#' + ev.seq : '#-';
  head.appendChild(seq);

  const kind = document.createElement('span');
  kind.className = 'rl-kind k-' + ev.kind;
  kind.textContent = ev.kind;
  head.appendChild(kind);

  const sum = document.createElement('span');
  sum.className = 'rl-sum';
  sum.textContent = summaryFor(ev);
  head.appendChild(sum);

  // the text a 'copy visible' pass grabs for this line
  row.__text = `${ts.textContent} ${seq.textContent} ${ev.kind} ${sum.textContent}`;

  // a compact affordance to reveal the raw JSON of any event
  const jbtn = document.createElement('button');
  jbtn.type = 'button';
  jbtn.className = 'rl-json';
  jbtn.textContent = '{}';
  jbtn.title = 'show raw JSON payload';
  head.appendChild(jbtn);

  row.appendChild(head);

  // detail: gen bursts get the structured burst view; everything else gets
  // pretty-printed JSON. Built lazily on first expand to stay cheap.
  const detail = document.createElement('div');
  detail.className = 'rl-detail';
  detail.hidden = true;
  row.appendChild(detail);

  let jsonShown = false;
  let builtStructured = false;
  const drops = ev.kind === 'gen' ? wardenSinceGen.slice() : null;
  if (ev.kind === 'gen') wardenSinceGen = [];

  const showStructured = () => {
    if (!builtStructured) {
      detail.textContent = '';
      if (ev.kind === 'gen') detail.appendChild(burstDetail(ev, drops));
      else detail.appendChild(jsonBlock(ev));
      builtStructured = true;
      jsonShown = ev.kind !== 'gen';
    }
  };
  head.addEventListener('click', (e) => {
    if (e.target === jbtn) return; // the {} button has its own handler
    showStructured();
    detail.hidden = !detail.hidden;
  });
  jbtn.addEventListener('click', () => {
    // force the raw JSON regardless of kind
    detail.textContent = '';
    detail.appendChild(jsonBlock(ev));
    builtStructured = true;
    jsonShown = true;
    detail.hidden = false;
    jbtn.classList.add('on');
  });

  logEl.appendChild(row);
  seenTotal++;
  applyFilterRow(row);
  capRows();
  updateCap();
  if (stuck) scrollToBottom();
}

// ms-grade clock: the event's server second-stamp with the client's arrival
// millisecond appended, so the streaming rate (and stalls) are legible.
function clockMs(tsStr, now) {
  let hhmmss = null;
  if (tsStr) {
    const m = String(tsStr).match(/(\d{2}):(\d{2}):(\d{2})/);
    if (m) hhmmss = m[1] + ':' + m[2] + ':' + m[3];
  }
  if (!hhmmss) {
    hhmmss = String(now.getHours()).padStart(2, '0') + ':' +
      String(now.getMinutes()).padStart(2, '0') + ':' +
      String(now.getSeconds()).padStart(2, '0');
  }
  return hhmmss + '.' + String(now.getMilliseconds()).padStart(3, '0');
}

// A compact one-line rendering of the payload, per kind. Uses textContent
// everywhere upstream, so arbitrary (post-warden) text is safe.
function summaryFor(ev) {
  const p = ev.payload || {};
  switch (ev.kind) {
    case 'text':
      return JSON.stringify(p.s ?? '') + (p.mode && p.mode !== 'journal' ? '  [' + p.mode + (p.lucid ? '/lucid' : '') + ']' : '');
    case 'gen':
      return `${p.mode || '?'}  in=${p.tokens_in} out=${p.tokens_out}  ${p.gen_tok_s}tok/s  ttft=${p.ttft_ms}ms  total=${p.total_ms}ms  (click to expand)`;
    case 'silence':
      return `${p.seconds}s${p.reason ? '  (' + p.reason + ')' : ''}`;
    case 'mode':
      return `${p.from || '?'} -> ${p.to || '?'}${p.cause ? '  cause=' + p.cause : ''}`;
    case 'abort':
      return p.cause === 'warden'
        ? `[redacted by warden: ${p.reason || 'unknown'}]`
        : `cause=${p.cause || '?'}${p.reason ? '  ' + p.reason : ''}`;
    case 'draw': {
      const n = Array.isArray(p.strokes) ? p.strokes.length : 0;
      if (p.dream) return `dream stroke  seq=${p.seq}/${p.total}`;
      const pass = p.pass ? ` pass ${(p.pass.i ?? 0) + 1}/${p.pass.n ?? 1}` : '';
      return `${p.title ? '"' + p.title + '"' : '(untitled)'}${pass}  strokes=${n}`;
    }
    case 'vitals':
      return `hr=${p.hr}  mode=${p.mode || '?'}  day=${p.day}`;
    case 'host':
      return `cpu=${p.cpu}%  mem=${p.memPct}%  cyCpu=${p.cyCpu ?? '?'}%  ollama=${p.ollamaProcs ?? '?'}`;
    case 'power':
      return `${p.watts}W  ${p.cost_total}GBP  ${p.kwh_total}kWh  ${p.cost_per_hour}/h`;
    case 'tempo':
      return `speed=${p.speed}%  viewers=${p.viewers}${p.custom ? '  custom' : ''}`;
    case 'postcard_in':
      return `from ${p.from || '?'}${p.image != null && p.image !== null ? '  +picture' : ''}${p.body ? '  ' + JSON.stringify(String(p.body).slice(0, 60)) : ''}`;
    case 'postcard_out':
      return `reply_to=${p.reply_to}  ${JSON.stringify(String(p.body || '').slice(0, 70))}`;
    case 'news_in':
      return `${p.source || '?'}: ${p.headline || ''}`;
    case 'warden':
      return `[redacted by warden: ${p.category || 'unknown'}]  (${p.chars || 0} chars dropped)`;
    case 'event':
      return `${p.name || '?'}${p.who ? '  who=' + p.who : ''}`;
    case 'day':
      return `DAY ${p.n}${p.date ? '  ' + p.date : ''}`;
    default:
      return JSON.stringify(p);
  }
}

// The expandable per-burst detail: the full prompt (zones A/B/C with char counts),
// the full post-warden output as one copyable block, sampling params, timings, the
// mode/form/style directives, and anything the warden dropped this burst.
function burstDetail(ev, drops) {
  const p = ev.payload || {};
  const box = document.createElement('div');
  box.className = 'burst';

  // --- PROMPT ---
  const promptSec = section('PROMPT');
  promptSec.appendChild(zoneBlock('ZONE A', 'voice / fixed (cached prefix)', p.zone_a));
  promptSec.appendChild(zoneBlock('ZONE B', 'context - Cy\'s fed-back prose', p.zone_b));
  promptSec.appendChild(zoneBlock('ZONE C', 'directives - volatile, rebuilt per burst', p.zone_c));
  box.appendChild(promptSec);

  // --- OUTPUT ---
  const outSec = section('OUTPUT  (post-warden)');
  const out = document.createElement('pre');
  out.className = 'burst-pre';
  out.textContent = p.output != null ? String(p.output) : '(not emitted for this burst)';
  outSec.appendChild(meta(`${(p.output || '').length} chars`));
  outSec.appendChild(out);
  box.appendChild(outSec);

  // --- SAMPLING ---
  const samp = section('SAMPLING');
  samp.appendChild(kvGrid([
    ['temperature', p.temperature],
    ['top_p', p.top_p],
    ['repeat_penalty', p.repeat_penalty],
    ['num_predict', p.num_predict],
    ['num_ctx', p.num_ctx],
    ['threads', p.threads],
  ]));
  box.appendChild(samp);

  // --- TIMINGS / COUNTERS ---
  const tim = section('TIMINGS & COUNTERS');
  tim.appendChild(kvGrid([
    ['prompt_eval_count', p.tokens_in],
    ['prompt tok/s', p.prompt_tok_s],
    ['eval_count', p.tokens_out],
    ['gen tok/s', p.gen_tok_s],
    ['time to first token', p.ttft_ms != null ? p.ttft_ms + ' ms' : null],
    ['total', p.total_ms != null ? p.total_ms + ' ms' : null],
  ]));
  box.appendChild(tim);

  // --- CONTEXT: mode / form / styles ---
  const ctx = section('MODE / FORM / STYLE');
  ctx.appendChild(labeled('mode', p.mode || '(unknown)'));
  ctx.appendChild(labeled('form', p.form || '(default)'));
  ctx.appendChild(labeled('styles', p.styles || '(none fired)'));
  box.appendChild(ctx);

  // --- WARDEN DROPS this burst ---
  const wd = section('WARDEN DROPS (this burst)');
  if (drops && drops.length) {
    for (const d of drops) {
      const line = document.createElement('div');
      line.className = 'burst-drop';
      line.textContent = `[redacted by warden: ${d.category}]  (${d.chars} chars)`;
      wd.appendChild(line);
    }
  } else {
    wd.appendChild(meta('none this burst'));
  }
  box.appendChild(wd);

  // --- copy + raw JSON ---
  const actions = document.createElement('div');
  actions.className = 'burst-actions';
  const copyBtn = mkBtn('copy burst', () => copyText(burstPlain(ev, drops), copyBtn));
  const jsonBtn = mkBtn('raw JSON', () => {
    let pre = box.querySelector('.burst-json');
    if (pre) { pre.remove(); return; }
    pre = jsonBlock(ev);
    pre.classList.add('burst-json');
    box.appendChild(pre);
  });
  actions.append(copyBtn, jsonBtn);
  box.appendChild(actions);

  return box;
}

function section(title) {
  const s = document.createElement('div');
  s.className = 'burst-sec';
  const h = document.createElement('div');
  h.className = 'burst-h';
  h.textContent = title;
  s.appendChild(h);
  return s;
}

function zoneBlock(label, note, text) {
  const wrap = document.createElement('div');
  wrap.className = 'zone';
  const h = document.createElement('div');
  h.className = 'zone-h';
  const count = text != null ? String(text).length : null;
  h.textContent = `${label}  [${count != null ? count + ' chars' : 'n/a'}]  ${note}`;
  wrap.appendChild(h);
  const pre = document.createElement('pre');
  pre.className = 'zone-pre';
  pre.textContent = text != null ? String(text) : '(not emitted for this burst)';
  wrap.appendChild(pre);
  return wrap;
}

function kvGrid(pairs) {
  const g = document.createElement('div');
  g.className = 'kvgrid';
  for (const [k, v] of pairs) {
    const cell = document.createElement('div');
    cell.className = 'kv';
    const kk = document.createElement('span');
    kk.className = 'kv-k';
    kk.textContent = k;
    const vv = document.createElement('span');
    vv.className = 'kv-v';
    vv.textContent = v == null ? 'n/a' : String(v);
    cell.append(kk, vv);
    g.appendChild(cell);
  }
  return g;
}

function labeled(k, v) {
  const d = document.createElement('div');
  d.className = 'burst-line';
  const kk = document.createElement('span');
  kk.className = 'burst-k';
  kk.textContent = k + ':';
  const vv = document.createElement('span');
  vv.className = 'burst-v';
  vv.textContent = String(v);
  d.append(kk, vv);
  return d;
}

function meta(text) {
  const m = document.createElement('div');
  m.className = 'burst-meta';
  m.textContent = text;
  return m;
}

function jsonBlock(ev) {
  const pre = document.createElement('pre');
  pre.className = 'rl-jsonpre';
  try { pre.textContent = JSON.stringify(ev, null, 2); }
  catch { pre.textContent = String(ev); }
  return pre;
}

// Plaintext of a whole burst, for the per-burst copy button.
function burstPlain(ev, drops) {
  const p = ev.payload || {};
  const L = [];
  L.push(`=== BURST  seq #${ev.seq}  ${ev.ts || ''}  mode=${p.mode || '?'} ===`);
  L.push('');
  L.push(`ZONE A [${len(p.zone_a)} chars] - voice / fixed`);
  L.push(p.zone_a != null ? String(p.zone_a) : '(not emitted)');
  L.push('');
  L.push(`ZONE B [${len(p.zone_b)} chars] - context`);
  L.push(p.zone_b != null ? String(p.zone_b) : '(not emitted)');
  L.push('');
  L.push(`ZONE C [${len(p.zone_c)} chars] - directives`);
  L.push(p.zone_c != null ? String(p.zone_c) : '(not emitted)');
  L.push('');
  L.push(`OUTPUT [${len(p.output)} chars, post-warden]`);
  L.push(p.output != null ? String(p.output) : '(not emitted)');
  L.push('');
  L.push('SAMPLING: ' + [`temperature=${p.temperature}`, `top_p=${p.top_p}`, `repeat_penalty=${p.repeat_penalty}`, `num_predict=${p.num_predict}`, `num_ctx=${p.num_ctx}`, `threads=${p.threads}`].join('  '));
  L.push('TIMINGS: ' + [`prompt_eval_count=${p.tokens_in}`, `prompt_tok/s=${p.prompt_tok_s}`, `eval_count=${p.tokens_out}`, `gen_tok/s=${p.gen_tok_s}`, `ttft=${p.ttft_ms}ms`, `total=${p.total_ms}ms`].join('  '));
  L.push('FORM: ' + (p.form || '(default)'));
  L.push('STYLES: ' + (p.styles || '(none)'));
  if (drops && drops.length) L.push('WARDEN DROPS: ' + drops.map((d) => `[${d.category}:${d.chars}c]`).join(' '));
  else L.push('WARDEN DROPS: none');
  return L.join('\n');
}
function len(s) { return s != null ? String(s).length : 0; }

// ---- filter + search ----------------------------------------------------

function applyFilterRow(row) {
  const kindHidden = hiddenKinds.has(row.dataset.kind);
  const matches = !searchTerm || (row.__text || '').toLowerCase().includes(searchTerm);
  row.classList.toggle('filtered', kindHidden || !matches);
}
function applyFilterAll() {
  for (const row of logEl.querySelectorAll('.rl')) applyFilterRow(row);
  updateCap();
}

// ---- scrolling ----------------------------------------------------------

function onScroll() {
  const nearBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
  stuck = nearBottom;
  if (jumpBtn) jumpBtn.hidden = nearBottom;
}
function scrollToBottom() {
  logEl.scrollTop = logEl.scrollHeight;
  if (jumpBtn) jumpBtn.hidden = true;
}

// ---- rolling-window cap -------------------------------------------------
//
// NOTE (performance with thousands of events): rather than a full virtual list,
// the log keeps at most MAX_ROWS event rows in the DOM. Once exceeded, the oldest
// rows are removed from the top and counted; the footer reports how many earlier
// events are no longer shown. Search and the kind filters operate over the
// retained window. This keeps the DOM bounded and scrolling smooth no matter how
// long the stream runs, at the cost of not being able to scroll back past the cap.

function capRows() {
  let rows = logEl.children.length;
  while (rows > MAX_ROWS) {
    logEl.removeChild(logEl.firstChild);
    dropped++;
    rows--;
  }
}
function updateCap() {
  if (!capNote) return;
  const shown = logEl.querySelectorAll('.rl:not(.filtered)').length;
  const inDom = logEl.querySelectorAll('.rl').length;
  const filteredOut = inDom - shown;
  let s = `showing ${shown} of ${seenTotal} events (rolling window: last ${MAX_ROWS} kept in DOM`;
  if (dropped) s += `, ${dropped} earlier dropped`;
  s += ')';
  if (filteredOut) s += ` - ${filteredOut} hidden by filter/search`;
  capNote.textContent = s;
}

// ---- copy ---------------------------------------------------------------

function copyVisible() {
  const lines = [...logEl.querySelectorAll('.rl:not(.filtered)')].map((r) => r.__text || '');
  copyText(lines.join('\n'), null);
}

async function copyText(text, btn) {
  const flash = (msg) => {
    if (!btn) return;
    const prev = btn.textContent;
    btn.textContent = msg;
    setTimeout(() => { btn.textContent = prev; }, 900);
  };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      flash('copied');
      return;
    }
    throw new Error('no clipboard');
  } catch {
    // fallback for headless / insecure contexts
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      flash('copied');
    } catch {
      flash('copy failed');
    }
  }
}

boot();
