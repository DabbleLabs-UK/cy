// selftest.js - deterministic checks for the amplification / derived-state /
// cast / warden / power machinery, with NO ollama needed. Prints evidence for
// each behaviour the spec asks to confirm.
//
//   node runner/selftest.js

import {
  initialVitals,
  tick,
  applyEvent,
  applyDeltas,
  ampOf,
  computeDerived,
} from './vitals.js';
import {
  initialRelations,
  applySocialEvent,
  SOCIAL_EVENTS,
  grudgeDirective,
  castForPrompt,
  OFFICERS,
  OFFICER_EVENTS,
  applyOfficerEvent,
  officerDirective,
  isOfficer,
  pickOverheard,
  overheardDirective,
  mishearChance,
  visitorForPrompt,
  visitorNoteLine,
  mergeVisitorNotes,
  updateVisitorStanding,
} from './cast.js';
import { buildSystem, amplifiedDirective, pickForm, bansDirective, wingnoiseDirective } from './prompt.js';
import { tempoIdleMs, clampSpeed, maxIdleForSpeed, MAX_TEMPO_IDLE_MS } from './tempo.js';
import { introspect } from './introspect.js';
import {
  reconcileLedger,
  makeIncident,
  pushIncident,
  incidentLine,
  incidentsDirective,
  unresolvedThreads,
  resolveThreads,
} from './incidents.js';
import { PowerMeter, costInjection } from './power.js';
import {
  parseStrokes,
  splitPasses,
  detectDrawRequest,
  resolveRequest,
  subjectFromLine,
  drawDecision,
  MIN_STROKES,
} from './draw.js';
import { sketchToPaths } from '../public/assets/pen.js';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const line = (s = '') => console.log(s);
const hr = (t) => line('\n==== ' + t + ' ====');

// ---- 1. derived states appear ----
hr('1. DERIVED STATES');
const v = initialVitals();
v.relations = initialRelations();
tick(v, { now: Date.now() });
line('vitals.derived = ' + JSON.stringify(v.derived));
line('all seven present: ' + ['confusion', 'overwhelm', 'numbness', 'paranoia', 'fixation', 'resignation', 'brittleness'].every((k) => k in v.derived));

// ---- 2. monotony rises with nothing, drops on a seeded inbox item ----
hr('2. MONOTONY RISE THEN DROP');
const v2 = initialVitals();
v2.relations = initialRelations();
v2.monotony = 0;
for (let i = 0; i < 60; i++) tick(v2, { now: Date.now() }); // 60 empty ticks (~5 min)
line('after 60 empty ticks: monotony = ' + v2.monotony.toFixed(4) + '  amp = ' + ampOf(v2).toFixed(3));
const before = v2.monotony;
applyEvent(v2, 'letter_arrives', { now: Date.now() }); // seeded inbox item
line('after a letter arrives:  monotony = ' + v2.monotony.toFixed(4) + '  (dropped by ' + (before - v2.monotony).toFixed(3) + ')');

// ---- 3. amp visibly scales a delta ----
hr('3. AMPLIFICATION SCALES A DELTA');
// high monotony -> high amp. cold_tea base anger delta is +0.04.
const vHi = initialVitals();
vHi.relations = initialRelations();
vHi.monotony = 1.0;
const ampHi = ampOf(vHi);
const angerBefore = vHi.mental.anger;
applyEvent(vHi, 'cold_tea', { now: Date.now() });
const applied = vHi.mental.anger - angerBefore;
line('monotony=1.0 -> amp=' + ampHi.toFixed(2));
line('cold_tea base anger delta +0.040 -> applied ' + applied.toFixed(3) + ' (0.040 * ' + ampHi.toFixed(2) + ' = ' + (0.04 * ampHi).toFixed(3) + ')');
const vLo = initialVitals();
vLo.monotony = 0;
const angerB2 = vLo.mental.anger;
applyEvent(vLo, 'cold_tea', { now: Date.now() });
line('same event at monotony=0 (amp=1.0) -> applied ' + (vLo.mental.anger - angerB2).toFixed(3));

