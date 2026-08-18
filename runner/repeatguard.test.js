// repeatguard.test.js - the two live faults fixed in this change.
//
//  1. STATE-NOTATION LEAK: the compressed vitals notation must never survive into
//     emitted prose, and the volatile block must sit EARLIER than the generation
//     point (his own prose + the cue are always the last thing before generation).
//  2. The near-repeat guard's hard cap / escape are exercised in run.js (inside
//     main), so here we assert the pure, testable pieces the loop leans on.
//
// Self-checking: throws (non-zero exit) on any failure.
//
//   node runner/repeatguard.test.js

import assert from 'node:assert/strict';
import { stripScaffold, stateNotationHits, sanitize } from './warden.js';
import { buildDirectives, buildPrompt, stateNotation } from './prompt.js';

let n = 0;
const ok = (msg) => { n++; console.log('  ok - ' + msg); };

// ---- 1. the exact live leak is stripped, lead-in and all ----
const leak = 'cos bill swapped ur meal tray 7734 day 1st agit .70 stress .85 despair .80 hunger 2.00 fatigue 3.0';
assert.equal(stateNotationHits(leak).length, 1, 'the notation run is detected as one hit');
const strippedLeak = stripScaffold(leak);
assert.ok(!/\d\.\d/.test(strippedLeak), 'no decimal pairs survive');
assert.ok(!/agit|despair|fatigue/.test(strippedLeak), 'the notation tokens are gone');
assert.ok(strippedLeak.includes('swapped ur meal tray'), 'his real prose is kept');
ok('the live state-notation leak (with 7734 / day lead-in) is stripped, prose kept');

// ---- 2. the STATE: labelled form is stripped too ----
assert.equal(stripScaffold('STATE: anx .82 | agit .70 blah').trim(), 'blah');
ok('a STATE:-labelled notation block is stripped');

// ---- 3. ordinary prose with stray numbers is NEVER eaten (needs 2+ decimal pairs) ----
for (const p of [
  '3rd day no VO. screw clocked me at slop, tray cold again. cba.',
  '47 tiles to the door. counted em twice, lost count once.',
  'b4 lockup they said gym. no gym. course not.',
  'hes on the 2s, bird for 3.5 years they reckon', // a lone decimal is one pair - safe
]) {
  assert.equal(stripScaffold(p), p, 'unchanged: ' + p);
}
ok('ordinary prose (whole numbers, a single decimal) survives untouched');

// ---- 4. a chunk that is ONLY state notation collapses to whitespace ----
// (onChunk drops it entirely via the `!chunk.trim()` guard, so nothing is emitted
//  and nothing pollutes Zone B / the reprise).
assert.equal(stripScaffold('agit .70 stress .85 despair .80').trim(), '');
ok('a pure state-notation chunk collapses to empty and is dropped');

// ---- 5. PROMPT ORDER: state notation sits EARLIER than the generation point,
// and the last thing before the cue is his own prose, never the notation ----
const v = {
  mental: { anxiety: 0.82, agitation: 0.7, stress: 0.4, despair: 0.4, hope: 0.3, lucidity: 0.65, dissociation: 0.35, anger: 0.2, longing: 0.35 },
  physical: { pain: 0.15, hunger: 0.25, fatigue: 0.3 },
  derived: {},
};
const note = stateNotation(v);
assert.ok(note.startsWith('STATE:'), 'notation renders for this state');
const directives = buildDirectives(v, 'journal', { bans: 'BANS. x', form: 'FORM: train of thought.' });
assert.ok(directives.includes(note), 'the notation is inside the volatile block');
const ctx = 'same ceiling again. tray came cold, bill on the twos kicking off';
const prompt = buildPrompt(ctx, 'journal', null, directives);
const cue = '[back in your own head, the stream keeps going:]';
assert.ok(prompt.endsWith(cue), 'the prompt ends with the continuation cue');
const iNote = prompt.indexOf('STATE:');
const iCue = prompt.lastIndexOf(cue);
assert.ok(iNote >= 0 && iNote < iCue, 'the state notation sits before the cue');
// the reprise (his prose) is the last thing before the cue - so what the model
// continues from is his voice, never the notation or a directive block.
const beforeCue = prompt.slice(0, iCue).trimEnd();
assert.ok(/twos kicking off|ceiling/.test(beforeCue.slice(-80)), 'his own prose immediately precedes the cue');
assert.ok(!/agit \.70|STATE:/.test(beforeCue.slice(-60)), 'the notation is NOT adjacent to the cue');
ok('state notation is early; his prose + cue are the final thing before generation');

// ---- 6. dream/sleep paths route through the same strip (sanity: sanitize+strip) ----
assert.equal(stripScaffold(sanitize('anx .60 stress .70 pain .55')).trim(), '');
ok('the same strip applies wherever stripScaffold is called (dream/context feedback)');

console.log(`\n${n} checks passed`);
