import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { AutobiographicalMemoryRuntime, memoryContextFingerprint, isJournalSurfacingContext } from './memory-runtime.js';
import { publicMemoryQueryTelemetry, filterMemoriesBeforePrompt } from './autobiographical-memory.js';
import { Client } from './client.js';

const BASE = 'ecd0064974f440394935cf297b901230c2368b91';
const memory = { id: '00000000-0000-4000-8000-000000000001', type: 'EPISODIC',
  status: 'ACTIVE', privacyScope: 'INTERNAL_ONLY', content: 'Cy remembers a real yard visit.',
  consistencyStatus: 'CONSISTENT', originKind: 'ENVIRONMENT_EVENT', tags: ['yard'] };
const a = { text: 'yard', location: 'cell', generationRef: 'journal:1000' };
const b = { text: 'a different current event', location: 'cell', generationRef: 'journal:2000' };
const job = context => ({ id: 1, context, context_fingerprint: memoryContextFingerprint(context), subject_visitor_id: null });
function setup(overrides = {}) {
  const calls = { query: 0, model: 0, completed: [], enqueued: [], consumed: [], ledger: [] };
  const client = {
    async getPreparedMemorySet() { return { prepared_set: null }; },
    async enqueueMemorySurfacing(value) { calls.enqueued.push(value); },
    async queryMemories() { calls.query++; return { candidates: [structuredClone(memory)] }; },
    async completeMemorySurfacing(value) { calls.completed.push(value); return { status: value.result_category }; },
    async recordMemoryQuery(value) { calls.ledger.push(value); },
    async consumePreparedMemorySet(value) { calls.consumed.push(value); },
    async claimMemorySource() { return { job: null }; },
    async claimMemorySurfacing() { return { job: null }; },
    ...overrides.client,
  };
  const r = new AutobiographicalMemoryRuntime({ client, makeId: () => '00000000-0000-4000-8000-000000000002',
    generate: async call => { calls.model++; return overrides.generate ? overrides.generate(call) : '{"memoryRefs":["C1"]}'; },
    backgroundTimeoutMs: 10_000, canRunBackground: () => true });
  return { r, calls, client };
}

test('only the authoritative no-sender journal namespace is journal surfacing', () => {
  assert.equal(isJournalSurfacingContext(a), true);
  for (const generationRef of ['', 'journal', 'journal:abc', 'journal:1000\n', 'JOURNAL:1000', 'postcard:1000', 'journal-prose:1000']) {
    assert.equal(isJournalSurfacingContext({ generationRef }), false, generationRef);
  }
  assert.equal(isJournalSurfacingContext(a, 'a'.repeat(32)), false);
});

test('claim transmits the current desired fingerprint, not an age or queue position', async () => {
  const { r, client } = setup(); const claims = [];
  client.claimMemorySurfacing = async input => { claims.push(input); return { job: null }; };
  r.stopped = false;
  r.schedule = () => {};
  await r.requestWorkingContext(a);
  await r.tick();
  assert.deepEqual(claims, [{ journal_context_fingerprint: memoryContextFingerprint(a) }]);
  r.stop();
});

test('restart explicitly claims with no live journal desire, not a persisted historical desire', async () => {
  const { r, client } = setup(); let claim;
  client.claimMemorySurfacing = async input => { claim = input; return { job: null }; };
  r.stopped = false; r.schedule = () => {};
  await r.tick();
  assert.deepEqual(claim, { journal_context_fingerprint: null });
  r.stop();
});

test('the API client preserves explicit null authority on the wire', async () => {
  const client = Object.create(Client.prototype); let sent;
  client._memoryRequest = async (action, value) => { sent = { action, value }; };
  await client.claimMemorySurfacing({ journal_context_fingerprint: null });
  assert.deepEqual(sent, { action: 'claim_surfacing', value: { journal_context_fingerprint: null } });
});

test('a stale claim returned after a desired-context change does no query or model work', async () => {
  const { r, calls } = setup();
  await r.requestWorkingContext(b);
  await r.processSurfacing(job(a));
  assert.equal(calls.query, 0); assert.equal(calls.model, 0);
  assert.equal(calls.completed[0].result_category, 'SUPERSEDED');
  assert.match(calls.completed[0].error, /before retrieval/);
  assert.equal(calls.ledger.length, 0);
  assert.equal(r.working.inspection.status, 'PENDING');
});