// ---- 4. a seeded grudge > 0.7 produces a naming directive ----
hr('4. GRUDGE DIRECTIVE');
const rel = initialRelations();
// drive Bill's grudge up with repeated slights under amp
const trayEvent = SOCIAL_EVENTS.find((e) => e.type === 'swapped_tray');
for (let i = 0; i < 12; i++) applySocialEvent(rel, 'bill', trayEvent, 1.5);
line('bill grudge now = ' + rel.bill.grudge.toFixed(3) + '  lastSlight = "' + rel.bill.lastSlight + '"');
line('grudgeDirective ->');
line('  ' + grudgeDirective(rel));

// ---- 5. power accumulates a non-zero cost ----
hr('5. ELECTRICITY METER');
const pm = new PowerMeter({ power: { idleWatts: 25, loadWatts: 55, tariff: 0.245 } }, join(HERE, 'state', 'power.selftest.json'));
await pm.load();
const t0 = Date.now();
pm.integrate(t0); // prime
// simulate 6 hours of running, sampled hourly
for (let h = 1; h <= 6; h++) pm.integrate(t0 + h * 3600000);
const snap = pm.snapshot(t0 + 6 * 3600000);
line('after simulated 6h: ' + JSON.stringify(snap));
line('cost is non-zero: ' + (snap.cost_total > 0));

// ---- 6. cost injection prose ----
hr('6. COST INJECTION PROSE (forced)');
// force a larger total so the pounds read clearly
pm.kwhTotal = 41.7;
pm.costTotal = pm.kwhTotal * pm.tariff;
pm.startTs = t0 - 9 * 86400000; // 9 days ago
line(costInjection(pm.snapshot(t0)));

// ---- 7. full waking system prompt with everything injected ----
hr('7. FULL SYSTEM PROMPT (high amp, hot grudge, trivial event, cost)');
const vp = initialVitals();
vp.relations = rel; // the hot-grudge relations from step 4
vp.monotony = 0.95;
// push some derived states over 0.6 so their directives show
vp.mental.stress = 0.8;
vp.mental.anger = 0.7;
vp.mental.despair = 0.75;
vp.mental.anxiety = 0.7;
vp.mental.lucidity = 0.7;
vp.physical.fatigue = 0.6;
vp.derived = computeDerived(vp);
line('derived: ' + JSON.stringify(vp.derived));
const ctx = {
  cast: castForPrompt(vp.relations),
  grudge: grudgeDirective(vp.relations),
  amplified: amplifiedDirective('the tea came cold'),
  cost: costInjection(pm.snapshot(t0)),
};
line('');
line(buildSystem(vp, 'journal', ctx));

// ---- 8. officers: separate group, class marker, standing nudges ----
hr('8. OFFICERS');
line('officer count: ' + OFFICERS.length + '  keys: ' + OFFICERS.map((o) => o.key).join(', '));
line('all officers titled+surnamed (not bare first names): ' + OFFICERS.every((o) => /^(Mr|Miss|Mrs|Ms|Dr)\s+\S+/.test(o.name)));
line('officers are a distinct group from inmates: ' + OFFICERS.every((o) => isOfficer(o.key)));
const orel = initialRelations();
line('relations map includes officers: ' + OFFICERS.every((o) => !!orel[o.key]));
const writeup = OFFICER_EVENTS.find((e) => e.type === 'writeup');
for (let i = 0; i < 10; i++) applyOfficerEvent(orel, 'proctor', writeup, 1.4);
line('after 10 write-ups under amp, Mr Proctor grudge = ' + orel.proctor.grudge.toFixed(3));
line('lastSlight names it: "' + orel.proctor.lastSlight + '"');
line('officerDirective ->');
line('  ' + officerDirective('proctor', writeup));
line('grudge directive now names the officer: ' + grudgeDirective(orel));

