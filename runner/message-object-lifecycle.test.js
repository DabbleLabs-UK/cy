import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AWG_SCHEMA,
  applyAwgCandidate,
  awgEventToEnvironment,
  reconcileWorldSimulationState,
  selectAwgGenerationFacts,
  validateAwgCandidate,
} from './ambient-world-generator.js';
import { FISHER_MESSAGE_OBJECT_FIXTURES } from './fixtures/fisher-message-objects-20260925.js';
import {
  isCurrentMessageObject,
  planLegacyMessageReconciliation,
} from './message-object-lifecycle.js';

const START = Date.parse('2026-09-25T10:00:00.000Z');

function messageCandidate({
  nowMs = START,
  objectId = 'message-1',
  action = 'DELIVER',
  participants = ['fisher', 'cy'],
  observations = [{ observerId: 'cy', access: 'CY_DIRECT', summary: 'Cy received a folded message from Fisher.' }],
  claims = [{ speakerId: 'fisher', content: 'Association is cancelled after lunch.', truthStatus: 'TRUE' }],
  decision = 'EVENT',
  thread = { action: 'NONE', id: null, type: null, summary: null, nextEligibleAt: null },
  continuationOf = null,
  objective = { eventType: 'message_delivery', summary: 'Fisher delivered a folded message to Cy.' },
} = {}) {
  return {
    schema: AWG_SCHEMA,
    version: 1,
    decision,
    eventFamily: 'MESSAGE_PASSING',
    participants,
    location: 'cell',
    occurredAt: new Date(nowMs).toISOString(),
    objective,
    objects: [{
      id: objectId,
      type: 'message',
      ownerId: 'fisher',
      holderId: action === 'CREATE' ? 'fisher' : 'cy',
      location: 'cell',
      status: action === 'CREATE' ? 'ACTIVE' : action === 'RETIRE' ? 'RETIRED' : 'DELIVERED',
      messageAction: {
        action,
        senderId: 'fisher',
        recipientId: 'cy',
        contentClaimIndex: ['CREATE', 'DELIVER'].includes(action) ? 0 : null,
      },
    }],
    observations,
    informationClaims: claims,
    resolved: ['NONE', 'RESOLVE'].includes(thread.action),
    thread,
    continuationOf,
    publicTimeline: {
      eligible: observations.some((entry) => entry.observerId === 'cy'),
      text: observations.some((entry) => entry.observerId === 'cy') ? '[Cy received a folded message]' : null,
    },
  };
}

function validate(candidate, state = null, nowMs = Date.parse(candidate.occurredAt)) {
  return validateAwgCandidate(candidate, state, {
    nowMs,
    currentLocation: 'cell',
    plausibleCastIds: ['fisher'],
  });
}

function accept(candidate, state = null, suffix = '1') {
  const validation = validate(candidate, state);
  assert.equal(validation.valid, true, validation.errors.join(','));
  return applyAwgCandidate(state, validation, {
    makeId: (prefix) => `${prefix}-${suffix}`,
    acceptedAt: candidate.occurredAt,
  });
}

test('spurious physical message creation is rejected', () => {
  const value = messageCandidate({
    objective: { eventType: 'social_check', summary: 'Fisher asked whether Cy was all right.' },
  });
  value.eventFamily = 'SOCIAL_REQUEST';
  const result = validate(value);
  assert.ok(result.errors.includes('SPURIOUS_MESSAGE_OBJECT_CREATION'));
});

test('WORLD_ONLY delivery persists possession without granting Cy receipt or content knowledge', () => {
  const value = messageCandidate({
    participants: ['fisher'],
    observations: [{ observerId: 'world', access: 'WORLD_ONLY', summary: 'Fisher put a folded message in the cell.' }],
  });
  const applied = accept(value);
  const object = applied.state.objects[0];
  assert.equal(object.holderId, 'cy');
  assert.equal(object.message.lifecycleState, 'DELIVERED');
  assert.equal(object.message.receiptObservedByCy, false);
  assert.equal(object.message.readState, 'UNREAD');
  const environment = awgEventToEnvironment({ ...applied, validationCandidate: value });
  assert.equal(environment.observation.modality, 'none');
  assert.deepEqual(environment.observation.observed_facts, {});
});

