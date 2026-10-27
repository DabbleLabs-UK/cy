import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { journalTerminationClass, recordJournalTerminationDiagnostic } from './journal-termination-telemetry.js';
import { journalTerminationEvidence, validateJournalPublication } from './character-output.js';
import { makeProviders, deepseekToNdjsonReader } from './provider.js';
import { readNdjsonStream } from './run.js';
import { beforeJournalTerminationTelemetry } from './fixtures/journal-termination-source.mjs';
import { beforeYardContactTurn } from './fixtures/yard-contact-turn-source.mjs';

const BASE = 'aca4c404cf95f4597234a72ce96365c4adb7b50e';
const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const original = path => execFileSync('git', ['show', `${BASE}:${path}`], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).replace(/\r\n/g, '\n');

test('only source-presence metadata and a best-effort private journal diagnostic change existing runtime', () => {
  for (const path of ['runner/run.js', 'runner/provider.js']) {
    assert.notEqual(source(path), original(path));
    assert.equal(beforeJournalTerminationTelemetry(source(path)), original(path), path);
  }
  for (const path of ['runner/character-output.js', 'runner/warden.js', 'runner/prompt.js',
    'runner/inference-coordinator.js', 'runner/memory-runtime.js', 'runner/autobiographical-memory.js',
    'runner/client.js', 'lib/autobiographical_memory.php', 'public/api/memory.php']) {
    assert.equal(path === 'runner/client.js' ? beforeYardContactTurn(source(path)) : source(path), original(path), path);
  }
});

for (const [stats, expected] of [
  [{ done: true, done_reason: 'stop' }, 'stop'],
  [{ done: true, done_reason: 'length' }, 'length'],
  [{ done: true, done_reason: ' LENGTH ' }, 'length'],
  [{ done: true, finish_reason: 'length' }, 'unknown'],
  [null, 'unknown'], [{}, 'unknown'], [{ done: true, eval_count: 93 }, 'unknown'],
  [{ done: false, done_reason: 'length' }, 'unknown'],
  [{ done: true, done_reason: 'new_provider_reason' }, 'unknown'],
]) {
  test(`Ollama terminal metadata ${JSON.stringify(stats)} -> ${expected}`, () => {
    assert.equal(journalTerminationClass(stats, 'ollama'), expected);
    if (expected === 'length') assert.equal(journalTerminationEvidence(stats).explicitLength, true);
  });
}

test('DeepSeek reported reasons stay distinct from the legacy adapter fallback', () => {
  for (const reason of ['stop', 'length', 'content_filter', 'tool_calls', 'insufficient_system_resource', 'new_reason']) {
    const stats = { done: true, finish_reason: reason, provider_finish_reason_reported: true };
    const expected = ['stop', 'length'].includes(reason) ? reason : reason === 'new_reason' ? 'unknown' : 'other';
    assert.equal(journalTerminationClass(stats, 'deepseek'), expected);
    assert.equal(journalTerminationClass({ ...stats, provider_finish_reason_reported: false }, 'deepseek'), 'unknown');
    assert.equal(journalTerminationClass({ done: true, done_reason: reason }, 'deepseek'), 'unknown');
  }
  assert.equal(journalTerminationClass({ done: true, done_reason: 'stop' }, 'unknown-provider'), 'unknown');
  assert.equal(journalTerminationClass({ done: true, done_reason: 'length', finish_reason: 'stop', provider_finish_reason_reported: true }, 'deepseek'), 'unknown');
});

async function read(reader) {
  let text = '', stats = null;
  await readNdjsonStream(reader, {
    onToken: chunk => { text += chunk; }, onDone: value => { stats = value; },
  });
  return { text, stats };
}

function bytes(text) { return new Response(text).body.getReader(); }
function sse(reason) {
  return 'data: ' + JSON.stringify({ choices: [{ delta: { content: 'durin' }, finish_reason: reason }] }) + '\n\n'
    + 'data: ' + JSON.stringify({ usage: { prompt_tokens: 120, completion_tokens: 34 }, choices: [] }) + '\n\n'
    + 'data: [DONE]\n\n';
}

test('real stream decoder preserves Ollama terminal reason without interpreting text/counts', async () => {
  for (const reason of ['stop', 'length', undefined]) {
    const decoded = await read(bytes(JSON.stringify({ response: 'cos...' }) + '\n'
      + JSON.stringify({ done: true, done_reason: reason, eval_count: 34 }) + '\n'));
    assert.equal(decoded.text, 'cos...');
    assert.equal(decoded.stats.done_reason, reason);
    assert.equal(journalTerminationClass(decoded.stats, 'ollama'), reason || 'unknown');
  }
});

