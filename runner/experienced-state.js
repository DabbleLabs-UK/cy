// Canonical visitor-facing Soma state.
//
// Every value is the sum of a resting baseline and a ledger of named causal
// contributors. Event impulses decay with their own half-lives; body-clock and
// cross-state contributors are explicit levels. The public explanation, prompt
// directive and brain analogy all read this same ledger.

export const EXPERIENCED_VERSION = 1;
export const HISTORY_INTERVAL_MS = 2 * 60 * 1000;
export const HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export const METRICS = {
  anxiety: { label: 'ANXIETY', baseline: 18, recovery: 'medium' },
  arousal: { label: 'AROUSAL / STRESS', baseline: 20, recovery: 'fast' },
  pain: { label: 'PAIN / DISCOMFORT', baseline: 2, recovery: 'slow' },
  hunger: { label: 'HUNGER', baseline: 18, recovery: 'body clock' },
  fatigue: { label: 'FATIGUE', baseline: 20, recovery: 'sleep / body clock' },
  loneliness: { label: 'LONELINESS / SOCIAL NEED', baseline: 30, recovery: 'slow' },
  anger: { label: 'ANGER / HOSTILITY', baseline: 10, recovery: 'medium' },
  rumination: { label: 'RUMINATION / FIXATION', baseline: 16, recovery: 'slow' },
};

const HALF_LIFE = {
  anxiety: 55 * 60 * 1000,
  arousal: 18 * 60 * 1000,
  pain: 4 * 60 * 60 * 1000,
  loneliness: 5 * 60 * 60 * 1000,
  anger: 70 * 60 * 1000,
  rumination: 3 * 60 * 60 * 1000,
};

const clamp = (value, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Number(value) || 0));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const round = (value, digits = 1) => Number(Number(value).toFixed(digits));
const clean = (value, maximum = 120) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, maximum);

function blankMetric(key, now) {
  const spec = METRICS[key];
  return { value: spec.baseline, baseline: spec.baseline, updatedAtMs: now };
}

export function blankExperienced(now = Date.now(), legacyPhysical = null) {
  const state = {
    version: EXPERIENCED_VERSION,
    createdAtMs: now,
    updatedAtMs: now,
    lastTickMs: now,
    lastSampleMs: 0,
    legacyImported: !!(legacyPhysical && typeof legacyPhysical === 'object'),
    socialClockInitialised: false,
    metrics: Object.fromEntries(Object.keys(METRICS).map((key) => [key, blankMetric(key, now)])),
    contributors: Object.fromEntries(Object.keys(METRICS).map((key) => [key, []])),
    history: [],
  };
  if (legacyPhysical && typeof legacyPhysical === 'object') {
    for (const key of ['pain', 'hunger', 'fatigue']) {
      if (!Number.isFinite(legacyPhysical[key])) continue;
      const amount = clamp(legacyPhysical[key] * 100) - METRICS[key].baseline;
      if (key === 'pain') {
        addImpulse(state, key, `migration:${key}`, amount,
          'starting value migrated from the previous body-clock state', now, 'migration', HALF_LIFE.pain);
      } else {
        setLevel(state, key, `migration:${key}`, amount,
          'starting value migrated from the previous body-clock state', now, 'migration');
      }
    }
  }
  recompute(state, now);
  sample(state, now, true);
  return state;
}

