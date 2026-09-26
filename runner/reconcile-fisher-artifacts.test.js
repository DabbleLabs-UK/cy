import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { reconcileWorldSimulationState } from './ambient-world-generator.js';
import { FISHER_MESSAGE_OBJECT_FIXTURES } from './fixtures/fisher-message-objects-20260925.js';
import { isCurrentMessageObject } from './message-object-lifecycle.js';
import { loadVitals, saveVitals } from './vitals.js';
import {
  applyApprovedFisherReconciliation,
  assertApprovedFisherState,
  FISHER_OBJECT_IDS,
  FISHER_THREAD_IDS,
} from './reconcile-fisher-artifacts.mjs';

// A "legacy/resurrected" world: the five message objects all appear current with
// no lifecycle metadata, and every thread is OPEN - i.e. the exact regression.
function resurrectedWorld() {
  return reconcileWorldSimulationState({
    objects: [
      ...FISHER_MESSAGE_OBJECT_FIXTURES.map((entry) => ({
        ...structuredClone(entry.object),
        status: 'DELIVERED',
      })),
      { id: 'unrelated-object', type: 'permitted_item', status: 'ACTIVE', location: 'cell', holderId: 'cy' },
    ],
    threads: [
      ...FISHER_THREAD_IDS.map((id) => ({
        id, type: 'transfer_request_thread', state: 'OPEN', nextEligibleAt: '2026-09-26T00:00:00.000Z',
        sourceEventIds: ['legacy'], participants: ['cy', 'fisher'], resolution: null,
      })),
      { id: 'unrelated-thread', type: 'SOCIAL_REQUEST', state: 'OPEN', sourceEventIds: ['world-unrelated'] },
    ],
  });
}

function reconcileInPlace(world) {
  applyApprovedFisherReconciliation(world);
  return reconcileWorldSimulationState(world);
}

test('reconcile produces the approved five-object/four-thread state from a resurrected world', () => {
  const world = reconcileInPlace(resurrectedWorld());
  assertApprovedFisherState(world);
  const current = world.objects.filter((o) => FISHER_OBJECT_IDS.includes(o.id)).filter(isCurrentMessageObject);
  assert.deepEqual(current.map((o) => o.id), [FISHER_OBJECT_IDS[2], FISHER_OBJECT_IDS[3]]);
});

test('reconcile is idempotent (running twice yields identical world)', () => {
  const once = reconcileInPlace(resurrectedWorld());
  const twice = reconcileInPlace(structuredClone(once));
  assertApprovedFisherState(twice);
  assert.deepEqual(twice, once);
});

test('reconcile leaves unrelated objects and threads untouched', () => {
  const world = reconcileInPlace(resurrectedWorld());
  assert.deepEqual(world.objects.find((o) => o.id === 'unrelated-object'), {
    id: 'unrelated-object', type: 'permitted_item', status: 'ACTIVE', location: 'cell', holderId: 'cy',
  });
  assert.equal(world.threads.find((t) => t.id === 'unrelated-thread').state, 'OPEN');
});

test('reconcile clears a stale resolution left on an OPEN (current-message) thread', () => {
  // Reproduces the production drift: the current-message thread was set OPEN but
  // kept a resolution from a pre-reconciliation event, so it settled on RESOLVED.
  const base = resurrectedWorld();
  const staleThread = base.threads.find((t) => t.id === FISHER_THREAD_IDS[2]);
  staleThread.state = 'RESOLVED';
  staleThread.resolution = { at: '2026-09-26T14:18:58.639Z', eventId: 'world-de5387a4', summary: 'Cy reads a message.' };
  const world = reconcileInPlace(base);
  assertApprovedFisherState(world);
  const fixed = world.threads.find((t) => t.id === FISHER_THREAD_IDS[2]);
  assert.equal(fixed.state, 'OPEN');
  assert.equal(fixed.resolution, null);
});

test('reconciled state survives the real save/load/reconcile/restart path', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cy-fisher-reconcile-'));
  const path = join(dir, 'vitals.json');
  try {
    let vitals = await loadVitals(path);
    vitals.worldSimulation = reconcileInPlace(resurrectedWorld());
    assertApprovedFisherState(vitals.worldSimulation);
    await saveVitals(path, vitals);

    // reload -> ordinary runner reconcile -> checkpoint again
    vitals = await loadVitals(path);
    vitals.worldSimulation = reconcileWorldSimulationState(vitals.worldSimulation);
    assertApprovedFisherState(vitals.worldSimulation);
    await saveVitals(path, vitals);

    // restart -> reload -> still correct
    vitals = await loadVitals(path);
    vitals.worldSimulation = reconcileWorldSimulationState(vitals.worldSimulation);
    assertApprovedFisherState(vitals.worldSimulation);

    // merge provenance and WORLD_ONLY boundary survived every stage
    const byId = new Map(vitals.worldSimulation.objects.map((o) => [o.id, o]));
    assert.equal(byId.get(FISHER_OBJECT_IDS[4]).message.mergedIntoObjectId, FISHER_OBJECT_IDS[2]);
    assert.equal(byId.get(FISHER_OBJECT_IDS[4]).message.reconciliation, 'MERGED_INTO_EXISTING');
    assert.equal(byId.get(FISHER_OBJECT_IDS[2]).message.receiptObservedByCy, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
