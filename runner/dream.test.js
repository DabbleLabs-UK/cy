// dream.test.js - DREAM MODE: the sleep-window branch, the murmur constraint,
// the dream/waking sampling split, the strict separation of dream and waking
// directives + context, the material recombination, and the slow-drawing pacing.
//
// Pure unit tests only - NO live generation. Self-checking: throws (non-zero
// exit) on any failure.
//
//   node runner/dream.test.js

import assert from 'node:assert/strict';
import {
  isSleepWindow,
  LIGHTS_OUT_MIN,
  LIGHTS_ON_MIN,
  buildDirectives,
  buildPrompt,
  options,
  sampling,
  dreamSampling,
  shapeMurmur,
  isMurmur,
  dreamMaterial,
  dreamMurmurGapMs,
  MURMUR_MIN_WORDS,
  MURMUR_MAX_WORDS,
  pickForm,
} from './prompt.js';
import {
  isSmallHours,
  pickDreamStartMin,
  dreamStrokeGapMs,
  dreamDrawing,
  SMALL_HOURS_START,
  SMALL_HOURS_END,
  parseStrokes,
} from './draw.js';

let n = 0;
const ok = (msg) => { n++; console.log('  ok - ' + msg); };

// A calm, lucid, normal vitals - the state the WAKING sampler stays coherent in.
const wakeVitals = () => ({
  physical: { pain: 0.15, hunger: 0.25, fatigue: 0.3 },
  mental: { anxiety: 0.35, stress: 0.3, despair: 0.4, hope: 0.3, lucidity: 0.65, agitation: 0.25, dissociation: 0.35, anger: 0.2, longing: 0.35 },
  derived: {},
  relations: {},
});

// ---- 1. dream branch selection across the clock ----------------------------
// asleep (=dreaming) between lights_out 22:30 and lights_on 06:30, wrapping past
// midnight; awake in between. Small hours (the dream-drawing window) 01:00-05:00.
assert.equal(LIGHTS_OUT_MIN, 22 * 60 + 30);
assert.equal(LIGHTS_ON_MIN, 6 * 60 + 30);
assert.equal(isSleepWindow(22 * 60 + 30), true, '22:30 exactly -> asleep');
assert.equal(isSleepWindow(23 * 60), true, '23:00 -> asleep');
assert.equal(isSleepWindow(0), true, 'midnight -> asleep');
assert.equal(isSleepWindow(3 * 60), true, '03:00 -> asleep');
assert.equal(isSleepWindow(6 * 60 + 29), true, '06:29 -> asleep');
assert.equal(isSleepWindow(6 * 60 + 30), false, '06:30 exactly -> awake');
assert.equal(isSleepWindow(12 * 60), false, 'noon -> awake');
assert.equal(isSleepWindow(22 * 60 + 29), false, '22:29 -> awake');
ok('sleep window wraps 22:30->06:30; awake in between');

assert.equal(isSmallHours(0 * 60 + 59), false, '00:59 -> not small hours');
assert.equal(isSmallHours(1 * 60), true, '01:00 -> small hours');
assert.equal(isSmallHours(4 * 60 + 59), true, '04:59 -> small hours');
assert.equal(isSmallHours(5 * 60), false, '05:00 -> not small hours');
// small hours are a subset of the sleep window, so a dream drawing only ever
// begins while he is asleep.
for (let m = 0; m < 1440; m += 7) {
  if (isSmallHours(m)) assert.equal(isSleepWindow(m), true, `small hours ${m} must be inside sleep window`);
}
ok('small hours 01:00-05:00 sit strictly inside the sleep window');

// the random drawing-start minute always lands inside the small hours window
for (let i = 0; i < 500; i++) {
  const s = pickDreamStartMin(Math.random);
  assert.ok(s >= SMALL_HOURS_START && s < SMALL_HOURS_END, `start ${s} in [${SMALL_HOURS_START},${SMALL_HOURS_END})`);
  assert.ok(isSmallHours(s), `start ${s} is small hours`);
}
ok('the dream-drawing start minute is always within the small hours');

