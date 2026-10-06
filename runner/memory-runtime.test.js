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
// Shaped like what captive_memory_query now additionally returns per
// candidate (matchedTags/matchedTerms/matchProvenance) - used to test that
// this provenance reaches the query ledger without reaching the model prompt
// or affecting selection.
const candidateWithProvenance = {
  ...candidate,
  matchedTags: ['television'], matchedTerms: ['television'],
  matchProvenance: {
    lexical_match: true, structured_sender_identity: true,
    recent_cy_expression_overlap: false, recent_cy_expression_overlap_terms: [],
  },
};

function client(overrides = {}) {
  return {
    async enqueueMemorySource() { return { queued: true, depth: 1 }; },
    async getPreparedMemorySet() { return { prepared_set: null }; },
    async enqueueMemorySurfacing() { return { queued: true }; },
    async claimMemorySurfacing() { return { job: null, depth: 0 }; },
    async claimMemorySource() { return { job: null, depth: 0 }; },
    async queryMemories() { return { candidates: [] }; },
    async completeMemorySurfacing() {},
    async finishMemorySource() {},
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
    backgroundWaitMs: overrides.backgroundWaitMs || (() => 250),
    backgroundTimeoutMs: overrides.backgroundTimeoutMs || 100,
    providerInfo: () => ({ id: 'ollama', model: 'test-model' }),
  });
}

test('journal context request does not await a slow surfacing model call', async () => {
  let releaseGeneration;
  let modelStarted;
  const started = new Promise((resolve) => { modelStarted = resolve; });
  const blocked = new Promise((resolve) => { releaseGeneration = resolve; });
  let backgroundSettled = false;
  const r = runtime({
    client: { async queryMemories() { return { candidates: [candidate] }; } },
    generate: async () => {
      modelStarted();
      await blocked;
      return '{"memoryRefs":[]}';
    },
  });
  const background = r.processSurfacing({ id: 1, subject_visitor_id: sender, context: { text: 'earlier event' } })
    .finally(() => { backgroundSettled = true; });
  await started;
  try {
    const foreground = r.requestWorkingContext({ text: 'a current event' });
    const completed = await Promise.race([
      foreground.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 2000)),
    ]);
    assert.equal(completed, true, 'foreground context waited for blocked surfacing');
    assert.equal(backgroundSettled, false);
  } finally {
    releaseGeneration();
    await background;
  }
});

