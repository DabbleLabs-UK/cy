// timeseries-chart - a framework-free <timeseries-chart> custom element.
//
// A scrubbing time-series chart whose ENTIRE display state is a viewport:
// three values - CENTRE (the timestamp at the middle of the view), SPAN (how
// much time is visible, in seconds) and FOLLOW (whether it live-tails new
// data). Every input is just a different writer to that same state: a drag
// writes centre, a wheel writes span, a preset writes span, a pinch writes
// both. Coherence comes from the shared state, not from matching gestures.
//
// Design commitments (see README for the full contract):
//   - No animation. Every visual state is a pure function of the viewport,
//     recomputed each frame, so the chart is nailed to the pointer. Hard clamps
//     at bounds and zoom limits - no bounce, no rubber-band, no easing.
//   - Zoom is CURSOR-ANCHORED: the timestamp under the pointer stays put.
//   - Plot RATES, not bucket sums, so a value means the same thing at every
//     zoom level. Two modes, both zoom-invariant: rate and cumulative.
//   - Extractable from day one: its own directory, no reach into app internals,
//     data handed in through a defined shape, theme entirely via CSS custom
//     properties. No npm dependencies - vanilla JS, custom element, canvas.
//
// It takes an ARBITRARY list of named, coloured series; the categories
// (energy, spend, CPU, ...) are never the component's business.

// Reuse this module's own URL query string (the host page's cache-busting
// ?v=, applied via an import map - see index.php's cy_import_map()) so the
// stylesheet is never served stale from a browser cache either.
const CSS_HREF = new URL('./timeseries-chart.css' + new URL(import.meta.url).search, import.meta.url).href;

// ---------------------------------------------------------------------------
// Tunables - the cross-platform contract. These values (thresholds, min/max
// spans, defaults) are documented in the README's single tunables table and
// are copied back into the canonical spec. Any of them can be overridden per
// instance via the `options` property.
// ---------------------------------------------------------------------------
export const TUNABLES = {
  slopPx: 8,           // px of movement before a drag claims + locks its axis
  wheelZoomRate: 0.0015, // span multiplier exponent per unit wheel deltaY
  pinchWheelRate: 0.01,  // same, for ctrlKey wheel (trackpad pinch) - finer
  keyPanFraction: 0.15,  // arrow-key pan step, as a fraction of the span
  keyZoomFactor: 1.3,    // +/- key zoom step, span multiplier per press
  minSpan: 5,          // seconds - closest zoom-in
  maxSpan: null,       // seconds - furthest zoom-out; null => the data extent
  defaultSpan: 1800,   // seconds - initial span when none is supplied
  ratePer: 3600,       // seconds - report delta rates per this (3600 = per hour)
  longPressMs: 450,    // touch hold before the readout latches (informational)
  followSnapPx: 6,     // within this many px of the newest sample => re-follow
};

// Categorical palette - assigned in a FIXED order per series index, never
// cycled, never reassigned when a filter changes the series count. A chosen set
// of steps for dark surfaces; override via --tsc-series-N custom properties.
const PALETTE = [
  '#4f9cff', '#ffb54f', '#4fd08a', '#ff6a80',
  '#b58cff', '#3fd0d0', '#e0d24f', '#ff8f4f',
];

// ---------------------------------------------------------------------------
// Small maths helpers
// ---------------------------------------------------------------------------
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

// A "nice" ceiling: 1, 2, 2.5, 5 or 10 times a power of ten, >= x. Keeps the Y
// axis honest without pinning it to the raw data max.
function niceCeil(x) {
  if (!(x > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  const f = x / p;
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nf * p;
}

// First index i in a sorted array where arr[i] >= x (a lower bound).
function lowerBound(arr, x) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < x) lo = mid + 1; else hi = mid;
  }
  return lo;
}
// Count of entries <= x (an upper bound index).
function upperBound(arr, x) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= x) lo = mid + 1; else hi = mid;
  }
  return lo;
}

function formatNum(v) {
  if (!isFinite(v)) return '-';
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 1000) return v.toFixed(0);
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  if (a >= 0.1) return v.toFixed(2);
  return v.toFixed(3);
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const p2 = (n) => (n < 10 ? '0' + n : '' + n);
const fmtHM = (t) => { const d = new Date(t); return p2(d.getHours()) + ':' + p2(d.getMinutes()); };
const fmtHMS = (t) => { const d = new Date(t); return p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds()); };
const fmtDate = (t) => { const d = new Date(t); return MONTHS[d.getMonth()] + ' ' + d.getDate(); };
const fmtDateHM = (t) => fmtDate(t) + ' ' + fmtHM(t);

// A ladder of "nice" time steps in seconds, for x-axis ticks.
const TIME_LADDER = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800,
  3600, 7200, 10800, 21600, 43200, 86400, 172800, 604800, 1209600, 2592000];

// Pick the axis tick step (ms) and the axis + readout formatters for a span.
// The readout is always one notch FINER than the axis, so scrubbing tells you
// something the ticks don't.
function timeAxis(spanMs, plotW) {
  const targetTicks = Math.max(3, Math.min(8, Math.round(plotW / 110)));
  const targetStepSec = (spanMs / 1000) / targetTicks;
  let stepSec = TIME_LADDER[TIME_LADDER.length - 1];
  for (const s of TIME_LADDER) { if (s >= targetStepSec) { stepSec = s; break; } }
  const stepMs = stepSec * 1000;
  let axis, readout;
  if (stepSec < 60) { axis = fmtHMS; readout = fmtHMS; }
  else if (stepSec < 86400) { axis = fmtHM; readout = fmtHMS; }
  else { axis = fmtDate; readout = fmtDateHM; }
  return { stepMs, axis, readout };
}