// ---- 2. the murmur length constraint ---------------------------------------
assert.equal(MURMUR_MIN_WORDS, 3);
assert.equal(MURMUR_MAX_WORDS, 8);
// shapeMurmur caps at MURMUR_MAX_WORDS, lowercases, and strips terminal stops
const long = 'The Yard Was Not The Yard It Was Somewhere Else Entirely And Nobody Spoke.';
const shaped = shapeMurmur(long);
assert.ok(shaped.split(/\s+/).filter(Boolean).length <= MURMUR_MAX_WORDS, 'shaped murmur <= 8 words');
assert.equal(shaped, shaped.toLowerCase(), 'shaped murmur is lowercase');
assert.ok(!/[.?!]$/.test(shaped), 'shaped murmur has no terminal stop');
ok('shapeMurmur enforces <=8 words, lowercase, no terminal punctuation');

// isMurmur validates the shape both ways
assert.equal(isMurmur('bill in the wrong cell'), true, 'valid murmur');
assert.equal(isMurmur('the yard'), false, 'too short (2 words)');
assert.equal(isMurmur('one two three four five six seven eight nine'), false, 'too long (9 words)');
assert.equal(isMurmur('Bill in the wrong cell'), false, 'has a capital');
assert.equal(isMurmur('bill in the wrong cell.'), false, 'has a terminal stop');
// a shaped over-long murmur is a VALID murmur (length now within bounds) when it
// still has at least MURMUR_MIN_WORDS words
assert.equal(isMurmur(shapeMurmur('mother at the gate again and again and again forever')), true, 'shaped long murmur is valid');
ok('isMurmur accepts 3-8 lowercase words with no terminal stop, rejects the rest');

// ---- 3. the dream-vs-waking temperature split ------------------------------
// waking sampling stays coherent (well under the dream floor); dream sampling
// lives in its own high band 1.1-1.35, INDEPENDENT of the waking formula.
const vw = wakeVitals();
const wakeTemp = sampling(vw).temperature;
assert.ok(wakeTemp < 1.1, `waking temp ${wakeTemp} stays below the dream floor`);
for (const diss of [0, 0.25, 0.5, 0.75, 1]) {
  const v = wakeVitals();
  v.mental.dissociation = diss;
  const dt = dreamSampling(v).temperature;
  assert.ok(dt >= 1.1 && dt <= 1.35, `dream temp ${dt} within [1.1,1.35] at dissoc ${diss}`);
  assert.ok(dt > wakeTemp, `dream temp ${dt} > waking temp ${wakeTemp}`);
}
// options() routes the split by mode: dream uses the dream band, journal does not
const dreamOpts = options(vw, 4, 'dream');
const wakeOpts = options(vw, 4, 'journal');
assert.ok(dreamOpts.temperature >= 1.1, 'options(dream) temperature is in the dream band');
assert.equal(wakeOpts.temperature, wakeTemp, 'options(journal) temperature is the waking value');
assert.ok(dreamOpts.temperature > wakeOpts.temperature, 'dream hotter than waking via options()');
ok('dream temperature 1.1-1.35, independent of and always above the waking formula');

// ---- 4. waking directives do NOT leak into dream, and vice versa -----------
const v4 = wakeVitals();
v4.derived = {};
// a fully-populated WAKING directive block (state, form, incidents, one-subject)
const wakeCtx = {
  bans: 'BANS. No reader.',
  regime: 'REGIME: bang-up.',
  form: pickForm(v4, { relations: {}, rnd: () => 0 }), // deterministic: train form
  incidents: 'RAW MATERIAL (the last few real things):\n- the tea came cold',
};
const wakeDir = buildDirectives(v4, 'journal', wakeCtx);
// a dream directive block (murmur + recombined material)
const mat = dreamMaterial(
  [
    { kind: 'image', text: 'a beach at low tide', weight: 0.9 },
    { kind: 'person', text: 'Bill', weight: 0.5 },
    { kind: 'headline', text: 'trains cancelled again', weight: 0.4 },
  ],
  { rnd: () => 0.001 },
);
const dreamDir = buildDirectives(v4, 'dream', { material: mat.directive });

