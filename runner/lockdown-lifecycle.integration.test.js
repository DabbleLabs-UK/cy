// lockdown-lifecycle.integration.test.js - proves the persisted lockdown
// episode (location-regime.js) drives the EXISTING current-defensive-context
// / operational-anxiety consumer pipeline through a full, real start->release
// cycle: the same stable custody:lockdown context opens, stays active, and
// is explicitly closed - without ever falsifying the historically true start
// observation - and Anxiety returns to QUIET only once no other threat is
// active. This is the real production event path (captureEnvironmentEvent's
// own construction), not a synthetic replay fixture.

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEnvironmentEvent, createEnvironmentRecord } from './environment-schema.js';
import {
  advanceLockdownEpisode,
  startLockdownEpisode,
} from './location-regime.js';
import {
  createCurrentDefensiveContext,
  observeCurrentDefensiveContextRecord,
} from './current-defensive-context.js';
import { createThreatLearning, observeThreatLearningRecord } from './probabilistic-threat-learning.js';
import { operationalAnxietySnapshot } from './operational-anxiety-state.js';

const AT = Date.parse('2026-09-27T09:00:00.000Z');

function toRecord(id, event) {
  return createEnvironmentRecord(createEnvironmentEvent('lockdown', {
    id, timestamp: event.occurredAt, eventType: event.eventType,
    world: event.world, observation: event.observation,
  }));
}

// A second, unrelated defensive context (a distinct outcome class and a
// distinct stable id), used to prove the lockdown lifecycle never touches
// state that is not its own.
function unrelatedRecord(id, temporalStatus) {
  return createEnvironmentRecord(createEnvironmentEvent('hostile_interaction', {
    id, timestamp: new Date(AT).toISOString(), eventType: 'unrelated_hostile_contact',
    world: {
      participants: { actor: 'bill', relationship_ref: 'bill' },
      associative_learning: {
        linkage: 'self_contained_event',
        outcomes: [{ outcome_class: 'SOCIAL_HOSTILITY', status: 'occurred' }],
      },
      defensive_context: {
        context_id: 'social:unrelated-bill', temporal_status: temporalStatus,
        adverse_outcome_classes: ['SOCIAL_HOSTILITY'],
      },
    },
  }));
}

