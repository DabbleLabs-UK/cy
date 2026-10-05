import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { loadPostcardSenderContinuity, loadPostcardEnrichment, postcardSenderMemoryItems,
  postcardMemoryDirective, postcardMemoryReadiness, SENDER_MEMORY_WAIT_MS,
  POSTCARD_ENRICHMENT_WAIT_MS } from './postcard-memory.js';
import { AutobiographicalMemoryRuntime, memoryContextFingerprint } from './memory-runtime.js';
import { safeBuildContext } from './context-broker.js';
import { visitorForPrompt } from './cast.js';
import { canonicalPostcardContext } from './postcard-context.js';
import { buildDirectives } from './prompt.js';
import { makeProviders } from './provider.js';
import { Client } from './client.js';

const visitorId = 'a'.repeat(32), other = 'b'.repeat(32);
const context = { currentVisitorId: visitorId, text: 'how is the garden?', generationRef: 'postcard:80' };
const memory = (id, type = 'PERSON', extra = {}) => ({
  id, type, status: 'ACTIVE', privacyScope: 'SENDER_RECALLABLE', subjectVisitorId: visitorId,
  content: id === 'person' ? 'Ana told Cy long ago that she tends a garden.' : 'Ana has not said whether the seedlings survived.',
  consistencyStatus: 'CONSISTENT', version: 1, ...extra,
});
const rows = [memory('person'), memory('topic', 'UNRESOLVED_THREAD')];
const client = (candidates = rows) => ({ getSenderContinuity: async () => ({ ok: true, candidates }) });
const pending = () => new Promise(() => {});

test('sender continuity waits independently of the old enrichment deadline without inference', async () => {
  let release;
  const result = loadPostcardSenderContinuity({ visitorId, deadlineMs: 100,
    client: { getSenderContinuity: () => new Promise(resolve => { release = resolve; }) } });
  await new Promise(resolve => setTimeout(resolve, 15));
  release({ ok: true, candidates: rows });
  const sender = await result;
  assert.equal(sender.ready, true);
  assert.deepEqual(sender.selected.map(m => m.id), ['person', 'topic']);
  assert.equal(SENDER_MEMORY_WAIT_MS, 5000);
  assert.equal(POSTCARD_ENRICHMENT_WAIT_MS, 750);
});

test('optional timeout cannot erase PERSON, unresolved topic or returning identity', async () => {
  const sender = await loadPostcardSenderContinuity({ client: client(), visitorId });
  const enrichment = await loadPostcardEnrichment({ requestWorkingContext: pending }, context, sender, { deadlineMs: 10 });
  const recognition = visitorForPrompt({ postcard_count: 80, from_name: 'Ana' });
  const broker = safeBuildContext({ consumer: 'CY_PROSE', currentSenderId: visitorId, items: [
    { id: 'visitor', section: 'visitor_context', provenanceClass: 'PUBLIC VISITOR MATERIAL',
      knowledgeScope: 'CY_OBSERVED', privacyScope: 'SENDER_RECALLABLE', senderId: visitorId,
      content: recognition, mandatory: true }, ...postcardSenderMemoryItems(sender),
    ...Array.from({ length: 25 }, (_, i) => ({ id: `world${i}`, section: 'recent_events',
      provenanceClass: 'OBSERVED BY CY', knowledgeScope: 'CY_OBSERVED', content: 'world '.repeat(200), priority: 99 })),
  ] });
  assert.equal(broker.ok, true);
  assert.match(broker.rendering, /80 postcards/);
  assert.match(broker.rendering, /tends a garden/);
  assert.match(broker.rendering, /seedlings survived/);
  assert.equal(enrichment.status, 'DEADLINE_EXPIRED');
  assert.equal(postcardMemoryReadiness(sender, enrichment).reply_held, false);
  assert.doesNotMatch(JSON.stringify(postcardMemoryReadiness(sender, enrichment)), /Ana|garden|aaaa/);
});

