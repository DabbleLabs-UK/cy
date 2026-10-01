// Revisioned, single-writer projections of runner-created world transitions.
// Delivery IDs identify HTTP attempts; these fields identify logical state.

import { randomUUID } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class WorldMirrorConflictError extends Error {
  constructor(kind, id, reason) {
    super(`${kind} ${id}: ${reason}`);
    this.name = 'WorldMirrorConflictError';
    this.code = 'CY_WORLD_MIRROR_CONFLICT';
    this.kind = kind;
    this.entityId = id;
  }
}

export function worldEntityRevision(entity, { allowLegacy = false } = {}) {
  const revision = entity && entity.revision;
  const transitionId = entity && entity.transitionId;
  if (revision == null && transitionId == null && allowLegacy) return null;
  if (!Number.isSafeInteger(revision) || revision < 1 || !UUID.test(transitionId || '')) {
    throw new WorldMirrorConflictError('entity', entity && entity.id || '?', 'invalid revision or transition ID');
  }
  return { revision, transitionId: transitionId.toLowerCase() };
}

export function advanceWorldEntity(entity, nextId = randomUUID) {
  const old = entity && entity.revision == null && entity.transitionId == null
    ? null : worldEntityRevision(entity);
  const transitionId = nextId();
  if (!UUID.test(transitionId || '')) throw new Error('world transition ID must be a UUID');
  const revision = (old ? old.revision : 0) + 1;
  if (!Number.isSafeInteger(revision)) throw new Error('world revision exhausted');
  return { ...entity, revision, transitionId: transitionId.toLowerCase() };
}

export function compareWorldEntities(kind, local, remote) {
  const id = local?.id || remote?.id || '?';
  if (!local) {
    worldEntityRevision(remote);
    return 'REMOTE';
  }
  if (!remote) {
    worldEntityRevision(local);
    return 'LOCAL';
  }
  const a = worldEntityRevision(local);
  const b = worldEntityRevision(remote);
  const newer = a.revision > b.revision ? local : remote;
  const older = newer === local ? remote : local;
  if (kind === 'thread' && older.state === 'RESOLVED' && newer.state === 'OPEN') {
    throw new WorldMirrorConflictError(kind, id, 'resolved thread reopened');
  }
  if (kind === 'object' && older.status === 'RETIRED' && newer.status !== 'RETIRED') {
    throw new WorldMirrorConflictError(kind, id, 'retired object reactivated');
  }
  if (a.revision > b.revision) return 'LOCAL';
  if (a.revision < b.revision) return 'REMOTE';
  if (a.transitionId !== b.transitionId) {
    throw new WorldMirrorConflictError(kind, id, 'equal revision has different transition IDs');
  }
  const stateField = kind === 'thread' ? 'state' : 'status';
  if (local[stateField] !== remote[stateField]) {
    throw new WorldMirrorConflictError(kind, id, 'same transition has different lifecycle state');
  }
  const semanticFields = kind === 'thread'
    ? ['type', 'summary', 'participants', 'resolution']
    : ['type', 'ownerId', 'holderId', 'location'];
  for (const field of semanticFields) {
    if (JSON.stringify(local[field] ?? null) !== JSON.stringify(remote[field] ?? null)) {
      throw new WorldMirrorConflictError(kind, id, `same transition has different ${field}`);
    }
  }
  // A terminal marker may omit diagnostic message provenance, but it cannot
  // disagree about the message's causal/lifecycle facts.
  if (kind === 'object') {
    const messageFacts = (entity) => {
      if (!entity.message) return null;
      const { schema, version, senderId, recipientId, content,
        contentTruthStatus, contentRef, receiptObservedByCy, readState,
        lifecycleState, threadId, resolvedAt, retiredAt, reconciliation,
        mergedIntoObjectId } = entity.message;
      return { schema, version, senderId, recipientId, content,
        contentTruthStatus, contentRef, receiptObservedByCy, readState,
        lifecycleState, threadId, resolvedAt, retiredAt, reconciliation,
        mergedIntoObjectId };
    };
    if (JSON.stringify(messageFacts(local)) !== JSON.stringify(messageFacts(remote))) {
      throw new WorldMirrorConflictError(kind, id, 'same transition has different message state');
    }
  }
  return 'SAME';
}