// ---------------------------------------------------------------------------
// SeriesModel - one series, precomputed for O(log n) queries. It knows nothing
// about pixels; it answers value questions in time.
//
// kind === 'level'  : v is an instantaneous rate/level (CPU %, power kW). It is
//                     already zoom-invariant; averaging it when zoomed out is
//                     honest. Cumulative = the running time-integral.
// kind === 'delta'  : v is an increment that occurred at t (a cost, a count).
//                     Rate = sum of deltas per unit time. Cumulative = running
//                     sum.
// ---------------------------------------------------------------------------
class SeriesModel {
  constructor(series, index, opts) {
    this.id = series.id != null ? String(series.id) : `s${index}`;
    this.name = series.name != null ? String(series.name) : this.id;
    this.color = series.color || PALETTE[index % PALETTE.length];
    this.cssColorVar = `--tsc-series-${index + 1}`;
    this.kind = series.kind === 'delta' ? 'delta' : 'level';
    this.unit = series.unit != null ? String(series.unit) : '';
    this.ratePer = series.ratePer != null ? series.ratePer : (opts.ratePer || 3600);
    this.rateLabel = series.rateLabel != null ? series.rateLabel : '/h';
    this.defaultSpan = series.defaultSpan != null ? series.defaultSpan : null; // seconds
    this.maxSpan = series.maxSpan != null ? series.maxSpan : null;             // seconds
    this.setSamples(series.samples || []);
  }

  setSamples(samples) {
    const s = samples
      .filter((p) => p && isFinite(p.t) && isFinite(p.v))
      .slice()
      .sort((a, b) => a.t - b.t);
    const n = s.length;
    this.t = new Float64Array(n);
    this.v = new Float64Array(n);
    for (let i = 0; i < n; i++) { this.t[i] = s[i].t; this.v[i] = s[i].v; }
    // Prefix sum of deltas: csum[i] = sum of v[0..i-1].
    this.csum = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) this.csum[i + 1] = this.csum[i] + this.v[i];
    // Prefix integral (trapezoid, in value*seconds) for levels.
    this.integ = new Float64Array(n);
    for (let i = 1; i < n; i++) {
      const dtSec = (this.t[i] - this.t[i - 1]) / 1000;
      this.integ[i] = this.integ[i - 1] + (this.v[i] + this.v[i - 1]) / 2 * dtSec;
    }
  }

  // Append one sample, keeping the arrays sorted for the common append-at-end
  // (live-tail) case; falls back to a full rebuild for out-of-order inserts.
  push(sample) {
    if (!sample || !isFinite(sample.t) || !isFinite(sample.v)) return;
    const n = this.t.length;
    if (n === 0 || sample.t >= this.t[n - 1]) {
      const t = new Float64Array(n + 1); t.set(this.t); t[n] = sample.t;
      const v = new Float64Array(n + 1); v.set(this.v); v[n] = sample.v;
      const csum = new Float64Array(n + 2); csum.set(this.csum); csum[n + 1] = csum[n] + sample.v;
      const integ = new Float64Array(n + 1); integ.set(this.integ);
      if (n > 0) {
        const dtSec = (sample.t - this.t[n - 1]) / 1000;
        integ[n] = integ[n - 1] + (sample.v + this.v[n - 1]) / 2 * dtSec;
      }
      this.t = t; this.v = v; this.csum = csum; this.integ = integ;
    } else {
      const merged = [];
      for (let i = 0; i < n; i++) merged.push({ t: this.t[i], v: this.v[i] });
      merged.push(sample);
      this.setSamples(merged);
    }
  }

  get length() { return this.t.length; }
  get tMin() { return this.t.length ? this.t[0] : null; }
  get tMax() { return this.t.length ? this.t[this.t.length - 1] : null; }

  // Instantaneous level, linearly interpolated between samples; held flat past
  // the ends (no wild extrapolation).
  levelAt(t) {
    const n = this.t.length;
    if (n === 0) return 0;
    if (t <= this.t[0]) return this.v[0];
    if (t >= this.t[n - 1]) return this.v[n - 1];
    const i = lowerBound(this.t, t); // first index with t[i] >= t
    const t0 = this.t[i - 1], t1 = this.t[i];
    const f = (t - t0) / (t1 - t0);
    return this.v[i - 1] + (this.v[i] - this.v[i - 1]) * f;
  }

  // Integral of the level from the first sample up to t, in value*seconds.
  // Clamped to the sampled range (no extrapolation of the integral).
  integralTo(t) {
    const n = this.t.length;
    if (n === 0) return 0;
    if (t <= this.t[0]) return 0;
    if (t >= this.t[n - 1]) return this.integ[n - 1];
    const i = lowerBound(this.t, t);
    const t0 = this.t[i - 1], t1 = this.t[i];
    const f = (t - t0) / (t1 - t0);
    const vt = this.v[i - 1] + (this.v[i] - this.v[i - 1]) * f;
    const partial = (this.v[i - 1] + vt) / 2 * ((t - t0) / 1000);
    return this.integ[i - 1] + partial;
  }

  // Time-weighted average level over [t0, t1] (a zoom-invariant "rate").
  averageOver(t0, t1) {
    if (t1 <= t0) return this.levelAt(t0);
    return (this.integralTo(t1) - this.integralTo(t0)) / ((t1 - t0) / 1000);
  }

  // Running sum of deltas with time <= t.
  cumDeltaAt(t) { return this.csum[upperBound(this.t, t)]; }
  // Sum of deltas in the half-open window (t0, t1].
  sumDeltas(t0, t1) { return this.cumDeltaAt(t1) - this.cumDeltaAt(t0); }
}