test('DeepSeek adapter retains source presence only when requested; all existing stats and content stay equal', async () => {
  for (const reason of ['stop', 'length', null]) {
    const opts = { model: 'synthetic', priceRow: {}, fx: 1 };
    const before = await read(deepseekToNdjsonReader(bytes(sse(reason)), opts));
    const after = await read(deepseekToNdjsonReader(bytes(sse(reason)), { ...opts, retainTerminationSource: true }));
    const { provider_finish_reason_reported, ...unchanged } = after.stats;
    assert.equal(provider_finish_reason_reported, !!reason);
    assert.deepEqual(unchanged, before.stats);
    assert.equal(after.text, before.text);
    assert.equal(journalTerminationClass(after.stats, 'deepseek'), reason || 'unknown');
    assert.deepEqual(journalTerminationEvidence(after.stats), journalTerminationEvidence(before.stats));
    assert.deepEqual(validateJournalPublication(after.text, after.stats), validateJournalPublication(before.text, before.stats));
  }
});

test('actual provider journal path requests no extra call or request field; nonjournal stats remain unchanged', async () => {
  const fetchBefore = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body) });
    return new Response(sse('stop'));
  };
  try {
    const provider = makeProviders({ deepseek: { apiBase: 'https://not-a-real-provider.invalid', model: 'synthetic' } },
      { deepseekKey: 'synthetic-only' }).deepseek;
    for (const purpose of ['journal', 'drawing', 'journal']) {
      const response = await provider.openStream({ system: 'synthetic', prompt: 'synthetic', opts: { num_predict: 93 }, purpose });
      const { stats } = await read(response.reader);
      assert.equal(Object.hasOwn(stats, 'provider_finish_reason_reported'), purpose === 'journal');
    }
    assert.equal(requests.length, 3);
    for (const request of requests) assert.deepEqual(request, requests[0]);
    assert.equal(requests[0].body.max_tokens, 93);
  } finally { globalThis.fetch = fetchBefore; }
});

function finishFixture({ purpose = 'journal', stats = null, sink = () => {} } = {}) {
  const text = source('runner/run.js');
  const start = text.indexOf('      const finishRequest = async () => {');
  const end = text.indexOf('\n      try {', start);
  assert.ok(start >= 0 && end > start);
  const calls = { finish: 0, release: 0, tempo: 0 };
  const finish = runInNewContext(`(function() {
    let requestFinished = false;
    ${text.slice(start, end)}
    return finishRequest;
  })()`, {
    generationCancellation: { clear() {} }, ac: { signal: { aborted: false } }, cancelTimeout() {},
    hostLease: { async release() { calls.release++; } }, lease: { id: 'synthetic-request', finish() { calls.finish++; } },
    inferenceTempoPacer: { record() { calls.tempo++; } }, t0: 1, purpose, mode: 'journal',
    transportResult: 'ok', ttftMs: 2, candidate: 'SECRET CONTENT MUST NOT ENTER DIAGNOSTIC',
    inferenceStats: () => ({}), stats, requestPurpose: purpose, provider: { id: 'ollama' },
    recordInferenceDiagnostic: sink, recordJournalTerminationDiagnostic, calls,
  });
  return { finish, calls };
}

test('actual final cleanup records journal attempts once without leaking candidate/stats; other purposes excluded', async () => {
  for (const purpose of ['journal', 'drawing', 'postcard', 'warden']) {
    const events = [];
    const f = finishFixture({ purpose, stats: { done: true, done_reason: 'length', secret: 'payload' }, sink: e => events.push(e) });
    await f.finish(); await f.finish();
    assert.deepEqual(f.calls, { finish: 1, release: 1, tempo: 1 });
    assert.equal(events.length, purpose === 'journal' ? 1 : 0);
    if (events.length) {
      assert.deepEqual(Object.keys(events[0]).sort(), ['at', 'event', 'id', 'termination']);
      assert.equal(events[0].event, 'journal-termination');
      assert.equal(events[0].termination, 'length');
      assert.equal(events[0].id, 'synthetic-request');
    }
  }
});

test('diagnostic sink/access failures cannot alter actual request cleanup, pacing or lease release', async () => {
  for (const sink of [() => { throw new Error('disk'); }, () => Promise.reject(new Error('disk'))]) {
    const f = finishFixture({ stats: { done: true, done_reason: 'stop' }, sink });
    await f.finish();
    assert.deepEqual(f.calls, { finish: 1, release: 1, tempo: 1 });
  }
  const stats = { get done() { throw new Error('unavailable'); } };
  assert.doesNotThrow(() => recordJournalTerminationDiagnostic(() => {}, { id: 'offline', stats, provider: 'ollama' }));
});