test('required timeout, malformed response and transport failure explicitly hold, never reset identity', async () => {
  for (const getSenderContinuity of [pending, async () => ({}), async () => { throw Error('offline'); }]) {
    const sender = await loadPostcardSenderContinuity({ visitorId, client: { getSenderContinuity }, deadlineMs: 10 });
    assert.equal(sender.ready, false);
    assert.equal(postcardMemoryReadiness(sender).reply_held, true);
    assert.ok(['TIMEOUT', 'UNAVAILABLE'].includes(sender.status));
  }
  const source = await readFile(new URL('./run.js', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('async function doPostcard(pc)'), source.indexOf('const hostile = isHostile(pc.body)'));
  assert.ok(body.indexOf('if (!senderContinuity.ready)') < body.indexOf('postcardInference.route'));
  assert.match(body, /postcard_deferred[\s\S]*return;/);
  assert.match(body, /returning_sender:/);
});

test('timeout aborts the transport; late completion cannot insert records into another turn', async () => {
  let signal, release;
  const sender = await loadPostcardSenderContinuity({ visitorId, deadlineMs: 10, client: {
    getSenderContinuity: options => { signal = options.signal; return new Promise(r => { release = r; }); },
  } });
  assert.equal(signal.aborted, true);
  release({ ok: true, candidates: rows });
  await Promise.resolve();
  assert.equal(sender.ready, false);
  assert.deepEqual(sender.selected, []);
});

test('same-sender privacy and per-type budgets survive hostile or excessive responses', async () => {
  const candidates = [
    ...rows, memory('other-private', 'PERSON', { subjectVisitorId: other }),
    memory('other-public', 'PERSON', { subjectVisitorId: other, privacyScope: 'PUBLIC_RECALLABLE', publicSummary: 'public' }),
    memory('archived', 'PERSON', { status: 'ARCHIVED' }), memory('episodic', 'EPISODIC'),
    ...Array.from({ length: 50 }, (_, i) => memory(`person${i}`, 'PERSON', { content: 'bounded '.repeat(500) })),
    ...Array.from({ length: 50 }, (_, i) => memory(`topic${i}`, 'UNRESOLVED_THREAD', { content: 'topic '.repeat(500) })),
  ];
  const before = structuredClone(candidates);
  const sender = await loadPostcardSenderContinuity({ client: client(candidates), visitorId });
  assert.equal(sender.selected.length, 4);
  assert.ok(sender.selected.every(m => m.content.length <= 600 && m.subjectVisitorId === visitorId));
  assert.equal(sender.selected.filter(m => m.type === 'UNRESOLVED_THREAD').length, 2);
  assert.deepEqual(candidates, before, 'no canonical memory/history writes');
  assert.match(postcardMemoryDirective({ sender, enrichment: { selected: [] } }), /topic topic/);
});

test('real prepared runtime enrichment respects privacy and deduplicates required sender memories', async () => {
  const sender = await loadPostcardSenderContinuity({ client: client(), visitorId });
  const runtime = new AutobiographicalMemoryRuntime({ client: {
    getPreparedMemorySet: async () => ({ prepared_set: { id: 'prepared',
      context_fingerprint: memoryContextFingerprint(context), subject_visitor_id: visitorId,
      selected_memories: [...rows,
        memory('public', 'PERSON', { subjectVisitorId: other, privacyScope: 'PUBLIC_RECALLABLE',
          content: 'SECRET ADDRESS', publicSummary: 'Another visitor described planting beans.' }),
        memory('private', 'PERSON', { subjectVisitorId: other, content: 'SECRET PHONE' }),
      ] } }),
  }, generate: () => { throw Error('no inference'); }, makeId: () => 'unused' });
  const enrichment = await loadPostcardEnrichment(runtime, context, sender);
  assert.deepEqual(enrichment.selected.map(m => m.id), ['public']);
  assert.match(enrichment.selected[0].content, /planting beans/);
  assert.doesNotMatch(JSON.stringify(enrichment.selected), /SECRET/);
  runtime.clearWorking('OTHER_TURN');
  assert.equal(enrichment.selected.length, 1, 'turn-local snapshot');
});

test('optional failure is reported; empty canonical sender result is distinct from failure', async () => {
  const sender = await loadPostcardSenderContinuity({ client: client([]), visitorId });
  assert.equal(sender.ready, true);
  assert.equal(sender.status, 'NO_STORED_MEMORIES');
  const enrichment = await loadPostcardEnrichment({ requestWorkingContext: async () => { throw Error('offline'); } }, context, sender);
  assert.equal(enrichment.status, 'UNAVAILABLE');
  const anonymous = await loadPostcardSenderContinuity({ client: { getSenderContinuity: () => { throw Error('unexpected'); } } });
  assert.equal(anonymous.status, 'NO_SENDER_ID');
});

test('late optional prepared lookup cannot overwrite a newer sender working set', async () => {
  let release;
  const second = { ...context, currentVisitorId: other, text: 'new sender' };
  const prepared = (ctx, memories) => ({ prepared_set: { id: ctx.currentVisitorId,
    context_fingerprint: memoryContextFingerprint(ctx), subject_visitor_id: ctx.currentVisitorId,
    selected_memories: memories } });
  const runtime = new AutobiographicalMemoryRuntime({ client: {
    getPreparedMemorySet: async ({ visitorId: id }) => id === visitorId
      ? new Promise(resolve => { release = resolve; })
      : prepared(second, [memory('second', 'PERSON', { subjectVisitorId: other })]),
  }, generate: () => { throw Error('no inference'); }, makeId: () => 'unused' });
  const sender = await loadPostcardSenderContinuity({ client: client(), visitorId });
  await loadPostcardEnrichment(runtime, context, sender, { deadlineMs: 10 });
  await runtime.requestWorkingContext(second, { deadlineMs: 10 });
  release(prepared(context, rows));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(runtime.working.inspection.subjectVisitorId, other);
  assert.equal(runtime.working.selected[0].id, 'second');
});

test('local and DeepSeek serialize identical protected continuity after optional timeout', async () => {
  const sender = await loadPostcardSenderContinuity({ client: client(), visitorId });
  const enrichment = await loadPostcardEnrichment({ requestWorkingContext: pending }, context, sender, { deadlineMs: 10 });
  const broker = safeBuildContext({ consumer: 'CY_PROSE', currentSenderId: visitorId, items: postcardSenderMemoryItems(sender) });
  const request = canonicalPostcardContext({ postcard: { body: 'hola, do you remember my garden?' },
    directives: buildDirectives({}, 'letter', { sharedContext: broker.rendering }), priorWriting: '', now: '2026-10-05', location: 'CELL' });
  assert.equal(enrichment.selected.length, 0);
  const providers = makeProviders({ model: 'test-local', deepseek: { apiBase: 'https://invalid', model: 'test-cloud' } }, { deepseekKey: 'test-only' });
  const original = globalThis.fetch, requests = [];
  globalThis.fetch = async (_url, options) => { requests.push(JSON.parse(options.body)); return new Response('', { status: 200 }); };
  try {
    await providers.ollama.openStream({ ...request, opts: {}, purpose: 'postcard' });
    await providers.deepseek.openStream({ ...request, opts: {}, purpose: 'postcard' });
    assert.equal(requests[0].system, requests[1].messages[0].content);
    assert.equal(requests[0].prompt, requests[1].messages[1].content);
    assert.match(requests[0].prompt, /tends a garden/);
    assert.match(requests[0].prompt, /seedlings survived/);
    assert.equal(requests[0].prompt.split('tends a garden').length, 2);
  } finally { globalThis.fetch = original; }
});

test('runner uses the frozen postcard snapshot for broker and fallback without global working overwrite', async () => {
  const source = await readFile(new URL('./run.js', import.meta.url), 'utf8');
  assert.match(source, /const memories = postcardMemory \? postcardMemory.enrichment.selected/);
  assert.match(source, /postcardSenderMemoryItems\(postcardMemory.sender\)/);
  assert.match(source, /mandatory: !!postcardMemory, content: visitorContext/);
  assert.match(source, /const memory = brokerOptions.postcardMemory \?/);
  assert.match(source, /const postcardMemory = \{ sender: senderContinuity, enrichment \}/);
});

test('client canonical sender read forwards bounded cancellation and dry run does not use network', async () => {
  const c = new Client({ dryRun: true }, '.');
  const response = await c.getSenderContinuity({ visitorId });
  assert.equal(response.ok, true);
  assert.deepEqual(response.candidates, []);
  const source = await readFile(new URL('./client.js', import.meta.url), 'utf8');
  assert.match(source, /_memoryRequest\('sender_continuity', \{ visitor_id: visitorId, query \}, signal\)/);
});