// ---- 9. overheard: half-heard, misheard more under low lucidity / paranoia ----
hr('9. OVERHEARD (mishearing scales with lucidity/paranoia)');
const item = pickOverheard(() => 0.7); // deterministic pick
line('picked source: ' + item.source);
line('heard : ' + item.heard);
line('mis   : ' + item.mis);
const lucidCalm = mishearChance({ lucidity: 0.9, paranoia: 0.05 });
const foggedParanoid = mishearChance({ lucidity: 0.2, paranoia: 0.8 });
line('mishear chance lucid+calm  = ' + lucidCalm.toFixed(3));
line('mishear chance fogged+paranoid = ' + foggedParanoid.toFixed(3));
line('mishearing more likely when fogged/paranoid: ' + (foggedParanoid > lucidCalm));
line('directive (misheard) -> ' + overheardDirective(item, true));

// ---- 10. visitor recognition + cheap memory update (no model call) ----
hr('10. VISITOR MEMORY');
const stranger = { from_name: 'Mara', postcard_count: 1, notes: null };
line('first-timer produces no recognition block: ' + (visitorForPrompt(stranger) === ''));
const returning = {
  handle: 'Mara',
  from_name: 'Mara',
  postcard_count: 5,
  visit_count: 3,
  warmth: 0.68,
  suspicion: 0.2,
  grudge: 0.05,
  notes: 'sea photo. asked if you sleep. told you about her dog rufus.',
  prev_posted_at: '2026-08-10 13:00:00',
};
line('returning visitor recognition block ->');
line(visitorForPrompt(returning, { now: Date.parse('2026-08-17T12:00:00Z') }));
const noteLine = visitorNoteLine('is the dog rufus still keeping you company at night?', false, false);
line('\ncheap note line (keyword/truncation, NO model call): "' + noteLine + '"');
const merged = mergeVisitorNotes(returning.notes, noteLine);
line('merged notes (<=600 chars, newest last):');
line('  ' + merged.replace(/\n/g, ' | '));
line('notes stay capped: ' + (merged.length <= 600));
const hostileStanding = updateVisitorStanding(returning, { hostile: true, warm: false }, 2.0);
line('hostile postcard hardens standing: grudge ' + returning.grudge + ' -> ' + hostileStanding.grudge.toFixed(3) + ', warmth ' + returning.warmth + ' -> ' + hostileStanding.warmth.toFixed(3));

// ---- 11. incident ledger: concrete incidents, threads, write-from directive ----
hr('11. INCIDENT LEDGER');
const iv = initialVitals();
iv.relations = initialRelations();
iv.derived = computeDerived(iv);
const ledger = reconcileLedger([]);
const filed = (k, c) => {
  const inc = makeIncident(k, { relations: iv.relations, ...c });
  inc.ts = 't';
  pushIncident(ledger, inc);
  return inc;
};
filed('social', { actorKey: 'reg', slight: 'swapped your meal tray for a worse one', evType: 'swapped_tray', phase: 'work_assoc', mins: 540 });
filed('officer', { actorKey: 'sweep', slight: 'turned the cell over and left it worse', evType: 'search', phase: 'work_assoc', mins: 540 });
filed('trivial', { sub: 'cold_tea', mins: 480 });
filed('regime', { sub: 'late_unlock', mins: 450 });
filed('texture', { phase: 'lights_out', mins: 180 });
line('every incident has the required record shape: ' +
  ledger.every((i) => ['ts', 'actor', 'verb', 'object', 'detail', 'resolved'].every((k) => k in i)));
