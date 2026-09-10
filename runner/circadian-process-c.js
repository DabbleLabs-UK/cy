// circadian-process-c.js - published five-harmonic Process C waveform.
//
// Process C is a circadian component of sleep/wake regulation. It is not
// subjective fatigue, energy, mood, melatonin, core body temperature, SCN
// firing, or generic brain activity. The waveform is published; Cy's phase is
// not observed and is represented as a schedule-estimated circular interval.

export const CIRCADIAN_PROCESS_C_SCHEMA = 'cy.circadian-process-c';
export const CIRCADIAN_PROCESS_C_VERSION = 1;
export const CIRCADIAN_PROCESS_C_MODEL_ID = 'borbely-achermann-process-c-five-harmonic';
export const CIRCADIAN_PROCESS_C_IMPLEMENTATION_VERSION = 'process-c-schedule-estimated-v1';

// LITERATURE. These are the published harmonic coefficients and period.
export const PROCESS_C_PERIOD_HOURS = 24;
export const PROCESS_C_HARMONICS = Object.freeze([0.97, 0.22, 0.07, 0.03, 0.001]);

// SCHEDULE-BASED ESTIMATE. CBTmin is represented as an interval two to three
// hours before habitual wake, never as a directly observed biomarker.
export const CBTMIN_EARLIEST_BEFORE_WAKE_HOURS = 3;
export const CBTMIN_LATEST_BEFORE_WAKE_HOURS = 2;

// ENGINEERING / NUMERICAL. These only control deterministic root finding.
// They do not change the waveform, phase estimate, or any downstream state.
export const EXTREMUM_SCAN_STEPS = 4096;
export const PHASE_RANGE_SCAN_STEPS = 256;
export const ROOT_BISECTION_ITERATIONS = 80;
export const ROOT_DEDUPLICATION_HOURS = 1e-10;

// ENGINEERING / STORAGE. Same cadence and horizon as the existing 1H/24H/7D
// detail graphs. Evaluated history begins at installation and is never backfilled.
export const HOUR_MS = 60 * 60 * 1000;
export const PROCESS_C_HISTORY_INTERVAL_MS = 2 * 60 * 1000;
export const PROCESS_C_HISTORY_RETENTION_MS = 7 * 24 * HOUR_MS;

const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;

export function normalizeCircadianHour(value) {
  const hours = finite(value, 0) % PROCESS_C_PERIOD_HOURS;
  return hours < 0 ? hours + PROCESS_C_PERIOD_HOURS : hours;
}

export function circularInterval(startHour, durationHours) {
  const start = normalizeCircadianHour(startHour);
  const duration = Math.max(0, Math.min(PROCESS_C_PERIOD_HOURS, finite(durationHours, 0)));
  const end = normalizeCircadianHour(start + duration);
  return {
    startHour: start,
    endHour: end,
    durationHours: duration,
    midpointHour: normalizeCircadianHour(start + duration / 2),
    wrapsMidnight: duration > 0 && start + duration >= PROCESS_C_PERIOD_HOURS,
  };
}

export function processC(clockHours, phiHours, harmonics = PROCESS_C_HARMONICS) {
  const phase = 2 * Math.PI * (finite(clockHours, 0) - finite(phiHours, 0)) / PROCESS_C_PERIOD_HOURS;
  return harmonics.reduce((sum, coefficient, index) => (
    sum + coefficient * Math.sin((index + 1) * phase)
  ), 0);
}

export function processCDerivative(clockHours, phiHours, harmonics = PROCESS_C_HARMONICS) {
  const phase = 2 * Math.PI * (finite(clockHours, 0) - finite(phiHours, 0)) / PROCESS_C_PERIOD_HOURS;
  return harmonics.reduce((sum, coefficient, index) => {
    const harmonic = index + 1;
    return sum + coefficient * (2 * Math.PI * harmonic / PROCESS_C_PERIOD_HOURS)
      * Math.cos(harmonic * phase);
  }, 0);
}

