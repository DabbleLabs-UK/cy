import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TPM_BL,
  TPM_BETWEEN_SUBJECT_INTERCEPT_SD_KSS,
  TPM_C_A,
  TPM_D_PER_HOUR,
  TPM_G_PER_HOUR,
  TPM_HA,
  TPM_KSS_INTERCEPT,
  TPM_KSS_SLOPE,
  TPM_LA,
  TPM_PHASE_HOURS,
  TPM_RESIDUAL_SD_KSS,
  TPM_U_A,
  createThreeProcessSleepiness,
  markThreeProcessContinuityUnknown,
  observeThreeProcessSleepState,
  reconcileThreeProcessSleepiness,
  replayObservedSleepRecords,
  threeProcessSleepinessHistory,
  threeProcessSleepinessSnapshot,
  tpmCircadian,
  tpmKssFromAlertness,
  tpmKssRegion,
  tpmOriginalSleep,
  tpmSleepBrake,
  tpmUltradian,
  tpmWake,
} from './three-process-sleepiness.js';
import { groundedSomaDirective, reconcileSoma, replaySomaObservedSleepRecords, tickSoma } from './soma.js';

const HOUR = 3600000;
const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance,
  `${actual} should be within ${tolerance} of ${expected}`);

// A. Published parameter inventory is exact and Process W is absent.
assert.equal(TPM_HA, 14.3);
assert.equal(TPM_LA, 2.4);
assert.equal(TPM_D_PER_HOUR, -0.0353);
assert.equal(TPM_BL, 12.2);
close(TPM_G_PER_HOUR, Math.log((14.3 - 14.0) / (14.3 - 7.96)) / 8);
assert.equal(TPM_C_A, 2.5);
assert.equal(TPM_PHASE_HOURS, 16.8);
assert.equal(TPM_U_A, 0.5);
assert.equal(TPM_KSS_INTERCEPT, 9.68);
assert.equal(TPM_KSS_SLOPE, -0.46);
assert.equal(TPM_RESIDUAL_SD_KSS, 1.42);
assert.equal(TPM_BETWEEN_SUBJECT_INTERCEPT_SD_KSS, 0.84);

// B/C. Wake and original sleep equations reproduce direct calculations.
close(tpmWake(10, 6 * HOUR), 2.4 + (10 - 2.4) * Math.exp(-0.0353 * 6));
close(tpmOriginalSleep(8, 3 * HOUR), 14.3 - (14.3 - 8) * Math.exp(TPM_G_PER_HOUR * 3));

// D. The brake is continuous at b_t and uses each published branch.
const brake = tpmSleepBrake(8, 0);
const left = tpmSleepBrake(8, brake.brakeTimeHours * HOUR).value;
const right = tpmSleepBrake(8, (brake.brakeTimeHours + 1e-8) * HOUR).value;
close(left, right, 1e-7);
assert.equal(tpmSleepBrake(8, 0).branch, 'linear_brake');
assert.equal(tpmSleepBrake(8, 12 * HOUR).branch, 'exponential_sleep');

// E/F/G/H. Circadian, ultradian and KSS transfer are literal and unclamped.
close(tpmCircadian(16.8), 2.5);
close(tpmUltradian(19.8), 0);
close(tpmKssFromAlertness(8.38), 9.68 - 0.46 * 8.38);
assert.ok(tpmKssFromAlertness(-10) > 9, 'raw KSS must not be silently clamped');
assert.deepEqual(tpmKssRegion(5.5), {
  kind: 'between',
  lower: 5,
  upper: 6,
  description: 'between "neither alert nor sleepy" and "some signs of sleepiness"',
});
assert.equal(tpmKssRegion(0.5).kind, 'outside_nominal_range');
assert.equal(tpmKssRegion(9.5).kind, 'outside_nominal_range');

// I. One observed sleep remains CALIBRATING; two complete sleeps becomes LIVE.
const base = Date.parse('2026-09-01T21:00:00.000Z');
const state = createThreeProcessSleepiness(base, 'UTC');
observeThreeProcessSleepState(state, 'asleep', { now: base });
observeThreeProcessSleepState(state, 'awake', { now: base + 8 * HOUR });
assert.equal(threeProcessSleepinessSnapshot(state, base + 9 * HOUR).publicLabel, 'CALIBRATING');
observeThreeProcessSleepState(state, 'asleep', { now: base + 16 * HOUR });
observeThreeProcessSleepState(state, 'awake', { now: base + 24 * HOUR });
const live = threeProcessSleepinessSnapshot(state, base + 25 * HOUR);
assert.equal(live.publicLabel, 'LIVE');
assert.ok(Number.isFinite(live.predictedKss));
assert.equal(live.phaseBasis, 'POPULATION_DEFAULT_PHASE');
assert.ok(threeProcessSleepinessHistory(state).every((point) => Number.isFinite(point.predictedKss)),
  'history must contain calculated TPM predictions only');
