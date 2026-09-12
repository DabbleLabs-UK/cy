import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEnvironmentEvent, createEnvironmentRecord } from './environment-schema.js';
import { PRISON_REGIME_CONFIGURATION, PRISON_SCHEDULE, chooseMealEvent, mealExpectation } from './environment.js';
import { HMPPS_REFERENCE_RATION, ingestionRecordFromEnvironment } from './feeding-homeostasis.js';
import { groundedSomaDirective, observeSomaFeedingRecord, reconcileSoma, tickSoma } from './soma.js';
import {
  COMPOSITION_SCENARIOS, COMPOSITION_SCENARIO_DERIVATION, NUMERICAL_METHOD, advancePhysiologicalSatiety,
  buildDeterministicParameterGrid, createModelTrack, createPhysiologicalSatiety,
  displaySatiety, integrateTrackMinute, observePhysiologicalSatietyRecord,
  physiologicalSatietyInspection, physiologicalSatietySnapshot,
  reconcilePhysiologicalSatiety, satietyFromState, trackSatiety,
} from './physiological-satiety.js';
import { implementationEntry } from './implementation-registry.js';

const T0 = Date.parse('2026-09-12T07:30:00.000Z');
const event = (id, mealType, intakeOutcome, consumed, portionCategory, portionFraction = null, at = T0) =>
  createEnvironmentRecord(createEnvironmentEvent('meal', {
    id, timestamp: new Date(at).toISOString(),
    world: { physical: { food: {
      meal_type: mealType, scheduled: 'yes',
      offered: intakeOutcome === 'unavailable' ? 'no' : 'yes',
      available: intakeOutcome === 'unavailable' ? 'no' : 'yes',
      received: intakeOutcome === 'unavailable' ? 'no' : 'yes',
      consumed, intake_outcome: intakeOutcome, portion_category: portionCategory,
      portion_fraction: portionFraction,
    } } },
  }));

// A. Published equations and one-minute recurrence are unchanged.
assert.equal(satietyFromState({ gastricDistentionMl: 400, cckPM: 2, pyyPM: 3, glp1PM: 4, ghrelinPM: 100 }),
  0.0025 * 400 + 1.2 * 2 + 0.08 * 3 * 0.2 * 4 + 0.02 * 10);
const recurrence = createModelTrack({ relativeFatFraction: 0.1, fatDensityGPerMl: 0.7,
  carbohydrateDensityGPerMl: 0.117, mealEatingRateKcalPerMin: 28.7, snackEatingRateKcalPerMin: 3.3 });
Object.assign(recurrence.stomach, { fatMl: 4, carbohydrateMl: 5 });
Object.assign(recurrence.upperSmallIntestine, { fatMl: 2, carbohydrateMl: 3 });
Object.assign(recurrence.lowerSmallIntestine, { fatMl: 1, carbohydrateMl: 2 });
Object.assign(recurrence.largeIntestine, { fatMl: 0.5, carbohydrateMl: 0 });
Object.assign(recurrence.hormones, { cckPM: 7, glp1PM: 8, pyyPM: 9, ghrelinPM: 100 });
integrateTrackMinute(recurrence, 1);
assert.ok(Math.abs(recurrence.hormones.ghrelinPM - (100 - 0.04 - 0.01 - 0.05 - 0.015 + 0.4)) < 1e-12);

// B/C. The source defines neither a ghrelin floor nor a score clamp.
const rawTrack = createModelTrack({});
rawTrack.hormones.ghrelinPM = -0.468;
rawTrack.hormones.cckPM = 20;
assert.equal(rawTrack.hormones.ghrelinPM, -0.468);
assert.ok(trackSatiety(rawTrack) > 10);
assert.equal(displaySatiety(trackSatiety(rawTrack)), 10);
const artefactState = createPhysiologicalSatiety(T0);
artefactState.status = 'LIVE';
artefactState.statusReason = 'TEST';
artefactState.tracks = [rawTrack];
artefactState.latestKnownIntake = { fullMealMacros: { fatG: 1, carbohydrateG: 1, proteinG: 1 } };
const artefactPublic = physiologicalSatietySnapshot(artefactState);
const artefactAdmin = physiologicalSatietyInspection(artefactState);
assert.equal(artefactPublic.ghrelin.status, 'MODEL_ARTEFACT_OUTSIDE_PHYSICAL_DOMAIN');
assert.equal(JSON.stringify(artefactPublic).includes('-0.468'), false);
assert.equal(artefactAdmin.rawModelState.ghrelin.median, -0.468);
assert.ok(artefactAdmin.physicalDomainViolations.includes('GHRELIN_MODEL_STATE_BELOW_ZERO'));
assert.equal(artefactPublic.displayTransformation.sourceDefinesClamp, false);

