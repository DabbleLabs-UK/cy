import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSomaRuntime } from './soma-runtime.js';
import {
  GROUNDED_ENVIRONMENT_TRANSITION_ORDER,
  observeEnvironmentRecord,
} from './grounded-environment-transition.js';
import { GOLDEN_SOMA_REPLAY_FIXTURES, goldenFixture } from './soma-replay-fixtures.js';
import { runSomaReplay, fullDayWindowMs, DEFAULT_REPLAY_SAMPLE_INTERVAL_MS } from './soma-replay.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

const calls = [];
const fakeTarget = Object.fromEntries([
  ['observeFeedingRecord', 'feeding'],
  ['observeSomaticRecord', 'somatic_nociceptive'],
  ['observeSocialContactRecord', 'social_contact'],
  ['observeControllabilityRecord', 'action_outcome_contingency'],
  ['observeCurrentDefensiveContextRecord', 'current_defensive_context'],
  ['observeThreatLearningRecord', 'threat_learning'],
].map(([method, result]) => [method, () => { calls.push(result); return result; }]));
const fakeResults = observeEnvironmentRecord(fakeTarget, { schema: 'cy.environment-record' });
assert.deepEqual(calls, GROUNDED_ENVIRONMENT_TRANSITION_ORDER,
  'shared transition seam preserves the established grounded mutation order');
assert.deepEqual(Object.keys(fakeResults), GROUNDED_ENVIRONMENT_TRANSITION_ORDER);

const runSource = readFileSync(new URL('./run.js', import.meta.url), 'utf8');
const liveCallOrder = [
  'soma.observeFeedingRecord(record)',
  'soma.observeSomaticRecord(record)',
  'soma.observeSocialContactRecord(record)',
  'soma.observeControllabilityRecord(record)',
  'soma.observeCurrentDefensiveContextRecord(record)',
  'soma.observeThreatLearningRecord(record)',
];
const liveCallIndexes = liveCallOrder.map((needle) => runSource.indexOf(needle));
assert.ok(liveCallIndexes.every((index) => index >= 0),
  'LIVE ingestion calls every grounded observer the transition seam defines');
assert.ok(liveCallIndexes.every((index, position) => position === 0 || index > liveCallIndexes[position - 1]),
  'LIVE ingestion applies the grounded observers in the same order as the shared transition seam');
const replaySource = readFileSync(new URL('./soma-replay.js', import.meta.url), 'utf8');
assert.match(replaySource, /observeEnvironmentRecord\(target, item\.record\)/,
  'REPLAY is wired through the same transition seam');
