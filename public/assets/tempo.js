// tempo.js - the viewer-driven waking expression pace control.
//
// The number is an opportunity pace, not a machine duty percentage or a promise
// that valid prose will publish. The server chooses 5% unwatched, 30% watched,
// or a viewer-set custom value. The cost estimate uses the runner's waking
// scheduler and whole-host idle/load power anchors; neither is measured Cy power.

const IDLE_SPEED = 5; // the nobody-watching baseline the cost of watching is measured from

// Grounded first-paint fallback from Cy's established power model. The tempo API
// replaces these with the latest anchors emitted by the live runner, but keeping
// the same configured baseline here means the card never presents an unexplained
// "--" while that initial request is in flight (or during a brief network fault).
const FALLBACK_POWER = { idleWatts: 22, loadWatts: 62, tariff: 0.2635 };
const pencePerHour = (watts, tariff) => (watts / 1000) * tariff * 100;
const FALLBACK_PPH_IDLE = pencePerHour(FALLBACK_POWER.idleWatts, FALLBACK_POWER.tariff);
const FALLBACK_PPH_LOAD = pencePerHour(FALLBACK_POWER.loadWatts, FALLBACK_POWER.tariff);

// Production chooser + prose calls currently occupy about 200-360s together.
// Use their midpoint until the runner supplies a representative completed cycle.
export const DEFAULT_CYCLE_MS = 280_000;

function clampSpeedPct(speed) {
  const n = Math.round(Number(speed));
  if (!Number.isFinite(n)) return 100;
  return Math.max(1, Math.min(100, n));
}

// Mirrors runner/tempo.js. The start-to-start target does not override slower
// inference, waiting for a shared lease, or rejection by prose validation.
export function wakingOpportunityIntervalMs(speed) {
  return Math.round(90_000 * 100 / clampSpeedPct(speed));
}

export function wakingTempoIdleMs(burstMs, speed) {
  const s = clampSpeedPct(speed);
  if (s >= 100) return 0;
  const b = Math.max(0, Number(burstMs) || 0);
  return Math.min(Math.round(b * (100 / s - 1)), Math.round(75_000 * 30 / s));
}

export function estimatedWakingBusyShare(speed, cycleMs = DEFAULT_CYCLE_MS) {
  const busyMs = Number.isFinite(Number(cycleMs)) && Number(cycleMs) > 0
    ? Number(cycleMs) : DEFAULT_CYCLE_MS;
  const intervalMs = Math.max(wakingOpportunityIntervalMs(speed),
    busyMs + wakingTempoIdleMs(busyMs, speed));
  return Math.min(1, busyMs / intervalMs);
}

export function watchingCostPph(speed, pphIdle, pphLoad, cycleMs = DEFAULT_CYCLE_MS) {
  const s = Number(speed);
  const idle = Number(pphIdle);
  const load = Number(pphLoad);
  if (![s, idle, load].every(Number.isFinite)) return null;
  const range = Math.max(0, load - idle);
  return Math.max(0, range * (estimatedWakingBusyShare(s, cycleMs)
    - estimatedWakingBusyShare(IDLE_SPEED, cycleMs)));
}

// This is a target opportunity, deliberately not an expected publication time.
export function cadencePhrase(speed) {
  const minutes = wakingOpportunityIntervalMs(speed) / 60_000;
  const rounded = Math.round(minutes * 10) / 10;
  return `~${rounded} min / opportunity`;
}

export class Tempo {
  constructor(root, endpoint, viewerEl = null) {
    this.root = root;
    this.endpoint = endpoint || 'api/tempo.php';
    this.viewerEl = viewerEl;
    this.speed = IDLE_SPEED; // grounded idle until the initial server state arrives
    this.viewers = 0;
    this.custom = false;
    this.pphIdle = FALLBACK_PPH_IDLE; // replaced by runner-derived API anchors
    this.pphLoad = FALLBACK_PPH_LOAD;
    this.burstMs = DEFAULT_CYCLE_MS; // representative chooser + journal cycle
    this._dragging = false;
    this._build();
    this._applyState(this.speed, this.viewers, this.custom);
    this._loadInitial();
  }

  _build() {
    const heading = this.root.closest('details')?.querySelector('summary');
    if (heading) heading.textContent = 'TEMPO / WAKING PACE';
    this.root.classList.add('tempopanel');
    this.root.innerHTML = `
      <div class="tp-head">
        <div class="tp-readout"><span id="tp-pct">--</span><span class="tp-unit">%</span></div>
      </div>
      <input id="tp-slider" class="tp-slider" type="range" min="1" max="100" value="30"
             aria-label="waking expression tempo, opportunity pace">
      <div class="tp-scale"><span>1%</span><span class="tp-mid" id="tp-cadence">waking opportunities</span><span>100%</span></div>
      <div class="tp-cost">
        <span class="tp-cost-main">watching adds ~<b id="tp-cph">--</b> p/hour host electricity</span>
        <span class="tp-cost-sub">Whole-host estimate; entries may be delayed or rejected.</span>
      </div>`;
    this.pctEl = this.root.querySelector('#tp-pct');
    this.countEl = this.viewerEl;
    this.slider = this.root.querySelector('#tp-slider');
    this.cphEl = this.root.querySelector('#tp-cph');
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
      if (d) this.update(d);
    } catch {
      /* the stream's tempo events will fill it in shortly */
    }
  }

  // Called by app.js for each `tempo` event on the stream. Carries the pence/hour
  // anchors; refreshes the state unless the viewer is mid-drag (never yank the
  // slider out from under them).
  update(p) {
    if (!p) return;
    const idle = p.pph_idle == null ? null : Number(p.pph_idle);
    const load = p.pph_load == null ? null : Number(p.pph_load);
    if (idle != null && Number.isFinite(idle)) this.pphIdle = idle;
    if (load != null && Number.isFinite(load)) this.pphLoad = load;
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
        this.update(d);
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
    if (this.countEl) {
      this.countEl.textContent = `${this.viewers} WATCHING`;
      this.countEl.setAttribute('aria-label', `${this.viewers} ${this.viewers === 1 ? 'person' : 'people'} watching`);
    }

    // Show the opportunity target, not an assurance that a model candidate will
    // survive inference latency, repetition checks or prose validation.
    if (this.cadenceEl) {
      this.cadenceEl.textContent = speed != null ? cadencePhrase(speed) : 'waking opportunities';
    }

    const watching = watchingCostPph(speed, this.pphIdle, this.pphLoad, this.burstMs);
    this.cphEl.textContent = watching == null ? 'n/a' : watching.toFixed(1);
  }
}
