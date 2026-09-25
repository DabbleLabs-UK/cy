// ambient-world-generator.js - low-frequency structured prison-world proposals.
//
// The model is a narrative world-simulation content generator. It proposes one
// candidate only. Deterministic code validates continuity, privacy, knowledge and
// pacing before any proposal may become authoritative world state.

import { CAST, OFFICERS } from './cast.js';
import { cancellationReason, isInferenceCancellation } from './inference-cancellation.js';

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
// DELL commonly spends 75-115 seconds evaluating a 3072-token prompt before
// the first token. AWG may then need to produce and validate up to 420 tokens.
// Five minutes is a hard ceiling, not a cadence: shouldRunAwg still admits at
// most one attempt per 45-minute opportunity and higher-priority work aborts it.
export const AWG_TIMEOUT_MS = 300000;
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

const SEMANTIC_STOP_WORDS = new Set([
  'a', 'an', 'and', 'at', 'be', 'for', 'from', 'had', 'has', 'have', 'he', 'her',
  'him', 'his', 'in', 'is', 'it', 'its', 'of', 'on', 'or', 'she', 'that', 'the',
  'their', 'them', 'then', 'they', 'this', 'to', 'was', 'were', 'with',
]);

function semanticTokens(value) {
  const source = normaliseSummary(value)
    .replace(/\ball right\b|\bwell being\b|\bwellbeing\b/g, ' wellbeing ');
  return new Set(source.split(' ').filter(Boolean).map((token) => {
    if (/^(ask|asks|asked|asking)$/.test(token)) return 'ask';
    if (/^(wait|waits|waited|waiting)$/.test(token)) return 'wait';
    if (/^(pass|passes|passed|passing)$/.test(token)) return 'pass';
    if (/^(deliver|delivers|delivered|delivering|delivery)$/.test(token)) return 'deliver';
    if (/^(talk|talks|talked|talking|conversation|conversations)$/.test(token)) return 'conversation';
    const suffix = token.match(/(?:ing|ed|es|s)$/i);
    return suffix && token.length - suffix[0].length >= 4
      ? token.slice(0, -suffix[0].length) : token;
  }).filter((token) => token.length > 1 && !SEMANTIC_STOP_WORDS.has(token)));
}

function tokenOverlap(leftValue, rightValue) {
  const left = semanticTokens(leftValue);
  const right = semanticTokens(rightValue);
  if (!left.size || !right.size) return { shared: 0, coefficient: 0 };
  const shared = [...left].filter((token) => right.has(token)).length;
  return { shared, coefficient: shared / Math.min(left.size, right.size) };
}

