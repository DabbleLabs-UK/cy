import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { loadPostcardAssociativeRecall, postcardAssociativeItem, associativePromptInspection } from './postcard-associative-memory.js';
import { loadPostcardSenderContinuity, postcardSenderMemoryItems, postcardMemoryDirective } from './postcard-memory.js';
import { safeBuildContext, CONTEXT_BUDGETS } from './context-broker.js';
import { canonicalPostcardContext } from './postcard-context.js';
import { buildDirectives } from './prompt.js';
import { makeProviders } from './provider.js';
import { Client } from './client.js';

const visitorId = 'a'.repeat(32), other = 'b'.repeat(32);
const sender = { selected: [], ready: true };
const memory = (id, extra = {}) => ({ id, type: 'EPISODIC', status: 'ACTIVE',
  privacyScope: 'PUBLIC_RECALLABLE', subjectVisitorId: other,
  originKind: 'POSTCARD', consistencyStatus: 'UNCERTAIN',
  content: 'SECRET ORIGINAL', publicSummary: 'A correspondent told Cy about tending a garden.',
  sourceRefs: [{ type: 'POSTCARD', id: `postcard:${id}` }], sourceKeys: [`exchange:${id}`], ...extra });
const load = (candidates, more = {}) => loadPostcardAssociativeRecall({ visitorId, sender,
  client: { getPostcardAssociations: async () => ({ ok: true, candidates, consideredIds: candidates.map(m => m.id) }) }, ...more });

test('direct public-safe recall snapshots at most two complete source-linked memories without a model', async () => {
  const rows = [memory('1'), memory('2'), memory('3')];
  const result = await load(rows);
  assert.equal(result.mechanism, 'INDEXED_ASSOCIATIVE');
  assert.equal(result.status, 'READY');
  assert.deepEqual(result.selected.map(m => m.id), ['1', '2']);
  assert.doesNotMatch(JSON.stringify(result.selected), /SECRET ORIGINAL/);
  assert.deepEqual(result.selected[0].sourceRefs, rows[0].sourceRefs);
  rows[0].sourceRefs[0].id = 'changed';
  assert.equal(result.selected[0].sourceRefs[0].id, 'postcard:1');
});

test('empty, unavailable and timed-out optional reads never hold or change sender continuity', async () => {
  assert.equal((await load([])).status, 'NO_MATCH');
  assert.equal((await load([], { client: { getPostcardAssociations: async () => ({}) } })).status, 'UNAVAILABLE');
  let signal, release;
  const result = await load([], { deadlineMs: 5, client: { getPostcardAssociations: options => {
    signal = options.signal; return new Promise(r => { release = r; });
  } } });
  assert.equal(result.status, 'DEADLINE_EXPIRED');
  assert.equal(signal.aborted, true);
  release({ ok: true, candidates: [memory('late')] });
  await Promise.resolve();
  assert.deepEqual(result.selected, []);
  assert.deepEqual(sender, { selected: [], ready: true });
});

test('scope, current-sender, provenance, origin and whole-recollection bounds fail closed', async () => {
  const rejected = [memory('private', { privacyScope: 'SENDER_RECALLABLE' }),
    memory('internal-person', { privacyScope: 'INTERNAL_ONLY' }),
    memory('ours', { subjectVisitorId: visitorId }), memory('archived', { status: 'ARCHIVED' }),
    memory('no-summary', { publicSummary: null }), memory('no-source', { sourceRefs: [] }),
    memory('no-key', { sourceKeys: [] }), memory('unknown', { originKind: 'UNKNOWN' }),
    memory('long', { publicSummary: 'x'.repeat(261) }),
    memory('disguised', { privacyScope: 'INTERNAL_ONLY', subjectVisitorId: null,
      originKind: 'ENVIRONMENT_EVENT', content: 'secret source', sourceRefs: [{ type: 'CY_REPLY', id: 'postcard-reply:1' }] })];
  for (const row of rejected) assert.equal((await load([row])).selected.length, 0, row.id);
  assert.equal((await load([memory('anonymous-public')], { visitorId: null })).selected.length, 1);
});

test('existing own prison, dream and thought memories preserve distinct fallible provenance', async () => {
  for (const [kind, nature] of [['ENVIRONMENT_EVENT', 'something you experienced'],
    ['DREAM_EXPRESSION', 'a dream you had'], ['CY_EXPRESSION', 'a thought you had before'],
    ['CY_REPLY', 'something you said to a correspondent'], ['POSTCARD', 'something a correspondent told you']]) {
    const publicCorrespondence = ['POSTCARD', 'CY_REPLY'].includes(kind);
    const m = memory(kind, { originKind: kind, privacyScope: publicCorrespondence ? 'PUBLIC_RECALLABLE' : 'INTERNAL_ONLY',
      subjectVisitorId: publicCorrespondence ? other : null, content: 'Cy recalled the yard.',
      sourceRefs: [{ type: kind, id: `${kind}:1` }], sourceKeys: [`source:${kind}:1`] });
    const result = await load([m]);
    assert.equal(result.selected.length, 1);
    const item = postcardAssociativeItem(result.selected[0]);
    assert.ok(item.content.includes(nature));
    assert.match(item.content, /uncertain recollection, not world proof/);
    assert.equal(item.provenanceClass, 'SUBJECTIVE MEMORY');
    assert.equal(item.knowledgeScope, 'CY_BELIEVES');
    assert.doesNotMatch(item.content, /postcard:|POSTCARD:|ENVIRONMENT_EVENT:/);
  }
});

