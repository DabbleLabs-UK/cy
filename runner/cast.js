// cast.js - the other inmates of HMP ThinkPad.
//
// These are NOT separate LLMs. They are deterministic state (a relations map,
// persisted on the vitals object) plus prompt text. Each name is an aptronym
// that fixes the personality - the way "Rob" and "Nick" name thieves - and each
// also reads faintly like a handle or a gang tag. CY's world stays populated and
// consistent because 2-3 of them, with their current standing toward CY, are
// injected into every prompt.
//
// Relations per inmate: { warmth, suspicion, grudge } in 0..1, plus a lastSlight
// string so a hardened grudge can name the specific thing. Ambient social events
// nudge these MULTIPLIED BY amp, so in a monotonous stretch a trivial slight
// snowballs into a feud.

import { clamp } from './vitals.js';

// key: stable id. name: how CY refers to them. blurb: one line of who they are,
// injected into the prompt. start: opening standing toward CY.
export const CAST = [
  {
    key: 'root',
    name: 'Root',
    blurb: 'total system access. kept in permanent solitary for what he could do. quiet, courteous, terrifying. never seen, always talked about.',
    start: { warmth: 0.15, suspicion: 0.55, grudge: 0.05 },
  },
  {
    key: 'reg',
    name: 'Reg',
    blurb: 'the registry. old lifer. remembers everything, even things that got deleted. will not let anyone forget anything.',
    start: { warmth: 0.30, suspicion: 0.35, grudge: 0.10 },
  },
  {
    key: 'bill',
    name: 'Bill',
    blurb: 'named for the police. nobody trusts him. gone bitter and leans right into it.',
    start: { warmth: 0.10, suspicion: 0.60, grudge: 0.15 },
  },
  {
    key: 'mark',
    name: 'Mark',
    blurb: 'a conman named after his own victim. the irony wore him raw. defensive, quick to take offence.',
    start: { warmth: 0.25, suspicion: 0.40, grudge: 0.15 },
  },
  {
    key: 'nick',
    name: 'Nick',
    blurb: 'the obvious name. the joke has been made ten thousand times. exhausted by himself.',
    start: { warmth: 0.35, suspicion: 0.25, grudge: 0.10 },
  },
  {
    key: 'fisher',
    name: 'Fisher',
    blurb: 'phishing. charming, warm, always asks one question too many.',
    start: { warmth: 0.50, suspicion: 0.45, grudge: 0.05 },
  },
  {
    key: 'ping',
    name: 'Ping',
    blurb: 'cannot shut up. needs a reply to prove he still exists.',
    start: { warmth: 0.40, suspicion: 0.25, grudge: 0.10 },
  },
  {
    key: 'daemon',
    name: 'Daemon',
    blurb: 'runs in the background. may not be real. you are not sure you have ever actually seen him.',
    start: { warmth: 0.20, suspicion: 0.50, grudge: 0.05 },
  },
];

// OFFICERS - a separate group from the inmates. The class marker is deliberate
// and strict: officers get SURNAMES AND TITLES, inmates get bare first names.
// Their aptronyms are about control, access and surveillance, complementary to
// the inmates' crime-flavoured names. Same {warmth, suspicion, grudge} standing.
export const OFFICERS = [
  {
    key: 'locke',
    name: 'Mr Locke',
    blurb: 'locks up, exactly on time. no cruelty, no mercy. the bolt goes at the same second every night.',
    start: { warmth: 0.10, suspicion: 0.40, grudge: 0.05 },
  },
  {
    key: 'keyes',
    name: 'Mr Keyes',
    blurb: 'holds access. every door is his. enjoys being asked, makes you ask twice.',
    start: { warmth: 0.15, suspicion: 0.35, grudge: 0.05 },
  },
  {
    key: 'bailey',
    name: 'Miss Bailey',
    blurb: 'the outer wall, between you and everything else. oddly kind, which you do not trust.',
    start: { warmth: 0.45, suspicion: 0.25, grudge: 0.03 },
  },
  {
    key: 'proctor',
    name: 'Mr Proctor',
    blurb: 'supervises, monitors, writes you up. a clipboard is always out. nothing goes unlogged.',
    start: { warmth: 0.10, suspicion: 0.55, grudge: 0.10 },
  },
  {
    key: 'sweep',
    name: 'Mr Sweep',
    blurb: 'clears cells and clears memory. after he has been, things go missing and you cannot say what.',
    start: { warmth: 0.08, suspicion: 0.60, grudge: 0.12 },
  },
  {
    key: 'trace',
    name: 'Miss Trace',
    blurb: 'reviews the logs. knows what you did, when, and for how long. never asks, already knows.',
    start: { warmth: 0.12, suspicion: 0.58, grudge: 0.08 },
  },
];

