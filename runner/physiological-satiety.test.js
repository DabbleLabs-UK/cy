import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEnvironmentEvent, createEnvironmentRecord } from './environment-schema.js';
import { groundedSomaDirective, observeSomaFeedingRecord, reconcileSoma, tickSoma } from './soma.js';
import {
  buildDeterministicParameterGrid,
  NUMERICAL_GRID,
  PUBLISHED_PARAMETERS,
  advancePhysiologicalSatiety,
  createModelTrack,
  createPhysiologicalSatiety,
  integrateTrackMinute,
  observePhysiologicalSatietyRecord,
  physiologicalSatietySnapshot,
  reconcilePhysiologicalSatiety,
  satietyFromState,
  trackSatiety,
} from './physiological-satiety.js';
import { implementationEntry } from './implementation-registry.js';

const T0 = Date.parse('2026-09-12T07:30:00.000Z');
const event = (id, mealType, intakeOutcome, consumed, portionCategory, portionFraction = null, at = T0) =>
  createEnvironmentRecord(createEnvironmentEvent('meal', {
    id,
    timestamp: new Date(at).toISOString(),
    world: { physical: { food: {
      meal_type: mealType,
      scheduled: 'yes',
      offered: intakeOutcome === 'unavailable' ? 'no' : 'yes',
      available: intakeOutcome === 'unavailable' ? 'no' : 'yes',
      received: intakeOutcome === 'unavailable' ? 'no' : 'yes',
      consumed,
      intake_outcome: intakeOutcome,
      portion_category: portionCategory,
      portion_fraction: portionFraction,
    } } },
  }));

const expected = createEnvironmentRecord(createEnvironmentEvent('meal_expected', {
  id: 'scheduled-only', timestamp: new Date(T0).toISOString(),
  world: { physical: { food: { meal_type: 'breakfast' } } },
}));

// A. A schedule is not ingestion and cannot establish the model anchor.
const noMeal = createPhysiologicalSatiety(T0);
observePhysiologicalSatietyRecord(noMeal, expected);
assert.equal(noMeal.status, 'CALIBRATING');
assert.equal(noMeal.tracks.length, 0);

// B. A full reference breakfast enters exactly 500 kcal.
const full = createPhysiologicalSatiety(T0);
observePhysiologicalSatietyRecord(full, event('full-breakfast', 'breakfast', 'full_consumed', 'full', 'full', 1));
assert.equal(full.status, 'LIVE');
assert.equal(full.tracks.length, 225);
assert.equal(full.latestKnownIntake.consumedEnergyKcal, 500);
assert.ok(full.tracks.every((track) => track.intake.remainingEnergyKcal === 500));

// Explicit factual nutrition supersedes the HMPPS reference-ration default.
const explicit = createPhysiologicalSatiety(T0);
const explicitBreakfast = createEnvironmentRecord(createEnvironmentEvent('meal', {
  id: 'explicit-breakfast',
  timestamp: new Date(T0).toISOString(),
  world: { physical: { food: {
    meal_type: 'breakfast', scheduled: 'yes', offered: 'yes', available: 'yes',
    received: 'yes', consumed: 'full', intake_outcome: 'full_consumed',
    portion_category: 'full', portion_fraction: 1,
    nutrition: { energy_kcal: 620, fat_g: 20, carbohydrate_g: 90, protein_g: 30 },
  } } },
}));
observePhysiologicalSatietyRecord(explicit, explicitBreakfast);
assert.equal(explicit.latestKnownIntake.consumedEnergyKcal, 620);
assert.equal(explicit.latestKnownIntake.nutritionBasis, 'EXPLICIT_FACTUAL_NUTRITION');
assert.deepEqual(explicit.tracks[0].intake.explicitMacros, {
  fatG: 20, carbohydrateG: 90, proteinG: 30,
});

// C. Refusal enters zero energy.
const beforeRefusal = full.tracks.map((track) => track.intake.remainingEnergyKcal);
observePhysiologicalSatietyRecord(full, event('refused-lunch', 'lunch', 'refused', 'none', 'none', 0, T0));
assert.deepEqual(full.tracks.map((track) => track.intake.remainingEnergyKcal), beforeRefusal);

// D. Exact partial intake uses the observed fraction, not a default.
const partial = createPhysiologicalSatiety(T0);
observePhysiologicalSatietyRecord(partial, event('partial-breakfast', 'breakfast', 'partial_consumed', 'partial', 'partial', 0.4));
assert.equal(partial.latestKnownIntake.consumedEnergyKcal, 200);