export function reconcileExperienced(raw, { now = Date.now(), legacyPhysical = null } = {}) {
  if (!raw || typeof raw !== 'object' || raw.version !== EXPERIENCED_VERSION) {
    return blankExperienced(now, legacyPhysical);
  }
  const state = blankExperienced(finite(raw.createdAtMs, now));
  state.createdAtMs = finite(raw.createdAtMs, now);
  state.updatedAtMs = finite(raw.updatedAtMs, now);
  state.lastTickMs = finite(raw.lastTickMs, now);
  state.lastSampleMs = finite(raw.lastSampleMs, 0);
  state.legacyImported = raw.legacyImported !== false;
  state.socialClockInitialised = raw.socialClockInitialised === true;
  for (const key of Object.keys(METRICS)) {
    const metric = raw.metrics && raw.metrics[key];
    state.metrics[key] = {
      value: clamp(metric && metric.value, 0, 100),
      baseline: METRICS[key].baseline,
      updatedAtMs: finite(metric && metric.updatedAtMs, state.updatedAtMs),
    };
    const ledger = raw.contributors && raw.contributors[key];
    state.contributors[key] = Array.isArray(ledger) ? ledger.filter(Boolean).slice(-96).map((item, index) => ({
      id: clean(item.id || `restored:${key}:${index}`, 100),
      sourceId: clean(item.sourceId || item.id || 'restored', 100),
      sourceType: clean(item.sourceType || 'event', 30),
      description: clean(item.description || 'stored causal contribution'),
      amount: finite(item.amount, 0),
      mode: item.mode === 'level' ? 'level' : 'impulse',
      startedAtMs: finite(item.startedAtMs, state.updatedAtMs),
      updatedAtMs: finite(item.updatedAtMs, item.startedAtMs || state.updatedAtMs),
      halfLifeMs: Math.max(1000, finite(item.halfLifeMs, HALF_LIFE[key] || 3600000)),
    })) : [];
  }
  state.history = Array.isArray(raw.history) ? raw.history.filter((point) => point && Number.isFinite(point.ts))
    .slice(-5040).map((point) => ({
      ts: point.ts,
      values: Object.fromEntries(Object.keys(METRICS).map((key) => [key, clamp(point.values && point.values[key])])),
    })) : [];
  recompute(state, now);
  return state;
}

function contributionAt(item, now) {
  if (item.mode === 'level') return finite(item.amount, 0);
  const age = Math.max(0, now - finite(item.updatedAtMs, now));
  return finite(item.amount, 0) * Math.pow(0.5, age / Math.max(1000, finite(item.halfLifeMs, 3600000)));
}

function addImpulse(state, metric, id, amount, description, now, sourceType = 'event', halfLifeMs = null) {
  if (!METRICS[metric] || !amount) return;
  state.contributors[metric].push({
    id: clean(id, 100), sourceId: clean(id, 100), sourceType, description: clean(description), amount,
    mode: 'impulse', startedAtMs: now, updatedAtMs: now,
    halfLifeMs: halfLifeMs || HALF_LIFE[metric] || 3600000,
  });
}

function setLevel(state, metric, id, amount, description, now, sourceType = 'body_clock') {
  if (!METRICS[metric]) return;
  amount = clamp(amount, -METRICS[metric].baseline, 100 - METRICS[metric].baseline);
  const ledger = state.contributors[metric];
  const old = ledger.find((item) => item.id === id);
  if (old) {
    old.amount = amount;
    old.description = clean(description);
    old.updatedAtMs = now;
    old.sourceType = sourceType;
    old.mode = 'level';
  } else {
    ledger.push({ id, sourceId: id, sourceType, description: clean(description), amount, mode: 'level',
      startedAtMs: now, updatedAtMs: now, halfLifeMs: 3600000 });
  }
}

function adjustLevel(state, metric, id, delta, description, now, sourceType = 'body_clock') {
  const old = state.contributors[metric].find((item) => item.id === id);
  setLevel(state, metric, id, finite(old && old.amount, 0) + delta, description, now, sourceType);
}

function recompute(state, now) {
  for (const key of Object.keys(METRICS)) {
    state.contributors[key] = state.contributors[key].filter((item) => item.mode === 'level' || Math.abs(contributionAt(item, now)) >= 0.15);
    const value = clamp(METRICS[key].baseline + state.contributors[key]
      .reduce((sum, item) => sum + contributionAt(item, now), 0));
    if (Math.abs(value - state.metrics[key].value) >= 0.05) state.metrics[key].updatedAtMs = now;
    state.metrics[key].value = round(value);
    state.metrics[key].baseline = METRICS[key].baseline;
  }
  state.updatedAtMs = now;
}

function sample(state, now, force = false) {
  if (!force && now - state.lastSampleMs < HISTORY_INTERVAL_MS) return;
  state.history.push({ ts: now, values: Object.fromEntries(Object.keys(METRICS).map((key) => [key, state.metrics[key].value])) });
  const cutoff = now - HISTORY_RETENTION_MS;
  state.history = state.history.filter((point) => point.ts >= cutoff).slice(-5040);
  state.lastSampleMs = now;
}

