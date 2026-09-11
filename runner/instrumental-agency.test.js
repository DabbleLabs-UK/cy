import assert from 'node:assert/strict';
import {
  INSTRUMENTAL_ACTION_SELECTION,
  createInstrumentalAgencyState,
  instrumentalOpportunityDefinitions,
  openInstrumentalOpportunity,
  queueInstrumentalOpportunity,
  reconcileInstrumentalAgencyState,
  resolveInstrumentalOpportunity,
  takePendingInstrumentalOpportunities,
} from './instrumental-agency.js';
import { createEnvironmentEvent, createEnvironmentRecord } from './environment-schema.js';
import {
  createControllabilityState,
  observeControllabilityRecord,
} from './action-outcome-contingency.js';
import {
  observeSomaControllabilityRecord,
  observeSomaCurrentDefensiveContextRecord,
  reconcileSoma,
} from './soma.js';

const OPEN_AT = '2026-09-11 10:00:00.000';
const RESOLVED_AT = '2026-09-11 10:00:05.000';
const ACTORS = {
  officer: { key: 'proctor', name: 'Mr Proctor' },
  social: { key: 'reg', name: 'Reg' },
};

function recordFrom(spec, id) {
  return createEnvironmentRecord(createEnvironmentEvent(spec.archetypeId, {
    id,
    timestamp: id.endsWith('open') ? OPEN_AT : RESOLVED_AT,
    eventType: spec.eventType,
    world: spec.world,
    observation: spec.observation,
  }));
}

const definitions = instrumentalOpportunityDefinitions();
assert.equal(definitions.length, 5, 'the implementation starts with exactly five audited archetypes');

const canonicalActions = new Set();
for (const definition of definitions) {
  assert.equal(definition.actions.length, 2, `${definition.id}: A/B: two genuine actions open`);
  for (const action of definition.actions) {
    assert.match(action, /^action:[a-z0-9][a-z0-9_-]*$/);
    assert.equal(canonicalActions.has(action), false, `${definition.id}: K: action IDs do not collapse`);
    canonicalActions.add(action);
  }
}

