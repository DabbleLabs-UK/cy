// REHEARSAL ONLY. No provider, network, state writer or production import of this module.
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { performance } from 'node:perf_hooks';
import {
  AWG_EVENT_FAMILIES, AWG_TIMEOUT_MS, buildAwgCall, materialiseAwgProposal,
  parseAwgCandidate, selectAwgGenerationFacts, validateAwgCandidate,
} from '../../runner/ambient-world-generator.js';
import { CAST, OFFICERS } from '../../runner/cast.js';
import { locationContextId } from '../../runner/location-regime.js';
import { isAllowedMessageTransition, normaliseMessageState } from '../../runner/message-object-lifecycle.js';

export const LIMITS = Object.freeze({ actors: 15, objects: 8, threads: 8, facts: 12,
  recentMs: 6 * 60 * 60 * 1000, text: 300, packetBytes: 24000 });
const names = new Map([['cy', { name: 'Cy', role: 'INMATE' }],
  ...CAST.map(item => [item.key, { name: item.name, role: 'INMATE' }]),
  ...OFFICERS.map(item => [item.key, { name: item.name, role: 'OFFICER' }])]);
const clone = value => structuredClone(value);
export const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const unique = values => [...new Set(values)];
const ref = (kind, id) => `${kind}:${id}`;
function requireThat(test, reason) { if (!test) throw new Error(reason); }
function strictKeys(value, keys, label) {
  requireThat(value && typeof value === 'object' && !Array.isArray(value), `INVALID_${label}`);
  requireThat(isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort()), `INVALID_${label}_FIELDS`);
}
function boundedText(value, label) {
  requireThat(typeof value === 'string' && value.trim() === value && value.length > 0
    && value.length <= LIMITS.text, `INVALID_${label}`);
}
function londonParts(ms) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map(p => [p.type, p.value]));
}
// Legacy environment timestamps are London wall time, not UTC or this PC's timezone.
// Try both UK offsets; ambiguous/nonexistent DST wall times are not positive evidence.
export function worldTimeMs(value) {
  if (typeof value !== 'string') return null;
  if (/T.*(?:Z|[+-]\d\d:\d\d)$/.test(value)) {
    const ms = Date.parse(value); return Number.isFinite(ms) ? ms : null;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(value);
  if (!m) return null;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +(m[7] || '').padEnd(3, '0'));
  const candidates = [wall, wall - 3600000].filter(ms => {
    const p = londonParts(ms);
    return [p.year, p.month, p.day, p.hour, p.minute, p.second].join('-') === m.slice(1, 7).join('-');
  });
  return candidates.length === 1 ? candidates[0] : null;
}
function productionContext(capture, nowMs) {
  requireThat(Number.isSafeInteger(nowMs), 'EXPLICIT_FROZEN_NOW_REQUIRED');
  requireThat(locationContextId(capture.locationRegime?.current?.id) === capture.currentLocation,
    'CAPTURE_LOCATION_DISAGREEMENT');
  return { nowMs, currentLocation: capture.currentLocation,
    plausibleCastIds: capture.plausibleCastIds || [], recentEvents: capture.recentWorldHistory || [] };
}
function positiveFact(event, nowMs) {
  const ms = worldTimeMs(event.timestamp || event.occurredAt);
  const family = String(event.eventFamily || '').toUpperCase();
  const publicWorldFamilies = ['CUSTODY', 'SOCIAL', 'HOMEOSTASIS', ...AWG_EVENT_FAMILIES];
  if (!event.id || !publicWorldFamilies.includes(family) || ms == null || ms > nowMs
    || nowMs - ms > LIMITS.recentMs || typeof event.summary !== 'string' || event.summary.length > 800
    || (event.privacyScope && event.privacyScope !== 'WORLD_SIMULATION')
    || event.subjectVisitorId || event.senderId || event.visitorId) return null;
  return { ref: ref('event', event.id), sourceId: event.id,
    recordedAt: event.timestamp || event.occurredAt, atMs: ms, location: event.location || null,
    participants: unique((event.participants || []).filter(id => names.has(id))),
    cyObserved: event.cyObserved === true, eventType: event.eventType || null,
    summary: event.summary, temporalScope: 'HISTORICAL_NOT_ONGOING_OR_COPRESENCE' };
}

