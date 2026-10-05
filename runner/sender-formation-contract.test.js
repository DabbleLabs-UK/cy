import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { buildFormationRequest, parseFormationResponse } from './autobiographical-memory.js';
import { AutobiographicalMemoryRuntime } from './memory-runtime.js';
import { makeProviders } from './provider.js';
import { options } from './prompt.js';

const sender = 'a'.repeat(32);
const source = { sourceType: 'POSTCARD', sourceId: 'synthetic:formation', text: 'My dog is called Alfie.',
  subjectVisitorId: sender, sourceVisibility: 'SENDER_RECALLABLE', participantLabel: 'a sender' };
const person = { id: 'memory-person', version: 3, status: 'ACTIVE', type: 'PERSON',
  privacyScope: 'SENDER_RECALLABLE', subjectVisitorId: sender, content: 'The sender has a dog.' };
const topic = { ...person, id: 'memory-topic', type: 'UNRESOLVED_THREAD', content: 'The sender awaits an answer.' };
const parse = (value, existing = [], src = source) => parseFormationResponse(
  typeof value === 'string' ? value : JSON.stringify(value), { source: src, existing, makeId: () => 'attached-by-cy' });

test('sender grammar exposes only action-specific fields and exactly offered references', () => {
  const empty = buildFormationRequest(source);
  assert.deepEqual(empty.format.oneOf.map(x => x.properties.decision.const), ['NOTHING', 'CREATE']);
  const request = buildFormationRequest(source, [person, topic,
    { ...person, id: 'private-other', subjectVisitorId: 'b'.repeat(32) },
    { ...person, id: 'archived', status: 'ARCHIVED' }]);
  assert.deepEqual(request.candidates.map(x => x.memoryRef), ['FM1', 'FM2']);
  const branches = Object.fromEntries(request.format.oneOf.map(x => [x.properties.decision.const, x]));
  assert.deepEqual(branches.NOTHING.required, ['decision']);
  assert.deepEqual(branches.CREATE.required, ['decision', 'type', 'content']);
  assert.deepEqual(branches.UPDATE.properties.memoryRef.enum, ['FM1', 'FM2']);
  assert.deepEqual(branches.RESOLVE.properties.memoryRef.enum, ['FM2']);
  for (const branch of Object.values(branches)) assert.equal(branch.additionalProperties, false);
  assert.doesNotMatch(request.prompt, /memory-person|private-other|archived|aaaaaaaa|"C1"/);
  assert.doesNotMatch(JSON.stringify(request.format), /privacyScope|sourceId|memoryId|revisionId/);
  assert.equal(buildFormationRequest({ ...source, sourceType: 'ENVIRONMENT_EVENT' }).format, undefined);
});

test('classification instructions distinguish facts, open topics, greetings and actual resolution', () => {
  const { system } = buildFormationRequest(source);
  for (const required of ['PERSON:', 'pets', 'UNRESOLVED_THREAD:', 'EPISODIC:',
    'not a fallback', 'Prefer NOTHING', 'CREATE PERSON', 'CREATE UNRESOLVED_THREAD',
    '-> NOTHING', '-> RESOLVE', 'not facts about this sender', 'A CY_REPLY is Cy speaking']) {
    assert.ok(system.includes(required), required);
  }
});

test('all valid sender actions attach scope, IDs, revisions and provenance deterministically', () => {
  assert.deepEqual(parse({ decision: 'NOTHING' }), { decision: 'NOTHING', valid: true });
  for (const type of ['PERSON', 'UNRESOLVED_THREAD', 'EPISODIC', 'SEMANTIC', 'MOTIF']) {
    const result = parse({ decision: 'CREATE', type, content: 'The sender says their dog is called Alfie.' });
    assert.equal(result.valid, true);
    assert.equal(result.memoryId, 'attached-by-cy');
    assert.equal(result.privacyScope, 'SENDER_RECALLABLE');
    assert.equal(result.publicSummary, null);
    assert.equal(result.source, source);
    assert.ok(result.tags.includes('alfie'));
  }
  const update = parse({ decision: 'UPDATE', memoryRef: 'FM1', content: 'The sender has two dogs.' }, [person]);
  assert.equal(update.memoryId, person.id);
  assert.equal(update.expectedVersion, 3);
  assert.equal(update.valid, true);
  const resolved = parse({ decision: 'RESOLVE', memoryRef: 'FM2' }, [person, topic]);
  assert.equal(resolved.decision, 'ARCHIVE');
  assert.equal(resolved.memoryId, topic.id);
});

