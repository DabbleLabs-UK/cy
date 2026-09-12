import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AutobiographicalMemoryRuntime, memoryContextFingerprint } from './memory-runtime.js';

const sender = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const otherSender = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const candidate = {
  id: '00000000-0000-4000-8000-000000000011',
  type: 'PERSON', status: 'ACTIVE', privacyScope: 'SENDER_RECALLABLE',
  subjectVisitorId: sender, content: 'This sender asked before about a television.',
  publicSummary: null, consistencyStatus: 'CONSISTENT', version: 1,
  tags: ['television', 'postcard'], reasons: ['SAME_PERSON'],
};

function client(overrides = {}) {
  return {
    async enqueueMemorySource() { return { queued: true, depth: 1 }; },
    async getPreparedMemorySet() { return { prepared_set: null }; },
    async enqueueMemorySurfacing() { return { queued: true }; },
    async claimMemorySurfacing() { return { job: null }; },
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

function runtime(overrides = {}) {
  return new AutobiographicalMemoryRuntime({
    client: client(overrides.client),
    makeId: () => '00000000-0000-4000-8000-000000000012',
    generate: overrides.generate || (async () => '{"memoryRefs":[]}'),
    now: overrides.now || (() => Date.now()),
    canRunBackground: overrides.canRunBackground || (() => true),
    backgroundTimeoutMs: overrides.backgroundTimeoutMs || 100,
    providerInfo: () => ({ id: 'ollama', model: 'test-model' }),
  });
}

test('journal context request does not await a slow surfacing model call', async () => {
  let generated = false;
  const r = runtime({ generate: async () => {
    generated = true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return '{"memoryRefs":[]}';
  } });
  const started = Date.now();
  await r.requestWorkingContext({ text: 'a current event' });
  assert.ok(Date.now() - started < 100);
  assert.equal(generated, false);
});

test('postcard memory lookup observes its total engineering deadline', async () => {
  const r = runtime({ client: {
    async getPreparedMemorySet() { return new Promise(() => {}); },
  } });
  const started = Date.now();
  const result = await r.requestWorkingContext(
    { text: 'postcard', currentVisitorId: sender },
    { deadlineMs: 30, priority: 100 },
  );
  const elapsed = Date.now() - started;
  assert.equal(result.inspection.status, 'DEADLINE_EXPIRED');
  assert.ok(elapsed >= 20 && elapsed < 1200, `deadline took ${elapsed}ms`);
});

test('more than 32 sources are durably offered without local eviction', async () => {
  const ids = new Set();
  const r = runtime({ client: {
    async enqueueMemorySource(source) {
      const duplicate = ids.has(source.sourceId);
      ids.add(source.sourceId);
      return { queued: !duplicate, duplicate, depth: ids.size };
    },
  } });
  for (let i = 0; i < 80; i++) {
    await r.queueSource({ sourceType: 'ENVIRONMENT_EVENT', sourceId: `event-${i}`, text: `event ${i}` });
  }
  assert.equal(ids.size, 80);
});

test('source enqueue is idempotent across runtime restart', async () => {
  const durable = new Set();
  const shared = {
    async enqueueMemorySource(source) {
      const key = `${source.sourceType}:${source.sourceId}`;
      const duplicate = durable.has(key);
      durable.add(key);
      return { queued: !duplicate, duplicate };
    },
  };
  const one = runtime({ client: shared });
  const two = runtime({ client: shared });
  assert.equal((await one.queueSource({ sourceType: 'POSTCARD', sourceId: 'postcard:1' })).queued, true);
  assert.equal((await two.queueSource({ sourceType: 'POSTCARD', sourceId: 'postcard:1' })).duplicate, true);
  assert.equal(durable.size, 1);
});

test('restart can claim and process a previously persisted source', async () => {
  const completed = [];
  const job = {
    id: 7, source: {
      sourceType: 'ENVIRONMENT_EVENT', sourceId: 'persisted-event', text: 'the tea came cold',
      tags: ['meal'], sourceVisibility: 'INTERNAL_ONLY',
    },
  };
  const r = runtime({
    client: {
      async claimMemorySurfacing() { return { job: null }; },
      async claimMemorySource() { return { job, depth: 1 }; },
      async queryMemories() { return { candidates: [] }; },
      async completeMemorySource(value) { completed.push(value); },
    },
    generate: async () => '{"decision":"NOTHING"}',
  });
  r.stopped = false;
  await r.tick();
  r.stop();
  assert.equal(completed[0].job_id, 7);
  assert.equal(completed[0].result_category, 'NOTHING');
});

test('NOTHING and invalid formation output are recorded distinctly', async () => {
  const categories = [];
  let raw = '{"decision":"NOTHING"}';
  const r = runtime({
    client: {
      async queryMemories() { return { candidates: [] }; },
      async completeMemorySource(value) { categories.push(value.result_category); },
    },
    generate: async () => raw,
  });
  const job = { id: 1, source: { sourceType: 'CY_EXPRESSION', sourceId: 'x', text: 'x' } };
  await r.processFormation(job, 1);
  raw = 'not json';
  await r.processFormation({ ...job, id: 2 }, 1);
  assert.deepEqual(categories, ['NOTHING', 'INVALID']);
});

test('provider timeout is persisted and not treated as NOTHING', async () => {
  const completed = [];
  const r = runtime({
    client: {
      async queryMemories() { return { candidates: [] }; },
      async completeMemorySource(value) { completed.push(value); },
    },
    backgroundTimeoutMs: 10,
    generate: async ({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('timed out', 'AbortError')), { once: true });
    }),
  });
  await r.processFormation({ id: 2, source: { sourceType: 'CY_EXPRESSION', sourceId: 'slow', text: 'slow' } }, 1);
  assert.equal(completed[0].result_category, 'TIMEOUT');
});

