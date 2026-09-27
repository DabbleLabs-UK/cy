// threat-defensive-dedup.test.js - event-ID deduplication for probabilistic
// threat learning and current defensive context.
//
// Other grounded substrates (e.g. somatic-nociceptive-substrate.js) already
// refuse to re-apply an environment event whose ID has already been seen.
// probabilistic-threat-learning.js and current-defensive-context.js did not:
// replay/reload/direct re-ingestion of the exact same structured event could
// increment Beta threat posteriors again and append duplicate
// defensive-context transitions/provenance, letting one real observation
// count multiple times.
//
// Fix: both substrates now keep a small, bounded, persisted ledger of source
// event IDs already applied (PROCESSED_EVENT_ID_LIMIT, FIFO-capped). A first
// ingestion of an event ID processes and updates state normally, marking the
// ID as processed only once something was actually applied. Any later
// ingestion of the SAME event ID is a complete no-op - no posterior update,
// no history/context mutation, no relations to instrumental/AWG paths
// touched. A genuinely different event ID (including a resolution event for
// the very same stable context) always counts independently, because dedup
// is keyed on event identity, never on context identity - this is the
// deliberate distinction the task called out: deduplicate the SOURCE EVENT,
// not the context it updates.
//
// Self-checking: throws (non-zero exit) on any failure.
//
//   node runner/threat-defensive-dedup.test.js

import assert from 'node:assert/strict';
import {
  createThreatLearning,
  observeThreatLearningRecord,
  reconcileThreatLearning,
  updateThreatLearning,
  PROCESSED_EVENT_ID_LIMIT as THREAT_PROCESSED_EVENT_ID_LIMIT,
} from './probabilistic-threat-learning.js';
import {
  createCurrentDefensiveContext,
  observeCurrentDefensiveContextRecord,
  reconcileCurrentDefensiveContext,
} from './current-defensive-context.js';
import { createEnvironmentEvent, createEnvironmentRecord } from './environment-schema.js';

let n = 0;
const ok = (msg) => { n++; console.log('  ok - ' + msg); };

const T0 = '2026-09-27 09:00:00.000';

// 3 cues (event/actor/location) x 2 outcome classes = 6 distinct, all-resolved
// trials from a single ingestion - a real multi-cue fixture, not a synthetic one.
function cellSearchRecord(id, timestamp = T0) {
  return createEnvironmentRecord(createEnvironmentEvent('cell_search', {
    id, timestamp, eventType: 'officer_search',
    world: { participants: { actor: 'proctor', relationship_ref: 'proctor' } },
  }));
}

// Seeds only the single outcome class the defensiveRecord fixture below
// explicitly declares, so defensive-context tests exercise exactly one
// context transition per event, not an incidental second one pulled in from
// an already-learned but unrelated outcome class on the same actor cue.
function seedThreatLearning() {
  const learning = createThreatLearning(Date.parse(T0));
  updateThreatLearning(learning, {
    cueId: 'actor:proctor', cueType: 'actor', outcomeClass: 'COERCIVE_LOSS_OF_CONTROL',
    status: 'occurred', timestamp: T0, sourceEnvironmentEventIds: ['seed-learning-event'],
  });
  return learning;
}

