// brain.js - the public window onto Cy's canonical experienced Soma state.
// Values, contributor text and brain shading are supplied by the same runner
// snapshot. Implementation internals and legacy placeholders stay collapsed.

export const EXPERIENCED_METRICS = [
  { key: 'anxiety', label: 'ANXIETY' },
  { key: 'arousal', label: 'AROUSAL / STRESS' },
  { key: 'pain', label: 'PAIN / DISCOMFORT' },
  { key: 'hunger', label: 'HUNGER' },
  { key: 'fatigue', label: 'FATIGUE' },
  { key: 'loneliness', label: 'LONELINESS / SOCIAL NEED' },
  { key: 'anger', label: 'ANGER / HOSTILITY' },
  { key: 'rumination', label: 'RUMINATION / FIXATION' },
];

export const BRAIN_REGIONS = [
  { key: 'amygdala', label: 'Amygdala analogy', path: 'M48 70 C68 48 99 40 125 48 L130 92 C103 98 77 104 54 96 Z' },
  { key: 'prefrontal', label: 'Prefrontal analogy', path: 'M60 104 C82 87 107 87 132 97 L137 126 C107 130 80 127 58 117 Z' },
  { key: 'acc', label: 'Anterior cingulate analogy', path: 'M119 67 C150 54 190 59 213 79 L202 93 C178 78 148 76 126 89 Z' },
  { key: 'insula', label: 'Insula analogy', path: 'M129 112 C145 96 172 94 191 107 C184 129 158 141 136 132 Z' },
  { key: 'hippocampal', label: 'Hippocampal analogy', path: 'M166 151 C185 140 218 145 239 163 C218 158 210 174 193 179 C180 179 169 168 166 151 Z' },
  { key: 'temporalSocial', label: 'Temporal / social analogy', path: 'M218 125 C246 119 278 129 291 151 C276 174 244 184 213 176 C225 157 228 143 218 125 Z' },
];

const CIRCUITS = [
  ['actionSelection', 'ACTION SELECTION'], ['selfModel', 'SELF MODEL'],
  ['predictionError', 'PREDICTION ERROR'], ['interoception', 'INTEROCEPTION'],
  ['threatAppraisal', 'THREAT APPRAISAL'], ['memoryRecall', 'MEMORY RECALL'],
  ['attention', 'ATTENTION'], ['affiliation', 'AFFILIATION'],
];
const LEGACY_MENTAL = ['anxiety', 'stress', 'despair', 'hope', 'lucidity', 'agitation', 'dissociation', 'anger', 'longing'];
const LEGACY_DERIVED = ['confusion', 'overwhelm', 'numbness', 'paranoia', 'fixation', 'resignation', 'brittleness'];

const clamp01 = (value) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null;
const clamp100 = (value) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;

function activityColor(value) {
  const v = clamp01(value) || 0;
  const stops = [[38, 58, 75], [47, 112, 135], [205, 146, 66], [240, 91, 54]];
  const scaled = v * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(scaled));
  const t = scaled - index;
  return `rgb(${stops[index].map((x, i) => Math.round(x + (stops[index + 1][i] - x) * t)).join(',')})`;
}

function listValues(obj, keys) {
  if (!obj) return 'unavailable';
  const present = keys.filter((key) => clamp01(obj[key]) != null)
    .map((key) => `${key} ${Math.round(clamp01(obj[key]) * 100)}`);
  return present.length ? present.join(' / ') : 'unavailable';
}

export function metricExplanation(metric) {
  if (!metric) return 'No current state is available.';
  const trend = metric.trend === 'rising' ? `rising ${Math.abs(metric.trendDelta || 0).toFixed(1)} points`
    : metric.trend === 'falling' ? `falling ${Math.abs(metric.trendDelta || 0).toFixed(1)} points`
      : 'steady over the recent window';
  const contributors = visibleContributors(metric);
  if (!contributors.length) {
    return `Current level ${metric.value}. Usual resting level ${metric.baseline}. It is ${trend}; no recent influence is materially above the resting tendency.`;
  }
  const causes = contributors.slice(0, 4).map((item) => `${item.contribution >= 0 ? '+' : ''}${item.contribution}: ${item.description}`).join('; ');
  return `Current level ${metric.value}. Usual resting level ${metric.baseline}. It is ${trend}. Main recent influences: ${causes}.`;
}

