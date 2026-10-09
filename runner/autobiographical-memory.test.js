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
  isCyAuthoredSource,
  sourceFromExpression,
  sourceFromDreamExpression,
  sourceFromEnvironmentRecord,
  sourceFromPostcard,
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
assert.match(formation.prompt, /\"memoryRef\":\"FM1\"/);

const created = parseFormationResponse(JSON.stringify({
  decision: 'CREATE', type: 'UNRESOLVED_THREAD',
  content: 'Jody previously asked what the cell meant and the question stayed open.',
}), { source, existing: [], makeId: () => 'memory-new' });
assert.equal(created.decision, 'CREATE');
assert.equal(created.memoryId, 'memory-new');
assert.equal(created.source.sourceId, 'postcard:7');

const senderScoped = parseFormationResponse(JSON.stringify({
  decision: 'CREATE', type: 'PERSON', privacyScope: 'PUBLIC_RECALLABLE',
  content: 'Jody asked before about a television.', publicSummary: 'Someone asked a question.',
  classification: 'returning sender', consistencyStatus: 'CONSISTENT', tags: ['postcard'],
}), { source, existing: [], makeId: () => 'memory-sender' });
assert.equal(senderScoped.valid, false, 'sender output cannot choose public scope');
assert.equal(senderScoped.rejectionCode, 'FORBIDDEN_FIELD');

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
  decision: 'UPDATE', memoryRef: 'FM1', content: 'The shared cell question returned.',
}), { source, existing: [senderMemory], makeId: () => 'unused' });
assert.equal(updated.decision, 'UPDATE');
assert.equal(updated.expectedVersion, 1);

const openTopic = { ...senderMemory, type: 'UNRESOLVED_THREAD' };
const resolved = parseFormationResponse('{"decision":"RESOLVE","memoryRef":"FM1"}', {
  source, existing: [openTopic], makeId: () => 'unused',
});
assert.equal(resolved.decision, 'ARCHIVE');
assert.equal(resolved.memoryId, openTopic.id);
assert.equal(resolved.expectedVersion, 1);
assert.equal(parseFormationResponse('{"decision":"RESOLVE","memoryRef":"FM1"}', {
  source, existing: [{ ...openTopic, subjectVisitorId: other }], makeId: () => 'unused',
}).valid, false);
assert.equal(parseFormationResponse('{"decision":"RESOLVE","memoryRef":"FM1"}', {
  source, existing: [senderMemory], makeId: () => 'unused',
}).valid, false);
assert.match(formation.system, /Prefer NOTHING for greetings/);
assert.equal(parseFormationResponse('{"decision":"NOTHING"}', {
  source, existing: [], makeId: () => 'unused',
}).decision, 'NOTHING');

for (const eventType of ['postcard', 'postcard_with_image', 'postcard_reply']) {
  assert.equal(sourceFromEnvironmentRecord({
    world_event: { id: `event-${eventType}`, event_type: eventType },
    observation: { summary: 'private postcard text' },
  }), null, `${eventType} cannot form an unlinked generic memory source`);
}
assert.equal(sourceFromEnvironmentRecord({
  world_event: { id: 'event-meal', event_type: 'meal' },
  observation: { summary: 'a real meal' },
}).sourceType, 'ENVIRONMENT_EVENT');

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

// ---- Regression: a thing Cy says about himself cannot become a PERSON fact
// about the addressee (production memory cf87c2d2). Cy's reply to postcard #27
// ("no tv... screw took it... 14 cards now, jody") was stored as a PERSON
// memory "The sender says they have no TV... they report having 14 cards". ----

const cyReply = {
  sourceType: 'CY_REPLY', sourceId: 'postcard-reply:27', occurredAt: '2026-10-07T00:00:00Z',
  text: 'no tv. had one once, screw took it, said it was contraband. 14 cards now, jody.',
  sourceVisibility: 'SENDER_RECALLABLE', participantLabel: 'Jody', subjectVisitorId: sender,
};
// The exact inversion: a CREATE PERSON from Cy's own reply is refused
// deterministically, as a terminal NOTHING (not a retryable INVALID).
const invertedPerson = parseFormationResponse(JSON.stringify({
  decision: 'CREATE', type: 'PERSON',
  content: 'The sender says they have no TV in their cell and report having 14 cards.',
}), { source: cyReply, existing: [], makeId: () => 'must-not-be-created' });
assert.equal(invertedPerson.decision, 'NOTHING', 'a PERSON memory from a CY_REPLY must be refused');
assert.equal(invertedPerson.valid, true, 'the refusal is terminal, not a retryable INVALID');
assert.equal(invertedPerson.blockedReason, 'CY_AUTHORED_PERSON_BLOCKED');
assert.equal('memoryId' in invertedPerson, false);

