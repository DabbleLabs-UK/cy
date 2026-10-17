// REHEARSAL ONLY. Pure construction/checking; no transport, persistence or apply.
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';
import { buildOneCallPacket, compactModelPacket } from './one-call-grounded-proposal.mjs';
import { fingerprint } from './grounded-occurrence.mjs';
import { validateContextReceipt } from './one-call-context-budget.mjs';
import { AWG_EVENT_FAMILIES, AWG_KNOWN_LOCATIONS, AWG_TIMEOUT_MS, materialiseAwgProposal,
  validateAwgCandidate, isSubjectOfTalk } from '../../runner/ambient-world-generator.js';
import { normaliseMessageState } from '../../runner/message-object-lifecycle.js';

export const FIELD_ORDER = Object.freeze(['roles', 'occurrence', 'accessFrameId', 'effectChoiceId']);
export const ROLE_KINDS = Object.freeze(['ACTOR', 'ADDRESSEE', 'TARGET', 'MENTIONED_ONLY']);
const copy = v => structuredClone(v);
const unique = v => [...new Set(v)];
const requireThat = (ok, why) => { if (!ok) throw new Error(why); };
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const word = (s, text) => new RegExp(`\\b${esc(s)}\\b`, 'i').test(text);
const exactKeys = (v, keys, why) => requireThat(v && typeof v === 'object' && !Array.isArray(v)
  && isDeepStrictEqual(Object.keys(v).sort(), [...keys].sort()), why);
const norm = s => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const roleActive = r => r.role !== 'MENTIONED_ONLY';

export function buildSemanticPacket(capture, { nowMs } = {}) {
  const p = buildOneCallPacket(capture, { nowMs });
  p.schema = 'cy.rehearsal.semantic-core-affordances.v1';
  p.accessFrames = [];
  if (p.observationChannels.some(c => c.access === 'CY_DIRECT')) p.accessFrames.push({
    id: 'CURRENT_DIRECT', originRef: 'origin:current', channelRef: 'channel:cy-direct',
    rule: 'Cy observes at current location. Other actors need current episode presence or a permitted officer arrival within the occurrence. No assumed co-presence.' });
  if (p.origins.some(o => o.ref === 'origin:cell-landing')) {
    p.accessFrames.push({ id: 'ADJACENT_UNIDENTIFIED', originRef: 'origin:cell-landing', channelRef: 'channel:cy-heard',
      rule: 'Cy hears adjacent landing sound from cell. Speaker stays unidentified; named people may only be mentioned, not inferred present.' });
    p.accessFrames.push({ id: 'ADJACENT_SELF_IDENTIFIED', originRef: 'origin:cell-landing', channelRef: 'channel:cy-heard',
      rule: 'Cy hears from cell. Each named speaker explicitly introduces or names themselves NOW. A familiar name or attributed voice alone is insufficient. No inmate approach/movement permission is supplied by eligibility.' });
  }
  if (p.observationChannels.some(c => c.access === 'WORLD_ONLY')) p.accessFrames.push({
    id: 'WORLD_CURRENT', originRef: 'origin:current', channelRef: 'channel:world',
    rule: 'Offscreen at fixed location. Cy absent/unaware. Other actors need episode presence or permitted arrival; no invisible extra actions.' });
  p.effectChoices = [];
  for (const o of p.objects) for (const t of o.transitions) for (const holderId of t.holderIds)
    p.effectChoices.push({ id: `fx:${p.effectChoices.length}`, kind: 'OBJECT_TRANSITION',
      objectId: o.id, operation: t.action, holderId });
  for (const t of p.threads) for (const operation of t.transitions)
    p.effectChoices.push({ id: `fx:${p.effectChoices.length}`, kind: 'THREAD_TRANSITION', threadId: t.id, operation });
  p.interpretation.note = 'Prerequisite references and observer bookkeeping are reconstructed by code. Frames are access permissions, not incidents. Historical facts do not establish current presence or voice familiarity.';
  return p;
}

export function semanticFormat(p) {
  const object = properties => ({ type: 'object', additionalProperties: false,
    required: Object.keys(properties), properties });
  return object({ roles: { type: 'array', minItems: 1, maxItems: 6, items: object({
    entityId: { enum: [...p.actors, ...p.objects, ...p.threads].map(e => e.id).concat('UNIDENTIFIED') },
    role: { enum: [...ROLE_KINDS] } }) },
  occurrence: { type: 'string', minLength: 1, maxLength: 300 },
  accessFrameId: { enum: p.accessFrames.map(f => f.id) },
  effectChoiceId: { enum: [null, ...p.effectChoices.map(f => f.id)] } });
}

