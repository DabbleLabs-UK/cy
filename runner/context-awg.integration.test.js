import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  AWG_MIN_IDLE_BUDGET_MS,
  AWG_SCHEMA,
  awgEventToEnvironment,
  runAmbientWorldCycle,
} from './ambient-world-generator.js';
import { sourceFromEnvironmentRecord } from './autobiographical-memory.js';
import { CONTEXT_CONSUMERS, buildContextPacket, createContextItem, renderContextPacket } from './context-broker.js';
import { buildDreamContextPacket } from './dream.js';
import { createEnvironmentEvent, createEnvironmentRecord } from './environment-schema.js';
import { AutobiographicalMemoryRuntime } from './memory-runtime.js';
import { loadVitals, saveVitals } from './vitals.js';

const NOW = Date.parse('2026-09-13T12:00:00.000Z');
const SENDER_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SENDER_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function candidate({ cyObserved = true } = {}) {
  return {
    schema: AWG_SCHEMA,
    version: 1,
    decision: 'EVENT',
    eventFamily: 'MESSAGE_PASSING',
    participants: cyObserved ? ['reg', 'cy'] : ['reg', 'daemon'],
    location: 'landing',
    occurredAt: new Date(NOW).toISOString(),
    objective: { eventType: 'note_passed', summary: 'Reg moved a folded note across the landing.' },
    objects: [{
      id: 'object-note-integration', type: 'note', ownerId: 'reg',
      holderId: cyObserved ? 'cy' : 'daemon', location: 'landing', status: 'ACTIVE',
    }],
    observations: [{
      observerId: cyObserved ? 'cy' : 'reg',
      access: cyObserved ? 'CY_DIRECT' : 'CAST_ONLY',
      summary: cyObserved ? 'Reg put a folded note into Cy hand.' : 'Reg passed a note to Daemon.',
    }],
    informationClaims: [],
    resolved: false,
    thread: {
      action: 'OPEN', id: 'thread-note-integration', type: 'NOTE_AWAITING_DELIVERY',
      summary: 'The destination of the note remains unresolved.', nextEligibleAt: null,
    },
    continuationOf: null,
    publicTimeline: cyObserved
      ? { eligible: true, text: '[Reg slips Cy a folded note on the landing]' }
      : { eligible: false, text: null },
  };
}

function candidateProposal(value) {
  return {
    decision: value.decision,
    eventFamily: value.eventFamily,
    participants: value.participants,
    objective: value.objective,
    objects: value.objects.map((object) => ({
      id: null,
      type: object.type,
      ownerId: object.ownerId,
      holderId: object.holderId,
      status: object.status,
    })),
    observations: value.observations,
    informationClaims: value.informationClaims,
    thread: {
      action: value.thread.action,
      id: null,
      summary: value.thread.summary,
    },
  };
}

function memoryClient(overrides = {}) {
  return {
    async enqueueMemorySource() { return { queued: true, depth: 1 }; },
    async getPreparedMemorySet() { return { prepared_set: null }; },
    async enqueueMemorySurfacing() { return { queued: true }; },
    async claimMemorySurfacing() { return { job: null, depth: 0 }; },
    async claimMemorySource() { return { job: null, depth: 0 }; },
    async queryMemories() { return { candidates: [] }; },
    async completeMemorySurfacing() {},
    async completeMemorySource() {},
    async recordMemoryQuery() {},
    async consumePreparedMemorySet() {},
    async applyMemoryOperations() {},
    async recordMemoryActivity() {},
    ...overrides,
  };
}

async function accepted(value = candidate()) {
  return runAmbientWorldCycle({
    state: null,
    contextRendering: '<SHARED_CONTEXT consumer="AWG"></SHARED_CONTEXT>',
    nowMs: NOW,
    idleBudgetMs: AWG_MIN_IDLE_BUDGET_MS,
    currentLocation: 'landing',
    plausibleCastIds: ['reg', 'daemon'],
    makeId: (prefix) => `${prefix}-integration`,
    generate: async () => JSON.stringify(candidateProposal(value)),
  });
}

test('A: foreground work blocks AWG while an overdue cycle gets a fairness slot beside queued formation', async () => {
  let calls = 0;
  const generate = async () => { calls += 1; return JSON.stringify(candidateProposal(candidate())); };
  const journal = await runAmbientWorldCycle({
    state: null, nowMs: NOW, idleBudgetMs: AWG_MIN_IDLE_BUDGET_MS,
    pendingHigherPriority: true, generate,
  });
  const memory = await runAmbientWorldCycle({
    state: null, nowMs: NOW, idleBudgetMs: AWG_MIN_IDLE_BUDGET_MS,
    memoryFormationBacklog: 1, generate,
    currentLocation: 'landing', plausibleCastIds: ['reg', 'daemon'],
  });
  assert.equal(journal.status, 'SKIPPED');
  assert.equal(memory.status, 'ACCEPTED');
  assert.equal(calls, 1);
});

