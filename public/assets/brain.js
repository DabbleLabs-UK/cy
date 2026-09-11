// brain.js - the public window onto Cy's canonical experienced Soma state.
// Values, contributor text and brain shading are supplied by the same runner
// snapshot. Implementation internals and legacy placeholders stay collapsed.

export const EXPERIENCED_METRICS = [
  { key: 'anxiety', label: 'ANXIETY' },
  { key: 'arousal', label: 'AROUSAL / STRESS' },
  { key: 'pain', label: 'PAIN / DISCOMFORT' },
  { key: 'satiety', label: 'PHYSIOLOGICAL SATIETY' },
  { key: 'sleepiness', label: 'PREDICTED SLEEPINESS' },
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

export function buildScaledHistoryPath(points, minimum = 0, maximum = 100, width = 280, height = 80) {
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
    const y = height - ((Math.max(minimum, Math.min(maximum, point.value)) - minimum) / (maximum - minimum)) * height;
    const command = index === 0 || point.ts - clean[index - 1].ts > breakAt ? 'M' : 'L';
    return `${command}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
}

export function buildHistoryPath(points, width = 280, height = 80) {
  return buildScaledHistoryPath(points, 0, 100, width, height);
}

export function buildHistoryUrl(base, scope, key, range) {
  const separator = String(base || '').includes('?') ? '&' : '?';
  return `${base}${separator}scope=${encodeURIComponent(scope)}&key=${encodeURIComponent(key)}&range=${encodeURIComponent(range)}`;
}

export function closeOtherReadings(readings, activeReading) {
  for (const reading of readings || []) {
    if (reading !== activeReading && reading.open) reading.open = false;
  }
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

function historyMarkup(axisLabel = null, ariaLabel = 'Stored state history') {
  return `<div class="soma-reading-history">
    <div class="soma-ranges" aria-label="History range">
      <button type="button" data-range="1h">1H</button><button type="button" data-range="24h" class="active">24H</button><button type="button" data-range="7d">7D</button>
    </div>
    ${axisLabel ? `<div class="soma-history-axis"><span>9</span><strong>${axisLabel}</strong><span>1</span></div>` : ''}
    <svg class="soma-history" viewBox="0 0 280 80" preserveAspectRatio="none" role="img" aria-label="${ariaLabel}"><path></path></svg>
    ${axisLabel ? '<p class="soma-history-display-note">Out-of-range markers are clipped to the 1-9 axis for display only; stored raw predictions are unchanged.</p>' : ''}
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

function satietyHistoryMarkup() {
  return `<div class="soma-reading-history satiety-history-wrap">
    <div class="soma-ranges" aria-label="Physiological satiety history range">
      <button type="button" data-range="1h">1H</button><button type="button" data-range="24h" class="active">24H</button><button type="button" data-range="7d">7D</button>
    </div>
    <div class="soma-history-axis"><span>10</span><strong>MODELLED PHYSIOLOGICAL SATIETY</strong><span>1</span></div>
    <svg class="soma-history satiety-history" viewBox="0 0 280 80" preserveAspectRatio="none" role="img" aria-label="Stored physiological satiety range">
      <path class="satiety-history-band"></path><path class="satiety-history-line"></path>
    </svg>
    <p class="soma-history-note">History begins only after the physiological model obtains a clean anchor.</p>
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

function predictedSleepinessMarkup(status, admin) {
  return `<section class="predicted-sleepiness-card status-${status.status.toLowerCase().replace('_', '-')}">
    <div class="predicted-sleepiness-head"><span>${status.displayName}</span><strong class="predicted-sleepiness-status">CALIBRATING</strong></div>
    <div class="predicted-sleepiness-reading"><strong class="predicted-sleepiness-value">--</strong><span>PREDICTED KSS (1-9)</span></div>
    <p class="predicted-sleepiness-anchor">Waiting for observed sleep history.</p>
    <p class="predicted-sleepiness-calibration">Two complete observed sleep episodes are required.</p>
    <dl class="predicted-sleepiness-facts"><div><dt>MODEL</dt><dd>Three-Process Model of Alertness - Ingre et al. 2014</dd></div><div><dt>PHASE</dt><dd>POPULATION DEFAULT</dd></div><div><dt>SLEEP HISTORY</dt><dd>OBSERVED</dd></div></dl>
    <p class="predicted-sleepiness-separation">The headline KSS prediction uses independently validated TPM equations. The Process S/C displays below are not numerically substituted into it.</p>
    <p class="predicted-sleepiness-caveat">Population-model estimate; individual sleepiness can differ substantially. General fatigue is not modelled. Sleep inertia is not adequately modelled, so the first hour after waking has additional known bias.</p>
    ${admin ? '<details class="predicted-sleepiness-inspector"><summary>TPM CALCULATION INSPECTION</summary><pre>Waiting for a live TPM calculation.</pre></details>' : ''}
  </section>`;
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

function defensiveContextMarkup(status, objectiveStatus, imminenceStatus, perceivedStatus, learnedControlStatus, rememberedStatus, admin) {
  return `<section class="defensive-context-card status-${status.status.toLowerCase().replace('_', '-')}">
    <div class="defensive-context-head"><span>${status.displayName}</span><strong class="defensive-context-status">${status.publicLabel}</strong></div>
    <p class="defensive-context-explanation">Shows present external cues, their separately learned possible outcomes, world ambiguity, categorical imminence, actual control and resolution. Learned uncertainty remains the separate posterior variance shown in owner inspection. It is not an anxiety or threat score.</p>
    <div class="defensive-contexts"><p class="defensive-context-empty">No current structured defensive context is active.</p></div>
    <div class="defensive-context-limits"><span>${objectiveStatus.displayName}</span><strong>${objectiveStatus.publicLabel}</strong><span>${imminenceStatus.displayName}</span><strong>${imminenceStatus.publicLabel}</strong><span>${perceivedStatus.displayName}</span><strong>${perceivedStatus.publicLabel}</strong><span>${learnedControlStatus.displayName}</span><strong>${learnedControlStatus.publicLabel}</strong><span>${rememberedStatus.displayName}</span><strong>${rememberedStatus.publicLabel}</strong></div>
    ${admin ? '<details class="defensive-context-inspector"><summary>CURRENT DEFENSIVE CONTEXT INSPECTION</summary><pre>Waiting for exact context state and transition history.</pre></details>' : ''}
  </section>`;
}

function controllabilityMarkup(status, causalStatus, perceivedStatus, comparisonStatus, actionStatus, admin) {
  return `<section class="controllability-card status-${status.status.toLowerCase().replace('_', '-')}">
    <div class="controllability-head"><span>${status.displayName}</span><strong class="controllability-status">${status.publicLabel}</strong></div>
    <p class="controllability-explanation">Compares adverse-outcome evidence after a genuinely available action was executed versus deliberately not executed in the same structured context. It is observational evidence, not a control percentage or causal proof.</p>
    <div class="controllability-evidence"><p class="controllability-empty">No resolved comparable action opportunities have been observed yet.</p></div>
    <div class="controllability-limits"><span>${causalStatus.displayName}</span><strong>${causalStatus.publicLabel}</strong><span>${perceivedStatus.displayName}</span><strong>${perceivedStatus.publicLabel}</strong><span>${comparisonStatus.displayName}</span><strong>${comparisonStatus.publicLabel}</strong><span>${actionStatus.displayName}</span><strong>${actionStatus.publicLabel}</strong></div>
    ${admin ? '<details class="controllability-inspector"><summary>ACTION-OUTCOME CONTINGENCY INSPECTION</summary><pre>Waiting for the complete opportunity and posterior history.</pre></details>' : ''}
  </section>`;
}

function feedingMarkup(feedingStatus, energyStatus, gutStatus, hedonicStatus, anticipationStatus, actionStatus, admin) {
  return `<section class="feeding-input-card status-${feedingStatus.status.toLowerCase().replace('_', '-')}">
    <div class="feeding-input-head"><span>${gutStatus.displayName}</span><strong class="feeding-input-status">CALIBRATING</strong></div>
    <div class="satiety-model-reading"><strong data-satiety="score">--</strong><span>PUBLISHED MODEL RANGE / 10</span></div>
    <p class="feeding-input-explanation">MODEL ESTIMATE - NOT A REPORTED FEELING. A deterministic range from the published GI and gut-hormone model. Higher means greater modelled physiological satiety.</p>
    <dl class="feeding-input-facts">
      <div><dt>GASTRIC CONTENTS</dt><dd data-satiety="gastric">UNKNOWN</dd></div>
      <div><dt>CCK</dt><dd data-satiety="cck">UNKNOWN</dd></div>
      <div><dt>GLP-1</dt><dd data-satiety="glp1">UNKNOWN</dd></div>
      <div><dt>PYY</dt><dd data-satiety="pyy">UNKNOWN</dd></div>
      <div><dt>GHRELIN</dt><dd data-satiety="ghrelin">UNKNOWN</dd></div>
      <div><dt>LATEST KNOWN INTAKE</dt><dd data-satiety="intake">UNKNOWN</dd></div>
      <div><dt>NUTRITION BASIS</dt><dd data-satiety="nutrition">UNKNOWN</dd></div>
    </dl>
    ${satietyHistoryMarkup()}
    <details class="soma-substrate-more"><summary>MODEL, LIMITATIONS AND FEEDING HISTORY</summary>
      <p class="satiety-uncertainty">Waiting for a clean breakfast anchor.</p>
      <div class="feeding-timeline"><p class="feeding-timeline-empty">No structured feeding records have reached this view.</p></div>
      <div class="feeding-model-limits"><span>${feedingStatus.displayName}</span><strong>${feedingStatus.publicLabel}</strong><span>SUBJECTIVE HUNGER</span><strong>NOT MODELLED</strong><span>${energyStatus.displayName}</span><strong>${energyStatus.publicLabel}</strong><span>${hedonicStatus.displayName}</span><strong>${hedonicStatus.publicLabel}</strong><span>${anticipationStatus.displayName}</span><strong>${anticipationStatus.publicLabel}</strong><span>${actionStatus.displayName}</span><strong>${actionStatus.publicLabel}</strong><span>HYPOTHALAMIC NEURAL ACTIVITY</span><strong>NOT MODELLED</strong></div>
    </details>
    ${admin ? '<details class="feeding-input-inspector"><summary>PHYSIOLOGICAL SATIETY CALCULATION</summary><pre>Waiting for the current calculation and complete feeding ledger.</pre></details>' : ''}
  </section>`;
}

function somaticMarkup(somaticStatus, painStatus, healingStatus, predictiveStatus, peripheralStatus, centralStatus, actionStatus, admin) {
  return `<section class="somatic-input-card status-${somaticStatus.status.toLowerCase().replace('_', '-')}">
    <div class="somatic-input-head"><span>${somaticStatus.displayName}</span><strong class="somatic-input-status">${somaticStatus.publicLabel}</strong></div>
    <p class="somatic-input-explanation">Structured bodily harm and noxious-input facts. This is a computational functional analogue only: Cy has no biological nociceptors, and this does not calculate subjective Pain.</p>
    <dl class="somatic-input-facts">
      <div><dt>ACTIVE NOXIOUS STIMULI</dt><dd data-somatic="stimuli">0</dd></div>
      <div><dt>ACTIVE INJURIES</dt><dd data-somatic="injuries">0</dd></div>
      <div><dt>BODY SITES</dt><dd data-somatic="sites">UNKNOWN</dd></div>
      <div><dt>MODALITIES</dt><dd data-somatic="modalities">UNKNOWN</dd></div>
      <div><dt>TISSUE DAMAGE</dt><dd data-somatic="damage">UNKNOWN</dd></div>
      <div><dt>KNOWLEDGE</dt><dd data-somatic="knowledge">NO SOMATIC RECORD</dd></div>
    </dl>
    <details class="soma-substrate-more"><summary>EVENT HISTORY AND MODEL LIMITS</summary>
      <div class="somatic-timeline"><p class="somatic-timeline-empty">No structured somatic records have reached this view.</p></div>
      <div class="somatic-model-limits"><span>${painStatus.displayName}</span><strong>${painStatus.publicLabel}</strong><span>${healingStatus.displayName}</span><strong>${healingStatus.publicLabel}</strong><span>${predictiveStatus.displayName}</span><strong>${predictiveStatus.publicLabel}</strong><span>${peripheralStatus.displayName}</span><strong>${peripheralStatus.publicLabel}</strong><span>${centralStatus.displayName}</span><strong>${centralStatus.publicLabel}</strong><span>${actionStatus.displayName}</span><strong>${actionStatus.publicLabel}</strong><span>BRAIN ACTIVATION</span><strong>NOT MODELLED</strong></div>
    </details>
    ${admin ? '<details class="somatic-input-inspector"><summary>SOMATIC / NOXIOUS INPUT TRACE</summary><pre>Waiting for the complete somatic ledger.</pre></details>' : ''}
  </section>`;
}

function socialContactMarkup(status, setPointStatus, errorStatus, adaptationStatus, toleranceStatus, aversiveStatus, admin) {
  return `<section class="social-contact-card status-${status.status.toLowerCase().replace('_', '-')}">
    <div class="social-contact-head"><span>${status.displayName}</span><strong class="social-contact-status">${status.publicLabel}</strong></div>
    <p class="social-contact-explanation">Factual contact and opportunity history. Contact form, reciprocity and structured character stay separate; none is converted into Loneliness.</p>
    <dl class="social-contact-facts">
      <div><dt>CURRENT SITUATION</dt><dd data-social="current">UNKNOWN</dd></div>
      <div><dt>LAST RECIPROCAL CONTACT</dt><dd data-social="reciprocal">NONE OBSERVED</dd></div>
      <div><dt>LAST SUPPORTIVE CONTACT</dt><dd data-social="supportive">NONE OBSERVED</dd></div>
      <div><dt>LATEST SOCIAL EPISODE</dt><dd data-social="latest">NONE OBSERVED</dd></div>
      <div><dt>RECENT REJECTION</dt><dd data-social="rejection">NONE OBSERVED</dd></div>
      <div><dt>OBSERVATION RECORD</dt><dd data-social="continuity">UNKNOWN</dd></div>
    </dl>
    <details class="soma-substrate-more"><summary>CONTACT HISTORY AND MODEL LIMITS</summary>
      <div class="social-ranges" aria-label="Factual social history range">
        <button type="button" data-range="1h">1H</button><button type="button" data-range="24h" class="active">24H</button><button type="button" data-range="7d">7D</button>
      </div>
      <div class="social-contact-timeline"><p class="social-contact-empty">No structured social episodes have reached this view.</p></div>
      <div class="social-contact-limits"><span>${setPointStatus.displayName}</span><strong>${setPointStatus.publicLabel}</strong><span>${errorStatus.displayName}</span><strong>${errorStatus.publicLabel}</strong><span>${adaptationStatus.displayName}</span><strong>${adaptationStatus.publicLabel}</strong><span>${toleranceStatus.displayName}</span><strong>${toleranceStatus.publicLabel}</strong><span>${aversiveStatus.displayName}</span><strong>${aversiveStatus.publicLabel}</strong><span>SUBJECTIVE LONELINESS</span><strong>PROVISIONAL</strong></div>
    </details>
    ${admin ? '<details class="social-contact-inspector"><summary>SOCIAL CONTACT LEDGER INSPECTION</summary><pre>Open to load exact structured provenance.</pre></details>' : ''}
  </section>`;
}

export function elapsedFeedingLabel(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return 'UNKNOWN';
  const totalMinutes = Math.floor(milliseconds / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  return [days ? `${days}d` : '', hours || days ? `${hours}h` : '', `${minutes}m`].filter(Boolean).join(' ');
}

function feedingTimestampLabel(value) {
  const parsed = Date.parse(String(value || ''));
  if (!Number.isFinite(parsed)) return 'UNKNOWN';
  return new Date(parsed).toLocaleString();
}

function decimal3(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(3) : 'UNKNOWN';
}

function displayIdentifier(value) {
  return String(value || 'unknown').replace(/^action:/, '').replaceAll(/[:_]/g, ' ').toUpperCase();
}

function contingencyEvidenceText(value) {
  if (value === 'ADVERSE_OUTCOME_LOWER_WITH_ACTION') {
    return 'Observed adverse-outcome probability has been lower after this action.';
  }
  if (value === 'ADVERSE_OUTCOME_HIGHER_WITH_ACTION') {
    return 'Observed adverse-outcome probability has been higher after this action.';
  }
  if (value === 'POSTERIOR_MEANS_EQUAL') {
    return 'The current action and no-action posterior means are equal.';
  }
  return 'Both action and no-action observations are needed before comparing them.';
}

export class BrainHud {
  constructor(root, { historyUrl = '', threatLearningUrl = '', defensiveContextUrl = '', learnedControllabilityUrl = '', feedingUrl = '', somaticUrl = '', socialContactUrl = '', registry = null, admin = false } = {}) {
    this.root = root;
    this.historyUrl = historyUrl;
    this.threatLearningUrl = threatLearningUrl;
    this.defensiveContextUrl = defensiveContextUrl;
    this.learnedControllabilityUrl = learnedControllabilityUrl;
    this.feedingUrl = feedingUrl;
    this.somaticUrl = somaticUrl;
    this.socialContactUrl = socialContactUrl;
    this.registry = registry || {};
    this.admin = admin;
    this.sleepHomeostasisStatus = implementationStatus(this.registry, 'soma_subsystems', 'sleep_homeostasis');
    this.predictedSleepinessStatus = implementationStatus(this.registry, 'soma_subsystems', 'predicted_sleepiness_tpm');
    this.circadianStatus = implementationStatus(this.registry, 'soma_subsystems', 'circadian_process_c');
    this.threatLearningStatus = implementationStatus(this.registry, 'soma_subsystems', 'probabilistic_threat_learning');
    this.threatVolatilityStatus = implementationStatus(this.registry, 'soma_subsystems', 'threat_volatility');
    this.threatGeneralisationStatus = implementationStatus(this.registry, 'soma_subsystems', 'threat_generalisation');
    this.threatContextualStatus = implementationStatus(this.registry, 'soma_subsystems', 'threat_contextual_inference');
    this.defensiveContextStatus = implementationStatus(this.registry, 'soma_subsystems', 'current_defensive_context');
    this.objectiveControllabilityStatus = implementationStatus(this.registry, 'soma_subsystems', 'objective_controllability');
    this.threatImminenceStatus = implementationStatus(this.registry, 'soma_subsystems', 'threat_imminence_representation');
    this.perceivedControllabilityStatus = implementationStatus(this.registry, 'soma_subsystems', 'perceived_controllability');
    this.learnedControllabilityStatus = implementationStatus(this.registry, 'soma_subsystems', 'learned_controllability');
    this.causalControllabilityStatus = implementationStatus(this.registry, 'soma_subsystems', 'causal_controllability');
    this.controllabilityComparisonStatus = implementationStatus(this.registry, 'soma_subsystems', 'bayesian_controllability_model_comparison');
    this.controlActionSelectionStatus = implementationStatus(this.registry, 'soma_subsystems', 'action_selection_from_control');
    this.rememberedThreatCueStatus = implementationStatus(this.registry, 'soma_subsystems', 'remembered_imagined_threat_cues');
    this.feedingStatus = implementationStatus(this.registry, 'soma_subsystems', 'ingestion_ledger');
    this.energyHomeostasisStatus = implementationStatus(this.registry, 'soma_subsystems', 'energy_homeostatic_state');
    this.gutSatietyStatus = implementationStatus(this.registry, 'soma_subsystems', 'gut_satiety');
    this.hedonicAppetiteStatus = implementationStatus(this.registry, 'soma_subsystems', 'hedonic_appetite');
    this.mealAnticipationStatus = implementationStatus(this.registry, 'soma_subsystems', 'learned_meal_anticipation');
    this.feedingActionStatus = implementationStatus(this.registry, 'soma_subsystems', 'feeding_action_selection');
    this.somaticStatus = implementationStatus(this.registry, 'soma_subsystems', 'computational_nociceptive_input_analogue');
    this.subjectivePainStatus = implementationStatus(this.registry, 'soma_subsystems', 'subjective_pain');
    this.healingStatus = implementationStatus(this.registry, 'soma_subsystems', 'injury_healing_dynamics');
    this.predictivePainStatus = implementationStatus(this.registry, 'soma_subsystems', 'predictive_pain_inference');
    this.peripheralSensitisationStatus = implementationStatus(this.registry, 'soma_subsystems', 'peripheral_sensitisation');
    this.centralSensitisationStatus = implementationStatus(this.registry, 'soma_subsystems', 'central_sensitisation');
    this.nocifensiveActionStatus = implementationStatus(this.registry, 'soma_subsystems', 'nocifensive_action_model');
    this.socialContactStatus = implementationStatus(this.registry, 'soma_subsystems', 'social_contact_ledger');
    this.socialSetPointStatus = implementationStatus(this.registry, 'soma_subsystems', 'social_set_point');
    this.socialErrorStatus = implementationStatus(this.registry, 'soma_subsystems', 'social_homeostatic_error');
    this.socialAdaptationStatus = implementationStatus(this.registry, 'soma_subsystems', 'social_set_point_adaptation');
    this.socialToleranceStatus = implementationStatus(this.registry, 'soma_subsystems', 'social_tolerance_dynamic_range');
    this.socialAversiveStatus = implementationStatus(this.registry, 'soma_subsystems', 'social_aversive_value');
    const regionGeometry = new Map(BRAIN_REGIONS.map((region) => [region.key, region]));
    this.metricDefinitions = EXPERIENCED_METRICS.map((definition) => ({
      ...definition,
      status: implementationStatus(this.registry, 'soma_variables', definition.key),
    }));
    const registeredRegions = Array.isArray(this.registry.brain_regions) && this.registry.brain_regions.length
      ? this.registry.brain_regions.filter((entry) => entry.ui_exposed !== false)
      : BRAIN_REGIONS.map((region) => ({ id: region.key, display_name: region.label }));
    this.regionDefinitions = registeredRegions.map((registered) => ({
      ...(regionGeometry.get(registered.id) || {}),
      key: registered.id,
      label: registered.display_name || (regionGeometry.get(registered.id) || {}).label || registered.id,
      status: implementationStatus(this.registry, 'brain_regions', registered.id),
    }));
    this.metrics = {};
    this.predictedSleepiness = null;
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
      if (definition.key === 'sleepiness') entry.classList.add('soma-sleepiness-entry');
      entry.dataset.metric = definition.key;
      const sleepHomeostasis = definition.key === 'sleepiness'
        ? `${predictedSleepinessMarkup(this.predictedSleepinessStatus, this.admin)}${sleepHomeostasisMarkup(this.sleepHomeostasisStatus, this.circadianStatus, this.admin)}`
        : '';
      const threatLearning = definition.key === 'anxiety'
        ? threatLearningMarkup(this.threatLearningStatus, this.threatVolatilityStatus, this.threatGeneralisationStatus, this.threatContextualStatus, this.admin)
        : '';
      const defensiveContext = definition.key === 'anxiety'
        ? defensiveContextMarkup(
          this.defensiveContextStatus,
          this.objectiveControllabilityStatus,
          this.threatImminenceStatus,
          this.perceivedControllabilityStatus,
          this.learnedControllabilityStatus,
          this.rememberedThreatCueStatus,
          this.admin,
        )
        : '';
      const learnedControllability = definition.key === 'anxiety'
        ? controllabilityMarkup(
          this.learnedControllabilityStatus,
          this.causalControllabilityStatus,
          this.perceivedControllabilityStatus,
          this.controllabilityComparisonStatus,
          this.controlActionSelectionStatus,
          this.admin,
        )
        : '';
      const anxietyGrounding = definition.key === 'anxiety'
        ? `<details class="soma-substrate-more"><summary>THREAT AND CONTROL DETAILS</summary>${threatLearning}${defensiveContext}${learnedControllability}</details>`
        : '';
      const feeding = definition.key === 'satiety'
        ? feedingMarkup(
          this.feedingStatus,
          this.energyHomeostasisStatus,
          this.gutSatietyStatus,
          this.hedonicAppetiteStatus,
          this.mealAnticipationStatus,
          this.feedingActionStatus,
          this.admin,
        )
        : '';
      const somatic = definition.key === 'pain'
        ? somaticMarkup(
          this.somaticStatus,
          this.subjectivePainStatus,
          this.healingStatus,
          this.predictivePainStatus,
          this.peripheralSensitisationStatus,
          this.centralSensitisationStatus,
          this.nocifensiveActionStatus,
          this.admin,
        )
        : '';
      const socialContact = definition.key === 'loneliness'
        ? socialContactMarkup(
          this.socialContactStatus,
          this.socialSetPointStatus,
          this.socialErrorStatus,
          this.socialAdaptationStatus,
          this.socialToleranceStatus,
          this.socialAversiveStatus,
          this.admin,
        )
        : '';
      const numericHistory = ['pain', 'loneliness', 'satiety'].includes(definition.key) ? ''
        : definition.key === 'sleepiness'
          ? historyMarkup('KSS PREDICTED SLEEPINESS', 'Stored predicted KSS sleepiness history on the 1 to 9 scale')
          : historyMarkup();
      entry.innerHTML = `<summary class="soma-state-row"><span class="soma-state-label">${definition.status.displayName}</span><span class="soma-state-status">${definition.status.publicLabel}</span><span class="soma-state-trend">--</span><strong class="soma-state-value">--</strong><span class="soma-state-bar"><i></i></span></summary>
        <div class="soma-reading-detail"><p class="soma-reading-description">${definition.status.note}</p><p class="soma-influences-title">RECENT INFLUENCES - PROVISIONAL</p><ul class="soma-contributors"></ul>${numericHistory}${somatic}${anxietyGrounding}${feeding}${sleepHomeostasis}${socialContact}</div>`;
      this._wireReading(entry, definition.key === 'sleepiness' ? 'sleepiness'
        : definition.key === 'satiety' ? 'satiety' : 'metric', definition.key);
      if (definition.key === 'sleepiness') this._wireSleepHomeostasis(entry);
      if (definition.key === 'sleepiness') this._wireCircadian(entry);
      if (definition.key === 'anxiety') this._wireThreatLearning(entry);
      if (definition.key === 'anxiety') this._wireDefensiveContext(entry);
      if (definition.key === 'anxiety') this._wireControllability(entry);
      if (definition.key === 'satiety') this._wireFeeding(entry);
      if (definition.key === 'pain') this._wireSomatic(entry);
      if (definition.key === 'loneliness') this._wireSocialContact(entry);
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
      closeOtherReadings(
        this.root.querySelectorAll('details.soma-state-entry, details.soma-region-entry'),
        entry,
      );
      const registryScope = ['metric', 'sleepiness', 'satiety'].includes(scope) ? 'soma_variables' : 'brain_regions';
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
      closeOtherReadings(
        this.root.querySelectorAll('details.soma-state-entry, details.soma-region-entry'),
        entry,
      );
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

  _wireDefensiveContext(entry) {
    const inspector = entry.querySelector('.defensive-context-inspector');
    if (!inspector) return;
    inspector.addEventListener('toggle', async () => {
      if (!inspector.open || !this.defensiveContextUrl) return;
      const target = inspector.querySelector('pre');
      target.textContent = 'Loading exact context state and transition history...';
      try {
        const response = await fetch(this.defensiveContextUrl, { cache: 'no-store' });
        if (!response.ok) throw new Error(`defensive context ${response.status}`);
        const data = await response.json();
        target.textContent = JSON.stringify(data.inspection || data, null, 2);
      } catch (error) {
        target.textContent = error && error.message ? error.message : 'Current defensive-context inspection unavailable.';
      }
    });
  }

  _wireControllability(entry) {
    const inspector = entry.querySelector('.controllability-inspector');
    if (!inspector) return;
    inspector.addEventListener('toggle', async () => {
      if (!inspector.open || !this.learnedControllabilityUrl) return;
      const target = inspector.querySelector('pre');
      target.textContent = 'Loading exact action opportunities, posteriors and update history...';
      try {
        const response = await fetch(this.learnedControllabilityUrl, { cache: 'no-store' });
        if (!response.ok) throw new Error(`action-outcome contingency ${response.status}`);
        const data = await response.json();
        target.textContent = JSON.stringify(data.inspection || data, null, 2);
      } catch (error) {
        target.textContent = error && error.message ? error.message : 'Action-outcome contingency inspection unavailable.';
      }
    });
  }

  _wireFeeding(entry) {
    const inspector = entry.querySelector('.feeding-input-inspector');
    if (!inspector) return;
    inspector.addEventListener('toggle', async () => {
      if (!inspector.open || !this.feedingUrl) return;
      const target = inspector.querySelector('pre');
      target.textContent = 'Loading the complete feeding ledger and continuity record...';
      try {
        const response = await fetch(this.feedingUrl, { cache: 'no-store' });
        if (!response.ok) throw new Error(`feeding inputs ${response.status}`);
        const data = await response.json();
        target.textContent = JSON.stringify(data.inspection || data, null, 2);
      } catch (error) {
        target.textContent = error && error.message ? error.message : 'Feeding-input inspection unavailable.';
      }
    });
  }

  _wireSomatic(entry) {
    const inspector = entry.querySelector('.somatic-input-inspector');
    if (!inspector) return;
    inspector.addEventListener('toggle', async () => {
      if (!inspector.open || !this.somaticUrl) return;
      const target = inspector.querySelector('pre');
      target.textContent = 'Loading the complete somatic event and injury trace...';
      try {
        const response = await fetch(this.somaticUrl, { cache: 'no-store' });
        if (!response.ok) throw new Error(`somatic inputs ${response.status}`);
        const data = await response.json();
        target.textContent = JSON.stringify(data.inspection || data, null, 2);
      } catch (error) {
        target.textContent = error && error.message ? error.message : 'Somatic-input inspection unavailable.';
      }
    });
  }

  _wireSocialContact(entry) {
    const load = (range, exact = false) => this.loadSocialContact(entry, range, exact);
    entry.addEventListener('toggle', () => {
      if (!entry.open) return;
      const active = entry.querySelector('.social-ranges button.active');
      load(active ? active.dataset.range : '24h');
    });
    entry.querySelectorAll('.social-ranges button').forEach((button) => button.addEventListener('click', () => {
      entry.querySelectorAll('.social-ranges button').forEach((item) => item.classList.toggle('active', item === button));
      load(button.dataset.range);
    }));
    const inspector = entry.querySelector('.social-contact-inspector');
    if (inspector) inspector.addEventListener('toggle', () => {
      if (inspector.open) load('all', true);
    });
  }

  setSoma(soma) {
    if (!soma || !soma.experienced || !soma.experienced.metrics) return;
    this.sleepHomeostasis = soma.sleepHomeostasis || null;
    this.circadianProcessC = soma.circadianProcessC || null;
    this.predictedSleepiness = soma.predictedSleepiness || null;
    this.threatLearning = soma.threatLearning || null;
    this.currentDefensiveContext = soma.currentDefensiveContext || null;
    this.learnedControllability = soma.learnedControllability || null;
    this.feeding = soma.feeding || null;
    this.physiologicalSatiety = soma.physiologicalSatiety || null;
    this.somaticNociceptive = soma.somaticNociceptive || null;
    this.socialContact = soma.social || null;
    this.metrics = soma.experienced.metrics;
    this.latestBrain = soma.experienced.brain || {};
    for (const definition of this.metricDefinitions) {
      const metric = this.metrics[definition.key];
      const row = this.rows[definition.key];
      if (!row) continue;
      if (definition.key === 'satiety') {
        const current = this.physiologicalSatiety && this.physiologicalSatiety.current;
        const live = this.physiologicalSatiety && this.physiologicalSatiety.status === 'LIVE'
          && current && Number.isFinite(current.minimum) && Number.isFinite(current.maximum);
        row.querySelector('.soma-state-value').textContent = live
          ? `${current.minimum.toFixed(1)}-${current.maximum.toFixed(1)} / 10` : '--';
        row.querySelector('.soma-state-status').textContent = live
          ? 'LIVE' : String(this.physiologicalSatiety && this.physiologicalSatiety.status || 'CALIBRATING').replaceAll('_', ' ');
        row.querySelector('.soma-state-trend').textContent = live ? 'physiological model' : 'awaiting valid input';
        const left = live ? Math.max(0, Math.min(100, current.minimum * 10)) : 0;
        const right = live ? Math.max(left, Math.min(100, current.maximum * 10)) : 0;
        row.querySelector('.soma-state-bar i').style.left = `${left}%`;
        row.querySelector('.soma-state-bar i').style.width = live ? `${Math.max(3, right - left)}%` : '0';
        row.querySelector('.soma-state-bar i').style.backgroundColor = activityColor(live ? ((current.minimum + current.maximum) / 20) : 0);
        row.querySelector('summary').title = `${definition.status.displayName}. ${live ? 'LIVE' : 'CALIBRATING'}. Higher means greater modelled physiological satiety. Subjective hunger is not modelled.`;
        continue;
      }
      if (definition.key === 'sleepiness') {
        const snapshot = this.predictedSleepiness;
        const live = snapshot && snapshot.publicLabel === 'LIVE' && Number.isFinite(snapshot.predictedKss);
        const outside = live && snapshot.outsideNominalKssRange;
        const value = live ? snapshot.predictedKss : null;
        row.querySelector('.soma-state-value').textContent = value == null ? '--' : `${value.toFixed(1)} / 9`;
        row.querySelector('.soma-state-status').textContent = live ? 'LIVE' : 'CALIBRATING';
        row.querySelector('.soma-state-trend').textContent = outside ? 'outside nominal range'
          : live ? 'TPM population model' : 'sleep history';
        const displayPosition = value == null ? 0 : Math.max(0, Math.min(100, ((value - 1) / 8) * 100));
        row.querySelector('.soma-state-bar i').style.left = `${displayPosition}%`;
        row.querySelector('.soma-state-bar i').style.width = live ? '3px' : '0';
        row.querySelector('.soma-state-bar i').style.backgroundColor = activityColor(displayPosition / 100);
        row.querySelector('summary').title = `${definition.status.displayName}. ${live ? 'LIVE' : 'CALIBRATING'}${outside ? ' - raw prediction outside nominal KSS range' : ''}. ${definition.status.note}`;
        continue;
      }
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
    this.renderSomatic();
    this.renderPredictedSleepiness();
    this.renderSleepHomeostasis();
    this.renderCircadianProcessC();
    this.renderThreatLearning();
    this.renderCurrentDefensiveContext();
    this.renderControllability();
    this.renderFeeding();
    this.renderSocialContact();
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

  renderPredictedSleepiness() {
    const entry = this.rows.sleepiness;
    if (!entry) return;
    const snapshot = this.predictedSleepiness;
    const card = entry.querySelector('.predicted-sleepiness-card');
    if (!card) return;
    const live = snapshot && snapshot.publicLabel === 'LIVE' && Number.isFinite(snapshot.predictedKss);
    entry.querySelector('.soma-reading-description').textContent = live
      ? `LIVE. Predicted KSS ${snapshot.predictedKss.toFixed(2)} from the published S_B + C + U Three-Process Model.`
      : 'CALIBRATING. A live KSS estimate requires two complete observed sleep episodes.';
    entry.querySelector('.soma-influences-title').hidden = true;
    entry.querySelector('.soma-contributors').textContent = '';
    card.querySelector('.predicted-sleepiness-status').textContent = live
      ? snapshot.outsideNominalKssRange ? 'LIVE - OUTSIDE NOMINAL RANGE' : 'LIVE'
      : 'CALIBRATING';
    card.querySelector('.predicted-sleepiness-value').textContent = live ? `${snapshot.predictedKss.toFixed(2)} / 9` : '--';
    card.querySelector('.predicted-sleepiness-anchor').textContent = live && snapshot.kssRegion
      ? `Descriptive region: ${snapshot.kssRegion.description}.`
      : 'Waiting for enough structured observed sleep history.';
    card.querySelector('.predicted-sleepiness-calibration').textContent = snapshot
      ? `${snapshot.completeObservedSleepEpisodes} of ${snapshot.requiredCompleteObservedSleepEpisodes} complete observed sleep episodes; current state ${String(snapshot.currentObservedSleepState || 'unknown').toUpperCase()}.`
      : 'No TPM state has reached this view.';
    const inspector = card.querySelector('.predicted-sleepiness-inspector pre');
    if (inspector) inspector.textContent = snapshot ? [
      `model: ${snapshot.modelId}`,
      `runtime status: ${snapshot.publicLabel}`,
      `phase basis: ${snapshot.phaseBasis}`,
      `observed complete sleeps: ${snapshot.completeObservedSleepEpisodes}`,
      `continuity known: ${snapshot.continuityKnown}`,
      `TPM_S_B: ${snapshot.components && Number.isFinite(snapshot.components.tpmSB) ? snapshot.components.tpmSB.toFixed(6) : '--'}`,
      `TPM_C: ${snapshot.components && Number.isFinite(snapshot.components.tpmC) ? snapshot.components.tpmC.toFixed(6) : '--'}`,
      `TPM_U: ${snapshot.components && Number.isFinite(snapshot.components.tpmU) ? snapshot.components.tpmU.toFixed(6) : '--'}`,
      `alertness S_B + C + U: ${snapshot.components && Number.isFinite(snapshot.components.alertness) ? snapshot.components.alertness.toFixed(6) : '--'}`,
      `raw predicted KSS: ${Number.isFinite(snapshot.rawPredictedKss) ? snapshot.rawPredictedKss.toFixed(6) : '--'}`,
      `outside nominal KSS range: ${snapshot.outsideNominalKssRange}`,
      `transfer: KSS = 9.68 - 0.46 * alertness`,
      `time awake: ${snapshot.components && Number.isFinite(snapshot.components.timeAwakeMs) ? elapsedFeedingLabel(snapshot.components.timeAwakeMs) : '--'}`,
      `first hour after waking: ${snapshot.components ? snapshot.components.firstHourAfterWaking : '--'}`,
      `circadian phase p: 16.8 h - POPULATION DEFAULT`,
      `residual SD: ${snapshot.residualSdKss} KSS`,
      `between-subject intercept SD: ${snapshot.betweenSubjectInterceptSdKss} KSS`,
      `Process W: NOT USED`,
      `general fatigue: NOT MODELLED`,
      `sleep inertia: NOT MODELLED`,
      `brain activation: NOT MODELLED`,
    ].join('\n') : 'No TPM state has reached this view.';
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

  renderCurrentDefensiveContext() {
    const entry = this.rows.anxiety;
    const card = entry && entry.querySelector('.defensive-context-card');
    if (!card) return;
    const snapshot = this.currentDefensiveContext;
    const live = this.defensiveContextStatus.status === IMPLEMENTATION_STATUS.IMPLEMENTED
      && snapshot && snapshot.status === 'implemented';
    card.querySelector('.defensive-context-status').textContent = live
      ? this.defensiveContextStatus.publicLabel : 'UNAVAILABLE';
    const root = card.querySelector('.defensive-contexts');
    root.textContent = '';
    if (!live || !Array.isArray(snapshot.activeContexts) || !snapshot.activeContexts.length) {
      const empty = document.createElement('p');
      empty.className = 'defensive-context-empty';
      empty.textContent = live
        ? 'No current structured defensive context is active.'
        : 'No grounded current defensive-context state has reached this view.';
      root.appendChild(empty);
      return;
    }
    for (const context of snapshot.activeContexts) {
      const item = document.createElement('article');
      item.className = 'defensive-context-item';
      const cue = Array.isArray(context.activeCues) && context.activeCues.length
        ? context.activeCues[0].cueId : 'external cue';
      const heading = document.createElement('strong');
      heading.textContent = `${String(cue).replace(':', ' ')} PRESENT`;
      const outcome = document.createElement('p');
      outcome.className = 'defensive-context-outcome';
      outcome.textContent = `Possible learned outcome: ${String(context.outcomeClass || 'unknown').replaceAll('_', ' ')}`;
      const evidence = document.createElement('ul');
      for (const association of Array.isArray(context.learnedEvidence) ? context.learnedEvidence : []) {
        const row = document.createElement('li');
        const description = association.evidence === 'ADVERSE_MORE_OFTEN'
          ? 'adverse outcome observed more often than safe non-occurrence'
          : association.evidence === 'SAFE_MORE_OFTEN'
            ? 'safe non-occurrence observed more often than the adverse outcome'
            : association.evidence === 'EVENLY_SPLIT'
              ? 'resolved observations evenly split'
              : 'no resolved observations yet';
        row.textContent = `${String(association.cueId).replace(':', ' ')}: ${description}`;
        evidence.appendChild(row);
      }
      const facts = document.createElement('dl');
      for (const [label, value] of [
        ['IMMINENCE', context.temporalStatus],
        ['ACTUAL CONTROL', context.objectiveControllability],
        ['WORLD AMBIGUITY', context.worldAmbiguity],
        ['OUTCOME', context.outcomeStatus],
        ['RESOLUTION', context.resolutionStatus],
      ]) {
        const wrapper = document.createElement('div');
        const term = document.createElement('dt');
        const detail = document.createElement('dd');
        term.textContent = label;
        detail.textContent = String(value || 'UNKNOWN').replaceAll('_', ' ');
        wrapper.append(term, detail);
        facts.appendChild(wrapper);
      }
      item.append(heading, outcome, evidence, facts);
      const actionEvidence = Array.isArray(context.learnedActionOutcomeContingency)
        ? context.learnedActionOutcomeContingency : [];
      for (const learned of actionEvidence) {
        const association = document.createElement('p');
        association.className = 'defensive-context-action-evidence';
        association.textContent = `${String(learned.actionId || 'action').replaceAll('_', ' ')}: ${contingencyEvidenceText(learned.evidenceDescription)} (${learned.observationCounts.actionPerformed} performed, ${learned.observationCounts.actionWithheld} withheld).`;
        item.appendChild(association);
      }
      root.appendChild(item);
    }
  }

  renderControllability() {
    const entry = this.rows.anxiety;
    const card = entry && entry.querySelector('.controllability-card');
    if (!card) return;
    const snapshot = this.learnedControllability;
    const live = this.learnedControllabilityStatus.status === IMPLEMENTATION_STATUS.IMPLEMENTED
      && snapshot && snapshot.status === 'implemented';
    card.querySelector('.controllability-status').textContent = live
      ? this.learnedControllabilityStatus.publicLabel : 'UNAVAILABLE';
    const root = card.querySelector('.controllability-evidence');
    root.textContent = '';
    const contingencies = live && Array.isArray(snapshot.contingencies) ? snapshot.contingencies : [];
    if (!contingencies.length) {
      const empty = document.createElement('p');
      empty.className = 'controllability-empty';
      empty.textContent = live
        ? 'No resolved comparable action opportunities have been observed yet.'
        : 'No grounded action-outcome contingency state has reached this view.';
      root.appendChild(empty);
      return;
    }
    for (const learned of contingencies) {
      const item = document.createElement('article');
      item.className = 'controllability-item';
      const heading = document.createElement('strong');
      heading.textContent = `${displayIdentifier(learned.actionId)} - ${displayIdentifier(learned.contextId)}`;
      const outcome = document.createElement('p');
      outcome.textContent = `Adverse outcome: ${displayIdentifier(learned.outcomeClass)}`;
      const facts = document.createElement('dl');
      const action = learned.actionPosterior || {};
      const noAction = learned.noActionPosterior || {};
      for (const [label, value] of [
        ['ACTION PERFORMED', `${learned.observationCounts.actionPerformed} resolved; Beta(${action.alpha}, ${action.beta}); mean ${decimal3(action.mean)}; variance ${decimal3(action.variance)}`],
        ['ACTION WITHHELD', `${learned.observationCounts.actionWithheld} resolved; Beta(${noAction.alpha}, ${noAction.beta}); mean ${decimal3(noAction.mean)}; variance ${decimal3(noAction.variance)}`],
        ['OBSERVED DIFFERENCE', `${decimal3(learned.contingencyDifference)}; variance ${decimal3(learned.contingencyVariance)}`],
      ]) {
        const wrapper = document.createElement('div');
        const term = document.createElement('dt');
        const detail = document.createElement('dd');
        term.textContent = label;
        detail.textContent = value;
        wrapper.append(term, detail);
        facts.appendChild(wrapper);
      }
      const interpretation = document.createElement('p');
      interpretation.className = 'controllability-interpretation';
      interpretation.textContent = contingencyEvidenceText(learned.evidenceDescription);
      const limits = document.createElement('p');
      limits.className = 'controllability-causal-limit';
      limits.textContent = 'Causal control: not established. Perceived control: not modelled.';
      item.append(heading, outcome, facts, interpretation, limits);
      root.appendChild(item);
    }
  }

  renderSomatic() {
    const entry = this.rows.pain;
    const card = entry && entry.querySelector('.somatic-input-card');
    if (!card) return;
    const snapshot = this.somaticNociceptive;
    const live = this.somaticStatus.status === IMPLEMENTATION_STATUS.IMPLEMENTED
      && snapshot && snapshot.status === 'implemented';
    card.querySelector('.somatic-input-status').textContent = live
      ? this.somaticStatus.publicLabel : 'UNAVAILABLE';
    const facts = {
      stimuli: live && Array.isArray(snapshot.activeNoxiousStimuli)
        ? String(snapshot.activeNoxiousStimuli.length) : 'UNKNOWN',
      injuries: live && Array.isArray(snapshot.activeInjuries)
        ? String(snapshot.activeInjuries.length) : 'UNKNOWN',
      sites: live && Array.isArray(snapshot.bodySites) && snapshot.bodySites.length
        ? snapshot.bodySites.join(', ') : 'UNKNOWN',
      modalities: live && Array.isArray(snapshot.stimulusModalities) && snapshot.stimulusModalities.length
        ? snapshot.stimulusModalities.join(', ') : 'UNKNOWN',
      damage: live ? String(snapshot.tissueDamageStatus || 'UNKNOWN').replaceAll('_', ' ') : 'UNKNOWN',
      knowledge: live ? String(snapshot.knowledgeStatus || 'UNKNOWN').replaceAll('_', ' ') : 'UNKNOWN',
    };
    for (const [key, value] of Object.entries(facts)) {
      const target = card.querySelector(`[data-somatic="${key}"]`);
      if (target) target.textContent = value;
    }
    const timeline = card.querySelector('.somatic-timeline');
    timeline.textContent = '';
    const records = live && Array.isArray(snapshot.recentSomaticEvents)
      ? snapshot.recentSomaticEvents : [];
    if (!records.length) {
      const empty = document.createElement('p');
      empty.className = 'somatic-timeline-empty';
      empty.textContent = live
        ? 'No structured somatic records have been observed yet.'
        : 'No grounded somatic ledger has reached this view.';
      timeline.appendChild(empty);
      return;
    }
    for (const record of records) {
      const item = document.createElement('article');
      item.className = 'somatic-timeline-item';
      const tissue = record.tissue || {};
      const stimulus = record.stimulus || {};
      const body = record.body || {};
      const heading = document.createElement('strong');
      heading.textContent = `${String(tissue.damageStatus || 'UNKNOWN').replaceAll('_', ' ')} TISSUE STATUS`;
      const detail = document.createElement('p');
      detail.textContent = `${feedingTimestampLabel(record.timestamp)}; site ${body.site || 'UNKNOWN'}; modality ${stimulus.modality || 'UNKNOWN'}; noxious ${stimulus.noxiousStimulus || 'UNKNOWN'}; injury ${tissue.injuryStatus || 'UNKNOWN'}.`;
      item.append(heading, detail);
      timeline.appendChild(item);
    }
  }

  renderFeeding() {
    const entry = this.rows.satiety;
    const card = entry && entry.querySelector('.feeding-input-card');
    if (!card) return;
    const snapshot = this.feeding;
    const physiology = this.physiologicalSatiety;
    const ledgerLive = this.feedingStatus.status === IMPLEMENTATION_STATUS.IMPLEMENTED
      && snapshot && snapshot.status === 'implemented';
    const modelLive = physiology && physiology.status === 'LIVE' && physiology.current;
    card.querySelector('.feeding-input-status').textContent = modelLive
      ? 'LIVE' : String(physiology && physiology.status || 'CALIBRATING').replaceAll('_', ' ');
    const range = (value, unit = '') => value && Number.isFinite(value.minimum) && Number.isFinite(value.maximum)
      ? `${value.minimum.toFixed(2)}-${value.maximum.toFixed(2)}${unit}` : 'UNKNOWN';
    const intake = physiology && physiology.latestKnownIntake;
    const facts = {
      score: modelLive ? `${physiology.current.minimum.toFixed(1)}-${physiology.current.maximum.toFixed(1)} / 10` : '--',
      gastric: modelLive ? range(physiology.gastricContentsMl, ' mL') : 'UNKNOWN',
      cck: modelLive ? range(physiology.cckPM, ' pM') : 'UNKNOWN',
      glp1: modelLive ? range(physiology.glp1PM, ' pM') : 'UNKNOWN',
      pyy: modelLive ? range(physiology.pyyPM, ' pM') : 'UNKNOWN',
      ghrelin: modelLive ? range(physiology.ghrelinPM, ' pM') : 'UNKNOWN',
      intake: intake ? `${String(intake.mealType || 'meal').toUpperCase()}, ${Number(intake.consumedEnergyKcal).toFixed(0)} kcal, ${String(intake.portionBasis || 'UNKNOWN').replaceAll('_', ' ')}` : 'NONE RECORDED',
      nutrition: intake ? `${String(intake.nutritionBasis || 'UNKNOWN').replaceAll('_', ' ')}; ${String(intake.nutritionalComposition || 'UNKNOWN').replaceAll('_', ' ')}` : 'UNKNOWN',
    };
    for (const [key, value] of Object.entries(facts)) {
      const target = card.querySelector(`[data-satiety="${key}"]`);
      if (target) target.textContent = value;
    }
    const uncertainty = card.querySelector('.satiety-uncertainty');
    if (uncertainty) uncertainty.textContent = modelLive
      ? `Input uncertainty: ${(physiology.inputUncertainty || []).join('; ') || 'none recorded'}. Model: Martinez, Dibbs et al. 2025. Subjective hunger is not modelled.`
      : `Physiological model unavailable: ${String(physiology && physiology.statusReason || 'waiting for clean breakfast anchor').replaceAll('_', ' ')}. Subjective hunger is not modelled.`;
    const timeline = card.querySelector('.feeding-timeline');
    timeline.textContent = '';
    const records = ledgerLive && Array.isArray(snapshot.recentMealOutcomes) ? snapshot.recentMealOutcomes : [];
    if (!records.length) {
      const empty = document.createElement('p');
      empty.className = 'feeding-timeline-empty';
      empty.textContent = ledgerLive
        ? 'No structured feeding records have been observed yet.'
        : 'No grounded feeding ledger has reached this view.';
      timeline.appendChild(empty);
      return;
    }
    for (const record of records) {
      const item = document.createElement('article');
      item.className = 'feeding-timeline-item';
      const heading = document.createElement('strong');
      heading.textContent = `${String(record.mealType || 'meal').replaceAll('_', ' ')} - ${String(record.intakeOutcome || 'UNKNOWN').replaceAll('_', ' ')}`;
      const detail = document.createElement('p');
      const portion = record.portionFraction == null
        ? `${String(record.portionCategory || 'UNKNOWN').replaceAll('_', ' ')} (${String(record.portionBasis || 'UNKNOWN').replaceAll('_', ' ')})`
        : `${record.portionFraction} observed fraction`;
      detail.textContent = `${feedingTimestampLabel(record.timestamp)}; offered ${String(record.offeredStatus || 'UNKNOWN').replaceAll('_', ' ')}; consumed ${String(record.consumptionStatus || 'UNKNOWN').replaceAll('_', ' ')}; portion ${portion}.`;
      item.append(heading, detail);
      timeline.appendChild(item);
    }
  }

  renderSocialContact(episodes = null) {
    const entry = this.rows.loneliness;
    const card = entry && entry.querySelector('.social-contact-card');
    if (!card) return;
    const snapshot = this.socialContact;
    const live = this.socialContactStatus.status === IMPLEMENTATION_STATUS.IMPLEMENTED
      && snapshot && snapshot.status === 'implemented';
    card.querySelector('.social-contact-status').textContent = live ? this.socialContactStatus.publicLabel : 'UNAVAILABLE';
    const age = (value) => Number.isFinite(value) ? `${elapsedFeedingLabel(value)} ago` : 'NONE OBSERVED';
    const episodeLabel = (episode) => {
      if (!episode) return 'NONE OBSERVED';
      const who = episode.participants && episode.participants.actorLabel ? episode.participants.actorLabel : 'participant unknown';
      const action = episode.opportunity && episode.opportunity.actionExecuted
        ? `; ${displayIdentifier(episode.opportunity.actionExecuted)}` : '';
      return `${who}; ${String(episode.contactForm || episode.episodeType || 'UNKNOWN').replaceAll('_', ' ')}; ${String(episode.reciprocity || 'UNKNOWN').replaceAll('_', ' ')}; ${String(episode.socialCharacter || 'UNKNOWN')}${action}`;
    };
    const facts = {
      current: live && snapshot.currentContext && snapshot.currentContext.currentlyInteracting
        ? `INTERACTING WITH ${snapshot.currentContext.currentlyWith || 'UNKNOWN'}`
        : live && snapshot.currentContext && snapshot.currentContext.currentlyAlone ? 'ALONE - CONTINUOUSLY OBSERVED'
          : live ? 'UNKNOWN / NO CURRENT INTERACTION OBSERVED' : 'UNKNOWN',
      reciprocal: live ? age(snapshot.elapsedSinceReciprocalContactMs) : 'UNKNOWN',
      supportive: live ? age(snapshot.elapsedSinceSupportiveContactMs) : 'UNKNOWN',
      latest: live ? episodeLabel(snapshot.latestEpisode) : 'UNKNOWN',
      rejection: live ? episodeLabel(snapshot.recentRejection) : 'UNKNOWN',
      continuity: live && snapshot.observationContinuity ? String(snapshot.observationContinuity.status || 'UNKNOWN') : 'UNKNOWN',
    };
    for (const [key, value] of Object.entries(facts)) {
      const target = card.querySelector(`[data-social="${key}"]`);
      if (target) target.textContent = value;
    }
    const timeline = card.querySelector('.social-contact-timeline');
    timeline.textContent = '';
    const records = Array.isArray(episodes) ? episodes : live && Array.isArray(snapshot.recentEpisodes) ? snapshot.recentEpisodes : [];
    if (!records.length) {
      const empty = document.createElement('p');
      empty.className = 'social-contact-empty';
      empty.textContent = live ? 'No structured social episodes have been observed yet.' : 'No grounded social ledger has reached this view.';
      timeline.appendChild(empty);
      return;
    }
    for (const episode of records) {
      const item = document.createElement('article');
      item.className = `social-contact-item social-${String(episode.socialCharacter || 'UNKNOWN').toLowerCase()}`;
      const heading = document.createElement('strong');
      heading.textContent = `${String(episode.episodeType || 'UNKNOWN').replaceAll('_', ' ')} - ${String(episode.socialCharacter || 'UNKNOWN')}`;
      const detail = document.createElement('p');
      const who = episode.participants && episode.participants.actorLabel ? episode.participants.actorLabel : 'participant unknown';
      const duration = Number.isFinite(episode.durationMs) ? `; duration ${elapsedFeedingLabel(episode.durationMs)}` : '';
      const action = episode.opportunity && episode.opportunity.actionExecuted
        ? `; action ${displayIdentifier(episode.opportunity.actionExecuted)}` : '';
      detail.textContent = `${feedingTimestampLabel(episode.startTimestamp)}; ${who}; ${String(episode.channel || 'UNKNOWN').replaceAll('_', ' ')}; ${String(episode.contactForm || 'UNKNOWN').replaceAll('_', ' ')}; ${String(episode.reciprocity || 'UNKNOWN').replaceAll('_', ' ')}${duration}${action}.`;
      item.append(heading, detail);
      timeline.appendChild(item);
    }
  }

  async loadSocialContact(entry, range, exact = false) {
    if (!this.socialContactUrl) return;
    const separator = this.socialContactUrl.includes('?') ? '&' : '?';
    try {
      const response = await fetch(`${this.socialContactUrl}${separator}range=${encodeURIComponent(range)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`social contact ${response.status}`);
      const data = await response.json();
      const gaps = data.current && Array.isArray(data.current.observationGaps)
        ? data.current.observationGaps.map((gap) => ({
          episodeType: 'OBSERVATION_GAP', socialCharacter: 'UNKNOWN', channel: 'UNKNOWN',
          contactForm: 'UNKNOWN', reciprocity: 'UNKNOWN', participants: {},
          startTimestamp: gap.startTimestamp, endTimestamp: gap.endTimestamp,
          durationMs: Date.parse(gap.endTimestamp) - Date.parse(gap.startTimestamp),
        })) : [];
      const timeline = [...(data.episodes || []), ...gaps].sort((a, b) =>
        Date.parse(a.startTimestamp || '') - Date.parse(b.startTimestamp || ''));
      if (!exact) this.renderSocialContact(timeline);
      if (exact) {
        const target = entry.querySelector('.social-contact-inspector pre');
        if (target) target.textContent = JSON.stringify(data.inspection || data, null, 2);
      }
    } catch (error) {
      const target = exact ? entry.querySelector('.social-contact-inspector pre') : entry.querySelector('.social-contact-empty');
      if (target) target.textContent = error && error.message ? error.message : 'Social contact history unavailable.';
    }
  }

  renderSleepHomeostasis() {
    const entry = this.rows.sleepiness;
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
    const entry = this.rows.sleepiness;
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
      const response = await fetch(buildHistoryUrl(this.historyUrl, scope, key, range));
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'history unavailable');
      if (this.historyRequests.get(entry) !== request) return;
      if (scope === 'satiety') {
        const paths = buildCircadianHistoryPaths(data.points, 280, 80, { minimum: 1, maximum: 10 });
        entry.querySelector('.satiety-history-line').setAttribute('d', paths.estimate);
        entry.querySelector('.satiety-history-band').setAttribute('d', paths.band);
      } else {
        path.setAttribute('d', scope === 'sleepiness'
          ? buildScaledHistoryPath(data.points, 1, 9)
          : buildHistoryPath(data.points));
      }
      note.textContent = data.points.length ? `${data.points.length} stored ${range} readings. Gaps mean no runner data was recorded.` : `No stored readings in the last ${range}.`;
    } catch (error) {
      if (this.historyRequests.get(entry) !== request) return;
      path.setAttribute('d', '');
      const band = entry.querySelector('.satiety-history-band');
      if (band) band.setAttribute('d', '');
      const estimate = entry.querySelector('.satiety-history-line');
      if (estimate) estimate.setAttribute('d', '');
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
      const response = await fetch(buildHistoryUrl(this.historyUrl, 'sleep', 'sleepPressure', range));
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
      const response = await fetch(buildHistoryUrl(this.historyUrl, 'circadian', 'processC', range));
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
