// instrumental-round-robin-false-agency.test.js - instrumental-agency.js's
// engineering round-robin incidents (officer_order, cell_search_handover,
// inmate_check_in, inmate_social_approach, inmate_provocation) presented
// authored alternative actions, selected one via engineering round-robin
// state (INSTRUMENTAL_ACTION_SELECTION = ENGINEERING_ROUND_ROBIN_NOT_
// PSYCHOLOGICAL - explicitly not a Cy/model chooser), then asserted the
// selected branch as world.action_opportunity with chosen_action and
// execution_status: EXECUTED. action-outcome-contingency.js then learned an
// action-vs-noAction controllability posterior from it, and run.js emitted
// a public "Cy chose X" timeline event - together misrepresenting an
// engineering branch resolution as Cy's enacted, agentic choice.
//
// Fix: neither the opening nor the resolved instrumental event asserts
// world.action_opportunity at all. The branch resolution and its world
// consequences (defensive-context outcomes, threat-learning trials, social
// contact facts, the narrative text) are entirely unchanged and represented
// via world.instrumental, whose action_selection_provenance field already
// honestly discloses the engineering selection. run.js's public wording no
// longer says "Cy chose X"; it says "The situation resolved via X".
//
// Self-checking: throws (non-zero exit) on any failure.
//
//   node runner/instrumental-round-robin-false-agency.test.js

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  INSTRUMENTAL_ACTION_SELECTION,
  createInstrumentalAgencyState,
  instrumentalOpportunityDefinitions,
  openInstrumentalOpportunity,
  queueInstrumentalOpportunity,
  reconcileInstrumentalAgencyState,
  resolveInstrumentalOpportunity,
} from './instrumental-agency.js';
import { createEnvironmentEvent, createEnvironmentRecord } from './environment-schema.js';
import {
  createControllabilityState,
  observeControllabilityRecord,
} from './action-outcome-contingency.js';
import {
  classifyInstrumentalControllability,
  isRoundRobinContextId,
  retireInstrumentalRoundRobinContamination,
} from './reconcile-instrumental-round-robin-contamination.mjs';

let n = 0;
const ok = (msg) => { n++; console.log('  ok - ' + msg); };

const OPEN_AT = '2026-09-27 10:00:00.000';
const RESOLVED_AT = '2026-09-27 10:00:05.000';

function recordFrom(spec, id, timestamp) {
  return createEnvironmentRecord(createEnvironmentEvent(spec.archetypeId, {
    id, timestamp, eventType: spec.eventType, world: spec.world, observation: spec.observation,
  }));
}

// ---- 1: round-robin still selects/resolves its authored branch ----
{
  const state = createInstrumentalAgencyState();
  const first = openInstrumentalOpportunity(state, {
    sourceKind: 'officer', sourceEventType: 'order', actorKey: 'proctor', actorName: 'Mr Proctor',
    opportunityId: 'opportunity:rr-1', timestamp: OPEN_AT,
  });
  const second = openInstrumentalOpportunity(state, {
    sourceKind: 'officer', sourceEventType: 'order', actorKey: 'proctor', actorName: 'Mr Proctor',
    opportunityId: 'opportunity:rr-2', timestamp: OPEN_AT,
  });
  assert.equal(first.pending.chosenAction, 'action:comply_instruction');
  assert.equal(second.pending.chosenAction, 'action:refuse_instruction',
    'the round-robin cursor still advances deterministically through both authored actions');
  ok('round-robin still selects and resolves its authored branch, deterministically alternating (1)');
}

// ---- 2: world consequences still occur normally ----
{
  const state = createInstrumentalAgencyState();
  const prepared = openInstrumentalOpportunity(state, {
    sourceKind: 'officer', sourceEventType: 'search', actorKey: 'proctor', actorName: 'Mr Proctor',
    opportunityId: 'opportunity:rr-3', timestamp: OPEN_AT,
  });
  const queued = queueInstrumentalOpportunity(state, prepared.pending, 'opening-event-id');
  const resolution = resolveInstrumentalOpportunity(queued, { timestamp: RESOLVED_AT });
  assert.ok(resolution.world.associative_learning.outcomes.length > 0,
    'the authored branch still produces real, explicit outcome facts');
  assert.ok(resolution.world.associative_learning.outcomes.every((o) => o.status !== 'unknown'));
  assert.equal(resolution.world.defensive_context.temporal_status, 'RESOLVED');
  assert.ok(resolution.world.instrumental.consequence_description,
    'the branch narrative consequence still exists');
  ok('world consequences (outcomes, defensive context, narrative) still occur normally (2)');
}

