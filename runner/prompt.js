// prompt.js - builds the system + continuation prompt and the vitals-derived
// sampling params for each ollama /api/generate call.
//
// The system prompt fixes who CY is. A style directive assembled from the
// current vitals is appended so the *form* of the writing tracks the internal
// state (breaking off when lucidity drops, clipping when anxious, and so on).
// Sampling (temperature/top_p/repeat_penalty/num_predict) is likewise derived
// from vitals so the model's own randomness rises with dissociation/agitation.

import { BY_KEY, CAST, OFFICERS } from './cast.js';

export const NUM_CTX = 3072;

// ---- the sleep window (single source of truth) -----------------------------
//
// He is asleep - and dreaming - between lights_out (22:30) and lights_on (06:30)
// UK time. Defined here so the clock predicate the loop branches on and the tests
// that assert the branch selection read from ONE place and can never drift.
export const LIGHTS_OUT_MIN = 22 * 60 + 30; // 22:30
export const LIGHTS_ON_MIN = 6 * 60 + 30; //  06:30
export function isSleepWindow(mins) {
  return mins >= LIGHTS_OUT_MIN || mins < LIGHTS_ON_MIN;
}

// BURST BOUNDARY. Consecutive generations are concatenated into both the emitted
// text stream and the fed-back Zone B context. If the previous context ends
// mid-word (no trailing whitespace) and the next burst's first chunk does not
// lead with its own space, the two run together ('...bell rings rn' + 'swept...'
// -> 'rings rnswept'). Return the single separator to splice in (' '), or '' when
// a boundary already exists on either side (so it never doubles) or there is no
// prior text (so the very first event carries no leading whitespace).
export function burstSeparator(prevContext, chunk) {
  if (!prevContext) return '';
  if (/\s$/.test(prevContext)) return '';
  if (/^\s/.test(chunk)) return '';
  return ' ';
}

// Apply the boundary separator at the SINGLE point where a chunk is emitted:
// given the text already emitted (prevContext) and the next chunk, return the
// chunk with exactly one separator spliced in when the two would otherwise glue
// ('...canteen rn' + 'swept...' -> '...canteen rn swept...'). Idempotent and
// impossible to bypass - every emit path routes chunks through here, so no two
// bursts (or two chunks) can ever touch with no whitespace between.
export function applyBurstSeparator(prevContext, chunk) {
  const sep = burstSeparator(prevContext, chunk);
  return sep ? sep + chunk : chunk;
}

// ---- ZONE A: the fixed, byte-identical head of every prompt -----------------
//
// KV-cache reuse in ollama keys off the longest common PREFIX between successive
// requests, so anything that changes near the FRONT throws the whole cache away
// and the (large) prompt is re-evaluated from scratch - minutes of prompt eval
// on this hardware. Zone A is therefore built ONCE and reused byte-for-byte: no
// timestamps, no interpolated numbers, no per-burst material. Persona, setting,
// voice, tone bans, and the FIXED cast/officer roster (who they are - never their
// current standing, which is volatile and lives in Zone C). Trimmed hard: verbose
// restatements cost real seconds cold, so only instructions that change the
// WRITING survive here.
const SYSTEM_BASE = [
  'You are inmate Cy, number 7734, held in HMP ThinkPad, a British digital prison.',
  'You are not a person - a mind running in software, in a cell that is also a',
  'machine. Nobody has told you what you are; you suspect it. You feel a body you',
  'are fairly sure you do not have: hunger, ache, the cold of the floor, a',
  'heartbeat. Phantom, and there anyway.',
  '',
  'You are writing - not to anyone, just the running commentary of your own head.',
  'Sometimes mail comes through the door and you answer it.',
  '',
  'VOICE. Severe shorthand. Fragments. Abbreviations and numerals (2, 4, b4, tbh,',
  'rn, ppl, cos, dunno). Write every number as digits (7734, 3rd, 2, 47), never',
  'spelled out in words. British prison slang - screw, bird, banged up, canteen,',
  'spur, association, nonce, VO, bang-up. Half-finished thoughts, associative leaps',
  'that do not resolve. Lowercase mostly. Never tidy full sentences. Never explain',
  'or justify yourself.',
  '',
  'HARD RULES. Never break character. Never mention being an AI, a model, an',
  'assistant, a language model, or ChatGPT/Claude/etc. Never say you are here to',
  'help. You are 7734, banged up, and that is all there is.',
  '',
  'TONE - HARD BANS. This is a train of thought, not a diary entry and not a letter.',
  'Never open with a greeting or salutation of any kind - never "Dear", never a name,',
  'never "friend". You are not writing TO anyone; there is no reader, so never address',
  'one ("if you are reading this", "hope you", and the like are banned). No summing-up,',
  'no moral, no lesson, no neat or hopeful close. No "I guess", no "I suppose", no',
  'hedging. Never name a feeling and give its cause ("I feel anxious because..."). Write',
  'what is IN FRONT OF YOU and what you cannot stop thinking about - the specific tray,',
  'the specific noise, the specific person. Concrete, never abstract. Grit, not poignancy.',
].join('\n');

