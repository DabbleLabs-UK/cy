// physiological-satiety.js - deterministic implementation of the integrated
// GI/hormone satiety model published by Martinez, Dibbs et al. (2025).
//
// This is a model estimate for a metabolically healthy adult reference. It is
// not a measurement of Cy and it does not model subjective hunger.

import { ingestionRecordFromEnvironment } from './feeding-homeostasis.js';

export const PHYSIOLOGICAL_SATIETY_SCHEMA = 'cy.physiological-satiety';
export const PHYSIOLOGICAL_SATIETY_VERSION = 1;
export const PHYSIOLOGICAL_SATIETY_MODEL_ID = 'martinez-dibbs-integrated-physiological-satiety';
export const PHYSIOLOGICAL_SATIETY_MODEL_VERSION = 'physiological-satiety-v1';
export const PHYSIOLOGICAL_SATIETY_PROVENANCE = 'config/model-specs/physiological-satiety.json';

export const PUBLISHED_PARAMETERS = Object.freeze({
  proteinEnergyFraction: 0.16,
  initialGastricDistentionMl: 296,
  gastricDistentionConstant: 0.709,
  stomachHalfLifeMin: Object.freeze({ fat: 193, carbohydrate: 43 }),
  smallIntestineHalfLifeMin: Object.freeze({ fat: 360, carbohydrate: 180 }),
  upperAbsorbedFraction: Object.freeze({ fat: 0.3, carbohydrate: 0.8 }),
  lowerAbsorbedFraction: Object.freeze({ fat: 0.5, carbohydrate: 1 }),
  largeIntestineOutflowMlPerMin: Object.freeze({ fat: 0.05, carbohydrate: 0 }),
  glp1: Object.freeze({ eating: 0.75, lowerFat: 0.2, largeFat: 0.2, lowerCarbohydrate: 0.2, decay: 0.06 }),
  cck: Object.freeze({ upperFat: 0.01, upperCarbohydrate: 0.005, decay: 0.03 }),
  pyy: Object.freeze({ lowerFat: 2, largeFat: 1.5, lowerCarbohydrate: 0.8, decay: 0.075 }),
  ghrelin: Object.freeze({ stomachFat: -0.01, upperFat: -0.005, stomachCarbohydrate: -0.01, upperCarbohydrate: -0.005, decay: 0.04, fasting: 110 }),
  satiety: Object.freeze({ gastricLow: 0.0025, gastricHigh: 0.0035, cck: 1.2, pyy: 0.08, glp1: 0.2, ghrelin: 0.02 }),
  satietyScoreDomain: Object.freeze({ minimum: 1, maximum: 10 }),
});

export const DERIVED_CONVERSIONS = Object.freeze({
  fatEnergyKcalPerG: 9,
  carbohydrateEnergyKcalPerG: 4,
});

export const NUMERICAL_GRID = Object.freeze({
  relativeFatFractions: Object.freeze([0.1, 0.2, 0.3]),
  fatDensities: Object.freeze([0.7, 0.765, 0.83, 0.895, 0.96]),
  carbohydrateDensities: Object.freeze([0.117, 0.43775, 0.7585, 1.07925, 1.4]),
  eatingRates: Object.freeze([28.7, 30.65, 32.6]),
});

const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const timestampMs = (value) => {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
};
const round = (value, digits = 6) => Number(Number(value).toFixed(digits));
const halfLifeRate = (minutes) => -Math.log(0.5) / minutes;

export function createModelTrack(parameters) {
  return {
    parameters: clone(parameters),
    stomach: { fatMl: 0, carbohydrateMl: 0 },
    upperSmallIntestine: { fatMl: 0, carbohydrateMl: 0 },
    lowerSmallIntestine: { fatMl: 0, carbohydrateMl: 0 },
    largeIntestine: { fatMl: 0, carbohydrateMl: 0 },
    hormones: { cckPM: 0, glp1PM: 0, pyyPM: 0, ghrelinPM: PUBLISHED_PARAMETERS.ghrelin.fasting },
    intake: { remainingEnergyKcal: 0, fatEnergyFraction: 0, carbohydrateEnergyFraction: 0, explicitMacros: null },
  };
}