// The guard is narrow: a CY_REPLY may still form a first-person EPISODIC memory
// (the legitimate case, e.g. the correct production memory 3a2b7e0f).
const episodicFromReply = parseFormationResponse(JSON.stringify({
  decision: 'CREATE', type: 'EPISODIC',
  content: 'I told Jody I have no TV; a screw took mine.',
}), { source: cyReply, existing: [], makeId: () => 'episodic-ok' });
assert.equal(episodicFromReply.decision, 'CREATE');
assert.equal(episodicFromReply.type, 'EPISODIC');
assert.equal(episodicFromReply.memoryId, 'episodic-ok');

// A CY_REPLY must not graft Cy's self-statements onto an existing PERSON memory.
const personTarget = {
  ...base, id: 'person-mem', type: 'PERSON', status: 'ACTIVE',
  privacyScope: 'SENDER_RECALLABLE', subjectVisitorId: sender, version: 2,
};
const blockedUpdate = parseFormationResponse(JSON.stringify({
  decision: 'UPDATE', memoryRef: 'FM1', content: 'The sender has no TV and 14 cards.',
}), { source: cyReply, existing: [personTarget], makeId: () => 'x' });
assert.equal(blockedUpdate.decision, 'NOTHING', 'a CY_REPLY must not UPDATE a PERSON memory');
assert.equal(blockedUpdate.blockedReason, 'CY_AUTHORED_PERSON_BLOCKED');

// Genuine sender-authored POSTCARD is NOT weakened: it may still CREATE and
// UPDATE a PERSON memory about its author.
const postcard = {
  sourceType: 'POSTCARD', sourceId: 'postcard:30', occurredAt: '2026-10-07T00:00:00Z',
  text: 'i have no telly in here, they took it', sourceVisibility: 'SENDER_RECALLABLE',
  participantLabel: 'Jody', subjectVisitorId: sender,
};
const personFromPostcard = parseFormationResponse(JSON.stringify({
  decision: 'CREATE', type: 'PERSON',
  content: 'The sender told Cy they have no television in their cell.',
}), { source: postcard, existing: [], makeId: () => 'person-from-postcard' });
assert.equal(personFromPostcard.decision, 'CREATE');
assert.equal(personFromPostcard.type, 'PERSON');
assert.equal(personFromPostcard.memoryId, 'person-from-postcard');
const personUpdateFromPostcard = parseFormationResponse(JSON.stringify({
  decision: 'UPDATE', memoryRef: 'FM1', content: 'The sender again said they have no television.',
}), { source: postcard, existing: [personTarget], makeId: () => 'x' });
assert.equal(personUpdateFromPostcard.decision, 'UPDATE');

// The other Cy-authored sources (generic formation path) are guarded too, while
// world-authored ENVIRONMENT_EVENT is not.
for (const st of ['CY_EXPRESSION', 'DREAM_EXPRESSION']) {
  const r = parseFormationResponse(JSON.stringify({
    decision: 'CREATE', type: 'PERSON', privacyScope: 'INTERNAL_ONLY',
    content: 'The other person has no television and counts cards.',
  }), {
    source: { sourceType: st, sourceId: `${st}:1`, sourceVisibility: 'INTERNAL_ONLY', subjectVisitorId: null, text: 'no tv. 14 cards.' },
    existing: [], makeId: () => 'nope',
  });
  assert.equal(r.decision, 'NOTHING', `${st} must not form a PERSON memory`);
  assert.equal(r.blockedReason, 'CY_AUTHORED_PERSON_BLOCKED');
}
const worldPerson = parseFormationResponse(JSON.stringify({
  decision: 'CREATE', type: 'PERSON', privacyScope: 'INTERNAL_ONLY',
  content: 'An officer on the wing is strict about the television rule.',
}), {
  source: { sourceType: 'ENVIRONMENT_EVENT', sourceId: 'env-1', sourceVisibility: 'INTERNAL_ONLY', subjectVisitorId: null, text: 'an officer enforced the rule' },
  existing: [], makeId: () => 'world-ok',
});
assert.equal(worldPerson.decision, 'CREATE', 'world-authored sources may still form PERSON memories');
assert.equal(worldPerson.type, 'PERSON');

