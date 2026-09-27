// meal-action-outcome-inversion.test.js - the scheduled-meal producer
// (environment.js's chooseMealEvent) rolled a random meal outcome
// (eaten/partial/missed/refused) FIRST, then relabelled that outcome as an
// apparent EXECUTED accept_meal/refuse_meal action_opportunity - reversing
// causality. action-outcome-contingency.js then learned an
// action-conditioned Beta posterior from it, manufacturing evidence such as
// "accepting the meal prevents deprivation" even though the random outcome
// existed before the supposed action, and there is currently no genuine
// Cy/model chooser anywhere in this path.
//
// Fix: chooseMealEvent no longer asserts world.action_opportunity at all,
// for any outcome (eaten/partial/missed/refused). Genuine feeding/satiety
// facts (offered/available/received/consumed/intake_outcome) and the
// DEPRIVATION_OR_LOSS defensive-context/threat-learning signal are entirely
// unchanged. run.js's fireScheduled preserves the meal-expectation ->
// resolution provenance link (context.previous_event_ids) independently of
// action_opportunity, since that link is genuine provenance, not a choice
// claim.
//
// Self-checking: throws (non-zero exit) on any failure.
//
//   node runner/meal-action-outcome-inversion.test.js

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chooseMealEvent, mealExpectation } from './environment.js';
import { createEnvironmentEvent, createEnvironmentRecord } from './environment-schema.js';
import { ingestionRecordFromEnvironment, observeFeedingRecord, createFeedingState } from './feeding-homeostasis.js';
import {
  createControllabilityState,
  observeControllabilityRecord,
  reconcileControllabilityState,
} from './action-outcome-contingency.js';
import {
  createInstrumentalAgencyState,
  instrumentalOpportunityDefinitions,
  openInstrumentalOpportunity,
} from './instrumental-agency.js';
import {
  classifyControllability,
  isMealDerivedContextId,
  isMealDerivedOpportunityId,
  retireMealActionOutcomeContamination,
} from './reconcile-meal-action-outcome-contamination.mjs';

let n = 0;
const ok = (msg) => { n++; console.log('  ok - ' + msg); };

function mealRecord(id, meal, rnd, mealId = null) {
  const built = chooseMealEvent(meal, rnd, { mealId });
  return { built, record: createEnvironmentRecord(createEnvironmentEvent(built.archetypeId, {
    id, timestamp: '2026-09-27 07:30:00.000', eventType: built.name,
    world: built.world, observation: built.observation,
  })) };
}

// ---- 1: random meal outcome still produces correct feeding facts ----
{
  const { record: eatenRecord } = mealRecord('meal-1-eaten', 'breakfast', () => 0.1);
  const ingestion = ingestionRecordFromEnvironment(eatenRecord);
  assert.ok(ingestion, 'a fully-eaten meal still produces a valid feeding ingestion record');
  assert.equal(ingestion.intakeOutcome, 'FULLY_CONSUMED');
  const state = createFeedingState();
  const result = observeFeedingRecord(state, eatenRecord);
  assert.equal(result.updated, true);
  assert.equal(state.lastKnownIntakeAt, '2026-09-27 07:30:00.000');

  const { record: missedRecord } = mealRecord('meal-1-missed', 'tea', () => 0.95);
  const missedIngestion = ingestionRecordFromEnvironment(missedRecord);
  assert.equal(missedIngestion.intakeOutcome, 'UNAVAILABLE');
  ok('random meal outcomes (eaten and missed) still produce correct, genuine feeding facts (1)');
}

// ---- 2: meal outcome does not create action_opportunity ----
{
  for (const [meal, roll] of [['breakfast', 0.1], ['lunch', 0.9], ['tea', 0.95], ['tea', 0.99]]) {
    const built = chooseMealEvent(meal, () => roll, { mealId: `2026-09-27:${meal}` });
    assert.equal('action_opportunity' in built.world, false,
      `${meal} at roll ${roll} (outcome ${built.public.outcome}) asserts no action_opportunity`);
  }
  ok('no meal outcome (eaten, partial, missed, refused) creates an action_opportunity (2)');
}

// ---- 3: meal outcome does not update controllability posteriors ----
{
  const controllability = createControllabilityState();
  const { record } = mealRecord('meal-3-refused', 'tea', () => 0.99, '2026-09-27:tea');
  const result = observeControllabilityRecord(controllability, record);
  assert.equal(result.updated, false);
  assert.equal(result.reason, 'no_action_opportunity');
  assert.deepEqual(controllability.pairs, {}, 'no posterior pair is created from a meal event');
  assert.equal(controllability.opportunityHistory.length, 0);
  assert.equal(controllability.history.length, 0);
  ok('a meal outcome cannot update any action-outcome controllability posterior (3)');
}

