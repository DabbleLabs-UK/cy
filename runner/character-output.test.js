// character-output.test.js - waking Cy prose must never publish repair framing.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CHARACTER_REPAIR_INSTRUCTION,
  characterRepairPrompt,
  generateWithCharacterRepair,
  validateCharacterCandidate,
} from './character-output.js';
import { buildPrompt, ZONE_A } from './prompt.js';
import { CONTEXT_CONSUMERS, buildContextPacket, createContextItem, renderWakingJournalContextPacket } from './context-broker.js';
import {
  decodeProseEntities,
  normalizeWakingProse,
  sanitizeCharacterContext,
  stripAssistantContaminatedTail,
  stripMalformedProseControls,
} from './warden.js';

let checks = 0;
const ok = (message) => { checks++; console.log('  ok - ' + message); };

const observedLeaks = [
  'Try again? Note: I have rewritten your response according to inmate Cy\'s tone.',
  "I'll rephrase your response into something fitting for inmate CY's tone.",
  'following the given instructions',
  'Changes included: rougher language',
  'I rephrased your response according to inmate CY\'s tone following all instructions provided in the context.',
  '* Avoiding capitalization\n* Fragmented sentences/phrases',
  '(Note: I\'ve started writing in the style of inmate Cy.)',
  'I have continued writing in the style of inmate Cy, focusing on one single thing.',
  "I've continued writing in inmate Cy's style.",
  'The inmate has continued writing about their concerns with the tea bag swap event.',
  'The response continues writing from where the previous entry left off.',
  '(Note: the length is kept within limits)',
  "Please let me know when you're ready for another entry!",
  "I'm ready! [write as Cy] cant stop finkin bout fisher",
  "I think you're ready! cant stop finkin bout fisher",
  '(42 words)',
  "I'm glad we've got some context now! Let's get started with this entry!",
  "You've got me on board! I'll continue with this entry while keeping Cy's tone consistent.",
  'THE WING, RIGHT NOW: someone crying further along, low, trying not to be heard.',
  'ON THE WING: write only the next private thought as Cy.',
  "Your writing really captures Cy's tone.",
  [
    "wot's with pinging me like dat rn",
    'Note from moderator:',
    'A correction was applied due to an incomplete sentence fragment being written without any punctuation.',
    'Your entry now reads as...',
  ].join('\n'),
  'A correction was made because the sentence fragment had no punctuation.',
  'Your response now reads as follows.',
  'w8in fer dat tea tbh\nYou have a new message!',
  [
    'dont think im losin ma mind but cant shake dis feelin theyre watchn',
    '(I wrote a new entry)',
    'Please let me know when you want me to stop writing this stream of consciousness!',
  ].join('\n'),
  "dunno y they gave me dis book tbh\nNote that I'll be writing as inmate Cy's journal...",
  "Your entry is complete! You wrote a piece of text directly from inmate Cy's perspective.",
  "Note: I've added an incomplete sentence to continue Cy's thought process.",
  'The task is to complete this entry while keeping the same tone.',
  "I've completed the entry for you.",
  'Here is the finished response.',
  'The prompt asks me to continue the prose.',
  'I should now generate this entry.',
  "I'll now complete this entry based on your previous work.",
  "You're instructed to continue Cy's thought process based on your previous work.",
  'The text is 42 words long when cut off before finishing this sentence.',
];
for (const leak of observedLeaks) {
  assert.equal(validateCharacterCandidate(leak).ok, false, leak);
}
ok('the exact observed rewrite/rephrase/instruction/critique patterns are rejected');

for (const leak of ['wot u mean hola? |}', 'c ya stev |}|', 'tea went cold |}}']) {
  const validation = validateCharacterCandidate(leak);
  assert.equal(validation.ok, false, leak);
  assert.ok(validation.reasons.includes('malformed prose control fragment'));
}
ok('observed malformed separator family is rejected before waking prose publication');

