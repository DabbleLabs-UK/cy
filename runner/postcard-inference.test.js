import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PostcardInference, postcardInputTokenBound, postcardMayFallback, validatePostcardCandidate } from './postcard-inference.js';
import { canonicalPostcardContext, POSTCARD_CHARACTER } from './postcard-context.js';
import { makeProviders } from './provider.js';
import { generateWithCharacterRepair } from './character-output.js';
import { AutobiographicalMemoryRuntime, memoryContextFingerprint } from './memory-runtime.js';
import { visitorForPrompt } from './cast.js';
import { buildDirectives } from './prompt.js';
import { safeBuildContext } from './context-broker.js';

const config = { apiBase: 'https://cy.invalid', ingestKey: 'test-only', model: 'local',
  deepseek: { apiBase: 'https://provider.invalid', model: 'deepseek-v4-flash' } };
const registry = makeProviders(config, { deepseekKey: 'test-only' });
function fixture(responses) {
  const calls = [];
  const client = new PostcardInference(config, { fetchImpl: async (url, options) => {
    calls.push(JSON.parse(options.body));
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return { ok: true, json: async () => ({ ok: true, ...next }) };
  } });
  return { client, calls };
}

test('one canonical context preserves sender text and separated sources for both providers', async () => {
  const context = canonicalPostcardContext({
    postcard: { from_name: 'Ana', body: 'hola\nwhat do you miss?' },
    directives: 'OBSERVED BY CY: tea arrived\nSUBJECTIVE MEMORY: the old garden\nMODEL ESTIMATE: sleep pressure low',
    priorWriting: 'i keep wondering about the garden', now: '2026-10-05 08:00', location: 'CELL',
  });
  assert.ok(context.prompt.includes('hola\nwhat do you miss?'));
  assert.equal(context.prompt.split('i keep wondering about the garden').length - 1, 1);
  assert.match(context.prompt, /Prior subjective writing, possibly mistaken or outdated/);
  assert.match(context.prompt, /OBSERVED BY CY: tea arrived/);
  assert.match(context.prompt, /SUBJECTIVE MEMORY: the old garden/);
  assert.match(context.system, /Guilt and innocence remain\nunresolved/);
  assert.match(POSTCARD_CHARACTER, /warmth, curiosity, thanks and humour/);
  assert.match(context.system, /Rough lower-case prison shorthand/);
  const realFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return new Response('', { status: 200 });
  };
  try {
    await registry.ollama.openStream({ ...context, opts: { num_predict: 120 }, purpose: 'postcard' });
    await registry.deepseek.openStream({ ...context, opts: { num_predict: 120 }, purpose: 'postcard' });
    assert.equal(requests[0].body.system, requests[1].body.messages[0].content);
    assert.equal(requests[0].body.prompt, requests[1].body.messages[1].content);
    assert.deepEqual(requests[1].body.thinking, { type: 'disabled' });
    await registry.deepseek.openStream({ ...context, opts: {}, purpose: 'journal' });
    assert.equal(requests[2].body.thinking, undefined, 'other provider paths unchanged');
  } finally { globalThis.fetch = realFetch; }
});

test('UTF-8 bound includes conservative envelope and rejects unbounded paid output', async () => {
  assert.equal(postcardInputTokenBound('a', '\u00e9'), 259);
  const { client, calls } = fixture([]);
  const turn = client.turn({ id: 1 }, { provider: 'deepseek', route: 'AUTO' });
  await assert.rejects(() => turn.beforeRequest({ system: '', prompt: '', opts: {}, provider: registry.deepseek }), /bound required/);
  assert.equal(calls.length, 0);
});

