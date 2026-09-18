// candidate-threat-anticipation-load.js - REPLAY-ONLY CANDIDATE scalar model.
//
// STATUS: candidate for replay experimentation only. NOT implemented in
// production Soma, NOT wired into live Cy, NOT a validated psychological
// model. It is a pure post-process over an already-computed
// cy.soma-replay-report (see soma-replay.js): it mutates no Soma state, adds
// no new grounded input, and never runs unless the workbench explicitly asks
// for it.
//
// WHAT IT COMPUTES: a single scalar "threat-anticipation load" L in [0,1] per
// the design in docs/anxiety-v2-design.md (Option 1: grounded leaky
// integrator). L is NOT felt anxiety, NOT a clinical anxiety rating, and NOT
// a biological measurement - see CONSTRUCT_SCOPE below.
//
// HONESTY LEDGER: every number this module uses is classified GROUNDED
// (read unmodified from the existing threat-learning/defensive-context
// state already computed by the CURRENT replay algorithm) or CALIBRATION
// (chosen only for face-validity on the six golden days; not published, not
// fitted to any dataset, and must never be presented as a scientific
// constant). There are no ARBITRARY (category C) constants: nothing here is
// a fabricated per-event delta or an invented "+X anxiety" score. See
// CALIBRATION_LEDGER for the exhaustive list of every non-grounded number.

export const CANDIDATE_MODEL_ID = 'candidate-threat-anticipation-load-v1';
export const CANDIDATE_MODEL_STATUS = 'REPLAY_ONLY_CANDIDATE_NOT_IMPLEMENTED_IN_PRODUCTION';
export const CONSTRUCT_SCOPE = 'A bounded latent index of grounded threat-anticipation load implied by Cy\'s '
  + 'own learned adverse-outcome expectations, their imminence, their uncertainty and their (un)controllability. '
  + 'It does NOT claim to be felt anxiety, a predicted human state-anxiety rating, or a biological measurement.';

// ---- Calibration ledger -----------------------------------------------
// Every entry here is CALIBRATION_ONLY: chosen for illustrative face
// validity against the six golden fixtures, not derived from literature or
// fitted to data. Direction (not magnitude) for controllability and
// ambiguity terms is literature-motivated - see docs/anxiety-v2-design.md
// Part C for the primary sources (Tzovara 2018 for the underlying learner,
// which IS grounded; Maier & Seligman 2016 / Maier & Watkins 2010 for
// controllability direction; Grupe & Nitschke 2013 for uncertainty
// direction). None of those sources supply these specific magnitudes.
export const CALIBRATION_LEDGER = Object.freeze({
  unlearnedSeverityPlaceholder: {
    value: 0.5,
    classification: 'CALIBRATION_ONLY',
    note: 'Severity used only when the active concern has zero resolved learning history. Chosen as the '
      + 'midpoint of [0,1] purely so a first-ever threat is visible at all; it is NOT the Beta(1,1) prior '
      + 'displayed as a learned probability (that display is deliberately suppressed elsewhere in this codebase '
      + '- see operational-anxiety-state.js "NO_RESOLVED_LEARNING_HISTORY"). Repeated occurrences of the same '
      + 'cue immediately replace this placeholder with the real grounded posterior mean.',
  },
  imminenceWeight: {
    POTENTIAL: 0.35, UNKNOWN: 0.35, IMMINENT: 0.75, ONGOING: 1.0,
    classification: 'CALIBRATION_ONLY',
    note: 'Ordinal weights chosen only to preserve the existing categorical severity ordering '
      + '(POTENTIAL/UNKNOWN < IMMINENT < ONGOING). Not derived from a published hazard function; the '
      + 'Bach-lab hazard-rate formula (docs/anxiety-v2-design.md Part C.3) would replace this if the '
      + 'environment schema ever carried an expected event-time window, which it currently does not.',
  },
  controlDiscount: {
    NONE: 0, LIMITED: 0.15, SUBSTANTIAL: 0.45, UNKNOWN: 0,
    classification: 'CALIBRATION_ONLY',
    note: 'Direction (more controllability -> lower load) is literature-motivated (Maier & Seligman 2016; '
      + 'Maier & Watkins 2010, both already cited in action-outcome-contingency.json). The magnitudes are not.',
  },
  ambiguityGain: {
    CLEAR: 1.0, PARTIAL: 1.15, AMBIGUOUS: 1.3, UNKNOWN: 1.15,
    classification: 'CALIBRATION_ONLY',
    note: 'Direction (more ambiguity -> higher load) is literature-motivated (Grupe & Nitschke 2013, cited in '
      + 'docs/anxiety-v2-design.md Part C.4). The magnitudes are not.',
  },
  kUpPerHour: {
    value: 4,
    unit: 'per hour',
    classification: 'CALIBRATION_ONLY',
    note: 'Rise-rate constant of the leaky integrator. At drive=1 this gives a ~15 minute time constant. '
      + 'Chosen only so the candidate visibly reacts within the golden fixtures\' shortest active window '
      + '(the 5-minute hostile-search-confiscation IMMINENT period); not fitted to any anxiety dataset.',
  },
  kDownPerHour: {
    value: 0.5,
    unit: 'per hour',
    classification: 'CALIBRATION_ONLY',
    note: 'Recovery-rate constant of the leaky integrator. At drive=0 this gives a ~2 hour time constant, '
      + 'chosen only to make gradual (not instantaneous) post-resolution recovery visible across the '
      + 'existing fixture windows; not fitted to any anxiety dataset.',
  },
  floor: {
    value: 0,
    classification: 'CALIBRATION_ONLY (deliberately zero)',
    note: 'No literature-derived nonzero chronic baseline is used. See docs/anxiety-v2-design.md Part D.4: a '
      + 'nonzero floor without a source would be an ARBITRARY (category C) constant and is excluded.',
  },
});

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// GROUNDED: reads the exact same currentConcern the LIVE/REPLAY operational
// anxiety projection already exposes (operational-anxiety-state.js). Adds
// no new probability calculation of its own for the severity term.
function severityFor(concern) {
  if (!concern) return { severity: 0, basis: 'NO_ACTIVE_CONCERN' };
  const learned = (concern.learnedCueOutcomeEvidence || [])
    .filter((row) => row.evidence && row.evidence.status === 'LEARNED_HISTORY_AVAILABLE');
  if (!learned.length) {
    return { severity: CALIBRATION_LEDGER.unlearnedSeverityPlaceholder.value, basis: 'CALIBRATION_UNLEARNED_PLACEHOLDER' };
  }
  const mean = Math.max(...learned.map((row) => row.evidence.posterior.mean));
  return { severity: mean, basis: 'GROUNDED_LEARNED_POSTERIOR' };
}

