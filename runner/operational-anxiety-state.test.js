// operational-anxiety-state.test.js - pure unit checks for the read-only
// categorical projection used by the Soma replay workbench.
//
// This module is not wired into live soma.js snapshot/prompt output in this
// branch. Only the standalone projection is exercised here; production
// integration (public UI, implementation registry entries) is out of scope
// for the replay workbench and is intentionally not asserted.

import assert from 'node:assert/strict';
import {
  operationalAnxietySnapshot,
  operationalAnxietyTransition,
} from './operational-anxiety-state.js';
import {
  createCurrentDefensiveContext,
  reconcileCurrentDefensiveContext,
} from './current-defensive-context.js';

const T0 = '2026-09-13 09:00:00.000';

function context({
  key = 'search:one|COERCIVE_LOSS_OF_CONTROL',
  temporalStatus = 'POTENTIAL',
  ambiguity = 'CLEAR',
  control = 'NONE',
  alpha = 1,
  beta = 1,
  active = true,
  eventId = 'event-1',
} = {}) {
  const resolvedObservations = alpha + beta - 2;
  return {
    contextKey: key,
    contextId: key.split('|')[0],
    outcomeClass: key.split('|')[1],
    openedAt: T0,
    updatedAt: T0,
    resolvedAt: active ? null : T0,
    active,
    activeCues: [{ cueId: 'actor:proctor', cueType: 'actor', presence: 'PRESENT_EXTERNAL_CUE' }],
    learnedAssociations: [{
      cueId: 'actor:proctor', cueType: 'actor', outcomeClass: key.split('|')[1],
      posterior: {
        alpha, beta, mean: alpha / (alpha + beta),
        variance: alpha * beta / ((alpha + beta) ** 2 * (alpha + beta + 1)),
        resolvedObservations,
      },
    }],
    learnedPosteriorAtOpen: [],
    worldAmbiguity: ambiguity,
    objectiveControllability: control,
    perceivedControllability: 'NOT_MODELLED',
    learnedActionOutcomeContingency: [],
    causalActionOutcomeControl: 'NOT_MODELLED',
    temporalStatus,
    outcomeStatus: active ? 'unknown' : 'did_not_occur',
    resolutionStatus: active ? 'UNRESOLVED' : 'RESOLVED_SAFE',
    sourceEnvironmentEventIds: [eventId],
  };
}

const empty = createCurrentDefensiveContext();
assert.equal(operationalAnxietySnapshot(empty).status, 'QUIET', 'A: no context is QUIET');

const anticipated = createCurrentDefensiveContext();
anticipated.contexts['search:one|COERCIVE_LOSS_OF_CONTROL'] = context({ alpha: 4, beta: 2 });
let view = operationalAnxietySnapshot(anticipated);
assert.equal(view.status, 'ANTICIPATING', 'B: a current possible learned cue is anticipatory');
assert.equal(view.currentConcern.learnedCueOutcomeEvidence[0].evidence.status, 'LEARNED_HISTORY_AVAILABLE');

anticipated.contexts['search:one|COERCIVE_LOSS_OF_CONTROL'].temporalStatus = 'ONGOING';
assert.equal(operationalAnxietySnapshot(anticipated).status, 'THREAT_ONGOING',
  'C: an occurring outcome becomes THREAT_ONGOING');
anticipated.contexts['search:one|COERCIVE_LOSS_OF_CONTROL'] = context({ active: false, temporalStatus: 'RESOLVED' });
assert.equal(operationalAnxietySnapshot(anticipated).status, 'QUIET',
  'C: explicit resolution returns to QUIET');

const predictable = createCurrentDefensiveContext();
predictable.contexts['search:one|COERCIVE_LOSS_OF_CONTROL'] = context({ temporalStatus: 'IMMINENT', ambiguity: 'CLEAR' });
const unpredictable = createCurrentDefensiveContext();
unpredictable.contexts['search:one|COERCIVE_LOSS_OF_CONTROL'] = context({ temporalStatus: 'POTENTIAL', ambiguity: 'AMBIGUOUS' });
assert.equal(operationalAnxietySnapshot(predictable).currentConcern.temporalPredictability,
  'SPECIFIC_STRUCTURED_TIMING');