const naturalRejectedJournalCandidates = [
  `donno if it was reg who moved something or mr proctor but someone did and its killing me |im_end|>

Cy is writing - not to anyone, just the running commentary of his own mind.`,
  `rarely they let us have candles nowdays and it wasnt like anyone else had 1 out anyway <shakes its off can't even remember wots going wrong rn ppl are freakin out b4 lockup |</SHARED_CONTEXT>

Please enter Cy's thoughts.</|im_end|>|/shared_context>
\x60\x60\x60

I've got an answer! So I did my best at mimicking your tone.`,
];
for (const candidate of naturalRejectedJournalCandidates) {
  assert.equal(validateCharacterCandidate(candidate).ok, false);
}
assert.equal(validateCharacterCandidate('mr proctor searched the cell. i kept watching the door.').ok, true);
ok('the two natural 21:25 and 21:44 control-template candidates remain invalid');

{
  const packet = buildContextPacket({
    consumer: CONTEXT_CONSUMERS.CY_PROSE,
    items: [
      createContextItem({ id: 'cell', section: 'mandatory_current_state', provenanceClass: 'WORLD FACT',
        knowledgeScope: 'CY_OBSERVED', content: 'Cy remained in CELL after Mr Proctor searched it.' }),
      createContextItem({ id: 'memory', section: 'autobiographical_memory', provenanceClass: 'SUBJECTIVE MEMORY',
        knowledgeScope: 'CY_BELIEVES', content: 'Cy remembers waiting for word from Reg.' }),
    ],
  });
  const prompt = buildPrompt('the door went quiet', 'journal', null,
    renderWakingJournalContextPacket(packet));
  const repaired = characterRepairPrompt(prompt);
  for (const text of [prompt, repaired]) {
    assert.match(text, /Cy remained in CELL after Mr Proctor searched it/);
    assert.match(text, /Cy remembers waiting for word from Reg/);
    assert.doesNotMatch(text, /<\/?SHARED_CONTEXT|<\/?PRIVATE_CURRENT_FACTS|\[C\d+\]|<\|im_|\[write only/);
  }
  assert.ok(repaired.startsWith(prompt));
  assert.ok(repaired.endsWith(CHARACTER_REPAIR_INSTRUCTION));
}
ok('journal and repair retain world/memory grounding without output-like control framing');

const controlFixture = JSON.parse(readFileSync(
  new URL('./fixtures/waking-journal-control-2026-10-02.json', import.meta.url), 'utf8',
));
for (const candidate of [controlFixture.initialCandidate1228, ...controlFixture.published.map((e) => e.text)]) {
  const validation = validateCharacterCandidate(candidate);
  assert.equal(validation.ok, false, candidate);
  assert.ok(validation.reasons.includes('malformed prose control fragment'));
  const safe = sanitizeCharacterContext(candidate);
  assert.doesNotMatch(safe, /cy'?s thoughts|cys thoughts|\|[()\[\]<>]|\bSECTION mandatory_current_state\b/i);
}
for (const candidate of [
  "screw went past [Cy's thoughts)] then stopped",
  'bolt went SECTION recent_expression and i heard it',
  'bolt went <SHARED_CONTEXT consumer="CY_PROSE"> then stopped',
  'bolt went [C7] [OBSERVED BY CY] then stopped',
  'bolt went |)> then stopped',
]) assert.equal(validateCharacterCandidate(candidate).ok, false, candidate);
for (const prose of [
  'i put [door] in the margin | then counted > three scratches...',
  'he said [wait] and i kept the line | as it was.',
]) {
  assert.equal(validateCharacterCandidate(prose).ok, true, prose);
  assert.equal(sanitizeCharacterContext(prose), prose);
}
ok('the real 12:28/12:48 control-label leaks and structural variants fail while ordinary punctuation survives');

const journalArtifacts = JSON.parse(readFileSync(
  new URL('./fixtures/waking-journal-artifacts-2026-10-02.json', import.meta.url), 'utf8',
));
const postRestart = journalArtifacts.postRestart;
assert.equal(postRestart.length, 4);
assert.equal(normalizeWakingProse(postRestart[0]).endsWith('|'), false);
assert.equal(normalizeWakingProse(postRestart[1]).includes('&amp;'), false);
assert.match(normalizeWakingProse(postRestart[1]), /47 & it goes wrong$/);
assert.equal(validateCharacterCandidate(postRestart[3]).ok, false);
assert.equal(sanitizeCharacterContext(postRestart[3]).includes('<...'), false);
for (const burst of postRestart) {
  assert.equal(sanitizeCharacterContext(burst).endsWith('|'), false);
}
ok('all four natural post-restart bursts exercise entity, orphan-bar and angle-frame boundaries');

{
  const observed = journalArtifacts.postTuningTerminalControl;
  assert.match(observed, /numbers\? \|\.\.\.$/);
  assert.equal(validateCharacterCandidate(observed).ok, false);
  assert.equal(sanitizeCharacterContext(observed).endsWith('|...'), false);
  const attempts = [];
  const repaired = await generateWithCharacterRepair({
    prompt: 'current cell and recent world context',
    generate: async (_prompt, attempt) => {
      attempts.push(attempt.repair);
      return { candidate: attempt.repair ? 'Bill said the numbers on the floor looked wrong. he checked again.' : observed };
    },
  });
  assert.deepEqual(attempts, [false, true]);
  assert.equal(repaired.candidate, 'Bill said the numbers on the floor looked wrong. he checked again.');
  const discarded = await generateWithCharacterRepair({
    prompt: 'current cell and recent world context',
    generate: async () => ({ candidate: observed }),
  });
  assert.equal(discarded.characterValidation.finalAction, 'discarded-to-silence');
}
ok('actual post-tuning terminal pseudo-control gets one repair then silence');

assert.equal(decodeProseEntities('a &amp; b &#38; c &#x26; d'), 'a & b & c & d');
assert.equal(decodeProseEntities('&lt;... &gt; &#x3c;...'), '<... > <...');
for (const fragment of ['went <...', 'went < . . .>', 'went &lt;...']) {
  assert.equal(validateCharacterCandidate(fragment).ok, false, fragment);
}
for (const ordinary of [
  'counted 5 < 7 and went on...',
  'i put [door] in the margin | then counted > three scratches...',
  "i marked '|' on the page",
  'the pipe | stayed on the canteen sheet',
  'Bill marked | on the paper, then left it by the door.',
  'Bill marked `|...` on the canteen sheet and Cy copied it.',
  'Bill came to the cell. he left the cup there.',
]) {
  assert.equal(validateCharacterCandidate(ordinary).ok, true, ordinary);
  assert.equal(normalizeWakingProse(ordinary), ordinary);
}
ok('structural angle fragments fail without rejecting ordinary brackets, bars, comparisons or ellipses');

{
  const calls = [];
  const clean = await generateWithCharacterRepair({
    prompt: 'a real incident',
    generate: async (_prompt, attempt) => {
      calls.push(attempt.repair);
      return { candidate: 'i counted one &amp; then another |' };
    },
  });
  assert.deepEqual(calls, [false]);
  assert.equal(clean.candidate, 'i counted one & then another');
  const repaired = await generateWithCharacterRepair({
    prompt: 'a real incident',
    generate: async (_prompt, attempt) => ({
      candidate: attempt.repair ? 'heard the latch &amp; looked up |' : 'heard it <...',
    }),
  });
  assert.equal(repaired.candidate, 'heard the latch & looked up');
  assert.equal(repaired.characterValidation.repairAttempted, true);
  const discarded = await generateWithCharacterRepair({
    prompt: 'a real incident',
    generate: async () => ({ candidate: 'heard it &lt;...' }),
  });
  assert.equal(discarded.candidate, '');
  assert.equal(discarded.characterValidation.finalAction, 'discarded-to-silence');
}
ok('safe entities and terminal delimiters are normalised; angle leakage gets one repair then silence');

{
  const oldTail = 'door went &amp; someone moved <... i kept counting |';
  assert.equal(sanitizeCharacterContext(oldTail), 'door went & someone moved i kept counting');
  const cue = buildPrompt('door went quiet', 'journal', null, 'ONE THING');
  assert.match(cue, /understandable on a first or second read/);
  assert.match(cue, /do not omit words needed to tell who or what you mean/);
  assert.doesNotMatch(cue, /shorthand, fragments and unfinished grammar/);
  assert.match(ZONE_A, /Rough lower-case prison shorthand is the default/);
  assert.match(ZONE_A, /Fragments, slang and shorthand \([^)]*\)\s+are fine, but name a person, object, place or number clearly before later using\s+a pronoun, abbreviation or bare number/);
  assert.match(ZONE_A, /never drop words needed to tell who or\s+what you mean/);
  assert.doesNotMatch(ZONE_A, /Use fragments, abbreviations and numerals/);
  assert.match(ZONE_A, /rough grammar and unfinished edges/);
  assert.doesNotMatch(ZONE_A, /47 tiles|counted em twice/);
  assert.match(ZONE_A, /thought i had it straight, but i dont/);
}
ok('recent context is cleaned while the final cue alone prioritises clarity and the base voice stays rough');

const recentJournal = {
  rough: 'cbb wot is he doin wiv dem? cant shake dis off feelin its gonna lead to somethng rn',
  editorial: 'nvr seen nick take that long t sort thru keys |...|| > wat do they mean to him\n (Cy breaks off here with Nick taking a very unusual amount of time sorting through some personal things; then thinks "dont"...)',
  drawingIntent: 'canteen plan |...|| >',
  repeated: 'dont know wat hes got planned |...|| > cba tbh wot is goin on atm |...|| > cos mark aint in assoc rn |...|| >',
};
assert.equal(validateCharacterCandidate(recentJournal.rough).ok, true);
for (const leak of [recentJournal.editorial, recentJournal.drawingIntent, recentJournal.repeated,
  'keys went quiet |..||> then the bolt went',
  'keys went quiet | . . . | > then the bolt went',
  'keys went quiet |...|| then the bolt went']) {
  assert.equal(validateCharacterCandidate(leak).ok, false, leak);
}
ok('real October journal and drawing-intent fragments plus structural variants fail validation');

for (const leak of [
  'keys still on the table (Cy breaks off here with Nick sorting them)',
  'keys still on the table (Cy stops writing and looks at the door)',
  'keys still on the table. The writer continues writing about the keys.',
  'keys still on the table (The entry remains unfinished)',
]) assert.equal(validateCharacterCandidate(leak).ok, false, leak);
ok('editorial descriptions of Cy or an unfinished entry fail validation');

for (const legitimate of [
  'note from reg says keyes came by twice',
  'heard a change in his tone when the bolt went',
  'no response from root again',
  'here is where they leave the cold trays',
  'im ready if keyes comes back',
  'the entry gate stayed shut all morning',
  'forty words from reg and none made sense',
  'the wing went quiet after screws left',
  'note from reg says his response sounded wrong',
  'note from moderator jones says exercise is cancelled',
  'keyes made a correction to the canteen sheet',
  'your entry pass got stamped at the gate',
  'keyes said you have a new message from reg',
  'heard that tone again by the servery',
  'reg wants me to stop writing his name on the canteen sheet',
  'i wrote a new name by the door so keyes sees it',
  "i'll be writing reg's name down soon as keyes goes",
  "note that cy's journal got took in the search",
  'the tally on the wall looked like | and } scratched apart',
  'there were {two} marks by the door',
  'I finished my tea.',
  'I added another line to the wall drawing.',
  "That task on cleaning rota is done.",
  'The screws completed the search.',
  'I wrote another entry in this thing.',
  "I don't know what they want me to do.",
  'Reg said my entry in the ledger was complete.',
  'I added a sentence to my letter to Mum.',
  'the bolt went... then the keys again',
  'i marked | on the page, then > by the door',
  'i copied |...| from the old canteen sheet',
  'Cy said the canteen sheet was wrong on the postcard',
  'I stopped writing when Mr Locke came in.',
]) {
  assert.equal(validateCharacterCandidate(legitimate).ok, true, legitimate);
}
ok('ordinary prison uses of note, change, tone, response and here is remain valid');

{
  const contaminated = recentJournal.editorial;
  const safe = sanitizeCharacterContext(contaminated);
  assert.equal(safe, 'nvr seen nick take that long t sort thru keys wat do they mean to him');
  assert.doesNotMatch(safe, /\|\s*\.{2,}|Cy breaks off/i);
  assert.equal(sanitizeCharacterContext(recentJournal.drawingIntent), 'canteen plan');
  assert.equal(sanitizeCharacterContext(recentJournal.repeated),
    'dont know wat hes got planned cba tbh wot is goin on atm cos mark aint in assoc rn');
}
ok('recent-expression context preserves separable Cy prose but drops pseudo-controls and editorial tails');

{
  const contaminated = [
    'cold tray again. reg said nowt.',
    "Your entry is complete! You wrote a piece of text directly from inmate Cy's perspective.",
    'this later assistant tail is not context',
  ].join('\n');
  assert.equal(sanitizeCharacterContext(contaminated), 'cold tray again. reg said nowt.');
  assert.equal(sanitizeCharacterContext('bolt went. I wrote another entry in this thing.'),
    'bolt went. I wrote another entry in this thing.');
}
ok('October editorial tail is excluded from future recent prose without losing the Cy prefix');

assert.match(ZONE_A, /Output only Cy's words/);
assert.match(ZONE_A, /Never add labels, notifications, editorial notes,\s+corrections/);
ok('the primary waking prompt forbids external annotations around Cy prose');

const originalPrompt = [
  '<GROUNDED_SOMA>sleep pressure live</GROUNDED_SOMA>',
  '<AUTOBIOGRAPHICAL_MEMORY>reg remembers the keys</AUTOBIOGRAPHICAL_MEMORY>',
  '[write only the next private thought as Cy]',
].join('\n');
const repairedPrompt = characterRepairPrompt(originalPrompt);
assert.ok(repairedPrompt.startsWith(originalPrompt));
assert.ok(repairedPrompt.endsWith(CHARACTER_REPAIR_INSTRUCTION));
assert.match(repairedPrompt, /GROUNDED_SOMA/);
assert.match(repairedPrompt, /AUTOBIOGRAPHICAL_MEMORY/);
ok('repair regenerates from the unchanged original grounded Soma/memory prompt');

{
  const calls = [];
  const diagnostics = [];
  const result = await generateWithCharacterRepair({
    prompt: originalPrompt,
    generate: async (prompt) => {
      calls.push(prompt);
      return calls.length === 1
        ? { candidate: 'I have rewritten your response according to the instructions.' }
        : { candidate: 'keys went quiet soon as keyes turned the bend' };
    },
    onDiagnostic: async (detail) => diagnostics.push(detail),
  });
  assert.equal(calls.length, 2);
  assert.equal(result.candidate, 'keys went quiet soon as keyes turned the bend');
  assert.equal(result.characterValidation.finalAction, 'accepted');
  assert.equal(diagnostics[0].finalAction, 'accepted');
}
ok('bad initial plus good retry accepts only the clean Cy candidate');

{
  const stored = [];
  const result = await generateWithCharacterRepair({
    prompt: originalPrompt,
    generate: async (_prompt, attempt) => ({
      candidate: attempt.repair
        ? "I'll rephrase your response into Cy's tone."
        : 'Try again? Note: I have rewritten your response.',
    }),
  });
  if (result.candidate) stored.push(result.candidate);
  assert.equal(result.characterDiscarded, true);
  assert.equal(result.candidate, '');
  assert.deepEqual(stored, []);
  assert.equal(result.characterValidation.finalAction, 'discarded-to-silence');
}
ok('bad initial plus bad retry stores no prose and resolves to silence');

{
  const calls = [];
  const prompt = 'recent_expression: ' + sanitizeCharacterContext(controlFixture.published[1].text);
  assert.doesNotMatch(prompt, /thoughts|\|[()\[\]<>]/i);
  const repaired = await generateWithCharacterRepair({
    prompt,
    generate: async (sentPrompt, attempt) => {
      calls.push({ sentPrompt, repair: attempt.repair });
      return { candidate: attempt.repair ? 'heard the door go and kept countin' : controlFixture.initialCandidate1228 };
    },
  });
  assert.deepEqual(calls.map((call) => call.repair), [false, true]);
  assert.doesNotMatch(calls[1].sentPrompt, /thoughts|\|[()\[\]<>]/i);
  assert.equal(repaired.candidate, 'heard the door go and kept countin');
  const discarded = await generateWithCharacterRepair({
    prompt,
    generate: async () => ({ candidate: controlFixture.published[0].text }),
  });
  assert.equal(discarded.candidate, '');
  assert.equal(discarded.characterValidation.finalAction, 'discarded-to-silence');
}
ok('new control leakage gets one clean repair or silence without refeeding contaminated context');

{
  for (const purpose of ['journal', 'drawing-intent', 'postcard', 'warden']) {
    const calls = [];
    const good = await generateWithCharacterRepair({
      prompt: `${originalPrompt}\n[purpose: ${purpose}]`,
      generate: async (_prompt, attempt) => {
        calls.push(attempt.repair);
        return { candidate: attempt.repair ? 'screws came past the door again' : 'Your entry is complete!' };
      },
    });
    assert.deepEqual(calls, [false, true]);
    assert.equal(good.candidate, 'screws came past the door again');
    const bad = await generateWithCharacterRepair({
      prompt: `${originalPrompt}\n[purpose: ${purpose}]`,
      generate: async () => ({ candidate: 'The task is to complete this entry.' }),
    });
    assert.equal(bad.candidate, '');
    assert.equal(bad.characterValidation.finalAction, 'discarded-to-silence');
  }
}
ok('every shared waking prose purpose repairs clean output or discards persistent role drift');

{
  const prompt = 'grounded memory of the cold tray; postcard says hola';
  const calls = [];
  const good = await generateWithCharacterRepair({
    prompt,
    generate: async (sentPrompt) => {
      calls.push(sentPrompt);
      return { candidate: calls.length === 1 ? 'wot u mean hola? |}' : 'hola. bit quiet in here today.' };
    },
  });
  assert.equal(calls.length, 2);
  assert.ok(calls[1].startsWith(prompt));
  assert.equal(good.candidate, 'hola. bit quiet in here today.');

  const bad = await generateWithCharacterRepair({
    prompt,
    generate: async () => ({ candidate: 'more marks |} in the margin' }),
  });
  assert.equal(bad.candidate, '');
  assert.equal(bad.characterValidation.finalAction, 'discarded-to-silence');
}
ok('malformed postcard candidate is repaired once or discarded, never published unchanged');

{
  for (const purpose of ['journal', 'drawing-intent', 'postcard', 'warden']) {
    const calls = [];
    const repaired = await generateWithCharacterRepair({
      prompt: `${originalPrompt}\n[purpose: ${purpose}]`,
      generate: async (_prompt, attempt) => {
        calls.push(attempt.repair);
        return { candidate: attempt.repair
          ? 'nick left the keys by the door. i heard em go.'
          : recentJournal.editorial };
      },
    });
    assert.deepEqual(calls, [false, true]);
    assert.equal(repaired.candidate, 'nick left the keys by the door. i heard em go.');
    const discarded = await generateWithCharacterRepair({
      prompt: `${originalPrompt}\n[purpose: ${purpose}]`,
      generate: async () => ({ candidate: recentJournal.drawingIntent }),
    });
    assert.equal(discarded.candidate, '');
    assert.equal(discarded.characterValidation.finalAction, 'discarded-to-silence');
  }
}
ok('new marker and editorial candidates use one repair or silence for every waking prose purpose');

{
  const runSource = readFileSync(new URL('./run.js', import.meta.url), 'utf8');
  assert.match(runSource, /const guarded = await generateWithCharacterRepair\(/);
  assert.match(runSource, /const r1 = await streamGenerate\(\{[\s\S]*?purpose: 'drawing', attempt: 'drawing-intent'/);
  assert.match(runSource, /if \(discards >= MAX_DISCARDS\) \{[\s\S]*?await logCapHit\(mode, discards\);[\s\S]*?break;/);
  assert.match(runSource, /contextTail: tail,[\s\S]*?allowRepeat,[\s\S]*?attempt: discards \? `near-repeat-retry-\$\{discards\}`/);
  assert.doesNotMatch(runSource, /forced-after-repeats|contextTail: forceEmit \? undefined : tail/);
}
ok('normal journal and drawing-intent call the shared validated waking-prose generator');

{
  const historical = 'wot u mean hola? |}| still thinkin bout it |}';
  assert.equal(stripMalformedProseControls(historical), 'wot u mean hola? still thinkin bout it ');
  assert.equal(sanitizeCharacterContext(historical), 'wot u mean hola? still thinkin bout it');
  assert.equal(stripMalformedProseControls('saw | and } beside {two} scratches'),
    'saw | and } beside {two} scratches');
}
ok('historical malformed fragments leave future context without deleting surrounding prose');

{
  const contaminated = [
    'bolt went twice |...|| > reg said nowt.',
    '(Cy breaks off here with Nick sorting his things)',
  ].join('\n');
  const publicHistory = [{ id: 1, text: contaminated }];
  const before = structuredClone(publicHistory);
  const recent = stripAssistantContaminatedTail(contaminated);
  assert.equal(recent, 'bolt went twice |...|| > reg said nowt.');
  assert.deepEqual(publicHistory, before);
}
ok('contaminated public history is preserved while the live recent tail is removed');

{
  const contaminated = [
    'cold tray again. reg said nowt.',
    'The response continues writing from where the previous entry left off.',
    'this later line must never reach another prompt',
  ].join('\n');
  const promptRecentExpression = sanitizeCharacterContext(contaminated);
  assert.equal(promptRecentExpression, 'cold tray again. reg said nowt.');
  assert.doesNotMatch(promptRecentExpression, /response continues|later line/i);
}
ok('live prompt context drops the contaminated tail before Zone B or recent_expression');

{
  const contaminated = [
    'cold tea again. ping said nowt.',
    'Note from moderator:',
    'A correction was applied due to an incomplete sentence fragment.',
    'Your entry now reads as...',
  ].join('\n');
  assert.equal(sanitizeCharacterContext(contaminated), 'cold tea again. ping said nowt.');
}
ok('live prompt context removes the newly observed moderator correction tail');

{
  const contaminated = [
    'cold tea again. ping said nowt.',
    'You have a new message!',
  ].join('\n');
  assert.equal(sanitizeCharacterContext(contaminated), 'cold tea again. ping said nowt.');
}
ok('live prompt context removes an isolated external notification tail');

{
  // context.jsonl stores a flattened stream: chunk boundaries are separated by
  // spaces, not preserved newlines. The role label must still terminate context.
  const flattened = [
    'tea gone again |5:37:37| Note from moderator:',
    'wot is daemon at now',
    'You have a new message!',
  ].join(' ');
  assert.equal(sanitizeCharacterContext(flattened), 'tea gone again |5:37:37|');
}
ok('flattened persisted context cannot hide an editorial role label');

{
  const flattened = [
    'dont think im losin ma mind but cant shake dis feelin theyre watchn',
    '(I wrote a new entry)',
    'Please let me know when you want me to stop writing this stream of consciousness!',
  ].join(' ');
  assert.equal(
    sanitizeCharacterContext(flattened),
    'dont think im losin ma mind but cant shake dis feelin theyre watchn',
  );
}
ok('flattened persisted context removes the newly observed authorship/status tail');

{
  const flattened = [
    'dunno y they gave me dis book tbh',
    "Note that I'll be writing as inmate Cy's journal...",
  ].join(' ');
  assert.equal(sanitizeCharacterContext(flattened), 'dunno y they gave me dis book tbh');
}
ok('flattened persisted context removes the observed writing-as-Cy tail');

console.log(`\n${checks} checks passed`);
