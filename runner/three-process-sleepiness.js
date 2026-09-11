// Predicted sleepiness from the Three-Process Model (TPM).
//
// This is the published S_B + C + U model selected in Ingre et al. (2014).
// It predicts Karolinska Sleepiness Scale (KSS) ratings from observed sleep-
// wake timing and population-default phase. It is not general fatigue and it
// does not reuse Cy's separate normalized Process S or Process C states.

export const TPM_SCHEMA = 'cy.three-process-sleepiness';
export const TPM_VERSION = 1;
export const TPM_MODEL_ID = 'ingre-akerstedt-three-process-sb-c-u';
export const TPM_IMPLEMENTATION_VERSION = 'tpm-predicted-kss-v1';

// LITERATURE PARAMETERS. Do not tune for appearance.
export const TPM_HA = 14.3;
export const TPM_LA = 2.4;
export const TPM_D_PER_HOUR = -0.0353;
export const TPM_BL = 12.2;
export const TPM_G_PER_HOUR = Math.log((TPM_HA - 14.0) / (TPM_HA - 7.96)) / 8;
export const TPM_C_M = 0;
export const TPM_C_A = 2.5;
export const TPM_PHASE_HOURS = 16.8;
export const TPM_U_M = -0.5;
export const TPM_U_A = 0.5;
export const TPM_KSS_INTERCEPT = 9.68;
export const TPM_KSS_SLOPE = -0.46;
export const TPM_RESIDUAL_SD_KSS = 1.42;
export const TPM_BETWEEN_SUBJECT_INTERCEPT_SD_KSS = 0.84;
export const TPM_INITIAL_ALERTNESS = 8.38;

// ENGINEERING / STORAGE ONLY.
export const TPM_HISTORY_INTERVAL_MS = 2 * 60 * 1000;
export const TPM_HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export const TPM_SLEEP_STATES = Object.freeze({
  AWAKE: 'awake',
  ASLEEP: 'asleep',
  UNKNOWN: 'unknown',
});

const HOUR_MS = 60 * 60 * 1000;
const finite = (value, fallback = null) => Number.isFinite(value) ? value : fallback;
const validState = (value) => Object.values(TPM_SLEEP_STATES).includes(value);

export function tpmClockHours(atMs, timeZone = 'Europe/London') {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour12: false,
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(atMs)).map((part) => [part.type, part.value]));
  return (+parts.hour % 24) + (+parts.minute / 60) + (+parts.second / 3600)
    + (new Date(atMs).getMilliseconds() / 3600000);
}

export function tpmCircadian(clockHours) {
  return TPM_C_M + TPM_C_A * Math.cos((2 * Math.PI / 24) * (clockHours - TPM_PHASE_HOURS));
}

export function tpmUltradian(clockHours) {
  return TPM_U_M + TPM_U_A * Math.cos((2 * Math.PI / 12) * (clockHours - TPM_PHASE_HOURS - 3));
}

export function tpmWake(sWakeStart, elapsedMs) {
  const hours = Math.max(0, finite(elapsedMs, 0)) / HOUR_MS;
  return TPM_LA + (sWakeStart - TPM_LA) * Math.exp(TPM_D_PER_HOUR * hours);
}

export function tpmSleepBrake(sSleepStart, elapsedMs) {
  const hours = Math.max(0, finite(elapsedMs, 0)) / HOUR_MS;
  const brakeTimeHours = (TPM_BL - sSleepStart) / (TPM_G_PER_HOUR * (TPM_BL - TPM_HA));
  const linear = sSleepStart + hours * TPM_G_PER_HOUR * (TPM_BL - TPM_HA);
  const exponential = TPM_HA - (TPM_HA - TPM_BL)
    * Math.exp(TPM_G_PER_HOUR * (hours - brakeTimeHours));
  return {
    value: hours <= brakeTimeHours ? linear : exponential,
    brakeTimeHours,
    branch: hours <= brakeTimeHours ? 'linear_brake' : 'exponential_sleep',
  };
}

export function tpmOriginalSleep(sSleepStart, elapsedMs) {
  const hours = Math.max(0, finite(elapsedMs, 0)) / HOUR_MS;
  return TPM_HA - (TPM_HA - sSleepStart) * Math.exp(TPM_G_PER_HOUR * hours);
}

