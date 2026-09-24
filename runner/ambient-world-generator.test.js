import assert from 'node:assert/strict';
import test from 'node:test';

import { InferenceCancellationError } from './inference-cancellation.js';

import {
  AWG_CADENCE_MS,
  AWG_MIN_IDLE_BUDGET_MS,
  AWG_TIMEOUT_MS,
  AWG_SCHEMA,
  applyAwgCandidate,
  awgEventToEnvironment,
  buildAwgCall,
  buildAwgProposalFormat,
  materialiseAwgProposal,
  parseAwgCandidate,
  reconcileWorldSimulationState,
  runAmbientWorldCycle,
  isAwgDue,
  shouldRunAwg,
  validateAwgCandidate,
} from './ambient-world-generator.js';

test('scheduling budget covers realistic slow local inference without changing cadence', () => {
  assert.equal(AWG_CADENCE_MS, 45 * 60 * 1000);
  assert.equal(AWG_TIMEOUT_MS, 5 * 60 * 1000);
  assert.ok(AWG_TIMEOUT_MS > 65_000,
    'the former exercise-poll budget cannot abort AWG before realistic DELL first-token latency');
});

const NOW = Date.parse('2026-09-12T12:00:00.000Z');

function candidate(overrides = {}) {
  return {
    schema: AWG_SCHEMA,
    version: 1,
    decision: 'EVENT',
    eventFamily: 'MESSAGE_PASSING',
    participants: ['reg', 'cy'],
    location: 'landing',
    occurredAt: new Date(NOW).toISOString(),
    objective: { eventType: 'note_passed', summary: 'Reg passed a folded note to Cy on the landing.' },
    objects: [{ id: 'object-note-1', type: 'note', ownerId: 'reg', holderId: 'cy', location: 'landing', status: 'ACTIVE' }],
    observations: [{ observerId: 'cy', access: 'CY_DIRECT', summary: 'Reg put a folded note into Cy hand.' }],
    informationClaims: [],
    resolved: false,
    thread: { action: 'OPEN', id: 'thread-note-1', type: 'NOTE_AWAITING_DELIVERY', summary: 'The note has not reached Daemon.', nextEligibleAt: null },
    continuationOf: null,
    publicTimeline: { eligible: true, text: '[Reg slips Cy a folded note on the landing]' },
    ...overrides,
  };
}

function proposal(overrides = {}) {
  return {
    decision: 'EVENT',
    eventFamily: 'MESSAGE_PASSING',
    participants: ['reg', 'cy'],
    objective: { eventType: 'note_passed', summary: 'Reg passed a folded note to Cy.' },
    objects: [{ id: null, type: 'note', ownerId: 'reg', holderId: 'cy', status: 'ACTIVE' }],
    observations: [{ observerId: 'cy', access: 'CY_DIRECT', summary: 'Reg put a folded note into Cy hand.' }],
    informationClaims: [],
    resolved: false,
    thread: { action: 'OPEN', id: null, type: 'NOTE_AWAITING_DELIVERY', summary: 'The note has not reached Daemon.' },
    ...overrides,
  };
}

