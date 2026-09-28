// tpm-restart-continuity.test.js - a runner restart must not let the TPM
// (three-process sleepiness model) integrate straight across a downtime gap
// as though the pre-gap sleep/wake state persisted. If the gap crossed a
// scheduled lights-out/lights-on transition that nothing could be recorded
// for, TPM continuity must be marked unknown (CALIBRATING) rather than
// inventing a continuous sleep or wake interval. Process S's own, separate
// unknown-gap handling (reachable-band widening) must not be touched by this.

import assert from 'node:assert/strict';
import {
  LIGHTS_ON_MIN,
  LIGHTS_OUT_MIN,
  scheduleAsleepAt,
  scheduleTransitionCrossed,
} from './prompt.js';
import { observeThreeProcessSleepState, threeProcessSleepinessSnapshot } from './three-process-sleepiness.js';
import {
  groundedSomaDirective,
  markSomaThreeProcessContinuityUnknown,
  reconcileSoma,
  replaySomaObservedSleepRecords,
} from './soma.js';

const HOUR = 3600000;

// Midnight London time on a winter date (no DST offset), so absolute UTC ms
// and London wall-clock minutes-of-day line up exactly for the arithmetic below.
const midnightLondon = Date.parse('2026-01-05T00:00:00.000Z');

// Sanity: the crossing detector agrees with the published schedule boundary.
assert.equal(scheduleAsleepAt(midnightLondon + (LIGHTS_OUT_MIN / 60) * HOUR), true);
assert.equal(scheduleAsleepAt(midnightLondon + (LIGHTS_ON_MIN / 60) * HOUR), false);

// 3. An ordinary short gap that stays inside one scheduled phase (here, the
// daytime/awake phase) must not be reported as a crossing.
assert.equal(scheduleTransitionCrossed(midnightLondon + 8 * HOUR, midnightLondon + 9 * HOUR), false,
  'a gap inside the awake phase must not report a crossing');

// 4. A gap spanning the scheduled wake -> sleep transition (lights-out, 22:30).
assert.equal(scheduleTransitionCrossed(midnightLondon + 21 * HOUR, midnightLondon + 23 * HOUR), true,
  'a gap crossing lights-out must report a crossing');

// 5. A gap spanning the scheduled sleep -> wake transition (lights-on, 06:30).
assert.equal(scheduleTransitionCrossed(midnightLondon + 5 * HOUR, midnightLondon + 7 * HOUR), true,
  'a gap crossing lights-on must report a crossing');

// 6. A gap spanning multiple transitions (more than one full schedule period).
assert.equal(scheduleTransitionCrossed(midnightLondon + 2 * HOUR, midnightLondon + 50 * HOUR), true,
  'a multi-day gap must report a crossing');

// --- End-to-end: replay a real TPM history to LIVE, then exercise a restart. ---

const dayStart = midnightLondon - 24 * HOUR;
const soma = reconcileSoma(null, { now: dayStart });
const priorRecords = [
  [0, 'sleep_period'], [8, 'awake'], [16, 'sleep_period'], [24, 'awake'],
].map(([hours, sleep_period], index) => ({
  event_id: `pre-${index}`,
  occurred_at_ms: dayStart + hours * HOUR,
  soma_input: { sleep_period, sleep_interruption: 'none' },
}));
replaySomaObservedSleepRecords(soma, priorRecords, { now: dayStart + 24 * HOUR });

// Cy is then observed going to sleep exactly at lights-out (22:30) on day 0.
const lightsOutAtMs = midnightLondon + (LIGHTS_OUT_MIN / 60) * HOUR;
observeThreeProcessSleepState(soma.predictedSleepiness, 'asleep', { now: lightsOutAtMs });
assert.equal(soma.predictedSleepiness.continuityKnown, true);
assert.equal(soma.predictedSleepiness.currentSleepState, 'asleep');
assert.equal(threeProcessSleepinessSnapshot(soma.predictedSleepiness, lightsOutAtMs).publicLabel, 'LIVE');

// 3 (integration). An ordinary restart a few minutes later, still within the
// same scheduled sleep phase, must not need continuity to be reset: nothing
// calls markSomaThreeProcessContinuityUnknown, and the TPM state is still LIVE.
const quietRestartAtMs = lightsOutAtMs + 5 * 60 * 1000;
assert.equal(scheduleTransitionCrossed(soma.predictedSleepiness.lastObservedAtMs, quietRestartAtMs), false);
const quietSnapshot = threeProcessSleepinessSnapshot(soma.predictedSleepiness, quietRestartAtMs);
assert.equal(quietSnapshot.publicLabel, 'LIVE');
assert.notEqual(quietSnapshot.predictedKss, null);

// 5 (integration). The runner then goes down at lights-out and restarts at
// 08:00 the next morning - crossing the 06:30 lights-on transition with
// nothing recorded for it. This is exactly the false-continuity scenario:
// without the fix, the next observed transition would integrate TPM sleep
// pressure straight across the whole outage as though Cy slept continuously.
const restartAtMs = lightsOutAtMs + 9.5 * HOUR;
assert.equal(scheduleTransitionCrossed(soma.predictedSleepiness.lastObservedAtMs, restartAtMs), true);

const processSBefore = JSON.parse(JSON.stringify(soma.sleepHomeostasis));
markSomaThreeProcessContinuityUnknown(soma, { now: restartAtMs, source: 'restart-gap-crossed-unrecorded-schedule-transition' });

const afterGap = threeProcessSleepinessSnapshot(soma.predictedSleepiness, restartAtMs);
assert.equal(afterGap.publicLabel, 'CALIBRATING', 'a silently crossed schedule transition must force CALIBRATING, not invented continuity');
assert.equal(afterGap.predictedKss, null);
assert.equal(soma.predictedSleepiness.continuityKnown, false);
assert.equal(soma.predictedSleepiness.completeObservedSleepEpisodes, 0);

// 7. Process S's own unknown-gap handling (reachable-band widening) must be
// completely untouched by the TPM continuity fix.
assert.deepEqual(soma.sleepHomeostasis, processSBefore,
  'Process S state must not be altered by the TPM continuity-unknown fix');

// 9. No new prompt path is introduced: a TPM state that was just reset to
// CALIBRATING by the restart-gap fix produces no "Predicted KSS" prompt line,
// exactly like a state that has never observed a sleep transition at all -
// the fix only routes back into the pre-existing CALIBRATING framing.
const freshSoma = reconcileSoma(null, { now: restartAtMs });
const freshDirective = groundedSomaDirective(freshSoma, { now: restartAtMs }).directive;
const resetDirective = groundedSomaDirective(soma, { now: restartAtMs }).directive;
assert.doesNotMatch(freshDirective, /Predicted KSS/i);
assert.doesNotMatch(resetDirective, /Predicted KSS/i);
const sleepPressureLine = resetDirective.split('\n').find((line) => /sleep-pressure estimate/i.test(line));
assert.ok(sleepPressureLine, 'the directive must still carry a Process S sleep-pressure line');
assert.doesNotMatch(sleepPressureLine, /observed/i);

// 8. TPM coefficients/equations are unchanged by this fix (see also the
// literal parameter assertions in three-process-sleepiness.test.js, section A).
assert.equal(soma.predictedSleepiness.modelId, 'ingre-akerstedt-three-process-sb-c-u');
assert.equal(soma.predictedSleepiness.modelVersion, 'tpm-predicted-kss-v1');

console.log('tpm-restart-continuity.test.js: all checks passed');
