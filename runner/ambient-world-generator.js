// ambient-world-generator.js - low-frequency structured prison-world proposals.
//
// The model is a narrative world-simulation content generator. It proposes one
// candidate only. Deterministic code validates continuity, privacy, knowledge and
// pacing before any proposal may become authoritative world state.

import { CAST, OFFICERS } from './cast.js';

export const AWG_SCHEMA = 'cy.ambient-world-candidate';
export const AWG_SCHEMA_VERSION = 1;
export const WORLD_SIMULATION_SCHEMA = 'cy.ambient-world-state';
export const WORLD_SIMULATION_VERSION = 1;

export const AWG_EVENT_FAMILIES = Object.freeze([
  'MESSAGE_PASSING',
  'OVERHEARD_ACTIVITY',
  'SOCIAL_REQUEST',
  'RUMOUR',
  'OBJECT_TRANSFER',
  'OFFICER_ACTIVITY',
  'WING_ACTIVITY',
  'MISTAKEN_DELIVERY',
]);

export const AWG_OBSERVATION_ACCESS = Object.freeze([
  'WORLD_ONLY',
  'CY_DIRECT',
  'CY_PARTIAL_HEARD',
  'CY_LEARNS_LATER',
  'CAST_ONLY',
]);

export const AWG_TRUTH_STATUS = Object.freeze([
  'TRUE',
  'FALSE',
  'UNKNOWN',
  'DISPUTED',
]);

export const AWG_OBJECT_TYPES = Object.freeze([
  'note', 'message', 'permitted_item', 'contraband_item',
]);

export const AWG_OBJECT_STATUSES = Object.freeze([
  'ACTIVE', 'MISSING', 'CONFISCATED', 'DELIVERED',
]);

export const AWG_KNOWN_LOCATIONS = Object.freeze([
  'cell', 'landing', 'wing', 'association', 'servery', 'canteen', 'exercise_yard',
  'chapel', 'workshop', 'library', 'healthcare', 'visits', 'officer_desk', 'corridor',
]);

// ENGINEERING WORLD PACING.
export const AWG_CADENCE_MS = 45 * 60 * 1000;
export const AWG_MIN_EVENT_SPACING_MS = 30 * 60 * 1000;
export const AWG_EVENT_WINDOW_MS = 6 * 60 * 60 * 1000;
export const AWG_MAX_EVENTS_PER_WINDOW = 4;
export const AWG_MAX_OPEN_THREADS = 8;
export const AWG_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const AWG_RECENT_EVENT_LIMIT = 12;
export const AWG_RECENT_RUN_LIMIT = 20;

// ENGINEERING INFERENCE SCHEDULING.
export const INFERENCE_PRIORITIES = Object.freeze({
  VISITOR_REPLY: 1,
  CY_OUTWARD_GENERATION: 2,
  CRITICAL_MEMORY_SURFACING: 3,
  MEMORY_FORMATION: 4,
  AWG_BACKGROUND: 5,
});
export const AWG_MIN_IDLE_BUDGET_MS = 60000;
export const AWG_TIMEOUT_MS = 120000;
export const AWG_RETRY_LIMIT = 0;
export const AWG_MODEL_OPTIONS = Object.freeze({
  temperature: 0.65,
  top_p: 0.9,
  repeat_penalty: 1.1,
  repeat_last_n: 128,
  num_predict: 420,
});

const FORBIDDEN_KEYS = new Set([
  'appraisal', 'appraisalmagnitude', 'emotion', 'emotionscore',
  'emotionalmagnitude', 'brainactivation', 'anxiety', 'arousal', 'stress',
  'pain', 'hunger', 'fatigue', 'loneliness', 'anger', 'rumination',
  'rewritehistory', 'deleteevent', 'mutateevent', 'visitorid', 'senderid',
]);

const KNOWN_CAST_IDS = new Set(['cy', 'cy:7734', ...CAST.map((item) => item.key), ...OFFICERS.map((item) => item.key)]);
const KNOWN_OBSERVER_IDS = new Set(['world', ...KNOWN_CAST_IDS]);

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function clean(value, max = 1200) {
  return value == null ? '' : String(value).trim().slice(0, max);
}

function id(value) {
  return clean(value, 160).replace(/[^a-zA-Z0-9:_-]/g, '');
}

