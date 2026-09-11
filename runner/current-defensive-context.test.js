import assert from 'node:assert/strict';
import {
  createCurrentDefensiveContext,
  currentDefensiveContextInspection,
  currentDefensiveContextSnapshot,
  observeCurrentDefensiveContextRecord,
  reconcileCurrentDefensiveContext,
} from './current-defensive-context.js';
import { createEnvironmentEvent, createEnvironmentRecord } from './environment-schema.js';
import {
  createThreatLearning,
  observeThreatLearningRecord,
  updateThreatLearning,
} from './probabilistic-threat-learning.js';
import {
  createControllabilityState,
  observeControllabilityRecord,
} from './action-outcome-contingency.js';

const T0 = '2026-09-11 09:00:00.000';

function seedLearning() {
  const learning = createThreatLearning(Date.parse(T0));
  for (const status of ['occurred', 'occurred', 'did_not_occur']) {
    updateThreatLearning(learning, {
      cueId: 'actor:proctor', cueType: 'actor', outcomeClass: 'COERCIVE_LOSS_OF_CONTROL',
      status, timestamp: T0, sourceEnvironmentEventIds: [`seed-${status}`],
    });
  }
  updateThreatLearning(learning, {
    cueId: 'event:lockdown_signal', cueType: 'event', outcomeClass: 'COERCIVE_LOSS_OF_CONTROL',
    status: 'occurred', timestamp: T0, sourceEnvironmentEventIds: ['seed-lockdown'],
  });
  return learning;
}

function searchRecord({
  id, timestamp = T0, phase = 'POTENTIAL', outcome = 'unknown', control = 'none',
  certainty = 'certain', contextId = 'search:one', actor = 'proctor', eventType = 'officer_at_cell',
} = {}) {
  return createEnvironmentRecord(createEnvironmentEvent('cell_search', {
    id,
    timestamp,
    eventType,
    world: {
      participants: { actor, relationship_ref: actor },
      situation: { control, resolution_status: phase === 'RESOLVED' ? 'resolved' : 'unresolved' },
      associative_learning: {
        linkage: 'self_contained_event',
        outcomes: [{ outcome_class: 'COERCIVE_LOSS_OF_CONTROL', status: outcome }],
      },
      defensive_context: {
        context_id: contextId,
        temporal_status: phase,
        adverse_outcome_classes: ['COERCIVE_LOSS_OF_CONTROL'],
      },
    },
    observation: { certainty },
  }));
}

const noContextState = createCurrentDefensiveContext();
const noContextRecord = createEnvironmentRecord(createEnvironmentEvent('calm_routine', {
  id: 'calm-1', timestamp: T0,
}));
assert.equal(observeCurrentDefensiveContextRecord(noContextState, createThreatLearning(), noContextRecord).updated, false,
  'A: no learned or explicit adverse cue-outcome possibility fabricates no context');

const learning = seedLearning();
const state = createCurrentDefensiveContext(Date.parse(T0));
const potential = observeCurrentDefensiveContextRecord(state, learning, searchRecord({ id: 'search-potential' }));
assert.equal(potential.transitions.length, 1);
const attachedPosterior = potential.transitions[0].learnedAssociations
  .find((item) => item.cueId === 'actor:proctor').posterior;
const learnedPosterior = learning.pairs['actor:proctor'].COERCIVE_LOSS_OF_CONTROL;
assert.deepEqual(
  [attachedPosterior.alpha, attachedPosterior.beta, attachedPosterior.mean,
    attachedPosterior.variance, attachedPosterior.resolvedObservations],
  [learnedPosterior.alpha, learnedPosterior.beta, learnedPosterior.mean,
    learnedPosterior.variance, learnedPosterior.resolvedObservations],
  'B: a present learned cue retrieves the exact existing cue-outcome posterior',
);
assert.equal(potential.transitions[0].outcomeStatus, 'unknown');
assert.equal(potential.transitions[0].resolutionStatus, 'UNRESOLVED',
  'C: unknown remains unresolved and does not become safe');
