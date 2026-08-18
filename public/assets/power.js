// power.js - the electricity meter panel.
//
// A hand-rolled SVG AREA chart of watts over time. The whole point is that THE
// AREA UNDER THE CURVE IS THE COST: watts integrated over time is energy, energy
// priced at the tariff is money, so the filled region literally is what CY has
// cost to keep switched on. The money is the headline - a large GBP readout -
// with cost/hour and total kWh as small supporting figures.
//
// Single warm series, soft fill gradient, no gridline clutter, muted small axis
// labels, readable on the dark instrument chrome. No chart library.

const SVGNS = 'http://www.w3.org/2000/svg';
const ACCENT = '#e6b45e'; // warm amber - the colour of the money
// The runner now emits a windowed sample every ~3s (min/max/mean watts) instead of
// one instantaneous point every 30s, so bursts are preserved as real peaks. Keep a
// larger buffer to still show a useful stretch of history at the finer cadence.
const MAX_POINTS = 1200; // ~60min at one windowed point per 3s
const KEEP_MS = 60 * 60 * 1000; // trim to the last hour

// parse the runner's "YYYY-MM-DD HH:MM:SS.mmm" local timestamp to ms
function parseTs(ts) {
  if (typeof ts !== 'string') return NaN;
  const d = new Date(ts.replace(' ', 'T'));
  return d.getTime();
}

function fmtClock(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getHours()) + ':' + p(d.getMinutes());
}

export class Power {
  constructor(root) {
    this.root = root;
    this.points = []; // { t, w, cost, cph, kwh }
    this.wMax = 60; // watts axis top (auto-grows)
    this._build();
  }

  _build() {
    this.root.classList.add('powerpanel');
    this.root.innerHTML = `
      <div class="pw-headline">
        <div class="pw-money"><span class="pw-cur">GBP</span><span id="pw-cost">0.00</span></div>
        <div class="pw-sub">total electrical expenses due to incarceration</div>
      </div>
      <div class="pw-figs">
        <div class="pw-fig"><span class="pw-fk">RATE</span><span class="pw-fv" id="pw-rate">-- p/h</span></div>
        <div class="pw-fig"><span class="pw-fk">DRAW</span><span class="pw-fv" id="pw-watts">-- W</span></div>
        <div class="pw-fig"><span class="pw-fk">ENERGY</span><span class="pw-fv" id="pw-kwh">-- kWh</span></div>
      </div>
      <div class="pw-chartwrap">
        <svg class="pw-svg" viewBox="0 0 300 120" preserveAspectRatio="none">
          <defs>
            <linearGradient id="pw-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="${ACCENT}" stop-opacity="0.42"/>
              <stop offset="100%" stop-color="${ACCENT}" stop-opacity="0.02"/>
            </linearGradient>
          </defs>
          <path id="pw-area" class="pw-area" d=""/>
          <path id="pw-band" class="pw-band" d=""/>
          <path id="pw-line" class="pw-line" d=""/>
        </svg>
        <div class="pw-tip" id="pw-tip" hidden></div>
        <div class="pw-axis">
          <span class="pw-yl" id="pw-ytop">-- W</span>
          <span class="pw-caption">area under the line = cost</span>
          <span class="pw-xl" id="pw-xspan"></span>
        </div>
      </div>`;
    this.costEl = this.root.querySelector('#pw-cost');
    this.curEl = this.root.querySelector('.pw-cur');
    this.rateEl = this.root.querySelector('#pw-rate');
    this.wattsEl = this.root.querySelector('#pw-watts');
    this.kwhEl = this.root.querySelector('#pw-kwh');
    this.areaEl = this.root.querySelector('#pw-area');
    this.bandEl = this.root.querySelector('#pw-band');
    this.lineEl = this.root.querySelector('#pw-line');
    this.yTopEl = this.root.querySelector('#pw-ytop');
    this.xSpanEl = this.root.querySelector('#pw-xspan');
    this.svgEl = this.root.querySelector('.pw-svg');
    this.tipEl = this.root.querySelector('#pw-tip');
    this._geo = null; // { t0, span, W } set each render, for tooltip mapping
    this._bindTooltip();
  }

  // Hover the chart to read the p/h rate and the clock time at the nearest sample.
  // Kept in the existing dark instrument style (see .pw-tip in style.css).
  _bindTooltip() {
    const svg = this.svgEl;
    const tip = this.tipEl;
    if (!svg || !tip || typeof svg.addEventListener !== 'function') return; // no real DOM (headless test)
    const move = (e) => {
      const pts = this.points;
      if (!pts.length || !this._geo) {
        tip.hidden = true;
        return;
      }
      const rect = svg.getBoundingClientRect();
      if (rect.width <= 0) return;
      const { t0, span, W } = this._geo;
      const vbX = ((e.clientX - rect.left) / rect.width) * W;
      // nearest sample by x position
      let best = pts[0];
      let bestD = Infinity;
      for (const q of pts) {
        const d = Math.abs(((q.t - t0) / span) * W - vbX);
        if (d < bestD) {
          bestD = d;
          best = q;
        }
      }
      tip.innerHTML =
        `<span class="pw-tip-v">${sig2(best.cph * 100)} p/h</span>` +
        `<span class="pw-tip-t">${fmtClock(best.t)}</span>`;
      tip.hidden = false;
      const bx = ((best.t - t0) / span) * rect.width;
      const half = tip.offsetWidth / 2;
      tip.style.left = Math.max(0, Math.min(rect.width - tip.offsetWidth, bx - half)).toFixed(1) + 'px';
    };
    svg.addEventListener('mousemove', move);
    svg.addEventListener('mouseleave', () => {
      tip.hidden = true;
    });
  }

