import assert from 'node:assert/strict';
import test from 'node:test';

import {
  advanceWorldEntity,
  baselineLegacyWorldMirror,
  compactAcknowledgedRetiredObjects,
  compactTerminalObject,
  compactTerminalThread,
  compareWorldEntities,
  reconcileWorldMirror,
  synchronizeWorldMirror,
  worldEntityRevision,
} from './world-mirror.js';

const ids = [1, 2, 3, 4, 5].map((n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`);
const object = (revision, status = 'ACTIVE') => ({
  id: 'object:x', type: 'permitted_item', ownerId: 'cy', holderId: 'cy',
  location: 'cell', status, visibility: [], sourceEventId: 'world:x',
  updatedAt: '2026-10-01T12:00:00.000Z', revision, transitionId: ids[revision - 1],
});
const thread = (revision, state = 'OPEN') => ({
  id: 'thread:x', type: 'OBJECT_TRANSFER', state, summary: 'A matter concerning the item',
  participants: ['cy'], sourceEventIds: ['world:x'], nextEligibleAt: null,
  resolution: state === 'RESOLVED' ? { at: '2026-10-01T12:00:00.000Z' } : null,
  visibility: [], createdAt: '2026-10-01T11:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z', revision,
  transitionId: `00000000-0000-4000-8001-${String(revision).padStart(12, '0')}`,
});
const world = (o, t) => ({ objects: o ? [o] : [], threads: t ? [t] : [], terminalThreads: [] });

test('new transition advances exactly once and republishing preserves identity', () => {
  const first = advanceWorldEntity({ id: 'object:x', status: 'ACTIVE' }, () => ids[0]);
  assert.deepEqual(worldEntityRevision(first), { revision: 1, transitionId: ids[0] });
  const second = advanceWorldEntity(first, () => ids[1]);
  assert.equal(second.revision, 2);
  assert.equal(second.transitionId, ids[1]);
  assert.equal(compareWorldEntities('object', second, structuredClone(second)), 'SAME');
  const sameContent = advanceWorldEntity(second, () => ids[2]);
  assert.equal(sameContent.status, second.status);
  assert.equal(sameContent.revision, 3);
  assert.notEqual(sameContent.transitionId, second.transitionId);
  assert.throws(() => worldEntityRevision({ ...first, revision: 0 }), /invalid revision/);
  assert.throws(() => worldEntityRevision({ ...first, transitionId: 'bad' }), /invalid revision/);
});

test('both crash orders choose the higher version, not the timestamp', () => {
  const localAhead = reconcileWorldMirror(world(object(2, 'RETIRED'), thread(2, 'RESOLVED')),
    world(object(1), thread(1)));
  assert.deepEqual(localAhead.publish.map((item) => item.kind), ['object', 'thread']);
  const sqlAhead = reconcileWorldMirror(world(object(1), thread(1)),
    world(object(2, 'RETIRED'), thread(2, 'RESOLVED')));
  assert.deepEqual(sqlAhead.adopted.map((item) => item.kind), ['object', 'thread']);
  assert.equal(sqlAhead.world.objects[0].status, 'RETIRED');
  assert.equal(sqlAhead.world.threads[0].state, 'RESOLVED');
});

test('stale replay and equal-version conflict never reverse a terminal state', () => {
  assert.equal(compareWorldEntities('object', object(2, 'RETIRED'), object(1)), 'LOCAL');
  assert.equal(compareWorldEntities('thread', thread(1), thread(2, 'RESOLVED')), 'REMOTE');
  assert.throws(() => compareWorldEntities('object', object(2),
    { ...object(2), transitionId: ids[4] }), /different transition IDs/);
  assert.throws(() => compareWorldEntities('object', object(2),
    { ...object(2), holderId: 'officer' }), /different holderId/);
  assert.throws(() => compareWorldEntities('object', object(2, 'RETIRED'), object(3)),
    /retired object reactivated/);
  assert.throws(() => compareWorldEntities('thread', thread(2, 'RESOLVED'), thread(3)),
    /resolved thread reopened/);
});

test('compacted resolved thread keeps its version and usable terminal marker', () => {
  const marker = compactTerminalThread({ ...thread(2, 'RESOLVED'),
    sourceEventIds: Array.from({ length: 100 }, (_, index) => `world:${index}`) });
  assert.equal(marker.revision, 2);
  assert.equal(marker.state, 'RESOLVED');
  assert.equal(marker.sourceEventIds.length, 8);
  const plan = reconcileWorldMirror({ objects: [], threads: [], terminalThreads: [marker] },
    world(null, thread(1)));
  assert.equal(plan.publish[0].entity.state, 'RESOLVED');
});

test('acknowledged retired object can compact without stale resurrection', () => {
  const retired = { ...object(2, 'RETIRED'), message: {
    schema: 'message-object', version: 1, senderId: 'fisher', recipientId: 'cy',
    content: 'A note', contentTruthStatus: 'KNOWN', contentRef: null,
    receiptObservedByCy: true, readState: 'UNREAD', lifecycleState: 'RETIRED',
    threadId: 'thread:x', resolvedAt: null, retiredAt: '2026-10-01T12:00:00.000Z',
    sourceEventIds: Array.from({ length: 100 }, (_, index) => `world:${index}`),
  } };
  const marker = compactTerminalObject(retired);
  assert.equal(marker.revision, 2);
  assert.equal(marker.message.sourceEventIds.length, 8);
  assert.equal(compareWorldEntities('object', marker, retired), 'SAME');
  const plan = reconcileWorldMirror({ objects: [], terminalObjects: [marker],
    threads: [], terminalThreads: [] }, world(object(1), null));
  assert.equal(plan.publish.length, 1);
  assert.equal(plan.publish[0].entity.status, 'RETIRED');
  assert.throws(() => compareWorldEntities('object', marker, object(3)), /retired object reactivated/);
});

test('only acknowledgement of the current terminal transition compacts an object', () => {
  const state = world(object(2, 'RETIRED'), null);
  assert.equal(compactAcknowledgedRetiredObjects(state, [
    { kind: 'world_object_record', payload: object(1) },
  ]), 0);
  assert.equal(state.objects.length, 1);
  assert.equal(compactAcknowledgedRetiredObjects(state, [
    { kind: 'world_object_record', payload: object(2, 'RETIRED') },
  ]), 1);
  assert.equal(state.objects.length, 0);
  assert.equal(state.terminalObjects[0].revision, 2);
  assert.equal(compactAcknowledgedRetiredObjects(state, [
    { kind: 'world_object_record', payload: object(2, 'RETIRED') },
  ]), 0);
  assert.equal(state.terminalObjects.length, 1);
});

test('legacy migration rehearsal reports disagreement and needs explicit choice', () => {
  const local = world({ id: 'object:x', status: 'RETIRED' }, null);
  const remote = world({ id: 'object:x', status: 'ACTIVE' }, null);
  const report = baselineLegacyWorldMirror(local, remote);
  assert.equal(report.baseline, null);
  assert.equal(report.disagreements.length, 1);
  const approved = baselineLegacyWorldMirror(local, remote, { 'object:object:x': 'LOCAL' }, () => ids[0]);
  assert.equal(approved.baseline.objects[0].status, 'RETIRED');
  assert.equal(approved.baseline.objects[0].revision, 1);
  assert.equal(approved.baseline.objects[0].transitionId, ids[0]);
  assert.throws(() => compareWorldEntities('object', approved.baseline.objects[0], remote.objects[0]),
    /invalid revision/);
  const terminalLegacy = { objects: [], terminalObjects: [{ id: 'object:terminal',
    status: 'RETIRED' }], threads: [], terminalThreads: [] };
  const terminalReport = baselineLegacyWorldMirror(terminalLegacy,
    { objects: [], threads: [] }, { 'object:object:terminal': 'LOCAL' }, () => ids[1]);
  assert.equal(terminalReport.baseline.terminalObjects[0].revision, 1);
  assert.equal(terminalReport.baseline.objects.length, 0);
});

test('repeated reconciliation survives crash before and after SQL publication', async () => {
  let checkpoint = world(object(2, 'RETIRED'), thread(2, 'RESOLVED'));
  let sql = world(object(1), thread(1));
  let failOnce = true;
  const transport = {
    async fetchWorldMirror() { return structuredClone(sql); },
    async republishWorldMirror(records) {
      if (failOnce) { failOnce = false; throw new Error('crash before SQL commit'); }
      for (const record of records) {
        const key = record.kind === 'object' ? 'objects' : 'threads';
        sql[key] = [structuredClone(record.entity)];
      }
    },
  };
  await assert.rejects(() => synchronizeWorldMirror(checkpoint, transport, async () => {}),
    /crash before SQL commit/);
  checkpoint = await synchronizeWorldMirror(checkpoint, transport, async (next) => { checkpoint = next; });
  assert.equal(reconcileWorldMirror(checkpoint, sql).publish.length, 0);
  checkpoint = world(object(1), thread(1));
  let saveFailed = true;
  await assert.rejects(() => synchronizeWorldMirror(checkpoint, transport, async () => {
    if (saveFailed) { saveFailed = false; throw new Error('crash before checkpoint commit'); }
  }), /crash before checkpoint commit/);
  checkpoint = await synchronizeWorldMirror(checkpoint, transport, async (next) => { checkpoint = next; });
  assert.equal(checkpoint.objects.length, 0);
  assert.equal(checkpoint.terminalObjects[0].status, 'RETIRED');
  assert.equal(checkpoint.threads[0].state, 'RESOLVED');
});

test('unavailable SQL leaves checkpoint untouched and later reconnect releases reconciliation', async () => {
  const checkpoint = world(object(2, 'RETIRED'), thread(2, 'RESOLVED'));
  const sql = world(object(1), thread(1));
  let online = false;
  let saves = 0;
  const transport = {
    async fetchWorldMirror() {
      if (!online) throw new Error('mirror offline');
      return structuredClone(sql);
    },
    async republishWorldMirror(records) {
      for (const record of records) {
        sql[record.kind === 'object' ? 'objects' : 'threads'] = [structuredClone(record.entity)];
      }
    },
  };
  await assert.rejects(() => synchronizeWorldMirror(checkpoint, transport,
    async () => { saves += 1; }), /mirror offline/);
  assert.equal(saves, 0);
  assert.equal(checkpoint.objects[0].status, 'RETIRED');
  online = true;
  const restored = await synchronizeWorldMirror(checkpoint, transport,
    async () => { saves += 1; });
  assert.equal(restored.terminalObjects[0].revision, 2);
  assert.equal(reconcileWorldMirror(restored, sql).publish.length, 0);
  assert.equal(saves, 1);
});
