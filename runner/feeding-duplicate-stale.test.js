// feeding-duplicate-stale.test.js
//
// A re-delivered (duplicate) environment event must never be counted twice by
// either the feeding intake ledger or the physiological satiety model, and a
// stale out-of-order record must not corrupt the last-known-intake ordering.

import assert from 'node:assert/strict';
import { createEnvironmentEvent, createEnvironmentRecord } from './environment-schema.js';
import { createFeedingState, observeFeedingRecord } from './feeding-homeostasis.js';
import { createPhysiologicalSatiety, observePhysiologicalSatietyRecord } from './physiological-satiety.js';

const T0 = Date.parse('2026-09-12T07:30:00.000Z');
const event = (id, mealType, intakeOutcome, consumed, portionCategory, portionFraction = null, at = T0) =>
  createEnvironmentRecord(createEnvironmentEvent('meal', {
    id, timestamp: new Date(at).toISOString(),
    world: { physical: { food: {
      meal_type: mealType, scheduled: 'yes', offered: 'yes', available: 'yes', received: 'yes',
      consumed, intake_outcome: intakeOutcome, portion_category: portionCategory,
      portion_fraction: portionFraction,
    } } },
  }));

// Duplicate into the feeding ledger.
const feeding = createFeedingState(T0);
const breakfast = event('dup-breakfast', 'breakfast', 'full_consumed', 'full', 'full', 1);
const first = observeFeedingRecord(feeding, breakfast);
assert.equal(first.updated, true, 'the first delivery of a feeding record is recorded');
const second = observeFeedingRecord(feeding, breakfast);
assert.equal(second.updated, false, 'the re-delivered feeding record is not recorded again');
assert.equal(second.reason, 'duplicate_event');
assert.equal(feeding.records.length, 1, 'a duplicate feeding event does not add a second ledger row');

// Duplicate into the physiological satiety model (also the initialising anchor).
const satiety = createPhysiologicalSatiety(T0);
const anchor = observePhysiologicalSatietyRecord(satiety, breakfast);
assert.equal(anchor.updated, true, 'the clean breakfast anchor initialises the model');
assert.equal(satiety.status, 'LIVE');
const historyLength = satiety.intakeHistory.length;
const dup = observePhysiologicalSatietyRecord(satiety, breakfast);
assert.equal(dup.updated, false, 'a duplicate intake is rejected by the satiety model');
assert.equal(dup.reason, 'duplicate_event');
assert.equal(satiety.intakeHistory.length, historyLength,
  'a duplicate intake does not extend the satiety intake history');

// Duplicate detection keys on the event id, not the timestamp: a distinct record
// that reuses an earlier meal type at a stale timestamp is still a new record and
// does not collapse into an existing one.
const lunch = event('later-lunch', 'lunch', 'full_consumed', 'full', 'full', 1, T0 + 4 * 60 * 60 * 1000);
observeFeedingRecord(feeding, lunch);
assert.equal(feeding.lastKnownIntakeEventId, 'later-lunch');
const staleTea = event('stale-tea', 'breakfast', 'full_consumed', 'full', 'full', 1, T0 - 60 * 60 * 1000);
const staleResult = observeFeedingRecord(feeding, staleTea);
assert.equal(staleResult.updated, true,
  'a distinct record with an older timestamp is accepted, not mistaken for a duplicate of the same meal type');
assert.equal(feeding.records.length, 3, 'the stale distinct record is retained in the ledger');

console.log('feeding-duplicate-stale.test.js: all checks passed');
