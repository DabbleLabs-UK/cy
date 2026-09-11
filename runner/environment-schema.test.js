import assert from 'node:assert/strict';
import {
  REFERENCE_EVENT_ARCHETYPES,
  createEnvironmentEvent,
  createEnvironmentRecord,
  deserializeEnvironmentRecord,
  serializeEnvironmentRecord,
} from './environment-schema.js';

assert.equal(REFERENCE_EVENT_ARCHETYPES.length, 19);
assert.equal(new Set(REFERENCE_EVENT_ARCHETYPES.map((item) => item.id)).size, 19);

const event = createEnvironmentEvent('meal', {
  id: 'env-test-meal',
  timestamp: '2026-09-10 12:00:00.000',
  eventType: 'lunch_partial',
  world: {
    physical: { food: { offered: 'yes', consumed: 'partial', portion_fraction: 0.45 } },
  },
  observation: { summary: 'lunch arrived and some was eaten', observed_facts: { tray_seen: true } },
});
const record = createEnvironmentRecord(event, { consumedBy: ['soma-input-staging-v1'] });
assert.equal(record.world_event.world.physical.food.consumed, 'partial');
assert.equal(record.soma_input.food_consumed, 'partial');
assert.equal(record.soma_input.nociceptive_impact, 'unknown');
assert.notEqual(record.soma_input.nociceptive_impact, 'none');
assert.equal(record.soma_input.persistence, 'unknown');
assert.equal(record.soma_input.associative_learning.linkage, 'unknown');
assert.deepEqual(record.soma_input.associative_learning.outcomes, []);
assert.equal(record.soma_input.defensive_context.temporal_status, 'UNKNOWN');
assert.deepEqual(record.soma_input.defensive_context.adverse_outcome_classes, []);
assert.equal(record.observation.summary, 'lunch arrived and some was eaten');
assert.equal(record.consumed_by[0], 'soma-input-staging-v1');
assert.equal('observation' in record.world_event, false);
assert.equal('appraisal' in record.world_event, false);
assert.equal('appraisal' in record.soma_input, false);
assert.deepEqual(deserializeEnvironmentRecord(serializeEnvironmentRecord(record)), record);

assert.throws(
  () => createEnvironmentEvent('cell_search', {
    id: 'env-test-illegal-appraisal',
    timestamp: '2026-09-10 12:01:00.000',
    world: { appraisal: { anxiety: 0.8 } },
  }),
  /model output, not an environment fact/,
);

const persistent = createEnvironmentEvent('persistent_night_noise', {
  id: 'env-test-noise',
  timestamp: '2026-09-10 23:00:00.000',
});
assert.equal(persistent.world.temporal.persistence, 'ongoing');
assert.equal(createEnvironmentRecord(persistent).soma_input.recurrence, 'repeated');

const forcedWake = createEnvironmentEvent('forced_wakefulness', {
  id: 'env-test-forced-wake',
  timestamp: '2026-09-10 23:15:00.000',
});
assert.equal(createEnvironmentRecord(forcedWake).soma_input.sleep_period, 'forced_wakefulness');
assert.equal(createEnvironmentRecord(forcedWake).soma_input.sleep_interruption, 'present');

const search = createEnvironmentEvent('cell_search', {
  id: 'env-test-search',
  timestamp: '2026-09-10 12:15:00.000',
});
assert.deepEqual(search.world.associative_learning.outcomes, [
  { outcome_class: 'COERCIVE_LOSS_OF_CONTROL', status: 'occurred' },
  { outcome_class: 'PHYSICAL_HARM', status: 'did_not_occur' },
]);
assert.equal(search.world.defensive_context.temporal_status, 'RESOLVED');
assert.deepEqual(search.world.defensive_context.adverse_outcome_classes,
  ['COERCIVE_LOSS_OF_CONTROL', 'PHYSICAL_HARM']);

const encoded = JSON.stringify(record);
for (const forbidden of ['threat_score', 'emotion_score', 'brain_activation', 'appraisal_magnitude']) {
  assert.equal(encoded.includes(forbidden), false);
}

console.log('environment-schema.test.js: all checks passed');