function bisectRoot(fn, left, right) {
  let lo = left;
  let hi = right;
  let flo = fn(lo);
  if (flo === 0) return lo;
  for (let iteration = 0; iteration < ROOT_BISECTION_ITERATIONS; iteration++) {
    const mid = (lo + hi) / 2;
    const fmid = fn(mid);
    if (fmid === 0) return mid;
    if (Math.sign(flo) === Math.sign(fmid)) {
      lo = mid;
      flo = fmid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

function stationaryPoints(start, width, steps, derivative) {
  const roots = [];
  let left = start;
  let fleft = derivative(left);
  for (let index = 1; index <= steps; index++) {
    const right = start + width * index / steps;
    const fright = derivative(right);
    if (fleft === 0) roots.push(left);
    if (fright === 0) roots.push(right);
    if (Math.sign(fleft) !== Math.sign(fright) && fleft !== 0 && fright !== 0) {
      roots.push(bisectRoot(derivative, left, right));
    }
    left = right;
    fleft = fright;
  }
  return roots.filter((value, index, values) => (
    index === 0 || Math.abs(value - values[index - 1]) > ROOT_DEDUPLICATION_HOURS
  ));
}

export function deriveProcessCExtrema() {
  const roots = stationaryPoints(
    0,
    PROCESS_C_PERIOD_HOURS,
    EXTREMUM_SCAN_STEPS,
    (offset) => processCDerivative(offset, 0),
  );
  const candidates = [0, PROCESS_C_PERIOD_HOURS, ...roots]
    .map((offsetHours) => ({ offsetHours: normalizeCircadianHour(offsetHours), value: processC(offsetHours, 0) }));
  const minimum = candidates.reduce((best, candidate) => candidate.value < best.value ? candidate : best);
  const maximum = candidates.reduce((best, candidate) => candidate.value > best.value ? candidate : best);
  return { minimum, maximum, stationaryPoints: roots.map(normalizeCircadianHour) };
}

export const PROCESS_C_EXTREMA = Object.freeze(deriveProcessCExtrema());
export const PROCESS_C_MINIMUM_OFFSET_HOURS = PROCESS_C_EXTREMA.minimum.offsetHours;

export function deriveSchedulePhase(habitualWakeMinutes) {
  if (!Number.isFinite(habitualWakeMinutes)) throw new Error('habitual wake minutes are required');
  const wakeHour = normalizeCircadianHour(habitualWakeMinutes / 60);
  const cbtmin = circularInterval(
    wakeHour - CBTMIN_EARLIEST_BEFORE_WAKE_HOURS,
    CBTMIN_EARLIEST_BEFORE_WAKE_HOURS - CBTMIN_LATEST_BEFORE_WAKE_HOURS,
  );
  const phi = circularInterval(
    cbtmin.startHour - PROCESS_C_MINIMUM_OFFSET_HOURS,
    cbtmin.durationHours,
  );
  return { wakeHour, cbtmin, phi };
}

export function processCRangeAcrossPhase(clockHours, phiInterval) {
  if (!phiInterval || !Number.isFinite(phiInterval.startHour) || !Number.isFinite(phiInterval.durationHours)) {
    throw new Error('valid circular phase interval required');
  }
  const start = phiInterval.startHour;
  const width = phiInterval.durationHours;
  const roots = stationaryPoints(
    start,
    width,
    PHASE_RANGE_SCAN_STEPS,
    (phi) => processCDerivative(clockHours, phi),
  );
  const values = [start, start + width, ...roots].map((phi) => processC(clockHours, phi));
  return { minimum: Math.min(...values), maximum: Math.max(...values) };
}

export function clockHoursInTimeZone(atMs, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(atMs)).map((part) => [part.type, part.value]));
  return Number(parts.hour) + Number(parts.minute) / 60 + Number(parts.second) / 3600
    + (atMs % 1000) / HOUR_MS;
}

function scheduleMetadata(habitualWakeMinutes, timeZone) {
  const derived = deriveSchedulePhase(habitualWakeMinutes);
  return {
    phaseBasis: 'habitual_schedule_estimate',
    directBiologicalPhaseObserved: false,
    schedule: {
      source: 'configured_prison_regime',
      timeZone,
      habitualWakeMinutes,
      habitualWakeHour: derived.wakeHour,
    },
    estimatedCbtmin: {
      ...derived.cbtmin,
      basis: 'habitual wake minus 3 to 2 hours',
      classification: 'SCHEDULE-BASED ESTIMATE',
    },
    phiInterval: {
      ...derived.phi,
      alignment: 'waveform minimum placed within estimated CBTmin interval',
      classification: 'DERIVED MATHEMATICALLY',
    },
  };
}

function historyPoint(state, atMs) {
  return {
    ts: atMs,
    processCEstimate: state.processCEstimate,
    processCMin: state.processCMin,
    processCMax: state.processCMax,
    clockHours: state.clockHours,
    phaseBasis: state.phaseBasis,
  };
}

function sampleHistory(state, atMs, force = false) {
  if (!force && Number.isFinite(state.lastHistorySampleMs)
    && atMs - state.lastHistorySampleMs < PROCESS_C_HISTORY_INTERVAL_MS) return;
  if (state.historyBeganAtMs === null) state.historyBeganAtMs = atMs;
  state.history.push(historyPoint(state, atMs));
  const cutoff = atMs - PROCESS_C_HISTORY_RETENTION_MS;
  state.history = state.history.filter((point) => point.ts >= cutoff);
  state.lastHistorySampleMs = atMs;
}

function evaluateAt(state, atMs, forceHistory = false) {
  const clockHours = clockHoursInTimeZone(atMs, state.schedule.timeZone);
  const estimate = processC(clockHours, state.phiInterval.midpointHour);
  const range = processCRangeAcrossPhase(clockHours, state.phiInterval);
  state.clockHours = clockHours;
  state.processCEstimate = estimate;
  state.processCMin = range.minimum;
  state.processCMax = range.maximum;
  state.circadianPhasePositionHours = normalizeCircadianHour(clockHours - state.phiInterval.midpointHour);
  state.lastEvaluatedTimestampMs = atMs;
  state.lastInspection = {
    model: 'Borbely/Achermann five-harmonic Process C',
    modelId: CIRCADIAN_PROCESS_C_MODEL_ID,
    clockHours,
    habitualWakeHour: state.schedule.habitualWakeHour,
    phaseBasis: state.phaseBasis,
    estimatedCbtmin: { ...state.estimatedCbtmin },
    derivedPhi: { ...state.phiInterval },
    waveformMinimumOffsetHours: PROCESS_C_MINIMUM_OFFSET_HOURS,
    harmonics: [...PROCESS_C_HARMONICS],
    periodHours: PROCESS_C_PERIOD_HOURS,
    processCEstimate: estimate,
    processCRange: { minimum: range.minimum, maximum: range.maximum },
    entrainment: 'NOT MODELLED',
    freeRunningPhaseDrift: 'NOT MODELLED',
  };
  sampleHistory(state, atMs, forceHistory || state.history.length === 0);
  return state;
}

export function createCircadianProcessC({
  now = Date.now(),
  habitualWakeMinutes,
  timeZone = 'Europe/London',
} = {}) {
  const atMs = finite(now, Date.now());
  const schedule = scheduleMetadata(habitualWakeMinutes, timeZone);
  const state = {
    schema: CIRCADIAN_PROCESS_C_SCHEMA,
    version: CIRCADIAN_PROCESS_C_VERSION,
    modelId: CIRCADIAN_PROCESS_C_MODEL_ID,
    modelVersion: CIRCADIAN_PROCESS_C_IMPLEMENTATION_VERSION,
    provenance: { modelSpec: 'config/model-specs/circadian-process-c.json' },
    ...schedule,
    waveformMinimumOffsetHours: PROCESS_C_MINIMUM_OFFSET_HOURS,
    processCEstimate: 0,
    processCMin: 0,
    processCMax: 0,
    clockHours: 0,
    circadianPhasePositionHours: 0,
    installedAtMs: atMs,
    lastEvaluatedTimestampMs: atMs,
    historyBeganAtMs: null,
    lastHistorySampleMs: null,
    history: [],
    lastInspection: null,
  };
  return evaluateAt(state, atMs, true);
}

function validHistory(raw, installedAtMs) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((point) => point && Number.isFinite(point.ts) && point.ts >= installedAtMs
    && Number.isFinite(point.processCEstimate) && Number.isFinite(point.processCMin)
    && Number.isFinite(point.processCMax) && Number.isFinite(point.clockHours))
    .map((point) => ({
      ts: point.ts,
      processCEstimate: point.processCEstimate,
      processCMin: point.processCMin,
      processCMax: point.processCMax,
      clockHours: normalizeCircadianHour(point.clockHours),
      phaseBasis: 'habitual_schedule_estimate',
    }));
}