// ---- 4: no "Cy chose..." event is emitted for scheduled meals ----
{
  const source = readFileSync(new URL('./run.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const fnStart = source.indexOf('function fireScheduled(');
  assert.ok(fnStart > -1, 'fireScheduled exists');
  const fnEnd = source.indexOf('\n  function ', fnStart + 1);
  const fnBody = source.slice(fnStart, fnEnd > -1 ? fnEnd : fnStart + 4000);
  assert.doesNotMatch(fnBody, /beginInstrumentalIncident/,
    'fireScheduled (the scheduled-meal path) never calls beginInstrumentalIncident, which is the only place that emits the "Cy chose ..." event');
  assert.doesNotMatch(fnBody, /Cy chose/);
  ok('no "Cy chose ..." event is structurally reachable from the scheduled-meal path (4)');
}

// ---- 5: real instrumental opportunities remain unchanged ----
{
  const definitions = instrumentalOpportunityDefinitions();
  assert.equal(definitions.length, 5, 'all five instrumental archetypes remain');
  const state = createInstrumentalAgencyState();
  const prepared = openInstrumentalOpportunity(state, {
    sourceKind: 'officer', sourceEventType: 'order', actorKey: 'proctor', actorName: 'Mr Proctor',
    opportunityId: 'opportunity:unchanged-check', timestamp: '2026-09-27 10:00:00.000',
  });
  assert.ok(prepared, 'instrumental opportunities still open normally');
  assert.equal(prepared.opening.world.action_opportunity.id, 'opportunity:unchanged-check');
  assert.equal(prepared.opening.world.instrumental.action_selection_provenance,
    'ENGINEERING_ROUND_ROBIN_NOT_PSYCHOLOGICAL');
  ok('real instrumental opportunities (officer/inmate round-robin paths) are structurally unchanged (5)');
}

// ---- 6: feeding/satiety facts remain fully correct for every meal outcome ----
{
  const outcomes = [
    ['breakfast', 0.1, 'FULLY_CONSUMED'],
    ['lunch', 0.9, 'PARTLY_CONSUMED'],
    ['tea', 0.95, 'UNAVAILABLE'],
    ['tea', 0.99, 'REFUSED'],
  ];
  for (const [meal, roll, expected] of outcomes) {
    const { record } = mealRecord(`meal-6-${meal}-${roll}`, meal, () => roll);
    assert.equal(ingestionRecordFromEnvironment(record).intakeOutcome, expected,
      `${meal} at roll ${roll} still resolves to ${expected} in feeding-homeostasis`);
  }
  ok('feeding/satiety intake-outcome derivation is unaffected by this fix for every meal branch (6)');
}

// ---- 7: restart/replay remains stable ----
{
  const controllability = createControllabilityState();
  const { record } = mealRecord('meal-7-eaten', 'breakfast', () => 0.1, '2026-09-27:breakfast');
  observeControllabilityRecord(controllability, record);
  assert.deepEqual(controllability.pairs, {}, 'meal event produced no pairs to begin with');
  const restored = reconcileControllabilityState(JSON.parse(JSON.stringify(controllability)));
  assert.deepEqual(restored.pairs, {});
  assert.deepEqual(restored.opportunityHistory, controllability.opportunityHistory);
  ok('restart/replay of controllability state remains stable across meal events (7)');
}

// ---- 8: historical meal provenance is preserved ----
{
  const state = createFeedingState();
  const expected = mealExpectation('lunch', '2026-09-27:lunch');
  const expectedRecord = createEnvironmentRecord(createEnvironmentEvent(expected.archetypeId, {
    id: 'meal-8-expected', timestamp: '2026-09-27 12:00:00.000',
    eventType: expected.name, world: expected.world, observation: expected.observation,
  }));
  observeFeedingRecord(state, expectedRecord);
  const { record: resolvedRecord } = mealRecord('meal-8-resolved', 'lunch', () => 0.1, '2026-09-27:lunch');
  observeFeedingRecord(state, resolvedRecord);
  assert.equal(state.records.length, 2, 'both the expectation and the resolved outcome remain in feeding history');
  assert.deepEqual(state.records.map((r) => r.eventId), ['meal-8-expected', 'meal-8-resolved']);
  assert.equal(state.records[1].mealId, '2026-09-27:lunch',
    'the resolved meal retains its meal identity, unaffected by removing action_opportunity');
  ok('historical meal provenance (feeding-homeostasis records, meal identity) is fully preserved (8)');
}

// ---- 9: reconciliation removes only meal-derived false trials ----
{
  assert.equal(isMealDerivedContextId('meal:breakfast'), true);
  assert.equal(isMealDerivedContextId('custody:officer_instruction:proctor'), false);
  assert.equal(isMealDerivedOpportunityId('meal:2026-09-27:breakfast'), true);
  assert.equal(isMealDerivedOpportunityId('opportunity:abc'), false);

  const controllability = createControllabilityState();
  // A genuine instrumental pair, must survive reconciliation untouched.
  controllability.pairs['custody:officer_instruction:proctor|action:comply_instruction|SOCIAL_HOSTILITY'] = {
    pairKey: 'custody:officer_instruction:proctor|action:comply_instruction|SOCIAL_HOSTILITY',
    contextId: 'custody:officer_instruction:proctor', actionId: 'action:comply_instruction',
    outcomeClass: 'SOCIAL_HOSTILITY',
    action: { alpha: 2, beta: 1, mean: 0.667, variance: 0.05, resolvedObservations: 1 },
    noAction: { alpha: 1, beta: 1, mean: 0.5, variance: 0.083, resolvedObservations: 0 },
    lastUpdatedAt: '2026-09-27 09:00:00.000',
  };
  // Contamination fixtures, matching exactly what the old buggy producer
  // would have created (reproduced directly, not via the now-fixed producer).
  controllability.pairs['meal:breakfast|action:accept_meal|DEPRIVATION_OR_LOSS'] = {
    pairKey: 'meal:breakfast|action:accept_meal|DEPRIVATION_OR_LOSS',
    contextId: 'meal:breakfast', actionId: 'action:accept_meal', outcomeClass: 'DEPRIVATION_OR_LOSS',
    action: { alpha: 1, beta: 11, mean: 0.083, variance: 0.006, resolvedObservations: 10 },
    noAction: { alpha: 1, beta: 1, mean: 0.5, variance: 0.083, resolvedObservations: 0 },
    lastUpdatedAt: '2026-09-27 07:30:00.000',
  };
  controllability.opportunityHistory.push(
    { opportunityId: 'custody:real-1', contextId: 'custody:officer_instruction:proctor' },
    { opportunityId: 'meal:2026-09-27:breakfast', contextId: 'meal:breakfast' },
  );
  controllability.resolvedOpportunityIds.push('custody:real-1', 'meal:2026-09-27:breakfast');
  controllability.history.push(
    { contextId: 'custody:officer_instruction:proctor', outcomeClass: 'SOCIAL_HOSTILITY' },
    { contextId: 'meal:breakfast', outcomeClass: 'DEPRIVATION_OR_LOSS' },
  );

  const plan = classifyControllability(controllability);
  assert.equal(plan.retirePairKeys.length, 1);
  assert.equal(plan.retirePairKeys[0], 'meal:breakfast|action:accept_meal|DEPRIVATION_OR_LOSS');
  assert.equal(plan.retireOpportunityHistoryCount, 1);
  assert.equal(plan.retireResolvedIds.length, 1);
  assert.equal(plan.retireHistoryCount, 1);

  retireMealActionOutcomeContamination({ cognition: { learnedControllability: controllability } }, { classification: plan });
  assert.deepEqual(Object.keys(controllability.pairs), ['custody:officer_instruction:proctor|action:comply_instruction|SOCIAL_HOSTILITY']);
  assert.equal(controllability.opportunityHistory.length, 1);
  assert.equal(controllability.opportunityHistory[0].opportunityId, 'custody:real-1');
  assert.equal(controllability.resolvedOpportunityIds.length, 1);
  assert.equal(controllability.resolvedOpportunityIds[0], 'custody:real-1');
  assert.equal(controllability.history.length, 1);
  assert.equal(controllability.history[0].contextId, 'custody:officer_instruction:proctor');

  const rerun = classifyControllability(controllability);
  assert.equal(rerun.retirePairKeys.length, 0, 'a second reconcile pass finds nothing left to retire (idempotent)');
  ok('reconciliation removes only meal-derived fabricated trials, leaving every genuine instrumental entry byte-for-byte intact (9)');
}

console.log(`\nmeal-action-outcome-inversion.test.js: all ${n} checks passed`);