assert.equal(operationalAnxietySnapshot(predictable).status, 'THREAT_IMMINENT',
  'C: an explicitly imminent threat becomes THREAT_IMMINENT');
assert.equal(operationalAnxietySnapshot(unpredictable).currentConcern.temporalPredictability,
  'TEMPORALLY_UNCERTAIN', 'D: temporal uncertainty stays categorical');

const multiple = createCurrentDefensiveContext();
multiple.contexts['a|SOCIAL_HOSTILITY'] = context({ key: 'a|SOCIAL_HOSTILITY', eventId: 'potential-event' });
multiple.contexts['b|PHYSICAL_HARM'] = context({
  key: 'b|PHYSICAL_HARM', temporalStatus: 'IMMINENT', eventId: 'imminent-event',
});
multiple.contexts['c|DEPRIVATION_OR_LOSS'] = context({
  key: 'c|DEPRIVATION_OR_LOSS', temporalStatus: 'ONGOING', eventId: 'ongoing-event',
});
view = operationalAnxietySnapshot(multiple);
assert.equal(view.activeConcerns.length, 3, 'E: simultaneous contexts remain separate');
assert.equal(view.status, 'THREAT_ONGOING', 'E: structural precedence chooses the headline without summing');

const priorOnly = createCurrentDefensiveContext();
priorOnly.contexts['search:one|COERCIVE_LOSS_OF_CONTROL'] = context();
const priorEvidence = operationalAnxietySnapshot(priorOnly)
  .currentConcern.learnedCueOutcomeEvidence[0].evidence;
assert.equal(priorEvidence.status, 'NO_RESOLVED_LEARNING_HISTORY',
  'F: Beta(1,1) is not displayed as learned 50% threat');
assert.equal('posterior' in priorEvidence, false);

const posterior = operationalAnxietySnapshot(predictable)
  .currentConcern.learnedCueOutcomeEvidence[0].evidence;
assert.equal(posterior.status, 'NO_RESOLVED_LEARNING_HISTORY');
predictable.contexts['search:one|COERCIVE_LOSS_OF_CONTROL'] = context({ temporalStatus: 'IMMINENT', alpha: 3, beta: 5 });
const retained = operationalAnxietySnapshot(predictable)
  .currentConcern.learnedCueOutcomeEvidence[0].evidence.posterior;
assert.deepEqual(retained, {
  alpha: 3, beta: 5, mean: 0.375, variance: 0.026041666666666668, resolvedObservations: 6,
  outcomesOccurred: 2, outcomesDidNotOccur: 4,
}, 'G: exact existing Beta posterior and uncertainty are preserved');

assert.deepEqual(operationalAnxietySnapshot(unpredictable).temporalHazard,
  { status: 'NOT_AVAILABLE', reason: 'NO_EVENT_TIME_DISTRIBUTION' },
  'H: no hazard is fabricated without an event-time distribution');

const noneControl = operationalAnxietySnapshot(unpredictable);
unpredictable.contexts['search:one|COERCIVE_LOSS_OF_CONTROL'].objectiveControllability = 'SUBSTANTIAL';
const substantialControl = operationalAnxietySnapshot(unpredictable);
assert.equal(noneControl.status, substantialControl.status,
  'I: objective control is displayed separately and does not modify the state');
assert.equal(substantialControl.objectiveControllability, 'SUBSTANTIAL');

const restarted = reconcileCurrentDefensiveContext(JSON.parse(JSON.stringify(multiple)));
assert.deepEqual(operationalAnxietySnapshot(restarted), operationalAnxietySnapshot(multiple),
  'J: the projection survives restart through its authoritative persistent input');
assert.equal(operationalAnxietySnapshot(null).status, 'UNKNOWN', 'K: missing input is UNKNOWN');

const transition = operationalAnxietyTransition(multiple, {
  transitions: [multiple.contexts['c|DEPRIVATION_OR_LOSS']],
});
assert.equal(transition.recordedAt, T0);
assert.ok(transition.sourceEnvironmentEventIds.includes('ongoing-event'),
  'O: transition trace retains source environment IDs for inspection');
assert.doesNotMatch(JSON.stringify(operationalAnxietySnapshot(multiple)), /ongoing-event|potential-event|imminent-event/,
  'O: private source identifiers do not leak through the public snapshot');

console.log('operational-anxiety-state.test.js: all checks passed');