// Pure function of a single trajectory point's already-computed snapshot.
// Reads status/currentConcern only; performs no state mutation.
export function computeDriveAtPoint(point) {
  const anxiety = point && point.snapshot && point.snapshot.anxiety;
  const concern = anxiety && anxiety.currentConcern;
  const { severity, basis } = severityFor(concern);
  const temporalStatus = concern ? concern.temporalStatus : 'NONE';
  const imminenceWeight = concern ? (CALIBRATION_LEDGER.imminenceWeight[temporalStatus] ?? 0) : 0;
  const objectiveControllability = concern ? concern.objectiveControllability : 'UNKNOWN';
  const controlDiscount = CALIBRATION_LEDGER.controlDiscount[objectiveControllability] ?? 0;
  const worldAmbiguity = concern ? concern.worldAmbiguity : 'UNKNOWN';
  const ambiguityGain = CALIBRATION_LEDGER.ambiguityGain[worldAmbiguity] ?? 1;
  const rawDrive = severity * imminenceWeight * (1 - controlDiscount) * ambiguityGain;
  return {
    drive: clamp01(rawDrive),
    components: {
      severity: round(severity), severityBasis: basis,
      temporalStatus, imminenceWeight,
      objectiveControllability, controlDiscount,
      worldAmbiguity, ambiguityGain,
      clamped: rawDrive > 1 || rawDrive < 0,
    },
  };
}

// Closed-form leaky-integrator step over a constant-drive interval - see
// docs/anxiety-v2-design.md Part D.3 for the derivation. Exact regardless of
// dt, so results do not depend on the workbench's chosen sampling interval.
function stepLoad(loadStart, drive, dtHours, k) {
  const denom = k.up * drive + k.down * (1 - drive);
  if (!(denom > 0) || !(dtHours > 0)) return loadStart;
  const loadInf = (k.up * drive) / denom;
  return loadInf + (loadStart - loadInf) * Math.exp(-dtHours * denom);
}

// Post-processes an existing cy.soma-replay-report's trajectory (from
// soma-replay.js) into a parallel candidate-load series, one entry per
// trajectory point, in the same chronological order. Fabricates no new
// event and mutates nothing; a pure read of already-grounded facts plus the
// closed-form integration of the CALIBRATION-only rate constants above.
export function computeCandidateTrajectory(report, {
  initialLoad = CALIBRATION_LEDGER.floor.value,
  kUpPerHour = CALIBRATION_LEDGER.kUpPerHour.value,
  kDownPerHour = CALIBRATION_LEDGER.kDownPerHour.value,
} = {}) {
  const trajectory = (report && report.trajectory) || [];
  const k = { up: kUpPerHour, down: kDownPerHour };
  const out = [];
  let load = clamp01(initialLoad);
  let previousDrive = null;
  let previousTimestampMs = null;
  for (const point of trajectory) {
    if (previousTimestampMs != null) {
      const dtHours = (point.timestampMs - previousTimestampMs) / 3600000;
      load = clamp01(stepLoad(load, previousDrive, dtHours, k));
    }
    const { drive, components } = computeDriveAtPoint(point);
    out.push({
      timestampMs: point.timestampMs,
      kind: point.kind,
      load: round(load),
      drive: round(drive),
      components,
    });
    previousDrive = drive;
    previousTimestampMs = point.timestampMs;
  }
  return out;
}

export function candidateModelMetadata() {
  return {
    modelId: CANDIDATE_MODEL_ID,
    status: CANDIDATE_MODEL_STATUS,
    constructScope: CONSTRUCT_SCOPE,
    calibration: CALIBRATION_LEDGER,
  };
}
