import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { AutobiographicalMemoryRuntime } from './memory-runtime.js';
import { MemoryFormationInferenceError } from './memory-formation-inference.js';

const source = { sourceType: 'POSTCARD', sourceId: 'synthetic:sender-route',
  text: 'My dog is called Alfie.', subjectVisitorId: 'a'.repeat(32),
  sourceVisibility: 'SENDER_RECALLABLE', participantLabel: 'the sender' };
const job = { id: 41, claim_token: 'claim-fixture', source };
function fixture(senderFormationGenerate, generate = async () => { throw new Error('unexpected local inference'); }) {
  const completions = [];
  const runtime = new AutobiographicalMemoryRuntime({
    client: { queryMemories: async () => ({ candidates: [] }),
      finishMemorySource: async (value) => { completions.push(value); return { result_category: value.result_category }; } },
    makeId: () => '00000000-0000-4000-8000-000000000091', generate, senderFormationGenerate,
    providerInfo: () => ({ id: 'ollama', model: 'local-fixture' }), backgroundTimeoutMs: 5000,
  });
  return { runtime, completions };
}
function result(text = '{"decision":"CREATE","type":"PERSON","content":"The sender has a dog named Alfie."}') {
  return { text, requestId: 'formation-reservation', provider: 'deepseek', mode: 'DEEPSEEK',
    configuredModel: 'deepseek-v4-flash', actualModel: 'deepseek-flash' };
}

test('remote sender decision uses canonical parser/provenance and one transactional accounting receipt', async () => {
  const { runtime, completions } = fixture(async ({ job: received, call }) => {
    assert.equal(received, job);
    assert.ok(call.format.oneOf.length);
    assert.match(call.system, /conservatively abstract only supported facts/);
    return result();
  });
  assert.equal((await runtime.processFormation(job)).status, 'CREATE');
  const completed = completions[0];
  assert.equal(completed.provider, 'deepseek');
  assert.equal(completed.model, 'deepseek-flash');
  assert.equal(completed.formation_request_id, 'formation-reservation');
  assert.equal(completed.operations[0].privacyScope, 'SENDER_RECALLABLE');
  assert.equal(completed.operations[0].source.subjectVisitorId, source.subjectVisitorId);
  assert.equal(completed.operations[0].source.sourceId, source.sourceId);
});

test('malformed cloud decisions still use the same invalid-decision boundary', async () => {
  const { runtime, completions } = fixture(async () => result('not JSON'));
  assert.equal((await runtime.processFormation(job)).status, 'INVALID');
  assert.equal(completions[0].rejection_code, 'JSON_FORMAT');
  assert.deepEqual(completions[0].operations, []);
});

test('cloud holds/failures stay retryable and never consume the invalid decision category', async () => {
  for (const reason of ['off', 'credentials_missing', 'hour_request_cap', 'rate_limit', 'transport_failure', 'accounting_unavailable']) {
    const { runtime, completions } = fixture(async () => { throw new MemoryFormationInferenceError(reason,
      { mode: 'DEEPSEEK', provider: null, requestId: 'held-receipt' }); });
    assert.equal((await runtime.processFormation(job)).status, 'ERROR');
    assert.equal(completions[0].error, reason);
    assert.equal(completions[0].formation_request_id, 'held-receipt');
    assert.equal(completions[0].provider, undefined);
    assert.deepEqual(completions[0].operations, []);
  }
});

test('foreground local work cannot preempt remote extraction but shutdown cancels it', async () => {
  let entered, signal;
  const started = new Promise(resolve => { entered = resolve; });
  const { runtime, completions } = fixture(async ({ call }) => {
    signal = call.signal;
    entered();
    await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(
      new MemoryFormationInferenceError('cancelled', { mode: 'DEEPSEEK', requestId: 'inflight' })), { once: true }));
  });
  const pending = runtime.processFormation(job);
  await started;
  runtime.interruptBackground('foreground');
  runtime.interruptBackground('interactive');
  assert.equal(signal.aborted, false);
  runtime.stop();
  await pending;
  assert.equal(completions[0].result_category, 'PREEMPTED');
  assert.equal(runtime.remoteFormationActive, false);
});

test('explicit local sender mode keeps foreground preemption and canonical parser', async () => {
  let runtime;
  const made = fixture(async ({ call, localGenerate }) => ({ ...result(), provider: 'ollama', mode: 'LOCAL',
    text: await localGenerate(call) }), async call => {
    assert.equal(runtime.remoteFormationActive, false);
    runtime.interruptBackground('foreground');
    assert.equal(call.signal.aborted, true);
    throw Object.assign(new Error('aborted'), { name: 'AbortError' });
  });
  runtime = made.runtime;
  assert.equal((await runtime.processFormation(job)).status, 'PREEMPTED');
});

test('pause or shutdown during retrieval cannot launch paid formation afterward', async () => {
  for (const reason of ['pause', 'shutdown']) {
    let finishRead, calls = 0;
    const { runtime, completions } = fixture(async () => { calls++; return result(); });
    runtime.client.queryMemories = () => new Promise(resolve => { finishRead = resolve; });
    const pending = runtime.processFormation(job);
    runtime.interruptBackground(reason);
    finishRead({ candidates: [] });
    await pending;
    assert.equal(calls, 0);
    assert.equal(completions[0].result_category, 'PREEMPTED');
    assert.equal(completions[0].formation_request_id, undefined);
  }
});

test('foreground during sender retrieval does not cancel subsequent remote formation', async () => {
  let finishRead, calls = 0;
  const { runtime, completions } = fixture(async () => { calls++; return result(); });
  runtime.client.queryMemories = () => new Promise(resolve => { finishRead = resolve; });
  const pending = runtime.processFormation(job);
  runtime.interruptBackground('foreground');
  finishRead({ candidates: [] });
  assert.equal((await pending).status, 'CREATE');
  assert.equal(calls, 1);
  assert.equal(completions[0].provider, 'deepseek');
});

test('non-sender formation remains on the original local callback', async () => {
  let localCalls = 0;
  const { runtime, completions } = fixture(async () => { throw new Error('unexpected sender route'); }, async () => {
    localCalls++; return '{"decision":"NOTHING"}';
  });
  await runtime.processFormation({ ...job, source: { sourceType: 'ENVIRONMENT_EVENT', sourceId: 'event:1', text: 'The door closed.' } });
  assert.equal(localCalls, 1);
  assert.equal(completions[0].provider, 'ollama');
  assert.equal(completions[0].formation_request_id, undefined);
});

test('server-selected LOCAL rechecks pacing after admission rather than trusting a stale mode hint', async () => {
  let localCalls = 0;
  const { runtime, completions } = fixture(async ({ call, localGenerate }) => {
    return { ...result(), text: await localGenerate(call), provider: 'ollama', mode: 'LOCAL' };
  }, async () => { localCalls++; return '{"decision":"NOTHING"}'; });
  runtime.canRunBackground = kind => kind === 'sender_formation';
  await runtime.processFormation(job);
  assert.equal(localCalls, 0);
  assert.equal(completions[0].result_category, 'ERROR');
  assert.equal(completions[0].error, 'local_busy');
});

test('production wiring makes sender admission independent of local tempo/lease while LOCAL is rechecked', async () => {
  const run = await readFile(new URL('./run.js', import.meta.url), 'utf8');
  assert.match(run, /senderFormationGenerate:.*senderFormationInference\.generate\(/s);
  assert.match(run, /kind === 'sender_formation'\s*\? !client\.paused/);
  assert.match(run, /providerOverride: call\.senderFormationLocal \? providers\[OLLAMA\] : null/);
});