test('observed delivery records receipt but content remains unknown until a grounded read', () => {
  const leakedAtDelivery = messageCandidate({
    observations: [{
      observerId: 'cy', access: 'CY_DIRECT',
      summary: 'Cy learned that association is cancelled after lunch.',
    }],
  });
  assert.ok(validate(leakedAtDelivery).errors.includes('MESSAGE_CONTENT_KNOWLEDGE_WITHOUT_READ'));

  const delivered = accept(messageCandidate());
  const object = delivered.state.objects[0];
  assert.equal(object.message.receiptObservedByCy, true);
  assert.equal(object.message.readState, 'UNREAD');
  assert.deepEqual(awgEventToEnvironment({ ...delivered }).observation.observed_facts.information_claims, []);

  const readAt = START + 31 * 60 * 1000;
  const read = messageCandidate({
    nowMs: readAt,
    action: 'READ',
    participants: ['cy'],
    claims: [],
    observations: [{ observerId: 'cy', access: 'CY_DIRECT', summary: 'Cy unfolded and read the message.' }],
    objective: { eventType: 'message_read', summary: 'Cy read the message from Fisher.' },
  });
  const readApplied = accept(read, delivered.state, '2');
  assert.equal(readApplied.state.objects[0].message.lifecycleState, 'READ');
  assert.equal(readApplied.state.objects[0].message.readState, 'READ');
  const environment = awgEventToEnvironment({ ...readApplied });
  assert.equal(environment.observation.observed_facts.information_claims[0].content,
    'Association is cancelled after lunch.');
});

test('resolved and retired messages leave current AWG context without deleting provenance', () => {
  const delivered = accept(messageCandidate());
  const readAt = START + 31 * 60 * 1000;
  const readApplied = accept(messageCandidate({
    nowMs: readAt, action: 'READ', participants: ['cy'], claims: [],
    observations: [{ observerId: 'cy', access: 'CY_DIRECT', summary: 'Cy read the message.' }],
    objective: { eventType: 'message_read', summary: 'Cy read the message.' },
  }), delivered.state, '2');
  const resolvedAt = readAt + 31 * 60 * 1000;
  const resolved = accept(messageCandidate({
    nowMs: resolvedAt, action: 'RESOLVE', participants: ['cy'], claims: [],
    observations: [{ observerId: 'cy', access: 'CY_DIRECT', summary: 'Cy no longer needed the message.' }],
    objective: { eventType: 'message_resolved', summary: 'Cy finished with the message.' },
  }), readApplied.state, '3');
  const object = resolved.state.objects[0];
  assert.equal(object.message.lifecycleState, 'RESOLVED');
  assert.equal(isCurrentMessageObject(object), false);
  assert.equal(selectAwgGenerationFacts(resolved.state, {
    plausibleCastIds: ['fisher'], currentLocation: 'cell', nowMs: resolvedAt,
  }).objects.length, 0);
  assert.equal(object.message.sourceEventIds.length, 3);
  assert.equal(resolved.state.objects.length, 1, 'historical object state must not be deleted');

  const retiredAt = resolvedAt + 31 * 60 * 1000;
  const retired = accept(messageCandidate({
    nowMs: retiredAt, action: 'RETIRE', participants: ['cy'], claims: [],
    observations: [{ observerId: 'cy', access: 'CY_DIRECT', summary: 'Cy discarded the finished message.' }],
    objective: { eventType: 'message_retired', summary: 'Cy removed the finished message from his current possessions.' },
  }), resolved.state, '4');
  assert.equal(retired.state.objects[0].status, 'RETIRED');
  assert.equal(retired.state.objects[0].message.lifecycleState, 'RETIRED');
  assert.equal(retired.state.objects[0].message.retiredAt, new Date(retiredAt).toISOString());
  assert.equal(retired.state.objects[0].message.sourceEventIds.length, 4);
});