const LOCATION_CUES = Object.freeze({
  cell: [/\b(?:in|inside|at|into) (?:cy'?s |the )?cell\b/i],
  landing: [/\b(?:on|at|along) the landing\b/i],
  wing: [/\b(?:on|at|along|down) the wing\b/i, /\bby the gate\b/i],
  association: [/\b(?:at|on|during) association\b/i, /\b(?:in|at) the queue\b/i],
  servery: [/\b(?:at|in|by) the servery\b/i],
  canteen: [/\b(?:at|in|by) the canteen\b/i],
  exercise_yard: [/\b(?:in|at|on) the (?:exercise )?yard\b/i],
  chapel: [/\b(?:in|at) the chapel\b/i],
  workshop: [/\b(?:in|at) the workshop\b/i],
  library: [/\b(?:in|at) the library\b/i],
  healthcare: [/\b(?:in|at) healthcare\b/i],
  visits: [/\b(?:in|at) visits\b/i],
  officer_desk: [/\b(?:in|at|by) the (?:officer'?s? )?desk\b/i],
  corridor: [/\b(?:in|at|along|down) the corridor\b/i],
});

function explicitLocationContradictions(candidate, authoritativeLocation) {
  const current = clean(authoritativeLocation);
  if (!current || !LOCATION_CUES[current]) return [];
  const learnsLater = (candidate.observations || []).some((observation) => (
    id(observation && observation.observerId) === 'cy'
      && clean(observation && observation.access).toUpperCase() === 'CY_LEARNS_LATER'
  ));
  if (learnsLater || clean(candidate.eventFamily).toUpperCase() === 'RUMOUR') return [];
  const texts = [candidate.objective && candidate.objective.summary]
    .concat((candidate.observations || []).map((observation) => observation && observation.summary))
    .map((value) => clean(value, 800)).filter(Boolean);
  const found = [];
  for (const [location, patterns] of Object.entries(LOCATION_CUES)) {
    if (location === current) continue;
    if (texts.some((text) => patterns.some((pattern) => pattern.test(text)))) found.push(location);
  }
  return found;
}

function threadSemanticallyMatches(candidate) {
  const threadType = clean(candidate.thread && candidate.thread.type);
  if (!threadType) return false;
  const eventMeaning = `${candidate.eventFamily || ''} ${candidate.objective && candidate.objective.eventType || ''} ${candidate.objective && candidate.objective.summary || ''}`;
  const ignored = new Set(['activity', 'event', 'request', 'thread']);
  const eventTokens = [...semanticTokens(eventMeaning)].filter((token) => !ignored.has(token));
  const threadTokens = semanticTokens(threadType);
  return eventTokens.some((token) => threadTokens.has(token));
}

function isRecentNearDuplicate(candidate, recentEvents, nowMs) {
  const participants = new Set((candidate.participants || []).map(id).filter(Boolean));
  const candidateText = candidate.objective && candidate.objective.summary;
  return (Array.isArray(recentEvents) ? recentEvents : []).some((event) => {
    const at = isoMs(event && (event.timestamp || event.occurredAt));
    if (at == null || nowMs - at < 0 || nowMs - at > AWG_DEDUPE_WINDOW_MS) return false;
    const recentParticipants = (event.participants || []).map(id).filter(Boolean);
    const participantOverlap = recentParticipants.some((participant) => participants.has(participant));
    const similarity = tokenOverlap(candidateText, event.summary || event.objective && event.objective.summary);
    return similarity.shared >= 4 && similarity.coefficient >= 0.66
      && (participantOverlap || recentParticipants.length === 0);
  });
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
  if (pendingHigherPriority || inferenceBusy) {
    return { run: false, reason: 'HIGHER_PRIORITY_WORK' };
  }
  if (idleBudgetMs < AWG_MIN_IDLE_BUDGET_MS) return { run: false, reason: 'INSUFFICIENT_IDLE_BUDGET' };
  const lastRun = isoMs(state.lastRunAt);
  if (lastRun != null && nowMs - lastRun < AWG_CADENCE_MS) return { run: false, reason: 'CADENCE' };
  if (candidateEventCountInWindow(state, nowMs) >= AWG_MAX_EVENTS_PER_WINDOW) {
    return { run: false, reason: 'EVENT_WINDOW_LIMIT' };
  }
  return {
    run: true,
    reason: memoryFormationBacklog > 0 ? 'ELIGIBLE_FAIRNESS_SLOT' : 'ELIGIBLE',
    priority: INFERENCE_PRIORITIES.AWG_BACKGROUND,
  };
}

export function isAwgDue(stateValue, nowMs = Date.now()) {
  const state = reconcileWorldSimulationState(stateValue);
  const lastRun = isoMs(state.lastRunAt);
  return lastRun == null || nowMs - lastRun >= AWG_CADENCE_MS;
}

function proposalCastIds(plausibleCastIds = []) {
  const supplied = [...new Set((plausibleCastIds || []).map(id).filter(Boolean))]
    .filter((castId) => KNOWN_CAST_IDS.has(castId));
  return [...new Set(['cy', ...supplied])].filter((castId) => castId !== 'cy:7734');
}

function nullableEnum(values) {
  return { enum: [null, ...values] };
}

function continuableAwgThreads(state, { allowedParticipantIds = [], nowMs = Date.now() } = {}) {
  const allowed = new Set((allowedParticipantIds || []).map(id).filter(Boolean));
  return state.threads.filter((thread) => {
    if (thread.state !== 'OPEN' || !id(thread.id) || !clean(thread.type)) return false;
    if (!Array.isArray(thread.sourceEventIds) || !thread.sourceEventIds.some((eventId) => id(eventId))) return false;
    const nextEligibleMs = isoMs(thread.nextEligibleAt);
    if (nextEligibleMs != null && nextEligibleMs > nowMs) return false;
    const participants = Array.isArray(thread.participants) ? thread.participants.map(id).filter(Boolean) : [];
    return !participants.length || participants.some((participant) => allowed.has(participant));
  });
}

function epistemicProposalBranches(proposal, otherCastIds) {
  const observed = clone(proposal);
  observed.properties.participants.contains = { const: 'cy' };
  observed.properties.observations.items = {
    type: 'object', additionalProperties: false,
    required: ['observerId', 'access', 'summary'],
    properties: {
      observerId: { const: 'cy' },
      access: {
        type: 'string',
        enum: ['CY_DIRECT', 'CY_PARTIAL_HEARD', 'CY_LEARNS_LATER'],
      },
      summary: { type: 'string', minLength: 1, maxLength: 800 },
    },
  };
  if (!otherCastIds.length) return [observed];
  const worldOnly = clone(proposal);
  worldOnly.properties.participants.items.enum = otherCastIds;
  worldOnly.properties.observations.items.oneOf = [
    proposal.properties.observations.items.oneOf[0],
    ...proposal.properties.observations.items.oneOf.slice(2),
  ];
  return [observed, worldOnly];
}

export function buildAwgProposalFormat(stateValue, {
  plausibleCastIds = [], nowMs = Date.now(),
} = {}) {
  const state = reconcileWorldSimulationState(stateValue);
  const castIds = proposalCastIds(plausibleCastIds);
  const otherCastIds = castIds.filter((castId) => castId !== 'cy');
  const objectIds = state.objects.map((object) => object.id);
  const objective = {
    type: 'object',
    additionalProperties: false,
    required: ['eventType', 'summary'],
    properties: {
      eventType: { type: 'string', pattern: '^[a-z][a-z0-9_]{1,63}$' },
      summary: { type: 'string', minLength: 1, maxLength: 800 },
    },
  };
  const eventProposal = {
    type: 'object',
    additionalProperties: false,
    required: [
      'decision', 'eventFamily', 'participants', 'objective', 'objects',
      'observations', 'informationClaims', 'thread',
    ],
    properties: {
      decision: { const: 'EVENT' },
      eventFamily: { type: 'string', enum: AWG_EVENT_FAMILIES },
      participants: {
        type: 'array', minItems: 1, maxItems: 6, uniqueItems: true,
        items: { type: 'string', enum: castIds },
      },
      objective,
      objects: {
        type: 'array', maxItems: 4,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'type', 'ownerId', 'holderId', 'status'],
          properties: {
            id: nullableEnum(objectIds),
            type: { type: 'string', enum: AWG_OBJECT_TYPES },
            ownerId: nullableEnum(castIds),
            holderId: nullableEnum(castIds),
            status: { type: 'string', enum: AWG_OBJECT_STATUSES },
          },
        },
      },
      observations: {
        type: 'array', minItems: 1, maxItems: 8,
        items: {
          oneOf: [
            {
              type: 'object', additionalProperties: false,
              required: ['observerId', 'access', 'summary'],
              properties: {
                observerId: { const: 'world' },
                access: { const: 'WORLD_ONLY' },
                summary: { type: 'string', minLength: 1, maxLength: 800 },
              },
            },
            {
              type: 'object', additionalProperties: false,
              required: ['observerId', 'access', 'summary'],
              properties: {
                observerId: { const: 'cy' },
                access: {
                  type: 'string',
                  enum: ['CY_DIRECT', 'CY_PARTIAL_HEARD', 'CY_LEARNS_LATER'],
                },
                summary: { type: 'string', minLength: 1, maxLength: 800 },
              },
            },
            ...(otherCastIds.length ? [{
              type: 'object', additionalProperties: false,
              required: ['observerId', 'access', 'summary'],
              properties: {
                observerId: { type: 'string', enum: otherCastIds },
                access: { const: 'CAST_ONLY' },
                summary: { type: 'string', minLength: 1, maxLength: 800 },
              },
            }] : []),
          ],
        },
      },
      informationClaims: {
        type: 'array', maxItems: 6,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['speakerId', 'content', 'truthStatus'],
          properties: {
            speakerId: { type: 'string', enum: castIds },
            content: { type: 'string', minLength: 1, maxLength: 800 },
            truthStatus: { type: 'string', enum: AWG_TRUTH_STATUS },
          },
        },
      },
      thread: {
        type: 'object',
        additionalProperties: false,
        required: ['action', 'id', 'summary'],
        properties: {
          action: { const: 'NONE' },
          id: { const: null },
          summary: { const: null },
        },
      },
    },
  };
  const eventBranches = epistemicProposalBranches(eventProposal, otherCastIds);
  if (state.threads.filter((thread) => thread.state === 'OPEN').length < AWG_MAX_OPEN_THREADS) {
    for (const eventFamily of AWG_EVENT_FAMILIES) {
      const openThreadProposal = clone(eventProposal);
      openThreadProposal.properties.eventFamily = { const: eventFamily };
      openThreadProposal.properties.thread.properties.action = { const: 'OPEN' };
      openThreadProposal.properties.thread.properties.summary = {
        type: 'string', minLength: 1, maxLength: 800,
      };
      eventBranches.push(...epistemicProposalBranches(openThreadProposal, otherCastIds));
    }
  }
  const continuationBranches = [];
  for (const thread of continuableAwgThreads(state, { allowedParticipantIds: castIds, nowMs })) {
    const continuation = clone(eventProposal);
    continuation.properties.decision = { const: 'CONTINUATION' };
    continuation.properties.thread.properties.action = { type: 'string', enum: ['UPDATE', 'RESOLVE'] };
    continuation.properties.thread.properties.id = { const: thread.id };
    continuation.properties.thread.properties.summary = {
      type: 'string', minLength: 1, maxLength: 800,
    };
    const threadParticipants = Array.isArray(thread.participants) ? thread.participants.map(id) : [];
    const branches = epistemicProposalBranches(continuation, otherCastIds);
    continuationBranches.push(...branches.filter((branch) => {
      const allowed = new Set(branch.properties.participants.items.enum || []);
      return !threadParticipants.length || threadParticipants.some((participant) => allowed.has(participant));
    }).map((branch) => {
      if (!threadParticipants.length) return branch;
      const allowed = new Set(branch.properties.participants.items.enum || []);
      const eligibleThreadParticipants = threadParticipants.filter((participant) => allowed.has(participant));
      const observed = branch.properties.observations.items.properties?.observerId?.const === 'cy';
      branch.properties.participants.items.enum = observed
        ? [...new Set(['cy', ...eligibleThreadParticipants])]
        : eligibleThreadParticipants;
      branch.properties.participants.minItems = observed && !eligibleThreadParticipants.includes('cy') ? 2 : 1;
      return branch;
    }));
  }
  return {
    oneOf: [
      {
        type: 'object', additionalProperties: false,
        required: ['decision'],
        properties: { decision: { const: 'NO_EVENT' } },
      },
      ...eventBranches,
      ...continuationBranches,
    ],
  };
}

export function buildAwgCall(contextRendering, {
  state = null, currentLocation = null, plausibleCastIds = [], recentEvents = [], nowMs = Date.now(),
} = {}) {
  const worldState = reconcileWorldSimulationState(state);
  const castIds = proposalCastIds(plausibleCastIds);
  const openThreads = continuableAwgThreads(worldState, { allowedParticipantIds: castIds, nowMs });
  const objectIds = worldState.objects.map((object) => object.id);
  const recent = [...worldState.recentAccepted, ...(Array.isArray(recentEvents) ? recentEvents : [])]
    .filter((event) => {
      const at = isoMs(event && (event.timestamp || event.occurredAt));
      return at != null && nowMs - at >= 0 && nowMs - at <= AWG_DEDUPE_WINDOW_MS;
    })
    .filter((event, index, all) => all.findIndex((item) => (
      id(item && item.id) && id(item.id) === id(event && event.id)
    ) || normaliseSummary(item && (item.summary || item.objective && item.objective.summary))
      === normaliseSummary(event && (event.summary || event.objective && event.objective.summary))) === index)
    .slice(-32);
  const recentConstraint = recent.length
    ? recent.map((event, index) => {
      const participants = Array.isArray(event.participants) && event.participants.length
        ? ` [${event.participants.map(id).filter(Boolean).join(',')}]` : '';
      return `${index + 1}. ${clean(event.summary || event.objective && event.objective.summary, 180)}${participants}`;
    }).join('\n')
    : 'none';
  const threadConstraint = openThreads.length
    ? openThreads.map((thread) => `${thread.id}: type=${thread.type}; participants=${(thread.participants || []).join(',') || 'unspecified'}; summary=${clean(thread.summary, 180)}`).join('\n')
    : 'none';
  const system = [
    'You are the Ambient World Generator for HMP ThinkPad.',
    'You are a narrative world-simulation content generator, not Cy, Soma, memory or a narrator.',
    'Propose exactly one structured candidate event, one continuation, or NO_EVENT.',
    'Select only from the supplied canonical IDs. New cast generation is disabled.',
    'Do not invent timestamps, locations, thread IDs, event IDs, object IDs, provenance or visibility flags.',
    'Use NOTE or MESSAGE as the canonical concept; do not force American prison slang.',
    'Do not assign emotions, Soma values, appraisal magnitudes or brain activation.',
    'A rumour claim is message content and must carry a truthStatus; it is not world truth.',
    'Return one JSON object only. Do not include reasoning or prose outside the object.',
  ].join('\n');
  return {
    system,
    prompt: [
      clean(contextRendering, 12000),
      '',
      'OUTPUT CONTRACT:',
      '- Labels such as [C1] and [C2] are context citations, never cast or observer IDs.',
      `- The event location is fixed by code as ${clean(currentLocation) || 'unknown'}; do not output a location.`,
      '- Code assigns the event timestamp and all new machine IDs; do not output them.',
      `- Allowed participant, observer and claim-speaker IDs: ${castIds.join(', ') || 'none'}.`,
      '- CONTINUABLE THREADS (the only legal continuation choices):',
      threadConstraint,
      `- Existing object IDs: ${objectIds.join(', ') || 'none'}. Use null to create a new object.`,
      '- RECENT EPISODES (do not repeat or paraphrase the same participants and core action):',
      recentConstraint,
      '- CONTINUATION is allowed only through one supplied thread branch; code supplies its authoritative type and event references.',
      '- For EVENT, use thread action NONE unless the event creates a concrete unresolved consequence that later events can continue.',
      '- Code derives resolved state from thread action and derives thread type from event family/current thread. Do not output either field.',
      '- Every EVENT or CONTINUATION needs at least one concrete observation stating who perceived what.',
      '- Choose one epistemic branch: OBSERVED uses only a cy/CY_* observation; WORLD_ONLY excludes cy from both participants and observations.',
      '- Use observerId world only with WORLD_ONLY; cy only with CY_*; other cast only with CAST_ONLY.',
      '- Include every acting, speaking or cast-observing person in participants.',
      '- If Cy participates directly, include a truthful CY_* observation; WORLD_ONLY means Cy did not participate or perceive it.',
      '- A new object owner and holder must be participants. A DELIVERED message needs actual content in informationClaims.',
      '- OPEN and UPDATE mean unresolved; RESOLVE means resolved.',
      `- The episode happens at ${clean(currentLocation) || 'the supplied location'}; do not describe it as happening in a different place.`,
      '- Do not repeat a near-identical recent episode merely with paraphrased wording.',
      '- Code derives public visibility from valid Cy observations; do not output visibility or timeline text.',
      '- eventType must be a lowercase snake_case machine label. objective.summary must state only what occurred.',
      '- If the supplied facts do not ground a valid event, return exactly {"decision":"NO_EVENT"}.',
      '- Return only JSON matching the enforced output schema.',
    ].join('\n'),
    format: buildAwgProposalFormat(worldState, { plausibleCastIds, nowMs }),
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

function assertProposalKeys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`INVALID_${label}`);
  }
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length) throw new Error(`FORBIDDEN_${label}_FIELD:${unexpected.join(',')}`);
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`INVALID_${label}`);
  return value;
}