export function tpmKssFromAlertness(alertness) {
  return TPM_KSS_INTERCEPT + TPM_KSS_SLOPE * alertness;
}

export function tpmKssAnchor(value) {
  const anchors = [
    'extremely alert', 'very alert', 'alert', 'rather alert',
    'neither alert nor sleepy', 'some signs of sleepiness',
    'sleepy, but no effort to keep awake',
    'sleepy, some effort to keep awake',
    'very sleepy, great effort to keep awake, fighting sleep',
  ];
  if (!Number.isFinite(value)) return null;
  const index = Math.max(1, Math.min(9, Math.round(value)));
  return { kss: index, description: anchors[index - 1] };
}

export function tpmKssRegion(value) {
  const anchors = [
    'extremely alert', 'very alert', 'alert', 'rather alert',
    'neither alert nor sleepy', 'some signs of sleepiness',
    'sleepy, but no effort to keep awake',
    'sleepy, some effort to keep awake',
    'very sleepy, great effort to keep awake, fighting sleep',
  ];
  if (!Number.isFinite(value)) return null;
  if (value < 1 || value > 9) return {
    kind: 'outside_nominal_range',
    description: `outside the nominal KSS range (${value < 1 ? 'below 1' : 'above 9'})`,
  };
  const lower = Math.floor(value);
  const upper = Math.ceil(value);
  if (lower === upper) return { kind: 'anchor', lower, upper, description: anchors[lower - 1] };
  return {
    kind: 'between', lower, upper,
    description: `between "${anchors[lower - 1]}" and "${anchors[upper - 1]}"`,
  };
}

function status(state) {
  return state.continuityKnown && state.completeObservedSleepEpisodes >= 2
    && Number.isFinite(state.sBAtIntervalStart)
    ? 'LIVE' : 'CALIBRATING';
}

function componentsAt(state, atMs) {
  if (!Number.isFinite(state.sBAtIntervalStart) || !Number.isFinite(state.intervalStartedAtMs)
    || ![TPM_SLEEP_STATES.AWAKE, TPM_SLEEP_STATES.ASLEEP].includes(state.currentSleepState)) return null;
  const elapsedMs = Math.max(0, atMs - state.intervalStartedAtMs);
  const sleep = state.currentSleepState === TPM_SLEEP_STATES.ASLEEP
    ? tpmSleepBrake(state.sBAtIntervalStart, elapsedMs) : null;
  const sB = sleep ? sleep.value : tpmWake(state.sBAtIntervalStart, elapsedMs);
  const clockHours = tpmClockHours(atMs, state.timeZone);
  const c = tpmCircadian(clockHours);
  const u = tpmUltradian(clockHours);
  const alertness = sB + c + u;
  const predictedKss = tpmKssFromAlertness(alertness);
  return {
    atMs, elapsedMs, clockHours, sB, c, u, alertness, predictedKss,
    sleepBranch: sleep && sleep.branch,
    brakeTimeHours: sleep && sleep.brakeTimeHours,
  };
}

function sample(state, atMs, force = false) {
  if (status(state) !== 'LIVE') return;
  if (!force && Number.isFinite(state.lastHistorySampleMs)
    && atMs - state.lastHistorySampleMs < TPM_HISTORY_INTERVAL_MS) return;
  const value = componentsAt(state, atMs);
  if (!value) return;
  state.history.push({ ts: atMs, predictedKss: value.predictedKss });
  state.history = state.history.filter((point) => point.ts >= atMs - TPM_HISTORY_RETENTION_MS);
  state.lastHistorySampleMs = atMs;
  if (state.historyBeganAtMs === null) state.historyBeganAtMs = atMs;
}

export function createThreeProcessSleepiness(now = Date.now(), timeZone = 'Europe/London') {
  return {
    schema: TPM_SCHEMA,
    version: TPM_VERSION,
    modelId: TPM_MODEL_ID,
    modelVersion: TPM_IMPLEMENTATION_VERSION,
    provenance: { modelSpec: 'config/model-specs/three-process-sleepiness.json' },
    timeZone,
    currentSleepState: TPM_SLEEP_STATES.UNKNOWN,
    continuityKnown: false,
    intervalStartedAtMs: null,
    sBAtIntervalStart: null,
    initialObservedSleepAtMs: null,
    completeObservedSleepEpisodes: 0,
    lastObservedAtMs: null,
    historyBeganAtMs: null,
    lastHistorySampleMs: null,
    history: [],
    lastInspection: null,
    installedAtMs: finite(now, Date.now()),
  };
}