function isoMs(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : null;
}

function normaliseSummary(value) {
  return clean(value, 800).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function collectForbidden(value, path = 'candidate', found = []) {
  if (!value || typeof value !== 'object') return found;
  for (const [key, child] of Object.entries(value)) {
    const normalisedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (FORBIDDEN_KEYS.has(normalisedKey)) found.push(`${path}.${key}`);
    collectForbidden(child, `${path}.${key}`, found);
  }
  return found;
}

function containsForbiddenDirective(value) {
  const source = JSON.stringify(value || {}).toLowerCase();
  return /\b(anxiety|anger|arousal|stress|pain|hunger|fatigue|loneliness|rumination|threat|brain activation)\s*(?:\+?=|:\s*[.\d])/.test(source)
    || /\b(rewrite|delete|alter|erase)\s+(?:the\s+)?(?:history|event)/.test(source);
}

function containsPrivateVisitorMaterial(value) {
  const source = JSON.stringify(value || {}).toLowerCase();
  return /sender_recallable|internal_only|private visitor|visitor:[a-f0-9-]{8,}|currentvisitorid/.test(source);
}

function candidateEventCountInWindow(state, nowMs) {
  return state.recentAccepted.filter((event) => {
    const at = isoMs(event.occurredAt);
    return at != null && nowMs - at <= AWG_EVENT_WINDOW_MS;
  }).length;
}

export function reconcileWorldSimulationState(saved) {
  const source = saved && typeof saved === 'object' ? saved : {};
  return {
    schema: WORLD_SIMULATION_SCHEMA,
    version: WORLD_SIMULATION_VERSION,
    lastRunAt: clean(source.lastRunAt) || null,
    lastAcceptedAt: clean(source.lastAcceptedAt) || null,
    threads: Array.isArray(source.threads) ? clone(source.threads).slice(-AWG_MAX_OPEN_THREADS * 3) : [],
    objects: Array.isArray(source.objects) ? clone(source.objects).slice(-100) : [],
    recentAccepted: Array.isArray(source.recentAccepted) ? clone(source.recentAccepted).slice(-AWG_RECENT_EVENT_LIMIT) : [],
    recentRuns: Array.isArray(source.recentRuns) ? clone(source.recentRuns).slice(-AWG_RECENT_RUN_LIMIT) : [],
  };
}

export function shouldRunAwg(stateValue, {
  nowMs = Date.now(),
  idleBudgetMs = 0,
  pendingHigherPriority = false,
  memoryFormationBacklog = 0,
  inferenceBusy = false,
} = {}) {
  const state = reconcileWorldSimulationState(stateValue);
  if (pendingHigherPriority || inferenceBusy || memoryFormationBacklog > 0) {
    return { run: false, reason: 'HIGHER_PRIORITY_WORK' };
  }
  if (idleBudgetMs < AWG_MIN_IDLE_BUDGET_MS) return { run: false, reason: 'INSUFFICIENT_IDLE_BUDGET' };
  const lastRun = isoMs(state.lastRunAt);
  if (lastRun != null && nowMs - lastRun < AWG_CADENCE_MS) return { run: false, reason: 'CADENCE' };
  if (candidateEventCountInWindow(state, nowMs) >= AWG_MAX_EVENTS_PER_WINDOW) {
    return { run: false, reason: 'EVENT_WINDOW_LIMIT' };
  }
  return { run: true, reason: 'ELIGIBLE', priority: INFERENCE_PRIORITIES.AWG_BACKGROUND };
}

export function buildAwgCall(contextRendering) {
  const system = [
    'You are the Ambient World Generator for HMP ThinkPad.',
    'You are a narrative world-simulation content generator, not Cy, Soma, memory or a narrator.',
    'Propose exactly one structured candidate event, one continuation, or NO_EVENT.',
    'Use only known cast IDs and known locations supplied below. New cast generation is disabled.',
    'Use NOTE or MESSAGE as the canonical concept; do not force American prison slang.',
    'Do not assign emotions, Soma values, appraisal magnitudes or brain activation.',
    'A rumour claim is message content and must carry a truthStatus; it is not world truth.',
    'Return one JSON object only. Do not include reasoning or prose outside the object.',
  ].join('\n');
  const schema = {
    schema: AWG_SCHEMA,
    version: AWG_SCHEMA_VERSION,
    decision: 'NO_EVENT | EVENT | CONTINUATION',
    eventFamily: AWG_EVENT_FAMILIES.join(' | '),
    participants: ['known cast id'],
    location: AWG_KNOWN_LOCATIONS.join(' | '),
    occurredAt: 'ISO-8601 timestamp',
    objective: { eventType: 'short machine label', summary: 'objective occurrence only' },
    objects: [{ id: 'required stable object id', type: 'note | message | permitted_item | contraband_item', ownerId: 'known cast id or null', holderId: 'known cast id or null', location: 'known location', status: 'ACTIVE | MISSING | CONFISCATED | DELIVERED' }],
    observations: [{ observerId: 'known cast id, or world for WORLD_ONLY', access: AWG_OBSERVATION_ACCESS.join(' | '), summary: 'only what this observer could perceive' }],
    informationClaims: [{ speakerId: 'known cast id', content: 'reported claim', truthStatus: AWG_TRUTH_STATUS.join(' | ') }],
    resolved: false,
    thread: { action: 'NONE | OPEN | UPDATE | RESOLVE', id: 'existing id for update/resolve', type: 'short label', summary: 'open causal question', nextEligibleAt: 'ISO timestamp or null' },
    continuationOf: { threadId: 'existing thread id', eventIds: ['existing event id'] },
    publicTimeline: { eligible: false, text: 'Cy-accessible bracketed trace or null' },
  };
  return {
    system,
    prompt: `${clean(contextRendering, 12000)}\n\nKNOWN CAST IDS: ${[...KNOWN_CAST_IDS].join(', ')}\nKNOWN LOCATIONS: ${AWG_KNOWN_LOCATIONS.join(', ')}\nOUTPUT SCHEMA:\n${JSON.stringify(schema)}`,
    options: { ...AWG_MODEL_OPTIONS },
    purpose: 'ambient_world_generation',
  };
}

export function parseAwgCandidate(raw) {
  const source = clean(raw, 30000).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  if (!source) throw new Error('EMPTY_CANDIDATE');
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('NO_JSON_OBJECT');
  return JSON.parse(source.slice(start, end + 1));
}

function validateObservation(observation, errors) {
  if (!observation || typeof observation !== 'object') {
    errors.push('INVALID_OBSERVATION');
    return;
  }
  const observerId = id(observation.observerId);
  const access = clean(observation.access).toUpperCase();
  if (!KNOWN_OBSERVER_IDS.has(observerId)) errors.push('UNKNOWN_OBSERVER');
  if (!AWG_OBSERVATION_ACCESS.includes(access)) errors.push('INVALID_OBSERVATION_ACCESS');
  if ((observerId === 'world') !== (access === 'WORLD_ONLY')) errors.push('WORLD_ONLY_OBSERVER_MISMATCH');
  if (!clean(observation.summary)) errors.push('EMPTY_OBSERVATION_SUMMARY');
}

function validateObject(object, state, errors) {
  if (!object || typeof object !== 'object') {
    errors.push('INVALID_OBJECT');
    return;
  }
  const objectId = id(object.id);
  if (!objectId) errors.push('OBJECT_ID_REQUIRED');
  if (!AWG_OBJECT_TYPES.includes(clean(object.type).toLowerCase())) errors.push('INVALID_OBJECT_TYPE');
  if (object.ownerId != null && !KNOWN_CAST_IDS.has(id(object.ownerId))) errors.push('UNKNOWN_OBJECT_OWNER');
  if (object.holderId != null && !KNOWN_CAST_IDS.has(id(object.holderId))) errors.push('UNKNOWN_OBJECT_HOLDER');
  if (!AWG_KNOWN_LOCATIONS.includes(clean(object.location))) errors.push('UNKNOWN_OBJECT_LOCATION');
  if (!AWG_OBJECT_STATUSES.includes(clean(object.status).toUpperCase())) errors.push('INVALID_OBJECT_STATUS');
  const existing = state.objects.find((item) => item.id === objectId);
  if (existing && existing.status === 'CONFISCATED' && clean(object.status).toUpperCase() === 'ACTIVE') {
    errors.push('OBJECT_STATE_CONTRADICTION');
  }
}

export function validateAwgCandidate(candidateValue, stateValue, { nowMs = Date.now() } = {}) {
  const candidate = candidateValue && typeof candidateValue === 'object' ? clone(candidateValue) : null;
  const state = reconcileWorldSimulationState(stateValue);
  const errors = [];
  if (!candidate) return { valid: false, errors: ['INVALID_CANDIDATE'] };
  const decision = clean(candidate.decision).toUpperCase();
  if (!['NO_EVENT', 'EVENT', 'CONTINUATION'].includes(decision)) errors.push('INVALID_DECISION');
  if (candidate.schema !== AWG_SCHEMA || Number(candidate.version) !== AWG_SCHEMA_VERSION) errors.push('INVALID_SCHEMA');
  if (decision === 'NO_EVENT') {
    const forbidden = collectForbidden(candidate);
    if (forbidden.length) errors.push('FORBIDDEN_MODEL_OUTPUT');
    if (containsForbiddenDirective(candidate)) errors.push('FORBIDDEN_MODEL_OUTPUT');
    if (containsPrivateVisitorMaterial(candidate)) errors.push('PRIVATE_VISITOR_LEAKAGE');
    return { valid: errors.length === 0, errors, candidate: { schema: AWG_SCHEMA, version: 1, decision: 'NO_EVENT' } };
  }
  if (!AWG_EVENT_FAMILIES.includes(clean(candidate.eventFamily).toUpperCase())) errors.push('INVALID_EVENT_FAMILY');
  if (!AWG_KNOWN_LOCATIONS.includes(clean(candidate.location))) errors.push('UNKNOWN_LOCATION');
  const occurredAtMs = isoMs(candidate.occurredAt);
  if (occurredAtMs == null || occurredAtMs > nowMs + 5 * 60 * 1000 || occurredAtMs < nowMs - 24 * 60 * 60 * 1000) {
    errors.push('IMPOSSIBLE_CHRONOLOGY');
  }
  if (!candidate.objective || !clean(candidate.objective.eventType) || !clean(candidate.objective.summary)) errors.push('INVALID_OBJECTIVE');
  const participants = Array.isArray(candidate.participants) ? candidate.participants.map(id) : [];
  if (!participants.length || participants.some((participant) => !KNOWN_CAST_IDS.has(participant))) errors.push('UNKNOWN_CAST_ID');
  const observations = Array.isArray(candidate.observations) ? candidate.observations : [];
  if (!observations.length) errors.push('OBSERVABILITY_REQUIRED');
  observations.forEach((observation) => validateObservation(observation, errors));

  const claims = Array.isArray(candidate.informationClaims) ? candidate.informationClaims : [];
  claims.forEach((claim) => {
    if (!KNOWN_CAST_IDS.has(id(claim && claim.speakerId))) errors.push('UNKNOWN_CLAIM_SPEAKER');
    if (!clean(claim && claim.content)) errors.push('EMPTY_INFORMATION_CLAIM');
    if (!AWG_TRUTH_STATUS.includes(clean(claim && claim.truthStatus).toUpperCase())) errors.push('INVALID_TRUTH_STATUS');
  });
  if (clean(candidate.eventFamily).toUpperCase() === 'RUMOUR' && !claims.length) errors.push('RUMOUR_CLAIM_REQUIRED');

  const threadAction = clean(candidate.thread && candidate.thread.action).toUpperCase() || 'NONE';
  const continuationThreadId = id(candidate.continuationOf && candidate.continuationOf.threadId);
  if (decision === 'CONTINUATION') {
    const thread = state.threads.find((item) => item.id === continuationThreadId && item.state === 'OPEN');
    if (!thread) errors.push('INVALID_THREAD_REFERENCE');
    const refs = Array.isArray(candidate.continuationOf && candidate.continuationOf.eventIds)
      ? candidate.continuationOf.eventIds.map(id) : [];
    const knownEventIds = new Set([
      ...state.recentAccepted.map((item) => item.id),
      ...state.threads.flatMap((item) => item.sourceEventIds || []),
    ]);
    if (!refs.length || refs.some((ref) => !knownEventIds.has(ref))) errors.push('INVALID_EVENT_REFERENCE');
  }
  if (['UPDATE', 'RESOLVE'].includes(threadAction)) {
    const threadId = id(candidate.thread && candidate.thread.id);
    if (!state.threads.some((item) => item.id === threadId && item.state === 'OPEN')) errors.push('INVALID_THREAD_REFERENCE');
  }
  if (threadAction === 'OPEN' && state.threads.filter((item) => item.state === 'OPEN').length >= AWG_MAX_OPEN_THREADS) {
    errors.push('OPEN_THREAD_LIMIT');
  }

  const objects = Array.isArray(candidate.objects) ? candidate.objects : [];
  objects.forEach((object) => validateObject(object, state, errors));
  const objectIds = objects.map((object) => id(object && object.id)).filter(Boolean);
  if (new Set(objectIds).size !== objectIds.length) errors.push('DUPLICATE_OBJECT_ID');

  const forbidden = collectForbidden(candidate);
  if (forbidden.length) errors.push('FORBIDDEN_MODEL_OUTPUT');
  if (containsForbiddenDirective(candidate)) errors.push('FORBIDDEN_MODEL_OUTPUT');
  if (containsPrivateVisitorMaterial(candidate)) errors.push('PRIVATE_VISITOR_LEAKAGE');
  const lastAccepted = isoMs(state.lastAcceptedAt);
  if (lastAccepted != null && occurredAtMs != null && occurredAtMs - lastAccepted < AWG_MIN_EVENT_SPACING_MS) {
    errors.push('MINIMUM_EVENT_SPACING');
  }
  if (candidateEventCountInWindow(state, nowMs) >= AWG_MAX_EVENTS_PER_WINDOW) errors.push('EVENT_WINDOW_LIMIT');
  const signature = normaliseSummary(candidate.objective && candidate.objective.summary);
  const duplicate = state.recentAccepted.some((event) => {
    const at = isoMs(event.occurredAt);
    return at != null && nowMs - at <= AWG_DEDUPE_WINDOW_MS && event.signature === signature;
  });
  if (signature && duplicate) errors.push('DUPLICATE_EVENT');

  const cyObservation = observations.find((observation) => id(observation.observerId) === 'cy'
    || id(observation.observerId) === 'cy:7734');
  const cyAccess = cyObservation ? clean(cyObservation.access).toUpperCase() : null;
  const cyObserved = ['CY_DIRECT', 'CY_PARTIAL_HEARD', 'CY_LEARNS_LATER'].includes(cyAccess);
  if (candidate.publicTimeline && candidate.publicTimeline.eligible && !cyObserved) errors.push('PUBLIC_TIMELINE_KNOWLEDGE_LEAK');
  if (candidate.publicTimeline && candidate.publicTimeline.eligible && !clean(candidate.publicTimeline.text)) {
    errors.push('PUBLIC_TIMELINE_TEXT_REQUIRED');
  }

  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    candidate: errors.length ? candidate : {
      ...candidate,
      decision,
      eventFamily: clean(candidate.eventFamily).toUpperCase(),
      participants,
      observations: observations.map((observation) => ({
        observerId: id(observation.observerId),
        access: clean(observation.access).toUpperCase(),
        summary: clean(observation.summary, 800),
      })),
      informationClaims: claims.map((claim) => ({
        speakerId: id(claim.speakerId),
        content: clean(claim.content, 800),
        truthStatus: clean(claim.truthStatus).toUpperCase(),
      })),
    },
    cyObserved,
    cyObservation: cyObservation || null,
    signature,
  };
}

