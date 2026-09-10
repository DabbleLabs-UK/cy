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
  { key: 'scnCircadian', label: 'SCN / circadian pacemaker analogy', path: 'M164 127 m-7 0 a7 7 0 1 0 14 0 a7 7 0 1 0 -14 0' },
  { key: 'amygdala', label: 'Amygdala analogy', path: 'M48 70 C68 48 99 40 125 48 L130 92 C103 98 77 104 54 96 Z' },
  { key: 'prefrontal', label: 'Prefrontal analogy', path: 'M60 104 C82 87 107 87 132 97 L137 126 C107 130 80 127 58 117 Z' },
  { key: 'acc', label: 'Anterior cingulate analogy', path: 'M119 67 C150 54 190 59 213 79 L202 93 C178 78 148 76 126 89 Z' },
  { key: 'insula', label: 'Insula analogy', path: 'M129 112 C145 96 172 94 191 107 C184 129 158 141 136 132 Z' },
  { key: 'hippocampal', label: 'Hippocampal analogy', path: 'M166 151 C185 140 218 145 239 163 C218 158 210 174 193 179 C180 179 169 168 166 151 Z' },
  { key: 'temporalSocial', label: 'Temporal / social analogy', path: 'M218 125 C246 119 278 129 291 151 C276 174 244 184 213 176 C225 157 228 143 218 125 Z' },
];

export const IMPLEMENTATION_STATUS = Object.freeze({
  IMPLEMENTED: 'IMPLEMENTED',
  PROVISIONAL: 'PROVISIONAL',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
});

const STATUS_LABEL = Object.freeze({
  IMPLEMENTED: 'LIVE',
  PROVISIONAL: 'PROVISIONAL',
  NOT_IMPLEMENTED: 'NOT MODELLED',
});

export function implementationStatus(registry, scope, id) {
  const entries = registry && Array.isArray(registry[scope]) ? registry[scope] : [];
  const entry = entries.find((item) => item && item.id === id) || null;
  const status = entry && Object.values(IMPLEMENTATION_STATUS).includes(entry.implementation_status)
    ? entry.implementation_status
    : IMPLEMENTATION_STATUS.NOT_IMPLEMENTED;
  return {
    id,
    displayName: entry && entry.display_name ? entry.display_name : id.replaceAll('_', ' ').toUpperCase(),
    status,
    publicLabel: registry && registry.statuses && registry.statuses[status] && registry.statuses[status].public_label
      ? registry.statuses[status].public_label
      : STATUS_LABEL[status],
    note: entry && entry.status_note ? entry.status_note : 'No implementation registry entry exists for this system.',
    dependencies: entry && Array.isArray(entry.data_dependencies) ? entry.data_dependencies : [],
    version: entry && entry.version ? entry.version : null,
  };
}

export function canRenderDynamicActivity(status) {
  return status === IMPLEMENTATION_STATUS.IMPLEMENTED;
}

export function overallImplementationLabel(registry) {
  const entries = registry && Array.isArray(registry.soma_variables) ? registry.soma_variables : [];
  if (entries.length && entries.every((entry) => entry.implementation_status === IMPLEMENTATION_STATUS.IMPLEMENTED)) return 'LIVE';
  if (entries.some((entry) => [IMPLEMENTATION_STATUS.IMPLEMENTED, IMPLEMENTATION_STATUS.PROVISIONAL].includes(entry.implementation_status))) return 'PROVISIONAL';
  return 'NOT MODELLED';
}

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

function signed(value, digits = 3) {
  if (!Number.isFinite(value)) return '--';
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
}

function clockLabel(decimalHours) {
  if (!Number.isFinite(decimalHours)) return '--:--';
  const totalMinutes = Math.round((((decimalHours % 24) + 24) % 24) * 60) % (24 * 60);
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
}