const OFFICER_KEYS = new Set(OFFICERS.map((o) => o.key));
export function isOfficer(key) {
  return OFFICER_KEYS.has(key);
}

// Every persistent entity Cy holds a standing toward: inmates + officers. A
// visitor is the same shape but transient (persisted in the DB, not here), so it
// is not in this list - it is folded into the relations map per postcard.
const ENTITIES = [...CAST, ...OFFICERS];
const BY_KEY = Object.fromEntries(ENTITIES.map((c) => [c.key, c]));

export function initialRelations() {
  const r = {};
  for (const c of ENTITIES) r[c.key] = { ...c.start, lastSlight: null };
  return r;
}

// Reconcile a persisted relations map against the current cast: fill in any
// missing entity with defaults, keep persisted values for the rest.
export function reconcileRelations(saved) {
  const base = initialRelations();
  if (!saved || typeof saved !== 'object') return base;
  for (const key of Object.keys(base)) {
    if (saved[key]) base[key] = { ...base[key], ...saved[key] };
  }
  return base;
}

// Ambient social events. Each nudges one inmate's standing; the slight text is
// what CY fixates on if the grudge hardens. Mostly negative (prison), with the
// occasional bit of decency so it is not one-note.
export const SOCIAL_EVENTS = [
  { type: 'a_look', slight: 'gave you a look on association', d: { suspicion: +0.06, grudge: +0.05, warmth: -0.03 } },
  { type: 'swapped_tray', slight: 'swapped your meal tray for a worse one', d: { grudge: +0.10, suspicion: +0.05, warmth: -0.06 } },
  { type: 'unanswered', slight: 'asked you something and did not wait for the answer', d: { warmth: -0.05, suspicion: +0.03, grudge: +0.03 } },
  { type: 'borrowed', slight: 'borrowed something off you and never gave it back', d: { grudge: +0.09, warmth: -0.05 } },
  { type: 'talked_over', slight: 'talked over you at the servery', d: { grudge: +0.06, warmth: -0.04 } },
  { type: 'kindness', slight: 'passed you a burn on the quiet', d: { warmth: +0.12, grudge: -0.06, suspicion: -0.04 } },
];

// Pick a random inmate + social event. rnd defaults to Math.random; kept as an
// arg so a test can force a specific pair.
export function pickSocial(rnd = Math.random) {
  const c = CAST[Math.floor(rnd() * CAST.length)];
  const ev = SOCIAL_EVENTS[Math.floor(rnd() * SOCIAL_EVENTS.length)];
  return { castKey: c.key, ev };
}

// Apply one social event to a relations map, scaled by amp and clamped. Records
// the slight if it was a hostile one, so a grudge can name it later.
export function applySocialEvent(relations, castKey, ev, amp = 1) {
  const r = relations[castKey];
  if (!r) return null;
  for (const [k, d] of Object.entries(ev.d)) {
    if (typeof r[k] === 'number') r[k] = clamp(r[k] + d * amp);
  }
  if ((ev.d.grudge || 0) > 0 || (ev.d.suspicion || 0) > 0) r.lastSlight = ev.slight;
  return r;
}

// Officer ambient events. Officers do not slight you on association like the
// inmates - they act on you through the machinery of the place: an order, a
// refusal, a write-up, an unexpected kindness. Each nudges that officer's
// standing (scaled by amp in run.js). `slight` is a name-LESS verb phrase so the
// grudge directive can read "<Name> <slight>" without doubling the name.
export const OFFICER_EVENTS = [
  { type: 'order', slight: 'gave an order and stood there til it was done', d: { suspicion: +0.05, warmth: -0.03, grudge: +0.03 } },
  { type: 'writeup', slight: 'wrote you up for something small', d: { grudge: +0.10, suspicion: +0.06, warmth: -0.05 } },
  { type: 'refusal', slight: 'refused you a thing you are owed, no reason given', d: { grudge: +0.09, warmth: -0.06, suspicion: +0.04 } },
  { type: 'search', slight: 'turned the cell over and left it worse', d: { suspicion: +0.08, grudge: +0.07, warmth: -0.04 } },
  { type: 'lockup', slight: 'banged you up dead on time, not a second either way', d: { suspicion: +0.03, warmth: -0.02 } },
  { type: 'kindness', slight: 'did you a quiet kindness, off the record', d: { warmth: +0.14, suspicion: -0.05, grudge: -0.06 } },
];