function eventIdentity(observation, episodeId, now) {
  return clean(observation.id || observation.seq || episodeId || `${observation.name || 'event'}:${now}`, 100);
}

export function observeExperienced(state, { observation = {}, appraisal = {}, prediction = {}, family = '', episodeId = null } = {}, now = Date.now()) {
  if (!state) return state;
  const id = eventIdentity(observation, episodeId, now);
  const structural = `${observation.name || ''} ${(observation.tags || []).join(' ')} ${family}`.toLowerCase();
  const subject = clean(observation.text || observation.name || family || 'an observed event');
  const threat = clamp(appraisal.threat, 0, 1);
  const control = clamp(appraisal.controlLoss, 0, 1);
  const affiliation = clamp(appraisal.affiliation, 0, 1);
  const deprivation = clamp(appraisal.deprivation, 0, 1);
  const error = clamp(prediction.error, 0, 1);

  if (Math.max(threat, control) >= 0.22) {
    addImpulse(state, 'anxiety', `${id}:threat`, 34 * threat + 18 * control,
      `threat or lost control in: ${subject}`, now);
    addImpulse(state, 'arousal', `${id}:arousal`, 27 * threat + 20 * control,
      `immediate activation from: ${subject}`, now);
  }
  if (/injur|pain|hurt|blood/.test(structural)) {
    addImpulse(state, 'pain', `${id}:pain`, 38, `physical discomfort from: ${subject}`, now, 'body_event');
    addImpulse(state, 'arousal', `${id}:pain-arousal`, 16, `pain raised activation after: ${subject}`, now);
  }
  if (/hostile|fight|conflict|threat/.test(structural)) {
    addImpulse(state, 'anger', `${id}:anger`, 22 + 25 * threat + 13 * control,
      `hostility or unfairness in: ${subject}`, now);
  }
  if (/meal|food|egg|canteen/.test(structural) && !/no_|none|miss|cold|refus/.test(structural)) {
    const current = state.metrics.hunger.value;
    setLevel(state, 'hunger', 'body:hunger-clock', Math.min(-12, 8 - current),
      `reduced by the meal: ${subject}`, now, 'body_event');
  } else if (deprivation >= 0.35 && /hunger|food|egg|meal|canteen/.test(structural)) {
    addImpulse(state, 'hunger', `${id}:deprivation`, 22 * deprivation,
      `food deprivation in: ${subject}`, now, 'body_event', 2 * 60 * 60 * 1000);
  }
  if (affiliation >= 0.22) {
    addImpulse(state, 'loneliness', `${id}:contact`, -32 * affiliation,
      `social contact from: ${subject}`, now, 'social_event', HALF_LIFE.loneliness);
    if (threat < 0.25) addImpulse(state, 'anxiety', `${id}:reassurance`, -10 * affiliation,
      `reassurance from: ${subject}`, now, 'social_event');
  }
  if (/no_mail|cancel|refus|ignored|alone/.test(structural)) {
    addImpulse(state, 'loneliness', `${id}:absence`, 18 + 12 * deprivation,
      `social absence or rejection in: ${subject}`, now, 'social_event', HALF_LIFE.loneliness);
  }
  const unresolved = Math.max(error, control * 0.75, threat * 0.45);
  if (unresolved >= 0.24) {
    addImpulse(state, 'rumination', `${id}:unresolved`, 25 * unresolved,
      `unresolved or surprising event: ${subject}`, now, 'cognitive_event', HALF_LIFE.rumination);
  }
  recompute(state, now);
  sample(state, now, true);
  return state;
}

export function observeExperiencedOutput(state, { repetition = 0, triggerActivation = 0, attention = null, text = '' } = {}, now = Date.now()) {
  if (!state) return state;
  const amount = 16 * clamp(repetition, 0, 1) + 18 * clamp(triggerActivation, 0, 1);
  if (amount >= 2) {
    const subject = clean((attention && attention.text) || text || 'Cy returning to the same material');
    addImpulse(state, 'rumination', `self-output:${now}`, amount,
      `his own repeated wording reactivated: ${subject}`, now, 'self_output', HALF_LIFE.rumination);
  }
  recompute(state, now);
  sample(state, now, amount >= 2);
  return state;
}