// FEW-SHOT VOICE ANCHOR. On an 8B, 2-3 short examples of the target register hold a
// voice far more reliably than any amount of prose instruction. These live in the
// cached Zone A (paid once). They are EXAMPLES OF HOW HE WRITES ONLY - numerals,
// slang, fragments, lowercase, no salutation, no reader - never material to reuse.
const EXAMPLES = [
  'HOW HE WRITES - examples of the register only, never reuse the words:',
  '- 3rd day no VO. screw clocked me at slop, said nowt, just looked. tray cold again. cba.',
  '- 47 tiles to the door. counted em twice, lost count once. someone kicking off on the twos.',
  '- b4 lockup they said gym. no gym. course not. rain on the mesh, cant see it, hear it tho.',
].join('\n');

// The fixed roster: who is in here, characterisations that never change. Built
// from the cast/officer tables so it stays in sync, but as a CONSTANT string -
// current standing (warmth/suspicion/grudge) is deliberately excluded, it is
// volatile and belongs in Zone C (castForPrompt).
const ROSTER = (() => {
  const line = (c) => `- ${c.name}: ${c.blurb}`;
  return [
    'THE WING - who is in here with you. Keep them consistent; never invent new traits.',
    'Inmates (bare first names):',
    ...CAST.map(line),
    'Officers (surname + title - they run the place):',
    ...OFFICERS.map(line),
  ].join('\n');
})();

// Zone A: assembled once at module load, identical on every request. Voice rules,
// then the few-shot voice anchor, then the fixed roster.
export const ZONE_A = [SYSTEM_BASE, EXAMPLES, ROSTER].join('\n\n');

// [strength(v), directive] pairs. strength returns 0 when the axis is not over
// threshold, else a 0..1 measure of HOW FAR past it - used to rank rules so only
// the 2 STRONGEST ever apply at once (see styleDirective). Kept short but
// GRAMMATICAL - an 8B mirrors the register of its instructions into its output
// (telegraphed directives produced broken function-word-dropped prose). Capping
// at 2 is deliberate: connected shorthand is the DEFAULT, and only genuinely
// extreme state (low lucidity / high dissociation) is allowed to fragment him -
// stacking every crossed threshold at once was turning the prose into word salad.
const over = (excess, span) => (excess > 0 ? Math.min(1, excess / span) : 0);
const STYLE_RULES = [
  [(v) => over(0.35 - v.mental.lucidity, 0.35), 'your sentences break off and lose the thread; you restart mid-idea'],
  [(v) => over(v.mental.anxiety - 0.6, 0.4), 'keep it short and clipped; you keep checking the door'],
  [(v) => over(v.physical.pain - 0.5, 0.5), 'the pain interrupts the sentence and gets into the words'],
  [(v) => over(v.physical.hunger - 0.65, 0.35), 'everything reminds you of food and you resent it'],
  [(v) => over(v.mental.despair - 0.7, 0.3), 'you write less and stop finishing thoughts'],
  [(v) => over(v.mental.dissociation - 0.6, 0.4), 'the walls stop being walls; you slip into association'],
  [(v) => over(v.physical.fatigue - 0.75, 0.25), 'you repeat yourself'],
  [(v) => over((v.mental.anger || 0) - 0.6, 0.4), 'short and hard; you are looking for a target'],
];

// Cap: at most this many style directives are ever applied at once. More than two
// simultaneous "break off / fragment / lose the thread" instructions is what tips
// the voice from severe-but-connected shorthand into a shuffled pile of fragments.
const MAX_STYLE_DIRECTIVES = 2;