line('incidents render as concrete lines:');
for (const i of ledger) line('  - ' + incidentLine(i));
const threadsBefore = unresolvedThreads(ledger, { relations: iv.relations, mailWaitMs: 30 * 3600 * 1000 });
line('unresolved threads (open incidents + mail wait): ' + JSON.stringify(threadsBefore));
const closed = resolveThreads(ledger, ['taken']);
line('resolveThreads(["taken"]) closed ' + closed + '; threads now: ' +
  JSON.stringify(unresolvedThreads(ledger, { relations: iv.relations, mailWaitMs: 0 })));
line('directive tells the model to write FROM the material:');
line(incidentsDirective(ledger, { relations: iv.relations, mailWaitMs: 0, rnd: () => 0.99 }));

// ---- 12. form rotation weights by state ----
hr('12. FORM ROTATION (weighted by state)');
let s = 12345;
const rr = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
const tally = (v) => {
  const c = {};
  for (let i = 0; i < 200; i++) {
    const key = pickForm(v, { relations: iv.relations, rnd: rr }).split('.')[0];
    c[key] = (c[key] || 0) + 1;
  }
  return c;
};
const vDespair = initialVitals(); vDespair.mental.despair = 0.9; vDespair.mental.agitation = 0.05; vDespair.derived = computeDerived(vDespair);
const vAnger = initialVitals(); vAnger.mental.anger = 0.9; vAnger.derived = computeDerived(vAnger);
const cD = tally(vDespair);
const cA = tally(vAnger);
const TRAIN = 'FORM: continuous train of thought';
line('train-of-thought is the dominant form (~60%): despair ' + (cD[TRAIN] || 0) + '/200, anger ' + (cA[TRAIN] || 0) + '/200');
line('train share is ~60% in both moods: ' +
  ((cD[TRAIN] || 0) > 100 && (cD[TRAIN] || 0) < 140 && (cA[TRAIN] || 0) > 100 && (cA[TRAIN] || 0) < 140));
const sparse = (c) => (c['FORM: one short line'] || 0) + (c['FORM: mark the time'] || 0) + (c['FORM: notice one physical thing and stay on it'] || 0) + (c['FORM: a question asked to nobody'] || 0);
line('high despair favours sparse forms (of the ~40% variation): ' + sparse(cD) + ' of 200');
line('high anger produces the argue/complaint forms: ' +
  ((cA['FORM: an argument with someone who is not in the room'] || 0) + (cA['FORM: a complaint'] || 0)) + ' of 200');
line('despair sparse-share > anger sparse-share: ' + (sparse(cD) > sparse(cA)));

// ---- 13. opener bans ----
hr('13. OPENER BANS');
const bans = bansDirective(['the', 'same', 'nothing', 'and', 'cold']);
line('bans forbid Dear/greeting/sign-off: ' + /never begin with "Dear"/.test(bans) + ' / ' + /no greeting/.test(bans));
line('bans list the last openers explicitly: ' + /"the", "same", "nothing", "and", "cold"/.test(bans));

// ---- 14. honest vitals: mental HOLDS over empty ticks (no clock drift) ----
hr('14. HONEST VITALS (mental holds when nothing happens)');
const vHold = initialVitals();
vHold.relations = initialRelations();
const before14 = { ...vHold.mental };
const beforeHunger14 = vHold.physical.hunger;
for (let i = 0; i < 24; i++) tick(vHold, { now: Date.now() }); // ~2 min of empty ticks
const maxMove = Math.max(
  ...['anxiety', 'stress', 'despair', 'hope', 'agitation', 'dissociation', 'anger', 'longing'].map(
    (k) => Math.abs(vHold.mental[k] - before14[k]),
  ),
);
line('after 24 empty ticks (~2 min) the biggest mental move was ' + maxMove.toFixed(4));
line('mental effectively held (max move < 0.02): ' + (maxMove < 0.02));
line('physical is STILL honestly time-based (hunger rose over the same ticks): ' +
  (vHold.physical.hunger > beforeHunger14));