export function buildCircadianHistoryPaths(points, width = 280, height = 80, waveformRange = null) {
  const clean = (Array.isArray(points) ? points : []).filter((point) => Number.isFinite(point.ts)
    && Number.isFinite(point.value) && Number.isFinite(point.minimum) && Number.isFinite(point.maximum));
  if (!clean.length) return { estimate: '', band: '', minimum: null, maximum: null };
  const minTs = clean[0].ts;
  const maxTs = clean[clean.length - 1].ts;
  const span = Math.max(1, maxTs - minTs);
  const minimum = Number.isFinite(waveformRange && waveformRange.minimum)
    ? waveformRange.minimum
    : Math.min(...clean.map((point) => point.minimum));
  const maximum = Number.isFinite(waveformRange && waveformRange.maximum)
    ? waveformRange.maximum
    : Math.max(...clean.map((point) => point.maximum));
  const valueSpan = Math.max(Number.EPSILON, maximum - minimum);
  const xy = (point, field) => ({
    x: ((point.ts - minTs) / span) * width,
    y: height - ((point[field] - minimum) / valueSpan) * height,
  });
  const estimate = clean.map((point, index) => {
    const position = xy(point, 'value');
    return `${index === 0 ? 'M' : 'L'}${position.x.toFixed(1)} ${position.y.toFixed(1)}`;
  }).join(' ');
  const upper = clean.map((point, index) => {
    const position = xy(point, 'maximum');
    return `${index === 0 ? 'M' : 'L'}${position.x.toFixed(1)} ${position.y.toFixed(1)}`;
  }).join(' ');
  const lower = [...clean].reverse().map((point) => {
    const position = xy(point, 'minimum');
    return `L${position.x.toFixed(1)} ${position.y.toFixed(1)}`;
  }).join(' ');
  return { estimate, band: `${upper} ${lower} Z`, minimum, maximum };
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

function circadianHistoryMarkup() {
  return `<div class="circadian-history-wrap">
    <div class="circadian-ranges" aria-label="Circadian Process C history range">
      <button type="button" data-range="1h">1H</button><button type="button" data-range="24h" class="active">24H</button><button type="button" data-range="7d">7D</button>
    </div>
    <svg class="circadian-history" viewBox="0 0 280 80" preserveAspectRatio="none" role="img" aria-label="Mathematically reconstructed Circadian Process C history and phase uncertainty">
      <path class="circadian-history-band"></path><path class="circadian-history-line"></path>
    </svg>
    <p class="circadian-history-note">Open this reading to reconstruct the published waveform from the stored schedule phase basis.</p>
  </div>`;
}

function sleepHomeostasisMarkup(status, circadianStatus, admin) {
  return `<div class="sleep-regulation-stack"><section class="sleep-homeostasis-card status-${status.status.toLowerCase().replace('_', '-')}">
    <div class="sleep-homeostasis-head"><span>${status.displayName}</span><strong class="sleep-homeostasis-status">${status.publicLabel}</strong></div>
    <div class="sleep-pressure-reading"><strong class="sleep-pressure-value">--</strong><span>SLEEP PRESSURE INDEX</span></div>
    <p class="sleep-homeostasis-explanation">Sleep pressure accumulates while Cy is awake and dissipates during sleep.</p>
    <p class="sleep-homeostasis-state">Current sleep state unavailable.</p>
    <p class="sleep-homeostasis-calibration">Waiting for observed sleep history.</p>
    <p class="sleep-homeostasis-range">S range unavailable.</p>
    <div class="sleep-homeostasis-history-wrap">
      <div class="sleep-ranges" aria-label="Sleep pressure history range">
        <button type="button" data-range="1h">1H</button><button type="button" data-range="24h" class="active">24H</button><button type="button" data-range="7d">7D</button>
      </div>
      <svg class="soma-history sleep-homeostasis-history" viewBox="0 0 280 80" preserveAspectRatio="none" role="img" aria-label="Stored Process S history"><path></path></svg>
      <p class="sleep-history-note">Open this reading to load stored Process S history.</p>
    </div>
    ${admin ? '<details class="sleep-homeostasis-inspector"><summary>SLEEP HOMEOSTASIS INSPECTION</summary><pre>Waiting for a Process S integration.</pre></details>' : ''}
  </section>
  <section class="circadian-process-card status-${circadianStatus.status.toLowerCase().replace('_', '-')}">
    <div class="circadian-process-head"><span>${circadianStatus.displayName}</span><strong class="circadian-process-status">${circadianStatus.publicLabel}</strong></div>
    <div class="circadian-process-reading"><strong class="circadian-process-value">--</strong><span>MODEL OUTPUT C</span></div>
    <p class="circadian-process-explanation">The circadian component follows a published 24-hour waveform. Cy's exact biological phase cannot be observed, so its phase is estimated from his habitual sleep schedule.</p>
    <p class="circadian-process-phase">Phase basis unavailable.</p>
    <p class="circadian-process-cbtmin">Estimated CBTmin unavailable.</p>
    <p class="circadian-process-range">C uncertainty unavailable.</p>
    ${circadianHistoryMarkup()}
    <p class="circadian-entrainment"><span>CIRCADIAN ENTRAINMENT</span><strong>NOT MODELLED</strong></p>
    ${admin ? '<details class="circadian-process-inspector"><summary>CIRCADIAN PROCESS C INSPECTION</summary><pre>Waiting for a Process C evaluation.</pre></details>' : ''}
  </section></div>`;
}

function threatLearningMarkup(status, volatilityStatus, generalisationStatus, contextualStatus, admin) {
  return `<section class="threat-learning-card status-${status.status.toLowerCase().replace('_', '-')}">
    <div class="threat-learning-head"><span>${status.displayName}</span><strong class="threat-learning-status">${status.publicLabel}</strong></div>
    <p class="threat-learning-explanation">Learns whether a structured cue has been followed by one specific class of adverse outcome. This predicts outcomes; it is not an anxiety or fear-intensity score.</p>
    <div class="threat-learning-associations"><p class="threat-learning-empty">No resolved post-installation trials have been observed yet.</p></div>
    <div class="threat-learning-limits"><span>STATIONARY CUE-OUTCOME LEARNING</span><strong>${status.publicLabel}</strong><span>${volatilityStatus.displayName}</span><strong>${volatilityStatus.publicLabel}</strong><span>${generalisationStatus.displayName}</span><strong>${generalisationStatus.publicLabel}</strong><span>${contextualStatus.displayName}</span><strong>${contextualStatus.publicLabel}</strong></div>
    ${admin ? '<details class="threat-learning-inspector"><summary>THREAT LEARNING INSPECTION</summary><pre>Waiting for a threat-learning snapshot.</pre></details>' : ''}
  </section>`;
}

export class BrainHud {
  constructor(root, { historyUrl = '', threatLearningUrl = '', registry = null, admin = false } = {}) {
    this.root = root;
    this.historyUrl = historyUrl;
    this.threatLearningUrl = threatLearningUrl;
    this.registry = registry || {};
    this.admin = admin;
    this.sleepHomeostasisStatus = implementationStatus(this.registry, 'soma_subsystems', 'sleep_homeostasis');
    this.circadianStatus = implementationStatus(this.registry, 'soma_subsystems', 'circadian_process_c');
    this.threatLearningStatus = implementationStatus(this.registry, 'soma_subsystems', 'probabilistic_threat_learning');
    this.threatVolatilityStatus = implementationStatus(this.registry, 'soma_subsystems', 'threat_volatility');
    this.threatGeneralisationStatus = implementationStatus(this.registry, 'soma_subsystems', 'threat_generalisation');
    this.threatContextualStatus = implementationStatus(this.registry, 'soma_subsystems', 'threat_contextual_inference');
    const regionGeometry = new Map(BRAIN_REGIONS.map((region) => [region.key, region]));
    this.metricDefinitions = EXPERIENCED_METRICS.map((definition) => ({
      ...definition,
      status: implementationStatus(this.registry, 'soma_variables', definition.key),
    }));
    const registeredRegions = Array.isArray(this.registry.brain_regions) && this.registry.brain_regions.length
      ? this.registry.brain_regions
      : BRAIN_REGIONS.map((region) => ({ id: region.key, display_name: region.label }));
    this.regionDefinitions = registeredRegions.map((registered) => ({
      ...(regionGeometry.get(registered.id) || {}),
      key: registered.id,
      label: registered.display_name || (regionGeometry.get(registered.id) || {}).label || registered.id,
      status: implementationStatus(this.registry, 'brain_regions', registered.id),
    }));
    this.metrics = {};
    this.latestBrain = {};
    this.rows = {};
    this.regions = {};
    this.regionRows = {};
    this.historyRequests = new WeakMap();
    this.sleepHistoryRequests = new WeakMap();
    this.circadianHistoryRequests = new WeakMap();
    this.scnPhaseHand = null;
    this._build();
  }

  _build() {
    this.root.classList.add('brainhud');
    this.root.innerHTML = `
      <div class="inference-measured">
        <span class="measure-dot"></span><span class="measure-label">MODEL INFERENCE</span>
        <span class="measure-value">IDLE</span><span class="measure-kind">MEASURED</span>
      </div>
      <div class="soma-scaffold">
        <div class="soma-head"><span class="soma-badge">SOMA MODEL STATUS</span><span class="soma-overall-status">PROVISIONAL</span></div>
        <p class="soma-caveat">The displayed values come from an older heuristic model and are marked accordingly. Brain regions are functional analogies, not measured physiology; unfinished mappings do not display activation.</p>
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
        <details class="soma-diagnostics"><summary>LEGACY SOMA DIAGNOSTICS - PROVISIONAL</summary><div class="soma-diagnostic-rows"></div><div class="soma-selection"></div></details>
      </div>
      <details class="legacy-box"><summary>PLANNED STATS</summary>
        <p class="soma-pending-note"><strong>Implementation registry:</strong> unavailable systems remain blank rather than displaying fake zeroes.</p>
        <p>Legacy synthetic values are retained only for compatibility and are not observations or clinical measures.</p>
        <dl><div><dt>heartbeat model</dt><dd class="legacy-heart">-- BPM</dd></div>
        <div><dt>legacy mood axes</dt><dd class="legacy-mental">unavailable</dd></div>
        <div><dt>legacy composites</dt><dd class="legacy-derived">unavailable</dd></div>
        <div><dt>monotony amp</dt><dd class="legacy-amp">unavailable</dd></div>
        <div><dt>legacy brain map</dt><dd class="legacy-brain">unavailable</dd></div>
        <div><dt>cast standing</dt><dd class="legacy-cast">unavailable</dd></div></dl>
      </details>`;

    this.root.querySelector('.soma-overall-status').textContent = overallImplementationLabel(this.registry);

    const readout = this.root.querySelector('.soma-public-readout');
    for (const definition of this.metricDefinitions) {
      const entry = document.createElement('details');
      entry.className = `soma-state-entry soma-reading-entry status-${definition.status.status.toLowerCase().replace('_', '-')}`;
      entry.dataset.metric = definition.key;
      const sleepHomeostasis = definition.key === 'fatigue'
        ? sleepHomeostasisMarkup(this.sleepHomeostasisStatus, this.circadianStatus, this.admin)
        : '';
      const threatLearning = definition.key === 'anxiety'
        ? threatLearningMarkup(this.threatLearningStatus, this.threatVolatilityStatus, this.threatGeneralisationStatus, this.threatContextualStatus, this.admin)
        : '';
      entry.innerHTML = `<summary class="soma-state-row"><span class="soma-state-label">${definition.status.displayName}</span><span class="soma-state-status">${definition.status.publicLabel}</span><span class="soma-state-trend">--</span><strong class="soma-state-value">--</strong><span class="soma-state-bar"><i></i></span></summary>
        <div class="soma-reading-detail"><p class="soma-reading-description">${definition.status.note}</p><p class="soma-influences-title">RECENT INFLUENCES - PROVISIONAL</p><ul class="soma-contributors"></ul>${historyMarkup()}${threatLearning}${sleepHomeostasis}</div>`;
      this._wireReading(entry, 'metric', definition.key);
      if (definition.key === 'fatigue') this._wireSleepHomeostasis(entry);
      if (definition.key === 'fatigue') this._wireCircadian(entry);
      if (definition.key === 'anxiety') this._wireThreatLearning(entry);
      readout.appendChild(entry);
      this.rows[definition.key] = entry;
    }
    const svg = this.root.querySelector('.brain-svg');
    const regionList = this.root.querySelector('.soma-region-list');
    for (const definition of this.regionDefinitions) {
      let path = null;
      if (definition.path) {
        path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', definition.path);
        path.setAttribute('class', `soma-region status-${definition.status.status.toLowerCase().replace('_', '-')}`);
        path.setAttribute('tabindex', '0');
        path.setAttribute('role', 'button');
        path.setAttribute('aria-controls', `soma-region-${definition.key}`);
        path.setAttribute('aria-expanded', 'false');
        path.dataset.region = definition.key;
        path.dataset.implementationStatus = definition.status.status;
        path.addEventListener('click', () => this.openRegion(definition.key));
        path.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); this.openRegion(definition.key); }
        });
        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        title.textContent = `${definition.status.displayName}. ${definition.status.publicLabel}. ${definition.status.note}`;
        path.appendChild(title);
        svg.appendChild(path);
        this.regions[definition.key] = path;
        if (definition.key === 'scnCircadian') {
          const hand = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          hand.setAttribute('d', 'M164 127 L164 121');
          hand.setAttribute('class', 'scn-phase-hand');
          hand.setAttribute('aria-hidden', 'true');
          svg.appendChild(hand);
          this.scnPhaseHand = hand;
        }
      }

      const entry = document.createElement('details');
      entry.className = `soma-region-entry status-${definition.status.status.toLowerCase().replace('_', '-')}`;
      entry.id = `soma-region-${definition.key}`;
      entry.dataset.region = definition.key;
      entry.dataset.implementationStatus = definition.status.status;
      const regionHistory = canRenderDynamicActivity(definition.status.status)
        ? (definition.key === 'scnCircadian' ? circadianHistoryMarkup() : historyMarkup())
        : '<p class="soma-history-note">No activation history is displayed until this mapping is LIVE.</p>';
      entry.innerHTML = `<summary><span class="soma-region-name">${definition.status.displayName}</span><strong class="soma-region-state">${definition.status.publicLabel}</strong></summary>
        <div class="soma-reading-detail"><p class="soma-reading-description">${definition.status.note}</p>${regionHistory}</div>`;
      entry.addEventListener('toggle', () => {
        if (path) path.setAttribute('aria-expanded', String(entry.open));
      });
      if (definition.key === 'scnCircadian') this._wireCircadian(entry);
      else this._wireReading(entry, 'brain', definition.key);
      regionList.appendChild(entry);
      this.regionRows[definition.key] = entry;

      for (const item of [path, entry].filter(Boolean)) {
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
      const registryScope = scope === 'metric' ? 'soma_variables' : 'brain_regions';
      const registered = implementationStatus(this.registry, registryScope, key);
      if (scope === 'brain' && !canRenderDynamicActivity(registered.status)) return;
      if (registered.status === IMPLEMENTATION_STATUS.NOT_IMPLEMENTED) return;
      const active = entry.querySelector('.soma-ranges button.active');
      if (!active) return;
      this.loadHistory(entry, scope, key, active ? active.dataset.range : '24h');
    });
    entry.querySelectorAll('.soma-ranges button').forEach((button) => button.addEventListener('click', () => {
      entry.querySelectorAll('.soma-ranges button').forEach((item) => item.classList.toggle('active', item === button));
      this.loadHistory(entry, scope, key, button.dataset.range);
    }));
  }

  _wireSleepHomeostasis(entry) {
    entry.addEventListener('toggle', () => {
      if (!entry.open || this.sleepHomeostasisStatus.status !== IMPLEMENTATION_STATUS.IMPLEMENTED) return;
      const active = entry.querySelector('.sleep-ranges button.active');
      this.loadSleepHomeostasisHistory(entry, active ? active.dataset.range : '24h');
    });
    entry.querySelectorAll('.sleep-ranges button').forEach((button) => button.addEventListener('click', () => {
      entry.querySelectorAll('.sleep-ranges button').forEach((item) => item.classList.toggle('active', item === button));
      this.loadSleepHomeostasisHistory(entry, button.dataset.range);
    }));
  }

  _wireCircadian(entry) {
    entry.addEventListener('toggle', () => {
      if (!entry.open || this.circadianStatus.status !== IMPLEMENTATION_STATUS.IMPLEMENTED) return;
      const active = entry.querySelector('.circadian-ranges button.active');
      this.loadCircadianHistory(entry, active ? active.dataset.range : '24h');
    });
    entry.querySelectorAll('.circadian-ranges button').forEach((button) => button.addEventListener('click', () => {
      entry.querySelectorAll('.circadian-ranges button').forEach((item) => item.classList.toggle('active', item === button));
      this.loadCircadianHistory(entry, button.dataset.range);
    }));
  }

  _wireThreatLearning(entry) {
    const inspector = entry.querySelector('.threat-learning-inspector');
    if (!inspector) return;
    inspector.addEventListener('toggle', async () => {
      if (!inspector.open || !this.threatLearningUrl) return;
      const target = inspector.querySelector('pre');
      target.textContent = 'Loading exact posterior state and update history...';
      try {
        const response = await fetch(this.threatLearningUrl, { cache: 'no-store' });
        if (!response.ok) throw new Error(`threat learning ${response.status}`);
        const data = await response.json();
        target.textContent = JSON.stringify(data.inspection || data, null, 2);
      } catch (error) {
        target.textContent = error && error.message ? error.message : 'Threat-learning inspection unavailable.';
      }
    });
  }

  setSoma(soma) {
    if (!soma || !soma.experienced || !soma.experienced.metrics) return;
    this.sleepHomeostasis = soma.sleepHomeostasis || null;
    this.circadianProcessC = soma.circadianProcessC || null;
    this.threatLearning = soma.threatLearning || null;
    this.metrics = soma.experienced.metrics;
    this.latestBrain = soma.experienced.brain || {};
    for (const definition of this.metricDefinitions) {
      const metric = this.metrics[definition.key];
      const row = this.rows[definition.key];
      if (!row) continue;
      if (definition.status.status === IMPLEMENTATION_STATUS.NOT_IMPLEMENTED || !metric) {
        row.querySelector('.soma-state-value').textContent = '--';
        row.querySelector('.soma-state-trend').textContent = definition.status.publicLabel;
        row.querySelector('.soma-state-bar i').style.width = '0%';
        row.querySelector('summary').title = `${definition.status.displayName}. ${definition.status.publicLabel}. ${definition.status.note}`;
        continue;
      }
      const value = clamp100(metric.value);
      row.querySelector('.soma-state-value').textContent = value == null ? '--' : String(Math.round(value));
      row.querySelector('.soma-state-trend').textContent = metric.trend === 'rising' ? 'rising' : metric.trend === 'falling' ? 'falling' : 'steady';
      row.querySelector('.soma-state-bar i').style.width = `${value || 0}%`;
      row.querySelector('.soma-state-bar i').style.backgroundColor = activityColor((value || 0) / 100);
      row.querySelector('summary').title = `${definition.status.displayName}. ${definition.status.publicLabel}. ${definition.status.note} ${metricExplanation(metric)}`;
      this.renderMetric(definition.key);
    }
    this.renderSleepHomeostasis();
    this.renderCircadianProcessC();
    this.renderThreatLearning();
    for (const definition of this.regionDefinitions) {
      const reading = definition.key === 'scnCircadian'
        ? this.circadianProcessC && this.circadianProcessC.scnAnalogy
        : this.latestBrain[definition.key];
      const region = this.regions[definition.key];
      const entry = this.regionRows[definition.key];
      if (!entry) continue;
      const dynamic = canRenderDynamicActivity(definition.status.status) && reading && region;
      const description = `${definition.status.displayName}. ${definition.status.publicLabel}. ${definition.status.note}`;
      entry.querySelector('.soma-region-name').textContent = definition.status.displayName;
      entry.querySelector('.soma-reading-description').textContent = description;
      if (definition.key === 'scnCircadian') {
        const liveScn = canRenderDynamicActivity(definition.status.status)
          && reading && reading.displayMode === 'circadian_phase';
        if (!liveScn) {
          entry.querySelector('.soma-region-state').textContent = 'UNAVAILABLE';
          if (region) region.classList.remove('circadian-phase-live');
          continue;
        }
        const cValue = signed(reading.processCEstimate);
        const phaseHours = Number(reading.circadianPhasePositionHours);
        const liveDescription = `${description} Current model output C ${cValue}; phase position ${clockLabel(phaseHours)} after estimated phi. This is not SCN activation.`;
        entry.querySelector('.soma-region-state').textContent = `LIVE - C ${cValue}`;
        entry.querySelector('.soma-reading-description').textContent = liveDescription;
        if (region) {
          region.classList.add('circadian-phase-live');
          region.querySelector('title').textContent = liveDescription;
          region.setAttribute('aria-label', `${definition.status.displayName}: Process C ${cValue}`);
        }
        if (this.scnPhaseHand && Number.isFinite(phaseHours)) {
          this.scnPhaseHand.setAttribute('transform', `rotate(${(phaseHours / 24) * 360} 164 127)`);
        }
        continue;
      }
      if (!dynamic) {
        entry.querySelector('.soma-region-state').textContent = definition.status.publicLabel;
        if (region) {
          region.style.removeProperty('fill');
          region.style.removeProperty('fill-opacity');
          region.classList.remove('active');
          region.querySelector('title').textContent = description;
          region.setAttribute('aria-label', `${definition.status.displayName}: ${definition.status.publicLabel}`);
        }
        continue;
      }
      const value = clamp01(reading.value) || 0;
      const percentage = Math.round(value * 100);
      const liveDescription = `${description} Current functional activity: ${percentage}%.`;
      region.style.fill = activityColor(value);
      region.style.fillOpacity = String(0.25 + value * 0.75);
      region.classList.toggle('active', value >= 0.5);
      region.querySelector('title').textContent = liveDescription;
      region.setAttribute('aria-label', `${definition.status.displayName}: ${percentage}%`);
      entry.querySelector('.soma-region-state').textContent = `LIVE ${percentage}%`;
      entry.querySelector('.soma-reading-description').textContent = liveDescription;
    }
    for (const [key] of CIRCUITS) {
      const reading = soma.circuits && soma.circuits[key];
      const row = this.root.querySelector(`.soma-diagnostic-row[data-circuit="${key}"]`);
      if (!reading || !row) continue;
      row.querySelector('strong').textContent = `${Math.round((clamp01(reading.value) || 0) * 100)}%`;
      row.querySelector('small').textContent = `PROVISIONAL - ${reading.source || 'legacy Soma state'}`;
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
    const status = implementationStatus(this.registry, 'soma_variables', key);
    detail.querySelector('.soma-reading-description').textContent = `${status.publicLabel}. ${status.note} ${metricStateSummary(metric)}`;
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

  renderThreatLearning() {
    const entry = this.rows.anxiety;
    const card = entry && entry.querySelector('.threat-learning-card');
    if (!card) return;
    const snapshot = this.threatLearning;
    const live = this.threatLearningStatus.status === IMPLEMENTATION_STATUS.IMPLEMENTED
      && snapshot && snapshot.status === 'implemented';
    card.querySelector('.threat-learning-status').textContent = live ? this.threatLearningStatus.publicLabel : 'UNAVAILABLE';
    const root = card.querySelector('.threat-learning-associations');
    root.textContent = '';
    if (!live || !Array.isArray(snapshot.associations) || !snapshot.associations.length) {
      const empty = document.createElement('p');
      empty.className = 'threat-learning-empty';
      empty.textContent = live
        ? 'No resolved post-installation trials have been observed yet.'
        : 'No grounded threat-learning state has reached this view.';
      root.appendChild(empty);
    } else {
      const selected = [];
      const seenOutcomes = new Set();
      for (const association of snapshot.associations) {
        if (seenOutcomes.has(association.outcomeClass)) continue;
        seenOutcomes.add(association.outcomeClass);
        selected.push(association);
      }
      for (const association of selected) {
        const item = document.createElement('article');
        item.className = 'threat-learning-association';
        const heading = document.createElement('strong');
        heading.textContent = `${String(association.cueId).replace(':', ' ')} -> ${String(association.outcomeClass).replaceAll('_', ' ')}`;
        const summary = document.createElement('p');
        summary.textContent = association.evidenceBalance === 'adverse_more_often'
          ? 'This cue has more often been followed by this adverse outcome than not.'
          : association.evidenceBalance === 'safe_more_often'
            ? 'This cue has more often not been followed by this adverse outcome.'
            : 'Resolved observations are evenly split between this outcome occurring and not occurring.';
        item.append(heading, summary);
        root.appendChild(item);
      }
    }
  }

  renderSleepHomeostasis() {
    const entry = this.rows.fatigue;
    const card = entry && entry.querySelector('.sleep-homeostasis-card');
    if (!card) return;
    const snapshot = this.sleepHomeostasis;
    const live = this.sleepHomeostasisStatus.status === IMPLEMENTATION_STATUS.IMPLEMENTED
      && snapshot && snapshot.status === 'implemented';
    card.querySelector('.sleep-homeostasis-status').textContent = live ? this.sleepHomeostasisStatus.publicLabel : 'UNAVAILABLE';
    if (!live) {
      card.querySelector('.sleep-pressure-value').textContent = '--';
      card.querySelector('.sleep-homeostasis-state').textContent = 'Current sleep state unavailable.';
      card.querySelector('.sleep-homeostasis-calibration').textContent = 'No grounded Process S state has reached this view.';
      card.querySelector('.sleep-homeostasis-range').textContent = 'S range unavailable.';
      return;
    }
    card.querySelector('.sleep-pressure-value').textContent = Number.isFinite(snapshot.sleepPressureIndex)
      ? String(snapshot.sleepPressureIndex)
      : '--';
    card.querySelector('.sleep-homeostasis-state').textContent = `Current state: ${String(snapshot.currentSleepState || 'unknown').toUpperCase()}`;
    card.querySelector('.sleep-homeostasis-calibration').textContent = snapshot.calibrating
      ? 'CALIBRATING FROM OBSERVED SLEEP HISTORY'
      : 'ESTABLISHED FROM OBSERVED SLEEP HISTORY';
    card.querySelector('.sleep-homeostasis-range').textContent = Number.isFinite(snapshot.sMin) && Number.isFinite(snapshot.sMax)
      ? `Current uncertainty: S ${snapshot.sMin.toFixed(3)} to ${snapshot.sMax.toFixed(3)}`
      : 'S range unavailable.';
    const inspector = card.querySelector('.sleep-homeostasis-inspector pre');
    if (inspector) {
      const detail = snapshot.inspection;
      inspector.textContent = detail ? [
        `current state: ${detail.currentState}`,
        `elapsed interval used: ${detail.elapsedIntervalMs} ms`,
        `interval state: ${detail.intervalState}`,
        `Process S before: ${JSON.stringify(detail.processSBefore)}`,
        `Process S after: ${JSON.stringify(detail.processSAfter)}`,
        `S_min / S_max: ${snapshot.sMin.toFixed(6)} / ${snapshot.sMax.toFixed(6)}`,
        `model: ${detail.model}`,
        `tau wake: ${detail.tauWakeHours} h - literature`,
        `tau sleep: ${detail.tauSleepHours} h - literature`,
        `source: ${detail.source}`,
      ].join('\n') : 'Waiting for a Process S integration.';
    }
  }

  renderCircadianProcessC() {
    const entry = this.rows.fatigue;
    const card = entry && entry.querySelector('.circadian-process-card');
    if (!card) return;
    const snapshot = this.circadianProcessC;
    const live = this.circadianStatus.status === IMPLEMENTATION_STATUS.IMPLEMENTED
      && snapshot && snapshot.status === 'implemented';
    card.querySelector('.circadian-process-status').textContent = live ? this.circadianStatus.publicLabel : 'UNAVAILABLE';
    if (!live) {
      card.querySelector('.circadian-process-value').textContent = '--';
      card.querySelector('.circadian-process-phase').textContent = 'No grounded Process C state has reached this view.';
      card.querySelector('.circadian-process-cbtmin').textContent = 'Estimated CBTmin unavailable.';
      card.querySelector('.circadian-process-range').textContent = 'C uncertainty unavailable.';
      return;
    }
    card.querySelector('.circadian-process-value').textContent = signed(snapshot.processCEstimate);
    card.querySelector('.circadian-process-phase').textContent = `PHASE SCHEDULE-ESTIMATED - habitual wake ${clockLabel(snapshot.schedule && snapshot.schedule.habitualWakeHour)}`;
    card.querySelector('.circadian-process-cbtmin').textContent = `Estimated CBTmin ${clockLabel(snapshot.estimatedCbtmin && snapshot.estimatedCbtmin.startHour)} to ${clockLabel(snapshot.estimatedCbtmin && snapshot.estimatedCbtmin.endHour)} - direct biological phase is not observed.`;
    card.querySelector('.circadian-process-range').textContent = `Current uncertainty: C ${signed(snapshot.processCMin)} to ${signed(snapshot.processCMax)}`;
    const inspector = card.querySelector('.circadian-process-inspector pre');
    if (inspector) {
      inspector.textContent = [
        `model: ${snapshot.modelName}`,
        `clock time: ${clockLabel(snapshot.clockHours)} (${snapshot.clockHours.toFixed(6)} h)`,
        `habitual wake: ${clockLabel(snapshot.schedule.habitualWakeHour)} ${snapshot.schedule.timeZone} - observed configuration`,
        `phase basis: habitual schedule estimate`,
        `estimated CBTmin: ${clockLabel(snapshot.estimatedCbtmin.startHour)} to ${clockLabel(snapshot.estimatedCbtmin.endHour)} - schedule-based estimate`,
        `derived phi: ${snapshot.phiInterval.startHour.toFixed(6)} to ${snapshot.phiInterval.endHour.toFixed(6)} h - mathematically derived`,
        `waveform minimum offset: ${snapshot.waveformMinimumOffsetHours.toFixed(12)} h after phi - mathematically derived`,
        `harmonics: ${snapshot.harmonics.map((value, index) => `a${index + 1} ${value}`).join(' / ')} - literature`,
        `period: ${snapshot.periodHours} h - literature`,
        `C estimate: ${signed(snapshot.processCEstimate, 6)}`,
        `C uncertainty range: ${signed(snapshot.processCMin, 6)} to ${signed(snapshot.processCMax, 6)}`,
        `entrainment: ${snapshot.entrainment.publicLabel}`,
        `free-running phase drift: ${snapshot.freeRunningPhaseDrift.publicLabel}`,
      ].join('\n');
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

  async loadSleepHomeostasisHistory(entry, range) {
    const note = entry.querySelector('.sleep-history-note');
    const path = entry.querySelector('.sleep-homeostasis-history path');
    if (!this.historyUrl) { note.textContent = 'History endpoint unavailable.'; return; }
    const request = {};
    this.sleepHistoryRequests.set(entry, request);
    note.textContent = 'Loading stored Process S history...';
    try {
      const response = await fetch(buildHistoryUrl(this.historyUrl, 'sleep', 'sleepPressure', range), { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'history unavailable');
      if (this.sleepHistoryRequests.get(entry) !== request) return;
      path.setAttribute('d', buildHistoryPath(data.points));
      note.textContent = data.points.length
        ? `${data.points.length} stored ${range} Process S readings. Gaps mean no runner data was recorded.`
        : `No Process S readings in the last ${range}; history begins when the grounded model becomes operational.`;
    } catch (error) {
      if (this.sleepHistoryRequests.get(entry) !== request) return;
      path.setAttribute('d', '');
      note.textContent = `History unavailable: ${error.message}`;
    }
  }

  async loadCircadianHistory(entry, range) {
    const note = entry.querySelector('.circadian-history-note');
    const line = entry.querySelector('.circadian-history-line');
    const band = entry.querySelector('.circadian-history-band');
    if (!this.historyUrl) { note.textContent = 'History endpoint unavailable.'; return; }
    const request = {};
    this.circadianHistoryRequests.set(entry, request);
    note.textContent = 'Reconstructing Process C from the stored schedule phase basis...';
    try {
      const response = await fetch(buildHistoryUrl(this.historyUrl, 'circadian', 'processC', range), { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'history unavailable');
      if (this.circadianHistoryRequests.get(entry) !== request) return;
      const paths = buildCircadianHistoryPaths(data.points, 280, 80, data.waveformRange);
      line.setAttribute('d', paths.estimate);
      band.setAttribute('d', paths.band);
      note.textContent = data.points.length
        ? `${data.points.length} ${range} waveform points mathematically reconstructed from the latest stored schedule phase basis; the band is phase uncertainty, not observed biology.`
        : 'No valid stored schedule phase basis is available.';
    } catch (error) {
      if (this.circadianHistoryRequests.get(entry) !== request) return;
      line.setAttribute('d', '');
      band.setAttribute('d', '');
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

  reset() { this.metrics = {}; this.latestBrain = {}; this.rows = {}; this.regions = {}; this.regionRows = {}; this.historyRequests = new WeakMap(); this.sleepHistoryRequests = new WeakMap(); this.circadianHistoryRequests = new WeakMap(); this._build(); }
}