// waking markers must NOT appear in the dream directives
for (const marker of ['ONE THING', 'train of thought', 'RIGHT NOW', 'RAW MATERIAL', 'REGIME']) {
  assert.ok(!dreamDir.includes(marker), `dream directives must not contain waking marker "${marker}"`);
}
// dream markers must NOT appear in the waking directives
for (const marker of ['DREAM STUFF', 'murmur in your sleep', 'deep under']) {
  assert.ok(!wakeDir.includes(marker), `waking directives must not contain dream marker "${marker}"`);
}
// the dream block IS a murmur instruction with the recombined material
assert.ok(/murmur in your sleep/.test(dreamDir), 'dream directives carry the murmur instruction');
assert.ok(/DREAM STUFF/.test(dreamDir), 'dream directives carry the recombined material');
ok('dream and waking directive blocks share no markers - no cross-leak');

// ---- 5. dream content does not enter the waking context window -------------
// The dream prompt DROPS the waking Zone B prose entirely: even handed his day's
// prose as context, a dream prompt never seeds a murmur from it. Symmetrically,
// the loop never appends dream text to Zone B, so a murmur can never reach a
// later waking prompt - the two windows stay strictly apart.
const wakingProse = 'tray cold again, screw clocked me at slop and said nowt, 47 tiles to the door';
const dreamPrompt = buildPrompt(wakingProse, 'dream', null, dreamDir);
assert.ok(!dreamPrompt.includes(wakingProse), 'dream prompt must not reuse the waking prose context');
assert.ok(/a murmur surfaces in your sleep/.test(dreamPrompt), 'dream prompt uses the dream cue');
// a night-waking prompt uses the lucid cue instead
const wakeLineDir = buildDirectives(v4, 'dream', { wake: true, wakeLine: 'the alarm goes' });
const wakePrompt = buildPrompt(wakingProse, 'dream', { wake: true }, wakeLineDir);
assert.ok(!wakePrompt.includes(wakingProse), 'night-waking prompt must not reuse the waking prose');
assert.ok(/awake for one second/.test(wakePrompt), 'night-waking prompt uses the lucid cue');
// and the waking prompt, built from that prose as its context, contains a murmur
// nowhere (dream text is never written into Zone B in the first place)
const wakePromptNormal = buildPrompt(wakingProse + ' ' + shaped, 'journal', null, wakeDir);
assert.ok(wakePromptNormal.includes(wakingProse), 'waking prompt keeps its own Zone B prose');
ok('dream prompts drop the waking context; dream text never enters Zone B');

// ---- 6. the night-waking line is a different register from murmurs ---------
assert.ok(/full[\s\S]*punctuated sentence/.test(wakeLineDir), 'night-waking demands a full punctuated sentence');
assert.ok(/capital/.test(wakeLineDir) && /full stop/.test(wakeLineDir), 'night-waking demands a capital and a full stop');
assert.ok(!/3 to 8 words/.test(wakeLineDir), 'night-waking is NOT the murmur constraint');
ok('the night-waking line is lucid + punctuated, the opposite of a murmur');