// Authorship classification: explicit marker wins; sourceType is the fallback,
// so sources already enqueued before any marker existed (the backlog) are
// still classified correctly.
assert.equal(isCyAuthoredSource({ sourceType: 'CY_REPLY' }), true);
assert.equal(isCyAuthoredSource({ sourceType: 'CY_EXPRESSION' }), true);
assert.equal(isCyAuthoredSource({ sourceType: 'DREAM_EXPRESSION' }), true);
assert.equal(isCyAuthoredSource({ sourceType: 'POSTCARD' }), false);
assert.equal(isCyAuthoredSource({ sourceType: 'ENVIRONMENT_EVENT' }), false);
assert.equal(isCyAuthoredSource({ sourceType: 'POSTCARD', authoredBy: 'CY' }), true);
assert.equal(isCyAuthoredSource({ sourceType: 'CY_REPLY', authoredBy: 'SENDER' }), false);
assert.equal(isCyAuthoredSource(sourceFromReply('i kept counting cards tonight', { id: 27, visitor_id: sender, from_name: 'Jody' }, 'env-27')), true);
assert.equal(isCyAuthoredSource(sourceFromDreamExpression(['a screw took the set'], 'dream:1')), true);
assert.equal(isCyAuthoredSource(sourceFromPostcard({ id: 30, visitor_id: sender, from_name: 'Jody', body: 'hello' }, 'env-30')), false);

// The sender prompt now also forbids it explicitly.
assert.match(replyFormation.system, /never CREATE or UPDATE a PERSON memory/);

// ---- Regression: generic formation must not UPDATE a curated
// PUBLIC_RECALLABLE memory. Reproduces the 8-by-4 MOTIF corruption, where a
// DREAM_EXPRESSION (and earlier ENVIRONMENT_EVENT) wholesale-overwrote the
// user-approved public motif, dropping its content/tags and leaving its
// public summary stale. ----

const publicMotif = {
  ...base, id: 'motif-8x4', type: 'MOTIF', status: 'ACTIVE',
  privacyScope: 'PUBLIC_RECALLABLE', version: 4,
  content: 'Cy once noticed an 8 by 4 analogy linking his cell and computational confinement.',
  publicSummary: 'An old idea linked confinement and the machine.',
  classification: 'user-approved autobiographical motif',
};
for (const st of ['DREAM_EXPRESSION', 'ENVIRONMENT_EVENT', 'CY_EXPRESSION']) {
  const r = parseFormationResponse(JSON.stringify({
    decision: 'UPDATE', memoryRef: 'C1', content: 'The wall is gone. Why Root? This is how we do it.',
  }), {
    source: { sourceType: st, sourceId: `${st}:9`, sourceVisibility: 'INTERNAL_ONLY', subjectVisitorId: null, text: 'the wall is gone' },
    existing: [publicMotif], makeId: () => 'must-not-apply',
  });
  assert.equal(r.decision, 'NOTHING', `${st} must not UPDATE a PUBLIC_RECALLABLE memory`);
  assert.equal(r.valid, true, 'terminal refusal, not a retryable INVALID');
  assert.equal(r.blockedReason, 'PUBLIC_RECALLABLE_UPDATE_BLOCKED');
  assert.equal('memoryId' in r, false, 'no memory id is minted for a blocked PUBLIC update');
}

// Not over-blocked: a generic source may still UPDATE a non-PUBLIC target.
const internalTarget = {
  ...base, id: 'internal-mem', type: 'EPISODIC', status: 'ACTIVE',
  privacyScope: 'INTERNAL_ONLY', version: 2, content: 'an earlier internal recollection',
  publicSummary: null, classification: 'internal note',
};
const okInternal = parseFormationResponse(JSON.stringify({
  decision: 'UPDATE', memoryRef: 'C1', content: 'a refined internal recollection',
}), {
  source: { sourceType: 'DREAM_EXPRESSION', sourceId: 'dream:10', sourceVisibility: 'INTERNAL_ONLY', subjectVisitorId: null, text: 'refined' },
  existing: [internalTarget], makeId: () => 'u',
});
assert.equal(okInternal.decision, 'UPDATE', 'a generic UPDATE of a non-PUBLIC target is unaffected');
assert.equal(okInternal.memoryId, 'internal-mem');