assert.equal(state.historyBeganAtMs >= base + 24 * HOUR, true,
  'history must not begin before the calibration gate is satisfied');

// J. Deterministic replay gives the same current prediction.
const records = [
  [0, 'sleep_period'], [8, 'awake'], [16, 'sleep_period'], [24, 'awake'],
].map(([hours, sleep_period], index) => ({
  event_id: `sleep-${index}`,
  occurred_at_ms: base + hours * HOUR,
  soma_input: { sleep_period, sleep_interruption: 'none' },
}));
const replayed = createThreeProcessSleepiness(base, 'UTC');
replayObservedSleepRecords(replayed, records, { now: base + 25 * HOUR });
close(threeProcessSleepinessSnapshot(replayed, base + 25 * HOUR).predictedKss, live.predictedKss, 1e-9);

// K. An explicitly unknown interval removes the live output.
markThreeProcessContinuityUnknown(replayed, { now: base + 26 * HOUR });
assert.equal(threeProcessSleepinessSnapshot(replayed, base + 26 * HOUR).publicLabel, 'CALIBRATING');
assert.equal(threeProcessSleepinessSnapshot(replayed, base + 26 * HOUR).predictedKss, null);

// L. Persisted state reconciles without changing the model identity or estimate.
const restored = reconcileThreeProcessSleepiness(JSON.parse(JSON.stringify(state)), { now: base + 25 * HOUR, timeZone: 'UTC' });
close(threeProcessSleepinessSnapshot(restored, base + 25 * HOUR).predictedKss, live.predictedKss, 1e-9);

// M. The public row is KSS-scaled and legacy Fatigue is absent from primary UI.
const uiSource = readFileSync(new URL('../public/assets/brain.js', import.meta.url), 'utf8');
assert.match(uiSource, /PREDICTED KSS \(1-9\)/);
assert.match(uiSource, /buildScaledHistoryPath\(data\.points, 1, 9\)/);
assert.match(uiSource, /value\.toFixed\(1\).*\/ 9/);
assert.match(uiSource, /outside nominal KSS range/i);
assert.doesNotMatch(uiSource, /\{ key: 'fatigue', label: 'FATIGUE' \}/);

// N. A live estimate reaches prose as labelled model output, without a feeling claim.
const soma = reconcileSoma(null, { now: base });
replaySomaObservedSleepRecords(soma, records, { now: base + 25 * HOUR });
const prompt = groundedSomaDirective(soma, { now: base + 25 * HOUR }).directive;
assert.match(prompt, /predicted KSS/i);
assert.match(prompt, /MODEL ESTIMATE/);
assert.doesNotMatch(prompt, /Cy (?:is|feels) (?:tired|exhausted|sleepy)/i);

// G/H. Legacy fatigue and the separate Borbely Process S/C displays cannot alter TPM KSS.
const beforeIsolation = threeProcessSleepinessSnapshot(soma.predictedSleepiness, base + 25 * HOUR).predictedKss;
soma.experienced.metrics.fatigue.value = 100;
soma.sleepHomeostasis.sEstimate = 0;
soma.sleepHomeostasis.sMin = 0;
soma.sleepHomeostasis.sMax = 0;
soma.circadianProcessC.processCEstimate = -999;
soma.circadianProcessC.processCMin = -999;
soma.circadianProcessC.processCMax = -999;
close(threeProcessSleepinessSnapshot(soma.predictedSleepiness, base + 25 * HOUR).predictedKss,
  beforeIsolation, 1e-9);

// O. Legacy fatigue cannot alter drives, interoception or mirrored live vitals.
tickSoma(soma, { now: base + 25 * HOUR, physical: {}, asleep: false });
assert.equal(soma.drives.rest, 0);
assert.ok(soma.circuits.interoception < 1);
const runSource = readFileSync(new URL('./run.js', import.meta.url), 'utf8');
assert.doesNotMatch(runSource, /vitals\.physical\.fatigue\s*=\s*experienced\.fatigue/);

// O. Sleepiness does not promote any additional brain analogy to LIVE.
const registry = JSON.parse(readFileSync(new URL('../config/implementation-registry.json', import.meta.url), 'utf8'));
assert.equal(registry.soma_variables.find((entry) => entry.id === 'sleepiness').display_name, 'SLEEPINESS');
assert.equal(registry.soma_subsystems.find((entry) => entry.id === 'predicted_sleepiness_tpm').display_name,
  'PREDICTED SLEEPINESS');
const liveBrainIds = registry.brain_regions
  .filter((entry) => entry.implementation_status === 'IMPLEMENTED')
  .map((entry) => entry.id);
assert.deepEqual(liveBrainIds, ['scnCircadian']);
assert.ok(registry.brain_regions.every((entry) => !(entry.data_dependencies || []).includes('sleepiness')));

console.log('three-process-sleepiness.test.js: all checks passed');
