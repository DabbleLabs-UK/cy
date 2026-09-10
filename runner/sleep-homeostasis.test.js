import assert from 'node:assert/strict';
import {
  HOUR_MS,
  SLEEP_STATES,
  TAU_SLEEP_HOURS,
  TAU_WAKE_HOURS,
  createSleepHomeostasis,
  observeSleepState,
  processSSleep,
  processSWake,
  propagateProcessSRange,
  reconcileSleepHomeostasis,
  sleepHomeostasisHistory,
  sleepHomeostasisSnapshot,
  tickSleepHomeostasis,
} from './sleep-homeostasis.js';

const near = (actual, expected, tolerance = 1e-12, message = '') => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message} ${actual} != ${expected}`);
};

// A. WAKE: analytical saturating exponential.
const wakeExpected = 1 - (1 - 0.3) * Math.exp(-8 / TAU_WAKE_HOURS);
near(processSWake(0.3, 8 * HOUR_MS), wakeExpected, 1e-12, 'wake equation');

// B. SLEEP: analytical exponential dissipation.
const sleepExpected = 0.8 * Math.exp(-8 / TAU_SLEEP_HOURS);
near(processSSleep(0.8, 8 * HOUR_MS), sleepExpected, 1e-12, 'sleep equation');

// C. TIMESTEP INVARIANCE.
const oneStep = processSWake(0.27, 8 * HOUR_MS);
let manySteps = 0.27;
for (let i = 0; i < 32; i++) manySteps = processSWake(manySteps, 0.25 * HOUR_MS);
near(manySteps, oneStep, 1e-12, 'wake timestep invariance');

// D. INTERRUPTED SLEEP: sleep -> wake -> sleep sequence.
let interrupted = 0.9;
interrupted = processSSleep(interrupted, 3 * HOUR_MS);
interrupted = processSWake(interrupted, 0.5 * HOUR_MS);
interrupted = processSSleep(interrupted, 2 * HOUR_MS);
const expectedInterrupted = processSSleep(
  processSWake(processSSleep(0.9, 3 * HOUR_MS), 0.5 * HOUR_MS),
  2 * HOUR_MS,
);
near(interrupted, expectedInterrupted, 1e-12, 'interrupted sleep sequence');

// E. UNCERTAIN INITIAL STATE: both endpoints propagate and contract under
// observed history. No guessed S0 is introduced.
const uncertainWake = propagateProcessSRange(0, 1, 16 * HOUR_MS, SLEEP_STATES.AWAKE);
near(uncertainWake.sMin, processSWake(0, 16 * HOUR_MS));
near(uncertainWake.sMax, 1);
assert.ok(uncertainWake.sMax - uncertainWake.sMin < 1);
const uncertainSleep = propagateProcessSRange(
  uncertainWake.sMin,
  uncertainWake.sMax,
  8 * HOUR_MS,
  SLEEP_STATES.ASLEEP,
);
assert.ok(uncertainSleep.sMax - uncertainSleep.sMin < uncertainWake.sMax - uncertainWake.sMin);

// F. RESTART: persisted JSON state integrates a known 45-minute wake gap.
const t0 = Date.UTC(2026, 8, 10, 8, 0, 0);
const running = createSleepHomeostasis(t0);
observeSleepState(running, SLEEP_STATES.AWAKE, { now: t0, source: 'test-start' });
tickSleepHomeostasis(running, { now: t0 + HOUR_MS, asleep: false });
const persisted = JSON.parse(JSON.stringify(running));
const restarted = reconcileSleepHomeostasis(persisted, {
  now: t0 + 1.75 * HOUR_MS,
  knownStateDuringGap: SLEEP_STATES.AWAKE,
});
near(restarted.sMin, processSWake(0, 1.75 * HOUR_MS), 1e-12, 'known restart interval');
assert.equal(restarted.currentSleepState, SLEEP_STATES.AWAKE);

// An unknown restart gap is not silently treated as continued wake or sleep.
const unknownGap = reconcileSleepHomeostasis(persisted, { now: t0 + 2 * HOUR_MS });
assert.equal(unknownGap.currentSleepState, SLEEP_STATES.UNKNOWN);
near(unknownGap.sMin, processSSleep(persisted.sMin, HOUR_MS), 1e-12, 'unknown gap lower envelope');
near(unknownGap.sMax, processSWake(persisted.sMax, HOUR_MS), 1e-12, 'unknown gap upper envelope');

// G. HISTORY: starts empty on installation and contains only post-installation
// Process S observations, never legacy fatigue backfill.
const fresh = createSleepHomeostasis(t0);
assert.deepEqual(sleepHomeostasisHistory(fresh), []);
observeSleepState(fresh, SLEEP_STATES.AWAKE, { now: t0, source: 'test-observation' });
tickSleepHomeostasis(fresh, { now: t0 + 3 * HOUR_MS, asleep: false });
assert.ok(sleepHomeostasisHistory(fresh).length >= 2);
assert.ok(sleepHomeostasisHistory(fresh).every((point) => point.ts >= t0));
assert.ok(sleepHomeostasisHistory(fresh).every((point) => !Object.hasOwn(point, 'fatigue')));

const snapshot = sleepHomeostasisSnapshot(fresh);
assert.equal(snapshot.publicLabel, 'LIVE');
assert.equal(snapshot.circadianComponent.publicLabel, 'NOT MODELLED');
assert.equal(snapshot.sleepPressureIndex, Math.round(100 * snapshot.sleepPressure));

console.log('sleep-homeostasis.test.js: all checks passed');
