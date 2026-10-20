// incidents.js - the incident ledger.
// MODEL STATUS: this is a bounded fictional-world continuity ledger, not a
// psychological memory model. The live runner supplies no relationship state
// when building incidents; older grudge helpers remain compatibility code.
// Ledger size and text-length limits are engineering constraints.
//
// Ambient events used to move only numbers, so the model had a mood but no
// SUBSTANCE - nothing concrete to write about. This turns every ambient / social
// / officer happening into a specific, mundane INCIDENT: a time, a person, a
// thing. A rolling ledger of the last ~12 rides on the vitals object (so it
// persists with state). Its notes are labelled by evidence class in prompts;
// ambient texture is never an authoritative object-state transition.
//
// An incident record is { ts, actor, verb, object, detail, resolved:false };
// some carry { open, threadKind, subject }. Factual object custody also carries
// sourceEventId and revisioned objectEvidence.

import { BY_KEY, CAST, OFFICERS, topGrudge } from './cast.js';
import { worldEntityRevision } from './world-mirror.js';
import { createHash } from 'node:crypto';

const LEDGER_MAX = 12;

const INMATE_KEYS = CAST.map((c) => c.key);

const pick = (arr, rnd = Math.random) => arr[Math.floor(rnd() * arr.length)];

// Full display name for a cast member (inmate first name, or officer title+surname).
function fullName(key) {
  return (BY_KEY[key] || {}).name || key;
}
// Bare surname for an officer (drop the title) - the register the wing uses.
function bareName(key) {
  return fullName(key).replace(/^(Mr|Miss|Mrs|Ms|Dr)\s+/, '');
}
// Officers are sometimes named bare ('Locke', 'Sweep'), sometimes titled.
function officerName(key, rnd = Math.random) {
  return rnd() < 0.5 ? fullName(key) : bareName(key);
}

// LEGACY / PROVISIONAL compatibility helper. The live runner passes an empty
// relations object, so its result is random rather than psychology-weighted.
function salientInmate(relations, rnd = Math.random) {
  const t = topGrudge(relations || {});
  if (t && INMATE_KEYS.includes(t.c.key) && t.r.grudge > 0.35 && rnd() < 0.6) return t.c.key;
  return pick(INMATE_KEYS, rnd);
}

const NIGHT_TIMES = ['02:40', '03:10', '01:55', '04:20', 'half three', 'gone two', '05:15'];
const DAY_TIMES = ['half nine', 'gone eleven', 'dinner time', 'after lunch', 'mid afternoon', 'before tea'];

// ---- per-kind incident builders ------------------------------------------
//
// Each returns the four required fields (actor/verb/object/detail may be '') and
// optionally open/threadKind/subject. ctx: { rnd, phase, mins, relations,
// actorKey, slight, evType, sub }.

