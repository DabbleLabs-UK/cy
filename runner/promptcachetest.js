// promptcachetest.js - verifies the append-only prompt ordering for KV-cache
// reuse. NO ollama / model call: this only constructs prompt strings and asserts
// their prefix structure. Run:
//
//   node runner/promptcachetest.js
//
// It simulates several consecutive bursts with CHANGING state and checks:
//   (a) Zone A is byte-identical across every burst;
//   (b) each successive prompt shares a strictly LONGER common prefix with its
//       predecessor than a naive rebuild (volatile-at-front) would; and
//   (c) every volatile substring appears only AFTER that shared prefix.
// It prints the common-prefix length for each consecutive pair as evidence.

import { initialVitals, applyDeltas, clamp } from './vitals.js';
import { initialRelations, applySocialEvent, SOCIAL_EVENTS, castForPrompt, grudgeDirective } from './cast.js';
import { reconcileLedger, makeIncident, pushIncident, incidentsDirective } from './incidents.js';
import { costInjection } from './power.js';
import { ZONE_A, buildDirectives, buildPrompt, bansDirective, pickForm } from './prompt.js';

// A tiny seeded PRNG so the "changing state" is deterministic across runs.
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260818);

// length of the shared leading run of two strings
function commonPrefixLen(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

// ---- simulate the run.js append-only context window (Zone B) ---------------
// Start from a realistic ACCUMULATED context (as the runner does - it loads a
// rolling stream from state/context.jsonl and runs continuously), so the test
// measures the STEADY STATE where the bug actually bites, not the cold ramp from
// an empty page. Kept comfortably under CONTEXT_HARD so no trim fires mid-run
// (a trim is a deliberate, rare one-off cache break, tested separately by design).
const CONTEXT_SOFT = 3000;
const CONTEXT_HARD = 4600;
let contextBuf = '';
function appendContext(chunk) {
  contextBuf += chunk;
  if (contextBuf.length > CONTEXT_HARD) contextBuf = contextBuf.slice(-CONTEXT_SOFT);
}

// A stand-in for a burst of CY's generated prose (varied, so Zone B really grows).
const PROSE = [
  'tray again. cold. same crack in the ceiling i been counting. ',
  'nick said summat on assoc, didnt catch it, dont care. banged up now anyway. ',
  'the strip light buzzing. rn i cant tell what day. b4 tea or after. ',
  'keys down the landing. not for me. never for me. ',
  'reg remembers everything, wont let it go, the old lifer. ',
  'wall cold on my back. counting tiles. 14 across. 9 down. ',
  'fisher asking questions again, one too many like always. ',
  'someone crying down the ones. trying not to be heard. i hear it. ',
];

// ---- fabricate a changing Zone C for each burst ----------------------------
const vitals = initialVitals();
vitals.relations = initialRelations();
vitals.ledger = reconcileLedger(null);
vitals.recentOpeners = [];

// seed ~2400 chars of prior stream (steady-state accumulated Zone B context)
while (contextBuf.length < 2400) appendContext(PROSE[contextBuf.length % PROSE.length]);

function nextState(i) {
  // move the mental axes so styleDirective changes
  applyDeltas(vitals, { anxiety: +0.12, lucidity: -0.05, despair: +0.06 }, 1);
  vitals.mental.anxiety = clamp(vitals.mental.anxiety);
  // harden a grudge so the cast standing / grudge directive shift
  const ev = SOCIAL_EVENTS[Math.floor(rnd() * SOCIAL_EVENTS.length)];
  applySocialEvent(vitals.relations, ['nick', 'bill', 'reg'][i % 3], ev, 1.6);
  // a fresh incident every burst
  const inc = makeIncident('texture', { relations: vitals.relations, phase: 'work_assoc', mins: 9 * 60 + i });
  inc.ts = `2026-08-18 09:${String(10 + i).padStart(2, '0')}:00.000`;
  pushIncident(vitals.ledger, inc);
  // rotate the opener bans
  vitals.recentOpeners.push(['tray', 'nick', 'the', 'keys', 'reg', 'wall', 'fisher'][i % 7]);
  while (vitals.recentOpeners.length > 5) vitals.recentOpeners.shift();
}

// Build the Zone C ctx the way run.js does for a waking journal burst.
function buildCtx(i) {
  const ctx = {
    bans: bansDirective(vitals.recentOpeners),
    regime: `THE REGIME right now (09:${String(10 + i).padStart(2, '0')}): work or association. out of the cell, among them. this is the shape of the day; little else moves.`,
    cast: castForPrompt(vitals.relations),
    grudge: grudgeDirective(vitals.relations),
    form: pickForm(vitals, { relations: vitals.relations, rnd }),
    incidents: incidentsDirective(vitals.ledger, { relations: vitals.relations, mailWaitMs: 0 }),
  };
  // cost injection lands on some bursts, not others (volatile presence)
  if (i % 3 === 0) {
    ctx.cost = costInjection({ cost_per_hour: 0.0135 + i * 0.001, cost_total: 1.2 + i * 0.03, uptime_s: 90000 + i * 3600 });
  }
  return ctx;
}

// ---- run the simulated bursts ----------------------------------------------
const BURSTS = 8;
const NEW = []; // append-only prompts (system Zone A + user Zone B/C)
const NAIVE = []; // naive rebuild: volatile at the FRONT, context after
const volatileMarkers = []; // per-burst list of Zone C substrings to locate

for (let i = 0; i < BURSTS; i++) {
  nextState(i);
  const ctx = buildCtx(i);
  const directives = buildDirectives(vitals, 'journal', ctx);

  // the real, append-only construction: Zone A (system) + Zone B/C (user).
  const userPrompt = buildPrompt(contextBuf, 'journal', null, directives);
  NEW.push(ZONE_A + '\n' + userPrompt);

  // a naive rebuild for comparison: the OLD ordering, volatile directives right
  // after Zone A (front), context after them - i.e. what invalidated the cache.
  NAIVE.push(ZONE_A + '\n' + directives + '\n' + (contextBuf ? contextBuf.trim() + ' ' : 'day begins. the ceiling. same ceiling. '));

  // volatile substrings that must live only in the tail (Zone C directives)
  volatileMarkers.push(directives.split('\n\n').map((s) => s.trim()).filter(Boolean));

  // then the burst "produces" prose, which is appended to Zone B for the next one
  appendContext(PROSE[i % PROSE.length]);
}

// ---- assertions ------------------------------------------------------------
let failures = 0;
const assert = (cond, msg) => {
  if (!cond) {
    failures++;
    console.error('  FAIL: ' + msg);
  }
};

// (a) Zone A byte-identical across all bursts
const zoneAref = ZONE_A;
for (let i = 0; i < BURSTS; i++) {
  assert(NEW[i].startsWith(zoneAref), `burst ${i}: prompt does not start with Zone A`);
  assert(NEW[i].slice(0, zoneAref.length) === zoneAref, `burst ${i}: Zone A not byte-identical`);
}
console.log(`(a) Zone A byte-identical across all ${BURSTS} bursts: ${failures === 0 ? 'PASS' : 'FAIL'} (Zone A = ${zoneAref.length} chars)`);

// (b) append-only shares a strictly longer prefix than the naive rebuild
console.log('(b) common-prefix length, consecutive pairs (append-only vs naive rebuild):');
for (let i = 1; i < BURSTS; i++) {
  const cpNew = commonPrefixLen(NEW[i], NEW[i - 1]);
  const cpNaive = commonPrefixLen(NAIVE[i], NAIVE[i - 1]);
  const gain = cpNew - cpNaive;
  console.log(
    `    burst ${i - 1}->${i}: append-only=${cpNew}  naive=${cpNaive}  (append-only is ${gain} chars longer)`,
  );
  assert(cpNew > cpNaive, `burst ${i}: append-only prefix (${cpNew}) not longer than naive (${cpNaive})`);
  // and the shared prefix must cover all of Zone A (cache keeps the persona)
  assert(cpNew >= zoneAref.length, `burst ${i}: shared prefix (${cpNew}) shorter than Zone A (${zoneAref.length})`);
}

// (c) every volatile substring appears only AFTER the shared prefix with the
//     predecessor (so nothing volatile sits inside the cached region)
console.log('(c) volatile substrings all fall after the shared prefix:');
let worstMargin = Infinity;
for (let i = 1; i < BURSTS; i++) {
  const cpNew = commonPrefixLen(NEW[i], NEW[i - 1]);
  for (const marker of volatileMarkers[i]) {
    if (!marker) continue;
    const at = NEW[i].indexOf(marker);
    assert(at >= 0, `burst ${i}: volatile marker not found in its own prompt: "${marker.slice(0, 40)}..."`);
    assert(at >= cpNew, `burst ${i}: volatile marker starts at ${at}, INSIDE shared prefix (${cpNew}): "${marker.slice(0, 40)}..."`);
    worstMargin = Math.min(worstMargin, at - cpNew);
  }
}
console.log(`    tightest margin (volatile start - shared prefix) across all bursts: ${worstMargin} chars (>=0 required)`);

console.log('');
console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
