// tempo.js - the viewer-driven duty-cycle control.
//
// A small, understated instrument-chrome panel: the current speed as a
// percentage, a slider 1-100, the live count of who is watching, and the cost of
// watching plainly stated ("watching costs Warden Florian X p/hour").
//
// Tempo is a DUTY CYCLE - 100% is continuous, lower means more silence between
// bursts. The effective speed is decided server-side from presence (nobody = 5%,
// someone = 30%, or a custom value a viewer set). This control shows it live from
// `tempo` events on the stream and lets a watcher drag the slider to set a
// custom value (POST). While dragging, the readout and cost track the slider so
// the viewer sees the cost of a choice before committing it.
//
// The cost is linear in speed: average draw is idle + (speed/100)*(load-idle), so
// pence/hour runs between pph_idle (speed->0) and pph_load (speed=100), both sent
// by the runner in the tempo event. The COST OF WATCHING is the amount above the
// nobody-watching 5% baseline, so it reads 0 at 5% and grows as he is sped up.

const IDLE_SPEED = 5; // the nobody-watching baseline the cost of watching is measured from

// A representative burst duration to reason about cadence with, until a real one
// arrives on a `tempo` event (bursts run ~75s). A percentage means nothing to a
// viewer; the effective GAP between bursts does, so the panel renders that.
const DEFAULT_BURST_MS = 75000;

// ---- tempo cadence maths, MIRRORED from runner/tempo.js --------------------
// The runner decides the real idle; this is the same maths client-side so the
// panel can preview the cadence live while the slider is dragged. Keep in step
// with runner/tempo.js if the anchors change.
const MAX_IDLE_ANCHORS = [
  { speed: 100, ms: 0 },
  { speed: 30, ms: 12000 },
  { speed: 5, ms: 300000 },
  { speed: 1, ms: 780000 },
];
function clampSpeedPct(speed) {
  const n = Math.round(Number(speed));
  if (!Number.isFinite(n)) return 100;
  return Math.max(1, Math.min(100, n));
}
function maxIdleForSpeed(speed) {
  const s = clampSpeedPct(speed);
  const a = MAX_IDLE_ANCHORS;
  if (s >= a[0].speed) return a[0].ms;
  for (let i = 0; i < a.length - 1; i++) {
    const hi = a[i];
    const lo = a[i + 1];
    if (s <= hi.speed && s >= lo.speed) {
      const frac = (s - lo.speed) / (hi.speed - lo.speed);
      return Math.round(lo.ms + (hi.ms - lo.ms) * frac);
    }
  }
  return a[a.length - 1].ms;
}
function tempoIdleMs(burstMs, speed) {
  const s = clampSpeedPct(speed);
  if (s >= 100) return 0;
  const b = Math.max(0, Number(burstMs) || 0);
  const duty = b * (100 / s - 1);
  return Math.max(0, Math.min(maxIdleForSpeed(s), Math.round(duty)));
}
// A short human phrase for the effective gap between bursts at `speed`.
function cadencePhrase(burstMs, speed) {
  const b = Math.max(0, Number(burstMs) || 0) || DEFAULT_BURST_MS;
  const s = Math.round((b + tempoIdleMs(b, speed)) / 1000);
  if (s < 90) return 'about every ' + s + 's';
  const m = Math.round(s / 60);
  return 'about every ' + m + ' min';
}

export class Tempo {
  constructor(root, endpoint) {
    this.root = root;
    this.endpoint = endpoint || 'api/tempo.php';
    this.speed = null; // last server-known effective speed
    this.viewers = 0;
    this.custom = false;
    this.pphIdle = null; // pence/hour anchors from the runner (null until seen)
    this.pphLoad = null;
    this.burstMs = DEFAULT_BURST_MS; // representative recent burst, from tempo events
    this._dragging = false;
    this._build();
    this._loadInitial();
  }