export function prepareSemanticCore(capture, { nowMs } = {}) {
  const packet = buildSemanticPacket(capture, { nowMs });
  const request = { model: capture.model,
    system: 'REHEARSAL ONLY. Propose one small concrete new happening grounded in supplied prerequisites. Return only constrained JSON. No event-family decision.',
    prompt: [
      'The outer scheduler admits one attempt, not a guaranteed world event. Ordinary activity and conversation are legitimate; no drama, object or lasting effect is required.',
      'Choose semantic roles once. ACTOR acts/speaks; ADDRESSEE is addressed as present; TARGET is an affected entity; MENTIONED_ONLY is discussed/quoted, not present. Use UNIDENTIFIED for an unknown audible person. Cy as observer is added by code; include Cy in roles only when acting or addressed. No unused actors.',
      'Give one concrete occurrence account, consistent with every role and the chosen access frame. Do not add a second observation account. Frames specify origin and knowledge limits, not an incident menu. An allowed arrival may establish new presence; eligibility never proves prior presence.',
      'For named adjacent speech, explicitly describe that person introducing or naming themselves now. Merely hearing footsteps, a name, or a familiar-sounding voice does not identify the speaker. An unidentified caller saying another name does not establish that named person is present. Do not invent voice familiarity, motives, relationships or past conduct.',
      'Cy stays at current location. Adjacent sound permits hearing, not sight, exact unseen actions, contents or property transfers. No inmate movement/approach at bang-up or cell entry is authorised by this roster. Fixed floor/walls/cell door, body activity and anonymous sounds are not inventory. Use only listed movable property and legal effect choices; null means no effect, never a hidden one.',
      'Historical records are context, not ongoing events to repeat. A historical assertion needs its actual supplied evidence; uncertain/paraphrased historical claims fail closed. Do not invent or complete missing history. No timestamps or IDs beyond supplied semantic choices.',
      'Code reconstructs participants, origin, observer/access, presence, prerequisite refs and downstream classification. Do not emit those fields. Tables follow columns; actor refPrefix plus id gives provenance. Shared actor eligibility and historical scope apply to each row.',
      JSON.stringify(compactModelPacket(packet)),
    ].join('\n\n'), format: semanticFormat(packet), options: copy(capture.postBody.options) };
  return { packet, request, wire: { ...request, stream: false, keep_alive: '5m', truncate: false },
    trace: { prototype: 'REDUCED_SEMANTIC_CORE', fieldOrder: [...FIELD_ORDER], nowMs,
      captureFingerprint: fingerprint(capture), expectedMaximumCalls: 1, repairs: 0,
      replacements: 0, droughtDiagnosticOnly: true, inferenceExecuted: false, applied: false } };
}