test('rejections are bounded structural codes, never snippets of private output', () => {
  const cases = [
    ['{private secret', 'JSON_FORMAT'], ['before {"decision":"NOTHING"}', 'JSON_FORMAT'],
    ['[]', 'SCHEMA'], [{}, 'MISSING_FIELD'], [{ decision: 'FORGET' }, 'ILLEGAL_ACTION'],
    [{ decision: 'CREATE', type: 'FACT', content: 'private secret' }, 'ILLEGAL_TYPE'],
    [{ decision: 'CREATE', type: 'PERSON' }, 'MISSING_FIELD'],
    [{ decision: 'CREATE', type: 'PERSON', content: ' ' }, 'MISSING_FIELD'],
    [{ decision: 'CREATE', type: 'PERSON', content: 'x'.repeat(481) }, 'SCHEMA'],
    [{ decision: 'NOTHING', content: 'private secret' }, 'FORBIDDEN_FIELD'],
    [{ decision: 'CREATE', type: 'PERSON', content: 'a fact', privacyScope: 'PUBLIC_RECALLABLE' }, 'FORBIDDEN_FIELD'],
    [{ decision: 'CREATE', type: 'PERSON', content: 'a fact', memoryId: 'invented' }, 'FORBIDDEN_FIELD'],
    [{ decision: 'UPDATE', memoryRef: 'a private description', content: 'a fact' }, 'UNKNOWN_REF'],
    [{ decision: 'UPDATE', memoryRef: 'C1', content: 'a fact' }, 'UNKNOWN_REF'],
    [{ decision: 'RESOLVE', memoryRef: 'FM2' }, 'UNKNOWN_REF'],
    [{ decision: 'RESOLVE', memoryRef: 'FM1' }, 'SCHEMA'],
  ];
  for (const [value, code] of cases) {
    const result = parse(value, [person]);
    assert.equal(result.valid, false, JSON.stringify(value));
    assert.equal(result.rejectionCode, code);
    assert.doesNotMatch(JSON.stringify(result), /private secret|a private description/);
  }
  for (const bad of [{ ...topic, subjectVisitorId: 'b'.repeat(32) },
    { ...topic, privacyScope: 'PUBLIC_RECALLABLE' }, { ...topic, status: 'ARCHIVED' }]) {
    for (const decision of ['UPDATE', 'RESOLVE']) assert.equal(parse({ decision, memoryRef: 'FM1',
      ...(decision === 'UPDATE' ? { content: 'a fact' } : {}) }, [bad]).rejectionCode, 'PRIVACY_PROVENANCE');
  }
  assert.equal(parse({ decision: 'NOTHING' }, [], { ...source, subjectVisitorId: null }).rejectionCode, 'PRIVACY_PROVENANCE');
});

test('actual formation orchestration sends schema through provider and persists safe rejection code', async () => {
  const requests = [], completions = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      requests.push(JSON.parse(Buffer.concat(chunks).toString()));
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ response: '{"decision":"UPDATE","memoryRef":"invented","content":"private fixture"}' }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const provider = makeProviders({ ollamaUrl: `http://127.0.0.1:${server.address().port}`, model: 'test-local' }).ollama;
    const runtime = new AutobiographicalMemoryRuntime({
      client: { queryMemories: async () => ({ candidates: [] }), finishMemorySource: async value => {
        completions.push(value); return { result_category: value.result_category };
      } },
      generate: async call => (await provider.rawGenerate({ ...call, opts: options({}, 4, 'journal', call.options) })).text,
      makeId: () => 'unused',
    });
    await runtime.processFormation({ id: 1, claim_token: 'synthetic', source });
    assert.deepEqual(requests[0].format, buildFormationRequest(source).format);
    assert.equal(requests[0].options.temperature, 0.1);
    assert.equal(requests[0].options.num_predict, 260);
    assert.equal(requests[0].options.num_ctx, 3072);
    assert.equal(completions[0].rejection_code, 'UNKNOWN_REF');
    assert.equal(completions[0].result_category, 'INVALID');
    assert.equal(completions[0].operations.length, 0);
    assert.doesNotMatch(JSON.stringify(completions[0]), /private fixture|invented/);
    const run = await readFile(new URL('./run.js', import.meta.url), 'utf8');
    assert.match(run, /format: call\.purpose === 'memory_formation' \? call\.format \|\| null : null/);
    assert.match(run, /background && purpose === 'memory_formation' && !ac\.signal\.aborted/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