export function buildDeterministicParameterGrid(grid = NUMERICAL_GRID) {
  const tracks = [];
  for (const relativeFatFraction of grid.relativeFatFractions) {
    for (const fatDensityGPerMl of grid.fatDensities) {
      for (const carbohydrateDensityGPerMl of grid.carbohydrateDensities) {
        for (const eatingRateKcalPerMin of grid.eatingRates) {
          tracks.push({ relativeFatFraction, fatDensityGPerMl, carbohydrateDensityGPerMl, eatingRateKcalPerMin });
        }
      }
    }
  }
  return tracks;
}

export function createPhysiologicalSatiety(now = Date.now()) {
  return {
    schema: PHYSIOLOGICAL_SATIETY_SCHEMA,
    version: PHYSIOLOGICAL_SATIETY_VERSION,
    modelId: PHYSIOLOGICAL_SATIETY_MODEL_ID,
    modelVersion: PHYSIOLOGICAL_SATIETY_MODEL_VERSION,
    provenance: PHYSIOLOGICAL_SATIETY_PROVENANCE,
    status: 'CALIBRATING',
    statusReason: 'WAITING_FOR_CLEAN_BREAKFAST_ANCHOR',
    initializedAtMs: null,
    lastAdvancedAtMs: now,
    lastContinuityGapCount: 0,
    tracks: [],
    intakeHistory: [],
    latestKnownIntake: null,
    inputUncertainty: ['model not initialized'],
    numericalMethod: { method: 'deterministic Cartesian grid', tracks: 225, integrationStepMinutes: 1 },
  };
}

function validRaw(raw) {
  return raw && raw.schema === PHYSIOLOGICAL_SATIETY_SCHEMA
    && raw.version === PHYSIOLOGICAL_SATIETY_VERSION
    && raw.modelId === PHYSIOLOGICAL_SATIETY_MODEL_ID
    && raw.modelVersion === PHYSIOLOGICAL_SATIETY_MODEL_VERSION;
}

export function reconcilePhysiologicalSatiety(raw, {
  now = Date.now(),
  feedingUnknownIntervals = [],
} = {}) {
  if (!validRaw(raw)) return createPhysiologicalSatiety(now);
  const out = clone(raw);
  const gapCount = Array.isArray(feedingUnknownIntervals) ? feedingUnknownIntervals.length : 0;
  if (out.status === 'LIVE' && gapCount > Number(out.lastContinuityGapCount || 0)) {
    out.status = 'INPUT_INCOMPLETE';
    out.statusReason = 'RUNNER_DOWNTIME_WITH_UNKNOWN_INTAKE';
    out.inputUncertainty = [...new Set([...(out.inputUncertainty || []), 'intake during runner downtime is unknown'])];
  } else if (out.status === 'LIVE') {
    advancePhysiologicalSatiety(out, now);
  }
  out.lastContinuityGapCount = gapCount;
  return out;
}

function gastricDistention(track) {
  return PUBLISHED_PARAMETERS.initialGastricDistentionMl
    + PUBLISHED_PARAMETERS.gastricDistentionConstant
      * (track.stomach.fatMl + track.stomach.carbohydrateMl);
}

export function satietyFromState({ gastricDistentionMl, cckPM, pyyPM, glp1PM, ghrelinPM }) {
  const gastricCoefficient = gastricDistentionMl <= 296 ? 0
    : gastricDistentionMl < 500 ? PUBLISHED_PARAMETERS.satiety.gastricLow
      : PUBLISHED_PARAMETERS.satiety.gastricHigh;
  return gastricCoefficient * gastricDistentionMl
    + PUBLISHED_PARAMETERS.satiety.cck * cckPM
    + PUBLISHED_PARAMETERS.satiety.pyy * pyyPM * PUBLISHED_PARAMETERS.satiety.glp1 * glp1PM
    + PUBLISHED_PARAMETERS.satiety.ghrelin * (PUBLISHED_PARAMETERS.ghrelin.fasting - ghrelinPM);
}