export function metricStateSummary(metric) {
  if (!metric) return 'No current state is available.';
  const trend = metric.trend === 'rising' ? `It has risen ${Math.abs(metric.trendDelta || 0).toFixed(1)} points recently.`
    : metric.trend === 'falling' ? `It has fallen ${Math.abs(metric.trendDelta || 0).toFixed(1)} points recently.`
      : 'It has been steady recently.';
  return `Current level ${metric.value}; usual resting level ${metric.baseline}. ${trend}`;
}

export function visibleContributors(metric, limit = 4) {
  const source = Array.isArray(metric && metric.contributors) ? metric.contributors : [];
  const seen = new Set();
  const result = [];
  for (const contributor of source) {
    const description = String(contributor && contributor.description || '').trim();
    if (!description || seen.has(description)) continue;
    seen.add(description);
    result.push(contributor);
    if (result.length >= limit) break;
  }
  return result;
}

export function contributorExplanation(contributor) {
  const amount = Number(contributor && contributor.contribution) || 0;
  const effect = amount >= 0 ? `raised this by ${Math.abs(amount)}` : `lowered this by ${Math.abs(amount)}`;
  const at = Number.isFinite(contributor && contributor.startedAtMs)
    ? new Date(contributor.startedAtMs).toLocaleString()
    : 'time unavailable';
  return `${String(contributor && contributor.description || 'Unlabelled influence')} - ${effect} (${at})`;
}

