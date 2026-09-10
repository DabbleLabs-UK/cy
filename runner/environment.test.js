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
assert.equal(eaten.body.meal.outcome, 'eaten');
assert.equal(eaten.body.meal.amount, 1);
assert.match(eaten.text, /ate it/);

const partial = chooseMealEvent('lunch', () => 0.9);
assert.equal(partial.body.meal.outcome, 'partial');
assert.ok(partial.body.meal.amount > 0 && partial.body.meal.amount < 1);

const missed = chooseMealEvent('tea', () => 0.95);
assert.equal(missed.body.meal.outcome, 'missed');
assert.equal(missed.body.meal.amount, 0);

const refused = chooseMealEvent('tea', () => 0.99);
assert.equal(refused.body.meal.outcome, 'refused');

const supportive = chooseRoutineEvent('association', () => 0.5);
assert.equal(supportive.social.quality, 'supportive');
assert.ok(supportive.appraisal.affiliation > 0.5);

const interrupted = materialiseScheduledEvent({ kind: 'sleep', mins: 0 });
assert.equal(interrupted.body.sleep.outcome, 'started');

console.log('environment.test.js: all checks passed');
