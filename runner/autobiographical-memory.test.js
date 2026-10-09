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
  genericUpdateConsolidates,
  parseSurfacingResponse,
  publicMemoryQueryTelemetry,
  redactAutobiographicalMemoryFromTelemetry,
  isCyAuthoredSource,
  sourceFromExpression,
  sourceFromDreamExpression,
  sourceFromEnvironmentRecord,
  environmentFormationAdmission,
  environmentFormationSignificant,
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

// --- Generic ENVIRONMENT_EVENT formation admission (arrival-side boundary) ---
// Builds a record in the real shape: descriptors hoisted to world_event top,
// rich detail nested under world_event.world (verified against production JSON).
const envRecord = (id, { event_type, event_family = 'ambient_world', detail = {} } = {}) => ({
  world_event: { id, event_type, event_family, timestamp: '2026-10-09T00:00:00Z',
    context: { location: 'cell', description: `${event_type} happened` },
    participants: { actor: 'officer_01' }, world: detail },
});
const admit = (record) => environmentFormationAdmission(record);

// Provenance preserved: an admitted episode still yields a source linked to the
// exact world event id.
const searchComplete = envRecord('env-search-1', {
  event_type: 'cell_search_search_complete', event_family: 'custody',
  detail: { search_episode: { id: 'srch-9', stage: 'SEARCH_COMPLETE' },
    associative_learning: { outcomes: [{ outcome_class: 'COERCIVE_LOSS_OF_CONTROL', status: 'occurred' }] } },
});
assert.deepEqual(admit(searchComplete), { admit: true, reason: 'SIGNIFICANT' },
  'a completed search with an occurred adverse outcome is significant and admitted');
assert.equal(sourceFromEnvironmentRecord(searchComplete).sourceId, 'env-search-1',
  'admitted episode preserves provenance to its real world event');

// Episode coalescing: non-terminal stages are not separately formed.
assert.deepEqual(admit(envRecord('env-search-2', {
  event_type: 'cell_search_search_ongoing', event_family: 'custody',
  detail: { search_episode: { id: 'srch-9', stage: 'SEARCH_ONGOING' },
    associative_learning: { outcomes: [{ outcome_class: 'COERCIVE_LOSS_OF_CONTROL', status: 'unknown' }] } },
})), { admit: false, reason: 'EPISODE_NON_TERMINAL' }, 'a mid-search stage is coalesced away');

// Instrumental open/resolve pair collapses to the resolved record only.
assert.deepEqual(admit(envRecord('env-ins-1', {
  event_type: 'instrumental_officer_order_resolved', event_family: 'custody',
  detail: { instrumental: { archetype_id: 'officer_order', stage: 'WORLD_OUTCOME_RESOLVED' },
    associative_learning: { outcomes: [{ outcome_class: 'DEPRIVATION_OR_LOSS', status: 'did_not_occur' }] } },
})), { admit: true, reason: 'EPISODE_REPRESENTATIVE' }, 'instrumental resolved (benign) is the representative record');
assert.deepEqual(admit(envRecord('env-ins-2', {
  event_type: 'instrumental_officer_order_opened', event_family: 'custody',
  detail: { instrumental: { archetype_id: 'officer_order', stage: 'OPPORTUNITY_OPEN' },
    associative_learning: { outcomes: [{ outcome_class: 'DEPRIVATION_OR_LOSS', status: 'unknown' }] } },
})), { admit: false, reason: 'EPISODE_NON_TERMINAL' }, 'instrumental opened is coalesced away');

// Repetitive texture: homeostasis family and cross-family noise are not formed.
assert.deepEqual(admit(envRecord('env-meal', { event_type: 'breakfast_eaten', event_family: 'homeostasis' })),
  { admit: false, reason: 'LOW_INFORMATION' }, 'routine homeostasis texture is denied');
assert.deepEqual(admit(envRecord('env-over', { event_type: 'overheard', event_family: 'social' })),
  { admit: false, reason: 'LOW_INFORMATION' }, 'overheard noise is denied');
