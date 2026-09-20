// soma-replay.js - deterministic, headless grounded Soma replay.

import { createHash } from 'node:crypto';
import * as somaEngine from './soma.js';
import { observeEnvironmentRecord } from './grounded-environment-transition.js';
import { operationalAnxietySnapshot } from './operational-anxiety-state.js';

const clone = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function checksum(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function timestampMs(record) {
  const raw = record && record.world_event && record.world_event.timestamp;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) throw new Error(`invalid environment-record timestamp: ${raw || 'missing'}`);
  return parsed;
}

function compactDefensiveContexts(state) {
  return Object.values((state.currentDefensiveContext && state.currentDefensiveContext.contexts) || {})
    .map((context) => ({
      contextKey: context.contextKey,
      outcomeClass: context.outcomeClass,
      active: context.active,
      temporalStatus: context.temporalStatus,
      resolutionStatus: context.resolutionStatus,
      objectiveControllability: context.objectiveControllability,
      worldAmbiguity: context.worldAmbiguity,
      sourceEnvironmentEventIds: clone(context.sourceEnvironmentEventIds || []),
    }))
    .sort((left, right) => left.contextKey.localeCompare(right.contextKey));
}

function compactThreatLearning(state) {
  const rows = [];
  for (const [cueId, outcomes] of Object.entries((state.threatLearning && state.threatLearning.pairs) || {})) {
    for (const [outcomeClass, posterior] of Object.entries(outcomes || {})) {
      rows.push({
        cueId,
        outcomeClass,
        alpha: posterior.alpha,
        beta: posterior.beta,
        mean: posterior.mean,
        variance: posterior.variance,
        resolvedObservations: posterior.resolvedObservations,
        lastUpdatedAt: posterior.lastUpdatedAt,
      });
    }
  }
  return rows.sort((left, right) => left.cueId.localeCompare(right.cueId)
    || left.outcomeClass.localeCompare(right.outcomeClass));
}

function compactControllability(state) {
  const rows = [];
  for (const pair of Object.values((state.learnedControllability && state.learnedControllability.pairs) || {})) {
    rows.push({
      pairKey: pair.pairKey,
      contextId: pair.contextId,
      actionId: pair.actionId,
      outcomeClass: pair.outcomeClass,
      action: clone(pair.action),
      noAction: clone(pair.noAction),
      lastUpdatedAt: pair.lastUpdatedAt,
    });
  }
  return rows.sort((left, right) => left.pairKey.localeCompare(right.pairKey));
}

export const CURRENT_ANXIETY_REPLAY_ALGORITHM = Object.freeze({
  id: 'current-grounded-anxiety-stack',
  version: `soma-v${somaEngine.SOMA_VERSION}`,
  createState(initialState, { startMs }) {
    return somaEngine.reconcileSoma(clone(initialState), { now: startMs });
  },
  createTransitionTarget(state) {
    return {
      observeFeedingRecord: (record) => somaEngine.observeSomaFeedingRecord(state, record),
      observeSomaticRecord: (record) => somaEngine.observeSomaSomaticRecord(state, record),
      observeSocialContactRecord: (record) => somaEngine.observeSomaSocialContactRecord(state, record),
      observeControllabilityRecord: (record) => somaEngine.observeSomaControllabilityRecord(state, record),
      observeCurrentDefensiveContextRecord: (record) => (
        somaEngine.observeSomaCurrentDefensiveContextRecord(state, record)
      ),
      observeThreatLearningRecord: (record) => somaEngine.observeSomaThreatLearningRecord(state, record),
    };
  },
  snapshot(state) {
    const anxiety = operationalAnxietySnapshot(state.currentDefensiveContext);
    return {
      anxiety: {
        status: anxiety.status,
        currentConcern: clone(anxiety.currentConcern),
      },
      defensiveContexts: compactDefensiveContexts(state),
      threatLearning: compactThreatLearning(state),
      controllability: compactControllability(state),
    };
  },
});