export function buildHistoryPath(points, width = 280, height = 80) {
  const clean = (Array.isArray(points) ? points : []).filter((point) => Number.isFinite(point.ts) && Number.isFinite(point.value));
  if (!clean.length) return '';
  const minTs = clean[0].ts;
  const maxTs = clean[clean.length - 1].ts;
  const span = Math.max(1, maxTs - minTs);
  const gaps = clean.slice(1).map((point, i) => point.ts - clean[i].ts).filter((gap) => gap > 0).sort((a, b) => a - b);
  const median = gaps.length ? gaps[Math.floor(gaps.length / 2)] : span;
  const breakAt = Math.max(median * 3, 60000);
  return clean.map((point, index) => {
    const x = ((point.ts - minTs) / span) * width;
    const y = height - (Math.max(0, Math.min(100, point.value)) / 100) * height;
    const command = index === 0 || point.ts - clean[index - 1].ts > breakAt ? 'M' : 'L';
    return `${command}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
}

export function buildHistoryUrl(base, scope, key, range) {
  const separator = String(base || '').includes('?') ? '&' : '?';
  return `${base}${separator}scope=${encodeURIComponent(scope)}&key=${encodeURIComponent(key)}&range=${encodeURIComponent(range)}`;
}

function historyMarkup() {
  return `<div class="soma-reading-history">
    <div class="soma-ranges" aria-label="History range">
      <button type="button" data-range="1h">1H</button><button type="button" data-range="24h" class="active">24H</button><button type="button" data-range="7d">7D</button>
    </div>
    <svg class="soma-history" viewBox="0 0 280 80" preserveAspectRatio="none" role="img" aria-label="Stored state history"><path></path></svg>
    <p class="soma-history-note">Open this reading to load stored history.</p>
  </div>`;
}

export class BrainHud {
  constructor(root, { historyUrl = '' } = {}) {
    this.root = root;
    this.historyUrl = historyUrl;
    this.metrics = {};
    this.latestBrain = {};
    this.rows = {};
    this.regions = {};
    this.regionRows = {};
    this.historyRequests = new WeakMap();
    this._build();
  }

  _build() {
    this.root.classList.add('brainhud');
    this.root.innerHTML = `
      <div class="inference-measured">
        <span class="measure-dot"></span><span class="measure-label">MODEL INFERENCE</span>
        <span class="measure-value">IDLE</span><span class="measure-kind">MEASURED</span>
      </div>
      <div class="soma-implemented" hidden>
        <div class="soma-head"><span class="soma-badge">SOMA EXPERIENCED STATE</span><span class="soma-live available" aria-label="Soma state available"></span></div>
        <p class="soma-caveat">Persistent state computed before language from body, time, events, memory and social contact. Select any reading for its causes and history. Brain regions are functional analogies, not measured physiology.</p>
        <div class="soma-public-readout"></div>
        <div class="brain-figure">
          <svg class="brain-svg" viewBox="0 0 340 230" role="group" aria-label="Soma functional brain analogy">
            <path class="brain-shell" d="M34 128 C24 91 45 60 80 43 C105 20 147 19 178 31 C214 27 257 40 286 66 C309 86 316 116 303 139 C307 157 294 176 272 181 C252 198 212 204 179 196 C148 204 108 195 82 178 C55 172 38 154 34 128 Z"/>
            <path class="brain-cerebellum" d="M235 164 C262 151 295 158 304 178 C296 197 264 205 235 189 C226 181 227 171 235 164 Z"/>
            <path class="brain-stem" d="M213 178 C226 183 237 193 235 219 L218 219 C220 201 207 192 196 184 Z"/>
            <path class="brain-folds" d="M54 83 C85 72 105 72 132 82 M46 111 C78 102 98 107 119 119 M82 50 C104 60 110 71 111 93 M143 40 C154 60 153 79 142 98 M184 39 C197 56 203 73 198 94 M230 48 C238 66 242 83 237 105 M273 73 C284 91 284 110 274 128 M236 132 C253 141 261 153 260 173 M94 146 C117 137 137 140 153 154"/>
          </svg>
          <div class="brain-key">SOMA / FUNCTIONAL ANALOGY</div>
        </div>
        <div class="soma-region-list" aria-label="Functional brain region states"></div>
        <details class="soma-diagnostics"><summary>SOMA DIAGNOSTICS</summary><div class="soma-diagnostic-rows"></div><div class="soma-selection"></div></details>
      </div>
      <details class="legacy-box"><summary>PLANNED STATS</summary>
        <p class="soma-pending-note"><strong>Experienced state:</strong> waiting for an implemented runner snapshot.</p>
        <p>Legacy synthetic values are retained only for compatibility and are not observations or clinical measures.</p>
        <dl><div><dt>heartbeat model</dt><dd class="legacy-heart">-- BPM</dd></div>
        <div><dt>legacy mood axes</dt><dd class="legacy-mental">unavailable</dd></div>
        <div><dt>legacy composites</dt><dd class="legacy-derived">unavailable</dd></div>
        <div><dt>monotony amp</dt><dd class="legacy-amp">unavailable</dd></div>
        <div><dt>legacy brain map</dt><dd class="legacy-brain">unavailable</dd></div>
        <div><dt>cast standing</dt><dd class="legacy-cast">unavailable</dd></div></dl>
      </details>`;

    const readout = this.root.querySelector('.soma-public-readout');
    for (const definition of EXPERIENCED_METRICS) {
      const entry = document.createElement('details');
      entry.className = 'soma-state-entry soma-reading-entry';
      entry.dataset.metric = definition.key;
      entry.innerHTML = `<summary class="soma-state-row"><span class="soma-state-label">${definition.label}</span><span class="soma-state-trend">--</span><strong class="soma-state-value">--</strong><span class="soma-state-bar"><i></i></span></summary>
        <div class="soma-reading-detail"><p class="soma-reading-description">Awaiting Soma state.</p><p class="soma-influences-title">RECENT INFLUENCES</p><ul class="soma-contributors"></ul>${historyMarkup()}</div>`;
      this._wireReading(entry, 'metric', definition.key);
      readout.appendChild(entry);
      this.rows[definition.key] = entry;
    }
    const svg = this.root.querySelector('.brain-svg');
    const regionList = this.root.querySelector('.soma-region-list');
    for (const definition of BRAIN_REGIONS) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', definition.path);
      path.setAttribute('class', 'soma-region');
      path.setAttribute('tabindex', '0');
      path.setAttribute('role', 'button');
      path.setAttribute('aria-controls', `soma-region-${definition.key}`);
      path.setAttribute('aria-expanded', 'false');
      path.dataset.region = definition.key;
      path.addEventListener('click', () => this.openRegion(definition.key));
      path.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); this.openRegion(definition.key); }
      });
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = 'Awaiting Soma state';
      path.appendChild(title);
      svg.appendChild(path);
      this.regions[definition.key] = path;

      const entry = document.createElement('details');
      entry.className = 'soma-region-entry';
      entry.id = `soma-region-${definition.key}`;
      entry.dataset.region = definition.key;
      entry.innerHTML = `<summary><span class="soma-region-name">${definition.label}</span><strong class="soma-region-state">--</strong></summary>
        <div class="soma-reading-detail"><p class="soma-reading-description">Awaiting Soma state.</p>${historyMarkup()}</div>`;
      entry.addEventListener('toggle', () => path.setAttribute('aria-expanded', String(entry.open)));
      this._wireReading(entry, 'brain', definition.key);
      regionList.appendChild(entry);
      this.regionRows[definition.key] = entry;

      for (const item of [path, entry]) {
        item.addEventListener('mouseenter', () => this.setRegionAssociation(definition.key, true));
        item.addEventListener('mouseleave', () => this.setRegionAssociation(definition.key, false));
        item.addEventListener('focusin', () => this.setRegionAssociation(definition.key, true));
        item.addEventListener('focusout', () => this.setRegionAssociation(definition.key, false));
      }
    }
    const diagnostics = this.root.querySelector('.soma-diagnostic-rows');
    for (const [key, label] of CIRCUITS) {
      const row = document.createElement('div');
      row.className = 'soma-diagnostic-row';
      row.dataset.circuit = key;
      row.innerHTML = `<span>${label}</span><strong>--</strong><small>awaiting source</small>`;
      diagnostics.appendChild(row);
    }
    this.measure = { root: this.root.querySelector('.inference-measured'), value: this.root.querySelector('.measure-value') };
  }

  _wireReading(entry, scope, key) {
    entry.classList.add('soma-reading-entry');
    entry.dataset.readingScope = scope;
    entry.dataset.readingKey = key;
    entry.addEventListener('toggle', () => {
      if (!entry.open) return;
      const active = entry.querySelector('.soma-ranges button.active');
      this.loadHistory(entry, scope, key, active ? active.dataset.range : '24h');
    });
    entry.querySelectorAll('.soma-ranges button').forEach((button) => button.addEventListener('click', () => {
      entry.querySelectorAll('.soma-ranges button').forEach((item) => item.classList.toggle('active', item === button));
      this.loadHistory(entry, scope, key, button.dataset.range);
    }));
  }

  setSoma(soma) {
    if (!soma || soma.status !== 'implemented' || !soma.experienced || !soma.experienced.metrics) return;
    this.root.querySelector('.soma-implemented').hidden = false;
    this.root.querySelector('.soma-pending-note').hidden = true;
    this.metrics = soma.experienced.metrics;
    this.latestBrain = soma.experienced.brain || {};
    for (const definition of EXPERIENCED_METRICS) {
      const metric = this.metrics[definition.key];
      const row = this.rows[definition.key];
      if (!metric || !row) continue;
      const value = clamp100(metric.value);
      row.querySelector('.soma-state-value').textContent = value == null ? '--' : String(Math.round(value));
      row.querySelector('.soma-state-trend').textContent = metric.trend === 'rising' ? 'rising' : metric.trend === 'falling' ? 'falling' : 'steady';
      row.querySelector('.soma-state-bar i').style.width = `${value || 0}%`;
      row.querySelector('.soma-state-bar i').style.backgroundColor = activityColor((value || 0) / 100);
      row.querySelector('summary').title = metricExplanation(metric);
      this.renderMetric(definition.key);
    }
    for (const definition of BRAIN_REGIONS) {
      const reading = this.latestBrain[definition.key];
      const region = this.regions[definition.key];
      const entry = this.regionRows[definition.key];
      if (!reading || !region || !entry) continue;
      const value = clamp01(reading.value) || 0;
      const percentage = Math.round(value * 100);
      const description = `${reading.label}: ${reading.level}. ${reading.explanation} Current activity: ${percentage}%.`;
      region.style.fill = activityColor(value);
      region.style.fillOpacity = String(0.25 + value * 0.75);
      region.classList.toggle('active', value >= 0.5);
      region.querySelector('title').textContent = description;
      region.setAttribute('aria-label', `${reading.label}: ${reading.level}`);
      entry.querySelector('.soma-region-name').textContent = reading.label;
      entry.querySelector('.soma-region-state').textContent = `${String(reading.level).toUpperCase()} ${percentage}%`;
      entry.querySelector('.soma-reading-description').textContent = description;
    }
    for (const [key] of CIRCUITS) {
      const reading = soma.circuits && soma.circuits[key];
      const row = this.root.querySelector(`.soma-diagnostic-row[data-circuit="${key}"]`);
      if (!reading || !row) continue;
      row.querySelector('strong').textContent = `${Math.round((clamp01(reading.value) || 0) * 100)}%`;
      row.querySelector('small').textContent = reading.source || 'implemented Soma state';
    }
    const action = soma.action || {};
    const attention = soma.attention || {};
    const memory = soma.memory || {};
    const expression = soma.expression || {};
    const associations = soma.associations || {};
    const selection = this.root.querySelector('.soma-selection');
    selection.textContent = '';
    const diagnosticValues = [
      ['ACTION', action.name ? `${action.name}: ${action.reason || ''}` : 'none'],
      ['ATTENTION', attention.text || 'none'],
      ['EPISODIC MEMORY', `${Number(memory.episodes) || 0} episodes`],
      ['SELF-QUESTION', soma.selfModel && soma.selfModel.question || 'unavailable'],
      ['SELF-OUTPUT FEEDBACK', expression.observedAtMs ? `trigger ${Math.round((expression.triggerActivation || 0) * 100)} / repetition ${Math.round((expression.repetition || 0) * 100)}` : 'waiting'],
      ['LEARNED WORD ASSOCIATIONS', `${Number(associations.learned) || 0} learned`],
    ];
    for (const [label, value] of diagnosticValues) {
      const item = document.createElement('div');
      const span = document.createElement('span');
      const strong = document.createElement('strong');
      span.textContent = label;
      strong.textContent = value;
      item.append(span, strong);
      selection.appendChild(item);
    }
  }

  renderMetric(key) {
    const metric = this.metrics[key];
    const entry = this.rows[key];
    if (!metric || !entry) return;
    const detail = entry.querySelector('.soma-reading-detail');
    detail.querySelector('.soma-reading-description').textContent = metricStateSummary(metric);
    const list = detail.querySelector('.soma-contributors');
    const contributors = visibleContributors(metric);
    detail.querySelector('.soma-influences-title').hidden = contributors.length === 0;
    list.textContent = '';
    for (const contributor of contributors) {
      const item = document.createElement('li');
      item.textContent = contributorExplanation(contributor);
      list.appendChild(item);
    }
  }

  openRegion(key) {
    const entry = this.regionRows[key];
    if (!entry) return;
    entry.open = !entry.open;
  }

  setRegionAssociation(key, associated) {
    const region = this.regions[key];
    const entry = this.regionRows[key];
    if (region) region.classList.toggle('is-associated', associated);
    if (entry) entry.classList.toggle('is-associated', associated);
  }

  async loadHistory(entry, scope, key, range) {
    const note = entry.querySelector('.soma-history-note');
    const path = entry.querySelector('.soma-history path');
    if (!this.historyUrl) { note.textContent = 'History endpoint unavailable.'; return; }
    const request = {};
    this.historyRequests.set(entry, request);
    note.textContent = 'Loading stored history...';
    try {
      const response = await fetch(buildHistoryUrl(this.historyUrl, scope, key, range), { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'history unavailable');
      if (this.historyRequests.get(entry) !== request) return;
      path.setAttribute('d', buildHistoryPath(data.points));
      note.textContent = data.points.length ? `${data.points.length} stored ${range} readings. Gaps mean no runner data was recorded.` : `No stored readings in the last ${range}.`;
    } catch (error) {
      if (this.historyRequests.get(entry) !== request) return;
      path.setAttribute('d', '');
      note.textContent = `History unavailable: ${error.message}`;
    }
  }

  setInference(phase) {
    const value = ['eval', 'gen'].includes(phase) ? phase : 'idle';
    this.measure.value.textContent = value.toUpperCase();
    this.measure.root.dataset.phase = value;
  }

  setBrain(brain) { this.root.querySelector('.legacy-brain').textContent = brain && Object.keys(brain).length ? `${Object.keys(brain).length} synthetic regions` : 'unavailable'; }
  setHeart(hr) { this.root.querySelector('.legacy-heart').textContent = Number.isFinite(hr) ? `${Math.round(hr)} BPM` : 'unavailable'; }
  setMental(mental) { this.root.querySelector('.legacy-mental').textContent = listValues(mental, LEGACY_MENTAL); }
  setDerived(derived) { this.root.querySelector('.legacy-derived').textContent = listValues(derived, LEGACY_DERIVED); }
  setAmp(monotony, amp) { this.root.querySelector('.legacy-amp').textContent = clamp01(monotony) == null || !Number.isFinite(amp) ? 'unavailable' : `monotony ${Math.round(monotony * 100)} / x${amp.toFixed(1)}`; }
  setCast(relations) { this.root.querySelector('.legacy-cast').textContent = relations && Object.keys(relations).length ? `${Object.keys(relations).length} synthetic standings` : 'unavailable'; }

  reset() { this.metrics = {}; this.latestBrain = {}; this.rows = {}; this.regions = {}; this.regionRows = {}; this.historyRequests = new WeakMap(); this._build(); }
}