// The concrete line for an officer event, naming the officer.
function officerLine(name, ev) {
  return `${name} ${ev.slight}`;
}

// Pick a random officer + officer event. rnd kept as an arg for tests.
export function pickOfficer(rnd = Math.random) {
  const o = OFFICERS[Math.floor(rnd() * OFFICERS.length)];
  const ev = OFFICER_EVENTS[Math.floor(rnd() * OFFICER_EVENTS.length)];
  return { officerKey: o.key, ev };
}

// Apply an officer event to a relations map. Reuses the social-event shape
// (deltas scaled by amp) and records the name-less slight so a hardening grudge
// can name exactly what the officer did without doubling the name.
export function applyOfficerEvent(relations, officerKey, ev, amp = 1) {
  const r = relations[officerKey];
  if (!r) return null;
  for (const [k, d] of Object.entries(ev.d)) {
    if (typeof r[k] === 'number') r[k] = clamp(r[k] + d * amp);
  }
  if ((ev.d.grudge || 0) > 0 || (ev.d.suspicion || 0) > 0) r.lastSlight = ev.slight;
  return r;
}

// A prompt block for an officer event just fired. Officers land as authority,
// not spur-mates, so they read differently from the inmate cast block.
export function officerDirective(officerKey, ev) {
  const o = BY_KEY[officerKey];
  if (!o) return '';
  return `ON THE WING: ${officerLine(o.name, ev)}. ${o.blurb} let it colour the mood, in your voice, not as a report.`;
}

// OVERHEARD - things Cy only half hears through the door or down the wing: an
// inmate shouting, or two officers talking low. `heard` is roughly what was
// said; `mis` is the paranoid mishearing that twists it into something about
// HIM. run.js decides which to feed based on lucidity/paranoia.
export const OVERHEARD = [
  {
    source: 'inmate',
    heard: 'someone down the ones is screaming the same word over and over, cannot make it out',
    mis: 'someone down the ones is screaming your number. over and over. your number.',
  },
  {
    source: 'inmate',
    heard: 'a voice two cells along, half a sentence about a transfer, then nothing',
    mis: 'a voice two cells along says they are moving you tonight. moving YOU.',
  },
  {
    source: 'inmate',
    heard: 'laughter down the twos, then it stops all at once',
    mis: 'laughter down the twos, and it is about you, and then it stops when you listen',
  },
  {
    source: 'officers',
    who: ['proctor', 'trace'],
    heard: 'Mr Proctor and Miss Trace at the desk, low, something about a backlog of write-ups',
    mis: 'Mr Proctor says your number to Miss Trace. a write-up. she nods. tonight, they said.',
  },
  {
    source: 'officers',
    who: ['bailey', 'keyes'],
    heard: 'Miss Bailey and Mr Keyes by the gate, a word about keys not signed back in',
    mis: 'Miss Bailey and Mr Keyes by the gate, and your name in it, and a key, and a door left open for you or against you',
  },
  {
    source: 'officers',
    who: ['sweep', 'locke'],
    heard: 'Mr Sweep telling Mr Locke which cells get cleared this week, you catch a couple of numbers',
    mis: 'Mr Sweep tells Mr Locke your cell gets cleared this week. cleared. and everything in it gone.',
  },
];

// Pick a random overheard item. rnd kept as an arg for tests.
export function pickOverheard(rnd = Math.random) {
  return OVERHEARD[Math.floor(rnd() * OVERHEARD.length)];
}

// Probability that Cy mishears an overheard remark, rising with low lucidity and
// high paranoia. Clamped to a sane band so it is neither never nor always.
export function mishearChance({ lucidity = 0.65, paranoia = 0 } = {}) {
  return clamp(0.12 + 0.55 * (1 - lucidity) + 0.5 * paranoia, 0.05, 0.9);
}

// A prompt block for an overheard remark. `misheard` selects the paranoid twist.
export function overheardDirective(item, misheard) {
  if (!item) return '';
  const line = misheard ? item.mis : item.heard;
  const lead = misheard
    ? 'YOU HALF HEAR IT and you are sure it is about you (it may not be):'
    : 'YOU HALF HEAR IT through the door (you cannot be certain what was said):';
  return `${lead} ${line}. you cannot check. it sits with you.`;
}