test('malformed surfacing output is persisted as INVALID', async () => {
  const completed = [];
  const r = runtime({
    client: {
      async queryMemories() { return { candidates: [candidate] }; },
      async completeMemorySurfacing(value) { completed.push(value); },
    },
    generate: async () => 'not json',
  });
  await r.processSurfacing({
    id: 8, context_fingerprint: memoryContextFingerprint({ text: 'tv', currentVisitorId: sender }),
    subject_visitor_id: sender, context: { text: 'tv', currentVisitorId: sender },
  });
  assert.equal(completed[0].result_category, 'INVALID');
});

test('prepared set is sender-scoped and cannot cross visitors', () => {
  const consumed = [];
  const r = runtime({ client: {
    async consumePreparedMemorySet(value) { consumed.push(value); },
  } });
  const context = { text: 'television', currentVisitorId: sender };
  r.activatePrepared({
    id: 'set-1', context_fingerprint: memoryContextFingerprint(context),
    subject_visitor_id: sender, selected_memories: [candidate],
    expires_at: new Date(Date.now() + 60000).toISOString(),
  }, context);
  assert.match(r.consumeWorking('postcard:1', sender).directive, /television/);
  assert.equal(r.consumeWorking('postcard:2', otherSender).directive, '');
  assert.equal(consumed.length, 1);
});

test('stale prepared set is not compatible with a new context', () => {
  const r = runtime();
  const old = { text: 'old incident', currentVisitorId: sender };
  r.activatePrepared({
    id: 'set-old', context_fingerprint: memoryContextFingerprint(old),
    subject_visitor_id: sender, selected_memories: [candidate],
    expires_at: new Date(Date.now() - 1).toISOString(),
  }, old);
  assert.equal(r.compatibleWorking(memoryContextFingerprint(old), sender), false);
  assert.equal(r.compatibleWorking(memoryContextFingerprint({ ...old, text: 'new incident' }), sender), false);
});

test('consumption is traced with the exact generation reference', async () => {
  const consumed = [];
  const r = runtime({ client: {
    async consumePreparedMemorySet(value) { consumed.push(value); },
  } });
  const context = { text: 'television', currentVisitorId: sender };
  r.activatePrepared({
    id: 'set-2', context_fingerprint: memoryContextFingerprint(context),
    subject_visitor_id: sender, selected_memories: [candidate],
    expires_at: new Date(Date.now() + 60000).toISOString(),
  }, context);
  r.consumeWorking('journal:123', sender);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(consumed[0].generationRef, 'journal:123');
  assert.equal(consumed[0].visitorId, sender);
});

test('background work does not claim while visitor-facing inference is busy', async () => {
  let claims = 0;
  const r = runtime({
    canRunBackground: () => false,
    client: { async claimMemorySurfacing() { claims++; return { job: null }; } },
  });
  r.stopped = false;
  await r.tick();
  r.stop();
  assert.equal(claims, 0);
});

test('foreground interruption is recorded as preemption for surfacing', async () => {
  const completed = [];
  const r = runtime({
    client: {
      async queryMemories() { return { candidates: [candidate] }; },
      async completeMemorySurfacing(value) { completed.push(value); },
    },
    generate: async ({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('preempted', 'AbortError')), { once: true });
    }),
  });
  const work = r.processSurfacing({
    id: 9, context_fingerprint: memoryContextFingerprint({ text: 'tv', currentVisitorId: sender }),
    subject_visitor_id: sender, context: { text: 'tv', currentVisitorId: sender },
  });
  await new Promise((resolve) => setImmediate(resolve));
  r.interruptBackground('foreground');
  await work;
  assert.equal(completed[0].result_category, 'PREEMPTED');
});
