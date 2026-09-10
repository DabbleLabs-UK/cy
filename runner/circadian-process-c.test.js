import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CBTMIN_EARLIEST_BEFORE_WAKE_HOURS,
  CBTMIN_LATEST_BEFORE_WAKE_HOURS,
  HOUR_MS,
  PROCESS_C_EXTREMA,
  PROCESS_C_HARMONICS,
  PROCESS_C_MINIMUM_OFFSET_HOURS,
  PROCESS_C_PERIOD_HOURS,
  circadianProcessCSnapshot,
  createCircadianProcessC,
  deriveSchedulePhase,
  processC,
  processCDerivative,
  processCRangeAcrossPhase,
  reconcileCircadianProcessC,
  tickCircadianProcessC,
} from './circadian-process-c.js';
import { PRISON_SCHEDULE, habitualWakeMinutes } from './environment.js';
import { implementationEntry } from './implementation-registry.js';

const near = (actual, expected, tolerance = 1e-12, message = '') => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message} ${actual} != ${expected}`);
};
const here = dirname(fileURLToPath(import.meta.url));
const wakeMinutes = habitualWakeMinutes(PRISON_SCHEDULE);
const modelSpec = JSON.parse(await readFile(
  join(here, '..', 'config', 'model-specs', 'circadian-process-c.json'),
  'utf8',
));
assert.equal(modelSpec.id, 'borbely-achermann-process-c-five-harmonic');
assert.equal(modelSpec.formula, 'C(T, phi) = sum(k=1..5, a_k * sin(2*pi*k*(T-phi)/24))');
assert.equal(modelSpec.parameters.period_hours.value, PROCESS_C_PERIOD_HOURS);
assert.deepEqual(
  modelSpec.parameters.harmonic_coefficients.map((entry) => entry.value),
  PROCESS_C_HARMONICS,
  'the implementation and locked model specification must not drift',
);
near(
  modelSpec.phase.alignment.derived_waveform_minimum_offset_hours_after_phi,
  PROCESS_C_MINIMUM_OFFSET_HOURS,
  1e-14,
  'locked derived minimum offset',
);
near(
  modelSpec.phase.alignment.derived_waveform_minimum_value,
  PROCESS_C_EXTREMA.minimum.value,
  1e-14,
  'locked derived minimum value',
);
near(
  modelSpec.phase.alignment.derived_waveform_maximum_offset_hours_after_phi,
  PROCESS_C_EXTREMA.maximum.offsetHours,
  1e-14,
  'locked derived maximum offset',
);
near(
  modelSpec.phase.alignment.derived_waveform_maximum_value,
  PROCESS_C_EXTREMA.maximum.value,
  1e-14,
  'locked derived maximum value',
);

// A. EQUATION: independently expand the five published terms at a known point.
const t = 13.25;
const phi = 7.5;
const basePhase = 2 * Math.PI * (t - phi) / 24;
const expanded = 0.97 * Math.sin(basePhase)
  + 0.22 * Math.sin(2 * basePhase)
  + 0.07 * Math.sin(3 * basePhase)
  + 0.03 * Math.sin(4 * basePhase)
  + 0.001 * Math.sin(5 * basePhase);
near(processC(t, phi), expanded, 1e-15, 'published equation');

// B. PERIODICITY.
for (const clockHour of [-8.3, 0, 6.5, 17.25, 31.1]) {
  near(processC(clockHour, phi), processC(clockHour + PROCESS_C_PERIOD_HOURS, phi), 1e-12, '24-hour periodicity');
}

// C. HARMONICS.
assert.deepEqual(PROCESS_C_HARMONICS, [0.97, 0.22, 0.07, 0.03, 0.001]);

// D. EXTREMUM / PHASE ALIGNMENT. The minimum is derived from the waveform,
// then the phi interval places that minimum exactly over the CBTmin interval.
near(processCDerivative(PROCESS_C_MINIMUM_OFFSET_HOURS, 0), 0, 1e-12, 'minimum derivative');
assert.equal(PROCESS_C_EXTREMA.minimum.value, Math.min(
  ...PROCESS_C_EXTREMA.stationaryPoints.map((offset) => processC(offset, 0)),
));
const phase = deriveSchedulePhase(wakeMinutes);
near(phase.wakeHour, 6.5);
near(phase.cbtmin.startHour, 3.5);
near(phase.cbtmin.endHour, 4.5);
near(processC(phase.cbtmin.startHour, phase.phi.startHour), PROCESS_C_EXTREMA.minimum.value, 1e-12);
near(processC(phase.cbtmin.endHour, phase.phi.endHour), PROCESS_C_EXTREMA.minimum.value, 1e-12);

// E. CIRCULAR PHASE: an early habitual wake creates a CBTmin interval that
// crosses midnight without losing its one-hour duration or midpoint.
const midnight = deriveSchedulePhase(2 * 60);
assert.equal(midnight.cbtmin.wrapsMidnight, true);
near(midnight.cbtmin.startHour, 23);
near(midnight.cbtmin.endHour, 0);
near(midnight.cbtmin.durationHours, CBTMIN_EARLIEST_BEFORE_WAKE_HOURS - CBTMIN_LATEST_BEFORE_WAKE_HOURS);
near(midnight.cbtmin.midpointHour, 23.5);

// F. PHASE UNCERTAINTY: the analytical endpoint/stationary-point range bounds
// a dense independent sampling of every phase in the allowed interval.
for (let clockHour = 0; clockHour < 24; clockHour += 0.25) {
  const range = processCRangeAcrossPhase(clockHour, phase.phi);
  for (let index = 0; index <= 1000; index++) {
    const sampledPhi = phase.phi.startHour + phase.phi.durationHours * index / 1000;
    const value = processC(clockHour, sampledPhi);
    assert.ok(value >= range.minimum - 1e-12 && value <= range.maximum + 1e-12);
  }
}

const t0 = Date.parse('2026-09-10T00:00:00Z');
const state = createCircadianProcessC({ now: t0, habitualWakeMinutes: wakeMinutes, timeZone: 'Europe/London' });
const initialPhi = JSON.parse(JSON.stringify(state.phiInterval));

// G. HABITUAL SCHEDULE: an incidental observed wake field is deliberately not
// consumed and cannot reset the configured habitual phase anchor.
tickCircadianProcessC(state, {
  now: t0 + HOUR_MS,
  habitualWakeMinutes: wakeMinutes,
  timeZone: 'Europe/London',
  observedWakeMinutes: 3 * 60,
});
assert.deepEqual(state.phiInterval, initialPhi);

// H. RUNNER DOWNTIME: reconciliation jumps to the current clock evaluation;
// it does not preserve the previous output as if the oscillator had stopped.
const persisted = JSON.parse(JSON.stringify(state));
const restartAt = t0 + 9 * HOUR_MS;
const restarted = reconcileCircadianProcessC(persisted, {
  now: restartAt,
  habitualWakeMinutes: wakeMinutes,
  timeZone: 'Europe/London',
});
near(restarted.processCEstimate, processC(restarted.clockHours, restarted.phiInterval.midpointHour), 1e-12);
assert.notEqual(restarted.processCEstimate, persisted.processCEstimate);

// I. HISTORY: one reconstructed day closes the period and includes both the
// published waveform maximum and minimum to graphing resolution.
const day = Array.from({ length: 145 }, (_, index) => processC(index / 6, phase.phi.midpointHour));
near(day[0], day.at(-1), 1e-12);
assert.ok(Math.max(...day) > 1.0);
assert.ok(Math.min(...day) < -1.0);

// J. STATUS.
const snapshot = circadianProcessCSnapshot(restarted);
assert.equal(snapshot.publicLabel, 'LIVE');
assert.equal(snapshot.phaseBasis, 'habitual_schedule_estimate');
assert.equal(snapshot.directBiologicalPhaseObserved, false);
assert.equal(snapshot.entrainment.publicLabel, 'NOT MODELLED');
assert.equal(snapshot.freeRunningPhaseDrift.publicLabel, 'NOT MODELLED');
assert.equal(implementationEntry('soma_subsystems', 'circadian_process_c').implementation_status, 'IMPLEMENTED');
assert.equal(implementationEntry('soma_subsystems', 'circadian_entrainment').implementation_status, 'NOT_IMPLEMENTED');
assert.equal(implementationEntry('soma_variables', 'fatigue').implementation_status, 'PROVISIONAL');

// K. BRAIN: only the specific SCN phase analogy is live; the generic
// hypothalamic homeostasis analogy remains unimplemented and has no activation.
assert.equal(implementationEntry('brain_regions', 'scnCircadian').implementation_status, 'IMPLEMENTED');
assert.equal(implementationEntry('brain_regions', 'hypothalamic').implementation_status, 'NOT_IMPLEMENTED');
assert.equal(snapshot.scnAnalogy.displayMode, 'circadian_phase');
assert.match(snapshot.scnAnalogy.statement, /not SCN firing or biological measurement/i);
const brainSource = await readFile(join(here, '..', 'public', 'assets', 'brain.js'), 'utf8');
assert.match(brainSource, /This is not SCN activation/);
assert.doesNotMatch(brainSource, /SCN activation =|SCN firing =/);

console.log('circadian-process-c.test.js: all checks passed');