// D. Published uniform inputs are represented reproducibly by deterministic QMC.
const firstGrid = buildDeterministicParameterGrid();
assert.deepEqual(firstGrid, buildDeterministicParameterGrid());
assert.equal(firstGrid.length, COMPOSITION_SCENARIOS.length * NUMERICAL_METHOD.samplesPerCompositionScenario);
assert.ok(firstGrid.every((item) => item.fatDensityGPerMl >= 0.7 && item.fatDensityGPerMl <= 0.96));
assert.ok(firstGrid.every((item) => item.snackEatingRateKcalPerMin >= 3.3 && item.snackEatingRateKcalPerMin <= 6.4));

// E/F/G. Central intervals are per scenario; composition is non-probabilistic and has no featured midpoint.
const breakfast = createPhysiologicalSatiety(T0);
observePhysiologicalSatietyRecord(breakfast, event('breakfast', 'breakfast', 'full_consumed', 'full', 'full', 1));
assert.equal(breakfast.tracks.length, 384);
advancePhysiologicalSatiety(breakfast, T0 + 30 * 60000);
const breakfastSnapshot = physiologicalSatietySnapshot(breakfast);
assert.equal(breakfastSnapshot.headline.status, 'INPUT_UNCERTAIN');
assert.equal(breakfastSnapshot.compositionUncertainty.classification, 'MEAL-COMPOSITION SCENARIO RANGE');
assert.equal(breakfastSnapshot.scenarios.length, 3);
assert.equal(COMPOSITION_SCENARIO_DERIVATION.maximumRelativeFatFractionOfNonProteinEnergy, 0.3913);
assert.ok(breakfastSnapshot.scenarios.every((item) => item.publishedInputDistribution.centralIntervalPercent === 95));
assert.ok(breakfastSnapshot.scenarios.every((item) => item.displaySatiety.central95.lower <= item.displaySatiety.median
  && item.displaySatiety.median <= item.displaySatiety.central95.upper));
assert.equal(Object.hasOwn(breakfastSnapshot.scenarioEnvelope, 'midpoint'), false);

const exactBreakfast = createEnvironmentRecord(createEnvironmentEvent('meal', {
  id: 'exact-breakfast', timestamp: new Date(T0).toISOString(),
  world: { physical: { food: {
    meal_type: 'breakfast', scheduled: 'yes', offered: 'yes', available: 'yes', received: 'yes',
    consumed: 'full', intake_outcome: 'full_consumed', portion_category: 'full', portion_fraction: 1,
    nutrition: { energy_kcal: 500, fat_g: 18, carbohydrate_g: 72, protein_g: 22 },
  } } },
}));
const exact = createPhysiologicalSatiety(T0);
observePhysiologicalSatietyRecord(exact, exactBreakfast);
advancePhysiologicalSatiety(exact, T0 + 30 * 60000);
assert.equal(physiologicalSatietySnapshot(exact).headline.status, 'ESTIMATE_AVAILABLE');

