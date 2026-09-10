import assert from 'node:assert/strict';
import {
  createThreatLearning,
  observeThreatLearningRecord,
  posteriorMean,
  posteriorVariance,
  reconcileThreatLearning,
  threatLearningSnapshot,
  threatLearningInspection,
  trialsFromEnvironmentRecord,
  updateThreatLearning,
} from './probabilistic-threat-learning.js';
import { createEnvironmentEvent, createEnvironmentRecord } from './environment-schema.js';

const t0 = '2026-09-10 12:00:00.000';
const trial = (cueId, outcomeClass, status, id = 'env-test') => ({
  cueId, cueType: cueId.split(':')[0], outcomeClass, status,
  timestamp: t0, sourceEnvironmentEventIds: [id],
});

let state = createThreatLearning(Date.parse(t0));
assert.equal(posteriorMean(1, 1), 0.5);
assert.equal(posteriorVariance(1, 1), 1 / 12);
assert.equal(updateThreatLearning(state, trial('event:search', 'PHYSICAL_HARM', 'occurred')).update.after.mean, 2 / 3);
assert.deepEqual([state.pairs['event:search'].PHYSICAL_HARM.alpha, state.pairs['event:search'].PHYSICAL_HARM.beta], [2, 1]);

state = createThreatLearning();
assert.equal(updateThreatLearning(state, trial('event:search', 'PHYSICAL_HARM', 'did_not_occur')).update.after.mean, 1 / 3);
assert.deepEqual([state.pairs['event:search'].PHYSICAL_HARM.alpha, state.pairs['event:search'].PHYSICAL_HARM.beta], [1, 2]);

state = createThreatLearning();
for (const status of ['occurred', 'occurred', 'did_not_occur', 'occurred', 'did_not_occur']) {
  updateThreatLearning(state, trial('event:search', 'PHYSICAL_HARM', status));
}
assert.deepEqual([state.pairs['event:search'].PHYSICAL_HARM.alpha, state.pairs['event:search'].PHYSICAL_HARM.beta], [4, 3]);
const beforeSafety = state.pairs['event:search'].PHYSICAL_HARM.mean;
updateThreatLearning(state, trial('event:search', 'PHYSICAL_HARM', 'did_not_occur'));
assert.ok(state.pairs['event:search'].PHYSICAL_HARM.mean < beforeSafety, 'genuine safety learning lowers the posterior mean');

const beforeUnknown = JSON.stringify(state);
assert.equal(updateThreatLearning(state, trial('event:search', 'PHYSICAL_HARM', 'unknown')).updated, false);
assert.equal(JSON.stringify(state), beforeUnknown, 'unknown outcome must not update the posterior or history');

updateThreatLearning(state, trial('event:search', 'SOCIAL_HOSTILITY', 'occurred'));
updateThreatLearning(state, trial('actor:proctor', 'PHYSICAL_HARM', 'occurred'));
assert.deepEqual([state.pairs['event:search'].SOCIAL_HOSTILITY.alpha, state.pairs['event:search'].SOCIAL_HOSTILITY.beta], [2, 1]);
assert.deepEqual([state.pairs['actor:proctor'].PHYSICAL_HARM.alpha, state.pairs['actor:proctor'].PHYSICAL_HARM.beta], [2, 1]);
assert.deepEqual([state.pairs['event:search'].PHYSICAL_HARM.alpha, state.pairs['event:search'].PHYSICAL_HARM.beta], [4, 4]);

const restored = reconcileThreatLearning(JSON.parse(JSON.stringify(state)));
assert.deepEqual(restored.pairs, state.pairs);
assert.deepEqual(restored.history, state.history);
assert.deepEqual(restored.history[0].before, { alpha: 1, beta: 1, mean: 0.5, variance: 1 / 12, resolvedObservations: 0 });
assert.deepEqual(restored.history[0].after, { alpha: 2, beta: 1, mean: 2 / 3, variance: 1 / 18, resolvedObservations: 1 });

const event = createEnvironmentEvent('cell_search', { id: 'env-cell-search', timestamp: t0, eventType: 'officer_search', world: { participants: { actor: 'proctor', relationship_ref: 'proctor' } } });
const record = createEnvironmentRecord(event);
const extracted = trialsFromEnvironmentRecord(record);
assert.ok(extracted.some((item) => item.cueId === 'actor:proctor' && item.outcomeClass === 'COERCIVE_LOSS_OF_CONTROL' && item.status === 'occurred'));
assert.ok(extracted.some((item) => item.cueId === 'event:officer_search' && item.outcomeClass === 'PHYSICAL_HARM' && item.status === 'did_not_occur'));
const trace = observeThreatLearningRecord(createThreatLearning(), record);
assert.ok(trace.updatesApplied > 0);

const postcard = createEnvironmentRecord(createEnvironmentEvent('hostile_postcard', {
  id: 'env-hostile-postcard', timestamp: t0, eventType: 'postcard_received',
}));
postcard.observation.summary = 'Hostile words classified elsewhere by regex must not train this learner.';
assert.equal(observeThreatLearningRecord(createThreatLearning(), postcard).updatesApplied, 0,
  'postcard word classification must not become a threat-learning trial');

const unknownEvent = createEnvironmentEvent('ambiguous_overheard_remark', {
  id: 'env-unknown', timestamp: t0,
  world: { associative_learning: { linkage: 'self_contained_event', outcomes: [{ outcome_class: 'SOCIAL_HOSTILITY', status: 'unknown' }] } },
});
const unknownTrace = observeThreatLearningRecord(createThreatLearning(), createEnvironmentRecord(unknownEvent));
assert.ok(unknownTrace.trialsExamined > 0);
assert.equal(unknownTrace.updatesApplied, 0);

const isolated = createThreatLearning();
const legacyOnlyRecord = createEnvironmentRecord(createEnvironmentEvent('ambiguous_overheard_remark', {
  id: 'env-legacy-only', timestamp: t0,
}));
legacyOnlyRecord.provisional = { threat: 0.75 };
const proseBefore = JSON.stringify(isolated);
assert.equal(typeof isolated.observeGeneratedProse, 'undefined');
assert.equal(observeThreatLearningRecord(isolated, legacyOnlyRecord).updatesApplied, 0);
assert.equal(JSON.stringify(isolated), proseBefore, 'legacy threat and generated prose have no learner input path');

const inspection = threatLearningInspection(restored);
assert.equal(inspection.publicLabel, 'LIVE');
assert.ok(inspection.associations.every((item) => item.history.every((point) => Number.isFinite(point.mean))));
const snapshot = threatLearningSnapshot(restored);
assert.equal(snapshot.publicLabel, 'LIVE');
assert.equal('mean' in snapshot.associations[0], false, 'public snapshot must not expose exact posterior values');
assert.equal(new Set(snapshot.associations.map((item) => item.outcomeClass)).size, snapshot.associations.length,
  'public snapshot stays compact by exposing at most one salient cue per outcome class');

console.log('probabilistic-threat-learning.test.js: all checks passed');