// ---- 3: no chosen_action/EXECUTED claim attributed to Cy is produced ----
{
  const state = createInstrumentalAgencyState();
  const prepared = openInstrumentalOpportunity(state, {
    sourceKind: 'social', sourceEventType: 'checked_in', actorKey: 'reg', actorName: 'Reg',
    opportunityId: 'opportunity:rr-4', timestamp: OPEN_AT,
  });
  assert.equal('action_opportunity' in prepared.opening.world, false,
    'the opening event asserts no action_opportunity at all');
  const queued = queueInstrumentalOpportunity(state, prepared.pending, 'opening-event-id-4');
  const resolution = resolveInstrumentalOpportunity(queued, { timestamp: RESOLVED_AT });
  assert.equal('action_opportunity' in resolution.world, false,
    'the resolved event asserts no action_opportunity at all - no chosen_action, no execution_status: EXECUTED');
  ok('no chosen_action/EXECUTED claim attributed to Cy is produced by either the opening or resolved event (3)');
}

// ---- 4: round-robin incidents do not update controllability posteriors ----
{
  for (const definition of instrumentalOpportunityDefinitions()) {
    const actorKey = definition.sourceKind === 'officer' ? 'proctor' : 'reg';
    const state = createInstrumentalAgencyState();
    const controllability = createControllabilityState();
    const prepared = openInstrumentalOpportunity(state, {
      sourceKind: definition.sourceKind, sourceEventType: definition.sourceEventType,
      actorKey, actorName: actorKey, opportunityId: `opportunity:posterior-${definition.id}`, timestamp: OPEN_AT,
    });
    const openingRecord = recordFrom(prepared.opening, `${definition.id}-open`, OPEN_AT);
    const openResult = observeControllabilityRecord(controllability, openingRecord);
    assert.equal(openResult.updated, false);
    assert.equal(openResult.reason, 'no_action_opportunity');

    const queued = queueInstrumentalOpportunity(state, prepared.pending, openingRecord.world_event.id);
    const resolution = resolveInstrumentalOpportunity(queued, { timestamp: RESOLVED_AT });
    const resolvedRecord = recordFrom(resolution, `${definition.id}-resolved`, RESOLVED_AT);
    const resolveResult = observeControllabilityRecord(controllability, resolvedRecord);
    assert.equal(resolveResult.updated, false, `${definition.id}: resolution must not update controllability`);
    assert.equal(resolveResult.reason, 'no_action_opportunity');
    assert.deepEqual(controllability.pairs, {}, `${definition.id}: no posterior pair is ever created`);
  }
  ok('none of the five engineering round-robin instrumental incidents update controllability posteriors (4)');
}