const BUILDERS = {
  // A scheduled prison routine with an outcome already selected by the
  // environment engine. Keep its concrete wording intact in the memory ledger.
  environment(ctx) {
    return { actor: '', verb: '', object: '', detail: ctx.text || 'the routine moved on' };
  },

  // an inmate did something to him. run.js supplies actorKey + the slight text.
  social(ctx) {
    const name = fullName(ctx.actorKey);
    const where = pick(['on association', 'at the servery', 'in the queue', 'on the landing', pick(DAY_TIMES, ctx.rnd)], ctx.rnd);
    const detail = pick(['and knew it', 'said nothing after', 'third time now', 'in front of everyone', 'looked right at you'], ctx.rnd);
    return { actor: name, verb: ctx.slight || 'started something', object: ctx.rnd() < 0.5 ? where : '', detail };
  },

  // an officer acted on him through the machinery of the place.
  officer(ctx) {
    const name = officerName(ctx.actorKey, ctx.rnd);
    const detail = pick(['no reason given', 'clipboard out', 'did not look at you', 'dead on time', 'and logged it'], ctx.rnd);
    const inc = { actor: name, verb: ctx.slight || 'had a word', object: '', detail };
    if (ctx.evType === 'refusal') Object.assign(inc, { open: true, threadKind: 'owed', subject: name });
    return inc;
  },

  // the small daily indignities of the tray.
  trivial(ctx) {
    if (ctx.sub === 'no_eggs') {
      return { actor: 'no eggs on the tray', verb: '', object: 'again', detail: pick(['third morning running', 'powder as usual', 'nobody said why'], ctx.rnd) };
    }
    // cold_tea and the fallback
    return { actor: pick(['the tea', 'the tray'], ctx.rnd), verb: 'came cold', object: '', detail: pick(['third time this week', 'again', 'stone cold', 'and the toast with it'], ctx.rnd) };
  },

  // a shout through the door in the night.
  noise(ctx) {
    const who = ctx.rnd() < 0.6 ? fullName(pick(INMATE_KEYS, ctx.rnd)) : 'someone down the ones';
    const detail = pick(['nobody answered', 'same word over and over', 'then nothing', 'all night it felt like'], ctx.rnd);
    return { actor: who, verb: 'shouted through the door', object: 'at ' + pick(NIGHT_TIMES, ctx.rnd), detail };
  },

  // wing noise: a specific thing that went off on the wing (run.js supplies the
  // line). Pure texture - it lands in the ledger as a real, dated thing but moves
  // no numbers on its own.
  wing(ctx) {
    return { actor: '', verb: '', object: '', detail: ctx.line || 'a noise on the wing' };
  },

  // something half-heard down the wing.
  overheard(ctx) {
    const detail = pick(['could not make it out', 'your number in it maybe', 'then it stopped', 'low, so you would not hear'], ctx.rnd);
    const actor = pick(['two voices at the desk', 'someone two cells along', 'the screws by the gate'], ctx.rnd);
    return { actor, verb: 'talking low', object: '', detail };
  },

  // a deviation from the timetable. run.js supplies sub.
  regime(ctx) {
    if (ctx.sub === 'assoc_cancelled') {
      return { actor: 'association', verb: 'cancelled', object: '', detail: pick(['staff shortage they said', 'no reason given', 'banged up through it']) };
    }
    if (ctx.sub === 'lockdown') {
      return { actor: 'the whole wing', verb: 'locked down', object: '', detail: pick(['no one saying why', 'since dinner', 'doors not off at all'], ctx.rnd) };
    }
    // late_unlock
    const who = officerName(ctx.rnd() < 0.5 ? 'locke' : 'keyes', ctx.rnd);
    const n = pick([15, 20, 25, 40], ctx.rnd);
    return { actor: who, verb: 'unlocked', object: n + ' minutes late', detail: 'no reason given' };
  },

  // standalone texture: no numbers moved, just the grain of the day. Weighted a
  // little by phase (night favours the cell, day favours people).
  texture(ctx) {
    const night = ctx.phase === 'lights_out' || ctx.phase === 'bangup_night';
    const pool = night ? TEXTURE_NIGHT : TEXTURE_DAY;
    const both = TEXTURE_ANY.concat(pool);
    return pick(both, ctx.rnd)(ctx);
  },
};

// texture builders that suit any time of day
const TEXTURE_ANY = [
  (c) => {
    const n = fullName(salientInmate(c.relations, c.rnd));
    return { actor: '', verb: '', object: '', detail: `still nothing back from ${n}`, open: true, threadKind: 'reply', subject: n };
  },
  (c) => ({ actor: officerName('bailey', c.rnd), verb: 'said your name properly', object: '', detail: 'for once' }),
  () => ({ actor: '', verb: '', object: '', detail: 'you wonder whether your things are where you left them' }),
  (c) => {
    const n = fullName(pick(INMATE_KEYS, c.rnd));
    return { actor: n, verb: 'promised to pass it on', object: '', detail: 'that was two days ago', open: true, threadKind: 'promise', subject: n };
  },
  (c) => ({ actor: 'word of a transfer', verb: '', object: '', detail: 'nothing since', open: true, threadKind: 'transfer', subject: 'a move' }),
];