export function buildAffordancePacket(capture, { nowMs } = {}) {
  const context = productionContext(capture, nowMs);
  const facts = selectAwgGenerationFacts(capture.worldSimulation, context);
  const eligible = facts.participantIds;
  requireThat(eligible.length <= LIMITS.actors, 'ACTOR_BOUND_EXCEEDED');
  const actors = eligible.map(id => ({ ref: ref('actor', id), id, ...names.get(id),
    eligibility: id === 'cy' ? 'CURRENT_SELF' : 'PRODUCTION_PLAUSIBLE_NOT_CONFIRMED_PRESENT' }));
  const officerIds = actors.filter(a => a.role === 'OFFICER').map(a => a.id);
  const objects = facts.objects.slice(0, LIMITS.objects).map(item => {
    const message = normaliseMessageState(item.message);
    const transitions = item.type === 'message'
      ? ['DELIVER', 'READ', 'RESOLVE', 'RETIRE'].filter(action => message && isAllowedMessageTransition(message, action))
        .map(action => ({ action, holderIds: action === 'RETIRE' ? unique([item.holderId].filter(Boolean))
          : eligible.includes(message.recipientId) ? [message.recipientId] : [] }))
        .filter(transition => transition.holderIds.length)
      : [{ action: 'TRANSFER', holderIds: eligible.filter(id => id !== item.holderId) },
        { action: 'CONFISCATE', holderIds: officerIds }].filter(transition => transition.holderIds.length);
    return { ref: ref('object', item.id), id: item.id, type: item.type, status: item.status,
      location: item.location, ownerId: item.ownerId, holderId: item.holderId,
      message: message ? { lifecycleState: message.lifecycleState, senderId: message.senderId,
        recipientId: message.recipientId, readState: message.readState } : null,
      transitions, transitionSemantics: 'POSSIBLE_NOT_SELECTED_OR_OCCURRED' };
  });
  const threads = facts.threads.slice(0, LIMITS.threads).map(item => ({ ref: ref('thread', item.id),
    id: item.id, type: item.type, summary: String(item.summary || '').slice(0, 800),
    participants: clone(item.participants || []), sourceEventIds: clone(item.sourceEventIds || []),
    nextEligibleAt: item.nextEligibleAt || null, transitions: ['UPDATE', 'RESOLVE'] }));
  const recentFacts = unique((capture.recentWorldHistory || []).map(e => e.id)).map(id => (
    positiveFact(capture.recentWorldHistory.find(e => e.id === id), nowMs)
  )).filter(Boolean).sort((a, b) => a.atMs - b.atMs || a.sourceId.localeCompare(b.sourceId)).slice(-LIMITS.facts);
  const activeEpisodes = [capture.locationRegime.activeRoutineEpisode, capture.locationRegime.activeExerciseEpisode,
    capture.locationRegime.searchEpisode].filter(e => e && ['ACTIVE', 'IN_PROGRESS'].includes(e.status));
  const interactionOpportunities = activeEpisodes.map(e => ({ ref: ref('episode', e.id), id: e.id,
    status: e.status, stage: e.stage || null, actorId: names.has(e.actor_id) ? e.actor_id : null,
    sourceEventIds: clone(e.linked_event_ids || e.event_ids || []),
    basis: 'EXISTING_ACTIVE_EPISODE_NOT_A_GENERATED_INCIDENT' }));
  const regimeItem = (capture.contextInspection?.packet?.sections || [])
    .find(section => section.id === 'mandatory_current_state')?.items?.find(item => (
      item.provenanceClass === 'WORLD FACT' && item.knowledgeScope === 'WORLD_KNOWS'
      && item.privacyScope === 'WORLD_SIMULATION' && typeof item.content === 'string'
    ));
  const clock = londonParts(nowMs);
  const packet = { schema: 'cy.rehearsal.affordances.v1', nowMs,
    inputFingerprint: fingerprint(capture),
    current: { ref: 'state:current', location: capture.currentLocation, locationId: capture.locationRegime.current.id,
      activity: capture.locationRegime.current.regime_activity || null,
      enteredAt: capture.locationRegime.current.entered_at || null,
      sourceEventId: capture.locationRegime.current.source_event_id || null,
      londonClock: `${clock.hour}:${clock.minute}:${clock.second}`,
      regimeSourceId: regimeItem?.sourceId || null, regimeText: regimeItem?.content || null },
    actors, objects, threads, recentFacts, interactionOpportunities,
    observationChannels: [
      { ref: 'channel:cy-direct', observerId: 'cy', access: 'CY_DIRECT',
        condition: 'Cy participates at the fixed location; other actors are only plausible, not asserted present.' },
      { ref: 'channel:cy-heard', observerId: 'cy', access: 'CY_PARTIAL_HEARD',
        condition: 'Cy participates at the fixed location; hearing does not establish unseen identities or private content.' },
      { ref: 'channel:world', observerId: 'world', access: 'WORLD_ONLY',
        condition: 'Cy is absent from participants and does not acquire knowledge.' },
    ],
    bounds: { ...LIMITS, omittedObjects: Math.max(0, facts.objects.length - LIMITS.objects),
      omittedThreads: Math.max(0, facts.threads.length - LIMITS.threads) },
    interpretation: {
      rosterIsPresenceEvidence: false, pastEventsAreOngoing: false, characterBlurbsIncluded: false,
      newObjectsOrThreadsSupported: false,
      note: 'No incident menu. Actor eligibility and observation channels are possibility constraints, not events or proof of a particular action. NO_EVENT is always legitimate.',
    } };
  requireThat(Buffer.byteLength(JSON.stringify(packet)) <= LIMITS.packetBytes, 'PACKET_BOUND_EXCEEDED');
  return packet;
}