// ---- 15. introspect: his own text moves the state, attributably ----
hr('15. INTROSPECT (state follows the text)');
const spiral = introspect(
  "never getting out. no one writes. nobody. always the same. Bill had a blade on association, watch your back he said. fuck him. fuck all of them.",
  { prev: '' },
);
line('deltas: ' + JSON.stringify(spiral.deltas));
line('rel:    ' + JSON.stringify(spiral.rel));
line('signals:');
for (const s of spiral.signals) line('  - ' + s);
line('despair rose on absolutes/negation: ' + ((spiral.deltas.despair || 0) > 0));
line('anxiety rose on threat vocab: ' + ((spiral.deltas.anxiety || 0) > 0));
line('anger rose on profanity: ' + ((spiral.deltas.anger || 0) > 0));
line('suspicion toward Bill (named in a threat): ' + ((spiral.rel.bill && spiral.rel.bill.suspicion) > 0));
const warm = introspect('nick sorted me a burn on the quiet, sound lad, decent of him.', { prev: '' });
line('warmth toward Nick (named warmly): ' + ((warm.rel.nick && warm.rel.nick.warmth) > 0));
const calm = introspect('the light in the corridor is on again and the paint on the door is chipped where the hatch swings back.', { prev: '' });
line('a plain, fluent line moves almost nothing: deltas=' + JSON.stringify(calm.deltas) + ' (empty or tiny expected)');

// ---- 16. wing noise: texture directives, and injection into the prompt ----
hr('16. WING NOISE (texture, interrupts, injected)');
const wLine = 'a door goes, heavy, somewhere on the twos';
line('plain notice ->  ' + wingnoiseDirective(wLine, false, false));
line('mid-sentence  ->  ' + wingnoiseDirective(wLine, true, false));
line('night wake    ->  ' + wingnoiseDirective(wLine, true, true));
const vw = initialVitals();
vw.relations = initialRelations();
vw.derived = computeDerived(vw);
const wakeSys = buildSystem(vw, 'journal', { wingnoise: wingnoiseDirective(wLine, true, false) });
const sleepSys = buildSystem(vw, 'sleep', { wingnoise: wingnoiseDirective(wLine, false, true) });
line('wing noise reaches the WAKING prompt: ' + wakeSys.includes('THE WING, RIGHT NOW, mid-thought'));
line('wing noise reaches the SLEEP prompt: ' + sleepSys.includes('THE WING, IN THE NIGHT'));
line('mid-sentence directive tells him not to tidy the break: ' + /do not tidy the break/.test(wingnoiseDirective(wLine, true, false)));

// ---- 17. tempo as a TARGET CADENCE: duty-cycle idle, capped per speed --------
hr('17. TEMPO CADENCE (capped idle between bursts)');
line('speed=100 -> continuous (no idle): ' + tempoIdleMs(1000, 100) + ' ms (expect 0)');
line('short burst below the cap keeps the duty maths: 50->burst, 25->3x burst: ' +
  (tempoIdleMs(1000, 50) === 1000 && tempoIdleMs(1000, 25) === 3000));
line('speed=30, burst 2000ms -> ' + tempoIdleMs(2000, 30) + ' ms (duty ' + Math.round(2000 * (100 / 30 - 1)) + ', under the 30% cap)');
// THE FIX: a ~75s burst no longer explodes the gap - each speed has a sane cap.
line('someone watching (30%), burst 75s -> idle ' + tempoIdleMs(75000, 30) + ' ms, cadence ~' +
  Math.round((75000 + tempoIdleMs(75000, 30)) / 1000) + 's (was ~4 min)');
line('30% capped to maxIdleForSpeed(30): ' + (tempoIdleMs(75000, 30) === maxIdleForSpeed(30) && maxIdleForSpeed(30) === 12000));
line('nobody watching (5%), burst 75s -> idle ' + tempoIdleMs(75000, 5) + ' ms, cadence ~' +
  Math.round((75000 + tempoIdleMs(75000, 5)) / 60000) + ' min (was ~24 min)');