export function trackSatiety(track) {
  const raw = satietyFromState({
    gastricDistentionMl: gastricDistention(track),
    cckPM: track.hormones.cckPM,
    pyyPM: track.hormones.pyyPM,
    glp1PM: track.hormones.glp1PM,
    ghrelinPM: track.hormones.ghrelinPM,
  });
  return Math.max(
    PUBLISHED_PARAMETERS.satietyScoreDomain.minimum,
    Math.min(PUBLISHED_PARAMETERS.satietyScoreDomain.maximum, raw),
  );
}

function transfer(volume, halfLifeMinutes, dtMinutes) {
  return Math.min(volume, volume * halfLifeRate(halfLifeMinutes) * dtMinutes);
}

function consume(track, dtMinutes) {
  const energy = Math.min(track.intake.remainingEnergyKcal, track.parameters.eatingRateKcalPerMin * dtMinutes);
  if (!(energy > 0)) return false;
  track.intake.remainingEnergyKcal -= energy;
  let fatG;
  let carbohydrateG;
  if (track.intake.explicitMacros) {
    const fraction = energy / track.intake.totalEnergyKcal;
    fatG = track.intake.explicitMacros.fatG * fraction;
    carbohydrateG = track.intake.explicitMacros.carbohydrateG * fraction;
  } else {
    fatG = energy * track.intake.fatEnergyFraction / DERIVED_CONVERSIONS.fatEnergyKcalPerG;
    carbohydrateG = energy * track.intake.carbohydrateEnergyFraction
      / DERIVED_CONVERSIONS.carbohydrateEnergyKcalPerG;
  }
  track.stomach.fatMl += fatG / track.parameters.fatDensityGPerMl;
  track.stomach.carbohydrateMl += carbohydrateG / track.parameters.carbohydrateDensityGPerMl;
  return true;
}

