import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { buildFormationRequest, parseFormationResponse, sourceFromReply } from './autobiographical-memory.js';
import { AutobiographicalMemoryRuntime } from './memory-runtime.js';

const source = sourceFromReply('i said waiting for seedlings takes patience', { id: 41, visitor_id: 'a'.repeat(32) }, 'env-reply');
const opted = { ...source, publicExchange: { permissionVersion: 'compact-public-recall-v1',
  correspondentText: 'my garden seedlings are finally growing', replyText: source.text } };
const parse = (value, s = opted) => parseFormationResponse(JSON.stringify(value), { source: s, existing: [], makeId: () => 'sender-memory' });

test('only eligible reply formation adds the independent compact summary slot', () => {
  const regular = buildFormationRequest(source);
  const request = buildFormationRequest(opted);
  assert.ok(regular.format.oneOf.every(b => !b.properties.publicRecollection));
  assert.ok(request.format.oneOf.every(b => b.required.includes('publicRecollection')));
  assert.deepEqual(request.options, regular.options);
  const prompt = JSON.parse(request.prompt);
  assert.equal(prompt.publishedExchange.correspondentSaid, opted.publicExchange.correspondentText);
  assert.equal(prompt.source.sourceType, 'CY_REPLY');
  assert.match(request.system, /null is normal/);
  assert.match(request.system, /not reuse of either raw message/);
  assert.match(request.system, /Never merge these voices/);
  assert.doesNotMatch(request.prompt, /permissionVersion|postcardId|replySeq|subjectVisitorId/);
});

test('meaningful public recollection does not replace sender EPISODIC formation', () => {
  const result = parse({ decision: 'CREATE', type: 'EPISODIC', content: 'Cy replied about waiting for seedlings.',
    publicRecollection: { basis: 'POSTCARD', summary: 'Growing seedlings called for patience.' } });
  assert.equal(result.valid, true);
  assert.equal(result.privacyScope, 'SENDER_RECALLABLE');
  assert.equal(result.publicSummary, null);
  assert.equal(result.publicRecollection.basis, 'POSTCARD');
  assert.equal(result.source.sourceId, 'postcard-reply:41');
});

test('trivial opt-in exchange may yield neither sender nor public memory', () => {
  assert.deepEqual(parse({ decision: 'NOTHING', publicRecollection: null }), {
    decision: 'NOTHING', valid: true, publicRecollection: null, publicRecollectionStatus: 'NONE',
  });
});

test('independent public slot can accompany a valid sender NOTHING', () => {
  const result = parse({ decision: 'NOTHING', publicRecollection: { basis: 'CY_REPLY', summary: 'Cy reflected on patience.' } });
  assert.equal(result.valid, true);
  assert.equal(result.decision, 'NOTHING');
  assert.equal(result.publicRecollectionStatus, 'PROPOSED');
});

test('opt-out and historical sources cannot propose a public summary', () => {
  assert.equal(parse({ decision: 'NOTHING', publicRecollection: { basis: 'POSTCARD', summary: 'test' } }, source).valid, false);
  const old = { ...opted, publicExchange: { permissionVersion: 'unknown' } };
  assert.equal(buildFormationRequest(old).format.oneOf[0].properties.publicRecollection, undefined);
});

test('bad optional output cannot erase an otherwise valid sender decision', () => {
  for (const publicRecollection of [{ basis: 'WORLD', summary: 'test' }, { basis: 'POSTCARD', summary: 'x'.repeat(201) },
    { basis: 'POSTCARD', summary: 'test', transcript: 'private' }, 'private transcript']) {
    const result = parse({ decision: 'CREATE', type: 'EPISODIC', content: 'Cy replied about patience.', publicRecollection });
    assert.equal(result.valid, true);
    assert.equal(result.privacyScope, 'SENDER_RECALLABLE');
    assert.equal(result.publicRecollection, null);
    assert.equal(result.publicRecollectionStatus, 'REJECTED');
  }
});

test('Cy reply still cannot create PERSON facts even with opt-in', () => {
  const result = parse({ decision: 'CREATE', type: 'PERSON', content: 'The sender lives in a cell.', publicRecollection: null });
  assert.equal(result.decision, 'NOTHING');
  assert.equal(result.blockedReason, 'CY_AUTHORED_PERSON_BLOCKED');
});

test('submission permission is unchecked, per card, explicitly posted and cleared on success', () => {
  const html = readFileSync(new URL('../public/index.php', import.meta.url), 'utf8');
  const input = html.match(/<input[^>]+id="pc-public-recollection"[^>]*>/)[0];
  assert.doesNotMatch(input, /\bchecked\b/);
  assert.match(input, /value="compact-public-recall-v1"/);
  assert.match(html, /does not allow raw message reuse/);
  const js = readFileSync(new URL('../public/assets/app.js', import.meta.url), 'utf8');
  assert.match(js, /if \(recall\?\.checked\) fd.append\('public_recollection', recall.value\)/);
  assert.match(js, /if \(recall\) recall.checked = false/);
});

test('one existing formation call delivers sender and public decisions in one completion', async () => {
  let calls = 0, completion;
  const runtime = new AutobiographicalMemoryRuntime({
    client: {
      async queryMemories({ query }) { assert.equal(query.sender_formation_only, true); return { candidates: [] }; },
      async finishMemorySource(value) { completion = value; return { result_category: value.result_category }; },
    },
    generate: async () => { calls++; return JSON.stringify({ decision: 'CREATE', type: 'EPISODIC',
      content: 'Cy discussed patience.', publicRecollection: { basis: 'POSTCARD', summary: 'Patience helped seedlings grow.' } }); },
    makeId: () => 'sender-memory', canRunBackground: () => true,
    providerInfo: () => ({ id: 'ollama', model: 'mock' }),
  });
  await runtime.processFormation({ id: 1, source: opted, claim_token: 'a'.repeat(32) });
  assert.equal(calls, 1);
  assert.equal(completion.operations.length, 1);
  assert.equal(completion.operations[0].privacyScope, 'SENDER_RECALLABLE');
  assert.equal(completion.public_recollection.basis, 'POSTCARD');
  assert.equal(completion.public_recollection_status, 'PROPOSED');
});
