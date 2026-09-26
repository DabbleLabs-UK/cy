// reconcile-fisher-artifacts.mjs
//
// Deterministic, idempotent re-application of the reviewed reconciliation for the
// five known Fisher message artifacts and their four threads onto a live
// vitals.json checkpoint. This repairs a checkpoint whose sectioned persistence
// resurrected pre-reconciliation state; the message-lifecycle-persistence fix then
// keeps the corrected state authoritative across subsequent checkpoints/restarts.
//
// It touches ONLY the five known objects and their four threads (matched by id).
// Every other object, thread and field in the ~50MB world is preserved verbatim.
//
// Usage:
//   node reconcile-fisher-artifacts.mjs <path/to/vitals.json>            # dry-run (default)
//   node reconcile-fisher-artifacts.mjs <path/to/vitals.json> --apply    # write (backs up first)
//   node reconcile-fisher-artifacts.mjs <path/to/vitals.json> --apply --no-backup
//
// Dry-run writes nothing; it reports the intended before/after and runs the same
// approved-state assertion the regression test uses. --apply refuses to write
// unless every one of the five objects is present and the resulting state passes
// that assertion.

import { cp, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

import { reconcileWorldSimulationState } from './ambient-world-generator.js';
import { FISHER_MESSAGE_OBJECT_FIXTURES } from './fixtures/fisher-message-objects-20260925.js';
import {
  isCurrentMessageObject,
  planLegacyMessageReconciliation,
} from './message-object-lifecycle.js';
import { loadVitals, saveVitals } from './vitals.js';

// Canonical reconciliation instant, matching the reviewed decision of 2026-09-25.
// Used only where a live record carries no existing terminal timestamp, so that
// re-running the tool is idempotent and never rewrites genuine provenance.
export const CANONICAL_RECONCILED_AT = '2026-09-25T20:48:36.799Z';

const MESSAGE_SCHEMA = 'cy.message-object-state';
const MESSAGE_VERSION = 1;

function fixtureByObjectId() {
  return new Map(FISHER_MESSAGE_OBJECT_FIXTURES.map((entry) => [entry.object.id, entry]));
}

function orderedThreadIds() {
  const ids = [];
  for (const entry of FISHER_MESSAGE_OBJECT_FIXTURES) {
    const id = entry.thread && entry.thread.id;
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export const FISHER_OBJECT_IDS = FISHER_MESSAGE_OBJECT_FIXTURES.map((entry) => entry.object.id);
export const FISHER_THREAD_IDS = orderedThreadIds();

// Classify the five objects deterministically and describe the intended thread
// end-state, derived purely from the reviewed fixtures + reconciliation plan.
export function buildFisherReconciliationPlan() {
  const plans = planLegacyMessageReconciliation(FISHER_MESSAGE_OBJECT_FIXTURES);
  const planByObjectId = new Map(plans.map((plan) => [plan.objectId, plan]));
  const entryByObjectId = fixtureByObjectId();

  // A thread stays OPEN if it carries a migrated (current) message; otherwise its
  // only artifacts are invalid and the thread is RESOLVED.
  const threadHasCurrent = new Map();
  const threadEventFamily = new Map();
  for (const entry of FISHER_MESSAGE_OBJECT_FIXTURES) {
    const threadId = entry.thread && entry.thread.id;
    if (!threadId) continue;
    const plan = planByObjectId.get(entry.object.id);
    if (plan && plan.classification === 'UPDATE/MIGRATE') {
      threadHasCurrent.set(threadId, true);
      const family = entry.candidate && entry.candidate.eventFamily;
      if (family) threadEventFamily.set(threadId, family);
    } else if (!threadHasCurrent.has(threadId)) {
      threadHasCurrent.set(threadId, threadHasCurrent.get(threadId) || false);
    }
  }

  return { planByObjectId, entryByObjectId, threadHasCurrent, threadEventFamily };
}

function retiredMessage({ threadId, sourceEventId, reconciliation, extra = {}, existing }) {
  return {
    schema: MESSAGE_SCHEMA,
    version: MESSAGE_VERSION,
    senderId: extra.senderId ?? null,
    recipientId: extra.recipientId ?? 'cy',
    content: null,
    contentTruthStatus: 'UNKNOWN',
    contentRef: null,
    receiptObservedByCy: extra.receiptObservedByCy ?? false,
    readState: 'UNREAD',
    lifecycleState: 'RETIRED',
    threadId: threadId || null,
    resolvedAt: null,
    retiredAt: (existing && existing.retiredAt) || CANONICAL_RECONCILED_AT,
    sourceEventIds: [sourceEventId].filter(Boolean),
    reconciliation,
    ...(extra.mergedIntoObjectId ? { mergedIntoObjectId: extra.mergedIntoObjectId } : {}),
  };
}

// Apply the reviewed reconciliation to a world value. Returns a new world (deep
// clone via reconcileWorldSimulationState at the call site); mutates only the five
// known objects and four known threads matched by id.
export function applyApprovedFisherReconciliation(world) {
  const { planByObjectId, entryByObjectId, threadHasCurrent, threadEventFamily } = buildFisherReconciliationPlan();
  const changes = { objects: [], threads: [], missingObjects: [], missingThreads: [] };

  const objects = Array.isArray(world.objects) ? world.objects : [];
  const foundObjectIds = new Set();
  for (const object of objects) {
    if (!object || !planByObjectId.has(object.id)) continue;
    foundObjectIds.add(object.id);
    const plan = planByObjectId.get(object.id);
    const entry = entryByObjectId.get(object.id);
    const threadId = entry && entry.thread && entry.thread.id;
    const sourceEventId = (entry && entry.object && entry.object.sourceEventId) || object.sourceEventId;
    const before = { status: object.status, lifecycleState: object.message && object.message.lifecycleState };

    if (plan.classification === 'UPDATE/MIGRATE') {
      object.status = 'DELIVERED';
      object.message = structuredClone(plan.proposedMessage);
    } else if (plan.classification === 'INVALID HISTORICAL ARTIFACT') {
      object.status = 'RETIRED';
      object.message = retiredMessage({
        threadId, sourceEventId,
        reconciliation: 'INVALID_HISTORICAL_ARTIFACT',
        existing: object.message,
      });
    } else if (plan.classification === 'MERGE INTO EXISTING') {
      object.status = 'RETIRED';
      object.message = retiredMessage({
        threadId, sourceEventId,
        reconciliation: 'MERGED_INTO_EXISTING',
        extra: { senderId: 'fisher', receiptObservedByCy: true, mergedIntoObjectId: plan.targetObjectId },
        existing: object.message,
      });
    }
    changes.objects.push({
      id: object.id, classification: plan.classification,
      before, after: { status: object.status, lifecycleState: object.message.lifecycleState },
    });
  }
  for (const id of FISHER_OBJECT_IDS) {
    if (!foundObjectIds.has(id)) changes.missingObjects.push(id);
  }

  const threads = Array.isArray(world.threads) ? world.threads : [];
  const foundThreadIds = new Set();
  for (const thread of threads) {
    if (!thread || !FISHER_THREAD_IDS.includes(thread.id)) continue;
    foundThreadIds.add(thread.id);
    const before = { state: thread.state, type: thread.type };
    if (threadHasCurrent.get(thread.id)) {
      thread.type = threadEventFamily.get(thread.id) || thread.type;
      thread.state = 'OPEN';
      thread.summary = 'Fisher delivered a message to Cy; the message remains unread.';
    } else {
      thread.state = 'RESOLVED';
      thread.nextEligibleAt = null;
      thread.resolution = {
        at: (thread.resolution && thread.resolution.at) || CANONICAL_RECONCILED_AT,
        reason: 'INVALID_HISTORICAL_MESSAGE_ARTIFACT',
      };
    }
    changes.threads.push({ id: thread.id, before, after: { state: thread.state, type: thread.type } });
  }
  for (const id of FISHER_THREAD_IDS) {
    if (!foundThreadIds.has(id)) changes.missingThreads.push(id);
  }

  return changes;
}

// Verify the reviewed end-state for the five objects and four threads. Throws on
// any deviation. Does not touch unrelated world state.
export function assertApprovedFisherState(world) {
  const byId = new Map((world.objects || []).map((object) => [object.id, object]));
  const [invalidA, invalidB, worldOnly, directReceipt, merged] = FISHER_OBJECT_IDS.map((id) => byId.get(id));

  const present = FISHER_OBJECT_IDS.filter((id) => byId.has(id));
  if (present.length !== FISHER_OBJECT_IDS.length) {
    throw new Error(`missing reconciled objects: ${FISHER_OBJECT_IDS.filter((id) => !byId.has(id)).join(', ')}`);
  }

  const currentIds = FISHER_OBJECT_IDS
    .map((id) => byId.get(id))
    .filter(isCurrentMessageObject)
    .map((object) => object.id);
  const expectedCurrent = [FISHER_OBJECT_IDS[2], FISHER_OBJECT_IDS[3]];
  if (JSON.stringify(currentIds) !== JSON.stringify(expectedCurrent)) {
    throw new Error(`current message objects = [${currentIds.join(', ')}], expected [${expectedCurrent.join(', ')}]`);
  }

  assertEq(invalidA.message.lifecycleState, 'RETIRED', `${invalidA.id} lifecycleState`);
  assertEq(invalidB.message.lifecycleState, 'RETIRED', `${invalidB.id} lifecycleState`);
  assertEq(worldOnly.message.lifecycleState, 'DELIVERED', `${worldOnly.id} lifecycleState`);
  assertEq(worldOnly.message.receiptObservedByCy, false, `${worldOnly.id} receiptObservedByCy`);
  assertEq(worldOnly.message.readState, 'UNREAD', `${worldOnly.id} readState`);
  assertEq(directReceipt.message.lifecycleState, 'DELIVERED', `${directReceipt.id} lifecycleState`);
  assertEq(directReceipt.message.receiptObservedByCy, true, `${directReceipt.id} receiptObservedByCy`);
  assertEq(directReceipt.message.readState, 'UNREAD', `${directReceipt.id} readState`);
  assertEq(merged.message.lifecycleState, 'RETIRED', `${merged.id} lifecycleState`);
  assertEq(merged.message.reconciliation, 'MERGED_INTO_EXISTING', `${merged.id} reconciliation`);
  assertEq(merged.message.mergedIntoObjectId, FISHER_OBJECT_IDS[2], `${merged.id} mergedIntoObjectId`);

  const threadById = new Map((world.threads || []).map((thread) => [thread.id, thread]));
  const threadStates = FISHER_THREAD_IDS.map((id) => threadById.get(id) && threadById.get(id).state);
  const expectedThreadStates = ['RESOLVED', 'RESOLVED', 'OPEN', 'OPEN'];
  if (JSON.stringify(threadStates) !== JSON.stringify(expectedThreadStates)) {
    throw new Error(`thread states = [${threadStates.join(', ')}], expected [${expectedThreadStates.join(', ')}]`);
  }
}

function assertEq(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

async function main(argv) {
  const args = argv.slice(2);
  const path = args.find((a) => !a.startsWith('--'));
  const apply = args.includes('--apply');
  const verify = args.includes('--verify');
  const backup = !args.includes('--no-backup');
  if (!path) {
    console.error('usage: node reconcile-fisher-artifacts.mjs <vitals.json> [--apply | --verify] [--no-backup]');
    process.exit(2);
  }

  // --verify asserts the CURRENT on-disk state already holds the approved
  // reconciliation, without applying anything. Used to confirm a checkpoint
  // survived save/reload/restart after deployment.
  if (verify) {
    const vitals = await loadVitals(path);
    const world = reconcileWorldSimulationState(vitals.worldSimulation || {});
    console.log('# Fisher artifact reconciliation (VERIFY)');
    console.log(`checkpoint: ${path}`);
    const current = FISHER_OBJECT_IDS
      .map((id) => (world.objects || []).find((o) => o.id === id))
      .filter((o) => o && isCurrentMessageObject(o))
      .map((o) => o.id);
    console.log(`  current message objects: [${current.join(', ')}]`);
    assertApprovedFisherState(world);
    console.log('  live-state assertion: PASS (checkpoint already holds the approved reconciliation)');
    return;
  }

  const vitals = await loadVitals(path);
  const world = reconcileWorldSimulationState(vitals.worldSimulation || {});
  const changes = applyApprovedFisherReconciliation(world);
  vitals.worldSimulation = reconcileWorldSimulationState(world);

  console.log(`# Fisher artifact reconciliation (${apply ? 'APPLY' : 'DRY-RUN'})`);
  console.log(`checkpoint: ${path}`);
  for (const change of changes.objects) {
    console.log(`  object ${change.id}: ${change.classification} | `
      + `${change.before.status}/${change.before.lifecycleState || '-'} -> `
      + `${change.after.status}/${change.after.lifecycleState}`);
  }
  for (const change of changes.threads) {
    console.log(`  thread ${change.id}: ${change.before.state}/${change.before.type || '-'} -> `
      + `${change.after.state}/${change.after.type || '-'}`);
  }
  if (changes.missingObjects.length) console.log(`  MISSING objects: ${changes.missingObjects.join(', ')}`);
  if (changes.missingThreads.length) console.log(`  MISSING threads: ${changes.missingThreads.join(', ')}`);

  assertApprovedFisherState(vitals.worldSimulation);
  console.log('  approved-state assertion: PASS');

  if (changes.missingObjects.length) {
    console.error('  refusing to apply: one or more of the five known objects is absent from this checkpoint');
    process.exit(1);
  }

  if (!apply) {
    console.log('  dry-run: no changes written. Re-run with --apply to persist.');
    return;
  }

  if (backup) {
    // loadVitals/saveVitals persist to a sectioned store (vitals-v2/) beside the
    // path, plus legacy vitals.json / vitals.previous.json / bookkeeping.json. Back
    // up the whole state directory so a restore is a single directory swap.
    const stateDir = dirname(path);
    const backupDir = `${stateDir}.pre-fisher-reconcile.${Date.now()}`;
    await cp(stateDir, backupDir, { recursive: true });
    const info = await stat(backupDir);
    if (!info.isDirectory()) throw new Error(`backup did not produce a directory: ${backupDir}`);
    console.log(`  backup written: ${backupDir}`);
  }
  await saveVitals(path, vitals);
  console.log('  saved reconciled checkpoint.');
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1] && process.argv[1].endsWith('reconcile-fisher-artifacts.mjs')) {
  main(process.argv).catch((error) => {
    console.error(error && error.stack || error);
    process.exit(1);
  });
}