// texture builders that read as daytime, among people
const TEXTURE_DAY = [
  (c) => ({ actor: officerName('proctor', c.rnd), verb: 'writing something down', object: '', detail: 'about you, you think' }),
  (c) => { const n = fullName(pick(INMATE_KEYS, c.rnd)); return { actor: n, verb: 'blanked you', object: 'on the landing', detail: pick(['clean', 'like you were not there'], c.rnd) }; },
  (c) => ({ actor: 'the canteen sheet', verb: 'short again', object: '', detail: 'half of it crossed off' }),
  (c) => ({ actor: 'the phone queue', verb: '', object: '', detail: 'never got to the front' }),
];

// texture builders that read as night, alone in the cell
const TEXTURE_NIGHT = [
  (c) => ({ actor: 'the light', verb: '', object: '', detail: 'buzzing again, the same note' }),
  (c) => ({ actor: '', verb: '', object: '', detail: 'counted the tiles, forty one to the door, same as yesterday' }),
  (c) => ({ actor: 'the pipe', verb: 'knocking', object: '', detail: pick(['twice, then nothing', 'someone answering back maybe'], c.rnd) }),
  (c) => ({ actor: 'the wall', verb: 'cold', object: 'through the blanket', detail: 'same as every night' }),
];

// ---- open-thread invariant ------------------------------------------------
//
// STILL OPEN must mean a continuing world situation whose later AUTHORITATIVE
// evidence can progress or resolve it - not merely that a line of prose sounded
// like a loose end. An incident may therefore carry durable `open:true` status
// only when both hold:
//   1. its threadKind is one a live resolver actually services, and
//   2. its evidence is authoritative (a recorded event or a world transition),
//      never ambient texture.
// The serviced kinds are:
//   - object_custody: minted only by makeObjectTransitionIncident from a
//     revisioned world transition, and resolved by reconcileObjectIncidentThreads
//     against the current authoritative object state;
//   - reply/message/mail: an awaiting-word-from-outside wait, cleared by
//     resolveThreads when an inbound postcard arrives.
// Ambient-texture rumour/promise/transfer colour and the officer 'owed' refusal
// have no resolution machinery at all: left open they would read as "unfinished"
// only until they aged out of the rolling ledger. They stay in the ledger as
// ordinary impressions - the prose and its evidence class are preserved - but
// they never claim open causal status.
const RESOLVABLE_THREAD_KINDS = new Set(['reply', 'message', 'mail']);
const AUTHORITATIVE_EVIDENCE = new Set(['OBSERVED_EVENT', 'WORLD_TRANSITION']);

export function isAuthoritativeOpenThread(inc) {
  if (!inc || !inc.open || inc.resolved) return false;
  if (inc.threadKind === 'object_custody') {
    return inc.evidenceClass === 'WORLD_TRANSITION' && !!inc.objectEvidence;
  }
  return RESOLVABLE_THREAD_KINDS.has(inc.threadKind)
    && AUTHORITATIVE_EVIDENCE.has(inc.evidenceClass);
}

// ---- ledger ---------------------------------------------------------------

export function initLedger() {
  return [];
}

// Fill in any missing shape from a persisted ledger, and demote any persisted
// open thread that does not satisfy the open-thread invariant (legacy
// ambient-texture reply/promise/transfer threads, officer 'owed'). The incident
// line and its evidence class are preserved as an ordinary impression; only the
// false open/thread status is dropped. Authoritative threads (object custody, a
// live awaiting-word wait) are left untouched. This corrects pre-existing live
// phantoms canonically at load time, with no history erased.
export function reconcileLedger(saved) {
  if (!Array.isArray(saved)) return initLedger();
  return saved
    .filter((x) => x && typeof x === 'object')
    .slice(-LEDGER_MAX)
    .map((x) => {
      const inc = { resolved: false, evidenceClass: 'LEGACY_UNVERIFIED', ...x };
      // Demote only the false open status; keep threadKind/subject and the whole
      // record so provenance is intact and classification-dependent rendering
      // (e.g. the legacy `taken` sanitisation in incidentsDirective) still works.
      // Every open-gated effect - STILL OPEN rendering, journal salience - keys on
      // `open`, so clearing it is sufficient to retire a phantom thread.
      if (inc.open && !inc.resolved && !isAuthoritativeOpenThread(inc)) {
        delete inc.open;
      }
      return inc;
    });
}