test('production proposal contract keeps machine-owned fields out of model output', () => {
  const call = buildAwgCall('<SHARED_CONTEXT>[WORLD FACT] [C2] context</SHARED_CONTEXT>', {
    state: null,
    currentLocation: 'cell',
    plausibleCastIds: ['reg', 'bill'],
  });
  assert.ok(call.format && Array.isArray(call.format.oneOf));
  const eventFormat = call.format.oneOf[1];
  assert.equal(call.format.oneOf[0].properties.decision.const, 'NO_EVENT');
  assert.equal(eventFormat.properties.decision.const, 'EVENT');
  assert.deepEqual(eventFormat.properties.thread.properties.action.enum, ['NONE', 'OPEN']);
  assert.equal(eventFormat.properties.thread.properties.id.const, null);
  assert.deepEqual(eventFormat.properties.participants.items.enum, ['cy', 'reg', 'bill']);
  for (const forbidden of ['occurredAt', 'location', 'schema', 'version', 'continuationOf']) {
    assert.equal(Object.hasOwn(eventFormat.properties, forbidden), false);
  }
  const observationBranches = eventFormat.properties.observations.items.oneOf;
  assert.equal(observationBranches[0].properties.observerId.const, 'world');
  assert.equal(observationBranches[0].properties.access.const, 'WORLD_ONLY');
  assert.equal(observationBranches[1].properties.observerId.const, 'cy');
  assert.equal(observationBranches[1].properties.access.enum.includes('WORLD_ONLY'), false);
  assert.deepEqual(observationBranches[2].properties.observerId.enum, ['reg', 'bill']);
  assert.equal(observationBranches[2].properties.access.const, 'CAST_ONLY');
  assert.equal(Object.hasOwn(eventFormat.properties, 'publicTimelineText'), false);
  assert.match(call.prompt, /\[C1\].*never cast or observer IDs/i);
});

test('real C2-style cast leak cannot pass proposal materialisation', () => {
  assert.throws(() => materialiseAwgProposal(proposal({ participants: ['C2'] }), null, {
    nowMs: NOW, currentLocation: 'cell', plausibleCastIds: ['reg', 'bill'],
  }), /UNKNOWN_CAST_ID/);
});

test('timestamps, location and new IDs are assigned by code rather than the model', () => {
  const value = materialiseAwgProposal(proposal(), null, {
    nowMs: NOW,
    currentLocation: 'cell',
    plausibleCastIds: ['reg', 'bill'],
    makeId: (prefix) => `${prefix}-deterministic`,
  });
  assert.equal(value.occurredAt, new Date(NOW).toISOString());
  assert.equal(value.location, 'cell');
  assert.equal(value.objects[0].id, 'object-deterministic');
  assert.equal(value.thread.id, null);
  assert.equal(value.continuationOf, null);
  assert.throws(() => materialiseAwgProposal({ ...proposal(), occurredAt: new Date(NOW).toISOString() }, null, {
    nowMs: NOW, currentLocation: 'cell', plausibleCastIds: ['reg'],
  }), /FORBIDDEN_PROPOSAL_FIELD:occurredAt/);
});

test('continuation and object references are selected only from supplied state', () => {
  const state = reconcileWorldSimulationState({
    threads: [{ id: 'thread-known', state: 'OPEN', sourceEventIds: ['world-known'] }],
    objects: [{ id: 'object-known', type: 'note', ownerId: 'reg', holderId: null, location: 'cell', status: 'ACTIVE' }],
  });
  const format = buildAwgProposalFormat(state, { plausibleCastIds: ['reg'] });
  const eventFormat = format.oneOf[1];
  const continuationFormat = format.oneOf[2];
  assert.equal(eventFormat.properties.thread.properties.id.const, null);
  assert.deepEqual(eventFormat.properties.objects.items.properties.id.enum, [null, 'object-known']);
  assert.equal(continuationFormat.properties.decision.const, 'CONTINUATION');
  assert.deepEqual(continuationFormat.properties.thread.properties.action.enum, ['UPDATE', 'RESOLVE']);
  assert.deepEqual(continuationFormat.properties.thread.properties.id.enum, ['thread-known']);
  const continued = materialiseAwgProposal(proposal({
    decision: 'CONTINUATION',
    objects: [{ id: 'object-known', type: 'note', ownerId: 'reg', holderId: 'cy', status: 'DELIVERED' }],
    thread: { action: 'RESOLVE', id: 'thread-known', type: 'NOTE', summary: 'The note arrived.' },
  }), state, { nowMs: NOW, currentLocation: 'cell', plausibleCastIds: ['reg'] });
  assert.deepEqual(continued.continuationOf, { threadId: 'thread-known', eventIds: ['world-known'] });
  assert.throws(() => materialiseAwgProposal(proposal({
    objects: [{ id: 'invented-object', type: 'note', ownerId: 'reg', holderId: 'cy', status: 'ACTIVE' }],
  }), state, { nowMs: NOW, currentLocation: 'cell', plausibleCastIds: ['reg'] }), /INVALID_OBJECT_REFERENCE/);
});

