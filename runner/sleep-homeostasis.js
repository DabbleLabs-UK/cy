// sleep-homeostasis.js - grounded Process S from the Two-Process model.
//
// Scientific model:
//   wake:  S(t + dt) = 1 - (1 - S(t)) * exp(-dt / tau_w)
//   sleep: S(t + dt) = S(t) * exp(-dt / tau_s)
//
// Process S is homeostatic sleep pressure. It is not subjective fatigue, mood,
// stress, motivation, depression, a circadian signal, or a brain-region value.

export const SLEEP_HOMEOSTASIS_SCHEMA = 'cy.sleep-homeostasis';
export const SLEEP_HOMEOSTASIS_VERSION = 1;
export const SLEEP_HOMEOSTASIS_MODEL_ID = 'borbely-daan-process-s-normalized';
export const SLEEP_HOMEOSTASIS_IMPLEMENTATION_VERSION = 'process-s-normalized-v1';

// LITERATURE PARAMETERS. Do not tune these for appearance.
export const TAU_WAKE_HOURS = 18.18;
export const TAU_SLEEP_HOURS = 4.2;

// Unit conversion only.
export const HOUR_MS = 60 * 60 * 1000;

// ENGINEERING / DISPLAY. This threshold changes only the calibration label.
// It does not affect Process S or any downstream calculation.
export const DISPLAY_CONVERGENCE_WIDTH = 0.05;

// ENGINEERING / STORAGE. These match the existing public 1H/24H/7D graph
// horizon and avoid persisting every five-second runner tick. Transitions are
// always sampled immediately, regardless of this interval.
export const PROCESS_S_HISTORY_INTERVAL_MS = 2 * 60 * 1000;
export const PROCESS_S_HISTORY_RETENTION_MS = 7 * 24 * HOUR_MS;

export const SLEEP_STATES = Object.freeze({
  AWAKE: 'awake',
  ASLEEP: 'asleep',
  UNKNOWN: 'unknown',
});

const validSleepState = (value) => Object.values(SLEEP_STATES).includes(value);
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const clamp01 = (value) => Math.max(0, Math.min(1, finite(value, 0)));
const midpoint = (lo, hi) => (lo + hi) / 2;

export function processSWake(value, elapsedMs) {
  const dtHours = Math.max(0, finite(elapsedMs, 0)) / HOUR_MS;
  const s = clamp01(value);
  return clamp01(1 - (1 - s) * Math.exp(-dtHours / TAU_WAKE_HOURS));
}

export function processSSleep(value, elapsedMs) {
  const dtHours = Math.max(0, finite(elapsedMs, 0)) / HOUR_MS;
  return clamp01(clamp01(value) * Math.exp(-dtHours / TAU_SLEEP_HOURS));
}

export function propagateProcessSRange(sMin, sMax, elapsedMs, sleepState) {
  const lo = Math.min(clamp01(sMin), clamp01(sMax));
  const hi = Math.max(clamp01(sMin), clamp01(sMax));
  if (sleepState === SLEEP_STATES.AWAKE) {
    return { sMin: processSWake(lo, elapsedMs), sMax: processSWake(hi, elapsedMs) };
  }
  if (sleepState === SLEEP_STATES.ASLEEP) {
    return { sMin: processSSleep(lo, elapsedMs), sMax: processSSleep(hi, elapsedMs) };
  }
  // The intervening state is not known. The lower reachable bound is the
  // all-sleep trajectory and the upper reachable bound is the all-wake
  // trajectory. This preserves uncertainty instead of inventing a schedule.
  return { sMin: processSSleep(lo, elapsedMs), sMax: processSWake(hi, elapsedMs) };
}

function historyPoint(state, atMs) {
  return {
    ts: atMs,
    sEstimate: state.sEstimate,
    sMin: state.sMin,
    sMax: state.sMax,
    sleepState: state.currentSleepState,
  };
}

function sampleHistory(state, atMs, force = false) {
  if (!force && Number.isFinite(state.lastHistorySampleMs)
    && atMs - state.lastHistorySampleMs < PROCESS_S_HISTORY_INTERVAL_MS) return;
  if (state.historyBeganAtMs === null) state.historyBeganAtMs = atMs;
  state.history.push(historyPoint(state, atMs));
  const cutoff = atMs - PROCESS_S_HISTORY_RETENTION_MS;
  state.history = state.history.filter((point) => point.ts >= cutoff);
  state.lastHistorySampleMs = atMs;
}