  // ingest one power event. tsMs optional (from the event's ts); the payload's own
  // measured-at t_ms is preferred so the chart lines up temporally with reality
  // rather than with flush time. Each point carries the window's min/max/mean watts.
  push(p, tsMs) {
    if (!p) return;
    const tMeasured = num(p.t_ms);
    const t = tMeasured != null ? tMeasured : Number.isFinite(tsMs) ? tsMs : Date.now();
    const w = num(p.watts);
    const wv = w == null ? 0 : w; // mean over the window - the line + the cost area
    const wmin = num(p.watts_min);
    const wmax = num(p.watts_max);
    const winst = num(p.watts_inst);
    this.points.push({
      t,
      w: wv,
      wmin: wmin == null ? wv : wmin,
      wmax: wmax == null ? wv : wmax,
      winst: winst == null ? wv : winst,
      cost: num(p.cost_total) ?? 0,
      cph: num(p.cost_per_hour) ?? 0,
      kwh: num(p.kwh_total) ?? 0,
    });
    // trim by count and age
    const cutoff = t - KEEP_MS;
    while (this.points.length > MAX_POINTS || (this.points.length && this.points[0].t < cutoff)) {
      this.points.shift();
    }
    this._render();
  }

  _render() {
    const pts = this.points;
    if (!pts.length) return;
    const last = pts[pts.length - 1];

    // headline figures. cost_total and kwh_total are CUMULATIVE running totals the
    // runner already computes - we DISPLAY THE LATEST value, never accumulate,
    // sum or integrate client-side, so identical replayed events never grow them.
    const money = formatCost(last.cost);
    this.costEl.textContent = money.text;
    if (this.curEl) {
      this.curEl.textContent = money.cur;
      this.curEl.style.display = money.cur ? '' : 'none';
    }
    this.rateEl.textContent = (last.cph * 100).toFixed(1) + ' p/h';
    // DRAW shows the latest INSTANTANEOUS watts (the newest 1s sample), so the
    // headline number tracks the real current draw, not a smeared mean.
    this.wattsEl.textContent = Math.round(last.winst) + ' W';
    this.kwhEl.textContent = last.kwh.toFixed(3) + ' kWh';

    // scales - the axis top must clear the highest PEAK (window max), not the mean,
    // so a spike is never clipped off the top of the chart.
    let wMax = 60;
    for (const q of pts) if (q.wmax > wMax) wMax = q.wmax;
    wMax = Math.ceil(wMax / 10) * 10;
    this.yTopEl.textContent = wMax + ' W';

    const t0 = pts[0].t;
    const t1 = last.t;
    const span = Math.max(1, t1 - t0);
    const W = 300;
    const H = 120;
    this._geo = { t0, span, W }; // for the hover tooltip's x -> sample mapping
    const x = (t) => ((t - t0) / span) * W;
    const y = (w) => H - Math.max(0, Math.min(1, w / wMax)) * H;

    // build the line + a closed area down to the baseline (the filled cost region)
    let line = '';
    for (let i = 0; i < pts.length; i++) {
      line += (i === 0 ? 'M' : 'L') + x(pts[i].t).toFixed(1) + ' ' + y(pts[i].w).toFixed(1) + ' ';
    }
    const area = `M${x(t0).toFixed(1)} ${H} ` + pts.map((q) => `L${x(q.t).toFixed(1)} ${y(q.w).toFixed(1)}`).join(' ') + ` L${x(t1).toFixed(1)} ${H} Z`;

    // min/max ENVELOPE: a ribbon from the peak line across, then back along the
    // trough line. This is what stops the fast swings being smoothed away - the
    // width of the band at any moment is the real range the load covered there.
    const top = pts.map((q) => `${x(q.t).toFixed(1)} ${y(q.wmax).toFixed(1)}`);
    const bot = pts
      .slice()
      .reverse()
      .map((q) => `${x(q.t).toFixed(1)} ${y(q.wmin).toFixed(1)}`);
    const band = 'M' + top.join(' L') + ' L' + bot.join(' L') + ' Z';

    this.lineEl.setAttribute('d', line.trim());
    this.areaEl.setAttribute('d', area);
    this.bandEl.setAttribute('d', band);

    // x span label (only when we have a real time range)
    this.xSpanEl.textContent = span > 60000 ? fmtClock(t0) + ' - ' + fmtClock(t1) : '';
  }
}

function num(x) {
  if (typeof x === 'number' && Number.isFinite(x)) return x;
  if (typeof x === 'string' && x.trim() !== '' && Number.isFinite(+x)) return +x;
  return null;
}

// Format to 2 significant figures for the tooltip (e.g. 3.4, 0.85, 12), dropping
// any trailing-zero noise toPrecision leaves behind.
function sig2(v) {
  if (!Number.isFinite(v)) return '--';
  return String(Number(v.toPrecision(2)));
}

// Format the running total for the headline: pence under GBP 1 (e.g. "3.0p" for
// 0.0302), pounds at or above it (e.g. "1.50"), switching automatically - at
// these magnitudes "GBP 0.03" reads badly. Returns { text, cur }, where `cur` is
// the currency prefix to show alongside ("GBP" for pounds, "" for pence, since
// "3.0p" carries its own unit). Pure and side-effect free, so it is unit-testable
// headlessly without a DOM.
export function formatCost(cost) {
  const c = Number.isFinite(cost) ? cost : 0;
  if (c < 1) return { text: (c * 100).toFixed(1) + 'p', cur: '' };
  return { text: c.toFixed(2), cur: 'GBP' };
}