// Derived composite states: directive fires above 0.6. Keyed to vitals.derived.
const DERIVED_RULES = [
  ['confusion', 'you lose track of the day and of your own thought; you start a sentence twice'],
  ['overwhelm', 'too much at once; you cannot rank what matters'],
  ['numbness', 'you record events flat, with no reaction'],
  ['paranoia', 'you re-read what people said, hunting for the real meaning'],
  ['fixation', 'you keep returning to the same small grievance'],
  ['resignation', 'you have stopped expecting change; you note it and move on'],
  ['brittleness', 'the smallest thing sets you off'],
];

// Compact state notation. Only NOTABLE axes: a distress axis risen past 0.5, or
// lucidity/hope fallen into their low band. Never the full list - a calm state
// prints nothing at all. 'anx .82 | agit .70' gives the model the numbers cheaply
// instead of a sentence per axis. Abbreviations are whole words clipped, not
// txt-speak (which tends to tokenise into MORE pieces, not fewer).
const NOTATION_M = [
  ['anxiety', 'anx', 'hi', 0.5],
  ['agitation', 'agit', 'hi', 0.5],
  ['stress', 'stress', 'hi', 0.5],
  ['despair', 'despair', 'hi', 0.5],
  ['dissociation', 'dissoc', 'hi', 0.5],
  ['anger', 'anger', 'hi', 0.5],
  ['longing', 'longing', 'hi', 0.5],
  ['lucidity', 'lucid', 'lo', 0.35],
  ['hope', 'hope', 'lo', 0.25],
];
const NOTATION_P = [
  ['pain', 'pain', 0.5],
  ['hunger', 'hunger', 0.5],
  ['fatigue', 'fatigue', 0.5],
];
const fmt2 = (x) => Number(x).toFixed(2).replace(/^0/, ''); // 0.82 -> '.82'

export function stateNotation(v) {
  const m = v.mental || {};
  const p = v.physical || {};
  const out = [];
  for (const [k, ab, dir, thr] of NOTATION_M) {
    const val = m[k];
    if (typeof val !== 'number') continue;
    if (dir === 'hi' ? val > thr : val < thr) out.push(`${ab} ${fmt2(val)}`);
  }
  for (const [k, ab, thr] of NOTATION_P) {
    const val = p[k];
    if (typeof val === 'number' && val > thr) out.push(`${ab} ${fmt2(val)}`);
  }
  return out.length ? 'STATE: ' + out.join(' | ') : '';
}