// Build an incident of `kind` from templates. Returns the record WITHOUT a ts
// (run.js stamps it on push). Never throws on an unknown kind.
export function makeIncident(kind, ctx = {}) {
  const build = BUILDERS[kind] || BUILDERS.texture;
  const c = { rnd: Math.random, relations: {}, ...ctx };
  const rec = build(c) || {};
  const evidenceClass = ctx.environmentEventId ? 'OBSERVED_EVENT'
    : kind === 'texture' ? 'AMBIENT_TEXTURE' : 'OBSERVED_AMBIGUOUS';
  const threadKind = rec.threadKind || (rec.open ? 'thread' : null);
  // Promote to a durable open thread only when it names a situation the world can
  // actually resolve (see isAuthoritativeOpenThread). object_custody is minted
  // solely by makeObjectTransitionIncident, never here.
  const canOpen = !!rec.open
    && RESOLVABLE_THREAD_KINDS.has(threadKind)
    && AUTHORITATIVE_EVIDENCE.has(evidenceClass);
  return {
    actor: rec.actor || '',
    verb: rec.verb || '',
    object: rec.object || '',
    detail: rec.detail || '',
    resolved: false,
    evidenceClass,
    ...(ctx.environmentEventId ? { sourceEventId: ctx.environmentEventId } : {}),
    ...(canOpen ? { open: true, threadKind, subject: rec.subject || '' } : {}),
  };
}

// Object facts come from a revisioned world transition, never from a line of
// ambient prose or an officer search that merely inspected an item.
export function makeObjectTransitionIncident({ before, after, sourceEventId, actor, observedByCy } = {}) {
  if (!observedByCy || !before || !after || before.id !== after.id || !sourceEventId) return null;
  let previous;
  let current;
  try {
    previous = worldEntityRevision(before);
    current = worldEntityRevision(after);
  } catch {
    return null;
  }
  if (current.revision !== previous.revision + 1
    || current.transitionId === previous.transitionId) return null;
  const changed = ['status', 'holderId', 'location'].some((field) => before[field] !== after[field]);
  if (!changed) return null;
  const confiscated = before.status !== 'CONFISCATED' && after.status === 'CONFISCATED';
  const label = after.type || before.type || 'item';
  return {
    actor: actor || 'an officer', verb: confiscated ? 'confiscated' : 'changed custody of',
    object: label, detail: confiscated ? 'the item went into officer custody' : 'the item changed holder or location',
    resolved: false, evidenceClass: 'WORLD_TRANSITION', sourceEventId,
    objectEvidence: {
      id: after.id, revision: current.revision, transitionId: current.transitionId,
      status: after.status, holderId: after.holderId ?? null, location: after.location ?? null,
    },
    ...(confiscated ? { open: true, threadKind: 'object_custody', subject: after.id } : {}),
  };
}

function currentObjectCustody(inc, objects) {
  const evidence = inc.objectEvidence;
  const object = Array.isArray(objects) && evidence
    ? objects.find((item) => item.id === evidence.id) : null;
  return !!object && object.status === 'CONFISCATED'
    && object.holderId === evidence.holderId
    && object.location === evidence.location
    && Number.isSafeInteger(object.revision)
    && (object.revision > evidence.revision
      || (object.revision === evidence.revision
        && object.transitionId === evidence.transitionId));
}

// Resolution is derived from the current world object, not from ledger prose.
export function reconcileObjectIncidentThreads(ledger, objects) {
  if (!Array.isArray(ledger) || !Array.isArray(objects)) return 0;
  let resolved = 0;
  for (const inc of ledger) {
    if (inc.open && !inc.resolved && inc.threadKind === 'object_custody'
      && !currentObjectCustody(inc, objects)) {
      inc.resolved = true;
      resolved++;
    }
  }
  return resolved;
}

