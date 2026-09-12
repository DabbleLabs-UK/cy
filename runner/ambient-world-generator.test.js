import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AWG_CADENCE_MS,
  AWG_MIN_IDLE_BUDGET_MS,
  AWG_SCHEMA,
  applyAwgCandidate,
  awgEventToEnvironment,
  reconcileWorldSimulationState,
  runAmbientWorldCycle,
  shouldRunAwg,
  validateAwgCandidate,
} from './ambient-world-generator.js';

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
    generate: async () => JSON.stringify({ schema: AWG_SCHEMA, version: 1, decision: 'NO_EVENT' }),
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
});

test('N: AWG never runs ahead of higher-priority work', () => {
  const check = shouldRunAwg(null, { nowMs: NOW, idleBudgetMs: AWG_MIN_IDLE_BUDGET_MS, pendingHigherPriority: true });
  assert.deepEqual(check, { run: false, reason: 'HIGHER_PRIORITY_WORK' });
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
