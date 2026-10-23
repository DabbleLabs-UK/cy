import assert from 'node:assert/strict';
import {
  PRISON_SCHEDULE,
  PRISON_REGIME_CONFIGURATION,
  chooseMealEvent,
  chooseRoutineEvent,
  mealExpectation,
  materialiseMealConsumption,
  mealUnknownConsumption,
  materialiseScheduledEvent,
  materialiseRoutineOutcome,
} from './environment.js';
import { createEnvironmentEvent, createEnvironmentRecord } from './environment-schema.js';
import { ingestionRecordFromEnvironment } from './feeding-homeostasis.js';
import { actionOpportunityFromEnvironment } from './action-outcome-contingency.js';

const recordFor = (built) => createEnvironmentRecord(createEnvironmentEvent(built.archetypeId, {
  id: built.name, timestamp: '2026-09-11 07:30:00.000', world: built.world, observation: built.observation,
}));

assert.ok(PRISON_SCHEDULE.some((slot) => slot.kind === 'meal' && slot.meal === 'breakfast'));
assert.ok(PRISON_SCHEDULE.some((slot) => slot.kind === 'routine' && slot.routine === 'phone'));
assert.ok(PRISON_SCHEDULE.some((slot) => slot.kind === 'meal' && slot.meal === 'supper_snack'));
assert.equal(PRISON_REGIME_CONFIGURATION.supperSnackClassification, 'FICTIONAL PRISON REGIME CONFIGURATION');

for (const roll of [0, 0.1, 0.82, 0.9, 0.929999, 0.98, 0.99, 1]) {
  const available = chooseMealEvent('breakfast', () => roll, { mealId: 'breakfast-1' });
  assert.equal(available.public.outcome, 'available');
  assert.equal(available.archetypeId, 'ambient_world_event');
  assert.deepEqual(available.world.meal_availability,
    { meal_id: 'breakfast-1', meal_type: 'breakfast', available: true });
  assert.equal('physical' in available.world, false);
  assert.equal(available.provisional, null);
  assert.equal('action_opportunity' in available.world, false);
  assert.equal(ingestionRecordFromEnvironment(recordFor(available)), null,
    'delivery availability must not register an unresolved feeding input before Cy decides');
}
for (const roll of [0.93, 0.95, 0.979999]) {
  assert.equal(chooseMealEvent('tea', () => roll).public.outcome, 'missed');
}

const eaten = materialiseMealConsumption('breakfast', 'eat', {
  mealId: 'breakfast-1', availabilityEventId: 'available-1', decisionId: 'decision-1',
});
assert.equal(eaten.provisional.body.meal.outcome, 'eaten');
assert.equal(eaten.provisional.body.meal.amount, 1);
assert.equal(eaten.world.physical.food.consumed, 'full');
assert.equal(eaten.world.physical.food.available, 'yes');
assert.equal(eaten.world.physical.food.received, 'yes');
assert.equal(eaten.world.physical.food.intake_outcome, 'full_consumed');
assert.equal(eaten.world.physical.food.portion_category, 'full');
assert.equal(eaten.world.physical.food.portion_fraction, 1);
assert.match(eaten.text, /ate it/);
assert.deepEqual(eaten.world.associative_learning.outcomes,
  [{ outcome_class: 'DEPRIVATION_OR_LOSS', status: 'unknown' }]);
assert.equal(eaten.world.defensive_context.temporal_status, 'RESOLVED');
assert.deepEqual(eaten.world.context.previous_event_ids, ['available-1']);
assert.deepEqual(eaten.world.meal_decision, {
  meal_id: 'breakfast-1', availability_event_id: 'available-1', decision_id: 'decision-1',
  action: 'eat', status: 'CY_DECISION',
});
const opportunity = actionOpportunityFromEnvironment(recordFor(eaten));
assert.equal(opportunity.chosenAction, 'action:eat_meal');
assert.equal(opportunity.actionActuallyExecuted, 'action:eat_meal');
assert.equal(opportunity.executionStatus, 'EXECUTED');
assert.equal(opportunity.resolutionStatus, 'RESOLVED');
assert.match(opportunity.opportunityId, /^meal-choice-v1:/);
assert.match(opportunity.contextId, /^meal-choice-v1:/);
assert.deepEqual(opportunity.availableActions, ['action:eat_meal', 'action:decline_meal']);
assert.deepEqual(opportunity.outcomeResolution, [], 'eating does not establish a psychological outcome');

const expected = mealExpectation('lunch', '2026-09-11:lunch');
assert.equal(expected.archetypeId, 'meal_expected');
assert.equal(expected.world.physical.food.meal_id, '2026-09-11:lunch');
assert.equal(expected.world.physical.food.meal_type, 'lunch');
const linked = chooseMealEvent('lunch', () => 0.1, { mealId: '2026-09-11:lunch' });
assert.equal(linked.world.meal_availability.meal_id, expected.world.physical.food.meal_id);
assert.equal('action_opportunity' in linked.world, false,
  'a randomly rolled meal outcome must never assert a fabricated accept/refuse action_opportunity');