test('observation and public-knowledge boundaries stay strict', () => {
  assert.throws(() => materialiseAwgProposal(proposal({ observations: [] }), null, {
    nowMs: NOW, currentLocation: 'cell', plausibleCastIds: ['reg'],
  }), /OBSERVABILITY_REQUIRED/);
  const worldOnly = materialiseAwgProposal(proposal({
    participants: ['reg'],
    observations: [{ observerId: 'reg', access: 'CAST_ONLY', summary: 'Reg hid the note.' }],
  }), null, { nowMs: NOW, currentLocation: 'cell', plausibleCastIds: ['reg'] });
  assert.equal(worldOnly.publicTimeline.eligible, false);
  const leaked = {
    ...worldOnly,
    publicTimeline: { eligible: true, text: '[Cy sees the hidden note]' },
  };
  const validation = validateAwgCandidate(leaked, null, { nowMs: NOW, currentLocation: 'cell' });
  assert.ok(validation.errors.includes('PUBLIC_TIMELINE_KNOWLEDGE_LEAK'));
});

test('malformed JSON remains a clean hard failure', () => {
  assert.throws(() => parseAwgCandidate('{"decision":"EVENT"'), /JSON|NO_JSON_OBJECT/);
});

test('real post-fix production rejection shapes cannot cross the proposal boundary', () => {
  const noReferences = buildAwgProposalFormat(null, { plausibleCastIds: ['bill'] }).oneOf[1];
  assert.equal(noReferences.properties.decision.const, 'EVENT');
  assert.equal(noReferences.properties.thread.properties.id.const, null);
  assert.deepEqual(noReferences.properties.objects.items.properties.id.enum, [null]);

  assert.throws(() => materialiseAwgProposal(proposal({
    participants: ['C2'],
    observations: [{ observerId: 'C2', access: 'CY_DIRECT', summary: 'overheard activity' }],
  }), null, {
    nowMs: NOW, currentLocation: 'cell', plausibleCastIds: ['bill'],
  }), /UNKNOWN_CAST_ID/);

  assert.throws(() => materialiseAwgProposal(proposal({
    decision: 'CONTINUATION',
    participants: ['cy'],
    objects: [],
    observations: [],
    thread: { action: 'UPDATE', id: null, type: null, summary: null },
  }), null, {
    nowMs: NOW, currentLocation: 'cell', plausibleCastIds: ['bill'],
  }), /OBSERVABILITY_REQUIRED|INVALID_THREAD_REFERENCE/);

  assert.throws(() => materialiseAwgProposal(proposal({
    participants: ['bill'],
    objective: { type: 'message passing', summary: 'Bill says Daemon is watching.' },
    objects: [],
    observations: [],
  }), null, {
    nowMs: NOW, currentLocation: 'cell', plausibleCastIds: ['bill'],
  }), /FORBIDDEN_OBJECTIVE_FIELD:type/);
});

test('A: valid ambient event is accepted', () => {
  const result = validateAwgCandidate(candidate(), null, { nowMs: NOW });
  assert.equal(result.valid, true);
});

test('B: invalid cast ID is rejected', () => {
  const result = validateAwgCandidate(candidate({ participants: ['invented-prisoner'] }), null, { nowMs: NOW });
  assert.ok(result.errors.includes('UNKNOWN_CAST_ID'));
});

test('C: invalid continuation reference is rejected', () => {
  const result = validateAwgCandidate(candidate({
    decision: 'CONTINUATION',
    thread: { action: 'UPDATE', id: 'missing-thread', summary: 'Nothing real.' },
    continuationOf: { threadId: 'missing-thread', eventIds: ['missing-event'] },
  }), null, { nowMs: NOW });
  assert.ok(result.errors.includes('INVALID_THREAD_REFERENCE'));
  assert.ok(result.errors.includes('INVALID_EVENT_REFERENCE'));
});