assert.doesNotMatch(replaySource, /Date\.now\s*\(/,
  'replay source contains no wall-clock read');

const quiet = goldenFixture('quiet-routine-baseline');
const first = runSomaReplay(quiet);
const second = runSomaReplay(quiet);
assert.equal(first.checksum, second.checksum, 'identical replay has an identical checksum');
assert.deepEqual(first, second, 'identical replay has an identical report');
assert.equal(first.finalSnapshot.anxiety.status, 'QUIET');
assert.equal(first.finalSnapshot.defensiveContexts.some((item) => item.active), false,
  'quiet baseline fabricates no active threat');

const recordsBefore = JSON.stringify(quiet.records);
const recovery = goldenFixture('recovery-after-stress');
const initialBefore = JSON.stringify(recovery.initialState);
runSomaReplay(quiet);
runSomaReplay(recovery);
assert.equal(JSON.stringify(quiet.records), recordsBefore, 'replay does not mutate caller event records');
assert.equal(JSON.stringify(recovery.initialState), initialBefore, 'replay does not mutate caller checkpoint');

const liveRuntime = createSomaRuntime(null, { now: quiet.startMs });
for (const item of quiet.records) observeEnvironmentRecord(liveRuntime, clone(item.record));
const directRuntime = createSomaRuntime(null, { now: quiet.startMs });
for (const item of quiet.records) {
  const value = clone(item.record);
  directRuntime.observeFeedingRecord(value);
  directRuntime.observeSomaticRecord(value);
  directRuntime.observeSocialContactRecord(value);
  directRuntime.observeControllabilityRecord(value);
  directRuntime.observeCurrentDefensiveContextRecord(value);
  directRuntime.observeThreatLearningRecord(value);
}
assert.deepEqual(liveRuntime.state, directRuntime.state,
  'shared seam is behaviorally identical to the previous direct production sequence');
assert.deepEqual(liveRuntime.state.threatLearning, first.finalState.threatLearning);
assert.deepEqual(liveRuntime.state.currentDefensiveContext, first.finalState.currentDefensiveContext);
assert.deepEqual(liveRuntime.state.learnedControllability, first.finalState.learnedControllability,
  'LIVE runtime and replay reach the same Anxiety-related grounded state');

const lockdown = runSomaReplay(goldenFixture('prolonged-uncertain-lockdown'));
assert.equal(lockdown.transitions[0].after.anxiety.status, 'THREAT_ONGOING');
assert.equal(lockdown.transitions[0].after.defensiveContexts.some((item) => item.active), true);
assert.equal(lockdown.transitions[1].after.anxiety.status, 'QUIET');
assert.equal(lockdown.transitions[1].after.defensiveContexts.some((item) => item.active), false,
  'resolution closes rather than pins an ongoing context');

const search = runSomaReplay(goldenFixture('hostile-search-confiscation'));
assert.equal(search.transitions[0].after.anxiety.status, 'THREAT_IMMINENT');
assert.equal(search.finalSnapshot.anxiety.status, 'QUIET');
assert.ok(search.finalSnapshot.threatLearning.some((item) => item.resolvedObservations > 0),
  'resolved search remains in threat-learning history');
assert.ok(search.finalSnapshot.controllability.length > 0,
  'resolved search records action-outcome evidence');

const supportive = runSomaReplay(goldenFixture('supportive-social-contact'));
assert.ok(supportive.trajectory.every((item) => item.snapshot.anxiety.status === 'QUIET'),
  'supportive social salience is not classified as current threat');

const mixed = runSomaReplay(goldenFixture('mixed-chaotic-day'));
assert.deepEqual(mixed.orderedEventIds.slice(-2), ['mixed-lockdown-onset', 'mixed-lockdown-resolution'],
  'explicit sequence provides stable same-timestamp ordering');
assert.deepEqual(mixed.transitions.slice(-2).map((item) => item.after.anxiety.status),
  ['THREAT_ONGOING', 'QUIET']);

const recovered = runSomaReplay(recovery);
assert.equal(recovered.trajectory[0].snapshot.anxiety.status, 'THREAT_ONGOING',
  'recovery starts from the inherited active context');
assert.equal(recovered.finalSnapshot.anxiety.status, 'QUIET');
assert.ok(recovered.finalSnapshot.threatLearning.some((item) => item.resolvedObservations > 0),
  'historical learned evidence remains after current threat resolves');

const gapReport = runSomaReplay({
  ...quiet,
  coverage: [
    { fromMs: quiet.startMs, toMs: quiet.startMs + 1000, status: 'OBSERVED', reason: 'observed' },
    { fromMs: quiet.startMs + 1000, toMs: quiet.endMs, status: 'UNKNOWN', reason: 'test gap' },
  ],
});
assert.equal(gapReport.classification, 'COUNTERFACTUAL');
assert.ok(gapReport.coverage.some((item) => item.status === 'UNKNOWN'));
assert.ok(gapReport.diagnostics.some((item) => item.code === 'OBSERVATION_GAP_PRESERVED'));

// The replay module's own source never reads the wall clock or the network;
// verified at the source level rather than by stubbing Date.now globally,
// because reconcileSoma's transitive blank-state construction (sleep
// homeostasis / circadian Process C / three-process sleepiness defaults)
// contains pre-existing `finite(now, Date.now())`-style eager fallback
// evaluation that reads Date.now() as a side effect even when a valid `now`
// is supplied. That eagerness never changes any stored value (the valid
// `now` always wins), so replay determinism is unaffected, but it is a
// production-code quirk out of scope to fix from this workbench task -
// flagged separately rather than patched here.
for (const path of ['./soma-replay.js', './grounded-environment-transition.js', './soma-replay-fixtures.js']) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Date\.now\s*\(/, `${path} contains no wall-clock read`);
  assert.doesNotMatch(source, /\bfetch\s*\(/, `${path} contains no network access`);
}
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = () => { throw new Error('replay attempted network access'); };
  assert.equal(runSomaReplay(quiet).finalSnapshot.anxiety.status, 'QUIET');
} finally {
  globalThis.fetch = originalFetch;
}