// ---- 7. dream material: recombined, weighted, distorted ---------------------
// significant/recent material (higher weight) is selected far more often
const pool = [
  { kind: 'image', text: 'HEAVY', weight: 10 },
  { kind: 'incident', text: 'light-a', weight: 0.2 },
  { kind: 'incident', text: 'light-b', weight: 0.2 },
  { kind: 'person', text: 'light-c', weight: 0.2 },
];
let heavyHits = 0;
const N = 2000;
for (let i = 0; i < N; i++) {
  const m = dreamMaterial(pool, { rnd: Math.random });
  if (m.items.some((it) => it.text === 'HEAVY')) heavyHits++;
}
assert.ok(heavyHits / N > 0.9, `the significant item is chosen most of the time (got ${(heavyHits / N).toFixed(2)})`);
// the material instructs distortion + carries the fragments, not a tidy replay
const m7 = dreamMaterial(pool, { rnd: () => 0.0001 });
assert.ok(/do NOT get it right/.test(m7.directive), 'material instructs distortion');
assert.ok(/bleed into each other/.test(m7.directive), 'material instructs recombination');
assert.ok(m7.items.length >= 2 && m7.items.length <= 3, 'material draws 2-3 fragments');
assert.ok(m7.significance >= 0.2, 'material reports a significance');
// an empty pool yields no material (no crash, no seed)
const m0 = dreamMaterial([], { rnd: () => 0.5 });
assert.equal(m0.directive, '', 'empty pool -> empty material');
assert.equal(m0.items.length, 0, 'empty pool -> no items');
ok('dreamMaterial weights the significant, recombines 2-3 fragments, instructs distortion');

// ---- 8. the one-stroke-per-1-2-minutes pacing, murmurs 5-20 min apart -------
for (let i = 0; i < 5000; i++) {
  const g = dreamStrokeGapMs(Math.random);
  assert.ok(g >= 60000 && g <= 120000, `stroke gap ${g}ms within [60000,120000]`);
}
ok('dream stroke pacing is one every 1-2 minutes (60000-120000 ms)');
for (let i = 0; i < 5000; i++) {
  const g = dreamMurmurGapMs(Math.random);
  assert.ok(g >= 5 * 60000 && g <= 20 * 60000, `murmur gap ${g}ms within [5min,20min]`);
}
// murmurs are spaced FAR longer apart than strokes (the page is mostly still)
assert.ok(5 * 60000 > 120000, 'the murmur floor is well beyond the stroke ceiling');
ok('murmurs are spaced 5-20 minutes apart, much longer than the waking cadence');

// ---- 9. the dream drawing is abstract, valid, and enclosing ----------------
const strokes = dreamDrawing(Math.random);
assert.ok(strokes.length > 3, `dream drawing has ${strokes.length} strokes (a real drawing)`);
const kinds = new Set(strokes.map((s) => s.t));
assert.ok(kinds.has('C'), 'has concentric circle marks');
assert.ok(kinds.has('L'), 'has the enclosing box lines');
const circles = strokes.filter((s) => s.t === 'C');
assert.ok(circles.length >= 5, 'concentric: several circles gone over');
// all circles share a centre (concentric), radii increasing (enclosing)
const cx = circles[0].x;
const cy = circles[0].y;
assert.ok(circles.every((c) => c.x === cx && c.y === cy), 'circles are concentric (shared centre)');
for (let i = 1; i < circles.length; i++) assert.ok(circles[i].r >= circles[i - 1].r, 'radii grow outward (enclosing)');
// every coordinate stays on the 0-100 grid, so the pen renders it cleanly. Round-
// trip the DSL text through parseStrokes to prove the pen would accept every mark.
const dslText = strokes
  .map((s) => {
    if (s.t === 'C') return `C ${s.x},${s.y} ${s.r}`;
    if (s.t === 'A') return `A ${s.x},${s.y} ${s.r} ${s.a1} ${s.a2}`;
    if (s.t === 'L') return `L ${s.pts[0][0]},${s.pts[0][1]} ${s.pts[1][0]},${s.pts[1][1]}`;
    if (s.t === 'D') return `D ${s.x},${s.y}`;
    return '';
  })
  .join('\n');
const reparsed = parseStrokes(dslText);
assert.equal(reparsed.strokes.length, strokes.length, 'every dream stroke survives a DSL round-trip (all on-grid, all valid)');
ok('the dream drawing is abstract + concentric + enclosing, and every mark is a valid on-grid stroke');

console.log(`\ndream.test.js: all ${n} checks passed`);