test('D: private visitor leakage is rejected', () => {
  const result = validateAwgCandidate(candidate({ secret: 'SENDER_RECALLABLE visitor:12345678' }), null, { nowMs: NOW });
  assert.ok(result.errors.includes('PRIVATE_VISITOR_LEAKAGE'));
});

test('E: emotional or Soma assignment is rejected', () => {
  const result = validateAwgCandidate(candidate({ anxiety: 0.8 }), null, { nowMs: NOW });
  assert.ok(result.errors.includes('FORBIDDEN_MODEL_OUTPUT'));
  const camelCase = validateAwgCandidate(candidate({ brainActivation: 0.8 }), null, { nowMs: NOW });
  assert.ok(camelCase.errors.includes('FORBIDDEN_MODEL_OUTPUT'));
  const freeText = validateAwgCandidate(candidate({
    objective: { eventType: 'bad_assignment', summary: 'threat = .8' },
  }), null, { nowMs: NOW });
  assert.ok(freeText.errors.includes('FORBIDDEN_MODEL_OUTPUT'));
});

test('F: rumour content remains a separately labelled claim', () => {
  const value = candidate({
    eventFamily: 'RUMOUR',
    objective: { eventType: 'rumour_repeated', summary: 'Daemon told Cy a claim about Mr Proctor.' },
    informationClaims: [{ speakerId: 'daemon', content: 'Mr Proctor will be transferred tomorrow.', truthStatus: 'UNKNOWN' }],
  });
  const result = validateAwgCandidate(value, null, { nowMs: NOW });
  assert.equal(result.valid, true);
  assert.equal(result.candidate.informationClaims[0].truthStatus, 'UNKNOWN');
  assert.doesNotMatch(result.candidate.objective.summary, /will be transferred/);
});

test('G: world-only event creates no Cy observation or public trace', () => {
  const value = candidate({
    participants: ['reg', 'daemon'],
    observations: [{ observerId: 'reg', access: 'CAST_ONLY', summary: 'Reg passed a note to Daemon.' }],
    publicTimeline: { eligible: false, text: null },
  });
  const validation = validateAwgCandidate(value, null, { nowMs: NOW });
  const applied = applyAwgCandidate(null, validation, { makeId: (prefix) => `${prefix}-1`, acceptedAt: value.occurredAt });
  applied.validationCandidate = validation.candidate;
  assert.equal(validation.cyObserved, false);
  assert.equal(awgEventToEnvironment(applied).summary, null);
});

test('H: Cy-observed event is convertible to the normal environment path with no emotion assignment', () => {
  const validation = validateAwgCandidate(candidate(), null, { nowMs: NOW });
  const applied = applyAwgCandidate(null, validation, { makeId: (prefix) => `${prefix}-1`, acceptedAt: candidate().occurredAt });
  applied.validationCandidate = validation.candidate;
  const environment = awgEventToEnvironment(applied);
  assert.equal(environment.archetypeId, 'ambient_world_event');
  assert.equal(environment.observation.modality, 'direct');
  assert.equal(Object.hasOwn(environment.world, 'anxiety'), false);
});

test('I: NO_EVENT does not mutate world state', async () => {
  const before = reconcileWorldSimulationState({ threads: [{ id: 't', state: 'OPEN' }] });
  const result = await runAmbientWorldCycle({
    state: before, nowMs: NOW, idleBudgetMs: AWG_MIN_IDLE_BUDGET_MS,
    generate: async () => JSON.stringify({
      decision: 'NO_EVENT',
    }),
    makeId: (prefix) => `${prefix}-1`,
  });
  assert.equal(result.status, 'NO_EVENT');
  assert.deepEqual(result.state.threads, before.threads);
  assert.deepEqual(result.state.objects, before.objects);
  assert.deepEqual(result.state.recentAccepted, before.recentAccepted);
});

