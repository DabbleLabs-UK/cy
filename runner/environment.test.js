import assert from 'node:assert/strict';
import {
  PRISON_SCHEDULE,
  PRISON_REGIME_CONFIGURATION,
  chooseMealEvent,
  chooseRoutineEvent,
  mealExpectation,
  materialiseScheduledEvent,
} from './environment.js';

assert.ok(PRISON_SCHEDULE.some((slot) => slot.kind === 'meal' && slot.meal === 'breakfast'));
assert.ok(PRISON_SCHEDULE.some((slot) => slot.kind === 'routine' && slot.routine === 'phone'));
assert.ok(PRISON_SCHEDULE.some((slot) => slot.kind === 'meal' && slot.meal === 'supper_snack'));
assert.equal(PRISON_REGIME_CONFIGURATION.supperSnackClassification, 'FICTIONAL PRISON REGIME CONFIGURATION');

const eaten = chooseMealEvent('breakfast', () => 0.1);
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
  [{ outcome_class: 'DEPRIVATION_OR_LOSS', status: 'did_not_occur' }]);
assert.equal(eaten.world.defensive_context.temporal_status, 'RESOLVED');

const expected = mealExpectation('lunch', '2026-09-11:lunch');
assert.equal(expected.archetypeId, 'meal_expected');
assert.equal(expected.world.physical.food.meal_id, '2026-09-11:lunch');
assert.equal(expected.world.physical.food.meal_type, 'lunch');
const linked = chooseMealEvent('lunch', () => 0.1, { mealId: '2026-09-11:lunch' });
assert.equal(linked.world.physical.food.meal_id, expected.world.physical.food.meal_id);
assert.equal(linked.world.action_opportunity.id, 'meal:2026-09-11:lunch');
assert.equal(linked.world.action_opportunity.context_id, 'meal:lunch');
assert.deepEqual(linked.world.action_opportunity.available_actions,
  ['action:accept_meal', 'action:refuse_meal']);
assert.equal(linked.world.action_opportunity.chosen_action, 'action:accept_meal');
assert.equal(linked.world.action_opportunity.action_actually_executed, 'action:accept_meal');
assert.equal(linked.world.action_opportunity.execution_status, 'EXECUTED');

const partial = chooseMealEvent('lunch', () => 0.9);
assert.equal(partial.provisional.body.meal.outcome, 'partial');
assert.ok(partial.provisional.body.meal.amount > 0 && partial.provisional.body.meal.amount < 1);
assert.equal(partial.world.physical.food.intake_outcome, 'partial_consumed');
assert.equal(partial.world.physical.food.portion_category, 'partial');
assert.equal(partial.world.physical.food.portion_fraction, 0.45);
assert.deepEqual(partial.world.associative_learning.outcomes,
  [{ outcome_class: 'DEPRIVATION_OR_LOSS', status: 'unknown' }]);

const missed = chooseMealEvent('tea', () => 0.95);
assert.equal(missed.provisional.body.meal.outcome, 'missed');
assert.equal(missed.provisional.body.meal.amount, 0);
assert.equal(missed.world.physical.food.offered, 'no');
assert.equal(missed.world.physical.food.available, 'no');
assert.equal(missed.world.physical.food.received, 'no');
assert.equal(missed.world.physical.food.intake_outcome, 'unavailable');
assert.deepEqual(missed.world.associative_learning.outcomes,
  [{ outcome_class: 'DEPRIVATION_OR_LOSS', status: 'occurred' }]);
assert.deepEqual(missed.world.action_opportunity.available_actions, []);
assert.equal(missed.world.action_opportunity.execution_status, 'NOT_AVAILABLE');
assert.equal(missed.world.action_opportunity.action_actually_executed, 'NOT_AVAILABLE');

const refused = chooseMealEvent('tea', () => 0.99);
assert.equal(refused.provisional.body.meal.outcome, 'refused');
assert.equal(refused.world.physical.food.offered, 'yes');
assert.equal(refused.world.physical.food.available, 'yes');
assert.equal(refused.world.physical.food.received, 'yes');
assert.equal(refused.world.physical.food.intake_outcome, 'refused');
assert.equal(refused.world.action_opportunity.chosen_action, 'action:refuse_meal');
assert.equal(refused.world.action_opportunity.execution_status, 'EXECUTED');

const snackExpected = mealExpectation('supper_snack', '2026-09-11:supper_snack');
assert.equal(snackExpected.world.physical.food.meal_type, 'supper snack');
const snackRefused = chooseMealEvent('supper_snack', () => 0.99);
assert.equal(snackRefused.world.physical.food.intake_outcome, 'refused');

const supportive = chooseRoutineEvent('association', () => 0.5);
assert.equal(supportive.provisional.social.quality, 'supportive');
assert.ok(supportive.provisional.appraisal.affiliation > 0.5);
assert.equal(supportive.archetypeId, 'friendly_interaction');

const interrupted = materialiseScheduledEvent({ kind: 'sleep', mins: 0 });
assert.equal(interrupted.provisional.body.sleep.outcome, 'started');
assert.equal(interrupted.world.physical.sleep.state, 'sleep_period');

console.log('environment.test.js: all checks passed');