// H/I/J. Supper snack is a real unresolved-until-observed event and the food gap is below 14h.
const snackSlot = PRISON_SCHEDULE.find((slot) => slot.kind === 'meal' && slot.meal === 'supper_snack');
assert.equal(snackSlot.mins, PRISON_REGIME_CONFIGURATION.supperSnackMinutes);
assert.equal(PRISON_REGIME_CONFIGURATION.supperSnackClassification, 'FICTIONAL PRISON REGIME CONFIGURATION');
assert.equal(HMPPS_REFERENCE_RATION.mealEnergyKcal.supper_snack, 500);
const scheduledSnack = mealExpectation('supper_snack', 'snack-1');
const snackExpectedRecord = createEnvironmentRecord(createEnvironmentEvent('meal_expected', {
  id: 'snack-expected', timestamp: new Date(T0).toISOString(), world: scheduledSnack.world,
}));
const scheduledOnlySnack = ingestionRecordFromEnvironment(snackExpectedRecord);
assert.equal(scheduledOnlySnack.intakeOutcome, 'MEAL_EXPECTED');
assert.equal(scheduledOnlySnack.consumedEnergyKcal, null);
assert.equal(chooseMealEvent('supper_snack', () => 0.99).world.physical.food.intake_outcome, 'refused');
const mealMinutes = PRISON_SCHEDULE.filter((slot) => slot.kind === 'meal').map((slot) => slot.mins).sort((a, b) => a - b);
const gaps = mealMinutes.map((minute, index) => {
  const next = mealMinutes[(index + 1) % mealMinutes.length] + (index === mealMinutes.length - 1 ? 1440 : 0);
  return next - minute;
});
assert.ok(Math.max(...gaps) <= 14 * 60);

const snackTrack = createModelTrack({ relativeFatFraction: 0.1, fatDensityGPerMl: 0.8,
  carbohydrateDensityGPerMl: 0.8, mealEatingRateKcalPerMin: 30, snackEatingRateKcalPerMin: 4 });
snackTrack.intake = { remainingEnergyKcal: 100, totalEnergyKcal: 100, fatEnergyFraction: 0.42,
  carbohydrateEnergyFraction: 0.42, explicitMacros: null, eatingRateClass: 'SNACK' };
integrateTrackMinute(snackTrack, 1);
assert.equal(snackTrack.intake.remainingEnergyKcal, 96);

// K. Legacy Hunger remains isolated.
const soma = reconcileSoma(null, { now: T0 });
observeSomaFeedingRecord(soma, event('soma-breakfast', 'breakfast', 'full_consumed', 'full', 'full', 1));
tickSoma(soma, { now: T0 + 20 * 60000, physical: { hunger: 1 } });
const beforeLegacy = JSON.stringify(soma.physiologicalSatiety);
soma.experienced.metrics.hunger.value = 0;
soma.drives.food = 0;
assert.equal(JSON.stringify(soma.physiologicalSatiety), beforeLegacy);
assert.doesNotMatch(groundedSomaDirective(soma, { now: T0 + 20 * 60000 }).directive, /\bhungry\b/i);

// L. V1 state provenance is preserved, but old extrema are not relabelled.
const migrated = reconcilePhysiologicalSatiety({ ...breakfast, version: 1,
  modelVersion: 'physiological-satiety-v1', status: 'LIVE', tracks: breakfast.tracks.slice(0, 225) },
{ now: T0 + 60 * 60000 });
assert.equal(migrated.status, 'INPUT_INCOMPLETE');
assert.equal(migrated.tracks.length, 0);
assert.equal(migrated.migrationArchive.previousTrackCount, 225);

const ui = readFileSync(new URL('../public/assets/brain.js', import.meta.url), 'utf8');
assert.match(ui, /SATIETY - INPUT UNCERTAIN/);
assert.doesNotMatch(ui, /ghrelinPM/);
assert.equal(implementationEntry('soma_variables', 'satiety').implementation_status, 'IMPLEMENTED');
assert.equal(implementationEntry('brain_regions', 'hypothalamic').implementation_status, 'NOT_IMPLEMENTED');

console.log(`500 kcal breakfast at 30 min: ${breakfastSnapshot.scenarios.map((scenario) => `${scenario.id} median ${scenario.displaySatiety.median}, central95 ${scenario.displaySatiety.central95.lower}-${scenario.displaySatiety.central95.upper}`).join('; ')}`);
console.log('physiological-satiety.test.js: all checks passed');