const missed = chooseMealEvent('tea', () => 0.95);
assert.equal(missed.provisional.body.meal.outcome, 'missed');
assert.equal(missed.provisional.body.meal.amount, 0);
assert.equal(missed.world.physical.food.offered, 'no');
assert.equal(missed.world.physical.food.available, 'no');
assert.equal(missed.world.physical.food.received, 'no');
assert.equal(missed.world.physical.food.intake_outcome, 'unavailable');
assert.deepEqual(missed.world.associative_learning.outcomes,
  [{ outcome_class: 'DEPRIVATION_OR_LOSS', status: 'occurred' }]);
assert.equal('action_opportunity' in missed.world, false,
  'a missed meal is a world fact, not an action opportunity - food never arrived, so no action was ever on offer');

const refused = materialiseMealConsumption('tea', 'decline', {
  mealId: 'tea-1', availabilityEventId: 'available-tea-1', decisionId: 'decision-tea-1',
});
assert.equal(refused.provisional.body.meal.outcome, 'refused');
assert.equal(refused.world.physical.food.offered, 'yes');
assert.equal(refused.world.physical.food.available, 'yes');
assert.equal(refused.world.physical.food.received, 'yes');
assert.equal(refused.world.physical.food.intake_outcome, 'refused');
assert.equal(refused.provisional.body.meal.amount, 0);
assert.equal(refused.world.action_opportunity.chosen_action, 'action:decline_meal');
assert.match(refused.text, /chose not to eat/);
assert.doesNotMatch(refused.text, /could not|appetite|unwell/);
assert.deepEqual(refused.world.action_opportunity.outcome_resolution, []);
assert.equal(refused.world.associative_learning.outcomes[0].status, 'unknown');

const unknown = mealUnknownConsumption('tea', {
  mealId: 'tea-1', availabilityEventId: 'available-tea-1', decisionId: 'decision-tea-1',
});
assert.equal(unknown.name, 'tea_unknown');
assert.equal(unknown.world.physical.food.offered, 'yes');
assert.equal(unknown.world.physical.food.available, 'yes');
assert.equal(unknown.world.physical.food.received, 'yes');
assert.equal(unknown.world.physical.food.consumed, 'UNKNOWN');
assert.equal(unknown.world.physical.food.intake_outcome, 'UNKNOWN');
assert.equal(unknown.world.physical.food.portion_category, 'UNKNOWN');
assert.equal(unknown.world.physical.food.portion_fraction, null);
assert.equal(unknown.world.meal_decision.status, 'NO_VALID_CY_DECISION');
assert.equal(unknown.world.meal_decision.action, null);
assert.deepEqual(unknown.world.context.previous_event_ids, ['available-tea-1']);
assert.equal(unknown.provisional, null);
assert.equal('action_opportunity' in unknown.world, false);
assert.match(unknown.text, /not established/);
assert.equal(ingestionRecordFromEnvironment(recordFor(unknown)).intakeOutcome, 'UNKNOWN');
assert.equal(ingestionRecordFromEnvironment(recordFor(unknown)).consumedFraction, null);
for (const action of [null, undefined, 'partial', 'refuse', 'EAT']) {
  assert.throws(() => materialiseMealConsumption('tea', action), /unknown meal consumption action/);
}

const snackExpected = mealExpectation('supper_snack', '2026-09-11:supper_snack');
assert.equal(snackExpected.world.physical.food.meal_type, 'supper snack');
const snackRefused = materialiseMealConsumption('supper_snack', 'decline');
assert.equal(snackRefused.world.physical.food.intake_outcome, 'refused');

const supportive = chooseRoutineEvent('association', () => 0.5);
assert.equal(supportive.provisional.social.quality, 'supportive');
assert.ok(supportive.provisional.appraisal.affiliation > 0.5);
assert.equal(supportive.archetypeId, 'friendly_interaction');
for (const [routine, name] of [
  ['phone', 'phone_no_answer'],
  ['phone', 'phone_call_connected'],
  ['shower', 'shower_warm'],
  ['association', 'association_quiet_company'],
]) {
  const picked = chooseRoutineEvent(routine, () => 0);
  const restored = materialiseRoutineOutcome(name);
  assert.equal(restored.name, name);
  assert.equal(restored.world.context.location, routine);
  assert.equal(picked.name.startsWith(`${routine}_`), true);
}
assert.throws(() => materialiseRoutineOutcome('phone_nonexistent'), /unknown prison routine outcome/);

const interrupted = materialiseScheduledEvent({ kind: 'sleep', mins: 0 });
assert.equal(interrupted.provisional.body.sleep.outcome, 'started');
assert.equal(interrupted.world.physical.sleep.state, 'sleep_period');

console.log('environment.test.js: all checks passed');
