// REHEARSAL ONLY. Pure permission binding, constrained compilation and validation.
// No provider, network, state writer, publication, scheduler or production import.
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';
import { buildOneCallPacket } from './one-call-grounded-proposal.mjs';
import { fingerprint } from './grounded-occurrence.mjs';
import { validateContextReceipt } from './one-call-context-budget.mjs';
import { awgLocationEligible } from '../../runner/location-regime.js';
import { AWG_TIMEOUT_MS, materialiseAwgProposal, validateAwgCandidate } from '../../runner/ambient-world-generator.js';

export const FRAME_POLICY = 'cy.rehearsal.frame-permissions.v1';
export const FIELD_ORDER = Object.freeze(['frameId', 'content']);
export const DOMAINS = Object.freeze(['CY_IN_PLACE', 'ADJACENT_NONVERBAL', 'ADJACENT_SPEECH']);
const clone = value => structuredClone(value);
const requireThat = (ok, reason) => { if (!ok) throw new Error(reason); };
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function object(properties, required = Object.keys(properties)) {
  return { type: 'object', additionalProperties: false, required, properties };
}
function exactKeys(value, required, optional = []) {
  requireThat(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_CONTENT_OBJECT');
  const keys = Object.keys(value);
  requireThat(required.every(k => Object.hasOwn(value, k)) && keys.every(k => [...required, ...optional].includes(k)), 'INVALID_CONTENT_FIELDS');
  requireThat(isDeepStrictEqual(keys, [...required, ...optional.filter(k => Object.hasOwn(value, k))]), 'INVALID_CONTENT_PROPERTY_ORDER');
}

// Generic body/acoustic capabilities, not authored incidents or actor stories.
export const BODY_OPERATIONS = freeze({
  SHIFT_WEIGHT: 'shifts his weight',
  STRETCH_HANDS: 'stretches his hands',
  TAP_FINGERS: 'taps his fingers against his palm',
});
export const BODY_MODIFIERS = freeze({ SLOWLY: 'slowly', BRIEFLY: 'briefly' });
export const ACOUSTIC_OPERATIONS = freeze({ FOOTSTEPS: 'footsteps', KNOCKING: 'knocking', COUGHING: 'coughing' });
export const ACOUSTIC_DETAILS = freeze({ FAINT: 'faint', BRIEF: 'brief', IRREGULAR: 'irregular' });

// An intentionally small compositional language, not a blacklist or an NL oracle.
// It cannot express names, property, movement, history, motives or instructions.
// The schema and runtime use the SAME full-string recognizer. No text is stripped.
const person = '(?:anyone|anybody|someone|somebody)';
const greeting = '(?:hello|hi|hey|oi)(?: (?:there|out there))?';
const availability = `(?:is )?${person}(?: else)?(?: still)? (?:awake|there|listening)(?: out there)?`;
const contact = `(?:can|could) (?:${person}|you)(?: out there)? (?:hear|answer) me(?: please)?`;
const self = "(?:i am|i'm)(?: still)? (?:awake|here|listening)";
const question = "(?:who is|who's) there";
const body = `(?:${availability}|${contact}|${self}|${question})`;
export const UTTERANCE_PATTERN = `^(?:${greeting}(?:[,!:.] ${body})?|${body})[.!?]?$`;
const permissionFingerprint = fingerprint({ policy: FRAME_POLICY, body: BODY_OPERATIONS,
  bodyModifiers: BODY_MODIFIERS, sound: ACOUSTIC_OPERATIONS, soundDetails: ACOUSTIC_DETAILS, utterance: UTTERANCE_PATTERN });
const utteranceMatcher = new RegExp(UTTERANCE_PATTERN);
function validateUtterance(text) {
  requireThat(typeof text === 'string' && text.length >= 1 && text.length <= 120
    && text === text.trim() && /^[a-z '.,!?:]+$/.test(text), 'INVALID_UTTERANCE_CHARACTERS_OR_SIZE');
  requireThat(utteranceMatcher.test(text), 'UNSUPPORTED_UTTERANCE_CONTENT');
}
function slotSchema(domain) {
  if (domain === 'CY_IN_PLACE') return object({
    operationId: { enum: Object.keys(BODY_OPERATIONS) },
    modifier: { enum: [null, ...Object.keys(BODY_MODIFIERS)] },
  }, ['operationId']);
  if (domain === 'ADJACENT_NONVERBAL') return object({
    operationId: { enum: Object.keys(ACOUSTIC_OPERATIONS) },
    detail: { enum: [null, ...Object.keys(ACOUSTIC_DETAILS)] },
  }, ['operationId']);
  return object({ utterance: { type: 'string', minLength: 1, maxLength: 120, pattern: UTTERANCE_PATTERN } });
}

export function frameStateFingerprint(capture, nowMs) {
  return fingerprint({ policy: FRAME_POLICY, nowMs, capture });
}
function revisionBindings(capture) {
  const w = capture.worldSimulation || {};
  const entities = ['objects', 'terminalObjects', 'threads', 'terminalThreads'].flatMap(collection =>
    (w[collection] || []).map(e => ({ collection, id: e.id, revision: e.revision ?? null,
      transitionId: e.transitionId ?? e.lastTransitionId ?? null, entityFingerprint: fingerprint(e) })));
  return { locationRegime: fingerprint(capture.locationRegime), worldEntities: fingerprint(entities),
    worldState: fingerprint(w), history: fingerprint(capture.recentWorldHistory || []) };
}

export function buildGroundedFrames(capture, { nowMs } = {}) {
  const packet = buildOneCallPacket(capture, { nowMs });
  const stateFingerprint = frameStateFingerprint(capture, nowMs);
  const relevantRevisions = revisionBindings(capture);
  const admittedLocation = awgLocationEligible(capture.locationRegime);
  const frames = [];
  function add(domain, originRef, channelRef) {
    const channel = packet.observationChannels.find(c => c.ref === channelRef);
    const origin = packet.origins.find(o => o.ref === originRef);
    if (!channel || !origin) return;
    const anonymous = domain !== 'CY_IN_PLACE';
    const record = {
      stateFingerprint, relevantRevisions, policy: FRAME_POLICY, permissionFingerprint, operationDomain: domain,
      semanticRoles: {
        actor: anonymous ? { kind: 'EPHEMERAL_UNIDENTIFIED_SOURCE', entityId: null }
          : { kind: 'KNOWN_SELF', entityId: 'cy' },
        speaker: domain === 'ADJACENT_SPEECH' ? { kind: 'EPHEMERAL_UNIDENTIFIED_SOURCE', entityId: null } : null,
        addressee: null, target: null, observer: { entityId: 'cy', role: 'OBSERVER' },
      },
      origin: { location: origin.location, relation: origin.relation, sourceRef: origin.ref },
      observerLocation: packet.current.location,
      observationChannel: { observerId: 'cy', access: channel.access, sourceRef: channel.ref },
      identity: { status: anonymous ? 'UNIDENTIFIED' : 'KNOWN_SELF', voiceRecognition: false, namedNpcAllowed: false },
      permittedPresenceTransition: { observer: { actorId: 'cy', mode: 'SELF' }, others: 'NONE', relocateCy: false },
      permittedEffects: [],
      prerequisiteRefs: [packet.current.ref, 'actor:cy', origin.ref, channel.ref,
        `permission:${FRAME_POLICY}:${anonymous ? 'cell-adjacent-hearing' : 'self-in-place'}`],
      contentSlotSchema: slotSchema(domain),
    };
    frames.push({ frameId: `gf1:${domain.toLowerCase()}:${fingerprint(record).slice(0, 16)}`, ...record });
  }
  if (admittedLocation && packet.actors.some(a => a.id === 'cy')) {
    add('CY_IN_PLACE', 'origin:current', 'channel:cy-direct');
    if (packet.current.location === 'cell' && packet.origins.some(o => o.ref === 'origin:cell-landing')) {
      add('ADJACENT_NONVERBAL', 'origin:cell-landing', 'channel:cy-heard');
      add('ADJACENT_SPEECH', 'origin:cell-landing', 'channel:cy-heard');
    }
  }
  return freeze({ schema: 'cy.rehearsal.grounded-frames.v1', policy: FRAME_POLICY, nowMs,
    stateFingerprint, relevantRevisions,
    current: clone(packet.current), frames,
    admission: { locationEligible: admittedLocation, outerSchedulerUnchanged: true },
    historyPolicy: { purpose: 'CONTRADICTION_AND_DUPLICATE_CHECKING_ONLY', modelFacing: false,
      retainedFacts: packet.recentFacts.length, candidatePrerequisitesFromHistory: 0 },
    omittedCapabilities: { namedNpcContact: 'NO_PROVEN_PRESENCE_ROUTE_VISIBILITY_OR_VOICE_PERMISSION',
      objectAndThreadEffects: 'NOT_IMPLEMENTED_IN_THIS_CONSERVATIVE_PROTOTYPE' },
  });
}

export function frameSelectorFormat(bound) {
  if (!bound.frames.length) return null;
  return { oneOf: bound.frames.map(frame => object({ frameId: { const: frame.frameId }, content: clone(frame.contentSlotSchema) })) };
}
export function prepareFrameSelector(capture, { nowMs } = {}) {
  const bound = buildGroundedFrames(capture, { nowMs });
  if (!bound.frames.length) return { bound, request: null, wire: null,
    trace: { prototype: 'GROUNDED_FRAME_SELECTOR', reason: 'NO_AVAILABLE_FRAMES', expectedMaximumCalls: 0, applied: false } };
  const request = {
    model: capture.model,
    system: 'REHEARSAL ONLY. Select one supplied grounded occurrence frame and fill only its typed content. Return constrained JSON, not a summary.',
    prompt: [
      'One admitted attempt may produce no world event if rejected. Choose a plausible small new occurrence; no drama, lasting effect, quota, rotation or minimum activity is required. Do not decide roles, identities, access, presence, property, history or event family.',
      'Return only frameId then content. Code binds every participant, observer, location, source reference and effect, and renders the occurrence. Do not output an occurrence sentence or change the frame. Unknown sound/speech stays unidentified. Eligibility is not presence. No named NPC, familiarity, relocation, extra action or hidden effect is permitted.',
      'CY_IN_PLACE: operationId is SHIFT_WEIGHT, STRETCH_HANDS or TAP_FINGERS (against own palm); optional modifier is SLOWLY or BRIEFLY, or null. Remain at the supplied location; use no movable property.',
      'ADJACENT_NONVERBAL: operationId is FOOTSTEPS, KNOCKING or COUGHING; optional detail is FAINT, BRIEF or IRREGULAR, or null. Cy hears from cell; no sight, named identity, purpose, route or co-presence is inferred.',
      "ADJACENT_SPEECH: content contains only utterance, 1-120 lower-case ASCII characters. Use a greeting, contact/availability question or present self-availability, optionally a greeting followed by one such clause. Grammar permits hello/hi/hey/oi (there/out there optional); is/anyone/anybody/someone/somebody, else/still, awake/there/listening; can/could anyone/anybody/someone/somebody/you (out there optional) hear/answer me (please optional); i am/i'm (still optional) awake/here/listening; who is/who's there. A greeting may be followed by comma/exclamation/colon/period and a space before the clause. Ordinary closing . ! ? is optional. No quotes, names, numbers, objects, reports, memory, motives, commands or further clauses. This is heard speech, not confirmed world fact or a Cy reply.",
      'Historical facts and cast descriptions are deliberately not supplied as inspiration. They remain available to deterministic contradiction/duplicate checks. No abstention response, repair or replacement generation exists.',
      JSON.stringify({ policy: bound.policy,
        current: { location: bound.current.location, activity: bound.current.activity, clock: bound.current.londonClock },
        frames: bound.frames.map(f => ({ frameId: f.frameId, domain: f.operationDomain,
          actorIdentity: f.identity.status, origin: f.origin.location, observer: ['cy', f.observerLocation],
          access: f.observationChannel.access, otherKnownParticipants: [], effects: [] })) }),
    ].join('\n\n'),
    format: frameSelectorFormat(bound), options: clone(capture.postBody.options),
  };
  return { bound, request, wire: { ...request, stream: false, keep_alive: '5m', truncate: false },
    trace: { prototype: 'GROUNDED_FRAME_SELECTOR', fieldOrder: FIELD_ORDER, frameOrder: bound.frames.map(f => f.operationDomain),
      stateFingerprint: bound.stateFingerprint, nowMs, expectedMaximumCalls: 1,
      repairs: 0, replacements: 0, droughtDiagnosticOnly: true, applied: false } };
}

function parseSelection(raw) {
  requireThat(typeof raw === 'string' && raw.length <= 8000, 'INVALID_RESPONSE_SIZE');
  const parsed = JSON.parse(raw);
  // JSON.parse silently keeps the last duplicate. Reject rather than discard it.
  const stack = [];
  for (const token of raw.matchAll(/"(?:[^"\\]|\\.)*"|[{}\[\],:]/g)) {
    const t = token[0];
    if (t === '{' || t === '[') stack.push({ object: t === '{', key: t === '{', keys: new Set() });
    else if (t === '}' || t === ']') stack.pop();
    else if (t === ',' && stack.at(-1)?.object) stack.at(-1).key = true;
    else if (t.startsWith('"') && stack.at(-1)?.object && stack.at(-1).key) {
      const key = JSON.parse(t), state = stack.at(-1);
      requireThat(!state.keys.has(key), 'DUPLICATE_JSON_KEY'); state.keys.add(key); state.key = false;
    }
  }
  requireThat(parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    && isDeepStrictEqual(Object.keys(parsed), FIELD_ORDER), 'INVALID_SELECTION_FIELDS_OR_ORDER');
  return parsed;
}
function validateContent(frame, content) {
  if (frame.operationDomain === 'CY_IN_PLACE') {
    exactKeys(content, ['operationId'], ['modifier']);
    requireThat(typeof content.operationId === 'string' && Object.hasOwn(BODY_OPERATIONS, content.operationId), 'UNAVAILABLE_BODILY_OPERATION');
    requireThat(content.modifier == null || (typeof content.modifier === 'string'
      && Object.hasOwn(BODY_MODIFIERS, content.modifier)), 'UNAVAILABLE_BODILY_MODIFIER');
  } else if (frame.operationDomain === 'ADJACENT_NONVERBAL') {
    exactKeys(content, ['operationId'], ['detail']);
    requireThat(typeof content.operationId === 'string' && Object.hasOwn(ACOUSTIC_OPERATIONS, content.operationId), 'UNAVAILABLE_ACOUSTIC_OPERATION');
    requireThat(content.detail == null || (typeof content.detail === 'string'
      && Object.hasOwn(ACOUSTIC_DETAILS, content.detail)), 'UNAVAILABLE_ACOUSTIC_DETAIL');
  } else {
    exactKeys(content, ['utterance']); validateUtterance(content.utterance);
  }
}
function render(frame, content) {
  const place = frame.observerLocation === 'cell' ? 'the cell'
    : frame.observerLocation === 'exercise_yard' ? 'the exercise yard' : 'the landing';
  if (frame.operationDomain === 'CY_IN_PLACE') {
    const verb = BODY_OPERATIONS[content.operationId];
    return `Cy ${content.modifier ? BODY_MODIFIERS[content.modifier] + ' ' : ''}${verb} in ${place}.`;
  }
  if (frame.operationDomain === 'ADJACENT_NONVERBAL') return `Cy hears ${content.detail ? ACOUSTIC_DETAILS[content.detail] + ' ' : ''}${ACOUSTIC_OPERATIONS[content.operationId]} from the landing.`;
  return `Cy hears an unidentified voice say "${content.utterance}" from the landing.`;
}

export function evaluateFrameSelection(capture, bound, raw, { nowMs, currentCapture = capture } = {}) {
  const started = performance.now(); let parsed = null, frame = null, reconstructed = null, legacyValidation = null;
  const compatibilityExceptions = [];
  try {
    requireThat(frameStateFingerprint(currentCapture, nowMs) === bound.stateFingerprint, 'STALE_STATE_OR_REVISIONS');
    requireThat(isDeepStrictEqual(bound, buildGroundedFrames(capture, { nowMs })), 'STALE_OR_TAMPERED_FRAME_SET');
    parsed = parseSelection(raw);
    frame = bound.frames.find(f => f.frameId === parsed.frameId);
    requireThat(frame, 'UNKNOWN_OR_STALE_FRAME_ID');
    validateContent(frame, parsed.content);
    const occurrence = render(frame, parsed.content);
    reconstructed = { frameId: frame.frameId, stateFingerprint: frame.stateFingerprint,
      participants: ['cy'], semanticRoles: clone(frame.semanticRoles),
      observerId: 'cy', access: frame.observationChannel.access, observerLocation: frame.observerLocation,
      originLocation: frame.origin.location, identity: clone(frame.identity),
      presence: [clone(frame.permittedPresenceTransition.observer)],
      sourceRefs: [...frame.prerequisiteRefs], effects: [],
      classification: frame.operationDomain === 'CY_IN_PLACE' ? 'WING_ACTIVITY' : 'OVERHEARD_ACTIVITY',
      occurrence, heardUtterance: frame.operationDomain === 'ADJACENT_SPEECH' ? parsed.content.utterance : null,
      utteranceIsWorldFact: false };
    const proposal = { decision: 'EVENT', eventFamily: reconstructed.classification, participants: ['cy'],
      objective: { eventType: 'ambient_occurrence', summary: occurrence }, objects: [],
      observations: [{ observerId: 'cy', access: reconstructed.access, summary: occurrence }],
      informationClaims: [], thread: { action: 'NONE', id: null, summary: null } };
    const context = { nowMs, currentLocation: capture.currentLocation, plausibleCastIds: capture.plausibleCastIds,
      recentEvents: capture.recentWorldHistory };
    const candidate = materialiseAwgProposal(proposal, capture.worldSimulation, context);
    legacyValidation = validateAwgCandidate(candidate, capture.worldSimulation, context);
    // Canonical "hears ... from" separates observer position from sound origin.
    // No legacy error is waived; older prototype exceptions are not imported.
    requireThat(legacyValidation.valid, `PRODUCTION_VALIDATION:${legacyValidation.errors.join(',')}`);
    return { valid: true, outcome: 'VALIDATED_NOT_APPLIED', parsed, frame, reconstructed,
      proposal, candidate, legacyValidation, compatibilityExceptions, applied: false, checkMs: performance.now() - started };
  } catch (error) {
    return { valid: false, outcome: 'NO_WORLD_EVENT', reason: error.message, parsed, frame,
      reconstructed, legacyValidation, compatibilityExceptions, applied: false, checkMs: performance.now() - started };
  }
}

export async function runFrameSelectorAttempt({ capture, nowMs, admitted, preflight, generate, signal,
  getCurrentCapture = () => capture, timeoutMs = AWG_TIMEOUT_MS } = {}) {
  const started = performance.now(), controller = new AbortController(); let timer, unlink;
  let calls = 0, contextPreflight = null;
  const result = (reason, extra = {}) => ({ reason, generateInvocations: calls, repairCalls: 0,
    replacementCalls: 0, contextPreflight, elapsedMs: performance.now() - started, applied: false, ...extra });
  if (!admitted) return result('NOT_ADMITTED');
  try {
    requireThat(!signal?.aborted, 'CANCELLED');
    requireThat(typeof preflight === 'function' && typeof generate === 'function', 'TOKEN_PREFLIGHT_REQUIRED');
    requireThat(Number.isFinite(timeoutMs) && timeoutMs > 0 && timeoutMs <= AWG_TIMEOUT_MS, 'INVALID_TIMEOUT');
    const prepared = prepareFrameSelector(capture, { nowMs });
    if (!prepared.bound.frames.length) return result('NO_AVAILABLE_FRAMES');
    const original = frameStateFingerprint(capture, nowMs), requestHash = fingerprint(prepared.request);
    requireThat(frameStateFingerprint(await getCurrentCapture(), nowMs) === original, 'STALE_STATE_OR_REVISIONS');
    contextPreflight = validateContextReceipt(prepared.request, await preflight(clone(prepared.request)));
    requireThat(!signal?.aborted, 'CANCELLED');
    requireThat(frameStateFingerprint(await getCurrentCapture(), nowMs) === original
      && frameStateFingerprint(capture, nowMs) === original, 'STALE_STATE_OR_REVISIONS');
    const deadline = new Promise((_, reject) => {
      const abort = reason => { controller.abort(reason); reject(new Error(reason)); };
      timer = setTimeout(() => abort('TIMEOUT'), timeoutMs);
      const onAbort = () => abort('CANCELLED'); signal?.addEventListener('abort', onAbort, { once: true });
      unlink = () => signal?.removeEventListener('abort', onAbort); if (signal?.aborted) onAbort();
    });
    const raw = await Promise.race([Promise.resolve().then(() => {
      requireThat(!controller.signal.aborted, 'CANCELLED'); calls++;
      return generate(clone(prepared.wire), { signal: controller.signal });
    }), deadline]);
    requireThat(!controller.signal.aborted, 'CANCELLED');
    requireThat(frameStateFingerprint(capture, nowMs) === original && fingerprint(prepared.request) === requestHash, 'CAPTURE_OR_REQUEST_MUTATED');
    const currentCapture = await Promise.race([Promise.resolve().then(getCurrentCapture), deadline]);
    requireThat(!controller.signal.aborted, 'CANCELLED');
    const evaluation = evaluateFrameSelection(capture, prepared.bound, raw, { nowMs, currentCapture });
    return result(evaluation.reason || null, { raw, evaluation });
  } catch (error) { return result(error.message); } finally { clearTimeout(timer); unlink?.(); }
}