assert.equal(potential.transitions[0].temporalStatus, 'POTENTIAL');
assert.equal(potential.transitions[0].objectiveControllability, 'NONE', 'E: objective control is copied categorically');
assert.equal(potential.transitions[0].perceivedControllability, 'NOT_MODELLED', 'F: perceived control is absent');
assert.deepEqual(potential.transitions[0].learnedActionOutcomeContingency, [],
  'F: no action contingency is fabricated without explicit opportunities');
assert.equal(potential.transitions[0].causalActionOutcomeControl, 'NOT_MODELLED');

const ongoing = observeCurrentDefensiveContextRecord(state, learning, searchRecord({
  id: 'search-ongoing', timestamp: '2026-09-11 09:01:00.000', phase: 'ONGOING', control: 'limited',
  certainty: 'uncertain',
}));
assert.equal(ongoing.transitions[0].temporalStatus, 'ONGOING');
assert.equal(ongoing.transitions[0].objectiveControllability, 'LIMITED');
assert.equal(ongoing.transitions[0].worldAmbiguity, 'AMBIGUOUS');
assert.deepEqual(ongoing.transitions[0].learnedAssociations[0].posterior,
  potential.transitions[0].learnedAssociations[0].posterior,
  'world ambiguity does not alter epistemic posterior uncertainty');
assert.equal(ongoing.transitions[0].openedAt, T0);
assert.equal(ongoing.transitions[0].sourceEnvironmentEventIds.length, 2);
assert.deepEqual(ongoing.transitions[0].learnedPosteriorAtOpen,
  potential.transitions[0].learnedAssociations,
  'history retains the exact learner snapshot from context opening');

const resolved = observeCurrentDefensiveContextRecord(state, learning, searchRecord({
  id: 'search-resolved', timestamp: '2026-09-11 09:02:00.000', phase: 'RESOLVED', outcome: 'did_not_occur',
}));
assert.equal(resolved.transitions[0].temporalStatus, 'RESOLVED');
assert.equal(resolved.transitions[0].resolutionStatus, 'RESOLVED_SAFE');
assert.equal(resolved.transitions[0].active, false, 'D: potential -> ongoing -> resolved closes the context');
assert.equal(resolved.transitions[0].resolvedAt, '2026-09-11 09:02:00.000');
assert.equal(state.history.length, 3, 'I: every actual transition is stored');
assert.deepEqual(state.history.map((item) => item.temporalStatus), ['POTENTIAL', 'ONGOING', 'RESOLVED']);

const multiple = createCurrentDefensiveContext();
observeCurrentDefensiveContextRecord(multiple, learning, searchRecord({
  id: 'multi-search', contextId: 'search:two', phase: 'IMMINENT',
}));
const lockdown = searchRecord({
  id: 'multi-lockdown', contextId: 'lockdown:one', phase: 'ONGOING', actor: 'officer', eventType: 'lockdown_signal',
});
observeCurrentDefensiveContextRecord(multiple, learning, lockdown);
assert.equal(currentDefensiveContextInspection(multiple).activeContexts.length, 2,
  'G: simultaneous contexts remain independent');
assert.notEqual(currentDefensiveContextInspection(multiple).activeContexts[0].contextKey,
  currentDefensiveContextInspection(multiple).activeContexts[1].contextKey);

const twoOutcomes = createCurrentDefensiveContext();
const twoOutcomeRecord = searchRecord({ id: 'two-outcomes', contextId: 'search:three', phase: 'IMMINENT' });
twoOutcomeRecord.world_event.world.defensive_context.adverse_outcome_classes.push('PHYSICAL_HARM');
observeCurrentDefensiveContextRecord(twoOutcomes, learning, twoOutcomeRecord);
assert.deepEqual(Object.values(twoOutcomes.contexts).map((context) => context.outcomeClass).sort(),
  ['COERCIVE_LOSS_OF_CONTROL', 'PHYSICAL_HARM'],
  'G: separate possible adverse outcomes are not collapsed into one scalar context');

