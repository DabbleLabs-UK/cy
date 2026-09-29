import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEnvironmentEvent, createEnvironmentRecord } from './environment-schema.js';
import { PRISON_REGIME_CONFIGURATION, PRISON_SCHEDULE, chooseMealEvent, mealExpectation } from './environment.js';
import { HMPPS_REFERENCE_RATION, ingestionRecordFromEnvironment } from './feeding-homeostasis.js';
import { groundedSomaDirective, observeSomaFeedingRecord, reconcileSoma, tickSoma } from './soma.js';
import {
  COMPOSITION_SCENARIOS, COMPOSITION_SCENARIO_DERIVATION, NUMERICAL_METHOD, PHYSIOLOGICAL_SATIETY_VERSION,
  PHYSIOLOGICAL_SATIETY_MODEL_VERSION, GASTRIC_FULLNESS_ENVELOPE, advancePhysiologicalSatiety,
  buildDeterministicParameterGrid, createModelTrack, createPhysiologicalSatiety,
  displaySatiety, gastricDistention, gastricFullnessBand, gastricFullnessNormalized,
  integrateTrackMinute, observePhysiologicalSatietyRecord,
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

// A. The gastric/hormone recurrence is unchanged; the composite's PYY/GLP1
// term is now additive (Table 1 supports independent effects, not a product -
// see sourceAudit.satietyPyyGlp1Interaction). This is diagnostic-only: it
// never touches the promoted gastric-fullness signal.
assert.equal(satietyFromState({ gastricDistentionMl: 400, cckPM: 2, pyyPM: 3, glp1PM: 4, ghrelinPM: 100 }),
  0.0025 * 400 + 1.2 * 2 + 0.08 * 3 + 0.2 * 4 + 0.02 * 10);
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
artefactState.compositionKnowledge = 'OBSERVED_EXACT';
artefactState.latestKnownIntake = { fullMealMacros: { fatG: 1, carbohydrateG: 1, proteinG: 1 } };
const artefactPublic = physiologicalSatietySnapshot(artefactState);
const artefactAdmin = physiologicalSatietyInspection(artefactState);
assert.equal(artefactPublic.ghrelin.status, 'MODEL_ARTEFACT_OUTSIDE_PHYSICAL_DOMAIN');
assert.equal(JSON.stringify(artefactPublic).includes('-0.468'), false);
assert.equal(artefactAdmin.rawModelState.ghrelin.median, -0.468);
assert.ok(artefactAdmin.physicalDomainViolations.includes('GHRELIN_MODEL_STATE_BELOW_ZERO'));
assert.equal(artefactPublic.displayTransformation.classification, 'DISPLAY ONLY');
assert.equal(artefactPublic.displayTransformation.envelope.classification, 'DERIVED VISUALIZATION ENVELOPE');
// The ghrelin artefact must not corrupt the promoted fullness signal, which
// never reads hormone state - it stays a normal, valid EMPTY-stomach reading.
assert.equal(artefactPublic.headline.status, 'ESTIMATE_AVAILABLE');
assert.equal(artefactPublic.headline.band, 'EMPTY');
assert.equal(artefactPublic.headline.normalizedPercent, 0);
// The hormone composite itself is demoted to inspection-only.
assert.equal(Object.hasOwn(artefactPublic, 'scenarios') && artefactPublic.scenarios.some((s) => Object.hasOwn(s, 'displaySatiety')), false);
assert.ok(artefactAdmin.rawModelState.satiety.median > 10);

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
// The composite hormone score is demoted to inspection-only; the public
// scenario shape now carries gastric fullness instead.
assert.ok(breakfastSnapshot.scenarios.every((item) => Object.hasOwn(item, 'displaySatiety') === false));
assert.ok(breakfastSnapshot.scenarios.every((item) => item.gastricFullness.central95Ml.lower <= item.gastricFullness.medianMl
  && item.gastricFullness.medianMl <= item.gastricFullness.central95Ml.upper));
assert.ok(breakfastSnapshot.scenarios.every((item) => ['EMPTY', 'SETTLING', 'COMFORTABLY_FULL', 'VERY_FULL'].includes(item.gastricFullness.band)));
assert.equal(Object.hasOwn(breakfastSnapshot.scenarioEnvelope, 'midpoint'), false);
assert.ok(Object.hasOwn(breakfastSnapshot.scenarioEnvelope, 'minimumScenarioMedianMl'));
const admin = physiologicalSatietyInspection(breakfast);
// The hormone composite remains available - as supporting/diagnostic physiology only.
assert.equal(admin.rawModelState.scenarios.length, 3);
assert.ok(admin.rawModelState.scenarios.every((item) => Number.isFinite(item.satiety.median)));

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
const exactSnapshot = physiologicalSatietySnapshot(exact);
assert.equal(exactSnapshot.headline.status, 'ESTIMATE_AVAILABLE');
assert.equal(exactSnapshot.headline.label, 'FULLNESS');
assert.ok(Number.isFinite(exactSnapshot.headline.gastricDistentionMl));
assert.ok(exactSnapshot.headline.gastricDistentionMl >= GASTRIC_FULLNESS_ENVELOPE.baselineMl);
assert.ok(Number.isFinite(exactSnapshot.headline.normalizedPercent));
assert.ok(['EMPTY', 'SETTLING', 'COMFORTABLY_FULL', 'VERY_FULL'].includes(exactSnapshot.headline.band));
assert.equal(Object.hasOwn(exactSnapshot.headline, 'estimate'), false);

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

// M. V2 (hormone-composite-headline) state is re-anchored under v3
// (gastric-fullness-headline); the observed meal ledger survives, the old
// track ensemble does not carry forward as though it still meant fullness.
assert.equal(PHYSIOLOGICAL_SATIETY_VERSION, 3);
assert.equal(PHYSIOLOGICAL_SATIETY_MODEL_VERSION, 'physiological-satiety-v3');
const migratedV2 = reconcilePhysiologicalSatiety({ ...breakfast, version: 2,
  modelVersion: 'physiological-satiety-v2', status: 'LIVE', tracks: breakfast.tracks.slice(0, 100),
  latestKnownIntake: breakfast.latestKnownIntake, intakeHistory: breakfast.intakeHistory },
{ now: T0 + 60 * 60000 });
assert.equal(migratedV2.status, 'INPUT_INCOMPLETE');
assert.equal(migratedV2.version, PHYSIOLOGICAL_SATIETY_VERSION);
assert.equal(migratedV2.tracks.length, 0);
assert.equal(migratedV2.migrationArchive.fromVersion, 2);
assert.equal(migratedV2.migrationArchive.fromModelVersion, 'physiological-satiety-v2');
assert.equal(migratedV2.migrationArchive.previousTrackCount, 100);
assert.match(migratedV2.migrationArchive.disposition, /GASTRIC-FULLNESS HEADLINE PROMOTED/);
assert.equal(migratedV2.intakeHistory.length, breakfast.intakeHistory.length);
assert.deepEqual(migratedV2.latestKnownIntake, breakfast.latestKnownIntake);

// N. Gastric-fullness envelope/band math: reuses the source's own 296/500 mL
// breakpoints for its lower edges; only the top (reference-full) edge is a
// new derived engineering value, and raw mL is never clamped past it.
assert.equal(GASTRIC_FULLNESS_ENVELOPE.baselineMl, 296);
assert.ok(GASTRIC_FULLNESS_ENVELOPE.referenceFullMl > 500);
assert.equal(gastricDistention(createModelTrack({})), 296);
assert.equal(gastricFullnessBand(296), 'EMPTY');
assert.equal(gastricFullnessBand(297), 'SETTLING');
assert.equal(gastricFullnessBand(499.99), 'SETTLING');
assert.equal(gastricFullnessBand(500), 'COMFORTABLY_FULL');
assert.equal(gastricFullnessBand(GASTRIC_FULLNESS_ENVELOPE.referenceFullMl), 'VERY_FULL');
assert.equal(gastricFullnessNormalized(296).percent, 0);
assert.equal(gastricFullnessNormalized(296).capped, false);
assert.equal(gastricFullnessNormalized(GASTRIC_FULLNESS_ENVELOPE.referenceFullMl - 1).percent < 100, true);
assert.equal(gastricFullnessNormalized(GASTRIC_FULLNESS_ENVELOPE.referenceFullMl - 1).capped, false);
assert.equal(gastricFullnessNormalized(GASTRIC_FULLNESS_ENVELOPE.referenceFullMl + 500).percent, 100);
assert.equal(gastricFullnessNormalized(GASTRIC_FULLNESS_ENVELOPE.referenceFullMl + 500).capped, true);

const ui = readFileSync(new URL('../public/assets/brain.js', import.meta.url), 'utf8');
// Scenario-bounded (not exactly observed) is the common case, not an edge
// case - the UI must surface the model's real computed scenario envelope
// range rather than a bare "uncertain" label. Gastric fullness never reads
// hormone state, so - unlike the retired hormone composite - it needs no
// ghrelin-artefact gate; the UI must not render raw hormone concentrations.
assert.match(ui, /scenarioEnvelope/);
assert.match(ui, /normalizedPercent/);
assert.doesNotMatch(ui, /ghrelinPM/);
assert.doesNotMatch(ui, /displaySatiety/);
assert.equal(implementationEntry('soma_variables', 'satiety').implementation_status, 'IMPLEMENTED');
assert.equal(implementationEntry('brain_regions', 'hypothalamic').implementation_status, 'NOT_IMPLEMENTED');

console.log(`500 kcal breakfast at 30 min: ${breakfastSnapshot.scenarios.map((scenario) => `${scenario.id} median ${scenario.gastricFullness.medianMl} mL (${scenario.gastricFullness.normalizedPercent}%, ${scenario.gastricFullness.band}), central95 ${scenario.gastricFullness.central95Ml.lower}-${scenario.gastricFullness.central95Ml.upper} mL`).join('; ')}`);
console.log('physiological-satiety.test.js: all checks passed');
