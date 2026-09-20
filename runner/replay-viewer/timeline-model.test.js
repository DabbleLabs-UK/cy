// timeline-model.test.js - the DOM-free workbench layout/inspector helpers,
// run directly against the real deterministic replay harness so "graph
// points correspond to replay snapshots" and "inspector maps to the correct
// event/state" are checked against real data, not a mock.

import assert from 'node:assert/strict';
import { goldenFixture } from '../soma-replay-fixtures.js';
import { runSomaReplay } from '../soma-replay.js';
import {
  ROWS, rowIndex, findTransitionFor, precedingEventLabel, describeConcern, describeTransition, stepVertices,
  HOUR_MS, chooseTickStepMs, tickTimestamps,
} from './timeline-model.js';

assert.equal(rowIndex('THREAT_ONGOING'), 0);
assert.equal(rowIndex('QUIET'), ROWS.indexOf('QUIET'));
assert.equal(rowIndex('something-unrecognised'), ROWS.length - 1, 'unknown status falls back to the UNKNOWN row');

const timeFmt = (ms) => new Date(ms).toISOString().slice(11, 16);

// --- lockdown fixture: every graph point must correspond exactly to the
// replay snapshot at that instant (no fabrication, no drift). ---
const lockdown = runSomaReplay({
  ...goldenFixture('prolonged-uncertain-lockdown'), sampleIntervalMs: 15 * 60 * 1000,
});
for (const point of lockdown.trajectory) {
  assert.equal(rowIndex(point.snapshot.anxiety.status), ROWS.indexOf(point.snapshot.anxiety.status),
    'each trajectory point maps to exactly the row for its own reported status, not a derived one');
}

const onset = lockdown.transitions.find((t) => t.sourceEventId === 'lockdown-onset');
const resolution = lockdown.transitions.find((t) => t.sourceEventId === 'lockdown-resolution');
assert.ok(onset && resolution);

const onsetPoint = lockdown.trajectory.find((p) => p.kind === 'EVENT' && p.sourceEventId === 'lockdown-onset');
const foundTransition = findTransitionFor(lockdown, onsetPoint);
assert.equal(foundTransition, onset, 'the inspector looks up the exact transition object for a clicked EVENT point');
assert.equal(findTransitionFor(lockdown, lockdown.trajectory[0]), null, 'INITIAL points have no transition');

const midIndex = lockdown.trajectory.findIndex((p) => p.kind === 'SAMPLE'
  && p.timestampMs > onset.timestampMs && p.timestampMs < resolution.timestampMs);
assert.ok(midIndex >= 0, 'a sample point exists inside the unresolved window');
const label = precedingEventLabel(lockdown.trajectory, midIndex, timeFmt);
assert.match(label, /lockdown-onset|lockdown_started/, 'a mid-window sample attributes its state to the correct preceding event');

const midPoint = lockdown.trajectory[midIndex];
assert.deepEqual(midPoint.snapshot, onset.after,
  'the point the inspector would show for a mid-window sample is identical to the onset event snapshot (no interpolation)');

const concern = midPoint.snapshot.anxiety.currentConcern;
const reason = describeTransition(midPoint, onset.after.anxiety.status, midPoint.snapshot.anxiety.status, concern,
  label);
assert.match(reason, /COERCIVE_LOSS_OF_CONTROL/, 'the plain-English reason names the actual active outcome class');
assert.match(reason, /ONGOING/, 'the plain-English reason names the actual temporal status');
assert.doesNotMatch(reason, /\d+\.\d+|\d+%/, 'the plain-English reason contains no fabricated decimal score or percentage');

assert.equal(describeConcern(null), 'no active concern is recorded');
assert.equal(describeTransition({ kind: 'EVENT' }, 'QUIET', 'QUIET', null, 'n/a'),
  'Anxiety remains QUIET after this event, because no active concern is recorded.');
assert.equal(describeTransition({ kind: 'EVENT' }, 'THREAT_ONGOING', 'QUIET', null, 'n/a'),
  'Anxiety returned to QUIET because no defensive context remains active (the concern resolved or closed).');

// --- step-line vertices: pure layout, one-to-one with trajectory, no
// smoothing or fabricated intermediate state. ---
const search = runSomaReplay(goldenFixture('hostile-search-confiscation'));
const vertices = stepVertices(search.trajectory);
assert.equal(vertices.length, 1 + (search.trajectory.length - 1) * 2,
  'a step-after polyline has exactly one hold vertex and one jump vertex per subsequent point');
assert.equal(vertices[0].row, rowIndex(search.trajectory[0].snapshot.anxiety.status));
assert.equal(vertices.at(-1).row, rowIndex(search.trajectory.at(-1).snapshot.anxiety.status));
for (let i = 1; i < vertices.length; i += 1) {
  assert.ok(vertices[i].timestampMs >= vertices[i - 1].timestampMs, 'step vertices never move backwards in time');
}

// --- x-axis tick helpers: EVENT WINDOW keeps the original hourly ticks
// exactly; FULL DAY widens spacing so a 24h day stays readable. ---

// EVENT WINDOW (fullDay: false) always uses 1-hour ticks regardless of span.
assert.equal(chooseTickStepMs(2 * HOUR_MS, { fullDay: false }), HOUR_MS);
assert.equal(chooseTickStepMs(13 * HOUR_MS, { fullDay: false }), HOUR_MS);
assert.equal(chooseTickStepMs(24 * HOUR_MS), HOUR_MS, 'event-window is the default when no options are passed');

// FULL DAY never goes below 1 hour and keeps the label count sane (~12-13
// across a 24h span, not 24 crammed-together hourly labels).
const dayStep = chooseTickStepMs(24 * HOUR_MS, { fullDay: true });
assert.ok(dayStep >= HOUR_MS, 'full-day tick step is never finer than an hour');
assert.equal(dayStep, 2 * HOUR_MS, 'a 24h span targets ~12 labels -> 2-hour ticks');
const dayTicks = tickTimestamps(0, 24 * HOUR_MS, dayStep);
assert.ok(dayTicks.length <= 13, 'a full day produces a readable number of tick labels, not 24');

// tickTimestamps with the hourly step reproduces the viewer's ORIGINAL inline
// loop exactly (the behaviour EVENT WINDOW must preserve byte-for-byte).
const start = Date.parse('2026-09-16T07:00:00Z');
const end = Date.parse('2026-09-16T20:00:00Z');
const legacyHourly = [];
for (let t = Math.ceil(start / HOUR_MS) * HOUR_MS; t <= end; t += HOUR_MS) legacyHourly.push(t);
assert.deepEqual(tickTimestamps(start, end, HOUR_MS), legacyHourly,
  'tickTimestamps(HOUR_MS) matches the original hourly axis loop exactly');

// Ticks stay within the window and strictly increase.
assert.ok(tickTimestamps(start, end, HOUR_MS).every((t) => t >= start && t <= end));
for (let i = 1; i < dayTicks.length; i += 1) {
  assert.ok(dayTicks[i] > dayTicks[i - 1], 'tick timestamps strictly increase');
}
// A non-positive step is handled without looping forever.
assert.deepEqual(tickTimestamps(start, end, 0), []);

console.log('timeline-model.test.js: all checks passed');
