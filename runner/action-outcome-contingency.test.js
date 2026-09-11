import assert from 'node:assert/strict';
import {
  actionOpportunityFromEnvironment,
  controllabilityInspection,
  controllabilitySnapshot,
  createControllabilityState,
  observeControllabilityRecord,
  reconcileControllabilityState,
} from './action-outcome-contingency.js';
import { createEnvironmentEvent, createEnvironmentRecord } from './environment-schema.js';

const T0 = '2026-09-11 09:00:00.000';

function actionRecord({
  id,
  contextId = 'officer_request:proctor:cell',
  availableActions = ['action:comply'],
  unavailableActions = [],
  chosenAction = 'action:comply',
  executionStatus = 'EXECUTED',
  resolutionStatus = 'RESOLVED',
  outcomeClass = 'COERCIVE_LOSS_OF_CONTROL',
  outcomeStatus = 'occurred',
  timestamp = T0,
} = {}) {
  return createEnvironmentRecord(createEnvironmentEvent('officer_instruction', {
    id,
    timestamp,
    eventType: 'officer_request_resolved',
    world: {
      participants: { actor: 'proctor', relationship_ref: 'proctor' },
      context: { location: 'cell' },
      defensive_context: {
        context_id: contextId,
        temporal_status: 'RESOLVED',
        adverse_outcome_classes: [outcomeClass],
      },
      associative_learning: {
        linkage: 'self_contained_event',
        outcomes: [{ outcome_class: outcomeClass, status: outcomeStatus }],
      },
      action_opportunity: {
        id: `opportunity:${id}`,
        context_id: contextId,
        context_type: 'officer_request',
        available_actions: availableActions,
      unavailable_actions: unavailableActions,
      chosen_action: chosenAction,
      action_actually_executed: executionStatus === 'EXECUTED' ? chosenAction
        : executionStatus === 'NONE' ? 'NONE'
          : executionStatus === 'NOT_AVAILABLE' ? 'NOT_AVAILABLE' : 'UNKNOWN',
      execution_status: executionStatus,
        onset_at: timestamp,
        resolved_at: timestamp,
        resolution_status: resolutionStatus,
        linked_event_ids: [`opened:${id}`],
        outcome_resolution: [{ outcome_class: outcomeClass, status: outcomeStatus }],
      },
    },
  }));
}

const empty = createControllabilityState(Date.parse(T0));
const noOpportunity = createEnvironmentRecord(createEnvironmentEvent('officer_instruction', {
  id: 'no-opportunity', timestamp: T0,
}));
assert.equal(observeControllabilityRecord(empty, noOpportunity).reason, 'no_action_opportunity');
assert.equal(empty.history.length, 0, 'A: a missing action record cannot become a no-action trial');

const actionState = createControllabilityState(Date.parse(T0));
const executed = observeControllabilityRecord(actionState, actionRecord({ id: 'executed-adverse' }));
assert.equal(executed.updated, true);
assert.equal(executed.updates[0].condition, 'action');
assert.deepEqual(executed.updates[0].before, {
  alpha: 1, beta: 1, mean: 0.5, variance: 1 / 12, resolvedObservations: 0,
});
assert.deepEqual(executed.updates[0].after, {
  alpha: 2, beta: 1, mean: 2 / 3, variance: 1 / 18, resolvedObservations: 1,
}, 'B: an executed action updates the action-conditioned posterior exactly');

const withheld = observeControllabilityRecord(actionState, actionRecord({
  id: 'withheld-safe', chosenAction: 'NONE', executionStatus: 'NONE', outcomeStatus: 'did_not_occur',
}));
assert.equal(withheld.updates[0].condition, 'noAction');
assert.equal(withheld.updates[0].conditionId, 'NOT_ACTION:action:comply');
assert.deepEqual(withheld.updates[0].after, {
  alpha: 1, beta: 2, mean: 1 / 3, variance: 1 / 18, resolvedObservations: 1,
}, 'C: deliberate non-performance updates the explicit no-action comparator');

const unavailableState = createControllabilityState();
const unavailable = observeControllabilityRecord(unavailableState, actionRecord({
  id: 'unavailable',
  availableActions: [],
  unavailableActions: [{ action_id: 'action:comply', reason: 'door_locked' }],
  chosenAction: 'NONE',
  executionStatus: 'NOT_AVAILABLE',
}));
assert.equal(unavailable.updated, false);
assert.equal(unavailableState.history.length, 0, 'D: an unavailable action creates no evidence against it');
assert.equal(unavailable.opportunity.unavailableActions[0].reason, 'door_locked');

const unknownState = createControllabilityState();
const unknown = observeControllabilityRecord(unknownState, actionRecord({
  id: 'unknown-outcome', outcomeStatus: 'unknown',
}));
assert.equal(unknown.updated, false);
assert.equal(unknownState.history.length, 0, 'E: an unknown outcome produces no posterior update');
assert.equal(unknownState.opportunityHistory.length, 1);