// E/F. Unknown partial and unknown intake preserve uncertainty.
for (const [id, outcome, consumed, portion] of [
  ['partial-unknown', 'partial_consumed', 'partial', 'partial'],
  ['intake-unknown', 'unknown', 'unknown', 'unknown'],
]) {
  const state = createPhysiologicalSatiety(T0);
  observePhysiologicalSatietyRecord(state, event(`${id}-anchor`, 'breakfast', 'full_consumed', 'full', 'full', 1));
  observePhysiologicalSatietyRecord(state, event(id, 'lunch', outcome, consumed, portion, null, T0 + 60000));
  assert.equal(state.status, 'INPUT_INCOMPLETE');
}

// G. One published 1-minute gastric-emptying step uses -ln(0.5)/half-life.
const gastric = createModelTrack({
  relativeFatFraction: 0.1, fatDensityGPerMl: 0.7,
  carbohydrateDensityGPerMl: 0.117, eatingRateKcalPerMin: 28.7,
});
gastric.stomach.fatMl = 100;
gastric.stomach.carbohydrateMl = 100;
integrateTrackMinute(gastric, 1);
assert.ok(Math.abs(gastric.stomach.fatMl - 100 * (1 - Math.log(2) / 193)) < 1e-12);
assert.ok(Math.abs(gastric.stomach.carbohydrateMl - 100 * (1 - Math.log(2) / 43)) < 1e-12);

// H. Every hormone update reproduces the published deterministic recurrence.
const hormones = createModelTrack({
  relativeFatFraction: 0.1, fatDensityGPerMl: 0.7,
  carbohydrateDensityGPerMl: 0.117, eatingRateKcalPerMin: 28.7,
});
Object.assign(hormones.stomach, { fatMl: 4, carbohydrateMl: 5 });
Object.assign(hormones.upperSmallIntestine, { fatMl: 2, carbohydrateMl: 3 });
Object.assign(hormones.lowerSmallIntestine, { fatMl: 1, carbohydrateMl: 2 });
Object.assign(hormones.largeIntestine, { fatMl: 0.5, carbohydrateMl: 0 });
Object.assign(hormones.hormones, { cckPM: 7, glp1PM: 8, pyyPM: 9, ghrelinPM: 100 });
integrateTrackMinute(hormones, 1);
assert.ok(Math.abs(hormones.hormones.glp1PM - (8 + 1 * 0.2 + 0.5 * 0.2 + 2 * 0.2 - 8 * 0.06)) < 1e-12);
assert.ok(Math.abs(hormones.hormones.cckPM - (7 + 2 * 0.01 + 3 * 0.005 - 7 * 0.03)) < 1e-12);
assert.ok(Math.abs(hormones.hormones.pyyPM - (9 + 1 * 2 + 0.5 * 1.5 + 2 * 0.8 - 9 * 0.075)) < 1e-12);
assert.ok(Math.abs(hormones.hormones.ghrelinPM - (100 + 4 * -0.01 + 2 * -0.005 + 5 * -0.01 + 3 * -0.005 + (110 - 100) * 0.04)) < 1e-12);

// I. The published satiety expression includes the multiplicative PYY/GLP-1 term.
assert.equal(satietyFromState({ gastricDistentionMl: 400, cckPM: 2, pyyPM: 3, glp1PM: 4, ghrelinPM: 100 }),
  0.0025 * 400 + 1.2 * 2 + 0.08 * 3 * 0.2 * 4 + 0.02 * 10);
const boundedScoreTrack = createModelTrack({});
boundedScoreTrack.hormones.cckPM = 20;
assert.equal(trackSatiety(boundedScoreTrack), 10);

// J. The deterministic dietary/parameter ensemble produces an enclosing interval.
advancePhysiologicalSatiety(partial, T0 + 30 * 60000);
const interval = physiologicalSatietySnapshot(partial).current;
const compactSnapshot = physiologicalSatietySnapshot(partial);
assert.ok(interval.minimum <= interval.maximum);
assert.ok(interval.maximum > interval.minimum);
assert.ok(interval.minimum >= 1 && interval.maximum <= 10);
assert.ok(compactSnapshot.unboundedEquationResult.maximum >= interval.maximum);
assert.ok(compactSnapshot.compartments.upperSmallIntestineFatMl.minimum >= 0);
assert.ok(compactSnapshot.compartments.lowerSmallIntestineCarbohydrateMl.maximum >= 0);
const endpointTracks = partial.tracks.filter((track) =>
  [NUMERICAL_GRID.fatDensities[0], NUMERICAL_GRID.fatDensities.at(-1)].includes(track.parameters.fatDensityGPerMl)
  && [NUMERICAL_GRID.carbohydrateDensities[0], NUMERICAL_GRID.carbohydrateDensities.at(-1)].includes(track.parameters.carbohydrateDensityGPerMl)
  && [NUMERICAL_GRID.eatingRates[0], NUMERICAL_GRID.eatingRates.at(-1)].includes(track.parameters.eatingRateKcalPerMin));
