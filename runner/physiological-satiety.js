// physiological-satiety.js - deterministic implementation of the integrated
// GI/hormone satiety model published by Martinez, Dibbs et al. (2025).
//
// This is a model estimate for a metabolically healthy adult reference. It is
// not a measurement of Cy and it does not model subjective hunger.

import { HMPPS_REFERENCE_RATION, ingestionRecordFromEnvironment } from './feeding-homeostasis.js';

export const PHYSIOLOGICAL_SATIETY_SCHEMA = 'cy.physiological-satiety';
export const PHYSIOLOGICAL_SATIETY_VERSION = 2;
export const PHYSIOLOGICAL_SATIETY_MODEL_ID = 'martinez-dibbs-integrated-physiological-satiety';
export const PHYSIOLOGICAL_SATIETY_MODEL_VERSION = 'physiological-satiety-v2';
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
  fatDensity: Object.freeze({ minimum: 0.7, maximum: 0.96, distribution: 'UNIFORM' }),
  carbohydrateDensity: Object.freeze({ minimum: 0.117, maximum: 1.4, distribution: 'UNIFORM' }),
  mealEatingRate: Object.freeze({ minimum: 28.7, maximum: 32.6, distribution: 'UNIFORM' }),
  snackEatingRate: Object.freeze({ minimum: 3.3, maximum: 6.4, distribution: 'UNIFORM' }),
});

export const NUMERICAL_METHOD = Object.freeze({
  method: 'deterministic Halton quasi-Monte-Carlo',
  samplesPerCompositionScenario: 128,
  bases: Object.freeze([2, 3, 5, 7]),
  centralIntervalPercent: 95,
  provenanceClass: 'NUMERICAL ENGINEERING',
  sourceSamplingDisclosure: 'The paper specifies uniform distributions and 1000 trials, but does not publish its random seed, PRNG, or exact sampler.',
});

export const COMPOSITION_SCENARIOS = Object.freeze([
  Object.freeze({ id: 'fat10', relativeFatFraction: 0.1, label: '10% of non-protein energy from fat' }),
  Object.freeze({ id: 'fat20', relativeFatFraction: 0.2, label: '20% of non-protein energy from fat' }),
  Object.freeze({ id: 'fat30', relativeFatFraction: 0.3, label: '30% of non-protein energy from fat' }),
]);

