// introspect.js - a deterministic read of Cy's OWN OUTPUT.
//
// Mental vitals must move only in response to something real. Incidents from the
// ledger are one real thing; what Cy actually WROTE is the other. After each
// completed waking burst its text is run through here - lexicon and structure
// only, NO model call, and fast - to derive small deltas so the state follows HIS
// TEXT, not a clock. If he writes himself into a spiral, the numbers follow the
// words down.
//
// Returns { deltas, rel, signals }:
//   deltas  - {axis: d} primitive mental/physical nudges (small; a burst nudges,
//             it does not swing). Applied by the caller WITHOUT amplification.
//   rel     - { castKey: {suspicion?, warmth?} } standing nudges toward a person
//             he named in a threatening or a kindly context.
//   signals - short human tags for state/run.out.log so the derivation is
//             observable and attributable to specific text features.

import { CAST, OFFICERS } from './cast.js';

// A mention (whole word) -> cast key. Inmates by first name, officers by bare
// surname. Some names are common words (mark, bill, root, sweep, trace); those
// only ever move a standing when a threat/positive word sits right beside them,
// so the co-occurrence gate keeps stray matches harmless.
const NAME_TO_KEY = {};
for (const c of CAST) NAME_TO_KEY[c.name.toLowerCase()] = c.key;
for (const o of OFFICERS) {
  const bare = o.name.replace(/^(Mr|Miss|Mrs|Ms|Dr)\s+/, '').toLowerCase();
  NAME_TO_KEY[bare] = o.key;
}

// ---- lexicons -------------------------------------------------------------

export const THREAT = /\b(shiv|shank|blade|jump(?:ed|ing)?|kick(?:ing)?\s+off|smash|batter|deck(?:ed)?|done\s+over|watch\s+(?:your|my|his|their)\s+back|coming\s+for|get\s+(?:me|you|him)|threat|beef|blood|fight|glass(?:ed)?|slit|throat|hurt\s+you|do\s+you\s+in|off\s+the\s+wing)\b/gi;

export const FOOD = /\b(tray|slop|canteen|servery|scran|egg|eggs|toast|tea|meal|dinner|breakfast|lunch|food|hungry|starving|stomach|belly|bread|plate|spoon|jam\s+roll|gruel|beans|porridge|hunger)\b/gi;

export const NEG = /\b(never|no\s*one|nobody|nothing|none|always|forever|cant|can'?t|cannot|wont|won'?t|no\s+more|not\s+ever|every\s+time|all\s+the\s+time|no\s+point|pointless|useless|no\s+way\s+out)\b/gi;

const LONGING = /\b(miss\s+(?:you|him|her|them)|wish\s+(?:you|i|we)|come\s+back|used\s+to|remember\s+when|out\s+there|waiting\s+for\s+you|love\s+you|if\s+you\s+were|where\s+are\s+you|think(?:ing)?\s+of\s+you|see\s+you\s+again)\b/gi;

export const PROFANITY = /\b(fuck(?:ing|ers?|ed|s)?|shit(?:e|ty|s)?|bastard|cunt|prick|twat|wanker|bollocks|arse(?:hole)?|dickhead|piss(?:ed|ing)?|shithouse)\b/gi;

const POSITIVE = /\b(sound|alright|decent|good\s+lad|looked\s+out|sorted\s+me|passed\s+me|laughed|mate|fair|straight|helped|kind|shared|solid|had\s+my\s+back|not\s+bad|stood\s+up|square)\b/gi;

// A segment that opens on a bare command verb reads as an imperative barked at
// someone - part of the anger signal alongside profanity.
const IMPERATIVE_OPEN = /^(get|shut|leave|stop|give|come|back|listen|look|move|open|let|tell|bring|take|keep|watch|say|piss|fuck)\b/;