export function materialiseAwgProposal(proposalValue, stateValue, {
  nowMs = Date.now(), currentLocation = null, plausibleCastIds = [], makeId,
} = {}) {
  const proposal = clone(proposalValue);
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) {
    throw new Error('INVALID_PROPOSAL');
  }
  const decision = clean(proposal.decision).toUpperCase();
  if (!['NO_EVENT', 'EVENT', 'CONTINUATION'].includes(decision)) throw new Error('INVALID_DECISION');
  if (decision === 'NO_EVENT') {
    assertProposalKeys(proposal, new Set(['decision']), 'PROPOSAL');
    return { schema: AWG_SCHEMA, version: AWG_SCHEMA_VERSION, decision };
  }
  assertProposalKeys(proposal, new Set([
    'decision', 'eventFamily', 'participants', 'objective', 'objects',
    'observations', 'informationClaims', 'thread',
  ]), 'PROPOSAL');
  if (!AWG_KNOWN_LOCATIONS.includes(clean(currentLocation))) throw new Error('UNKNOWN_LOCATION');
  const state = reconcileWorldSimulationState(stateValue);
  const allowedCast = new Set(proposalCastIds(plausibleCastIds));
  const participants = requireArray(proposal.participants, 'PARTICIPANTS').map(id);
  if (!participants.length || participants.some((castId) => !allowedCast.has(castId))) {
    throw new Error('UNKNOWN_CAST_ID');
  }
  if (!AWG_EVENT_FAMILIES.includes(clean(proposal.eventFamily).toUpperCase())) {
    throw new Error('INVALID_EVENT_FAMILY');
  }
  assertProposalKeys(proposal.objective, new Set(['eventType', 'summary']), 'OBJECTIVE');
  const eventType = clean(proposal.objective.eventType, 80);
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(eventType) || !clean(proposal.objective.summary)) {
    throw new Error('INVALID_OBJECTIVE');
  }
  const observations = requireArray(proposal.observations, 'OBSERVATIONS');
  if (!observations.length) throw new Error('OBSERVABILITY_REQUIRED');
  for (const observation of observations) {
    assertProposalKeys(observation, new Set(['observerId', 'access', 'summary']), 'OBSERVATION');
    const observerId = id(observation.observerId);
    if (observerId !== 'world' && !allowedCast.has(observerId)) throw new Error('UNKNOWN_OBSERVER');
  }
  const claims = requireArray(proposal.informationClaims, 'INFORMATION_CLAIMS');
  for (const claim of claims) {
    assertProposalKeys(claim, new Set(['speakerId', 'content', 'truthStatus']), 'INFORMATION_CLAIM');
    if (!allowedCast.has(id(claim.speakerId))) throw new Error('UNKNOWN_CLAIM_SPEAKER');
  }
  const objects = requireArray(proposal.objects, 'OBJECTS').map((object) => {
    assertProposalKeys(object, new Set(['id', 'type', 'ownerId', 'holderId', 'status']), 'OBJECT');
    const objectId = object.id == null ? null : id(object.id);
    if (objectId && !state.objects.some((entry) => entry.id === objectId)) {
      throw new Error('INVALID_OBJECT_REFERENCE');
    }
    return {
      id: objectId || id((makeId || ((prefix) => `${prefix}:${nowMs}`))('object')),
      type: clean(object.type).toLowerCase(),
      ownerId: object.ownerId == null ? null : id(object.ownerId),
      holderId: object.holderId == null ? null : id(object.holderId),
      location: clean(currentLocation),
      status: clean(object.status).toUpperCase(),
    };
  });
  assertProposalKeys(proposal.thread, new Set(['action', 'id', 'summary']), 'THREAD');
  const threadAction = clean(proposal.thread.action).toUpperCase();
  const threadId = proposal.thread.id == null ? null : id(proposal.thread.id);
  const openThread = threadId
    ? state.threads.find((thread) => thread.id === threadId && thread.state === 'OPEN') : null;
  if (decision === 'CONTINUATION') {
    if (!openThread || !['UPDATE', 'RESOLVE'].includes(threadAction)) {
      throw new Error('INVALID_THREAD_REFERENCE');
    }
  } else if (!['NONE', 'OPEN'].includes(threadAction) || threadId) {
    throw new Error('INVALID_THREAD_REFERENCE');
  }
  const cyObservation = observations.find((observation) => id(observation.observerId) === 'cy'
    && ['CY_DIRECT', 'CY_PARTIAL_HEARD', 'CY_LEARNS_LATER']
      .includes(clean(observation.access).toUpperCase()));
  const publicText = cyObservation ? `[${clean(cyObservation.summary, 796)}]` : null;
  const nextEligibleAt = ['OPEN', 'UPDATE'].includes(threadAction)
    ? new Date(nowMs + AWG_MIN_EVENT_SPACING_MS).toISOString() : null;
  return {
    schema: AWG_SCHEMA,
    version: AWG_SCHEMA_VERSION,
    decision,
    eventFamily: clean(proposal.eventFamily).toUpperCase(),
    participants,
    location: clean(currentLocation),
    occurredAt: new Date(nowMs).toISOString(),
    objective: { eventType, summary: clean(proposal.objective.summary, 800) },
    objects,
    observations: clone(observations),
    informationClaims: clone(claims),
    resolved: ['NONE', 'RESOLVE'].includes(threadAction),
    thread: {
      action: threadAction,
      id: threadId,
      type: openThread ? clean(openThread.type, 80)
        : threadAction === 'OPEN' ? clean(proposal.eventFamily).toUpperCase() : null,
      summary: proposal.thread.summary == null ? null : clean(proposal.thread.summary, 800),
      nextEligibleAt,
    },
    continuationOf: decision === 'CONTINUATION' ? {
      threadId: openThread.id,
      eventIds: [...(openThread.sourceEventIds || [])],
    } : null,
    publicTimeline: { eligible: !!publicText, text: publicText },
  };
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