line('5% capped to maxIdleForSpeed(5) = 5 min: ' + (tempoIdleMs(75000, 5) === maxIdleForSpeed(5) && maxIdleForSpeed(5) === 300000));
line('cap holds for an absurd burst: speed=5, burst 600000ms -> ' + tempoIdleMs(600000, 5) + ' ms (raw ' + 600000 * 19 + ')');
line('per-speed cap, not the flat max: ' + (tempoIdleMs(600000, 5) === maxIdleForSpeed(5) && maxIdleForSpeed(5) < MAX_TEMPO_IDLE_MS));
line('idlest (1%) still bounded under 15 min: ' + (tempoIdleMs(600000, 1) === maxIdleForSpeed(1) && maxIdleForSpeed(1) <= MAX_TEMPO_IDLE_MS));
line('cap rises monotonically as speed falls: ' +
  (maxIdleForSpeed(100) === 0 && maxIdleForSpeed(50) > 0 && maxIdleForSpeed(30) < maxIdleForSpeed(5) && maxIdleForSpeed(5) < maxIdleForSpeed(1)));
line('speed coerced into 1..100: clampSpeed(0)=' + clampSpeed(0) + ' clampSpeed(999)=' + clampSpeed(999) + ' clampSpeed("30")=' + clampSpeed('30') + ' clampSpeed(NaN)=' + clampSpeed(NaN));
line('out-of-range speed never negative idle: ' + (tempoIdleMs(1000, 0) >= 0 && tempoIdleMs(1000, 150) === 0));

// ---- 18. drawing: defensive DSL parse, passes, requests, geometry ----
hr('18. DRAWING (DSL parse + passes + requests + geometry)');

// a realistic drawing with a deliberately MALFORMED line and out-of-range coords
const dsl = [
  'C 50,20 8',            // head
  'L 50,28 50,60',        // body
  'this is not a command', // <- malformed, must be skipped
  'L 50,38 38,50',        // arm
  'L 50,38 62,50',        // arm
  'P 40,80 45,70 55,70 60,80 999,-40', // freehand, last point clamps to grid
  'D 47,18',              // an eye
  'H 20,85 80,95 5',      // shading
  'T 30,99 me',           // a label
  'Z 1,2 3,4',            // unknown op, skipped
].join('\n');
const parsed = parseStrokes(dsl);
line('raw DSL lines: 10 (2 junk: a prose line and an unknown op)');
line('parsed to ' + parsed.count + ' valid strokes (both junk lines dropped): ' + (parsed.count === 8));
const poly = parsed.strokes.find((s) => s.t === 'P');
const lastPt = poly.pts[poly.pts.length - 1];
line('out-of-range polyline point 999,-40 clamped to grid: ' + JSON.stringify(lastPt) + ' -> ' + (lastPt[0] === 100 && lastPt[1] === 0));
line('every coord inside 0..100: ' + parsed.strokes.every((s) => {
  const pts = s.pts || (typeof s.x === 'number' ? [[s.x, s.y]] : []);
  return pts.every(([x, y]) => x >= 0 && x <= 100 && y >= 0 && y <= 100);
}));

// caps + the < MIN_STROKES discard
const big = Array.from({ length: 300 }, (_, i) => `D ${i % 100},${i % 100}`).join('\n');
line('120-stroke cap holds on a 300-line drawing: ' + (parseStrokes(big).count === 120));
const junk = parseStrokes('hello\nworld\nnot a drawing at all');
line('a drawing with 0 valid strokes is below the ' + MIN_STROKES + '-stroke floor (discarded by caller): ' + (junk.count < MIN_STROKES));

// build-up passes: rough structure, then detail, then shading
const passes = splitPasses(parsed.strokes);
line('passes: ' + passes.map((p) => p.label + '(' + p.strokes.length + ')').join(' -> '));
line('layered into under -> detail -> shade: ' + (passes.length === 3 && passes[0].label === 'under' && passes[2].label === 'shade'));
line('a doodle (<=6 strokes) stays a single pass: ' + (splitPasses(parsed.strokes.slice(0, 4)).length === 1));