test('I2: NO_EVENT still enforces schema, privacy and forbidden-output boundaries', () => {
  const missingSchema = validateAwgCandidate({ decision: 'NO_EVENT' }, null, { nowMs: NOW });
  assert.ok(missingSchema.errors.includes('INVALID_SCHEMA'));
  const privateLeak = validateAwgCandidate({
    schema: AWG_SCHEMA, version: 1, decision: 'NO_EVENT', secret: 'SENDER_RECALLABLE visitor:12345678',
  }, null, { nowMs: NOW });
  assert.ok(privateLeak.errors.includes('PRIVATE_VISITOR_LEAKAGE'));
  const forbidden = validateAwgCandidate({
    schema: AWG_SCHEMA, version: 1, decision: 'NO_EVENT', directive: 'anxiety = 0.8',
  }, null, { nowMs: NOW });
  assert.ok(forbidden.errors.includes('FORBIDDEN_MODEL_OUTPUT'));
});

test('J: an existing thread can continue', () => {
  const openingValidation = validateAwgCandidate(candidate(), null, { nowMs: NOW });
  const opening = applyAwgCandidate(null, openingValidation, { makeId: (prefix) => `${prefix}-1`, acceptedAt: new Date(NOW).toISOString() });
  const later = NOW + AWG_CADENCE_MS;
  const continuation = candidate({
    decision: 'CONTINUATION',
    occurredAt: new Date(later).toISOString(),
    objective: { eventType: 'note_questioned', summary: 'Daemon asked Cy whether the note reached him.' },
    objects: [{ id: 'object-note-1', type: 'note', ownerId: 'reg', holderId: 'cy', location: 'landing', status: 'ACTIVE' }],
    thread: { action: 'RESOLVE', id: 'thread-note-1', type: 'NOTE_AWAITING_DELIVERY', summary: 'Daemon asked about the missing note.', nextEligibleAt: null },
    continuationOf: { threadId: 'thread-note-1', eventIds: ['world-1'] },
  });
  const validation = validateAwgCandidate(continuation, opening.state, { nowMs: later });
  assert.equal(validation.valid, true);
  const result = applyAwgCandidate(opening.state, validation, { makeId: (prefix) => `${prefix}-2`, acceptedAt: continuation.occurredAt });
  assert.equal(result.state.threads[0].state, 'RESOLVED');
});

test('K: duplicate event is rejected within dedupe window', () => {
  const validation = validateAwgCandidate(candidate(), null, { nowMs: NOW });
  const opening = applyAwgCandidate(null, validation, { makeId: (prefix) => `${prefix}-1`, acceptedAt: candidate().occurredAt });
  opening.state.lastAcceptedAt = new Date(NOW - 31 * 60 * 1000).toISOString();
  const duplicate = candidate({ occurredAt: new Date(NOW + 31 * 60 * 1000).toISOString() });
  const result = validateAwgCandidate(duplicate, opening.state, { nowMs: NOW + 31 * 60 * 1000 });
  assert.ok(result.errors.includes('DUPLICATE_EVENT'));
});

test('L: object consistency rejects a confiscated object becoming active', () => {
  const state = reconcileWorldSimulationState({
    objects: [{ id: 'object-note-1', type: 'note', ownerId: 'reg', holderId: null, location: 'officer_desk', status: 'CONFISCATED' }],
  });
  const result = validateAwgCandidate(candidate(), state, { nowMs: NOW });
  assert.ok(result.errors.includes('OBJECT_STATE_CONTRADICTION'));
  const duplicateObject = validateAwgCandidate(candidate({
    objects: [candidate().objects[0], { ...candidate().objects[0], location: 'cell' }],
  }), null, { nowMs: NOW });
  assert.ok(duplicateObject.errors.includes('DUPLICATE_OBJECT_ID'));
});

