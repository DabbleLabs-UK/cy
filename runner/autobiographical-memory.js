// autobiographical-memory.js - bounded subjective memory formation and access.
//
// This is an engineering information-retrieval system, not a biological memory
// model. World records stay authoritative. Every autobiographical record is
// subjective, versioned and provenance-bearing. Privacy is filtered before any
// candidate can enter a model prompt.

import { sanitizeCharacterContext } from './warden.js';

export const MEMORY_TYPES = Object.freeze([
  'EPISODIC', 'PERSON', 'MOTIF', 'UNRESOLVED_THREAD', 'SEMANTIC',
]);
export const MEMORY_SCOPES = Object.freeze([
  'INTERNAL_ONLY', 'SENDER_RECALLABLE', 'PUBLIC_RECALLABLE',
]);
export const MEMORY_CONSISTENCY = Object.freeze(['CONSISTENT', 'CONFLICTED', 'UNCERTAIN']);

// Sources whose text is Cy's own first-person voice. For these the text is
// never testimony authored by a correspondent, so it can never be the basis
// for a PERSON memory about that correspondent: Cy describing his own cell,
// feelings or situation (even while addressing a named sender) must not become
// a PERSON fact about the sender. PERSON memories belong only to sources the
// correspondent authored (a POSTCARD) or an observed world actor. The prompt
// already says as much for CY_REPLY, but the model still produced the
// inversion in production (memory cf87c2d2), so the rule is also enforced
// deterministically in the formation parsers below.
export const CY_AUTHORED_SOURCE_TYPES = Object.freeze([
  'CY_REPLY', 'CY_EXPRESSION', 'DREAM_EXPRESSION',
]);

export function isCyAuthoredSource(source) {
  if (!source) return false;
  // Prefer an explicit authorship marker if present, but fall back to the
  // source type so sources already enqueued before any such field existed
  // (the durable formation backlog) are still classified correctly.
  if (source.authoredBy) return source.authoredBy === 'CY';
  return CY_AUTHORED_SOURCE_TYPES.includes(source.sourceType);
}

// ENGINEERING context-budget limits. These are not psychological capacities.
export const MEMORY_CANDIDATE_LIMIT = 10;
export const MEMORY_SURFACE_LIMIT = 3;
export const MEMORY_FORMATION_MATCH_LIMIT = 5;
export const MEMORY_FORMATION_QUEUE_LIMIT = 32;
export const MEMORY_PUBLIC_PAGE_LIMIT = 20;
export const MEMORY_EXPRESSION_BATCH_LIMIT = 4;

const HIDDEN_IDENTIFIER = /(?:visitor[_ -]?id|cookie|ip address|account[_ -]?id|moderation|rate[_ -]?limit)/i;
const INTERNAL_ID_TEST = /\b(?:[a-f0-9]{32}|env-[0-9a-f-]{32,}|memory:[0-9a-f-]{32,})\b/i;
const INTERNAL_ID_REPLACE = /\b(?:[a-f0-9]{32}|env-[0-9a-f-]{32,}|memory:[0-9a-f-]{32,})\b/gi;
const WORD = /[a-z0-9']+/g;

function list(value, allowed = null, limit = 16) {
  const out = [];
  for (const item of Array.isArray(value) ? value : []) {
    const v = String(item || '').trim();
    if (!v || (allowed && !allowed.includes(v)) || out.includes(v)) continue;
    out.push(v);
    if (out.length >= limit) break;
  }
  return out;
}

export function retrievalTerms(text) {
  const terms = String(text || '').toLowerCase().match(WORD) || [];
  return [...new Set(terms.filter((term) => term.length >= 3))].slice(0, 48);
}

export function assertPromptSafe(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value || {});
  if (HIDDEN_IDENTIFIER.test(text) || INTERNAL_ID_TEST.test(text)) {
    throw new Error('private technical identifier reached model-facing memory material');
  }
  return text;
}