assert.equal(GOLDEN_SOMA_REPLAY_FIXTURES.length, 6);
for (const fixture of GOLDEN_SOMA_REPLAY_FIXTURES) {
  const report = runSomaReplay(fixture);
  assert.equal(report.orderedEventIds.length, fixture.records.length, `${fixture.id} applies every event`);
  assert.equal(report.diagnostics.length, 0, `${fixture.id} has no replay diagnostics`);
  assert.equal(report.invariantFailures.length, 0, `${fixture.id} has no invariant failures`);
}

// Deterministic optional time sampling (workbench visual timeline support).
// Disabled by default: omitting sampleIntervalMs must reproduce the exact
// pre-sampling trajectory shape used by every assertion above.
const unsampled = runSomaReplay(quiet);
assert.equal(unsampled.sampling, null, 'sampling is off by default');
assert.ok(unsampled.trajectory.every((point) => point.kind !== 'SAMPLE'),
  'no SAMPLE nodes appear unless sampling is requested');

const sampledOnce = runSomaReplay({ ...quiet, sampleIntervalMs: true });
const sampledTwice = runSomaReplay({ ...quiet, sampleIntervalMs: true });
assert.equal(sampledOnce.checksum, sampledTwice.checksum, 'time sampling is deterministic across repeat runs');
assert.deepEqual(sampledOnce, sampledTwice, 'time sampling produces an identical report on repeat runs');
assert.equal(sampledOnce.sampling.intervalMs, DEFAULT_REPLAY_SAMPLE_INTERVAL_MS,
  'sampleIntervalMs: true resolves to the documented default interval');

const explicitInterval = 5 * 60 * 1000;
const sampledExplicit = runSomaReplay({ ...quiet, sampleIntervalMs: explicitInterval });
assert.equal(sampledExplicit.sampling.intervalMs, explicitInterval);
const sampleNodes = sampledExplicit.trajectory.filter((point) => point.kind === 'SAMPLE');
assert.ok(sampleNodes.length > 0, 'quiet baseline produces sample nodes across its long quiet stretches');
for (let index = 1; index < sampleNodes.length; index += 1) {
  assert.ok(sampleNodes[index].timestampMs > sampleNodes[index - 1].timestampMs,
    'sample timestamps are strictly increasing');
}
assert.ok(sampledExplicit.trajectory.every((point, index, all) => index === 0
  || point.timestampMs >= all[index - 1].timestampMs),
  'sample nodes interleave with events in strict chronological order');
assert.ok(sampleNodes.every((point) => !unsampled.trajectory.some((other) => other.timestampMs === point.timestampMs
  && other.kind === 'EVENT')), 'a time sample never lands exactly on an event timestamp (no fabricated duplicate)');
assert.equal(sampleNodes.length, sampledExplicit.sampling.sampleCount,
  'reported sampleCount matches the actual number of SAMPLE nodes');
assert.ok(sampleNodes.every((point) => point.snapshot.anxiety.status === 'QUIET'),
  'time samples read existing state only; the quiet baseline never fabricates a threat between events');

