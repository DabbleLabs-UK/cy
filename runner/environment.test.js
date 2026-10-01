import assert from 'node:assert/strict';
import {
  PRISON_SCHEDULE,
  PRISON_REGIME_CONFIGURATION,
  chooseMealEvent,
  chooseRoutineEvent,
  mealExpectation,
  materialiseScheduledEvent,
  materialiseRoutineOutcome,
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
assert.equal('action_opportunity' in linked.world, false,
  'a randomly rolled meal outcome must never assert a fabricated accept/refuse action_opportunity');

const partial = chooseMealEvent('lunch', () => 0.9);
assert.equal(partial.provisional.body.meal.outcome, 'partial');
assert.ok(partial.provisional.body.meal.amount > 0 && partial.provisional.body.meal.amount < 1);
assert.equal(partial.world.physical.food.intake_outcome, 'partial_consumed');
assert.equal(partial.world.physical.food.portion_category, 'partial');
assert.equal(partial.world.physical.food.portion_fraction, 0.45);
assert.deepEqual(partial.world.associative_learning.outcomes,
  [{ outcome_class: 'DEPRIVATION_OR_LOSS', status: 'unknown' }]);
assert.equal('action_opportunity' in partial.world, false);

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

const refused = chooseMealEvent('tea', () => 0.99);
assert.equal(refused.provisional.body.meal.outcome, 'refused');
assert.equal(refused.world.physical.food.offered, 'yes');
assert.equal(refused.world.physical.food.available, 'yes');
assert.equal(refused.world.physical.food.received, 'yes');
assert.equal(refused.world.physical.food.intake_outcome, 'refused');
assert.equal('action_opportunity' in refused.world, false,
  'a randomly rolled refusal outcome must never be relabelled as an executed refuse_meal action');

const snackExpected = mealExpectation('supper_snack', '2026-09-11:supper_snack');
assert.equal(snackExpected.world.physical.food.meal_type, 'supper snack');
const snackRefused = chooseMealEvent('supper_snack', () => 0.99);
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