// Push an incident onto the ledger, capped at LEDGER_MAX (oldest dropped). Skips
// an incident whose rendered line duplicates the most recent, so the same slot
// fill does not land twice running.
export function pushIncident(ledger, inc) {
  if (!Array.isArray(ledger) || !inc) return ledger;
  if (inc.objectEvidence && ledger.some((item) =>
    item.objectEvidence?.transitionId === inc.objectEvidence.transitionId)) return ledger;
  const line = incidentLine(inc);
  const last = ledger[ledger.length - 1];
  if (last && incidentLine(last) === line
    && (!inc.objectEvidence || last.objectEvidence?.transitionId === inc.objectEvidence.transitionId)) {
    return ledger;
  }
  ledger.push(inc);
  while (ledger.length > LEDGER_MAX) ledger.shift();
  return ledger;
}

// Render an incident as one natural line in Cy's register.
export function incidentLine(inc) {
  if (!inc) return '';
  const head = [inc.actor, inc.verb, inc.object].map((s) => (s || '').trim()).filter(Boolean).join(' ');
  const detail = (inc.detail || '').trim();
  if (!head) return detail;
  return detail ? `${head}, ${detail}` : head;
}

// Mark open threads of the given kinds resolved (e.g. a reply/mail arriving
// clears a 'reply'/'message'/'mail' wait). Returns how many were closed.
export function resolveThreads(ledger, kinds) {
  if (!Array.isArray(ledger)) return 0;
  const set = new Set(kinds);
  let n = 0;
  for (const inc of ledger) {
    if (inc.open && !inc.resolved && set.has(inc.threadKind)) {
      inc.resolved = true;
      n++;
    }
  }
  return n;
}

// The dangling ledger threads and a factual long mail silence. A legacy
// optional relations argument remains for non-live compatibility tools; the
// live caller omits it. Deduped by kind+subject, newest first.
export function unresolvedThreads(ledger, { relations = {}, mailWaitMs = 0, objects = [] } = {}) {
  const out = [];
  const seen = new Set();
  const open = (Array.isArray(ledger) ? ledger : []).filter((i) => i.open && !i.resolved);
  for (let i = open.length - 1; i >= 0 && out.length < 3; i--) {
    const inc = open[i];
    // Legacy `taken` entries had no object ID or transition. They are not
    // evidence that an object left Cy's possession.
    if (inc.threadKind === 'taken' || (inc.threadKind === 'object_custody'
      && (inc.evidenceClass !== 'WORLD_TRANSITION' || !inc.objectEvidence))) continue;
    if (inc.threadKind === 'object_custody' && !currentObjectCustody(inc, objects)) continue;
    // normalise the subject (drop any title) so 'Sweep' and 'Mr Sweep' collapse
    const subj = (inc.subject || '').replace(/^(Mr|Miss|Mrs|Ms|Dr)\s+/, '').toLowerCase();
    const key = inc.threadKind + '|' + subj;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(threadLine(inc));
  }
  const t = topGrudge(relations);
  if (t && t.r.grudge > 0.7) out.push(`the thing with ${t.c.name} is still not squared`);
  if (mailWaitMs > 24 * 3600 * 1000) {
    const days = Math.floor(mailWaitMs / (24 * 3600 * 1000));
    out.push(`still no post${days >= 2 ? ', ' + days + ' days now' : ''}`);
  }
  return out;
}

function threadLine(inc) {
  const who = inc.subject || 'someone';
  switch (inc.threadKind) {
    case 'reply': return `still nothing back from ${who}`;
    case 'object_custody': return `the confiscated ${inc.object || 'item'} remains in officer custody`;
    case 'promise': return `${who} promised and has not`;
    case 'owed': return `${who} still owes you the thing`;
    case 'transfer': return `word of a move, and nothing since`;
    case 'message': return `the message to ${who} went and stayed gone`;
    default: return incidentLine(inc);
  }
}

