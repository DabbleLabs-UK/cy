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
    .replace(/[ \t]{2,}/g, ' ');
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
