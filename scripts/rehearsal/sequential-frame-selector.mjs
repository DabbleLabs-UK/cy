// REHEARSAL ONLY. Private shadow state; no transport, filesystem, publication or apply to CY.
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { fingerprint } from './grounded-occurrence.mjs';
import { prepareFrameSelector, runFrameSelectorAttempt } from './grounded-frame-selector.mjs';
import { noDurableChangeStreak } from '../../runner/awg-health.js';
import { createEnvironmentEvent } from '../../runner/environment-schema.js';
import { applyAwgCandidate, awgEventToEnvironment, buildAwgCall, findNextAwgEligibility,
  AWG_RECENT_RUN_LIMIT, AWG_TIMEOUT_MS } from '../../runner/ambient-world-generator.js';

export const SEQUENTIAL_ATTEMPTS = 10;
export const SEQUENTIAL_POLICY = 'cy.rehearsal.sequential-frames.v1';
const clone = value => structuredClone(value);
const iso = value => new Date(value).toISOString();
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function londonTimestamp(nowMs) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(nowMs)).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}.${String(nowMs % 1000).padStart(3, '0')}`;
}

// Exact AWG-visible projection from run.js captureEnvironmentEvent, not a new event family.
// Production creates env IDs and a London wall timestamp after publication. Here completion
// is instantaneous in LOGICAL time; wall-clock model latency is separately retained.
export function projectShadowEnvironment(applied, { id, nowMs }) {
  const env = awgEventToEnvironment(applied);
  assert.ok(env, 'ACCEPTED_ENVIRONMENT_REQUIRED');
  const event = createEnvironmentEvent(env.archetypeId, { id, timestamp: londonTimestamp(nowMs),
    eventType: env.eventType, world: env.world,
    observation: { summary: env.summary, ...env.observation } });
  return { id: event.id, timestamp: event.timestamp,
    summary: env.summary || event.world.context.description || event.event_type,
    eventFamily: event.event_family, eventType: event.event_type, archetypeId: event.archetype_id,
    location: event.world.context.location || null, participants: event.world.context.associated_entities || [],
    actorId: event.world.participants.actor || null, targetId: event.world.participants.target || null,
    cyObserved: !!applied.cyObserved, dreamEligible: !!applied.cyObserved };
}

function diagnosticFeedback(capture, prepared, nowMs) {
  // Build the OLD production call for inspection only. Never send it or copy its guidance
  // into the prototype. This exposes precisely the before-generation feedback difference.
  const production = buildAwgCall('', { state: capture.worldSimulation, nowMs,
    currentLocation: capture.currentLocation, plausibleCastIds: capture.plausibleCastIds,
    recentEvents: capture.recentWorldHistory, droughtActive: false });
  const start = production.prompt.indexOf('- RECENT EVENT SIGNATURES TO AVOID');
  const end = production.prompt.indexOf('- If the supplied facts', start);
  return {
    modelVisible: { system: prepared.request?.system ?? null, prompt: prepared.request?.prompt ?? null,
      historyMaterial: [], duplicateGuidance: [], droughtGuidance: [],
      semanticHistoryVisible: false, opaqueStateBoundFrameIdsOnly: true },
    validatorVisible: { recentAccepted: clone(capture.worldSimulation.recentAccepted || []),
      recentWorldHistory: clone(capture.recentWorldHistory || []),
      lastAcceptedAt: capture.worldSimulation.lastAcceptedAt || null },
    oldProductionNegativeGuidanceNotSent: production.prompt.slice(start, end),
    drought: { streak: noDurableChangeStreak(capture.worldSimulation), diagnosticOnly: true },
  };
}

function requestChanges(previous, current, previousCapture, capture) {
  if (!previous) return { changed: false, reason: ['INITIAL_VERIFIED_FROZEN_CAPTURE'], paths: [] };
  const reason = [], paths = [];
  for (const field of ['system', 'prompt', 'format', 'options', 'model']) {
    if (!isDeepStrictEqual(previous.request?.[field], current.request?.[field])) paths.push(field);
  }
  if (!isDeepStrictEqual(previous.bound.frames.map(f => f.frameId), current.bound.frames.map(f => f.frameId))) reason.push('STATE_BOUND_FRAME_IDS_REBOUND');
  if (previous.bound.current.londonClock !== current.bound.current.londonClock) reason.push('LOGICAL_LONDON_CLOCK_ADVANCED');
  for (const [field, label] of [['recentAccepted', 'ACCEPTED_HISTORY_CHANGED'], ['recentRuns', 'OPERATIONAL_RUN_LEDGER_CHANGED'], ['lastRunAt', 'LAST_RUN_CHANGED']]) {
    if (!isDeepStrictEqual(previousCapture.worldSimulation[field], capture.worldSimulation[field])) reason.push(label);
  }
  if (!isDeepStrictEqual(previousCapture.recentWorldHistory, capture.recentWorldHistory)) reason.push('RECENT_WORLD_HISTORY_CHANGED');
  reason.push('NO_READABLE_REPEAT_GUIDANCE_ADDED');
  return { changed: paths.length > 0, reason, paths,
    previousRequestHash: fingerprint(previous.request), requestHash: fingerprint(current.request),
    frameDomainsUnchanged: isDeepStrictEqual(previous.bound.frames.map(f => f.operationDomain), current.bound.frames.map(f => f.operationDomain)) };
}

export function createSequentialFrameSession(originalCapture, { nowMs } = {}) {
  assert.ok(Number.isSafeInteger(nowMs), 'EXPLICIT_FROZEN_NOW_REQUIRED');
  const originalFingerprint = fingerprint(originalCapture);
  let shadow = clone(originalCapture), cursorMs = nowMs, completed = 0, active = null;
  let previousPrepared = null, previousCapture = null, running = false;
  const rows = [];

  function prepareNext() {
    assert.equal(fingerprint(originalCapture), originalFingerprint, 'ORIGINAL_CAPTURE_MUTATED');
    assert.ok(completed < SEQUENTIAL_ATTEMPTS, 'TEN_ATTEMPT_LIMIT');
    if (active) return clone(active);
    const eligibility = findNextAwgEligibility(shadow.worldSimulation, { fromMs: cursorMs });
    assert.ok(Number.isSafeInteger(eligibility.eligibleAt), 'NO_ELIGIBLE_LOGICAL_OPPORTUNITY');
    const attemptMs = eligibility.eligibleAt;
    const capture = clone(shadow);
    const prepared = prepareFrameSelector(capture, { nowMs: attemptMs });
    assert.ok(prepared.request && prepared.bound.frames.length, 'NO_AVAILABLE_FRAMES');
    active = freeze({ step: completed + 1, nowMs: attemptMs, logicalAt: iso(attemptMs),
      logicalWaitMs: attemptMs - cursorMs, eligibility,
      shadowBefore: capture, shadowBeforeHash: fingerprint(capture), prepared,
      feedback: diagnosticFeedback(capture, prepared, attemptMs),
      requestChanges: requestChanges(previousPrepared, prepared, previousCapture, capture) });
    return clone(active);
  }

  async function attempt({ generate, preflight, signal, timeoutMs = AWG_TIMEOUT_MS } = {}) {
    assert.equal(running, false, 'CONCURRENT_STEP_FORBIDDEN');
    const ticket = prepareNext(); running = true;
    try {
      const result = await runFrameSelectorAttempt({ capture: clone(ticket.shadowBefore), nowMs: ticket.nowMs,
        admitted: true, generate, preflight, signal, timeoutMs,
        getCurrentCapture: () => clone(shadow) });
      assert.equal(fingerprint(shadow), ticket.shadowBeforeHash, 'SHADOW_CHANGED_DURING_REQUEST');
      assert.equal(fingerprint(originalCapture), originalFingerprint, 'ORIGINAL_CAPTURE_MUTATED');
      assert.equal(result.repairCalls, 0); assert.equal(result.replacementCalls, 0); assert.equal(result.applied, false);
      // A failed preflight/admission is NOT one of the ten counted sends: stop, never
      // replace it silently or advance operational/world history as though a call ran.
      const abort = reason => {
        const error = new Error(reason);
        error.abortedStep = { ...clone(ticket), result: clone(result), batchAborted: true,
          wouldAccept: false, shadowUpdate: { appliedToShadowOnly: false, beforeHash: ticket.shadowBeforeHash,
            afterHash: fingerprint(shadow), reason: 'NO_STATE_CHANGE_ON_PREFLIGHT_OR_PROTOCOL_ABORT' } };
        throw error;
      };
      if (result.generateInvocations !== 1) abort(`ABORT_BEFORE_SEND:${result.reason}`);
      if (/TOKEN_|truncat/i.test(result.reason || '')) abort(`ABORT_TOKEN_ACCOUNTING:${result.reason}`);
      const accepted = result.evaluation?.valid === true;
      assert.deepEqual(result.evaluation?.compatibilityExceptions || [], [], 'NO_REHEARSAL_EXCEPTION_ALLOWED');
      let state = clone(shadow.worldSimulation), applied = null, environment = null;
      state.lastRunAt = ticket.logicalAt;
      const makeId = prefix => `shadow-${prefix}-${String(ticket.step).padStart(2, '0')}`;
      if (accepted) {
        assert.deepEqual(result.evaluation.proposal.objects, []);
        assert.equal(result.evaluation.proposal.thread.action, 'NONE');
        assert.deepEqual(result.evaluation.reconstructed.effects, []);
        applied = applyAwgCandidate(state, result.evaluation.legacyValidation, { makeId, acceptedAt: ticket.logicalAt });
        assert.equal(applied.accepted, true);
        applied.validationCandidate = result.evaluation.legacyValidation.candidate;
        state = applied.state;
        environment = projectShadowEnvironment(applied, { id: makeId('env'), nowMs: ticket.nowMs });
        applied.event.environmentEventId = environment.id;
      }
      const validation = result.evaluation?.legacyValidation;
      const run = { runId: makeId('awg-run'), ranAt: ticket.logicalAt,
        drought: { active: false, streak: noDurableChangeStreak(shadow.worldSimulation), diagnosticOnly: true },
        candidateType: validation?.candidate?.decision || result.evaluation?.candidate?.decision || (result.evaluation ? 'INVALID' : 'FAILED'),
        candidateOutput: validation?.candidate || result.evaluation?.candidate || result.raw || null,
        validationStatus: accepted ? 'ACCEPTED' : result.evaluation ? 'REJECTED' : /CANCEL/.test(result.reason || '') ? 'NOT_RUN' : 'FAILED',
        rejectionReason: result.reason, createdWorldEventIds: applied ? [applied.event.id] : [],
        threadChanges: applied?.changes || [], modelLatencyMs: result.elapsedMs,
        validationLatencyMs: result.evaluation?.checkMs || 0 };
      state.recentRuns = [...(state.recentRuns || []), run].slice(-AWG_RECENT_RUN_LIMIT);
      const after = clone(shadow); after.worldSimulation = state;
      if (environment) after.recentWorldHistory = [...after.recentWorldHistory, environment].slice(-24);
      const row = freeze({ ...ticket, result, wouldAccept: accepted,
        duplicateDecision: { errors: validation?.errors.filter(e => /DUPLICATE|REPEAT/.test(e)) || [],
          checked: !!validation, crossAttemptHistoryUsed: true },
        shadowUpdate: { appliedToShadowOnly: accepted, event: applied?.event || null,
          environment, run, worldEntityRevisionsChanged: false,
          beforeHash: ticket.shadowBeforeHash, afterHash: fingerprint(after),
          droughtAfter: noDurableChangeStreak(state) }, shadowAfter: after });
      previousPrepared = clone(ticket.prepared); previousCapture = clone(ticket.shadowBefore);
      shadow = after; cursorMs = ticket.nowMs + 1; completed++; active = null; rows.push(row);
      return clone(row);
    } finally { running = false; }
  }
  return Object.freeze({ prepareNext, attempt,
    snapshot: () => clone(shadow), records: () => clone(rows),
    progress: () => ({ completed, maximum: SEQUENTIAL_ATTEMPTS, originalFingerprint,
      shadowFingerprint: fingerprint(shadow), logicalCursorMs: cursorMs, productionApplied: false }) });
}

// Future authorised transport is injected. This module cannot open a socket.
// A transport must enforce isolated origin, exact wire, prompt count, and abort signal.
export async function runTenSequentialAttempts(session, { generate, preflight, signal, record } = {}) {
  assert.equal(session.progress().completed, 0, 'NEVER_RESUME_OR_REPLAY_BATCH');
  const rows = [];
  for (let i = 0; i < SEQUENTIAL_ATTEMPTS; i++) {
    if (signal?.aborted) throw new Error('BATCH_CANCELLED');
    let row;
    try { row = await session.attempt({ generate, preflight, signal }); }
    catch (error) {
      if (record && error.abortedStep) await record(clone(error.abortedStep));
      throw error;
    }
    if (record) await record(clone(row)); // failure stops; never replace this send
    rows.push(row);
  }
  assert.equal(session.progress().completed, SEQUENTIAL_ATTEMPTS);
  return rows;
}