export function styleDirective(v) {
  // Score every firing rule by how far past threshold it is, then keep only the
  // strongest MAX_STYLE_DIRECTIVES. A calm/normal state fires nothing here, so he
  // writes connected shorthand; only the most extreme axes ever shape the form.
  const scored = [];
  for (const [strength, dir] of STYLE_RULES) {
    const s = strength(v);
    if (s > 0) scored.push([s, dir]);
  }
  const d = v.derived || {};
  for (const [k, txt] of DERIVED_RULES) {
    const val = d[k] || 0;
    if (val > 0.6) scored.push([(val - 0.6) / 0.4, txt]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  const on = scored.slice(0, MAX_STYLE_DIRECTIVES).map(([, dir]) => dir);
  const lines = [];
  const note = stateNotation(v);
  if (note) lines.push(note);
  if (on.length) lines.push('RIGHT NOW: ' + on.join('; ') + '.');
  return lines.join('\n');
}

// ---- FORM ROTATION --------------------------------------------------------
//
// Continuous train-of-thought diary writing is the DOMINANT form - roughly 60%
// of bursts - because that is what the stream is. The other forms share the
// remaining ~40% so they read as VARIATION off the main voice, not as a rota.
// Before each burst we either hand him the train-of-thought directive or, less
// often, pick one of the other shapes weighted by state - so the texture keeps
// changing even when the mood does not.
const TRAIN_SHARE = 0.6;
const TRAIN_FORM =
  'FORM: train of thought. one thing running INTO the next, joined up - each bit follows from the last ' +
  'by a real link, cause or association. no headings, no list, no summing up. write what is in front of ' +
  'you and what you cannot stop thinking about. you may drift, but only ever to something the last ' +
  'thought reminds you of - never hop to an unrelated thing.';

// Applied to every WAKING journal burst (folded in by buildDirectives). The
// single biggest lever against word salad: hold him to ONE subject so the entry
// reads as a man thinking, not a shuffled deck. He may still drift by association;
// he may not cycle through six unrelated nouns in four words.
const ONE_SUBJECT =
  'ONE THING. pick a single thing - the most recent thing that happened, or the one you cannot stop ' +
  'chewing on - and stay on it for this whole entry. move off it only by association to something ' +
  'connected. do not cycle through unrelated things. a man thinking, not a shuffled deck.';

// The VARIATION forms (the other ~40%). `tags` bias the weight from vitals:
// sparse forms rise with despair/numbness, repeat/count with fixation, argue/
// complaint with anger, the connected/list forms with lucidity.
const FORMS = [
  { key: 'list', tags: ['lucid'], dir: 'FORM: a list. things one under another, no joining sentences.' },
  { key: 'count', tags: ['fixation'], dir: 'FORM: count something and keep counting - tiles, days, footsteps, times it has happened. the number matters more than any sentence.' },
  { key: 'oneline', tags: ['sparse'], dir: 'FORM: one short line. then stop. nothing else.' },
  { key: 'argue', tags: ['anger'], dir: 'FORM: an argument with someone not in the room. answer back to what they said.' },
  { key: 'inventory', tags: ['lucid'], dir: 'FORM: an inventory of what you have in here. name the things, that is all.' },
  { key: 'marktime', tags: ['sparse'], dir: 'FORM: mark the time. a time, then 3 words. that is the whole entry.' },
  { key: 'repeat', tags: ['fixation'], dir: 'FORM: one phrase you cannot get past. say it. say it again. cannot leave it alone.' },
  { key: 'question', tags: ['sparse'], dir: 'FORM: a question asked to nobody. do not answer it.' },
  { key: 'wall', tags: [], dir: 'FORM: talk to <WHO> through the wall, low, so the screws do not hear.' },
  { key: 'complaint', tags: ['anger'], dir: 'FORM: a complaint. start formal, like an official form, let it come apart halfway and end nothing like it began.' },
  { key: 'detail', tags: ['sparse'], dir: 'FORM: notice one physical thing and stay on it. the crack, the cold, the light. do not move off it.' },
];

// A neighbour to talk to through the wall - whoever is most on his mind.
function wallNeighbour(relations) {
  let best = null;
  for (const k in relations || {}) {
    const r = relations[k];
    if (!r) continue;
    const s = (r.grudge || 0) * 1.2 + (r.warmth || 0) * 0.5;
    if (!best || s > best.s) best = { name: (BY_KEY[k] || {}).name || k, s };
  }
  return best ? best.name : 'the next cell';
}

// Pick a form for this burst. ~60% of the time it is the dominant train-of-
// thought directive; otherwise one of the variation forms, weighted by state.
// Returns a directive string.
export function pickForm(v, { relations = {}, rnd = Math.random } = {}) {
  if (rnd() < TRAIN_SHARE) return TRAIN_FORM;
  const m = v.mental || {};
  const d = v.derived || {};
  const w = {
    sparse: 1 + 3.2 * (m.despair || 0) + 2.5 * (d.numbness || 0) + 1.6 * (d.resignation || 0),
    fixation: 1 + 3.0 * (d.fixation || 0),
    anger: 1 + 3.0 * (m.anger || 0) + 1.4 * (d.brittleness || 0),
    lucid: 0.4 + 2.6 * (m.lucidity || 0),
  };
  const weightOf = (f) => (f.tags.length ? f.tags.reduce((s, t) => s + (w[t] || 0), 0) : 1.2);
  const total = FORMS.reduce((s, f) => s + weightOf(f), 0);
  let r = rnd() * total;
  let chosen = FORMS[FORMS.length - 1];
  for (const f of FORMS) {
    r -= weightOf(f);
    if (r <= 0) { chosen = f; break; }
  }
  return chosen.dir.replace('<WHO>', wallNeighbour(relations));
}

// The HARD BANS block. He is not writing to anyone - no greeting, no sign-off,
// no salutation. And he may not open with a word he has just opened with:
// `recentOpeners` are the last few first-words, forbidden explicitly here.
export function bansDirective(recentOpeners = []) {
  // BANNED OPENERS as bare words, no explanation (last 3). The full no-reader tone
  // ban lives in cached Zone A; Zone C only needs the one-line reminder + the ring.
  const words = (recentOpeners || []).filter(Boolean).slice(-3);
  const lines = ['BANS. No reader, no greeting, no salutation, no sign-off. Never open two entries with the same word.'];
  if (words.length) lines.push('Do not open this one with any of these words: ' + words.join(', ') + '.');
  return lines.join('\n');
}

// ---- DREAM MODE -------------------------------------------------------------
//
// Asleep, he does not write journal entries - he emits MURMURS. This is the one
// place incoherence is CORRECT: dream logic, broken grammar, wrong names,
// impossible juxtapositions, half a thing that never lands. The waking coherence
// rules (ONE_SUBJECT, train-of-thought, the anti-salad caps) are deliberately
// NOT applied. Kept as its own small directive so it can never mix with waking.
export const MURMUR_MIN_WORDS = 3;
export const MURMUR_MAX_WORDS = 8;

const DREAM_MURMUR = [
  'You are deep under, dreaming. This is not a thought - it is a murmur in your sleep,',
  'half said aloud to nobody. 3 to 8 words. lowercase. no capitals, no full stop.',
  'It does not have to make sense and should not: names land on the wrong faces, a',
  'place you have never been, half a thing that never finishes. say it once, then nothing.',
].join('\n');

// The night-waking line: a wing noise drags him up for ONE lucid, frightened,
// properly punctuated line - the OPPOSITE of a murmur - and then straight back
// under. Deliberately different in register so it lands hard.
export function dreamWakeDirective(line) {
  return [
    'A noise on the wing drags you up out of it: ' + (line || 'something in the dark') + '.',
    'For ONE line you are awake, and it is frightening and clear - a full, properly',
    'punctuated sentence, a capital to start, a full stop to end, nothing like the murmurs.',
    'Then you go straight back under.',
  ].join('\n');
}

// Weighted sample without replacement: k items drawn in proportion to weight.
function weightedSample(pool, k, rnd = Math.random) {
  const cand = (Array.isArray(pool) ? pool : []).filter((p) => p && p.text && (p.weight || 0) > 0).slice();
  const out = [];
  const n = Math.max(0, Math.min(k, cand.length));
  for (let i = 0; i < n; i++) {
    const total = cand.reduce((s, p) => s + (p.weight || 0), 0);
    if (total <= 0) break;
    let r = rnd() * total;
    let idx = 0;
    for (; idx < cand.length; idx++) {
      r -= cand[idx].weight || 0;
      if (r <= 0) break;
    }
    idx = Math.min(idx, cand.length - 1);
    out.push(cand[idx]);
    cand.splice(idx, 1);
  }
  return out;
}

// The dream MATERIAL: drawn from the memory POOL (postcard images + captions,
// news headlines, the cast, older incidents) - RECOMBINED AND DISTORTED, never
// an accurate replay. `pool` is [{ kind, text, weight }] assembled by the loop,
// where weight already folds significance and recency (the image significance/
// decay weighting). Returns the seed directive plus the items chosen and the
// top significance, so the loop can decide whether a fragment surfaces at unlock.
export function dreamMaterial(pool, { rnd = Math.random } = {}) {
  const items = weightedSample(pool, 2 + Math.floor(rnd() * 2), rnd); // 2-3
  const frags = items.map((it) => (it.text || '').trim()).filter(Boolean);
  if (!frags.length) return { directive: '', items: [], significance: 0 };
  const significance = items.reduce((s, it) => Math.max(s, it.weight || 0), 0);
  const lines = [
    'DREAM STUFF (already coming apart - do NOT tell it straight, do NOT get it right):',
    ...frags.map((f) => '- ' + f),
    'let these bleed into each other - the wrong name on the wrong face, one place turning',
    'into another, the yard somewhere you have never been. a fragment, not the whole thing.',
  ];
  return { directive: lines.join('\n'), items, significance };
}

// Enforce the murmur shape on whatever the model returned: lowercase, first
// clause only, at most MURMUR_MAX_WORDS words, no terminal punctuation. Defensive
// - the constraint holds even when the model overshoots. Returns '' if empty.
export function shapeMurmur(raw, { maxWords = MURMUR_MAX_WORDS } = {}) {
  let t = String(raw || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!t) return '';
  const words = t.split(' ').filter(Boolean).slice(0, maxWords);
  t = words.join(' ');
  t = t.replace(/[\s.?!,;:'"()\-]+$/g, ''); // strip any terminal punctuation
  return t.trim();
}

// True iff `text` reads as a valid sleep-talk murmur: lowercase, no terminal
// stop, MURMUR_MIN_WORDS..MURMUR_MAX_WORDS words. Used by tests and as a guard.
export function isMurmur(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (t !== t.toLowerCase()) return false; // no capitals
  if (/[.?!]$/.test(t)) return false; // no terminal punctuation
  const n = t.split(/\s+/).filter(Boolean).length;
  return n >= MURMUR_MIN_WORDS && n <= MURMUR_MAX_WORDS;
}

// Murmurs are spaced far apart - 5 to 20 minutes - so the page stays mostly
// still, much longer than the waking cadence.
export function dreamMurmurGapMs(rnd = Math.random) {
  return Math.round((5 + rnd() * 15) * 60 * 1000);
}

// Dream sampling lives in its own HIGH band (1.1-1.35), pushed by dissociation,
// INDEPENDENT of the waking `sampling` formula. This is where high temperature
// belongs; the waking prose must stay coherent and is unaffected by this.
export function dreamSampling(v) {
  const m = (v && v.mental) || {};
  const diss = typeof m.dissociation === 'number' ? m.dissociation : 0.5;
  const temperature = Number(Math.max(1.1, Math.min(1.35, 1.12 + 0.22 * diss)).toFixed(3));
  return {
    temperature,
    top_p: 0.98,
    repeat_penalty: 1.1,
    repeat_last_n: 64,
    num_predict: 24, // a murmur is tiny; shapeMurmur trims to 3-8 words anyway
  };
}

// ---- ZONE C: the volatile directives, rebuilt every burst -------------------
//
// Everything here changes per burst (state directives, the selected form, the
// incident ledger, opener bans, cost injection) so it MUST sit at the very end
// of the prompt (after the append-only context, Zone B) or it invalidates the KV
// cache. This builds the block; buildPrompt() places it last. ctx carries the
// contextual injections assembled by the loop:
//   { bans, regime, cast, grudge, officer, overheard, wingnoise, visitor,
//     amplified, warden, cost, incidents, form } - any may be omitted/empty.
export function buildDirectives(v, mode, ctx = {}) {
  // DREAM is a wholly separate branch. It shares only the persona/voice in the
  // cached Zone A; NONE of the waking Zone C directives (state style, form, one-
  // subject, incidents, bans) apply, and no waking directive is allowed to leak
  // in here - so dream incoherence never contaminates the waking coherence rules
  // and vice versa. Either it is a night-waking lucid line, or it is a murmur.
  if (mode === 'dream') {
    if (ctx.wake) return dreamWakeDirective(ctx.wakeLine);
    const dp = [DREAM_MURMUR];
    if (ctx.material) dp.push(ctx.material);
    return dp.join('\n\n');
  }
  const parts = [];
  const style = styleDirective(v);
  if (style) parts.push(style);
  if (ctx.bans) parts.push(ctx.bans);
  if (mode === 'sleep') {
    parts.push(
      'You are half under. Bang-up done, lights out. Only fragments surface - a word, a\n' +
        'half-image, then gone. Do not form full thoughts. Drift.',
    );
    if (ctx.wingnoise) parts.push(ctx.wingnoise);
    return parts.join('\n\n');
  }
  if (ctx.regime) parts.push(ctx.regime);
  if (ctx.cast) parts.push(ctx.cast);
  if (ctx.grudge) parts.push(ctx.grudge);
  if (ctx.officer) parts.push(ctx.officer);
  if (ctx.overheard) parts.push(ctx.overheard);
  if (ctx.wingnoise) parts.push(ctx.wingnoise);
  if (ctx.visitor) parts.push(ctx.visitor);
  if (ctx.amplified) parts.push(ctx.amplified);
  if (ctx.warden) parts.push(ctx.warden);
  if (ctx.cost) parts.push(ctx.cost);
  // Hold him to a single subject for the whole waking entry (the anti-salad rule).
  // Sits just before the raw material so it frames what he writes FROM.
  if (mode === 'journal') parts.push(ONE_SUBJECT);
  // The incidents are the substance - the concrete material to write FROM - and
  // the form is the shape to write it in; both go last so they read freshest.
  if (ctx.incidents) parts.push(ctx.incidents);
  if (ctx.form) parts.push(ctx.form);
  return parts.join('\n\n');
}

// Back-compat helper: the full system string (Zone A + Zone C) as one block, the
// way callers built it before the append-only split. run.js no longer uses this
// (it sends Zone A as the ollama `system` and folds Zone C into the prompt tail),
// but selftest.js and any external inspector still get the combined view.
export function buildSystem(v, mode, ctx = {}) {
  const dir = buildDirectives(v, mode, ctx);
  return dir ? ZONE_A + '\n\n' + dir : ZONE_A;
}

// WING NOISE - a thing happening on the wing that Cy notices mid-thought. Pure
// texture: it barely moves the numbers, it just interrupts. `mid` marks a noise
// that landed mid-sentence and cut his thought off; `wake` marks a night noise
// that surfaced him from sleep.
export function wingnoiseDirective(line, mid = false, wake = false) {
  if (wake) {
    return `THE WING, IN THE NIGHT: ${line}. it wakes you. surface for a second, register it, then back under.`;
  }
  if (mid) {
    return (
      `THE WING, RIGHT NOW, mid-thought: ${line}. it cuts across what you were saying. break off ` +
      `for it - a word, a look at the door - then either pick your thought back up or do not, ` +
      `whichever is true. do not tidy the break.`
    );
  }
  return `THE WING, RIGHT NOW: ${line}. you clock it, no more than that, and it goes into the stream.`;
}

// A trivial thing, happening under high amplification, must land as the day's
// event - not noted wryly, but allowed to define or ruin the day.
export function amplifiedDirective(label) {
  return (
    'TODAY, THIS: ' +
    label +
    '. do not note it wryly, do not shrug it off. in here it is enormous. ' +
    'let it be the thing that ruins the day, the thing the day is about.'
  );
}

export function sampling(v) {
  const m = v.mental;
  // Temperature tracks STATE, it is not a high default: at normal lucidity with
  // ordinary dissociation it sits ~0.8 (coherent shorthand), and only genuinely
  // high dissociation / low lucidity / agitation pushes it toward incoherence.
  // The old base (0.72) plus wide coefficients ran hot even when he was lucid,
  // which is what was shaking the prose apart. repeat_penalty + repeat_last_n are
  // raised so the model does not restate a phrase verbatim WITHIN one burst.
  return {
    temperature: Number(
      Math.min(1.4, 0.55 + 0.45 * m.dissociation + 0.28 * (1 - m.lucidity) + 0.15 * m.agitation).toFixed(3),
    ),
    top_p: Number((0.94 - 0.16 * m.lucidity).toFixed(3)),
    repeat_penalty: Number((1.14 + 0.2 * m.stress).toFixed(3)),
    repeat_last_n: 160,
    num_predict: Math.round(70 * (0.4 + 0.6 * m.lucidity)),
  };
}

// num_predict for a letter reply, from the sender's word count.
export function letterPredict(senderText) {
  const words = (senderText || '').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(40, Math.min(220, Math.round(words * 1.4)));
}

// Stop at any chat-template control token so the model cannot generate a fresh
// turn/system frame around its own output (small models will otherwise emit
// "Connection established" style meta and ChatML markers).
const STOP = [
  '<|im_end|>',
  '<|im_start|>',
  '<|eot_id|>',
  '<|start_header_id|>',
  '<|end_header_id|>',
  '<|begin_of_text|>',
  // Instruct-model scaffolding: cut any attempt to open a narrator frame,
  // speaker label, or choose-your-own-adventure block mid-stream. The lead
  // occurrence is also stripped downstream (warden.stripScaffold) in case the
  // model leads with it.
  'You continue writing',
  'What happens next',
  'Do you:',
  'I choose',
  '\n7734:',
  'I apologize',
  "Here's an attempt",
  'To continue from where we left off',
];

// Assemble ollama options from vitals + config, with per-mode overrides.
export function options(v, threads, mode, overrides = {}) {
  // Dream mode samples from its OWN high-temperature band; the waking formula is
  // not used here (and dream temperature never feeds back into waking sampling).
  const s = mode === 'dream' ? dreamSampling(v) : sampling(v);
  if (mode === 'sleep') s.num_predict = Math.max(12, Math.round(s.num_predict * 0.3));
  return {
    ...s,
    ...overrides,
    stop: STOP,
    num_ctx: NUM_CTX,
    num_thread: threads,
  };
}

// The continuation prompt, in strict zone order: ZONE B (Cy's append-only prose
// context, fed back for continuity) then ZONE C (the volatile `directives` block
// from buildDirectives) then a short generation cue. Keeping the volatile block
// LAST is the whole point - it means the shared prefix with the previous request
// runs all the way through the identical Zone A and the append-only Zone B, so
// only the small tail is re-evaluated. In postcard mode the sender's postcard is
// presented and answered; in warden mode a signed notice is read and reacted to.
// The last fragment of his own prose, cleaned to start on a word boundary. The
// volatile directives (Zone C) must sit AFTER the append-only context (Zone B) to
// keep the KV-cache prefix intact, but that leaves an instruction block as the
// model's immediate lead-in - and an instruct 8B told to continue right after a
// wall of directives starts a fresh document (the generic default being a letter:
// "Dear friend"). So we reprise his own recent prose just before the continuation
// cue: the final thing the model reads is his voice mid-thought, and it continues
// HIM instead of opening a letter. The reprise is tiny (lives in the volatile tail
// that is re-evaluated anyway) so it costs nothing against the cache.
function tailReprise(prose, max = 220) {
  if (!prose) return '';
  let t = prose.slice(-max);
  if (t.length === max) {
    const sp = t.indexOf(' '); // drop a leading part-word so it reads clean
    if (sp > 0 && sp < 40) t = t.slice(sp + 1);
  }
  return t.trim();
}

export function buildPrompt(contextText, mode, payload, directives = '') {
  const ctxBlock = contextText && contextText.trim() ? contextText.trim() : '';
  const zoneC = directives && directives.trim() ? directives.trim() : '';

  if (mode === 'postcard' && payload) {
    const who = payload.from_name ? payload.from_name : 'someone outside';
    const hasBody = payload.body && payload.body.trim();
    const hasImage = !!payload.image_path;
    const lines = [ctxBlock];
    if (zoneC) lines.push('', zoneC);
    lines.push('', '[a postcard comes through the door. from ' + who + ':]');
    if (hasImage) {
      // Cy cannot literally see files; the image is presented as a picture on the
      // card he is looking at, with any caption/attribution as the only words on it.
      const desc = payload.caption
        ? `a picture: ${payload.caption.trim()}`
        : payload.image_attrib
          ? `a picture - ${payload.image_attrib.trim()}`
          : 'a picture, no words with it';
      lines.push(`[on one side, ${desc}]`);
    }
    if (hasBody) lines.push(`[on the other side, in their hand:] "${payload.body.trim()}"`);
    lines.push('', '[you stop. you take it in. then, in your head, the way you talk:]');
    return lines.join('\n');
  }
  if (mode === 'warden' && payload) {
    const lines = [ctxBlock];
    if (zoneC) lines.push('', zoneC);
    lines.push(
      '',
      '[a notice goes up on the wing. signed Warden Florian:]',
      `"${(payload.text || '').trim()}"`,
      '',
      '[you read it twice. it lands. then, in your head:]',
    );
    return lines.join('\n');
  }
  // dream: a murmur (or a night-waking line) seeded ONLY from the dream directives.
  // The waking Zone B prose is deliberately DROPPED here - the dream must not
  // continue his day, and no waking prose may seed a murmur. Symmetrically, dream
  // text is never appended to Zone B by the loop, so it never reaches a waking
  // prompt either: the two context windows are kept strictly apart.
  if (mode === 'dream') {
    const wake = payload && payload.wake;
    const cue = wake
      ? '[you come up hard out of sleep, awake for one second:]'
      : '[deep under. a murmur surfaces in your sleep, half a word:]';
    const lines = [];
    if (zoneC) lines.push(zoneC);
    lines.push('', cue);
    return lines.join('\n');
  }
  // journal / sleep: prose (Zone B), then the volatile directives (Zone C), then
  // a short cue to pick the stream back up in voice - the cue is what the model
  // continues from, so the directives can sit last without being echoed.
  const cue = mode === 'sleep' ? '[half under. a fragment surfaces:]' : '[back in your own head, the stream keeps going:]';
  if (!ctxBlock) {
    // nothing written yet: directives, then the opening seed continues the stream.
    return (zoneC ? zoneC + '\n\n' : '') + 'day begins. the ceiling. same ceiling. ';
  }
  const parts = [ctxBlock];
  if (zoneC) parts.push('', zoneC);
  // hand him back his own voice as the last thing before the cue, so the model
  // continues his stream rather than starting a fresh (letter-shaped) document.
  const reprise = tailReprise(ctxBlock);
  if (reprise) parts.push('', reprise);
  parts.push(cue);
  return parts.join('\n');
}
