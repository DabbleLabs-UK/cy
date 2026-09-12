import assert from 'node:assert/strict';
import {
  REFERENCE_EVENT_ARCHETYPES,
  createEnvironmentEvent,
  createEnvironmentRecord,
  deserializeEnvironmentRecord,
  serializeEnvironmentRecord,
} from './environment-schema.js';

assert.equal(REFERENCE_EVENT_ARCHETYPES.length, 25);
assert.equal(new Set(REFERENCE_EVENT_ARCHETYPES.map((item) => item.id)).size, 25);
assert.ok(REFERENCE_EVENT_ARCHETYPES.some((item) => item.id === 'ambient_world_event'));

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
assert.equal(record.soma_input.food_offered, 'yes');
assert.equal(record.soma_input.food_available, 'unknown');
assert.equal(record.soma_input.food_received, 'unknown');
assert.equal(record.soma_input.portion_category, 'unknown');
assert.deepEqual(record.soma_input.feeding, record.world_event.world.physical.food);
assert.equal(record.soma_input.nociceptive_impact, 'unknown');
assert.equal(record.soma_input.somatic.tissue.damage_status, 'UNKNOWN');
assert.notEqual(record.soma_input.nociceptive_impact, 'none');
assert.equal(record.soma_input.persistence, 'unknown');
assert.equal(record.soma_input.associative_learning.linkage, 'unknown');
assert.deepEqual(record.soma_input.associative_learning.outcomes, []);
assert.equal(record.soma_input.defensive_context.temporal_status, 'UNKNOWN');
assert.deepEqual(record.soma_input.defensive_context.adverse_outcome_classes, []);
assert.equal(record.soma_input.instrumental.archetype_id, null);
assert.equal(record.soma_input.instrumental.situation_description, null);
assert.deepEqual(record.soma_input.instrumental.remaining_possibilities, []);
assert.equal(record.soma_input.action_opportunity.id, null);
assert.deepEqual(record.soma_input.action_opportunity.available_actions, []);
assert.equal(record.soma_input.action_opportunity.action_actually_executed, 'unknown');
assert.equal(record.soma_input.social.episode_type, 'UNKNOWN');
assert.equal(record.observation.summary, 'lunch arrived and some was eaten');
assert.equal(record.consumed_by[0], 'soma-input-staging-v1');
assert.equal('observation' in record.world_event, false);
assert.equal('appraisal' in record.world_event, false);
assert.equal('appraisal' in record.soma_input, false);
assert.deepEqual(deserializeEnvironmentRecord(serializeEnvironmentRecord(record)), record);

const expectedMeal = createEnvironmentEvent('meal_expected', {
  id: 'env-test-expected-meal',
  timestamp: '2026-09-10 11:45:00.000',
  world: { physical: { food: { meal_type: 'lunch' } } },
});
assert.equal(expectedMeal.world.physical.food.scheduled, 'yes');
assert.equal(expectedMeal.world.physical.food.intake_outcome, 'expected');
assert.equal(expectedMeal.world.physical.food.consumed, 'unknown');

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

const social = createEnvironmentEvent('social_episode', {
  id: 'env-test-social',
  timestamp: '2026-09-10 19:00:00.000',
  world: { social: {
    episode_id: 'social:test', episode_type: 'CONTACT', channel: 'POSTCARD',
    contact_form: 'MESSAGE_RECEIVED', reciprocity: 'ONE_WAY', character: 'UNKNOWN',
  } },
});
assert.equal(createEnvironmentRecord(social).soma_input.social.episode_id, 'social:test');
assert.equal(createEnvironmentRecord(social).soma_input.social.character, 'UNKNOWN');
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
assert.equal(search.world.action_opportunity.chosen_action, 'unknown');
assert.equal(search.world.somatic.tissue.damage_status, 'NONE');

const injury = createEnvironmentEvent('minor_injury', {
  id: 'env-test-injury',
  timestamp: '2026-09-10 12:16:00.000',
});
assert.equal(injury.world.somatic.tissue.damage_status, 'CONFIRMED');
assert.equal(injury.world.somatic.tissue.injury_id, 'injury:env-test-injury');
assert.equal(injury.world.somatic.body.site, 'UNKNOWN');

const encoded = JSON.stringify(record);
for (const forbidden of ['threat_score', 'emotion_score', 'brain_activation', 'appraisal_magnitude']) {
  assert.equal(encoded.includes(forbidden), false);
}

console.log('environment-schema.test.js: all checks passed');