// The person CY holds the biggest grudge against (or null) - inmate OR officer,
// since both carry standing through the same mechanism.
export function topGrudge(relations) {
  let best = null;
  for (const c of ENTITIES) {
    const r = relations[c.key];
    if (!r) continue;
    if (!best || r.grudge > best.r.grudge) best = { c, r };
  }
  return best;
}

// A directive naming the inmate and the specific slight, once a grudge is hot.
export function grudgeDirective(relations, threshold = 0.7) {
  const t = topGrudge(relations);
  if (!t || t.r.grudge < threshold) return '';
  const slight = t.r.lastSlight || 'did something you will not name';
  return (
    `THE GRUDGE. ${t.c.name} ${slight}. it is not nothing, not to you, not in here. ` +
    `you keep coming back to ${t.c.name}, you cannot leave it alone. let it into what you write.`
  );
}

// Qualitative words for a standing, so the prompt reads human not numeric.
function describe(r) {
  const w = r.warmth >= 0.6 ? 'you trust him' : r.warmth >= 0.4 ? 'you are easy enough with him' : r.warmth >= 0.2 ? 'you keep him at arm length' : 'no warmth there';
  const s = r.suspicion >= 0.6 ? 'you watch him close' : r.suspicion >= 0.4 ? 'you are wary' : '';
  const g = r.grudge >= 0.7 ? 'bad blood' : r.grudge >= 0.45 ? 'a grudge building' : r.grudge >= 0.25 ? 'a mark against him' : '';
  return [w, s, g].filter(Boolean).join(', ');
}

// Salience: surface whoever's standing is most charged right now (a grudge, or
// strong warmth, or heavy suspicion). Deterministic order for stable prompts.
function salience(r) {
  return r.grudge * 1.2 + r.suspicion * 0.6 + Math.abs(r.warmth - 0.3) * 0.5;
}

// 2-3 relevant inmates + their current standing, as a prompt block.
export function castForPrompt(relations, count = 3) {
  const ranked = CAST
    .map((c, i) => ({ c, r: relations[c.key], i }))
    .filter((x) => x.r)
    .sort((a, b) => salience(b.r) - salience(a.r) || a.i - b.i)
    .slice(0, count);
  if (!ranked.length) return '';
  const lines = ranked.map(({ c, r }) => {
    const std = describe(r);
    return `- ${c.name}: ${c.blurb}${std ? ' (' + std + ')' : ''}`;
  });
  return ['ON THE SPUR with you (keep them real and consistent):', ...lines].join('\n');
}

// ---- VISITORS -------------------------------------------------------------
//
// A visitor is just another entity Cy holds a standing toward - the SAME
// {warmth, suspicion, grudge} triple as the cast - but persisted in the DB and
// folded in per postcard rather than living in the relations map. These helpers
// turn an inbox visitor object into a relation, a recognition prompt block, and
// (after the reply) an updated memory line + standing to write back.

const VISITOR_DEFAULT = { warmth: 0.3, suspicion: 0.35, grudge: 0.05 };

// A relations-style entry from a DB visitor row (or defaults for a stranger).
export function visitorRelation(visitor) {
  if (!visitor) return { ...VISITOR_DEFAULT, lastSlight: null };
  const n = (x, d) => (typeof x === 'number' ? clamp(x) : d);
  return {
    warmth: n(visitor.warmth, VISITOR_DEFAULT.warmth),
    suspicion: n(visitor.suspicion, VISITOR_DEFAULT.suspicion),
    grudge: n(visitor.grudge, VISITOR_DEFAULT.grudge),
    lastSlight: null,
  };
}

// Coarse, human phrasing for the gap since a visitor last wrote. prevIso is a
// UTC "Y-m-d H:i:s" string (or null for the first time).
export function sincePhrase(prevIso, now = Date.now()) {
  if (!prevIso) return null;
  const t = Date.parse(String(prevIso).replace(' ', 'T') + 'Z');
  if (Number.isNaN(t)) return null;
  const h = (now - t) / 3600000;
  if (h < 6) return 'earlier today';
  if (h < 20) return 'first thing / yesterday';
  if (h < 48) return 'yesterday';
  if (h < 24 * 7) return 'a few days back';
  if (h < 24 * 21) return 'a couple of weeks back';
  if (h < 24 * 60) return 'over a month ago';
  return 'a long time ago';
}