assert.deepEqual(admit(envRecord('env-sleep', { event_type: 'sleep_state_asleep', event_family: 'homeostasis' })),
  { admit: false, reason: 'LOW_INFORMATION' }, 'sleep-state transitions are denied');

// Significance override preserves an unusual occurrence even for a normally
// repetitive type (injury during an otherwise trivial moment).
assert.deepEqual(admit(envRecord('env-meal-hurt', { event_type: 'cold_tea', event_family: 'homeostasis',
  detail: { physical: { injury: 'minor' } } })),
  { admit: true, reason: 'SIGNIFICANT' }, 'injury rescues an otherwise-denied repetitive type');
assert.deepEqual(admit(envRecord('env-noise-harm', { event_type: 'noise_night', event_family: 'social',
  detail: { associative_learning: { outcomes: [{ outcome_class: 'PHYSICAL_HARM', status: 'occurred' }] } } })),
  { admit: true, reason: 'SIGNIFICANT' }, 'an occurred adverse outcome rescues a noise type');

// Default admit for a plausible standalone episode; benign/absent outcomes are
// NOT significant (no backdoor).
assert.deepEqual(admit(envRecord('env-kind', { event_type: 'officer_kindness', event_family: 'social' })),
  { admit: true, reason: 'DEFAULT' }, 'a meaningful standalone social event is admitted by default');
assert.equal(environmentFormationSignificant({ world: { associative_learning: {
  outcomes: [{ outcome_class: 'SOCIAL_HOSTILITY', status: 'did_not_occur' }] } } }), false,
  'did_not_occur outcomes are not significant');

// Correspondence and malformed records never become generic candidates.
assert.deepEqual(admit(envRecord('env-pc', { event_type: 'postcard', event_family: 'mail' })),
  { admit: false, reason: 'CORRESPONDENCE' }, 'postcard world records are not generic candidates');
assert.deepEqual(admit({ world_event: { event_type: 'overheard' } }),
  { admit: false, reason: 'NO_WORLD' }, 'a record without a world id is rejected');

// --- Generic UPDATE consolidation guard (real production failure shapes) -----
const genTarget = (over = {}) => ({
  id: 'mem-t', type: 'EPISODIC', status: 'ACTIVE', version: 3,
  privacyScope: 'INTERNAL_ONLY', subjectVisitorId: null,
  content: 'default content', classification: 'c', publicSummary: null,
  sourceKinds: ['ENVIRONMENT_EVENT'], ...over,
});
const genSrc = (sourceType) => ({ sourceType, sourceId: `${sourceType}:1`,
  sourceVisibility: 'INTERNAL_ONLY', subjectVisitorId: null, text: 't' });
const genUpdate = (sourceType, target, newContent) => parseFormationResponse(
  JSON.stringify({ decision: 'UPDATE', memoryRef: 'C1', content: newContent }),
  { source: genSrc(sourceType), existing: [target], makeId: () => 'x' });

// 67789c69: a dream must not overwrite a world-grounded memory (and it kept the
// old UNRESOLVED_THREAD type while doing so). Terminal NOTHING, not a clobber.
assert.deepEqual(
  genUpdate('DREAM_EXPRESSION',
    genTarget({ type: 'UNRESOLVED_THREAD', sourceKinds: ['ENVIRONMENT_EVENT'],
      content: 'Had the thought that there are no eggs at home.' }),
    'Tape still stuck on my palm / Sweep clipboard creaked open by itself / Miss Trace counting backwards'),
  { decision: 'NOTHING', valid: true, blockedReason: 'GENERIC_UPDATE_NOT_CONSOLIDATING' },
  'dream cannot clobber a world-grounded memory (67789c69 shape)');