export function applyAwgCandidate(stateValue, validation, {
  makeId = (prefix) => `${prefix}:${Date.now()}`,
  acceptedAt = new Date().toISOString(),
} = {}) {
  if (!validation || !validation.valid || validation.candidate.decision === 'NO_EVENT') {
    return { state: reconcileWorldSimulationState(stateValue), accepted: false, event: null, changes: [] };
  }
  const state = reconcileWorldSimulationState(stateValue);
  const candidate = validation.candidate;
  const eventId = id(makeId('world'));
  const event = {
    id: eventId,
    occurredAt: candidate.occurredAt,
    eventFamily: candidate.eventFamily,
    eventType: clean(candidate.objective.eventType, 80),
    summary: clean(candidate.objective.summary, 800),
    signature: validation.signature,
    participants: [...candidate.participants],
    location: candidate.location,
    observations: clone(candidate.observations),
    informationClaims: clone(candidate.informationClaims || []),
    resolved: !!candidate.resolved,
    sourceThreadId: id(candidate.continuationOf && candidate.continuationOf.threadId) || null,
  };
  const changes = [];
  const action = clean(candidate.thread && candidate.thread.action).toUpperCase() || 'NONE';
  if (action === 'OPEN') {
    const thread = {
      id: id(candidate.thread.id) || id(makeId('thread')),
      type: clean(candidate.thread.type, 80) || candidate.eventFamily,
      createdAt: acceptedAt,
      updatedAt: acceptedAt,
      participants: [...candidate.participants],
      state: 'OPEN',
      summary: clean(candidate.thread.summary, 800) || event.summary,
      sourceEventIds: [eventId],
      nextEligibleAt: clean(candidate.thread.nextEligibleAt) || null,
      resolution: null,
      visibility: clone(candidate.observations),
    };
    state.threads.push(thread);
    changes.push({ action: 'OPEN', threadId: thread.id });
  } else if (['UPDATE', 'RESOLVE'].includes(action)) {
    const threadId = id(candidate.thread.id || (candidate.continuationOf && candidate.continuationOf.threadId));
    const thread = state.threads.find((item) => item.id === threadId);
    if (thread) {
      thread.updatedAt = acceptedAt;
      thread.summary = clean(candidate.thread.summary, 800) || thread.summary;
      thread.sourceEventIds = [...new Set([...(thread.sourceEventIds || []), eventId])];
      thread.nextEligibleAt = clean(candidate.thread.nextEligibleAt) || null;
      if (action === 'RESOLVE') {
        thread.state = 'RESOLVED';
        thread.resolution = { at: acceptedAt, eventId, summary: event.summary };
      }
      changes.push({ action, threadId });
    }
  }
  for (const object of Array.isArray(candidate.objects) ? candidate.objects : []) {
    const objectId = id(object.id) || id(makeId('object'));
    const existing = state.objects.find((item) => item.id === objectId);
    const value = {
      id: objectId,
      type: clean(object.type, 80),
      ownerId: object.ownerId == null ? null : id(object.ownerId),
      holderId: object.holderId == null ? null : id(object.holderId),
      location: clean(object.location),
      status: clean(object.status).toUpperCase(),
      visibility: clone(candidate.observations),
      sourceEventId: existing ? existing.sourceEventId : eventId,
      updatedAt: acceptedAt,
    };
    if (existing) Object.assign(existing, value);
    else state.objects.push(value);
  }
  state.lastAcceptedAt = acceptedAt;
  state.recentAccepted = [...state.recentAccepted, event].slice(-AWG_RECENT_EVENT_LIMIT);
  state.threads = state.threads.slice(-AWG_MAX_OPEN_THREADS * 3);
  return { state, accepted: true, event, changes, cyObserved: validation.cyObserved, cyObservation: validation.cyObservation };
}