export function tickExperienced(state, {
  now = Date.now(), asleep = false, attention = {}, predictionError = 0,
  legacyPhysical = null, lastMailMs = null,
} = {}) {
  if (!state) return state;
  if (!state.legacyImported && legacyPhysical && typeof legacyPhysical === 'object') {
    for (const key of ['pain', 'hunger', 'fatigue']) {
      if (!Number.isFinite(legacyPhysical[key])) continue;
      const amount = clamp(legacyPhysical[key] * 100) - METRICS[key].baseline;
      if (key === 'pain') {
        addImpulse(state, key, `migration:${key}`, amount,
          'starting value migrated from the previous body-clock state', now, 'migration', HALF_LIFE.pain);
      } else {
        setLevel(state, key, `migration:${key}`, amount,
          'starting value migrated from the previous body-clock state', now, 'migration');
      }
    }
    state.legacyImported = true;
  }
  if (!state.socialClockInitialised) {
    const hoursWithoutMail = Number.isFinite(lastMailMs) ? Math.max(0, now - lastMailMs) / 3600000 : 0;
    setLevel(state, 'loneliness', 'body:social-clock', Math.min(50, hoursWithoutMail * 0.65),
      'social need accumulating with time without reassuring contact', now, 'social_clock');
    state.socialClockInitialised = true;
  }
  const elapsedMs = Math.max(0, Math.min(24 * 60 * 60 * 1000, now - finite(state.lastTickMs, now)));
  const hours = elapsedMs / 3600000;
  state.lastTickMs = now;
  if (hours > 0) {
    adjustLevel(state, 'hunger', 'body:hunger-clock', 3.2 * hours,
      'hunger rising with time since food', now);
    adjustLevel(state, 'fatigue', 'body:fatigue-clock', (asleep ? -13 : 2.7) * hours,
      asleep ? 'fatigue recovering during sleep' : 'fatigue accumulating while awake', now);
    adjustLevel(state, 'loneliness', 'body:social-clock', 0.65 * hours,
      'social need accumulating with time without reassuring contact', now, 'social_clock');
  }
  const fatigue = finite(state.metrics.fatigue && state.metrics.fatigue.value, METRICS.fatigue.baseline);
  const hunger = finite(state.metrics.hunger && state.metrics.hunger.value, METRICS.hunger.baseline);
  const pain = finite(state.metrics.pain && state.metrics.pain.value, METRICS.pain.baseline);
  setLevel(state, 'anxiety', 'coupling:fatigue-anxiety', Math.max(0, fatigue - 55) * 0.22,
    'fatigue is reducing tolerance for uncertainty', now, 'state_coupling');
  setLevel(state, 'arousal', 'coupling:body-arousal', Math.max(0, hunger - 60) * 0.16 + Math.max(0, pain - 15) * 0.2,
    'current hunger and pain are raising bodily activation', now, 'state_coupling');
  setLevel(state, 'rumination', 'coupling:attention-rumination', 16 * clamp(attention.salience, 0, 1) + 14 * clamp(predictionError, 0, 1),
    attention.text ? `present attention remains on: ${clean(attention.text)}` : 'unresolved attention and prediction mismatch',
    now, 'cognitive_state');
  recompute(state, now);
  sample(state, now);
  return state;
}

function trendFor(state, key, now) {
  const current = state.metrics[key].value;
  const target = [...state.history].reverse().find((point) => point.ts <= now - 15 * 60 * 1000) || state.history[0];
  const delta = target ? round(current - finite(target.values && target.values[key], current)) : 0;
  return { direction: delta >= 1 ? 'rising' : delta <= -1 ? 'falling' : 'steady', delta };
}

function publicContributors(state, key, now) {
  return state.contributors[key].map((item) => ({
    id: item.id,
    sourceId: item.sourceId,
    sourceType: item.sourceType,
    description: item.description,
    contribution: round(contributionAt(item, now)),
    startedAtMs: item.startedAtMs,
    updatedAtMs: item.updatedAtMs,
  })).filter((item) => Math.abs(item.contribution) >= 0.1)
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution) || a.id.localeCompare(b.id)).slice(0, 8);
}