function normalizeCoverage(coverage, startMs, endMs) {
  if (!Array.isArray(coverage) || coverage.length === 0) {
    return [{ fromMs: startMs, toMs: endMs, status: 'OBSERVED', reason: 'fixture coverage' }];
  }
  return coverage.map((segment, index) => {
    const fromMs = Number(segment && segment.fromMs);
    const toMs = Number(segment && segment.toMs);
    const status = String(segment && segment.status || '').toUpperCase();
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) {
      throw new Error(`invalid coverage segment at index ${index}`);
    }
    if (!['OBSERVED', 'UNKNOWN'].includes(status)) {
      throw new Error(`invalid coverage status at index ${index}`);
    }
    return { fromMs, toMs, status, reason: String(segment.reason || '') };
  });
}

export const DEFAULT_REPLAY_SAMPLE_INTERVAL_MS = 15 * 60 * 1000;

const FULL_DAY_MS = 24 * 60 * 60 * 1000;

// Compute the whole-UTC-day window that fully contains a fixture's own window
// AND all of its event timestamps, floored/ceiled to UTC midnight boundaries.
// Epoch-aligned day boundaries ARE UTC midnights (the epoch begins at UTC
// midnight and FULL_DAY_MS divides evenly), so this needs no timezone maths.
// It only widens the replay interval - it does not touch records, initialState
// or coverage - so the existing deterministic replay produces the identical
// per-event trajectory plus additional baseline time samples before the first
// event and after the last. For every current golden fixture this resolves to
// exactly 00:00-24:00 on the fixture's single day.
export function fullDayWindowMs({ startMs, endMs, records = [] } = {}) {
  const stamps = [];
  if (Number.isFinite(startMs)) stamps.push(startMs);
  if (Number.isFinite(endMs)) stamps.push(endMs);
  for (const entry of Array.isArray(records) ? records : []) {
    const record = entry && entry.record ? entry.record : entry;
    const parsed = Date.parse(record && record.world_event && record.world_event.timestamp);
    if (Number.isFinite(parsed)) stamps.push(parsed);
  }
  if (!stamps.length) throw new Error('fullDayWindowMs requires at least one finite timestamp');
  const min = Math.min(...stamps);
  const max = Math.max(...stamps);
  const dayStart = Math.floor(min / FULL_DAY_MS) * FULL_DAY_MS;
  let dayEnd = Math.ceil(max / FULL_DAY_MS) * FULL_DAY_MS;
  if (dayEnd <= dayStart) dayEnd = dayStart + FULL_DAY_MS;
  return { startMs: dayStart, endMs: dayEnd };
}

function coverageStatusAt(normalizedCoverage, timestampMs) {
  const segment = normalizedCoverage.find((item) => timestampMs >= item.fromMs && timestampMs <= item.toMs);
  return segment ? segment.status : 'UNKNOWN';
}

function resolveSampleIntervalMs(sampleIntervalMs) {
  if (sampleIntervalMs === true) return DEFAULT_REPLAY_SAMPLE_INTERVAL_MS;
  if (!Number.isFinite(sampleIntervalMs) || sampleIntervalMs <= 0) return null;
  return sampleIntervalMs;
}

function generateSampleTimestamps({ startMs, endMs, intervalMs, exclude }) {
  if (!intervalMs) return [];
  const timestamps = [];
  for (let t = startMs + intervalMs; t <= endMs; t += intervalMs) {
    if (!exclude.has(t)) timestamps.push(t);
  }
  return timestamps;
}

function normalizeRecords(records, diagnostics) {
  if (!Array.isArray(records)) throw new TypeError('records must be an array');
  return records.map((entry, inputIndex) => {
    const record = entry && entry.record ? entry.record : entry;
    if (!record || record.schema !== 'cy.environment-record' || !record.world_event) {
      throw new Error(`invalid cy.environment-record at index ${inputIndex}`);
    }
    const suppliedSequence = entry && entry.record ? entry.sequence : undefined;
    const explicitSequence = Number.isInteger(suppliedSequence) ? suppliedSequence : null;
    if (explicitSequence == null) {
      diagnostics.push({
        code: 'IMPLICIT_EVENT_ORDER',
        eventId: record.world_event.id || null,
        message: 'No explicit sequence supplied; input order is the stable tie-breaker.',
      });
    }
    return {
      record: clone(record),
      inputIndex,
      sequence: explicitSequence == null ? inputIndex : explicitSequence,
      explicitSequence: explicitSequence != null,
      timestampMs: timestampMs(record),
      eventId: String(record.world_event.id || ''),
    };
  }).sort((left, right) => left.timestampMs - right.timestampMs
    || left.sequence - right.sequence
    || left.eventId.localeCompare(right.eventId)
    || left.inputIndex - right.inputIndex);
}