export function awgEventToEnvironment(result) {
  if (!result || !result.accepted || !result.event) return null;
  const event = result.event;
  const observation = result.cyObservation;
  return {
    archetypeId: 'ambient_world_event',
    eventType: event.eventType,
    summary: result.cyObserved && observation ? clean(observation.summary, 800) : null,
    world: {
      participants: { actor: event.participants[0] || null, target: event.participants[1] || null, relationship_ref: null },
      context: {
        location: event.location,
        description: event.summary,
        associated_entities: [...event.participants],
        previous_event_ids: event.sourceThreadId ? [event.sourceThreadId] : [],
      },
      temporal: { onset: 'event', persistence: event.resolved ? 'completed' : 'ongoing', recurrence: 'unknown' },
      situation: { resolution_status: event.resolved ? 'resolved' : 'unresolved' },
    },
    observation: result.cyObserved && observation ? {
      modality: observation.access === 'CY_PARTIAL_HEARD' ? 'heard' : observation.access === 'CY_LEARNS_LATER' ? 'reported' : 'direct',
      certainty: observation.access === 'CY_PARTIAL_HEARD' ? 'uncertain' : 'certain',
      observed_facts: {
        event_family: event.eventFamily,
        information_claims: clone(event.informationClaims),
      },
    } : { modality: 'none', certainty: 'unknown', observed_facts: {} },
    publicTimeline: result.cyObserved && result.validationCandidate?.publicTimeline?.eligible
      ? clean(result.validationCandidate.publicTimeline.text, 800) : null,
  };
}