// The prompt block: 3-5 recent incidents with explicit evidence labels, plus
// unresolved threads. Unverified legacy object claims remain in the historical
// ledger but are not rendered as facts or durable open object-state threads.
export function incidentsDirective(ledger, opts = {}) {
  const rnd = opts.rnd || Math.random;
  const list = Array.isArray(ledger) ? ledger : [];
  if (!list.length) return '';
  const n = Math.min(list.length, 3 + Math.floor(rnd() * 3)); // 3-5
  const recent = list.slice(-n).map((inc) => {
    // Preserve the historical record but never restate an unverified object
    // loss as a fresh factual assertion in Cy's prompt.
    if (inc.threadKind === 'taken' && !inc.objectEvidence) {
      return '- unverified concern about belongings; no object movement is recorded';
    }
    const evidence = inc.evidenceClass === 'WORLD_TRANSITION' ? 'verified world transition'
      : inc.evidenceClass === 'OBSERVED_EVENT' ? 'recorded event'
        : 'unverified impression';
    return `- ${evidence}: ${incidentLine(inc)}`;
  }).filter((l) => l.trim().length > 2);
  if (!recent.length) return '';
  const threads = unresolvedThreads(list, opts);
  // The incidents themselves are the whole value here. The header stays a bare label
  // and the how-to-use-it instruction is gone - it is a constant, so it lives in the
  // cached Zone A ('MATERIAL. ... write FROM them, not about them ...') and is paid
  // once instead of re-evaluated in this volatile block every time the ledger moves.
  const lines = ['INCIDENT NOTES (impressions are not proof that an object moved):', ...recent];
  if (threads.length) {
    lines.push('STILL OPEN:');
    for (const t of threads) lines.push('- ' + t);
  }
  return lines.join('\n');
}

// Journal freshness is a projection of world evidence, never of generated prose.
// Receipts live in the existing checkpoint, contain hashes only, and are committed
// only after writing publishes. They are not topic cooldowns: a material change
// is eligible immediately, including a new real encounter/search/meal episode.
export const JOURNAL_SUBJECT_RECEIPTS = 128;
const VOLATILE_FACT_KEYS = new Set([
  'timestamp', 'occurred_at', 'occurredAt', 'created_at', 'updated_at',
  'start_at', 'end_at', 'onset_at', 'resolved_at', 'duration_ms', 'durationMs',
  'elapsedMs', 'elapsed_ms', 'minutesAgo', 'minutes_since', 'observation_count',
  'observationGapCount', 'repeat_count', 'occurrence_count', 'linked_event_ids',
  'previous_event_ids', 'schema', 'version', 'misheard',
  'sourceEventId', 'source_event_id', 'environment_event_id', 'event_id',
  'elapsedMinutes', 'elapsed_minutes', 'lastObservedAtMs',
]);
function materialFacts(value) {
  if (Array.isArray(value)) return value.map(materialFacts).filter((v) => v != null);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (VOLATILE_FACT_KEYS.has(key)) continue;
      const v = materialFacts(value[key]);
      if (v != null && (typeof v !== 'object' || Object.keys(v).length)) out[key] = v;
    }
    return Object.keys(out).length ? out : null;
  }
  if (value == null || value === '' || /^unknown$/i.test(String(value))) return null;
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLowerCase() : value;
}
function subjectKey(facts) {
  return createHash('sha256').update(JSON.stringify(materialFacts(facts))).digest('hex');
}
export function journalSubjectReceipts(values) {
  const keys = new Set();
  for (const key of Array.isArray(values) ? values : []) {
    if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) continue;
    keys.delete(key);
    keys.add(key);
  }
  return [...keys].slice(-JOURNAL_SUBJECT_RECEIPTS);
}

