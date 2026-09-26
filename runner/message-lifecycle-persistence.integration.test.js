import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { reconcileWorldSimulationState } from './ambient-world-generator.js';
import { FISHER_MESSAGE_OBJECT_FIXTURES } from './fixtures/fisher-message-objects-20260925.js';
import { startCellSearchEpisode } from './location-regime.js';
import {
  isCurrentMessageObject,
  planLegacyMessageReconciliation,
} from './message-object-lifecycle.js';
import { loadVitals, saveVitals } from './vitals.js';

const RECONCILED_AT = '2026-09-25T20:48:36.799Z';
const OBJECT_IDS = FISHER_MESSAGE_OBJECT_FIXTURES.map((entry) => entry.object.id);
const THREAD_IDS = FISHER_MESSAGE_OBJECT_FIXTURES
  .map((entry) => entry.thread.id)
  .filter((value, index, values) => values.indexOf(value) === index);

function legacyWorld() {
  return reconcileWorldSimulationState({
    objects: [
      ...FISHER_MESSAGE_OBJECT_FIXTURES.map((entry) => structuredClone(entry.object)),
      { id: 'unrelated-object', type: 'permitted_item', status: 'ACTIVE', location: 'cell', holderId: 'cy' },
    ],
    threads: [
      ...THREAD_IDS.map((threadId) => {
        const entry = FISHER_MESSAGE_OBJECT_FIXTURES.find((item) => item.thread.id === threadId);
        return {
          id: threadId, type: 'transfer_request_thread', state: 'OPEN',
          sourceEventIds: FISHER_MESSAGE_OBJECT_FIXTURES
            .filter((item) => item.thread.id === threadId)
            .map((item) => item.object.sourceEventId),
          summary: entry.candidate.objective.summary,
          participants: [...entry.candidate.participants],
          nextEligibleAt: '2026-09-26T00:00:00.000Z', resolution: null,
        };
      }),
      { id: 'unrelated-thread', type: 'SOCIAL_REQUEST', state: 'OPEN', sourceEventIds: ['world-unrelated'] },
    ],
  });
}

function approvedReconciliation(worldValue) {
  const world = structuredClone(worldValue);
  const plans = planLegacyMessageReconciliation(FISHER_MESSAGE_OBJECT_FIXTURES);
  const planById = new Map(plans.map((plan) => [plan.objectId, plan]));
  for (const object of world.objects) {
    const plan = planById.get(object.id);
    if (!plan) continue;
    if (plan.classification === 'UPDATE/MIGRATE') {
      object.message = structuredClone(plan.proposedMessage);
      object.status = 'DELIVERED';
    } else if (plan.classification === 'INVALID HISTORICAL ARTIFACT') {
      object.status = 'RETIRED';
      object.message = {
        schema: 'cy.message-object-state', version: 1,
        senderId: null, recipientId: 'cy', content: null,
        contentTruthStatus: 'UNKNOWN', contentRef: null,
        receiptObservedByCy: false, readState: 'UNREAD', lifecycleState: 'RETIRED',
        threadId: FISHER_MESSAGE_OBJECT_FIXTURES.find((entry) => entry.object.id === object.id).thread.id,
        resolvedAt: null, retiredAt: RECONCILED_AT,
        sourceEventIds: [object.sourceEventId],
        reconciliation: 'INVALID_HISTORICAL_ARTIFACT',
      };
    } else if (plan.classification === 'MERGE INTO EXISTING') {
      object.status = 'RETIRED';
      object.message = {
        schema: 'cy.message-object-state', version: 1,
        senderId: 'fisher', recipientId: 'cy', content: null,
        contentTruthStatus: 'UNKNOWN', contentRef: null,
        receiptObservedByCy: true, readState: 'UNREAD', lifecycleState: 'RETIRED',
        threadId: FISHER_MESSAGE_OBJECT_FIXTURES.find((entry) => entry.object.id === object.id).thread.id,
        resolvedAt: null, retiredAt: RECONCILED_AT,
        sourceEventIds: [object.sourceEventId],
        reconciliation: 'MERGED_INTO_EXISTING', mergedIntoObjectId: plan.targetObjectId,
      };
    }
  }

  for (const thread of world.threads) {
    if (thread.id === THREAD_IDS[0] || thread.id === THREAD_IDS[1]) {
      thread.state = 'RESOLVED';
      thread.nextEligibleAt = null;
      thread.resolution = { at: RECONCILED_AT, reason: 'INVALID_HISTORICAL_MESSAGE_ARTIFACT' };
    } else if (thread.id === THREAD_IDS[2]) {
      thread.type = 'MESSAGE_PASSING';
      thread.state = 'OPEN';
      thread.summary = 'Fisher delivered a message to Cy; the message remains unread.';
    } else if (thread.id === THREAD_IDS[3]) {
      thread.type = 'OBJECT_TRANSFER';
      thread.state = 'OPEN';
      thread.summary = 'Fisher delivered a message to Cy; the message remains unread.';
    }
  }
  return world;
}