const objectSchema = properties => ({ type: 'object', additionalProperties: false,
  required: Object.keys(properties), properties });
export function selectionSchema(packet) {
  const actorIds = packet.actors.map(a => a.id);
  const targetIds = unique([...actorIds, ...packet.objects.map(o => o.id), ...packet.threads.map(t => t.id)]);
  const sourceIds = packetRefs(packet);
  return { oneOf: [objectSchema({ decision: { const: 'NO_EVENT' } }), objectSchema({
    decision: { const: 'OCCURRENCE' },
    actors: { type: 'array', minItems: 1, maxItems: 6, uniqueItems: true, items: { enum: actorIds } },
    occurrence: objectSchema({ eventType: { type: 'string', pattern: '^[a-z][a-z0-9_]{1,63}$' },
      summary: { type: 'string', minLength: 1, maxLength: LIMITS.text } }),
    target: { oneOf: [{ type: 'null' }, objectSchema({ kind: { enum: ['ACTOR', 'OBJECT', 'THREAD'] },
      id: { enum: targetIds }, transition: { enum: [null, 'TRANSFER', 'CONFISCATE', 'DELIVER', 'READ', 'RESOLVE', 'RETIRE', 'UPDATE'] },
      holderId: { enum: [null, ...actorIds] } })] },
    observation: objectSchema({ observerId: { enum: ['cy', 'world'] },
      access: { enum: packet.observationChannels.map(c => c.access) },
      summary: { type: 'string', minLength: 1, maxLength: LIMITS.text } }),
    sourceRefs: { type: 'array', minItems: 2, maxItems: 12, uniqueItems: true, items: { enum: sourceIds } },
  })] };
}
function packetRefs(packet) {
  return [packet.current.ref, ...['actors', 'objects', 'threads', 'recentFacts', 'interactionOpportunities',
    'observationChannels'].flatMap(key => packet[key].map(item => item.ref))];
}
function stage1Request(capture, packet) {
  return { model: capture.model, system: 'REHEARSAL ONLY. Select one concrete plausible new occurrence from supplied world affordances, or NO_EVENT. Return only JSON. Do not choose an event family.',
    prompt: [
      'The packet is mechanically extracted state, not an incident menu. Select at most one small plausible occurrence; conversation and non-conversational activity are both legitimate. Do not force drama, persistence, novelty or a minimum output rate.',
      'Eligibility is not current presence. Historical observations are not ongoing incidents. Do not invent past conduct, motives, unseen identities, unavailable property or character-metaphor actions. Do not complete missing words/numbers in recorded facts.',
      'Describe exactly one concrete observable action in occurrence and how it can be known in observation. No hidden side actions. Use only supplied actor/entity/reference IDs and the fixed current location. Include state:current, every actor/target reference and the selected channel reference in sourceRefs.',
      'Targets may reference only existing supplied entities; use null when none. Object/thread transitions must be listed on that entity. The prototype does not create new objects or threads. Return NO_EVENT if no grounded occurrence is supported.',
      JSON.stringify(packet),
    ].join('\n\n'), format: selectionSchema(packet), options: clone(capture.postBody.options) };
}