export function memoryVisibleTo(memory, currentVisitorId = null) {
  if (!memory || memory.status !== 'ACTIVE') return false;
  if (memory.privacyScope === 'INTERNAL_ONLY') {
    return !memory.subjectVisitorId || !currentVisitorId
      || memory.subjectVisitorId === currentVisitorId;
  }
  if (memory.privacyScope === 'PUBLIC_RECALLABLE') return true;
  if (memory.privacyScope !== 'SENDER_RECALLABLE') return false;
  return !!currentVisitorId && memory.subjectVisitorId === currentVisitorId;
}

export function filterMemoriesBeforePrompt(memories, { currentVisitorId = null } = {}) {
  return (Array.isArray(memories) ? memories : [])
    .filter((memory) => memoryVisibleTo(memory, currentVisitorId))
    .map((memory) => {
      const crossVisitor = currentVisitorId !== null
        && memory.privacyScope === 'PUBLIC_RECALLABLE'
        && memory.subjectVisitorId !== currentVisitorId;
      const content = sanitizeCharacterContext(crossVisitor ? memory.publicSummary : memory.content);
      if (!content) return null;
      return {
        id: memory.id,
        type: memory.type,
        privacyScope: memory.privacyScope,
        subjectVisitorId: memory.subjectVisitorId || null,
        epistemicStatus: 'SUBJECTIVE_AUTOBIOGRAPHICAL_MEMORY',
        consistencyStatus: memory.consistencyStatus || 'UNCERTAIN',
        content: assertPromptSafe(String(content).replace(INTERNAL_ID_REPLACE, '[private reference]')),
        publicSummary: memory.publicSummary
          ? sanitizeCharacterContext(memory.publicSummary) || null : null,
        tags: list(memory.tags, null, 12),
        reasons: list(memory.reasons, [
          'SAME_PERSON', 'SAME_PLACE', 'SHARED_ENTITIES', 'SIMILAR_SUBJECT',
          'UNRESOLVED_THREAD', 'CURRENT_EVENT', 'DIRECT_SENDER_HISTORY',
        ], 6),
      };
    })
    .filter(Boolean);
}