function validateObject(object, state, errors, {
  participants = new Set(), claims = [], candidate = null,
} = {}) {
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
  if (!existing) {
    if (object.ownerId != null && !participants.has(id(object.ownerId))) {
      errors.push('OBJECT_OWNER_NOT_PARTICIPANT');
    }
    if (object.holderId != null && !participants.has(id(object.holderId))) {
      errors.push('OBJECT_HOLDER_NOT_PARTICIPANT');
    }
  } else {
    if (clean(existing.type).toLowerCase() !== clean(object.type).toLowerCase()) {
      errors.push('OBJECT_TYPE_CONTRADICTION');
    }
    if (id(existing.ownerId) !== id(object.ownerId)) errors.push('OBJECT_OWNER_CONTRADICTION');
    if (id(existing.holderId) !== id(object.holderId) && object.holderId != null
      && !participants.has(id(object.holderId))) {
      errors.push('OBJECT_HOLDER_NOT_PARTICIPANT');
    }
    const changedLocation = clean(existing.location) !== clean(object.location);
    const transferMeaning = /transfer|pass|deliver|hand|take|confiscat|find|bring|receive/i.test(
      `${candidate && candidate.eventFamily || ''} ${candidate && candidate.objective && candidate.objective.eventType || ''} ${candidate && candidate.objective && candidate.objective.summary || ''}`,
    );
    if (changedLocation && !transferMeaning) errors.push('OBJECT_LOCATION_CONTRADICTION');
  }
  if (clean(object.status).toUpperCase() === 'DELIVERED' && object.holderId == null) {
    errors.push('DELIVERED_OBJECT_HOLDER_REQUIRED');
  }
  if (clean(object.type).toLowerCase() === 'message'
    && clean(object.status).toUpperCase() === 'DELIVERED') {
    const hasCurrentContent = claims.some((claim) => clean(claim && claim.content));
    const referencesContent = candidate && candidate.decision === 'CONTINUATION'
      && Array.isArray(candidate.continuationOf && candidate.continuationOf.eventIds)
      && candidate.continuationOf.eventIds.some((eventId) => state.recentAccepted.some((event) => (
        event.id === eventId && Array.isArray(event.informationClaims)
          && event.informationClaims.some((claim) => clean(claim && claim.content))
      )));
    if (!hasCurrentContent && !referencesContent) errors.push('DELIVERED_MESSAGE_CONTENT_REQUIRED');
  }
  if (existing && existing.status === 'CONFISCATED' && clean(object.status).toUpperCase() === 'ACTIVE') {
    errors.push('OBJECT_STATE_CONTRADICTION');
  }
}