test('canonical sender memories, unresolved topics and public recall survive both provider serializations', async () => {
  const sender = 'a'.repeat(32), other = 'b'.repeat(32);
  const current = { text: 'how is the garden?', currentVisitorId: sender, generationRef: 'postcard:80' };
  const base = { type: 'PERSON', status: 'ACTIVE', privacyScope: 'SENDER_RECALLABLE',
    subjectVisitorId: sender, consistencyStatus: 'CONSISTENT', tags: ['garden'], version: 40 };
  const stored = [
    { ...base, id: 'person', content: 'Ana told Cy many cards ago that she tends a garden.' },
    { ...base, id: 'topic', type: 'UNRESOLVED_THREAD', content: 'Ana has not yet said whether the seedlings survived.' },
    { ...base, id: 'public', privacyScope: 'PUBLIC_RECALLABLE', subjectVisitorId: other,
      content: 'PRIVATE original name and address', publicSummary: 'Another visitor also described a garden.' },
    { ...base, id: 'private', subjectVisitorId: other, content: 'PRIVATE other sender conversation' },
  ];
  const snapshot = structuredClone(stored);
  const runtime = new AutobiographicalMemoryRuntime({ client: {
    getPreparedMemorySet: async () => ({ prepared_set: { id: 'existing-prepared',
      context_fingerprint: memoryContextFingerprint(current), subject_visitor_id: sender, selected_memories: stored } }),
    consumePreparedMemorySet: async () => {},
  }, generate: () => { throw Error('no second retrieval/model/store'); }, makeId: () => 'unused' });
  await runtime.requestWorkingContext(current, { deadlineMs: 750 });
  const memory = runtime.consumeWorking(current.generationRef, sender);
  assert.equal(memory.selected.length, 3);
  const visitor = visitorForPrompt({ handle: 'Ana', postcard_count: 80 });
  const brokered = safeBuildContext({ consumer: 'CY_PROSE', currentSenderId: sender, items: [
    { id: 'visitor', section: 'visitor_context', provenanceClass: 'PUBLIC VISITOR MATERIAL',
      knowledgeScope: 'CY_OBSERVED', privacyScope: 'SENDER_RECALLABLE', senderId: sender, content: visitor },
    ...memory.selected.map(m => ({ id: m.id, section: 'autobiographical_memory',
      provenanceClass: 'SUBJECTIVE MEMORY', knowledgeScope: 'CY_BELIEVES',
      privacyScope: m.privacyScope, senderId: m.subjectVisitorId, content: m.content })),
  ] });
  assert.equal(brokered.ok, true);
  const context = canonicalPostcardContext({ postcard: { from_name: 'Ana', body: current.text },
    directives: buildDirectives({}, 'letter', { sharedContext: brokered.rendering }),
    priorWriting: '', now: '2026-10-05', location: 'CELL' });
  assert.match(context.prompt, /80 postcards now/);
  for (const text of ['many cards ago', 'seedlings survived', 'Another visitor also described a garden']) assert.ok(context.prompt.includes(text));
  assert.match(context.prompt, /subjective memory/i);
  assert.doesNotMatch(context.prompt, /PRIVATE|existing-prepared|aaaaaaaaaaaaaaaa/);
  const requests = [], originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => { requests.push(JSON.parse(options.body)); return new Response(''); };
  try {
    await registry.ollama.openStream({ ...context, opts: { num_predict: 120 }, purpose: 'postcard' });
    await registry.deepseek.openStream({ ...context, opts: { num_predict: 120 }, purpose: 'postcard' });
    assert.equal(requests[0].prompt, requests[1].messages[1].content);
    assert.equal(requests[0].system, requests[1].messages[0].content);
  } finally { globalThis.fetch = originalFetch; runtime.stop(); }
  assert.deepEqual(stored, snapshot, 'no mutation of canonical memory');
  const run = await readFile(new URL('./run.js', import.meta.url), 'utf8');
  const body = run.slice(run.indexOf('async function doPostcard('), run.indexOf('// ---- inbox:'));
  assert.ok(body.indexOf('autobiographicalMemory.requestWorkingContext') < body.indexOf('canonicalPostcardContext'));
  assert.doesNotMatch(body, /route\.correspondence/);
});

test('lost reservation acknowledgement never reaches provider and retry retains identity', async () => {
  const { client, calls } = fixture([new Error('response lost'), { execute: false, reason: 'existing_request' }]);
  const turn = client.turn({ id: 42 }, { provider: 'deepseek', route: 'AUTO' });
  const request = { system: 'cy', prompt: 'hola', opts: { num_predict: 93 }, provider: registry.deepseek };
  let providerCalls = 0;
  const attempt = async () => { await turn.beforeRequest(request); providerCalls++; };
  await assert.rejects(attempt);
  await assert.rejects(attempt);
  assert.equal(providerCalls, 0);
  assert.deepEqual(calls[0], calls[1]);
});

