// repeatguard.test.js - the two live faults fixed in this change.
//
//  1. STATE-NOTATION LEAK: the compressed legacy vitals notation must never enter
//     the live prompt or survive into emitted prose. His own prose + the cue remain
//     the last thing before generation.
//  2. The near-repeat guard's hard cap / escape are exercised in run.js (inside
//     main), so here we assert the pure, testable pieces the loop leans on.
//
// Self-checking: throws (non-zero exit) on any failure.
//
//   node runner/repeatguard.test.js

import assert from 'node:assert/strict';
import {
  assistantFrameHits,
  looksLikeAssistantFrame,
  sanitize,
  stateNotationHits,
  stripAssistantContaminatedTail,
  stripScaffold,
} from './warden.js';
import { ZONE_A, buildDirectives, buildPrompt, stateNotation } from './prompt.js';

let n = 0;
const ok = (msg) => { n++; console.log('  ok - ' + msg); };

// ---- 1. the exact live leak is stripped, lead-in and all ----
const leak = 'cos bill swapped ur meal tray 7734 day 1st agit .70 stress .85 despair .80 hunger 2.00 fatigue 3.0';
assert.ok(stateNotationHits(leak).length >= 1, 'the notation run is detected (one or more overlapping patterns)');
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

// ---- 3b. BARE state-axis LABEL runs (no decimals) are caught; single labels in
// real prose survive. A run of 2+ axis labels adjacent with nothing but
// whitespace/commas between them is the signature (' hope fatig ...'). ----
assert.ok(stateNotationHits('hope fatig').length >= 1, 'a bare two-label run is detected');
assert.equal(stripScaffold('hope fatig').trim(), '', 'a bare two-label run is stripped');
assert.equal(stripScaffold('anx stress despair').trim(), '', 'a longer bare-label run is stripped');
for (const p of [
  'no hope left',                       // single label wrapped in prose
  'i felt a pain today',                // single label
  'there is no hope and no anger here', // two labels but real prose ("and") between
]) {
  assert.equal(stripScaffold(p), p, 'single labels in prose survive: ' + p);
  assert.equal(stateNotationHits(p).length, 0, 'no false hit: ' + p);
}
ok('bare state-axis label runs are caught; single labels in real prose survive');

// ---- 4. a chunk that is ONLY state notation collapses to whitespace ----
// (onChunk drops it entirely via the `!chunk.trim()` guard, so nothing is emitted
//  and nothing pollutes Zone B / the reprise).
assert.equal(stripScaffold('agit .70 stress .85 despair .80').trim(), '');
ok('a pure state-notation chunk collapses to empty and is dropped');

// ---- 5. LIVE PROMPT: legacy state notation is not injected at all, and the
// last thing before the cue remains his own prose ----
const v = {
  mental: { anxiety: 0.82, agitation: 0.7, stress: 0.4, despair: 0.4, hope: 0.3, lucidity: 0.65, dissociation: 0.35, anger: 0.2, longing: 0.35 },
  physical: { pain: 0.15, hunger: 0.25, fatigue: 0.3 },
  derived: {},
};
const note = stateNotation(v);
assert.ok(note.startsWith('STATE:'), 'notation renders for legacy diagnostics');
const directives = buildDirectives(v, 'journal', { bans: 'BANS. x', form: 'FORM: train of thought.' });
assert.ok(!directives.includes(note), 'legacy notation is excluded from the live volatile block');
const ctx = 'same ceiling again. tray came cold, bill on the twos kicking off';
const prompt = buildPrompt(ctx, 'journal', null, directives);
const cue = '[write only the next private thought as Cy. keep his rough lower-case prison slang, shorthand, fragments and unfinished grammar even if the recent prose became formal. no polished standard English, semicolons, analysis, explanation, or commentary about the material. begin immediately:]';
assert.ok(prompt.endsWith(cue), 'the prompt ends with the continuation cue');
const iCue = prompt.lastIndexOf(cue);
assert.equal(prompt.indexOf('STATE:'), -1, 'the live prompt contains no state notation');
// the reprise (his prose) is the last thing before the cue - so what the model
// continues from is his voice, never the notation or a directive block.
const beforeCue = prompt.slice(0, iCue).trimEnd();
assert.ok(/twos kicking off|ceiling/.test(beforeCue.slice(-80)), 'his own prose immediately precedes the cue');
assert.ok(!/agit \.70|STATE:/.test(beforeCue.slice(-60)), 'the notation is NOT adjacent to the cue');
ok('state notation is absent; his prose + cue are the final thing before generation');

