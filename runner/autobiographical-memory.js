// autobiographical-memory.js - bounded subjective memory formation and access.
//
// This is an engineering information-retrieval system, not a biological memory
// model. World records stay authoritative. Every autobiographical record is
// subjective, versioned and provenance-bearing. Privacy is filtered before any
// candidate can enter a model prompt.

export const MEMORY_TYPES = Object.freeze([
  'EPISODIC', 'PERSON', 'MOTIF', 'UNRESOLVED_THREAD', 'SEMANTIC',
]);
export const MEMORY_SCOPES = Object.freeze([
  'INTERNAL_ONLY', 'SENDER_RECALLABLE', 'PUBLIC_RECALLABLE',
]);
export const MEMORY_CONSISTENCY = Object.freeze(['CONSISTENT', 'CONFLICTED', 'UNCERTAIN']);

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
      const content = crossVisitor ? memory.publicSummary : memory.content;
      if (!content) return null;
      return {
        id: memory.id,
        type: memory.type,
        privacyScope: memory.privacyScope,
        subjectVisitorId: memory.subjectVisitorId || null,
        epistemicStatus: 'SUBJECTIVE_AUTOBIOGRAPHICAL_MEMORY',
        consistencyStatus: memory.consistencyStatus || 'UNCERTAIN',
        content: assertPromptSafe(String(content).replace(INTERNAL_ID_REPLACE, '[private reference]')),
        publicSummary: memory.publicSummary || null,
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
  const safeSource = {
    sourceType: source.sourceType,
    occurredAt: source.occurredAt,
    text: source.text,
    sourceVisibility: source.sourceVisibility || 'INTERNAL_ONLY',
    participantLabel: source.participantLabel || null,
    tags: list(source.tags, null, 12),
  };
  assertPromptSafe(safeSource);
  const candidates = filterMemoriesBeforePrompt(existing, {
    currentVisitorId: source.subjectVisitorId || null,
  }).filter((memory) => source.sourceVisibility !== 'SENDER_RECALLABLE'
    || (memory.privacyScope === 'SENDER_RECALLABLE'
      && memory.subjectVisitorId === source.subjectVisitorId))
    .slice(0, MEMORY_FORMATION_MATCH_LIMIT).map((memory, index) => ({
    id: memory.id,
    memoryRef: `C${index + 1}`,
    type: memory.type,
    content: memory.content,
    consistencyStatus: memory.consistencyStatus,
  }));
  if (groundedContext) assertPromptSafe(groundedContext);
  return {
    system: [
      'You perform MODEL-MEDIATED AUTOBIOGRAPHICAL MEMORY FORMATION for a fictional character.',
      'Return one JSON object only. Do not explain your reasoning.',
      'World history is immutable. Every proposed memory is subjective autobiography, never world fact.',
      'Allowed decision values: CREATE, UPDATE, NOTHING.',
      'Allowed memory types: ' + MEMORY_TYPES.join(', ') + '.',
      'Allowed privacy scopes: ' + MEMORY_SCOPES.join(', ') + '.',
      'For UPDATE, memoryRef must name one supplied candidate. Preserve uncertainty and contradictions.',
      'Do not include technical identifiers, scores, hidden metadata, or claims not present in the source.',
    ].join('\n'),
    prompt: JSON.stringify({
      source: safeSource,
      groundedContext: groundedContext || null,
      existingMemoryCandidates: candidates.map(({ id, ...candidate }) => candidate),
      outputSchema: {
        decision: 'CREATE | UPDATE | NOTHING',
        memoryRef: 'required for UPDATE',
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

function extractJson(raw) {
  const text = String(raw || '').trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first < 0 || last <= first) return null;
  try { return JSON.parse(text.slice(first, last + 1)); } catch { return null; }
}

export function parseFormationResponse(raw, { source, existing = [], makeId } = {}) {
  const parsed = extractJson(raw);
  if (!parsed || !['CREATE', 'UPDATE', 'NOTHING'].includes(parsed.decision)) {
    return { decision: 'NOTHING', valid: false };
  }
  if (parsed.decision === 'NOTHING') return { decision: 'NOTHING', valid: true };
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
  const visible = (memories || []).slice(0, MEMORY_SURFACE_LIMIT);
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
  const content = String(text || '').trim();
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
  const content = String(text || '').trim();
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

export const MEMORY_MODEL_BOUNDARIES = Object.freeze({
  semanticVectorRetrieval: 'NOT IMPLEMENTED',
  biologicalForgetting: 'NOT MODELLED',
  somaModulatedMemoryAccess: 'NOT MODELLED',
  stressInducedWorkingContextNarrowing: 'NOT MODELLED',
  cognitiveBreakdown: 'NOT MODELLED',
});