export function reconcileCircadianProcessC(raw, options = {}) {
  const atMs = finite(options.now, Date.now());
  const habitualWakeMinutes = options.habitualWakeMinutes;
  const timeZone = options.timeZone || 'Europe/London';
  if (!raw || raw.schema !== CIRCADIAN_PROCESS_C_SCHEMA || raw.version !== CIRCADIAN_PROCESS_C_VERSION
    || raw.modelId !== CIRCADIAN_PROCESS_C_MODEL_ID) {
    return createCircadianProcessC({ now: atMs, habitualWakeMinutes, timeZone });
  }
  const installedAtMs = finite(raw.installedAtMs, atMs);
  const state = {
    ...createCircadianProcessC({ now: installedAtMs, habitualWakeMinutes, timeZone }),
    installedAtMs,
    historyBeganAtMs: Number.isFinite(raw.historyBeganAtMs) ? raw.historyBeganAtMs : null,
    lastHistorySampleMs: Number.isFinite(raw.lastHistorySampleMs) ? raw.lastHistorySampleMs : null,
    history: validHistory(raw.history, installedAtMs),
  };
  // The configured prison regime is the explicit entrainment assumption. A
  // one-off observed waking never enters this function and cannot move phase.
  Object.assign(state, scheduleMetadata(habitualWakeMinutes, timeZone));
  return evaluateAt(state, atMs, false);
}

