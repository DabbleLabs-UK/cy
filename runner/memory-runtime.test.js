import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AutobiographicalMemoryRuntime } from './memory-runtime.js';

const sender = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const candidate = {
  id: '00000000-0000-4000-8000-000000000011',
  type: 'PERSON', status: 'ACTIVE', privacyScope: 'SENDER_RECALLABLE',
  subjectVisitorId: sender, content: 'This sender asked before about a television.',
  publicSummary: null, consistencyStatus: 'CONSISTENT', version: 1,
  tags: ['television', 'postcard'], reasons: ['SAME_PERSON'],
};

test('working context is model-selected, bounded and recorded', async () => {
  const calls = [];
  const client = {
    async queryMemories() { return { candidates: [candidate], mechanisms: ['EXACT_PERSON'], privacy_filter: { applied: true } }; },
    async recordMemoryQuery(value) { calls.push(value); },
  };
  const runtime = new AutobiographicalMemoryRuntime({
    client, makeId: () => '00000000-0000-4000-8000-000000000012',
    generate: async () => '{"memoryRefs":["C1"]}',
  });
  const result = await runtime.refreshWorkingContext({
    text: 'television', currentVisitorId: sender, senderLabel: 'j',
    groundedContext: '[OBSERVED FACT] A postcard is present.', generationRef: 'g1',
  });
  assert.match(result.directive, /This sender asked before/);
  assert.equal(result.selected.length, 1);
  assert.deepEqual(calls[0].inspection.insertedIds, [candidate.id]);
  assert.deepEqual(calls[0].inspection.selectedReasons[candidate.id], ['SAME_PERSON']);
});

test('zero candidates produces zero surfaced memories', async () => {
  let generated = false;
  const runtime = new AutobiographicalMemoryRuntime({
    client: {
      async queryMemories() { return { candidates: [] }; },
      async recordMemoryQuery() {},
    },
    makeId: () => '00000000-0000-4000-8000-000000000012',
    generate: async () => { generated = true; return '{}'; },
  });
  const result = await runtime.refreshWorkingContext({ text: 'nothing relevant' });
  assert.equal(result.directive, '');
  assert.equal(generated, false);
});

test('surfacing failure leaves an empty working context without failing generation', async () => {
  const runtime = new AutobiographicalMemoryRuntime({
    client: {
      async queryMemories() { return { candidates: [candidate] }; },
      async recordMemoryQuery() {},
    },
    makeId: () => '00000000-0000-4000-8000-000000000012',
    generate: async () => { throw new Error('provider unavailable'); },
  });
  const result = await runtime.refreshWorkingContext({
    text: 'television', currentVisitorId: sender,
  });
  assert.equal(result.directive, '');
  assert.deepEqual(result.selected, []);
});

test('formation is separate and applies one sourced model decision', async () => {
  const applied = [];
  const runtime = new AutobiographicalMemoryRuntime({
    client: {
      async queryMemories() { return { candidates: [] }; },
      async applyMemoryOperations(operations) { applied.push(...operations); return { applied: operations.length }; },
      async recordMemoryActivity() {},
    },
    makeId: () => '00000000-0000-4000-8000-000000000012',
    generate: async () => JSON.stringify({
      decision: 'CREATE', type: 'EPISODIC', privacyScope: 'INTERNAL_ONLY',
      content: 'A meal tray arrived cold.', classification: 'meal incident',
      consistencyStatus: 'CONSISTENT', tags: ['meal', 'cell'],
    }),
  });
  runtime.queueSource({
    sourceType: 'ENVIRONMENT_EVENT', sourceId: 'env-source',
    text: 'the tea came cold', tags: ['meal'], sourceVisibility: 'INTERNAL_ONLY',
  });
  const result = await runtime.formNext();
  assert.equal(result.status, 'CREATE');
  assert.equal(applied.length, 1);
  assert.equal(applied[0].source.sourceId, 'env-source');
});
