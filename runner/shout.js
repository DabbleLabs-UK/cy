// shout.js - anger-driven capitalisation. A deterministic string transform; NO
// model involvement. Two jobs live here:
//
//   1. AFFECT DYNAMICS (updateAffect) - a live `anger` value with visible
//      variability (fast rise, slow decay) plus `expressed`, a second value that
//      TRAILS anger through an asymmetric exponential lag (quick up, slow down).
//      Capitalisation is driven by `expressed`, never by `anger` directly, so the
//      shouting appears a beat after the feeling and the comedown outlasts the flare.
//
//   2. THE TRANSFORM (shout) - people shout SPANS, not single words: emphasis
//      spreads across a phrase and sweeps the function words along ('I NEVER
//      TOUCHED IT', not 'I NEVER touched IT'). A seed word is chosen with a
//      probability that scales with its weight and with `expressed`; the span
//      extends out to the nearest prosodic boundary or a word cap that grows with
//      anger; a rarer contrastive outlier lands elsewhere; at the extreme the span
//      runs to the end and the last word can letter-double (STOPPP); at high
//      despair/numbness the page goes flat (all caps stripped).
//
// The capitalised form is a RENDERING only. It must never be fed back into the
// model's context (see run.js onChunk) - otherwise he imitates his own shouting
// and it compounds into permanent caps.

import { clamp, ampOf } from './vitals.js';
import { CAST, OFFICERS } from './cast.js';
import { PROFANITY, THREAT, NEG, FOOD } from './introspect.js';

// key -> the name CY uses, so a live grudge target's name can be weighted for
// shouting the moment the relation hardens (officers by bare surname).
const KEY_TO_NAME = {};
for (const c of CAST) KEY_TO_NAME[c.key] = c.name.toLowerCase();
for (const o of OFFICERS) KEY_TO_NAME[o.key] = o.name.replace(/^(Mr|Miss|Mrs|Ms|Dr)\s+/, '').toLowerCase();