export function reconcileThreeProcessSleepiness(raw, { now = Date.now(), timeZone = 'Europe/London' } = {}) {
  if (!raw || raw.schema !== TPM_SCHEMA || raw.version !== TPM_VERSION || raw.modelId !== TPM_MODEL_ID) {
    return createThreeProcessSleepiness(now, timeZone);
  }
  const out = {
    ...createThreeProcessSleepiness(finite(raw.installedAtMs, now), timeZone),
    ...raw,
    timeZone: String(raw.timeZone || timeZone),
    currentSleepState: validState(raw.currentSleepState) ? raw.currentSleepState : TPM_SLEEP_STATES.UNKNOWN,
    continuityKnown: !!raw.continuityKnown,
    completeObservedSleepEpisodes: Math.max(0, Math.floor(finite(raw.completeObservedSleepEpisodes, 0))),
    history: Array.isArray(raw.history) ? raw.history.filter((point) => point
      && Number.isFinite(point.ts) && Number.isFinite(point.predictedKss)) : [],
  };
  return out;
}

export function resetThreeProcessSleepiness(state, now = Date.now()) {
  Object.assign(state, createThreeProcessSleepiness(now, state.timeZone));
  return state;
}

export function observeThreeProcessSleepState(state, nextState, {
  now = Date.now(), source = 'structured-environment-record',
} = {}) {
  if (!state || ![TPM_SLEEP_STATES.AWAKE, TPM_SLEEP_STATES.ASLEEP].includes(nextState)) return state;
  if (Number.isFinite(state.lastObservedAtMs) && now < state.lastObservedAtMs) return state;
  const prior = state.currentSleepState;
  if (prior === nextState) {
    state.lastObservedAtMs = now;
    return tickThreeProcessSleepiness(state, { now, source });
  }
  let before = componentsAt(state, now);
  if (nextState === TPM_SLEEP_STATES.ASLEEP && !Number.isFinite(state.sBAtIntervalStart)) {
    const clockHours = tpmClockHours(now, state.timeZone);
    state.sBAtIntervalStart = TPM_INITIAL_ALERTNESS - tpmCircadian(clockHours) - tpmUltradian(clockHours);
    state.initialObservedSleepAtMs = now;
    state.continuityKnown = true;
    before = null;
  } else if (before) {
    state.sBAtIntervalStart = before.sB;
  }
  if (prior === TPM_SLEEP_STATES.ASLEEP && nextState === TPM_SLEEP_STATES.AWAKE
    && state.continuityKnown && Number.isFinite(state.sBAtIntervalStart)) {
    state.completeObservedSleepEpisodes += 1;
  }
  if (!Number.isFinite(state.sBAtIntervalStart)) state.continuityKnown = false;
  state.currentSleepState = nextState;
  state.intervalStartedAtMs = now;
  state.lastObservedAtMs = now;
  state.lastInspection = { transitionFrom: prior, transitionTo: nextState, atMs: now, source };
  sample(state, now, true);
  return tickThreeProcessSleepiness(state, { now, source });
}

export function markThreeProcessContinuityUnknown(state, { now = Date.now(), source = 'unknown-interval' } = {}) {
  state.currentSleepState = TPM_SLEEP_STATES.UNKNOWN;
  state.continuityKnown = false;
  state.intervalStartedAtMs = null;
  state.sBAtIntervalStart = null;
  state.completeObservedSleepEpisodes = 0;
  state.lastObservedAtMs = now;
  state.lastInspection = { atMs: now, source, continuityKnown: false };
  return state;
}

export function tickThreeProcessSleepiness(state, { now = Date.now(), source = 'runner-clock' } = {}) {
  const values = componentsAt(state, now);
  state.lastInspection = {
    ...(state.lastInspection || {}), source, atMs: now,
    currentSleepState: state.currentSleepState,
    completeObservedSleepEpisodes: state.completeObservedSleepEpisodes,
    continuityKnown: state.continuityKnown,
    values,
  };
  sample(state, now);
  return state;
}