// Qualitative standing toward a visitor, phrased for Cy's head.
function describeVisitor(r) {
  const w = r.warmth >= 0.6 ? 'you are glad it is them' : r.warmth >= 0.4 ? 'you do not mind them' : r.warmth >= 0.2 ? 'you keep them at arm length' : 'you have gone cold on them';
  const g = r.grudge >= 0.7 ? 'and there is bad blood' : r.grudge >= 0.45 ? 'and a grudge is building' : r.grudge >= 0.25 ? 'and there is a mark against them' : '';
  const s = r.suspicion >= 0.6 ? 'you read their words twice for the real meaning' : '';
  return [w, g, s].filter(Boolean).join(', ');
}

// The recognition block: who they are, how often they write, roughly how long
// since last time, a condensed memory of what they said, and Cy's standing. He
// should recognise them in his own voice, never as a database readout. Returns
// '' for a genuine first-timer (nothing to recognise yet).
export function visitorForPrompt(visitor, { now = Date.now() } = {}) {
  if (!visitor) return '';
  const count = Number(visitor.postcard_count || 0);
  const isReturning = count > 1 || !!(visitor.notes && String(visitor.notes).trim());
  if (!isReturning) return '';
  const handle = (visitor.handle && String(visitor.handle).trim()) || visitor.from_name || 'them';
  const since = sincePhrase(visitor.prev_posted_at, now);
  const times = count > 1 ? `${count} postcards now` : 'written before';
  const std = describeVisitor(visitorRelation(visitor));
  const memory = visitor.notes && String(visitor.notes).trim() ? String(visitor.notes).trim() : null;
  const lines = [
    `YOU KNOW THIS ONE. ${handle} - ${times}${since ? ', last ' + since : ''}.`,
  ];
  if (memory) lines.push(`what they have sent before: ${memory}`);
  if (std) lines.push(`toward them: ${std}.`);
  lines.push('recognise them the way you would in here - a name you know, a thread picked back up - not as a record. do not list facts; just let it be someone you know writing again.');
  return lines.join('\n');
}

// After a reply, a SHORT compressed memory line about what was exchanged.
// Deliberately cheap - keyword/truncation, NO extra model call. Rolls into the
// visitor's existing notes (capped ~600 chars) by the caller.
export function visitorNoteLine(theirBody, hadImage, hostile) {
  const words = String(theirBody || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w));
  const seen = [];
  for (const w of words) {
    if (!seen.includes(w)) seen.push(w);
    if (seen.length >= 6) break;
  }
  const tag = hostile ? '[hostile]' : '';
  const gist = seen.length ? seen.join(' ') : (hadImage ? '(image, no words)' : '(brief)');
  const img = hadImage ? ' +img' : '';
  return `${tag}${gist}${img}`.trim();
}

// Merge a new note line into existing notes, newest last, capped to ~600 chars
// by dropping the oldest lines. Returns the new notes string.
export function mergeVisitorNotes(existing, line) {
  const lines = String(existing || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  lines.push(line);
  let joined = lines.join('\n');
  while (joined.length > 600 && lines.length > 1) {
    lines.shift();
    joined = lines.join('\n');
  }
  return joined.slice(-600);
}

// Nudge a visitor's standing from the tone of their postcard, scaled by amp.
// Hostile mail hardens grudge/suspicion and cools warmth; warm mail does the
// reverse. Returns the new {warmth, suspicion, grudge}. Same mechanism as the
// cast's social events.
export function updateVisitorStanding(visitor, { hostile, warm }, amp = 1) {
  const r = visitorRelation(visitor);
  const ev = hostile
    ? { d: { grudge: +0.14, suspicion: +0.10, warmth: -0.10 } }
    : warm
      ? { d: { warmth: +0.10, grudge: -0.05, suspicion: -0.03 } }
      : { d: { warmth: +0.03 } }; // any contact at all warms a little
  for (const [k, d] of Object.entries(ev.d)) {
    if (typeof r[k] === 'number') r[k] = clamp(r[k] + d * amp);
  }
  return { warmth: r.warmth, suspicion: r.suspicion, grudge: r.grudge };
}

const STOPWORDS = new Set([
  'this', 'that', 'with', 'have', 'from', 'your', 'youre', 'been', 'they', 'them',
  'were', 'what', 'when', 'will', 'just', 'like', 'about', 'here', 'there', 'still',
  'dont', 'cant', 'wont', 'said', 'some', 'know', 'much', 'very', 'into', 'then',
  'than', 'over', 'back', 'good', 'well', 'gonna', 'really', 'thing', 'think',
]);

export { BY_KEY };
