// candidate-threat-anticipation-load.test.js - replay-only candidate scalar.
//
// Verifies: drive extraction reads only existing grounded fields, the
// leaky-integrator closed form matches brute-force numerical integration,
// gradual (non-instant) post-threat recovery actually happens, determinism,
// boundedness, and that every non-grounded constant is labelled CALIBRATION.

import assert from 'node:assert/strict';
import { goldenFixture, GOLDEN_SOMA_REPLAY_FIXTURES } from './soma-replay-fixtures.js';
import { runSomaReplay } from './soma-replay.js';
import {
  computeDriveAtPoint, computeCandidateTrajectory, CALIBRATION_LEDGER, CANDIDATE_MODEL_STATUS,
} from './candidate-threat-anticipation-load.js';

// --- calibration ledger honesty -----------------------------------------
for (const [key, entry] of Object.entries(CALIBRATION_LEDGER)) {
  const classification = entry.classification;
  assert.ok(typeof classification === 'string' && classification.startsWith('CALIBRATION_ONLY'),
    `${key} is explicitly labelled CALIBRATION_ONLY, not presented as a grounded or published constant`);
  assert.ok(typeof entry.note === 'string' && entry.note.length > 20, `${key} carries a human-readable rationale`);
}
assert.match(CANDIDATE_MODEL_STATUS, /NOT_IMPLEMENTED_IN_PRODUCTION/);

// --- drive extraction is a pure read of existing grounded fields --------
assert.deepEqual(computeDriveAtPoint({ snapshot: { anxiety: { status: 'QUIET', currentConcern: null } } }),
  {
    drive: 0,
    components: {
      severity: 0, severityBasis: 'NO_ACTIVE_CONCERN', temporalStatus: 'NONE', imminenceWeight: 0,
      objectiveControllability: 'UNKNOWN', controlDiscount: 0, worldAmbiguity: 'UNKNOWN', ambiguityGain: 1.15,
      clamped: false,
    },
  }, 'no active concern produces exactly zero drive with no fabricated severity');

const noHistoryConcern = {
  temporalStatus: 'ONGOING', objectiveControllability: 'NONE', worldAmbiguity: 'CLEAR',
  learnedCueOutcomeEvidence: [{ evidence: { status: 'NO_RESOLVED_LEARNING_HISTORY' } }],
};
const noHistoryResult = computeDriveAtPoint({ snapshot: { anxiety: { currentConcern: noHistoryConcern } } });
assert.equal(noHistoryResult.components.severityBasis, 'CALIBRATION_UNLEARNED_PLACEHOLDER');
assert.equal(noHistoryResult.components.severity, CALIBRATION_LEDGER.unlearnedSeverityPlaceholder.value);

const learnedConcern = {
  temporalStatus: 'ONGOING', objectiveControllability: 'NONE', worldAmbiguity: 'CLEAR',
  learnedCueOutcomeEvidence: [
    { evidence: { status: 'LEARNED_HISTORY_AVAILABLE', posterior: { mean: 0.8 } } },
    { evidence: { status: 'LEARNED_HISTORY_AVAILABLE', posterior: { mean: 0.3 } } },
  ],
};
const learnedResult = computeDriveAtPoint({ snapshot: { anxiety: { currentConcern: learnedConcern } } });
assert.equal(learnedResult.components.severityBasis, 'GROUNDED_LEARNED_POSTERIOR');
assert.equal(learnedResult.components.severity, 0.8, 'severity takes the strongest learned association, not an average');
// ONGOING(1.0) * severity(0.8) * (1 - discount(NONE=0)) * ambiguity(CLEAR=1.0) = 0.8
assert.equal(learnedResult.drive, 0.8);

const controlledConcern = { ...learnedConcern, objectiveControllability: 'SUBSTANTIAL' };
const controlledResult = computeDriveAtPoint({ snapshot: { anxiety: { currentConcern: controlledConcern } } });
assert.ok(controlledResult.drive < learnedResult.drive, 'more objective control strictly lowers drive');

const ambiguousConcern = { ...learnedConcern, worldAmbiguity: 'AMBIGUOUS' };
const ambiguousResult = computeDriveAtPoint({ snapshot: { anxiety: { currentConcern: ambiguousConcern } } });
assert.ok(ambiguousResult.drive > learnedResult.drive, 'more ambiguity strictly raises drive');

const imminentConcern = { ...learnedConcern, temporalStatus: 'IMMINENT' };
const potentialConcern = { ...learnedConcern, temporalStatus: 'POTENTIAL' };
const imminentResult = computeDriveAtPoint({ snapshot: { anxiety: { currentConcern: imminentConcern } } });
const potentialResult = computeDriveAtPoint({ snapshot: { anxiety: { currentConcern: potentialConcern } } });
assert.ok(learnedResult.drive > imminentResult.drive && imminentResult.drive > potentialResult.drive,
  'drive strictly orders ONGOING > IMMINENT > POTENTIAL for identical severity/control/ambiguity');