test('paid rejected candidates are accounted and repaired once using the same provider', async () => {
  const { client, calls } = fixture([
    { execute: true, request_id: 'initial' }, { cost_gbp: 0.001, cost_usd: 0.002 },
    { execute: true, request_id: 'repair' }, { cost_gbp: 0.002, cost_usd: 0.003 },
  ]);
  const turn = client.turn({ id: 5 }, { provider: 'deepseek', route: 'AUTO' });
  const result = await generateWithCharacterRepair({ prompt: 'hola', generate: async (prompt, { repair }) => {
    await turn.beforeRequest({ system: 'cy', prompt, opts: { num_predict: 93 }, repair, provider: registry.deepseek });
    const r = { candidate: repair ? 'hola ana. glad you wrote.' : 'hello | im end >',
      stats: { usage: { prompt_tokens: 30, completion_tokens: 10, cached_tokens: 4 } } };
    await turn.afterCandidate(r);
    return r;
  } });
  assert.equal(result.characterValidation.finalAction, 'accepted');
  assert.deepEqual(calls.filter(c => c.action === 'reserve').map(c => c.attempt), ['initial', 'repair']);
  assert.equal(calls[1].status, 'validation_rejected');
  assert.equal(calls[1].usage.completion_tokens, 10);
  assert.equal(calls[3].status, 'generated');
  assert.equal(result.stats.cost.gbp, 0.002);
});

test('unknown usage remains explicit, settlement failure prevents acceptance, failed repair is silence', async () => {
  const { client, calls } = fixture([{ execute: true, request_id: 'x' }, new Error('settlement lost')]);
  const turn = client.turn({ id: 5 }, { provider: 'deepseek', route: 'DEEPSEEK' });
  await turn.beforeRequest({ system: '', prompt: '', opts: { num_predict: 93 }, provider: registry.deepseek });
  await assert.rejects(() => turn.afterCandidate({ error: true, stats: { usage_reported: false, usage: { prompt_tokens: 0 } } }));
  assert.equal(calls[1].usage, null);
  assert.equal(await turn.fallback('provider_unavailable'), false);
  let count = 0;
  const result = await generateWithCharacterRepair({ prompt: 'hola', generate: async () => {
    count++; return { candidate: '| im end >' };
  } });
  assert.equal(count, 2);
  assert.equal(result.full, '');
  assert.equal(result.characterDiscarded, true);
});

test('dry run stays local and never reserves cloud; AUTO fallback must be acknowledged', async () => {
  const dry = new PostcardInference({ ...config, dryRun: true }, { fetchImpl: () => { throw Error('network'); } });
  assert.equal((await dry.route({ id: 1 }, registry)).provider, 'ollama');
  const { client, calls } = fixture([{ execute: true }]);
  const turn = client.turn({ id: 6 }, { provider: 'deepseek', route: 'AUTO' });
  assert.equal(await turn.fallback('provider_unavailable'), true);
  assert.equal(turn.route.provider, 'ollama');
  assert.equal(calls[0].action, 'fallback');
});

test('known cap denial permits AUTO fallback; ambiguous reservation never does', async () => {
  assert.equal(validatePostcardCandidate('hello | im end |').ok, false, 'normalization cannot hide raw controls');
  assert.equal(postcardMayFallback({ error: true, accountingError: true, holdReason: 'hour_spend_cap' }), true);
  for (const reason of ['already_reserved', 'turn_not_active', 'accounting_unavailable']) {
    assert.equal(postcardMayFallback({ error: true, accountingError: true, holdReason: reason }), false);
  }
  assert.equal(postcardMayFallback({ error: true, characterDiscarded: true }), false);
  const { client } = fixture([{ execute: false }]);
  await assert.rejects(() => client.turn({ id: 1 }, {}).outcome('generated'), /not accepted/);
});

test('runtime override is postcard-scoped and accounting precedes public chunks', async () => {
  const source = await readFile(new URL('./run.js', import.meta.url), 'utf8');
  assert.equal((source.match(/providerOverride: providers\[/g) || []).length, 1);
  const start = source.indexOf('async function streamGenerate(');
  const end = source.indexOf('async function rawGenerate(', start);
  const body = source.slice(start, end);
  assert.ok(body.indexOf('postcardTurn.beforeRequest') < body.indexOf('gen = await provider.openStream'));
  assert.ok(body.indexOf("postcardTurn.outcome('generated')") < body.indexOf('await onChunk(chunk, mode)'));
  assert.match(body, /generateWithCharacterRepair/);
});