// A sample point must reflect exactly the same categorical state as the
// preceding event's "after" snapshot (current-defensive-context performs no
// interpolation between events), proving samples are pure reads, not a new
// psychological model.
const lockdownSampled = runSomaReplay({
  ...goldenFixture('prolonged-uncertain-lockdown'), sampleIntervalMs: 15 * 60 * 1000,
});
const onsetTransition = lockdownSampled.transitions.find((item) => item.sourceEventId === 'lockdown-onset');
const midSample = lockdownSampled.trajectory.find((point) => point.kind === 'SAMPLE'
  && point.timestampMs > onsetTransition.timestampMs && point.timestampMs < lockdownSampled.transitions
    .find((item) => item.sourceEventId === 'lockdown-resolution').timestampMs);
assert.ok(midSample, 'a sample point exists inside the unresolved lockdown window');
assert.deepEqual(midSample.snapshot, onsetTransition.after,
  'a mid-lockdown time sample exactly reproduces the last resolved event snapshot (no fabricated dynamics)');

// UNKNOWN observation gaps remain explicit on sampled points, not silently
// treated as continuously-observed state.
const gapSampled = runSomaReplay({
  ...quiet,
  sampleIntervalMs: 60 * 60 * 1000,
  coverage: [
    { fromMs: quiet.startMs, toMs: quiet.startMs + 3 * 60 * 60 * 1000, status: 'OBSERVED', reason: 'observed morning' },
    { fromMs: quiet.startMs + 3 * 60 * 60 * 1000, toMs: quiet.endMs, status: 'UNKNOWN', reason: 'no observation after mid-morning' },
  ],
});
const gapSamples = gapSampled.trajectory.filter((point) => point.kind === 'SAMPLE');
assert.ok(gapSamples.some((point) => point.coverageStatus === 'OBSERVED'));
assert.ok(gapSamples.some((point) => point.coverageStatus === 'UNKNOWN'),
  'a sample falling inside an observation gap is marked UNKNOWN, not silently OBSERVED');

// --- FULL DAY view (workbench plot-window widening) ------------------------
// The workbench's FULL DAY control widens ONLY the plotted interval to a whole
// 00:00-24:00 UTC day, reusing this same deterministic replay + sampling
// machinery. It must not change any per-event snapshot - only add baseline
// time samples before the first event and after the last.

const DAY_MS = 24 * 60 * 60 * 1000;

// fullDayWindowMs floors/ceils to UTC midnight and always contains the fixture
// window and all event timestamps.
for (const fixture of GOLDEN_SOMA_REPLAY_FIXTURES) {
  const window = fullDayWindowMs(fixture);
  assert.equal(window.startMs % DAY_MS, 0, `${fixture.id}: full-day start is a UTC midnight`);
  assert.equal(window.endMs % DAY_MS, 0, `${fixture.id}: full-day end is a UTC midnight`);
  assert.equal(window.endMs - window.startMs, DAY_MS, `${fixture.id}: golden fixtures span exactly one day`);
  assert.ok(window.startMs <= fixture.startMs && window.endMs >= fixture.endMs,
    `${fixture.id}: full-day window contains the fixture's own window`);
  for (const entry of fixture.records) {
    const t = Date.parse(entry.record.world_event.timestamp);
    assert.ok(t >= window.startMs && t <= window.endMs,
      `${fixture.id}: every real event timestamp lies inside the full-day window`);
  }
}

// A degenerate fixture whose window and events all sit at one instant still
// yields a full, non-empty day (never a zero-width interval).
const instant = Date.parse('2026-09-16T09:00:00Z');
const degenerate = fullDayWindowMs({ startMs: instant, endMs: instant, records: [] });
assert.equal(degenerate.endMs - degenerate.startMs, DAY_MS, 'a single-instant fixture still widens to a full day');

