// Canonical visitor-facing Soma state.
//
// Every value is the sum of a resting baseline and a ledger of named causal
// contributors. Event impulses decay with their own half-lives; body-clock and
// cross-state contributors are explicit levels. The public explanation, prompt
// directive and brain analogy all read this same ledger.
//
// MODEL STATUS: PROVISIONAL. Every numerical psychological coefficient,
// threshold, baseline, decay rate, clamp and brain-region weight in this file
// is ARBITRARY / HEURISTIC. None has an approved scientific or computational
// model citation.

export const EXPERIENCED_VERSION = 2;
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

const MIN_VALUE = 2;
const MAX_VALUE = 96;
const MAX_LEVEL_VALUE = 90;
const MAX_EVENT_IMPULSE = 36;

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
    legacyImported: true,
    socialClockInitialised: false,
    body: {
      nutrition: {
        lastOfferedAtMs: null,
        lastMealAtMs: null,
        lastMealName: '',
        lastOutcome: 'unknown',
        lastAmount: 0,
        mealsEaten: 0,
        mealsPartial: 0,
        mealsMissed: 0,
        mealsRefused: 0,
      },
      sleep: {
        asleep: false,
        currentStartedAtMs: null,
        lastStartedAtMs: null,
        lastEndedAtMs: null,
        lastDurationMs: 0,
        totalSleepMs: 0,
        interruptions: 0,
        lastInterruptedAtMs: null,
        fatigueLoad: METRICS.fatigue.baseline,
      },
      social: {
        lastSupportiveAtMs: null,
        lastQuality: 'unknown',
        supportiveContacts: 0,
        rejectingContacts: 0,
      },
    },
    metrics: Object.fromEntries(Object.keys(METRICS).map((key) => [key, blankMetric(key, now)])),
    contributors: Object.fromEntries(Object.keys(METRICS).map((key) => [key, []])),
    history: [],
  };
  // Legacy physical scalars are deliberately ignored. They were ungrounded,
  // frequently saturated values and must not become permanent Soma causes.
  void legacyPhysical;
  recompute(state, now);
  sample(state, now, true);
  return state;
}

export function reconcileExperienced(raw, { now = Date.now(), legacyPhysical = null } = {}) {
  if (!raw || typeof raw !== 'object' || ![1, EXPERIENCED_VERSION].includes(raw.version)) {
    return blankExperienced(now, legacyPhysical);
  }
  const migratingV1 = raw.version === 1;
  const state = blankExperienced(finite(raw.createdAtMs, now));
  state.version = EXPERIENCED_VERSION;
  state.createdAtMs = finite(raw.createdAtMs, now);
  state.updatedAtMs = finite(raw.updatedAtMs, now);
  state.lastTickMs = migratingV1 ? now : finite(raw.lastTickMs, now);
  state.lastSampleMs = finite(raw.lastSampleMs, 0);
  state.legacyImported = true;
  state.socialClockInitialised = raw.socialClockInitialised === true;
  if (!migratingV1 && raw.body && typeof raw.body === 'object') {
    const nutrition = raw.body.nutrition || {};
    const sleep = raw.body.sleep || {};
    const social = raw.body.social || {};
    state.body.nutrition = {
      ...state.body.nutrition,
      lastOfferedAtMs: finite(nutrition.lastOfferedAtMs, null),
      lastMealAtMs: finite(nutrition.lastMealAtMs, null),
      lastMealName: clean(nutrition.lastMealName, 32),
      lastOutcome: clean(nutrition.lastOutcome || 'unknown', 24),
      lastAmount: clamp(nutrition.lastAmount, 0, 1),
      mealsEaten: Math.max(0, finite(nutrition.mealsEaten, 0)),
      mealsPartial: Math.max(0, finite(nutrition.mealsPartial, 0)),
      mealsMissed: Math.max(0, finite(nutrition.mealsMissed, 0)),
      mealsRefused: Math.max(0, finite(nutrition.mealsRefused, 0)),
    };
    state.body.sleep = {
      ...state.body.sleep,
      asleep: sleep.asleep === true,
      currentStartedAtMs: finite(sleep.currentStartedAtMs, null),
      lastStartedAtMs: finite(sleep.lastStartedAtMs, null),
      lastEndedAtMs: finite(sleep.lastEndedAtMs, null),
      lastDurationMs: Math.max(0, finite(sleep.lastDurationMs, 0)),
      totalSleepMs: Math.max(0, finite(sleep.totalSleepMs, 0)),
      interruptions: Math.max(0, finite(sleep.interruptions, 0)),
      lastInterruptedAtMs: finite(sleep.lastInterruptedAtMs, null),
      fatigueLoad: clamp(sleep.fatigueLoad, MIN_VALUE, MAX_LEVEL_VALUE),
    };
    state.body.social = {
      ...state.body.social,
      lastSupportiveAtMs: finite(social.lastSupportiveAtMs, null),
      lastQuality: clean(social.lastQuality || 'unknown', 24),
      supportiveContacts: Math.max(0, finite(social.supportiveContacts, 0)),
      rejectingContacts: Math.max(0, finite(social.rejectingContacts, 0)),
    };
  }
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
      qualifiedReassurance: item.qualifiedReassurance === true,
    })).filter((item) => item.sourceType !== 'migration' && !item.id.startsWith('migration:')) : [];
    if (migratingV1 && ['hunger', 'fatigue'].includes(key)) {
      state.contributors[key] = state.contributors[key].filter((item) => item.mode !== 'level');
    }
  }
  state.contributors.loneliness = state.contributors.loneliness.filter((item) =>
    !(item.sourceType === 'social_event' && item.id.endsWith(':contact') && !item.qualifiedReassurance));
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
  amount = clamp(amount, -MAX_EVENT_IMPULSE, MAX_EVENT_IMPULSE);
  const item = {
    id: clean(id, 100), sourceId: clean(id, 100), sourceType, description: clean(description), amount,
    mode: 'impulse', startedAtMs: now, updatedAtMs: now,
    halfLifeMs: halfLifeMs || HALF_LIFE[metric] || 3600000,
  };
  state.contributors[metric].push(item);
  return item;
}