test('M: AWG failure returns safely and leaves authoritative state unchanged', async () => {
  const before = reconcileWorldSimulationState({ threads: [{ id: 'thread-1', state: 'OPEN' }] });
  const result = await runAmbientWorldCycle({
    state: before, nowMs: NOW, idleBudgetMs: AWG_MIN_IDLE_BUDGET_MS,
    generate: async () => { throw new Error('provider down'); },
  });
  assert.equal(result.status, 'FAILED');
  assert.deepEqual(result.state.threads, before.threads);
  assert.deepEqual(result.state.recentAccepted, before.recentAccepted);
  assert.equal(result.state.lastRunAt, new Date(NOW).toISOString(),
    'a failed attempt records its slot so the 45-minute cadence provides backoff');
  assert.equal(shouldRunAwg(result.state, {
    nowMs: NOW + 1000,
    idleBudgetMs: AWG_MIN_IDLE_BUDGET_MS,
  }).reason, 'CADENCE', 'a failed attempt cannot retry on the next journal quiet');
});

test('M1: cancelled AWG is not parsed or reported as an empty candidate', async () => {
  let clockMs = 0;
  const result = await runAmbientWorldCycle({
    state: null,
    nowMs: NOW,
    idleBudgetMs: AWG_MIN_IDLE_BUDGET_MS,
    clock: () => clockMs += 5,
    generate: async () => { throw new InferenceCancellationError('POSTCARD'); },
  });
  assert.equal(result.status, 'CANCELLED');
  assert.equal(result.run.candidateType, 'CANCELLED');
  assert.equal(result.run.validationStatus, 'NOT_RUN');
  assert.equal(result.run.rejectionReason, 'ABORTED/POSTCARD');
  assert.equal(result.run.validationLatencyMs, 0);
  assert.equal(result.state.lastRunAt, new Date(NOW).toISOString());
  assert.equal(shouldRunAwg(result.state, {
    nowMs: NOW + 1000,
    idleBudgetMs: AWG_MIN_IDLE_BUDGET_MS,
  }).reason, 'CADENCE', 'a cancelled attempt retains ordinary AWG backoff');
});

test('M2: a normal empty AWG response remains an EMPTY_CANDIDATE failure', async () => {
  const result = await runAmbientWorldCycle({
    state: null,
    nowMs: NOW,
    idleBudgetMs: AWG_MIN_IDLE_BUDGET_MS,
    generate: async () => '',
  });
  assert.equal(result.status, 'FAILED');
  assert.equal(result.run.candidateType, 'FAILED');
  assert.equal(result.run.validationStatus, 'FAILED');
  assert.equal(result.run.rejectionReason, 'EMPTY_CANDIDATE');
});

test('N: AWG never runs ahead of higher-priority work', () => {
  const check = shouldRunAwg(null, { nowMs: NOW, idleBudgetMs: AWG_MIN_IDLE_BUDGET_MS, pendingHigherPriority: true });
  assert.deepEqual(check, { run: false, reason: 'HIGHER_PRIORITY_WORK' });
});

test('N1: queued formation work cannot categorically starve an overdue AWG slot', () => {
  const check = shouldRunAwg(null, {
    nowMs: NOW,
    idleBudgetMs: AWG_MIN_IDLE_BUDGET_MS,
    memoryFormationBacklog: 12,
  });
  assert.equal(check.run, true);
  assert.equal(check.reason, 'ELIGIBLE_FAIRNESS_SLOT');
  assert.equal(isAwgDue(null, NOW), true);
});

test('N1b: location and plausible-cast constraints reject impossible Cy-visible events', () => {
  const wrongPlace = validateAwgCandidate(candidate(), null, {
    nowMs: NOW,
    currentLocation: 'cell',
    plausibleCastIds: ['reg'],
  });
  assert.ok(wrongPlace.errors.includes('IMPOSSIBLE_CY_LOCATION'));
  const wrongCast = validateAwgCandidate(candidate({ location: 'cell' }), null, {
    nowMs: NOW,
    currentLocation: 'cell',
    plausibleCastIds: ['bill'],
  });
  assert.ok(wrongCast.errors.includes('IMPOSSIBLE_CAST_AT_LOCATION'));
});