// e4a153ca: a dream must not overwrite a waking CY_EXPRESSION memory.
assert.equal(
  genUpdate('DREAM_EXPRESSION',
    genTarget({ sourceKinds: ['CY_EXPRESSION'],
      content: 'dis ting aint right fam, somethin dont add up bout dese cells' }),
    'under water, bubbles form at my feet / a thing like a smile / flesh under lights').blockedReason,
  'GENERIC_UPDATE_NOT_CONSOLIDATING', 'dream cannot clobber a waking-expression memory (e4a153ca shape)');

// 60773963: an identical-content UPDATE is a material no-op and is rejected.
assert.equal(
  genUpdate('ENVIRONMENT_EVENT',
    genTarget({ content: 'I had a cup of cold tea at 18:44 on October 7th, 2026.' }),
    'I had a cup of cold tea at 18:44 on October 7th, 2026.').blockedReason,
  'GENERIC_UPDATE_NOT_CONSOLIDATING', 'no-op UPDATE rejected (60773963 shape)');

// Same-kind unrelated replacement (would clobber a different topic) is rejected.
assert.equal(
  genUpdate('ENVIRONMENT_EVENT',
    genTarget({ content: 'I had a cup of cold tea in the morning.' }),
    'Bill mentioned the library closes early on Fridays.').blockedReason,
  'GENERIC_UPDATE_NOT_CONSOLIDATING', 'unrelated same-kind replacement rejected');

// POSITIVE: same-kind topical extension genuinely consolidates (allowed).
const gExtend = genUpdate('ENVIRONMENT_EVENT',
  genTarget({ content: 'Officers searched the cell and took a notebook.' }),
  'Officers searched the cell and took a notebook; the search left the cell in disarray.');
assert.equal(gExtend.decision, 'UPDATE', 'same-kind topical extension consolidates');
assert.equal(gExtend.blockedReason, undefined);

// POSITIVE: same-origin dream-thread consolidation (new dream shares the motif).
assert.equal(
  genUpdate('DREAM_EXPRESSION',
    genTarget({ sourceKinds: ['DREAM_EXPRESSION'], content: 'the lock will not turn / Reg knows / lights out' }),
    'the lock will not turn / Reg knows again / lights out in every cell').decision,
  'UPDATE', 'same-origin same-topic dream consolidation is allowed');

// Unknown provenance (no sourceKinds): still gated by no-op/topic, not origin.
assert.equal(
  genUpdate('DREAM_EXPRESSION',
    genTarget({ sourceKinds: [], content: 'walking the yard at dawn' }),
    'walking the yard at dawn, the gulls overhead').decision,
  'UPDATE', 'with unknown provenance a topical extension still consolidates');

// The sender/DeepSeek path is NOT subject to this guard: an unrelated sender
// UPDATE still consolidates exactly as before (6fa54a81 lane preserved).
assert.equal(
  parseFormationResponse(JSON.stringify({ decision: 'UPDATE', memoryRef: 'FM1', content: 'A completely different sender topic.' }), {
    source: { sourceType: 'CY_REPLY', sourceId: 'postcard-reply:1', sourceVisibility: 'SENDER_RECALLABLE',
      subjectVisitorId: sender, participantLabel: 'J', text: 'x' },
    existing: [{ ...base, id: 'sfm', type: 'EPISODIC', status: 'ACTIVE', privacyScope: 'SENDER_RECALLABLE',
      subjectVisitorId: sender, version: 1, content: 'original sender memory', sourceKinds: ['CY_REPLY'] }],
    makeId: () => 'x',
  }).decision,
  'UPDATE', 'sender UPDATE is never gated by the generic consolidation guard');

// Direct unit checks of the invariant.
assert.equal(genericUpdateConsolidates(genSrc('DREAM_EXPRESSION'),
  { content: 'cold tea', sourceKinds: ['ENVIRONMENT_EVENT'] }, 'a dream about the sea'), false,
  'cross-kind is not consolidation');
assert.equal(genericUpdateConsolidates(genSrc('ENVIRONMENT_EVENT'),
  { content: 'x y', sourceKinds: ['ENVIRONMENT_EVENT'] }, 'x y'), false, 'no-op is not consolidation');

console.log('autobiographical-memory.test.js: all checks passed');