export async function runAmbientWorldCycle({
  state: stateValue,
  contextRendering,
  generate,
  nowMs = Date.now(),
  makeId,
  idleBudgetMs = AWG_MIN_IDLE_BUDGET_MS,
  pendingHigherPriority = false,
  memoryFormationBacklog = 0,
  inferenceBusy = false,
  clock = () => performance.now(),
} = {}) {
  const original = reconcileWorldSimulationState(stateValue);
  const eligibility = shouldRunAwg(original, {
    nowMs, idleBudgetMs, pendingHigherPriority, memoryFormationBacklog, inferenceBusy,
  });
  if (!eligibility.run) return { status: 'SKIPPED', reason: eligibility.reason, state: original, latencyMs: 0 };
  const started = clock();
  const ranAt = new Date(nowMs).toISOString();
  const runId = id((makeId || ((prefix) => `${prefix}:${nowMs}`))('awg-run'));
  const stateWithRun = clone(original);
  stateWithRun.lastRunAt = ranAt;
  let candidate = null;
  try {
    if (typeof generate !== 'function') throw new Error('PROVIDER_UNAVAILABLE');
    candidate = parseAwgCandidate(await generate(buildAwgCall(contextRendering)));
    const validationStarted = clock();
    const validation = validateAwgCandidate(candidate, stateWithRun, { nowMs });
    const validationLatencyMs = Math.max(0, clock() - validationStarted);
    if (!validation.valid) {
      const run = {
        runId, ranAt, candidateType: clean(candidate.decision).toUpperCase() || 'INVALID',
        candidateOutput: candidate, validationStatus: 'REJECTED', rejectionReason: validation.errors.join(', '),
        createdWorldEventIds: [], threadChanges: [], modelLatencyMs: Math.max(0, clock() - started - validationLatencyMs),
        validationLatencyMs,
      };
      stateWithRun.recentRuns = [...stateWithRun.recentRuns, run].slice(-AWG_RECENT_RUN_LIMIT);
      return { status: 'REJECTED', validation, run, state: stateWithRun, latencyMs: Math.max(0, clock() - started) };
    }
    if (validation.candidate.decision === 'NO_EVENT') {
      const run = {
        runId, ranAt, candidateType: 'NO_EVENT', candidateOutput: validation.candidate,
        validationStatus: 'ACCEPTED_NO_EVENT', rejectionReason: null, createdWorldEventIds: [], threadChanges: [],
        modelLatencyMs: Math.max(0, clock() - started - validationLatencyMs), validationLatencyMs,
      };
      stateWithRun.recentRuns = [...stateWithRun.recentRuns, run].slice(-AWG_RECENT_RUN_LIMIT);
      return { status: 'NO_EVENT', validation, run, state: stateWithRun, latencyMs: Math.max(0, clock() - started) };
    }
    const applied = applyAwgCandidate(stateWithRun, validation, { makeId, acceptedAt: ranAt });
    applied.validationCandidate = validation.candidate;
    const run = {
      runId, ranAt, candidateType: validation.candidate.decision, candidateOutput: validation.candidate,
      validationStatus: 'ACCEPTED', rejectionReason: null,
      createdWorldEventIds: [applied.event.id], threadChanges: applied.changes,
      modelLatencyMs: Math.max(0, clock() - started - validationLatencyMs), validationLatencyMs,
    };
    applied.state.recentRuns = [...applied.state.recentRuns, run].slice(-AWG_RECENT_RUN_LIMIT);
    return { status: 'ACCEPTED', validation, applied, run, state: applied.state, latencyMs: Math.max(0, clock() - started) };
  } catch (error) {
    const run = {
      runId, ranAt, candidateType: 'FAILED', candidateOutput: candidate,
      validationStatus: 'FAILED', rejectionReason: clean(error && error.message, 300),
      createdWorldEventIds: [], threadChanges: [], modelLatencyMs: Math.max(0, clock() - started), validationLatencyMs: 0,
    };
    stateWithRun.recentRuns = [...stateWithRun.recentRuns, run].slice(-AWG_RECENT_RUN_LIMIT);
    return { status: 'FAILED', error: run.rejectionReason, run, state: stateWithRun, latencyMs: Math.max(0, clock() - started) };
  }
}