// geometry: exactly what pen.js will animate, produced by its own pure exports
const font = JSON.parse(await readFile(join(HERE, '..', 'public', 'assets', 'hershey-cursive.json'), 'utf8'));
const segs = sketchToPaths(parsed.strokes, { font });
const allValid = segs.length > 0 && segs.every((s) => typeof s.d === 'string' && /^M[-0-9.,\sLC]+$/.test(s.d));
line('pen.js sketchToPaths yields ' + segs.length + ' SVG path segments (T expands to glyph strokes, H to n strokes)');
line('every segment is a valid non-empty SVG path the renderer consumes: ' + allValid);
line('the label T renders as real glyph strokes (more segments than strokes): ' + (segs.length > parsed.strokes.length));

// request detection (keyword/pattern, no LLM) + honour/badly/refuse weighting
const r1 = detectDrawRequest('hey 7734, can you draw the yard for me? cheers');
line('detects a draw request + subject: ' + JSON.stringify(r1) + ' -> ' + (!!r1 && /yard/.test(r1.subject)));
line('a plain postcard is not a request: ' + (detectDrawRequest('thinking of you son, stay strong') === null));
line('"sketch a window" detected: ' + (detectDrawRequest('please sketch a window')?.isRequest === true));

// warm sender vs hostile grudge sender, deterministic rng, over many rolls
const warmReq = { subject: 'a bird', visitor_id: 'v1', warmth: 0.85, grudge: 0.02 };
const grudgeReq = { subject: 'a bird', visitor_id: 'v2', warmth: 0.05, grudge: 0.85 };
function reqTally(req, v) {
  const out = { honour: 0, badly: 0, refuse: 0 };
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < 400; i++) out[resolveRequest(req, v, { rnd }).mode]++;
  return out;
}
const vCalm = initialVitals();
const warmTally = reqTally(warmReq, vCalm);
const angryV = initialVitals();
angryV.mental.anger = 0.8;
const grudgeTally = reqTally(grudgeReq, angryV);
line('warm sender, calm mood -> mostly honoured: ' + JSON.stringify(warmTally) + ' -> ' + (warmTally.honour > warmTally.refuse));
line('grudge sender, angry mood -> refusal likely: ' + JSON.stringify(grudgeTally) + ' -> ' + (grudgeTally.refuse > 0));
const honoured = resolveRequest(warmReq, vCalm, { rnd: () => 0 }); // first band = honour
const refused = resolveRequest(grudgeReq, angryV, { rnd: () => 0.3 }); // lands in the refuse band
line('honoured request carries requested_by (' + honoured.mode + ' -> ' + honoured.requestedBy + '); ' +
  'refusal does not (' + refused.mode + ' -> ' + refused.requestedBy + '): ' +
  (honoured.requestedBy === 'v1' && refused.mode === 'refuse' && refused.requestedBy === null));

// subject extraction for the "keeps redrawing the same thing" memory
line('subjectFromLine("drawin the yard again cos i forget the bench") -> "' +
  subjectFromLine('drawin the yard again cos i forget the bench') + '"');

// frequency gate: never asleep, respects the gap floor, climbs with time
line('never draws while asleep: ' + (drawDecision({ mental: {}, derived: {} }, { asleep: true, sinceDrawMs: 1e9, rnd: () => 0 }).draw === false));
line('inside the gap floor -> no draw: ' + (drawDecision({ mental: {}, derived: {} }, { sinceDrawMs: 60000, rnd: () => 0 }).draw === false));
line('a pending request shortens the floor: ' + (drawDecision({ mental: {}, derived: {} }, { sinceDrawMs: 6 * 60 * 1000, hasRequestPending: true, rnd: () => 0.1 }).draw === true));

line('\n(selftest complete)');
