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

const BY_KEY = Object.fromEntries(CAST.map((c) => [c.key, c]));

export function initialRelations() {
  const r = {};
  for (const c of CAST) r[c.key] = { ...c.start, lastSlight: null };
  return r;
}

// Reconcile a persisted relations map against the current cast: fill in any
// missing inmate with defaults, keep persisted values for the rest.
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

// The inmate CY holds the biggest grudge against (or null).
export function topGrudge(relations) {
  let best = null;
  for (const c of CAST) {
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

export { BY_KEY };