export function buildFormationRequest(source, existing = [], groundedContext = null) {
  const expression = sanitizeCyExpressionSource(source);
  if (!expression) throw new Error('empty Cy expression after character-boundary sanitisation');
  const senderCorrespondence = ['POSTCARD', 'CY_REPLY'].includes(expression.sourceType);
  const safeSource = {
    sourceType: expression.sourceType,
    occurredAt: expression.occurredAt,
    text: expression.text,
    sourceVisibility: expression.sourceVisibility || 'INTERNAL_ONLY',
    participantLabel: expression.participantLabel || null,
    tags: list(expression.tags, null, 12),
  };
  assertPromptSafe(safeSource);
  const candidates = filterMemoriesBeforePrompt(existing, {
    currentVisitorId: source.subjectVisitorId || null,
  }).filter((memory) => !senderCorrespondence
    || (memory.privacyScope === 'SENDER_RECALLABLE' && memory.subjectVisitorId === source.subjectVisitorId))
    .filter((memory) => source.sourceVisibility !== 'SENDER_RECALLABLE'
    || (memory.privacyScope === 'SENDER_RECALLABLE'
      && memory.subjectVisitorId === source.subjectVisitorId))
    .slice(0, MEMORY_FORMATION_MATCH_LIMIT).map((memory, index) => ({
    id: memory.id,
    memoryRef: `${senderCorrespondence ? 'FM' : 'C'}${index + 1}`,
    type: memory.type,
    content: memory.content,
    consistencyStatus: memory.consistencyStatus,
  }));
  if (groundedContext) assertPromptSafe(groundedContext);
  if (senderCorrespondence) {
    if (!source.subjectVisitorId || source.sourceVisibility !== 'SENDER_RECALLABLE') {
      throw new Error('sender formation requires canonical sender provenance');
    }
    const format = senderFormationSchema(candidates);
    return {
      system: [
        'Select one durable autobiographical memory decision from this correspondence. Return only the constrained JSON object.',
        'Use only the current source and offered memories, not facts in these instruction examples. No transcript or invented facts.',
        'PERSON: durable facts about this sender: identity, family, pets, interests, ongoing circumstances, preferences or meaningful personal history.',
        'UNRESOLVED_THREAD: a genuinely persistent open issue worth returning to, not every question or social greeting.',
        'EPISODIC: a meaningful experienced event, not a fallback for personal facts. MOTIF: a supported recurring pattern. SEMANTIC: durable general knowledge.',
        'Prefer NOTHING for greetings, politeness, repetition or no durable future value.',
        'CREATE for new information. UPDATE only an offered FM reference, preserving its type. For an offered UNRESOLVED_THREAD, decide first whether the new same-sender source closes it.',
        'RESOLVE when the offered topic is explicitly answered, settled, completed, withdrawn or no longer open. UPDATE only when it remains genuinely open and has materially changed. Never use UPDATE merely to record the answer to a settled question. No resolution from silence.',
        'Content must conservatively abstract only supported facts. Do not invent motives, withholding, reluctance, deception, uncertainty or emotions unless directly supported by the source. An unknown result does not mean the sender is unwilling to share it.',
        'A POSTCARD is the sender speaking. A CY_REPLY is Cy speaking, not new testimony about the sender. Preserve who said what and uncertainty.',
        'From a CY_REPLY never CREATE or UPDATE a PERSON memory: Cy describing his own cell, situation or feelings is never a fact about the sender.',
        'Examples of decisions (not facts about this sender): "my dog is called Alfie" -> CREATE PERSON, content "The sender says their dog is called Alfie.";',
        '"I am waiting for an important result and will tell you next time" -> CREATE UNRESOLVED_THREAD; "Hi, hope you are okay" -> NOTHING;',
        'Contrast: offered FM1 awaits an application decision; "it was approved, that is settled" -> RESOLVE FM1, not UPDATE. "the decision is delayed until next week; I am still waiting" -> UPDATE FM1 because it remains open. With no offered candidates, never UPDATE or RESOLVE.',
        'Content: one concise third-person recollection, at most 480 characters. Do not invent technical IDs, candidate refs or privacy fields; CY attaches provenance and sender-only scope.',
      ].join('\n'),
      prompt: JSON.stringify({ source: safeSource, groundedContext: groundedContext || null,
        existingMemoryCandidates: candidates.map(({ id, ...candidate }) => candidate) }),
      format,
      options: { temperature: 0.1, num_predict: 260 },
      purpose: 'memory_formation', candidates,
    };
  }
  return {
    system: [
      'You perform MODEL-MEDIATED AUTOBIOGRAPHICAL MEMORY FORMATION for a fictional character.',
      'Return one JSON object only. Do not explain your reasoning.',
      'World history is immutable. Every proposed memory is subjective autobiography, never world fact.',
      'Allowed decision values: CREATE, UPDATE, RESOLVE, NOTHING.',
      'Allowed memory types: ' + MEMORY_TYPES.join(', ') + '.',
      'Allowed privacy scopes: ' + MEMORY_SCOPES.join(', ') + '.',
      'For UPDATE, memoryRef must name one supplied candidate. Preserve uncertainty and contradictions.',
      senderCorrespondence
        ? 'RESOLVE only when this source clearly settles an offered unresolved topic from this sender. Do not infer resolution from silence or similar wording.' : null,
      senderCorrespondence
        ? 'For sender postcards, keep durable personal facts and genuinely open questions, not trivial wording or a transcript.' : null,
      'Do not include technical identifiers, scores, hidden metadata, or claims not present in the source.',
    ].filter(Boolean).join('\n'),
    prompt: JSON.stringify({
      source: safeSource,
      groundedContext: groundedContext || null,
      existingMemoryCandidates: candidates.map(({ id, ...candidate }) => candidate),
      outputSchema: {
        decision: 'CREATE | UPDATE | RESOLVE | NOTHING',
        memoryRef: 'required for UPDATE or RESOLVE',
        type: 'required for CREATE',
        privacyScope: 'required for CREATE',
        content: 'subjective autobiographical wording',
        publicSummary: 'required only for PUBLIC_RECALLABLE; anonymous by default',
        classification: 'brief descriptive class',
        consistencyStatus: 'CONSISTENT | CONFLICTED | UNCERTAIN',
        tags: ['structured', 'retrieval', 'terms'],
      },
    }),
    options: { temperature: 0.1, num_predict: 260 },
    purpose: 'memory_formation',
    candidates,
  };
}