test('continuation advances an associated message instead of creating a duplicate object', () => {
  const threadId = 'thread-message-1';
  const state = reconcileWorldSimulationState({
    threads: [{
      id: threadId, type: 'MESSAGE_PASSING', state: 'OPEN', participants: ['fisher', 'cy'],
      sourceEventIds: ['world-origin'], nextEligibleAt: null,
    }],
    objects: [{
      id: 'message-1', type: 'message', ownerId: 'fisher', holderId: 'cy', location: 'cell', status: 'DELIVERED',
      sourceEventId: 'world-origin', updatedAt: new Date(START - 60_000).toISOString(),
      message: {
        schema: 'cy.message-object-state', version: 1, senderId: 'fisher', recipientId: 'cy',
        content: 'Association is cancelled after lunch.', contentTruthStatus: 'TRUE',
        contentRef: { eventId: 'world-origin', claimIndex: 0 }, receiptObservedByCy: true,
        readState: 'UNREAD', lifecycleState: 'DELIVERED', threadId,
        resolvedAt: null, retiredAt: null, sourceEventIds: ['world-origin'],
      },
    }],
  });
  const nowMs = START + 31 * 60 * 1000;
  const duplicate = messageCandidate({
    nowMs, objectId: 'message-new', decision: 'CONTINUATION', participants: ['cy', 'fisher'],
    thread: { action: 'UPDATE', id: threadId, type: 'MESSAGE_PASSING', summary: 'The message was read.', nextEligibleAt: null },
    continuationOf: { threadId, eventIds: ['world-origin'] },
  });
  const duplicateValidation = validate(duplicate, state, nowMs);
  assert.ok(duplicateValidation.errors.includes('MESSAGE_CONTINUATION_MUST_UPDATE_EXISTING'));

  const update = messageCandidate({
    nowMs, objectId: 'message-1', action: 'READ', decision: 'CONTINUATION', participants: ['cy'], claims: [],
    observations: [{ observerId: 'cy', access: 'CY_DIRECT', summary: 'Cy read the existing message.' }],
    objective: { eventType: 'message_read', summary: 'Cy read the existing message.' },
    thread: { action: 'UPDATE', id: threadId, type: 'MESSAGE_PASSING', summary: 'Cy read the message.', nextEligibleAt: null },
    continuationOf: { threadId, eventIds: ['world-origin'] },
  });
  const applied = accept(update, state, 'continuation');
  assert.equal(applied.state.objects.length, 1);
  assert.equal(applied.state.objects[0].message.lifecycleState, 'READ');
});

test('distinct genuine messages can coexist and reconciliation never truncates durable objects', () => {
  const first = accept(messageCandidate({ objectId: 'message-a' }));
  const second = accept(messageCandidate({
    nowMs: START + 31 * 60 * 1000,
    objectId: 'message-b',
    claims: [{ speakerId: 'fisher', content: 'The library list changed.', truthStatus: 'TRUE' }],
    objective: { eventType: 'message_delivery', summary: 'Fisher delivered a second distinct message to Cy.' },
  }), first.state, '2');
  assert.deepEqual(second.state.objects.map((object) => object.id), ['message-a', 'message-b']);

  const many = Array.from({ length: 105 }, (_, index) => ({
    id: `note-${index}`, type: 'note', ownerId: 'cy', holderId: 'cy',
    location: 'cell', status: 'ACTIVE',
  }));
  assert.equal(reconcileWorldSimulationState({ objects: many }).objects.length, 105);
});

test('the five production Fisher artifacts receive deterministic non-mutating reconciliation plans', () => {
  const before = JSON.stringify(FISHER_MESSAGE_OBJECT_FIXTURES);
  const plans = planLegacyMessageReconciliation(FISHER_MESSAGE_OBJECT_FIXTURES);
  assert.deepEqual(plans.map((plan) => plan.classification), [
    'INVALID HISTORICAL ARTIFACT',
    'INVALID HISTORICAL ARTIFACT',
    'UPDATE/MIGRATE',
    'UPDATE/MIGRATE',
    'MERGE INTO EXISTING',
  ]);
  assert.equal(plans[2].proposedMessage.receiptObservedByCy, false);
  assert.equal(plans[3].proposedMessage.receiptObservedByCy, true);
  assert.equal(plans[4].targetObjectId, FISHER_MESSAGE_OBJECT_FIXTURES[2].object.id);
  assert.equal(plans[4].proposedMessage.content,
    FISHER_MESSAGE_OBJECT_FIXTURES[2].candidate.informationClaims[0].content);
  assert.equal(JSON.stringify(FISHER_MESSAGE_OBJECT_FIXTURES), before, 'dry run must not mutate production fixtures');
});