// This mechanical encoder adds no scene, actor, dialogue, interpretation or state effect.
function proposalForSelection(capture, packet, sketch, family) {
  const target = sketch.target;
  const objects = [];
  const informationClaims = [];
  let thread = { action: 'NONE', id: null, summary: null };
  if (target?.kind === 'OBJECT') {
    const source = capture.worldSimulation.objects.find(o => o.id === target.id);
    let messageAction = null;
    let status = source.status;
    if (source.type === 'message') {
      const m = normaliseMessageState(source.message);
      messageAction = { action: target.transition, senderId: m.senderId, recipientId: m.recipientId, contentClaimIndex: null };
      if (target.transition === 'DELIVER') {
        requireThat(typeof m.content === 'string' && m.content.length > 0, 'MESSAGE_CONTENT_UNAVAILABLE');
        informationClaims.push({ speakerId: m.senderId, content: m.content, truthStatus: m.contentTruthStatus });
        messageAction.contentClaimIndex = 0;
      }
      status = null;
    } else if (target.transition === 'CONFISCATE') status = 'CONFISCATED';
    objects.push({ id: source.id, type: source.type, ownerId: source.ownerId,
      holderId: target.holderId, status, messageAction });
  } else if (target?.kind === 'THREAD') {
    thread = { action: target.transition, id: target.id, summary: sketch.occurrence.summary };
  }
  return { decision: target?.kind === 'THREAD' ? 'CONTINUATION' : 'EVENT', eventFamily: family,
    participants: clone(sketch.actors), objective: clone(sketch.occurrence), objects,
    observations: [clone(sketch.observation)], informationClaims, thread };
}