function learnFixture({ contextId, actionStatuses, noActionStatuses, outcomeClass = 'COERCIVE_LOSS_OF_CONTROL' }) {
  const state = createControllabilityState();
  let serial = 0;
  for (const status of actionStatuses) {
    serial += 1;
    observeControllabilityRecord(state, actionRecord({
      id: `${contextId}-action-${serial}`,
      contextId,
      outcomeClass,
      outcomeStatus: status,
    }));
  }
  for (const status of noActionStatuses) {
    serial += 1;
    observeControllabilityRecord(state, actionRecord({
      id: `${contextId}-no-action-${serial}`,
      contextId,
      chosenAction: 'NONE',
      executionStatus: 'NONE',
      outcomeClass,
      outcomeStatus: status,
    }));
  }
  return state;
}

const beneficial = controllabilitySnapshot(learnFixture({
  contextId: 'beneficial',
  actionStatuses: ['occurred', 'occurred', 'did_not_occur', 'did_not_occur', 'did_not_occur', 'did_not_occur'],
  noActionStatuses: ['occurred', 'occurred', 'occurred', 'did_not_occur'],
})).contingencies[0];
assert.deepEqual(beneficial.observationCounts, { actionPerformed: 6, actionWithheld: 4 });
assert.deepEqual(
  [beneficial.actionPosterior.alpha, beneficial.actionPosterior.beta,
    beneficial.noActionPosterior.alpha, beneficial.noActionPosterior.beta],
  [3, 5, 4, 2],
);
assert.ok(beneficial.contingencyDifference > 0,
  'F: fewer adverse outcomes with action produces positive avoidance contingency');
assert.equal(beneficial.evidenceDescription, 'ADVERSE_OUTCOME_LOWER_WITH_ACTION');
assert.equal(beneficial.contingencyVariance,
  beneficial.actionPosterior.variance + beneficial.noActionPosterior.variance);
assert.equal(beneficial.credibleInterval, 'NOT_MODELLED');

const equal = controllabilitySnapshot(learnFixture({
  contextId: 'equal',
  actionStatuses: ['occurred', 'did_not_occur'],
  noActionStatuses: ['occurred', 'did_not_occur'],
})).contingencies[0];
assert.equal(equal.contingencyDifference, 0, 'G: equal histories produce exactly equal posterior means');
assert.equal(equal.evidenceDescription, 'POSTERIOR_MEANS_EQUAL');

const adverse = controllabilitySnapshot(learnFixture({
  contextId: 'adverse',
  actionStatuses: ['occurred', 'occurred', 'occurred', 'did_not_occur'],
  noActionStatuses: ['occurred', 'did_not_occur', 'did_not_occur', 'did_not_occur'],
})).contingencies[0];
assert.ok(adverse.contingencyDifference < 0,
  'H: more adverse outcomes with action produces negative avoidance contingency');
assert.equal(adverse.evidenceDescription, 'ADVERSE_OUTCOME_HIGHER_WITH_ACTION');

const separated = createControllabilityState();
observeControllabilityRecord(separated, actionRecord({ id: 'context-a', contextId: 'search:a' }));
observeControllabilityRecord(separated, actionRecord({ id: 'context-b', contextId: 'search:b' }));
assert.equal(Object.keys(separated.pairs).length, 2, 'I: contexts retain independent evidence');
observeControllabilityRecord(separated, actionRecord({
  id: 'outcome-b', contextId: 'search:a', outcomeClass: 'SOCIAL_HOSTILITY',
}));
assert.equal(Object.keys(separated.pairs).length, 3, 'J: outcome classes retain independent evidence');
assert.equal(separated.pairs['search:a|action:comply|PHYSICAL_HARM'], undefined);

const beforeProse = JSON.stringify(separated);
assert.equal(observeControllabilityRecord(separated, {
  generated_text: "i should've refused",
}).reason, 'no_action_opportunity');
assert.equal(JSON.stringify(separated), beforeProse, 'K: generated prose cannot create a trial');

const contradictory = actionRecord({ id: 'contradictory', chosenAction: 'action:refuse' });
assert.equal(observeControllabilityRecord(separated, contradictory).reason, 'invalid_action_opportunity');
assert.equal(JSON.stringify(separated), beforeProse, 'an unavailable chosen action cannot create no-action evidence');

const restartSource = learnFixture({
  contextId: 'restart',
  actionStatuses: ['did_not_occur'],
  noActionStatuses: ['occurred'],
});
const restarted = reconcileControllabilityState(JSON.parse(JSON.stringify(restartSource)));
assert.equal(restarted.opportunityHistory.length, 2);
assert.equal(restarted.history.length, 2);
assert.equal(controllabilityInspection(restarted).contingencies[0].contingencyDifference > 0, true,
  'L: opportunities, posteriors and updates survive restart');

const parsed = actionOpportunityFromEnvironment(actionRecord({ id: 'traceable' }));
assert.equal(parsed.schema, 'cy.action-opportunity');
assert.deepEqual(parsed.linkedEnvironmentEventIds, ['opened:traceable', 'traceable']);
assert.equal(parsed.fieldProvenance.chosenAction, 'STRUCTURED_WORLD_FACT');
assert.equal(controllabilitySnapshot(restarted).causalControlInference, 'NOT_MODELLED');
assert.equal(controllabilitySnapshot(restarted).perceivedControl, 'NOT_MODELLED');

console.log('action-outcome-contingency.test.js: all checks passed');