export function replayObservedSleepRecords(state, records, { now = Date.now() } = {}) {
  resetThreeProcessSleepiness(state, now);
  const sorted = (Array.isArray(records) ? records : []).map((record) => {
    const input = record && (record.soma_input || record.somaInput);
    const timestamp = record && (record.occurred_at || record.timestamp
      || (record.world_event && record.world_event.timestamp));
    const atMs = Number.isFinite(record && record.occurred_at_ms)
      ? record.occurred_at_ms : Date.parse(String(timestamp || ''));
    let sleepState = null;
    if (input && (input.sleep_interruption === 'present' || input.sleep_period === 'interrupted')) sleepState = TPM_SLEEP_STATES.AWAKE;
    else if (input && ['sleep_period', 'asleep', 'sleep'].includes(input.sleep_period)) sleepState = TPM_SLEEP_STATES.ASLEEP;
    else if (input && ['awake', 'waking', 'forced_wakefulness'].includes(input.sleep_period)) sleepState = TPM_SLEEP_STATES.AWAKE;
    return { atMs, sleepState, id: record && (record.event_id || (record.world_event && record.world_event.id)) };
  }).filter((item) => Number.isFinite(item.atMs) && item.sleepState)
    .sort((a, b) => a.atMs - b.atMs);
  for (const item of sorted) {
    observeThreeProcessSleepState(state, item.sleepState, {
      now: item.atMs, source: `structured-history:${item.id || 'unknown'}`,
    });
  }
  if (sorted.length) tickThreeProcessSleepiness(state, { now, source: 'structured-history-replay' });
  return state;
}

export function threeProcessSleepinessSnapshot(state, now = Date.now()) {
  if (!state) return null;
  const values = componentsAt(state, now);
  const publicStatus = status(state);
  return {
    status: publicStatus === 'LIVE' ? 'implemented' : 'calibrating',
    publicLabel: publicStatus,
    modelId: state.modelId,
    modelVersion: state.modelVersion,
    phaseBasis: 'POPULATION_DEFAULT_PHASE',
    predictedKss: publicStatus === 'LIVE' && values ? values.predictedKss : null,
    rawPredictedKss: values ? values.predictedKss : null,
    kssAnchor: publicStatus === 'LIVE' && values ? tpmKssAnchor(values.predictedKss) : null,
    kssRegion: publicStatus === 'LIVE' && values ? tpmKssRegion(values.predictedKss) : null,
    outsideNominalKssRange: publicStatus === 'LIVE' && values
      ? values.predictedKss < 1 || values.predictedKss > 9 : false,
    completeObservedSleepEpisodes: state.completeObservedSleepEpisodes,
    requiredCompleteObservedSleepEpisodes: 2,
    currentObservedSleepState: state.currentSleepState,
    continuityKnown: state.continuityKnown,
    historyBeganAtMs: state.historyBeganAtMs,
    residualSdKss: TPM_RESIDUAL_SD_KSS,
    betweenSubjectInterceptSdKss: TPM_BETWEEN_SUBJECT_INTERCEPT_SD_KSS,
    provenance: { ...state.provenance },
    components: values ? {
      tpmSB: values.sB,
      tpmC: values.c,
      tpmU: values.u,
      alertness: values.alertness,
      clockHours: values.clockHours,
      elapsedIntervalMs: values.elapsedMs,
      timeAwakeMs: state.currentSleepState === TPM_SLEEP_STATES.AWAKE ? values.elapsedMs : 0,
      firstHourAfterWaking: state.currentSleepState === TPM_SLEEP_STATES.AWAKE
        && values.elapsedMs < HOUR_MS,
      sleepBranch: values.sleepBranch,
      brakeTimeHours: values.brakeTimeHours,
    } : null,
    inspection: state.lastInspection ? { ...state.lastInspection } : null,
    exclusions: {
      processW: 'NOT USED',
      generalFatigue: 'NOT MODELLED',
      sleepInertia: 'NOT MODELLED',
      brainActivation: 'NOT MODELLED',
    },
  };
}

export function threeProcessSleepinessHistory(state) {
  return Array.isArray(state && state.history) ? state.history.map((point) => ({ ...point })) : [];
}