export function integrateTrackMinute(track, dtMinutes = 1) {
  const eating = consume(track, dtMinutes);
  const before = {
    stomachFat: track.stomach.fatMl,
    stomachCarbohydrate: track.stomach.carbohydrateMl,
    upperFat: track.upperSmallIntestine.fatMl,
    upperCarbohydrate: track.upperSmallIntestine.carbohydrateMl,
    lowerFat: track.lowerSmallIntestine.fatMl,
    lowerCarbohydrate: track.lowerSmallIntestine.carbohydrateMl,
    largeFat: track.largeIntestine.fatMl,
    largeCarbohydrate: track.largeIntestine.carbohydrateMl,
  };

  const glp1Delta = ((eating ? PUBLISHED_PARAMETERS.glp1.eating : 0)
    + before.lowerFat * PUBLISHED_PARAMETERS.glp1.lowerFat
    + before.largeFat * PUBLISHED_PARAMETERS.glp1.largeFat
    + before.lowerCarbohydrate * PUBLISHED_PARAMETERS.glp1.lowerCarbohydrate
    - track.hormones.glp1PM * PUBLISHED_PARAMETERS.glp1.decay) * dtMinutes;
  const cckDelta = (before.upperFat * PUBLISHED_PARAMETERS.cck.upperFat
    + before.upperCarbohydrate * PUBLISHED_PARAMETERS.cck.upperCarbohydrate
    - track.hormones.cckPM * PUBLISHED_PARAMETERS.cck.decay) * dtMinutes;
  const pyyDelta = (before.lowerFat * PUBLISHED_PARAMETERS.pyy.lowerFat
    + before.largeFat * PUBLISHED_PARAMETERS.pyy.largeFat
    + before.lowerCarbohydrate * PUBLISHED_PARAMETERS.pyy.lowerCarbohydrate
    - track.hormones.pyyPM * PUBLISHED_PARAMETERS.pyy.decay) * dtMinutes;
  const ghrelinDelta = (before.stomachFat * PUBLISHED_PARAMETERS.ghrelin.stomachFat
    + before.upperFat * PUBLISHED_PARAMETERS.ghrelin.upperFat
    + before.stomachCarbohydrate * PUBLISHED_PARAMETERS.ghrelin.stomachCarbohydrate
    + before.upperCarbohydrate * PUBLISHED_PARAMETERS.ghrelin.upperCarbohydrate
    + (PUBLISHED_PARAMETERS.ghrelin.fasting - track.hormones.ghrelinPM) * PUBLISHED_PARAMETERS.ghrelin.decay) * dtMinutes;

  track.hormones.glp1PM += glp1Delta;
  track.hormones.cckPM += cckDelta;
  track.hormones.pyyPM += pyyDelta;
  track.hormones.ghrelinPM += ghrelinDelta;

  const stomachFatOut = transfer(before.stomachFat, PUBLISHED_PARAMETERS.stomachHalfLifeMin.fat, dtMinutes);
  const stomachCarbohydrateOut = transfer(before.stomachCarbohydrate, PUBLISHED_PARAMETERS.stomachHalfLifeMin.carbohydrate, dtMinutes);
  track.stomach.fatMl -= stomachFatOut;
  track.stomach.carbohydrateMl -= stomachCarbohydrateOut;
  track.upperSmallIntestine.fatMl += stomachFatOut;
  track.upperSmallIntestine.carbohydrateMl += stomachCarbohydrateOut;

  const upperFatOut = transfer(before.upperFat, PUBLISHED_PARAMETERS.smallIntestineHalfLifeMin.fat, dtMinutes);
  const upperCarbohydrateOut = transfer(before.upperCarbohydrate, PUBLISHED_PARAMETERS.smallIntestineHalfLifeMin.carbohydrate, dtMinutes);
  track.upperSmallIntestine.fatMl -= upperFatOut;
  track.upperSmallIntestine.carbohydrateMl -= upperCarbohydrateOut;
  track.lowerSmallIntestine.fatMl += upperFatOut * (1 - PUBLISHED_PARAMETERS.upperAbsorbedFraction.fat);
  track.lowerSmallIntestine.carbohydrateMl += upperCarbohydrateOut * (1 - PUBLISHED_PARAMETERS.upperAbsorbedFraction.carbohydrate);

  const lowerFatOut = transfer(before.lowerFat, PUBLISHED_PARAMETERS.smallIntestineHalfLifeMin.fat, dtMinutes);
  const lowerCarbohydrateOut = transfer(before.lowerCarbohydrate, PUBLISHED_PARAMETERS.smallIntestineHalfLifeMin.carbohydrate, dtMinutes);
  track.lowerSmallIntestine.fatMl -= lowerFatOut;
  track.lowerSmallIntestine.carbohydrateMl -= lowerCarbohydrateOut;
  track.largeIntestine.fatMl += lowerFatOut * (1 - PUBLISHED_PARAMETERS.lowerAbsorbedFraction.fat);
  track.largeIntestine.carbohydrateMl += lowerCarbohydrateOut * (1 - PUBLISHED_PARAMETERS.lowerAbsorbedFraction.carbohydrate);

  track.largeIntestine.fatMl -= Math.min(track.largeIntestine.fatMl, PUBLISHED_PARAMETERS.largeIntestineOutflowMlPerMin.fat * dtMinutes);
  track.largeIntestine.carbohydrateMl -= Math.min(track.largeIntestine.carbohydrateMl, PUBLISHED_PARAMETERS.largeIntestineOutflowMlPerMin.carbohydrate * dtMinutes);
  return track;
}

export function advancePhysiologicalSatiety(state, now = Date.now()) {
  if (!state || state.status !== 'LIVE' || !state.tracks.length) return state;
  let remainingMinutes = Math.max(0, now - state.lastAdvancedAtMs) / 60000;
  while (remainingMinutes > 0) {
    const dt = Math.min(1, remainingMinutes);
    for (const track of state.tracks) integrateTrackMinute(track, dt);
    remainingMinutes -= dt;
  }
  state.lastAdvancedAtMs = now;
  return state;
}

