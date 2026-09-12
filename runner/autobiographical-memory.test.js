import assert from 'node:assert/strict';
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
  sourceFromExpression,
  sourceFromReply,
} from './autobiographical-memory.js';

const sender = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const other = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const base = {
  id: 'memory-public', type: 'MOTIF', status: 'ACTIVE', privacyScope: 'PUBLIC_RECALLABLE',
  subjectVisitorId: null, content: 'the cell and machine seem to rhyme in an 8 by 4 idea',
  publicSummary: 'An old idea linked confinement and the machine.', consistencyStatus: 'UNCERTAIN',
  version: 1, tags: ['cell', 'machine', '8-by-4'], reasons: ['SAME_PLACE', 'SIMILAR_SUBJECT'],
};

// Privacy is deterministic and occurs before prompt assembly.
const privateMemory = { ...base, id: 'private', privacyScope: 'INTERNAL_ONLY' };
const senderMemory = { ...base, id: 'sender', privacyScope: 'SENDER_RECALLABLE', subjectVisitorId: sender };
assert.equal(memoryVisibleTo(privateMemory, sender), true);
assert.equal(memoryVisibleTo(senderMemory, sender), true);
assert.equal(memoryVisibleTo(senderMemory, other), false);
assert.deepEqual(
  filterMemoriesBeforePrompt([privateMemory, senderMemory], { currentVisitorId: other }).map((memory) => memory.id),
  ['private'],
);

// Hidden technical identity can never enter a model-facing block.
assert.throws(() => assertPromptSafe('visitor_id aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'));
assert.throws(() => assertPromptSafe('IP address 127.0.0.1'));

const source = {
  sourceType: 'POSTCARD', sourceId: 'postcard:7', occurredAt: '2026-09-12T12:00:00Z',
  text: 'do you remember what we said about the cell?', sourceVisibility: 'SENDER_RECALLABLE',
  participantLabel: 'Jody', subjectVisitorId: sender, tags: ['postcard', 'cell'],
};
const formation = buildFormationRequest(source, [senderMemory]);
assert.doesNotMatch(formation.prompt, new RegExp(sender));
assert.doesNotMatch(formation.prompt, /visitor_id|cookie|ip address/i);
assert.doesNotMatch(formation.prompt, /\"private\"|\"sender\"|memory-public/);
assert.match(formation.prompt, /\"memoryRef\":\"C1\"/);

const created = parseFormationResponse(JSON.stringify({
  decision: 'CREATE', type: 'UNRESOLVED_THREAD', privacyScope: 'SENDER_RECALLABLE',
  content: 'Jody previously asked what the cell meant and the question stayed open.',
  classification: 'shared unresolved question', consistencyStatus: 'UNCERTAIN', tags: ['cell', 'question'],
}), { source, existing: [], makeId: () => 'memory-new' });
assert.equal(created.decision, 'CREATE');
assert.equal(created.memoryId, 'memory-new');
assert.equal(created.source.sourceId, 'postcard:7');

const senderScoped = parseFormationResponse(JSON.stringify({
  decision: 'CREATE', type: 'PERSON', privacyScope: 'PUBLIC_RECALLABLE',
  content: 'Jody asked before about a television.', publicSummary: 'Someone asked a question.',
  classification: 'returning sender', consistencyStatus: 'CONSISTENT', tags: ['postcard'],
}), { source, existing: [], makeId: () => 'memory-sender' });
assert.equal(senderScoped.privacyScope, 'SENDER_RECALLABLE');
assert.equal(senderScoped.publicSummary, null);

const replySource = sourceFromReply('aye i remember that', {
  id: 7, visitor_id: sender, from_name: 'Jody',
}, 'env-reply-7', '2026-09-12T12:01:00Z');
assert.equal(replySource.sourceVisibility, 'SENDER_RECALLABLE');
assert.equal(replySource.subjectVisitorId, sender);
const replyFormation = buildFormationRequest(replySource, [
  senderMemory,
  { ...base, id: 'internal-general', privacyScope: 'INTERNAL_ONLY' },
  { ...base, id: 'public-general', privacyScope: 'PUBLIC_RECALLABLE' },
]);
assert.deepEqual(replyFormation.candidates.map((memory) => memory.id), ['sender']);

const updated = parseFormationResponse(JSON.stringify({
  decision: 'UPDATE', memoryRef: 'C1', content: 'The shared cell question returned.',
  consistencyStatus: 'CONSISTENT', tags: ['cell'],
}), { source, existing: [senderMemory], makeId: () => 'unused' });
assert.equal(updated.decision, 'UPDATE');
assert.equal(updated.expectedVersion, 1);

// Generated expression is autobiographical material, never a world record.
const expression = sourceFromExpression('same cell really. 8 by 4.', 'generation:7');
assert.equal(expression.sourceType, 'CY_EXPRESSION');
assert.equal('worldFact' in expression, false);

// The surfacing model can select only supplied candidates and at most three.
const many = Array.from({ length: MEMORY_CANDIDATE_LIMIT + 5 }, (_, i) => ({ ...base, id: `m${i}` }));
const surfacing = buildSurfacingRequest(many, { publicSituation: 'inside the cell' });
assert.equal(surfacing.candidates.length, MEMORY_CANDIDATE_LIMIT);
const ids = parseSurfacingResponse('{"memoryRefs":["C1","missing","C2","C3","C4"]}', surfacing.candidates);
assert.deepEqual(ids, ['m0', 'm1', 'm2']);
assert.equal(ids.length, MEMORY_SURFACE_LIMIT);
assert.deepEqual(parseSurfacingResponse('{"memoryRefs":[]}', surfacing.candidates), []);

const block = formatAutobiographicalMemory(surfacing.candidates.slice(0, 2));
assert.match(block, /epistemic status: subjective autobiographical memory/);
assert.doesNotMatch(block, /retrievalReasons|score|memoryRef/);

// The 8 by 4 motif is not permanent instruction: absent candidates means absent text.
assert.equal(formatAutobiographicalMemory([]), '');

const privateTelemetry = {
  status: 'LIVE', senderKnown: true,
  candidateIds: ['memory-private-a'], offeredIds: ['memory-private-a'],
  selectedIds: ['memory-private-a'], insertedIds: ['memory-private-a'],
  mechanisms: ['EXACT_PERSON'], privacyFilter: 'APPLIED BEFORE RESPONSE',
};
const publicTelemetry = publicMemoryQueryTelemetry(privateTelemetry);
assert.equal(publicTelemetry.candidate_count, 1);
assert.doesNotMatch(JSON.stringify(publicTelemetry), /memory-private-a/);
const publicZone = redactAutobiographicalMemoryFromTelemetry(
  `before\n${formatAutobiographicalMemory([privateMemory])}\nafter`,
);
assert.match(publicZone, /private memory context omitted/);
assert.doesNotMatch(publicZone, /cell and machine seem to rhyme/);

console.log('autobiographical-memory.test.js: all checks passed');