test('N1c: offscreen cell event remains possible while Cy is on the yard', () => {
  const offscreen = candidate({
    eventFamily: 'OFFICER_ACTIVITY',
    participants: ['proctor'],
    location: 'cell',
    objective: { eventType: 'cell_search_initiated', summary: 'Mr Proctor began a search of the empty cell.' },
    objects: [],
    observations: [{ observerId: 'proctor', access: 'CAST_ONLY', summary: 'Mr Proctor entered the empty cell.' }],
    thread: { action: 'NONE' },
    publicTimeline: { eligible: false, text: null },
  });
  const result = validateAwgCandidate(offscreen, null, {
    nowMs: NOW,
    currentLocation: 'exercise_yard',
    plausibleCastIds: ['reg'],
  });
  assert.equal(result.valid, true);
  assert.equal(result.cyObserved, false);
});

test('N2: public timeline eligibility requires a Cy-visible trace', () => {
  const result = validateAwgCandidate(candidate({
    publicTimeline: { eligible: true, text: null },
  }), null, { nowMs: NOW });
  assert.ok(result.errors.includes('PUBLIC_TIMELINE_TEXT_REQUIRED'));
});

test('deterministic note scenario preserves causality, observation and normal memory provenance', () => {
  const openingValue = candidate({
    participants: ['reg', 'daemon'],
    objective: { eventType: 'note_passed_offscreen', summary: 'Reg hid a note intended for Daemon by the landing radiator.' },
    objects: [{ id: 'object-note-1', type: 'note', ownerId: 'reg', holderId: null, location: 'landing', status: 'ACTIVE' }],
    observations: [{ observerId: 'reg', access: 'CAST_ONLY', summary: 'Reg hid the note.' }],
    publicTimeline: { eligible: false, text: null },
  });
  const openingValidation = validateAwgCandidate(openingValue, null, { nowMs: NOW });
  const opening = applyAwgCandidate(null, openingValidation, { makeId: (prefix) => `${prefix}-1`, acceptedAt: openingValue.occurredAt });
  assert.equal(openingValidation.cyObserved, false);
  assert.equal(opening.state.threads[0].state, 'OPEN');

  const later = NOW + AWG_CADENCE_MS;
  const continuationValue = candidate({
    decision: 'CONTINUATION',
    occurredAt: new Date(later).toISOString(),
    objective: { eventType: 'note_found', summary: 'Cy found the folded note by the landing radiator.' },
    thread: { action: 'UPDATE', id: 'thread-note-1', type: 'NOTE_AWAITING_DELIVERY', summary: 'Cy now holds the note intended for Daemon.', nextEligibleAt: null },
    continuationOf: { threadId: 'thread-note-1', eventIds: ['world-1'] },
  });
  const continuationValidation = validateAwgCandidate(continuationValue, opening.state, { nowMs: later });
  assert.equal(continuationValidation.valid, true);
  const continuation = applyAwgCandidate(opening.state, continuationValidation, { makeId: (prefix) => `${prefix}-2`, acceptedAt: continuationValue.occurredAt });
  continuation.validationCandidate = continuationValidation.candidate;
  const environment = awgEventToEnvironment(continuation);
  assert.equal(environment.summary, 'Reg put a folded note into Cy hand.');
  assert.equal(environment.world.context.previous_event_ids[0], 'thread-note-1');
  assert.equal(JSON.stringify(environment).includes('anxiety'), false);
  const memorySource = {
    sourceType: 'environment_event', sourceId: continuation.event.id,
    text: environment.summary, location: environment.world.context.location,
  };
  assert.equal(memorySource.sourceId, 'world-2');
});