for (const definition of definitions) {
  const actor = ACTORS[definition.sourceKind];
  const consequences = new Set();
  for (const chosenAction of definition.actions) {
    const state = createInstrumentalAgencyState();
    const prepared = openInstrumentalOpportunity(state, {
      sourceKind: definition.sourceKind,
      sourceEventType: definition.sourceEventType,
      actorKey: actor.key,
      actorName: actor.name,
      opportunityId: `opportunity:${definition.id}:${chosenAction}`,
      timestamp: OPEN_AT,
      forcedAction: chosenAction,
    });
    assert.ok(prepared, `${definition.id}: A: opportunity genuinely opens`);
    const openingOpportunity = prepared.opening.world.action_opportunity;
    assert.deepEqual(openingOpportunity.available_actions, definition.actions,
      `${definition.id}: B: only definition actions are available`);
    assert.deepEqual(openingOpportunity.unavailable_actions, []);
    assert.equal(openingOpportunity.chosen_action, chosenAction);
    assert.equal(openingOpportunity.action_actually_executed, 'UNKNOWN');
    assert.equal(openingOpportunity.execution_status, 'INTENDED');
    assert.equal(openingOpportunity.resolution_status, 'UNRESOLVED');
    assert.ok(openingOpportunity.outcome_resolution.every((outcome) => outcome.status === 'unknown'),
      `${definition.id}: F: opening outcomes remain unknown`);
    assert.equal(prepared.opening.world.instrumental.action_selection_provenance,
      INSTRUMENTAL_ACTION_SELECTION);
    assert.equal(prepared.opening.world.instrumental.situation_description, prepared.opening.text);

    const openingRecord = recordFrom(prepared.opening, `${definition.id}-${chosenAction}-open`);
    const learner = createControllabilityState();
    const openingLearning = observeControllabilityRecord(learner, openingRecord);
    assert.equal(openingLearning.updated, false, `${definition.id}: F: unresolved opening cannot update learner`);
    assert.equal(learner.history.length, 0);

    const queued = queueInstrumentalOpportunity(
      state,
      prepared.pending,
      openingRecord.world_event.id,
    );
    const restarted = reconcileInstrumentalAgencyState(JSON.parse(JSON.stringify(state)));
    assert.equal(restarted.pending.length, 1, `${definition.id}: J: restart preserves open opportunity`);
    assert.equal(restarted.pending[0].chosenAction, chosenAction);
    assert.equal(takePendingInstrumentalOpportunities(restarted).length, 1);
    assert.equal(restarted.pending.length, 0);

    const resolution = resolveInstrumentalOpportunity(queued, { timestamp: RESOLVED_AT });
    const resolvedOpportunity = resolution.world.action_opportunity;
    assert.equal(resolvedOpportunity.action_actually_executed, chosenAction,
      `${definition.id}: C: executed action is persisted`);
    assert.equal(resolvedOpportunity.execution_status, 'EXECUTED');
    assert.equal(resolvedOpportunity.resolution_status, 'RESOLVED');
    assert.ok(resolvedOpportunity.outcome_resolution.every((outcome) => outcome.status !== 'unknown'),
      `${definition.id}: G: resolved event has explicit outcome classes`);
    assert.equal(resolution.world.instrumental.stage, 'WORLD_OUTCOME_RESOLVED');
    assert.ok(resolution.world.instrumental.consequence_description);
    assert.equal(resolution.world.instrumental.situation_description, prepared.opening.text,
      `${definition.id}: admin trace retains the opening situation on resolution`);
    consequences.add(resolution.world.instrumental.consequence_id);

    const resolvedRecord = recordFrom(resolution, `${definition.id}-${chosenAction}-resolved`);
    const learnerResult = observeControllabilityRecord(learner, resolvedRecord);
    assert.equal(learnerResult.updated, true, `${definition.id}: H: Handoff-7 learner receives trial`);
    assert.ok(learnerResult.updates.some((update) => update.condition === 'action'
      && update.actionId === chosenAction));
    for (const update of learnerResult.updates.filter((item) => item.condition === 'noAction')) {
      assert.ok(definition.actions.includes(update.actionId),
        `${definition.id}: D: no-action evidence comes only from an explicitly available alternative`);
    }

    const soma = reconcileSoma(null, { now: Date.parse(OPEN_AT) });
    const anxietyBefore = soma.experienced.metrics.anxiety.value;
    observeSomaControllabilityRecord(soma, openingRecord);
    const openedDefensive = observeSomaCurrentDefensiveContextRecord(soma, openingRecord);
    assert.ok(openedDefensive.transitions.length > 0,
      `${definition.id}: opening enters current defensive context`);
    assert.ok(openedDefensive.transitions.every((transition) => (
      transition.contextId === openingOpportunity.context_id
      && transition.temporalStatus === 'IMMINENT'
      && transition.resolutionStatus === 'UNRESOLVED'
    )), `${definition.id}: opening keeps its explicit unresolved defensive identity`);
    observeSomaControllabilityRecord(soma, resolvedRecord);
    const resolvedDefensive = observeSomaCurrentDefensiveContextRecord(soma, resolvedRecord);
    assert.ok(resolvedDefensive.transitions.length > 0,
      `${definition.id}: consequence resolves current defensive context`);
    assert.ok(resolvedDefensive.transitions.every((transition) => (
      transition.contextId === openingOpportunity.context_id
      && transition.temporalStatus === 'RESOLVED'
    )), `${definition.id}: opening and consequence share one defensive context identity`);
    assert.equal(soma.experienced.metrics.anxiety.value, anxietyBefore,
      `${definition.id}: L: action opportunity and outcome do not alter Anxiety`);
  }
  assert.equal(consequences.size, definition.actions.length,
    `${definition.id}: E: each action reaches a distinct concrete world branch`);
}

const selectorState = createInstrumentalAgencyState();
const firstDefinition = definitions[0];
const firstActor = ACTORS[firstDefinition.sourceKind];
const first = openInstrumentalOpportunity(selectorState, {
  sourceKind: firstDefinition.sourceKind,
  sourceEventType: firstDefinition.sourceEventType,
  actorKey: firstActor.key,
  actorName: firstActor.name,
  opportunityId: 'selector:first',
  timestamp: OPEN_AT,
});
const second = openInstrumentalOpportunity(selectorState, {
  sourceKind: firstDefinition.sourceKind,
  sourceEventType: firstDefinition.sourceEventType,
  actorKey: firstActor.key,
  actorName: firstActor.name,
  opportunityId: 'selector:second',
  timestamp: OPEN_AT,
});
assert.equal(first.pending.chosenAction, firstDefinition.actions[0]);
assert.equal(second.pending.chosenAction, firstDefinition.actions[1],
  'action selection is explicit deterministic round-robin, not an emotional model');

const proseState = createInstrumentalAgencyState();
const proseBefore = JSON.stringify(proseState);
assert.equal(openInstrumentalOpportunity(proseState, {
  sourceKind: 'generated_prose',
  sourceEventType: 'i_refused_the_order',
  actorKey: 'cy',
  actorName: 'Cy',
  opportunityId: 'prose:not-a-trial',
  timestamp: OPEN_AT,
}), null);
assert.equal(JSON.stringify(proseState), proseBefore,
  'I: generated prose cannot create or alter an action opportunity');

console.log('instrumental-agency.test.js: all checks passed');
