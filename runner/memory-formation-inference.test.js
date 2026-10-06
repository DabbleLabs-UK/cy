import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryFormationInference, formationInputTokenBound } from './memory-formation-inference.js';
import { deepseekFormationRequest, makeProviders } from './provider.js';
import { buildFormationRequest, parseFormationResponse } from './autobiographical-memory.js';
import { options } from './prompt.js';

const config = { apiBase: 'https://cy.invalid', ingestKey: 'test-only', model: 'local', threads: 4,
  deepseek: { apiBase: 'https://provider.invalid', model: 'deepseek-v4-flash' } };
const sender = 'a'.repeat(32);
const source = { sourceType: 'POSTCARD', sourceId: 'fixture', occurredAt: '2026-10-06T12:00:00Z',
  text: 'My dog is called Alfie.', subjectVisitorId: sender, sourceVisibility: 'SENDER_RECALLABLE' };
const job = { id: 1, claim_token: 'claim-one', source };
const call = buildFormationRequest(source);
const usage = { prompt_tokens: 100, completion_tokens: 20, cached_tokens: 10 };
const grant = { execute: true, request_id: 'request-one', mode: 'DEEPSEEK', provider: 'deepseek',
  configured_model: config.deepseek.model };
function setup(responses = [grant, {}], { available = true, generate } = {}) {
  const accounting = [], requests = [], local = [];
  const adapter = new MemoryFormationInference(config, { fetchImpl: async (url, opts) => {
    assert.equal(url, 'https://cy.invalid/api/memory-formation-inference.php');
    assert.equal(opts.headers['X-Cy-Key'], 'test-only');
    const body = JSON.parse(opts.body); accounting.push(body);
    const response = responses.shift();
    if (response instanceof Error) throw response;
    assert.notEqual(response, undefined, 'unexpected extra accounting request');
    return { ok: true, json: async () => ({ ok: true, ...response }) };
  } });
  const providers = {
    ollama: { modelFor: () => 'local' },
    deepseek: { available: () => available, formationGenerate: async request => {
      requests.push(request);
      return generate ? generate(request) : { ok: true, text: '{"decision":"NOTHING"}',
        model: 'deepseek-flash', stats: { usage_reported: true, usage } };
    } },
  };
  const localGenerate = async value => { local.push(value); return '{"decision":"NOTHING"}'; };
  const run = (override = {}) => adapter.generate({ job, call, providers, localGenerate, ...override });
  return { adapter, accounting, requests, local, providers, run };
}

test('strict forced-tool schema preserves disjoint canonical actions and exact candidate sets', () => {
  const candidate = { id: 'topic', type: 'UNRESOLVED_THREAD', status: 'ACTIVE', version: 1,
    subjectVisitorId: sender, privacyScope: 'SENDER_RECALLABLE', content: 'A result remains unknown.' };
  const request = buildFormationRequest(source, [candidate]);
  const body = deepseekFormationRequest({ ...request, opts: options({}, 4, 'journal', request.options), model: config.deepseek.model });
  assert.deepEqual(body.messages, [{ role: 'system', content: request.system }, { role: 'user', content: request.prompt }]);
  assert.equal(body.thinking.type, 'disabled'); assert.equal(body.max_tokens, 260);
  assert.equal(body.temperature, .1); assert.equal(body.top_p, .86);
  assert.equal(body.tools[0].function.strict, true);
  assert.deepEqual(body.tool_choice, { type: 'function', function: { name: 'formation_decision' } });
  const parameters = body.tools[0].function.parameters;
  assert.equal(parameters.additionalProperties, false);
  assert.deepEqual(parameters.required, ['result']);
  const branches = parameters.properties.result.anyOf;
  assert.deepEqual(branches.map(branch => branch.properties.decision.enum[0]), ['NOTHING', 'CREATE', 'UPDATE', 'RESOLVE']);
  assert.equal(branches[1].properties.content.pattern, '^[\\s\\S]{1,480}$');
  assert.deepEqual(branches[2].properties.memoryRef.enum, ['FM1']);
  assert.deepEqual(branches[3].properties.memoryRef.enum, ['FM1']);
  for (const branch of branches) assert.equal(branch.additionalProperties, false);
  assert.equal(body.messages[1].content.includes(sender), false);
});

test('strict schema rejects unexpected nondisjoint schemas and unbounded output before admission', async () => {
  const fixture = setup([]);
  await assert.rejects(fixture.run({ call: { ...call, options: { ...call.options, num_predict: 261 } } }), { reason: 'invalid_request' });
  await assert.rejects(fixture.run({ call: { ...call, format: { oneOf: [call.format.oneOf[0], call.format.oneOf[0]] } } }), { reason: 'invalid_request' });
  assert.equal(fixture.accounting.length, 0); assert.equal(fixture.requests.length, 0);
});

