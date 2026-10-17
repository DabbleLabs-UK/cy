// REHEARSAL ONLY. No provider, transport, persistence, publication or production wiring.
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';
import { buildAffordancePacket, fingerprint } from './grounded-occurrence.mjs';
import {
  AWG_EVENT_FAMILIES, AWG_KNOWN_LOCATIONS, AWG_TIMEOUT_MS, awgDroughtActive, materialiseAwgProposal,
  validateAwgCandidate,
} from '../../runner/ambient-world-generator.js';
import { CAST, OFFICERS } from '../../runner/cast.js';
import { normaliseMessageState } from '../../runner/message-object-lifecycle.js';

const clone = value => structuredClone(value);
const object = properties => ({ type: 'object', additionalProperties: false,
  required: Object.keys(properties), properties });
const text = { type: 'string', minLength: 1, maxLength: 300 };
const unique = values => [...new Set(values)];
const requireThat = (ok, reason) => { if (!ok) throw new Error(reason); };
function keys(value, expected, label) {
  requireThat(value && typeof value === 'object' && !Array.isArray(value)
    && isDeepStrictEqual(Object.keys(value).sort(), [...expected].sort()), `INVALID_${label}_FIELDS`);
}
function bounded(value, label) {
  requireThat(typeof value === 'string' && value.trim() === value && value.length > 0
    && value.length <= 300, `INVALID_${label}`);
}
const norm = value => String(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const word = (value, source) => new RegExp(`\\b${escape(value)}\\b`, 'i').test(source);
const people = [{ key: 'cy', name: 'Cy' }, ...CAST, ...OFFICERS];
const nouns = ['note', 'message', 'paper', 'letter', 'book', 'spoon', 'knife', 'photo', 'photograph',
  'pen', 'pencil', 'cup', 'mug', 'plate', 'phone', 'radio', 'watch', 'tablet', 'shoe', 'shirt',
  'bag', 'parcel', 'tobacco', 'cigarette', 'contraband', 'item'];
const nonPossessions = new Set(['breath', 'time', 'turn', 'question', 'answer', 'conversation',
  'discussion', 'look', 'step', 'door', 'doorway', 'floor', 'wall', 'cell', 'landing', 'wing',
  'finger', 'fingers', 'hand', 'hands', 'foot', 'feet', 'shadow', 'shadows', 'light', 'dust',
  'mark', 'crack', 'scratch', 'sky', 'sunlight', 'mr', 'miss', 'officer', 'inmate']);
const operationWords = {
  TRANSFER: /\b(?:hands?|passes?|gives?|transfers?|moves?)\b/i,
  CONFISCATE: /\b(?:seizes?|confiscates?|confiscation)\b/i,
  DELIVER: /\b(?:delivers?|hands?|passes?)\b/i, READ: /\b(?:reads?|reading)\b/i,
  RESOLVE: /\b(?:answers?|settles?|resolves?|finishes?|completes?|withdraws?|closes?)\b/i,
  RETIRE: /\b(?:retires?|discards?|destroys?|removes?)\b/i,
};

export const FIELD_ORDER = Object.freeze(['actors', 'occurrence', 'target', 'observation',
  'sourceRefs', 'effects', 'classification']);

export function buildOneCallPacket(capture, { nowMs } = {}) {
  const packet = buildAffordancePacket(capture, { nowMs });
  packet.schema = 'cy.rehearsal.one-call-affordances.v1';
  packet.interpretation.note = 'State supplies prerequisites for a new happening, not proof it is already happening. '
    + 'Eligibility is not presence. Historical records are not current occurrences. No minimum drama or lasting effect is required.';
  // A narrow observation boundary, not a new topology or an assertion of activity.
  // Existing CELL -> WING_OR_LANDING movement and partial-hearing semantics support it.
  packet.origins = [{ ref: 'origin:current', location: packet.current.location, relation: 'CURRENT_LOCATION' }];
  if (packet.current.location === 'cell') packet.origins.push({ ref: 'origin:cell-landing',
    location: 'landing', relation: 'ADJACENT_AUDIBLE_ONLY',
    condition: 'Cy stays in cell. Sound may originate on the landing; sight, identity and physical access do not follow from hearing.' });
  packet.confirmedPresence = [];
  const search = capture.locationRegime.searchEpisode;
  if (search?.status === 'ACTIVE' && search.cy_present_at_start === true
    && search.cy_knowledge === 'CY_DIRECTLY_OBSERVED' && packet.current.location === 'cell'
    && packet.actors.some(a => a.id === search.actor_id)) {
    packet.confirmedPresence.push({ actorId: search.actor_id, sourceRef: `episode:${search.id}` });
  }
  for (const item of packet.objects) {
    const stored = capture.worldSimulation.objects.find(o => o.id === item.id);
    const description = [stored.name, stored.label, stored.description].filter(v => typeof v === 'string').join(' ');
    item.mentionAliases = unique([...(item.type === 'message' ? ['message', 'note'] :
      item.type === 'note' ? ['note', 'paper'] : ['item']), ...nouns.filter(n => word(n, description))]);
  }
  requireThat(Buffer.byteLength(JSON.stringify(packet)) <= packet.bounds.packetBytes, 'PACKET_BOUND_EXCEEDED');
  return packet;
}

function sourceIds(packet) {
  return [packet.current.ref, ...['actors', 'objects', 'threads', 'recentFacts', 'interactionOpportunities',
    'observationChannels', 'origins'].flatMap(k => packet[k].map(v => v.ref))];
}

export function oneCallFormat(packet) {
  const actors = packet.actors.map(a => a.id);
  const presenceBranches = [object({ actorId: { const: 'cy' }, mode: { const: 'SELF' }, sourceRef: { type: 'null' } })];
  const others = actors.filter(id => id !== 'cy');
  const arriving = packet.actors.filter(a => a.id !== 'cy'
    && (packet.current.location !== 'cell' || a.role === 'OFFICER')).map(a => a.id);
  if (arriving.length) presenceBranches.push(object({ actorId: { enum: arriving },
    mode: { const: 'ARRIVES' }, sourceRef: { type: 'null' } }));
  if (others.length) presenceBranches.push(object({ actorId: { enum: others },
    mode: { const: 'AUDIBLY_IDENTIFIES' }, sourceRef: { type: 'null' } }));
  for (const support of packet.confirmedPresence) presenceBranches.push(object({ actorId: { const: support.actorId },
    mode: { const: 'CURRENT_EPISODE' }, sourceRef: { const: support.sourceRef } }));
  const targets = [object({ kind: { const: 'ACTOR' }, id: { enum: actors } })];
  const effectBranches = [];
  if (packet.objects.length) {
    targets.push(object({ kind: { const: 'OBJECT' }, id: { enum: packet.objects.map(o => o.id) } }));
    const transitions = packet.objects.flatMap(o => o.transitions);
    if (transitions.length) effectBranches.push(object({ kind: { const: 'OBJECT_TRANSITION' },
      objectId: { enum: packet.objects.map(o => o.id) },
      operation: { enum: unique(transitions.map(t => t.action)) },
      holderId: { enum: unique(transitions.flatMap(t => t.holderIds)) } }));
  }
  if (packet.threads.length) {
    targets.push(object({ kind: { const: 'THREAD' }, id: { enum: packet.threads.map(t => t.id) } }));
    effectBranches.push(object({ kind: { const: 'THREAD_TRANSITION' }, threadId: { enum: packet.threads.map(t => t.id) },
      operation: { enum: ['UPDATE', 'RESOLVE'] }, summary: text }));
  }
  return object({
    actors: { type: 'array', minItems: 1, maxItems: 6, uniqueItems: true, items: { enum: actors } },
    occurrence: object({ eventType: { type: 'string', pattern: '^[a-z][a-z0-9_]{1,63}$' }, summary: text,
      originLocation: { enum: packet.origins.map(o => o.location) },
      presence: { type: 'array', minItems: 1, maxItems: 6, items: { oneOf: presenceBranches } } }),
    target: { oneOf: [{ type: 'null' }, ...targets] },
    observation: object({ observerId: { enum: ['cy', 'world'] },
      access: { enum: packet.observationChannels.map(c => c.access) }, summary: text }),
    sourceRefs: { type: 'array', minItems: 3, maxItems: 16, uniqueItems: true, items: { enum: sourceIds(packet) } },
    effects: { type: 'array', minItems: 0, maxItems: effectBranches.length ? 1 : 0,
      items: effectBranches.length ? { oneOf: effectBranches } : { type: 'null' } },
    classification: object({ eventFamily: { enum: [...AWG_EVENT_FAMILIES] } }),
  });
}

export function buildOneCallRequest(capture, packet) {
  return { model: capture.model,
    system: 'REHEARSAL ONLY. Propose one small concrete new happening whose prerequisites fit the supplied world. '
      + 'Return only the constrained JSON. Work out the occurrence first; the final classification is bookkeeping, not an event menu.',
    prompt: [
      'The outer scheduler has admitted one proposal attempt, not guaranteed an accepted world event. No quotas, rotation or lasting consequence is required. Conversation and ordinary non-conversational activity are both legitimate.',
      'Describe what plausibly happens next, not only what is already evidenced. sourceRefs support prerequisites and observation, not proof that the new occurrence already happened. Historical facts are context, not incidents to repeat.',
      'Include every named acting person in actors and exactly one presence record per actor. Only Cy is SELF. CURRENT_EPISODE needs supplied confirmedPresence. An eligible person must ARRIVE within this occurrence, or AUDIBLY_IDENTIFY themselves in the occurrence; eligibility alone is not co-presence. Do not invent past conduct, motives or previously unseen identities.',
      'For ARRIVES, explicitly describe the named person arriving or approaching and Cy observing that arrival. For AUDIBLY_IDENTIFIES, explicitly describe the named person calling their own name; merely attributing an unknown voice is insufficient.',
      'originLocation is where the action/sound originates, not a movement of Cy. Adjacent landing activity is permitted only as partial hearing from cell. Cy must remain in cell; hearing cannot establish a view of the landing, message contents or property handling. Keep both summaries explicit about what is heard, not unseen visual details.',
      'Use existing listed entities only. Fixed surroundings (floor, walls, cell door), bodily activity and anonymous sounds are not new inventory. Any movable item named or handled must match the supplied object target. Do not invent unlisted property even when target is null. Targets need not have effects; effects may be empty. This prototype does not create new objects or threads.',
      'An effect must name the matching target and an explicitly supplied legal operation, and must be described in the occurrence. Do not add a hidden effect. Partial hearing cannot transfer/confiscate/read property. Include current-state, each actor/target, origin and channel refs; episode presence also needs its episode ref.',
      'Choose the final eventFamily only after describing the actual occurrence. A family label cannot waive physical, identity or knowledge checks. Return exactly one JSON object, without commentary, fences or repair.',
      JSON.stringify(packet),
    ].join('\n\n'), format: oneCallFormat(packet), options: clone(capture.postBody.options) };
}

function actorMentions(packet, proposal, texts) {
  for (const person of people) {
    const aliases = unique([person.name, person.name.replace(/^(?:Mr|Miss) /, '')]);
    const mentioned = texts.some(t => aliases.some(a => new RegExp(`\\b${escape(a)}\\b`).test(t))
      || new RegExp(`\\b${escape(person.key)}\\s+(?:arrives?|approaches?|says?|asks?|tells?|calls?|enters?|hands?|hums?)\\b`, 'i').test(t)
      || new RegExp(`\\b(?:asks?|tells?|hears?|sees?|with)\\s+${escape(person.key)}\\b`, 'i').test(t));
    if (mentioned) requireThat(packet.actors.some(a => a.id === person.key)
      && proposal.actors.includes(person.key), `UNDECLARED_OR_UNAVAILABLE_ACTOR:${person.key}`);
  }
  // Bounded proper-name guard; this is not an unrestricted natural-language oracle.
  const known = new Set(people.flatMap(p => [p.name, p.name.replace(/^(?:Mr|Miss) /, '')]));
  const knownOrAnonymousSound = name => known.has(name) || (proposal.observation.access === 'CY_PARTIAL_HEARD'
    && ['someone', 'somebody'].includes(name.toLowerCase()));
  for (const t of texts) {
    for (const m of t.matchAll(/\b((?:Mr|Miss) [A-Z][a-z]+|[A-Z][a-z]+)(?=\s+(?:arrives?|approaches?|says?|asks?|tells?|calls?|enters?|hands?|hums?|walks?|runs?)\b)/g))
      requireThat(knownOrAnonymousSound(m[1]), `UNKNOWN_NAMED_ACTOR:${m[1]}`);
    for (const m of t.matchAll(/\b(?:asks?|tells?|with|hears?|sees?)\s+((?:Mr|Miss) [A-Z][a-z]+|[A-Z][a-z]+)\b/g))
      requireThat(knownOrAnonymousSound(m[1]), `UNKNOWN_NAMED_ACTOR:${m[1]}`);
    for (const m of t.matchAll(/\b(?:(another|second|unknown|unidentified)\s+)?(officer|inmate|prisoner|stranger|someone|somebody)\b/gi)) {
      if (proposal.observation.access === 'CY_PARTIAL_HEARD') continue; // Anonymous audible source, not a fabricated identity.
      const role = m[2].toLowerCase() === 'officer' ? 'OFFICER' : ['inmate', 'prisoner'].includes(m[2].toLowerCase()) ? 'INMATE' : null;
      requireThat(!m[1] && role && proposal.actors.some(id => id !== 'cy'
        && packet.actors.some(a => a.id === id && a.role === role)), 'UNDECLARED_ACTOR_ROLE');
    }
  }
}

function objectMentions(packet, proposal, texts) {
  const target = proposal.target?.kind === 'OBJECT' ? packet.objects.find(o => o.id === proposal.target.id) : null;
  for (const t of texts) {
    for (const noun of nouns) if (word(noun, t) || word(`${noun}s`, t)) {
      requireThat(target && target.mentionAliases.includes(noun), `UNLISTED_OBJECT_MENTION:${noun}`);
    }
    for (const m of t.matchAll(/\b(?:hands?|passes?|gives?|takes?|holds?|finds?|carries|uses?|reads?|sees?|spots?|notices?|studies|examines?|picks? up)\s+(?:(?:a|an|the|his|her|my|their)\s+)?(?:(?:small|old|folded)\s+)?([a-z]+)\b/gi)) {
      const noun = m[1].toLowerCase();
      if (people.some(p => p.key === noun) || nonPossessions.has(noun)) continue;
      requireThat(target && target.mentionAliases.some(a => a === noun || `${a}s` === noun), `UNLISTED_HANDLED_OBJECT:${noun}`);
    }
  }
}

function checkPresence(capture, packet, p, needed, adjacent) {
  const entries = p.occurrence.presence;
  requireThat(Array.isArray(entries) && entries.length === p.actors.length
    && entries.every(e => e && typeof e === 'object')
    && unique(entries.map(e => e.actorId)).length === entries.length, 'PRESENCE_RECORDS_REQUIRED');
  for (const e of entries) {
    keys(e, ['actorId', 'mode', 'sourceRef'], 'PRESENCE');
    requireThat(p.actors.includes(e.actorId), 'PRESENCE_ACTOR_MISMATCH');
    const actor = packet.actors.find(a => a.id === e.actorId);
    const name = actor.name.replace(/^(?:Mr|Miss) /, '');
    const subject = `(?:${escape(actor.name)}|${escape(name)})`;
    if (actor.id === 'cy') {
      requireThat(e.mode === 'SELF' && e.sourceRef === null, 'INVALID_SELF_PRESENCE');
    } else if (e.mode === 'CURRENT_EPISODE') {
      requireThat(packet.confirmedPresence.some(c => c.actorId === actor.id && c.sourceRef === e.sourceRef), 'UNSUPPORTED_COPRESENCE');
      needed.push(e.sourceRef);
    } else if (e.mode === 'ARRIVES') {
      requireThat(e.sourceRef === null && !adjacent && p.observation.access !== 'CY_PARTIAL_HEARD', 'ARRIVAL_NOT_DIRECTLY_OBSERVED');
      requireThat(new RegExp(`\\b${subject}\\s+(?:arrives?|approaches?|comes? to)\\b`, 'i').test(p.occurrence.summary), 'ARRIVAL_NOT_IN_OCCURRENCE');
      requireThat(p.observation.access === 'WORLD_ONLY' || new RegExp(`\\b(?:sees?|watches?|observes?)\\s+${subject}\\b`, 'i').test(p.observation.summary), 'ARRIVAL_NOT_IN_OBSERVATION');
      requireThat(packet.current.location !== 'cell' || actor.role === 'OFFICER', 'UNSUPPORTED_INMATE_CELL_ENTRY');
    } else if (e.mode === 'AUDIBLY_IDENTIFIES') {
      requireThat(e.sourceRef === null && p.observation.access === 'CY_PARTIAL_HEARD', 'AUDIBLE_ID_REQUIRES_HEARING');
      const ownName = new RegExp(`\\b${subject}\\s+(?:calls?|says?|shouts?)\\s+(?:out\\s+)?(?:his|her|their)\\s+(?:own\\s+)?name\\b`, 'i');
      requireThat(ownName.test(p.occurrence.summary), 'IDENTITY_NOT_ESTABLISHED');
      requireThat(word(name, p.observation.summary) && /\bhears?\b/i.test(p.observation.summary), 'IDENTITY_NOT_OBSERVED');
    } else throw new Error('UNSUPPORTED_COPRESENCE');
    if (e.mode !== 'CURRENT_EPISODE') requireThat(e.sourceRef === null, 'UNSUPPORTED_PRESENCE_REFERENCE');
  }
}

function checkObservationScope(packet, p, adjacent) {
  const texts = [p.occurrence.summary, p.observation.summary];
  if (p.observation.access === 'CY_PARTIAL_HEARD') {
    requireThat(p.actors.includes('cy') && /\b(?:hears?|listens?)\b/i.test(p.observation.summary), 'HEARING_NOT_DESCRIBED');
    requireThat(!texts.some(t => /\b(?:sees?|watches?|spots?|reads?|looks? at|colour|color|red|blue|written words)\b/i.test(t)), 'HEARING_CLAIMS_VISUAL_DETAIL');
    requireThat(p.effects.length === 0 && p.target?.kind !== 'OBJECT', 'HEARING_CANNOT_ESTABLISH_PROPERTY_EFFECT');
  }
  if (adjacent) {
    requireThat(packet.current.location === 'cell' && p.occurrence.originLocation === 'landing'
      && p.observation.observerId === 'cy' && p.observation.access === 'CY_PARTIAL_HEARD', 'UNSUPPORTED_ADJACENT_OBSERVATION');
    // Every explicit action attributed to Cy must be perceptual, not relocation.
    for (const t of texts) for (const m of t.matchAll(/\bCy\s+([a-z]+)(?:\s+([a-z]+))?/gi))
      requireThat(['hears', 'hearing', 'listens'].includes(m[1].toLowerCase())
        || (m[1].toLowerCase() === 'can' && m[2]?.toLowerCase() === 'hear'), 'CY_MOVED_OR_ACTED_AT_ADJACENT_ORIGIN');
    requireThat(!texts.some(t => /\b(?:(?:he|they)\s+|(?:and|then)\s+)(?:walks?|runs?|enters?|leaves?|stands?|sits?|steps?|moves?)\b/i.test(t)), 'AMBIGUOUS_ADJACENT_MOVEMENT');
    requireThat(p.effects.length === 0 && p.target?.kind !== 'OBJECT', 'ADJACENT_PHYSICAL_EFFECT_UNSUPPORTED');
  }
  const cues = Object.fromEntries(AWG_KNOWN_LOCATIONS.map(location => [location,
    new RegExp(`\\b(?:in|inside|into|on|at|along|down|by|during) (?:the |Cy's )?${
      location === 'exercise_yard' ? '(?:exercise )?yard' : location === 'officer_desk'
        ? "(?:officer'?s? )?desk" : escape(location.replaceAll('_', ' '))}\\b`, 'i')]));
  for (const [location, pattern] of Object.entries(cues)) {
    requireThat(location === packet.current.location || location === p.occurrence.originLocation
      || !texts.some(t => pattern.test(t)), `UNSUPPORTED_PROSE_LOCATION:${location}`);
  }
}

function encode(capture, p) {
  const effect = p.effects[0];
  const objects = [];
  const informationClaims = [];
  let thread = { action: 'NONE', id: null, summary: null };
  if (effect?.kind === 'OBJECT_TRANSITION') {
    const source = capture.worldSimulation.objects.find(o => o.id === effect.objectId);
    const message = normaliseMessageState(source.message);
    let messageAction = null;
    if (source.type === 'message') {
      messageAction = { action: effect.operation, senderId: message.senderId,
        recipientId: message.recipientId, contentClaimIndex: null };
      if (effect.operation === 'DELIVER') {
        requireThat(typeof message.content === 'string' && message.content.length > 0, 'MESSAGE_CONTENT_UNAVAILABLE');
        informationClaims.push({ speakerId: message.senderId, content: message.content, truthStatus: message.contentTruthStatus });
        messageAction.contentClaimIndex = 0;
      }
    }
    objects.push({ id: source.id, type: source.type, ownerId: source.ownerId, holderId: effect.holderId,
      status: messageAction ? null : effect.operation === 'CONFISCATE' ? 'CONFISCATED' : source.status, messageAction });
  } else if (effect?.kind === 'THREAD_TRANSITION') {
    thread = { action: effect.operation, id: effect.threadId, summary: effect.summary };
  }
  return { decision: effect?.kind === 'THREAD_TRANSITION' ? 'CONTINUATION' : 'EVENT',
    eventFamily: p.classification.eventFamily, participants: clone(p.actors),
    objective: { eventType: p.occurrence.eventType, summary: p.occurrence.summary },
    objects, observations: [clone(p.observation)], informationClaims, thread };
}

export function evaluateOneCall(capture, packet, raw, { nowMs, currentCapture = capture } = {}) {
  const started = performance.now();
  let parsed = null, proposal = null, candidate = null, legacyValidation = null, preflight = null;
  const exceptions = [];
  try {
    requireThat(fingerprint(currentCapture) === fingerprint(capture), 'STALE_CAPTURE');
    requireThat(isDeepStrictEqual(buildOneCallPacket(capture, { nowMs }), packet), 'STALE_OR_TAMPERED_PACKET');
    requireThat(typeof raw === 'string' && raw.length <= 16000, 'INVALID_RESPONSE_SIZE');
    parsed = JSON.parse(raw); // Entire response, no extraction, repair, stripping or substitution.
    keys(parsed, FIELD_ORDER, 'PROPOSAL');
    requireThat(isDeepStrictEqual(Object.keys(parsed), FIELD_ORDER), 'INVALID_PROPERTY_ORDER');
    const p = parsed;
    requireThat(Array.isArray(p.actors) && p.actors.length > 0 && p.actors.length <= 6
      && unique(p.actors).length === p.actors.length
      && p.actors.every(id => packet.actors.some(a => a.id === id)), 'UNAVAILABLE_ACTOR');
    keys(p.occurrence, ['eventType', 'summary', 'originLocation', 'presence'], 'OCCURRENCE');
    requireThat(/^[a-z][a-z0-9_]{1,63}$/.test(p.occurrence.eventType), 'INVALID_EVENT_TYPE');
    bounded(p.occurrence.summary, 'OCCURRENCE_TEXT');
    keys(p.observation, ['observerId', 'access', 'summary'], 'OBSERVATION');
    bounded(p.observation.summary, 'OBSERVATION_TEXT');
    const channel = packet.observationChannels.find(c => c.observerId === p.observation.observerId && c.access === p.observation.access);
    requireThat(channel, 'UNSUPPORTED_OBSERVATION_CHANNEL');
    requireThat((channel.observerId === 'cy') === p.actors.includes('cy'), 'OBSERVATION_PARTICIPATION_MISMATCH');
    const origin = packet.origins.find(o => o.location === p.occurrence.originLocation);
    requireThat(origin, 'UNAVAILABLE_ORIGIN');
    const adjacent = origin.relation === 'ADJACENT_AUDIBLE_ONLY';
    const needed = [packet.current.ref, channel.ref, origin.ref, ...p.actors.map(id => `actor:${id}`)];
    if (p.target !== null) {
      keys(p.target, ['kind', 'id'], 'TARGET');
      const group = { ACTOR: packet.actors, OBJECT: packet.objects, THREAD: packet.threads }[p.target.kind];
      requireThat(group?.some(e => e.id === p.target.id), 'UNAVAILABLE_TARGET');
      requireThat(p.target.kind !== 'ACTOR' || p.actors.includes(p.target.id), 'TARGET_ACTOR_NOT_PARTICIPANT');
      needed.push(`${p.target.kind.toLowerCase()}:${p.target.id}`);
    }
    requireThat(Array.isArray(p.effects) && p.effects.length <= 1, 'INVALID_EFFECTS');
    for (const e of p.effects) {
      requireThat(e && typeof e === 'object', 'INVALID_EFFECT');
      if (e.kind === 'OBJECT_TRANSITION') {
        keys(e, ['kind', 'objectId', 'operation', 'holderId'], 'OBJECT_EFFECT');
        const item = packet.objects.find(o => o.id === e.objectId);
        requireThat(item && p.target?.kind === 'OBJECT' && p.target.id === item.id, 'EFFECT_TARGET_MISMATCH');
        requireThat(item.transitions.some(t => t.action === e.operation && t.holderIds.includes(e.holderId)), 'UNSUPPORTED_OBJECT_TRANSITION');
        requireThat(p.actors.includes(e.holderId), 'HOLDER_NOT_PARTICIPANT');
        requireThat(operationWords[e.operation]?.test(p.occurrence.summary), 'EFFECT_NOT_IN_OCCURRENCE');
      } else if (e.kind === 'THREAD_TRANSITION') {
        keys(e, ['kind', 'threadId', 'operation', 'summary'], 'THREAD_EFFECT');
        const t = packet.threads.find(t => t.id === e.threadId);
        requireThat(t && p.target?.kind === 'THREAD' && p.target.id === t.id
          && t.transitions.includes(e.operation), 'UNSUPPORTED_THREAD_TRANSITION');
        bounded(e.summary, 'THREAD_SUMMARY');
        requireThat(e.summary === p.occurrence.summary, 'HIDDEN_THREAD_EFFECT');
        requireThat(!t.participants.length || t.participants.some(id => p.actors.includes(id)), 'THREAD_PARTICIPANT_MISMATCH');
        if (e.operation === 'RESOLVE') requireThat(operationWords.RESOLVE.test(e.summary), 'RESOLUTION_NOT_DESCRIBED');
      } else throw new Error('UNSUPPORTED_EFFECT');
    }
    if (p.target?.kind === 'OBJECT' && p.effects.length === 0) {
      requireThat(!Object.values(operationWords).some(pattern => pattern.test(p.occurrence.summary)), 'OBJECT_OPERATION_WITHOUT_EFFECT');
    }
    checkPresence(capture, packet, p, needed, adjacent);
    checkObservationScope(packet, p, adjacent);
    requireThat(Array.isArray(p.sourceRefs) && p.sourceRefs.length <= 16 && unique(p.sourceRefs).length === p.sourceRefs.length
      && p.sourceRefs.every(r => sourceIds(packet).includes(r)) && unique(needed).every(r => p.sourceRefs.includes(r)), 'INVALID_SOURCE_REFS');
    const texts = [p.occurrence.summary, p.observation.summary];
    actorMentions(packet, p, texts); objectMentions(packet, p, texts);
    requireThat(!packet.recentFacts.some(f => norm(f.summary) === norm(p.occurrence.summary)), 'HISTORICAL_RECORD_REPLAY');
    keys(p.classification, ['eventFamily'], 'CLASSIFICATION');
    requireThat(AWG_EVENT_FAMILIES.includes(p.classification.eventFamily), 'INVALID_CLASSIFICATION');
    proposal = encode(capture, p);
    const context = { nowMs, currentLocation: capture.currentLocation, plausibleCastIds: capture.plausibleCastIds,
      recentEvents: capture.recentWorldHistory };
    candidate = materialiseAwgProposal(proposal, capture.worldSimulation, context);
    legacyValidation = validateAwgCandidate(candidate, capture.worldSimulation, context);
    // Do not let a RUMOUR label waive family-independent physical checks.
    const neutral = { ...clone(candidate), eventFamily: 'WING_ACTIVITY' };
    preflight = validateAwgCandidate(neutral, capture.worldSimulation, context);
    const physicalErrors = preflight.errors.filter(e => e !== 'THREAD_TYPE_CONTRADICTION');
    if (adjacent) {
      // A precise, visible rehearsal-only correction to the legacy substring rule.
      // Never modify any candidate prose, or waive an actor/object/knowledge error.
      if ([...legacyValidation.errors, ...physicalErrors].includes('OBJECTIVE_LOCATION_CONTRADICTION'))
        exceptions.push({ code: 'OBJECTIVE_LOCATION_CONTRADICTION', rule: 'CELL_LANDING_PARTIAL_HEARING', originRef: origin.ref });
    }
    const remaining = unique([...legacyValidation.errors, ...physicalErrors])
      .filter(e => !exceptions.some(x => x.code === e));
    requireThat(!remaining.length, `PRODUCTION_VALIDATION:${remaining.join(',')}`);
    return { valid: true, outcome: 'VALIDATED_NOT_APPLIED', raw, parsed, proposal, candidate,
      legacyValidation, familyIndependentValidation: preflight, compatibilityExceptions: exceptions,
      sourceRefsUsed: clone(p.sourceRefs), checkMs: performance.now() - started, applied: false };
  } catch (error) {
    return { valid: false, outcome: 'NO_WORLD_EVENT', reason: error.message, raw, parsed, proposal, candidate,
      legacyValidation, familyIndependentValidation: preflight, compatibilityExceptions: exceptions,
      checkMs: performance.now() - started, applied: false };
  }
}

export function prepareOneCall(capture, { nowMs, raw = null, currentCapture = capture } = {}) {
  const before = fingerprint(capture);
  const packet = buildOneCallPacket(capture, { nowMs });
  const request = buildOneCallRequest(capture, packet);
  const evaluation = raw === null ? null : evaluateOneCall(capture, packet, raw, { nowMs, currentCapture });
  requireThat(fingerprint(capture) === before, 'CAPTURE_MUTATED');
  return { packet, request, trace: { schema: 'cy.rehearsal.one-call.v1', status: evaluation?.outcome || 'PREPARED_ONLY',
    inputFingerprint: before, fieldOrder: [...FIELD_ORDER], expectedMaximumCalls: 1, repairCalls: 0,
    droughtDiagnosticOnly: { active: awgDroughtActive(capture.worldSimulation), affectsRequest: false },
    evaluation, inferenceExecuted: false, applied: false } };
}

// A future authorised isolated harness can inject its ONE transport here. This
// module contains none. Tests inject fakes; preparation CLI never calls this API.
export async function runOneCallAttempt({ capture, nowMs, admitted, generate, signal,
  timeoutMs = AWG_TIMEOUT_MS, getCurrentCapture = () => capture } = {}) {
  const started = performance.now();
  let calls = 0, timer, unlink, requestFingerprint = null;
  const controller = new AbortController();
  const result = (status, reason, extra = {}) => ({ status, reason, generateInvocations: calls,
    requestFingerprint, repairCalls: 0, replacementCalls: 0, elapsedMs: performance.now() - started,
    applied: false, abortReason: signal?.aborted ? String(signal.reason || 'CANCELLED') : null, ...extra });
  if (!admitted) return result('SKIPPED', 'NOT_ADMITTED');
  if (signal?.aborted) return result('NO_WORLD_EVENT', 'CANCELLED');
  const initial = fingerprint(capture);
  try {
    requireThat(typeof generate === 'function', 'PROVIDER_UNAVAILABLE');
    requireThat(Number.isFinite(timeoutMs) && timeoutMs > 0 && timeoutMs <= AWG_TIMEOUT_MS, 'INVALID_TIMEOUT');
    requireThat(fingerprint(await getCurrentCapture()) === initial, 'STALE_CAPTURE');
    const prepared = prepareOneCall(capture, { nowMs });
    requestFingerprint = fingerprint(prepared.request);
    const deadline = new Promise((_, reject) => {
      const cancel = reason => { controller.abort(reason); reject(new Error(reason)); };
      timer = setTimeout(() => cancel('TIMEOUT'), timeoutMs);
      if (signal) {
        const onAbort = () => cancel('CANCELLED');
        signal.addEventListener('abort', onAbort, { once: true });
        unlink = () => signal.removeEventListener('abort', onAbort);
        if (signal.aborted) onAbort();
      }
    });
    const work = Promise.resolve().then(() => {
      requireThat(!controller.signal.aborted, String(controller.signal.reason || 'CANCELLED'));
      calls++;
      return generate(prepared.request, { signal: controller.signal });
    });
    const raw = await Promise.race([work, deadline]);
    requireThat(!controller.signal.aborted, String(controller.signal.reason || 'CANCELLED'));
    requireThat(fingerprint(prepared.request) === requestFingerprint, 'REQUEST_MUTATED');
    requireThat(fingerprint(capture) === initial, 'CAPTURE_MUTATED');
    const currentCapture = await Promise.race([Promise.resolve().then(getCurrentCapture), deadline]);
    requireThat(!controller.signal.aborted, String(controller.signal.reason || 'CANCELLED'));
    const evaluation = evaluateOneCall(capture, prepared.packet, raw, { nowMs, currentCapture });
    return result(evaluation.outcome, evaluation.reason || null, { raw, evaluation });
  } catch (error) { return result('NO_WORLD_EVENT', error.message,
    { raw: typeof error.responseText === 'string' ? error.responseText : null }); }
  finally { clearTimeout(timer); unlink?.(); }
}