function suitableAnchor(record) {
  return record && record.mealType === 'breakfast'
    && (record.intakeOutcome === 'FULLY_CONSUMED'
      || (record.intakeOutcome === 'PARTLY_CONSUMED' && record.portionBasis === 'OBSERVED_EXACT'))
    && Number.isFinite(record.consumedEnergyKcal) && record.consumedEnergyKcal > 0;
}

function setTrackIntake(track, record) {
  track.intake.remainingEnergyKcal = record.consumedEnergyKcal;
  track.intake.totalEnergyKcal = record.consumedEnergyKcal;
  if (record.fullMealMacros) {
    const fraction = record.consumedFraction;
    track.intake.explicitMacros = {
      fatG: record.fullMealMacros.fatG * fraction,
      carbohydrateG: record.fullMealMacros.carbohydrateG * fraction,
      proteinG: record.fullMealMacros.proteinG * fraction,
    };
    track.intake.fatEnergyFraction = 0;
    track.intake.carbohydrateEnergyFraction = 0;
  } else {
    const nonProtein = 1 - PUBLISHED_PARAMETERS.proteinEnergyFraction;
    track.intake.explicitMacros = null;
    track.intake.fatEnergyFraction = nonProtein * track.parameters.relativeFatFraction;
    track.intake.carbohydrateEnergyFraction = nonProtein * (1 - track.parameters.relativeFatFraction);
  }
}

function markInputIncomplete(state, reason) {
  state.status = 'INPUT_INCOMPLETE';
  state.statusReason = reason;
  state.inputUncertainty = [...new Set([...(state.inputUncertainty || []), reason.toLowerCase().replaceAll('_', ' ')])];
}

export function observePhysiologicalSatietyRecord(state, environmentRecord) {
  if (!state || !environmentRecord) return { updated: false, reason: 'invalid_record' };
  const record = ingestionRecordFromEnvironment(environmentRecord);
  if (!record) return { updated: false, reason: 'not_a_feeding_event' };
  if (state.intakeHistory.some((item) => item.eventId === record.eventId)) {
    return { updated: false, reason: 'duplicate_event' };
  }
  const atMs = timestampMs(record.timestamp);
  if (atMs == null) return { updated: false, reason: 'invalid_timestamp' };

  if (suitableAnchor(record) && state.status !== 'LIVE') {
    state.tracks = buildDeterministicParameterGrid().map(createModelTrack);
    state.status = 'LIVE';
    state.statusReason = 'CLEAN_BREAKFAST_ANCHOR_ESTABLISHED';
    state.initializedAtMs = atMs;
    state.lastAdvancedAtMs = atMs;
    state.inputUncertainty = record.fullMealMacros ? [] : ['meal macronutrient composition', 'food density and eating-rate parameter ranges'];
  } else if (state.status === 'LIVE') {
    advancePhysiologicalSatiety(state, atMs);
  }

  const unresolved = record.intakeOutcome === 'UNKNOWN'
    || (record.intakeOutcome === 'PARTLY_CONSUMED' && record.portionBasis !== 'OBSERVED_EXACT');
  if (unresolved) {
    if (state.status === 'LIVE') markInputIncomplete(state, record.intakeOutcome === 'UNKNOWN' ? 'UNKNOWN_INTAKE' : 'PARTIAL_PORTION_UNKNOWN');
  } else if (state.status === 'LIVE' && ['FULLY_CONSUMED', 'PARTLY_CONSUMED'].includes(record.intakeOutcome)) {
    for (const track of state.tracks) setTrackIntake(track, record);
    state.latestKnownIntake = clone(record);
  }

  state.intakeHistory.push({
    eventId: record.eventId,
    timestamp: record.timestamp,
    mealType: record.mealType,
    intakeOutcome: record.intakeOutcome,
    consumedEnergyKcal: record.consumedEnergyKcal,
    portionBasis: record.portionBasis,
    nutritionBasis: record.nutritionBasis,
  });
  state.intakeHistory = state.intakeHistory.slice(-128);
  return { updated: true, status: state.status, record: clone(record) };
}