export function createSleepHomeostasis(now = Date.now()) {
  const atMs = finite(now, Date.now());
  return {
    schema: SLEEP_HOMEOSTASIS_SCHEMA,
    version: SLEEP_HOMEOSTASIS_VERSION,
    modelId: SLEEP_HOMEOSTASIS_MODEL_ID,
    modelVersion: SLEEP_HOMEOSTASIS_IMPLEMENTATION_VERSION,
    provenance: { modelSpec: 'config/model-specs/sleep-homeostasis.json' },
    sEstimate: 0.5,
    sMin: 0,
    sMax: 1,
    installedAtMs: atMs,
    lastIntegrationTimestampMs: atMs,
    currentSleepState: SLEEP_STATES.UNKNOWN,
    historyBeganAtMs: null,
    lastHistorySampleMs: null,
    history: [],
    lastInspection: null,
  };
}

function validHistory(raw, installedAtMs) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((point) => point && Number.isFinite(point.ts) && point.ts >= installedAtMs
    && Number.isFinite(point.sEstimate) && Number.isFinite(point.sMin) && Number.isFinite(point.sMax))
    .map((point) => ({
      ts: point.ts,
      sEstimate: clamp01(point.sEstimate),
      sMin: clamp01(point.sMin),
      sMax: clamp01(point.sMax),
      sleepState: validSleepState(point.sleepState) ? point.sleepState : SLEEP_STATES.UNKNOWN,
    }));
}

export function advanceSleepHomeostasis(state, {
  toMs = Date.now(),
  intervalState = state && state.currentSleepState,
  nextState = null,
  source = 'runner-observed-interval',
  forceHistory = false,
} = {}) {
  if (!state || state.schema !== SLEEP_HOMEOSTASIS_SCHEMA) throw new Error('invalid sleep-homeostasis state');
  const atMs = Math.max(finite(state.lastIntegrationTimestampMs, 0), finite(toMs, 0));
  const fromMs = finite(state.lastIntegrationTimestampMs, atMs);
  const elapsedMs = Math.max(0, atMs - fromMs);
  const usedState = validSleepState(intervalState) ? intervalState : SLEEP_STATES.UNKNOWN;
  const before = { sEstimate: state.sEstimate, sMin: state.sMin, sMax: state.sMax };
  const after = propagateProcessSRange(state.sMin, state.sMax, elapsedMs, usedState);
  state.sMin = after.sMin;
  state.sMax = after.sMax;
  state.sEstimate = midpoint(after.sMin, after.sMax);
  state.lastIntegrationTimestampMs = atMs;
  if (validSleepState(nextState)) state.currentSleepState = nextState;
  state.lastInspection = {
    currentState: state.currentSleepState,
    intervalState: usedState,
    intervalStartedAtMs: fromMs,
    intervalEndedAtMs: atMs,
    elapsedIntervalMs: elapsedMs,
    processSBefore: before,
    processSAfter: { sEstimate: state.sEstimate, sMin: state.sMin, sMax: state.sMax },
    model: 'Borbely/Daan Two-Process Process S',
    modelId: SLEEP_HOMEOSTASIS_MODEL_ID,
    tauWakeHours: TAU_WAKE_HOURS,
    tauSleepHours: TAU_SLEEP_HOURS,
    parameterProvenance: 'LITERATURE',
    source,
  };
  sampleHistory(state, atMs, forceHistory || elapsedMs === 0 || state.history.length === 0);
  return state;
}

export function observeSleepState(state, sleepState, {
  now = Date.now(),
  source = 'structured-environment-record',
} = {}) {
  if (!validSleepState(sleepState) || sleepState === SLEEP_STATES.UNKNOWN) return state;
  const prior = validSleepState(state.currentSleepState) ? state.currentSleepState : SLEEP_STATES.UNKNOWN;
  return advanceSleepHomeostasis(state, {
    toMs: now,
    intervalState: prior,
    nextState: sleepState,
    source,
    forceHistory: prior !== sleepState,
  });
}

