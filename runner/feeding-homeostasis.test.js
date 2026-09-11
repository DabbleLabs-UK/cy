import assert from 'node:assert/strict';
import {
  createFeedingState,
  feedingInspection,
  feedingSnapshot,
  ingestionRecordFromEnvironment,
  observeFeedingRecord,
  reconcileFeedingState,
} from './feeding-homeostasis.js';
import { createEnvironmentEvent, createEnvironmentRecord } from './environment-schema.js';
import { implementationEntry } from './implementation-registry.js';

const T0 = '2026-09-11 07:30:00.000';
const T1 = '2026-09-11 11:45:00.000';

function record(id, timestamp, food, archetypeId = 'meal') {
  return createEnvironmentRecord(createEnvironmentEvent(archetypeId, {
    id,
    timestamp,
    world: { physical: { food } },
  }));
}

const state = createFeedingState(Date.parse(T0));

const expected = record('expected-lunch', T1, {
  meal_type: 'lunch', scheduled: 'yes', intake_outcome: 'expected',
}, 'meal_expected');
const expectedResult = observeFeedingRecord(state, expected);
assert.equal(expectedResult.record.intakeOutcome, 'MEAL_EXPECTED');
assert.equal(state.lastKnownIntakeAt, null,
  'A: a scheduled meal expectation is not evidence of ingestion');

const full = record('full-lunch', '2026-09-11 11:47:00.000', {
  meal_type: 'lunch', scheduled: 'yes', offered: 'yes', available: 'yes', received: 'yes',
  consumed: 'full', intake_outcome: 'full_consumed', portion_category: 'full', portion_fraction: 1,
});
observeFeedingRecord(state, full);
assert.equal(state.lastKnownIntakeAt, '2026-09-11 11:47:00.000',
  'B: explicit full consumption updates last-known intake');
assert.equal(state.latestResolvedMeal.intakeOutcome, 'FULLY_CONSUMED');

const missed = record('missed-tea', '2026-09-11 16:45:00.000', {
  meal_type: 'tea', scheduled: 'yes', offered: 'no', available: 'no', received: 'no',
  consumed: 'none', intake_outcome: 'unavailable', portion_category: 'none', portion_fraction: 0,
});
observeFeedingRecord(state, missed);
assert.equal(state.lastKnownIntakeAt, '2026-09-11 11:47:00.000');
assert.equal(feedingSnapshot(state, Date.parse('2026-09-11 17:00:00.000')).missedScheduledMeals, 1,
  'C: unavailable scheduled food is counted without inventing Hunger points');
assert.equal('hunger' in feedingSnapshot(state), false);
assert.equal('eventId' in feedingSnapshot(state).recentMealOutcomes[0], false,
  'public feeding summaries do not expose private structured event identifiers');
assert.equal(feedingInspection(state).records[0].eventId, 'expected-lunch',
  'owner inspection retains exact source-event traceability');

const partialKnown = ingestionRecordFromEnvironment(record('partial-known', T0, {
  meal_type: 'breakfast', scheduled: 'yes', offered: 'yes', available: 'yes', received: 'yes',
  consumed: 'partial', intake_outcome: 'partial_consumed', portion_category: 'partial', portion_fraction: 0.5,
}));
assert.equal(partialKnown.portionFraction, 0.5, 'D: observed exact fraction is retained exactly');
assert.equal(partialKnown.portionBasis, 'OBSERVED_EXACT');

const partialUnknown = ingestionRecordFromEnvironment(record('partial-unknown', T0, {
  meal_type: 'breakfast', scheduled: 'yes', offered: 'yes', available: 'yes', received: 'yes',
  consumed: 'partial', intake_outcome: 'partial_consumed', portion_category: 'partial', portion_fraction: null,
}));
assert.equal(partialUnknown.portionFraction, null, 'E: categorical partial intake does not become 0.5');
assert.equal(partialUnknown.portionBasis, 'CATEGORICAL_ONLY');