// ---- 5: no "Cy chose..." public event is emitted ----
{
  const source = readFileSync(new URL('./run.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.doesNotMatch(source, /Cy chose/, 'the literal "Cy chose" wording no longer appears anywhere in run.js');
  const fnStart = source.indexOf('function beginInstrumentalIncident(');
  assert.ok(fnStart > -1);
  const fnEnd = source.indexOf('\n  function ', fnStart + 1);
  const fnBody = source.slice(fnStart, fnEnd > -1 ? fnEnd : fnStart + 3000);
  assert.match(fnBody, /The situation resolved via/,
    'the public timeline wording is now neutral, factual, and does not imply intent');
  ok('no "Cy chose ..." public event is emitted; neutral wording is used instead (5)');
}

// ---- 6: future genuinely agent-selected actions can still use the existing substrate ----
{
  // A hypothetical genuine chooser record, structurally identical to what a
  // real future agent/model chooser would supply - NOT produced by
  // instrumental-agency.js. Proves the substrate itself is untouched and
  // fully functional; only the instrumental producer stopped feeding it.
  const controllability = createControllabilityState();
  const genuineChoice = createEnvironmentRecord(createEnvironmentEvent('officer_instruction', {
    id: 'genuine-agent-choice-1', timestamp: OPEN_AT,
    world: {
      action_opportunity: {
        id: 'genuine:opportunity-1', context_id: 'genuine:context:test', context_type: 'hypothetical_agent_choice',
        available_actions: ['action:option_a', 'action:option_b'], unavailable_actions: [],
        chosen_action: 'action:option_a', action_actually_executed: 'action:option_a',
        execution_status: 'EXECUTED', onset_at: OPEN_AT, resolved_at: RESOLVED_AT,
        resolution_status: 'RESOLVED', linked_event_ids: [],
        outcome_resolution: [{ outcome_class: 'SOCIAL_HOSTILITY', status: 'did_not_occur' }],
      },
    },
  }));
  const result = observeControllabilityRecord(controllability, genuineChoice);
  assert.equal(result.updated, true, 'a genuinely supplied action_opportunity still updates the substrate normally');
  assert.ok(Object.keys(controllability.pairs).length > 0);
  ok('the action-outcome-contingency substrate remains fully functional for a genuine future chooser (6)');
}

// ---- 7: defensive/world consequences remain intact ----
{
  const state = createInstrumentalAgencyState();
  const prepared = openInstrumentalOpportunity(state, {
    sourceKind: 'officer', sourceEventType: 'order', actorKey: 'proctor', actorName: 'Mr Proctor',
    opportunityId: 'opportunity:rr-7', timestamp: OPEN_AT,
  });
  assert.equal(prepared.opening.world.defensive_context.temporal_status, 'IMMINENT');
  assert.ok(prepared.opening.world.defensive_context.adverse_outcome_classes.length > 0,
    'defensive-context grounding is unaffected by removing action_opportunity');
  const queued = queueInstrumentalOpportunity(state, prepared.pending, 'opening-event-7');
  const resolution = resolveInstrumentalOpportunity(queued, { timestamp: RESOLVED_AT });
  assert.equal(resolution.world.defensive_context.temporal_status, 'RESOLVED');
  ok('defensive/world consequences (defensive_context, associative_learning) remain fully intact (7)');
}

// ---- 8: restart/replay remains stable ----
{
  const state = createInstrumentalAgencyState();
  const prepared = openInstrumentalOpportunity(state, {
    sourceKind: 'social', sourceEventType: 'a_look', actorKey: 'ping', actorName: 'Ping',
    opportunityId: 'opportunity:rr-8', timestamp: OPEN_AT,
  });
  const queued = queueInstrumentalOpportunity(state, prepared.pending, 'opening-event-8');
  const restored = reconcileInstrumentalAgencyState(JSON.parse(JSON.stringify(state)));
  assert.equal(restored.pending.length, 1, 'the pending round-robin opportunity survives a restart');
  assert.equal(restored.pending[0].chosenAction, queued.chosenAction);
  assert.equal(restored.selectionCounters[prepared.pending.archetypeId], state.selectionCounters[prepared.pending.archetypeId],
    'the round-robin cursor itself survives a restart identically');
  ok('restart/replay of instrumental-agency state remains stable (8)');
}

// ---- 9: historical provenance remains intact ----
{
  const controllability = createControllabilityState();
  controllability.pairs['custody:officer_instruction:proctor|action:comply_instruction|SOCIAL_HOSTILITY'] = {
    pairKey: 'custody:officer_instruction:proctor|action:comply_instruction|SOCIAL_HOSTILITY',
    contextId: 'custody:officer_instruction:proctor', actionId: 'action:comply_instruction',
    outcomeClass: 'SOCIAL_HOSTILITY',
    action: { alpha: 3, beta: 1, mean: 0.75, variance: 0.0375, resolvedObservations: 2 },
    noAction: { alpha: 1, beta: 2, mean: 0.333, variance: 0.056, resolvedObservations: 1 },
    lastUpdatedAt: '2026-09-27 09:00:00.000',
  };
  const before = JSON.stringify(controllability.pairs);
  const plan = classifyInstrumentalControllability(controllability);
  assert.equal(plan.retirePairKeys.length, 1, 'the fabricated round-robin pair is correctly identified for retirement');
  // Retirement is not yet applied in this block - proving inspection alone
  // never mutates historical state.
  assert.equal(JSON.stringify(controllability.pairs), before,
    'classification alone never mutates historical controllability state');
  ok('historical provenance (world-event/incident history, unretired state) is never altered by mere inspection (9)');
}

// ---- 10: deterministic reconciliation removes only round-robin-derived false action evidence ----
{
  assert.equal(isRoundRobinContextId('custody:officer_instruction:proctor'), true);
  assert.equal(isRoundRobinContextId('social:provocation:ping'), true);
  assert.equal(isRoundRobinContextId('genuine:context:test'), false);
  assert.equal(isRoundRobinContextId('meal:breakfast'), false, 'meal contexts are a different, already-reconciled category');

  const controllability = createControllabilityState();
  controllability.pairs['custody:officer_instruction:proctor|action:comply_instruction|SOCIAL_HOSTILITY'] = {
    pairKey: 'custody:officer_instruction:proctor|action:comply_instruction|SOCIAL_HOSTILITY',
    contextId: 'custody:officer_instruction:proctor', actionId: 'action:comply_instruction',
    outcomeClass: 'SOCIAL_HOSTILITY',
    action: { alpha: 3, beta: 1, mean: 0.75, variance: 0.0375, resolvedObservations: 2 },
    noAction: { alpha: 1, beta: 2, mean: 0.333, variance: 0.056, resolvedObservations: 1 },
    lastUpdatedAt: '2026-09-27 09:00:00.000',
  };
  // A hypothetical genuine (non-round-robin) pair that must survive.
  controllability.pairs['genuine:context:test|action:option_a|SOCIAL_HOSTILITY'] = {
    pairKey: 'genuine:context:test|action:option_a|SOCIAL_HOSTILITY',
    contextId: 'genuine:context:test', actionId: 'action:option_a', outcomeClass: 'SOCIAL_HOSTILITY',
    action: { alpha: 1, beta: 2, mean: 0.333, variance: 0.056, resolvedObservations: 1 },
    noAction: { alpha: 1, beta: 1, mean: 0.5, variance: 0.083, resolvedObservations: 0 },
    lastUpdatedAt: OPEN_AT,
  };
  controllability.opportunities['instrumental:pending-1'] = {
    opportunityId: 'instrumental:pending-1', contextId: 'custody:officer_instruction:proctor',
  };
  controllability.opportunityHistory.push(
    { opportunityId: 'instrumental:abc-1', contextId: 'custody:officer_instruction:proctor' },
    { opportunityId: 'genuine:opportunity-1', contextId: 'genuine:context:test' },
  );
  controllability.resolvedOpportunityIds.push('instrumental:abc-1', 'genuine:opportunity-1');
  controllability.history.push(
    { contextId: 'custody:officer_instruction:proctor', outcomeClass: 'SOCIAL_HOSTILITY' },
    { contextId: 'genuine:context:test', outcomeClass: 'SOCIAL_HOSTILITY' },
  );

  const plan = classifyInstrumentalControllability(controllability);
  assert.equal(plan.retirePairKeys.length, 1);
  assert.equal(plan.retirePairKeys[0], 'custody:officer_instruction:proctor|action:comply_instruction|SOCIAL_HOSTILITY');
  assert.equal(plan.retireOpportunityIds.length, 1);
  assert.equal(plan.retireOpportunityHistoryCount, 1);
  assert.equal(plan.retireResolvedIds.length, 1);
  assert.equal(plan.retireHistoryCount, 1);

  retireInstrumentalRoundRobinContamination({ cognition: { learnedControllability: controllability } }, { classification: plan });
  assert.deepEqual(Object.keys(controllability.pairs), ['genuine:context:test|action:option_a|SOCIAL_HOSTILITY']);
  assert.deepEqual(Object.keys(controllability.opportunities), []);
  assert.equal(controllability.opportunityHistory.length, 1);
  assert.equal(controllability.opportunityHistory[0].contextId, 'genuine:context:test');
  assert.deepEqual(controllability.resolvedOpportunityIds, ['genuine:opportunity-1']);
  assert.equal(controllability.history.length, 1);
  assert.equal(controllability.history[0].contextId, 'genuine:context:test');

  const rerun = classifyInstrumentalControllability(controllability);
  assert.equal(rerun.retirePairKeys.length, 0, 'a second reconcile pass finds nothing left to retire (idempotent)');
  ok('deterministic reconciliation removes only round-robin-derived false action evidence, leaving a genuine pair byte-for-byte intact (10)');
}

console.log(`\ninstrumental-round-robin-false-agency.test.js: all ${n} checks passed`);