test('admission includes entire exact provider body and conservative framing bound', async () => {
  const f = setup(); const result = await f.run();
  const body = deepseekFormationRequest({ ...call, opts: options({}, 4, 'journal', call.options), model: config.deepseek.model });
  assert.equal(f.accounting[0].input_tokens, Buffer.byteLength(JSON.stringify(body), 'utf8') + 4096);
  assert.equal(formationInputTokenBound({ unicode: '\u00e9' }), Buffer.byteLength(JSON.stringify({ unicode: '\u00e9' })) + 4096);
  assert.equal(f.accounting[0].max_output_tokens, 260);
  assert.deepEqual(f.accounting[1].usage, usage);
  assert.equal(f.accounting[1].actual_model, 'deepseek-flash');
  assert.equal(result.configuredModel, 'deepseek-v4-flash'); assert.equal(result.actualModel, 'deepseek-flash');
  assert.equal(result.requestId, 'request-one'); assert.equal(result.mode, 'DEEPSEEK');
  assert.equal(f.requests.length, 1); assert.equal(f.local.length, 0);
});

test('explicit LOCAL alone uses unchanged canonical local request and still settles', async () => {
  const f = setup([{ ...grant, provider: 'ollama', mode: 'LOCAL', configured_model: 'local' }, {}]);
  const result = await f.run();
  assert.equal(result.provider, 'ollama'); assert.equal(result.actualModel, 'local');
  assert.deepEqual(f.local[0], { ...call, senderFormationLocal: true }); assert.equal(f.requests.length, 0);
  assert.equal(f.accounting[1].status, 'generated'); assert.equal(f.accounting[1].usage, null);
});

test('LOCAL unavailable foreground capacity remains an operational retry, not a cloud fallback', async () => {
  const f = setup([{ ...grant, provider: 'ollama', mode: 'LOCAL', configured_model: 'local' }, {}]);
  await assert.rejects(f.run({ localGenerate: async () => {
    const error = new Error('local_busy'); error.memoryFailureReason = 'local_busy'; throw error;
  } }), { memoryFailureReason: 'local_busy', mode: 'LOCAL', provider: 'ollama' });
  assert.equal(f.accounting[1].reason, 'local_busy'); assert.equal(f.accounting[1].status, 'failed');
  assert.equal(f.requests.length, 0);
});

test('dry run never reserves or invokes a paid sender formation request', async () => {
  const f = setup([]);
  f.adapter.config = { ...config, dryRun: true };
  await assert.rejects(f.run(), { memoryFailureReason: 'disabled', mode: 'OFF', provider: null });
  assert.equal(f.accounting.length, 0); assert.equal(f.requests.length, 0); assert.equal(f.local.length, 0);
});

test('OFF, missing credentials and cap holds are visible and never fall back locally', async () => {
  for (const reason of ['disabled', 'credentials_missing', 'day_spend_cap', 'concurrency_full']) {
    const f = setup([{ ...grant, execute: false, mode: reason === 'disabled' ? 'OFF' : 'DEEPSEEK', reason }], { available: false });
    await assert.rejects(f.run(), error => error.memoryFailureReason === reason && error.requestId === 'request-one');
    assert.equal(f.accounting[0].cloud_available, false);
    assert.equal(f.requests.length, 0); assert.equal(f.local.length, 0);
  }
});

test('ambiguous reservation response cannot dispatch and replay holds remain non-dispatching', async () => {
  const f = setup([new Error('HTTP response lost'), { ...grant, execute: false, reason: 'already_reserved' }]);
  await assert.rejects(f.run(), { memoryFailureReason: 'budget_unavailable' });
  await assert.rejects(f.run(), { memoryFailureReason: 'already_reserved' });
  assert.deepEqual(f.accounting[0], f.accounting[1]);
  assert.equal(f.requests.length, 0); assert.equal(f.local.length, 0);
});

test('same granted reservation cannot issue a second paid call in one runner', async () => {
  const f = setup([grant, {}, grant]);
  await f.run(); await assert.rejects(f.run(), { memoryFailureReason: 'already_reserved' });
  assert.equal(f.requests.length, 1);
  assert.equal(f.accounting.filter(x => x.action === 'settle').length, 1);
});

