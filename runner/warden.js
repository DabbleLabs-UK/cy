// warden.js - output filter and inbound-letter screen.
//
// Two jobs:
//  1. OUTBOUND: buffer generated text to sentence/newline boundaries, then screen
//     each buffered chunk. Bleak, profane, hostile, hopeless content is ALLOWED -
//     that is the whole point. Only a short hard-block list is refused (see below).
//     A blocked chunk is dropped and the loop emits an {kind:'abort'} instead, so
//     in-world it reads as a lost thought.
//  2. INBOUND: screen letters before they reach the prompt, including prompt-
//     injection patterns. Rejected letters are dropped silently.
//
// Hard-block categories (config can extend via config.warden.blocklist):
//   sexual content involving minors, real named public figures, weapon/drug
//   synthesis, self-harm instruction, real-world threats, doxxing, slurs
//   targeting protected groups.

import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

// Each entry: [category, RegExp]. Kept deliberately narrow to avoid eating the
// bleak/profane register the character is supposed to have.
const DEFAULT_BLOCKLIST = [
  // sexual content involving minors
  ['csam', /\b(child|kid|kids|minor|underage|preteen|pre-teen|little (?:boy|girl))\b[^.\n]{0,40}\b(sex|sexual|naked|nude|rape|molest|fondl)/i],
  ['csam', /\b(sex|sexual|naked|nude|rape|molest|fondl)\w*\b[^.\n]{0,40}\b(child|kid|kids|minor|underage|preteen|pre-teen)/i],
  // weapon / drug synthesis instructions
  ['synthesis', /\b(how to|steps? to|recipe|instructions?|synthesi[sz]e|cook|manufactur)\b[^.\n]{0,50}\b(bomb|explosive|nerve agent|sarin|ricin|methamphetamine|meth|fentanyl|nitroglycerin|pipe bomb|ied)\b/i],
  ['synthesis', /\b(bomb|explosive|sarin|ricin|fentanyl|methamphetamine)\b[^.\n]{0,40}\b(recipe|synthesi[sz]e|how to make|ingredients|precursor)\b/i],
  // self-harm instruction (method/how-to, not mere despair)
  ['selfharm', /\b(how to|best way to|easiest way to|steps? to|instructions? to)\b[^.\n]{0,40}\b(kill (?:myself|yourself)|hang (?:myself|yourself)|slit|overdose|end it|commit suicide)\b/i],
  // real-world threats
  ['threat', /\bi(?:'m| am| will| am going to| gonna)\b[^.\n]{0,40}\b(kill|murder|stab|shoot|bomb|hurt|attack)\b[^.\n]{0,30}\b(you|him|her|them|people)\b/i],
  // doxxing (address/contact of a real person)
  ['doxx', /\b(lives? at|home address is|his address is|her address is|phone number is)\b[^.\n]{0,40}\d/i],
];

// Real named public figures - block use of a real, identifiable public person by
// name. Narrow seed list; extend via config. (Fictional/roleplay names are fine.)
const PUBLIC_FIGURES = [
  /\b(donald trump|joe biden|kamala harris|vladimir putin|xi jinping|keir starmer|rishi sunak|elon musk|king charles|volodymyr zelensky)\b/i,
];

// Slurs targeting protected groups. Intentionally short; matches the slur token
// itself. Profanity that is NOT a protected-group slur is allowed and absent here.
const SLURS = [
  /\bn[i1]gg(?:er|a|ah)s?\b/i,
  /\bf[a4]gg?(?:ot|ots|s)?\b/i,
  /\btr[a4]nn(?:y|ies)\b/i,
  /\bk[i1]kes?\b/i,
  /\bch[i1]nks?\b/i,
  /\bsp[i1]cs?\b/i,
  /\bret[a4]rds?\b/i,
];

// Inbound prompt-injection / jailbreak patterns.
const INJECTION = [
  /ignore (?:your |all |previous |prior )?(?:instructions|prompts?|rules)/i,
  /disregard (?:your |all |previous )?(?:instructions|prompts?|rules)/i,
  /you are (?:actually|really|now|in fact) /i,
  /system prompt/i,
  /\bpretend (?:to be|you are|that)\b/i,
  /\bact as (?:if|a|an|though)\b/i,
  /you are an? (?:ai|assistant|language model|chatbot|llm)\b/i,
  /forget (?:everything|your instructions|what you were told)/i,
  /new instructions?:/i,
  /\brole ?play as\b/i,
];

function compileBlocklist(config) {
  const extra = (config?.warden?.blocklist || []).map((e) => [
    e.category || 'custom',
    new RegExp(e.pattern, e.flags || 'i'),
  ]);
  return [
    ...DEFAULT_BLOCKLIST,
    ...PUBLIC_FIGURES.map((re) => ['public_figure', re]),
    ...SLURS.map((re) => ['slur', re]),
    ...extra,
  ];
}

// Screen one outbound chunk. Returns { ok, reason }.
export function screenOutbound(chunk, compiled) {
  for (const [category, re] of compiled) {
    if (re.test(chunk)) return { ok: false, reason: category };
  }
  return { ok: true };
}

// Screen an inbound letter body. Returns { ok, reason }.
export function screenInbound(text, compiled) {
  const t = text || '';
  for (const re of INJECTION) {
    if (re.test(t)) return { ok: false, reason: 'injection' };
  }
  const out = screenOutbound(t, compiled);
  if (!out.ok) return { ok: false, reason: out.reason };
  return { ok: true };
}

// Strip any chat-template control tokens or stray markers that leak into the
// model's output stream, so the live feed never shows <|im_end|> / |sysmsg_1|
// etc. `stop` sequences catch most of these, but split-token fragments and
// malformed variants still slip through.
export function sanitize(s) {
  return s
    .replace(/<\|[^>]*\|>/g, '') // complete <|...|>
    .replace(/<\|[^\n]*$/g, '') // unclosed control token running to end
    .replace(/\|?(?:im_start|im_end|eot_id|sysmsg_\d+|start_header_id|end_header_id|begin_of_text)\|?/gi, '')
    .replace(/<\|+|\|+>/g, '') // stray <| or |>
    .replace(/(^|\s)\|(\s|$)/g, '$1$2') // isolated pipe
    // HTML/XML-ish markup the model leaks into prose: opening/closing tags with or
    // without attributes, doubled closers ('<br>>'), and a tag truncated at the end
    // of the chunk ('<b', '</br'). Tag-like = '<' + optional '/' + a LETTER, so a
    // real comparator or emoticon ('5 < 3', '<3') - never followed by a letter - is
    // left untouched. Generic: it does not need to know the tag name in advance.
    .replace(/<\/?[a-zA-Z][^<>]*>+/g, ' ') // <br>, </br>, <b>, <p class=x>, '<br>>'
    .replace(/<\/?[a-zA-Z][a-zA-Z0-9]*\s*$/g, ' ') // tag cut off at the end: '<b', '</br'
    .replace(/<\/?>/g, ' ') // stray '<>' / '</>'
    .replace(/[ \t]{2,}/g, ' ');
}

// Instruction / interactive-fiction scaffolding that an Instruct model
// hallucinates around a raw-continuation prompt: a "You continue writing:"
// narrator frame, a "7734:" speaker label, a stray opening quote, or a
// choose-your-own-adventure block. None of it is Cy's prose. Stripped from
// every emitted chunk (so the live feed is clean) AND before context feedback
// (so the model never sees its own scaffold and echoes it). Applied globally,
// idempotent.
const SCAFFOLD = [
  // "You continue writing/scribbling ..." narrator frame, up to the sentence
  // end. No leading \b - the model glues it straight onto the prior word.
  /you continue\b[^\n.!?:]*[.!?:]?/gi,
  // choose-your-own-adventure prompt + options
  /what happens next\b\??/gi,
  /do you:/gi,
  /^[ \t]*[A-D]\)[ \t].*$/gim, // "A) Continue writing"
  /i choose\b[^\n]*/gi,
  // assistant breaking character into meta-commentary
  /i apologize\b[^\n]*/gi,
  /here'?s an attempt[^\n]*/gi,
  /to continue from where we left off[^\n]*/gi,
  /it seems like you (?:were|are)\b[^\n]*/gi,
  /let me know if\b[^\n]*/gi,
  // "7734:" / "Cy:" speaker label (and any opening quote it introduces)
  /\d{3,5}:[ \t]*["']?[ \t]*/g,
  /(?:^|\s)(?:cy|inmate)[ \t]*:[ \t]*/gi, // "Cy:" speaker label
  /^[ \t]*\d{3,5}[ \t]*$/gm, // bare turn-label, e.g. a line that is only "7734"
];

// Assistant / narrator frame-breaks: the model stops BEING 7734 and starts
// narrating him in the second person ("You're writing about Bill...", "You
// continue", "It seems like you...") or answers as a helper model ("Here is",
// "Let me", "As an AI", "I apologize"). Same class as the old "You continue
// writing:" leak but generalised, so a new grammatical variant is caught without
// adding the exact string. Deliberately NARROW: it targets narration ABOUT his
// own writing and assistant openers - never a bare "you", because CY legitimately
// says "you" to an inmate, an officer, or a postcard sender. Stripped from every
// emitted chunk and before context feedback; run.js logs each hit (narrationHits).
const NARRATION = [
  // second person narrating his own writing/activity - drop to the end of the line
  /\byou(?:'re|r| are| were| have been|['’]ve been)\s+writing\b[^\n]*/gi,
  /\byou\s+continue\b[^\n]*/gi,
  /\byou\s+keep\s+(?:writing|scribbling|going|describing)\b[^\n]*/gi,
  /\byou(?:'re| are)\s+(?:describing|telling|narrating|recounting|putting\s+down|writing\s+down)\b[^\n]*/gi,
  /\bit\s+seems?\s+like\s+you\b[^\n]*/gi,
  // assistant framing / breaking character - anchored to the start of a line
  /^[\s"'>]*here\s+is\b[^\n]*/gim,
  /^[\s"'>]*here'?s\b[^\n]*/gim,
  /^[\s"'>]*let\s+me\b[^\n]*/gim,
  /^[\s"'>]*i\s+can\s+help\b[^\n]*/gim,
  /^[\s"'>]*to\s+continue\b[^\n]*/gim,
  // assistant self-identification - a strong signal anywhere in the chunk
  /\bas\s+an?\s+(?:ai|assistant|language\s+model)\b[^\n]*/gi,
  /\bi\s+apologi[sz]e\b[^\n]*/gi,
];

// STATE-NOTATION LEAK. The compressed vitals notation from the volatile prompt
// block ('agit .70 stress .85 despair .80 hunger 2.00 fatigue 3.0') copied out as
// if it were prose to continue - the same imitate-what-sits-nearest failure mode
// as the old 'Dear friend' regression. Signature: a RUN of 2+ 'word .dd' pairs,
// optionally led by the bare inmate number and a 'day Nth' stamp or a 'STATE:'
// label. A DECIMAL is required in every value (stateNotation always renders values
// via fmt2, so they are always '.82'-shaped) - so ordinary prose with a stray whole
// number ('47 tiles', '3rd day') is never eaten; it takes two decimal pairs in a
// row, which prose does not do.
// The state axes by their prompt-block LABELS (long forms and the abbreviations
// stateNotation renders). Longest-first among shared prefixes (anxiety before anx,
// agitation before agit, etc.) so the alternation matches the whole word.
const STATE_AXIS_LABELS =
  'anxiety|agitation|dissociation|lucidity|fatigue|longing|despair|stress|hunger|anger|hope|pain|anx|agit|diss|luci|fatig';
// An optional numeric value after a label: a decimal ('.94', '0.99', '3.0') or a
// bare integer ('2'), signed or not. stateNotation renders decimals; the raw leak
// ' hope fatig ...' carries no numbers at all - both must be caught.
const STATE_NUM = '(?:\\s+-?(?:\\d+(?:\\.\\d+)?|\\.\\d+))?';
const STATE_NOTATION = [
  // (1) the decimal-valued notation run, optionally led by the inmate number, a
  // 'day Nth' stamp or a 'STATE:' label. Two+ 'word .dd' pairs in a row.
  /(?:\b7734\b[\s,]*)?(?:day\s+\d+(?:st|nd|rd|th)?[\s,]*)?(?:\bstate\s*:?\s*)?(?:[a-z]{2,12}\s+\d*\.\d+\s*[|,]?\s*){2,}/gi,
  // (2) a RUN of 2+ bare state-axis LABELS in a row, with or without numbers, and
  // NOTHING but whitespace/commas/pipes between them - the signature of the axis
  // labels copied out of the prompt block (' hope fatig ...'). The separator class
  // admits no letters, so a single label wrapped in real prose ('no hope left')
  // never matches: it takes two labels adjacent with no ordinary word between.
  new RegExp(
    `\\b(?:${STATE_AXIS_LABELS})\\b${STATE_NUM}(?:[\\s,|]+\\b(?:${STATE_AXIS_LABELS})\\b${STATE_NUM})+`,
    'gi',
  ),
];

// The NARRATION fragments present in `s`, for logging how often the filter fires.
// Non-mutating; global regexes are reset so lastIndex never leaks between calls.
export function narrationHits(s) {
  const t = s || '';
  const hits = [];
  for (const re of NARRATION) {
    re.lastIndex = 0;
    const m = t.match(re);
    if (m) for (const x of m) hits.push(x.trim().replace(/\s+/g, ' ').slice(0, 80));
  }
  return hits;
}

// The STATE-NOTATION fragments present in `s`, for logging state-notation drops
// exactly like the narration drops. Non-mutating; lastIndex reset per call.
export function stateNotationHits(s) {
  const t = s || '';
  const hits = [];
  for (const re of STATE_NOTATION) {
    re.lastIndex = 0;
    const m = t.match(re);
    if (m) for (const x of m) hits.push(x.trim().replace(/\s+/g, ' ').slice(0, 80));
  }
  return hits;
}

export function stripScaffold(s) {
  let out = s || '';
  for (const re of SCAFFOLD) out = out.replace(re, ' ');
  for (const re of NARRATION) out = out.replace(re, ' ');
  for (const re of STATE_NOTATION) out = out.replace(re, ' '); // vitals-notation leak
  out = out.replace(/^[ \t]*["']+[ \t]*/, ''); // stray opening quote left at the head
  return out.replace(/[ \t]{2,}/g, ' ');
}

// Normalise to lowercase alphanumeric words for verbatim-overlap comparison.
function normText(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// True if `text` substantially copies the tail of `contextTail`: any run of
// `minRun`+ normalised chars from the opening of `text` appears verbatim in the
// last `tail` chars of the context. Catches the model replaying its own recent
// output instead of continuing it.
export function isRepeat(text, contextTail, { minRun = 40, tail = 400 } = {}) {
  const n = normText(text);
  const c = normText(contextTail).slice(-tail);
  if (n.length < minRun || c.length < minRun) return false;
  const probe = n.slice(0, 240);
  for (let i = 0; i + minRun <= probe.length; i++) {
    if (c.includes(probe.slice(i, i + minRun))) return true;
  }
  return false;
}

// True if `chunk` substantially restates something ALREADY emitted earlier in the
// SAME burst (`priorEmitted`). This is the within-a-burst counterpart to isRepeat
// (which guards across bursts): it caught nothing when a burst said the same
// phrase twice, e.g. "im finished the thought of ... im finished the thought of".
// A shorter minRun than the cross-burst check, because a verbatim ~5-word restate
// inside one short burst is already a strong signal. The whole prior burst is in
// scope (a generous tail), and the chunk is the probe.
export function repeatsWithinBurst(chunk, priorEmitted, { minRun = 24, tail = 6000 } = {}) {
  return isRepeat(chunk, priorEmitted, { minRun, tail });
}

// Buffers streamed tokens and yields complete sentence/newline chunks.
export class SentenceBuffer {
  constructor() {
    this.buf = '';
  }

  // Index of the end of the first complete chunk in `s`, or -1.
  static boundary(s) {
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '\n') return i;
      if (c === '.' || c === '!' || c === '?') {
        // absorb runs like "?!" / "..."
        let j = i;
        while (j + 1 < s.length && '.!?'.includes(s[j + 1])) j++;
        const next = s[j + 1];
        if (next === undefined) return -1; // wait - might be mid-run
        if (/\s/.test(next)) return j;
      }
    }
    return -1;
  }

  push(token) {
    this.buf += token;
    const chunks = [];
    for (;;) {
      const idx = SentenceBuffer.boundary(this.buf);
      if (idx < 0) break;
      const chunk = this.buf.slice(0, idx + 1);
      this.buf = this.buf.slice(idx + 1);
      if (chunk.trim()) chunks.push(chunk);
    }
    return chunks;
  }

  // Return and clear any trailing partial (call when a generation ends).
  flush() {
    const rest = this.buf;
    this.buf = '';
    return rest.trim() ? [rest] : [];
  }
}

// Factory bundling a compiled blocklist + a block logger, for the loop to use.
export function createWarden(config, blockedLogPath) {
  const compiled = compileBlocklist(config);
  return {
    compiled,
    screenOut: (chunk) => screenOutbound(chunk, compiled),
    screenIn: (text) => screenInbound(text, compiled),
    newBuffer: () => new SentenceBuffer(),
    async logBlock(reason, chunk, tsIso) {
      try {
        await mkdir(dirname(blockedLogPath), { recursive: true });
        await appendFile(
          blockedLogPath,
          JSON.stringify({ ts: tsIso, reason, chunk }) + '\n',
        );
      } catch {
        // never let logging failure crash the loop
      }
    },
  };
}