export const COMPOSITION_SCENARIO_DERIVATION = Object.freeze({
  classification: 'DERIVED NUTRITIONAL CONSTRAINT',
  dailyEnergyKcal: 2605,
  proteinEnergyFraction: 0.16,
  nonProteinEnergyKcal: 2188.2,
  fatMaximumEnergyKcal: 873,
  carbohydrateMinimumEnergyKcal: 1332,
  maximumFatEnergyKcalAllowedByCarbohydrateMinimum: 856.2,
  maximumRelativeFatFractionOfNonProteinEnergy: 0.3913,
  selectedPublishedScenarioFractions: Object.freeze([0.1, 0.2, 0.3]),
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

function halton(index, base) {
  let fraction = 1;
  let result = 0;
  let value = index;
  while (value > 0) {
    fraction /= base;
    result += fraction * (value % base);
    value = Math.floor(value / base);
  }
  return result;
}

function uniform(range, unit) {
  return range.minimum + (range.maximum - range.minimum) * unit;
}

export function buildDeterministicParameterGrid({
  scenarios = COMPOSITION_SCENARIOS,
  samplesPerScenario = NUMERICAL_METHOD.samplesPerCompositionScenario,
} = {}) {
  const tracks = [];
  for (const scenario of scenarios) {
    for (let index = 1; index <= samplesPerScenario; index++) {
      tracks.push({
        compositionScenarioId: scenario.id,
        compositionScenarioLabel: scenario.label,
        relativeFatFraction: scenario.relativeFatFraction,
        fatDensityGPerMl: uniform(NUMERICAL_GRID.fatDensity, halton(index, 2)),
        carbohydrateDensityGPerMl: uniform(NUMERICAL_GRID.carbohydrateDensity, halton(index, 3)),
        mealEatingRateKcalPerMin: uniform(NUMERICAL_GRID.mealEatingRate, halton(index, 5)),
        snackEatingRateKcalPerMin: uniform(NUMERICAL_GRID.snackEatingRate, halton(index, 7)),
        eatingRateKcalPerMin: uniform(NUMERICAL_GRID.mealEatingRate, halton(index, 5)),
        sampleIndex: index,
      });
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
    compositionKnowledge: 'UNKNOWN',
    numericalMethod: { ...clone(NUMERICAL_METHOD), tracks: COMPOSITION_SCENARIOS.length * NUMERICAL_METHOD.samplesPerCompositionScenario, integrationStepMinutes: 1 },
    migrationArchive: null,
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
  if (raw && raw.schema === PHYSIOLOGICAL_SATIETY_SCHEMA && raw.version === 1) {
    const migrated = createPhysiologicalSatiety(now);
    migrated.intakeHistory = clone(raw.intakeHistory || []).slice(-128);
    migrated.latestKnownIntake = clone(raw.latestKnownIntake || null);
    migrated.lastContinuityGapCount = Number(raw.lastContinuityGapCount || 0);
    migrated.inputUncertainty = [...new Set([...(raw.inputUncertainty || []), 'legacy v1 parameter ensemble requires a clean breakfast anchor'])];
    migrated.compositionKnowledge = raw.latestKnownIntake && raw.latestKnownIntake.fullMealMacros
      ? 'OBSERVED_EXACT' : 'SCENARIO_BOUNDED';
    migrated.status = raw.status === 'CALIBRATING' ? 'CALIBRATING' : 'INPUT_INCOMPLETE';
    migrated.statusReason = raw.status === 'CALIBRATING'
      ? 'WAITING_FOR_CLEAN_BREAKFAST_ANCHOR'
      : 'LEGACY_PARAMETER_ENSEMBLE_REQUIRES_CLEAN_BREAKFAST_ANCHOR';
    migrated.migrationArchive = {
      fromVersion: raw.version,
      fromModelVersion: raw.modelVersion || 'physiological-satiety-v1',
      previousStatus: raw.status || 'UNKNOWN',
      previousTrackCount: Array.isArray(raw.tracks) ? raw.tracks.length : 0,
      previousInitializedAtMs: raw.initializedAtMs || null,
      migratedAtMs: now,
      disposition: 'OLD ENSEMBLE NOT RELABELLED; RE-ANCHOR REQUIRED',
    };
    return migrated;
  }
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
  return satietyFromState({
    gastricDistentionMl: gastricDistention(track),
    cckPM: track.hormones.cckPM,
    pyyPM: track.hormones.pyyPM,
    glp1PM: track.hormones.glp1PM,
    ghrelinPM: track.hormones.ghrelinPM,
  });
}

export function displaySatiety(raw) {
  return Math.max(
    PUBLISHED_PARAMETERS.satietyScoreDomain.minimum,
    Math.min(PUBLISHED_PARAMETERS.satietyScoreDomain.maximum, raw),
  );
}

function transfer(volume, halfLifeMinutes, dtMinutes) {
  return Math.min(volume, volume * halfLifeRate(halfLifeMinutes) * dtMinutes);
}

function consume(track, dtMinutes) {
  const rate = track.intake.eatingRateClass === 'SNACK'
    ? (track.parameters.snackEatingRateKcalPerMin ?? track.parameters.eatingRateKcalPerMin)
    : (track.parameters.mealEatingRateKcalPerMin ?? track.parameters.eatingRateKcalPerMin);
  const energy = Math.min(track.intake.remainingEnergyKcal, rate * dtMinutes);
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
  track.intake.eatingRateClass = record.mealType === 'supper_snack' ? 'SNACK' : 'MEAL';
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
    const scenarios = record.fullMealMacros
      ? [{ id: 'observed_exact', relativeFatFraction: 0, label: 'Observed exact meal composition' }]
      : COMPOSITION_SCENARIOS;
    state.tracks = buildDeterministicParameterGrid({ scenarios }).map(createModelTrack);
    state.status = 'LIVE';
    state.statusReason = 'CLEAN_BREAKFAST_ANCHOR_ESTABLISHED';
    state.initializedAtMs = atMs;
    state.lastAdvancedAtMs = atMs;
    state.inputUncertainty = record.fullMealMacros ? [] : ['meal macronutrient composition', 'food density and eating-rate parameter ranges'];
    state.compositionKnowledge = record.fullMealMacros ? 'OBSERVED_EXACT' : 'SCENARIO_BOUNDED';
  } else if (state.status === 'LIVE') {
    advancePhysiologicalSatiety(state, atMs);
  }

  const unresolved = record.intakeOutcome === 'UNKNOWN'
    || (record.intakeOutcome === 'PARTLY_CONSUMED' && record.portionBasis !== 'OBSERVED_EXACT');
  if (unresolved) {
    if (state.status === 'LIVE') markInputIncomplete(state, record.intakeOutcome === 'UNKNOWN' ? 'UNKNOWN_INTAKE' : 'PARTIAL_PORTION_UNKNOWN');
  } else if (state.status === 'LIVE' && ['FULLY_CONSUMED', 'PARTLY_CONSUMED'].includes(record.intakeOutcome)) {
    if (!record.fullMealMacros) state.compositionKnowledge = 'SCENARIO_BOUNDED';
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

function quantile(values, probability) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function distributionFor(tracks, getter, transform = (value) => value) {
  const values = tracks.map(getter).filter(Number.isFinite);
  if (!values.length) return null;
  return {
    median: round(transform(quantile(values, 0.5))),
    central95: {
      lower: round(transform(quantile(values, 0.025))),
      upper: round(transform(quantile(values, 0.975))),
    },
  };
}

function compositionScenarioGroups(state) {
  if (state.compositionKnowledge === 'OBSERVED_EXACT') {
    return [{
      id: 'observed_exact',
      label: 'Observed exact meal composition',
      relativeFatFraction: null,
      tracks: state.tracks,
    }];
  }
  return COMPOSITION_SCENARIOS.map((scenario) => ({
    ...scenario,
    tracks: state.tracks.filter((track) => track.parameters.compositionScenarioId === scenario.id),
  })).filter((scenario) => scenario.tracks.length);
}

function ghrelinPublicSummary(tracks) {
  const raw = distributionFor(tracks, (track) => track.hormones.ghrelinPM);
  if (!raw) return null;
  if (tracks.some((track) => Number(track.hormones.ghrelinPM) < 0)) {
    return {
      status: 'MODEL_ARTEFACT_OUTSIDE_PHYSICAL_DOMAIN',
      display: 'MODEL ARTEFACT - RAW STATE BELOW ZERO',
      units: null,
    };
  }
  return { status: 'WITHIN_CALIBRATED_PHYSICAL_DOMAIN', ...raw, units: 'pM' };
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
    hmppsRationBasis: clone(HMPPS_REFERENCE_RATION),
  };
  if (!state || state.status !== 'LIVE' || !state.tracks.length) return base;
  const scenarioGroups = compositionScenarioGroups(state);
  const scenarios = scenarioGroups.map((scenario) => ({
    id: scenario.id,
    label: scenario.label,
    relativeFatFraction: scenario.relativeFatFraction,
    publishedInputDistribution: {
      classification: 'PUBLISHED INPUT-DISTRIBUTION UNCERTAINTY',
      centralIntervalPercent: 95,
      sampleCount: scenario.tracks.length,
    },
    displaySatiety: distributionFor(scenario.tracks, trackSatiety, displaySatiety),
    ghrelin: ghrelinPublicSummary(scenario.tracks),
  }));
  const exactComposition = scenarios.length === 1 && scenarios[0].id === 'observed_exact';
  const scenarioMedians = scenarios.map((scenario) => scenario.displaySatiety && scenario.displaySatiety.median).filter(Number.isFinite);
  const headline = exactComposition && scenarios[0].displaySatiety ? {
    status: 'ESTIMATE_AVAILABLE',
    label: 'SATIETY',
    estimate: scenarios[0].displaySatiety.median,
    central95: clone(scenarios[0].displaySatiety.central95),
  } : {
    status: 'INPUT_UNCERTAIN',
    label: 'SATIETY - INPUT UNCERTAIN',
  };
  return {
    ...base,
    headline,
    compositionUncertainty: {
      status: exactComposition ? 'OBSERVED_EXACT' : 'SCENARIO_BOUNDED',
      classification: 'MEAL-COMPOSITION SCENARIO RANGE',
      derivation: exactComposition
        ? 'Explicit observed fat, carbohydrate, and protein masses supplied by the world event.'
        : 'The 10%, 20%, and 30% paper diet scenarios that satisfy the HMPPS adult-male daily fat maximum and carbohydrate minimum.',
      constraintCalculation: exactComposition ? null : clone(COMPOSITION_SCENARIO_DERIVATION),
    },
    scenarios,
    scenarioEnvelope: scenarioMedians.length ? {
      classification: 'MEAL-COMPOSITION SCENARIO RANGE',
      minimumScenarioMedian: round(Math.min(...scenarioMedians)),
      maximumScenarioMedian: round(Math.max(...scenarioMedians)),
    } : null,
    displayTransformation: {
      classification: 'DISPLAY ONLY',
      operation: 'clamp raw equation result to nominal 1-10 display scale',
      sourceDefinesClamp: false,
    },
    ghrelin: ghrelinPublicSummary(state.tracks),
    numericalMethod: clone(state.numericalMethod),
    nutritionBasis: state.latestKnownIntake && state.latestKnownIntake.nutritionBasis,
  };
}

export function physiologicalSatietyInspection(state) {
  const publicSnapshot = physiologicalSatietySnapshot(state);
  const rawGhrelin = state && state.tracks && state.tracks.length
    ? distributionFor(state.tracks, (track) => track.hormones.ghrelinPM) : null;
  const rawSatiety = state && state.tracks && state.tracks.length
    ? distributionFor(state.tracks, trackSatiety) : null;
  const violations = [];
  if (state && state.tracks && state.tracks.some((track) => Number(track.hormones.ghrelinPM) < 0)) {
    violations.push('GHRELIN_MODEL_STATE_BELOW_ZERO');
  }
  if (state && state.tracks && state.tracks.some((track) => trackSatiety(track) < 1 || trackSatiety(track) > 10)) {
    violations.push('SATIETY_RAW_EQUATION_OUTSIDE_NOMINAL_1_TO_10_SCALE');
  }
  return {
    ...publicSnapshot,
    intakeHistory: clone(state && state.intakeHistory || []),
    parameterDomain: clone(NUMERICAL_GRID),
    parameterProvenance: PHYSIOLOGICAL_SATIETY_PROVENANCE,
    rawModelState: {
      classification: 'MODEL STATE / MODEL ARTEFACT; NOT A PHYSICAL MEASUREMENT',
      satiety: rawSatiety,
      ghrelin: rawGhrelin,
      scenarios: state && state.tracks && state.tracks.length
        ? compositionScenarioGroups(state).map((scenario) => ({
            id: scenario.id,
            label: scenario.label,
            satiety: distributionFor(scenario.tracks, trackSatiety),
            ghrelin: distributionFor(scenario.tracks, (track) => track.hormones.ghrelinPM),
          })) : [],
    },
    diagnosticTrackExtrema: state && state.tracks && state.tracks.length ? {
      classification: 'ADMIN DIAGNOSTIC EXTREMA; NOT A STATISTICAL INTERVAL',
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
    } : null,
    physicalDomainViolations: violations,
    migrationArchive: clone(state && state.migrationArchive || null),
  };
}