// ---------------------------------------------------------------------------
// The element
// ---------------------------------------------------------------------------
export class TimeseriesChart extends HTMLElement {
  static get observedAttributes() {
    return ['mode', 'form', 'follow', 'span', 'min-span', 'max-span', 'rate-per'];
  }

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <link rel="stylesheet" href="${CSS_HREF}">
      <div class="tsc" part="root">
        <div class="legend" part="legend" hidden></div>
        <canvas class="plot" part="canvas"></canvas>
        <div class="tooltip" part="tooltip" hidden></div>
        <span class="live" aria-live="polite" role="status"></span>
      </div>`;
    this.$root = root.querySelector('.tsc');
    this.$legend = root.querySelector('.legend');
    this.$canvas = root.querySelector('.plot');
    this.$tooltip = root.querySelector('.tooltip');
    this.$live = root.querySelector('.live');
    this.ctx = this.$canvas.getContext('2d');

    this.tun = { ...TUNABLES };
    this._data = { series: [] };
    this.models = [];
    this._mode = 'rate';       // 'rate' | 'cumulative'
    this._form = 'auto';       // 'auto' | 'line' | 'stacked'
    // Viewport - the whole display state. Times in ms; span stored in ms.
    this.state = { centre: 0, span: this.tun.defaultSpan * 1000, follow: true };
    this._initedViewport = false;

    // Interaction state machine.
    this.pointers = new Map();
    this.gesture = 'none'; // 'none' | 'pending' | 'panx' | 'pany' | 'pinch'
    this.rect = null;      // container rect, refreshed at gesture start / render
    this.plot = { left: 0, top: 0, width: 0, height: 0 };
    this.hover = null;     // {x, y} in container px, for the tooltip
    this._raf = 0;
    this._lastFrame = null; // cached render model, for tooltip reads

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onWheel = this._onWheel.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onLeave = this._onLeave.bind(this);
    this._ro = new ResizeObserver(() => this._measure(true));
  }

  // ----- lifecycle --------------------------------------------------------
  connectedCallback() {
    if (!this.hasAttribute('tabindex')) this.setAttribute('tabindex', '0');
    if (!this.hasAttribute('role')) this.setAttribute('role', 'group');
    if (!this.hasAttribute('aria-label')) this.setAttribute('aria-label', 'Time series chart');
    this.$canvas.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointermove', this._onPointerMove, { passive: false });
    window.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('pointercancel', this._onPointerUp);
    this.$canvas.addEventListener('wheel', this._onWheel, { passive: false });
    this.$canvas.addEventListener('pointerleave', this._onLeave);
    this.addEventListener('keydown', this._onKeyDown);
    this._ro.observe(this.$root);
    this._measure(true);
  }

  disconnectedCallback() {
    this.$canvas.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener('pointercancel', this._onPointerUp);
    this.$canvas.removeEventListener('wheel', this._onWheel);
    this.$canvas.removeEventListener('pointerleave', this._onLeave);
    this.removeEventListener('keydown', this._onKeyDown);
    this._ro.disconnect();
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  attributeChangedCallback(name, _old, val) {
    switch (name) {
      case 'mode': this.mode = val || 'rate'; break;
      case 'form': this.form = val || 'auto'; break;
      case 'follow': this.setViewport({ follow: val !== null && val !== 'false' }); break;
      case 'span': if (val) this.setViewport({ span: parseFloat(val) }); break;
      case 'min-span': if (val) { this.tun.minSpan = parseFloat(val); this._clampCommit(this.state.centre, this.state.span, false); } break;
      case 'max-span': this.tun.maxSpan = val ? parseFloat(val) : null; this._clampCommit(this.state.centre, this.state.span, false); break;
      case 'rate-per': if (val) { this.tun.ratePer = parseFloat(val); this._schedule(); } break;
    }
  }

  // ----- public API -------------------------------------------------------
  set data(d) {
    this._data = d && Array.isArray(d.series) ? d : { series: [] };
    this.models = this._data.series.map((s, i) => new SeriesModel(s, i, this.tun));
    if (!this._initedViewport) this._initViewport();
    else this._afterDataChange();
    this._buildLegend();
    this._schedule();
  }
  get data() { return this._data; }

  set options(o) {
    o = o || {};
    for (const k of Object.keys(TUNABLES)) if (o[k] != null) this.tun[k] = o[k];
    if (o.mode) this._mode = o.mode;
    if (o.form) this._form = o.form;
    // Rebuild models so per-series ratePer defaults pick up an option change.
    this.models = this._data.series.map((s, i) => new SeriesModel(s, i, this.tun));
    if (o.follow != null) this.state.follow = !!o.follow;
    if (o.span != null) this.state.span = o.span * 1000;
    this._clampCommit(this.state.centre, this.state.span, this.state.follow);
    this._buildLegend();
    this._schedule();
  }

  set mode(m) { this._mode = m === 'cumulative' ? 'cumulative' : 'rate'; this._schedule(); this._announce(); }
  get mode() { return this._mode; }

  set form(f) { this._form = (f === 'line' || f === 'stacked') ? f : 'auto'; this._buildLegend(); this._schedule(); }
  get form() { return this._form; }

  set follow(v) { this.setViewport({ follow: !!v }); }
  get follow() { return this.state.follow; }

  // The viewport, in the public unit: centre is a ms timestamp, span is seconds.
  get viewport() { return { centre: this.state.centre, span: this.state.span / 1000, follow: this.state.follow }; }

  // Every writer routes through here. `span` is in seconds.
  setViewport({ centre, span, follow } = {}) {
    let c = centre != null ? centre : this.state.centre;
    let sp = span != null ? span * 1000 : this.state.span;
    const f = follow != null ? !!follow : this.state.follow;
    this._clampCommit(c, sp, f);
    this._schedule();
    this._announce();
  }

  // Append a sample to a series and (if following) keep the newest edge pinned.
  push(seriesId, sample) {
    const m = this.models.find((x) => x.id === String(seriesId));
    if (!m) return;
    m.push(sample);
    this._afterDataChange();
    this._schedule();
  }

  // Jump helpers - all just viewport writes.
  toStart() { const [lo] = this._extent(); this._clampCommit(lo + this.state.span / 2, this.state.span, false); this._schedule(); this._announce(); }
  toEnd() { this._clampCommit(this.state.centre, this.state.span, true); this._schedule(); this._announce(); }

  // ----- viewport internals ----------------------------------------------
  _extent() {
    let lo = Infinity, hi = -Infinity;
    for (const m of this.models) {
      if (m.tMin != null && m.tMin < lo) lo = m.tMin;
      if (m.tMax != null && m.tMax > hi) hi = m.tMax;
    }
    if (!isFinite(lo) || !isFinite(hi)) { const now = Date.now(); return [now - this.state.span, now]; }
    if (lo === hi) return [lo - this.state.span / 2, hi + this.state.span / 2];
    return [lo, hi];
  }

  _spanBounds() {
    const [lo, hi] = this._extent();
    const extent = Math.max(hi - lo, 1000);
    const minMs = Math.max((this.tun.minSpan || 1) * 1000, 1);
    // Per-series max span narrows the furthest zoom-out when set.
    let maxSec = this.tun.maxSpan;
    for (const m of this.models) if (m.maxSpan != null) maxSec = maxSec == null ? m.maxSpan : Math.min(maxSec, m.maxSpan);
    const maxMs = maxSec != null ? maxSec * 1000 : extent;
    return [minMs, Math.max(maxMs, minMs)];
  }

  _clampSpan(sp) { const [mn, mx] = this._spanBounds(); return clamp(sp, mn, mx); }

  _clampCentre(c, sp) {
    const [lo, hi] = this._extent();
    const min = lo + sp / 2, max = hi - sp / 2;
    if (min > max) return max; // span exceeds the data extent: pin the newest edge
    return clamp(c, min, max);
  }

  // Clamp span then centre, then decide FOLLOW from proximity to the newest
  // edge (unless follow is being explicitly forced off). Hard clamps only.
  _clampCommit(centre, span, followWanted) {
    const sp = this._clampSpan(span);
    let c = this._clampCentre(centre, sp);
    const [, hi] = this._extent();
    const spanPerPx = this.plot.width > 0 ? sp / this.plot.width : sp / 800;
    let follow = followWanted;
    if (follow) { c = this._clampCentre(hi - sp / 2, sp); }
    else {
      // Re-arm follow when the user has panned/zoomed right up to the edge.
      follow = (c + sp / 2) >= (hi - spanPerPx * this.tun.followSnapPx);
      if (follow) c = this._clampCentre(hi - sp / 2, sp);
    }
    this.state.centre = c; this.state.span = sp; this.state.follow = follow;
  }

  _initViewport() {
    const [lo, hi] = this._extent();
    // Prefer an explicit span attribute, then a single series' default, then the tunable.
    let sec = null;
    if (this.hasAttribute('span')) sec = parseFloat(this.getAttribute('span'));
    else if (this.models.length === 1 && this.models[0].defaultSpan != null) sec = this.models[0].defaultSpan;
    else sec = this.tun.defaultSpan;
    const follow = this.hasAttribute('follow') ? this.getAttribute('follow') !== 'false' : true;
    if (this.hasAttribute('mode')) this._mode = this.getAttribute('mode') === 'cumulative' ? 'cumulative' : 'rate';
    if (this.hasAttribute('form')) this._form = this.getAttribute('form');
    this.state.span = sec * 1000;
    this.state.centre = follow ? hi : (lo + hi) / 2;
    this.state.follow = follow;
    this._clampCommit(this.state.centre, this.state.span, follow);
    this._initedViewport = true;
  }

  _afterDataChange() { this._clampCommit(this.state.centre, this.state.span, this.state.follow); }

  // ----- pixel <-> time mapping (plot-local x) ----------------------------
  _timeAt(px) { return this.state.centre + (px - this.plot.width / 2) / this.plot.width * this.state.span; }
  _pxAt(t) { return (t - this.state.centre) / this.state.span * this.plot.width + this.plot.width / 2; }

  // ----- input: pointer ---------------------------------------------------
  _localX(e) { return e.clientX - this.rect.left - this.plot.left; }
  _localY(e) { return e.clientY - this.rect.top - this.plot.top; }

  _onPointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.focus();
    this._measure(false);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { this.$canvas.setPointerCapture(e.pointerId); } catch (_) {}
    if (this.pointers.size === 2) {
      // Enter pinch: capture the anchor time under the centroid.
      const pts = [...this.pointers.values()];
      const cx = (pts[0].x + pts[1].x) / 2 - this.rect.left - this.plot.left;
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      this.gesture = 'pinch';
      this._pinch = { startSpan: this.state.span, startDist: dist,
        anchorT: this._timeAt(cx) };
      this._clearLongPress();
    } else {
      this.gesture = 'pending';
      this._down = { x: e.clientX, y: e.clientY, startCentre: this.state.centre, id: e.pointerId };
      // Touch shows the readout on contact (scrub); a genuine long-press just
      // latches what is already there.
      if (e.pointerType !== 'mouse') {
        this.hover = { x: this._localX(e) + this.plot.left, y: this._localY(e) + this.plot.top };
        this._schedule();
        this._longPress = setTimeout(() => { this._latched = true; }, this.tun.longPressMs);
      }
    }
  }

  _onPointerMove(e) {
    // Hover (mouse, no button) -> move the tooltip.
    if (!this.pointers.has(e.pointerId)) {
      if (e.pointerType === 'mouse') {
        this.rect = this.$root.getBoundingClientRect(); // may have scrolled since last measure
        if (this._insidePlot(e)) {
          this.hover = { x: this._localX(e) + this.plot.left, y: this._localY(e) + this.plot.top };
          this._schedule();
        } else if (this.gesture === 'none' && this.hover) {
          this.hover = null; this._schedule();
        }
      }
      return;
    }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.gesture === 'pinch') {
      const pts = [...this.pointers.values()];
      if (pts.length < 2) return;
      const cx = (pts[0].x + pts[1].x) / 2 - this.rect.left - this.plot.left;
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      const span = this._clampSpan(this._pinch.startSpan * (this._pinch.startDist / dist));
      // Anchored on the centroid: the anchor time stays under the centroid,
      // and the centre tracks the centroid as it slides (pan not suppressed).
      const centre = this._pinch.anchorT - (cx - this.plot.width / 2) / this.plot.width * span;
      e.preventDefault();
      this._clampCommit(centre, span, false);
      this.hover = { x: cx + this.plot.left, y: this._localY(e) + this.plot.top };
      this._schedule();
      return;
    }

    const dx = e.clientX - this._down.x;
    const dy = e.clientY - this._down.y;

    if (this.gesture === 'pending') {
      if (Math.hypot(dx, dy) < this.tun.slopPx) {
        // Below slop: for touch keep the readout tracking the finger.
        if (e.pointerType !== 'mouse') { this.hover = { x: this._localX(e) + this.plot.left, y: this._localY(e) + this.plot.top }; this._schedule(); }
        return;
      }
      // Claim + LOCK the axis for the rest of the gesture. No mid-drag switch.
      if (Math.abs(dx) >= Math.abs(dy)) { this.gesture = 'panx'; }
      else { this.gesture = 'pany'; this._clearLongPress(); return; } // vertical falls through to the page
    }

    if (this.gesture === 'pany') return; // let the page scroll

    if (this.gesture === 'panx') {
      e.preventDefault(); // stop page sideways-scroll / back-swipe
      const centre = this._down.startCentre - (dx / this.plot.width) * this.state.span;
      this._clampCommit(centre, this.state.span, false);
      if (e.pointerType !== 'mouse') this.hover = { x: this._localX(e) + this.plot.left, y: this._localY(e) + this.plot.top };
      this._schedule();
    }
  }

  _onPointerUp(e) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    try { this.$canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    this._clearLongPress();
    if (this.pointers.size === 1 && this.gesture === 'pinch') {
      // Drop back to a single-finger pan from wherever the remaining finger is.
      const [only] = [...this.pointers.entries()];
      this.gesture = 'pending';
      this._down = { x: only[1].x, y: only[1].y, startCentre: this.state.centre, id: only[0] };
      return;
    }
    if (this.pointers.size === 0) {
      this.gesture = 'none';
      this._latched = false;
      if (e.pointerType !== 'mouse') { this.hover = null; this._schedule(); }
    }
  }

  _onLeave(e) {
    if (e.pointerType === 'mouse' && this.gesture === 'none') { this.hover = null; this._schedule(); }
  }

  _clearLongPress() { if (this._longPress) { clearTimeout(this._longPress); this._longPress = 0; } }

  _insidePlot(e) {
    if (!this.rect) return false;
    const x = e.clientX - this.rect.left, y = e.clientY - this.rect.top;
    return x >= this.plot.left && x <= this.plot.left + this.plot.width &&
           y >= this.plot.top && y <= this.plot.top + this.plot.height;
  }

  // ----- input: wheel -----------------------------------------------------
  _onWheel(e) {
    this._measure(false);
    const rate = e.ctrlKey ? this.tun.pinchWheelRate : this.tun.wheelZoomRate;
    const factor = Math.exp(e.deltaY * rate);
    const newSpan = this._clampSpan(this.state.span * factor);
    if (newSpan === this.state.span) {
      // At the zoom limit in this direction - RELEASE the wheel to the page so
      // the user never gets stuck on a tall dashboard.
      return;
    }
    e.preventDefault();
    const px = this._localX(e);
    const anchorT = this._timeAt(px);
    const centre = anchorT - (px - this.plot.width / 2) / this.plot.width * newSpan;
    this._clampCommit(centre, newSpan, false);
    this.hover = { x: px + this.plot.left, y: this._localY(e) + this.plot.top };
    this._schedule();
    this._announce();
  }

  // ----- input: keyboard --------------------------------------------------
  _onKeyDown(e) {
    const s = this.state;
    let handled = true;
    switch (e.key) {
      case 'ArrowLeft': this._clampCommit(s.centre - s.span * this.tun.keyPanFraction, s.span, false); break;
      case 'ArrowRight': this._clampCommit(s.centre + s.span * this.tun.keyPanFraction, s.span, false); break;
      case '+': case '=': this._zoomKey(1 / this.tun.keyZoomFactor); break;
      case '-': case '_': this._zoomKey(this.tun.keyZoomFactor); break;
      case 'Home': this.toStart(); break;
      case 'End': this.toEnd(); break;
      default: handled = false;
    }
    if (handled) { e.preventDefault(); this._schedule(); this._announce(); }
  }

  _zoomKey(factor) {
    const s = this.state;
    const newSpan = this._clampSpan(s.span * factor);
    // Anchored on the centre for the keyboard.
    this._clampCommit(s.centre, newSpan, false);
  }

  // ----- measurement + scheduling ----------------------------------------
  _measure(reflow) {
    this.rect = this.$root.getBoundingClientRect();
    const w = this.$root.clientWidth, h = this.$root.clientHeight;
    if (reflow) {
      const dpr = window.devicePixelRatio || 1;
      this.$canvas.width = Math.max(1, Math.round(w * dpr));
      this.$canvas.height = Math.max(1, Math.round(h * dpr));
      this.$canvas.style.width = w + 'px';
      this.$canvas.style.height = h + 'px';
      this._dpr = dpr;
    }
    // Plot rect: room for the y labels (left) and x labels (bottom).
    const padL = 52, padR = 12, padT = 10, padB = 22;
    this.plot = { left: padL, top: padT, width: Math.max(1, w - padL - padR), height: Math.max(1, h - padT - padB) };
    if (reflow) this._schedule();
  }

  _schedule() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this._render(); });
  }

  // ----- theming ----------------------------------------------------------
  _cssVar(name, fallback) {
    const v = getComputedStyle(this).getPropertyValue(name).trim();
    return v || fallback;
  }
  _seriesColor(m, i) { return this._cssVar(`--tsc-series-${i + 1}`, m.color); }

  // The one value function shared by rendering and the tooltip, so what you
  // scrub reads exactly what is drawn. `colDurMs` is the width of one sampling
  // bucket in time (the pixel-column duration).
  _displayValue(m, t, colDurMs) {
    if (this._mode === 'cumulative') {
      if (m.kind === 'delta') return m.cumDeltaAt(t);
      return m.integralTo(t) / m.ratePer; // value*seconds / (sec per unit) => value*units
    }
    if (m.kind === 'delta') {
      const durSec = Math.max(colDurMs, 1) / 1000;
      return m.sumDeltas(t - colDurMs / 2, t + colDurMs / 2) / durSec * m.ratePer;
    }
    if (colDurMs < 1) return m.levelAt(t);
    return m.averageOver(t - colDurMs / 2, t + colDurMs / 2);
  }

  _unitSuffix(m) {
    if (this._mode === 'cumulative') {
      if (m.kind === 'delta') return m.unit;
      return m.unit ? m.unit + 'h' : '';
    }
    if (m.kind === 'delta') return m.unit + m.rateLabel;
    return m.unit;
  }

  _effectiveForm() { return this._form === 'auto' ? (this.models.length >= 2 ? 'stacked' : 'line') : this._form; }

  // ----- legend -----------------------------------------------------------
  _buildLegend() {
    if (this.models.length < 2) { this.$legend.hidden = true; this.$legend.textContent = ''; return; }
    this.$legend.hidden = false;
    this.$legend.textContent = '';
    this.models.forEach((m, i) => {
      const item = document.createElement('span');
      item.className = 'legend-item';
      const key = document.createElement('span');
      key.className = 'legend-key';
      key.style.background = this._seriesColor(m, i);
      const label = document.createElement('span');
      label.className = 'legend-label';
      label.textContent = m.name;
      item.append(key, label);
      this.$legend.append(item);
    });
  }

  // ----- render (a pure function of the viewport) ------------------------
  _render() {
    const ctx = this.ctx;
    if (!ctx || this.plot.width < 2) return;
    const dpr = this._dpr || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = this.$root.clientWidth, h = this.$root.clientHeight;
    ctx.clearRect(0, 0, w, h);

    const surface = this._cssVar('--tsc-surface', '#0e1116');
    const grid = this._cssVar('--tsc-grid', '#20262f');
    const axis = this._cssVar('--tsc-axis', '#5c6b7a');
    const ink = this._cssVar('--tsc-ink-dim', '#8fa0b0');
    const areaAlpha = parseFloat(this._cssVar('--tsc-area-alpha', '0.16')) || 0.16;
    const font = this._cssVar('--tsc-font', '11px ui-monospace, Menlo, Consolas, monospace');

    const P = this.plot;
    const cols = Math.max(2, Math.round(P.width));
    const colDurMs = this.state.span / P.width;
    const leftT = this._timeAt(0);

    // Evaluate every series at each pixel column with the shared value function.
    const per = this.models.map(() => new Float64Array(cols));
    const times = new Float64Array(cols);
    for (let c = 0; c < cols; c++) {
      const t = leftT + (c + 0.5) / P.width * this.state.span;
      times[c] = t;
      for (let s = 0; s < this.models.length; s++) per[s][c] = this._displayValue(this.models[s], t, colDurMs);
    }

    const form = this._effectiveForm();
    // Y max: stacked -> the max column total; else -> the max single value.
    let rawMax = 0;
    if (form === 'stacked') {
      for (let c = 0; c < cols; c++) { let sum = 0; for (let s = 0; s < per.length; s++) sum += Math.max(0, per[s][c]); if (sum > rawMax) rawMax = sum; }
    } else {
      for (let s = 0; s < per.length; s++) for (let c = 0; c < cols; c++) if (per[s][c] > rawMax) rawMax = per[s][c];
    }
    const yMax = niceCeil(rawMax);
    const yOf = (v) => P.top + P.height - (v / yMax) * P.height;

    // Grid + axes (recessive).
    ctx.font = font;
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;
    const yDiv = 5;
    ctx.strokeStyle = grid;
    ctx.fillStyle = ink;
    ctx.textAlign = 'right';
    for (let i = 0; i <= yDiv; i++) {
      const val = yMax * i / yDiv;
      const y = Math.round(yOf(val)) + 0.5;
      ctx.beginPath(); ctx.moveTo(P.left, y); ctx.lineTo(P.left + P.width, y); ctx.stroke();
      ctx.fillText(formatNum(val), P.left - 8, y);
    }
    // X ticks.
    const ta = timeAxis(this.state.span, P.width);
    const rightT = this._timeAt(P.width);
    ctx.textAlign = 'center';
    const first = Math.ceil(leftT / ta.stepMs) * ta.stepMs;
    for (let t = first; t <= rightT; t += ta.stepMs) {
      const x = Math.round(P.left + this._pxAt(t)) + 0.5;
      ctx.strokeStyle = grid;
      ctx.beginPath(); ctx.moveTo(x, P.top); ctx.lineTo(x, P.top + P.height); ctx.stroke();
      ctx.fillStyle = ink;
      ctx.fillText(ta.axis(t), x, P.top + P.height + 11);
    }
    // Baseline / left axis a touch stronger.
    ctx.strokeStyle = axis;
    ctx.beginPath();
    ctx.moveTo(P.left + 0.5, P.top); ctx.lineTo(P.left + 0.5, P.top + P.height);
    ctx.lineTo(P.left + P.width, P.top + P.height); ctx.stroke();

    // Clip to the plot for the data marks.
    ctx.save();
    ctx.beginPath(); ctx.rect(P.left, P.top, P.width, P.height); ctx.clip();

    if (form === 'stacked') this._drawStacked(ctx, per, yOf, surface, areaAlpha);
    else this._drawLines(ctx, per, yOf, areaAlpha, form);

    ctx.restore();

    this._lastFrame = { cols, times, per, yMax, yOf, form, colDurMs };
    this._drawTooltip();
  }

  _drawLines(ctx, per, yOf, areaAlpha, form) {
    const P = this.plot;
    const baseY = P.top + P.height;
    for (let s = 0; s < this.models.length; s++) {
      const color = this._seriesColor(this.models[s], s);
      const vals = per[s];
      // Area fill (single series, or 'line' form still gets a light wash).
      ctx.beginPath();
      ctx.moveTo(P.left, baseY);
      for (let c = 0; c < vals.length; c++) ctx.lineTo(P.left + c + 0.5, yOf(vals[c]));
      ctx.lineTo(P.left + vals.length, baseY);
      ctx.closePath();
      ctx.globalAlpha = this.models.length === 1 ? areaAlpha : areaAlpha * 0.6;
      ctx.fillStyle = color; ctx.fill();
      ctx.globalAlpha = 1;
      // Line.
      ctx.beginPath();
      for (let c = 0; c < vals.length; c++) { const x = P.left + c + 0.5, y = yOf(vals[c]); if (c === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.lineWidth = 2; ctx.strokeStyle = color; ctx.lineJoin = 'round'; ctx.stroke();
    }
  }

  _drawStacked(ctx, per, yOf, surface, areaAlpha) {
    const P = this.plot;
    const cols = per[0] ? per[0].length : 0;
    const lower = new Float64Array(cols); // running stacked total (values)
    const boundaries = []; // upper boundary y of each band, for the 2px gaps
    for (let s = 0; s < this.models.length; s++) {
      const color = this._seriesColor(this.models[s], s);
      const vals = per[s];
      const upperY = new Float64Array(cols);
      ctx.beginPath();
      // Upper edge left->right.
      for (let c = 0; c < cols; c++) {
        const top = lower[c] + Math.max(0, vals[c]);
        const y = yOf(top); upperY[c] = y;
        const x = P.left + c + 0.5;
        if (c === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      // Lower edge right->left.
      for (let c = cols - 1; c >= 0; c--) ctx.lineTo(P.left + c + 0.5, yOf(lower[c]));
      ctx.closePath();
      ctx.globalAlpha = Math.min(1, areaAlpha * 4.5); // ribbons are solid-ish
      ctx.fillStyle = color; ctx.fill();
      ctx.globalAlpha = 1;
      boundaries.push(upperY);
      for (let c = 0; c < cols; c++) lower[c] += Math.max(0, vals[c]);
    }
    // 2px surface-coloured gaps between adjacent ribbons, so boundaries read
    // without outlines. Skip the topmost boundary.
    ctx.strokeStyle = surface; ctx.lineWidth = 2;
    for (let b = 0; b < boundaries.length - 1; b++) {
      const upperY = boundaries[b];
      ctx.beginPath();
      for (let c = 0; c < cols; c++) { const x = P.left + c + 0.5, y = upperY[c]; if (c === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.stroke();
    }
  }

  // ----- tooltip ----------------------------------------------------------
  _drawTooltip() {
    const f = this._lastFrame;
    if (!this.hover || !f || this.models.length === 0) { this.$tooltip.hidden = true; return; }
    const P = this.plot;
    const px = clamp(this.hover.x - P.left, 0, P.width); // plot-local x
    const t = this._timeAt(px);
    if (t < this._timeAt(0) - 1 || t > this._timeAt(P.width) + 1) { this.$tooltip.hidden = true; return; }
    const colDurMs = this.state.span / P.width;
    const ta = timeAxis(this.state.span, P.width);

    // Values are read continuously from the models (interpolated, not snapped
    // to samples). This is a scrubbing chart, not a categorical one.
    const rows = this.models.map((m, i) => ({
      color: this._seriesColor(m, i), name: m.name,
      value: this._displayValue(m, t, colDurMs), suffix: this._unitSuffix(m),
    }));

    const form = this._effectiveForm();
    this.$tooltip.textContent = '';
    const timeEl = document.createElement('div');
    timeEl.className = 'tt-time';
    timeEl.textContent = ta.readout(t); // finer-grained than the axis ticks
    this.$tooltip.append(timeEl);

    if (form === 'stacked') {
      // A table: every band, colour-matched, total on the bottom row, the band
      // under the cursor highlighted. On a stack only the bottom ribbon sits on
      // the baseline, so the tooltip does the real work of reading heights.
      const yVal = f.yMax * (1 - clamp(this.hover.y - P.top, 0, P.height) / P.height);
      let acc = 0, hi = -1;
      for (let s = 0; s < rows.length; s++) { const lo = acc; acc += Math.max(0, rows[s].value); if (yVal >= lo && yVal < acc) { hi = s; break; } }
      const table = document.createElement('div'); table.className = 'tt-table';
      let total = 0;
      rows.forEach((r, s) => { total += r.value; table.append(this._ttRow(r, s === hi)); });
      const totRow = this._ttRow({ color: this._cssVar('--tsc-ink', '#d7e3ec'), name: 'Total', value: total, suffix: rows[0].suffix }, false, true);
      table.append(totRow);
      this.$tooltip.append(table);
    } else if (rows.length === 1) {
      this.$tooltip.append(this._ttRow(rows[0], false));
    } else {
      const table = document.createElement('div'); table.className = 'tt-table';
      rows.forEach((r) => table.append(this._ttRow(r, false)));
      this.$tooltip.append(table);
    }

    // Position: default above the cursor, horizontally centred, always fully
    // inside the chart; slides sideways near the edges, drops below near the top.
    this.$tooltip.hidden = false;
    const tw = this.$tooltip.offsetWidth, th = this.$tooltip.offsetHeight;
    const w = this.$root.clientWidth, h = this.$root.clientHeight;
    let left = this.hover.x - tw / 2;
    left = clamp(left, 4, w - tw - 4);
    let top = this.hover.y - th - 14;
    if (top < 4) top = this.hover.y + 18; // near the top: drop below the cursor
    top = clamp(top, 4, h - th - 4);
    this.$tooltip.style.left = left + 'px';
    this.$tooltip.style.top = top + 'px';
  }

  _ttRow(r, highlight, isTotal) {
    const row = document.createElement('div');
    row.className = 'tt-row' + (highlight ? ' is-hi' : '') + (isTotal ? ' is-total' : '');
    const key = document.createElement('span'); key.className = 'tt-key'; key.style.background = r.color;
    const val = document.createElement('b'); val.className = 'tt-val'; val.style.color = r.color;
    val.textContent = formatNum(r.value) + r.suffix; // value leads
    const lbl = document.createElement('span'); lbl.className = 'tt-lbl'; lbl.textContent = r.name; // label follows
    row.append(key, val, lbl);
    return row;
  }

  // ----- accessibility ----------------------------------------------------
  _announce() {
    if (!this.$live) return;
    const P = this.plot;
    const centre = this.state.centre;
    const ta = timeAxis(this.state.span, P.width || 800);
    const spanSec = Math.round(this.state.span / 1000);
    const colDurMs = this.state.span / (P.width || 800);
    const vals = this.models.map((m) => `${m.name} ${formatNum(this._displayValue(m, centre, colDurMs))}${this._unitSuffix(m)}`).join(', ');
    this.$live.textContent = `Centre ${ta.readout(centre)}, span ${spanSec}s${this.state.follow ? ', following' : ''}. ${vals}`;
  }
}

if (!customElements.get('timeseries-chart')) customElements.define('timeseries-chart', TimeseriesChart);

export default TimeseriesChart;
