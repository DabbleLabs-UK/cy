import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  MEMORY_CANDIDATE_LIMIT,
  MEMORY_SURFACE_LIMIT,
  assertPromptSafe,
  buildFormationRequest,
  buildSurfacingRequest,
  filterMemoriesBeforePrompt,
  formatAutobiographicalMemory,
  memoryVisibleTo,
  parseFormationResponse,
  parseSurfacingResponse,
  publicMemoryQueryTelemetry,
  redactAutobiographicalMemoryFromTelemetry,
  sourceFromEnvironmentRecord,
  sourceFromExpression,
} from './autobiographical-memory.js';
import { AutobiographicalMemoryRuntime } from './memory-runtime.js';

const senderA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const senderB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const memory = (overrides = {}) => ({
  id: '00000000-0000-4000-8000-000000000101',
  type: 'EPISODIC', status: 'ACTIVE', privacyScope: 'INTERNAL_ONLY',
  subjectVisitorId: null, content: 'The cell dimensions recalled the machine.',
  publicSummary: null, consistencyStatus: 'UNCERTAIN', version: 2,
  tags: ['cell', 'machine'], reasons: ['SIMILAR_SUBJECT'],
  ...overrides,
});
const source = {
  sourceType: 'ENVIRONMENT_EVENT', sourceId: 'env-source-1',
  occurredAt: '2026-09-12T15:00:00Z', text: 'the cell was searched',
  sourceVisibility: 'INTERNAL_ONLY', subjectVisitorId: null, tags: ['cell', 'search'],
};

test('A world truth immutability', () => {
  const world = { world_event: { id: 'env-source-1', timestamp: source.occurredAt, event_type: 'cell_search', context: { description: source.text } } };
  const before = JSON.stringify(world);
  const derived = sourceFromEnvironmentRecord(world);
  assert.equal(derived.sourceId, world.world_event.id);
  assert.equal(JSON.stringify(world), before);
  assert.equal('world_event' in derived, false);
});

test('B provenance is mandatory and model calls use opaque references', () => {
  const request = buildFormationRequest(source, [memory()]);
  assert.equal(request.candidates[0].memoryRef, 'C1');
  assert.doesNotMatch(request.prompt, /00000000-0000-4000-8000-000000000101/);
  assert.equal(request.candidates.length, 1);
});

test('C create', () => {
  const op = parseFormationResponse('{"decision":"CREATE","type":"EPISODIC","privacyScope":"INTERNAL_ONLY","content":"Cy retained the search.","tags":["search"]}', {
    source, existing: [], makeId: () => '00000000-0000-4000-8000-000000000102',
  });
  assert.equal(op.decision, 'CREATE');
  assert.equal(op.source.sourceId, source.sourceId);
});

test('D update versions memory without changing its source', () => {
  const op = parseFormationResponse('{"decision":"UPDATE","memoryRef":"C1","content":"The search now seems recurrent."}', {
    source, existing: [memory()], makeId: () => 'unused',
  });
  assert.equal(op.decision, 'UPDATE');
  assert.equal(op.expectedVersion, 2);
  assert.equal(op.source.sourceId, source.sourceId);
});

test('E archive is not recallable', () => {
  assert.equal(memoryVisibleTo(memory({ status: 'ARCHIVED' }), null), false);
});

test('F delete is not recallable', () => {
  assert.equal(memoryVisibleTo(memory({ status: 'DELETED', content: '' }), null), false);
});

test('G same sender', () => {
  const senderMemory = memory({ privacyScope: 'SENDER_RECALLABLE', subjectVisitorId: senderA });
  assert.equal(memoryVisibleTo(senderMemory, senderA), true);
});

test('H different sender', () => {
  const senderMemory = memory({ privacyScope: 'SENDER_RECALLABLE', subjectVisitorId: senderA });
  assert.deepEqual(filterMemoriesBeforePrompt([senderMemory], { currentVisitorId: senderB }), []);
});

test('I public cross-visitor uses anonymous public summary', () => {
  const publicMemory = memory({
    privacyScope: 'PUBLIC_RECALLABLE', subjectVisitorId: senderA,
    content: 'Jody asked about a television.',
    publicSummary: 'Another visitor once asked about a television.',
  });
  const result = filterMemoriesBeforePrompt([publicMemory], { currentVisitorId: senderB });
  assert.equal(result[0].content, publicMemory.publicSummary);
  assert.doesNotMatch(result[0].content, /Jody/);

  const generalPublicMemory = memory({
    privacyScope: 'PUBLIC_RECALLABLE', subjectVisitorId: null,
    content: 'Jody once described a television in detail.',
    publicSummary: 'A visitor once described a television.',
  });
  const generalResult = filterMemoriesBeforePrompt([generalPublicMemory], { currentVisitorId: senderB });
  assert.equal(generalResult[0].content, generalPublicMemory.publicSummary);
  assert.doesNotMatch(generalResult[0].content, /Jody/);
});

test('J hidden identifiers never enter model or public telemetry', () => {
  assert.throws(() => assertPromptSafe(`visitor_id ${senderA}`));
  const inspection = { candidateIds: ['private-id'], offeredIds: ['private-id'], selectedIds: ['private-id'], insertedIds: ['private-id'] };
  assert.doesNotMatch(JSON.stringify(publicMemoryQueryTelemetry(inspection)), /private-id/);
  const redacted = redactAutobiographicalMemoryFromTelemetry('<AUTOBIOGRAPHICAL_MEMORY>secret</AUTOBIOGRAPHICAL_MEMORY>');
  assert.doesNotMatch(redacted, /secret/);
});