const words = (t) => (String(t || '').toLowerCase().match(/[a-z0-9']+/g) || []);
const segments = (t) =>
  String(t || '')
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);

// Distinct sample of the matched surface forms, for a legible log line.
function sample(matches, n = 3) {
  const seen = [];
  for (const m of matches || []) {
    const s = m.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!seen.includes(s)) seen.push(s);
    if (seen.length >= n) break;
  }
  return seen.map((s) => '"' + s + '"').join(',');
}

// Overlapping k-word shingles, for the cross-burst repetition read.
function shingles(t, k = 4) {
  const w = words(t);
  const out = [];
  for (let i = 0; i + k <= w.length; i++) out.push(w.slice(i, i + k).join(' '));
  return out;
}

// Nudge a delta bag and clamp its running total to a per-burst ceiling so no
// single burst can swing an axis - it only ever nudges.
function bump(deltas, axis, d, cap = 0.06) {
  const cur = deltas[axis] || 0;
  const next = cur + d;
  deltas[axis] = next > 0 ? Math.min(cap, next) : Math.max(-cap, next);
}

// ---------------------------------------------------------------------------

export function introspect(text, { prev = '' } = {}) {
  const raw = String(text || '');
  const w = words(raw);
  const nWords = w.length;
  const deltas = {};
  const rel = {};
  const signals = [];
  if (nWords < 6) return { deltas, rel, signals }; // too little to read

  const segs = segments(raw);
  const round = (x) => Number(x.toFixed(3));

  // (a) threat/danger vocabulary -> anxiety up. And any person named in that
  // threatening breath -> suspicion toward THEM.
  const threatHits = raw.match(THREAT) || [];
  if (threatHits.length) {
    const d = Math.min(0.05, 0.02 + 0.012 * threatHits.length);
    bump(deltas, 'anxiety', d);
    signals.push(`anxiety+${round(d)} (threat ${sample(threatHits)})`);
    // name within 6 tokens of any threat word -> suspicion toward that person
    for (let i = 0; i < w.length; i++) {
      const key = NAME_TO_KEY[w[i]];
      if (!key) continue;
      const lo = Math.max(0, i - 6);
      const hi = Math.min(w.length, i + 7);
      const window = w.slice(lo, hi).join(' ');
      if (THREAT.test(window)) {
        THREAT.lastIndex = 0;
        rel[key] = rel[key] || {};
        rel[key].suspicion = Math.min(0.05, (rel[key].suspicion || 0) + 0.03);
        signals.push(`suspicion+ ->${key} (named in threat)`);
      }
      THREAT.lastIndex = 0;
    }
  }

  // (b) food vocabulary density -> confirms hunger salience (physical, but a
  // fixation on food is a real signal he is hungry). Tiny.
  const foodHits = raw.match(FOOD) || [];
  if (foodHits.length >= 2 && foodHits.length / nWords > 0.03) {
    const d = Math.min(0.02, 0.008 + 0.004 * foodHits.length);
    bump(deltas, 'hunger', d, 0.03);
    signals.push(`hunger+${round(d)} (food density ${foodHits.length}/${nWords})`);
  }

  // (c) sentence-length collapse + fragment ratio -> lucidity DOWN. His voice is
  // already shorthand, so only a genuine COLLAPSE (very short segments, mostly
  // fragments) counts - fluent train-of-thought moves nothing.
  if (segs.length >= 3) {
    const lens = segs.map((s) => words(s).length);
    const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
    const fragRatio = lens.filter((n) => n < 4).length / lens.length;
    if (avg < 3.6 && fragRatio > 0.65) {
      const d = Math.min(0.05, 0.02 + 0.06 * (fragRatio - 0.65));
      bump(deltas, 'lucidity', -d);
      signals.push(`lucidity-${round(d)} (fragmented avg${round(avg)}w frag${round(fragRatio)})`);
    }
  }

  // (d) verbatim / near-verbatim repetition of a phrase -> fixation up. Fixation
  // is derived (0.5*stress + 0.5*monotony), so we drive it via stress. Counts
  // both phrases echoed from the PREVIOUS burst and phrases repeated WITHIN this
  // one - either is him circling the same words.
  const cur = shingles(raw);
  if (cur.length >= 3) {
    const prevSet = new Set(shingles(prev));
    const counts = new Map();
    let echoPrev = 0;
    for (const sh of cur) {
      counts.set(sh, (counts.get(sh) || 0) + 1);
      if (prevSet.has(sh)) echoPrev++;
    }
    let internalDupes = 0;
    for (const c of counts.values()) if (c > 1) internalDupes += c - 1;
    const repScore = (echoPrev + internalDupes) / cur.length;
    if (repScore > 0.25) {
      const d = Math.min(0.04, 0.015 + 0.05 * (repScore - 0.25));
      bump(deltas, 'stress', d);
      signals.push(`stress+${round(d)} (repetition ${round(repScore)} ->fixation)`);
    }
  }

  // (e) negation / absolutes density -> despair up.
  const negHits = raw.match(NEG) || [];
  if (negHits.length >= 2) {
    const d = Math.min(0.04, 0.012 + 0.008 * negHits.length);
    bump(deltas, 'despair', d);
    signals.push(`despair+${round(d)} (absolutes ${sample(negHits)})`);
  }

  // (f) second-person address to an absent person -> longing up. Gated on the
  // longing lexicon so the reflexive "you keep checking the door" voice does not
  // read as pining.
  const longHits = raw.match(LONGING) || [];
  if (longHits.length) {
    const d = Math.min(0.04, 0.018 + 0.012 * longHits.length);
    bump(deltas, 'longing', d);
    signals.push(`longing+${round(d)} (${sample(longHits)})`);
  }

  // (g) profanity + imperative density -> anger up.
  const profHits = raw.match(PROFANITY) || [];
  const imperatives = segs.filter((s) => IMPERATIVE_OPEN.test(s.toLowerCase())).length;
  const angerUnits = profHits.length + imperatives;
  if (angerUnits >= 2) {
    const d = Math.min(0.05, 0.015 + 0.01 * angerUnits);
    bump(deltas, 'anger', d);
    signals.push(`anger+${round(d)} (prof${profHits.length} imp${imperatives})`);
  }

  // (h) naming an inmate/officer POSITIVELY -> warmth toward them.
  for (let i = 0; i < w.length; i++) {
    const key = NAME_TO_KEY[w[i]];
    if (!key) continue;
    const lo = Math.max(0, i - 5);
    const hi = Math.min(w.length, i + 6);
    const window = w.slice(lo, hi).join(' ');
    if (POSITIVE.test(window)) {
      POSITIVE.lastIndex = 0;
      rel[key] = rel[key] || {};
      rel[key].warmth = Math.min(0.05, (rel[key].warmth || 0) + 0.03);
      signals.push(`warmth+ ->${key} (named warmly)`);
    }
    POSITIVE.lastIndex = 0;
  }

  // (i) questions asked to nobody -> dissociation up. A run of unaddressed
  // questions is him drifting off the page.
  const qCount = (raw.match(/\?/g) || []).length;
  if (qCount >= 2) {
    const d = Math.min(0.03, 0.01 + 0.006 * qCount);
    bump(deltas, 'dissociation', d, 0.04);
    signals.push(`dissociation+${round(d)} (${qCount} questions)`);
  }

  return { deltas, rel, signals };
}

// A cheap 0..1 read of how ANGRY a burst's own text is, from the same profanity /
// threat / imperative signals introspect already uses. Reused (not duplicated) by
// shout.js to feed the live anger value - a burst full of swearing and barked
// commands drives anger up on the next tick, closing the feedback loop.
export function angerSignals(text) {
  const raw = String(text || '');
  const prof = (raw.match(PROFANITY) || []).length;
  const threat = (raw.match(THREAT) || []).length;
  const imperatives = segments(raw).filter((s) => IMPERATIVE_OPEN.test(s.toLowerCase())).length;
  const intensity = Math.min(1, (prof * 1.0 + threat * 0.8 + imperatives * 0.5) / 4);
  return { profanity: prof, threat, imperatives, intensity };
}