  _build() {
    this.root.classList.add('tempopanel');
    this.root.innerHTML = `
      <div class="tp-head">
        <div class="tp-readout"><span id="tp-pct">--</span><span class="tp-unit">%</span></div>
        <div class="tp-watchers"><span id="tp-count">--</span><span class="tp-wlabel">watching</span></div>
      </div>
      <input id="tp-slider" class="tp-slider" type="range" min="1" max="100" value="30"
             aria-label="generation tempo, percent duty cycle">
      <div class="tp-scale"><span>1%</span><span class="tp-mid" id="tp-cadence">duty cycle</span><span>100%</span></div>
      <div class="tp-cost">
        <span class="tp-cost-main">watching costs Warden Florian <b id="tp-cph">--</b> p/hour</span>
        <span class="tp-cost-sub" id="tp-cph-abs"></span>
      </div>`;
    this.pctEl = this.root.querySelector('#tp-pct');
    this.countEl = this.root.querySelector('#tp-count');
    this.slider = this.root.querySelector('#tp-slider');
    this.cphEl = this.root.querySelector('#tp-cph');
    this.cphAbsEl = this.root.querySelector('#tp-cph-abs');
    this.cadenceEl = this.root.querySelector('#tp-cadence');

    // dragging: track the slider live, only commit on release
    this.slider.addEventListener('input', () => {
      this._dragging = true;
      this._render(this._sliderVal());
    });
    const commit = () => {
      if (!this._dragging) return;
      this._dragging = false;
      this._setSpeed(this._sliderVal());
    };
    this.slider.addEventListener('change', commit);
  }

  _sliderVal() {
    return Math.max(1, Math.min(100, Math.round(Number(this.slider.value) || 1)));
  }

  // GET current tempo on load so the panel is populated before any tempo event.
  async _loadInitial() {
    try {
      const res = await fetch(this.endpoint, { cache: 'no-store' });
      if (!res.ok) return;
      const d = await res.json();
      if (d && d.speed != null) this._applyState(d.speed, d.viewers, d.custom);
    } catch {
      /* the stream's tempo events will fill it in shortly */
    }
  }

  // Called by app.js for each `tempo` event on the stream. Carries the pence/hour
  // anchors; refreshes the state unless the viewer is mid-drag (never yank the
  // slider out from under them).
  update(p) {
    if (!p) return;
    if (p.pph_idle != null) this.pphIdle = Number(p.pph_idle);
    if (p.pph_load != null) this.pphLoad = Number(p.pph_load);
    if (p.burst_ms != null && Number(p.burst_ms) > 0) this.burstMs = Number(p.burst_ms);
    if (!this._dragging && p.speed != null) {
      this._applyState(p.speed, p.viewers, p.custom);
    } else {
      this._render(); // anchors may have changed; refresh the cost line
    }
  }

  _applyState(speed, viewers, custom) {
    this.speed = Math.max(1, Math.min(100, Math.round(Number(speed) || IDLE_SPEED)));
    this.viewers = Number(viewers) || 0;
    this.custom = !!custom;
    this.slider.value = String(this.speed);
    this._render(this.speed);
  }

  async _setSpeed(speed) {
    // optimistic: show it immediately
    this._render(speed);
    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ speed }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d && d.speed != null) {
        this._applyState(d.speed, d.viewers, d.custom);
      }
    } catch {
      /* leave the optimistic value; the next tempo event reconciles it */
    }
  }

  // Render the panel. `atSpeed` overrides the displayed speed (used while dragging
  // and for optimistic sets); otherwise the last server-known speed is shown.
  _render(atSpeed) {
    const speed = atSpeed != null ? atSpeed : this.speed;
    if (speed != null) this.pctEl.textContent = String(Math.round(speed));
    this.countEl.textContent = String(this.viewers);

    // the cadence a viewer actually feels at this speed - the effective gap
    // between bursts - which reads as alive where a bare percentage does not.
    if (this.cadenceEl) {
      this.cadenceEl.textContent = speed != null ? cadencePhrase(this.burstMs, speed) : 'duty cycle';
    }

    if (this.pphIdle == null || this.pphLoad == null || speed == null) {
      this.cphEl.textContent = '--';
      this.cphAbsEl.textContent = '';
      return;
    }
    const range = this.pphLoad - this.pphIdle;
    const pphAt = (s) => this.pphIdle + (s / 100) * range;
    const watching = Math.max(0, pphAt(speed) - pphAt(IDLE_SPEED)); // cost above the unwatched baseline
    this.cphEl.textContent = watching.toFixed(1);
    this.cphAbsEl.textContent = 'he draws ' + pphAt(speed).toFixed(1) + ' p/hour at this tempo';
  }
}