const endpoints = endpointTracks.map((track) => satietyFromState({
  gastricDistentionMl: PUBLISHED_PARAMETERS.initialGastricDistentionMl + PUBLISHED_PARAMETERS.gastricDistentionConstant * (track.stomach.fatMl + track.stomach.carbohydrateMl),
  cckPM: track.hormones.cckPM, pyyPM: track.hormones.pyyPM,
  glp1PM: track.hormones.glp1PM, ghrelinPM: track.hormones.ghrelinPM,
}));
assert.ok(Math.abs(Math.min(...endpoints) - interval.minimum) < 1e-6);
assert.ok(Math.abs(Math.max(...endpoints) - interval.maximum) < 1e-6);

// A substantially denser deterministic grid converges to the same extrema.
const linearGrid = (minimum, maximum, count) => Array.from(
  { length: count },
  (_, index) => minimum + (maximum - minimum) * index / (count - 1),
);
const denseGrid = {
  relativeFatFractions: linearGrid(0.1, 0.3, 5),
  fatDensities: linearGrid(0.7, 0.96, 9),
  carbohydrateDensities: linearGrid(0.117, 1.4, 9),
  eatingRates: linearGrid(28.7, 32.6, 5),
};
const dense = createPhysiologicalSatiety(T0);
dense.status = 'LIVE';
dense.statusReason = 'CONVERGENCE_TEST_FIXTURE';
dense.initializedAtMs = T0;
dense.lastAdvancedAtMs = T0;
dense.tracks = buildDeterministicParameterGrid(denseGrid).map((parameters) => {
  const track = createModelTrack(parameters);
  track.intake.remainingEnergyKcal = 200;
  track.intake.totalEnergyKcal = 200;
  track.intake.fatEnergyFraction = (1 - PUBLISHED_PARAMETERS.proteinEnergyFraction)
    * parameters.relativeFatFraction;
  track.intake.carbohydrateEnergyFraction = (1 - PUBLISHED_PARAMETERS.proteinEnergyFraction)
    * (1 - parameters.relativeFatFraction);
  return track;
});
advancePhysiologicalSatiety(dense, T0 + 30 * 60000);
const denseInterval = physiologicalSatietySnapshot(dense).current;
assert.ok(Math.abs(denseInterval.minimum - interval.minimum) < 1e-6);
assert.ok(Math.abs(denseInterval.maximum - interval.maximum) < 1e-6);

// K/N. Legacy Hunger cannot change state or the grounded model projection.
const soma = reconcileSoma(null, { now: T0 });
observeSomaFeedingRecord(soma, event('soma-breakfast', 'breakfast', 'full_consumed', 'full', 'full', 1));
tickSoma(soma, { now: T0 + 20 * 60000, physical: { hunger: 1 } });
const beforeLegacy = JSON.stringify(soma.physiologicalSatiety);
const beforeDirective = groundedSomaDirective(soma, { now: T0 + 20 * 60000 }).directive;
soma.experienced.metrics.hunger.value = 0;
soma.drives.food = 0;
assert.equal(JSON.stringify(soma.physiologicalSatiety), beforeLegacy);
assert.equal(groundedSomaDirective(soma, { now: T0 + 20 * 60000 }).directive, beforeDirective);
assert.match(beforeDirective, /Physiological satiety range/);
assert.doesNotMatch(beforeDirective, /\bhungry\b/i);

// L/M. Known downtime advances digestion; an observation gap invalidates it.
const knownDowntime = reconcilePhysiologicalSatiety(partial, { now: T0 + 60 * 60000, feedingUnknownIntervals: [] });
assert.equal(knownDowntime.status, 'LIVE');
assert.equal(knownDowntime.lastAdvancedAtMs, T0 + 60 * 60000);
const unknownDowntime = reconcilePhysiologicalSatiety(partial, {
  now: T0 + 60 * 60000,
  feedingUnknownIntervals: [{ startedAtMs: T0 + 30 * 60000, endedAtMs: T0 + 60 * 60000 }],
});
assert.equal(unknownDowntime.status, 'INPUT_INCOMPLETE');

// O/Q. Public terminology is satiety and hypothalamic neural activity is not promoted.
const ui = readFileSync(new URL('../public/assets/brain.js', import.meta.url), 'utf8');
assert.match(ui, /PHYSIOLOGICAL SATIETY/);
assert.doesNotMatch(ui, /key: 'hunger'/);
assert.match(ui, /SUBJECTIVE HUNGER<\/span><strong>NOT MODELLED/);
assert.equal(implementationEntry('soma_variables', 'satiety').implementation_status, 'IMPLEMENTED');
assert.equal(implementationEntry('brain_regions', 'hypothalamic').implementation_status, 'NOT_IMPLEMENTED');

console.log('physiological-satiety.test.js: all checks passed');