const refused = ingestionRecordFromEnvironment(record('refused-breakfast', T0, {
  meal_type: 'breakfast', scheduled: 'yes', offered: 'yes', available: 'yes', received: 'yes',
  consumed: 'none', intake_outcome: 'refused', portion_category: 'none', portion_fraction: 0,
}));
assert.equal(refused.intakeOutcome, 'REFUSED');
assert.equal(refused.availabilityStatus, 'AVAILABLE');
assert.notEqual(refused.intakeOutcome, missed.world_event.world.physical.food.intake_outcome.toUpperCase(),
  'F: refused available food remains distinct from unavailable food');

const unknown = record('unknown-dinner', '2026-09-11 18:00:00.000', {
  meal_type: 'dinner', scheduled: 'yes', offered: 'unknown', available: 'unknown', received: 'unknown',
  consumed: 'unknown', intake_outcome: 'unknown', portion_category: 'unknown', portion_fraction: null,
});
const beforeUnknownIntake = state.lastKnownIntakeAt;
observeFeedingRecord(state, unknown);
assert.equal(state.lastKnownIntakeAt, beforeUnknownIntake, 'G: unknown consumption does not become eaten or missed');
assert.equal(state.latestResolvedMeal.intakeOutcome, 'UNKNOWN');

const coldTea = record('cold-tea', '2026-09-11 18:10:00.000', {
  meal_type: 'tea', offered: 'yes', available: 'unknown', received: 'unknown',
  consumed: 'unknown', intake_outcome: 'unknown', portion_category: 'unknown', portion_fraction: null,
});
const coldState = createFeedingState();
observeFeedingRecord(coldState, coldTea);
assert.equal('hunger' in coldState, false, 'H: cold tea cannot create numeric Hunger state');
assert.equal(coldState.lastKnownIntakeAt, null);

const restoredAt = Date.parse('2026-09-11 18:30:00.000');
const restarted = reconcileFeedingState(JSON.parse(JSON.stringify(state)), { now: restoredAt });
assert.deepEqual(restarted.records, state.records, 'I: the complete ingestion ledger survives restart');
assert.equal(restarted.lastKnownIntakeAt, state.lastKnownIntakeAt);
assert.equal(restarted.unknownIntervals.length, 1, 'J: runner downtime becomes an explicit unknown interval');
assert.equal(restarted.unknownIntervals[0].ingestionAssumption, 'NONE_MADE');
assert.equal(feedingInspection(restarted, restoredAt).intakeKnowledgeStatus, 'INCOMPLETE');

const legacyOnly = reconcileFeedingState({
  hunger: 100,
  body: { nutrition: { lastMealAtMs: Date.parse(T0), lastAmount: 1 } },
}, { now: Date.parse(T1) });
assert.equal(legacyOnly.records.length, 0, 'K: legacy Hunger and nutrition mirrors cannot initialize the ledger');
assert.equal(legacyOnly.lastKnownIntakeAt, null);

const beforeProse = JSON.stringify(state);
assert.equal(observeFeedingRecord(state, { generated_text: 'i am starving' }).updated, false);
assert.equal(JSON.stringify(state), beforeProse, 'L: generated prose cannot create feeding or deprivation evidence');

assert.equal(implementationEntry('soma_subsystems', 'feeding_event_model').implementation_status, 'IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'ingestion_ledger').implementation_status, 'IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'feeding_deprivation_history').implementation_status, 'IMPLEMENTED');
assert.equal(implementationEntry('soma_variables', 'hunger').implementation_status, 'PROVISIONAL');
assert.equal(implementationEntry('soma_subsystems', 'energy_homeostatic_state').implementation_status, 'NOT_IMPLEMENTED');
assert.notEqual(implementationEntry('brain_regions', 'hypothalamic').implementation_status, 'IMPLEMENTED',
  'M: feeding facts do not make the hypothalamic analogy LIVE');

console.log('feeding-homeostasis.test.js: all checks passed');