function legacyComparable(kind, entity) {
  if (!entity) return null;
  const fields = kind === 'object'
    ? ['id', 'type', 'ownerId', 'holderId', 'location', 'status', 'message', 'visibility', 'sourceEventId']
    : ['id', 'type', 'state', 'summary', 'participants', 'sourceEventIds', 'resolution', 'visibility'];
  return Object.fromEntries(fields.map((key) => [key, entity[key] ?? null]));
}

// Rehearsal only. No production startup path silently invokes this function.
export function baselineLegacyWorldMirror(localWorld, remoteWorld, decisions = {}, nextId = randomUUID) {
  const local = structuredClone(localWorld);
  const remote = structuredClone(remoteWorld);
  const disagreements = [];
  const baseline = { objects: [], terminalObjects: [], threads: [], terminalThreads: [] };
  for (const [kind, key] of [['object', 'objects'], ['thread', 'threads']]) {
    const terminalKey = kind === 'object' ? 'terminalObjects' : 'terminalThreads';
    const left = new Map([...(local[key] || []), ...(local[terminalKey] || [])]
      .map((entity) => [entity.id, entity]));
    const right = new Map([...(remote[key] || []), ...(remote[terminalKey] || [])]
      .map((entity) => [entity.id, entity]));
    for (const id of new Set([...left.keys(), ...right.keys()])) {
      const a = left.get(id);
      const b = right.get(id);
      const same = JSON.stringify(legacyComparable(kind, a)) === JSON.stringify(legacyComparable(kind, b));
      const choice = decisions[`${kind}:${id}`];
      if (!same && !['LOCAL', 'REMOTE'].includes(choice)) {
        disagreements.push({ kind, id, local: legacyComparable(kind, a), remote: legacyComparable(kind, b) });
        continue;
      }
      const selected = same ? a : choice === 'LOCAL' ? a : b;
      if (!selected) throw new Error(`baseline selection is absent for ${kind}:${id}`);
      if (worldEntityRevision(selected, { allowLegacy: true })) {
        throw new Error(`baseline requires legacy entity: ${kind}:${id}`);
      }
      const chosenSide = same || choice === 'LOCAL' ? local : remote;
      const destination = (chosenSide[terminalKey] || []).some((entity) => entity.id === id)
        ? terminalKey : key;
      baseline[destination].push(advanceWorldEntity(selected, nextId));
    }
  }
  return { disagreements, baseline: disagreements.length ? null : baseline };
}

export function compactTerminalThread(thread) {
  if (thread.state !== 'RESOLVED') throw new Error('only resolved threads can be compacted');
  worldEntityRevision(thread);
  return {
    id: thread.id, type: thread.type, state: 'RESOLVED', revision: thread.revision,
    transitionId: thread.transitionId, summary: thread.summary,
    participants: thread.participants || [],
    // The durable environment-event records retain full provenance. Keep only
    // recent references needed to relate this terminal marker to its cause.
    sourceEventIds: (thread.sourceEventIds || []).slice(-8),
    nextEligibleAt: null, resolution: thread.resolution || null,
    visibility: thread.visibility || [], createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  };
}

export function compactTerminalObject(object) {
  if (object.status !== 'RETIRED') throw new Error('only retired objects can be compacted');
  worldEntityRevision(object);
  return {
    id: object.id, type: object.type, status: 'RETIRED',
    revision: object.revision, transitionId: object.transitionId,
    ownerId: object.ownerId ?? null, holderId: object.holderId ?? null,
    location: object.location, sourceEventId: object.sourceEventId,
    updatedAt: object.updatedAt, visibility: object.visibility || [],
    ...(object.message ? { message: {
      ...object.message,
      sourceEventIds: (object.message.sourceEventIds || []).slice(-8),
    } } : {}),
  };
}