test('many persisted obsolete contexts have zero retrieval calls under the current authority', async () => {
  const { r, calls } = setup();
  await r.requestWorkingContext(b);
  for (let i = 0; i < 215; i++) await r.processSurfacing(job({ ...a, text: `obsolete ${i}` }));
  assert.equal(calls.query, 0); assert.equal(calls.model, 0);
  assert.equal(calls.completed.filter(x => x.result_category === 'SUPERSEDED').length, 215);
  await r.processSurfacing(job(b));
  assert.equal(calls.query, 1); assert.equal(calls.model, 1);
  assert.equal(r.working.inspection.status, 'PREPARED');
  assert.equal(calls.completed.at(-1).selected_memories[0].id, memory.id);
});

test('a context superseded during indexed search cannot start model selection', async () => {
  const { r, calls, client } = setup();
  await r.requestWorkingContext(a);
  client.queryMemories = async () => { calls.query++; await r.requestWorkingContext(b); return { candidates: [memory] }; };
  await r.processSurfacing(job(a));
  assert.equal(calls.query, 1); assert.equal(calls.model, 0);
  assert.equal(calls.completed[0].result_category, 'SUPERSEDED');
  assert.equal(calls.ledger.length, 0);
});

test('already in-flight obsolete selection cannot activate or pretend insertion into the newer context', async () => {
  let started, release;
  const ready = new Promise(resolve => { started = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  const { r, calls } = setup({ generate: async () => { started(); await blocked; return '{"memoryRefs":["C1"]}'; } });
  await r.requestWorkingContext(a);
  const work = r.processSurfacing(job(a));
  await ready;
  assert.equal(calls.query, 1);
  assert.equal(r.working.inspection.status, 'PENDING');
  assert.equal(publicMemoryQueryTelemetry(r.working.inspection).retrieval_attempted, null,
    'prompt readiness does not falsely report an in-flight search as unattempted');
  await r.requestWorkingContext(b);
  release(); await work;
  assert.equal(calls.model, 1, 'one call admitted while A was current, no replacement call');
  assert.equal(calls.completed[0].result_category, 'SUPERSEDED');
  assert.deepEqual(calls.completed[0].selected_memories, []);
  assert.equal(calls.ledger.length, 0);
  assert.equal(r.working.inspection.status, 'PENDING');
});

test('a server supersession acknowledgement cannot activate a late prepared result', async () => {
  const { r, calls } = setup({ client: { async completeMemorySurfacing() { return { status: 'SUPERSEDED' }; } } });
  await r.requestWorkingContext(a); await r.processSurfacing(job(a));
  assert.equal(r.working.inspection.status, 'PENDING');
  assert.equal(calls.ledger.length, 0);
});

test('normal current request still prepares eligible fallible memory without mutating its source', async () => {
  const before = structuredClone(memory);
  const { r, calls } = setup();
  await r.requestWorkingContext(a); await r.processSurfacing(job(a));
  assert.equal(calls.completed[0].selected_memories.length, 1);
  assert.equal(calls.completed[0].result_category, 'PREPARED');
  r.consumeWorking('journal-prose:1000');
  assert.equal(calls.consumed.length, 1);
  assert.deepEqual(memory, before);
});

test('same compatible fingerprint remains usable across generation references', async () => {
  const { r, calls } = setup();
  await r.requestWorkingContext(a);
  await r.requestWorkingContext({ ...a, generationRef: 'journal:3000' });
  await r.processSurfacing(job(a));
  assert.equal(calls.completed[0].result_category, 'PREPARED');
  assert.equal(calls.completed[0].selected_memories.length, 1);
});

test('existing valid full-record prepared cache still activates and is consumed normally', async () => {
  const { r, calls } = setup({ client: { async getPreparedMemorySet() {
    return { prepared_set: { id: 'set-full-record', context_fingerprint: memoryContextFingerprint(a),
      selected_memories: [memory], expires_at: new Date(Date.now() + 60_000).toISOString() } };
  } } });
  const working = await r.requestWorkingContext(a);
  assert.equal(working.selected.length, 1);
  assert.match(working.directive, /subjective autobiographical memory/);
  r.consumeWorking('journal-prose:1000');
  assert.equal(calls.consumed.length, 1);
  assert.equal(calls.model, 0);
});

test('pre-existing status loss reproduces with baseline projection; fixed projection activates', async () => {
  const warden = new URL('./warden.js', import.meta.url).href;
  const oldMemorySource = execFileSync('git', ['show', `${BASE}:runner/autobiographical-memory.js`], { encoding: 'utf8' })
    .replace("from './warden.js'", `from '${warden}'`);
  const file = 'data:text/javascript;base64,' + Buffer.from(oldMemorySource).toString('base64');
  const baseSource = execFileSync('git', ['show', `${BASE}:runner/memory-runtime.js`], { encoding: 'utf8' })
    .replace("from './autobiographical-memory.js'", `from '${file}'`)
    .replace("from './warden.js'", `from '${warden}'`);
  const { AutobiographicalMemoryRuntime: OldRuntime } = await import('data:text/javascript;base64,' + Buffer.from(baseSource).toString('base64'));
  const { r, client, calls } = setup();
  const old = new OldRuntime({ client, makeId: () => 'base-set', generate: async () => '{"memoryRefs":["C1"]}' });
  await old.requestWorkingContext(a); await old.processSurfacing(job(a));
  await r.requestWorkingContext(a); await r.processSurfacing(job(a));
  assert.equal(calls.completed[0].selected_memories.length, 1);
  assert.equal(calls.completed[1].selected_memories.length, 1);
  assert.equal(old.working.selected.length, 0, 'baseline drops projected records with no status');
  assert.equal(r.working.selected.length, 1);
  assert.equal(r.working.selected[0].status, memory.status);
});

test('unrelated optional consumer is not classified as obsolete journal work', async () => {
  const { r, calls } = setup();
  await r.processSurfacing(job({ ...a, generationRef: 'other:1000' }));
  assert.equal(calls.query, 1); assert.equal(calls.model, 1);
  assert.equal(calls.completed[0].result_category, 'PREPARED');
  assert.equal(r.obsoleteJournalSurfacing({ ...job(a), sender_scope_key: 'a'.repeat(32) }, a), false,
    'unknown inconsistent sender-scoped work is not discarded as a journal');
});

test('a genuine zero-candidate result remains different from pending and superseded', async () => {
  const { r, calls } = setup({ client: { async queryMemories() { return { candidates: [] }; } } });
  await r.requestWorkingContext(a); await r.processSurfacing(job(a));
  assert.equal(calls.model, 0);
  assert.equal(calls.completed[0].result_category, 'NO_CANDIDATES');
  assert.equal(r.working.inspection.status, 'PREPARED');
});

test('pending telemetry means readiness unknown, not zero hits; unrelated existing counts stay intact', () => {
  const pending = publicMemoryQueryTelemetry({ status: 'PENDING' });
  assert.equal(pending.retrieval_attempted, null);
  for (const key of ['candidate_count', 'offered_count', 'selected_count', 'inserted_count']) assert.equal(pending[key], null);
  const searched = publicMemoryQueryTelemetry({ status: 'LIVE', candidateIds: [], selectedIds: [] });
  assert.equal(searched.retrieval_attempted, true); assert.equal(searched.candidate_count, 0);
  assert.doesNotMatch(JSON.stringify(pending), /fingerprint|generationRef|private/);
});

test('sender-only privacy and eligibility are unchanged', () => {
  const privateMemory = { ...memory, privacyScope: 'SENDER_RECALLABLE', subjectVisitorId: 'a'.repeat(32) };
  assert.deepEqual(filterMemoriesBeforePrompt([privateMemory]), []);
  assert.equal(filterMemoriesBeforePrompt([privateMemory], { currentVisitorId: 'a'.repeat(32) }).length, 1);
  assert.deepEqual(filterMemoriesBeforePrompt([{ ...memory, status: 'ARCHIVED' }]), []);
});

test('journal nonblocking path, prompts, finalization, physiology and formation implementation stay byte-identical', () => {
  const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const old = path => execFileSync('git', ['show', `${BASE}:${path}`], { encoding: 'utf8' }).replace(/\r\n/g, '\n');
  for (const path of ['runner/run.js', 'runner/prompt.js', 'runner/character-output.js', 'runner/warden.js', 'runner/postcard-memory.js', 'runner/soma.js']) {
    assert.equal(source(path), old(path), path);
  }
  const formation = text => text.slice(text.indexOf('  async processFormation('));
  assert.equal(formation(source('runner/memory-runtime.js')), formation(old('runner/memory-runtime.js')));
});