export function validateAwgCandidate(candidateValue, stateValue, {
  nowMs = Date.now(), currentLocation = null, plausibleCastIds = [], recentEvents = [],
} = {}) {
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
  const participantSet = new Set(participants);
  observations.forEach((observation) => {
    const observerId = id(observation && observation.observerId);
    const access = clean(observation && observation.access).toUpperCase();
    if (['cy', 'cy:7734'].includes(observerId)) {
      if (!['CY_DIRECT', 'CY_PARTIAL_HEARD', 'CY_LEARNS_LATER'].includes(access)) {
        errors.push('CY_OBSERVATION_ACCESS_MISMATCH');
      }
      if (!participantSet.has(observerId)) errors.push('OBSERVER_NOT_PARTICIPANT');
    } else if (observerId !== 'world') {
      if (access !== 'CAST_ONLY') errors.push('CAST_OBSERVATION_ACCESS_MISMATCH');
      if (!participantSet.has(observerId)) errors.push('OBSERVER_NOT_PARTICIPANT');
    }
  });

  const claims = Array.isArray(candidate.informationClaims) ? candidate.informationClaims : [];
  claims.forEach((claim) => {
    const speakerId = id(claim && claim.speakerId);
    if (!KNOWN_CAST_IDS.has(speakerId)) errors.push('UNKNOWN_CLAIM_SPEAKER');
    else if (!participantSet.has(speakerId)) errors.push('SPEAKER_NOT_PARTICIPANT');
    if (!clean(claim && claim.content)) errors.push('EMPTY_INFORMATION_CLAIM');
    if (!AWG_TRUTH_STATUS.includes(clean(claim && claim.truthStatus).toUpperCase())) errors.push('INVALID_TRUTH_STATUS');
  });
  if (clean(candidate.eventFamily).toUpperCase() === 'RUMOUR' && !claims.length) errors.push('RUMOUR_CLAIM_REQUIRED');

  const threadAction = clean(candidate.thread && candidate.thread.action).toUpperCase() || 'NONE';
  const continuationThreadId = id(candidate.continuationOf && candidate.continuationOf.threadId);
  if (decision === 'CONTINUATION') {
    const thread = state.threads.find((item) => item.id === continuationThreadId && item.state === 'OPEN');
    if (!thread) errors.push('INVALID_THREAD_REFERENCE');
    if (id(candidate.thread && candidate.thread.id) !== continuationThreadId) {
      errors.push('CONTINUATION_THREAD_MISMATCH');
    }
    if (thread && clean(candidate.thread && candidate.thread.type)
      && clean(candidate.thread.type).toLowerCase() !== clean(thread.type).toLowerCase()) {
      errors.push('THREAD_TYPE_CONTRADICTION');
    }
    const refs = Array.isArray(candidate.continuationOf && candidate.continuationOf.eventIds)
      ? candidate.continuationOf.eventIds.map(id) : [];
    const threadEventIds = new Set(thread && Array.isArray(thread.sourceEventIds) ? thread.sourceEventIds : []);
    if (!refs.length || refs.some((ref) => !threadEventIds.has(ref))) errors.push('INVALID_EVENT_REFERENCE');
    if (thread && Array.isArray(thread.participants) && thread.participants.length
      && !thread.participants.some((participant) => participantSet.has(id(participant)))) {
      errors.push('THREAD_PARTICIPANT_MISMATCH');
    }
  }
  if (['UPDATE', 'RESOLVE'].includes(threadAction)) {
    const threadId = id(candidate.thread && candidate.thread.id);
    if (!state.threads.some((item) => item.id === threadId && item.state === 'OPEN')) errors.push('INVALID_THREAD_REFERENCE');
  }
  if (threadAction === 'OPEN' && candidate.resolved === true) errors.push('RESOLVED_EVENT_OPENS_THREAD');
  if (threadAction === 'UPDATE' && candidate.resolved === true) errors.push('RESOLVED_EVENT_LEAVES_THREAD_OPEN');
  if (threadAction === 'RESOLVE' && candidate.resolved !== true) errors.push('THREAD_RESOLUTION_STATE_MISMATCH');
  if (threadAction === 'OPEN' && !threadSemanticallyMatches(candidate)) errors.push('THREAD_TYPE_CONTRADICTION');
  if (threadAction === 'OPEN' && state.threads.filter((item) => item.state === 'OPEN').length >= AWG_MAX_OPEN_THREADS) {
    errors.push('OPEN_THREAD_LIMIT');
  }

  const objects = Array.isArray(candidate.objects) ? candidate.objects : [];
  objects.forEach((object) => validateObject(object, state, errors, {
    participants: participantSet, claims, candidate,
  }));
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
  if (isRecentNearDuplicate(candidate, recentEvents, nowMs)) errors.push('RECENT_NEAR_DUPLICATE');

  const cyObservation = observations.find((observation) => id(observation.observerId) === 'cy'
    || id(observation.observerId) === 'cy:7734');
  const cyAccess = cyObservation ? clean(cyObservation.access).toUpperCase() : null;
  const cyObserved = ['CY_DIRECT', 'CY_PARTIAL_HEARD', 'CY_LEARNS_LATER'].includes(cyAccess);
  if (!cyObserved && participants.some((participant) => ['cy', 'cy:7734'].includes(participant))) {
    errors.push('CY_PARTICIPANT_WITHOUT_OBSERVATION');
  }
  const current = clean(currentLocation);
  if (cyObserved && current && clean(candidate.location) !== current && cyAccess !== 'CY_LEARNS_LATER') {
    errors.push('IMPOSSIBLE_CY_LOCATION');
  }
  const plausible = new Set((plausibleCastIds || []).map(id).filter(Boolean));
  if (cyObserved && plausible.size && participants
    .filter((participant) => !['cy', 'cy:7734'].includes(participant))
    .some((participant) => !plausible.has(participant))) {
    errors.push('IMPOSSIBLE_CAST_AT_LOCATION');
  }
  const objectiveType = clean(candidate.objective && candidate.objective.eventType).toLowerCase();
  if (current === 'exercise_yard' && cyObserved
    && /journal|drawing|draw|sleep|cell_search/.test(objectiveType)) {
    errors.push('IMPOSSIBLE_ACTIVITY_AT_LOCATION');
  }
  if (explicitLocationContradictions(candidate, candidate.location).length) {
    errors.push('OBJECTIVE_LOCATION_CONTRADICTION');
  }
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
  currentLocation = null,
  plausibleCastIds = [],
  recentEvents = [],
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
  let proposal = null;
  try {
    if (typeof generate !== 'function') throw new Error('PROVIDER_UNAVAILABLE');
    const call = buildAwgCall(contextRendering, {
      state: stateWithRun, currentLocation, plausibleCastIds, recentEvents, nowMs,
    });
    proposal = parseAwgCandidate(await generate(call));
    candidate = materialiseAwgProposal(proposal, stateWithRun, {
      nowMs, currentLocation, plausibleCastIds, makeId,
    });
    const validationStarted = clock();
    const validation = validateAwgCandidate(candidate, stateWithRun, {
      nowMs, currentLocation, plausibleCastIds, recentEvents,
    });
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
    const cancelled = isInferenceCancellation(error);
    const abortReason = cancelled ? cancellationReason(error) : null;
    const run = {
      runId, ranAt, candidateType: cancelled ? 'CANCELLED' : 'FAILED', candidateOutput: candidate || proposal,
      validationStatus: cancelled ? 'NOT_RUN' : 'FAILED',
      rejectionReason: cancelled ? `ABORTED/${abortReason}` : clean(error && error.message, 300),
      createdWorldEventIds: [], threadChanges: [], modelLatencyMs: Math.max(0, clock() - started), validationLatencyMs: 0,
    };
    stateWithRun.recentRuns = [...stateWithRun.recentRuns, run].slice(-AWG_RECENT_RUN_LIMIT);
    return {
      status: cancelled ? 'CANCELLED' : 'FAILED',
      error: run.rejectionReason,
      run,
      state: stateWithRun,
      latencyMs: Math.max(0, clock() - started),
    };
  }
}