function rangeFor(tracks, getter) {
  const values = tracks.map(getter).filter(Number.isFinite);
  return values.length ? { minimum: round(Math.min(...values)), maximum: round(Math.max(...values)) } : null;
}

export function physiologicalSatietySnapshot(state) {
  const base = {
    status: state && state.status || 'CALIBRATING',
    publicLabel: state && state.status === 'LIVE' ? 'LIVE' : state && state.status || 'CALIBRATING',
    modelId: PHYSIOLOGICAL_SATIETY_MODEL_ID,
    modelVersion: PHYSIOLOGICAL_SATIETY_MODEL_VERSION,
    provenance: PHYSIOLOGICAL_SATIETY_PROVENANCE,
    statusReason: state && state.statusReason || 'WAITING_FOR_CLEAN_BREAKFAST_ANCHOR',
    subjectiveHunger: 'NOT_MODELLED',
    actionSelection: 'NOT_CONNECTED',
    hypothalamicNeuralActivity: 'NOT_MODELLED',
    inputUncertainty: clone(state && state.inputUncertainty || []),
    latestKnownIntake: clone(state && state.latestKnownIntake || null),
    initializedAtMs: state && state.initializedAtMs || null,
  };
  if (!state || state.status !== 'LIVE' || !state.tracks.length) return base;
  const current = rangeFor(state.tracks, trackSatiety);
  const unboundedEquationResult = rangeFor(state.tracks, (track) => satietyFromState({
    gastricDistentionMl: gastricDistention(track),
    cckPM: track.hormones.cckPM,
    pyyPM: track.hormones.pyyPM,
    glp1PM: track.hormones.glp1PM,
    ghrelinPM: track.hormones.ghrelinPM,
  }));
  return {
    ...base,
    current: { ...current, midpoint: round((current.minimum + current.maximum) / 2) },
    unboundedEquationResult,
    compartments: {
      stomachFatMl: rangeFor(state.tracks, (track) => track.stomach.fatMl),
      stomachCarbohydrateMl: rangeFor(state.tracks, (track) => track.stomach.carbohydrateMl),
      upperSmallIntestineFatMl: rangeFor(state.tracks, (track) => track.upperSmallIntestine.fatMl),
      upperSmallIntestineCarbohydrateMl: rangeFor(state.tracks, (track) => track.upperSmallIntestine.carbohydrateMl),
      lowerSmallIntestineFatMl: rangeFor(state.tracks, (track) => track.lowerSmallIntestine.fatMl),
      lowerSmallIntestineCarbohydrateMl: rangeFor(state.tracks, (track) => track.lowerSmallIntestine.carbohydrateMl),
      largeIntestineFatMl: rangeFor(state.tracks, (track) => track.largeIntestine.fatMl),
      largeIntestineCarbohydrateMl: rangeFor(state.tracks, (track) => track.largeIntestine.carbohydrateMl),
    },
    gastricDistentionMl: rangeFor(state.tracks, gastricDistention),
    gastricContentsMl: rangeFor(state.tracks, (track) => track.stomach.fatMl + track.stomach.carbohydrateMl),
    cckPM: rangeFor(state.tracks, (track) => track.hormones.cckPM),
    glp1PM: rangeFor(state.tracks, (track) => track.hormones.glp1PM),
    pyyPM: rangeFor(state.tracks, (track) => track.hormones.pyyPM),
    ghrelinPM: rangeFor(state.tracks, (track) => track.hormones.ghrelinPM),
    numericalMethod: clone(state.numericalMethod),
    nutritionBasis: state.latestKnownIntake && state.latestKnownIntake.nutritionBasis,
  };
}

export function physiologicalSatietyInspection(state) {
  return {
    ...physiologicalSatietySnapshot(state),
    intakeHistory: clone(state && state.intakeHistory || []),
    parameterDomain: clone(NUMERICAL_GRID),
    parameterProvenance: PHYSIOLOGICAL_SATIETY_PROVENANCE,
  };
}