test('K motif can surface only through relevant candidates', () => {
  const motif = memory({ type: 'MOTIF', content: 'The 8 by 4 cell and machine analogy returned.' });
  const request = buildSurfacingRequest([motif], { publicSituation: 'confinement and machine limits' });
  const selected = parseSurfacingResponse('{"memoryRefs":["C1"]}', request.candidates);
  assert.deepEqual(selected, [motif.id]);
  assert.match(formatAutobiographicalMemory([motif]), /8 by 4/);
});

test('L irrelevant motif is absent when it is not retrieved or selected', () => {
  assert.equal(formatAutobiographicalMemory([]), '');
  assert.deepEqual(parseSurfacingResponse('{"memoryRefs":[]}', []), []);
});

test('M conflict remains subjective and does not collapse records', () => {
  const records = [memory({ content: 'Cy recalls the door open.', consistencyStatus: 'CONFLICTED' }), memory({ id: '00000000-0000-4000-8000-000000000103', content: 'Cy recalls the door shut.', consistencyStatus: 'CONFLICTED' })];
  const block = formatAutobiographicalMemory(records);
  assert.equal((block.match(/consistency: conflicted/g) || []).length, 2);
  assert.match(block, /subjective autobiographical memory/);
});

test('N generated prose is a subjective source and not world fact', () => {
  const generated = sourceFromExpression('the cell feels smaller today', 'generation:1');
  assert.equal(generated.sourceType, 'CY_EXPRESSION');
  assert.equal('world_event' in generated, false);
});

test('O working context is bounded to surfaced memories', () => {
  const candidates = Array.from({ length: MEMORY_CANDIDATE_LIMIT + 4 }, (_, index) => memory({ id: `memory-${index}` }));
  const request = buildSurfacingRequest(candidates, {});
  assert.equal(request.candidates.length, MEMORY_CANDIDATE_LIMIT);
  const selected = parseSurfacingResponse('{"memoryRefs":["C1","C2","C3","C4"]}', request.candidates);
  assert.equal(selected.length, MEMORY_SURFACE_LIMIT);
  assert.equal((formatAutobiographicalMemory(request.candidates).match(/^MEMORY$/gm) || []).length, MEMORY_SURFACE_LIMIT);
});

test('P zero memory does not call surfacing generation', async () => {
  let generated = false;
  const runtime = new AutobiographicalMemoryRuntime({
    client: { async queryMemories() { return { candidates: [] }; }, async recordMemoryQuery() {} },
    generate: async () => { generated = true; return '{}'; }, makeId: () => 'unused',
  });
  const result = await runtime.refreshWorkingContext({ text: 'unmatched' });
  assert.equal(result.directive, '');
  assert.equal(generated, false);
});

test('Q old retriever does not select live memory', async () => {
  const run = await readFile(new URL('./run.js', import.meta.url), 'utf8');
  assert.doesNotMatch(run, /provisionalMemoryCandidate:\s*(?:cognition|soma|ctx)/);
  assert.match(run, /provisionalMemoryCandidate:\s*null/);
  assert.match(run, /autobiographicalMemory\.requestWorkingContext/);
});

test('R hippocampal brain status remains provisional', async () => {
  const registry = JSON.parse(await readFile(new URL('../config/implementation-registry.json', import.meta.url), 'utf8'));
  const region = registry.brain_regions.find((item) => item.id === 'hippocampal');
  assert.equal(region.implementation_status, 'PROVISIONAL');
});

test('S restart uses server-persistent schema and API retrieval', async () => {
  const migration = await readFile(new URL('../sql/015_autobiographical_memory.sql', import.meta.url), 'utf8');
  const runtimeMigration = await readFile(new URL('../sql/017_memory_runtime_queue.sql', import.meta.url), 'utf8');
  const runtime = await readFile(new URL('./memory-runtime.js', import.meta.url), 'utf8');
  assert.match(migration, /CREATE TABLE autobiographical_memories/);
  assert.match(migration, /CREATE TABLE autobiographical_memory_sources/);
  assert.match(runtimeMigration, /CREATE TABLE autobiographical_memory_formation_queue/);
  assert.match(runtime, /client\.queryMemories/);
});

test('T public UI and API enforce public scope and omit IDs', async () => {
  const api = await readFile(new URL('../public/api/memory.php', import.meta.url), 'utf8');
  const publicUi = await readFile(new URL('../public/assets/memory.js', import.meta.url), 'utf8');
  assert.match(api, /privacy_scope = 'PUBLIC_RECALLABLE'/);
  assert.doesNotMatch(publicUi, /subject_visitor_id|candidate_memory_ids/);
  assert.match(publicUi, /current_sender_memory_count/);
});

test('U live memory calls use compact model-facing grounded text', async () => {
  const run = await readFile(new URL('./run.js', import.meta.url), 'utf8');
  assert.match(run, /groundedContext:\s*cognition\.groundedDirective/);
  assert.match(run, /refreshPendingMemory\(`journal:\$\{nowMs\}`, cognition\.groundedDirective\)/);
  assert.match(run, /formMemoryAfterVisibleOutput\(cognition\.groundedDirective, true\)/);
  assert.match(run, /formMemoryAfterVisibleOutput\(burstGroundedDirective\)/);
  assert.doesNotMatch(run, /refreshPendingMemory\([^\n]*cognition\.groundedContext/);
  assert.doesNotMatch(run, /formMemoryAfterVisibleOutput\([^\n]*(?:cognition|burst)\.groundedContext/);
});