function defensiveRecord({
  id, timestamp = T0, contextId, phase = 'POTENTIAL', outcome = 'unknown', actor = 'proctor',
  eventType = 'officer_at_cell',
} = {}) {
  return createEnvironmentRecord(createEnvironmentEvent('cell_search', {
    id, timestamp, eventType,
    world: {
      participants: { actor, relationship_ref: actor },
      situation: { control: 'none', resolution_status: phase === 'RESOLVED' ? 'resolved' : 'unresolved' },
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
    observation: { certainty: 'certain' },
  }));
}

// ---- 1: first event ingestion updates threat learning ----
{
  const state = createThreatLearning(Date.parse(T0));
  const result = observeThreatLearningRecord(state, cellSearchRecord('dedup-event-1'));
  assert.equal(result.trialsExamined, 6);
  assert.equal(result.updatesApplied, 6);
  assert.equal(result.duplicateEvent, undefined);
  assert.equal(state.pairs['actor:proctor'].COERCIVE_LOSS_OF_CONTROL.alpha, 2);
  ok('first ingestion of a new event updates threat learning normally (1)');
}

// ---- 2: same event ID twice updates only once ----
{
  const state = createThreatLearning(Date.parse(T0));
  const record = cellSearchRecord('dedup-event-2');
  const first = observeThreatLearningRecord(state, record);
  const snapshotAfterFirst = JSON.stringify(state.pairs);
  const second = observeThreatLearningRecord(state, record);
  assert.equal(first.updatesApplied, 6);
  assert.equal(second.updatesApplied, 0);
  assert.equal(second.trialsExamined, 0, 'a duplicate is rejected before trials are even recomputed');
  assert.equal(second.duplicateEvent, true);
  assert.equal(JSON.stringify(state.pairs), snapshotAfterFirst,
    'replaying the identical event ID leaves every posterior byte-for-byte untouched');
  assert.equal(state.pairs['actor:proctor'].COERCIVE_LOSS_OF_CONTROL.alpha, 2,
    'posterior is not incremented a second time');
  ok('replaying the exact same event ID a second time is a complete no-op (2)');
}

// ---- 3: same semantic event with a NEW event ID counts separately ----
{
  const state = createThreatLearning(Date.parse(T0));
  observeThreatLearningRecord(state, cellSearchRecord('dedup-event-3a'));
  const second = observeThreatLearningRecord(state, cellSearchRecord('dedup-event-3b'));
  assert.equal(second.updatesApplied, 6, 'a genuinely distinct event ID always counts, even with identical content');
  assert.equal(state.pairs['actor:proctor'].COERCIVE_LOSS_OF_CONTROL.alpha, 3,
    '1 prior (Beta prior alpha=1) + 2 independent real occurrences');
  ok('two distinct event IDs for the same semantic event both count independently (3)');
}

// ---- 4: multiple cues in one first-time event all count correctly ----
{
  const state = createThreatLearning(Date.parse(T0));
  const result = observeThreatLearningRecord(state, cellSearchRecord('dedup-event-4'));
  assert.equal(result.trialsExamined, 6, '3 cues x 2 outcome classes from a single event');
  assert.equal(result.updatesApplied, 6, 'every valid cue/outcome trial from the first ingestion updates');
  for (const cueId of ['event:officer_search', 'actor:proctor', 'location:cell']) {
    assert.equal(state.pairs[cueId].COERCIVE_LOSS_OF_CONTROL.alpha, 2);
    assert.equal(state.pairs[cueId].PHYSICAL_HARM.beta, 2);
  }
  ok('all distinct cue/outcome trials from a single first-time event update correctly on first ingestion (4)');
}

// ---- 5: defensive-context history records a source event once ----
{
  const learning = seedThreatLearning();
  const state = createCurrentDefensiveContext(Date.parse(T0));
  const record = defensiveRecord({ id: 'dedup-context-event-1', contextId: 'search:dedup', phase: 'POTENTIAL' });
  const first = observeCurrentDefensiveContextRecord(state, learning, record);
  assert.equal(first.transitions.length, 1);
  assert.equal(state.history.length, 1);
  const second = observeCurrentDefensiveContextRecord(state, learning, record);
  assert.equal(second.updated, false);
  assert.equal(second.duplicateEvent, true);
  assert.equal(second.transitions.length, 0);
  assert.equal(state.history.length, 1, 'replaying the same event ID appends no second history entry');
  assert.deepEqual(state.contexts['search:dedup|COERCIVE_LOSS_OF_CONTROL'].sourceEnvironmentEventIds,
    ['dedup-context-event-1'], 'the context provenance is not re-touched by the duplicate');
  ok('defensive-context history and current-state provenance record a source event only once (5)');
}

// ---- 6: start and resolution of the SAME context both work because their event IDs differ ----
{
  const learning = seedThreatLearning();
  const state = createCurrentDefensiveContext(Date.parse(T0));
  const start = observeCurrentDefensiveContextRecord(state, learning, defensiveRecord({
    id: 'dedup-lockdown-start', contextId: 'lockdown:dedup', phase: 'ONGOING',
  }));
  assert.equal(start.updated, true);
  assert.equal(start.transitions[0].active, true);
  const resolution = observeCurrentDefensiveContextRecord(state, learning, defensiveRecord({
    id: 'dedup-lockdown-resolution', contextId: 'lockdown:dedup', phase: 'RESOLVED', outcome: 'did_not_occur',
    timestamp: '2026-09-27 09:05:00.000',
  }));
  assert.equal(resolution.updated, true, 'a genuinely distinct event ID against the same context always processes');
  assert.equal(resolution.duplicateEvent, undefined);
  assert.equal(resolution.transitions[0].active, false);
  assert.equal(resolution.transitions[0].resolutionStatus, 'RESOLVED_SAFE');
  assert.equal(Object.hasOwn(state.contexts, 'lockdown:dedup|COERCIVE_LOSS_OF_CONTROL'), false,
    'the context correctly closes');
  assert.equal(state.history.length, 2,
    'both the start and the resolution are recorded, since dedup is keyed on event ID, not context ID');
  ok('a start event and a later resolution event for the SAME stable context both process, because their event IDs differ (6)');
}

// ---- 7: unrelated contexts unaffected by deduplicating a different context's event ----
{
  const learning = seedThreatLearning();
  const state = createCurrentDefensiveContext(Date.parse(T0));
  observeCurrentDefensiveContextRecord(state, learning, defensiveRecord({
    id: 'dedup-context-a', contextId: 'search:a', phase: 'ONGOING',
  }));
  observeCurrentDefensiveContextRecord(state, learning, defensiveRecord({
    id: 'dedup-context-b', contextId: 'search:b', phase: 'ONGOING',
  }));
  const beforeB = JSON.stringify(state.contexts['search:b|COERCIVE_LOSS_OF_CONTROL']);
  const dup = observeCurrentDefensiveContextRecord(state, learning, defensiveRecord({
    id: 'dedup-context-a', contextId: 'search:a', phase: 'ONGOING',
  }));
  assert.equal(dup.duplicateEvent, true);
  assert.equal(JSON.stringify(state.contexts['search:b|COERCIVE_LOSS_OF_CONTROL']), beforeB,
    'an unrelated context is untouched by a duplicate on a different context');
  assert.equal(Object.keys(state.contexts).length, 2, 'both original contexts remain, none duplicated or dropped');
  ok('deduplicating one event does not affect unrelated contexts (7)');
}

// ---- 8: dedup survives checkpoint/restart ----
{
  const learning = seedThreatLearning();
  const state = createCurrentDefensiveContext(Date.parse(T0));
  const record = defensiveRecord({ id: 'dedup-restart-event', contextId: 'search:restart', phase: 'ONGOING' });
  observeCurrentDefensiveContextRecord(state, learning, record);
  const restored = reconcileCurrentDefensiveContext(JSON.parse(JSON.stringify(state)));
  const afterRestart = observeCurrentDefensiveContextRecord(restored, learning, record);
  assert.equal(afterRestart.duplicateEvent, true, 'the dedup ledger itself survives a save/reload cycle');
  assert.equal(afterRestart.updated, false);

  const tState = createThreatLearning(Date.parse(T0));
  const tRecord = cellSearchRecord('dedup-restart-threat-event');
  observeThreatLearningRecord(tState, tRecord);
  const tRestored = reconcileThreatLearning(JSON.parse(JSON.stringify(tState)));
  const tAfterRestart = observeThreatLearningRecord(tRestored, tRecord);
  assert.equal(tAfterRestart.duplicateEvent, true);
  assert.equal(tAfterRestart.updatesApplied, 0);
  ok('the dedup ledger for both substrates survives a real JSON checkpoint/restart cycle (8)');
}

// ---- 9: legacy checkpoint without dedup metadata loads safely ----
{
  const legacyThreat = createThreatLearning(Date.parse(T0));
  observeThreatLearningRecord(legacyThreat, cellSearchRecord('legacy-threat-event'));
  const rawLegacyThreat = JSON.parse(JSON.stringify(legacyThreat));
  delete rawLegacyThreat.processedEventIds;
  const reconciledLegacyThreat = reconcileThreatLearning(rawLegacyThreat);
  assert.deepEqual(reconciledLegacyThreat.processedEventIds, [],
    'a legacy checkpoint reconciles to an empty dedup ledger rather than crashing');
  const nextThreatResult = observeThreatLearningRecord(reconciledLegacyThreat, cellSearchRecord('legacy-threat-event-2'));
  assert.equal(nextThreatResult.updatesApplied, 6,
    'threat learning keeps working correctly for new events after loading a legacy checkpoint');

  const legacyDefensive = createCurrentDefensiveContext(Date.parse(T0));
  const learning = seedThreatLearning();
  observeCurrentDefensiveContextRecord(legacyDefensive, learning, defensiveRecord({
    id: 'legacy-defensive-event', contextId: 'search:legacy', phase: 'ONGOING',
  }));
  const rawLegacyDefensive = JSON.parse(JSON.stringify(legacyDefensive));
  delete rawLegacyDefensive.processedEventIds;
  const reconciledLegacyDefensive = reconcileCurrentDefensiveContext(rawLegacyDefensive);
  assert.deepEqual(reconciledLegacyDefensive.processedEventIds, []);
  const nextDefensiveResult = observeCurrentDefensiveContextRecord(reconciledLegacyDefensive, learning, defensiveRecord({
    id: 'legacy-defensive-event-2', contextId: 'search:legacy2', phase: 'ONGOING',
  }));
  assert.equal(nextDefensiveResult.updated, true,
    'defensive context keeps working correctly for new events after loading a legacy checkpoint');
  ok('a checkpoint saved before this dedup field existed loads safely and continues deduplicating forward, never retroactively (9)');
}

// ---- 10: bounded dedup retention does not prune events needed for normal restart/replay semantics ----
{
  assert.ok(THREAT_PROCESSED_EVENT_ID_LIMIT >= 256,
    'the dedup bound is generous enough to cover realistic restart/replay windows, not a token handful');
  const state = createThreatLearning(Date.parse(T0));
  for (let index = 0; index < THREAT_PROCESSED_EVENT_ID_LIMIT; index += 1) {
    observeThreatLearningRecord(state, cellSearchRecord(`bounded-${index}`,
      `2026-09-27 09:${String(index % 60).padStart(2, '0')}:00.000`));
  }
  assert.equal(state.processedEventIds.length, THREAT_PROCESSED_EVENT_ID_LIMIT,
    'the dedup ledger is bounded at the documented limit');
  const firstReplay = observeThreatLearningRecord(state, cellSearchRecord('bounded-0', T0));
  assert.equal(firstReplay.duplicateEvent, true, 'the oldest event within the bound is still correctly deduplicated');
  const lastReplay = observeThreatLearningRecord(state, cellSearchRecord(`bounded-${THREAT_PROCESSED_EVENT_ID_LIMIT - 1}`, T0));
  assert.equal(lastReplay.duplicateEvent, true, 'the newest event within the bound is still correctly deduplicated');

  observeThreatLearningRecord(state, cellSearchRecord('bounded-overflow', T0));
  assert.equal(state.processedEventIds.length, THREAT_PROCESSED_EVENT_ID_LIMIT,
    'the ledger stays bounded, never growing past the documented limit');
  assert.equal(state.processedEventIds.includes('bounded-0'), false,
    'only the single oldest entry is evicted to make room (FIFO), matching normal replay-window expectations');
  assert.equal(state.processedEventIds.includes('bounded-1'), true,
    'all other recently-processed events remain available for dedup, unaffected by the single eviction');
  ok('the bounded dedup ledger retains every event needed for a realistic restart/replay window, evicting only the single oldest entry once genuinely full (10)');
}

console.log(`\nthreat-defensive-dedup.test.js: all ${n} checks passed`);