const beforeProse = JSON.stringify(multiple);
const proseResult = observeCurrentDefensiveContextRecord(multiple, learning, { generated_text: 'Proctor is outside.' });
assert.equal(proseResult.updated, false);
assert.equal(JSON.stringify(multiple), beforeProse, 'H: generated prose cannot create an external context');

const restarted = reconcileCurrentDefensiveContext(JSON.parse(JSON.stringify(multiple)));
assert.deepEqual(restarted, multiple, 'J: unresolved contexts and history survive restart exactly');

const learnerOrder = createThreatLearning();
const orderState = createCurrentDefensiveContext();
const firstAdverseTrial = searchRecord({
  id: 'first-adverse-trial', contextId: 'search:order', phase: 'RESOLVED', outcome: 'occurred',
});
const contextBeforeLearning = observeCurrentDefensiveContextRecord(orderState, learnerOrder, firstAdverseTrial);
assert.equal(contextBeforeLearning.transitions[0].learnedAssociations[0].posterior.alpha, 1);
observeThreatLearningRecord(learnerOrder, firstAdverseTrial);
assert.equal(learnerOrder.pairs['actor:proctor'].COERCIVE_LOSS_OF_CONTROL.alpha, 2,
  'the resolved outcome updates the learner after the context captured its prior expectation');

const exact = currentDefensiveContextInspection(multiple);
assert.ok(exact.activeContexts.every((context) => context.learnedAssociations.every(
  (association) => Number.isFinite(association.posterior.mean) && Number.isFinite(association.posterior.variance),
)));
const publicSnapshot = currentDefensiveContextSnapshot(multiple);
assert.ok(publicSnapshot.activeContexts.length > 0);
assert.equal('posterior' in publicSnapshot.activeContexts[0].learnedEvidence[0], false,
  'public context does not expose the owner-only exact posterior');
assert.equal(publicSnapshot.activeContexts[0].perceivedControllability, 'NOT_MODELLED');

const controllability = createControllabilityState();
const actionContextRecord = searchRecord({
  id: 'action-context', contextId: 'search:instrumental', phase: 'ONGOING', outcome: 'occurred',
});
actionContextRecord.world_event.world.action_opportunity = {
  id: 'opportunity:action-context',
  context_id: 'search:instrumental',
  context_type: 'officer_request',
  available_actions: ['action:comply'],
  unavailable_actions: [],
  chosen_action: 'action:comply',
  action_actually_executed: 'action:comply',
  execution_status: 'EXECUTED',
  onset_at: T0,
  resolved_at: T0,
  resolution_status: 'RESOLVED',
  linked_event_ids: [],
  outcome_resolution: [{ outcome_class: 'COERCIVE_LOSS_OF_CONTROL', status: 'occurred' }],
};
observeControllabilityRecord(controllability, actionContextRecord);
const attachedControl = observeCurrentDefensiveContextRecord(
  createCurrentDefensiveContext(),
  learning,
  controllability,
  actionContextRecord,
).transitions[0];
assert.equal(attachedControl.learnedActionOutcomeContingency.length, 1,
  'M: matching structured context and available action attach learned evidence');
assert.equal(attachedControl.learnedActionOutcomeContingency[0].actionId, 'action:comply');
assert.equal(attachedControl.perceivedControllability, 'NOT_MODELLED',
  'attached evidence does not become perceived control');
const noCurrentOpportunity = searchRecord({
  id: 'same-context-no-opportunity', contextId: 'search:instrumental', phase: 'ONGOING', outcome: 'unknown',
});
const unattachedControl = observeCurrentDefensiveContextRecord(
  createCurrentDefensiveContext(),
  learning,
  controllability,
  noCurrentOpportunity,
).transitions[0];
assert.deepEqual(unattachedControl.learnedActionOutcomeContingency, [],
  'learned action evidence is not attached without a genuinely available current action');

console.log('current-defensive-context.test.js: all checks passed');