test('provider errors, timeout, cancellation and rate limit settle once with no local fallback', async () => {
  const cases = [
    { generate: () => { throw new TypeError('private provider content must not leak'); }, reason: 'transport_failure' },
    { generate: () => { throw new DOMException('deadline', 'TimeoutError'); }, reason: 'timeout' },
    { generate: () => { throw new DOMException('abort', 'AbortError'); }, reason: 'cancelled' },
    { generate: () => ({ ok: false, status: 429, reason: 'rate_limit' }), reason: 'rate_limit' },
  ];
  for (const entry of cases) {
    const f = setup([grant, {}], entry);
    await assert.rejects(f.run(), error => error.memoryFailureReason === entry.reason && !error.message.includes('private'));
    assert.equal(f.accounting[1].reason, entry.reason);
    assert.equal(f.accounting[1].usage, null);
    assert.equal(f.local.length, 0); assert.equal(f.requests.length, 1);
  }
});

test('unknown usage remains unknown and accounting failure cannot return an applicable decision', async () => {
  const f = setup([grant, {}], { generate: () => ({ ok: true, text: '{"decision":"NOTHING"}', model: 'deepseek-flash', stats: { usage_reported: false } }) });
  await f.run(); assert.equal(f.accounting[1].usage, null);
  const failed = setup([grant, new Error('settlement acknowledgement lost')]);
  await assert.rejects(failed.run(), error => error.memoryFailureReason === 'accounting_unavailable' && error.requestId === 'request-one');
  assert.equal(failed.requests.length, 1); assert.equal(failed.local.length, 0);
});

test('sender provenance is required; other memory work cannot reach the cloud adapter', async () => {
  for (const bad of [{ ...source, sourceType: 'ENVIRONMENT_EVENT' }, { ...source, subjectVisitorId: null },
    { ...source, sourceVisibility: 'PUBLIC_RECALLABLE' }]) {
    const f = setup([]);
    await assert.rejects(f.run({ job: { ...job, source: bad } }), { reason: 'invalid_request' });
    assert.equal(f.accounting.length, 0);
  }
});

test('formation provider uses beta strict tool, preserves actual alias and unwraps canonical decision only', async () => {
  const original = globalThis.fetch; const requests = [];
  globalThis.fetch = async (url, opts) => {
    requests.push({ url, body: JSON.parse(opts.body) });
    return { ok: true, status: 200, json: async () => ({ model: 'deepseek-flash',
      choices: [{ finish_reason: 'tool_calls', message: { content: null,
        tool_calls: [{ function: { name: 'formation_decision', arguments: '{"result":{"decision":"CREATE","type":"PERSON","content":"The sender says their dog is called Alfie."}}' } }] } }],
      usage: { prompt_tokens: 200, completion_tokens: 30, prompt_cache_hit_tokens: 70 } }) };
  };
  try {
    const registry = makeProviders(config, { deepseekKey: 'test-only' });
    const result = await registry.deepseek.formationGenerate({ ...call, opts: options({}, 4, 'journal', call.options) });
    assert.equal(requests[0].url, 'https://provider.invalid/beta/chat/completions');
    assert.equal(result.model, 'deepseek-flash'); assert.equal(result.configuredModel, 'deepseek-v4-flash');
    assert.equal(result.stats.usage.cached_tokens, 70);
    const parsed = parseFormationResponse(result.text, { source, makeId: () => 'new-memory' });
    assert.equal(parsed.valid, true); assert.equal(parsed.type, 'PERSON');
    assert.equal(parsed.privacyScope, 'SENDER_RECALLABLE'); assert.equal(parsed.source.subjectVisitorId, sender);
    await registry.deepseek.rawGenerate({ system: 'unchanged', prompt: 'postcard', opts: { num_predict: 93 }, purpose: 'postcard' });
    assert.equal(requests[1].url, 'https://provider.invalid/chat/completions');
    assert.equal(requests[1].body.tools, undefined); assert.equal(requests[1].body.max_tokens, 93);
  } finally { globalThis.fetch = original; }
});

test('malformed tool envelope is not accepted as prose or a model decision; usage is retained', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ model: 'deepseek-flash',
    choices: [{ message: { content: 'not JSON', tool_calls: [{ function: { name: 'other_tool', arguments: '{}' } }] } }],
    usage: { prompt_tokens: 5, completion_tokens: 2 } }) });
  try {
    const provider = makeProviders(config, { deepseekKey: 'test-only' }).deepseek;
    const result = await provider.formationGenerate({ ...call, opts: options({}, 4, 'journal', call.options) });
    assert.equal(result.text, ''); assert.equal(result.stats.usage_reported, true);
    assert.equal(result.stats.formation_transport_valid, false);
    assert.equal(parseFormationResponse(result.text, { source }).rejectionCode, 'JSON_FORMAT');
  } finally { globalThis.fetch = original; }
});