test('foreground context can defer the background claim until its model call has started', async () => {
  const delays = [];
  const r = runtime();
  r.schedule = (delay) => delays.push(delay);
  await r.requestWorkingContext(
    { text: 'a current event' },
    { scheduleDelayMs: 1000 },
  );
  assert.deepEqual(delays, [1000]);
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
      async finishMemorySource(value) { completed.push(value); },
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
      async finishMemorySource(value) { categories.push(value.result_category); },
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
      async finishMemorySource(value) { completed.push(value); },
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

test('a long tempo reservation backs off memory polling instead of spinning', async () => {
  let claims = 0;
  const r = runtime({
    canRunBackground: () => false,
    backgroundWaitMs: () => 90000,
    client: { async claimMemorySurfacing() { claims++; return { job: null }; } },
  });
  const delays = [];
  r.schedule = (delay) => { delays.push(delay); };
  r.stopped = false;
  await r.tick();
  assert.equal(claims, 0);
  assert.deepEqual(delays, [10000], 'long reservations use bounded low-frequency polling');
});

test('durable priority starts conservative and clears only after both queues are checked empty', async () => {
  const claims = [];
  const r = runtime({ client: {
    async claimMemorySurfacing() { claims.push('surfacing'); return { job: null, depth: 0 }; },
    async claimMemorySource() { claims.push('formation'); return { job: null, depth: 0 }; },
  } });
  assert.equal(r.hasPriorityWork(), true);
  r.stopped = false;
  await r.tick();
  r.stop();
  assert.deepEqual(claims, ['formation', 'surfacing', 'formation']);
  assert.equal(r.hasPriorityWork(), false);
});

test('an available durable memory job retains priority for the immediate follow-up poll', async () => {
  const r = runtime({
    client: {
      async claimMemorySurfacing() { return { job: null, depth: 0 }; },
      async claimMemorySource() {
        return {
          job: { id: 41, source: { sourceType: 'ENVIRONMENT_EVENT', sourceId: 'event-priority', text: 'a note arrived' } },
          depth: 1,
        };
      },
      async queryMemories() { return { candidates: [] }; },
      async finishMemorySource() {},
    },
    generate: async () => '{"decision":"NOTHING"}',
  });
  r.stopped = false;
  await r.tick();
  r.stop();
  assert.equal(r.hasPriorityWork(), true);
});

test('an aged sender source runs before a continuously replenished surfacing queue', async () => {
  const claimed = [];
  const completed = [];
  const r = runtime({ client: {
    async claimMemorySource({ senderOnly } = {}) {
      claimed.push(senderOnly ? 'sender' : 'general');
      return senderOnly ? {
        job: { id: 81, claim_token: 'claim-81', source: {
          sourceType: 'POSTCARD', sourceId: 'postcard:81', text: 'My dog is called Alfie.',
          sourceVisibility: 'SENDER_RECALLABLE', subjectVisitorId: sender,
        } }, depth: 1,
      } : { job: null };
    },
    async claimMemorySurfacing() {
      claimed.push('surfacing');
      return { job: { id: 82, context: { text: 'another request' } } };
    },
    async finishMemorySource(value) { completed.push(value); return { status: 'PROCESSED' }; },
  }, generate: async () => '{"decision":"CREATE","type":"PERSON","content":"The sender has a dog called Alfie."}' });
  r.stopped = false;
  await r.tick();
  r.stop();
  assert.deepEqual(claimed, ['sender']);
  assert.equal(completed[0].result_category, 'CREATE');
  assert.equal(completed[0].operations[0].type, 'PERSON');
  assert.equal(completed[0].claim_token, 'claim-81');
});

test('AWG gate or model contention delays sender formation without losing it', async () => {
  let available = false;
  let claims = 0;
  const r = runtime({
    canRunBackground: (kind) => available && kind !== 'formation',
    client: {
      async claimMemorySource({ senderOnly } = {}) {
        if (!senderOnly) return { job: null };
        claims += 1;
        return { job: { id: 83, claim_token: 'claim-83', source: {
          sourceType: 'CY_REPLY', sourceId: 'postcard-reply:83', text: 'I remember Alfie.',
          sourceVisibility: 'SENDER_RECALLABLE', subjectVisitorId: sender,
        } } };
      },
    },
    generate: async () => '{"decision":"NOTHING"}',
  });
  r.stopped = false;
  await r.tick();
  assert.equal(claims, 0);
  available = true;
  await r.tick();
  r.stop();
  assert.equal(claims, 1);
});

test('reserved sender turn is paced and does not create a restart burst', async () => {
  let now = 1_000_000;
  let claims = 0;
  const r = runtime({
    now: () => now,
    client: {
      async claimMemorySource({ senderOnly } = {}) {
        assert.equal(senderOnly, true);
        claims += 1;
        return { job: { id: 84 + claims, claim_token: `claim-${claims}`, source: {
          sourceType: 'POSTCARD', sourceId: `postcard:${claims}`, text: 'My dog is called Alfie.',
          sourceVisibility: 'SENDER_RECALLABLE', subjectVisitorId: sender,
        } } };
      },
    },
    generate: async () => '{"decision":"NOTHING"}',
  });
  r.stopped = false;
  assert.equal((await r.serviceAgedSenderBeforeExpression()).status, 'NOTHING');
  assert.equal((await r.serviceAgedSenderBeforeExpression()).status, 'NOT_DUE');
  assert.equal(claims, 1);
  now += 10 * 60 * 1000;
  assert.equal((await r.serviceAgedSenderBeforeExpression()).status, 'NOTHING');
  r.stop();
  assert.equal(claims, 2);
});

test('a waking opportunity waits for an already claimed sender job instead of preempting it', async () => {
  let startModel;
  let releaseModel;
  const modelStarted = new Promise((resolve) => { startModel = resolve; });
  const modelHeld = new Promise((resolve) => { releaseModel = resolve; });
  let claims = 0;
  const r = runtime({
    client: {
      async claimMemorySource({ senderOnly } = {}) {
        assert.equal(senderOnly, true);
        claims += 1;
        return { job: { id: 85, claim_token: 'claim-85', source: {
          sourceType: 'POSTCARD', sourceId: 'postcard:85', text: 'My dog is called Alfie.',
          sourceVisibility: 'SENDER_RECALLABLE', subjectVisitorId: sender,
        } } };
      },
    },
    generate: async () => {
      startModel();
      await modelHeld;
      return '{"decision":"NOTHING"}';
    },
  });
  r.stopped = false;
  r.schedule = () => {};
  const background = r.tick();
  await modelStarted;
  assert.equal(r.busy, true);
  assert.ok(r.activeSenderFormation);
  r.canRunBackground = () => false; // The new waking turn closes the background eligibility gate.
  let wakingReleased = false;
  const reserved = r.serviceAgedSenderBeforeExpression().then((result) => {
    wakingReleased = true;
    return result;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(wakingReleased, false);
  assert.equal(claims, 1, 'waking turn must not claim a duplicate source');
  releaseModel();
  assert.equal((await reserved).status, 'NOTHING');
  await background;
  assert.equal(r.activeSenderFormation, null);
  assert.ok(r.lastReservedSenderAt > 0);
  r.stop();
});

test('lost completion response retries the same claim token without regenerating memory', async () => {
  const requests = [];
  let generated = 0;
  const r = runtime({ client: {
    async finishMemorySource(value) {
      requests.push(value);
      if (requests.length === 1) throw new Error('memory finish_source HTTP response lost');
      return { status: 'PROCESSED', result_category: 'CREATE', duplicate: true, results: [{ operation: 'CREATE' }] };
    },
  }, generate: async () => {
    generated += 1;
    return '{"decision":"CREATE","type":"PERSON","content":"The sender has a dog called Alfie."}';
  } });
  const result = await r.processFormation({ id: 86, claim_token: 'claim-86', source: {
    sourceType: 'POSTCARD', sourceId: 'postcard:86', text: 'My dog is called Alfie.',
    sourceVisibility: 'SENDER_RECALLABLE', subjectVisitorId: sender,
  } });
  assert.equal(result.status, 'CREATE');
  assert.equal(generated, 1);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].claim_token, requests[1].claim_token);
  assert.equal(requests[1].operations.length, 0);
});

test('a clear same-sender unresolved topic produces a revisioned resolution', async () => {
  const completed = [];
  const r = runtime({ client: {
    async queryMemories() { return { candidates: [{
      ...candidate, type: 'UNRESOLVED_THREAD', content: 'The sender asked if Cy kept their question open.',
    }] }; },
    async finishMemorySource(value) { completed.push(value); return { status: 'PROCESSED' }; },
  }, generate: async () => '{"decision":"RESOLVE","memoryRef":"FM1"}' });
  await r.processFormation({ id: 87, claim_token: 'claim-87', source: {
    sourceType: 'CY_REPLY', sourceId: 'postcard-reply:87', text: 'Yes, I answered that question.',
    sourceVisibility: 'SENDER_RECALLABLE', subjectVisitorId: sender,
  } });
  assert.equal(completed[0].result_category, 'RESOLVE');
  assert.equal(completed[0].operations[0].decision, 'ARCHIVE');
  assert.equal(completed[0].operations[0].expectedVersion, 1);
});

test('a source enqueue in flight prevents lower-priority world generation', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const r = runtime({ client: {
    async enqueueMemorySource() { await pending; return { queued: true, depth: 1 }; },
  } });
  r.priorityPending = false;
  const queued = r.queueSource({ sourceType: 'ENVIRONMENT_EVENT', sourceId: 'event-in-flight', text: 'event' });
  assert.equal(r.hasPriorityWork(), true);
  release();
  await queued;
  assert.equal(r.pendingSourceWrites, 0);
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

// --- retrieval-cue provenance (instrumentation only) --------------------

test('recent-expression text and query source type reach the server query without entering the model prompt', async () => {
  const queried = [];
  const r = runtime({
    client: {
      async queryMemories(value) { queried.push(value); return { candidates: [candidateWithProvenance] }; },
    },
    generate: async () => '{"memoryRefs":[]}',
  });
  await r.processSurfacing({
    id: 20, context_fingerprint: memoryContextFingerprint({ text: 'tv', currentVisitorId: sender }),
    subject_visitor_id: sender,
    context: {
      text: 'tv', currentVisitorId: sender,
      querySourceType: 'ENVIRONMENT_EVENT', recentExpressionText: 'Cy mentioned a television earlier.',
    },
  });
  assert.equal(queried[0].querySourceType, 'ENVIRONMENT_EVENT');
  assert.equal(queried[0].recentExpressionText, 'Cy mentioned a television earlier.');
});

test('candidate match provenance and repeat detection reach the query ledger without changing selection', async () => {
  const recorded = [];
  const r = runtime({
    client: {
      async queryMemories() { return { candidates: [candidateWithProvenance] }; },
      async recordMemoryQuery(value) { recorded.push(value); },
    },
    generate: async () => `{"memoryRefs":["C1"]}`,
  });
  await r.processSurfacing({
    id: 21, context_fingerprint: memoryContextFingerprint({ text: 'tv', currentVisitorId: sender }),
    subject_visitor_id: sender,
    context: { text: 'tv', currentVisitorId: sender, querySourceType: 'POSTCARD' },
  });
  const inspection = recorded[0].inspection;
  assert.equal(inspection.querySourceType, 'POSTCARD');
  assert.deepEqual(inspection.candidateProvenance[candidate.id].matchedTags, ['television']);
  assert.equal(inspection.candidateProvenance[candidate.id].matchProvenance.structured_sender_identity, true);
  assert.equal(inspection.candidateProvenance[candidate.id].repeatedFromPreviousGeneration, false);
  assert.deepEqual(inspection.repeatedFromPreviousGenerationIds, []);
  // Selection itself is untouched by the added provenance fields.
  assert.deepEqual(inspection.selectedIds, [candidate.id]);
  assert.deepEqual(inspection.insertedIds, [candidate.id]);
});

test('a memory inserted in the immediately preceding generation is marked repeated in the next query', async () => {
  const recorded = [];
  const r = runtime({
    client: { async recordMemoryQuery(value) { recorded.push(value); } },
  });
  const priorContext = { text: 'television', currentVisitorId: sender };
  r.activatePrepared({
    id: 'set-repeat', context_fingerprint: memoryContextFingerprint(priorContext),
    subject_visitor_id: sender, selected_memories: [candidate],
    expires_at: new Date(Date.now() + 60000).toISOString(),
  }, priorContext);
  r.consumeWorking('generation:1', sender);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(r.lastConsumed.insertedIds, [candidate.id]);

  const other = { ...candidateWithProvenance, id: '00000000-0000-4000-8000-000000000099' };
  r.client.queryMemories = async () => ({ candidates: [candidateWithProvenance, other] });
  await r.processSurfacing({
    id: 22, context_fingerprint: memoryContextFingerprint({ text: 'tv', currentVisitorId: sender }),
    subject_visitor_id: sender, context: { text: 'tv', currentVisitorId: sender },
  });
  const inspection = recorded[0].inspection;
  assert.deepEqual(inspection.repeatedFromPreviousGenerationIds, [candidate.id]);
  assert.equal(inspection.candidateProvenance[candidate.id].repeatedFromPreviousGeneration, true);
  assert.equal(inspection.candidateProvenance[other.id].repeatedFromPreviousGeneration, false);
});

test('provenance instrumentation never reaches the model prompt', async () => {
  const prompts = [];
  const r = runtime({
    client: { async queryMemories() { return { candidates: [candidateWithProvenance] }; } },
    generate: async (call) => { prompts.push(call); return '{"memoryRefs":[]}'; },
  });
  await r.processSurfacing({
    id: 23, context_fingerprint: memoryContextFingerprint({ text: 'tv', currentVisitorId: sender }),
    subject_visitor_id: sender,
    context: {
      text: 'tv', currentVisitorId: sender,
      querySourceType: 'ENVIRONMENT_EVENT', recentExpressionText: 'a television, apparently',
    },
  });
  const sent = `${prompts[0].system}\n${prompts[0].prompt}`;
  for (const leaked of ['matchProvenance', 'matchedTags', 'matchedTerms', 'recent_cy_expression', 'ENVIRONMENT_EVENT', 'repeatedFromPreviousGeneration']) {
    assert.equal(sent.includes(leaked), false, `${leaked} must not reach the model prompt`);
  }
});

test('selection and model prompt are identical whether or not recent-expression provenance is supplied', async () => {
  const prompts = [];
  const selections = [];
  const makeRuntime = () => runtime({
    client: { async queryMemories() { return { candidates: [candidateWithProvenance] }; } },
    generate: async (call) => { prompts.push(`${call.system}\n${call.prompt}`); return '{"memoryRefs":["C1"]}'; },
  });
  for (const context of [
    { text: 'tv', currentVisitorId: sender },
    { text: 'tv', currentVisitorId: sender, querySourceType: 'POSTCARD', recentExpressionText: 'television, television' },
  ]) {
    const r = makeRuntime();
    r.client.recordMemoryQuery = async (value) => { selections.push(value.inspection.selectedIds); };
    await r.processSurfacing({
      id: 24, context_fingerprint: memoryContextFingerprint({ text: 'tv', currentVisitorId: sender }),
      subject_visitor_id: sender, context,
    });
  }
  assert.equal(prompts[0], prompts[1]);
  assert.deepEqual(selections[0], selections[1]);
});

test('a fresh runtime after restart reports no repeats and does not crash on candidates carrying provenance', async () => {
  const recorded = [];
  const r = runtime({
    client: {
      async queryMemories() { return { candidates: [candidateWithProvenance] }; },
      async recordMemoryQuery(value) { recorded.push(value); },
    },
  });
  assert.deepEqual(r.lastConsumed, { generationRef: null, insertedIds: [] });
  await r.processSurfacing({
    id: 25, context_fingerprint: memoryContextFingerprint({ text: 'tv', currentVisitorId: sender }),
    subject_visitor_id: sender, context: { text: 'tv', currentVisitorId: sender },
  });
  assert.deepEqual(recorded[0].inspection.repeatedFromPreviousGenerationIds, []);
});

test('a pre-fix pending Cy expression is cleaned before retrieval, formation and prompt assembly', async () => {
  const queries = [];
  const prompts = [];
  const completed = [];
  const source = {
    sourceType: 'CY_EXPRESSION', sourceId: 'expression-batch:legacy',
    text: "the bolt went twice.\n\nYour entry is complete!\n\ni kept Reg's note.",
    sourceVisibility: 'INTERNAL_ONLY', tags: ['cy-expression'],
  };
  const before = structuredClone(source);
  const r = runtime({
    client: {
      async queryMemories(value) { queries.push(value); return { candidates: [] }; },
      async finishMemorySource(value) { completed.push(value); },
    },
    generate: async (call) => { prompts.push(call.prompt); return '{"decision":"NOTHING"}'; },
  });
  const result = await r.processFormation({ id: 71, source });
  assert.equal(result.status, 'NOTHING');
  assert.equal(queries[0].query.text, "the bolt went twice.\n\ni kept Reg's note.");
  assert.match(prompts[0], /the bolt went twice/);
  assert.match(prompts[0], /i kept Reg's note/);
  assert.doesNotMatch(prompts[0], /entry is complete/i);
  assert.equal(completed[0].result_category, 'NOTHING');
  assert.deepEqual(source, before);
});

test('new Cy reply sources are cleaned before durable enqueue without changing the caller object', async () => {
  const queued = [];
  const r = runtime({ client: {
    async enqueueMemorySource(value) { queued.push(value); return { queued: true }; },
  } });
  r.schedule = () => {};
  const source = {
    sourceType: 'CY_REPLY', sourceId: 'postcard-reply:old',
    text: "reg's words stayed with me. The task is to complete this entry.",
  };
  const before = structuredClone(source);
  await r.queueSource(source);
  assert.equal(queued[0].text, "reg's words stayed with me.");
  assert.deepEqual(source, before);
  assert.deepEqual(await r.queueSource({ ...source, text: 'Your entry is complete!' }), { queued: false });
  assert.equal(queued.length, 1);
});

test('an entirely editorial pending Cy expression completes without model work', async () => {
  const completed = [];
  const r = runtime({
    client: { async finishMemorySource(value) { completed.push(value); } },
    generate: async () => { throw new Error('model must not receive editorial text'); },
  });
  const result = await r.processFormation({
    id: 72, source: {
      sourceType: 'CY_EXPRESSION', sourceId: 'expression-batch:editorial',
      text: 'Your entry is complete!',
    },
  });
  assert.equal(result.status, 'NOTHING');
  assert.equal(completed[0].job_id, 72);
  const newer = await r.processFormation({
    id: 75, source: {
      sourceType: 'CY_EXPRESSION', sourceId: 'expression-batch:editorial-new',
      text: '(Cy breaks off here with Nick sorting his things)',
    },
  });
  assert.equal(newer.status, 'NOTHING');
  assert.equal(completed[1].job_id, 75);
  const markerOnly = await r.processFormation({
    id: 76, source: {
      sourceType: 'CY_EXPRESSION', sourceId: 'expression-batch:marker-only',
      text: '|...|| >',
    },
  });
  assert.equal(markerOnly.status, 'NOTHING');
  assert.equal(completed[2].job_id, 76);
});

test('old queued surfacing context loses assistant-role provenance before querying', async () => {
  const queried = [];
  const r = runtime({ client: {
    async queryMemories(value) { queried.push(value); return { candidates: [] }; },
  } });
  await r.processSurfacing({
    id: 73, subject_visitor_id: null, context: {
      text: 'cell search', groundedContext: 'sleep pressure remains high',
      recentExpressionText: "the bolt went twice. I've added an incomplete sentence to continue Cy's thought process.",
    },
  });
  assert.equal(queried[0].recentExpressionText, 'the bolt went twice.');
});

test('pending memory context removes the newer separator and editorial tail before surfacing', async () => {
  const queried = [];
  const r = runtime({ client: {
    async queryMemories(value) { queried.push(value); return { candidates: [] }; },
  } });
  await r.processSurfacing({
    id: 74, subject_visitor_id: null, context: {
      text: 'cell search', groundedContext: 'sleep pressure remains high',
      recentExpressionText: 'nick took ages with the keys |...|| > dont know why (Cy breaks off here with Nick sorting his things)',
    },
  });
  assert.equal(queried[0].recentExpressionText, 'nick took ages with the keys dont know why');
});

test('pending memory surfacing context removes the October thought-label control leak', async () => {
  const queried = [];
  const r = runtime({ client: {
    async queryMemories(value) { queried.push(value); return { candidates: [] }; },
  } });
  await r.processSurfacing({
    id: 75, subject_visitor_id: null, context: {
      text: 'cell search', groundedContext: 'the door closed',
      recentExpressionText: "counted them tiles |]>|[Cy's thoughts]|) dont wanna believe |) |[Cy's thoughts]|[",
    },
  });
  assert.doesNotMatch(queried[0].recentExpressionText, /cy'?s thoughts|\|[()\[\]<>]/i);
  assert.match(queried[0].recentExpressionText, /counted them tiles/);
});
