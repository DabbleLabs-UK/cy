import assert from 'node:assert/strict';

import {
  reconcileSoma,
  somaDiagnosticSnapshot,
  somaLiveSnapshot,
  somaSnapshot,
  SOMA_LIVE_SNAPSHOT_LIMITS,
} from './soma.js';

const now = Date.parse('2026-09-19T20:00:00Z');
const state = reconcileSoma(null, { now });

function defensiveContext(index) {
  const timestamp = new Date(now + index * 1000).toISOString();
  return {
    contextId: `event:${index}`,
    contextKey: `event:${index}|coercive_loss_of_control`,
    outcomeClass: 'coercive_loss_of_control',
    active: true,
    activeCues: [{ cueId: `officer:${index}`, cueType: 'actor', presence: 'PRESENT_EXTERNAL_CUE' }],
    learnedAssociations: [{
      cueId: `officer:${index}`,
      cueType: 'actor',
      outcomeClass: 'coercive_loss_of_control',
      posterior: { alpha: 2, beta: 2, mean: 0.5, variance: 0.05, resolvedObservations: 0 },
    }],
    worldAmbiguity: 'UNKNOWN',
    objectiveControllability: 'UNKNOWN',
    perceivedControllability: 'NOT_MODELLED',
    learnedActionOutcomeContingency: [],
    causalActionOutcomeControl: 'NOT_MODELLED',
    temporalStatus: 'UNKNOWN',
    outcomeStatus: 'unknown',
    resolutionStatus: 'UNKNOWN',
    openedAt: timestamp,
    updatedAt: timestamp,
  };
}

for (let index = 0; index < 2000; index += 1) {
  state.currentDefensiveContext.contexts[`context-${index}`] = defensiveContext(index);
}
for (let index = 0; index < 500; index += 1) {
  state.feeding.unknownIntervals.push({
    startedAtMs: now + index * 2000,
    endedAtMs: now + index * 2000 + 1000,
    reason: 'RUNNER_NOT_OBSERVING',
    ingestionAssumption: 'NONE_MADE',
  });
  state.socialContact.observationGaps.push({
    startedAtMs: now + index * 2000,
    endedAtMs: now + index * 2000 + 1000,
    reason: 'RUNNER_NOT_OBSERVING',
  });
  state.physiologicalSatiety.intakeHistory.push({
    eventId: `meal-${index}`,
    timestamp: new Date(now + index * 2000).toISOString(),
    nutritionBasis: 'TEST_FIXTURE',
  });
}

const full = somaSnapshot(state);
const live = somaLiveSnapshot(state);
const diagnostic = somaDiagnosticSnapshot(state);

const fullBytes = Buffer.byteLength(JSON.stringify(full));
const liveBytes = Buffer.byteLength(JSON.stringify(live));
const diagnosticBytes = Buffer.byteLength(JSON.stringify(diagnostic));

assert.ok(fullBytes > 1_000_000, `fixture must expose accumulated growth; got ${fullBytes}`);
assert.ok(liveBytes < 100_000, `live vitals snapshot must remain compact; got ${liveBytes}`);
assert.ok(diagnosticBytes < 50_000, `latest-only diagnostic must remain compact; got ${diagnosticBytes}`);
assert.ok(liveBytes < fullBytes / 10, 'live snapshot should be at least an order of magnitude smaller');

assert.equal(live.operationalAnxiety.activeConcernCount, 2000);
assert.equal(
  live.operationalAnxiety.activeConcerns.length,
  SOMA_LIVE_SNAPSHOT_LIMITS.anxietyConcerns,
);
assert.equal(live.operationalAnxiety.activeConcernsTruncated, true);
assert.equal(live.currentDefensiveContext.activeContextCount, 2000);
assert.equal(
  live.currentDefensiveContext.activeContexts.length,
  SOMA_LIVE_SNAPSHOT_LIMITS.defensiveContexts,
);
assert.equal(live.feeding.unknownIntervalCount, 500);
assert.equal(
  live.feeding.unknownIntervals.length,
  SOMA_LIVE_SNAPSHOT_LIMITS.feedingUnknownIntervals,
);
assert.equal(live.social.observationGapCount, 500);
assert.equal(
  live.social.observationGaps.length,
  SOMA_LIVE_SNAPSHOT_LIMITS.socialObservationGaps,
);

assert.equal('environmentInput' in live, false);
assert.equal('physiologicalSatietyInspection' in live, false);
assert.ok(live.operationalAnxiety.currentConcern, 'current Anxiety state remains available to the UI');
assert.ok(live.experienced && live.experienced.metrics, 'legacy UI compatibility metrics remain available');
assert.ok(live.circuits, 'brain/UI compatibility fields remain available');

assert.equal(diagnostic.physiologicalSatietyInspection.intakeHistoryCount, 500);
assert.equal(diagnostic.physiologicalSatietyInspection.recentIntakeHistory.length, 8);
assert.equal('intakeHistory' in diagnostic.physiologicalSatietyInspection, false);

// Building either projection must not prune authoritative local recovery state.
assert.equal(Object.keys(state.currentDefensiveContext.contexts).length, 2000);
assert.equal(state.feeding.unknownIntervals.length, 500);
assert.equal(state.physiologicalSatiety.intakeHistory.length, 500);

// Increasing accumulated state further must not increase the bounded windows.
for (let index = 2000; index < 4000; index += 1) {
  state.currentDefensiveContext.contexts[`context-${index}`] = defensiveContext(index);
}
const largerLive = somaLiveSnapshot(state);
assert.equal(largerLive.operationalAnxiety.activeConcerns.length, SOMA_LIVE_SNAPSHOT_LIMITS.anxietyConcerns);
assert.equal(largerLive.currentDefensiveContext.activeContexts.length, SOMA_LIVE_SNAPSHOT_LIMITS.defensiveContexts);
assert.ok(
  Buffer.byteLength(JSON.stringify(largerLive)) < 100_000,
  'live payload remains bounded as authoritative history grows',
);

console.log(JSON.stringify({ fullBytes, liveBytes, diagnosticBytes }));