function setLevel(state, metric, id, amount, description, now, sourceType = 'body_clock') {
  if (!METRICS[metric]) return;
  amount = clamp(amount, MIN_VALUE - METRICS[metric].baseline, MAX_LEVEL_VALUE - METRICS[metric].baseline);
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

function recompute(state, now) {
  for (const key of Object.keys(METRICS)) {
    state.contributors[key] = state.contributors[key].filter((item) => item.mode === 'level' || Math.abs(contributionAt(item, now)) >= 0.15);
    const levels = state.contributors[key].filter((item) => item.mode === 'level')
      .reduce((sum, item) => sum + finite(item.amount, 0), 0);
    const anchor = clamp(METRICS[key].baseline + levels, MIN_VALUE, MAX_LEVEL_VALUE);
    const impulses = state.contributors[key].filter((item) => item.mode !== 'level')
      .map((item) => contributionAt(item, now));
    const positive = impulses.filter((amount) => amount > 0).reduce((sum, amount) => sum + amount, 0);
    const negative = -impulses.filter((amount) => amount < 0).reduce((sum, amount) => sum + amount, 0);
    const upRoom = Math.max(0.001, MAX_VALUE - anchor);
    const downRoom = Math.max(0.001, anchor - MIN_VALUE);
    const value = clamp(
      anchor + upRoom * (1 - Math.exp(-positive / upRoom)) - downRoom * (1 - Math.exp(-negative / downRoom)),
      MIN_VALUE,
      MAX_VALUE,
    );
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

function hungerTarget(nutrition, now) {
  if (!Number.isFinite(nutrition.lastMealAtMs)) return METRICS.hunger.baseline;
  const hours = Math.max(0, now - nutrition.lastMealAtMs) / 3600000;
  const portionPenalty = (1 - clamp(nutrition.lastAmount, 0, 1)) * 12;
  return clamp(10 + portionPenalty + 2.6 * hours + 0.15 * hours * hours, 8, 88);
}

function updateHungerClock(state, now) {
  const nutrition = state.body.nutrition;
  const target = hungerTarget(nutrition, now);
  const meal = nutrition.lastMealName || 'recorded food';
  const description = Number.isFinite(nutrition.lastMealAtMs)
    ? `hunger is based on time since the ${meal} that was actually eaten`
    : 'hunger is at its resting level until an actual meal is recorded';
  setLevel(state, 'hunger', 'body:hunger-clock', target - METRICS.hunger.baseline, description, now, 'body_clock');
}

function recordMeal(state, meal, subject, now, id) {
  if (!meal || typeof meal !== 'object') return false;
  const nutrition = state.body.nutrition;
  const outcome = ['eaten', 'partial', 'missed', 'refused'].includes(meal.outcome) ? meal.outcome : 'missed';
  const amount = clamp(meal.amount, 0, 1);
  nutrition.lastOfferedAtMs = now;
  nutrition.lastMealName = clean(meal.name || 'meal', 32);
  nutrition.lastOutcome = outcome;
  if (outcome === 'eaten' || outcome === 'partial') {
    nutrition.lastMealAtMs = now;
    nutrition.lastAmount = amount || (outcome === 'eaten' ? 1 : 0.45);
    if (outcome === 'eaten') nutrition.mealsEaten++;
    else nutrition.mealsPartial++;
    state.contributors.hunger = state.contributors.hunger.filter((item) => item.sourceType !== 'meal_deprivation');
  } else {
    nutrition.lastAmount = 0;
    if (outcome === 'missed') nutrition.mealsMissed++;
    else nutrition.mealsRefused++;
    const amountAdded = outcome === 'missed' ? 12 : 8;
    addImpulse(state, 'hunger', `${id}:${outcome}`, amountAdded,
      `${nutrition.lastMealName} was ${outcome}: ${subject}`, now, 'meal_deprivation', 3 * 60 * 60 * 1000);
  }
  updateHungerClock(state, now);
  return true;
}

function recordSleep(state, sleepEvent, subject, now, id) {
  if (!sleepEvent || typeof sleepEvent !== 'object') return;
  const sleep = state.body.sleep;
  if (sleepEvent.outcome === 'started' && !sleep.asleep) {
    sleep.asleep = true;
    sleep.currentStartedAtMs = now;
    sleep.lastStartedAtMs = now;
  } else if (sleepEvent.outcome === 'ended' && sleep.asleep) {
    const started = finite(sleep.currentStartedAtMs, now);
    sleep.lastDurationMs = Math.max(0, now - started);
    sleep.lastEndedAtMs = now;
    sleep.asleep = false;
    sleep.currentStartedAtMs = null;
  } else if (sleepEvent.outcome === 'interrupted') {
    sleep.interruptions++;
    sleep.lastInterruptedAtMs = now;
    addImpulse(state, 'fatigue', `${id}:interruption`, 9,
      `sleep was interrupted by: ${subject}`, now, 'sleep_event', 5 * 60 * 60 * 1000);
    addImpulse(state, 'arousal', `${id}:wake`, 8,
      `woken by: ${subject}`, now, 'sleep_event', HALF_LIFE.arousal);
  }
}

function recordSocial(state, social, subject, now, id, affiliation, threat, control) {
  const socialState = state.body.social;
  const quality = social && clean(social.quality, 24);
  const strength = clamp(social && social.strength, 0, 1) || affiliation;
  const supportive = ['supportive', 'ordinary'].includes(quality) || (!quality && affiliation >= 0.22);
  const rejecting = ['rejecting', 'absent', 'hostile'].includes(quality);
  if (supportive && threat < 0.35 && control < 0.5) {
    socialState.lastSupportiveAtMs = now;
    socialState.lastQuality = quality || 'reassuring';
    socialState.supportiveContacts++;
    setLevel(state, 'loneliness', 'body:social-clock', -10,
      `recent ordinary contact: ${subject}`, now, 'social_clock');
    const contact = addImpulse(state, 'loneliness', `${id}:contact`, -18 * strength,
      `social contact from: ${subject}`, now, 'social_event', HALF_LIFE.loneliness);
    if (contact) contact.qualifiedReassurance = true;
    if (threat < 0.25) addImpulse(state, 'anxiety', `${id}:reassurance`, -8 * strength,
      `reassurance from: ${subject}`, now, 'social_event');
  } else if (rejecting) {
    socialState.lastQuality = quality;
    socialState.rejectingContacts++;
    addImpulse(state, 'loneliness', `${id}:absence`, 14 * Math.max(0.35, strength),
      `social disconnection in: ${subject}`, now, 'social_event', HALF_LIFE.loneliness);
  }
}

function applyExplicitEffects(state, effects, subject, now, id) {
  if (!Array.isArray(effects)) return;
  for (const [index, effect] of effects.entries()) {
    const metric = clean(effect && effect.metric, 24);
    if (!METRICS[metric]) continue;
    const amount = finite(effect.amount, 0);
    if (!amount) continue;
    addImpulse(state, metric, `${id}:effect:${index}`, amount,
      clean(effect.description || `${subject} affected ${metric}`), now, 'environment_effect',
      Math.max(60000, finite(effect.halfLifeMs, HALF_LIFE[metric] || 60 * 60 * 1000)));
  }
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
  const structuredMeal = recordMeal(state, observation.body && observation.body.meal, subject, now, id);
  recordSleep(state, observation.body && observation.body.sleep, subject, now, id);
  applyExplicitEffects(state, observation.effects, subject, now, id);

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
  if (!structuredMeal && /meal|food|egg|canteen/.test(structural) && !/no_|none|miss|cold|refus/.test(structural)) {
    const current = state.metrics.hunger.value;
    state.body.nutrition.lastOfferedAtMs = now;
    state.body.nutrition.lastMealAtMs = now;
    state.body.nutrition.lastMealName = clean(observation.name || 'meal', 32);
    state.body.nutrition.lastOutcome = 'eaten';
    state.body.nutrition.lastAmount = 1;
    state.body.nutrition.mealsEaten++;
    setLevel(state, 'hunger', 'body:hunger-clock', Math.min(-8, 10 - current),
      `reduced by the meal: ${subject}`, now, 'body_clock');
  } else if (!structuredMeal && deprivation >= 0.35 && /hunger|food|egg|meal|canteen/.test(structural)) {
    addImpulse(state, 'hunger', `${id}:deprivation`, 22 * deprivation,
      `food deprivation in: ${subject}`, now, 'meal_deprivation', 2 * 60 * 60 * 1000);
  }
  // A person being present is not automatically reassuring. Existing cast
  // warmth only relieves social need when the same interaction is not appraised
  // as threatening or controlling.
  recordSocial(state, observation.social, subject, now, id, affiliation, threat, control);
  if (!observation.social && /no_mail|cancel|refus|ignored|alone/.test(structural)) {
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
  // The previous physical fields remain mirrored for old consumers, but they
  // are never imported back into experienced state.
  void legacyPhysical;
  void lastMailMs;
  if (!state.socialClockInitialised) {
    state.socialClockInitialised = true;
  }
  const elapsedMs = Math.max(0, Math.min(24 * 60 * 60 * 1000, now - finite(state.lastTickMs, now)));
  const hours = elapsedMs / 3600000;
  state.lastTickMs = now;
  const sleep = state.body.sleep;
  if (asleep !== sleep.asleep) {
    const transitionAt = asleep ? now - elapsedMs : now;
    recordSleep(state, { outcome: asleep ? 'started' : 'ended' },
      asleep ? 'the sleep period began' : 'the sleep period ended', transitionAt, `sleep-clock:${transitionAt}`);
  }
  if (hours > 0) {
    sleep.fatigueLoad = clamp(sleep.fatigueLoad + (asleep ? -7.5 : 2.2) * hours, 8, 88);
    if (asleep) sleep.totalSleepMs += elapsedMs;
  }
  setLevel(state, 'fatigue', 'body:fatigue-clock', sleep.fatigueLoad - METRICS.fatigue.baseline,
    asleep ? 'fatigue is recovering during recorded sleep' : 'fatigue is accumulating during recorded waking time',
    now, 'body_clock');
  updateHungerClock(state, now);
  const lastSupportiveAtMs = state.body.social.lastSupportiveAtMs;
  const hoursWithoutSupport = Number.isFinite(lastSupportiveAtMs) ? Math.max(0, now - lastSupportiveAtMs) / 3600000 : 0;
  const socialTarget = Number.isFinite(lastSupportiveAtMs)
    ? clamp(20 + 1.3 * hoursWithoutSupport, 20, 74)
    : METRICS.loneliness.baseline;
  setLevel(state, 'loneliness', 'body:social-clock', socialTarget - METRICS.loneliness.baseline,
    Number.isFinite(lastSupportiveAtMs)
      ? 'social need is rising with time since reassuring contact'
      : 'social need is at rest until actual contact is recorded',
    now, 'social_clock');
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
  return {
    version: EXPERIENCED_VERSION,
    updatedAtMs: state.updatedAtMs,
    metrics,
    brain,
    body: {
      nutrition: { ...state.body.nutrition },
      sleep: { ...state.body.sleep },
      social: { ...state.body.social },
    },
  };
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