// ---- 5b. JOURNAL VOICE LOCK: the cached persona restores Cy's rough register,
// and a final journal-only reminder follows even a polished recent tail. This is
// deliberately prompt-level rather than a text rewrite: the emitted prose stays
// the model's own writing, while the last instruction prevents the fed-back tail
// from teaching the model a new formal voice.
assert.match(ZONE_A, /Rough lower-case prison shorthand is the default/);
assert.match(ZONE_A, /Do not use semicolons or/);
const polishedTail = 'I have to be ready for anything; prepared for a fight. Whatever it is must be moving closer.';
const driftPrompt = buildPrompt(polishedTail, 'journal', null, directives);
assert.ok(driftPrompt.endsWith(cue), 'the journal voice lock follows a polished fed-back tail');
assert.ok(driftPrompt.lastIndexOf('rough lower-case prison slang') > driftPrompt.lastIndexOf(polishedTail),
  'the rough-register instruction is later than the formal context it must override');
const postcardPrompt = buildPrompt(polishedTail, 'postcard', { from_name: 'j', body: 'you alright?' }, directives);
assert.ok(!postcardPrompt.includes('even if the recent prose became formal'),
  'the journal-only voice lock does not replace the postcard reply contract');
ok('journal prompts re-anchor the rough slang register after formal context without changing postcard instructions');

// ---- 6. dream/sleep paths route through the same strip (sanity: sanitize+strip) ----
assert.equal(stripScaffold(sanitize('anx .60 stress .70 pain .55')).trim(), '');
ok('the same strip applies wherever stripScaffold is called (dream/context feedback)');

for (const leakText of [
  "Note: I've continued with Cy's style by maintaining the informal tone.",
  '[LEARNED STATISTICAL EXPECTATION] A cue predicts an outcome.',
  '[OBSERVED FACT] A noise was heard.',
  '<AUTOBIOGRAPHICAL_MEMORY>private context</AUTOBIOGRAPHICAL_MEMORY>',
]) {
  assert.ok(assistantFrameHits(leakText).length > 0, leakText);
}
ok('memory and context scaffolding is recognised as an assistant frame');

// ---- 7. assistant analysis frames are rejected as whole bursts ----
const assistantLeaks = [
  "I'll try to analyze the text based on the provided context: **Sleep**: The subject is awake.",
  "I'm not sure what's happening here! It appears you're providing a snippet of text related to an AI model.",
  "You're continuing from where you left off! It's fascinating how you've woven together various phrases.",
  'You trail off as the sound continues. Your mind wanders back to the supplied context.',
  'Here are my thoughts: this passage has an eerie atmosphere.',
  "Note: I've tried to maintain the same tone, language, and style that Cy is using, without adding any polish or refinement.",
];
for (const leakText of assistantLeaks) {
  assert.equal(looksLikeAssistantFrame(leakText), true, leakText);
  assert.ok(assistantFrameHits(leakText).length > 0, leakText);
}
for (const cyText of [
  "i'm not sure whats happening wi bill. door went twice.",
  'you said the tray was mine. course it wasnt.',
  'cant analyse it. just keeps going round ma heid.',
]) {
  assert.equal(looksLikeAssistantFrame(cyText), false, cyText);
}
const polluted = "real cy words before it. I'll try to analyze the text based on the provided context: junk";
assert.equal(stripAssistantContaminatedTail(polluted), 'real cy words before it.');
const latePolluted = "gotsta find a way outta here sometime soon\nend\nNote: I've tried to maintain the same tone, language, and style that Cy is using, without adding any polish or refinement. The entry ends abruptly with an incomplete sentence, which is consistent with the original text.";
assert.equal(stripAssistantContaminatedTail(latePolluted), 'gotsta find a way outta here sometime soon\nend');
ok('assistant analysis frames are rejected and saved-context contamination is cut at its start');

// ---- 8. interactive assistant boilerplate is removed without eating Cy's line ----
const stopLeak = "wit dem screws always tryna get under ya skin dont know why. Please let me know when to stop!";
assert.equal(stripScaffold(stopLeak).trim(), 'wit dem screws always tryna get under ya skin dont know why.');
assert.equal(looksLikeAssistantFrame(stopLeak), true);
assert.equal(
  stripAssistantContaminatedTail(stopLeak),
  'wit dem screws always tryna get under ya skin dont know why.',
);
assert.equal(stripScaffold('screw told me stop banging the door'), 'screw told me stop banging the door');
ok('the stop-request assistant leak is removed while ordinary in-character stop prose survives');

console.log(`\n${n} checks passed`);