// --- closed-form integration matches brute-force numerical integration --
function bruteForceLoad(load0, drive, hours, k, stepsPerHour = 6000) {
  const dt = 1 / stepsPerHour;
  let load = load0;
  for (let t = 0; t < hours; t += dt) {
    const dLdt = k.up * drive * (1 - load) - k.down * (1 - drive) * load;
    load += dLdt * dt;
  }
  return load;
}
const k = { up: CALIBRATION_LEDGER.kUpPerHour.value, down: CALIBRATION_LEDGER.kDownPerHour.value };
for (const drive of [0, 0.25, 0.6, 1]) {
  for (const hours of [0.1, 0.5, 2]) {
    const report = {
      trajectory: [
        { timestampMs: 0, snapshot: { anxiety: { currentConcern: null } } },
        { timestampMs: hours * 3600000, snapshot: { anxiety: { currentConcern: null } } },
      ],
    };
    // Force a known constant drive across the interval by monkey-patching via
    // a concern that produces exactly this drive (ONGOING, full severity,
    // no control, no ambiguity gain) - avoids reaching into module internals.
    if (drive > 0) {
      report.trajectory[0].snapshot.anxiety.currentConcern = {
        temporalStatus: 'ONGOING', objectiveControllability: 'NONE', worldAmbiguity: 'CLEAR',
        learnedCueOutcomeEvidence: [{ evidence: { status: 'LEARNED_HISTORY_AVAILABLE', posterior: { mean: drive } } }],
      };
    }
    const series = computeCandidateTrajectory(report, { initialLoad: 0 });
    const expected = bruteForceLoad(0, drive, hours, k);
    assert.ok(Math.abs(series[1].load - expected) < 0.002,
      `closed-form load (${series[1].load}) matches brute-force integration (${expected.toFixed(4)}) `
      + `for drive=${drive}, hours=${hours}`);
  }
}

// --- gradual post-threat recovery, not an instant snap to zero ----------
const search = runSomaReplay({
  ...goldenFixture('hostile-search-confiscation'),
  endMs: goldenFixture('hostile-search-confiscation').endMs + 90 * 60 * 1000, // extend window to see the tail
  sampleIntervalMs: 5 * 60 * 1000,
});
const searchCandidate = computeCandidateTrajectory(search);
const resolutionIndex = search.trajectory.findIndex((p) => p.sourceEventId === 'search-resolution');
assert.ok(resolutionIndex >= 0);
const atResolution = searchCandidate[resolutionIndex].load;
const shortlyAfter = searchCandidate[resolutionIndex + 1];
const muchLater = searchCandidate.at(-1);
assert.ok(atResolution > 0, 'the candidate load is elevated at the moment of resolution');
assert.ok(shortlyAfter.load < atResolution, 'load decreases after resolution');
assert.ok(shortlyAfter.load > atResolution * 0.5,
  'load does NOT snap to near-zero on the very next sample after resolution (gradual recovery, not an instant drop)');
assert.ok(muchLater.load < shortlyAfter.load, 'load continues decaying further out');
assert.ok(muchLater.load > 0, 'load has not yet reached exactly zero within a finite window (asymptotic recovery)');

// --- determinism, boundedness, and full fixture coverage -----------------
for (const fixture of GOLDEN_SOMA_REPLAY_FIXTURES) {
  const report = runSomaReplay({ ...fixture, sampleIntervalMs: 15 * 60 * 1000 });
  const first = computeCandidateTrajectory(report);
  const second = computeCandidateTrajectory(report);
  assert.deepEqual(first, second, `${fixture.id}: candidate trajectory is deterministic`);
  assert.equal(first.length, report.trajectory.length, `${fixture.id}: one candidate point per replay trajectory point`);
  for (const point of first) {
    assert.ok(point.load >= 0 && point.load <= 1, `${fixture.id}: load stays within [0,1]`);
    assert.ok(point.drive >= 0 && point.drive <= 1, `${fixture.id}: drive stays within [0,1]`);
  }
  for (let i = 1; i < first.length; i += 1) {
    assert.ok(first[i].timestampMs >= first[i - 1].timestampMs, `${fixture.id}: candidate series stays chronological`);
  }
}

// The quiet baseline never has an active concern, so load must stay at the floor throughout.
const quietCandidate = computeCandidateTrajectory(runSomaReplay(goldenFixture('quiet-routine-baseline')));
assert.ok(quietCandidate.every((point) => point.load === 0), 'quiet baseline never accrues candidate load');

console.log('candidate-threat-anticipation-load.test.js: all checks passed');