// The core guarantee: widening the window changes NO per-event snapshot; it
// only adds baseline samples. Checked across every golden fixture, comparing
// each event's before/after snapshot between EVENT WINDOW and FULL DAY at the
// same sampling density.
for (const fixture of GOLDEN_SOMA_REPLAY_FIXTURES) {
  const sampleIntervalMs = 15 * 60 * 1000;
  const eventWindow = runSomaReplay({ ...fixture, sampleIntervalMs });
  const window = fullDayWindowMs(fixture);
  const fullDay = runSomaReplay({ ...fixture, startMs: window.startMs, endMs: window.endMs, sampleIntervalMs });

  assert.deepEqual(fullDay.orderedEventIds, eventWindow.orderedEventIds,
    `${fixture.id}: FULL DAY applies exactly the same events in the same order`);
  assert.equal(fullDay.classification, eventWindow.classification,
    `${fixture.id}: widening the window does not change the replay classification`);
  assert.equal(fullDay.diagnostics.length, 0, `${fixture.id}: FULL DAY has no replay diagnostics`);
  assert.equal(fullDay.invariantFailures.length, 0, `${fixture.id}: FULL DAY has no invariant failures`);

  const eventAfterById = Object.fromEntries(eventWindow.transitions.map((t) => [t.sourceEventId, JSON.stringify(t.after)]));
  const eventBeforeById = Object.fromEntries(eventWindow.transitions.map((t) => [t.sourceEventId, JSON.stringify(t.before)]));
  for (const transition of fullDay.transitions) {
    assert.equal(JSON.stringify(transition.after), eventAfterById[transition.sourceEventId],
      `${fixture.id}: FULL DAY event ${transition.sourceEventId} "after" snapshot is byte-identical to EVENT WINDOW`);
    assert.equal(JSON.stringify(transition.before), eventBeforeById[transition.sourceEventId],
      `${fixture.id}: FULL DAY event ${transition.sourceEventId} "before" snapshot is byte-identical to EVENT WINDOW`);
    assert.equal(transition.timestampMs, eventWindow.transitions
      .find((t) => t.sourceEventId === transition.sourceEventId).timestampMs,
      `${fixture.id}: FULL DAY keeps the real event timestamp, unshifted`);
  }
  assert.deepEqual(fullDay.finalSnapshot, eventWindow.finalSnapshot,
    `${fixture.id}: the resolved end-of-day state matches the event-window final state`);

  // FULL DAY must actually show quiet/baseline periods both before the first
  // event and after the last, produced by the existing sampling machinery.
  const preSamples = fullDay.trajectory.filter((p) => p.kind === 'SAMPLE' && p.timestampMs < fixture.startMs);
  const postSamples = fullDay.trajectory.filter((p) => p.kind === 'SAMPLE' && p.timestampMs > fixture.endMs);
  assert.ok(preSamples.length > 0, `${fixture.id}: FULL DAY shows baseline samples before the fixture window`);
  assert.ok(postSamples.length > 0, `${fixture.id}: FULL DAY shows baseline samples after the fixture window`);
  assert.ok(fullDay.trajectory.length > eventWindow.trajectory.length,
    `${fixture.id}: FULL DAY only ADDS samples relative to EVENT WINDOW`);
}

// FULL DAY is still deterministic (same machinery), and candidate trajectories
// keep evolving through the post-event sampled tail rather than stopping at the
// last event: recovery-after-stress starts elevated and its later samples read
// the resolved QUIET state, exactly as the categorical semantics prescribe.
const recoveryWindow = fullDayWindowMs(recovery);
const recoveryFullA = runSomaReplay({ ...recovery, startMs: recoveryWindow.startMs, endMs: recoveryWindow.endMs, sampleIntervalMs: 15 * 60 * 1000 });
const recoveryFullB = runSomaReplay({ ...recovery, startMs: recoveryWindow.startMs, endMs: recoveryWindow.endMs, sampleIntervalMs: 15 * 60 * 1000 });
assert.equal(recoveryFullA.checksum, recoveryFullB.checksum, 'FULL DAY replay is deterministic across repeat runs');
assert.equal(recoveryFullA.trajectory[0].snapshot.anxiety.status, 'THREAT_ONGOING',
  'FULL DAY shows the inherited active context across the early-morning baseline before the resolution event');
assert.ok(recoveryFullA.trajectory.filter((p) => p.kind === 'SAMPLE' && p.timestampMs > recovery.endMs)
  .every((p) => p.snapshot.anxiety.status === 'QUIET'),
  'FULL DAY post-event samples continue reading the resolved (recovered) QUIET state');

console.log('soma-replay.test.js: all checks passed');