export function tickCircadianProcessC(state, {
  now = Date.now(),
  habitualWakeMinutes = state && state.schedule && state.schedule.habitualWakeMinutes,
  timeZone = state && state.schedule && state.schedule.timeZone,
} = {}) {
  if (!state || state.schema !== CIRCADIAN_PROCESS_C_SCHEMA) throw new Error('invalid circadian Process C state');
  const scheduleChanged = habitualWakeMinutes !== state.schedule.habitualWakeMinutes || timeZone !== state.schedule.timeZone;
  if (scheduleChanged) Object.assign(state, scheduleMetadata(habitualWakeMinutes, timeZone));
  return evaluateAt(state, finite(now, Date.now()), scheduleChanged);
}

export function circadianProcessCSnapshot(state) {
  if (!state) return null;
  return {
    status: 'implemented',
    publicLabel: 'LIVE',
    modelId: state.modelId,
    modelVersion: state.modelVersion,
    modelName: 'Borbely/Achermann five-harmonic Process C',
    periodHours: PROCESS_C_PERIOD_HOURS,
    harmonics: [...PROCESS_C_HARMONICS],
    processCEstimate: state.processCEstimate,
    processCMin: state.processCMin,
    processCMax: state.processCMax,
    clockHours: state.clockHours,
    circadianPhasePositionHours: state.circadianPhasePositionHours,
    phaseBasis: state.phaseBasis,
    directBiologicalPhaseObserved: false,
    schedule: { ...state.schedule },
    estimatedCbtmin: { ...state.estimatedCbtmin },
    phiInterval: { ...state.phiInterval },
    waveformMinimumOffsetHours: state.waveformMinimumOffsetHours,
    waveformRange: {
      minimum: PROCESS_C_EXTREMA.minimum.value,
      maximum: PROCESS_C_EXTREMA.maximum.value,
    },
    lastEvaluatedTimestampMs: state.lastEvaluatedTimestampMs,
    installedAtMs: state.installedAtMs,
    historyBeganAtMs: state.historyBeganAtMs,
    historyPointCount: state.history.length,
    historySource: 'stored evaluations; public curves may be mathematically reconstructed from the stored phase basis',
    entrainment: { status: 'not_implemented', publicLabel: 'NOT MODELLED' },
    freeRunningPhaseDrift: { status: 'not_implemented', publicLabel: 'NOT MODELLED' },
    provenance: { ...state.provenance },
    inspection: state.lastInspection ? { ...state.lastInspection } : null,
    scnAnalogy: {
      status: 'implemented',
      publicLabel: 'LIVE',
      displayMode: 'circadian_phase',
      processCEstimate: state.processCEstimate,
      circadianPhasePositionHours: state.circadianPhasePositionHours,
      phaseBasis: state.phaseBasis,
      statement: 'Functional analogy of modelled circadian phase/output; not SCN firing or biological measurement.',
    },
  };
}

export function circadianProcessCHistory(state) {
  return validHistory(state && state.history, finite(state && state.installedAtMs, 0));
}