export function checkSelection(capture, packet, sketch, { nowMs } = {}) {
  const started = performance.now();
  const errors = [];
  let checked = null;
  try {
    requireThat(isDeepStrictEqual(buildAffordancePacket(capture, { nowMs }), packet), 'STALE_OR_TAMPERED_PACKET');
    if (sketch?.decision === 'NO_EVENT') {
      strictKeys(sketch, ['decision'], 'SELECTION');
      return { valid: true, decision: 'NO_EVENT', errors, checkMs: performance.now() - started };
    }
    strictKeys(sketch, ['decision', 'actors', 'occurrence', 'target', 'observation', 'sourceRefs'], 'SELECTION');
    requireThat(sketch.decision === 'OCCURRENCE', 'INVALID_DECISION');
    requireThat(Array.isArray(sketch.actors) && sketch.actors.length >= 1 && sketch.actors.length <= 6
      && unique(sketch.actors).length === sketch.actors.length
      && sketch.actors.every(id => packet.actors.some(a => a.id === id)), 'UNAVAILABLE_ACTOR');
    strictKeys(sketch.occurrence, ['eventType', 'summary'], 'OCCURRENCE');
    requireThat(/^[a-z][a-z0-9_]{1,63}$/.test(sketch.occurrence.eventType), 'INVALID_EVENT_TYPE');
    boundedText(sketch.occurrence.summary, 'OCCURRENCE_TEXT');
    strictKeys(sketch.observation, ['observerId', 'access', 'summary'], 'OBSERVATION');
    boundedText(sketch.observation.summary, 'OBSERVATION_TEXT');
    const channel = packet.observationChannels.find(c => c.observerId === sketch.observation.observerId
      && c.access === sketch.observation.access);
    requireThat(channel, 'UNSUPPORTED_OBSERVATION_CHANNEL');
    requireThat((channel.observerId === 'cy') === sketch.actors.includes('cy'), 'OBSERVATION_PARTICIPATION_MISMATCH');
    const neededRefs = [packet.current.ref, channel.ref, ...sketch.actors.map(id => ref('actor', id))];
    if (sketch.target != null) {
      strictKeys(sketch.target, ['kind', 'id', 'transition', 'holderId'], 'TARGET');
      const t = sketch.target;
      if (t.kind === 'ACTOR') {
        requireThat(sketch.actors.includes(t.id) && t.transition === null && t.holderId === null, 'UNAVAILABLE_TARGET_ACTOR');
        neededRefs.push(ref('actor', t.id));
      } else if (t.kind === 'OBJECT') {
        const object = packet.objects.find(o => o.id === t.id);
        requireThat(object, 'UNAVAILABLE_OBJECT');
        requireThat(object.location === packet.current.location, 'IMPOSSIBLE_OBJECT_LOCATION');
        requireThat(object.transitions.some(x => x.action === t.transition && x.holderIds.includes(t.holderId)),
          'UNSUPPORTED_OBJECT_TRANSITION');
        requireThat(sketch.actors.includes(t.holderId), 'HOLDER_NOT_PARTICIPANT');
        neededRefs.push(object.ref);
      } else if (t.kind === 'THREAD') {
        const thread = packet.threads.find(item => item.id === t.id);
        requireThat(thread && thread.transitions.includes(t.transition) && t.holderId === null, 'UNAVAILABLE_THREAD_TRANSITION');
        requireThat(!thread.participants.length || thread.participants.some(id => sketch.actors.includes(id)), 'THREAD_PARTICIPANT_MISMATCH');
        neededRefs.push(thread.ref);
      } else throw new Error('INVALID_TARGET_KIND');
    }
    const refs = sketch.sourceRefs;
    requireThat(Array.isArray(refs) && refs.length <= 12 && unique(refs).length === refs.length
      && refs.every(id => packetRefs(packet).includes(id)) && unique(neededRefs).every(id => refs.includes(id)), 'INVALID_SOURCE_REFS');
    // Family-independent location/participant checks must not be evaded by choosing RUMOUR.
    const context = productionContext(capture, nowMs);
    const preflight = proposalForSelection(capture, packet, sketch, 'WING_ACTIVITY');
    const preflightCandidate = materialiseAwgProposal(preflight, capture.worldSimulation, context);
    const preflightResult = validateAwgCandidate(preflightCandidate, capture.worldSimulation, context);
    const groundingErrors = preflightResult.errors.filter(e => !['THREAD_TYPE_CONTRADICTION'].includes(e));
    requireThat(!groundingErrors.length, `PRODUCTION_PRECONDITION:${groundingErrors.join(',')}`);
    // Discover compatible downstream encodings, never ask stage 1 to select a family.
    const threadType = sketch.target?.kind === 'THREAD' ? packet.threads.find(t => t.id === sketch.target.id).type : null;
    const encodings = (threadType ? [threadType] : AWG_EVENT_FAMILIES).filter(family => {
      const p = proposalForSelection(capture, packet, sketch, family);
      return validateAwgCandidate(materialiseAwgProposal(p, capture.worldSimulation, context),
        capture.worldSimulation, context).valid;
    });
    requireThat(encodings.length, 'NO_VALID_PRODUCTION_ENCODING');
    checked = { sketch: clone(sketch), sketchFingerprint: fingerprint(sketch),
      packetFingerprint: fingerprint(packet), captureFingerprint: fingerprint(capture),
      nowMs, sourceRefs: clone(refs), compatibleFamilies: encodings,
      _scope: 'Mechanical possibility/continuity checks, not proof that a novel proposed occurrence is true or worthwhile.' };
  } catch (error) { errors.push(error.message); }
  return { valid: errors.length === 0, decision: errors.length ? 'REJECTED' : 'OCCURRENCE',
    errors, checked, checkMs: performance.now() - started };
}

export function buildStage2Request(capture, packet, selection, { nowMs } = {}) {
  // Never trust a caller-supplied successful verdict or an edited checked sketch.
  requireThat(selection?.valid && selection.decision === 'OCCURRENCE', 'SELECTION_NOT_CHECKED');
  requireThat(selection.checked.captureFingerprint === fingerprint(capture)
    && selection.checked.packetFingerprint === fingerprint(packet)
    && selection.checked.sketchFingerprint === fingerprint(selection.checked.sketch), 'STALE_SELECTION');
  const again = checkSelection(capture, packet, selection.checked.sketch, { nowMs });
  requireThat(again.valid, `PRECONDITION_RECHECK_FAILED:${again.errors.join(',')}`);
  const sketch = again.checked.sketch;
  const template = proposalForSelection(capture, packet, sketch, again.checked.compatibleFamilies[0]);
  const properties = Object.fromEntries(Object.entries(template).map(([key, value]) => [key,
    key === 'eventFamily' ? { enum: again.checked.compatibleFamilies } : { const: clone(value) }]));
  return { ...clone(capture.postBody),
    prompt: `${capture.postBody.prompt}\n\nCHECKED OCCURRENCE - REHEARSAL ONLY:\n${JSON.stringify(sketch)}\nRealise this exact checked occurrence in the canonical proposal shape. All scene/action/actor/observation/effect fields are bound. Choose only the appropriate downstream eventFamily encoding. Do not add dialogue, another action, an actor, property or a thread. The fixed text is intentional; it is not a request to elaborate.`,
    format: objectSchema(properties) };
}

