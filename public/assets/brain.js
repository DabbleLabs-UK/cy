// brain.js - an honest view of Cy's implemented Soma state.
//
// The shaded anatomy is a functional analogy only. Every dynamic value comes
// from a named Soma circuit and exposes its computational source. Legacy mood,
// pulse, amplification, and relationship figures remain available below, but
// are unmistakably labelled as placeholders rather than biological readings.

export const CIRCUITS = [
  { key: 'actionSelection', label: 'ACTION SELECTION', anatomy: 'frontoparietal', path: 'M48 69 C67 48 99 40 124 48 L129 91 C104 96 78 105 54 96 Z' },
  { key: 'selfModel', label: 'SELF MODEL', anatomy: 'medial prefrontal', path: 'M64 105 C82 91 104 88 126 95 L132 121 C105 128 80 128 59 119 Z' },
  { key: 'predictionError', label: 'PREDICTION ERROR', anatomy: 'cingulate', path: 'M119 67 C150 54 190 59 213 79 L202 91 C178 77 148 76 126 88 Z' },
  { key: 'interoception', label: 'INTEROCEPTION', anatomy: 'insula', path: 'M129 112 C145 96 172 94 191 107 C184 129 158 141 136 132 Z' },
  { key: 'threatAppraisal', label: 'THREAT APPRAISAL', anatomy: 'amygdala', path: 'M148 149 C158 139 174 140 183 151 C174 163 158 165 147 156 Z' },
  { key: 'memoryRecall', label: 'MEMORY RECALL', anatomy: 'hippocampal', path: 'M170 162 C190 145 220 146 237 160 C223 158 210 163 199 173 C188 182 177 178 170 162 Z' },
  { key: 'attention', label: 'ATTENTION', anatomy: 'parietal', path: 'M207 65 C235 57 271 68 288 91 L273 124 C248 112 225 102 202 94 Z' },
  { key: 'affiliation', label: 'AFFILIATION', anatomy: 'temporal social', path: 'M218 125 C246 119 278 129 291 151 C276 174 244 184 213 176 C225 157 228 143 218 125 Z' },
];

const LEGACY_MENTAL = ['anxiety', 'stress', 'despair', 'hope', 'lucidity', 'agitation', 'dissociation', 'anger', 'longing'];
const LEGACY_DERIVED = ['confusion', 'overwhelm', 'numbness', 'paranoia', 'fixation', 'resignation', 'brittleness'];

function clampNum(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value));
}

function activityColor(value) {
  const v = clampNum(value) || 0;
  const stops = [[38, 58, 75], [47, 112, 135], [205, 146, 66], [240, 91, 54]];
  const scaled = v * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(scaled));
  const t = scaled - index;
  const a = stops[index];
  const b = stops[index + 1];
  return `rgb(${a.map((x, i) => Math.round(x + (b[i] - x) * t)).join(',')})`;
}

function pct(value) {
  const v = clampNum(value);
  return v == null ? '--' : `${Math.round(v * 100)}%`;
}

function listValues(obj, keys) {
  if (!obj) return 'unavailable';
  const present = keys
    .filter((key) => clampNum(obj[key]) != null)
    .map((key) => `${key} ${Math.round(clampNum(obj[key]) * 100)}`);
  return present.length ? present.join(' / ') : 'unavailable';
}

export class BrainHud {
  constructor(root) {
    this.root = root;
    this.regions = {};
    this.rows = {};
    this._build();
  }