function level(value) {
  return value >= 75 ? 'high' : value >= 50 ? 'elevated' : value >= 22 ? 'normal' : 'low';
}

function brainRegion(key, label, value, sources) {
  return {
    key, label, value: round(clamp(value) / 100, 3), level: level(value), sources,
    explanation: `${label} is ${level(value)} because it is derived from ${sources.join(', ')} in the same experienced-state snapshot.`,
  };
}

export function experiencedSnapshot(state, now = null) {
  if (!state) return null;
  now = Number.isFinite(now) ? now : finite(state.updatedAtMs, Date.now());
  recompute(state, now);
  const metrics = {};
  for (const [key, spec] of Object.entries(METRICS)) {
    const trend = trendFor(state, key, now);
    metrics[key] = {
      key, label: spec.label, value: state.metrics[key].value, baseline: spec.baseline,
      updatedAtMs: state.metrics[key].updatedAtMs, trend: trend.direction, trendDelta: trend.delta,
      recovery: spec.recovery, contributors: publicContributors(state, key, now),
    };
  }
  const value = (key) => metrics[key].value;
  const brain = {
    amygdala: brainRegion('amygdala', 'Amygdala analogy', 0.65 * value('anxiety') + 0.35 * value('anger'), ['anxiety', 'anger']),
    insula: brainRegion('insula', 'Insula analogy', 0.5 * value('pain') + 0.28 * value('hunger') + 0.22 * value('arousal'), ['pain', 'hunger', 'arousal']),
    acc: brainRegion('acc', 'Anterior cingulate analogy', 0.55 * value('rumination') + 0.45 * value('pain'), ['rumination', 'pain']),
    hippocampal: brainRegion('hippocampal', 'Hippocampal analogy', 0.55 * value('rumination') + 0.25 * value('anxiety') + 0.2 * value('loneliness'), ['rumination', 'anxiety', 'loneliness']),
    prefrontal: brainRegion('prefrontal', 'Prefrontal analogy', 100 - (0.45 * value('fatigue') + 0.3 * value('arousal') + 0.25 * value('pain')), ['inverse fatigue', 'inverse arousal', 'inverse pain']),
    temporalSocial: brainRegion('temporalSocial', 'Temporal / social analogy', value('loneliness'), ['loneliness']),
  };
  return { version: EXPERIENCED_VERSION, updatedAtMs: state.updatedAtMs, metrics, brain };
}

export function experiencedDirective(state, now = null) {
  if (!state) return '';
  now = Number.isFinite(now) ? now : finite(state.updatedAtMs, Date.now());
  const snapshot = experiencedSnapshot(state, now);
  const active = Object.values(snapshot.metrics).map((metric) => ({
    ...metric, distance: Math.abs(metric.value - metric.baseline),
  })).filter((metric) => metric.distance >= 8).sort((a, b) => b.distance - a.distance).slice(0, 3);
  if (!active.length) return 'EXPERIENCED STATE: no pressure is far from its resting tendency.';
  const lines = ['EXPERIENCED STATE - let this alter attention and action, but never report scores:'];
  const consequences = {
    anxiety: 'notice danger, uncertainty and loss of control more readily',
    arousal: 'favour immediate, less settled responses',
    pain: 'let bodily discomfort interrupt other concerns',
    hunger: 'let food and deprivation compete for attention',
    fatigue: 'favour shorter output, rest or silence',
    loneliness: 'notice contact, rejection and social absence',
    anger: 'notice hostility and unfairness, with less patience',
    rumination: 'return attention to unresolved material',
  };
  for (const metric of active) {
    const cause = metric.contributors[0] && metric.contributors[0].description;
    const direction = metric.value >= metric.baseline ? consequences[metric.key] : `be less governed by ${metric.label.toLowerCase()}`;
    lines.push(`- ${direction}${cause ? ` because ${cause}` : ''}`);
  }
  return lines.join('\n');
}

export function experiencedHistory(state) {
  return Array.isArray(state && state.history) ? state.history.map((point) => ({ ts: point.ts, values: { ...point.values } })) : [];
}