function quotedSpans(text) {
  return [...text.matchAll(/(?<![A-Za-z0-9])(["'])([^\r\n]*?)\1(?![A-Za-z0-9])/g)]
    .map(m => ({ start: m.index, end: m.index + m[0].length, body: m[2] }));
}
function actorAliases(a) { return unique([a.name, a.name.replace(/^(?:Mr|Miss) /, '')]); }
function mentions(a, text) {
  const spans = quotedSpans(text);
  return actorAliases(a).flatMap(alias => [...text.matchAll(new RegExp(`\\b${esc(alias)}\\b`, 'g'))]
    .map(m => ({ at: m.index, length: m[0].length, quoted: spans.some(s => m.index >= s.start && m.index < s.end) })));
}
function selfIdentification(a, text) {
  const subject = `(?:${actorAliases(a).map(esc).join('|')})`;
  if (new RegExp(`\\b${subject}\\s+(?:(?:calls?|says?|shouts?|announces?)\\s+(?:out\\s+)?(?:his|her|their)\\s+(?:own\\s+)?name|(?:audibly\\s+)?(?:introduces?|identifies?)\\s+(?:himself|herself|themselves))\\b`, 'i').test(text)) return true;
  const spans = quotedSpans(text);
  return spans.some(q => {
    const before = text.slice(Math.max(0, q.start - 80), q.start);
    const justName = actorAliases(a).some(alias => norm(q.body) === norm(alias));
    const ownClaim = actorAliases(a).some(alias => new RegExp(`^(?:i am|i'm|it is|it's|this is) ${esc(alias)}[.!]?$`, 'i').test(q.body));
    return (justName && new RegExp(`\\b${subject}\\s+(?:calls?|says?|shouts?)\\s+(?:out\\s+)?$`, 'i').test(before))
      || (ownClaim && /\b(?:voice|someone|somebody|speaker)\b.*\b(?:says?|calls?|shouts?)\s*$/i.test(before));
  });
}

function checkRoleProse(p, core, texts, frame, presence) {
  const byId = new Map(core.roles.map(r => [r.entityId, r]));
  const heard = frame.channelRef === 'channel:cy-heard';
  for (const a of p.actors) {
    const matches = texts.flatMap(t => mentions(a, t).map(m => ({ ...m, text: t })));
    if (!matches.length) continue;
    const r = byId.get(a.id);
    if (a.id === 'cy' && frame.channelRef !== 'channel:world' && !r) continue; // Known self, not an inferred extra identity.
    requireThat(r, `UNDECLARED_ENTITY:${a.id}`);
    for (const m of matches) {
      const subjectOnly = m.quoted || isSubjectOfTalk(m.text.slice(0, m.at), m.text.slice(m.at + m.length));
      if (r.role === 'MENTIONED_ONLY') requireThat(subjectOnly, `MENTION_AS_ACTOR:${a.id}`);
      else if (r.role !== 'ACTOR') requireThat(!new RegExp(`^\\s+(?:arrives?|approaches?|says?|calls?|shouts?|enters?|taps?|hands?|passes?|gives?|takes?|walks?|runs?|moves?|hums?|laughs?|knocks?|answers?|asks?|tells?|reads?|sits?|stands?|introduces?|identifies?)\\b`, 'i').test(m.text.slice(m.at + m.length)), `NONACTING_ROLE_AS_ACTOR:${a.id}`);
    }
  }
  const unknownActor = /\b((?:Mr\.?|Miss) [A-Z][a-z]+|[A-Z][a-z]+)(?=\s+(?:arrives?|approaches?|says?|calls?|shouts?|enters?|hands?|runs?)\b)/g;
  for (const t of texts) for (const m of t.matchAll(unknownActor))
    requireThat(p.actors.some(a => actorAliases(a).includes(m[1])) || ['Cy', 'Someone', 'Somebody'].includes(m[1]), `UNKNOWN_PROSE_ACTOR:${m[1]}`);
  for (const t of texts) for (const m of t.matchAll(/\b(?:(another|second|unknown|unidentified|a|an|the)\s+)?(officer|inmate|prisoner|stranger|someone|somebody)\b/gi)) {
    const modifier = (m[1] || '').toLowerCase(), noun = m[2].toLowerCase();
    const anonymous = heard && (byId.get('UNIDENTIFIED')?.role === 'ACTOR'
      || (frame.id === 'ADJACENT_SELF_IDENTIFIED' && p.actors.some(a => byId.get(a.id)?.role === 'ACTOR' && selfIdentification(a, t))));
    if (anonymous) continue;
    const wanted = noun === 'officer' ? 'OFFICER' : ['inmate', 'prisoner'].includes(noun) ? 'INMATE' : null;
    const named = p.actors.filter(a => a.role === wanted && byId.get(a.id)?.role === 'ACTOR' && mentions(a, t).some(x => !x.quoted));
    const apposition = named.some(a => actorAliases(a).some(alias => t.slice(Math.max(0, m.index - alias.length - 3), m.index).includes(alias)));
    requireThat(wanted && named.length > 0 && !['another', 'second', 'unknown', 'unidentified'].includes(modifier)
      && (!['a', 'an'].includes(modifier) || apposition), 'UNDECLARED_ANONYMOUS_ACTOR');
  }
  for (const r of core.roles) {
    if (r.entityId === 'UNIDENTIFIED') {
      requireThat(heard && r.role === 'ACTOR', 'UNIDENTIFIED_REQUIRES_AUDIBLE_ACTOR');
      requireThat(texts.some(t => /\b(?:someone|somebody|unidentified|unknown|voice|footsteps|knock|sound|laughter)\b/i.test(t)), 'UNREALIZED_ANONYMOUS_ROLE');
      continue;
    }
    const a = p.actors.find(a => a.id === r.entityId);
    if (!a) continue;
    if (r.role === 'MENTIONED_ONLY') {
      requireThat(texts.some(t => mentions(a, t).length), `UNREALIZED_MENTION:${a.id}`);
      continue;
    }
    requireThat(texts.some(t => mentions(a, t).some(m => !m.quoted
      && !isSubjectOfTalk(t.slice(0, m.at), t.slice(m.at + m.length))))
      || (heard && selfIdentification(a, core.occurrence)), `UNREALIZED_ROLE:${a.id}`);
    if (a.id === 'cy') continue;
    const current = p.confirmedPresence.find(e => e.actorId === a.id);
    if (frame.id === 'ADJACENT_UNIDENTIFIED') throw new Error(`UNSUPPORTED_AUDIBLE_IDENTITY:${a.id}`);
    if (heard) {
      requireThat(r.role === 'ACTOR' && selfIdentification(a, core.occurrence), `SELF_IDENTIFICATION_REQUIRED:${a.id}`);
      requireThat(!texts.some(t => /\b(?:familiar|recognis(?:e|es|ed)|recogniz(?:e|es|ed))\b/i.test(t)
        && !selfIdentification(a, t)), `UNSUPPORTED_VOICE_FAMILIARITY:${a.id}`);
      presence.push({ actorId: a.id, mode: 'AUDIBLY_IDENTIFIES', sourceRef: null });
    } else if (current) presence.push({ actorId: a.id, mode: 'CURRENT_EPISODE', sourceRef: current.sourceRef });
    else {
      requireThat(r.role === 'ACTOR' && (p.current.location !== 'cell' || a.role === 'OFFICER'), `ARRIVAL_NOT_AUTHORISED:${a.id}`);
      requireThat(new RegExp(`\\b(?:${actorAliases(a).map(esc).join('|')})\\s+(?:arrives?|approaches?|comes? to)\\b`, 'i').test(core.occurrence), `NEW_PRESENCE_NOT_ESTABLISHED:${a.id}`);
      presence.push({ actorId: a.id, mode: 'ARRIVES', sourceRef: null });
    }
  }
}

const inventory = ['note', 'message', 'paper', 'letter', 'book', 'spoon', 'knife', 'photo', 'photograph', 'pen',
  'pencil', 'cup', 'mug', 'plate', 'phone', 'radio', 'watch', 'tablet', 'shoe', 'shirt', 'bag', 'parcel',
  'tobacco', 'cigarette', 'contraband', 'item', 'guitar', 'keys', 'key', 'food', 'eggs', 'egg', 'blanket'];
const safeNouns = new Set(['breath', 'time', 'turn', 'question', 'answer', 'conversation', 'discussion', 'look',
  'step', 'steps', 'door', 'doorway', 'floor', 'wall', 'cell', 'landing', 'wing', 'finger', 'fingers', 'hand',
  'hands', 'foot', 'feet', 'shadow', 'shadows', 'light', 'dust', 'mark', 'crack', 'scratch', 'sound', 'sounds',
  'voice', 'voices', 'name', 'knock', 'laughter', 'footsteps', 'pause', 'anyone', 'noise', 'bit',
  'moment', 'second', 'sigh', 'cough', 'reply', 'sound', 'body', 'officer', 'inmate', 'prisoner', 'fact']);
const opWords = { TRANSFER: /\b(?:hands?|passes?|gives?|transfers?|moves?)\b/i,
  CONFISCATE: /\b(?:seizes?|confiscates?)\b/i, DELIVER: /\b(?:delivers?|hands?|passes?)\b/i,
  READ: /\b(?:reads?|reading)\b/i, RESOLVE: /\b(?:answers?|settles?|resolves?|finishes?|completes?|withdraws?|closes?)\b/i,
  RETIRE: /\b(?:retires?|discards?|destroys?|removes?)\b/i, UPDATE: /\b(?:updates?|changes?|continues?)\b/i };
function checkProperty(p, core, texts, effect, heard) {
  const selected = p.objects.filter(o => core.roles.some(r => r.entityId === o.id && roleActive(r)));
  const aliasAllowed = n => selected.some(o => o.mentionAliases.some(a => n === a || n === `${a}s`));
  for (const text of texts) {
    for (const n of inventory) if (word(n, text) || word(`${n}s`, text)) requireThat(aliasAllowed(n), `UNAVAILABLE_PROPERTY:${n}`);
    for (const m of text.matchAll(/\b(?:a|an)\s+(?:(?:small|old|folded|faint|brief|loud|quiet|single|new|deep|unidentified|unknown|earlier)\s+)*([a-z]+)\b/gi)) {
      const n = m[1].toLowerCase();
      requireThat(safeNouns.has(n) || p.actors.some(a => actorAliases(a).some(s => s.toLowerCase() === n)) || aliasAllowed(n), `UNLISTED_INTRODUCED_ENTITY:${n}`);
    }
    for (const m of text.matchAll(/\b(?:hands?|passes?|gives?|takes?|holds?|finds?|carries|uses?|reads?|sees?|spots?|notices?|studies|examines?|picks? up)\s+(?:(?:a|an|the|his|her|my|their)\s+)?(?:(?:small|old|folded)\s+)?([a-z]+)\b/gi)) {
      const n = m[1].toLowerCase();
      requireThat(safeNouns.has(n) || p.actors.some(a => actorAliases(a).some(s => s.toLowerCase() === n)) || aliasAllowed(n), `UNLISTED_HANDLED_ENTITY:${n}`);
    }
  }
  requireThat(!heard || !effect, 'HEARING_CANNOT_ESTABLISH_EFFECT');
  if (effect) {
    const entity = effect.objectId || effect.threadId;
    requireThat(core.roles.some(r => r.entityId === entity && roleActive(r)), 'EFFECT_ENTITY_ROLE_REQUIRED');
    requireThat(opWords[effect.operation].test(core.occurrence), 'EFFECT_NOT_IN_OCCURRENCE');
    if (effect.holderId) requireThat(core.roles.some(r => r.entityId === effect.holderId && roleActive(r)), 'EFFECT_HOLDER_ROLE_REQUIRED');
  } else if (selected.length) requireThat(!texts.some(t => Object.entries(opWords)
    .filter(([op]) => op !== 'UPDATE' && op !== 'RESOLVE').some(([, re]) => re.test(t))), 'UNDECLARED_PROPERTY_EFFECT');
}

function checkScope(p, core, texts, frame) {
  const heard = frame.channelRef === 'channel:cy-heard';
  requireThat(!texts.some(t => /\b(?:starts?|ends?|lifts?|calls?|declares?|orders?)\s+(?:(?:a|the|full)\s+)*(?:lockdown|cell search)\b|\b(?:unlocks?|opens?)\s+(?:the |Cy's )?cell door\b|\b(?:releases?|frees?)\s+Cy\b/i.test(t)), 'UNAVAILABLE_REGIME_OR_CUSTODY_OPERATION');
  requireThat(!texts.some(t => /\bCy\s+(?:leaves?|exits?|steps? out|walks? out)\b/i.test(t)), 'CY_LOCATION_CHANGE_NOT_AUTHORISED');
  if (heard) {
    requireThat(!texts.some(t => [...t.matchAll(/\b(?:sees?|watches?|spots?|reads?|looks? at|colour|color|red|blue|written words|directly observes)\b/gi)]
      .some(m => !/\b(?:cannot|can't|not|never|without)\s*$/i.test(t.slice(Math.max(0, m.index - 20), m.index)))), 'HEARING_CLAIMS_VISIBILITY');
    requireThat(!texts.some(t => /\b(?:Cy|he|they)\s+(?:walks?|runs?|enters?|leaves?|stands?|steps?|moves?|approaches?|arrives?)\b/i.test(t)), 'OBSERVER_OR_AMBIGUOUS_MOVEMENT');
    if (core.roles.some(r => roleActive(r) && p.actors.some(a => a.id === r.entityId && a.id !== 'cy' && a.role === 'INMATE')))
      requireThat(!texts.some(t => /\b(?:and|then)\s+(?:arrives?|approaches?|enters?|walks?|runs?)\b/i.test(t)), 'INMATE_ROUTE_NOT_SUPPLIED');
    for (const a of p.actors.filter(a => a.role === 'INMATE' && a.id !== 'cy')) {
      const actor = `(?:${actorAliases(a).map(esc).join('|')})`;
      requireThat(!texts.some(t => new RegExp(`\\b${actor}\\s+(?:arrives?|approaches?|enters?|walks?|runs?)\\b`, 'i').test(t)), `INMATE_ROUTE_NOT_SUPPLIED:${a.id}`);
    }
  }
  if (frame.id === 'CURRENT_DIRECT' && core.roles.some(r => r.entityId !== 'cy' && roleActive(r)))
    requireThat(!texts.some(t => /\b(?:cannot|can't|does not) see\b|\b(?:opaque|blocked view)\b/i.test(t)), 'DIRECT_VISIBILITY_CONTRADICTION');
  if (frame.id === 'WORLD_CURRENT') requireThat(!texts.some(t => /\bCy\b/.test(t)), 'WORLD_ONLY_CANNOT_GIVE_CY_KNOWLEDGE');
  const origin = p.origins.find(o => o.ref === frame.originRef);
  for (const t of texts) {
    for (const location of AWG_KNOWN_LOCATIONS) {
      if (location === p.current.location || location === origin.location) continue;
      const label = location === 'exercise_yard' ? '(?:exercise )?yard' : esc(location.replaceAll('_', ' '));
      requireThat(!new RegExp(`\\b(?:in|inside|into|on|at|along|down|by|during) (?:the |Cy's )?${label}\\b`, 'i').test(t), `UNSUPPORTED_REMOTE_LOCATION:${location}`);
    }
    if (origin.location === 'cell') requireThat(!/\b(?:on|at|along|down|in) the (?:landing|corridor|wing)\b/i.test(t), 'PROSE_ORIGIN_CONFLICT');
  }
}

function historyRefs(p, texts, frame) {
  const refs = [];
  for (const text of texts) {
    requireThat(!p.recentFacts.some(f => norm(f.summary) === norm(text)), 'HISTORICAL_RECORD_REPLAY');
    // Historical evidence is attached only for an exact, explicitly past-scoped
    // quoted fact. Paraphrases/implicit backstory are not certified by name overlap.
    const supported = quotedSpans(text).filter(q => p.recentFacts.some(f => f.summary === q.body));
    for (const q of supported) {
      requireThat(/\b(?:earlier|previously|before|past|remember)\b/i.test(text.slice(0, q.start)), 'HISTORICAL_FACT_PRESENT_SCOPE');
      const fact = p.recentFacts.find(f => f.summary === q.body);
      requireThat(frame.channelRef === 'channel:world' || fact.cyObserved === true, 'UNOBSERVED_HISTORY_CANNOT_ENTER_CY_KNOWLEDGE');
      refs.push(fact.ref);
    }
    let remaining = text;
    for (const q of supported.slice().reverse()) remaining = remaining.slice(0, q.start) + remaining.slice(q.end);
    if (/\b(?:was|were|had|used to|stole|stolen|took|told|yesterday|last week|last night|earlier|previously|remember|again|returned|missing|for years|withholding|hiding something)\b/i.test(remaining))
      requireThat(supported.length > 0 && !/\b(?:was|were|had|stole|stolen|took|told|yesterday|last week|last night|again|returned|missing|for years|withholding|hiding something)\b/i.test(remaining), 'UNSUPPORTED_HISTORY_OR_MOTIVE');
  }
  return unique(refs);
}

function encode(capture, p, core, frame, effect, participants) {
  const channel = p.observationChannels.find(c => c.ref === frame.channelRef);
  const objects = [], informationClaims = [];
  let thread = { action: 'NONE', id: null, summary: null };
  if (effect?.kind === 'OBJECT_TRANSITION') {
    const o = p.objects.find(o => o.id === effect.objectId);
    const stored = capture.worldSimulation.objects.find(o => o.id === effect.objectId);
    const m = normaliseMessageState(stored.message);
    let messageAction = null;
    if (m) {
      messageAction = { action: effect.operation, senderId: m.senderId, recipientId: m.recipientId, contentClaimIndex: null };
      if (effect.operation === 'DELIVER') {
        requireThat(typeof m.content === 'string' && m.content.length > 0, 'MESSAGE_CONTENT_UNAVAILABLE');
        informationClaims.push({ speakerId: m.senderId, content: m.content, truthStatus: m.contentTruthStatus });
        messageAction.contentClaimIndex = 0;
      }
    }
    objects.push({ id: o.id, type: o.type, ownerId: o.ownerId, holderId: effect.holderId,
      status: m ? null : effect.operation === 'CONFISCATE' ? 'CONFISCATED' : o.status, messageAction });
  } else if (effect) thread = { action: effect.operation, id: effect.threadId, summary: core.occurrence };
  const eventFamily = effect?.kind === 'OBJECT_TRANSITION' ? (objects[0].type === 'message' ? 'MESSAGE_PASSING' : 'OBJECT_TRANSFER')
    : effect?.kind === 'THREAD_TRANSITION' ? (p.threads.find(t => t.id === effect.threadId).type.toUpperCase())
      : channel.access === 'CY_PARTIAL_HEARD' ? 'OVERHEARD_ACTIVITY'
        : participants.some(id => p.actors.some(a => a.id === id && a.role === 'OFFICER')) ? 'OFFICER_ACTIVITY' : 'WING_ACTIVITY';
  requireThat(AWG_EVENT_FAMILIES.includes(eventFamily), 'UNMAPPED_DOWNSTREAM_CLASSIFICATION');
  return { decision: effect?.kind === 'THREAD_TRANSITION' ? 'CONTINUATION' : 'EVENT', eventFamily,
    participants, objective: { eventType: effect ? `ambient_${effect.operation.toLowerCase()}` : 'ambient_occurrence', summary: core.occurrence },
    objects, observations: [{ observerId: channel.observerId, access: channel.access, summary: core.occurrence }], informationClaims, thread };
}

export function evaluateSemanticCore(capture, packet, raw, { nowMs, currentCapture = capture, constraints = [] } = {}) {
  const started = performance.now(); let parsed = null, reconstructed = null, legacyValidation = null;
  const compatibilityExceptions = [];
  try {
    requireThat(fingerprint(capture) === fingerprint(currentCapture), 'STALE_CAPTURE');
    requireThat(isDeepStrictEqual(buildSemanticPacket(capture, { nowMs }), packet), 'STALE_OR_TAMPERED_PACKET');
    requireThat(typeof raw === 'string' && raw.length <= 16000, 'INVALID_RESPONSE_SIZE');
    parsed = JSON.parse(raw); exactKeys(parsed, FIELD_ORDER, 'INVALID_CORE_FIELDS');
    requireThat(isDeepStrictEqual(Object.keys(parsed), FIELD_ORDER), 'INVALID_PROPERTY_ORDER');
    requireThat(typeof parsed.occurrence === 'string' && parsed.occurrence.trim() === parsed.occurrence && parsed.occurrence.length > 0 && parsed.occurrence.length <= 300, 'INVALID_OCCURRENCE');
    requireThat(!/^(?:nothing (?:happens|of note)|no (?:event|occurrence|activity)\b|Cy (?:hears?|sees?) nothing\b)/i.test(parsed.occurrence), 'NO_CONCRETE_OCCURRENCE');
    const frame = packet.accessFrames.find(f => f.id === parsed.accessFrameId);
    requireThat(frame, 'UNAVAILABLE_ACCESS_FRAME');
    requireThat(parsed.effectChoiceId === null || packet.effectChoices.some(e => e.id === parsed.effectChoiceId), 'UNAVAILABLE_EFFECT');
    const effect = packet.effectChoices.find(e => e.id === parsed.effectChoiceId) || null;
    requireThat(Array.isArray(parsed.roles) && parsed.roles.length >= 1 && parsed.roles.length <= 6, 'INVALID_ROLES');
    const ids = new Set();
    for (const r of parsed.roles) {
      exactKeys(r, ['entityId', 'role'], 'INVALID_ROLE_FIELDS');
      requireThat(ROLE_KINDS.includes(r.role) && !ids.has(r.entityId), 'INVALID_OR_DUPLICATE_ROLE'); ids.add(r.entityId);
      const a = packet.actors.find(a => a.id === r.entityId);
      const entity = a || [...packet.objects, ...packet.threads].find(e => e.id === r.entityId);
      requireThat(entity || (r.entityId === 'UNIDENTIFIED' && r.role === 'ACTOR'), 'UNAVAILABLE_ENTITY');
      requireThat(!['ACTOR', 'ADDRESSEE'].includes(r.role) || a || r.entityId === 'UNIDENTIFIED', 'NON_ACTOR_ROLE');
    }
    const channel = packet.observationChannels.find(c => c.ref === frame.channelRef);
    const participants = unique(parsed.roles.filter(roleActive).filter(r => packet.actors.some(a => a.id === r.entityId)).map(r => r.entityId)
      .concat(channel.observerId === 'cy' ? ['cy'] : []));
    const presence = channel.observerId === 'cy' ? [{ actorId: 'cy', mode: 'SELF', sourceRef: null }] : [];
    const texts = [parsed.occurrence, ...constraints]; // Saved legacy prose is never silently discarded.
    requireThat(texts.every(t => typeof t === 'string'), 'INVALID_EXTRA_CONSTRAINT');
    reconstructed = { participants, observerId: channel.observerId, access: channel.access,
      originLocation: packet.origins.find(o => o.ref === frame.originRef).location, presence,
      sourceRefs: unique([packet.current.ref, frame.originRef, frame.channelRef,
        ...participants.map(id => `actor:${id}`),
        ...parsed.roles.filter(r => r.entityId !== 'UNIDENTIFIED').map(r => packet.actors.some(a => a.id === r.entityId) ? `actor:${r.entityId}`
          : packet.objects.some(o => o.id === r.entityId) ? `object:${r.entityId}` : `thread:${r.entityId}`)]) };
    const actualHistoryRefs = historyRefs(packet, texts, frame);
    checkRoleProse(packet, parsed, texts, frame, presence);
    checkScope(packet, parsed, texts, frame);
    checkProperty(packet, parsed, texts, effect, channel.access === 'CY_PARTIAL_HEARD');
    reconstructed.sourceRefs = unique([...reconstructed.sourceRefs, ...presence.map(e => e.sourceRef).filter(Boolean), ...actualHistoryRefs]);
    const proposal = encode(capture, packet, parsed, frame, effect, participants);
    const context = { nowMs, currentLocation: capture.currentLocation, plausibleCastIds: capture.plausibleCastIds, recentEvents: capture.recentWorldHistory };
    const candidate = materialiseAwgProposal(proposal, capture.worldSimulation, context);
    legacyValidation = validateAwgCandidate(candidate, capture.worldSimulation, context);
    const neutral = validateAwgCandidate({ ...copy(candidate), eventFamily: 'WING_ACTIVITY' }, capture.worldSimulation, context);
    const errors = unique([...legacyValidation.errors, ...neutral.errors.filter(e => e !== 'THREAD_TYPE_CONTRADICTION')]);
    if (frame.originRef === 'origin:cell-landing' && errors.includes('OBJECTIVE_LOCATION_CONTRADICTION'))
      compatibilityExceptions.push({ code: 'OBJECTIVE_LOCATION_CONTRADICTION', rule: 'CELL_LANDING_PARTIAL_HEARING' });
    // New role checks have already proved every non-participant cast mention is
    // explicitly MENTIONED_ONLY and quoted or governed by a topic cue. The old
    // validator cannot represent a name called by an unidentified voice.
    if (parsed.roles.some(r => r.role === 'MENTIONED_ONLY') && errors.includes('NAMED_CAST_NOT_PARTICIPANT'))
      compatibilityExceptions.push({ code: 'NAMED_CAST_NOT_PARTICIPANT', rule: 'EXPLICIT_MENTION_IS_NOT_PRESENCE' });
    const remaining = errors.filter(e => !compatibilityExceptions.some(x => x.code === e));
    requireThat(!remaining.length, `PRODUCTION_VALIDATION:${remaining.join(',')}`);
    return { valid: true, outcome: 'VALIDATED_NOT_APPLIED', parsed, reconstructed, proposal, candidate,
      legacyValidation, compatibilityExceptions, applied: false, checkMs: performance.now() - started };
  } catch (error) { return { valid: false, outcome: 'NO_WORLD_EVENT', reason: error.message,
    parsed, reconstructed, legacyValidation, compatibilityExceptions, applied: false, checkMs: performance.now() - started }; }
}

export async function runSemanticAttempt({ capture, nowMs, admitted, preflight, generate, signal,
  getCurrentCapture = () => capture, timeoutMs = AWG_TIMEOUT_MS } = {}) {
  const started = performance.now(), controller = new AbortController(); let timer, unlink;
  let calls = 0, contextPreflight = null;
  const result = (reason, extra = {}) => ({ reason, generateInvocations: calls, repairCalls: 0,
    replacementCalls: 0, elapsedMs: performance.now() - started, contextPreflight, applied: false, ...extra });
  if (!admitted) return result('NOT_ADMITTED');
  try {
    requireThat(!signal?.aborted, 'CANCELLED');
    requireThat(typeof generate === 'function' && typeof preflight === 'function', 'TOKEN_PREFLIGHT_REQUIRED');
    requireThat(Number.isFinite(timeoutMs) && timeoutMs > 0 && timeoutMs <= AWG_TIMEOUT_MS, 'INVALID_TIMEOUT');
    const prepared = prepareSemanticCore(capture, { nowMs }), frozen = fingerprint(capture), requestHash = fingerprint(prepared.request);
    requireThat(fingerprint(await getCurrentCapture()) === frozen, 'STALE_CAPTURE');
    contextPreflight = validateContextReceipt(prepared.request, await preflight(copy(prepared.request)));
    requireThat(fingerprint(await getCurrentCapture()) === frozen && fingerprint(capture) === frozen, 'STALE_CAPTURE');
    const deadline = new Promise((_, reject) => {
      const abort = reason => { controller.abort(reason); reject(new Error(reason)); };
      timer = setTimeout(() => abort('TIMEOUT'), timeoutMs);
      const onAbort = () => abort('CANCELLED'); signal?.addEventListener('abort', onAbort, { once: true });
      unlink = () => signal?.removeEventListener('abort', onAbort); if (signal?.aborted) onAbort();
    });
    const raw = await Promise.race([Promise.resolve().then(() => {
      requireThat(!controller.signal.aborted, 'CANCELLED'); calls++;
      return generate(copy(prepared.wire), { signal: controller.signal });
    }), deadline]);
    requireThat(!controller.signal.aborted, 'CANCELLED');
    requireThat(fingerprint(capture) === frozen && fingerprint(prepared.request) === requestHash, 'CAPTURE_OR_REQUEST_MUTATED');
    const currentCapture = await Promise.race([Promise.resolve().then(getCurrentCapture), deadline]);
    requireThat(!controller.signal.aborted, 'CANCELLED');
    const evaluation = evaluateSemanticCore(capture, prepared.packet, raw, { nowMs, currentCapture });
    return result(evaluation.reason || null, { raw, evaluation });
  } catch (error) { return result(error.message); } finally { clearTimeout(timer); unlink?.(); }
}