export function compactAcknowledgedRetiredObjects(world, events) {
  let compacted = 0;
  for (const event of events) {
    if (event.kind !== 'world_object_record' || event.payload?.status !== 'RETIRED') continue;
    const delivered = event.payload;
    const index = world.objects.findIndex((object) => object.id === delivered.id);
    if (index < 0) continue;
    const current = world.objects[index];
    if (current.status !== 'RETIRED' || current.revision !== delivered.revision
      || current.transitionId !== delivered.transitionId) continue;
    world.terminalObjects ||= [];
    world.terminalObjects.push(compactTerminalObject(current));
    world.objects.splice(index, 1);
    compacted += 1;
  }
  return compacted;
}

export function reconcileWorldMirror(localWorld, remoteWorld) {
  const next = structuredClone(localWorld);
  next.objects ||= [];
  next.terminalObjects ||= [];
  next.threads ||= [];
  next.terminalThreads ||= [];
  const publish = [];
  const adopted = [];
  for (const [kind, key, remoteEntries] of [
    ['object', 'objects', remoteWorld.objects || []],
    ['thread', 'threads', remoteWorld.threads || []],
  ]) {
    const terminalKey = kind === 'thread' ? 'terminalThreads' : 'terminalObjects';
    const localEntries = [...next[key], ...next[terminalKey]];
    const local = new Map(localEntries.map((entry) => [entry.id, entry]));
    const remote = new Map(remoteEntries.map((entry) => [entry.id, entry]));
    if (local.size !== localEntries.length || remote.size !== remoteEntries.length) {
      throw new WorldMirrorConflictError(kind, '?', 'duplicate entity ID in mirror');
    }
    for (const id of new Set([...local.keys(), ...remote.keys()])) {
      const a = local.get(id);
      const b = remote.get(id);
      const choice = compareWorldEntities(kind, a, b);
      if (choice === 'LOCAL') publish.push({ kind, entity: structuredClone(a) });
      if (choice !== 'REMOTE') continue;
      worldEntityRevision(b);
      next[key] = next[key].filter((entry) => entry.id !== id);
      next[terminalKey] = next[terminalKey].filter((entry) => entry.id !== id);
      if (kind === 'thread' && b.state === 'RESOLVED' && !a) {
        next.terminalThreads.push(compactTerminalThread(b));
      } else if (kind === 'object' && b.status === 'RETIRED' && !a) {
        next.terminalObjects.push(compactTerminalObject(b));
      } else {
        next[key].push(structuredClone(b));
      }
      adopted.push({ kind, id });
    }
  }
  return { world: next, publish, adopted };
}

export async function synchronizeWorldMirror(localWorld, transport, persist) {
  const remote = await transport.fetchWorldMirror();
  const plan = reconcileWorldMirror(localWorld, remote);
  if (plan.adopted.length) await persist(plan.world);
  if (plan.publish.length) await transport.republishWorldMirror(plan.publish);
  const verified = reconcileWorldMirror(plan.world, await transport.fetchWorldMirror());
  if (verified.publish.length || verified.adopted.length) {
    throw new Error('world mirror did not converge after reconciliation');
  }
  // Only after the SQL mirror has acknowledged the terminal transition may
  // the checkpoint replace a full retired object with a compact marker.
  plan.world.terminalObjects ||= [];
  const retired = plan.world.objects.filter((object) => object.status === 'RETIRED');
  if (retired.length) {
    plan.world.terminalObjects.push(...retired.map(compactTerminalObject));
    plan.world.objects = plan.world.objects.filter((object) => object.status !== 'RETIRED');
  }
  // A previous adoption save can have failed after changing in-memory state.
  // Reassert durability before opening the world-mutation gate.
  await persist(plan.world);
  return plan.world;
}