test('underlying exchange/episode overlap cannot occupy both slots', async () => {
  const result = await load([memory('1'), memory('reply', { sourceKeys: ['exchange:1'] }), memory('2')]);
  assert.deepEqual(result.selected.map(m => m.id), ['1', '2']);
});

test('required sender continuity is unchanged and never evicted by optional recall', async () => {
  const required = await loadPostcardSenderContinuity({ visitorId, client: { getSenderContinuity: async () => ({ ok: true,
    candidates: [1, 2, 3, 4].map((id, i) => ({ ...memory(`own${id}`), privacyScope: 'SENDER_RECALLABLE',
      subjectVisitorId: visitorId, type: i < 2 ? 'PERSON' : 'UNRESOLVED_THREAD', content: 'protected '.repeat(61) })) }) } });
  assert.equal(required.selected.length, 4);
  assert.ok(required.selected.every(m => m.content.length === 600));
  const recall = await load([memory('1'), memory('2')], { sender: required });
  const broker = safeBuildContext({ consumer: 'CY_PROSE', currentSenderId: visitorId,
    items: [...postcardSenderMemoryItems(required), ...recall.selected.map(postcardAssociativeItem)] });
  const actual = associativePromptInspection(recall, broker.packet);
  assert.equal(actual.offeredIds.length, 2);
  assert.equal(actual.insertedIds.length, 0);
  assert.equal(broker.packet.sections.flatMap(s => s.items).filter(i => i.mandatory).length, 4);
  const fallback = postcardMemoryDirective({ sender: required, enrichment: recall });
  assert.match(fallback, /protected/);
  assert.doesNotMatch(fallback, /garden/);
  assert.deepEqual(associativePromptInspection(recall, null).insertedIds, []);
});

test('two bounded items fit existing context budget; access evidence distinguishes offered from inserted', async () => {
  const recall = await load([memory('1', { publicSummary: 'x'.repeat(260) }), memory('2', { publicSummary: 'y'.repeat(260) })]);
  const broker = safeBuildContext({ consumer: 'CY_PROSE', items: recall.selected.map(postcardAssociativeItem) });
  assert.equal(CONTEXT_BUDGETS.CY_PROSE.sections.autobiographical_memory, 900);
  assert.equal(CONTEXT_BUDGETS.CY_PROSE.totalChars, 7200);
  assert.ok(broker.packet.metrics.charSize <= 900);
  const inspection = associativePromptInspection(recall, broker.packet);
  assert.deepEqual(inspection.insertedIds, ['1', '2']);
  assert.deepEqual(inspection.candidateProvenance['1'].sourceKeys, ['exchange:1']);
  assert.doesNotMatch(JSON.stringify(inspection), /SECRET ORIGINAL|xxxxxx/);
  assert.doesNotMatch(broker.rendering, /exchange:|postcard:|bbbbbb/);
});

test('local and DeepSeek consume identical canonical associative context exactly once', async () => {
  const recall = await load([memory('1')]);
  const broker = safeBuildContext({ consumer: 'CY_PROSE', items: recall.selected.map(postcardAssociativeItem) });
  const request = canonicalPostcardContext({ postcard: { body: 'how is your garden?' },
    directives: buildDirectives({}, 'letter', { sharedContext: broker.rendering }), priorWriting: '', now: '2026-10-22', location: 'CELL' });
  assert.equal(request.prompt.split('A correspondent told Cy about tending a garden.').length, 2);
  const providers = makeProviders({ model: 'test-local', deepseek: { apiBase: 'https://invalid', model: 'test-cloud' } }, { deepseekKey: 'test-only' });
  const original = globalThis.fetch, sent = [];
  globalThis.fetch = async (_url, options) => { sent.push(JSON.parse(options.body)); return new Response('', { status: 200 }); };
  try {
    await providers.ollama.openStream({ ...request, opts: {}, purpose: 'postcard' });
    await providers.deepseek.openStream({ ...request, opts: {}, purpose: 'postcard' });
    assert.equal(sent[0].system, sent[1].messages[0].content);
    assert.equal(sent[0].prompt, sent[1].messages[1].content);
  } finally { globalThis.fetch = original; }
});

test('runner uses direct lookup only in postcards, and records actual budgeted insertion privately', async () => {
  const source = await readFile(new URL('./run.js', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('async function doPostcard(pc)'), source.indexOf('// ---- warden notice:'));
  assert.match(body, /loadPostcardAssociativeRecall/);
  assert.doesNotMatch(body, /loadPostcardEnrichment|requestWorkingContext/);
  assert.ok(body.indexOf('loadPostcardSenderContinuity') < body.indexOf('loadPostcardAssociativeRecall'));
  assert.ok(body.indexOf('canonicalPostcardContext') < body.indexOf('associativePromptInspection'));
  assert.match(body, /client.recordMemoryQuery/);
  assert.doesNotMatch(body, /emit\([^;]*postcard_associative_recall/);
  const dry = new Client({ dryRun: true }, '.');
  assert.deepEqual((await dry.getPostcardAssociations()).candidates, []);
});