export function runSomaReplay({
  initialState = null,
  records = [],
  startMs,
  endMs,
  coverage = [],
  algorithm = CURRENT_ANXIETY_REPLAY_ALGORITHM,
  algorithmMetadata = null,
  sampleIntervalMs = null,
} = {}) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    throw new Error('explicit valid startMs and endMs are required');
  }
  for (const method of ['createState', 'createTransitionTarget', 'snapshot']) {
    if (!algorithm || typeof algorithm[method] !== 'function') {
      throw new Error(`replay algorithm is missing ${method}()`);
    }
  }

  const diagnostics = [];
  const ordered = normalizeRecords(records, diagnostics);
  const normalizedCoverage = normalizeCoverage(coverage, startMs, endMs);
  const invariantFailures = [];
  const seenEventIds = new Set();
  const seenOrderKeys = new Set();
  for (const item of ordered) {
    if (!item.eventId) {
      invariantFailures.push({ code: 'MISSING_EVENT_ID', message: 'Every replay event requires an ID.' });
    } else if (seenEventIds.has(item.eventId)) {
      invariantFailures.push({
        code: 'DUPLICATE_EVENT_ID', eventId: item.eventId, message: 'Event IDs must be unique in a replay case.',
      });
    }
    seenEventIds.add(item.eventId);
    const orderKey = `${item.timestampMs}|${item.sequence}`;
    if (item.explicitSequence && seenOrderKeys.has(orderKey)) {
      invariantFailures.push({
        code: 'DUPLICATE_EXPLICIT_ORDER',
        eventId: item.eventId,
        message: 'Events at the same timestamp must have distinct explicit sequences.',
      });
    }
    if (item.explicitSequence) seenOrderKeys.add(orderKey);
  }
  const state = algorithm.createState(clone(initialState), { startMs, endMs });
  const target = algorithm.createTransitionTarget(state);
  const trajectory = [{
    kind: 'INITIAL',
    timestampMs: startMs,
    timestamp: new Date(startMs).toISOString(),
    sourceEventId: null,
    coverageStatus: coverageStatusAt(normalizedCoverage, startMs),
    snapshot: clone(algorithm.snapshot(state)),
  }];
  const transitions = [];

  const intervalMs = resolveSampleIntervalMs(sampleIntervalMs);
  const sampleTimestamps = generateSampleTimestamps({
    startMs, endMs, intervalMs, exclude: new Set([startMs, ...ordered.map((item) => item.timestampMs)]),
  });
  const instants = [
    ...ordered.map((item) => ({ timestampMs: item.timestampMs, kind: 'EVENT', item })),
    ...sampleTimestamps.map((timestampMs) => ({ timestampMs, kind: 'SAMPLE' })),
  ].sort((left, right) => left.timestampMs - right.timestampMs);

  for (const instant of instants) {
    if (instant.kind === 'SAMPLE') {
      // A time sample only reads the already-reconciled state at this instant.
      // It applies no record and fabricates no event; between events the
      // grounded defensive-context seam holds its last resolved value exactly
      // as current-defensive-context.json specifies ("No time decay or
      // interpolation occurs between events"), so a flat run of samples here
      // is the correct, honest rendering of that behaviour - not a sampling bug.
      trajectory.push({
        kind: 'SAMPLE',
        timestampMs: instant.timestampMs,
        timestamp: new Date(instant.timestampMs).toISOString(),
        sourceEventId: null,
        coverageStatus: coverageStatusAt(normalizedCoverage, instant.timestampMs),
        snapshot: clone(algorithm.snapshot(state)),
      });
      continue;
    }
    const item = instant.item;
    if (item.timestampMs < startMs || item.timestampMs > endMs) {
      diagnostics.push({
        code: 'EVENT_OUTSIDE_INTERVAL',
        eventId: item.eventId,
        timestampMs: item.timestampMs,
        message: 'Event was preserved in diagnostics but not applied.',
      });
      continue;
    }
    const before = clone(algorithm.snapshot(state));
    const results = observeEnvironmentRecord(target, item.record);
    const after = clone(algorithm.snapshot(state));
    const transition = {
      timestampMs: item.timestampMs,
      timestamp: new Date(item.timestampMs).toISOString(),
      sequence: item.sequence,
      explicitSequence: item.explicitSequence,
      sourceEventId: item.eventId,
      eventType: item.record.world_event.event_type,
      before,
      after,
      results: clone(results),
    };
    transitions.push(transition);
    trajectory.push({
      kind: 'EVENT',
      timestampMs: item.timestampMs,
      timestamp: transition.timestamp,
      sequence: item.sequence,
      sourceEventId: item.eventId,
      eventType: transition.eventType,
      coverageStatus: coverageStatusAt(normalizedCoverage, item.timestampMs),
      snapshot: after,
    });
  }

  for (const segment of normalizedCoverage.filter((item) => item.status === 'UNKNOWN')) {
    diagnostics.push({
      code: 'OBSERVATION_GAP_PRESERVED',
      fromMs: segment.fromMs,
      toMs: segment.toMs,
      message: segment.reason || 'No observation claim is made for this interval.',
    });
  }

  const finalSnapshot = clone(algorithm.snapshot(state));
  if (trajectory.at(-1).timestampMs !== endMs) {
    trajectory.push({
      kind: 'END',
      timestampMs: endMs,
      timestamp: new Date(endMs).toISOString(),
      sourceEventId: null,
      coverageStatus: coverageStatusAt(normalizedCoverage, endMs),
      snapshot: finalSnapshot,
    });
  }
  const report = {
    schema: 'cy.soma-replay-report',
    version: 1,
    classification: normalizedCoverage.some((item) => item.status === 'UNKNOWN')
      || diagnostics.some((item) => item.code === 'IMPLICIT_EVENT_ORDER')
      || invariantFailures.length
      ? 'COUNTERFACTUAL' : 'CONTROLLED_REPLAY',
    interval: { startMs, endMs },
    sampling: intervalMs ? { intervalMs, sampleCount: sampleTimestamps.length } : null,
    algorithm: clone(algorithmMetadata || { id: algorithm.id, version: algorithm.version }),
    coverage: normalizedCoverage,
    orderedEventIds: transitions.map((item) => item.sourceEventId),
    trajectory,
    transitions,
    diagnostics,
    invariantFailures,
    finalSnapshot,
    finalState: clone(state),
  };
  report.checksum = checksum({ ...report, finalState: undefined });
  return report;
}

export function formatSomaReplay(report) {
  const lines = [
    `${report.classification} | ${report.algorithm.id} ${report.algorithm.version}`,
    `events: ${report.orderedEventIds.length} | checksum: ${report.checksum}`,
  ];
  for (const transition of report.transitions) {
    const before = transition.before.anxiety.status;
    const after = transition.after.anxiety.status;
    const active = transition.after.defensiveContexts.filter((item) => item.active)
      .map((item) => `${item.outcomeClass}:${item.temporalStatus}`).join(', ') || 'none';
    lines.push(`${transition.timestamp} #${transition.sequence} ${transition.eventType}`);
    lines.push(`  EVENT ${transition.sourceEventId}`);
    lines.push(`  ANXIETY ${before} -> ${after}`);
    lines.push(`  ACTIVE ${active}`);
  }
  if (report.diagnostics.length) {
    lines.push('diagnostics:');
    for (const item of report.diagnostics) lines.push(`  ${item.code}: ${item.message}`);
  }
  if (report.invariantFailures.length) {
    lines.push('invariant failures:');
    for (const item of report.invariantFailures) lines.push(`  ${item.code}: ${item.message}`);
  }
  return lines.join('\n');
}