  _build() {
    this.root.classList.add('brainhud');
    this.root.innerHTML = `
      <div class="soma-head">
        <span class="soma-badge">SOMA V1 - AWAITING STATE</span>
        <span class="soma-live" aria-label="Soma state unavailable"></span>
      </div>
      <p class="soma-caveat">Computed cognitive activity. Brain locations are functional analogies, not measured physiology.</p>
      <div class="brain-figure">
        <svg class="brain-svg" viewBox="0 0 340 230" role="img" aria-labelledby="brain-title brain-desc">
          <title id="brain-title">Functional analogy of Cy's Soma circuits</title>
          <desc id="brain-desc">An anatomically inspired lateral brain. Shaded regions map implemented computational circuits to rough functional analogies.</desc>
          <path class="brain-shell" d="M34 128 C24 91 45 60 80 43 C105 20 147 19 178 31 C214 27 257 40 286 66 C309 86 316 116 303 139 C307 157 294 176 272 181 C252 198 212 204 179 196 C148 204 108 195 82 178 C55 172 38 154 34 128 Z"/>
          <path class="brain-cerebellum" d="M235 164 C262 151 295 158 304 178 C296 197 264 205 235 189 C226 181 227 171 235 164 Z"/>
          <path class="brain-stem" d="M213 178 C226 183 237 193 235 219 L218 219 C220 201 207 192 196 184 Z"/>
          <path class="brain-folds" d="M54 83 C85 72 105 72 132 82 M46 111 C78 102 98 107 119 119 M82 50 C104 60 110 71 111 93 M143 40 C154 60 153 79 142 98 M184 39 C197 56 203 73 198 94 M230 48 C238 66 242 83 237 105 M273 73 C284 91 284 110 274 128 M236 132 C253 141 261 153 260 173 M94 146 C117 137 137 140 153 154"/>
        </svg>
        <div class="brain-key">ANATOMICAL ANALOGY</div>
      </div>
      <div class="inference-measured">
        <span class="measure-dot"></span>
        <span class="measure-label">MODEL INFERENCE</span>
        <span class="measure-value">IDLE</span>
        <span class="measure-kind">MEASURED</span>
      </div>
      <div class="soma-readout"></div>
      <div class="soma-selection">
        <div><span>ACTION</span><strong class="soma-action">waiting for state</strong></div>
        <div><span>ATTENTION</span><strong class="soma-attention">nothing selected</strong></div>
        <div><span>EPISODIC MEMORY</span><strong class="soma-memory">0 episodes</strong></div>
        <div><span>SELF-QUESTION</span><strong class="soma-question">unavailable</strong></div>
      </div>
      <details class="legacy-box">
        <summary>PLACEHOLDERS - NOT SOMA</summary>
        <p>Legacy dramatic mappings retained for comparison. They are not observations, clinical measures, or implemented cognitive circuits.</p>
        <dl>
          <div><dt>heartbeat model</dt><dd class="legacy-heart">-- BPM</dd></div>
          <div><dt>mood axes</dt><dd class="legacy-mental">unavailable</dd></div>
          <div><dt>composites</dt><dd class="legacy-derived">unavailable</dd></div>
          <div><dt>monotony amp</dt><dd class="legacy-amp">unavailable</dd></div>
          <div><dt>brain-region map</dt><dd class="legacy-brain">unavailable</dd></div>
          <div><dt>cast standing</dt><dd class="legacy-cast">unavailable</dd></div>
        </dl>
      </details>`;

    const svg = this.root.querySelector('.brain-svg');
    for (const circuit of CIRCUITS) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', circuit.path);
      path.setAttribute('class', 'soma-region');
      path.dataset.circuit = circuit.key;
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = `${circuit.label}: awaiting implemented state`;
      path.appendChild(title);
      svg.appendChild(path);
      this.regions[circuit.key] = path;
    }

    const readout = this.root.querySelector('.soma-readout');
    for (const circuit of CIRCUITS) {
      const row = document.createElement('div');
      row.className = 'soma-row';
      row.innerHTML = `
        <div class="soma-row-top">
          <span class="soma-name">${circuit.label}</span>
          <span class="soma-anatomy">${circuit.anatomy}</span>
          <span class="soma-pct">--</span>
        </div>
        <span class="soma-bar"><i></i></span>
        <span class="soma-source">awaiting source</span>`;
      readout.appendChild(row);
      this.rows[circuit.key] = row;
    }