// Small action-specific grammar. Only this sender path opts into constrained
// output; other memory sources retain their established formation contract.
export function senderFormationSchema(candidates = []) {
  const content = { type: 'string', minLength: 1, maxLength: 480 };
  const branch = (decision, fields = {}) => ({ type: 'object',
    properties: { decision: { const: decision }, ...fields },
    required: ['decision', ...Object.keys(fields)], additionalProperties: false });
  const choices = [branch('NOTHING'), branch('CREATE', {
    type: { enum: [...MEMORY_TYPES] }, content,
  })];
  if (candidates.length) choices.push(branch('UPDATE', {
    memoryRef: { enum: candidates.map(memory => memory.memoryRef) }, content,
  }));
  const unresolved = candidates.filter(memory => memory.type === 'UNRESOLVED_THREAD');
  if (unresolved.length) choices.push(branch('RESOLVE', {
    memoryRef: { enum: unresolved.map(memory => memory.memoryRef) },
  }));
  return { oneOf: choices };
}

function parseSenderFormationResponse(raw, { source, existing, makeId }) {
  const invalid = (rejectionCode) => ({ decision: 'NOTHING', valid: false, rejectionCode });
  if (!source.subjectVisitorId || source.sourceVisibility !== 'SENDER_RECALLABLE') {
    return invalid('PRIVACY_PROVENANCE');
  }
  let parsed;
  try { parsed = JSON.parse(String(raw || '').trim()); } catch { return invalid('JSON_FORMAT'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return invalid('SCHEMA');
  if (!Object.hasOwn(parsed, 'decision')) return invalid('MISSING_FIELD');
  const fields = { NOTHING: [], CREATE: ['type', 'content'], UPDATE: ['memoryRef', 'content'], RESOLVE: ['memoryRef'] };
  if (typeof parsed.decision !== 'string' || !Object.hasOwn(fields, parsed.decision)) return invalid('ILLEGAL_ACTION');
  const allowed = ['decision', ...fields[parsed.decision]];
  if (Object.keys(parsed).some(key => !allowed.includes(key))) return invalid('FORBIDDEN_FIELD');
  if (allowed.some(key => !Object.hasOwn(parsed, key))) return invalid('MISSING_FIELD');
  if (parsed.decision === 'NOTHING') return { decision: 'NOTHING', valid: true };
  if (parsed.decision === 'CREATE' && !MEMORY_TYPES.includes(parsed.type)) return invalid('ILLEGAL_TYPE');
  // Cy's own reply is not testimony about the sender: never let it mint a
  // PERSON memory about the correspondent (production defect cf87c2d2).
  // Terminal NOTHING, not INVALID, so the source is not re-tried.
  if (parsed.decision === 'CREATE' && parsed.type === 'PERSON' && isCyAuthoredSource(source)) {
    return { decision: 'NOTHING', valid: true, blockedReason: 'CY_AUTHORED_PERSON_BLOCKED' };
  }
  let target = null;
  if (parsed.decision === 'UPDATE' || parsed.decision === 'RESOLVE') {
    const match = /^FM([1-5])$/.exec(typeof parsed.memoryRef === 'string' ? parsed.memoryRef : '');
    target = match ? existing[Number(match[1]) - 1] : null;
    if (!target) return invalid('UNKNOWN_REF');
    if (target.status !== 'ACTIVE' || target.privacyScope !== 'SENDER_RECALLABLE'
        || target.subjectVisitorId !== source.subjectVisitorId) return invalid('PRIVACY_PROVENANCE');
    if (parsed.decision === 'RESOLVE' && target.type !== 'UNRESOLVED_THREAD') return invalid('SCHEMA');
    // Nor may Cy's own reply graft his self-statements onto an existing PERSON
    // memory about the sender via UPDATE.
    if (parsed.decision === 'UPDATE' && target.type === 'PERSON' && isCyAuthoredSource(source)) {
      return { decision: 'NOTHING', valid: true, blockedReason: 'CY_AUTHORED_PERSON_BLOCKED' };
    }
  }
  if (parsed.decision === 'RESOLVE') return { decision: 'ARCHIVE', valid: true,
    memoryId: target.id, expectedVersion: target.version, source };
  if (typeof parsed.content !== 'string' || !parsed.content.trim()) return invalid('MISSING_FIELD');
  if (parsed.content.length > 480) return invalid('SCHEMA');
  const content = parsed.content.trim();
  try { assertPromptSafe(content); } catch { return invalid('PRIVACY_PROVENANCE'); }
  const common = { valid: true, content, publicSummary: null, consistencyStatus: 'UNCERTAIN',
    tags: retrievalTerms(content).slice(0, 12), source };
  if (parsed.decision === 'UPDATE') return { ...common, decision: 'UPDATE',
    memoryId: target.id, expectedVersion: target.version, classification: target.classification || '' };
  return { ...common, decision: 'CREATE', memoryId: makeId(), type: parsed.type,
    privacyScope: 'SENDER_RECALLABLE', classification: 'sender correspondence' };
}

function extractJson(raw) {
  const text = String(raw || '').trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first < 0 || last <= first) return null;
  try { return JSON.parse(text.slice(first, last + 1)); } catch { return null; }
}

export function parseFormationResponse(raw, { source, existing = [], makeId } = {}) {
  if (['POSTCARD', 'CY_REPLY'].includes(source?.sourceType)) {
    return parseSenderFormationResponse(raw, { source, existing, makeId });
  }
  const parsed = extractJson(raw);
  if (!parsed || !['CREATE', 'UPDATE', 'RESOLVE', 'NOTHING'].includes(parsed.decision)) {
    return { decision: 'NOTHING', valid: false };
  }
  if (parsed.decision === 'NOTHING') return { decision: 'NOTHING', valid: true };
  if (parsed.decision === 'RESOLVE') {
    const refMatch = /^C([1-5])$/.exec(String(parsed.memoryRef || ''));
    const target = refMatch ? existing[Number(refMatch[1]) - 1] : null;
    if (!target || target.type !== 'UNRESOLVED_THREAD' || target.status !== 'ACTIVE'
        || target.subjectVisitorId !== source?.subjectVisitorId || !source?.subjectVisitorId) {
      return { decision: 'NOTHING', valid: false };
    }
    return {
      decision: 'ARCHIVE', valid: true, memoryId: target.id,
      expectedVersion: target.version, source,
    };
  }
  const content = String(parsed.content || '').trim().slice(0, 2000);
  if (!content) return { decision: 'NOTHING', valid: false };
  try { assertPromptSafe(content); } catch { return { decision: 'NOTHING', valid: false }; }
  const consistencyStatus = MEMORY_CONSISTENCY.includes(parsed.consistencyStatus)
    ? parsed.consistencyStatus : 'UNCERTAIN';
  const tags = list(parsed.tags, null, 12);
  if (parsed.decision === 'UPDATE') {
    const refMatch = /^C([1-5])$/.exec(String(parsed.memoryRef || ''));
    const target = refMatch ? existing[Number(refMatch[1]) - 1] : null;
    if (!target) return { decision: 'NOTHING', valid: false };
    // A Cy-authored source (CY_EXPRESSION / DREAM_EXPRESSION) must not rewrite
    // a PERSON memory with Cy's own self-description.
    if (target.type === 'PERSON' && isCyAuthoredSource(source)) {
      return { decision: 'NOTHING', valid: true, blockedReason: 'CY_AUTHORED_PERSON_BLOCKED' };
    }
    return {
      decision: 'UPDATE', valid: true, memoryId: target.id, expectedVersion: target.version,
      content, publicSummary: target.privacyScope === 'PUBLIC_RECALLABLE'
        ? String(parsed.publicSummary || target.publicSummary || '').trim().slice(0, 600) : null,
      classification: String(parsed.classification || target.classification || '').trim().slice(0, 80),
      consistencyStatus, tags, source,
    };
  }
  if (!MEMORY_TYPES.includes(parsed.type) || !MEMORY_SCOPES.includes(parsed.privacyScope)) {
    return { decision: 'NOTHING', valid: false };
  }
  // A Cy-authored source cannot mint a PERSON memory about anyone else.
  if (parsed.type === 'PERSON' && isCyAuthoredSource(source)) {
    return { decision: 'NOTHING', valid: true, blockedReason: 'CY_AUTHORED_PERSON_BLOCKED' };
  }
  const privacyScope = source && source.sourceVisibility === 'SENDER_RECALLABLE'
    ? 'SENDER_RECALLABLE' : parsed.privacyScope;
  const publicSummary = privacyScope === 'PUBLIC_RECALLABLE'
    ? String(parsed.publicSummary || '').trim().slice(0, 600) : null;
  if (privacyScope === 'PUBLIC_RECALLABLE' && !publicSummary) {
    return { decision: 'NOTHING', valid: false };
  }
  try { if (publicSummary) assertPromptSafe(publicSummary); } catch {
    return { decision: 'NOTHING', valid: false };
  }
  return {
    decision: 'CREATE', valid: true, memoryId: makeId(), type: parsed.type,
    privacyScope, content, publicSummary,
    classification: String(parsed.classification || '').trim().slice(0, 80),
    consistencyStatus, tags, source,
  };
}

export function buildSurfacingRequest(candidates, currentContext = {}) {
  if (currentContext.groundedContext) assertPromptSafe(currentContext.groundedContext);
  const safe = filterMemoriesBeforePrompt(candidates, {
    currentVisitorId: currentContext.currentVisitorId || null,
  }).slice(0, MEMORY_CANDIDATE_LIMIT).map((memory, index) => ({
    id: memory.id,
    memoryRef: `C${index + 1}`,
    type: memory.type,
    content: memory.content,
    consistencyStatus: memory.consistencyStatus,
    retrievalReasons: memory.reasons,
  }));
  return {
    candidates: safe,
    call: {
      system: [
        'You perform SUBJECTIVE CHARACTER MEMORY ACCESS for a fictional character.',
        'Select zero to three supplied memories that naturally belong in the immediate context.',
        'Return JSON only: {"memoryRefs":[...]}. Do not explain reasoning and do not invent IDs.',
      ].join('\n'),
      prompt: JSON.stringify({
        currentSituation: currentContext.publicSituation || null,
        groundedContext: currentContext.groundedContext || null,
        currentSender: currentContext.senderLabel || null,
        candidates: safe.map(({ id, ...candidate }) => candidate),
      }),
      options: { temperature: 0.1, num_predict: 80 },
      purpose: 'memory_surfacing',
    },
  };
}

export function parseSurfacingResponse(raw, candidates) {
  return parseSurfacingDecision(raw, candidates).ids;
}

export function parseSurfacingDecision(raw, candidates) {
  const parsed = extractJson(raw);
  if (!parsed || !Array.isArray(parsed.memoryRefs)) return { valid: false, ids: [] };
  const byRef = new Map((candidates || []).map((memory) => [memory.memoryRef, memory.id]));
  const ids = list(parsed && parsed.memoryRefs, null, MEMORY_CANDIDATE_LIMIT)
    .map((ref) => byRef.get(ref))
    .filter(Boolean)
    .slice(0, MEMORY_SURFACE_LIMIT);
  return { valid: true, ids: [...new Set(ids)].slice(0, MEMORY_SURFACE_LIMIT) };
}

export function formatAutobiographicalMemory(memories) {
  const visible = (memories || []).map((memory) => ({
    ...memory, content: sanitizeCharacterContext(memory.content),
  })).filter((memory) => memory.content).slice(0, MEMORY_SURFACE_LIMIT);
  if (!visible.length) return '';
  const lines = [
    '<AUTOBIOGRAPHICAL_MEMORY>',
    'Private subjective recollections for continuity. Do not describe this block or its machinery.',
    'These are memories, not authoritative world facts. Contradictions and uncertainty must remain uncertain.',
  ];
  for (const memory of visible) {
    lines.push('', 'MEMORY');
    lines.push(`type: ${String(memory.type || 'EPISODIC').toLowerCase()}`);
    lines.push('epistemic status: subjective autobiographical memory');
    lines.push(`consistency: ${String(memory.consistencyStatus || 'UNCERTAIN').toLowerCase()}`);
    lines.push(`content: ${assertPromptSafe(memory.content)}`);
  }
  lines.push('</AUTOBIOGRAPHICAL_MEMORY>');
  return lines.join('\n');
}

// Generation events are public diagnostics. Private memory text and exact IDs
// belong only in the owner-gated query ledger, never in that event stream.
export function redactAutobiographicalMemoryFromTelemetry(value) {
  if (value == null) return null;
  return String(value).replace(
    /<AUTOBIOGRAPHICAL_MEMORY>[\s\S]*?<\/AUTOBIOGRAPHICAL_MEMORY>/g,
    '<AUTOBIOGRAPHICAL_MEMORY>\n[private memory context omitted from public telemetry]\n</AUTOBIOGRAPHICAL_MEMORY>',
  );
}

export function publicMemoryQueryTelemetry(inspection) {
  if (!inspection || typeof inspection !== 'object') return null;
  return {
    status: inspection.status || 'UNKNOWN',
    sender_known: !!inspection.senderKnown,
    mechanisms: Array.isArray(inspection.mechanisms) ? inspection.mechanisms : [],
    privacy_filter: inspection.privacyFilter || null,
    candidate_count: Array.isArray(inspection.candidateIds) ? inspection.candidateIds.length : 0,
    offered_count: Array.isArray(inspection.offeredIds) ? inspection.offeredIds.length : 0,
    selected_count: Array.isArray(inspection.selectedIds) ? inspection.selectedIds.length : 0,
    inserted_count: Array.isArray(inspection.insertedIds) ? inspection.insertedIds.length : 0,
    boundaries: inspection.boundaries || null,
  };
}

export function sourceFromEnvironmentRecord(record) {
  const world = record && record.world_event;
  if (!world || !world.id) return null;
  // Postcard contact has its own sender-scoped POSTCARD/CY_REPLY source. The
  // observed world record remains intact, but must not form an unlinked copy
  // of private correspondence under a different source identity.
  if (['postcard', 'postcard_with_image', 'postcard_reply'].includes(world.event_type)) return null;
  const summary = world.context && world.context.description
    || record.observation && record.observation.summary
    || world.event_type;
  const actor = world.participants && world.participants.actor;
  return {
    sourceType: 'ENVIRONMENT_EVENT', sourceId: world.id, occurredAt: world.timestamp,
    text: String(summary || '').slice(0, 1200), sourceVisibility: 'INTERNAL_ONLY',
    participantLabel: actor || null, subjectVisitorId: null,
    tags: [world.event_family, world.event_type, world.context && world.context.location].filter(Boolean),
  };
}

export function sourceFromPostcard(postcard, environmentEventId) {
  if (!postcard || !postcard.id) return null;
  return {
    sourceType: 'POSTCARD', sourceId: `postcard:${postcard.id}`, occurredAt: postcard.posted_at || null,
    text: [postcard.body, postcard.caption].filter(Boolean).join(' | ').slice(0, 1200),
    sourceVisibility: 'SENDER_RECALLABLE', participantLabel: postcard.from_name || 'the sender',
    subjectVisitorId: postcard.visitor_id || null,
    linkedSourceIds: environmentEventId ? [environmentEventId] : [],
    tags: ['postcard', postcard.image_path ? 'image' : 'text'],
  };
}

export function sourceFromExpression(text, sourceId, occurredAt = null) {
  const content = sanitizeExpressionParagraphs(text);
  if (!content || !sourceId) return null;
  return {
    sourceType: 'CY_EXPRESSION', sourceId, occurredAt,
    text: content.slice(0, 1600), sourceVisibility: 'INTERNAL_ONLY',
    participantLabel: 'Cy', subjectVisitorId: null, tags: ['cy-expression'],
  };
}

export function sourceFromDreamExpression(fragments, sourceId, occurredAt = null) {
  const content = (Array.isArray(fragments) ? fragments : [])
    .map((fragment) => String(fragment || '').trim()).filter(Boolean).join(' / ');
  if (!content || !sourceId) return null;
  return {
    sourceType: 'DREAM_EXPRESSION', sourceId, occurredAt,
    text: content.slice(0, 1200), sourceVisibility: 'INTERNAL_ONLY',
    participantLabel: 'Cy', subjectVisitorId: null,
    tags: ['dream', 'subjective-expression'],
  };
}

export function sourceFromReply(text, postcard, environmentEventId, occurredAt = null) {
  const content = sanitizeExpressionParagraphs(text);
  if (!content || !postcard || !postcard.id || !postcard.visitor_id) return null;
  return {
    sourceType: 'CY_REPLY', sourceId: `postcard-reply:${postcard.id}`, occurredAt,
    text: content.slice(0, 1600), sourceVisibility: 'SENDER_RECALLABLE',
    participantLabel: postcard.from_name || 'the sender',
    subjectVisitorId: postcard.visitor_id,
    linkedSourceIds: environmentEventId ? [environmentEventId] : [],
    tags: ['cy-expression', 'postcard', 'reply'],
  };
}

// A batch of Cy's already-published bursts uses blank lines as its durable
// boundary. A tainted burst may have a sound prefix; subsequent independent
// bursts can also be retained. Never edit the historical source row itself.
function sanitizeExpressionParagraphs(text) {
  return String(text || '').split(/\n\s*\n/)
    .map((paragraph) => sanitizeCharacterContext(paragraph).trim())
    .filter(Boolean).join('\n\n');
}

export function sanitizeCyExpressionSource(source) {
  if (!source || !['CY_EXPRESSION', 'CY_REPLY'].includes(source.sourceType)) return source;
  const text = sanitizeExpressionParagraphs(source.text);
  return text ? { ...source, text } : null;
}

export const MEMORY_MODEL_BOUNDARIES = Object.freeze({
  semanticVectorRetrieval: 'NOT IMPLEMENTED',
  biologicalForgetting: 'NOT MODELLED',
  somaModulatedMemoryAccess: 'NOT MODELLED',
  stressInducedWorkingContextNarrowing: 'NOT MODELLED',
  cognitiveBreakdown: 'NOT MODELLED',
});