// Prosodic boundaries a span will not cross: conjunctions (a phrase break in
// speech) and, in the gap text, any punctuation or a newline.
const CONJ = new Set(['and', 'but', 'cos', 'coz', 'so', 'then', 'or', 'yet', 'nor', 'because', 'if', 'when', 'while', 'as']);
const GAP_BOUNDARY = /[.,;:!?()"\n–—-]/;

// Function words the contrastive outlier prefers (alongside names/negations):
// a bare pronoun jabbed in caps is what reads as human contrastive focus.
const PRONOUNS = new Set(['i', 'you', 'he', 'she', 'they', 'we', 'me', 'him', 'her', 'them', 'us', 'my', 'your', 'his', 'their']);

// ---- affect dynamics ------------------------------------------------------

// Move `cur` toward `target`, faster when rising than falling (or vice versa).
const easeAsym = (cur, target, up, down) => cur + (target - cur) * (target > cur ? up : down);

// Weight of a single word for shouting. Profanity highest, then threat/violence
// words, then live grudge-target names, then negations/absolutes, then food words
// when hunger is high. Everything else is near zero so ordinary prose stays calm.
export function wordWeight(word, { grudgeNames, hungerHigh } = {}) {
  const w = String(word || '').toLowerCase();
  if (!w) return 0;
  if (w.match(PROFANITY)) return 1.0;
  if (w.match(THREAT)) return 0.8;
  if (grudgeNames && grudgeNames.has(w)) return 0.7;
  if (w.match(NEG)) return 0.5;
  if (hungerHigh && w.match(FOOD)) return 0.45;
  return 0.03;
}

// The lowercase names of everyone CY currently holds a grudge against, pulled
// live from the relations map. Used both to weight their names for shouting and
// to steer the contrastive outlier toward a name.
export function grudgeNames(relations, threshold = 0.3) {
  const out = new Set();
  const rel = relations || {};
  for (const k in rel) {
    const g = rel[k] && rel[k].grudge;
    if (typeof g === 'number' && g >= threshold && KEY_TO_NAME[k]) out.add(KEY_TO_NAME[k]);
  }
  return out;
}

// Advance the live anger + expressed values one tick. Reads:
//   - v.lastBurstAnger: profanity/threat density of his most recent burst (set by
//     the introspection path in run.js), decayed here so its push fades.
//   - the worst standing grudge in the relations map.
//   - the amplification multiplier (monotony), so a small slight after an empty
//     week hits hard.
// Ambient events already spike v.mental.anger directly in vitals.applyEvent; here
// we ease toward the reactive target with FAST rise / SLOW decay, so those spikes
// are preserved and then sulk downward rather than snapping back. `expressed`
// then trails `anger` with an even slower fall - the comedown lag.
export function updateAffect(v, { amp } = {}) {
  if (!v.mental) v.mental = {};
  const a = typeof amp === 'number' ? amp : ampOf(v);

  // the recent-burst anger signal decays between bursts so it does not pin anger up
  v.lastBurstAnger = clamp((v.lastBurstAnger || 0) * 0.9);

  let grudgeMax = 0;
  const rel = v.relations || {};
  for (const k in rel) {
    const g = rel[k] && rel[k].grudge;
    if (typeof g === 'number' && g > grudgeMax) grudgeMax = g;
  }

  const reactive = clamp(0.9 * (v.lastBurstAnger || 0) + 0.6 * grudgeMax);
  const ampGain = 0.5 + 0.4 * (a - 1); // amp 1..3.5 -> gain 0.5..1.5
  const target = clamp(reactive * ampGain);

  v.mental.anger = clamp(easeAsym(v.mental.anger || 0, target, 0.6, 0.08));
  // expressed lags anger: quick to rise, much slower to fall
  v.expressed = clamp(easeAsym(v.expressed || 0, v.mental.anger, 0.35, 0.03));
  return { anger: v.mental.anger, expressed: v.expressed };
}

// ---- deterministic PRNG ---------------------------------------------------
// Seeded from the text so a given chunk shouts identically every time (unit
// tests are stable and a backlog replay is faithful). Callers may pass their own
// rng via ctx.rng.
function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- the transform --------------------------------------------------------

// shout(text, ctx) -> { text, spans, flat }
//   text  - the rendered (possibly capitalised) string. May differ in length
//           from the input at the extreme (letter-doubling).
//   spans - array of [start, end) CHARACTER ranges in the returned `text` that
//           are shouted, for the renderer's pen-pressure pass.
//   flat  - true when the inverse (despair/numbness) pass stripped all capitals.
//
// ctx: { expressed, despair, numbness, hunger, grudgeNames:Set, rng? }
export function shout(text, ctx = {}) {
  const src = String(text == null ? '' : text);
  const expressed = clamp(ctx.expressed || 0);
  const despair = clamp(ctx.despair || 0);
  const numbness = clamp(ctx.numbness || 0);
  const gNames = ctx.grudgeNames || new Set();
  const hungerHigh = (ctx.hunger || 0) > 0.6;
  const rng = ctx.rng || mulberry32(hashStr(src));

  // (f) INVERSE: at high despair or numbness, strip capitals and sentence-initial
  // capitals entirely so the page goes flat.
  if (despair >= 0.8 || numbness >= 0.7) {
    return { text: src.toLowerCase(), spans: [], flat: true };
  }

  // tokenise into words with their character positions in `src`
  const toks = [];
  const re = /[A-Za-z][A-Za-z']*/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    toks.push({ word: m[0], start: m.index, end: m.index + m[0].length });
  }
  if (!toks.length) return { text: src, spans: [] };

  const weights = toks.map((t) => wordWeight(t.word, { grudgeNames: gNames, hungerHigh }));

  // is there a prosodic boundary between adjacent tokens a and b (a < b)?
  const blocked = (a, b) => {
    if (GAP_BOUNDARY.test(src.slice(toks[a].end, toks[b].start))) return true;
    if (CONJ.has(toks[a].word.toLowerCase())) return true;
    if (CONJ.has(toks[b].word.toLowerCase())) return true;
    return false;
  };

  // extend a span out from `seed`, alternating right then left, stopping at a
  // boundary on each side or when `cap` words are covered.
  const extend = (seed, cap) => {
    let lo = seed;
    let hi = seed;
    let count = 1;
    let canR = true;
    let canL = true;
    while (count < cap && (canL || canR)) {
      if (canR) {
        if (hi + 1 < toks.length && !blocked(hi, hi + 1)) { hi++; count++; }
        else canR = false;
      }
      if (count >= cap) break;
      if (canL) {
        if (lo - 1 >= 0 && !blocked(lo - 1, lo)) { lo--; count++; }
        else canL = false;
      }
    }
    return [lo, hi];
  };

  // (b) SEED SELECTION: p(seed) = weight(word) * f(expressed). Roll every candidate
  // and keep the highest-weight winner - at most one main seed per burst at normal
  // levels; more words clear the bar as expressed climbs.
  const gain = 0.15 + 1.9 * expressed; // f(expressed) - tuned to the density target
  let seed = -1;
  let bestW = 0;
  for (let i = 0; i < toks.length; i++) {
    if (weights[i] <= 0.03) continue;
    if (rng() < clamp(weights[i] * gain) && weights[i] > bestW) {
      seed = i;
      bestW = weights[i];
    }
  }

  const upper = new Set(); // token indices to capitalise
  let doubleIdx = -1; // token whose final letter doubles (extreme only)

  if (seed >= 0) {
    // (c) SPAN EXTENSION: word cap N grows with expressed (baseline ~3, high ~7).
    const N = Math.max(2, Math.round(2 + 6 * expressed));
    let [lo, hi] = extend(seed, N);

    // (e) EXTREME: at the top of the range, rarely let the main span run to the
    // END of the burst instead of closing, and letter-double the final word.
    const extreme = expressed >= 0.9 && rng() < 0.3;
    if (extreme) {
      hi = toks.length - 1;
      doubleIdx = hi;
    }
    for (let i = lo; i <= hi; i++) upper.add(i);

    // (d) CONTRASTIVE OUTLIER: with lower probability, one additional SHORT span
    // elsewhere, preferring a name, a negation or a pronoun. This is what makes
    // the pattern look human rather than mechanical.
    if (!extreme && rng() < clamp(0.35 * expressed)) {
      let cand = -1;
      let candScore = 0;
      for (let i = 0; i < toks.length; i++) {
        if (i >= lo && i <= hi) continue; // must be elsewhere
        const lw = toks[i].word.toLowerCase();
        let s = 0;
        if (gNames.has(lw)) s = 3;
        else if (weights[i] >= 0.5) s = 2; // a negation/absolute
        else if (PRONOUNS.has(lw)) s = 1;
        if (s > candScore) { candScore = s; cand = i; }
      }
      if (cand >= 0) {
        const [olo, ohi] = extend(cand, 2); // short: 1-2 words
        for (let i = olo; i <= ohi; i++) if (i < lo || i > hi) upper.add(i);
      }
    }
  }

  if (!upper.size) return { text: src, spans: [] };

  // ---- render: rebuild the string, capitalising the chosen tokens, and record
  // the shouted char ranges in the OUTPUT (letter-doubling shifts later offsets).
  let out = '';
  let cursor = 0;
  const rawSpans = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    out += src.slice(cursor, t.start); // untouched gap text
    let piece = src.slice(t.start, t.end);
    if (upper.has(i)) {
      piece = piece.toUpperCase();
      if (i === doubleIdx) piece += piece.slice(-1).repeat(2); // STOP -> STOPPP
      rawSpans.push([out.length, out.length + piece.length]);
    }
    out += piece;
    cursor = t.end;
  }
  out += src.slice(cursor);

  // merge spans separated only by whitespace so a phrase reads as one pressed
  // stretch of ink rather than word-by-word islands.
  const spans = [];
  for (const [s, e] of rawSpans) {
    const last = spans[spans.length - 1];
    if (last && !out.slice(last[1], s).trim()) last[1] = e;
    else spans.push([s, e]);
  }

  return { text: out, spans };
}