test('lockdown start opens the same stable context that release later closes, without touching unrelated contexts or falsifying history', () => {
  const defensiveContext = createCurrentDefensiveContext(AT);
  const threatLearning = createThreatLearning(AT);

  // An unrelated context is already active before the lockdown begins.
  observeCurrentDefensiveContextRecord(defensiveContext, threatLearning, null, unrelatedRecord('unrelated-onset', 'ONGOING'));
  assert.equal(operationalAnxietySnapshot(defensiveContext).status, 'THREAT_ONGOING');

  // 1 & 5: lockdown starts once; start provenance preserved.
  const started = startLockdownEpisode({ lockdownEpisode: null }, { nowMs: AT, durationMs: 30 * 60 * 1000 });
  const startRecord = toRecord('lockdown-start-1', started.event);
  const startResult = observeCurrentDefensiveContextRecord(defensiveContext, threatLearning, null, startRecord);
  assert.equal(startResult.updated, true);
  const key = 'custody:lockdown|COERCIVE_LOSS_OF_CONTROL';
  assert.equal(defensiveContext.contexts[key].active, true);
  assert.equal(defensiveContext.contexts[key].temporalStatus, 'ONGOING');
  assert.equal(defensiveContext.contexts[key].outcomeStatus, 'occurred');
  assert.deepEqual(defensiveContext.contexts[key].sourceEnvironmentEventIds, ['lockdown-start-1']);
  assert.equal(operationalAnxietySnapshot(defensiveContext).status, 'THREAT_ONGOING');

  // 4: the pre-existing unrelated context is untouched by the lockdown starting.
  assert.equal(defensiveContext.contexts['social:unrelated-bill|SOCIAL_HOSTILITY'].active, true);

  // Threat learning recorded exactly one COERCIVE_LOSS_OF_CONTROL trial from the start.
  observeThreatLearningRecord(threatLearning, startRecord);
  const pairAfterStart = threatLearning.pairs['event:lockdown_started']?.COERCIVE_LOSS_OF_CONTROL;
  assert.ok(pairAfterStart, 'the start event contributes a learned trial');
  const resolvedAfterStart = pairAfterStart.alpha + pairAfterStart.beta - 2; // prior is Beta(1,1)

  // 3 & 6: explicit release closes the SAME context; release provenance preserved.
  const released = advanceLockdownEpisode(started.state, { nowMs: AT + 30 * 60 * 1000 });
  assert.equal(released.released, true);
  const releaseRecord = toRecord('lockdown-release-1', released.event);
  const releaseResult = observeCurrentDefensiveContextRecord(defensiveContext, threatLearning, null, releaseRecord);
  assert.equal(releaseResult.updated, true);
  assert.equal(Object.hasOwn(defensiveContext.contexts, key), false,
    'resolution closes rather than pins the ongoing context');

  // 7: the historical start transition is NOT rewritten - it still shows the
  // true 'occurred' outcome, never negated to did_not_occur to force closure.
  const startEntry = defensiveContext.history.find((item) => item.sourceEnvironmentEventIds.includes('lockdown-start-1'));
  assert.equal(startEntry.outcomeStatus, 'occurred');
  assert.equal(startEntry.resolutionStatus, 'RESOLVED_ADVERSE');
  const releaseEntry = defensiveContext.history.find((item) => item.sourceEnvironmentEventIds.includes('lockdown-release-1'));
  assert.equal(releaseEntry.temporalStatus, 'RESOLVED');
  assert.notEqual(releaseEntry.outcomeStatus, 'did_not_occur',
    'release must never assert the coercive loss did not occur merely to resolve it');

  // 11 (by construction, not downstream dedup): the release event declares no
  // outcome for COERCIVE_LOSS_OF_CONTROL, so it contributes no further trial -
  // the posterior is exactly what the single start event produced.
  observeThreatLearningRecord(threatLearning, releaseRecord);
  const pairAfterRelease = threatLearning.pairs['event:lockdown_started'].COERCIVE_LOSS_OF_CONTROL;
  assert.equal(pairAfterRelease.alpha + pairAfterRelease.beta - 2, resolvedAfterStart,
    'the release event must not add a second trial for the same outcome class');

  // 4 (again) & 12: the unrelated context is still untouched; Anxiety still
  // reflects it, NOT a false QUIET, because a real threat remains active.
  assert.equal(defensiveContext.contexts['social:unrelated-bill|SOCIAL_HOSTILITY'].active, true);
  assert.equal(operationalAnxietySnapshot(defensiveContext).status, 'THREAT_ONGOING',
    'Anxiety must not report QUIET while an unrelated threat is still active');

  // Now resolve the unrelated context too, and only THEN does Anxiety return
  // to QUIET - proving 12 precisely: resolved lockdown + no other threats.
  observeCurrentDefensiveContextRecord(defensiveContext, threatLearning, null, unrelatedRecord('unrelated-resolution', 'RESOLVED'));
  assert.equal(operationalAnxietySnapshot(defensiveContext).status, 'QUIET');
});

test('a later, genuinely new lockdown re-opens the same stable context cleanly after a prior one resolved', () => {
  const defensiveContext = createCurrentDefensiveContext(AT);
  const threatLearning = createThreatLearning(AT);

  const first = startLockdownEpisode({ lockdownEpisode: null }, { nowMs: AT, durationMs: 10 * 60 * 1000 });
  observeCurrentDefensiveContextRecord(defensiveContext, threatLearning, null, toRecord('first-start', first.event));
  const firstReleased = advanceLockdownEpisode(first.state, { nowMs: AT + 10 * 60 * 1000 });
  observeCurrentDefensiveContextRecord(defensiveContext, threatLearning, null, toRecord('first-release', firstReleased.event));
  assert.equal(operationalAnxietySnapshot(defensiveContext).status, 'QUIET');

  const second = startLockdownEpisode(firstReleased.state, { nowMs: AT + 60 * 60 * 1000, durationMs: 10 * 60 * 1000 });
  assert.equal(second.started, true);
  observeCurrentDefensiveContextRecord(defensiveContext, threatLearning, null, toRecord('second-start', second.event));
  const key = 'custody:lockdown|COERCIVE_LOSS_OF_CONTROL';
  assert.equal(defensiveContext.contexts[key].active, true);
  assert.equal(operationalAnxietySnapshot(defensiveContext).status, 'THREAT_ONGOING');

  // Both the original and the new lockdown's history remain, distinctly provenanced.
  const starts = defensiveContext.history.filter((item) => item.contextId === 'custody:lockdown' && item.active);
  assert.equal(starts.length, 2);
});