export function evaluateStage2(capture, packet, selection, raw, { nowMs } = {}) {
  const started = performance.now();
  let proposal = null;
  let validation = null;
  let fidelity = { valid: false, classification: 'UNASSESSED', errors: [] };
  try {
    const request = buildStage2Request(capture, packet, selection, { nowMs });
    // Use the real production parser, without stripping, relabelling or repairing anything.
    proposal = parseAwgCandidate(raw);
    const expected = proposalForSelection(capture, packet, selection.checked.sketch, proposal.eventFamily);
    requireThat(request.format.properties.eventFamily.enum.includes(proposal.eventFamily), 'INCOMPATIBLE_FAMILY');
    requireThat(isDeepStrictEqual(proposal, expected), 'REALISATION_DRIFT');
    fidelity = { valid: true, classification: 'EXACT_SKETCH_BINDING', errors: [],
      scope: 'All realised fields except downstream family exactly match the sketch/encoder; the sketch itself still needs human semantic/grounding review.' };
    const context = productionContext(capture, nowMs);
    const candidate = materialiseAwgProposal(proposal, capture.worldSimulation, context);
    validation = validateAwgCandidate(candidate, capture.worldSimulation, context);
  } catch (error) { fidelity = { valid: false, classification: 'REJECTED', errors: [error.message] }; }
  return { raw, proposal, fidelity, productionValidation: validation,
    evaluationMs: performance.now() - started, applied: false };
}

export function preparePrototype(capture, { nowMs, selectionRaw = null, proposalRaw = null,
  measuredInferenceMs = { stage1: null, stage2: null } } = {}) {
  const before = fingerprint(capture);
  const started = performance.now();
  const packet = buildAffordancePacket(capture, { nowMs });
  const request1 = stage1Request(capture, packet);
  const trace = { schema: 'cy.rehearsal.grounded-occurrence.v1', nowMs, inferenceExecuted: false,
    inputFingerprint: before, selectionRaw, selection: null, sourceRefsUsed: [], precondition: null,
    stage2: null, status: 'PREPARED_ONLY',
    latency: { stage1PreparationMs: performance.now() - started, stage1InferenceMs: measuredInferenceMs.stage1,
      stage2PreparationMs: null, stage2InferenceMs: measuredInferenceMs.stage2 },
    _note: 'Inference timings are null unless supplied from an actual future authorised harness. Preparation time is not inference latency.' };
  let request2 = null;
  if (selectionRaw != null) {
    try {
      trace.selection = JSON.parse(selectionRaw);
      trace.sourceRefsUsed = trace.selection.sourceRefs || [];
      trace.precondition = checkSelection(capture, packet, trace.selection, { nowMs });
      trace.status = !trace.precondition.valid ? 'PRECONDITION_REJECTED'
        : trace.precondition.decision === 'NO_EVENT' ? 'NO_EVENT' : 'STAGE2_PREPARED';
      if (trace.status === 'STAGE2_PREPARED') {
        const t = performance.now();
        request2 = buildStage2Request(capture, packet, trace.precondition, { nowMs });
        trace.latency.stage2PreparationMs = performance.now() - t;
        if (proposalRaw != null) {
          trace.stage2 = evaluateStage2(capture, packet, trace.precondition, proposalRaw, { nowMs });
          trace.status = trace.stage2.fidelity.valid && trace.stage2.productionValidation?.valid
            ? 'VALIDATED_NOT_APPLIED' : 'REALISATION_REJECTED';
        }
      }
    } catch (error) { trace.status = 'SELECTION_ERROR'; trace.error = error.message; }
  }
  requireThat(fingerprint(capture) === before, 'CAPTURE_MUTATED');
  return { packet, stage1Request: request1, stage2Request: request2, trace };
}

export const productionSemantics = Object.freeze({ timeoutMs: AWG_TIMEOUT_MS,
  parser: parseAwgCandidate, materialiser: materialiseAwgProposal, validator: validateAwgCandidate,
  buildCall: buildAwgCall });
