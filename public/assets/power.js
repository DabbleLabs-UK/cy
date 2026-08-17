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
const MAX_POINTS = 720; // ~6h at one point per 30s
const KEEP_MS = 6 * 3600 * 1000; // trim to the last 6 hours

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
        <div class="pw-sub">spent on electricity since switch-on</div>
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
          <path id="pw-line" class="pw-line" d=""/>
        </svg>
        <div class="pw-axis">
          <span class="pw-yl" id="pw-ytop">-- W</span>
          <span class="pw-caption">area under the line = cost</span>
          <span class="pw-xl" id="pw-xspan"></span>
        </div>
      </div>`;
    this.costEl = this.root.querySelector('#pw-cost');
    this.rateEl = this.root.querySelector('#pw-rate');
    this.wattsEl = this.root.querySelector('#pw-watts');
    this.kwhEl = this.root.querySelector('#pw-kwh');
    this.areaEl = this.root.querySelector('#pw-area');
    this.lineEl = this.root.querySelector('#pw-line');
    this.yTopEl = this.root.querySelector('#pw-ytop');
    this.xSpanEl = this.root.querySelector('#pw-xspan');
  }

  // ingest one power event. tsMs optional (from the event's ts); falls back to now.
  push(p, tsMs) {
    if (!p) return;
    const t = Number.isFinite(tsMs) ? tsMs : Date.now();
    const w = num(p.watts);
    this.points.push({
      t,
      w: w == null ? 0 : w,
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

    // headline figures
    this.costEl.textContent = last.cost.toFixed(2);
    this.rateEl.textContent = (last.cph * 100).toFixed(1) + ' p/h';
    this.wattsEl.textContent = Math.round(last.w) + ' W';
    this.kwhEl.textContent = last.kwh.toFixed(3) + ' kWh';

    // scales
    let wMax = 60;
    for (const q of pts) if (q.w > wMax) wMax = q.w;
    wMax = Math.ceil(wMax / 10) * 10;
    this.yTopEl.textContent = wMax + ' W';

    const t0 = pts[0].t;
    const t1 = last.t;
    const span = Math.max(1, t1 - t0);
    const W = 300;
    const H = 120;
    const x = (t) => ((t - t0) / span) * W;
    const y = (w) => H - Math.max(0, Math.min(1, w / wMax)) * H;

    // build the line + a closed area down to the baseline (the filled cost region)
    let line = '';
    for (let i = 0; i < pts.length; i++) {
      line += (i === 0 ? 'M' : 'L') + x(pts[i].t).toFixed(1) + ' ' + y(pts[i].w).toFixed(1) + ' ';
    }
    const area = `M${x(t0).toFixed(1)} ${H} ` + pts.map((q) => `L${x(q.t).toFixed(1)} ${y(q.w).toFixed(1)}`).join(' ') + ` L${x(t1).toFixed(1)} ${H} Z`;
    this.lineEl.setAttribute('d', line.trim());
    this.areaEl.setAttribute('d', area);

    // x span label (only when we have a real time range)
    this.xSpanEl.textContent = span > 60000 ? fmtClock(t0) + ' - ' + fmtClock(t1) : '';
  }
}

function num(x) {
  if (typeof x === 'number' && Number.isFinite(x)) return x;
  if (typeof x === 'string' && x.trim() !== '' && Number.isFinite(+x)) return +x;
  return null;
}