export function tickSleepHomeostasis(state, { now = Date.now(), asleep = null } = {}) {
  const observed = asleep === true ? SLEEP_STATES.ASLEEP
    : asleep === false ? SLEEP_STATES.AWAKE
      : SLEEP_STATES.UNKNOWN;
  const prior = validSleepState(state.currentSleepState) ? state.currentSleepState : SLEEP_STATES.UNKNOWN;
  return advanceSleepHomeostasis(state, {
    toMs: now,
    intervalState: prior,
    nextState: observed === SLEEP_STATES.UNKNOWN ? prior : observed,
    source: 'runner-observed-sleep-state',
    forceHistory: observed !== SLEEP_STATES.UNKNOWN && observed !== prior,
  });
}

export function sleepStateFromSomaInput(input) {
  if (!input || input.schema !== 'cy.soma-input') return null;
  if (input.sleep_interruption === 'present' || input.sleep_period === 'interrupted') {
    return SLEEP_STATES.AWAKE;
  }
  if (['sleep_period', 'asleep', 'sleep'].includes(input.sleep_period)) return SLEEP_STATES.ASLEEP;
  if (['awake', 'waking', 'forced_wakefulness'].includes(input.sleep_period)) return SLEEP_STATES.AWAKE;
  return null;
}

export function reconcileSleepHomeostasis(raw, {
  now = Date.now(),
  knownStateDuringGap = null,
} = {}) {
  const atMs = finite(now, Date.now());
  if (!raw || typeof raw !== 'object' || raw.schema !== SLEEP_HOMEOSTASIS_SCHEMA
    || raw.version !== SLEEP_HOMEOSTASIS_VERSION || raw.modelId !== SLEEP_HOMEOSTASIS_MODEL_ID) {
    return createSleepHomeostasis(atMs);
  }
  const installedAtMs = finite(raw.installedAtMs, atMs);
  const lo = clamp01(raw.sMin);
  const hi = clamp01(raw.sMax);
  const state = {
    ...createSleepHomeostasis(installedAtMs),
    sMin: Math.min(lo, hi),
    sMax: Math.max(lo, hi),
    installedAtMs,
    lastIntegrationTimestampMs: finite(raw.lastIntegrationTimestampMs, atMs),
    currentSleepState: validSleepState(raw.currentSleepState) ? raw.currentSleepState : SLEEP_STATES.UNKNOWN,
    historyBeganAtMs: Number.isFinite(raw.historyBeganAtMs) ? raw.historyBeganAtMs : null,
    lastHistorySampleMs: Number.isFinite(raw.lastHistorySampleMs) ? raw.lastHistorySampleMs : null,
    history: validHistory(raw.history, installedAtMs),
    lastInspection: raw.lastInspection && typeof raw.lastInspection === 'object' ? { ...raw.lastInspection } : null,
  };
  state.sEstimate = midpoint(state.sMin, state.sMax);
  if (atMs > state.lastIntegrationTimestampMs) {
    const gapState = validSleepState(knownStateDuringGap) ? knownStateDuringGap : SLEEP_STATES.UNKNOWN;
    advanceSleepHomeostasis(state, {
      toMs: atMs,
      intervalState: gapState,
      nextState: gapState === SLEEP_STATES.UNKNOWN ? SLEEP_STATES.UNKNOWN : gapState,
      source: gapState === SLEEP_STATES.UNKNOWN ? 'restart-gap-state-unknown' : 'restart-gap-state-known',
    });
  }
  return state;
}

export function sleepHomeostasisSnapshot(state) {
  if (!state) return null;
  const width = Math.max(0, state.sMax - state.sMin);
  return {
    status: 'implemented',
    publicLabel: 'LIVE',
    modelId: state.modelId,
    modelVersion: state.modelVersion,
    sleepPressure: state.sEstimate,
    sleepPressureIndex: Math.round(100 * state.sEstimate),
    sMin: state.sMin,
    sMax: state.sMax,
    uncertaintyWidth: width,
    calibrating: width > DISPLAY_CONVERGENCE_WIDTH,
    displayConvergenceWidth: DISPLAY_CONVERGENCE_WIDTH,
    currentSleepState: state.currentSleepState,
    installedAtMs: state.installedAtMs,
    lastIntegrationTimestampMs: state.lastIntegrationTimestampMs,
    historyBeganAtMs: state.historyBeganAtMs,
    provenance: { ...state.provenance },
    inspection: state.lastInspection ? { ...state.lastInspection } : null,
    circadianComponent: { status: 'not_implemented', publicLabel: 'NOT MODELLED' },
  };
}

export function sleepHomeostasisHistory(state) {
  return validHistory(state && state.history, finite(state && state.installedAtMs, 0));
}
