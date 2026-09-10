import assert from 'node:assert/strict';
import {
  PRISON_SCHEDULE,
  chooseMealEvent,
  chooseRoutineEvent,
  materialiseScheduledEvent,
} from './environment.js';

assert.ok(PRISON_SCHEDULE.some((slot) => slot.kind === 'meal' && slot.meal === 'breakfast'));
assert.ok(PRISON_SCHEDULE.some((slot) => slot.kind === 'routine' && slot.routine === 'phone'));

const eaten = chooseMealEvent('breakfast', () => 0.1);
assert.equal(eaten.provisional.body.meal.outcome, 'eaten');
assert.equal(eaten.provisional.body.meal.amount, 1);
assert.equal(eaten.world.physical.food.consumed, 'full');
assert.match(eaten.text, /ate it/);
assert.deepEqual(eaten.world.associative_learning.outcomes,
  [{ outcome_class: 'DEPRIVATION_OR_LOSS', status: 'did_not_occur' }]);

const partial = chooseMealEvent('lunch', () => 0.9);
assert.equal(partial.provisional.body.meal.outcome, 'partial');
assert.ok(partial.provisional.body.meal.amount > 0 && partial.provisional.body.meal.amount < 1);
assert.deepEqual(partial.world.associative_learning.outcomes,
  [{ outcome_class: 'DEPRIVATION_OR_LOSS', status: 'unknown' }]);

const missed = chooseMealEvent('tea', () => 0.95);
assert.equal(missed.provisional.body.meal.outcome, 'missed');
assert.equal(missed.provisional.body.meal.amount, 0);
assert.deepEqual(missed.world.associative_learning.outcomes,
  [{ outcome_class: 'DEPRIVATION_OR_LOSS', status: 'occurred' }]);

const refused = chooseMealEvent('tea', () => 0.99);
assert.equal(refused.provisional.body.meal.outcome, 'refused');

const supportive = chooseRoutineEvent('association', () => 0.5);
assert.equal(supportive.provisional.social.quality, 'supportive');
assert.ok(supportive.provisional.appraisal.affiliation > 0.5);
assert.equal(supportive.archetypeId, 'friendly_interaction');

const interrupted = materialiseScheduledEvent({ kind: 'sleep', mins: 0 });
assert.equal(interrupted.provisional.body.sleep.outcome, 'started');
assert.equal(interrupted.world.physical.sleep.state, 'sleep_period');

console.log('environment.test.js: all checks passed');