// Called at the existing canonical-event capture boundary, not on context prose.
// Compare what the source event says happened, not its random incident paraphrase.
// An ambiguous hearing remains qualified; its hidden objective wording is used
// only for an equality fingerprint, never substituted for what Cy heard.
export function journalSubjectFromWorldRecord(record, { cyObserved = false } = {}) {
  const event = record && record.world_event;
  const world = event && event.world;
  const observation = record && record.observation;
  if (!cyObserved || !event?.id || !event.event_type || !world || !observation) return null;
  if (/^(?:CY_EXPRESSION|DREAM_EXPRESSION|journal|recent_expression)$/i.test(event.event_type)) return null;
  if (['postcard', 'postcard_with_image', 'postcard_reply'].includes(event.event_type)) {
    // Mail text is sender-scoped. This selector must not bypass the existing
    // retrieval/privacy interface by copying a private canonical source body.
    return { sourceEventId: event.id, ts: event.timestamp,
      materialKey: subjectKey({ correspondence: event.event_type,
        episode: world.social?.episode_id || event.id }),
      line: event.event_type === 'postcard_reply' ? 'Cy sent a reply to a postcard' : 'a postcard arrived',
      rank: 1 };
  }
  const description = world.context?.description || observation.summary;
  const summary = observation.summary || description;
  if (!summary || !Number.isFinite(Date.parse(event.timestamp))) return null;
  // For typed meals, the actual meal identity and offering/receipt/intake facts
  // carry the development. A changing elapsed-time caption adds no new fact.
  const typedMeal = ['meal', 'meal_expected'].includes(event.archetype_id)
    && !!world.physical?.food?.meal_id;
  const facts = {
    type: event.event_type,
    directConfirmation: ['direct', 'seen', 'read'].includes(observation.modality)
      && observation.certainty === 'certain',
    participants: world.participants,
    location: world.context?.location,
    associatedEntities: [...(world.context?.associated_entities || [])].sort(),
    description: typedMeal ? null : description,
    observed: observation.observed_facts,
    physical: world.physical,
    social: world.social,
    movement: world.movement,
    search: world.search_episode,
    instrumental: world.instrumental,
    opportunity: world.action_opportunity,
    situation: { resolution: world.situation?.resolution_status,
      deprivation: world.situation?.deprivation_outcome },
  };
  const uncertain = observation.certainty === 'uncertain';
  return {
    sourceEventId: event.id, ts: event.timestamp,
    materialKey: subjectKey(facts),
    line: uncertain ? `half-heard, uncertain: ${summary}` : summary,
    rank: world.search_episode?.property_result
      || world.instrumental?.consequence_id ? 2 : uncertain ? 0 : 1,
  };
}

export function selectJournalTurn(ledger, {
  lastJournalAtMs = 0, worldEvents = [], seenKeys = [], nowMs = Date.now(),
} = {}) {
  const since = Number(lastJournalAtMs) || 0;
  const subjects = (Array.isArray(worldEvents) ? worldEvents : [])
    .filter((event) => event?.cyObserved === true && event.journalSubject?.sourceEventId === event.id)
    .map((event) => event.journalSubject);
  // A revisioned custody transition is also authoritative even if its parent
  // event has fallen out of the short recent-world ring. No other ledger prose
  // can certify its own freshness, including AMBIENT_TEXTURE or prior writing.
  for (const inc of Array.isArray(ledger) ? ledger : []) {
    if (inc?.evidenceClass !== 'WORLD_TRANSITION' || !inc.sourceEventId
        || !inc.objectEvidence?.transitionId || !Number.isSafeInteger(inc.objectEvidence.revision)) continue;
    subjects.push({ sourceEventId: inc.sourceEventId, ts: inc.ts,
      materialKey: subjectKey({ custody: inc.objectEvidence }), line: incidentLine(inc), rank: 3 });
  }
  const valid = subjects.filter((s) => s.line && /^[a-f0-9]{64}$/.test(s.materialKey)
    && Number.isFinite(Date.parse(s.ts)) && Date.parse(s.ts) <= nowMs);
  // Seed from facts already available before the last published entry, so an
  // upgrade does not declare the entire retained history fresh.
  const known = new Set(journalSubjectReceipts(seenKeys));
  for (const s of valid) if (Date.parse(s.ts) <= since) known.add(s.materialKey);
  let pick = null;
  for (const s of valid) {
    if (Date.parse(s.ts) <= since || known.has(s.materialKey)) continue;
    if (!pick || s.rank > pick.rank
        || (s.rank === pick.rank && Date.parse(s.ts) >= Date.parse(pick.ts))) pick = s;
  }
  return {
    freshLine: pick?.line || '', nothingNew: !pick,
    sourceEventId: pick?.sourceEventId || null,
    reason: pick ? 'MATERIAL_WORLD_DEVELOPMENT' : 'NO_MATERIAL_WORLD_DEVELOPMENT',
    seenKeys: journalSubjectReceipts([...known, ...valid.map((s) => s.materialKey)]),
  };
}