function assertApprovedState(world) {
  const messages = world.objects.filter((object) => OBJECT_IDS.includes(object.id));
  const current = messages.filter(isCurrentMessageObject);
  assert.deepEqual(current.map((object) => object.id), [OBJECT_IDS[2], OBJECT_IDS[3]]);
  assert.equal(messages[0].message.lifecycleState, 'RETIRED');
  assert.equal(messages[1].message.lifecycleState, 'RETIRED');
  assert.equal(messages[4].message.lifecycleState, 'RETIRED');
  assert.equal(messages[4].message.mergedIntoObjectId, OBJECT_IDS[2]);
  assert.equal(messages[4].message.reconciliation, 'MERGED_INTO_EXISTING');
  assert.equal(messages[2].message.receiptObservedByCy, false);
  assert.equal(messages[2].message.readState, 'UNREAD');
  assert.equal(messages[2].message.lifecycleState, 'DELIVERED');
  assert.equal(messages[3].message.receiptObservedByCy, true);
  assert.equal(messages[3].message.readState, 'UNREAD');
  assert.equal(messages[3].message.lifecycleState, 'DELIVERED');
  const threads = world.threads.filter((thread) => THREAD_IDS.includes(thread.id));
  assert.deepEqual(threads.map((thread) => thread.state), ['RESOLVED', 'RESOLVED', 'OPEN', 'OPEN']);
  assert.deepEqual(world.objects.find((object) => object.id === 'unrelated-object'), {
    id: 'unrelated-object', type: 'permitted_item', status: 'ACTIVE', location: 'cell', holderId: 'cy',
  });
  assert.equal(world.threads.find((thread) => thread.id === 'unrelated-thread').state, 'OPEN');
}

test('approved five-object reconciliation survives repeated checkpoint and restart cycles', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cy-message-lifecycle-'));
  const path = join(dir, 'vitals.json');
  try {
    let vitals = await loadVitals(path);
    vitals.worldSimulation = approvedReconciliation(legacyWorld());
    assertApprovedState(vitals.worldSimulation);
    await saveVitals(path, vitals);

    vitals = await loadVitals(path);
    vitals.worldSimulation = reconcileWorldSimulationState(vitals.worldSimulation);
    assertApprovedState(vitals.worldSimulation);
    await saveVitals(path, vitals);

    vitals = await loadVitals(path);
    vitals.worldSimulation = reconcileWorldSimulationState(vitals.worldSimulation);
    assertApprovedState(vitals.worldSimulation);

    const search = startCellSearchEpisode({
      schema: 'cy.location-regime', version: 1,
      current: { id: 'CELL' }, searchEpisode: null,
    }, { nowMs: Date.parse('2026-09-26T09:00:00.000Z'), objects: vitals.worldSimulation.objects });
    assert.equal(search.state.searchEpisode.object_id, OBJECT_IDS[2],
      'cell search must skip the earlier retired message artifacts');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