// Sender-correspondence UPDATE remains healthy (routes through the sender
// parser; its targets are structurally SENDER_RECALLABLE, never PUBLIC).
const senderUpd = parseFormationResponse(JSON.stringify({
  decision: 'UPDATE', memoryRef: 'FM1', content: 'the shared thread continued',
}), {
  source: { sourceType: 'CY_REPLY', sourceId: 'postcard-reply:9', sourceVisibility: 'SENDER_RECALLABLE', subjectVisitorId: sender, participantLabel: 'Jody', text: 'aye' },
  existing: [{ ...base, id: 'sender-ep', type: 'EPISODIC', status: 'ACTIVE', privacyScope: 'SENDER_RECALLABLE', subjectVisitorId: sender, version: 1 }],
  makeId: () => 'u',
});
assert.equal(senderUpd.decision, 'UPDATE', 'sender UPDATE of a SENDER_RECALLABLE memory remains healthy');

// --- Generic formation deterministic tag floor. In production every generic
// memory landed with zero tags because the local model volunteers no `tags`
// array; the floor derives tags from trustworthy source metadata + content. ---

// Generic UPDATE must never emit an empty tag set (an empty set would let the
// server wipe existing tags); here it derives from the new content.
assert.ok(okInternal.tags.length > 0, 'generic UPDATE derives a non-empty tag floor');
assert.ok(okInternal.tags.includes('refined'), 'generic UPDATE tag floor includes content retrieval terms');

// Generic CREATE with no model-supplied tags still gets trustworthy tags from
// structured source metadata and the memory content.
const genericSource = {
  sourceType: 'ENVIRONMENT_EVENT', sourceId: 'env:42', sourceVisibility: 'INTERNAL_ONLY',
  subjectVisitorId: null, text: 'yard time', tags: ['routine', 'exercise_yard'],
};
const genericCreate = parseFormationResponse(JSON.stringify({
  decision: 'CREATE', type: 'EPISODIC', privacyScope: 'INTERNAL_ONLY',
  content: 'Cy walked the yard and counted the fence posts.',
}), { source: genericSource, existing: [], makeId: () => 'generic-new' });
assert.equal(genericCreate.decision, 'CREATE');
assert.ok(genericCreate.tags.length > 0, 'generic CREATE derives a non-empty tag floor without model tags');
assert.ok(genericCreate.tags.includes('routine') && genericCreate.tags.includes('exercise_yard'),
  'generic CREATE tag floor includes trustworthy structured source metadata');
assert.ok(genericCreate.tags.includes('walked') || genericCreate.tags.includes('fence'),
  'generic CREATE tag floor includes content retrieval terms');
assert.ok(genericCreate.tags.indexOf('routine') < genericCreate.tags.indexOf('walked'),
  'structured source tags are ordered ahead of content terms under the cap');

// Valid model-volunteered tags are still honoured as a bonus.
const genericWithModelTags = parseFormationResponse(JSON.stringify({
  decision: 'CREATE', type: 'EPISODIC', privacyScope: 'INTERNAL_ONLY',
  content: 'A short note.', tags: ['modeltag'],
}), { source: genericSource, existing: [], makeId: () => 'g2' });
assert.ok(genericWithModelTags.tags.includes('modeltag'), 'valid model-supplied generic tags are still honoured');

// Sender path is UNCHANGED: it derives tags from content only and ignores
// source metadata tags (proving it was not switched to the generic floor).
const senderCreate = parseFormationResponse(JSON.stringify({
  decision: 'CREATE', type: 'PERSON', content: 'The sender mentioned their allotment.',
}), {
  source: { sourceType: 'POSTCARD', sourceId: 'postcard:42', sourceVisibility: 'SENDER_RECALLABLE',
    subjectVisitorId: sender, participantLabel: 'Jody', tags: ['should-not-appear'] },
  existing: [], makeId: () => 'sc',
});
assert.equal(senderCreate.decision, 'CREATE');
assert.ok(senderCreate.tags.length > 0, 'sender CREATE still derives tags from content');
assert.ok(senderCreate.tags.includes('allotment'), 'sender tags come from content');
assert.ok(!senderCreate.tags.includes('should-not-appear'),
  'sender path ignores source metadata tags (unchanged behaviour)');

console.log('autobiographical-memory.test.js: all checks passed');