test('B: a Cy-observed accepted event becomes a normal durable memory source asynchronously', async () => {
  const result = await accepted();
  assert.equal(result.status, 'ACCEPTED');
  const environment = awgEventToEnvironment(result.applied);
  const record = createEnvironmentRecord(createEnvironmentEvent(environment.archetypeId, {
    id: result.applied.event.id,
    timestamp: result.applied.event.occurredAt,
    eventType: environment.eventType,
    world: environment.world,
    observation: { summary: environment.summary, ...environment.observation },
  }));
  const source = sourceFromEnvironmentRecord(record);
  assert.equal(source.sourceType, 'ENVIRONMENT_EVENT');
  assert.equal(source.sourceId, result.applied.event.id);

  let release;
  const durableWrite = new Promise((resolve) => { release = resolve; });
  const queued = [];
  const runtime = new AutobiographicalMemoryRuntime({
    client: memoryClient({
      async enqueueMemorySource(value) {
        queued.push(value);
        await durableWrite;
        return { queued: true, depth: 1 };
      },
    }),
    generate: async () => '{"decision":"NOTHING"}',
    makeId: () => '00000000-0000-4000-8000-000000000099',
  });
  const pending = runtime.queueSource(source);
  assert.equal(runtime.hasPriorityWork(), true);
  assert.equal(queued.length, 1);
  release();
  await pending;
});

test('C and E: a world-only event cannot enter Cy prose, memory formation, the public trace or dreams', async () => {
  const result = await accepted(candidate({ cyObserved: false }));
  assert.equal(result.status, 'ACCEPTED');
  assert.equal(result.applied.cyObserved, false);
  const environment = awgEventToEnvironment(result.applied);
  assert.equal(environment.summary, null);
  assert.equal(environment.publicTimeline, null);

  const hidden = createContextItem({
    id: 'hidden-world-event', sourceId: result.applied.event.id, section: 'recent_events',
    provenanceClass: 'WORLD FACT', knowledgeScope: 'WORLD_KNOWS',
    privacyScope: 'WORLD_SIMULATION', content: result.applied.event.summary,
  });
  const prose = buildContextPacket({ consumer: CONTEXT_CONSUMERS.CY_PROSE, items: [hidden] });
  const formation = buildContextPacket({ consumer: CONTEXT_CONSUMERS.MEMORY_FORMATION, items: [hidden] });
  assert.equal(prose.metrics.selectedCount, 0);
  assert.equal(formation.metrics.selectedCount, 0);
  const dream = buildDreamContextPacket({
    recentWorld: [{ summary: result.applied.event.summary, cyObserved: false, dreamEligible: false }],
  });
  assert.equal(dream.recent_world_residue.length, 0);
});

test('D: broker preserves same-sender, cross-sender and public privacy boundaries', () => {
  const privateItem = createContextItem({
    id: 'sender-private', section: 'visitor_context', provenanceClass: 'PUBLIC VISITOR MATERIAL',
    knowledgeScope: 'CY_OBSERVED', privacyScope: 'SENDER_RECALLABLE', senderId: SENDER_A,
    content: 'private postcard context',
  });
  const publicItem = createContextItem({
    id: 'public-memory', section: 'autobiographical_memory', provenanceClass: 'SUBJECTIVE MEMORY',
    knowledgeScope: 'CY_BELIEVES', privacyScope: 'PUBLIC_RECALLABLE', content: 'publicly recallable memory',
  });
  const same = buildContextPacket({
    consumer: CONTEXT_CONSUMERS.CY_PROSE, currentSenderId: SENDER_A, items: [privateItem, publicItem],
  });
  const other = buildContextPacket({
    consumer: CONTEXT_CONSUMERS.CY_PROSE, currentSenderId: SENDER_B, items: [privateItem, publicItem],
  });
  assert.match(renderContextPacket(same), /private postcard context/);
  assert.doesNotMatch(renderContextPacket(other), /private postcard context/);
  assert.match(renderContextPacket(other), /publicly recallable memory/);
});

test('F: atomic persistence retains the latest AWG world mutation during overlapping saves', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cy-awg-atomic-'));
  const path = join(dir, 'vitals.json');
  try {
    const vitals = await loadVitals(path);
    const first = await accepted();
    vitals.worldSimulation = first.state;
    const saveOne = saveVitals(path, vitals);
    vitals.worldSimulation = {
      ...first.state,
      objects: first.state.objects.map((item) => ({ ...item, status: 'DELIVERED' })),
    };
    const saveTwo = saveVitals(path, vitals);
    await Promise.all([saveOne, saveTwo]);
    const restarted = await loadVitals(path);
    assert.equal(restarted.worldSimulation.objects[0].status, 'DELIVERED');
    assert.equal(
      (await loadVitals(path)).worldSimulation.objects[0].status,
      'DELIVERED',
      'the committed sectioned checkpoint is authoritative after restart',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('G: migration 016 is independent of migration 017 table names and remains create-only', async () => {
  const runnerDir = fileURLToPath(new URL('.', import.meta.url));
  const migration016 = await readFile(join(runnerDir, '..', 'sql', '016_context_broker_awg.sql'), 'utf8');
  const migration017 = await readFile(join(runnerDir, '..', 'sql', '017_memory_runtime_queue.sql'), 'utf8');
  const tables017 = [...migration017.matchAll(/CREATE TABLE\s+([a-z0-9_]+)/gi)].map((match) => match[1]);
  assert.equal((migration016.match(/CREATE TABLE/gi) || []).length, 4);
  assert.doesNotMatch(migration016, /\b(?:ALTER|DROP|DELETE|UPDATE|INSERT)\b/i);
  for (const table of tables017) assert.doesNotMatch(migration016, new RegExp(`\\b${table}\\b`, 'i'));
});
