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

// ---- ledger ---------------------------------------------------------------

export function initLedger() {
  return [];
}

// Fill in any missing shape from a persisted ledger.
export function reconcileLedger(saved) {
  if (!Array.isArray(saved)) return initLedger();
  return saved
    .filter((x) => x && typeof x === 'object')
    .slice(-LEDGER_MAX)
    .map((x) => ({ resolved: false, evidenceClass: 'LEGACY_UNVERIFIED', ...x }));
}

// Build an incident of `kind` from templates. Returns the record WITHOUT a ts
// (run.js stamps it on push). Never throws on an unknown kind.
export function makeIncident(kind, ctx = {}) {
  const build = BUILDERS[kind] || BUILDERS.texture;
  const c = { rnd: Math.random, relations: {}, ...ctx };
  const rec = build(c) || {};
  return {
    actor: rec.actor || '',
    verb: rec.verb || '',
    object: rec.object || '',
    detail: rec.detail || '',
    resolved: false,
    evidenceClass: ctx.environmentEventId ? 'OBSERVED_EVENT'
      : kind === 'texture' ? 'AMBIENT_TEXTURE' : 'OBSERVED_AMBIGUOUS',
    ...(ctx.environmentEventId ? { sourceEventId: ctx.environmentEventId } : {}),
    ...(rec.open && !['taken', 'object_custody'].includes(rec.threadKind)
      ? { open: true, threadKind: rec.threadKind || 'thread', subject: rec.subject || '' } : {}),
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