    this.actionEl = this.root.querySelector('.soma-action');
    this.attentionEl = this.root.querySelector('.soma-attention');
    this.memoryEl = this.root.querySelector('.soma-memory');
    this.questionEl = this.root.querySelector('.soma-question');
    this.measure = {
      root: this.root.querySelector('.inference-measured'),
      value: this.root.querySelector('.measure-value'),
    };
    this.badgeEl = this.root.querySelector('.soma-badge');
    this.liveEl = this.root.querySelector('.soma-live');
  }

  setSoma(soma) {
    if (!soma || soma.status !== 'implemented' || !soma.circuits) return;
    this.badgeEl.textContent = `IMPLEMENTED SOMA V${soma.version || 1}`;
    this.liveEl.classList.add('available');
    this.liveEl.setAttribute('aria-label', 'Soma state available');
    for (const circuit of CIRCUITS) {
      const reading = soma.circuits[circuit.key];
      if (!reading) continue;
      const value = clampNum(reading.value);
      const region = this.regions[circuit.key];
      const row = this.rows[circuit.key];
      if (value != null) {
        const color = activityColor(value);
        region.style.fill = color;
        region.style.fillOpacity = String(0.28 + value * 0.72);
        region.classList.toggle('active', value >= 0.65);
        row.querySelector('.soma-bar i').style.width = `${Math.round(value * 100)}%`;
        row.querySelector('.soma-bar i').style.backgroundColor = color;
        row.querySelector('.soma-pct').textContent = pct(value);
      }
      const source = String(reading.source || 'implemented Soma state');
      row.querySelector('.soma-source').textContent = `source: ${source}`;
      region.querySelector('title').textContent = `${circuit.label}: ${pct(value)}; source: ${source}`;
    }
    const action = soma.action || {};
    this.actionEl.textContent = action.name ? `${action.name}: ${action.reason || 'selected by drive competition'}` : 'nothing selected';
    this.attentionEl.textContent = soma.attention && soma.attention.text ? soma.attention.text : 'nothing selected';
    const count = soma.memory && Number(soma.memory.episodes);
    this.memoryEl.textContent = Number.isFinite(count) ? `${count} episode${count === 1 ? '' : 's'}` : 'unavailable';
    this.questionEl.textContent = soma.selfModel && soma.selfModel.question ? soma.selfModel.question : 'unavailable';
  }

  setInference(phase) {
    const value = ['eval', 'gen'].includes(phase) ? phase : 'idle';
    this.measure.value.textContent = value.toUpperCase();
    this.measure.root.dataset.phase = value;
  }

  setBrain(brain) {
    const count = brain && typeof brain === 'object' ? Object.keys(brain).length : 0;
    this.root.querySelector('.legacy-brain').textContent = count ? `${count} synthetic regions` : 'unavailable';
  }

  setHeart(hr) {
    this.root.querySelector('.legacy-heart').textContent = Number.isFinite(hr) ? `${Math.round(hr)} BPM` : 'unavailable';
  }

  setMental(mental) {
    this.root.querySelector('.legacy-mental').textContent = listValues(mental, LEGACY_MENTAL);
  }

  setDerived(derived) {
    this.root.querySelector('.legacy-derived').textContent = listValues(derived, LEGACY_DERIVED);
  }

  setAmp(monotony, amp) {
    const mono = clampNum(monotony);
    this.root.querySelector('.legacy-amp').textContent = mono == null || !Number.isFinite(amp)
      ? 'unavailable'
      : `monotony ${Math.round(mono * 100)} / x${amp.toFixed(1)}`;
  }

  setCast(relations) {
    const count = relations && typeof relations === 'object' ? Object.keys(relations).length : 0;
    this.root.querySelector('.legacy-cast').textContent = count ? `${count} synthetic standings` : 'unavailable';
  }

  reset() {
    this.regions = {};
    this.rows = {};
    this._build();
  }
}
